const { createSky, TAU, D2R, R2D } = require('./sky.js');
const { nightScan, background } = require('./lib.js');
const opt = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt); const P = sky.P;
const tOf = (y, mo, d) => (y - 10018) * P.Y + (mo - 1) * 30 + (d - 1) - 300;
function maxSilAlt(o, tm) { // 当夜黑月剪影最高仰角（不限 45°）
  let best = -1;
  for (let t = tm - 0.5; t < tm + 0.5; t += 1 / 288) {
    const S = sky.sunAt(t); if (!sky.look(o, S).hidden) continue;
    const m = sky.moonAt(t); if (!sky.blocked(S.x, S.z, m.x, m.z)) continue;
    const L = sky.look(o, m); if (L.hidden) continue; const bg = background(sky, o, m, t); if (bg.kind !== 'world' || !bg.lit || !bg.clear) continue;
    best = Math.max(best, L.alt * R2D);
  }
  return best;
}
for (const [nm, s, az] of [['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25], ['罪域', 6670, -4]]) {
  const o = sky.place(s, az);
  // 深冬三个月 10007-12-01 ~ 10008-02-30
  const rs = nightScan(sky, o, tOf(10007, 12, 1), 90);
  const hang = rs.filter(r => r.hangMin >= 10).length, lit = rs.filter(r => r.litVisMin >= 10).length;
  // 九月上旬每夜剪影最高仰角
  const sep = []; for (let d = 1; d <= 10; d++) { const tm = Math.round(tOf(10008, 9, d)) + o.ph / TAU; const a = maxSilAlt(o, tm); sep.push(a < 0 ? '–' : a.toFixed(0)); }
  console.log(nm, '深冬三月(10007-12~10008-02)：黑月高悬', hang, '夜 /90，夜见亮月', lit, '夜；10008 九月初一至初十 黑月剪影最高仰角:', sep.join(' '));
}
