'use strict';
const { createSky, TAU, D2R, R2D } = require('./sky.js');

const args = process.argv.slice(2);
const opt = {};
for (const a of args) { const [k, v] = a.split('='); opt[k] = v === 'false' ? false : v === 'true' ? true : Number(v); }
const sky = createSky(opt);
const P = sky.P;
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f0 = x => x.toFixed(0);
const deg = x => (x * R2D).toFixed(1) + '°';

const PLACES = [
  { key: '圣禁城', s: 3600, az: 0 },
  { key: '伊美忒', s: 4000, az: 2 },
  { key: '涅赫莱恩', s: 5600, az: 25 },
  { key: '罪域', s: 6670, az: -4 },
  { key: '赤道', s: Math.PI * P.R / 2, az: 0 },
];
for (const p of PLACES) p.o = sky.place(p.s, p.az);

const STEP = 1 / 288;          // 5 分钟
const CYCLE = Math.round(4 * P.Y);  // 四年
const section = t => console.log('\n==== ' + t + ' ====');

// ---------- 0. 参数 ----------
section('参数');
console.log(JSON.stringify(P));
console.log('Dref', sky.Dref, 'tauV', f2(sky.tauV), '月亮被照亮的半角 litHalf =', deg(sky.litHalf),
  '→ 亮月占比', f1(sky.litHalf / Math.PI * 100) + '%', '黑月占比', f1(100 - sky.litHalf / Math.PI * 100) + '%',
  '每月黑月日数', f1((1 - sky.litHalf / Math.PI) * P.M));
const sunT = Math.pow(P.Eref / 127000 * 1361 * (sky.Dref / P.Rs) ** 2 / 5.670e-8, 0.25);
console.log('太阳表面温度(由照度与半径反推) K =', f0(sunT), ' 太阳光度 W =', (4 * Math.PI * (sky.Dref * 1e3) ** 2 * 1361).toExponential(2));
console.log('月亮与塔面间隙 km =', P.dm - P.a - P.Rm, ' 太阳与塔面间隙 km =', P.ds - P.a - P.Rs);

// ---------- 1. 地点 ----------
section('地点');
for (const p of PLACES) {
  const o = p.o;
  const towerW = 2 * Math.asin(P.a / o.r);
  console.log(p.key, 's=' + f0(p.s), 'r=' + f0(o.r), 'y=' + f0(o.y), '纬度/地面倾角=' + f1(o.latDeg) + '°', 'g=' + f2(o.g),
    '塔宽(天顶处)=' + deg(towerW), '日月偏离塔中线最大≈' + deg(Math.asin(P.ds / o.r)));
}

// ---------- 2. 昼夜 ----------
section('昼夜长短（与季节无关：太阳离塔距离固定）');
function dayNight(o, t0) {
  let lit = 0, n = 1440;
  for (let i = 0; i < n; i++) { const s = sky.sunAt(t0 + (i + 0.5) / n); if (!sky.look(o, s).hidden) lit++; }
  return lit / n;
}
for (const p of PLACES) {
  const ana = (Math.acos(P.a / P.ds) + Math.acos(P.a / p.o.r)) / Math.PI;
  const num = dayNight(p.o, 0);
  console.log(p.key, '昼 ' + f2(ana * P.T) + ' h，夜 ' + f2((1 - ana) * P.T) + ' h', '(数值 ' + f2(num * P.T) + ')');
}

// ---------- 3. 正午太阳、日落、日照 ----------
section('正午太阳高度（重力仰角 / 地面切面仰角 / 方位）与照度');
// u：入冬后日数。冬至式＝u=90（太阳最高 +A）；夏至式＝u=270（太阳最低 -A）
function noonInfo(o, u) {
  const t = u + 0.5 + o.ph / TAU;     // 当地正午
  const s = sky.sunAt(t); const L = sky.look(o, s);
  return { alt: L.alt, altG: L.altG, az: L.az, E: sky.sunOnGround(o, t), dist: L.dist };
}
function dailyDose(o, u) { // MJ/m²/日（地面法线、含大气）
  let e = 0; const n = 288;
  for (let i = 0; i < n; i++) e += sky.sunOnGround(o, u + (i + 0.5) / n);
  return e / n * 24 * 3600 * (1361 / 127000) / 1e6;
}
const eqRef = PLACES[4].o;
const doseRef = dailyDose(eqRef, 0);
for (const p of PLACES) {
  const rows = [['入冬(过塔腰)', 0], ['深冬(日最高)', 90], ['入夏(过塔腰)', 180], ['盛夏(日最低)', 270]];
  const out = rows.map(([nm, u]) => {
    const ni = noonInfo(p.o, u);
    return nm + ': 仰角 ' + f1(ni.alt * R2D) + '° (切面 ' + f1(ni.altG * R2D) + '°) ' + (Math.abs(ni.az * R2D) < 90 ? '北' : '南') + '天，照度 ' + f0(ni.E / 1000) + ' klux，日照量 ' + f1(dailyDose(p.o, u)) + ' MJ/m²';
  });
  console.log(p.key + '\n   ' + out.join('\n   '));
}
console.log('参照：赤道入冬日日照量', f1(doseRef), 'MJ/m²/日');

section('日落时刻的太阳（太阳在塔缘被吞没时）');
function sunsetInfo(o, u) {
  // 找当地正午之后第一次被遮挡的时刻
  const tNoon = u + 0.5 + o.ph / TAU;
  let t = tNoon, dt = 1 / 1440;
  while (!sky.look(o, sky.sunAt(t)).hidden) t += dt;
  const tset = t - dt / 2;
  const L = sky.look(o, sky.sunAt(tset - dt));
  // 日面被吞没的时长：二维投影里太阳圆盘越过塔缘切线
  const ang = tt => { // 二维：观者→太阳方向 与 观者→塔切点方向 的夹角（正＝未遮）
    const s = sky.sunAt(tt); const dx = s.x - o.x, dz = s.z - o.z;
    const h = Math.hypot(dx, dz); const toAxis = Math.atan2(-o.z, -o.x); const dirS = Math.atan2(dz, dx);
    const half = Math.asin(P.a / o.r);
    return { gap: Math.abs(sky.wrapPi(dirS - toAxis)) - half, h };
  };
  let t1 = tset, t2 = tset; const step = 1 / 86400;
  while (true) { const g = ang(t1); if (g.gap > Math.asin(P.Rs / g.h)) break; t1 -= step; }
  while (true) { const g = ang(t2); if (g.gap < -Math.asin(P.Rs / g.h)) break; t2 += step; }
  return { alt: L.alt, altG: L.altG, lt: sky.localTime(o, tset), dur: (t2 - t1) * 1440, airmass: 1 / Math.sin(L.altG) };
}
for (const p of PLACES) {
  const a = sunsetInfo(p.o, 90), b = sunsetInfo(p.o, 270), c = sunsetInfo(p.o, 0);
  console.log(p.key, '深冬日落：仰角 ' + f1(a.alt * R2D) + '° 气团 ' + f2(a.airmass) + '｜盛夏日落：仰角 ' + f1(b.alt * R2D) + '° 气团 ' + f2(b.airmass) + '｜入冬日落：仰角 ' + f1(c.alt * R2D) + '°' + '｜日面没入塔缘历时 ' + f1(a.dur) + ' 分钟');
}

// 一天里太阳在天上走多远
section('一天里太阳的视位置变化（入冬日）');
for (const p of PLACES) {
  let minAz = 1e9, maxAz = -1e9, minAlt = 1e9, maxAlt = -1e9;
  for (let i = 0; i < 1440; i++) {
    const t = i / 1440; const L = sky.look(p.o, sky.sunAt(t)); if (L.hidden) continue;
    // 以塔中线为基准的东西偏角：E 分量 / 距离
    const ew = Math.asin((L.v[0] * p.o.E[0] + L.v[2] * p.o.E[2]) / L.dist);
    minAz = Math.min(minAz, ew); maxAz = Math.max(maxAz, ew); minAlt = Math.min(minAlt, L.alt); maxAlt = Math.max(maxAlt, L.alt);
  }
  console.log(p.key, '东西摆幅 ' + deg(minAz) + ' ~ ' + deg(maxAz) + '，仰角 ' + deg(minAlt) + ' ~ ' + deg(maxAlt));
}

// ---------- 4. 月 ----------
section('月：每月黑月夜数、夜里能见亮月的夜数');
const LIB = require('./lib.js');
const nightScan = (o, t0, n) => LIB.nightScan(sky, o, t0, n);

const scans = {};
for (const p of PLACES) {
  const rs = nightScan(p.o, 0, CYCLE);
  scans[p.key] = rs;
  const n = rs.length, months = n / P.M;
  const blackMid = rs.filter(r => r.blackMid).length;
  const litVis = rs.filter(r => r.litVisMin >= 10);
  const litVis30 = rs.filter(r => r.litVisMin >= 30);
  const litAny = rs.filter(r => r.litVisAnyMin >= 10);
  const nightMin = rs.reduce((a, r) => a + r.nightMin, 0);
  const litMin = rs.reduce((a, r) => a + r.litVisMin, 0);
  const eve = rs.reduce((a, r) => a + r.eveMin, 0), morn = rs.reduce((a, r) => a + r.mornMin, 0);
  const onT = rs.reduce((a, r) => a + r.onTowerMin, 0);
  const maxDur = Math.max(...rs.map(r => r.litVisMin));
  const meanDur = litVis.reduce((a, r) => a + r.litVisMin, 0) / Math.max(1, litVis.length);
  const luxes = litVis.map(r => r.lux).sort((a, b) => a - b);
  const med = luxes.length ? luxes[Math.floor(luxes.length / 2)] : 0;
  console.log(p.key,
    '\n   子夜黑月：每月 ' + f1(blackMid / months) + ' 夜（' + f1(blackMid / n * 100) + '%）',
    '\n   夜里见到亮月(非黑、不在塔后、亮面>30%)≥10分钟的夜：' + f1(litVis.length / n * 100) + '%（每月 ' + f1(litVis.length / months) + ' 夜）；≥30分钟：' + f1(litVis30.length / n * 100) + '%；亮面不限 ≥10 分钟：' + f1(litAny.length / n * 100) + '%',
    '\n   这些夜里亮月可见时长：平均 ' + f0(meanDur) + ' 分钟，最长 ' + f0(maxDur) + ' 分钟；占全部夜间时长 ' + f2(litMin / nightMin * 100) + '%；其中黄昏(月在日东) ' + f0(eve / Math.max(1, litMin) * 100) + '%、黎明 ' + f0(morn / Math.max(1, litMin) * 100) + '%；以塔身为底 ' + f0(onT / Math.max(1, litMin) * 100) + '%',
    '\n   亮月最大照度中位数 ' + med.toFixed(3) + ' lux（地球满月约 0.25）；最大 ' + (luxes.length ? luxes[luxes.length - 1].toFixed(2) : '-') + ' lux');
}

// ---------- 5. 一年月相序列 ----------
section('伊美忒：庆典年（入冬起）逐夜月相');
{
  const rs = scans['伊美忒'];
  const MONTHS = ['十一月', '十二月', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月'];
  for (let mI = 0; mI < 12; mI++) {
    let line = '';
    for (let d = 0; d < 30; d++) {
      const r = rs[mI * 30 + d];
      let c;
      if (r.litVisMin >= 10) c = r.kMax >= 0.95 ? '○' : String(Math.min(9, Math.floor(r.kMax * 10)));
      else if (r.hangMin >= 10) c = '◆';
      else if (r.blackMid) c = '●';
      else c = '·';
      line += c;
    }
    console.log(MONTHS[mI].padEnd(4, '　'), line);
  }
  console.log('图例：数字＝夜里能见的亮月，亮面最大的十分位（3＝30%多）；○＝亮面≥95%；◆＝黑月高悬（黑月以剪影悬在亮着的对面世界前，仰角≥45°）；●＝子夜是黑月；·＝亮月但只在白天/塔后');
}

// ---------- 6. 入冬/入夏的日月相对位置 ----------
section('入冬、入夏时刻（日月同时过塔腰）');
for (let k = 0; k < 4; k++) {
  for (const [nm, tt] of [['入冬', k * P.Y], ['入夏', k * P.Y + P.Y / 2]]) {
    const s = sky.sunAt(tt), m = sky.moonAt(tt);
    const black = sky.isBlack(tt);
    // 前后 4 日内的最近距离
    let dmin = 1e9, tmin = 0;
    for (let x = tt - 4; x <= tt + 4; x += 1 / 1440) { const a = sky.sunAt(x), b = sky.moonAt(x); const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); if (d < dmin) { dmin = d; tmin = x; } }
    const Ein = P.Eref * (sky.Dref / dmin) ** 2;
    const Wm2 = Ein / 127000 * 1361;
    const Teq = Math.pow(Wm2 * (1 - 0.12) / (4 * 5.670e-8), 0.25);
    console.log('第' + k + '年' + nm, 'e=' + f1(m.e * R2D) + '°', black ? '黑月' : '亮月', '日月间距 ' + f0(Math.hypot(s.x - m.x, s.y - m.y, s.z - m.z)) + ' km',
      '｜前后四日最近 ' + f0(dmin) + ' km（' + f2(tmin - tt) + ' 日）', '月受照 ' + f0(Ein / P.Eref) + '×基准', '月面平衡温度≈' + f0(Teq) + ' K');
  }
}

// ---------- 7. 四年庆典 ----------
section('入冬之夜与庆典周期（伊美忒）');
{
  const o = PLACES[1].o;
  const row = [];
  for (let k = 0; k < 8; k++) {
    const [r] = nightScan(o, k * P.Y, 1);
    const e = sky.elongation(k * P.Y) * R2D;
    row.push('第' + k + '年: e=' + f1(e) + '° ' + (sky.isBlack(k * P.Y) ? '黑' : '亮') + (r.litVisMin >= 10 ? '（夜里可见亮月 ' + f0(r.litVisMin) + ' 分钟，亮面 ' + f0(r.kMax * 100) + '%）' : '') + (r.hangMin >= 10 ? '（黑月高悬 ' + f0(r.hangMin) + ' 分钟）' : ''));
  }
  console.log(row.join('\n'));
  // 扫 e0：两种规则各自多少年一遇
  const rules = { '逢亮月': e => Math.abs(e) <= sky.litHalf, '逢黑月': e => Math.abs(e) > sky.litHalf };
  for (const [nm, fn] of Object.entries(rules)) {
    const hist = {};
    for (let e0 = -180; e0 < 180; e0 += 1) {
      let c = 0; for (let k = 0; k < 4; k++) { const e = sky.wrapPi(e0 * D2R - TAU * k * P.Y / P.M); if (fn(e)) c++; }
      hist[c] = (hist[c] || 0) + 1;
    }
    console.log('规则「入冬' + nm + '」：在全部 e0 取值里，每四年出现次数的分布', JSON.stringify(hist));
  }
}

// ---------- 8. 黑月高悬 ----------
section('黑月高悬（夜里、黑月、不在塔后、背后是被照亮的对面世界、整盘离开塔缘）');
for (const p of PLACES) {
  const rs = scans[p.key];
  const n = rs.length;
  const hang = rs.filter(r => r.hangMin >= 10);
  const hang30 = rs.filter(r => r.hang30Min >= 10);
  const winter = hang.filter(r => (((r.tm % P.Y) + P.Y) % P.Y) < P.Y / 2).length;
  const onTower = rs.filter(r => r.blackOnTowerMin >= 10).length;
  const lts = hang.map(r => r.hangLT).filter(x => x != null).map(x => ((x + 0.5) % 1) * 24 - 12);
  const alts = hang.map(r => r.hangAlt * R2D);
  const meanMin = hang.reduce((a, r) => a + r.hangMin, 0) / Math.max(1, hang.length);
  console.log(p.key, '仰角≥45°：' + f1(hang.length / n * 100) + '% 的夜（冬半年占 ' + f0(winter / Math.max(1, hang.length) * 100) + '%），每次约 ' + f0(meanMin) + ' 分钟，最高仰角 ' + (alts.length ? f0(Math.max(...alts)) : '-') + '°',
    '｜仰角≥30°：' + f1(hang30.length / n * 100) + '%',
    '｜黑月贴在塔身前(黑底黑月)：' + f1(onTower / n * 100) + '% 的夜');
}

// ---------- 9. 正文日期 ----------
section('正文日期检验（t=0 ≡ 10018 年十一月初一子夜，庆典年）');
function tOf(y, mo, d) { return (y - 10018) * P.Y + (mo - 1) * 30 + (d - 1) - 300; }
const DATES = [
  ['黑曜日·九月初一(10008)', 10008, 9, 1], ['黑曜日·九月初五(10008)', 10008, 9, 5], ['黑曜日·九月初十(10008)', 10008, 9, 10],
  ['深冬·十二月十五(10007)', 10007, 12, 15], ['深冬·一月初五(10008)', 10008, 1, 5], ['深冬·一月十五(10008)', 10008, 1, 15],
  ['D1 八月廿四(10018)', 10018, 8, 24], ['D2 八月廿五(10018)', 10018, 8, 25], ['D3 八月廿六(10018)', 10018, 8, 26],
  ['ch26 尾声 九月下旬(10018)', 10018, 9, 25], ['入冬 十一月初一(10018)', 10018, 11, 1],
];
for (const [nm, y, mo, d] of DATES) {
  const t = tOf(y, mo, d);
  const e = sky.elongation(t) * R2D; const black = sky.isBlack(t); const mh = sky.moonAt(t).y;
  const parts = [];
  for (const key of ['伊美忒', '涅赫莱恩', '罪域']) {
    const o = PLACES.find(p => p.key === key).o;
    const [r] = nightScan(o, t, 1);
    parts.push(key + ':' + (r.litVisMin >= 10 ? '亮月' + f0(r.litVisMin) + '分(' + f0(r.kMax * 100) + '%,' + (r.eveMin > r.mornMin ? '黄昏' : '黎明') + ')' : '') + (r.hangMin >= 10 ? '黑月高悬' + f0(r.hangMin) + '分@' + f0(r.hangAlt * R2D) + '°' : (r.hang30Min >= 10 ? '黑月剪影(低于45°)' : '')) || '无');
  }
  console.log(nm.padEnd(22), 't=' + t, 'e=' + f1(e) + '°', black ? '黑' : '亮', '月高 y=' + f0(mh), '｜' + parts.join('｜'));
}

module.exports = { sky, PLACES };
