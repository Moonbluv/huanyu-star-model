#!/usr/bin/env node
/* test/fp_cel_check.js —— 第一人称天体 uniform（HY.fp.cel）自检（负责：G 路）
 * 规格：spec/02 第二、三、五节，第七节第 5、7–8 条，第十一节；统筹修订（静滞夜幕默认关、5772 K、反照率 0.6）。
 *   1 地固 ↔ CM：toCM／toW 互逆、cm2w 与 toW 一致、相机经度处 x′＝ρ、z′＝0
 *   2 日月：uSunW／uMoonW＝HY.astro 的日心月心转到 CM 后 fround；半径、光度定标、日色
 *   3 月体系：正交、右手、一面朝塔轴（z_b 指向塔轴、y_b＝塔轴方向）
 *   4 月光 uMoonE0＝HY.astro.moonLux 去掉“人看月被塔挡”的那一项；uMoonD2；uMoonAir 的开关
 *   5 静滞夜幕：默认关（uSunI、uMoonE0 不变）；开了以后昼光补偿只扣相机附近日光在夜幕里的路程（透射 ≤1、随强度单调），月光按“日→月”在夜幕里的路程变暗
 *   6 罪域方向与半径；改星体参数后跟着变；camLam 省略时取当前相机
 *   7 定标：astro.calib／pMoon 改了（在 HY.model.P 里）uSunI、uMoonAlb 跟着变
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('fp_cel_check');
const { near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
console.warn = () => {};
const A = HY.astro, C = HY.fp.cel, K = HY.fp.cam;
HY.model.rebuildP();
const P = HY.model.P, fr = Math.fround;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const FPS = (extra) => Object.assign({ quality: 'mid', atmo: { HR: 40, HM: 6 }, set: { veil: false, veilK: 0.3, dayComp: 1 } }, extra || {});
const copy = o => JSON.parse(JSON.stringify(o));   // compute() 的返回对象每帧复用

section('1 地固 ↔ CM');
{
  let worst = 0, worstM = 0;
  for (let i = 0; i < 500; i++) {
    const lam = (Math.random() - 0.5) * 20, p = [Math.random() * 1e4 - 5e3, Math.random() * 1e4 - 5e3, Math.random() * 1e4 - 5e3];
    const q = C.toCM(p, lam), b = C.toW(q, lam), M = C.cm2w(lam);
    worst = Math.max(worst, Math.abs(b[0] - p[0]), Math.abs(b[1] - p[1]), Math.abs(b[2] - p[2]));
    const mq = [M[0] * q[0] + M[1] * q[1] + M[2] * q[2], M[3] * q[0] + M[4] * q[1] + M[5] * q[2], M[6] * q[0] + M[7] * q[1] + M[8] * q[2]];
    worstM = Math.max(worstM, Math.abs(mq[0] - p[0]), Math.abs(mq[1] - p[1]), Math.abs(mq[2] - p[2]));
  }
  ok(worst < 1e-9 && worstM < 1e-9, `toCM／toW 互逆、cm2w（行优先）＝toW（最大误差 ${Math.max(worst, worstM).toExponential(1)} km）`);
  const O = A.site(6670, -4, P), q = C.toCM(O, O.phi);
  ok(Math.abs(q[0] - O.r) < 1e-9 && Math.abs(q[2]) < 1e-9 && q[1] === O.y, '相机经度处：x′＝离轴距离、z′＝0、y 不变');
  ok(Math.abs(C.toCM({ x: 1, y: 2, z: 3 }, 0.3)[0] - C.toCM([1, 2, 3], 0.3)[0]) === 0, '接受 {x,y,z} 与 [x,y,z] 两种写法');
}

section('2 日月位置、半径、光度');
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const t = Math.random() * 1440 - 720, lam = (Math.random() - 0.5) * 7;
    const U = C.compute(P, t, lam, FPS(), [5500, -3100, 100]);
    const S = A.sunPos(t, P), M = A.moonPos(t, P), s = C.toCM(S, lam), m = C.toCM(M, lam);
    worst = Math.max(worst, ...[0, 1, 2].map(k => Math.abs(U.uSunW[k] - fr(s[k]))), ...[0, 1, 2].map(k => Math.abs(U.uMoonW[k] - fr(m[k]))));
  }
  ok(worst === 0, 'uSunW／uMoonW＝fround(toCM(HY.astro 日心、月心))，逐位一致');
  const U = C.compute(P, 0.3, 0, FPS(), [5500, -3100, 0]);
  ok(U.uSunRho === P.rhoS && U.uMoonRho === P.rhoM, `半径取 P：日 ${U.uSunRho} km、月 ${U.uMoonRho} km`);
  const I = P.Eref * P.Dref * P.Dref / 1000;
  ok([0, 1, 2].every(k => Math.abs(U.uSunI[k] / (I * C.SUN_RGB[k]) - 1) < 1e-12), `uSunI＝Eref·Dref²·日色/1000（绿 ${U.uSunI[1].toExponential(3)} klux·km²）`);
  ok(Math.abs(0.2126 * C.SUN_RGB[0] + 0.7152 * C.SUN_RGB[1] + 0.0722 * C.SUN_RGB[2] - 1) < 0.005, '日色亮度归一（5772 K 黑体在线性 sRGB 里）');
  // 照度按 1/d²：地面上某点的日照 ＝ uSunI/d²（绿）÷日色 ≈ HY.astro.sunTOA 的法向照度
  const O = A.site(6670, -4, P), t = 0.5, Uu = C.compute(P, t, O.phi, FPS(), [O.x, O.y, O.z]);
  const Oc = C.toCM(O, O.phi), d2 = (Uu.uSunW[0] - Oc[0]) ** 2 + (Uu.uSunW[1] - Oc[1]) ** 2 + (Uu.uSunW[2] - Oc[2]) ** 2;
  const lux = Uu.uSunI[1] / C.SUN_RGB[1] / d2 * 1000, ref = A.sunTOA(O, t, P).normal;
  ok(Math.abs(lux / ref - 1) < 1e-5, `罪域正午法向日照 ${(lux / 1000).toFixed(2)} klux ＝ HY.astro.sunTOA ${(ref / 1000).toFixed(2)} klux`);
}

section('3 月体系');
{
  let worst = 0, inward = true;
  for (let i = 0; i < 300; i++) {
    const t = Math.random() * 1440, lam = (Math.random() - 0.5) * 7, U = C.compute(P, t, lam, FPS(), [5500, -3100, 0]);
    const B = U.uMoonBasis, x = [B[0], B[3], B[6]], y = [B[1], B[4], B[7]], z = [B[2], B[5], B[8]];   // 列
    const cr = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    worst = Math.max(worst, Math.abs(dot(x, x) - 1), Math.abs(dot(y, y) - 1), Math.abs(dot(z, z) - 1), Math.abs(dot(x, y)), Math.abs(dot(y, z)), Math.abs(dot(x, z)),
      ...[0, 1, 2].map(k => Math.abs(cr[k] - x[k])));
    const M = U.uMoonW, h = [-M[0], 0, -M[2]];
    if (!(dot(z, h) > 0.999 * Math.hypot(...h)) || y[1] !== 1) inward = false;
  }
  ok(worst < 1e-12, `uMoonBasis 的列 x_b、y_b、z_b 正交归一且 x_b＝y_b×z_b（最大误差 ${worst.toExponential(1)}）`);
  ok(inward, 'z_b 水平指向塔轴（一面朝塔轴）、y_b＝塔轴方向');
}

section('4 月光');
{
  // 找几个月面全亮、人看得见的时刻
  const O = A.site(6670, -4, P), X = [O.x, O.y, O.z];
  let n = 0, worst = 0, blocked = 0;
  for (let t = 0; t < 360; t += 0.137) {
    const lk = A.look(O, A.moonPos(t, P), P);
    const U = C.compute(P, t, O.phi, FPS(), X), ml = A.moonLux(O, t, P);
    const e0 = U.uMoonE0[1] / C.SUN_RGB[1] * 1000;
    if (lk.vis > 0.999) { if (n < 400) { worst = Math.max(worst, ml > 0 ? Math.abs(e0 / ml - 1) : Math.abs(e0)); n++; } }
    else if (lk.vis < 0.001 && e0 > 0) blocked++;
  }
  ok(n >= 30 && worst < 1e-9, `月不被塔挡时 uMoonE0（绿/日色）＝HY.astro.moonLux（${n} 个时刻，最大相对差 ${worst.toExponential(1)}）`);
  ok(blocked > 0, `人看月被塔挡时 uMoonE0 仍不为零（“未乘塔挡”，GPU 逐点乘 towerVis）：${blocked} 个时刻`);
  const U = C.compute(P, 7.7, O.phi, FPS(), X), M = A.moonPos(7.7, P);
  near(U.uMoonD2, (M.x - X[0]) ** 2 + (M.y - X[1]) ** 2 + (M.z - X[2]) ** 2, 1e-6, 'uMoonD2＝相机到月心距离²');
  ok(C.compute(P, 7.7, 0, FPS(), X).uMoonAir === 0, '中档、暗幕关：uMoonAir＝0');
  ok(C.compute(P, 7.7, 0, FPS({ quality: 'high' }), X).uMoonAir === 1 && C.compute(P, 7.7, 0, FPS({ quality: 'photo' }), X).uMoonAir === 1, '高档、拍照：uMoonAir＝1');
  ok(C.compute(P, 7.7, 0, FPS({ set: { veil: true, veilK: 0.3, dayComp: 1 } }), X).uMoonAir === 1, '开暗幕：uMoonAir＝1');
  // 黑月：庆典交节（t＝0）月在塔影正中，月光为 0
  ok(C.compute(P, 0, 0, FPS(), X).uMoonE0[1] === 0, '庆典交节（黑月正中）：uMoonE0＝0');
}

section('5 静滞夜幕（设定，默认关；sky 修订：夜幕从离壁 0.4·Ztop 起，昼光补偿只扣相机附近的日光路程、不扣过头）');
{
  const O = A.site(6670, -4, P), X = [O.x, O.y, O.z], t = 0.5;
  const off = copy(C.compute(P, t, O.phi, FPS(), X));
  const offK = copy(C.compute(P, t, O.phi, FPS({ set: { veil: false, veilK: 0.9, dayComp: 1 } }), X));
  ok(JSON.stringify(off.uSunI) === JSON.stringify(offK.uSunI) && JSON.stringify(off.uMoonE0) === JSON.stringify(offK.uMoonE0) && off.uVeilComp === 0 && offK.uVeilComp === 0, '暗幕关时 veilK 不起作用（白夜如实画），uVeilComp＝0');
  ok(C.veilK({ set: { veil: false, veilK: 0.5 } }) === 0 && C.veilK({ set: { veil: true, veilK: 0.5 } }) === 0.0005, 'veilK：开关为真才生效，/千公里 → /公里');
  const FA = { atmo: { HR: 40, HM: 6 } };
  ok(C.veilR(P, FA) === P.R - 160, `夜幕球半径＝R − 0.4·Ztop（默认离壁 160 km 以上；GLSL 的 VEIL_ZF 同值）`);
  const VEIL = (k, dc) => FPS({ set: { veil: true, veilK: k, dayComp: dc } });
  const Rv = C.veilR(P, FA), Sw = tt => { const S = A.sunPos(tt, P); return [S.x, S.y, S.z]; };
  const on = copy(C.compute(P, t, O.phi, VEIL(0.6, 1), X));
  ok(JSON.stringify(on.uSunI) === JSON.stringify(off.uSunI), '开夜幕：uSunI 不再整体放大（原先 ×e^{k·平均路程}，夜幕越强夜越亮）');
  const L = C.corePath(X, Sw(t), Rv), Lm = C.corePath(X, Sw(t + 0.5), Rv);
  ok(L > 4000 && L < 6700 && Lm > L + 800, `日光在夜幕里走：正午 ${L.toFixed(0)} km，子夜（塔后）${Lm.toFixed(0)} km`);
  // “平均路径”（02 第七节第 7 条）：此地这一天、日露出塔外的时刻里，日→相机在夜幕里路程的平均。用 HY.astro.sunPos 逐时刻另算一遍对拍
  const Lbar = C.dayPath(X, A.sunPos(t, P).y, P, Rv);
  let sw = 0, sl = 0;
  for (let i = 0; i < 2000; i++) { const tt = t - 0.5 + (i + 0.5) / 2000, v = A.look(O, A.sunPos(tt, P), P).vis; sw += v; sl += v * C.corePath(X, Sw(tt), Rv); }
  near(Lbar / (sl / sw), 1, 0.01, `白天平均路径 ${Lbar.toFixed(0)} km（逐时刻按 HY.astro 另算 ${(sl / sw).toFixed(0)} km）`);
  near(on.uVeilComp, Lbar, 1e-6, '昼光补偿＝1：uVeilComp＝白天平均路径（km）');
  near(copy(C.compute(P, t, O.phi, VEIL(0.6, 0.5), X)).uVeilComp, 0.5 * Lbar, 1e-6, '昼光补偿＝0.5：扣一半路程');
  ok(copy(C.compute(P, t, O.phi, VEIL(0.6, 0), X)).uVeilComp === 0, '昼光补偿＝0：不扣（正午跟着暗下去）');
  // 日光透射：正午此地照旧（扣到 0 为止），远处不补
  const T = (k, dc, Q) => { const f = VEIL(k, dc), c = C.veilComp(P, t, X, f); return C.sunVeilT(P, f, Q, Sw(t), X, c); };
  near(T(0.6, 1, X), 1, 1e-12, '开夜幕 k＝0.6、补偿 1：罪域正午地面日照与不开夜幕相同（正午路程短于白天平均，扣到 0）');
  ok(T(0.6, 0, X) < 0.1, `不补偿：正午日照乘 e^{−k·L}＝${T(0.6, 0, X).toFixed(3)}`);
  const far = [-X[0], X[1], -X[2]];        // 塔另一侧同高度的内壁：离相机上万公里，不补
  near(T(0.6, 1, far), Math.exp(-0.0006 * C.corePath(far, Sw(t), Rv)), 1e-12, '远处（veilLocal＝0）的日照不补偿，照实乘夜幕');
  ok(C.veilLocal(900) === 1 && C.veilLocal(3000) === 0 && C.veilLocal(1750) > 0 && C.veilLocal(1750) < 1, 'veilLocal：1000 km 内全补、2500 km 外不补、中间平滑');
  // 单调与上限：任意点、任意 k，透射 ≤1 且随 k 不升（夜只会越调越黑）
  let worstUp = 0, worstMono = 0;
  for (let i = 0; i < 400; i++) {
    const th = Math.random() * Math.PI, ph = Math.random() * 2 * Math.PI, r = P.R * (0.999 - 0.4 * Math.random());
    const Q = [r * Math.sin(th) * Math.cos(ph), -r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)];
    let prev = 1;
    for (const k of [0.05, 0.1, 0.3, 0.6, 1]) {
      const v = T(k, 1, Q); worstUp = Math.max(worstUp, v - 1); worstMono = Math.max(worstMono, v - prev); prev = v;
    }
  }
  ok(worstUp <= 1e-12 && worstMono <= 1e-12, `日光透射恒 ≤1（最大超出 ${worstUp.toExponential(1)}），随强度单调不升（最大回升 ${worstMono.toExponential(1)}）`);
  // 一天之内补偿不变：夜里不跟着补
  const mid = copy(C.compute(P, t + 0.5, O.phi, VEIL(0.6, 1), X));
  near(mid.uVeilComp / on.uVeilComp, 1, 0.01, '子夜的补偿路程与正午几乎相同（只随季节的日高、地点慢变；半日里差不到 1%）');
  // 月光：日→月那段的夜幕；月离相机远，补偿按 veilLocal 衰减
  let tm = null;
  for (let s = 0.1; s < 30 && tm === null; s += 0.21) if (A.moonLux(O, s, P) > 1 && A.look(O, A.moonPos(s, P), P).vis > 0.99) tm = s;
  const S = A.sunPos(tm, P), M = A.moonPos(tm, P), Mv = [M.x, M.y, M.z], Lsm = C.corePath(Mv, [S.x, S.y, S.z], Rv);
  const m0 = copy(C.compute(P, tm, O.phi, FPS(), X)), m1 = copy(C.compute(P, tm, O.phi, FPS({ set: { veil: true, veilK: 0.6, dayComp: 0 } }), X));
  near(m1.uMoonE0[1] / m0.uMoonE0[1], Math.exp(-0.0006 * Lsm), 1e-9, `开暗幕、不补偿：月光乘 exp(−k·日→月在夜幕里的 ${Lsm.toFixed(0)} km)（与 shadeMoon 的 veilT(Q, uSunW) 同口径）`);
  const m2 = copy(C.compute(P, tm, O.phi, FPS({ set: { veil: true, veilK: 0.6, dayComp: 1 } }), X));
  ok(m2.uMoonE0[1] <= m0.uMoonE0[1] * (1 + 1e-12) && m2.uMoonE0[1] >= m1.uMoonE0[1], '补偿后的月光介于不补偿与不开夜幕之间（不会比不开夜幕亮）');
  ok(C.ztop({ atmo: { HR: 40, HM: 6 } }) === 400 && C.ztop({ atmo: { HR: 90, HM: 6 } }) === 800, '大气顶 Ztop＝min(10·max(H_R, H_M), 800)，与 settings 同式');
  ok(C.corePath([0, 0, 0], [100, 0, 0], 50) === 50 && C.corePath([-100, 0, 0], [100, 0, 0], 50) === 100 && C.corePath([0, 60, 0], [100, 60, 0], 50) === 0, 'corePath：线段在球里的长度');
  // GLSL 与 JS 同值
  const g = HY.glsl.common;
  ok(/#define VEIL_ZF 0\.4\b/.test(g) && /#define VEIL_D0 1000\.0/.test(g) && /#define VEIL_D1 2500\.0/.test(g), 'common.glsl 的 VEIL_ZF／VEIL_D0／VEIL_D1 与 HY.fp.cel 同值');
  ok(/vec3 Esky = [^;]*veilT\(X, uSunW\)/.test(HY.glsl.shade_wall), 'shade_wall 的本地天光乘 veilT（原先漏乘，夜幕越强对岸越亮）');
  ok(/veilRayT\(O, d, tEnd\)/.test(HY.glsl.probe), '探针 beyond()（含行 2：从月心看出去）乘夜幕');
}

section('6 罪域方向、参数变化、camLam 省略');
{
  const U = copy(C.compute(P, 0.3, 0.2, FPS(), [5500, -3100, 0])), d = U.uRuiDir;
  const zs = HY.world.siteById('zuiyu', P), O = A.site(zs.s, zs.az, P), w = C.toCM(O, 0.2), L = Math.hypot(...w);
  ok(Math.abs(Math.hypot(...d) - 1) < 1e-6 && Math.abs(d[0] - w[0] / L) < 1e-6 && Math.abs(d[2] - w[2] / L) < 1e-6, 'uRuiDir＝罪域中心（CM 单位向量）');
  ok(U.uRuiRad === 900, 'uRuiRad＝900 km');
  const P2 = A.params({ R: 7000 }), U2 = copy(C.compute(P2, 0.3, 0.2, FPS(), [5500, -3100, 0]));
  ok(Math.abs(U2.uRuiDir[1] - d[1]) > 1e-3, '改 R 后罪域方向跟着变（缓存按 R、a 失效）');
  const cam = K.create(P, { s: 6670, az: 30 }, { eye: 1.6, yaw: 0, pitch: 0, fov: 55, bob: false, ground: { mode: 'slope', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 } });
  const a = copy(C.compute(P, 0.3, null, FPS())), b = copy(C.compute(P, 0.3, cam.lam(), FPS(), cam.posW()));
  ok(JSON.stringify(a) === JSON.stringify(b), 'camLam、camW 省略时取 HY.fp.cam.current 的经度与位置');
  const keys = Object.keys(U).sort(), names = HY.fp.UNIFORMS.filter(r => r[3] === 'cel').map(r => r[0]).sort();
  ok(JSON.stringify(keys) === JSON.stringify(names), 'compute() 恰好给出全部 cel 写入的 uniform');
  ok(Object.keys(U).every(k => [].concat(U[k]).every(Number.isFinite)), '全部有限');
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) C.compute(P, i * 0.001, 0.1, FPS(), [5500, -3100, 0]);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 5000;
  ok(us < 50, `每帧 compute ${us.toFixed(1)} µs`);
}

section('7 定标与反照率跟着 HY.model.P 走（统筹修订：默认 5772 K、0.6，放“高级”）');
{
  const st = HY.state;
  ok(st.astro.calib === '5772K' && (st.astro.o.pMoon == null), '默认：astro.calib＝5772K，pMoon 不覆盖（＝0.6）');
  const I0 = copy(C.compute(HY.model.P, 0.3, 0, st.fp, [5500, -3100, 0]));
  HY.store.set('astro.calib', '1361', 'api'); HY.model.rebuildP();
  const I1 = copy(C.compute(HY.model.P, 0.3, 0, st.fp, [5500, -3100, 0]));
  ok(Math.abs(I1.uSunI[1] / I0.uSunI[1] - HY.model.P.Eref / P.Eref) < 1e-12 && I1.uSunI[1] !== I0.uSunI[1], `改定标 1361 W/m²：uSunI 跟着 Eref 变（×${(I1.uSunI[1] / I0.uSunI[1]).toFixed(3)}）`);
  HY.store.set('astro.o.pMoon', 0.12, 'api'); HY.model.rebuildP();
  const I2 = copy(C.compute(HY.model.P, 0.3, 0, st.fp, [5500, -3100, 0]));
  near(I2.uMoonAlb / I0.uMoonAlb, 0.12 / 0.6, 1e-12, '改月面反照率 0.12：uMoonAlb 同比变');
  HY.store.reset('astro', 'api'); HY.model.rebuildP();
}

T.done();
