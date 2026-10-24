#!/usr/bin/env node
/* store_check —— HY.store 契约自检（规格：spec/03 第三节、第十一节第 1 条；负责：M1／核心） */
'use strict';
const load = require('./_load.js');
const HY = load({ upto: 'core/store.js' });
const T = load.tester('store_check');
const { ok, eq, near, throws, section } = T;
const S = HY.store, U = HY.util, bus = HY.bus;

// 把告警收起来，免得刷屏；断言里要看它
const warns = [];
console.warn = (...a) => warns.push(a.join(' '));
function fresh() { S._resetForTest(); U.storage.use(null); warns.length = 0; }
function record(evts) {
  const got = [];
  const offs = evts.map(e => bus.on(e, p => got.push({ e, p })));
  return { got, stop: () => offs.forEach(f => f()) };
}

section('1 默认值齐全且在范围内');
{
  fresh();
  let n = 0;
  for (const [p, sp] of Object.entries(S.SCHEMA)) {
    ok(sp.type && ['num', 'bool', 'enum', 'str', 'obj'].includes(sp.type), p + ' 有合法 type');
    if (sp.opt) { ok(sp.def === null && U.getPath(HY.state, p) === undefined, p + ' 是覆盖项，默认缺省'); continue; }
    const v = U.getPath(HY.state, p);
    ok(v !== undefined, p + ' 有默认值');
    if (sp.type === 'num') {
      ok(typeof v === 'number' && isFinite(v), p + ' 默认是有限数');
      ok(v >= sp.min && v <= sp.max, `${p} 默认 ${v} 在 [${sp.min}, ${sp.max}] 内`);
      ok(sp.step > 0, p + ' 有 step');
    }
    if (sp.type === 'enum') ok(sp.opts.includes(v), p + ' 默认在 opts 里');
    if (sp.type === 'bool') ok(typeof v === 'boolean', p + ' 默认是布尔');
    n++;
  }
  console.log(`  ${Object.keys(S.SCHEMA).length} 条，其中有默认值的 ${n} 条`);
  // 与附录 A（及统筹修订）逐项对照
  const A = HY.astro, P = A.params();
  near(HY.state.time.t, A.tOf(10018, 8, 24, 21, -4, P), 1e-9, 'time.t 默认＝罪域 D1 夜 21 时（HY.world.MARKS.d1）');
  const want = {
    time: { playing: false, speed: { ov: 86400, fp: 1 } },
    site: { id: 'zuiyu', s: 6670, az: -4 }, view: { mode: 'ov' },
    ov: { preset: 'oblique', cam: null, cut: 'half', frame: 'ground', helix: 'mirror', helixTurns: 12, sunGapX: 1, bodyScale: 3,
      trails: true, shadowVol: true, grid: true, labels: true, sites: true, stars: true, sight: true, showMoon: true },
    fp: { quality: 'mid', dynRes: true, yaw: 0, pitch: 15, fov: 55, eye: 1.6, bob: true, hud: true, cross: false,
      atmo: { on: true, HR: 40, HM: 6, V: 200, g: 0.76 },
      cloud: { on: true, cover: 0.42, base: 1.5, top: 6.5, sigma: 22, rui: 1, ruiBase: 1.2, ruiTop: 6, ruiTau: 60, rain: 0.03, wind: 1 },
      ground: { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220, abyssFog: true, wet: 0.7 },
      set: { veil: false, veilK: 0.3, dayComp: 1, acid: false, acidExt: 0.3, acidOmega: 0.8, yuxi: 'auto', yuxiLead: 45, sheathN0: 0, sheathHt: 20, towerAlb: 0 },
      eyeo: { auto: true, evLock: 12, evComp: 0, cat: 0.7, scotopic: true, tone: 'agx', glare: 1 } },
    astro: { preset: 'default', o: {}, linkA: true, linkRM: true, calib: '5772K' },
    zones: { gLight: 0.75, gHeavy: 1.2, limboKm: 333 },
    ui: { tab: 'site', panel: true, chrome: true, open: {} }
  };
  const got = U.clone(HY.state); delete got.time.t;
  ok(U.equal(got, want), '默认状态树与附录 A（含统筹修订：夜幕开关 veil＝关、强度 0.3；地面默认阶地）一致');
  if (!U.equal(got, want)) console.log(JSON.stringify(got));
  eq(S.SCHEMA['fp.set.veil'].setting, true, 'fp.set.veil 标为“设定”');
  ok(Object.keys(S.SCHEMA).filter(p => /^fp\.set\./.test(p)).every(p => S.SCHEMA[p].setting), 'fp.set.* 全部标为“设定”');
}

section('2 set：夹取、取整、折回、枚举校验、类型');
{
  fresh();
  eq(S.set('fp.atmo.HR', 999, 'ui'), 80, 'HR 超上限夹到 80');
  eq(S.set('fp.atmo.HR', -5, 'ui'), 4, 'HR 低于下限夹到 4');
  eq(S.set('fp.atmo.HR', '25', 'ui'), 25, '数字字符串可接受');
  eq(S.set('ov.helixTurns', 12.6, 'ui'), 13, 'int 字段取整');
  eq(S.set('site.az', 190, 'ui'), -170, '方位折回 (−180, 180]');
  eq(S.set('site.az', -180, 'ui'), 180, '−180 折成 180');
  warns.length = 0;
  eq(S.set('ov.cut', 'bogus', 'ui'), 'half', '枚举不在 opts 里：丢弃、值不变');
  ok(warns.some(w => w.includes('ov.cut')), '枚举非法时控制台告警');
  eq(S.set('fp.atmo.HR', NaN, 'ui'), 25, 'NaN 拒收');
  eq(S.set('fp.bob', 0, 'ui'), false, '0/1 可当布尔');
  eq(S.set('site.id', null, 'walk'), null, 'site.id 可为 null');
  eq(S.set('nope.path', 1, 'ui'), undefined, '未登记路径拒收');
  eq(S.set('ui.open.天体', true, 'ui'), true, 'free 对象可写子键');
  eq(HY.state.ui.open['天体'], true, 'ui.open 子键写入');
}

section('3 事件：同值不发、载荷形状、patch 只发一次、监听器抛错不影响别人');
{
  fresh();
  const r = record(['fp', 'site', 'time', 'view']);
  S.set('fp.atmo.HR', 40, 'ui');
  eq(r.got.length, 0, '同值不发事件');
  S.set('fp.atmo.HR', 30, 'ui');
  eq(r.got.length, 1, '改值发一次');
  const p = r.got[0];
  ok(p.e === 'fp' && p.p.path === 'fp.atmo.HR' && p.p.value === 30 && p.p.prev === 40 && p.p.src === 'ui', '以顶层键为事件名，载荷 {path, value, prev, src}');
  r.got.length = 0;
  S.patch('site', { id: null, s: 5000, az: 10 }, 'ov');
  eq(r.got.length, 1, 'patch 只发一次事件');
  ok(r.got[0].p.value.s === 5000 && r.got[0].p.prev.s === 6670 && r.got[0].p.paths.length === 3, 'patch 载荷带新旧子树与改动路径');
  r.got.length = 0;
  S.patch('site', { id: null, s: 5000, az: 10 }, 'ov');
  eq(r.got.length, 0, 'patch 无改动不发');
  S.set('time.t', 1.5, 'play');
  ok(r.got.length === 1 && r.got[0].p.path === 'time.t' && r.got[0].p.src === 'play', 'time 事件载荷 {path:time.t, value, prev, src}');
  S.set('view.mode', 'fp', 'api');
  ok(r.got[1] && r.got[1].e === 'view' && r.got[1].p.value === 'fp' && r.got[1].p.prev === 'ov', 'view 事件 {value, prev}');
  r.stop();
  // 监听器抛错
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a);
  let hit = 0;
  const o1 = bus.on('zones', () => { throw new Error('故意'); });
  const o2 = bus.on('zones', () => { hit++; });
  S.set('zones.limboKm', 400, 'ui');
  console.error = ce; o1(); o2();
  ok(hit === 1 && errs.length === 1, '一个监听器抛错只记日志，其它照常收到');
  // once 与 off
  let n = 0; bus.once('ui', () => n++); S.set('ui.tab', 'year', 'ui'); S.set('ui.tab', 'site', 'ui');
  eq(n, 1, 'once 只触发一次');
  let w = 0; const ow = bus.on('*', (pl, e) => { if (e === 'ov') w++; }); S.set('ov.grid', false, 'ui'); ow();
  eq(w, 1, "'*' 收到全部事件并带事件名");
}

section('4 跨字段约束：夹到边界并发 error{part:params}');
{
  fresh();
  const r = record(['error']);
  eq(S.set('zones.gLight', 1.5, 'ui'), 1.18, 'gLight 夹到 gHeavy−0.02');
  S.set('zones.gHeavy', 0.5, 'ui');
  near(HY.state.zones.gHeavy, 1.2, 1e-12, 'gHeavy 夹到 gLight+0.02');
  ok(r.got.length >= 2 && r.got.every(x => x.p.part === 'params'), '违反约束时发 error{part:params}');
  S.patch('zones', { gLight: 1.5, gHeavy: 1.9 }, 'ui');
  ok(HY.state.zones.gLight === 1.5 && HY.state.zones.gHeavy === 1.9, 'patch 同时改两个受约束字段：先写后夹，不误伤');
  S.set('astro.o.dS', 610, 'ui');
  eq(HY.state.astro.o.dS, 625, 'dS ≥ a + ρS + 5（a=600, ρS=20）');
  S.set('astro.o.a', 1000, 'ui');
  eq(HY.state.astro.o.a, 600, 'a 受 dS 限制：a ≤ dS − ρS − 5');
  S.set('astro.o.rM', 600, 'ui');
  ok(HY.state.astro.o.rM > 650 && HY.state.astro.o.rM < 1801, 'rM > a + 50（并受 SCHEMA 下限 1800 约束）');
  eq(HY.state.astro.o.rM, 1800, 'rM 夹到 SCHEMA 下限 1800');
  S.patch('astro.o', { a: 900, dS: 1000 }, 'ui');
  ok(HY.state.astro.o.a === 900 && HY.state.astro.o.dS === 1000, 'astro.o 同时改 a、dS 不误伤');
  S.set('site.s', 30000, 'ui');
  near(HY.state.site.s, Math.PI * 6371, 1e-6, 'site.s 不超过 πR');
  S.set('astro.o.R', 4000, 'ui');
  near(HY.state.site.s, Math.PI * 4000, 1e-6, '改 R 后 site.s 跟着夹回 πR');
  r.stop();
}

section('5 覆盖项 astro.o：写 null 删除；整组覆盖');
{
  fresh();
  S.set('astro.o.pMoon', 0.12, 'ui');
  eq(HY.state.astro.o.pMoon, 0.12, '写覆盖项');
  const r = record(['astro']);
  S.set('astro.o.pMoon', null, 'ui');
  ok(!('pMoon' in HY.state.astro.o) && r.got.length === 1 && r.got[0].p.value === null, '写 null＝删除并发事件');
  S.set('astro.o.pMoon', null, 'ui');
  eq(r.got.length, 1, '删除不存在的覆盖项不发事件');
  S.set('astro.o', { dS: 700, rhoS: 25, bogus: 3 }, 'ui');
  ok(U.equal(HY.state.astro.o, { dS: 700, rhoS: 25 }), '整组覆盖：只留认识的子键');
  S.set('astro.o', { Y: 330 }, 'ui');
  ok(U.equal(HY.state.astro.o, { Y: 330 }), '整组覆盖：没给的子键删掉');
  r.stop();
}

section('6 reset(scope) 只动该前缀');
{
  fresh();
  S.set('fp.atmo.HR', 20, 'ui'); S.set('fp.cloud.cover', 0.9, 'ui'); S.set('astro.o.dS', 700, 'ui'); S.set('ui.tab', 'params', 'ui'); S.set('view.mode', 'fp', 'ui');
  const r = record(['fp', 'astro']);
  S.reset('fp.atmo');
  ok(HY.state.fp.atmo.HR === 40 && HY.state.fp.cloud.cover === 0.9, "reset('fp.atmo') 只恢复大气");
  eq(r.got.length, 1, 'reset 每个顶层键发一次');
  S.reset('astro');
  ok(U.equal(HY.state.astro.o, {}), "reset('astro') 清空覆盖项");
  S.reset(null, 'reset', ['view.mode', 'ui']);
  ok(HY.state.fp.cloud.cover === 0.42 && HY.state.ui.tab === 'params' && HY.state.view.mode === 'fp', '全部恢复默认时保留 view.mode 与 ui.*');
  S.reset();
  ok(U.equal(U.clone(HY.state), S.defaults()), 'reset() 与 SCHEMA 默认深度相等');
  r.stop();
}

section('7 持久化：往返、只存 persist 字段、坏数据整体丢弃、手机默认低档');
{
  fresh();
  ok(U.storage.kind() === 'memory', 'node 里存储退回内存');
  S.set('fp.atmo.HR', 22, 'ui'); S.set('astro.o.pMoon', 0.12, 'ui'); S.set('time.playing', true, 'ui'); S.set('ui.chrome', false, 'ui');
  S.set('ov.cam', { pos: [1, 2, 3], target: [0, 0, 0] }, 'ov'); S.set('ui.open.天体', true, 'ui');
  ok(S.pendingSave(), 'set 之后安排了防抖保存');
  S.flush();
  ok(!S.pendingSave(), 'flush 立即写');
  const raw = JSON.parse(U.storage.get(S.KEY));
  ok(raw.v === 3 && raw.state.fp.atmo.HR === 22, '存档 {v:3, state}，键 ' + S.KEY);
  ok(raw.state.time.playing === undefined && raw.state.ui.chrome === undefined, 'persist 为假的字段不写入');
  S._resetForTest();
  const r = record(['fp', 'astro', 'ov']);
  const res = S.load();
  ok(res.ok && HY.state.fp.atmo.HR === 22 && HY.state.astro.o.pMoon === 0.12, '读回持久字段');
  ok(U.equal(HY.state.ov.cam, { pos: [1, 2, 3], target: [0, 0, 0] }) && HY.state.ui.open['天体'] === true, '读回对象字段');
  ok(HY.state.time.playing === false && HY.state.ui.chrome === true, '非持久字段保持默认');
  ok(r.got.length === 3 && r.got.every(x => x.p.src === 'load'), "读档以 src:'load' 发事件");
  r.stop();
  // 坏 JSON
  S._resetForTest(); U.storage.set(S.KEY, '{坏');
  let x = S.load();
  ok(!x.ok && HY.state.fp.atmo.HR === 40 && U.storage.get(S.KEY) === null, '坏 JSON 整体丢弃、用默认');
  // 旧版本
  S._resetForTest(); U.storage.set(S.KEY, JSON.stringify({ v: 2, state: { fp: { atmo: { HR: 9 } } } }));
  x = S.load();
  ok(!x.ok && HY.state.fp.atmo.HR === 40, '版本号不符整体丢弃');
  // 单个字段无效
  S._resetForTest(); U.storage.set(S.KEY, JSON.stringify({ v: 3, state: { ov: { cut: 'xx', grid: false }, zones: { gLight: 2, gHeavy: 2.5 } } }));
  x = S.load();
  ok(x.ok && HY.state.ov.cut === 'half' && HY.state.ov.grid === false, '单个无效字段只丢该字段');
  ok(HY.state.zones.gLight === 2 && HY.state.zones.gHeavy === 2.5, '读档时受约束字段按全体复核，不因先后顺序误夹');
  // 手机
  S._resetForTest(); U.storage.use(null);
  S.load({ mobile: true });
  eq(HY.state.fp.quality, 'low', '手机首次启动 fp.quality 默认 low');
  S._resetForTest(); U.storage.set(S.KEY, JSON.stringify({ v: 3, state: { fp: { quality: 'high' } } }));
  S.load({ mobile: true });
  eq(HY.state.fp.quality, 'high', '手机上存过档位则用存档');
  // 存储抛错
  S._resetForTest();
  U.storage.use({ getItem() { throw new Error('禁用'); }, setItem() { throw new Error('禁用'); }, removeItem() { throw new Error('禁用'); } });
  let threw = false;
  try { S.load(); S.set('fp.atmo.HR', 33, 'ui'); S.flush(); } catch (e) { threw = true; }
  ok(!threw, 'localStorage 抛错时静默退回内存');
  U.storage.use(null);
}

section('8 extendSchema：在自己的文件里登记新状态');
{
  fresh();
  S.extendSchema({ 'fp.debug.passTimes': { def: false, type: 'bool', persist: false } });
  eq(HY.state.fp.debug.passTimes, false, '新路径带默认值');
  eq(S.set('fp.debug.passTimes', true, 'ui'), true, '新路径可写');
  S.extendSchema({ 'fp.debug.passTimes': { def: false, type: 'bool', persist: false } });
  ok(true, '同样的定义重复登记不报错');
  throws(() => S.extendSchema({ 'fp.debug.passTimes': { def: true, type: 'bool' } }), '定义不同则抛错');
  throws(() => S.extendSchema({ 'fp.atmo.HR.x': { def: 1, type: 'num', min: 0, max: 2, step: 1 } }), '不许挂在叶子下面');
  throws(() => S.extendSchema({ 'fp.debug.mode': { def: 'z', type: 'enum', opts: ['a'] } }), '枚举默认值须在 opts 里');
}

T.done();
