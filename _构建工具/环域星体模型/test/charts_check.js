#!/usr/bin/env node
/* charts_check —— C 路（图表）自检：六张图在 node 里用假画布画一遍，核对数据层、点选、悬停与文案。
 *   图表脚本不是节点模块（manifest 里没标 node），但加载时不碰 DOM，这里按 manifest 顺序另行载入。
 *   假画布记下全部 fillText/strokeText，用来查：没有“几月初几”式的日期、没有直引号、没有 NaN/undefined。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('./_load.js');
const HY = load();
const T = load.tester('charts_check');
const { ok, eq, near, section } = T;
const A = HY.astro, W = HY.world, CALC = HY.calc, M = HY.model, S = HY.store;
console.warn = () => {};

// 载入 charts/*（manifest 顺序）
for (const e of load.manifest().scripts) {
  if (e.src && e.src.indexOf('charts/') === 0) {
    const f = path.join(load.SRC, e.src);
    vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
  }
}
const C = HY.charts;
M.rebuild();

/* ───────── 假画布 ───────── */
let texts = [], nanCalls = [];
function makeCtx() {
  const base = {
    font: '10px sans-serif',
    measureText(s) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font || '10px') ? /(\d+(?:\.\d+)?)px/.exec(this.font)[1] : 10);
      let w = 0;
      for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? px : px * 0.6;
      return { width: w };
    },
    fillText(s) { texts.push(String(s)); },
    strokeText(s) { texts.push(String(s)); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    calls: 0
  };
  const GEOM = new Set(['fillRect', 'strokeRect', 'rect', 'arc', 'ellipse', 'moveTo', 'lineTo', 'drawImage', 'fillText', 'strokeText', 'translate']);
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      t.calls++;
      if (GEOM.has(k)) return function () { for (const a of arguments) if (typeof a === 'number' && !isFinite(a)) { nanCalls.push(k); break; } };
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function makeCanvas(w, h, opt) {
  const ctx = makeCtx();
  const cv = {
    clientWidth: w, clientHeight: h, width: 0, height: 0, hidden: !!(opt && opt.hidden), attrs: {}, style: {},
    getContext() { return ctx; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
    setAttribute(k, v) { this.attrs[k] = v; },
    ctx
  };
  return cv;
}
const errors = [];
HY.bus.on('error', e => { if (e.part === 'charts') errors.push(e.message); });

function setSite(id, s, az) {
  if (id) { const q = W.siteById(id, M.P); S.patch('site', { id: q.id, s: q.s, az: q.az }, 'api'); }
  else S.patch('site', { id: null, s: s, az: az }, 'api');
  M.tick();
}
function setT(t) { S.set('time.t', t, 'api'); M.tick(); }
const SIZES = { sky: [300, 300], day: [360, 96], year: [360, 200], helix: [360, 170], meridian: [360, 200], month: [360, 84] };
const BAD_DATE = /[正一二三四五六七八九十冬腊]月(?:初|廿|[一二三四五六七八九十])|初[一二三四五六七八九十]/;

/* ───────── 1 注册与接口 ───────── */
section('1 注册与接口');
const charts = {};
for (const k of C.KINDS) {
  ok(typeof C._reg[k] === 'function', `已注册 ${k}`);
  const sz = SIZES[k], cv = makeCanvas(sz[0], sz[1]);
  const ch = C.create(k, cv, {});
  if (ch.impl) ch.impl.throttle = 0;        // 自检里连续换年，不等节流（节流另在第 11 节测）
  charts[k] = { ch, cv };
  ok(['update', 'draw', 'onPick', 'destroy'].every(f => typeof ch[f] === 'function'), `${k}：update/draw/onPick/destroy`);
  ok(!ch.__stub, `${k} 不是桩`);
}
ok(C.create('nope', makeCanvas(100, 50)).kind === 'nope', '未知图种退回占位图');
ok(!C.isStub(['dayStats', 'yearTable', 'meridian', 'month']), 'HY.calc 不再是桩（图上不写“示例数据”）');

/* ───────── 2 各地各时都画得出来 ───────── */
section('2 各地、各时、各尺寸都画得出来');
const P0 = M.P, piR = Math.PI * P0.R;
const PLACES = [['zuiyu'], ['shengjin'], ['yimeite'], ['niehe'], ['equator'], ['far'], ['abyss'], ['qing'],
  [null, 300, 0], [null, piR - 200, 120], [null, 9000, -90], [null, 12000, 179]];
const TIMES = [A.tOf(10018, 8, 24, 21, -4, P0), -0.1, 0, 0.5, 90.3, 180.7, 271.2, -3600 + 17.3, 2000.6];
let drawn = 0, worstMs = {};
for (const pl of PLACES) {
  setSite(pl[0], pl[1], pl[2]);
  for (const t of TIMES) {
    setT(t);
    for (const k of C.KINDS) {
      texts = [];
      const { ch } = charts[k], before = ch.stats.drawn, t0 = Date.now();
      ch.update('time');
      worstMs[k] = Math.max(worstMs[k] || 0, Date.now() - t0);
      if (ch.stats.drawn === before + 1) drawn++;
      else ok(false, `${k} 在 ${pl[0] || pl[1]}、t=${t} 没画`);
      if (nanCalls.length) { ok(false, `${k} 在 ${pl[0] || pl[1]}、t=${t} 有非有限坐标：${nanCalls.slice(0, 3).join('、')}`); nanCalls = []; }
      const bad = texts.filter(s => BAD_DATE.test(s) || /"/.test(s) || /NaN|undefined|null|Infinity/.test(s));
      if (bad.length) ok(false, `${k} 在 ${pl[0] || pl[1]}、t=${t} 的文字有问题：${bad.slice(0, 3).join('｜')}`);
    }
  }
}
eq(errors.length, 0, '没有发出 error 事件' + (errors.length ? '：' + errors[0] : ''));
ok(drawn === PLACES.length * TIMES.length * C.KINDS.length, `共画 ${drawn} 张`);
console.log('    最慢一次（毫秒，含重算）：' + C.KINDS.map(k => k + ' ' + worstMs[k]).join('，'));
ok(worstMs.year < 600 && worstMs.meridian < 300 && worstMs.month < 300 && worstMs.helix < 200 && worstMs.day < 300 && worstMs.sky < 600, '单次重算＋重画在预算内（node 宽松上限）');

// 窄、宽两种尺寸
for (const k of C.KINDS) {
  for (const w of [200, 640]) {
    const cv = makeCanvas(w, SIZES[k][1]), ch = C.create(k, cv, {});
    texts = []; ch.draw();
    ok(ch.stats.drawn === 1 && !texts.some(s => /NaN|undefined/.test(s)), `${k} 宽 ${w} 能画`);
    ch.destroy();
  }
}

/* ───────── 3 一年 ───────── */
section('3 一年');
setSite('zuiyu'); setT(A.tOf(10018, 8, 24, 21, -4, M.P));
{
  const { ch } = charts.year;
  ch.update('model');
  const d = ch.data, yt = d.yt, now = M.now;
  eq(d.N, now.date.N, '年＝此刻的第 N 年');
  eq(d.Y, 360, '360 日');
  ok(yt.t0 <= now.t && now.t < yt.t0 + 360, '此刻落在横轴范围里');
  const lay = ch.lay, doy = 233, x = lay.X(doy + 0.5);
  let got = null; const off = ch.onPick(r => { got = r; });
  let ev = null; const off2 = HY.bus.on('time', e => { ev = e; });
  const hour0 = A.localHour(now.t, M.O, M.P);
  const r = ch.pickAt(x, (lay.p[0] + lay.p[1]) / 2);
  ok(r && r.doy === doy, `点在第 ${doy} 日上，得 doy ${r && r.doy}`);
  ok(got && got.t === r.t, 'onPick 回调收到同一结果');
  ok(ev && ev.src === 'ui' && Math.abs(HY.state.time.t - r.t) < 1e-9, '点选写入 time.t（src: ui）');
  near(A.localHour(HY.state.time.t, M.O, M.P), hour0, 1e-6, '钟点不变');
  ok(HY.state.time.t >= yt.t0 + doy && HY.state.time.t < yt.t0 + doy + 1, '跳到的就是那一天');
  off(); off2();
  const g = ch.groupMarks(yt.marks);
  const story = g.filter(q => q.kind === 'story');
  ok(story.some(q => q.label === '审判 D1–D3 夜' && q.tbd), 'D1–D3 并成一组“审判 D1–D3 夜”，标待定');
  // 月态行与 HY.astro 一致（抽查）
  let bad = 0;
  for (let i = 0; i < 360; i += 17) if (yt.nights[i].state !== A.moonState(yt.nights[i].t, M.P)) bad++;
  eq(bad, 0, '月态行＝各夜子夜的 HY.astro.moonState');
  const tip = ch.probe(x, 60);
  ok(tip && tip.length >= 3 && /入冬后第 294 日/.test(tip[0]), '悬停第一行是“入冬后第 294 日…”：' + (tip && tip[0]));
  ok(tip.some(s => /审判 D1 夜（待定）/.test(s)), '悬停 D1 那天带出“审判 D1 夜（待定）”');
  ok(!ch.pickAt(x, ch.lay.mr[1] + 30), '点到横轴文字下方不算');
}

/* ───────── 4 日月高度 ───────── */
section('4 日月高度');
{
  const { ch } = charts.helix;
  setT(10.3); ch.update('model');
  const d = ch.data;
  let worst = 0;
  for (let i = 0; i < d.n; i++) worst = Math.max(worst, Math.abs(d.ys[i] + d.ym[i]));
  ok(worst < 1e-3 * M.P.A, `日月高度互为镜像（最大偏差 ${worst.toExponential(2)} 公里）`);
  near(d.big, M.P.A, M.P.A * 0.002, '振幅＝A');
  const w = d.cross.find(c => c.key === 'winter');
  ok(w && Math.abs(Math.abs(w.elong) - 180) < 1e-6 && w.festival === true, '10018 年入冬 Δ＝180°、庆典');
  let tot = 0, badMid = 0;
  d.black.forEach((r, i) => {
    tot += r.to - r.from;
    const mid = d.t0 + 0.5 * (r.from + r.to);
    if (!A.isBlackMoon(mid, M.P)) badMid++;
    const nx = d.black[i + 1];
    if (nx && A.isBlackMoon(d.t0 + 0.5 * (r.to + nx.from), M.P)) badMid++;
  });
  eq(badMid, 0, '|Δ|＞β 的段＝月心入影（HY.astro.isBlackMoon），段间不是');
  near(tot / d.Y, M.P.blackFrac, 0.02, '黑月期占全年比例≈1−β/π');
  setT(370); ch.update('model');
  const w2 = ch.data.cross.find(c => c.key === 'winter');
  ok(ch.data.N === 10019 && w2 && w2.festival === false && Math.abs(w2.elong - 90) < 1e-6, '10019 年入冬 Δ＝+90°、非庆典');
  const x = ch.lay.X(100.5), r = ch.pickAt(x, 40);
  ok(r && r.doy === 100 && Math.abs(HY.state.time.t - r.t) < 1e-9, '点选跳到那一日');
  const tip = ch.probe(ch.lay.X(ch.data.cross[0].doy), 40);
  ok(tip && tip.some(s => /交节/.test(s)), '悬停交节处带出交节');
  // 此地高度线在折返面上（罪域＝回归线）
  setSite('zuiyu'); ch.update('model');
  ok(Math.abs(Math.abs(ch.data.siteY) - ch.data.big) < 0.01 * ch.data.big, '罪域的高度＝螺旋折返面（回归线）');
}

/* ───────── 5 子午线剖面 ───────── */
section('5 子午线剖面');
{
  const { ch } = charts.meridian;
  setSite('zuiyu'); setT(0.3); ch.update('model');
  const d = ch.data, Zs = M.Z, b = W.zoneBounds(M.P, Zs);
  near(d.segs[0].s0, 0, 1e-9, '分域段从塔根起');
  near(d.segs[d.segs.length - 1].s1, d.piR, 1e-6, '到塔顶止');
  ok(d.segs.every((sg, i) => i === 0 || Math.abs(sg.s0 - d.segs[i - 1].s1) < 1e-9), '各段首尾相接');
  eq(d.segs[0].id, 'tower', '第一段是塔基');
  near(d.segs[0].s1, b.tower, 1e-3, '塔基边界＝zoneBounds.tower');
  ok(d.segs.every(sg => W.zoneOf(0.5 * (sg.s0 + sg.s1), M.P, Zs).id === sg.id), '每段中点的分域对');
  const ids = d.segs.map(s => s.id).join(',');
  eq(ids, 'tower,light,plain,heavy,limbo,heavy,plain,light,tower', '默认参数下分域次序对称');
  const lay = ch.lay;
  near(lay.cursor, lay.X(M.O.s), 1e-9, '竖线在当前地点');
  // 点在罪域刻度上：吸附成罪域（方位相同）
  let r = ch.pickAt(lay.X(6670) + 2, 100);
  ok(r && r.s === 6670 && r.id === 'zuiyu', '点在罪域刻度旁：吸附为罪域');
  // 点在伊美忒刻度上：方位不同，只改距离
  r = ch.pickAt(lay.X(4000), 100);
  ok(r && r.s === 4000 && r.id === null, '点在伊美忒刻度上（方位不同）：只改距离');
  eq(HY.state.site.az, -4, '方位不变');
  eq(HY.state.site.s, 4000, '写入 site.s');
  r = ch.pickAt(lay.X(8000), 100);
  ok(r && Math.abs(r.s - 8000) <= d.piR / lay.pw + 1 && HY.state.site.id === null, '任意处：距离＝横轴读数、id 为 null');
  const tip = ch.probe(lay.X(5000), 100);
  ok(tip && /离塔根 5,0\d\d 公里/.test(tip[0]), '悬停写离塔根距离：' + (tip && tip[0]));
  const tipT = ch.probe(lay.X(100), 100);
  ok(tipT && tipT.some(s => /塔基里/.test(s)), '塔基里写“终日不见日”');
  const k0 = ch.key; setSite(null, 7000, -4); ch.update('model');
  eq(ch.key, k0, '只改距离不重算剖面');
}

/* ───────── 6 本月月相 ───────── */
section('6 本月月相');
{
  const { ch } = charts.month;
  setSite('zuiyu');
  let miss = 0, badLen = 0, badOrder = 0;
  for (let i = 0; i < 40; i++) {
    setT(-500 + i * 23.71);
    ch.update('time');
    const ns = ch.data.mo.nights;
    if (!(ch.lay.tonight >= 0)) miss++;
    if (!(ns.length === 29 || ns.length === 30)) badLen++;
    for (let j = 0; j < ns.length; j++) {
      if (ns[j].t < ch.data.mo.tStart - 1e-9 || ns[j].t >= ch.data.mo.tEnd || (j && ns[j].t <= ns[j - 1].t)) { badOrder++; break; }
    }
  }
  eq(miss, 0, '今夜总在图上');
  eq(badLen, 0, '每月 29 或 30 夜');
  eq(badOrder, 0, '各夜在本朔望月里、按时间排');
  setSite('yimeite'); setT(-0.2); ch.update('model');
  ok(ch.data.mo.nights.some(q => q.festival), '10018 年入冬前夜（伊美忒）在本月图上标庆典');
  const lay = ch.lay, i = 5, x = lay.x0 + (i + 0.5) * lay.slot;
  const r = ch.pickAt(x, 10);
  ok(r && r.t === ch.data.mo.nights[i].t && HY.state.time.t === r.t, '点选跳到那一夜的子夜');
  const tip = ch.probe(x, 10);
  ok(tip && /之夜/.test(tip[0]) && /子夜：/.test(tip[1]), '悬停：日期与子夜月态');
  ok(!ch.pickAt(x, 200), '图下方不算点选');
}

/* ───────── 7 一日 ───────── */
section('7 一日');
{
  const { ch } = charts.day;
  setSite('zuiyu'); setT(10.5); ch.update('model');
  const d = ch.data, lay = ch.lay;
  const x = lay.L + 15 / 24 * lay.pw, r = ch.pickAt(x, 50);
  near(r.hour, 15, 1 / 60 + 1e-9, '点在 15 时');
  near(A.localHour(HY.state.time.t, M.O, M.P), r.hour, 1e-6, '写入后当地钟点＝所点');
  ok(Math.abs(C.dayStart(M.O, HY.state.time.t, M.P) - d.tMid) < 1e-6, '日期不变');
  const tip = ch.probe(x, 50);
  ok(tip && /^15:00/.test(tip[0]) && tip.some(s => /^太阳：/.test(s)), '悬停写钟点与太阳');
  ok(d.ds.segs.length >= 5, '一日五段（含塔后两段）');
}

/* ───────── 8 天空 ───────── */
section('8 天空');
{
  const { ch } = charts.sky;
  setSite('zuiyu'); setT(10.5); ch.update('model');
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1;
    if (x * x + y * y > 0.99) continue;
    const v = C.skyDir(M.O, x, y), p = C.skyOf(M.O, v);
    worst = Math.max(worst, Math.hypot(p.x - x, p.y - y));
  }
  ok(worst < 1e-9, '投影往返（skyDir → skyOf）误差 ' + worst.toExponential(2));
  const n = M.now, S0 = A.sunPos(n.t, M.P), ps = C.skyOf(M.O, [S0.x - M.O.x, S0.y - M.O.y, S0.z - M.O.z]);
  near(ps.el, n.sun.el, 1e-6, '太阳位置＝HY.model.now.sun（仰角）');
  ok(C.skyPt(90, 0).rho === 0 && C.skyPt(0, 90).x < 0, '天顶在中心，东在左');
  const lay = ch.lay;
  eq(ch.pickAt(lay.cx, lay.cy), null, '总览时点天空图不转头');
  HY.state.view.mode = 'fp';
  let look = null; const old = HY.app; HY.app = { look: (a, b) => { look = [a, b]; } };
  const r = ch.pickAt(lay.sun.x, lay.sun.y);
  ok(r && r.target === 'sun' && look && Math.abs(look[1] - n.sun.el) < 1e-6, '第一人称时点太阳 → HY.app.look 转到太阳');
  HY.app = old; HY.state.view.mode = 'ov';
  ok(ch.map.ready && ch.map.lit > 0, '对面内壁昼夜底图算过（有亮处）');
  const tip = ch.probe(lay.cx + 3, lay.cy + 3);
  ok(tip && /视线落在/.test(tip[1]), '悬停写视线落在哪里');
  setSite(null, 300, 0); ch.update('model');
  ok(ch.data.inTower, '塔基里：只写一句说明');
}

/* ───────── 9 可见性 ───────── */
section('9 可见性');
{
  const cv = makeCanvas(360, 200, { hidden: true }), ch = C.create('year', cv, {});
  ok(ch.update('time') === false && ch.dirty === true && ch.stats.drawn === 0, '看不见时不画、只记脏');
  cv.hidden = false;
  ok(ch.update('visible') === true && ch.stats.drawn === 1 && ch.dirty === false, '露出来后补画');
  ch.destroy();
}

/* ───────── 10 配色与小工具 ───────── */
section('10 配色与小工具');
{
  const c = C.colors();
  ok(['sun', 'moon', 'night', 'winter', 'summer', 'z-light', 'z-tower', 'moon-black'].every(k => /^#|^rgb/.test(c[k])), '配色齐全（node 里用默认值）');
  ok(C.cutOffset(0.5) === C.cutOffset(0.5) && Math.abs(A.diskFrac(C.cutOffset(0.3)) - 0.3) < 1e-6, 'cutOffset 是 diskFrac 的反函数');
  eq(C.num(-0.0001, 1), '0.0', '负零写成 0');
  eq(C.num(-3.2, 1), '−3.2', '负号用全角减号');
  const p = C.prep(makeCanvas(120, 60));
  ok(p.w === 120 && p.h === 60, 'prep 返回 CSS 像素尺寸');
}

/* ───────── 12 参数与年号口径的变体：六张图都画得出来 ───────── */
section('12 参数与年号口径的变体');
{
  const VARIANTS = [{ Y: 300 }, { Y: 420 }, { lunPerYear: 6 }, { lunPerYear: 24 }, { R: 2000 }, { R: 12000 },
    { dS: 2600, a: 2000 }, { a: 100 }, { epochAz: 90 }, { sTrop: 3000 }, { sTrop: 9000 }];
  const runAll = (tag) => {
    let bad = 0;
    for (const pl of [['zuiyu'], ['far']]) {
      setSite(pl[0]);
      setT(123.4);
      for (const k of C.KINDS) {
        texts = []; nanCalls = [];
        const { ch } = charts[k], before = ch.stats.drawn;
        ch.update('model');
        const badText = texts.filter(s => BAD_DATE.test(s) || /"/.test(s) || /NaN|undefined|null|Infinity/.test(s));
        if (ch.stats.drawn !== before + 1 || nanCalls.length || badText.length) {
          bad++;
          ok(false, `${tag}：${k} 在 ${pl[0]} ${ch.stats.drawn !== before + 1 ? '没画' : nanCalls.length ? '有非有限坐标 ' + nanCalls[0] : '文字有问题 ' + badText[0]}`);
        }
        nanCalls = [];
        // 悬停扫一遍
        const lay = ch.lay || {};
        for (let x = 5; x < (lay.x1 || 300); x += 41) {
          const tp = ch.probe(x, 40) || [];
          if (tp.some(s => /NaN|undefined|Infinity/.test(s))) { bad++; ok(false, `${tag}：${k} 悬停有 NaN：${tp.join('｜')}`); break; }
        }
      }
    }
    return bad;
  };
  const errs0 = errors.length;
  for (const v of VARIANTS) {
    S.reset('astro', 'api');
    for (const k in v) S.set('astro.o.' + k, v[k], 'api');
    M.tick();
    const applied = Object.keys(v).every(k => Math.abs(M.P[k] - v[k]) < 1e-9);
    ok(applied && runAll(JSON.stringify(v)) === 0, `参数 ${JSON.stringify(v)}：六张图都画得出来` + (applied ? '' : '（参数没生效）'));
  }
  S.reset('astro', 'api'); S.set('astro.preset', 'bing', 'api'); M.tick();
  ok(runAll('bing') === 0, '“bing”预设：六张图都画得出来');
  S.set('astro.preset', 'default', 'api'); M.tick();
  for (const ys of ['winter', 'winterEnd']) {
    W.CAL.yearStart = ys; M.tick();
    ok(runAll(ys) === 0, `年号口径“${ys}”：六张图都画得出来`);
    // 一年图：横轴范围＝此刻所在的第 N 年
    const { ch } = charts.year; ch.update('model');
    ok(ch.data.N === M.now.date.N && ch.data.yt.t0 <= M.now.t && M.now.t < ch.data.yt.t0 + ch.data.Y, `年号口径“${ys}”：一年图横轴盖住此刻`);
  }
  W.CAL.yearStart = 'civil'; M.tick();
  eq(errors.length - errs0, 0, '变体里没有发出 error 事件');
}

/* ───────── 13 横轴小刻度：从入冬起每 30 日，不从岁首（旧历月界）起 ───────── */
section('13 横轴小刻度');
{
  let bad = 0;
  for (const Y of [360, 300, 365, 420]) {
    S.reset('astro', 'api'); if (Y !== 360) S.set('astro.o.Y', Y, 'api'); M.tick();
    for (const ys of ['civil', 'winter', 'winterEnd']) {
      W.CAL.yearStart = ys;
      for (const N of [10017, 10018]) {
        const ax = C.yearAxis(N, M.P, -4), mt = C.yearMinorTicks(ax);
        if (mt.length !== Math.ceil(M.P.Y / 30)) bad++;
        if (!mt.every(d => d >= 0 && d < M.P.Y && (ax.wdOf(d) - 1) % 30 === 0)) bad++;
        if (mt.indexOf(ax.doyOfWd(1)) < 0) bad++;
        // 大刻度（季节交界）落在交节那一日
        const cr = CALC.crossingsInYear(N, M.P, -4);
        cr.forEach(c => { const tk = ax.ticks.find(q => Math.abs(q.doy - (c.t - ax.t0)) < 1); if (!tk) bad++; });
      }
    }
  }
  W.CAL.yearStart = 'civil'; S.reset('astro', 'api'); M.tick();
  eq(bad, 0, '小刻度都在“入冬后第 1、31、61… 日”；大刻度都在交节那一日（Y＝300/360/365/420，三种口径）');
}

/* ───────── 14 子午线：窄灵薄带不漏；此地剂量取精确值 ───────── */
section('14 子午线：窄灵薄带、此地剂量');
{
  const { ch } = charts.meridian;
  setSite('zuiyu'); setT(0.3);
  for (const km of [1, 4, 0]) {
    S.set('zones.limboKm', km, 'api'); M.tick(); ch.update('model');
    const lim = ch.data.segs.filter(sg => sg.id === 'limbo');
    if (km > 0) {
      ok(lim.length === 1 && Math.abs((lim[0].s1 - lim[0].s0) - 2 * km) < 1e-6, `灵薄带半宽 ${km} 公里：剖面上有一段宽 ${2 * km} 公里的灵薄` + (lim[0] ? `（得 ${(lim[0].s1 - lim[0].s0).toFixed(4)}）` : '（漏了）'));
    } else ok(lim.length === 0, '灵薄带半宽 0：没有灵薄段');
  }
  S.set('zones.limboKm', 333, 'api'); M.tick();
  for (const s of [650, 700, 6670]) {
    setSite(null, s, -4); texts = []; ch.update('model');
    const exact = CALC.dayStats(M.O, C.dayStart(M.O, M.now.t, M.P), M.P).doseMJ;
    ok(texts.some(x => x === C.num(exact, 1) + ' MJ'), `离塔根 ${s} 公里：竖线旁的剂量＝此地精确值 ${C.num(exact, 1)} MJ`);
  }
}

/* ───────── 15 点选保留的钟点读此刻的状态 ───────── */
section('15 点选保留钟点');
{
  const { ch } = charts.year;
  setSite('zuiyu'); setT(5.25); ch.update('model');
  setT(5.75);                                       // 改了钟点，图还没重画（节流中）
  const r = ch.pickAt(ch.lay.X(200.5), (ch.lay.p[0] + ch.lay.p[1]) / 2);
  near(A.localHour(HY.state.time.t, M.O, M.P), A.localHour(5.75, M.O, M.P), 1e-6, '一年图点选：保留的是此刻（不是上次画图时）的钟点');
  const hc = charts.helix.ch;
  hc.update('model'); setT(hc.data.t0 + 3.1);
  const r2 = hc.pickAt(hc.lay.X(40.5), 40);
  near(A.localHour(HY.state.time.t, M.O, M.P), A.localHour(hc.data.t0 + 3.1, M.O, M.P), 1e-6, '日月高度点选：同上');
  ok(r && r2, '两次点选都有结果');
}

/* ───────── 16 文案细节 ───────── */
section('16 文案细节');
{
  // 本月月相悬停：“入冬后第 d 日之夜”紧挨着写，季放后面
  const mc = charts.month.ch;
  setSite('zuiyu'); setT(10.5); mc.update('model');
  const x = mc.lay.x0 + (mc.lay.tonight + 0.5) * mc.lay.slot, tip = mc.probe(x, 10);
  ok(tip && /^入冬后第 \d+ 日之夜（今夜） · [冬夏]第 \d+ 日$/.test(tip[0]), '本月月相悬停第一行：' + (tip && tip[0]));
  // 天空图：黑月高悬按月心受照 ≤10% 算（灰月的尾巴也算），图上照样加注“高悬”
  const sc = charts.sky.ch;
  let tg = null;
  for (let t = 0; t < 120; t += 1 / 288) {
    const f = A.moonSunlit(t, M.P);
    if (f > 0.03 && f <= 0.1 && A.blackMoonHigh(M.O, t, M.P)) { tg = t; break; }
  }
  ok(tg != null, '罪域找得到灰月尾巴上的黑月高悬');
  if (tg != null) {
    setT(tg); texts = []; sc.update('model');
    ok(M.now.moon.state === '灰月' && M.now.moon.blackHigh && texts.some(s => s === '灰月 · 高悬'), '天空图上写“灰月 · 高悬”');
    const tp = sc.probe(sc.lay.moon.x, sc.lay.moon.y);
    ok(tp && tp.some(s => s === '黑月高悬'), '悬停月亮：带出“黑月高悬”');
  }
  // 一日：塔基里写一句
  setSite(null, 300, 0); texts = []; charts.day.ch.update('model');
  ok(texts.some(s => /塔基里/.test(s)), '一日图在塔基里写“终日不见日”');
  // 一年图页眉放不下时的短式也走 fmtCal（不另拼“庆典年”）
  setSite('zuiyu'); setT(10.5); charts.year.ch.update('model');
  eq(charts.year.ch.data.yearShort, W.fmtCal({ N: 10018, festival: true }, 'year'), '一年图页眉短式＝fmtCal');
}

/* ───────── 17 悬停中被切走页签：提示框收起 ───────── */
section('17 悬停中被隐藏');
{
  const cv = makeCanvas(360, 200), ch = C.create('day', cv, {});
  ch.draw(); ch.hover = { x: 100, y: 50, cx: 100, cy: 50 };
  cv.hidden = true;
  ok(ch.update('time') === false && ch.hover === null, '看不见时清掉悬停状态（提示框随之收起）');
  ch.destroy();
}

/* ───────── 18 本月月相的“今夜”＝读数的“月态第几夜”那一夜 ───────── */
section('18 今夜与读数同一夜');
{
  const { ch } = charts.month;
  let bad = 0, morning = 0, badIdx = 0;
  for (const id of ['zuiyu', 'yimeite', 'far']) {
    setSite(id);
    for (let i = 0; i < 120; i++) {
      const t = -60 + i * 0.137;                   // 一天里各个钟点都扫到
      setT(t); ch.update('time');
      const tm = ch.data.mo.nights[ch.lay.tonight].t, mn = CALC.moonNight(M.O, t, M.P);
      if (Math.abs(tm - mn.tm) > 1e-6) bad++;
      const h = A.localHour(t, M.O, M.P);
      if (h > 7 && h < 11) morning++;
      // 与 HY.calc.month 自己算的 tonight 一致（同一个“今夜子夜”取月）
      const mo = CALC.month(M.O, tm, M.P);
      if (mo.nights[mo.tonight].t !== tm) badIdx++;
    }
  }
  ok(morning > 20, `扫到了日出后、正午前的时刻（${morning} 个）`);
  eq(bad, 0, '金圈那一夜＝HY.calc.moonNight 的今夜（上午也是即将到来的那一夜）');
  eq(badIdx, 0, '与 HY.calc.month 的 tonight 一致');
  // 金圈那一夜的悬停：月态第几夜与此刻的读数相同（此刻在夜里时；白天读数说的也是今夜）
  setSite('zuiyu'); setT(10.4); ch.update('time');
  const lay = ch.lay, tip = ch.probe(lay.x0 + (lay.tonight + 0.5) * lay.slot, 10);
  ok(tip && /（今夜）/.test(tip[0]), '金圈那一夜悬停写“（今夜）”');
}

/* ───────── 19 叫法只改 HY.world.CAL 一处：图上的文字跟着变，不等重算 ───────── */
section('19 叫法跟着 CAL 变');
{
  const names = W.CAL.names, keep = { year: names.year, winterDay: names.winterDay, chip: names.chip };
  setSite('zuiyu'); setT(10.5);
  const yc = charts.year.ch, mc = charts.month.ch, hc = charts.helix.ch;
  yc.update('model'); mc.update('model'); hc.update('model');
  const n0 = { y: yc.stats.computed, m: mc.stats.computed };
  names.year = '帝国 {N} 年'; names.winterDay = '冬后第 {d} 日'; names.chip = '冬后 {d} 日';
  texts = []; yc.update('time'); mc.update('time'); hc.update('time');
  ok(yc.stats.computed === n0.y && mc.stats.computed === n0.m, '只重画、没重算');
  ok(texts.some(s => /^帝国 10018 年/.test(s)), '一年图页眉换成新叫法：' + texts.filter(s => /10018/.test(s)).join('｜'));
  ok(texts.some(s => /^冬后第 \d+ 日$|^冬后 \d+ 日$/.test(s)), '横轴刻度换成新叫法');
  ok(texts.some(s => s === '数字＝冬后第几日之夜'), '本月月相的图例换成新叫法');
  ok(!texts.some(s => /入冬后/.test(s)), '图上不再出现旧叫法“入冬后”');
  Object.assign(names, keep);
  texts = []; mc.update('time');
  ok(texts.some(s => s === '数字＝入冬后第几日之夜'), '改回来后图例复原');
}

/* ───────── 11 节流：连续换年时先用旧数据画，过了节流间隔再补算 ───────── */
section('11 节流');
{
  const cv = makeCanvas(360, 200), ch = C.create('year', cv, {});
  setSite('zuiyu'); setT(10); ch.draw();
  const n0 = ch.data.N;
  setT(10 + 360); ch.draw();
  ok(ch.data.N === n0 && ch.stats.computed === 1, '节流间隔内不重算（先画旧数据）');
  // 收尾重画：只画了第一次跳转（像 app 的 100 ms 节流那样丢了第二次），150 ms 后应自己补画到最后的时刻
  const day = C.create('day', makeCanvas(360, 96), {});
  setT(380.25); day.update('time');
  setT(380.75);                                     // 第二次跳转：没人调 update
  const drawn0 = day.stats.drawn;
  // 第一人称步行（03 第七节第 8 条）：子午线、一年表按新地点重算，节流 1 s
  const yw = C.create('year', makeCanvas(360, 200), {}), mw = C.create('meridian', makeCanvas(360, 200), {});
  HY.state.view.mode = 'fp';
  setSite(null, 6000, 10); yw.update('site'); mw.update('site');
  const c0 = { y: yw.stats.computed, m: mw.stats.computed };
  setSite(null, 6000.5, 10.3); yw.update('site'); mw.update('site');           // 0.5 公里后：还不到 1 s
  const c1 = { y: yw.stats.computed, m: mw.stats.computed };
  HY.state.view.mode = 'ov';
  let pending = 2;
  const finish = () => { if (--pending === 0) T.done(); };
  setTimeout(() => {
    ok(ch.data.N === n0 + 1 && ch.stats.computed === 2, '过了节流间隔自动补算');
    ok(day.drawnT === 380.75 && day.stats.drawn === drawn0 + 1, '连跳两次：收尾补画到最后的时刻');
    ok(c0.y === 1 && c0.m === 1, '步行第一步：一年表、子午线照算');
    ok(c1.y === 1 && c1.m === 1, '步行 1 s 内的下一步：先不重算（用旧数据画）');
    ok(yw.stats.computed === 1 && mw.stats.computed === 1, '步行中过了一般的节流间隔（≤250 ms）也还不算');
    ch.destroy(); day.destroy();
    finish();
  }, 400);
  setTimeout(() => {
    ok(yw.stats.computed === 2 && mw.stats.computed === 2, '步行：满 1 s 补算到最新地点');
    ok(Math.abs(yw.data.yt.nights.length - 360) < 1 && Math.abs(mw.data.m.s.length - 161) < 1, '补算出的是完整的表');
    yw.destroy(); mw.destroy();
    finish();
  }, 1500);
}
