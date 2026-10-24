/* HY.charts —— 二维图表的公共部分：画布、配色、坐标轴、悬停、点选、可见性（规格：spec/03 第八节第 1 条）
 * 负责：C 路（图表）。
 *   HY.charts.create(kind, canvas, opts) → chart：{ update(reason), draw(), onPick(fn), destroy() }
 *   reason：'time'|'site'|'model'|'zones'|'resize'|'visible'；onPick 回调 fn({t} | {s} | {doy} | {hour} | {yaw, pitch})
 *   HY.charts.colors() 配色（CSS 变量，启动读一次）；HY.charts.prep(canvas) → {ctx, w, h}（DPR≤2）
 * 各图在自己的文件里 HY.charts.register(kind, factory)；factory(canvas, opts, base) → chart，一般用 base.make(kind, canvas, impl, opts)。
 * 数据一律来自 HY.calc（经 HY.model.cached 缓存）与 HY.astro；这里只做投影与画法，不另立日月公式。
 * 图表不改别人的状态：点选只写 time.t、site（src:'ui'），第一人称时天空图点选转给 HY.app.look。
 * 加载时不碰 DOM：DOM 只在 make() 里、而且先判断有没有。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var C = HY.charts = HY.charts || {};
  var REG = C._reg = C._reg || {};
  var TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;

  C.KINDS = ['sky', 'day', 'year', 'helix', 'meridian', 'month'];
  C.TITLES = { sky: '天空', day: '一日', year: '一年', helix: '日月高度', meridian: '子午线剖面', month: '本月月相' };

  C.register = function (kind, factory) { REG[kind] = factory; };

  function nowMs() { return HY.util && HY.util.now ? HY.util.now() : Date.now(); }

  /* ───────── 画布 ───────── */
  // DPR≤2 的尺寸校正 → {ctx, w, h}（w、h 为 CSS 像素）
  C.prep = function (canvas) {
    var dpr = Math.min(G.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || canvas.width || 300, h = canvas.clientHeight || canvas.height || 150;
    var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  };
  // 离屏画布（天空图底图用）；没有 document（node）时返回 null，调用方退回逐格 fillRect
  C.makeCanvas = function (w, h) {
    var d = G.document;
    if (!d || !d.createElement) return null;
    var c = d.createElement('canvas'); c.width = w; c.height = h;
    return c;
  };

  /* ───────── 配色（03 第九节第 8 条的变量；node 里或变量缺失时用同值的默认） ───────── */
  var DEF = {
    bg: '#0a0c11', stage: '#06070b', panel: '#0f1219', raise: '#171b25', line: '#242a37', line2: '#353d50',
    fg: '#ddd6c4', muted: '#938f7f', dim: '#64635c', warn: '#d9a441', bad: '#d0644b', ok: '#8fb07a',
    sun: '#f1b65a', 'sun-ink': '#1d1406', moon: '#c3cddd', 'moon-grey': '#7a8192', 'moon-black': '#2a2f3c',
    'sky-day': '#4b6189', 'sky-night': '#0c1121', night: '#86a3d0', winter: '#7493bd', summer: '#dba84a',
    'z-light': '#aac3d7', 'z-plain': '#97a26e', 'z-heavy': '#b0603f', 'z-limbo': '#6a5788', 'z-tower': '#000000',
    'f-body': '"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
    'f-mono': '"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace'
  };
  C.DEFAULT_COLORS = DEF;
  var colorCache = null, palCache = null;
  C.colors = function () {
    if (colorCache) return colorCache;
    var out = {}, cs = null;
    try { cs = G.document && G.getComputedStyle ? G.getComputedStyle(G.document.documentElement) : null; } catch (e) { cs = null; }
    Object.keys(DEF).forEach(function (n) {
      var v = cs ? String(cs.getPropertyValue('--' + n) || '').trim() : '';
      out[n] = v || DEF[n];
    });
    colorCache = out;
    return out;
  };
  // 颜色串 → [r, g, b]（0–255）；认 #rgb、#rrggbb、rgb()/rgba()
  function rgb(c) {
    c = String(c || '').trim();
    var m = /^rgba?\(([^)]*)\)/i.exec(c);
    if (m) { var p = m[1].split(',').map(parseFloat); return [p[0] || 0, p[1] || 0, p[2] || 0]; }
    var h = c.replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h.slice(0, 6), 16);
    if (!isFinite(n)) return [0, 0, 0];
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  C.rgb = rgb;
  C.rgba = function (c, a) { var v = rgb(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + (a == null ? 1 : a) + ')'; };
  C.mix = function (a, b, t) {
    var A = rgb(a), B = rgb(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  };
  // 配色＋图表专用的派生色（一日五段：塔后虚点、切入橙、贴缘金、衬塔亮）
  C.palette = function () {
    if (palCache) return palCache;
    var c = C.colors(), p = {};
    Object.keys(c).forEach(function (k) { p[k] = c[k]; });
    p.segBehind = C.rgba(c.sun, 0.32);
    p.segCut = C.mix(c.sun, c.bad, 0.5);
    p.segBeside = c.sun;
    p.segFront = C.mix(c.sun, '#ffffff', 0.55);
    p.dose = c.sun;
    p.noon = C.mix(c.sun, c.bad, 0.5);
    p.nightH = c.night;
    p.towerW = c.muted;
    p.hang = C.mix(c['z-limbo'], '#ffffff', 0.3);
    palCache = p;
    return p;
  };
  C.SEG_COLOR = { behind: 'segBehind', cut: 'segCut', beside: 'segBeside', front: 'segFront' };
  C.SEG_NAME = function (kind, side) {
    switch (kind) {
      case 'behind': return '塔后';
      case 'cut': return side === '西' ? '西缘切没' : '东缘切出';
      case 'beside': return side === '西' ? '贴西缘' : '贴东缘';
      case 'front': return '亮日衬黑塔';
      default: return kind || '';
    }
  };
  C.font = function (px, mono) { var c = C.colors(); return px + 'px ' + (mono ? c['f-mono'] : c['f-body']); };

  /* ───────── 小工具 ───────── */
  C.clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  C.fin = fin;
  // 好看的刻度步长
  C.niceStep = function (range, n) {
    var raw = Math.abs(range) / Math.max(1, n || 4), p = Math.pow(10, Math.floor(Math.log(raw || 1) / Math.LN10)), q = raw / p;
    return (q <= 1 ? 1 : q <= 2 ? 2 : q <= 2.5 ? 2.5 : q <= 5 ? 5 : 10) * p;
  };
  C.niceMax = function (v, n) { if (!(v > 0)) return 1; var s = C.niceStep(v, n || 4); return Math.ceil(v / s - 1e-9) * s; };
  C.num = function (v, d) {
    if (!fin(v)) return '—';
    var s = v.toFixed(d == null ? 0 : d);
    return (s.charAt(0) === '-' && +s !== 0) ? '−' + s.slice(1) : s.replace(/^-/, '');
  };
  C.thou = function (v) { return HY.util && HY.util.thousands ? HY.util.thousands(v, 0) : C.num(v, 0); };
  C.hours = function (h) { return fin(h) ? C.num(h, h < 10 ? 1 : 0) + ' 小时' : '—'; };
  C.minutesText = function (m) {
    if (!fin(m) || m <= 0) return '无';
    if (m < 60) return Math.round(m) + ' 分';
    return C.num(m / 60, 1) + ' 小时';
  };
  // 一条状态：算子名是不是还是桩（显示“示例数据”小字用）
  C.isStub = function (names) {
    var s = HY.calc && HY.calc.__stubs;
    if (!s || !s.length) return false;
    for (var i = 0; i < names.length; i++) if (s.indexOf(names[i]) >= 0) return true;
    return false;
  };

  /* ───────── 画法 ───────── */
  // 带描边光晕的文字（压在曲线上也看得清）
  C.label = function (ctx, s, x, y, color, opt) {
    opt = opt || {};
    if (opt.font) ctx.font = opt.font;
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = opt.base || 'alphabetic';
    if (opt.halo !== false) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = opt.halo || C.rgba(C.colors().panel, 0.85);
      ctx.lineWidth = 3;
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  C.vline = function (ctx, x, y0, y1, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  };
  C.hline = function (ctx, x0, x1, y, color, w, dash) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  };
  // 折线：pts 是函数 i → [x, y] 或 null（断开）
  C.polyline = function (ctx, n, f, color, w, dash) {
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i < n; i++) {
      var p = f(i);
      if (!p || !fin(p[0]) || !fin(p[1])) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.strokeStyle = color; ctx.lineWidth = w || 1.5; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  };
  C.dot = function (ctx, x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  C.star = function (ctx, x, y, r, fill) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  // 悬停十字线（限在绘图区内）
  C.crosshair = function (ctx, area, x, y) {
    if (!area || x < area.x0 || x > area.x1) return;
    var c = C.rgba(C.colors().fg, 0.35);
    C.vline(ctx, x + 0.5, area.y0, area.y1, c, 1, [2, 2]);
    if (y != null && y >= area.y0 && y <= area.y1) C.hline(ctx, area.x0, area.x1, y + 0.5, c, 1, [2, 2]);
  };

  /* 月盘（天空图、本月月相共用）
   * ml：C.moonLook 的结果 {k, sunlit, litAng, shade[], shadeAng, axisAng}；
   *   litAng＝屏幕上朝太阳的方向（弧度，x 右 y 下）；shade[i]＝月盘一条直径上等距 i 点的受照比例（灰月的直影边）。
   * 亮月：明暗界朝太阳；灰月：再叠一层顺塔边的影，影边（受照一半处）画一条直线；黑月：深灰盘＋细环。
   */
  C.drawMoon = function (ctx, cx, cy, r, ml, opt) {
    opt = opt || {};
    var pal = C.palette();
    ctx.save();
    if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
    var black = !(ml.sunlit > 0.03);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = pal['moon-black']; ctx.fill();
    if (!black && ml.k > 0.004) {
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(fin(ml.litAng) ? ml.litAng : 0);
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      var ex = Math.max(0.001, Math.abs(1 - 2 * ml.k) * r);
      ctx.ellipse(0, 0, ex, r, 0, Math.PI / 2, -Math.PI / 2, ml.k < 0.5);
      ctx.closePath();
      ctx.fillStyle = pal.moon; ctx.fill();
      ctx.restore();
      if (ml.sunlit < 0.97 && ml.shade && ml.shade.length > 1 && ctx.createLinearGradient) {
        var th = fin(ml.shadeAng) ? ml.shadeAng : 0, cs = Math.cos(th), sn = Math.sin(th), n = ml.shade.length;
        var g = ctx.createLinearGradient(cx - r * cs, cy - r * sn, cx + r * cs, cy + r * sn);
        var dk = rgb(pal['moon-black']);
        for (var i = 0; i < n; i++) {
          var a = C.clamp(1 - ml.shade[i], 0, 1) * 0.93;
          g.addColorStop(i / (n - 1), 'rgba(' + dk[0] + ',' + dk[1] + ',' + dk[2] + ',' + a.toFixed(3) + ')');
        }
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
        // 影边：受照一半处，顺塔边方向的一条直线
        for (var j = 0; j < n - 1; j++) {
          var f0 = ml.shade[j], f1 = ml.shade[j + 1];
          if ((f0 - 0.5) * (f1 - 0.5) > 0 || f0 === f1) continue;
          var s0 = -1 + 2 * j / (n - 1), s1 = -1 + 2 * (j + 1) / (n - 1), s = s0 + (0.5 - f0) / (f1 - f0) * (s1 - s0);
          var px = cx + s * r * cs, py = cy + s * r * sn;
          var ax = fin(ml.axisAng) ? Math.cos(ml.axisAng) : -sn, ay = fin(ml.axisAng) ? Math.sin(ml.axisAng) : cs;
          var bx = px - cx, by = py - cy, b = bx * ax + by * ay, cc = bx * bx + by * by - r * r, disc = b * b - cc;
          if (disc > 0) {
            var q = Math.sqrt(disc), u0 = -b - q, u1 = -b + q;
            ctx.beginPath(); ctx.moveTo(px + u0 * ax, py + u0 * ay); ctx.lineTo(px + u1 * ax, py + u1 * ay);
            ctx.strokeStyle = C.rgba(pal.fg, 0.75); ctx.lineWidth = 1; ctx.stroke();
          }
          break;
        }
      }
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = black ? pal['moon-grey'] : C.rgba(pal.line2, 0.9);
    ctx.lineWidth = black ? 1.1 : 0.8; ctx.stroke();
    ctx.restore();
  };

  /* ───────── 天空投影（以重力“上”为中心的等距方位投影；北上、仰望所以东在左） ─────────
   * 单位圆坐标：x 向右、y 向下；ρ＝(90°−仰角)/90°，边缘 ρ＝1 是重力水平。
   * 这里只是坐标变换（用地点的 U/N/E 基），不是日月公式；日月的位置一律取 HY.astro。
   */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  C.skyPt = function (el, az) {
    var rho = (90 - el) / 90, a = az * D2R;
    return { x: -rho * Math.sin(a), y: -rho * Math.cos(a), rho: rho, el: el, az: az };
  };
  // 方向向量 v（世界系，地固）→ 仰角、方位、单位圆坐标
  C.skyOf = function (O, v) {
    var L = Math.sqrt(dot(v, v)) || 1;
    var el = Math.asin(C.clamp(dot(O.U, v) / L, -1, 1)) * R2D;
    var az = Math.atan2(dot(O.E, v), dot(O.N, v)) * R2D; if (az < 0) az += 360;
    return C.skyPt(el, az);
  };
  // 单位圆坐标 → 世界系单位方向
  C.skyDir = function (O, x, y, out) {
    var rho = Math.sqrt(x * x + y * y), el = (1 - rho) * Math.PI / 2, az = Math.atan2(-x, -y);
    var ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az), sa = Math.sin(az);
    out = out || [0, 0, 0];
    for (var i = 0; i < 3; i++) out[i] = ce * (ca * O.N[i] + sa * O.E[i]) + se * O.U[i];
    return out;
  };
  // 天上 v 处、沿世界方向 w 挪一点，在图上朝哪个方向（屏幕角，弧度）
  C.skyAngle = function (O, v, w) {
    var L = Math.sqrt(dot(v, v)) || 1, wl = Math.sqrt(dot(w, w)) || 1, e = 1e-3 * L / wl;
    var p1 = C.skyOf(O, v), p2 = C.skyOf(O, [v[0] + e * w[0], v[1] + e * w[1], v[2] + e * w[2]]);
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  };

  // 此刻（或 t 时）月盘的样子：全部取 HY.astro（位置、受照、亮面、露出比例），这里只换算成图上的方向
  C.moonLook = function (O, t, P, nShade) {
    var A = HY.astro, S = A.sunPos(t, P), Mo = A.moonPos(t, P), lk = A.look(O, Mo, P);
    var sunlit = A.sunlitAt(Mo, t, P), k = A.litFraction(O, S, Mo), v = lk.v;
    var res = { t: t, el: lk.el, az: lk.az, vis: lk.vis, diam: lk.diam, k: k, sunlit: sunlit,
      state: sunlit >= 0.97 ? '亮月' : sunlit > 0.03 ? '灰月' : '黑月', litAng: 0, shadeAng: 0, axisAng: Math.PI / 2, shade: null };
    res.litAng = C.skyAngle(O, v, [S.x - Mo.x, S.y - Mo.y, S.z - Mo.z]);
    res.axisAng = C.skyAngle(O, v, [0, 1, 0]);
    // 影边与塔轴平行：取月盘上垂直于视线、又垂直于塔轴方向的一条直径来采样受照比例
    var vl = Math.sqrt(dot(v, v)) || 1, vh = [v[0] / vl, v[1] / vl, v[2] / vl];
    var h = [-(S.z - Mo.z), 0, S.x - Mo.x], d = dot(h, vh);
    h = [h[0] - d * vh[0], h[1] - d * vh[1], h[2] - d * vh[2]];
    var hl = Math.sqrt(dot(h, h));
    if (hl > 1e-9 && sunlit < 0.999 && sunlit > 0) {
      h = [h[0] / hl, h[1] / hl, h[2] / hl];
      var n = nShade || 9, sh = new Array(n), q = { x: 0, y: 0, z: 0 };
      for (var i = 0; i < n; i++) {
        var s = (-1 + 2 * i / (n - 1)) * P.rhoM;
        q.x = Mo.x + s * h[0]; q.y = Mo.y + s * h[1]; q.z = Mo.z + s * h[2];
        sh[i] = A.sunlitAt(q, t, P);
      }
      res.shade = sh;
      res.shadeAng = C.skyAngle(O, v, h);
    }
    return res;
  };

  // diskFrac 的反函数：露出比例 vis → 圆心到直边的有符号距离（以半径计，正＝在边外）
  C.cutOffset = function (vis) {
    var f = HY.astro.diskFrac, lo = -1, hi = 1;
    if (!(vis > 0)) return -1; if (vis >= 1) return 1;
    for (var i = 0; i < 40; i++) { var m = 0.5 * (lo + hi); if (f(m) < vis) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  };

  // 地方日的子夜（当地 0 时）：与 HY.calc 的当地日同一换算
  C.dayStart = function (O, t, P) {
    var Cc = HY.calc;
    if (Cc && Cc.localDay && Cc.localMidnight) return Cc.localMidnight(Cc.localDay(t + 1e-9, O.az, P), O.az, P);
    return t - HY.astro.localHour(t, O, P) / P.dayHours;
  };

  /* ───────── 历法文字（叫法只在 HY.world.CAL / fmtCal 一处） ───────── */
  C.calText = function (c, form) { return HY.world && HY.world.fmtCal ? HY.world.fmtCal(c, form) : ''; };
  // 横轴刻度：放得下就写“入冬后第 X 日”，放不下换短式，再不行只写数字
  C.wdLabel = function (ctx, wd, room) {
    var a = C.calText({ wd: wd }, 'date');
    if (!room || ctx.measureText(a).width <= room) return a;
    var b = C.calText({ wd: wd }, 'chip');
    if (ctx.measureText(b).width <= room) return b;
    return String(wd);
  };
  // 某一天（t 落在其中）的历法文字：入冬后第 d 日 · 冬／夏第 n 日（· 月态第几夜，给了 moon 时）
  C.dayCal = function (t, O, P, moon) {
    var s = HY.calc.seasonOf(t, O, P), c = { wd: s.wd, season: s.season, seasonDay: s.n };
    if (moon) { c.moonState = moon.state; c.moonNight = moon.night; }
    return C.calText(c, 'full');
  };
  // 此刻的当地钟点（点选日期时保留它）：读此刻的状态，不用上次画图时记下的 E.t（节流期间那个可能已经过时）
  C.hourNow = function (E) {
    var t = HY.state && HY.state.time && C.fin(HY.state.time.t) ? HY.state.time.t : E.t;
    return HY.astro.localHour(t, E.O, E.P);
  };
  // 第 N 年（地方时 az）的横轴：doy → t、季节交界刻度；wd0（第 0 日是入冬后第几日）可由调用方给出
  C.yearAxis = function (N, P, az, wd0in) {
    var W = HY.world, span = W.yearSpan(N, P, az), wd0 = wd0in != null ? wd0in : HY.calc.civil(span[0] + 0.5, az, P).wd, Y = P.Y;
    function doyOfWd(wd) { var d = (wd - wd0) % Y; return d < 0 ? d + Y : d; }
    var ticks = [1, 1 + Y / 4, 1 + Y / 2, 1 + 3 * Y / 4].map(function (wd) { wd = Math.round(wd); return { wd: wd, doy: doyOfWd(wd) }; });
    ticks.sort(function (a, b) { return a.doy - b.doy; });
    return { N: N, t0: span[0], t1: span[1], Y: Y, wd0: wd0, doyOfWd: doyOfWd, wdOf: function (doy) { return (Math.floor(doy) + wd0 - 1) % Y + 1; }, ticks: ticks };
  };
  // 小刻度：从入冬起每 30 日一个（入冬后第 1、31、61… 日），换成本年的 doy。
  // 不从 doy 0 数：doy 0 是年号口径的岁首（默认口径下是旧民用历的“正月初一”），从那里每 30 日一个就成了旧历的月界。
  C.yearMinorTicks = function (ax) {
    var out = [];
    for (var k = 0; k < ax.Y; k += 30) out.push(ax.doyOfWd(1 + k));
    return out.sort(function (a, b) { return a - b; });
  };
  // 画横轴（一年图、日月高度图共用）：小刻度从入冬起每 30 日，大刻度在季节交界
  C.drawYearAxis = function (ctx, ax, x0, x1, y, pal) {
    var Y = ax.Y, X = function (d) { return x0 + d / Y * (x1 - x0); };
    ctx.strokeStyle = pal.line2; ctx.lineWidth = 1;
    ctx.beginPath();
    C.yearMinorTicks(ax).forEach(function (d) { var x = Math.round(X(d)) + 0.5; ctx.moveTo(x, y); ctx.lineTo(x, y + 3); });
    ctx.stroke();
    // 四个刻度用同一种写法：先排一遍——每个字以刻度为中心，靠边的推回画面里（不出 x0−6…x1+6）——再看相邻两段字
    //   之间至少隔 6 px；放不下就缩小字号、换短式，最后只写数字。原先只按“四等分、每格多宽”判断，靠边的刻度改成
    //   左对齐后整段往右伸，压住了第二个刻度（日月高度图的左边距更大，正好触发）
    function lay(form, size) {
      ctx.font = C.font(size, false);
      var out = ax.ticks.map(function (tk) {
        var x = X(tk.doy), s = form === 'num' ? String(tk.wd) : C.calText({ wd: tk.wd }, form), wv = ctx.measureText(s).width;
        var l = Math.max(x0 - 6, Math.min(x1 + 6 - wv, x - wv / 2));
        return { x: x, s: s, l: l, r: l + wv };
      });
      for (var i = 1; i < out.length; i++) if (out[i].l < out[i - 1].r + 6) return null;
      return out;
    }
    var forms = [['date', 10], ['date', 9], ['chip', 9], ['num', 9]], L = null, used = forms[3];
    for (var fi = 0; fi < forms.length && !L; fi++) { L = lay(forms[fi][0], forms[fi][1]); used = forms[fi]; }
    if (!L) { used = forms[3]; L = lay('num', 9) || ax.ticks.map(function (tk) { var x = X(tk.doy), w = ctx.measureText(String(tk.wd)).width; return { x: x, s: String(tk.wd), l: x - w / 2 }; }); }
    ctx.font = C.font(used[1], false);
    L.forEach(function (q) {
      C.vline(ctx, Math.round(q.x) + 0.5, y, y + 5, pal.muted, 1);
      C.label(ctx, q.s, q.l, y + 15, pal.muted, { align: 'left', halo: false });
    });
  };

  /* ───────── 悬停提示框（一个共用的浮层，第一次用时才建） ───────── */
  var tipEl = null, tipOwner = null;
  C.tip = {
    show: function (lines, clientX, clientY, owner) {
      var d = G.document;
      if (!d || !d.createElement || !d.body) return;
      if (!tipEl) {
        tipEl = d.createElement('div');
        tipEl.className = 'hy-chart-tip';
        tipEl.setAttribute('role', 'tooltip');
        var s = tipEl.style;
        s.position = 'fixed'; s.zIndex = '60'; s.pointerEvents = 'none'; s.whiteSpace = 'nowrap';
        s.background = 'var(--raise, #171b25)'; s.border = '1px solid var(--line2, #353d50)'; s.color = 'var(--fg, #ddd6c4)';
        s.font = '12px/1.5 var(--f-body, sans-serif)'; s.padding = '4px 8px'; s.borderRadius = '4px';
        s.boxShadow = '0 4px 14px rgba(0,0,0,.45)'; s.fontVariantNumeric = 'tabular-nums';
        d.body.appendChild(tipEl);
      }
      tipOwner = owner || null;
      tipEl.textContent = '';
      lines.forEach(function (ln, i) {
        if (!ln) return;
        var div = d.createElement('div');
        div.textContent = ln;
        if (i === 0) div.style.color = 'var(--sun, #f1b65a)';
        tipEl.appendChild(div);
      });
      tipEl.style.display = 'block';
      var vw = G.innerWidth || 1024, vh = G.innerHeight || 768;
      var r = tipEl.getBoundingClientRect ? tipEl.getBoundingClientRect() : { width: 160, height: 40 };
      var x = clientX + 14, y = clientY + 14;
      if (x + r.width > vw - 6) x = clientX - r.width - 12;
      if (y + r.height > vh - 6) y = clientY - r.height - 12;
      tipEl.style.left = Math.max(4, x) + 'px'; tipEl.style.top = Math.max(4, y) + 'px';
    },
    hide: function (owner) {
      if (!tipEl || (owner && tipOwner && owner !== tipOwner)) return;
      tipEl.style.display = 'none'; tipOwner = null;
    }
  };

  /* ───────── 图表外壳：可见性、数据缓存键、节流、悬停、点选、出错 ─────────
   * impl：{
   *   key(E) → 串（数据输入的键；变了才重算）     compute(E) → data
   *   draw(ctx, w, h, data, hover, E) → lay（画法与命中检测共用的版面）
   *   tip(data, hover, lay, E) → [行…]|null      pick(data, pt, lay, E) → {t?, s?, doy?, hour?, look?}|null
   *   aria(data, E) → 串    throttle：重算最短间隔 ms    stubs：用到的 HY.calc 函数名（桩时角落写“示例数据”）
   *   walkThrottle：第一人称里地点在变（步行）时的重算最短间隔 ms（03 第七节第 8 条：子午线、一年表节流 1 s）
   *   listen(ch) → [off…]（另外要听的事件） }
   * E（环境）：{ P, O, now, t, pal, view, w, h }
   */
  C.make = function (kind, canvas, impl, opts) {
    opts = opts || {};
    var ch = { kind: kind, canvas: canvas, dirty: true, data: null, key: null, hover: null, lay: null, env: null,
      stats: { computed: 0, drawn: 0, skipped: 0, ms: 0 } };
    var picks = [], offs = [], io = null, ioVis = null, timer = null, raf = 0, lastCompute = -1e12, errSeen = {}, ariaText = '';
    var fpSiteAt = -1e12;     // 第一人称里最近一次因地点变化而更新的时刻（步行节流用）
    var hasDom = !!(canvas && typeof canvas.addEventListener === 'function');

    function env() {
      var M = HY.model, now = M && M.tick ? M.tick() : (M && M.now);
      return { P: M && M.P, O: M && M.O, now: now, t: now ? now.t : (HY.state && HY.state.time.t),
        pal: C.palette(), view: HY.state && HY.state.view ? HY.state.view.mode : 'ov', w: 0, h: 0 };
    }

    ch.visible = function () {
      if (opts.alwaysVisible) return true;
      if (!canvas) return false;
      if (ioVis === false) return false;
      if (typeof canvas.getClientRects === 'function' && canvas.getClientRects().length === 0) return false;
      if (HY.state && HY.state.ui && HY.state.ui.chrome === false) return false;
      return true;
    };

    ch.update = function (reason) {
      ch.reason = reason;
      if (reason === 'site' && HY.state && HY.state.view && HY.state.view.mode === 'fp') fpSiteAt = nowMs();
      if (!ch.visible()) {
        ch.dirty = true; ch.stats.skipped++;
        // 悬停中被切走了页签（元素隐去时浏览器不一定补发 pointerleave）：收起提示框，免得它留在别的页签上
        if (ch.hover) { ch.hover = null; C.tip.hide(canvas); }
        return false;
      }
      ch.draw();
      return true;
    };

    function defer(ms) {
      if (timer) return;
      timer = setTimeout(function () { timer = null; if (ch.visible()) ch.draw(); else ch.dirty = true; }, Math.max(16, ms));
    }

    ch.draw = function () {
      if (!canvas || !canvas.getContext) return;
      var t0 = nowMs(), E = env();
      if (!E.P || !E.O || !E.now) return;
      var p = null;
      try {
        var k = impl.key(E);
        if (k !== ch.key || !ch.data) {
          var since = t0 - lastCompute, thr = impl.throttle || 0;
          // 第一人称步行中（1 秒内地点变过）：放宽到 walkThrottle；第一步照算，之后每秒至多一次
          if (impl.walkThrottle && E.view === 'fp' && t0 - fpSiteAt < impl.walkThrottle) thr = Math.max(thr, impl.walkThrottle);
          if (ch.data && thr && since < thr) defer(thr - since);
          else { ch.data = impl.compute(E); ch.key = k; lastCompute = nowMs(); ch.stats.computed++; }
        }
        p = C.prep(canvas);
        E.w = p.w; E.h = p.h; ch.env = E;
        p.ctx.clearRect(0, 0, p.w, p.h);
        p.ctx.save();
        ch.lay = impl.draw(p.ctx, p.w, p.h, ch.data, ch.hover, E) || null;
        p.ctx.restore();
        if (impl.stubs && C.isStub(impl.stubs)) {
          p.ctx.font = C.font(9, false);
          C.label(p.ctx, '示例数据（计算层准备中）', p.w - 3, p.h - 2, E.pal.warn, { align: 'right' });
        }
        ch.dirty = false; ch.stats.drawn++; ch.drawnT = E.t; ch.drawnAt = nowMs();
        if (impl.aria && canvas.setAttribute) {
          var s = impl.aria(ch.data, E) || C.TITLES[kind];
          if (s !== ariaText) { ariaText = s; canvas.setAttribute('aria-label', s); }
        }
      } catch (e) {
        fail(e, p);
      }
      ch.stats.ms = nowMs() - t0;
    };

    function fail(e, p) {
      var msg = (e && e.message) || String(e);
      if (G.console && !errSeen[msg]) G.console.error('[HY.charts.' + kind + ']', e);
      if (!errSeen[msg] && HY.bus) { errSeen[msg] = true; HY.bus.emit('error', { part: 'charts', message: '“' + C.TITLES[kind] + '”图出错：' + msg }); }
      errSeen[msg] = true;
      try {
        p = p || C.prep(canvas);
        p.ctx.setTransform(Math.min(G.devicePixelRatio || 1, 2), 0, 0, Math.min(G.devicePixelRatio || 1, 2), 0, 0);
        p.ctx.clearRect(0, 0, p.w, p.h);
        p.ctx.font = C.font(11, false);
        C.label(p.ctx, '这张图没画出来：' + msg, 6, 16, C.palette().bad, { halo: false });
      } catch (e2) { /* 连提示都画不了就算了 */ }
      ch.dirty = false;
    }

    // 悬停与点选（坐标是画布的 CSS 像素）
    ch.probe = function (x, y) {
      if (!ch.data || !impl.tip) return null;
      try { return impl.tip(ch.data, { x: x, y: y }, ch.lay, ch.env) || null; } catch (e) { return null; }
    };
    ch.pickAt = function (x, y) {
      if (!ch.data || !impl.pick) return null;
      var res = impl.pick(ch.data, { x: x, y: y }, ch.lay, ch.env);
      if (res) ch.pick(res);
      return res;
    };
    ch.pick = function (res) {
      var S = HY.store;
      if (res.look && HY.app && typeof HY.app.look === 'function') {
        try { HY.app.look(res.look[0], res.look[1]); } catch (e) { if (G.console) G.console.warn(e); }
      }
      if (res.s != null && S) S.patch('site', { id: res.id != null ? res.id : null, s: res.s, az: HY.state.site.az }, 'ui');
      if (res.t != null && S) S.set('time.t', res.t, 'ui');
      picks.slice().forEach(function (fn) { try { fn(res); } catch (e) { if (G.console) G.console.error(e); } });
    };
    ch.onPick = function (fn) { picks.push(fn); return function () { var i = picks.indexOf(fn); if (i >= 0) picks.splice(i, 1); }; };

    function local(e) {
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
    }
    function redrawSoon() {
      if (raf) return;
      var go = function () { raf = 0; ch.draw(); tip(); };
      if (G.requestAnimationFrame) raf = G.requestAnimationFrame(go); else go();
    }
    function tip() {
      if (!ch.hover) { C.tip.hide(canvas); return; }
      var lines = ch.probe(ch.hover.x, ch.hover.y);
      if (lines && lines.length) C.tip.show(lines, ch.hover.cx, ch.hover.cy, canvas); else C.tip.hide(canvas);
      if (canvas.style) {
        var can = impl.pick && impl.canPick ? impl.canPick(ch.data, ch.hover, ch.lay, ch.env) : !!impl.pick;
        canvas.style.cursor = can ? 'pointer' : 'crosshair';
      }
    }
    function onMove(e) { if (!ch.data) return; ch.hover = local(e); redrawSoon(); }
    function onLeave() { ch.hover = null; C.tip.hide(canvas); redrawSoon(); }
    function onClick(e) { var p = local(e); try { ch.pickAt(p.x, p.y); } catch (err) { fail(err); } }
    if (hasDom) {
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('click', onClick);
      if (canvas.setAttribute) { canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', C.TITLES[kind]); }
      if (G.IntersectionObserver && canvas.nodeType === 1) {
        try {
          io = new G.IntersectionObserver(function (es) {
            ioVis = es[es.length - 1].isIntersecting;
            if (ioVis && ch.dirty) ch.update('visible');
          }, { rootMargin: '120px' });
          io.observe(canvas);
        } catch (e) { io = null; }
      }
    }
    if (impl.listen) offs = impl.listen(ch) || [];
    // 收尾重画（保险）：app 对 time 事件按 100 ms 节流（HY.util.throttle 会补发最后一次）；这里再兜一层，
    // 不依赖调用方：150 ms 后若画面上的时刻不是此刻、且这段时间里没画过，就补画一次
    var tail = null;
    function tailCheck() {
      tail = null;
      var t = HY.state && HY.state.time ? HY.state.time.t : null;
      if (t == null || t === ch.drawnT || !ch.data) return;
      if (nowMs() - (ch.drawnAt || 0) < 140) { tail = setTimeout(tailCheck, 150); return; }   // 播放中：app 已按 10 Hz 在画，稍后再看
      if (ch.visible()) ch.draw(); else ch.dirty = true;
    }
    if (HY.bus && HY.bus.on) {
      offs.push(HY.bus.on('time', function () { if (!tail) tail = setTimeout(tailCheck, 150); }));
    }

    ch.destroy = function () {
      if (tail) { clearTimeout(tail); tail = null; }
      if (hasDom) {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('click', onClick);
      }
      if (io) { io.disconnect(); io = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      if (raf && G.cancelAnimationFrame) G.cancelAnimationFrame(raf);
      raf = 0;
      offs.forEach(function (f) { try { f(); } catch (e) { /* 忽略 */ } });
      offs = []; picks.length = 0; ch.data = null;
      C.tip.hide(canvas);
    };
    ch.impl = impl;
    return ch;
  };

  // 占位图：注册之前或出错时用
  function placeholder(kind, canvas) {
    var picks = [];
    var ch = {
      kind: kind, dirty: true,
      update: function () { ch.dirty = true; ch.draw(); },
      draw: function () {
        if (!canvas || !canvas.getContext) return;
        var p = C.prep(canvas), c = C.colors(), ctx = p.ctx;
        ctx.clearRect(0, 0, p.w, p.h);
        ctx.strokeStyle = c.line; ctx.strokeRect(0.5, 0.5, p.w - 1, p.h - 1);
        ctx.fillStyle = c.dim; ctx.font = C.font(12, false);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((C.TITLES[kind] || kind) + ' · 准备中', p.w / 2, p.h / 2);
        ch.dirty = false;
      },
      onPick: function (fn) { picks.push(fn); },
      destroy: function () { picks.length = 0; }
    };
    return ch;
  }
  C.placeholder = placeholder;

  C.create = function (kind, canvas, opts) {
    var f = REG[kind], ch;
    try { ch = f ? f(canvas, opts || {}, C) : placeholder(kind, canvas); }
    catch (e) {
      if (G.console) G.console.error('[HY.charts] 建图失败：' + kind, e);
      ch = placeholder(kind, canvas);
    }
    ch.kind = kind;
    return ch;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
