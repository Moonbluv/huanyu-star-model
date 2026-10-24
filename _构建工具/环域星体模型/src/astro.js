/* HY.astro —— 环域星体 · 天体与历法
 * 规格：spec/01_天体与历法.md（本文件是它的参考实现，公式以规格为准，两边必须同步改）
 * 纯函数，无依赖；浏览器里挂在 window.HY.astro，node 里 module.exports。
 *
 * 坐标（地固系，随星体一起转）：原点＝球心；y 轴＝塔轴，+y 指向塔顶，塔根极在 (0,-R,0)；
 *   x、z 张成塔腰平面；方位角 φ＝atan2(z,x)。φ 增大的方向＝自转方向＝地面上的“西”。
 * 单位：长度 km；时间 t 以“日”计（1 日＝太阳相对地面绕塔一圈＝24 小时）；角度对外一律用度。
 * 历元：t=0 ＝ 帝国 10018 年十一月初一子夜（伊美忒经线）＝庆典年入冬交节：
 *   太阳往上越过塔腰，月亮同时往下越过塔腰，月在塔影正中（日、塔、月三点一线）。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) { root.HY = root.HY || {}; root.HY.astro = api; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI, G0 = 9.80665;

  /* ───────── 一、参数 ───────── */
  var DEFAULTS = Object.freeze({
    // 星体（作者设定）
    R: 6371,            // 内表面半径 km
    a: 600,             // 巨塔半径 km
    gEq: 1.4,           // 赤道重力（g）
    dayHours: 24,       // 一日的小时数
    // 年与月
    Y: 360,             // 一年＝日月上下一个来回（日）
    lunPerYear: 12.25,  // 一年的朔望月数 → M = Y/12.25 = 29.388 日；四年 49 月整
    monthsPerYear: 12, daysPerMonth: 30, // 民用历（《冲突与待定》草案：十二个月 × 三十日）
    // 日
    dS: 640,            // 日轨半径（日心离塔轴）km ＝ 塔面外 40 km
    rhoS: 20,           // 日本体半径 km
    // 日月共用振幅：两条螺旋的折返面 y=±A，令其穿过罪域 → 罪域是日月的回归线
    sTrop: null,        // 回归纬线离塔根的地面距离；null → πR/3（罪域，“六分之一周长”）
    A: null,            // null → R·cos(sTrop/R)（＝R/2）
    // 月
    rM: null,           // 月轨半径（月心离塔轴）；null → 等于 A（＝R/2）
    rhoM: 100,          // 月本体半径 km（罪域看夜里的亮月，十轮约等于塔宽）
    mirror: 1,          // 月高 ＝ −mirror × 日高（1＝严格镜像）
    // 历元
    epochYear: 10018,   // 庆典年
    winterMonth: 11, winterDay: 1, // 入冬＝十一月初一（历法草案，待作者拍板）
    epochAz: 2,         // 交节落在这条经线的子夜（伊美忒，度）
    // 光度定标：日面有效温度＝地球太阳 → 由半径与距离推出大气顶照度
    Tsun: 5772,         // K
    efficacy: 93.3,     // lm/W（5772 K 黑体在大气外的光视效能；地球：1361 W/m² ↔ 127 klux）
    Sref: null,         // W/m²：入冬那天赤道正午、大气顶；null → σT⁴(ρS/(R−dS))² ≈ 767
    Eref: null,         // lux：同上；null → Sref × efficacy ≈ 71.5 klux
    pMoon: 0.6,         // 月面几何反照率（白月；地球的月亮是 0.12）
    albedoFar: 0.30,    // 对岸（对面内壁，含云）的整体视反照率
    // 大气（仅作直射透过的便捷估算；正式由大气规格定）
    H: 40, V: 200,
    // 统计口径
    hangMinEl: 30,      // 黑月高悬：重力仰角门槛（度）
    litMinK: 0.3,       // 夜里见亮月：亮面门槛
    minMinutes: 10      // 一夜里累计满 10 分钟才算“见到”
  });

  // 预设：default＝定稿；bing＝丙原参数（A=0.7R、月轨 3000、月半径 90，带“圣禁城冬季影期”）
  var PRESETS = Object.freeze({
    default: {},
    bing: { A: 0.7 * 6371, rM: 3000, rhoM: 90 }
  });

  function params(o) {
    var P = {}, k;
    for (k in DEFAULTS) P[k] = DEFAULTS[k];
    if (o) for (k in o) if (o[k] !== undefined) P[k] = o[k];
    if (P.sTrop == null) P.sTrop = Math.PI * P.R / 3;
    if (P.A == null) P.A = P.R * Math.cos(P.sTrop / P.R);
    if (P.rM == null) P.rM = P.A;
    P.M = P.Y / P.lunPerYear;                                  // 朔望月（日）
    P.daySec = P.dayHours * 3600;
    P.spinOmega = Math.sqrt(P.gEq * G0 / (P.R * 1000));        // 星体自转角速度 rad/s
    P.spinPeriodMin = TAU / P.spinOmega / 60;                  // 71.3 分
    P.phi0 = P.epochAz * D2R;
    P.winterDoy = (P.winterMonth - 1) * P.daysPerMonth + (P.winterDay - 1); // 300
    P.tauV = 3.912 * P.H / P.V;                                // 垂直光学厚度 0.78
    P.Dref = P.R - P.dS;                                       // 定标距离 5731 km
    if (P.Sref == null) P.Sref = 5.670374e-8 * Math.pow(P.Tsun, 4) * (P.rhoS / P.Dref) * (P.rhoS / P.Dref);
    if (P.Eref == null) P.Eref = P.Sref * P.efficacy;
    P.beta = Math.acos(P.a / P.dS) + Math.acos(P.a / P.rM);    // 黑月半角（rad）
    P.blackFrac = 1 - P.beta / Math.PI;                        // 黑月占一月的比例
    return P;
  }
  var _def = null;
  function D(P) { return P || _def || (_def = params()); }

  /* ───────── 二、日月位置 ───────── */
  function wrapDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }
  function frac(x) { return x - Math.floor(x); }

  // 一年里的高度形状：>0 日在塔腰以上（塔根半球为冬）
  function yearPhase(t, P) { P = D(P); return Math.sin(TAU * t / P.Y); }

  function sunPos(t, P) {
    P = D(P);
    var th = P.phi0 + Math.PI + TAU * t;
    return { x: P.dS * Math.cos(th), y: P.A * yearPhase(t, P), z: P.dS * Math.sin(th), th: th, rho: P.rhoS };
  }
  function moonPos(t, P) {
    P = D(P);
    var th = P.phi0 + TAU * t * (1 - 1 / P.M);
    return { x: P.rM * Math.cos(th), y: -P.mirror * P.A * yearPhase(t, P), z: P.rM * Math.sin(th), th: th, rho: P.rhoM };
  }
  // 月对日的方位差（度，(-180,180]）：正＝月在日之西；±180＝冲（黑月正中），0＝合
  function elongation(t, P) { P = D(P); return wrapDeg(-180 - 360 * t / P.M); }
  // 月龄 0..1：0＝黑月正中，0.5＝合
  function moonAge(t, P) { P = D(P); return frac(t / P.M); }
  // 给定方位差，求最近一个周期里的 t（用于阈值计算）
  function tForElong(dDeg, P) { P = D(P); return frac(-(dDeg + 180) / 360) * P.M; }

  // 地固系 → 惯性系（神的视角）：绕塔轴再转 Ω·t
  function toInertial(p, t, P) {
    P = D(P);
    var al = P.spinOmega * P.daySec * t, c = Math.cos(al), s = Math.sin(al);
    return { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c };
  }
  // 托住天体所需的向轴加速度（m/s²）：惯性系角速度 ω＝Ω_自转＋相对地面角速度
  function holdAccel(rKm, turnsPerDay, P) {
    P = D(P);
    var w = P.spinOmega + TAU * turnsPerDay / P.daySec;
    return w * w * rKm * 1000;
  }

  /* ───────── 三、地点 ───────── */
  var SITES = Object.freeze({
    '圣禁城': { s: 3600, az: 0 },
    '伊美忒': { s: 4000, az: 2 },
    '涅赫莱恩': { s: 5600, az: 25 },
    '罪域': { s: 6670, az: -4 },
    '赤道': { s: null, az: 0 }      // null → πR/2（深渊一带）
  });
  function site(s, azDeg, P) {
    P = D(P);
    if (s == null) s = Math.PI * P.R / 2;
    var psi = s / P.R, ph = azDeg * D2R, r = P.R * Math.sin(psi), c = Math.cos(ph), sn = Math.sin(ph);
    return {
      s: s, az: azDeg, psi: psi, phi: ph, r: r,
      x: r * c, y: -P.R * Math.cos(psi), z: r * sn,
      lat: 90 - psi * R2D,                 // 纬度＝地面相对重力水平面的倾角
      g: P.gEq * Math.sin(psi),            // 重力（g）
      U: [-c, 0, -sn],                     // 上：垂直指向塔轴
      N: [0, -1, 0],                       // 北：朝塔根
      E: [sn, 0, -c],                      // 东：面朝北时的右手
      n: [-Math.sin(psi) * c, Math.cos(psi), -Math.sin(psi) * sn] // 地面法线（指向球心）
    };
  }
  function siteByName(name, P) { var q = SITES[name]; return q ? site(q.s, q.az, P) : null; }

  /* ───────── 四、遮挡 ───────── */
  // 塔是贯通两极的无限长圆柱：A→B 是否被挡，只看水平投影线段是否穿过半径 a 的圆
  function segBlocked(ax, az, bx, bz, a) {
    var dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    var u = L2 > 0 ? -(ax * dx + az * dz) / L2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    var cx = ax + u * dx, cz = az + u * dz;
    return cx * cx + cz * cz < a * a;
  }
  function blocked(A, B, P) { return segBlocked(A.x, A.z, B.x, B.z, D(P).a); }

  // 被一条直边切掉的圆盘还剩多少：x＝圆心到直边的有符号距离／半径（正＝在边外）
  function diskFrac(x) {
    if (x >= 1) return 1; if (x <= -1) return 0;
    return 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
  }
  // 从水平点 p 看半径 rho 的球 q：露在塔外的比例。塔缘是平行于塔轴的直线，故用 diskFrac 精确。
  function diskVisible(px, pz, qx, qz, rho, a) {
    var pr = Math.sqrt(px * px + pz * pz);
    if (pr <= a) return 0;
    var wx = qx - px, wz = qz - pz, wl = Math.sqrt(wx * wx + wz * wz);
    if (wl < 1e-9) return 1;
    var cx = -px / pr, cz = -pz / pr;                 // 指向塔轴
    var g = Math.asin(a / pr), Lt = Math.sqrt(pr * pr - a * a);
    var ang = Math.abs(Math.atan2((cx * wz - cz * wx) / wl, (wx * cx + wz * cz) / wl));
    var d = ang - g;                                   // >0：在塔的轮廓之外
    if (wl * Math.cos(d) <= Lt) return 1;              // 在切点之前：塔挡不着
    if (!(rho > 0)) return d > 0 ? 1 : 0;
    return diskFrac(wl * Math.sin(d) / rho);
  }
  // 点 X 处能看到的日面比例（1 全亮，0 在本影）
  function sunlitAt(X, t, P) { P = D(P); var S = sunPos(t, P); return diskVisible(X.x, X.z, S.x, S.z, P.rhoS, P.a); }
  // 月心受照比例：≥0.97 亮月，0.03–0.97 灰月，≤0.03 黑月（本影）
  function moonSunlit(t, P) { P = D(P); return sunlitAt(moonPos(t, P), t, P); }
  function moonState(t, P) { var f = moonSunlit(t, P); return f >= 0.97 ? '亮月' : f > 0.03 ? '灰月' : '黑月'; }
  function isBlackMoon(t, P) { return moonSunlit(t, P) < 0.5; }       // 统计口径：月心入影

  /* ───────── 五、观测 ───────── */
  function dot3(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
  function clamp1(x) { return x > 1 ? 1 : x < -1 ? -1 : x; }
  // 从地点 O 看天体 Q：el 重力仰角，elG 对地仰角（决定影长与气路），az 方位（北 0 东 90），diam 视径，vis 露出比例
  function look(O, Q, P) {
    P = D(P);
    var v = [Q.x - O.x, Q.y - O.y, Q.z - O.z], L = Math.sqrt(dot3(v, v));
    var az = Math.atan2(dot3(O.E, v), dot3(O.N, v)) * R2D; if (az < 0) az += 360;
    return {
      v: v, dist: L, az: az,
      el: Math.asin(clamp1(dot3(O.U, v) / L)) * R2D,
      elG: Math.asin(clamp1(dot3(O.n, v) / L)) * R2D,
      diam: 2 * Math.asin(Math.min(1, (Q.rho || 0) / L)) * R2D,
      vis: diskVisible(O.x, O.z, Q.x, Q.z, Q.rho || 0, P.a),
      hoff: Math.atan2(dot3(O.E, v), dot3(O.U, v)) * R2D   // 离塔中线的东西偏角（正＝东）
    };
  }
  // 相位角 α（日—月—人），亮面比例 k=(1+cosα)/2
  function phaseAngle(O, S, Mo) {
    var a = [S.x - Mo.x, S.y - Mo.y, S.z - Mo.z], b = [O.x - Mo.x, O.y - Mo.y, O.z - Mo.z];
    return Math.acos(clamp1(dot3(a, b) / Math.sqrt(dot3(a, a) * dot3(b, b))));
  }
  function litFraction(O, S, Mo) { return (1 + Math.cos(phaseAngle(O, S, Mo))) / 2; }

  // 当地时（小时，0＝子夜，12＝正午）
  function localHour(t, O, P) { P = D(P); return frac(t - (O.phi - P.phi0) / TAU) * P.dayHours; }
  // 地点 O 第 k 个当地子夜（k 为整数日）
  function localMidnight(k, O, P) { P = D(P); return k + (O.phi - P.phi0) / TAU; }

  // 太阳相对塔带的位置：behind 在塔后 / cut 正被塔缘切 / beside 贴在塔缘外 / front 亮日衬黑塔
  function sunAspect(O, t, P) {
    P = D(P);
    var S = sunPos(t, P), lk = look(O, S, P);
    var pr = Math.sqrt(O.x * O.x + O.z * O.z), g = Math.asin(P.a / pr) * R2D;
    var side = lk.hoff >= 0 ? '东' : '西';
    var kind = lk.vis <= 0.001 ? 'behind' : lk.vis < 0.999 ? 'cut' : (Math.abs(lk.hoff) < g ? 'front' : 'beside');
    return { kind: kind, side: side, vis: lk.vis, el: lk.el, az: lk.az, hoff: lk.hoff };
  }

  // 一日中昼的比例（闭式，日心判据）：[acos(a/r) + acos(a/dS)]/π
  function dayFraction(r, P) { P = D(P); return (Math.acos(P.a / r) + Math.acos(P.a / P.dS)) / Math.PI; }
  // 夜影边缘扫过地面的速度（km/分）
  function nightEdgeSpeed(r, P) { P = D(P); return TAU * r / (P.dayHours * 60); }
  // 日面被塔缘切没的时长（分），与地点无关
  function duskMinutes(P) { P = D(P); return 2 * P.rhoS / (TAU * Math.sqrt(P.dS * P.dS - P.a * P.a)) * P.dayHours * 60; }
  // 月心穿过半影（灰月）的时长（小时）＝ 日落时长 × M
  function greyHours(P) { P = D(P); return duskMinutes(P) * P.M / 60; }
  // 当日正午太阳的重力仰角（闭式）与南北
  function noonSun(O, t, P) {
    P = D(P);
    var yS = P.A * yearPhase(t, P), dy = yS - O.y;
    return { el: Math.atan2(O.r - P.dS, Math.abs(dy)) * R2D, dir: dy > 0 ? '南' : '北' };
  }
  // 巨塔在此地天上的样子
  function towerView(O, P) {
    P = D(P);
    var yb = Math.sqrt(P.R * P.R - P.a * P.a);
    function elTo(y) { var dx = O.r - P.a, dy = y - O.y; return Math.atan2(dx, Math.abs(dy)) * R2D; }
    return {
      width: 2 * Math.asin(P.a / O.r) * R2D,       // 头顶处的塔宽
      rootEl: elTo(-yb),                           // 塔根端（北）与地面相接处的仰角
      topEl: elTo(yb)                              // 塔顶端（南）的仰角
    };
  }
  function seasonAt(t, O, P) {
    P = D(P);
    var up = yearPhase(t, P) > 0;
    if (Math.abs(O.y) < 1e-6) return '赤道';
    return (up === (O.y < 0)) ? '冬' : '夏';
  }

  /* ───────── 六、历法 ───────── */
  var CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  function dayName(d) {
    if (d <= 10) return '初' + ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][d];
    if (d < 20) return '十' + ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][d - 10];
    if (d === 20) return '二十';
    if (d < 30) return '廿' + ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][d - 20];
    return '三十';
  }
  // 帝国 N 年 mo 月 d 日 当地 hour 时（方位 azDeg 的地方时）→ t
  function tOf(N, mo, d, hour, azDeg, P) {
    P = D(P);
    var az = azDeg == null ? P.epochAz : azDeg;
    return (N - P.epochYear) * P.Y + (mo - 1) * P.daysPerMonth + (d - 1) - P.winterDoy + (hour || 0) / P.dayHours + (az - P.epochAz) / 360;
  }
  // 某日“夜”的子夜（即次日 0 时）
  function nightOf(N, mo, d, azDeg, P) { return tOf(N, mo, d, 0, azDeg, P) + 1; }
  // t → 当地日期
  function dateOf(t, azDeg, P) {
    P = D(P);
    var az = azDeg == null ? P.epochAz : azDeg;
    var u = t - (az - P.epochAz) / 360 + P.winterDoy, yi = Math.floor(u / P.Y), rem = u - yi * P.Y;
    var mo = Math.floor(rem / P.daysPerMonth) + 1, dd = Math.floor(rem - (mo - 1) * P.daysPerMonth) + 1;
    return { year: P.epochYear + yi, month: mo, day: dd, hour: frac(rem) * P.dayHours,
      label: (P.epochYear + yi) + '年' + CN_NUM[mo] + '月' + dayName(dd) };
  }
  // 入冬后第几日、四年周期中的第几年（0＝庆典年）
  function yearDay(t, P) { P = D(P); return t - Math.floor(t / P.Y) * P.Y; }
  function cycleYear(t, P) { P = D(P); var k = Math.floor(t / P.Y) % 4; return k < 0 ? k + 4 : k; }
  // 交节：入冬（日往上过塔腰）、冬至（日在最高）、入夏（日往下过塔腰）、夏至（日在最低）
  function crossings(N, P) {
    P = D(P);
    var t0 = (N - P.epochYear) * P.Y;
    function at(t) { return { t: t, elong: elongation(t, P), sunlit: moonSunlit(t, P), date: dateOf(t, null, P).label }; }
    return { winter: at(t0), winterSolstice: at(t0 + P.Y / 4), summer: at(t0 + P.Y / 2), summerSolstice: at(t0 + 3 * P.Y / 4) };
  }
  // 庆典：入冬交节那一刻月心在塔影里
  function isFestival(N, P) { P = D(P); return moonSunlit((N - P.epochYear) * P.Y, P) < 0.5; }
  // 四年规则的余量（日）：各年入冬时 |Δ| 离黑月半角 β 还差几天
  function festivalMargin(P) {
    P = D(P);
    var rate = 360 / P.M, b = P.beta * R2D, m = Infinity;
    for (var k = 0; k < 4; k++) { var e = Math.abs(elongation(k * P.Y, P)); m = Math.min(m, Math.abs(e - b) / rate); }
    return m;
  }

  /* ───────── 七、光度 ───────── */
  // 大气顶的太阳照度：在法线 nrm（默认地面法线 O.n）上的 W/m² 与 lux
  function sunTOA(O, t, P, nrm) {
    P = D(P);
    var S = sunPos(t, P), lk = look(O, S, P), nn = nrm || O.n;
    var cosi = Math.max(0, dot3(nn, lk.v) / lk.dist), f = (P.Dref / lk.dist) * (P.Dref / lk.dist) * cosi * lk.vis;
    return { W: P.Sref * f, lux: P.Eref * f, normal: (P.Dref / lk.dist) * (P.Dref / lk.dist) * P.Eref, vis: lk.vis };
  }
  // 直射透过率（便捷估算）：exp(−τ/sin 对地仰角)
  function beamTransmission(elGdeg, P) { P = D(P); return Math.exp(-P.tauV / Math.max(Math.sin(elGdeg * D2R), 0.02)); }
  // 朗伯球的相位函数（满月＝1）
  function lambertPhase(al) { return (Math.sin(al) + (Math.PI - al) * Math.cos(al)) / Math.PI; }
  // 月光：在正对月亮的面上的大气顶照度（lux），被塔挡、黑月都会算进去
  function moonLux(O, t, P) {
    P = D(P);
    var S = sunPos(t, P), Mo = moonPos(t, P), lk = look(O, Mo, P);
    var dSM = Math.sqrt((S.x - Mo.x) * (S.x - Mo.x) + (S.y - Mo.y) * (S.y - Mo.y) + (S.z - Mo.z) * (S.z - Mo.z));
    var Esun = P.Eref * (P.Dref / dSM) * (P.Dref / dSM) * sunlitAt(Mo, t, P);
    var al = phaseAngle(O, S, Mo);
    return Esun * P.pMoon * (P.rhoM / lk.dist) * (P.rhoM / lk.dist) * lambertPhase(al) * lk.vis;
  }
  // 日面色温（由定标反推的黑体有效温度）
  function sunTemperature(P) {
    P = D(P);
    var w = P.rhoS / P.Dref; return Math.pow(P.Sref / (5.670374e-8 * w * w), 0.25);
  }

  // 射线 X + s·d（d 单位向量）先撞塔还是撞内壁
  function rayHit(X, d, P) {
    P = D(P);
    var b = X.x * d[0] + X.y * d[1] + X.z * d[2], c = X.x * X.x + X.y * X.y + X.z * X.z - P.R * P.R;
    var sW = -b + Math.sqrt(Math.max(0, b * b - c));
    var A = d[0] * d[0] + d[2] * d[2], B = X.x * d[0] + X.z * d[2], C = X.x * X.x + X.z * X.z - P.a * P.a;
    if (A > 1e-12) { var disc = B * B - A * C; if (disc > 0) { var s1 = (-B - Math.sqrt(disc)) / A; if (s1 > 1e-9 && s1 < sW) return { kind: 'tower', s: s1 }; } }
    return { kind: 'wall', s: sW, X: { x: X.x + sW * d[0], y: X.y + sW * d[1], z: X.z + sW * d[2] } };
  }
  // 对岸光：点 X、法线 nrm 上，来自被太阳照亮的对面内壁的照度（lux）。
  // 余弦加权分层采样；不计大气（大气按“守恒散射”近似为透明，吸收或静滞夜幕用 opt.veil 乘上去）。
  function farLight(X, nrm, t, P, opt) {
    P = D(P); opt = opt || {};
    var nT = opt.nTheta || 48, nP = opt.nPhi || 96, alb = opt.albedo == null ? P.albedoFar : opt.albedo;
    var S = sunPos(t, P);
    var n = nrm, h = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    var t1 = [n[1] * h[2] - n[2] * h[1], n[2] * h[0] - n[0] * h[2], n[0] * h[1] - n[1] * h[0]];
    var l1 = Math.sqrt(dot3(t1, t1)); t1 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
    var t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    var sum = 0, cnt = 0, X0 = { x: X.x + n[0] * 1e-3, y: X.y + n[1] * 1e-3, z: X.z + n[2] * 1e-3 };
    for (var i = 0; i < nT; i++) {
      var u = (i + 0.5) / nT, ct = Math.sqrt(1 - u), st = Math.sqrt(u);   // 余弦加权
      for (var j = 0; j < nP; j++) {
        var ph = TAU * (j + 0.5) / nP, a1 = st * Math.cos(ph), a2 = st * Math.sin(ph);
        var d = [n[0] * ct + t1[0] * a1 + t2[0] * a2, n[1] * ct + t1[1] * a1 + t2[1] * a2, n[2] * ct + t1[2] * a1 + t2[2] * a2];
        var hit = rayHit(X0, d, P); cnt++;
        if (hit.kind !== 'wall') continue;
        var W = hit.X, sv = [S.x - W.x, S.y - W.y, S.z - W.z], L = Math.sqrt(dot3(sv, sv));
        var cosi = -(W.x * sv[0] + W.y * sv[1] + W.z * sv[2]) / (P.R * L);
        if (cosi <= 0) continue;
        var vis = diskVisible(W.x, W.z, S.x, S.z, P.rhoS, P.a); if (vis <= 0) continue;
        var E = P.Eref * (P.Dref / L) * (P.Dref / L) * cosi * vis;
        sum += alb * E / Math.PI;      // 该方向上对岸的亮度（cd/m²）
      }
    }
    return Math.PI * sum / cnt * (opt.veil == null ? 1 : opt.veil);
  }

  /* ───────── 八、复合判定（统计口径） ───────── */
  // 夜里见到亮月：夜（日心被塔挡）∧ 月心受照 ≥0.5 ∧ 月心没被塔挡 ∧ 亮面 > 30%
  function litMoonVisible(O, t, P) {
    P = D(P);
    var S = sunPos(t, P); if (!segBlocked(O.x, O.z, S.x, S.z, P.a)) return null;
    var Mo = moonPos(t, P); if (diskVisible(Mo.x, Mo.z, S.x, S.z, P.rhoS, P.a) < 0.5) return null;
    var lk = look(O, Mo, P); if (lk.vis < 0.5) return null;
    var k = litFraction(O, S, Mo); if (k <= P.litMinK) return null;
    lk.k = k; return lk;
  }
  // 视线越过 Q 之后撞到什么：tower / lit（被太阳照着的内壁）/ dark
  function backdrop(O, Q, t, P, lateral) {
    P = D(P);
    var v = [Q.x - O.x, Q.y - O.y, Q.z - O.z];
    if (lateral) { // 沿水平垂直方向挪到月盘边缘
      var hx = -v[2], hz = v[0], hl = Math.sqrt(hx * hx + hz * hz);
      v = [v[0] + lateral * hx / hl, v[1], v[2] + lateral * hz / hl];
    }
    var L = Math.sqrt(dot3(v, v)), d = [v[0] / L, v[1] / L, v[2] / L];
    var hit = rayHit(O, d, P);
    if (hit.kind === 'tower') return 'tower';
    return sunlitAt(hit.X, t, P) >= 0.5 ? 'lit' : 'dark';
  }
  // 黑月高悬：夜 ∧ 月心受照 ≤0.1 ∧ 月露出 ≥0.9 ∧ 重力仰角 ≥ 门槛 ∧ 月心与月盘两缘背后都是被照亮的内壁
  function blackMoonHigh(O, t, P, minEl) {
    P = D(P);
    var S = sunPos(t, P); if (!segBlocked(O.x, O.z, S.x, S.z, P.a)) return null;
    var Mo = moonPos(t, P); if (diskVisible(Mo.x, Mo.z, S.x, S.z, P.rhoS, P.a) > 0.1) return null;
    var lk = look(O, Mo, P); if (lk.vis < 0.9 || lk.el < (minEl == null ? P.hangMinEl : minEl)) return null;
    if (backdrop(O, Mo, t, P, 0) !== 'lit' || backdrop(O, Mo, t, P, P.rhoM) !== 'lit' || backdrop(O, Mo, t, P, -P.rhoM) !== 'lit') return null;
    return lk;
  }
  // 日食：从 O 看，月盘遮住日面的比例（0 无）
  function eclipseFrac(O, t, P) {
    P = D(P);
    var S = sunPos(t, P), Mo = moonPos(t, P), ls = look(O, S, P);
    if (ls.vis <= 0) return 0;
    var lm = look(O, Mo, P); if (lm.dist >= ls.dist) return 0;
    var sep = Math.acos(clamp1(dot3(ls.v, lm.v) / (ls.dist * lm.dist)));
    var r1 = Math.asin(P.rhoS / ls.dist), r2 = Math.asin(Math.min(1, P.rhoM / lm.dist));
    if (sep >= r1 + r2) return 0;
    if (sep <= r2 - r1) return 1;
    if (sep <= r1 - r2) return (r2 * r2) / (r1 * r1);
    var c1 = Math.acos(clamp1((sep * sep + r1 * r1 - r2 * r2) / (2 * sep * r1)));
    var c2 = Math.acos(clamp1((sep * sep + r2 * r2 - r1 * r1) / (2 * sep * r2)));
    var ar = r1 * r1 * c1 + r2 * r2 * c2 - 0.5 * Math.sqrt(Math.max(0, (-sep + r1 + r2) * (sep + r1 - r2) * (sep - r1 + r2) * (sep + r1 + r2)));
    return ar / (Math.PI * r1 * r1);
  }

  // 一帧的天空：渲染直接用
  function sky(O, t, P) {
    P = D(P);
    var S = sunPos(t, P), Mo = moonPos(t, P), ls = look(O, S, P), lm = look(O, Mo, P);
    var sunlit = diskVisible(Mo.x, Mo.z, S.x, S.z, P.rhoS, P.a);
    return {
      t: t, hour: localHour(t, O, P), season: seasonAt(t, O, P),
      sun: { pos: S, el: ls.el, elG: ls.elG, az: ls.az, diam: ls.diam, vis: ls.vis, dist: ls.dist, hoff: ls.hoff },
      moon: { pos: Mo, el: lm.el, elG: lm.elG, az: lm.az, diam: lm.diam, vis: lm.vis, dist: lm.dist, hoff: lm.hoff,
        sunlit: sunlit, k: litFraction(O, S, Mo), state: sunlit >= 0.97 ? '亮月' : sunlit > 0.03 ? '灰月' : '黑月',
        elong: elongation(t, P), age: moonAge(t, P) },
      night: ls.vis < 0.5
    };
  }

  return {
    TAU: TAU, D2R: D2R, R2D: R2D, G0: G0,
    DEFAULTS: DEFAULTS, PRESETS: PRESETS, SITES: SITES, params: params,
    wrapDeg: wrapDeg, yearPhase: yearPhase, sunPos: sunPos, moonPos: moonPos, elongation: elongation,
    moonAge: moonAge, tForElong: tForElong, toInertial: toInertial, holdAccel: holdAccel,
    site: site, siteByName: siteByName,
    segBlocked: segBlocked, blocked: blocked, diskFrac: diskFrac, diskVisible: diskVisible,
    sunlitAt: sunlitAt, moonSunlit: moonSunlit, moonState: moonState, isBlackMoon: isBlackMoon,
    look: look, phaseAngle: phaseAngle, litFraction: litFraction, localHour: localHour, localMidnight: localMidnight,
    sunAspect: sunAspect, dayFraction: dayFraction, nightEdgeSpeed: nightEdgeSpeed, duskMinutes: duskMinutes,
    greyHours: greyHours, noonSun: noonSun, towerView: towerView, seasonAt: seasonAt,
    dayName: dayName, tOf: tOf, nightOf: nightOf, dateOf: dateOf, yearDay: yearDay, cycleYear: cycleYear,
    crossings: crossings, isFestival: isFestival, festivalMargin: festivalMargin,
    sunTOA: sunTOA, beamTransmission: beamTransmission, lambertPhase: lambertPhase, moonLux: moonLux,
    sunTemperature: sunTemperature, rayHit: rayHit, farLight: farLight,
    litMoonVisible: litMoonVisible, backdrop: backdrop, blackMoonHigh: blackMoonHigh, eclipseFrac: eclipseFrac, sky: sky
  };
});
