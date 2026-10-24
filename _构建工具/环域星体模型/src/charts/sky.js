/* HY.charts 'sky' —— 天空图（仰望图；规格：spec/03 第八节第 2 条“天空图”一行）
 * 负责：C 路（图表）。
 * 以天顶（重力“上”）为中心的等距方位投影，边缘＝重力水平；上北（塔根）下南（塔顶），仰望所以东在左。
 *   ① 底图：每个方向的视线撞到的对面内壁此刻是昼是夜（60×60 射线，平滑放大；≤1 Hz，或模拟时间变 0.02 日即重算）
 *   ② 地面：本地切面以下的区域（向北抬升到仰角＝纬度）斜线淡影，标“平均坡面”
 *   ③ 巨塔：沿塔轴取样投出两条切边，填黑；标塔根端、塔顶端仰角与头顶塔宽
 *   ④ 太阳今日路径按一日五段着色；此刻日面按露出比例画成被直边切掉的圆
 *   ⑤ 月：今夜（18–6 时）路径；此刻月盘画相（明暗界朝太阳），灰月叠直影边，黑月深灰盘加细环，黑月高悬加注
 *   ⑥ 30°、60° 仰角圈
 * 悬停：仰角／方位与“对面是昼／夜”；第一人称时点日、月、塔端（或任一点）→ HY.app.look 转头看过去。
 * 数据：HY.model.now、HY.astro（位置、遮挡、射线）、HY.calc.dayStats（今日五段）。这里只做投影，不另立日月公式。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  if (!HY.charts || !HY.charts.register) return;
  var TAU = Math.PI * 2, D2R = Math.PI / 180;
  var KINDS = ['behind', 'cut', 'beside', 'front'];
  var MAPN = 60;

  HY.charts.register('sky', function (canvas, opts, C) {
    var map = { vals: new Float32Array(MAPN * MAPN), tw: new Float32Array(MAPN * MAPN), key: '', t: NaN, at: -1e12, cv: null, img: null, ready: false, lit: 0 };
    var dirTmp = [0, 0, 0];

    function segKindAt(ds, O, t, P, useSegs) {
      if (useSegs) {
        var s = ds.segs;
        for (var i = 0; i < s.length; i++) if (t >= s[i].t0 && t < s[i].t1) return s[i].kind;
        if (s.length && t >= s[s.length - 1].t1) return s[s.length - 1].kind;
      }
      return HY.astro.sunAspect(O, t, P).kind;
    }

    var impl = {
      stubs: ['dayStats'],
      key: function (E) {
        var tMid = C.dayStart(E.O, E.t, E.P), h = HY.astro.localHour(E.t, E.O, E.P);
        return HY.model.pv + '|' + HY.model.siteKey() + '|' + tMid.toFixed(5) + '|' + (h >= 12 ? 1 : 0);
      },
      compute: function (E) {
        var A = HY.astro, P = E.P, O = E.O, t = E.t;
        var d = { inTower: !(O.r > P.a * 1.0005), tMid: C.dayStart(O, t, P) };
        if (d.inTower) return d;
        // ③ 巨塔：两条切边。塔是贯通两极的圆柱，从此地看，它的轮廓是两条平行于塔轴的直线（过水平面上的两个切点）
        var pr = O.r, ux = -O.x / pr, uz = -O.z / pr, g = Math.asin(P.a / pr), Lt = Math.sqrt(pr * pr - P.a * P.a);
        var yb = Math.sqrt(P.R * P.R - P.a * P.a), th0 = Math.atan((-yb - O.y) / Lt), th1 = Math.atan((yb - O.y) / Lt), NE = 96;
        d.edges = [1, -1].map(function (sg) {
          var c = Math.cos(sg * g), s = Math.sin(sg * g), dx = ux * c - uz * s, dz = ux * s + uz * c, pts = [];
          for (var i = 0; i <= NE; i++) {
            var th = th0 + (th1 - th0) * i / NE;
            pts.push(C.skyOf(O, [Lt * dx, Lt * Math.tan(th), Lt * dz]));
          }
          return pts;
        });
        d.tv = A.towerView(O, P);
        d.root = C.skyPt(d.tv.rootEl, 0);
        d.top = C.skyPt(d.tv.topEl, 180);
        // ② 地面切面：方位 a 上切面的仰角 e(a)；只画 e>0 的那一片（向上坡那侧）
        var nU = O.n[0] * O.U[0] + O.n[1] * O.U[1] + O.n[2] * O.U[2];
        var nN = O.n[0] * O.N[0] + O.n[1] * O.N[1] + O.n[2] * O.N[2];
        var nE = O.n[0] * O.E[0] + O.n[1] * O.E[1] + O.n[2] * O.E[2];
        var aC = Math.atan2(-nE, -nN), eMax = Math.atan(Math.sqrt(nN * nN + nE * nE) / Math.max(1e-9, nU)) / D2R;
        d.ground = null;
        if (eMax > 0.3) {
          var gb = [], NG = 72;
          for (var j = 0; j <= NG; j++) {
            var a = aC - Math.PI / 2 + Math.PI * j / NG;
            var e = Math.atan(-(nN * Math.cos(a) + nE * Math.sin(a)) / Math.max(1e-9, nU)) / D2R;
            gb.push({ inner: C.skyPt(Math.max(0, e), a / D2R), rim: C.skyPt(0, a / D2R) });
          }
          // 标签放在偏东 40° 处（正北方向上压着塔身）
          var aL = aC + 40 * D2R, eL = Math.atan(-(nN * Math.cos(aL) + nE * Math.sin(aL)) / Math.max(1e-9, nU)) / D2R;
          d.ground = { pts: gb, label: C.skyPt(Math.max(0, eL) * 0.5, aL / D2R), eMax: eMax };
        }
        // ④ 太阳今日路径（位置取 HY.astro；五段取 HY.calc.dayStats，计算层还是桩时退回 HY.astro.sunAspect）
        var ds = HY.model.cached('dayStats', [d.tMid.toFixed(6)], function () { return HY.calc.dayStats(O, d.tMid, P); });
        var useSegs = !C.isStub(['dayStats']) && ds && ds.segs && ds.segs.length;
        var n = 288, sx = new Float32Array(n), sy = new Float32Array(n), se = new Float32Array(n), sk = new Uint8Array(n);
        for (var i = 0; i < n; i++) {
          var ti = d.tMid + i / n, lk = A.look(O, A.sunPos(ti, P), P), p = C.skyPt(lk.el, lk.az);
          sx[i] = p.x; sy[i] = p.y; se[i] = lk.el; sk[i] = KINDS.indexOf(segKindAt(ds, O, ti, P, useSegs));
        }
        d.sun = { x: sx, y: sy, el: se, kind: sk, n: n };
        // ⑤ 今夜 18–6 时的月路径（每 10 分）
        var hNow = A.localHour(t, O, P), tN = d.tMid + (hNow >= 12 ? 18 : -6) / P.dayHours, nm = 73;
        var mx = new Float32Array(nm), my = new Float32Array(nm), me = new Float32Array(nm), ms = new Uint8Array(nm), mv = new Float32Array(nm);
        for (var k = 0; k < nm; k++) {
          var tk = tN + k * (12 / P.dayHours) / (nm - 1), Mo = A.moonPos(tk, P), lm = A.look(O, Mo, P), f = A.sunlitAt(Mo, tk, P), q = C.skyPt(lm.el, lm.az);
          mx[k] = q.x; my[k] = q.y; me[k] = lm.el; mv[k] = lm.vis; ms[k] = f >= 0.97 ? 0 : f > 0.03 ? 1 : 2;
        }
        d.moon = { x: mx, y: my, el: me, state: ms, vis: mv, n: nm, t0: tN };
        return d;
      },

      draw: function (ctx, w, h, d, hover, E) {
        var pal = E.pal, cx = w / 2, cy = h / 2, Rp = Math.max(12, Math.min(w, h) / 2 - 18), O = E.O, P = E.P, t = E.t, A = HY.astro, now = E.now;
        var lay = { cx: cx, cy: cy, Rp: Rp, sun: null, moon: null, root: null, top: null };
        function X(p) { return cx + p.x * Rp; }
        function Y(p) { return cy + p.y * Rp; }
        if (d.inTower) {
          ctx.font = C.font(12, false);
          C.label(ctx, '此地在塔基里：头顶就是塔身', cx, cy, pal.muted, { align: 'center', halo: false });
          return lay;
        }
        // ① 底图
        refreshMap(E);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, TAU); ctx.clip();
        ctx.fillStyle = pal['sky-night']; ctx.fillRect(cx - Rp, cy - Rp, 2 * Rp, 2 * Rp);
        paintMap(ctx, cx - Rp, cy - Rp, 2 * Rp, pal);
        // ② 平均坡面以下：斜线淡影
        if (d.ground) {
          var gp = d.ground.pts;
          ctx.save();
          ctx.beginPath();
          gp.forEach(function (q, i) { if (i) ctx.lineTo(X(q.inner), Y(q.inner)); else ctx.moveTo(X(q.inner), Y(q.inner)); });
          for (var i = gp.length - 1; i >= 0; i--) ctx.lineTo(X(gp[i].rim), Y(gp[i].rim));
          ctx.closePath();
          ctx.fillStyle = C.rgba(pal.bg, 0.45); ctx.fill();
          ctx.clip();
          ctx.beginPath();
          for (var s = -2 * Rp; s < 2 * Rp; s += 5) { ctx.moveTo(cx + s - Rp, cy + Rp); ctx.lineTo(cx + s + Rp, cy - Rp); }
          ctx.strokeStyle = C.rgba(pal.fg, 0.16); ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
          C.polyline(ctx, gp.length, function (i) { return [X(gp[i].inner), Y(gp[i].inner)]; }, C.rgba(pal.fg, 0.35), 1);
          if (d.ground.eMax > 4) {
            ctx.font = C.font(9, false);
            var gl = d.ground.label;
            C.label(ctx, '平均坡面以下', X(gl), Y(gl) + 3, C.rgba(pal.fg, 0.75), { align: 'center' });
          }
        }
        // ③ 巨塔
        var e0 = d.edges[0], e1 = d.edges[1];
        ctx.beginPath();
        e0.forEach(function (q, i) { if (i) ctx.lineTo(X(q), Y(q)); else ctx.moveTo(X(q), Y(q)); });
        for (var j = e1.length - 1; j >= 0; j--) ctx.lineTo(X(e1[j]), Y(e1[j]));
        ctx.closePath();
        ctx.fillStyle = pal['z-tower']; ctx.fill();
        [e0, e1].forEach(function (e) { C.polyline(ctx, e.length, function (i) { return [X(e[i]), Y(e[i])]; }, C.rgba(pal.line2, 0.9), 0.8); });
        ctx.restore();
        // ⑥ 仰角圈与边缘
        ctx.lineWidth = 1;
        [30, 60].forEach(function (el) {
          ctx.beginPath(); ctx.arc(cx, cy, (90 - el) / 90 * Rp, 0, TAU);
          ctx.strokeStyle = C.rgba(pal.fg, 0.13); ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
          var r = (90 - el) / 90 * Rp;
          ctx.font = C.font(9, true);
          C.label(ctx, el + '°', cx + r * 0.7071 + 2, cy - r * 0.7071 - 2, C.rgba(pal.fg, 0.45), { halo: false });
        });
        ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, TAU); ctx.strokeStyle = pal.line2; ctx.lineWidth = 1; ctx.stroke();
        C.dot(ctx, cx, cy, 1.2, C.rgba(pal.fg, 0.5));
        // ④ 太阳今日路径
        var sp = d.sun, segCol = [pal.segBehind, pal.segCut, pal.segBeside, pal.segFront];
        for (var i2 = 0; i2 < sp.n; i2++) {
          if (sp.el[i2] < -1) continue;
          var kk = sp.kind[i2] < 0 || sp.kind[i2] > 3 ? 0 : sp.kind[i2];
          ctx.fillStyle = segCol[kk];
          var rr = kk === 0 ? 0.8 : 1.25;
          ctx.fillRect(cx + sp.x[i2] * Rp - rr, cy + sp.y[i2] * Rp - rr, 2 * rr, 2 * rr);
        }
        // ⑤ 今夜月路径
        var mp = d.moon, mcol = [pal.moon, pal['moon-grey'], C.mix(pal['moon-black'], pal.fg, 0.3)], first = -1, last = -1;
        for (var k = 0; k < mp.n; k++) {
          if (mp.el[k] < -1) continue;
          if (first < 0) first = k; last = k;
          ctx.globalAlpha = mp.vis[k] < 0.5 ? 0.3 : 0.85;
          C.dot(ctx, cx + mp.x[k] * Rp, cy + mp.y[k] * Rp, mp.state[k] === 2 ? 1.0 : 1.2, mcol[mp.state[k]]);
        }
        ctx.globalAlpha = 1;
        ctx.font = C.font(9, false);
        var hourTags = [];                 // 月轨两端的钟点字（后面的标签要避开它们）
        if (first >= 0) hourTags.push(['18时', cx + mp.x[first] * Rp + 3, cy + mp.y[first] * Rp - 3]);
        if (last > first) hourTags.push(['6时', cx + mp.x[last] * Rp + 3, cy + mp.y[last] * Rp - 3]);
        hourTags.forEach(function (q) { C.label(ctx, q[0], q[1], q[2], pal.muted, {}); q.push(ctx.measureText(q[0]).width); });
        // ③ 塔两端（文字等日月画完再标，好避开它们）
        var rx = X(d.root), ry = Y(d.root), tx = X(d.top), ty = Y(d.top);
        C.dot(ctx, rx, ry, 2, pal.fg); C.dot(ctx, tx, ty, 2, pal.fg);
        lay.root = { x: rx, y: ry, el: d.tv.rootEl, az: 0 }; lay.top = { x: tx, y: ty, el: d.tv.topEl, az: 180 };
        // ④ 此刻的太阳：按露出比例被直边切掉的圆
        var S = A.sunPos(t, P), sv = [S.x - O.x, S.y - O.y, S.z - O.z], ps = C.skyPt(now.sun.el, now.sun.az);
        var px = X(ps), py = Y(ps), rs = 5.5, vis = now.sun.vis;
        if (ps.rho > 1.04) { px = cx + (px - cx) / ps.rho * 1.04; py = cy + (py - cy) / ps.rho * 1.04; }
        lay.sun = { x: px, y: py, el: now.sun.el, az: now.sun.az };
        if (!(vis > 0.001)) {
          ctx.beginPath(); ctx.arc(px, py, rs, 0, TAU);
          ctx.setLineDash([2, 2]); ctx.strokeStyle = pal.sun; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        } else {
          if (ctx.createRadialGradient) {
            var gr = ctx.createRadialGradient(px, py, 0, px, py, 18 + 6 * vis);
            gr.addColorStop(0, C.rgba(pal.sun, 0.75 * vis)); gr.addColorStop(0.35, C.rgba(pal.sun, 0.25 * vis)); gr.addColorStop(1, C.rgba(pal.sun, 0));
            ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, 18 + 6 * vis, 0, TAU); ctx.fill();
          }
          ctx.save();
          if (vis < 0.999) {
            // 塔缘是平行于塔轴的直线：切口方向＝塔轴在图上的方向，被挡的一侧朝塔的中线
            var at = C.skyAngle(O, sv, [0, 1, 0]), ex = Math.cos(at), ey = Math.sin(at), nx = -ey, ny = ex;
            var qc = C.skyOf(O, [-O.x, S.y - O.y, -O.z]);
            if ((X(qc) - px) * nx + (Y(qc) - py) * ny < 0) { nx = -nx; ny = -ny; }
            var xo = C.cutOffset(vis) * rs, bx = px + xo * nx, by = py + xo * ny;
            ctx.beginPath();
            ctx.moveTo(bx + 3 * rs * ex, by + 3 * rs * ey); ctx.lineTo(bx - 3 * rs * ex, by - 3 * rs * ey);
            ctx.lineTo(bx - 3 * rs * ex - 4 * rs * nx, by - 3 * rs * ey - 4 * rs * ny); ctx.lineTo(bx + 3 * rs * ex - 4 * rs * nx, by + 3 * rs * ey - 4 * rs * ny);
            ctx.closePath(); ctx.clip();
            lay.sun.cut = { x: bx, y: by, ex: ex, ey: ey, nx: nx, ny: ny, xo: xo / rs };
          }
          ctx.beginPath(); ctx.arc(px, py, rs, 0, TAU); ctx.fillStyle = C.mix(pal.sun, '#ffffff', 0.6); ctx.fill();
          ctx.restore();
          if (vis < 0.999) {
            var c2 = lay.sun.cut;
            ctx.beginPath(); ctx.moveTo(c2.x + rs * 1.3 * c2.ex, c2.y + rs * 1.3 * c2.ey); ctx.lineTo(c2.x - rs * 1.3 * c2.ex, c2.y - rs * 1.3 * c2.ey);
            ctx.strokeStyle = pal.segCut; ctx.lineWidth = 1; ctx.stroke();
          }
        }
        // ⑤ 此刻的月
        var ml = C.moonLook(O, t, P), pm = C.skyPt(ml.el, ml.az), mxp = X(pm), myp = Y(pm), rm = 6.5, below = pm.rho > 1.04;
        if (below) { mxp = cx + (mxp - cx) / pm.rho * 1.04; myp = cy + (myp - cy) / pm.rho * 1.04; }
        lay.moon = { x: mxp, y: myp, el: ml.el, az: ml.az, ml: ml };
        if (below) {
          ctx.beginPath(); ctx.arc(mxp, myp, 3.5, 0, TAU); ctx.strokeStyle = pal.moon; ctx.lineWidth = 1; ctx.stroke();
        } else C.drawMoon(ctx, mxp, myp, rm, ml, { alpha: ml.vis < 0.5 ? 0.35 : 1 });
        var mtxt = ml.state === '亮月' ? '亮月 ' + Math.round(ml.k * 100) + '%' : ml.state;
        // 黑月高悬的口径是月心受照 ≤10%（01 第十一节），灰月的尾巴也算，所以只看 blackHigh、不看月态
        if (now.moon.blackHigh) mtxt += ' · 高悬';
        if (ml.vis < 0.5 && !below) mtxt += '（塔后）';
        if (below) mtxt = '月在重力水平以下';
        ctx.font = C.font(10, false);
        var right = mxp > cx + Rp * 0.45, mw = ctx.measureText(mtxt).width;
        // 月的字压到月轨两端的钟点字就换到另一边
        var mr = right ? [mxp - 10 - mw, myp - 7, mxp - 10, myp + 5] : [mxp + 10, myp - 7, mxp + 10 + mw, myp + 5];
        if (hourTags.some(function (q) { return mr[0] < q[1] + q[3] && mr[2] > q[1] && mr[1] < q[2] + 2 && mr[3] > q[2] - 9; })) right = !right;
        C.label(ctx, mtxt, mxp + (right ? -10 : 10), myp + 4, pal.moon, { align: right ? 'right' : 'left' });
        // 已占的地方：日、月本体与月的文字、月轨两端的钟点字、今夜月轨（每隔几点取一个小方块）
        var busy = [[px - 8, py - 8, px + 8, py + 8], [mxp - 8, myp - 8, mxp + 8, myp + 8],
          right ? [mxp - 10 - mw, myp - 7, mxp - 10, myp + 5] : [mxp + 10, myp - 7, mxp + 10 + mw, myp + 5]];
        hourTags.forEach(function (q) { busy.push([q[1] - 1, q[2] - 9, q[1] + q[3] + 1, q[2] + 2]); });
        for (var kb = 0; kb < mp.n; kb += 3) {
          if (mp.el[kb] < -1) continue;
          var bx0 = cx + mp.x[kb] * Rp, by0 = cy + mp.y[kb] * Rp;
          busy.push([bx0 - 2, by0 - 2, bx0 + 2, by0 + 2]);
        }
        function free(x0, y0, x1, y1) {
          for (var i = 0; i < busy.length; i++) { var q = busy[i]; if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return false; }
          return true;
        }
        // ③ 塔两端、塔宽的文字：依次试点的右、左、上、下，取第一个不压日月、月轨与钟点字的
        ctx.font = C.font(10, false);
        [['塔根 ' + C.num(d.tv.rootEl, 0) + '°', rx, ry], ['塔顶 ' + C.num(d.tv.topEl, 0) + '°', tx, ty]].forEach(function (it) {
          var tw = ctx.measureText(it[0]).width, x = it[1], y = it[2];
          var cands = [[x + 5, y + 4, 'left', [x + 5, y - 6, x + 5 + tw, y + 5]], [x - 5, y + 4, 'right', [x - 5 - tw, y - 6, x - 5, y + 5]],
            [x, y - 6, 'center', [x - tw / 2, y - 16, x + tw / 2, y - 5]], [x, y + 15, 'center', [x - tw / 2, y + 4, x + tw / 2, y + 16]]];
          var pick = cands[0];
          for (var ci = 0; ci < cands.length; ci++) { var r4 = cands[ci][3]; if (free(r4[0], r4[1], r4[2], r4[3])) { pick = cands[ci]; break; } }
          C.label(ctx, it[0], pick[0], pick[1], pal.fg, { align: pick[2] });
          busy.push(pick[3]);
        });
        var hw = d.tv.width / 2 / 90 * Rp, wtxt = '塔宽 ' + C.num(d.tv.width, 1) + '°', ww = ctx.measureText(wtxt).width;
        var wx = cx + Math.min(hw, Rp * 0.6) + 5, wl = free(wx, cy - 13, wx + ww, cy - 1);
        if (!wl) wx = cx - Math.min(hw, Rp * 0.6) - 5;
        C.label(ctx, wtxt, wx, cy - 3, pal.muted, { align: wl ? 'left' : 'right' });
        // 方位与说明
        ctx.font = C.font(10, false);
        C.label(ctx, '北 · 塔根', cx, cy - Rp - 6, pal.muted, { align: 'center', halo: false });
        C.label(ctx, '南 · 塔顶', cx, cy + Rp + 13, pal.muted, { align: 'center', halo: false });
        C.label(ctx, '东', cx - Rp - 4, cy + 4, pal.muted, { align: 'right', halo: false });
        C.label(ctx, '西', cx + Rp + 4, cy + 4, pal.muted, { align: 'left', halo: false });
        ctx.font = C.font(9, false);
        // 日月画得比实际大：写明实际视径，免得以为话没说完
        // 放在左下角、分两行（窄图上一行写不下，放顶上会压住“北 · 塔根”）；底边正中是“南 · 塔顶”，两行都短，碰不到
        C.label(ctx, '日月画大了', 3, h - 15, pal.muted, { halo: false });
        C.label(ctx, '实为日 ' + C.num(now.sun.diam, 2) + '°、月 ' + C.num(now.moon.diam, 1) + '°', 3, h - 3, pal.muted, { halo: false });
        C.label(ctx, '仰望 · 东在左', 3, 10, pal.muted, { halo: false });
        // 悬停
        if (hover) {
          var hx = (hover.x - cx) / Rp, hy = (hover.y - cy) / Rp;
          if (hx * hx + hy * hy <= 1.0) {
            ctx.beginPath(); ctx.arc(hover.x, hover.y, 6, 0, TAU);
            ctx.strokeStyle = C.rgba(pal.fg, 0.6); ctx.lineWidth = 1; ctx.stroke();
          }
        }
        return lay;
      },

      tip: function (d, hv, lay, E) {
        if (!lay || d.inTower) return null;
        var hit = nearest(lay, hv), A = HY.astro, O = E.O, P = E.P, now = E.now, fp = isFp(), out;
        var hint = fp ? '点击：转头看过去' : '';
        if (hit === 'sun') {
          out = ['太阳', '仰角 ' + C.num(now.sun.el, 1) + '° · ' + HY.calc.dirName(now.sun.az),
            C.SEG_NAME(now.sun.aspect, now.sun.side) + ' · 露出 ' + Math.round(now.sun.vis * 100) + '%'];
        } else if (hit === 'moon') {
          var ml = lay.moon.ml;
          out = ['月 · ' + ml.state + (ml.state === '亮月' ? ' ' + Math.round(ml.k * 100) + '%' : ''),
            '仰角 ' + C.num(ml.el, 1) + '° · ' + HY.calc.dirName(ml.az) + ' · 视径 ' + C.num(ml.diam, 2) + '°',
            ml.vis < 0.5 ? '被塔挡住' : (now.moon.blackHigh ? '黑月高悬' : '')];
        } else if (hit === 'root' || hit === 'top') {
          out = [hit === 'root' ? '塔根端（北）' : '塔顶端（南）', '塔身与地面相接处仰角 ' + C.num(lay[hit].el, 1) + '°', '头顶塔宽 ' + C.num(d.tv.width, 1) + '°'];
        } else {
          var x = (hv.x - lay.cx) / lay.Rp, y = (hv.y - lay.cy) / lay.Rp, rho = Math.sqrt(x * x + y * y);
          if (rho > 1.03) return null;
          var el = (1 - rho) * 90, az = Math.atan2(-x, -y) / D2R; if (az < 0) az += 360;
          var dir = C.skyDir(O, x, y, dirTmp), what;
          var below = O.n[0] * dir[0] + O.n[1] * dir[1] + O.n[2] * dir[2] < 0;
          var r = A.rayHit(O, dir, P);
          if (below) what = '平均坡面以下（看见的是本地地面）';
          else if (r.kind === 'tower') what = '巨塔';
          else {
            var f = A.sunlitAt(r.X, E.t, P);
            what = '对面内壁 · ' + (f >= 0.5 ? '昼' : f > 0.02 ? '晨昏' : '夜') + (f >= 0.5 && now.night ? '（此地是夜：白夜）' : '');
          }
          out = ['仰角 ' + C.num(el, 0) + '° · ' + HY.calc.dirName(az), '视线落在：' + what];
        }
        if (hint) out.push(hint);
        return out;
      },
      canPick: function () { return isFp(); },
      pick: function (d, pt, lay, E) {
        if (!lay || d.inTower || !E || !isFp()) return null;
        var hit = nearest(lay, pt), el, az;
        if (hit) { el = lay[hit].el; az = lay[hit].az; }
        else {
          var x = (pt.x - lay.cx) / lay.Rp, y = (pt.y - lay.cy) / lay.Rp, rho = Math.sqrt(x * x + y * y);
          if (rho > 1.03) return null;
          el = (1 - rho) * 90; az = Math.atan2(-x, -y) / D2R;
        }
        az = ((az + 180) % 360 + 360) % 360 - 180;
        return { yaw: az, pitch: C.clamp(el, -89, 89), look: [az, C.clamp(el, -89, 89)], target: hit || 'sky' };
      },
      aria: function (d, E) {
        if (d.inTower) return '天空图：此地在塔基里';
        var n = E.now;
        return '天空图：太阳仰角 ' + C.num(n.sun.el, 0) + ' 度，' + C.SEG_NAME(n.sun.aspect, n.sun.side) + '；月为' + n.moon.state +
          '，仰角 ' + C.num(n.moon.el, 0) + ' 度；头顶塔宽 ' + C.num(d.tv.width, 1) + ' 度';
      },
      listen: function (ch) {
        return [HY.bus.on('view', function () { ch.update('model'); })];
      }
    };

    // 第一人称时才转头：读此刻的视图（不用上次画图时记下的）
    function isFp() { return !!(HY.state && HY.state.view && HY.state.view.mode === 'fp'); }
    function nearest(lay, p) {
      var best = null, bd = 11 * 11;
      ['sun', 'moon', 'root', 'top'].forEach(function (k) {
        var q = lay[k]; if (!q) return;
        var dd = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
        if (dd < bd) { bd = dd; best = k; }
      });
      return best;
    }

    // ① 底图：每格一条射线（HY.astro.rayHit）；撞塔记 −1，撞内壁记该点日面露出比例（HY.astro.sunlitAt），圆外记 NaN
    function refreshMap(E) {
      var key = HY.model.pv + '|' + HY.model.siteKey(), t = E.t, now = Date.now();
      var stale = key !== map.key || !(Math.abs(t - map.t) < 0.02) || (t !== map.t && now - map.at >= 1000);
      if (!stale) return;
      var A = HY.astro, O = E.O, P = E.P, v = map.vals, tw = map.tw, dir = dirTmp, lit = 0;
      function ray(x, y) {                      // → [塔 1／内壁 0, 内壁上的日面露出]
        C.skyDir(O, x, y, dir);
        var r = A.rayHit(O, dir, P);
        return r.kind === 'tower' ? [1, 0] : [0, A.sunlitAt(r.X, t, P)];
      }
      for (var j = 0; j < MAPN; j++) {
        var y = (j + 0.5) / MAPN * 2 - 1;
        for (var i = 0; i < MAPN; i++) {
          var x = (i + 0.5) / MAPN * 2 - 1, idx = j * MAPN + i;
          if (x * x + y * y > 1.2) { v[idx] = NaN; tw[idx] = 0; continue; }
          var q = ray(x, y);
          tw[idx] = q[0]; v[idx] = q[1];
          if (!q[0] && q[1] >= 0.5) lit++;
        }
      }
      // 昼夜交界、塔边上的格子再按 3×3 细分取平均（60 格放大到两三百像素，单条射线一格会成锯齿）
      var edge = [];
      for (var j2 = 0; j2 < MAPN; j2++) for (var i2 = 0; i2 < MAPN; i2++) {
        var k = j2 * MAPN + i2, a = v[k];
        if (a !== a) continue;
        var nb = [[i2 + 1, j2], [i2, j2 + 1], [i2 - 1, j2], [i2, j2 - 1]];
        for (var n = 0; n < 4; n++) {
          var ii = nb[n][0], jj = nb[n][1];
          if (ii < 0 || jj < 0 || ii >= MAPN || jj >= MAPN) continue;
          var kb = jj * MAPN + ii, b = v[kb];
          if (b === b && (Math.abs(a - b) > 0.2 || tw[k] !== tw[kb])) { edge.push(k); break; }
        }
      }
      var cs = 2 / MAPN;
      edge.forEach(function (k) {
        var i3 = k % MAPN, j3 = (k - i3) / MAPN, sT = 0, sL = 0, nW = 0;
        for (var b2 = 0; b2 < 3; b2++) for (var a2 = 0; a2 < 3; a2++) {
          var q2 = ray((i3 + (a2 + 0.5) / 3) * cs - 1, (j3 + (b2 + 0.5) / 3) * cs - 1);
          sT += q2[0]; if (!q2[0]) { sL += q2[1]; nW++; }
        }
        tw[k] = sT / 9; v[k] = nW ? sL / nW : 0;
      });
      map.key = key; map.t = t; map.at = now; map.lit = lit; map.ready = true;
      map.dirtyImg = true;
    }
    function paintMap(ctx, x0, y0, size, pal) {
      if (!map.ready) return;
      var day = C.rgb(pal['sky-day']), ngt = C.rgb(pal['sky-night']), v = map.vals;
      if (!map.cv && map.cv !== false) map.cv = C.makeCanvas(MAPN, MAPN) || false;
      if (map.cv) {
        var g = map.cv.getContext('2d');
        if (map.dirtyImg || !map.img) {
          if (!map.img) map.img = g.createImageData(MAPN, MAPN);
          var px = map.img.data;
          for (var k = 0; k < MAPN * MAPN; k++) {
            var f = v[k], o = 4 * k, kw = 1 - map.tw[k];          // 塔占的比例按黑色混进去
            if (f !== f) { px[o + 3] = 0; continue; }
            px[o] = (ngt[0] + (day[0] - ngt[0]) * f) * kw; px[o + 1] = (ngt[1] + (day[1] - ngt[1]) * f) * kw; px[o + 2] = (ngt[2] + (day[2] - ngt[2]) * f) * kw; px[o + 3] = 255;
          }
          g.putImageData(map.img, 0, 0);
          map.dirtyImg = false;
        }
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(map.cv, x0, y0, size, size);
      } else {
        var cs = size / MAPN;
        for (var j = 0; j < MAPN; j++) for (var i = 0; i < MAPN; i++) {
          var f2 = v[j * MAPN + i];
          if (f2 !== f2) continue;
          ctx.fillStyle = map.tw[j * MAPN + i] > 0.5 ? '#000' : C.mix(pal['sky-night'], pal['sky-day'], f2);
          ctx.fillRect(x0 + i * cs, y0 + j * cs, cs + 0.5, cs + 0.5);
        }
      }
    }

    var ch = C.make('sky', canvas, impl, opts);
    ch.map = map;
    ch.refreshMap = refreshMap;
    return ch;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
