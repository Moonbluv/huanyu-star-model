/* HY.fp.inst —— 实例层：碎石、草丛、枯木灌丛、阶沿干砌石墙（规格：spec/02 第九节、第十五节第 1 条、第十六节第 4 条）
 * 负责：F 路（第一人称·地面）。加载时不碰 THREE；THREE 只在 build() 里用。
 *
 * 做法：每种实例一张以相机为中心、对齐图表整数格的格网；InstancedBufferGeometry 只带“局部格号”一个实例属性 aCell。
 *   顶点着色器（glsl/inst.vert）用 uInstGrid（CPU 双精度给出的相机所在格的全局格号）加局部格号得到全局格号，
 *   PCG3D 哈希出偏移、朝向、缩放、是否存在（按域、坡度、阶地相位筛），groundPoint 贴地。相机跨格时整体平移，实例不游动。
 *   投影直接用相机基与 uJitter（与地形的 viewRay 逐像素一致），深度对着 terrain pass 写的 gl_FragDepth（LessEqual）。
 * 数量按档位（passes.TIER_OPTS[tier].inst 给各类半径，米）：低档只有碎石 60 m；中档碎石 150、草 60、枯木 300、墙 300；高档加倍。
 *
 * 接口（E 路的帧图在 terrain 之后调）：
 *   build(gfx, U, tier) → {meshes, stats}     建网格与材质（U＝共享 uniform 对象；本文件登记的 uInst* 已在里面）
 *   draw(target, ctx)                          写 'inst' 的 uniform，画进 target（tSurf，带深度）；ctx.cam 省略取 HY.fp.cam.current
 *   values(cam, P, tSec) → 'inst' 写入方的 uniform 普通数值对象（不碰 THREE）
 *   setTier(tier)  compile()  stats() → {instances, tris}  dispose()
 * 本文件登记的 uniform（写入方 'inst'）：uInstGrid vec4[4]、uInstPar vec4[4]、uInstTime float（只在 inst.vert 里声明）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  var I = fp.inst = fp.inst || {};
  delete I.__stub;

  if (fp.registerUniforms) fp.registerUniforms([
    ['uInstGrid', 'vec4[4]', null, 'inst'],      // 每类：xy 相机所在格的全局格号（mod 65536），zw 该格原点相对相机的图表偏移 km
    ['uInstPar', 'vec4[4]', null, 'inst'],       // 每类：x 格宽 km，y 半径 km，z 每格个数，w 启用
    ['uInstTime', 'float', 0, 'inst']            // 真实秒（草的摆动）
  ]);
  // F 路的画质宏 TER_AO_SCAN：高档的 8 方向扫描遮蔽（horizon.frag 在第 0 级烘进 B 通道，shade_terrain 的 aoScan 查），跟着 TIER_OPTS.aoScan。
  // 登记放在本文件，是因为它在 passes.js 之后载入（ground.js 在 passes.js 之前）；没登记时着色器按关（terrain_lib 的 #ifndef）
  (function () {
    var ps = fp.passes;
    if (!ps || !ps.addTierDefine || !ps.TIER_OPTS || !ps.TIER_NAMES) return;
    var v = {};
    ps.TIER_NAMES.forEach(function (t) { v[t] = ps.TIER_OPTS[t] && ps.TIER_OPTS[t].aoScan ? 1 : 0; });
    try { ps.addTierDefine('TER_AO_SCAN', v); } catch (e) { /* 档位表变了就不开 */ }
  })();

  /* ───────── 地面细节贴图（shade_terrain.glsl 的 uGrDet、uGrVor；glsl/ground_bake.frag 烘焙，每个渲染器一次） ─────────
   * 碎石与多边形板原先逐像素程序生成（3×3 邻格 × 几个尺度），在 terrain.frag 里与求交循环一起编译时 fxc 耗时成倍上涨（10–20 s）。
   * 改成启动时烘两张 1024² 的平铺贴图，着色时只取几次纹理。sampler 按契约登记为 'pass' 写入方，值由这里直接放进共享的 U。 */
  if (fp.registerUniforms) fp.registerUniforms([
    ['uGrDet', 'sampler2D', null, 'pass'],       // 碎石：r 石高，g 出现序，b 石色随机，a 到石头的距离（接触暗边）
    ['uGrVor', 'sampler2D', null, 'pass']        // 多边形板：r 到边的距离，gba 随机数
  ]);
  // 地形求交与着色拆成两个 pass（编译时间，见 glsl/terrain_march.frag 文件头）：求交 pass terrain_g 写 G 缓冲 tTerG，terrain 读 uTerG 着色。
  // 本文件在 passes.js 之后载入，所以在这里登记；fp/passes.js 的 run() 在 terrain_coarse 与 terrain 之间执行它（F 路请统筹加的一行）
  if (fp.passes && fp.passes.addDefs && !fp.passes.DEFS.terrain_g) {
    fp.passes.addDefs({ terrain_g: { chunks: ['common', 'terrain_lib'], main: 'terrain_march', out: 'tTerG', scale: 1, fmt: 'f32', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 15.5 } });
    if (fp.registerUniforms) fp.registerUniforms([['uTerG', 'sampler2D', null, 'pass']]);
  }
  var bake = { renderer: null, det: null, vor: null };
  I.bakeGround = function (renderer, U) {
    var THREE = G.THREE;
    if (!THREE || !renderer || !HY.glsl || !HY.glsl.ground_bake) return null;
    if (bake.renderer !== renderer || !bake.det) {
      if (bake.det) { bake.det.dispose(); bake.vor.dispose(); }
      var opt = { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
      var det = new THREE.WebGLRenderTarget(1024, 1024, opt), vor = new THREE.WebGLRenderTarget(1024, 1024, opt);
      var mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { uBakeMode: { value: 0 } }, depthTest: false, depthWrite: false,
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: HY.glsl.ground_bake });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      var mesh = new THREE.Mesh(geo, mat), scene = new THREE.Scene(), cam = new THREE.Camera();
      mesh.frustumCulled = false; scene.add(mesh);
      var prev = renderer.getRenderTarget();
      renderer.setRenderTarget(det); renderer.render(scene, cam);
      mat.uniforms.uBakeMode.value = 1;
      renderer.setRenderTarget(vor); renderer.render(scene, cam);
      renderer.setRenderTarget(prev);
      mat.dispose(); geo.dispose();
      bake.renderer = renderer; bake.det = det; bake.vor = vor;
    }
    if (U && U.uGrDet) U.uGrDet.value = bake.det.texture;
    if (U && U.uGrVor) U.uGrVor.value = bake.vor.texture;
    return bake;
  };

  /* ───────── 实例类别（02 第九节表） ───────── */
  // cell 格宽 km；per 每格个数；lod：[{geo, split}]（split＝近远分界 km；只有一档时省略）；tierKey＝TIER_OPTS.inst 的键
  I.TYPES = [
    { id: 'rock', name: '碎石、卵石', cell: 0.006, per: 2, tierKey: 'rock', lod: [{ geo: 'rockNear', lod: 0 }, { geo: 'rockFar', lod: 1 }], split: 0.04 },
    { id: 'grass', name: '草丛', cell: 0.003, per: 4, tierKey: 'grass', lod: [{ geo: 'grass', lod: 2 }] },
    { id: 'wood', name: '枯木、灌丛', cell: 0.04, per: 1, tierKey: 'wood', lod: [{ geo: 'treeNear', lod: 0 }, { geo: 'treeFar', lod: 1 }], split: 0.12 },
    { id: 'wall', name: '阶沿干砌石墙', cell: 0.02, per: 1, tierKey: 'wall', lod: [{ geo: 'wall', lod: 2 }] }
  ];
  I.SETTLEMENTS = ['zuiyu', 'shengjin', 'yimeite', 'niehe'];   // 有人住的预设地点：30 km 内才有阶沿墙
  I.WALL_KM = 30;
  var DEF_RADIUS = { low: { rock: 60 }, mid: { rock: 150, grass: 60, wood: 300, wall: 300 }, high: { rock: 300, grass: 150, wood: 600, wall: 800 } };
  function radii(tier) {
    var t = fp.passes && fp.passes.TIER_OPTS && fp.passes.TIER_OPTS[tier];
    return (t && t.inst) || DEF_RADIUS[tier] || DEF_RADIUS.mid;
  }
  I.radii = radii;

  /* ───────── 'inst' 写入方的 uniform（不碰 THREE，可在 node 里调） ───────── */
  function mod(a, n) { return ((a % n) + n) % n; }
  function nearSettlement(cam, P) {
    if (!HY.world || !HY.world.siteList || !cam || typeof cam.toSite !== 'function') return false;
    var q = cam.toSite(), R = P.R, ps = q.s / R, pp = q.az * Math.PI / 180;
    var a = [Math.sin(ps) * Math.cos(pp), -Math.cos(ps), Math.sin(ps) * Math.sin(pp)];
    return HY.world.siteList(P).some(function (st) {
      if (I.SETTLEMENTS.indexOf(st.id) < 0) return false;
      var s2 = st.s / R, p2 = st.az * Math.PI / 180;
      var b = [Math.sin(s2) * Math.cos(p2), -Math.cos(s2), Math.sin(s2) * Math.sin(p2)];
      var c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      return R * Math.acos(c) < I.WALL_KM;
    });
  }
  I.nearSettlement = nearSettlement;
  var VALS = { uInstGrid: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], uInstPar: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], uInstTime: 0 };
  var CC = [0, 0];
  I.values = function (cam, P, tSec, tier) {
    P = P || (HY.model && HY.model.P) || { R: 6371 };
    var c = fp.ground.camChart(cam, P.R, CC), rad = radii(tier || I.tier || 'mid');
    var mode = cam && typeof cam.mode === 'function' ? cam.mode() : 1, near = nearSettlement(cam, P);
    for (var t = 0; t < 4; t++) {
      var T = I.TYPES[t], cw = T.cell, ix = Math.floor(c[0] / cw), iy = Math.floor(c[1] / cw), g4 = VALS.uInstGrid[t], p4 = VALS.uInstPar[t];
      g4[0] = mod(ix, 65536); g4[1] = mod(iy, 65536); g4[2] = ix * cw - c[0]; g4[3] = iy * cw - c[1];
      var r = rad[T.tierKey] ? rad[T.tierKey] / 1000 : 0;
      var on = r > 0 && (T.id !== 'wall' || (mode === 1 && near));
      p4[0] = cw; p4[1] = r; p4[2] = T.per; p4[3] = on ? 1 : 0;
    }
    VALS.uInstTime = (tSec == null ? (Date.now() / 1000) : tSec) % 3600;     // 一小时绕回一次（float32 仍有 0.3 ms 的分辨率）
    return VALS;
  };

  /* ───────── 网格（米；y 朝上；右手系，外表面逆时针） ───────── */
  // 二十面体细分球（带索引，平滑法线）：detail 0 → 12 顶点 20 面；1 → 42 顶点 80 面
  function icosphere(detail) {
    var t = (1 + Math.sqrt(5)) / 2, V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    var F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    V = V.map(function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
    for (var d = 0; d < detail; d++) {
      var cache = {}, F2 = [];
      var mid = function (a, b) {
        var key = a < b ? a + '_' + b : b + '_' + a;
        if (cache[key] != null) return cache[key];
        var p = [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2], l = Math.hypot(p[0], p[1], p[2]);
        V.push([p[0] / l, p[1] / l, p[2] / l]); cache[key] = V.length - 1; return cache[key];
      };
      F.forEach(function (f) {
        var a = mid(f[0], f[1]), b = mid(f[1], f[2]), c = mid(f[2], f[0]);
        F2.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
      });
      F = F2;
    }
    var pos = [], idx = [];
    V.forEach(function (v) { pos.push(v[0], v[1], v[2]); });
    F.forEach(function (f) { idx.push(f[0], f[1], f[2]); });
    return { pos: pos, nrm: pos.slice(), idx: idx };
  }
  // 不带索引的三角形表（平面法线）
  function Tris() { this.pos = []; this.nrm = []; }
  Tris.prototype.tri = function (a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (var i = 0; i < 3; i++) this.nrm.push(nx / l, ny / l, nz / l);
  };
  Tris.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  // 草丛：8 片叶，每片一个细三角（叶宽约为丛高的 1/7），高 1（着色器按 0.25–0.6 m 缩放），两面
  function grassTuft() {
    var T = new Tris(), n = 8;
    for (var i = 0; i < n; i++) {
      var a = i * 2.39996 + 0.3, r0 = 0.03 + 0.06 * ((i * 37) % 7) / 7, lean = 0.18 + 0.22 * ((i * 53) % 5) / 5, w = 0.07;
      var ca = Math.cos(a), sa = Math.sin(a), px = -sa * w, pz = ca * w, h = 0.65 + 0.35 * ((i * 29) % 6) / 6;
      T.tri([ca * r0 - px, 0, sa * r0 - pz], [ca * r0 + px, 0, sa * r0 + pz], [ca * (r0 + lean), h, sa * (r0 + lean)]);
    }
    return T;
  }
  // 圆台（n 边、seg 段）：从 p0 到 p1，半径 r0 → r1
  function frustum(T, p0, p1, r0, r1, n, seg) {
    var ax = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(ax[0], ax[1], ax[2]);
    var w = [ax[0] / L, ax[1] / L, ax[2] / L], tmp = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var u = [w[1] * tmp[2] - w[2] * tmp[1], w[2] * tmp[0] - w[0] * tmp[2], w[0] * tmp[1] - w[1] * tmp[0]], ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    var v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    function ring(k) {
      var s = k / seg, r = r0 + (r1 - r0) * s, c = [p0[0] + ax[0] * s, p0[1] + ax[1] * s, p0[2] + ax[2] * s], out = [];
      for (var i = 0; i < n; i++) { var a = 2 * Math.PI * i / n, ca = Math.cos(a) * r, sa = Math.sin(a) * r; out.push([c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa]); }
      return out;
    }
    var prev = ring(0);
    for (var k = 1; k <= seg; k++) {
      var cur = ring(k);
      for (var i = 0; i < n; i++) { var j = (i + 1) % n; T.quad(prev[i], prev[j], cur[j], cur[i]); }
      prev = cur;
    }
  }
  // 枯木：主干＋几根斜枝；高 1（着色器按 2.5–6.5 m 缩放；灌丛压扁）
  function deadTree(lod) {
    var T = new Tris(), near = lod === 0;
    frustum(T, [0, -0.05, 0], [0.02, 1, 0.01], 0.035, 0.008, near ? 6 : 4, near ? 4 : 1);
    var br = near ? [[0.42, 0.3, 0.32], [0.58, 2.4, 0.28], [0.72, 4.3, 0.24], [0.84, 5.6, 0.18]] : [[0.5, 0.8, 0.3], [0.75, 3.9, 0.22]];
    br.forEach(function (b) {
      var y = b[0], a = b[1], len = b[2], c = Math.cos(a), s = Math.sin(a);
      frustum(T, [0.01, y, 0], [c * len, y + len * 0.7, s * len], near ? 0.014 : 0.012, 0.004, near ? 4 : 3, near ? 2 : 1);
    });
    return T;
  }
  // 阶沿干砌石墙：长 20 m（x）、高约 1 m、厚 0.6 m，三段高低不齐；不画底面
  function wallSeg() {
    var T = new Tris(), xs = [-10, -3.2, 3.6, 10], hs = [1.0, 0.85, 0.95], z0 = -0.3, z1 = 0.3;
    for (var i = 0; i < 3; i++) {
      var a = xs[i], b = xs[i + 1], h = hs[i], tz0 = z0 + 0.06, tz1 = z1 - 0.06;
      T.quad([a, h, tz1], [b, h, tz1], [b, h, tz0], [a, h, tz0]);           // 顶
      T.quad([a, 0, z1], [b, 0, z1], [b, h, tz1], [a, h, tz1]);              // +z 面
      T.quad([b, 0, z0], [a, 0, z0], [a, h, tz0], [b, h, tz0]);              // −z 面
      T.quad([a, 0, z0], [a, 0, z1], [a, h, tz1], [a, h, tz0]);              // −x 端
      T.quad([b, 0, z1], [b, 0, z0], [b, h, tz0], [b, h, tz1]);              // +x 端
    }
    return T;
  }
  I.GEOMS = {
    rockNear: function () { return icosphere(1); },
    rockFar: function () { return icosphere(0); },
    grass: grassTuft,
    treeNear: function () { return deadTree(0); },
    treeFar: function () { return deadTree(1); },
    wall: wallSeg
  };
  // 局部格表：去掉相机在格内无论在哪都落在 [lo, hi] 环外的格。第 i 格覆盖图表偏移 [(i−1)·cw, (i+1)·cw]（格原点相对相机在 (−cw, 0]）
  function span(i) { return { lo: i >= -1 && i <= 1 ? 0 : Math.min(Math.abs(i - 1), Math.abs(i + 1)), hi: Math.max(Math.abs(i - 1), Math.abs(i + 1)) }; }
  I.cells = function (cw, per, lo, hi) {
    var n = Math.ceil(hi / cw) + 1, out = [];
    for (var j = -n; j <= n; j++) for (var i = -n; i <= n; i++) {
      var sx = span(i), sy = span(j), dMin = Math.hypot(sx.lo, sy.lo) * cw, dMax = Math.hypot(sx.hi, sy.hi) * cw;
      if (dMax < lo || dMin > hi) continue;
      for (var s = 0; s < per; s++) out.push(i, j, s);
    }
    return out;
  };

  /* ───────── GPU 资源 ───────── */
  var st = null;
  function tris(geo) { return geo.idx ? geo.idx.length / 3 : geo.pos.length / 9; }
  I.build = function (gfx, U, tier) {
    var THREE = G.THREE, ps = fp.passes;
    if (st) I.dispose();
    tier = tier || 'mid';
    I.tier = tier;
    if (!THREE || !gfx || !gfx.renderer) throw new Error('实例层需要 three.js 与渲染器');
    try { I.bakeGround(gfx.renderer, U); } catch (e) { if (G.console) G.console.warn('[第一人称] 地面细节贴图烘焙失败：' + (e && e.message || e)); }
    var vs = ps.assembleVert('inst'), fsrc = ps.assemble('inst'), rad = radii(tier);
    var scene = new THREE.Scene(), meshes = [], nInst = 0, nTri = 0;
    scene.autoUpdate = false;
    I.TYPES.forEach(function (T, ti) {
      var r = rad[T.tierKey] ? rad[T.tierKey] / 1000 : 0;
      if (!(r > 0)) return;
      T.lod.forEach(function (L) {
        var lo = 0, hi = r;
        if (L.lod === 0) hi = Math.min(r, T.split);
        if (L.lod === 1) lo = T.split;
        if (hi <= lo) return;
        var cells = I.cells(T.cell, T.per, lo, hi), count = cells.length / 3;
        if (!count) return;
        var base = I.GEOMS[L.geo](), ig = new THREE.InstancedBufferGeometry();
        ig.setAttribute('position', new THREE.Float32BufferAttribute(base.pos, 3));
        ig.setAttribute('normal', new THREE.Float32BufferAttribute(base.nrm, 3));
        if (base.idx) ig.setIndex(base.idx);
        ig.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 3));
        ig.instanceCount = count;
        var defs = ps.definesFor(tier);
        defs.INST_TYPE = ti; defs.INST_LOD = L.lod; defs.INST_SPLIT = (T.split || 0.04).toFixed(4);
        var mat = new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3, uniforms: U, defines: defs, vertexShader: vs, fragmentShader: fsrc,
          depthTest: true, depthWrite: true, side: T.id === 'grass' ? THREE.DoubleSide : THREE.FrontSide
        });
        mat.depthFunc = THREE.LessEqualDepth;
        var mesh = new THREE.Mesh(ig, mat);
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.name = T.id + (L.lod === 2 ? '' : L.lod === 0 ? '·近' : '·远');
        scene.add(mesh); meshes.push(mesh);
        nInst += count; nTri += count * tris(base);
      });
    });
    st = { gfx: gfx, U: U, tier: tier, scene: scene, cam: new THREE.Camera(), meshes: meshes, stats: { instances: nInst, tris: nTri, meshes: meshes.length } };
    return { meshes: meshes, stats: st.stats };
  };
  I.setTier = function (tier) { if (st) { var gfx = st.gfx, U = st.U; I.build(gfx, U, tier); } else I.tier = tier; };
  I.compile = function () { if (st && st.meshes.length) st.gfx.renderer.compile(st.scene, st.cam); };
  I._dbg = function () { return { hasU: !!(st && st.U), keyGr: !!(st && st.U && st.U.uGrDet), grDet: !!(st && st.U && st.U.uGrDet && st.U.uGrDet.value), same: !!(st && st.U && bake.det && st.U.uGrDet && st.U.uGrDet.value === bake.det.texture) }; };
  I.stats = function () { return st ? st.stats : { instances: 0, tris: 0, meshes: 0 }; };
  I.draw = function (target, ctx) {
    if (!st || !st.meshes.length) return false;
    var cam = (ctx && ctx.cam) || (fp.cam && fp.cam.current);
    if (!cam) return false;
    var P = (ctx && ctx.P) || (HY.model && HY.model.P), tSec = ctx && ctx.time != null ? ctx.time : null;
    fp.apply(st.U, I.values(cam, P, tSec, st.tier), 'inst');
    var r = st.gfx.renderer;
    r.setRenderTarget(target || null);
    r.render(st.scene, st.cam);
    return true;
  };
  I.dispose = function () {
    if (!st) return;
    st.meshes.forEach(function (m) { m.geometry.dispose(); m.material.dispose(); });
    st = null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
