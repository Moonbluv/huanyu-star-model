#!/usr/bin/env node
/* test/tower_vis.js —— GLSL towerVis／eclipseVis 的 JS 逐行移植，对拍 HY.astro（规格：spec/02 第十八节；负责：G 路）
 *
 * 1. 着色器没漂移：common.glsl 里 towerVis、eclipseVis 的源码（去空白）与本文件抄的一致；改了着色器就得同步改这里的移植。
 * 2. towerVis 与 HY.astro.diskVisible 在 1 万组随机点上相差＜1e-4（日、月、任意发光球三类目标）。
 * 3. eclipseVis 与 HY.astro.eclipseFrac 一致：罪域、涅赫莱恩两年里的每一次日食逐分钟对拍（1−露出＝被遮比例），相差＜1e-3
 *    （GLSL 用视半径≈ρ/D、角距≈sin 的小角近似，日月视径都在 6° 以内，差在千分之一以下）；两京一次也没有。
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('tower_vis');
const { near, section } = T;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); return T.ok(c, m); };
const A = HY.astro, P = HY.model && HY.model.P ? HY.model.P : A.params();

/* ───────── 1. 源码对照 ───────── */
const GLSL_TOWERVIS = `float towerVis(vec3 X, vec3 S, float rho){
  vec2 p = X.xz; float rp2 = dot(p, p), a2 = uA*uA;
  if (rp2 <= a2) return 0.0;
  float rp = sqrt(rp2); vec2 q = S.xz - p; float Lh = length(q);
  if (Lh < 1e-3) return 1.0;
  vec2 c = -p/rp; float cosA = dot(q, c)/Lh;
  if (cosA <= 0.0) return 1.0;
  float sinA = abs(c.x*q.y - c.y*q.x)/Lh, sd = uA/rp, cdd = sqrt(max(1.0 - sd*sd, 0.0));
  float u = Lh*(sinA*cdd - cosA*sd)/rho;
  if (u >= 1.0) return 1.0;
  if (sinA < sd){ float tHit = rp*cosA - sqrt(max(a2 - rp2*sinA*sinA, 0.0)); if (Lh < tHit) return 1.0; }
  else if (Lh < rp*cdd) return 1.0;
  if (u <= -1.0) return 0.0;
  return 0.5 + (u*sqrt(1.0 - u*u) + asin(u))/PI;
}`;
const GLSL_ECLIPSEVIS = `float eclipseVis(vec3 X){
  vec3 ds = uSunW - X, dm = uMoonW - X; float Ds = length(ds), Dm = length(dm);
  if (Dm >= Ds || dot(ds, dm) <= 0.0) return 1.0;
  float r1 = uSunRho/Ds, r2 = uMoonRho/Dm, sep = length(cross(ds/Ds, dm/Dm));
  if (sep >= r1 + r2) return 1.0;
  if (sep <= r2 - r1) return 0.0;
  if (sep <= r1 - r2) return 1.0 - sq(r2/r1);
  float x = (sep*sep + r1*r1 - r2*r2)/(2.0*sep);
  float A = r1*r1*acos(clamp(x/r1, -1.0, 1.0)) + r2*r2*acos(clamp((sep - x)/r2, -1.0, 1.0)) - sep*sqrt(max(r1*r1 - x*x, 0.0));
  return 1.0 - A/(PI*r1*r1);
}`;
function fnSource(src, name) {
  const i = src.indexOf('float ' + name + '(');
  if (i < 0) return null;
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  return null;
}
const squash = s => (s || '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
section('1 着色器源码与本文件的移植对得上');
{
  const common = HY.glsl && HY.glsl.common;
  ok(!!common, 'HY.glsl.common 已载入');
  ok(squash(fnSource(common, 'towerVis')) === squash(GLSL_TOWERVIS), 'common.glsl 的 towerVis 与本测试抄的一致（不一致就同步改下面的 JS 移植）');
  ok(squash(fnSource(common, 'eclipseVis')) === squash(GLSL_ECLIPSEVIS), 'common.glsl 的 eclipseVis 与本测试抄的一致');
  const occl = HY.glsl && HY.glsl.ov_occl;
  if (occl && !/【桩】/.test(occl)) {
    ok(squash(fnSource(occl, 'towerVis')) === squash(GLSL_TOWERVIS), 'ov_occl.glsl 的 towerVis 是 common 的逐字副本');
    ok(squash(fnSource(occl, 'eclipseVis')) === squash(GLSL_ECLIPSEVIS), 'ov_occl.glsl 的 eclipseVis 是 common 的逐字副本');
  } else console.log('  （ov_occl.glsl 仍是桩，跳过副本对照）');
}

/* ───────── JS 逐行移植（双精度；X、S 为 [x, y, z]） ───────── */
function towerVis(X, S, rho, a) {
  const px = X[0], py = X[2];                       // vec2 p = X.xz
  const rp2 = px * px + py * py, a2 = a * a;
  if (rp2 <= a2) return 0;
  const rp = Math.sqrt(rp2), qx = S[0] - px, qy = S[2] - py, Lh = Math.sqrt(qx * qx + qy * qy);
  if (Lh < 1e-3) return 1;
  const cx = -px / rp, cy = -py / rp, cosA = (qx * cx + qy * cy) / Lh;
  if (cosA <= 0) return 1;
  const sinA = Math.abs(cx * qy - cy * qx) / Lh, sd = a / rp, cdd = Math.sqrt(Math.max(1 - sd * sd, 0));
  const u = Lh * (sinA * cdd - cosA * sd) / rho;
  if (u >= 1) return 1;
  if (sinA < sd) { const tHit = rp * cosA - Math.sqrt(Math.max(a2 - rp2 * sinA * sinA, 0)); if (Lh < tHit) return 1; }
  else if (Lh < rp * cdd) return 1;
  if (u <= -1) return 0;
  return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / Math.PI;
}
function eclipseVis(X, S, M, rhoS, rhoM) {
  const ds = [S[0] - X[0], S[1] - X[1], S[2] - X[2]], dm = [M[0] - X[0], M[1] - X[1], M[2] - X[2]];
  const Ds = Math.hypot(ds[0], ds[1], ds[2]), Dm = Math.hypot(dm[0], dm[1], dm[2]);
  if (Dm >= Ds || ds[0] * dm[0] + ds[1] * dm[1] + ds[2] * dm[2] <= 0) return 1;
  const a = ds.map(v => v / Ds), b = dm.map(v => v / Dm);
  const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const r1 = rhoS / Ds, r2 = rhoM / Dm, sep = Math.hypot(cr[0], cr[1], cr[2]);
  if (sep >= r1 + r2) return 1;
  if (sep <= r2 - r1) return 0;
  if (sep <= r1 - r2) return 1 - (r2 / r1) * (r2 / r1);
  const x = (sep * sep + r1 * r1 - r2 * r2) / (2 * sep);
  const cl = v => Math.max(-1, Math.min(1, v));
  const Ar = r1 * r1 * Math.acos(cl(x / r1)) + r2 * r2 * Math.acos(cl((sep - x) / r2)) - sep * Math.sqrt(Math.max(r1 * r1 - x * x, 0));
  return 1 - Ar / (Math.PI * r1 * r1);
}

/* ───────── 2. towerVis ↔ diskVisible ───────── */
// 可复现的伪随机
let seed = 20261014;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function randDir() { const z = 2 * rnd() - 1, ph = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z); return [r * Math.cos(ph), z, r * Math.sin(ph)]; }
// 腔内一点：壁面（地面）、空中、月轨一带三类；离塔面至少 1 km（地面从塔基 s＝600.9 km 起）
function randPoint(kind) {
  for (;;) {
    let X;
    if (kind === 0) { const d = randDir(); X = d.map(v => v * P.R); }
    else if (kind === 1) { const d = randDir(), r = P.R * Math.cbrt(rnd()); X = d.map(v => v * r); }
    else { const t = rnd() * P.Y, M = A.moonPos(t, P), d = randDir(); X = [M.x + d[0] * P.rhoM, M.y + d[1] * P.rhoM, M.z + d[2] * P.rhoM]; }
    if (Math.hypot(X[0], X[2]) > P.a + 1) return X;
  }
}
section('2 towerVis 与 HY.astro.diskVisible：1 万组随机点相差＜1e-4');
{
  const N = 10000, groups = { 日: [0, 0, 0], 月: [0, 0, 0], 任意: [0, 0, 0] };   // [个数, 最大差, 超差数]
  let partial = 0, worst = null;
  for (let i = 0; i < N; i++) {
    const X = randPoint(i % 3), g = i % 5 < 2 ? '日' : i % 5 < 4 ? '月' : '任意';
    let S, rho;
    if (g === '日') { const q = A.sunPos(rnd() * 4 * P.Y, P); S = [q.x, q.y, q.z]; rho = P.rhoS; }
    else if (g === '月') { const q = A.moonPos(rnd() * 4 * P.Y, P); S = [q.x, q.y, q.z]; rho = P.rhoM; }
    else {
      rho = 1 + 199 * rnd();
      do { S = randPoint(1); } while (Math.hypot(S[0], S[2]) < P.a + rho + 1);
    }
    if (Math.hypot(X[0] - S[0], X[1] - S[1], X[2] - S[2]) <= rho * 1.01) { i--; continue; }   // 观察点在发光球里，没有意义
    const v1 = towerVis(X, S, rho, P.a), v2 = A.diskVisible(X[0], X[2], S[0], S[2], rho, P.a), d = Math.abs(v1 - v2);
    const G = groups[g]; G[0]++; if (d > G[1]) G[1] = d; if (d >= 1e-4) { G[2]++; if (!worst || d > worst.d) worst = { d, X, S, rho, v1, v2 }; }
    if (v2 > 1e-6 && v2 < 1 - 1e-6) partial++;
  }
  for (const g in groups) {
    const G = groups[g];
    ok(G[2] === 0, `${g}：${G[0]} 组，最大差 ${G[1].toExponential(2)}，超差 ${G[2]} 组`);
  }
  if (worst) console.log('    最坏一组：', JSON.stringify(worst));
  ok(partial > 50, `其中被塔缘切到一部分的有 ${partial} 组（检验弓形公式，不只是 0／1）`);
}
section('2b 弓形区专项：日面正被塔缘切的时刻（罪域、伊美忒、涅赫莱恩、地点各 500 个时刻）');
{
  let maxd = 0, n = 0;
  for (const name of ['罪域', '伊美忒', '涅赫莱恩']) {
    const O = A.siteByName(name, P), X = [O.x, O.y, O.z];
    // 找一个“被东缘切出”的时刻附近，逐 10 秒取样
    let t0 = null;
    for (let t = 0; t < 2 && t0 === null; t += 1 / 1440) { const v = A.look(O, A.sunPos(t, P), P).vis; if (v > 0.01 && v < 0.99) t0 = t; }
    ok(t0 !== null, name + '：找到日面被塔缘切的时刻');
    if (t0 === null) continue;
    for (let k = -250; k < 250; k++) {
      const t = t0 + k * 10 / 86400, q = A.sunPos(t, P), S = [q.x, q.y, q.z];
      const d = Math.abs(towerVis(X, S, P.rhoS, P.a) - A.diskVisible(X[0], X[2], S[0], S[2], P.rhoS, P.a));
      if (d > maxd) maxd = d; n++;
    }
  }
  ok(maxd < 1e-4, `${n} 个时刻最大差 ${maxd.toExponential(2)}`);
}

/* ───────── 3. eclipseVis ↔ eclipseFrac ───────── */
section('3 eclipseVis 与 HY.astro.eclipseFrac：两年里的每一次日食');
{
  const hits = {};
  for (const name of ['罪域', '涅赫莱恩', '伊美忒', '圣禁城']) {
    const O = A.siteByName(name, P), X = [O.x, O.y, O.z];
    // 粗扫：日面不被塔挡、月在日前时看日月角距；步长 5 分钟（最短的偏食也有十几分钟）
    const list = [];
    let inE = false;
    for (let t = 0; t < 2 * P.Y; t += 5 / 1440) {
      const f = A.eclipseFrac(O, t, P);
      if (f > 0 && !inE) { list.push(t); inE = true; } else if (f <= 0) inE = false;
    }
    hits[name] = list.length;
    let maxd = 0, n = 0, maxF = 0;
    for (const tc of list) {
      for (let k = -40; k <= 40; k++) {      // 前后各 40 分钟，逐分钟
        const t = tc + k / 1440, S = A.sunPos(t, P), M = A.moonPos(t, P);
        if (A.look(O, S, P).vis <= 0) continue;       // eclipseFrac 在日面被塔挡时恒 0；只比日面露出时
        const fa = A.eclipseFrac(O, t, P), fg = 1 - eclipseVis(X, [S.x, S.y, S.z], [M.x, M.y, M.z], P.rhoS, P.rhoM);
        const d = Math.abs(fa - fg); if (d > maxd) maxd = d; if (fa > maxF) maxF = fa; n++;
      }
    }
    if (list.length) ok(maxd < 1e-3, `${name}：${list.length} 次日食、${n} 个时刻，最大遮挡 ${(maxF * 100).toFixed(1)}%，最大差 ${maxd.toExponential(2)}`);
  }
  ok(hits['罪域'] > 0 && hits['涅赫莱恩'] > 0, `罪域、涅赫莱恩两年里有日食（${hits['罪域']}、${hits['涅赫莱恩']} 次）`);
  ok(hits['伊美忒'] === 0 && hits['圣禁城'] === 0, '两京两年里一次日食也没有');
}

T.done();
