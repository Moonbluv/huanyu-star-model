#!/usr/bin/env node
/* 天体与历法自检：node test/astro_check.js
 * 用 src/astro.js（HY.astro）算出规格 spec/01_天体与历法.md 里的全部关键数字，并做断言。
 * 断言失败时进程以 1 退出。统计一律取四年整周期（1440 夜），夜内步长 2 分钟。
 */
'use strict';
const path = require('path');
const H = require(path.join(__dirname, '..', 'src', 'astro.js'));
const P = H.params();
const R2D = H.R2D, D2R = H.D2R;
const t0 = Date.now();

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('  ✗ 断言失败：' + msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + `（得 ${a}，应为 ${b}±${tol}）`); }
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f0 = x => x.toFixed(0);
const pct = x => (x * 100).toFixed(1) + '%';
const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sec = s => console.log('\n【' + s + '】');

const NAMES = ['圣禁城', '伊美忒', '涅赫莱恩', '罪域', '赤道'];
const SITE = {}; for (const n of NAMES) SITE[n] = H.siteByName(n, P);

/* ───────── 1 基本量 ───────── */
sec('1 基本量');
console.log(`R=${P.R} a=${P.a} gEq=${P.gEq} | 自转一周 ${f2(P.spinPeriodMin)} 分 | 年 Y=${P.Y} 日 | 朔望月 M=${P.M.toFixed(4)} 日（一年 ${P.lunPerYear} 月，四年 ${4 * P.lunPerYear} 月）`);
console.log(`日轨 dS=${P.dS}（塔面外 ${P.dS - P.a} km），日半径 ${P.rhoS} | 共用振幅 A=${f1(P.A)} km（=R/2 ${f1(P.R / 2)}）| 月轨 rM=${f1(P.rM)} | 月半径 ${P.rhoM}`);
console.log(`罪域纬线 y=${f1(SITE['罪域'].y)}（回归面 −A=${f1(-P.A)}，差 ${f1(Math.abs(SITE['罪域'].y + P.A))} km）`);
const bS = Math.acos(P.a / P.dS) * R2D, bM = Math.acos(P.a / P.rM) * R2D;
console.log(`黑月半角 β = acos(a/dS)+acos(a/rM) = ${f2(bS)}°+${f2(bM)}° = ${f2(P.beta * R2D)}° | 黑月占 ${pct(P.blackFrac)}，每月 ${f2(P.blackFrac * P.M)} 日 | 每日方位差变 ${f2(360 / P.M)}°`);
near(P.spinPeriodMin, 71.33, 0.05, '自转周期');
near(P.M, 29.3878, 0.0005, '朔望月');
near(P.beta * R2D, 99.51, 0.02, '黑月半角');
console.log(`日面被塔缘切没 ${f1(H.duskMinutes(P))} 分（闭式）| 月心过半影（灰月）${f1(H.greyHours(P))} 小时`);
// 月心受照阈值（只与方位差有关）
function sunlitAtElong(e) { return H.moonSunlit(H.tForElong(e, P), P); }
function solveElong(target) { let lo = 80, hi = 120; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (sunlitAtElong(m) > target) lo = m; else hi = m; } return (lo + hi) / 2; }
const eIn = solveElong(0.999), eHalf = solveElong(0.5), eOut = solveElong(0.001);
const dMoon = Math.atan(P.rhoM / Math.sqrt(P.rM * P.rM - P.a * P.a)) * R2D;
console.log(`月心：|Δ|=${f2(eIn)}° 入半影，${f2(eHalf)}° 入影（受照 50%），${f2(eOut)}° 入本影；月盘半宽折合 ${f2(dMoon)}° → 整个月面 ${f2(eIn - dMoon)}° 开始变暗，${f2(eOut + dMoon)}° 全黑`);
near(eHalf, P.beta * R2D, 0.05, '受照 50% 处＝β');
console.log(`惯性系：日每日 ${f2(P.daySec / (P.spinPeriodMin * 60) + 1)} 圈，月 ${f2(P.daySec / (P.spinPeriodMin * 60) + 1 - 1 / P.M)} 圈 | 托住所需向轴加速度：日 ${f2(H.holdAccel(P.dS, 1, P))} m/s²，月 ${f2(H.holdAccel(P.rM, 1 - 1 / P.M, P))} m/s²`);
console.log(`光度定标：日面 ${P.Tsun} K、半径 ${P.rhoS} km → 赤道入冬正午大气顶 ${f0(P.Sref)} W/m² = ${f0(P.Eref)} lux（反推日面温度 ${f0(H.sunTemperature(P))} K）`);
{
  const eq = SITE['赤道'], tn = H.tOf(10018, 11, 1, 12, eq.az, P);
  const E = H.sunTOA(eq, tn, P, eq.U).lux;
  console.log(`核对：10018 年十一月初一赤道正午大气顶照度 ${f0(E)} lux`);
  near(E, P.Eref, 300, '定标照度');
  near(P.Sref, 767, 2, '定标 W/m²');
}

/* ───────── 2 地点、巨塔与昼夜 ───────── */
sec('2 地点、巨塔、昼夜（昼夜长短终年不变）');
console.log('地点 | s km | 离轴 r | 重力 | 倾角 | 头顶塔宽 | 塔根端仰角(北) | 塔顶端仰角(南) | 昼/夜 h | 夜影扫地 km/分');
for (const n of NAMES) {
  const O = SITE[n], tv = H.towerView(O, P), df = H.dayFraction(O.r, P);
  console.log(`${n} | ${f0(O.s)} | ${f0(O.r)} | ${f2(O.g)}g | ${f1(O.lat)}° | ${f1(tv.width)}° | ${f1(tv.rootEl)}° | ${f1(tv.topEl)}° | ${f2(df * 24)}/${f2((1 - df) * 24)} | ${f1(H.nightEdgeSpeed(O.r, P))}`);
}
near(H.towerView(SITE['罪域'], P).width, 12.49, 0.05, '罪域头顶塔宽');
near(H.dayFraction(SITE['伊美忒'].r, P) * 24, 13.49, 0.02, '伊美忒昼长');

/* ───────── 3 太阳 ───────── */
sec('3 正午太阳（重力仰角，南北）与一日的样子');
const KEYDAYS = [['入冬', 0], ['冬至', 90], ['入夏', 180], ['夏至', 270]];
console.log('地点 | ' + KEYDAYS.map(k => k[0]).join(' | ') + ' | 日落时仰角 冬至/夏至');
function sunsetEl(O, day) {
  const tm = H.localMidnight(day, O, P); let prev = null;
  for (let m = 0; m <= 1440; m++) { const t = tm + m / 1440, a = H.look(O, H.sunPos(t, P), P); if (prev && prev.vis >= 0.5 && a.vis < 0.5) return a.el; prev = a; }
  return NaN;
}
for (const n of NAMES) {
  const O = SITE[n];
  const cols = KEYDAYS.map(([, d]) => { const ns = H.noonSun(O, d + 0.5, P); return f1(ns.el) + '°' + ns.dir; });
  console.log(`${n} | ${cols.join(' | ')} | ${f0(sunsetEl(O, 90))}° / ${f0(sunsetEl(O, 270))}°`);
}
near(H.noonSun(SITE['罪域'], 270.5, P).el, 90, 0.2, '罪域夏至正午日在天顶（回归线）');
// 一日分段
function daySegments(O, day) {
  const tm = H.localMidnight(day, O, P), seg = {}; let maxOff = 0, elMin = 99, elMax = -99, cutMin = 0;
  for (let m = 0; m < 1440; m++) {
    const a = H.sunAspect(O, tm + m / 1440, P);
    const key = a.kind === 'behind' ? '塔后' : a.kind === 'cut' ? '切' : a.kind === 'front' ? '衬塔' : '贴' + a.side + '缘';
    seg[key] = (seg[key] || 0) + 1;
    if (a.kind !== 'behind') { maxOff = Math.max(maxOff, Math.abs(a.hoff)); elMin = Math.min(elMin, a.el); elMax = Math.max(elMax, a.el); }
  }
  return { seg, maxOff, elMin, elMax };
}
for (const n of ['伊美忒', '罪域']) for (const [nm, d] of [['入冬', 0], ['冬至', 90], ['夏至', 270]]) {
  const r = daySegments(SITE[n], d), s = r.seg, h = k => f2((s[k] || 0) / 60);
  console.log(`${n}·${nm}：塔后 ${h('塔后')}h｜切 ${f0((s['切'] || 0) / 2)} 分×2｜贴东缘 ${h('贴东缘')}h｜衬塔 ${h('衬塔')}h｜贴西缘 ${h('贴西缘')}h｜离塔中线最多 ${f1(r.maxOff)}°｜白天仰角 ${f1(r.elMin)}–${f1(r.elMax)}°`);
}
{ // 数值核对日落时长
  const O = SITE['伊美忒'], tm = H.localMidnight(10, O, P); let a = null, b = null;
  for (let s = 0; s < 1440 * 60; s += 5) { const v = H.look(O, H.sunPos(tm + s / 86400, P), P).vis; if (a == null && v < 0.999 && s > 3600 * 12) a = s; if (a != null && b == null && v < 0.001) { b = s; break; } }
  console.log(`数值核对：伊美忒日面由 99.9% 到 0.1% 用时 ${f1((b - a) / 60)} 分`);
  near((b - a) / 60, H.duskMinutes(P), 1.5, '日落时长');
}

/* ───────── 4 日照与余息 ───────── */
sec('4 日照（大气顶，地面法线，MJ/m²·日）与余息');
function dailyDose(O, day) { let s = 0; const tm = H.localMidnight(day, O, P); for (let m = 0; m < 1440; m += 2) s += H.sunTOA(O, tm + (m + 1) / 1440, P).W * 120; return s / 1e6; }
const MON = ['十一', '十二', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
console.log('地点 | ' + MON.map(m => m + '月').join(' '));
const DOSE = {};
for (const [n, s] of [['s=1500', 1500], ['s=2000', 2000], ['s=2500', 2500], ['圣禁城', 3600], ['伊美忒', 4000], ['s=5000', 5000], ['罪域', 6670], ['赤道', null]]) {
  const O = SITES_get(n, s); const arr = []; for (let d = 0; d < 360; d++) arr.push(dailyDose(O, d)); DOSE[n] = arr;
  if (!/^s=/.test(n)) console.log(`${n} | ` + MON.map((_, i) => f0(arr.slice(i * 30, i * 30 + 30).reduce((x, y) => x + y) / 30)).join(' '));
}
function SITES_get(n, s) { if (SITE[n]) return SITE[n]; const m = /^s=(\d+)/.exec(n); return H.site(m ? +m[1] : s, 0, P); }
for (const n of ['s=1500', 's=2000', 's=2500', '圣禁城', '伊美忒', '罪域', '赤道']) {
  const a = DOSE[n], mean = a.reduce((x, y) => x + y) / 360;
  let worst = 0, wd = 0; for (let d = 180; d < 360; d++) { const dd = a[(d + 1) % 360] - a[d]; if (dd < worst) { worst = dd; wd = d; } }
  let below = null; const sv = SITES_get(n, null).s || 0; if (sv < 5000) for (let d = 270; d < 360 + 90; d++) if (a[d % 360] < DOSE['s=5000'][d % 360]) { below = d; break; }
  console.log(`${n}：年均 ${f1(mean)}（${f0(mean * 1e6 / 86400)} W/m²），冬至 ${f1(a[90])}，夏至 ${f1(a[270])}（夏冬比 ${f1(a[270] / a[90])}）｜降得最快在入冬前 ${360 - wd} 日${below == null ? '' : '｜入冬前 ' + (360 - below) + ' 日起比 s=5000 暗'}`);
}

/* ───────── 5 月：四年逐夜统计 ───────── */
sec('5 月：四年 1440 夜统计（口径：夜＝日心被塔挡；亮月＝月心受照≥50%、未被塔挡、亮面>30%；黑月高悬＝月心受照≤10%、露出≥90%、重力仰角≥30°、月心与两缘背后都是亮着的内壁；一夜累计≥10 分钟才算）');
const NIGHTS = {};
function scanNight(O, tm, step) {
  const r = { lit: 0, grey: 0, hang: 0, hang45: 0, kMax: 0, hangEl: -99, diam: [], midBlack: H.isBlackMoon(tm, P), litEl: [], midLit: !!H.litMoonVisible(O, tm, P), east: 0, west: 0, front: 0 };
  for (let m = -720; m < 720; m += step) {
    const t = tm + m / 1440, S = H.sunPos(t, P);
    if (!H.segBlocked(O.x, O.z, S.x, S.z, P.a)) continue;
    const Mo = H.moonPos(t, P), f = H.diskVisible(Mo.x, Mo.z, S.x, S.z, P.rhoS, P.a);
    if (f >= 0.5) {
      const lk = H.look(O, Mo, P); if (lk.vis < 0.5) continue;
      const k = H.litFraction(O, S, Mo);
      if (f < 0.97) r.grey += step;
      if (k > P.litMinK) { r.lit += step; if (k > r.kMax) r.kMax = k; r.diam.push(lk.diam); r.litEl.push(lk.el);
        const l2 = H.look(O, H.moonPos(t + 1 / 1440, P), P); if (l2.hoff > lk.hoff) r.east += step; else r.west += step;
        if (Math.abs(lk.hoff) < Math.asin(P.a / O.r) * R2D) r.front += step; }
    } else if (f <= 0.1) {
      const lk = H.blackMoonHigh(O, t, P); if (lk) { r.hang += step; if (lk.el >= 45) r.hang45 += step; if (lk.el > r.hangEl) r.hangEl = lk.el; }
    }
  }
  return r;
}
console.log('地点 | 子夜黑月 夜/月 | 夜见亮月 夜占比 | 子夜见亮月 | 平均时长 | 亮面中位 冬/夏 | 亮月视径中位 | 亮月仰角中位 | 黑月高悬 夜占比（冬/夏）| ≥45° | 高悬最高仰角 | 亮月往东挪/衬塔');
for (const n of NAMES) {
  const O = SITE[n], arr = [];
  for (let k = 0; k < 1440; k++) { const tm = H.localMidnight(k, O, P); const r = scanNight(O, tm, 2); r.k = k; r.winter = H.yearPhase(tm, P) > 0; arr.push(r); }
  NIGHTS[n] = arr;
  const mb = arr.filter(r => r.midBlack).length / 49;
  const litN = arr.filter(r => r.lit >= P.minMinutes), hangN = arr.filter(r => r.hang >= P.minMinutes);
  const w = arr.filter(r => r.winter), s = arr.filter(r => !r.winter);
  const kW = med(litN.filter(r => r.winter).map(r => r.kMax)), kS = med(litN.filter(r => !r.winter).map(r => r.kMax));
  const diam = med([].concat(...litN.map(r => r.diam))), lel = med([].concat(...litN.map(r => r.litEl)));
  const hw = w.filter(r => r.hang >= P.minMinutes).length / w.length, hs = s.filter(r => r.hang >= P.minMinutes).length / s.length;
  const h45 = arr.filter(r => r.hang45 >= P.minMinutes).length / 1440;
  const tl = arr.reduce((x, r) => x + r.lit, 0);
  console.log(`${n} | ${f1(mb)} | ${pct(litN.length / 1440)} | ${pct(arr.filter(r => r.midLit).length / 1440)} | ${f1(litN.reduce((x, r) => x + r.lit, 0) / litN.length / 60)} h | ${f0(kW * 100)}%/${f0(kS * 100)}% | ${f2(diam)}° | ${f0(lel)}° | ${pct(hangN.length / 1440)}（${pct(hw)}/${pct(hs)}）| ${pct(h45)} | ${f0(Math.max(...arr.map(r => r.hangEl)))}° | ${pct(arr.reduce((x, r) => x + r.east, 0) / tl)}/${pct(arr.reduce((x, r) => x + r.front, 0) / tl)}`);
}
{
  const d = med([].concat(...NIGHTS['罪域'].filter(r => r.lit >= P.minMinutes).map(r => r.diam)));
  const full = []; for (const r of NIGHTS['罪域']) { const tm = H.localMidnight(r.k, SITE['罪域'], P); for (let m = -360; m <= 360; m += 10) { const lk = H.litMoonVisible(SITE['罪域'], tm + m / 1440, P); if (lk && lk.k >= 0.9) full.push(lk.diam); } }
  console.log(`定标：罪域夜里亮月视径中位 ${f2(d)}°；近满月（亮面≥90%）中位 ${f2(med(full))}°，十轮 ${f1(med(full) * 10)}° 对塔宽 ${f1(H.towerView(SITE['罪域'], P).width)}°`);
  near(med(full) * 10, H.towerView(SITE['罪域'], P).width, 1.5, '十轮满月≈罪域塔宽');
}
{ // 近月最大视径、最小离壁距离
  const out = [];
  for (const n of ['圣禁城', '伊美忒', '涅赫莱恩', '罪域']) { const O = SITE[n]; let mx = 0; for (let i = 0; i < 360 * 96; i++) { const lk = H.look(O, H.moonPos(i / 96, P), P); if (lk.diam > mx) mx = lk.diam; } out.push(`${n} ${f2(mx)}°`); }
  let minW = 1e9; for (let i = 0; i < 360 * 24; i++) { const m = H.moonPos(i / 24, P); minW = Math.min(minW, P.R - Math.hypot(m.x, m.y, m.z)); }
  let minWs = 1e9; for (let i = 0; i < 360 * 24; i++) { const s = H.sunPos(i / 24, P); minWs = Math.min(minWs, P.R - Math.hypot(s.x, s.y, s.z)); }
  console.log(`近月最大视径：${out.join('，')} | 月离内壁最近 ${f0(minW)} km，日离内壁最近 ${f0(minWs)} km`);
}

/* ───────── 6 庆典年逐夜月相 ───────── */
sec('6 庆典年逐夜（第 k 夜＝k 日之夜；每行一个民用月；B＝黑月高悬，b＝子夜黑月但不高悬，数字＝夜里见到的亮月最大亮面十分位，○＝≥95%，·＝其余）');
function nightChar(r) {
  if (r.hang >= P.minMinutes) return 'B';
  if (r.lit >= P.minMinutes) return r.kMax >= 0.95 ? '○' : String(Math.min(9, Math.floor(r.kMax * 10)));
  return r.midBlack ? 'b' : '·';
}
for (const n of ['伊美忒', '罪域']) {
  console.log(n + '：（入冬前夜＝庆典夜：' + nightChar(NIGHTS[n][0]) + '）');
  for (let mo = 0; mo < 12; mo++) { let row = ''; for (let d = 1; d <= 30; d++) row += nightChar(NIGHTS[n][mo * 30 + d]); console.log('  ' + (MON[mo] + '月').padEnd(4, '　') + ' ' + row); }
}

/* ───────── 7 庆典与交节 ───────── */
sec('7 四年庆典与交节');
for (let k = 0; k < 4; k++) {
  const c = H.crossings(10018 + k, P);
  const st = x => (x.sunlit < 0.5 ? '黑' : '亮') + `（Δ=${f1(x.elong)}°）`;
  console.log(`第 ${k} 年（${10018 + k}）：入冬 ${st(c.winter)}｜冬至 ${st(c.winterSolstice)}｜入夏 ${st(c.summer)}｜夏至 ${st(c.summerSolstice)}`);
}
console.log(`四年规则余量 ${f2(H.festivalMargin(P))} 日（第 1、3 年入冬是 90° 弦月，离月心入影还差的天数）`);
{
  let bad = 0; const list = [];
  for (let N = 9818; N <= 10218; N++) { const f = H.isFestival(N, P), want = ((N - 10018) % 4 + 4) % 4 === 0; if (f !== want) bad++; if (f && N >= 9998 && N <= 10030) list.push(N); }
  console.log(`400 年逐年检查（9818–10218）：例外 ${bad} 个；庆典年 ${list.join('、')}`);
  ok(bad === 0, '四年一次无例外');
  ok(H.localHour(0, SITE['伊美忒'], P) === 0, '交节在伊美忒子夜');
  // 只对交节那一夜成立：前一夜、后一夜都不行
  const prev = [0, 1, 2, 3].map(k => H.isBlackMoon(k * 360 - 1, P) ? '黑' : '亮').join(''), next = [0, 1, 2, 3].map(k => H.isBlackMoon(k * 360 + 1, P) ? '黑' : '亮').join('');
  console.log(`同一规则若改用前一夜子夜：${prev}；后一夜子夜：${next}（交节那一夜：黑亮亮亮）`);
}
{ // 交节时日月最近
  let mn = 1e9, at = 0; for (let i = -2000; i < 1440 * 30; i++) { const t = i / 30, S = H.sunPos(t, P), M = H.moonPos(t, P); const d = Math.hypot(S.x - M.x, S.y - M.y, S.z - M.z); if (d < mn) { mn = d; at = t; } }
  console.log(`四年里日月最近 ${f0(mn)} km（t=${f1(at)}，${H.dateOf(at, null, P).label}）`);
}
console.log('敏感度（四年规则余量，日；× 表示规则破了）：');
for (const dS of [620, 640, 660, 680]) {
  const row = [2400, 3000, P.R / 2, 4000].map(rM => { const Q = H.params({ dS, rM }); let bad = 0; for (let N = 10018; N < 10118; N++) if (H.isFestival(N, Q) !== ((N - 10018) % 4 === 0)) bad++; return `rM=${f0(rM)}:${bad ? '×' : f2(H.festivalMargin(Q))}`; });
  console.log(`  dS=${dS}  ` + row.join('  '));
}

/* ───────── 8 正文日期 ───────── */
sec('8 正文日期（历法草案：入冬＝十一月初一；某日“夜”＝当日傍晚到次日黎明）');
// 每分钟按月心受照分三态：亮（≥0.97）、灰（0.03–0.97）、黑（≤0.03）；亮、灰只计露在塔外且亮面>30% 的
function nightReport(O, tm) {
  const r = { lit: 0, grey: 0, black: 0, hang: 0, hangEl: -99, kMax: 0, greyFrom: null, greyTo: null, at21: null };
  for (let m = -720; m < 720; m++) {
    const t = tm + m / 1440, S = H.sunPos(t, P); if (!H.segBlocked(O.x, O.z, S.x, S.z, P.a)) continue;
    const Mo = H.moonPos(t, P), f = H.diskVisible(Mo.x, Mo.z, S.x, S.z, P.rhoS, P.a), lk = H.look(O, Mo, P), k = H.litFraction(O, S, Mo);
    if (m === -180) r.at21 = { f, el: lk.el, az: lk.az, k, vis: lk.vis };
    if (f <= 0.03) { r.black++; const h = H.blackMoonHigh(O, t, P); if (h) { r.hang++; r.hangEl = Math.max(r.hangEl, h.el); } continue; }
    if (lk.vis < 0.5 || k <= P.litMinK) continue;
    if (f >= 0.97) { r.lit++; r.kMax = Math.max(r.kMax, k); }
    else { r.grey++; const hh = H.localHour(t, O, P); if (r.greyFrom == null) r.greyFrom = hh; r.greyTo = hh; }
  }
  return r;
}
const DIR8 = az => ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(az / 45) % 8];
function showNight(label, n, N, mo, d) {
  const O = SITE[n], tm = H.nightOf(N, mo, d, O.az, P), r = nightReport(O, tm), a = r.at21;
  console.log(`${label} ${n}：子夜 Δ=${f1(H.elongation(tm, P))}°（${H.moonState(tm, P)}）｜亮月 ${r.lit} 分，亮面最高 ${f0(r.kMax * 100)}%｜灰月 ${r.grey} 分${r.grey ? '（' + f1(r.greyFrom) + '–' + f1(r.greyTo) + ' 时）' : ''}｜黑月 ${r.black} 分，高悬 ${r.hang} 分${r.hang ? '、最高 ' + f0(r.hangEl) + '°' : ''}｜21 时月在${DIR8(a.az)}、仰角 ${f0(a.el)}°、受照 ${f0(a.f * 100)}%、亮面 ${f0(a.k * 100)}%${a.vis < 0.5 ? '（塔后）' : ''}`);
  return r;
}
const d1 = showNight('10018 八月廿四夜（D1，ch7）', '罪域', 10018, 8, 24);
const d2 = showNight('10018 八月廿五夜（D2，ch9–11）', '罪域', 10018, 8, 25);
const d3 = showNight('10018 八月廿六夜（D3）', '罪域', 10018, 8, 26);
ok(d1.lit >= 480 && d1.black === 0, 'D1 整夜亮月');
ok(d2.grey >= 60 && d2.black >= 240 && d2.lit === 0, 'D2 前半夜灰月、后半夜转黑');
ok(d3.lit === 0, 'D3 无亮月');
{ // D2 月心入影的时刻
  let tb = null; for (let m = 0; m < 1440 * 3; m++) { const t = H.tOf(10018, 8, 24, 0, -4, P) + m / 1440; if (H.isBlackMoon(t, P)) { tb = t; break; } }
  const dt = H.dateOf(tb, -4, P); console.log(`月心入影：罪域当地 ${dt.label} ${f1(dt.hour)} 时`);
}
for (let d = 1; d <= 14; d++) {
  const parts = ['伊美忒', '涅赫莱恩', '罪域'].map(n => { const O = SITE[n], tm = H.nightOf(10008, 9, d, O.az, P), r = nightReport(O, tm); return `${n} ${r.hang ? '高悬' + r.hang + '分/' + f0(r.hangEl) + '°' : r.lit || r.grey ? (r.lit ? '亮' + r.lit + '分' : '') + (r.grey ? '灰' + r.grey + '分' : '') : '黑'}`; });
  console.log(`10008 九月${H.dayName(d)}夜：Δ=${f1(H.elongation(H.nightOf(10008, 9, d, 2, P), P))}°｜${parts.join('｜')}`);
}
{ const O = SITE['涅赫莱恩'], r9 = nightReport(O, H.nightOf(10008, 9, 9, O.az, P)); ok(r9.lit + r9.grey >= 480, '10008 九月初九夜涅赫莱恩整夜有月（亮或灰）'); }
{ const O = SITE['罪域'], r10 = nightReport(O, H.nightOf(10008, 9, 10, O.az, P)); ok(r10.hang >= 240 && r10.lit + r10.grey === 0, '10008 九月初十夜罪域黑月高悬≥4 小时'); }
showNight('10008 一月初五夜（序章“深冬”版）', '伊美忒', 10008, 1, 5);
for (const n of ['圣禁城', '伊美忒', '罪域', '赤道']) {
  const O = SITE[n], tm = H.localMidnight(0, O, P); let elMin = 99, elMax = -99, kinds = {}, hang = 0;
  for (let m = -300; m <= 300; m += 2) { const t = tm + m / 1440, S = H.sunPos(t, P); if (!H.segBlocked(O.x, O.z, S.x, S.z, P.a)) continue; const Mo = H.moonPos(t, P), lk = H.look(O, Mo, P); elMin = Math.min(elMin, lk.el); elMax = Math.max(elMax, lk.el); const b = lk.vis < 0.5 ? '塔后' : H.backdrop(O, Mo, t, P, 0); kinds[b] = (kinds[b] || 0) + 2; if (H.blackMoonHigh(O, t, P)) hang += 2; }
  console.log(`庆典夜（10018 十月三十夜，子夜交节）${n}：黑月仰角 ${f0(elMin)}–${f0(elMax)}°，背景 ${Object.entries(kinds).map(([k, v]) => ({ dark: '暗地', lit: '亮地', tower: '塔', '塔后': '塔后' }[k] || k) + v + '分').join(' ')}，高悬 ${hang} 分`);
  if (n === '伊美忒' || n === '圣禁城') ok(hang === 0 && !kinds.lit, n + '庆典夜通宵无月');
}

{ // 黑月期（伊美忒子夜逢黑月的连续夜，按“某日夜”记）
  const O = SITE['伊美忒'], out = []; let start = null, prevLabel = null;
  for (let k = H.tOf(10017, 11, 1, 0, O.az, P); k < H.tOf(10019, 1, 1, 0, O.az, P); k++) {
    const tm = Math.round(k) + (O.az - P.epochAz) / 360, b = H.isBlackMoon(tm, P), lab = H.dateOf(tm - 0.5, O.az, P);
    const L = lab.month + '/' + lab.day;
    if (b && start == null) start = L; if (!b && start != null) { out.push(start + '–' + prevLabel); start = null; } prevLabel = L;
  }
  console.log('黑月期（伊美忒，月/日之夜，10017 年十一月至 10018 年十二月）：' + out.join('，'));
  const opp = []; for (let n = -10; n <= 2; n++) { const t = n * P.M; opp.push(H.dateOf(t, 2, P).label + ' ' + f0(H.dateOf(t, 2, P).hour) + '时'); }
  console.log('黑月正中（日、塔、月一线；伊美忒地方时）：' + opp.join('，'));
}

/* ───────── 9 日食 ───────── */
sec('9 日食（四年，1 分钟步长；从地面看月盘压住日面）');
for (const n of NAMES) {
  const O = SITE[n]; let ev = 0, mins = 0, cur = 0, mx = 0, full = 0, inE = false;
  for (let i = 0; i < 1440 * 1440; i++) {
    const t = i / 1440, S = H.sunPos(t, P);
    if (H.segBlocked(O.x, O.z, S.x, S.z, P.a)) { if (inE) { mx = Math.max(mx, cur); inE = false; } continue; }
    const M = H.moonPos(t, P);
    const vx = S.x - O.x, vy = S.y - O.y, vz = S.z - O.z, wx = M.x - O.x, wy = M.y - O.y, wz = M.z - O.z;
    const ls = Math.hypot(vx, vy, vz), lm = Math.hypot(wx, wy, wz);
    let hit = false;
    if (lm < ls) { const c = (vx * wx + vy * wy + vz * wz) / (ls * lm); if (c > Math.cos(0.2)) { const e = H.eclipseFrac(O, t, P); if (e > 0) { hit = true; if (e >= 0.999) full++; } } }
    if (hit) { mins++; cur = inE ? cur + 1 : 1; if (!inE) ev++; inE = true; } else if (inE) { mx = Math.max(mx, cur); inE = false; }
  }
  console.log(`${n}：${ev} 次，共 ${mins} 分，最长 ${mx} 分，全食 ${full} 分`);
}

/* ───────── 10 光度 ───────── */
sec('10 光度（大气顶；对岸光不计大气消光＝无静滞夜幕时的上限）');
for (const n of ['伊美忒', '罪域', '赤道']) {
  const lux = []; for (const r of NIGHTS[n]) if (r.lit >= P.minMinutes) { const O = SITE[n], tm = H.localMidnight(r.k, O, P); let best = 0; for (let m = -360; m <= 360; m += 10) { const t = tm + m / 1440, S = H.sunPos(t, P); if (!H.segBlocked(O.x, O.z, S.x, S.z, P.a)) continue; if (H.litMoonVisible(O, t, P)) best = Math.max(best, H.moonLux(O, t, P)); } lux.push(best); }
  console.log(`${n}：夜里亮月照度（每夜最亮时）中位 ${f2(med(lux))} lux，最高 ${f2(Math.max(...lux))} lux`);
}
for (const n of ['圣禁城', '伊美忒', '罪域', '赤道']) {
  const O = SITE[n];
  const cells = [['入冬', 0], ['冬至', 90], ['夏至', 270]].map(([nm, d]) => { const tm = H.localMidnight(d, O, P); const E = H.farLight(O, O.n, tm, P); const noon = H.sunTOA(O, tm + 0.5, P).lux; return `${nm} ${f0(E)} lux（当地正午直射的 ${pct(E / noon)}）`; });
  console.log(`子夜对岸光 ${n}：${cells.join('｜')}`);
}
{ // 黑月灰光与亮月亮度对比（罪域）
  const O = SITE['罪域'];
  const tH = H.localMidnight(0, O, P) - 2 / 24;                       // 庆典夜 22 时：黑月
  const Mo = H.moonPos(tH, P), lk = H.look(O, Mo, P), u = lk.v.map(x => -x / lk.dist);
  const X = { x: Mo.x + u[0] * P.rhoM, y: Mo.y + u[1] * P.rhoM, z: Mo.z + u[2] * P.rhoM };
  const Em = H.farLight(X, u, tH, P), Lblack = 1.5 * P.pMoon * Em / Math.PI;
  const d = lk.v.map(x => x / lk.dist), hit = H.rayHit(O, d, P);
  let Lbg = 0; if (hit.kind === 'wall') { const W = hit.X, S = H.sunPos(tH, P), sv = [S.x - W.x, S.y - W.y, S.z - W.z], L = Math.hypot(...sv); const ci = -(W.x * sv[0] + W.y * sv[1] + W.z * sv[2]) / (P.R * L); Lbg = P.albedoFar * P.Eref * (P.Dref / L) ** 2 * Math.max(0, ci) * H.sunlitAt(W, tH, P) / Math.PI; }
  console.log(`黑月灰光（罪域，庆典夜 22 时）：黑月面 ${f0(Lblack)} cd/m²，背后对岸 ${f0(Lbg)} cd/m²，比值 ${pct(Lblack / Lbg)}`);
  const tL = H.nightOf(10018, 8, 24, O.az, P) - 3 / 24, S2 = H.sunPos(tL, P), M2 = H.moonPos(tL, P);
  const dSM = Math.hypot(S2.x - M2.x, S2.y - M2.y, S2.z - M2.z), Lfull = 1.5 * P.pMoon * P.Eref * (P.Dref / dSM) ** 2 / Math.PI;
  const lk2 = H.look(O, M2, P), d2v = lk2.v.map(x => x / lk2.dist), hit2 = H.rayHit(O, d2v, P); let Lbg2 = 0;
  if (hit2.kind === 'wall') { const W = hit2.X, sv = [S2.x - W.x, S2.y - W.y, S2.z - W.z], L = Math.hypot(...sv); const ci = -(W.x * sv[0] + W.y * sv[1] + W.z * sv[2]) / (P.R * L); Lbg2 = P.albedoFar * P.Eref * (P.Dref / L) ** 2 * Math.max(0, ci) * H.sunlitAt(W, tL, P) / Math.PI; }
  console.log(`亮月（罪域，D1 21 时）：月面受照处亮度 ${f0(Lfull)} cd/m²，背后对岸 ${f0(Lbg2)} cd/m²，比值 ${f1(Lfull / Lbg2)} 倍（月面反照率 ${P.pMoon}；若取地球月亮的 0.12，则为 ${f2(Lfull / Lbg2 * 0.12 / P.pMoon)} 倍）`);
  const Q = H.params({ Sref: 1361, Eref: 127000 });
  console.log(`对照：若按地球太阳常数定标（1361 W/m²），日面须 ${f0(H.sunTemperature(Q))} K，上面所有照度 ×${f2(1361 / P.Sref)}`);
}

console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；断言失败 ${fails} 处。`);
process.exit(fails ? 1 : 0);
