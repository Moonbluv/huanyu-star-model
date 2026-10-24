#!/usr/bin/env node
/* test/terrace_geom.js —— 阶地几何与地面函数的双精度移植（规格：spec/02 第八节第 1–4 条、第十八节；负责：F 路）
 *
 * 用 fp/ground.js（terrain_lib.glsl 的逐行移植）断言：
 *   1. alt(0)＝眼高（阶地；斜坡沿径向为 eye·sinψ），各地、各眼高、两种模式都严格成立；
 *   2. 相机相对差分写法 altAt 与“绝对量”直接求值一致（贴地 ±1.5 m 的点，差 ＜1 mm）——守着 chartD 斜坡分支的符号、
 *      相机脚下 r_q 的深渊沟项、dispFine 的停读间隙这几处修正；
 *   3. 踏面真水平：同一级踏面上 r 的变化 ＜1 cm／km（东西、南北都量；起伏倍率 0 时，以及只关掉细层时）；
 *   4. 相邻两级的半径差＝W·tan(纬度)±2%（罪域、涅赫莱恩、伊美忒、圣禁城、轻域、塔顶半球）；
 *   5. 赤道附近崖高→0；
 *   6. groundPoint 落在地面上；图表坐标“相机原点＋chartD(v)”与该点的绝对图表坐标一致；
 *   7. limits() 的口径；terraceLevel()；与 fp/camera.js 的相机联调（有正式实现时）；性能。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('terrace_geom');
const { ok, near, eq, section } = T;
const g = HY.fp.ground, A = HY.astro, P = A.params();
const D2R = Math.PI / 180;
let seed = 2026;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const SITES = [['罪域', 6670, -4], ['涅赫莱恩', 5600, 25], ['伊美忒', 4000, 2], ['圣禁城', 3600, 0], ['轻域', 2000, 0], ['塔顶半球', 0.72 * Math.PI * P.R, 180]];

// 绝对离地高度：点 X（CM 系，相对相机 v）到地面
function absAlt(S, v) {
  const X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], rho = Math.hypot(X[0], X[2]), phi = S.phi + Math.atan2(X[2], X[0]);
  const ab = g.groundAbs(S.GS, X[1], phi, {}, rho);
  return S.uGroundMode === 1 ? ab.rg - rho : ab.rad - Math.hypot(X[0], X[1], X[2]);
}

section('1 alt(0)＝眼高（各地、各眼高、两种模式）');
{
  let worst = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    const s = 700 + rnd() * (Math.PI * P.R - 1400), az = rnd() * 360 - 180, eye = 1.2 + rnd() * 0.8;
    const S = g.makeState(P, s, az, { mode: rnd() < 0.5 ? 'terrace' : 'slope', amp: 0.5 + rnd() * 2 }, { eye });
    worst = Math.max(worst, Math.abs(g.altAt(S, [0, 0, 0]) - S.uCamAlt)); n++;
  }
  ok(worst === 0, `${n} 处 alt(0)−uCamAlt 最大 ${worst}（应严格为 0）`);
  const S = g.makeState(P, 6670, -4, {}, {});
  eq(S.uGroundMode, 1, '默认地面＝阶地');
  near(g.altAt(S, [0, 0, 0]), 0.0016, 1e-15, '罪域阶地 alt(0)＝1.6 m');
  const Ss = g.makeState(P, 6670, -4, { mode: 'slope' }, {});
  near(g.altAt(Ss, [0, 0, 0]), 0.0016 * Math.sin(6670 / P.R), 1e-15, '罪域斜坡 alt(0)＝eye·sinψ（沿径向）');
}

section('2 相对差分＝绝对求值（贴地点，差 ＜1 mm）');
{
  const cases = SITES.map(([n, s, az]) => [n + '·阶地', s, az, { mode: 'terrace' }])
    .concat(SITES.slice(0, 4).map(([n, s, az]) => [n + '·斜坡', s, az, { mode: 'slope' }]))
    .concat([['深渊沟内·阶地（半宽 400 km、纬度 3°）', (Math.PI / 2 - 3 * D2R) * P.R, 0, { mode: 'terrace', abyssHalf: 400 }],
      ['赤道往北 150 km·斜坡', Math.PI * P.R / 2 - 150, 10, { mode: 'slope' }]]);
  for (const [name, s, az, gs] of cases) {
    const S = g.makeState(P, s, az, gs, {});
    let worst = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const v = g.groundPoint(S, [(rnd() - 0.5) * 30, (rnd() - 0.5) * 30]);
      const up = S.uGroundMode === 1 ? [-1, 0, 0] : (() => { const X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], L = Math.hypot(...X); return X.map(x => -x / L); })();
      const h = (rnd() - 0.5) * 0.003;
      const w = [v[0] + up[0] * h, v[1] + up[1] * h, v[2] + up[2] * h];
      const a = g.altAt(S, w);
      if (Math.abs(a) > 0.0015) continue;            // 离地 1.5 m 以内（细层不提前停读）
      worst = Math.max(worst, Math.abs(a - absAlt(S, w))); n++;
    }
    ok(n > 100 && worst < 1e-6, `${name}：${n} 个贴地点，最大差 ${(worst * 1e6).toFixed(3)} mm`);
  }
}

section('3 踏面真水平（r 的变化 ＜1 cm／km）');
function treadFlat(label, gsExtra, patchA) {
  const saved = g.LAY_A.slice();
  if (patchA) patchA(g.LAY_A);
  try {
    for (const [name, s, az] of SITES.slice(0, 5)) {
      const S = g.makeState(P, s, az, Object.assign({ mode: 'terrace' }, gsExtra), {});
      let worst = 0, pairs = 0;
      for (const dir of [[1, 0], [0, 1]]) {
        const pts = [];
        for (let k = -40; k <= 40; k++) {
          const dc = [dir[0] * k * 0.012, dir[1] * k * 0.012];
          const v = g.groundPoint(S, dc), X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]];
          g.altAt(S, v);
          if (g.last.U > S.uCliffC + 0.01 && g.last.U < 0.995) pts.push({ K: g.last.K, r: Math.hypot(X[0], X[2]), at: k * 0.012 });
        }
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          if (pts[i].K !== pts[j].K) continue;
          const dist = Math.abs(pts[i].at - pts[j].at); if (dist < 0.05) continue;
          worst = Math.max(worst, Math.abs(pts[i].r - pts[j].r) / dist); pairs++;
        }
      }
      ok(pairs > 50 && worst < 1e-5, `${label}·${name}：同级踏面 ${pairs} 对点，r 的变化最大 ${(worst * 1e5).toFixed(4)} cm/km`);
    }
  } finally { for (let k = 0; k < 7; k++) g.LAY_A[k] = saved[k]; }
}
treadFlat('起伏倍率 0', { amp: 0 });
treadFlat('只关细层（第 0、1 层照常抬起整片阶地）', {}, LA => { LA[3] = 0; LA[4] = 0; LA[5] = 0; });

section('4 相邻两级半径差＝W·tan(纬度)±2%');
for (const [name, s, az] of SITES) {
  const S = g.makeState(P, s, az, { mode: 'terrace' }, {}), W = S.uW;
  const lat = Math.abs(90 - s / P.R / D2R) * D2R, want = W * Math.tan(lat);
  const byK = new Map();
  for (let k = -400; k <= 400; k++) {
    const v = g.groundPoint(S, [0, k * W * 0.01]), X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]];
    g.altAt(S, v);
    if (g.last.U < S.uCliffC + 0.02 || g.last.U > 0.98) continue;
    const r = Math.hypot(X[0], X[2]), K = g.last.K;
    if (!byK.has(K)) byK.set(K, []);
    byK.get(K).push(r);                               // 含细层起伏：每级取中位数
  }
  const Ks = [...byK.keys()].sort((a, b) => a - b), steps = [];
  for (let i = 1; i < Ks.length; i++) if (Ks[i] === Ks[i - 1] + 1) {
    const med = arr => { const b = arr.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    steps.push(med(byK.get(Ks[i - 1])) - med(byK.get(Ks[i])));
  }
  // 细层 ±(18+3.2+0.7)·amp m 会混进中位数：只要求平均级高在 ±2%＋细层幅度/级数 以内
  const meanStep = steps.reduce((a, b) => a + b, 0) / Math.max(steps.length, 1);
  const tol = 0.02 * want + 0.04 * S.uAmpZone / Math.max(steps.length, 1);
  ok(steps.length >= 2 && Math.abs(meanStep - want) <= tol, `${name}（纬度 ${(lat / D2R).toFixed(1)}°）：${steps.length} 级平均崖高 ${(meanStep * 1000).toFixed(1)} m，W·tanφ＝${(want * 1000).toFixed(1)} m`);
  near(S.uHc, want, want * 0.02, `${name}：limits 给的 uHc`);
}
// 不带细层地直接量 r_q：相邻级之差逐级等于 W·Y/r（严格到 2%）
{
  const W = 1.5;
  for (const latDeg of [5, 30, 45, 60, 78]) {
    const Y = P.R * Math.sin(latDeg * D2R), k = Math.floor(Y / W);
    const rq = kk => Math.sqrt(P.R * P.R - Math.pow(W * (kk + 1), 2));
    const d = rq(k - 1) - rq(k), want = W * Math.tan(latDeg * D2R);
    near(d, want, want * 0.02, `纬度 ${latDeg}°：r_q 相邻级差 ${(d * 1000).toFixed(1)} m ≈ W·tanφ`);
  }
}

section('5 赤道附近崖高 → 0');
{
  const W = 1.5, hs = [];
  for (const latDeg of [3, 2, 1, 0.5, 0.2]) {
    const y = -P.R * Math.sin(latDeg * D2R);
    const GS = { R: P.R, mode: 1, W: W, cliff: 0.07, resid: 0, wig: 0, jit: 0, amp: 0, abyssDepth: 0, abyssHalf: 220, Rref: P.R };
    const a = g.groundAbs(GS, y, 0), b = g.groundAbs(GS, y - W, 0);    // 往北（塔根）一级
    hs.push(a.rg - b.rg);
  }
  ok(hs.every((h, i) => i === 0 || h < hs[i - 1]), `崖高随纬度单调变小：${hs.map(h => (h * 1000).toFixed(1)).join(' → ')} m`);
  ok(hs[hs.length - 1] < 0.01, '纬度 0.2° 处崖高 ＜10 m');
  eq(g.makeState(P, Math.PI * P.R / 2 - 100, 0, { mode: 'terrace' }, {}).uGroundMode, 0, '纬度 ＜2° 自动按斜坡');
}

section('6 groundPoint 落地；图表坐标的相机原点＋chartD＝绝对图表坐标');
for (const mode of ['terrace', 'slope']) {
  const S = g.makeState(P, 6670, -4, { mode }, {});
  let off = 0, chartErr = 0;
  for (let i = 0; i < 300; i++) {
    const dc = [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40];
    const v = g.groundPoint(S, dc);
    off = Math.max(off, Math.abs(g.altAt(S, v)));
    const X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], rho = Math.hypot(X[0], X[2]), phi = S.phi + Math.atan2(X[2], X[0]);
    const cAbs = g.chart(S.GS, X[1], phi, rho), cd = g.chartD(S, v);
    chartErr = Math.max(chartErr, Math.abs(S.chart[0] + cd[0] - cAbs[0]), Math.abs(S.chart[1] + cd[1] - cAbs[1]));
  }
  ok(off < 1e-6, `${mode === 'terrace' ? '阶地' : '斜坡'}：groundPoint 的离地高度最大 ${(off * 1e6).toFixed(3)} mm`);
  ok(chartErr < 1e-8, `${mode === 'terrace' ? '阶地' : '斜坡'}：c(相机)＋chartD(v)＝c(X)，最大差 ${(chartErr * 1e6).toFixed(5)} mm（斜坡北向符号已改正）`);
}

section('7 limits、terraceLevel、与相机联调、性能');
{
  const lim = g.limits({});
  ok(['uAmpZone', 'uLip', 'uClearMax', 'uHc'].every(k => isFinite(lim[k])), 'limits({}) 形状齐全');
  const Lr = g.limits({ mode: 1, y: -3186.97, rho: 5517.6, ground: { W: 1.5, amp: 1, abyssDepth: 30, abyssHalf: 220 }, zone: 'rui' });
  near(Lr.uAmpZone, 1.25, 1e-12, '罪域起伏系数 1.25');
  near(Lr.uHc, 1.5 * 3186.97 / 5517.6, 1e-9, 'uHc＝W·|y|/ρ_s');
  const lipT = 1.2 * (3 * 0.018 / 0.2 + 3 * 0.0032 / 0.035 + 3 * 0.0007 / 0.006) * 1.25 + 0.05;
  near(Lr.uLip, lipT, 1e-9, `阶地 uLip 只算第 3–5 层（${lipT.toFixed(3)}）`);
  near(Lr.uClearMax, 1.6269 * 1.25 + 1.2 * Lr.uHc + 0.02, 1e-9, 'uClearMax＝ΣA·amp＋1.2·崖高＋0.02');
  const Ls = g.limits({ mode: 0, y: -3186.97, rho: 5517.6, ground: { amp: 2 }, zone: 'plain' });
  near(Ls.uAmpZone, 1.4, 1e-12, '起伏倍率乘进 uAmpZone（平域 0.7×2）');
  ok(Ls.uLip > Lr.uLip * 0.9, '斜坡 uLip 含第 0–5 层');
  const Lq = g.limits({ mode: 1, y: -150, rho: 6369, ground: { abyssDepth: 30, abyssHalf: 220 } });
  ok(Lq.uLip > Lr.uLip, '离赤道近时 uLip 加上深渊沟壁的坡');
  const tl = g.terraceLevel(1.5 * 7.5, 1.5, 0, 0, 0, 0);
  ok(tl.k === 7 && Math.abs(tl.f - 0.5) < 1e-12 && Math.abs(tl.Yq - 12) < 1e-12, 'terraceLevel：踏面中间 k＝7、f＝0.5、Y_q＝W·(k＋1)');
  const tc = g.terraceLevel(1.5 * 7.01, 1.5, 0, 0, 0, 0);
  ok(tc.Yq < 12 && tc.Yq > 10.5, '崖带里（f＜c）Y_q 在两级之间');
  eq(g.layerParams('light').amp, 1.6, 'layerParams：轻域 1.6');

  const K = HY.fp.cam;
  const camReal = K && typeof K.create === 'function' && !(K.__stubs && K.__stubs.indexOf('create') >= 0);
  if (camReal) {
    const fps = { eye: 1.6, yaw: 0, pitch: 0, fov: 55, bob: false, ground: { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 } };
    for (const [name, s, az] of SITES.slice(0, 4)) {
      const cam = K.create(P, { s, az }, fps, { zones: { gLight: 0.75, gHeavy: 1.2, limboKm: 333 } });
      const S = Object.assign({}, cam.compute(), HY.fp.set && HY.fp.set.values ? HY.fp.set.values({ fp: Object.assign({ atmo: { on: true, HR: 40, HM: 6, V: 200, g: 0.76 }, cloud: { on: true, cover: 0.42, base: 1.5, top: 6.5, sigma: 22, rui: 1, ruiBase: 1.2, ruiTop: 6, ruiTau: 60, rain: 0.03, wind: 1 }, set: { veil: false, veilK: 0.3, yuxi: 'auto', yuxiLead: 45, acid: false }, eyeo: { auto: true, evLock: 12, evComp: 0, cat: 0.7, scotopic: true, glare: 1 } }, fps), zones: { gLight: 0.75, gHeavy: 1.2, limboKm: 333 }, time: { t: 0 } }, P, 0) : {});
      S.uGroundMode = cam.mode();
      const a0 = g.altAt(S, [0, 0, 0]);
      ok(Math.abs(a0 - S.uCamAlt) < 0.05, `${name}：用 fp/camera.js 的 uniform，镜像 alt(0)−眼高＝${((a0 - S.uCamAlt) * 1000).toFixed(1)} m（float32 原点，＜5 cm）`);
    }
  } else console.log('  （fp/camera.js 还是桩，跳过联调）');

  const S = g.makeState(P, 6670, -4, {}, {}), t0 = Date.now();
  for (let i = 0; i < 2000; i++) g.foot(S.uOrg.map(o => [o[0] + i * 1e-5, o[1]]), 1.25, 1);
  const t1 = Date.now();
  for (let i = 0; i < 2000; i++) g.altAt(S, [-0.001, (rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.02]);
  const t2 = Date.now();
  ok(t1 - t0 < 600, `foot() 2000 次 ${t1 - t0} ms（碰撞每步几次，够用）`);
  ok(t2 - t1 < 1200, `altAt() 2000 次 ${t2 - t1} ms`);
}

/* 8. 截步用的 du/dt：与沿视线数值差分的相位变化率对拍。
 *    duDt 的梯度取自高度图 GB 通道（中心差分再插值），数值差分走的是 R 通道的双线性面，两者天生差一点（噪声本身的量级）；
 *    02 原式漏了 ∂u/∂P（第 0、1 层），差得多得多——这里同时量原式，确认补上那一项确实把误差压下来。 */
section('8 duDt（阶地相位的方向导数）对数值差分；补上 ∂u/∂P 前后');
{
  const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.floor(p * (arr.length - 1))];
  const uAt = (S, v) => { g.altAt(S, v, 2e-4, 0); return g.last.U + g.last.K; };
  function specDuDt(S, v, d) {                       // 02 第八节第 5 条原式（不含 P）
    const X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], gE = [0, 0, 0], gN = [0, 0, 0];
    g.chartGrad(S, X, gE, gN);
    const dc = g.chartD(S, v), Lw = g.layerTex(6, dc, S.uOrg, [0, 0, 0, 0]), Lb = g.layerTex(2, dc, S.uOrg, [0, 0, 0, 0]);
    let r = d[1] * Math.sign(X[1]) / S.uW;
    for (let i = 0; i < 3; i++) r += d[i] * (-S.uWig * (Lw[1] * gE[i] + Lw[2] * gN[i]) - S.uJit * (Lb[1] * gE[i] + Lb[2] * gN[i]));
    return r;
  }
  for (const [name, s, az] of SITES.slice(0, 4)) {
    const S = g.makeState(P, s, az, { mode: 'terrace' }, {});
    const eNew = [], eOld = [];
    for (let i = 0; i < 1500; i++) {
      const th = rnd() * 2 * Math.PI, el = (rnd() - 0.5) * 0.2;
      const d = [-Math.sin(el), -Math.cos(el) * Math.cos(th), -Math.cos(el) * Math.sin(th)];   // 上＝−x，北＝−y，东＝−z
      const t = rnd() * 60, h = 1e-3, v = d.map(x => x * t);
      const num = (uAt(S, d.map(x => x * (t + h))) - uAt(S, v)) / h;
      if (Math.abs(num) > 50) continue;               // 跨过级界（u 跳 1）
      eNew.push(Math.abs(g.duDt(S, v, d) - num)); eOld.push(Math.abs(specDuDt(S, v, d) - num));
    }
    const n90 = q(eNew, 0.9), o90 = q(eOld, 0.9);
    ok(n90 < 0.1 && q(eNew, 1) < 0.3, `${name}：du/dt 误差 p90 ${n90.toFixed(3)}、最大 ${q(eNew, 1).toFixed(3)} /km（u 本身约 ${(1 / S.uW).toFixed(2)} /km）`);
    ok(o90 > 1.4 * n90, `${name}：02 原式（不含 P）p90 ${o90.toFixed(3)} /km，补上后降到 ${(n90 / o90 * 100).toFixed(0)}%`);
  }
  const lib = HY.glsl.terrain_lib || '', fnS = (src, sig) => { const i = src.indexOf(sig); if (i < 0) return ''; let dd = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') dd++; else if (src[k] === '}' && --dd === 0) return src.slice(i, k + 1); } return ''; };
  ok(/gGP/.test(fnS(lib, 'float duDt(')) && /gGw/.test(fnS(lib, 'float duDt(')) && !/layerTex/.test(fnS(lib, 'float duDt(')), 'terrain_lib.glsl 的 duDt 含 ∂u/∂P 项、只用 altAt 缓存的梯度（不再取纹理）');
  ok(/gGP\s*=/.test(fnS(lib, 'float altAt(')) && /gGw\s*=\s*Lw\.gb/.test(fnS(lib, 'float altAt(')), 'altAt 置梯度缓存 gGP、gGw、gGb');
}

/* 9. 地面法线（JS 镜像与 GLSL 同式）。高度图的梯度通道是中心差分，与 R 通道的双线性面本来就差几度（噪声量级），
 *    所以分开验：chartGrad 对 chartD 的数值导数；阶地踏面（关掉第 3–5 层）应严格朝上；斜坡（关掉全部层）只剩球面与深渊沟；
 *    崖带里的近似（分母取 |y|、ρ_s）在几度以内；全部层时与数值梯度差几度（量级检查）。 */
section('9 terrainNormal 与 chartGrad');
{
  const q = (arr, p) => arr.slice().sort((x, y) => x - y)[Math.floor(p * (arr.length - 1))];
  const saved = g.LAY_A.slice();
  function numN(S, v) {
    const hh = 1e-5, gr = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const a = v.slice(), b = v.slice(); a[k] += hh; b[k] -= hh; gr[k] = (g.altAt(S, a, 2e-4, 0) - g.altAt(S, b, 2e-4, 0)) / (2 * hh); }
    const L = Math.hypot(...gr); return gr.map(x => x / L);
  }
  const angle = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI;
  for (const mode of ['terrace', 'slope']) {           // chartGrad：图表坐标对世界坐标的梯度＝chartD 的数值导数
    const S = g.makeState(P, 6670, -4, { mode }, {});
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const v = [(rnd() - 0.5) * 2, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40], X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], gE = [0, 0, 0], gN = [0, 0, 0];
      g.chartGrad(S, X, gE, gN);
      for (let k = 0; k < 3; k++) {
        const a = v.slice(), b = v.slice(); a[k] += 1e-4; b[k] -= 1e-4;
        const ca = g.chartD(S, a, [0, 0]), cb = g.chartD(S, b, [0, 0]);
        worst = Math.max(worst, Math.abs((ca[0] - cb[0]) / 2e-4 - gE[k]), Math.abs((ca[1] - cb[1]) / 2e-4 - gN[k]));
      }
    }
    ok(worst < 1e-6, `${mode === 'terrace' ? '阶地' : '斜坡'}：chartGrad 与 chartD 的数值导数最大差 ${worst.toExponential(2)}`);
  }
  try {
    for (const [name, s, az, mode, zero] of [['罪域', 6670, -4, 'terrace', [3, 4, 5]], ['圣禁城', 3600, 0, 'terrace', [3, 4, 5]], ['罪域', 6670, -4, 'slope', [0, 1, 2, 3, 4, 5]],
      ['赤道往北 150 km（沟壁）', Math.PI * P.R / 2 - 150, 10, 'slope', [0, 1, 2, 3, 4, 5]]]) {
      for (let k = 0; k < 7; k++) g.LAY_A[k] = saved[k];
      zero.forEach(k => { g.LAY_A[k] = 0; });
      const S = g.makeState(P, s, az, { mode }, {});
      const tread = [], cliff = [];
      for (let i = 0; i < 400; i++) {
        const v = g.groundPoint(S, [(rnd() - 0.5) * 20, (rnd() - 0.5) * 20]);
        const na = g.terrainNormal(S, v, 2e-4), inCliff = mode === 'terrace' && g.last.U < S.uCliffC;
        (inCliff ? cliff : tread).push(angle(na, numN(S, v)));
      }
      ok(q(tread, 1) < 0.05, `${name}·${mode === 'terrace' ? '阶地踏面（关第 3–5 层）' : '斜坡（只剩球面与沟）'}：${tread.length} 点法线与数值梯度最大差 ${q(tread, 1).toFixed(4)}°`);
      if (cliff.length) ok(q(cliff, 0.5) < 5 && q(cliff, 1) < 25, `${name}·崖带：${cliff.length} 点，中位 ${q(cliff, 0.5).toFixed(2)}°、最大 ${q(cliff, 1).toFixed(1)}°（崖面近乎竖直，分母取近似）`);
    }
  } finally { for (let k = 0; k < 7; k++) g.LAY_A[k] = saved[k]; }
  for (const mode of ['terrace', 'slope']) {           // 全部层：几何是 R 的双线性面，法线取 GB 中心差分，天生差几度
    const S = g.makeState(P, 6670, -4, { mode }, {}), all = [];
    for (let i = 0; i < 300; i++) { const v = g.groundPoint(S, [(rnd() - 0.5) * 20, (rnd() - 0.5) * 20]); const na = g.terrainNormal(S, v, 2e-4); if (mode === 'slope' || g.last.U >= S.uCliffC + 0.02) all.push(angle(na, numN(S, v))); }
    ok(q(all, 0.5) < 8 && q(all, 1) < 30, `罪域·${mode === 'terrace' ? '阶地踏面' : '斜坡'}·全部层：法线与 R 面数值梯度中位差 ${q(all, 0.5).toFixed(1)}°、最大 ${q(all, 1).toFixed(1)}°（GB 通道是中心差分）`);
  }
}

/* 10. 绝对级号（田块按级换作物用）：踏面上 Y_q＝W·(级号＋1)，缓存 gYq（JS 的 last.Yq）与绝对求值一致、是 W 的整数倍 */
section('10 踏面的绝对 Y_q（gYq）');
{
  for (const [name, s, az] of SITES.slice(0, 4)) {
    const S = g.makeState(P, s, az, { mode: 'terrace' }, {});
    let worst = 0, frac = 0, n = 0;
    for (let i = 0; i < 300; i++) {
      const v = g.groundPoint(S, [(rnd() - 0.5) * 30, (rnd() - 0.5) * 30]);
      g.altAt(S, v); if (g.last.U < S.uCliffC + 0.01) continue;
      const X = [S.uCamW[0] + v[0], S.uCamW[1] + v[1], v[2]], phi = S.phi + Math.atan2(X[2], X[0]);
      const ab = g.groundAbs(S.GS, X[1], phi, {});
      worst = Math.max(worst, Math.abs(g.last.Yq - ab.Yq));
      const r = g.last.Yq / S.uW; frac = Math.max(frac, Math.abs(r - Math.round(r))); n++;
    }
    ok(n > 200 && worst < 1e-6 && frac < 1e-6, `${name}：${n} 个踏面点，gYq 与绝对 Y_q 差 ${(worst * 1e6).toFixed(3)} mm，Y_q/W 离整数 ${frac.toExponential(1)}`);
  }
  ok(!/\bgK\b/.test((HY.glsl.shade_terrain || '').replace(/\/\/.*$/gm, '')), 'shade_terrain.glsl 不再用相对级号 gK（田块颜色不随相机换级而变）');
}


/* 11. 地形求交的远界 tTerFar：相机在内壁球面之外（洼地、深渊沟里，K＞0）时，原来的 tWallCam 对朝下的视线给出负数，
 *     粗级第一步就出界、地面整片漏掉。tTerFar 对任何视线都不小于 CPU 步进到的地面命中距离。 */
section('11 地形求交的远界：相机低于内壁球面（洼地、深渊沟）也有效；步数用尽的处理');
{
  const tWallCam = (S, cd) => -cd + Math.sqrt(Math.max(cd * cd - S.uCamK, 0));
  function march(S, d, tmax) {
    let t = 0;
    for (let i = 0; i < 20000; i++) { const a = g.altAt(S, [d[0] * t, d[1] * t, d[2] * t]); if (a < 0) return t; t += Math.max(a * 0.3, 2e-4); if (t > tmax) return -1; }
    return -1;
  }
  const cases = [['赤道（沟底，斜坡）', Math.PI * P.R / 2, 0, { mode: 'slope' }], ['沟壁 y≈150 km（斜坡）', Math.PI * P.R / 2 - 150, 10, { mode: 'slope' }],
    ['平域 s＝5000 洼地（斜坡）', 5000, 10, { mode: 'slope' }], ['罪域（阶地，相机在球面内）', 6670, -4, { mode: 'terrace' }]];
  for (const [name, s, az, gs] of cases) {
    const S = g.makeState(P, s, az, gs, {});
    let n = 0, bad = 0, oldBad = 0, worse = 0;
    for (let i = 0; i < 60; i++) {
      const el = -(0.02 + rnd() * 0.6), th = rnd() * 2 * Math.PI;              // 相对重力水平往下 1°–35°
      const d = [-Math.sin(el), -Math.cos(el) * Math.cos(th), -Math.cos(el) * Math.sin(th)];
      const cd = S.uCamW[0] * d[0] + S.uCamW[1] * d[1] + S.uCamW[2] * d[2], tf = g.tTerFar(S, cd), tw = tWallCam(S, cd);
      if (S.uCamK < 0 && tf < tw - 1e-9) worse++;
      const hit = march(S, d, 600); if (hit < 0) continue;
      n++; if (!(tf > hit)) bad++; if (!(tw > hit)) oldBad++;
    }
    ok(n >= 30 && bad === 0 && worse === 0, `${name}：uCamZ ${S.uCamZ.toFixed(3)} km，${n} 条朝下的视线命中地面都在远界之内（tWallCam 有 ${oldBad} 条不在）`);
    if (S.uCamK > 0) ok(oldBad > 0, `${name}：相机在球面之外时旧远界确实会漏（${oldBad}/${n}）`);
  }
  const noC = x => (x || '').replace(/\/\/.*$/gm, '');
  ok(/tTerFar\(cd\)/.test(noC(HY.glsl.terrain_coarse)) && /tTerFar\(cd\)/.test(noC(HY.glsl.terrain)) && !/tWallCam/.test(noC(HY.glsl.terrain_coarse) + noC(HY.glsl.terrain)) && /float tTerFar\(/.test(HY.glsl.terrain_lib || ''),
    '粗级、精级的远界都用 tTerFar（不用 tWallCam）');
  // 精级步数用尽时的处理（浏览器验收“整屏扫描”量漏洞与假地面；这里守着写法）：粗级在 .y 标出“步数用尽的保守下界”，
  // 精级按宏观几何（球面＋深渊沟、阶地的踏面与崖带）外推并验证，粗级的保守下界只在视线不离开宏观地面时才信
  ok(/oc = vec4\(res, done \? 0\.0 : 1\.0/.test(noC(HY.glsl.terrain_coarse)), 'terrain_coarse 输出 .y＝1 标“步数用尽”（不是确认命中）');
  ok(/\.y < 0\.5 \|\| !rising/.test(noC(HY.glsl.terrain)) && /macroUp\(/.test(noC(HY.glsl.terrain)) && /duDt\(d\*tl, d\)/.test(noC(HY.glsl.terrain)), 'terrain.frag 步数用尽：按宏观几何外推（含崖带）、只在视线不离开宏观地面时信粗级的保守下界');
  ok(/vec3 macroUp\(vec3 X\)\{ return normalize\(-normalize\(X\) \+ vec3\(0\.0, trenchD\(X\.y\), 0\.0\)\); \}/.test(HY.glsl.terrain_lib || ''), 'macroUp＝球面＋深渊沟的梯度方向（与 terrainNormal 的宏观部分同式）');
}


/* 12. 高档的 8 方向扫描遮蔽（02 第八节第 7 条“高档另加”；horizon.frag 第 0 级 B 通道，JS 镜像 ground.aoScan）：
 *     开阔踏面接近 1，崖脚（北面上一级的崖就在十几米外）明显变暗；值在 [0, 1]；着色器写法与镜像同式 */
section('12 高档的 8 方向扫描遮蔽');
{
  for (const [name, s, az] of [['罪域', 6670, -4], ['圣禁城', 3600, 0]]) {
    const S = g.makeState(P, s, az, { mode: 'terrace' }, {}), open = [], foot = [], all = [];
    for (let k = -400; k <= 400; k += 2) {
      const v = g.groundPoint(S, [0.37 * k * 0.001, k * 0.005]); g.altAt(S, v); const U = g.last.U;
      const a = g.aoScan(S, [v[0] - 0.0005, v[1], v[2]]);          // 阶地的“上”＝(−1, 0, 0)，抬高 0.5 m
      all.push(a); if (U > 0.4 && U < 0.6) open.push(a); if (U > 0.985 && U < 0.999) foot.push(a);
    }
    const mean = x => x.reduce((p, q) => p + q, 0) / x.length;
    ok(all.every(a => a >= 0 && a <= 1), `${name}：${all.length} 点都在 [0, 1]`);
    ok(open.length > 20 && mean(open) > 0.93, `${name}：开阔踏面（相位 0.4–0.6）平均 ${mean(open).toFixed(3)}`);
    ok(foot.length >= 2 && mean(foot) < 0.75 && mean(foot) < mean(open) - 0.2, `${name}：崖脚（相位 0.985–0.999）平均 ${foot.length ? mean(foot).toFixed(3) : '—'}，比踏面暗`);
  }
  const hz = HY.glsl.horizon || '', st = HY.glsl.shade_terrain || '', lib = HY.glsl.terrain_lib || '';
  ok(/#if TER_AO_SCAN/.test(hz) && /float s = 0\.004\*exp2\(2\.0\*float\(j\)\);/.test(hz) && /th = max\(th, -altAt\(vg \+ dir\*s, max\(s\*0\.01, 1e-3\), 0\)\/s\);/.test(hz) && /ao = 1\.0 - occ\/8\.0;/.test(hz),
    'horizon.frag 的扫描写法与 ground.aoScan 同式（8 方向 × 4、16、64、256 m，1 − 平均 sin²h）');
  ok(/#ifndef TER_AO_SCAN/.test(lib) && /float aoScan\(vec2 dc\)/.test(st) && /aoScan\(dc\)/.test(st.replace(/\/\/.*$/gm, '')), 'TER_AO_SCAN 默认关；shade_terrain 着色时查 aoScan');
}

T.done();
