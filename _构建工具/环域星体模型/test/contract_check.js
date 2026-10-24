#!/usr/bin/env node
/* contract_check —— M1 的契约守卫：HY.fp.UNIFORMS／PRIVATE、HY.fp.passes.DEFS／TIERS 与 src/glsl/ 是否对得上。
 * （03 第十一节的 glsl_check.js 归 E 路；本文件是它的子集，E 路可以把断言并进 glsl_check 后删掉本文件。）
 * 只看第一人称着色器；总览的 ov_* 不在 DEFS 里，不受 UNIFORMS 约束。
 */
'use strict';
const load = require('./_load.js');
// fp/celestial.js 在载入时登记 uVeilComp（sky 修订，04 第三节的注册函数），所以也要载入
const HY = load({ only: ['astro.js', 'core/util.js', 'fp/uniforms.js', 'fp/celestial.js', 'fp/passes.js'] });
const T = load.tester('contract_check');
const { ok, eq, throws, section } = T;
const fp = HY.fp, ps = fp.passes, G = HY.glsl;

section('1 UNIFORMS 表本身');
{
  const names = new Set();
  for (const r of fp.UNIFORMS) {
    ok(r.length === 4, `${r[0]}：每行 [名, 类型, 默认, 写入方]`);
    ok(/^u[A-Z0-9]/.test(r[0]), `${r[0]} 以 u 开头`);
    ok(!names.has(r[0]), `${r[0]} 不重复`); names.add(r[0]);
    ok(fp.UTYPES.includes(fp.baseType(r[1])), `${r[0]} 类型合法：${r[1]}`);
    ok(fp.WRITERS.includes(r[3]), `${r[0]} 写入方合法：${r[3]}`);
    if (/^sampler/.test(r[1])) ok(r[3] === 'pass', `${r[0]}：sampler 一律由 pass 写`);
  }
  for (const [p, rows] of Object.entries(fp.PRIVATE)) for (const r of rows) {
    ok(!names.has(r[0]), `PRIVATE.${p}.${r[0]} 不与公共表重名`);
    ok(r.length === 3 && fp.UTYPES.includes(fp.baseType(r[1])), `PRIVATE.${p}.${r[0]} 形如 [名, 类型, 默认]`);
  }
  // 03 第七节第 2 条点名的写入方必须照办
  const want = {
    cam: 'uCamW uCamK uCamZ uCamRho uCamFwd uCamRight uCamUp uTanHalfFov uLamCam uOrg uRref uTerF0 uRsC uCamAlt uHc uLip uClearMax uAmpZone uPrevPos uPrevBasisT',
    cel: 'uSunW uSunRho uSunI uMoonW uMoonRho uMoonAlb uMoonBasis uMoonE0 uMoonD2 uMoonAir uRuiDir uRuiRad',
    set: 'uR uA uZtop uAtmoOn uBetaR uBetaMs uBetaMa uHR uHM uMieG uVeilK uRainBeta uAcid uAcidTint uYuxi uSheath uTowerAlb uGroundMode uCliffC uResid uWig uJit uAbyssDepth uAbyssHalf uLimboKm uGEq uGLight uGHeavy uWet uCloudOn uCloudBase uCloudTop uCloudSigma uRuiOvc uRuiBase uRuiTop uRuiTau uWind uJetPhase uGlareK uPurkinje uBloomK',
    pass: 'uRes uJitter uPrevJitter uFrame uExpoRatio uBlend uHzLvl uCsInfo uOutRes uSunDirScr uCAT'
  };
  for (const [w, list] of Object.entries(want)) for (const n of list.split(' ')) {
    const info = fp.uniformInfo(n);
    ok(info && info.writer === w, `${n} 的写入方是 ${w}（03 第七节第 2 条）`);
  }
}

section('2 每个 DEFS pass：chunk 齐、次序对、恰一处输出、无 varying、uniform 双向一致');
const declared = new Map();   // 名 → 类型（全部第一人称着色器里出现过的）
{
  const passes = ps.ordered();
  ok(passes.length >= 20, `DEFS 有 ${passes.length} 个 pass`);
  for (const name of passes) {
    const d = ps.DEFS[name];
    let src;
    try { ps.validate(name, d); src = ps.assemble(name, G); } catch (e) { ok(false, `${name}：${e.message}`); continue; }
    const outs = (src.match(/layout\s*\(\s*location\s*=\s*0\s*\)\s*out\b/g) || []).length;
    if (d.kind !== 'mesh') eq(outs, 1, `${name}：恰有一处 layout(location = 0) out`);
    ok(!/\bvarying\b/.test(src.replace(/\/\/.*$/gm, '')), `${name}：不用 varying`);
    const us = fp.parseUniforms(src), seen = new Map();
    const priv = new Map((fp.PRIVATE[name] || []).map(r => [r[0], r[1]]));
    for (const u of us) {
      ok(!seen.has(u.name), `${name}：uniform ${u.name} 只声明一次`);
      seen.set(u.name, u.type);
      declared.set(u.name, u.type);
      const info = fp.uniformInfo(u.name);
      const inPub = info && !info.pass, inPriv = priv.has(u.name);
      ok(inPub || inPriv, `${name}：uniform ${u.name} 在 UNIFORMS 或 PRIVATE.${name} 里`);
      if (inPub) eq(info.type, u.type, `${name}：${u.name} 类型一致`);
      if (inPriv) eq(priv.get(u.name), u.type, `${name}：私有 ${u.name} 类型一致`);
    }
    for (const [pn] of priv) ok(seen.has(pn), `PRIVATE.${name}.${pn} 确实在 ${name} 里声明`);
    if (d.vert) ok(G[d.vert] != null, `${name}：顶点着色器 ${d.vert} 在 HY.glsl 里`);
  }
  for (const r of fp.UNIFORMS) ok(declared.has(r[0]) || r[3] === 'inst', `UNIFORMS 里的 ${r[0]} 至少在一个 pass 里用到`);
  console.log(`  第一人称着色器里共声明 ${declared.size} 个 uniform；UNIFORMS ${fp.UNIFORMS.length} 个，PRIVATE ${Object.values(fp.PRIVATE).reduce((a, b) => a + b.length, 0)} 个`);
}

section('3 TIERS：每档定义全部 Q_* 宏，浮点宏写成带小数点的字符串');
{
  const common = G.common || '';
  const inCommon = (common.match(/#ifndef\s+(\w+)/g) || []).map(s => s.split(/\s+/)[1]);
  ok(inCommon.length >= 11, `common.glsl 里有 ${inCommon.length} 个可覆盖的画质宏`);
  for (const m of inCommon) ok(ps.Q_MACROS.includes(m), `${m} 在 Q_MACROS 里`);
  for (const t of ps.TIER_NAMES) {
    for (const m of ps.Q_MACROS) ok(ps.TIERS[t][m] !== undefined, `${t} 档定义了 ${m}`);
    for (const m of ['Q_CLOUD_KM', 'Q_TER_KM', 'Q_TER_FAR_KM', 'NEAR_SCALE']) ok(/^\d+\.\d+$/.test(String(ps.TIERS[t][m])), `${t}.${m} 写成浮点字面量`);
    ok(ps.TIER_OPTS[t] && ps.TIER_OPTS[t].res.length === 2, `${t} 档有 TIER_OPTS`);
  }
  eq(ps.TIERS.mid.Q_NEAR_N, 14, '中档近段 14 样本（与 common.glsl 默认一致）');
}

section('4 登记函数');
{
  fp.registerUniforms([['uOrgInst', 'vec2', [0, 0], 'inst']]);
  ok(fp.uniformInfo('uOrgInst').writer === 'inst', 'registerUniforms 追加');
  fp.registerUniforms([['uOrgInst', 'vec2', [0, 0], 'inst']]);
  throws(() => fp.registerUniforms([['uOrgInst', 'vec3', [0, 0, 0], 'inst']]), '同名不同定义抛错');
  throws(() => fp.registerUniforms([['oops', 'float', 0, 'set']]), '名字不以 u 开头抛错');
  throws(() => fp.registerUniforms([['uX1', 'float', 0, 'nobody']]), '写入方不认识抛错');
  fp.registerPrivate('meter', [['uMeterK', 'float', 1]]);
  ok(fp.uniformInfo('uMeterK').pass === 'meter', 'registerPrivate 追加');
  throws(() => fp.registerPrivate('meter', [['uSunW', 'vec3', [0, 0, 0]]]), '公共表里的名字不能再作私有');
  ps.addDefs({ test_pass: { chunks: ['common', 'clouds'], main: 'foot', out: 'tX', size: [1, 1], when: 'frame', order: 99 } });
  ok(ps.DEFS.test_pass && ps.assemble('test_pass', G).length > 1000, 'addDefs 追加并能拼接');
  throws(() => ps.addDefs({ test_pass: ps.DEFS.test_pass }), '重名 pass 要 replace 才能覆盖');
  throws(() => ps.addDefs({ bad: { chunks: ['clouds', 'common'], main: 'foot', out: 'x', size: [1, 1] } }), 'chunks 次序违背 CHAIN 抛错');
  ps.addTierDefine('Q_TEST', { low: 1, mid: 2, high: 3, photo: 3 });
  ok(ps.TIERS.mid.Q_TEST === 2 && ps.Q_MACROS.includes('Q_TEST'), 'addTierDefine 追加画质宏');
  ps.addChunk('rain_lib', 'clouds');
  ok(ps.CHAIN.indexOf('rain_lib') === ps.CHAIN.indexOf('clouds') + 1, 'addChunk 插进 CHAIN');
}

section('5 makeU 与写入方唯一');
{
  const U = fp.makeU(null);
  ok(Object.keys(U).length === fp.UNIFORMS.length, 'makeU(null) 建出全部 uniform（纯数组值）');
  ok(Array.isArray(U.uOrg.value) && U.uOrg.value.length === 7 && U.uOrg.value[0].length === 2, 'uOrg 是 7 个 vec2');
  ok(U.uMoonBasis.value.length === 9, 'mat3 是 9 个数');
  eq(fp.apply(U, { uSunW: [1, 2, 3], uSunRho: 21 }, 'cel'), 2, 'apply 按写入方写');
  ok(U.uSunW.value[2] === 3 && U.uSunRho.value === 21, '写入生效');
  HY.DEV = true;
  throws(() => fp.apply(U, { uCamW: [0, 0, 0] }, 'cel'), 'DEV 下写别人的 uniform 抛错');
  HY.DEV = false;
  const P = fp.makePrivate(null, 'horizon');
  ok(P.uLvl && P.uLvl.value === 0, 'makePrivate 建私有项');
  const mat = fp.uniformsFor(U, P);
  ok(mat.uSunW === U.uSunW && mat.uLvl === P.uLvl, 'uniformsFor 共享公共 {value} 引用');
}

T.done();
