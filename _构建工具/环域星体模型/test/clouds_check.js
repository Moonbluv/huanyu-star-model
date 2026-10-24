#!/usr/bin/env node
/* test/clouds_check.js —— 云与设定（M5）的节点自检（规格：spec/02 第十节、第七节第 7–9 条；统筹修订第 2 条）。负责：M5。
 *
 * 1. 着色器契约：clouds.glsl 给出的函数签名与 near／far／probe／cloud_shadow／terrain 的调用一致；本路着色器里声明的
 *    uniform 都在契约表里；云影图、天气图不读自己正在写的目标。
 * 2. 常数一致：bake_weather.frag 与 clouds.glsl 的纬带哈希逐字相同；急流角速度＝HY.fp.set.WIND.jetRadPerHour。
 * 3. 天气图统计：bake_weather.frag 的 JS 镜像（逐条照抄；常数从着色器原文里读）——平均覆盖度≈滑杆；东西拉长；
 *    各纬带按自己的速度整体转、相邻两条反向；查用时补的转角让两次烘焙之间连续；t＜0 也正常；类型按域与季节。
 * 4. 罪域阴云：weatherAt 的 JS 镜像——阴云区里几乎满覆盖、偶有云缝；外缘一圈碎云。
 * 5. 云的密度：cloudDens 的 JS 镜像——覆盖度单调、积云底平、层云比积云薄、罪域云盖整层 τ≈uRuiTau。
 * 6. 雨与余息：rain.frag 用得上的约定（遮挡、风向、只在该下的地方下）。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('clouds_check');
const { eq, near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const G = HY.glsl, fp = HY.fp;
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const PI = 3.14159265359;
const sat = x => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const u = sat((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const gmod = (x, y) => x - y * Math.floor(x / y);
const P = HY.model && HY.model.P ? HY.model.P : HY.astro.params();

/* ───────── 1. 着色器契约 ───────── */
section('1 着色器契约');
// 函数定义：名 → 参数个数（clouds.glsl）
function defs(src) {
  const o = {}, re = /\b(?:float|vec2|vec3|vec4|int|uint|void|bool)\s+(\w+)\s*\(([^)]*)\)\s*\{/g; let m;
  while ((m = re.exec(strip(src)))) o[m[1]] = m[2].trim() ? m[2].split(',').length : 0;
  return o;
}
// 调用处的实参个数（顶层逗号）
function calls(src, name) {
  const s = strip(src), out = [], re = new RegExp('\\b' + name + '\\s*\\(', 'g'); let m;
  while ((m = re.exec(s))) {
    const pre = s.slice(Math.max(0, m.index - 12), m.index);
    if (/(float|vec[234]|int|uint|void|bool)\s+$/.test(pre)) continue;   // 定义本身
    let i = m.index + m[0].length, d = 1, n = 1, empty = true;
    for (; i < s.length && d > 0; i++) { const c = s[i]; if (c === '(') d++; else if (c === ')') d--; else if (c === ',' && d === 1) n++; else if (d === 1 && !/\s/.test(c)) empty = false; }
    out.push(empty ? 0 : n);
  }
  return out;
}
{
  const D = defs(G.clouds);
  const want = { cloudTopAt: 1, weatherAt: 1, cloudDens: 4, cloudSource: 5, slabCloud: 3, ruiDeckTau: 1, cloudShadowTau: 1, jetProf: 1, ruiDeck: 2 };
  for (const k in want) eq(D[k], want[k], `clouds.glsl 定义 ${k}（${want[k]} 个参数）`);
  ok(/vec4\s+weatherAt\s*\(\s*vec3\s+X\s*\)/.test(G.clouds) && /float\s+cloudDens\s*\(\s*vec3\s+X\s*,\s*float\s+z\s*,\s*vec4\s+wx\s*,\s*int\s+lod\s*\)/.test(G.clouds) &&
     /vec3\s+cloudSource\s*\(\s*vec3\s+X\s*,\s*float\s+K\s*,\s*float\s+z\s*,\s*float\s+sig\s*,\s*vec3\s+d\s*\)/.test(G.clouds) &&
     /vec4\s+slabCloud\s*\(\s*vec3\s+X\s*,\s*vec3\s+d\s*,\s*float\s+tau\s*\)/.test(G.clouds), '对外四个函数的签名与 02 原式相同（别的路照旧调用）');
  // 所有拼了 clouds 的 pass：主文件里对这些函数的调用，实参个数与定义一致
  const users = Object.keys(fp.passes.DEFS).filter(n => fp.passes.DEFS[n].chunks.indexOf('clouds') >= 0);
  ok(['near', 'far', 'probe', 'terrain', 'cloud_shadow'].every(n => users.indexOf(n) >= 0), '近段、远段、探针、地形、云影图都拼了 clouds');
  let bad = [];
  for (const n of users) {
    const d = fp.passes.DEFS[n], srcs = d.chunks.filter(c => c !== 'clouds').map(c => G[c]).concat([G[d.main]]);
    for (const f of ['weatherAt', 'cloudDens', 'cloudSource', 'slabCloud', 'cloudTopAt', 'ruiDeckTau', 'ruiDeck', 'cloudShadowTau'])
      for (const s of srcs) for (const a of calls(s, f)) if (a !== want[f]) bad.push(n + ':' + f + '(' + a + ')');
  }
  ok(!bad.length, '各 pass 对云函数的调用实参个数都对' + (bad.length ? '：' + bad.join('，') : ''));
  // clouds 在 CHAIN 里排在 shadow 之后（cloudShadowT、uCloudSh 先声明）
  const C = fp.passes.CHAIN; ok(C.indexOf('clouds') > C.indexOf('shadow') && C.indexOf('clouds') > C.indexOf('common'), 'clouds 拼在 common、shadow 之后');
  // 本路的 pass 与 uniform
  const DF = fp.passes.DEFS;
  eq(DF.bake_weather.out, 'tWeather', 'bake_weather 写 tWeather'); eq(DF.bake_weather.fmt, 'u8', '天气图是八位目标（所以厚度要编码）');
  ok(DF.cloud_shadow.chunks.indexOf('clouds') >= 0 && DF.cloud_shadow.out === 'tCloudSh', 'cloud_shadow 拼了 clouds、写 tCloudSh');
  ok(DF.rain.blend === 'add' && DF.rain.out === 'tHDR' && DF.rain.tiers.indexOf('low') < 0, 'rain 以加法叠到 tHDR，中档起才有');
  for (const [pass, file] of [['bake_weather', 'bake_weather'], ['cloud_shadow', 'cloud_shadow'], ['rain', 'rain'], ['near', 'clouds']]) {
    const us = fp.parseUniforms(G[file]), miss = [];
    for (const u of us) { const inf = fp.uniformInfo(u.name); if (!inf || inf.type !== u.type || (inf.pass && inf.pass !== pass)) miss.push(u.name + ':' + u.type); }
    ok(!miss.length, `${file} 声明的 uniform 都在契约表里、类型一致` + (miss.length ? '：' + miss.join('，') : ''));
  }
  // 不读自己正在写的目标（WebGL 反馈环）
  ok(!/uWeather/.test(strip(G.bake_weather)), 'bake_weather.frag 不读 uWeather');
  ok(!/cloudSource|cloudShadowTau|cloudShadowT|uCloudSh/.test(strip(G.cloud_shadow)), 'cloud_shadow.frag 的主函数不读 uCloudSh（cloudSource 只在别的 pass 里调用）');
  ok(!/uHDR|uCur\b/.test(strip(G.rain)), 'rain.frag 不读 tHDR（加法混合写它）');
  ok(/cloudShadowTau\(/.test(strip(G.clouds).split('vec3 cloudSource')[1] || ''), 'cloudSource 直接读云影图的 τ（不经 exp/log，厚云不被截在 τ≈9）');
  ok(!/texture\(/.test(strip(G.clouds)) && !/texture\(/.test(strip(G.cloud_shadow)), 'clouds.glsl、cloud_shadow.frag 只用 textureLod（循环里没有隐式导数）');
}

/* ───────── 2. 常数一致 ───────── */
section('2 常数一致');
const K = {};
G.bake_weather.replace(/const float (\w+)\s*=\s*([-0-9.eE]+)\s*;/g, (m, a, b) => { K[a] = +b; });
{
  for (const k of ['JET_N', 'JET_RATE', 'JET_BLEND', 'EVOLVE', 'WARP', 'F_MU', 'F_SD', 'R_MU', 'R_SD', 'A_BAND', 'A_CYC', 'A_FRONT', 'CYC_LIFE', 'CYC_R0', 'CYC_R1', 'FRONT_W', 'PR_MU', 'PR_SD', 'RAMP'])
    ok(typeof K[k] === 'number' && isFinite(K[k]), `bake_weather.frag 的常数 ${k}＝${K[k]}`);
  eq(K.JET_RATE, fp.set.WIND.jetRadPerHour, '急流角速度＝settings 的 jetRadPerHour（两次烘焙之间 weatherAt 按同一速率补转角）');
  const hb = (strip(G.bake_weather).match(/uint wHash\(uint x\)\{[^}]*\}/) || [''])[0].replace('wHash', 'H');
  const hc = (strip(G.clouds).match(/uint cwHash\(uint x\)\{[^}]*\}/) || [''])[0].replace('cwHash', 'H');
  ok(hb && hb === hc, '纬带哈希：bake_weather 的 wHash 与 clouds 的 cwHash 逐字相同');
  const h1 = (strip(G.bake_weather).match(/float wH01\(int a, int b\)\{[^}]*\}/) || [''])[0].replace(/wHash/g, 'H').replace('wH01', 'F');
  const h2 = (strip(G.clouds).match(/float cwH01\(int a, int b\)\{[^}]*\}/) || [''])[0].replace(/cwHash/g, 'H').replace('cwH01', 'F');
  ok(h1 && h1 === h2, '纬带哈希：wH01 与 cwH01 逐字相同');
  const jp = strip(G.clouds).match(/float jetProf\(float y\)\{[\s\S]*?\n\}/)[0];
  ok(new RegExp('\\(y \\+ 1\\.0\\)\\*' + K.JET_N.toFixed(1).replace('.', '\\.')).test(jp) && /17\.0/.test(jp) && jp.indexOf(String(K.JET_BLEND)) >= 0,
    `jetProf 的带数（${K.JET_N}）、带边宽（${K.JET_BLEND}）与烘焙一致`);
  ok(/0\.55 \+ 0\.45\*cwH01\(k, 1\)/.test(G.clouds) && /0\.55 \+ 0\.45\*wH01\(k, 1\)/.test(G.bake_weather), '带速的哈希系数一致（0.55＋0.45·哈希）');
}

/* ───────── 3. 天气图（bake_weather.frag 的 JS 镜像） ───────── */
section('3 天气图统计（JS 镜像）');
const N64 = (() => { const j = fp.noise.gen3D(64, null, { manual: true }); while (j.step(64)); return j.data; })();
function tex(D, n, p0, p1, p2, c) {
  const x = p0 * n - 0.5, y = p1 * n - 0.5, z = p2 * n - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1, w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    const X = ((ix + dx) % n + n) % n, Y = ((iy + dy) % n + n) % n, Z = ((iz + dz) % n + n) % n;
    s += w * D[((Z * n + Y) * n + X) * 4 + c];
  }
  return s / 255;
}
const t64 = (a, b, c, ch) => tex(N64, 64, a, b, c, ch);
function wHash(x) { x >>>= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return x >>> 0; }
function wH01(a, b) { return (wHash((Math.imul(a >>> 0, 0x9e3779b9) + wHash(((b >>> 0) + 0x632be5ab) >>> 0)) >>> 0) >>> 8) / 16777216; }
function fbmR(p0, p1, p2) { let a = 0.5, s = 0; for (let i = 0; i < 4; i++) { s += a * t64(p0, p1, p2, 0); p0 = p0 * 2.03 + 0.17; p1 = p1 * 2.03 + 0.17; p2 = p2 * 2.03 + 0.17; a *= 0.5; } return s / 0.9375; }
const bandOmega = k => K.JET_RATE * ((k & 1) === 0 ? 1 : -1) * (0.55 + 0.45 * wH01(k, 1));
function bandPattern(n0, n1, n2, k, Tb) {
  const th = gmod(bandOmega(k) * Tb, 6.2831853), c = Math.cos(-th), s = Math.sin(-th);
  const m0 = c * n0 - s * n2, m1 = n1, m2 = s * n0 + c * n2, phb = Math.atan2(m2, m0);
  const q0 = m0, q1 = m1 * 2.6, q2 = m2, ev = gmod(Tb * K.EVOLVE, 1);
  const w0 = t64(q0 * 0.6 + 0.13, q1 * 0.6 + 0.13, q2 * 0.6 + 0.13, 0) - K.R_MU, w1 = t64(q0 * 0.6 + 0.71, q1 * 0.6 + 0.71, q2 * 0.6 + 0.71, 0) - K.R_MU, w2 = t64(q0 * 0.6 + 0.37, q1 * 0.6 + 0.37, q2 * 0.6 + 0.37, 0) - K.R_MU;
  const wk = K.WARP / K.R_SD, bz = (fbmR(q0 * 1.3 + w0 * wk, q1 * 1.3 + w1 * wk, q2 * 1.3 + w2 * wk + ev) - K.F_MU) / K.F_SD;
  const yc = (k + 0.5) / K.JET_N - 1, hw = 0.5 / K.JET_N, hs = m1 >= 0 ? 1 : -1;
  let cyc = 0;
  for (let i = 0; i < 2; i++) {
    const life = K.CYC_LIFE * (0.7 + 0.8 * wH01(k * 4 + i, 2)), cpos = Tb / life + wH01(k * 4 + i, 3);
    const gen = Math.floor(cpos) + 1048576, fr = cpos - Math.floor(cpos), I = Math.pow(Math.max(Math.sin(PI * fr), 0), 1.5);
    const py = yc + (wH01(k * 4 + i, gen * 7 + 4) - 0.5) * 0.3 * hw, pp = 6.2831853 * wH01(k * 4 + i, gen * 7 + 5), rr = Math.sqrt(Math.max(1 - py * py, 0));
    const c0 = rr * Math.cos(pp), c1 = py, c2 = rr * Math.sin(pp), rad = K.CYC_R0 + K.CYC_R1 * wH01(k * 4 + i, gen * 7 + 6);
    const d0 = m0 - c0, d1 = m1 - c1, d2 = m2 - c2, d = Math.hypot(d0, d1, d2);
    if (d < rad) {
      let e10 = c2, e12 = -c0; const l = Math.hypot(e10, e12); e10 /= l; e12 /= l;
      const e20 = c1 * e12, e21 = c2 * e10 - c0 * e12, e22 = -c1 * e10;
      const a = Math.atan2(d0 * e20 + d1 * e21 + d2 * e22, d0 * e10 + d2 * e12), x = d / rad;
      const arms = 0.5 + 0.5 * Math.sin(2 * a - hs * 7 * Math.log(x + 0.03));
      cyc = Math.max(cyc, I * (1 - sstep(0.55, 1, x)) * (1 + (arms - 1) * sstep(0.12, 0.35, x)));
    }
  }
  const mfr = 3 + Math.floor(4 * wH01(k, 8)), psi = 6.2831853 * wH01(k, 9) + gmod(0.02 * Tb * (wH01(k, 10) - 0.5), 6.2831853);
  const yf = yc + 0.4 * hw * Math.sin(mfr * phb + psi);
  const along = sstep(-0.3, 0.6, (t64(Math.cos(phb) * 0.8, k * 0.053 + gmod(0.5 * Tb * K.EVOLVE, 1), Math.sin(phb) * 0.8, 0) - K.R_MU) / K.R_SD);
  const front = Math.exp(-Math.pow((m1 - yf) / K.FRONT_W, 2)) * along;
  return [bz + K.A_BAND * Math.sin(K.JET_N * PI * m1) + K.A_CYC * cyc + K.A_FRONT * front, cyc, front];
}
// 一个纹素（纹理坐标 u, v）：返回 {cov, typ, b(编码), prec, thick, pr, u}
const Z = { gEq: P.gEq, gLight: HY.state.zones.gLight, gHeavy: HY.state.zones.gHeavy, R: P.R };
function texel(uu, vv, Tb, C, sunY) {
  const ph = uu * 2 * PI, y = vv * 2 - 1, r = Math.sqrt(Math.max(1 - y * y, 0)), n0 = r * Math.cos(ph), n1 = y, n2 = r * Math.sin(ph);
  const vb = (y + 1) * K.JET_N, k = Math.max(0, Math.min(2 * K.JET_N - 1, Math.floor(vb))), f = vb - k;
  let k2 = k, wb = 0;
  if (f < K.JET_BLEND && k > 0) { k2 = k - 1; wb = 0.5 * (1 - f / K.JET_BLEND); }
  else if (f > 1 - K.JET_BLEND && k < 2 * K.JET_N - 1) { k2 = k + 1; wb = 0.5 * (1 - (1 - f) / K.JET_BLEND); }
  wb = sstep(0, 1, wb);
  let pa = bandPattern(n0, n1, n2, k, Tb);
  if (wb > 0) { const pb = bandPattern(n0, n1, n2, k2, Tb); pa = pa.map((v, i) => v + (pb[i] - v) * wb); }
  const u = 1 / (1 + Math.exp(-1.7 * (pa[0] - K.PR_MU) / K.PR_SD));
  C = sat(C);
  let cov = sstep(1 - C - K.RAMP, 1 - C + K.RAMP, u) * sat(C / 0.03); cov = Math.max(cov, sat((C - 0.97) / 0.03));
  const gz = Z.gEq * r, light = 1 - sstep(Z.gLight - 0.05, Z.gLight + 0.05, gz), heavy = sstep(Z.gHeavy - 0.05, Z.gHeavy + 0.05, gz);
  const summer = sat(0.5 + 0.5 * (y / (Math.abs(y) + 0.05)) * (sunY || 0) / (0.5 * Z.R));
  const tn = (t64(n0 * 0.9 + 0.5, n1 * 0.9 + 0.5, n2 * 0.9 + 0.5, 1) - 0.4) / 0.19;
  const typ = sat(0.5 + 0.22 * tn - 0.35 * light + 0.3 * (1 - light - heavy) * (summer - 0.4) + 0.1 * heavy - 0.5 * pa[1] - 0.35 * pa[2] - 0.45 * sstep(0.7, 1, cov));
  const thick = Math.max(0.6, Math.min(1.4, 1 + 0.4 * (t64(n0 * 2.1 + 0.3, n1 * 2.1 + 0.3, n2 * 2.1 + 0.3, 2) - 0.4) / 0.19 + 0.25 * pa[1]));
  const prec = sstep(0.55, 0.9, cov) * (1 - typ) + sstep(0.75, 0.95, cov) * typ * sstep(1.1, 1.35, thick);
  return { cov, typ, b: (thick - 0.6) / 0.8, prec: sat(prec), thick, pr: pa[0], u, light, heavy };
}
// 镜像的“结构”与着色器原文对得上（防止只改了一边）
{
  const sb = strip(G.bake_weather);
  ok(/A_BAND\*sin\(JET_N\*PI\*m\.y\) \+ A_CYC\*cyc \+ A_FRONT\*front/.test(sb), '成云势＝底图＋纬带＋气旋＋锋面（镜像照这一行）');
  ok(/1\.0\/\(1\.0 \+ exp\(-1\.7\*\(pa\.x - PR_MU\)\/PR_SD\)\)/.test(sb) && /sstep\(1\.0 - C - RAMP, 1\.0 - C \+ RAMP, u\)\*sat\(C\/0\.03\)/.test(sb), '覆盖度映射：logistic 再按滑杆 C 映（镜像照这两行）');
  ok(/- 0\.45\*sstep\(0\.7, 1\.0, cov\)/.test(sb) && /\(thick - 0\.6\)\/0\.8/.test(sb) && /\(y\/\(abs\(y\) \+ 0\.05\)\)\*uSunW\.y\/\(0\.5\*uR\)/.test(sb), '类型的覆盖修正、季节、厚度的编码（镜像照抄）');
}
function grid(W, H, Tb, C, sunY) { const a = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) a.push(texel((i + 0.5) / W, (j + 0.5) / H, Tb, C, sunY)); return a; }
const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
{
  const g0 = grid(128, 64, 0, 0.42, 0);
  const dec = new Array(10).fill(0); g0.forEach(x => dec[Math.min(9, Math.floor(x.u * 10))]++);
  ok(dec.every(c => c / g0.length > 0.06 && c / g0.length < 0.14), 'logistic 之后 u 大致均匀（每个十分位 6%–14%）：' + dec.map(c => (c / g0.length * 100).toFixed(0)).join(' '));
  for (const [Tb, C, tol] of [[0, 0.1, 0.04], [0, 0.42, 0.04], [0, 0.7, 0.04], [0, 0.95, 0.05], [3000, 0.42, 0.04], [-40000, 0.42, 0.04]]) {
    const g = Tb === 0 && C === 0.42 ? g0 : grid(96, 48, Tb, C, 0);
    near(+mean(g, x => x.cov).toFixed(3), C, tol, `覆盖度滑杆 ${C}、烘焙时刻 ${Tb} 小时：全图平均覆盖度≈滑杆`);
  }
  const gz = grid(48, 24, 0, 0, 0), g1 = grid(48, 24, 0, 1, 0);
  eq(Math.max(...gz.map(x => x.cov)), 0, '滑杆 0：一片云都没有');
  eq(Math.min(...g1.map(x => x.cov)), 1, '滑杆 1：全图满覆盖');
  const gn = grid(64, 32, -40000, 0.42, 0);
  ok(gn.every(x => isFinite(x.cov + x.typ + x.b + x.prec) && x.cov >= 0 && x.cov <= 1 && x.b >= 0 && x.b <= 1), 't＜0（10018 年以前）：没有 NaN，各通道在 0–1');
  ok(g0.every(x => x.thick >= 0.6 && x.thick <= 1.4 && x.b >= 0 && x.b <= 1), '厚度 0.6–1.4，编码进八位目标后在 0–1');
  // 东西拉长：同样 300 km 的错位，沿纬线的相关明显高于沿经线
  function corr(pairs) { let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; const n = pairs.length; for (const [a, b] of pairs) { sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; } const ca = sab / n - sa * sb / n / n; return ca / Math.sqrt((saa / n - sa * sa / n / n) * (sbb / n - sb * sb / n / n)); }
  const pe = [], pn = [], L = 300 / P.R;
  for (let j = 0; j < 400; j++) {
    const y = -0.8 + 1.6 * ((j * 0.618034) % 1), r = Math.sqrt(1 - y * y), ph = 2 * PI * ((j * 0.414214) % 1);
    const a = texel(ph / (2 * PI), y / 2 + 0.5, 0, 0.42, 0).pr;
    pe.push([a, texel(gmod(ph + L / r, 2 * PI) / (2 * PI), y / 2 + 0.5, 0, 0.42, 0).pr]);
    pn.push([a, texel(ph / (2 * PI), Math.min(1, (y + L) / 2 + 0.5), 0, 0.42, 0).pr]);
  }
  const ce = corr(pe), cn = corr(pn);
  ok(ce > cn + 0.15, `东西拉长：错开 300 km 时沿纬线的相关 ${ce.toFixed(2)} ＞ 沿经线 ${cn.toFixed(2)}＋0.15`);
  // 纬带：多云带与少云带交替
  const bm = []; for (let k = 0; k < 2 * K.JET_N; k++) { const yc = (k + 0.5) / K.JET_N - 1; let s = 0; for (let i = 0; i < 64; i++) s += texel((i + 0.5) / 64, yc / 2 + 0.5, 0, 0.42, 0).pr; bm.push(s / 64); }
  let alt = 0; for (let k = 0; k < bm.length; k++) if (Math.sign(bm[k] - mean(bm, x => x)) === Math.sign(Math.sin(K.JET_N * PI * ((k + 0.5) / K.JET_N - 1)))) alt++;
  ok(alt >= 0.8 * bm.length, `纬带：${alt}/${bm.length} 条带的平均成云势按 sin(JET_N·π·y) 一多一少`);
}
section('3b 差速旋转与连续性');
{
  // 各带整体转：带 k 的图样在 Δ 小时后挪了 ω_k·Δ
  let good = 0, tot = 0, opp = 0;
  for (let k = 2; k < 2 * K.JET_N - 2; k++) {
    const yc = (k + 0.5) / K.JET_N - 1, v = yc / 2 + 0.5, om = bandOmega(k), D = 2;
    const a = [], b = [], c = [];
    for (let i = 0; i < 48; i++) {
      const ph = 2 * PI * (i + 0.5) / 48;
      a.push(texel(ph / (2 * PI), v, 100, 0.42, 0).pr);
      b.push(texel(gmod(ph + om * D, 2 * PI) / (2 * PI), v, 100 + D, 0.42, 0).pr);
      c.push(texel(ph / (2 * PI), v, 100 + D, 0.42, 0).pr);
    }
    const md = (x, y) => Math.sqrt(x.reduce((s, q, i) => s + (q - y[i]) ** 2, 0) / x.length);
    tot++; if (md(a, b) < 0.5 * md(a, c)) good++;
    if (Math.sign(bandOmega(k)) !== Math.sign(bandOmega(k + 1))) opp++;
  }
  ok(good >= tot - 1, `带内图样随带整体转（${good}/${tot} 条带：2 小时后按 ω_k 挪回去，差别不到原地比较的一半；其余是底图自己的演化）`);
  eq(opp, tot, '相邻两条带反向');
  ok([...Array(2 * K.JET_N).keys()].every(k => Math.abs(bandOmega(k)) >= 0.55 * K.JET_RATE - 1e-12 && Math.abs(bandOmega(k)) <= K.JET_RATE + 1e-12), '带速在 0.55–1 倍 JET_RATE（罪域一带约 30–55 km/h）');
  // 查用时补转角：weatherAt 在 bakeHour 之后 Δ 小时按 jetProf 挪 uv.x；与 Δ 小时后重烘的图应当对得上（这样换图时不跳）
  function jetProf(y) {                                           // clouds.glsl 的 jetProf 镜像
    const vb = (y + 1) * 9, k = Math.max(0, Math.min(17, Math.floor(vb))), f = vb - k, rel = q => (q & 1 ? -1 : 1) * (0.55 + 0.45 * wH01(q, 1)), a = rel(k);
    if (f < 0.14 && k > 0) return rel(k - 1) + (a - rel(k - 1)) * (0.5 + 0.5 * f / 0.14);
    if (f > 0.86 && k < 17) return a + (rel(k + 1) - a) * 0.5 * (f - 0.86) / 0.14;
    return a;
  }
  let worst = 0;
  for (let k = 1; k < 2 * K.JET_N - 1; k++) { const yc = (k + 0.5) / K.JET_N - 1; worst = Math.max(worst, Math.abs(jetProf(yc) * K.JET_RATE - bandOmega(k))); }
  ok(worst < 1e-12, 'jetProf×JET_RATE 在各带中心＝烘焙的带速 ω_k');
  const wind = 1, bh = 50, dt = 1 / 6, jet = fp.set.WIND.jetRadPerHour * wind * dt;   // settings.jetPhase 在下一次烘焙前的最大值
  let jump = 0, n = 0;
  for (let k = 2; k < 2 * K.JET_N - 2; k += 3) for (let i = 0; i < 24; i++) {
    const yc = (k + 0.5) / K.JET_N - 1, v = yc / 2 + 0.5, uu = (i + 0.5) / 24;
    const before = texel(gmod(uu - jet * jetProf(yc) / (2 * PI), 1), v, bh * wind, 0.42, 0).pr;   // 旧图＋补的转角
    const after = texel(uu, v, (bh + dt) * wind, 0.42, 0).pr;                                    // 新烘的图
    jump = Math.max(jump, Math.abs(before - after)); n++;
  }
  ok(jump < 0.08, `换图那一刻不跳：旧图补转角与新图的成云势最大差 ${jump.toFixed(3)}（标准差约 1.2）`);
}
section('3c 类型：域与季节');
{
  const A = P.A || P.R / 2;
  const gS = grid(128, 64, 0, 0.42, -A), gW = grid(128, 64, 0, 0.42, A);   // 日在塔根一侧＝塔根半球的夏
  const L1 = gS.filter(x => x.light > 0.9), PL = gS.filter(x => x.light < 0.1 && x.heavy < 0.1);
  ok(L1.length > 50 && PL.length > 50 && mean(L1, x => x.typ) < mean(PL, x => x.typ) - 0.1, `轻域偏层云：轻域平均类型 ${mean(L1, x => x.typ).toFixed(2)} ＜ 平域 ${mean(PL, x => x.typ).toFixed(2)}`);
  const plainRoot = (g) => g.filter((x, i) => x.light < 0.1 && x.heavy < 0.1 && Math.floor(i / 128) < 32);   // 塔根半球（y＜0）
  const ts = mean(plainRoot(gS), x => x.typ), tw = mean(plainRoot(gW), x => x.typ);
  ok(ts > tw + 0.05, `平域夏季偏积云：塔根半球平域夏 ${ts.toFixed(2)} ＞ 冬 ${tw.toFixed(2)}`);
  const ovc = gS.filter(x => x.cov > 0.95), brk = gS.filter(x => x.cov > 0.2 && x.cov < 0.6);
  ok(mean(ovc, x => x.typ) < mean(brk, x => x.typ) - 0.15, '满覆盖处多是层状云（类型低于碎云处）');
  ok(mean(ovc, x => x.prec) > 0.3 && mean(gS.filter(x => x.cov < 0.3), x => x.prec) < 0.02, '降水势落在满覆盖的层状云里');
}

/* ───────── 4. 罪域阴云（weatherAt 的 JS 镜像） ───────── */
section('4 罪域阴云与云缝');
const ruiC = fp.cel.ruiCenter(P), RR = fp.cel.RUI_RAD;
function ruiW(n) { const c = n[0] * ruiC[0] + n[1] * ruiC[1] + n[2] * ruiC[2]; return sstep(Math.cos(RR / P.R), Math.cos(0.75 * RR / P.R), c); }
function weatherAtGeo(n, Tb, C, wind, ovcK) {            // n：地固单位方向；uCM2W·X＝地固坐标
  const uu = gmod(Math.atan2(n[2], n[0]) / (2 * PI), 1), vv = n[1] / 2 + 0.5, w = texel(uu, vv, Tb, C, 0);
  let cov = w.cov, typ = w.typ;
  const c = n[0] * ruiC[0] + n[1] * ruiC[1] + n[2] * ruiC[2], rw = ruiW(n) * ovcK, Pk = n.map(x => x * P.R);
  const ro = sstep(Math.cos(1.5 * RR / P.R), Math.cos(0.9 * RR / P.R), c) * ovcK;
  if (ro > 0) { const br = t64(Pk[0] / 60 + wind[0] * 0.002, Pk[1] / 60 + wind[1] * 0.002, Pk[2] / 60 + wind[2] * 0.002, 1); cov = Math.max(cov, ro * (0.35 + 0.6 * sstep(0.15, 0.5, br))); }
  let gap = 0;
  if (rw > 0) { gap = sstep(0.72, 0.88, t64(Pk[0] / 180 + wind[0] * 0.001, Pk[1] / 180 + wind[1] * 0.001, Pk[2] / 180 + wind[2] * 0.001, 1)); cov = Math.max(cov, rw * (1 - 0.6 * gap)); typ = typ * (1 - rw); }
  return { cov, typ, gap, rw, ro };
}
{
  ok(/sstep\(0\.72, 0\.88, textureLod\(uNoise3, P\/180\.0 \+ uWind\*0\.001, 0\.0\)\.g\)/.test(G.clouds) && /cov = max\(cov, rw\*\(1\.0 - 0\.6\*gap\)\)/.test(G.clouds) &&
     /cov = max\(cov, ro\*\(0\.35 \+ 0\.6\*sstep\(0\.15, 0\.5, br\)\)\);/.test(G.clouds), '镜像照抄 weatherAt 的云缝与外缘碎云');
  // 罪域中心周围按面积均匀取点
  const e1 = (() => { const a = [ruiC[2], 0, -ruiC[0]]; const l = Math.hypot(...a); return a.map(x => x / l); })();
  const e2 = [ruiC[1] * e1[2] - ruiC[2] * e1[1], ruiC[2] * e1[0] - ruiC[0] * e1[2], ruiC[0] * e1[1] - ruiC[1] * e1[0]];
  function around(rKm, ang) { const a = rKm / P.R; const v = [0, 1, 2].map(i => ruiC[i] * Math.cos(a) + (e1[i] * Math.cos(ang) + e2[i] * Math.sin(ang)) * Math.sin(a)); return v; }
  const wind = fp.set.wind(HY.state, 37.2), inner = [], ring = [], outside = [];
  for (let i = 0; i < 2000; i++) { const r = 650 * Math.sqrt((i + 0.5) / 2000), ang = i * 2.39996; inner.push(weatherAtGeo(around(r, ang), 0, 0.42, wind, 1)); }
  for (let i = 0; i < 600; i++) ring.push(weatherAtGeo(around(950 + 300 * ((i * 0.618) % 1), i * 2.39996), 0, 0.42, wind, 1));
  for (let i = 0; i < 600; i++) outside.push(weatherAtGeo(around(950 + 300 * ((i * 0.618) % 1), i * 2.39996), 0, 0.42, wind, 0));
  const full = inner.filter(x => x.cov >= 0.95).length / inner.length, gaps = inner.filter(x => x.gap > 0.5).length / inner.length;
  ok(full > 0.9, `阴云区里（650 km 内）${(full * 100).toFixed(1)}% 的地方覆盖≥0.95`);
  ok(gaps > 0.003 && gaps < 0.08, `偶有云缝：${(gaps * 100).toFixed(1)}% 的地方在云缝里（0.3%–8%）`);
  ok(inner.every(x => x.cov >= 0.4 - 1e-9), '云缝里覆盖也不低于 0.4（缝里是碎云，不是晴天）');
  ok(mean(inner, x => x.typ) < 0.02, '阴云区里是层状云（类型≈0）');
  ok(mean(ring, x => x.cov) > mean(outside, x => x.cov) + 0.1, `阴云带外缘一圈碎云：覆盖 ${mean(ring, x => x.cov).toFixed(2)} ＞ 关掉阴云时 ${mean(outside, x => x.cov).toFixed(2)}＋0.1`);
}

/* ───────── 5. 云的密度（cloudDens 的 JS 镜像） ───────── */
section('5 云的密度');
{
  const sc = strip(G.clouds);
  ok(/float cum = \(0\.25\*s\.g \+ 0\.6\*s\.b \+ 0\.15\*s\.a - 0\.403\)\/0\.127;/.test(sc) && /float lay = \(s\.r - 0\.684\)\/0\.092;/.test(sc), '镜像照抄隆起度（积云、层云两种噪声的标准化）');
  ok(/return H\*mix\(0\.16, 0\.42, wx\.g\)\*sq\(wx\.b\);/.test(sc), '镜像照抄云高 cloudHTop');
  ok(/float thr = \(1\.0 - cov\*mix\(1\.0, 0\.8, typ\)\) \+ mix\(0\.45, 0\.55, typ\)\*hh\*hh\*\(1\.0 - 0\.7\*dk\) \+ 0\.4\*\(1\.0 - floorK\);/.test(sc), '镜像照抄门槛');
  // 统计隆起度的分布：大致均匀
  const Bs = [];
  for (let i = 0; i < 4000; i++) { const p = [(i * 0.618034) % 1, (i * 0.414214) % 1, (i * 0.723607) % 1]; const s = [0, 1, 2, 3].map(c => t64(p[0], p[1], p[2], c)); for (const ty of [0.1, 0.9]) Bs.push(billow(s, ty)); }
  const dec = new Array(10).fill(0); Bs.forEach(b => dec[Math.min(9, Math.floor(b * 10))]++);
  ok(dec.every(c => c / Bs.length > 0.05 && c / Bs.length < 0.16), '隆起度 B 大致均匀（每个十分位 5%–16%），覆盖 cov 的格子里约 cov 那么多体积有云');
}
function billow(s, typ) { const cum = (0.25 * s[1] + 0.6 * s[2] + 0.15 * s[3] - 0.403) / 0.127, lay = (s[0] - 0.684) / 0.092; const zc = (lay + (cum - lay) * typ) / Math.sqrt((1 - typ) ** 2 + typ ** 2); return 1 / (1 + Math.exp(-1.7 * zc)); }
// 非罪域、lod 1（不含细节侵蚀）：P＝地固坐标（km），z＝离壁高度
function dens(Pk, z, wx, base, top, dk, ruiTau, sigma) {
  const cov = wx[0], typ = wx[1]; if (cov <= 0.01 || z <= base || z >= top) return 0;
  const s = [0, 1, 2, 3].map(c => t64(Pk[0] / 24, Pk[1] / 24, Pk[2] / 24, c)), H = top - base;
  const zb2 = base + dk * 0.35 * (1 - sstep(0.2, 0.75, s[3]));
  let hh = (z - zb2) / Math.max((H * (0.16 + 0.26 * typ) * wx[2] * wx[2]) * (1 - dk) + (H - 0.35 * dk) * dk, 0.05);
  if (hh <= 0 || hh >= 1) return 0;
  const B = billow(s, typ) * (1 - 0.55 * dk) + 0.55 * dk;
  hh -= (1 - B) * (0.25 + (0.04 - 0.25) * typ) * (1 - dk);
  const floorK = sstep(0, 0.1 + (0.035 - 0.1) * typ, hh);
  const thr = (1 - cov * (1 - 0.2 * typ)) + (0.45 + 0.1 * typ) * hh * hh * (1 - 0.7 * dk) + 0.4 * (1 - floorK);
  const k = ((0.75 + 0.25 * typ) * wx[2]) * (1 - dk) + (ruiTau / (sigma * Math.max(H, 0.5)) * (1 + 2 * (1 - sstep(0, 0.08, hh)))) * dk;
  return sat((B - thr) / (0.3 + (0.16 - 0.3) * typ)) * k;
}
{
  const st = HY.state.fp.cloud, base = st.base, top = st.top, sig = st.sigma;
  function columns(cov, typ, b, n, dk, rb, rt) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = 3000 + 37 * ((i * 0.618034) % 1) * 3, y = 2000 + 37 * ((i * 0.414214) % 1) * 3, zb = rb || base, zt = rt || top;
      let tau = 0, first = -1, last = -1; const nz = 80;
      for (let q = 0; q < nz; q++) { const z = zb + (zt - zb) * (q + 0.5) / nz, d = dens([x, 6371 - z, y], z, [cov, typ, b], zb, zt, dk || 0, st.ruiTau, sig); tau += d * sig * (zt - zb) / nz; if (d > 0) { if (first < 0) first = z; last = z; } }
      out.push({ tau, first, last });
    }
    return out;
  }
  const fr = (cov, typ) => columns(cov, typ, 1, 600).filter(c => c.tau > 1).length / 600;
  eq(columns(0, 0.9, 1, 100).filter(c => c.tau > 0).length, 0, '覆盖 0：一点云也没有');
  const f2 = fr(0.2, 0.9), f4 = fr(0.45, 0.9), f7 = fr(0.7, 0.9);
  ok(f2 < f4 && f4 < f7, `积云：覆盖 0.2 → 0.45 → 0.7，有云的柱子 ${f2.toFixed(2)} → ${f4.toFixed(2)} → ${f7.toFixed(2)} 单调增`);
  ok(f4 > 0.25 && f4 < 0.65, `积云：覆盖 0.45 时约一半的柱子有云（${f4.toFixed(2)}）`);
  const cu = columns(0.5, 0.95, 1, 400).filter(c => c.tau > 1), hTopCu = (top - base) * 0.42 * 0.95;
  const flat = cu.filter(c => c.first - base < 0.08 * hTopCu).length / Math.max(cu.length, 1);
  ok(cu.length > 50 && flat > 0.7, `积云底平：${(flat * 100).toFixed(0)}% 的云柱从云底往上 8% 云高以内就开始有云`);
  const lt = c => c.last - c.first;
  const st0 = columns(0.8, 0.1, 1, 300).filter(c => c.tau > 1), cu0 = columns(0.8, 0.95, 1, 300).filter(c => c.tau > 1);
  ok(st0.length > 30 && cu0.length > 30 && mean(st0, lt) < 0.7 * mean(cu0, lt), `层云比积云薄：平均云厚 ${mean(st0, lt).toFixed(2)} ＜ 0.7×${mean(cu0, lt).toFixed(2)} km`);
  const tauSt = st0.map(c => c.tau).sort((a, b) => a - b);
  ok(tauSt[Math.floor(tauSt.length * 0.9)] > 1.6 * tauSt[Math.floor(tauSt.length * 0.1)], `层积云厚薄不一：竖直光学厚度 10%–90% 分位 ${tauSt[Math.floor(tauSt.length * 0.1)].toFixed(1)}–${tauSt[Math.floor(tauSt.length * 0.9)].toFixed(1)}（从下面看一块亮一块暗）`);
  const rb = st.ruiBase, rt = st.ruiTop, deck = columns(1, 0, 1, 200, 1, rb, rt).map(c => c.tau), md = deck.slice().sort((a, b) => a - b)[100];
  ok(md > 0.5 * st.ruiTau && md < 2 * st.ruiTau, `罪域云盖整层的竖直 τ 中位 ${md.toFixed(0)}，与 uRuiTau＝${st.ruiTau} 同量级（云缝里近段整层真步进时不会变成薄云）`);
}

/* ───────── 6. 雨与余息 ───────── */
section('6 雨与余息');
{
  const sr = strip(G.rain);
  ok(/texelFetch\(uSurf, ivec2\(fc\), 0\)/.test(sr) && /tr > tS/.test(sr), '雨丝、灰片按 tSurf 的表面距离被近处地物挡住');
  ok(/uniform vec4 uRainK;/.test(G.rain) && /uRainK\.x > 0\.001/.test(sr) && /uRainK\.y > 0\.001/.test(sr), '雨看 uRainK.x、余息看 uRainK.y');
  ok(/U_UP = vec3\(-1\.0, 0\.0, 0\.0\), N_N = vec3\(0\.0, -1\.0, 0\.0\)/.test(sr) && /azW = 3\.14159265/.test(sr) && /vec3\(0\.0, Wp, 0\.0\)/.test(sr),
    '余息的风向南（远离塔根，CM 系 +y），重力“上”＝−x');
  ok(/Wp = 8\.0\*\(0\.75\*t - \(0\.25\/0\.7\)\*cos\(t\*0\.7\) - \(0\.2\/0\.27\)\*cos\(t\*0\.27 \+ 1\.3\)\)/.test(sr) &&
     /W = 8\.0\*gust/.test(sr) && /gust = 0\.75 \+ 0\.25\*sin\(t\*0\.7\) \+ 0\.2\*sin\(t\*0\.27 \+ 1\.3\)/.test(sr), '风走过的路＝风速的积分（阵风不让图样乱跳）');
  // Wp 的导数＝W
  const Wf = t => 8 * (0.75 + 0.25 * Math.sin(t * 0.7) + 0.2 * Math.sin(t * 0.27 + 1.3)), Wp = t => 8 * (0.75 * t - (0.25 / 0.7) * Math.cos(t * 0.7) - (0.2 / 0.27) * Math.cos(t * 0.27 + 1.3));
  let wd = 0; for (let t = 0; t < 3600; t += 7.3) wd = Math.max(wd, Math.abs((Wp(t + 1e-3) - Wp(t - 1e-3)) / 2e-3 - Wf(t)));
  ok(wd < 1e-3, `d(Wp)/dt＝W（最大差 ${wd.toExponential(1)}）`);
  // settings.rainK（E 路）给 rain pass 的量：罪域里下雨、外面不下；入冬前前锋以内有余息
  const st = JSON.parse(JSON.stringify(HY.state)), O = HY.astro.site(6670, -4, P), Ofar = HY.astro.site(3000, 120, P);
  ok(fp.set.rainK(st, P, [O.x, O.y, O.z], 0, 10)[0] > 0.5, '罪域里下雨（uRainK.x＞0.5）');
  eq(fp.set.rainK(st, P, [Ofar.x, Ofar.y, Ofar.z], 0, 10)[0], 0, '罪域外不下雨');
  const tY = HY.world.winterT(10019, P) - 20, Oy = HY.astro.site(3000, 0, P);
  ok(fp.set.rainK(st, P, [Oy.x, Oy.y, Oy.z], 0, tY)[1] > 0.5, '入冬前 20 日、塔根外 3000 km（前锋以内）有余息');
  ok(fp.set.rainK(st, P, [Oy.x, Oy.y, Oy.z], 0, HY.world.winterT(10019, P) - 120)[1] === 0, '入冬前 120 日没有余息');
}

T.done();
