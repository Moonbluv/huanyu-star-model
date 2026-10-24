#!/usr/bin/env node
/* skeleton_check —— M1 骨架自检：全部 node 模块能按 manifest 顺序载入；各接口（含桩）签名与返回形状对；
 * 统筹修订的历法契约（第 N 年 · 入冬后第 d 日 · 冬／夏第 n 日 · 月态第几夜；MARKS 用相对入冬的日数）成立。
 * 只断言形状与契约，不断言桩里的假数据——各路把桩换成真实现后本测试应继续通过。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('skeleton_check');
const { ok, eq, near, section } = T;
const A = HY.astro, W = HY.world, C = HY.calc, M = HY.model, U = HY.util;
console.warn = () => {};

section('1 命名空间齐全');
for (const p of ['astro', 'util', 'world', 'store', 'bus', 'state', 'calc', 'model', 'glsl', 'BUILD', 'ov.geom', 'fp.UNIFORMS', 'fp.PRIVATE',
  'fp.noise', 'fp.ground', 'fp.cel', 'fp.cam', 'fp.set', 'fp.passes.DEFS', 'fp.passes.TIERS', 'ui.PARAMS']) {
  ok(U.getPath(HY, p) != null, 'HY.' + p);
}
for (const f of ['registerUniforms', 'registerPrivate', 'makeU', 'makePrivate', 'uniformsFor', 'apply', 'parseUniforms']) ok(typeof HY.fp[f] === 'function', 'HY.fp.' + f);
for (const f of ['addDefs', 'addChunk', 'addTierDefine', 'addTierOpts', 'assemble', 'build']) ok(typeof HY.fp.passes[f] === 'function', 'HY.fp.passes.' + f);
ok(typeof HY.store.extendSchema === 'function' && typeof HY.ui.addParams === 'function', 'HY.store.extendSchema、HY.ui.addParams');
for (const f of ['look', 'readPx', 'Eh', 'sunVis', 'moonState', 'gpuTimes', 'quality', 'perf']) ok(HY.fp.api && typeof HY.fp.api[f] === 'function', 'HY.fp.api.' + f + '（G 路，fp/camera.js）');

section('2 历法契约（统筹修订）');
{
  const P = A.params();
  eq(W.CAL.yearStart, 'civil', '默认年号口径 civil（正典年份不变）');
  const tD1 = A.tOf(10018, 8, 24, 21, -4, P);
  near(W.markT('d1', 10018, -4, P), tD1, 1e-9, 'MARKS.d1（入冬前 67 日 21 时）＝旧草案八月廿四 21 时');
  near(W.markT('heiyao', 0, -4, P), A.tOf(10008, 9, 10, 21, -4, P), 1e-9, 'MARKS.heiyao（10008 年入冬前 51 日）＝旧草案九月初十');
  near(W.markT('festival', 10018, 2, P), -1 + 21 / 24, 1e-9, '庆典夜＝入冬前夜 21 时（伊美忒）');
  const c = C.civil(tD1, -4, P);
  ok(c.N === 10018 && c.wd === 294 && c.doy === 233 && c.rel === -67 && c.cyc === 1 && c.festival === true, 'civil(D1)：第 10018 年、入冬后第 294 日、doy 233、rel −67、庆典年');
  near(c.hour, 21, 1e-6, 'civil(D1).hour＝21');
  eq(c.label, '第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日', 'label 由 fmtCal 生成');
  const c0 = C.civil(0, 2, P);
  ok(c0.wd === 1 && c0.rel === 0 && c0.N === 10018, '入冬交节（伊美忒子夜）＝入冬后第 1 日');
  const c1 = C.civil(-0.01, 2, P);
  ok(c1.wd === 360 && c1.rel === -1, '庆典夜＝入冬后第 360 日、rel −1');
  eq(C.civil(400, 2, P).cyc, 2, '下一年周期第 2 年');
  let worst = 0;
  for (const ys of ['civil', 'winter', 'winterEnd']) {
    W.CAL.yearStart = ys;
    for (let i = 0; i < 400; i++) {
      const t = (Math.random() - 0.5) * 20000, az = (Math.random() - 0.5) * 360, q = C.civil(t, az, P);
      const back = C.tOfCivil(q.N, q.doy, q.hour, az, P);
      worst = Math.max(worst, Math.abs(back - t));
      if (!(q.doy >= 0 && q.doy < 360 && q.wd >= 1 && q.wd <= 360)) { ok(false, `${ys}：doy/wd 越界 ${JSON.stringify(q)}`); break; }
      const span = W.yearSpan(q.N, P, az);
      if (!(t >= span[0] - 1e-9 && t < span[1] + 1e-9)) { ok(false, `${ys}：t 不在第 ${q.N} 年里`); break; }
    }
  }
  ok(worst * 86400 < 1, `civil／tOfCivil 往返误差 ${(worst * 86400).toExponential(2)} 秒 < 1 秒（三种口径）`);
  W.CAL.yearStart = 'winter';
  eq(C.civil(tD1, -4, P).N, 10017, "口径 'winter'：D1 落在第 10017 年");
  W.CAL.yearStart = 'winterEnd';
  ok(C.civil(tD1, -4, P).N === 10018 && C.civil(0.01, 2, P).N === 10019, "口径 'winterEnd'：D1 在 10018，飞升日起是 10019");
  W.CAL.yearStart = 'civil';
  const ml = W.markList(10018, P, { az: -4 });
  const ids = ml.map(m => m.id);
  ok(['d1', 'd2', 'd3', 'festival', 'winter', 'yuxi', 'ssol', 'summer', 'wsol'].every(i => ids.includes(i)), '第 10018 年的标记齐（含 D1–D3、庆典夜、余息）：' + ids.join(','));
  ok(!W.markList(10019, P).some(m => m.id === 'festival'), '非庆典年不标庆典夜');
  ok(ml.every(m => m.doy >= 0 && m.doy < 360 && m.wd >= 1 && m.wd <= 360), '标记的 doy、wd 在范围内');
  ok(ml.filter(m => /^d\d$/.test(m.id)).every(m => m.tbd), 'D1–D3 标“待定”');
  eq(W.markList(10018, P, { yuxiLead: 30 }).find(m => m.id === 'yuxi').wd, 331, '余息随 fp.set.yuxiLead 移动（入冬前 30 日＝第 331 日）');
  const info = { N: 10018, cyc: 1, festival: true, wd: 294, hour: 21, season: '夏', seasonDay: 114, moonState: '亮月', moonNight: 9 };
  eq(W.fmtCal(info), '第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日 · 夏第 114 日 · 亮月第 9 夜', "fmtCal(…, 'full')");
  eq(W.fmtCal(info, 'year'), '第 10018 年（庆典年 · 周期第 1 年）', "fmtCal(…, 'year')");
  eq(W.fmtCal({ N: 10019, cyc: 2, festival: false }, 'year'), '第 10019 年（周期第 2 年）', '非庆典年只注周期');
  eq(W.fmtCal(info, 'moon'), '亮月第 9 夜', "fmtCal(…, 'moon')");
  eq(W.fmtCal(info, 'chip'), '入冬后 294 日', "fmtCal(…, 'chip')");
  ok(!/[一二三四五六七八九十]+月[初廿]/.test(W.fmtCal(info)), '界面文字里没有“几月初几”');
}

section('3 小工具：时辰、钟点、方位、公里');
eq(C.shichen(21), '亥时初', '21 时＝亥时初');
eq(C.shichen(23), '子时初', '23 时＝子时初');
eq(C.shichen(0), '子时正', '0 时＝子时正');
eq(C.shichen(21.5), '亥时初二刻', '21:30＝亥时初二刻');
eq(C.hhmm(21), '21:00', 'hhmm');
eq(C.hhmm(23.9999), '00:00', 'hhmm 进位折回');
eq(C.dirName(180), '正南', '正南');
eq(C.dirName(188), '南偏西 8°', '南偏西 8°');
eq(C.dirName(172), '南偏东 8°', '南偏东 8°');
eq(C.dirName(10), '北偏东 10°', '北偏东 10°');
eq(C.km(6670), '6,670 公里', '千分位＋公里');

section('4 HY.model：P、O、now 的形状；改参数重建');
{
  M.rebuild();
  const n = M.now;
  for (const k of ['t', 'date', 'hour', 'shichen', 'hhmm', 'season', 'seasonDay', 'cycleYear', 'festivalYear', 'nextWinter', 'cal', 'night', 'sun', 'moon', 'eclipse', 'tower', 'dayH', 'nightH', 'site', 'illum']) ok(k in n, 'now.' + k);
  for (const k of ['el', 'elG', 'az', 'hoff', 'diam', 'vis', 'dist', 'aspect', 'side']) ok(k in n.sun, 'now.sun.' + k);
  for (const k of ['el', 'elG', 'az', 'hoff', 'diam', 'vis', 'dist', 'sunlit', 'k', 'state', 'elong', 'age', 'blackHigh', 'litVisible', 'night']) ok(k in n.moon, 'now.moon.' + k);
  for (const k of ['N', 'cyc', 'festival', 'wd', 'hour', 'season', 'seasonDay', 'moonState', 'moonNight']) ok(k in n.cal, 'now.cal.' + k);
  ok(n.cal.wd === 294 && n.season === '夏' && n.seasonDay === 114, 'D1 默认时刻：入冬后第 294 日、罪域夏第 114 日');
  eq(n.moon.state, '亮月', 'D1 整夜亮月（now 取自 HY.astro）');
  near(n.dayH, A.dayFraction(n.site.r, M.P) * 24, 1e-9, 'dayH 来自 HY.astro.dayFraction');
  const pv = M.pv, nh = n.nightH;
  HY.store.set('astro.o.dS', 700, 'ui');
  ok(M.pv === pv + 1 && M.tick().nightH !== nh, '改 astro.o.dS：pv 加一、nightH 变');
  HY.store.set('astro.o.dS', null, 'ui');
  const pv2 = M.pv;
  HY.store.patch('site', { id: 'yimeite', s: 4000, az: 2 }, 'ui');
  ok(M.pv === pv2 && M.O.id === 'yimeite' && M.O.name === '伊美忒', '改 site 只重建 O');
  let calls = 0; M.cached('x', [1], () => ++calls); M.cached('x', [1], () => ++calls);
  eq(calls, 1, 'cached 命中');
  HY.store._resetForTest(); M.rebuild();
}

section('5 HY.calc 各函数的返回形状（桩也要对）');
{
  const P = M.P, O = M.O, Z = M.Z, t = HY.state.time.t;
  const d = C.dayStats(O, A.localMidnight(0, O, P), P);
  for (const k of ['dayH', 'nightH', 'doseMJ', 'noonEl', 'noonDir', 'dawn', 'dusk', 'segs', 'sun', 'hoff', 'moon']) ok(k in d, 'dayStats.' + k);
  ok(d.sun instanceof Float32Array && d.sun.length === 288, 'dayStats.sun 是 Float32Array(288)');
  const y = C.yearTable(O, 10018, P);
  ok(y.noonEl.length === 360 && y.doseMJ.length === 360 && Array.isArray(y.nights) && Array.isArray(y.marks), 'yearTable 360 日、nights、marks');
  const me = C.meridian(t, 0, P, Z);
  ok(['s', 'nightH', 'doseMJ', 'noonEl', 'towerW', 'g', 'zone'].every(k => me[k].length === 161), 'meridian 七列各 161');
  const mo = C.month(O, t, P);
  ok(typeof mo.tStart === 'number' && mo.nights.length > 0 && 'date' in mo.nights[0], 'month {tStart, tEnd, nights[{t, date, …}]}');
  ok(Array.isArray(C.festivals(10016, 8, P)) && C.festivals(10016, 8, P).length === 8, 'festivals');
  ok(C.crossings(10018, P).winter.civil.wd === 1, 'crossings 带 civil');
  ok(C.findNext('eclipse', HY.astro.siteByName('伊美忒', P), t, P) === null, "findNext('eclipse') 在伊美忒为 null");
  const il = C.illum(O, t, P, {});
  ok(['sunW', 'sunLux', 'sunLuxGround', 'moonLux', 'farLuxUpper', 'est'].every(k => k in il), 'illum 形状');
  ok('state' in C.moonNight(O, t, P) && 'night' in C.moonNight(O, t, P), 'moonNight {state, night}');
  if (C.__stubs.length) console.log('  （HY.calc 仍是桩：' + C.__stubs.join('、') + '）');
}

section('6 第一人称 node 模块：写入方各写各的');
{
  const fp = HY.fp, P = M.P, S = HY.state;
  const names = w => fp.UNIFORMS.filter(r => r[3] === w).map(r => r[0]).sort();
  const cel = fp.cel.compute(P, S.time.t, 0, S.fp);
  ok(JSON.stringify(Object.keys(cel).sort()) === JSON.stringify(names('cel')), 'cel.compute 恰好返回全部 cel 写入的 uniform');
  const cam = fp.cam.create(P, S.site, S.fp);
  const cv = cam.compute();
  ok(Object.keys(cv).every(k => fp.uniformInfo(k).writer === 'cam'), 'cam.compute 只返回 cam 写入的 uniform');
  ok(typeof cam.teleport === 'function' && typeof cam.step === 'function' && typeof cam.toSite === 'function', 'cam 对象有 teleport／step／toSite');
  const sv = fp.set.values(S, P);
  ok(JSON.stringify(Object.keys(sv).sort()) === JSON.stringify(names('set')), 'set.values 恰好返回全部 set 写入的 uniform');
  const U0 = fp.makeU(null);
  const r = fp.set.apply(S, P, U0);
  ok(['lut', 'weather', 'world', 'horizon', 'inst', 'recompile'].every(k => k in r), 'set.apply 返回重建标志');
  fp.apply(U0, cel, 'cel'); fp.apply(U0, cv, 'cam');
  ok(true, 'apply 三个写入方无冲突');
  const lim = fp.ground.limits({});
  ok(['uAmpZone', 'uLip', 'uClearMax', 'uHc'].every(k => k in lim), 'ground.limits 形状');
  const g = fp.passes.build(null, U0, 'mid');
  ok(['run', 'compileNext', 'resize', 'setTier', 'dispose'].every(k => typeof g[k] === 'function'), 'passes.build → graph');
  ok(fp.noise.gen3D(4).data.length === 4 * 4 * 4 * 4, 'noise.gen3D 返回 size³·4 字节');
}

section('7 总览几何与参数表的形状');
{
  const P = M.P, gm = HY.ov.geom;
  const h = gm.helix(P, 'sun', 12, 1);
  ok(h.pos instanceof Float32Array && h.u instanceof Float32Array && h.pos.length === 3 * h.u.length, 'geom.helix → {pos, u}');
  const w = gm.shadowWedge(P, A.sunPos(0, P));
  ok(w.umbra.length === 2 && w.penumbra.length === 2, 'geom.shadowWedge 形状');
  ok(typeof gm.spin(P, 1e5) === 'number', 'geom.spin 返回弧度');
  for (const r of HY.ui.PARAMS) ok(HY.store.spec(r.path), 'PARAMS 路径在 SCHEMA 里：' + r.path);
  ok(HY.ui.PARAMS.filter(r => r.setting).every(r => r.group === '设定'), '标了 setting 的都在“设定”组');
}

T.done();
