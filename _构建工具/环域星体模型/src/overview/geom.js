/* HY.ov.geom —— 总览的纯几何：螺旋、轨迹、每日同刻、影楔、拾取、自转角、镜头预设（规格：spec/03 第六节第 5、6、9、10、12 条）
 * 负责：B 路。节点可测（test/ov_geom_check.js）：不碰 DOM、不碰 THREE、不读 HY.state。
 * 接口一律 km、弧度；只有 presetPose 返回场景单位（1 单位＝1000 km），因为它只给相机用。
 * 日月位置一律取 HY.astro（sunPos、moonPos、toInertial、elongation、isFestival），这里不另立日月公式；
 * 本文件只做“画法”的几何：示意螺旋怎么摆、影楔的切线、射线求交。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ov = HY.ov = HY.ov || {};
  var geom = ov.geom = ov.geom || {};

  var TAU = Math.PI * 2, R2D = 180 / Math.PI;
  var TOWER_HALF = 1.06;              // 塔长 2.12R：两端各穿出内壁 0.06R（03 第六节第 3 条）

  geom.__stubs = [];
  geom.TOWER_HALF = TOWER_HALF;

  function astro() { return HY.astro; }
  function frac(x) { return x - Math.floor(x); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrapPi(x) { x = x % TAU; if (x >= Math.PI) x -= TAU; else if (x < -Math.PI) x += TAU; return x; }
  geom.wrapPi = wrapPi;

  /* ───────── 一、年相位与轨道半径 ───────── */
  // 年相位 u(t)＝frac(t/Y)：0＝入冬交节（日往上过塔腰），0.5＝入夏交节
  geom.uOf = function (P, t) { return frac(t / P.Y); };
  // 画在哪个离轴半径：月照实（rM）；日在 a + (dS−a)·gapX（gapX＝1 即真实的 dS）
  geom.orbitRadius = function (P, body, gapX) {
    if (body === 'moon') return P.rM;
    return P.a + (P.dS - P.a) * (gapX == null ? 1 : gapX);
  };
  // 日轨放大时，太阳水平坐标乘的倍数（同方位、同高度）
  geom.gapScale = function (P, gapX) { return geom.orbitRadius(P, 'sun', gapX) / P.dS; };
  // 螺旋在年相位 u 处的高度：日 A·sin(2πu)，月取镜像 −mirror·A·sin(2πu)（与 HY.astro 同式）
  geom.heightOf = function (P, body, u) {
    var y = P.A * Math.sin(TAU * u);
    return body === 'moon' ? -(P.mirror == null ? 1 : P.mirror) * y : y;
  };
  // 天体此刻的真实方位角 θ(t)（弧度，[−π, π)）；按小数圈算，t 很大也不丢精度。
  //   θS＝φ0＋π＋2πt，θM＝φ0＋2πt(1−1/M)（01 第三节；与 HY.astro.sunPos/moonPos 同式，只是先取小数圈）
  geom.bodyAngle = function (P, body, t) {
    var turns = body === 'moon' ? frac(frac(t) - frac(t / P.M)) : frac(t) + 0.5;
    return wrapPi(P.phi0 + TAU * turns);
  };
  geom.bodyPos = function (P, body, t) { return body === 'moon' ? astro().moonPos(t, P) : astro().sunPos(t, P); };

  /* ───────── 二、镜像双螺旋（示意） ───────── */
  // 螺旋在参数 u 处的点（螺旋自身坐标：角 2π·turns·u，未转）
  geom.helixPoint = function (P, body, u, turns, gapX, out) {
    var r = geom.orbitRadius(P, body, gapX), ph = TAU * turns * u;
    out = out || [0, 0, 0];
    out[0] = r * Math.cos(ph); out[1] = geom.heightOf(P, body, u); out[2] = r * Math.sin(ph);
    return out;
  };
  geom.helixSegments = function (turns) { return Math.max(256, Math.round(turns * 64)); };
  // → {pos: Float32Array(3n), u: Float32Array(n)}；u 从 0 到 1（含两端，turns 为整数时首尾重合）
  geom.helix = function (P, body, turns, gapX, nSeg) {
    var n = (nSeg || geom.helixSegments(turns)) + 1;
    var pos = new Float32Array(3 * n), u = new Float32Array(n), p = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      var ui = i / (n - 1);
      geom.helixPoint(P, body, ui, turns, gapX, p);
      pos[3 * i] = p[0]; pos[3 * i + 1] = p[1]; pos[3 * i + 2] = p[2];
      u[i] = ui;
    }
    return { pos: pos, u: u };
  };
  // 示意螺旋的整体转角 θ(t) − 2π·turns·u(t)（弧度，[−π, π)）：绕 y 转过它后，螺旋在 u(t) 处恰好穿过天体的真实位置。
  //   转角的方向与 01 的方位角同向（φ 增大＝西）；在 three 里对应 rotation.y = −helixAngle。
  geom.helixAngle = function (P, body, t, turns) {
    return wrapPi(geom.bodyAngle(P, body, t) - TAU * frac(turns * geom.uOf(P, t)));
  };
  // 把点绕 y 轴按方位角方向转 al（与 HY.astro.toInertial 同向）
  geom.rotY = function (p, al, out) {
    var c = Math.cos(al), s = Math.sin(al), x = p[0] == null ? p.x : p[0], y = p[1] == null ? p.y : p[1], z = p[2] == null ? p.z : p[2];
    out = out || [0, 0, 0];
    out[0] = x * c - z * s; out[1] = y; out[2] = x * s + z * c;
    return out;
  };

  /* ───────── 三、实际轨迹与每日同刻 ───────── */
  // 实际轨迹：t＋from 到 t＋to（日），n 个点，frame 'ground'|'inertial' → Float32Array(3n)，km
  geom.trail = function (P, body, t, from, to, n, frame) {
    n = Math.max(2, (n | 0) || 2);
    var out = new Float32Array(3 * n), A = astro();
    for (var i = 0; i < n; i++) {
      var ti = t + from + (to - from) * i / (n - 1), p = geom.bodyPos(P, body, ti);
      if (frame === 'inertial') p = A.toInertial(p, ti, P);
      out[3 * i] = p.x; out[3 * i + 1] = p.y; out[3 * i + 2] = p.z;
    }
    return out;
  };
  // 每日同刻：此刻前后共 n 日（默认一年）、每天同一时刻的位置（地固系）→ Float32Array(3n)。
  //   第 floor(n/2) 个点就是此刻。太阳每天同刻方位不变，只上下（一条竖线）；月每天退 360°/M，一年 12¼ 圈。
  geom.strobe = function (P, body, t, n) {
    n = Math.max(2, (n | 0) || Math.round(P.Y));
    var out = new Float32Array(3 * n), h = Math.floor(n / 2);
    for (var i = 0; i < n; i++) {
      var p = geom.bodyPos(P, body, t + (i - h));
      out[3 * i] = p.x; out[3 * i + 1] = p.y; out[3 * i + 2] = p.z;
    }
    return out;
  };

  /* ───────── 四、塔影楔 ───────── */
  // S＝日心（km，地固系）。由日面两缘对塔作切线：本影＝外公切线（日、塔在线同侧），半影外界＝内公切线。
  //   每条边界 {p: 塔面切点(y=0), dir: 沿切线背离太阳的单位方向, len: 从 p 到内壁所在圆柱面 √(R²−a²), n: 切线的外法向}。
  //   这四条直线是竖直平面在塔腰平面上的迹；平面沿 y 贯通 −R..R（着色器里丢弃球外部分）。
  //   与内壁的交线是以 p 为心、半径 len 的半圆（geom.wedgeArc）。本影在每条本影线的 −n 一侧，全亮在半影线的 +n 一侧。
  geom.shadowWedge = function (P, S) {
    var sx = S.x == null ? S[0] : S.x, sz = S.z == null ? S[2] : S.z;
    var D = Math.sqrt(sx * sx + sz * sz), sig = Math.atan2(sz, sx), a = P.a, rho = P.rhoS;
    var L = Math.sqrt(Math.max(0, P.R * P.R - a * a));
    function line(c, side) {                       // 直线 {x : n·x = a}，且 n·S = c
      var ph = sig + side * Math.acos(clamp(c / D, -1, 1));
      var nx = Math.cos(ph), nz = Math.sin(ph), ns = nx * sx + nz * sz, k = a - ns;
      var fx = sx + k * nx, fz = sz + k * nz;      // 日球与该直线的切点
      var px = a * nx, pz = a * nz, dx = px - fx, dz = pz - fz, dl = Math.sqrt(dx * dx + dz * dz) || 1;
      return { p: [px, 0, pz], dir: [dx / dl, 0, dz / dl], len: L, n: [nx, 0, nz] };
    }
    return { umbra: [line(a - rho, 1), line(a - rho, -1)], penumbra: [line(a + rho, 1), line(a + rho, -1)] };
  };
  // 影楔边界平面与内壁的交线：p＋len·(cos β·dir＋sin β·ŷ)，β∈[−π/2, π/2]，n 个点 → Float32Array(3n)
  geom.wedgeArc = function (e, n, out) {
    n = Math.max(2, n | 0);
    out = out || new Float32Array(3 * n);
    for (var i = 0; i < n; i++) {
      var b = -Math.PI / 2 + Math.PI * i / (n - 1), c = Math.cos(b) * e.len, s = Math.sin(b) * e.len;
      out[3 * i] = e.p[0] + c * e.dir[0]; out[3 * i + 1] = s; out[3 * i + 2] = e.p[2] + c * e.dir[2];
    }
    return out;
  };

  /* ───────── 五、射线求交与拾取 ───────── */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(d) { var l = Math.sqrt(dot(d, d)) || 1; return [d[0] / l, d[1] / l, d[2] / l]; }
  // 射线 o＋t·d 与球 |X|=R 的两个交点（升序）；无交点返回 null
  geom.raySphere = function (o, d, R) {
    var A = dot(d, d), b = dot(o, d), c = dot(o, o) - R * R, disc = b * b - A * c;
    if (disc < 0) return null;
    var s = Math.sqrt(disc);
    return [(-b - s) / A, (-b + s) / A];
  };
  // 射线与巨塔（半径 a、|y| ≤ H 的实心圆柱，含两端盖）的首个正交点；无交点 Infinity
  geom.rayTower = function (o, d, a, H) {
    var best = Infinity, A = d[0] * d[0] + d[2] * d[2], B = o[0] * d[0] + o[2] * d[2], C = o[0] * o[0] + o[2] * o[2] - a * a;
    if (C <= 0 && Math.abs(o[1]) <= H) return 0;   // 起点在塔内
    if (A > 1e-14) {
      var disc = B * B - A * C;
      if (disc >= 0) {
        var t = (-B - Math.sqrt(disc)) / A, y = o[1] + t * d[1];
        if (t > 0 && Math.abs(y) <= H) best = t;
      }
    }
    if (Math.abs(d[1]) > 1e-14) {
      for (var k = -1; k <= 1; k += 2) {
        var tc = (k * H - o[1]) / d[1];
        if (tc > 0 && tc < best) {
          var x = o[0] + tc * d[0], z = o[2] + tc * d[2];
          if (x * x + z * z <= a * a) best = tc;
        }
      }
    }
    return best;
  };
  // 内壁上一点 → {s, az}（s 沿地面离塔根 km；az 度，(−180, 180]）
  geom.toSA = function (X, R) {
    var psi = Math.acos(clamp(-X[1] / R, -1, 1)), az = Math.atan2(X[2], X[0]) * R2D;
    if (az <= -180) az += 360;
    return { s: R * psi, az: az };
  };
  // 射线拾取内壁：origin、dir 为 km（地固系）。clipN 非空时跳过 dot(X, clipN)>0（被剖掉的一侧）的交点；
  //   先撞到塔就返回 null。→ {s, az} | null
  geom.pick = function (origin, dir, R, clipN, a) {
    var d = norm(dir), ts = geom.raySphere(origin, d, R);
    if (!ts) return null;
    var tT = geom.rayTower(origin, d, a, TOWER_HALF * R);
    for (var i = 0; i < 2; i++) {
      var t = ts[i];
      if (!(t > 1e-6)) continue;
      var X = [origin[0] + t * d[0], origin[1] + t * d[1], origin[2] + t * d[2]];
      if (clipN && dot(X, clipN) > 0) continue;
      if (tT < t) return null;
      return geom.toSA(X, R);
    }
    return null;
  };
  // 从相机 C 看点 X（都是 km、地固系）是否被挡：返回 '' 可见｜'cut' 在被剖掉的一侧｜'tower'｜'wall'。
  //   o.cut：'half'|'ghost'|'none'；o.clipN：剖切法向（null＝不剖，例如相机在球内）；o.onWall：X 是内壁上的点。
  geom.occluded = function (C, X, o) {
    var R = o.R, d = [X[0] - C[0], X[1] - C[1], X[2] - C[2]], L = Math.sqrt(dot(d, d));
    if (L < 1e-9) return '';
    var u = [d[0] / L, d[1] / L, d[2] / L], clip = o.cut !== 'none' && o.clipN ? o.clipN : null;
    if (o.onWall && clip && o.cut === 'half' && dot(X, clip) > 0) return 'cut';
    var tT = geom.rayTower(C, u, o.a, TOWER_HALF * R);
    if (tT < L * (1 - 1e-6)) return 'tower';
    if (o.cut === 'ghost' && clip) return '';
    var ts = geom.raySphere(C, u, R);
    if (ts) {
      for (var i = 0; i < 2; i++) {
        var t = ts[i];
        if (!(t > 1e-6) || t >= L * (1 - 1e-6) - (o.onWall ? R * 1e-6 : 0)) continue;
        var Q = [C[0] + t * u[0], C[1] + t * u[1], C[2] + t * u[2]];
        if (clip && dot(Q, clip) > 0) continue;   // 这一段内壁被剖掉了
        return 'wall';
      }
    }
    return '';
  };

  /* ───────── 六、惯性系转角 ───────── */
  // 地固系 → 惯性系的转角：frac(Ω·86400·t/2π)·2π，[0, 2π)。用对 2π 取余（JS 的 % 对浮点是精确的）求小数圈，
  //   t＝10⁵ 日时与 HY.astro.toInertial 的转角相差 ＜1e-9 rad。
  geom.spin = function (P, t) {
    var al = (P.spinOmega * P.daySec * t) % TAU;
    return al < 0 ? al + TAU : al;
  };

  /* ───────── 七、入冬交节（入冬镜头用） ───────── */
  // 离 t 最近的一次入冬交节：{N, t, festival, elong, title, phrase}（年号按 HY.astro 的交节年；01 第七节第 5 条）
  // 入冬交节那一刻日月的角距 → 字幕（非庆典年）。总览与界面（HY.ui.layout.winterLines）共用这一份判定
  geom.elongPhrase = function (el) {
    var ae = Math.round(Math.abs(el));
    return ae < 45 ? '今年月与日同侧' : el > 0 ? '今年月在日西 ' + ae + '°' : '今年月在日东 ' + ae + '°';
  };
  geom.winterNear = function (P, t) {
    var A = astro(), k = Math.round(t / P.Y), tw = k * P.Y, N = P.epochYear + k;
    var fest = A.isFestival(N, P), el = A.elongation(tw, P);
    var phrase = fest ? '三点一线，是夜为圣皇庆典' : geom.elongPhrase(el);
    return { N: N, t: tw, festival: fest, elong: el, title: '入冬：日升月降，交于塔腰', phrase: phrase };
  };
  // 三点一线的白线画哪一次入冬交节（03 第六节第 5 条“当前年入冬交节若是庆典年”）：
  //   N＝此刻的历法年号（HY.model.now.cal.N）。默认画第 N 年的交节；第 N 年的不是庆典、而离 t 不到 WINTER_WIN 日
  //   恰有一次庆典交节时，画那一次。年号口径若在交节当场换号（HY.world.CAL.yearStart＝'winter'／'winterEnd'），
  //   入冬镜头（交节前后各半日）会跨两个“年”，不这样白线只亮一半。→ {N, t, festival}
  geom.WINTER_WIN = 1;
  geom.winterFor = function (P, N, t) {
    var A = astro(), k = Math.round(t / P.Y), Nn = P.epochYear + k, Nw = N;
    if (!A.isFestival(N, P) && Nn !== N && Math.abs(t - k * P.Y) < geom.WINTER_WIN && A.isFestival(Nn, P)) Nw = Nn;
    return { N: Nw, t: (Nw - P.epochYear) * P.Y, festival: A.isFestival(Nw, P) };
  };

  /* ───────── 八、镜头预设（03 第六节第 9 条） ───────── */
  geom.PRESETS = ['oblique', 'side', 'fromTop', 'fromRoot', 'above', 'sun', 'moon', 'winter'];
  geom.PRESET_NAMES = { oblique: '斜看', side: '侧看', fromTop: '从塔顶看帝国', fromRoot: '看另一端', above: '此地上空',
    sun: '跟随太阳', moon: '跟随月亮', winter: '入冬镜头' };
  // c：{aspect, site:{x,y,z}（地固系 km）, S, Mo（显示位置 km）, wS, wMo（入冬交节那一刻的日、月，显示位置 km）}
  //   → {pos:[x,y,z], target:[x,y,z], fov?}，场景单位（km/1000）；fov 省略＝38°。k 按画面宽高比放大：竖屏时拉远到 1/宽高比，
  //   让竖屏的左右取景与横屏的上下取景一样宽（竖直视角固定 38°）。
  //   斜看、侧看从当前地点的“背面”看进去（默认剖开朝向相机的半球）：相机放在地点方位 +180° 的一侧，地点落在没被剖掉的
  //   那半边内壁上——原先相机固定在 (1.7, 0.62, 1.4)，正好从帝国经线（各地方位 −4°…25°）那一侧看进去，帝国连同当前地点全被剖掉。
  //   没给地点时按罪域的方位（−4°）。
  geom.OBLIQUE_TURN = 39.5;          // 斜看比正对“背面”再转的角度（原 (1.7, 1.4) 的方位角）
  geom.SIDE_TURN = 30;               // 侧看再转 30°：正对背面时帝国各地都藏在塔身后面
  /* 侧看往哪边转（验收第 5 条返修）：固定 +30° 时，相机正对的“塔身背后”是地点方位 +30°——罪域（−4°）看过去，
   *   涅赫莱恩（25°）正好藏在塔后。改成在 ±30°、±40°、±50° 里挑：塔后那条方位离各预设地点（含此地）都至少 20°；
   *   都做不到就取离得最远的。同样满足时先取 +30°（原来的样子），再 −30°……
   *   纯函数：siteAzDeg 此地方位（度），others 其它地点的方位（度）→ 转角（度） */
  geom.SIDE_TURNS = [30, -30, 40, -40, 50, -50];
  geom.sideTurn = function (siteAzDeg, others) {
    var az = [siteAzDeg].concat(others || []), best = null;
    for (var i = 0; i < geom.SIDE_TURNS.length; i++) {
      var tu = geom.SIDE_TURNS[i], hid = siteAzDeg + tu, gap = 180;
      az.forEach(function (x) { var d = Math.abs(((x - hid) % 360 + 540) % 360 - 180); if (d < gap) gap = d; });
      if (gap >= 20) return tu;
      if (!best || gap > best.gap) best = { tu: tu, gap: gap };
    }
    return best.tu;
  };
  geom.presetPose = function (name, P, c) {
    c = c || {};
    var R = P.R, k = c.aspect && c.aspect < 1 ? 1 / Math.max(c.aspect, 0.3) : 1, s = 1 / 1000;
    function fixed(x, y, z) { return { pos: [x * R * k * s, y * R * k * s, z * R * k * s], target: [0, 0, 0] }; }
    function xyz(p) { return p ? [p.x == null ? p[0] : p.x, p.y == null ? p[1] : p.y, p.z == null ? p[2] : p.z] : [0, 0, 0]; }
    // 地点的方位（弧度）与半球（塔根 −1／塔顶 +1）；没给地点按罪域
    function siteAz() { var O = xyz(c.site); return c.site && (O[0] || O[2]) ? Math.atan2(O[2], O[0]) : -4 * Math.PI / 180; }
    function siteHemi() { var O = xyz(c.site); return c.site && O[1] > 0 ? 1 : -1; }
    // 方位 phi、离轴 h、高 y（R 为单位）的相机
    function around(phi, h, y) { return fixed(h * Math.cos(phi), y, h * Math.sin(phi)); }
    switch (name) {
      case 'side': {
        var sa = siteAz(), turn = c.sitesAz ? geom.sideTurn(sa * R2D, c.sitesAz) : geom.SIDE_TURN;
        return around(sa + Math.PI + turn * Math.PI / 180, 2.7, -0.02 * siteHemi());
      }
      case 'fromTop': return fixed(0.04, 3.1, 0.04);
      case 'fromRoot': return fixed(0.04, -3.1, 0.04);
      case 'above': return geom.abovePose(P, xyz(c.site), c.aspect);
      case 'sun': case 'moon': {
        var B = xyz(name === 'sun' ? c.S : c.Mo), th = Math.atan2(B[2], B[0]);
        return { pos: [2.2 * R * k * Math.cos(th) * s, (B[1] + 0.3 * R) * s, 2.2 * R * k * Math.sin(th) * s], target: [0, B[1] * s, 0] };
      }
      case 'winter': {
        var a = xyz(c.wS), b = xyz(c.wMo), dx = a[0] - b[0], dz = a[2] - b[2], dl = Math.sqrt(dx * dx + dz * dz);
        if (dl < 1e-6) { dx = 1; dz = 0; dl = 1; }
        dx /= dl; dz /= dl;
        return { pos: [-dz * 2.4 * R * k * s, 0.04 * R * s, dx * 2.4 * R * k * s], target: [0, 0, 0] };
      }
      default: return around(siteAz() + Math.PI + geom.OBLIQUE_TURN * Math.PI / 180, Math.hypot(1.7, 1.4), -0.62 * siteHemi());
    }
  };
  /* “此地上空”：从球腔里、地点上方高处斜着往下看——画面里同时有脚下那块内壁、地点旁边插下去的塔、塔根（或塔顶）那一端。
   *   原式“地点沿上抬 0.45r、y 再减 0.2R”在塔根半球里往极点外推，纬度高的地点（伊美忒、圣禁城、轻域）相机跑到球壳外面，
   *   画面只剩外表面的星空。这里改成：目标＝地点到塔面（同一高度）连线的六成处；相机从目标往“东”、往球腔中心一侧
   *   （塔根半球往 +y）、再朝塔轴偏一点，退 0.85R，并保证在球内、不在塔里。视角放宽到 50°（竖屏 70°）：
   *   球腔里退不远，38° 框不下一地与塔。参数由逐地搜索得来（八个预设地点，宽高比 1.3–1.8 与竖屏 0.46）。 */
  geom.ABOVE = { land: { e: 72, b: -40, tq: 0.6, D: 0.85, fov: 50 }, tall: { e: 64, b: -70, tq: 0.7, D: 0.85, fov: 70 } };
  geom.abovePose = function (P, O, aspect) {
    var R = P.R, s = 1 / 1000, o = aspect && aspect < 0.9 ? geom.ABOVE.tall : geom.ABOVE.land;
    var r = Math.sqrt(O[0] * O[0] + O[2] * O[2]), rh = r > 1e-6 ? [O[0] / r, 0, O[2] / r] : [1, 0, 0];
    var east = [-rh[2], 0, rh[0]], sg = O[1] > 0 ? 1 : -1, aq = P.a * 1.05;
    var T = [O[0] + (rh[0] * aq - O[0]) * o.tq, O[1], O[2] + (rh[2] * aq - O[2]) * o.tq];
    var e = o.e * Math.PI / 180, b = o.b * Math.PI / 180, ce = Math.cos(e);
    var d = [ce * Math.cos(b) * east[0] + ce * Math.sin(b) * rh[0], -sg * Math.sin(e), ce * Math.cos(b) * east[2] + ce * Math.sin(b) * rh[2]];
    var dl = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); d = [d[0] / dl, d[1] / dl, d[2] / dl];
    // 退 D·R，但不出 0.92R 的球、不进塔（离轴至少 1.3a）
    var D = o.D * R, C;
    for (var i = 0; i < 40; i++) {
      C = [T[0] + d[0] * D, T[1] + d[1] * D, T[2] + d[2] * D];
      var cl = Math.sqrt(C[0] * C[0] + C[1] * C[1] + C[2] * C[2]), cr = Math.sqrt(C[0] * C[0] + C[2] * C[2]);
      if (cl <= 0.92 * R && cr >= 1.3 * P.a) break;
      D *= 0.92;
    }
    return { pos: [C[0] * s, C[1] * s, C[2] * s], target: [T[0] * s, T[1] * s, T[2] * s], fov: o.fov };
  };

  /* ───────── 九、管子（螺旋管的网格；纯数组，THREE 只拿去建 BufferGeometry） ───────── */
  // pos：中心线 Float32Array(3n)；radius km；radial 每圈几个顶点。→ {position, normal, index, src}
  //   src[v]＝顶点 v 属于中心线第几个点（调用方据此铺 u 之类的属性）。标架：N1＝T×ŷ（螺旋的切线从不竖直，不会退化）。
  geom.tube = function (pos, radius, radial) {
    var n = pos.length / 3, m = radial, nv = n * m;
    var P = new Float32Array(3 * nv), N = new Float32Array(3 * nv), src = new Uint32Array(nv);
    var idx = nv > 65535 ? new Uint32Array((n - 1) * m * 6) : new Uint16Array((n - 1) * m * 6);
    for (var i = 0; i < n; i++) {
      var i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      var tx = pos[3 * i1] - pos[3 * i0], ty = pos[3 * i1 + 1] - pos[3 * i0 + 1], tz = pos[3 * i1 + 2] - pos[3 * i0 + 2];
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      var ax = -tz, az = tx, ay = 0, al = Math.sqrt(ax * ax + az * az);   // T × ŷ
      if (al < 1e-6) { ax = 0; ay = tz; az = -ty; al = Math.sqrt(ay * ay + az * az) || 1; }   // T × x̂（退化时）
      ax /= al; ay /= al; az /= al;
      var bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax;   // T × N1
      for (var j = 0; j < m; j++) {
        var ang = TAU * j / m, c = Math.cos(ang), s = Math.sin(ang), v = i * m + j;
        var nx = c * ax + s * bx, ny = c * ay + s * by, nz = c * az + s * bz;
        N[3 * v] = nx; N[3 * v + 1] = ny; N[3 * v + 2] = nz;
        P[3 * v] = pos[3 * i] + radius * nx; P[3 * v + 1] = pos[3 * i + 1] + radius * ny; P[3 * v + 2] = pos[3 * i + 2] + radius * nz;
        src[v] = i;
      }
    }
    var q = 0;
    for (var i2 = 0; i2 < n - 1; i2++) {
      for (var j2 = 0; j2 < m; j2++) {
        var a0 = i2 * m + j2, a1 = i2 * m + (j2 + 1) % m, b0 = a0 + m, b1 = a1 + m;
        idx[q++] = a0; idx[q++] = b0; idx[q++] = a1;
        idx[q++] = a1; idx[q++] = b0; idx[q++] = b1;
      }
    }
    return { position: P, normal: N, index: idx, src: src };
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
