/* HY.ui.calendar —— 历法卡：本年交节、四年庆典表、本年黑月期、本年节令与正文日期、日期换算、年号口径（规格：spec/03 第九节第 4 条“一年”页）
 * 负责：D 路（界面）。
 * 统筹修订：日期一律写成“第 N 年 · 入冬后第 d 日”（HY.world.fmtCal），不写月日；节令取 HY.world.markList，待定的加“待定”。
 * 年号口径（HY.world.CAL.yearStart）待作者拍板：卡片里给一个预览开关，只改内存里的口径、不存档。
 * 写入的状态：time.t（点表里的行跳过去，src:'jump'）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var C = ui.calendar = ui.calendar || {};
  C.__stub = false;

  var CROSS = { winter: '入冬（飞升日）', winterSolstice: '冬至', summer: '入夏', summerSolstice: '夏至' };
  C.YEAR_STARTS = [
    { v: 'civil', label: '旧民用历岁首（默认）', note: '换号落在入冬后第 61 日；正典年份都不动。' },
    { v: 'winter', label: '入冬交节', note: '庆典年的第一天就是飞升日；D1、庆典夜算在前一年。' },
    { v: 'winterEnd', label: '以入冬交节收尾', note: '庆典夜是年末最后一夜；飞升日算下一年。' }
  ];

  // 第 N 年里的四个交节（落在本年范围内的，伊美忒地方日），按时间排序；数据取 HY.calc.crossingsInYear
  C.crossingsIn = function (N, P) {
    return HY.calc.crossingsInYear(N, P, P.epochAz).map(function (x) {
      return { key: x.key, label: CROSS[x.key] || x.name, t: x.t, elong: x.elong, sunlit: x.sunlit, state: x.state, civil: x.civil };
    });
  };

  C.init = function () {
    var el = G.document.getElementById('calendar'), w = ui.w, W = HY.world, U = HY.util;
    el.textContent = '';
    var head = w.h('div', 'card-head');
    var title = w.h('h3', '', '历法');
    head.appendChild(title);
    el.appendChild(head);
    var yearLine = w.h('p', 'cal-year num');
    el.appendChild(yearLine);

    function table(cls, cols) {
      var t = w.h('table', 'tbl ' + (cls || '')), th = w.h('thead'), tr = w.h('tr');
      cols.forEach(function (c) { tr.appendChild(w.h('th', '', c)); });
      th.appendChild(tr); t.appendChild(th);
      var tb = w.h('tbody'); t.appendChild(tb);
      return { el: t, body: tb };
    }
    function jumpRow(tr, t) {
      tr.tabIndex = 0; tr.classList.add('jumpable'); tr.title = '跳到这一刻';
      tr.addEventListener('click', function () { HY.store.set('time.t', t, 'jump'); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); HY.store.set('time.t', t, 'jump'); } });
    }
    function td(tr, text, cls) { var c = w.h('td', cls || '', text); tr.appendChild(c); return c; }
    function sec(t) { var s = w.fold(t, '历法' + t, true, { cls: 'csec' }); el.appendChild(s.el); return s; }

    var sCross = sec('本年交节');
    var tCross = table('', ['交节', '日期（伊美忒）', '时刻', '月对日', '月']);
    sCross.body.appendChild(tCross.el);
    sCross.body.appendChild(w.h('p', 'w-note', '月对日：月在日之西为正；±180° 是三点一线。'));

    var sFest = sec('四年庆典');
    var tFest = table('', ['年', '入冬时月对日', '庆典', '余量']);
    sFest.body.appendChild(tFest.el);
    sFest.body.appendChild(w.h('p', 'w-note', '入冬交节那一刻月在塔影里，这一年就是庆典年。余量是离“不成立”还差几日。'));

    var sBlack = sec('本年黑月期（此地子夜）');
    var lBlack = w.h('ul', 'cal-list num');
    sBlack.body.appendChild(lBlack);

    var sMarks = sec('本年节令与正文日期');
    var tMarks = table('', ['', '日期', '']);
    sMarks.body.appendChild(tMarks.el);

    var sConv = sec('日期换算');
    var cN = w.numBox({ label: '年', min: ui.timebar.YEAR_MIN, max: ui.timebar.YEAR_MAX, step: 1, onInput: conv });
    var cD = w.numBox({ label: '入冬后第几日', min: 1, max: 360, step: 1, onInput: conv });
    // 钟点与时间栏的“日期…”对话框一样分成时、分两个框（不再填“21.5 时”这样的小数）
    var cH = w.numBox({ label: '时', min: 0, max: 23, step: 1, onInput: conv });
    var cM = w.numBox({ label: '分', min: 0, max: 59, step: 1, onInput: conv });
    var crow = w.h('div', 'dlg-row'), crow2 = w.h('div', 'dlg-row');
    // 输入框两旁的字跟着历法叫法（HY.world.CAL.names）走
    var yp = ui.timebar.tplParts(W.CAL.names.year, 'N'), dp = ui.timebar.tplParts(W.CAL.names.winterDay, 'd');
    function txt(s, row) { if (s) (row || crow).appendChild(w.h('span', 'dlg-txt', s)); }
    txt(yp[0]); crow.appendChild(cN.el); txt([yp[1], dp[0]].filter(Boolean).join(' '));
    crow.appendChild(cD.el); txt(dp[1]);
    crow2.appendChild(cH.el); txt('时', crow2); crow2.appendChild(cM.el); txt('分（此地地方时）', crow2);
    sConv.body.appendChild(crow); sConv.body.appendChild(crow2);
    var cOut = w.h('p', 'cal-conv num');
    sConv.body.appendChild(cOut);
    var cGo = w.btn('跳到这一刻', { cls: 'btn btn-mini', onClick: function () { var q = convVal(); if (q) HY.app.setTime({ year: q.N, wd: q.wd, hour: q.hr }); } });
    var cNow = w.btn('填入此刻', { cls: 'btn btn-mini', onClick: fillNow });
    var cBtns = w.h('div', 'p-actions'); cBtns.appendChild(cGo); cBtns.appendChild(cNow);
    sConv.body.appendChild(cBtns);

    var sStart = sec('年号从哪天换号（待作者拍板）');
    var ys = w.select({ label: '口径', opts: C.YEAR_STARTS.map(function (o) { return { v: o.v, label: o.label }; }), value: W.CAL.yearStart,
      onInput: function (v) { W.CAL.yearStart = v; HY.model.rebuild(); } });
    var ysNote = w.h('p', 'w-note');
    sStart.body.appendChild(ys.el); sStart.body.appendChild(ysNote);
    sStart.body.appendChild(w.h('p', 'w-note', '只是预览，不存档；刷新页面回到默认。内部时间不变，只改“第 N 年”从哪天起算。'));

    function fillNow() {
      var n = HY.model.now;
      cD.setRange(1, Math.round(HY.model.P.Y));                // 改了年长 Y，“入冬后第几日”的上限跟着变
      var m = Math.round(n.hour * 60) % 1440;
      cN.set(n.date.N); cD.set(n.cal.wd); cH.set(Math.floor(m / 60)); cM.set(m % 60); conv();
    }
    // 换算框里的值（取整、夹在范围内；年份空着时返回 null）。hr＝时＋分/60
    function convVal() {
      var P = HY.model.P, TB = ui.timebar, N = Math.round(cN.get()), wd = Math.round(cD.get());
      var hh = Math.max(0, Math.min(23, Math.floor(cH.get() || 0))), mi = Math.max(0, Math.min(59, Math.round(cM.get() || 0))), hr = hh + mi / 60;
      if (!isFinite(N) || !N) return null;
      return { N: Math.max(TB.YEAR_MIN, Math.min(TB.YEAR_MAX, N)), wd: Math.max(1, Math.min(Math.round(P.Y), isFinite(wd) && wd ? wd : 1)),
        hr: Math.max(0, Math.min(P.dayHours - 1e-6, isFinite(hr) ? hr : 0)) };
    }
    function conv() {
      var P = HY.model.P, q = convVal();
      if (!q) { cOut.textContent = ''; return; }
      cOut.textContent = ui.timebar.calLine(HY.calc.tOfWd(q.N, q.wd, q.hr, HY.state.site.az, P), HY.model.O, P);
    }
    C.convVal = convVal;

    var key = '';
    function render(force) {
      var n = HY.model.now, P = HY.model.P, O = HY.model.O;
      if (!n || !n.cal || !P) return;
      var N = n.date.N, k = N + '|' + HY.model.pv + '|' + HY.model.siteKey() + '|' + W.CAL.yearStart + '|' + HY.state.fp.set.yuxiLead;
      if (HY.state.ui.tab !== 'year') { key = ''; return; }      // 不可见时不算，切过来再算
      if (!force && k === key) return;
      key = k;
      yearLine.textContent = W.fmtCal(n.cal, 'year');
      ys.set(W.CAL.yearStart);
      ysNote.textContent = (C.YEAR_STARTS.filter(function (o) { return o.v === W.CAL.yearStart; })[0] || {}).note || '';
      // 交节
      tCross.body.textContent = '';
      HY.model.cached('cal.cross', [N, W.CAL.yearStart], function () { return C.crossingsIn(N, P); }).forEach(function (x) {
        var tr = w.h('tr'), c = x.civil;
        td(tr, x.label);
        td(tr, W.fmtCal({ wd: c.wd }, 'date'), 'num');
        td(tr, HY.calc.hhmm(c.hour), 'num');
        td(tr, U.fixed(x.elong, 0) + '°', 'num');
        td(tr, W.CAL.names.moon[x.state] || x.state);
        jumpRow(tr, x.t);
        tCross.body.appendChild(tr);
      });
      // 四年庆典（前后各四年）
      tFest.body.textContent = '';
      HY.model.cached('cal.fest', [N], function () { return HY.calc.festivals(N - 4, 9, P); }).forEach(function (f) {
        var tr = w.h('tr', f.N === N ? 'cur' : '');
        td(tr, W.fmtCal({ N: f.N }, 'year'), 'num');
        td(tr, U.fixed(f.elong, 0) + '°', 'num');
        td(tr, f.festival ? W.CAL.names.festivalYear : '—', f.festival ? 'fest' : '');
        td(tr, isFinite(f.marginDays) ? U.fixed(f.marginDays, 2) + ' 日' : '—', 'num');
        jumpRow(tr, f.t);
        tFest.body.appendChild(tr);
      });
      // 黑月期（此地）
      lBlack.textContent = '';
      var bp = HY.model.cached('cal.black', [N, W.CAL.yearStart], function () { return HY.calc.blackPeriods(N, O, P); });
      if (!bp.length) lBlack.appendChild(w.h('li', 'w-note', '本年没有'));
      bp.forEach(function (b) {
        var li = w.h('li', 'jumpable');
        li.textContent = W.fmtCal({ wd: b.from.wd }, 'date') + ' 夜 — ' + W.fmtCal({ wd: b.to.wd }, 'date') + ' 夜（' + b.nights + ' 夜）';
        jumpRow(li, b.t0 - 2 / P.dayHours);            // 第一夜的 22 时（此地地方时）
        lBlack.appendChild(li);
      });
      // 节令与正文日期
      tMarks.body.textContent = '';
      W.markList(N, P, { az: HY.state.site.az, yuxiLead: HY.state.fp.set.yuxiLead }).forEach(function (m) {
        var tr = w.h('tr', 'k-' + m.kind);
        td(tr, m.label);
        td(tr, W.fmtCal({ wd: m.wd }, 'date') + (m.id !== 'winter' && m.id !== 'wsol' && m.id !== 'summer' && m.id !== 'ssol' && m.id !== 'yuxi' ? ' ' + HY.calc.hhmm(HY.calc.civil(m.t, HY.state.site.az, P).hour) : ''), 'num');
        td(tr, m.tbd ? W.CAL.names.tbd : (m.kind === 'setting' ? '设定' : ''), m.tbd ? 'tbd' : 'w-note');
        tr.title = [m.note, ui.timebar.toWinterText(m.wd, P)].filter(Boolean).join('；');
        jumpRow(tr, m.t);
        tMarks.body.appendChild(tr);
      });
      if (!cN.get()) fillNow(); else conv();
    }
    HY.bus.on('model', function () { HY.model.tick(); render(true); });
    HY.bus.on('ui', function (e) { if (e && (e.path === 'ui.tab' || e.path === 'ui')) render(false); });
    HY.bus.on('time', function (e) { if (e && e.src !== 'play') { HY.model.tick(); render(false); } });
    HY.bus.on('fp', function (e) { if (ui.touches(e, 'fp.set.yuxiLead')) render(true); });
    var last = 0;
    HY.bus.on('frame', function () { var t = Date.now(); if (t - last > 1000) { last = t; render(false); } });
    render(true);
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
