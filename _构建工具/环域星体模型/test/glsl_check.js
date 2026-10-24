#!/usr/bin/env node
/* test/glsl_check.js —— 第一人称着色器的静态检查（规格：spec/03 第十一节第 1 条；负责：E 路）
 *
 * 1. DEFS 引用的每个 chunk、主文件都在 HY.glsl；chunks 次序服从 CHAIN；
 * 2. 拼接后的每个全屏片元着色器恰有一处 layout(location = 0) out、没有 varying、没有 #version；括号配平；
 * 3. 所有 uniform 与 UNIFORMS／PRIVATE 双向一致、类型一致、都以 u 开头（载入全部第一人称模块之后：各路的 register* 都已生效）；
 * 4. ov_occl.glsl 的 towerVis、eclipseVis 与 common.glsl 逐字一致（去注释与空白）；
 * 5. TIERS 各档定义了 Q_MACROS 的全部宏，浮点宏写成带小数点的字符串；common.glsl 里 #ifndef 的宏都在 Q_MACROS；
 * 6. E 路自己的约定：后期类只拼 post_common；FAR_SCALE 在 far 与 composite 里一致；cloud_shadow 跟着 uRes 走；
 *    E 路登记的 uniform 都有人声明；settings.values 只写 'set'；每个写入方为 'pass' 的 sampler 都在至少一个 pass 里用到。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('glsl_check');
// 第一人称里不标 node 的脚本（instances、controls、fp）也可能在载入时登记 uniform：试着载一遍（加载时不碰 DOM、THREE 是约定）
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  for (const e of load.manifest().scripts) {
    if (!e.src || e.node || !/^fp\//.test(e.src)) continue;
    try { vm.runInThisContext(fs.readFileSync(path.join(load.SRC, e.src), 'utf8'), { filename: e.src }); }
    catch (err) { console.log('  （' + e.src + ' 在 node 里载不进来：' + err.message + '）'); }
  }
}
const { ok, eq, section } = T;
const fp = HY.fp, ps = fp.passes, G = HY.glsl;

function strip(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }
function squash(s) { return strip(s || '').replace(/\s+/g, ''); }
function fnSrc(src, name) {
  const re = new RegExp('\\b(?:float|vec[234]|void|bool|int|mat[234])\\s+' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) return null;
  let d = 0;
  for (let k = src.indexOf('{', m.index); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(m.index, k + 1); }
  return null;
}

section('1 DEFS 与 HY.glsl');
{
  const passes = ps.ordered();
  ok(passes.length >= 25, `DEFS 有 ${passes.length} 个 pass`);
  for (const n of passes) {
    const d = ps.DEFS[n];
    try { ps.validate(n, d); ok(true, ''); } catch (e) { ok(false, `${n}：${e.message}`); }
    for (const c of d.chunks) ok(G[c] != null, `${n}：chunk ${c} 在 HY.glsl 里`);
    ok(G[d.main] != null, `${n}：主文件 ${d.main} 在 HY.glsl 里`);
    if (d.vert) ok(G[d.vert] != null, `${n}：顶点着色器 ${d.vert} 在 HY.glsl 里`);
    ok(d.chunks.indexOf('post_common') < 0 || d.chunks.length === 1, `${n}：post_common 只能单独拼`);
  }
}

section('2 拼接后的源码');
const declared = new Map();
{
  for (const n of ps.ordered()) {
    const d = ps.DEFS[n];
    let src;
    try { src = ps.assemble(n, G); } catch (e) { ok(false, `${n}：${e.message}`); continue; }
    const s = strip(src);
    if (d.kind !== 'mesh') eq((s.match(/layout\s*\(\s*location\s*=\s*0\s*\)\s*out\b/g) || []).length, 1, `${n}：恰有一处 layout(location = 0) out`);
    ok(!/\bvarying\b/.test(s), `${n}：不用 varying`);
    ok(!/#version/.test(s), `${n}：不写 #version（three 的 GLSL3 会加）`);
    ok((s.match(/\{/g) || []).length === (s.match(/\}/g) || []).length, `${n}：花括号配平`);
    ok((s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length, `${n}：圆括号配平`);
    ok(/void\s+main\s*\(\s*\)/.test(s), `${n}：有 main`);
    if (d.chunks[0] !== 'post_common' && d.chunks.length) ok(/precision\s+highp\s+sampler3D/.test(s), `${n}：声明了 sampler3D 精度（GLSL ES 3.0 没有默认值）`);
  }
}

section('3 uniform 双向一致（全部模块载入之后）');
{
  for (const n of ps.ordered()) {
    const d = ps.DEFS[n];
    let src; try { src = ps.assemble(n, G) + (d.vert ? '\n' + (ps.assembleVert(n, G) || '') : ''); } catch (e) { continue; }
    const us = fp.parseUniforms(src), seen = new Map();
    const priv = new Map((fp.PRIVATE[n] || []).map(r => [r[0], r[1]]));
    for (const u of us) {
      if (seen.has(u.name)) { ok(seen.get(u.name) === u.type, `${n}：${u.name} 重复声明且类型一致`); continue; }
      seen.set(u.name, u.type); declared.set(u.name, u.type);
      ok(/^u[A-Z0-9]/.test(u.name), `${n}：${u.name} 以 u 开头`);
      const info = fp.uniformInfo(u.name), inPub = info && !info.pass, inPriv = priv.has(u.name);
      if (/^(projectionMatrix|viewMatrix|modelMatrix|modelViewMatrix|normalMatrix|cameraPosition)$/.test(u.name)) continue;
      ok(inPub || inPriv, `${n}：uniform ${u.name} 在 UNIFORMS 或 PRIVATE.${n} 里`);
      if (inPub) eq(info.type, u.type, `${n}：${u.name} 类型一致`);
      if (inPriv) eq(priv.get(u.name), u.type, `${n}：私有 ${u.name} 类型一致`);
    }
    for (const [pn] of priv) ok(seen.has(pn), `PRIVATE.${n}.${pn} 确实在 ${n} 里声明`);
  }
  for (const r of fp.UNIFORMS) ok(declared.has(r[0]) || r[3] === 'inst', `UNIFORMS 里的 ${r[0]}（${r[3]}）至少在一个 pass 里用到`);
  for (const r of fp.UNIFORMS) if (/^sampler/.test(r[1])) ok(r[3] === 'pass', `${r[0]}：sampler 由 pass 写`);
}

section('4 ov_occl.glsl 与 common.glsl');
{
  for (const f of ['towerVis', 'eclipseVis']) {
    const a = fnSrc(G.common || '', f), b = fnSrc(G.ov_occl || '', f);
    ok(a && b && squash(a) === squash(b), `${f}：ov_occl.glsl 与 common.glsl 逐字一致（去注释与空白）`);
  }
}

section('5 TIERS');
{
  const inCommon = ((G.common || '').match(/#ifndef\s+(\w+)/g) || []).map(s => s.split(/\s+/)[1]);
  ok(inCommon.length >= 11, `common.glsl 里有 ${inCommon.length} 个可覆盖的画质宏`);
  for (const m of inCommon) ok(ps.Q_MACROS.includes(m), `${m} 在 Q_MACROS 里`);
  for (const t of ps.TIER_NAMES) {
    for (const m of ps.Q_MACROS) ok(ps.TIERS[t][m] !== undefined, `${t} 档定义了 ${m}`);
    for (const m of ['Q_CLOUD_KM', 'Q_TER_KM', 'Q_TER_FAR_KM', 'NEAR_SCALE', 'FAR_SCALE']) ok(/^\d+\.\d+$/.test(String(ps.TIERS[t][m])), `${t}.${m} 写成浮点字面量`);
    eq(parseFloat(ps.TIERS[t].FAR_SCALE), ps.TIER_OPTS[t].farScale, `${t}：FAR_SCALE 宏与 TIER_OPTS.farScale 一致`);
    ok(ps.TIER_OPTS[t].res[0] <= ps.TIER_OPTS[t].res[1], `${t}：内部比例范围 [${ps.TIER_OPTS[t].res}]`);
  }
  // 02 第十五节第 1 条
  eq(ps.TIERS.low.Q_NEAR_N, 8, '低档近段 8 样本'); eq(ps.TIERS.mid.Q_FAR_N, 10, '中档远段 10 样本');
  eq(ps.TIERS.high.NEAR_SCALE, '0.5', '高档近段 1/2'); eq(ps.TIERS.photo.FAR_SCALE, '1.0', '拍照档远段全分辨率');
  eq(ps.TIER_OPTS.low.bloomLevels, 4, '低档眩光 4 级'); eq(ps.TIER_OPTS.mid.bloomLevels, 5, '中档眩光 5 级');
}

section('6 E 路的约定');
{
  // sky 修订：远段、近段按本 pass 的整个纹素抖动（viewRay 的倍数取 1），远段着色器里不再用 FAR_SCALE；合成的 upFar／upNear 按比例换算
  ok(/#ifndef\s+FAR_SCALE/.test(G.composite) && /FAR_SCALE/.test(strip(G.composite).replace(/#\w+\s+FAR_SCALE[^\n]*/g, '')), 'composite.frag 用 FAR_SCALE（远段比例由 defines 注入）');
  for (const n of ['far', 'near']) ok(/viewRay\(fc,\s*uRes,\s*uJitter,\s*1\.0\)/.test(strip(G[n])), `${n}.frag 按本 pass 的整个纹素抖动（地平线云带不再成 4 像素一级的台阶）`);
  ok(/fc\*NEAR_SCALE\s*-\s*uJitter\*\(1\.0\s*-\s*NEAR_SCALE\)/.test(strip(G.composite)) && /fc\*FAR_SCALE\s*-\s*uJitter\*\(1\.0\s*-\s*FAR_SCALE\)/.test(strip(G.composite)), 'composite 的 upNear／upFar 扣掉低分辨率纹素的抖动');
  ok(!/256\.0/.test(strip(G.cloud_shadow)) && /uRes/.test(G.cloud_shadow), 'cloud_shadow.frag 按 uRes 取图边长（低档 128）');
  ok(/uAbyssFog/.test(G.far), 'far.frag 认深渊雾开关');
  ok(/TONE_ACES/.test(G.final), 'final.frag 有 ACES 对照（TONE_ACES）');
  ok(!/^\s*\/\/\s*【桩】/.test(G.meter) && !/^\s*\/\/\s*【桩】/.test(G.eye) && !/^\s*\/\/\s*【桩】/.test(G.bloom_down) && !/^\s*\/\/\s*【桩】/.test(G.bloom_up) && !/^\s*\/\/\s*【桩】/.test(G.rain), 'meter、eye、bloom、rain 不再是桩');
  const stubs = ps.ordered().filter(n => ps.isStub(n, G));
  console.log('  （主文件仍是桩的 pass：' + (stubs.join('、') || '无') + '）');
  // 云盖改正（E 路对 02 第十、十三节）
  ok(/cavityDim/.test(G.common) && /cavityDim\(X, z\)/.test(G.air), '空气的空腔入射在罪域厚云盖下按双流漫射变暗（cavityDim）');
  ok(/row == 1 \? T\*T2\*Lb/.test(G.probe), '探针行 1 只乘本地空气的透射，不乘本地云');
  ok(/ruiDeckTau\s*\(/.test(strip(G.cloud_shadow)) && /float\s+ruiDeckTau\s*\([^)]*\)\s*\{[^}]*uRuiTau/.test(strip(G.clouds)),
    '云影图计入罪域厚云盖（cloud_shadow 调 clouds.glsl 的 ruiDeckTau，它按 uRuiTau 给 τ）');
  // 掠射弦过了中点才落地（远处阶地）：近段积到表面、合成用同一个终点；探针的掠射弦整根积到内壁
  ok(/if\s*\(ts > 0\.0\)\s*e = tEnd;/.test(strip(G.near)), 'near.frag：有表面命中就积到表面（不止到弦中点）');
  ok(/if\s*\(onSurf\)\s*e = tEnd;/.test(strip(G.composite)), 'composite.frag：有表面时近段终点＝表面距离（与 near 同一口径）');
  ok(/cv1 = clamp\(Q_CLOUD_KM, c0, c1\);/.test(strip(G.near)) && !/cv1 = min\(c1, Q_CLOUD_KM\)/.test(strip(G.near)),
    'near.frag：体积云段不早于云壳入口（云底在 Q_CLOUD_KM 之外时不重复积空气）');
  ok(/float tN = vac \? sg\.x : tWallCam\(cd\);/.test(G.probe) && /airO\(uCamW, d, s == 0 \? 0\.0 : tB, s == 0 \? tA : tN/.test(G.probe), 'probe.frag：不进真空核的掠射弦整根积到内壁（中点切成上升、下降两段）');
  // 斜坡模式的图表北向差（G 路 chart_slide 发现的符号问题）
  ok(/dn = -uR\*atan\(uCamRho\*v\.y - yC\*dr,/.test(G.common), 'chartD 斜坡分支：Δc_N＝−R·atan(ρ_C·Δy − y_C·Δρ, …)');
  // 写入方
  const P = HY.model && HY.model.P ? HY.model.P : HY.astro.params();
  const sv = fp.set.values(HY.state, P);
  ok(Object.keys(sv).every(k => fp.uniformInfo(k) && fp.uniformInfo(k).writer === 'set'), 'settings.values 只写写入方为 set 的 uniform');
  for (const n of ['uMeter', 'uEyeCfg', 'uAbyssFog']) ok(declared.has(n), `E 路登记的 ${n} 在着色器里声明了`);
  for (const [p, n] of [['eye', 'uEyeCtl'], ['rain', 'uRainK'], ['bloom_down', 'uLevel'], ['bloom_up', 'uUpW']]) ok((fp.PRIVATE[p] || []).some(r => r[0] === n), `PRIVATE.${p} 有 ${n}`);
}

section('7 近段的分段（near.frag 段表的 JS 复刻：首尾相接、不重叠、不倒序）');
{
  // 复刻 near.frag：云壳交段 [c0, c1] → 体积段 [c0, cv1] → 空气 (cv1, tm] → 平板事件 → 空气 (tm, e]；没有云：[0, e]
  const R = 6371, QKM = [20, 40, 60];
  function plan(camZ, el, zb, zt, e0, qkm, rui) {
    const K = -camZ * (2 * R - camZ), C = R - camZ, cd = -C * Math.sin(el);             // 相机在 (0, −C, 0)，视线仰角 el
    const shell = z => { const c = K + z * (2 * R - z), D = cd * cd - c; if (D < 0) return [-1, -1]; const s = Math.sqrt(D); return [-cd - s, -cd + s]; };
    const tW = -cd + Math.sqrt(Math.max(cd * cd - K, 0)), tAp = cd < 0 ? -cd : tW;
    const e = Math.min(e0 == null ? tAp : e0, tW);
    let c0 = -1, c1 = -1;
    const B = shell(zb), Tt = shell(zt);
    if (camZ < zb) { if (cd < 0 && B[0] > 0) { c0 = B[0]; c1 = Tt[0] > 0 ? Tt[0] : B[1]; } }
    else if (camZ < zt) { c0 = 0; c1 = (cd < 0 && Tt[0] > 0) ? Tt[0] : (B[1] > 0 ? B[1] : qkm); }
    else if (cd > 0 && B[1] > 0) { c0 = Math.max(Tt[1], 0); c1 = B[1]; }
    if (!(c0 >= 0 && c0 < e)) return { segs: [[0, e]], e };
    c1 = Math.min(c1, e);
    let cv1 = Math.min(Math.max(qkm, c0), c1), tS0 = cv1, tS1 = Math.min(c1, 1500);
    if (rui) { const B6 = shell(zb + 0.6); cv1 = Math.min(cv1, B6[0] > c0 ? B6[0] : c1); tS0 = cv1; tS1 = c1; }
    const slab = tS1 - tS0 > 1e-6, tm = 0.5 * (tS0 + tS1);
    return { segs: slab ? [[0, c0], [c0, cv1], [cv1, tm], [tm, e]] : [[0, c0], [c0, cv1], [cv1, e]], e };
  }
  let bad = 0, n = 0, grazing = 0;
  for (const camZ of [0.0016, 1.0, 2.0, 7.0]) for (const qkm of QKM) for (const rui of [false, true]) for (let i = 0; i <= 400; i++) {
    const el = (-0.2 + 0.6 * i / 400) * Math.PI / 2, zb = rui ? 1.2 : 1.5, zt = rui ? 6 : 6.5;
    for (const e0 of [null, 30, 150, 420]) {
      const p = plan(camZ, el, zb, zt, e0, qkm, rui); n++;
      const s = p.segs; let good = Math.abs(s[0][0]) < 1e-9 && Math.abs(s[s.length - 1][1] - p.e) < 1e-6 * Math.max(1, p.e);
      for (let k = 0; k < s.length; k++) { if (s[k][1] < s[k][0] - 1e-9) good = false; if (k && Math.abs(s[k][0] - s[k - 1][1]) > 1e-9) good = false; }
      if (s.length > 1 && s[0][1] > qkm) grazing++;
      if (!good) { if (bad < 3) console.log('    ✗ ', JSON.stringify({ camZ, el, qkm, rui, e0, segs: s })); bad++; }
    }
  }
  ok(bad === 0, `${n} 条视线的段表都首尾相接（其中 ${grazing} 条云底在 Q_CLOUD_KM 之外）`);
  ok(grazing > 0, '样本里确有“云底在体积云范围之外”的贴地视线（02 原式在这里重复积分）');
}

section('8 空气步进的分步 warpU 在 float32 下有限（整合验收：低档云天整片发白）');
{
  // float32 复刻：f＝Math.fround。原式 1 − u(1 − e^−k) 在 k≳17、u＝1 时得 0 → −log(0)＝∞ → dt＝∞，局地介质为 0 时 TX＝exp(−0·∞)＝NaN
  const f = Math.fround;
  const orig = (u, k) => -Math.log(f(f(1) - f(u * f(f(1) - f(Math.exp(-k)))))) / k;
  const fixd = (u, k) => -Math.log(f(f(f(1) - u) + f(u * f(Math.exp(-k))))) / k;
  let worstFix = 0, origInf = 0;
  for (let k = 1e-3; k <= 30; k += 0.25) for (let i = 0; i <= 48; i++) {
    const u = i / 48, ex = -Math.log(1 - u * (1 - Math.exp(-k))) / k;
    const a = fixd(u, k), b = orig(u, k);
    if (!isFinite(b)) origInf++;
    if (!isFinite(a)) worstFix = Infinity; else worstFix = Math.max(worstFix, Math.abs(a - ex));
  }
  ok(origInf > 0, `对照：原式在 float32 下有 ${origInf} 个点得 ∞（k≳17 时 u＝1）`);
  ok(worstFix < 1e-4, `改写后在 k∈[0,30]、u∈[0,1] 全部有限，与双精度差 ≤${worstFix.toExponential(1)}`);
  ok(/-log\(\(1\.0 - u\) \+ u\*exp\(-k\)\)\/k/.test(G.air) && !/-log\(1\.0 - u\*\(1\.0 - exp\(-k\)\)\)/.test(strip(G.air)), 'air.glsl 的 warpU 用 (1−u)＋u·e^−k 的写法');
}

section('9 合成补地形漏洞（整合验收：阶沿黑线）');
ok(/if \(surf\.a <= 0\.0 && cd > 0\.0\) surf = holeFill\(ivec2\(fc\)\);/.test(strip(G.composite)), 'composite.frag：朝内壁却无表面命中时，取邻近表面像素补上');

T.done();
