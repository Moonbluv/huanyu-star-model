/* HY.charts 'day' —— 一日（规格：spec/03 第八节第 2 条“一日”一行）
 * 负责：C 路（图表）。
 * 横轴当地 0–24 时；上条：一日五段色带（时刻标在段界）；曲线：太阳重力仰角（可见时）；
 * 下条：月（亮／灰／黑、被塔挡、黑月高悬）；游标＝此刻。点选设当地钟点（日期不变）。
 * 数据：HY.calc.dayStats(O, tMid, P)（经 HY.model.cached；与天空图共用同一份）。当地日期变了才重算。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;

  HY.charts.register('day', function (canvas, opts, C) {
    var impl = {
      stubs: ['dayStats'],
      key: function (E) { return HY.model.pv + '|' + HY.model.siteKey() + '|' + C.dayStart(E.O, E.t, E.P).toFixed(5); },
      compute: function (E) {
        var P = E.P, O = E.O, tMid = C.dayStart(O, E.t, P);
        var ds = HY.model.cached('dayStats', [tMid.toFixed(6)], function () { return HY.calc.dayStats(O, tMid, P); });
        // 太阳仰角的纵轴：取当日可见部分的范围，留一点边（一日里只变几度，用 0–90 会是一条平线）
        var lo = Infinity, hi = -Infinity, s = ds.sun;
        for (var i = 0; i < s.length; i++) { var v = s[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        if (!(hi >= lo)) { lo = 0; hi = 90; }
        var step = hi - lo > 20 ? 10 : 5;
        lo = Math.max(-10, Math.floor((lo - 1) / step) * step); hi = Math.min(90, Math.ceil((hi + 1) / step) * step);
        if (hi - lo < 10) { var mid = (hi + lo) / 2; lo = Math.max(-10, mid - 5); hi = lo + 10; }
        return { tMid: tMid, ds: ds, lo: lo, hi: hi, dayLen: 1, hours: P.dayHours };
      },
      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, ds = d.ds, H = d.hours;
        var L = 22, R = 28, yLab = 9, b0 = 12, b1 = 20, p0 = 25, p1 = h - 30, m0 = h - 26, m1 = h - 18, yAx = h - 4;
        var pw = w - L - R, X = function (hour) { return L + hour / H * pw; }, Y = function (el) { return p1 - (el - d.lo) / (d.hi - d.lo) * (p1 - p0); };
        var lay = { L: L, R: R, pw: pw, area: { x0: L, x1: L + pw, y0: b0, y1: m1 }, b: [b0, b1], p: [p0, p1], m: [m0, m1] };
        // 上条：一日五段
        var segs = ds.segs || [];
        segs.forEach(function (sg) {
          var x0 = X((sg.t0 - d.tMid) * H), x1 = X((sg.t1 - d.tMid) * H);
          x0 = C.clamp(x0, L, L + pw); x1 = C.clamp(x1, L, L + pw);
          if (x1 <= x0) return;
          ctx.fillStyle = sg.kind === 'behind' ? C.rgba(pal['sky-night'], 1) : pal[C.SEG_COLOR[sg.kind]] || pal.sun;
          ctx.fillRect(x0, b0, x1 - x0, b1 - b0);
        });
        ctx.strokeStyle = pal.line2; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, b0 + 0.5, pw - 1, b1 - b0 - 1);
        // 段界时刻：先标破晓、黄昏，再标衬塔起止，放不下的跳过
        var marks = [];
        segs.forEach(function (sg, i) {
          if (i === 0) return;
          var hr = (sg.t0 - d.tMid) * H; if (hr <= 0.05 || hr >= H - 0.05) return;
          var pri = (sg.kind === 'cut' && sg.side === '东') ? 0 : (segs[i - 1].kind === 'cut' && segs[i - 1].side === '西') ? 0 : sg.kind === 'front' || segs[i - 1].kind === 'front' ? 1 : 2;
          marks.push({ hr: hr, pri: pri });
        });
        marks.sort(function (a, b) { return a.pri - b.pri; });
        ctx.font = C.font(9, true);
        var taken = [];
        marks.forEach(function (m) {
          var s = HY.calc.hhmm(m.hr), wv = ctx.measureText(s).width, x = C.clamp(X(m.hr), L + wv / 2, L + pw - wv / 2);
          for (var i = 0; i < taken.length; i++) if (Math.abs(taken[i] - x) < wv + 3) return;
          taken.push(x);
          C.vline(ctx, Math.round(X(m.hr)) + 0.5, b0 - 2, b1, C.rgba(pal.fg, 0.5), 1);
          C.label(ctx, s, x, yLab, pal.muted, { align: 'center', halo: false });
        });
        // 曲线：太阳重力仰角（可见时）
        ctx.font = C.font(9, true);
        [d.lo, d.hi].forEach(function (v) {
          var y = Y(v);
          C.hline(ctx, L, L + pw, Math.round(y) + 0.5, C.rgba(pal.fg, 0.08), 1);
          C.label(ctx, C.num(v, 0) + '°', L + pw + 4, y + 3, pal.sun, { align: 'left', halo: false });
        });
        var s = ds.sun, n = s.length;
        C.polyline(ctx, n, function (i) { var v = s[i]; return v === v ? [X(i / n * H), Y(v)] : null; }, pal.sun, 1.6);
        if (!(ds.dayH > 0)) {        // 塔基里：终日不见日（与一年图、天空图同一句）
          ctx.font = C.font(10, false);
          C.label(ctx, '此地在塔基里：终日不见日', L + pw / 2, (p0 + p1) / 2 + 4, pal.muted, { align: 'center' });
        }
        // 下条：月（每 15 分一格）
        var mo = ds.moon || [], cw = mo.length ? pw / mo.length : pw;
        mo.forEach(function (m, i) {
          var x = L + i * cw, col = m.sunlit >= 0.97 ? pal.moon : m.sunlit > 0.03 ? pal['moon-grey'] : C.mix(pal['moon-black'], pal.fg, 0.12);
          ctx.globalAlpha = m.vis < 0.5 ? 0.28 : 1;
          ctx.fillStyle = col; ctx.fillRect(x, m0, cw + 0.4, m1 - m0);
          ctx.globalAlpha = 1;
          if (m.blackHigh) { ctx.fillStyle = pal.hang; ctx.fillRect(x, m0 - 3, cw + 0.4, 2); }
        });
        ctx.strokeStyle = pal.line2; ctx.strokeRect(L + 0.5, m0 + 0.5, pw - 1, m1 - m0 - 1);
        ctx.font = C.font(9, false);
        C.label(ctx, '日', L - 4, b1 - 1, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '月', L - 4, m1 - 1, pal.muted, { align: 'right', halo: false });
        // 横轴
        ctx.font = C.font(9, true);
        for (var hr = 0; hr <= H; hr += 6) {
          var x = X(hr), al = hr === 0 ? 'left' : hr >= H ? 'right' : 'center';
          C.vline(ctx, Math.round(x) + 0.5, m1, m1 + 3, pal.line2, 1);
          C.label(ctx, hr + '时', x, yAx, pal.dim, { align: al, halo: false });
        }
        // 游标：此刻
        var hNow = (E.t - d.tMid) * H;
        if (hNow >= 0 && hNow <= H) {
          var xn = Math.round(X(hNow)) + 0.5;
          C.vline(ctx, xn, b0 - 2, m1 + 1, pal.fg, 1);
          var si = Math.floor(hNow / H * n);
          if (si >= 0 && si < n && s[si] === s[si]) C.dot(ctx, X(hNow), Y(s[si]), 2.6, pal.sun, pal.bg);
          lay.cursor = xn;
        }
        if (hover) C.crosshair(ctx, lay.area, hover.x, null);
        lay.X = X; lay.Y = Y;
        return lay;
      },
      tip: function (d, hv, lay, E) {
        if (!lay || hv.x < lay.L - 2 || hv.x > lay.L + lay.pw + 2) return null;
        var H = d.hours, hr = C.clamp((hv.x - lay.L) / lay.pw * H, 0, H - 1e-6), t = d.tMid + hr / H, ds = d.ds;
        var seg = null;
        (ds.segs || []).forEach(function (sg) { if (t >= sg.t0 && t < sg.t1) seg = sg; });
        var si = Math.floor(hr / H * ds.sun.length), el = ds.sun[si];
        var mi = ds.moon && ds.moon.length ? Math.min(ds.moon.length - 1, Math.floor(hr / H * ds.moon.length)) : -1, m = mi >= 0 ? ds.moon[mi] : null;
        var out = [HY.calc.hhmm(hr) + ' · ' + HY.calc.shichen(hr)];
        out.push('太阳：' + (seg ? C.SEG_NAME(seg.kind, seg.side) : '—') + (el === el ? ' · 仰角 ' + C.num(el, 1) + '°' : ''));
        if (m) {
          var st = m.sunlit >= 0.97 ? '亮月' : m.sunlit > 0.03 ? '灰月' : '黑月';
          out.push('月：' + st + (st === '亮月' ? ' ' + Math.round(m.k * 100) + '%' : '') + ' · 仰角 ' + C.num(m.el, 0) + '°' +
            (m.vis < 0.5 ? ' · 被塔挡' : '') + (m.blackHigh ? ' · 黑月高悬' : ''));
        }
        out.push('昼 ' + C.hours(ds.dayH) + ' · 夜 ' + C.hours(ds.nightH));
        return out;
      },
      pick: function (d, pt, lay) {
        if (!lay || pt.x < lay.L - 4 || pt.x > lay.L + lay.pw + 4) return null;
        var H = d.hours, hr = C.clamp((pt.x - lay.L) / lay.pw * H, 0, H - 1 / 60);
        hr = Math.round(hr * 60) / 60;
        return { hour: hr, t: d.tMid + hr / H };
      },
      aria: function (d) {
        var ds = d.ds;
        return '一日：昼 ' + C.hours(ds.dayH) + '，夜 ' + C.hours(ds.nightH) + '；破晓 ' + (ds.dawn ? HY.calc.hhmm(ds.dawn.hour) : '—') +
          '，黄昏 ' + (ds.dusk ? HY.calc.hhmm(ds.dusk.hour) : '—');
      }
    };
    return C.make('day', canvas, impl, opts);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
