#!/usr/bin/env node
/* params_check.js —— 参数面板声明表的自检（规格：spec/03 第十一节第 1 条；统筹修订 spec/04 第二节第 2–5 条）
 * 负责：D 路（界面）。只测 HY.ui.PARAMS 等节点可测的部分，不碰 DOM。
 *   每个 path 在 SCHEMA 里；控件种类与 SCHEMA 类型对得上；范围、步长、可选值与 SCHEMA 一致（narrow 行可更窄）；
 *   每组至少一项；标了 setting 的只在“设定”组，SCHEMA 里的设定项都有控件；统筹修订的几项；约束提示；格式化。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('params_check');
const { ok, eq, near, section, done } = T;
const S = HY.store.SCHEMA, ui = HY.ui;
const CJK = /[一-鿿]/;

HY.store._resetForTest();
HY.model.rebuild();
const P0 = HY.model.P;

section('1 每行的路径都在 SCHEMA 里，控件与类型、范围、步长、可选值一致');
const seen = {};
for (const r of ui.PARAMS) {
  const sp = S[r.path], tag = r.path + '（' + r.group + '·' + r.label + '）';
  ok(!seen[r.path], '路径不重复：' + r.path); seen[r.path] = 1;
  if (!ok(sp, 'SCHEMA 里有 ' + tag)) continue;
  ok(['range', 'toggle', 'select', 'seg'].indexOf(r.kind) >= 0, tag + ' 的 kind 合法：' + r.kind);
  ok(ui.PARAM_GROUPS.indexOf(r.group) >= 0, tag + ' 的组在 PARAM_GROUPS 里');
  ok(typeof r.label === 'string' && CJK.test(r.label), tag + ' 有中文标签');
  if (r.kind === 'range') {
    eq(sp.type, 'num', tag + ' 是数');
    ok(isFinite(r.min) && isFinite(r.max) && r.min < r.max, tag + ' 有 min < max');
    if (r.narrow) ok(r.min >= sp.min && r.max <= sp.max, tag + ' 标了 narrow：范围在 SCHEMA 之内');
    else { eq(r.min, sp.min, tag + ' min 与 SCHEMA 一致'); eq(r.max, sp.max, tag + ' max 与 SCHEMA 一致'); }
    if (sp.step) {
      const k = r.step / sp.step;
      ok(Math.abs(k - Math.round(k)) < 1e-9 && k >= 1, tag + ' 步长是 SCHEMA 步长的整数倍（' + r.step + ' / ' + sp.step + '）');
    }
    if (r.dyn) {
      const b = r.dyn(P0);
      ok(Array.isArray(b) && b[0] >= sp.min && b[1] <= sp.max && b[0] < b[1], tag + ' 的 dyn 范围在 SCHEMA 之内：' + b);
    }
  } else if (r.kind === 'toggle') {
    eq(sp.type, 'bool', tag + ' 是布尔');
  } else {
    eq(sp.type, 'enum', tag + ' 是枚举');
    const vs = (r.opts || []).map(o => o.v);
    eq(vs.slice().sort().join('|'), sp.opts.slice().sort().join('|'), tag + ' 的可选值与 SCHEMA 一致');
    ok((r.opts || []).every(o => CJK.test(o.label) || /^[A-Za-z0-9 ×./²]+$/.test(o.label)), tag + ' 的选项有标签');
  }
  if (r.when) ok(typeof r.when(HY.state) === 'boolean', tag + ' 的 when 在默认状态下返回布尔');
  if (r.when) ok(typeof r.off === 'string' && CJK.test(r.off), tag + ' 置灰时有中文说明');
  if (r.hint) {
    const v = HY.store.get(r.path) != null ? HY.store.get(r.path) : P0[r.path.split('.').pop()];
    const h = r.hint(v, P0, HY.state);
    ok(typeof h === 'string' && h.length > 0, tag + ' 的 hint 能算出文字：' + h);
  }
}

section('2 每组至少一项；setting 只在“设定”组；SCHEMA 里的设定项都有控件');
for (const g of ui.PARAM_GROUPS) ok(ui.PARAMS.some(r => r.group === g), '组“' + g + '”至少一项');
ok(ui.PARAMS.filter(r => r.setting).every(r => r.group === '设定'), '标了 setting 的都在“设定”组');
ok(ui.PARAMS.filter(r => r.group === '设定').every(r => r.setting), '“设定”组的每一项都标了 setting');
for (const p of Object.keys(S)) {
  if (!S[p].setting) continue;
  const r = ui.PARAMS.find(x => x.path === p);
  ok(r && r.setting && r.group === '设定', 'SCHEMA 的设定项有控件且在“设定”组：' + p);
}
for (const r of ui.PARAMS) if (r.setting) ok(S[r.path].setting === true, '标了 setting 的控件，SCHEMA 也标了设定：' + r.path);
// 设定类开关默认关（03 第十二节第 9 条）
for (const p of Object.keys(S)) if (S[p].setting && S[p].type === 'bool') eq(S[p].def, false, '设定开关默认关：' + p);

section('3 覆盖 03 第九节第 5 条：天体、星体与分域、总览显示');
const need = {
  '天体': ['astro.preset', 'astro.o.dS', 'astro.o.rhoS', 'astro.o.sTrop', 'astro.o.A', 'astro.o.rM', 'astro.o.rhoM', 'astro.o.Y', 'astro.o.lunPerYear', 'astro.calib', 'astro.o.pMoon', 'astro.o.epochAz', 'astro.linkA', 'astro.linkRM'],
  '星体与分域': ['astro.o.R', 'astro.o.a', 'astro.o.gEq', 'zones.gLight', 'zones.gHeavy', 'zones.limboKm'],
  '总览显示': ['ov.helix', 'ov.helixTurns', 'ov.sunGapX', 'ov.bodyScale', 'ov.frame', 'ov.cut', 'ov.trails', 'ov.shadowVol', 'ov.grid', 'ov.labels', 'ov.sites', 'ov.stars', 'ov.sight', 'ov.showMoon']
};
for (const g of Object.keys(need)) for (const p of need[g]) {
  const r = ui.PARAMS.find(x => x.path === p);
  ok(r && r.group === g, '“' + g + '”组里有 ' + p);
}
// 第一人称各组（02 第十七节第 5 条、附录 A）：fp.* 里除了第一人称自己写回的 yaw／pitch 以外都要有控件
for (const p of Object.keys(S)) {
  if (!/^fp\./.test(p) || p === 'fp.yaw' || p === 'fp.pitch') continue;
  ok(ui.PARAMS.some(r => r.path === p), '第一人称参数有控件：' + p);
}
// 取消的两个滑杆（03 第九节第 5 条末段）
ok(!ui.PARAMS.some(r => /dayHours|winterFrac/.test(r.path)), '没有“冬占全年”“一日几小时”');

section('4 统筹修订');
const calib = ui.PARAMS.find(r => r.path === 'astro.calib'), pm = ui.PARAMS.find(r => r.path === 'astro.o.pMoon');
ok(calib && calib.advanced, '光度定标在“高级”里'); eq(S['astro.calib'].def, '5772K', '光度定标默认 5772 K');
ok(pm && pm.advanced, '月面反照率在“高级”里'); near(P0.pMoon, 0.6, 1e-12, '月面反照率默认 0.6');
const veil = ui.PARAMS.find(r => r.path === 'fp.set.veil'), vk = ui.PARAMS.find(r => r.path === 'fp.set.veilK');
ok(veil && veil.kind === 'toggle' && veil.setting, '静滞夜幕是“设定”开关'); eq(S['fp.set.veil'].def, false, '静滞夜幕默认关（如实画白夜）');
ok(vk && vk.kind === 'range' && vk.setting && vk.when, '夜幕强度是滑杆，只在开关打开时可调');
eq(vk.when(HY.state), false, '默认时夜幕强度置灰');
HY.store.set('fp.set.veil', true, 'api'); eq(vk.when(HY.state), true, '打开静滞夜幕后强度可调'); HY.store.set('fp.set.veil', false, 'api');
const gm = ui.PARAMS.find(r => r.path === 'fp.ground.mode');
ok(gm && gm.kind === 'seg', '地面模式是分段按钮'); eq(S['fp.ground.mode'].def, 'terrace', '地面默认阶地');
ok(gm.opts.some(o => o.v === 'slope' && o.label === '顺着球面的斜坡'), '斜坡模式叫“顺着球面的斜坡”');
eq(ui.PARAMS.find(r => r.path === 'fp.ground.W').when(HY.state), true, '阶地时踏面宽可调');
HY.store.set('fp.ground.mode', 'slope', 'api');
eq(ui.PARAMS.find(r => r.path === 'fp.ground.W').when(HY.state), false, '斜坡时踏面宽置灰');
HY.store.set('fp.ground.mode', 'terrace', 'api');
ok(ui.PARAMS.filter(r => r.advanced).every(r => r.group === '天体'), '“高级”只在天体组（定标、反照率）');

section('5 文案：中文引号，不用直引号');
function texts(r) { return [r.label, r.note, r.off, r.unit].concat((r.opts || []).map(o => o.label)).filter(x => typeof x === 'string'); }
for (const r of ui.PARAMS) for (const s of texts(r)) ok(!/["']/.test(s), '没有直引号：' + r.path + '：' + s);
for (const g of Object.keys(ui.PARAM_GROUP_NOTES)) {
  ok(ui.PARAM_GROUPS.indexOf(g) >= 0, '组说明对应的组存在：' + g);
  ok(!/["']/.test(ui.PARAM_GROUP_NOTES[g]), '组说明没有直引号：' + g);
}

section('6 组里的快捷动作');
for (const a of ui.PARAM_ACTIONS) {
  ok(ui.PARAM_GROUPS.indexOf(a.group) >= 0, '快捷动作的组存在：' + a.label);
  const base = Object.keys(a.patch).map(p => p.split('.').slice(0, -1).join('.'));
  ok(base.every(b => b === base[0]), a.label + '：一次只改同一组（用 patch 写）');
  for (const p of Object.keys(a.patch)) {
    const sp = S[p];
    ok(sp && sp.type === 'num' && a.patch[p] >= sp.min && a.patch[p] <= sp.max, a.label + '：' + p + '＝' + a.patch[p] + ' 在范围内');
  }
}

section('7 约束提示 paramWarnings');
eq(ui.paramWarnings(HY.state, P0).length, 0, '默认参数下没有黄字');
function warnWith(o, extra) {
  const st = JSON.parse(JSON.stringify(HY.state)); st.astro.o = Object.assign({}, o); Object.assign(st.astro, extra || {});
  return ui.paramWarnings(st, HY.model.paramsFrom(st));
}
let w = warnWith({ lunPerYear: 12.5 });
ok(w.some(s => /¼/.test(s)), '一年 12.5 个月：提示四年节律不成立：' + w.join('｜'));
w = warnWith({ a: 1700, dS: 1800, rM: 1800 }, { linkRM: false });
ok(w.some(s => /黑月半角/.test(s)), '月轨太近：提示黑月半角不足 90°：' + w.join('｜'));
w = warnWith({ Y: 365 });
ok(w.some(s => /365/.test(s)), '一年 365 日：提示日期对不齐');
w = warnWith({ A: 3000 }, { linkA: false });
ok(w.some(s => /回归线/.test(s)), '振幅脱钩：提示罪域不再是回归线');
ok(ui.paramWarnings(null, null).length === 0, '没有 P 时不报错、返回空表');

section('8 格式化 HY.ui.fmt');
const F = ui.fmt;
eq(F.lux(123456), '123 klux', '大照度写 klux');
eq(F.lux(2345), '2.3 klux', '千级写一位小数');
eq(F.lux(56.7), '57 lux', '十级取整');
eq(F.lux(0.25), '0.25 lux', '小于 10 写两位小数');
eq(F.lux(NaN), '—', '非数写破折号');
eq(F.lux(0.025), '0.025 lux', '小于 0.1 写小数，不写科学计数');
eq(F.lux(3e-6), '3.0e−6 lux', '极小时才用科学计数（中文负号）');
eq(F.lux(0), '0 lux', '零');
eq(F.moonShort({ state: '亮月', k: 0.816 }), '亮月 82%', '月：亮月写亮面');
eq(F.moonShort({ state: '灰月', k: 0.9, sunlit: 0.3 }), '灰月 27%', '月：灰月写亮面×月心受照');
eq(F.moonShort({ state: '黑月', k: 0.45, sunlit: 0, blackHigh: false }), '黑月', '月：黑月不写百分比');
eq(F.moonShort({ state: '黑月', k: 0.45, sunlit: 0, blackHigh: true }), '黑月 · 高悬', '月：黑月高悬');
eq(F.moonShort(null), '—', '月：没有数据');
eq(F.luxEarth(80000), '晴天正午', '对照：晴天正午');
eq(F.luxEarth(3000), '阴天、日出后不久', '对照：10³–10⁴');
eq(F.luxEarth(0.3), '满月夜', '对照：满月');
eq(F.luxEarth(0.01), '星光', '对照：星光');
eq(F.hoff(0), '正对塔中线', '离塔中线 0');
eq(F.hoff(-3.21), '西 3.2°', '离塔中线：西');
eq(ui.unitOf({ unit: '公里' }), '公里', 'unitOf 取 unit');

section('9 addParams 与组顺序');
const n0 = ui.PARAMS.length, g0 = ui.PARAM_GROUPS.length;
ui.addParams([{ group: '调试（测试）', path: 'fp.eye', label: '测试行', kind: 'range', min: 1.2, max: 2, step: 0.05 }]);
eq(ui.PARAMS.length, n0 + 1, 'addParams 追加一行');
eq(ui.PARAM_GROUPS.length, g0 + 1, '新组排在最后');
T.throws(() => ui.addParams([{ group: '天体', label: '缺路径', kind: 'toggle' }]), '缺 path 时抛错');
ui.PARAMS.pop(); ui.PARAM_GROUPS.pop();
eq(ui.PARAMS.length, n0, '测试行已撤回');
ok(ui.PARAM_GROUPS.indexOf('设定') > ui.PARAM_GROUPS.indexOf('第一人称·地面'), '“设定”组排在第一人称各组之后');

section('10 生成器的非 DOM 部分');
ok(typeof ui.params.init === 'function' && typeof ui.params.resetAll === 'function' && typeof ui.params.resetGroup === 'function', 'init、resetAll、resetGroup 都在');
// 本组默认：改两项后恢复
HY.store.set('fp.atmo.HR', 12, 'api'); HY.store.set('fp.atmo.HM', 3, 'api');
let fired = 0; const off = HY.bus.on('fp', () => fired++);
ui.params.resetGroup('第一人称·大气');
off();
eq(HY.state.fp.atmo.HR, 40, '本组默认：空气标高回到 40'); eq(HY.state.fp.atmo.HM, 6, '本组默认：霾标高回到 6');
eq(fired, 1, '本组默认只发一次 fp 事件');
// 恢复默认：全部（保留 view、ui）
HY.store.set('view.mode', 'fp', 'api'); HY.store.set('ui.tab', 'params', 'api'); HY.store.set('astro.o.dS', 900, 'api'); HY.store.set('zones.gLight', 0.5, 'api');
ui.params.resetAll();
eq(HY.state.view.mode, 'fp', '恢复默认保留视图'); eq(HY.state.ui.tab, 'params', '恢复默认保留页签');
ok(HY.state.astro.o.dS === undefined, '恢复默认清掉天体覆盖项'); eq(HY.state.zones.gLight, 0.75, '恢复默认：分域回到默认');
const D = HY.store.defaults();
for (const k of ['time', 'site', 'ov', 'fp', 'astro', 'zones']) ok(HY.util.equal(HY.state[k], D[k]), '恢复默认后 ' + k + ' 与 SCHEMA 默认深度相等');

section('11 事件过滤 HY.ui.touches（第一人称写回朝向时别的模块不跟着重算）');
const tch = ui.touches;
eq(tch({ path: 'fp', paths: ['fp.yaw', 'fp.pitch', 'fp.fov'], src: 'fp' }, 'fp.quality'), false, '写回朝向不碰画质');
eq(tch({ path: 'fp', paths: ['fp.yaw', 'fp.pitch', 'fp.fov'], src: 'fp' }, 'fp.fov'), true, '写回朝向碰到视角');
eq(tch({ path: 'fp.quality', value: 'low' }, 'fp.quality'), true, 'set 同一路径');
eq(tch({ path: 'fp', src: 'reset' }, 'fp.set.yuxiLead'), true, 'reset 整个 fp 碰到其中每一项');
eq(tch({ path: 'fp.set.veil' }, 'fp.set'), true, '叶子在前缀之下');
eq(tch({ path: 'fp.setX' }, 'fp.set'), false, '前缀按点号切，不按字符');
eq(tch(null, 'fp'), false, '没有事件');
let hits = 0; const offH = HY.bus.on('fp', e => { if (tch(e, 'fp.quality')) hits++; });
HY.store.patch('fp', { yaw: 30, pitch: 10 }, 'fp'); HY.store.set('fp.quality', 'high', 'api'); HY.store.reset('fp', 'reset');
offH();
eq(hits, 2, '真实事件：朝向写回不算，set 与 reset 算');

done();
