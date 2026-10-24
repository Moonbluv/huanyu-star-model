'use strict';
const C = require('./celestial.js');
const { D2R, TAU } = C;
const over = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); over[k] = Number(v); }
const P = C.params(Object.assign({ rhoM: 100 }, over));
const f0 = x => x.toFixed(0), f1 = x => x.toFixed(1), f2 = x => x.toFixed(2);
const TAU0 = 3.912 / P.V * P.H;

// ---------- A. 余息：日照的季节变化（大气顶，赤道入冬日=100） ----------
console.log('## A 日照随季节（大气顶日均，赤道入冬日=100）与余息');
function dailyInsol(O, d0) {
  let sum = 0; const n = 360;
  for (let k = 0; k < n; k++) { const t = d0 + (k + 0.5) / n; const S = C.sunAt(t, P); if (C.blocked(O, S, P)) continue; const v = C.vec(O, S), d = C.norm(v), mu = C.dot(O.n, v) / d; if (mu > 0) sum += mu / (d * d); }
  return sum / n;
}
const EQ = C.place(Math.PI * P.R / 2, 0, P); const REF = dailyInsol(EQ, 0);
const S_LIST = [1000, 2000, 3000, 3600, 4000, 5000, 5600, 6670, 8000, Math.PI * P.R / 2];
const curves = {};
for (const s of S_LIST) {
  const O = C.place(s, 0, P); const arr = [];
  for (let d = 0; d < 360; d += 2) arr.push(dailyInsol(O, d) / REF * 100);
  curves[s] = arr;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length, mx = Math.max(...arr), mn = Math.min(...arr);
  // 降得最快的一天
  let best = 0, bd = 0; for (let i = 0; i < arr.length; i++) { const j = (i + 1) % arr.length; const dd = arr[j] - arr[i]; if (dd < best) { best = dd; bd = i * 2; } }
  const g = P.gEq * Math.sin(s / P.R);
  console.log(`s=${f0(s)}（g=${f2(g)}）年均 ${f0(mean)} 最高 ${f0(mx)}（第${arr.indexOf(mx) * 2}日）最低 ${f0(mn)}（第${arr.indexOf(mn) * 2}日）｜降得最快在入冬后第 ${bd} 日（入冬前 ${(360 - bd) % 360} 日），每日降 ${f2(-best / 2)}`);
}
// 何时塔根一带（s=2000）比平域（s=5000）更暗——冷空气外泄的驱动
{
  const a = curves[2000], b = curves[5000], c = curves[6670]; const cross = [];
  for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; if ((a[i] - b[i]) * (a[j] - b[j]) < 0) cross.push(i * 2); }
  console.log(`轻域 s=2000 与平域 s=5000 日照相等的日子（入冬后）：${cross.join('、')}；在此两日之间（秋→冬→春）轻域更暗`);
  console.log('每 30 日采样（入冬后日数: s=2000 / 3600 / 5000 / 6670 / 赤道）：');
  for (let d = 0; d < 360; d += 30) console.log(`  第${String(d).padStart(3)}日  ${f0(curves[2000][d / 2])} / ${f0(curves[3600][d / 2])} / ${f0(curves[5000][d / 2])} / ${f0(curves[6670][d / 2])} / ${f0(curves[Math.PI * P.R / 2][d / 2])}`);
}

// ---------- B. 夜里的光：对面白昼的反照 vs 月光 ----------
console.log('\n## B 夜里的光源（行星反照率 0.30、月面反照率 0.12、垂直光学厚度 ' + f2(TAU0) + '）');
// 太阳亮度定标：赤道入冬正午大气顶 = 127000 lx（≈地球太阳常数）
const dEq = Math.hypot(EQ.r - P.rs, 0); const K = 127000 * dEq * dEq; // lx·km²
function Esun(d) { return K / (d * d); }
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function basis(n) { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]]; const lu = C.norm(u); u[0] /= lu; u[1] /= lu; u[2] /= lu; const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]; return [u, v]; }
function worldshine(O, S, N) {
  const [u, v] = basis(O.n); let sum = 0;
  for (let i = 0; i < N; i++) {
    const r1 = rnd(), r2 = rnd(); const rr = Math.sqrt(r1), ph = TAU * r2; const mu = Math.sqrt(1 - r1);
    const d = [0, 1, 2].map(k => rr * Math.cos(ph) * u[k] + rr * Math.sin(ph) * v[k] + mu * O.n[k]);
    const Q = { x: O.x + d[0], y: O.y + d[1], z: O.z + d[2] };
    const B = C.wallHit(O, Q, P); if (C.blocked(O, B, P)) continue; // 塔：全黑
    if (C.blocked(B, S, P)) continue; // 对面那里也是夜
    const nB = [-B.x / P.R, -B.y / P.R, -B.z / P.R]; const w = C.vec(B, S); const dw = C.norm(w); const muS = C.dot(nB, w) / dw; if (muS <= 0) continue;
    const L = 0.30 * Esun(dw) * muS / Math.PI;      // 对面地表＋大气的综合反照
    sum += L * Math.exp(-TAU0 / mu);                 // 穿过本地大气
  }
  return Math.PI * sum / N; // 余弦加权估计照度（lx，照在倾斜地面上）
}
function moonlight(O, S, M) {
  if (C.blocked(O, M, P)) return 0; const f = C.diskVisible(M, S, P.rhoS, P); if (f <= 0) return 0;
  const ph = C.phaseAngle(O, S, M); const Phi = (Math.sin(ph) + (Math.PI - ph) * Math.cos(ph)) / Math.PI;
  const D = C.norm(C.vec(O, M)); const dSM = C.norm(C.vec(M, S)); const v = C.vec(O, M); const mu = C.dot(O.n, v) / D;
  return (2 / 3) * 0.12 * Esun(dSM) * f * (P.rhoM / D) ** 2 * Phi * (mu > 0 ? Math.exp(-TAU0 / mu) : 0);
}
for (const [nm, s, lon] of [['伊美忒', 4000, 2], ['罪域', 6670, -4]]) {
  const O = C.place(s, lon, P);
  // 正午直射（地面，含大气）
  const rows = [];
  for (const day of [0, 8, 16, 24, 90, 104, 270, 286]) {
    const tm = Math.round(day - O.lam / TAU) + O.lam / TAU; // 本地子夜
    const S = C.sunAt(tm, P), M = C.moonAt(tm, P);
    const tn = tm + 0.5; const Sn = C.sunAt(tn, P); const vn = C.vec(O, Sn), dn = C.norm(vn), mun = C.dot(O.n, vn) / dn;
    const noon = Esun(dn) * mun * Math.exp(-TAU0 / mun);
    const ws = worldshine(O, S, 60000), ml = moonlight(O, S, M);
    rows.push(`第${day}日子夜：对面白昼反照 ${f0(ws)} lx（正午直射 ${f0(noon)} lx 的 ${f2(ws / noon * 100)}%）｜月光 ${ml > 0 ? f2(ml) + ' lx' : '无（黑月或在塔后）'}`);
  }
  console.log(nm + '\n  ' + rows.join('\n  '));
}
// 晚上最亮的月光
{
  const O = C.place(6670, -4, P); let best = 0, bt = 0;
  for (let t = 0; t < 360; t += 0.01) { const S = C.sunAt(t, P); if (!C.blocked(O, S, P)) continue; const M = C.moonAt(t, P); const ml = moonlight(O, S, M); if (ml > best) { best = ml; bt = t; } }
  console.log(`罪域一年里夜间最亮的月光 ${f2(best)} lx（第 ${f1(bt)} 日）；地球满月约 0.1–0.3 lx`);
}

// ---------- C. 黑曜日（夏末初秋，入冬前约 20–70 日）能否“黑月高悬” ----------
console.log('\n## C 夏末初秋（入冬后第 290–345 日）的黑月高悬夜（仰角>30°，剪影衬亮地，≥30 分钟）');
function hangNights(O, y, d0, d1, emin) {
  const res = [];
  for (let d = d0; d < d1; d++) {
    const tm = y * P.Y + Math.round(d - O.lam / TAU) + O.lam / TAU; let mins = 0, emax = 0, hrs = [];
    for (let h = -6; h <= 6; h += 2 / 60) {
      const t = tm + h / 24; const S = C.sunAt(t, P); if (!C.blocked(O, S, P)) continue; const M = C.moonAt(t, P);
      if (!C.blocked(M, S, P) || C.blocked(O, M, P)) continue; const B = C.wallHit(O, M, P); if (C.blocked(O, B, P) || C.blocked(B, S, P)) continue;
      const L = C.look(O, M); if (L.e < emin) continue; mins += 2; emax = Math.max(emax, L.e); hrs.push(h);
    }
    if (mins >= 30) res.push(`${d}(${f0(emax)}°,${f1(hrs[0])}~${f1(hrs[hrs.length - 1])}h)`);
  }
  return res;
}
for (const [nm, s, lon] of [['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25]]) {
  const O = C.place(s, lon, P);
  for (let y = 0; y < 4; y++) console.log(`${nm} 庆典后第${y}年：${hangNights(O, y, 290, 345, 30).join(' ')}`);
}

// ---------- D. 庆典年逐月要事 ----------
console.log('\n## D 庆典年里的朔望（入冬后日数）');
{
  const ev = [];
  for (let k = 0; k <= 11; k++) {
    const tb = k * P.M; // 冲（黑月正中）
    const tc = k * P.M + P.M / 2; // 合
    const cen = 99.51, half = (180 - cen) / (360 / P.M);
    if (tb < 360) ev.push(`冲·黑月正中 第${f1(tb)}日（黑月 ${f1(tb - half)}~${f1(tb + half)}）`);
    if (tc < 360) ev.push(`合 第${f1(tc)}日`);
  }
  console.log(ev.join('\n'));
}
