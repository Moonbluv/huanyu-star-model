'use strict';
const C = require('./celestial.js');
const { D2R } = C;
const LOCS = [
  ['圣禁城', 3600, 0], ['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25], ['罪域', 6670, -4], ['赤道', Math.PI * 6371 / 2, 0],
];

// 月心在本影/半影的经度差边界（对太阳）
function blackBoundary(P) {
  // 扫 elongation 0..180，找“日心被挡”的起点，以及日面全被挡/开始被挡
  let center = null, umbra = null, pen = null;
  for (let e = 0; e <= 180; e += 0.01) {
    const lamS = 0, lamM = e * D2R;
    const S = { x: P.rs, y: 0, z: 0 }, M = { x: P.rm * Math.cos(lamM), y: 0, z: P.rm * Math.sin(lamM) };
    const f = C.diskVisible(M, S, P.rhoS, P);
    if (pen === null && f < 0.999) pen = e;
    if (center === null && C.blocked(M, S, P)) center = e;
    if (umbra === null && f <= 0.001) { umbra = e; break; }
  }
  return { pen, center, umbra };
}

function nightStats(P, loc, days, step) {
  const O = C.place(loc[1], loc[2], P);
  let nights = 0, moonNights = 0, moonNights2h = 0, hangNights = 0, hangNights45 = 0, blackMid = 0, minutesMoon = 0, nightMin = 0;
  let inNight = false, curMoon = 0, curHang = 0, curHang45 = 0;
  const dt = step / 1440;
  for (let t = 0.5 + 0 - O.lam / C.TAU; t < days; t += dt) {
    const S = C.sunAt(t, P), M = C.moonAt(t, P);
    const night = C.blocked(O, S, P);
    if (night && !inNight) { inNight = true; curMoon = 0; curHang = 0; curHang45 = 0; }
    if (!night && inNight) {
      inNight = false; nights++;
      if (curMoon > 0) moonNights++; if (curMoon >= 120) moonNights2h++;
      if (curHang >= 30) hangNights++; if (curHang45 >= 30) hangNights45++;
    }
    if (!night) continue;
    nightMin += step;
    const black = C.blocked(M, S, P);
    const vis = !C.blocked(O, M, P);
    if (!black && vis) {
      const k = C.litFraction(O, S, M);
      if (k > 0.3) { curMoon += step; minutesMoon += step; }
    }
    if (black && vis) {
      const L = C.look(O, M);
      const B = C.wallHit(O, M, P);
      const bgTower = C.blocked(O, B, P);
      const bgLit = !bgTower && !C.blocked(B, S, P);
      if (bgLit && L.e > 30) curHang += step;
      if (bgLit && L.e > 45) curHang45 += step;
    }
  }
  return { nights, moonFrac: moonNights / nights, moon2hFrac: moonNights2h / nights, hangPerMonth: hangNights / nights * P.M, hang45PerMonth: hangNights45 / nights * P.M, moonHoursPerNight: minutesMoon / nights / 60, nightHours: nightMin / nights / 60 };
}

const base = C.params();
console.log('== 黑月边界随月轨半径（日 rs=640, 日半径 20） ==');
for (const rm of [1800, 2400, 3000, 3185.5, 3600, 4000, 4500, 1e6]) {
  const P = C.params({ rm });
  const b = blackBoundary(P);
  const half = 180 - b.center; // 黑月半宽（度）
  console.log(`rm=${rm}\t半影始 ${b.pen.toFixed(2)}°\t月心入影 ${b.center.toFixed(2)}°\t本影 ${b.umbra.toFixed(2)}°\t黑月(月心) ${(2 * half / 360 * P.M).toFixed(2)} 日/月\t本影 ${(2 * (180 - b.umbra) / 360 * P.M).toFixed(2)} 日\t半影带 ${((b.umbra - b.pen) / 360 * P.M).toFixed(2)} 日×2`);
}

console.log('\n== 夜里亮月与黑月高悬，按月轨半径 ==');
for (const rm of [2400, 3000, 3185.5, 3600, 4000]) {
  const P = C.params({ rm });
  const out = [];
  for (const L of LOCS) {
    const r = nightStats(P, L, 360, 4);
    out.push(`${L[0]} 亮月夜 ${(r.moonFrac * 100).toFixed(0)}%(≥2h ${(r.moon2hFrac * 100).toFixed(0)}%) 高悬>30° ${r.hangPerMonth.toFixed(1)}夜/月 >45° ${r.hang45PerMonth.toFixed(1)}`);
  }
  console.log('rm=' + rm + '\n  ' + out.join('\n  '));
}
