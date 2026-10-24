#!/usr/bin/env node
/* test/sky_check.js —— sky 二修的自检（负责：sky）
 *   1 塔缘气层：日面只露一线时透射不为 0（三条弦取在露出的那一段上），随日面滑进塔缘单调变暗、变红；GLSL 结构
 *   2 塔缘气层的散射光：朝着日面看时与日面同样变红（沿气柱四段取样），远离日面时是一道亮边
 *   3 月海：GLSL 的 MARE_W 与 JS 镜像同值
 *   4 酸霾：默认消光与滑杆范围（能见度十来公里）；按离脚下地面的高度
 *   5 灵薄带：颜色边界随噪声起伏（对岸不再是两道以塔为心的正圆细线）
 *   6 合成：低分辨率 pass 按整个纹素抖动、远段深度键逐子样取（地平线云带台阶、塔脚虚线亮弧）
 * 塔缘气层的 JS 是 common.glsl 的 sheathTau／sunSheathT／sheathGlow 逐式移植（GLSL 改了这里也要改，第 1 节末尾的正则守着结构）。
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('sky_check');
const { section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
console.warn = () => {};
HY.model.rebuildP();
const P = HY.model.P, A = HY.astro, G = HY.glsl;
const strip = s => s.replace(/\/\/[^\n]*/g, '');

/* ───────── 塔缘气层的 JS 移植（common.glsl） ───────── */
const SH_C = [0.43, 1.0, 2.44];
function mk(n0, H) {
  const uA = P.a, S = {};
  const phi = x => 0.5 + 0.5 * Math.tanh(0.7978846 * (x + 0.044715 * x * x * x));
  S.tau = function (X, d, Ls) {           // → {tau, blk}
    const lh = Math.hypot(d[0], d[2]);
    if (n0 <= 0 || lh < 1e-4) return { tau: 0, blk: false };
    const q = [d[0] / lh, d[2] / lh], p = [X[0], X[2]];
    const tc = -(p[0] * q[0] + p[1] * q[1]);
    let rmin = Math.abs(p[0] * q[1] - p[1] * q[0]); const dp = rmin - uA;
    if (dp > 8 * H) return { tau: 0, blk: false };
    let sh = Ls * lh, blk = false;
    if (dp < 0) { const tIn = tc - Math.sqrt(Math.max(uA * uA - rmin * rmin, 0)); if (sh > tIn) { blk = true; sh = Math.max(tIn, 0); } rmin = uA; }
    const sg = Math.sqrt(rmin * H), f = phi((sh - tc) / sg) - phi(-tc / sg);
    return { tau: n0 * Math.sqrt(2 * Math.PI * rmin * H) * Math.exp(-Math.max(dp, 0) / H) * Math.max(f, 0) / lh, blk };
  };
  const impact = (X, v) => { const l = Math.hypot(v[0], v[2]); return X[0] * v[2] / l - X[2] * v[0] / l; };
  // 新：三条弦落在露出的那一段；old＝真时按原先固定的 −0.7、0、0.7
  S.sunT = function (X, Sw, old) {
    const v = [Sw[0] - X[0], Sw[1] - X[1], Sw[2] - X[2]], ql = Math.hypot(v[0], v[2]), q = [v[0] / ql, v[2] / ql], np = [-q[1], 0, q[0]];
    let lo = -1, hi = 1;
    if (!old && -(X[0] * q[0] + X[2] * q[1]) > 0) {
      const vm = [v[0] - np[0] * P.rhoS, v[1], v[2] - np[2] * P.rhoS], vp = [v[0] + np[0] * P.rhoS, v[1], v[2] + np[2] * P.rhoS];
      const bm = impact(X, vm), bp = impact(X, vp), cm = Math.abs(bm) < uA, cp = Math.abs(bp) < uA;
      if (cm && cp) return [0, 0, 0];
      if (cm !== cp) {
        const bt = cm ? Math.sign(bp) * uA : Math.sign(bm) * uA;
        const os = Math.min(1, Math.max(-1, -1 + 2 * (bt - bm) / (bp - bm)));
        if (cm) lo = os; else hi = os;
      }
    }
    const acc = [0, 0, 0]; let ws = 0;
    for (let i = 0; i < 3; i++) {
      const o = old ? 0.7 * (i - 1) : lo + (hi - lo) * (i + 0.5) / 3, w = Math.sqrt(Math.max(1 - o * o, 0.02));
      const vi = [v[0] + np[0] * o * P.rhoS, v[1], v[2] + np[2] * o * P.rhoS], Li = Math.hypot(vi[0], vi[1], vi[2]);
      const r = S.tau(X, vi.map(c => c / Li), Li);
      if (r.blk) continue;
      for (let c = 0; c < 3; c++) acc[c] += w * Math.exp(-r.tau * SH_C[c]);
      ws += w;
    }
    return ws > 0 ? acc.map(a => a / ws) : [0, 0, 0];
  };
  // 散射光（不含 uSunI、塔影、夜幕这些公共因子，只看颜色与相对量）：新＝四段；old＝中点一次、乘 1−e^{−τ}
  const phaseR = c => 0.0596831 * (1 + c * c);
  S.glow = function (O, d, Ls, Sw, old) {
    const r = S.tau(O, d, Ls), tau = r.tau, lh = Math.hypot(d[0], d[2]), q = [d[0] / lh, d[2] / lh], p = [O[0], O[2]];
    const tc = -(p[0] * q[0] + p[1] * q[1]); let rmin = Math.abs(p[0] * q[1] - p[1] * q[0]), sh = Ls * lh;
    const at = P2 => { const v = [Sw[0] - P2[0], Sw[1] - P2[1], Sw[2] - P2[2]], d2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], l = Math.sqrt(d2);
      const t = S.sunT(P2, Sw, old), ph = phaseR((d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / l); return t.map(c => c * ph / d2); };
    const push = P2 => { const rr = Math.hypot(P2[0], P2[2]); if (rr < uA + 0.5) { P2[0] *= (uA + 0.5) / rr; P2[2] *= (uA + 0.5) / rr; } return P2; };
    if (old) {
      const tt = Math.min(Math.max(tc / lh, 0), Ls), E = at(push([O[0] + d[0] * tt, O[1] + d[1] * tt, O[2] + d[2] * tt]));
      return E.map((e, c) => e * (1 - Math.exp(-tau * SH_C[c])));
    }
    if (rmin < uA) { const tIn = tc - Math.sqrt(Math.max(uA * uA - rmin * rmin, 0)); sh = Math.min(sh, Math.max(tIn, 0)); rmin = uA; }
    const sg = Math.sqrt(rmin * H), F0 = phi(-tc / sg), F1 = phi((sh - tc) / sg), g = [0, 0, 0], Tc = [1, 1, 1];
    const sT = SH_C.map(c => Math.exp(-0.25 * tau * c));
    for (let k = 0; k < 4; k++) {
      const F = Math.min(Math.max(F0 + (F1 - F0) * (k + 0.5) * 0.25, 1e-4), 1 - 1e-4), s = (tc + sg * 0.5876 * Math.log(F / (1 - F))) / lh;
      const E = at(push([O[0] + d[0] * s, O[1] + d[1] * s, O[2] + d[2] * s]));
      for (let c = 0; c < 3; c++) { g[c] += Tc[c] * E[c] * (1 - sT[c]); Tc[c] *= sT[c]; }
    }
    return g;
  };
  return S;
}

// 几何：观察点在 xz 平面上离塔轴 4000 km，日在日轨（半径 dS）上；日轨角 th 从“完全露出”往“全被塔挡”扫
const X = [4000, 0, 0];
const sunAt = th => [P.dS * Math.cos(th), 0, P.dS * Math.sin(th)];
const visAt = th => { const S = sunAt(th); return A.diskVisible(X[0], X[2], S[0], S[2], P.rhoS, P.a); };
function thOfVis(v) {                     // 二分：日在塔的 +z 一侧边上，从 th0（全露）到 th1（全挡）
  let a = 0.5 * Math.PI, b = Math.PI;      // 日在塔后方（远离观察者）的那半圈里
  // 先找一个全露、一个全挡的端点
  let th0 = null, th1 = null;
  for (let i = 0; i <= 2000; i++) { const th = a + (b - a) * i / 2000, w = visAt(th); if (w >= 1 && th0 == null) th0 = th; if (w <= 0 && th0 != null) { th1 = th; break; } }
  for (let k = 0; k < 60; k++) { const m = 0.5 * (th0 + th1); if (visAt(m) > v) th0 = m; else th1 = m; }
  return 0.5 * (th0 + th1);
}

section('1 塔缘气层：日面露出的那一段才算透射');
{
  const S = mk(0.02, 20), vs = [1, 0.6, 0.3, 0.1, 0.03, 0.01];
  const rows = vs.map(v => { const th = v >= 1 ? thOfVis(0.999) : thOfVis(v), Sw = sunAt(th); return { v, vis: visAt(th), n: S.sunT(X, Sw, false), o: S.sunT(X, Sw, true) }; });
  rows.forEach(r => console.log(`    露出 ${(r.vis * 100).toFixed(1)}%：新 [${r.n.map(c => c.toExponential(2)).join(', ')}]，原 [${r.o.map(c => c.toExponential(2)).join(', ')}]`));
  ok(rows.every(r => r.vis <= 0 || r.n[0] > 0), '日面露着（vis＞0）就有透射（红光不为 0）');
  ok(rows.filter(r => r.vis < 0.08).some(r => r.o[1] === 0), '对照：原先的固定三条弦在日面只露几个百分点时三条全被挡，透射＝0（问题单的 Edir 1644 → 0）');
  let mono = true, redder = true;
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].n[1] <= rows[i - 1].n[1] * (1 + 1e-9))) mono = false;
    const rg = r => r.n[0] / Math.max(r.n[1], 1e-300);
    if (!(rg(rows[i]) >= rg(rows[i - 1]) * (1 - 1e-9))) redder = false;
  }
  ok(mono, '日面往塔后滑：绿光透射单调降');
  ok(redder, '日面往塔后滑：红绿比单调升（黄 → 橙 → 红）');
  const r10 = rows.find(r => r.v === 0.1);
  ok(r10.n[2] < r10.n[1] && r10.n[1] < r10.n[0], `露一成时 蓝＜绿＜红（${r10.n.map(c => c.toFixed(4)).join('，')}）`);
  const S0 = mk(0, 20);
  ok(S0.sunT(X, sunAt(thOfVis(0.1)), false).every(c => c === 1), 'n₀＝0（默认关）：透射恒为 1');
  const g = strip(G.common);
  ok(/float\s+sheathImpact\s*\(/.test(g) && /mix\(lo, hi, \(float\(i\) \+ 0\.5\)\/3\.0\)/.test(g), 'common.glsl：sunSheathT 的三条弦取在 [lo, hi]（露出的那一段）');
  ok(/sunE\([^)]*\)\{[^}]*sunSheathT\(X\)/.test(g.replace(/\n/g, ' ')), 'sunE 乘塔缘气层（日面、地面、云、远壁、到眼日照都经它）');
}

section('2 塔缘气层的散射光：朝着日面时同样变红');
{
  const S = mk(0.02, 20), th = thOfVis(0.1), Sw = sunAt(th);
  // 朝日面露出部分的中心看
  const v = [Sw[0] - X[0], 0, Sw[2] - X[2]], L = Math.hypot(v[0], v[2]), q = [v[0] / L, v[2] / L], np = [-q[1], 0, q[0]];
  let best = null;
  for (let o = -1; o <= 1; o += 0.01) {   // 日面上露出的部分里，最贴塔缘（τ 最大）的那条视线
    const w = [v[0] + np[0] * o * P.rhoS, 0, v[2] + np[2] * o * P.rhoS], l = Math.hypot(w[0], w[2]), d = [w[0] / l, 0, w[2] / l];
    const r = S.tau(X, d, l); if (!r.blk && (!best || r.tau > best.tau)) best = { d, l, tau: r.tau }; }
  const gN = S.glow(X, best.d, best.l, Sw, false), gO = S.glow(X, best.d, best.l, Sw, true), tS = SH_C.map(c => Math.exp(-best.tau * c));
  const rg = a => a[0] / a[1];
  console.log(`    视线 τ(绿)＝${best.tau.toFixed(2)}；日面 红绿比 ${rg(tS).toFixed(2)}；散射光 新 ${rg(gN).toFixed(2)}、原 ${rg(gO).toFixed(2)}`);
  ok(rg(gN) > 1.5 * rg(gO), '朝着日面：新的散射光比原先红得多（原先中点取一次、只穿半根柱子，日边一圈发白发蓝）');
  ok(rg(gN) > 0.3 * rg(tS), '朝着日面：散射光的红绿比与日面同一量级');
  ok(gN[1] < gO[1], '朝着日面：散射光比原先暗（不再盖住变红的日面）');
  // 离开日面（沿塔缘往外 3°）：薄层，蓝光散射多（亮边偏白偏蓝），两种算法相近
  const a3 = 3 * Math.PI / 180, d3 = [best.d[0], Math.sin(a3), best.d[2]].map((c, i, arr) => c / Math.hypot(arr[0], arr[1], arr[2]));
  const g3N = S.glow(X, d3, 8000, Sw, false), g3O = S.glow(X, d3, 8000, Sw, true);
  ok(g3N.every(isFinite) && g3N[1] > 0, '沿塔缘离开日面：亮边仍在（有限、为正）');
  ok(Math.abs(Math.log(g3N[1] / g3O[1])) < Math.log(4), `沿塔缘离开日面：新旧亮边的量级相近（绿 ${g3N[1].toExponential(2)} 对 ${g3O[1].toExponential(2)}）`);
  ok(/vec3\s+sheathGlow\s*\(/.test(strip(G.common)) && /glow = sheathGlow\(uCamW, ds, tE, tau\)/.test(strip(G.composite)), 'composite.frag 的塔缘亮边调 common.glsl 的 sheathGlow');
}

section('3 月海：GLSL 与 JS 镜像同一个边缘宽度');
{
  const m = /#define\s+MARE_W\s+([0-9.]+)/.exec(G.moon);
  ok(m && Math.abs(+m[1] - HY.fp.cel.MARE_W) < 1e-12, `moon.glsl 的 MARE_W（${m && m[1]}）＝HY.fp.cel.MARE_W（${HY.fp.cel.MARE_W}）`);
  ok(/sstep\(uMoonMare \+ MARE_W, uMoonMare - MARE_W/.test(strip(G.moon)), 'moonAlbMod 用 MARE_W');
  ok(HY.fp.cel.MARE_W >= 0.03, '月海边缘有一段渐变（不是剪纸）');
}

section('4 酸霾');
{
  const sp = HY.store.SCHEMA['fp.set.acidExt'];
  const def = sp.def != null ? sp.def : sp.default, max = sp.max;
  ok(def >= 0.2 && def <= 1, `默认消光 ${def} /km（地面能见度 3.9/β≈${(3.912 / def).toFixed(0)} km，在 4–20 km 里）`);
  ok(max >= 1, `滑杆上限 ${max} /km（能见度可到两三公里）`);
  const PS = HY.ui && HY.ui.PARAMS ? HY.ui.PARAMS : null;
  const row = PS ? PS.find(r => r.path === 'fp.set.acidExt') : null;
  if (row) ok(row.max === max && row.min === sp.min, '参数页的范围与 store 一致');
  ok(/float za = max\(zp - max\(uCamZ - uCamAlt, 0\.0\)/.test(strip(G.common)) && /exp\(-za\/uAcid\.z\)/.test(strip(G.common)), 'medium：酸霾按离脚下地面的高度（阶地模式相机踏面离球面约 1 km）');
}

section('5 灵薄带的颜色边界');
{
  const b = strip(G.bake_world);
  ok(/float lW = uLimboKm\*\(1\.0 \+ [^;]*c2[^;]*mat/.test(b), 'bake_world：灵薄带的颜色边界随大陆起伏、物质噪声前后推');
  ok(/alb = mix\(alb, lim\*vec3\([0-9.]+\), limboC\)/.test(b) && !/alb = mix\(alb, lim, limbo\);/.test(b), 'bake_world：不再按纬线一刀切（limboW 只管分域）');
}

section('6 合成的上采样');
{
  const c = strip(G.composite);
  ok(/fc\*NEAR_SCALE - uJitter\*\(1\.0 - NEAR_SCALE\) - 0\.5/.test(c) && /fc\*FAR_SCALE - uJitter\*\(1\.0 - FAR_SCALE\) - 0\.5/.test(c), 'upNear／upFar：低分辨率纹素按自己整个纹素抖动，双线性位置随之换算');
  ok(/viewRay\(fc, uRes, uJitter, 1\.0\)/.test(strip(G.near)) && /viewRay\(fc, uRes, uJitter, 1\.0\)/.test(strip(G.far)), 'near／far：viewRay 按本 pass 的整个纹素抖动');
  ok(/float keyS = \(tTs > sgs\.y && tTs < tWs\) \? tTs : tWs;/.test(c) && /upFar\(fc \+ jo, keyS\)/.test(c), '远段的深度键逐子样取（塔脚进对面大气那一圈不再有虚线亮弧）');
}

T.done();
