/* HY.calc —— 图表与读数用的表、事件搜索、照度估算（规格：spec/03 第四节第 2 条；统筹修订见 spec/04）
 * 负责：A 路（核心计算）。自检：test/calc_check.js。
 * 纯函数：全部显式传入 P（HY.astro.params 的结果）与地点 O（HY.astro.site 的结果），不读 HY.state。
 * 日月几何、遮挡、月态、统计口径一律调用 HY.astro，本文件只做取样、积分、搜索与历法换算。
 *
 * 当地日：方位 az 处，t 换成“当地日数” tl＝t − (az − epochAz)/360（与 HY.astro.tOf／dateOf 同一换算），
 *   tl 为整数的时刻是当地子夜。某日“夜”＝该日傍晚到次日黎明，以次日 0 时（子夜）为准（01 第七节第 2 条）。
 * 日面露出只取决于日、地的水平位置，所以按当地时严格以日为周期：日出日落、一日五段每天落在同一钟点，
 *   只算一次（sunSpan），各日平移即可；季节只改变太阳的高度。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var C = HY.calc = HY.calc || {};
  var A = HY.astro, W = HY.world, U = HY.util;

  C.__stubs = [];

  var EPS = 1e-9;                     // 日；比较“在 t 之后”时用（约 0.1 毫秒）
  var KEYS = ['winter', 'winterSolstice', 'summer', 'summerSolstice'];
  var KEY_NAMES = { winter: '入冬', winterSolstice: '冬至', summer: '入夏', summerSolstice: '夏至' };
  C.CROSSING_NAMES = KEY_NAMES;

  /* ───────── 当地日 ───────── */
  function azOf(az, P) { return az == null ? P.epochAz : az; }
  function lt(t, az, P) { return t - (azOf(az, P) - P.epochAz) / 360; }        // 当地日数（整数＝当地子夜）
  function midT(k, az, P) { return k + (azOf(az, P) - P.epochAz) / 360; }      // 第 k 个当地子夜的 t
  function minPerDay(P) { return P.dayHours * 60; }
  // t 所在的“夜”：以子夜为中心、正午到正午的一段；返回那一夜子夜的编号
  function nightK(t, az, P) { return Math.floor(lt(t, az, P) + 0.5); }
  // 按日出分夜：日出（当地日分数 rise）之后到下一个日出算一夜，白天归入即将到来的那一夜；返回那一夜子夜的编号
  function riseK(t, O, P, rise) { return Math.ceil(W.snapDay(lt(t, O.az, P) - rise)); }
  C.localDay = function (t, az, P) { return Math.floor(lt(t, az, P)); };
  C.localMidnight = function (k, az, P) { return midT(k, az, P); };
  /* nightMidnight(t, az, P, O?)：“今夜”的子夜。
   *   不给 O：正午到正午算一夜（上午算刚过去的那一夜）。
   *   给了 O：与 moonNight 同一数法，日出（日心露出）到下一个日出算一夜，白天归入即将到来的那一夜；塔基按正午。 */
  C.nightMidnight = function (t, az, P, O) {
    if (!O) return midT(nightK(t, az, P), az, P);
    var sp = sunSpan(O, P);
    return midT(riseK(t, O, P, sp ? sp.rise : 0.5), O.az, P);
  };

  /* ───────── 数值小工具 ───────── */
  // 二分找“谓词由 pa 变到 !pa”的点：pred(lo)＝pa、pred(hi)＝!pa；返回跨过之后那一侧的端点
  function edge(pred, lo, hi, pa, iters) {
    for (var i = 0; i < (iters || 40); i++) {
      var m = 0.5 * (lo + hi);
      if (pred(m) === pa) lo = m; else hi = m;
    }
    return hi;
  }
  // 高斯—勒让德求积节点（Newton 迭代求 Legendre 多项式的根），按 n 缓存
  var GL = {};
  function gauss(n) {
    if (GL[n]) return GL[n];
    var x = [], w = [];
    for (var i = 1; i <= n; i++) {
      var z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp = 1;
      for (var it = 0; it < 100; it++) {
        var p1 = 1, p2 = 0;
        for (var j = 1; j <= n; j++) { var p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
        pp = n * (z * p1 - p2) / (z * z - 1);
        var z1 = z; z = z1 - p1 / pp;
        if (Math.abs(z - z1) < 1e-15) break;
      }
      x.push(z); w.push(2 / ((1 - z * z) * pp * pp));
    }
    return (GL[n] = { x: x, w: w });
  }
  function integrate(fn, a, b, n) {
    if (!(b > a)) return 0;
    var g = gauss(n), h = 0.5 * (b - a), c = 0.5 * (a + b), s = 0;
    for (var i = 0; i < g.x.length; i++) s += g.w[i] * fn(c + h * g.x[i]);
    return s * h;
  }

  /* ───────── 历法（统筹修订：界面不显示“几月初几”） ─────────
   * civil(t, az, P) → { N, wd, doy, rel, hour, cyc, festival, mo, d, label }
   *   N        年号（口径见 HY.world.CAL.yearStart，默认沿用 HY.astro.dateOf 的帝国年）
   *   wd       入冬后第几日（1–Y，方位 az 的地方日）
   *   doy      本年第几日（0–Y−1，从年号口径的岁首起）——一年图、日期滑杆的横轴
   *   rel      相对“第 N 年入冬交节”的整日数（可负；与 HY.world.MARKS 的 rel 同一口径）
   *   hour     地方时 0–24
   *   cyc      庆典周期第几年（1＝庆典年；＝离最近一个不晚于 N 的庆典年几年＋1；12 年内没有庆典则为 null）
   *   festival HY.astro.isFestival(N)：第 N 年的入冬交节是否庆典
   *   mo, d    旧民用月日——只供与 HY.astro.tOf 对照，界面不显示
   *   label    HY.world.fmtCal(…, 'full') 的年＋入冬后日（不含季与月）
   */
  function cycOf(N, P) {
    for (var j = 0; j < 12; j++) if (A.isFestival(N - j, P)) return j + 1;
    return null;
  }
  C.cycleOf = cycOf;
  C.civil = function (t, az, P) {
    az = azOf(az, P);
    var tl = W.snapDay(lt(t, az, P));        // 子夜整点吸附，免得浮点误差把 0 时算成前一日 24 时
    var shift = W.yearStartT(P.epochYear, P) - W.winterT(P.epochYear, P);
    var N = P.epochYear + Math.floor((tl - shift) / P.Y);
    var t0 = W.yearStartT(N, P), tw = W.winterT(N, P);
    var doy = Math.floor(tl - t0), wd = Math.floor(U.mod(tl, P.Y)) + 1;
    var hour = U.frac(tl) * P.dayHours;
    var cyc = cycOf(N, P), festival = A.isFestival(N, P);
    // 旧民用月日：与 HY.astro.dateOf 同式，只是用吸附过的当地日（子夜整点与 wd 一致）
    var rem = U.mod(tl + P.winterDoy, P.Y), mo = Math.floor(rem / P.daysPerMonth) + 1, d = Math.floor(rem - (mo - 1) * P.daysPerMonth) + 1;
    var r = { N: N, wd: wd, doy: U.clamp(doy, 0, P.Y - 1), rel: Math.floor(tl - tw), hour: hour, cyc: cyc, festival: festival, mo: mo, d: d };
    r.label = W.fmtCal({ N: N, cyc: cyc, festival: festival, wd: wd }, 'full');
    return r;
  };
  C.tOfCivil = function (N, doy, hour, az, P) {
    return W.yearStartT(N, P) + doy + (hour || 0) / P.dayHours + (azOf(az, P) - P.epochAz) / 360;
  };
  // 第 N 年“入冬后第 wd 日”hour 时（方位 az 的地方时）；落在第 N 年（按年号口径）里的那一天
  C.tOfWd = function (N, wd, hour, az, P) {
    var span = W.yearSpan(N, P, azOf(az, P));
    var t = W.winterT(N, P) + (wd - 1) + (hour || 0) / P.dayHours + (azOf(az, P) - P.epochAz) / 360;
    while (t < span[0] - EPS) t += P.Y;
    while (t >= span[1] - EPS) t -= P.Y;
    return t;
  };
  /* 历法上的季（与“入冬后第 d 日”同一套当地日）：塔根半球入冬后前半年为冬、后半年为夏，塔顶半球相反，赤道无季。
   * 返回 {season:'冬'|'夏'|'赤道', n（第几日；赤道为 null）, wd}。
   * 注：物理上的季（HY.astro.seasonAt）在交节那一刻换；历法上的季在当地子夜换，两者只在交节前后不到一日里可能不同。 */
  C.seasonOf = function (t, O, P) {
    var wd = Math.floor(U.mod(W.snapDay(lt(t, O.az, P)), P.Y)) + 1, half = P.Y / 2, first = (wd - 1) < half;
    if (Math.abs(O.y) < 1e-6) return { season: '赤道', n: null, wd: wd };
    var winter = first === (O.y < 0);
    return { season: winter ? '冬' : '夏', n: first ? wd : wd - Math.ceil(half), wd: wd };
  };
  var BR = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  // 子时＝23–1 时；每个时辰前一小时为“初”、后一小时为“正”，每刻 15 分（初、一、二、三刻，没有“四刻”）。非有限数给“—”（下同）
  //   先按分钟取整，与 hhmm 同一口径：由 t 倒推的钟点常比整点小 1e-12，直接向下取整会把 23:00 读成“亥时正四刻”
  C.shichen = function (hour) {
    if (!isFinite(hour)) return '—';
    var m = Math.round(U.mod(hour, 24) * 60) % 1440, mm = (m + 60) % 1440, i = Math.floor(mm / 120), w = mm - 120 * i;
    var half = w < 60 ? '初' : '正', k = Math.min(3, Math.floor((w % 60) / 15));
    return BR[i] + '时' + half + (k ? U.cnNum(k) + '刻' : '');
  };
  C.hhmm = function (hour) {
    if (!isFinite(hour)) return '—';
    var m = Math.round(U.mod(hour, 24) * 60) % 1440;
    return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60);
  };
  // 方位（北 0、东 90）→ '正南' | '南偏西 8°' | '东偏北 5°' …：以最近的正方向为准；正好在两者中间（45°）时以南北为准
  C.dirName = function (azDeg) {
    if (!isFinite(azDeg)) return '—';
    var a = U.wrap360(azDeg), names = { 0: '北', 90: '东', 180: '南', 270: '西' }, q = a / 90, k = Math.round(q);
    if (Math.abs(q - Math.floor(q) - 0.5) < 1e-9 && k % 2 === 1) k = Math.floor(q);   // 舍入落到东西，改取相邻的南北
    var c = U.mod(k * 90, 360), dev = U.wrapDeg(a - c);
    if (Math.abs(dev) < 0.5) return '正' + names[c];
    var toward = names[U.mod(c + (dev > 0 ? 90 : -90), 360)];
    return names[c] + '偏' + toward + ' ' + Math.round(Math.abs(dev)) + '°';
  };
  C.km = function (v) { return U.thousands(v, 0) + ' 公里'; };

  /* ───────── 日面露出的一日（每地一份，按当地时以日为周期） ─────────
   * sunSpan(O, P) → { dawn0, rise, dawn1, dusk0, set, dusk1 }：当地日内的日分数（0＝子夜，0.5＝正午）
   *   dawn0 东缘开始切出（露出 0.001）· rise 日心露出（0.5）· dawn1 全露（0.999）
   *   dusk0 开始被西缘切（0.999）· set 日心没入（0.5）· dusk1 全没（0.001）
   * 塔基里（终日不见日）返回 null。上午露出单调增、下午单调减，所以各用一次二分（误差远小于 1 秒）。
   */
  var spLast = { O: null, P: null, x: NaN, z: NaN, az: NaN, v: null };   // 同一地点、同一 P 连着调（每帧的 moonNight）只算一次
  function sunSpan(O, P) {
    if (spLast.O === O && spLast.P === P && spLast.x === O.x && spLast.z === O.z && spLast.az === O.az) return spLast.v;
    var m0 = midT(0, O.az, P), v = null;
    function vis(f) { return A.sunlitAt(O, m0 + f, P); }
    function up(level) { return edge(function (f) { return vis(f) >= level; }, 0, 0.5, false, 44); }
    function down(level) { return edge(function (f) { return vis(f) < level; }, 0.5, 1, false, 44); }
    if (vis(0.5) >= 0.5) v = { dawn0: up(0.001), rise: up(0.5), dawn1: up(0.999), dusk0: down(0.999), set: down(0.5), dusk1: down(0.001) };
    spLast = { O: O, P: P, x: O.x, z: O.z, az: O.az, v: v };
    return v;
  }
  C.sunSpan = function (O, P) { var v = sunSpan(O, P); return v && U.clone(v); };
  // “夜”（日心被塔挡）的起止：子夜 tm 前一个日落到后一个日出；塔基里取正午到正午
  function nightWindow(tm, sp) { return sp ? [tm - (1 - sp.set), tm + sp.rise] : [tm - 0.5, tm + 0.5]; }

  // 一日剂量（MJ/m²，大气顶，地面法线）：子夜 m 起的当地日；切入、全露、切没三段各用高斯求积
  function doseDay(O, m, sp, P) {
    if (!sp) return 0;
    function W_(f) { return A.sunTOA(O, m + f, P).W; }
    var s = integrate(W_, sp.dawn0, sp.dawn1, 8) + integrate(W_, sp.dawn1, sp.dusk0, 16) + integrate(W_, sp.dusk0, sp.dusk1, 8);
    return s * P.daySec / 1e6;
  }

  /* ───────── 一夜的月（统计口径：01 第十一节，判定全部调用 HY.astro） ─────────
   * nightStats(O, tm, P, stepMin, sp) → { t: 子夜, from, to: 夜（日心被塔挡）的起止,
   *   litMin 夜里见到亮月的分钟（litMoonVisible）, blackHighMin 黑月高悬的分钟（blackMoonHigh）,
   *   litSeen, blackHighSeen（累计 ≥ P.minMinutes）, kMax 见到时的最大亮面, litElMax 及其时刻 tLitMax, hangElMax }
   * 粗步取样（默认 4 分）；相邻两样的判定不同时二分出边界，所以分钟数基本不受步长影响。
   */
  function nightStats(O, tm, P, stepMin, sp) {
    if (sp === undefined) sp = sunSpan(O, P);
    var w = nightWindow(tm, sp), h = (stepMin || 4) / minPerDay(P);
    var n = Math.max(2, Math.ceil((w[1] - w[0]) / h)), dt = (w[1] - w[0]) / n, e = 1e-7;
    var ts = [], lit = [], hang = [];
    var r = { t: tm, from: w[0], to: w[1], litMin: 0, blackHighMin: 0, litSeen: false, blackHighSeen: false,
      kMax: 0, litElMax: null, tLitMax: null, hangElMax: null };
    for (var i = 0; i <= n; i++) {
      var t = i === 0 ? w[0] + e : i === n ? w[1] - e : w[0] + i * dt;
      var f = A.moonSunlit(t, P), L = null, B = null;
      if (f >= 0.5) L = A.litMoonVisible(O, t, P); else if (f <= 0.1) B = A.blackMoonHigh(O, t, P);
      ts.push(t); lit.push(!!L); hang.push(!!B);
      if (L) {
        if (L.k > r.kMax) r.kMax = L.k;
        if (r.litElMax == null || L.el > r.litElMax) { r.litElMax = L.el; r.tLitMax = t; }
      }
      if (B && (r.hangElMax == null || B.el > r.hangElMax)) r.hangElMax = B.el;
    }
    var mpd = minPerDay(P);
    r.litMin = measure(ts, lit, function (x) { return !!A.litMoonVisible(O, x, P); }) * mpd;
    r.blackHighMin = measure(ts, hang, function (x) { return !!A.blackMoonHigh(O, x, P); }) * mpd;
    r.litSeen = r.litMin >= P.minMinutes;
    r.blackHighSeen = r.blackHighMin >= P.minMinutes;
    return r;
  }
  // 布尔量在取样点之间的总时长：判定变了的那一步二分出边界（10 次，步长的 1/1024）
  function measure(ts, ps, pred) {
    var sum = 0;
    for (var i = 0; i < ts.length - 1; i++) {
      var a = ts[i], b = ts[i + 1];
      if (ps[i] === ps[i + 1]) { if (ps[i]) sum += b - a; continue; }
      var x = edge(pred, a, b, ps[i], 10);
      sum += ps[i] ? x - a : b - x;
    }
    return sum;
  }
  C.nightStats = function (O, tm, P, stepMin) { return nightStats(O, tm, P, stepMin); };

  // 子夜 tm 是不是庆典夜（庆典年入冬交节前夜：此地当地日“入冬后第 Y 日”之夜）
  function festivalNightAt(tm, az, P) {
    var k = Math.round(lt(tm, az, P));
    if (Math.abs(lt(tm, az, P) - k) > 1e-6 || U.mod(k, P.Y) !== 0) return false;
    return A.isFestival(P.epochYear + Math.round(k / P.Y), P);
  }
  // 子夜 tm 处的月（此地）
  function moonAtMidnight(O, tm, P) {
    var sk = A.sky(O, tm, P), m = sk.moon;
    return { state: m.state, black: A.isBlackMoon(tm, P), sunlit: m.sunlit, k: m.k, el: m.el, az: m.az, diam: m.diam, vis: m.vis };
  }

  /* ───────── 一日 ─────────
   * dayStats(O, tMid, P, n = 288)：tMid 所在的那个当地日（从当地子夜起）。
   *   dayH, nightH（日心判据，二分求得，误差＜1 秒）, doseMJ, noonEl, noonDir,
   *   dawn {t, hour}（东缘开始切出）, dusk {t, hour}（开始被西缘切没）, rise, set（日心露出、没入）,
   *   segs：一日五段 [{kind:'behind'|'cut'|'beside'|'front', side:'东'|'西'|'中', t0, t1}]（front 跨正午，side 记 '中'），
   *   sun：Float32Array(n) 第 i 个为 tMid + i/n 时的重力仰角（日面全在塔后时为 NaN），hoff：同上，离塔中线的偏角（正＝东），
   *   moon：每 15 分一个 {t, el, az, sunlit, k, vis, state, blackHigh, litVisible}
   */
  C.dayStats = function (O, tMid, P, n) {
    n = n || 288;
    var k = Math.floor(lt(tMid, O.az, P) + 1e-6), m = midT(k, O.az, P), sp = sunSpan(O, P);
    var hpd = P.dayHours, r = { tMid: m, dayH: 0, nightH: hpd, doseMJ: 0, noonEl: NaN, noonDir: '', dawn: null, dusk: null, rise: null, set: null, segs: [] };
    var ns = A.noonSun(O, m + 0.5, P); r.noonEl = ns.el; r.noonDir = ns.dir;
    function at(f) { return { t: m + f, hour: f * hpd }; }
    if (sp) {
      r.dayH = (sp.set - sp.rise) * hpd; r.nightH = hpd - r.dayH;
      r.dawn = at(sp.dawn0); r.dusk = at(sp.dusk0); r.rise = at(sp.rise); r.set = at(sp.set);
      r.doseMJ = doseDay(O, m, sp, P);
      // 衬塔段（|hoff| 小于塔的半张角）：上午、下午各二分一次
      var isFront = function (f) { return A.sunAspect(O, m + f, P).kind === 'front'; };
      var f0 = 0.5, f1 = 0.5;
      if (isFront(0.5)) {
        f0 = isFront(sp.dawn1) ? sp.dawn1 : edge(isFront, sp.dawn1, 0.5, false, 44);
        f1 = isFront(sp.dusk0) ? sp.dusk0 : edge(function (f) { return !isFront(f); }, 0.5, sp.dusk0, false, 44);
      }
      var B = [['behind', '东', 0, sp.dawn0], ['cut', '东', sp.dawn0, sp.dawn1], ['beside', '东', sp.dawn1, f0], ['front', '中', f0, f1],
        ['beside', '西', f1, sp.dusk0], ['cut', '西', sp.dusk0, sp.dusk1], ['behind', '西', sp.dusk1, 1]];
      B.forEach(function (b) { if (b[3] - b[2] > 1e-12) r.segs.push({ kind: b[0], side: b[1], t0: m + b[2], t1: m + b[3] }); });
    } else r.segs.push({ kind: 'behind', side: '', t0: m, t1: m + 1 });
    var sun = new Float32Array(n), hoff = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = A.sunAspect(O, m + i / n, P);
      sun[i] = a.kind === 'behind' ? NaN : a.el; hoff[i] = a.hoff;
    }
    r.sun = sun; r.hoff = hoff;
    var moon = [];
    for (var j = 0; j < 96; j++) {
      var t = m + j / 96, sk = A.sky(O, t, P).moon;
      moon.push({ t: t, el: sk.el, az: sk.az, sunlit: sk.sunlit, k: sk.k, vis: sk.vis, state: sk.state,
        blackHigh: !!A.blackMoonHigh(O, t, P), litVisible: !!A.litMoonVisible(O, t, P) });
    }
    r.moon = moon;
    return r;
  };

  /* ───────── 一年 ─────────
   * yearTable(O, N, P, opt) → { N, festival, t0（本年第 0 日的当地子夜）, wd0（第 0 日是入冬后第几日）,
   *   noonEl: Float32Array(Y), doseMJ: Float32Array(Y), nightH,
   *   nights: [{doy, t（该日之夜的子夜）, state, black（月心入影，01 口径）, sunlit, k, el, az, diam,
   *            litMin, blackHighMin, litSeen, blackHighSeen, kMax, festival}],
   *   marks: [{doy, label, kind, tbd, id, wd, t, note}]（HY.world.markList），
   *   seasons: [{season, from, to}]（此地物理季，doy 坐标，可为小数）, crossings: [{key, name, t, doy}] }
   * 横轴一律是 doy（第 N 年按年号口径的第几日）；入冬后第几日＝(wd0 − 1 + doy) mod Y + 1。
   * opt：{ yuxiLead（余息标记，取 fp.set.yuxiLead）, stepMin（夜内取样步长，默认 12 分；边界另行二分） }
   */
  C.yearTable = function (O, N, P, opt) {
    opt = opt || {};
    var Y = Math.round(P.Y), span = W.yearSpan(N, P, O.az), t0 = span[0], sp = sunSpan(O, P);
    var noonEl = new Float32Array(Y), dose = new Float32Array(Y), nights = [], step = opt.stepMin || 12;
    for (var d = 0; d < Y; d++) {
      var m = t0 + d;
      noonEl[d] = A.noonSun(O, m + 0.5, P).el;
      dose[d] = doseDay(O, m, sp, P);
      var tm = m + 1, ns = nightStats(O, tm, P, step, sp), mo = moonAtMidnight(O, tm, P);
      nights.push({ doy: d, t: tm, state: mo.state, black: mo.black, sunlit: mo.sunlit, k: mo.k, el: mo.el, az: mo.az, diam: mo.diam,
        litMin: ns.litMin, blackHighMin: ns.blackHighMin, litSeen: ns.litSeen, blackHighSeen: ns.blackHighSeen, kMax: ns.kMax,
        festival: festivalNightAt(tm, O.az, P) });
    }
    var marks = W.markList(N, P, { az: O.az, yuxiLead: opt.yuxiLead }).map(function (q) {
      return { doy: q.doy, label: q.label, kind: q.kind, tbd: q.tbd, id: q.id, wd: q.wd, t: q.t, note: q.note };
    });
    // 物理季：交节在 t＝kY/2（伊美忒子夜），换成此地 doy
    var seasons = [], half = P.Y / 2, kc = Math.floor(t0 / half), hemi = Math.abs(O.y) < 1e-6 ? 0 : O.y < 0 ? -1 : 1;
    for (var q = kc; q * half < t0 + P.Y; q++) {
      var a = Math.max(t0, q * half), b = Math.min(t0 + P.Y, (q + 1) * half);
      if (b <= a) continue;
      var up = A.yearPhase(0.5 * (a + b), P) > 0;
      seasons.push({ season: hemi === 0 ? '赤道' : (up === (hemi < 0) ? '冬' : '夏'), from: a - t0, to: b - t0 });
    }
    var cr = C.crossingsInYear(N, P, O.az).map(function (c) { return { key: c.key, name: c.name, t: c.t, doy: c.t - t0 }; });
    return {
      N: N, festival: A.isFestival(N, P), t0: t0, wd0: Math.floor(U.mod(lt(t0 + 0.5, O.az, P), P.Y)) + 1,
      noonEl: noonEl, doseMJ: dose, nightH: (1 - A.dayFraction(O.r, P)) * P.dayHours,
      nights: nights, marks: marks, seasons: seasons, crossings: cr
    };
  };

  /* ───────── 子午线剖面 ─────────
   * meridian(tMidRef, az, P, Z, n = 161) → { s, nightH, doseMJ, noonEl, noonDir, towerW, g, lat, zone（id）, bounds }
   * 方位 az 的一条经线，从塔根（s＝0）到塔顶（s＝πR）；tMidRef 所在的当地日（这条经线上各点同一个当地日）。
   * 塔基里（离轴 ≤ 塔半径）的夜长、剂量、正午日高、塔宽为 NaN。
   */
  C.meridian = function (tMidRef, az, P, Z, n) {
    n = n || 161;
    var m = midT(Math.floor(lt(tMidRef, az, P) + 1e-6), az, P);
    var out = { s: [], nightH: [], doseMJ: [], noonEl: [], noonDir: [], towerW: [], g: [], lat: [], zone: [], bounds: W.zoneBounds(P, Z), tMid: m };
    for (var i = 0; i < n; i++) {
      var s = Math.PI * P.R * i / (n - 1), O = A.site(s, az, P), z = W.zoneOf(s, P, Z);
      out.s.push(s); out.g.push(O.g); out.lat.push(O.lat); out.zone.push(z.id);
      if (!(O.r > P.a * (1 + 1e-9))) { out.nightH.push(NaN); out.doseMJ.push(NaN); out.noonEl.push(NaN); out.noonDir.push(''); out.towerW.push(NaN); continue; }
      var sp = sunSpan(O, P), ns = A.noonSun(O, m + 0.5, P);
      out.nightH.push((1 - A.dayFraction(O.r, P)) * P.dayHours);
      out.doseMJ.push(doseDay(O, m, sp, P));
      out.noonEl.push(ns.el); out.noonDir.push(ns.dir);
      out.towerW.push(A.towerView(O, P).width);
    }
    return out;
  };

  /* ───────── 本朔望月（黑月正中到下一个黑月正中） ─────────
   * month(O, t, P) → { tStart, tEnd, tonight（“今夜”在 nights 里的下标，不在本月为 −1；“今夜”与 moonNight
   *   同一数法：白天归入即将到来的那一夜，即 nightMidnight(t, az, P, O)）,
   *   nights: [{t（子夜）, date（该日之夜的 civil）, k, sunlit, state, black, el, az, diam, vis,
   *            litMin, blackHighMin, litSeen, blackHighSeen, kMax, festival}] }
   * 每夜取此地子夜的月相；亮月、黑月高悬的时长按夜内 4 分步取样（边界二分）。
   */
  C.month = function (O, t, P, opt) {
    opt = opt || {};
    var tStart = t - A.moonAge(t, P) * P.M, tEnd = tStart + P.M, sp = sunSpan(O, P);
    var k0 = Math.ceil(lt(tStart, O.az, P) - 1e-9), nights = [], kt = riseK(t, O, P, sp ? sp.rise : 0.5), tonight = -1;
    for (var K = k0; midT(K, O.az, P) < tEnd; K++) {
      var tm = midT(K, O.az, P), ns = nightStats(O, tm, P, opt.stepMin || 4, sp), mo = moonAtMidnight(O, tm, P);
      if (K === kt) tonight = nights.length;
      nights.push({ t: tm, date: C.civil(tm - 0.5, O.az, P), k: mo.k, sunlit: mo.sunlit, state: mo.state, black: mo.black,
        el: mo.el, az: mo.az, diam: mo.diam, vis: mo.vis, litMin: ns.litMin, blackHighMin: ns.blackHighMin,
        litSeen: ns.litSeen, blackHighSeen: ns.blackHighSeen, kMax: ns.kMax, festival: festivalNightAt(tm, O.az, P) });
    }
    return { tStart: tStart, tEnd: tEnd, tonight: tonight, nights: nights };
  };

  /* ───────── 庆典、交节、黑月期 ───────── */
  // 某一刻离“月心入影／出影”（|Δ|＝β）最近还差几天：tForElong 给出方位差为 ±β 的时刻族
  function marginAt(t, P) {
    var b = P.beta * A.R2D, best = Infinity;
    [b, -b].forEach(function (e) {
      var base = A.tForElong(e, P), k = Math.round((t - base) / P.M);
      for (var j = k - 1; j <= k + 1; j++) best = Math.min(best, Math.abs(t - (base + j * P.M)));
    });
    return best;
  }
  // festivals(N0, count, P) → [{N, t（入冬交节）, elong, sunlit, state, festival, marginDays}]
  //   marginDays：交节那一刻离月心入影／出影还差几天（四年规则的余量；四年里最小的一个＝HY.astro.festivalMargin）
  C.festivals = function (N0, count, P) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var N = N0 + i, t = W.winterT(N, P), sl = A.moonSunlit(t, P);
      out.push({ N: N, t: t, elong: A.elongation(t, P), sunlit: sl, state: A.moonState(t, P), festival: A.isFestival(N, P), marginDays: marginAt(t, P) });
    }
    return out;
  };
  // crossings(N, P)：HY.astro.crossings（第 N 年入冬起的四个交节）＋ 伊美忒地方的 civil、文字、月态
  //   HY.astro 给的 date 是旧民用月日（“十一月初一”），界面不许出现，这里换成与 label 相同的新历法文字
  C.crossings = function (N, P) {
    var c = A.crossings(N, P);
    KEYS.forEach(function (k) {
      var x = c[k];
      x.key = k; x.name = KEY_NAMES[k];
      x.civil = C.civil(x.t, P.epochAz, P);
      x.label = x.date = W.fmtCal({ N: x.civil.N, cyc: x.civil.cyc, festival: x.civil.festival, wd: x.civil.wd }, 'full');
      x.state = A.moonState(x.t, P); x.black = x.sunlit < 0.5;
    });
    c.winter.festival = A.isFestival(N, P);
    return c;
  };
  // 落在第 N 年（按年号口径，方位 az 的地方日）里的交节，按时间排序：[{key, name, t, elong, sunlit, state, black, civil, label}]
  C.crossingsInYear = function (N, P, az) {
    var span = W.yearSpan(N, P, azOf(az, P)), out = [];
    for (var n = N - 1; n <= N + 1; n++) {
      var c = C.crossings(n, P);
      KEYS.forEach(function (k) { if (c[k].t >= span[0] && c[k].t < span[1]) out.push(c[k]); });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  };
  /* blackPeriods(N, O, P) → [{from:{wd, rel, N, doy}, to:{…}, nights, t0, t1}]
   * 01 第七节第 4 条的口径：此地子夜逢黑月（HY.astro.isBlackMoon，月心入影）的连续“某日夜”；from/to 是这些夜的日子。
   * 收录与第 N 年有交集的黑月期（跨年的整段给出）；rel 一律相对第 N 年的入冬交节（当地日），wd 是入冬后第几日。
   */
  C.blackPeriods = function (N, O, P) {
    var Y = Math.round(P.Y), span = W.yearSpan(N, P, O.az), t0 = span[0], pad = Math.ceil(P.M) + 2;
    var relShift = Math.round(W.yearStartT(N, P) - W.winterT(N, P)), out = [], run = null;
    function day(d) {
      var rel = d + relShift;
      return { wd: U.mod(rel, Y) + 1, rel: rel, N: C.civil(t0 + d + 0.5, O.az, P).N, doy: d };
    }
    function push(r) {
      if (r.d1 < 0 || r.d0 >= Y) return;
      out.push({ from: day(r.d0), to: day(r.d1), nights: r.d1 - r.d0 + 1, t0: t0 + r.d0 + 1, t1: t0 + r.d1 + 1 });
    }
    for (var d = -pad; d < Y + pad; d++) {
      if (A.isBlackMoon(t0 + d + 1, P)) { if (run) run.d1 = d; else run = { d0: d, d1: d }; }
      else if (run) { push(run); run = null; }
    }
    if (run) push(run);
    return out;
  };

  /* ───────── 跳转搜索 ─────────
   * findNext(kind, O, t, P, dir = 1) → t | null：严格晚于 t 的下一个（dir＝1），或严格早于 t 的上一个（dir＝−1）
   *   'dawn' 东缘开始切出 · 'noon' · 'dusk' 开始被西缘切没 · 'midnight'（按当地时周期，精确）
   *   'winter' | 'winterSolstice' | 'summer' | 'summerSolstice'（交节时刻，HY.astro.crossings）
   *   'festivalNight' 庆典年入冬前夜 21 时（此地地方时，HY.world.MARKS.festival）· 'festivalCross' 庆典交节那一刻
   *   'blackCenter' 黑月正中（日、塔、月一线）
   *   'blackHigh' 此地黑月高悬开始（逐夜 10 分粗步后二分；整夜月亮都亮着的夜直接跳过；搜两年）
   *   'litMoonNight' 此地今夜亮月最高时（逐夜 10 分粗步，最高处附近 1 分细查；搜 60 夜）
   *   'eclipse' 此地日食（eclipseFrac＞0.5）开始（搜两年）。步长按“日月视距离 − 两盘半径”除以视角速度上界自适应，
   *     最小 1 分；离得远时一步可跨几小时，不会跳过任何一次日食。（03 原写“只在 |Δ|＜12° 的日子里查”不成立：
   *     日食在 |Δ| 由 5° 到 105° 都会发生。）
   */
  C.findNext = function (kind, O, t, P, dir) {
    dir = dir === -1 ? -1 : 1;
    if (!isFinite(t)) return null;
    switch (kind) {
      case 'dawn': case 'dusk': {
        var sp = sunSpan(O, P);
        return sp ? periodic(t, O.az, P, kind === 'dawn' ? sp.dawn0 : sp.dusk0, dir) : null;
      }
      case 'noon': return periodic(t, O.az, P, 0.5, dir);
      case 'midnight': return periodic(t, O.az, P, 0, dir);
      case 'winter': case 'winterSolstice': case 'summer': case 'summerSolstice': return nextCrossing(kind, t, P, dir);
      case 'festivalNight': case 'festivalCross': return nextFestival(kind, O, t, P, dir);
      case 'blackCenter': return nextBlackCenter(t, P, dir);
      case 'blackHigh': return nextBlackHigh(O, t, P, dir);
      case 'litMoonNight': return nextLitMoonPeak(O, t, P, dir);
      case 'eclipse': return nextEclipse(O, t, P, dir);
      default:
        if (G.console) G.console.warn('[HY.calc] findNext：不认识的 kind “' + kind + '”');
        return null;
    }
  };
  C.FIND_KINDS = ['dawn', 'noon', 'dusk', 'midnight', 'winter', 'winterSolstice', 'summer', 'summerSolstice',
    'festivalNight', 'festivalCross', 'blackCenter', 'blackHigh', 'litMoonNight', 'eclipse'];

  // 当地日内固定的日分数 f（0＝子夜）
  function periodic(t, az, P, f, dir) {
    var k = Math.floor(lt(t, az, P) - f), tau = midT(k, az, P) + f;
    if (dir > 0) { while (tau <= t + EPS) { k++; tau = midT(k, az, P) + f; } }
    else { while (tau >= t - EPS) { k--; tau = midT(k, az, P) + f; } }
    return tau;
  }
  function nextCrossing(key, t, P, dir) {
    var N = P.epochYear + Math.floor(t / P.Y) + (dir > 0 ? -1 : 1);
    for (var i = 0; i < 6; i++, N += dir) {
      var tau = A.crossings(N, P)[key].t;
      if (dir > 0 ? tau > t + EPS : tau < t - EPS) return tau;
    }
    return null;
  }
  function nextFestival(kind, O, t, P, dir) {
    var N = P.epochYear + Math.floor(t / P.Y) + (dir > 0 ? -1 : 1);
    for (var i = 0; i < 400; i++, N += dir) {
      var tau = kind === 'festivalCross' ? W.winterT(N, P) : W.markT('festival', N, O.az, P);
      if ((dir > 0 ? tau > t + EPS : tau < t - EPS) && A.isFestival(N, P)) return tau;
    }
    return null;
  }
  function nextBlackCenter(t, P, dir) {
    var tau = t - A.moonAge(t, P) * P.M;
    if (dir > 0) { while (tau <= t + EPS) tau += P.M; }
    else { while (tau >= t - EPS) tau -= P.M; }
    return tau;
  }
  // 区间 [a, b] 里谓词由假变真（按时间正向）的全部时刻：粗步 h，变化处二分 40 次
  function starts(pred, a, b, h) {
    var n = Math.max(1, Math.ceil((b - a) / h)), dt = (b - a) / n, out = [], pa = pred(a);
    for (var i = 1; i <= n; i++) {
      var x = a + i * dt, px = pred(x);
      if (!pa && px) out.push(edge(pred, x - dt, x, false, 40));
      pa = px;
    }
    return out;
  }
  function pickFirst(list, t, dir) {
    var best = null;
    list.forEach(function (x) {
      if (dir > 0 ? x > t + EPS && (best == null || x < best) : x < t - EPS && (best == null || x > best)) best = x;
    });
    return best;
  }
  function nextBlackHigh(O, t, P, dir) {
    var sp = sunSpan(O, P), h = 10 / minPerDay(P), K0 = nightK(t, O.az, P), maxN = Math.ceil(2 * P.Y);
    var pred = function (x) { return !!A.blackMoonHigh(O, x, P); };
    for (var j = 0; j < maxN; j++) {
      var tm = midT(K0 + dir * j, O.az, P), w = nightWindow(tm, sp);
      if (dir > 0 ? w[1] + h < t : w[0] - h > t) continue;
      // 黑月高悬要求月心受照 ≤ 0.1；一夜里方位差只变 5° 上下，受照随 |Δ| 单调，夜首、夜中、夜尾都亮就整夜亮
      if (A.moonSunlit(w[0], P) > 0.1 && A.moonSunlit(0.5 * (w[0] + w[1]), P) > 0.1 && A.moonSunlit(w[1], P) > 0.1) continue;
      var x = pickFirst(starts(pred, w[0] - h, w[1] + h, h), t, dir);
      if (x != null) return x;
    }
    return null;
  }
  // 一夜里亮月（litMoonVisible）最高的时刻；没有亮月返回 null
  function litPeak(O, tm, P, sp) {
    var w = nightWindow(tm, sp), h = 10 / minPerDay(P), n = Math.max(2, Math.ceil((w[1] - w[0]) / h)), dt = (w[1] - w[0]) / n;
    var best = null, bestEl = -Infinity, i, x, L;
    for (i = 0; i <= n; i++) {
      x = w[0] + i * dt; L = A.litMoonVisible(O, x, P);
      if (L && L.el > bestEl) { bestEl = L.el; best = x; }
    }
    if (best == null) return null;
    var m1 = 1 / minPerDay(P), c = best;
    for (i = -10; i <= 10; i++) {
      x = c + i * m1; L = A.litMoonVisible(O, x, P);
      if (L && L.el > bestEl) { bestEl = L.el; best = x; }
    }
    return { t: best, el: bestEl };
  }
  function nextLitMoonPeak(O, t, P, dir) {
    var sp = sunSpan(O, P), K0 = nightK(t, O.az, P);
    for (var j = 0; j < 60; j++) {
      var pk = litPeak(O, midT(K0 + dir * j, O.az, P), P, sp);
      if (pk && (dir > 0 ? pk.t > t + EPS : pk.t < t - EPS)) return pk.t;
    }
    return null;
  }
  C.litPeak = function (O, tm, P) { return litPeak(O, tm, P, sunSpan(O, P)); };
  // 日食：自适应步长。gap＝日月视距离 − 两盘视半径；视角速度上界 w＝|V日|/d日 ＋ |V月|/d月（速度取数值差分），
  //   一步不超过 gap·(1−q)/w，且距离在一步里最多缩到 (1−q) 倍（q＝0.5），所以不会一步跨过一次日食。
  function eclipseStep(O, t, P) {
    var S = A.sunPos(t, P), Mo = A.moonPos(t, P), ls = A.look(O, S, P), lm = A.look(O, Mo, P);
    var c = U.v3.dot(ls.v, lm.v) / (ls.dist * lm.dist), sep = Math.acos(U.clamp(c, -1, 1));
    var gap = sep - Math.asin(Math.min(1, P.rhoS / ls.dist)) - Math.asin(Math.min(1, P.rhoM / lm.dist));
    if (gap <= 0) return 0;
    var dd = 1e-4, S2 = A.sunPos(t + dd, P), M2 = A.moonPos(t + dd, P);
    var vS = Math.sqrt(sq(S2.x - S.x) + sq(S2.y - S.y) + sq(S2.z - S.z)) / dd;
    var vM = Math.sqrt(sq(M2.x - Mo.x) + sq(M2.y - Mo.y) + sq(M2.z - Mo.z)) / dd;
    var q = 0.5, w = vS / ls.dist + vM / lm.dist;
    return Math.min(gap * (1 - q) / w, q * ls.dist / vS, q * lm.dist / vM);
  }
  function sq(x) { return x * x; }
  function nextEclipse(O, t, P, dir) {
    var pred = function (x) { return A.eclipseFrac(O, x, P) > 0.5; };
    var H = 2 * P.Y, minStep = 1 / minPerDay(P), maxStep = 0.25;
    var a = t, pa = pred(a);
    while (Math.abs(a - t) < H) {
      var b = a + dir * U.clamp(eclipseStep(O, a, P), minStep, maxStep), pb = pred(b);
      // 正向时间里“由假变真”的一刻：dir＝1 时是 a→b，dir＝−1 时是 b→a
      var lo = dir > 0 ? a : b, hi = dir > 0 ? b : a, plo = dir > 0 ? pa : pb, phi = dir > 0 ? pb : pa;
      if (!plo && phi) {
        var x = edge(pred, lo, hi, false, 40);
        if (dir > 0 ? x > t + EPS : x < t - EPS) return x;
      }
      a = b; pa = pb;
    }
    return null;
  }

  /* ───────── 照度估算（总览读数用；第一人称用 02 的实测值） ─────────
   * illum(O, t, P, opt) → { sunW, sunLux（大气顶，落在地面上）, sunLuxGround（× 直射透过率，01 的便捷估算）,
   *   sunNormalLux（大气顶、正对太阳）, moonLux（大气顶、正对月亮）, moonLuxGround（× 透过率）,
   *   farLuxUpper（对岸光上限，只在 opt.far 时算：12×24 粗采样；opt.veil 为乘在上面的夜幕透过率）| null, est: true }
   */
  C.illum = function (O, t, P, opt) {
    opt = opt || {};
    var st = A.sunTOA(O, t, P), ls = A.look(O, A.sunPos(t, P), P), lm = A.look(O, A.moonPos(t, P), P);
    var ml = A.moonLux(O, t, P), far = null;
    if (opt.far) far = A.farLight(O, O.n, t, P, { nTheta: opt.nTheta || 12, nPhi: opt.nPhi || 24, veil: opt.veil });
    return {
      sunW: st.W, sunLux: st.lux, sunLuxGround: st.lux * A.beamTransmission(ls.elG, P), sunNormalLux: st.normal * st.vis,
      moonLux: ml, moonLuxGround: ml * A.beamTransmission(lm.elG, P),
      farLuxUpper: far, est: true
    };
  };

  /* ───────── 月态第几夜（统筹修订） ─────────
   * moonNight(O, t, P) → { state（此刻的月态，同 HY.astro.moonState）, night（此刻月态的第几夜，1 起）,
   *   since（此刻月态开始的时刻）, tm（今夜子夜）, nightState（今夜子夜的月态） }
   * 数法：此地每一“夜”从日出（日心露出）后算到下一个日出，白天归入即将到来的那一夜（白天看读数，说的是“今夜”）。
   *   月态开始的那一夜是第 1 夜，此后每过一个日出加一。月态在后半夜才变的，那几个钟头就是第 1 夜，下一夜是第 2 夜；
   *   在白天或前半夜变的，当夜就是第 1 夜。塔基（终日不见日）按正午分夜。
   * 月态只取决于方位差（HY.astro.moonSunlit），回溯时每步 1 小时（灰月最短也有十几小时，跳不过），变化处二分 40 次。
   */
  // 上一次的结果：每帧时间只挪一点、月态没变时直接沿用（两次相隔不到 10 分钟，中间不可能换过两回月态）
  var ssLast = { P: null, s: '', t: NaN, since: null };
  function stateSince(t, P) {
    var s = A.moonState(t, P);
    if (ssLast.P === P && ssLast.s === s && ssLast.since != null && t >= ssLast.since && Math.abs(t - ssLast.t) <= 1 / 144) {
      ssLast.t = t; return ssLast.since;
    }
    var h = 1 / 24, x = t, n = Math.ceil(2 * P.M / h), since = null;
    for (var i = 0; i < n; i++) {
      var y = x - h;
      if (A.moonState(y, P) !== s) { since = edge(function (z) { return A.moonState(z, P) === s; }, y, x, false, 40); break; }
      x = y;
    }
    ssLast.P = P; ssLast.s = s; ssLast.t = t; ssLast.since = since;
    return since;                     // null：两个朔望月里月态都没变（参数极端时），不数
  }
  C.moonNight = function (O, t, P) {
    var sp = sunSpan(O, P), rise = sp ? sp.rise : 0.5;
    var s = A.moonState(t, P), since = stateSince(t, P), K = riseK(t, O, P, rise), tm = midT(K, O.az, P);
    return { state: s, night: since == null ? null : K - riseK(since, O, P, rise) + 1, since: since, tm: tm, nightState: A.moonState(tm, P) };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
