#!/usr/bin/env node
/* test/moon_norm.js —— 月面 BRDF 的归一与月光对拍（规格：spec/02 第十一节第 2 条、第十八节；负责：G 路）
 *
 * 1. 着色器没漂移：moon.glsl 的 shadeMoon 与本文件抄的一致（改了着色器就得同步改这里的 JS 镜像）。
 * 2. 盘面积分几何反照率＝pMoon±2%：用 HY.fp.cel.compute 给出的 uMoonAlb，按 shadeMoon 的 JS 镜像在满相（α＝0）下对月盘积分。
 *    月海用全零纹理（噪声没生成时 GPU 采到的）与一张合成的三维纹理（调过 HY.fp.cel.calibrateMare 之后）各验一次；
 *    后者用盘面网格积分，与 calibrateMare 的斐波那契球是两种独立的求法。
 * 3. 相位：α＜100° 时积分月光与 HY.astro.moonLux 的朗伯式相差＜15%（合成几何逐度扫、真实几何随机抽，两处都验）。
 *    注（sky 修订）：shadeMoon 改成 Lommel–Seeliger 八成、朗伯两成（满月几乎是平的），L‑S 那一份另乘相位遮蔽
 *    S(α)＝Φ_朗伯/Φ_LS（≤1），整盘光通量随相位仍按朗伯式走；小相位角（S 夹在 1）时比朗伯式暗不到几个百分点。
 * 4. 真实几何：随机时刻、地点，月面整体受照、人看月不被塔挡时，积分月光与 HY.astro.moonLux 比较（同上门槛）；
 *    HY.fp.cel.moonE0lux（即 uMoonE0 的来源）＝moonLux／露出比例，逐位一致。
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('moon_norm');
const { section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const A = HY.astro, C = HY.fp.cel, P = A.params();
const PI = Math.PI;

/* ───────── 1. 源码对照 ───────── */
const GLSL_SHADEMOON = `vec3 shadeMoon(vec3 Q, vec3 d){
  vec3 n = normalize(Q - uMoonW), nb = transpose(uMoonBasis)*n;
  float A = uMoonAlb*moonAlbMod(nb);
  vec3 v = uSunW - Q; float d2 = dot(v, v); vec3 l = v*inversesqrt(d2);
  float vis = towerVis(Q, uSunW, uSunRho);                       // 逐点塔影：黑月、灰月的直影边
  vec3 t1 = normalize(cross(abs(nb.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), nb)), t2 = cross(nb, t1);
  float h0 = moonRelief(nb), h1 = moonRelief(normalize(nb + t1*0.012)), h2 = moonRelief(normalize(nb + t2*0.012));
  vec3 np = normalize(n - 0.035*(uMoonBasis*((t1*(h1 - h0) + t2*(h2 - h0))/0.012)));
  float sh = sstep(-0.02, 0.02, dot(n, l) + 0.06*(h0 - 0.5));   // 自遮挡：交界线按高低前后错开
  float mu0 = max(dot(np, l), 0.0), mu = max(dot(np, -d), 0.0);
  float brdf = MOON_WL*mu0 + MOON_WLS*2.0*mu0/(mu0 + mu + 1e-4)*moonPhaseS(dot(l, -d));
  return A/PI*(uSunI/d2*vis*veilT(Q, uSunW)*brdf*sh + shIrr(np, 2));
}`;
function fnSource(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return null;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  return null;
}
const squash = s => (s || '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
section('1 moon.glsl 的 shadeMoon 与本文件的镜像对得上');
ok(squash(fnSource(HY.glsl.moon || '', 'vec3 shadeMoon(')) === squash(GLSL_SHADEMOON), 'shadeMoon 源码一致（不一致就同步改下面的 JS 镜像）');

/* ───────── JS 镜像（双精度；世界照 shIrr 与暗幕不计：moonLux 里也没有） ───────── */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.sqrt(dot(a, a));
const nrm = a => { const L = len(a); return [a[0] / L, a[1] / L, a[2] / L]; };
// uMoonBasis（行优先 9 个数，列＝x_b y_b z_b）的转置乘 n：nb＝(x_b·n, y_b·n, z_b·n)
function toBody(B, n) { return [B[0] * n[0] + B[3] * n[1] + B[6] * n[2], B[1] * n[0] + B[4] * n[1] + B[7] * n[2], B[2] * n[0] + B[5] * n[1] + B[8] * n[2]]; }
function towerVis(X, S, rho, a) {
  const px = X[0], py = X[2], rp2 = px * px + py * py, a2 = a * a;
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
  return 0.5 + (u * Math.sqrt(1 - u * u) + Math.asin(u)) / PI;
}
// 相位遮蔽 S(α)（moon.glsl 的 moonPhaseS）
function phaseS(ca) {
  const al = Math.acos(Math.min(1, Math.max(-0.98, ca)));
  if (al < 0.02) return 1;
  const phiL = (Math.sin(al) + (PI - al) * Math.cos(al)) / PI, phiLS = 1 - Math.sin(al / 2) * Math.tan(al / 2) * Math.log(1 / Math.tan(al / 4));
  return Math.min(1, phiL / Math.max(phiLS, 1e-4));
}
const sstepJ = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
// U：{uMoonW, uMoonRho, uMoonAlb, uMoonBasis, uSunW, uSunRho, uSunI(取绿通道)}；Q 月面点，d 视线方向（相机→Q）；返回 klux/sr。
// 只对全零纹理（噪声未生成）做镜像：起伏处处相同（moonRelief＝0.5−0.25·0.68），法线不扰动，自遮挡把交界线平移一点
function shadeMoon(U, Q, d, tex, a, stat) {
  const n = nrm(sub(Q, U.uMoonW)), nb = toBody(U.uMoonBasis, n);
  const Am = U.uMoonAlb * C.mareMod(nb, tex);
  const v = sub(U.uSunW, Q), d2 = dot(v, v), l = v.map(x => x / Math.sqrt(d2));
  const vis = a > 0 ? towerVis(Q, U.uSunW, U.uSunRho, a) : 1;            // a＝0：不计塔（合成几何）
  if (stat && vis < stat.minVis) stat.minVis = vis;
  const h0 = 0.5 - 0.25 * 0.68, sh = sstepJ(-0.02, 0.02, dot(n, l) + 0.06 * (h0 - 0.5));
  const mu0 = Math.max(dot(n, l), 0), mu = Math.max(-dot(n, d), 0);
  const brdf = C.MOON_WL * mu0 + C.MOON_WLS * 2 * mu0 / (mu0 + mu + 1e-4) * phaseS(-dot(l, d));
  return Am / PI * (U.uSunI / d2 * vis * brdf * sh);
}
// 从 O 看月：对月面积分，得到正对月心的面上的照度（klux）。N 个斐波那契点
function moonFlux(U, O, tex, a, N, stat) {
  const M = U.uMoonW, rho = U.uMoonRho, dA = 4 * PI * rho * rho / N, ga = PI * (3 - Math.sqrt(5));
  const mhat = nrm(sub(M, O));
  let E = 0;
  for (let i = 0; i < N; i++) {
    const z = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * ga, n = [r * Math.cos(ph), z, r * Math.sin(ph)];
    const Q = [M[0] + rho * n[0], M[1] + rho * n[1], M[2] + rho * n[2]];
    const w = sub(O, Q), D = len(w), cq = dot(n, w) / D;
    if (cq <= 0) continue;
    const d = [-w[0] / D, -w[1] / D, -w[2] / D];
    E += shadeMoon(U, Q, d, tex, a, stat) * cq * dA / (D * D) * Math.max(0, dot(d, mhat));   // 照度面正对月心
  }
  return E;
}
const lambert = al => (Math.sin(al) + (PI - al) * Math.cos(al)) / PI;

/* 一张可复现的合成三维纹理（32³，周期），R＝月海、G＝环形山，都在 0–255 里有起伏 */
function synthTex(n) {
  const data = new Uint8Array(n * n * n * 4), TAU = 2 * PI;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, w = z / n, i = ((z * n + y) * n + x) * 4;
    const m = 0.5 + 0.22 * Math.sin(TAU * (u + 2 * v)) + 0.15 * Math.cos(TAU * (3 * w - u)) + 0.08 * Math.sin(TAU * (5 * u + 3 * w));
    const c = 0.6 + 0.25 * Math.sin(TAU * (4 * u - 3 * v + w)) + 0.15 * Math.cos(TAU * (7 * v + 2 * w));
    data[i] = Math.round(255 * Math.min(1, Math.max(0, m)));
    data[i + 1] = Math.round(255 * Math.min(1, Math.max(0, c)));
    data[i + 2] = 128; data[i + 3] = 255;
  }
  return { data, size: n };
}

/* ───────── 2. 几何反照率 ───────── */
// 满相：沿 −z_b（从内壁看过去那一面）平行光照、平行看；盘面网格积分 p＝(1/π)∫A(n)·brdf(μ,μ)·dx dy
function geomAlbedo(Alb, tex, G) {
  let s = 0; const h = 2 / G;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = -1 + (i + 0.5) * h, y = -1 + (j + 0.5) * h, r2 = x * x + y * y;
    if (r2 >= 1) continue;
    const mu = Math.sqrt(1 - r2), nb = [x, y, -mu];
    const brdf = C.MOON_WL * mu + C.MOON_WLS * 2 * mu / (2 * mu + 1e-4);
    s += Alb * C.mareMod(nb, tex) * brdf * h * h;
  }
  return s / PI;
}
section('2 盘面积分几何反照率＝pMoon±2%');
{
  const st = HY.state || {};
  for (const pm of [0.6, 0.12, 0.3]) {
    const Pp = A.params({ pMoon: pm });
    C.mareT = -0.11; C.mareMean = C.mareMod([0, 0, -1], null);   // 回到“噪声未生成”的初值
    const alb0 = C.compute(Pp, 1.3, 0, st.fp, [5500, -3000, 0]).uMoonAlb;       // compute 的返回对象每帧复用，先取出数
    const p0 = geomAlbedo(alb0, null, 400);
    ok(Math.abs(p0 / pm - 1) < 0.02, `pMoon＝${pm}，全零纹理：uMoonAlb＝${alb0.toFixed(4)}，积分得 ${p0.toFixed(4)}（${((p0 / pm - 1) * 100).toFixed(2)}%）`);
    const tex = synthTex(32), mm = C.calibrateMare(tex, 6000);
    const alb1 = C.compute(Pp, 1.3, 0, st.fp, [5500, -3000, 0]).uMoonAlb;
    const p1 = geomAlbedo(alb1, tex, 400);
    ok(Math.abs(p1 / pm - 1) < 0.02, `pMoon＝${pm}，合成纹理（⟨月海调制⟩＝${mm.toFixed(4)}）：uMoonAlb＝${alb1.toFixed(4)}，积分得 ${p1.toFixed(4)}（${((p1 / pm - 1) * 100).toFixed(2)}%）`);
    ok(Math.abs(alb1 * mm - pm / C.BRDF_P) < 1e-12 && Math.abs(alb0 * C.mareMod([0, 0, -1], null, -0.11) - pm / C.BRDF_P) < 1e-12, '校准前后 uMoonAlb×⟨调制⟩都＝pMoon／' + C.BRDF_P.toFixed(4));
  }
  C.mareT = -0.11; C.mareMean = C.mareMod([0, 0, -1], null);
}

/* ───────── 3. 相位曲线（合成几何：α 从 0 扫到 99°） ───────── */
section('3 相位：积分月光 ／ 朗伯式（HY.astro.moonLux 的口径）');
{
  const Ppm = A.params();
  const U = { uMoonW: [0, 0, 0], uMoonRho: Ppm.rhoM, uMoonAlb: Ppm.pMoon / C.BRDF_P / C.mareMean, uMoonBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1], uSunW: null, uSunRho: Ppm.rhoS, uSunI: 1e9 };
  const Dsun = 4000, Dobs = 3000, rows = [];
  let worst = 0, worstDeg = 0;
  for (let deg = 0; deg < 100; deg += 1) {
    const al = deg * PI / 180;
    U.uSunW = [Dsun, 0, 0];
    const O = [Dobs * Math.cos(al), Dobs * Math.sin(al), 0];
    const E = moonFlux(U, O, null, 0, 40000);
    const Esun = U.uSunI / (Dsun * Dsun), ref = Esun * Ppm.pMoon * (Ppm.rhoM / Dobs) ** 2 * lambert(al);
    const r = E / ref - 1;
    if (Math.abs(r) > worst) { worst = Math.abs(r); worstDeg = deg; }
    if (deg % 10 === 0 || deg === 95 || deg === 97 || deg === 99) rows.push(`${deg}°:${(r * 100).toFixed(1)}%`);
  }
  console.log('    逐度（积分／朗伯−1）：' + rows.join('  '));
  ok(worst < 0.15, `日离月 ${Dsun} km、人离月 ${Dobs} km，α＝0–99°：最大相差 ${(worst * 100).toFixed(1)}%（在 ${worstDeg}°）`);
}

/* ───────── 4. 真实几何：HY.fp.cel ↔ HY.astro.moonLux ───────── */
section('4 真实几何：积分月光与 HY.astro.moonLux；uMoonE0 的来源与 moonLux 一致');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const bins = {}; let n = 0, tries = 0, worst = 0, worstDeg = 0, e0max = 0;
  const sites = ['罪域', '伊美忒', '圣禁城', '涅赫莱恩'];
  while (n < 160 && tries < 20000) {
    tries++;
    const t = rnd() * 4 * P.Y, O = rnd() < 0.7 ? A.siteByName(sites[n % 4], P) : A.site(700 + rnd() * 18600 / 3.2, rnd() * 360 - 180, P);
    const S = A.sunPos(t, P), Mo = A.moonPos(t, P), lk = A.look(O, Mo, P);
    if (lk.vis < 1) continue;                                    // 人看月被塔挡：moonLux 乘了露出比例，这里只比完整月盘
    if (A.moonSunlit(t, P) < 1) continue;
    const al = A.phaseAngle(O, S, Mo);
    if (al >= 100 * PI / 180) continue;
    // uMoonE0 的来源：moonE0lux ＝ moonLux ／ lk.vis（此处 vis＝1）
    const X = [O.x, O.y, O.z], e0 = C.moonE0lux(P, t, X), ml = A.moonLux(O, t, P);
    e0max = Math.max(e0max, Math.abs(e0 / ml - 1));
    // 月面积分（世界坐标，不转 CM：结果与旋转无关）；月面每一点自己判塔影
    const U = {
      uMoonW: [Mo.x, Mo.y, Mo.z], uMoonRho: P.rhoM, uMoonAlb: P.pMoon / C.BRDF_P / C.mareMean,
      uMoonBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1], uSunW: [S.x, S.y, S.z], uSunRho: P.rhoS, uSunI: P.Eref * P.Dref * P.Dref / 1000
    };
    const stat = { minVis: 1 };
    const E = moonFlux(U, X, null, P.a, 12000, stat) * 1000;
    if (stat.minVis < 1) continue;                               // 月面有一部分在塔的半影里
    const r = E / ml - 1, deg = al * 180 / PI;
    if (Math.abs(r) > worst) { worst = Math.abs(r); worstDeg = deg; }
    const b = Math.floor(deg / 20) * 20; bins[b] = (bins[b] || 0) + 1;
    n++;
  }
  console.log('    相位角分布（每 20°）：' + JSON.stringify(bins));
  ok(n >= 100, `抽到 ${n} 个月面全亮、看得见的时刻（试了 ${tries} 次）`);
  ok(e0max < 1e-12, `HY.fp.cel.moonE0lux 与 HY.astro.moonLux（露出＝1）逐位一致（最大相对差 ${e0max.toExponential(1)}）`);
  ok(worst < 0.15, `α＜100°：积分月光与 moonLux 最大相差 ${(worst * 100).toFixed(1)}%（在 ${worstDeg.toFixed(1)}°）`);
}

T.done();
