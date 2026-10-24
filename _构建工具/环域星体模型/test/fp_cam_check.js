#!/usr/bin/env node
/* test/fp_cam_check.js —— 第一人称相机（HY.fp.cam）与取数接口（HY.fp.api）的自检（负责：G 路）
 * 规格：spec/02 第三、五节，第八节第 3–4 条，第十四节第 1 条，第十七节第 1、3 条；spec/03 第七节、第十四节第 3 条。
 *   1 瞬移与地点往返；阶地崖高＝W·tan 纬度（02 第八节第 3 条的四地数字）；纬度＜2° 退回斜坡
 *   2 朝向基正交、方向对；上一帧量（静止时为零／转置，移动后＝−位移，含经度旋转）
 *   3 行走：步速、跑、骑马；阶地踏面水平、崖沿停步、崖面不能站、崖脚停步；斜坡模式超过 35° 减速；头部起伏
 *   4 视角：凝视、望远；朝向快捷（塔根、塔顶仰角与 02 第十一节第 3 条的表一致；看太阳、看月亮转得准）
 *   5 uniform：写入方只有 cam、数值有限、uCamK 与 uCamZ 自洽、uOrg 在 [0,1)、uCM2W 是旋转
 *   6 HY.fp.api：look／lookPreset 写状态、取数接口的形状
 *   7 星体参数变了自动跟上、地面参数变了重新贴地
 */
'use strict';
const HY = require('./_load.js')();
const T = require('./_load.js').tester('fp_cam_check');
const { near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
console.warn = () => {};
const A = HY.astro, K = HY.fp.cam, Cel = HY.fp.cel;
HY.model.rebuildP();
const P = HY.model.P, R2D = 180 / Math.PI, D2R = Math.PI / 180;
const ZONES = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };
const G0 = { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 };
// extra.ground 与默认地面合并（例如 {amp: 0}＝起伏倍率 0：平整地面，只剩阶地本身）
function fpsOf(mode, extra) {
  extra = Object.assign({}, extra || {});
  const gr = Object.assign({}, G0, { mode }, extra.ground || {});
  delete extra.ground;
  return Object.assign({ eye: 1.6, yaw: 0, pitch: 0, fov: 55, bob: false, quality: 'mid', ground: gr }, extra);
}
const FLAT = { ground: { amp: 0 } };
const mk = (s, az, mode, extra) => K.create(P, { s, az }, fpsOf(mode || 'terrace', extra), { zones: ZONES });
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finite = v => Array.isArray(v) ? v.every(finite) : isFinite(v);

section('1 瞬移、地点往返、崖高');
{
  for (const [name, s, az, Hc] of [['罪域', 6670, -4, 0.87], ['涅赫莱恩', 5600, 25, 1.24], ['伊美忒', 4000, 2, 2.06], ['圣禁城', 3600, 0, 2.36]]) {
    const cam = mk(s, az), q = cam.toSite(), U = cam.compute();
    // 阶地模式会把人挪到最近的踏面上：最多挪 cliff·W 的一半（沿地面再除以 sinψ）
    ok(Math.abs(q.s - s) < 0.2 && Math.abs(q.az - az) < 1e-9, `${name}：瞬移后 s＝${q.s.toFixed(3)}、az＝${q.az}`);
    ok(Math.abs(U.uHc / Hc - 1) < 0.02, `${name}：崖高 uHc＝${U.uHc.toFixed(3)} km（02：${Hc}）`);
    ok(cam.mode() === 1 && cam.info().f >= G0.cliff, `${name}：阶地、站在踏面上（相位 ${cam.info().f.toFixed(3)} ≥ 崖带 ${G0.cliff}）`);
    near(U.uCamAlt, 0.0016, 1e-12, `${name}：阶地 uCamAlt＝眼高`);
  }
  const eq = mk(Math.PI * P.R / 2 - 100, 0);
  ok(eq.mode() === 0, '纬度＜2°（赤道往北 100 km）自动退回斜坡');
  // 2° 线上的回差：往北过了 2.02° 才换回阶地，往南一过 2° 就退回斜坡；在线附近来回挪不来回跳
  {
    const sOf = lat => (90 - lat) * D2R * P.R, latOf = c => 90 - c.info().psi * R2D;
    const c = mk(sOf(1.99), 0, 'terrace', FLAT);
    let flips = [], m = c.mode();
    for (let i = 0; i < 200 && latOf(c) < 2.06; i++) { c.nudge(0.05, 0); if (c.mode() !== m) { flips.push(latOf(c)); m = c.mode(); } }
    ok(flips.length === 1 && flips[0] >= 2.02 && flips[0] < 2.021, `往北：只换一次，在纬度 ${flips.map(x => x.toFixed(4)).join('、')}° 换回阶地（回差 ${K.LAT_HYST}°）`);
    flips = [];
    for (let i = 0; i < 200 && latOf(c) > 1.97; i++) { c.nudge(-0.05, 0); if (c.mode() !== m) { flips.push(latOf(c)); m = c.mode(); } }
    ok(flips.length === 1 && flips[0] < 2 && flips[0] > 1.999, `往南：只换一次，在纬度 ${flips.map(x => x.toFixed(4)).join('、')}° 退回斜坡`);
    const w = mk(sOf(1.999), 0, 'terrace', FLAT);
    w.nudge(1.1, 0);                                       // 到 2.009°：仍在回差里
    let n = 0, lo = 99, hi = 0; m = w.mode();
    for (let i = 0; i < 40; i++) { w.nudge(i % 2 ? -0.3 : 0.3, 0); lo = Math.min(lo, latOf(w)); hi = Math.max(hi, latOf(w)); if (w.mode() !== m) { n++; m = w.mode(); } }
    ok(m === 0 && n === 0 && hi > 2.0 && lo < 2.02, `在 2° 线上（${lo.toFixed(4)}°–${hi.toFixed(4)}°）来回挪 300 m：一次也不换`);
    ok(K.groundMode(P, sOf(2.01), 'terrace') === 1 && mk(sOf(2.01), 0).mode() === 1, '瞬移不受回差影响：2.01° 直接是阶地');
  }
  ok(K.groundMode(P, 6670, 'slope') === 0 && K.groundMode(P, 6670, 'terrace') === 1, 'K.groundMode：选斜坡＝0；罪域阶地＝1');
  const sl = mk(6670, -4, 'slope'), U = sl.compute();
  near(sl.toSite().s, 6670, 1e-9, '斜坡模式瞬移不挪位置');
  near(U.uCamAlt, 0.0016 * Math.sin(6670 / P.R), 1e-12, '斜坡 uCamAlt＝eye·sinψ');
  near(U.uTerF0, 0, 0, '斜坡 uTerF0＝0');
  const tip = mk(10, 0);
  ok(tip.toSite().s >= P.R * Math.asin((P.a + 1) / P.R) - 1e-6, '瞬移到塔基以内会夹到塔外');
}

section('2 朝向基、上一帧量');
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const y = Math.random() * 360 - 180, p = Math.random() * 178 - 89, b = K.basis(y, p);
    const e = [dot(b.fwd, b.fwd) - 1, dot(b.right, b.right) - 1, dot(b.up, b.up) - 1, dot(b.fwd, b.right), dot(b.fwd, b.up), dot(b.right, b.up)];
    worst = Math.max(worst, ...e.map(Math.abs));
    if (Math.abs(b.right[0]) > 1e-12) worst = 1;          // 横滚恒 0：right 没有 U 分量
  }
  ok(worst < 1e-12, `朝向基正交归一、right 水平（最大误差 ${worst.toExponential(1)}）`);
  const b0 = K.basis(0, 0), b90 = K.basis(90, 0), bz = K.basis(0, 89.9);
  ok(b0.fwd[1] === -1 && Math.abs(b0.right[2] + 1) < 1e-15, 'yaw 0：看北（0,−1,0），右手是东（0,0,−1）');
  ok(Math.abs(b90.fwd[2] + 1) < 1e-15, 'yaw 90：看东（0,0,−1）');
  ok(bz.fwd[0] < -0.9999, 'pitch→90：看 U（塔轴）');

  const cam = mk(6670, -4, 'slope');
  let U = cam.compute(); U = cam.compute();
  ok(U.uPrevPos.every(v => v === 0), '静止：uPrevPos＝0');
  const B = K.basis(cam.look().yaw, cam.look().pitch), Tt = U.uPrevBasisT;
  ok([0, 1, 2].every(i => Math.abs(Tt[i] - B.right[i]) < 1e-15 && Math.abs(Tt[3 + i] - B.up[i]) < 1e-15 && Math.abs(Tt[6 + i] - B.fwd[i]) < 1e-15),
    '静止：uPrevBasisT 的三行＝right、up、fwd（本帧基的转置）');
  // 向东挪 50 m：上一帧相机（转到本帧 CM）＝本帧相机−位移
  const w0 = cam.posW();
  cam.nudge(0, 0.05);
  U = cam.compute();
  const w1 = cam.posW(), lam = cam.lam(), d = Cel.toCM([w0[0] - w1[0], w0[1] - w1[1], w0[2] - w1[2]], lam);
  const dd = Math.hypot(U.uPrevPos[0] - d[0], U.uPrevPos[1] - d[1], U.uPrevPos[2] - d[2]);
  ok(dd < 1e-9, `向东 50 m 后 uPrevPos＝上一帧真实相机−本帧真实相机（本帧 CM 系），差 ${(dd * 1e6).toExponential(1)} mm`);
  // 南北向也验：真实相机（不是 fround 后的）之差，走 3 cm 也连续
  cam.compute();
  const v0 = cam.posW(); cam.nudge(0.00003, 0); const U2 = cam.compute(), v1 = cam.posW();
  const d2 = Cel.toCM([v0[0] - v1[0], v0[1] - v1[1], v0[2] - v1[2]], cam.lam());
  ok(Math.hypot(U2.uPrevPos[0] - d2[0], U2.uPrevPos[1] - d2[1], U2.uPrevPos[2] - d2[2]) < 1e-9 && Math.hypot(...U2.uPrevPos) > 2.9e-5,
    `向北 3 cm：uPrevPos 长 ${(Math.hypot(...U2.uPrevPos) * 1e5).toFixed(2)} cm（不被 float32 的 0.24–0.49 m 格子吃掉）`);
  // 上一帧基转到本帧：经度变了 Δφ，基向量绕 y 转 Δφ
  const Bp = U.uPrevBasisT, rotNorm = Math.hypot(Bp[6], Bp[7], Bp[8]);
  ok(Math.abs(rotNorm - 1) < 1e-12 && Math.abs(Bp[7] - B.fwd[1]) < 1e-12, '上一帧 fwd 转到本帧后仍是单位向量、y 分量不变');
}

section('3 行走与碰撞');
{
  // 斜坡模式向东（沿纬圈，坡度 0）：步速
  for (const [inp, v] of [[{ fwd: 1 }, 1.4], [{ fwd: 1, run: true }, 4.5], [{ fwd: 1, ride: true }, 12]]) {
    const cam = mk(6670, -4, 'slope', Object.assign({ yaw: 90 }, FLAT));
    cam.setLook(90, 0);
    let dist = 0; const phi0 = cam.lam();
    for (let i = 0; i < 200; i++) dist += cam.step(0.05, inp).dist;
    const geo = (phi0 - cam.lam()) * P.R * Math.sin(cam.info().psi);
    ok(Math.abs(dist * 1000 / 10 / v - 1) < 1e-9 && Math.abs(geo / dist - 1) < 0.01, `平整地面向东 10 秒：${(dist * 1000).toFixed(2)} m（${v} m/s），经度折合 ${(geo * 1000).toFixed(2)} m`);
  }
  // 斜坡：轻域往北（坡度≈纬度 72°）减速到两成；罪域往北（30°）不减速
  {
    const a = mk(2000, 0, 'slope', FLAT), b = mk(6670, -4, 'slope', FLAT);
    let da = 0, db = 0;
    for (let i = 0; i < 100; i++) { da += a.step(0.05, { fwd: 1 }).dist; db += b.step(0.05, { fwd: 1 }).dist; }
    ok(Math.abs(K.slowdown(30) - 1) < 1e-12 && Math.abs(K.slowdown(50) - 0.5) < 1e-12 && K.slowdown(80) === 0.2, 'K.slowdown：35° 以内全速、50° 一半、65° 以上两成');
    ok(Math.abs(da * 1000 / 5 - 0.28) < 0.01, `斜坡·轻域往北（坡 ${(90 - 2000 / P.R * R2D).toFixed(0)}°）：${(da * 1000 / 5).toFixed(3)} m/s（减到两成）`);
    ok(Math.abs(db * 1000 / 5 - 1.4) < 0.01, `斜坡·罪域往北（坡 30°）：${(db * 1000 / 5).toFixed(3)} m/s（不减速）`);
  }
  // 阶地：沿踏面向东，离轴半径（眼高处）不变＝踏面水平
  {
    const cam = mk(6670, -4, 'terrace');
    cam.setLook(90, 0);
    const r0 = cam.info().tread, k0 = cam.info().level;
    let maxd = 0, dist = 0;
    for (let i = 0; i < 300; i++) { dist += cam.step(0.05, { fwd: 1, ride: true }).dist; maxd = Math.max(maxd, Math.abs(cam.info().tread - r0)); }
    ok(maxd < 1e-5 && cam.info().level === k0, `阶地向东骑行 ${(dist * 1000).toFixed(0)} m：踏面离轴半径变化 ${(maxd * 1e5).toFixed(4)} cm（踏面严格水平；细层起伏另算）`);
  }
  // 阶地：往北（迎着上一级的崖）走，走到崖脚停步；往南走到崖沿停步。全程每步高差＜0.6 m、不进崖带
  for (const [dir, yaw] of [['北', 0], ['南', 180]]) {
    const cam = mk(6670, -4, 'terrace', FLAT);
    cam.setLook(yaw, 0);
    let stopAt = -1, maxStep = 0, inBand = false, r = cam.info().rho;
    for (let i = 0; i < 3000; i++) {
      const res = cam.step(0.05, { fwd: 1, ride: true }), inf = cam.info();
      maxStep = Math.max(maxStep, Math.abs(inf.rho - r)); r = inf.rho;
      if (inf.f < G0.cliff) inBand = true;
      if (!res.moved) { stopAt = i; break; }
    }
    const f = cam.info().f;
    ok(stopAt > 0, `往${dir}骑行：第 ${stopAt} 步停下（${dir === '北' ? '崖脚' : '崖沿'}，相位 ${f.toFixed(4)}）`);
    ok(!inBand && maxStep < 6e-4, `往${dir}（平整地面）：始终没进崖带，单步高差最大 ${(maxStep * 1000).toFixed(3)} m`);
    ok(dir === '北' ? f > 0.99 : f >= G0.cliff && f < G0.cliff + 0.01, `往${dir}：停在${dir === '北' ? '崖脚（相位≈1）' : '崖沿（相位刚过崖带）'}`);
    // 停下后再推几秒也不动；转身就能走
    let again = 0; for (let i = 0; i < 20; i++) again += cam.step(0.05, { fwd: 1, ride: true }).dist;
    ok(again === 0, `往${dir}：停下后继续推不动`);
    cam.setLook(yaw + 180, 0);
    ok(cam.step(0.05, { fwd: 1 }).moved, `往${dir}：转身能走`);
    // 斜着推：贴着崖线横走
    cam.setLook(yaw, 0);
    for (let i = 0; i < 50; i++) cam.step(0.05, { fwd: 1, ride: true });
    cam.setLook(yaw + 45, 0);
    ok(cam.step(0.05, { fwd: 1, ride: true }).moved, `往${dir}：斜着推时贴崖横走`);
  }
  // 头部起伏
  {
    const cam = mk(6670, -4, 'slope', { bob: true });
    cam.setLook(90, 0);
    let lo = 1, hi = 0;
    for (let i = 0; i < 200; i++) { cam.step(0.02, { fwd: 1 }); const a = cam.alt(); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    ok(hi - lo > 0.02e-3 && hi - lo <= 0.031e-3, `行走时头部起伏 ±${((hi - lo) / 2 * 1e6).toFixed(1)} mm（规格 15 mm）`);
    for (let i = 0; i < 200; i++) cam.step(0.02, {});
    near(cam.alt(), 0.0016, 1e-8, '停步后起伏消失');
    const nb = mk(6670, -4, 'slope', { bob: false });
    nb.setLook(90, 0);
    for (let i = 0; i < 50; i++) nb.step(0.02, { fwd: 1 });
    near(nb.alt(), 0.0016, 0, '关掉起伏：眼高恒定');
  }
}

section('3b 真实地面（F 路的细层起伏）：随便往哪走都不会卡住');
{
  let seed = 3;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [mode, name, s, az] of [['terrace', '罪域', 6670, -4], ['terrace', '圣禁城', 3600, 0], ['slope', '罪域', 6670, -4], ['slope', '涅赫莱恩', 5600, 25], ['terrace', '轻域', 2000, 0]]) {
    let stuck = 0, tot = 0, nominal = 0, runs = 0;
    for (let k = 0; k < 6; k++) {
      const cam = mk(s, az, mode);
      cam.setLook(rnd() * 360 - 180, 0);
      let still = 0, d = 0;
      for (let i = 0; i < 400; i++) {                      // 20 秒，跑步
        const r = cam.step(0.05, { fwd: 1, run: true });
        d += r.dist; still = r.moved ? 0 : still + 1;
        if (still > 20) { cam.setLook(cam.look().yaw + 90, 0); still = 0; stuck++; }   // 一秒走不动就转身
      }
      tot += d; nominal += 4.5 * 20 / 1000; runs++;
    }
    const eff = tot / nominal;
    ok(eff > 0.6, `${mode === 'terrace' ? '阶地' : '斜坡'}·${name}：6 趟各跑 20 秒，平均走出名义距离的 ${(eff * 100).toFixed(0)}%（被挡转身 ${stuck} 次）`);
  }
}

section('4 视角与朝向快捷');
{
  const cam = mk(6670, -4);
  cam.step(0.1, { zoom: 4 });
  for (let i = 0; i < 40; i++) cam.step(0.05, {});
  near(cam.look().fovEff, 27.5, 1e-6, '凝视（滚轮 4 格）：视角到默认的一半');
  near(cam.look().fov, 55, 0, '凝视不改基准视角（写回 fp.fov 的是基准）');
  for (let i = 0; i < 40; i++) cam.step(0.05, { tele: true });
  near(cam.look().fovEff, 5, 1e-6, '望远：5°');
  for (let i = 0; i < 40; i++) cam.step(0.05, { tele: false, zoom: -8 });
  near(cam.look().fovEff, 55, 1e-6, '收回望远与凝视：回到 55°');
  ok(K.LOOK_PRESETS.map(p => p.label).join('/') === '北·塔根/东/南·塔顶/西/天顶/看太阳/看月亮', '朝向快捷七项（北·塔根、东、南·塔顶、西、天顶、看太阳、看月亮）');

  // 塔根、塔顶仰角：02 第十一节第 3 条（球面上的数；站在阶地上会高出一点，差在 1° 内）
  for (const [name, s, az, root, top] of [['罪域', 6670, -4, 57.3, 27.3], ['涅赫莱恩', 5600, 25, 62.1, 22.5], ['伊美忒', 4000, 2, 69.3, 15.3], ['圣禁城', 3600, 0, 71.1, 13.5]]) {
    const c = mk(s, az), O = c.observer();
    const n = K.presetAngles('north', O, 0, P), so = K.presetAngles('south', O, 0, P);
    ok(n.yaw === 0 && Math.abs(n.pitch - root) < 1 && so.yaw === 180 && Math.abs(so.pitch - top) < 1,
      `${name}：北·塔根 ${n.pitch.toFixed(1)}°（02：${root}），南·塔顶 ${so.pitch.toFixed(1)}°（02：${top}）`);
  }
  const ea = K.presetAngles('east', null, 0, P), we = K.presetAngles('west', null, 0, P), ze = K.presetAngles('zenith', null, 0, P);
  ok(ea.yaw === 90 && ea.pitch === 0 && we.yaw === -90 && ze.yaw === null && ze.pitch === 89, '东 90°、西 −90°、天顶 89°（方位不变）');

  // 看太阳、看月亮：转完后视线正对天体（取天体仰角不到 85° 的时刻）
  for (const body of ['sun', 'moon']) {
    let t = 0.3, worst = 0, n = 0;
    for (let k = 0; k < 30; k++, t += 0.37) {
      const c = mk(6670, -4);
      const O = c.observer(), Q = body === 'sun' ? A.sunPos(t, P) : A.moonPos(t, P), lk = A.look(O, Q, P);
      if (Math.abs(lk.el) > 85) continue;
      c.lookPreset(body, t);
      for (let i = 0; i < 20; i++) c.step(0.05, {});
      const U = c.compute(), Qc = Cel.toCM(Q, c.lam()), v = [Qc[0] - U.uCamW[0], Qc[1] - U.uCamW[1], Qc[2] - U.uCamW[2]], L = Math.hypot(...v);
      const ang = Math.acos(Math.min(1, dot(U.uCamFwd, v) / L)) * R2D;
      worst = Math.max(worst, ang); n++;
    }
    ok(n > 10 && worst < 0.01, `看${body === 'sun' ? '太阳' : '月亮'}：${n} 个时刻，转完后视线与天体中心最大偏 ${worst.toExponential(2)}°`);
  }
  // 平滑转向：0.6 秒转完；中途用户转头会打断
  const c = mk(6670, -4);
  c.lookAt(120, 30, 0.6);
  for (let i = 0; i < 3; i++) c.step(0.1, {});          // step 的 dt 夹在 0.1 s 以内
  const mid = c.look().yaw;
  ok(mid > 10 && mid < 110, `平滑转向：转到一半 yaw＝${mid.toFixed(1)}°`);
  c.step(0.05, { dYaw: 5 });
  const after = c.look().yaw;
  c.step(0.5, {});
  near(c.look().yaw, after, 1e-9, '用户转头打断平滑转向');
}

section('5 uniform 的形状与自洽');
{
  const names = HY.fp.UNIFORMS.filter(r => r[3] === 'cam').map(r => r[0]).sort();
  for (const [mode, s, az] of [['terrace', 6670, -4], ['slope', 3600, 0], ['terrace', 0.72 * Math.PI * P.R, 180]]) {
    const cam = mk(s, az, mode), U = cam.compute();
    ok(JSON.stringify(Object.keys(U).sort()) === JSON.stringify(names), `${mode}·s＝${s.toFixed(0)}：compute() 恰好给出全部 cam 写入的 uniform`);
    ok(Object.keys(U).every(k => finite(U[k])), '全部有限');
    const K2 = U.uCamW[0] ** 2 + U.uCamW[1] ** 2 - P.R * P.R;
    near(U.uCamK, K2, 1e-6, 'uCamK＝|C_f|²−R²（用舍入后的相机）');
    near(U.uCamZ, -U.uCamK / (P.R + Math.sqrt(P.R * P.R + U.uCamK)), 1e-12, 'uCamZ 由 K 推');
    ok(U.uCamW.every(v => Math.fround(v) === v) && U.uCamW[2] === 0, 'uCamW 是 float32 值、z＝0（CM 系）');
    ok(U.uOrg.length === 7 && U.uOrg.every(o => o[0] >= 0 && o[0] < 1 && o[1] >= 0 && o[1] < 1), 'uOrg 七层都在 [0,1)');
    const M = U.uCM2W, c = Math.cos(cam.lam()), sn = Math.sin(cam.lam());
    ok(Math.abs(M[0] - c) < 1e-15 && Math.abs(M[2] + sn) < 1e-15 && Math.abs(M[6] - sn) < 1e-15 && M[4] === 1, 'uCM2W＝绕塔轴转 φ_C（行优先）');
    // posW 与 CM 相机一致
    const W = cam.posW(), Cc = Cel.toCM(W, cam.lam());
    ok(Math.abs(Cc[0] - U.uCamW[0]) < 1e-3 && Math.abs(Cc[1] - U.uCamW[1]) < 1e-3 && Math.abs(Cc[2]) < 1e-9, 'posW 转回 CM＝(ρ_C, y_C, 0)');
    const rC = cam.info().rho;
    near(U.uStrataC, rC / 0.045 - Math.floor(rC / 0.045), 1e-9, 'uStrataC＝fract(ρ_C/0.045)（真实相机，层理不随 float32 格子跳）');
  }
  // 罪域阶地：眼睛（相机）离阶地踏面 1.6 m；踏面高出裸球面不超过一级崖高
  const cam = mk(6670, -4), U = cam.compute();
  ok(Math.abs(U.uCamZ) < U.uClearMax, `罪域阶地：相机离裸球面 ${(U.uCamZ * 1000).toFixed(1)} m（不超过求交器上界 uClearMax ${(U.uClearMax * 1000).toFixed(0)} m）`);
  // 性能：step＋compute 每帧
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) { cam.step(1 / 60, { fwd: 1, right: 0.3, dYaw: 0.1 }); cam.compute(); }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 2000;
  ok(us < 200, `每帧 step＋compute ${us.toFixed(1)} µs（含 F 路的地面细层）`);
}

section('6 HY.fp.api（HY.app 的第一人称取数接口）');
{
  const api = HY.fp.api, st = HY.state;
  ok(['look', 'lookPreset', 'presets', 'readPx', 'Eh', 'sunVis', 'moonState', 'pose', 'gpuTimes', 'quality', 'perf'].every(k => typeof api[k] === 'function'), '接口齐全');
  K.current = null;
  const r = api.look(30, 20, 50);
  ok(st.fp.yaw === 30 && st.fp.pitch === 20 && st.fp.fov === 50 && r.yaw === 30, 'look(30, 20, 50) 写进 fp.yaw／pitch／fov');
  api.look(null, 10);
  ok(st.fp.yaw === 30 && st.fp.pitch === 10, 'look(null, 10) 只改 pitch');
  const a = api.lookPreset('north');
  const tv = A.towerView(HY.model.O, P);
  ok(a && st.fp.yaw === 0 && Math.abs(st.fp.pitch - Math.round(tv.rootEl * 10) / 10) <= 0.051, `第一人称未就绪时 lookPreset('north') 直接写状态（pitch ${st.fp.pitch}）`);
  const b = api.look('sun');
  ok(b && isFinite(b.pitch), `look('sun') 等同 lookPreset('sun')`);
  ok(api.lookPreset('nope') === null, '不认识的朝向返回 null');
  ok(api.presets().length === 7, 'presets() 七项');
  // 有相机时，look 也立即作用在相机上
  const cam = K.create(P, st.site, st.fp);
  api.look(45, 5);
  ok(cam.look().yaw === 45 && cam.look().pitch === 5, '有相机时 look() 立即转相机');
  ok(cam === K.current, '新建的相机就是 HY.fp.cam.current');
  const sv = api.sunVis(), ms = api.moonState(), eh = api.Eh(), pf = api.perf(), po = api.pose();
  ok(sv >= 0 && sv <= 1, `sunVis()＝${sv}`);
  ok(['亮月', '灰月', '黑月'].indexOf(ms) >= 0, `moonState()＝${ms}`);
  ok(eh && 'lux' in eh && eh.est === true, `Eh() 在第一人称没就绪时给总览估算（est: true，lux ${eh.lux}）`);
  ok(['fps', 'cpuMs', 'gpuMs', 'res', 'tier'].every(k => k in pf), 'perf() 形状');
  ok(po && Math.abs(po.s - 6670) < 1 && po.yaw === 45, 'pose()：第一人称没在用时取状态（地点、朝向）');
  ok(typeof api.gpuTimes() === 'object', 'gpuTimes() 是对象');
  // 跟着状态：fpState 就是 HY.state.fp 时现读（改眼高立刻生效）
  HY.store.set('fp.eye', 1.8, 'api');
  near(cam.alt(), 0.0018, 1e-12, '改 fp.eye 后相机眼高立刻跟上');
  HY.store.set('fp.eye', 1.6, 'api');
}

section('6b HY.fp.api：第一人称在用与不在用');
{
  const api = HY.fp.api, st = HY.state, fpm = HY.fp;
  const hadStatus = Object.prototype.hasOwnProperty.call(fpm, 'status'), oldStatus = fpm.status;
  const setSite = (s, az) => HY.store.patch('site', { id: null, s, az }, 'api');
  const wrapD = d => ((d % 360) + 360) % 360;
  // ① 离开第一人称后相机还留着（资源保留），停在圣禁城；此刻地点是罪域：总览里的朝向快捷按罪域算，不按留着的相机
  setSite(6670, -4);
  const stale = K.create(P, { s: 3600, az: 0 }, st.fp);
  HY.store.set('view.mode', 'ov', 'api');
  const a1 = api.lookPreset('north'), tvR = A.towerView(HY.model.O, P), tvS = A.towerView(stale.observer(), P);
  ok(a1 && Math.abs(a1.pitch - tvR.rootEl) < 1e-9 && Math.abs(tvS.rootEl - tvR.rootEl) > 5,
    `总览里：北·塔根按此刻地点（罪域 ${tvR.rootEl.toFixed(1)}°），不按离开时留下的相机（圣禁城 ${tvS.rootEl.toFixed(1)}°）`);
  const p1 = api.pose();
  ok(Math.abs(p1.s - 6670) < 1e-9, 'pose()：总览里取状态的地点，不取留下的相机');

  // ② 假装第一人称就绪
  fpm.status = () => ({ phase: 'ready', progress: 1, reason: '' });
  HY.store.set('view.mode', 'fp', 'api');
  const cam = K.create(P, { s: 6670, az: -4 }, st.fp);
  cam.setLook(0, 0);
  for (let i = 0; i < 3; i++) cam.step(0.05, {});
  // 同一时刻：地点刚从罪域改成涅赫莱恩（fp.js 下一帧才瞬移），紧接着“看太阳”——要按涅赫莱恩转
  const t = 3.3;
  HY.store.set('time.t', t, 'api');
  const est = api.lookPreset('sun', { instant: true });
  ok(est && cam.pending() === 'sun', '第一人称在用：朝向快捷排到下一帧（相机记着“sun”）');
  cam.teleport(5600, 25);                                  // fp.js 在 step 之前处理排下的瞬移
  cam.step(1 / 60, {});
  const O2 = cam.observer(), lk = A.look(O2, A.sunPos(t, P), P);
  const dYaw = Math.abs(((cam.look().yaw - lk.az) % 360 + 540) % 360 - 180);
  ok(cam.pending() === null && dYaw < 1e-6 && Math.abs(cam.look().pitch - lk.el) < 1e-6,
    `instant：瞬移后的第一帧就正对涅赫莱恩看到的太阳（方位 ${lk.az.toFixed(1)}°、仰角 ${lk.el.toFixed(1)}°；按旧地点算是 ${wrapD(est.yaw).toFixed(1)}°、${est.pitch.toFixed(1)}°）`);
  ok(Math.abs(est.pitch - lk.el) > 3, '（对照）旧地点估的角度确实不对，所以必须等瞬移');
  // 平滑：0.6 s 转完
  cam.setLook(0, 0);
  api.lookPreset('north');
  cam.step(0.05, {});
  const midP = cam.look().pitch;
  for (let i = 0; i < 20; i++) cam.step(0.05, {});
  const tvN = A.towerView(cam.observer(), P);
  ok(midP < tvN.rootEl - 1 && Math.abs(cam.look().pitch - tvN.rootEl) < 1e-9 && cam.look().yaw === 0, `平滑：先转一部分（${midP.toFixed(1)}°），0.6 s 后到塔根 ${tvN.rootEl.toFixed(1)}°`);
  // 排着的快捷被随后的 look() 取消（后发的为准）
  api.lookPreset('moon'); api.look(12, 3);
  cam.step(0.05, {});
  ok(cam.look().yaw === 12 && cam.look().pitch === 3, '排着“看月亮”时又 look(12, 3)：以后者为准');
  // look() 只给 pitch：yaw 保持相机此刻的值（状态里的 yaw 是半秒前写回的旧值，不能拿它覆盖）
  cam.setLook(37.23, 0);
  HY.store.patch('fp', { yaw: 0 }, 'fp');                 // 模拟：状态里还是旧的 yaw（src:'fp' 是第一人称自己的写回）
  api.look(null, 10);
  ok(Math.abs(cam.look().yaw - 37.23) < 1e-9 && Math.abs(st.fp.yaw - 37.23) < 0.051 && st.fp.pitch === 10,
    `look(null, 10)：相机 yaw 不变（${cam.look().yaw}），状态三项一起写回（yaw ${st.fp.yaw}）`);
  const p2 = api.pose();
  ok(Math.abs(p2.s - cam.toSite().s) < 1e-9 && p2.yaw === cam.look().yaw, 'pose()：第一人称在用时取相机');
  const sv = api.sunVis(), ref = A.look(cam.observer(), A.sunPos(st.time.t, P), P).vis;
  ok(sv === ref, `sunVis()：按相机此刻的位置（${sv}）`);
  ok(api.lookPreset('nope') === null && cam.pending() === null, '不认识的名字：返回 null，也不排');

  if (hadStatus) fpm.status = oldStatus; else delete fpm.status;
  HY.store.set('view.mode', 'ov', 'api');
  setSite(6670, -4);
}

section('7 参数变了：自动跟上、重新贴地');
{
  const st = HY.state, cam = K.create(P, st.site, st.fp);
  const s0 = cam.toSite().s;
  HY.store.set('astro.o.R', 6500, 'api');
  HY.model.rebuildP();
  cam.compute();
  ok(cam.params() === HY.model.P && cam.params().R === 6500, '改 astro.R 后相机自动换成新的 P');
  ok(Math.abs(cam.toSite().s - s0) < 0.5, `原地重新瞬移（s ${s0.toFixed(2)} → ${cam.toSite().s.toFixed(2)}）`);
  HY.store.reset('astro', 'api'); HY.model.rebuildP();
  cam.compute();
  // 走一段之后只改天体量（月面反照率、定标）：原地不动、R_ref 与图表坐标不变（脚下的地面不换样）
  {
    cam.setLook(90, 0);
    for (let i = 0; i < 100; i++) cam.step(0.05, { fwd: 1, ride: true });
    cam.setLook(180, 0);
    for (let i = 0; i < 100; i++) cam.step(0.05, { fwd: 1, ride: true });
    const before = cam.compute(), rr = before.uRref, ch = cam.chart().slice(), pos = cam.posW();
    HY.store.set('astro.o.pMoon', 0.3, 'api'); HY.model.rebuildP();
    HY.store.set('astro.calib', '1361', 'api'); HY.model.rebuildP();
    const after = cam.compute(), pos2 = cam.posW();
    ok(cam.params() === HY.model.P && after.uRref === rr && cam.chart()[0] === ch[0] && cam.chart()[1] === ch[1] &&
      Math.hypot(pos2[0] - pos[0], pos2[1] - pos[1], pos2[2] - pos[2]) === 0,
      `只改月面反照率、定标：换了新的 P，相机原地不动，R_ref（${rr.toFixed(3)}）与图表坐标不变`);
    HY.store.reset('astro', 'api'); HY.model.rebuildP();
    cam.compute();
  }
  // 改踏面宽：相位若落进崖带，自动挪回踏面
  let bad = 0;
  for (const W of [0.7, 1.1, 2.3, 3.7, 5.2, 1.5]) {
    HY.store.set('fp.ground.W', W, 'api');
    cam.compute();
    if (cam.info().f < st.fp.ground.cliff) bad++;
  }
  ok(bad === 0, '连改六次踏面宽，相机始终站在踏面上');
  HY.store.set('fp.ground.mode', 'slope', 'api'); cam.compute();
  ok(cam.mode() === 0, '切到斜坡：相机跟着切');
  HY.store.set('fp.ground.mode', 'terrace', 'api'); cam.compute();
  ok(cam.mode() === 1 && cam.info().f >= st.fp.ground.cliff, '切回阶地：落在踏面上');
}

section('8 坏输入不让相机变成 NaN');
{
  const allFinite = c => { const U = c.compute(), l = c.look(); return Object.keys(U).every(k => finite(U[k])) && [l.yaw, l.pitch, l.fov, l.fovEff].every(isFinite); };
  const c = mk(6670, -4);
  c.setLook(30, 10);
  c.lookAt(NaN, 20, 0.2);
  for (let i = 0; i < 10; i++) c.step(0.05, {});
  ok(c.look().yaw === 30 && Math.abs(c.look().pitch - 20) < 1e-9 && allFinite(c), 'lookAt(NaN, 20)：方位不变、仰角照转');
  c.lookAt(45, undefined, 0);
  ok(c.look().yaw === 45 && Math.abs(c.look().pitch - 20) < 1e-9, 'lookAt(45, undefined, 0)：只改方位，一步到位');
  c.step(0.05, { dYaw: 5, dPitch: NaN, zoom: NaN, fwd: NaN, right: Infinity });
  ok(c.look().yaw === 50 && Math.abs(c.look().pitch - 20) < 1e-9 && allFinite(c), 'step 输入里混着 NaN／Infinity：坏的那几项当 0，好的照用');
  c.step(NaN, { fwd: 1 });
  ok(allFinite(c), 'step(NaN)：当 0 秒');
  const q0 = c.toSite();
  c.teleport(NaN, 30);
  ok(Math.abs(c.toSite().s - q0.s) < 0.2 && Math.abs(c.toSite().az - 30) < 1e-9 && allFinite(c), 'teleport(NaN, 30)：离塔根距离留在原处，方位照改');
  c.teleport(5600, undefined);
  ok(Math.abs(c.toSite().s - 5600) < 0.2 && Math.abs(c.toSite().az - 30) < 1e-9 && allFinite(c), 'teleport(5600, undefined)：方位留在原处');
  const fresh = K.create(P, { s: 'x', az: null }, fpsOf('terrace'), { zones: ZONES });
  ok(Math.abs(fresh.toSite().s - 6670) < 0.2 && allFinite(fresh), '新建时地点是坏值：落在罪域');
}

T.done();
