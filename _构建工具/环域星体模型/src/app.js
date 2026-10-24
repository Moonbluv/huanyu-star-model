/* HY.app —— 启动、帧循环、视图切换、测试与取数接口（规格：spec/03 第五节第 3 条、第十四节）
 * 负责：D 路。第一人称取数一律转给 HY.fp.api（G 路，定义在 fp/camera.js）。
 * 每个模块的 init 都包在 try/catch 里：失败发 error 事件，界面在对应位置显示一句中文说明，其余照常。
 * 写入的状态：time.t（播放推进 src:'play'；测试接口 'jump'/'api'）、view.mode（第一人称不可用或启动失败时退回 'ov'）、
 *   ov.preset（从第一人称回到总览、且没有自定相机时切到“此地上空”）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var app = HY.app = HY.app || {};
  var doc = G.document;

  var last = 0, hidden = false, booted = false, charts = {}, size = { w: 1, h: 1 };
  var perf = { fps: 0, cpuMs: 0, frames: 0 };
  var active = null;            // 正在出图的视图：HY.ov | HY.fp | null
  var fpFail = '';              // 第一人称上一次启动失败的原因（失败后按钮置灰并带说明）
  var pending = null;           // 正在进行的“进入第一人称”（Promise → 是否已切过去）
  var disposeTimer = null;
  var frameErr = { n: 0, t: 0 };  // 视图 frame() 连续抛错的次数与上次报告的时刻
  app.MOBILE_Q = '(pointer: coarse) and (max-width: 767px)';
  app.DISPOSE_MS = 60000;       // 低档与手机：离开第一人称 60 s 后释放 GPU 资源（03 第七节第 4 条）

  function log(e) { if (G.console) G.console.error(e); }
  function msgOf(e) { return (e && e.message) || String(e); }
  function safe(part, fn) {
    try { return fn(); } catch (e) {
      log(e);
      if (HY.bus) HY.bus.emit('error', { part: part, message: msgOf(e) });
      return undefined;
    }
  }
  function $(id) { return doc.getElementById(id); }
  function L() { return HY.ui && HY.ui.layout ? HY.ui.layout : null; }
  function toast(m) { var l = L(); if (l && l.toast) l.toast(m); }
  function isMobile() { return !!(G.matchMedia && G.matchMedia(app.MOBILE_Q).matches); }
  app.isMobile = isMobile;

  /* 第一人称能不能进：三维没起来、没有 WebGL2、fp.supported() 说不行、上次启动失败，都不行 */
  app.fpAvail = function () {
    var caps = HY.gfx && HY.gfx.caps;
    if (!caps || !caps.ok) return { ok: false, reason: (caps && caps.reason) || '三维视图还没有启动' };
    if (!caps.webgl2) return { ok: false, reason: '第一人称需要 WebGL2，这个浏览器不支持' };
    var sup = null;
    try { sup = HY.fp && HY.fp.supported ? HY.fp.supported() : null; } catch (e) { sup = { ok: false, reason: msgOf(e) }; }
    if (!sup || !sup.ok) return { ok: false, reason: (sup && sup.reason) || '第一人称不可用' };
    if (fpFail) return { ok: false, reason: fpFail };
    return { ok: true, reason: '', degraded: !!sup.degraded };
  };
  // 此刻出图的是哪个视图：'ov' | 'fp' | null（三维没起来）
  app.active = function () { return active === HY.fp ? 'fp' : active === HY.ov ? 'ov' : null; };

  /* ───────── 启动（03 第十四节第 1 条） ───────── */
  app.boot = function () {
    if (booted) return; booted = true;
    var mobile = isMobile();
    safe('store', function () { HY.store.load({ mobile: mobile }); });
    safe('model', function () { HY.model.rebuild(); });
    safe('ui', function () { HY.ui.layout.init(); });
    ['timebar', 'sitecard', 'readouts', 'calendar', 'notes', 'fphud'].forEach(function (k) {
      safe('ui', function () { if (HY.ui[k] && HY.ui[k].init) HY.ui[k].init(); });
    });
    safe('ui', function () { HY.ui.params.init($('params')); });
    safe('charts', initCharts);
    // 三维：THREE 没加载上时降级说明，图表与读数照常
    safe('gfx', function () {
      var caps = HY.gfx.init($('gl'));
      if (!caps.ok) { if (L()) L().fallback(caps.reason); return; }
      try { HY.ov.init(HY.gfx); HY.ov.activate(); active = HY.ov; }
      catch (e) { log(e); HY.bus.emit('error', { part: 'ov', message: msgOf(e) }); }
    });
    safe('ui', function () { HY.ui.keys.init(); });
    HY.bus.on('layout', resize);
    HY.bus.on('view', onView);
    HY.bus.on('fp', function (e) { if (HY.ui.touches(e, 'fp.quality')) resize(); });     // 档位决定画布的像素比
    var st = $('stage');
    if (G.ResizeObserver && st) new G.ResizeObserver(HY.util.throttle(resize, 50)).observe(st);
    resize();
    if (HY.state.view.mode === 'fp') onView();
    G.addEventListener('pagehide', function () { HY.store.flush(); });
    hidden = doc.visibilityState === 'hidden';
    doc.addEventListener('visibilitychange', function () { hidden = doc.visibilityState === 'hidden'; });
    G.requestAnimationFrame(loop);
    HY.bus.emit('ready', { part: 'ui' });
    HY.bus.emit('ready', { part: 'charts' });
  };

  function initCharts() {
    var map = { sky: 'cSky', day: 'cDay', month: 'cMonth', year: 'cYear', helix: 'cHelix', meridian: 'cMerid' };
    Object.keys(map).forEach(function (k) {
      var c = $(map[k]);
      if (c) safe('charts', function () { charts[k] = HY.charts.create(k, c, {}); });
    });
    function all(reason) { Object.keys(charts).forEach(function (k) { safe('charts', function () { charts[k].update(reason); }); }); }
    var onTime = HY.util.throttle(function () { all('time'); }, 100);     // ≤10 Hz，最后一次一定会到
    HY.bus.on('time', function (e) { if (!e || e.path === 'time.t' || e.path === 'time') onTime(); });
    HY.bus.on('model', function (e) { all(e && e.what === 'site' ? 'site' : 'model'); });
    HY.bus.on('zones', function () { all('zones'); });
    HY.bus.on('layout', function () { all('resize'); });
    HY.bus.on('ui', function (e) { if (e && (e.path === 'ui.tab' || e.path === 'ui' || e.path === 'ui.panel')) all('visible'); });
    all('visible');
  }
  app.charts = function () { return charts; };

  function resize() {
    var st = $('stage'); if (!st || !HY.gfx) return;
    var r = st.getBoundingClientRect(), fpOn = active === HY.fp;
    var cap = fpOn ? ({ low: 1, mid: 1.5, high: 2, photo: 2 }[HY.state.fp.quality] || 1.5) : 2;
    var s = safe('gfx', function () { return HY.gfx.resize(Math.max(1, r.width), Math.max(1, r.height), cap); });
    if (s) size = s;
    safe('ov', function () { HY.ov.resize(size.w, size.h); });
    safe('fp', function () { HY.fp.resize(size.w, size.h); });
  }
  app.resize = resize;

  /* ───────── 视图切换（03 第五节第 3 条） ─────────
   * 进第一人称：第一次先 HY.fp.init（期间总览照常出图，画布上盖进度条；Esc 或按 1 取消）；
   *   就绪后 HY.ov.deactivate() → 黑场 200 ms → HY.fp.activate()。失败：提示原因，退回总览，按钮置灰。
   * 回总览：HY.fp.deactivate() → HY.ov.activate()；没有自定相机时切到“此地上空”。低档或手机 60 s 后释放第一人称。
   */
  // 载荷可能是整个 view 对象（patch／load／reset），一律以 HY.state.view.mode 为准
  function onView() { if (HY.state.view.mode === 'fp') enterFp(); else leaveFp(); }
  app._onView = onView;          // 测试用（test/ui_check.js 在 node 里挂同一个监听器）
  function backToOv() { if (HY.state.view.mode !== 'ov') HY.store.set('view.mode', 'ov', 'api'); }
  function enterFp() {
    clearTimeout(disposeTimer); disposeTimer = null;
    if (active === HY.fp) return pending || Promise.resolve(true);
    var av = app.fpAvail();
    if (!av.ok) { toast('第一人称暂不可用：' + av.reason); backToOv(); return Promise.resolve(false); }
    if (pending) return pending;
    var p0;
    try { p0 = HY.fp.status().phase === 'ready' ? Promise.resolve() : Promise.resolve(HY.fp.init(HY.gfx)); }
    catch (err) { p0 = Promise.reject(err); }
    pending = p0.then(function () {
      if (L()) L().progress(null);
      if (HY.state.view.mode !== 'fp') return false;            // 准备期间被取消
      return new Promise(function (res) {
        var swap = function () {
          if (HY.state.view.mode !== 'fp') { res(false); return; }
          safe('ov', function () { HY.ov.deactivate(); });
          var ok = safe('fp', function () { HY.fp.activate(); return true; });
          if (!ok) { safe('ov', function () { HY.ov.activate(); }); fpFail = '第一人称没能切换过去'; backToOv(); res(false); return; }
          active = HY.fp;
          resize();
          HY.bus.emit('ready', { part: 'fp' });
          res(true);
        };
        if (L() && L().fade) L().fade(swap); else swap();
      });
    }, function (err) {
      if (L()) L().progress(null);
      fpFail = msgOf(err) || '原因不明';
      HY.bus.emit('error', { part: 'fp', message: '第一人称没能启动：' + fpFail });
      backToOv();
      return false;
    }).then(function (ok) { pending = null; return ok; });
    return pending;
  }
  function leaveFp() {
    if (active !== HY.fp) return;
    safe('fp', function () { HY.fp.deactivate(); });
    active = null;
    safe('ov', function () {
      if (HY.ov.status().phase !== 'ready') return;
      HY.ov.activate(); active = HY.ov;
      if (HY.state.ov.cam == null) {
        HY.store.set('ov.preset', 'above', 'ui');
        HY.ov.preset('above', { animate: false });
      }
    });
    resize();
    if (active === HY.ov) HY.bus.emit('ready', { part: 'ov' });
    else HY.bus.emit('error', { part: 'ov', message: '总览没能接回来（三维视图不可用）' });
    if (HY.state.fp.quality === 'low' || isMobile()) {
      disposeTimer = setTimeout(function () {
        disposeTimer = null;
        if (active !== HY.fp && HY.state.view.mode !== 'fp') safe('fp', function () { HY.fp.dispose(); });
      }, app.DISPOSE_MS);
    }
  }

  /* ───────── 帧循环（03 第十四节第 2 条） ───────── */
  function loop(ts) {
    G.requestAnimationFrame(loop);
    if (hidden) { last = ts; return; }                       // 页面隐藏：不推进时间、不出图（不改 playing）
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    step(Math.max(0, Math.min(dt, 0.1)));
  }
  function step(dtReal) {
    var t0 = HY.util.now(), st = HY.state, dtSim = 0;
    if (st.time.playing) {
      var sp = st.view.mode === 'fp' ? st.time.speed.fp : st.time.speed.ov;
      dtSim = dtReal * sp / 86400;
      if (dtSim) HY.store.set('time.t', st.time.t + dtSim, 'play');
    }
    var now = HY.model.tick();
    var ctx = { t: st.time.t, dtReal: dtReal, dtSim: dtSim, w: size.w, h: size.h, now: now, view: app.active() };
    var v = active;
    if (v) {
      try { v.frame(ctx); frameErr.n = 0; }
      catch (e) {
        // 每帧都抛的错只报一次（之后每 5 秒提醒一次），免得控制台与提示条被 60 Hz 的同一条错误淹没
        var tNow = HY.util.now();
        if (!frameErr.n || tNow - frameErr.t > 5000) {
          frameErr.t = tNow; log(e);
          HY.bus.emit('error', { part: v === HY.fp ? 'fp' : 'ov', message: msgOf(e) });
        }
        frameErr.n++;
      }
    }
    HY.bus.emit('frame', ctx);
    perf.frames++;
    perf.cpuMs = 0.9 * perf.cpuMs + 0.1 * (HY.util.now() - t0);
    if (dtReal > 0) perf.fps = perf.fps ? 0.95 * perf.fps + 0.05 / dtReal : 1 / dtReal;
  }

  /* ───────── 取数与测试接口（03 第十四节第 3 条） ───────── */
  // 'ov' | 'fp'；第一人称就绪后 resolve，不可用或启动失败时 reject（带中文原因）
  // set 发出的 view 事件已经走了 onView → enterFp（不可用时那里已提示并退回总览）；这里只等结果，不再进第二次
  //   （否则不可用时会提示两遍）。没挂监听器（未启动）或本来就是 'fp'（没发事件）时才自己进。
  app.view = function (mode) {
    HY.store.set('view.mode', mode, 'api');
    if (mode !== 'fp') return Promise.resolve();
    if (!pending && active !== HY.fp && HY.state.view.mode === 'fp') enterFp();
    var p = pending || Promise.resolve(active === HY.fp);
    return p.then(function (ok) { if (!ok) throw new Error(fpFail || app.fpAvail().reason || '已取消'); });
  };
  // id（HY.world.SITES 的 id）| {s, az, id?}
  app.setSite = function (q) {
    var P = HY.model.P;
    if (typeof q === 'string') {
      var s = HY.world.siteById(q, P);
      if (!s) throw new Error('没有地点 ' + q);
      HY.store.patch('site', { id: s.id, s: s.s, az: s.az }, 'api');
    } else HY.store.patch('site', { id: q.id == null ? null : q.id, s: q.s == null ? HY.state.site.s : q.s, az: q.az == null ? HY.state.site.az : q.az }, 'api');
  };
  /* t（日）| {year, wd, hour}（第 year 年“入冬后第 wd 日”，按 HY.world.CAL.yearStart 的年号口径）
   *        | {year, doy, hour}（第 year 年的第 doy 日，0 起）| {year, month, day, hour}（旧民用月日，只为对照 02、03 的测量表）
   * hour 为当前地点的地方时（可带小数）；返回写入的 t */
  app.setTime = function (q) {
    var t, P = HY.model.P, az = HY.state.site.az;
    if (typeof q === 'number') t = q;
    else if (q.wd != null) t = HY.calc.tOfWd(q.year, q.wd, q.hour || 0, az, P);
    else if (q.doy != null) t = HY.calc.tOfCivil(q.year, q.doy, q.hour || 0, az, P);
    else t = HY.astro.tOf(q.year, q.month, q.day, q.hour || 0, az, P);
    HY.store.set('time.t', t, 'jump');
    return HY.state.time.t;
  };
  app.play = function (on, speed) {
    HY.store.set('time.playing', !!on, 'api');
    if (speed != null) HY.store.set(HY.state.view.mode === 'fp' ? 'time.speed.fp' : 'time.speed.ov', speed, 'api');
  };
  app.look = function (yaw, pitch, fov) { return HY.fp.api.look(yaw, pitch, fov); };
  app.ovPreset = function (name) {
    HY.store.patch('ov', { preset: name, cam: null }, 'api');
    return HY.ov.preset(name, { animate: false });
  };
  // 不等 rAF，直接连跑 n 帧（每帧 1/60 秒真实时间）
  app.settle = function (n) {
    for (var i = 0; i < (n || 1); i++) step(1 / 60);
    return Promise.resolve();
  };
  app.readPx = function (x, y) {
    if (active === HY.fp) return HY.fp.api.readPx(x, y);
    return HY.ov && HY.ov.readPx ? HY.ov.readPx(x, y) : null;     // 总览：显示值 [r, g, b]
  };
  app.Eh = function () {
    if (active === HY.fp) return HY.fp.api.Eh();
    var il = HY.calc.illum(HY.model.O, HY.state.time.t, HY.model.P, {});
    return { lux: il.sunLuxGround, est: true };
  };
  app.sunVis = function () { return active === HY.fp ? HY.fp.api.sunVis() : HY.model.tick().sun.vis; };
  app.moonState = function () { return active === HY.fp ? HY.fp.api.moonState() : HY.model.tick().moon.state; };
  // list：[{site, time, look:[yaw, pitch, fov] | {yaw, pitch, fov} | 'sun'…, frames}] → [{site, t, Eh, sunVis, moon, gpu}]
  app.measure = function (list) {
    var rows = [];
    return list.reduce(function (p, it) {
      return p.then(function () {
        if (it.site) app.setSite(it.site);
        if (it.time != null) app.setTime(it.time);
        if (it.look != null) {
          var k = it.look;
          if (typeof k === 'string') HY.fp.api.lookPreset(k, { instant: true });
          else if (Array.isArray(k)) app.look(k[0], k[1], k[2]);
          else app.look(k.yaw, k.pitch, k.fov);
        }
        return app.settle(it.frames || 4).then(function () {
          rows.push({ site: HY.state.site.id, t: HY.state.time.t, Eh: app.Eh(), sunVis: app.sunVis(), moon: app.moonState(), gpu: app.gpuTimes() });
        });
      });
    }, Promise.resolve()).then(function () { return rows; });
  };
  app.gpuTimes = function () { return HY.fp && HY.fp.api ? HY.fp.api.gpuTimes() : {}; };
  app.setParam = function (path, value) { return HY.store.set(path, value, 'api'); };
  app.quality = function (tier) { return HY.fp.api.quality(tier); };
  app.snapshot = function () { return { state: HY.store.snapshot(), now: HY.model.now, build: HY.BUILD, view: app.active() }; };
  app.perf = function () {
    if (active === HY.fp) return HY.fp.api.perf();
    var g = HY.gfx && HY.gfx.timer && HY.gfx.timer.results ? HY.gfx.timer.results() : null;   // 总览的 GPU 时间（没有计时扩展时为 0）
    return { fps: perf.fps, cpuMs: perf.cpuMs, gpuMs: g && isFinite(g.ov) ? g.ov : 0, res: size.w + '×' + size.h, tier: 'ov' };
  };

  // 页面脚本都载完后启动（经典脚本按顺序执行，app.js 在最后）
  if (doc && !G.HY_NO_BOOT) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', app.boot);
    else app.boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
