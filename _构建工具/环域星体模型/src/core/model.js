/* HY.model —— 当前参数 P、当前地点 O、此刻快照 now、缓存（规格：spec/03 第四节第 3 条；统筹修订见 spec/04）
 * 负责：A 路（核心计算）。自检：test/model_check.js。
 * 唯一写入者：本模块只读 HY.state，发 model 事件，不改状态。数字一律来自 HY.astro 与 HY.calc。
 *
 * 链接规则（03 第三节第 3 条）：astro.linkA 为真时，A 由回归纬线推（不用 astro.o.A）；astro.linkRM 为真时，rM 跟随 A
 *   （不用 astro.o.rM）。链接只管用户的覆盖项，预设（PRESETS）自带的 A、rM 照用——bing 预设本来就是一整套参数。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var M = HY.model = HY.model || {};
  var A = HY.astro, W = HY.world, U = HY.util, C = HY.calc;

  M.P = null; M.pv = 0; M.O = null; M.Z = null; M.now = null;
  var cache = [], nowKey = '';
  M.CACHE_SIZE = 16;

  // 当前参数：HY.astro.params(合并(PRESETS[preset], astro.o, 链接规则, {H: fp.atmo.HR, V: fp.atmo.V}, 定标))
  M.paramsFrom = function (state) {
    var s = state.astro, o = {}, k;
    var pre = A.PRESETS[s.preset] || {};
    for (k in pre) o[k] = pre[k];
    var so = s.o || {};
    for (k in so) {
      if (so[k] == null) continue;
      if (k === 'A' && s.linkA) continue;            // A 由回归纬线推
      if (k === 'rM' && s.linkRM) continue;          // rM 跟随 A
      o[k] = so[k];
    }
    if (s.calib === '1361') { o.Sref = 1361; o.Eref = null; }   // 按地球太阳常数定标：照度 ×1.78（01 第九节第 1 条）
    if (state.fp && state.fp.atmo) { o.H = state.fp.atmo.HR; o.V = state.fp.atmo.V; }
    return A.params(o);
  };
  M.siteKey = function () { var s = HY.state.site; return Number(s.s).toFixed(4) + '|' + Number(s.az).toFixed(4); };

  M.rebuildP = function () {
    M.P = M.paramsFrom(HY.state);
    M.Z = U.clone(HY.state.zones);
    M.pv++; cache.length = 0; nowKey = '';
    M.rebuildO(true);
    if (HY.bus) HY.bus.emit('model', { what: 'P', pv: M.pv });
  };
  M.rebuildO = function (quiet) {
    var st = HY.state.site, P = M.P;
    var O = A.site(st.s, st.az, P), z = W.zoneOf(st.s, P, M.Z), q = st.id ? W.siteById(st.id, P) : null;
    O.id = st.id; O.name = q ? q.name : '自定义地点'; O.short = q ? q.short : '此地'; O.zone = z;
    M.O = O; nowKey = '';
    if (!quiet && HY.bus) HY.bus.emit('model', { what: 'site', pv: M.pv });
  };
  M.rebuild = function () { M.rebuildP(); M.tick(); };

  // 按 (pv, siteKey, …keyParts) 缓存，LRU 16 项；P 一重建就清空
  M.cached = function (name, keyParts, fn) {
    var key = name + '|' + M.pv + '|' + M.siteKey() + '|' + (keyParts || []).join('|');
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].k === key) { var hit = cache.splice(i, 1)[0]; cache.unshift(hit); return hit.v; }
    }
    var v = fn();
    cache.unshift({ k: key, v: v });
    if (cache.length > M.CACHE_SIZE) cache.length = M.CACHE_SIZE;
    return v;
  };
  M.cacheSize = function () { return cache.length; };

  // app 每帧调一次；同一 (t, pv, siteKey, 年号口径, 历法格式) 不重算。返回 now
  M.tick = function () {
    if (!M.P) M.rebuildP();
    var t = HY.state.time.t, key = t + '|' + M.pv + '|' + M.siteKey() + '|' + W.CAL.yearStart + '|' + W.CAL.style;
    if (key === nowKey && M.now) return M.now;
    nowKey = key;
    M.now = snapshot(t, M.O, M.P);
    return M.now;
  };

  /* 此刻快照（03 第四节第 3 条；统筹修订：date 用 HY.calc.civil 的新形状，另加 cal 给 HY.world.fmtCal）
   * season、seasonDay：历法上的季（与“入冬后第 d 日”同一套当地日，在当地子夜换）；物理上的季（HY.astro.seasonAt，
   *   在交节那一刻换）放在 seasonAstro，两者只在交节前后不到一日里可能不同。 */
  function snapshot(t, O, P) {
    var sk = A.sky(O, t, P), asp = A.sunAspect(O, t, P), tv = A.towerView(O, P), df = A.dayFraction(O.r, P);
    var date = C.civil(t, O.az, P), hour = sk.hour, so = C.seasonOf(t, O, P);
    var mn = C.moonNight(O, t, P), ill = C.illum(O, t, P);
    var bh = A.blackMoonHigh(O, t, P), lit = A.litMoonVisible(O, t, P);
    var cal = { N: date.N, cyc: date.cyc, festival: date.festival, wd: date.wd, hour: hour, season: so.season, seasonDay: so.n,
      moonState: sk.moon.state, moonNight: mn.night };
    return {
      t: t, date: date, hour: hour, shichen: C.shichen(hour), hhmm: C.hhmm(hour),
      season: so.season, seasonDay: so.n, seasonAstro: sk.season, cycleYear: date.cyc, festivalYear: date.festival,
      nextWinter: (Math.floor(t / P.Y) + 1) * P.Y,
      cal: cal, calText: W.fmtCal(cal, 'full'),
      night: sk.night,
      sun: { el: sk.sun.el, elG: sk.sun.elG, az: sk.sun.az, hoff: sk.sun.hoff, diam: sk.sun.diam, vis: sk.sun.vis, dist: sk.sun.dist,
        aspect: asp.kind, side: asp.side },
      moon: { el: sk.moon.el, elG: sk.moon.elG, az: sk.moon.az, hoff: sk.moon.hoff, diam: sk.moon.diam, vis: sk.moon.vis, dist: sk.moon.dist,
        sunlit: sk.moon.sunlit, k: sk.moon.k, state: sk.moon.state, elong: sk.moon.elong, age: sk.moon.age,
        night: mn.night, since: mn.since, blackHigh: !!bh, litVisible: !!lit },
      eclipse: A.eclipseFrac(O, t, P),
      tower: tv,
      dayH: df * P.dayHours, nightH: (1 - df) * P.dayHours,
      site: { id: O.id, name: O.name, s: O.s, az: O.az, r: O.r, g: O.g, lat: O.lat, zone: O.zone },
      illum: { sunLux: ill.sunLux, sunLuxGround: ill.sunLuxGround, moonLux: ill.moonLux }
    };
  }
  M._snapshot = snapshot;

  // 听状态：astro、zones、fp.atmo.HR/V 变 → 重建 P；site 变 → 重建 O
  function atmoTouched(e) {
    var ps = (e && (e.paths || [e.path])) || [];
    return ps.some(function (p) { return p === 'fp' || p === 'fp.atmo' || p === 'fp.atmo.HR' || p === 'fp.atmo.V'; });
  }
  if (HY.bus && !M._wired) {
    M._wired = true;
    HY.bus.on('astro', function () { if (M.P) M.rebuildP(); });
    HY.bus.on('zones', function () { if (M.P) M.rebuildP(); });
    HY.bus.on('fp', function (e) {
      if (!M.P || !atmoTouched(e)) return;
      var P2 = M.paramsFrom(HY.state);
      if (P2.H !== M.P.H || P2.V !== M.P.V) M.rebuildP();
    });
    HY.bus.on('site', function () { if (M.P) M.rebuildO(false); });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
