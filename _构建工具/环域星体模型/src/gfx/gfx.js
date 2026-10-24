/* HY.gfx —— 唯一的渲染器与画布、能力检测、全屏 pass、渲染目标、GPU 计时（规格：spec/03 第五节第 1 条）
 * 负责：B 路（总览三维）。第一人称（E 路）也用 fs、rt、timer。
 * 加载时不碰 DOM、不碰 THREE；THREE 只在 init、fs、rt 里用。
 *
 *   HY.gfx.init(canvas) → {ok, webgl2, floatRT, floatLinear, timer, parallel, reason}   // 能力也存在 HY.gfx.caps
 *   HY.gfx.resize(cssW, cssH, dprCap) → {w, h}           // 画布像素＝css × min(devicePixelRatio, dprCap)
 *   HY.gfx.fs(material, target, viewport)                 // 全屏三角形 pass；viewport＝{x, y, w, h}（目标像素，左下原点）
 *   HY.gfx.rt(w, h, opts) → WebGLRenderTarget             // opts 见下
 *   HY.gfx.timer.begin(name) / end(name) / results()      // EXT_disjoint_timer_query_webgl2；没有就全是空操作
 *   HY.gfx.onContext(fn) → off                            // fn(lost)：上下文丢失（true）／恢复（false）
 *   HY.gfx.FS_VERT                                        // 全屏三角形的 GLSL1 顶点着色器（输出 vUv）
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var gfx = HY.gfx = HY.gfx || {};

  gfx.__stubs = [];
  gfx.renderer = null; gfx.canvas = null; gfx.caps = null; gfx.gl = null;
  gfx.size = { w: 1, h: 1, cssW: 1, cssH: 1, dpr: 1 };
  var ctxFns = [];

  // 全屏三角形：(−1,−1) (3,−1) (−1,3)，vUv 在画面内为 0..1
  gfx.FS_VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  // → { ok, webgl2, floatRT, floatLinear, timer, parallel, reason }
  gfx.init = function (canvas) {
    var THREE = G.THREE;
    gfx.canvas = canvas;
    if (!THREE) {
      gfx.caps = { ok: false, webgl2: false, floatRT: false, floatLinear: false, timer: false, parallel: false, reason: '三维视图需要联网加载 three.js（cdnjs）。图表、读数、参数照常可用。' };
      return gfx.caps;
    }
    var r;
    try {
      r = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      gfx.caps = { ok: false, webgl2: false, floatRT: false, floatLinear: false, timer: false, parallel: false, reason: '浏览器没能建立 WebGL：' + (e && e.message || e) };
      return gfx.caps;
    }
    // 03 第五节第 1 条：创建后锁死，任何模块不得改
    r.autoClear = false;
    r.outputEncoding = THREE.LinearEncoding;
    r.toneMapping = THREE.NoToneMapping;
    r.setPixelRatio(1);
    r.localClippingEnabled = false;
    r.shadowMap.enabled = false;
    r.debug.checkShaderErrors = !!HY.DEV;
    gfx.renderer = r;
    var ex = r.extensions, gl = r.getContext(), w2 = !!r.capabilities.isWebGL2;
    gfx.caps = {
      ok: true, webgl2: w2,
      floatRT: w2 ? !!ex.get('EXT_color_buffer_float') : false,
      floatLinear: !!ex.get('OES_texture_float_linear'),
      timer: w2 ? !!ex.get('EXT_disjoint_timer_query_webgl2') : false,
      parallel: !!ex.get('KHR_parallel_shader_compile'),
      reason: ''
    };
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      timerReset();
      ctxFns.forEach(function (f) { try { f(true); } catch (x) { /* 忽略 */ } });
      if (HY.bus) HY.bus.emit('context', { lost: true });
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      timerReset();
      ctxFns.forEach(function (f) { try { f(false); } catch (x) { /* 忽略 */ } });
      if (HY.bus) HY.bus.emit('context', { lost: false });
    }, false);
    gfx.gl = gl;
    fsRig = null;
    timerReset();
    return gfx.caps;
  };

  // 画布像素＝css × min(devicePixelRatio, dprCap)；返回 {w, h}
  gfx.resize = function (cssW, cssH, dprCap) {
    var dpr = Math.min(G.devicePixelRatio || 1, dprCap || 2);
    var w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (gfx.renderer) gfx.renderer.setSize(w, h, false);
    else if (gfx.canvas) { gfx.canvas.width = w; gfx.canvas.height = h; }
    gfx.size = { w: w, h: h, cssW: cssW, cssH: cssH, dpr: dpr };
    return { w: w, h: h };
  };
  gfx.onContext = function (fn) { ctxFns.push(fn); return function () { var i = ctxFns.indexOf(fn); if (i >= 0) ctxFns.splice(i, 1); }; };

  /* ───────── 全屏 pass（02 第十六节第 2 条：单独的 Scene＋OrthographicCamera，一个大三角形） ───────── */
  var fsRig = null;
  function rig() {
    if (fsRig) return fsRig;
    var THREE = G.THREE, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    var mesh = new THREE.Mesh(geo, null);
    mesh.frustumCulled = false;
    var scene = new THREE.Scene();
    scene.add(mesh);
    fsRig = { scene: scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh: mesh, geo: geo };
    return fsRig;
  }
  // material：ShaderMaterial／RawShaderMaterial（顶点着色器自己处理 position）；target：渲染目标或 null（画布）
  // viewport：{x, y, w, h}（目标像素，左下原点），省略＝整个目标。调用方负责 clear（renderer.autoClear 锁死为假）。
  gfx.fs = function (material, target, viewport) {
    var r = gfx.renderer; if (!r || !material) return;
    var R = rig();
    R.mesh.material = material;
    var old = null;
    if (viewport) {
      old = R.old || (R.old = new G.THREE.Vector4());           // 复用：每帧可能调几十次，不在热路径里分配
      if (target) { old.copy(target.viewport); target.viewport.set(viewport.x, viewport.y, viewport.w, viewport.h); }
      else r.getViewport(old);
    }
    r.setRenderTarget(target || null);
    if (viewport && !target) r.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
    r.render(R.scene, R.cam);
    if (viewport) {
      if (target) { target.viewport.copy(old); r.setRenderTarget(target); }
      else r.setViewport(old.x, old.y, old.z, old.w);
    }
  };

  /* ───────── 渲染目标 ─────────
   * opts：{ type: 'half'|'float'|'byte'（默认 'byte'）, filter: 'linear'|'nearest'（默认 linear）,
   *         wrap: 'clamp'|'repeat'|'mirror'（默认 clamp）, depth: bool（默认假）, msaa: 真|样本数（WebGL2 才有）,
   *         format: 'rgba'|'rg'|'r'（默认 rgba）, mips: bool }
   * 半浮点、浮点目标在没有 EXT_color_buffer_float 时退回 8 位，并在 rt.userData.fallback 记下原因。
   * 'rg'、'r' 只在 WebGL2 有（WebGL1 退回 'rgba'）；three r128 不会自己给 RG 配有尺寸的内部格式
   *   （texImage2D 报 INVALID_VALUE、帧缓冲不完整），所以这里显式写 texture.internalFormat。
   */
  var RG_IF = { half: 'RG16F', float: 'RG32F', byte: 'RG8' };
  gfx.rt = function (w, h, opts) {
    var THREE = G.THREE; if (!THREE || !gfx.renderer) return null;
    opts = opts || {};
    var caps = gfx.caps || {}, type = opts.type || 'byte', fallback = '', format = opts.format || 'rgba';
    if ((type === 'half' || type === 'float') && !caps.floatRT) { fallback = '没有浮点渲染能力，退回 8 位'; type = 'byte'; }
    if (format !== 'rgba' && !caps.webgl2) { fallback = (fallback ? fallback + '；' : '') + 'WebGL1 没有单、双通道目标，退回 RGBA'; format = 'rgba'; }
    var lin = (opts.filter || 'linear') === 'linear';
    if (type === 'float' && lin && !caps.floatLinear) lin = false;
    var filt = lin ? THREE.LinearFilter : THREE.NearestFilter;
    var wrap = opts.wrap === 'repeat' ? THREE.RepeatWrapping : opts.wrap === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
    var fmt = format === 'rg' ? THREE.RGFormat : format === 'r' ? THREE.RedFormat : THREE.RGBAFormat;
    var o = {
      type: type === 'half' ? THREE.HalfFloatType : type === 'float' ? THREE.FloatType : THREE.UnsignedByteType,
      format: fmt, minFilter: opts.mips ? (lin ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter) : filt, magFilter: filt,
      wrapS: wrap, wrapT: wrap, depthBuffer: !!opts.depth, stencilBuffer: false, generateMipmaps: !!opts.mips
    };
    var t;
    if (opts.msaa && caps.webgl2 && THREE.WebGLMultisampleRenderTarget) {
      t = new THREE.WebGLMultisampleRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), o);
      t.samples = opts.msaa === true ? 4 : (opts.msaa | 0) || 4;
    } else {
      t = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), o);
      if (opts.msaa && !caps.webgl2) fallback = (fallback ? fallback + '；' : '') + 'WebGL1 没有多重采样目标';
    }
    t.texture.generateMipmaps = !!opts.mips;
    if (format === 'rg') t.texture.internalFormat = RG_IF[type];
    t.userData = { type: type, format: format, fallback: fallback };
    return t;
  };

  /* ───────── GPU 计时（EXT_disjoint_timer_query_webgl2） ─────────
   * begin/end 成对调用，同一时刻只能有一段在计（WebGL 的限制）：begin 时若上一段没 end，先替它 end。
   * 结果异步可得：results() 取回已完成的查询，按名字做指数平滑（ms）；GPU 计时失真（disjoint）的一批整批丢弃。
   */
  var tq = null;
  function timerReset() { tq = { ext: null, pool: [], pending: [], active: null, ms: {} }; }
  timerReset();
  function ext() {
    if (!gfx.caps || !gfx.caps.timer || !gfx.gl) return null;
    if (!tq.ext) tq.ext = gfx.renderer.extensions.get('EXT_disjoint_timer_query_webgl2');
    return tq.ext;
  }
  // 取回已完成的查询（不阻塞：只读 QUERY_RESULT_AVAILABLE 为真的）
  function collect(e) {
    var gl = gfx.gl, disjoint = gl.getParameter(e.GPU_DISJOINT_EXT), keep = [];
    for (var i = 0; i < tq.pending.length; i++) {
      var it = tq.pending[i];
      if (!gl.getQueryParameter(it.q, gl.QUERY_RESULT_AVAILABLE)) { keep.push(it); continue; }
      if (!disjoint) {
        var ms = gl.getQueryParameter(it.q, gl.QUERY_RESULT) / 1e6, old = tq.ms[it.name];
        tq.ms[it.name] = old == null ? ms : old * 0.8 + ms * 0.2;
      }
      tq.pool.push(it.q);
    }
    tq.pending = keep;
  }
  gfx.timer = {
    begin: function (name) {
      var e = ext(); if (!e) return;
      var gl = gfx.gl;
      if (tq.active) gfx.timer.end(tq.active.name);
      // 没人来取结果时自己收：积压到 8 个就收一次，保证 results() 读到的是最近的数，查询对象也能复用
      if (tq.pending.length >= 8) collect(e);
      if (tq.pending.length > 64) return;                    // 结果迟迟不回来：先不再发新的
      var q = tq.pool.pop() || gl.createQuery();
      gl.beginQuery(e.TIME_ELAPSED_EXT, q);
      tq.active = { name: name, q: q };
    },
    end: function (name) {
      var e = ext(); if (!e || !tq.active) return;
      if (name != null && tq.active.name !== name) return;
      gfx.gl.endQuery(e.TIME_ELAPSED_EXT);
      tq.pending.push(tq.active);
      tq.active = null;
    },
    results: function () {
      var e = ext(); if (!e) return {};
      collect(e);
      var out = {};
      for (var k in tq.ms) out[k] = tq.ms[k];
      return out;
    },
    supported: function () { return !!ext(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
