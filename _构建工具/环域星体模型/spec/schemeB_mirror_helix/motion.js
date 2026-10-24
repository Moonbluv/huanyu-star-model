'use strict';
const C = require('./celestial.js');
const { D2R, TAU } = C;
const P = C.params({ rhoM: 100 });
const f0 = x => x.toFixed(0), f1 = x => x.toFixed(1), f2 = x => x.toFixed(2);
const LOCS = [['圣禁城', 3600, 0], ['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25], ['罪域', 6670, -4], ['赤道', Math.PI * P.R / 2, 0]];

// 1. 太阳离塔中线最远多少度；一天里多少时间压在塔面上
console.log('## 太阳的白天：贴着黑带走');
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); let maxOff = 0, onFace = 0, lit = 0;
  const halfW = Math.asin(P.a / O.r) / D2R;
  for (let k = 0; k < 1440; k++) {
    const t = 90 + k / 1440; const S = C.sunAt(t, P); if (C.blocked(O, S, P)) continue; lit++;
    // 太阳方向与“塔轴方向”的横向夹角：投影到水平面，量视线与指向塔轴的夹角
    const vx = S.x - O.x, vz = S.z - O.z; const ang = Math.abs(Math.atan2(vx * (-O.z) - vz * (-O.x), vx * (-O.x) + vz * (-O.z))) / D2R;
    // 注意这是水平投影里的角；换成天球上离塔中线的角距，需乘上 cos 系数，这里取最大水平偏角作上限
    if (ang > maxOff) maxOff = ang;
    const ray = C.wallHit(O, S, P); if (C.blocked(O, ray, P) && !C.blocked(O, S, P)) onFace++;
  }
  console.log(`${L[0]}\t塔在天顶半宽 ${f1(halfW)}°；太阳离塔中线的水平偏角最多 ${f1(maxOff)}°；白天里 ${f0(onFace / lit * 100)}% 的时间太阳衬在黑塔面上`);
}

// 2. 视运动方向：东→西 还是 西→东
console.log('\n## 视运动方向（方位角对时间的变化：东→西＝自东往西挪）');
for (const L of LOCS.slice(0, 4)) {
  const O = C.place(L[1], L[2], P); const cnt = { sunEW: 0, sunWE: 0, litEW: 0, litWE: 0, blkEW: 0, blkWE: 0 };
  for (let t = 0; t < 360; t += 5 / 1440) {
    const S = C.sunAt(t, P), M = C.moonAt(t, P); const dt = 1 / 1440; const S2 = C.sunAt(t + dt, P), M2 = C.moonAt(t + dt, P);
    const ew = (Q, Q2) => { const a = C.vec(O, Q), b = C.vec(O, Q2); return Math.sign(C.dot(O.E, b) / C.norm(b) - C.dot(O.E, a) / C.norm(a)); }; // >0 往东
    const night = C.blocked(O, S, P);
    if (!night) { if (ew(S, S2) < 0) cnt.sunEW++; else cnt.sunWE++; }
    if (night && !C.blocked(O, M, P)) {
      const black = C.blocked(M, S, P);
      const d = ew(M, M2);
      if (!black && C.litFraction(O, S, M) > 0.3) { if (d < 0) cnt.litEW++; else cnt.litWE++; }
      if (black) { if (d < 0) cnt.blkEW++; else cnt.blkWE++; }
    }
  }
  const p = (a, b) => f0(a / (a + b) * 100) + '%';
  console.log(`${L[0]}\t太阳 东→西 ${p(cnt.sunEW, cnt.sunWE)}｜夜里亮月 东→西 ${p(cnt.litEW, cnt.litWE)}（西→东 ${p(cnt.litWE, cnt.litEW)}）｜可见黑月 东→西 ${p(cnt.blkEW, cnt.blkWE)}`);
}

// 3. 日食：月盘压住日盘（从地面看）
console.log('\n## 日食（地面看到月盘压住日盘），四年');
for (const L of LOCS) {
  const O = C.place(L[1], L[2], P); let n = 0, last = -9, maxCov = 0; const days = [];
  for (let t = 0; t < 1440; t += 1 / 1440) {
    const S = C.sunAt(t, P); if (C.blocked(O, S, P)) continue; const M = C.moonAt(t, P);
    const a = C.vec(O, S), b = C.vec(O, M); const da = C.norm(a), db = C.norm(b); if (db > da) continue;
    const sep = Math.acos(Math.min(1, C.dot(a, b) / (da * db))); const rs = Math.atan(P.rhoS / da), rm = Math.atan(P.rhoM / db);
    if (sep < rs + rm) { if (t - last > 1) { n++; days.push(f1(t % 360)); } last = t; }
  }
  console.log(`${L[0]}\t${n} 次${days.length ? '（入冬后第 ' + days.slice(0, 8).join('、') + ' 日…）' : ''}`);
}
