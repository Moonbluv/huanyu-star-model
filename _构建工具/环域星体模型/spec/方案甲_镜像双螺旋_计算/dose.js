const { createSky, TAU, D2R, R2D } = require('./sky.js');
const opt = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt); const P = sky.P;
function dose(o, u, level) {
  let e = 0; const n = 288;
  for (let i = 0; i < n; i++) {
    const t = u + (i + 0.5) / n; const S = sky.sunAt(t); const L = sky.look(o, S); if (L.hidden) continue;
    const ci = Math.sin(L.altG); const cg = Math.sin(L.alt); const c = level ? cg : ci; if (c <= 0) continue;
    e += P.Eref * (sky.Dref / L.dist) ** 2 * c * Math.exp(-sky.tauV / Math.max(ci, 0.05));
  }
  return e / n * 86400 * (1361 / 127000) / 1e6;
}
const MON = ['十一月初一','十二月初一','一月初一','二月初一','三月初一','四月初一','五月初一','六月初一','七月初一','八月初一','九月初一','十月初一'];
for (const [nm, s] of [['圣禁城', 3600], ['伊美忒', 4000], ['罪域', 6670], ['赤道', Math.PI * 6371 / 2]]) {
  const o = sky.place(s, 0);
  const a = [], b = [];
  for (let m = 0; m < 12; m++) { a.push(dose(o, m * 30, false).toFixed(0)); b.push(dose(o, m * 30, true).toFixed(0)); }
  console.log(nm, '坡面', a.join(' '), '｜水平面', b.join(' '));
}
console.log('列：', MON.join(' '));
