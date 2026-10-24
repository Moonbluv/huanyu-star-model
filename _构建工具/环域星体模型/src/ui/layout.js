/* HY.ui.layout —— 布局、页签、侧栏开合、视图切换、总览预设、顶栏要点、图例、示意说明、降级说明、进度条、提示、
 *   全屏、手机第一人称的抽屉、入冬镜头的时间与字幕（规格：spec/03 第九节第 1、2、4 条，第六节第 9 条，附录 B）
 * 负责：D 路（界面）。只填附录 B 里归 layout 的节点（及模板里的 #fade #ovCaption #chromeBtn）。
 * 写入的状态：ui.tab、ui.panel、ui.chrome、view.mode、ov.preset／ov.cam（点预设时把 cam 清空）；
 *   入冬镜头写 time.t（jump）、time.speed.ov 与 time.playing（ui）——相机由 HY.ov.preset('winter') 自己管。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var L = ui.layout = ui.layout || {};
  L.__stub = false;

  function $(id) { return G.document.getElementById(id); }
  function safe(fn) { try { return fn(); } catch (e) { if (G.console) G.console.error(e); return undefined; } }
  var TABS = [['site', '此地'], ['year', '一年'], ['params', '参数'], ['notes', '说明']];
  L.TABS = TABS;
  L.PRESETS = [
    ['oblique', '斜看'], ['side', '侧看'], ['fromTop', '从塔顶看帝国'], ['fromRoot', '看另一端'],
    ['above', '此地上空'], ['sun', '跟随太阳'], ['moon', '跟随月亮'], ['winter', '入冬镜头']
  ];
  var ZONES = [['tower', '塔基'], ['light', '轻域'], ['plain', '平域'], ['heavy', '重域'], ['limbo', '灵薄']];

  var app = null, presetBtns = {}, presetSel = null, bOv = null, bFp = null, fsBtn = null, drawerBtn = null;
  var lastMobile = null;

  L.isMobile = function () { return (G.innerWidth || 1024) < 768; };
  // 第一人称能不能进（HY.app.fpAvail 的薄包装；app 没起来时问 HY.fp.supported）
  L.fpAvail = function () {
    if (HY.app && HY.app.fpAvail) return safe(HY.app.fpAvail) || { ok: false, reason: '第一人称不可用' };
    var s = HY.fp && HY.fp.supported ? safe(HY.fp.supported) : null;
    return s || { ok: false, reason: '第一人称准备中' };
  };
  /* 进第一人称的统一入口（顶栏按钮、地点卡“站在此地”、快捷键 2）：不可用时不切视图，直接提示中文原因。
   * 按钮不用 disabled（点不动、手机上也看不到 title），改用 aria-disabled＋置灰样式，点了就说为什么。 */
  L.toFp = function (src) {
    var sup = L.fpAvail();
    if (!sup.ok) { L.toast('第一人称暂不可用：' + sup.reason); return false; }
    HY.store.set('view.mode', 'fp', src || 'ui');
    return true;
  };
  // 给“进第一人称”的按钮标上可用与否（置灰＋原因）
  L.markFpButton = function (b, sup, okTitle) {
    if (!b) return;
    sup = sup || L.fpAvail();
    b.disabled = false;
    b.setAttribute('aria-disabled', String(!sup.ok));          // 样式里按 [aria-disabled="true"] 置灰
    b.title = sup.ok ? okTitle : '暂不可用：' + sup.reason;
  };
  L.measure = function () {
    var st = $('stage'), r = st ? st.getBoundingClientRect() : { width: 0, height: 0 };
    return { w: Math.round(r.width), h: Math.round(r.height), mobile: L.isMobile(), panel: !!(HY.state && HY.state.ui.panel) };
  };
  function emitLayout() { HY.bus.emit('layout', L.measure()); if (L.fitNote) L.fitNote(); }

  L.init = function () {
    var S = HY.store, bus = HY.bus, w = ui.w;
    app = $('app');

    /* 页签（role=tablist 里只放页签；“收起”按钮放在 tablist 外面。左右方向键切换） */
    var tabs = $('tabs');
    tabs.textContent = '';
    var tlist = w.h('div', 'tablist');
    tlist.setAttribute('role', 'tablist'); tlist.setAttribute('aria-label', '页签');
    tabs.appendChild(tlist);
    TABS.forEach(function (t, i) {
      var b = w.h('button', 'tab', t[1]);
      b.type = 'button'; b.id = 'tabbtn-' + t[0]; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'tab-' + t[0]);
      b.addEventListener('click', function () { S.set('ui.tab', t[0], 'ui'); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        var j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
        S.set('ui.tab', TABS[j][0], 'ui');
        $('tabbtn-' + TABS[j][0]).focus();
      });
      tlist.appendChild(b);
    });
    var tog = w.btn('收起', { cls: 'panel-toggle', aria: '收起或展开侧栏（P）', title: '收起侧栏（P）', onClick: function () { S.set('ui.panel', !HY.state.ui.panel, 'ui'); } });
    tabs.appendChild(tog);
    var shownTab = null;
    function showTab() {
      var cur = HY.state.ui.tab;
      if (shownTab && shownTab !== cur) { var pn = $('panel'); if (pn && pn.scrollHeight > pn.clientHeight) pn.scrollTop = 0; }
      shownTab = cur;
      TABS.forEach(function (t) {
        var on = t[0] === cur;
        $('tab-' + t[0]).hidden = !on;
        var b = $('tabbtn-' + t[0]);
        b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      });
    }
    function showPanel() {
      app.dataset.panel = HY.state.ui.panel ? '1' : '0';
      app.dataset.chrome = HY.state.ui.chrome ? '1' : '0';
      tog.textContent = HY.state.ui.panel ? '收起' : '展开';
    }

    /* 顶栏：视图切换 */
    var vs = $('viewSwitch'); vs.textContent = '';
    bOv = w.btn('总览', { cls: '', aria: '总览（1）', title: '神的视角（1）', onClick: function () { S.set('view.mode', 'ov', 'ui'); } });
    bFp = w.btn('站在此地', { cls: '', aria: '站在此地，第一人称（2）', title: '第一人称（2）', onClick: function () { L.toFp('ui'); } });
    vs.appendChild(bOv); vs.appendChild(bFp);

    /* 顶栏：总览预设（桌面一排按钮；手机收成“预设 ▾”下拉） */
    var pr = $('ovPresets'); pr.textContent = '';
    var row = w.h('div', 'preset-row');
    L.PRESETS.forEach(function (p) {
      var b = w.btn(p[1], { cls: 'btn btn-preset', pressed: false, title: p[0] === 'winter' ? '跳到最近一次入冬交节，慢放日升月降' : '总览镜头：' + p[1], onClick: function () { L.preset(p[0]); } });
      presetBtns[p[0]] = b; row.appendChild(b);
    });
    pr.appendChild(row);
    presetSel = w.h('select', 'preset-sel');
    presetSel.setAttribute('aria-label', '总览预设');
    // 下拉框停在当前预设的名字上（桌面那排按钮的高亮在手机上的对应）；拖动过镜头后回到“自定镜头”。下拉框自带“▾”箭头（样式里画）
    var op0 = w.h('option', '', '自定镜头'); op0.value = ''; op0.disabled = true; presetSel.appendChild(op0);
    L.PRESETS.forEach(function (p) { var op = w.h('option', '', p[1]); op.value = p[0]; presetSel.appendChild(op); });
    presetSel.addEventListener('change', function () { if (presetSel.value) L.preset(presetSel.value); showPresets(); });
    pr.appendChild(presetSel);

    /* 顶栏：全屏、手机抽屉按钮 */
    var tb = $('topbar');
    var tools = w.h('div', 'top-tools');
    fsBtn = w.btn('全屏', { cls: 'btn btn-icon', aria: '画面全屏（F）', title: '画面全屏（F）', onClick: function () { L.fullscreen(); } });
    if (!G.document.fullscreenEnabled) fsBtn.hidden = true;
    drawerBtn = w.btn('☰', { cls: 'btn btn-icon drawer-btn', aria: '时间与侧栏', title: '时间与侧栏', onClick: function () { L.drawer(app.dataset.drawer !== '1'); } });
    var openBtn = w.btn('侧栏', { cls: 'btn btn-icon panel-open', aria: '展开侧栏（P）', title: '展开侧栏（P）', onClick: function () { S.set('ui.panel', true, 'ui'); } });
    tools.appendChild(openBtn); tools.appendChild(fsBtn); tools.appendChild(drawerBtn);
    tb.appendChild(tools);

    /* 隐藏界面后的恢复按钮 */
    var cb = $('chromeBtn');
    if (cb) {
      cb.textContent = '';
      cb.appendChild(w.btn('显示界面', { cls: 'btn', aria: '显示界面（H）', title: '显示界面（H）', onClick: function () { S.set('ui.chrome', true, 'ui'); } }));
    }

    /* 图例与示意说明：分域色块一行；画面里的线另一行（视线、被塔挡住的视线、入冬交节时的三点一线），只列此刻画着的 */
    G.document.documentElement.lang = 'zh-CN';               // 模板不写 html 标签（单文件约定）：读屏按中文念
    var lg = $('legend'); lg.textContent = '';
    var lgZ = w.h('div', 'lg-row'), lgL = w.h('div', 'lg-row lg-lines');
    ZONES.forEach(function (z) {
      var it = w.h('span', 'lg-item');
      var sw = w.h('i', 'lg-sw z-' + z[0]); sw.setAttribute('aria-hidden', 'true');
      it.appendChild(sw); it.appendChild(G.document.createTextNode(z[1]));
      lgZ.appendChild(it);
    });
    var LINES = [['sight', 'ln-sight', '此地到日、月的视线'], ['block', 'ln-block', '被塔挡住'], ['fest', 'ln-fest', '本年入冬交节时的三点一线']];
    var lgItems = {};
    LINES.forEach(function (q) {
      var it = w.h('span', 'lg-item'), sw = w.h('i', 'lg-ln ' + q[1]); sw.setAttribute('aria-hidden', 'true');
      it.appendChild(sw); it.appendChild(G.document.createTextNode(q[2]));
      lgItems[q[0]] = it; lgL.appendChild(it);
    });
    lg.appendChild(lgL); lg.appendChild(lgZ);
    function showLegend() {
      var o = HY.state.ov, n = HY.model.now, fest = !!(n && n.festivalYear) && o.helix !== 'off' && o.showMoon;
      lgItems.sight.hidden = lgItems.block.hidden = !o.sight;
      lgItems.fest.hidden = !fest;
      lgL.hidden = !o.sight && !fest;
      L.fitNote();
    }
    L.legend = showLegend;
    showLegend();
    bus.on('ov', showLegend); bus.on('model', showLegend);
    var lastFest = null;
    bus.on('time', function () { var f = !!(HY.model.now && HY.model.now.festivalYear); if (f !== lastFest) { lastFest = f; showLegend(); } });
    showNote();

    function showView() {
      var m = HY.state.view.mode;
      app.dataset.view = m;
      app.dataset.active = HY.app && HY.app.active ? (HY.app.active() || '') : '';
      bOv.setAttribute('aria-pressed', String(m === 'ov'));
      bFp.setAttribute('aria-pressed', String(m === 'fp'));
      L.markFpButton(bFp, L.fpAvail(), '第一人称（2）');
      if (m !== 'fp') { L.drawer(false); $('busy').hidden = true; }
      else L.cancelShot();
    }
    function showPresets() {
      var o = HY.state.ov, cur = o.cam == null ? o.preset : '';
      L.PRESETS.forEach(function (p) { presetBtns[p[0]].setAttribute('aria-pressed', String(cur === p[0])); });
      if (presetSel && presetSel.value !== cur) presetSel.value = cur;
    }

    bus.on('ui', function (e) {
      var p = e.path || '';
      if (p === 'ui' || p === 'ui.tab') showTab();
      if (p === 'ui' || p === 'ui.panel' || p === 'ui.chrome') showPanel();
      if (p === 'ui' || p === 'ui.tab' || p === 'ui.panel' || p === 'ui.chrome') emitLayout();
    });
    bus.on('view', function () { showView(); emitLayout(); });
    bus.on('ov', function () { showPresets(); showNote(); });
    bus.on('model', showNote);
    bus.on('ready', showView);
    bus.on('error', function (e) { if (e && (e.part === 'fp' || e.part === 'gfx' || e.part === 'ov')) showView(); });
    L.refresh = function () { showTab(); showPanel(); showView(); showPresets(); showNote(); };
    showTab(); showPanel(); showView(); showPresets();

    /* 降级说明、进度、提示、上下文丢失、画质变化 */
    bus.on('error', function (e) {
      if (!e || e.part === 'params') return;                 // 参数约束的黄字由参数页显示
      L.toast(e.message);
      if (e.part === 'ov' || e.part === 'gfx') L.fallback(e.message);
    });
    bus.on('progress', function (p) { L.progress(p); });
    bus.on('context', function (e) {
      var b = $('busy');
      if (e.lost) { b.textContent = '图形上下文丢失，正在恢复'; b.hidden = false; }
      else b.hidden = true;
    });
    // 画质换档：第一人称正在出图时由 HUD 自己在画面上方说一次（这里不再弹第二条）；不在第一人称时才用提示条
    bus.on('quality', function (q) {
      if (!q || (HY.app && HY.app.active && HY.app.active() === 'fp')) return;
      L.toast(L.qualityText(q));
    });
    // 顶栏要点：帧事件里节流
    var lastChip = 0;
    bus.on('frame', function (ctx) { var t = Date.now(); if (t - lastChip > 250) { lastChip = t; L.chips(ctx.now); L.progressTick(); } });
    bus.on('model', function () { L.chips(HY.model.tick()); });
    bus.on('time', function (e) { onShotTime(e); });
    L.chips(HY.model.now);

    var onResize = function () {
      var m = L.isMobile();
      app.dataset.mobile = m ? '1' : '0';
      if (m !== lastMobile) { lastMobile = m; }
      emitLayout();
    };
    G.addEventListener('resize', HY.util.throttle(onResize, 100));
    G.document.addEventListener('fullscreenchange', function () {
      if (fsBtn) fsBtn.textContent = G.document.fullscreenElement ? '退出全屏' : '全屏';
      emitLayout();
    });
    app.dataset.mobile = L.isMobile() ? '1' : '0';
  };

  /* 示意说明：画面左下角常驻一行小字（03 第六节第 5 条） */
  function showNote() {
    var el = $('ovNote'); if (!el || !HY.state) return;
    var o = HY.state.ov, P = HY.model && HY.model.P, parts = [];
    if (P) {
      var sunT = Math.round(P.Y), moonT = Math.round(P.Y - P.lunPerYear);
      if (o.helix === 'mirror') parts.push('示意：螺旋每年画 ' + o.helixTurns + ' 圈（实为日 ' + sunT + ' 圈、月 ' + moonT + ' 圈）');
      else if (o.helix === 'real') parts.push('实际轨迹：前后半日（日）、一日（月）');
      else if (o.helix === 'strobe') parts.push('每日同一时刻的位置');
      if (o.sunGapX > 1) parts.push('日轨离塔面放大 ×' + o.sunGapX + '（实为 ' + Math.round(P.dS - P.a) + ' 公里）');
      if (o.bodyScale > 1) parts.push('日月本体放大 ×' + o.bodyScale);
    }
    // 每一条各自不折行（折行只发生在两条之间），免得“×3”单独掉到下一行
    el.textContent = '';
    parts.forEach(function (s, i) {
      if (i) el.appendChild(G.document.createTextNode(' · '));
      el.appendChild(ui.w.h('span', 'note-part', s));
    });
    el.hidden = !parts.length;
    L.fitNote();
  }
  L.note = showNote;

  /* 示意小字（左下）与图例（右下）互不相让（验收回归第 1 条）：画面宽 600–700 像素时（桌面 1024–1150、侧栏开着），
   *   示意小字折成两行，顶到图例新加的“视线”一行。量一下两者，压到了就把示意小字整体抬到图例上方。
   *   排版后（下一帧）量，几处变动合并成一次 */
  var fitReq = 0;
  L.fitNote = function () {
    if (fitReq) return;
    var raf = G.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    fitReq = raf(function () { fitReq = 0; safe(fitNoteNow); });
  };
  function fitNoteNow() {
    var el = $('ovNote'), lg = $('legend');
    if (!el || !lg || !el.getBoundingClientRect) return;
    el.style.bottom = '';
    if (el.hidden || !el.getClientRects().length) return;
    var a = el.getBoundingClientRect(), rows = lg.querySelectorAll('.lg-row'), hit = false, top = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i];
      if (q.hidden || !q.getClientRects().length) continue;
      var r = q.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      top = Math.min(top, r.top);
      if (a.left < r.right + 6 && r.left < a.right + 6 && a.top < r.bottom + 4 && r.top < a.bottom + 4) hit = true;
    }
    if (!hit || !isFinite(top)) return;
    var host = el.offsetParent || $('stage');
    if (!host) return;
    var hb = host.getBoundingClientRect().bottom;
    el.style.bottom = Math.round(hb - top + 6) + 'px';
  }

  /* 顶栏要点（四个）的文字（纯函数）：入冬后日与时辰、昼夜、月（ui.fmt.moonShort）、庆典年／周期第几年 → [[文字, 类名]…]
   * 周期数不出来（参数破坏了庆典节律）时第四个留空、不显示 */
  L.chipTexts = function (now) {
    if (!now || !now.cal) return [];
    var W = HY.world, n = W.CAL.names, fest = !!now.festivalYear;
    return [
      [W.fmtCal(now.cal, 'chip') + ' ' + now.shichen, 'chip-date'],
      [now.night ? '夜' : '昼', now.night ? 'chip-night' : 'chip-day'],
      [ui.fmt.moonShort(now.moon), 'chip-moon'],
      [fest ? n.festivalYear : now.cycleYear != null ? W.tpl(n.cycle, { k: now.cycleYear }) : '', fest ? 'chip-fest' : '']
    ];
  };
  L.chips = function (now) {
    var el = $('nowChips'); if (!el || !now || !now.cal) return;
    var parts = L.chipTexts(now);
    var key = parts.map(function (p) { return p[0]; }).join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.textContent = '';
    parts.forEach(function (p) { if (p[0]) el.appendChild(ui.w.h('span', 'chip ' + p[1], p[0])); });
  };

  /* 总览预设：按钮写 ov.preset 并清空 ov.cam，再让 HY.ov 动起来 */
  L.preset = function (name) {
    if (HY.state.view.mode !== 'ov') HY.store.set('view.mode', 'ov', 'ui');
    HY.store.patch('ov', { preset: name, cam: null }, 'ui');
    if (HY.ov && HY.ov.preset) safe(function () { HY.ov.preset(name, { animate: true }); });
    if (name === 'winter') L.winterShot(); else L.cancelShot();
  };
  L.cyclePreset = function () {
    var cur = HY.state.ov.preset, i = 0;
    L.PRESETS.forEach(function (p, j) { if (p[0] === cur) i = j; });
    var nx = L.PRESETS[(i + 1) % L.PRESETS.length][0];
    if (nx === 'winter') nx = L.PRESETS[0][0];               // O 键只轮换镜头，不触发入冬慢放
    L.preset(nx);
  };

  /* 入冬镜头（03 第六节第 9 条）：跳到最近一次入冬交节前 0.5 日，×3600 播到交节后 0.5 日自动暂停，画面中央字幕
   * （“月在日西／东”：方位差 Δ 为正＝月在日之西，01 第三节） */
  var shot = null, shotHide = null;
  // 入冬镜头的字幕（纯函数）：第 N 年入冬交节 → [主句, 本年一句, 小字]
  L.winterLines = function (N, P) {
    var A = HY.astro, tW = HY.world.winterT(N, P), c = HY.calc.civil(tW, P.epochAz, P), line2;
    if (A.isFestival(N, P)) line2 = '三点一线，是夜为圣皇庆典';
    else {
      var d = A.elongation(tW, P), G2 = HY.ov && HY.ov.geom;
      // 同侧与否只留一份判定（overview/geom.js 的 elongPhrase，＜45°）；总览没载入时按同一阈值
      line2 = G2 && G2.elongPhrase ? G2.elongPhrase(d)
        : Math.abs(d) < 45 ? '今年月与日同侧' : '今年月在日' + (d > 0 ? '西 ' : '东 ') + Math.round(Math.abs(d)) + '°';
    }
    return ['入冬：日升月降，交于塔腰', line2, HY.world.fmtCal(c, 'year') + ' · 入冬交节（伊美忒子夜）'];
  };
  L.winterShot = function () {
    var P = HY.model.P, t = HY.state.time.t;
    var Nw = P.epochYear + Math.round(t / P.Y), tW = HY.world.winterT(Nw, P);
    // 记下镜头之前的流速与播放状态：中途被打断（换预设、跳到别处、暂停）时原样还回去
    var prev = shot ? { speed: shot.speed, playing: shot.playing } : { speed: HY.state.time.speed.ov, playing: !!HY.state.time.playing };
    shot = { tW: tW, end: tW + 0.5, speed: prev.speed, playing: prev.playing, starting: true };
    HY.store.set('time.t', tW - 0.5, 'jump');
    HY.store.set('time.speed.ov', 3600, 'ui');
    HY.store.set('time.playing', true, 'ui');
    shot.starting = false;
    caption(L.winterLines(Nw, P));
    return shot;
  };
  function caption(lines) {
    var el = $('ovCaption'); if (!el) return;
    clearTimeout(shotHide); shotHide = null;
    el.textContent = '';
    if (!lines) { el.hidden = true; return; }
    lines.forEach(function (s, i) { el.appendChild(ui.w.h(i ? 'p' : 'strong', i === 2 ? 'cap-small' : '', s)); });
    el.hidden = false;
  }
  L.caption = caption;
  // pause：自然播完（停在交节后半日，字幕再留 4 秒）；否则是被打断：流速与播放状态还原成镜头之前的，字幕立刻收起
  function endShot(pause) {
    if (!shot) return;
    var sp = shot.speed, was = shot.playing;
    shot = null;
    if (pause) HY.store.set('time.playing', false, 'ui');
    else if (HY.state.time.playing !== was) HY.store.set('time.playing', was, 'ui');
    if (HY.state.time.speed.ov === 3600) HY.store.set('time.speed.ov', sp, 'ui');   // 用户自己改过流速就不动
    if (pause) shotHide = setTimeout(function () { caption(null); }, 4000);
    else caption(null);
  }
  L.cancelShot = function () { if (shot) endShot(false); else if (shotHide) caption(null); };
  L.shot = function () { return shot; };
  function onShotTime(e) {
    if (!e) return;
    // 镜头已经播完、字幕还在留的那 4 秒里，用户跳到别的时刻：字幕立刻收起，免得压在不相干的日期上
    if (!shot) { if (shotHide && e.path === 'time.t' && e.src !== 'play') caption(null); return; }
    if (shot.starting) return;
    if (e.path === 'time.t') { if (e.src !== 'play') endShot(false); else if (e.value >= shot.end) endShot(true); }
    else if (e.path === 'time.playing' && !e.value) endShot(false);
  }

  /* 画质换档的一句话（纯函数）：q＝quality 事件 {tier, reason, suggest} */
  L.TIER_NAME = { low: '低', mid: '中', high: '高', photo: '拍照' };
  L.qualityText = function (q) {
    if (!q) return '';
    var name = L.TIER_NAME[q.tier] || q.tier;
    if (q.suggest) return '画面很流畅，可以在“参数”里把画质升到“' + (L.TIER_NAME[q.suggest] || q.suggest) + '”档';
    var why = /降档|超出预算/.test(q.reason || '') ? '：太卡，自动降了一档' : '';
    return '画面已切到“' + name + '”档' + why;
  };

  /* 进度按预计耗时走（规格：作者要“直白、有时长”）：编译是按程序个数计数的，常在一个数上停好几秒、最后一下跳完，
   *   照它画进度条看不出还要等多久。这里改成：预计耗时取本机上次实测（localStorage；读写失败就用默认），
   *   首次进第一人称默认 16 秒、后台换档 18 秒；比例＝已等时间÷预计（过了 85% 放慢、到不了 100%），程序个数只保证不倒退。 */
  L.ETA_KEY = 'huanyu-xingti-v3.eta';
  L.ETA_DEF = { loading: 16, tier: 18 };
  var etaRun = {};
  function etaLoad() { try { var s = G.localStorage ? G.localStorage.getItem(L.ETA_KEY) : null; var o = s ? JSON.parse(s) : null; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function etaSave(k, sec) {
    try { var o = etaLoad(); o[k] = Math.round(sec * 10) / 10; if (G.localStorage) G.localStorage.setItem(L.ETA_KEY, JSON.stringify(o)); } catch (e) { /* 隐私窗口：不记 */ }
  }
  // 纯函数：已等 el 秒、预计 ex 秒、按个数算的比例 cf → 显示的比例（0–0.98）
  L.etaFrac = function (el, ex, cf) {
    var x = ex > 0 ? Math.max(0, el) / ex : 0, f = x < 0.85 ? x : 0.85 + 0.13 * (1 - Math.exp(-(x - 0.85) / 0.5));
    return Math.max(0, Math.min(0.98, Math.max(f, 0.9 * (isFinite(cf) ? cf : 0))));
  };
  // 一次进度事件 → {frac, left（预计还要几秒）, exp, first（本机没量过）, key, done}
  L.eta = function (p, nowMs) {
    if (!p) return null;
    var phase = p.phase === 'tier' ? 'tier' : 'loading', m = /“(.+?)”档/.exec(p.label || ''), key = phase + (phase === 'tier' && m ? ':' + m[1] : '');
    var t = nowMs != null ? nowMs : Date.now(), run = etaRun[phase], done = p.total > 0 && p.done >= p.total;
    if (done) {
      if (run && run.key === key && run.n > 1) etaSave(key, (t - run.t0) / 1000);
      etaRun[phase] = null;
      return { frac: 1, left: 0, exp: run ? run.exp : 0, first: false, key: key, done: true };
    }
    if (!run || run.key !== key || p.done < run.last) {
      var st = etaLoad(), ex = isFinite(st[key]) && st[key] > 0 ? st[key] : L.ETA_DEF[phase];
      run = etaRun[phase] = { key: key, t0: t, exp: ex, first: !(isFinite(st[key]) && st[key] > 0), last: p.done, n: 0 };
    }
    run.last = p.done; run.n++;
    var el = (t - run.t0) / 1000, cf = p.total > 0 ? p.done / p.total : 0;
    return { frac: L.etaFrac(el, run.exp, cf), left: Math.max(0, run.exp - el), elapsed: el, exp: run.exp, first: run.first, key: key, done: false };
  };
  /* 进度条交给合成线程走：编译着色器时主线程会整段卡住（实测一次 7–17 秒，期间没有任何事件、定时器也不跑），
   *   靠 JS 每 0.25 秒改宽度的话，条子就停在那里。这里每次更新都把条子先放到此刻该在的位置，再用 CSS 过渡（transform，
   *   由合成线程执行，主线程卡住时照样动）按预计耗时线性走向“再过 H 秒该在的位置”。
   *   纯函数部分：L.barPlan(frac, el, exp) → {from, to, sec}；from 不小于按个数算的 frac */
  L.barPlan = function (frac, el, exp) {
    var from = Math.max(isFinite(frac) ? frac : 0, L.etaFrac(el, exp, 0));
    var sec = Math.max(3, (exp > 0 ? exp : 16) * 1.6 - Math.max(0, el));
    var to = Math.max(from, L.etaFrac(el + sec, exp, 0));
    return { from: Math.min(0.98, from), to: Math.min(0.98, to), sec: sec };
  };
  L.animBar = function (fill, frac, el, exp) {
    if (!fill || !fill.style) return;
    var p = L.barPlan(frac, el, exp);
    fill.style.transition = 'none';
    fill.style.transform = 'scaleX(' + p.from.toFixed(4) + ')';
    void fill.offsetWidth;                                   // 先落到起点，再开始过渡
    fill.style.transition = 'transform ' + p.sec.toFixed(2) + 's linear';
    fill.style.transform = 'scaleX(' + p.to.toFixed(4) + ')';
  };
  /* 还要多久的话（验收第 3、19 条返修）：编译着色器时主线程整段卡住，JS 写上去的字也跟着冻住——
   *   原先的“约还要 N 秒”“马上就好”会在屏上停三十几秒，越停越假。现在：
   *   ① 每一句都不随秒数倒数，冻在屏上多久都还是真话（“第一次一般要 15–20 秒，电脑忙时会更久”）；
   *   ② 三句话按预计时刻排好（L.etaStages），叠在同一格里，由 CSS 动画的延时切换不透明度——
   *      不透明度动画在合成线程上跑，主线程卡住时到点照样换成“比预计慢”。纯函数：L.etaStages(e, phase) → [{at, text}] */
  L.etaStages = function (e, phase) {
    var tier = phase === 'tier', ex = e && e.exp > 0 ? e.exp : L.ETA_DEF[tier ? 'tier' : 'loading'];
    var t1 = Math.max(ex * 1.3, ex + 4), t2 = Math.max(ex * 3, t1 + 20, 60);
    var s0 = e && e.first ? '第一次一般要 15–20 秒，电脑忙时会更久' : '本机上次用了约 ' + Math.max(1, Math.round(ex)) + ' 秒，电脑忙时会更久';
    var s1 = tier ? '比预计慢：电脑正忙，再等一下' : '比预计慢：电脑正忙，再等一下；画面卡住不动是正常的';
    var s2 = tier ? '比预计慢很多：电脑很忙，准备好了会自己换上' : '比预计慢很多：电脑很忙，还在准备；不想等可以按“取消”';
    return [{ at: 0, text: s0 }, { at: t1, text: s1 }, { at: t2, text: s2 }];
  };
  // 此刻（已等 e.elapsed 秒）该显示的那一句
  L.etaText = function (e, phase) {
    if (!e) return '';
    var st = L.etaStages(e, phase), el = Math.max(0, e.elapsed || 0), s = st[0].text;
    for (var i = 0; i < st.length; i++) if (el >= st[i].at) s = st[i].text;
    return s;
  };
  /* 把三句叠进 holder（每句一格 .eta-s，同一格位；默认不透明度 0），各自用动画 hy-eta 在自己的时段里显出来。
   *   同一轮（起点不变、文字不变）不重启动画，免得每 0.25 秒重来一遍；prefix、suffix 加在每句前后。 */
  L.etaPaint = function (holder, e, phase, prefix, suffix) {
    if (!holder || !e) return;
    var d = G.document, st = L.etaStages(e, phase), el = Math.max(0, e.elapsed || 0), t0 = Date.now() - el * 1000;
    var texts = st.map(function (s) { return (prefix || '') + s.text + (suffix || ''); });
    var E = holder._eta, fresh = !E || holder.firstChild !== E.spans[0] || holder.childNodes.length !== E.spans.length;
    if (!fresh && E.key === texts.join('|') && Math.abs(E.t0 - t0) < 600) return;
    if (fresh) {
      holder.textContent = '';
      E = holder._eta = { spans: texts.map(function () { var s = d.createElement('span'); s.className = 'eta-s'; holder.appendChild(s); return s; }) };
      holder.classList.add('eta');
    }
    E.key = texts.join('|'); E.t0 = t0; E.st = st; E.texts = texts;
    E.spans.forEach(function (s, i) { s.textContent = texts[i]; s.style.animation = 'none'; });
    void holder.offsetWidth;                                 // 先清掉旧动画，再按新起点排
    E.spans.forEach(function (s, i) {
      var a = st[i].at - el, b = i + 1 < st.length ? st[i + 1].at - el : 1e5, cur = a <= 0 && b > 0;
      s.classList.toggle('eta-cur', cur);
      s.setAttribute('aria-hidden', String(!cur));
      s.style.animation = b <= 0 ? 'none' : 'hy-eta ' + (b - a).toFixed(2) + 's linear ' + a.toFixed(2) + 's 1 normal none';
    });
  };
  // holder 此刻看得见的那一句（按墙钟算，与合成线程上的切换一致）；没有分句时就是它的文字
  L.etaNow = function (holder) {
    if (!holder) return '';
    var E = holder._eta;
    if (!E || holder.firstChild !== E.spans[0]) return holder.textContent;
    var el = (Date.now() - E.t0) / 1000, s = E.texts[0];
    for (var i = 0; i < E.st.length; i++) if (el >= E.st[i].at) s = E.texts[i];
    return s;
  };

  /* 降级说明、进度、提示 */
  L.fallback = function (msg) { var fb = $('fallback'); if (!fb) return; fb.textContent = msg; fb.hidden = !msg; };
  var busyEls = null;
  L.progress = function (p) {
    var b = $('busy'); if (!b) return;
    var e = p ? L.eta(p) : null;
    // 第一人称已经在出图（后台换档）时不盖大框，由 HUD 在画面上方说
    var fpActive = HY.app && HY.app.active && HY.app.active() === 'fp';
    if (!p || e.done || HY.state.view.mode !== 'fp' || fpActive || p.phase === 'tier') { b.hidden = true; return; }
    if (!busyEls || busyEls.root !== b || busyEls.txt.parentNode !== b) {   // 上下文丢失时整框改写过文字：重建
      b.textContent = '';
      var txt = ui.w.h('span', 'busy-txt'), sub = ui.w.h('span', 'busy-sub');
      var bar = ui.w.h('div', 'busy-bar'), fill = ui.w.h('i');
      bar.appendChild(fill);
      b.appendChild(txt); b.appendChild(bar); b.appendChild(sub);
      b.appendChild(ui.w.btn('取消', { cls: 'btn btn-mini', aria: '取消，留在总览（Esc）', title: 'Esc 或按 1 也可以', onClick: function () { HY.store.set('view.mode', 'ov', 'ui'); } }));
      busyEls = { root: b, txt: txt, sub: sub, fill: fill };
    }
    busyEls.txt.textContent = '正在准备第一人称画面';
    busyEls.suffix = /地形|查找表|天气/.test(p.label || '') ? '（正在铺地形与天气）' : '';
    L.etaPaint(busyEls.sub, e, 'loading', '', busyEls.suffix);
    b.hidden = false;
    busyEls.floor = e.frac;                                  // 按个数算的下限：定时重画时不往回退
    L.animBar(busyEls.fill, e.frac, e.elapsed, e.exp);
  };
  // 进度条在等待中也要往前走（编译时可能好几秒没有新事件）：第一人称准备期间每 0.25 秒按时间重画一次
  L.progressTick = function () {
    var b = $('busy');
    if (!b || b.hidden || !busyEls || !etaRun.loading) return;
    var run = etaRun.loading, el = (Date.now() - run.t0) / 1000;
    L.animBar(busyEls.fill, busyEls.floor || 0, el, run.exp);
    L.etaPaint(busyEls.sub, { first: run.first, elapsed: el, left: Math.max(0, run.exp - el), exp: run.exp }, 'loading', '', busyEls.suffix || '');
  };
  // 加载框此刻看得见的那句话（测试与验收用）
  L.busyText = function () { var b = $('busy'); return !b || b.hidden || !busyEls ? '' : busyEls.txt.textContent + ' · ' + L.etaNow(busyEls.sub); };
  var toastTimer = null;
  L.toast = function (msg, ms) {
    var t = $('toast'); if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 4000);
  };

  /* 黑场淡入（视图切换时）：200 ms 变黑 → fn() → 200 ms 淡出 */
  L.fade = function (fn) {
    var f = $('fade');
    if (!f) { if (fn) fn(); return; }
    f.classList.add('on');
    setTimeout(function () { safe(fn); setTimeout(function () { f.classList.remove('on'); }, 30); }, 200);
  };

  /* 全屏（#stage）；document.fullscreenEnabled 为假时按钮已隐藏 */
  L.fullscreen = function () {
    var d = G.document, st = $('stage');
    if (!d.fullscreenEnabled || !st) return;
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); }
    else if (st.requestFullscreen) { var p = st.requestFullscreen(); if (p && p.catch) p.catch(function () {}); }
  };
  /* 手机第一人称：时间栏与侧栏收进“☰”弹出的底部抽屉 */
  L.drawer = function (on) {
    if (!app) return;
    var v = on ? '1' : '0';
    if (app.dataset.drawer === v) return;
    app.dataset.drawer = v;
    if (drawerBtn) drawerBtn.setAttribute('aria-expanded', String(!!on));
    emitLayout();
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
