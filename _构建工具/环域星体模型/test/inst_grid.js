#!/usr/bin/env node
/* test/inst_grid.js —— 实例层的格网与 uniform（规格：spec/02 第九节、第十五节第 1 条；负责：F 路）
 * fp/instances.js 不是节点模块（build/draw 要 THREE），但加载时不碰 THREE，这里用 vm 单独载入，只测纯数据部分：
 *   1. uInstGrid：相机所在格的全局格号（mod 65536）与格原点偏移 zw∈(−格宽, 0]，与 cam.chart() 一致；
 *   2. 实例不游动：相机走 1 km（逐 10 m），同一个全局格里的实例在图表上的绝对位置不变（＜1e-9 km）；
 *   3. 局部格表 cells()：相机落在格内任何位置时，半径内的格一个不漏；近、远两档 LOD 的格表合起来覆盖整圈；
 *   4. 各档数量与 02 第九节的表同一量级；近城才有阶沿墙；
 *   5. 着色器接口：inst.vert 新增的 uniform 都已登记（写入方 'inst'）；inst.frag 不声明新 uniform；in／out 名字一一对上。
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const load = require('./_load.js');
const HY = load();
const T = load.tester('inst_grid');
const { ok, near, eq, section } = T;
vm.runInThisContext(fs.readFileSync(path.join(load.SRC, 'fp/instances.js'), 'utf8'), { filename: 'fp/instances.js' });
const I = HY.fp.inst, P = HY.astro.params(), K = HY.fp.cam, G = HY.glsl;
const camReal = K && typeof K.create === 'function' && typeof K.create(P, { s: 6670, az: -4 }).chart === 'function';
const FPS = { eye: 1.6, yaw: 0, pitch: 0, fov: 55, bob: false, ground: { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 } };
const ZONES = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };
const wrap16 = d => ((d % 65536) + 65536 + 32768) % 65536 - 32768;

section('1 uInstGrid 与相机图表坐标一致');
if (camReal) {
  const cam = K.create(P, { s: 6670, az: -4 }, FPS, { zones: ZONES });
  const v = I.values(cam, P, 0, 'mid'), c = cam.chart();
  for (let t = 0; t < 4; t++) {
    const T0 = I.TYPES[t], gr = v.uInstGrid[t], cw = T0.cell;
    ok(Number.isInteger(gr[0]) && Number.isInteger(gr[1]) && gr[0] >= 0 && gr[0] < 65536 && gr[1] >= 0 && gr[1] < 65536, `${T0.name}：格号是 [0, 65536) 的整数`);
    ok(gr[2] > -cw - 1e-12 && gr[2] <= 1e-12 && gr[3] > -cw - 1e-12 && gr[3] <= 1e-12, `${T0.name}：格原点偏移在 (−${cw * 1000} m, 0]`);
    near(((Math.floor(c[0] / cw) % 65536) + 65536) % 65536, gr[0], 0, `${T0.name}：东向格号＝floor(c/格宽) mod 65536`);
  }
} else console.log('  （fp/camera.js 还没有 chart()，跳过）');

section('2 实例不游动：相机走 1 km，固定实例的图表位置不变');
if (camReal) {
  for (const mode of ['terrace', 'slope']) for (const dir of ['北', '东']) {
    const fps = Object.assign({}, FPS, { ground: Object.assign({}, FPS.ground, { mode }) });
    const cam = K.create(P, { s: 6670, az: -4 }, fps, { zones: ZONES });
    const v0 = JSON.parse(JSON.stringify(I.values(cam, P, 0, 'mid'))), c0 = cam.chart();
    // 每类取相机周围 5 个固定的全局格（相对出发时的局部格号）
    const track = [];
    for (let t = 0; t < 4; t++) for (const [i, j] of [[0, 0], [3, -2], [-7, 5], [12, 1], [-4, -9]]) {
      const g0 = v0.uInstGrid[t], cw = I.TYPES[t].cell;
      track.push({ t, gx: (g0[0] + i + 65536) % 65536, gy: (g0[1] + j + 65536) % 65536, pos: [c0[0] + g0[2] + i * cw, c0[1] + g0[3] + j * cw] });
    }
    let worst = 0;
    for (let k = 0; k < 100; k++) {
      cam.nudge(dir === '北' ? 0.01 : 0, dir === '东' ? 0.01 : 0); cam.compute();
      const v = I.values(cam, P, 0, 'mid'), c = cam.chart();
      for (const tr of track) {
        const g1 = v.uInstGrid[tr.t], cw = I.TYPES[tr.t].cell;
        const li = wrap16(tr.gx - g1[0]), lj = wrap16(tr.gy - g1[1]);           // 这个全局格现在的局部格号
        const px = c[0] + g1[2] + li * cw, py = c[1] + g1[3] + lj * cw;
        worst = Math.max(worst, Math.abs(px - tr.pos[0]), Math.abs(py - tr.pos[1]));
      }
    }
    ok(worst < 1e-9, `${mode === 'terrace' ? '阶地' : '斜坡'}·向${dir}走 1 km：20 个固定格的图表位置最大漂移 ${(worst * 1e6).toExponential(2)} mm`);
  }
} else console.log('  （fp/camera.js 还没有 nudge/chart，跳过）');

section('3 局部格表 cells()：不漏格、LOD 两档合起来盖满');
{
  for (const T0 of I.TYPES) {
    const cw = T0.cell, rad = 0.3, split = T0.split || 0;
    const all = I.cells(cw, 1, 0, rad), set = new Set();
    for (let k = 0; k < all.length; k += 3) set.add(all[k] + ',' + all[k + 1]);
    let miss = 0;
    for (let trial = 0; trial < 50; trial++) {
      const ox = -Math.random() * cw, oy = -Math.random() * cw, n = Math.ceil(rad / cw) + 2;
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) for (const [hx, hy] of [[0, 0], [0.999, 0.999], [0.5, 0], [0, 0.7]]) {
        const d = Math.hypot(ox + (i + hx) * cw, oy + (j + hy) * cw);
        if (d <= rad && !set.has(i + ',' + j)) miss++;
      }
    }
    eq(miss, 0, `${T0.name}：半径 300 m 内的格一个不漏（格宽 ${cw * 1000} m）`);
    if (split) {
      const nearC = I.cells(cw, 1, 0, Math.min(rad, split)), farC = I.cells(cw, 1, split, rad), u = new Set();
      for (let k = 0; k < nearC.length; k += 3) u.add(nearC[k] + ',' + nearC[k + 1]);
      for (let k = 0; k < farC.length; k += 3) u.add(farC[k] + ',' + farC[k + 1]);
      let lost = 0; set.forEach(key => { if (!u.has(key)) lost++; });
      eq(lost, 0, `${T0.name}：近（${split * 1000} m 内）、远两档格表合起来盖满`);
    }
  }
}

section('4 各档数量；近城才有阶沿墙');
{
  const want = { mid: { rock: 4000, grass: 8000, wood: 300, wall: 200 } };
  const R = I.radii('mid');
  for (const T0 of I.TYPES) {
    const r = R[T0.tierKey] / 1000;
    const n = I.cells(T0.cell, T0.per, 0, r).length / 3;
    const inCircle = Math.PI * r * r / (T0.cell * T0.cell) * T0.per;
    const w = want.mid[T0.id];
    if (T0.id === 'wall') {   // 墙只落在崖沿那一条带上：格表是上限，实际段数＝崖沿长度/20 m
      ok(n >= 2 * r / T0.cell, `中档${T0.name}：格表 ${n} 格，够盖住半径内最长的崖沿（${Math.round(2 * r / T0.cell)} 段）`);
      continue;
    }
    ok(inCircle > w * 0.5 && inCircle < w * 2.5, `中档${T0.name}：半径 ${r * 1000} m 内约 ${Math.round(inCircle)} 个位置（02 第九节：约 ${w}；格表 ${n}，按域与坡度再筛）`);
  }
  eq(Object.keys(I.radii('low')).join(','), 'rock', '低档只有碎石');
  ok(I.radii('high').rock === 2 * I.radii('mid').rock, '高档半径加倍');
  if (camReal) {
    const at = (s, az) => I.nearSettlement(K.create(P, { s, az }, FPS, { zones: ZONES }), P);
    ok(at(6670, -4) && at(3600, 0) && at(4000, 2), '罪域、圣禁城、伊美忒 30 km 内算近城');
    ok(!at(2000, 0) && !at(6670 + 60, -4), '轻域、离罪域 60 km 不算近城');
    const v = I.values(K.create(P, { s: 2000, az: 0 }, FPS, { zones: ZONES }), P, 0, 'mid');
    eq(v.uInstPar[3][3], 0, '远离城镇时阶沿墙关（uInstPar[3].w＝0）');
  }
}

section('5 着色器接口');
{
  const parse = HY.fp.parseUniforms;
  const vNames = parse(G.inst_vert || '').map(u => u.name);
  for (const n of ['uInstGrid', 'uInstPar', 'uInstTime']) {
    const info = HY.fp.uniformInfo(n);
    ok(vNames.includes(n) && info && info.writer === 'inst', `${n}：inst.vert 声明、已登记（写入方 inst）`);
  }
  ok(HY.fp.uniformInfo('uInstGrid').type === 'vec4[4]' && HY.fp.uniformInfo('uInstPar').type === 'vec4[4]', 'uInstGrid、uInstPar 是 vec4[4]');
  for (const u of parse(G.inst_vert || '')) ok(!!HY.fp.uniformInfo(u.name), `inst.vert 的 ${u.name} 在 UNIFORMS 表里`);
  eq(parse(G.inst || '').length, 0, 'inst.frag 不声明 uniform（contract_check 按片元查表，不认实例自己的名字）');
  const outs = [...(G.inst_vert || '').matchAll(/^out\s+\w+\s+(\w+);/gm)].map(m => m[1]).sort();
  const ins = [...(G.inst || '').matchAll(/^in\s+\w+\s+(\w+);/gm)].map(m => m[1]).sort();
  eq(outs.join(','), ins.join(','), `顶点 out 与片元 in 一一对上（${outs.join('、')}）`);
  ok(!/\bvarying\b/.test((G.inst_vert || '').replace(/\/\/.*$/gm, '')) && !/\bvarying\b/.test((G.inst || '').replace(/\/\/.*$/gm, '')), '不用 varying');
  const d = HY.fp.passes.DEFS;
  ok(!d.inst.stub && !d.gen_height_d.stub && !d.bake_world.stub, 'DEFS 里 inst、gen_height_d、bake_world 不标“桩”');
  ok(!/^\s*\/\/\s*【桩】/.test(G.inst_vert) && !/^\s*\/\/\s*【桩】/.test(G.inst) && !/^\s*\/\/\s*【桩】/.test(G.gen_height_d) && !/^\s*\/\/\s*【桩】/.test(G.bake_world), '四个着色器都不是桩');
  ok(!I.__stub && typeof I.build === 'function' && typeof I.draw === 'function' && typeof I.dispose === 'function', 'HY.fp.inst 有 build、draw、dispose');
}

/* 6. 阶沿墙的放置（用 fp/ground.js 的镜像逐行复刻 inst.vert 第 3 类）：每个 20 m 格只放本格里那一截崖沿，
 *    相邻格首尾相接——崖沿上几乎每处恰被一堵墙盖住（随机空一成五），不在同一处叠两堵（旧写法“离格心 12 m 内都放、一律 20 m 长”叠了三到四成）。 */
section('6 阶沿墙：每段崖沿只归一格，首尾相接');
{
  const g = HY.fp.ground, N = HY.fp.noise, H = [0, 0, 0];
  const vsrc = G.inst_vert || '';
  ok(/abs\(df\) > 1\.5\*cw\*gl/.test(vsrc) && /s1 - s0 < 0\.002/.test(vsrc) && /\(s1 - s0\)\*1000\.0\/20\.0/.test(vsrc), 'inst.vert 的阶沿墙按格裁段、按段长伸缩（本测试复刻的写法）');
  const h3 = (x, y, z) => { N.pcg3(x, y, z, H); return [(H[0] >>> 8) / 16777216, (H[1] >>> 8) / 16777216, (H[2] >>> 8) / 16777216]; };
  function walls(S, rad) {
    const cw = I.TYPES[3].cell, c = S.chart, ix = Math.floor(c[0] / cw), iy = Math.floor(c[1] / cw), z = [ix * cw - c[0], iy * cw - c[1]];
    const gx = ((ix % 65536) + 65536) % 65536, gy = ((iy % 65536) + 65536) % 65536, cells = I.cells(cw, 1, 0, rad), out = [];
    for (let q = 0; q < cells.length; q += 3) {
      const i = cells[q], j = cells[q + 1], dc = [z[0] + (i + 0.5) * cw, z[1] + (j + 0.5) * cw];
      if (Math.hypot(dc[0], dc[1]) > rad || h3((gx + i + 65536) & 65535, (gy + j + 65536) & 65535, 7919 + 48)[2] > 0.85) continue;
      const v0 = g.chartToV(S, dc), X0 = [S.uCamW[0] + v0[0], S.uCamW[1] + v0[1], v0[2]], r0 = Math.hypot(X0[0], X0[2]);
      g.altAt(S, v0, 1e-3, 1);
      const U = g.last.U, gu = [g.duDt(S, v0, [X0[2] / r0, 0, -X0[0] / r0]), g.duDt(S, v0, [0, -1, 0])], gl = Math.hypot(gu[0], gu[1]);
      if (gl < 1e-4) continue;
      let df = S.uCliffC + 0.01 - U; df -= Math.floor(df + 0.5);
      if (Math.abs(df) > 1.5 * cw * gl) continue;
      const tc = [-gu[1] / gl, gu[0] / gl], pl = [dc[0] + df / gl * gu[0] / gl, dc[1] + df / gl * gu[1] / gl], co = [z[0] + i * cw, z[1] + j * cw];
      let s0 = -1e9, s1 = 1e9;
      for (let k = 0; k < 2; k++) {
        if (Math.abs(tc[k]) > 1e-6) { const a = (co[k] - pl[k]) / tc[k], b = (co[k] + cw - pl[k]) / tc[k]; s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b)); }
        else if (pl[k] < co[k] || pl[k] >= co[k] + cw) s1 = -1e9;
      }
      if (s1 - s0 < 0.002) continue;
      const m = 0.5 * (s0 + s1), p = [pl[0] + tc[0] * m, pl[1] + tc[1] * m];
      g.altAt(S, g.groundPoint(S, p));
      if (Math.abs(g.last.U - S.uCliffC - 0.01) > 0.004) continue;
      out.push({ p, tc, len: s1 - s0, U: g.last.U });
    }
    return out;
  }
  // 崖沿（相位＝c＋0.01 的线）：每 3 m 一条南北线，粗扫 20 m、二分到 1 cm 找穿越点；数每个点被几堵墙盖住
  function coverage(S, W, rad) {
    const tgt = S.uCliffC + 0.01, uAt = (x, y) => { g.altAt(S, g.chartToV(S, [x, y]), 1e-3, 1); return g.last.U + g.last.K - tgt; };
    let tot = 0, cov = 0, multi = 0;
    for (let x = -rad + 0.0015; x < rad; x += 0.003) {
      let ya = -rad, ua = uAt(x, ya);
      for (let yb = -rad + 0.02; yb <= rad + 1e-9; yb += 0.02) {
        const ub = uAt(x, yb);
        if (Math.floor(ua) !== Math.floor(ub)) {
          let lo = ya, hi = yb, fl = Math.floor(ua);
          for (let it = 0; it < 11; it++) { const mid = 0.5 * (lo + hi); if (Math.floor(uAt(x, mid)) === fl) lo = mid; else hi = mid; }
          const y = 0.5 * (lo + hi);
          if (Math.hypot(x, y) < rad - 0.03) {
            tot++;
            let n = 0;
            for (const w of W) { const dx = x - w.p[0], dy = y - w.p[1]; if (Math.abs(dx * w.tc[0] + dy * w.tc[1]) <= w.len / 2 + 1e-4 && Math.abs(-dx * w.tc[1] + dy * w.tc[0]) < 0.003) n++; }
            if (n) cov++; if (n > 1) multi++;
          }
        }
        ya = yb; ua = ub;
      }
    }
    return { tot, cov: cov / Math.max(tot, 1), multi: multi / Math.max(tot, 1) };
  }
  for (const [name, s, az] of [['罪域', 6670.4, -4], ['圣禁城', 3600, 0], ['伊美忒', 4000.4, 2]]) {
    const S = g.makeState(P, s, az, { mode: 'terrace', W: 0.8 }, {}), W = walls(S, 0.3), cv = coverage(S, W, 0.3);
    const lens = W.map(w => w.len * 1000);
    ok(cv.tot > 60 && W.length > 8, `${name}（踏面宽 0.8 km、半径 300 m）：${W.length} 段墙，崖沿取样 ${cv.tot} 点`);
    ok(cv.cov > 0.72 && cv.cov < 0.95, `${name}：崖沿被墙盖住 ${(cv.cov * 100).toFixed(0)}%（随机空一成五，另有擦角的短截留给邻格）`);
    ok(cv.multi < 0.04, `${name}：两堵墙叠在同一处的只占 ${(cv.multi * 100).toFixed(1)}%`);
    ok(Math.min(...lens) >= 2 && Math.max(...lens) <= 28.3, `${name}：每段长 ${Math.min(...lens).toFixed(1)}–${Math.max(...lens).toFixed(1)} m（≤ 格的对角线）`);
    ok(W.every(w => Math.abs(w.U - S.uCliffC - 0.01) <= 0.004), `${name}：墙都在崖沿内侧（相位 c＋0.01±0.004）`);
  }
}

T.done();
