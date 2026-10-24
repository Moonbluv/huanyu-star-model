/* HY.fp.UNIFORMS / PRIVATE —— 第一人称全部 uniform 的唯一声明表（规格：spec/03 第七节第 2 条、spec/02 第六节）
 * 契约表之一（M1）。每行 [名, 类型, 默认, 写入方]：
 *   类型：'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat3' | 'sampler2D' | 'sampler3D'，数组写 'vec2[7]'、'vec4[3]'
 *   写入方：'cam'（fp/camera）| 'cel'（fp/celestial）| 'set'（fp/settings）| 'pass'（fp/passes：分辨率、抖动、全部 sampler）
 *           | 'inst'（fp/instances 自己的）
 *   mat3 的默认按“行优先”9 个数写（与 THREE.Matrix3.set 的参数顺序相同）。
 * PRIVATE[pass] 只在那一个 pass 的主文件里声明、由 passes 写：每行 [名, 类型, 默认]。
 * 其他路要加 uniform：在自己的文件里调 HY.fp.registerUniforms(rows) / HY.fp.registerPrivate(pass, rows)，不要改本文件。
 * 节点可测：不引用 THREE（makeU 接收 THREE 作参数；传 null 得到纯数组值，供 node 测试）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};

  var I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  var WRITERS = ['cam', 'cel', 'set', 'pass', 'inst'];
  var TYPES = ['float', 'int', 'vec2', 'vec3', 'vec4', 'mat3', 'sampler2D', 'sampler3D'];

  // 默认值按“罪域、阶地、中档、D1 夜”的量级给，只为首帧前有合法数；各写入方每帧／每次状态变化覆盖
  var UNIFORMS = [
    /* ── cam：fp/camera.js（双精度相机、图表、地面求交参数、上一帧量） ── */
    ['uCamW', 'vec3', [5516.0, -3187.0, 0.0], 'cam'],       // 相机（CM 系，fround）
    ['uCamK', 'float', -20.39, 'cam'],                       // |C|²−R²（双精度算）
    ['uCamZ', 'float', 0.0016, 'cam'],                       // 离壁高度 km
    ['uCamRho', 'float', 5516.0, 'cam'],                     // 离塔轴
    ['uCamFwd', 'vec3', [-0.258819, -0.965926, 0.0], 'cam'],
    ['uCamRight', 'vec3', [0.0, 0.0, -1.0], 'cam'],
    ['uCamUp', 'vec3', [-0.965926, 0.258819, 0.0], 'cam'],
    ['uTanHalfFov', 'float', 0.520567, 'cam'],
    ['uLamCam', 'float', 0.0, 'cam'],                        // 相机地固经度 φ_C
    ['uOrg', 'vec2[7]', null, 'cam'],                        // 各层图表原点（CPU 取模）
    ['uRref', 'float', 5516.0, 'cam'],                       // 图表东向比例半径（瞬移时定）
    ['uTerF0', 'float', 0.0, 'cam'],                         // 相机处阶地相位小数
    ['uRsC', 'float', 5517.0, 'cam'],                        // ρ_s(y_C)
    ['uCamAlt', 'float', 0.0016, 'cam'],                     // 相机离地（阶地 eye；斜坡 eye·sinψ）
    ['uHc', 'float', 0.87, 'cam'],                           // 相机处崖高 km
    ['uLip', 'float', 0.3, 'cam'],                           // 细层位移坡度上界
    ['uClearMax', 'float', 2.5, 'cam'],                      // 地形高出宏观球面的上界 km
    ['uAmpZone', 'float', 1.25, 'cam'],                      // 相机所在域的起伏系数
    ['uPrevPos', 'vec3', [0, 0, 0], 'cam'],                  // 上一帧相机（本帧 CM 系）
    ['uPrevBasisT', 'mat3', I3, 'cam'],                      // 上一帧相机基的转置（本帧 CM 系）
    ['uCM2W', 'mat3', I3, 'cam'],                            // CM → 地固（云噪声随地面固定）
    ['uStrataC', 'float', 0.0, 'cam'],                       // fract(ρ_C/0.045)，层理不随行走滑动

    /* ── cel：fp/celestial.js（日月位置、光度、月体系、罪域方向） ── */
    ['uSunW', 'vec3', [-640.0, 0.0, 0.0], 'cel'],
    ['uSunRho', 'float', 20.0, 'cel'],
    ['uSunI', 'vec3', [2.593e9, 2.297e9, 2.158e9], 'cel'],  // klux·km²：Eref·Dref²·日色/1000
    ['uMoonW', 'vec3', [3185.5, 0.0, 0.0], 'cel'],
    ['uMoonRho', 'float', 100.0, 'cel'],
    ['uMoonAlb', 'float', 0.72, 'cel'],                      // pMoon/(0.5+0.5·2/3)/⟨月海均值⟩
    ['uMoonBasis', 'mat3', I3, 'cel'],
    ['uMoonE0', 'vec3', [0, 0, 0], 'cel'],                   // 相机处大气外、未乘塔挡的月光照度 klux
    ['uMoonD2', 'float', 1.0e7, 'cel'],                      // 相机到月心距离²
    ['uMoonAir', 'float', 0.0, 'cel'],                       // 1：空气样本计月光（开暗幕或高档）
    ['uRuiDir', 'vec3', [0.866, -0.5, 0.0], 'cel'],          // 罪域中心方向（CM 单位向量）
    ['uRuiRad', 'float', 900.0, 'cel'],                      // 罪域阴云半径 km（沿地面）

    /* ── set：fp/settings.js（state.fp.*、zones、astro → uniform；uYuxi、uWind、uJetPhase 每帧） ── */
    ['uR', 'float', 6371.0, 'set'],
    ['uA', 'float', 600.0, 'set'],
    ['uZtop', 'float', 400.0, 'set'],                        // min(10·max(HR,HM), 800)
    ['uAtmoOn', 'float', 1.0, 'set'],
    ['uBetaR', 'vec3', [5.802e-3, 13.558e-3, 33.1e-3], 'set'],
    ['uBetaMs', 'float', 0.0054, 'set'],                     // (3.912/V − βR,绿)·0.9
    ['uBetaMa', 'float', 0.0006, 'set'],
    ['uHR', 'float', 40.0, 'set'],
    ['uHM', 'float', 6.0, 'set'],
    ['uMieG', 'float', 0.76, 'set'],
    ['uVeilK', 'float', 0.0, 'set'],                         // /km；＝fp.set.veil ? fp.set.veilK/1000 : 0
    ['uRainBeta', 'float', 0.03, 'set'],
    ['uAcid', 'vec4', [0.02, 0.8, 1.5, 0.0], 'set'],         // x 消光 y 单次反照 z 标高 w 开关
    ['uAcidTint', 'vec3', [1.0, 0.86, 0.52], 'set'],
    ['uYuxi', 'vec4', [0.0, 1500.0, 3.0, 300.0], 'set'],     // x 消光 y 前锋 s z 标高 w 前锋宽（每帧按日期）
    ['uSheath', 'vec2', [0.0, 20.0], 'set'],                 // x 塔面处消光（0＝关）y 标高
    ['uTowerAlb', 'float', 0.0, 'set'],
    ['uGroundMode', 'int', 1, 'set'],                        // 0 斜坡；1 阶地（默认）
    ['uW', 'float', 1.5, 'set'],                             // 踏面宽 km
    ['uCliffC', 'float', 0.07, 'set'],
    ['uResid', 'float', 0.0, 'set'],
    ['uWig', 'float', 0.35, 'set'],
    ['uJit', 'float', 0.07, 'set'],
    ['uAbyssDepth', 'float', 30.0, 'set'],
    ['uAbyssHalf', 'float', 220.0, 'set'],
    ['uLimboKm', 'float', 333.0, 'set'],
    ['uGEq', 'float', 1.4, 'set'],
    ['uGLight', 'float', 0.75, 'set'],
    ['uGHeavy', 'float', 1.2, 'set'],
    ['uWet', 'float', 0.7, 'set'],
    ['uCloudOn', 'float', 1.0, 'set'],
    ['uCloudCov', 'float', 0.42, 'set'],
    ['uCloudBase', 'float', 1.5, 'set'],
    ['uCloudTop', 'float', 6.5, 'set'],
    ['uCloudSigma', 'float', 22.0, 'set'],
    ['uRuiOvc', 'float', 1.0, 'set'],
    ['uRuiBase', 'float', 1.2, 'set'],
    ['uRuiTop', 'float', 6.0, 'set'],
    ['uRuiTau', 'float', 60.0, 'set'],
    ['uWind', 'vec3', [0, 0, 0], 'set'],                     // 每帧：风场偏移（跟随模拟时间）
    ['uJetPhase', 'float', 0.0, 'set'],                      // 每帧：急流差速相位
    ['uGlareK', 'float', 1.0, 'set'],
    ['uPurkinje', 'float', 1.0, 'set'],
    ['uBloomK', 'float', 0.03, 'set'],

    /* ── pass：fp/passes.js（分辨率、抖动、帧号、曝光比、级信息、全部 sampler） ── */
    ['uRes', 'vec2', [1280, 720], 'pass'],                   // 本 pass 的分辨率（每个 pass 前改）
    ['uJitter', 'vec2', [0, 0], 'pass'],                     // 子像素抖动（全分辨率像素）
    ['uPrevJitter', 'vec2', [0, 0], 'pass'],
    ['uFrame', 'int', 0, 'pass'],
    ['uExpoRatio', 'float', 1.0, 'pass'],
    ['uBlend', 'float', 0.1, 'pass'],
    ['uHzLvl', 'vec4[3]', null, 'pass'],                     // 地平线角图 3 级：xy 中心偏移、z 半宽、w 有效
    ['uCsInfo', 'vec3', [0, 0, 150], 'pass'],                // 云影图：xy 中心偏移、z 半宽
    ['uOutRes', 'vec2', [1280, 720], 'pass'],
    ['uSunDirScr', 'vec3', [0, 0, -1], 'pass'],
    ['uCAT', 'mat3', I3, 'pass'],                            // Bradford 色适应矩阵（由 eye 读回算）
    ['uTauSize', 'vec2', [256, 128], 'pass'],
    ['uNearRes', 'vec2', [320, 180], 'pass'],
    ['uFarRes', 'vec2', [640, 360], 'pass'],
    ['uPixC', 'float', 0.0029, 'pass'],                      // 粗像素张角 rad
    ['uPixF', 'float', 0.00072, 'pass'],                     // 精像素张角 rad
    ['uInstNear', 'float', 1.0e-4, 'pass'],                  // 实例相机 near/far（km）
    ['uInstFar', 'float', 3.0, 'pass'],
    ['uTau', 'sampler2D', null, 'pass'],
    ['uMS', 'sampler2D', null, 'pass'],
    ['uSkyLUT', 'sampler2D', null, 'pass'],
    ['uSH', 'sampler2D', null, 'pass'],
    ['uHeight', 'sampler2D', null, 'pass'],
    ['uFoot', 'sampler2D', null, 'pass'],
    ['uHorizon', 'sampler2D', null, 'pass'],
    ['uCloudSh', 'sampler2D', null, 'pass'],
    ['uWorld', 'sampler2D', null, 'pass'],
    ['uWeather', 'sampler2D', null, 'pass'],
    ['uNoise3', 'sampler3D', null, 'pass'],
    ['uNoise3D', 'sampler3D', null, 'pass'],
    ['uTerC', 'sampler2D', null, 'pass'],
    ['uSurf', 'sampler2D', null, 'pass'],
    ['uNear', 'sampler2D', null, 'pass'],
    ['uFar', 'sampler2D', null, 'pass'],
    ['uExpTex', 'sampler2D', null, 'pass'],
    ['uProbe', 'sampler2D', null, 'pass'],
    ['uCur', 'sampler2D', null, 'pass'],
    ['uHist', 'sampler2D', null, 'pass'],
    ['uHDR', 'sampler2D', null, 'pass'],
    ['uBloom', 'sampler2D', null, 'pass'],
    ['uEye', 'sampler2D', null, 'pass'],
    ['uEyePrev', 'sampler2D', null, 'pass']
  ];

  var PRIVATE = {
    lut_ms: [['uGroundAlb', 'float', 0.15]],                 // 多次散射表的地面反照
    horizon: [['uLvl', 'int', 0]],                           // 地平线角图级号
    bake_weather: [['uBakeTime', 'float', 0.0]]              // 模拟小时（天气慢慢演化）
  };

  fp.UNIFORMS = UNIFORMS;
  fp.PRIVATE = PRIVATE;
  fp.WRITERS = WRITERS;
  fp.UTYPES = TYPES;

  /* ───────── 查询 ───────── */
  var index = {};
  function reindex() { index = {}; UNIFORMS.forEach(function (r) { index[r[0]] = r; }); }
  reindex();
  fp.uniformInfo = function (name) {
    var r = index[name];
    if (r) return { name: r[0], type: r[1], def: r[2], writer: r[3] };
    for (var p in PRIVATE) for (var i = 0; i < PRIVATE[p].length; i++) {
      var q = PRIVATE[p][i];
      if (q[0] === name) return { name: q[0], type: q[1], def: q[2], writer: 'pass', pass: p };
    }
    return null;
  };
  fp.uniformsBy = function (writer) { return UNIFORMS.filter(function (r) { return r[3] === writer; }).map(function (r) { return r[0]; }); };
  function baseType(t) { var i = t.indexOf('['); return i < 0 ? t : t.slice(0, i); }
  function arrLen(t) { var m = /\[(\d+)\]$/.exec(t); return m ? +m[1] : 0; }
  fp.baseType = baseType;
  fp.arrLen = arrLen;

  /* ───────── 登记（其他路在自己的文件里追加） ───────── */
  function checkRow(r, needWriter) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !/^u[A-Z0-9]/.test(r[0])) throw new Error('uniform 名须以 u 开头：' + JSON.stringify(r && r[0]));
    if (TYPES.indexOf(baseType(r[1])) < 0) throw new Error('uniform ' + r[0] + ' 类型不认识：' + r[1]);
    if (needWriter && WRITERS.indexOf(r[3]) < 0) throw new Error('uniform ' + r[0] + ' 写入方须为 ' + WRITERS.join('|'));
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  // rows：[[名, 类型, 默认, 写入方], …]；已存在且相同则跳过，不同则抛错
  fp.registerUniforms = function (rows) {
    rows.forEach(function (r) {
      checkRow(r, true);
      var old = index[r[0]];
      if (old) { if (same(old, r)) return; throw new Error('uniform ' + r[0] + ' 已登记且定义不同'); }
      var pv = fp.uniformInfo(r[0]);
      if (pv) throw new Error('uniform ' + r[0] + ' 已是 PRIVATE.' + pv.pass + ' 的私有项');
      UNIFORMS.push(r.slice());
      index[r[0]] = UNIFORMS[UNIFORMS.length - 1];
    });
  };
  // rows：[[名, 类型, 默认], …]
  fp.registerPrivate = function (pass, rows) {
    var list = PRIVATE[pass] = PRIVATE[pass] || [];
    rows.forEach(function (r) {
      checkRow(r, false);
      if (index[r[0]]) throw new Error('uniform ' + r[0] + ' 已在公共表里，不能再作私有');
      for (var i = 0; i < list.length; i++) if (list[i][0] === r[0]) { if (same(list[i], r)) return; throw new Error('PRIVATE.' + pass + '.' + r[0] + ' 定义不同'); }
      list.push(r.slice(0, 3));
    });
  };

  /* ───────── 建 uniform 对象 ───────── */
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function plainDef(type, def) {
    var b = baseType(type), n = arrLen(type), w = { vec2: 2, vec3: 3, vec4: 4, mat3: 9 }[b];
    if (b === 'sampler2D' || b === 'sampler3D') return null;
    if (n) { var out = []; for (var i = 0; i < n; i++) out.push(def && def[i] ? def[i].slice() : zeros(w)); return out; }
    if (w) return def ? def.slice() : (b === 'mat3' ? I3.slice() : zeros(w));
    return def == null ? 0 : def;
  }
  function threeVal(THREE, type, plain) {
    var b = baseType(type), n = arrLen(type);
    function one(v) {
      switch (b) {
        case 'vec2': return new THREE.Vector2(v[0], v[1]);
        case 'vec3': return new THREE.Vector3(v[0], v[1], v[2]);
        case 'vec4': return new THREE.Vector4(v[0], v[1], v[2], v[3]);
        case 'mat3': return new THREE.Matrix3().set(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
        default: return v;
      }
    }
    if (n) return plain.map(one);
    return plain == null ? null : one(plain);
  }
  function build(THREE, rows) {
    var U = {};
    rows.forEach(function (r) {
      var plain = plainDef(r[1], r[2]);
      U[r[0]] = { value: THREE ? threeVal(THREE, r[1], plain) : plain };
    });
    return U;
  }
  // 公共 uniform 对象：所有材质共用同一批 {value}（02 第十六节第 2 条）。THREE 传 null 得到纯数组值（node 测试）
  fp.makeU = function (THREE) { return build(THREE, UNIFORMS); };
  fp.makePrivate = function (THREE, pass) { return build(THREE, PRIVATE[pass] || []); };
  // 某个 pass 的材质用的 uniforms：公共的 {value} 引用＋该 pass 的私有项
  fp.uniformsFor = function (U, priv) {
    var o = {}, k;
    for (k in U) o[k] = U[k];
    if (priv) for (k in priv) o[k] = priv[k];
    return o;
  };

  /* ───────── 写入（写入方唯一） ─────────
   * vals：普通数值对象 { uSunW: [x,y,z], uSunRho: 20, uOrg: [[x,y],…], uMoonBasis: [9 个，行优先] }
   * writer 不是该 uniform 的写入方时抛错（HY.DEV）或告警。返回写了几个。
   */
  fp.apply = function (U, vals, writer) {
    var n = 0;
    for (var name in vals) {
      var r = index[name];
      if (!r) { complain('uniform ' + name + ' 不在 UNIFORMS 表里'); continue; }
      if (writer && r[3] !== writer) { complain('uniform ' + name + ' 的写入方是 ' + r[3] + '，不是 ' + writer); continue; }
      var u = U[name]; if (!u) continue;
      setVal(u, r[1], vals[name]);
      n++;
    }
    return n;
  };
  function complain(msg) { if (HY.DEV) throw new Error(msg); if (G.console) G.console.warn('[HY.fp] ' + msg); }
  function setOne(cur, b, v) {
    if (cur && typeof cur.set === 'function' && Array.isArray(v)) {
      if (b === 'mat3') cur.set(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
      else cur.fromArray(v);
      return cur;
    }
    if (Array.isArray(cur) && Array.isArray(v)) { for (var i = 0; i < v.length; i++) cur[i] = v[i]; return cur; }
    return v;
  }
  function setVal(u, type, v) {
    var b = baseType(type);
    if (arrLen(type)) { for (var i = 0; i < v.length; i++) u.value[i] = setOne(u.value[i], b, v[i]); return; }
    u.value = setOne(u.value, b, v);
  }

  /* ───────── GLSL 里的 uniform 声明（测试与 passes 共用的解析） ───────── */
  // 返回 [{name, type}]；type 带数组长度，如 'vec2[7]'；去掉注释后解析
  fp.parseUniforms = function (src) {
    var s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), out = [];
    var re = /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g, m;
    while ((m = re.exec(s))) {
      m[2].split(',').forEach(function (part) {
        var q = /^\s*(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*$/.exec(part);
        if (q) out.push({ name: q[1], type: m[1] + (q[2] ? '[' + q[2] + ']' : '') });
      });
    }
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
