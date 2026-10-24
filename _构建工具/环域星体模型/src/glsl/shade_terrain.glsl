// shade_terrain.glsl：拼在 terrain_lib 之后（02 第八节第 8 条；负责：F 路）。terrain.frag 与实例层 inst.frag 共用同一套光照 litSurface。
// 2026-10 地面写实化（重写）：
//   · 脚下 1–3 m 最清楚：砂粒的细斑、三个尺度的棱角碎石（八边形截锥：平顶＋几个斜面，向光面亮、背光面暗，石根一圈接触暗边，
//     并按日向投出短影）；罪域另有玄武岩板（裂缝、酸蚀麻坑）、硫酸盐结壳多边形、洼地里的黄绿酸水，雨中湿亮、积水映天；
//     轻域灰白碎石、霜、地衣；平域草皮（一簇簇草的明暗，远处融成绒面）；灵薄带灰烬里的黑玻璃斑（有光泽、边上亮棱）。
//   · 各域的地表只是“参数”不同（按分域权重混合参数，再统一求值一次）：编译只内联一份，循环都写成运行期循环（ANGLE/fxc 不展开）。
//   · 按像素足迹淡出到平均色（高度图没有 mip），远处不出椒盐点与摩尔纹。
//   · 崖面按（东向, 高度）取样（崖面上图表北向几乎不变，按图表取样会被竖向拉成丝），见 cliffFace。
uniform float uStrataC;                                       // fract(ρ_C/0.045)，CPU 算，层理才不随行走滑动
struct Surf { vec3 alb; float rough; float wet; float spec; float trans; };   // spec：镜面强度（0 只有漫射）；trans：叶片透光（实例草）
Surf surf0(vec3 alb, float rough){ Surf s; s.alb = alb; s.rough = rough; s.wet = 0.0; s.spec = 1.0; s.trans = 0.0; return s; }

// ───── 小工具 ─────
int iZero(){ return min(uFrame, 0); }                         // 运行期的 0：循环起点用它，fxc 不能把循环展开（展开会让编译慢几倍）
vec3 cellH(vec2 c, float per, uint seed){ vec2 w = mod(c, per); return hash3f(uvec3(uvec2(w + 0.5), seed)); }
// 球谐：着色前一次取出 9 个系数（原先 shIrr、shRad 各自 texelFetch 十几次，编译慢），再求辐照度与辐亮度
vec3 gSH[9];
void loadSH(){ for (int i = 0; i < 9; i++) gSH[i] = texelFetch(uSH, ivec2(i, 0), 0).rgb; }
vec3 shIrrL(vec3 n){                                          // 与 common.glsl 的 shIrr(n, 0) 同式
  const float c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  float x = n.x, y = n.y, z = n.z;
  vec3 e = c1*gSH[8]*(x*x - y*y) + c3*gSH[6]*z*z + c4*gSH[0] - c5*gSH[6]
         + 2.0*c1*(gSH[4]*x*y + gSH[7]*x*z + gSH[5]*y*z) + 2.0*c2*(gSH[3]*x + gSH[1]*y + gSH[2]*z);
  return max(e, vec3(0.0));
}
vec3 shRadL(vec3 d){                                          // 辐亮度（带 0.85／0.55 的窗，少振铃）：积水、湿面、玻璃反射天光
  vec3 L = gSH[0]*0.2820948 + 0.85*0.4886025*(gSH[1]*d.y + gSH[2]*d.z + gSH[3]*d.x)
         + 0.55*(1.0925484*(gSH[4]*d.x*d.y + gSH[5]*d.y*d.z + gSH[7]*d.x*d.z) + 0.3153916*gSH[6]*(3.0*d.z*d.z - 1.0) + 0.5462742*gSH[8]*(d.x*d.x - d.y*d.y));
  return max(L, vec3(0.0));
}
// 地平线角图的软阴影（shadow.glsl 的 horizonVis 的柔化版：半影不小于该级纹素对应的角度，近级边缘与下一级混合；
// 原式只按日面角半径切，62 m 纹素的第 1 级在崖脚切出方块硬影）
float hzVis(vec2 dc, vec3 X, vec3 l){
  float el = asin(clamp(dot(l, -normalize(vec3(X.x, 0.0, X.z))), -1.0, 1.0));
  float th = uSunRho/length(uSunW - X), acc = 0.0, wsum = 0.0;
  for (int i = iZero(); i < 3; i++){
    vec4 L = uHzLvl[i]; vec2 p = (dc - L.xy)/L.z; float m = max(abs(p.x), abs(p.y));
    if (L.w > 0.5 && m < 0.97 && wsum < 0.999){
      vec2 hz = textureLod(uHorizon, vec2(p.x*0.5 + 0.5, (p.y*0.5 + 0.5 + float(i))/3.0), 0.0).rg;
      float pen = th + 0.0016*(1.0 + 3.0*float(i));
      float v = sat((hz.r + (el - hz.g))/(2.0*pen) + 0.5), w = (1.0 - sstep(0.82, 0.97, m))*(1.0 - wsum);
      acc += v*w; wsum += w;
    }
  }
  return acc + (1.0 - wsum);
}
// 高档的 8 方向扫描遮蔽：查地平线角图第 0 级的 B 通道（horizon.frag 烘的天空可见度）；级外与档位关时为 1，近级边缘淡出
float aoScan(vec2 dc){
#if TER_AO_SCAN
  vec4 L = uHzLvl[0]; vec2 p = (dc - L.xy)/L.z; float m = max(abs(p.x), abs(p.y));
  if (L.w < 0.5 || m > 0.96) return 1.0;
  float a = textureLod(uHorizon, vec2(p.x*0.5 + 0.5, (p.y*0.5 + 0.5)/3.0), 0.0).b;
  return mix(clamp(a, 0.0, 1.0), 1.0, sstep(0.75, 0.96, m));
#else
  return 1.0;
#endif
}
// 实例（石、草、枯木、墙）在地上的投影与接触暗边：fp/instances.js 渲的近景阴影图（以相机为中心、沿日光的正交深度图）。
// 没有阴影图（档位关、没画实例）时为 1。uInstShM：CM 相对相机坐标 → 阴影图（xy∈[−1,1]，z＝沿日光的深度 0–1）
#ifndef INST_SHADOW
#define INST_SHADOW 0
#endif
#if INST_SHADOW
uniform sampler2D uInstSh; uniform mat4 uInstShM; uniform vec4 uInstShP;   // P：x 半宽 km，y 启用，z 深度范围 km，w 纹素 km
float instShadow(vec3 v, vec3 n){
  if (uInstShP.y < 0.5) return 1.0;
  vec4 q = uInstShM*vec4(v + n*0.0004, 1.0);
  if (max(abs(q.x), abs(q.y)) > 0.98) return 1.0;
  vec2 uv = q.xy*0.5 + 0.5; float z = q.z - 0.0006/uInstShP.z, s = 0.0;
  vec2 px = vec2(1.0/float(textureSize(uInstSh, 0).x));
  for (int j = iZero() - 1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    float dz = textureLod(uInstSh, uv + vec2(float(i), float(j))*px, 0.0).r;
    s += step(z, dz);
  }
  return mix(s/9.0, 1.0, sstep(0.8, 0.98, max(abs(q.x), abs(q.y))));
}
#else
float instShadow(vec3 v, vec3 n){ return 1.0; }
#endif

// 统一光照：直射（日照×塔影×月掩日×大气×暗幕）×地形软阴影×云影×实例投影×微观自阴影 sh ＋ GGX 高光（菲涅耳）
// ＋ SH 天光（含空腔）×遮蔽 ＋ 天光镜面（球谐辐亮度×菲涅耳；湿面、积水、玻璃在掠射角上反出天光）
vec3 litSurfaceS(vec3 X, vec3 d, float t, vec3 n, Surf s, vec2 dc, float ao, float sh){
  float K = Kat(t, dot(uCamW, d));
  vec3 l; float vis; vec3 E = sunE(X, K, l, vis, true);
  vec3 col = vec3(0.0); float nl = dot(n, l), nv = max(dot(n, -d), 0.02);
  float F0 = mix(0.04, 0.02, s.wet);
  if (vis > 0.0 && (nl > 0.0 || s.trans > 0.0)){
    E *= hzVis(dc, X, l)*cloudShadowT(dc)*instShadow(X - uCamW, n)*sh;
    vec3 h = normalize(l - d); float a2 = pow(max(s.rough, 0.03), 4.0), nh = max(dot(n, h), 0.0);
    float D = a2/(PI*sq(nh*nh*(a2 - 1.0) + 1.0)), F = F0 + (1.0 - F0)*pow(1.0 - max(dot(h, -d), 0.0), 5.0);
    float k = 0.5*sq(s.rough + 1.0)*0.25, Vis = 0.25/((max(nl, 0.0)*(1.0 - k) + k)*(nv*(1.0 - k) + k));
    col += E*(s.alb/PI*max(nl, 0.0)*(1.0 - F) + s.spec*D*F*Vis*max(nl, 0.0));
    col += E*s.alb/PI*s.trans*abs(nl)*0.9*step(nl, 0.0);         // 叶片背光透亮（逆光的草叶发亮）
  }
  float Fs = F0 + (1.0 - F0)*pow(1.0 - nv, 5.0)*sq(1.0 - s.rough);
  vec3 refl = reflect(d, n);
  loadSH();
  vec3 Lsky = mix(shRadL(refl), shIrrL(refl)/PI, sat(s.rough*1.4 - 0.2));
  col += s.alb/PI*shIrrL(n)*ao*(1.0 - Fs) + s.spec*Fs*Lsky*mix(ao, 1.0, 0.4);
  return col;
}
vec3 litSurface(vec3 X, vec3 d, float t, vec3 n, Surf s, vec2 dc, float ao){ return litSurfaceS(X, d, t, n, s, dc, ao, 1.0); }

// ───── 坐标 ─────
// 地面米坐标：取第 5 层的图表坐标（旋转 rotK(5)），平铺 192 m；由 CPU 双精度取模的原点 uOrg[5] 推出，不随行走滑动。下面各尺度都整除 192 m。
// 换算：pm＝1000·rotK(5)·dc＋常数，所以地面上沿世界向量 w 的 pm 变化＝rotK(5)·(w·gE, w·gN)（gE、gN＝图表梯度，单位 1）
vec2 groundM(vec2 dc){ return ((rotK(5)*dc)/(LAY_L[5]*TILE) + uOrg[5])*192.0; }
// 崖面坐标（米）：x＝沿崖的东向（第 6 层纹理坐标的 y 分量 × 480 km 周期），y＝离轴半径往下（45 m 一层的整数号＋小数，CPU 取模，不滑动）
vec2 cliffM(vec2 dc, vec3 v){
  float kB = floor(uCamRho/0.045 - uStrataC + 0.5);
  float em = ((rotK(6)*dc).y/(LAY_L[6]*TILE) + uOrg[6].y)*480000.0;
  float hm = -(mod(kB, 1024.0) + uStrataC + dRxz(v)/0.045)*45.0;
  return vec2(em, hm);
}

// ───── 地表参数（按分域权重混合；统一求值一次） ─────
// 值噪声及其梯度（对 p）：xyz＝(值, ∂/∂x, ∂/∂y)，周期 per（格）
vec3 vnoiseG(vec2 p, float per, uint seed){
  vec2 i = floor(p), f = p - i, u = f*f*(3.0 - 2.0*f), du = 6.0*f*(1.0 - f);
  float a = cellH(i, per, seed).x, b = cellH(i + vec2(1.0, 0.0), per, seed).x, c = cellH(i + vec2(0.0, 1.0), per, seed).x, e = cellH(i + vec2(1.0), per, seed).x;
  return vec3(mix(mix(a, b, u.x), mix(c, e, u.x), u.y), du.x*(b - a + (a - b - c + e)*u.y), du.y*(c - a + (a - b - c + e)*u.x));
}
struct GP {
  vec3 soil, soil2;          // 土／砂的两种色（细斑在两者之间）
  vec3 stA, stB; float stMix;// 碎石两种石色、B 的比例
  vec3 dens0, dens1;         // 碎石密度：细贴图（2.4 m 一张：半径 1–11 cm）与粗贴图（7.68 m：3–37 cm）各三个尺度
  float slab; vec3 slabC;    // 基岩板（罪域玄武岩、轻域灰岩）的出露程度与色
  float crust, pud, turf, glass, frost, lich;
  vec3 turfA, turfB;         // 草皮两种色（青、黄）
  float wet;                 // 湿（0 干 1 全湿）
};
// 地面细节贴图（fp/instances.js 启动时烘焙，见 ground_bake.frag）：uGrDet 碎石，uGrVor 多边形板
uniform sampler2D uGrDet, uGrVor;
// 碎石贴图里一点的石高（米）：这块石头按它的出现序与本尺度的密度比较，不在就是平地。T＝贴图覆盖的边长（米）
float stoneZ(vec4 t, vec3 dens, float T){
  float c = floor(t.g*2.9999), r = fract(t.g*2.9999 + 1e-4)*1.0;
  float dc = c < 0.5 ? dens.x : c < 1.5 ? dens.y : dens.z;
  return step(r, dc)*step(t.g, 0.999)*t.r*0.1*T/2.4;
}
struct Ground { Surf s; vec2 slope; float ao; float sh; float pud; };
vec3 gDbg = vec3(0.0);
// 地表求值。pm 地面米坐标；footM 像素足迹（米，已按掠射放大）；sunT 日光在地面米坐标里的切向偏移（每米高度）
Ground groundSurf(GP P, vec2 pm, float footM, vec2 sunT, float relief, float rain, float flatG){
  Ground G; G.ao = 1.0; G.sh = 1.0; G.pud = 0.0; G.slope = vec2(0.0);
  // 砂、土：四个八度的细斑与微起伏（1.5、5、16 cm 的颗粒，0.5 m 的小坑小坎），按足迹逐级淡到平均
  float g = 0.0, sc = 0.015;
  for (int o = iZero(); o < 4; o++){
    float fd = 1.0 - sstep(0.4*sc, 1.2*sc, footM);
    vec3 n = vnoiseG(pm/sc, 192.0/sc, 31u + uint(o));
    g += fd*(n.x - 0.5)*(o == 0 ? 1.4 : o == 3 ? 0.6 : 1.0);
    G.slope += fd*n.yz*(o == 3 ? 0.07 : 0.015);
    sc *= o == 2 ? 3.125 : 3.2;
  }
  vec3 alb = mix(P.soil, P.soil2, sat(0.5 + 0.35*g));
  float rough = 0.92, cov = 0.0;
  // 多边形板（一个循环）：0 草皮的一簇簇草（6 cm）、1 基岩板（1.2 m，罪域玄武岩、轻域灰岩）、
  //   2 硫酸盐结壳（0.48 m，罪域洼处）、3 黑玻璃斑（1.2 m，灵薄带）。各自的缝、翘边、颜色、光泽只是参数不同
  for (int L = iZero() + 1; L < 4; L++){
    float w = L == 0 ? P.turf : L == 1 ? P.slab : L == 2 ? P.crust : P.glass;
    if (w < 0.01) continue;
    float cell = L == 0 ? 0.06 : L == 2 ? 0.48 : 1.2;
    vec2 uvp = (L == 1 ? vec2(0.8*pm.x - 0.6*pm.y, 0.6*pm.x + 0.8*pm.y) : pm)/(cell*16.0);   // 板贴图每边 16 格（周期都整除 192 m）
    vec4 v = textureLod(uGrVor, uvp, 0.0); v.x *= 0.5;
    float fd = 1.0 - sstep(0.15*cell, 0.6*cell, footM);              // 缝与翘边的可见程度（足迹淡出）
    vec3 cA = L == 0 ? P.turfA : L == 1 ? P.slabC : L == 2 ? vec3(0.52, 0.47, 0.30) : vec3(0.016, 0.016, 0.02);
    vec3 cB = L == 0 ? P.turfB : L == 1 ? P.slabC*1.3 : L == 2 ? vec3(0.60, 0.56, 0.40) : vec3(0.03, 0.03, 0.035);
    vec3 col = mix(cA, cB, L == 0 ? sstep(0.55, 0.9, v.y) : v.y)*(L == 3 ? 1.0 : 0.78 + 0.45*v.z);
    // 缝：草簇之间是一道宽的暗缝（露土、阴影），岩板与结壳是细裂缝，玻璃是亮的碎边
    float gw = L == 0 ? 0.16 : L == 1 ? 0.025 : L == 2 ? 0.05 : 0.04;
    float gap = (1.0 - sstep(0.004 + 0.1*gw, gw, v.x))*fd;
    vec3 gapC = L == 0 ? mix(P.soil*0.5, col*0.45, 0.5) : L == 3 ? vec3(0.17, 0.17, 0.19) : (L == 2 ? P.soil*0.55 : col*0.25);
    vec3 avg = mix(col, gapC, (L == 0 ? 0.3 : 0.06));
    col = mix(avg, mix(col, gapC, gap), fd);
    if (L == 2) col += sstep(0.05, 0.1, v.x)*(1.0 - sstep(0.1, 0.22, v.x))*fd*vec3(0.12, 0.12, 0.08);   // 结壳翘边发白
    if (L == 0) col *= 1.0 + 0.3*fd*(vnoiseG(vec2(dot(pm, vec2(0.8, 0.6)), dot(pm, vec2(-0.6, 0.8))*0.15)/0.006, 32000.0, 213u).x - 0.5);   // 叶的细纹
    if (L == 1) col *= 1.0 - 0.5*(1.0 - sstep(0.004, 0.02, footM))*sstep(0.66, 0.82, vnoiseG(pm/0.02, 9600.0, 37u).x);     // 酸蚀麻坑
    alb = mix(alb, col, w);
    rough = mix(rough, L == 0 ? 0.8 : L == 1 ? 0.72 : L == 2 ? 0.93 : mix(0.07, 0.35, gap), w);
    vec2 tilt = (v.zw - 0.5)*(L == 0 ? 0.4 : L == 1 ? 0.3 : L == 2 ? 0.15 : 0.35)*fd;
    if (L == 2) tilt -= 0.5*fd*sstepD(0.04, 0.16, v.x)*normalize(v.zw - 0.5 + 1e-3);
    G.slope = mix(G.slope, G.slope*0.6 + tilt, w);
    G.ao *= 1.0 - (L == 0 ? 0.3 : L == 3 ? 0.0 : 0.5)*gap*w;
    if (L != 0) cov = max(cov, w*0.6);
  }
  // 碎石：两张贴图尺度（细：2.4 m 一张；粗：7.68 m、转 36.87°），各自三个尺度的石头按密度出现。
  //   石高取贴图，法线由相邻纹素差分（八边形截锥的几个斜面），石根一圈接触暗边，沿日向 4 步找投影（石头投在地上、也投在别的石头上）。
  //   足迹大于几个纹素就淡成平均色（覆盖率×石色、缝隙的平均暗）
  vec3 stAvg = mix(P.stA, P.stB, P.stMix);
  float tl = 1.0 - 0.75*P.turf - 0.8*P.glass;
  for (int s = iZero(); s < 2; s++){
    float T = s == 0 ? 2.4 : 7.68, tx = T/1024.0;
    vec3 dens = (s == 0 ? P.dens0 : P.dens1)*tl;
    float covA = 1.0 - (1.0 - 0.25*dens.x)*(1.0 - 0.25*dens.y)*(1.0 - 0.25*dens.z);
    if (covA < 0.003) continue;
    float fd = 1.0 - sstep(4.0*tx, 10.0*tx, footM);
    vec3 farA = mix(alb, stAvg*0.85, covA*(1.0 - cov));
    if (fd <= 0.0){ alb = farA; G.ao *= 1.0 - 0.25*covA; continue; }
    vec2 q = (s == 0 ? pm : vec2(0.8*pm.x + 0.6*pm.y, -0.6*pm.x + 0.8*pm.y))/T;
    vec4 t0 = textureLod(uGrDet, q, 0.0), t1 = textureLod(uGrDet, q + vec2(1.0/1024.0, 0.0), 0.0), t2 = textureLod(uGrDet, q + vec2(0.0, 1.0/1024.0), 0.0);
    float z0 = stoneZ(t0, dens, T), z1 = stoneZ(t1, dens, T), z2 = stoneZ(t2, dens, T);
    vec2 gr = vec2(z1 - z0, z2 - z0)/tx;
    if (s == 1) gr = vec2(0.8*gr.x - 0.6*gr.y, 0.6*gr.x + 0.8*gr.y);   // 转回地面米坐标
    float on = sstep(0.0, 0.002*T/2.4, z0);
    // 接触暗边：这块石头在、本点在石外一圈（a＝m/1.75∈[0.57, 1)）
    float present = stoneZ(vec4(1.0, t0.g, 0.0, 0.0), dens, T) > 0.0 ? 1.0 : 0.0;
    float ring = present*(1.0 - on)*(1.0 - sstep(0.58, 1.0, t0.a));
    // 投影：沿日向走 4 步（每步约半块小石头的高度），视线高度按日高角爬升
    float shd = 1.0;
    for (int j = 1; j <= 4; j++){
      float sj = float(j)*0.008*T/2.4;
      vec2 sd = sunT/max(length(sunT), 1e-4);
      vec2 qj = q + (s == 0 ? sd : vec2(0.8*sd.x + 0.6*sd.y, -0.6*sd.x + 0.8*sd.y))*sj/T;
      float zj = stoneZ(textureLod(uGrDet, qj, 0.0), dens, T), zr = z0 + sj/max(length(sunT), 0.05);
      shd = min(shd, 1.0 - sstep(0.0, 0.004*T/2.4, zj - zr));
    }
    vec3 sc = mix(P.stA, P.stB, step(1.0 - P.stMix, t0.b))*(0.7 + 0.6*fract(t0.b*7.31));
    sc = mix(sc, P.soil, 0.25*(1.0 - sstep(0.2, 0.8, length(gr)))*(1.0 - P.wet));   // 平顶上落着一层土
    if (s == 0) gDbg = vec3(on, fd, covA*3.0);
    vec3 nearA = mix(alb, sc, on);
    alb = mix(farA, nearA, fd);
    G.slope = mix(G.slope, mix(G.slope, gr, on), fd);
    rough = mix(rough, mix(0.75, 0.35, P.wet), on*fd);
    G.ao *= mix(1.0 - 0.25*covA, 1.0 - 0.5*ring, fd);
    G.sh *= mix(1.0, mix(0.15, 1.0, shd), fd);
    cov = max(cov, on*fd);
  }
  // 草皮：覆盖度 P.turf 是连续的场，按 4–12 cm 的簇噪声取阈值（覆盖度低时是零星的草簇，高时连成片）；
  //   草里是三个方向的细长叶纹（叶宽约 5 mm、长约 4 cm），叶间暗；颜色按 0.7 m 的斑在青、黄之间。足迹大时淡成平均的绒面
  if (P.turf > 0.01){
    vec3 n1 = vnoiseG(pm/0.12, 1600.0, 221u), n2 = vnoiseG(pm/0.04, 4800.0, 223u);
    float nt = n1.x*0.65 + n2.x*0.35, fdT = 1.0 - sstep(0.02, 0.08, footM);
    float tc = mix(sstep(0.3, 0.7, P.turf), sstep(nt - 0.1, nt + 0.1, P.turf*1.2 - 0.1), fdT);
    float hue = sat(vnoiseG(pm/0.7, 280.0, 225u).x + 0.35*(n1.x - 0.5));
    vec3 base = mix(P.turfA, P.turfB, sstep(0.45, 0.85, hue));
    float bl = 0.0, fdB = 1.0 - sstep(0.002, 0.008, footM);
    if (fdB > 0.0){
      for (int k = iZero(); k < 3; k++){
        vec2 ax = k == 0 ? vec2(0.8, 0.6) : k == 1 ? vec2(-0.28, 0.96) : vec2(0.96, -0.28);
        vec2 qb = vec2(dot(pm, ax), dot(pm, vec2(-ax.y, ax.x)));
        bl = max(bl, vnoiseG(vec2(qb.x/0.0048, qb.y/0.0384), 1.0e6, 227u + uint(k)).x);
      }
    }
    float lit = mix(0.8, 0.4 + 0.9*bl*bl, fdB);
    vec3 col = base*lit*(0.85 + 0.3*n2.x);
    alb = mix(alb, col, tc); rough = mix(rough, 0.75, tc);
    G.slope = mix(G.slope, G.slope*0.3 + (n2.yz*0.02 + n1.yz*0.01)*fdT, tc);
    G.ao *= mix(1.0, mix(0.85, 0.6 + 0.4*bl, fdB), tc);
    G.sh *= mix(1.0, mix(0.8, 0.55 + 0.45*bl, fdB), tc);       // 草叶相互遮挡的直射
  }
  // 霜（轻域洼处与背阴）、地衣（大石上的橙、灰绿斑）
  if (P.frost > 0.01){ alb = mix(alb, vec3(0.80, 0.82, 0.86), P.frost*sat(0.6 + 0.8*g)); rough = mix(rough, 0.55, P.frost); G.slope *= 1.0 - 0.6*P.frost; }
  if (P.lich > 0.01){
    vec3 ln = vnoiseG(pm/0.05, 3840.0, 53u);
    float lc = (1.0 - sstep(0.004, 0.02, footM))*sstep(0.62, 0.78, ln.x)*cov;
    alb = mix(alb, mix(vec3(0.33, 0.30, 0.12), vec3(0.42, 0.20, 0.06), step(0.0, ln.y)), lc*P.lich);
  }
  // 湿：砂土吸水变暗（多孔），石面发黑、发亮
  float w = P.wet;
  alb *= mix(1.0, mix(0.55, 0.7, cov), w);
  rough = mix(rough, mix(0.45, 0.25, cov), w);
  // 积水：最低处（细层起伏的洼）、平的地方；下雨时多一些。黄绿酸水（罪域）／清水，镜面、平，雨点涟漪
  if (P.pud > 0.01){
    float lv = mix(-0.5, -0.4, rain);
    float pd = P.pud*sstep(lv, lv - 0.08, relief)*sstep(0.92, 0.985, flatG);
    if (pd > 0.0){
      alb = mix(alb, vec3(0.030, 0.034, 0.012), pd); rough = mix(rough, 0.03, pd); w = max(w, pd);
      float fr = rain*(1.0 - sstep(0.005, 0.03, footM));
      vec3 rp = vnoiseG(pm/0.06 + vec2(float(uFrame & 1023)*0.29, float(uFrame & 1023)*0.31), 3200.0, 91u);
      G.slope = mix(G.slope, rp.yz*0.05*fr, pd); G.ao = mix(G.ao, 1.0, pd); G.sh = mix(G.sh, 1.0, pd); G.pud = pd;
    }
  }
  G.s = surf0(alb, rough); G.s.wet = w;
  return G;
}
// 各域的参数（w＝分域权重：x 轻 y 平 z 重 w 罪域；limbo 灵薄）。relief：细层起伏（−1 洼 … 1 高）；matA：第 3 层材质噪声；patchN：20 m 一块的斑
GP zoneParams(vec4 zw, float limbo, float flatG, float relief, float matA, float patchN, float rain, float shade){
  GP P;
  float wo = (1.0 - zw.w)*(1.0 - limbo), wR = zw.w*(1.0 - limbo), wL = zw.x*wo, wP = zw.y*wo, wH = zw.z*wo;
  // 罪域：锈红砂＋玄武岩屑；高处、陡处出露玄武岩板；洼处硫酸盐结壳；最低处酸水；常年潮湿，雨中全湿
  float rSlab = sstep(0.3, 0.6, relief + 0.7*(patchN - 0.5) + 0.35*(matA - 0.5)) + 0.6*(1.0 - flatG);
  float rCrust = sstep(-0.12, -0.35, relief + 0.25*(patchN - 0.5))*flatG*(0.4 + 0.6*sstep(0.35, 0.7, matA));
  // 轻域：灰白砾、零星基岩、洼处与背阴积霜
  float lSlab = 0.7*sstep(0.35, 0.65, relief + 0.6*(patchN - 0.5)) + 0.6*(1.0 - flatG);
  // 平域：草皮（坡上与高处稀，露土与石子）
  float pTurf = flatG*sat(0.95 - 0.6*sat(relief) + 0.8*(patchN - 0.5) - 0.6*sstep(0.75, 0.92, matA));
  float hTurf = 0.6*flatG*sat(matA - 0.25 + 0.6*(patchN - 0.5));
  float lTurf = 0.35*flatG*sat(0.4 - relief + 0.8*(patchN - 0.5));        // 轻域：背风洼处零星的草
  P.soil  = wR*vec3(0.20, 0.072, 0.038) + wL*vec3(0.36, 0.355, 0.35) + wP*vec3(0.12, 0.095, 0.07) + wH*vec3(0.095, 0.078, 0.062);
  P.soil2 = wR*vec3(0.12, 0.050, 0.032) + wL*vec3(0.46, 0.455, 0.45) + wP*vec3(0.085, 0.07, 0.055) + wH*vec3(0.13, 0.105, 0.08);
  P.stA   = wR*vec3(0.032, 0.030, 0.029) + wL*vec3(0.56, 0.55, 0.53) + wP*vec3(0.21, 0.19, 0.16) + wH*vec3(0.07, 0.062, 0.054);
  P.stB   = wR*vec3(0.15, 0.060, 0.036) + wL*vec3(0.30, 0.30, 0.31) + wP*vec3(0.12, 0.105, 0.085) + wH*vec3(0.15, 0.12, 0.085);
  P.stMix = wR*0.28 + wL*0.35 + wP*0.4 + wH*0.3;
  float rich = 0.5 + patchN;                                       // 碎石成片：有的地方满地碎石，有的地方只有砂
  P.dens0 = (wR*vec3(0.35, 0.5, 0.75) + wL*vec3(0.45, 0.6, 0.8) + wP*vec3(0.12, 0.18, 0.3) + wH*vec3(0.4, 0.55, 0.7))*rich;
  P.dens1 = (wR*vec3(0.07, 0.14, 0.25) + wL*vec3(0.12, 0.22, 0.35) + wP*vec3(0.02, 0.04, 0.08) + wH*vec3(0.1, 0.2, 0.3))*rich;
  P.slab  = sat(wR*rSlab + wL*lSlab);
  P.slabC = (wR*vec3(0.036, 0.033, 0.031) + wL*vec3(0.44, 0.43, 0.41))/max(wR + wL, 1e-3);
  P.crust = wR*sat(rCrust)*(1.0 - P.slab);
  P.pud   = wR*(1.0 - P.slab)*0.9 + (wP + wH)*0.25*rain;
  P.turf  = sat(wP*pTurf + wH*hTurf + wL*lTurf);
  P.turfA = wP > wH + wL ? vec3(0.055, 0.10, 0.030) : vec3(0.10, 0.10, 0.055);
  P.turfB = wP > wH + wL ? vec3(0.14, 0.13, 0.055) : vec3(0.17, 0.14, 0.08);
  P.glass = limbo*sstep(0.62, 0.72, matA + 0.3*(patchN - 0.5));
  P.frost = wL*sat(sstep(-0.05, -0.35, relief)*flatG*(0.5 + 0.5*matA) + 0.6*shade);
  P.lich  = wL + 0.5*wH;
  P.wet   = wR*mix(0.35, 1.0, rain) + (wP + wH + wL)*0.8*rain;
  // 灵薄带：灰烬
  P.soil = mix(P.soil, vec3(0.22, 0.215, 0.225), limbo); P.soil2 = mix(P.soil2, vec3(0.17, 0.165, 0.175), limbo);
  P.stA = mix(P.stA, vec3(0.30, 0.30, 0.31), limbo); P.stB = mix(P.stB, vec3(0.12, 0.12, 0.13), limbo);
  P.dens0 = mix(P.dens0, vec3(0.1, 0.2, 0.3), limbo); P.dens1 = mix(P.dens1, vec3(0.02, 0.04, 0.06), limbo);
  return P;
}

// ───── 岩层与崖面 ─────
// 各域岩色（4 种），idx 0–3
vec3 rockPal(vec4 zw, float limbo, float idx){
  vec3 r0 = vec3(0.034, 0.031, 0.030), r1 = vec3(0.20, 0.072, 0.040), r2 = vec3(0.10, 0.046, 0.032), r3 = vec3(0.15, 0.10, 0.065);   // 罪域
  vec3 h0 = vec3(0.085, 0.072, 0.060), h1 = vec3(0.13, 0.10, 0.07), h2 = vec3(0.10, 0.10, 0.095), h3 = vec3(0.07, 0.06, 0.05);     // 重域
  vec3 p0 = vec3(0.21, 0.19, 0.16), p1 = vec3(0.16, 0.14, 0.11), p2 = vec3(0.25, 0.23, 0.20), p3 = vec3(0.13, 0.12, 0.11);         // 平域
  vec3 l0 = vec3(0.46, 0.45, 0.43), l1 = vec3(0.56, 0.55, 0.53), l2 = vec3(0.36, 0.36, 0.37), l3 = vec3(0.50, 0.48, 0.44);         // 轻域
  vec4 w = vec4(1.0 - step(0.5, idx), step(0.5, idx)*(1.0 - step(1.5, idx)), step(1.5, idx)*(1.0 - step(2.5, idx)), step(2.5, idx));
  vec3 rui = w.x*r0 + w.y*r1 + w.z*r2 + w.w*r3, hv = w.x*h0 + w.y*h1 + w.z*h2 + w.w*h3, pl = w.x*p0 + w.y*p1 + w.z*p2 + w.w*p3, lt = w.x*l0 + w.y*l1 + w.z*l2 + w.w*l3;
  vec3 c = mix(lt*zw.x + pl*zw.y + hv*zw.z, rui, zw.w);
  return mix(c, mix(vec3(0.21, 0.21, 0.22), vec3(0.03, 0.03, 0.035), step(1.5, idx)), limbo);
}
// 崖面：岩层是水平的（只随高度变），厚薄不一；竖向节理把岩层切成一块块（块面各自朝向，向光面亮背光面暗）；
// 节理缝与冲沟里暗；岩面凹凸取高度图（东向、高度上取样，按投影足迹淡出）。cm＝崖面米坐标，footV＝投影足迹（米）
struct Cliff { vec3 alb; vec2 slope; float ao; float rough; };
Cliff cliffFace(vec2 cm, float footV, vec4 zw, float limbo, float wet){
  Cliff C;
  float kA = gKA, st = max(gStep, 0.0);
  vec3 r = lvlR(kA*7.0 + st, 91u);
  // 岩层：厚 1.5–9 m 的薄层，按高度（不随东西变），层界处有一道暗线（层面凹进）；子台阶之间换岩性
  float th = 1.5 + 7.5*r.y, lay = cm.y/th, li = floor(lay), lf = lay - li;
  vec3 lr = hash3f(uvec3(uint(int(mod(li, 4096.0))), uint(int(kA) + 8192), 97u));
  float fl = 1.0 - sstep(0.1*th, 0.4*th, footV);
  vec3 base = mix(rockPal(zw, limbo, floor(r.x*4.0)), rockPal(zw, limbo, floor(lr.x*4.0)), sstep(0.6, 0.85, lr.y)*0.85*fl);
  base *= mix(1.0, 0.75 + 0.5*lr.z, fl);
  float seam = (1.0 - sstep(0.0, 0.06, lf))*fl;                   // 层界凹槽
  // 竖向节理：每层里按 2–9 m 一块切开（相邻层错开），块面朝向随机
  float bw = (2.0 + 7.0*lr.y), bx = cm.x/bw + lr.z*7.0, bi = floor(bx), bf = bx - bi;
  vec3 br = hash3f(uvec3(uint(int(mod(bi, 65536.0))), uint(int(mod(li, 4096.0))), 131u + uint(int(kA) & 255)));
  float fb = 1.0 - sstep(0.04*bw, 0.15*bw, footV);
  float joint = (1.0 - sstep(0.0, 0.05, min(bf, 1.0 - bf)))*fb;
  C.slope = fb*vec2((br.x - 0.5)*0.9, (br.y - 0.5)*0.6) + fl*vec2(0.0, -2.5*(1.0 - sstep(0.0, 0.1, lf)));
  base *= mix(1.0, 0.8 + 0.4*br.z, fb);
  // 岩面凹凸：24 m、6 m 两个尺度的高度图（.gb 是梯度），足迹淡出
  float ao = 1.0;
  for (int k = iZero(); k < 2; k++){
    float T = k == 0 ? 24.0 : 6.0, fd = 1.0 - sstep(T/600.0, T/150.0, footV);
    if (fd <= 0.0) continue;
    vec4 tx = textureLod(uHeight, cm/T, 0.0);
    C.slope += fd*0.005*tx.gb*vec2(0.7, 1.2);
    ao *= 1.0 - fd*0.22*sstep(0.1, -0.5, tx.r);
    base *= 1.0 + fd*0.16*(tx.a - 0.5);
  }
  float dgu, Gu = gullyF(gL3.r, dgu);
  ao *= (1.0 - 0.35*Gu*terRel())*(1.0 - 0.6*seam)*(1.0 - 0.6*joint);
  C.alb = base*mix(1.0, 0.55, wet); C.rough = mix(0.88, 0.35, wet); C.ao = ao;
  return C;
}
// 田块（平域踏面）：沿阶走的条带（宽约 60 m），沿阶每约 150 m 分一块，按块定作物；块里是顺等高线的垄沟或作物行，块间是 2 m 宽的田埂、树篱。
// 返回 x 田块权重、y 田埂权重、z 作物类别（0 翻耕 1 青苗 2 茬地 3 休耕），w 垄的相位（米）。实例层用同一个函数剔草（fieldAt）
vec4 fieldInfo(vec2 dc, float zPlain, float flatG){
  if (uGroundMode != 1 || zPlain < 0.05 || gQ >= 0.0 || gTal > 0.02) return vec4(0.0);
  vec2 uv6 = (rotK(6)*dc)/(LAY_L[6]*TILE) + uOrg[6];
  float across = gU*uW*1000.0, along = uv6.y*480000.0;           // 米
  float strip = floor(across/60.0), seg = floor(along/150.0), lvl = gKA;
  vec3 h = hash3f(uvec3(uint(mod(strip, 4096.0)) + 4096u*uint(mod(max(lvl, 0.0), 512.0)), uint(mod(seg, 3200.0)), 3571u));
  float has = step(h.x, 0.6)*zPlain*sstep(0.94, 0.985, flatG)*sstep(uCliffC + 0.03, uCliffC + 0.08, gU)*(1.0 - sstep(0.75, 0.95, gU));
  if (has <= 0.0) return vec4(0.0);
  float eA = min(fract(across/60.0), 1.0 - fract(across/60.0))*60.0, eB = min(fract(along/150.0), 1.0 - fract(along/150.0))*150.0;
  float bund = 1.0 - sstep(0.8, 2.2, min(eA, eB));               // 田埂
  return vec4(has*(1.0 - bund), has*bund, floor(h.y*4.0), across);
}
// 小径：图表上低频 Voronoi 的边（宽 1.5 m）。取第 2 层的纹理坐标（周期 35 km，128 格 → 每格约 275 m），所以不随行走滑动
float pathMask(vec2 dc, float foot){
  if (foot > 0.006) return 0.0;
  mat2 Rk = rotK(2); vec2 uv = (Rk*dc)/(LAY_L[2]*TILE) + uOrg[2];
  vec2 p = uv*128.0, ip = floor(p); float f1 = 9.0, f2 = 9.0;
  for (int j = iZero() - 1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 c = ip + vec2(float(i), float(j)), cw = mod(c, 128.0);
    vec3 h = hash3f(uvec3(uint(cw.x), uint(cw.y), 913u));
    float d = length(c + h.xy - p);
    if (d < f1){ f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  float e = 0.5*(f2 - f1)*(LAY_L[2]*TILE/128.0);              // 到边的距离 km（近似）
  return (1.0 - sstep(0.0005, 0.0011, e))*(1.0 - sstep(0.002, 0.006, foot));
}

// ───── 合成 ─────
// n＝几何法线（求交 pass 在命中点算好、经 G 缓冲传来）；阶地缓存 gU、gKA、gQ、gTal、gLedge、gStep、gDc、gL3–5 已由 terrain.frag 置好
vec3 shadeTerrainC(vec3 v, vec3 d, float t, float foot, vec3 n){
  vec3 X = uCamW + v;
  vec2 dc = gDc;
  vec4 zw = zoneW(X); float limbo = limboW(X);
  vec3 upG = -vec3(X.x, 0.0, X.z)/length(X.xz);
  vec3 upRef = uGroundMode == 1 ? upG : macroUp(X);             // 斜坡模式：平不平看相对宏观地面的局部坡度，不看整片大地的倾角
  float nu = dot(n, upRef), flatG = sat((nu - 0.80)/0.15);
  float cliffW = sstep(0.62, 0.3, dot(n, upG))*step(0.5, float(uGroundMode));   // 近乎竖直的面：崖面着色（阶地）
  if (uGroundMode == 0) cliffW = sstep(0.45, 0.2, nu);
  float footM = foot*1000.0, footV = footM/max(abs(dot(n, -d)), 0.15);   // 像素足迹（米）；投影足迹（掠射时放大）
  float relief = (gL5.r*0.55 + gL4.r*0.45)*(1.0 - sstep(0.4, 2.0, foot)), matA = gL3.a;
  float rain = sat(rainAt(X));
  vec3 gE, gN; chartGrad(X, gE, gN);
  mat2 R5 = rotK(5);
  vec2 pm = groundM(dc);
  // 日光在地面米坐标里的切向偏移（每米高度），太阳低时截到 3
  vec3 lS = normalize(uSunW - X);
  float sinE = max(dot(lS, n), 0.05);
  vec2 lT = R5*vec2(dot(lS, gE), dot(lS, gN));
  vec2 sunT = lT/max(length(lT), 1e-4)*min(sqrt(max(1.0 - sinE*sinE, 0.0))/sinE, 3.0);
  float patchN = vnoiseG(pm/24.0, 8.0, 17u).x*0.65 + vnoiseG(pm/6.0, 32.0, 19u).x*0.35;
  float shade = sstep(0.25, 0.0, dot(lS, upG));                 // 太阳低于地平线附近（背阴、夜里结霜）
  GP P = zoneParams(zw, limbo, flatG, relief, matA, patchN, rain, shade);
  Ground G = groundSurf(P, pm, footV, sunT, relief, rain, flatG);
#define TER_DBG 1
#ifdef TER_DBG
  { return gDbg; }
#endif
  Surf s = G.s; float ao = G.ao, sh = G.sh;
  vec3 dGround; { vec2 gg = transpose(R5)*G.slope; dGround = gg.x*gE + gg.y*gN; }
  // 坡面（非崖带、但陡）：岩层露头（按高度的水平层），碎屑顺坡
  vec2 cm = cliffM(dc, v);
  float slopeW = (1.0 - flatG)*(1.0 - cliffW);
  if (slopeW > 0.01){
    float fl = 1.0 - sstep(2.0, 12.0, footV);
    float bandN = cm.y/9.0 + 0.5*vnoiseG(vec2(cm.x/300.0, cm.y/90.0), 1600.0, 41u).x;
    vec3 rb = hash3f(uvec3(uint(mod(floor(bandN), 4096.0)), 17u, 43u));
    vec3 bc = rockPal(zw, limbo, floor(rb.x*4.0))*(0.8 + 0.4*rb.y);
    float outc = sstep(0.4, 0.7, rb.z)*slopeW;                     // 这一层露出来（否则是碎屑盖着）
    s.alb = mix(s.alb, mix(s.alb*0.9 + bc*0.1, bc, outc*fl), slopeW*0.85);
    s.rough = mix(s.rough, 0.85, slopeW*0.5);
  }
  // 崖面
  vec3 dCliff = vec3(0.0);
  if (cliffW > 0.01){
    Cliff c = cliffFace(cm, footV, zw, limbo, P.wet);
    vec3 eW = normalize(gE - upG*dot(gE, upG));
    dCliff = c.slope.x*eW + c.slope.y*upG;
    s.alb = mix(s.alb, c.alb, cliffW); s.rough = mix(s.rough, c.rough, cliffW); s.wet = mix(s.wet, P.wet*0.7, cliffW);
    ao = mix(ao, c.ao, cliffW); sh = mix(sh, 1.0, cliffW);
  }
  // 台坎、倒石坡上的碎屑：轻域积霜雪，平域长草
  if (gLedge > 0.01 && flatG > 0.2){
    vec3 deb = mix(s.alb*1.1, vec3(0.78, 0.8, 0.84), zw.x*(1.0 - zw.w)*0.6);
    deb = mix(deb, vec3(0.07, 0.10, 0.035), zw.y*(1.0 - zw.w)*0.6);
    s.alb = mix(s.alb, deb, gLedge*flatG*0.7);
  }
  // 逐级色调：远近各级的岩土略有不同（±8%）
  vec3 lv = lvlR(gKA, 23u);
  s.alb *= (0.92 + 0.16*lv.x)*vec3(1.0 + 0.05*(lv.y - 0.5), 1.0, 1.0 - 0.05*(lv.y - 0.5));
  // 小径、田块
  float pw = pathMask(dc, foot)*(zw.x + zw.y)*(1.0 - zw.w)*flatG;
  if (pw > 0.0){ s.alb = mix(s.alb, vec3(0.20, 0.17, 0.13), pw); s.rough = mix(s.rough, 0.8, pw); dGround *= 1.0 - 0.8*pw; ao = mix(ao, 1.0, pw); sh = mix(sh, 1.0, pw); }
  vec4 fi = fieldInfo(dc, zw.y*(1.0 - zw.w)*(1.0 - limbo), flatG);
  if (fi.x + fi.y > 0.0){
    float fr = 1.0 - sstep(0.004, 0.03, footV), ph = fi.w;
    float furrow = 0.5 + 0.5*sin(ph*6.2832/0.75), row = 0.5 + 0.5*sin(ph*6.2832/0.5);
    vec3 crop; float rgh = 0.9;
    if (fi.z < 0.5){ crop = vec3(0.12, 0.085, 0.06)*mix(0.85, 0.55 + 0.6*furrow, fr); rgh = 0.95; }             // 翻耕：垄沟
    else if (fi.z < 1.5){ crop = mix(vec3(0.11, 0.085, 0.06), vec3(0.06, 0.11, 0.03), mix(0.7, sstep(0.3, 0.7, row), fr)); }   // 青苗成行
    else if (fi.z < 2.5){ crop = mix(vec3(0.24, 0.20, 0.10), vec3(0.16, 0.13, 0.07), mix(0.35, 1.0 - sstep(0.4, 0.8, row), fr)); } // 茬地
    else crop = mix(vec3(0.09, 0.10, 0.045), vec3(0.13, 0.11, 0.06), vnoiseG(pm/0.3, 640.0, 81u).x);                 // 休耕：杂草
    float edge = sstep(0.0, 0.25, fi.x);                            // 田块与草地之间不是硬边
    s.alb = mix(s.alb, crop, fi.x*edge); s.rough = mix(s.rough, rgh, fi.x);
    vec3 gU3 = normalize(gN - upG*dot(gN, upG));
    dGround = mix(dGround, gU3*fr*0.35*cos(ph*6.2832/0.75)*step(fi.z, 0.5), fi.x);
    s.alb = mix(s.alb, vec3(0.045, 0.07, 0.025)*(0.8 + 0.4*vnoiseG(pm/0.4, 480.0, 83u).x), fi.y);   // 田埂、树篱
    ao = mix(ao, 0.75, fi.y); sh = mix(sh, 1.0, fi.x);
  }
  // 深渊沟里的暗湿岩
  float tw = 1.0 - sstep(uAbyssHalf - min(10.0, 0.4*uAbyssHalf), uAbyssHalf, abs(X.y));
  if (tw > 0.0 && uAbyssDepth > 0.001){ s.alb *= mix(1.0, 0.45, tw); s.wet = max(s.wet, 0.3*tw); }
  // 法线：地面扰动（按平坦程度）＋崖面扰动；积水拉平
  n = normalize(n - dGround*(1.0 - cliffW) - dCliff*cliffW);
  if (G.pud > 0.01) n = normalize(mix(n, upRef - dGround, G.pud));
  // 崖脚遮蔽（阶地：到北面上一级崖脚的水平距离 x、崖高 H）、高档扫描遮蔽
  if (uGroundMode == 1){
    float H = uW*abs(X.y)/max(length(X.xz), 1.0)*max(gCliffH, 0.2), x = max(1.0 - gU, 1e-4)*uW;
    ao *= 1.0 - (1.0 - cos(atan(H, x)))*0.5*sat((dot(n, upG) - 0.8)/0.2);
  }
#if TER_AO_SCAN
  ao = min(ao, mix(1.0, aoScan(dc), sat((dot(n, upG) - 0.5)/0.3)));
#endif
  return litSurfaceS(X, d, t, n, s, dc, ao, sh);
}
