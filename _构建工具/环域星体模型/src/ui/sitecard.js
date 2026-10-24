/* HY.ui.sitecard —— 地点卡：预设下拉、离塔根距离与方位滑杆＋数值框、“站在此地”、地点说明（规格：spec/03 第九节第 4 条）
 * 负责：D 路（界面）。写入的状态：site（patch，src:'ui'）、view.mode（“站在此地”）。
 * 另给第一人称 HUD 用的 nearest(s, az, P)：离哪个预设地点最近、多远（沿内表面）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var SC = ui.sitecard = ui.sitecard || {};
  SC.__stub = false;

  // 沿内表面的距离（km）：两点的球心角 × R
  SC.arc = function (s1, az1, s2, az2, P) {
    var a = HY.astro.site(s1, az1, P), b = HY.astro.site(s2, az2, P);
    var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, ch = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return 2 * P.R * Math.asin(Math.min(1, ch / (2 * P.R)));
  };
  // 离 (s, az) 最近的预设地点 → {site, km}
  SC.nearest = function (s, az, P) {
    var best = null;
    HY.world.siteList(P).forEach(function (q) {
      var d = SC.arc(s, az, q.s, q.az, P);
      if (!best || d < best.km) best = { site: q, km: d };
    });
    return best;
  };
  /* “还算不算在这个地方”：地点卡与第一人称 HUD 共用同一条规则（离预设地点不到 NAME_KM 公里仍写地名）。
   *   在城里走几步、或刚瞬移过去相机落在几百米外的踏面上，地名都不变；走出 1 公里才写“离某地 N 公里”。
   *   id：状态里记着的预设地点（可为 null，步行写回时会清掉）。→ {site, km, at}（at＝仍算此地）| null */
  SC.NAME_KM = 1;
  SC.resolve = function (s, az, id, P) {
    var q = id ? HY.world.siteById(id, P) : null;
    if (q) { var d = SC.arc(s, az, q.s, q.az, P); if (d < SC.NAME_KM) return { site: q, km: d, at: true }; }
    var n = SC.nearest(s, az, P);
    if (!n) return null;
    return { site: n.site, km: n.km, at: n.km < SC.NAME_KM };
  };
  SC.distText = function (km) { return km < 10 ? HY.util.fixed(km, 1) : HY.util.thousands(km, 0); };
  // 地点的称呼：预设地点（或离它不到 1 公里）用名字；其余写“离某地 N 公里”
  SC.placeName = function (st, P) {
    var r = SC.resolve(st.s, st.az, st.id, P);
    if (!r) return '自定义地点';
    return r.at ? r.site.name : '离' + r.site.name + ' ' + SC.distText(r.km) + ' 公里';
  };

  SC.init = function () {
    var el = G.document.getElementById('siteCard'), w = ui.w, U = HY.util;
    el.textContent = '';
    var head = w.h('div', 'card-head');
    head.appendChild(w.h('h3', '', '地点'));
    var stand = w.btn('站在此地', { cls: 'btn btn-primary', aria: '站在此地，进入第一人称（2）', title: '第一人称（2）', onClick: function () {
      if (ui.layout && ui.layout.toFp) ui.layout.toFp('ui'); else HY.store.set('view.mode', 'fp', 'ui');
    } });
    head.appendChild(stand);
    el.appendChild(head);

    function opts() {
      var o = HY.world.siteList(HY.model.P).map(function (q) { return { v: q.id, label: q.name }; });
      o.push({ v: '', label: '自定义地点' });
      return o;
    }
    var sel = w.select({ label: '预设', opts: opts(), value: HY.state.site.id || '',
      onInput: function (id) {
        var q = HY.world.siteById(id, HY.model.P);
        if (q) HY.store.patch('site', { id: q.id, s: q.s, az: q.az }, 'ui');
      } });
    var write = U.throttle(function (o) { HY.store.patch('site', o, 'ui'); }, 80);
    var sR = w.range({ label: '离塔根', min: 0, max: Math.round(Math.PI * HY.model.P.R), step: 1, unit: '公里', value: HY.state.site.s, round: true,
      onInput: function (v) { write({ id: null, s: v, az: HY.state.site.az }); },
      onChange: function (v) { HY.store.patch('site', { id: null, s: v, az: HY.state.site.az }, 'ui'); },
      hint: function (v) { var z = HY.world.zoneOf(v, HY.model.P, HY.model.Z); return z.name + ' · ' + U.fixed(z.g, 2) + ' g · 纬度 ' + U.fixed(z.lat, 1) + '°'; },
      note: '沿地面量；0 是塔根（北极），πR 是塔顶（南极）。' });
    var aR = w.range({ label: '方位', min: -180, max: 180, step: 0.5, unit: '°', value: HY.state.site.az, round: true,
      onInput: function (v) { write({ id: null, s: HY.state.site.s, az: v }); },
      onChange: function (v) { HY.store.patch('site', { id: null, s: HY.state.site.s, az: v }, 'ui'); },
      note: '绕塔一周 360°；只影响当地钟点与对面的风景。' });
    el.appendChild(sel.el); el.appendChild(sR.el); el.appendChild(aR.el);

    var sum = w.h('div', 'site-sum');
    var chip = w.h('i', 'lg-sw'); chip.setAttribute('aria-hidden', 'true');
    var sumTxt = w.h('span', 'num');
    sum.appendChild(chip); sum.appendChild(sumTxt);
    el.appendChild(sum);
    var note = w.h('p', 'note');
    el.appendChild(note);

    function show() {
      var st = HY.state.site, P = HY.model.P, O = HY.model.O;
      // 步行停下后第一人称把 site.id 清成 null：离某个预设地点不到 1 公里仍算那里（与 HUD 同一条规则）
      var r = SC.resolve(st.s, st.az, st.id, P), id = r && r.at ? r.site.id : '';
      sel.setOpts(opts(), id);
      sR.setRange(0, Math.round(Math.PI * P.R));
      sR.set(st.s); aR.set(st.az);
      var z = O.zone;
      chip.className = 'lg-sw z-' + z.id;
      sumTxt.textContent = z.name + ' · ' + U.fixed(O.g, 2) + ' g · 纬度 ' + U.fixed(O.lat, 1) + '° · 离塔轴 ' + HY.calc.km(O.r);
      var q = id ? r.site : null;
      note.textContent = q ? q.note + (st.id ? '' : '（走开了约 ' + Math.max(1, Math.round(r.km * 1000)) + ' 米，仍算此地）') : SC.placeName(st, P);
      if (ui.layout && ui.layout.markFpButton) ui.layout.markFpButton(stand, null, '第一人称（2）');
    }
    HY.bus.on('site', show); HY.bus.on('model', show); HY.bus.on('view', show);
    HY.bus.on('ready', show);
    show();
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
