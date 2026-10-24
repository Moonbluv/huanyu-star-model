'use strict';
// 夜空亮度（对面被照亮的世界）与黑月的“世界照”
const { createSky, TAU, D2R, R2D } = require('./sky.js');
const opt = {};
for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt);
const P = sky.P;
const R = P.R, H = P.H, tauV = sky.tauV, omega = opt.omega != null ? opt.omega : 0.9;

// 凹球面上的气团：从内壁出发、高出切面 α 的射线，到弦中点为止 ∫exp(-h/H) ds / H
const MT = [];
for (let i = 0; i <= 900; i++) {
  const al = Math.max(1e-4, i / 900 * Math.PI / 2);
  const Lh = R * Math.sin(al); // 半弦长
  let acc = 0; const n = 4000;
  // 用 s = Lh * u^3 聚集在近端
  for (let j = 0; j < n; j++) {
    const u0 = j / n, u1 = (j + 1) / n; const um = (u0 + u1) / 2;
    const s = Lh * um ** 3, ds = Lh * (u1 ** 3 - u0 ** 3);
    const h = R - Math.sqrt(R * R - 2 * R * s * Math.sin(al) + s * s);
    acc += Math.exp(-h / H) * ds;
  }
  MT.push(acc / H);
}
const airmass = al => { const x = Math.max(0, Math.min(1, al / (Math.PI / 2))) * 900; const i = Math.min(899, Math.floor(x)); const f = x - i; return MT[i] * (1 - f) + MT[i + 1] * f; };

// 球面网格
const STEPD = 0.5;
const cells = [];
const psiMin = Math.asin(P.a / R);
for (let ps = STEPD / 2; ps < 180; ps += STEPD) {
  const psi = ps * D2R; if (psi < psiMin || psi > Math.PI - psiMin) continue;
  for (let ph = STEPD / 2; ph < 360; ph += STEPD) {
    const p = ph * D2R;
    const r = R * Math.sin(psi);
    cells.push({ x: r * Math.cos(p), y: -R * Math.cos(psi), z: r * Math.sin(p), r, dA: R * R * Math.sin(psi) * (STEPD * D2R) ** 2 });
  }
}

// 某一刻，每个网格点的“被太阳照到的地面亮度”与“本地大气散射亮度”的预备量
function prepare(t) {
  const s = sky.sunAt(t);
  for (const c of cells) {
    c.lit = false;
    if (sky.blocked(c.x, c.z, s.x, s.z)) continue;
    const vx = s.x - c.x, vy = s.y - c.y, vz = s.z - c.z; const d = Math.hypot(vx, vy, vz);
    const sinb = -(c.x * vx + c.y * vy + c.z * vz) / (R * d); // 地面法线 = -P/R
    if (sinb <= 0) continue;
    c.lit = true;
    c.E0 = P.Eref * (sky.Dref / d) ** 2;           // 垂直于光线的大气层顶照度
    c.ms = airmass(Math.asin(sinb));
    c.Eg = c.E0 * sinb * Math.exp(-tauV * c.ms);   // 地面照度
    c.Lland = P.rhoGround * c.Eg / Math.PI;
  }
  return s;
}
// 从点 Q（不在大气里的月亮，或者内壁上的观者）看网格点 c 的亮度
function radianceToward(c, qx, qy, qz) {
  const vx = qx - c.x, vy = qy - c.y, vz = qz - c.z; const d = Math.hypot(vx, vy, vz);
  const sing = -(c.x * vx + c.y * vy + c.z * vz) / (R * d);
  if (sing <= 0) return null;
  const mv = airmass(Math.asin(sing));
  let L = 0;
  if (c.lit) {
    const tr = Math.exp(-tauV * mv);
    const air = omega * c.E0 / (4 * Math.PI) * (mv / (mv + c.ms)) * (1 - Math.exp(-tauV * (mv + c.ms)));
    L = c.Lland * tr + air;
  }
  return { L, sing, d, mv };
}
// 观者 o 在时刻 t 的夜空照度（只计对面世界的光，不计月）
function nightIllum(o, t) {
  prepare(t);
  let Eg = 0, Elevel = 0, Lmax = 0, Lsum = 0, Om = 0;
  for (const c of cells) {
    if (sky.blocked(o.x, o.z, c.x, c.z)) continue;
    const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z; const d = Math.hypot(dx, dy, dz); if (d < 50) continue;
    const rt = radianceToward(c, o.x, o.y, o.z); if (!rt) continue;
    const Lobs = rt.L * Math.exp(-tauV * rt.mv);      // 再穿过观者这一侧的大气
    const dOm = rt.sing * c.dA / (d * d);
    const cosO = (o.n[0] * dx + o.n[1] * dy + o.n[2] * dz) / d;
    const cosU = (o.U[0] * dx + o.U[2] * dz) / d;
    Eg += Lobs * Math.max(0, cosO) * dOm;
    Elevel += Lobs * Math.max(0, cosU) * dOm;
    if (Lobs > Lmax) Lmax = Lobs;
    if (rt.L > 0) { Lsum += Lobs * dOm; Om += dOm; }
  }
  return { Eg, Elevel, Lmax, Lmean: Om > 0 ? Lsum / Om : 0, Om };
}
// 月亮受到的“世界照”：∑L dΩ（垂直照度当量），与直射太阳比
function worldshine(t) {
  const s = prepare(t); const m = sky.moonAt(t);
  let F = 0;
  for (const c of cells) {
    if (sky.blocked(m.x, m.z, c.x, c.z)) continue;
    const rt = radianceToward(c, m.x, m.y, m.z); if (!rt || rt.L <= 0) continue;
    F += rt.L * rt.sing * c.dA / (rt.d * rt.d);
  }
  const dsm = Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z);
  const Edir = P.Eref * (sky.Dref / dsm) ** 2;
  return { F, Edir, ratio: F / Edir, black: sky.blocked(s.x, s.z, m.x, m.z), e: m.e };
}

const PL = [['圣禁城', 3600, 0], ['伊美忒', 4000, 2], ['罪域', 6670, -4], ['赤道', Math.PI * R / 2, 0]];
console.log('τv=', tauV.toFixed(2), '气团(90°)=', airmass(Math.PI / 2).toFixed(3), '气团(30°)=', airmass(Math.PI / 6).toFixed(3), '气团(10°)=', airmass(10 * D2R).toFixed(2), '气团(3°)=', airmass(3 * D2R).toFixed(2));
for (const [nm, s, az] of PL) {
  const o = sky.place(s, az);
  const out = [];
  for (const [lab, u] of [['深冬', 90], ['盛夏', 270], ['入冬', 0]]) {
    const tMid = u + o.ph / TAU;  // 当地子夜
    const r = nightIllum(o, tMid);
    // 对照：当地正午的直射照度
    const noon = sky.sunOnGround(o, u + 0.5 + o.ph / TAU);
    out.push(lab + '子夜: 地面(按坡面) ' + r.Eg.toFixed(0) + ' lux / 水平面 ' + r.Elevel.toFixed(0) + ' lux；亮地平均亮度 ' + r.Lmean.toFixed(0) + ' cd/m²（占天 ' + r.Om.toFixed(2) + ' sr）；同日正午直射 ' + (noon / 1000).toFixed(0) + ' klux');
  }
  console.log(nm + '\n   ' + out.join('\n   '));
}
// 黑月的世界照（深冬某日，月在太阳正对面 / 与太阳差 90°）
console.log('\n黑月受到的世界照（与该处直射太阳之比）');
for (const u of [90, 270]) {
  // 找当年 u 附近 e≈180° 与 e≈-90° 的时刻
  for (const target of [180, -90, 90]) {
    let best = null;
    for (let t = u - 20; t < u + 20; t += 1 / 96) { const e = sky.elongation(t) * R2D; const d = Math.abs(((e - target + 540) % 360) - 180); if (!best || d < best.d) best = { t, d }; }
    const w = worldshine(best.t);
    const lit = sky.P.rhoGround;
    console.log('u≈' + u, 'e=' + (w.e * R2D).toFixed(0) + '°', w.black ? '黑月' : '亮月', '世界照/直射 = ' + (w.ratio * 100).toFixed(2) + '%', '世界照 ' + w.F.toFixed(0) + ' lux', '黑月面亮度≈' + (P.pMoon * w.F / 4 / Math.PI * 1.5).toFixed(1) + ' cd/m²', '（亮月面 ≈ ' + (P.pMoon * w.Edir / Math.PI).toFixed(0) + ' cd/m²）');
  }
}
