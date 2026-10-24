/* HY.charts 'month' —— 本月月相（规格：spec/03 第八节第 2 条“本月月相”一行）
 * 负责：C 路（图表）。
 * 本朔望月（黑月正中到下一个黑月正中）的每一夜，此地子夜的月相：亮月按亮面画明暗，灰月加顺塔边的直影边，
 *   黑月深灰盘＋细环（与天空图同一画法，明暗界朝向也取此地仰望时的方向）。
 *   每枚下方两条细柱：亮月可见时长、黑月高悬时长（满高＝此地一夜）；再下是“入冬后第几日”。
 *   今夜加金圈；庆典夜加小星。点选：跳到那一夜的子夜。
 * 数据：HY.calc.month(O, t, P)（经 HY.model.cached）；以“今夜的子夜”取月，所以今夜一定在图上。换月、换地点、参数变时重算。
 * “今夜”与读数、时间栏的“月态第几夜”同一数法（HY.calc.nightMidnight 带 O＝HY.calc.moonNight）：
 *   日出（日心露出）到下一个日出算一夜，白天归入即将到来的那一夜；塔基里按正午分夜。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;
  var TAU = Math.PI * 2;

  HY.charts.register('month', function (canvas, opts, C) {
    // “今夜”的子夜（带 O：与 HY.calc.moonNight 同一数法，上午看的是即将到来的那一夜）
    function tonightT(E) { return HY.calc.nightMidnight(E.t, E.O.az, E.P, E.O); }
    function ref(E) {
      var tm = tonightT(E), tStart = tm - HY.astro.moonAge(tm, E.P) * E.P.M;
      return { tm: tm, tStart: tStart };
    }

    var impl = {
      key: function (E) { return HY.model.pv + '|' + HY.model.siteKey() + '|' + ref(E).tStart.toFixed(4); },
      compute: function (E) {
        var P = E.P, O = E.O, r = ref(E);
        var mo = HY.model.cached('month', [r.tStart.toFixed(5)], function () { return HY.calc.month(O, r.tm, P); });
        // 每夜子夜的月盘朝向（与天空图一致：仰望、东在左）
        var looks = mo.nights.map(function (q) { return C.moonLook(O, q.t, P, 7); });
        var inTower = !(O.r > P.a * 1.0005);              // 塔基里终日是夜：柱子满高＝一整日
        return { mo: mo, looks: looks, nightMin: inTower ? P.dayHours * 60 : (1 - HY.astro.dayFraction(O.r, P)) * P.dayHours * 60, inTower: inTower };
      },

      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, nights = d.mo.nights, n = nights.length, L = 4, R = 4, x0 = L, x1 = w - R, pw = Math.max(10, x1 - x0);
        var slot = pw / Math.max(1, n), r = C.clamp(slot * 0.38, 2.5, 6.5), ym = 4 + r + 3, b1 = Math.round(h * 0.6), b0 = ym + r + 6;
        var yLab = b1 + 11, yLeg = h - 3;
        var lay = { x0: x0, x1: x1, pw: pw, slot: slot, n: n, area: { x0: x0, x1: x1, y0: 0, y1: b1 + 2 } };
        var tonight = -1;
        // “今夜”：与读数的“月态第几夜”同一夜（见文件头）
        var tmNow = tonightT(E);
        for (var k = 0; k < n; k++) if (Math.abs(nights[k].t - tmNow) < 1e-6) tonight = k;
        lay.tonight = tonight;
        var bw = C.clamp(slot * 0.2, 1.5, 3), bh = Math.max(4, b1 - b0);

        // 月份背景：黑月期的夜稍暗
        for (var i = 0; i < n; i++) {
          var q = nights[i], xc = x0 + (i + 0.5) * slot;
          if (q.black) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(xc - slot / 2, 0, slot, b1 + 1); }
        }
        // 底线
        C.hline(ctx, x0, x1, b1 + 0.5, pal.line2, 1);
        for (var j = 0; j < n; j++) {
          var p = nights[j], x = x0 + (j + 0.5) * slot, ml = d.looks[j];
          if (j === tonight) {
            ctx.beginPath(); ctx.arc(x, ym, r + 2.6, 0, TAU); ctx.strokeStyle = pal.sun; ctx.lineWidth = 1.4; ctx.stroke();
          }
          C.drawMoon(ctx, x, ym, r, ml, { alpha: ml.el < 0 ? 0.55 : 1 });
          if (p.festival) C.star(ctx, x + r + 1, ym - r, 3.2, pal.sun);
          // 两条细柱：亮月可见、黑月高悬
          var hl = Math.min(1, p.litMin / d.nightMin) * bh, hb = Math.min(1, p.blackHighMin / d.nightMin) * bh;
          ctx.fillStyle = C.rgba(pal.fg, 0.06); ctx.fillRect(x - bw - 0.5, b1 - bh, 2 * bw + 1, bh);
          if (hl > 0) { ctx.fillStyle = pal.moon; ctx.fillRect(x - bw - 0.5, b1 - hl, bw, hl); }
          if (hb > 0) { ctx.fillStyle = pal.hang; ctx.fillRect(x + 0.5, b1 - hb, bw, hb); }
        }
        // 日期：入冬后第几日（放不下就隔几夜标一个；今夜一定标）
        ctx.font = C.font(9, true);
        var wMax = ctx.measureText('360').width + 4, every = Math.max(1, Math.ceil(wMax / slot));
        var labs = [];
        for (var a = 0; a < n; a++) {
          var xa = x0 + (a + 0.5) * slot, s = String(nights[a].date.wd), first = a === 0 || nights[a].date.wd === 1;
          if (a === tonight || first || a % every === 0) labs.push({ i: a, x: xa, s: s, pri: a === tonight ? 0 : first ? 1 : 2 });
        }
        labs.sort(function (u, v) { return u.pri - v.pri; });
        var taken = [];
        labs.forEach(function (lb) {
          var tw = ctx.measureText(lb.s).width, l0 = C.clamp(lb.x - tw / 2, 0, w - tw), l1 = l0 + tw;
          for (var i = 0; i < taken.length; i++) if (l0 < taken[i][1] + 3 && l1 > taken[i][0] - 3) return;
          taken.push([l0, l1]);
          C.label(ctx, lb.s, l0, yLab, lb.i === tonight ? pal.sun : pal.dim, { halo: false });
        });
        // 图例
        ctx.font = C.font(9, false);
        var lx = x0;
        [['亮月可见', pal.moon], ['黑月高悬', pal.hang]].forEach(function (it) {
          ctx.fillStyle = it[1]; ctx.fillRect(lx, yLeg - 7, 3, 7);
          C.label(ctx, it[0], lx + 6, yLeg, pal.muted, { halo: false });
          lx += 6 + ctx.measureText(it[0]).width + 10;
        });
        // 叫法取 HY.world.fmtCal（“入冬后第 {d} 日”→“入冬后第几日”），作者改了 CAL 这里跟着变
        var note = '数字＝' + C.calText({ wd: '几' }, 'date').replace(/\s*几\s*/, '几') + '之夜';
        if (lx + ctx.measureText(note).width < x1) C.label(ctx, note, x1, yLeg, pal.dim, { align: 'right', halo: false });
        if (hover) {
          var hi = Math.floor((hover.x - x0) / slot);
          if (hi >= 0 && hi < n) { ctx.strokeStyle = C.rgba(pal.fg, 0.35); ctx.lineWidth = 1; ctx.strokeRect(x0 + hi * slot + 0.5, 0.5, slot - 1, b1); }
        }
        return lay;
      },

      tip: function (d, hv, lay, E) {
        if (!lay) return null;
        var i = Math.floor((hv.x - lay.x0) / lay.slot);
        if (i < 0 || i >= lay.n || hv.y > lay.area.y1 + 14) return null;
        var q = d.mo.nights[i], ml = d.looks[i], P = E.P, mn = HY.calc.moonNight(E.O, q.t, P);
        // 第一行：入冬后第 d 日之夜（今夜）· 冬／夏第 n 日——“之夜”紧跟日子，季放后面
        var sd = HY.calc.seasonOf(q.t - 0.25, E.O, P), sep = HY.world.CAL.names.sep;
        var head = C.calText({ wd: sd.wd }, 'date') + '之夜' + (i === lay.tonight ? '（今夜）' : '');
        var sea = C.calText({ season: sd.season, seasonDay: sd.n }, 'season');
        var out = [head + (sea ? sep + sea : '')];
        var st = C.calText({ moonState: q.state, moonNight: mn.night }, 'moon') + (q.state === '亮月' ? '，亮面 ' + Math.round(q.k * 100) + '%' : '');
        out.push('子夜：' + st + ' · 仰角 ' + C.num(ml.el, 0) + '°' + (ml.el < 0 ? '（在重力水平以下）' : ml.vis < 0.5 ? '（被塔挡住）' : ''));
        out.push('见亮月 ' + C.minutesText(q.litMin) + ' · 黑月高悬 ' + C.minutesText(q.blackHighMin));
        if (q.festival) out.push('庆典夜');
        out.push('点击：跳到这一夜的子夜');
        return out;
      },
      pick: function (d, pt, lay) {
        if (!lay) return null;
        var i = Math.floor((pt.x - lay.x0) / lay.slot);
        if (i < 0 || i >= lay.n || pt.y > lay.area.y1 + 14) return null;
        return { t: d.mo.nights[i].t };
      },
      aria: function (d) {
        var ns = d.mo.nights, lit = 0, hang = 0;
        ns.forEach(function (q) { if (q.litSeen) lit++; if (q.blackHighSeen) hang++; });
        return '本月月相：本朔望月共 ' + ns.length + ' 夜，此地见到亮月 ' + lit + ' 夜，黑月高悬 ' + hang + ' 夜';
      }
    };
    return C.make('month', canvas, impl, opts);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
