/* HY.charts 'meridian' —— 子午线剖面（规格：spec/03 第八节第 2 条“子午线剖面”一行）
 * 负责：C 路（图表）。
 * 此地方位的一条经线，横轴沿地面离塔根 0 … πR 公里（右端是塔顶）。底色为各域，塔基涂黑。
 *   蓝线：夜长（常年；按 0–24 小时画）· 金线：今日日剂量（右轴 MJ/m²）· 橙线：今日正午日高（左轴 0–90°）
 *   灰线：头顶塔宽（左轴，度；靠近塔基会超出 90°，截在顶上）
 *   顶部：预设地点刻度；竖线：当前地点。
 * 点选：把地点移到那里（离塔根距离变，方位不变；正落在同方位的预设地点上时记成该地点）。
 * 数据：HY.calc.meridian(tMidRef, az, P, Z)（经 HY.model.cached）；当地日期或参数变了才重算。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;
  var ZCOL = { tower: 'z-tower', light: 'z-light', plain: 'z-plain', heavy: 'z-heavy', limbo: 'z-limbo' };

  /* 分域按 s 连成段（底色用）。判定一律用 HY.world.zoneOf；取样点＝每 πR/1600 一个，再加上 HY.world.zoneBounds 给的
   * 每条分界（及其在塔顶半球的对称位置）两侧各 0.1 公里的点——灵薄带调得很窄（几公里）时也不会被均匀取样漏掉。
   * 相邻两个取样点分域不同时二分出边界。 */
  function zoneSegs(P, Z, piR) {
    function zid(s) { return HY.world.zoneOf(s, P, Z).id; }
    var pts = [], NZ = 1600, j, b = HY.world.zoneBounds(P, Z), eps = 0.1;
    for (j = 0; j <= NZ; j++) pts.push(piR * j / NZ);
    [b.tower, b.light, b.heavy, b.limbo[0], b.limbo[1]].forEach(function (c) {
      [c, piR - c].forEach(function (x) {
        if (!(x > 0 && x < piR)) return;
        if (x - eps > 0) pts.push(x - eps);
        if (x + eps < piR) pts.push(x + eps);
      });
    });
    pts.sort(function (u, v) { return u - v; });
    var segs = [], cur = null, prevS = 0;
    for (j = 0; j < pts.length; j++) {
      var sj = pts[j], z = zid(sj);
      if (cur && cur.id === z) { prevS = sj; continue; }
      var edge = 0;
      if (cur) {
        var lo = prevS, hi = sj;
        for (var it = 0; it < 40; it++) { var mid = 0.5 * (lo + hi); if (zid(mid) === cur.id) lo = mid; else hi = mid; }
        edge = hi; cur.s1 = edge;
      }
      cur = { id: z, s0: edge }; segs.push(cur); prevS = sj;
    }
    if (cur) cur.s1 = piR;
    return segs;
  }
  // 剖面数组在 s 处的线性插值（与画出来的折线一致；塔基里是 NaN）
  function lerpAt(m, arr, s, piR) {
    var n = m.s.length, f = C_clamp(s / piR * (n - 1), 0, n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
    var a = arr[i], c = arr[i + 1];
    if (!(a === a)) return u > 0.999 ? c : NaN;
    if (!(c === c)) return u < 0.001 ? a : NaN;
    return a + (c - a) * u;
  }
  function C_clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  HY.charts.register('meridian', function (canvas, opts, C) {
    function km(v) { return HY.calc.km(v); }

    var impl = {
      // 剖面按当地日重算（每日一次，约 10 毫秒）；快放时（每秒十日）最多每 250 毫秒算一回，其间先用旧数据画
      throttle: 250,
      walkThrottle: 1000,               // 第一人称步行时（换了经线）：每秒至多重算一次（03 第七节第 8 条）
      key: function (E) {
        var tMid = C.dayStart(E.O, E.t, E.P), Z = HY.model.Z || {};
        return HY.model.pv + '|' + E.O.az.toFixed(4) + '|' + tMid.toFixed(5) + '|' + [Z.gLight, Z.gHeavy, Z.limboKm].join(',');
      },
      compute: function (E) {
        var P = E.P, O = E.O, Z = HY.model.Z || (HY.state && HY.state.zones), tMid = C.dayStart(O, E.t, P);
        var m = HY.model.cached('meridian', [O.az.toFixed(4), tMid.toFixed(6)], function () { return HY.calc.meridian(tMid, O.az, P, Z); });
        var dmax = 0, n = m.s.length;
        for (var i = 0; i < n; i++) if (m.doseMJ[i] > dmax) dmax = m.doseMJ[i];
        var piR = Math.PI * P.R, segs = zoneSegs(P, Z, piR);
        var sites = HY.world.siteList(P).map(function (q) { return { id: q.id, name: q.short || q.name, full: q.name, s: q.s, az: q.az }; });
        return { m: m, n: n, piR: piR, doseMax: C.niceMax(dmax || 1, 4), dmax: dmax, segs: segs, sites: sites, tMid: tMid };
      },

      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, m = d.m, L = 30, R = 32, x0 = L, x1 = w - R, pw = Math.max(10, x1 - x0);
        var st0 = 4, p0 = 22, yAx = h - 36, p1 = yAx - 2;
        var X = function (s) { return x0 + s / d.piR * pw; };
        var Ye = function (el) { return p1 - Math.min(el, 92) / 90 * (p1 - p0); };
        var Yd = function (v) { return p1 - v / d.doseMax * (p1 - p0); };
        var Yh = function (hr) { return p1 - hr / 24 * (p1 - p0); };
        var colNight = pal.night, colDose = pal.sun, colNoon = pal.noon, colTower = C.rgba(pal.fg, 0.55);
        var lay = { x0: x0, x1: x1, pw: pw, X: X, area: { x0: x0, x1: x1, y0: p0, y1: p1 }, sites: [] };

        // 底色：各域；塔基涂黑
        d.segs.forEach(function (sg) {
          var a = X(sg.s0), b = X(sg.s1);
          if (b - a < 0.3) return;
          ctx.fillStyle = sg.id === 'tower' ? pal['z-tower'] : C.rgba(pal[ZCOL[sg.id]] || pal.muted, 0.2);
          ctx.fillRect(a, p0, b - a, p1 - p0);
          if (sg.id !== 'tower' && b - a > 22) {
            ctx.font = C.font(9, false);
            C.label(ctx, HY.world.ZONE_NAMES[sg.id] || sg.id, (a + b) / 2, p1 - 4, C.rgba(pal[ZCOL[sg.id]] || pal.muted, 0.9), { align: 'center', halo: false });
          }
        });
        ctx.strokeStyle = pal.line2; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, p0 + 0.5, pw - 1, p1 - p0 - 1);
        // 左轴（度）、右轴（MJ/m²）
        ctx.font = C.font(9, true);
        [30, 60, 90].forEach(function (v) {
          var y = Math.round(Ye(v)) + 0.5;
          C.hline(ctx, x0, x1, y, C.rgba(pal.fg, 0.07), 1);
          C.label(ctx, v + '°', x0 - 4, y + 3, colNoon, { align: 'right', halo: false });
        });
        C.label(ctx, '0°', x0 - 4, p1 + 3, colNoon, { align: 'right', halo: false });
        var dstep = C.niceStep(d.doseMax, 3);
        for (var dv = 0; dv <= d.doseMax + 1e-9; dv += dstep) C.label(ctx, C.num(dv, dstep < 1 ? 1 : 0), x1 + 4, Yd(dv) + 3, colDose, { halo: false });
        C.label(ctx, 'MJ/m²', x1 + 2, p0 - 9, colDose, { halo: false, font: C.font(8, false) });
        // 赤道
        C.vline(ctx, Math.round(X(d.piR / 2)) + 0.5, p0, p1, C.rgba(pal.fg, 0.25), 1, [2, 3]);

        // 曲线（塔基里是 NaN，自然断开）
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, p0, pw, p1 - p0); ctx.clip();
        C.polyline(ctx, d.n, function (i) { return [X(m.s[i]), Ye(m.towerW[i])]; }, colTower, 1.1, [3, 2]);
        C.polyline(ctx, d.n, function (i) { return [X(m.s[i]), Yh(m.nightH[i])]; }, colNight, 1.5);
        C.polyline(ctx, d.n, function (i) { return [X(m.s[i]), Yd(m.doseMJ[i])]; }, colDose, 1.6);
        C.polyline(ctx, d.n, function (i) { return [X(m.s[i]), Ye(m.noonEl[i])]; }, colNoon, 1.4);
        ctx.restore();

        // 预设地点刻度（顶部）
        ctx.font = C.font(9, false);
        var taken = [], cur = HY.state && HY.state.site ? HY.state.site : { id: null, s: E.O.s };
        var order = d.sites.slice().sort(function (a, b) { return (a.id === cur.id ? -1 : 0) - (b.id === cur.id ? -1 : 0); });
        order.forEach(function (q) {
          var x = X(q.s), col = q.id === cur.id ? pal.fg : pal.muted;
          ctx.beginPath(); ctx.moveTo(x - 3, p0 - 6); ctx.lineTo(x + 3, p0 - 6); ctx.lineTo(x, p0 - 1); ctx.closePath();
          ctx.fillStyle = col; ctx.fill();
          lay.sites.push({ x: x, q: q });
          var tw = ctx.measureText(q.name).width, a = C.clamp(x - tw / 2, 0, w - tw), z = a + tw;
          for (var i = 0; i < taken.length; i++) if (a < taken[i][1] + 3 && z > taken[i][0] - 3) return;
          taken.push([a, z]);
          C.label(ctx, q.name, a, st0 + 7, col, { halo: false });
        });

        // 横轴：公里
        C.hline(ctx, x0, x1, yAx + 0.5, pal.line2, 1);
        ctx.font = C.font(9, true);
        var kstep = C.niceStep(d.piR, 5), lastX = -1e9;
        for (var s = 0; s <= d.piR + 1e-6; s += kstep) {
          var xs = X(s), lab = HY.util && HY.util.thousands ? HY.util.thousands(s, 0) : C.num(s, 0), lw = ctx.measureText(lab).width;
          C.vline(ctx, Math.round(xs) + 0.5, yAx, yAx + 3, pal.line2, 1);
          if (xs - lw / 2 < lastX + 4 || xs + lw / 2 > x1 + R) continue;
          C.label(ctx, lab, xs, yAx + 13, pal.dim, { align: s === 0 ? 'left' : 'center', halo: false });
          lastX = xs + lw / 2;
        }
        // 底行：塔根 … 图例 … 塔顶
        ctx.font = C.font(9, false);
        var yb = h - 5;
        C.label(ctx, '塔根', x0, yb, pal.muted, { halo: false });
        C.label(ctx, '塔顶', x1, yb, pal.muted, { align: 'right', halo: false });
        var lg = [['夜长', colNight, null], ['今日剂量', colDose, null], ['正午日高', colNoon, null], ['塔宽', colTower, [3, 2]]];
        var tot = 0;
        lg.forEach(function (it) { tot += 14 + ctx.measureText(it[0]).width + 8; });
        var room = pw - 2 * ctx.measureText('塔根').width - 16;
        if (tot <= room) {
          var lx = x0 + (pw - tot) / 2;
          lg.forEach(function (it) {
            C.hline(ctx, lx, lx + 10, yb - 3.5, it[1], 2, it[2]);
            C.label(ctx, it[0], lx + 13, yb, pal.muted, { halo: false });
            lx += 14 + ctx.measureText(it[0]).width + 8;
          });
        }

        // 当前地点
        var xs0 = X(E.O.s);
        C.vline(ctx, Math.round(xs0) + 0.5, p0 - 1, p1, pal.fg, 1.2);
        // 此地的读数：点在曲线上，数字标在竖线旁（上下互相让开）
        var O = E.O, P = E.P;
        if (O.r > P.a * (1 + 1e-9)) {
          var nh = (1 - HY.astro.dayFraction(O.r, P)) * P.dayHours, ne = HY.astro.noonSun(O, d.tMid + 0.5, P).el;
          // 此地今日剂量取精确值（HY.calc.dayStats，与天空图、一日图共用同一份缓存）；剖面每 125 公里一个取样，
          // 贴着塔的那一段变化很陡，取最近的样点会差出好几 MJ
          var dose = HY.model.cached('dayStats', [d.tMid.toFixed(6)], function () { return HY.calc.dayStats(O, d.tMid, P); }).doseMJ;
          var vals = [[Yh(nh), colNight, '夜 ' + C.hours(nh)], [Yd(dose), colDose, C.num(dose, 1) + ' MJ'], [Ye(ne), colNoon, C.num(ne, 0) + '°']];
          vals.forEach(function (v) { if (C.fin(v[0])) C.dot(ctx, xs0, v[0], 2.4, v[1], pal.bg); });
          vals = vals.filter(function (v) { return C.fin(v[0]); }).sort(function (a, b) { return a[0] - b[0]; });
          var right = xs0 < x0 + pw * 0.75, prevY = -1e9;
          ctx.font = C.font(9, true);
          vals.forEach(function (v) {
            var y = Math.max(v[0] + 3, prevY + 10);
            y = Math.min(y, p1 - 2);
            prevY = y;
            C.label(ctx, v[2], xs0 + (right ? 5 : -5), y, v[1], { align: right ? 'left' : 'right' });
          });
        }
        lay.cursor = xs0;
        if (hover) C.crosshair(ctx, lay.area, hover.x, null);
        return lay;
      },

      tip: function (d, hv, lay, E) {
        if (!lay || hv.x < lay.x0 - 2 || hv.x > lay.x1 + 2) return null;
        var P = E.P, snap = snapSite(d, lay, hv.x), s = snap ? snap.s : C.clamp((hv.x - lay.x0) / lay.pw * d.piR, 0, d.piR);
        var O = HY.astro.site(s, E.O.az, P), z = HY.world.zoneOf(s, P, HY.model.Z || HY.state.zones);
        var out = [(snap ? snap.full + ' · ' : '') + '离塔根 ' + km(s) + ' · ' + z.name];
        out.push('重力 ' + C.num(O.g, 2) + ' g · 纬度 ' + C.num(O.lat, 1) + '°');
        if (O.r > P.a * (1 + 1e-9)) {
          var df = HY.astro.dayFraction(O.r, P), ns = HY.astro.noonSun(O, d.tMid + 0.5, P), tv = HY.astro.towerView(O, P);
          var dose = lerpAt(d.m, d.m.doseMJ, s, d.piR);
          out.push('夜长 ' + C.hours((1 - df) * P.dayHours) + ' · 今日剂量约 ' + C.num(dose, 1) + ' MJ/m²');
          out.push('正午日高 ' + C.num(ns.el, 1) + '°（' + ns.dir + '天）· 头顶塔宽 ' + C.num(tv.width, 1) + '°');
        } else out.push('在塔基里：终日不见日');
        if (snap && snap.az !== E.O.az) out.push('（预设方位 ' + C.num(snap.az, 0) + '°；点选只改距离）');
        out.push('点击：把地点移到这里（方位不变）');
        return out;
      },
      pick: function (d, pt, lay, E) {
        if (!lay || pt.x < lay.x0 - 4 || pt.x > lay.x1 + 4) return null;
        var snap = snapSite(d, lay, pt.x);
        if (snap) return { s: snap.s, id: Math.abs(snap.az - E.O.az) < 1e-6 ? snap.id : null };
        var s = C.clamp((pt.x - lay.x0) / lay.pw * d.piR, 0, d.piR);
        return { s: Math.round(s) };
      },
      aria: function (d, E) {
        return '子午线剖面：方位 ' + C.num(E.O.az, 0) + ' 度的经线，从塔根到塔顶 ' + km(d.piR) + '；此地离塔根 ' + km(E.O.s);
      }
    };
    function snapSite(d, lay, x) {
      var best = null, bd = 5;
      lay.sites.forEach(function (it) { var dd = Math.abs(it.x - x); if (dd < bd) { bd = dd; best = it.q; } });
      return best;
    }
    return C.make('meridian', canvas, impl, opts);
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
