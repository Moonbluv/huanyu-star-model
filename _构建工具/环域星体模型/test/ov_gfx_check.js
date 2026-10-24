#!/usr/bin/env node
/* ov_gfx_check —— HY.gfx 与 HY.ov.labels 的 node 自检（负责：B 路）
 * 这两个文件不是“节点可测”模块（要 THREE、DOM），这里用最小的假 THREE、假 WebGL、假 DOM 把逻辑跑一遍：
 *   gfx.init  没有 THREE 时的中文降级说明；有时锁死 03 第五节第 1 条的全局状态、能力检测
 *   gfx.rt    浮点退回 8 位、WebGL1 退回 RGBA、RG 目标写明有尺寸的内部格式（three r128 不会自己配）、MSAA 样本数、浮点线性过滤退回
 *   gfx.timer 成对计时、按名字平滑、disjoint 整批丢弃、没人取结果时积压到 8 个自己收、不支持时全是空操作
 *   gfx.resize 像素比上限
 *   gfx.fs    全屏三角形、目标／画布的子视口、画完视口复原
 *   labels    按优先级避让、被挡就不画、文字变了才重量尺寸、隐藏层量不出宽度时不把估计值记死、放在锚点上方
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const load = require('./_load.js');
const HY = load();
const T = load.tester('ov_gfx_check');
const { ok, eq, near, section } = T;

function run(rel) { const f = path.join(load.SRC, rel); vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); }

/* ───────── 假 THREE ───────── */
function V4() { this.x = this.y = this.z = this.w = 0; }
V4.prototype.set = function (x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; };
V4.prototype.copy = function (v) { return this.set(v.x, v.y, v.z, v.w); };
V4.prototype.clone = function () { return new V4().copy(this); };
function RT(w, h, o) { this.width = w; this.height = h; this.texture = Object.assign({}, o); this.viewport = new V4().set(0, 0, w, h); this.userData = {}; }
function MSRT(w, h, o) { RT.call(this, w, h, o); this.samples = 4; this.isMS = true; }
const exts = {};
function FakeRenderer(o) {
  this.opts = o; this.autoClear = true; this.outputEncoding = 3001; this.toneMapping = 1; this.pr = 2;
  this.localClippingEnabled = true; this.shadowMap = { enabled: true }; this.debug = { checkShaderErrors: true };
  this.capabilities = { isWebGL2: FakeRenderer.webgl2 };
  this.extensions = { get: function (n) { return exts[n] || null; } };
  this.size = null; this.calls = [];
}
FakeRenderer.webgl2 = true;
FakeRenderer.prototype.setPixelRatio = function (p) { this.pr = p; };
FakeRenderer.prototype.getContext = function () { return gl; };
FakeRenderer.prototype.setSize = function (w, h, s) { this.size = [w, h, s]; };
const THREE = {
  WebGLRenderer: FakeRenderer, WebGLRenderTarget: RT, WebGLMultisampleRenderTarget: MSRT, Vector4: V4,
  LinearEncoding: 3000, NoToneMapping: 0,
  HalfFloatType: 1016, FloatType: 1015, UnsignedByteType: 1009, RGBAFormat: 1023, RGFormat: 1030, RedFormat: 1028,
  LinearFilter: 1006, NearestFilter: 1003, LinearMipmapLinearFilter: 1008, NearestMipmapNearestFilter: 1004,
  ClampToEdgeWrapping: 1001, RepeatWrapping: 1000, MirroredRepeatWrapping: 1002
};

/* ───────── 假 WebGL：只有计时查询要用 ───────── */
let qid = 0, nowAvail = true, disjoint = false;
const gl = {
  TIME_ELAPSED_EXT: 0x88BF, QUERY_RESULT_AVAILABLE: 0x8867, QUERY_RESULT: 0x8866,
  active: null, began: 0,
  createQuery: function () { return { id: ++qid, ns: 0, avail: false }; },
  beginQuery: function (k, q) { if (this.active) throw new Error('同时只能有一段在计'); this.active = q; this.began++; },
  endQuery: function () { const q = this.active; this.active = null; q.ns = 2e6; q.avail = nowAvail; },
  getParameter: function (p) { return p === exts.EXT_disjoint_timer_query_webgl2.GPU_DISJOINT_EXT ? disjoint : null; },
  getQueryParameter: function (q, p) { return p === this.QUERY_RESULT_AVAILABLE ? q.avail : q.ns; }
};
exts.EXT_disjoint_timer_query_webgl2 = { TIME_ELAPSED_EXT: 0x88BF, GPU_DISJOINT_EXT: 0x8FBB };
exts.EXT_color_buffer_float = {}; exts.OES_texture_float_linear = {}; exts.KHR_parallel_shader_compile = {};

function fakeCanvas() { const ev = {}; return { ev: ev, width: 0, height: 0, addEventListener: function (n, f) { ev[n] = f; } }; }

section('1 gfx.init');
{
  delete globalThis.THREE;
  run('gfx/gfx.js');
  const g = HY.gfx, cv = fakeCanvas();
  eq(g.__stubs.length, 0, 'HY.gfx.__stubs 为空');
  const c0 = g.init(cv);
  ok(!c0.ok && /three\.js/.test(c0.reason) && /图表、读数、参数照常可用/.test(c0.reason), '没有 THREE：ok 为假，给出中文说明（03 第二节第 4 条）');
  eq(g.rt(4, 4, {}), null, '没有渲染器时 rt 返回 null');
  g.timer.begin('x'); g.timer.end('x');
  eq(JSON.stringify(g.timer.results()), '{}', '没有计时能力时 timer 全是空操作');

  globalThis.THREE = THREE;
  HY.DEV = false;
  const c1 = g.init(cv), r = g.renderer;
  ok(c1.ok && c1.webgl2 && c1.floatRT && c1.floatLinear && c1.timer && c1.parallel && c1.reason === '', '能力检测：WebGL2、浮点目标、浮点线性、计时、并行编译');
  ok(r.opts.antialias === false && r.autoClear === false && r.outputEncoding === THREE.LinearEncoding && r.toneMapping === THREE.NoToneMapping, '锁死：antialias 假、autoClear 假、LinearEncoding、NoToneMapping');
  ok(r.pr === 1 && r.localClippingEnabled === false && r.shadowMap.enabled === false && r.debug.checkShaderErrors === false, '锁死：像素比 1、不用裁剪面与阴影；发布构建不查着色器报错');
  ok(typeof cv.ev.webglcontextlost === 'function' && typeof cv.ev.webglcontextrestored === 'function', '挂上了上下文丢失／恢复');
  let seen = [], prevent = 0;
  const off = g.onContext(function (lost) { seen.push(lost); });
  cv.ev.webglcontextlost({ preventDefault: function () { prevent++; } }); cv.ev.webglcontextrestored({});
  off(); cv.ev.webglcontextlost({ preventDefault: function () {} });
  ok(prevent === 1 && seen.join() === 'true,false', '丢失时 preventDefault、回调收到 true／false；取消订阅后不再收到');
  HY.DEV = true; g.init(fakeCanvas());
  eq(g.renderer.debug.checkShaderErrors, true, '开发构建保留着色器报错检查');
  HY.DEV = false; g.init(cv);
}

section('2 gfx.rt');
{
  const g = HY.gfx;
  const a = g.rt(10.7, 0, { type: 'half', depth: true });
  ok(a.width === 10 && a.height === 1 && a.texture.type === THREE.HalfFloatType && a.texture.depthBuffer === true && a.userData.fallback === '', '半浮点目标；尺寸取整、至少 1');
  const rg = g.rt(8, 8, { format: 'rg', type: 'half' });
  ok(rg.texture.format === THREE.RGFormat && rg.texture.internalFormat === 'RG16F', 'RG 半浮点：内部格式写明 RG16F');
  eq(g.rt(8, 8, { format: 'rg', type: 'float' }).texture.internalFormat, 'RG32F', 'RG 浮点：RG32F');
  eq(g.rt(8, 8, { format: 'rg' }).texture.internalFormat, 'RG8', 'RG 8 位：RG8');
  const r1 = g.rt(8, 8, { format: 'r', type: 'half' });
  ok(r1.texture.format === THREE.RedFormat && r1.texture.internalFormat == null, '单通道交给 three（r128 会配 R16F／R32F／R8）');
  const ms = g.rt(8, 8, { msaa: true }), ms8 = g.rt(8, 8, { msaa: 8 });
  ok(ms.isMS && ms.samples === 4 && ms8.samples === 8, 'MSAA：真＝4 个样本，数字＝样本数');
  const mp = g.rt(8, 8, { mips: true, wrap: 'repeat', filter: 'nearest' });
  ok(mp.texture.generateMipmaps && mp.texture.minFilter === THREE.NearestMipmapNearestFilter && mp.texture.magFilter === THREE.NearestFilter && mp.texture.wrapS === THREE.RepeatWrapping, 'mips、重复寻址、最近点过滤（缩小也取最近点）');
  eq(g.rt(8, 8, { mips: true }).texture.minFilter, THREE.LinearMipmapLinearFilter, 'mips＋线性：三线性');

  g.caps.floatLinear = false;
  eq(g.rt(8, 8, { type: 'float' }).texture.magFilter, THREE.NearestFilter, '浮点目标没有线性过滤能力时退回最近点');
  eq(g.rt(8, 8, { type: 'half' }).texture.magFilter, THREE.LinearFilter, '半浮点照常线性');
  eq(g.rt(8, 8, { type: 'float', mips: true }).texture.minFilter, THREE.NearestMipmapNearestFilter, '浮点目标带 mips、没有线性过滤：缩小也用最近点（不然纹理不完整）');
  g.caps.floatLinear = true;

  g.caps.floatRT = false;
  const fb = g.rt(8, 8, { type: 'half', format: 'rg' });
  ok(fb.texture.type === THREE.UnsignedByteType && fb.texture.internalFormat === 'RG8' && /退回 8 位/.test(fb.userData.fallback), '没有浮点渲染能力：退回 8 位并记下原因');
  g.caps.floatRT = true;

  FakeRenderer.webgl2 = false;
  g.init(fakeCanvas());
  ok(!g.caps.webgl2 && !g.caps.floatRT && !g.caps.timer, 'WebGL1：没有浮点目标、没有计时');
  const w1 = g.rt(8, 8, { format: 'rg', msaa: true });
  ok(w1.texture.format === THREE.RGBAFormat && w1.texture.internalFormat == null && !w1.isMS, 'WebGL1：RG 退回 RGBA、没有多重采样');
  ok(/RGBA/.test(w1.userData.fallback) && /多重采样/.test(w1.userData.fallback), 'WebGL1：两处退回都记下原因');
  FakeRenderer.webgl2 = true;
  g.init(fakeCanvas());
}

section('3 gfx.timer');
{
  const g = HY.gfx;
  ok(g.timer.supported(), '支持计时');
  g.timer.begin('ov'); g.timer.end('ov');
  near(g.timer.results().ov, 2, 1e-9, '一段 2 ms');
  g.timer.begin('a'); g.timer.begin('b');                   // 上一段没 end：begin 替它 end，不会两段同时计
  ok(gl.active && gl.active !== null, 'begin 时上一段没结束：先替它结束（假 GL 不许两段同时计）');
  g.timer.end('a');                                          // 名字不符：不结束
  ok(gl.active !== null, 'end 的名字与正在计的不符：不结束');
  g.timer.end('b');
  const res = g.timer.results();
  ok(res.a != null && res.b != null, '两段都有结果');
  // 平滑：新值按 0.2 并入（2 ms 之后来一段 7 ms → 2×0.8＋7×0.2＝3）
  const ce = gl.endQuery;
  gl.endQuery = function () { const q = this.active; ce.call(this); q.ns = 7e6; };
  g.timer.begin('ov'); g.timer.end('ov');
  near(g.timer.results().ov, 3, 1e-9, '指数平滑：2 ms 之后一段 7 ms → 3 ms');
  disjoint = true; g.timer.begin('ov'); g.timer.end('ov');
  near(g.timer.results().ov, 3, 1e-9, 'disjoint 的一批丢弃，不并入');
  disjoint = false;
  gl.endQuery = ce;
  // 没人取结果：积压到 8 个就自己收，查询对象复用、不会一直新建
  nowAvail = true;
  const q0 = qid;
  for (let i = 0; i < 200; i++) { g.timer.begin('ov'); g.timer.end('ov'); }
  ok(qid - q0 <= 10, `连计 200 段只新建了 ${qid - q0} 个查询对象（自己收、复用）`);
  // 结果迟迟不回来：积压超过 64 个就先不再发新的
  nowAvail = false;
  const b0 = gl.began;
  for (let i = 0; i < 200; i++) { g.timer.begin('ov'); g.timer.end('ov'); }
  ok(gl.began - b0 <= 70, `结果不回来时最多再发 ${gl.began - b0} 段（≤70），不无限积压`);
  nowAvail = true;
}

section('4 gfx.resize');
{
  const g = HY.gfx;
  globalThis.devicePixelRatio = 3;
  let s = g.resize(400.4, 300, 2);
  ok(s.w === 801 && s.h === 600 && g.size.dpr === 2 && g.renderer.size[0] === 801 && g.renderer.size[2] === false, '像素比按上限 2 截；不改 CSS 尺寸（setSize 第三参为假）');
  globalThis.devicePixelRatio = 1;
  s = g.resize(0, 0, 2);
  ok(s.w === 1 && s.h === 1, '零尺寸夹到 1×1');
}

section('4b gfx.fs：全屏三角形、视口与恢复');
{
  const g = HY.gfx, r = g.renderer, log = [];
  // 给假 THREE 补上 fs 用到的几样
  THREE.BufferGeometry = function () { this.attr = {}; }; THREE.BufferGeometry.prototype.setAttribute = function (n, a) { this.attr[n] = a; return this; };
  THREE.BufferAttribute = function (arr, k) { this.array = arr; this.itemSize = k; };
  THREE.Mesh = function (geo, mat) { this.geometry = geo; this.material = mat; };
  THREE.Scene = function () { this.children = []; }; THREE.Scene.prototype.add = function (o) { this.children.push(o); };
  THREE.OrthographicCamera = function () {};
  V4.prototype.copy = function (v) { return this.set(v.x, v.y, v.z, v.w); };
  const vp = new V4().set(0, 0, 640, 360);
  r.setRenderTarget = function (t) { this.rt = t; log.push(['rt', t ? 'T' : 'canvas', t ? t.viewport.z : vp.z]); };
  r.getViewport = function (v) { return v.copy(vp); };
  r.setViewport = function (x, y, w, h) { vp.set(x, y, w, h); };
  r.render = function (sc) { this.lastScene = sc; log.push(['draw', sc.children[0].material, this.rt ? this.rt.viewport.z : vp.z]); };
  g.fs(null, null);
  eq(log.length, 0, '没有材质：什么也不画');
  const mA = { name: 'A' }, T = g.rt(64, 32, {});
  g.fs(mA, T);
  ok(log[1][0] === 'draw' && log[1][1] === mA && log[1][2] === 64, '画进目标：整个目标');
  log.length = 0;
  g.fs(mA, T, { x: 8, y: 4, w: 16, h: 8 });
  ok(log[1][2] === 16 && T.viewport.z === 64 && T.viewport.x === 0 && r.rt === T, '目标＋视口：只画子区域，画完目标的视口复原');
  log.length = 0;
  g.fs(mA, null, { x: 0, y: 0, w: 100, h: 50 });
  ok(log[1][2] === 100 && vp.z === 640 && vp.w === 360, '画布＋视口：只画子区域，画完画布视口复原');
  // 全屏三角形覆盖 [−1,1]²：三个顶点 (−1,−1) (3,−1) (−1,3)；同一套场景反复用，不每次新建
  const sc0 = r.lastScene;
  g.fs({ name: 'B' }, null);
  const pa = r.lastScene.children[0].geometry.attr.position;
  eq(Array.from(pa.array).join(','), '-1,-1,0,3,-1,0,-1,3,0', '全屏三角形的三个顶点');
  ok(r.lastScene === sc0 && r.lastScene.children[0].frustumCulled === false, '全屏 pass 共用一套场景，网格不做视锥剔除');
}

section('5 HY.ov.labels：避让、遮挡、尺寸');
{
  // 假 DOM：offsetWidth 按字数算；层隐藏时为 0
  let layerHidden = false;
  function El(tag) { this.tag = tag; this.style = {}; this.children = []; this._text = ''; this.measured = 0; }
  Object.defineProperty(El.prototype, 'textContent', { get: function () { return this._text; }, set: function (v) { this._text = String(v); if (v === '') this.children = []; } });
  Object.defineProperty(El.prototype, 'offsetWidth', { get: function () { this.measured++; return layerHidden || /display:none/.test(this.style.cssText || '') ? 0 : 12 * this._text.length + 6; } });
  Object.defineProperty(El.prototype, 'offsetHeight', { get: function () { return layerHidden ? 0 : 16; } });
  Object.defineProperty(El.prototype, 'clientWidth', { get: function () { return 800; } });
  Object.defineProperty(El.prototype, 'clientHeight', { get: function () { return 400; } });
  El.prototype.appendChild = function (c) { this.children.push(c); return c; };
  globalThis.document = { createElement: function (t) { return new El(t); } };
  run('overview/labels.js');
  const L = HY.ov.labels, root = new El('div');
  L.init(root);
  const pos = { a: [100, 100], b: [104, 102], c: [300, 100], d: [500, 100] };
  const blocked = {};
  const view = function (anchors) {
    return { show: true, anchors: anchors, project: function (a) { return blocked[a.id] ? null : { x: pos[a.id][0], y: pos[a.id][1], ok: true }; } };
  };
  const A = [
    { id: 'b', text: '其它地点', kind: 'site', prio: 3 },
    { id: 'a', text: '此地', kind: 'site', cur: true, prio: 0 },
    { id: 'c', text: '日', kind: 'body', prio: 1 },
    { id: 'd', text: '塔根·北极', kind: 'pole', prio: 2 }
  ];
  L.frame(view(A));
  eq(L.shown().sort().join(','), 'a,c,d', '与已画的重叠就隐藏：当前地点优先，压住的“其它地点”不画');
  blocked.a = true;
  L.frame(view(A));
  eq(L.shown().sort().join(','), 'b,c,d', '当前地点被挡（project 返回 null）就不画，让出位置给其它地点');
  blocked.a = false; blocked.c = true;
  L.frame(view(A));
  eq(L.shown().sort().join(','), 'a,d', '被挡的日不画');
  blocked.c = false;
  L.frame({ show: false, anchors: A, project: view(A).project });
  eq(L.shown().length, 0, '关掉标签：全部隐藏');
  // 尺寸：隐藏层里量不出宽度，估计值不记死；回到可见后量到真值，之后不再每帧量（不反复强制排版）
  const lay = new El('div');
  L.init(lay);
  layerHidden = true;
  const one = [{ id: 'm', text: '月（亮月）', kind: 'body', prio: 1 }];
  pos.m = [50, 50];
  L.frame(view(one)); L.frame(view(one));
  const em = lay.children.find(function (e) { return e._text === '月（亮月）'; });
  ok(em && em.measured >= 2, '层隐藏时量不出宽度：每帧再试（' + (em && em.measured) + ' 次）');
  layerHidden = false;
  L.frame(view(one));
  const m1 = em.measured;
  L.frame(view(one)); L.frame(view(one)); L.frame(view(one));
  eq(em.measured, m1, '回到可见量到一次之后就记下，不再每帧量');
  ok(/translate\(58px,42px\)/.test(em.style.transform), '标签放在锚点右侧 8 px、竖直居中：' + em.style.transform);
  // 文字变了才重写节点
  one[0].text = '月（灰月）';
  L.frame(view(one));
  eq(em._text, '月（灰月）', '文字变了：重写');
  L.tip('离塔根 6,670 公里 · 方位 −4° · 重域 1.21g · 夜', 790, 395);
  const tip = lay.children.find(function (e) { return /z-index:2/.test(e.style.cssText || ''); });
  const mt = tip && /translate\((-?\d+)px,(-?\d+)px\)/.exec(tip.style.transform);
  ok(mt && +mt[1] < 790 && +mt[2] < 395, '提示框贴右下角时翻到指针左上，不出界：' + (tip && tip.style.transform));
  L.hideTip();
  eq(tip.style.display, 'none', 'hideTip');
  // place：摆法候选表，依次试。['above','below']：先放锚点正上方 8 px、水平居中；上方被占就放正下方
  //   （入冬镜头里“三点一线”与“月”挤在塔腰同一条横线上，月还会从锚点前面经过）
  {
    const lay2 = new El('div');
    L.init(lay2);
    pos.f = [200, 100]; pos.g = [250, 100];
    const two = [{ id: 'g', text: '月（黑月）', kind: 'body', prio: 1 }, { id: 'f', text: '三点一线·圣皇庆典', kind: 'free', prio: 2.5, place: ['above', 'below'] }];
    L.frame(view(two)); L.frame(view(two));
    const ef = lay2.children.find(function (e) { return e._text === '三点一线·圣皇庆典'; });
    const w = 12 * 9 + 6, x0 = Math.round(200 - w / 2);
    eq(ef && ef.style.transform, 'translate(' + x0 + 'px,' + (100 - 16 - 8) + 'px)', '放在锚点正上方、水平居中');
    eq(L.shown().sort().join(','), 'f,g', '锚点右侧 50 px 就是“月”的标签：放在上方时两者都画');
    // 月的标签挪到锚点正上方偏上一点（月从锚点前面经过）：上方被占，改放下方
    pos.g = [150, 84];
    L.frame(view(two));
    eq(ef.style.transform, 'translate(' + x0 + 'px,' + (100 + 8) + 'px)', '上方被“月”占了：放到正下方');
    eq(L.shown().sort().join(','), 'f,g', '两者仍都画');
    pos.g = [250, 100];
    two[1].place = undefined;
    L.frame(view(two));
    eq(L.shown().join(','), 'g', '同样的位置放在右侧（默认摆法）：被“月”压掉（这就是改放上方的原因）');
  }
  L.hideTip(); L.clear(); L.dispose();
}

T.done();
