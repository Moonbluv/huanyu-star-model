#!/usr/bin/env node
/* ui_check.js —— 界面各模块不碰 DOM 的部分（负责：D 路）
 * ui/*.js 与 app.js 不是 manifest 里的“节点可测”模块，但约定加载时不碰 DOM、不碰 THREE；
 * 这里在 node 里把它们按 manifest 次序载进来，测纯函数与只写状态的部分：
 *   快捷键映射、时间栏（速度档、跳转表、季节带、步进）、罗盘条与 HUD 文字、地点称呼、交节表、正文对照、入冬字幕、
 *   HY.app 的取数与测试接口（setTime 各种写法、setSite、play＋settle、snapshot、measure）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('./_load.js');
const HY = load();
const T = load.tester('ui_check');
const { ok, eq, near, section, done } = T;

section('1 加载：界面模块与 app.js 加载时不碰 DOM');
const m = load.manifest();
const extra = m.scripts.filter(e => e.src && !e.node && (/^ui\//.test(e.src) || e.src === 'app.js')).map(e => e.src);
ok(extra.length >= 10, '界面脚本 ' + extra.length + ' 个：' + extra.join('、'));
for (const f of extra) {
  let err = null;
  try { vm.runInThisContext(fs.readFileSync(path.join(load.SRC, f), 'utf8'), { filename: f }); } catch (e) { err = e; }
  ok(!err, f + ' 在没有 document 的环境里能加载' + (err ? '：' + err.message : ''));
}
const ui = HY.ui, A = HY.astro, W = HY.world, C = HY.calc;
for (const k of ['layout', 'timebar', 'sitecard', 'readouts', 'calendar', 'notes', 'fphud', 'keys', 'params']) {
  ok(ui[k] && ui[k].__stub === false && typeof ui[k].init === 'function', 'HY.ui.' + k + ' 已实现（不是桩）');
}
ok(typeof HY.app.boot === 'function' && typeof HY.app.fpAvail === 'function', 'HY.app 就位（node 里不自动启动）');
HY.store._resetForTest();
HY.model.rebuild();
let P = HY.model.P;

section('2 快捷键映射 HY.ui.keys.map');
const K = ui.keys;
function ev(o) { return Object.assign({ key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, o); }
function mp(o, ctx) { return JSON.stringify(K.map(ev(o), ctx || { view: 'ov', loading: false })); }
eq(mp({ key: ' ', code: 'Space' }), '{"act":"play"}', '空格＝播放／暂停');
eq(mp({ key: '1', code: 'Digit1' }), '{"act":"view","mode":"ov"}', '1＝总览');
eq(mp({ key: '2', code: 'Digit2' }), '{"act":"view","mode":"fp"}', '2＝第一人称');
eq(mp({ key: '[', code: 'BracketLeft' }), '{"act":"nudge","unit":"hour","dir":-1}', '[＝前一小时');
eq(mp({ key: ']', code: 'BracketRight' }), '{"act":"nudge","unit":"hour","dir":1}', ']＝后一小时');
eq(mp({ key: '{', code: 'BracketLeft', shiftKey: true }), '{"act":"nudge","unit":"day","dir":-1}', 'Shift+[（美式键盘打出 {）＝前一日');
eq(mp({ key: '}', code: 'BracketRight', shiftKey: true }), '{"act":"nudge","unit":"day","dir":1}', 'Shift+]＝后一日');
eq(mp({ key: '[', code: 'BracketLeft', altKey: true }), '{"act":"nudge","unit":"month","dir":-1}', 'Alt+[＝前一月');
eq(mp({ key: '“', code: 'BracketLeft', altKey: true }), '{"act":"nudge","unit":"month","dir":-1}', 'Mac 上 Alt+[ 打出的字符也认');
eq(mp({ key: '{', code: 'Digit7', altKey: true, ctrlKey: true, getModifierState: k => k === 'AltGraph' }), '{"act":"nudge","unit":"month","dir":-1}', '别的布局里单独打出 {＝前一月（AltGr 不算 Ctrl）');
eq(mp({ key: '[', code: 'BracketLeft', ctrlKey: true }), 'null', 'Ctrl 组合留给浏览器');
eq(mp({ key: 'p', code: 'KeyP' }), '{"act":"panel"}', 'P＝侧栏');
eq(mp({ key: 'H', code: 'KeyH', shiftKey: true }), '{"act":"chrome"}', 'H（大写也算）＝隐藏界面');
eq(mp({ key: 'f', code: 'KeyF' }), '{"act":"full"}', 'F＝全屏');
eq(mp({ key: 'o', code: 'KeyO' }), '{"act":"preset"}', 'O＝切总览预设');
eq(mp({ key: 'o', code: 'KeyO' }, { view: 'fp', loading: false }), 'null', '第一人称里 O 不切预设');
eq(mp({ key: 'Escape', code: 'Escape' }, { view: 'fp', loading: true }), '{"act":"cancel"}', '准备中按 Esc 取消');
eq(mp({ key: 'Escape', code: 'Escape' }, { view: 'fp', loading: false }), 'null', '第一人称里的 Esc 留给指针锁定');
eq(mp({ key: 'w', code: 'KeyW' }), 'null', 'WASD 不归这里');
ok(K.editable({ tagName: 'INPUT', type: 'number' }) && K.editable({ tagName: 'SELECT' }) && K.editable({ tagName: 'TEXTAREA' }) && K.editable({ tagName: 'DIV', isContentEditable: true }), '输入框、下拉框里不响应');
ok(!K.editable({ tagName: 'INPUT', type: 'range' }) && !K.editable({ tagName: 'BUTTON' }) && !K.editable(null), '滑杆、按钮上照常响应');
ok(K.pressable({ tagName: 'BUTTON' }) && K.pressable({ tagName: 'INPUT', type: 'checkbox' }) && !K.pressable({ tagName: 'CANVAS' }), '按钮、开关上空格留给它们');
near(K.stepDays('hour', P), 1 / 24, 1e-12, '一小时＝1/24 日'); eq(K.stepDays('day', P), 1, '一日'); near(K.stepDays('month', P), P.M, 1e-12, '一月＝朔望月');

section('3 快捷键执行 HY.ui.keys.handle（只写状态）');
function press(o, target) {
  const e = ev(o); let prevented = false;
  e.target = target || { tagName: 'BODY' }; e.preventDefault = () => { prevented = true; };
  const r = K.handle(e);
  return { r, prevented };
}
let t0 = HY.state.time.t, r;
r = press({ key: '[', code: 'BracketLeft' });
ok(r.r && r.prevented, '[ 处理了并阻止默认'); near(HY.state.time.t, t0 - 1 / 24, 1e-9, '[ 退一小时');
press({ key: '}', code: 'BracketRight', shiftKey: true }); near(HY.state.time.t, t0 - 1 / 24 + 1, 1e-9, 'Shift+] 进一日');
press({ key: ']', code: 'BracketRight', altKey: true }); near(HY.state.time.t, t0 - 1 / 24 + 1 + P.M, 1e-9, 'Alt+] 进一个朔望月');
HY.store.set('time.t', t0, 'api');
r = press({ key: ' ', code: 'Space' }); eq(HY.state.time.playing, true, '空格开始播放');
r = press({ key: ' ', code: 'Space' }, { tagName: 'BUTTON' }); ok(!r.r && HY.state.time.playing === true, '焦点在按钮上时空格不切播放');
r = press({ key: ' ', code: 'Space' }, { tagName: 'INPUT', type: 'text' }); ok(!r.r, '焦点在输入框时不响应');
press({ key: ' ', code: 'Space' }); eq(HY.state.time.playing, false, '再按空格暂停');
press({ key: 'p', code: 'KeyP' }); eq(HY.state.ui.panel, false, 'P 收起侧栏'); press({ key: 'p', code: 'KeyP' }); eq(HY.state.ui.panel, true, 'P 展开侧栏');
r = press({ key: 'p', code: 'KeyP', repeat: true }); ok(!r.r && HY.state.ui.panel === true, '按住不放不连发开合');
press({ key: 'h', code: 'KeyH' }); eq(HY.state.ui.chrome, false, 'H 隐藏界面'); press({ key: 'h', code: 'KeyH' }); eq(HY.state.ui.chrome, true, 'H 再按显示');
press({ key: 'o', code: 'KeyO' }); eq(HY.state.ov.preset, 'side', 'O 从“斜看”切到“侧看”'); eq(HY.state.ov.cam, null, '切预设时清掉自定相机');
for (let i = 0; i < 6; i++) press({ key: 'o', code: 'KeyO' });
eq(HY.state.ov.preset, 'oblique', 'O 轮换一圈回到“斜看”（跳过入冬镜头）');
// node 里没有三维：第一人称不可用。按 2 不切视图，只提示中文原因（layout.toast 打桩计数）
const toasts = [], toast0 = ui.layout.toast;
ui.layout.toast = m => { toasts.push(m); };
r = press({ key: '2', code: 'Digit2' });
ok(r.r, '2 处理了');
eq(HY.state.view.mode, 'ov', '第一人称不可用时按 2 不切视图');
ok(toasts.length === 1 && /第一人称暂不可用：/.test(toasts[0]) && /三维/.test(toasts[0]), '并提示一次中文原因：' + toasts.join('｜'));
HY.store.set('view.mode', 'fp', 'api');            // 模拟“准备中”（view.mode 已是 fp、还没出图）
press({ key: 'Escape', code: 'Escape' }); eq(HY.state.view.mode, 'ov', '第一人称还没就绪时 Esc 取消、回总览');
ui.layout.toast = toast0;
r = press({ key: 'f', code: 'KeyF' }); ok(!r.r && !r.prevented, '没有全屏能力时 F 不处理');

section('4 时间栏 HY.ui.timebar');
const TB = ui.timebar;
eq(TB.speeds('fp', P).map(s => s[0]).join(','), '1,60,600,3600', '第一人称流速档');
const sov = TB.speeds('ov', P).map(s => s[0]);
ok(sov.indexOf(86400) >= 0 && sov.indexOf(3600) >= 0 && sov.indexOf(7200) >= 0 && sov.indexOf(864000) >= 0, '总览流速档含每秒一小时、一个时辰、一日、十日');
eq(sov[sov.length - 1], Math.round(P.M * 86400), '每秒一月＝朔望月');
eq(HY.store.SCHEMA['time.speed.ov'].def, 86400, '总览默认每秒一日');
for (const it of TB.JUMPS) {
  if (it.head) continue;
  if (it.kind) ok(C.FIND_KINDS.indexOf(it.kind) >= 0, '跳到…“' + it.label + '”的 kind 在 calc.findNext 里：' + it.kind);
  if (it.mark) ok(!!W.markById(it.mark), '跳到…“' + it.label + '”的标记在 HY.world.MARKS 里：' + it.mark);
  ok(!/["']/.test(it.label + (it.title || '')), '跳到…文案没有直引号：' + it.label);
}
const need = ['dawn', 'noon', 'dusk', 'midnight', 'winter', 'festivalNight', 'blackCenter', 'blackHigh', 'litMoonNight', 'eclipse'];
for (const k of need) ok(TB.JUMPS.some(it => it.kind === k), '03 第九节第 3 条的跳转项都在：' + k);
for (const k of ['d1', 'd2', 'd3', 'heiyao']) ok(TB.JUMPS.some(it => it.mark === k), '正文日期在跳到…里：' + k);
eq(TB.jumpLabel(TB.JUMPS.find(it => it.mark === 'heiyao')), '黑曜日之夜（第 10008 年）', '黑曜日的菜单项带年号（第 N 年的写法，年份取 MARKS）');
eq(TB.jumpLabel(TB.JUMPS.find(it => it.mark === 'd1')), '审判 D1 夜', '其余项照写');
eq(TB.tplParts(W.CAL.names.year, 'N').join('|'), '第|年', '输入框两旁的字取自历法叫法：第 [N] 年');
eq(TB.tplParts(W.CAL.names.winterDay, 'd').join('|'), '入冬后第|日', '输入框两旁的字：入冬后第 [d] 日');
eq(TB.tplParts('Year {N}', 'N').join('|'), 'Year|', '叫法换了也能拆');
eq(TB.tplParts('无占位', 'N').join('|'), '无占位|', '没有占位符时整句放前面');
eq(TB.toFestival(10018, P), 0, '10018 是庆典年'); eq(TB.toFestival(10019, P), 3, '10019 距庆典 3 年');
const O = HY.model.O, segs = TB.seasonSegs(10018, O, P);
eq(segs[0].from, 0, '季节带从 0 起'); eq(segs[segs.length - 1].to, P.Y, '季节带到 Y 止');
ok(segs.every((s, i) => i === 0 || s.from === segs[i - 1].to), '季节带首尾相接');
ok(segs.every((s, i) => i === 0 || s.season !== segs[i - 1].season), '相邻两段季节不同');
eq(segs.length, 3, '旧民用历口径：冬（年首）—夏—冬，三段');
const wd = C.civil(C.tOfCivil(10018, segs[1].from, 12, O.az, P), O.az, P).wd;
ok(Math.abs(wd - 181) <= 1, '罪域的夏从入冬后第 181 日前后开始（得 ' + wd + '）');
HY.store.set('time.t', W.markT('d1', 10018, O.az, P), 'api'); HY.model.tick();
const d1 = HY.model.now.date;
TB.setParts(d1.N + 1, d1.doy, d1.hour); HY.model.tick();
eq(HY.model.now.date.N, d1.N + 1, '换年：年加一'); eq(HY.model.now.date.doy, d1.doy, '换年：日子不变'); near(HY.model.now.hour, d1.hour, 1e-6, '换年：钟点不变');
TB.setParts(d1.N, d1.doy, 6.5); HY.model.tick(); near(HY.model.now.hour, 6.5, 1e-6, '改钟点'); eq(HY.model.now.date.doy, d1.doy, '改钟点：日子不变');
TB.setParts(99999, 0, 0); HY.model.tick(); eq(HY.model.now.date.N, TB.YEAR_MAX, '年份夹在 9818–10218');
HY.store.set('time.t', W.markT('d1', 10018, O.az, P), 'api');
let lastSrc = null; const offT = HY.bus.on('time', e => { lastSrc = e.src; });
const tn = TB.jump({ kind: 'noon', label: '正午' }, 1);
ok(tn > W.markT('d1', 10018, O.az, P), '跳到正午：往后');
HY.model.tick(); near(HY.model.now.hour, 12, 0.02, '跳到正午：此地 12 时'); eq(lastSrc, 'jump', '跳转写 src:jump');
const tm = TB.jump({ mark: 'heiyao', label: '黑曜日之夜' });
near(tm, W.markT('heiyao', 0, O.az, P), 1e-9, '跳到黑曜日之夜'); HY.model.tick(); eq(HY.model.now.date.N, 10008, '黑曜日在 10008 年（旧民用历口径）');
offT();
// 年份旁注：庆典年／距庆典 k 年 ＋ 周期第几年；参数破坏庆典节律时不写“null”
let yn = TB.yearNote({ N: 10018, cyc: 1, festival: true }, P);
eq(yn.text, '庆典年 · 周期第 1 年', '10018 年旁注'); eq(yn.festival, true, '10018 年标庆典');
yn = TB.yearNote({ N: 10019, cyc: 2, festival: false }, P);
eq(yn.text, '距庆典 3 年 · 周期第 2 年', '10019 年旁注'); eq(yn.festival, false, '10019 年不标庆典');
const Pbad = HY.astro.params({ a: 1700, dS: 1800, rM: 1800 });
ok(!(Pbad.beta * 180 / Math.PI > 90), '（前提）这组参数黑月半角不足 90°：' + (Pbad.beta * 180 / Math.PI).toFixed(1));
yn = TB.yearNote({ N: 10018, cyc: C.cycleOf(10018, Pbad), festival: false }, Pbad);
ok(!/null|undefined/.test(yn.text) && yn.text.length > 0, '没有庆典时旁注不出现 null：' + yn.text);
// 任一时刻的完整历法文字（“日期…”预览、历法卡换算共用）
const line = TB.calLine(W.markT('d1', 10018, -4, P), HY.model.O, P);
ok(/^第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日 · 夏第 \d+ 日 · 亮月第 \d+ 夜 · 21:00 · 夜$/.test(line), 'D1 夜 21 时的完整写法：' + line);
ok(!/[一二三四五六七八九十]月|初[一二三四五六七八九十]|廿/.test(line), '完整写法里没有几月初几');

section('5 罗盘条与 HUD 文字 HY.ui.fphud');
const H = ui.fphud;
near(H.compassX(10, 0), 10 / 90, 1e-12, '正前方偏东 10°'); eq(H.compassX(100, 0), null, '超出 90° 不画');
near(H.compassX(-170, 170), 20 / 90, 1e-12, '跨 ±180° 折回');
const tk = H.ticks(0, 90, 15);
eq(tk.length, 13, '±90° 每 15° 一格，13 格');
eq(tk.filter(k => k.card).map(k => k.card).join(''), '西北东', '四正方向的字（西、北、东）');
eq(tk.find(k => k.az === 0).sub, '塔根', '北＝塔根');
eq(H.ticks(180, 90, 15).find(k => k.az === 180).sub, '塔顶', '南＝塔顶');
near(H.hfov(55, 16 / 9), 85.57, 0.01, '竖直 55°、16:9 的水平视角约 85.6°');
eq(H.visText(1), '全部露出', '日面全露'); eq(H.visText(0), '被塔挡住', '日面被挡'); eq(H.visText(0.634), '露出 63%', '塔缘切入时给百分比');
eq(H.moonText({ state: '亮月', k: 0.82 }), '亮月 82%', '月：亮面'); eq(H.moonText({ state: '黑月', k: 0, blackHigh: true }), '黑月 · 高悬', '月：黑月高悬');
eq(H.placeLine({ s: 6670, az: -4 }, HY.state.site, P), '罪域·啜泣堡', '在预设地点上写名字');
eq(H.placeLine({ s: 6671.2, az: -4 }, { id: null }, P), '离罪域·啜泣堡 1.2 公里', '走开了写“离某地 N 公里”');
eq(H.placeLine({ s: 6670.4, az: -4 }, { id: 'zuiyu' }, P), '罪域·啜泣堡', '刚瞬移过去、相机落在几百米外的踏面上：照写地名');
eq(H.placeLine({ s: 6672.5, az: -4 }, { id: 'zuiyu' }, P), '离罪域·啜泣堡 2.5 公里', '离开 1 公里以上就写距离');
eq(H.moonText({ state: '灰月', k: 0.8, sunlit: 0.5 }), '灰月 40%', '灰月：亮面乘月心受照');
eq(H.moonText({ state: '黑月', k: 0.45, sunlit: 0 }), '黑月', '黑月不写几何亮面（塔影里不亮）');
eq(H.LOOKS.map(k => k.id).join(','), 'north,zenith,sun,moon,south', '快捷朝向：塔根、天顶、太阳、月、塔顶');
eq(H.hereText({ s: 6670, az: -4 }, P), '离塔根 6,670 公里 · 1.21 g · 纬度 30.0°', 'HUD“所在”：离塔根、重力、纬度（02 第十七节第 4 条）');
eq(H.hereText(null, P), '—', 'HUD“所在”：没有位置写“—”');
eq(H.estLux({ illum: { sunLuxGround: 52000 }, night: false }), 52000, '实测没回来时：白天用直射估算');
eq(H.estLux({ illum: { sunLuxGround: 0 }, night: true }), null, '实测没回来时：夜里不估（对岸光不在估算里，宁写“测量中”）');
eq(H.estLux({ illum: { sunLuxGround: 0.5 }, night: false }), null, '实测没回来时：日面几乎全被塔挡住也不估');
eq(H.TOUCH.map(k => k.id).join(','), 'run,ride,tele', '触屏按钮对应 HY.fp.ctl 的开关名：跑、骑马、望远');
ok(!/["']/.test(H.HINT.desk + H.HINT.touch), '提示文案没有直引号');

section('6 地点卡、读数、历法卡、说明');
const SC = ui.sitecard;
near(SC.arc(6670, -4, 6670, -4, P), 0, 1e-6, '同一点距离 0');
near(SC.arc(4000, 2, 3600, 0, P), SC.arc(3600, 0, 4000, 2, P), 1e-9, '距离对称');
ok(Math.abs(SC.arc(6670, -4, 6680, -4, P) - 10) < 0.01, '沿经线 10 公里就是 10 公里');
eq(SC.nearest(4001, 2, P).site.id, 'yimeite', '离伊美忒最近');
eq(SC.placeName({ id: 'shengjin', s: 3600, az: 0 }, P), '圣禁城', '预设地点用名字');
eq(ui.readouts.aspectName('cut', '东'), '正被东缘切出', '一日五段：东缘切出');
eq(ui.readouts.aspectName('beside', '西'), '贴着西缘', '一日五段：贴西缘');
eq(ui.readouts.litText({ state: '黑月', k: 0.45, sunlit: 0 }), '不亮（在塔影里）', '读数：黑月的亮面写“不亮”');
eq(ui.readouts.litText({ state: '灰月', k: 0.8, sunlit: 0.25 }), '80% · 月心受照 25%', '读数：灰月另给月心受照');
eq(ui.readouts.litText({ state: '亮月', k: 0.82, sunlit: 1 }), '82%', '读数：亮月给亮面');
eq(ui.readouts.directText(0), '0（日在塔后）', '读数：夜里地面直射写 0，不拿星光比');
ok(/klux ≈ 晴天正午$/.test(ui.readouts.directText(60000)), '读数：白天直射给地球对照：' + ui.readouts.directText(60000));
eq(ui.readouts.directText(NaN), '—', '读数：没有数写“—”');
const cr = ui.calendar.crossingsIn(10018, P);
eq(cr.length, 4, '第 10018 年里有四个交节');
ok(cr.every((x, i) => i === 0 || x.t > cr[i - 1].t), '交节按时间排序');
ok(cr.some(x => x.key === 'winter' && Math.abs(x.t) < 1e-9), '含 10018 年入冬交节（t＝0）');
ok(cr.every(x => x.civil && x.civil.N === 10018), '都落在第 10018 年（伊美忒地方日）');
eq(ui.calendar.YEAR_STARTS.map(o => o.v).join(','), 'civil,winter,winterEnd', '年号口径三选一');
const vd = ui.notes.verdicts(k => W.fmtCal({ wd: k }, 'date'), 360);
ok(vd.length >= 20 && vd.every(r => r.length === 3 && /^[✓✗△]/.test(r[1])), '与正文对照：' + vd.length + ' 行，每行判定是 ✓／✗／△');
ok(vd.some(r => r[0].indexOf('入冬后第 294 日') >= 0), 'D1 夜写成“入冬后第 294 日”（取自 MARKS）');
ok(vd.some(r => r[2].indexOf('第 10008 年入冬后第 310 日夜起') === 0), '黑曜日写成“第 10008 年入冬后第 310 日”（年号用 fmtCal）');
ok(vd.every(r => !/(^|[^第 ])1000\d 年/.test(r[2])), '对照表里的年份都写成“第 N 年”');
ok(vd.every(r => !/[一二三四五六七八九十]月|初[一二三四五六七八九十]|廿/.test(r[0] + r[2])), '对照表不出现几月初几');
ok(ui.notes.PENDING.some(p => /白夜/.test(p[0] + p[1])), '待拍板里有“白夜还是静滞夜幕”');
ok(ui.notes.PENDING.concat(ui.notes.KEYS).every(p => !/["']/.test(p.join(''))), '说明文案没有直引号');

section('7 入冬镜头字幕 HY.ui.layout.winterLines');
const L = ui.layout;
eq(L.winterLines(10018, P)[1], '三点一线，是夜为圣皇庆典', '10018 年：三点一线');
eq(L.winterLines(10019, P)[1], '今年月在日西 90°', '10019 年：月在日西 90°');
eq(L.winterLines(10020, P)[1], '今年月与日同侧', '10020 年：与日同侧');
eq(L.winterLines(10021, P)[1], '今年月在日东 90°', '10021 年：月在日东 90°');
eq(L.PRESETS.map(p => p[0]).join(','), HY.store.SCHEMA['ov.preset'].opts.join(','), '预设按钮与 ov.preset 的可选值一致');
eq(L.TABS.map(p => p[0]).join(','), HY.store.SCHEMA['ui.tab'].opts.join(','), '页签与 ui.tab 的可选值一致');
// 顶栏要点（纯函数）：四个；黑月不写百分比；庆典年／周期第几年
HY.store.set('time.t', 0, 'api'); HY.store.patch('site', { id: 'yimeite', s: 4000, az: 2 }, 'api');
let ch = L.chipTexts(HY.model.tick());
eq(ch.length, 4, '要点四个');
eq(ch[0][0], '入冬后 1 日 子时正', '10018 年入冬交节（伊美忒子夜 0 时）：入冬后 1 日 子时正（23 时起为子时初）');
eq(ch[2][0], '黑月', '庆典交节是黑月，不写几何亮面');
eq(ch[3][0], '庆典年', '庆典年');
HY.store.set('time.t', W.markT('d1', 10018, 2, P), 'api');
ch = L.chipTexts(HY.model.tick());
ok(/^亮月 \d+%$/.test(ch[2][0]), 'D1 夜是亮月，写亮面：' + ch[2][0]);
HY.store.set('time.t', 400, 'api');
ch = L.chipTexts(HY.model.tick());
eq(ch[3][0], '周期第 2 年', '10019 年：周期第 2 年');
eq(L.chipTexts({ cal: { wd: 5 }, shichen: '子时初', night: true, moon: { state: '亮月', k: 0.5 }, festivalYear: false, cycleYear: null })[3][0], '', '周期数不出来时第四个留空（不写 null）');
eq(L.chipTexts(null).length, 0, '没有快照时不出要点');
HY.store.patch('site', { id: 'zuiyu', s: 6670, az: -4 }, 'api');

section('7b 本轮界面修复（时辰、余息、天气、读数文案、地名、时间栏、进度）');
{
  // 时辰与钟点同一口径：整点不出现“四刻”，23 时是子时初、2 时是丑时正
  const hs = []; for (let h = 0; h < 24; h++) hs.push(C.shichen(h - 1e-12));
  ok(hs.every(s => !/四刻/.test(s)), '整点（由 t 倒推、比整点小 1e-12）不出现“四刻”：' + hs.join(' '));
  eq(C.shichen(23 - 1e-12), '子时初', '23:00＝子时初'); eq(C.shichen(2 - 1e-12), '丑时正', '02:00＝丑时正');
  eq(C.shichen(22.999999), '子时初', '22:59:59.99 按分钟取整＝23:00＝子时初（与 hhmm 一致）'); eq(C.hhmm(22.999999), '23:00', '同一时刻 hhmm 也是 23:00');
  for (let m = 0; m < 1440; m += 7) { const h = m / 60 - 1e-12, s = C.shichen(h); if (/四刻/.test(s)) { ok(false, '出现四刻：' + C.hhmm(h) + ' ' + s); break; } }
  // 余息：前锋什么时候到罪域（读 HY.fp.set.yuxi，不另立公式）
  HY.store._resetForTest && HY.store.reset(['fp.set'], 'reset');
  const yr = ui.yuxiReach, dz = yr.days(HY.state, P, 6670);
  ok(dz != null && dz > 1 && dz < 5, '默认设定下前锋入冬前约 2.7 日才到罪域：' + (dz && dz.toFixed(2)));
  ok(yr.days(HY.state, P, 1500) > 40, '前锋入冬前 45 日从 1,500 公里起推');
  const yv = ui.notes.yuxiVerdict(HY.state, P);
  ok(/^✗/.test(yv[0]) && /罪域/.test(yv[1]) && /待作者定/.test(yv[1]), '正文对照 ch26 余息一行如实写 ✗（按现设）并给出要对上需要的推进速度：' + yv.join('｜'));
  const vd2 = ui.notes.verdicts(k => W.fmtCal({ wd: k }, 'date'), 360);
  ok(vd2.some(r => /余息吹进罪域/.test(r[0]) && /^✗/.test(r[1])), '对照表里 ch26 余息不再标 ✓');
  HY.store.set('fp.set.yuxi', 'on', 'api'); eq(ui.notes.yuxiVerdict(HY.state, P)[0], '✓', '余息设成“开”时成立'); HY.store.set('fp.set.yuxi', 'auto', 'api');
  // 天气（罪域阴云与第一人称同一个范围）
  const RD = ui.readouts, Zs = HY.world.siteById('zuiyu', P), Ss = HY.world.siteById('shengjin', P);
  const wz = RD.weather(HY.state, P, Zs.s, Zs.az, W.markT('d1', 10018, -4, P));
  ok(wz.overcast && /阴/.test(wz.text) && /雨/.test(wz.text) && /云底约 1\.2 公里/.test(wz.text), '罪域：阴，下雨，云底约 1.2 公里：' + wz.text);
  const ws = RD.weather(HY.state, P, Ss.s, Ss.az, 0);
  ok(!ws.overcast && ws.text && !/雨/.test(ws.text), '圣禁城不在罪域阴云下：' + ws.text);
  const wy = RD.weather(HY.state, P, Zs.s, Zs.az, -1.5);
  ok(wy.yuxi && wy.yuxi.on && /已到此地|前锋正经过/.test(wy.yuxiText), '入冬前 1.5 日：罪域已有余息：' + wy.yuxiText);
  const wy2 = RD.weather(HY.state, P, Zs.s, Zs.az, -30);
  ok(/还没到此地/.test(wy2.yuxiText) && /前锋离塔根/.test(wy2.yuxiText), '入冬前 30 日：写出前锋推到哪里、离此地多远：' + wy2.yuxiText);
  ok(/还没起/.test(RD.weather(HY.state, P, Zs.s, Zs.az, -100).yuxiText), '入冬前 100 日：余息还没起');
  HY.store.set('fp.cloud.on', false, 'api'); ok(/云已关/.test(RD.weather(HY.state, P, Zs.s, Zs.az, 0).text), '关了云直说'); HY.store.set('fp.cloud.on', true, 'api');
  eq(RD.cloudOver(wz, null), '在云后', '罪域阴云下没有实测时：日月在云后');
  eq(RD.cloudOver(ws, 0.02), '在云后', '实测到眼日照不到大气顶的 8%：在云后');
  eq(RD.cloudOver(ws, 0.8), '', '实测透过八成：看得见');
  // 第一人称读数：日月算上云；行走状态；提示文案
  eq(H.sunSeen(1, '在云后'), '在云后，看不见日面', '太阳在云后'); eq(H.sunSeen(0, '在云后'), '被塔挡住', '先看塔');
  eq(H.sunSeen(1, ''), '全部露出', '晴：全部露出'); eq(H.moonSeen({ vis: 1 }, '在云后'), '在云后，看不见', '月在云后');
  eq(H.modeTexts({ ride: true, tele: true }, 5).join('｜'), '骑马（R 下马）｜望远（T 收起）', '桌面也写出骑马、望远与怎么关');
  ok(/Esc 松开鼠标，按 1 回总览/.test(H.HINT.desk) && /Esc 松开鼠标，按 1 回总览/.test(H.fixHint('拖动或点击画面转头，WASD 行走，Esc 退出')), '提示不再写“Esc 退出”');
  eq(H.EYE['明视'], '已适应明亮，看得清颜色', '人眼一行直白');
  // 照度对照：比地球晴天正午还亮时直说
  eq(ui.fmt.luxEarth(213000), '比晴天正午还亮（约 1.9 倍）', '213 klux 不写成“晴天正午”');
  eq(ui.fmt.luxLine(13000), '13 klux，相当于地球上阴天白昼、晴天上午', '照度一句人话');
  ok(/^213 klux，比地球晴天正午还亮/.test(ui.fmt.luxLine(213000)), '照度一句人话（更亮）：' + ui.fmt.luxLine(213000));
  // 地名：步行停下后 site.id 被清成 null，离预设地点不到 1 公里仍写地名；地点卡同一条规则
  eq(H.placeLine({ s: 6670.0086, az: -4 }, { id: null }, P), '罪域·啜泣堡', '走了 8 米（id 已清）：HUD 仍写地名');
  eq(SC.placeName({ id: null, s: 6670.0086, az: -4 }, P), '罪域·啜泣堡', '地点卡同一条规则');
  eq(SC.resolve(6670.0086, -4, null, P).site.id, 'zuiyu', 'resolve 认出罪域');
  eq(SC.resolve(6680, -4, null, P).at, false, '走出 1 公里不再算');
  eq(ui.w.roundStep(6670.0086, 1), 6670, '离塔根数值框按整公里显示');
  // 时间栏：距下次入冬、节令小菱形错开
  const TB2 = ui.timebar;
  eq(TB2.toWinterText(294, P), '距下次入冬 67 日', '入冬后第 294 日＝距下次入冬 67 日（正文的“入冬前 67 日”）');
  eq(TB2.toWinterText(360, P), '距下次入冬 1 日', '庆典夜那天'); eq(TB2.toWinterText(1, P), '入冬当日', '入冬当日');
  const sp = TB2.spread([440, 442, 444, 561, 561.1, 700], 11);
  ok(sp[1] - sp[0] >= 11 - 1e-9 && sp[2] - sp[1] >= 11 - 1e-9 && sp[4] - sp[3] >= 11 - 1e-9 && sp[5] === 700, '挨着的小菱形错开到至少 11 px：' + sp.map(v => v.toFixed(1)).join(','));
  near((sp[0] + sp[2]) / 2, 442, 1e-9, '错开时以原中心为准');
  // 进度按时间走、不卡在一个数上；换档的一句话
  const Ly = ui.layout;
  ok(Ly.etaFrac(4, 16, 0.4) >= 0.36 && Ly.etaFrac(8, 16, 0.4) > Ly.etaFrac(4, 16, 0.4) && Ly.etaFrac(60, 16, 0) < 1, '进度按已等时间单调往前走、到不了 100%');
  // 条子交给 CSS 过渡（合成线程）：主线程编译时卡住 7–17 秒，条子也要按预计耗时往前走
  const bp = Ly.barPlan(0.1, 2, 16), bp2 = Ly.barPlan(0, 30, 16), bp3 = Ly.barPlan(0.6, 1, 16);
  ok(bp.from >= 0.1 && bp.to > bp.from && bp.sec >= 3 && bp.to <= 0.98, '过渡从此刻的位置走向 H 秒后的位置：' + JSON.stringify(bp));
  ok(bp2.sec >= 3 && bp2.to <= 0.98 && bp2.to >= bp2.from, '比预计慢时仍往前挪一点、到不了头：' + JSON.stringify(bp2));
  ok(bp3.from >= 0.6, '按个数算的进度是下限，不往回退');
  eq(Ly.qualityText({ tier: 'mid', reason: '着色器已编译' }), '画面已切到“中”档', '换档提示不写“着色器已编译”');
  ok(/太卡/.test(Ly.qualityText({ tier: 'low', reason: '帧时超出预算，自动降档' })), '自动降档说清原因');
  ok(/参数/.test(Ly.qualityText({ tier: 'mid', suggest: 'high' })), '升档建议指向“参数”');
  // 说明页：一日五段与正午高低随地点
  const dsZ = C.dayStats(HY.astro.site(Zs.s, Zs.az, P), W.markT('d1', 10018, -4, P) - 21 / 24, P);
  ok(/正午最高/.test(ui.notes.noonShape(dsZ)), '罪域：重力仰角正午最高：' + ui.notes.noonShape(dsZ));
  const Ym = HY.world.siteById('yimeite', P), dsY = C.dayStats(HY.astro.site(Ym.s, Ym.az, P), W.markT('d1', 10018, Ym.az, P) - 21 / 24, P);
  ok(/正午反而最低/.test(ui.notes.noonShape(dsY)), '伊美忒：正午反而最低：' + ui.notes.noonShape(dsY));
}
HY.store.patch('site', { id: 'zuiyu', s: 6670, az: -4 }, 'api');

section('8 HY.app 的取数与测试接口（不启动页面）');
const app = HY.app;
HY.store.patch('site', { id: 'zuiyu', s: 6670, az: -4 }, 'api');
const tD1 = W.markT('d1', 10018, -4, P);
near(app.setTime({ year: 10018, wd: 294, hour: 21 }), tD1, 1e-9, 'setTime({year, wd, hour})＝D1 夜 21 时');
near(app.setTime({ year: 10018, month: 8, day: 24, hour: 21 }), tD1, 1e-9, 'setTime({year, month, day, hour}) 与旧月日对得上');
HY.model.tick(); eq(W.fmtCal(HY.model.now.cal, 'date'), '入冬后第 294 日', '界面写“入冬后第 294 日”');
const dd = HY.model.now.date;
near(app.setTime({ year: dd.N, doy: dd.doy, hour: 21 }), tD1, 1e-9, 'setTime({year, doy, hour}) 往返');
near(app.setTime(123.25), 123.25, 1e-12, 'setTime(t)');
app.setSite('yimeite'); eq(HY.state.site.id, 'yimeite', 'setSite(id)'); eq(HY.state.site.s, 4000, 'setSite：离塔根 4000');
app.setSite({ s: 5000, az: 10 }); eq(HY.state.site.id, null, 'setSite({s, az})：自定义地点'); eq(HY.state.site.az, 10, 'setSite：方位');
T.throws(() => app.setSite('nowhere'), '没有的地点抛错');
app.setSite('zuiyu');
app.setTime(tD1);
let frames = 0; const offF = HY.bus.on('frame', ctx => { frames++; });
app.play(true, 3600);
eq(HY.state.time.playing, true, 'play(true)'); eq(HY.state.time.speed.ov, 3600, 'play 设总览流速');
app.settle(60);
offF();
near(HY.state.time.t, tD1 + 1 / 24, 1e-9, '每秒一小时连跑 60 帧（1 秒）＝推进一小时'); eq(frames, 60, 'settle(60) 发 60 次 frame');
app.play(false, 86400);
const s0 = HY.state.time.t; app.settle(10); eq(HY.state.time.t, s0, '暂停时 settle 不推进时间');
eq(app.setParam('fp.atmo.HR', 30), 30, 'setParam 写任意 SCHEMA 路径'); app.setParam('fp.atmo.HR', 40);
const sn = app.snapshot(); ok(sn.state && sn.now && sn.now.cal && 'build' in sn, 'snapshot 含 state、now、build');
eq(app.fpAvail().ok, false, '没有三维时第一人称不可用'); ok(/三维/.test(app.fpAvail().reason), '并说明原因：' + app.fpAvail().reason);
eq(app.active(), null, '没有三维时没有出图的视图');
const e = app.Eh(); ok(e.est === true && isFinite(e.lux), '总览的照度是估算');
eq(app.sunVis(), HY.model.tick().sun.vis, 'sunVis 取 HY.model.now'); eq(app.moonState(), HY.model.now.moon.state, 'moonState 取 HY.model.now');
const pf = app.perf(); ok(pf.tier === 'ov' && 'fps' in pf, 'perf 在总览时返回 tier ov');

app.measure([{ site: 'yimeite', time: { year: 10018, wd: 1, hour: 0 }, frames: 2 }, { site: 'zuiyu', time: tD1, frames: 2 }]).then(rows => {
  eq(rows.length, 2, 'measure 逐项返回');
  eq(rows[0].site, 'yimeite', 'measure：第一项在伊美忒');
  ok(rows.every(x => x.Eh && typeof x.sunVis === 'number' && typeof x.moon === 'string'), 'measure：每行有照度、日面、月态');
  eq(rows[0].moon, '黑月', '10018 年入冬交节（伊美忒子夜）是黑月');
  section('9 小工具 HY.ui.w');
  eq(ui.w.decimals(0.01), 2, '步长 0.01 → 两位小数'); eq(ui.w.decimals(1), 0, '步长 1 → 整数'); eq(ui.w.decimals(0.005), 3, '步长 0.005 → 三位');
  eq(ui.w.roundStep(0.30000000004, 0.01), 0.3, '按步长取整显示');
  eq(ui.w.fmtVal(0.30000000004, 0.01), '0.3', '数值框：按步长显示');
  eq(ui.w.fmtVal(8.5, 1), '8.5', '数值框：值不在步长格上（地球式标高 8.5）时多给一位，不显示成 9');
  eq(ui.w.fmtVal(12, 0.5), '12', '数值框：整数不带小数');
  eq(ui.w.fmtVal(NaN, 1), '', '数值框：非数显示空');
  eq(ui.w.fmtVal(Math.PI * 6371 / 3, 10), '6671.7', '数值框：公式推出的默认值（回归纬线 πR/3，步长 10）最多比步长多两位');
  eq(ui.w.fmtVal(0.123456, 0.01), '0.1235', '数值框：小数总共不超过 4 位');

  section('10 HY.app.view：不可用时只提示一次、退回总览、Promise 带中文原因');
  const tl = [], tsv = ui.layout.toast;
  ui.layout.toast = m => { tl.push(m); };
  const offV = HY.bus.on('view', app._onView);        // 与 boot 里挂的监听器相同
  HY.store.set('view.mode', 'ov', 'api');
  return app.view('fp').then(() => { ok(false, 'app.view(\'fp\') 在不可用时应当 reject'); }, err => {
    ok(/三维/.test(err.message), 'reject 的原因是中文：' + err.message);
    eq(tl.length, 1, '只提示一次（不因 app.view 自己再进一次而重复）：' + tl.join('｜'));
    eq(HY.state.view.mode, 'ov', '退回总览');
  }).then(() => {
    offV(); ui.layout.toast = tsv;
    return app.view('ov').then(() => ok(true, 'app.view(\'ov\') 直接 resolve'));
  }).then(() => done());
}).catch(e => { ok(false, '异步段出错：' + (e && e.stack || e)); done(); });
