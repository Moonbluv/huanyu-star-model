'use strict';
const C = require('./celestial.js');
const { D2R, TAU } = C;
const over = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); over[k] = Number(v); }
const P = C.params(over);
const LOCS = [
  ['圣禁城', 3600, 0], ['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25], ['罪域', 6670, -4], ['赤道', Math.PI * P.R / 2, 0],
];
const f1 = x => x.toFixed(1), f0 = x => x.toFixed(0), f2 = x => x.toFixed(2);
const hm = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
console.log('参数', JSON.stringify(P));

// ---------- 1. 地点几何与巨塔 ----------
console.log('\n## 1 地点几何、巨塔观感');
function towerSky(O) {
  // 均匀抽样“地面以上半球”（绕法线 n）与“重力上半球”（绕 U），算被塔挡住的比例
  let nG = 0, bG = 0, nU = 0, bU = 0; const N = 200000; let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < N; i++) {
    const z = 2 * rnd() - 1, ph = TAU * rnd(), s = Math.sqrt(1 - z * z); const d = [s * Math.cos(ph), z, s * Math.sin(ph)];
    const up = C.dot(d, O.U), gr = C.dot(d, O.n);
    if (gr <= 0 && up <= 0) continue;
    // 射线是否打到塔（在打到内壁之前）
    const Q = { x: O.x + d[0], y: O.y + d[1], z: O.z + d[2] };
    const B = C.wallHit(O, Q, P); const hit = C.blocked(O, B, P);
    if (gr > 0) { nG++; if (hit) bG++; }
    if (up > 0) { nU++; if (hit) bU++; }
  }
  return { ground: bG / nG, upper: bU / nU };
}
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P);
  const w = 2 * Math.asin(P.a / O.r) / D2R;
  const zt = Math.sqrt(P.R * P.R - P.a * P.a);
  const baseEl = Math.atan2(O.r - P.a, Math.abs(-zt - O.y)) / D2R; // 塔根端（北）
  const topEl = Math.atan2(O.r - P.a, Math.abs(zt - O.y)) / D2R;   // 塔顶端（南）
  const ts = towerSky(O);
  const zone = O.r <= P.a ? '塔基' : (O.lat < 3 ? '灵薄' : (O.g < 0.75 ? '轻域' : O.g < 1.2 ? '平域' : '重域'));
  console.log(`${L[0]}\ts=${f0(L[1])} 极距 ${f1(O.psi / D2R)}° 纬度/地面倾角 ${f1(O.lat)}° 离轴 r=${f0(O.r)} y=${f0(O.y)} 重力 ${f2(O.g)}g ${zone}`
    + ` | 塔在天顶宽 ${f1(w)}°，塔根端在北方仰角 ${f1(baseEl)}°，塔顶端在南方仰角 ${f1(topEl)}° | 塔遮去地上半球 ${f0(ts.ground * 100)}%，重力上半球 ${f0(ts.upper * 100)}%`);
}

// ---------- 2. 昼夜 ----------
console.log('\n## 2 昼夜（太阳离塔面固定，各地终年不变）');
function dayNight(O) {
  // 按日心：可见 |Δλ| < τ+δ
  const tau = Math.acos(P.a / O.r), del = Math.acos(P.a / P.rs);
  const dayFrac = (tau + del) / Math.PI;
  // 日面：从第一次被遮到全被遮的时间（日落过程），以及终止线扫地速度
  let t0 = null, t1 = null; const dt = 1 / 86400;
  const tn = 0.5 + O.lam / TAU; // 本地正午附近
  for (let t = tn; t < tn + 0.5; t += dt) {
    const S = C.sunAt(t, P); const f = C.diskVisible(O, S, P.rhoS, P);
    if (t0 === null && f < 0.999) t0 = t; if (f <= 0.001) { t1 = t; break; }
  }
  const sweep = TAU * O.r / 1440; // km/分
  return { dayH: dayFrac * 24, nightH: (1 - dayFrac) * 24, sunsetMin: (t1 - t0) * 1440, sunsetLocal: (t0 - tn) * 24 + 12, sweep };
}
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); const r = dayNight(O);
  console.log(`${L[0]}\t昼 ${hm(r.dayH)} 夜 ${hm(r.nightH)}（昼占 ${f1(r.dayH / 24 * 100)}%）| 日落：日面从开始被塔边吃掉到全没 ${f0(r.sunsetMin)} 分钟（本地 ${f2(r.sunsetLocal)} 时起）| 夜影边扫过地面 ${f1(r.sweep)} km/分，自东向西`);
}

// ---------- 3. 正午太阳高度、日照 ----------
console.log('\n## 3 正午太阳高度（相对“水平”）与日均日照（大气顶，赤道入冬日=100）');
const TAU0 = 3.912 / P.V * P.H; // 垂直光学厚度
function dailyInsol(O, dayIdx, atm) {
  let sum = 0; const n = 720;
  for (let k = 0; k < n; k++) {
    const t = dayIdx + (k + 0.5) / n; const S = C.sunAt(t, P);
    if (C.blocked(O, S, P)) continue;
    const v = C.vec(O, S), d = C.norm(v), mu = C.dot(O.n, v) / d; if (mu <= 0) continue;
    sum += mu / (d * d) * (atm ? Math.exp(-TAU0 / mu) : 1);
  }
  return sum / n;
}
const EQ = C.place(Math.PI * P.R / 2, 0, P); const REF = dailyInsol(EQ, 0, false);
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); const out = [];
  for (const [nm, td] of [['入冬', 0], ['冬至', 90], ['入夏', 180], ['夏至', 270]]) {
    const S = C.sunAt(td + 0.5 + O.lam / TAU, P); const lk = C.look(O, S);
    const dir = lk.e > 89.5 ? '天顶' : (lk.az > 90 && lk.az < 270 ? '南' : '北');
    out.push(`${nm} ${f1(lk.e)}°${dir} 距 ${f0(lk.d)}km 日面 ${f2(2 * Math.atan(P.rhoS / lk.d) / D2R)}° 日照 ${f0(dailyInsol(O, td, false) / REF * 100)}`);
  }
  console.log(L[0] + '\t' + out.join(' | '));
}

// ---------- 4. 黑月几何 ----------
console.log('\n## 4 黑月（塔影里的月）');
let pen = null, cen = null, umb = null;
for (let e = 0; e <= 180; e += 0.005) {
  const S = { x: P.rs, y: 0, z: 0 }, M = { x: P.rm * Math.cos(e * D2R), y: 0, z: P.rm * Math.sin(e * D2R) };
  const f = C.diskVisible(M, S, P.rhoS, P);
  if (pen === null && f < 0.999) pen = e; if (cen === null && C.blocked(M, S, P)) cen = e; if (umb === null && f <= 0.001) { umb = e; break; }
}
const dpd = 360 / P.M; // 每日经度差变化
console.log(`月离太阳 ${f2(pen)}° 起入半影，${f2(cen)}° 月心入影，${f2(umb)}° 全入本影（经度差每日变 ${f2(dpd)}°）`);
console.log(`黑月（月心在影里）每月 ${f2(2 * (180 - cen) / dpd)} 日；本影（全黑）${f2(2 * (180 - umb) / dpd)} 日；入影/出影过渡各 ${f2((umb - pen) / dpd)} 日（约 ${f0((umb - pen) / dpd * 24)} 小时）`);
console.log(`黑月半宽 ${f2((180 - cen) / dpd)} 日 < 8 日（四分之一月）→ 相邻年份的入冬夜不会再逢黑月`);
// 黑月比例 vs 夜比例
for (const L of LOCS) { const O = C.place(L[1], L[2], P); const tau = Math.acos(P.a / O.r), del = Math.acos(P.a / P.rs); console.log(`  ${L[0]} 夜占一日 ${f1((1 - (tau + del) / Math.PI) * 100)}%，黑月占一月 ${f1(2 * (180 - cen) / 360 * 100)}%`); }

// ---------- 5. 逐夜扫描（四年） ----------
console.log('\n## 5 逐夜统计（四年 1440 日，步长 2 分钟）');
const STEP = 2 / 1440;
function scanNights(L, years) {
  const O = C.place(L[1], L[2], P); const nights = [];
  let cur = null;
  const t0 = -O.lam / TAU - 0.5; // 本地正午（前一天）
  for (let t = t0; t < years * P.Y + 0.5; t += STEP) {
    const S = C.sunAt(t, P); const night = C.blocked(O, S, P);
    if (night && !cur) cur = { start: t, moonMin: 0, maxK: 0, hang30: 0, hang45: 0, hangE: [], hangH: [], blackMid: null, hangMaxE: -99, moonE: [], moonAz: [] };
    if (!night && cur) { cur.end = t; nights.push(cur); cur = null; continue; }
    if (!night) continue;
    const M = C.moonAt(t, P);
    const lf = C.localFrac(t, O, P);
    if (cur.blackMid === null && cur.prevLf !== undefined && cur.prevLf > 0.5 && lf < 0.5) { cur.blackMid = C.blocked(M, S, P); cur.midT = t; }
    cur.prevLf = lf;
    const black = C.blocked(M, S, P), vis = !C.blocked(O, M, P);
    if (!vis) continue;
    const lk = C.look(O, M);
    if (!black) {
      const k = C.litFraction(O, S, M);
      if (k > 0.3) { cur.moonMin += 2; if (k > cur.maxK) cur.maxK = k; cur.moonE.push(lk.e); cur.moonAz.push(lk.az); }
    } else {
      // 黑月高悬：月盘整个不压在塔上、背后打到的内壁正被太阳照着
      const B = C.wallHit(O, M, P);
      const clear = !C.blocked(O, B, P);
      // 月盘边缘也不压塔：把月心横移 ±rhoM 再测
      const v = C.vec(O, M), Lh = Math.hypot(v[0], v[2]); const px = -v[2] / Lh, pz = v[0] / Lh;
      const M1 = { x: M.x + P.rhoM * px, y: M.y, z: M.z + P.rhoM * pz }, M2 = { x: M.x - P.rhoM * px, y: M.y, z: M.z - P.rhoM * pz };
      const clearDisk = clear && !C.blocked(O, C.wallHit(O, M1, P), P) && !C.blocked(O, C.wallHit(O, M2, P), P);
      const bgLit = clear && !C.blocked(B, S, P);
      if (clearDisk && bgLit && lk.e > 30) { cur.hang30 += 2; cur.hangE.push(lk.e); cur.hangH.push(lf * 24); if (lk.e > cur.hangMaxE) cur.hangMaxE = lk.e; }
      if (clearDisk && bgLit && lk.e > 45) cur.hang45 += 2;
    }
  }
  return { O, nights };
}
const scans = {};
for (const L of LOCS) {
  const { O, nights } = scanNights(L, 4); scans[L[0]] = nights;
  const N = nights.length;
  const moon = nights.filter(n => n.moonMin > 0).length, moon2 = nights.filter(n => n.moonMin >= 120).length;
  const blackMid = nights.filter(n => n.blackMid === true).length;
  const h30 = nights.filter(n => n.hang30 >= 30).length, h45 = nights.filter(n => n.hang45 >= 30).length;
  const allE = [].concat(...nights.map(n => n.moonE)); allE.sort((a, b) => a - b);
  const hE = [].concat(...nights.map(n => n.hangE)); hE.sort((a, b) => a - b);
  const hH = [].concat(...nights.map(n => n.hangH)).map(h => (h > 12 ? h - 24 : h)); hH.sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.floor(p * (arr.length - 1))] : NaN;
  const avgMoonH = nights.reduce((s, n) => s + n.moonMin, 0) / N / 60;
  const perM = x => f1(x / N * P.M);
  console.log(`${L[0]}\t夜数 ${N}｜子夜逢黑月 ${perM(blackMid)} 夜/月｜夜里见亮月(亮面>30%) ${f0(moon / N * 100)}% 的夜（≥2小时 ${f0(moon2 / N * 100)}%），平均每夜 ${f1(avgMoonH)} 小时；亮月仰角 中位 ${f0(pct(allE, 0.5))}°（5%–95%：${f0(pct(allE, 0.05))}°–${f0(pct(allE, 0.95))}°）`);
  console.log(`\t黑月高悬（剪影、背景是亮着的对面世界）：仰角>30° 至少半小时 ${perM(h30)} 夜/月，>45° ${perM(h45)} 夜/月；高悬时仰角中位 ${f0(pct(hE, 0.5))}°（最高 ${f0(pct(hE, 1))}°）；本地时刻 5%–95%：${f1(pct(hH, 0.05))}…${f1(pct(hH, 0.95))} 时（0＝子夜）`);
}

// ---------- 6. 一年的月相序列（罪域、伊美忒） ----------
console.log('\n## 6 月相序列（每格一夜，自入冬夜起；B＝黑月且有高悬剪影 b＝黑月 无高悬，数字＝夜里能见亮月的最大亮面×10，-＝夜里见不到亮月）');
for (const nm of ['伊美忒', '罪域']) {
  const nights = scans[nm];
  for (let y = 0; y < 4; y++) {
    let line = '';
    const ny = nights.filter(n => n.start >= y * P.Y - 0.5 && n.start < (y + 1) * P.Y - 0.5);
    for (const n of ny) {
      let c;
      if (n.blackMid) c = n.hang30 >= 30 ? 'B' : 'b';
      else if (n.moonMin >= 30) c = String(Math.min(9, Math.floor(n.maxK * 10)));
      else c = (n.hang30 >= 30 ? 'B' : '-');
      line += c;
    }
    console.log(`${nm} 第${y}年（${y === 0 ? '庆典年' : '庆典后' + y + '年'}）:`);
    for (let k = 0; k < line.length; k += 60) console.log('   ' + String(k).padStart(3) + ' ' + line.slice(k, k + 60));
  }
}

// ---------- 7. 入冬、入夏时日月相对位置；庆典周期 ----------
console.log('\n## 7 入冬/入夏：日月同过塔腰时的相对位置');
for (let y = 0; y < 4; y++) {
  for (const [nm, td] of [['入冬', 0], ['入夏', 180]]) {
    const t = y * P.Y + td; const S = C.sunAt(t, P), M = C.moonAt(t, P); const el = C.elongation(t, P);
    const f = C.moonSunlit(t, P);
    const st = f <= 0.001 ? '本影·黑月' : f < 0.999 ? '半影' : '亮';
    const label = Math.abs(Math.abs(el) - 180) < 0.01 ? '冲（日-塔-月一线，黑月正中）' : Math.abs(el) < 0.01 ? '合（月在日外侧同一方向）' : (Math.abs(Math.abs(el) - 90) < 0.01 ? '方照（弦）' : '');
    console.log(`第${y}年${nm}\t日 y=${f0(S.y)} 月 y=${f0(M.y)}｜月在日的${el >= 0 ? '西' : '东'}侧 ${f1(Math.abs(el))}° ${label}｜月面受光 ${f2(f)} ${st}`);
  }
}
console.log('\n入冬之夜（各地本地子夜）是否逢黑月，连续 100 年：');
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); const hits = [];
  for (let y = 0; y < 100; y++) {
    // 入冬时刻 t=y*Y；“入冬之夜”取入冬时刻所在或紧随的本地子夜
    let tm = y * P.Y + (O.lam / TAU) - Math.round(O.lam / TAU); // 本地子夜：localFrac=0
    // 找离入冬时刻最近的本地子夜
    const cand = [Math.floor(y * P.Y - O.lam / TAU) + O.lam / TAU, Math.ceil(y * P.Y - O.lam / TAU) + O.lam / TAU];
    tm = Math.abs(cand[0] - y * P.Y) <= Math.abs(cand[1] - y * P.Y) ? cand[0] : cand[1];
    if (C.isBlackCenter(tm, P)) hits.push(y);
  }
  const gaps = hits.slice(1).map((h, i) => h - hits[i]);
  console.log(`  ${L[0]}：逢黑月的年份 ${hits.slice(0, 8).join(',')}…（共 ${hits.length} 次，间隔 ${[...new Set(gaps)].join('/')} 年）`);
}
// 余量：入冬夜在第1、3年时月离本影边多远
for (const y of [1, 2, 3]) { const el = C.elongation(y * P.Y, P); console.log(`  第${y}年入冬：月离太阳 ${f1(Math.abs(el))}°，离月心入影还差 ${f1(cen - Math.abs(el))}°（${f2((cen - Math.abs(el)) / dpd)} 日）`); }

// ---------- 8. 庆典之夜各地看到什么 ----------
console.log('\n## 8 庆典之夜（第0年入冬，本地子夜前后各 4 小时，每小时）');
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); const tm = Math.round(0 - O.lam / TAU) + O.lam / TAU; const rows = [];
  for (let h = -4; h <= 4; h++) {
    const t = tm + h / 24; const S = C.sunAt(t, P), M = C.moonAt(t, P); const vis = !C.blocked(O, M, P); const lk = C.look(O, M);
    const B = C.wallHit(O, M, P); const bgT = C.blocked(O, B, P); const bgLit = !bgT && !C.blocked(B, S, P);
    const night = C.blocked(O, S, P);
    rows.push(`${h >= 0 ? '+' : ''}${h}h:${night ? '' : '(昼)'}${vis ? `仰${f0(lk.e)}°方位${f0(lk.az)}°${bgT ? '叠在塔上' : bgLit ? '衬亮地' : '衬暗地'}` : '在塔后'}`);
  }
  console.log(`${L[0]}\t${rows.join('  ')}`);
}

// ---------- 9. 月的视大小与“十轮满月填满塔宽” ----------
console.log('\n## 9 月的视大小（月本体半径 ' + P.rhoM + ' km）');
{
  const O = C.place(6670, -4, P); const wTower = 2 * Math.asin(P.a / O.r) / D2R;
  const fulls = []; // 每个朔望月里罪域看到的最“满”的一次
  for (let m = 0; m < 45; m++) {
    let best = null;
    for (let t = m * P.M; t < (m + 1) * P.M; t += 10 / 1440) {
      const S = C.sunAt(t, P), M = C.moonAt(t, P); if (C.blocked(O, M, P) || C.blocked(M, S, P)) continue;
      const k = C.litFraction(O, S, M); if (!best || k > best.k) best = { k, d: C.norm(C.vec(O, M)), t, day: !C.blocked(O, S, P) };
    }
    fulls.push(best);
  }
  const ds = fulls.map(b => b.d).sort((a, b) => a - b), ks = fulls.map(b => b.k).sort((a, b) => a - b);
  const dMed = ds[Math.floor(ds.length / 2)];
  console.log(`罪域：塔在天顶宽 ${f2(wTower)}°；每月最满一次 亮面 ${f2(ks[0])}–${f2(ks[ks.length - 1])}，距 ${f0(ds[0])}–${f0(ds[ds.length - 1])} km（中位 ${f0(dMed)}），其中白天 ${fulls.filter(b => b.day).length}/45`);
  console.log(`  要“十轮满月并排＝塔宽”，满月视径应 ${f2(wTower / 10)}°，在中位距离上月本体半径应 ${f0(Math.tan(wTower / 10 / 2 * D2R) * dMed)} km`);
  console.log(`  当前 rhoM=${P.rhoM}：满月视径 ${f2(2 * Math.atan(P.rhoM / ds[ds.length - 1]) / D2R)}°–${f2(2 * Math.atan(P.rhoM / ds[0]) / D2R)}°（中位 ${f2(2 * Math.atan(P.rhoM / dMed) / D2R)}°）`);
  for (const L of LOCS) {
    const O2 = C.place(L[1], L[2], P); let dmin = 1e9, dmax = 0;
    for (let t = 0; t < P.Y; t += 0.05) { const M = C.moonAt(t, P); if (C.blocked(O2, M, P)) continue; const d = C.norm(C.vec(O2, M)); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    console.log(`  ${L[0]}：可见时月距 ${f0(dmin)}–${f0(dmax)} km → 视径 ${f2(2 * Math.atan(P.rhoM / dmax) / D2R)}°–${f2(2 * Math.atan(P.rhoM / dmin) / D2R)}°`);
  }
}
module.exports = { P };
