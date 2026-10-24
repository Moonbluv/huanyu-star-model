/* HY.ui.w —— 滑杆、开关、分段按钮、下拉、数值框、按钮、弹出层（规格：spec/03 第九节）
 * 负责：D 路（界面）。
 * 每个控件函数返回 {el, set(v), get(), disable(on)}；用户改动时调 opts.onInput(v)。
 * 滑杆旁一律带数值框（03 第九节第 2 条“所有滑杆旁有数值框可直接输入”）；触控目标不小于 40×40 px（样式里管）。
 * 加载时不碰 DOM；只有调用时才用 document。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  function doc() { return G.document; }
  var uid = 0;
  function nextId(p) { uid++; return (p || 'w') + '-' + uid; }

  function h(tag, cls, text) {
    var e = doc().createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // 按钮：o = {cls, title, aria, pressed, onClick}
  function btn(label, o) {
    o = o || {};
    var b = h('button', o.cls || 'btn', label);
    b.type = 'button';
    if (o.title) b.title = o.title;
    b.setAttribute('aria-label', o.aria || o.title || label);
    if (o.pressed != null) b.setAttribute('aria-pressed', String(!!o.pressed));
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function settingTag(lab, o) {
    if (o.setting) lab.appendChild(h('small', 'w-setting', '设定'));
    if (o.advanced) lab.appendChild(h('small', 'w-adv', '高级'));
  }
  function noteEl(o) { return o.note ? h('p', 'w-note', o.note) : null; }
  // 按步长定小数位
  function decimals(step) {
    if (!(step > 0) || step >= 1) return 0;
    var s = String(step), i = s.indexOf('.');
    if (/e-/.test(s)) return Math.min(6, +s.split('e-')[1]);
    return i < 0 ? 0 : Math.min(6, s.length - i - 1);
  }
  function roundStep(v, step) {
    var d = decimals(step);
    return +(+v).toFixed(d);
  }
  // 数值框里显示的文字：按步长取小数位；值本身不在步长格上时（如“地球式大气”写入的标高 8.5，步长 1）
  // 多给几位，免得框里显示的数和实际状态对不上；最多比步长多两位、总共不超过 4 位
  // （由公式推出的默认值，如回归纬线 πR/3＝6671.695…，步长 10，显示 6671.7，不显示一长串小数）
  function fmtVal(v, step) {
    v = +v;
    if (!isFinite(v)) return '';
    var d = decimals(step), r = +v.toFixed(d), dMax = Math.min(4, d + 2);
    while (Math.abs(r - v) > 1e-9 && d < dMax) { d++; r = +v.toFixed(d); }
    return String(r);
  }

  /* 滑杆＋数值框：o = {label, min, max, step, value, unit, hint(v)→文本, onInput(v), setting, advanced, note, num, round}
   * 数值框里的值按步长取整显示；输入后回车或失焦生效，越界夹回。 */
  function range(o) {
    var row = h('div', 'w-row w-range'), id = nextId('r');
    var lab = h('label', 'w-label', o.label); lab.htmlFor = id;
    settingTag(lab, o);
    var inp = h('input'); inp.type = 'range'; inp.id = id;
    inp.min = o.min; inp.max = o.max; inp.step = o.step || 'any';
    inp.setAttribute('aria-label', o.label);
    var box = h('input', 'w-num num'); box.type = 'number';
    box.min = o.min; box.max = o.max; box.step = o.step || 'any';
    box.setAttribute('aria-label', o.label + '（数值）');
    var unit = h('span', 'w-unit', o.unit || '');
    var hint = h('span', 'w-hint');
    var ctl = h('div', 'w-ctl');
    ctl.appendChild(inp);
    var nb = h('div', 'w-nb'); nb.appendChild(box); if (o.unit) nb.appendChild(unit);
    ctl.appendChild(nb);
    row.appendChild(lab); row.appendChild(ctl);
    var wrap = h('div', 'w-item');
    wrap.appendChild(row);
    if (o.hint) wrap.appendChild(hint);
    var ne = noteEl(o); if (ne) wrap.appendChild(ne);
    var min = +o.min, max = +o.max, cur = o.value != null ? +o.value : min, dragging = false;
    // o.round：数值框只按步长显示（地点卡“离塔根”按整公里：步行写回的 6670.0086 显示成 6670，不显示 6670.01）
    function show(v) {
      box.value = o.round ? String(roundStep(v, o.step)) : fmtVal(v, o.step);
      if (o.hint) hint.textContent = o.hint(v) || '';
    }
    // 拖动中不让回写（节流后的旧值）把滑块拉回去
    inp.addEventListener('pointerdown', function () { dragging = true; });
    inp.addEventListener('pointerup', function () { dragging = false; });
    inp.addEventListener('pointercancel', function () { dragging = false; });
    inp.addEventListener('input', function () { cur = +inp.value; show(cur); if (o.onInput) o.onInput(cur); });
    inp.addEventListener('change', function () { dragging = false; if (o.onChange) o.onChange(+inp.value); });
    function fromBox() {
      var raw = String(box.value).trim().replace('−', '-');
      if (raw === '' || !isFinite(+raw)) { show(cur); return; }
      var v = Math.max(min, Math.min(max, +raw));
      cur = v; inp.value = v; show(v);
      if (o.onInput) o.onInput(v);
      if (o.onChange) o.onChange(v);
    }
    box.addEventListener('change', fromBox);
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter') { fromBox(); } });
    var api = {
      el: wrap, input: inp, box: box,
      set: function (v) {
        if (v == null || !isFinite(v) || dragging) return;
        cur = +v;
        if (cur < min || cur > max) api.setRange(Math.min(min, cur), Math.max(max, cur));
        inp.value = cur;
        if (doc().activeElement !== box) show(cur);
      },
      get: function () { return cur; },
      setRange: function (a, b) { min = +a; max = +b; inp.min = a; inp.max = b; box.min = a; box.max = b; },
      disable: function (on, why) { inp.disabled = box.disabled = !!on; wrap.classList.toggle('is-off', !!on); wrap.title = on && why ? why : ''; },
      setNote: function (t) { if (ne) ne.textContent = t; }
    };
    api.set(cur);
    return api;
  }

  // 开关（复选框，role=switch）
  function toggle(o) {
    var row = h('label', 'w-row w-toggle'), lab = h('span', 'w-label', o.label), inp = h('input');
    inp.type = 'checkbox'; inp.setAttribute('role', 'switch'); inp.setAttribute('aria-label', o.label);
    settingTag(lab, o);
    var knob = h('span', 'w-switch');
    inp.addEventListener('change', function () { if (o.onInput) o.onInput(inp.checked); });
    row.appendChild(lab); row.appendChild(inp); row.appendChild(knob);
    var wrap = h('div', 'w-item'); wrap.appendChild(row);
    var ne = noteEl(o); if (ne) wrap.appendChild(ne);
    var api = {
      el: wrap, input: inp,
      set: function (v) { inp.checked = !!v; inp.setAttribute('aria-checked', String(!!v)); },
      get: function () { return inp.checked; },
      disable: function (on, why) { inp.disabled = !!on; wrap.classList.toggle('is-off', !!on); wrap.title = on && why ? why : ''; }
    };
    if (o.value != null) api.set(o.value);
    return api;
  }

  // 分段按钮：o.opts = [{v, label, title}]
  function seg(o) {
    var row = h('div', 'w-row w-seg'), lab = h('span', 'w-label', o.label), box = h('div', 'seg');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', o.label);
    settingTag(lab, o);
    var cur = null;
    var btns = o.opts.map(function (p) {
      var b = btn(p.label, { cls: '', title: p.title, pressed: false });
      b.dataset.v = String(p.v);
      b.addEventListener('click', function () { if (b.disabled) return; api.set(p.v); if (o.onInput) o.onInput(p.v); });
      box.appendChild(b); return b;
    });
    if (o.label) row.appendChild(lab);
    row.appendChild(box);
    var wrap = h('div', 'w-item'); wrap.appendChild(row);
    var ne = noteEl(o); if (ne) wrap.appendChild(ne);
    var api = {
      el: wrap, buttons: btns,
      set: function (v) { cur = v; btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); }); },
      get: function () { return cur; },
      disable: function (on) { btns.forEach(function (b) { b.disabled = !!on; }); wrap.classList.toggle('is-off', !!on); }
    };
    if (o.value != null) api.set(o.value);
    return api;
  }

  // 下拉：o.opts = [{v, label}]
  function select(o) {
    var row = h('div', 'w-row w-select'), id = nextId('s');
    var lab = h('label', 'w-label', o.label); lab.htmlFor = id;
    var sel = h('select'); sel.id = id;
    sel.setAttribute('aria-label', o.label);
    settingTag(lab, o);
    function fill(opts) {
      sel.textContent = '';
      opts.forEach(function (p) { var op = h('option', '', p.label); op.value = String(p.v); sel.appendChild(op); });
    }
    fill(o.opts);
    sel.addEventListener('change', function () { if (o.onInput) o.onInput(sel.value); });
    if (o.label) row.appendChild(lab);
    row.appendChild(sel);
    var wrap = h('div', 'w-item'); wrap.appendChild(row);
    var ne = noteEl(o); if (ne) wrap.appendChild(ne);
    var api = {
      el: wrap, input: sel,
      set: function (v) { sel.value = String(v); },
      get: function () { return sel.value; },
      setOpts: function (opts, v) { fill(opts); if (v != null) sel.value = String(v); },
      disable: function (on) { sel.disabled = !!on; wrap.classList.toggle('is-off', !!on); }
    };
    if (o.value != null) api.set(o.value);
    return api;
  }

  // 数值框（单独用）。越界按此刻的 min／max 属性夹回（调用方可以事后改 el.max，如“入冬后第几日”的上限跟着年长 Y 走）
  function numBox(o) {
    var inp = h('input', 'w-num num'); inp.type = 'number';
    if (o.min != null) inp.min = o.min;
    if (o.max != null) inp.max = o.max;
    inp.step = o.step || 'any';
    inp.setAttribute('aria-label', o.label);
    if (o.width) inp.style.width = o.width;
    function lim(name) { var s = inp[name]; return s === '' || s == null || !isFinite(+s) ? null : +s; }
    inp.addEventListener('change', function () {
      var v = +String(inp.value).replace('−', '-'), lo = lim('min'), hi = lim('max');
      if (String(inp.value).trim() === '' || !isFinite(v)) return;
      if (lo != null && v < lo) v = lo;
      if (hi != null && v > hi) v = hi;
      inp.value = v;
      if (o.onInput) o.onInput(v);
    });
    var api = { el: inp, set: function (v) { inp.value = v; }, get: function () { return +inp.value; }, disable: function (on) { inp.disabled = !!on; },
      setRange: function (a, b) { if (a != null) inp.min = a; if (b != null) inp.max = b; } };
    if (o.value != null) api.set(o.value);
    return api;
  }

  /* 弹出层：按钮开合一个面板；点面板外或按 Esc 关。返回 {wrap, button, panel, open(on), isOpen()} */
  var openPops = [];
  var popWired = false;
  function wirePops() {
    if (popWired) return; popWired = true;
    doc().addEventListener('mousedown', function (e) {
      openPops.slice().forEach(function (p) { if (!p.wrap.contains(e.target)) p.open(false); });
    });
    doc().addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openPops.length) { openPops.slice().forEach(function (p) { p.open(false); }); }
    });
  }
  function pop(label, o) {
    o = o || {};
    wirePops();
    var wrap = h('div', 'pop ' + (o.cls || ''));
    var b = btn(label, { cls: 'btn pop-btn', title: o.title, aria: o.aria });
    b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-haspopup', 'true');
    var panel = h('div', 'pop-panel'); panel.hidden = true;
    if (o.align) panel.classList.add('pop-' + o.align);
    wrap.appendChild(b); wrap.appendChild(panel);
    // 打开后量一下：横向超出视口就换一边对齐，向上放不下就改向下（反之亦然）
    function place() {
      var st = panel.style, W = G.innerWidth || 1024, Hh = G.innerHeight || 768, m = 8;
      st.left = st.right = st.top = st.bottom = '';
      var r = panel.getBoundingClientRect();
      if (r.right > W - m) { st.left = 'auto'; st.right = '0'; r = panel.getBoundingClientRect(); }
      if (r.left < m) { st.right = 'auto'; st.left = Math.min(0, m - wrap.getBoundingClientRect().left) + 'px'; }
      r = panel.getBoundingClientRect();
      if (r.top < m) { st.top = 'calc(100% + 6px)'; st.bottom = 'auto'; }
      else if (r.bottom > Hh - m && o.align !== 'up') { st.top = 'auto'; st.bottom = 'calc(100% + 6px)'; }
    }
    var api = {
      wrap: wrap, button: b, panel: panel,
      open: function (on) {
        on = !!on;
        panel.hidden = !on; b.setAttribute('aria-expanded', String(on));
        var i = openPops.indexOf(api);
        if (on && i < 0) { openPops.push(api); if (o.onOpen) o.onOpen(); }
        if (!on && i >= 0) openPops.splice(i, 1);
        if (on && G.getComputedStyle && G.getComputedStyle(panel).position !== 'fixed') place();
      },
      isOpen: function () { return !panel.hidden; }
    };
    b.addEventListener('click', function () { api.open(panel.hidden); });
    return api;
  }

  /* 可折叠组（details）：key＝ui.open 的子键；默认开合 def。开合写回 HY.store（src:'ui'） */
  function fold(title, key, def, o) {
    o = o || {};
    var d = h('details', 'fold ' + (o.cls || ''));
    var sm = h('summary', 'fold-head');
    var tt = h('span', 'fold-title', title);
    sm.appendChild(tt);
    d.appendChild(sm);
    var body = h('div', 'fold-body');
    d.appendChild(body);
    function cur() {
      var v = HY.state && HY.state.ui && HY.state.ui.open ? HY.state.ui.open[key] : undefined;
      return v == null ? !!def : !!v;
    }
    d.open = cur();
    d.addEventListener('toggle', function () {
      if (!key || !HY.store) return;
      if (d.open !== cur()) HY.store.set('ui.open.' + key, d.open, 'ui');
      if (o.onToggle) o.onToggle(d.open);
    });
    return { el: d, head: sm, title: tt, body: body, isOpen: function () { return d.open; }, sync: function () { var v = cur(); if (d.open !== v) d.open = v; } };
  }

  // 键值表的一行（dt/dd），返回 dd，便于原地更新
  function kv(dl, k, cls) {
    var dt = h('dt', '', k), dd = h('dd', cls || 'num');
    dl.appendChild(dt); dl.appendChild(dd);
    return dd;
  }

  ui.w = { h: h, btn: btn, range: range, toggle: toggle, seg: seg, select: select, numBox: numBox, pop: pop, fold: fold, kv: kv,
    decimals: decimals, roundStep: roundStep, fmtVal: fmtVal };
})(typeof globalThis !== 'undefined' ? globalThis : window);
