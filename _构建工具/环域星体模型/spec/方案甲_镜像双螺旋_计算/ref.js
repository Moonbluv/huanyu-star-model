// 方案甲′「日月镜像双螺旋」参考实现：纯函数，单位 km、日；无依赖，可直接内联进页面。
// 坐标（地面固连）：y＝塔轴，塔根极 (0,-R,0)、塔顶极 (0,+R,0)，y=0 为塔腰平面；方位角 θ 增大＝朝西。
// 时间 t：自 10018 年十一月初一子夜（方位 0° 处；庆典年入冬，太阳此刻往上越过塔腰）起算的日数。
function createSkyA(opts) {
  const TAU = 2 * Math.PI, D2R = Math.PI / 180;
  const P = Object.assign({
    R: 6371, a: 600, gEq: 1.4,
    T: 24,               // 一日（小时）：太阳相对地面绕塔一圈
    Y: 360,              // 一年（日）：太阳沿塔身上下一个来回
    M: 360 / 10.75,      // 一个月（日）＝33.488：太阳追上月亮一回；Y/M＝10.75 ⇒ 入冬月相四年一轮
    A: 0.7 * 6371,       // 日高振幅 km
    d: 680,              // 日、月共同的离塔轴距离 km（字面版取 640）
    e0: -22.5,           // 度：t=0 时月在太阳以东 22.5°（正＝以西）
    Rs: 26, Rm: 50,      // 日、月半径 km（字面版 Rm ≤ 30）
    pMoon: 0.12,         // 月面几何反照率
    Eref: 127000,        // lux：赤道正午、太阳在塔腰时的大气层顶照度（＝1361 W/m²）
  }, opts || {});
  const Dref = P.R - P.d;
  const wrap = x => { x = (x + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
  const frac = x => x - Math.floor(x);
  const litHalf = 2 * Math.acos(P.a / P.d);              // |e| ≤ litHalf ⇔ 亮月

  const sunY = t => P.A * Math.sin(TAU * t / P.Y);
  function sunAt(t) {
    const th = TAU * (t - 0.5), y = sunY(t);
    return { x: P.d * Math.cos(th), y, z: P.d * Math.sin(th), th };
  }
  const elongation = t => wrap(P.e0 * D2R - TAU * t / P.M);
  function moonAt(t) {
    const e = elongation(t), th = TAU * (t - 0.5) + e;
    return { x: P.d * Math.cos(th), y: -sunY(t), z: P.d * Math.sin(th), th, e };
  }
  // 塔是无限长圆柱：只看水平投影线段是否穿过半径 a 的圆
  function blocked(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let u = L2 > 1e-12 ? -(ax * dx + az * dz) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = ax + u * dx, cz = az + u * dz; return cx * cx + cz * cz < P.a * P.a;
  }
  const isBlack = t => Math.abs(elongation(t)) > litHalf;  // 与 blocked(sun, moon) 等价（同半径时）

  // 地点：s＝沿地面离塔根的距离 km，azDeg＝绕塔方位
  function place(s, azDeg) {
    const psi = Math.max(0, Math.min(Math.PI, s / P.R)), ph = (azDeg || 0) * D2R;
    const r = P.R * Math.sin(psi), y = -P.R * Math.cos(psi), c = Math.cos(ph), sn = Math.sin(ph);
    return { s, psi, ph, r, y, x: r * c, z: r * sn,
      U: [-c, 0, -sn], N: [0, -1, 0], E: [sn, 0, -c],                        // 上（重力反向）、北（塔根）、东
      n: [-Math.sin(psi) * c, Math.cos(psi), -Math.sin(psi) * sn],          // 地面法线（指向球心）
      g: P.gEq * Math.sin(psi), latDeg: 90 - psi / D2R };                    // 纬度＝地面相对水平的倾角
  }
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  function look(o, b) {
    const v = [b.x - o.x, b.y - o.y, b.z - o.z], dist = Math.hypot(v[0], v[1], v[2]);
    return { v, dist,
      alt: Math.asin(dot(o.U, v) / dist),          // 重力仰角（人眼里的“高度”）
      altG: Math.asin(dot(o.n, v) / dist),         // 高出地面切面的角（定大气路径长）
      az: Math.atan2(dot(o.E, v), dot(o.N, v)),    // 0 北，+π/2 东
      hidden: o.r <= P.a || blocked(o.x, o.z, b.x, b.z) };
  }
  const localTime = (o, t) => frac(t - o.ph / TAU);                           // 0 子夜，0.5 正午
  const toT = (year, month, day, hour, azDeg) => (year - 10018) * P.Y + (month - 1) * 30 + (day - 1) - 300 + (hour || 0) / 24 + (azDeg || 0) / 360;
  function phaseAngle(o, s, m) {
    const a = [s.x - m.x, s.y - m.y, s.z - m.z], b = [o.x - m.x, o.y - m.y, o.z - m.z];
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b)))));
  }
  const litFraction = alpha => (1 + Math.cos(alpha)) / 2;                    // 看到的亮面比例
  function moonLux(o, t) {                                                   // 亮月在地面的照度（不计大气）
    if (isBlack(t)) return 0;
    const s = sunAt(t), m = moonAt(t), al = phaseAngle(o, s, m);
    const dsm = Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z), dom = Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z);
    return P.Eref * (Dref / dsm) ** 2 * P.pMoon * (P.Rm / dom) ** 2 * (Math.sin(al) + (Math.PI - al) * Math.cos(al)) / Math.PI;
  }
  // 视线越过天体之后撞上什么：'tower'（塔身做底）或 'world'（对面内壁，附带是否被太阳照着、是否整盘离开塔缘）
  function background(o, b, t, Rb) {
    const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, L = Math.hypot(dx, dy, dz);
    const ux = dx / L, uy = dy / L, uz = dz / L, A2 = ux * ux + uz * uz;
    const B = 2 * (o.x * ux + o.z * uz), C = o.x * o.x + o.z * o.z - P.a * P.a, disc = B * B - 4 * A2 * C;
    const sT = disc > 0 && A2 > 1e-12 ? (-B - Math.sqrt(disc)) / (2 * A2) : Infinity;
    const Bs = 2 * (o.x * ux + o.y * uy + o.z * uz), Cs = o.x * o.x + o.y * o.y + o.z * o.z - P.R * P.R;
    const sS = (-Bs + Math.sqrt(Math.max(0, Bs * Bs - 4 * Cs))) / 2;
    if (sT > L && sT < sS) return { kind: 'tower' };
    const sMin = -(o.x * ux + o.z * uz) / Math.max(A2, 1e-12);
    const dPerp = Math.hypot(o.x + sMin * ux, o.z + sMin * uz);
    const X = { x: o.x + sS * ux, y: o.y + sS * uy, z: o.z + sS * uz }, s = sunAt(t);
    return { kind: 'world', X, lit: Math.hypot(X.x, X.z) > P.a && !blocked(X.x, X.z, s.x, s.z),
      clear: dPerp > P.a + (Rb == null ? P.Rm : Rb) * (sMin > 0 ? sMin / L : 1) };
  }
  // 此刻在地点 o 看到的月：'hidden' 塔后｜'lit' 亮月｜'blackHigh' 黑月高悬｜'blackSil' 黑月剪影（偏低）｜'blackOnTower' 黑月贴在塔前
  function moonView(o, t, highDeg) {
    const s = sunAt(t), m = moonAt(t), Lm = look(o, m), night = look(o, s).hidden;
    if (Lm.hidden) return { state: 'hidden', night, m, Lm };
    if (!isBlack(t)) return { state: 'lit', night, m, Lm, k: litFraction(phaseAngle(o, s, m)), lux: moonLux(o, t) };
    const bg = background(o, m, t);
    if (bg.kind === 'tower') return { state: 'blackOnTower', night, m, Lm };
    if (night && bg.lit && bg.clear) return { state: Lm.alt >= (highDeg || 45) * D2R ? 'blackHigh' : 'blackSil', night, m, Lm };
    return { state: 'blackOther', night, m, Lm };
  }
  // 星体自转（给“神的国”外表面或惯性系视图用）：赤道重力 gEq ⇒ 自转角速度
  const spinRate = Math.sqrt(P.gEq * 9.80665 / (P.R * 1000));               // rad/s；周期≈71.3 分钟
  const toInertial = (th, t) => th + spinRate * 86400 * t;                    // 地面方位 → 惯性系方位

  return { P, Dref, litHalf, sunAt, moonAt, sunY, elongation, isBlack, blocked, place, look, localTime, toT,
    phaseAngle, litFraction, moonLux, background, moonView, spinRate, toInertial };
}
if (typeof module !== 'undefined') module.exports = { createSkyA };
