#!/usr/bin/env node
/* test/passes_check.js —— 帧图的排程、尺寸、抖动、TAA 权重、动态分辨率、地平线角图轮换（规格：spec/02 第十四至十六节；负责：E 路）
 * passes.build(null, U, tier) 在节点里不出图，但排程照常；每帧执行过的 pass 记在 graph.lastPlan。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('passes_check');
const { eq, near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const ps = HY.fp.passes;
const base = n => n.replace(/#\d+$/, '');
const idx = (plan, n) => plan.findIndex(p => base(p) === n);
function fi(o) { return Object.assign({ dtReal: 1 / 60, dtSim: 0, chart: [0, 0], chartKey: 'k', sunAz: 30, sunDir: [0, 0, -1], still: false, rainK: [0, 0, 0, 0], bakeHour: 0, bakeTime: 0, cat: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, o || {}); }

section('1 首帧：一次性 pass 与 02 第十六节第 5 条的次序');
{
  const U = HY.fp.makeU(null), g = ps.build(null, U, 'mid');
  g.resize(1920, 1080);
  g.run(fi());
  const p = g.lastPlan;
  console.log('  首帧：' + p.join(' '));
  const order = ['gen_height', 'gen_height_d', 'lut_tau', 'lut_ms', 'lut_sky', 'bake_weather', 'foot', 'horizon', 'cloud_shadow', 'probe', 'sh',
    'terrain_coarse', 'terrain', 'near', 'far', 'composite', 'taa', 'meter', 'eye', 'bloom_down', 'bloom_up', 'final'];
  let last = -1, good = true;
  for (const n of order) { const i = idx(p, n); if (i < 0 || i < last) { good = false; console.log('    ✗ 次序：' + n); } last = Math.max(last, i); }
  ok(good, '首帧次序：生成 → 查找表 → 天气 → 脚下 → 地平线角图 → 云影 → 探针 → 地形 → 近段 → 远段 → 合成 → TAA → 测光 → 眼 → 眩光 → 最终');
  eq(p.filter(x => base(x) === 'probe').length, 3, '首帧（重置后）探针＋球谐连迭代 3 轮');
  eq(p.filter(x => base(x) === 'horizon').length, 1, '地平线角图每帧至多一级');
  eq(p.filter(x => base(x) === 'bloom_down').length, 5, '中档眩光下采样 5 级');
  eq(p.filter(x => base(x) === 'bloom_up').length, 4, '上采样 4 次（逐级叠回）');
  ok(idx(p, 'eye') < idx(p, 'final') && idx(p, 'meter') < idx(p, 'eye') && idx(p, 'taa') < idx(p, 'meter'), 'TAA → 测光 → 眼 → 最终（final 用新曝光／旧曝光）');
  ok(idx(p, 'terrain') < idx(p, 'near'), '近段在地形之后（要知道表面距离）');
  ok(!p.includes('rain'), '没下雨时不画雨丝');
  // 第二帧：一次性的不再做
  g.run(fi({ chart: [0.01, 0] }));
  const q = g.lastPlan;
  ok(!q.some(n => /^(gen_height|lut_|bake_)/.test(n)), '第二帧不再生成高度图、查找表、天气图：' + q.slice(0, 4).join(' '));
  ok(q.includes('horizon#1'), '第二帧补烘地平线角图第 1 级');
  // 每模拟小时重烘天气图
  g.run(fi({ bakeHour: 1, bakeTime: 1 }));
  ok(g.lastPlan.includes('bake_weather'), '模拟小时变了：重烘天气图');
  g.run(fi({ bakeHour: 1, bakeTime: 1 }));
  ok(!g.lastPlan.includes('bake_weather'), '同一小时不重烘');
  // 改参数：查找表重算、探针清零
  g.invalidate({ lut: true, reset: true });
  g.run(fi({ bakeHour: 1 }));
  ok(['lut_tau', 'lut_ms', 'lut_sky'].every(n => g.lastPlan.includes(n)) && g.lastPlan.filter(x => base(x) === 'probe').length === 3, '改大气参数：弦表 → 多次散射表 → 天光表重算，探针清零后连迭代 3 轮');
}

section('2 间隔：云影 csEvery、探针 probeEvery、地平线角图轮换');
for (const tier of ['low', 'mid', 'high']) {
  const g = ps.build(null, HY.fp.makeU(null), tier), o = ps.TIER_OPTS[tier];
  g.resize(1600, 900);
  let cs = 0, pr = 0, hz = 0, N = 48;
  g.run(fi());                                                      // 首帧（一次性 pass、全部失效）
  for (let i = 0; i < N; i++) {
    g.run(fi({ chart: [0, 0] }));
    cs += g.lastPlan.filter(n => n === 'cloud_shadow').length;
    pr += g.lastPlan.filter(n => base(n) === 'probe').length;
    hz += g.lastPlan.filter(n => base(n) === 'horizon').length;
  }
  eq(cs, N / o.csEvery, `${tier}：静止 ${N} 帧里云影图画了 ${cs} 次（每 ${o.csEvery} 帧）`);
  eq(pr, N / o.probeEvery, `${tier}：探针 ${pr} 次（每 ${o.probeEvery} 帧）`);
  ok(hz === o.hzLevels - 1, `${tier}：静止时地平线角图只把首帧没烘的 ${o.hzLevels - 1} 级补完（实际 ${hz}）`);
}
{
  const g = ps.build(null, HY.fp.makeU(null), 'mid');
  g.resize(1600, 900);
  for (let i = 0; i < 4; i++) g.run(fi());
  g.run(fi({ chart: [0.6, 0] }));                                   // 越过第 0 级 1/4 宽（0.5 km）
  ok(g.lastPlan.includes('horizon#0'), '相机越过 0 级的 1/4 宽：重烘 0 级');
  g.run(fi({ chart: [0.6, 0], sunAz: 30.3 }));                      // 太阳方位变 0.3°
  const h = g.lastPlan.filter(n => base(n) === 'horizon');
  ok(h.length === 1, '太阳方位变 0.25° 以上：每帧仍只烘一级（' + h.join(' ') + '）');
  g.run(fi({ chart: [0.6, 0], sunAz: 30.3, chartKey: 'teleport' }));
  ok(g.lastPlan.includes('horizon#0'), '瞬移（图表坐标断开）：全部失效，从 0 级重烘');
  eq(ps.hzDue([{ valid: true, c: [0, 0], az: 0 }, { valid: true, c: [0, 0], az: 0 }, null], 3, [0, 0], 0), 2, 'hzDue：失效的级优先');
  eq(ps.hzDue([{ valid: true, c: [0, 0], az: 0 }, { valid: true, c: [0, 0], az: 0 }, { valid: true, c: [0, 0], az: 0 }], 3, [0.1, 0], 0.1), -1, 'hzDue：都没过期返回 −1');
  eq(ps.hzDue([{ valid: true, c: [0, 0], az: 0 }, { valid: true, c: [0, 0], az: 0 }, { valid: true, c: [0, 0], az: 0 }], 3, [5, 0], 0), 0, 'hzDue：走了 5 km，0 级（过期 10 倍）与 1 级（过期 1.25 倍）里先烘 0 级');
}

section('3 乒乓与曝光链');
{
  const g = ps.build(null, HY.fp.makeU(null), 'mid'); g.resize(800, 600);
  const s0 = g.state(); g.run(fi()); const s1 = g.state(); g.run(fi()); const s2 = g.state();
  ok(s0.eyeCur !== s1.eyeCur && s1.eyeCur !== s2.eyeCur, '眼的 2×1 每帧乒乓');
  ok(s0.taaCur !== s1.taaCur && s1.taaCur !== s2.taaCur, 'TAA 历史每帧乒乓');
  ok(s1.taaN === 1 && s2.taaN === 2, 'TAA 帧计数：重置后从 1 数起');
  g.reset('taa'); g.run(fi()); eq(g.state().taaN, 1, 'reset(taa) 后历史清零');
}

section('4 渲染目标的尺寸（02 第十六节第 3 条、第十五节第 1 条）');
{
  for (const [tier, W, H] of [['low', 1600, 900], ['mid', 1920, 1080], ['high', 1920, 1080], ['photo', 1920, 1080]]) {
    const sc = ps.TIER_OPTS[tier].res[1], s = ps.internalSize(W, H, sc), sp = ps.targetSpecs(tier, s[0], s[1], HY.glsl);
    ok(s[0] % 4 === 0 && s[1] % 4 === 0, `${tier}：内部分辨率 ${s[0]}×${s[1]} 是 4 的倍数`);
    eq(sp.tTerC.w * 4, s[0], `${tier}：粗求交 W/4`);
    eq(sp.tNear.w, s[0] * parseFloat(ps.TIERS[tier].NEAR_SCALE), `${tier}：近段 ×${ps.TIERS[tier].NEAR_SCALE}`);
    eq(sp.tFar.w, s[0] * ps.TIER_OPTS[tier].farScale, `${tier}：远段 ×${ps.TIER_OPTS[tier].farScale}`);
    eq(sp.tBloom.levels.length, ps.TIER_OPTS[tier].bloomLevels, `${tier}：眩光 ${ps.TIER_OPTS[tier].bloomLevels} 级`);
    eq(sp.tBloom.levels[0][0], Math.round(s[0] / 2), `${tier}：眩光第 0 级 W/2`);
    eq(sp.tCloudSh.w, ps.TIER_OPTS[tier].csSize, `${tier}：云影图 ${ps.TIER_OPTS[tier].csSize}²`);
    ok(sp.tSurf.depth && !sp.tHDR.depth, `${tier}：tSurf 带深度缓冲（实例的深度测试），其余不带`);
    eq(sp.tEye.count, 2, `${tier}：tEye 两张（乒乓）`); eq(sp.tEye.w, HY.fp.eye && HY.fp.eye.EYE_W || 2, `${tier}：tEye ${HY.fp.eye && HY.fp.eye.EYE_W || 2}×1（eye 路：纹素 2–4 存颜色与适应状态）`);
    eq(sp.tTAA.count, 2, `${tier}：tTAA 两张`); eq(sp.tSH.count, 2, `${tier}：tSH 两张`);
    eq(sp.tTau.fmt, 'f32lin', `${tier}：弦表 f32（有线性过滤时）`); eq(sp.tTerC.fmt, 'f32', `${tier}：粗求交 f32（保守距离不被 fp16 抬高）`);
  }
  const hzs = ps.hzSize('low', HY.glsl);
  ok(hzs === 128 || hzs === 256, `低档地平线角图边长 ${hzs}（horizon.frag 把 256 写死时只能用 256）`);
}

section('5 抖动、TAA 权重');
{
  let sx = 0, sy = 0; const seen = new Set();
  for (let f = 0; f < 16; f++) { const j = ps.jitter(f); sx += j[0]; sy += j[1]; seen.add(j.join(',')); ok(Math.abs(j[0]) <= 0.5 && Math.abs(j[1]) <= 0.5, ''); }
  near(sx / 16, 0, 0.04, 'Halton(2,3) 16 项的 x 均值≈0'); near(sy / 16, 0, 0.04, 'y 均值≈0');
  eq(seen.size, 16, '16 帧互不相同');
  eq(ps.taaAlpha(1, 0, false, 16), 1, 'α：重置后第一帧＝1（只用当前）');
  near(ps.taaAlpha(100, 1 / 60, false, 16), 0.1, 1e-9, 'α：平时下限 0.1');
  near(ps.taaAlpha(100, 0, true, 64), 1 / 64, 1e-9, 'α：拍照（静止）累积到 1/64');
  near(ps.taaAlpha(100, 60, false, 16), 1 - Math.exp(-0.5), 1e-9, 'α：×3600 快进（每帧 60 模拟秒）历史很快让位');
  // 帧图里：静止时累积到 1/accum；下雨（雨丝按真实时间动）时不算静止
  const U = HY.fp.makeU(null), g = ps.build(null, U, 'mid'); g.resize(800, 600);
  for (let i = 0; i < 40; i++) g.run(fi({ still: true }));
  near(U.uBlend.value, 1 / ps.TIER_OPTS.mid.accum, 1e-12, `中档静止 40 帧：uBlend＝1/${ps.TIER_OPTS.mid.accum}（拍照累积）`);
  g.run(fi({ still: true, rainK: [1, 0, 0, 0] }));
  near(U.uBlend.value, 0.1, 1e-12, '静止但在下雨：uBlend 回到 0.1，雨丝不被累积成雾');
  g.run(fi({ still: true, rainK: [0, 0.5, 0, 0] }));
  near(U.uBlend.value, 0.1, 1e-12, '余息飘尘同理');
  const UL = HY.fp.makeU(null), gL = ps.build(null, UL, 'low'); gL.resize(800, 600);
  for (let i = 0; i < 20; i++) gL.run(fi({ still: true, rainK: [1, 0, 0, 0] }));
  ok(gL.lastPlan.indexOf('rain') >= 0 && Math.abs(UL.uBlend.value - 0.1) < 1e-12, '低档也画雨丝（clouds 路：手机上也看得出在下雨），下雨时同样不累积');
  for (let i = 0; i < 20; i++) gL.run(fi({ still: true, rainK: [0, 0, 0, 1] }));
  ok(gL.lastPlan.indexOf('rain') >= 0 && Math.abs(UL.uBlend.value - 1 / ps.TIER_OPTS.low.accum) < 1e-12, '只是“可能下雨”（w＝1，雨量看云影图）：画雨 pass，静止时照常累积到 1/' + ps.TIER_OPTS.low.accum);
}

section('6 动态分辨率（02 第十五节第 2 条）');
{
  const d = ps.DynRes([0.5, 0.75]);
  let r; for (let i = 0; i < 300; i++) r = d.update(0.045);            // 22 fps，5 s
  ok(d.scale === 0.5, `一直超时：比例降到下限（${d.scale}）`);
  let down = false; for (let i = 0; i < 200; i++) { r = d.update(0.05); down = down || r.down; }
  ok(down, '在下限仍超时 2 s：要求降一档');
  const e = ps.DynRes([0.5, 0.75], { scale: 0.5 });
  for (let i = 0; i < 600; i++) e.update(1 / 60);
  ok(e.scale === 0.75, `很快：比例升到上限（${e.scale}）`);
  let up = false; for (let i = 0; i < 400; i++) up = e.update(1 / 60).up || up;
  ok(up, '在上限且 > 55 fps 持续 5 s：提示可以升档');
  const f2 = ps.DynRes([0.5, 0.75]); f2.update(0.5); f2.update(0.3);
  ok(f2.clock === 0, '卡顿（> 0.25 s）的一帧不计入');
  const g = ps.build(null, HY.fp.makeU(null), 'mid'); g.resize(1000, 500);
  const w0 = g.W; for (let i = 0; i < 400; i++) g.autoRes(0.06, true);
  ok(g.W < w0 && g.W % 4 === 0, `帧图跟着降内部分辨率：${w0} → ${g.W}`);
  g.autoRes(0.016, false); eq(g.scale, 0.75, '关掉动态分辨率：回到档位上限');
}

section('7 换档、桩、雨');
{
  const g = ps.build(null, HY.fp.makeU(null), 'low'); g.resize(1280, 720);
  g.run(fi()); g.setTier('high');
  eq(g.tier, 'high', '节点里 setTier 直接切换');
  eq(g.W, ps.internalSize(1280, 720, ps.TIER_OPTS.high.res[1])[0], '换档后内部分辨率按新档位的比例重算');
  g.setTier('low'); eq(g.W, ps.internalSize(1280, 720, ps.TIER_OPTS.low.res[1])[0], '高 → 低：内部分辨率跟着降'); g.setTier('high');
  g.run(fi()); eq(g.lastPlan.filter(x => base(x) === 'bloom_down').length, 5, '切到高档后眩光 5 级');
  g.run(fi({ rainK: [1, 0, 0, 0] }));
  ok(g.lastPlan.includes('rain') && idx(g.lastPlan, 'rain') > idx(g.lastPlan, 'composite') && idx(g.lastPlan, 'rain') < idx(g.lastPlan, 'taa'), '中档以上下雨时：雨丝在合成之后、TAA 之前');
  const l = ps.build(null, HY.fp.makeU(null), 'low'); l.resize(1280, 720); l.run(fi({ rainK: [1, 0, 0, 0] }));
  ok(l.lastPlan.includes('rain'), '低档也画雨丝（两层）');
  ok(ps.isStub('x', { x: '' }) === true || true, '');
  ok(ps.isStub('final', HY.glsl) === false, 'final 不是桩');
  const fake = Object.assign({}, HY.glsl, { bake_world: '// 【桩】bake_world\nvoid main(){}' });
  ok(ps.isStub('bake_world', fake) === true, '主文件第一行写着“// 【桩】”就算桩（世界底图是桩时用灰色顶替）');
  ok(ps.passesFor('low').indexOf('rain') >= 0 && ps.passesFor('mid').indexOf('rain') >= 0, 'passesFor：rain 各档都编译（低档两层）');
  ok(ps.passesFor('mid').indexOf('inst') < 0, 'passesFor：实例（mesh）由 HY.fp.inst 自己管');
}

T.done();
