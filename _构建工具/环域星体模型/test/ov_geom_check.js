#!/usr/bin/env node
/* ov_geom_check —— 总览纯几何自检（负责：B 路；规格：spec/03 第十一节第 1 条 ov_geom_check 一行，另加几条本路自己的）
 *   示意螺旋按 helixAngle 转过后，u(t) 处的点与真实天体位置相差＜1e-6·R（日、月各 100 个随机 t，sunGapX＝1）
 *   日月螺旋高度互为相反数；旋向相反（同 u 处 dθ/du·dy/du 异号）
 *   trail 端点与 sunPos(t±窗) 一致（地固系、惯性系）
 *   shadowWedge 切线与塔相切（距离＝a±1e-6），且与日球相切；本影里看不到日面、半影外全亮
 *   pick 往返：site → 射线 → pick 回到同一 (s, az)（±0.5 km）
 *   spin 在 t＝10⁵ 日时与直接算的角度差＜1e-9
 * 另：每日同刻、螺旋闭合、管子网格、遮挡判定、镜头预设、入冬镜头文案、ov_occl.glsl 与 common.glsl 逐字一致。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('ov_geom_check');
const { ok, near, eq, section } = T;
const A = HY.astro, gm = HY.ov.geom, P = A.params();
const TAU = Math.PI * 2;
const F32 = 1e-6 * P.R;          // 几何数组是 Float32Array：km 量级的舍入约 4e-4 km，按 1e-6·R 容差

// 可复现的随机数
let seed = 20261014;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function rotY(p, al) { const c = Math.cos(al), s = Math.sin(al); return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c]; }
function dist(a, b) { return Math.hypot(a[0] - (b.x ?? b[0]), a[1] - (b.y ?? b[1]), a[2] - (b.z ?? b[2])); }
function wrap(x) { x = x % TAU; if (x > Math.PI) x -= TAU; if (x < -Math.PI) x += TAU; return x; }

section('0 不再是桩');
eq(gm.__stubs.length, 0, 'HY.ov.geom.__stubs 为空');
for (const f of ['helix', 'helixAngle', 'trail', 'strobe', 'shadowWedge', 'pick', 'spin', 'presetPose', 'occluded', 'tube', 'winterNear']) ok(typeof gm[f] === 'function', 'geom.' + f);

section('1 示意螺旋按 helixAngle 转过后穿过天体的真实位置');
for (const body of ['sun', 'moon']) {
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const t = (rnd() - 0.5) * 8e4, turns = 4 + Math.floor(rnd() * 45);
    const u = gm.uOf(P, t), p = gm.helixPoint(P, body, u, turns, 1), q = rotY(p, gm.helixAngle(P, body, t, turns));
    const B = body === 'sun' ? A.sunPos(t, P) : A.moonPos(t, P);
    worst = Math.max(worst, dist(q, B));
  }
  ok(worst < 1e-6 * P.R, `${body === 'sun' ? '日' : '月'}：100 个随机 t 最大偏差 ${worst.toExponential(2)} km < 1e-6·R`);
}
{
  // 网格里的顶点也一样：取 u 最接近 u(t) 的顶点，偏差不超过一段弦长
  const turns = 12, t = 123.456, h = gm.helix(P, 'sun', turns, 1), u = gm.uOf(P, t), n = h.u.length;
  const i = Math.round(u * (n - 1)), al = gm.helixAngle(P, 'sun', t, turns);
  const q = rotY([h.pos[3 * i], h.pos[3 * i + 1], h.pos[3 * i + 2]], al);
  const seg = Math.max(TAU * P.dS * turns, 4 * P.A) / (n - 1);
  ok(dist(q, A.sunPos(t, P)) < seg, 'geom.helix 的顶点与 helixPoint 同式（最近顶点在一段之内）');
  ok(Math.abs(h.pos[0] - h.pos[3 * (n - 1)]) < 1e-3 && Math.abs(h.pos[2] - h.pos[3 * (n - 1) + 2]) < 1e-3, '整数圈的螺旋首尾闭合（入冬交节）');
  eq(h.u[0], 0, 'u 从 0 起'); eq(h.u[n - 1], 1, 'u 到 1 止');
}
{
  // 放大日轨：同方位、同高度，只是离轴变成 a＋(dS−a)·gapX
  const t = 77.7, gap = 4, turns = 12, u = gm.uOf(P, t);
  const q = rotY(gm.helixPoint(P, 'sun', u, turns, gap), gm.helixAngle(P, 'sun', t, turns)), S = A.sunPos(t, P), k = gm.gapScale(P, gap);
  ok(dist(q, [S.x * k, S.y, S.z * k]) < 1e-6 * P.R, '日轨放大 ×4 时螺旋穿过“放大后的”太阳（同方位同高度）');
  near(Math.hypot(q[0], q[2]), P.a + (P.dS - P.a) * gap, 1e-6, '放大后的离轴半径＝a＋(dS−a)·gapX');
}

section('2 镜像：高度互为相反数、旋向相反');
{
  let worst = 0, sameSign = 0, opp = 0, n = 0;
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    worst = Math.max(worst, Math.abs(gm.heightOf(P, 'sun', u) + gm.heightOf(P, 'moon', u)));
    const du = 1e-5, turns = 12;
    const a0 = gm.helixPoint(P, 'sun', u, turns, 1), a1 = gm.helixPoint(P, 'sun', u + du, turns, 1);
    const b0 = gm.helixPoint(P, 'moon', u, turns, 1), b1 = gm.helixPoint(P, 'moon', u + du, turns, 1);
    const dthA = wrap(Math.atan2(a1[2], a1[0]) - Math.atan2(a0[2], a0[0])), dthB = wrap(Math.atan2(b1[2], b1[0]) - Math.atan2(b0[2], b0[0]));
    const dyA = a1[1] - a0[1], dyB = b1[1] - b0[1];
    if (Math.abs(dyA) < 1e-6) continue;
    n++;
    if (Math.sign(dthA * dyA) === -Math.sign(dthB * dyB)) opp++;
    if (Math.sign(dthA) === Math.sign(dthB)) sameSign++;
  }
  ok(worst < 1e-9, `日月螺旋高度互为相反数（最大和 ${worst.toExponential(1)} km）`);
  eq(opp, n, `示意螺旋：同 u 处 dθ/du·dy/du 异号（${opp}/${n}）`);
  eq(sameSign, n, '两条示意螺旋同向绕塔（只是一升一降）');
  // 真实运动也是旋向相反：一日内日、月方位都增大，高度一升一降
  let realOpp = 0, m = 0;
  for (let i = 0; i < 50; i++) {
    const t = rnd() * 360, d = 1e-3, S0 = A.sunPos(t, P), S1 = A.sunPos(t + d, P), M0 = A.moonPos(t, P), M1 = A.moonPos(t + d, P);
    const s = wrap(S1.th - S0.th) * (S1.y - S0.y), q = wrap(M1.th - M0.th) * (M1.y - M0.y);
    if (Math.abs(S1.y - S0.y) < 1e-9) continue;
    m++; if (Math.sign(s) === -Math.sign(q)) realOpp++;
  }
  eq(realOpp, m, `真实日月轨迹旋向相反（${realOpp}/${m}）`);
  // 入冬、入夏两刻同过塔腰
  ok(Math.abs(gm.heightOf(P, 'sun', 0)) < 1e-9 && Math.abs(gm.heightOf(P, 'moon', 0.5)) < 1e-9, '入冬（u＝0）、入夏（u＝0.5）日月都在塔腰');
  ok(gm.heightOf(P, 'sun', 0.25) > 0 && gm.heightOf(P, 'moon', 0.25) < 0, '冬半年日在塔腰以上、月在以下');
  near(gm.orbitRadius(P, 'moon', 5), P.rM, 1e-9, '月轨照实（不随日轨放大）');
}

section('3 实际轨迹与每日同刻');
{
  for (let i = 0; i < 20; i++) {
    const t = (rnd() - 0.5) * 2e4;
    const tr = gm.trail(P, 'sun', t, -0.5, 0.5, 201, 'ground'), n = tr.length / 3;
    ok(dist([tr[0], tr[1], tr[2]], A.sunPos(t - 0.5, P)) < F32 && dist([tr[3 * (n - 1)], tr[3 * (n - 1) + 1], tr[3 * (n - 1) + 2]], A.sunPos(t + 0.5, P)) < F32,
      `日轨迹（地固系）端点＝sunPos(t∓0.5)，t＝${t.toFixed(2)}`);
    const tm = gm.trail(P, 'moon', t, -1, 1, 101, 'inertial'), k = tm.length / 3;
    const e0 = A.toInertial(A.moonPos(t - 1, P), t - 1, P), e1 = A.toInertial(A.moonPos(t + 1, P), t + 1, P);
    ok(dist([tm[0], tm[1], tm[2]], e0) < F32 && dist([tm[3 * (k - 1)], tm[3 * (k - 1) + 1], tm[3 * (k - 1) + 2]], e1) < F32, `月轨迹（惯性系）端点＝toInertial(moonPos(t∓1))`);
    if (i > 2) break;
  }
  const t = 55.25, sb = gm.strobe(P, 'sun', t, 360), n = sb.length / 3, h = Math.floor(n / 2);
  ok(dist([sb[3 * h], sb[3 * h + 1], sb[3 * h + 2]], A.sunPos(t, P)) < F32, '每日同刻：中间那点就是此刻');
  let maxXZ = 0;
  for (let i = 0; i < n; i++) maxXZ = Math.max(maxXZ, Math.hypot(sb[3 * i] - sb[0], sb[3 * i + 2] - sb[2]));
  ok(maxXZ < F32, `太阳每天同一时刻落在一条竖线上（水平偏差 ${maxXZ.toExponential(1)} km）`);
  const mb = gm.strobe(P, 'moon', t, 360);
  let worst = 0, turns = 0;
  for (let i = 1; i < 360; i++) {
    const d = wrap(Math.atan2(mb[3 * i + 2], mb[3 * i]) - Math.atan2(mb[3 * i - 1], mb[3 * i - 3]));
    worst = Math.max(worst, Math.abs(d + TAU / P.M)); turns += d / TAU;
  }
  ok(worst < 1e-5, '月每天同刻退 360°/M（Float32 精度内）');
  near(Math.abs(turns), (360 - 1) / P.M, 1e-4, '月的“每日同刻”一年约 12¼ 圈');
}

section('4 塔影楔：切线与塔、日球相切；本影里看不到日面');
{
  let worstA = 0, worstS = 0, sides = true, dirs = true, physU = true, physP = true, arcs = true;
  for (let i = 0; i < 60; i++) {
    const t = rnd() * 1440, S = A.sunPos(t, P), W = gm.shadowWedge(P, S);
    const all = [...W.umbra.map(e => ['u', e]), ...W.penumbra.map(e => ['p', e])];
    for (const [kind, e] of all) {
      const n = e.n, cA = n[0] * e.p[0] + n[2] * e.p[2];                     // 直线 n·x＝a 过切点
      worstA = Math.max(worstA, Math.abs(cA - P.a), Math.abs(Math.hypot(e.p[0], e.p[2]) - P.a));
      const sd = n[0] * S.x + n[2] * S.z - P.a;                              // 日心到直线的有符号距离
      worstS = Math.max(worstS, Math.abs(Math.abs(sd) - P.rhoS));
      if (kind === 'u' ? !(sd < 0) : !(sd > 0)) sides = false;              // 本影：日、塔同侧；半影：异侧
      if (Math.abs(e.dir[0] * n[0] + e.dir[2] * n[2]) > 1e-9 || (e.dir[0] * (e.p[0] - S.x) + e.dir[2] * (e.p[2] - S.z)) <= 0) dirs = false;
      near(e.len, Math.sqrt(P.R * P.R - P.a * P.a), 1e-9, '切线长＝√(R²−a²)') || (i = 999);
      // 内壁上切线的端点（y 任取）：往影里挪 5 km、往外挪 5 km
      const y = (rnd() - 0.5) * P.R, X = [e.p[0] + e.dir[0] * e.len * 0.9, y * 0.3, e.p[2] + e.dir[2] * e.len * 0.9];
      const inn = { x: X[0] - 5 * n[0], y: X[1], z: X[2] - 5 * n[2] }, out = { x: X[0] + 5 * n[0], y: X[1], z: X[2] + 5 * n[2] };
      const fi = A.sunlitAt(inn, t, P), fo = A.sunlitAt(out, t, P);
      if (kind === 'u' && !(fi < 1e-9 && fo > 0)) physU = false;
      if (kind === 'p' && !(fo > 1 - 1e-9 && fi < 1)) physP = false;
      const arc = gm.wedgeArc(e, 9);
      for (let k = 0; k < 9; k++) if (Math.abs(Math.hypot(arc[3 * k], arc[3 * k + 1], arc[3 * k + 2]) - P.R) > F32) arcs = false;
    }
  }
  ok(worstA < 1e-6, `四条边界都与塔相切（离轴距离＝a，最大偏差 ${worstA.toExponential(1)} km）`);
  ok(worstS < 1e-6, `四条边界都与日球相切（日心距＝ρS，最大偏差 ${worstS.toExponential(1)} km）`);
  ok(sides, '本影线：日、塔在同侧（外公切线）；半影线：异侧（内公切线）');
  ok(dirs, 'dir 沿切线、背离太阳');
  ok(physU, '本影线内侧 5 km 看不到日面（HY.astro.sunlitAt＝0），外侧看得到一部分');
  ok(physP, '半影线外侧 5 km 全亮（sunlitAt＝1），内侧已被切掉一部分');
  ok(arcs, '影楔与内壁的交线在球面上（|X|＝R）');
}

section('5 拾取：site → 射线 → pick 往返');
{
  let n = 0, worst = 0, towerNull = 0, towerTried = 0;
  for (let i = 0; i < 400 && n < 150; i++) {
    const s = 700 + rnd() * (Math.PI * P.R - 1400), az = (rnd() - 0.5) * 360, O = A.site(s, az, P), X = [O.x, O.y, O.z];
    // 相机在球外、站点的对侧（剖开近侧时站点落在保留的那一半）
    const dirn = [-X[0] / P.R + (rnd() - 0.5) * 0.6, -X[1] / P.R + (rnd() - 0.5) * 0.6, -X[2] / P.R + (rnd() - 0.5) * 0.6];
    const L = Math.hypot(...dirn), C = dirn.map(v => v / L * P.R * (2.2 + rnd()));
    const clip = C.map(v => v / Math.hypot(...C));
    if (X[0] * clip[0] + X[1] * clip[1] + X[2] * clip[2] > 0) continue;   // 站点在被剖掉的一侧：不在本测试范围
    const d = [X[0] - C[0], X[1] - C[1], X[2] - C[2]], Ld = Math.hypot(...d);
    const blocked = gm.rayTower(C, d.map(v => v / Ld), P.a, gm.TOWER_HALF * P.R) < Ld;
    const r = gm.pick(C, d, P.R, clip, P.a);
    if (blocked) { towerTried++; if (r === null) towerNull++; continue; }
    if (!r) { ok(false, `pick 没打中：s=${s.toFixed(1)} az=${az.toFixed(1)}`); continue; }
    n++;
    const dAz = Math.abs(wrap((r.az - az) * Math.PI / 180)) * O.r;
    worst = Math.max(worst, Math.abs(r.s - s), dAz);
  }
  ok(n >= 100, `有效样本 ${n} 个`);
  ok(worst < 0.5, `往返误差 ${worst.toExponential(2)} km < 0.5 km`);
  ok(towerTried === towerNull, `先撞到塔的射线一律返回 null（${towerNull}/${towerTried}）`);
  // 相机在球内（不剖）也能拾取
  const O = A.site(4000, 2, P), C = [0.2 * P.R, 0.3 * P.R, 0.5 * P.R];
  const r = gm.pick(C, [O.x - C[0], O.y - C[1], O.z - C[2]], P.R, null, P.a);
  ok(r && Math.abs(r.s - 4000) < 0.5 && Math.abs(r.az - 2) < 0.01, '相机在球内（clipN＝null）时也能拾取（伊美忒）');
  // 剖开时射线先穿过被剖掉的近侧，落在远侧
  const Cn = [2.5 * P.R, 0.1 * P.R, 0], dn = [-1, 0, 0.25];
  const rn = gm.pick(Cn, dn, P.R, [1, 0.04, 0].map(v => v / Math.hypot(1, 0.04)), P.a);
  const rf = gm.pick(Cn, dn, P.R, null, P.a);
  ok(rn && rf && Math.abs(rn.az - rf.az) > 90 && Math.cos(rf.az * Math.PI / 180) > 0 && Math.cos(rn.az * Math.PI / 180) < 0, `剖开近侧时跳过近侧交点（方位 ${rn && rn.az.toFixed(1)}°），不剖时取近侧交点（${rf && rf.az.toFixed(1)}°）`);
}

section('6 遮挡判定（标签用）');
{
  const C = [2.6 * P.R, 0.3 * P.R, 0.4 * P.R], Cl = Math.hypot(...C), clip = C.map(v => v / Cl);
  const far = A.site(Math.PI * P.R / 2, 180 + 8.7 + 60, P), nearS = A.site(Math.PI * P.R / 2, 8.7, P);
  const o = { R: P.R, a: P.a, cut: 'half', clipN: clip, onWall: true };
  eq(gm.occluded(C, [far.x, far.y, far.z], o), '', '剖开：远侧内壁上的点看得见');
  eq(gm.occluded(C, [nearS.x, nearS.y, nearS.z], o), 'cut', '剖开：近侧内壁上的点被剖掉');
  eq(gm.occluded(C, [nearS.x, nearS.y, nearS.z], { R: P.R, a: P.a, cut: 'none', clipN: null, onWall: true }), '', '不剖：近侧外壁上的点看得见');
  eq(gm.occluded(C, [far.x, far.y, far.z], { R: P.R, a: P.a, cut: 'none', clipN: null, onWall: true }), 'wall', '不剖：远侧的点被近侧内壁挡住');
  eq(gm.occluded(C, [far.x, far.y, far.z], { R: P.R, a: P.a, cut: 'ghost', clipN: clip, onWall: true }), '', '半透明：远侧看得见');
  const behind = [-2 * P.a * C[0] / Cl, 0.3 * P.R * 0.1, -2 * P.a * C[2] / Cl];
  eq(gm.occluded(C, behind, { R: P.R, a: P.a, cut: 'half', clipN: clip }), 'tower', '塔后的点被塔挡住');
}

section('7 惯性系转角');
{
  const tests = [0, 1, 123.4567, 1e4, 1e5, -3.3e4];
  let worst = 0;
  for (const t of tests) {
    const q = A.toInertial({ x: 1, y: 0, z: 0 }, t, P), direct = Math.atan2(q.z, q.x);
    worst = Math.max(worst, Math.abs(wrap(gm.spin(P, t) - direct)));
    ok(gm.spin(P, t) >= 0 && gm.spin(P, t) < TAU, `spin(${t}) ∈ [0, 2π)`);
  }
  ok(worst < 1e-9, `spin 与 HY.astro.toInertial 的转角相差 ${worst.toExponential(1)} rad < 1e-9（含 t＝10⁵ 日）`);
  // 惯性系里把地固系的点转 spin，就是 toInertial
  const t = 1e5, S = A.sunPos(t, P), q = rotY([S.x, S.y, S.z], gm.spin(P, t)), r = A.toInertial(S, t, P);
  ok(dist(q, r) < 1e-5, '地固系的日心绕 y 转 spin(t)＝toInertial(日心)（t＝10⁵）');
}

section('8 管子网格');
{
  const h = gm.helix(P, 'moon', 12, 1), tb = gm.tube(h.pos, 22, 8), nv = h.u.length * 8;
  eq(tb.position.length, 3 * nv, '顶点数＝中心线点数×每圈 8');
  eq(tb.index.length, (h.u.length - 1) * 8 * 6, '三角形数');
  let maxI = 0, badN = 0, badR = 0;
  for (let i = 0; i < tb.index.length; i++) maxI = Math.max(maxI, tb.index[i]);
  for (let v = 0; v < nv; v++) {
    const nx = tb.normal[3 * v], ny = tb.normal[3 * v + 1], nz = tb.normal[3 * v + 2];
    if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-5) badN++;
    const c = tb.src[v], dx = tb.position[3 * v] - h.pos[3 * c], dy = tb.position[3 * v + 1] - h.pos[3 * c + 1], dz = tb.position[3 * v + 2] - h.pos[3 * c + 2];
    if (Math.abs(Math.hypot(dx, dy, dz) - 22) > 1e-3) badR++;
  }
  ok(maxI < nv, '索引不越界');
  eq(badN, 0, '法线都是单位向量');
  eq(badR, 0, '管壁离中心线恰为半径');
  const big = gm.tube(gm.helix(P, 'sun', 48, 1).pos, 10, 8);
  ok(big.index instanceof Uint16Array || big.index instanceof Uint32Array, '48 圈的管子索引类型：' + big.index.constructor.name);
  ok(gm.helix(P, 'sun', 12, 1).pos[0] - P.dS < 1e-9, '日螺旋在 u＝0 处离轴 dS（gapX＝1）');
  // 日螺旋管不碰塔（离轴 640、管半径 10）
  ok(P.dS - 10 > P.a, '日螺旋管（半径 10 km）不穿进塔');
}

section('9 镜头预设与入冬镜头');
{
  const O = A.site(6670, -4, P), S = A.sunPos(0.3, P), Mo = A.moonPos(0.3, P), wS = A.sunPos(0, P), wM = A.moonPos(0, P);
  const c = { aspect: 1.6, site: [O.x, O.y, O.z], S: [S.x, S.y, S.z], Mo: [Mo.x, Mo.y, Mo.z], wS: [wS.x, wS.y, wS.z], wMo: [wM.x, wM.y, wM.z] };
  for (const name of gm.PRESETS) {
    const p = gm.presetPose(name, P, c);
    ok(p.pos.concat(p.target).every(Number.isFinite), `预设 ${gm.PRESET_NAMES[name]}：位姿是有限数`);
    const d = Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1], p.pos[2] - p.target[2]);
    ok(d >= 1.2 && d <= 90, `预设 ${gm.PRESET_NAMES[name]}：距离 ${d.toFixed(2)} 在 OrbitControls 的 1.2–90 之内`);
  }
  const ob = gm.presetPose('oblique', P, c);
  near(Math.hypot(...ob.pos), Math.hypot(1.7, 0.62, 1.4) * P.R / 1000, 1e-9, '斜看：离球心 |(1.7, 0.62, 1.4)|·R');
  near(ob.pos[1], 0.62 * P.R / 1000, 1e-9, '斜看：塔根半球的地点从上方 0.62R 看');
  const dAz = deg => ((deg % 360) + 540) % 360 - 180;
  near(dAz(Math.atan2(ob.pos[2], ob.pos[0]) * 180 / Math.PI - (-4 + 180 + gm.OBLIQUE_TURN)), 0, 1e-9, '斜看：相机在地点方位 +180°（再转 39.5°）——从地点的背面看进去，地点不被剖掉');
  const sd = gm.presetPose('side', P, c);
  near(dAz(Math.atan2(sd.pos[2], sd.pos[0]) * 180 / Math.PI - (-4 + 180 + gm.SIDE_TURN)), 0, 1e-9, '侧看：相机在地点方位 +180°（再转 30°，地点不藏在塔后）');
  // 侧看给了预设地点表时：塔后那条方位离每个地点（含此地）都至少 20°（罪域看过去，涅赫莱恩 25° 原先正藏在塔后）
  {
    const W = HY.world, azs = W.SITES.map(q => q.az);
    for (const q of W.SITES) {
      const Oq = A.site(typeof q.s === 'function' ? q.s(P) : q.s, q.az, P);
      const pq = gm.presetPose('side', P, { aspect: 1.6, site: [Oq.x, Oq.y, Oq.z], sitesAz: azs });
      const hid = Math.atan2(pq.pos[2], pq.pos[0]) * 180 / Math.PI + 180;
      const gap = Math.min(...azs.map(x => Math.abs(dAz(x - hid))));
      ok(gap >= 20, `侧看·${q.short}：塔后方位离最近的预设地点 ${gap.toFixed(1)}°（≥20°）`);
    }
    eq(gm.sideTurn(-4, azs), -30, '侧看·罪域：改往 −30° 转（+30° 时涅赫莱恩藏在塔后）');
    eq(gm.sideTurn(25, azs), 30, '侧看·涅赫莱恩：仍往 +30° 转');
  }
  const tall = gm.presetPose('oblique', P, { aspect: 0.5, site: c.site });
  ok(Math.hypot(...tall.pos) > Math.hypot(...ob.pos), '竖屏时拉远（k 随宽高比放大）');
  // 此地上空：八个预设地点、横竖两种画面——相机在球内、不在塔里；地点与它旁边的塔面都在画框里
  function scr(p, X, aspect) {
    const C3 = p.pos.map(v => v * 1000), T = p.target.map(v => v * 1000), f = T.map((v, i) => v - C3[i]), fl = Math.hypot(...f);
    const F = f.map(v => v / fl), Rt = [F[2], 0, -F[0]], rl = Math.hypot(...Rt), Rn = Rt.map(v => v / rl);
    const Up = [Rn[1] * F[2] - Rn[2] * F[1], Rn[2] * F[0] - Rn[0] * F[2], Rn[0] * F[1] - Rn[1] * F[0]];
    const d = X.map((v, i) => v - C3[i]), z = d[0] * F[0] + d[1] * F[1] + d[2] * F[2], th = Math.tan((p.fov || 38) * Math.PI / 360);
    return z <= 0 ? [9, 9] : [(d[0] * Rn[0] + d[1] * Rn[1] + d[2] * Rn[2]) / z / (th * aspect), (d[0] * Up[0] + d[1] * Up[1] + d[2] * Up[2]) / z / th];
  }
  for (const aspect of [1.6, 1.31, 0.46]) {
    for (const q of HY.world.siteList(P)) {
      const Os = A.site(q.s, q.az, P), p = gm.presetPose('above', P, { aspect, site: [Os.x, Os.y, Os.z] });
      const Ck = p.pos.map(v => v * 1000), rOs = Math.hypot(Os.x, Os.z);
      const Q = [Os.x / rOs * P.a * 1.05, Os.y, Os.z / rOs * P.a * 1.05];
      const so = scr(p, [Os.x, Os.y, Os.z], aspect), sq = scr(p, Q, aspect);
      ok(Math.hypot(...Ck) < 0.93 * P.R && Math.hypot(Ck[0], Ck[2]) > 1.2 * P.a && Math.abs(so[0]) < 0.95 && Math.abs(so[1]) < 0.95 && Math.abs(sq[0]) < 0.95 && Math.abs(sq[1]) < 0.95,
        `此地上空（${q.short}，宽高比 ${aspect}）：相机在球内（${(Math.hypot(...Ck) / P.R).toFixed(2)}R）；地点 ${so.map(v => v.toFixed(2))}、塔面 ${sq.map(v => v.toFixed(2))} 都在画框里`);
    }
  }
  const ab = gm.presetPose('above', P, c);
  ok(ab.fov >= 45 && ab.fov <= 75, '此地上空：视角放宽（球腔里退不远）：' + ab.fov + '°');
  const wv = gm.presetPose('winter', P, c), dx = wS.x - wM.x, dz = wS.z - wM.z;
  near((wv.pos[0] * dx + wv.pos[2] * dz) / Math.hypot(dx, dz) / Math.hypot(wv.pos[0], wv.pos[2]), 0, 1e-9, '入冬镜头：视线垂直于交节时的日月连线');
  near(Math.hypot(wv.pos[0], wv.pos[2]), 2.4 * P.R / 1000, 1e-9, '入冬镜头：离轴 2.4R、塔腰高度');
  const sv = gm.presetPose('sun', P, c);
  near(sv.target[1], S.y / 1000, 1e-12, '跟随太阳：目标 (0, yS, 0)');
  near(Math.atan2(sv.pos[2], sv.pos[0]), Math.atan2(S.z, S.x), 1e-9, '跟随太阳：在太阳方位外');

  const w0 = gm.winterNear(P, 3), w1 = gm.winterNear(P, 360 - 2), w2 = gm.winterNear(P, 720), w3 = gm.winterNear(P, 1080);
  ok(w0.N === 10018 && w0.festival && w0.t === 0 && /三点一线/.test(w0.phrase), '10018 年入冬：庆典，三点一线');
  ok(w1.N === 10019 && !w1.festival && w1.phrase === '今年月在日西 90°', '10019 年入冬：“今年月在日西 90°”');
  ok(w2.N === 10020 && w2.phrase === '今年月与日同侧', '10020 年入冬：“今年月与日同侧”');
  ok(w3.N === 10021 && w3.phrase === '今年月在日东 90°', '10021 年入冬：“今年月在日东 90°”');
  eq(w0.title, '入冬：日升月降，交于塔腰', '入冬镜头的标题');
  // 三点一线画哪一次交节（geom.winterFor）：当年的；当年的不是庆典、而一日之内有庆典交节时画那一次
  {
    const a = gm.winterFor(P, 10018, -200);
    ok(a.N === 10018 && a.t === 0 && a.festival, 'winterFor：10018 年（交节前 200 日）画本年交节，是庆典');
    const b = gm.winterFor(P, 10019, 100);
    ok(b.N === 10019 && !b.festival && b.t === P.Y, 'winterFor：10019 年画本年交节，不是庆典');
    // 年号在交节当场换号的口径：交节前半日算 10017 年、后半日算 10019 年（'winterEnd'），白线仍要整段亮着
    const c = gm.winterFor(P, 10017, -0.4), d = gm.winterFor(P, 10019, 0.4);
    ok(c.N === 10018 && c.festival && c.t === 0, 'winterFor：交节前 0.4 日、年号 10017 → 改画一日内的 10018 庆典交节');
    ok(d.N === 10018 && d.festival && d.t === 0, 'winterFor：交节后 0.4 日、年号 10019 → 改画一日内的 10018 庆典交节');
    const e = gm.winterFor(P, 10017, -3);
    ok(e.N === 10017 && !e.festival, 'winterFor：离庆典交节超过一日不改画（仍是本年的非庆典交节）');
    const f = gm.winterFor(P, 10019, P.Y - 0.3);
    ok(f.N === 10019 && !f.festival, 'winterFor：一日内的交节不是庆典时不改画');
    // 与 HY.world 的年号口径联动：三种口径下，入冬镜头（交节前后各半日）里每个时刻都画 10018 年的庆典交节
    const W = HY.world, keep = W.CAL.yearStart;
    for (const ys of ['civil', 'winter', 'winterEnd']) {
      W.CAL.yearStart = ys;
      let all = true;
      for (let k = 0; k <= 20; k++) {
        const t = -0.5 + k / 20, N = HY.calc.civil(t, P.epochAz, P).N, w = gm.winterFor(P, N, t);
        if (!(w.festival && w.N === 10018)) all = false;
      }
      ok(all, `年号口径 ${ys}：入冬镜头里每一刻都画 10018 年的庆典交节`);
    }
    W.CAL.yearStart = keep;
  }
  // 庆典交节那一刻：日、塔轴、月三点一线（水平投影共线且在塔两侧）
  const cr = wS.x * wM.z - wS.z * wM.x, dt = wS.x * wM.x + wS.z * wM.z;
  ok(Math.abs(cr) < 1e-6 * P.dS * P.rM && dt < 0, '庆典交节：日、塔轴、月三点一线（日月在塔两侧）');
  ok(Math.abs(wS.y) < 1e-9 && Math.abs(wM.y) < 1e-9, '庆典交节：日月都在塔腰');
}

section('10 ov_occl.glsl 与 common.glsl 的遮挡函数逐字一致');
{
  function fnBody(src, name) {
    const i = src.indexOf('float ' + name + '(');
    if (i < 0) return null;
    let depth = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
    }
    return null;
  }
  const g = HY.glsl;
  for (const f of ['towerVis', 'eclipseVis']) {
    const a = fnBody(g.common, f), b = fnBody(g.ov_occl, f);
    ok(a && b && a === b, `${f}：ov_occl.glsl 与 common.glsl 一致（去注释与空白）`);
  }
  ok(/#define PI/.test(g.ov_occl) && /float sq\(/.test(g.ov_occl) && /uniform float uA;/.test(g.ov_occl), 'ov_occl.glsl 带 PI、sq()、uniform float uA');
  // 总览着色器齐全，且都不是桩
  const need = ['ov_common', 'ov_occl', 'ov_shell_vert', 'ov_shell', 'ov_tower', 'ov_moon', 'ov_helix_vert', 'ov_helix', 'ov_wedge', 'ov_present',
    'ov_obj_vert', 'ov_line_vert', 'ov_line', 'ov_glow'];
  for (const k of need) ok(typeof g[k] === 'string' && !/【桩】/.test(g[k]), `HY.glsl.${k} 在且不是桩`);
  // GLSL1 写法：总览着色器里不写 #version、不用 layout／in／out 声明
  for (const k of Object.keys(g).filter(k => /^ov_/.test(k))) {
    ok(!/#version|layout\s*\(|^\s*(in|out)\s+\w/m.test(g[k]), `${k}：GLSL1 写法（three 自己补 #version 与兼容宏）`);
  }
  // 片元着色器里用到的 ov_occl 函数，材质拼接时必须带上 ov_occl
  for (const k of ['ov_shell', 'ov_tower', 'ov_moon']) ok(/towerVis|eclipseVis|uSunW/.test(g[k]), `${k} 用到遮挡函数或日心（overview 拼接时带 ov_occl）`);
}

T.done();
