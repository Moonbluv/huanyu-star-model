/* HY.ui.keys —— 快捷键（规格：spec/03 第九节第 7 条）
 *   空格 播放／暂停 · 1／2 总览／第一人称 · [ ] 前后一小时 · Shift+[ ] 前后一日 · Alt+[ ]（或 { }）前后一个月（朔望月）
 *   P 侧栏 · H 隐藏界面 · F 全屏 · O 依次切总览预设（总览时）· Esc 第一人称准备中时取消
 * 负责：D 路（界面）。第一人称的 WASD、Shift、R、T、Esc（退出指针锁定）归 HY.fp.ctl（G 路），这里不处理。
 * 美式键盘上 Shift+[ 打出的就是 {，所以“一个月”另用 Alt+[ ]；别的键盘布局里单独打出 { } 时也算一个月。
 * 焦点在输入框、下拉框里时不响应；焦点在按钮、开关上时空格留给它们。
 * 写入的状态：time.t（src:'ui'）、time.playing、view.mode、ui.panel、ui.chrome；预设经 HY.ui.layout。
 * 纯函数 map、editable 加载时不碰 DOM（test/ui_check.js 在 node 里测）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var K = ui.keys = ui.keys || {};
  K.__stub = false;

  var TEXTLESS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'];
  // 焦点在可输入的地方：一律不响应
  K.editable = function (t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = String(t.tagName).toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXTLESS.indexOf(String(t.type || 'text').toLowerCase()) < 0;
    return false;
  };
  // 焦点在按钮、开关、折叠标题上：空格与回车留给它们
  K.pressable = function (t) {
    if (!t || !t.tagName) return false;
    var tag = String(t.tagName).toUpperCase();
    return tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A' || (tag === 'INPUT' && TEXTLESS.indexOf(String(t.type || '').toLowerCase()) >= 0);
  };

  /* 按键 → 动作（纯函数）。e：{key, code, shiftKey, altKey, ctrlKey, metaKey, getModifierState?}；ctx：{view, loading}
   * 动作：{act:'nudge', unit:'hour'|'day'|'month', dir:±1} | {act:'play'} | {act:'view', mode} | {act:'panel'} | {act:'chrome'}
   *       | {act:'full'} | {act:'preset'} | {act:'cancel'} | null */
  K.map = function (e, ctx) {
    ctx = ctx || {};
    var key = e.key || '', code = e.code || '';
    var altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
    if ((e.ctrlKey || e.metaKey) && !altGr) return null;          // 浏览器自己的快捷键
    var bracketCode = code === 'BracketLeft' || code === 'BracketRight';
    var brace = key === '{' || key === '}';
    if (bracketCode || key === '[' || key === ']' || brace) {
      var dir = (code === 'BracketLeft' || (!bracketCode && (key === '[' || key === '{'))) ? -1 : 1;
      var unit;
      if (e.altKey && !altGr) unit = 'month';
      else if (bracketCode) unit = e.shiftKey ? 'day' : 'hour';     // 美式键盘：Shift+[ 打出 {，按“一日”算
      else unit = brace ? 'month' : 'hour';
      return { act: 'nudge', unit: unit, dir: dir };
    }
    if (e.altKey && !altGr) return null;
    if (key === ' ' || code === 'Space') return { act: 'play' };
    if (key === '1' || code === 'Digit1' && !e.shiftKey) return { act: 'view', mode: 'ov' };
    if (key === '2' || code === 'Digit2' && !e.shiftKey) return { act: 'view', mode: 'fp' };
    if (key === 'Escape') return ctx.loading ? { act: 'cancel' } : null;
    var k = key.length === 1 ? key.toLowerCase() : '';
    if (k === 'p') return { act: 'panel' };
    if (k === 'h') return { act: 'chrome' };
    if (k === 'f') return { act: 'full' };
    if (k === 'o') return ctx.view === 'ov' ? { act: 'preset' } : null;
    return null;
  };

  // 一步多长（日）：一小时、一日、一个朔望月
  K.stepDays = function (unit, P) {
    if (unit === 'hour') return 1 / (P && P.dayHours ? P.dayHours : 24);
    if (unit === 'day') return 1;
    return P && P.M ? P.M : 29.3878;
  };

  K.run = function (a) {
    if (!a) return false;
    var S = HY.store, st = HY.state, L = ui.layout;
    switch (a.act) {
      case 'nudge':
        if (ui.timebar && ui.timebar.nudge) ui.timebar.nudge(a.dir * K.stepDays(a.unit, HY.model.P));
        else S.set('time.t', st.time.t + a.dir * K.stepDays(a.unit, HY.model.P), 'ui');
        return true;
      case 'play': S.set('time.playing', !st.time.playing, 'ui'); return true;
      case 'view':
        // 进第一人称走 layout 的统一入口：不可用时不切视图，提示中文原因
        if (a.mode === 'fp' && st.view.mode !== 'fp' && L && L.toFp) { L.toFp('ui'); return true; }
        S.set('view.mode', a.mode, 'ui'); return true;
      case 'panel': S.set('ui.panel', !st.ui.panel, 'ui'); return true;
      case 'chrome': S.set('ui.chrome', !st.ui.chrome, 'ui'); return true;
      case 'full':
        if (!G.document || !G.document.fullscreenEnabled || !L) return false;
        L.fullscreen(); return true;
      case 'preset': if (L) L.cyclePreset(); return true;
      case 'cancel': S.set('view.mode', 'ov', 'ui'); return true;
    }
    return false;
  };

  function ctxNow() {
    var mode = HY.state.view.mode, act = HY.app && HY.app.active ? HY.app.active() : null;
    return { view: mode, loading: mode === 'fp' && act !== 'fp' };
  }
  // 处理一次按键事件；返回是否处理了（测试也调它）
  K.handle = function (e) {
    if (e.defaultPrevented || e.isComposing) return false;
    var t = e.target;
    if (K.editable(t)) return false;
    var a = K.map(e, ctxNow());
    if (!a) return false;
    if (a.act === 'play' && K.pressable(t)) return false;
    if (e.repeat && a.act !== 'nudge') return false;            // 按住不放时只有时间步进连发
    var done = K.run(a);
    if (done && e.preventDefault) e.preventDefault();
    return done;
  };

  var wired = false;
  K.init = function () {
    if (wired || !G.addEventListener) return;
    wired = true;
    G.addEventListener('keydown', function (e) { try { K.handle(e); } catch (x) { if (G.console) G.console.error(x); } });
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
