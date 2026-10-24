#!/usr/bin/env node
/* test/eye_check.js —— 人眼与画质（M6）：TAA 的接入与改正、拍照累积的递推、重投影、眼与最终的 JS 镜像、档位表
 * 规格：spec/02 第十四节（TAA、测光、眼、暗视、眩光、最终）、第十五节第 1、2 条；spec/00 M6。负责：M6 路（fp/eye.js、glsl/eye_taa.frag）。
 * 2026-10-14 eye 路修订：问题单 1–18 的数值断言（key 由水平面照度定、转头摆幅、预滤波、快进、固定 EV、临边昏暗色、AgX look、暗视归一、局部适应、眩光颜色）。
 * GPU 上的对拍在 test/render_fp.js 的“第一人称·人眼”组（py build.py --harness）。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('eye_check');
const { ok, near, eq, section } = T;
const fp = HY.fp, ps = fp.passes, E = fp.eye, G = HY.glsl;
function strip(s) { return String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

section('1 接入：DEFS.taa 改指 eye_taa、历史 32F；DEFS.eye 拼 clouds、5×1；TAA_ACCUM、BLOOM_LV、TAA_DEPTH 宏');
{
  ok(E && E.wired === true, 'fp/eye.js 载入时接好了');
  const d = ps.DEFS.taa;
  eq(d.main, 'eye_taa', 'DEFS.taa 的主文件');
  eq(d.fmt, 'f32lin', 'tTAA 用 32F（无浮点线性过滤时 16F）');
  ok(d.out === 'tTAA' && d.pingpong === true && d.when === 'frame' && d.chunks.length === 1 && d.chunks[0] === 'post_common', '其余字段照旧：tTAA、乒乓、每帧、只拼 post_common');
  const de = ps.DEFS.eye;
  eq(de.chunks.join(','), 'common,shadow,clouds', 'DEFS.eye 拼 common＋shadow＋clouds（到眼日光沿日光方向步进体积云）');
  eq(JSON.stringify(de.size), '[5,1]', 'tEye 5×1（纹素 2–4：日光颜色、预滤波、环境状态、画面对数平均）');
  ok(de.pingpong === true && de.fmt === 'f32', 'tEye 仍是 32F 乒乓');
  const order = ps.ordered();
  ok(order.indexOf('composite') < order.indexOf('taa') && order.indexOf('rain') < order.indexOf('taa') && order.indexOf('taa') < order.indexOf('meter'), '次序不变：合成、雨丝 → TAA → 测光');
  ok(typeof G.eye_taa === 'string' && G.eye_taa.length > 500, 'glsl/eye_taa.frag 在 HY.glsl 里');
  const src = strip(ps.assemble('taa', G));
  ok(/-\s*uJitter\s*;/.test(src) && !/-\s*uPrevJitter\s*;/.test(src), '历史位置扣本帧抖动（不是 02 原式的上一帧）');
  ok(/uniform\s+vec2[^;]*\buPrevJitter\b/.test(src), 'uPrevJitter 仍声明（契约表里的名字有人用）');
  ok(/TAA_ACCUM/.test(src) && /NEAR_SCALE/.test(src) && /TAA_DEPTH/.test(src), '用到 TAA_ACCUM、NEAR_SCALE、TAA_DEPTH 三个画质宏');
  ok(/fragColor\s*=\s*vec4\([^;]*,\s*packA\(\s*n\s*,\s*c\.a\s*\)\s*\)\s*;/.test(src), 'a 通道写逐像素的等效样本数（整数部分）与视线距离编码（小数部分）');
  ok(/texelFetch\(\s*uEye\s*,\s*ivec2\(\s*3\s*,\s*0\s*\)/.test(src), 'TAA 读眼 pass 纹素 3（上一帧的模拟秒步长、雨丝在画）');
  for (const pass of ['taa', 'eye', 'meter', 'final']) {
    const us = fp.parseUniforms(ps.assemble(pass, G));
    ok(us.length > 0 && us.every(u => fp.uniformInfo(u.name) || (fp.PRIVATE[pass] || []).some(r => r[0] === u.name)), pass + ' 的 uniform 都在契约表里');
  }
  const want = { low: 8, mid: 16, high: 64, photo: 64 };   // 02 第十五节第 1 条“拍照累积帧数”
  for (const t of ps.TIER_NAMES) {
    eq(ps.TIER_OPTS[t].accum, want[t], `${t}：TIER_OPTS.accum`);
    eq(ps.TIERS[t].TAA_ACCUM, want[t].toFixed(1), `${t}：TAA_ACCUM 宏写成浮点字面量`);
    eq(ps.TIERS[t].BLOOM_LV, Math.min(ps.TIER_OPTS[t].bloomLevels, ps.DEFS.bloom_down.levels).toFixed(1), `${t}：BLOOM_LV＝眩光金字塔级数`);
    eq(ps.definesFor(t).TAA_DEPTH, '1', `${t}：TAA_DEPTH（节点里没有 gfx：按 32F 历史）`);
    eq(ps.targetSpecs(t, 640, 360, G).tTAA.fmt, 'f32lin', `${t}：tTAA 目标格式`);
    eq(ps.targetSpecs(t, 640, 360, G).tEye.w, 5, `${t}：tEye 宽 5`);
  }
  // 历史退回 16F 的设备：TAA_DEPTH 现取为 0
  const gfx0 = HY.gfx; HY.gfx = { caps: { ok: true, floatLinear: false } };
  eq(ps.definesFor('mid').TAA_DEPTH, '0', '没有浮点线性过滤（历史 16F）：TAA_DEPTH＝0，不比距离');
  HY.gfx = gfx0;
  ok(ps.Q_MACROS.indexOf('TAA_ACCUM') >= 0 && ps.Q_MACROS.indexOf('BLOOM_LV') >= 0, 'TAA_ACCUM、BLOOM_LV 进了 Q_MACROS');
  const fin = strip(ps.assemble('final', G));
  ok(!/vec3\(\s*1\.104\s*,\s*0\.978\s*,\s*0\.919\s*\)/.test(fin), 'final：失能眩光不再写死大气外日色（问题单 2、18）');
  ok(/texelFetch\(\s*uEye\s*,\s*ivec2\(\s*2\s*,\s*0\s*\)/.test(fin), 'final 读眼纹素 2（到眼日光的颜色）');
  const ey = strip(ps.assemble('eye', G));
  ok(/cloudSpanCam\s*\(/.test(ey) && /cloudDens\s*\(/.test(ey) && !/cloudShadowT\s*\(\s*vec2\(\s*0\.0\s*\)\s*\)/.test(ey), 'eye：到眼日光沿日光方向步进体积云，不再取相机处云影图的一个纹素（问题单 8）');
  ok(!/pow\(\s*La\s*\/\s*100\.0\s*,\s*0\.2\s*\)/.test(ey), 'eye：key 不再由画面亮度 (La/100)^0.2 定（问题单 4）');
  const mt = strip(ps.assemble('meter', G));
  ok(/uGlareK/.test(mt) && /1\.0e4\s*\*\s*Ee/.test(mt), 'meter：每个样本加上失能眩光的光幕（问题单 14）');
}

section('2 TAA：逐像素 n 的递推、雨天静止累积、距离编码（eye_taa.frag 的镜像）');
{
  const S = E.taa;
  eq(S.step(37, 1, true, 16).n, 1, '重置后第一帧（uBlend＝1）：n＝1，只用当前');
  eq(S.step(37, 0.05, false, 16).n, 1, '重投影出画（disocclusion）：n＝1');
  near(S.step(5, 0.1, true, 16).a, 0.1, 1e-12, '运动：α＝uBlend（02 的 α_min＝0.1）');
  near(S.step(5, 1 - Math.exp(-0.5), true, 16).a, 1 - Math.exp(-0.5), 1e-12, '×3600 快进：α 跟着 uBlend 放大，历史很快让位');
  near(S.step(10, 1 / 16, true, 16).a, 1 / 11, 1e-12, '刚停下：n 从运动时的等效 10 接着数，第一帧 α＝1/11（不跳回噪声）');
  eq(S.step(16, 1 / 16, true, 16).n, 17, '累积满 TAA_ACCUM 以后 n 继续数（问题单 13：不再停成指数平均）');
  eq(S.step(256, 1 / 16, true, 16).n, 256, 'n 上限 256');
  eq(S.step(64, 1 / 16, true, 16, { depth16: true }).n, 64, '历史 16F 时上限 64');
  ok(S.isStill(1 / 8, 8) && !S.isStill(0.1, 8) && !S.isStill(0.1, 16) && S.isStill(1 / 16, 16) && S.isStill(1 / 64, 64), '静止的判断：低档 1/8（比 0.1 大）也算静止，0.1 不算');
  eq(S.step(10, 1 / 8, true, 8).n, 11, '低档刚停下：n 从 10 接着数');
  // 雨丝、余息飘尘在画、相机与时间不动：帧图给 0.1，这里照样累积到 32（问题单 3）
  eq(S.step(5, 0.1, true, 16, { rainStill: true }).n, 6, '雨天静止：uBlend＝0.1 也累积');
  eq(S.step(32, 0.1, true, 16, { rainStill: true }).n, 32, '雨天静止：上限 32');
  near(S.step(5, 0.1, true, 16, { rainStill: false }).a, 0.1, 1e-12, '雨天但相机在动：照旧 α＝0.1');
  for (const t of ps.TIER_NAMES) {
    const acc = ps.TIER_OPTS[t].accum;
    ok(S.isStill(ps.taaAlpha(500, 0, true, acc), acc) && !S.isStill(ps.taaAlpha(500, 1 / 60, false, acc), acc) && !S.isStill(ps.taaAlpha(500, 60, false, acc), acc),
      `${t}：静止 uBlend＝${ps.taaAlpha(500, 0, true, acc).toFixed(4)} 判静止，平时 ${ps.taaAlpha(500, 1 / 60, false, acc)} 与快进不判`);
  }
  // 在 passes 的 uBlend 序列下（静止、从重置数起），前 300 帧都是严格的等权平均（不再在 accum 处变成指数平均）
  for (const acc of [8, 16, 64]) {
    let n = 0, o = 0, sum = 0, worst = 0, r = 12345;
    for (let k = 1; k <= 256; k++) {
      r = (r * 1103515245 + 12345) % 2147483648; const x = r / 2147483648;
      const st = S.step(n, ps.taaAlpha(k, 0, true, acc), true, acc);
      n = st.n; o = o + (x - o) * st.a; sum += x;
      worst = Math.max(worst, Math.abs(o - sum / k));
    }
    ok(worst < 1e-9 && n === 256, `静止 256 帧（TAA_ACCUM ${acc}）：每一帧的输出都等于到此为止的平均（最大差 ${worst.toExponential(1)}）`);
  }
  // 残余噪声：静止 256 帧后约为单帧的 1/16（原先封顶 16 帧的指数平均是 0.18 倍）
  {
    let n = 0, o = 0, r = 777, acc2 = 0, cnt = 0;
    for (let k = 1; k <= 600; k++) {
      r = (r * 1103515245 + 12345) % 2147483648; const x = r / 2147483648 - 0.5;
      const st = S.step(n, ps.taaAlpha(k, 0, true, 16), true, 16); n = st.n; o += (x - o) * st.a;
      if (k > 300) { acc2 += o * o; cnt++; }
    }
    const rms = Math.sqrt(acc2 / cnt) / Math.sqrt(1 / 12);
    ok(rms < 0.12, `中档静止 300 帧后残余噪声是单帧的 ${rms.toFixed(3)} 倍（< 0.12；原先 0.18）`);
  }
  near(S.boxWeight(0), 1, 1e-12, '重投影不动：外圈全部并进裁剪框');
  near(S.boxWeight(3), 0.6, 1e-12, '位移 3 像素：外圈仍并进六成（问题单 9：转头时近段一个纹素里方差为零，网纹原样露出）');
  eq(S.stride(0.25), 4, '中档外圈步长 4 像素'); eq(S.stride(0.5), 2, '高档外圈步长 2 像素');
  // 距离编码：32F 的 a＝n＋code，n ≤ 256 时距离的相对精度好于 0.1%
  let wd = 0;
  for (const n of [1, 10, 16, 64, 256]) for (const km of [0.0005, 0.0016, 0.012, 0.6, 37, 4000]) {
    const a = Math.fround(S.pack(n, km)), u = S.unpack(a);
    if (u.n !== n) wd = 1;
    wd = Math.max(wd, Math.abs(Math.log(u.km / km)));
  }
  ok(wd < 1e-3, `a 通道（float32）里 n 与距离都取得回来（距离最大相对误差 ${wd.toExponential(1)}）`);
  ok(S.moved(0.0016, 0.00145) && !S.moved(0.0016, 0.00159) && !S.moved(0.5, 0.3), '近处（60 m 内）距离对不上 3%：不用历史（摆动的草叶）；远处不比（不伤远处轮廓的抗锯齿）');
}

section('3 重投影：历史位置扣本帧抖动');
{
  const S = E.taa, W = 960, H = 540, th = Math.tan(27.5 * Math.PI / 180);
  const cam = { pos: [0, 0, 0], fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
  let worst = 0, worst02 = 0;
  for (let f = 0; f < 16; f++) {
    const J = ps.jitter(f), Jp = ps.jitter(f - 1);
    for (const fc of [[0.5, 0.5], [480.5, 270.5], [959.5, 12.5], [77.5, 501.5]]) {
      for (const dist of [0.002, 3, 900]) {
        const p = S.histPos(fc, [J, Jp], cam, cam, dist, [W, H], th, 'eye');
        worst = Math.max(worst, Math.hypot(p[0] - fc[0], p[1] - fc[1]));
        const q = S.histPos(fc, [J, Jp], cam, cam, dist, [W, H], th, '02');
        worst02 = Math.max(worst02, Math.abs(Math.hypot(q[0] - fc[0], q[1] - fc[1]) - Math.hypot(J[0] - Jp[0], J[1] - Jp[1])));
      }
    }
  }
  ok(worst < 1e-6, `静止相机：16 个抖动下历史都正落在本像素中心（最大偏 ${worst.toExponential(1)} 像素）`);
  ok(worst02 < 1e-6, '对照：02 原式每帧把历史挪 |J−J′|（静止也挪，见 eye_taa.frag 改正 1）');
  // 转头 1°：历史位置＝像素中心那条视线在上一帧画面里的位置（抖动只差二阶小量）
  const a = Math.PI / 180, prev = { pos: [0, 0, 0], fwd: [Math.sin(a), 0, Math.cos(a)], right: [Math.cos(a), 0, -Math.sin(a)], up: [0, 1, 0] };
  let wr = 0;
  for (let f = 0; f < 16; f++) {
    const J = ps.jitter(f), fc = [700.5, 300.5];
    const p = S.histPos(fc, [J, ps.jitter(f - 1)], cam, prev, 5, [W, H], th, 'eye');
    const c0 = S.histPos(fc, [[0, 0], [0, 0]], cam, prev, 5, [W, H], th, 'eye');
    wr = Math.max(wr, Math.hypot(p[0] - c0[0], p[1] - c0[1]));
  }
  ok(wr < 0.01, `转头 1°：带抖动的视线算出的历史位置与不带抖动的差 ${wr.toFixed(4)} 像素（< 0.01）`);
}

section('4 眼（eye.frag 的镜像；问题单 4、5、10、12、14、15、16、2、8）');
{
  const ev = (a, b) => Math.log2(a / b);
  // key：由水平面照度定，整段连续（问题单 4）；以圣禁城晴天正午为基准
  const k0 = E.key(133000);
  near(k0, 0.18, 1e-12, 'key：圣禁城晴天正午（133 klux）满额 0.18');
  const kRui = ev(E.key(10060), k0), kWhite = ev(E.key(4790), k0), kRuiN = ev(E.key(594), k0), k19 = ev(E.key(19), k0), kMoon = ev(E.key(0.2), k0);
  ok(kRui < -0.4 && kRui > -0.9, `罪域阴雨正午（10 klux）${kRui.toFixed(2)} EV（−0.5 上下）`);
  ok(kWhite < -0.7 && kWhite > -1.1, `白夜（4.8 klux）${kWhite.toFixed(2)} EV（−0.7 到 −1）`);
  ok(kRuiN < -1.5 && kRuiN > -2.1, `罪域子夜（594 lux）${kRuiN.toFixed(2)} EV（−1.5 到 −2）`);
  ok(k19 < -2.6 && k19 > -3.3, `十几 lux ${k19.toFixed(2)} EV（约 −3）`);
  ok(kMoon < -4 && kMoon > -5.2, `月光量级（0.2 lux）${kMoon.toFixed(2)} EV（−4 到 −5）`);
  let mono = true, p = 0;
  for (let L = -3; L <= 6; L += 0.05) { const k = E.key(Math.pow(10, L)); if (k < p - 1e-15) mono = false; p = k; }
  ok(mono && E.key(1e-6) > 0, 'key 随照度单调、处处为正（下限 0.0018）');
  // 适应亮度＝环境项与画面项（问题单 5）：原地转头，画面亮度摆 3.6 EV，适应亮度只摆 1 EV 上下
  const Lenv = E.envL(10.06);
  near(Lenv, 0.3 * 10060 / Math.PI, 1e-9, '环境项＝0.3·E_水平/π（与朝向无关）');
  const frames = [233, 400, 790, 1290, 2786], las = frames.map(f => E.mixTarget(f, Lenv));
  const span = ev(Math.max(...las), Math.min(...las));
  ok(span < 1.15, `罪域正午原地转头：画面 ${ev(2786, 233).toFixed(1)} EV 的起伏，适应目标只差 ${span.toFixed(2)} EV`);
  ok(E.mixTarget(233, Lenv) < E.mixTarget(790, Lenv) && E.mixTarget(790, Lenv) < E.mixTarget(2786, Lenv), '仍随画面单调（低头看地比看天暗，但不再被拉回中灰）');
  near(ev(E.mixTarget(Lenv * 8, Lenv), Lenv), 1.4, 1e-9, '画面比环境亮 3 EV（迎着晨昏的亮云）：多跟一些（1.4 EV），不至于一片白');
  // 一步适应：变亮 τ 0.6 s（环境变了）／0.4 s（只是转头），变暗 3 s／0.6 s
  const lr = (a, b, c) => (Math.log(c) - Math.log(a)) / (Math.log(b) - Math.log(a));
  near(lr(1, 100, E.adapt(1, 100, 0.6, { env: true })), 1 - Math.exp(-1), 1e-9, '环境变亮 τ＝0.6 s');
  near(lr(1000, 10, E.adapt(1000, 10, 3, { env: true })), 1 - Math.exp(-1), 1e-9, '环境变暗 τ＝3 s（明视范围内）');
  near(lr(100, 30, E.adapt(100, 30, 0.6, { env: false })), 1 - Math.exp(-1), 1e-9, '只是转头、变暗：τ＝0.6 s（低头不再先黑、再慢慢浮出来）');
  ok(lr(1, 0.01, E.adapt(1, 0.01, 3, { env: true })) < 0.25, '往中间视、暗视里走：暗适应慢得多（3 s 只走了 ' + (100 * lr(1, 0.01, E.adapt(1, 0.01, 3, { env: true }))).toFixed(0) + '%）');
  eq(E.adapt(0, 50, 0.016), 50, '首帧（没有上一帧）直接取目标');
  near(E.adapt(10, 1e-9, 1e9), E.LA_MIN, 1e-12, '目标夹在 0.003 cd/m²');
  ok(lr(100, 103, E.adapt(100, 103, 0.1)) < 0.5 * (1 - Math.exp(-0.1 / 0.4)), '差不到 0.1 EV：只以四分之一的速度跟（噪声不抽动）');
  // 测光目标逐帧乱跳（赤道沟底：±2.5 EV 的噪声）：曝光应等于场景平均（问题单 10）
  {
    let st = null, r = 99, lnsum = 0, n = 0, worstStep = 0, prevLa = 0, lnTsum = 0;
    for (let k = 0; k < 2400; k++) {
      r = (r * 1103515245 + 12345) % 2147483648; const u = r / 2147483648;
      const fr = 105 * Math.pow(2, (u - 0.5) * 5);                // 40–600 cd/m²，几何平均 105
      st = E.eyeStep(st, { dt: 1 / 60, dtSim: 0, LaFrame: fr, Eh: 105 / 0.3 * Math.PI / 1000 }, { auto: true });
      if (k > 600) { lnsum += Math.log(st.La); n++; if (prevLa) worstStep = Math.max(worstStep, Math.abs(Math.log2(st.La / prevLa))); lnTsum += Math.log(fr); }
      prevLa = st.La;
    }
    const bias = Math.log2(Math.exp(lnsum / n) / 105);
    ok(Math.abs(bias) < 0.15, `测光目标逐帧在 ±2.5 EV 里乱跳：适应亮度的几何平均偏 ${bias.toFixed(3)} EV（原先“变亮快、变暗慢”偏 +0.8 EV；剩下的是“亮处多跟一些”本身的不对称）`);
    ok(worstStep < 0.02, `逐帧的曝光变化最大 ${(worstStep * 100).toFixed(2)}% EV（看不出闪）`);
  }
  // 快进 ×3600：目标连续下降时，适应亮度落后不超过 0.3 EV（问题单 15）
  {
    let st = null, worst = 0;
    for (let k = 0; k < 240; k++) {
      const fr = 12000 * Math.pow(2, -k / 40);                    // 每秒掉 1.5 EV（日面滑进塔缘）
      st = E.eyeStep(st, { dt: 1 / 60, dtSim: 60, LaFrame: fr, Eh: 12000 / 0.3 * Math.PI / 1000 * Math.pow(2, -k / 40) }, { auto: true });
      if (k > 10) worst = Math.max(worst, Math.abs(Math.log2(st.La / E.mixTarget(fr, E.envL(12000 / 0.3 * Math.PI / 1000 * Math.pow(2, -k / 40))))));
    }
    ok(worst < 0.45, `×3600 快进时适应亮度落后目标最多 ${worst.toFixed(2)} EV（原先 1.5 EV）`);
  }
  // 曝光与读数（问题单 16）：锁在读数显示的 EV 上，画面不变
  const La = 727, key = E.key(10060), auto = E.exposure(La, { auto: true }, key), evShown = fp.set.ev(E.laEq(La, key));
  near(E.exposure(La, { auto: false, evLock: evShown }), auto, 1e-9 * auto, `自动曝光读数 EV ${evShown.toFixed(2)}：锁在它上面曝光不变（原先暗 0.79 EV）`);
  near(E.exposure(1000, { auto: true }, 0.18), 0.18, 1e-12, '自动曝光：key 0.18、La＝1000 cd/m² 时每 kn 乘 0.18');
  near(E.exposure(1000, { auto: true, evComp: 1 }, 0.18), 0.36, 1e-12, 'EV 补偿 +1：翻倍');
  near(E.exposure(1, { auto: false, evLock: 10 }), 0.18 / (1024 * 0.125) * 1000, 1e-12, '固定 EV 10：0.18/(2^10·0.125)（测光表 K＝12.5）');
  near(E.meterClamp(1e9, 100), Math.log(100) + 5 * Math.LN2, 1e-4, '测光样本截到 +5 EV（日面以外的亮点不把曝光拽走）');
  near(E.meterClamp(1e-9, 100), Math.log(100) - 5 * Math.LN2, 1e-4, '截到 −5 EV');
  // 光幕计入测光（问题单 14）：直视 100 klux 的太阳，画面里平均光幕约为适应亮度的四成
  {
    let s = 0, n = 0;
    for (let y = -35; y <= 35; y += 1) for (let x = -50; x <= 50; x += 1) { const th = Math.hypot(x, y); if (th < 1) continue; s += Math.log(1000 + E.veil(100, th, 1, Math.tan(35 * Math.PI / 180))); n++; }
    const up = Math.exp(s / n) / 1000;
    ok(up > 1.15, `直视太阳时测光的对数平均被光幕抬高 ${up.toFixed(2)} 倍（四周显得更暗、塔缘衬成剪影）`);
  }
  // 日面露出部分的临边昏暗色（问题单 2）：最后一线是 3000 K 上下的橙色光
  const t1 = E.limbTint(1), t50 = E.limbTint(0.5), t03 = E.limbTint(0.03);
  ok(t1.every(v => Math.abs(v - 1) < 1e-9) && t50.every(v => Math.abs(v - 1) < 1e-6), '整盘、切去一半（直边过日心）：平均色不变');
  ok(t03[0] > t03[1] && t03[1] > t03[2] && t03[2] / t03[0] < 0.8, `露出 3%：露出部分偏橙 (${t03.map(v => v.toFixed(2)).join(', ')})`);
  let mon = true, pr = 2;
  for (let f = 0.5; f > 0.001; f *= 0.8) { const t = E.limbTint(f), q = t[2] / t[0]; if (q > pr + 1e-9) mon = false; pr = q; }
  ok(mon, '露得越少越橙（蓝/红单调降）');
  for (const f of [0.01, 0.1, 0.3, 0.7, 0.95]) {
    const ue = (() => { let a = -1, b = 1; for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (E.limbFrac(m) < f) a = m; else b = m; } return (a + b) / 2; })();
    // 数值积分：露出部分 ⟨I(μ)⟩
    let s = [0, 0, 0], A = 0;
    for (let i = 0; i < 400; i++) for (let j = 0; j < 400; j++) {
      const x = -1 + (i + 0.5) / 200, y = -1 + (j + 0.5) / 200, r2 = x * x + y * y;
      if (r2 >= 1 || x > ue) continue;
      const mu = Math.sqrt(1 - r2); A++;
      [0.55, 0.70, 0.85].forEach((u, k) => { s[k] += (1 - u * (1 - mu)) / (1 - u / 3); });
    }
    const t = E.limbTint(f), err = Math.max(...s.map((v, k) => Math.abs(v / A - t[k])));
    ok(err < 0.01, `临边昏暗色的闭式与数值积分一致（露出 ${f}：差 ${err.toFixed(4)}）`);
  }
}

section('5 最终（final.frag 的镜像；问题单 6、7、11、12、18）');
{
  const g = v => E.srgb(E.agx([v, v, v]))[1], gb = v => E.srgb(E.agxBase([v, v, v]))[1];
  let mono = true, p = -1;
  for (let k = -14; k <= 8; k += 0.05) { const y = g(Math.pow(2, k)); if (y < p - 1e-9) mono = false; p = y; }
  ok(mono, 'AgX（加 look）对灰阶单调');
  near(gb(0.18), 0.50, 0.01, 'AgX base：中灰 0.18 → 显示 0.50（对照）');
  const mid = 255 * g(0.18);
  ok(mid > 105 && mid < 116, `AgX look：中灰落在 sRGB ${mid.toFixed(1)}（105–115）`);
  const sl = (Math.log(E.agx([0.18 * 1.02, 0.18 * 1.02, 0.18 * 1.02])[1]) - Math.log(E.agx([0.18 / 1.02, 0.18 / 1.02, 0.18 / 1.02])[1])) / (2 * Math.log(1.02));
  const slb = (Math.log(E.agxBase([0.1836, 0.1836, 0.1836])[1]) - Math.log(E.agxBase([0.18 / 1.02, 0.18 / 1.02, 0.18 / 1.02])[1])) / (2 * Math.log(1.02));
  ok(sl > 1.0 && sl < 1.35 && slb < 0.85, `中灰处对数斜率 ${sl.toFixed(2)}（base ${slb.toFixed(2)}）`);
  ok(g(16) > 0.99 && g(1000) <= 1.0, 'AgX：高光走向白（16 倍中灰以上 > 0.99）');
  ok(Math.abs(255 * g(0.035) - 255 * gb(0.035)) < 14, `暗部不比 base 黑太多（0.035 → ${(255 * g(0.035)).toFixed(0)}，base ${(255 * gb(0.035)).toFixed(0)}；夜里的红土仍看得见）`);
  const sat = c => { const m = Math.max(...c), n = Math.min(...c); return (m - n) / m; };
  ok(sat(E.srgb(E.agx([0.3, 0.15, 0.06]))) > 1.1 * sat(E.srgb(E.agxBase([0.3, 0.15, 0.06]))), 'look：红土更饱和');
  const c = E.srgb(E.agx([0.4, 0.4, 0.4]));
  ok(Math.abs(c[0] - c[1]) < 2e-3 && Math.abs(c[2] - c[1]) < 2e-3, 'AgX：中性灰仍是中性');
  ok(E.srgb(E.aces([1000, 1000, 1000])).every(x => x <= 1 && x > 0.99), 'ACES（对照）：高光夹到 1');
  // 暗视（问题单 12）：按白点归一后，中性灰明度大致不变（原先 ×1.6），红变暗、蓝变亮
  eq(E.scotopicK(3, 1), 0, '暗视：适应 3 cd/m² 以上不混'); near(E.scotopicK(0.003, 1), 1, 1e-12, '0.003 cd/m² 全混');
  eq(E.scotopicK(0.003, 0), 0, '暗视开关关掉不混');
  const Y = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const gr = E.scotopic([0.18, 0.18, 0.18], 1), rd = E.scotopic([0.30, 0.12, 0.06], 1), bl = E.scotopic([0.06, 0.12, 0.30], 1);
  const rg = Y(gr) / 0.18, rr = Y(rd) / Y([0.30, 0.12, 0.06]), rb = Y(bl) / Y([0.06, 0.12, 0.30]);
  ok(rg > 0.82 && rg < 1.02, `暗视：中性灰明度 ×${rg.toFixed(2)}（原先 ×1.6）`);
  ok(rr < 0.8, `暗视：红变暗 ×${rr.toFixed(2)}（浦肯野）`); ok(rb > 1.2, `暗视：蓝变亮 ×${rb.toFixed(2)}`);
  ok(gr[2] > gr[0], '暗视：略偏蓝');
  const ch = v => Math.max(...v) - Math.min(...v);
  ok(ch(E.scotopic([0.5, 0.3, 0.2], 1)) < ch([0.5, 0.3, 0.2]), '暗视：去饱和');
  // 失能眩光
  near(E.glare(10, 1, 1), 100, 1e-9, '失能眩光 L＝10·E/θ²（E 10 klux、θ 1°）');
  eq(E.glare(10, 0.1, 1), E.glare(10, 0.3, 1), 'θ＜0.3° 截平'); eq(E.glare(10, 45, 1), 0, '40° 以外为零');
  ok(E.glare(10, 30, 1) < 10 * 10 / 900 && E.glare(10, 30, 1) > 0, '20–40° 之间淡出');
  const th8 = Math.tan(4 * Math.PI / 180);
  ok(E.glare(10, 2, 1, th8) < E.glare(10, 2, 1) / 50, '望远（视角 8°）：按眼看到的角度算，光雾不再铺满半个画面');
  // 局部适应（问题单 6）
  near(E.localGain(150, 150), 1, 1e-12, '局部亮度等于适应亮度：不补');
  near(Math.log2(E.localGain(150 / 16, 150)), 0.35 * 2, 1e-9, '暗 4 EV 的地面：提 0.7 EV（35%、限 ±2 EV）');
  eq(E.localGain(150 * 16, 150), 1, '亮处不压（压亮处会在日面、亮云四周压出一圈暗晕）');
  near(E.mixTarget(5000, 1000, Math.tan(4 * Math.PI / 180)), 5000, 1e-9, '望远（视角 8°）：适应全跟画面（画面只是注视的那一小块）');
  // 整条链在“新旧曝光相同、无眩光、无色适应、明视”时就是 sRGB(AgX(hdr))
  const hdr = [0.3, 0.2, 0.1], fin = E.finalPixel({ hdr, eN: [1, 1000, 0], eP: [1, 1000, 0], th: 90 });
  const ref = E.srgb(E.agx(hdr));
  ok(fin.every((v, i) => Math.abs(v - ref[i]) < 1e-12), 'finalPixel：退化情形等于 sRGB(AgX(hdr))');
  const fin2 = E.finalPixel({ hdr, eN: [2, 1000, 0], eP: [1, 1000, 0], th: 90 }), ref2 = E.srgb(E.agx(hdr.map(v => 2 * v)));
  ok(fin2.every((v, i) => Math.abs(v - ref2[i]) < 1e-12), 'finalPixel：HDR 乘的是旧曝光，按新/旧之比补');
  const warm = fp.set.catMatrix([1, 0.75, 0.45], 0.7), fin3 = E.finalPixel({ hdr: [1, 0.75, 0.45], eN: [0.2, 1000, 0], eP: [0.2, 1000, 0], cat: warm, th: 90 });
  ok(Math.abs(fin3[0] - fin3[2]) < Math.abs(E.srgb(E.agx([0.2, 0.15, 0.09]))[0] - E.srgb(E.agx([0.2, 0.15, 0.09]))[2]), '色适应：照明色拉向白（强度 0.7）');
  // 眩光颜色＝到眼日光的实际颜色（问题单 18）
  const gw = E.finalPixel({ hdr: [0, 0, 0], eN: [0.01, 1000, 1], eP: [0.01, 1000, 1], th: 3, Ergb: [1.0, 0.7, 0.3] });
  const gn = E.finalPixel({ hdr: [0, 0, 0], eN: [0.01, 1000, 1], eP: [0.01, 1000, 1], th: 3, Ergb: [0.95, 1.0, 1.05] });
  ok(gw[0] - gw[2] > gn[0] - gn[2] + 0.05, '失能眩光的颜色跟着日光：透过厚空气的日光，光雾偏金黄');
}

section('6 档位（02 第十五节第 1 条：内部比例、眩光级数、累积帧数、雨丝）');
{
  const O = ps.TIER_OPTS;
  eq(JSON.stringify(O.low.res), '[0.45,0.6]', '低：内部比例 0.45–0.6'); eq(JSON.stringify(O.mid.res), '[0.5,0.75]', '中：0.5–0.75');
  eq(JSON.stringify(O.high.res), '[0.75,1]', '高：0.75–1.0'); eq(JSON.stringify(O.photo.res), '[1,1]', '拍照：1.0');
  eq([O.low, O.mid, O.high, O.photo].map(o => o.bloomLevels).join(','), '4,5,5,5', '眩光金字塔 4／5／5／5 级');
  ok([O.low, O.mid, O.high, O.photo].every(o => typeof o.rain === 'boolean'), '屏幕雨丝、余息飘尘：各档有开关（clouds 路已让低档也画）');
  // 动态分辨率（02 第十五节第 2 条）：目标 30 ms；在下限仍超时 2 秒报降档；上限且 >55 fps 持续 5 秒提示可升档
  const d = ps.DynRes(O.mid.res);
  let down = -1, t = 0;
  for (let k = 0; k < 2000 && down < 0; k++) { const r = d.update(0.045); t += 0.045; if (r.down) down = t; }
  ok(d.scale === O.mid.res[0] && down > 0, `持续 45 ms：比例降到下限 ${d.scale}，${down.toFixed(1)} 秒后报降档`);
  const u = ps.DynRes(O.mid.res); let up = -1; t = 0;
  for (let k = 0; k < 2000 && up < 0; k++) { const r = u.update(0.012); t += 0.012; if (r.up) up = t; }
  ok(up > 5 && up < 9, `持续 12 ms：${up.toFixed(1)} 秒后提示可升档（升档要用户同意）`);
}

section('7 累积进度与“出一张”（node 里没有画面）');
{
  const a = E.accum();
  ok(a && a.still === false && a.n === 0 && a.done === false, 'accum()：没进第一人称时为空');
  let rej = null;
  E.shoot().then(() => { rej = 'resolved'; }, e => { rej = e && e.message; }).then(() => {
    ok(rej === '先进入第一人称', 'shoot()：没进第一人称时拒绝（' + rej + '）');
    T.done();
  });
}
