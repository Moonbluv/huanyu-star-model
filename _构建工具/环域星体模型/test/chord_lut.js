#!/usr/bin/env node
/* test/chord_lut.js —— 弦表 W(α_w, z)（lut_tau.frag）的 CPU 复刻与沿弦直接积分对拍（规格：spec/02 第七节第 3 条、第十八节；负责：E 路）
 *
 * 1. 着色器没漂移：lut_tau.frag 与 common.glsl 的 chordW 去空白后与本文件抄的一致（改了着色器要同步改这里）；
 * 2. 复刻 lut_tau.frag 的 192 步二次加密积分（双精度），在纹素中心与沿弦直接积分（4 万步）比，相对差 < 1%（含掠射弦）；
 * 3. 按 chordW 的取样方式（√ 映射、半纹素偏移、双线性）在随机 (α, z) 处查表，与直接积分比，相对差 < 3%；
 * 4. 量纲：竖直气柱的绿光光学厚度＝β_R·H_R＋(β_Ms＋β_Ma)·H_M（默认 0.58，02 第二节第 1 条）；
 * 5. 透射 transCam 的“过了弦中点用 2W(顶)−W(z)”与直接积分一致（相机在壁面、斜着看到对面壁）。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('chord_lut');
const { section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const G = HY.glsl, S = HY.fp.set;

const squash = s => (s || '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
const LUT_MAIN = `void main(){
  vec2 uv = clamp((gl_FragCoord.xy/uTauSize - 0.5/uTauSize)/(1.0 - 1.0/uTauSize), 0.0, 1.0);
  float al = uv.x*uv.x*0.5*PI;
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  float z = uv.y*uv.y*zmax;
  float b = uR*cos(al), xR = uR*sinS(al);
  float xz = sqrt(max(xR*xR - z*(2.0*uR - z), 0.0));
  float span = z*(2.0*uR - z)/max(xR + xz, 1e-6);
  vec3 tau = vec3(0.0);
  const int N = 192;
  for (int i = 0; i < N; i++){
    float s0 = float(i)/float(N), s1 = float(i + 1)/float(N), sm = 0.5*(s0 + s1);
    float dx = span*(sq(1.0 - s0) - sq(1.0 - s1));
    float dxR = span*sq(1.0 - sm), x = xR - dxR;
    float zz = dxR*(xR + x)/(uR + sqrt(b*b + x*x));
    tau += (uBetaR*exp(-zz/uHR) + vec3((uBetaMs + uBetaMa)*exp(-zz/uHM)))*dx;
  }
  oc = vec4(tau, 1.0);
}`;
const CHORDW = `vec3 chordW(float al, float z){
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  vec2 uv = vec2(sqrt(clamp(al/(0.5*PI), 0.0, 1.0)), sqrt(clamp(z/max(zmax, 1e-6), 0.0, 1.0)));
  return textureLod(uTau, uv*(1.0 - 1.0/uTauSize) + 0.5/uTauSize, 0.0).rgb;
}`;
function fnSrc(src, sig) {
  const i = src.indexOf(sig); if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return null;
}

section('1 着色器源码没有漂移');
ok(squash(fnSrc(G.lut_tau, 'void main()')) === squash(LUT_MAIN), 'lut_tau.frag 的 main 与本文件的复刻一致');
ok(squash(fnSrc(G.common, 'vec3 chordW(')) === squash(CHORDW), 'common.glsl 的 chordW 与本文件的复刻一致');

/* 参数：取 settings 的默认（H_R 40、H_M 6、V 200） */
const P = HY.astro.params();
const st = HY.state;
const V = S.values(st, P);
const R = V.uR, Ztop = V.uZtop, HR = V.uHR, HM = V.uHM, BR = V.uBetaR, BM = V.uBetaMs + V.uBetaMa;
const sinS = x => Math.sin(x);
const sigma = z => BR.map(b => b * Math.exp(-z / HR) + BM * Math.exp(-z / HM));

// 复刻 lut_tau.frag（双精度）
function lutCell(al, z) {
  const zmax = Math.min(Ztop, 2 * R * Math.pow(sinS(0.5 * al), 2));
  const b = R * Math.cos(al), xR = R * sinS(al);
  const xz = Math.sqrt(Math.max(xR * xR - z * (2 * R - z), 0));
  const span = z * (2 * R - z) / Math.max(xR + xz, 1e-6);
  const tau = [0, 0, 0], N = 192;
  for (let i = 0; i < N; i++) {
    const s0 = i / N, s1 = (i + 1) / N, sm = 0.5 * (s0 + s1);
    const dx = span * ((1 - s0) ** 2 - (1 - s1) ** 2);
    const dxR = span * (1 - sm) ** 2, x = xR - dxR;
    const zz = dxR * (xR + x) / (R + Math.sqrt(b * b + x * x));
    const sg = sigma(zz);
    for (let c = 0; c < 3; c++) tau[c] += sg[c] * dx;
  }
  return { tau, zmax };
}
// 沿弦直接积分：弦上离内壁端 s 处离球心 √(b²＋(xR−s)²)，高度 z＝R−ρ；从高度 z 的点积到内壁端
function direct(al, z, n) {
  n = n || 40000;
  const b = R * Math.cos(al), xR = R * Math.sin(al);
  const rz = R - z, s1 = xR - Math.sqrt(Math.max(rz * rz - b * b, 0));       // 高度 z 的点离内壁端的弦长
  const tau = [0, 0, 0];
  // 向内壁一端加密：s＝s1·(1−(1−u)²)
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, um = (i + 0.5) / n;
    const sA = s1 * (1 - (1 - u0) ** 2), sB = s1 * (1 - (1 - u1) ** 2), sM = s1 * (1 - (1 - um) ** 2);
    const rho = Math.sqrt(b * b + (xR - sM) ** 2), zz = R - rho, sg = sigma(zz);
    for (let c = 0; c < 3; c++) tau[c] += sg[c] * (sB - sA);
  }
  return tau;
}
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

section('2 纹素中心：复刻 vs 直接积分（< 1%）');
const W = 256, H = 128, table = new Float64Array(W * H * 3);
{
  let worst = 0, where = '';
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const uv = [i / (W - 1), j / (H - 1)];                          // 与 (fc/size − 0.5/size)/(1 − 1/size) 相同
    const al = uv[0] * uv[0] * 0.5 * Math.PI;
    const zmax = Math.min(Ztop, 2 * R * Math.pow(sinS(0.5 * al), 2)), z = uv[1] * uv[1] * zmax;
    const c = lutCell(al, z);
    for (let k = 0; k < 3; k++) table[(j * W + i) * 3 + k] = c.tau[k];
    if ((i % 17 === 0 || i < 3) && j % 9 === 0 && z > 0) {
      const d = direct(al, z, 6000);
      for (let k = 0; k < 3; k++) if (d[k] > 1e-7) { const r = rel(c.tau[k], d[k]); if (r > worst) { worst = r; where = `α=${al.toFixed(5)} z=${z.toFixed(3)} 通道 ${k}`; } }
    }
  }
  ok(worst < 0.01, `纹素中心最大相对差 ${(worst * 100).toFixed(3)}%（${where}）`);
  // 掠射弦专门抽几根
  for (const al of [1e-4, 5e-4, 2e-3, 1e-2, 0.05]) {
    const zmax = Math.min(Ztop, 2 * R * Math.pow(Math.sin(0.5 * al), 2));
    for (const f of [0.1, 0.5, 1.0]) {
      const z = f * zmax, c = lutCell(al, z), d = direct(al, z);
      ok(rel(c.tau[1], d[1]) < 0.01, `掠射弦 α=${al} z=${z.toPrecision(3)}：复刻 ${c.tau[1].toPrecision(5)} vs 直接 ${d[1].toPrecision(5)}`);
    }
  }
}

// chordW 的取样（双线性、半纹素、√ 映射）
function chordW(al, z) {
  const zmax = Math.min(Ztop, 2 * R * Math.pow(sinS(0.5 * al), 2));
  const u = Math.sqrt(Math.min(Math.max(al / (0.5 * Math.PI), 0), 1)), v = Math.sqrt(Math.min(Math.max(z / Math.max(zmax, 1e-6), 0), 1));
  const tx = (u * (1 - 1 / W) + 0.5 / W) * W - 0.5, ty = (v * (1 - 1 / H) + 0.5 / H) * H - 0.5;
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(tx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(ty))), fx = Math.min(1, Math.max(0, tx - x0)), fy = Math.min(1, Math.max(0, ty - y0));
  const o = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = table[(y0 * W + x0) * 3 + k], b = table[(y0 * W + x0 + 1) * 3 + k], c = table[((y0 + 1) * W + x0) * 3 + k], d = table[((y0 + 1) * W + x0 + 1) * 3 + k];
    o[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return o;
}

section('3 按 chordW 查表：随机点（透射差 < 0.5%；光学厚度 > 0.05 时相对差 < 3%）');
{
  // 贴壁处 W≈0 而纹素行按 √z 排，双线性插值在头一行里对 W 的相对误差可以很大，但绝对量极小（透射差 < 0.02%），所以比透射
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let worstT = 0, worstR = 0, whereT = '', whereR = '', n = 0;
  for (let i = 0; i < 400; i++) {
    const al = Math.pow(rnd(), 2) * 0.5 * Math.PI;
    const zmax = Math.min(Ztop, 2 * R * Math.pow(Math.sin(0.5 * al), 2)), z = Math.pow(rnd(), 2) * zmax;
    const d = direct(al, z, 4000), w = chordW(al, z); n++;
    for (let k = 0; k < 3; k++) {
      const dt = Math.abs(Math.exp(-w[k]) - Math.exp(-d[k]));
      if (dt > worstT) { worstT = dt; whereT = `α=${al.toFixed(5)} z=${z.toPrecision(4)} 通道 ${k}`; }
      if (d[k] > 0.05) { const r = rel(w[k], d[k]); if (r > worstR) { worstR = r; whereR = `α=${al.toFixed(5)} z=${z.toPrecision(4)} 通道 ${k}（W=${w[k].toPrecision(4)}，直接 ${d[k].toPrecision(4)}）`; } }
    }
  }
  ok(worstT < 0.005, `${n} 个随机点，透射最大差 ${(worstT * 100).toFixed(3)}%（${whereT}）`);
  ok(worstR < 0.03, `光学厚度 > 0.05 的点，最大相对差 ${(worstR * 100).toFixed(2)}%（${whereR}）`);
}

section('4 竖直气柱的光学厚度（02 第二节第 1 条）');
{
  const top = lutCell(0.5 * Math.PI, Ztop).tau;                   // α＝90°：过球心的弦；z＝Ztop 时即整根气柱
  const want = BR.map(b => b * HR * (1 - Math.exp(-Ztop / HR)) + BM * HM * (1 - Math.exp(-Ztop / HM)));
  for (let k = 0; k < 3; k++) ok(rel(top[k], want[k]) < 0.005, `通道 ${k}：弦表 ${top[k].toFixed(4)}，解析 ${want[k].toFixed(4)}`);
  ok(Math.abs(top[1] - 0.578) < 0.005, `绿光竖直光学厚度 ${top[1].toFixed(3)}（02：0.58）`);
  ok(Math.abs(top[2] - 1.36) < 0.02 && Math.abs(top[0] - 0.27) < 0.01, `蓝 ${top[2].toFixed(3)}（1.36）、红 ${top[0].toFixed(3)}（0.27）`);
}

section('5 过了弦中点：2W(顶)−W(z)');
{
  // 相机贴壁（z≈0），沿与切面夹角 α 的方向看出去，到弦的另一端（对面壁）的总光学厚度＝2·W(α, zmax)
  for (const al of [0.02, 0.2, 0.8, 1.4]) {
    const zmax = Math.min(Ztop, 2 * R * Math.pow(Math.sin(0.5 * al), 2));
    const half = lutCell(al, zmax).tau[1], full = 2 * direct(al, R * (1 - Math.cos(al)) < Ztop ? R * (1 - Math.cos(al)) : zmax)[1];
    // 视线不进真空核时（掠射）弦中点高度＝R(1−cos α)＜Ztop；否则只算到大气顶（真空段无消光）
    ok(rel(2 * half, full) < 0.01, `α=${al}：2W(中点)=${(2 * half).toFixed(4)}，直接积分整根弦 ${full.toFixed(4)}`);
  }
}

T.done();
