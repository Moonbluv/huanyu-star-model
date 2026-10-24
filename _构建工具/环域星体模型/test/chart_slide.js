#!/usr/bin/env node
/* test/chart_slide.js —— 走动时地面纹理不滑、不跳（规格：spec/02 第三节第 4 条、第十八节；评审 2 第 1 条；负责：G 路）
 *
 * 两种地面模式、四处地点，相机各向北、向东走 1 km（cam.nudge 每步 10 m：不查碰撞，免得被崖挡住），沿途每一步都量
 * 周围 3 km 内 40 个固定地物（地固坐标）：
 *   人看到地物的方向＝它相对真实相机（眼）的位移 v＝X−C；GPU 在这个方向上取的纹理坐标是 uOrg＋chartD(v)。
 *   1. 图表坐标 c＝cam.chart()＋chartD(v)（chartD 逐行移植 common.glsl、按 float32 逐步舍入，v 与 uniform 也先舍入）
 *      全程与出发时之差＜1 mm——既不随行走滑动（评审 2 第 1 条），也不随 float32 的格子跳（锚用真实相机）；
 *   2. 各层纹理坐标 uv_k＝Rot_k·dc/(L_k·32)＋uOrg[k]：原点用双精度时全程之差折合＜1 mm；
 *      用 compute() 交给 GPU 的 float32 uOrg 时，差只来自 uOrg 的舍入（≤3 ulp），逐层打印折合的米数；
 *   3. compute() 的 uOrg 就是 fround(K.origins(cam.chart()))；uRref 本身是 float32 可精确表示的数。
 * 对照（只打印）：锚若用 fround 后的 uCamW（02 第五节的原写法），同一地物会随人走跳多远。
 * 另验 chartD 的 GLSL 源码没漂移（改了着色器要同步改这里的移植）。
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('chart_slide');
const { section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const A = HY.astro, K = HY.fp.cam, Cel = HY.fp.cel, P = A.params();
const fr = Math.fround, id = x => x;
const LAY_L = (HY.fp.ground && HY.fp.ground.LAY_L) || [60.0, 6.0, 1.1, 0.2, 0.035, 0.006, 15.0];

/* ───────── GLSL 源码对照 ─────────
 * 斜坡分支：图表北向 c_N＝−R·ψ（02 第三节第 4 条；chartGrad 的 gN、terrain_lib 的 groundPoint 都按这个），
 * 所以 Δc_N＝−R·(ψ_X−ψ_C)＝−R·atan(ρ_C·Δy − y_C·Δρ, ρ_C(ρ_C＋Δρ)＋y_C(y_C＋Δy))。
 * 02 第三节第 4 条写的是 −R·atan(y_C·Δρ − ρ_C·Δy, …)，分子反号，差出 2·Δψ：相机向北走 1 km，斜坡上的地面纹理滑 2 km。
 * 本测试的 JS 移植用改正后的式子；着色器还是旧式子时第 0 节报错，指明要改的那一行（E 路的 common.glsl）。
 */
const GLSL_CHART_HEAD = `float dRxz(vec3 v){ vec2 p = uCamW.xz, w = v.xz; float num = 2.0*dot(p, w) + dot(w, w); return num/(uCamRho + sqrt(max(uCamRho*uCamRho + num, 0.0))); }
vec2 chartD(vec3 v){
  float dLam = atan(v.z, uCamRho + v.x);
  float dn;
  if (uGroundMode == 1) dn = -v.y;
  else { float dr = dRxz(v), yC = uCamW.y;`;
const GLSL_CHART_TAIL = `
  return vec2(-uRref*dLam, dn);
}`;
const DN_FIXED = `dn = -uR*atan(uCamRho*v.y - yC*dr, uCamRho*(uCamRho + dr) + yC*(yC + v.y)); }`;
const DN_SPEC = `dn = -uR*atan(yC*dr - uCamRho*v.y, uCamRho*(uCamRho + dr) + yC*(yC + v.y)); }`;
function fnSrc(src, sig) {
  const i = src.indexOf(sig); if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return null;
}
const squash = s => (s || '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
let glslSign = 'fixed';
section('0 common.glsl 的 dRxz、chartD 与本文件的移植对得上');
{
  const src = HY.glsl.common || '', cur = squash(fnSrc(src, 'float dRxz(') + fnSrc(src, 'vec2 chartD('));
  if (cur === squash(GLSL_CHART_HEAD + DN_FIXED + GLSL_CHART_TAIL)) ok(true, 'dRxz、chartD 源码一致（斜坡分支已是改正后的符号）');
  else if (cur === squash(GLSL_CHART_HEAD + DN_SPEC + GLSL_CHART_TAIL)) {
    glslSign = 'spec';
    const line = src.split('\n').findIndex(l => l.indexOf('dn = -uR*atan(yC*dr - uCamRho*v.y') >= 0) + 1;
    ok(false, `common.glsl 第 ${line} 行 chartD 斜坡分支符号反了（照抄了 02 第三节第 4 条），应改为：${DN_FIXED.replace(' }', '')}（E 路）`);
  } else ok(false, 'common.glsl 的 dRxz／chartD 改过了：请同步更新本测试的 JS 移植');
}

/* ───────── JS 移植（f＝Math.fround 时逐步按 float32 舍入） ───────── */
function chartD(v, U, mode, f, sign) {
  sign = sign == null ? 1 : sign;          // −1＝02 原式（用来量出旧式子的滑动）
  const rho = U.uCamRho, R = P.R;
  const dLam = f(Math.atan2(v[2], f(rho + v[0])));
  let dn;
  if (mode === 1) dn = -v[1];
  else {
    const px = U.uCamW[0], pz = U.uCamW[2], wx = v[0], wz = v[2];
    const num = f(f(2 * f(f(px * wx) + f(pz * wz))) + f(f(wx * wx) + f(wz * wz)));
    const dr = f(num / f(rho + f(Math.sqrt(Math.max(f(f(rho * rho) + num), 0)))));
    const yC = U.uCamW[1], numr = f(f(rho * v[1]) - f(yC * dr));     // 改正后的分子（见文件头）
    dn = f(-R * f(Math.atan2(sign * numr, f(f(rho * f(rho + dr)) + f(yC * f(yC + v[1]))))));
  }
  return [f(-U.uRref * dLam), dn];
}
function layerUV(k, dc, org) {
  const an = 1.31 * k, cs = Math.cos(an), sn = Math.sin(an), s = 1 / (LAY_L[k] * 32);
  return [(cs * dc[0] - sn * dc[1]) * s + org[0], (sn * dc[0] + cs * dc[1]) * s + org[1]];
}
const wrapD = d => d - Math.round(d);                 // 纹理坐标差按周期 1 取最近
function snap(U) {                                    // compute() 的返回对象每帧复用：拷一份
  return { uCamW: U.uCamW.slice(), uCamRho: U.uCamRho, uRref: U.uRref, uOrg: U.uOrg.map(o => o.slice()), uLamCam: U.uLamCam };
}

let seed = 99;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const DEF_GROUND = { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 };
const ZONES = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };
const SITES = [['罪域', 6670, -4], ['圣禁城', 3600, 0], ['涅赫莱恩', 5600, 25], ['塔顶半球', 0.72 * Math.PI * P.R, 180]];

// 某一时刻相机下，固定地物 Xw（地固）在人眼里那个方向上的图表坐标与各层纹理坐标
function measure(cam, U, Xw, sign) {
  const mode = cam.mode(), lam = cam.lam(), inf = cam.info();
  const Xc = Cel.toCM(Xw, lam), v = [fr(Xc[0] - inf.rho), fr(Xc[1] - inf.y), fr(Xc[2])];   // 相对真实相机（眼）
  const dc32 = chartD(v, U, mode, fr, sign), dc64 = chartD(v, U, mode, id, sign), c0 = cam.chart();
  const orgD = K.origins(c0), uvD = [], uvF = [];
  for (let k = 0; k < 7; k++) { uvD.push(layerUV(k, dc64, orgD[k])); uvF.push(layerUV(k, dc32, U.uOrg[k])); }
  // 对照：锚用 fround 后的相机
  const cf = [-U.uRref * lam, mode === 1 ? -U.uCamW[1] : -P.R * Math.atan2(U.uCamW[0], -U.uCamW[1])];
  return { c: [c0[0] + dc32[0], c0[1] + dc32[1]], cf: [cf[0] + dc32[0], cf[1] + dc32[1]], uvD, uvF };
}

for (const modeName of ['terrace', 'slope']) {
  section(`${modeName === 'terrace' ? '阶地' : '斜坡'}模式`);
  let worstC = 0, worstUVD = 0, worstOrg = 0, rrefOk = true, specSlide = 0, froundJump = 0;
  const worstUVF = [0, 0, 0, 0, 0, 0, 0];
  for (const [name, s, az] of SITES) {
    for (const dir of ['北', '东']) {
      const fps = { eye: 1.6, yaw: 0, pitch: 15, fov: 55, bob: false, ground: Object.assign({}, DEF_GROUND, { mode: modeName }) };
      const cam = K.create(P, { s, az }, fps, { zones: ZONES });
      const U0 = snap(cam.compute());
      if (fr(U0.uRref) !== U0.uRref) rrefOk = false;
      // 周围 3 km 内 40 个固定地物（地固坐标；不必在地面上，图表对任何点都有定义）
      const O = cam.observer(), feats = [];
      for (let i = 0; i < 40; i++) {
        const e = (rnd() - 0.5) * 6, n = (rnd() - 0.5) * 6, u = (rnd() - 0.5) * 0.6;
        feats.push([O.x + e * O.E[0] + n * O.N[0] + u * O.U[0], O.y + e * O.E[1] + n * O.N[1] + u * O.U[1], O.z + e * O.E[2] + n * O.N[2] + u * O.U[2]]);
      }
      const before = feats.map(X => measure(cam, U0, X));
      const i0 = cam.info();
      let U1 = U0;
      for (let st = 0; st < 100; st++) {
        cam.nudge(dir === '北' ? 0.01 : 0, dir === '东' ? 0.01 : 0);
        U1 = snap(cam.compute());
        // compute() 的 uOrg＝fround(K.origins(cam.chart()))
        const org = K.origins(cam.chart());
        for (let k = 0; k < 7; k++) worstOrg = Math.max(worstOrg, Math.abs(fr(org[k][0]) - U1.uOrg[k][0]), Math.abs(fr(org[k][1]) - U1.uOrg[k][1]));
        feats.forEach((X, i) => {
          const b = before[i], a = measure(cam, U1, X);
          worstC = Math.max(worstC, Math.abs(a.c[0] - b.c[0]), Math.abs(a.c[1] - b.c[1]));
          froundJump = Math.max(froundJump, Math.abs(a.cf[0] - b.cf[0]), Math.abs(a.cf[1] - b.cf[1]));
          for (let k = 0; k < 7; k++) {
            const sc = LAY_L[k] * 32;
            worstUVD = Math.max(worstUVD, Math.abs(wrapD(a.uvD[k][0] - b.uvD[k][0])) * sc, Math.abs(wrapD(a.uvD[k][1] - b.uvD[k][1])) * sc);
            worstUVF[k] = Math.max(worstUVF[k], Math.abs(wrapD(a.uvF[k][0] - b.uvF[k][0])), Math.abs(wrapD(a.uvF[k][1] - b.uvF[k][1])));
          }
        });
      }
      const i1 = cam.info();
      // 阶地向北＝水平走（y 减小）；斜坡向北＝沿地面走（s 减小）；向东＝沿纬圈（按 R_ref 折算）
      const moved = dir === '北' ? (modeName === 'terrace' ? i0.y - i1.y : i0.s - i1.s) : (i0.phi - i1.phi) * U0.uRref;
      ok(Math.abs(moved - 1) < 0.002, `${name}·向${dir}走了 ${moved.toFixed(4)} km（逐 10 m 量 100 次）`);
      ok(U1.uRref === U0.uRref, `${name}·向${dir}：行走中 R_ref 不变`);
      if (modeName === 'slope' && dir === '北') {           // 02 原式会滑多少（只打印）
        const X = feats[0], b = measure(cam, U1, X, -1);
        const cam2 = K.create(P, { s, az }, fps, { zones: ZONES }), U2 = snap(cam2.compute()), a = measure(cam2, U2, X, -1);
        specSlide = Math.max(specSlide, Math.abs(a.c[1] - b.c[1]));
      }
    }
  }
  if (modeName === 'slope') console.log(`    （对照：用 02 原式的 chartD，走 1 km 后同一地物的图表北向坐标差 ${specSlide.toFixed(3)} km${glslSign === 'spec' ? '——着色器现在就是这样' : ''}）`);
  console.log(`    （对照：锚若用 fround 后的 uCamW，同一地物在人眼里最多跳 ${(froundJump * 1e5).toFixed(1)} cm——人每走过 float32 的一格就跳一下）`);
  ok(rrefOk, 'uRref 是 float32 可精确表示的数（CPU 原点与 GPU 差分用同一个 R_ref）');
  ok(worstOrg <= 0, `compute() 的 uOrg＝fround(K.origins(cam.chart()))（最大差 ${worstOrg}）`);
  ok(worstC < 1e-6, `固定地物的图表坐标（chartD 按 float32）全程最大差 ${(worstC * 1e6).toFixed(3)} mm（＜1 mm）`);
  ok(worstUVD < 1e-6, `各层纹理坐标（双精度原点）全程最大差折合 ${(worstUVD * 1e6).toFixed(4)} mm（＜1 mm）`);
  // float32 原点：差只能来自 uOrg 的舍入（[0,1) 里 1 ulp ≤ 2^-24）加上 chartD 的 float32 误差
  const ulp = Math.pow(2, -24), lines = worstUVF.map((d, k) => `${k}:${(d * LAY_L[k] * 32 * 1000).toFixed(3)} m`);
  ok(worstUVF.every((d, k) => d <= 3 * ulp + 1e-6 / (LAY_L[k] * 32)), `float32 原点：各层纹理坐标的差 ≤ 3 ulp＋1 mm（逐层折合：${lines.join('，')}）`);
}

T.done();
