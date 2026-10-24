'use strict';
// 方案甲：日月镜像双螺旋 —— 纯函数参考实现（km、日）
// 坐标：y 轴＝塔轴；塔根极 (0,-R,0)，塔顶极 (0,+R,0)；x-z 平面是塔腰平面。
// 地面固连（随星体一起转）的参照系。θ 增大＝朝西（日月东升西落）。
const TAU = 2 * Math.PI, D2R = Math.PI / 180, R2D = 180 / Math.PI;

const DEFAULTS = {
  R: 6371,          // 星体内表面半径
  a: 600,           // 巨塔半径
  gEq: 1.4,         // 赤道重力 (g)
  T: 24,            // 一日（太阳相对地面绕塔一圈）小时
  Y: 360,           // 一年（太阳上下一个来回）日
  M: 32,            // 一个月（太阳追上月亮一回，朔望周期）日
  A: 0.7 * 6371,    // 太阳沿塔身上下的幅度 km（塔腰为 0）
  ds: 640,          // 太阳离塔轴
  dm: 640,          // 月亮离塔轴（方案甲：与太阳同半径）
  mirror: true,     // 月高＝-日高（镜像）；false 时月固定在塔腰（v2）
  e0: -22.5,        // 度：t=0（庆典年入冬时刻）月亮相对太阳的方位差，正＝在太阳以西
  Rs: 26,           // 太阳半径 km
  Rm: 30,           // 月亮半径 km
  pMoon: 0.12,      // 月面几何反照率
  rhoGround: 0.15,  // 地面平均反照率
  Eref: 127000,     // lux：太阳过塔腰那日，赤道正午大气层顶照度（＝地球太阳常数 1361 W/m²）
  H: 40,            // 大气标高 km（以离内壁的高度计）
  V: 200,           // 近地能见度 km（Koschmieder：σ0＝3.912/V）
};

function createSky(opts) {
  const P = Object.assign({}, DEFAULTS, opts || {});
  const Dref = P.R - P.ds;                     // 基准距离：赤道正午、太阳在塔腰
  const sigma0 = 3.912 / P.V;                  // 地面消光系数 /km
  const tauV = sigma0 * P.H;                   // 垂直光学厚度（单层）

  const wrapPi = x => { x = (x + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
  const frac = x => x - Math.floor(x);

  // —— 太阳 ——  t：自某个入冬时刻起的日数（含小数）
  function sunHeight(t) { return P.A * Math.sin(TAU * t / P.Y); }
  function sunAt(t) {
    const th = TAU * (t - 0.5);
    const y = sunHeight(t);
    return { x: P.ds * Math.cos(th), y, z: P.ds * Math.sin(th), th, rho: P.ds };
  }
  // —— 月亮 ——  e：月相对太阳的方位差（弧度，正＝在太阳以西＝走在太阳前头）
  function elongation(t) { return wrapPi(P.e0 * D2R - TAU * t / P.M); }
  function moonAt(t) {
    const e = elongation(t);
    const th = TAU * (t - 0.5) + e;
    const y = P.mirror ? -sunHeight(t) : 0;
    return { x: P.dm * Math.cos(th), y, z: P.dm * Math.sin(th), th, rho: P.dm, e };
  }

  // 遮挡：塔是贯通两极的无限长圆柱，只看水平投影线段是否穿过半径 a 的圆
  function blocked(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let u = L2 > 1e-12 ? -(ax * dx + az * dz) / L2 : 0;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    const cx = ax + u * dx, cz = az + u * dz;
    return cx * cx + cz * cz < P.a * P.a;
  }
  // 解析：月亮被照亮 ⇔ |e| ≤ acos(a/ds)+acos(a/dm)
  const litHalf = Math.acos(P.a / P.ds) + Math.acos(P.a / P.dm);
  function isBlack(t) { const s = sunAt(t), m = moonAt(t); return blocked(s.x, s.z, m.x, m.z); }

  // —— 地点 ——  s：沿地面离塔根的距离 km；azDeg：经度（绕塔方位）
  function place(s, azDeg) {
    const psi = Math.max(0, Math.min(Math.PI, s / P.R));
    const ph = (azDeg || 0) * D2R;
    const r = P.R * Math.sin(psi), y = -P.R * Math.cos(psi);
    const c = Math.cos(ph), sn = Math.sin(ph);
    return {
      s, psi, ph, r, y, x: r * c, z: r * sn,
      U: [-c, 0, -sn],                                   // 上＝指向塔轴（重力反方向）
      N: [0, -1, 0],                                     // 北＝朝塔根
      E: [sn, 0, -c],                                    // 东＝面北时右手
      n: [-Math.sin(psi) * c, Math.cos(psi), -Math.sin(psi) * sn], // 地面法线（指向球心）
      latDeg: 90 - psi * R2D,                           // 纬度（塔根半球为正）＝地面倾角
      g: P.gEq * Math.sin(psi),
    };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // 从地点 o 看天体 b
  function look(o, b) {
    const v = [b.x - o.x, b.y - o.y, b.z - o.z];
    const dist = Math.hypot(v[0], v[1], v[2]);
    const alt = Math.asin(Math.max(-1, Math.min(1, dot(o.U, v) / dist)));   // 重力仰角
    const altG = Math.asin(Math.max(-1, Math.min(1, dot(o.n, v) / dist)));  // 高出地面切面的角
    const az = Math.atan2(dot(o.E, v), dot(o.N, v));                         // 0 北，+90 东
    const hidden = o.r <= P.a || blocked(o.x, o.z, b.x, b.z);
    return { v, dist, alt, altG, az, hidden };
  }
  // 当地时：0＝子夜，0.5＝正午
  function localTime(o, t) { return frac(t - o.ph / TAU); }
  // 月面被照亮的可见比例 k ∈[0,1]（不计塔影）；α 为相位角
  function phaseAngle(o, s, m) {
    const ax = s.x - m.x, ay = s.y - m.y, az = s.z - m.z, bx = o.x - m.x, by = o.y - m.y, bz = o.z - m.z;
    const c = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
    return Math.acos(Math.max(-1, Math.min(1, c)));
  }
  const litFraction = alpha => (1 + Math.cos(alpha)) / 2;
  // 太阳照到月面的照度（大气层顶，lux）
  function sunOnMoon(t) { const s = sunAt(t), m = moonAt(t); const d = Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z); return { E: P.Eref * (Dref / d) ** 2, d }; }
  // 亮月在地点 o 的照度（lux，不计大气）
  function moonIllum(o, t) {
    const s = sunAt(t), m = moonAt(t);
    if (blocked(s.x, s.z, m.x, m.z)) return 0;
    const al = phaseAngle(o, s, m);
    const Ein = sunOnMoon(t).E;
    const dom = Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z);
    const phi = (Math.sin(al) + (Math.PI - al) * Math.cos(al)) / Math.PI;   // 朗伯球相函数
    return Ein * P.pMoon * (P.Rm / dom) ** 2 * phi;
  }
  // 地面直射照度（lux），按地面法线计入射角，含本地大气（平行平板近似）
  function sunOnGround(o, t) {
    const s = sunAt(t); const L = look(o, s);
    if (L.hidden) return 0;
    const ci = Math.sin(L.altG); if (ci <= 0) return 0;
    return P.Eref * (Dref / L.dist) ** 2 * ci * Math.exp(-tauV / ci);
  }

  return { P, Dref, sigma0, tauV, litHalf, sunAt, moonAt, elongation, sunHeight, blocked, isBlack, place, look, localTime, phaseAngle, litFraction, sunOnMoon, moonIllum, sunOnGround, wrapPi, frac };
}

module.exports = { createSky, DEFAULTS, TAU, D2R, R2D };
