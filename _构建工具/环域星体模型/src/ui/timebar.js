/* HY.ui.timebar —— 时间栏：播放、速度、年份步进、日期与钟点滑杆、季节带与节令标记、跳到…、日期…（规格：spec/03 第九节第 3 条）
 * 负责：D 路（界面）。
 * 统筹修订（历法）：一律显示“第 N 年（庆典年／周期第 k 年）· 入冬后第 d 日 · 冬／夏第 n 日 · 月态第几夜”，
 *   文字只用 HY.world.fmtCal 生成；日期滑杆的横轴是第 N 年的 doy（0 … Y−1），刻度与悬停写“入冬后第 X 日”；
 *   “日期…”输入：年、入冬后第几日、时、分（HY.calc.tOfWd 换算；不输入月、日）。
 * 写入的状态：time.t（滑杆、步进 src:'ui'；跳到、日期对话 src:'jump'）、time.playing、time.speed.ov／fp。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var T = ui.timebar = ui.timebar || {};
  T.__stub = false;

  var YEAR_MIN = 9818, YEAR_MAX = 10218;     // 01 逐年验证过的 400 年
  T.YEAR_MIN = YEAR_MIN; T.YEAR_MAX = YEAR_MAX;

  // 速度档（模拟秒／真实秒）；总览的“每秒一个月”按当前朔望月
  T.speeds = function (view, P) {
    if (view === 'fp') return [[1, '实时 ×1'], [60, '×60'], [600, '×600'], [3600, '×3600']];
    var M = P ? P.M : 29.3878;
    return [[3600, '每秒一小时'], [7200, '每秒一个时辰'], [86400, '每秒一日'], [864000, '每秒十日'], [Math.round(M * 86400), '每秒一个月']];
  };
  // 跳到…菜单（kind 交给 HY.calc.findNext；mark 交给 HY.world.markT）
  T.JUMPS = [
    { head: '一日' },
    { kind: 'dawn', label: '破晓', title: '日面开始被塔的东缘切出' },
    { kind: 'noon', label: '正午' },
    { kind: 'dusk', label: '黄昏', title: '日面开始被塔的西缘切没' },
    { kind: 'midnight', label: '子夜' },
    { head: '节令' },
    { kind: 'winter', label: '入冬交节', title: '飞升日：日往上、月往下同过塔腰（伊美忒子夜）' },
    { kind: 'festivalNight', label: '庆典夜', title: '入冬前夜 21 时，守夜到子夜交节' },
    { kind: 'winterSolstice', label: '冬至' },
    { kind: 'summer', label: '入夏' },
    { kind: 'summerSolstice', label: '夏至' },
    { head: '月' },
    { kind: 'blackCenter', label: '黑月正中', title: '日、塔、月一线' },
    { kind: 'blackHigh', label: '此地黑月高悬', title: '此地下一次黑月高悬开始' },
    { kind: 'litMoonNight', label: '此地今夜亮月最高' },
    { kind: 'eclipse', label: '此地日食', title: '此地下一次日面被遮过半（搜两年）' },
    { head: '正文（日期待定）' },
    { mark: 'd1', label: '审判 D1 夜' },
    { mark: 'd2', label: '审判 D2 夜' },
    { mark: 'd3', label: '审判 D3 夜' },
    { mark: 'heiyao', label: '黑曜日之夜', withYear: true }        // 按钮上补“（第 10008 年）”：年份取 HY.world.MARKS，写法取 fmtCal
  ];

  // 历法模板（HY.world.CAL.names）拆成输入框两旁的字：('第 {N} 年', 'N') → ['第', '年']；没有占位符时整句放前面
  T.tplParts = function (tpl, key) {
    tpl = String(tpl || ''); var mk = '{' + key + '}', i = tpl.indexOf(mk);
    return i < 0 ? [tpl.trim(), ''] : [tpl.slice(0, i).trim(), tpl.slice(i + mk.length).trim()];
  };
  // 菜单上的文字：只属于某一年的正文日期（黑曜日）补上年号，写法与年份都跟着 HY.world
  T.jumpLabel = function (it) {
    var m = it.withYear && it.mark ? HY.world.markById(it.mark) : null;
    return m && m.year != null ? it.label + '（' + HY.world.fmtCal({ N: m.year }, 'year') + '）' : it.label;
  };

  function $(id) { return G.document.getElementById(id); }
  function P() { return HY.model.P; }
  function setT(t, src) { HY.store.set('time.t', t, src || 'ui'); }

  /* 跳转（菜单、快捷键、测试共用）：返回新 t，搜不到返回 null 并提示 */
  T.jump = function (it, dir) {
    var t = HY.state.time.t, nt = null, Pp = P();
    if (it.mark) nt = HY.world.markT(it.mark, HY.model.now.date.N, HY.state.site.az, Pp, { yuxiLead: HY.state.fp.set.yuxiLead });
    else nt = HY.calc.findNext(it.kind, HY.model.O, t, Pp, dir === -1 ? -1 : 1);
    if (nt == null || !isFinite(nt)) {
      var msg = it.kind === 'eclipse' ? '此地两年内无日食' : '没有找到“' + it.label + '”';
      if (ui.layout) ui.layout.toast(msg);
      return null;
    }
    setT(nt, 'jump');
    return nt;
  };
  // 前后推若干日（快捷键 [ ] 等）
  T.nudge = function (days) { setT(HY.state.time.t + days, 'ui'); };
  // 换年、换日、换钟点：保留其余两项（此地地方时）
  T.setParts = function (N, doy, hour) {
    var Pp = P(), az = HY.state.site.az;
    N = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(N)));
    doy = Math.max(0, Math.min(Pp.Y - 1, Math.floor(doy)));
    hour = Math.max(0, Math.min(Pp.dayHours - 1e-6, hour));
    setT(HY.calc.tOfCivil(N, doy, hour, az, Pp), 'ui');
  };
  /* “入冬后第 d 日”离下一次入冬还有几日（纯函数）：正文按“入冬前 N 日”记日子，这一句让两种说法直接对上。
   *   默认年号口径下，“第 10018 年 · 入冬后第 294 日”数的是 10017 年那次入冬，离 10018 年的入冬还有 67 日 */
  T.toWinter = function (wd, Pp) { var Y = Math.round((Pp && Pp.Y) || 360); return wd == null ? null : Y - wd + 1; };
  T.toWinterText = function (wd, Pp) {
    var d = T.toWinter(wd, Pp);
    return d == null ? '' : wd === 1 ? '入冬当日' : '距下次入冬 ' + d + ' 日';
  };
  /* 节令小菱形挨得太近（审判 D1–D3 三夜相邻、庆典夜与入冬只差 3 小时）时错开摆（纯函数）：
   *   xs＝各标记的横坐标（像素，已按时间排序），gap＝最小间距 → 新的横坐标。一串挨着的标记以原中心为准左右摊开，
   *   位置只挪几像素，悬停与点选仍各是各的（提示里写的是准确的日子） */
  T.spread = function (xs, gap) {
    var out = xs.slice(), i = 0;
    while (i < out.length) {
      var j = i;
      while (j + 1 < out.length && xs[j + 1] - xs[j] < gap) j++;
      if (j > i) {
        var c = (xs[i] + xs[j]) / 2, n = j - i + 1;
        for (var k = 0; k < n; k++) out[i + k] = c + (k - (n - 1) / 2) * gap;
      }
      i = j + 1;
    }
    return out;
  };
  // 距下一个庆典年几年（0＝本年是）
  T.toFestival = function (N, Pp) {
    for (var k = 0; k < 8; k++) if (HY.astro.isFestival(N + k, Pp)) return k;
    return -1;
  };
  /* 年份旁注（纯函数）：c＝CalInfo（N、cyc、festival）→ “庆典年 · 周期第 1 年”“距庆典 3 年 · 周期第 2 年”。
   * 参数破坏了庆典节律时（八年内没有庆典、cyc 为 null）不写“周期第 null 年”，改写“当前参数下没有庆典” */
  T.yearNote = function (c, Pp) {
    var W = HY.world, n = W.CAL.names, k = T.toFestival(c.N, Pp), parts = [];
    if (k === 0) parts.push(n.festivalYear);
    else if (k > 0) parts.push('距庆典 ' + k + ' 年');
    if (c.cyc != null) parts.push(W.tpl(n.cycle, { k: c.cyc }));
    if (!parts.length) parts.push('当前参数下没有庆典');
    return { text: parts.join(n.sep), festival: k === 0 };
  };
  /* 任一时刻 t 在地点 O 的完整历法文字（纯函数；“日期…”预览、历法卡的日期换算共用）：
   * 第 N 年（庆典年 · 周期第 k 年）· 入冬后第 d 日 · 冬／夏第 n 日 · 月态第几夜 · 21:00 · 夜 */
  T.calLine = function (t, O, Pp) {
    var W = HY.world, C = HY.calc, c = C.civil(t, O.az, Pp), so = C.seasonOf(t, O, Pp), mn = C.moonNight(O, t, Pp);
    var info = { N: c.N, cyc: c.cyc, festival: c.festival, wd: c.wd, season: so.season, seasonDay: so.n, moonState: mn.state, moonNight: mn.night };
    var night = HY.astro.sunlitAt(O, t, Pp) < 0.5;
    return [W.fmtCal(info, 'full'), C.hhmm(c.hour), night ? '夜' : '昼'].join(W.CAL.names.sep);
  };
  // 第 N 年里此地的季节分段 [{from, to, season}]（doy，按此地半球）
  T.seasonSegs = function (N, O, Pp) {
    var segs = [], last = null, az = O.az;
    for (var d = 0; d < Pp.Y; d++) {
      var s = HY.astro.seasonAt(HY.calc.tOfCivil(N, d, 12, az, Pp), O, Pp);
      if (!last || last.season !== s) { last = { from: d, to: d + 1, season: s }; segs.push(last); }
      else last.to = d + 1;
    }
    return segs;
  };

  T.init = function () {
    var el = $('timebar'), w = ui.w, S = HY.store, W = HY.world;
    el.textContent = '';
    var row1 = w.h('div', 'tb-row tb-row1'), row2 = w.h('div', 'tb-row tb-row2');
    el.appendChild(row1); el.appendChild(row2);

    /* 播放与速度 */
    var play = w.btn('▶', { cls: 'btn play', aria: '播放／暂停（空格）', title: '播放／暂停（空格）', pressed: false, onClick: function () { S.set('time.playing', !HY.state.time.playing, 'ui'); } });
    var speed = w.h('select', 'tb-speed'); speed.setAttribute('aria-label', '时间流速');
    speed.addEventListener('change', function () {
      S.set(HY.state.view.mode === 'fp' ? 'time.speed.fp' : 'time.speed.ov', +speed.value, 'ui');
    });
    row1.appendChild(play); row1.appendChild(speed);

    /* 年份步进 */
    var yr = w.h('div', 'tb-year');
    var yPrev = w.btn('‹', { cls: 'btn btn-icon', aria: '上一年', title: '上一年', onClick: function () { var d = HY.model.now.date; T.setParts(d.N - 1, d.doy, d.hour); } });
    var yLab = w.h('span', 'tb-ylab');
    var yNext = w.btn('›', { cls: 'btn btn-icon', aria: '下一年', title: '下一年', onClick: function () { var d = HY.model.now.date; T.setParts(d.N + 1, d.doy, d.hour); } });
    var yNote = w.h('span', 'tb-ynote');
    yr.appendChild(yPrev); yr.appendChild(yLab); yr.appendChild(yNext); yr.appendChild(yNote);
    row1.appendChild(yr);

    /* 当前日期文字 */
    var label = w.h('span', 'tb-date num'); label.setAttribute('aria-live', 'off');
    row1.appendChild(label);

    /* 跳到… */
    var jdir = 1;
    var jp = w.pop('跳到… ▾', { cls: 'tb-jump', aria: '跳到某个时刻', align: 'up' });
    var jseg = w.seg({ label: '', opts: [{ v: 1, label: '往后' }, { v: -1, label: '往前' }], value: 1, onInput: function (v) { jdir = +v; } });
    jp.panel.appendChild(jseg.el);
    var jlist = w.h('div', 'menu');
    T.JUMPS.forEach(function (it) {
      if (it.head) { jlist.appendChild(w.h('div', 'menu-head', it.head)); return; }
      var b = w.btn(T.jumpLabel(it), { cls: 'menu-item', title: it.title || T.jumpLabel(it), onClick: function () { if (T.jump(it, jdir) != null) jp.open(false); } });
      jlist.appendChild(b);
    });
    jp.panel.appendChild(jlist);
    row1.appendChild(jp.wrap);

    /* 日期…（年、入冬后第几日、时、分） */
    var dp = w.pop('日期…', { cls: 'tb-dlg', aria: '输入日期', align: 'up', onOpen: fillDlg });
    var form = w.h('div', 'dlg');
    var fN = w.numBox({ label: '年', min: YEAR_MIN, max: YEAR_MAX, step: 1, onInput: preview });
    var fD = w.numBox({ label: '入冬后第几日', min: 1, max: 360, step: 1, onInput: preview });
    var fH = w.numBox({ label: '时', min: 0, max: 23, step: 1, onInput: preview });
    var fM = w.numBox({ label: '分', min: 0, max: 59, step: 1, onInput: preview });
    function field(lab, nb, pre, post) {
      var r = w.h('label', 'dlg-row');
      if (!pre) r.appendChild(w.h('span', 'dlg-lab', lab));
      if (pre) r.appendChild(w.h('span', 'dlg-txt', pre));
      r.appendChild(nb.el);
      if (post) r.appendChild(w.h('span', 'dlg-txt', post));
      return r;
    }
    var yTx = T.tplParts(W.CAL.names.year, 'N'), dTx = T.tplParts(W.CAL.names.winterDay, 'd');      // 输入框两旁的字跟着历法叫法走
    form.appendChild(field('年', fN, yTx[0], yTx[1]));
    form.appendChild(field('日', fD, dTx[0], dTx[1]));
    var hm = w.h('div', 'dlg-row');
    hm.appendChild(fH.el); hm.appendChild(w.h('span', 'dlg-txt', '时')); hm.appendChild(fM.el); hm.appendChild(w.h('span', 'dlg-txt', '分'));
    form.appendChild(hm);
    var pv = w.h('p', 'w-note dlg-pv');
    form.appendChild(pv);
    form.appendChild(w.h('p', 'w-note', '按此地地方时换算。'));
    var go = w.btn('跳到这一刻', { cls: 'btn btn-primary', onClick: function () {
      var q = dlgVal(); HY.app.setTime({ year: q.N, wd: q.wd, hour: q.hour }); dp.open(false);
    } });
    form.appendChild(go);
    [fN, fD, fH, fM].forEach(function (b) { b.el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); }); });
    dp.panel.appendChild(form);
    row1.appendChild(dp.wrap);
    function dlgVal() {
      var Pp = P();
      // 回车可能先于数值框的 change（夹取）到达：这里再夹一遍，年份不出 01 验证过的 400 年
      var N = Math.round(fN.get()) || HY.model.now.date.N;
      return { N: Math.max(YEAR_MIN, Math.min(YEAR_MAX, N)), wd: Math.max(1, Math.min(Pp.Y, Math.round(fD.get()) || 1)),
        hour: Math.max(0, Math.min(23, fH.get() || 0)) + Math.max(0, Math.min(59, fM.get() || 0)) / 60 };
    }
    function fillDlg() {
      var n = HY.model.now, m = Math.round(n.hour * 60) % 1440;
      fN.set(n.date.N); fD.set(n.cal.wd); fH.set(Math.floor(m / 60)); fM.set(m % 60);
      fD.setRange(1, Math.round(P().Y));
      preview();
    }
    function preview() {
      var q = dlgVal(), Pp = P(), az = HY.state.site.az;
      pv.textContent = T.calLine(HY.calc.tOfWd(q.N, q.wd, q.hour, az, Pp), HY.model.O, Pp);
    }

    /* 第二行：季节带＋节令标记＋日期滑杆；钟点滑杆 */
    var dateBox = w.h('div', 'tb-dbox');
    var band = w.h('div', 'tb-band'); band.setAttribute('aria-hidden', 'true');
    var marks = w.h('div', 'tb-marks');
    var dIn = w.h('input', 'tb-dslider'); dIn.type = 'range'; dIn.min = 0; dIn.max = 359; dIn.step = 1;
    dIn.setAttribute('aria-label', '日期（本年第几日）');
    dIn.addEventListener('input', function () { var d = HY.model.now.date; T.setParts(d.N, +dIn.value, d.hour); });
    var dTip = w.h('span', 'tb-dtip');
    dateBox.appendChild(marks); dateBox.appendChild(band); dateBox.appendChild(dIn); dateBox.appendChild(dTip);
    row2.appendChild(dateBox);
    var hourBox = w.h('div', 'tb-hbox');
    var hIn = w.h('input', 'tb-hslider'); hIn.type = 'range'; hIn.min = 0; hIn.max = 24; hIn.step = 1 / 60;
    hIn.setAttribute('aria-label', '此地地方时');
    hIn.addEventListener('input', function () { var d = HY.model.now.date; T.setParts(d.N, d.doy, +hIn.value); });
    var hOut = w.h('span', 'tb-hout num');
    hourBox.appendChild(hIn); hourBox.appendChild(hOut);
    row2.appendChild(hourBox);
    // 日期滑杆悬停：显示那一天是“入冬后第几日”
    dIn.addEventListener('mousemove', function (e) {
      var r = dIn.getBoundingClientRect(), Pp = P();
      if (!r.width) return;
      var d = Math.max(0, Math.min(Pp.Y - 1, Math.round((e.clientX - r.left) / r.width * (Pp.Y - 1))));
      var t = HY.calc.tOfCivil(HY.model.now.date.N, d, 12, HY.state.site.az, Pp), c = HY.calc.civil(t, HY.state.site.az, Pp);
      dTip.textContent = W.fmtCal({ wd: c.wd }, 'date');
      dTip.style.left = (100 * d / Math.max(1, Pp.Y - 1)) + '%';
      dTip.hidden = false;
    });
    dIn.addEventListener('mouseleave', function () { dTip.hidden = true; });
    dTip.hidden = true;

    // 拖动中不回写滑块位置
    var drag = { d: false, h: false };
    [[dIn, 'd'], [hIn, 'h']].forEach(function (p) {
      p[0].addEventListener('pointerdown', function () { drag[p[1]] = true; });
      ['pointerup', 'pointercancel', 'change', 'blur'].forEach(function (ev) { p[0].addEventListener(ev, function () { drag[p[1]] = false; }); });
    });

    /* 刷新 */
    var lastKey = '', bandKey = '', speedKey = '';
    function showSpeeds() {
      var v = HY.state.view.mode, Pp = P(), opts = T.speeds(v, Pp), cur = v === 'fp' ? HY.state.time.speed.fp : HY.state.time.speed.ov;
      var key = v + '|' + cur + '|' + (Pp ? Pp.M : 0);
      if (key === speedKey) return;
      speedKey = key;
      speed.textContent = '';
      var hit = false;
      opts.forEach(function (o) { var op = w.h('option', '', o[1]); op.value = String(o[0]); speed.appendChild(op); if (Math.abs(o[0] - cur) < 0.5) hit = true; });
      if (!hit) { var op = w.h('option', '', '×' + HY.util.thousands(cur, 0)); op.value = String(cur); speed.appendChild(op); }
      var best = opts.reduce(function (b, o) { return Math.abs(o[0] - cur) < Math.abs(b[0] - cur) ? o : b; }, opts[0]);
      speed.value = String(hit ? best[0] : cur);
    }
    function showBand(force) {
      var n = HY.model.now, Pp = P(); if (!n || !Pp) return;
      var N = n.date.N, key = N + '|' + HY.model.pv + '|' + HY.model.siteKey() + '|' + HY.state.fp.set.yuxiLead + '|' + W.CAL.yearStart;
      if (!force && key === bandKey) return;
      bandKey = key;
      dIn.max = Pp.Y - 1;
      var segs = HY.model.cached('tb.season', [N, W.CAL.yearStart], function () { return T.seasonSegs(N, HY.model.O, Pp); });
      band.textContent = '';
      segs.forEach(function (s) {
        var d = w.h('span', 'tb-seg s-' + (s.season === '冬' ? 'winter' : s.season === '夏' ? 'summer' : 'eq'));
        d.style.left = (100 * s.from / Pp.Y) + '%'; d.style.width = (100 * (s.to - s.from) / Pp.Y) + '%';
        if (s.to - s.from > 40) d.textContent = W.CAL.names.season[s.season] || s.season;
        band.appendChild(d);
      });
      marks.textContent = '';
      var list = W.markList(N, Pp, { az: HY.state.site.az, yuxiLead: HY.state.fp.set.yuxiLead }), t0 = W.yearSpan(N, Pp, HY.state.site.az)[0];
      list.forEach(function (m) {
        var tip = m.label + (m.tbd ? '（' + W.CAL.names.tbd + '）' : '') + ' · ' + W.fmtCal({ wd: m.wd }, 'date') + '（' + T.toWinterText(m.wd, Pp) + '）' + (m.note ? ' · ' + m.note : '');
        var b = w.btn('', { cls: 'tb-mark k-' + m.kind + (m.tbd ? ' tbd' : ''), aria: tip, title: tip, onClick: function () { setT(m.t, 'jump'); } });
        b.dataset.f = String((m.t - t0) / Pp.Y);
        marks.appendChild(b);
      });
      placeMarks();
    }
    // 按此刻的宽度摆小菱形：挨得太近的错开（审判三夜、庆典夜与入冬），各自仍能悬停、点选
    function placeMarks() {
      var bs = Array.prototype.slice.call(marks.children), wpx = marks.clientWidth || 0;
      if (!bs.length) return;
      var fs = bs.map(function (b) { return +b.dataset.f; });
      if (!(wpx > 0)) { bs.forEach(function (b, i) { b.style.left = (100 * fs[i]) + '%'; }); return; }
      var xs = T.spread(fs.map(function (f) { return f * wpx; }), 11);
      bs.forEach(function (b, i) { b.style.left = xs[i] + 'px'; });
    }
    HY.bus.on('layout', placeMarks);
    if (G.ResizeObserver) { try { new G.ResizeObserver(HY.util.throttle(placeMarks, 100)).observe(marks); } catch (e) { /* 老浏览器：按百分比摆 */ } }
    function show(force) {
      var n = HY.model.now; if (!n || !n.cal) return;
      var st = HY.state.time;
      play.textContent = st.playing ? '❚❚' : '▶';
      play.setAttribute('aria-pressed', String(st.playing));
      var key = n.t + '|' + HY.model.pv;
      if (!force && key === lastKey) return;
      lastKey = key;
      var c = n.cal, sep = W.CAL.names.sep;
      yLab.textContent = W.fmtCal({ N: c.N }, 'year');             // 只给年号；庆典与周期写在旁注里
      var yn = T.yearNote(c, P());
      yNote.textContent = yn.text;
      yNote.classList.toggle('fest', yn.festival);
      yPrev.disabled = c.N <= YEAR_MIN; yNext.disabled = c.N >= YEAR_MAX;
      // 钟点与时辰写在钟点滑杆旁（hOut），这里不重复，免得一行太长被截掉月态
      // “入冬后第 d 日”旁注“距下次入冬 N 日”：正文按“入冬前 N 日”记日子，不必自己去想这是哪一次入冬
      var tw = T.toWinterText(c.wd, P());
      label.textContent = [W.fmtCal(c, 'date') + (tw ? '（' + tw + '）' : ''), W.fmtCal(c, 'season'), W.fmtCal(c, 'moon')].filter(Boolean).join(sep);
      label.title = W.fmtCal(c, 'full') + sep + n.hhmm + ' ' + n.shichen + (tw ? '\n' + tw + '；“' + W.fmtCal({ N: c.N }, 'year') + '”从哪天换号，见“一年”页历法卡的最后一节' : '');
      if (!drag.d) dIn.value = n.date.doy;
      if (!drag.h) hIn.value = n.hour;
      hOut.textContent = n.hhmm + ' · ' + n.shichen;
      // 读屏：滑杆念出日期与钟点，不念“233”“21.4”
      dIn.setAttribute('aria-valuetext', W.fmtCal({ N: c.N }, 'year') + ' ' + W.fmtCal(c, 'date') + (tw ? '，' + tw : ''));
      hIn.setAttribute('aria-valuetext', n.hhmm + ' ' + n.shichen);
      showBand(false);
    }
    var last = 0;
    HY.bus.on('time', function (e) {
      // 流速变了（含“恢复默认”与读档：那时 path 是 'time'）就重排下拉
      if (ui.touches(e, 'time.speed')) showSpeeds();
      if (e && e.src !== 'play') { HY.model.tick(); show(true); }
    });
    HY.bus.on('frame', function () { var t = Date.now(); if (t - last > 100) { last = t; show(false); } });
    HY.bus.on('model', function () { HY.model.tick(); show(true); showBand(true); showSpeeds(); });
    HY.bus.on('view', showSpeeds);
    HY.bus.on('fp', function (e) { if (ui.touches(e, 'fp.set.yuxiLead')) showBand(true); });
    showSpeeds(); show(true);
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
