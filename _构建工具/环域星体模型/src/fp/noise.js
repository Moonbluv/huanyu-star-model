/* HY.fp.noise —— 整数哈希 PCG3D、周期 Perlin、Worley；高度图的 JS 镜像；三维噪声分帧生成
 * 规格：spec/02 第八节第 6 条（gen_height）、第十节（云噪声）、第十六节第 6 条（分帧）。负责：F 路（第一人称·地面）。
 * 节点可测（test/noise_mirror.js）：不碰 DOM、THREE。
 *
 * 与着色器的对应（改一边必须改另一边，noise_mirror 会比对着色器原文）：
 *   pcg3            ↔ glsl/gen_height.frag、glsl/terrain_lib.glsl 的 pcg3（Math.imul 逐位复刻 uint 运算）
 *   gradT / perlinT ↔ glsl/gen_height.frag 的 gradT / perlinT
 *   heightTexel     ↔ gen_height.frag 的 main（第 i, j 个纹素）＋ gen_height_d.frag 的中心差分
 *   sampleHeight    ↔ texture(uHeight, uv)：RGBA16F、线性过滤、平铺（纹素中心约定与 GPU 相同；存储按半精度舍入）
 * 三维噪声（tNoise3 64³、tNoise3D 32³，RGBA8）只在 CPU 上生成后上传，没有着色器镜像。
 *
 * 接口：
 *   hash3(i, j, k) → [u32, u32, u32]           pcg3(x, y, z, out) 同上，写进 out
 *   perlin(p, period, seed)                     二维周期 Perlin（p＝[x, y]，单位“格”）；与 perlinT 同式
 *   perlinT(x, y, per, seed)                    同上，不用数组
 *   worley(p, period, seed) → F1                二维 Worley（格单位；period 省略＝不平铺）；worley.f2 是上一次的 F2
 *   heightRaw(x, y) → 未夹取的高度（x, y 为平铺坐标 [0,1)）
 *   heightTexel(i, j, out) → [R, G, B, A]       高度图第 (i, j) 个纹素的值（R 高度、GB 对 uv 偏导、A 材质；半精度舍入）
 *   sampleHeight(u, v, out, rOnly)              双线性取样（texture(uHeight, uv) 的镜像）
 *   gen3D(size, onSlice, opts) → {data, done, step(n), total, size}   三维噪声分帧生成（64 → 云形，32 → 细节）
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  fp.noise = fp.noise || {};
  var N = fp.noise;

  N.__stubs = [];
  N.HEIGHT_N = 1024;            // 高度图边长（与 passes.DEFS.gen_height.size 一致）
  N.HEIGHT_K = 1.45;            // 高度归一系数（gen_height.frag 里的 1.45；test/noise_mirror 校核）
  var TWO_PI_G = 6.2831853;     // 着色器里写的 2π（不是 Math.PI*2，照抄才逐位一致）

  /* ───────── PCG3D（Jarzynski & Olano 2020），uint 运算按 2³² 取模 ───────── */
  function pcg3(x, y, z, out) {
    x = (Math.imul(x | 0, 1664525) + 1013904223) | 0;
    y = (Math.imul(y | 0, 1664525) + 1013904223) | 0;
    z = (Math.imul(z | 0, 1664525) + 1013904223) | 0;
    x = (x + Math.imul(y, z)) | 0;
    y = (y + Math.imul(z, x)) | 0;
    z = (z + Math.imul(x, y)) | 0;
    x ^= x >>> 16; y ^= y >>> 16; z ^= z >>> 16;
    x = (x + Math.imul(y, z)) | 0;
    y = (y + Math.imul(z, x)) | 0;
    z = (z + Math.imul(x, y)) | 0;
    out[0] = x >>> 0; out[1] = y >>> 0; out[2] = z >>> 0;
    return out;
  }
  N.pcg3 = pcg3;
  N.hash3 = function (i, j, k) { return pcg3(i, j, k, [0, 0, 0]); };
  var H = [0, 0, 0];
  // 哈希的第一个分量映到 [0,1)（24 位，与着色器的 float(h >> 8u)/16777216.0 相同）
  function hash01(x, y, z, c) { pcg3(x, y, z, H); return (H[c || 0] >>> 8) / 16777216; }
  N.hash01 = hash01;

  /* ───────── 二维周期 Perlin（gen_height.frag 的 gradT／perlinT） ───────── */
  function wrapI(p, per) { return ((p % per) + per) % per; }
  var GR = [0, 0];
  function gradT(px, py, per, seed, out) {
    px = wrapI(px, per); py = wrapI(py, per);
    pcg3(px, py, seed, H);
    var a = (H[0] >>> 8) / 16777216 * TWO_PI_G;
    out[0] = Math.cos(a); out[1] = Math.sin(a);
    return out;
  }
  N.gradT = function (px, py, per, seed) { return gradT(px, py, per, seed, [0, 0]); };
  function mix(a, b, t) { return a * (1 - t) + b * t; }
  function perlinT(x, y, per, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    gradT(ix, iy, per, seed, GR); var n00 = GR[0] * fx + GR[1] * fy;
    gradT(ix + 1, iy, per, seed, GR); var n10 = GR[0] * (fx - 1) + GR[1] * fy;
    gradT(ix, iy + 1, per, seed, GR); var n01 = GR[0] * fx + GR[1] * (fy - 1);
    gradT(ix + 1, iy + 1, per, seed, GR); var n11 = GR[0] * (fx - 1) + GR[1] * (fy - 1);
    return 1.414 * mix(mix(n00, n10, ux), mix(n01, n11, ux), uy);
  }
  N.perlinT = perlinT;
  N.perlin = function (p, period, seed) { return perlinT(p[0], p[1], period, seed == null ? 0 : seed); };

  /* ───────── 二维 Worley（F1、F2，格单位） ───────── */
  N.worley = function (p, period, seed) {
    var x = p[0], y = p[1], ix = Math.floor(x), iy = Math.floor(y), f1 = 1e9, f2 = 1e9;
    seed = seed == null ? 5 : seed;
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var cx = ix + i, cy = iy + j, hx = cx, hy = cy;
      if (period) { hx = wrapI(cx, period); hy = wrapI(cy, period); }
      pcg3(hx, hy, seed, H);
      var dx = cx + (H[0] >>> 8) / 16777216 - x, dy = cy + (H[1] >>> 8) / 16777216 - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    N.worley.f2 = f2;
    return f1;
  };

  /* ───────── 高度图（gen_height.frag ＋ gen_height_d.frag 的镜像） ───────── */
  // 未夹取的高度：x, y 是平铺坐标（纹素 (i, j) 处为 i/1024、j/1024）
  N.heightRaw = function (x, y) {
    var f = 0, ridge = 0, a = 1, per = 32;
    for (var o = 0; o < 4; o++) { var n = perlinT(x * per, y * per, per, 11 + o); f += a * n; if (o < 2) ridge += a * (1 - Math.abs(n)); a *= 0.5; per *= 2; }
    return (0.6 * f + 0.4 * (ridge - 0.95)) * N.HEIGHT_K;   // 山脊项只取前两个八度（gen_height.frag 同改）
  };
  N.materialRaw = function (x, y) {
    var m = 0, a = 1, per = 16;
    for (var o = 0; o < 3; o++) { m += a * perlinT(x * per, y * per, per, 77 + o); a *= 0.5; per *= 2; }
    return 0.5 + 0.5 * m;
  };
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // 半精度舍入。GPU 把着色器的 float32 输出写进 RGBA16F 目标时向零截断（2026-10-14 在 ANGLE/D3D11 上实测：
  // gen_height 的 float32 与本镜像差 3e-7，转半精度后 300 个纹素里有一半差 1 ulp，全部是向零截断）。
  // N.HALF_ROUND＝'nearest' 可改成就近舍入（有的 GPU 这样做；两者至多差 1 ulp，第 0 层折合 ≤0.7 m，只影响碰撞与 uTerF0）
  N.HALF_ROUND = 'zero';
  var LN2 = Math.LN2;
  function toHalf(x) {
    if (x === 0 || x !== x) return x;
    var ax = Math.abs(x);
    if (ax >= 65520) return x > 0 ? Infinity : -Infinity;
    var e = Math.floor(Math.log(ax) / LN2);
    if (Math.pow(2, e) > ax) e--; else if (Math.pow(2, e + 1) <= ax) e++;
    if (e < -14) e = -14;
    var q = Math.pow(2, e - 10), r = (N.HALF_ROUND === 'nearest' ? Math.round(ax / q) : Math.floor(ax / q)) * q;
    return x < 0 ? -r : r;
  }
  N.toHalf = toHalf;

  // 纹素缓存（直接映射，4096 格）：只存 32 位高度与材质，GB 由相邻纹素差分
  var NH = N.HEIGHT_N, CMASK = 4095;
  var cKey = new Int32Array(CMASK + 1).fill(-1), cH = new Float32Array(CMASK + 1), mKey = new Int32Array(CMASK + 1).fill(-1), cM = new Float32Array(CMASK + 1);
  function slot(i, j) { return ((i * 73) ^ (j * 151)) & CMASK; }
  function h32(i, j) {           // gen_height 输出的 R（RGBA32F）
    i = wrapI(i, NH); j = wrapI(j, NH);
    var key = i * NH + j, s = slot(i, j);
    if (cKey[s] === key) return cH[s];
    var v = Math.fround(clamp(N.heightRaw(i / NH, j / NH), -1, 1));
    cKey[s] = key; cH[s] = v;
    return v;
  }
  function m32(i, j) {
    i = wrapI(i, NH); j = wrapI(j, NH);
    var key = i * NH + j, s = slot(i, j);
    if (mKey[s] === key) return cM[s];
    var v = Math.fround(clamp(N.materialRaw(i / NH, j / NH), 0, 1));
    mKey[s] = key; cM[s] = v;
    return v;
  }
  N.h32 = h32;
  // 高度图 tHeight 第 (i, j) 个纹素：R 高度，G、B 对 u、v 的偏导（中心差分，单位 1/uv），A 材质；都按半精度舍入
  N.heightTexel = function (i, j, out, rOnly) {
    out = out || [0, 0, 0, 0];
    out[0] = toHalf(h32(i, j));
    if (rOnly) return out;
    out[1] = toHalf(Math.fround((h32(i + 1, j) - h32(i - 1, j)) * 0.5 * NH));
    out[2] = toHalf(Math.fround((h32(i, j + 1) - h32(i, j - 1)) * 0.5 * NH));
    out[3] = toHalf(m32(i, j));
    return out;
  };
  // texture(uHeight, uv) 的镜像：纹素中心在 (i+0.5)/N，线性插值、平铺
  var T00 = [0, 0, 0, 0], T10 = [0, 0, 0, 0], T01 = [0, 0, 0, 0], T11 = [0, 0, 0, 0];
  N.sampleHeight = function (u, v, out, rOnly) {
    out = out || [0, 0, 0, 0];
    var x = u * NH - 0.5, y = v * NH - 0.5, i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
    N.heightTexel(i0, j0, T00, rOnly); N.heightTexel(i0 + 1, j0, T10, rOnly);
    N.heightTexel(i0, j0 + 1, T01, rOnly); N.heightTexel(i0 + 1, j0 + 1, T11, rOnly);
    var n = rOnly ? 1 : 4;
    for (var c = 0; c < n; c++) out[c] = (T00[c] * (1 - fx) + T10[c] * fx) * (1 - fy) + (T01[c] * (1 - fx) + T11[c] * fx) * fy;
    if (rOnly) { out[1] = 0; out[2] = 0; out[3] = 0; }
    return out;
  };

  /* ───────── 三维周期噪声（云形、细节；只在 CPU 上生成） ───────── */
  // 周期 Perlin（梯度取立方体 12 条棱向，表预先按格算好）
  var G12 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  function perlinTable(per, seed) {
    var t = new Uint8Array(per * per * per);
    for (var z = 0; z < per; z++) for (var y = 0; y < per; y++) for (var x = 0; x < per; x++) {
      pcg3(x, y, z * 131 + seed, H); t[(z * per + y) * per + x] = H[0] % 12;
    }
    return t;
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function perlin3(tab, per, x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    var u = fade(fx), v = fade(fy), w = fade(fz), r = 0;
    var n = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var c = 0; c < 8; c++) {
      var dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      var gx = wrapI(ix + dx, per), gy = wrapI(iy + dy, per), gz = wrapI(iz + dz, per);
      var gv = G12[tab[(gz * per + gy) * per + gx]];
      n[c] = gv[0] * (fx - dx) + gv[1] * (fy - dy) + gv[2] * (fz - dz);
    }
    var x00 = mix(n[0], n[1], u), x10 = mix(n[2], n[3], u), x01 = mix(n[4], n[5], u), x11 = mix(n[6], n[7], u);
    r = mix(mix(x00, x10, v), mix(x01, x11, v), w);
    return r;
  }
  N.perlin3 = function (x, y, z, per, seed) { return perlin3(perlinTable(per, seed || 0), per, x, y, z); };
  // 周期 Worley：每格一个特征点（表预先算好），返回 F1（格单位）
  function worleyTable(per, seed) {
    var t = new Float32Array(per * per * per * 3);
    for (var z = 0; z < per; z++) for (var y = 0; y < per; y++) for (var x = 0; x < per; x++) {
      pcg3(x, y, z * 977 + seed, H); var o = ((z * per + y) * per + x) * 3;
      t[o] = (H[0] >>> 8) / 16777216; t[o + 1] = (H[1] >>> 8) / 16777216; t[o + 2] = (H[2] >>> 8) / 16777216;
    }
    return t;
  }
  function worley3(tab, per, x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), f1 = 1e9;
    for (var k = -1; k <= 1; k++) for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var cx = ix + i, cy = iy + j, cz = iz + k, o = ((wrapI(cz, per) * per + wrapI(cy, per)) * per + wrapI(cx, per)) * 3;
      var dx = cx + tab[o] - x, dy = cy + tab[o + 1] - y, dz = cz + tab[o + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < f1) f1 = d;
    }
    return Math.sqrt(f1);
  }
  N.worley3 = function (x, y, z, per, seed) { return worley3(worleyTable(per, seed || 0), per, x, y, z); };

  // 两种体积（02 第十节第 1 条的 clouds.glsl 怎么用）：
  //   shape（64³）：r＝Perlin-Worley（云形），g/b/a＝Worley 4/8/16 格（着色器里按 0.625/0.25/0.125 合成 fbm）
  //   detail（32³）：r＝Perlin fbm，g/b/a＝Worley 2/4/8 格（细节侵蚀）
  N.NOISE3 = {
    shape: { perlin: [4, 8, 16], worley: [4, 8, 16], pw: true, seed: 101 },
    detail: { perlin: [2, 4, 8], worley: [2, 4, 8], pw: false, seed: 202 }
  };
  function inv(f) { return clamp(1 - f * 1.15, 0, 1); }             // Worley F1 → 亮斑在格心
  function b8(v) { return Math.round(clamp(v, 0, 1) * 255); }

  // gen3D(size, onSlice, opts)：opts.kind＝'shape'|'detail'（省略按 size：≥64 云形，否则细节）；
  //   opts.manual＝真：不自动排程，由调用方每帧 step(4)；否则自动每个空闲时刻 4 片（opts.perTick）
  //   onSlice(z, total) 每片回调。返回 {data: Uint8Array(size³·4), done: Promise, step(n) → 还有没有, total, size, kind}
  N.gen3D = function (size, onSlice, opts) {
    opts = opts || {};
    var kind = opts.kind || (size >= 64 ? 'shape' : 'detail'), cfg = N.NOISE3[kind];
    var data = new Uint8Array(size * size * size * 4), z = 0, total = size, resolve, tabs = null;
    var job = { data: data, total: total, size: size, kind: kind, z: 0 };
    job.done = new Promise(function (r) { resolve = r; });
    function prep() {
      tabs = {
        p: cfg.perlin.map(function (f, i) { return perlinTable(f, cfg.seed + i); }),
        w: cfg.worley.map(function (f, i) { return worleyTable(f, cfg.seed + 50 + i); })
      };
    }
    function slice(zz) {
      var inv1 = 1 / size;
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var u = (x + 0.5) * inv1, v = (y + 0.5) * inv1, w = (zz + 0.5) * inv1;
        var pn = 0, a = 1, as = 0;
        for (var o = 0; o < cfg.perlin.length; o++) { var f = cfg.perlin[o]; pn += a * perlin3(tabs.p[o], f, u * f, v * f, w * f); as += a; a *= 0.5; }
        pn = clamp(0.5 + 0.5 * pn / as * 1.6, 0, 1);
        var w0 = inv(worley3(tabs.w[0], cfg.worley[0], u * cfg.worley[0], v * cfg.worley[0], w * cfg.worley[0]));
        var w1 = inv(worley3(tabs.w[1], cfg.worley[1], u * cfg.worley[1], v * cfg.worley[1], w * cfg.worley[1]));
        var w2 = inv(worley3(tabs.w[2], cfg.worley[2], u * cfg.worley[2], v * cfg.worley[2], w * cfg.worley[2]));
        var r = pn;
        if (cfg.pw) { var wf = w0 * 0.625 + w1 * 0.25 + w2 * 0.125; r = clamp((pn - (wf - 1)) / (2 - wf), 0, 1); }   // remap(perlin, wf−1, 1, 0, 1)
        var o4 = ((zz * size + y) * size + x) * 4;
        data[o4] = b8(r); data[o4 + 1] = b8(w0); data[o4 + 2] = b8(w1); data[o4 + 3] = b8(w2);
      }
    }
    job.step = function (n) {
      if (z >= total) return false;
      if (!tabs) prep();
      n = n || 4;
      for (var i = 0; i < n && z < total; i++, z++) {
        slice(z); job.z = z + 1;
        if (onSlice) { try { onSlice(z, total); } catch (e) { /* 回调出错不影响生成 */ } }
      }
      if (z >= total) { resolve(data); return false; }
      return true;
    };
    if (!opts.manual) {
      var per = opts.perTick || 4;
      var sched = opts.schedule || (typeof G.requestAnimationFrame === 'function' ? function (f) { G.requestAnimationFrame(f); }
        : function (f) { setTimeout(f, 0); });
      var tick = function () { if (job.step(per)) sched(tick); };
      sched(tick);
    }
    return job;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
