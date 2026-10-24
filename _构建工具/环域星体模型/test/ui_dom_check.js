#!/usr/bin/env node
/* ui_dom_check.js —— 在 node 里用一个极简的假 DOM 把整页启动一遍（负责：D 路）
 * 场景＝本地双击、three.js 没加载上（离线）：spec/03 第二节第 4 条、第十一节第 3 条第 1 项
 *   “离线时出现 three 加载失败的说明，图表与读数照常”；第一人称按钮置灰并带中文原因。
 * 模板取自 src/index.html（按真实结构建树），脚本按 manifest 次序全部载入（含非节点模块，约定加载时不碰 DOM／THREE），
 * 然后调 HY.app.boot()，检查各卡片的 init、文字（自创历法、无几月初几、无 undefined／NaN）、按钮、快捷键、恢复默认。
 * 假 DOM 只实现界面模块用到的那一小撮接口；画布的 2D 上下文是全 no-op 的代理。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('./_load.js');

/* ───────── 极简 DOM ───────── */
class Ev {
  constructor(type, o) { this.type = type; this.bubbles = false; this.defaultPrevented = false; Object.assign(this, o || {}); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
}
class KeyEv extends Ev {}
let DOC = null;
class Nd {
  constructor() { this.parentNode = null; this.children = []; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return i > 0 ? p.children[i - 1] : null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
}
class Tx extends Nd {
  constructor(t) { super(); this.nodeType = 3; this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
const RECT = { left: 0, top: 0, right: 320, bottom: 120, width: 320, height: 120, x: 0, y: 0 };
function ctx2d() {
  const noop = function () {};
  const special = {
    measureText: s => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    getLineDash: () => [], isPointInPath: () => false
  };
  const store = {};
  return new Proxy(store, {
    get(t, k) { if (k in special) return special[k]; if (k in t) return t[k]; return noop; },
    set(t, k, v) { t[k] = v; return true; }
  });
}
class El extends Nd {
  constructor(tag) {
    super();
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this._t = ''; this.attrs = {}; this.dataset = {}; this.style = {}; this.L = {};
    this.className = ''; this.hidden = false; this.id = ''; this.value = ''; this.checked = false; this.disabled = false; this.type = '';
    this.min = ''; this.max = ''; this.step = ''; this.open = false; this.title = ''; this.tabIndex = 0; this.htmlFor = ''; this.scrollTop = 0;
    this.width = 300; this.height = 150;
    const self = this;
    this.classList = {
      add: c => self._cls(c, true), remove: c => self._cls(c, false),
      toggle: (c, on) => self._cls(c, on === undefined ? !self.classList.contains(c) : !!on),
      contains: c => self.className.split(/\s+/).indexOf(c) >= 0
    };
  }
  _cls(c, on) { const a = this.className.split(/\s+/).filter(x => x && x !== c); if (on) a.push(c); this.className = a.join(' '); return on; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._t; }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._t = String(v); }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get isContentEditable() { return false; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); }
  removeEventListener(t, f) { const a = this.L[t]; if (a && a.indexOf(f) >= 0) a.splice(a.indexOf(f), 1); }
  dispatchEvent(e) {
    if (!e.target) e.target = this;
    let n = this;
    while (n) {
      (n.L && n.L[e.type] || []).slice().forEach(f => f.call(n, e));
      if (!e.bubbles || e._stop) break;
      n = n.parentNode;
    }
    return !e.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'INPUT' && this.type === 'checkbox') { this.checked = !this.checked; this.dispatchEvent(new Ev('change', { bubbles: true })); }
    this.dispatchEvent(new Ev('click', { bubbles: true }));
  }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  getBoundingClientRect() { return Object.assign({}, RECT); }
  get clientWidth() { return 320; }
  get clientHeight() { return 120; }
  get scrollHeight() { return 120; }
  focus() { DOC.activeElement = this; }
  blur() { if (DOC.activeElement === this) DOC.activeElement = DOC.body; }
  getContext() { return this._ctx || (this._ctx = ctx2d()); }
  walk(fn) { if (fn(this)) return this; for (const c of this.children) { if (c instanceof El) { const r = c.walk(fn); if (r) return r; } } return null; }
  all(fn, out) { out = out || []; if (fn(this)) out.push(this); for (const c of this.children) if (c instanceof El) c.all(fn, out); return out; }
}

// 按 src/index.html 的结构建树（只认标签、id、class、hidden、data-*、role、aria-*；注释与占位符跳过）
const VOID = { meta: 1, link: 1, br: 1, input: 1, img: 1, hr: 1 };
function buildTemplate(html, root) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  const stack = [root];
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      if (tag === 'title' || tag === 'meta' || tag === 'link') { if (tag === 'title') re.exec(html); continue; }
      const el = new El(tag), ar = /([\w:-]+)(?:="([^"]*)")?/g;
      let a;
      while ((a = ar.exec(m[3]))) {
        const k = a[1], v = a[2] == null ? '' : a[2];
        if (k === 'class') el.className = v;
        else if (k === 'hidden') el.hidden = true;
        else if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        else el.setAttribute(k, v);
      }
      top.appendChild(el);
      if (!VOID[tag] && !/\/\s*$/.test(m[3])) stack.push(el);
      continue;
    }
    if (m[4] && m[4].trim()) top.appendChild(new Tx(m[4].trim()));
  }
}

const body = new El('body'), docEl = new El('html');
const winL = {};
DOC = {
  body, documentElement: docEl, activeElement: body, readyState: 'complete', visibilityState: 'visible',
  fullscreenEnabled: false, fullscreenElement: null, L: {},
  createElement: t => new El(t), createTextNode: t => new Tx(t),
  getElementById: id => body.walk(e => e.id === id),
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); },
  removeEventListener() {}
};
const G = globalThis;
G.HY_NO_BOOT = true;
G.document = DOC;
G.window = G;
G.innerWidth = 1280; G.innerHeight = 800; G.devicePixelRatio = 1;
G.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
G.removeEventListener = () => {};
G.dispatchEvent = e => { (winL[e.type] || []).slice().forEach(f => f(e)); return true; };
G.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
G.getComputedStyle = () => ({ getPropertyValue: () => '', position: '', display: '' });
const rafQ = [];
G.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
G.cancelAnimationFrame = () => {};
G.Event = Ev; G.KeyboardEvent = KeyEv;
G.performance = G.performance || { now: () => Date.now() };
buildTemplate(fs.readFileSync(path.join(load.SRC, 'index.html'), 'utf8'), body);

/* ───────── 载入全部脚本，启动 ───────── */
const HY = load();
const T = load.tester('ui_dom_check');
const { ok, eq, section, done } = T;
const m = load.manifest();
for (const e of m.scripts) {
  if (!e.src || e.node) continue;
  vm.runInThisContext(fs.readFileSync(path.join(load.SRC, e.src), 'utf8'), { filename: e.src });
}
const errs = [], consoleErr = console.error;
console.error = function () { errs.push([].slice.call(arguments).map(x => (x && x.stack) || String(x)).join(' ')); };
const busErr = [];
HY.bus.on('error', e => { busErr.push((e && e.part) + '：' + (e && e.message)); });
const ready = [];
HY.bus.on('ready', e => { ready.push(e && e.part); });
HY.store._resetForTest();
const $ = id => DOC.getElementById(id);
const BAD = /undefined|NaN|null|\[object/;
const MONTH = /[一二三四五六七八九十]+月(?![亮灰黑态])|初[一二三四五六七八九十]|廿[一二三四五六七八九]/;

section('1 启动：没有 three.js（离线双击）');
ok(typeof G.THREE === 'undefined', '（前提）THREE 没加载');
let bootErr = null;
try { HY.app.boot(); } catch (e) { bootErr = e; }
ok(!bootErr, 'HY.app.boot() 不抛错' + (bootErr ? '：' + bootErr.stack : ''));
ok(ready.indexOf('ui') >= 0 && ready.indexOf('charts') >= 0, '发了 ready{ui}、ready{charts}：' + ready.join('、'));
const fb = $('fallback');
ok(fb && !fb.hidden && /three\.js/.test(fb.textContent) && /图表、读数、参数照常可用/.test(fb.textContent), '三维区显示中文降级说明：' + (fb && fb.textContent));
eq(HY.app.active(), null, '没有出图的视图');
const uiErr = busErr.filter(s => /^(ui|store|model|charts)：/.test(s));
ok(uiErr.length === 0, '界面、状态、图表的 init 都没报错：' + uiErr.join('｜'));
ok(errs.length === 0, '控制台没有报错：' + errs.slice(0, 2).join('｜'));

section('2 各容器都被填上');
for (const id of ['viewSwitch', 'ovPresets', 'nowChips', 'legend', 'timebar', 'tabs', 'siteCard', 'readouts', 'calendar', 'params', 'notes', 'fpHud']) {
  ok($(id) && $(id).children.length > 0, '#' + id + ' 有内容');
}
const tabs = $('tabs').all(e => e.getAttribute('role') === 'tab');
eq(tabs.length, 4, '页签四个');
ok($('tabs').walk(e => e.getAttribute('role') === 'tablist') && $('tabs').getAttribute('role') == null, 'tablist 里只放页签（“收起”按钮在外面）');
eq($('nowChips').children.length, 4, '顶栏要点四个');
eq(HY.ui.params.controls().length, HY.ui.PARAMS.length, '参数面板每行一个控件（' + HY.ui.PARAMS.length + '）');

section('3 第一人称不可用：置灰、写原因、点了提示、不切视图');
const bFp = $('viewSwitch').children[1], stand = $('siteCard').walk(e => e.tagName === 'BUTTON' && e.textContent === '站在此地');
eq(bFp.getAttribute('aria-disabled'), 'true', '顶栏“站在此地”置灰（aria-disabled）');
ok(/暂不可用：三维视图需要联网加载/.test(bFp.title), '按钮的说明写原因：' + bFp.title);
eq(bFp.disabled, false, '不用 disabled（点得动，才能提示原因）');
ok(stand && stand.getAttribute('aria-disabled') === 'true', '地点卡的“站在此地”也置灰');
bFp.click();
eq(HY.state.view.mode, 'ov', '点了不切视图');
ok(!$('toast').hidden && /第一人称暂不可用：/.test($('toast').textContent), '提示原因：' + $('toast').textContent);
$('toast').hidden = true;
stand.click();
ok(HY.state.view.mode === 'ov' && !$('toast').hidden, '地点卡的按钮同样只提示');
(winL.keydown || []).forEach(f => f({ key: '2', code: 'Digit2', target: body, preventDefault() {} }));
eq(HY.state.view.mode, 'ov', '按 2 也不切视图');

section('4 时间栏：自创历法');
const tb = $('timebar');
const dateTxt = tb.walk(e => e.classList.contains('tb-date')).textContent;
ok(dateTxt.indexOf('入冬后第 294 日') === 0, '默认时刻（D1 夜 21 时）：' + dateTxt);
ok(/夏第 114 日/.test(dateTxt) && /亮月第 \d+ 夜$/.test(dateTxt), '季、月态第几夜都在（月态在最后）');
eq(tb.walk(e => e.classList.contains('tb-hout')).textContent, '21:00 · 亥时初', '钟点与时辰写在钟点滑杆旁');
ok(/21:00 亥时初(\n|$)/.test(tb.walk(e => e.classList.contains('tb-date')).title), '日期文字的说明里带钟点（悬停可见）');
ok(/（距下次入冬 67 日）/.test(dateTxt) && /距下次入冬 67 日/.test(tb.walk(e => e.classList.contains('tb-date')).title), 'D1（入冬后第 294 日）旁注“距下次入冬 67 日”，与正文的“入冬前 67 日”直接对上');
const dIn = tb.walk(e => e.classList.contains('tb-dslider')), hIn = tb.walk(e => e.classList.contains('tb-hslider'));
ok(/入冬后第 294 日/.test(dIn.getAttribute('aria-valuetext') || '') && /21:00 亥时初/.test(hIn.getAttribute('aria-valuetext') || ''), '读屏：日期、钟点滑杆念日期与时辰：' + dIn.getAttribute('aria-valuetext') + '｜' + hIn.getAttribute('aria-valuetext'));
eq(DOC.documentElement.lang, 'zh-CN', '页面语言设成中文（读屏按中文念）');
eq($('nowChips').getAttribute('aria-live'), null, '顶栏要点不是 live 区域（播放时不被每 250 ms 刷屏）');
eq(tb.walk(e => e.classList.contains('tb-ylab')).textContent, '第 10018 年', '年号');
eq(tb.walk(e => e.classList.contains('tb-ynote')).textContent, '庆典年 · 周期第 1 年', '年份旁注');
ok(!MONTH.test(tb.textContent), '时间栏里没有几月初几');
const marks = tb.all(e => e.classList.contains('tb-mark'));
ok(marks.length >= 8 && marks.some(b => /待定/.test(b.title)), '季节带上有节令标记，正文日期标“待定”（' + marks.length + ' 个）');
ok(tb.all(e => e.classList.contains('menu-item')).some(b => b.textContent === '黑曜日之夜（第 10008 年）'), '“跳到…”里黑曜日带年号');
// “日期…”：年份超出 400 年时夹回（回车可能先于数值框的夹取到达）
const dlgYear = tb.walk(e => e.tagName === 'INPUT' && e.getAttribute('aria-label') === '年');
const tKeep = HY.state.time.t;
dlgYear.value = '20000';
tb.walk(e => e.tagName === 'BUTTON' && e.textContent === '跳到这一刻').click();
eq(HY.model.tick().date.N, HY.ui.timebar.YEAR_MAX, '“日期…”里年份 20000 夹回 ' + HY.ui.timebar.YEAR_MAX);
HY.store.set('time.t', tKeep, 'api');
const spSel = tb.walk(e => e.classList.contains('tb-speed'));
eq(spSel.value, '86400', '流速默认每秒一日');
HY.store.set('time.speed.ov', 3600, 'ui');
eq(spSel.value, '3600', '流速改成每秒一小时');
HY.ui.params.resetAll();
eq(spSel.value, '86400', '恢复默认后流速下拉跟着回来');

section('5 参数面板：数值框照实显示');
HY.store.patch('fp.atmo', { HR: 8.5, HM: 1.2 }, 'ui');                     // “地球式大气”
const hrBox = $('params').walk(e => e.dataset && e.dataset.path === 'fp.atmo.HR').walk(e => e.tagName === 'INPUT' && e.type === 'number');
eq(hrBox.value, '8.5', '空气标高框里写 8.5（步长 1 也不显示成 9）');
HY.ui.params.resetGroup('第一人称·大气');
eq(hrBox.value, '40', '本组默认后回到 40');
HY.store.set('astro.o.lunPerYear', 12.5, 'ui');
const warn = $('params').walk(e => e.classList.contains('p-warn') && !e.classList.contains('p-flash'));
ok(!warn.hidden && /¼/.test(warn.textContent), '违反约束时出黄字：' + warn.textContent);
HY.store.set('astro.o.lunPerYear', null, 'ui');
ok(warn.hidden, '改回后黄字消失');

section('6 读数、地点卡、历法卡、说明：文字齐全、没有 undefined／NaN／几月初几');
HY.app.settle(3);
const ro = $('readouts').textContent;
ok(!BAD.test(ro), '读数没有 undefined／NaN：' + (ro.match(BAD) || [''])[0]);
ok(/入冬后第 294 日/.test(ro) && /第 10018 年（庆典年 · 周期第 1 年）/.test(ro), '读数的年与日用自创历法');
ok(!BAD.test($('siteCard').textContent), '地点卡没有 undefined／NaN');
HY.store.set('ui.tab', 'year', 'ui');
const cal = $('calendar').textContent;
ok(/本年交节/.test(cal) && /四年庆典/.test(cal) && /本年黑月期/.test(cal) && /日期换算/.test(cal), '历法卡各节都在');
ok(!BAD.test(cal) && !MONTH.test(cal), '历法卡没有 undefined／NaN／几月初几');
ok(/入冬（飞升日）/.test(cal) && /待定/.test(cal), '历法卡有交节与“待定”的正文日期');
const cYear = $('calendar').walk(e => e.tagName === 'INPUT' && e.getAttribute('aria-label') === '年');
const cDay = $('calendar').walk(e => e.tagName === 'INPUT' && e.getAttribute('aria-label') === '入冬后第几日');
cYear.value = '9000.4'; cDay.value = '999';
let cq = HY.ui.calendar.convVal();
ok(cq.N === HY.ui.timebar.YEAR_MIN && cq.wd === 360, '日期换算：年份、日子取整并夹在范围内：' + JSON.stringify(cq));
cYear.value = '10018'; cDay.value = '294';
cq = HY.ui.calendar.convVal();
ok(cq.N === 10018 && cq.wd === 294, '日期换算：正常值照用');
HY.store.set('ui.tab', 'notes', 'ui');
const notes = $('notes').textContent;
ok(notes.length > 2000, '说明页已画出（' + notes.length + ' 字）');
ok(!BAD.test(notes) && !MONTH.test(notes), '说明页没有 undefined／NaN／几月初几：' + ((notes.match(BAD) || notes.match(MONTH) || [''])[0]));
ok(/罪域·啜泣堡常年昼/.test(notes), '推论里写此地的名字');
ok(!/公里 [处的]/.test(notes), '“公里”后面直接接中文，不多空格');
HY.app.setSite({ s: 5000, az: 10 });
HY.ui.notes.render();
ok(/此地常年昼/.test($('notes').textContent) && !/自定义地点常年/.test($('notes').textContent), '自定义地点写“此地”');
HY.app.setSite('zuiyu');
HY.store.set('ui.tab', 'site', 'ui');

section('6b 历法叫法只改一处：换一套格式函数，时间栏、读数、顶栏要点都跟着变');
{
  const W = HY.world;
  W.addCalStyle('ui测试', (c, form) => '〔' + form + '〕');
  W.CAL.style = 'ui测试';
  HY.model.rebuild();
  HY.store.set('ui.tab', 'site', 'ui');
  const lab = $('timebar').walk(e => e.classList.contains('tb-date')).textContent;
  ok(/^〔date〕（距下次入冬 \d+ 日） · 〔season〕 · 〔moon〕$/.test(lab), '时间栏的日期文字走 fmtCal（旁注距下次入冬几日）：' + lab);
  eq($('timebar').walk(e => e.classList.contains('tb-ylab')).textContent, '〔year〕', '年号走 fmtCal');
  HY.app.settle(1);
  ok($('readouts').textContent.indexOf('〔year〕') >= 0 && $('readouts').textContent.indexOf('〔date〕') >= 0, '读数的年与日走 fmtCal');
  ok(HY.ui.layout.chipTexts(HY.model.tick())[0][0].indexOf('〔chip〕') === 0, '顶栏要点走 fmtCal');
  W.CAL.style = 'draft';
  delete W.calStyles['ui测试'];
  HY.model.rebuild();
  ok(/^入冬后第 \d+ 日/.test($('timebar').walk(e => e.classList.contains('tb-date')).textContent), '换回现行写法');
}

section('7 顶栏要点、快捷键、帧循环');
HY.app.setTime(0); HY.app.setSite('yimeite'); HY.app.settle(2);
HY.ui.layout.chips(HY.model.now);
const chips = $('nowChips').children.map(c => c.textContent);
eq(chips[2], '黑月', '庆典交节：要点写“黑月”，不写几何亮面');
eq(chips[3], '庆典年', '庆典年');
const t0 = HY.state.time.t;
(winL.keydown || []).forEach(f => f({ key: ']', code: 'BracketRight', target: body, preventDefault() {} }));
ok(Math.abs(HY.state.time.t - t0 - 1 / 24) < 1e-9, '] 进一小时');
(winL.keydown || []).forEach(f => f({ key: 'p', code: 'KeyP', target: body, preventDefault() {} }));
eq($('app').dataset.panel, '0', 'P 收起侧栏（#app data-panel＝0）');
(winL.keydown || []).forEach(f => f({ key: 'p', code: 'KeyP', target: body, preventDefault() {} }));
eq($('app').dataset.panel, '1', 'P 再展开');
let frames = 0; const offF = HY.bus.on('frame', () => frames++);
HY.app.play(true, 86400); HY.app.settle(30); HY.app.play(false);
offF();
eq(frames, 30, 'settle(30) 跑 30 帧');
ok(Math.abs(HY.state.time.t - t0 - 1 / 24 - 0.5) < 1e-9, '每秒一日跑半秒＝推进半日');
HY.ui.layout.chips(HY.model.now);
ok(!BAD.test($('nowChips').textContent + $('timebar').textContent + $('readouts').textContent), '播放后各处文字仍然正常');

section('7b 入冬镜头被打断：播放状态与流速还原、字幕立刻收起；手机预设下拉停在当前预设');
{
  const L = HY.ui.layout, cap = $('ovCaption');
  HY.app.play(false, 86400);
  L.preset('winter');
  ok(L.shot() && HY.state.time.playing === true && HY.state.time.speed.ov === 3600 && !cap.hidden, '入冬镜头开始：×3600 播放、字幕出现');
  L.preset('oblique');
  eq(HY.state.time.playing, false, '打断后回到原先的暂停（原来没在播）');
  eq(HY.state.time.speed.ov, 86400, '流速还原');
  ok(cap.hidden, '字幕立刻收起');
  // 播完后字幕留 4 秒；这期间跳到别的日子：字幕立刻收起
  L.preset('winter');
  const sh = L.shot();
  HY.store.set('time.t', sh.end + 1e-3, 'play');
  ok(!L.shot() && HY.state.time.playing === false && !cap.hidden, '自然播完：暂停、字幕还留着');
  HY.app.setTime({ year: 10018, wd: 294, hour: 21 });
  ok(cap.hidden, '跳到别的时刻：字幕马上消失');
  const sel = $('ovPresets').walk(e => e.tagName === 'SELECT');
  L.preset('side');
  eq(sel.value, 'side', '预设下拉停在“侧看”（不再变回“预设”）');
  HY.store.set('ov.cam', { pos: [1, 2, 3], target: [0, 0, 0] }, 'ov');
  eq(sel.value, '', '拖动过镜头后显示“自定镜头”');
  L.preset('oblique');
}

section('8 收尾');
const uiErr2 = busErr.filter(s => /^(ui|store|model|charts)：/.test(s));
ok(uiErr2.length === 0, '全程界面没有报错事件：' + uiErr2.join('｜'));
ok(errs.length === 0, '全程控制台没有报错：' + errs.slice(0, 2).join('｜'));
console.error = consoleErr;
done();
