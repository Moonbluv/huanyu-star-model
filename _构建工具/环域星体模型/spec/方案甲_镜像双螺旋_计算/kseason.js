const { createSky, TAU, D2R, R2D } = require('./sky.js');
const opt = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt); const P = sky.P;
const MON = ['十一','十二','一','二','三','四','五','六','七','八','九','十'];
for (const [nm, s, az] of [['圣禁城', 3600, 0], ['伊美忒', 4000, 2], ['涅赫莱恩', 5600, 25], ['罪域', 6670, -4], ['赤道', Math.PI * 6371 / 2, 0]]) {
  const o = sky.place(s, az); const acc = Array.from({ length: 12 }, () => []);
  for (let t = 0; t < 4 * P.Y; t += 1 / 96) {
    const S = sky.sunAt(t); if (!sky.look(o, S).hidden) continue;
    const m = sky.moonAt(t); if (sky.blocked(S.x, S.z, m.x, m.z)) continue; if (sky.look(o, m).hidden) continue;
    const k = sky.litFraction(sky.phaseAngle(o, S, m)); const u = ((t % P.Y) + P.Y) % P.Y; acc[Math.floor(u / 30)].push(k);
  }
  console.log(nm.padEnd(5,'　'), acc.map((a, i) => MON[i] + ':' + (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) : '-')).join(' '));
}
