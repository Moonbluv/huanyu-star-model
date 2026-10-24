// terrain_lib.glsl：拼在 common 之后（terrain_coarse、terrain、实例摆放、地平线角图共用）。JS 镜像：fp/ground.js（改一边必须改另一边）
uniform float uW;                                          // 踏面宽 km（平均崖高＝W·tan 纬度，uHc 为相机处的值）
float gU, gK; vec2 gDc;                                     // 缓存：阶地相位 f、相对级号、图表坐标
vec2 gGP, gGw, gGb; float gYq;                              // 缓存（altAt 置）：量化前起伏 P、蜿蜒 w、扶壁＋冲沟 b 对图表的梯度；X 处的 Y_q（绝对 km）
float gKA, gDp, gDpBr, gBr; vec2 gGbr;                      // 缓存：绝对级号；dp/df；dp/d(扶壁层值)；扶壁层值与梯度（倒石扇沿崖的调制）
float gQ, gTal, gLedge, gStep, gCliffH;                     // 缓存：崖面上的高度比例（不在崖带为 −1）；倒石坡上的位置 0–1；台坎程度；子台阶号；本级崖的可见高度（以级为单位）
vec4 gL3, gL4, gL5;                                         // 缓存：第 3、4、5 层取样（着色用；没取样时 r＝0、a＝0.5）
float gLo, gHi, gCk, gTanL, gRl; vec3 gXb, gQb; vec4 gLam;  // 缓存：本级崖带的剖面参数（崖带里沿视线解一维剖面用，见 bandStep）
bool gFull = false;                                         // 真：dispFine 不提前停读（groundPoint 要精确落地）
// PCG3D 整数哈希：与 gen_height.frag 的 pcg3 逐字相同（test/noise_mirror 比对原文）；JS 镜像 fp/noise.js 的 pcg3
uvec3 pcg3(uvec3 v){ v = v*1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
vec3 hash3f(uvec3 v){ return vec3(pcg3(v) >> 8u)/16777216.0; }      // 三个 [0,1) 随机数（24 位）
float sstepD(float a, float b, float x){ float u = clamp((x - a)/(b - a), 0.0, 1.0); return 6.0*u*(1.0 - u)/(b - a); }   // sstep 的导数
// 低频层（第 0、1 层）手工双线性：硬件线性过滤的子纹素权重只有 8 位，第 0 层一个纹素 1.9 km，权重每 7 m 跳一档，
// 斜坡模式下会在地上踩出约 1 m 高的小台阶（GPU 与 CPU 镜像对不上，近处出现假命中）。改用 texelFetch 四点、float32 插值。
// foot.frag 里有一份逐字相同的 layerTexHQ（dc＝0 时两边必须逐位一致，alt(0) 才严格等于眼高；test/noise_mirror 比对原文）。
vec4 layerTexHQ(int k, vec2 dc){
  mat2 Rk = rotK(k); float s = 1.0/(LAY_L[k]*TILE);
  vec2 uv = (Rk*dc)*s + uOrg[k];
  ivec2 n = textureSize(uHeight, 0), m = n - 1;
  vec2 x = uv*vec2(n) - 0.5, f = fract(x); ivec2 i0 = ivec2(floor(x));
  vec4 a = texelFetch(uHeight, i0 & m, 0), b = texelFetch(uHeight, (i0 + ivec2(1, 0)) & m, 0);
  vec4 c = texelFetch(uHeight, (i0 + ivec2(0, 1)) & m, 0), d = texelFetch(uHeight, (i0 + ivec2(1, 1)) & m, 0);
  vec4 t = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return vec4(t.r, s*(transpose(Rk)*t.gb), t.a);
}
// 近处（像素足迹 < HQ_FOOT）一律手工双线性：实测这块 GPU 的线性过滤子纹素权重只有约 6 位，第 3 层在 10 cm 内跳 0.2 m、
// 蜿蜒层（第 6 层）让崖线每 7 m 横跳约 4 m——近处的轮廓与崖沿会出现锯齿。足迹大于 2 m 的远处这些台阶在一个像素以内，照用硬件过滤。
#ifndef HQ_FOOT
#define HQ_FOOT 0.002
#endif
vec4 layerTexF(int k, vec2 dc, float foot){ return foot < HQ_FOOT ? layerTexHQ(k, dc) : layerTex(k, dc); }
float layerFade(int k, float foot){ return 1.0 - sstep(0.3*LAY_L[k], 1.2*LAY_L[k], foot); }

/* ───────── 阶地剖面（2026-10 改：逐级随机、崖面分子台阶、倒石坡、冲沟） ─────────
 * 相位 u 的定义不变：u＝Y(r_raw)/W − wig·w − jit·b̃，b̃＝扶壁层值＋冲沟项（T_GUL·gully(第 3 层)，冲沟只会让崖面往后退、地面只会变低）。
 * 第 kA 级（绝对级号）占 u∈[kA, kA＋1)，f＝u−kA。Y_q＝W·(kA＋p(f))：
 *   f∈[0, c_k)       崖带：p 从 lo＝h_{k−1}＋t_{k−1}（下一级倒石坡的坡顶）升到 hi＝1＋h_k，中间是 4 个厚薄不一的子台阶（崖面＋台坎）
 *   f∈[c_k, 1−g_k)   踏面：p＝hi（真水平）
 *   f∈[1−g_k, 1)     倒石坡：p＝hi＋t_k·s²（贴着上一级崖脚堆起来，凹形，坡度 ≤ 约 38°）
 * h_k 级高抖动 ±T_HAMP、c_k＝uCliffC·(0.6–1)、倒石坡高 t（沿崖由扶壁层调制：有的地方是大倒石扇，有的只有一道矮坡裙）。
 * 相邻两级在 f＝1／0 处连续。踏面仍严格水平；崖高＝(1＋h_k−h_{k−1}−t_{k−1})·W·tan纬度，平均仍约 W·tan纬度。
 * 余坡 uResid：p 与线性斜坡 f＋1 按 uResid 混合（仍连续）。 */
#define T_HAMP 0.30
#define T_GMAX 0.45
#define T_SLOPE_D 3.7
#define T_GUL 0.171
vec3 lvlR(float kA, uint salt){ return hash3f(uvec3(uint(int(kA) + 8192), salt, 40503u)); }
float talusTop(vec3 rB, float tanL){ return min(0.05 + 0.07*rB.x + 0.22*rB.y, 0.2/max(tanL, 1e-3)); }   // 本级倒石坡的最大坡高（以级为单位，按纬度限坡）
float talusG(float tTop, float tanL){ return clamp(2.6*tTop*tanL, 0.03, T_GMAX); }                     // 倒石坡宽（相位）
float talusAt(float tTop, float br, out float dt){                                                       // 沿崖调制：坡裙 35%，倒石扇 100%
  float m = sstep(0.1, 0.55, br); dt = 0.65*tTop*sstepD(0.1, 0.55, br); return tTop*(0.35 + 0.65*m);
}
float tanLat(float y){ return abs(y)/sqrt(max(uR*uR - y*y, 1.0)); }
// 起伏倍率：逐级随机、倒石坡、冲沟、子台阶都乘它（起伏倍率 0＝旧的整齐台阶，诊断用；平域 0.7 时为 1）
float terRel(){ return sat(uAmpZone/0.7); }
// 冲沟：第 3 层（200 m）过零处的窄 V 形缺口，G∈[0,1]；dg＝dG/dn。只在扶壁层材质噪声高的地方有（gullyMask：约四分之一的地段、
// 千米一块），不然第 3 层的零等值线是连绵几公里的长线，一级级崖面在同一条线上都被切开，远看满坡平行的竖缝
float gullyF(float n, out float dg){ float u = sat(1.0 - abs(n)/0.16); dg = -sign(n)*6.0*u*(1.0 - u)/0.16; return u*u*(3.0 - 2.0*u); }
float gullyMask(float ba){ return sstep(0.56, 0.72, ba); }
// 崖面的子台阶：x∈[0,1]（0 崖脚、1 崖沿）→ C∈[0,1]（高度比例）。4 个子台阶厚薄由级号哈希、宽窄与厚度成比例（±20%），
// 每个子台阶下部是崖面（smoothstep），上部是一道台坎（占 λ，沿崖由 e2 调制：有的地方台坎宽、有的几乎没有）。dC/dx ≤ T_SLOPE_D
float cliffC(float kA, float x, vec2 e2, out float dC){
  vec3 rA = lvlR(kA, 81u), rB = lvlR(kA, 82u);
  float rl = terRel();
  vec4 th = mix(vec4(1.0), 0.2 + vec4(rA.x, rA.y, rA.z, rB.x), rl);
  vec4 wd = th*(1.0 + rl*(0.4*vec4(rB.y, rB.z, fract(rA.x + rB.y), fract(rA.y + rB.z)) - 0.2));
  vec4 lam = rl*(0.08 + 0.3*vec4(rB.z, rA.y, rB.x, rA.z))*clamp(vec4(e2.x, e2.y, 1.0 - e2.x, 1.0 - e2.y)*1.8 - 0.25, 0.1, 1.0);
  float sT = th.x + th.y + th.z + th.w, sW = wd.x + wd.y + wd.z + wd.w;
  vec3 xb = vec3(wd.x, wd.x + wd.y, wd.x + wd.y + wd.z)/sW, qb = vec3(th.x, th.x + th.y, th.x + th.y + th.z)/sT;
  gXb = xb; gQb = qb; gLam = lam; gRl = rl;
  float x0, x1, q0, q1, lm;
  if (x < xb.x){ x0 = 0.0; x1 = xb.x; q0 = 0.0; q1 = qb.x; lm = lam.x; gStep = 0.0; }
  else if (x < xb.y){ x0 = xb.x; x1 = xb.y; q0 = qb.x; q1 = qb.y; lm = lam.y; gStep = 1.0; }
  else if (x < xb.z){ x0 = xb.y; x1 = xb.z; q0 = qb.y; q1 = qb.z; lm = lam.z; gStep = 2.0; }
  else { x0 = xb.z; x1 = 1.0; q0 = qb.z; q1 = 1.0; lm = lam.w*0.5; gStep = 3.0; }
  float s = (x - x0)/(x1 - x0), sr = sat(s/(1.0 - lm));
  gLedge = sstep(1.0 - lm - 0.03, 1.0 - lm + 0.02, s)*sstep(0.02, 0.05, lm);
  dC = (q1 - q0)*6.0*sr*(1.0 - sr)/((1.0 - lm)*(x1 - x0));
  float C = q0 + (q1 - q0)*sr*sr*(3.0 - 2.0*sr);
  if (rl < 1.0){ float x2 = sat(x); C = mix(x2*x2*(3.0 - 2.0*x2), C, rl); dC = mix(6.0*x2*(1.0 - x2), dC, rl); gLedge *= rl; }   // 起伏倍率 0：旧的单一 smoothstep 崖
  return C;
}
// 第 kA 级、相位 f 处的剖面 p；dp＝dp/df，dpBr＝∂p/∂br（倒石扇沿崖的变化，法线用）。br＝扶壁层值，e2＝台坎调制，tanL＝tan 纬度
float terraceP(float kA, float f, float br, vec2 e2, float tanL, out float dp, out float dpBr){
  vec3 rA = lvlR(kA, 11u), rB = lvlR(kA, 12u), qA = lvlR(kA - 1.0, 11u), qB = lvlR(kA - 1.0, 12u);
  float rl = terRel(), hk = rl*T_HAMP*(rA.x + rA.y - 1.0), hk1 = rl*T_HAMP*(qA.x + qA.y - 1.0);
  float ck = uCliffC*(1.0 - 0.4*rl*(1.0 - rA.z));
  float dtk, dtk1, tTop = rl*talusTop(rB, tanL), tk = talusAt(tTop, br, dtk), tk1 = talusAt(rl*talusTop(qB, tanL), br, dtk1);
  float gk = talusG(tTop, tanL), hi = 1.0 + hk, lo = hk1 + tk1, p;
  gQ = -1.0; gTal = 0.0; gLedge = 0.0; gStep = -1.0; gCliffH = hi - lo;
  gLo = lo; gHi = hi; gCk = ck; gTanL = tanL;
  if (f < ck){ float dC, C = cliffC(kA, f/ck, e2, dC); p = lo + (hi - lo)*C; dp = (hi - lo)*dC/ck; dpBr = (1.0 - C)*dtk1; gQ = C; }
  else if (f > 1.0 - gk){ float s = (f - 1.0 + gk)/gk; p = hi + tk*s*s; dp = 2.0*tk*s/gk; dpBr = s*s*dtk; gTal = s; }
  else { p = hi; dp = 0.0; dpBr = 0.0; }
  p = mix(p, f + 1.0, uResid); dp = mix(dp, 1.0, uResid); dpBr *= 1.0 - uResid;
  return p;
}

// 深渊沟的截步：沟壁（|y|∈[h−w, h]，最陡 2D/w）里按坡小步，沟壁外截在沟壁边上（只在视线朝沟壁走时）。见 common.glsl 的 trench
float trenchStep(float yX, float dydt, float a){
  if (uAbyssDepth <= 0.0) return INF;
  float h = uAbyssHalf, w = min(10.0, 0.4*h), ay = abs(yX), s = sign(yX)*dydt;          // s＝d|y|/dt
  if (ay > h - w - 0.5 && ay < h + 0.3) return a/(1.0 + uLip + 2.0*uAbyssDepth/w);
  if (ay >= h + 0.3 && s < -1e-6) return 0.8*(ay - h - 0.3)/(-s) + 1e-4;
  if (ay <= h - w - 0.5 && s > 1e-6) return 0.8*(h - w - 0.5 - ay)/s + 1e-4;
  return INF;
}
// 崖带里的步长：崖面近乎竖直，按坡度的利普希茨上界走（离地高度／80 多）一道崖就要几十步。改成沿视线解一维剖面：
// 崖带只有一百来米宽，其间相位 f 与视线高度都随 t 线性变；用缓存的本级剖面（gLo、gHi、gCk、子台阶）在出崖带之前取 10 个点，
// 找到“视线高度－剖面高度”第一次低于细层振幅（margin）的地方，走到它前一个点。剖面不含细层，所以留 margin；样点之间的台坎尖角可能被切掉一点
float cliffCached(float x){
  float x0, x1, q0, q1, lm;
  if (x < gXb.x){ x0 = 0.0; x1 = gXb.x; q0 = 0.0; q1 = gQb.x; lm = gLam.x; }
  else if (x < gXb.y){ x0 = gXb.x; x1 = gXb.y; q0 = gQb.x; q1 = gQb.y; lm = gLam.y; }
  else if (x < gXb.z){ x0 = gXb.y; x1 = gXb.z; q0 = gQb.y; q1 = gQb.z; lm = gLam.z; }
  else { x0 = gXb.z; x1 = 1.0; q0 = gQb.z; q1 = 1.0; lm = gLam.w*0.5; }
  float sr = sat((x - x0)/((x1 - x0)*(1.0 - lm)));
  float C = q0 + (q1 - q0)*sr*sr*(3.0 - 2.0*sr);
  if (gRl < 1.0){ float x2 = sat(x); C = mix(x2*x2*(3.0 - 2.0*x2), C, gRl); }
  return C;
}
float bandStep(float f, float dudt, float a, float sinT){
  if (abs(dudt) < 1e-4) return INF;                               // 沿着崖面走：交给锥形步
  float H = uW*gTanL, pf = gLo + (gHi - gLo)*cliffCached(f/gCk);
  float margin = 2.2*(LAY_A[3] + LAY_A[4] + LAY_A[5])*uAmpZone + 0.002;
  float tEnd = ((dudt > 0.0 ? gCk : 0.0) - f)/dudt, prev = 0.0;
  for (int k = 1; k <= 10; k++){
    float dt = tEnd*float(k)*0.1, fk = clamp(f + dudt*dt, 0.0, gCk);
    float clr = a + sinT*dt - H*(gLo + (gHi - gLo)*cliffCached(fk/gCk) - pf);
    if (clr < margin) return max(prev, 3e-4);
    prev = dt;
  }
  return tEnd + 2e-4;                                              // 这一段崖带里不会相交：直接出崖带
}
// 阶地的分区截步：崖带 f∈[0, c_k) 沿视线解一维剖面（bandStep）；倒石坡区 f∈[1−T_GMAX, 1) 坡度上界多 0.9；
// 踏面上截在下一个更陡的区的边上（按相位与 du/dt）。a＝离地高度，返回安全步长上界。须紧跟在同一点的 altAt 之后（用剖面缓存）
float zoneStep(float f, float dudt, float a, float sinT, float cosT){
  if (f < gCk) return bandStep(f, dudt, a, sinT);
  float t0 = 1.0 - T_GMAX, dt = INF;
  if (f > t0) dt = a/max((uLip + 0.9)*cosT - sinT, 0.3);
  float du = dudt < 0.0 ? f - gCk : (f > t0 ? 1.0 - f : t0 - f);
  if (abs(dudt) > 1e-6) dt = min(dt, 0.9*du/abs(dudt) + 2e-4);
  return dt;
}
// 地形求交的远界：外扩到“最深的地面”（深渊沟底再往下全部起伏）的球面的远交点，相机总在它里面，所以对任何视线都有定义。
// 不能用 common 的 tWallCam：它假定相机在内壁球面之内（K＜0）；站在洼地（第 0、1 层起伏为负）或深渊沟里时 K＞0，
// 朝外（朝下）的视线得到负数，粗级第一步就“出界”，整片地面漏成天空（实测：斜坡模式平域 s＝5000 一处洼地、赤道沟里）。
// JS 镜像 ground.tTerFar
float tTerFar(float cd){ float m = uAbyssDepth + uClearMax + 0.5; float Ko = uCamK - m*(2.0*uR + m); return -cd + sqrt(max(cd*cd - Ko, 0.0)); }
// 宏观地面（球面＋深渊沟，不含起伏与台阶）在 X 处的“上”＝∇[(R−|X|)＋trench(y)] 的方向。精级步数用尽时外推、判视线是否在离开地面用
vec3 macroUp(vec3 X){ return normalize(-normalize(X) + vec3(0.0, trenchD(X.y), 0.0)); }
// 高档的 8 方向扫描遮蔽（02 第八节第 7 条“高档另加”）：horizon.frag 在第 0 级顺带烘进 tHorizon 的 B 通道，着色时查（shade_terrain 的 aoScan）。
// 档位宏由 fp/instances.js 按 TIER_OPTS.aoScan 登记（它在 passes.js 之后载入）；没登记时按关
#ifndef TER_AO_SCAN
#define TER_AO_SCAN 0
#endif
// 振幅感知的锥形步长（对 02 第八节第 5 条“Δt＝alt／(L·cosθ−sinθ)”的放宽，仍然保守）：
//   离地 a 时，第 k 层及更细各层最多让地面相对起落 2·Σ_{j≥k} A_j·amp；高出这部分的余量只需按更粗各层的坡度上界走。
//   取各 k 的最大值（每个都是安全步长）。阶地模式里第 0–2 层只挪崖线相位、不造坡（崖、倒石坡由 zoneStep 截步），所以从第 3 层算起。
//   uLip 是全部层的上界（CPU 算）；它比各层之和多出的部分加到每一级上。lod 1 只有低频层。深渊沟由 trenchStep 截步。
float coneStep(float a, float sinT, float cosT, int lod){
  float amp = uAmpZone, lipAll = 0.05, rest = 0.0;
  int k0 = uGroundMode == 1 ? 3 : 0;
  for (int k = 0; k < 6; k++) if (k >= k0) lipAll += 3.6*LAY_A[k]/LAY_L[k]*amp;
  float extra = max(uLip - lipAll, 0.0);
  float dt = a*min(1.0/max(uLip*cosT - sinT, 0.3), 3.0);
  float lipK = lipAll;
  for (int k = 5; k >= 0; k--){
    if (k < k0) break;
    lipK -= 3.6*LAY_A[k]/LAY_L[k]*amp;                         // 去掉第 k 层后的坡度上界
    if (lod == 1 && k >= 3) { if (k == 3) dt = max(dt, a*min(1.0/max((lipK + extra)*cosT - sinT, 0.3), 3.0)); continue; }
    rest += 2.0*LAY_A[k]*amp;
    float m = a - rest;
    if (m <= 0.0) break;
    dt = max(dt, m*min(1.0/max((lipK + extra)*cosT - sinT, 0.3), 3.0));
  }
  return dt;
}
// 过松弛步进（Keinert 2014 的思路，用在锥形步上）：先走 TER_RELAX 倍安全步；到了新点，若“前一点往前的安全距离＋新点往回的
// 安全距离”盖不住这一步，说明可能跨过了地面，退回前一点的安全步再走（不松弛）。所以仍是保守的，只是步数省一半左右。
#ifndef TER_RELAX
#define TER_RELAX 1.7
#endif
bool relaxOK(float stepLen, float dtSafePrev, float a, float sinT, float cosT, int lod){
  return stepLen <= dtSafePrev + coneStep(max(a, 0.0), -sinT, cosT, lod);
}
// 细层位移 d_f(X)：返回 x 值，yz 对图表的梯度；clear＝不计细层时的离地间隙（altAt 里是 base＋F.x：相机自己的细层 F.x 要加回，
// 02 原式传 base，相机脚下细层为负时会把第 4、5 层误停读，alt(0)≠眼高、离地高度沿视线跳变，精级割线退化成 t＝0 的假命中）。
// 第 3 层用 altAt 已取的 gL3（冲沟也用它）；取到的第 4、5 层留在 gL4、gL5 给着色用
vec3 dispFine(vec2 dc, float foot, float clear){
  vec3 acc = vec3(0.0); float amp = uAmpZone, rest = 0.0;
  int k0 = uGroundMode == 1 ? 3 : 2;
  for (int k = 2; k < 6; k++){
    if (k < k0) continue;
    float fd = layerFade(k, foot); if (fd <= 0.0) break;
    rest = 0.0; for (int j = 5; j > k; j--) rest += LAY_A[j];
    if (!gFull && clear - acc.x > 2.5*(LAY_A[k] + rest)*amp + 0.002) break;   // ＋2 m（≥最大眼高）：相机处不提前停读，alt(0) 严格＝眼高
    vec4 t = k == 3 ? gL3 : layerTexF(k, dc, foot); float A = LAY_A[k]*amp*fd;
    if (k == 4) gL4 = t; else if (k == 5) gL5 = t;
    acc += A*vec3(t.r, t.g, t.b);
  }
  return acc;
}
// 粗级包络：足迹之差造成的淡出幅度＋0.3 m 垫量。（02 原式垫 2 m，比眼高 1.6 m 还大：粗级在 t＝0 就判命中，
// 每个像素都从 0 起步、精级 24 步用尽后按命中处理，地平线以上整片出现假地面。垫量须小于最小眼高 1.2 m。）
float envMargin(float footC, float footF){
  float m = 0.0;
  for (int k = 2; k < 6; k++) m += LAY_A[k]*uAmpZone*max(layerFade(k, footF) - layerFade(k, footC), 0.0);
  return m + 0.0003;
}
// 阶地剖面在相机处的值 p_C（每次着色器调用算一次；与 v＝0 时 altAt 里的 p_X 同一份代码、同一组输入，逐位一致）
float gPC; bool gPCok = false;
float camP(float kC){
  if (!gPCok){
    vec4 Lb = layerTexHQ(2, vec2(0.0)), L3 = layerTexHQ(3, vec2(0.0));    // （冲沟已并进 F.z；这里只要扶壁层值与台坎调制）
    float f = uTerF0, dp, dpb; vec2 e2 = vec2(L3.a, 0.5);
    if (f < uCliffC) e2.y = layerTexHQ(4, vec2(0.0)).a;
    gPC = terraceP(kC, f, Lb.r, e2, tanLat(uCamW.y), dp, dpb);
    gPCok = true;
  }
  return gPC;
}
// 相对相机的离地高度（km）。lod 0 全部层；1 只低频。顺带置缓存 gU gK gKA gDc gGP gGw gGb gYq gDp gDpBr gQ gTal gL3…（duDt、terrainNormal、着色用，不再取纹理）
float altAt(vec3 v, float foot, int lod){
  vec4 F = texelFetch(uFoot, ivec2(0), 0);
  vec2 dc = chartD(v); gDc = dc;
  float yX = uCamW.y + v.y, amp = uAmpZone;
  float tr = trench(yX) - trench(uCamW.y);
  vec4 L0 = layerTexHQ(0, dc), L1 = layerTexHQ(1, dc);                       // 低频层手工双线性（与 foot.frag 同式）
  float P = amp*(LAY_A[0]*L0.r + LAY_A[1]*L1.r) - F.w;                       // ΔP
  gGP = amp*(LAY_A[0]*L0.gb + LAY_A[1]*L1.gb);
  gL3 = lod == 0 ? layerTexF(3, dc, foot) : vec4(0.0, 0.0, 0.0, 0.5);
  gL4 = vec4(0.0, 0.0, 0.0, 0.5); gL5 = gL4;
  gQ = -1.0; gTal = 0.0; gLedge = 0.0; gStep = -1.0; gCliffH = 1.0; gKA = 0.0; gDp = 0.0; gDpBr = 0.0;
  float base;                                               // 不计细层的离地高度（两种模式各算各的，最后统一加细层；只有一个 return）
  if (uGroundMode == 0){
    gGw = vec2(0.0); gGb = vec2(0.0); gYq = 0.0; gBr = 0.0; gGbr = vec2(0.0);
    base = uCamAlt - dRho(v) + tr - P;
  } else {
    vec4 Lw = layerTexF(6, dc, foot), Lb = layerTexF(2, dc, foot);
    float dg = 0.0, kg = T_GUL*terRel()*gullyMask(Lb.a), gul = lod == 0 ? kg*gullyF(gL3.r, dg) : 0.0;
    float w = Lw.r - F.y, b = Lb.r + gul - F.z;
    gGw = Lw.gb; gGb = Lb.gb + kg*dg*gL3.gb; gBr = Lb.r; gGbr = Lb.gb;
    float rsX = sqrt(max(uR*uR - yX*yX, 0.0));
    float dRs = -(2.0*uCamW.y*v.y + v.y*v.y)/(rsX + uRsC);
    float rawC = uRsC - F.w, rawX = rawC + dRs - P;
    float YC = sqrt(max(uR*uR - rawC*rawC, 1.0)), YX = sqrt(max(uR*uR - rawX*rawX, 1.0));
    float dY = -(dRs - P)*(rawX + rawC)/(YX + YC);           // Y＝√(R²−r²) 两半球对称，不用分符号
    float uu = uTerF0 + dY/uW - uWig*w - uJit*b, kk = floor(uu), f = uu - kk;
    gU = f; gK = kk;
    float kC = floor(YC/uW - uWig*F.y - uJit*F.z - uTerF0 + 0.5);   // 相机所在级的绝对级号（u_C 的整数部分；小数部分是 CPU 双精度给的 uTerF0）
    gKA = kC + kk;
    vec2 e2 = vec2(gL3.a, 0.5);
    if (f < uCliffC && lod == 0) e2.y = layerTexF(4, dc, foot).a;
    float pX = terraceP(gKA, f, Lb.r, e2, tanLat(yX), gDp, gDpBr);
    float qC = gQ, tC = gTal, lC = gLedge, sC = gStep, hC = gCliffH, lo0 = gLo, hi0 = gHi, ck0 = gCk, tl0 = gTanL, rl0 = gRl;   // camP 会改写这几个缓存：先存下
    vec3 xb0 = gXb, qb0 = gQb; vec4 lm0 = gLam;
    float dYq = uW*(kk + pX - camP(kC));
    gQ = qC; gTal = tC; gLedge = lC; gStep = sC; gCliffH = hC; gLo = lo0; gHi = hi0; gCk = ck0; gTanL = tl0; gRl = rl0; gXb = xb0; gQb = qb0; gLam = lm0;
    float rqC = uCamRho + uCamAlt + F.x - trench(uCamW.y), YqC = sqrt(max(uR*uR - rqC*rqC, 1.0));   // 相机脚下的 r_q（地面＝r_q − d_f ＋ 沟）
    float YqX = YqC + dYq, rqX = sqrt(max(uR*uR - YqX*YqX, 1.0));
    gYq = YqX;
    float dRq = -dYq*(YqX + YqC)/(rqX + rqC);
    base = uCamAlt + dRq - dRxz(v) + tr;
  }
  float fine = lod == 0 ? dispFine(dc, foot, base + F.x).x : 0.0;
  return base - (fine - F.x);
}
// 阶地相位沿视线的变化率 du/dt（截步用）。须紧跟在同一点的 altAt 之后：用它缓存的梯度 gGP、gGw、gGb，不再取纹理。
// u＝Y(r_raw)/W − wig·w − jit·b̃，r_raw＝ρ_s(y)－P，所以 ∂u/∂P＝(r_raw/Y_raw)/W。02 原式漏了 P（第 0、1 层）这一项：
// 罪域水平视线的 du/dt 常差 0.1–0.5 /km（u 本身约 0.67 /km），截步会一步跨过崖带；补上后差 ≤0.1 /km（test/terrace_geom 第 8 节）
float duDt(vec3 v, vec3 d){
  vec3 X = uCamW + v, gE, gN; chartGrad(X, gE, gN);
  float rs = sqrt(max(uR*uR - X.y*X.y, 1.0));
  vec2 gc = (rs/max(abs(X.y), 1.0))/uW*gGP - uWig*gGw - uJit*gGb;           // 对图表坐标（东, 北）的梯度
  return dot(d, vec3(0.0, sign(X.y)/uW, 0.0) + gc.x*gE + gc.y*gN);           // 裸球面上 Y＝|y|，∇|y|＝sign(y)·ŷ
}
// 地面法线（解析梯度；只在命中点算一次）。须先在同一点调 altAt（用缓存 gU、gDc、gGP、gGw、gGb、gDp、gDpBr）
vec3 terrainNormal(vec3 v, float foot){
  vec3 X = uCamW + v, gE, gN; chartGrad(X, gE, gN);
  vec3 dd = dispFine(gDc, foot, -1e9);                      // 法线要全部细层（不提前停读）
  vec3 gD = dd.y*gE + dd.z*gN;                               // ∇d_f
  vec3 gP = gGP.x*gE + gGP.y*gN;                             // ∇P
  vec3 g;
  if (uGroundMode == 0){
    g = -normalize(X) + vec3(0.0, trenchD(X.y), 0.0) - gP - gD;
  } else {
    vec3 rh = vec3(X.x, 0.0, X.z)/length(X.xz);
    float rs = sqrt(max(uR*uR - X.y*X.y, 1.0));
    vec3 gRs = vec3(0.0, -X.y/rs, 0.0);
    float rraw = rs, Yraw = abs(X.y);                         // 分母用近似值即可
    vec3 gYraw = -(rraw/max(Yraw, 1.0))*(gRs - gP);
    vec2 gwb = -uWig*gGw - uJit*gGb;
    vec3 gu = gYraw/uW + gwb.x*gE + gwb.y*gN;
    float Yq = abs(X.y), rq = rs;
    vec3 dYqdX = uW*(gDp*gu + gDpBr*(gGbr.x*gE + gGbr.y*gN));   // ∇Y_q（局部名，别与缓存 gYq 混）：剖面沿相位＋倒石扇沿崖
    vec3 gRq = -(Yq/rq)*dYqdX;
    g = gRq - gD - rh + vec3(0.0, trenchD(X.y), 0.0);
  }
  return normalize(g);
}

// terrain_lib.glsl（续）：由图表偏移求地面点（相对相机），地平线角图、云影图、实例共用
// 沿 ρ̂（阶地）或径向（斜坡）挪动不改变图表坐标，离地高度随之线性变化，所以一次修正就落地——前提是这一次的 altAt 读了全部细层。
// 出发点离地远（隔着几级阶地）时 dispFine 会提前停读、差出细层的量（可达几十米，实例会悬空或埋进地里），所以这里置 gFull 读全部细层。
// chartPoint：图表偏移 dc 处、与相机同一离轴半径（阶地）／同一离球心距离（斜坡）的点（相对相机）；dir＝把它挪到地面的方向。
// 它与地面点的图表坐标相同（阶地相位 gU 也相同），只差离地高度。JS 镜像 ground.chartToV
vec3 chartPoint(vec2 dc, out vec3 dir){
  float dLam = -dc.x/uRref; vec3 v0;
  if (uGroundMode == 1){
    float rc = uCamRho;                                         // 先放在相机的离轴半径上，再沿 ρ̂ 挪到地面
    v0 = vec3(-rc*2.0*sq(sinS(0.5*dLam)), -dc.y, rc*sinS(dLam));
    dir = vec3(cos(dLam), 0.0, sin(dLam));
  } else {
    float psiC = atan(uCamRho, -uCamW.y), dPsi = -dc.y/uR, psi = psiC + dPsi, rc = sqrt(uR*uR + uCamK);
    vec3 dF = vec3(2.0*cos(psiC + 0.5*dPsi)*sinS(0.5*dPsi) - sin(psi)*2.0*sq(sinS(0.5*dLam)),
                   2.0*sin(psiC + 0.5*dPsi)*sinS(0.5*dPsi), sin(psi)*sinS(dLam));
    v0 = rc*dF;
    dir = normalize(uCamW + v0);
  }
  return v0;
}
// 斜坡沿径向挪远了深渊沟项不再线性：两次修正（循环里只有一处 altAt：ANGLE 把每个调用点各内联一份，调用点越多编译越慢）
vec3 groundPoint(vec2 dc){
  vec3 dir, v0 = chartPoint(dc, dir);
  gFull = true;                                                // 读全部细层，一次就落地
  for (int i = 0; i < 2; i++){
    float a = altAt(v0, 1e-3, 0);
    v0 += a*dir;
    if (uGroundMode == 1 || abs(a) <= 0.05) break;
  }
  gFull = false;
  return v0;
}
