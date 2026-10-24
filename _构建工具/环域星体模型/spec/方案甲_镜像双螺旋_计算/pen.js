const { createSky, TAU, D2R, R2D } = require('./sky.js');
const opt = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt); const P = sky.P;
const half = sky.litHalf * R2D; const out = [];
for (const de of [-8, -6, -4, -2, 0, 2, 4, 6, 8]) {
  const e = (half + de) * D2R;
  const Sx = P.ds, Sz = 0, Mx = P.dm * Math.cos(e), Mz = P.dm * Math.sin(e);
  let vis = 0, n = 0;
  for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) { const u = i / 30, v = j / 30; const q = 1 - u * u - v * v; if (q < 0) continue; const w = Math.sqrt(q); n += w; if (!sky.blocked(Sx + u * P.Rs, Sz + v * P.Rs, Mx, Mz)) vis += w; }
  out.push((de >= 0 ? '+' : '') + de + '°:' + (vis / n * 100).toFixed(0) + '%');
}
console.log('litHalf', half.toFixed(1), '月面所见日盘比例（相对亮/黑分界）', out.join(' '));
