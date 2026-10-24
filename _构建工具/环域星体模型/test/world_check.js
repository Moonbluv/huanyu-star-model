#!/usr/bin/env node
/* world_check —— HY.world 自检（规格：spec/03 第十一节第 1 条；统筹修订见 spec/04 第二节第 1 条）
 * 分界 s、分域判定（圣禁城、罪域、塔顶半球对称、灵薄优先）；地点表与 HY.astro.SITES 一致；
 * 历法叫法与格式函数（可换叫法、可换整套写法）；年号三种口径；节令标记（相对入冬的日数）。
 */
'use strict';
const load = require('./_load.js');
const HY = load({ upto: 'core/calc.js' });
const T = load.tester('world_check');
const { ok, eq, near, throws, section } = T;
const A = HY.astro, W = HY.world, C = HY.calc, U = HY.util;
const P = A.params(), PI = Math.PI;
const Z = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };

section('1 默认参数下的分界 s（03 第四节第 1 条）');
{
  const b = W.zoneBounds(P, Z);
  near(b.tower, 600.9, 0.5, '塔基边界 s');
  near(b.light, 3601.9, 0.5, '轻／平分界 s');
  near(b.heavy, 6560.2, 0.5, '平／重分界 s');
  near(b.limbo[0], PI * P.R / 2 - 333, 1e-9, '灵薄下界＝πR/2 − limboKm');
  near(b.limbo[1], PI * P.R / 2 + 333, 1e-9, '灵薄上界＝πR/2 ＋ limboKm');
  // 分界两侧各差 0.01 km 判定翻转
  eq(W.zoneOf(b.light - 0.01, P, Z).id, 'light', '轻／平分界内侧是轻域');
  eq(W.zoneOf(b.light + 0.01, P, Z).id, 'plain', '轻／平分界外侧是平域');
  eq(W.zoneOf(b.heavy - 0.01, P, Z).id, 'plain', '平／重分界内侧是平域');
  eq(W.zoneOf(b.heavy + 0.01, P, Z).id, 'heavy', '平／重分界外侧是重域');
  eq(W.zoneOf(b.tower - 0.01, P, Z).id, 'tower', '塔基以内');
  eq(W.zoneOf(b.tower + 0.01, P, Z).id, 'light', '出了塔基是轻域');
  // 换一组分域参数，分界跟着走
  const Z2 = { gLight: 0.9, gHeavy: 1.3, limboKm: 100 }, b2 = W.zoneBounds(P, Z2);
  near(P.gEq * Math.sin(b2.light / P.R), 0.9, 1e-9, 'gLight＝0.9 时分界处 g＝0.9');
  near(P.gEq * Math.sin(b2.heavy / P.R), 1.3, 1e-9, 'gHeavy＝1.3 时分界处 g＝1.3');
  ok(W.zoneOf(b2.light - 0.01, P, Z2).id === 'light' && W.zoneOf(b2.light + 0.01, P, Z2).id === 'plain', '新分界两侧翻转');
  // 换 R：塔基边界＝R·asin(a/R)
  const P2 = A.params({ R: 8000 });
  near(W.zoneBounds(P2, Z).tower, 8000 * Math.asin(600 / 8000), 1e-9, 'R＝8000 时塔基边界');
  // gLight ≥ gEq：整个塔根半球都是轻域，分界在赤道
  near(W.zoneBounds(P, { gLight: 2, gHeavy: 2.5, limboKm: 0 }).light, PI * P.R / 2, 1e-9, 'gLight ≥ gEq 时分界落在赤道');
}

section('2 地点的分域');
{
  const sj = W.zoneOf(3600, P, Z), b = W.zoneBounds(P, Z);
  eq(sj.id, 'light', '圣禁城判轻域');
  eq(sj.name, '轻域', '中文名');
  near(sj.g, 0.7497, 5e-5, '圣禁城 g');
  near(b.light - 3600, 1.9, 0.05, '圣禁城离轻／平分界 1.9 公里');
  near(sj.lat, 57.6, 0.05, '圣禁城纬度 57.6°');
  eq(W.zoneOf(6670, P, Z).id, 'heavy', '罪域判重域');
  eq(W.zoneOf(4000, P, Z).id, 'plain', '伊美忒判平域');
  eq(W.zoneOf(5600, P, Z).id, 'plain', '涅赫莱恩判平域');
  const want = { zuiyu: 'heavy', shengjin: 'light', yimeite: 'plain', niehe: 'plain', abyss: 'limbo', qing: 'light', equator: 'limbo', far: 'plain' };
  for (const q of W.siteList(P)) eq(W.zoneOf(q.s, P, Z).id, want[q.id], '地点表：' + q.name + ' 的分域');
}

section('3 塔顶半球对称、灵薄优先');
{
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const s = Math.random() * PI * P.R / 2;
    const a = W.zoneOf(s, P, Z), b = W.zoneOf(PI * P.R - s, P, Z);
    if (a.id !== b.id || Math.abs(a.g - b.g) > 1e-9 || Math.abs(a.lat + b.lat) > 1e-9) bad++;
  }
  eq(bad, 0, '2000 个随机 s：s 与 πR − s 分域相同、g 相同、纬度相反');
  const sE = PI * P.R / 2;
  eq(W.zoneOf(sE, P, Z).id, 'limbo', '赤道是灵薄');
  eq(W.zoneOf(sE - 332, P, Z).id, 'limbo', '赤道往北 332 公里仍是灵薄（优先于重域）');
  eq(W.zoneOf(sE + 332, P, Z).id, 'limbo', '赤道往南 332 公里仍是灵薄');
  eq(W.zoneOf(sE - 334, P, Z).id, 'heavy', '赤道往北 334 公里是重域');
  eq(W.zoneOf(sE, P, { gLight: 0.75, gHeavy: 1.2, limboKm: 0 }).id, 'heavy', 'limboKm＝0 时赤道是重域');
  eq(W.zoneOf(PI * P.R - 100, P, Z).id, 'tower', '塔顶一侧的塔基');
  eq(W.zoneOf(0, P, Z).id, 'tower', '塔根');
}

section('4 地点表（03 第四节第 1 条）');
{
  const ids = W.SITES.map(q => q.id).join(',');
  eq(ids, 'zuiyu,shengjin,yimeite,niehe,abyss,qing,equator,far', '地点表顺序');
  const L = W.siteList(P);
  ok(L.every(q => typeof q.s === 'number' && isFinite(q.s) && q.name && q.short), 'siteList 把 s 全部求成数');
  near(W.siteById('abyss', P).s, PI * P.R / 2 - 230, 1e-9, '深渊边＝赤道往北 230 公里');
  near(W.siteById('far', P).s, 0.72 * PI * P.R, 1e-9, '世界另一端＝0.72πR');
  const P2 = A.params({ R: 7000 });
  near(W.siteById('equator', P2).s, PI * 7000 / 2, 1e-9, '改 R 后赤道 s 跟着变');
  eq(W.siteById('nope', P), null, '没有的 id 返回 null');
  // astro 列与 HY.astro.SITES 一致（方位、s）
  for (const q of L) {
    if (!q.astro) continue;
    const O = A.siteByName(q.astro, P);
    ok(O && Math.abs(O.s - q.s) < 1e-9 && Math.abs(O.az - q.az) < 1e-12, q.name + ' 与 HY.astro.SITES[“' + q.astro + '”] 一致');
  }
  ok(L.find(q => q.id === 'yimeite').az === P.epochAz, '伊美忒的方位＝历元经线（入冬交节在此地子夜）');
}

section('5 历法叫法与格式函数');
{
  const info = { N: 10018, cyc: 1, festival: true, wd: 294, hour: 21, season: '夏', seasonDay: 114, moonState: '亮月', moonNight: 9 };
  eq(W.fmtCal(info, 'full'), '第 10018 年（庆典年 · 周期第 1 年） · 入冬后第 294 日 · 夏第 114 日 · 亮月第 9 夜', 'full');
  eq(W.fmtCal(info), W.fmtCal(info, 'full'), 'form 省略＝full');
  eq(W.fmtCal(info, 'date'), '入冬后第 294 日', 'date');
  eq(W.fmtCal(info, 'season'), '夏第 114 日', 'season');
  eq(W.fmtCal(info, 'moon'), '亮月第 9 夜', 'moon');
  eq(W.fmtCal(info, 'chip'), '入冬后 294 日', 'chip');
  eq(W.fmtCal({ N: 10020, cyc: 3, festival: false }, 'year'), '第 10020 年（周期第 3 年）', '非庆典年');
  eq(W.fmtCal({ N: 10020 }, 'year'), '第 10020 年', '没有周期信息时只写年');
  eq(W.fmtCal({ wd: 5, season: '赤道', seasonDay: null }), '入冬后第 5 日', '赤道没有冬夏，季这一节省掉');
  eq(W.fmtCal({ moonState: '黑月', moonNight: null }, 'moon'), '黑月', '数不出第几夜时只写月态');
  eq(W.fmtCal({}), '', '空信息给空串');
  eq(W.fmtCal(null), '', 'null 给空串');
  ok(!/[一二三四五六七八九十]+月|初[一二三四五六七八九十]|廿/.test(W.fmtCal(info)), '没有“几月初几”');
  ok(!JSON.stringify(W.CAL.names).includes('\\"'), '叫法表里没有直引号');
  // 只改叫法（作者定稿后只改 CAL.names 一处）
  const keep = JSON.parse(JSON.stringify(W.CAL.names));
  W.CAL.names.year = '塔历 {N} 年'; W.CAL.names.winterDay = '冬后 {d} 日'; W.CAL.names.moon['黑月'] = '暗月';
  eq(W.fmtCal({ N: 10018, wd: 3, moonState: '黑月', moonNight: 2 }), '塔历 10018 年 · 冬后 3 日 · 暗月第 2 夜', '改 CAL.names 后文字跟着变');
  W.CAL.names = keep;
  eq(W.fmtCal(info, 'date'), '入冬后第 294 日', '叫法改回');
  // 换整套写法：登记格式函数再把 CAL.style 指过去
  throws(() => W.addCalStyle('bad', 42), 'addCalStyle 拒绝非函数');
  W.addCalStyle('test', (c, form, n) => form + ':' + c.N + '/' + c.wd + '/' + n.sep.trim());
  W.CAL.style = 'test';
  eq(W.fmtCal({ N: 1, wd: 2 }, 'date'), 'date:1/2/·', '换成自定义格式函数');
  W.CAL.style = 'nope';
  eq(W.fmtCal(info, 'date'), '入冬后第 294 日', '不认识的 style 退回现行草案');
  W.CAL.style = 'draft';
  eq(W.tpl('{a}-{b}-{c}', { a: 1, b: 0 }), '1-0-', 'tpl：缺的键给空串，0 照写');
}

section('6 年号口径与年的范围');
{
  eq(W.CAL.yearStart, 'civil', '默认口径 civil');
  eq(W.winterT(10018, P), 0, '10018 年入冬交节在 t＝0');
  eq(W.winterT(10019, P), 360, '10019 年入冬交节在 t＝360');
  const exp = { civil: [-300, 60], winter: [0, 360], winterEnd: [-360, 0] };
  for (const ys of ['civil', 'winter', 'winterEnd']) {
    W.CAL.yearStart = ys;
    const s = W.yearSpan(10018, P);
    ok(s[0] === exp[ys][0] && s[1] === exp[ys][1], ys + '：第 10018 年＝[' + exp[ys] + ')（伊美忒地方时）');
    let gap = 0;
    for (let N = 9990; N < 10050; N++) gap = Math.max(gap, Math.abs(W.yearSpan(N, P, -4)[1] - W.yearSpan(N + 1, P, -4)[0]));
    near(gap, 0, 1e-9, ys + '：相邻年首尾相接');
    near(W.yearSpan(10018, P, -4)[0] - W.yearSpan(10018, P)[0], -6 / 360, 1e-12, ys + '：别处的年按地方时平移');
  }
  W.CAL.yearStart = 'civil';
  // 口径与 HY.astro.dateOf 的帝国年一致（civil）
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const t = (Math.random() - 0.5) * 30000, az = (Math.random() - 0.5) * 360;
    if (C.civil(t, az, P).N !== A.dateOf(t, az, P).year) bad++;
  }
  eq(bad, 0, 'civil 口径的“第 N 年”与 HY.astro.dateOf 的帝国年一致');
}

section('7 节令标记（相对入冬的日数）');
{
  ok(W.MARKS.every(m => typeof m.rel === 'number' && m.id && m.label && m.kind), '每条标记有 id、label、kind、rel');
  ok(W.MARKS.every(m => Number.isInteger(m.rel) && m.rel > -360 && m.rel < 360), 'rel 是整日数');
  ok(['d1', 'd2', 'd3', 'heiyao'].every(id => W.markById(id).tbd), 'D1–D3、黑曜日标“待定”');
  ok(['winter', 'festival', 'wsol', 'summer', 'ssol'].every(id => !W.markById(id).tbd), '节令不标“待定”');
  eq(W.markById('nope'), null, '没有的标记返回 null');
  ok(isNaN(W.markT('nope', 10018, 0, P)), '没有的标记 markT 返回 NaN');
  // 对照旧草案（01 第七节第 2 条的民用月日）
  near(W.markT('d1', 10018, -4, P), A.tOf(10018, 8, 24, 21, -4, P), 1e-9, 'D1＝旧草案八月廿四 21 时');
  near(W.markT('d2', 10018, -4, P), A.tOf(10018, 8, 25, 21, -4, P), 1e-9, 'D2＝八月廿五 21 时');
  near(W.markT('d3', 10018, -4, P), A.tOf(10018, 8, 26, 21, -4, P), 1e-9, 'D3＝八月廿六 21 时');
  near(W.markT('heiyao', 9999, -4, P), A.tOf(10008, 9, 10, 21, -4, P), 1e-9, '黑曜日只属 10008 年（忽略传入的 N）＝九月初十 21 时');
  near(W.markT('festival', 10022, 2, P), A.tOf(10022, 10, 30, 21, 2, P), 1e-9, '庆典夜＝入冬前夜（十月三十日）21 时');
  near(W.markT('winter', 10018, 2, P), 0, 1e-12, '入冬＝交节');
  near(W.markT('wsol', 10018, 2, P), A.crossings(10018, P).winterSolstice.t, 1e-9, '冬至标记＝冬至交节');
  near(W.markT('summer', 10018, 2, P), A.crossings(10018, P).summer.t, 1e-9, '入夏标记＝入夏交节');
  near(W.markT('ssol', 10018, 2, P), A.crossings(10018, P).summerSolstice.t, 1e-9, '夏至标记＝夏至交节');
  near(W.markT('yuxi', 10018, 2, P), -45, 1e-9, '余息默认入冬前 45 日');
  near(W.markT('yuxi', 10018, 2, P, { yuxiLead: 30 }), -30, 1e-9, '余息随 fp.set.yuxiLead');
  eq(W.markRel(W.markById('yuxi'), { yuxiLead: 60 }), -60, 'markRel 处理 relFrom');
  eq(W.markRel(W.markById('d1'), { yuxiLead: 60 }), -67, '别的标记不受 yuxiLead 影响');

  for (const ys of ['civil', 'winter', 'winterEnd']) {
    W.CAL.yearStart = ys;
    for (const az of [-4, 2, 25, 180]) {
      for (const N of [10007, 10008, 10017, 10018, 10019, 10022]) {
        const L = W.markList(N, P, { az });
        const span = W.yearSpan(N, P, az);
        let sorted = true; for (let i = 1; i < L.length; i++) if (L[i].t < L[i - 1].t) sorted = false;
        if (!sorted) { ok(false, `${ys} ${N} az=${az}：按 t 排序`); continue; }
        const bad = L.filter(m => {
          const c = C.civil(m.t, az, P);
          return !(m.t >= span[0] - 1e-9 && m.t < span[1] - 1e-9) || c.N !== N || c.wd !== m.wd || c.doy !== m.doy;
        });
        if (bad.length) { ok(false, `${ys} ${N} az=${az}：标记的 t、doy、wd 与 civil 一致（错 ${bad.map(m => m.id).join(',')}）`); continue; }
        const every = L.filter(m => W.markById(m.id).every).map(m => m.id);
        // 庆典夜在交节前一夜：口径 'winter' 的第 N 年里是 N＋1 年交节的前夜，另两种口径是 N 年交节的前夜
        const wantEvery = ['winter', 'wsol', 'summer', 'ssol', 'yuxi'];
        if (A.isFestival(ys === 'winter' ? N + 1 : N, P)) wantEvery.push('festival');
        ok(wantEvery.every(id => every.includes(id)) && every.length === wantEvery.length, `${ys} ${N} az=${az}：每年的节令各一次（${every.join(',')}）`);
      }
    }
  }
  W.CAL.yearStart = 'civil';
  const L18 = W.markList(10018, P, { az: -4 }), ids = L18.map(m => m.id);
  ok(['d1', 'd2', 'd3', 'festival'].every(id => ids.includes(id)), '第 10018 年有 D1–D3 与庆典夜');
  ok(!ids.includes('heiyao'), '第 10018 年没有黑曜日');
  ok(W.markList(10008, P, { az: -4 }).some(m => m.id === 'heiyao'), '第 10008 年有黑曜日');
  ok(!W.markList(10019, P).some(m => m.id === 'festival' || m.id === 'd1'), '第 10019 年没有庆典夜、没有 D1');
  const fe = L18.find(m => m.id === 'festival');
  ok(fe.wd === 360 && fe.winterYear === 10018, '庆典夜是入冬后第 360 日，属于 10018 年的交节');
  eq(L18.find(m => m.id === 'd1').wd, 294, 'D1＝入冬后第 294 日');
  eq(W.markList(10008, P, { az: -4 }).find(m => m.id === 'heiyao').wd, 310, '黑曜日＝入冬后第 310 日');
  // 子夜整点的标记不因浮点误差落到前一日
  for (const az of [-4, -17.3, 25, 133.7]) {
    const w = W.markList(10018, P, { az }).find(m => m.id === 'winter');
    ok(w.doy === 300 && w.wd === 1 && C.civil(w.t, az, P).wd === 1, `方位 ${az}° 的入冬标记落在入冬后第 1 日（doy 300）`);
  }
  // 节令标记的 festival 判定可由调用方给
  ok(W.markList(10019, P, { festival: () => true }).some(m => m.id === 'festival'), 'opt.festival 可覆盖庆典判定');
  ok(W.markList(10018, P, { festival: false }).some(m => m.id === 'festival'), 'opt.festival 不是函数时照常用 HY.astro.isFestival（不抛错）');
  ok(L18.every(m => m.rel === W.markRel(W.markById(m.id), {}, P) && m.wd === U.mod(m.rel, 360) + 1), 'markList 带 rel，wd＝rel mod Y ＋ 1');

  // 改年长 Y（参数面板 300–420）：冬至、入夏、夏至跟着交节走（落在交节所在的那个伊美忒地方日）
  for (const Y of [300, 361, 420]) {
    const PY = A.params({ Y });
    const cr = A.crossings(10018, PY);
    const pairs = [['wsol', 'winterSolstice'], ['summer', 'summer'], ['ssol', 'summerSolstice']];
    ok(pairs.every(([id, k]) => { const t = W.markT(id, 10018, PY.epochAz, PY); return t <= cr[k].t + 1e-9 && cr[k].t - t < 1; }),
      `Y＝${Y}：冬至、入夏、夏至标记落在交节那一日（${pairs.map(([id, k]) => W.markT(id, 10018, PY.epochAz, PY) + '/' + cr[k].t).join('，')}）`);
    for (const ys of ['civil', 'winter', 'winterEnd']) {
      W.CAL.yearStart = ys;
      let bad = 0;
      for (const N of [10017, 10018, 10019, 10020]) {
        const L = W.markList(N, PY, { az: -4 }), every = L.filter(m => W.markById(m.id).every).map(m => m.id).sort().join(',');
        const want = ['winter', 'wsol', 'summer', 'ssol', 'yuxi'].concat(A.isFestival(ys === 'winter' ? N + 1 : N, PY) ? ['festival'] : []).sort().join(',');
        if (every !== want) bad++;
        if (L.some(m => m.doy < 0 || m.doy >= Y || m.wd < 1 || m.wd > Y || C.civil(m.t, -4, PY).wd !== m.wd || C.civil(m.t, -4, PY).N !== N)) bad++;
      }
      eq(bad, 0, `Y＝${Y}，${ys}：每年的节令各一次，doy、wd 与 civil 一致`);
    }
    W.CAL.yearStart = 'civil';
  }
  eq(W.markRel(W.markById('wsol'), {}), 90, '不给 P 时 markRel 用 rel 栏（Y＝360 的值）');
  eq(W.snapDay(3 - 1e-12), 3, 'snapDay 吸附到整数');
  eq(W.snapDay(3.25), 3.25, 'snapDay 不动非整数');
}

T.done();
