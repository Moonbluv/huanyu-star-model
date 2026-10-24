/* HY.fp.passes —— pass 表 DEFS、档位 TIERS、渲染目标、帧图、动态分辨率、编译排程、GPU 计时
 * 规格：spec/02 第四节第 2 条、第十二节第 1 条、第十四至十六节；spec/03 第七节第 3 条。
 * 契约表之一（M1 建表）：DEFS、CHAIN、TIERS、TIER_OPTS 加载即有、节点可测。
 * 负责：E 路（第一人称·管线）实现 build/graph，并按需调整表——改表须让 test/contract_check.js、glsl_check.js 继续通过。
 * 其他路要加 pass（云、实例……）：在自己的文件里调 HY.fp.passes.addDefs({...})，不要改本文件。
 *
 * 帧图（02 第十六节第 5 条）：
 *   [一次／改参数] gen_height → gen_height_d；lut_tau → lut_ms → lut_sky；bake_world；bake_weather（fi.bakeHour 变了就重烘：每 10 模拟分钟，见 settings.bakeHour）
 *   foot → horizon（每帧至多一级）→ cloud_shadow（每 csEvery 帧）→ probe＋sh（每 probeEvery 帧，乒乓）
 *   terrain_coarse → terrain（写 tSurf 与深度）→ 实例（HY.fp.inst.draw，同一目标）
 *   near → far → composite（tHDR，乘旧曝光）→ rain（加法）→ taa（乒乓）→ meter → eye（新曝光，乒乓）
 *   → bloom_down×L → bloom_up×(L−1) → final（画布）
 * 曝光的传递（两张 tEye 乒乓，A＝本帧合成用的曝光 e_f，B＝上一帧合成用的 e_{f−1}）：
 *   composite 乘 A；taa 把历史乘 A/B；meter 除以 A；eye 读 A、写 B（＝e_{f+1}）；final 乘 B/A；然后交换。
 * 节点里（没有 THREE、gfx 为 null）build 也能用：不出图，但排程、尺寸、抖动、TAA 权重、地平线角图轮换照常，
 *   每帧执行过的 pass 记在 graph.lastPlan（test/passes_check.js 用它断言次序）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  var ps = fp.passes = fp.passes || {};

  /* 场景类 pass 的拼接次序（02 第十二节第 1 条）；各 pass 只拼用得到的，但顺序必须服从它 */
  var CHAIN = ['common', 'shadow', 'sheath', 'air', 'clouds', 'moon', 'terrain_lib', 'shade_terrain', 'shade_wall'];
  var POST = ['post_common'];
  var FULL = CHAIN.slice();
  ps.CHAIN = CHAIN;
  ps.POST = POST;

  /* DEFS[名] = {
   *   chunks  拼在主文件之前的 chunk（HY.glsl 的键，顺序服从 CHAIN；后期类只拼 post_common）
   *   main    片元主文件（HY.glsl 的键）；vert：网格类 pass 的顶点着色器键（kind:'mesh'）
   *   kind    'fs' 全屏三角形（默认）| 'mesh' 光栅化网格（实例）
   *   out     渲染目标名（'screen'＝画布）；size [w,h] 固定尺寸，或 scale 相对内部分辨率 W×H（数或宏名）
   *   fmt     'f32' | 'f16' | 'u8' | 'f32lin'（有 OES_texture_float_linear 用 32F，否则 16F）
   *   filter  'linear' | 'nearest'；wrap 'clamp' | 'repeat' | 'repeatU'（u 平铺、v 夹取）
   *   when    'init' 启动一次 | 'param:atmo' | 'param:zones' | 'param:cloud' | 'hourly' 按天气烘焙时刻（fi.bakeHour，每 10 模拟分钟）
   *           | 'frame' 每帧 | 'horizon' 按需每帧至多一级 | 'every:csEvery' | 'every:probeEvery'（间隔见 TIER_OPTS）
   *   order   执行次序（同一帧里从小到大）
   *   depth   'always'（写 gl_FragDepth）| 'lequal'（实例）；pingpong：双缓冲；levels：多级（眩光金字塔）
   *   tiers   只在这些档位启用（省略＝全部）；blend：'add'；stub：主文件还是桩（以着色器第一行“// 【桩】”为准，见 ps.isStub）
   * }
   */
  var DEFS = {
    gen_height:     { chunks: ['common'], main: 'gen_height', out: 'tHeight32', size: [1024, 1024], fmt: 'f32', filter: 'nearest', wrap: 'repeat', when: 'init', order: 1 },
    gen_height_d:   { chunks: ['common'], main: 'gen_height_d', out: 'tHeight', size: [1024, 1024], fmt: 'f16', filter: 'linear', wrap: 'repeat', when: 'init', order: 2 },
    bake_world:     { chunks: ['common'], main: 'bake_world', out: 'tWorld', size: [2048, 1024], fmt: 'u8', filter: 'linear', wrap: 'repeatU', when: 'param:zones', order: 3 },
    bake_weather:   { chunks: ['common'], main: 'bake_weather', out: 'tWeather', size: [1024, 512], fmt: 'u8', filter: 'linear', wrap: 'repeatU', when: 'hourly', order: 4 },
    lut_tau:        { chunks: ['common'], main: 'lut_tau', out: 'tTau', size: [256, 128], fmt: 'f32lin', filter: 'linear', wrap: 'clamp', when: 'param:atmo', order: 5 },
    lut_ms:         { chunks: ['common'], main: 'lut_ms', out: 'tMS', size: [32, 32], fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'param:atmo', order: 6 },
    lut_sky:        { chunks: ['common'], main: 'lut_sky', out: 'tSkyLUT', size: [64, 1], fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'param:atmo', order: 7 },
    foot:           { chunks: ['common'], main: 'foot', out: 'tFoot', size: [1, 1], fmt: 'f32', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 10 },
    horizon:        { chunks: ['common', 'terrain_lib'], main: 'horizon', out: 'tHorizon', size: [256, 768], fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'horizon', order: 11 },
    cloud_shadow:   { chunks: ['common', 'shadow', 'clouds', 'terrain_lib'], main: 'cloud_shadow', out: 'tCloudSh', size: [256, 256], fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'every:csEvery', order: 12 },
    probe:          { chunks: ['common', 'shadow', 'sheath', 'air', 'clouds', 'moon', 'terrain_lib', 'shade_wall'], main: 'probe', out: 'tProbe', size: [32, 48], fmt: 'f16', filter: 'nearest', wrap: 'clamp', when: 'every:probeEvery', order: 13 },
    sh:             { chunks: [], main: 'sh', out: 'tSH', size: [9, 3], fmt: 'f16', filter: 'nearest', wrap: 'clamp', when: 'every:probeEvery', order: 14, pingpong: true },
    terrain_coarse: { chunks: ['common', 'terrain_lib'], main: 'terrain_coarse', out: 'tTerC', scale: 0.25, fmt: 'f32', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 15 },
    terrain:        { chunks: ['common', 'shadow', 'sheath', 'air', 'clouds', 'moon', 'terrain_lib', 'shade_terrain'], main: 'terrain', out: 'tSurf', scale: 1, fmt: 'f16', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 16, depth: 'always' },
    inst:           { kind: 'mesh', chunks: ['common', 'shadow', 'terrain_lib', 'shade_terrain'], vert: 'inst_vert', main: 'inst', out: 'tSurf', scale: 1, when: 'frame', order: 17, depth: 'lequal' },
    near:           { chunks: FULL, main: 'near', out: 'tNear', scale: 'NEAR_SCALE', fmt: 'f16', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 18 },
    far:            { chunks: ['common', 'shadow', 'sheath', 'air', 'clouds', 'moon', 'terrain_lib', 'shade_wall'], main: 'far', out: 'tFar', scale: 'FAR_SCALE', fmt: 'f16', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 19 },
    composite:      { chunks: ['common', 'moon'], main: 'composite', out: 'tHDR', scale: 1, fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'frame', order: 20 },
    rain:           { chunks: ['post_common'], main: 'rain', out: 'tHDR', scale: 1, when: 'frame', order: 21, blend: 'add', tiers: ['low', 'mid', 'high', 'photo'] },   // clouds 路：低档也画（两层）
    taa:            { chunks: ['post_common'], main: 'eye_taa', out: 'tTAA', scale: 1, fmt: 'f32lin', filter: 'linear', wrap: 'clamp', when: 'frame', order: 22, pingpong: true },   // M6：主文件 eye_taa.frag、历史 32F（fp/eye.js 的 wire 另以 replace 方式套一遍，结果相同）
    meter:          { chunks: ['post_common'], main: 'meter', out: 'tMeter', size: [64, 32], fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'frame', order: 23 },
    eye:            { chunks: ['common', 'shadow'], main: 'eye', out: 'tEye', size: [2, 1], fmt: 'f32', filter: 'nearest', wrap: 'clamp', when: 'frame', order: 24, pingpong: true },
    bloom_down:     { chunks: ['post_common'], main: 'bloom_down', out: 'tBloom', scale: 0.5, levels: 5, fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'frame', order: 25 },
    bloom_up:       { chunks: ['post_common'], main: 'bloom_up', out: 'tBloom', scale: 0.5, levels: 5, fmt: 'f16', filter: 'linear', wrap: 'clamp', when: 'frame', order: 26, blend: 'add' },
    final:          { chunks: ['post_common'], main: 'final', out: 'screen', scale: 'OUT', when: 'frame', order: 27 }
  };
  ps.DEFS = DEFS;

  /* 档位（02 第十五节第 1 条）：TIERS 是注入 material.defines 的宏（浮点写成带小数点的字符串）；
   * TIER_OPTS 是 JS 侧的档位参数（分辨率范围、各种间隔与尺寸、开关）
   * FAR_SCALE（E 路加）：远段 pass 相对内部分辨率的倍数，far.frag 与 composite.frag 共用（拍照档 1.0） */
  var TIERS = {
    low:   { Q_NEAR_N: 8,  Q_FAR_N: 6,  Q_CLOUD_N: 16, Q_CLOUD_L: 1, Q_CLOUD_KM: '20.0', Q_TER_C: 64,  Q_TER_F: 16, Q_TER_KM: '40.0',  Q_TER_FAR_KM: '200.0', Q_ECL_AIR: 0, NEAR_SCALE: '0.25', FAR_SCALE: '0.5' },
    mid:   { Q_NEAR_N: 14, Q_FAR_N: 10, Q_CLOUD_N: 32, Q_CLOUD_L: 2, Q_CLOUD_KM: '40.0', Q_TER_C: 96,  Q_TER_F: 24, Q_TER_KM: '80.0',  Q_TER_FAR_KM: '400.0', Q_ECL_AIR: 0, NEAR_SCALE: '0.25', FAR_SCALE: '0.5' },
    high:  { Q_NEAR_N: 24, Q_FAR_N: 16, Q_CLOUD_N: 64, Q_CLOUD_L: 3, Q_CLOUD_KM: '60.0', Q_TER_C: 128, Q_TER_F: 32, Q_TER_KM: '150.0', Q_TER_FAR_KM: '600.0', Q_ECL_AIR: 1, NEAR_SCALE: '0.5', FAR_SCALE: '0.5' },
    photo: { Q_NEAR_N: 24, Q_FAR_N: 16, Q_CLOUD_N: 64, Q_CLOUD_L: 3, Q_CLOUD_KM: '60.0', Q_TER_C: 128, Q_TER_F: 32, Q_TER_KM: '150.0', Q_TER_FAR_KM: '600.0', Q_ECL_AIR: 1, NEAR_SCALE: '0.5', FAR_SCALE: '1.0' }
  };
  var TIER_OPTS = {
    low:   { res: [0.45, 0.6], farScale: 0.5, dprCap: 1, hzLevels: 2, hzSize: 128, csSize: 128, csEvery: 4, csHalf: 150, probeEvery: 4, bloomLevels: 4, accum: 8, rain: true, moonAir: false, inst: { rock: 60 }, aoScan: false, nearShadow: false },
    mid:   { res: [0.5, 0.75], farScale: 0.5, dprCap: 1.5, hzLevels: 3, hzSize: 256, csSize: 256, csEvery: 2, csHalf: 150, probeEvery: 2, bloomLevels: 5, accum: 16, rain: true, moonAir: false, inst: { rock: 150, grass: 60, wood: 300, wall: 300 }, aoScan: false, nearShadow: false },
    high:  { res: [0.75, 1.0], farScale: 0.5, dprCap: 2, hzLevels: 3, hzSize: 512, csSize: 256, csEvery: 1, csHalf: 300, probeEvery: 1, bloomLevels: 5, accum: 64, rain: true, moonAir: true, inst: { rock: 300, grass: 150, wood: 600, wall: 800 }, aoScan: true, nearShadow: true },
    photo: { res: [1.0, 1.0], farScale: 1.0, dprCap: 2, hzLevels: 3, hzSize: 512, csSize: 256, csEvery: 1, csHalf: 300, probeEvery: 1, bloomLevels: 5, accum: 64, rain: true, moonAir: true, inst: { rock: 300, grass: 150, wood: 600, wall: 800 }, aoScan: true, nearShadow: true }
  };
  ps.TIERS = TIERS;
  ps.TIER_OPTS = TIER_OPTS;
  ps.TIER_NAMES = ['low', 'mid', 'high', 'photo'];
  // 02 第六节 common.glsl 里 #ifndef 的全部画质宏（TIERS 每档都必须定义）＋ E 路的 FAR_SCALE
  ps.Q_MACROS = ['Q_NEAR_N', 'Q_FAR_N', 'Q_CLOUD_N', 'Q_CLOUD_L', 'Q_CLOUD_KM', 'Q_TER_C', 'Q_TER_F', 'Q_TER_KM', 'Q_TER_FAR_KM', 'Q_ECL_AIR', 'NEAR_SCALE', 'FAR_SCALE'];
  // 地平线角图三级的半宽（km，02 第八节第 7 条）
  ps.HZ_HALF = [1, 8, 64];

  /* ───────── E 路新增的 uniform（着色器里已声明；写入方见各行） ───────── */
  if (fp.registerUniforms) {
    fp.registerUniforms([
      ['uMeter', 'sampler2D', null, 'pass'],                  // eye：测光 64×32
      ['uEyeCfg', 'vec4', [1, 12, 0, 0.7], 'set'],            // eye：x 自动曝光 1／固定 EV 0，y 固定 EV，z EV 补偿，w 色适应强度（CPU 用）
      ['uAbyssFog', 'float', 1, 'set']                         // far：深渊雾开关（fp.ground.abyssFog）
    ]);
    fp.registerPrivate('eye', [['uEyeCtl', 'vec4', [0.016, 1, 0, 0]]]);       // x 真实秒步长，y 1＝直接跳到目标，z 模拟秒步长，w 1＝雨丝／飘尘在画
    fp.registerPrivate('rain', [['uRainK', 'vec4', [0, 0, 0, 0]]]);           // x 雨，y 余息飘尘，z 真实秒
    fp.registerPrivate('bloom_down', [['uLevel', 'int', 0]]);                 // 金字塔级号（0 读 TAA 结果，用 Karis 平均）
    fp.registerPrivate('bloom_up', [['uUpW', 'float', 1]]);                   // 上采样叠加权重
  }

  /* ───────── 登记（其他路在自己的文件里追加） ───────── */
  function validDef(name, d) {
    if (!d || typeof d.main !== 'string') throw new Error('pass ' + name + ' 缺 main');
    if (!Array.isArray(d.chunks)) throw new Error('pass ' + name + ' 缺 chunks');
    var last = -1;
    d.chunks.forEach(function (c) {
      var i = CHAIN.indexOf(c);
      if (c === 'post_common') { if (d.chunks.length !== 1) throw new Error('pass ' + name + '：post_common 只能单独拼'); return; }
      if (i < 0) throw new Error('pass ' + name + ' 的 chunk ' + c + ' 不在 CHAIN 里（新 chunk 请用 addChunk 登记次序）');
      if (i <= last) throw new Error('pass ' + name + ' 的 chunks 次序违背 CHAIN：' + d.chunks.join(' → '));
      last = i;
    });
    if (!d.out) throw new Error('pass ' + name + ' 缺 out');
    if (!d.size && d.scale == null) throw new Error('pass ' + name + ' 缺 size 或 scale');
  }
  ps.validate = validDef;
  // defs：{ 名: DEF, … }；已存在的名字要 opts.replace 才覆盖
  ps.addDefs = function (defs, opts) {
    Object.keys(defs).forEach(function (k) {
      validDef(k, defs[k]);
      if (DEFS[k] && !(opts && opts.replace)) throw new Error('pass ' + k + ' 已存在（要覆盖请传 {replace:true}）');
      DEFS[k] = defs[k];
    });
  };
  // 新的共享 chunk 插进 CHAIN（after：放在哪个 chunk 之后）
  ps.addChunk = function (name, after) {
    if (CHAIN.indexOf(name) >= 0) return;
    var i = CHAIN.indexOf(after);
    if (i < 0) throw new Error('addChunk：' + after + ' 不在 CHAIN 里');
    CHAIN.splice(i + 1, 0, name);
  };
  // 新的画质宏：values＝{low, mid, high, photo}
  ps.addTierDefine = function (macro, values) {
    ps.TIER_NAMES.forEach(function (t) {
      if (values[t] === undefined) throw new Error('addTierDefine：' + macro + ' 缺 ' + t + ' 档的值');
      TIERS[t][macro] = values[t];
    });
    if (ps.Q_MACROS.indexOf(macro) < 0) ps.Q_MACROS.push(macro);
  };
  ps.addTierOpts = function (key, values) {
    ps.TIER_NAMES.forEach(function (t) { TIER_OPTS[t][key] = values[t]; });
  };

  /* ───────── 拼接（节点可测）：返回片元着色器源码（不含 #version，three 的 GLSL3 会加） ───────── */
  ps.ordered = function () {
    return Object.keys(DEFS).sort(function (a, b) { return DEFS[a].order - DEFS[b].order; });
  };
  ps.assemble = function (name, glsl) {
    var d = DEFS[name], g = glsl || HY.glsl || {};
    if (!d) throw new Error('没有 pass ' + name);
    var parts = d.chunks.map(function (c) {
      if (g[c] == null) throw new Error('pass ' + name + ' 要的 chunk ' + c + ' 不在 HY.glsl 里');
      return g[c];
    });
    if (g[d.main] == null) throw new Error('pass ' + name + ' 的主文件 ' + d.main + ' 不在 HY.glsl 里');
    parts.push(g[d.main]);
    return parts.join('\n');
  };
  ps.assembleVert = function (name, glsl) {
    var d = DEFS[name], g = glsl || HY.glsl || {};
    if (!d || !d.vert) return null;
    var parts = d.chunks.filter(function (c) { return c !== 'post_common'; }).map(function (c) { return g[c]; });
    parts.push(g[d.vert]);
    return parts.join('\n');
  };
  // 某档位的 defines（material.defines 用）
  ps.definesFor = function (tier) { var o = {}, t = TIERS[tier] || TIERS.mid; for (var k in t) o[k] = t[k]; return o; };

  /* ───────── 节点可测的小工具 ───────── */
  // 主文件（或顶点着色器）还是桩：第一行是“// 【桩】”（04 第一节的约定）
  function isStubSrc(src) { return typeof src === 'string' && /^\s*\/\/\s*【桩】/.test(src); }
  ps.isStub = function (name, glsl) {
    var d = DEFS[name], g = glsl || HY.glsl || {};
    if (!d) return true;
    return isStubSrc(g[d.main]) || (!!d.vert && isStubSrc(g[d.vert]));
  };
  // 某档位逐帧要编的全屏 pass（按 order；mesh 类由 HY.fp.inst 自己管）
  ps.passesFor = function (tier) {
    return ps.ordered().filter(function (n) {
      var d = DEFS[n];
      if (d.kind === 'mesh') return false;
      if (d.tiers && d.tiers.indexOf(tier) < 0) return false;
      return true;
    });
  };
  // Halton(2,3) 前 16 项，减 0.5 → 子像素抖动（全分辨率像素；02 第十四节第 1 条）
  ps.halton = function (i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  ps.jitter = function (frame, out) {
    var i = (((frame % 16) + 16) % 16) + 1;
    out = out || [0, 0];
    out[0] = ps.halton(i, 2) - 0.5; out[1] = ps.halton(i, 3) - 0.5;
    return out;
  };
  // TAA 历史权重 α＝max(1/n, α_min)；静止时 α_min 降到 1/accum（拍照累积），否则 0.1；再按模拟时间步长放大（02 第十四节第 1 条）
  ps.taaAlpha = function (n, dtSimSec, still, accum) {
    var amin = still ? 1 / Math.max(accum || 16, 1) : 0.1;
    amin = Math.max(amin, 1 - Math.exp(-Math.max(dtSimSec || 0, 0) / 120));
    return Math.min(1, Math.max(1 / Math.max(n, 1), amin));
  };
  // 内部渲染尺寸：画布×比例，取 4 的倍数（粗求交 1/4、近段 1/4 或 1/2、远段 1/2 都正好整除）
  ps.internalSize = function (outW, outH, scale) {
    var w = Math.max(16, 4 * Math.round(outW * scale / 4)), h = Math.max(16, 4 * Math.round(outH * scale / 4));
    return [w, h];
  };
  function scaleOf(d, tier) {
    var s = d.scale;
    if (typeof s === 'number') return s;
    if (s === 'NEAR_SCALE') return parseFloat(TIERS[tier].NEAR_SCALE);
    if (s === 'FAR_SCALE') return TIER_OPTS[tier].farScale;
    if (typeof s === 'string' && TIERS[tier][s] != null) return parseFloat(TIERS[tier][s]);
    return 1;
  }
  ps.scaleOf = scaleOf;
  // 地平线角图实际用的边长：horizon.frag 若把 256 写死在着色器里，就只能用 256（F 路改成读 uRes 后自动跟随档位）
  ps.hzSize = function (tier, glsl) {
    var g = glsl || HY.glsl || {}, src = g.horizon || '';
    if (/256\.0\s*\*\s*float\s*\(\s*uLvl\s*\)/.test(src)) return 256;
    return TIER_OPTS[tier].hzSize;
  };
  /* 全部渲染目标的规格：{名: {w, h, fmt, filter, wrap, depth, count（乒乓 2）, levels:[[w,h]…]}}。
   * W×H＝内部分辨率；outW×outH＝画布（只给 'OUT'） */
  ps.targetSpecs = function (tier, W, H, glsl) {
    var o = TIER_OPTS[tier], out = {};
    ps.ordered().forEach(function (n) {
      var d = DEFS[n];
      if (d.kind === 'mesh' || d.out === 'screen') { if (d.depth && out[d.out]) out[d.out].depth = true; return; }
      if (d.tiers && d.tiers.indexOf(tier) < 0 && !out[d.out]) return;
      var sp = out[d.out];
      if (!sp) {
        sp = out[d.out] = { fmt: d.fmt || 'f16', filter: d.filter || 'linear', wrap: d.wrap || 'clamp', depth: !!d.depth, count: d.pingpong ? 2 : 1 };
        if (d.size) { sp.w = d.size[0]; sp.h = d.size[1]; }
        else { var s = scaleOf(d, tier); sp.w = Math.max(1, Math.round(W * s)); sp.h = Math.max(1, Math.round(H * s)); }
        if (d.levels) {
          var L = Math.min(d.levels, o.bloomLevels || d.levels); sp.levels = [];
          for (var i = 0; i < L; i++) sp.levels.push([Math.max(1, Math.floor(sp.w / Math.pow(2, i))), Math.max(1, Math.floor(sp.h / Math.pow(2, i)))]);
        }
      } else {
        if (d.depth) sp.depth = true;
        if (d.pingpong) sp.count = 2;
      }
    });
    var hz = ps.hzSize(tier, glsl);
    if (out.tHorizon) { out.tHorizon.w = hz; out.tHorizon.h = 3 * hz; }
    if (out.tCloudSh) { out.tCloudSh.w = out.tCloudSh.h = o.csSize; }
    return out;
  };

  /* 动态分辨率（02 第十五节第 2 条）：rAF 间隔的滑动平均，目标 30 ms，内部比例在档位范围里调；
   * 低于下限 2 s 仍超时就要降一档；高于 55 fps 持续 5 s 可升一档（升档要用户同意，这里只提示）。
   * update(dtReal) → {scale, changed, down, up}；时间一律用累计的真实秒（不读时钟，节点可测） */
  ps.DynRes = function (range, opts) {
    opts = opts || {};
    var self = {
      range: range.slice(), scale: opts.scale != null ? opts.scale : range[1], ema: 0, clock: 0, lastChange: -1e9,
      overSince: -1, fastSince: -1, step: opts.step || 0.05, target: opts.target || 0.030, hold: opts.hold || 1.5, warm: opts.warm || 2,
      enabled: opts.enabled !== false
    };
    self.update = function (dt) {
      var r = { scale: self.scale, changed: false, down: false, up: false };
      if (!(dt > 0) || dt > 0.25) return r;               // 卡顿、切页回来：不算
      self.clock += dt;
      self.ema = self.ema ? 0.92 * self.ema + 0.08 * dt : dt;
      if (!self.enabled || self.clock < self.warm) return r;
      var lo = self.range[0], hi = self.range[1], e = self.ema, T = self.target;
      if (self.clock - self.lastChange >= self.hold) {
        var ns = self.scale;
        if (e > T * 1.1 && self.scale > lo + 1e-6) ns = Math.max(lo, self.scale - self.step);
        else if (e < T * 0.8 && self.scale < hi - 1e-6) ns = Math.min(hi, self.scale + self.step);
        if (ns !== self.scale) { self.scale = Math.round(ns * 1000) / 1000; self.lastChange = self.clock; r.changed = true; }
      }
      // 降档：已在下限仍超时 2 s
      if (self.scale <= lo + 1e-6 && e > T * 1.2) { if (self.overSince < 0) self.overSince = self.clock; else if (self.clock - self.overSince >= 2) { r.down = true; self.overSince = -1; } }
      else self.overSince = -1;
      // 可升档：已在上限且 > 55 fps 持续 5 s
      if (self.scale >= hi - 1e-6 && e < 1 / 55) { if (self.fastSince < 0) self.fastSince = self.clock; else if (self.clock - self.fastSince >= 5) { r.up = true; self.fastSince = self.clock + 55; } }
      else self.fastSince = -1;
      r.scale = self.scale;
      return r;
    };
    self.setRange = function (rg, keep) { self.range = rg.slice(); self.scale = keep ? Math.min(rg[1], Math.max(rg[0], self.scale)) : rg[1]; self.clock = 0; self.lastChange = -1e9; self.overSince = self.fastSince = -1; };
    return self;
  };

  /* 地平线角图：哪一级该重烘焙（每帧至多一级）。lv[i]＝{valid, c:[东,北], az}；c＝相机此刻的图表坐标，az＝日方位（度）。
   * 失效、相机越过 1/4 级宽、太阳方位变了 0.25° 都算到期；挑“过期程度”最大的一级。返回级号或 −1 */
  ps.hzDue = function (lv, n, c, az) {
    var best = -1, bestScore = 0;
    for (var i = 0; i < n; i++) {
      var L = lv[i], hw = ps.HZ_HALF[i], score;
      if (!L || !L.valid) score = 1e9 - i;
      else {
        var dx = c[0] - L.c[0], dy = c[1] - L.c[1], move = Math.max(Math.abs(dx), Math.abs(dy)) / (hw / 2);
        var da = Math.abs(((az - L.az + 540) % 360) - 180) / 0.25;
        score = Math.max(move, da);
        if (score < 1) continue;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  };

  /* ───────── 帧图 ─────────
   * build(gfx, U, tier, opts) → graph
   *   gfx＝HY.gfx（null＝节点：不出图）；U＝fp.makeU(THREE) 的共享 uniform；tier＝起始档位（启动时一律先编 'low'）
   *   opts.defines(pass) → 额外宏（settings 的 TONE_ACES 等）；opts.onError(msg)
   * graph.run(fi)         一帧。fi：{dtReal, dtSim(日), chart:[东,北], chartKey, sunAz(度), sunDir:[3], still, rainK:[4],
   *                        bakeHour, bakeTime, cat:[9], skipFinal}
   * graph.compileNext()   编一个程序（启动时编起始档位；setTier 后编目标档位，编完自动切换）；返回 true＝还有
   * graph.compileStatus() → {tier, pending, done, total, error}
   * graph.resize(w, h)    画布像素；graph.setTier(t)；graph.recompile(pass)；graph.invalidate(flags)；graph.reset(what)
   * graph.autoRes(dtReal, on) → {down, up, changed}；graph.readEyeAsync() / pollEye() → Float32Array(8) | null
   * graph.readPx(fx, fy) → {rgb:[3], dist, expo}（同步读 tHDR，测试用）；graph.gpuTimes()；graph.setNoise(d64, d32)；graph.dispose()
   */
  ps.build = function (gfx, U, tier, opts) {
    opts = opts || {};
    var THREE = G.THREE;
    var R = gfx && gfx.renderer ? gfx.renderer : null;
    var live = !!(R && THREE && U);
    var gl = live ? R.getContext() : null, caps = (gfx && gfx.caps) || {};
    var glsl = HY.glsl || {};
    tier = TIERS[tier] ? tier : 'mid';

    var g = {
      tier: tier, live: live, targets: {}, W: 0, H: 0, outW: 0, outH: 0, scale: TIER_OPTS[tier].res[1],
      frame: 0, lastPlan: [], errors: [], lost: false, disposed: false
    };
    var mats = {};                       // mats[tier][pass] = ShaderMaterial
    var priv = {};                       // 每个 pass 的私有 uniform（跨档位共用同一批 {value}）
    var queue = [], waiting = null, pendingTier = null, compiledTotal = 0, queueTotal = 0;
    var need = { gen: true, lut: true, world: true, weather: true, horizon: true, cs: true, probe: true, taa: true, eyeClear: true, eyeReset: 3 };
    var hz = [null, null, null], cs = { c: [0, 0], valid: false }, chartKey = null, lastBakeHour = null;
    var taaN = 0, eyeCur = 0, taaCur = 0, shCur = 0;
    var jit = [0, 0], jitPrev = [0, 0];
    var dyn = ps.DynRes(TIER_OPTS[tier].res);
    var fs = null, worldFallback = null, noiseTex = { n64: null, n32: null };
    var timing = null, eyeRead = null, eyeOut = new Float32Array(8), pxBuf = new Float32Array(4);

    function o() { return TIER_OPTS[g.tier]; }
    function err(msg) { g.errors.push(msg); if (opts.onError) { try { opts.onError(msg); } catch (e) { /* 忽略 */ } } else if (G.console) G.console.error('[HY.fp.passes] ' + msg); }

    /* ── 全屏三角形（02 第十六节第 2 条） ── */
    var VS = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
    if (live) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      var mesh = new THREE.Mesh(geo, null);
      mesh.frustumCulled = false;
      var scene = new THREE.Scene(); scene.add(mesh); scene.autoUpdate = false;
      var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      fs = { geo: geo, mesh: mesh, scene: scene, cam: cam };
    }

    /* ── 材质 ── */
    function privFor(pass) {
      if (!priv[pass]) priv[pass] = fp.makePrivate(live ? THREE : null, pass);
      return priv[pass];
    }
    function definesFor(t, pass) {
      var d = ps.definesFor(t), x = opts.defines ? opts.defines(pass) : null, k;
      if (x) for (k in x) d[k] = x[k];
      return d;
    }
    function makeMat(t, pass) {
      var d = DEFS[pass];
      var m = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: fp.uniformsFor(U, privFor(pass)),
        defines: definesFor(t, pass),
        vertexShader: VS,
        fragmentShader: ps.assemble(pass, glsl),
        depthTest: d.depth === 'always', depthWrite: d.depth === 'always'
      });
      if (d.depth === 'always') m.depthFunc = THREE.AlwaysDepth;
      if (d.blend === 'add') {
        m.blending = THREE.CustomBlending;
        m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
        m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
      } else m.blending = THREE.NoBlending;
      m.name = 'fp.' + pass + '.' + t;
      return m;
    }
    // mats[t][pass]：材质；false＝编译失败（不再重试，直到 recompile）
    function matOf(t, pass, create) {
      var mt = mats[t] || (mats[t] = {});
      if (mt[pass] === false) return null;
      if (!mt[pass] && create && live) {
        try { mt[pass] = makeMat(t, pass); } catch (e) { err('pass ' + pass + ' 建材质失败：' + (e && e.message || e)); mt[pass] = false; }
      }
      return mt[pass] || null;
    }
    // 链接结果：有 KHR_parallel_shader_compile 时先问完成没有；返回 true 完成、false 还在编、或 {error}
    var parExt = live ? R.extensions.get('KHR_parallel_shader_compile') : null;
    // r128 把程序放在 properties.get(material).currentProgram（更早的版本叫 program）
    function glProgram(m) { var p = live ? R.properties.get(m) : null; return p ? (p.currentProgram || p.program || null) : null; }
    function linkState(m, force) {
      var wp = glProgram(m);
      if (!wp || !wp.program) return { error: '没有生成程序' };
      if (parExt && !force && !gl.getProgramParameter(wp.program, parExt.COMPLETION_STATUS_KHR)) return false;
      if (gl.getProgramParameter(wp.program, gl.LINK_STATUS)) return true;
      var log = '';
      try { log = (gl.getShaderInfoLog(wp.fragmentShader) || '') + (gl.getProgramInfoLog(wp.program) || ''); } catch (e) { log = ''; }
      return { error: log.trim().split('\n').slice(0, 6).join(' / ') || '链接失败' };
    }
    function compileOne(t, pass) {
      var m = matOf(t, pass, true);
      if (!m) return null;
      fs.mesh.material = m;
      R.compile(fs.scene, fs.cam);
      return m;
    }
    function queueTier(t) {
      queue = ps.passesFor(t).filter(function (p) { return !(mats[t] && mats[t][p] != null); }).map(function (p) { return { tier: t, pass: p }; });
      queueTotal = queue.length; compiledTotal = 0;
      prewarm(t);
    }
    /* 并行预编译（KHR_parallel_shader_compile）：three r128 建程序时马上取 uniform 表，等于同步等链接，一个一个编很慢
     * （ANGLE/D3D 上首次进入要十几秒）。这里先用原生 GL 把整档的程序一次提交（驱动在后台多线程编），源码与 three 拼出来的
     * 逐字相同（同档位的前缀一样，从一个小程序上取下来）；之后 three 再编同样的源码时命中驱动的程序缓存。失败只是白编，不影响结果。 */
    var warm = {};
    function prewarm(t) {
      if (!live || !parExt || !queue.length) return;
      try {
        var probe = queue.filter(function (j) { return j.pass === 'foot'; })[0] || queue[queue.length - 1];
        var m = compileOne(t, probe.pass), wp = m && glProgram(m);
        if (!wp || !wp.program) return;
        var fsrc = gl.getShaderSource(wp.fragmentShader) || '', vsrc = gl.getShaderSource(wp.vertexShader) || '', body = ps.assemble(probe.pass, glsl);
        if (fsrc.slice(-body.length) !== body) return;
        var prefix = fsrc.slice(0, fsrc.length - body.length);
        var probeDefs = JSON.stringify(definesFor(t, probe.pass));
        queue.forEach(function (j) {
          if (j.pass === probe.pass || JSON.stringify(definesFor(t, j.pass)) !== probeDefs) return;   // 宏不同（如 final 的 ACES）前缀就不同
          var key = t + '.' + j.pass;
          if (warm[key]) return;                                    // 同一档重复排队：已经在编了
          var v = gl.createShader(gl.VERTEX_SHADER), f = gl.createShader(gl.FRAGMENT_SHADER), p = gl.createProgram();
          gl.shaderSource(v, vsrc); gl.compileShader(v);
          gl.shaderSource(f, prefix + ps.assemble(j.pass, glsl)); gl.compileShader(f);
          gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
          warm[key] = { p: p, v: v, f: f };
        });
      } catch (e) { /* 预编译只是提速，出错就算了 */ }
    }
    /* 预编的原生程序一律等它在后台链接完再删（E 路改正）：链接中途 deleteProgram，Chrome 过一会儿会异步报
     * GL_INVALID_VALUE（glGetProgramiv: Program object expected），换档时 gl.getError() 随机读到 0x501。
     * 轮询用尽（同步跑帧）或换档撤销时先放进 grave，之后每次 compileNext／run 顺手扫一遍，链接完的才删。 */
    var grave = [];
    function sweep(force) {
      if (!grave.length) return;
      grave = grave.filter(function (w) {
        if (!force && !gl.getProgramParameter(w.p, parExt.COMPLETION_STATUS_KHR)) return true;
        try {
          gl.getProgramParameter(w.p, gl.LINK_STATUS);               // 让驱动把链接结果收下（进程序缓存）
          gl.deleteProgram(w.p); gl.deleteShader(w.v); gl.deleteShader(w.f);
        } catch (e) { /* 忽略 */ }
        return false;
      });
    }
    function warmDone(key, force) {
      var w = warm[key]; if (!w) return true;
      if (!force && !gl.getProgramParameter(w.p, parExt.COMPLETION_STATUS_KHR)) return false;
      delete warm[key];
      grave.push(w); sweep(false);
      return true;
    }
    function dropWarm() { for (var k in warm) grave.push(warm[k]); warm = {}; if (live && parExt) sweep(false); }
    // 同步跑帧（app.settle、测试）时回不到事件循环，COMPLETION_STATUS 一直不变：轮询几次后改为阻塞等待，保证有进展
    var POLL_MAX = 4;
    g.compileNext = function () {
      if (!live || g.disposed) return false;
      if (grave.length) sweep(false);
      if (waiting) {
        var st = linkState(waiting.mat, ++waiting.polls > POLL_MAX);
        if (st === false) return true;
        if (st !== true) { failJob(waiting, st.error); waiting = null; return queue.length > 0; }
        waiting = null; compiledTotal++;
      }
      var job = queue[0];
      if (!job) {
        if (pendingTier && pendingTier !== g.tier) switchTier(pendingTier);
        pendingTier = null;
        dropWarm();
        return false;
      }
      if (mats[job.tier] && mats[job.tier][job.pass]) {                // 预编译时顺手建好的（取前缀的那个小程序）
        queue.shift(); job.mat = mats[job.tier][job.pass]; job.polls = 0;
        if (parExt) { waiting = job; return true; }
        compiledTotal++; return queue.length > 0;
      }
      var wk = job.tier + '.' + job.pass;
      if (warm[wk]) { job.wpolls = (job.wpolls || 0) + 1; if (!warmDone(wk, job.wpolls > POLL_MAX)) return true; }
      queue.shift();
      var m = compileOne(job.tier, job.pass);
      if (!m) { failJob(job, '建材质失败'); return queue.length > 0; }
      job.mat = m; job.polls = 0;
      if (parExt) { waiting = job; return true; }
      var s2 = linkState(m, true);
      if (s2 !== true) failJob(job, s2 && s2.error); else compiledTotal++;
      if (!queue.length && pendingTier && pendingTier !== g.tier) { switchTier(pendingTier); pendingTier = null; }
      return queue.length > 0;
    };
    function failJob(job, msg) {
      var text = '着色器 ' + job.pass + '（' + job.tier + ' 档）编译失败：' + (msg || '原因不明');
      err(text);
      if (mats[job.tier] && mats[job.tier][job.pass]) mats[job.tier][job.pass].dispose();
      (mats[job.tier] || (mats[job.tier] = {}))[job.pass] = false;
      if (job.tier !== g.tier) { queue = queue.filter(function (q) { return q.tier !== job.tier; }); pendingTier = null; dropWarm(); }
      g.failed = text;
    }
    g.compileStatus = function () {
      return { tier: pendingTier || g.tier, pending: queue.length + (waiting ? 1 : 0), done: compiledTotal, total: queueTotal, error: g.failed || '' };
    };
    // 起始档位：全部排队（fp.init 逐个调 compileNext 并报进度）
    queueTier(tier);
    if (!live) { queue = []; queueTotal = 0; }

    g.setTier = function (t) {
      if (!TIERS[t]) return;
      if (t === g.tier && !pendingTier) return;
      if (t === g.tier) { pendingTier = null; queue = []; dropWarm(); return; }   // 撤销后台换档：预编的原生程序一并释放
      pendingTier = t;
      g.failed = '';
      if (!live) { switchTier(t); pendingTier = null; return; }
      queueTier(t);
      if (!queue.length) { switchTier(t); pendingTier = null; }
    };
    function switchTier(t) {
      var old = g.tier;
      g.tier = t;
      if (mats[old] && old !== t) { for (var p in mats[old]) if (mats[old][p]) mats[old][p].dispose(); mats[old] = {}; }
      dyn.setRange(TIER_OPTS[t].res);
      g.scale = dyn.scale;
      if (g.outW) { var sz = ps.internalSize(g.outW, g.outH, g.scale); g.W = sz[0]; g.H = sz[1]; }   // 内部分辨率按新档位的比例
      alloc();
      need.horizon = need.cs = need.taa = true;
      if (g.onTier) g.onTier(t, old);
    }
    // 只重编一个 pass（色调切换等）：当前档位立即重建。别的档位里已建好的同名材质（后台换档时编的）是按旧宏建的，
    // 一并作废；正在后台编的那一档把它重新排进队列（否则编完切过去，色调还是旧的）
    g.recompile = function (pass) {
      if (!live) return;
      for (var t in mats) {
        if (t === g.tier || !mats[t] || mats[t][pass] == null) continue;
        if (waiting && waiting.tier === t && waiting.pass === pass) waiting = null;
        if (mats[t][pass]) mats[t][pass].dispose();
        mats[t][pass] = null;
        if (t === pendingTier && !queue.some(function (q) { return q.tier === t && q.pass === pass; })) { queue.push({ tier: t, pass: pass }); queueTotal++; }
      }
      if (!mats[g.tier] || mats[g.tier][pass] == null) return;
      if (mats[g.tier][pass]) mats[g.tier][pass].dispose();
      mats[g.tier][pass] = null;
      var m = compileOne(g.tier, pass);
      var st = m ? linkState(m, true) : { error: '建材质失败' };
      if (st && st.error) err('着色器 ' + pass + ' 重编失败：' + st.error);
    };

    /* ── 渲染目标（02 第十六节第 3 条） ── */
    function rtType(fmt) {
      if (fmt === 'f32') return THREE.FloatType;
      if (fmt === 'u8') return THREE.UnsignedByteType;
      if (fmt === 'f32lin') return caps.floatLinear ? THREE.FloatType : THREE.HalfFloatType;
      return THREE.HalfFloatType;
    }
    function makeRT(w, h, sp) {
      var filt = sp.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
      if (sp.fmt === 'f32' && filt === THREE.LinearFilter && !caps.floatLinear) filt = THREE.NearestFilter;
      var rt = new THREE.WebGLRenderTarget(w, h, {
        type: rtType(sp.fmt), format: THREE.RGBAFormat, minFilter: filt, magFilter: filt,
        wrapS: sp.wrap === 'repeat' || sp.wrap === 'repeatU' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
        wrapT: sp.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
        depthBuffer: !!sp.depth, stencilBuffer: false, generateMipmaps: false
      });
      rt.texture.generateMipmaps = false;
      rt._hy = { w: w, h: h, fmt: sp.fmt, filter: sp.filter, wrap: sp.wrap, depth: !!sp.depth };
      return rt;
    }
    function sameRT(rt, w, h, sp) { var x = rt && rt._hy; return !!x && x.w === w && x.h === h && x.fmt === sp.fmt && x.depth === !!sp.depth; }
    var FRESH = { tHeight32: 'gen', tHeight: 'gen', tTau: 'lut', tMS: 'lut', tSkyLUT: 'lut', tWorld: 'world', tWeather: 'weather',
      tHorizon: 'horizon', tCloudSh: 'cs', tProbe: 'probe', tSH: 'probe', tTAA: 'taa', tEye: 'eyeClear' };
    function alloc() {
      var specs = ps.targetSpecs(g.tier, g.W || 64, g.H || 36, glsl), T = g.targets, name;
      g.specs = specs;
      for (name in specs) {
        var sp = specs[name], list;
        if (sp.levels) list = sp.levels;
        else { list = []; for (var i = 0; i < sp.count; i++) list.push([sp.w, sp.h]); }
        var cur = T[name] ? (Array.isArray(T[name]) ? T[name] : [T[name]]) : [];
        var keep = cur.length === list.length && list.every(function (s, k) { return sameRT(cur[k], s[0], s[1], sp); });
        if (keep) continue;
        if (!live) { T[name] = sp.levels || sp.count > 1 ? list.map(function () { return null; }) : null; }
        else {
          cur.forEach(function (rt) { if (rt) rt.dispose(); });
          var made = list.map(function (s) { return makeRT(s[0], s[1], sp); });
          T[name] = sp.levels || sp.count > 1 ? made : made[0];
        }
        if (FRESH[name]) { if (FRESH[name] === 'eyeClear') { need.eyeClear = true; need.eyeReset = 3; } else need[FRESH[name]] = true; }
      }
      for (name in T) if (!specs[name]) {
        (Array.isArray(T[name]) ? T[name] : [T[name]]).forEach(function (rt) { if (rt && rt.dispose) rt.dispose(); });
        delete T[name];
      }
      need.taa = true;
      bindStatic();
    }
    function tex(name, i) { var t = g.targets[name]; if (!t) return null; t = Array.isArray(t) ? t[i || 0] : t; return t ? t.texture : null; }
    function rtOf(name, i) { var t = g.targets[name]; if (!t) return null; return Array.isArray(t) ? t[i || 0] : t; }
    function setU(name, v) { if (U && U[name]) U[name].value = v; }
    function setV2(name, x, y) { var u = U && U[name]; if (!u) return; if (u.value && u.value.set) u.value.set(x, y); else u.value = [x, y]; }
    function setV3(name, a) { var u = U && U[name]; if (!u) return; if (u.value && u.value.set) u.value.set(a[0], a[1], a[2]); else u.value = a.slice(); }
    function setV4(u, a) { if (!u) return; if (u.value && u.value.set) u.value.set(a[0], a[1], a[2], a[3]); else u.value = a.slice(); }
    // 不随帧变的 sampler 与尺寸
    function bindStatic() {
      if (!U) return;
      setU('uHeight', tex('tHeight')); setU('uTau', tex('tTau')); setU('uMS', tex('tMS')); setU('uSkyLUT', tex('tSkyLUT'));
      setU('uFoot', tex('tFoot')); setU('uHorizon', tex('tHorizon')); setU('uCloudSh', tex('tCloudSh')); setU('uWeather', tex('tWeather'));
      setU('uWorld', worldFallback && ps.isStub('bake_world', glsl) ? worldFallback : tex('tWorld'));
      setU('uTerC', tex('tTerC')); setU('uTerG', tex('tTerG')); setU('uSurf', tex('tSurf')); setU('uNear', tex('tNear')); setU('uFar', tex('tFar'));
      setU('uProbe', tex('tProbe')); setU('uMeter', tex('tMeter')); setU('uSH', tex('tSH', shCur));
      setU('uNoise3', noiseTex.n64); setU('uNoise3D', noiseTex.n32);
      var sp = g.specs || {};
      setV2('uTauSize', sp.tTau ? sp.tTau.w : 256, sp.tTau ? sp.tTau.h : 128);
      setV2('uNearRes', sp.tNear ? sp.tNear.w : 1, sp.tNear ? sp.tNear.h : 1);
      setV2('uFarRes', sp.tFar ? sp.tFar.w : 1, sp.tFar ? sp.tFar.h : 1);
      setV2('uOutRes', g.outW || 1, g.outH || 1);
      setU('uInstNear', 1.0e-4); setU('uInstFar', 3.0);
    }
    // 世界底图还是桩时（F 路未交付）：用灰色反照率 0.18 的 1×1 纹理顶替，免得对面世界全黑
    if (live && ps.isStub('bake_world', glsl)) {
      worldFallback = new THREE.DataTexture(new Uint8Array([46, 45, 42, 0]), 1, 1, THREE.RGBAFormat);
      worldFallback.needsUpdate = true;
    }

    g.resize = function (w, h) {
      w = Math.max(1, Math.round(w || 1)); h = Math.max(1, Math.round(h || 1));
      g.outW = w; g.outH = h;
      var s = ps.internalSize(w, h, g.scale);
      if (s[0] !== g.W || s[1] !== g.H || !g.specs) { g.W = s[0]; g.H = s[1]; alloc(); }
      setV2('uOutRes', w, h);
    };
    function setScale(sc) {
      g.scale = sc;
      if (!g.outW) return;
      var s = ps.internalSize(g.outW, g.outH, sc);
      if (s[0] !== g.W || s[1] !== g.H) { g.W = s[0]; g.H = s[1]; alloc(); }
    }
    g.autoRes = function (dtReal, on) {
      dyn.enabled = !!on;
      if (!on) { if (g.scale !== TIER_OPTS[g.tier].res[1]) { dyn.scale = TIER_OPTS[g.tier].res[1]; setScale(dyn.scale); } return { changed: false, down: false, up: false }; }
      var r = dyn.update(dtReal);
      if (r.changed) setScale(r.scale);
      return r;
    };
    g.dyn = dyn;

    // 外部改了状态：settings.apply 的标志
    g.invalidate = function (f) {
      if (!f) return;
      if (f.lut) need.lut = true;
      if (f.weather) need.weather = true;
      if (f.world) need.world = true;
      if (f.horizon) need.horizon = true;
      if (f.reset) { need.taa = true; need.probe = true; }
      if (f.recam) { need.horizon = true; need.cs = true; }
    };
    // what：'taa'（历史清零）| 'eye'（眼直接跳到新亮度）| 'probe' | 'ground'（地平线角图与云影全部失效）| 'all'
    g.reset = function (what) {
      if (what === 'taa' || what === 'all' || what === 'jump') need.taa = true;
      if (what === 'eye' || what === 'all' || what === 'jump') need.eyeReset = Math.max(need.eyeReset, 3);
      if (what === 'probe' || what === 'all' || what === 'jump') need.probe = true;
      if (what === 'ground' || what === 'all') { need.horizon = true; need.cs = true; need.taa = true; }
    };

    /* ── 三维噪声（F 路 HY.fp.noise.gen3D 的结果） ── */
    g.setNoise = function (d64, d32) {
      if (!live) return;
      function mk(data, n) {
        var t = new THREE.DataTexture3D(data, n, n, n);
        t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
        t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true;
        return t;
      }
      if (d64) { if (noiseTex.n64) noiseTex.n64.dispose(); noiseTex.n64 = mk(d64, Math.round(Math.cbrt(d64.length / 4))); }
      if (d32) { if (noiseTex.n32) noiseTex.n32.dispose(); noiseTex.n32 = mk(d32, Math.round(Math.cbrt(d32.length / 4))); }
      setU('uNoise3', noiseTex.n64); setU('uNoise3D', noiseTex.n32);
      need.weather = true; need.cs = true; need.probe = true; need.taa = true;
    };

    /* ── GPU 计时（EXT_disjoint_timer_query_webgl2，每 4 帧量一轮） ── */
    if (live && caps.timer) {
      var tqx = R.extensions.get('EXT_disjoint_timer_query_webgl2');
      if (tqx) timing = { ext: tqx, pool: [], flight: [], res: {}, on: false, cur: null };
    }
    function tBegin(name) {
      if (!timing || !timing.on || timing.cur) return;
      var q = timing.pool.pop() || gl.createQuery();
      gl.beginQuery(timing.ext.TIME_ELAPSED_EXT, q);
      timing.cur = { q: q, name: name };
    }
    function tEnd() {
      if (!timing || !timing.cur) return;
      gl.endQuery(timing.ext.TIME_ELAPSED_EXT);
      timing.flight.push(timing.cur); timing.cur = null;
    }
    function tPoll() {
      if (!timing) return;
      var disjoint = gl.getParameter(timing.ext.GPU_DISJOINT_EXT), acc = {}, k;
      while (timing.flight.length) {
        var f = timing.flight[0];
        if (!gl.getQueryParameter(f.q, gl.QUERY_RESULT_AVAILABLE)) break;
        var ns = gl.getQueryParameter(f.q, gl.QUERY_RESULT);
        timing.flight.shift(); timing.pool.push(f.q);
        if (!disjoint) acc[f.name] = (acc[f.name] || 0) + ns / 1e6;
      }
      for (k in acc) timing.res[k] = timing.res[k] == null ? acc[k] : 0.8 * timing.res[k] + 0.2 * acc[k];
      if (timing.flight.length > 256) { timing.flight.forEach(function (f) { gl.deleteQuery(f.q); }); timing.flight = []; }
    }
    g.gpuTimes = function () { var o2 = {}; if (timing) for (var k in timing.res) o2[k] = Math.round(timing.res[k] * 1000) / 1000; return o2; };

    /* ── 执行一个全屏 pass ── */
    var VP = live ? new THREE.Vector4() : null;
    // rt：渲染目标，或 'screen'（画布，只给 final）；目标还没建好（null）时不画——绝不误画到画布上
    function exec(pass, rt, opt) {
      opt = opt || {};
      g.lastPlan.push(opt.tag != null ? pass + '#' + opt.tag : pass);
      if (!live) return;
      var screen = rt === 'screen';
      if (!rt) return;
      if (screen) rt = null;
      var m = matOf(g.tier, pass, false);
      if (!m) { if (mats[g.tier] && mats[g.tier][pass] === false) return; m = compileOne(g.tier, pass); if (!m) return; }
      var w = opt.w || (rt ? rt.width : g.outW), h = opt.h || (rt ? rt.height : g.outH);
      setV2('uRes', w, h);
      fs.mesh.material = m; m.uniformsNeedUpdate = true;
      if (rt && opt.viewport) {
        rt.viewport.set(opt.viewport[0], opt.viewport[1], opt.viewport[2], opt.viewport[3]);
        rt.scissor.copy(rt.viewport); rt.scissorTest = true;
      }
      tBegin(pass);
      R.setRenderTarget(rt || null);
      if (!rt) { R.setViewport(0, 0, g.outW, g.outH); R.setScissorTest(false); }
      R.render(fs.scene, fs.cam);
      tEnd();
      if (rt && opt.viewport) { rt.viewport.set(0, 0, rt.width, rt.height); rt.scissor.set(0, 0, rt.width, rt.height); rt.scissorTest = false; }
    }
    // 清成给定值：clearBufferfv 不经过 three 的清屏色（不动全局状态），浮点目标不夹到 [0,1]
    var CLR = new Float32Array(4);
    function clearRT(rt, v) {
      if (!live || !rt) return;
      R.setRenderTarget(rt);
      CLR[0] = v[0]; CLR[1] = v[1]; CLR[2] = v[2]; CLR[3] = v[3];
      gl.clearBufferfv(gl.COLOR, 0, CLR);
    }
    // 眼的初值：La＝1000 cd/m²，曝光＝key/La＝0.18/kn，照明色中性
    var EYE0 = [0.18, 1000, 0, 1365 * 4096 + 1365];

    function hzUpdate(c) {
      var n = o().hzLevels, i, L;
      for (i = 0; i < 3; i++) {
        L = hz[i]; var u = U && U.uHzLvl ? U.uHzLvl.value[i] : null;
        var v = (L && L.valid && i < n) ? [L.c[0] - c[0], L.c[1] - c[1], ps.HZ_HALF[i], 1] : [0, 0, ps.HZ_HALF[i], 0];
        if (u) { if (u.set) u.set(v[0], v[1], v[2], v[3]); else { u[0] = v[0]; u[1] = v[1]; u[2] = v[2]; u[3] = v[3]; } }
      }
    }

    g.run = function (fi) {
      fi = fi || {};
      g.lastPlan = [];
      if (g.lost || g.disposed) return;
      if (!g.specs) g.resize(g.outW || 640, g.outH || 360);
      var op = o(), c = fi.chart || [0, 0], i;
      g.frame++;
      if (timing) { tPoll(); timing.on = g.frame % 4 === 0; }
      if (grave.length && live && parExt) sweep(false);                // 预编程序：链接完的才删（见 sweep）
      // 图表坐标断了（瞬移、换地面模式、R_ref 变）：地平线角图与云影全部失效
      if (fi.chartKey != null && fi.chartKey !== chartKey) { chartKey = fi.chartKey; need.horizon = true; need.cs = true; }
      if (need.horizon) { hz = [null, null, null]; need.horizon = false; }
      if (need.taa) { taaN = 0; need.taa = false; }
      taaN++;
      // 每帧的 pass 写入方 uniform
      jitPrev[0] = jit[0]; jitPrev[1] = jit[1];
      ps.jitter(g.frame, jit);
      if (U) {
        setU('uFrame', g.frame & 0x7fffffff);
        setV2('uJitter', jit[0], jit[1]); setV2('uPrevJitter', taaN > 1 ? jitPrev[0] : jit[0], taaN > 1 ? jitPrev[1] : jit[1]);
        setU('uExpoRatio', 1);
        // 雨丝、余息飘尘按真实时间动：画着的时候不算“静止”，不做拍照累积（否则雨丝被累积成一层雾）
        var rk0 = fi.rainK, falling = !!(op.rain && rk0 && (rk0[0] > 0.001 || rk0[1] > 0.001));
        setU('uBlend', ps.taaAlpha(taaN, (fi.dtSim || 0) * 86400, !!fi.still && !falling, op.accum));
        var pixF = 2 * (U.uTanHalfFov ? U.uTanHalfFov.value : 0.5) / Math.max(g.H, 1);
        setU('uPixF', pixF); setU('uPixC', 4 * pixF);
        if (fi.sunDir) setV3('uSunDirScr', fi.sunDir);
        if (fi.cat && U.uCAT) { var M = fi.cat, cu = U.uCAT; if (cu.value && cu.value.set) cu.value.set(M[0], M[1], M[2], M[3], M[4], M[5], M[6], M[7], M[8]); else cu.value = M.slice(); }
        setV2('uOutRes', g.outW || 1, g.outH || 1);
      }
      var T = g.targets;

      // ---- 一次性／改参数 ----
      if (need.eyeClear) { clearRT(rtOf('tEye', 0), EYE0); clearRT(rtOf('tEye', 1), EYE0); need.eyeClear = false; }
      if (need.gen) {
        exec('gen_height', rtOf('tHeight32'));
        setU('uHeight', tex('tHeight32'));                      // gen_height_d 读 uHeight（＝tHeight32），写 tHeight
        exec('gen_height_d', rtOf('tHeight'));
        setU('uHeight', tex('tHeight'));
        need.gen = false; need.horizon = false; hz = [null, null, null];
      }
      if (need.lut) { exec('lut_tau', rtOf('tTau')); exec('lut_ms', rtOf('tMS')); exec('lut_sky', rtOf('tSkyLUT')); need.lut = false; need.probe = true; }
      if (need.world) {
        if (!ps.isStub('bake_world', glsl)) { exec('bake_world', rtOf('tWorld')); setU('uWorld', tex('tWorld')); }
        else if (worldFallback) setU('uWorld', worldFallback);
        need.world = false;
      }
      if (need.weather || (fi.bakeHour != null && fi.bakeHour !== lastBakeHour)) {
        var pw = privFor('bake_weather');
        if (pw.uBakeTime) pw.uBakeTime.value = fi.bakeTime || 0;
        exec('bake_weather', rtOf('tWeather'));
        lastBakeHour = fi.bakeHour; need.weather = false;
      }

      // ---- 脚下、地平线角图、云影 ----
      exec('foot', rtOf('tFoot'));
      hzUpdate(c);
      var hzN = o().hzLevels, lvl = ps.hzDue(hz, hzN, c, fi.sunAz || 0);
      if (lvl >= 0) {
        hz[lvl] = { valid: true, c: [c[0], c[1]], az: fi.sunAz || 0 };
        hzUpdate(c);
        var ph = privFor('horizon'); if (ph.uLvl) ph.uLvl.value = lvl;
        var hs = g.specs && g.specs.tHorizon ? g.specs.tHorizon.w : 256;
        exec('horizon', rtOf('tHorizon'), { tag: lvl, viewport: [0, lvl * hs, hs, hs], w: hs, h: 3 * hs });
      }
      if (need.cs || g.frame % op.csEvery === 0) { cs.c = [c[0], c[1]]; cs.valid = true; need.cs = false; csSet(c, op); exec('cloud_shadow', rtOf('tCloudSh')); }
      else csSet(c, op);

      // ---- 探针与球谐（乒乓；重置时清零并连迭代 3 轮） ----
      var probeRounds = 0;
      if (need.probe) { clearRT(rtOf('tSH', 0), [0, 0, 0, 0]); clearRT(rtOf('tSH', 1), [0, 0, 0, 0]); probeRounds = 3; need.probe = false; }
      else if (g.frame % op.probeEvery === 0) probeRounds = 1;
      for (i = 0; i < probeRounds; i++) {
        setU('uSH', tex('tSH', shCur));
        exec('probe', rtOf('tProbe'), { tag: i });
        exec('sh', rtOf('tSH', 1 - shCur), { tag: i });
        shCur = 1 - shCur;
      }
      setU('uSH', tex('tSH', shCur));

      // ---- 地形与实例 ----
      exec('terrain_coarse', rtOf('tTerC'));
      if (DEFS.terrain_g) exec('terrain_g', rtOf('tTerG'));          // F 路：地形求交单独一个 pass（fp/instances.js 登记），terrain 只着色
      exec('terrain', rtOf('tSurf'));
      if (fp.inst && !fp.inst.__stub && typeof fp.inst.draw === 'function') {
        g.lastPlan.push('inst');
        if (live) { try { fp.inst.draw(rtOf('tSurf')); } catch (e) { err('实例层出错：' + (e && e.message || e)); } }
      }

      // ---- 体积、合成 ----
      exec('near', rtOf('tNear'));
      exec('far', rtOf('tFar'));
      var eA = eyeCur, eB = 1 - eyeCur;
      setU('uExpTex', tex('tEye', eA));
      exec('composite', rtOf('tHDR'));
      var rk = fi.rainK;
      if (op.rain && rk && (rk[0] > 0.001 || rk[1] > 0.001 || rk[3] > 0.5)) {   // clouds 路：w＝可能下雨（雨量由 rain.frag 读云影图）
        var pr = privFor('rain'); setV4(pr.uRainK, rk);
        exec('rain', rtOf('tHDR'));
      }

      // ---- 人眼 ----
      var tCur = taaCur, tPrev = 1 - taaCur;
      setU('uCur', tex('tHDR')); setU('uHist', tex('tTAA', tPrev));
      setU('uEye', tex('tEye', eA)); setU('uEyePrev', tex('tEye', eB));
      exec('taa', rtOf('tTAA', tCur));
      setU('uHDR', tex('tTAA', tCur));
      exec('meter', rtOf('tMeter'));
      var pe = privFor('eye');
      setV4(pe.uEyeCtl, [Math.max(fi.dtReal || 0, 0), need.eyeReset > 0 ? 1 : 0, Math.abs(fi.dtSim || 0) * 86400, falling ? 1 : 0]);   // eye 路：z 模拟秒步长（快进时眼跟上）、w 雨丝在画（TAA 照样静止累积）
      if (need.eyeReset > 0) need.eyeReset--;
      setU('uEyePrev', tex('tEye', eA));
      exec('eye', rtOf('tEye', eB));
      // 眩光金字塔
      var levels = (T.tBloom || []).length, pd = privFor('bloom_down'), pu = privFor('bloom_up');
      for (i = 0; i < levels; i++) {
        setU('uCur', i === 0 ? tex('tTAA', tCur) : tex('tBloom', i - 1));
        if (pd.uLevel) pd.uLevel.value = i;
        exec('bloom_down', rtOf('tBloom', i), { tag: i });
      }
      if (pu.uUpW) pu.uUpW.value = 1;
      for (i = levels - 2; i >= 0; i--) {
        setU('uCur', tex('tBloom', i + 1));
        exec('bloom_up', rtOf('tBloom', i), { tag: i });
      }
      setU('uBloom', tex('tBloom', 0));
      // 最终：uEye＝新曝光（B），uEyePrev＝合成时用的（A）
      setU('uHDR', tex('tTAA', tCur)); setU('uEye', tex('tEye', eB)); setU('uEyePrev', tex('tEye', eA));
      if (!fi.skipFinal) exec('final', 'screen');
      // 交换
      eyeCur = eB; taaCur = 1 - taaCur;
      setU('uExpTex', tex('tEye', eyeCur));
      if (live && timing && timing.cur) tEnd();
    };
    function csSet(c, op) {
      var u = U && U.uCsInfo; if (!u) return;
      var v = [cs.c[0] - c[0], cs.c[1] - c[1], op.csHalf];
      if (u.value && u.value.set) u.value.set(v[0], v[1], v[2]); else u.value = v;
    }

    /* ── 读回 ── */
    // 眼的 2×1 异步读回（PBO＋fence，不卡帧）；pollEye() 拿到时返回 Float32Array(8)：
    //   [0] 曝光（每 kn）[1] 适应亮度 cd/m² [2] 到眼日照 klux [3] 照明色度（打包）[4] 水平面照度 klux [5] 其中直射 [6] 测光目标 cd/m²
    g.readEyeAsync = function () {
      if (!live || eyeRead || g.lost) return false;
      var rt = rtOf('tEye', eyeCur); if (!rt) return false;
      try {
        R.setRenderTarget(rt);
        var buf = g._pbo || (g._pbo = gl.createBuffer());
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 32, gl.STREAM_READ);
        gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.FLOAT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        var sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        eyeRead = { sync: sync, buf: buf };
        return true;
      } catch (e) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); eyeRead = null; return false; }
    };
    g.pollEye = function () {
      if (!eyeRead) return null;
      var st = gl.getSyncParameter(eyeRead.sync, gl.SYNC_STATUS);
      if (st !== gl.SIGNALED) return null;
      gl.deleteSync(eyeRead.sync);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, eyeRead.buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, eyeOut);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      eyeRead = null;
      return eyeOut;
    };
    // 同步读（测试用）：rt 的一个像素
    function readSync(rt, x, y) {
      R.setRenderTarget(rt);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, pxBuf);
      return [pxBuf[0], pxBuf[1], pxBuf[2], pxBuf[3]];
    }
    // fx, fy ∈ [0,1]，原点在左下（与 A 原型的 readPx 相同）；返回本帧 tHDR 的像素与合成时用的曝光
    g.readPx = function (fx, fy) {
      if (!live || g.lost) return null;
      var rt = rtOf('tHDR'); if (!rt) return null;
      var x = Math.max(0, Math.min(rt.width - 1, Math.round(fx * (rt.width - 1)))), y = Math.max(0, Math.min(rt.height - 1, Math.round(fy * (rt.height - 1))));
      var px = readSync(rt, x, y);
      var e = readSync(rtOf('tEye', 1 - eyeCur), 0, 0);       // 合成时用的那张（交换前的 A）
      return { rgb: [px[0], px[1], px[2]], dist: px[3], expo: e[0] };
    };
    g.readEyeSync = function () {
      if (!live || g.lost) return null;
      var a = readSync(rtOf('tEye', eyeCur), 0, 0), b = readSync(rtOf('tEye', eyeCur), 1, 0);
      return a.concat(b);
    };
    // 读任意目标的一个纹素（调试与浏览器验收用）：name、序号、像素坐标；8 位目标按 0–1 返回
    g.readTexel = function (name, i, x, y) { var r = g.readRegion(name, i, x | 0, y | 0, 1, 1); return r ? [r[0], r[1], r[2], r[3]] : null; };
    // 读一块（同步，测试用）：返回 Float32Array(w·h·4)
    g.readRegion = function (name, i, x, y, w, h) {
      var rt = rtOf(name, i); if (!live || !rt || g.lost) return null;
      R.setRenderTarget(rt);
      if (rt.texture.type === THREE.UnsignedByteType) {
        var b8 = new Uint8Array(w * h * 4), o = new Float32Array(w * h * 4);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b8);
        for (var k = 0; k < o.length; k++) o[k] = b8[k] / 255;
        return o;
      }
      var f = new Float32Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, f);
      return f;
    };

    g.contextLost = function () { g.lost = true; eyeRead = null; warm = {}; grave = []; if (timing) { timing.flight = []; timing.pool = []; timing.cur = null; } };
    g.dispose = function () {
      g.disposed = true;
      if (live && !g.lost && parExt) { dropWarm(); sweep(true); }
      var t, p;
      for (t in mats) for (p in mats[t]) if (mats[t][p]) mats[t][p].dispose();
      mats = {};
      for (t in g.targets) (Array.isArray(g.targets[t]) ? g.targets[t] : [g.targets[t]]).forEach(function (rt) { if (rt && rt.dispose) rt.dispose(); });
      g.targets = {};
      if (fs) { fs.geo.dispose(); fs = null; }
      if (worldFallback) { worldFallback.dispose(); worldFallback = null; }
      if (noiseTex.n64) noiseTex.n64.dispose(); if (noiseTex.n32) noiseTex.n32.dispose();
      noiseTex = { n64: null, n32: null };
      if (live && g._pbo && !g.lost) { try { gl.deleteBuffer(g._pbo); } catch (e) { /* 忽略 */ } }
      if (timing && !g.lost) { timing.pool.concat(timing.flight.map(function (f) { return f.q; })).forEach(function (q) { try { gl.deleteQuery(q); } catch (e) { /* 忽略 */ } }); }
      timing = null;
    };
    g.need = need;                                    // 调试与测试用（只读约定）
    g.state = function () { return { eyeCur: eyeCur, taaCur: taaCur, shCur: shCur, taaN: taaN, hz: hz.map(function (L) { return L ? { c: L.c.slice(), az: L.az } : null; }), cs: cs.c.slice() }; };
    return g;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
