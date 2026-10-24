/* HY.ui.fphud —— 第一人称 HUD：罗盘条、地名与日期与天气、读数、快捷朝向、手机按钮、行走状态、准星、首次提示、状态条（规格：spec/03 第七节第 7 条；02 第十七节）
 * 负责：D 路（界面）。只填附录 B 的 #fpHud；画面里只出现物理上看得见的东西，界面元素缩在边上，H 键整体隐藏。
 *   读数默认收起成一行（写实画面优先，近处地面不被挡）；说法直白，帧率、内部分辨率、EV、逐 pass 用时只在
 *   “参数·第一人称·画质·显示帧率与用时”打开后出现。
 * 数据：HY.model.now（日月方位、日期）、HY.fp.api.pose()（此刻朝向与位置，步行中比 HY.state.site 新）、
 *   HY.fp.readouts()（实测照度、到眼日照、人眼、fps、分辨率、档位）、HY.fp.gpuTimes()（调试开关打开时）、
 *   HY.ui.readouts.weather（此地天气与余息，按相机此刻的位置）。
 * 日月“看不看得见”同时算塔与云：塔按 now.sun.vis／moon.vis；云按罪域阴云（与第一人称同一个范围）与实测到眼日照
 *   ÷ 大气顶直射（HY.ui.readouts.cloudOver）。月没有逐方向的云量读回，只在阴云下判“在云后”。
 * 不写状态：快捷朝向交给 HY.fp.api.lookPreset；触屏的“跑／骑马／望远”是开关，交给 HY.fp.ctl.toggle（没有时派发同名按键）；
 *   触屏摇杆由 HY.fp.ctl 收输入，样子由这里画（每帧读 HY.fp.ctl.state().joy）。
 * 纯函数（compassX、ticks、visText、placeLine、sunLine 等）加载时不碰 DOM，test/ui_check.js 在 node 里测。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var H = ui.fphud = ui.fphud || {};
  H.__stub = false;

  var SPAN = 90;                       // 罗盘条两侧各显示 90°
  H.SPAN = SPAN;
  // 快捷朝向（id 是 HY.fp.api.lookPreset 的名字，见 fp/camera.js 的 LOOK_PRESETS）
  H.LOOKS = [
    { id: 'north', label: '看塔根', title: '朝北，抬头看塔根那一端' },
    { id: 'zenith', label: '看天顶', title: '抬头看正上方' },
    { id: 'sun', label: '看太阳', title: '转向太阳' },
    { id: 'moon', label: '看月', title: '转向月亮' },
    { id: 'south', label: '看塔顶', title: '朝南，看塔顶那一端' }
  ];
  // 触屏按钮：开关（HY.fp.ctl.toggle 的名字）；没有 ctl 时派发同名按键（Shift 跑、R 骑马、T 望远）
  H.TOUCH = [
    { id: 'run', label: '跑', key: 'Shift', code: 'ShiftLeft' },
    { id: 'ride', label: '骑马', key: 'r', code: 'KeyR' },
    { id: 'tele', label: '望远', key: 't', code: 'KeyT' }
  ];
  // 提示：Esc 只松开鼠标（退出指针锁定），回总览要按 1
  H.HINT = { desk: '拖动或点击画面转头，WASD 行走；Esc 松开鼠标，按 1 回总览', touch: '左下摇杆行走，右半屏拖动转头，双指凝视；顶栏“总览”回去' };
  H.fixHint = function (s) { return String(s || '').replace(/Esc\s*退出/, 'Esc 松开鼠标，按 1 回总览'); };
  var CARD = { 0: ['北', '塔根'], 90: ['东', ''], 180: ['南', '塔顶'], 270: ['西', ''] };
  H.TIER = { low: '低', mid: '中', high: '高', photo: '拍照' };
  // 人眼三态的直白说法（HY.fp.set.eyeState：明视 La≥3、中间视、暗视 La≤0.005 cd/m²）
  H.EYE = { '明视': '已适应明亮，看得清颜色', '中间视': '昏暗，颜色开始变淡', '暗视': '已适应黑暗，几乎不辨颜色' };

  /* ───────── 纯函数 ───────── */
  function wrapDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }
  // 方位 az 在罗盘条上的横向位置（−1…1 对应视线左右 span 度）；超出返回 null
  H.compassX = function (az, yaw, span) {
    span = span || SPAN;
    var d = wrapDeg(az - yaw);
    return Math.abs(d) > span ? null : d / span;
  };
  // 罗盘条的刻度：每 step 度一格，45° 的倍数是长刻度，四正方向带字
  H.ticks = function (yaw, span, step) {
    span = span || SPAN; step = step || 15;
    var out = [], a0 = Math.ceil((yaw - span) / step) * step;
    for (var a = a0; a <= yaw + span + 1e-9; a += step) {
      var az = ((a % 360) + 360) % 360, x = H.compassX(az, yaw, span);
      if (x == null) continue;
      var c = CARD[az];
      out.push({ az: az, x: x, major: az % 45 === 0, card: c ? c[0] : '', sub: c ? c[1] : '' });
    }
    return out;
  };
  // 水平视角（度）：竖直视角 vfov、宽高比 aspect
  H.hfov = function (vfov, aspect) { return 2 * Math.atan(Math.tan(vfov * Math.PI / 360) * aspect) * 180 / Math.PI; };
  // 日面露出比例的说法（塔缘切入时给百分比）
  H.visText = function (v) {
    if (!isFinite(v)) return '—';
    if (v > 0.999) return '全部露出';
    if (v < 0.001) return '被塔挡住';
    return '露出 ' + Math.round(v * 100) + '%';
  };
  // 太阳那一行的“看不看得见”：先看塔，再看云（cloud＝HY.ui.readouts.cloudOver 的结果：''／'隔着薄云'／'在云后'）
  H.sunSeen = function (vis, cloud) {
    if (!isFinite(vis)) return '—';
    if (vis < 0.001) return '被塔挡住';
    if (cloud === '在云后') return '在云后，看不见日面' + (vis < 0.999 ? '（塔缘切去 ' + Math.round((1 - vis) * 100) + '%）' : '');
    return H.visText(vis) + (cloud ? '，' + cloud : '');
  };
  // 月那一行的“看不看得见”
  H.moonSeen = function (m, cloud) {
    if (!m) return '';
    if (m.vis < 0.5) return '被塔挡住';
    if (cloud === '在云后') return '在云后，看不见';
    return cloud || '';
  };
  // 地名：在预设地点（离它不到 1 公里）上写名字；走开了写“离某地 N 公里”。与地点卡同一条规则（HY.ui.sitecard.resolve）
  //   刚瞬移到预设地点时相机落在最近的踏面上，可能差几百米；步行停下后 site.id 会被清成 null——两种情况都照写地名
  H.NAME_KM = 1;
  H.placeLine = function (pose, st, P) {
    var W = HY.world, SC = ui.sitecard;
    var q = st && st.id ? W.siteById(st.id, P) : null;
    if (!pose || !SC || !SC.resolve) return q ? q.name : '此地';
    var r = SC.resolve(pose.s, pose.az, st ? st.id : null, P);
    if (!r) return '此地';
    return r.at ? r.site.name : '离' + r.site.name + ' ' + SC.distText(r.km) + ' 公里';
  };
  // 月：月态与亮面（与顶栏要点同一个说法，见 ui.fmt.moonShort）
  H.moonText = function (m) { return ui.fmt.moonShort(m); };
  // “所在”一行（02 第十七节第 4 条）：离塔根、重力、纬度＝地面倾角；按相机此刻的位置（步行中比 HY.state.site 新）
  H.hereText = function (pose, P) {
    if (!pose || !isFinite(pose.s) || !P) return '—';
    var U = HY.util, O = HY.astro.site(pose.s, pose.az, P);
    return '离塔根 ' + HY.calc.km(pose.s) + ' · ' + U.fixed(O.g, 2) + ' g · 纬度 ' + U.fixed(O.lat, 1) + '°';
  };
  // 实测没回来时的照度估算：只在日面露出、有直射时给（now.illum 不含对岸光，夜里会把几千勒克斯的白夜估成零）
  H.estLux = function (n) {
    var v = n && n.illum ? n.illum.sunLuxGround : NaN;
    return isFinite(v) && v > 1 && !n.night ? v : null;
  };
  // 人眼一行
  H.eyeText = function (ro) { return ro && ro.eye ? H.EYE[ro.eye] || ro.eye : '—'; };
  // 行走状态（桌面没有触屏按钮：按了 R、T 要看得出现在是什么状态、怎么关）→ [文字…]
  H.modeTexts = function (cs, fov) {
    if (!cs) return [];
    var out = [];
    if (cs.ride) out.push('骑马（R 下马）');
    if (cs.run || cs.shift) out.push(cs.run ? '跑（再按一次停）' : '跑');
    if (cs.tele) out.push('望远（T 收起）');
    return out;
  };

  /* ───────── 界面 ───────── */
  var el = null, parts = {}, colors = null, shown = false, hinted = false, hintTimer = null;
  var lastTxt = 0, lastDraw = { yaw: NaN, sa: NaN, ma: NaN, w: 0, fov: NaN, sv: NaN, mv: NaN, ms: '', sc: '', mc: '' };
  var sky = { sunCloud: '', moonCloud: '', wx: null, ilAt: 0, il: null, ilKey: '' };
  var status = { kind: '', until: 0 };

  function cssVar(name, def) {
    try {
      var v = G.getComputedStyle(G.document.documentElement).getPropertyValue(name);
      return v && v.trim() ? v.trim() : def;
    } catch (e) { return def; }
  }
  function readColors() {
    return {
      fg: cssVar('--fg', '#ddd6c4'), muted: cssVar('--muted', '#938f7f'), dim: cssVar('--dim', '#64635c'),
      sun: cssVar('--sun', '#f1b65a'), moon: cssVar('--moon', '#c3cddd'), grey: cssVar('--moon-grey', '#7a8192'),
      black: cssVar('--moon-black', '#2a2f3c'), mono: cssVar('--f-mono', 'monospace'), body: cssVar('--f-body', 'sans-serif')
    };
  }
  function mobile() { return ui.layout && ui.layout.isMobile ? ui.layout.isMobile() : false; }
  function fpOn() { return !!(HY.app && HY.app.active && HY.app.active() === 'fp'); }
  function pose() {
    try { return HY.fp && HY.fp.api && HY.fp.api.pose ? HY.fp.api.pose() : null; } catch (e) { return null; }
  }
  function debugOn() { return !!(HY.state && HY.state.fp && HY.state.fp.debug && HY.state.fp.debug.hudPerf); }

  function touchUI() { return mobile() || !!(G.matchMedia && G.matchMedia('(pointer: coarse)').matches); }
  function ctlState() {
    var c = HY.fp && HY.fp.ctl;
    try { return c && typeof c.state === 'function' ? c.state() : null; } catch (e) { return null; }
  }
  function ctlToggle(t) {
    var c = HY.fp && HY.fp.ctl;
    if (c && typeof c.toggle === 'function') { c.toggle(t.id); return; }
    // 退回：派发同名按键（controls 听 keydown 时同样生效）
    try { G.dispatchEvent(new G.KeyboardEvent('keydown', { key: t.key, code: t.code, shiftKey: t.id === 'run', bubbles: true })); }
    catch (e) { /* 老浏览器：忽略 */ }
  }

  H.init = function () {
    var w = ui.w, d = G.document;
    el = d.getElementById('fpHud');
    if (!el || !w) return;
    el.textContent = '';
    colors = readColors();

    // 状态条（画面上方、罗盘下面）：后台换档的进度与“画面已切到某档”，第一人称里唯一的一条提示
    var stat = w.h('div', 'hud-status'); stat.hidden = true; stat.setAttribute('role', 'status');
    var statTxt = w.h('span', 'hud-status-txt'), statBar = w.h('i', 'hud-status-bar'), statFill = w.h('b');
    statBar.appendChild(statFill); stat.appendChild(statTxt); stat.appendChild(statBar);

    // 顶部中央：罗盘条
    var top = w.h('div', 'hud-top hud-part');
    var cv = w.h('canvas', 'hud-compass'); cv.setAttribute('aria-hidden', 'true');
    var heading = w.h('div', 'hud-heading num');
    top.appendChild(cv); top.appendChild(heading);

    // 左上：地名、年、日期、时辰、天气
    var tl = w.h('div', 'hud-tl hud-part');
    var place = w.h('div', 'hud-place'), year = w.h('div', 'hud-year'), date = w.h('div', 'hud-date num'), time = w.h('div', 'hud-time num');
    var wx = w.h('div', 'hud-wx'), yx = w.h('div', 'hud-yx');
    tl.appendChild(place); tl.appendChild(year); tl.appendChild(date); tl.appendChild(time); tl.appendChild(wx); tl.appendChild(yx);

    // 右下：读数（默认收起成一行；开合记在 ui.open）
    var br = w.h('div', 'hud-br hud-part');
    var fold = w.fold('读数', 'HUD读数2', false, { cls: 'hud-read' });
    var digest = w.h('span', 'hud-digest num');
    fold.head.appendChild(digest);
    var dl = w.h('dl', 'kv hud-kv'), rows = {};
    [['here', '所在'], ['sun', '太阳'], ['moon', '月'], ['lux', '光'], ['eye', '眼睛'], ['tier', '画质'], ['dbg', '调试']].forEach(function (k) { rows[k[0]] = w.kv(dl, k[1]); });
    var dbgRow = rows.dbg.previousSibling;
    fold.body.appendChild(dl);
    var gpu = w.h('div', 'hud-gpu num'); gpu.hidden = true;
    fold.body.appendChild(gpu);
    br.appendChild(fold.el);
    // 展开读数时，首次提示若还在就立刻收掉（验收回归第 3 条：手机横屏时提示正好压在展开的读数上）
    fold.el.addEventListener('toggle', function () { if (fold.el.open) dropHint(); });

    // 左下：快捷朝向（桌面）与行走状态
    var bl = w.h('div', 'hud-bl hud-part hud-looks');
    H.LOOKS.forEach(function (k) {
      bl.appendChild(w.btn(k.label, { cls: 'btn hud-btn', title: k.title, onClick: function () { H.look(k.id); } }));
    });
    var mode = w.h('div', 'hud-mode hud-part'); mode.hidden = true; mode.setAttribute('aria-live', 'polite');

    // 触屏：右侧“跑／骑马／望远”（开关）与“朝向”；左下摇杆的样子
    var touch = w.h('div', 'hud-touch hud-part'), tbtn = {};
    H.TOUCH.forEach(function (t) {
      var b = w.btn(t.label, { cls: 'btn hud-btn hud-tbtn', title: t.label + '（开关）', pressed: false, onClick: function () { ctlToggle(t); syncTouch(); } });
      tbtn[t.id] = b;
      touch.appendChild(b);
    });
    var lp = w.pop('朝向', { cls: 'hud-lookpop', aria: '快捷朝向', align: 'left' });
    H.LOOKS.forEach(function (k) {
      lp.panel.appendChild(w.btn(k.label, { cls: 'menu-item', title: k.title, onClick: function () { H.look(k.id); lp.open(false); } }));
    });
    touch.appendChild(lp.wrap);

    var joy = w.h('div', 'hud-joy'), knob = w.h('i'); joy.appendChild(knob); joy.hidden = true; joy.setAttribute('aria-hidden', 'true');
    var cross = w.h('div', 'hud-cross'); cross.setAttribute('aria-hidden', 'true');
    var hint = w.h('div', 'hud-hint'); hint.hidden = true;

    [stat, top, tl, br, bl, mode, touch, joy, cross, hint].forEach(function (x) { el.appendChild(x); });
    parts = { stat: stat, statTxt: statTxt, statFill: statFill, statBar: statBar, top: top, cv: cv, heading: heading, place: place, year: year, date: date, time: time,
      wx: wx, yx: yx, fold: fold, digest: digest, rows: rows, dbgRow: dbgRow, gpu: gpu, cross: cross, hint: hint, touch: touch, looks: bl, mode: mode,
      tbtn: tbtn, joy: joy, knob: knob };

    var bus = HY.bus;
    bus.on('frame', function () { H.update(false); });
    bus.on('view', function () { H.update(true); });
    bus.on('ready', function () { H.update(true); });
    bus.on('fp', function (e) { if (ui.touches(e, 'fp.hud') || ui.touches(e, 'fp.cross') || ui.touches(e, 'fp.debug') || ui.touches(e, 'fp.cloud') || ui.touches(e, 'fp.set')) H.update(true); });
    bus.on('layout', function () { lastDraw.w = 0; H.update(true); });
    bus.on('progress', function (p) {
      if (!fpOn() || !p || p.phase !== 'tier') return;
      var L = ui.layout, e = L && L.eta ? L.eta(p) : null;
      if (!e || e.done) { if (status.kind === 'tier') showStatus('', 0); return; }
      var m = /“(.+?)”档/.exec(p.label || '');
      showStatus('画面还会变清楚：正在后台准备“' + (m ? m[1] : '更高') + '”档 · ', e.frac, 'tier', 0, e);
      if (L.animBar) L.animBar(parts.statFill, e.frac, e.elapsed, e.exp);   // 合成线程走条子：编译时主线程会卡住
    });
    bus.on('context', function (e) {
      if (!fpOn()) return;
      if (e && e.lost) showStatus('图形上下文丢失，正在恢复', NaN, 'ctx');
      else if (status.kind === 'ctx') showStatus('', 0);
    });
    bus.on('quality', function (q) {
      if (!fpOn() || !q) return;
      var L = ui.layout;
      showStatus(L && L.qualityText ? L.qualityText(q) : '画面已切到“' + (H.TIER[q.tier] || q.tier) + '”档', NaN, 'done', q.suggest ? 6000 : 3500);
    });
    H.update(true);
  };

  // 状态条：txt 空＝收起；frac 为数时画进度，NaN 不画；ms＝自动收起（0＝一直显示）
  //   eta（后台换档时）：txt 当前缀，后面接 ui.layout.etaPaint 排好的三句（到点由合成线程切换，主线程卡住也不冻在一句上）
  function showStatus(txt, frac, kind, ms, eta) {
    var S = parts.stat; if (!S) return;
    if (!txt) { S.hidden = true; status.kind = ''; return; }
    var L = ui.layout;
    if (eta && L && L.etaPaint) L.etaPaint(parts.statTxt, eta, 'tier', txt);
    else parts.statTxt.textContent = txt;
    parts.statBar.hidden = !isFinite(frac);
    if (isFinite(frac) && kind !== 'tier') { parts.statFill.style.transition = 'none'; parts.statFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)) + ')'; }
    S.hidden = false; status.kind = kind || ''; status.until = ms ? Date.now() + ms : 0;
  }
  H.status = function () { return parts.stat && !parts.stat.hidden ? (ui.layout && ui.layout.etaNow ? ui.layout.etaNow(parts.statTxt) : parts.statTxt.textContent) : ''; };
  // 后台换档的进度条按时间往前走（编译可能好几秒没有新事件）
  function tickStatus() {
    if (status.until && Date.now() > status.until) { showStatus('', 0); return; }
    if (status.kind !== 'tier') return;
    var dbg = null;
    try { dbg = HY.fp && HY.fp.debug ? HY.fp.debug() : null; } catch (e) { dbg = null; }
    if (dbg && dbg.compile && !dbg.compile.pending) { showStatus('', 0); return; }
    var L = ui.layout;
    if (dbg && dbg.compile && L && L.eta) {
      var c = dbg.compile, e = L.eta({ phase: 'tier', done: c.done, total: c.total, label: '正在编译“' + (H.TIER[c.tier] || c.tier) + '”档' });
      if (e && !e.done) { if (L.animBar) L.animBar(parts.statFill, e.frac, e.elapsed, e.exp); if (L.etaPaint) L.etaPaint(parts.statTxt, e, 'tier', '画面还会变清楚：正在后台准备“' + (H.TIER[c.tier] || c.tier) + '”档 · '); }
    }
  }

  // 快捷朝向：第一人称就绪时平滑转过去
  H.look = function (id) {
    try { if (HY.fp && HY.fp.api && HY.fp.api.lookPreset) HY.fp.api.lookPreset(id); }
    catch (e) { if (ui.layout) ui.layout.toast('转不过去：' + e.message); }
  };

  function dropHint() {
    var h = parts.hint;
    if (!h || h.hidden) return;
    clearTimeout(hintTimer); hintTimer = null;
    h.classList.add('out'); h.hidden = true;
  }
  H.dropHint = dropHint;

  function showHint() {
    if (hinted) return;
    hinted = true;
    var h = parts.hint, c = HY.fp && HY.fp.ctl, txt = null;
    try { txt = c && typeof c.hint === 'function' ? c.hint() : null; } catch (e) { txt = null; }
    h.textContent = txt ? H.fixHint(txt) : (touchUI() ? H.HINT.touch : H.HINT.desk);
    if (parts.fold && parts.fold.el && parts.fold.el.open && (touchUI() || (G.innerHeight || 900) < 600)) { h.hidden = true; return; }   // 读数已展开（触屏、矮屏）：不再盖一条提示
    h.hidden = false; h.classList.remove('out');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { h.classList.add('out'); hintTimer = setTimeout(function () { h.hidden = true; }, 800); }, 6000);
  }

  /* 每帧调用：罗盘条按需重画（朝向或日月方位变了才画）；文字 4 Hz */
  H.update = function (force) {
    if (!el) return;
    var on = fpOn();
    if (on !== shown) { shown = on; el.hidden = !on; if (on) { showHint(); force = true; } else showStatus('', 0); }
    if (!on) return;
    var st = HY.state, n = HY.model.now;
    if (!n) return;
    el.dataset.hud = st.fp.hud ? '1' : '0';
    el.dataset.mobile = mobile() ? '1' : '0';
    el.dataset.touch = touchUI() ? '1' : '0';
    parts.cross.hidden = !st.fp.cross;
    drawJoy();
    if (!st.fp.hud) return;
    var ps = pose() || { s: st.site.s, az: st.site.az, yaw: st.fp.yaw, pitch: st.fp.pitch, fov: st.fp.fov };
    var t = HY.util.now();
    if (force || t - lastTxt >= 250) { lastTxt = t; texts(ps, n); tickStatus(); }
    drawCompass(ps, n, force);
  };

  // 触屏按钮的开合与摇杆的样子（数据来自 HY.fp.ctl.state()）
  function syncTouch() {
    var cs = ctlState(); if (!cs) return;
    H.TOUCH.forEach(function (t) {
      var b = parts.tbtn[t.id], on = !!cs[t.id];
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    });
  }
  var lastSync = 0;
  function syncTouchLazy(cs) {
    var t = HY.util.now();
    if (!cs || t - lastSync < 200) return;
    lastSync = t; syncTouch();
  }
  function drawJoy() {
    var cs = ctlState(), j = cs && cs.joy, J = parts.joy;
    syncTouchLazy(cs);
    if (!j) { if (!J.hidden) J.hidden = true; return; }
    var dx = j.x - j.cx, dy = j.y - j.cy, m = Math.sqrt(dx * dx + dy * dy), k = m > j.r ? j.r / m : 1;
    J.style.left = (j.cx - j.r) + 'px'; J.style.top = (j.cy - j.r) + 'px'; J.style.width = J.style.height = (2 * j.r) + 'px';
    parts.knob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
    J.hidden = false;
  }

  function drawCompass(ps, n, force) {
    var cv = parts.cv, wCss = cv.clientWidth || 0, hCss = cv.clientHeight || 0;
    if (!wCss || !hCss) return;
    var L = lastDraw, yaw = ps.yaw, fov = ps.fov, sc = sky.sunCloud, mc = sky.moonCloud;
    var same = !force && L.w === wCss && Math.abs(wrapDeg(L.yaw - yaw)) < 0.05 && Math.abs(L.sa - n.sun.az) < 0.05 && Math.abs(L.ma - n.moon.az) < 0.05
      && L.fov === fov && (L.sv < 0.5) === (n.sun.vis < 0.5) && (L.mv < 0.5) === (n.moon.vis < 0.5) && L.ms === n.moon.state && L.sc === sc && L.mc === mc;
    if (same) return;
    L.yaw = yaw; L.sa = n.sun.az; L.ma = n.moon.az; L.w = wCss; L.fov = fov; L.sv = n.sun.vis; L.mv = n.moon.vis; L.ms = n.moon.state; L.sc = sc; L.mc = mc;
    var dpr = Math.min(G.devicePixelRatio || 1, 2), W = Math.round(wCss * dpr), Hh = Math.round(hCss * dpr);
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    var c = cv.getContext('2d'), C = colors;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, wCss, hCss);
    var mid = wCss / 2, half = wCss / 2 - 8;
    function X(x) { return mid + x * half; }
    // 刻度
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    H.ticks(yaw, SPAN, 15).forEach(function (k) {
      var x = X(k.x), a = 1 - 0.45 * Math.abs(k.x);
      c.globalAlpha = a;
      c.strokeStyle = C.fg; c.lineWidth = k.card ? 1.5 : 1; if (!k.card && !k.major) c.globalAlpha = a * 0.6;
      c.beginPath(); c.moveTo(x, hCss - 1); c.lineTo(x, hCss - (k.card ? 11 : k.major ? 8 : 5)); c.stroke();
      if (k.card) {
        c.fillStyle = C.fg; c.font = '600 12px ' + C.body;
        c.fillText(k.card + (k.sub ? '·' + k.sub : ''), x, 13);
      } else if (k.major) {
        c.fillStyle = C.fg; c.globalAlpha = a * 0.75; c.font = '10px ' + C.mono;
        c.fillText(String(k.az), x, 12);
      }
    });
    c.globalAlpha = 1;
    // 视野边（水平视角）
    var st = G.document.getElementById('stage'), r = st ? st.getBoundingClientRect() : null;
    if (r && r.height > 0 && isFinite(fov)) {
      var hf = H.hfov(fov, r.width / r.height) / 2;
      if (hf < SPAN) {
        c.strokeStyle = C.dim; c.lineWidth = 1;
        [-1, 1].forEach(function (s) { var x = X(s * hf / SPAN); c.beginPath(); c.moveTo(x, hCss - 3); c.lineTo(x, 17); c.stroke(); });
      }
    }
    // 日、月：看得见实心；被塔挡住空心；在云后空心虚线（罗盘与读数说同一件事）
    function body(az, vis, cloud, fill, stroke, rad) {
      var x = H.compassX(az, yaw, SPAN); if (x == null) return;
      var px = X(x), py = hCss - 14;
      c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2);
      if (vis >= 0.5 && cloud !== '在云后') { c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); } }
      else {
        c.strokeStyle = fill === C.black ? C.grey : fill; c.lineWidth = 1.5;
        if (vis >= 0.5 && c.setLineDash) c.setLineDash([2, 2]);
        c.stroke();
        if (c.setLineDash) c.setLineDash([]);
      }
    }
    var mfill = n.moon.state === '亮月' ? C.moon : n.moon.state === '灰月' ? C.grey : C.black;
    if (HY.state.ov.showMoon !== false) body(n.moon.az, n.moon.vis, mc, mfill, n.moon.state === '黑月' ? C.grey : null, 4.5);
    body(n.sun.az, n.sun.vis, sc, C.sun, null, 5.5);
    // 正前方
    c.fillStyle = C.sun;
    c.beginPath(); c.moveTo(mid - 5, 0); c.lineTo(mid + 5, 0); c.lineTo(mid, 6); c.closePath(); c.fill();
    parts.heading.textContent = HY.calc.dirName(yaw);
  }

  // 此地天气与日月的云况（按相机此刻的位置；大气顶直射 0.5 秒算一次）
  function skyNow(ps, n, ro) {
    var st = HY.state, P = HY.model.P, RD = ui.readouts, t = n.t;
    var wx = RD && RD.weather ? RD.weather(st, P, ps.s, ps.az, t) : null;
    var ratio = null, now = Date.now();
    if (n.sun.vis >= 0.5 && ro && isFinite(ro.Esun) && (ro.age == null || ro.age < 3)) {
      var key = ps.s.toFixed(1) + '|' + ps.az.toFixed(2) + '|' + HY.model.pv;
      if (!sky.il || now - sky.ilAt > 500 || key !== sky.ilKey) {
        try { sky.il = HY.calc.illum(HY.astro.site(ps.s, ps.az, P), t, P, {}); } catch (e) { sky.il = null; }
        sky.ilAt = now; sky.ilKey = key;
      }
      var top = sky.il && sky.il.sunNormalLux;
      if (top > 1) ratio = ro.Esun / top;
    }
    var cl = RD && RD.cloudOver ? RD.cloudOver(wx, ratio) : '';
    // 实测在罪域阴云下也有用：偶尔的云缝里日面会露出来
    if (wx && wx.overcast && ratio != null && ratio >= 0.4) cl = '从云缝里露出';
    sky.wx = wx; sky.sunCloud = n.sun.vis >= 0.5 ? cl : '';
    sky.moonCloud = wx && wx.overcast ? '在云后' : '';
    return wx;
  }

  function texts(ps, n) {
    var W = HY.world, U = HY.util, c = n.cal, sep = W.CAL.names.sep, P = HY.model.P, R = parts.rows, F = ui.fmt;
    var ro = null;
    try { ro = HY.fp.readouts ? HY.fp.readouts() : null; } catch (e) { ro = null; }
    var wx = skyNow(ps, n, ro);
    parts.place.textContent = H.placeLine(ps, HY.state.site, P);
    parts.year.textContent = W.fmtCal(c, 'year');
    parts.date.textContent = [W.fmtCal(c, 'date'), W.fmtCal(c, 'season')].filter(Boolean).join(sep);
    var tw = ui.timebar && ui.timebar.toWinterText ? ui.timebar.toWinterText(c.wd, P) : '';
    parts.date.title = tw;
    parts.time.textContent = [n.hhmm + ' · ' + n.shichen, W.fmtCal(c, 'moon')].filter(Boolean).join(sep);
    parts.wx.textContent = wx && wx.text ? wx.text : '';
    parts.wx.hidden = !(wx && wx.text);
    var y = wx && wx.yuxi, yOn = !!(y && y.on);
    parts.yx.textContent = yOn ? '余息：' + wx.yuxiText : '';
    parts.yx.hidden = !yOn;
    // 行走状态（桌面）
    var cs = ctlState(), mt = touchUI() ? [] : H.modeTexts(cs, ps.fov);
    parts.mode.textContent = mt.join(' · ');
    parts.mode.hidden = !mt.length;
    // 读数：照度（实测没回来时用估算）
    var lux = ro && isFinite(ro.lux) ? ro.lux : NaN, est = false;
    if (!isFinite(lux) && H.estLux(n) != null) { lux = H.estLux(n); est = true; }
    parts.digest.textContent = isFinite(lux) ? F.lux(lux) + (wx && wx.sky ? ' · ' + wx.sky : '') : '';
    var dbg = debugOn();
    var su = n.sun, mo = n.moon;            // 收起时也填（读屏与验收按行取数；4 Hz 的字符串活，不贵）
    R.here.textContent = H.hereText(ps, P);
    R.sun.textContent = '仰角 ' + U.fixed(su.el, 1) + '° · ' + HY.calc.dirName(su.az) + ' · ' + H.sunSeen(su.vis, sky.sunCloud);
    var mv = H.moonSeen(mo, sky.moonCloud);
    R.moon.textContent = '仰角 ' + U.fixed(mo.el, 1) + '° · ' + HY.calc.dirName(mo.az) + ' · ' + H.moonText(mo) + (mv ? ' · ' + mv : '');
    R.lux.textContent = isFinite(lux) ? '地面 ' + F.luxLine(lux) + (est ? '（估算）' : '') : '测量中';
    R.eye.textContent = H.eyeText(ro);
    var tier = (ro && ro.tier) || HY.state.fp.quality, pend = null;
    try { var d = HY.fp.debug ? HY.fp.debug() : null; pend = d && d.compile && d.compile.pending ? d.compile.tier : null; } catch (e1) { pend = null; }
    R.tier.textContent = (H.TIER[tier] || tier) + '档' + (pend && pend !== tier ? '（后台在准备“' + (H.TIER[pend] || pend) + '”档，画面还会变清楚）' : '');
    parts.dbgRow.hidden = R.dbg.hidden = !dbg;
    parts.gpu.hidden = !dbg;
    if (dbg) {
      var pf = null;
      try { pf = HY.app && HY.app.perf ? HY.app.perf() : null; } catch (e2) { pf = null; }
      var fps = ro && ro.fps ? ro.fps : pf ? pf.fps : 0, res = ro && ro.res ? ro.res : pf ? pf.res : '';
      R.dbg.textContent = (fps ? Math.round(fps) + ' fps' : '— fps') + (res ? ' · 内部 ' + (typeof res === 'number' ? Math.round(res * 100) + '%' : res) : '') +
        (ro && isFinite(ro.ev) ? ' · EV ' + U.fixed(ro.ev, 1) : '') + (ro && ro.eye ? ' · ' + ro.eye : '');
      var g = {};
      try { g = HY.fp.gpuTimes ? HY.fp.gpuTimes() : {}; } catch (e3) { g = {}; }
      var ks = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; });
      parts.gpu.textContent = ks.length ? ks.map(function (k) { return k + ' ' + U.fixed(g[k], 2) + ' ms'; }).join('\n') : '这台机器不支持 GPU 计时';
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
