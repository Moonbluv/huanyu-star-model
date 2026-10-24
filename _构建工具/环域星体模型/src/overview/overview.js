/* HY.ov —— 总览三维入口：场景、相机、预设与镜头、帧、拾取、标签、呈现（规格：spec/03 第五节第 2 条、第六节）
 * 负责：B 路。视图接口（与 HY.fp 共用）：init(gfx) / activate() / deactivate() / frame(ctx) / resize(w, h) / dispose() / status()
 * 对外另有：preset(name, {animate}) · pick(clientX, clientY) → {s, az}|null · project(s, az) → {x, y, visible}
 *   · readPx(x, y) → [r, g, b]（显示值 0–255；x、y 为相对画布左上角的 CSS 像素）
 *   · projectKm(X, onWall)（地固系 km 的点 → 屏幕；测试用）· debug()
 * 状态：只读 HY.state 与 HY.model；写入只有三处——用户拖动镜头后写 ov.cam（src:'ov'），预设清空 ov.cam（'ov'），
 *   点选内壁或地点针 patch site（'ov'），双击（触屏为两次轻点）另把 view.mode 设成 'fp'（'ov'，03 第六节第 10 条）。
 *   ov.cam 读进来先过 camOk（六个有限数），坏的当作没有、退回预设。
 * “刚才的站位与朝向”小锥：只在第一人称真的出过图、回到总览之后才画（ov 被 deactivate 过），没进成第一人称不画。
 *
 * 场景（03 第六节第 1 条）：1 单位＝1000 km；原点＝球心；+y＝塔顶；与地固系同轴。
 *   spin 组：随星体转的东西（内壁、巨塔、地点针、日月本体、示意螺旋、每日同刻、塔影体、视线），本地坐标＝地固系；
 *            惯性系（ov.frame＝'inertial'）时整组绕 y 转 geom.spin(P, t)（与 HY.astro.toInertial 同一个角，测试对拍）。
 *   world 组：剖口环、太阳光晕、实际轨迹（惯性系里逐点 HY.astro.toInertial）。
 *   背景星：画在无穷远，惯性系里不动；地固系里每 71.3 分转一圈；流速超过 ×3600 时淡出。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ov = HY.ov = HY.ov || {};

  var K = 1e-3;
  var FOLLOW = { sun: 1, moon: 1, above: 1, winter: 1 };   // 每帧跟着天体或地点走的预设

  var st = { phase: 'idle', progress: 0, reason: '' };
  var gfx = null, THREE = null, active = false, wasDeactivated = false, ctxLost = false;
  var scene = null, camera = null, controls = null, spinG = null, worldG = null, stars = null;
  var U = null, col = null, mode = 'rt', rt = null, presentMat = null, clearLin = null, clearSrgb = null;
  var size = { w: 1, h: 1 }, lastCtx = null;
  var dispSpin = 0, spinNow = 0, camOut = true, clipW = null, camDist = 1;
  var anim = null, follow = null, userCam = false, camWrite = null, userTouch = false, lastInput = -1e9;
  var keys = { p: -1, pins: '' }, pinAnchors = [], pinK = 1, starK = 1, winterCache = { key: '', v: null };
  var offs = [], domOffs = [], fpUsed = false, down = null, hoverTh = null;
  var tmpA = null, tmpB = null;

  /* ───────── 视图接口 ───────── */
  // 同步；THREE 或 OrbitControls 缺失时抛错
  ov.init = function (g) {
    THREE = G.THREE;
    if (!THREE) throw new Error('三维视图需要联网加载 three.js（cdnjs）。图表、读数、参数照常可用。');
    if (!THREE.OrbitControls) throw new Error('OrbitControls 没加载上（jsdelivr）。三维视图暂不可用，图表、读数、参数照常可用。');
    if (!g || !g.renderer) throw new Error('渲染器没有建立，三维视图暂不可用。');
    if (st.phase === 'ready') ov.dispose();
    gfx = g;
    st = { phase: 'loading', progress: 0, reason: '' };
    try {
      col = readColors();
      build();
      wire();
    } catch (e) {
      st = { phase: 'failed', progress: 0, reason: (e && e.message) || String(e) };
      throw e;
    }
    st = { phase: 'ready', progress: 1, reason: '' };
    if (HY.bus) HY.bus.emit('ready', { part: 'ov' });
  };

  ov.activate = function () {
    active = true;
    if (controls) controls.enabled = true;
    if (wasDeactivated) {
      // 从第一人称回来：ov.cam 为空就切到“此地上空”，标出刚才的站位与朝向（03 第五节第 3 条）
      wasDeactivated = false; fpUsed = true;
      if (camera && !camOk(HY.state.ov.cam)) { follow = 'above'; anim = { from: getCam(), name: 'above', t: 0, dur: 0.8 }; }
    }
  };
  ov.deactivate = function () {
    active = false; wasDeactivated = true;
    if (controls) controls.enabled = false;
    ov.labels.clear();
  };
  // ctx = {t, dtReal, dtSim, w, h, now}
  ov.frame = function (ctx) {
    if (!active || st.phase !== 'ready' || ctxLost || !gfx || !gfx.renderer) return;
    lastCtx = ctx;
    draw(ctx);
  };
  ov.resize = function (w, h) {
    var asp0 = size.w / size.h;
    size = { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
    if (camera) { camera.aspect = size.w / size.h; camera.updateProjectionMatrix(); }
    if (rt) rt.setSize(size.w, size.h);
    // 预设的远近随画面宽高比（03 第六节第 9 条“k 按画面宽高比放大”）：init 早于第一次 resize（那时还当 1:1），
    //   手机转屏也会变。没有用户镜头、也不在缓动时，按新的宽高比把当前预设重摆一次（跟随类预设每帧本来就重摆）。
    if (camera && follow && !anim && !userCam && !camOk(HY.state.ov.cam) && Math.abs(size.w / size.h - asp0) > 1e-3) {
      setCam(poseFor(follow));
      if (controls) controls.update();
    }
  };
  ov.dispose = function () {
    teardown();
    offs.forEach(function (f) { f(); }); offs = [];
    domOffs.forEach(function (f) { f(); }); domOffs = [];
    if (controls) { controls.dispose(); controls = null; }
    camera = null; active = false; lastCtx = null; follow = null; anim = null;
    st = { phase: 'idle', progress: 0, reason: '' };
  };
  ov.status = function () { return { phase: st.phase, progress: st.progress, reason: st.reason }; };

  /* ───────── 建场景 ───────── */
  function readColors() {
    var cs = null;
    try { cs = G.getComputedStyle && G.document ? G.getComputedStyle(G.document.documentElement) : null; } catch (e) { cs = null; }
    function hex(name, def) {
      var s = cs ? String(cs.getPropertyValue(name) || '').trim() : '';
      return /^#[0-9a-fA-F]{3,6}$/.test(s) ? s : def;
    }
    function v(name, def) { return HY.util.hexToLinear(hex(name, def)); }
    return {
      zLight: v('--z-light', '#aac3d7'), zPlain: v('--z-plain', '#97a26e'), zHeavy: v('--z-heavy', '#b0603f'),
      zLimbo: v('--z-limbo', '#6a5788'), zTower: v('--z-tower', '#000000'),
      skyNight: v('--sky-night', '#0c1121'), line2: v('--line2', '#353d50'), night: v('--night', '#86a3d0'),
      sun: v('--sun', '#f1b65a'), moon: v('--moon', '#c3cddd'), winter: v('--winter', '#7493bd'), summer: v('--summer', '#dba84a'),
      fg: v('--fg', '#ddd6c4'), bad: v('--bad', '#d0644b'),
      stage: hex('--stage', '#06070b'),
      stone: [0.020, 0.019, 0.018], star: [0.95, 0.96, 1.0]
    };
  }

  function mat(vk, fk, uniforms, o) {
    o = o || {};
    var vs = vk === 'fs' ? gfx.FS_VERT : HY.glsl[vk], fsrc = HY.glsl[fk];
    if (vs == null || fsrc == null || HY.glsl.ov_common == null) throw new Error('缺总览着色器：' + (vs == null ? vk : fk));
    var defs = {};
    if (mode === 'direct') defs.OV_DIRECT = '';
    else if (mode === 'toned') defs.OV_TONED = '';
    var u = {}, k, frag = HY.glsl.ov_common + '\n' + (o.occl ? HY.glsl.ov_occl + '\n' : '') + fsrc;
    for (k in uniforms) u[k] = uniforms[k];
    // 着色器里声明的每个 uniform 都要在材质里有一份：three 只上传材质列出的 uniform，同一程序的其它材质
    // 没列的会沿用上一个材质留下的值（例如背景星的 uSky＝1 会让同程序的线全画到无穷远去）
    fillUniforms(u, vs + '\n' + frag);
    var m = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: frag,
      uniforms: u, defines: defs,
      transparent: !!o.transparent, depthWrite: o.depthWrite !== false, depthTest: o.depthTest !== false,
      side: o.side == null ? THREE.FrontSide : o.side,
      blending: o.blending == null ? THREE.NormalBlending : o.blending
    });
    m.extensions.derivatives = true;
    return m;
  }

  // 没给的 uniform：共享表 U 里有就接上共享的那一份，否则按类型给一份新的默认值
  var UNI_DEF = { uAlpha: 1, uDash: 0.05, uGain: 1, uDarkBase: 0.05 };
  function fillUniforms(u, src) {
    var re = /uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g, mm;
    src = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    while ((mm = re.exec(src))) {
      var type = mm[1];
      mm[2].split(',').forEach(function (raw) {
        var name = raw.replace(/\[.*$/, '').trim();
        if (!name || u[name]) return;
        if (U[name]) { u[name] = U[name]; return; }
        var v = type === 'vec2' ? new THREE.Vector2() : type === 'vec3' ? new THREE.Vector3() : type === 'vec4' ? new THREE.Vector4()
          : /^sampler/.test(type) ? null : UNI_DEF[name] != null ? UNI_DEF[name] : 0;
        u[name] = { value: v };
      });
    }
    return u;
  }

  function build() {
    var caps = gfx.caps || {};
    mode = caps.webgl2 ? (caps.floatRT ? 'rt' : 'toned') : 'direct';
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, size.w / size.h, 0.01, 100);
    spinG = new THREE.Group(); spinG.name = '随星体转';
    worldG = new THREE.Group(); worldG.name = '世界';
    scene.add(spinG); scene.add(worldG);
    clipW = new THREE.Vector3();
    tmpA = new THREE.Vector3(); tmpB = new THREE.Vector3();
    U = {
      uR: { value: 6371 }, uA: { value: 600 }, uDref: { value: 5731 }, uRs: { value: 6.371 },
      uSunW: { value: new THREE.Vector3() }, uSunRho: { value: 20 },
      uMoonW: { value: new THREE.Vector3() }, uMoonRho: { value: 100 },
      uClipN: { value: new THREE.Vector3() }, uWallCut: { value: 0 },
      uStars: { value: 1 }, uSpin: { value: 0 }, uPointSize: { value: 3 }
    };
    var lin = HY.util.hexToLinear(col.stage), srgb = HY.util.hexToRgb(col.stage);
    clearLin = new THREE.Color(lin[0], lin[1], lin[2]);
    clearSrgb = new THREE.Color(srgb[0], srgb[1], srgb[2]);
    var c = { THREE: THREE, spin: spinG, world: worldG, U: U, col: col, mat: mat };
    stars = buildStars(c);
    ov.shell.build(c);
    ov.bodies.build(c);
    ov.labels.init(G.document ? G.document.getElementById('labels') : null);
    if (mode !== 'direct') {
      rt = gfx.rt(size.w, size.h, { type: mode === 'rt' ? 'half' : 'byte', msaa: 4, depth: true });
      presentMat = new THREE.ShaderMaterial({
        vertexShader: gfx.FS_VERT, fragmentShader: HY.glsl.ov_common + '\n' + HY.glsl.ov_present,
        uniforms: { uTex: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uVig: { value: 0.10 }, uCutMode: { value: 0 }, uClipN: U.uClipN },
        defines: mode === 'toned' ? { OV_TONED: '' } : {}, depthTest: false, depthWrite: false
      });
    }
    keys = { p: -1, pins: '' };
    sync();
    // 镜头：ov.cam 优先，否则用预设
    var o = HY.state.ov;
    if (!controls) {
      controls = new THREE.OrbitControls(camera, gfx.canvas);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
      controls.minDistance = 1.2; controls.maxDistance = 90; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9;
      controls.enabled = active;
    } else controls.object = camera;
    if (camOk(o.cam)) { setCam(o.cam); follow = null; }
    else { follow = o.preset; setCam(poseFor(o.preset)); }
    controls.update();
  }

  function buildStars(c) {
    var n = 1800, pos = new Float32Array(3 * n), br = new Float32Array(n), s = 0x9e3779b9;
    function rnd() { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    for (var i = 0; i < n; i++) {
      var z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
      pos[3 * i] = r * Math.cos(a); pos[3 * i + 1] = z; pos[3 * i + 2] = r * Math.sin(a);
      br[i] = 0.15 + 0.85 * Math.pow(rnd(), 4);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(br, 1));
    var pts = new THREE.Points(geo, c.mat('ov_line_vert', 'ov_line', {
      uColor: { value: new THREE.Vector3(col.star[0], col.star[1], col.star[2]) }, uAlpha: { value: 1 }, uTMode: { value: 3 },
      uPoint: { value: 1 }, uSky: { value: 1 }, uPointSize: U.uPointSize
    }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; pts.name = '背景星';
    scene.add(pts);
    return pts;
  }

  function teardown() {
    if (!scene) return;
    try { ov.bodies.dispose(); } catch (e) { /* 忽略 */ }
    try { ov.shell.dispose(); } catch (e) { /* 忽略 */ }
    try { ov.labels.dispose(); } catch (e) { /* 忽略 */ }
    if (stars) { stars.geometry.dispose(); stars.material.dispose(); stars = null; }
    if (rt) { rt.dispose(); rt = null; }
    if (presentMat) { presentMat.dispose(); presentMat = null; }
    scene = null; spinG = worldG = null;
  }

  // 参数变化：P（pv）→ 半径、分界、塔、螺旋；地点 → 地点针
  function sync() {
    var M = HY.model, P = M.P, o = HY.state.ov;
    if (keys.p !== M.pv) {
      keys.p = M.pv;
      U.uR.value = P.R; U.uA.value = P.a; U.uDref.value = P.Dref; U.uRs.value = P.R * K;
      ov.shell.rebuild(P, M.Z);
      keys.pins = '';
      winterCache.key = '';
    }
    ov.bodies.rebuild(P, o, M.pv);
    var s = HY.state.site, pk = M.pv + '|' + s.s + '|' + s.az + '|' + s.id;
    if (pk !== keys.pins) { keys.pins = pk; pinAnchors = ov.shell.pins(P, HY.world.siteList(P), { s: s.s, az: s.az, id: s.id }, { show: o.sites }); }
  }

  /* ───────── 事件 ───────── */
  function wire() {
    var bus = HY.bus;
    offs.push(bus.on('ov', onOvState));
    offs.push(gfx.onContext(function (lost) {
      ctxLost = !!lost;
      if (!lost && scene) { var pose = getCam(); teardown(); build(); setCam(pose); }
    }));
    var cv = gfx.canvas;
    function on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt || false); domOffs.push(function () { el.removeEventListener(ev, fn, opt || false); }); }
    camWrite = HY.util.debounce(function () {
      if (!camera || !controls) return;
      userCam = false;
      HY.store.set('ov.cam', { pos: r4(camera.position), target: r4(controls.target), fov: Math.round(camera.fov * 10) / 10 }, 'ov');
    }, 300);
    // 只有“用户输入确实让镜头动了”才算拖动（单击也会触发 start）：draw() 里比较 controls.update() 前后的位姿
    controls.addEventListener('start', function () { userTouch = true; lastInput = HY.util.now(); });
    controls.addEventListener('end', function () { userTouch = false; lastInput = HY.util.now(); });
    // 单击＝同一根指针按下又抬起、挪动不到 4 像素；双指缩放（中途有第二根指针按下）一律不算单击
    //   （isPrimary 的按下说明此前的指针都已抬起，借此清掉在画布外抬起、没收到 pointerup 的残留）
    var ptrs = {};
    function ptrUp(e) { delete ptrs[e.pointerId]; }
    on(cv, 'pointerdown', function (e) {
      if (e.isPrimary) ptrs = {};
      ptrs[e.pointerId] = 1;
      var n = Object.keys(ptrs).length;
      if (active && e.button === 0 && n === 1) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; else down = null;
      ov.labels.hideTip();
    });
    // 触屏的双击：手机浏览器（尤其 iOS）在 touch-action:none 的画布上不一定发 dblclick，这里自己认——
    //   两次单击相隔 ＜350 ms、相距 ＜24 px。鼠标仍走原生 dblclick。两边都发时重复写同样的值，store 不再发事件。
    var lastTap = null;
    on(cv, 'pointerup', function (e) {
      ptrUp(e);
      if (!active || !down || down.id !== e.pointerId) { down = null; return; }
      var d = Math.sqrt((e.clientX - down.x) * (e.clientX - down.x) + (e.clientY - down.y) * (e.clientY - down.y));
      down = null;
      if (d >= 4) return;
      var tn = HY.util.now(), dbl = e.pointerType !== 'mouse' && !!lastTap && lastTap.type === e.pointerType && tn - lastTap.t < 350 &&
        Math.abs(e.clientX - lastTap.x) < 24 && Math.abs(e.clientY - lastTap.y) < 24;
      lastTap = dbl ? null : { t: tn, x: e.clientX, y: e.clientY, type: e.pointerType };
      clickAt(e.clientX, e.clientY, dbl);
    });
    on(cv, 'pointercancel', function (e) { ptrUp(e); down = null; });
    on(cv, 'dblclick', function (e) { if (active) clickAt(e.clientX, e.clientY, true); });
    hoverTh = HY.util.throttle(hover, 100);
    on(cv, 'pointermove', function (e) { if (active) hoverTh(e.clientX, e.clientY, e.buttons, e.pointerType); });
    on(cv, 'pointerleave', function () { ov.labels.hideTip(); });
  }
  function r4(v) { return [Math.round(v.x * 1e4) / 1e4, Math.round(v.y * 1e4) / 1e4, Math.round(v.z * 1e4) / 1e4]; }

  // 别人改了 ov.cam／ov.preset（恢复默认、读档、API、顶栏）
  function onOvState(e) {
    if (!camera || !e || e.src === 'ov') return;
    var ps = e.paths || [e.path], o = HY.state.ov;
    if (!ps.some(function (p) { return p === 'ov' || p === 'ov.cam' || p === 'ov.preset'; })) return;
    if (camOk(o.cam)) { anim = null; follow = null; setCam(o.cam); }
    else if (follow !== o.preset || e.src === 'reset' || e.src === 'load') startPreset(o.preset, true);
  }

  /* ───────── 相机：预设与镜头（03 第六节第 9 条） ───────── */
  // ov.cam 能不能用：{pos:[x,y,z], target:[x,y,z]}，六个都是有限数。读档读到残缺或坏掉的对象（store 只校验“是对象”）
  //   时当作没有，退回预设，免得相机变成 NaN、整个画面黑掉
  function camOk(c) {
    function v3(a) { return Array.isArray(a) && a.length === 3 && fin(a[0]) && fin(a[1]) && fin(a[2]); }
    function fin(x) { return typeof x === 'number' && isFinite(x); }
    return !!(c && v3(c.pos) && v3(c.target));
  }
  ov.camOk = camOk;
  // 位姿另带竖直视角 fov（度）：“此地上空”在球腔里退不远，要 50°（竖屏 70°）；其余预设与旧存档里的镜头按 38°
  var FOV0 = 38;
  function getCam() {
    return { pos: [camera.position.x, camera.position.y, camera.position.z], target: controls ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0], fov: camera.fov };
  }
  function setCam(p) {
    camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (controls) controls.target.set(p.target[0], p.target[1], p.target[2]);
    camera.lookAt(p.target[0], p.target[1], p.target[2]);
    var f = isFinite(p.fov) && p.fov >= 10 && p.fov <= 100 ? p.fov : FOV0;
    if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); }
  }
  function rotY(p, al) { var c = Math.cos(al), s = Math.sin(al); return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c]; }

  // 预设的位姿（场景单位）。跟随类预设在惯性系里跟着整组一起转
  function poseFor(name) {
    var P = HY.model.P, o = HY.state.ov, t = HY.state.time.t, gm = ov.geom, A = HY.astro;
    var gs = gm.gapScale(P, o.sunGapX), c = { aspect: size.w / size.h };
    var s = HY.state.site, O = A.site(s.s, s.az, P); c.site = [O.x, O.y, O.z];     // 此地上空、斜看、侧看都按地点摆
    if (name === 'side' && HY.world && HY.world.SITES) c.sitesAz = HY.world.SITES.map(function (q) { return q.az; });   // 侧看：塔后别藏着预设地点
    if (name === 'sun') { var S = A.sunPos(t, P); c.S = [S.x * gs, S.y, S.z * gs]; }
    else if (name === 'moon') { var Mo = A.moonPos(t, P); c.Mo = [Mo.x, Mo.y, Mo.z]; }
    else if (name === 'winter') {
      var w = gm.winterNear(P, t), Sw = A.sunPos(w.t, P), Mw = A.moonPos(w.t, P);
      c.wS = [Sw.x * gs, Sw.y, Sw.z * gs]; c.wMo = [Mw.x, Mw.y, Mw.z];
    }
    var p = gm.presetPose(name, P, c);
    var sp = o.frame === 'inertial' ? gm.spin(P, t) : 0;
    if (FOLLOW[name] && sp) { p.pos = rotY(p.pos, sp); p.target = rotY(p.target, sp); }
    return p;
  }
  function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  // 目标点直线过去；相机相对目标的方向走大圆、距离按比例
  function blendPose(a, b, e) {
    var T = [0, 1, 2].map(function (i) { return a.target[i] + (b.target[i] - a.target[i]) * e; });
    var oa = [0, 1, 2].map(function (i) { return a.pos[i] - a.target[i]; }), ob = [0, 1, 2].map(function (i) { return b.pos[i] - b.target[i]; });
    var la = Math.sqrt(oa[0] * oa[0] + oa[1] * oa[1] + oa[2] * oa[2]) || 1e-6, lb = Math.sqrt(ob[0] * ob[0] + ob[1] * ob[1] + ob[2] * ob[2]) || 1e-6;
    var ua = oa.map(function (x) { return x / la; }), ub = ob.map(function (x) { return x / lb; });
    var d = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])), ang = Math.acos(d), u;
    if (ang < 1e-4) u = ub;
    else {
      if (Math.PI - ang < 1e-3) {                      // 正好反向：绕一条与之垂直的轴转半圈
        var ax = Math.abs(ua[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], q = ua[0] * ax[0] + ua[1] * ax[1] + ua[2] * ax[2];
        ub = [ax[0] - q * ua[0], ax[1] - q * ua[1], ax[2] - q * ua[2]];
        var lq = Math.sqrt(ub[0] * ub[0] + ub[1] * ub[1] + ub[2] * ub[2]) || 1;
        ub = ub.map(function (x) { return x / lq; });
        var ph = Math.PI * e;
        u = [0, 1, 2].map(function (i) { return Math.cos(ph) * ua[i] + Math.sin(ph) * ub[i]; });
      } else {
        var sa = Math.sin(ang), w0 = Math.sin((1 - e) * ang) / sa, w1 = Math.sin(e * ang) / sa;
        u = [0, 1, 2].map(function (i) { return w0 * ua[i] + w1 * ub[i]; });
      }
    }
    var L = la * Math.pow(lb / la, e), fa = isFinite(a.fov) ? a.fov : FOV0, fb = isFinite(b.fov) ? b.fov : FOV0;
    return { pos: [T[0] + u[0] * L, T[1] + u[1] * L, T[2] + u[2] * L], target: T, fov: fa + (fb - fa) * e };
  }
  function startPreset(name, animate) {
    if (!camera) return;
    // 清掉拖动留下的阻尼余量（关阻尼时 update 会把它一次用完并清零），免得它把缓动当成用户在拖
    if (controls) { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
    lastInput = -1e9; userTouch = false;
    follow = name;
    if (animate) anim = { from: getCam(), name: name, t: 0, dur: 0.8 };
    else { anim = null; setCam(poseFor(name)); if (controls) controls.update(); }
  }
  // 预设：'oblique'|'side'|'fromTop'|'fromRoot'|'above'|'sun'|'moon'|'winter'；opts.animate 默认真（0.8 s 缓动）。
  // 用了预设就清掉 ov.cam（用户镜头），预设按钮才会按下去。
  ov.preset = function (name, opts) {
    if (ov.geom.PRESETS.indexOf(name) < 0) throw new Error('没有这个总览预设：' + name);
    if (!camera) return;
    userCam = false; if (camWrite) camWrite.cancel();
    if (HY.state.ov.cam != null) HY.store.set('ov.cam', null, 'ov');
    startPreset(name, !(opts && opts.animate === false));
  };
  function stepCamera(dt) {
    if (anim) {
      anim.t += dt > 0 ? dt : 0;
      var k = Math.min(1, anim.t / anim.dur);
      setCam(blendPose(anim.from, poseFor(anim.name), ease(k)));
      if (k >= 1) anim = null;
    } else if (follow && FOLLOW[follow] && !camOk(HY.state.ov.cam) && !userCam) setCam(poseFor(follow));
  }

  /* ───────── 每帧 ───────── */
  // 三点一线画哪一次交节（geom.winterFor：当年的，或一日之内的庆典交节）；按（年号, 最近交节, pv）缓存
  function winterOf(now, P, t) {
    var N = now && now.cal && now.cal.N != null ? now.cal.N : P.epochYear, k = Math.round(t / P.Y);
    var key = N + '|' + (Math.abs(t - k * P.Y) < ov.geom.WINTER_WIN ? k : '') + '|' + HY.model.pv;
    if (winterCache.key !== key) winterCache = { key: key, v: ov.geom.winterFor(P, N, t) };
    return winterCache.v;
  }
  function camGroundKm() {
    var p = camera.position, c = Math.cos(-dispSpin), s = Math.sin(-dispSpin);
    return [(p.x * c - p.z * s) / K, p.y / K, (p.x * s + p.z * c) / K];
  }
  function draw(ctx) {
    var P = HY.model.P, o = HY.state.ov, t = ctx.t, now = ctx.now || HY.model.now, dt = ctx.dtReal || 0;
    sync();
    var gm = ov.geom;
    spinNow = gm.spin(P, t);
    dispSpin = o.frame === 'inertial' ? spinNow : 0;
    spinG.rotation.y = -dispSpin;
    // 背景星：惯性系里不动；地固系里每 71.3 分转一圈，流速超过 ×3600 时只剩闪烁，淡出（惯性系里星不动，不必淡出）
    var tm = HY.state.time, fast = tm.playing && tm.speed.ov > 3600 && o.frame !== 'inertial', target = o.stars && !fast ? 1 : 0;
    starK += (target - starK) * (dt > 0 ? Math.min(1, dt / 0.35) : 1);
    U.uStars.value = starK; U.uSpin.value = spinNow;
    stars.rotation.y = spinNow - dispSpin;
    stars.visible = starK > 0.003;
    stars.material.uniforms.uAlpha.value = starK;
    U.uPointSize.value = 2.2 * (gfx.size.dpr || 1);

    // 相机：预设缓动／跟随 → OrbitControls（用户输入与阻尼）。update 前后位姿变了且刚有用户输入＝用户在拖
    stepCamera(dt);
    tmpA.copy(camera.position); tmpB.copy(controls.target);
    controls.update();
    if ((userTouch || HY.util.now() - lastInput < 1500) &&
        (tmpA.distanceToSquared(camera.position) > 1e-12 || tmpB.distanceToSquared(controls.target) > 1e-12)) {
      anim = null; follow = null; userCam = true; camWrite();
    }
    camDist = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.002, 0.004 * camDist);
    camera.far = camera.position.length() + 15;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camOut = camera.position.length() > P.R * K * 1.0005;
    if (camOut) clipW.copy(camera.position).normalize(); else clipW.set(0, 0, 0);
    U.uClipN.value.copy(clipW);

    // 内容
    var s = HY.state.site, O = HY.astro.site(s.s, s.az, P), Ow = rotY([O.x, O.y, O.z], dispSpin);
    var siteCut = camOut && o.cut === 'half' && (Ow[0] * clipW.x + Ow[1] * clipW.y + Ow[2] * clipW.z) > 0;
    // 地点针按镜头远近缩放：默认镜头（约 2.4R）原大，拉近到地点上空时缩到约三成
    pinK = Math.max(0.28, Math.min(1, camDist / (2.4 * P.R * K)));
    ov.shell.update({ P: P, o: o, camOut: camOut, clipW: clipW, site: s, pinK: pinK,
      fpLook: fpUsed ? { yaw: HY.state.fp.yaw, pitch: HY.state.fp.pitch } : null });
    var anchors = ov.bodies.update({ P: P, t: t, o: o, pv: HY.model.pv, camera: camera, camWorld: camera.position, camDist: camDist,
      dispSpin: dispSpin, site: O, siteCut: siteCut, moonState: now && now.moon ? now.moon.state : HY.astro.moonState(t, P), winter: winterOf(now, P, t) });

    render();
    labelFrame(anchors, P, o);
  }

  // 场景这一遍的绘制统计（呈现 pass 会把 renderer.info.render 清零重计，所以在它之前取）
  var sceneInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  function grabInfo(r) { var i = r.info.render; sceneInfo = { calls: i.calls, triangles: i.triangles, points: i.points, lines: i.lines }; }
  function render() {
    var r = gfx.renderer;
    gfx.timer.begin('ov');
    if (rt) {
      r.setRenderTarget(rt);
      r.setClearColor(mode === 'toned' ? clearSrgb : clearLin, 1);   // 8 位目标里存的是 sRGB 值（ov_common 的 OV_TONED）
      r.clear(true, true, false);
      r.render(scene, camera);
      grabInfo(r);
      presentMat.uniforms.uTex.value = rt.texture;
      presentMat.uniforms.uRes.value.set(size.w, size.h);
      r.setRenderTarget(null);
      gfx.fs(presentMat, null);
    } else {
      r.setRenderTarget(null);
      r.setClearColor(clearSrgb, 1);
      r.clear(true, true, false);
      r.render(scene, camera);
      grabInfo(r);
    }
    gfx.timer.end('ov');
  }

  /* ───────── 投影、遮挡、标签 ───────── */
  // X：地固系 km → {x, y（相对画布左上角的 CSS 像素）, inFront, onScreen}
  function screenOf(X) {
    var c = Math.cos(dispSpin), s = Math.sin(dispSpin);
    tmpA.set((X[0] * c - X[2] * s) * K, X[1] * K, (X[0] * s + X[2] * c) * K);
    tmpB.copy(tmpA).applyMatrix4(camera.matrixWorldInverse);
    var inFront = tmpB.z < 0;
    tmpA.project(camera);
    var cw = (gfx.size && gfx.size.cssW) || size.w, ch = (gfx.size && gfx.size.cssH) || size.h;
    return { x: (tmpA.x * 0.5 + 0.5) * cw, y: (-tmpA.y * 0.5 + 0.5) * ch, inFront: inFront, onScreen: inFront && Math.abs(tmpA.x) <= 1 && Math.abs(tmpA.y) <= 1 };
  }
  function occl(X, onWall) {
    var P = HY.model.P, o = HY.state.ov, C = camGroundKm();
    var clip = null;
    if (camOut && o.cut !== 'none') { var l = Math.sqrt(C[0] * C[0] + C[1] * C[1] + C[2] * C[2]); clip = [C[0] / l, C[1] / l, C[2] / l]; }
    return ov.geom.occluded(C, X, { R: P.R, a: P.a, cut: o.cut, clipN: clip, onWall: !!onWall });
  }
  // 地固系 km 的点 → 屏幕；测试与标签用
  ov.projectKm = function (X, onWall) {
    if (!camera) return { x: 0, y: 0, visible: false, why: 'noview' };
    var sc = screenOf(X), why = !sc.inFront ? 'behind' : !sc.onScreen ? 'offscreen' : occl(X, onWall);
    var out = { x: sc.x, y: sc.y, visible: !why, why: why || '' };
    if (gfx.canvas && gfx.canvas.getBoundingClientRect) { var r = gfx.canvas.getBoundingClientRect(); out.clientX = r.left + sc.x; out.clientY = r.top + sc.y; }
    return out;
  };
  // 测试用：地点在屏幕上的位置（内壁上的点）
  ov.project = function (s, az) {
    if (!camera) return { x: 0, y: 0, visible: false };
    var O = HY.astro.site(s, az, HY.model.P);
    return ov.projectKm([O.x, O.y, O.z], true);
  };

  /* 标签的禁区（画布坐标）：顶栏里的按钮与要点、图例、示意小字、入冬字幕。只量这些元素本身（不量顶栏的整条渐变），
   *   0.3 秒量一次（getBoundingClientRect 每帧量会逼浏览器排版） */
  var BLOCK_SEL = ['#topbar .title', '#viewSwitch', '#ovPresets .btn-preset', '#ovPresets .preset-sel', '#nowChips .chip', '#topbar .top-tools .btn',
    '#legend .lg-row', '#ovNote', '#ovCaption'];
  var blockCache = { at: -1e9, rects: [] };
  function blockRects() {
    var t = HY.util.now();
    if (t - blockCache.at < 300) return blockCache.rects;
    blockCache.at = t;
    var out = [], d = G.document;
    if (!d || !d.querySelectorAll || !gfx.canvas || !gfx.canvas.getBoundingClientRect) return (blockCache.rects = out);
    var cr = gfx.canvas.getBoundingClientRect();
    BLOCK_SEL.forEach(function (sel) {
      var els = d.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.hidden || !e.getClientRects || !e.getClientRects().length) continue;
        var r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push([r.left - cr.left - 3, r.top - cr.top - 3, r.right - cr.left + 3, r.bottom - cr.top + 3]);
      }
    });
    return (blockCache.rects = out);
  }
  ov.labelBlocks = function () { blockCache.at = -1e9; return blockRects().slice(); };
  // 两京（伊美忒、圣禁城）排在其它地点前面：从塔顶看帝国时两处挨得近，原先总是只标出一个
  var SITE_PRIO = { yimeite: 2.8, shengjin: 2.8 };
  function labelFrame(anchors, P, o) {
    var list = anchors;
    if (o.sites) pinAnchors.forEach(function (a) {
      list.push({ id: 'site:' + (a.cur ? '此地' : a.id), text: a.name, X: pinHead(a), base: a.base, kind: 'site', cur: a.cur,
        prio: a.cur ? 0 : SITE_PRIO[a.id] || 3, place: ov.labels.PLACE_ALL });
    });
    var H = 1.12 * P.R, C = camGroundKm(), ch = Math.sqrt(C[0] * C[0] + C[2] * C[2]) || 1, hx = C[0] / ch, hz = C[2] / ch;
    // 两极：先放在塔端外（穿出外壳处）；那里被挡住时（斜看时塔根端总在内壁背后）改放到塔与内壁相接处、朝相机的一侧
    var rb = P.a * 1.06, yb = Math.sqrt(Math.max(0, P.R * P.R - rb * rb));
    list.push({ id: 'root', text: '塔根·北极', X: [0, -H, 0], alt: [hx * rb, -yb, hz * rb], kind: 'pole', prio: 2 });
    list.push({ id: 'top', text: '塔顶·南极', X: [0, H, 0], alt: [hx * rb, yb, hz * rb], kind: 'pole', prio: 2 });
    list.push({ id: 'waist', text: '塔腰', X: [hx * rb, 0, hz * rb], kind: 'pole', prio: 4 });
    if (camOut && o.cut !== 'half') {
      // 外表面：近侧外壁上、从相机方向往画面左上偏 22° 的那一点
      var cl = Math.sqrt(C[0] * C[0] + C[1] * C[1] + C[2] * C[2]), c2 = Math.cos(-dispSpin), s2 = Math.sin(-dispSpin);
      tmpA.set(-0.8, 0.6, 0).applyQuaternion(camera.quaternion);   // 相机坐标里的左上方向 → 世界
      var ug = [tmpA.x * c2 - tmpA.z * s2, tmpA.y, tmpA.x * s2 + tmpA.z * c2], cn = [C[0] / cl, C[1] / cl, C[2] / cl], q = ug[0] * cn[0] + ug[1] * cn[1] + ug[2] * cn[2];
      var pu = [ug[0] - q * cn[0], ug[1] - q * cn[1], ug[2] - q * cn[2]], pl = Math.sqrt(pu[0] * pu[0] + pu[1] * pu[1] + pu[2] * pu[2]);
      if (pl > 1e-6) {
        var a38 = 22 * Math.PI / 180, X = [0, 1, 2].map(function (i) { return P.R * (Math.cos(a38) * cn[i] + Math.sin(a38) * pu[i] / pl); });
        list.push({ id: 'outer', text: '外表面·神的国', X: X, kind: 'free', prio: 5, onWall: true });
      }
    }
    var C2 = camGroundKm(), cl2 = Math.sqrt(C2[0] * C2[0] + C2[1] * C2[1] + C2[2] * C2[2]), clipG = [C2[0] / cl2, C2[1] / cl2, C2[2] / cl2];
    var half = camOut && o.cut === 'half';
    // 锚点本身在屏幕上的半径（日、月圆盘，像素）：rad km → 透视投影
    var fpx = (gfx.size && gfx.size.cssH || size.h) / 2 / Math.tan(camera.fov * Math.PI / 360);
    function radPx(X, rad) {
      if (!(rad > 0)) return 0;
      var c = Math.cos(dispSpin), s = Math.sin(dispSpin);
      tmpA.set((X[0] * c - X[2] * s) * K, X[1] * K, (X[0] * s + X[2] * c) * K);
      var d = tmpA.distanceTo(camera.position);
      return d > 1e-6 ? rad * K / d * fpx : 0;
    }
    function at(X, onWall, base, rad, px) {
      var sc = screenOf(X);
      if (!sc.onScreen) return null;
      if (base && half && base[0] * clipG[0] + base[1] * clipG[1] + base[2] * clipG[2] > 0) return null;
      if (occl(X, onWall)) return null;
      return { x: sc.x, y: sc.y, ok: true, r: radPx(X, rad) + (px || 0) };
    }
    // 日、月的标签先往离塔轴远的那一侧摆（三点一线的白线、塔腰都在塔轴那一侧），再试另一侧、上、下
    var block = blockRects().slice();
    list.forEach(function (a) {
      if (!a.rad && !a.px) return;
      var p = at(a.X, false, null, a.rad, a.px);
      if (!p) return;
      var ax = screenOf([0, a.X[1], 0]);
      a.place = p.x < ax.x ? ['left', 'above', 'below', 'right'] : ['right', 'above', 'below', 'left'];
      if (p.r > 3) block.push([p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r]);       // 圆盘本身也是禁区：别的标签不写在月面上
    });
    ov.labels.frame({
      show: !!o.labels,
      anchors: list,
      block: block, w: (gfx.size && gfx.size.cssW) || size.w, h: (gfx.size && gfx.size.cssH) || size.h,
      project: function (a) { return at(a.X, !!a.onWall, a.base, a.rad, a.px) || (a.alt ? at(a.alt, true, null) : null); }
    });
  }

  /* ───────── 交互（03 第六节第 10 条） ───────── */
  // 针头（随镜头远近缩放后的位置，km）
  function pinHead(a) { return [0, 1, 2].map(function (i) { return a.base[i] + (a.X[i] - a.base[i]) * pinK; }); }
  function pinAt(cx, cy) {
    if (!HY.state.ov.sites || !gfx.canvas) return null;
    var r = gfx.canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, best = null, bd = 12;
    pinAnchors.forEach(function (a) {
      var p = ov.projectKm(pinHead(a), false);
      if (!p.visible) return;
      if (camOut && HY.state.ov.cut === 'half') {
        var C = camGroundKm(), l = Math.sqrt(C[0] * C[0] + C[1] * C[1] + C[2] * C[2]);
        if ((a.base[0] * C[0] + a.base[1] * C[1] + a.base[2] * C[2]) / l > 0) return;
      }
      var d = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
      if (d < bd) { bd = d; best = a; }
    });
    return best;
  }
  function clickAt(cx, cy, enter) {
    var hit = pinAt(cx, cy);
    if (hit) { if (!hit.cur) HY.store.patch('site', { id: hit.id, s: hit.s, az: hit.az }, 'ov'); }
    else {
      var p = ov.pick(cx, cy);
      if (!p) return;
      HY.store.patch('site', { id: null, s: Math.round(p.s * 100) / 100, az: Math.round(p.az * 1000) / 1000 }, 'ov');
    }
    if (enter) HY.store.set('view.mode', 'fp', 'ov');
  }
  // 射线拾取内壁：跳过被剖掉的一侧与塔 → {s, az} | null
  ov.pick = function (clientX, clientY) {
    if (!camera || !gfx || !gfx.canvas) return null;
    var r = gfx.canvas.getBoundingClientRect(), w = r.width || size.w, h = r.height || size.h;
    var nx = (clientX - r.left) / w * 2 - 1, ny = -((clientY - r.top) / h * 2 - 1);
    camera.updateMatrixWorld();
    var v = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    var c = Math.cos(-dispSpin), s = Math.sin(-dispSpin), P = HY.model.P, o = HY.state.ov;
    var og = camGroundKm(), dg = [v.x * c - v.z * s, v.y, v.x * s + v.z * c];
    var clip = null;
    if (camOut && o.cut !== 'none') { var l = Math.sqrt(og[0] * og[0] + og[1] * og[1] + og[2] * og[2]); clip = [og[0] / l, og[1] / l, og[2] / l]; }
    return ov.geom.pick(og, dg, P.R, clip, P.a);
  };
  function hover(cx, cy, buttons, ptype) {
    if (!active || buttons || ptype === 'touch') { ov.labels.hideTip(); return; }
    var p = ov.pick(cx, cy);
    if (!p) { ov.labels.hideTip(); return; }
    var P = HY.model.P, z = HY.world.zoneOf(p.s, P, HY.model.Z), O = HY.astro.site(p.s, p.az, P);
    var day = HY.astro.sunlitAt(O, HY.state.time.t, P) >= 0.5, az = Math.round(p.az);
    var text = '离塔根 ' + HY.calc.km(p.s) + ' · 方位 ' + (az < 0 ? '−' + (-az) : az) + '° · ' + z.name + ' ' + z.g.toFixed(2) + 'g · ' + (day ? '昼' : '夜');
    var r = gfx.canvas.getBoundingClientRect();
    ov.labels.tip(text, cx - r.left, cy - r.top);
  }

  /* ───────── 取数（HY.app.readPx 在总览时转到这里） ───────── */
  // x、y：相对画布左上角的 CSS 像素 → 显示值 [r, g, b]（0–255）。先就地重画一帧再读，避免读到已呈现、被清掉的缓冲
  ov.readPx = function (x, y) {
    if (!active || st.phase !== 'ready' || !gfx.renderer) return null;
    draw({ t: HY.state.time.t, dtReal: 0, dtSim: 0, w: size.w, h: size.h, now: HY.model.tick() });
    var gl = gfx.gl, dpr = (gfx.size && gfx.size.dpr) || 1, W = gfx.size.w, H = gfx.size.h;
    var px = Math.max(0, Math.min(W - 1, Math.round(x * dpr))), py = Math.max(0, Math.min(H - 1, Math.round(y * dpr)));
    var buf = new Uint8Array(4);
    gfx.renderer.setRenderTarget(null);
    gl.readPixels(px, H - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0], buf[1], buf[2]];
  };
  // 调试与验收：此刻的内部状态
  ov.debug = function () {
    if (!camera) return null;
    return {
      mode: mode, camOut: camOut, dispSpin: dispSpin, spin: spinNow, follow: follow, animating: !!anim, starK: starK,
      cam: getCam(), labels: ov.labels.shown ? ov.labels.shown() : [],
      sun: ov.bodies.meshes().sun ? ov.bodies.meshes().sun.getWorldPosition(new THREE.Vector3()).toArray() : null,
      moon: ov.bodies.meshes().moon ? ov.bodies.meshes().moon.getWorldPosition(new THREE.Vector3()).toArray() : null,
      info: gfx.renderer ? { calls: sceneInfo.calls, triangles: sceneInfo.triangles, points: sceneInfo.points, lines: sceneInfo.lines, geometries: gfx.renderer.info.memory.geometries, textures: gfx.renderer.info.memory.textures } : null
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
