const { createSkyA } = require('./ref.js');
const { createSky } = require('./sky.js');
const assert = require('assert');
const A = createSkyA();
const B = createSky({ ds: 680, dm: 680, Rm: 50, M: 360 / 10.75 });
// 位置一致
for (const t of [0, 0.3, 17.25, -3896.4, 123.456]) {
  const a = A.moonAt(t), b = B.moonAt(t); assert(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6);
  const s = A.sunAt(t), u = B.sunAt(t); assert(Math.hypot(s.x - u.x, s.y - u.y, s.z - u.z) < 1e-6);
  assert.strictEqual(A.isBlack(t), B.isBlack(t));
}
// 黑白判定与几何遮挡一致
let mism = 0; for (let t = 0; t < 400; t += 0.01) { const s = A.sunAt(t), m = A.moonAt(t); if (A.blocked(s.x, s.z, m.x, m.z) !== A.isBlack(t)) mism++; }
console.log('isBlack 与线段遮挡不一致的采样数', mism);
// 伊美忒四年统计
const o = A.place(4000, 2); let nights = 0, high = 0, litN = 0;
for (let k = 0; k < 1440; k++) {
  const tm = k + o.ph / (2 * Math.PI); let h = 0, l = 0;
  for (let t = tm - 0.5; t < tm + 0.5; t += 1 / 288) { const v = A.moonView(o, t); if (!v.night) continue; if (v.state === 'blackHigh') h++; if (v.state === 'lit' && v.k > 0.3) l++; }
  nights++; if (h >= 2) high++; if (l >= 2) litN++;
}
console.log('伊美忒：黑月高悬夜占比', (high / nights * 100).toFixed(1) + '%', '夜见亮月夜占比', (litN / nights * 100).toFixed(1) + '%');
console.log('litHalf°', (A.litHalf * 180 / Math.PI).toFixed(2), '自转周期 min', (2 * Math.PI / A.spinRate / 60).toFixed(1));
console.log('toT(10018,11,1)=', A.toT(10018, 11, 1), ' toT(10008,1,5)=', A.toT(10008, 1, 5), ' 庆典年入冬 isBlack', A.isBlack(0));
console.log('OK');
