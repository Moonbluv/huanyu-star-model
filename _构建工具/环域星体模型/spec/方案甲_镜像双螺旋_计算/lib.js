'use strict';
const { TAU, D2R, R2D } = require('./sky.js');

function background(sky, o, m, t) {
  const P = sky.P;
  const dx = m.x - o.x, dy = m.y - o.y, dz = m.z - o.z; const L = Math.hypot(dx, dy, dz);
  const ux = dx / L, uy = dy / L, uz = dz / L;
  const A2 = ux * ux + uz * uz, B = 2 * (o.x * ux + o.z * uz), C = o.x * o.x + o.z * o.z - P.a * P.a;
  let sT = Infinity; const disc = B * B - 4 * A2 * C;
  if (disc > 0 && A2 > 1e-12) { const s1 = (-B - Math.sqrt(disc)) / (2 * A2); if (s1 > L) sT = s1; }
  const sMin = -(o.x * ux + o.z * uz) / Math.max(A2, 1e-12);
  const dPerp = Math.hypot(o.x + sMin * ux, o.z + sMin * uz);
  const Bs = 2 * (o.x * ux + o.y * uy + o.z * uz), Cs = o.x * o.x + o.y * o.y + o.z * o.z - P.R * P.R;
  const sS = (-Bs + Math.sqrt(Math.max(0, Bs * Bs - 4 * Cs))) / 2;
  if (sT < sS) return { kind: 'tower', dPerp };
  const X = { x: o.x + sS * ux, y: o.y + sS * uy, z: o.z + sS * uz };
  const s = sky.sunAt(t);
  const lit = Math.hypot(X.x, X.z) > P.a && !sky.blocked(X.x, X.z, s.x, s.z);
  // 月盘整个离开塔缘：视线离塔轴的投影距离 > a + 月半径在塔处的投影
  const clear = dPerp > P.a + P.Rm * (sMin > 0 ? sMin / L : 1);
  return { kind: 'world', lit, clear, dPerp };
}

function nightScan(sky, o, tStart, nNights, step) {
  step = step || 1 / 288;
  const res = [];
  const mid0 = Math.round(tStart - o.ph / TAU) + o.ph / TAU;
  for (let k = 0; k < nNights; k++) {
    const tm = mid0 + k;
    const rec = { tm, blackMid: sky.isBlack(tm), litVisMin: 0, litVisAnyMin: 0, kMax: 0, eveMin: 0, mornMin: 0, onTowerMin: 0, lux: 0,
      hangMin: 0, hang30Min: 0, hangAlt: 0, hangLT: null, blackOnTowerMin: 0, nightMin: 0, litMidVisible: false };
    for (let t = tm - 0.5; t < tm + 0.5; t += step) {
      const s = sky.sunAt(t); const Ls = sky.look(o, s);
      if (!Ls.hidden) continue;
      rec.nightMin += step * 1440;
      const m = sky.moonAt(t); const Lm = sky.look(o, m);
      const black = sky.blocked(s.x, s.z, m.x, m.z);
      if (Lm.hidden) continue;
      const bg = background(sky, o, m, t);
      if (!black) {
        const k = sky.litFraction(sky.phaseAngle(o, s, m));
        rec.litVisAnyMin += step * 1440;
        if (k > 0.3) {
          rec.litVisMin += step * 1440; rec.kMax = Math.max(rec.kMax, k);
          if (m.e < 0) rec.eveMin += step * 1440; else rec.mornMin += step * 1440;
          if (bg.kind === 'tower') rec.onTowerMin += step * 1440;
          rec.lux = Math.max(rec.lux, sky.moonIllum(o, t));
          if (Math.abs(t - tm) < step) rec.litMidVisible = true;
        }
      } else {
        if (bg.kind === 'tower') rec.blackOnTowerMin += step * 1440;
        else if (bg.lit && bg.clear) {
          if (Lm.alt >= 45 * D2R) { rec.hangMin += step * 1440; if (Lm.alt > rec.hangAlt) { rec.hangAlt = Lm.alt; rec.hangLT = sky.localTime(o, t); } }
          if (Lm.alt >= 30 * D2R) rec.hang30Min += step * 1440;
        }
      }
    }
    res.push(rec);
  }
  return res;
}

function summarize(sky, rs) {
  const P = sky.P, n = rs.length, months = n / P.M;
  const litVis = rs.filter(r => r.litVisMin >= 10);
  const hang = rs.filter(r => r.hangMin >= 10);
  return {
    blackMidPerMonth: rs.filter(r => r.blackMid).length / months,
    litVisPct: litVis.length / n * 100,
    litVisPerMonth: litVis.length / months,
    litVisMeanMin: litVis.reduce((a, r) => a + r.litVisMin, 0) / Math.max(1, litVis.length),
    litMidPct: rs.filter(r => r.litMidVisible).length / n * 100,
    litNightTimePct: rs.reduce((a, r) => a + r.litVisMin, 0) / rs.reduce((a, r) => a + r.nightMin, 0) * 100,
    litOnTowerPct: rs.reduce((a, r) => a + r.onTowerMin, 0) / Math.max(1, rs.reduce((a, r) => a + r.litVisMin, 0)) * 100,
    hangPct: hang.length / n * 100,
    hangWinterShare: hang.filter(r => (((r.tm % P.Y) + P.Y) % P.Y) < P.Y / 2).length / Math.max(1, hang.length) * 100,
    blackOnTowerPct: rs.filter(r => r.blackOnTowerMin >= 10).length / n * 100,
    nightH: rs.reduce((a, r) => a + r.nightMin, 0) / n / 60,
  };
}

module.exports = { background, nightScan, summarize };
