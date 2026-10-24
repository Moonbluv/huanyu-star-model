#!/usr/bin/env node
/* model_check —— HY.model 自检（规格：spec/03 第十一节第 1 条；统筹修订见 spec/04）
 * 改参数：pv 加一、缓存清空、now 跟着变；改地点只重建 O；now 各字段与直接调 HY.astro／HY.calc 一致；
 * tick 同输入不重算；链接规则、定标、大气、年号口径。
 */
'use strict';
const load = require('./_load.js');
const HY = load({ upto: 'core/model.js' });
const T = load.tester('model_check');
const { ok, eq, near, section } = T;
const A = HY.astro, W = HY.world, C = HY.calc, M = HY.model, S = HY.store, U = HY.util;
console.warn = () => {}; console.error = () => {};

const events = [];
HY.bus.on('model', e => events.push(e));
function evs() { const a = events.slice(); events.length = 0; return a; }

section('1 启动：P、O、Z、now');
{
  M.rebuild();
  ok(M.P && M.O && M.Z && M.now, 'rebuild 后 P、O、Z、now 齐');
  const P0 = A.params({ H: HY.state.fp.atmo.HR, V: HY.state.fp.atmo.V });
  ok(['R', 'a', 'dS', 'A', 'rM', 'M', 'beta', 'Sref', 'Eref', 'pMoon', 'tauV'].every(k => Math.abs(M.P[k] - P0[k]) < 1e-12), '默认 P＝HY.astro.params（加上 fp.atmo 的 H、V）');
  near(M.P.Sref, 767, 2, '默认定标 5772 K（767 W/m²）');
  eq(M.P.pMoon, 0.6, '月面反照率默认 0.6');
  ok(M.O.id === 'zuiyu' && M.O.name === '罪域·啜泣堡' && M.O.short === '罪域' && M.O.zone.id === 'heavy', '默认地点罪域：id、名字、分域');
  ok(Math.abs(M.O.s - 6670) < 1e-9 && M.O.az === -4, 'O 来自 HY.astro.site(site.s, site.az)');
  ok(U.equal(M.Z, HY.state.zones) && M.Z !== HY.state.zones, 'Z 是 zones 的副本');
  eq(M.siteKey(), '6670.0000|-4.0000', 'siteKey');
  const ev = evs();
  ok(ev.length === 1 && ev[0].what === 'P', 'rebuild 发一次 model {what:"P"}');
}

section('2 now 与直接调 HY.astro／HY.calc 一致');
{
  let bad = [], n = 0;
  const sites = [['zuiyu', 6670, -4], ['yimeite', 4000, 2], ['far', 0.72 * Math.PI * 6371, 180], [null, 3123.4, 77.7], ['equator', Math.PI * 6371 / 2, 0]];
  for (const [id, s, az] of sites) {
    S.patch('site', { id, s, az }, 'api');
    for (let i = 0; i < 30; i++) {
      const t = (Math.random() - 0.5) * 4000;
      S.set('time.t', Math.round(t * 1440) / 1440, 'api');
      const now = M.tick(), P = M.P, O = M.O, tt = HY.state.time.t, sk = A.sky(O, tt, P), asp = A.sunAspect(O, tt, P);
      const chk = (cond, what) => { if (!cond) bad.push(what + '@' + (id || 'custom') + ' t=' + tt.toFixed(4)); };
      n++;
      chk(now.t === tt, 't');
      for (const k of ['el', 'elG', 'az', 'hoff', 'diam', 'vis', 'dist']) { chk(now.sun[k] === sk.sun[k], 'sun.' + k); chk(now.moon[k] === sk.moon[k], 'moon.' + k); }
      for (const k of ['sunlit', 'k', 'state', 'elong', 'age']) chk(now.moon[k] === sk.moon[k], 'moon.' + k);
      chk(now.sun.aspect === asp.kind && now.sun.side === asp.side, 'sun.aspect');
      chk(now.night === sk.night && now.hour === sk.hour, 'night、hour');
      chk(now.moon.blackHigh === !!A.blackMoonHigh(O, tt, P) && now.moon.litVisible === !!A.litMoonVisible(O, tt, P), 'blackHigh、litVisible');
      chk(now.eclipse === A.eclipseFrac(O, tt, P), 'eclipse');
      chk(U.equal(now.tower, A.towerView(O, P)), 'tower');
      chk(Math.abs(now.dayH - A.dayFraction(O.r, P) * 24) < 1e-12 && Math.abs(now.dayH + now.nightH - 24) < 1e-9, 'dayH、nightH');
      const c = C.civil(tt, O.az, P);
      chk(U.equal(now.date, c), 'date＝calc.civil');
      chk(now.shichen === C.shichen(sk.hour) && now.hhmm === C.hhmm(sk.hour), 'shichen、hhmm');
      const so = C.seasonOf(tt, O, P);
      chk(now.season === so.season && now.seasonDay === so.n && now.seasonAstro === sk.season, 'season（历法）、seasonAstro（物理）');
      chk(now.cycleYear === c.cyc && now.festivalYear === c.festival, 'cycleYear、festivalYear');
      chk(now.nextWinter > tt && now.nextWinter - tt <= 360 && U.mod(now.nextWinter, 360) === 0, 'nextWinter');
      const mn = C.moonNight(O, tt, P);
      chk(now.moon.night === mn.night && now.moon.since === mn.since, 'moon.night＝calc.moonNight');
      const il = C.illum(O, tt, P);
      chk(now.illum.sunLux === il.sunLux && now.illum.sunLuxGround === il.sunLuxGround && now.illum.moonLux === il.moonLux, 'illum＝calc.illum');
      chk(now.site.s === O.s && now.site.az === O.az && now.site.g === O.g && now.site.zone === O.zone && now.site.id === id, 'site');
      const cal = now.cal;
      chk(cal.N === c.N && cal.cyc === c.cyc && cal.festival === c.festival && cal.wd === c.wd && cal.hour === sk.hour &&
        cal.season === so.season && cal.seasonDay === so.n && cal.moonState === sk.moon.state && cal.moonNight === mn.night, 'cal');
      chk(now.calText === W.fmtCal(cal, 'full'), 'calText');
    }
  }
  ok(bad.length === 0, `${n} 个随机时刻、5 个地点：now 各字段与 HY.astro／HY.calc 一致` + (bad.length ? '（' + bad.slice(0, 5).join('；') + '）' : ''));
  S._resetForTest(); M.rebuild(); evs();
}

section('3 D1 默认时刻的读数');
{
  const n = M.tick();
  ok(n.cal.N === 10018 && n.cal.wd === 294 && n.season === '夏' && n.seasonDay === 114 && n.moon.state === '亮月', 'D1：第 10018 年、入冬后第 294 日、夏第 114 日、亮月');
  ok(n.cal.festival && n.cal.cyc === 1, 'D1 在庆典年');
  ok(n.moon.night >= 8, `D1：亮月第 ${n.moon.night} 夜`);
  eq(n.hhmm, '21:00', 'D1 21 时');
  ok(/^第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日 · 夏第 114 日 · 亮月第 \d+ 夜$/.test(n.calText), 'calText：' + n.calText);
}

section('4 tick 同输入不重算');
{
  const sky0 = A.sky; let calls = 0;
  A.sky = function () { calls++; return sky0.apply(this, arguments); };
  const a = M.tick(), b = M.tick();
  ok(a === b && calls === 0, '同一 (t, pv, siteKey)：返回同一个对象、不调 HY.astro.sky');
  S.set('time.t', HY.state.time.t + 0.01, 'api');
  const c = M.tick();
  ok(c !== a && calls === 1, '改 t：重算一次');
  M.tick();
  eq(calls, 1, '再调不重算');
  A.sky = sky0;
}

section('5 改参数：pv 加一、缓存清空、now 跟着变');
{
  let runs = 0;
  M.cached('x', [1], () => ++runs); M.cached('x', [1], () => ++runs);
  eq(runs, 1, 'cached 命中');
  const pv = M.pv, nh = M.tick().nightH, k0 = M.cacheSize();
  ok(k0 >= 1, '缓存里有东西');
  evs();
  S.set('astro.o.dS', 700, 'ui');
  ok(M.pv === pv + 1 && M.P.dS === 700, '改 astro.o.dS：pv 加一、P.dS＝700');
  eq(M.cacheSize(), 0, '缓存清空');
  ok(M.tick().nightH !== nh, 'now.nightH 变了');
  near(M.tick().nightH, (1 - A.dayFraction(M.O.r, M.P)) * 24, 1e-12, '新 nightH 按新 P 算');
  const ev = evs();
  ok(ev.length === 1 && ev[0].what === 'P' && ev[0].pv === M.pv, '发一次 model {what:"P"}');
  M.cached('x', [1], () => ++runs);
  eq(runs, 2, 'P 变了缓存重算');
  S.set('astro.o.dS', null, 'ui');
  eq(M.P.dS, 640, '删覆盖项回到默认');
  // LRU 16 项
  for (let i = 0; i < 20; i++) M.cached('lru', [i], () => i);
  eq(M.cacheSize(), 16, '缓存至多 16 项');
  let r = 0; M.cached('lru', [0], () => { r++; return 0; });
  eq(r, 1, '最早的被挤掉');
  r = 0; M.cached('lru', [19], () => { r++; return 19; });
  eq(r, 0, '最近的还在');
  evs();
}

section('6 改地点只重建 O');
{
  const pv = M.pv, P = M.P;
  S.patch('site', { id: 'yimeite', s: 4000, az: 2 }, 'ui');
  ok(M.pv === pv && M.P === P, 'pv、P 不变');
  ok(M.O.id === 'yimeite' && M.O.name === '伊美忒' && M.O.zone.id === 'plain' && M.O.az === 2, 'O 重建');
  const ev = evs();
  ok(ev.length === 1 && ev[0].what === 'site', '发一次 model {what:"site"}');
  eq(M.tick().site.id, 'yimeite', 'now 跟着换地点');
  S.patch('site', { id: null, s: 5000, az: 33 }, 'ui');
  ok(M.O.name === '自定义地点' && M.O.short === '此地' && M.O.id === null, '自定义地点');
  // 同一 t、同一 pv，换地点也要重算
  const a = M.tick(); S.set('site.az', 34, 'ui'); ok(M.tick() !== a && M.tick().site.az === 34, '换地点后 now 重算');
  S._resetForTest(); M.rebuild(); evs();
}

section('7 链接规则、预设、定标、大气、分域');
{
  S.set('astro.o.A', 4000, 'ui');
  near(M.P.A, M.P.R / 2, 1e-6, 'linkA 为真：用户的 A 不生效（A 由回归纬线推）');
  S.set('astro.linkA', false, 'ui');
  ok(M.P.A === 4000 && M.P.rM === 4000, 'linkA 关：A＝4000；linkRM 为真时 rM 跟随 A');
  S.set('astro.o.rM', 3000, 'ui');
  eq(M.P.rM, 4000, 'linkRM 为真：用户的 rM 不生效');
  S.set('astro.linkRM', false, 'ui');
  eq(M.P.rM, 3000, 'linkRM 关：rM＝3000');
  S.reset('astro', 'ui');
  near(M.P.A, M.P.R / 2, 1e-6, '恢复默认');
  S.set('astro.o.sTrop', 6000, 'ui');
  near(M.P.A, M.P.R * Math.cos(6000 / M.P.R), 1e-9, '改回归纬线：A 跟着推');
  near(M.P.rM, M.P.A, 1e-9, 'rM 跟随 A');
  S.reset('astro', 'ui');
  S.set('astro.preset', 'bing', 'ui');
  ok(Math.abs(M.P.A - 0.7 * 6371) < 1e-9 && M.P.rM === 3000 && M.P.rhoM === 90, 'bing 预设：A＝0.7R、rM＝3000、ρM＝90（链接只管用户覆盖项，不动预设）');
  S.set('astro.o.rhoM', 120, 'ui');
  eq(M.P.rhoM, 120, '预设之上还可覆盖');
  S.reset('astro', 'ui');
  eq(M.P.rhoM, 100, '恢复默认');
  S.set('astro.calib', '1361', 'ui');
  ok(M.P.Sref === 1361 && Math.abs(M.P.Eref - 1361 * M.P.efficacy) < 1e-6, '定标 1361：Sref＝1361，Eref＝1361×光视效能');
  ok(M.tick().illum.sunLux > 0 || M.tick().illum.moonLux >= 0, 'now 照度照常');
  S.set('astro.calib', '5772K', 'ui');
  near(M.P.Sref, 767, 2, '定标改回 5772 K');
  S.set('astro.o.pMoon', 0.12, 'ui');
  eq(M.P.pMoon, 0.12, '月面反照率可改');
  S.reset('astro', 'ui'); evs();
  const pv = M.pv;
  S.set('fp.atmo.HR', 60, 'ui');
  ok(M.pv === pv + 1 && M.P.H === 60 && Math.abs(M.P.tauV - 3.912 * 60 / M.P.V) < 1e-12, '改 fp.atmo.HR：重建 P、τ 跟着变');
  S.set('fp.atmo.V', 250, 'ui');
  ok(M.pv === pv + 2 && M.P.V === 250, '改 fp.atmo.V：重建 P');
  const pv2 = M.pv;
  S.set('fp.set.yuxiLead', 30, 'ui');
  eq(M.pv, pv2, '改 fp 的别的字段不重建 P');
  S.reset('fp', 'ui');
  eq(M.pv, pv2 + 1, '恢复 fp 默认：H、V 变回去，重建一次');
  S.reset('fp', 'ui');
  eq(M.pv, pv2 + 1, '再恢复一次（H、V 没变）不重建');
  evs();
  const pv3 = M.pv;
  S.set('zones.gLight', 0.8, 'ui');
  ok(M.pv === pv3 + 1 && M.Z.gLight === 0.8, '改分域：重建、Z 跟着变');
  S.patch('site', { id: 'shengjin', s: 3600, az: 0 }, 'ui');
  eq(M.O.zone.id, 'light', '圣禁城在 gLight＝0.8 时仍是轻域');
  S.set('zones.gLight', 0.74, 'ui');
  eq(M.O.zone.id, 'plain', 'gLight＝0.74：圣禁城变成平域（分界在它北边）');
  ok(evs().some(e => e.what === 'P'), '发 model {what:"P"}');
  S._resetForTest(); M.rebuild(); evs();
}

section('8 年号口径');
{
  const t = HY.state.time.t;
  eq(M.tick().date.N, 10018, 'civil：D1 在第 10018 年');
  W.CAL.yearStart = 'winter';
  eq(M.tick().date.N, 10017, "改口径后 tick 就跟上（'winter'：D1 在第 10017 年）");
  ok(!M.tick().cal.festival && M.tick().cal.cyc === 4, "'winter'：10017 年不是庆典年、周期第 4 年");
  W.CAL.yearStart = 'civil';
  eq(M.tick().date.N, 10018, '改回 civil');
  eq(HY.state.time.t, t, '口径不改内部时间');
  W.addCalStyle('modelTest', (c, form) => form + '/' + c.N + '/' + c.wd);
  W.CAL.style = 'modelTest';
  eq(M.tick().calText, 'full/10018/294', '换历法格式函数后 tick 就跟上（calText 用新写法）');
  W.CAL.style = 'draft';
  ok(/^第 10018 年/.test(M.tick().calText), '格式函数改回');
}

section('9 R 改了，地点跟着夹回（store 补发 site 事件）');
{
  S.patch('site', { id: 'far', s: 0.72 * Math.PI * 6371, az: 180 }, 'ui'); evs();
  S.set('astro.o.R', 5000, 'ui');
  ok(M.P.R === 5000 && M.O.s <= Math.PI * 5000 + 1e-9, 'R＝5000：地点 s 不超过半周');
  ok(isFinite(M.tick().sun.el) && isFinite(M.tick().moon.el), 'now 照常');
  S._resetForTest(); M.rebuild();
}

T.done();
