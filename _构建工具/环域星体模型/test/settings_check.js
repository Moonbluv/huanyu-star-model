#!/usr/bin/env node
/* test/settings_check.js —— state.fp.* → uniform、重建标志、余息、风、照明色适应、眼的读回解码（规格：spec/03 第七节第 5 条；
 * spec/02 第七、十四节、附录 A；统筹修订第 2–4 条）。负责：E 路。
 */
'use strict';
const load = require('./_load.js');
const HY = load();
const T = load.tester('settings_check');
const { eq, near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
const S = HY.fp.set, U0 = HY.util;
const P = HY.model && HY.model.P ? HY.model.P : HY.astro.params();
const clone = o => JSON.parse(JSON.stringify(o));
const base = () => clone(HY.state);

section('1 默认值的映射');
{
  const st = base(), v = S.values(st, P);
  const names = HY.fp.UNIFORMS.filter(r => r[3] === 'set').map(r => r[0]).sort();
  eq(JSON.stringify(Object.keys(v).sort()), JSON.stringify(names), 'values 恰好给出全部写入方为 set 的 uniform');
  eq(v.uZtop, 400, '大气顶 min(10·max(40, 6), 800)＝400 km');
  near(v.uBetaMs, 0.9 * (3.912 / 200 - 13.558e-3), 1e-9, '米氏散射：(3.912/V − β_R,绿)·0.9');
  near(v.uBetaMa, 0.1 * (3.912 / 200 - 13.558e-3), 1e-9, '米氏吸收：·0.1');
  eq(v.uVeilK, 0, '统筹修订第 2 条：夜幕默认关 → uVeilK＝0（如实画白夜）');
  eq(v.uGroundMode, 1, '统筹修订第 4 条：默认阶地 → uGroundMode＝1');
  eq(v.uAcid[3], 0, '酸霾默认关'); eq(v.uSheath[0], 0, '塔缘气层默认 0'); eq(v.uTowerAlb, 0, '塔反照率默认 0');
  eq(v.uAbyssFog, 1, '深渊雾默认开'); eq(v.uPurkinje, 1, '暗视觉默认开');
  near(v.uBloomK, 0.03 / ps().TIER_OPTS.mid.bloomLevels, 1e-12, '眩光权重按档位的级数归一');
  near(S.values(st, P, null, undefined, 'low').uBloomK, 0.03 / ps().TIER_OPTS.low.bloomLevels, 1e-12,
    '帧图实际在用“低”档（启动先编低档、state 要的是中档）：按低档 4 级归一');
  const U2 = HY.fp.makeU(null); S.apply(st, P, U2, null, 'low');
  near(U2.uBloomK.value, 0.03 / ps().TIER_OPTS.low.bloomLevels, 1e-12, 'apply 也认实际档位'); S.forget(U2);
  eq(JSON.stringify(v.uEyeCfg), JSON.stringify([1, 12, 0, 0.7]), 'uEyeCfg＝[自动, 固定 EV 12, 补偿 0, 色适应 0.7]');
}
function ps() { return HY.fp.passes; }

section('2 统筹修订：夜幕开关与强度、地面模式、大气开关');
{
  const st = base();
  st.fp.set.veil = true; st.fp.set.veilK = 0.3;
  near(S.values(st, P).uVeilK, 0.3e-3, 1e-12, '打开静滞夜幕、强度 0.3 /千公里 → uVeilK＝3×10⁻⁴ /km');
  st.fp.set.veil = false;
  eq(S.values(st, P).uVeilK, 0, '关掉夜幕：强度滑杆不起作用');
  st.fp.ground.mode = 'slope';
  eq(S.values(st, P).uGroundMode, 0, '“顺着球面的斜坡” → uGroundMode＝0');
  st.fp.ground.mode = 'terrace';
  eq(S.groundMode(st, P, 0), 0, '相机此刻按斜坡（赤道附近）→ GPU 跟它一致');
  if (HY.fp.cam && HY.fp.cam.groundMode) {
    const s2 = base(); s2.site.s = P.R * Math.PI / 2 + 50;     // 纬度 < 2°
    eq(S.groundMode(s2, P), 0, '没给相机模式时按地点纬度判（< 2° 退回斜坡）');
  }
  const off = base(); off.fp.atmo.on = false;
  const vo = S.values(off, P);
  ok(vo.uBetaR.every(x => x === 0) && vo.uBetaMs === 0 && vo.uBetaMa === 0 && vo.uAtmoOn === 0, '大气总开关关掉：全部系数置 0');
  eq(S.values(off, P).uRainBeta, 0, '大气关：雨雾也没有');
}

section('3 重建标志（03 第七节第 5 条）');
{
  const U = HY.fp.makeU(null), st = base();
  const r0 = S.apply(st, P, U);
  ok(r0.first && r0.lut && r0.weather && r0.world && r0.horizon && r0.inst && r0.reset, '第一次 apply：全部为真');
  const r1 = S.apply(st, P, U);
  ok(!r1.lut && !r1.weather && !r1.world && !r1.horizon && !r1.reset && !r1.recompile.length, '没改状态：全假');
  st.fp.atmo.HR = 30; const r2 = S.apply(st, P, U);
  ok(r2.lut && r2.reset && !r2.weather, '改 fp.atmo.*：查找表重算、历史清零');
  eq(U.uHR.value, 30, '…并写入 uHR');
  st.fp.cloud.cover = 0.6; const r3 = S.apply(st, P, U);
  ok(r3.weather && !r3.lut, '改云覆盖：天气图重烘');
  st.fp.cloud.base = 2; const r4 = S.apply(st, P, U);
  ok(!r4.weather && !r4.lut, '改云底：只改 uniform');
  st.fp.ground.W = 2; const r5 = S.apply(st, P, U);
  ok(r5.horizon && r5.inst && r5.recam, '改地面：地平线角图失效、实例重放、相机重新贴地');
  st.zones.gLight = 0.8; const r6 = S.apply(st, P, U);
  ok(r6.world && r6.horizon, '改分域：世界底图重烘');
  st.fp.eyeo.tone = 'aces'; const r7 = S.apply(st, P, U);
  eq(JSON.stringify(r7.recompile), '["final"]', '改色调：final 重编');
  eq(S.defines(st, 'final').TONE_ACES, 1, 'ACES 时 final 带 TONE_ACES');
  st.fp.eyeo.tone = 'agx'; S.apply(st, P, U);
  ok(!('TONE_ACES' in S.defines(st, 'final')), 'AgX 时不带');
  st.fp.set.veil = true; const r8 = S.apply(st, P, U);
  ok(r8.reset && !r8.lut, '改设定：历史清零');
}

section('4 余息（02 第七节第 9 条）');
{
  const st = base(), Y = P.Y || 360;
  const at = days => S.yuxi(st, P, Y * 3 - days);                  // 入冬前 days 日
  eq(at(100)[0], 0, '入冬前 100 日：没有余息');
  ok(at(44)[0] > 0 && at(44)[0] < 0.02, `入冬前 44 日：刚开始（${at(44)[0].toFixed(4)}）`);
  near(at(10)[0], 0.02, 1e-9, '入冬前 10 日：全强度 0.02 /km');
  ok(at(44)[1] < at(10)[1] && at(10)[1] < 7000, `前锋从塔根往外推：${at(44)[1].toFixed(0)} → ${at(10)[1].toFixed(0)} km`);
  ok(S.yuxi(st, P, Y * 3 + 2)[0] > 0 && S.yuxi(st, P, Y * 3 + 6)[0] === 0, '入冬后 5 日内淡出');
  st.fp.set.yuxi = 'off'; eq(at(10)[0], 0, '余息关');
  st.fp.set.yuxi = 'on'; near(S.yuxi(st, P, Y * 3 - 150)[0], 0.02, 1e-9, '余息开：不看日期');
  st.fp.set.yuxi = 'auto'; st.fp.set.yuxiLead = 30;
  eq(at(40)[0], 0, '提前日数改成 30：入冬前 40 日还没有');
}

section('5 风与天气烘焙时刻');
{
  const st = base();
  const w = S.wind(st, 12345.678);
  ok(w.every(x => x >= 0 && x < 1000), '风场平移按 1000 取模（噪声三种倍率都是整周期）');
  const a = S.wind(st, 1), b = S.wind(st, 1 + 1 / 86400);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 0.48;
  near(d, 0.01, 1e-4, '风速 10 m/s：一秒挪 10 m（噪声坐标×0.48）');
  eq(S.bakeHour(1.5), 36, '烘焙时刻（模拟小时）：t＝1.5 日 → 36');
  near(S.bakeHour(1 + 25 / 1440), 24 + 2 / S.BAKE_PER_HOUR, 1e-9, `每 ${60 / S.BAKE_PER_HOUR} 模拟分钟一烘：入日后 25 分 → 第 24 小时又 ${2 * 60 / S.BAKE_PER_HOUR} 分`);
  near(S.jetPhase(st, 1 + 5 / 1440), 0.01 * 5 / 60, 1e-9, '急流相位按距上次烘焙的时长推（0.01 rad/小时）：烘后 5 分钟');
  // 烘焙时刻前后连续：烘焙前一瞬的相位＝新一烘里气旋多走的 0.01·ΔuBakeTime（风速倍率 2 也一样）
  const st2 = base(); st2.fp.cloud.wind = 2;
  const tb = 1 + 1 / 6 / 24, eps = 1e-9;
  near(S.jetPhase(st2, tb - eps), 0.01 * (S.bakeTime(st2, tb) - S.bakeTime(st2, tb - eps)), 1e-6, '烘焙前一瞬的相位＝新一烘里气旋前进的量（衔接处不跳）');
  ok(S.jetPhase(st2, tb + eps) < 1e-6, '烘焙后相位归零');
  let jmax = 0; for (let k = 0; k < 2000; k++) jmax = Math.max(jmax, S.jetPhase(st, -5000 + k * 7.3));
  ok(jmax <= 0.01 / S.BAKE_PER_HOUR + 1e-12, `相位有界（≤ 0.01/${S.BAKE_PER_HOUR} rad，远年份也不累积剪切）：最大 ${jmax.toExponential(2)}`);
}

section('6 屏幕雨丝与余息飘尘');
{
  const st = base();
  const rc = HY.fp.cel.ruiCenter(P), L = P.R - 0.001;
  const Xr = [rc[0] * L, rc[1] * L, rc[2] * L];
  const k = S.rainK(st, P, Xr, 12, st.time.t);
  near(k[0], 1, 1e-6, '罪域中心、阴云强度 1、雨雾 0.03：雨丝强度 1');
  eq(k[2], 12, 'z＝真实秒');
  const O = HY.astro.site(3600, 0, P);
  eq(S.rainK(st, P, [O.x, O.y, O.z], 0, st.time.t)[0], 0, '圣禁城：不下雨');
  eq(S.rainK(st, P, [O.x, O.y, O.z], 0, st.time.t)[3], 1, '圣禁城：w＝1（可能下雨：雨量由 rain.frag 读云影图，哪里有降水的云哪里下）');
  st.fp.cloud.on = false; eq(S.rainK(st, P, Xr, 0, st.time.t)[0], 0, '云关：不下雨');
  eq(S.rainK(st, P, Xr, 0, st.time.t)[3], 0, '云关：w＝0');
}

section('7 眼：读回解码、色适应、HUD 文字');
{
  const pk = (r, g) => Math.floor(r * 4095 + 0.5) * 4096 + Math.floor(g * 4095 + 0.5);
  const c = S.unpackChroma(pk(0.45, 0.33));
  near(c[0], 0.45, 2e-4, '照明色度打包往返：r'); near(c[1], 0.33, 2e-4, 'g'); near(c[2], 0.22, 4e-4, 'b＝1−r−g');
  ok(Math.fround(pk(1, 1)) === pk(1, 1), '最大打包值 float32 精确');
  eq(JSON.stringify(S.unpackChroma(1)), JSON.stringify([1 / 3, 1 / 3, 1 / 3]), '无效值退回中性');
  const I = S.catMatrix([1, 1, 1], 0.7);
  ok(I.every((x, i) => Math.abs(x - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 2e-3), '中性照明：色适应矩阵≈单位阵');
  const warm = [1.0, 0.75, 0.45], M = S.catMatrix(warm, 1), o = S.mv(M, warm);
  ok(Math.abs(o[0] - o[1]) / o[1] < 0.02 && Math.abs(o[2] - o[1]) / o[1] < 0.02, `强度 1：暖色照明本身被拉成灰（${o.map(x => x.toFixed(3)).join(', ')}）`);
  const M7 = S.catMatrix(warm, 0.7), o7 = S.mv(M7, warm);
  ok(o7[0] / o7[2] > 1.05 && o7[0] / o7[2] < warm[0] / warm[2], `强度 0.7：拉回七成（r/b ${(warm[0] / warm[2]).toFixed(2)} → ${(o7[0] / o7[2]).toFixed(2)}）`);
  const Y = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  near(Y(o7) / Y(warm), 1, 0.06, '色适应基本不改亮度');
  eq(JSON.stringify(S.catMatrix(warm, 0)), JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1]), '强度 0：单位阵');
  eq(S.eyeState(1000), '明视', '1000 cd/m² 明视'); eq(S.eyeState(0.5), '中间视', '0.5 cd/m² 中间视'); eq(S.eyeState(0.003), '暗视', '0.003 cd/m² 暗视');
  near(S.ev(12.5 / 100 * 1024), 10, 1e-9, 'EV：L＝12.5/100·2^10 → EV 10');
  // 眼的初值（passes 里的 EYE0）：La＝1000 时 key/La·1000＝0.18
  const La = 1000, key = 0.18 * Math.min(1, Math.pow(La / 100, 0.2));
  near(key / La * 1000, 0.18, 1e-12, '眼的初值：曝光 0.18/kn 对应 La＝1000 cd/m²');
}

T.done();
