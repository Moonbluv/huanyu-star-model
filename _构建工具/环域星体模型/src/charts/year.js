/* HY.charts 'year' —— 一年（规格：spec/03 第八节第 2 条“一年”一行；横轴按统筹修订用“入冬后第 X 日”，不用月日）
 * 负责：C 路（图表）。
 * 横轴＝此地第 N 年的 doy（0 … Y−1，年号口径见 HY.world.CAL.yearStart），刻度写“入冬后第 X 日”。
 *   金线：正午太阳仰角（左轴 0–90°）；蓝线：日剂量 MJ/m²（右轴，大气顶）；淡线：夜长（常年不变，按 0–24 小时画）。
 *   顶部：季节带（此地半球的冬／夏）；其下：节令与正文日期（HY.world.MARKS，“待定”的画空心）。
 *   底部：月态行——每夜一枚：亮月圆点大小＝亮面，灰月半圆，黑月细环，黑月高悬在下面加一点（太挤时改画成竖条）。
 *   游标＝此刻。点选：跳到那一日（保留钟点）；悬停：当天数值与当夜的月。
 * 数据：HY.calc.yearTable(O, N, P, {yuxiLead})（经 HY.model.cached）。(N, 地点, P) 变了才重算。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;
  var TAU = Math.PI * 2;

  // 相邻（≤2 日）、同类的标记并成一组；“审判 D1 夜、D2 夜、D3 夜”写成“审判 D1–D3 夜”
  function groupMarks(marks) {
    var out = [];
    marks.forEach(function (m) {
      var g = out[out.length - 1];
      if (g && g.kind === m.kind && m.doy - g.last <= 2) { g.items.push(m); g.last = m.doy; return; }
      out.push({ kind: m.kind, doy: m.doy, last: m.doy, items: [m] });
    });
    out.forEach(function (g) {
      var a = g.items[0], b = g.items[g.items.length - 1];
      g.tbd = g.items.some(function (m) { return m.tbd; });
      if (g.items.length === 1) { g.label = a.label; return; }
      var ra = /^(.*?)(D\d+)(.*)$/.exec(a.label), rb = /^(.*?)(D\d+)(.*)$/.exec(b.label);
      g.label = ra && rb && ra[1] === rb[1] && ra[3] === rb[3] ? ra[1] + ra[2] + '–' + rb[2] + ra[3] : a.label + '…';
    });
    return out;
  }
  // 标记的先后（标签放不下时先保谁）：庆典 > 正文 > 设定 > 节令
  var PRI = { festival: 0, story: 1, setting: 2, season: 3 };

  HY.charts.register('year', function (canvas, opts, C) {
    function yuxiLead() { var s = HY.state && HY.state.fp && HY.state.fp.set; return s && s.yuxiLead != null ? s.yuxiLead : 45; }
    function yearN(E) { return E.now && E.now.date ? E.now.date.N : HY.calc.civil(E.t, E.O.az, E.P).N; }
    // 页眉的年：全写（庆典年 · 周期第几年）与放不下时的短式（去掉周期）
    function headTexts(d) {
      d.yearText = C.calText({ N: d.N, festival: d.yt.festival, cyc: d.cyc }, 'year');
      d.yearShort = C.calText({ N: d.N, festival: d.yt.festival }, 'year');
    }

    var impl = {
      throttle: 120,
      walkThrottle: 1000,               // 第一人称步行时：一年表每秒至多重算一次（03 第七节第 8 条）
      key: function (E) {
        return HY.model.pv + '|' + HY.model.siteKey() + '|' + yearN(E) + '|' + yuxiLead() + '|' + HY.world.CAL.yearStart;
      },
      compute: function (E) {
        var P = E.P, O = E.O, N = yearN(E), lead = yuxiLead();
        var yt = HY.model.cached('yearTable', [N, lead, HY.world.CAL.yearStart], function () {
          return HY.calc.yearTable(O, N, P, { yuxiLead: lead });
        });
        var Y = yt.noonEl.length, dmax = 0, emin = 90, emax = 0;
        for (var i = 0; i < Y; i++) {
          if (yt.doseMJ[i] > dmax) dmax = yt.doseMJ[i];
          var e = yt.noonEl[i];
          if (e === e) { if (e < emin) emin = e; if (e > emax) emax = e; }
        }
        return {
          yt: yt, N: N, Y: Y, doseMax: C.niceMax(dmax || 1, 4), dmax: dmax, emin: emin, emax: emax, inTower: !(O.r > P.a * (1 + 1e-9)),
          ax: C.yearAxis(N, P, O.az, yt.wd0), groups: groupMarks(yt.marks),
          cyc: HY.calc.civil(yt.t0 + 0.5, O.az, P).cyc
        };
      },

      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, yt = d.yt, Y = d.Y;
        var L = 30, R = 32, x0 = L, x1 = w - R, pw = Math.max(10, x1 - x0);
        var sb0 = 15, sb1 = 24, mk = 27, p0 = 40, p1 = h - 53, mr0 = h - 45, mr1 = h - 35, hy = h - 31, yAx = h - 27;
        if (p1 - p0 < 30) { p1 = p0 + 30; }
        var X = function (doy) { return x0 + doy / Y * pw; };
        var Ye = function (el) { return p1 - el / 90 * (p1 - p0); };
        var Yd = function (v) { return p1 - v / d.doseMax * (p1 - p0); };
        var Yh = function (hr) { return p1 - hr / 24 * (p1 - p0); };
        var colNoon = pal.sun, colDose = pal.night, colNight = C.rgba(pal.fg, 0.38);
        var lay = { x0: x0, x1: x1, pw: pw, Y: Y, X: X, area: { x0: x0, x1: x1, y0: sb0, y1: mr1 }, marks: [], p: [p0, p1], mr: [mr0, mr1] };

        // 页眉：第 N 年 ＋ 图例（年的叫法每次画时现取 HY.world.fmtCal，作者改了 CAL 不用等重算）
        headTexts(d);
        // 图例按重要性取舍：金线（正午日高）是图里最显眼的一条，一定要有；放不下先把年份换短式，再丢“夜长”“日剂量”
        //   （原先从右往左排、一碰到年份就停，最先丢掉的反而是金线）
        var legend = [['正午日高', colNoon, false], ['日剂量', colDose, false], ['夜长', colNight, true]];
        function legW(n) { ctx.font = C.font(9, false); var s = 0; for (var q = 0; q < n; q++) s += ctx.measureText(legend[q][0]).width + 22; return s; }
        ctx.font = C.font(10, false);
        var yText = d.yearText, nLeg = 3;
        function fits() { ctx.font = C.font(10, false); return x0 + ctx.measureText(yText).width + 8 + legW(nLeg) <= x1 + 6; }
        if (!fits()) yText = d.yearShort;
        while (nLeg > 1 && !fits()) nLeg--;
        ctx.font = C.font(10, false);
        C.label(ctx, yText, x0, 10, d.yt.festival ? pal.sun : pal.fg, { halo: false });
        ctx.font = C.font(9, false);
        var lx = x1;
        for (var li = nLeg - 1; li >= 0; li--) {
          var lw = ctx.measureText(legend[li][0]).width;
          C.label(ctx, legend[li][0], lx, 10, pal.muted, { align: 'right', halo: false });
          C.hline(ctx, lx - lw - 14, lx - lw - 3, 6.5, legend[li][1], 2, legend[li][2] ? [3, 2] : null);
          lx -= lw + 22;
        }

        // 季节带（此地半球）
        yt.seasons.forEach(function (s) {
          var a = X(s.from), b = X(s.to);
          if (b - a < 0.5) return;
          ctx.fillStyle = s.season === '冬' ? C.rgba(pal.winter, 0.55) : s.season === '夏' ? C.rgba(pal.summer, 0.55) : C.rgba(pal.muted, 0.3);
          ctx.fillRect(a, sb0, b - a, sb1 - sb0);
          if (b - a > 16) {
            ctx.font = C.font(9, false);
            C.label(ctx, HY.world.CAL.names.season[s.season] || s.season, (a + b) / 2, sb1 - 2, pal['sun-ink'], { align: 'center', halo: false });
          }
        });
        ctx.strokeStyle = pal.line2; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, sb0 + 0.5, pw - 1, sb1 - sb0 - 1);

        // 绘图区：网格与轴
        ctx.font = C.font(9, true);
        [0, 30, 60, 90].forEach(function (v) {
          var y = Math.round(Ye(v)) + 0.5;
          C.hline(ctx, x0, x1, y, C.rgba(pal.fg, v === 0 ? 0.2 : 0.07), 1);
          C.label(ctx, v + '°', x0 - 4, y + 3, colNoon, { align: 'right', halo: false });
        });
        var dstep = C.niceStep(d.doseMax, 3);
        for (var dv = 0; dv <= d.doseMax + 1e-9; dv += dstep) {
          C.label(ctx, C.num(dv, dstep < 1 ? 1 : 0), x1 + 4, Yd(dv) + 3, colDose, { halo: false });
        }
        C.label(ctx, 'MJ/m²', x1 + 2, p0 - 9, colDose, { halo: false, font: C.font(8, false) });
        // 季节交界的竖线（入冬、冬至、入夏、夏至）
        d.ax.ticks.forEach(function (tk) { C.vline(ctx, Math.round(X(tk.doy)) + 0.5, p0, p1, C.rgba(pal.fg, 0.07), 1); });

        // 节令标记：竖虚线＋三角＋标签（放不下的只留三角）
        var groups = d.groups.slice().sort(function (a, b) { return (PRI[a.kind] == null ? 9 : PRI[a.kind]) - (PRI[b.kind] == null ? 9 : PRI[b.kind]); });
        var taken = [], taken2 = [];
        // 每个三角都是禁区（验收回归第 2 条：“审判 D1–D3 夜（待定）”曾压在入夏、夏至的三角上，“审”被盖成“甲”）
        var tris = groups.map(function (g) { return X(g.doy + 0.5); });
        ctx.font = C.font(9, false);
        groups.forEach(function (g, gi) {
          var x = X(g.doy + 0.5), col = g.kind === 'festival' ? pal.sun : g.kind === 'story' ? pal.warn : g.kind === 'setting' ? pal.hang : pal.muted;
          C.vline(ctx, Math.round(x) + 0.5, mk + 5, p1, C.rgba(col, 0.35), 1, [2, 3]);
          ctx.beginPath(); ctx.moveTo(x - 3.5, mk); ctx.lineTo(x + 3.5, mk); ctx.lineTo(x, mk + 5); ctx.closePath();
          if (g.tbd) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
          lay.marks.push({ x: x, g: g });
          if (g.kind === 'season') return;                  // 节令已由季节带与横轴刻度说明
          // 标签先放三角右边，放不下（出界或压到已放的）再试左边，再试去掉“（待定）”的短式；正文日期是作者最关心的标记
          var full = g.label + (g.tbd ? '（' + HY.world.CAL.names.tbd + '）' : '');
          //   第一行（与三角同高）放不下时，庆典与正文日期再试三角下方的第二行（只躲第二行已放的字）
          var cands = [[full, 1, 1], [full, -1, 1], [g.label, 1, 1], [g.label, -1, 1]], hit = null;
          if (g.kind === 'festival' || g.kind === 'story') cands.push([full, 1, 2], [full, -1, 2], [g.label, 1, 2], [g.label, -1, 2]);
          for (var ci = 0; ci < cands.length && !hit; ci++) {
            var s = cands[ci][0], tw = ctx.measureText(s).width, side = cands[ci][1], row = cands[ci][2], tk = row === 1 ? taken : taken2;
            var lx0 = side > 0 ? x + 5 : x - 5 - tw, lx1 = lx0 + tw, clash = lx0 < x0 - 2 || lx1 > x1 + 2;
            for (var i = 0; i < tk.length && !clash; i++) if (lx0 < tk[i][1] + 4 && lx1 > tk[i][0] - 4) clash = true;
            if (row === 1) for (var j = 0; j < tris.length && !clash; j++) if (j !== gi && lx0 < tris[j] + 5 && lx1 > tris[j] - 5) clash = true;
            if (!clash) hit = { s: s, side: side, l: lx0, r: lx1, row: row };
          }
          if (!hit) return;
          (hit.row === 1 ? taken : taken2).push([hit.l, hit.r]);
          C.label(ctx, hit.s, hit.side > 0 ? x + 5 : x - 5, hit.row === 1 ? mk + 8 : mk + 19, col, { align: hit.side > 0 ? 'left' : 'right' });
        });

        // 曲线：夜长（常年）、日剂量、正午日高（塔基里终日不见日：只写一句）
        if (d.inTower) {
          ctx.font = C.font(11, false);
          C.label(ctx, '此地在塔基里：终日不见日', (x0 + x1) / 2, (p0 + p1) / 2 + 4, pal.muted, { align: 'center' });
        } else {
          var yN = Math.round(Yh(yt.nightH)) + 0.5;
          C.hline(ctx, x0, x1, yN, colNight, 1, [4, 3]);
          ctx.font = C.font(9, false);
          // 夜长的字放在离两条曲线最远的地方（右、左、中三处里挑）
          var nightTxt = '夜 ' + C.hours(yt.nightH) + '（常年）', ntw = ctx.measureText(nightTxt).width, bestN = null;
          [['right', x1 - 2 - ntw, x1 - 2], ['left', x0 + 2, x0 + 2 + ntw], ['center', (x0 + x1 - ntw) / 2, (x0 + x1 + ntw) / 2]].forEach(function (cnd) {
            var dmin = 1e9;
            for (var dd = Math.max(0, Math.floor((cnd[1] - x0) / pw * Y)); dd <= Math.min(Y - 1, Math.ceil((cnd[2] - x0) / pw * Y)); dd++) {
              var e1 = yt.noonEl[dd];
              if (e1 === e1) dmin = Math.min(dmin, Math.abs(Ye(e1) - (yN - 6)));
              dmin = Math.min(dmin, Math.abs(Yd(yt.doseMJ[dd]) - (yN - 6)));
            }
            if (!bestN || dmin > bestN.d) bestN = { d: dmin, a: cnd[0], x: cnd[0] === 'right' ? cnd[2] : cnd[0] === 'left' ? cnd[1] : (x0 + x1) / 2 };
          });
          C.label(ctx, nightTxt, bestN.x, yN - 3, pal.muted, { align: bestN.a });
          // 曲线限在绘图区里（贴着塔、离轴比日轨还近的地方，正午日高会略低于 0°）
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, p0 - 2, pw, p1 - p0 + 4); ctx.clip();
          C.polyline(ctx, Y, function (i) { return [X(i + 0.5), Yd(yt.doseMJ[i])]; }, colDose, 1.4);
          C.polyline(ctx, Y, function (i) { var e = yt.noonEl[i]; return e === e ? [X(i + 0.5), Ye(e)] : null; }, colNoon, 1.7);
          ctx.restore();
        }

        // 月态行
        var dx = pw / Y, nights = yt.nights, glyph = dx >= 4, rr = Math.min(dx * 0.42, (mr1 - mr0) / 2);
        var cMoon = pal.moon, cGrey = pal['moon-grey'], cBlack = C.mix(pal['moon-black'], pal.fg, 0.18);
        ctx.fillStyle = C.rgba(pal.stage, 0.6); ctx.fillRect(x0, mr0, pw, mr1 - mr0);
        for (var n = 0; n < nights.length; n++) {
          var q = nights[n], xc = X(q.doy + 0.5), ym = (mr0 + mr1) / 2;
          if (glyph) {
            if (q.state === '亮月') C.dot(ctx, xc, ym, Math.max(0.8, rr * Math.sqrt(Math.max(0.05, q.k))), cMoon);
            else if (q.state === '灰月') {
              ctx.beginPath(); ctx.arc(xc, ym, rr, Math.PI / 2, -Math.PI / 2, false); ctx.closePath(); ctx.fillStyle = cGrey; ctx.fill();
            } else { ctx.beginPath(); ctx.arc(xc, ym, rr * 0.85, 0, TAU); ctx.strokeStyle = cBlack; ctx.lineWidth = 1; ctx.stroke(); }
          } else {
            var hh = mr1 - mr0, bh = q.state === '亮月' ? Math.max(2, hh * q.k) : q.state === '灰月' ? hh * 0.5 : hh;
            ctx.fillStyle = q.state === '亮月' ? cMoon : q.state === '灰月' ? cGrey : C.rgba(pal['moon-black'], 0.95);
            ctx.fillRect(xc - dx / 2, ym - bh / 2, dx + 0.35, bh);
          }
          if (q.blackHighSeen) C.dot(ctx, xc, hy, glyph ? 1.3 : 0.9, pal.hang);
          if (q.festival) C.star(ctx, xc, mr0 - 4, 3.5, pal.sun);
        }
        ctx.font = C.font(9, false);
        C.label(ctx, '月', x0 - 4, mr1 - 1, pal.muted, { align: 'right', halo: false });

        // 横轴（入冬后第 X 日）
        C.hline(ctx, x0, x1, yAx + 0.5, pal.line2, 1);
        C.drawYearAxis(ctx, d.ax, x0, x1, yAx, pal);

        // 游标：此刻
        var dNow = E.t - yt.t0;
        if (dNow >= 0 && dNow < Y) {
          var xn = Math.round(X(dNow)) + 0.5, di = Math.floor(dNow);
          C.vline(ctx, xn, sb0, mr1 + 2, pal.fg, 1);
          var en = yt.noonEl[di];
          if (!d.inTower) {
            if (en === en) C.dot(ctx, X(di + 0.5), Ye(en), 2.6, colNoon, pal.bg);
            C.dot(ctx, X(di + 0.5), Yd(yt.doseMJ[di]), 2.2, colDose, pal.bg);
          }
          lay.cursor = xn;
        }
        if (hover) C.crosshair(ctx, lay.area, hover.x, null);
        return lay;
      },

      tip: function (d, hv, lay, E) {
        if (!lay || hv.x < lay.x0 - 2 || hv.x > lay.x1 + 2) return null;
        var yt = d.yt, doy = Math.floor(C.clamp((hv.x - lay.x0) / lay.pw * d.Y, 0, d.Y - 1e-6));
        var q = yt.nights[doy], tDay = yt.t0 + doy + 0.5, P = E.P, O = E.O;
        var mn = HY.calc.moonNight(O, q.t, P);
        var out = [C.dayCal(tDay, O, P, { state: q.state, night: mn.night })];
        var ns = HY.astro.noonSun(O, tDay, P);
        if (d.inTower) out.push('在塔基里：终日不见日');
        else out.push('正午日高 ' + C.num(yt.noonEl[doy], 1) + '°（' + ns.dir + '天）· 日剂量 ' + C.num(yt.doseMJ[doy], 1) + ' MJ/m²');
        var moon = q.state === '亮月' ? '亮月 ' + Math.round(q.k * 100) + '%' : q.state;
        var extra = [];
        if (q.litMin > 0) extra.push('见亮月 ' + C.minutesText(q.litMin));
        if (q.blackHighMin > 0) extra.push('黑月高悬 ' + C.minutesText(q.blackHighMin));
        out.push('当夜子夜：' + moon + (extra.length ? ' · ' + extra.join(' · ') : ''));
        if (q.festival) out.push('庆典夜');
        // 悬停处 ±4 像素内的标记（每日不到 1 像素时会多带上相邻一两天的）
        var tol = Math.max(0, Math.ceil(4 / (lay.pw / d.Y)) - 1);
        yt.marks.forEach(function (m) {
          if (Math.abs(m.doy - doy) > tol) return;
          out.push(m.label + (m.tbd ? '（' + HY.world.CAL.names.tbd + '）' : '') + (m.note ? '：' + m.note : ''));
        });
        out.push('点击：跳到这一日（钟点不变）');
        return out;
      },
      pick: function (d, pt, lay, E) {
        if (!lay || pt.x < lay.x0 - 4 || pt.x > lay.x1 + 4 || pt.y > lay.mr[1] + 6) return null;
        var doy = Math.floor(C.clamp((pt.x - lay.x0) / lay.pw * d.Y, 0, d.Y - 1e-6));
        return { doy: doy, t: d.yt.t0 + doy + C.hourNow(E) / E.P.dayHours };
      },
      aria: function (d) {
        headTexts(d);
        if (d.inTower) return '一年：' + d.yearShort + '；此地在塔基里，终日不见日';
        return '一年：' + d.yearShort + '；正午日高 ' + C.num(d.emin, 0) + '–' + C.num(d.emax, 0) + ' 度，日剂量最多 ' +
          C.num(d.dmax, 1) + ' MJ/m²；夜长常年 ' + C.hours(d.yt.nightH);
      },
      listen: function (ch) {
        return [HY.bus.on('fp', function (e) {
          var ps = e.paths || [e.path];
          if (ps.some(function (p) { return /^fp(\.set(\.yuxiLead)?)?$/.test(p); })) ch.update('model');
        })];
      }
    };
    var ch = C.make('year', canvas, impl, opts);
    ch.groupMarks = groupMarks;
    return ch;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
