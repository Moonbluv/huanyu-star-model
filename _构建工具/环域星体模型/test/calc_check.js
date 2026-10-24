#!/usr/bin/env node
/* calc_check —— HY.calc 自检（规格：spec/03 第十一节第 1 条；统筹修订见 spec/04 第二节第 1 条）
 * 一律对照 spec/01 的数字（第五节第 5 条、第七节第 4 条、第八节第 2 条、第十三节）与 HY.astro 的直接取样。
 * 数字的唯一来源是 HY.astro；这里的“暴力取样”只用来核对 HY.calc 的二分、积分与搜索没有漏、没有偏。
 */
'use strict';
const load = require('./_load.js');
const HY = load({ upto: 'core/calc.js' });
const T = load.tester('calc_check');
const { ok, eq, near, section } = T;
const A = HY.astro, W = HY.world, C = HY.calc, U = HY.util;
const P = A.params();
const Z = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };
const SEC = 1 / 86400, MIN = 1 / 1440;
const NAMES = ['圣禁城', '伊美忒', '涅赫莱恩', '罪域', '赤道'];
const SITE = {}; for (const n of NAMES) SITE[n] = A.siteByName(n, P);
console.warn = () => {};
// 随机抽样用固定种子（mulberry32）：原先用 Math.random，边界项（“差 ≤2 分”）偶发失败，复现不了。整合时改为可复现
{ let seed = 0x5eed1018 >>> 0; Math.random = function () { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

section('0 没有桩');
eq(C.__stubs.length, 0, 'HY.calc.__stubs 为空');

section('1 昼长（01 第十三节，±0.02 h；与闭式 dayFraction 差 <10 秒）');
{
  const want = { '圣禁城': 13.36, '伊美忒': 13.49, '涅赫莱恩': 13.78, '罪域': 13.88, '赤道': 13.99 };
  for (const n of NAMES) {
    const O = SITE[n];
    for (const d of [0, 137]) {
      const ds = C.dayStats(O, A.localMidnight(d, O, P), P);
      near(ds.dayH, want[n], 0.02, `${n} 第 ${d} 日昼长`);
      near(ds.dayH, A.dayFraction(O.r, P) * 24, 10 / 3600, `${n} 第 ${d} 日昼长与闭式一致`);
      near(ds.dayH + ds.nightH, 24, 1e-9, `${n} 昼＋夜＝24 h`);
    }
  }
}

section('2 正午日高（01 第十三节，±0.3°）');
{
  const want = {
    '圣禁城': [[27.1, '南'], [17.9, '南'], [27.4, '南'], [51.6, '南']],
    '伊美忒': [[30.9, '南'], [20.4, '南'], [31.2, '南'], [57.6, '南']],
    '涅赫莱恩': [[46.2, '南'], [30.5, '南'], [46.6, '南'], [78.4, '南']],
    '罪域': [[56.6, '南'], [37.4, '南'], [57.1, '南'], [90.0, null]],
    '赤道': [[89.7, null], [60.9, '南'], [89.7, null], [60.9, '北']]
  };
  const days = [0, 90, 180, 270], dn = ['入冬', '冬至', '入夏', '夏至'];
  for (const n of NAMES) for (let i = 0; i < 4; i++) {
    const O = SITE[n], ds = C.dayStats(O, A.localMidnight(days[i], O, P), P), w = want[n][i];
    near(ds.noonEl, w[0], 0.3, `${n}${dn[i]}正午日高`);
    if (w[1]) eq(ds.noonDir, w[1], `${n}${dn[i]}正午日在${w[1]}`);
  }
}

section('3 日剂量（01 第八节第 2 条，月均，±1.5 MJ/m²）');
{
  const want = {
    '圣禁城': [25, 18, 15, 15, 18, 25, 40, 61, 76, 76, 61, 40],
    '伊美忒': [26, 18, 15, 15, 18, 26, 40, 59, 70, 70, 59, 40],
    '罪域': [29, 21, 18, 18, 21, 29, 38, 42, 41, 41, 42, 38],
    '赤道': [33, 29, 25, 25, 29, 33, 33, 29, 25, 25, 29, 33]
  };
  for (const n of Object.keys(want)) {
    const O = SITE[n], y = C.yearTable(O, 10018, P), byWd = new Array(360);
    for (let d = 0; d < 360; d++) byWd[(y.wd0 - 1 + d) % 360] = y.doseMJ[d];
    let worst = 0, at = -1;
    for (let m = 0; m < 12; m++) {
      let s = 0; for (let j = 0; j < 30; j++) s += byWd[m * 30 + j];
      const e = Math.abs(s / 30 - want[n][m]); if (e > worst) { worst = e; at = m; }
    }
    ok(worst <= 1.5, `${n} 十二个月的月均剂量与 01 一致（最大差 ${worst.toFixed(2)}，在入冬后第 ${at + 1} 个三十日）`);
  }
  // 积分与 2 分钟中点求和一致
  const O = SITE['伊美忒'], m0 = A.localMidnight(200, O, P);
  let s = 0; for (let k = 0; k < 1440 * 5; k++) s += A.sunTOA(O, m0 + (k + 0.5) / (1440 * 5), P).W * 86400 / (1440 * 5);
  near(C.dayStats(O, m0, P).doseMJ, s / 1e6, 0.05, '一日剂量（高斯求积）与 0.2 分钟中点求和一致');
}

section('4 一日五段（01 第五节第 5 条；与 10 秒步长的直接取样差 ≤3 分）');
{
  const want = { '伊美忒': { behind: 9.9, front: 8.05 }, '罪域': { behind: 9.5, front: 8.45 } };
  for (const n of NAMES) {
    const O = SITE[n];
    for (const d of [0, 90, 270]) {
      const m = A.localMidnight(d, O, P), ds = C.dayStats(O, m, P);
      const tot = {}; ds.segs.forEach(s => { tot[s.kind] = (tot[s.kind] || 0) + (s.t1 - s.t0) * 24; });
      let cont = Math.abs(ds.segs[0].t0 - m) < 1e-12 && Math.abs(ds.segs[ds.segs.length - 1].t1 - (m + 1)) < 1e-12;
      for (let i = 1; i < ds.segs.length; i++) if (Math.abs(ds.segs[i].t0 - ds.segs[i - 1].t1) > 1e-12) cont = false;
      ok(cont, `${n} 第 ${d} 日：各段首尾相接、铺满一日`);
      eq(ds.segs.map(s => s.kind + s.side).join(','), 'behind东,cut东,beside东,front中,beside西,cut西,behind西', `${n} 第 ${d} 日：五段次序`);
      // 直接取样（10 秒）
      const brute = {}, N = 8640;
      for (let k = 0; k < N; k++) { const a = A.sunAspect(O, m + (k + 0.5) / N, P); brute[a.kind] = (brute[a.kind] || 0) + 24 / N; }
      const worst = Math.max(...['behind', 'cut', 'beside', 'front'].map(k => Math.abs((tot[k] || 0) - (brute[k] || 0)) * 60));
      ok(worst <= 3, `${n} 第 ${d} 日：五段时长与直接取样一致（最大差 ${worst.toFixed(2)} 分）`);
      near((tot.cut || 0) * 60, 2 * A.duskMinutes(P), 2, `${n} 第 ${d} 日：切入、切没各约 ${A.duskMinutes(P).toFixed(1)} 分`);
      if (want[n]) {
        near(tot.behind, want[n].behind, 0.06, `${n} 塔后 ${want[n].behind} h`);
        near(tot.front, want[n].front, 0.05, `${n} 亮日衬黑塔 ${want[n].front} h`);
        near(tot.beside / 2, 2.3, 0.06, `${n} 贴东缘、贴西缘各 2.3 h`);
        near(tot.cut * 30, 42, 1.5, `${n} 东缘切出 42 分`);
      }
      // 破晓、黄昏（东缘开始切出、开始被西缘切）的精度 <10 秒
      const vis = x => A.sunlitAt(O, x, P);
      ok(vis(ds.dawn.t - 10 * SEC) < 0.001 && vis(ds.dawn.t + 10 * SEC) >= 0.001, `${n} 第 ${d} 日：破晓时刻误差 <10 秒`);
      ok(vis(ds.dusk.t - 10 * SEC) >= 0.999 && vis(ds.dusk.t + 10 * SEC) < 0.999, `${n} 第 ${d} 日：黄昏时刻误差 <10 秒`);
      ok(vis(ds.rise.t - 10 * SEC) < 0.5 && vis(ds.rise.t + 10 * SEC) >= 0.5 && vis(ds.set.t - 10 * SEC) >= 0.5 && vis(ds.set.t + 10 * SEC) < 0.5, `${n} 第 ${d} 日：日心露出、没入误差 <10 秒`);
      near(ds.dawn.hour, (ds.dawn.t - m) * 24, 1e-9, `${n} 破晓钟点＝地方时`);
    }
  }
  // 数组与月表
  const O = SITE['罪域'], m = A.localMidnight(30, O, P), ds = C.dayStats(O, m + 0.37, P);
  near(ds.tMid, m, 1e-9, 'dayStats 的 tMid 可以是当日任一时刻，自动对齐当地子夜');
  ok(ds.sun instanceof Float32Array && ds.sun.length === 288 && ds.hoff.length === 288, 'sun、hoff 是 Float32Array(288)');
  let bad = 0;
  for (let i = 0; i < 288; i++) {
    const a = A.sunAspect(O, m + i / 288, P);
    if (a.kind === 'behind' ? !isNaN(ds.sun[i]) : Math.abs(ds.sun[i] - a.el) > 1e-4) bad++;
    if (Math.abs(ds.hoff[i] - a.hoff) > 1e-4) bad++;
  }
  eq(bad, 0, 'sun（塔后为 NaN）、hoff 与 HY.astro.sunAspect 逐点一致');
  eq(C.dayStats(O, m, P, 96).sun.length, 96, 'n 可调');
  ok(ds.moon.length === 96 && ds.moon.every((q, j) => {
    const sk = A.sky(O, m + j / 96, P).moon;
    return Math.abs(q.t - (m + j / 96)) < 1e-12 && q.el === sk.el && q.state === sk.state && q.k === sk.k &&
      q.blackHigh === !!A.blackMoonHigh(O, q.t, P) && q.litVisible === !!A.litMoonVisible(O, q.t, P);
  }), '月：每 15 分一个，与 HY.astro.sky、blackMoonHigh、litMoonVisible 一致');
  // 塔基：终日不见日
  const Ot = A.site(300, 0, P), dt = C.dayStats(Ot, 0, P);
  ok(dt.dayH === 0 && dt.nightH === 24 && dt.dawn === null && dt.segs.length === 1 && dt.segs[0].kind === 'behind' && dt.doseMJ === 0, '塔基：昼 0、整日塔后、剂量 0');
  ok(Array.from(dt.sun).every(isNaN), '塔基：太阳整日 NaN');
  eq(C.sunSpan(Ot, P), null, '塔基：sunSpan 为 null');
  const sp = C.sunSpan(O, P); sp.rise = -1;
  ok(C.sunSpan(O, P).rise > 0, 'sunSpan 返回副本，改了不影响缓存');
}

section('5 历法：civil／tOfCivil／tOfWd 往返（<1 秒），子夜整点不落到前一日');
{
  for (const ys of ['civil', 'winter', 'winterEnd']) {
    W.CAL.yearStart = ys;
    let worst = 0, worstWd = 0, bad = 0;
    for (let i = 0; i < 2000; i++) {
      const t = (Math.random() - 0.5) * 60000, az = (Math.random() - 0.5) * 360, c = C.civil(t, az, P);
      worst = Math.max(worst, Math.abs(C.tOfCivil(c.N, c.doy, c.hour, az, P) - t));
      worstWd = Math.max(worstWd, Math.abs(C.tOfWd(c.N, c.wd, c.hour, az, P) - t));
      if (c.wd !== U.mod(c.rel, 360) + 1 || c.doy < 0 || c.doy > 359 || c.hour < 0 || c.hour >= 24) bad++;
      if (c.cyc !== U.mod(c.N - 10018, 4) + 1 || c.festival !== (c.cyc === 1)) bad++;
    }
    ok(worst < SEC, `${ys}：tOfCivil 往返误差 ${(worst * 86400).toExponential(1)} 秒`);
    ok(worstWd < SEC, `${ys}：tOfWd 往返误差 ${(worstWd * 86400).toExponential(1)} 秒`);
    eq(bad, 0, `${ys}：wd＝rel mod 360 ＋ 1、doy、hour 在范围内；周期第几年、庆典年与 HY.astro.isFestival 一致`);
  }
  W.CAL.yearStart = 'civil';
  // 与 HY.astro.dateOf 的旧民用月日一致（只供对照）
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const t = (Math.random() - 0.5) * 60000, az = (Math.random() - 0.5) * 360, c = C.civil(t, az, P), d = A.dateOf(t, az, P);
    if (c.mo !== d.month || c.d !== d.day || Math.abs(c.hour - d.hour) > 1e-6) bad++;
    if (c.wd !== ((d.month - 11 + 12) % 12) * 30 + d.day) bad++;
  }
  eq(bad, 0, 'civil 的 mo、d、hour 与 HY.astro.dateOf 一致；wd＝旧历十一月初一起的第几日');
  for (const az of [-4, 2, 25, -133.3, 171.7]) {
    for (const N of [10008, 10018, 10021]) {
      const t = W.winterT(N, P) + (az - P.epochAz) / 360;
      const c = C.civil(t, az, P), c1 = C.civil(t - SEC, az, P);
      ok(c.wd === 1 && c.hour === 0 && c.rel === 0 && c1.wd === 360, `方位 ${az}°、${N} 年：入冬交节那个当地子夜是第 1 日 0 时，前一秒是第 360 日`);
    }
  }
  const D1 = C.civil(W.markT('d1', 10018, -4, P), -4, P);
  ok(D1.N === 10018 && D1.wd === 294 && D1.rel === -67 && D1.doy === 233 && D1.festival && D1.cyc === 1, 'D1：第 10018 年、入冬后第 294 日、rel −67');
  eq(D1.label, '第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日', 'label 来自 HY.world.fmtCal');
  eq(C.cycleOf(10021, P), 4, '10021 是周期第 4 年');
  eq(C.cycleOf(10022, P), 1, '10022 是庆典年');
  // 历法上的季
  const Oz = SITE['罪域'], Of = A.site(0.72 * Math.PI * P.R, 180, P), Oe = SITE['赤道'];
  const at = (O, wd) => C.tOfWd(10018, wd, 12, O.az, P);
  ok(C.seasonOf(at(Oz, 1), Oz, P).season === '冬' && C.seasonOf(at(Oz, 1), Oz, P).n === 1, '罪域入冬后第 1 日＝冬第 1 日');
  ok(C.seasonOf(at(Oz, 180), Oz, P).season === '冬' && C.seasonOf(at(Oz, 180), Oz, P).n === 180, '第 180 日＝冬第 180 日');
  ok(C.seasonOf(at(Oz, 181), Oz, P).season === '夏' && C.seasonOf(at(Oz, 181), Oz, P).n === 1, '第 181 日＝夏第 1 日');
  ok(C.seasonOf(at(Oz, 294), Oz, P).n === 114, 'D1＝夏第 114 日');
  ok(C.seasonOf(at(Of, 1), Of, P).season === '夏' && C.seasonOf(at(Of, 200), Of, P).season === '冬', '塔顶半球冬夏相反');
  ok(C.seasonOf(at(Oe, 50), Oe, P).season === '赤道' && C.seasonOf(at(Oe, 50), Oe, P).n === null, '赤道无冬夏');
  let mism = 0;
  for (let i = 0; i < 400; i++) {
    const t = Math.random() * 1440, O = SITE[NAMES[i % 4]], h = A.localHour(t, O, P);
    if (h > 1 && h < 23 && Math.abs(U.mod(t + 0.5, 180) - 0.5) > 1.2 && C.seasonOf(t, O, P).season !== A.seasonAt(t, O, P)) mism++;
  }
  eq(mism, 0, '离交节一日以外，历法上的季与 HY.astro.seasonAt 相同');
}

section('6 小工具');
{
  eq(C.shichen(1), '丑时初', '1 时＝丑时初');
  eq(C.shichen(12.75), '午时正三刻', '12:45＝午时正三刻');
  eq(C.shichen(22.99), '亥时正三刻', '22:59＝亥时正三刻');
  eq(C.shichen(-1), '子时初', '负钟点折回');
  eq(C.hhmm(6.5), '06:30', 'hhmm');
  eq(C.hhmm(24), '00:00', '24 时＝00:00');
  eq(C.dirName(0), '正北', '正北');
  eq(C.dirName(90), '正东', '正东');
  eq(C.dirName(359), '北偏西 1°', '北偏西 1°');
  eq(C.dirName(-90), '正西', '−90°＝正西');
  eq(C.dirName(225), '南偏西 45°', '225°（正好在中间时以南北为准）');
  eq(C.dirName(45), '北偏东 45°', '45°');
  eq(C.dirName(135), '南偏东 45°', '135°');
  eq(C.dirName(315), '北偏西 45°', '315°');
  eq(C.dirName(95), '东偏南 5°', '95°＝东偏南 5°');
  eq(C.km(1234567.4), '1,234,567 公里', '千分位');
  ok([NaN, Infinity, undefined].every(x => C.dirName(x) === '—' && C.hhmm(x) === '—' && C.shichen(x) === '—'), '非有限数：方位、钟点、时辰都给“—”');
}

section('7 黑月期（01 第七节第 4 条）与每月黑月夜数（13.1±0.3）');
{
  const O = SITE['伊美忒'];
  const bp = C.blackPeriods(10018, O, P);
  const lab = bp.map(b => { const f = A.dateOf(b.t0 - 0.5, O.az, P), t = A.dateOf(b.t1 - 0.5, O.az, P); return f.month + '/' + f.day + '–' + t.month + '/' + t.day; });
  const want = ['12/30–1/12', '1/29–2/12', '2/29–3/11', '3/28–4/10', '4/28–5/10', '5/27–6/9', '6/26–7/9', '7/26–8/8', '8/25–9/7', '9/25–10/7', '10/24–11/6', '11/23–12/5'];
  ok(want.every(w => lab.includes(w)), '伊美忒 10018 年的黑月期与 01 一致：' + lab.join('，'));
  const span = W.yearSpan(10018, P, O.az);
  ok(bp.every(b => b.t1 >= span[0] && b.t0 - 1 < span[1]), '每一段都与本年有交集');
  let bad = 0;
  for (const b of bp) {
    const mid0 = W.winterT(10018, P) + b.from.rel + 1 + (O.az - P.epochAz) / 360, mid1 = W.winterT(10018, P) + b.to.rel + 1 + (O.az - P.epochAz) / 360;
    if (Math.abs(mid0 - b.t0) > 1e-9 || Math.abs(mid1 - b.t1) > 1e-9) bad++;
    if (!A.isBlackMoon(b.t0, P) || !A.isBlackMoon(b.t1, P) || A.isBlackMoon(b.t0 - 1, P) || A.isBlackMoon(b.t1 + 1, P)) bad++;
    if (b.from.wd !== U.mod(b.from.rel, 360) + 1 || b.to.wd !== U.mod(b.to.rel, 360) + 1 || b.nights !== b.to.rel - b.from.rel + 1) bad++;
    if (C.civil(b.t0 - 0.5, O.az, P).wd !== b.from.wd) bad++;
  }
  eq(bad, 0, '黑月期：rel 相对第 N 年入冬交节、wd＝入冬后第几日；首尾夜子夜逢黑月，前一夜、后一夜不是');
  for (const n of NAMES) {
    const Os = SITE[n], seen = new Set(); let nights = 0;
    for (let N = 10018; N <= 10022; N++) for (const b of C.blackPeriods(N, Os, P)) {
      const k = b.t0.toFixed(6); if (seen.has(k)) continue; seen.add(k);
      // 只数四年整周期 [0, 1440) 里的子夜
      for (let j = 0; j < b.nights; j++) { const tm = b.t0 + j; if (tm >= 0 && tm < 1440) nights++; }
    }
    near(nights / 49, 13.1, 0.3, `${n}：每朔望月子夜黑月 ${(nights / 49).toFixed(2)} 夜`);
  }
}

section('8 庆典与交节');
{
  const fs = C.festivals(9818, 401, P);
  eq(fs.length, 401, '9818–10218 共 401 年');
  let bad = 0;
  for (const f of fs) {
    if (f.festival !== A.isFestival(f.N, P) || f.festival !== (U.mod(f.N - 10018, 4) === 0)) bad++;
    if (f.t !== W.winterT(f.N, P) || f.elong !== A.elongation(f.t, P)) bad++;
    if (f.festival && (f.state !== '黑月' || Math.abs(f.elong) < P.beta * A.R2D)) bad++;
  }
  eq(bad, 0, '400 年逐年：与 HY.astro.isFestival、四年规则一致；庆典年交节是黑月、|Δ|＞β');
  near(Math.min(...fs.slice(200, 204).map(f => f.marginDays)), A.festivalMargin(P), 1e-6, '四年里最小的余量＝HY.astro.festivalMargin（0.78 日）');
  near(A.festivalMargin(P), 0.78, 0.01, '余量 0.78 日');
  const c = C.crossings(10018, P);
  ok(c.winter.civil.wd === 1 && c.winterSolstice.civil.wd === 91 && c.summer.civil.wd === 181 && c.summerSolstice.civil.wd === 271, '四个交节＝入冬后第 1、91、181、271 日（伊美忒）');
  ok(['winter', 'winterSolstice', 'summer', 'summerSolstice'].every(k => c[k].civil.hour === 0 && c[k].name && c[k].key === k), '交节都在伊美忒子夜，带名字');
  ok(c.winter.festival === true && C.crossings(10019, P).winter.festival === false, '入冬交节带庆典标记');
  ok(c.winter.state === '黑月' && c.winter.black, '10018 年入冬交节月为黑月');
  eq(c.winter.label, '第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 1 日', '交节的文字');
  ok(['winter', 'winterSolstice', 'summer', 'summerSolstice'].every(k => c[k].date === c[k].label && !/[一二三四五六七八九十]+月|初[一二三四五六七八九十]|廿/.test(c[k].date)),
    '交节的 date 换成新历法文字（不留 HY.astro 的“几月初几”）');
  for (const ys of ['civil', 'winter', 'winterEnd']) {
    W.CAL.yearStart = ys;
    for (const N of [10017, 10018, 10019]) {
      const L = C.crossingsInYear(N, P, -4), sp = W.yearSpan(N, P, -4);
      ok(L.length === 4 && L.every((x, i) => x.t >= sp[0] && x.t < sp[1] && (i === 0 || x.t > L[i - 1].t)), `${ys} ${N}：本年恰有四个交节，按时间排序`);
    }
  }
  W.CAL.yearStart = 'civil';
}

section('9 一年表');
{
  const O = SITE['罪域'], y = C.yearTable(O, 10018, P, { yuxiLead: 30 });
  const sp = W.yearSpan(10018, P, O.az);
  ok(y.N === 10018 && y.festival === true && y.t0 === sp[0], 'N、festival、t0');
  eq(y.wd0, 61, 'civil 口径：第 0 日是入冬后第 61 日');
  ok(y.noonEl.length === 360 && y.doseMJ.length === 360 && y.nights.length === 360, '360 日');
  let bad = 0;
  for (let d = 0; d < 360; d++) {
    if (Math.abs(y.noonEl[d] - A.noonSun(O, y.t0 + d + 0.5, P).el) > 1e-4) bad++;
    const n = y.nights[d];
    if (n.doy !== d || Math.abs(n.t - (y.t0 + d + 1)) > 1e-9 || n.state !== A.moonState(n.t, P) || n.black !== A.isBlackMoon(n.t, P)) bad++;
    if (n.festival !== (d === 299)) bad++;
  }
  eq(bad, 0, '正午日高、每夜子夜的月态与 HY.astro 一致；庆典夜只有入冬后第 360 日那一夜');
  near(y.nightH, (1 - A.dayFraction(O.r, P)) * 24, 1e-9, 'nightH');
  const ml = W.markList(10018, P, { az: O.az, yuxiLead: 30 });
  ok(y.marks.length === ml.length && y.marks.every((m, i) => m.id === ml[i].id && m.doy === ml[i].doy && m.wd === ml[i].wd), '节令＝HY.world.markList（余息随 yuxiLead）');
  eq(y.marks.find(m => m.id === 'yuxi').wd, 331, '余息在入冬前 30 日');
  ok(y.crossings.length === 4 && y.crossings.every(x => Math.abs(x.doy - (x.t - y.t0)) < 1e-9), '本年四个交节，带 doy');
  let cov = Math.abs(y.seasons[0].from) < 1e-9 && Math.abs(y.seasons[y.seasons.length - 1].to - 360) < 1e-9;
  for (let i = 1; i < y.seasons.length; i++) if (Math.abs(y.seasons[i].from - y.seasons[i - 1].to) > 1e-9 || y.seasons[i].season === y.seasons[i - 1].season) cov = false;
  ok(cov, '物理季首尾相接、冬夏交替：' + y.seasons.map(s => s.season + s.from.toFixed(2)).join(' '));
  const d1 = y.nights[233];
  ok(d1.litMin >= 480 && d1.blackHighMin === 0 && d1.litSeen, `D1 夜（doy 233）：整夜亮月 ${d1.litMin.toFixed(0)} 分`);
  const d2 = y.nights[234];
  ok(d2.litMin === 0 && d2.blackHighMin >= 240 && d2.blackHighSeen, `D2 夜：无亮月、后半夜黑月高悬 ${d2.blackHighMin.toFixed(0)} 分（01：约 5 小时）`);
  ok(y.nights[235].litMin === 0, 'D3 夜：无亮月');
  const Y19 = C.yearTable(O, 10019, P);
  ok(Y19.festival === false && Y19.nights.every(n => !n.festival), '10019 年没有庆典夜');
}

section('10 一夜的月：统计口径与直接取样一致（夜内 1 分钟逐点）');
{
  let worst = 0;
  for (const n of ['伊美忒', '罪域', '涅赫莱恩']) {
    const O = SITE[n], sp = C.sunSpan(O, P);
    for (let i = 0; i < 14; i++) {
      const k = Math.floor(Math.random() * 1440), tm = A.localMidnight(k, O, P), r = C.nightStats(O, tm, P);
      let lit = 0, hang = 0;
      const a = tm - (1 - sp.set), b = tm + sp.rise;
      for (let x = a + 0.5 * MIN; x < b; x += MIN) { if (A.litMoonVisible(O, x, P)) lit++; if (A.blackMoonHigh(O, x, P)) hang++; }
      worst = Math.max(worst, Math.abs(lit - r.litMin), Math.abs(hang - r.blackHighMin));
      if (r.litSeen !== (r.litMin >= 10) || r.blackHighSeen !== (r.blackHighMin >= 10)) worst = 99;
    }
  }
  ok(worst <= 2, `亮月、黑月高悬的分钟数与 1 分钟逐点计数差 ≤2 分（最大差 ${worst.toFixed(1)}）`);
  // 正文日期（01 第十四节）
  const Oz = SITE['罪域'], On = SITE['涅赫莱恩'];
  const hy = C.nightStats(Oz, A.nightOf(10008, 9, 10, Oz.az, P), P);
  ok(hy.blackHighMin >= 240 && hy.litMin === 0, `10008 年九月初十夜（黑曜日）罪域黑月高悬 ${hy.blackHighMin.toFixed(0)} 分（≥4 小时）`);
  const n9 = C.nightStats(On, A.nightOf(10008, 9, 9, On.az, P), P);
  ok(n9.litMin >= 300, `10008 年九月初九夜涅赫莱恩见亮月 ${n9.litMin.toFixed(0)} 分`);
  for (const n of ['伊美忒', '圣禁城']) {
    const O = SITE[n], f = C.nightStats(O, A.localMidnight(0, O, P), P);
    ok(f.litMin === 0 && f.blackHighMin === 0, n + '庆典夜通宵无月（无亮月、无黑月高悬）');
  }
}

section('11 本朔望月');
{
  for (const n of ['伊美忒', '罪域']) {
    const O = SITE[n];
    for (const t of [W.markT('d1', 10018, O.az, P), 0, 1000.3, -777.7]) {
      const mo = C.month(O, t, P);
      ok(Math.abs(U.wrapDeg(A.moonAge(mo.tStart, P) * 360)) < 1e-6 && Math.abs(mo.tEnd - mo.tStart - P.M) < 1e-9 && mo.tStart <= t && t < mo.tEnd, `${n} t=${t.toFixed(1)}：起于黑月正中、长一个朔望月、含 t`);
      const nn = mo.nights.length, black = mo.nights.filter(q => q.black).length;
      ok((nn === 29 || nn === 30) && mo.nights.every(q => q.t >= mo.tStart && q.t < mo.tEnd && Math.abs(A.localHour(q.t, O, P) % 24) < 1e-6), `${n}：${nn} 夜，全是当地子夜`);
      ok(black >= 12 && black <= 14, `${n}：本月子夜黑月 ${black} 夜`);
      if (mo.tonight >= 0) near(mo.nights[mo.tonight].t, C.nightMidnight(t, O.az, P, O), 1e-9, `${n}：tonight 指向今夜（与 moonNight 同一数法）`);
      ok(mo.nights.every(q => q.date.wd === C.civil(q.t - 0.5, O.az, P).wd), `${n}：每夜的 date 是该日（子夜前一日）`);
    }
  }
  const O = SITE['罪域'], mo = C.month(O, W.markT('d1', 10018, O.az, P), P), q = mo.nights[mo.tonight];
  ok(q.date.wd === 294 && q.litSeen && !q.blackHighSeen, 'D1 夜在本月表里：入冬后第 294 日、见亮月');
  const fm = C.month(SITE['伊美忒'], 5, P);
  ok(fm.nights.filter(x => x.festival).length === 1 && fm.nights.find(x => x.festival).date.wd === 360, '庆典夜在月表里标出一次（入冬后第 360 日）');
  // “今夜”的两种数法：不给 O 是正午到正午；给了 O 是日出到日出（白天归入即将到来的那一夜），与 moonNight 的 tm 一致
  {
    const Oy = SITE['伊美忒'], sp = C.sunSpan(Oy, P), m0 = A.localMidnight(40, Oy, P);
    const morning = m0 + sp.rise + 0.05, evening = m0 + 0.9, night = m0 + sp.rise - 0.05;
    near(C.nightMidnight(morning, Oy.az, P), m0, 1e-9, '不给 O：上午算刚过去的那一夜');
    near(C.nightMidnight(morning, Oy.az, P, Oy), m0 + 1, 1e-9, '给了 O：日出后算即将到来的那一夜');
    near(C.nightMidnight(night, Oy.az, P, Oy), m0, 1e-9, '给了 O：日出前仍是这一夜');
    near(C.nightMidnight(evening, Oy.az, P, Oy), m0 + 1, 1e-9, '给了 O：傍晚是今夜');
    let bad = 0;
    for (let i = 0; i < 300; i++) {
      const O = SITE[NAMES[i % 5]], t = (Math.random() - 0.5) * 3000;
      if (Math.abs(C.nightMidnight(t, O.az, P, O) - C.moonNight(O, t, P).tm) > 1e-9) bad++;
    }
    eq(bad, 0, '给了 O 的 nightMidnight＝moonNight 的 tm（300 个随机时刻）');
    const mo = C.month(Oy, morning, P);
    if (mo.tonight >= 0) near(mo.nights[mo.tonight].t, m0 + 1, 1e-9, '月表的 tonight 在上午指向即将到来的那一夜');
    const Ot = A.site(300, 0, P);
    near(C.nightMidnight(A.localMidnight(5, Ot, P) + 0.4, Ot.az, P, Ot), A.localMidnight(5, Ot, P), 1e-9, '塔基：按正午分夜');
  }
}

section('12 子午线剖面');
{
  const me = C.meridian(100.3, 2, P, Z);
  ok(['s', 'nightH', 'doseMJ', 'noonEl', 'towerW', 'g', 'zone', 'lat', 'noonDir'].every(k => me[k].length === 161), '各列 161 个');
  near(me.s[160], Math.PI * P.R, 1e-9, 's 从塔根到塔顶');
  let bad = 0;
  for (let i = 0; i < 161; i++) {
    const O = A.site(me.s[i], 2, P);
    if (me.zone[i] !== W.zoneOf(me.s[i], P, Z).id) bad++;
    if (O.r <= P.a) { if (!isNaN(me.nightH[i]) || !isNaN(me.towerW[i])) bad++; continue; }
    if (Math.abs(me.nightH[i] - (1 - A.dayFraction(O.r, P)) * 24) > 1e-9) bad++;
    if (Math.abs(me.towerW[i] - A.towerView(O, P).width) > 1e-9) bad++;
    if (Math.abs(me.noonEl[i] - A.noonSun(O, me.tMid + 0.5, P).el) > 1e-9) bad++;
    if (Math.abs(me.nightH[i] - me.nightH[160 - i]) > 1e-6) bad++;
  }
  eq(bad, 0, '分域、夜长、塔宽、正午日高与 HY.astro／HY.world 一致；塔基为 NaN；夜长对赤道对称');
  const iE = 80, Oe = A.site(me.s[iE], 2, P);
  near(me.doseMJ[iE], C.dayStats(Oe, me.tMid, P).doseMJ, 1e-6, '赤道一点的剂量与 dayStats 一致');
  near(me.tMid, A.localMidnight(100, A.site(1, 2, P), P), 1e-9, 'tMidRef 对齐到当地子夜');
}

section('13 照度估算');
{
  const O = SITE['罪域'], t = 270.5 + (O.az - 2) / 360, il = C.illum(O, t, P);
  near(il.sunLux, A.sunTOA(O, t, P).lux, 1e-6, 'sunLux＝HY.astro.sunTOA');
  ok(il.sunLuxGround > 0 && il.sunLuxGround < il.sunLux, '地面直射 < 大气顶');
  near(il.moonLux, A.moonLux(O, t, P), 1e-12, 'moonLux＝HY.astro.moonLux');
  ok(il.farLuxUpper === null && il.est === true, '不要对岸光时为 null；est 为真');
  const tn = A.localMidnight(90, O, P), f = C.illum(O, tn, P, { far: true }), fv = C.illum(O, tn, P, { far: true, veil: 0.1 });
  near(f.farLuxUpper, A.farLight(O, O.n, tn, P, { nTheta: 12, nPhi: 24 }), 1e-6, '对岸光上限＝HY.astro.farLight（12×24）');
  near(fv.farLuxUpper, 0.1 * f.farLuxUpper, 1e-6, '夜幕透过率乘上去');
  ok(f.farLuxUpper > 5000 && f.farLuxUpper < 12000, `罪域冬至子夜对岸光上限 ${f.farLuxUpper.toFixed(0)} lux（01：8–9 klux 量级）`);
}

section('14 月态第几夜');
{
  for (const n of ['伊美忒', '罪域', '赤道']) {
    const O = SITE[n]; let prev = null, bad = 0, bad2 = 0, badDay = 0;
    for (let k = 0; k < 120; k++) {
      const tm = A.localMidnight(k, O, P), r = C.moonNight(O, tm, P);
      if (r.state !== A.moonState(tm, P) || !(r.night >= 1) || r.since > tm || A.moonState(r.since - 1e-6, P) === r.state || A.moonState(r.since + 1e-6, P) !== r.state) bad++;
      if (Math.abs(r.tm - tm) > 1e-9) bad++;
      if (prev) {
        // 两个子夜之间月态没变：加一；变了：新月态的第 1 或第 2 夜（后半夜才变的，那几个钟头算第 1 夜）
        let same = prev.state === r.state;
        for (let h = 1; h < 24 && same; h++) if (A.moonState(tm - 1 + h / 24, P) !== r.state) same = false;
        if (same ? r.night !== prev.night + 1 : !(r.night === 1 || r.night === 2)) bad2++;
      }
      // 白天看，说的是即将到来的那一夜
      const noon = tm - 0.5, rn = C.moonNight(O, noon, P);
      if (rn.state === r.state && A.moonState(noon + 0.25, P) === r.state && rn.night !== r.night) badDay++;
      prev = r;
    }
    eq(bad, 0, `${n}：月态与 HY.astro.moonState 一致，since 是月态开始的时刻`);
    eq(bad2, 0, `${n}：逐夜数，月态不变时每夜加一，变了从 1 起`);
    eq(badDay, 0, `${n}：白天的读数与当夜一致`);
  }
  const O = SITE['罪域'], d1 = C.moonNight(O, W.markT('d1', 10018, O.az, P), P);
  ok(d1.state === '亮月' && d1.night >= 8, `D1 21 时：亮月第 ${d1.night} 夜`);
  // 每帧小步前进时沿用上一次的“月态开始时刻”，结果与每次从头算一致
  {
    const t0 = W.markT('d1', 10018, O.az, P), a = [], b = [];
    for (let i = 0; i < 4000; i++) a.push(C.moonNight(O, t0 + i / 300, P));
    for (let i = 0; i < 4000; i++) b.push(C.moonNight(O, t0 + i / 300, Object.assign({}, P)));
    let bad = 0; for (let i = 0; i < a.length; i++) if (a[i].night !== b[i].night || a[i].state !== b[i].state || Math.abs(a[i].since - b[i].since) > 1e-9) bad++;
    eq(bad, 0, '小步前进（每步约 5 分钟，跨过月态变化）：沿用缓存与从头算一致');
  }
}

section('15 跳转搜索：判据成立、在步长内是第一个（两个方向）');
{
  const tests = [];
  function chk(kind, O, t, dir, verify) {
    const x = C.findNext(kind, O, t, P, dir);
    const msg = `findNext('${kind}', ${O.name || O.s.toFixed(0)}, ${t.toFixed(2)}, ${dir})`;
    if (x == null) { ok(false, msg + ' 返回 null'); return null; }
    ok(dir > 0 ? x > t : x < t, msg + '：在 t 的' + (dir > 0 ? '之后' : '之前'));
    const r = verify(x);
    ok(r === true, msg + '：' + (r === true ? '' : r));
    return x;
  }
  // 区间 (a, b) 里没有谓词由假变真的点（步长 h）
  function noStart(pred, a, b, h) {
    let p = pred(a);
    for (let x = a + h; x < b; x += h) { const q = pred(x); if (!p && q) return x; p = q; }
    return null;
  }
  for (const n of ['伊美忒', '罪域', '圣禁城']) {
    const O = SITE[n]; O.name = n;
    for (const t0 of [W.markT('d1', 10018, O.az, P), 123.456, -3000.9]) for (const dir of [1, -1]) {
      const lim = (x, L) => Math.abs(x - t0) <= L ? true : '间隔超过 ' + L + ' 日';
      chk('midnight', O, t0, dir, x => Math.abs(U.wrapDeg(A.localHour(x, O, P) * 15)) < 1e-6 ? lim(x, 1) : '不是当地子夜');
      chk('noon', O, t0, dir, x => Math.abs(A.localHour(x, O, P) - 12) < 1e-6 ? lim(x, 1) : '不是当地正午');
      const vis = x => A.sunlitAt(O, x, P);
      chk('dawn', O, t0, dir, x => vis(x - 10 * SEC) < 0.001 && vis(x + 10 * SEC) >= 0.001 ? lim(x, 1) : '不是东缘开始切出');
      chk('dusk', O, t0, dir, x => vis(x - 10 * SEC) >= 0.999 && vis(x + 10 * SEC) < 0.999 ? lim(x, 1) : '不是开始被西缘切');
      for (const k of ['winter', 'winterSolstice', 'summer', 'summerSolstice']) {
        chk(k, O, t0, dir, x => {
          const N = Math.round((x - { winter: 0, winterSolstice: 90, summer: 180, summerSolstice: 270 }[k]) / 360) + 10018;
          return Math.abs(A.crossings(N, P)[k].t - x) < 1e-9 ? lim(x, 360) : '不是交节';
        });
      }
      chk('festivalCross', O, t0, dir, x => {
        const N = Math.round(x / 360) + 10018;
        return x === W.winterT(N, P) && A.isFestival(N, P) ? lim(x, 1440) : '不是庆典交节';
      });
      chk('festivalNight', O, t0, dir, x => {
        const c = C.civil(x, O.az, P), N = Math.round((x + 1) / 360) + 10018;
        return c.wd === 360 && Math.abs(c.hour - 21) < 1e-6 && A.isFestival(N, P) ? lim(x, 1440) : '不是庆典年入冬前夜 21 时';
      });
      chk('blackCenter', O, t0, dir, x => Math.abs(U.wrapDeg(A.moonAge(x, P) * 360)) < 1e-6 ? lim(x, P.M) : '不是黑月正中');
    }
  }
  // 黑月高悬开始
  for (const n of ['罪域', '伊美忒', '涅赫莱恩']) {
    const O = SITE[n]; O.name = n;
    for (const t0 of [W.markT('d1', 10018, O.az, P), 50.2]) for (const dir of [1, -1]) {
      const pred = y => !!A.blackMoonHigh(O, y, P);
      chk('blackHigh', O, t0, dir, x => {
        if (!(pred(x + 30 * SEC) && !pred(x - 30 * SEC))) return '不是黑月高悬的开始';
        const a = Math.min(t0, x) + MIN, b = Math.max(t0, x) - MIN;
        const s = noStart(pred, a, b, 2 * MIN);
        return s == null ? true : '中间漏了一次（' + s.toFixed(4) + '）';
      });
    }
  }
  {
    const O = SITE['罪域'], x = C.findNext('blackHigh', O, W.markT('d1', 10018, O.az, P), P);
    const c = C.civil(x, O.az, P);
    near(C.nightMidnight(x, O.az, P), A.nightOf(10018, 8, 25, O.az, P), 1e-9, `罪域 D1 之后第一次黑月高悬在 D2 夜（入冬后第 ${c.wd} 日 ${C.hhmm(c.hour)}，月心受照已不到一成）`);
  }
  // 今夜亮月最高
  for (const n of ['罪域', '伊美忒']) {
    const O = SITE[n]; O.name = n;
    const sp = C.sunSpan(O, P);
    for (const t0 of [W.markT('d1', 10018, O.az, P) - 0.3, 77.7]) for (const dir of [1, -1]) {
      chk('litMoonNight', O, t0, dir, x => {
        const L = A.litMoonVisible(O, x, P); if (!L) return '那一刻没有亮月';
        // 那一夜逐分钟：没有比它高 0.05° 以上的亮月
        const tm = C.nightMidnight(x, O.az, P), a = tm - (1 - sp.set), b = tm + sp.rise;
        for (let y = a; y < b; y += MIN) { const q = A.litMoonVisible(O, y, P); if (q && q.el > L.el + 0.05) return '不是当夜最高（' + q.el.toFixed(2) + ' > ' + L.el.toFixed(2) + '）'; }
        // 中间的夜没有亮月；t0 所在那一夜的最高时刻不在 t0 与 x 之间
        const tmT = C.nightMidnight(t0, O.az, P), nApart = Math.round(Math.abs(tm - tmT));
        for (let j = 1; j < nApart; j++) if (C.litPeak(O, tmT + dir * j, P)) return '中间第 ' + j + ' 夜有亮月';
        if (nApart > 0) { const p = C.litPeak(O, tmT, P); if (p && (dir > 0 ? p.t > t0 : p.t < t0)) return 't0 那一夜还有没到的亮月最高'; }
        return true;
      });
    }
  }
  // 日食：罪域、涅赫莱恩有；两京没有（搜两年）
  for (const n of ['罪域', '涅赫莱恩']) {
    const O = SITE[n]; O.name = n;
    const pred = y => A.eclipseFrac(O, y, P) > 0.5;
    const x = chk('eclipse', O, 0, 1, x => {
      if (!(pred(x + 5 * SEC) && !pred(x - 5 * SEC))) return '不是日食（>0.5）的开始';
      let p = pred(MIN);
      for (let y = 2 * MIN; y < x - MIN; y += MIN) { const q = pred(y); if (!p && q) return '中间漏了一次（' + y.toFixed(4) + '）'; p = q; }
      return true;
    });
    if (x != null) {
      const back = C.findNext('eclipse', O, x + 2 * MIN, P, -1);
      near(back, x, 1e-6, n + '：在日食里往回搜，回到这次日食的开始');
      const nx = C.findNext('eclipse', O, x, P, 1);
      ok(nx > x + 0.01 && pred(nx + 5 * SEC), n + '：下一次日食在这次之后');
    }
  }
  // 四年里逐次往后搜：次数与 01 第十节一致（01 数的是月盘碰到日面就算，这里要压过一半，所以不多于 01）
  for (const [n, lo, hi] of [['涅赫莱恩', 25, 28], ['罪域', 13, 17], ['赤道', 9, 12]]) {
    const O = SITE[n]; let t = 0, k = 0, dmin = 999, dmax = 0;
    for (;;) { const x = C.findNext('eclipse', O, t, P, 1); if (x == null || x >= 1440) break; k++; t = x + 0.02; const d = Math.abs(A.elongation(x, P)); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    ok(k >= lo && k <= hi, `${n}：四年 ${k} 次日食（压过日面一半；01 第十节按碰到就算为 ${hi} 次），发生在 |Δ| ${dmin.toFixed(0)}°–${dmax.toFixed(0)}°`);
  }
  for (const n of ['伊美忒', '圣禁城']) {
    const O = SITE[n];
    eq(C.findNext('eclipse', O, 0, P, 1), null, n + '：往后两年没有日食');
    eq(C.findNext('eclipse', O, 500, P, -1), null, n + '：往前两年没有日食');
  }
  eq(C.findNext('nope', SITE['罪域'], 0, P), null, '不认识的 kind 返回 null');
  ok(C.FIND_KINDS.every(k => C.findNext(k, SITE['罪域'], NaN, P) === null), 't 不是有限数时每一种都返回 null');
  ok(C.FIND_KINDS.length === 14 && C.FIND_KINDS.every(k => typeof k === 'string'), 'FIND_KINDS 列出 14 种');
  // 塔基：没有日出日落
  eq(C.findNext('dawn', A.site(300, 0, P), 0, P), null, '塔基：没有破晓');
}

section('16 性能（中位数）：年表 <40 ms、子午线 <20 ms、月表 <30 ms');
{
  function bench(fn) { fn(); const a = []; for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); fn(); a.push(Number(process.hrtime.bigint() - t0) / 1e6); } a.sort((x, y) => x - y); return a[2]; }
  const O = SITE['罪域'];
  const ty = bench(() => C.yearTable(O, 10019, P)), tm = bench(() => C.meridian(321.4, -4, P, Z)), tmo = bench(() => C.month(O, 777.7, P));
  ok(ty < 40, `年表 ${ty.toFixed(1)} ms`);
  ok(tm < 20, `子午线 ${tm.toFixed(1)} ms`);
  ok(tmo < 30, `月表 ${tmo.toFixed(1)} ms`);
  const tn = bench(() => C.moonNight(O, 1234.5, P));
  ok(tn < 2, `月态第几夜 ${tn.toFixed(2)} ms（每帧要算）`);
}

T.done();
