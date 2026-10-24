/* HY.fp.ctl —— 键鼠、指针锁定、触屏摇杆（规格：spec/02 第十七节第 1 条、spec/03 第七节第 2 条、第九节第 7 条）
 * 负责：G 路（第一人称·天体与相机）。只收输入、攒成一个普通对象交给 HY.fp.cam 的 step()，不碰 THREE、不改状态。
 *
 * 用法（E 路 fp.js）：activate 时 HY.fp.ctl.attach(canvas)，deactivate 时 detach()；每帧
 *   var r = cam.step(ctx.dtReal, HY.fp.ctl.input());
 *
 * 键鼠（只在第一人称、焦点不在输入框里时响应；不拦 Ctrl／Alt／⌘ 组合键）：
 *   W A S D／方向键  行走（左右是横移）      Shift 按住跑          R 切换骑马          T 切换望远（5°）
 *   滚轮              凝视（默认视角与一半之间平滑缩放）
 *   拖动画面          转头（画面跟着手走）    单击画面          锁定指针（之后移动鼠标即转头，Esc 退出）
 *   3–9               朝向快捷：北·塔根、东、南·塔顶、西、天顶、看太阳、看月亮（按 HY.fp.cam.LOOK_PRESETS 各项的 key 找）
 * 触屏：左下 45%×60% 区域按下即出虚拟摇杆（以按下点为中心）；其余区域拖动转头；两指捏合＝凝视。
 *   “跑”“骑马”“望远”按钮由 HUD（D 路 fphud）画，按下时调 HY.fp.ctl.toggle('run'|'ride'|'tele') 或 set(名, 真假)。
 *   摇杆的样子也由 HUD 画：每帧读 HY.fp.ctl.state().joy（{cx, cy, x, y, r}，画布内 CSS 像素）。
 * 指针锁定不可用（iframe 没给权限、浏览器拒绝）时只是不锁，拖动转头照常。
 *   连续被拒 C.LOCK_TRIES（3）次才不再尝试：Chrome 在按 Esc 退出锁定后约 1 秒内会拒绝一次新的请求，
 *   不能因为这一次就整个会话都锁不上；锁上一次就清零。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  var C = fp.ctl = {};

  /* ───────── 常量 ───────── */
  C.SENS = {
    lock: 0.11,        // 锁定指针：每像素转多少度（以 55° 视角为准，视角变小时同比变慢）
    drag: 1.0,         // 拖动：画面跟手（1＝手指下的景物跟着手指走）
    wheel: 100,        // 滚轮：多少像素算一格（一格＝凝视 1/4）
    pinch: 2.0,        // 捏合：两指距离每翻一倍算几格
    joyR: 56,          // 摇杆满幅半径（CSS 像素）
    joyDead: 0.12,     // 摇杆死区
    joyRun: 0.92,      // 摇杆推到这么远自动跑
    clickPx: 5         // 鼠标按下到抬起移动不超过这么多像素算单击（单击才去锁指针）
  };
  C.JOY_AREA = { w: 0.45, top: 0.4 };          // 触屏摇杆区：画布左侧 45%、上沿 40% 以下
  C.LOCK_TRIES = 3;                             // 指针锁定连续被拒几次后不再尝试
  var MOVE = {
    KeyW: ['fwd', 1], ArrowUp: ['fwd', 1], KeyS: ['fwd', -1], ArrowDown: ['fwd', -1],
    KeyD: ['right', 1], ArrowRight: ['right', 1], KeyA: ['right', -1], ArrowLeft: ['right', -1]
  };
  var PRESET_KEYS = ['3', '4', '5', '6', '7', '8', '9'];

  /* ───────── 内部状态 ───────── */
  var S;
  function fresh() {
    return {
      el: null, doc: null, off: [], touchAction: null,
      keys: {},                         // 按住的移动键 code → 真
      shift: false, run: false, ride: false, tele: false,
      dYaw: 0, dPitch: 0, zoom: 0,      // 自上次 input() 以来累计
      locked: false, lockFails: 0, lockPending: false,   // 连续被拒次数；有一个请求在等结果（同一次被拒可能既发事件又拒绝 Promise，只记一次）
      drag: null,                       // 鼠标拖动 {id, x, y, x0, y0, moved}
      look: {},                         // 触屏转头的指针 id → {x, y}
      pinch: null,                      // {d}
      joy: null,                        // {id, cx, cy, x, y}
      ext: { fwd: 0, right: 0 }         // 外部摇杆（HUD 自己画摇杆时用 setMove 喂进来）
    };
  }
  S = fresh();

  function stateFp() { return HY.state && HY.state.fp; }
  function active() { return !!S.el && (!HY.state || !HY.state.view || HY.state.view.mode === 'fp'); }
  function typing(t) {
    if (!t || !t.tagName) return false;
    var n = t.tagName.toUpperCase();
    if (n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT') return true;
    return !!t.isContentEditable;
  }
  // 此刻的实际竖直视角（度）：转头灵敏度要跟着凝视、望远变
  function fovNow() {
    var cam = fp.cam && fp.cam.current;
    if (cam && cam.look) { var l = cam.look(); if (isFinite(l.fovEff)) return l.fovEff; }
    var f = stateFp(); return f && f.fov ? f.fov : 55;
  }
  function rect() {
    var r = S.el && S.el.getBoundingClientRect ? S.el.getBoundingClientRect() : null;
    return r && r.height > 0 ? r : { left: 0, top: 0, width: 1, height: 1 };
  }
  function on(target, type, fn, opts) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, opts || false);
    S.off.push(function () { target.removeEventListener(type, fn, opts || false); });
  }
  function clearHeld() {
    S.keys = {}; S.shift = false; S.drag = null; S.look = {}; S.pinch = null; S.joy = null;
  }

  /* ───────── 转头、缩放（累计，等 input() 取走） ───────── */
  // 画面跟手：手往右拖 dx 像素 → 视线往左转 dx·(视角/画布高) 度
  function grab(dx, dy) {
    var k = C.SENS.drag * fovNow() / rect().height;
    S.dYaw -= dx * k; S.dPitch += dy * k;
  }
  C.addLook = function (dYaw, dPitch) { S.dYaw += +dYaw || 0; S.dPitch += +dPitch || 0; };
  C.addZoom = function (n) { S.zoom += +n || 0; };

  /* ───────── 键盘 ───────── */
  function onKeyDown(e) {
    if (!active() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    S.shift = !!e.shiftKey;
    var code = e.code || '';
    if (MOVE[code]) {
      S.keys[code] = true;
      if (code.indexOf('Arrow') === 0 && e.preventDefault) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (code === 'KeyR') { S.ride = !S.ride; return; }
    if (code === 'KeyT') { S.tele = !S.tele; return; }
    if (code === 'Escape') { if (S.locked) C.unlock(); return; }
    var d = PRESET_KEYS.indexOf(e.key) >= 0 ? e.key : /^(Digit|Numpad)[3-9]$/.test(code) ? code.slice(-1) : null;
    var p = d && presetOfKey(d);
    if (p && fp.api && fp.api.lookPreset) fp.api.lookPreset(p.id);
  }
  // 朝向快捷：按 HY.fp.cam.LOOK_PRESETS 里写的 key 找（不靠次序）
  function presetOfKey(d) {
    var list = (fp.cam && fp.cam.LOOK_PRESETS) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === d) return list[i];
    return null;
  }
  function onKeyUp(e) {
    S.shift = !!e.shiftKey;
    if (MOVE[e.code]) delete S.keys[e.code];
  }
  function onBlur() { clearHeld(); }

  /* ───────── 指针（鼠标、触屏、笔统一走 Pointer Events） ───────── */
  function inJoyArea(x, y) {
    var r = rect(), lx = x - r.left, ly = y - r.top;
    return lx >= 0 && lx < r.width * C.JOY_AREA.w && ly > r.height * C.JOY_AREA.top && ly <= r.height;
  }
  function lookIds() { return Object.keys(S.look); }
  function pinchDist() {
    var ids = lookIds(); if (ids.length < 2) return 0;
    var a = S.look[ids[0]], b = S.look[ids[1]], dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function capture(id) { try { if (S.el.setPointerCapture) S.el.setPointerCapture(id); } catch (err) { /* 已失效的指针 */ } }

  function onPointerDown(e) {
    if (!active()) return;
    if (e.pointerType === 'mouse' || !e.pointerType) {
      if (e.button !== 0 || S.locked) return;
      S.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false };
      capture(e.pointerId);
      return;
    }
    // 触屏、笔
    if (e.preventDefault) e.preventDefault();
    capture(e.pointerId);
    if (!S.joy && inJoyArea(e.clientX, e.clientY)) {
      S.joy = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: e.clientX, y: e.clientY };
      return;
    }
    S.look[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (lookIds().length === 2) S.pinch = { d: pinchDist() };
  }
  function onPointerMove(e) {
    if (!active()) return;
    if (S.locked && (e.pointerType === 'mouse' || !e.pointerType)) {
      var k = C.SENS.lock * fovNow() / 55;
      S.dYaw += (e.movementX || 0) * k; S.dPitch -= (e.movementY || 0) * k;
      return;
    }
    var d = S.drag;
    if (d && d.id === e.pointerId) {
      grab(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX; d.y = e.clientY;
      if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) > C.SENS.clickPx) d.moved = true;
      return;
    }
    if (S.joy && S.joy.id === e.pointerId) { S.joy.x = e.clientX; S.joy.y = e.clientY; return; }
    var p = S.look[e.pointerId];
    if (!p) return;
    if (lookIds().length === 1) grab(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
    if (S.pinch) {
      var dn = pinchDist();
      if (S.pinch.d > 0 && dn > 0) S.zoom += Math.log(dn / S.pinch.d) / Math.LN2 * C.SENS.pinch;
      S.pinch.d = dn;
    }
  }
  function onPointerUp(e) {
    var d = S.drag;
    if (d && d.id === e.pointerId) {
      S.drag = null;
      if (!d.moved && e.type === 'pointerup') C.lock();     // 单击画面：锁定指针
      return;
    }
    if (S.joy && S.joy.id === e.pointerId) { S.joy = null; return; }
    if (S.look[e.pointerId]) {
      delete S.look[e.pointerId];
      S.pinch = lookIds().length === 2 ? { d: pinchDist() } : null;
    }
  }
  function onWheel(e) {
    if (!active()) return;
    if (e.preventDefault) e.preventDefault();
    var px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    S.zoom -= px / C.SENS.wheel;
  }
  function onLockChange() {
    var doc = S.doc;
    S.locked = !!(doc && S.el && doc.pointerLockElement === S.el);
    if (S.locked) { S.drag = null; S.lockFails = 0; S.lockPending = false; }
  }
  // 被拒：同一次请求只记一次（新浏览器既发 pointerlockerror 又拒绝 Promise）
  function onLockError() {
    S.locked = false;
    if (!S.lockPending) return;
    S.lockPending = false;
    S.lockFails++;
  }
  function onContextMenu(e) { if (active() && e.preventDefault) e.preventDefault(); }

  /* ───────── 指针锁定 ───────── */
  C.canLock = function () {
    return !!(S.el && S.el.requestPointerLock && S.doc && 'pointerLockElement' in S.doc && S.lockFails < C.LOCK_TRIES);
  };
  C.lock = function () {
    if (!C.canLock() || S.locked) return false;
    S.lockPending = true;
    try {
      var r = S.el.requestPointerLock();
      if (r && typeof r.then === 'function') r.then(null, onLockError);   // 新浏览器返回 Promise
      return true;
    } catch (err) { onLockError(); return false; }
  };
  C.unlock = function () {
    if (S.doc && S.doc.exitPointerLock && S.doc.pointerLockElement === S.el) { try { S.doc.exitPointerLock(); } catch (err) { /* 忽略 */ } }
    S.locked = false;
  };

  /* ───────── 对外接口 ───────── */
  C.attach = function (canvas) {
    if (S.el === canvas && canvas) return C;
    C.detach();
    if (!canvas) return C;
    S.el = canvas;
    S.doc = canvas.ownerDocument || G.document || null;
    var win = (S.doc && S.doc.defaultView) || G;
    if (canvas.style) { S.touchAction = canvas.style.touchAction; canvas.style.touchAction = 'none'; }
    on(win, 'keydown', onKeyDown);
    on(win, 'keyup', onKeyUp);
    on(win, 'blur', onBlur);
    on(canvas, 'pointerdown', onPointerDown);
    on(canvas, 'pointermove', onPointerMove);
    on(canvas, 'pointerup', onPointerUp);
    on(canvas, 'pointercancel', onPointerUp);
    on(canvas, 'lostpointercapture', onPointerUp);
    on(canvas, 'wheel', onWheel, { passive: false });
    on(canvas, 'contextmenu', onContextMenu);
    on(S.doc, 'pointerlockchange', onLockChange);
    on(S.doc, 'pointerlockerror', onLockError);
    return C;
  };
  C.detach = function () {
    if (S.el) {
      C.unlock();
      if (S.el.style && S.touchAction != null) S.el.style.touchAction = S.touchAction;
    }
    S.off.forEach(function (f) { try { f(); } catch (err) { /* 忽略 */ } });
    var keep = { run: S.run, ride: S.ride, tele: S.tele, lockFails: S.lockFails };
    S = fresh();
    // 跑、骑马、望远是“开关”，离开第一人称再回来时保持；锁定被拒的次数也保留（iframe 不给权限时不必每次进来再试三回）
    S.run = keep.run; S.ride = keep.ride; S.tele = keep.tele; S.lockFails = keep.lockFails;
  };
  C.attached = function () { return !!S.el; };

  // 每帧调一次 → {fwd, right, run, ride, tele, dYaw, dPitch, zoom}；dYaw/dPitch（度）与 zoom（格）是自上次以来累计，取走即清零
  C.input = function () {
    var fwd = 0, right = 0, k;
    for (k in S.keys) if (S.keys[k] && MOVE[k]) { if (MOVE[k][0] === 'fwd') fwd += MOVE[k][1]; else right += MOVE[k][1]; }
    fwd = Math.max(-1, Math.min(1, fwd)); right = Math.max(-1, Math.min(1, right));
    var joyRun = false, j = C.joyVector();
    if (j.m > 0) { fwd = j.fwd; right = j.right; joyRun = j.m >= C.SENS.joyRun; }
    if (S.ext.fwd || S.ext.right) { fwd = S.ext.fwd; right = S.ext.right; }
    var o = {
      fwd: fwd, right: right, run: !!(S.shift || S.run || joyRun), ride: !!S.ride, tele: !!S.tele,
      dYaw: S.dYaw, dPitch: S.dPitch, zoom: S.zoom
    };
    S.dYaw = 0; S.dPitch = 0; S.zoom = 0;
    return o;
  };
  // 触屏摇杆 → {fwd, right, m}（m＝推出的比例，死区内为 0）
  C.joyVector = function () {
    var j = S.joy; if (!j) return { fwd: 0, right: 0, m: 0 };
    var dx = (j.x - j.cx) / C.SENS.joyR, dy = (j.y - j.cy) / C.SENS.joyR, m = Math.sqrt(dx * dx + dy * dy);
    if (m <= C.SENS.joyDead) return { fwd: 0, right: 0, m: 0 };
    var mc = Math.min(m, 1), mm = (mc - C.SENS.joyDead) / (1 - C.SENS.joyDead);   // 去掉死区后的推幅 0–1
    return { fwd: -dy / m * mm, right: dx / m * mm, m: mc };
  };
  // 开关：'run'（触屏的“跑”是开关；键盘跑是按住 Shift）、'ride'、'tele'
  C.set = function (name, v) {
    if (name === 'run' || name === 'ride' || name === 'tele') S[name] = !!v;
    return C.state();
  };
  C.toggle = function (name) { return C.set(name, !S[name]); };
  // HUD 自己画摇杆时喂进来（−1..1；都给 0 即松开）
  C.setMove = function (fwd, right) {
    S.ext.fwd = Math.max(-1, Math.min(1, +fwd || 0)); S.ext.right = Math.max(-1, Math.min(1, +right || 0));
  };
  // HUD 用：摇杆位置（画布内 CSS 像素）、开关状态、是否锁定
  C.state = function () {
    var r = rect(), j = S.joy;
    return {
      attached: !!S.el, locked: S.locked, canLock: C.canLock(),
      run: !!S.run, ride: !!S.ride, tele: !!S.tele, shift: !!S.shift,
      moving: Object.keys(S.keys).length > 0 || !!j || !!(S.ext.fwd || S.ext.right),
      joy: j ? { cx: j.cx - r.left, cy: j.cy - r.top, x: j.x - r.left, y: j.y - r.top, r: C.SENS.joyR } : null
    };
  };
  // 首次进入第一人称时 HUD 的一行提示
  C.hint = function () {
    var coarse = !!(G.matchMedia && G.matchMedia('(pointer: coarse)').matches);
    if (coarse) return '左下角按住拖动行走，右侧拖动转头，两指捏合凝视';
    return C.canLock() || !S.el ? '拖动或点击画面转头，WASD 行走，Esc 退出' : '拖动画面转头，WASD 行走';
  };
  C.KEY_HELP = [
    ['W A S D／方向键', '行走'], ['Shift', '跑'], ['R', '骑马（开关）'], ['T', '望远（开关）'],
    ['滚轮／两指', '凝视'], ['拖动／单击画面', '转头／锁定指针'], ['Esc', '退出指针锁定'], ['3–9', '朝向快捷']
  ];
})(typeof globalThis !== 'undefined' ? globalThis : window);
