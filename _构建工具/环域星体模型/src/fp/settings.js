/* HY.fp.set —— state.fp.*、zones、astro → uniform／define／“哪些东西要重建”（规格：spec/03 第七节第 5 条、spec/02 第七节、第十五节、附录 A）
 * 负责：E 路（第一人称·管线）。节点可测（test/settings_check.js）：不依赖 THREE，只产出普通数值对象，由 fp.js 用 HY.fp.apply(U, vals, 'set') 写入。
 *
 * 接口：
 *   values(state, P, t?, camMode?, tier?) → 写入方为 'set' 的全部 uniform（t 省略取 state.time.t；uYuxi、uWind、uJetPhase 按 t 算；
 *                                     tier＝帧图实际在用的档位，省略取 state.fp.quality，只影响 uBloomK）
 *   perFrame(state, P, t, dtSim, camMode?) → 每帧变的：uYuxi、uWind、uJetPhase、uGroundMode
 *                                     （camMode＝相机此刻实际的地面模式 1 阶地／0 斜坡；纬度＜2° 时相机自动按斜坡，GPU 必须跟它一致）
 *   apply(state, P, U, changed?, tier?) → 写 U，返回 {lut, weather, world, horizon, inst, reset, recam, recompile:[pass…], first}
 *                                     （changed 省略＝与上一次 apply 比对；第一次全部为真）
 *   defines(state, pass)            → 该 pass 的额外宏（目前只有 final 的 TONE_ACES）
 *   bakeHour(t) / jetPhase(state,t) → 天气图烘焙的模拟小时与急流相位（passes 与本文件同一口径）
 *   yuxi(state, P, t)               → [消光, 前锋 s, 标高, 前锋宽]
 *   groundMode(state, P, camMode?)  → uGroundMode 的值
 *   rainK(state, P, X, tReal, t)    → rain pass 的 uRainK：[雨 0–2, 余息飘尘 0–1, 真实秒, 可能下雨 0/1]；X＝相机地固位置
 *   catMatrix(rgb, k)               → 照明色适应（Bradford，目标 D65＝sRGB 白）的 3×3，行优先；rgb＝照明色度，k＝强度
 *   unpackChroma(pk) / eyeState(La) / ev(La) → 眼 pass 读回的解码与 HUD 文字
 *
 * 统筹修订：
 *   · 夜默认如实画“白夜”：uVeilK ＝ fp.set.veil ? fp.set.veilK / 1000 : 0（veilK 单位 /千公里，uniform 单位 /km）。
 *   · 地面默认阶地：uGroundMode ＝ fp.ground.mode === 'slope' ? 0 : 1。
 * E 路新增、写入方为 'set' 的 uniform：uEyeCfg（眼：自动／固定 EV、EV 补偿、色适应强度）、uAbyssFog（深渊雾开关）——
 *   登记在 fp/passes.js（契约测试只载 uniforms＋passes），本文件只写值。
 * 不在这里的：fp.set.dayComp（昼光补偿）乘进 uSunI，那是 cel 写的（fp/celestial.js 收到 settings＝state.fp 自己乘）；
 *   fp.ground.amp（起伏倍率）进 uAmpZone，那是 cam 写的（fp/ground.js 的 limits）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  fp.set = fp.set || {};
  var S = fp.set;

  var BETA_R = [5.802e-3, 13.558e-3, 33.1e-3];               // 壁面处瑞利散射 /km（02 第七节第 1 条）
  var ACID_TINT = [1.0, 0.86, 0.52];
  S.BETA_R = BETA_R;
  S.YUXI = { ext: 0.02, s0: 1500, s1: 7000, H: 3, width: 300, rampIn: 2, fadeOut: 5 };   // 02 第七节第 9 条
  S.WIND = { kmPerDay: 864, wrap: 1000, jetRadPerHour: 0.01 };                         // 10 m/s；噪声平移按 1000 取模（三种取样倍率都是整周期）

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function sstep(a, b, x) { var u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function getP(P) { return P || (HY.model && HY.model.P) || (HY.astro && HY.astro.params()) || { R: 6371, a: 600, gEq: 1.4, Y: 360 }; }

  // 大气顶：min(10·max(H_R, H_M), 800)
  S.ztop = function (HR, HM) { return Math.min(10 * Math.max(HR, HM), 800); };
  // 米氏散射、吸收（壁面处，/km）：消光 3.912/V − β_R,绿，单次反照 0.9；V 超过纯瑞利极限时为 0
  S.mie = function (V) { var e = Math.max(3.912 / V - BETA_R[1], 0); return { ms: 0.9 * e, ma: 0.1 * e }; };

  /* ───────── 天气、风、余息（按模拟时刻） ───────── */
  // 天气图烘焙时刻（模拟小时，按 1/BAKE_PER_HOUR 小时取整）：passes 在它变了时重烘焙，uBakeTime＝它×风速倍率。
  // 急流差速相位：两次烘焙之间按距上次烘焙的时长推（weatherAt 里 uv.x 再挪 phase·sin(9y)/2π），与 bake_weather 里
  //   气旋的 0.01·uBakeTime 同一速率，每次烘焙归零——02 原式让相位无限增长，几天后各纬带的云被剪成细丝、远年份更是乱码。
  //   归零的代价：底图 fbm 在烘焙时刻跳回 rate·间隔 的经度。整小时一烘时这一跳约 0.01 rad（罪域一带 55 km，天气图 1.6 个纹素），
  //   快进时一秒一次、看得出云在抖；改成每 10 模拟分钟一烘，一跳只剩约 9 km（不到 0.3 个纹素），烘焙一次约 2 ms（E 路对 02 第十节第 1 条）
  S.BAKE_PER_HOUR = 6;
  S.bakeHour = function (t) { return Math.floor(t * 24 * S.BAKE_PER_HOUR) / S.BAKE_PER_HOUR; };
  S.bakeTime = function (state, t) { return S.bakeHour(t) * num(state.fp.cloud.wind, 1); };
  S.jetPhase = function (state, t) { return S.WIND.jetRadPerHour * num(state.fp.cloud.wind, 1) * Math.max(0, t * 24 - S.bakeHour(t)); };
  // 风场平移（噪声坐标）：平移 D km ↔ uWind＝D/0.48（云形 P/24＋uWind·0.02）；各分量按 1000 取模，三种倍率（0.02、0.08、0.001）都是整周期
  var WDIR = (function () { var v = [1, 0.15, 0.5], l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  S.wind = function (state, t) {
    var D = S.WIND.kmPerDay * num(state.fp.cloud.wind, 1) * t / 0.48;
    return [mod(WDIR[0] * D, S.WIND.wrap), mod(WDIR[1] * D, S.WIND.wrap), mod(WDIR[2] * D, S.WIND.wrap)];
  };
  // 余息：入冬前 yuxiLead 日起，前锋从塔根外 1500 km 推到 7000 km；入冬后 5 日淡出
  S.yuxi = function (state, P, t) {
    P = getP(P);
    var y = S.YUXI, mode = state.fp.set.yuxi, L = Math.max(1, num(state.fp.set.yuxiLead, 45)), Y = P.Y || 360;
    var before = Y * Math.ceil(t / Y) - t, after = t - Y * Math.floor(t / Y);
    var k = 0, front = y.s1;
    if (mode === 'off') return [0, front, y.H, y.width];
    if (before <= L) { front = y.s0 + (y.s1 - y.s0) * (1 - before / L); k = sstep(L, L - y.rampIn, before); }
    else if (after < y.fadeOut) { k = 1 - after / y.fadeOut; }
    if (mode === 'on') k = 1;
    return [y.ext * k, front, y.H, y.width];
  };

  /* ───────── 状态 → 'set' 的全部 uniform ───────── */
  // 实际地面模式：选了斜坡，或相机所在纬度 < 2°（阶地自然消失，相机按斜坡算）都写 0
  S.groundMode = function (state, P, camMode) {
    if (camMode === 0 || camMode === 1) return camMode;
    var g = state.fp.ground;
    if (fp.cam && typeof fp.cam.groundMode === 'function' && state.site) return fp.cam.groundMode(getP(P), state.site.s, g.mode);
    return g.mode === 'slope' ? 0 : 1;
  };

  // tier（可省）＝帧图此刻实际在用的档位：启动时先编“低”档、后台换档没编完时，它与 state.fp.quality 不同，
  //   眩光金字塔的级数要跟实际在画的走（uBloomK 按级数归一）
  S.values = function (state, P, t, camMode, tier) {
    P = getP(P);
    var f = state.fp, a = f.atmo, c = f.cloud, g = f.ground, s = f.set, e = f.eyeo, z = state.zones;
    if (t == null) t = state.time ? state.time.t : 0;
    var on = a.on ? 1 : 0, HR = num(a.HR, 40), HM = num(a.HM, 6), mie = S.mie(num(a.V, 200));
    var cOn = c.on ? 1 : 0;
    var TO = fp.passes && fp.passes.TIER_OPTS;
    tier = (TO && (TO[tier] || TO[f.quality])) || null;
    var levels = tier && tier.bloomLevels ? tier.bloomLevels : 5;
    var o = {
      uR: P.R, uA: P.a, uZtop: S.ztop(HR, HM),
      uAtmoOn: on,
      uBetaR: [BETA_R[0] * on, BETA_R[1] * on, BETA_R[2] * on],
      uBetaMs: mie.ms * on, uBetaMa: mie.ma * on,
      uHR: HR, uHM: HM, uMieG: num(a.g, 0.76),
      uVeilK: s.veil ? num(s.veilK, 0.3) / 1000 : 0,
      uRainBeta: cOn * on * num(c.rain, 0.03),
      uAcid: [num(s.acidExt, 0.02), num(s.acidOmega, 0.8), 1.5, s.acid && on ? 1 : 0],
      uAcidTint: ACID_TINT.slice(),
      uYuxi: S.yuxi(state, P, t).map(function (v, i) { return i === 0 ? v * on : v; }),
      uSheath: [num(s.sheathN0, 0), num(s.sheathHt, 20)],
      uTowerAlb: num(s.towerAlb, 0),
      uGroundMode: S.groundMode(state, P, camMode),
      uW: num(g.W, 1.5), uCliffC: num(g.cliff, 0.07), uResid: num(g.resid, 0), uWig: num(g.wig, 0.35), uJit: num(g.jit, 0.07),
      uAbyssDepth: num(g.abyssDepth, 30), uAbyssHalf: num(g.abyssHalf, 220), uAbyssFog: g.abyssFog ? 1 : 0,
      uLimboKm: num(z.limboKm, 333), uGEq: P.gEq, uGLight: num(z.gLight, 0.75), uGHeavy: num(z.gHeavy, 1.2),
      uWet: num(g.wet, 0.7),
      uCloudOn: cOn, uCloudCov: num(c.cover, 0.42), uCloudBase: num(c.base, 1.5), uCloudTop: num(c.top, 6.5), uCloudSigma: num(c.sigma, 22),
      uRuiOvc: num(c.rui, 1), uRuiBase: num(c.ruiBase, 1.2), uRuiTop: num(c.ruiTop, 6), uRuiTau: num(c.ruiTau, 60),
      uWind: S.wind(state, t), uJetPhase: S.jetPhase(state, t),
      uGlareK: num(e.glare, 1), uPurkinje: e.scotopic ? 1 : 0,
      uBloomK: 0.03 * num(e.glare, 1) / levels,                 // 金字塔各级相加后归一（02 第十四节第 5 条：权重 0.02–0.04）
      uEyeCfg: [e.auto ? 1 : 0, num(e.evLock, 12), num(e.evComp, 0), num(e.cat, 0.7)]
    };
    return o;
  };

  S.perFrame = function (state, P, t, dtSim, camMode) {
    var on = state.fp.atmo.on ? 1 : 0, y = S.yuxi(state, P, t);
    y[0] *= on;
    return { uYuxi: y, uWind: S.wind(state, t), uJetPhase: S.jetPhase(state, t), uGroundMode: S.groundMode(state, P, camMode) };
  };

  /* ───────── 屏幕雨丝与余息飘尘（rain pass 的 uRainK） ───────── */
  // 雨：罪域阴云下（云开、大气开）按 ruiW×阴云强度×雨雾消光/0.03；余息：相机在前锋以内时按强度
  S.rainK = function (state, P, X, tReal, t) {
    P = getP(P);
    var f = state.fp, c = f.cloud, on = f.atmo.on && c.on, out = [0, 0, (tReal || 0) % 3600, 0];
    if (!X) return out;
    var L = Math.sqrt(X[0] * X[0] + X[1] * X[1] + X[2] * X[2]) || 1;
    if (on && c.rain > 0) out[3] = 1;   // clouds 路：w＝“可能下雨”（雨丝哪里下由 rain.frag 读云影图的雨量；x 只管罪域里帧图不累积）
    if (on && c.rain > 0 && c.rui > 0) {
      var rc = fp.cel && fp.cel.ruiCenter ? fp.cel.ruiCenter(P) : null;
      if (rc) {
        var rad = (fp.cel && fp.cel.RUI_RAD) || 900, cc = (X[0] * rc[0] + X[1] * rc[1] + X[2] * rc[2]) / L;
        var rw = sstep(Math.cos(rad / P.R), Math.cos(0.75 * rad / P.R), cc) * c.rui;
        out[0] = Math.min(2, rw * c.rain / 0.03);
      }
    }
    if (f.atmo.on) {
      var y = S.yuxi(state, P, t == null ? state.time.t : t);
      if (y[0] > 0) {
        var sG = P.R * Math.atan2(Math.sqrt(X[0] * X[0] + X[2] * X[2]), -X[1]);
        out[1] = Math.min(1, y[0] / S.YUXI.ext) * (1 - sstep(y[1] - y[3], y[1], sG));
      }
    }
    return out;
  };

  /* ───────── 眼：读回解码、色适应矩阵、HUD 文字 ───────── */
  // 眼 pass 把照明色的 r、g 色度各量化成 12 位打包进一个浮点（4095·4096＋4095 < 2²⁴，float32 精确）
  S.unpackChroma = function (pk) {
    if (!(pk >= 4096)) return [1 / 3, 1 / 3, 1 / 3];
    var r = Math.floor(pk / 4096) / 4095, g = (pk - Math.floor(pk / 4096) * 4096) / 4095;
    return [r, g, Math.max(0, 1 - r - g)];
  };
  var M_RGB2XYZ = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505];
  var M_XYZ2RGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];
  var M_BFD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  var M_BFD_I = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function mm(A, B) {
    var o = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) o[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return o;
  }
  S.mm = mm; S.mv = mv;
  // 照明色 rgb（线性 sRGB，任意比例）→ 把它拉向 D65 白的矩阵（行优先，rgb→rgb）；k＝强度 0–1（02 第十四节第 3 条：0.7）
  S.catMatrix = function (rgb, k) {
    k = Math.max(0, Math.min(1, num(k, 0.7)));
    var s = (rgb && rgb[0] + rgb[1] + rgb[2]) || 0;
    if (!(s > 1e-9) || k <= 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var src = mv(M_RGB2XYZ, rgb), dst = mv(M_RGB2XYZ, [1, 1, 1]);
    var ys = src[1] > 1e-9 ? src[1] : 1;
    src = [src[0] / ys, 1, src[2] / ys];
    var cs = mv(M_BFD, src), cd = mv(M_BFD, dst), D = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 3; i++) { var gn = cs[i] > 1e-6 ? cd[i] / cs[i] : 1; D[4 * i] = 1 + k * (Math.max(0.1, Math.min(10, gn)) - 1); }
    return mm(M_XYZ2RGB, mm(M_BFD_I, mm(D, mm(M_BFD, M_RGB2XYZ))));
  };
  // 人眼状态：适应亮度 ≥3 cd/m² 明视；≤0.005 暗视；之间中间视（02 第十四节第 4 条的过渡区间）
  S.eyeState = function (La) { return !(La > 0) ? '明视' : La >= 3 ? '明视' : La > 0.005 ? '中间视' : '暗视'; };
  // 亮度 → EV（ISO 100，K＝12.5）
  S.ev = function (La) { return La > 0 ? Math.log(La * 100 / 12.5) / Math.LN2 : NaN; };

  /* ───────── 状态变化 → 重建标志（03 第七节第 5 条） ───────── */
  // 每组一个签名；签名变了就置对应标志
  function sig(state, P) {
    var f = state.fp, c = f.cloud;
    return {
      atmo: JSON.stringify([f.atmo, P.R]),
      weather: JSON.stringify([c.cover, c.rui, c.ruiBase, c.ruiTop, c.ruiTau, c.on]),
      ground: JSON.stringify([f.ground, P.R, P.a]),
      zones: JSON.stringify([state.zones, P.R, P.gEq]),
      astro: JSON.stringify([P.R, P.a, P.gEq, P.dS, P.A, P.rhoS, P.rhoM, P.rM, P.Eref, P.pMoon]),
      tone: f.eyeo.tone,
      setting: JSON.stringify(f.set)
    };
  }
  var lastSig = (typeof WeakMap === 'function') ? new WeakMap() : null, lastAny = null;
  function getLast(U) { return U && lastSig ? lastSig.get(U) : lastAny; }
  function putLast(U, v) { if (U && lastSig) lastSig.set(U, v); else lastAny = v; }

  S.flagsFor = function (prev, cur) {
    var r = { lut: false, weather: false, world: false, horizon: false, inst: false, reset: false, recam: false, recompile: [], first: !prev };
    if (!prev) { r.lut = r.weather = r.world = r.horizon = r.inst = r.reset = true; r.recompile = []; return r; }
    if (prev.atmo !== cur.atmo) { r.lut = true; r.reset = true; }
    if (prev.weather !== cur.weather) r.weather = true;
    if (prev.ground !== cur.ground) { r.horizon = true; r.inst = true; r.recam = true; r.reset = true; }
    if (prev.zones !== cur.zones) { r.world = true; r.horizon = true; r.inst = true; }
    if (prev.astro !== cur.astro) { r.world = true; r.horizon = true; r.reset = true; }
    if (prev.setting !== cur.setting) r.reset = true;
    if (prev.tone !== cur.tone) r.recompile.push('final');
    return r;
  };

  S.apply = function (state, P, U, changed, tier) {
    P = getP(P);
    var vals = S.values(state, P, null, undefined, tier);
    if (U && fp.apply) fp.apply(U, vals, 'set');
    var cur = sig(state, P), prev = getLast(U);
    putLast(U, cur);
    var r = S.flagsFor(prev, cur);
    // changed（路径数组）只用来补签名比不出的情况（例如外部强制重算）
    if (changed && changed.length && prev) {
      changed.forEach(function (p) {
        if (/^fp\.atmo\b/.test(p)) { r.lut = true; r.reset = true; }
        else if (/^fp\.cloud\.(cover|rui)/.test(p)) r.weather = true;
        else if (/^fp\.ground\b/.test(p)) { r.horizon = r.inst = r.recam = true; }
        else if (/^zones\b/.test(p)) { r.world = r.horizon = true; }
        else if (p === 'fp.eyeo.tone' && r.recompile.indexOf('final') < 0) r.recompile.push('final');
      });
    }
    r.values = vals;
    return r;
  };
  S.forget = function (U) { if (U && lastSig) lastSig.delete(U); else lastAny = null; };

  // 额外宏：final 的色调（AgX 默认；ACES 对照）
  S.defines = function (state, pass) {
    var o = {};
    if (pass === 'final' && state && state.fp && state.fp.eyeo.tone === 'aces') o.TONE_ACES = 1;
    return o;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
