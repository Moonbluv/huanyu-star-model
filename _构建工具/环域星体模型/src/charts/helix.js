/* HY.charts 'helix' —— 日月高度：把“日月对称螺旋”展开成平面（规格：spec/03 第八节第 2 条“日月高度”一行）
 * 负责：C 路（图表）。
 * 横轴同一年图（此地第 N 年的 doy，刻度写“入冬后第 X 日”）。
 *   上半：纵轴是沿塔轴的高度（上＝塔顶侧）。太阳、月亮两条正弦互为镜像；塔腰线；此地所在高度线（罪域那条恰是回归线，
 *         即两条螺旋的折返面）；入冬、入夏两刻日月同过塔腰。
 *   下半：月对日方位差 Δ（−180°…180°）；|Δ|＞β（黑月半角）就是黑月期，涂暗；入冬交节处标本年 Δ 与“庆典／非庆典”。
 * 点选：跳到那一日（保留钟点）。
 * 数据：全部按时刻取样 HY.astro.sunPos / moonPos / elongation（不另立公式）；交节取 HY.calc.crossingsInYear。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;

  function signedKm(v) {
    var a = Math.abs(v), s = HY.util && HY.util.thousands ? HY.util.thousands(a, 0) : String(Math.round(a));
    return (v > 0.5 ? '+' : v < -0.5 ? '−' : '') + s + ' 公里';
  }
  function sideName(v, tol) { return v > tol ? '塔顶侧' : v < -tol ? '塔根侧' : '塔腰'; }
  function signedDeg(v) { return (v > 0.05 ? '+' : '') + HY.charts.num(v, 0) + '°'; }

  HY.charts.register('helix', function (canvas, opts, C) {
    function yearN(E) { return E.now && E.now.date ? E.now.date.N : HY.calc.civil(E.t, E.O.az, E.P).N; }

    var impl = {
      key: function (E) { return HY.model.pv + '|' + HY.model.siteKey() + '|' + yearN(E) + '|' + HY.world.CAL.yearStart; },
      compute: function (E) {
        var A = HY.astro, P = E.P, O = E.O, N = yearN(E), span = HY.world.yearSpan(N, P, O.az), t0 = span[0], Y = P.Y;
        var n = Math.round(Y * 2) + 1, ys = new Float32Array(n), ym = new Float32Array(n), el = new Float32Array(n), big = 0;
        var bdeg = P.beta * A.R2D;
        for (var i = 0; i < n; i++) {
          var t = t0 + i * Y / (n - 1);
          ys[i] = A.sunPos(t, P).y; ym[i] = A.moonPos(t, P).y; el[i] = A.elongation(t, P);
          big = Math.max(big, Math.abs(ys[i]), Math.abs(ym[i]));
        }
        // 黑月期：|Δ|＞β 的时段；取样相邻两点判定不同时二分出边界（日）
        function isBlack(t) { return Math.abs(A.elongation(t, P)) > bdeg; }
        var black = [], run = null;
        for (var j = 0; j < n; j++) {
          var tj = t0 + j * Y / (n - 1), bj = Math.abs(el[j]) > bdeg;
          if (j > 0) {
            var tp = t0 + (j - 1) * Y / (n - 1), bp = Math.abs(el[j - 1]) > bdeg;
            if (bp !== bj) {
              var lo = tp, hi = tj;
              for (var k = 0; k < 30; k++) { var m = 0.5 * (lo + hi); if (isBlack(m) === bp) lo = m; else hi = m; }
              if (bj) run = { from: hi - t0 }; else if (run) { run.to = hi - t0; black.push(run); run = null; }
            }
          } else if (bj) run = { from: 0 };
        }
        if (run) { run.to = Y; black.push(run); }
        var cr = HY.calc.crossingsInYear(N, P, O.az).map(function (c) {
          return { key: c.key, name: c.name, t: c.t, doy: c.t - t0, elong: c.elong, black: c.sunlit < 0.5,
            festival: c.key === 'winter' ? (c.festival != null ? !!c.festival : A.isFestival(c.civil ? c.civil.N : N, P)) : null };
        });
        var cap = Math.max(big, Math.min(Math.abs(O.y), 2 * big)) * 1.08;
        return { N: N, t0: t0, Y: Y, n: n, ys: ys, ym: ym, el: el, black: black, cross: cr, big: big, range: cap || 1,
          siteY: O.y, betaDeg: bdeg, ax: C.yearAxis(N, P, O.az), site: O.short || O.name || '此地' };
      },

      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, A = HY.astro, L = 36, R = 10, x0 = L, x1 = w - R, pw = Math.max(10, x1 - x0);
        var u0 = 8, u1 = Math.round(h * 0.5) - 4, l0 = u1 + 12, yAx = h - 22, l1 = yAx - 4;
        if (l1 - l0 < 24) { l0 = l1 - 24; }
        var X = function (doy) { return x0 + doy / d.Y * pw; };
        var Yu = function (y) { return (u0 + u1) / 2 - y / d.range * (u1 - u0) / 2; };
        var Yl = function (e) { return (l0 + l1) / 2 - e / 180 * (l1 - l0) / 2; };
        var Xi = function (i) { return x0 + i / (d.n - 1) * pw; };
        var lay = { x0: x0, x1: x1, pw: pw, X: X, u: [u0, u1], l: [l0, l1], area: { x0: x0, x1: x1, y0: u0, y1: l1 } };
        var colSun = pal.sun, colMoon = pal.moon, faint = C.rgba(pal.fg, 0.1);

        /* ── 上半：高度 ── */
        ctx.fillStyle = C.rgba(pal.stage, 0.55); ctx.fillRect(x0, u0, pw, u1 - u0);
        ctx.font = C.font(9, false);
        C.hline(ctx, x0, x1, Math.round(Yu(0)) + 0.5, C.rgba(pal.fg, 0.35), 1, [4, 3]);
        C.hline(ctx, x0, x1, Math.round(Yu(d.big)) + 0.5, faint, 1);
        C.hline(ctx, x0, x1, Math.round(Yu(-d.big)) + 0.5, faint, 1);
        C.label(ctx, '塔顶侧', x0 - 4, Yu(d.big) + 3, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '塔腰', x0 - 4, Yu(0) + 3, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '塔根侧', x0 - 4, Yu(-d.big) + 3, pal.muted, { align: 'right', halo: false });
        // 交节竖线（入冬、入夏贯通上下两半）
        d.cross.forEach(function (c) {
          if (c.key === 'winter' || c.key === 'summer') C.vline(ctx, Math.round(X(c.doy)) + 0.5, u0, l1, C.rgba(pal.fg, 0.16), 1);
        });
        // 曲线上直接标“日”“月”的位置：取两线分得最开的那一刻（先定下来，此地高度线的文字要避开它）
        var iw = 0, gapMax = -1;
        for (var q = Math.round(d.n * 0.08); q < d.n * 0.92; q++) { var gp = Math.abs(d.ys[q] - d.ym[q]); if (gp > gapMax) { gapMax = gp; iw = q; } }
        var xw = Xi(iw);
        // 此地高度线
        var sy = d.siteY, inRange = Math.abs(sy) <= d.range * 0.98, onFold = Math.abs(Math.abs(sy) - d.big) < d.big * 0.01;
        var siteTxt = d.site + (onFold ? ' · 回归线' : ''), siteLab = null;   // 文字等曲线画完再写，免得被线压住
        if (inRange) {
          var ysl = Math.round(Yu(sy)) + 0.5;
          C.hline(ctx, x0, x1, ysl, C.rgba(pal.ok, 0.85), 1, [5, 3]);
          // 文字放在两条正弦离这条线最远的地方（右、左、中三处里挑），免得压在曲线上
          var stw = ctx.measureText(siteTxt).width, bestS = null;
          [['right', x1 - 2 - stw, x1 - 2], ['left', x0 + 2, x0 + 2 + stw], ['center', (x0 + x1 - stw) / 2, (x0 + x1 + stw) / 2]].forEach(function (cnd) {
            var dmin = 1e9, i0 = Math.max(0, Math.floor((cnd[1] - x0) / pw * (d.n - 1))), i1 = Math.min(d.n - 1, Math.ceil((cnd[2] - x0) / pw * (d.n - 1)));
            for (var ii = i0; ii <= i1; ii++) dmin = Math.min(dmin, Math.abs(Yu(d.ys[ii]) - (ysl - 6)), Math.abs(Yu(d.ym[ii]) - (ysl - 6)));
            if (cnd[1] < xw + 10 && cnd[2] > xw - 10) dmin = Math.min(dmin, 0);     // 压着“日”“月”两个字
            if (!bestS || dmin > bestS.d + 0.5) bestS = { d: dmin, a: cnd[0], x: cnd[0] === 'right' ? cnd[2] : cnd[0] === 'left' ? cnd[1] : (x0 + x1) / 2 };
          });
          siteLab = [siteTxt, bestS.x, ysl - 3, bestS.a];
        } else {
          var yEdge = sy > 0 ? u0 + 2 : u1 - 2;
          siteLab = [(sy > 0 ? '↑ ' : '↓ ') + d.site + ' ' + signedKm(sy) + '，在折返面之外', x1 - 2, sy > 0 ? yEdge + 8 : yEdge - 2, 'right'];
        }
        // 两条螺旋展开的正弦
        C.polyline(ctx, d.n, function (i) { return [Xi(i), Yu(d.ym[i])]; }, colMoon, 1.6);
        C.polyline(ctx, d.n, function (i) { return [Xi(i), Yu(d.ys[i])]; }, colSun, 1.8);
        // 入冬、入夏：日月同过塔腰
        d.cross.forEach(function (c) {
          if (c.key !== 'winter' && c.key !== 'summer') return;
          var x = X(c.doy), y = Yu(0);
          C.dot(ctx, x, y, 3, pal.fg, pal.bg);
          var right = x > x1 - 30, left = x < x0 + 30;
          C.label(ctx, c.name, x + (right ? -5 : 5), y - 5, pal.fg, { align: right ? 'right' : left ? 'left' : 'left' });
        });
        ctx.font = C.font(10, false);
        var sUp = d.ys[iw] >= d.ym[iw];
        C.label(ctx, '日', Xi(iw), Yu(d.ys[iw]) + (sUp ? 12 : -4), colSun, { align: 'center' });
        C.label(ctx, '月', Xi(iw), Yu(d.ym[iw]) + (sUp ? -4 : 12), colMoon, { align: 'center' });
        if (siteLab) { ctx.font = C.font(9, false); C.label(ctx, siteLab[0], siteLab[1], siteLab[2], pal.ok, { align: siteLab[3] }); }

        /* ── 下半：月对日方位差 Δ ── */
        // 底色：月亮被照亮的时段偏亮，黑月期（竖条）与 |Δ|＞β 的区带（横条）压暗
        ctx.fillStyle = C.rgba(pal.moon, 0.1); ctx.fillRect(x0, l0, pw, l1 - l0);
        var b = d.betaDeg;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x0, Yl(180), pw, Yl(b) - Yl(180));
        ctx.fillRect(x0, Yl(-b), pw, Yl(-180) - Yl(-b));
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        d.black.forEach(function (r) {
          var a = X(r.from), z = X(r.to);
          ctx.fillRect(a, l0, Math.max(0.5, z - a), l1 - l0);
        });
        C.hline(ctx, x0, x1, Math.round(Yl(0)) + 0.5, faint, 1);
        C.hline(ctx, x0, x1, Math.round(Yl(b)) + 0.5, C.rgba(pal.fg, 0.28), 1, [3, 3]);
        C.hline(ctx, x0, x1, Math.round(Yl(-b)) + 0.5, C.rgba(pal.fg, 0.28), 1, [3, 3]);
        ctx.font = C.font(9, true);
        C.label(ctx, '180°', x0 - 4, Yl(180) + 7, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '0°', x0 - 4, Yl(0) + 3, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '−180°', x0 - 4, Yl(-180), pal.muted, { align: 'right', halo: false });
        // 锯齿：Δ 每月走一圈；在 ±180° 处（黑月正中）折回
        ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
        for (var i = 1; i < d.n; i++) {
          var e0 = d.el[i - 1], e1 = d.el[i];
          if (Math.abs(e1 - e0) > 180) continue;
          ctx.beginPath(); ctx.moveTo(Xi(i - 1), Yl(e0)); ctx.lineTo(Xi(i), Yl(e1));
          ctx.strokeStyle = Math.abs(0.5 * (e0 + e1)) > b ? C.rgba(pal.moon, 0.38) : colMoon;
          ctx.stroke();
        }
        ctx.font = C.font(9, false);
        C.label(ctx, '月对日方位差 Δ · 暗处＝黑月期（|Δ|＞β＝' + C.num(b, 1) + '°）', x0, l0 - 3, pal.muted, { halo: false });
        // 入冬交节：本年 Δ 与庆典
        d.cross.forEach(function (c) {
          if (c.key !== 'winter') return;
          var x = X(c.doy), y = Yl(c.elong), col = c.festival ? pal.sun : pal.fg;
          C.dot(ctx, x, y, 3.2, col, pal.bg);
          var s = '入冬 Δ ' + signedDeg(c.elong) + ' · ' + (c.festival ? '庆典' : '非庆典');
          ctx.font = C.font(9, false);
          var tw = ctx.measureText(s).width, right = x + 6 + tw > x1;
          var ty = y < (l0 + l1) / 2 ? y + 12 : y - 5;
          C.label(ctx, s, right ? x - 6 : x + 6, ty, col, { align: right ? 'right' : 'left' });
        });

        /* ── 横轴与游标 ── */
        C.hline(ctx, x0, x1, yAx + 0.5, pal.line2, 1);
        C.drawYearAxis(ctx, d.ax, x0, x1, yAx, pal);
        var dNow = E.t - d.t0;
        if (dNow >= 0 && dNow < d.Y) {
          var xn = Math.round(X(dNow)) + 0.5, S = A.sunPos(E.t, E.P), Mo = A.moonPos(E.t, E.P);
          C.vline(ctx, xn, u0, l1, pal.fg, 1);
          C.dot(ctx, X(dNow), Yu(Mo.y), 2.6, colMoon, pal.bg);
          C.dot(ctx, X(dNow), Yu(S.y), 2.8, colSun, pal.bg);
          C.dot(ctx, X(dNow), Yl(A.elongation(E.t, E.P)), 2.4, colMoon, pal.bg);
          lay.cursor = xn;
        }
        if (hover) C.crosshair(ctx, lay.area, hover.x, null);
        return lay;
      },

      tip: function (d, hv, lay, E) {
        if (!lay || hv.x < lay.x0 - 2 || hv.x > lay.x1 + 2) return null;
        var A = HY.astro, P = E.P, f = C.clamp((hv.x - lay.x0) / lay.pw, 0, 1), t = d.t0 + f * d.Y, doy = Math.min(d.Y - 1, Math.floor(f * d.Y));
        var yS = A.sunPos(t, P).y, yM = A.moonPos(t, P).y, e = A.elongation(t, P), tol = d.big * 0.02;
        var out = [C.dayCal(d.t0 + doy + 0.5, E.O, P)];
        out.push('日高 ' + signedKm(yS) + '（' + sideName(yS, tol) + '）· 月高 ' + signedKm(yM) + '（' + sideName(yM, tol) + '）');
        out.push('月对日方位差 Δ ' + signedDeg(e) + (Math.abs(e) > d.betaDeg ? ' · 黑月期（月心在塔影里）' : ''));
        var near = 3 / lay.pw * d.Y;
        d.cross.forEach(function (c) {
          if (Math.abs(c.doy - f * d.Y) > Math.max(near, 0.6)) return;
          out.push(c.name + '交节：Δ ' + signedDeg(c.elong) + (c.key === 'winter' ? ' · ' + (c.festival ? '庆典' : '非庆典') : ''));
        });
        out.push('点击：跳到这一日（钟点不变）');
        return out;
      },
      pick: function (d, pt, lay, E) {
        if (!lay || pt.x < lay.x0 - 4 || pt.x > lay.x1 + 4 || pt.y > lay.l[1] + 6) return null;
        var doy = Math.floor(C.clamp((pt.x - lay.x0) / lay.pw * d.Y, 0, d.Y - 1e-6));
        return { doy: doy, t: d.t0 + doy + C.hourNow(E) / E.P.dayHours };
      },
      aria: function (d) {
        var w = null;
        d.cross.forEach(function (c) { if (c.key === 'winter') w = c; });
        return '日月高度：太阳与月亮沿塔轴的高度互为镜像，振幅 ' + signedKm(d.big).replace('+', '') + '；' +
          (w ? '本年入冬交节月对日方位差 ' + signedDeg(w.elong) + '，' + (w.festival ? '庆典' : '非庆典') : '本年没有入冬交节');
      }
    };
    return C.make('helix', canvas, impl, opts);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
