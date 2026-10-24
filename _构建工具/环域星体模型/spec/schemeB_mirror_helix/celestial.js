'use strict';
// 方案乙：日月对称双螺旋 —— 纯函数参考实现
// 坐标（地固系，随星体一起转）：原点＝星体球心；y 轴＝塔轴，+y 指向塔顶，塔根极在 y=-R；
// x、z 为塔腰平面。经度 λ 自 +x 起算，λ 增大的方向＝自转方向＝本地“西”。
// 时间 t 以日计；t=0 ＝ 一个庆典年的入冬时刻（太阳正往上越过塔腰），此刻 λ=0 子午线正当子夜。
const TAU = 2 * Math.PI, D2R = Math.PI / 180;

function params(o) {
  const R = 6371;
  return Object.assign({
    R,            // 内表面半径 km
    a: 600,       // 巨塔半径 km
    gEq: 1.4,     // 赤道重力 g
    day: 1,       // 太阳相对地面绕塔一圈 = 1 日
    Y: 360,       // 年 = 太阳上下一个来回（日）
    M: 32,        // 朔望月 = 太阳追上月亮一次（日）
    rs: 640,      // 太阳螺旋半径（离塔面 40 km）
    rm: R / 2,    // 月亮螺旋半径
    A: R / 2,     // 日、月共同的上下振幅（镜像）
    rhoS: 20,     // 太阳本体半径 km
    rhoM: 90,     // 月亮本体半径 km
    H: 40,        // 大气标高 km
    V: 200,       // 近地能见度 km
  }, o || {});
}

// —— 天体位置 ——
function sunAt(t, P) {
  const lam = Math.PI + TAU * t / P.day;                // 每日一圈，东升西落
  const y = P.A * Math.sin(TAU * t / P.Y);              // t=0 往塔顶越过塔腰＝入冬
  return { x: P.rs * Math.cos(lam), y, z: P.rs * Math.sin(lam), lam };
}
function moonAt(t, P) {
  const lam = TAU * t * (1 / P.day - 1 / P.M);         // t=0 正在太阳对面
  const y = -P.A * Math.sin(TAU * t / P.Y);             // 高度与太阳镜像
  return { x: P.rm * Math.cos(lam), y, z: P.rm * Math.sin(lam), lam };
}
// 月亮相对太阳的经度差（-180,180]，0＝合，±180＝冲（黑月正中）
function elongation(t, P) {
  let d = (-180 - 360 * t / P.M) % 360; if (d <= -180) d += 360; if (d > 180) d -= 360; return d;
}

// —— 地点与本地坐标 ——
function place(s, lonDeg, P) {
  const psi = s / P.R, lam = lonDeg * D2R, r = P.R * Math.sin(psi), y = -P.R * Math.cos(psi);
  const c = Math.cos(lam), sn = Math.sin(lam);
  return {
    s, psi, lam, r, x: r * c, y, z: r * sn,
    lat: 90 - psi / D2R,                 // 纬度（0 ＝赤道）＝地面倾角
    g: P.gEq * Math.sin(psi),
    U: [-c, 0, -sn],                     // 上：垂直指向塔轴
    N: [0, -1, 0],                       // 北：朝塔根
    E: [sn, 0, -c],                      // 东：面朝北的右手
    n: [-Math.sin(psi) * c, Math.cos(psi), -Math.sin(psi) * sn], // 地面法线（指向球心）
  };
}
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
function vec(A, B) { return [B.x - A.x, B.y - A.y, B.z - A.z]; }
function norm(v) { return Math.hypot(v[0], v[1], v[2]); }

// —— 遮挡：塔是贯通两极的无限长圆柱，只看水平投影线段是否穿过半径 a 的圆 ——
function segBlocked(ax, az, bx, bz, a) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let u = L2 > 0 ? -(ax * dx + az * dz) / L2 : 0; if (u < 0) u = 0; else if (u > 1) u = 1;
  const cx = ax + u * dx, cz = az + u * dz; return cx * cx + cz * cz < a * a;
}
function blocked(A, B, P) { return segBlocked(A.x, A.z, B.x, B.z, P.a); }
// 圆盘（半径 rho）从视点 V 看露出塔外的面积比例：圆柱竖直，只需沿水平弦取样
const NSAMP = 33, US = [], WS = []; let WSUM = 0;
for (let i = 0; i < NSAMP; i++) { const u = -1 + (2 * i + 1) / NSAMP; US.push(u); WS.push(Math.sqrt(1 - u * u)); WSUM += WS[i]; }
function diskVisible(V, Q, rho, P) {
  const dx = Q.x - V.x, dz = Q.z - V.z, L = Math.hypot(dx, dz);
  if (L < 1e-9 || rho <= 0) return blocked(V, Q, P) ? 0 : 1;
  const px = -dz / L, pz = dx / L; let s = 0;
  for (let i = 0; i < NSAMP; i++) if (!segBlocked(V.x, V.z, Q.x + US[i] * rho * px, Q.z + US[i] * rho * pz, P.a)) s += WS[i];
  return s / WSUM;
}
// 太阳照到月面的比例：0 ＝本影（黑月），1 ＝全亮，其间＝半影
function moonSunlit(t, P, S, Mo) { S = S || sunAt(t, P); Mo = Mo || moonAt(t, P); return diskVisible(Mo, S, P.rhoS, P); }
function isBlackCenter(t, P) { const S = sunAt(t, P), Mo = moonAt(t, P); return blocked(Mo, S, P); }

// 从 O 看天体：高度角（相对“水平”＝垂直于指向塔轴的方向）、方位角（北 0，东 90）、距离
function look(O, Q) {
  const v = vec(O, Q), d = norm(v);
  const e = Math.asin(Math.max(-1, Math.min(1, dot(O.U, v) / d))) / D2R;
  const az = ((Math.atan2(dot(O.E, v), dot(O.N, v)) / D2R) + 360) % 360;
  const g = Math.asin(Math.max(-1, Math.min(1, dot(O.n, v) / d))) / D2R; // 相对地面（倾斜内壁）的高度
  return { e, az, d, g, v };
}
// 月面亮面比例（相位）：k=(1+cosφ)/2，φ＝日-月-人夹角
function litFraction(O, S, Mo) {
  const a = vec(Mo, S), b = vec(Mo, O); const c = dot(a, b) / (norm(a) * norm(b));
  return (1 + c) / 2;
}
function phaseAngle(O, S, Mo) { const a = vec(Mo, S), b = vec(Mo, O); return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))); }
// 射线 O→Q 延长后打到内壁的点（背景）
function wallHit(O, Q, P) {
  const d = vec(O, Q), od = O.x * d[0] + O.y * d[1] + O.z * d[2], dd = dot(d, d);
  const t = -2 * od / dd; // |O|=R
  return { x: O.x + t * d[0], y: O.y + t * d[1], z: O.z + t * d[2] };
}
// 本地太阳时（0＝子夜，0.5＝正午）
function localFrac(t, O, P) { let f = (t / P.day - O.lam / TAU) % 1; if (f < 0) f += 1; return f; }

module.exports = { TAU, D2R, params, sunAt, moonAt, elongation, place, dot, vec, norm, segBlocked, blocked, diskVisible, moonSunlit, isBlackCenter, look, litFraction, phaseAngle, wallHit, localFrac };
