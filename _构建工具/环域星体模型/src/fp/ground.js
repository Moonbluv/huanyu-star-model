/* HY.fp.ground —— 地面高度函数的 JS 镜像（层表、阶地量化、蜿蜒、扶壁、深渊沟），两种地面模式
 * 规格：spec/02 第三节第 3–4 条、第五节、第八节第 1–4、7 条。负责：F 路（第一人称·地面）。
 * 节点可测（test/terrace_geom.js、chart_slide.js、inst_grid.js）：不碰 DOM、THREE。双精度；高度图纹素按半精度（向零截断）取值，
 *   双线性一律精确插值。GPU 上像素足迹 < 2 m 时也用手工双线性（terrain_lib.glsl 的 layerTexHQ），远处用硬件过滤；
 *   浏览器实测近处 GPU 与本镜像的离地高度相差 ≤5 cm（test/render_fp.js“第一人称·地面”），碰撞只要 0.3 m。
 *
 * 对 02 原式的几处修正（GLSL 与本镜像同改）：dispFine 的停读间隙用 base＋F.x 并加 2 m（相机处不停读，alt(0) 严格＝眼高）；
 *   相机脚下 r_q 扣掉深渊沟；groundPoint 读全部细层（gFull）一次落地；低频两层与近处各层手工双线性；
 *   duDt 补上 ∂u/∂P（第 0、1 层把阶地整片抬起时相位也跟着变；原式漏了，截步会跨过崖带）。
 *
 * 统筹修订：默认地面＝阶地（踏面宽 W 固定，平均崖高＝W·tan 纬度）；可切“顺着球面的斜坡”（state.fp.ground.mode＝'slope'）。
 *
 * 2026-10 地面写实化（GLSL 与本镜像同改）：阶地剖面逐级随机（级高 ±0.3 级、崖带宽、倒石坡）、崖面分 4 个厚薄不一的子台阶（崖面＋台坎）、
 *   冲沟（第 3 层过零处的窄缺口，并进扶壁层 b̃）；深渊沟改成沟沿以内 10 km 的陡壁。见 terrain_lib.glsl 的 terraceP 注释。
 *   这些都乘“起伏倍率”系数 rel＝sat(uAmpZone/0.7)（倍率 0＝旧的整齐台阶）。
 *
 * 与着色器一一对应（改一边必须改另一边）：
 *   layerTex / foot          ↔ common.glsl 的 layerTex、foot.frag
 *   chartD / dRxz / dRho     ↔ common.glsl 的 chartD、dRxz、dRho（斜坡分支按“北为正”的正确符号，见下方注）
 *   trench / Sg / SgD        ↔ common.glsl trench、terrain_lib.glsl Sg、SgD
 *   dispFine / altAt         ↔ terrain_lib.glsl dispFine、altAt（相机相对差分写法）
 *   chartToV / groundPoint   ↔ terrain_lib.glsl chartPoint、groundPoint
 *   chartGrad / duDt / terrainNormal ↔ common.glsl chartGrad、terrain_lib.glsl duDt、terrainNormal（duDt 补了 02 原式漏掉的 ∂u/∂P 项）
 * 这些函数的第一个参数 S 是“uniform 取值表”：键与 GLSL 的 uniform 同名（uR uCamW uCamK uCamRho uRsC uCamAlt uTerF0 uOrg
 *   uRref uAmpZone uW uCliffC uResid uWig uJit uAbyssDepth uAbyssHalf uGroundMode），另带 F＝脚下 [d_f, w, b, P]（省略时现算）。
 *   可以直接把 HY.fp.cam 的 compute() 结果与 HY.fp.set.values() 合起来传进来，也可以用 makeState() 从地点现造一份。
 *
 * 绝对量（相机、碰撞用）：groundAbs(GS, y, phi) → 阶地：地面离轴半径 rg、相位 f、级 k；斜坡：脚点离球心距离 rad。
 *   GS＝{R, mode, W, cliff, resid, wig, jit, abyssDepth, abyssHalf, amp, Rref}。
 *
 * 对外：
 *   altAt(S, v|dc, foot, lod) → 离地高度 km（v 为 CM 系相对相机的位移；传二维 dc 时取“与相机同高、图表上挪 dc”的点）
 *   terraceLevel(y, W, wig, jit, w, b, c, sigma) → {k, f, u, Yq}      layerParams(zone) → {amp, A, L}
 *   limits(info) → {uAmpZone, uLip, uClearMax, uHc}                   foot(org, amp, mode) → [d_f, w, b, P]
 *   camChart(cam|info, R) → 相机图表坐标 [东, 北]（与 fp.js 的 chartOf、camera.js 写 uOrg 的口径相同）
 *   groundPoint(S, dc) → 地面点（相对相机）   duDt(S, v, d) → 阶地相位的方向导数 /km   terrainNormal(S, v, foot) → 单位法线
 *   tTerFar(S, cd) → 地形求交的远界（相机在内壁球面之外也有效）   aoScan(S, v) → 高档的 8 方向扫描遮蔽（horizon.frag 第 0 级 B 通道）
 * 地平线角图的排程（级中心、何时重烘）在 fp/passes.js（ps.hzDue、ps.HZ_HALF），着色器 horizon.frag 与查用 shadow.glsl 在本路。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  fp.ground = fp.ground || {};
  var g = fp.ground;
  var PI = Math.PI, D2R = PI / 180, R2D = 180 / PI;

  g.__stubs = [];
  // 层表（02 第八节第 1 条），与 common.glsl 的 LAY_L、LAY_A 一致
  g.LAY_L = [60.0, 6.0, 1.1, 0.2, 0.035, 0.006, 15.0];
  g.LAY_A = [1.2, 0.32, 0.085, 0.018, 0.0032, 0.0007, 0.0];
  g.ZONE_AMP = { light: 1.6, plain: 0.7, heavy: 1.0, rui: 1.25, limbo: 0.4, tower: 1.6 };
  g.TILE = 32;
  g.W_MAX = 20;                 // 02 第五节：uHc ≤ W_max·|y|/ρ_s
  g.LAT_TERRACE_MIN = 2;        // 纬度 < 2° 自动按斜坡

  var ROTC = [], ROTS = [];
  for (var k0 = 0; k0 < 7; k0++) { ROTC[k0] = Math.cos(1.31 * k0); ROTS[k0] = Math.sin(1.31 * k0); }

  function N() { return fp.noise; }
  function frac(x) { return x - Math.floor(x); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sat(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function sstep(a, b, x) { var u = sat((x - a) / (b - a)); return u * u * (3 - 2 * u); }    // 允许 a>b
  function sq(x) { return x * x; }
  function sinS(x) { var x2 = x * x; return Math.abs(x) < 0.02 ? x * (1 - x2 * (1 / 6) * (1 - x2 * 0.05)) : Math.sin(x); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  g.sstep = sstep;

  /* ───────── 图表 → 纹理 ───────── */
  // 第 k 层的图表原点 uOrg[k]＝fract(Rot_k·c/(L_k·32))（02 第三节第 4 条；与 fp/camera.js 的 K.origins 同式）
  g.origins = function (c, out) {
    out = out || [];
    for (var k = 0; k < 7; k++) {
      var s = 1 / (g.LAY_L[k] * g.TILE), o = out[k] || (out[k] = [0, 0]);
      o[0] = frac((ROTC[k] * c[0] - ROTS[k] * c[1]) * s);
      o[1] = frac((ROTS[k] * c[0] + ROTC[k] * c[1]) * s);
    }
    return out;
  };
  // 第 k 层在图表偏移 dc 处的纹理坐标（不取模）
  g.layerUV = function (k, dc, org, out) {
    out = out || [0, 0];
    var s = 1 / (g.LAY_L[k] * g.TILE);
    out[0] = (ROTC[k] * dc[0] - ROTS[k] * dc[1]) * s + org[k][0];
    out[1] = (ROTS[k] * dc[0] + ROTC[k] * dc[1]) * s + org[k][1];
    return out;
  };
  // layerTex(k, dc)：r 值；gb 对 dc 的梯度（已换算）；a 材质噪声（common.glsl）
  var UV = [0, 0], TX = [0, 0, 0, 0];
  g.layerTex = function (k, dc, org, out, rOnly) {
    out = out || [0, 0, 0, 0];
    g.layerUV(k, dc, org, UV);
    N().sampleHeight(UV[0], UV[1], TX, rOnly);
    var s = 1 / (g.LAY_L[k] * g.TILE);
    out[0] = TX[0];
    out[1] = s * (ROTC[k] * TX[1] + ROTS[k] * TX[2]);
    out[2] = s * (-ROTS[k] * TX[1] + ROTC[k] * TX[2]);
    out[3] = TX[3];
    return out;
  };

  /* ───────── 脚下（foot.frag 的镜像）：[d_f, w, b, P] ───────── */
  var D0 = [0, 0], LT = [0, 0, 0, 0], LT2 = [0, 0, 0, 0];
  function lr(k, dc, org) { return g.layerTex(k, dc, org, LT, true)[0]; }
  g.foot = function (org, amp, mode, out) {
    out = out || [0, 0, 0, 0];
    amp = num(amp, 1);
    var A = g.LAY_A, P = amp * (A[0] * lr(0, D0, org) + A[1] * lr(1, D0, org)), df = 0;
    for (var k = 2; k < 6; k++) { if (mode === 1 && k === 2) continue; df += amp * A[k] * lr(k, D0, org); }
    out[0] = df; out[1] = lr(6, D0, org); out[2] = lr(2, D0, org); out[3] = P;
    if (mode === 1) { g.layerTex(2, D0, org, LT2); out[2] += T_GUL * g.terRel(amp) * g.gullyMask(LT2[3]) * g.gully(lr(3, D0, org)); }    // 冲沟并进扶壁层（foot.frag 同式）
    return out;
  };

  /* ───────── 小量差分（common.glsl） ───────── */
  function dRxz(S, v) {
    var rc = S.uCamRho, num_ = 2 * rc * v[0] + v[0] * v[0] + v[2] * v[2];      // p＝uCamW.xz＝(ρ_C, 0)
    return num_ / (rc + Math.sqrt(Math.max(rc * rc + num_, 0)));
  }
  function dRho(S, v) {
    var R = S.uR, rc = Math.sqrt(R * R + S.uCamK), C = S.uCamW;
    var num_ = 2 * (C[0] * v[0] + C[1] * v[1] + C[2] * v[2]) + v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    return num_ / (rc + Math.sqrt(Math.max(rc * rc + num_, 0)));
  }
  g.dRxz = dRxz; g.dRho = dRho;
  // 相对相机的图表坐标差（东, 北）km。
  // 注：斜坡分支按 c_N＝−R·ψ（北为正、与 chartGrad、groundPoint、相机原点一致）写成 atan(ρ_C·Δy − y_C·Δρ, …)；
  //   02 第三节第 4 条原式的分子是 y_C·Δρ − ρ_C·Δy，符号相反（common.glsl 已改正；test/chart_slide 守着源码，terrace_geom 守着相对＝绝对）。
  g.chartD = function (S, v, out) {
    out = out || [0, 0];
    var rc = S.uCamRho, dLam = Math.atan2(v[2], rc + v[0]), dn;
    if (S.uGroundMode === 1) dn = -v[1];
    else {
      var dr = dRxz(S, v), yC = S.uCamW[1];
      dn = -S.uR * Math.atan2(rc * v[1] - yC * dr, rc * (rc + dr) + yC * (yC + v[1]));
    }
    out[0] = -S.uRref * dLam; out[1] = dn;
    return out;
  };
  // 深渊沟（common.glsl）
  // 2026-10：沟沿以内 w＝min(10, 0.4h) km 的陡壁，沟沿处坡 2D/w，往下渐缓到沟底（common.glsl 同改）
  function abyssW(half) { return Math.min(10, 0.4 * half); }
  g.abyssW = abyssW;
  g.trench = function (y, depth, half) { var x = sat((half - Math.abs(y)) / abyssW(half)); return depth * x * (2 - x); };
  function trenchS(S, y) { return g.trench(y, S.uAbyssDepth, S.uAbyssHalf); }
  // d trench/dy（common.glsl 的 trenchD）
  g.trenchD = function (y, depth, half) { var w = abyssW(half), x = sat((half - Math.abs(y)) / w); return x > 0 && x < 1 ? -depth * 2 * (1 - x) / w * Math.sign(y) : 0; };
  function trenchDS(S, y) { return g.trenchD(y, S.uAbyssDepth, S.uAbyssHalf); }
  // 旧的单一台阶函数 S(g)（02 原式；2026-10 起地形不再用它，只留作对照）
  g.Sg = function (x, c, sigma) { return sigma * x + (1 - sigma) * sstep(1 - c, 1, x); };
  g.SgD = function (x, c, sigma) { var a = 1 - c, t = sat((x - a) / c); return sigma + (1 - sigma) * 6 * t * (1 - t) / c; };

  /* ───────── 阶地剖面（terrain_lib.glsl 的 lvlR、talusTop、talusG、talusAt、gullyF、cliffC、terraceP；逐行对应） ───────── */
  var T_HAMP = 0.30, T_GMAX = 0.45, T_SLOPE_D = 3.7, T_GUL = 0.171;
  g.T_HAMP = T_HAMP; g.T_GMAX = T_GMAX; g.T_SLOPE_D = T_SLOPE_D; g.T_GUL = T_GUL;
  var HH = [0, 0, 0];
  function lvlR(kA, salt, out) {
    N().pcg3((kA + 8192) | 0, salt, 40503, HH);
    out[0] = (HH[0] >>> 8) / 16777216; out[1] = (HH[1] >>> 8) / 16777216; out[2] = (HH[2] >>> 8) / 16777216;
    return out;
  }
  g.lvlR = function (kA, salt) { return lvlR(kA, salt, [0, 0, 0]); };
  function sstepD(a, b, x) { var u = sat((x - a) / (b - a)); return 6 * u * (1 - u) / (b - a); }
  g.terRel = function (amp) { return sat(num(amp, 1) / 0.7); };
  g.tanLat = function (R, y) { return Math.abs(y) / Math.sqrt(Math.max(R * R - y * y, 1)); };
  function talusTop(rB, tanL) { return Math.min(0.05 + 0.07 * rB[0] + 0.22 * rB[1], 0.2 / Math.max(tanL, 1e-3)); }
  function talusG(tTop, tanL) { return clamp(2.6 * tTop * tanL, 0.03, T_GMAX); }
  var TD = [0];
  function talusAt(tTop, br, dt) { var m = sstep(0.1, 0.55, br); dt[0] = 0.65 * tTop * sstepD(0.1, 0.55, br); return tTop * (0.35 + 0.65 * m); }
  g.gully = function (n, dg) { var u = sat(1 - Math.abs(n) / 0.16); if (dg) dg[0] = -Math.sign(n) * 6 * u * (1 - u) / 0.16; return u * u * (3 - 2 * u); };
  g.gullyMask = function (ba) { return sstep(0.56, 0.72, ba); };
  // 最近一次剖面求值留下的缓存（GLSL 的 gQ、gTal、gLedge、gStep、gCliffH）
  var PC = { Q: -1, Tal: 0, Ledge: 0, Step: -1, CliffH: 1 };
  var CA = [0, 0, 0], CB = [0, 0, 0];
  function cliffC(kA, x, e2, rl, out) {
    lvlR(kA, 81, CA); var rA0 = CA[0], rA1 = CA[1], rA2 = CA[2];
    lvlR(kA, 82, CB); var rB0 = CB[0], rB1 = CB[1], rB2 = CB[2];
    var th = [rA0, rA1, rA2, rB0].map(function (r) { return 1 + rl * (0.2 + r - 1); });
    var wr = [rB1, rB2, frac(rA0 + rB1), frac(rA1 + rB2)];
    var wd = th.map(function (t, i) { return t * (1 + rl * (0.4 * wr[i] - 0.2)); });
    var em = [e2[0], e2[1], 1 - e2[0], 1 - e2[1]], lr0 = [rB2, rA1, rB0, rA2];
    var lam = lr0.map(function (r, i) { return rl * (0.08 + 0.3 * r) * clamp(em[i] * 1.8 - 0.25, 0.1, 1); });
    var sT = th[0] + th[1] + th[2] + th[3], sW = wd[0] + wd[1] + wd[2] + wd[3];
    var xb = [wd[0] / sW, (wd[0] + wd[1]) / sW, (wd[0] + wd[1] + wd[2]) / sW], qb = [th[0] / sT, (th[0] + th[1]) / sT, (th[0] + th[1] + th[2]) / sT];
    var x0, x1, q0, q1, lm;
    if (x < xb[0]) { x0 = 0; x1 = xb[0]; q0 = 0; q1 = qb[0]; lm = lam[0]; PC.Step = 0; }
    else if (x < xb[1]) { x0 = xb[0]; x1 = xb[1]; q0 = qb[0]; q1 = qb[1]; lm = lam[1]; PC.Step = 1; }
    else if (x < xb[2]) { x0 = xb[1]; x1 = xb[2]; q0 = qb[1]; q1 = qb[2]; lm = lam[2]; PC.Step = 2; }
    else { x0 = xb[2]; x1 = 1; q0 = qb[2]; q1 = 1; lm = lam[3] * 0.5; PC.Step = 3; }
    var s0 = (x - x0) / (x1 - x0), sr = sat(s0 / (1 - lm));
    PC.Ledge = sstep(1 - lm - 0.03, 1 - lm + 0.02, s0) * sstep(0.02, 0.05, lm);
    out[0] = (q1 - q0) * 6 * sr * (1 - sr) / ((1 - lm) * (x1 - x0));
    var C = q0 + (q1 - q0) * sr * sr * (3 - 2 * sr);
    if (rl < 1) { var x2 = sat(x); C = x2 * x2 * (3 - 2 * x2) * (1 - rl) + C * rl; out[0] = 6 * x2 * (1 - x2) * (1 - rl) + out[0] * rl; PC.Ledge *= rl; }
    return C;
  }
  var RA = [0, 0, 0], RB = [0, 0, 0], QA = [0, 0, 0], QB = [0, 0, 0], DC1 = [0], TD1 = [0];
  // 第 kA 级、相位 f 处的剖面 p（Y_q＝W·(kA＋p)）。P0＝{cliff, resid, amp(起伏系数 uAmpZone)}；br 扶壁层值；e2 台坎调制；tanL tan 纬度。
  // out：[p, dp/df, ∂p/∂br]
  g.terraceP = function (kA, f, br, e2, tanL, P0, out) {
    out = out || [0, 0, 0];
    var c = num(P0.cliff, 0.07), resid = num(P0.resid, 0), rl = g.terRel(P0.amp);
    lvlR(kA, 11, RA); lvlR(kA, 12, RB); lvlR(kA - 1, 11, QA); lvlR(kA - 1, 12, QB);
    var hk = rl * T_HAMP * (RA[0] + RA[1] - 1), hk1 = rl * T_HAMP * (QA[0] + QA[1] - 1);
    var ck = c * (1 - 0.4 * rl * (1 - RA[2]));
    var tTop = rl * talusTop(RB, tanL), tk = talusAt(tTop, br, TD), dtk = TD[0];
    var tk1 = talusAt(rl * talusTop(QB, tanL), br, TD1), dtk1 = TD1[0];
    var gk = talusG(tTop, tanL), hi = 1 + hk, lo = hk1 + tk1, p, dp, dpb;
    PC.Q = -1; PC.Tal = 0; PC.Ledge = 0; PC.Step = -1; PC.CliffH = hi - lo;
    if (f < ck) { var C = cliffC(kA, f / ck, e2, rl, DC1); p = lo + (hi - lo) * C; dp = (hi - lo) * DC1[0] / ck; dpb = (1 - C) * dtk1; PC.Q = C; }
    else if (f > 1 - gk) { var s2 = (f - 1 + gk) / gk; p = hi + tk * s2 * s2; dp = 2 * tk * s2 / gk; dpb = s2 * s2 * dtk; PC.Tal = s2; }
    else { p = hi; dp = 0; dpb = 0; }
    out[0] = p * (1 - resid) + (f + 1) * resid; out[1] = dp * (1 - resid) + resid; out[2] = dpb * (1 - resid);
    return out;
  };
  g.profileCache = PC;
  // 一点的“沿崖调制量”（GLSL 的 Lb.r、gL3.a、第 4 层 .a）：在图表偏移 dc 处（原点 org）取
  var EB = [0, 0, 0, 0], E3 = [0, 0, 0, 0], E4 = [0, 0, 0, 0];
  function edgeVals(dc, org, f, c, out) {
    g.layerTex(2, dc, org, EB); g.layerTex(3, dc, org, E3);
    out.br = EB[0]; out.e2[0] = E3[3]; out.e2[1] = 0.5;
    if (f < c) { g.layerTex(4, dc, org, E4); out.e2[1] = E4[3]; }
    return out;
  }
  var EV = { br: 0, e2: [0.5, 0.5] }, TP = [0, 0, 0], D00 = [0, 0];

  /* ───────── 阶地量化（绝对量：相机、碰撞、测试的参照） ─────────
   * u：绝对相位（Y_raw/W − wig·w − jit·b̃）；org：该点的图表原点；y：该点的 y（求 tan 纬度）。
   * GS＝{R, W, cliff, resid, amp(uAmpZone)}。返回 {k, f, u, Yq, p, dp, Q, Tal}；fp/camera.js 的 evalTerrace 经 terraceYq 也用它 */
  g.terraceLevel = function (u, org, y, GS, out) {
    out = out || {};
    var W = num(GS.W, 1.5), k = Math.floor(u), f = u - k;
    edgeVals(D00, org, f, num(GS.cliff, 0.07), EV);
    g.terraceP(k, f, EV.br, EV.e2, g.tanLat(num(GS.R, 6371), y), GS, TP);
    out.k = k; out.f = f; out.u = u; out.p = TP[0]; out.dp = TP[1]; out.Yq = W * (k + TP[0]);
    out.Q = PC.Q; out.Tal = PC.Tal;
    return out;
  };
  // fp/camera.js 用：给绝对相位 u、该点的图表原点 org、y，返回 Y_q（km）。gs＝state.fp.ground；amp＝相机的起伏系数（uAmpZone）
  var TL = {};
  g.terraceYq = function (u, org, y, gs, amp, R) {
    return g.terraceLevel(u, org, y, { R: num(R, 6371), W: num(gs.W, 1.5), cliff: num(gs.cliff, 0.07), resid: num(gs.resid, 0), amp: amp }, TL).Yq;
  };

  /* ───────── 细层位移与相对离地高度（terrain_lib.glsl） ───────── */
  g.layerFade = function (k, foot) { return 1 - sstep(0.3 * g.LAY_L[k], 1.2 * g.LAY_L[k], foot); };
  var DF = [0, 0, 0, 0], FULL = false;   // FULL：groundPoint 要全部细层（GLSL 的 gFull）
  g.dispFine = function (S, dc, foot, clear, out) {
    out = out || [0, 0, 0];
    out[0] = 0; out[1] = 0; out[2] = 0;
    var A = g.LAY_A, amp = S.uAmpZone, k0 = S.uGroundMode === 1 ? 3 : 2;
    for (var k = 2; k < 6; k++) {
      if (k < k0) continue;
      var fd = g.layerFade(k, foot); if (fd <= 0) break;
      var rest = 0; for (var j = 5; j > k; j--) rest += A[j];
      if (!FULL && clear - out[0] > 2.5 * (A[k] + rest) * amp + 0.002) break;   // 与 GLSL 同：相机处不提前停读
      g.layerTex(k, dc, S.uOrg, DF);
      var a = A[k] * amp * fd;
      out[0] += a * DF[0]; out[1] += a * DF[1]; out[2] += a * DF[2];
    }
    return out;
  };
  // S.F 给了就用（makeState 会给）；没给就按 S.uOrg 现算（不写回 S：调用方的取值表可能逐帧复用）
  var FT0 = [0, 0, 0, 0];
  function footOf(S) { return S.F || g.foot(S.uOrg, S.uAmpZone, S.uGroundMode, FT0); }
  // 最近一次 altAt 留下的缓存（GLSL 的 gU、gK、gKA、gDc、gYq、gDp、gDpBr、gBr、gQ、gTal、gLedge、gStep、gCliffH）
  g.last = { U: 0, K: 0, KA: 0, dc: [0, 0], Yq: 0, Dp: 0, DpBr: 0, Br: 0, Q: -1, Tal: 0, Ledge: 0, Step: -1, CliffH: 1 };
  // 相机处的剖面值 p_C（GLSL 的 camP：dc＝0 处取扶壁层、第 3、4 层）
  var CP3 = [0, 0, 0];
  function camP(S, kC) {
    edgeVals(D00, S.uOrg, S.uTerF0, S.uCliffC, EV);
    g.terraceP(kC, S.uTerF0, EV.br, EV.e2, g.tanLat(S.uR, S.uCamW[1]), { cliff: S.uCliffC, resid: S.uResid, amp: S.uAmpZone }, CP3);
    return CP3[0];
  }
  var DC = [0, 0], FN = [0, 0, 0], V0 = [0, 0, 0], LB2 = [0, 0, 0, 0], L3C = [0, 0, 0, 0];
  // 相对相机的离地高度（km）。v：CM 系相对相机的位移；也可传二维 dc（见文件头）。lod 0 全部层；1 只低频
  g.altAt = function (S, v, foot, lod) {
    if (v.length === 2) v = g.chartToV(S, v, V0);
    foot = num(foot, 2e-4); lod = lod || 0;
    var F = footOf(S), A = g.LAY_A, R = S.uR;
    var dc = g.chartD(S, v, DC); g.last.dc[0] = dc[0]; g.last.dc[1] = dc[1];
    var yX = S.uCamW[1] + v[1], amp = S.uAmpZone;
    var tr = trenchS(S, yX) - trenchS(S, S.uCamW[1]);
    var P = amp * (A[0] * lr(0, dc, S.uOrg) + A[1] * lr(1, dc, S.uOrg)) - F[3];       // ΔP
    var base, fine;
    if (S.uGroundMode === 0) {
      g.last.Yq = 0;
      base = S.uCamAlt - dRho(S, v) + tr - P;
      fine = lod === 0 ? g.dispFine(S, dc, foot, base + F[0], FN)[0] : 0;
      return base - (fine - F[0]);
    }
    var Lb2 = g.layerTex(2, dc, S.uOrg, LB2), L33 = g.layerTex(3, dc, S.uOrg, L3C);
    var gul = lod === 0 ? T_GUL * g.terRel(amp) * g.gullyMask(Lb2[3]) * g.gully(L33[0]) : 0;
    var w = lr(6, dc, S.uOrg) - F[1], b = Lb2[0] + gul - F[2];
    var rsX = Math.sqrt(Math.max(R * R - yX * yX, 0));
    var dRs = -(2 * S.uCamW[1] * v[1] + v[1] * v[1]) / (rsX + S.uRsC);
    var rawC = S.uRsC - F[3], rawX = rawC + dRs - P;
    var YC = Math.sqrt(Math.max(R * R - rawC * rawC, 1)), YX = Math.sqrt(Math.max(R * R - rawX * rawX, 1));
    var dY = -(dRs - P) * (rawX + rawC) / (YX + YC);
    var uu = S.uTerF0 + dY / S.uW - S.uWig * w - S.uJit * b, kk = Math.floor(uu), f = uu - kk;
    g.last.U = f; g.last.K = kk;
    var kC = Math.floor(YC / S.uW - S.uWig * F[1] - S.uJit * F[2] - S.uTerF0 + 0.5);
    g.last.KA = kC + kk;
    EV.br = Lb2[0]; EV.e2[0] = lod === 0 ? L33[3] : 0.5; EV.e2[1] = 0.5;
    if (f < S.uCliffC && lod === 0) { g.layerTex(4, dc, S.uOrg, E4); EV.e2[1] = E4[3]; }
    g.terraceP(kC + kk, f, EV.br, EV.e2, g.tanLat(R, yX), { cliff: S.uCliffC, resid: S.uResid, amp: amp }, TP);
    var pX = TP[0];
    g.last.Dp = TP[1]; g.last.DpBr = TP[2]; g.last.Br = Lb2[0];
    g.last.Q = PC.Q; g.last.Tal = PC.Tal; g.last.Ledge = PC.Ledge; g.last.Step = PC.Step; g.last.CliffH = PC.CliffH;
    var dYq = S.uW * (kk + pX - camP(S, kC));
    var rqC = S.uCamRho + S.uCamAlt + F[0] - trenchS(S, S.uCamW[1]), YqC = Math.sqrt(Math.max(R * R - rqC * rqC, 1));
    var YqX = YqC + dYq, rqX = Math.sqrt(Math.max(R * R - YqX * YqX, 1));
    g.last.Yq = YqX;
    var dRq = -dYq * (YqX + YqC) / (rqX + rqC);
    base = S.uCamAlt + dRq - dRxz(S, v) + tr;
    fine = lod === 0 ? g.dispFine(S, dc, foot, base + F[0], FN)[0] : 0;
    return base - (fine - F[0]);
  };
  // groundPoint 的第一步：与相机同一离轴半径（阶地）／同一离球心距离（斜坡），沿图表挪 dc 的点（相对相机）
  g.chartToV = function (S, dc, out) {
    out = out || [0, 0, 0];
    var dLam = -dc[0] / S.uRref;
    if (S.uGroundMode === 1) {
      var rc = S.uCamRho;
      out[0] = -rc * 2 * sq(sinS(0.5 * dLam)); out[1] = -dc[1]; out[2] = rc * sinS(dLam);
      return out;
    }
    var psiC = Math.atan2(S.uCamRho, -S.uCamW[1]), dPsi = -dc[1] / S.uR, psi = psiC + dPsi, r = Math.sqrt(S.uR * S.uR + S.uCamK);
    out[0] = r * (2 * Math.cos(psiC + 0.5 * dPsi) * sinS(0.5 * dPsi) - Math.sin(psi) * 2 * sq(sinS(0.5 * dLam)));
    out[1] = r * (2 * Math.sin(psiC + 0.5 * dPsi) * sinS(0.5 * dPsi));
    out[2] = r * (Math.sin(psi) * sinS(dLam));
    return out;
  };
  // 由图表偏移求地面点（相对相机），terrain_lib.glsl 的 groundPoint
  // 读全部细层（不提前停读），沿 ρ̂／径向一次就落地，与 GLSL 的 gFull 同
  var DIR = [0, 0, 0];
  g.groundPoint = function (S, dc, out) {
    out = g.chartToV(S, dc, out);
    var dLam = -dc[0] / S.uRref;
    if (S.uGroundMode === 1) { DIR[0] = Math.cos(dLam); DIR[1] = 0; DIR[2] = Math.sin(dLam); }
    else {
      var X0 = S.uCamW[0] + out[0], X1 = S.uCamW[1] + out[1], X2 = S.uCamW[2] + out[2], L = Math.sqrt(X0 * X0 + X1 * X1 + X2 * X2);
      DIR[0] = X0 / L; DIR[1] = X1 / L; DIR[2] = X2 / L;
    }
    FULL = true;
    var a;
    try {
      a = g.altAt(S, out, 1e-3, 0);
      out[0] += a * DIR[0]; out[1] += a * DIR[1]; out[2] += a * DIR[2];
      if (S.uGroundMode === 0 && Math.abs(a) > 0.05) { a = g.altAt(S, out, 1e-3, 0); out[0] += a * DIR[0]; out[1] += a * DIR[1]; out[2] += a * DIR[2]; }
    } finally { FULL = false; }
    return out;
  };

  /* ───────── 地形求交的远界（terrain_lib.glsl 的 tTerFar） ─────────
   * 外扩到最深地面（深渊沟底再往下全部起伏）的球面的远交点；相机在内壁球面之外（洼地、沟里，K＞0）时也有定义。cd＝C·d */
  g.tTerFar = function (S, cd) {
    var m = S.uAbyssDepth + S.uClearMax + 0.5, Ko = S.uCamK - m * (2 * S.uR + m);
    return -cd + Math.sqrt(Math.max(cd * cd - Ko, 0));
  };

  /* ───────── 高档的 8 方向扫描遮蔽（horizon.frag 第 0 级 B 通道的镜像） ─────────
   * v＝地面点（相对相机，已沿“上”抬高 0.5 m）。沿 8 个水平方向各看 4、16、64、256 m，取地形最大仰角 h，返回 1 − 平均 sin²h */
  g.aoScan = function (S, v) {
    var X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], S.uCamW[2] + v[2]], up, L;
    if (S.uGroundMode === 1) { L = Math.hypot(X[0], X[2]); up = [-X[0] / L, 0, -X[2] / L]; }
    else { L = Math.hypot(X[0], X[1], X[2]); up = [-X[0] / L, -X[1] / L, -X[2] / L]; }
    var a = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var e1 = [up[1] * a[2] - up[2] * a[1], up[2] * a[0] - up[0] * a[2], up[0] * a[1] - up[1] * a[0]], l1 = Math.hypot(e1[0], e1[1], e1[2]);
    e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
    var e2 = [up[1] * e1[2] - up[2] * e1[1], up[2] * e1[0] - up[0] * e1[2], up[0] * e1[1] - up[1] * e1[0]], occ = 0, P = [0, 0, 0];
    for (var i = 0; i < 8; i++) {
      var an = 0.78539816 * i, c = Math.cos(an), s0 = Math.sin(an), th = 0;
      for (var j = 0; j < 4; j++) {
        var s = 0.004 * Math.pow(2, 2 * j);
        for (var k = 0; k < 3; k++) P[k] = v[k] + (c * e1[k] + s0 * e2[k]) * s;
        th = Math.max(th, -g.altAt(S, P, Math.max(s * 0.01, 1e-3), 0) / s);
      }
      occ += th * th / (1 + th * th);
    }
    return 1 - occ / 8;
  };

  /* ───────── 梯度：截步的 du/dt 与地面法线（terrain_lib.glsl 的 duDt、terrainNormal；common.glsl 的 chartGrad） ───────── */
  // 图表坐标（东, 北）对世界坐标的梯度；X 为 CM 系绝对位置
  g.chartGrad = function (S, X, gE, gN) {
    var r2 = X[0] * X[0] + X[2] * X[2];
    gE[0] = -S.uRref * -X[2] / r2; gE[1] = 0; gE[2] = -S.uRref * X[0] / r2;
    if (S.uGroundMode === 1) { gN[0] = 0; gN[1] = -1; gN[2] = 0; }
    else {
      var rr = Math.sqrt(r2), L2 = r2 + X[1] * X[1];
      gN[0] = -S.uR * (-X[1] * X[0] / rr) / L2; gN[1] = -S.uR * rr / L2; gN[2] = -S.uR * (-X[1] * X[2] / rr) / L2;
    }
  };
  var GE = [0, 0, 0], GN = [0, 0, 0], T0 = [0, 0, 0, 0], T1 = [0, 0, 0, 0], TW = [0, 0, 0, 0], TB = [0, 0, 0, 0], DC2 = [0, 0];
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  // 量化前起伏 P 的图表梯度（GLSL 里由 altAt 缓存成 gGP）
  function gradP(S, dc, out) {
    var A = g.LAY_A, amp = S.uAmpZone;
    g.layerTex(0, dc, S.uOrg, T0); g.layerTex(1, dc, S.uOrg, T1);
    out[0] = amp * (A[0] * T0[1] + A[1] * T1[1]); out[1] = amp * (A[0] * T0[2] + A[1] * T1[2]);
    return out;
  }
  var GP = [0, 0], T3 = [0, 0, 0, 0], DG = [0];
  // 扶壁层＋冲沟 b̃ 的值与图表梯度（GLSL 的 gGb）：out[0] 值，out[1..2] 梯度
  function gradB(S, dc, out) {
    g.layerTex(2, dc, S.uOrg, out); g.layerTex(3, dc, S.uOrg, T3);
    var kg = T_GUL * g.terRel(S.uAmpZone) * g.gullyMask(out[3]), G3 = g.gully(T3[0], DG);
    out[0] += kg * G3; out[1] += kg * DG[0] * T3[1]; out[2] += kg * DG[0] * T3[2];
    return out;
  }
  // 阶地相位沿方向 d（单位向量）的变化率 du/dt（/km），v 为相对相机的位移
  g.duDt = function (S, v, d) {
    var dc = g.chartD(S, v, DC2), X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], S.uCamW[2] + v[2]];
    g.chartGrad(S, X, GE, GN);
    gradP(S, dc, GP); g.layerTex(6, dc, S.uOrg, TW); gradB(S, dc, TB);
    var rs = Math.sqrt(Math.max(S.uR * S.uR - X[1] * X[1], 1)), kP = rs / Math.max(Math.abs(X[1]), 1) / S.uW;
    var cx = kP * GP[0] - S.uWig * TW[1] - S.uJit * TB[1], cy = kP * GP[1] - S.uWig * TW[2] - S.uJit * TB[2];
    return d[1] * Math.sign(X[1]) / S.uW + cx * dot3(d, GE) + cy * dot3(d, GN);
  };
  // 地面法线（单位向量，指向空中）：v 处先求一次 altAt 取相位，其余与 GLSL 同式
  var FD = [0, 0, 0];
  g.terrainNormal = function (S, v, foot) {
    foot = num(foot, 2e-4);
    g.altAt(S, v, foot, 0);
    var dc = g.last.dc, X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], S.uCamW[2] + v[2]];
    g.chartGrad(S, X, GE, GN);
    var dd = g.dispFine(S, dc, foot, -1e9, FD);
    gradP(S, dc, GP);
    var n = [0, 0, 0], i;
    var gD = [dd[1] * GE[0] + dd[2] * GN[0], dd[1] * GE[1] + dd[2] * GN[1], dd[1] * GE[2] + dd[2] * GN[2]];
    var gP = [GP[0] * GE[0] + GP[1] * GN[0], GP[0] * GE[1] + GP[1] * GN[1], GP[0] * GE[2] + GP[1] * GN[2]];
    var tD = trenchDS(S, X[1]);
    if (S.uGroundMode === 0) {
      var L = Math.sqrt(dot3(X, X));
      for (i = 0; i < 3; i++) n[i] = -X[i] / L - gP[i] - gD[i];
      n[1] += tD;
    } else {
      var rxz = Math.sqrt(X[0] * X[0] + X[2] * X[2]), rs = Math.sqrt(Math.max(S.uR * S.uR - X[1] * X[1], 1));
      var gRs = [0, -X[1] / rs, 0], kY = -rs / Math.max(Math.abs(X[1]), 1);
      g.layerTex(6, dc, S.uOrg, TW); gradB(S, dc, TB);
      var wx = -S.uWig * TW[1] - S.uJit * TB[1], wy = -S.uWig * TW[2] - S.uJit * TB[2];
      var Dp = g.last.Dp, DpBr = g.last.DpBr, kq = -Math.abs(X[1]) / rs;
      g.layerTex(2, dc, S.uOrg, LB2);
      for (i = 0; i < 3; i++) {
        var gu = kY * (gRs[i] - gP[i]) / S.uW + wx * GE[i] + wy * GN[i];
        var gBr = LB2[1] * GE[i] + LB2[2] * GN[i];
        n[i] = kq * S.uW * (Dp * gu + DpBr * gBr) - gD[i];
      }
      n[0] -= X[0] / rxz; n[2] -= X[2] / rxz; n[1] += tD;
    }
    var l = Math.sqrt(dot3(n, n));
    return [n[0] / l, n[1] / l, n[2] / l];
  };

  /* ───────── 绝对量（相机放置、碰撞、测试的参照） ───────── */
  // 图表坐标：阶地 c＝(−R_ref·φ, −y)；斜坡 c＝(−R_ref·φ, −R·ψ)（02 第三节第 4 条）
  g.chart = function (GS, y, phi, rho, out) {
    out = out || [0, 0];
    out[0] = -GS.Rref * phi;
    out[1] = GS.mode === 1 ? -y : -GS.R * Math.atan2(rho == null ? Math.sqrt(Math.max(GS.R * GS.R - y * y, 0)) : rho, -y);
    return out;
  };
  var ORG = [], FT = [0, 0, 0, 0], CC = [0, 0], TLA = {};
  // 阶地：(y, φ) 处的地面（不看相机，离轴半径无关）；斜坡：点 (ρ, y, φ) 所在径向上的脚点（ψ＝atan2(ρ, −y)；ρ 省略＝球面上）
  g.groundAbs = function (GS, y, phi, out, rho) {
    out = out || {};
    var R = GS.R, gsW = num(GS.W, 1.5), tr = g.trench(y, num(GS.abyssDepth, 30), num(GS.abyssHalf, 220));
    g.origins(g.chart(GS, y, phi, rho, CC), ORG);
    g.foot(ORG, num(GS.amp, 1), GS.mode, FT);
    out.F = FT.slice();
    var rs = Math.sqrt(Math.max(R * R - y * y, 0));
    if (GS.mode !== 1) {
      out.D = FT[3] + FT[0];
      out.rad = R + tr - out.D;
      out.f = 0; out.k = 0; out.rs = rs;
      return out;
    }
    var rraw = rs - FT[3], Yraw = Math.sqrt(Math.max(R * R - rraw * rraw, 0));
    var uAbs = Yraw / gsW - num(GS.wig, 0.35) * FT[1] - num(GS.jit, 0.07) * FT[2];
    var L = g.terraceLevel(uAbs, ORG, y, { R: R, W: gsW, cliff: num(GS.cliff, 0.07), resid: num(GS.resid, 0), amp: num(GS.amp, 1) }, TLA);
    var rq = Math.sqrt(Math.max(R * R - L.Yq * L.Yq, 0));
    out.rg = rq - FT[0] + tr; out.rq = rq; out.f = L.f; out.k = L.k; out.u = L.u; out.Yq = L.Yq; out.Yraw = Yraw; out.rs = rs; out.Q = L.Q; out.Tal = L.Tal;
    return out;
  };
  // 实际使用的地面模式：1 阶地、0 斜坡（与 fp/camera.js 的 K.groundMode 同一规则）
  g.modeAt = function (P, s, modeStr) {
    if (modeStr === 'slope') return 0;
    var lat = 90 - (s / P.R) * R2D;
    return Math.abs(lat) < g.LAT_TERRACE_MIN ? 0 : 1;
  };
  // 从地点现造一份 S（双精度；测试与离线计算用。运行时请用 HY.fp.cam 的 compute()，两者同式）
  //   gs＝state.fp.ground 的形状；opts：{eye(m), amp, Rref, snap(阶地相机落到踏面), fround}
  g.makeState = function (P, s, az, gs, opts) {
    gs = gs || {}; opts = opts || {};
    var R = P.R, psi = s / R, phi = num(az, 0) * D2R, mode = g.modeAt(P, s, gs.mode);
    var Rref = num(opts.Rref, R * Math.sin(psi)), eye = num(opts.eye, 1.6) / 1000;
    var y = -R * Math.cos(psi);
    var info = { mode: mode, y: y, rho: R * Math.sin(psi), ground: gs, zone: opts.zone, amp: gs.amp };
    var lim = g.limits(info), amp = num(opts.amp, lim.uAmpZone);
    var GS = { R: R, mode: mode, W: num(gs.W, 1.5), cliff: num(gs.cliff, 0.07), resid: num(gs.resid, 0), wig: num(gs.wig, 0.35), jit: num(gs.jit, 0.07),
      abyssDepth: num(gs.abyssDepth, 30), abyssHalf: num(gs.abyssHalf, 220), amp: amp, Rref: Rref };
    var ab = g.groundAbs(GS, y, phi), x, cy;
    if (mode === 1 && opts.snap !== false) {
      for (var it = 0; it < 40 && ab.f < GS.cliff + 0.01; it++) {                      // 落在崖带里：往塔根挪到上一级踏面
        y += (y < 0 ? -1 : 1) * GS.W * 0.02; ab = g.groundAbs(GS, y, phi);
      }
      psi = Math.acos(clamp(-y / R, -1, 1));
    }
    if (mode === 1) { x = ab.rg - eye; cy = y; }
    else {   // 斜坡：沿径向放在 eye·sinψ 处（GPU 的 alt(0)＝uCamAlt 正是沿径向量的，这样 CPU 与 GPU 严格一致）；
      var rr = ab.rad - eye * Math.sin(psi);   // 深渊沟按相机的实际 y 取（沟壁很陡，用球面上的 y 会差出几百米），迭代两次即收敛
      for (var it2 = 0; it2 < 3; it2++) { ab = g.groundAbs(GS, -rr * Math.cos(psi), phi, ab, rr * Math.sin(psi)); rr = ab.rad - eye * Math.sin(psi); }
      x = rr * Math.sin(psi); cy = -rr * Math.cos(psi);
    }
    if (opts.fround) { x = Math.fround(x); cy = Math.fround(cy); }
    var Kc = x * x + cy * cy - R * R;
    var S = {
      uR: R, uA: P.a, uGroundMode: mode, uW: GS.W, uCliffC: GS.cliff, uResid: GS.resid, uWig: GS.wig, uJit: GS.jit,
      uAbyssDepth: GS.abyssDepth, uAbyssHalf: GS.abyssHalf,
      uCamW: [x, cy, 0], uCamK: Kc, uCamZ: -Kc / (R + Math.sqrt(Math.max(R * R + Kc, 0))), uCamRho: x,
      uRsC: Math.sqrt(Math.max(R * R - cy * cy, 0)), uCamAlt: mode === 1 ? eye : eye * Math.sin(psi), uLamCam: phi, uRref: Rref,
      uAmpZone: amp, uHc: lim.uHc, uLip: lim.uLip, uClearMax: lim.uClearMax, uTerF0: 0, uOrg: null
    };
    var c = g.chart(GS, cy, phi, x, [0, 0]);
    S.uOrg = g.origins(c, []);
    S.F = g.foot(S.uOrg, amp, mode);
    if (mode === 1) {   // 相机处的相位（与 GLSL 的 uTerF0 同义：u_C 的小数部分）
      var rraw = S.uRsC - S.F[3], Yraw = Math.sqrt(Math.max(R * R - rraw * rraw, 0));
      S.uTerF0 = frac(Yraw / GS.W - GS.wig * S.F[1] - GS.jit * S.F[2]);
    }
    S.GS = GS; S.chart = c; S.eye = eye; S.psi = Math.atan2(x, -cy); S.phi = phi;
    return S;
  };

  /* ───────── 域系数与求交器参数（02 第八节第 4 条） ───────── */
  g.layerParams = function (zone) {
    var id = zone && zone.id ? zone.id : zone, amp = g.ZONE_AMP[id] == null ? 1 : g.ZONE_AMP[id];
    return { amp: amp, A: g.LAY_A.map(function (a) { return a * amp; }), L: g.LAY_L.slice() };
  };
  // 相机所在处的起伏系数：有分域权重（fp/camera.js 的 siteInfo）就按权重混合，否则按域名，都没有取罪域 1.25
  g.zoneAmp = function (info) {
    var Z = g.ZONE_AMP;
    if (info && info.zoneW && info.zoneW.length >= 3) {
      var zw = info.zoneW, a = zw[0] * Z.light + zw[1] * Z.plain + zw[2] * Z.heavy;
      a = a * (1 - num(info.ruiW, 0)) + Z.rui * num(info.ruiW, 0);
      return a * (1 - num(info.limboW, 0)) + Z.limbo * num(info.limboW, 0);
    }
    if (info && info.zone) return g.layerParams(info.zone).amp;
    return Z.rui;
  };
  g.limits = function (info) {
    info = info || {};
    var gs = info.ground || {}, A = g.LAY_A, L = g.LAY_L;
    var user = num(gs.amp, num(info.amp, 1)), amp = g.zoneAmp(info) * user;
    var mode = info.mode == null ? 1 : info.mode, W = num(gs.W, num(info.W, 1.5)), Hc;
    if (isFinite(info.y) && isFinite(info.rho) && info.rho > 0) Hc = Math.min(W, g.W_MAX) * Math.abs(info.y) / info.rho;
    else Hc = num(info.Hc, W * Math.tan(30 * D2R));
    // uLip：位移层的坡度上界。斜坡模式第 0–5 层都造坡；阶地模式第 0–2 层只挪崖线相位（踏面仍水平），只算第 3–5 层（崖由 cliffStep 截步）。
    //   相机离赤道不远（视线够得着深渊沟）时再加沟壁的坡。terrain_lib.glsl 的 coneStep 按同一口径逐层放宽步长。
    var lip = 0, sumA = 0, k0 = mode === 1 ? 3 : 0;
    for (var k = 0; k < 6; k++) { if (k >= k0) lip += 3 * A[k] / L[k]; sumA += A[k]; }
    // 深渊沟壁（2026-10 改成 80° 的陡壁）不再并进 uLip：terrain_lib.glsl 的 trenchStep 只在沟壁一带截步，别处不受拖累。
    // 阶地的级高抖动（±0.3 级）与倒石坡（≤0.3 级）让地面最多高出裸球面约 1.6 级：uClearMax 按 1.7·崖高留余量
    return { uAmpZone: amp, uLip: 1.2 * lip * amp + 0.05, uClearMax: sumA * amp + (mode === 1 ? Hc * 1.7 : 0) + 0.02, uHc: Hc };
  };

  /* ───────── 相机的图表坐标（实例格网等要“相机在图表上的位置”时用；与 fp/camera.js 写 uOrg 的锚相同） ─────────
   * 有 cam.chart() 就用它（真实相机处、双精度，uOrg 就是由它取模来的）；只给 info() 时按同一式子现算。 */
  g.camChart = function (cam, R, out) {
    out = out || [0, 0];
    if (cam && typeof cam.chart === 'function') return cam.chart(out);
    var i = cam && typeof cam.info === 'function' ? cam.info() : cam;
    if (!i) { out[0] = 0; out[1] = 0; return out; }
    R = num(R, num(i.R, 6371));
    out[0] = -i.Rref * i.phi;
    out[1] = i.mode === 1 ? -i.y : -R * Math.atan2(i.rho, -i.y);
    return out;
  };

})(typeof globalThis !== 'undefined' ? globalThis : window);
