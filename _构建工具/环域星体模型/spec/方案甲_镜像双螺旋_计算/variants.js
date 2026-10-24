'use strict';
const { createSky, TAU, D2R, R2D } = require('./sky.js');
const { nightScan, summarize } = require('./lib.js');
const f1 = x => x.toFixed(1), f0 = x => x.toFixed(0);

const VARS = [
  ['甲·字面 640/640', { ds: 640, dm: 640, Rm: 30 }],
  ['甲·共径680(十轮满月)', { ds: 680, dm: 680, Rm: 50 }],
  ['甲·共径700', { ds: 700, dm: 700, Rm: 50 }],
  ['甲·共径849(黑月五成)', { ds: 849, dm: 849, Rm: 50 }],
  ['甲·共径1000', { ds: 1000, dm: 1000, Rm: 50 }],
  ['甲·月略外道 640/680', { ds: 640, dm: 680, Rm: 50 }],
  ['甲 640 + M=360/10.75', { ds: 640, dm: 640, Rm: 30, M: 360 / 10.75 }],
  ['甲 680 + M=360/10.75', { ds: 680, dm: 680, Rm: 50, M: 360 / 10.75 }],
  ['对照：镜像但月在 3000', { ds: 640, dm: 3000, Rm: 100, e0: -22.5 }],
  ['对照：v2（月在塔腰 3000）', { ds: 640, dm: 3000, Rm: 100, mirror: false, e0: 180 }],
];
const PL = { 圣禁城: [3600, 0], 伊美忒: [4000, 2], 罪域: [6670, -4], 赤道: [Math.PI * 6371 / 2, 0] };
function tOf(Y, y, mo, d) { return (y - 10018) * Y + (mo - 1) * 30 + (d - 1) - 300; }

for (const [name, o] of VARS) {
  const sky = createSky(o); const P = sky.P;
  const blackPct = (1 - sky.litHalf / Math.PI) * 100;
  const lines = [];
  const cyc = Math.round(4 * P.Y);
  const sums = {};
  for (const [k, [s, az]] of Object.entries(PL)) { const pl = sky.place(s, az); sums[k] = summarize(sky, nightScan(sky, pl, 0, cyc)); }
  // 入冬逢亮月 次数（前 8 年）
  const fest = []; for (let k = 0; k < 8; k++) fest.push(sky.isBlack(k * P.Y) ? '黑' : '亮');
  // 交节时日月最近距离
  let dmin = 1e9; for (let k = 0; k < 4; k++) for (const tt of [k * P.Y, k * P.Y + P.Y / 2]) for (let x = tt - 4; x <= tt + 4; x += 1 / 720) { const a = sky.sunAt(x), b = sky.moonAt(x); dmin = Math.min(dmin, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); }
  // D2 与 深冬黑曜日
  const im = sky.place(4000, 2), zy = sky.place(6670, -4);
  const d2 = nightScan(sky, zy, tOf(P.Y, 10018, 8, 25), 1)[0];
  const dw = nightScan(sky, im, tOf(P.Y, 10008, 1, 5), 1)[0];
  const d9 = nightScan(sky, im, tOf(P.Y, 10008, 9, 3), 1)[0];
  // “十轮满月”：罪域看塔宽 / 10，月在天顶附近最近时所需半径
  const zr = zy.r; const towerW = 2 * Math.asin(P.a / zr);
  const RmNeed = (zr - P.dm) * Math.tan(towerW / 20);
  console.log('\n## ' + name);
  console.log('  黑月占比 ' + f1(blackPct) + '%（每月 ' + f1(blackPct / 100 * P.M) + ' 日）｜月可容半径 ≤ ' + (P.dm - P.a) + ' km（十轮满月需 ≈' + f0(RmNeed) + ' km）｜交节日月最近 ' + f0(dmin) + ' km｜入冬八年：' + fest.join(''));
  for (const [k, sm] of Object.entries(sums)) {
    lines.push('  ' + k + '：夜 ' + f1(sm.nightH) + ' h｜子夜黑月 ' + f1(sm.blackMidPerMonth) + ' 夜/月｜夜见亮月 ' + f1(sm.litVisPct) + '% 的夜（' + f1(sm.litVisPerMonth) + ' 夜/月，均 ' + f0(sm.litVisMeanMin) + ' 分钟，子夜可见 ' + f1(sm.litMidPct) + '%，占夜时 ' + f1(sm.litNightTimePct) + '%，衬塔 ' + f0(sm.litOnTowerPct) + '%）｜黑月高悬 ' + f1(sm.hangPct) + '%（冬半年 ' + f0(sm.hangWinterShare) + '%）');
  }
  console.log(lines.join('\n'));
  console.log('  D2 罪域：' + (d2.litVisMin >= 10 ? '亮月 ' + f0(d2.litVisMin) + ' 分钟' : '无亮月') + '｜深冬一月初五伊美忒：' + (dw.hangMin >= 10 ? '黑月高悬 ' + f0(dw.hangMin) + ' 分钟 @' + f0(dw.hangAlt * R2D) + '°' : '无') + '｜九月初三伊美忒：' + (d9.hangMin >= 10 ? '黑月高悬' : d9.hang30Min >= 10 ? '黑月剪影但低' : '无高悬'));
}
