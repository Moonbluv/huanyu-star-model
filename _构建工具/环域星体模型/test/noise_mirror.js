#!/usr/bin/env node
/* test/noise_mirror.js —— 噪声与高度图的 JS 镜像对着色器（规格：spec/02 第十八节；负责：F 路）
 *
 * 1. PCG3D：fp/noise.js 的 Math.imul 版与独立的 BigInt 实现逐位一致（含 0、2³²−1 等边界）；
 *    gen_height.frag 与 terrain_lib.glsl 两处 GLSL 的 pcg3 原文逐字相同，并与本测试登记的原文一致（改了着色器要同步改 JS 镜像）。
 * 2. 周期 Perlin：gradT／perlinT 的 GLSL 原文未漂移；JS 版周期、格点为零、取值范围。
 * 3. 高度图：归一系数使 99% 的值落在 [−1, 1]（02 第十八节），且值域确实铺开；首尾平铺。
 * 4. GPU 对拍：2026-10-14 在浏览器（ANGLE/D3D11）里读回的 24 个纹素（gen_height 的 float32 与 gen_height_d 的半精度），
 *    镜像的 float32 差 ＜2e-6，半精度逐位相同（GPU 写半精度是向零截断，镜像同样截断）。
 * 5. layerTexHQ：foot.frag 与 terrain_lib.glsl 两份手工双线性逐字相同（dc＝0 时 alt(0) 才严格等于眼高）。
 * 6. 三维噪声 gen3D：尺寸、通道均值、可平铺、确定性、分片回调、手动步进。
 */
'use strict';
const load = require('./_load.js');
const HY = load({ only: ['astro.js', 'core/util.js', 'fp/uniforms.js', 'fp/noise.js', 'fp/ground.js'] });
const T = load.tester('noise_mirror');
const { ok, near, eq, section } = T;
const N = HY.fp.noise, G = HY.glsl;

/* ───────── 工具 ───────── */
const squash = s => (s || '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
function fnSrc(src, sig) {
  const i = (src || '').indexOf(sig); if (i < 0) return null;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return null;
}
const M32 = (1n << 32n) - 1n;
function pcgBig(x, y, z) {               // 独立实现：BigInt 按 2³² 取模
  let v = [BigInt(x >>> 0), BigInt(y >>> 0), BigInt(z >>> 0)].map(a => (a * 1664525n + 1013904223n) & M32);
  v[0] = (v[0] + v[1] * v[2]) & M32; v[1] = (v[1] + v[2] * v[0]) & M32; v[2] = (v[2] + v[0] * v[1]) & M32;
  v = v.map(a => a ^ (a >> 16n));
  v[0] = (v[0] + v[1] * v[2]) & M32; v[1] = (v[1] + v[2] * v[0]) & M32; v[2] = (v[2] + v[0] * v[1]) & M32;
  return v.map(Number);
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed; };

/* ───────── 1 PCG3D ───────── */
section('1 PCG3D：JS 镜像逐位一致、GLSL 两处原文相同');
{
  let bad = 0;
  const edge = [0, 1, 2, 0x7fffffff, 0x80000000, 0xffffffff, 1664525, 1013904223];
  for (const a of edge) for (const b of edge) for (const c of [0, 0xffffffff, 77]) {
    const j = N.hash3(a, b, c), r = pcgBig(a, b, c);
    if (j[0] !== r[0] || j[1] !== r[1] || j[2] !== r[2]) bad++;
  }
  for (let i = 0; i < 5000; i++) {
    const a = rnd(), b = rnd(), c = rnd() & 0xffff, j = N.hash3(a, b, c), r = pcgBig(a, b, c);
    if (j[0] !== r[0] || j[1] !== r[1] || j[2] !== r[2]) bad++;
  }
  eq(bad, 0, 'hash3 与 BigInt 版在 5192 组输入上逐位一致');
  const PCG_GLSL = `uvec3 pcg3(uvec3 v){ v = v*1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }`;
  const a = fnSrc(G.gen_height, 'uvec3 pcg3('), b = fnSrc(G.terrain_lib, 'uvec3 pcg3(');
  ok(a && squash(a) === squash(PCG_GLSL), 'gen_height.frag 的 pcg3 原文与登记的一致（改了请同步 fp/noise.js）');
  ok(b && squash(b) === squash(a), 'terrain_lib.glsl 的 pcg3 与 gen_height.frag 逐字相同');
  ok(/hash3f\(uvec3 v\)\{ return vec3\(pcg3\(v\) >> 8u\)\/16777216\.0; \}/.test(G.terrain_lib || ''), 'hash3f＝pcg3 >> 8 / 2²⁴（与 JS 的 hash01 同式）');
}

/* ───────── 2 周期 Perlin ───────── */
section('2 周期 Perlin：GLSL 原文、周期、格点、范围');
{
  const GRAD = `vec2 gradT(ivec2 p, int per, int seed){ p = ((p % per) + per) % per;
  float a = float(pcg3(uvec3(uint(p.x), uint(p.y), uint(seed))).x >> 8u)/16777216.0*6.2831853; return vec2(cos(a), sin(a)); }`;
  const PERLIN = `float perlinT(vec2 x, int per, int seed){
  ivec2 i = ivec2(floor(x)); vec2 f = x - floor(x), u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  float n00 = dot(gradT(i, per, seed), f), n10 = dot(gradT(i + ivec2(1, 0), per, seed), f - vec2(1.0, 0.0));
  float n01 = dot(gradT(i + ivec2(0, 1), per, seed), f - vec2(0.0, 1.0)), n11 = dot(gradT(i + ivec2(1, 1), per, seed), f - vec2(1.0));
  return 1.414*mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}`;
  ok(squash(fnSrc(G.gen_height, 'vec2 gradT(')) === squash(GRAD), 'gen_height.frag 的 gradT 原文与登记的一致');
  ok(squash(fnSrc(G.gen_height, 'float perlinT(')) === squash(PERLIN), 'gen_height.frag 的 perlinT 原文与登记的一致');
  ok(/\*1\.45,/.test(G.gen_height || '') && N.HEIGHT_K === 1.45, '高度归一系数两边都是 1.45');
  ok(/if \(o < 2\) ridge \+= a\*\(1\.0 - abs\(n\)\)/.test(G.gen_height || '') && /if \(o < 2\) ridge \+= a \* \(1 - Math\.abs\(n\)\)/.test(N.heightRaw.toString()), '山脊项只取前两个八度（GLSL 与镜像同式）');
  let perErr = 0, latErr = 0, mx = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (rnd() % 100000) / 997, y = (rnd() % 100000) / 991, per = [4, 8, 16, 32, 64][i % 5], s = 11 + (i % 7);
    const v = N.perlinT(x, y, per, s);
    perErr = Math.max(perErr, Math.abs(v - N.perlinT(x + per, y, per, s)), Math.abs(v - N.perlinT(x, y - 3 * per, per, s)));
    mx = Math.max(mx, Math.abs(v));
    latErr = Math.max(latErr, Math.abs(N.perlinT(Math.floor(x), Math.floor(y), per, s)));
  }
  ok(perErr < 1e-9, `周期：平移整周期后差 ${perErr.toExponential(2)}`);
  ok(latErr === 0, '整数格点处为 0');
  ok(mx <= 1.414 && mx > 0.6, `取值范围 |n| ≤ 1.414（实测最大 ${mx.toFixed(3)}）`);
  ok(N.perlin([2.3, 4.7], 8, 3) === N.perlinT(2.3, 4.7, 8, 3), 'perlin(p, period, seed) 与 perlinT 同值');
}

/* ───────── 3 高度图归一 ───────── */
section('3 高度图：99% 落在 [−1, 1]、值域铺开、平铺');
{
  const vals = [];
  for (let j = 0; j < 1024; j += 4) for (let i = 0; i < 1024; i += 4) vals.push(N.heightRaw(i / 1024, j / 1024));
  vals.sort((a, b) => a - b);
  const q = p => vals[Math.floor(p * (vals.length - 1))];
  const inside = vals.filter(v => v >= -1 && v <= 1).length / vals.length;
  ok(inside >= 0.99, `未夹取的高度有 ${(inside * 100).toFixed(2)}% 落在 [−1, 1]（≥99%）`);
  ok(q(0.99) - q(0.01) > 0.9, `值域铺开：1%–99% 分位 ${q(0.01).toFixed(3)} 到 ${q(0.99).toFixed(3)}（跨度 >0.9）`);
  let tile = 0;
  for (let k = 0; k < 64; k++) { const y = k / 64 + 0.003; tile = Math.max(tile, Math.abs(N.heightRaw(0, y) - N.heightRaw(1, y)), Math.abs(N.heightRaw(y, 0) - N.heightRaw(y, 1))); }
  ok(tile < 1e-9, `首尾平铺（差 ${tile.toExponential(2)}）`);
}

/* ───────── 4 GPU 对拍 ───────── */
section('4 GPU 读回对拍（gen_height float32、gen_height_d 半精度）');
{
  // [i, j, R32, A32, R16, G16, B16, A16]（2026-10-14，ANGLE/D3D11，三张纹理直接读回）
  const GOLD = [[0,0,0.5923125147819519,0.5,0.59228515625,-33,29.703125,0.5],[1,0,0.4865362048149109,0.4687580466270447,0.486328125,-87.8125,-0.57568359375,0.46875],[0,1,0.5471292734146118,0.4949248433113098,0.546875,-62.3125,-60.09375,0.494873046875],[1023,1023,0.4715348482131958,0.5360291600227356,0.471435546875,35.8125,88.6875,0.53564453125],[511,512,0.5999885201454163,0.5242835879325867,0.599609375,-2.173828125,12.90625,0.52392578125],[37,901,0.581279456615448,0.27200597524642944,0.5810546875,40.46875,19.890625,0.27197265625],[422,940,0.4467276334762573,0.4563201069831848,0.446533203125,42.0625,48.3125,0.456298828125],[970,136,0.4206315875053406,0.5547296404838562,0.42041015625,-68.0625,42.5,0.5546875],[83,447,0.5433543920516968,0.6732990145683289,0.54296875,46.71875,49.125,0.6728515625],[220,758,-0.24556171894073486,0.8677282333374023,-0.2454833984375,-43.0625,32.4375,0.86767578125],[357,45,-0.3427616059780121,0.48998740315437317,-0.342529296875,-33.6875,-82.5625,0.48974609375],[494,356,0.40428635478019714,0.3778207004070282,0.404052734375,-14.375,-80.6875,0.377685546875],[640,320,0.5923125147819519,0.5,0.59228515625,4.07421875,-46.90625,0.5],[1000,17,0.23626776039600372,0.9064594507217407,0.2362060546875,33.40625,50.5625,0.90625],[17,1000,0.08517535030841827,0.6113799214363098,0.08514404296875,-81.125,-20.875,0.611328125],[768,768,0.5923125147819519,0.5,0.59228515625,12.9765625,50.71875,0.5],[256,128,0.5923125147819519,0.5,0.59228515625,-5.1328125,26.140625,0.5],[128,256,0.5923125147819519,0.5,0.59228515625,-29.046875,-41.84375,0.5],[999,555,0.24360229074954987,0.6211001873016357,0.2435302734375,-89.6875,3.939453125,0.62109375],[333,777,0.2636212110519409,0.6348568201065063,0.263427734375,10.671875,-54.15625,0.634765625],[600,601,0.5458391904830933,0.6748212575912476,0.54541015625,-43.0625,-1.4541015625,0.6748046875],[1023,0,0.5510303974151611,0.5312803387641907,0.55078125,48.03125,54.9375,0.53125],[0,1023,0.4891021251678467,0.5047929286956787,0.489013671875,-6.80859375,114.4375,0.50439453125],[512,0,0.5923125147819519,0.5,0.59228515625,-27,-41.5,0.5]];
  let d32 = 0, dA = 0, bad16 = 0, gUlp = 0;
  const ulp = x => { const a = Math.abs(x); if (a < 6.1e-5) return Math.pow(2, -24); return Math.pow(2, Math.floor(Math.log2(a)) - 10); };
  for (const [i, j, r32, a32, r16, g16, b16, a16] of GOLD) {
    d32 = Math.max(d32, Math.abs(N.h32(i, j) - r32));
    dA = Math.max(dA, Math.abs(Math.fround(Math.min(1, Math.max(0, N.materialRaw(i / 1024, j / 1024)))) - a32));
    const t = N.heightTexel(i, j, [0, 0, 0, 0]);
    if (t[0] !== r16 || t[3] !== a16) bad16++;
    gUlp = Math.max(gUlp, Math.abs(t[1] - g16) / ulp(g16), Math.abs(t[2] - b16) / ulp(b16));
  }
  ok(d32 < 2e-6, `gen_height 的 R（float32）：镜像最大差 ${d32.toExponential(2)}（＜2e-6）`);
  ok(dA < 2e-6, `gen_height 的 A（材质）：镜像最大差 ${dA.toExponential(2)}`);
  eq(bad16, 0, 'tHeight 的 R、A（半精度、向零截断）24 个纹素逐位相同');
  ok(gUlp <= 1, `tHeight 的 G、B（中心差分）至多差 1 个半精度 ulp（实测 ${gUlp.toFixed(2)}）`);
  // 取样：纹素中心等于纹素值；中点是双线性平均
  const t0 = N.heightTexel(10, 20, [0, 0, 0, 0]), t1 = N.heightTexel(11, 20, [0, 0, 0, 0]);
  const s0 = N.sampleHeight(10.5 / 1024, 20.5 / 1024), sm = N.sampleHeight(11 / 1024, 20.5 / 1024);
  ok(Math.abs(s0[0] - t0[0]) < 1e-12 && Math.abs(sm[0] - 0.5 * (t0[0] + t1[0])) < 1e-12, 'sampleHeight：纹素中心＝纹素值，两中心之间线性插值');
  const w = N.sampleHeight(1 + 10.5 / 1024, -1 + 20.5 / 1024);
  ok(Math.abs(w[0] - s0[0]) < 1e-12, 'sampleHeight 平铺（uv 加减整数不变）');
  eq(N.toHalf(1 / 3), 0.333251953125, 'toHalf 向零截断：1/3 → 0.333251953125');
  eq(N.toHalf(-0.2455617), -0.2454833984375, 'toHalf 负数也向零截断');
  eq(N.toHalf(65504), 65504, 'toHalf 上限 65504');
}

/* ───────── 5 layerTexHQ 两份原文 ───────── */
section('5 低频层手工双线性：foot.frag 与 terrain_lib.glsl 两份逐字相同');
{
  const a = fnSrc(G.foot, 'vec4 layerTexHQ('), b = fnSrc(G.terrain_lib, 'vec4 layerTexHQ(');
  ok(a && b && squash(a) === squash(b), 'layerTexHQ 两份逐字相同（dc＝0 时逐位一致，alt(0)＝眼高）');
  // 量化前起伏 P：两处写法逐字相同（同一串运算，dc＝0 时逐位一致）
  const PL = /vec4 L0 = layerTexHQ\(0, dc\), L1 = layerTexHQ\(1, dc\);[^\n]*\n\s*float P = amp\*\(LAY_A\[0\]\*L0\.r \+ LAY_A\[1\]\*L1\.r\)/;
  ok(PL.test(G.foot || '') && PL.test(G.terrain_lib || ''), 'foot.frag 与 altAt 的量化前起伏 P 都用 layerTexHQ、写法相同');
}

/* ───────── 6 三维噪声 ───────── */
section('6 三维噪声 gen3D：尺寸、均值、平铺、确定性、分片');
(async () => {
  const t0 = Date.now();
  let slices = 0;
  const A = N.gen3D(32, (z, tot) => { slices++; }, { manual: true });
  while (A.step(4));
  const data = await A.done;
  eq(data.length, 32 * 32 * 32 * 4, 'gen3D(32) 返回 32³·4 字节');
  eq(slices, 32, '每片回调一次，共 32 片');
  const B = N.gen3D(32, null, { manual: true }); while (B.step(8));
  let same = true; for (let i = 0; i < data.length; i++) if (data[i] !== B.data[i]) { same = false; break; }
  ok(same, '确定性：两次生成逐字节相同');
  const mean = c => { let s = 0; for (let i = c; i < data.length; i += 4) s += data[i]; return s / (data.length / 4) / 255; };
  const m = [0, 1, 2, 3].map(mean);
  ok(m.every(v => v > 0.2 && v < 0.8), `细节体积各通道均值在 0.2–0.8（${m.map(v => v.toFixed(2)).join('、')}）`);
  // 平铺：x＝0 与 x＝31 相邻（跨边界）的差，与内部相邻差同一量级
  const at = (x, y, z, c) => data[(((z % 32) * 32 + (y % 32)) * 32 + (x % 32)) * 4 + c];
  let edge = 0, inner = 0, n = 0;
  for (let z = 0; z < 32; z += 3) for (let y = 0; y < 32; y += 3) for (let c = 0; c < 4; c++) {
    edge += Math.abs(at(31, y, z, c) - at(0, y, z, c)); inner += Math.abs(at(15, y, z, c) - at(16, y, z, c)); n++;
  }
  ok(edge / n < 2.5 * inner / n + 4, `可平铺：跨边界相邻差 ${(edge / n).toFixed(1)}，内部相邻差 ${(inner / n).toFixed(1)}`);
  const C = N.gen3D(64, null, { manual: true }); let steps = 0; while (C.step(4)) steps++;
  eq(C.data.length, 64 * 64 * 64 * 4, 'gen3D(64)（云形）返回 64³·4 字节');
  eq(steps + 1, 16, '每帧 4 片：64 片分 16 帧');
  const mr = (() => { let s = 0; for (let i = 0; i < C.data.length; i += 4) s += C.data[i]; return s / (C.data.length / 4) / 255; })();
  ok(mr > 0.4 && mr < 0.85, `云形 r（Perlin-Worley）均值 ${mr.toFixed(2)}`);
  const ms = Date.now() - t0;
  ok(ms < 8000, `三维噪声全部生成用时 ${ms} ms`);
  T.done();
})().catch(e => { ok(false, '三维噪声出错：' + (e && e.stack || e)); T.done(); });
