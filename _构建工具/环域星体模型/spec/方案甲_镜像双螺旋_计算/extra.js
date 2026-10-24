const { createSky, TAU, D2R, R2D } = require('./sky.js');
const { nightScan, background } = require('./lib.js');
const opt = {}; for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); opt[k] = Number(v); }
const sky = createSky(opt); const P = sky.P;
// 1) 黑月高悬：当地时刻与 e 的分布（伊美忒、罪域）
for (const [nm, s, az] of [['伊美忒', 4000, 2], ['罪域', 6670, -4]]) {
  const o = sky.place(s, az);
  const hLT = new Array(24).fill(0); const eH = {}; let tot = 0;
  for (let t = 0; t < 4 * P.Y; t += 1 / 288) {
    const S = sky.sunAt(t); if (!sky.look(o, S).hidden) continue;
    const m = sky.moonAt(t); if (!sky.blocked(S.x, S.z, m.x, m.z)) continue;
    const Lm = sky.look(o, m); if (Lm.hidden || Lm.alt < 45 * D2R) continue;
    const bg = background(sky, o, m, t); if (bg.kind !== 'world' || !bg.lit || !bg.clear) continue;
    const lt = sky.localTime(o, t) * 24; hLT[Math.floor(lt)]++; tot++;
    const eb = Math.round(m.e * R2D / 15) * 15; eH[eb] = (eH[eb] || 0) + 1;
  }
  console.log(nm, '黑月高悬的当地时（时：占比%）', hLT.map((c, i) => c ? i + ':' + (c / tot * 100).toFixed(0) : null).filter(Boolean).join(' '));
  console.log(nm, '黑月高悬时月相对太阳的方位差 e（度：占比%）', Object.entries(eH).sort((a, b) => a[0] - b[0]).map(([k, c]) => k + ':' + (c / tot * 100).toFixed(0)).join(' '));
}
// 2) 庆典夜细节
for (const [nm, s, az] of [['伊美忒', 4000, 2], ['罪域', 6670, -4], ['圣禁城', 3600, 0]]) {
  const o = sky.place(s, az);
  let first = null, last = null, kmin = 1, kmax = 0, luxMax = 0, altA = 0;
  for (let t = -0.6; t < 0.6; t += 1 / 1440) {
    const S = sky.sunAt(t); if (!sky.look(o, S).hidden) continue;
    const m = sky.moonAt(t); const Lm = sky.look(o, m); if (Lm.hidden || sky.isBlack(t)) continue;
    const k = sky.litFraction(sky.phaseAngle(o, S, m));
    if (first === null) first = t; last = t; kmin = Math.min(kmin, k); kmax = Math.max(kmax, k); luxMax = Math.max(luxMax, sky.moonIllum(o, t)); altA = Lm.alt;
  }
  console.log(nm, '庆典夜(入冬)：日落后亮月可见', first === null ? 0 : ((last - first) * 1440).toFixed(0), '分钟；亮面', (kmin * 100).toFixed(0) + '–' + (kmax * 100).toFixed(0) + '%；照度最高', luxMax.toFixed(1), 'lux；仰角', (altA * R2D).toFixed(0) + '°');
}
// 3) 月的视大小
for (const [nm, s, az] of [['伊美忒', 4000, 2], ['罪域', 6670, -4]]) {
  const o = sky.place(s, az); let mn = 1e9, mx = 0;
  for (let t = 0; t < P.Y; t += 0.25) { const m = sky.moonAt(t); const L = sky.look(o, m); if (L.hidden) continue; const a = 2 * Math.atan(P.Rm / L.dist) * R2D; mn = Math.min(mn, a); mx = Math.max(mx, a); }
  const tw = 2 * Math.asin(P.a / o.r) * R2D;
  console.log(nm, '月视直径', mn.toFixed(2) + '°–' + mx.toFixed(2) + '°', '塔宽', tw.toFixed(1) + '°', '→ 塔宽约', (tw / mx).toFixed(1) + '–' + (tw / mn).toFixed(1), '个月亮');
  let smn = 1e9, smx = 0; for (let t = 0; t < P.Y; t += 0.25) { const S = sky.sunAt(t); const L = sky.look(o, S); if (L.hidden) continue; const a = 2 * Math.atan(P.Rs / L.dist) * R2D; smn = Math.min(smn, a); smx = Math.max(smx, a); }
  console.log(nm, '日视直径', smn.toFixed(2) + '°–' + smx.toFixed(2) + '°');
}
// 4) 太阳圆盘对“黑/亮”交界的模糊（半影）宽度
{
  const half = sky.litHalf * R2D; const out = [];
  for (const de of [-6, -4, -2, 0, 2, 4, 6]) {
    const e = (half + de) * D2R; // 在 t 某刻把 e 设成指定值：直接构造
    const S = { x: P.ds, z: 0 }; const M = { x: P.dm * Math.cos(e), z: P.dm * Math.sin(e) };
    let vis = 0, n = 0;
    for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) { const u = i / 20, v = j / 20; if (u * u + v * v > 1) continue; const w = Math.sqrt(1 - u * u - v * v); n += w; if (!sky.blocked(S.x + u * P.Rs, S.z + v * P.Rs, M.x, M.z)) vis += w; }
    out.push('e=lit' + (de >= 0 ? '+' : '') + de + '°: ' + (vis / n * 100).toFixed(0) + '%');
  }
  console.log('月面能见到的日盘比例（半影）', out.join('  '));
}
