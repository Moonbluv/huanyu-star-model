/* HY.fp.eye —— 人眼与画质（M6）：TAA 改正与拍照累积、人眼与后期的 JS 镜像、累积进度、“出一张”
 * 规格：spec/02 第十四节（TAA、测光、眼、色适应、暗视、眩光、最终）、第十五节（档位、动态分辨率、拍照累积）；spec/00 第三节 M6。
 * 负责：M6 路（人眼与画质）。节点可测：加载时不碰 DOM、THREE（shoot／accum 只在浏览器里有意义）。
 *
 * 接入（只用注册函数，不改别人的文件）：
 *   · DEFS.taa 的主文件改指 glsl/eye_taa.frag、目标格式 'f32lin'（ps.addDefs({taa}, {replace:true})，其余字段照旧）。改正见那个文件的开头。
 *   · DEFS.eye 拼 common＋shadow＋clouds（到眼日光沿日光方向用画云的同一套密度步进），目标 5×1（纹素 2–4 存颜色、预滤波与环境状态，见 eye.frag）。
 *   · 画质宏：TAA_ACCUM＝TIER_OPTS[档].accum（低 8、中 16、高 64、拍照 64）；BLOOM_LV＝眩光金字塔级数（final 的局部适应按它归一）；
 *     TAA_DEPTH＝1（历史 a 通道的小数部分存视线距离；没有浮点线性过滤、历史退回 16F 的设备取 0，按 HY.gfx.caps 现取）。
 *
 * 2026-10-14 eye 路修订（验收问题单 1–18，见 05_验收记录）：
 *   key 由与朝向无关的水平面照度定（夜终于比昼暗）；适应亮度＝环境项与画面项在对数域 6:4 混合（转头不再摆 3–4 EV）；
 *   测光目标对称预滤波＋0.1 EV 软死区（赤道沟底不再抽动）；快进时眼跟得上；固定 EV 与读数同口径；
 *   到眼日照沿日光方向步进体积云、带颜色与露出部分的临边昏暗色；光幕计入适应；局部适应；AgX 加对比 look；暗视按白点归一。
 *
 * 接口：
 *   taa.step(nPrev, blend, ok, accum, opt) → {n, a}  eye_taa.frag 逐像素的等效样本数与本帧权重（opt：{rainStill, depthTest}）
 *   taa.isStill(blend, accum) / taa.boxWeight(mv) / taa.stride(nearScale) / taa.histPos(…)
 *   taa.dCode(km) / dDecode(code) / pack(n, km) / unpack(a) → {n, km} / moved(dq, dh)   历史 a 通道的距离编码与近处距离检验
 *   limbTint(f) → [r,g,b]        日面露出 f 时露出部分的平均临边昏暗色（相对整盘）
 *   key(EhLux) / envL(EhKlux) / frameShift(dEV) / mixTarget(LaFrame, Lenv) / eyeStep(prev, o) / adapt(La0, F, dt, opt)
 *   exposure(La, cfg, key) / laEq(La, key) / ev(La) / meterClamp(L, La) / veil(Eklux, thDeg, k, tanHalf)
 *   agx(rgb) / agxBase(rgb) / aces(rgb) / srgb(rgb) / scotopicK(La, on) / scotopic(rgb, k) / glare(Eklux, thDeg, k, tanHalf) / localGain(LlocCd, lnFrame)
 *   finalPixel(o) → [r, g, b]（0–1，未加抖动）    final.frag 的整条链
 *   accum() → {still, n, of, done, frames, tier}  拍照累积的进度（HUD 可写“累积 n/N”）
 *   shoot(opts) → Promise<{url, w, h, n, of, tier, t, falling}>  时间暂停、画面静止时累积满了从画布取一张 PNG
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  var E = fp.eye = fp.eye || {};
  var ps = fp.passes;

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { var u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); }
  function fmtF(v) { var s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; }

  /* ───────── 接入 ───────── */
  E.TAA_MAIN = 'eye_taa';
  E.EYE_W = 5;                            // tEye 的宽（纹素 0–4）
  E.wire = function () {
    if (!ps || !ps.DEFS || !ps.addDefs || !ps.DEFS.taa || !ps.DEFS.eye) return false;
    var d = ps.DEFS.taa, nd = {}, de = ps.DEFS.eye, ne = {}, k;
    for (k in d) nd[k] = d[k];
    for (k in de) ne[k] = de[k];
    nd.main = E.TAA_MAIN;
    nd.fmt = 'f32lin';                    // 历史 32F（没有浮点线性过滤时 16F）：a 通道存 n＋距离编码；16F 在 α≤0.1 时舍入一边倒
    ne.chunks = ['common', 'shadow', 'clouds'];
    ne.size = [E.EYE_W, 1];
    ps.addDefs({ taa: nd, eye: ne }, { replace: true });
    var v = {}, b = {}, z = {};
    ps.TIER_NAMES.forEach(function (t) {
      var o = ps.TIER_OPTS[t] || {};
      v[t] = fmtF(num(o.accum, 16));
      b[t] = fmtF(Math.min(num(o.bloomLevels, 5), num(ps.DEFS.bloom_down && ps.DEFS.bloom_down.levels, 5)));
      z[t] = '1';
    });
    ps.addTierDefine('TAA_ACCUM', v);
    ps.addTierDefine('BLOOM_LV', b);
    ps.addTierDefine('TAA_DEPTH', z);
    // TAA_DEPTH 按设备现取：历史退回 16F（没有 OES_texture_float_linear）时 a 通道放不下 n 与距离编码
    ps.TIER_NAMES.forEach(function (t) {
      try {
        Object.defineProperty(ps.TIERS[t], 'TAA_DEPTH', { enumerable: true, configurable: true,
          get: function () { var c = HY.gfx && HY.gfx.caps; return c && c.ok && c.floatLinear === false ? '0' : '1'; } });
      } catch (e) { /* 冻结的对象：留常量 */ }
    });
    return true;
  };
  E.wired = E.wire();

  /* ───────── TAA（eye_taa.frag 的 JS 镜像） ───────── */
  var T = E.taa = {};
  T.STILL = 0.0999;                       // uBlend 小于它＝相机与时间都静止（运动时 α_min＝0.1）
  T.NMAX = 256; T.NMAX16 = 64; T.NRAIN = 32; T.NEAR_KM = 0.06; T.DTOL = 0.03;
  // 静止：uBlend＜0.1，或正好等于 1/accum（低档 accum＝8，静止时 uBlend＝1/8＞0.1）
  T.isStill = function (blend, accum) { return blend < T.STILL || Math.abs(blend - 1 / num(accum, 16)) < 1e-5; };
  // 逐像素：nPrev＝历史 a 通道里的等效样本数；blend＝uBlend；ok＝重投影落在画面里（且不是重置后的第一帧）
  //   opt.rainStill：雨丝／飘尘在画、相机与时间不动（帧图给 0.1，这里照样累积到 32）；opt.depth16：历史 16F（上限 64）
  T.step = function (nPrev, blend, ok, accum, opt) {
    opt = opt || {};
    accum = num(accum, 16);
    if (!ok || !(blend < 0.999)) return { n: 1, a: 1 };
    var still = T.isStill(blend, accum), rain = !still && !!opt.rainStill && Math.abs(blend - 0.1) < 1e-4;
    var cap = rain ? T.NRAIN : opt.depth16 ? T.NMAX16 : T.NMAX;
    var n = still || rain ? Math.min(Math.max(Math.floor(num(nPrev, 1)), 1) + 1, cap) : 1 / Math.max(blend, 1e-3);
    return { n: n, a: 1 / n };
  };
  T.boxWeight = function (mv) { return 1 - 0.4 * sstep(0.5, 2, mv); };   // 外圈并进裁剪框的权重：静止 1，运动 0.6
  T.stride = function (nearScale) { return Math.round(1 / nearScale); };
  T.dCode = function (km) { return clamp(Math.log2(1 + Math.max(km, 0) * 1000) / 26, 1e-3, 0.999); };
  T.dDecode = function (c) { return (Math.pow(2, c * 26) - 1) / 1000; };
  T.pack = function (n, km) { return Math.floor(n + 0.5) + T.dCode(km); };
  T.unpack = function (a) { var n = Math.floor(a); return { n: Math.max(n, 1), km: T.dDecode(a - n) }; };
  // 近处（60 m 内）重投影后的距离与历史里的对不上 3%：不用历史（风里摆动的草叶、走动时露出来的地面）
  T.moved = function (dq, dh) { return Math.min(dq, dh) < T.NEAR_KM && Math.abs(Math.log(Math.max(dq, 1e-6) / Math.max(dh, 1e-6))) > T.DTOL; };
  // 历史取样位置（像素坐标，gl_FragCoord 口径）：fc 本像素中心、jit＝[本帧, 上一帧] 抖动、cam／prev＝{pos, fwd, right, up}、
  //   dist＝本像素视线距离、res＝[W, H]、tanHalf；which：'eye'（本文件，扣本帧抖动）| '02'（02 原式，扣上一帧抖动）
  T.histPos = function (fc, jit, cam, prev, dist, res, tanHalf, which) {
    var J = jit[0], Jp = jit[1], W = res[0], H = res[1];
    var nx = (2 * (fc[0] + J[0]) - W) / H, ny = (2 * (fc[1] + J[1]) - H) / H, d = [0, 0, 0], k;
    for (k = 0; k < 3; k++) d[k] = cam.fwd[k] + tanHalf * (nx * cam.right[k] + ny * cam.up[k]);
    var l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    var X = [cam.pos[0] + d[0] / l * dist, cam.pos[1] + d[1] / l * dist, cam.pos[2] + d[2] / l * dist];
    var r = [X[0] - prev.pos[0], X[1] - prev.pos[1], X[2] - prev.pos[2]];
    var qx = r[0] * prev.right[0] + r[1] * prev.right[1] + r[2] * prev.right[2];
    var qy = r[0] * prev.up[0] + r[1] * prev.up[1] + r[2] * prev.up[2];
    var qz = r[0] * prev.fwd[0] + r[1] * prev.fwd[1] + r[2] * prev.fwd[2];
    var off = which === '02' ? Jp : J;
    return [qx / (qz * tanHalf) * H * 0.5 + W * 0.5 - off[0], qy / (qz * tanHalf) * H * 0.5 + H * 0.5 - off[1]];
  };

  /* ───────── 眼（eye.frag 的 JS 镜像） ───────── */
  E.LA_MIN = 0.003; E.LA_MAX = 1e5; E.TAU_UP = 0.6; E.TAU_DOWN = 3; E.TAU_TURN_UP = 0.4; E.TAU_TURN_DOWN = 0.6; E.TAU_PRE = 0.25;
  E.L_ENV_K = 0.3; E.KEY_REF = 2e4; E.MIX_FRAME = 0.4;
  var LN2 = Math.LN2;
  // 日面露出 f 时露出部分相对整盘平均的临边昏暗色（直边切；u＝(0.55, 0.70, 0.85)）
  E.limbTint = function (f) {
    if (!(f < 0.999)) return [1, 1, 1];
    f = clamp(f, 1e-5, 0.999);
    var c = 3 * Math.PI / (4 * Math.SQRT2), ue = f < 0.5 ? -1 + Math.pow(c * f, 2 / 3) : 1 - Math.pow(c * (1 - f), 2 / 3), i;
    for (i = 0; i < 5; i++) {
      ue = clamp(ue, -1, 1);
      var s = Math.sqrt(Math.max(1 - ue * ue, 1e-8)), g = 0.5 + (ue * s + Math.asin(ue)) / Math.PI - f;
      ue -= g / Math.max(2 * s / Math.PI, 1e-4);
    }
    ue = clamp(ue, -1, 1);
    var mu = clamp((ue - ue * ue * ue / 3 + 2 / 3) / (2 * f), 0, 1);
    return [0.55, 0.70, 0.85].map(function (u) { return (1 - u * (1 - mu)) / (1 - u / 3); });
  };
  E.limbFrac = function (ue) { ue = clamp(ue, -1, 1); return 0.5 + (ue * Math.sqrt(1 - ue * ue) + Math.asin(ue)) / Math.PI; };
  // key：由水平面照度（lux）定，整段连续；圣禁城晴天正午满额
  E.key = function (EhLux) { return 0.18 * clamp(Math.pow(Math.max(EhLux, 0) / Math.PI / E.KEY_REF, 0.25), 0.01, 1); };
  // 环境项（cd/m²）：0.3·E_水平/π（照度以 klux 计；与朝向无关）
  E.envL = function (EhK) { return clamp(E.L_ENV_K * Math.max(EhK, 1e-9) * 1000 / Math.PI, E.LA_MIN, E.LA_MAX); };
  // 画面项相对环境项的偏离 d（EV）怎样进适应：0.4·clamp(d, −1, 1)＋0.5·clamp(d − 1, 0, 3)（比环境亮得多时多跟一些）
  E.frameShift = function (dEV) { return E.MIX_FRAME * clamp(dEV, -1, 1) + 0.5 * clamp(dEV - 1, 0, 3); };
  // tanHalf（可缺省＝70° 视角）：望远（视角 60° → 10°）时渐渐全跟画面
  E.mixTarget = function (LaFrame, Lenv, tanHalf) {
    var d = Math.log2(Math.max(LaFrame, 1e-9) / Lenv), lnT = Math.log(Lenv) + LN2 * E.frameShift(d);
    var w = sstep(0.0875, 0.5774, num(tanHalf, 0.70021));
    return clamp(Math.exp(Math.log(Math.max(LaFrame, 1e-9)) + (lnT - Math.log(Math.max(LaFrame, 1e-9))) * w), E.LA_MIN, E.LA_MAX);
  };
  // 一步适应（对数域）：La0 → 预滤波后的目标 F。opt：{env 环境在变, speed 模拟秒/真实秒}
  E.adapt = function (La0, F, dt, opt) {
    opt = opt || {};
    F = clamp(F, E.LA_MIN, E.LA_MAX);
    if (!(La0 > 0)) return F;
    var l0 = Math.log(La0), lf = Math.log(F), dl = lf - l0, fs = Math.sqrt(Math.max(1, num(opt.speed, 0) / 60));
    var tau = dl > 0 ? (opt.env ? E.TAU_UP : E.TAU_TURN_UP) : (opt.env ? E.TAU_DOWN : E.TAU_TURN_DOWN);
    var meso = 1 - sstep(Math.log(0.003), Math.log(3), Math.min(lf, l0));
    if (dl < 0) tau *= 1 + 7 * meso;
    var k = (1 - Math.exp(-Math.max(dt, 0) * fs / tau)) * (0.25 + 0.75 * sstep(0.035, 0.1, Math.abs(dl)));
    var l = l0 + dl * k;
    if (num(opt.speed, 0) > 60) l = clamp(l, lf - 0.3 * LN2, lf + 0.3 * LN2);
    return Math.exp(l);
  };
  // 整个眼 pass 的状态推进（不含日光与测光的取样）：prev＝null 表示跳变。
  //   o：{dt, dtSim（秒）, LaFrame, Eh（klux）, tanHalf}；返回 {La, lnF, lnEhA, lnEhS, key, expo, LaEq, target}
  E.eyeStep = function (prev, o, cfg) {
    var dt = Math.max(num(o.dt, 0), 0), speed = num(o.dtSim, 0) / Math.max(dt, 1e-4), fs = Math.sqrt(Math.max(1, speed / 60));
    var Lenv = E.envL(o.Eh), lnT = Math.log(E.mixTarget(o.LaFrame, Lenv, o.tanHalf)), lnEhNow = Math.log(Math.max(o.Eh, 1e-9) * 1000);
    var r = {};
    if (!prev) { r.lnF = lnT; r.La = clamp(Math.exp(lnT), E.LA_MIN, E.LA_MAX); r.lnEhA = lnEhNow; r.lnEhS = lnEhNow; }
    else {
      r.lnEhS = prev.lnEhS + (lnEhNow - prev.lnEhS) * (1 - Math.exp(-dt * fs / 2));
      r.lnF = prev.lnF + (lnT - prev.lnF) * (1 - Math.exp(-dt * fs / E.TAU_PRE));
      var env = Math.abs(lnEhNow - r.lnEhS) > 0.15;
      r.La = clamp(E.adapt(prev.La, Math.exp(r.lnF), dt, { env: env, speed: speed }), E.LA_MIN, E.LA_MAX);
      var meso = 1 - sstep(Math.log(0.003), Math.log(3), Math.min(r.lnF, Math.log(prev.La)));
      var tauE = lnEhNow > prev.lnEhA ? 0.6 : 3 * (1 + 7 * meso);
      r.lnEhA = prev.lnEhA + (lnEhNow - prev.lnEhA) * (1 - Math.exp(-dt * fs / tauE));
      if (speed > 60) r.lnEhA = clamp(r.lnEhA, lnEhNow - 0.3 * LN2, lnEhNow + 0.3 * LN2);
    }
    r.key = E.key(Math.exp(r.lnEhA));
    r.expo = E.exposure(r.La, cfg, r.key);
    r.LaEq = E.laEq(r.La, r.key);
    r.target = Math.exp(r.lnF);
    return r;
  };
  // 每 kn 的曝光（场景单位 kn＝1000 cd/m²）：自动＝key/La·2^补偿；固定 EV＝0.18/(2^EV·0.125)（与读数同一口径，测光表 K＝12.5）
  E.exposure = function (La, cfg, key) {
    cfg = cfg || {};
    var auto = cfg.auto !== false;
    return (auto ? num(key, 0.18) / La * Math.pow(2, num(cfg.evComp, 0)) : 0.18 / (Math.pow(2, num(cfg.evLock, 12)) * 0.125)) * 1000;
  };
  E.laEq = function (La, key) { return La * 0.18 / num(key, 0.18); };          // 读数的 EV 用它：锁在读数上，画面不变
  E.ev = function (La) { return La > 0 ? Math.log(La * 100 / 12.5) / LN2 : NaN; };   // 与 fp/settings.js 的 S.ev 同式
  // 测光格的一个样本：截到适应亮度 ±5 EV
  E.meterClamp = function (L, La) { var lp = Math.log(clamp(La, E.LA_MIN, E.LA_MAX)); return clamp(Math.log(Math.max(L, 1e-4)), lp - 3.4657, lp + 3.4657); };
  // 望远时的眼角度放大倍数（视角 70° 以下）
  E.magnify = function (tanHalf) { return Math.max(1, 0.70021 / Math.max(num(tanHalf, 0.70021), 1e-4)); };
  // 失能眩光的光幕（kn；E 以 klux 计）：10·E/θ²，θ＝眼角度，0.3° 截平，20–40° 淡出
  E.glare = function (Eklux, thDeg, k, tanHalf) {
    var th = Math.max(thDeg * E.magnify(tanHalf), 0.3);
    return num(k, 1) * 10 * Eklux / (th * th) * (1 - sstep(20, 40, th));
  };
  E.veil = function (Eklux, thDeg, k, tanHalf) { return E.glare(Eklux, thDeg, k, tanHalf) * 1000; };   // cd/m²（meter.frag）

  /* ───────── 最终（final.frag 的 JS 镜像） ───────── */
  // GLSL 的 mat3(a…i) 按列填：m*v＝v.x·列0＋v.y·列1＋v.z·列2
  function mvCol(m, v) { return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]; }
  function mvRow(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  E.mvCol = mvCol; E.mvRow = mvRow;
  var AGX_IN = [0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104];
  var AGX_OUT = [1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116];
  E.AGX_LOOK = { kl: 1.0, kh: 1.5, d: 0.03, sat: 1.05 };             // 对比 look：中灰以上拉开 1.5 倍、以下不动（±0.12 内平滑过渡），下移 0.03；饱和度 ×1.05
  function agxPoly(x) { var x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
  function agxCore(c, look) {
    var v = mvCol(AGX_IN, [Math.max(c[0], 1e-10), Math.max(c[1], 1e-10), Math.max(c[2], 1e-10)]), o = [0, 0, 0], i, x0 = 10 / 16.5;
    for (i = 0; i < 3; i++) {
      var x = (Math.log2(v[i]) + 12.47393) / 16.5;
      if (look) x = x0 + (x - x0) * (look.kl + (look.kh - look.kl) * sstep(x0 - 0.12, x0 + 0.12, x)) - look.d;
      o[i] = agxPoly(clamp(x, 0, 1));
    }
    if (look) { var y = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2]; o = o.map(function (q) { return Math.max(y + look.sat * (q - y), 0); }); }
    o = mvCol(AGX_OUT, o);
    return [Math.pow(Math.max(o[0], 0), 2.2), Math.pow(Math.max(o[1], 0), 2.2), Math.pow(Math.max(o[2], 0), 2.2)];
  }
  E.agx = function (c) { return agxCore(c, E.AGX_LOOK); };
  E.agxBase = function (c) { return agxCore(c, null); };
  var ACES_IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  var ACES_OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  E.aces = function (c) {
    var v = mvCol(ACES_IN, c), i;
    for (i = 0; i < 3; i++) v[i] = (v[i] * (v[i] + 0.0245786) - 0.000090537) / (v[i] * (0.983729 * v[i] + 0.4329510) + 0.238081);
    v = mvCol(ACES_OUT, v);
    return [clamp(v[0], 0, 1), clamp(v[1], 0, 1), clamp(v[2], 0, 1)];
  };
  E.srgb = function (c) { return c.map(function (x) { return x < 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }); };
  // 暗视觉的混合强度：适应亮度 3 → 0.003 cd/m² 按对数从 0 过渡到 1（02 第十四节第 4 条）
  E.scotopicK = function (La, on) {
    if (on === 0 || on === false) return 0;
    var x = Math.log(Math.max(La, 1e-6)), a = Math.log(0.003), b = Math.log(3);
    return (on == null ? 1 : +on) * (1 - sstep(a, b, x));
  };
  var M_XYZ = [0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505];   // 列优先（与 final.frag 相同）
  E.V_WHITE = 2.573;                                                  // D65 白的 V/Y
  E.scotopic = function (c, s) {
    if (!(s > 0)) return c.slice();
    var xyz = mvCol(M_XYZ, c), V = Math.max(xyz[1] * (1.33 * (1 + (xyz[1] + xyz[2]) / Math.max(xyz[0], 1e-6)) - 1.68), 0) / E.V_WHITE;
    var t = [V * 0.82 * 0.93, V * 0.92 * 0.93, V * 1.15 * 0.93], k = s * 0.85;
    return [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k];
  };
  // 局部适应：局部平均亮度（cd/m²）比适应亮度 La 暗 d 时提 35%·d，最多 2 EV 的份（以 La 为轴：平视与低头时同一片地补得一样多；亮处不压）
  E.LOC_W = 0.35; E.LOC_EV = 2;
  E.localGain = function (LlocCd, La) {
    var d = clamp(Math.log(Math.max(LlocCd, 1e-6) / Math.max(La, 1e-6)), -E.LOC_EV * LN2, 0);
    return Math.exp(-E.LOC_W * d);
  };
  E.SUN_TINT = [1.104, 0.978, 0.919];                                 // 大气外日色（只作对照：眩光已改用到眼日光的实际颜色）
  // 整条最终链（不含 Catmull–Rom 放大与抖动）：o.hdr＝TAA 结果（乘旧曝光），o.bloom＝金字塔第 0 级，o.eN／o.eP＝新／旧眼纹素 0（[曝光, La, E_eye klux]），
  //   o.Ergb＝到眼日光颜色（klux，eye 纹素 2；缺省按大气外日色×E_eye），o.bloomLoc＝局部适应的 3×3 宽样本之和、o.levels 金字塔级数、
  //   o.th 到日面的屏幕角（度），o.tanHalf；o.bloomLoc 缺省不做局部适应
  E.finalPixel = function (o) {
    var r = o.eN[0] / o.eP[0], c = [0, 0, 0], i;
    for (i = 0; i < 3; i++) c[i] = (o.hdr[i] + num(o.bloomK, 0) * (o.bloom ? o.bloom[i] : 0)) * r;
    if (o.bloomLoc) {
      var bl = o.bloomLoc, Lloc = Math.max((0.2126 * bl[0] + 0.7152 * bl[1] + 0.0722 * bl[2]) / (9 * num(o.levels, 5)) * r / Math.max(o.eN[0], 1e-30) * 1000, 1e-6);
      var g = E.localGain(Lloc, o.eN[1]);
      for (i = 0; i < 3; i++) c[i] *= g;
    }
    var Ergb = o.Ergb || E.SUN_TINT.map(function (q) { return q * num(o.eN[2], 0); });
    var gk = E.glare(1, num(o.th, 180), o.glareK, o.tanHalf) * o.eN[0];
    for (i = 0; i < 3; i++) c[i] += gk * Math.max(Ergb[i], 0);
    if (o.cat) c = mvRow(o.cat, c);
    c = E.scotopic(c, E.scotopicK(o.eN[1], o.purkinje == null ? 1 : o.purkinje));
    return E.srgb(o.tone === 'aces' ? E.aces(c) : E.agx(c));
  };

  /* ───────── 拍照累积的进度 ───────── */
  var acc = { frame: -1, n: 0, still: false, frames: 0, of: 16, tier: null };
  function accumOf(tier) { var o = ps && ps.TIER_OPTS && ps.TIER_OPTS[tier]; return num(o && o.accum, 16); }
  function live() {
    var g = fp._graph ? fp._graph() : null;
    if (!g || !fp.status || fp.status().phase !== 'ready' || !HY.app || !HY.app.active || HY.app.active() !== 'fp') return null;
    return g;
  }
  // 每帧一次（以帧图的帧号去重）：按 uBlend 推一个“典型像素”的 n（与 eye_taa.frag 同一递推）
  function track() {
    var g = live();
    if (!g) { acc.frame = -1; acc.n = 0; acc.still = false; acc.frames = 0; return null; }
    if (g.frame === acc.frame) return g;
    acc.frame = g.frame; acc.tier = g.tier; acc.of = accumOf(g.tier);
    var u = fp.uniformValues ? fp.uniformValues(['uBlend']) : null, b = u ? num(u.uBlend, 1) : 1;
    acc.still = T.isStill(b, acc.of);
    acc.frames = acc.still ? acc.frames + 1 : 0;
    acc.n = T.step(acc.n, b, true, acc.of).n;
    return g;
  }
  E._track = track;
  var offFrame = null;
  function listen() { if (!offFrame && HY.bus && HY.bus.on) offFrame = HY.bus.on('frame', function () { track(); }); }
  listen();
  E.accum = function () {
    listen(); track();
    return { still: acc.still, n: Math.round(acc.n), of: acc.of, done: acc.still && acc.n >= acc.of - 1e-6, frames: acc.frames, tier: acc.tier };
  };

  /* ───────── 出一张 ─────────
   * 只在第一人称、时间暂停时（opts.pause＝真则先暂停）。等画面静止并累积满 TAA_ACCUM 帧，在出完那一帧的同一个任务里
   * 从画布取 PNG（渲染器没开 preserveDrawingBuffer，过了这一帧画布就清了）。界面上的 HUD 是 DOM，不在图里。
   * 下雨或有余息飘尘时帧图不做拍照累积（雨丝按真实时间落，累积会糊成一层雾）：相机与时间都不动满 max(TAA_ACCUM, 20) 帧后
   * 照样取一张，结果里 falling＝真、n 是平时的等效样本数。 */
  function poseKey() { var p = fp.pose ? fp.pose() : null; return p ? [p.s, p.az, p.yaw, p.pitch, p.fov, p.alt].join(',') : ''; }
  E.shoot = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!live()) { reject(new Error('先进入第一人称')); return; }
      var S = HY.state;
      if (S.time.playing) {
        if (opts.pause) HY.app.play(false);
        else { reject(new Error('先暂停时间：拍照要静止的画面')); return; }
      }
      var t0 = HY.util && HY.util.now ? HY.util.now() : Date.now(), limit = num(opts.timeout, 30000), off = null, done = false, calm = 0, last = null;
      function finish(err, v) { if (done) return; done = true; if (off) off(); if (err) reject(err); else resolve(v); }
      off = HY.bus.on('frame', function () {
        var g = track();
        if (!g) { finish(new Error('离开了第一人称')); return; }
        var pk = poseKey();
        calm = !HY.state.time.playing && pk === last ? calm + 1 : 0; last = pk;
        var full = acc.still && acc.n >= acc.of - 1e-6, falling = !acc.still && calm >= Math.max(acc.of, 20);
        if (full || falling) {
          var cv = HY.gfx && HY.gfx.canvas, url = null;
          try { url = cv.toDataURL(opts.type || 'image/png'); } catch (e) { finish(new Error('画布取不出图：' + (e && e.message || e))); return; }
          finish(null, { url: url, w: cv.width, h: cv.height, n: Math.round(acc.n), of: acc.of, tier: g.tier, t: HY.state.time.t, falling: falling });
          return;
        }
        var t = HY.util && HY.util.now ? HY.util.now() : Date.now();
        if (t - t0 > limit) finish(new Error('等了 ' + Math.round(limit / 1000) + ' 秒画面还没静下来（相机或时间在动）'));
      });
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
