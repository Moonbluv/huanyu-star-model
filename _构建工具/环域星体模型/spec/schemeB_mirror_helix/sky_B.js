/* 环域天体·方案乙「日月对称双螺旋」参考实现（纯函数，无依赖；浏览器挂到 window.SkyB，node 用 module.exports）
 * 单位：km、日。坐标＝地固系（随星体转）：原点＝球心；y＝塔轴，+y 指向塔顶，塔根极在 (0,-R,0)；
 * x、z 张成塔腰平面，经度 λ 从 +x 量向 +z；λ 增大＝本地“西”。t=0＝庆典年入冬时刻＝λ=0 子午线的子夜。 */
(function (root) {
  'use strict';
  var TAU = Math.PI * 2, D2R = Math.PI / 180;
  var R0 = 6371;
  var DEFAULTS = {
    R: R0, a: 600, gEq: 1.4,
    Y: 360, M: 32,              // 年、朔望月（日）
    rs: 640,                    // 日轨半径＝塔半径 + 40
    rm: R0 / 2,                 // 月轨半径＝R/2
    A: R0 / 2,                  // 日月共同振幅＝R/2（镜像）
    rhoS: 20, rhoM: 100,        // 日、月本体半径
    daySec: 86400               // 一日的秒数（只用于惯性系换算）
  };
  function params(o) { var p = {}, k; for (k in DEFAULTS) p[k] = DEFAULTS[k]; if (o) for (k in o) p[k] = o[k]; return p; }

  // ---------- 天体 ----------
  function sunAt(t, P) {
    var lam = Math.PI + TAU * t;
    return { x: P.rs * Math.cos(lam), y: P.A * Math.sin(TAU * t / P.Y), z: P.rs * Math.sin(lam), lam: lam };
  }
  function moonAt(t, P) {
    var lam = TAU * t * (1 - 1 / P.M);
    return { x: P.rm * Math.cos(lam), y: -P.A * Math.sin(TAU * t / P.Y), z: P.rm * Math.sin(lam), lam: lam };
  }
  // 月对日的经度差，度，(-180,180]；±180＝冲（黑月正中），0＝合
  function elongation(t, P) { var d = (-180 - 360 * t / P.M) % 360; if (d <= -180) d += 360; if (d > 180) d -= 360; return d; }
  // 星体自转（惯性系下画“神的视角”时把一切绕 y 轴转 spinAngle）
  function spinPeriodSec(P) { return TAU / Math.sqrt(P.gEq * 9.80665 / (P.R * 1000)); }          // ≈4280 s ≈ 71.3 分
  function spinAngle(t, P) { return TAU * t * P.daySec / spinPeriodSec(P); }                       // ≈20.19 圈/日

  // ---------- 地点 ----------
  function place(s, lonDeg, P) {
    var psi = s / P.R, lam = lonDeg * D2R, c = Math.cos(lam), sn = Math.sin(lam), r = P.R * Math.sin(psi);
    return {
      s: s, psi: psi, lam: lam, r: r, x: r * c, y: -P.R * Math.cos(psi), z: r * sn,
      lat: 90 - psi / D2R, g: P.gEq * Math.sin(psi),
      U: [-c, 0, -sn], N: [0, -1, 0], E: [sn, 0, -c],
      n: [-Math.sin(psi) * c, Math.cos(psi), -Math.sin(psi) * sn]
    };
  }
  function localSolarTime(t, O) { var f = (t - O.lam / TAU) % 1; return f < 0 ? f + 1 : f; }   // 0 子夜，0.5 正午
  function dayOfYear(t, P) { var d = t % P.Y; return d < 0 ? d + P.Y : d; }                       // 入冬后第几日
  function season(t, O, P) { var w = dayOfYear(t, P) < P.Y / 2; return (O.y <= 0) === w ? '冬' : '夏'; }
  function cycleYear(t, P) { var n = Math.floor(t / P.Y); return ((n % 4) + 4) % 4; }              // 0＝庆典年

  // ---------- 遮挡：无限长圆柱，只看水平投影 ----------
  function blocked(A, B, P) {
    var dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz, u = L2 > 0 ? -(A.x * dx + A.z * dz) / L2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    var cx = A.x + u * dx, cz = A.z + u * dz; return cx * cx + cz * cz < P.a * P.a;
  }
  var NS = 33, US = [], WS = [], WSUM = 0;
  for (var i = 0; i < NS; i++) { var u = -1 + (2 * i + 1) / NS; US.push(u); WS.push(Math.sqrt(1 - u * u)); WSUM += WS[i]; }
  // 半径 rho 的圆盘从 V 看露在塔外的面积比例（日落半影、月入影、月被塔边遮半）
  function diskVisible(V, Q, rho, P) {
    var dx = Q.x - V.x, dz = Q.z - V.z, L = Math.sqrt(dx * dx + dz * dz); if (L < 1e-9) return blocked(V, Q, P) ? 0 : 1;
    var px = -dz / L, pz = dx / L, s = 0;
    for (var k = 0; k < NS; k++) if (!blocked(V, { x: Q.x + US[k] * rho * px, z: Q.z + US[k] * rho * pz }, P)) s += WS[k];
    return s / WSUM;
  }

  // ---------- 观测量 ----------
  function sub(A, B) { return [B.x - A.x, B.y - A.y, B.z - A.z]; }
  function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
  function len(v) { return Math.sqrt(dot(v, v)); }
  // 高度角 e（相对“水平”：垂直于指向塔轴的方向）、对地仰角 g（相对倾斜的地面）、方位 az（北 0 东 90）、距离 d
  function look(O, Q) {
    var v = sub(O, Q), d = len(v);
    return {
      e: Math.asin(dot(O.U, v) / d) / D2R, g: Math.asin(dot(O.n, v) / d) / D2R,
      az: ((Math.atan2(dot(O.E, v), dot(O.N, v)) / D2R) + 360) % 360, d: d, v: v
    };
  }
  function sunVisibleFraction(O, t, P) { return diskVisible(O, sunAt(t, P), P.rhoS, P); }        // 1 昼，0 夜
  function isNight(O, t, P) { return blocked(O, sunAt(t, P), P); }
  function moonSunlit(t, P) { return diskVisible(moonAt(t, P), sunAt(t, P), P.rhoS, P); }          // 0 本影，1 全亮
  function isBlackMoon(t, P) { return blocked(moonAt(t, P), sunAt(t, P), P); }                     // 月心在塔影里
  // 亮面比例 k=(1+cosφ)/2，φ＝日-月-人
  function litFraction(O, t, P) {
    var S = sunAt(t, P), Mo = moonAt(t, P), a = sub(Mo, S), b = sub(Mo, O);
    return (1 + dot(a, b) / (len(a) * len(b))) / 2;
  }
  // 明暗分界的朝向：月面上“亮的一侧”指向太阳在天上的投影方向（渲染用）
  function moonBrightLimbDir(O, t, P) { return sub(moonAt(t, P), sunAt(t, P)).map(function (x) { return -x; }); }
  // 视线 O→Q 延长后打在内壁上的点
  function wallHit(O, Q, P) { var d = sub(O, Q), k = -2 * (O.x * d[0] + O.y * d[1] + O.z * d[2]) / dot(d, d); return { x: O.x + k * d[0], y: O.y + k * d[1], z: O.z + k * d[2] }; }

  // 月在 O 的天上是什么样子
  function moonView(O, t, P) {
    var S = sunAt(t, P), Mo = moonAt(t, P), L = look(O, Mo);
    var hidden = blocked(O, Mo, P), sunlit = diskVisible(Mo, S, P.rhoS, P);
    var B = wallHit(O, Mo, P), bgTower = blocked(O, B, P), bgLit = !bgTower && !blocked(B, S, P);
    // 月盘两侧也不压塔，才算完整剪影
    var h = Math.sqrt(L.v[0] * L.v[0] + L.v[2] * L.v[2]), px = -L.v[2] / h, pz = L.v[0] / h;
    var B1 = wallHit(O, { x: Mo.x + P.rhoM * px, y: Mo.y, z: Mo.z + P.rhoM * pz }, P), B2 = wallHit(O, { x: Mo.x - P.rhoM * px, y: Mo.y, z: Mo.z - P.rhoM * pz }, P);
    var clear = !bgTower && !blocked(O, B1, P) && !blocked(O, B2, P);
    var night = blocked(O, S, P);
    return {
      elev: L.e, az: L.az, dist: L.d, diamDeg: 2 * Math.atan(P.rhoM / L.d) / D2R,
      hidden: hidden, sunlit: sunlit, black: sunlit < 0.5, lit: litFraction(O, t, P),
      background: bgTower ? 'tower' : (bgLit ? 'litWorld' : 'darkWorld'),
      hanging: night && !hidden && blocked(Mo, S, P) && clear && bgLit && L.e > 30   // 黑月高悬
    };
  }
  function sunView(O, t, P) {
    var S = sunAt(t, P), L = look(O, S);
    return { elev: L.e, groundElev: L.g, az: L.az, dist: L.d, diamDeg: 2 * Math.atan(P.rhoS / L.d) / D2R, visible: diskVisible(O, S, P.rhoS, P) };
  }

  // ---------- 闭式量 ----------
  function dayFraction(O, P) { return (Math.acos(P.a / O.r) + Math.acos(P.a / P.rs)) / Math.PI; }  // 昼占一日
  function blackBoundaryDeg(P) { return (Math.acos(P.a / P.rs) + Math.acos(P.a / P.rm)) / D2R; }   // 月离日超过它即黑月（月心）
  function blackDaysPerMonth(P) { return 2 * (180 - blackBoundaryDeg(P)) / 360 * P.M; }
  function noonElevation(O, t, P) { var y = P.A * Math.sin(TAU * t / P.Y); return Math.atan2(O.r - P.rs, Math.abs(y - O.y)) / D2R; }
  function festivalYear(n, P) { return Math.abs(Math.abs(elongation(n * P.Y, P)) - 180) < 1e-6; }  // 第 n 个入冬逢黑月正中

  var api = {
    TAU: TAU, D2R: D2R, DEFAULTS: DEFAULTS, params: params,
    sunAt: sunAt, moonAt: moonAt, elongation: elongation, spinPeriodSec: spinPeriodSec, spinAngle: spinAngle,
    place: place, localSolarTime: localSolarTime, dayOfYear: dayOfYear, season: season, cycleYear: cycleYear,
    blocked: blocked, diskVisible: diskVisible, look: look, wallHit: wallHit,
    sunVisibleFraction: sunVisibleFraction, isNight: isNight, moonSunlit: moonSunlit, isBlackMoon: isBlackMoon,
    litFraction: litFraction, moonBrightLimbDir: moonBrightLimbDir, moonView: moonView, sunView: sunView,
    dayFraction: dayFraction, blackBoundaryDeg: blackBoundaryDeg, blackDaysPerMonth: blackDaysPerMonth,
    noonElevation: noonElevation, festivalYear: festivalYear
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SkyB = api;
})(typeof window !== 'undefined' ? window : this);
