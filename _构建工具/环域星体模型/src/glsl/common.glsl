// ======================= common.glsl =======================
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
#define PI 3.14159265359
#define INF 1e30
// ---- 画质（material.defines 覆盖；默认＝中档） ----
#ifndef Q_NEAR_N
#define Q_NEAR_N 14          // 近段空气样本
#endif
#ifndef Q_FAR_N
#define Q_FAR_N 10           // 远段空气样本
#endif
#ifndef Q_CLOUD_N
#define Q_CLOUD_N 32         // 体积云步数
#endif
#ifndef Q_CLOUD_L
#define Q_CLOUD_L 2          // 体积云朝日短样本（其余由云影图）
#endif
#ifndef Q_CLOUD_KM
#define Q_CLOUD_KM 40.0      // 体积云范围 km
#endif
#ifndef Q_TER_C
#define Q_TER_C 96           // 包络求交步数
#endif
#ifndef Q_TER_F
#define Q_TER_F 24           // 精化步数
#endif
#ifndef Q_TER_KM
#define Q_TER_KM 80.0        // 全细节地形范围
#endif
#ifndef Q_TER_FAR_KM
#define Q_TER_FAR_KM 400.0   // 只含低频层的地形范围
#endif
#ifndef Q_ECL_AIR
#define Q_ECL_AIR 0          // 1：大气样本也乘月掩日（高档）
#endif
#ifndef NEAR_SCALE
#define NEAR_SCALE 0.25      // 近段 pass 相对全分辨率的倍数（高档 0.5）
#endif

// ---- 星体与相机（CM 系，km） ----
uniform float uR, uA, uZtop;                 // 6371；600；大气顶离壁高度
uniform vec3  uCamW;                          // 相机（fround）
uniform float uCamK, uCamZ, uCamRho;          // |C|²−R²；离壁高度；离塔轴
uniform vec3  uCamFwd, uCamRight, uCamUp;
uniform float uTanHalfFov;
uniform vec2  uRes, uJitter;                  // 本 pass 分辨率；子像素抖动（全分辨率像素）
uniform int   uFrame;
uniform float uLamCam;                        // 相机地固经度 φ_C
// ---- 日月 ----
uniform vec3  uSunW;  uniform float uSunRho;  uniform vec3 uSunI;       // uSunI：klux·km²（含日色）
uniform vec3  uMoonW; uniform float uMoonRho; uniform float uMoonAlb;   uniform mat3 uMoonBasis;
uniform float uMoonAir;                       // 1：空气样本计月光（开暗幕或高档）
// ---- 大气 ----
uniform float uAtmoOn;
uniform vec3  uBetaR;                         // 壁面处瑞利散射 (5.802,13.558,33.1)e-3 /km
uniform float uBetaMs, uBetaMa;               // 壁面处米氏散射、吸收 /km
uniform float uHR, uHM, uMieG;                // 40、6、0.76
uniform float uVeilK;                         // 静滞暗幕 /km（离壁 VEIL_ZF·Ztop 以上；0＝纯物理）
uniform float uVeilComp;                      // 昼光补偿（km）：fp.set.dayComp×此地白天日光在夜幕里的平均路程；只补相机附近（veilLocal）
uniform vec3  uRuiDir; uniform float uRuiRad; // 罪域中心方向（CM 单位向量）、半径（km，沿地面）
uniform float uRainBeta;                      // 罪域云底下雨雾消光 /km
uniform vec4  uAcid;                          // 酸霾：x 壁面消光 /km，y 单次反照，z 标高 km，w 开关
uniform vec3  uAcidTint;                      // 酸霾散射色（偏硫黄）
uniform vec4  uYuxi;                          // 余息：x 壁面消光 /km，y 前锋（离塔根地面距离 km），z 标高，w 前锋宽
uniform vec2  uSheath;                        // 塔缘气层：x 塔面处消光 /km（0＝关），y 标高 km
uniform sampler2D uTau; uniform vec2 uTauSize;
uniform sampler2D uMS;  uniform sampler2D uSkyLUT;
uniform sampler2D uSH;                        // 9×3：行 0 相机全天，行 1 大气之外，行 2 从月亮看
// ---- 地面 ----
uniform int   uGroundMode;                    // 0 顺球面斜坡；1 水平阶地＋崖
uniform sampler2D uHeight;                    // R 高度[-1,1]，GB 对 uv 偏导，A 材质噪声
uniform sampler2D uFoot;                      // 1×1 RGBA32F：脚下各层取值（pass 2）
uniform vec2  uOrg[7];                        // 各层图表原点（CPU 取模）
uniform float uRref;                          // 图表东向比例半径
uniform float uHc, uCliffC, uResid;           // 崖高 km、崖带占比、踏面余坡
uniform float uWig, uJit;                     // 蜿蜒、扶壁（以级为单位）
uniform float uTerF0, uRsC, uCamAlt;          // 相机处阶地相位小数；ρ_s(y_C)；相机离地
uniform float uAmpZone, uLip, uClearMax;      // 起伏系数；位移坡度上界；最大起伏 km
uniform float uAbyssDepth, uAbyssHalf, uLimboKm;
uniform float uGEq, uGLight, uGHeavy, uWet;
uniform sampler2D uHorizon; uniform vec4 uHzLvl[3];   // 3 级：xy 级中心相对相机的图表偏移，z 半宽 km，w 有效
uniform sampler2D uCloudSh; uniform vec3 uCsInfo;     // 云影图：xy 中心偏移，z 半宽
uniform sampler2D uWorld;                     // 2048×1024 等面积 (φ,y)：rgb 反照率，a 水面
// ---- 云 ----
uniform float uCloudOn, uCloudBase, uCloudTop, uCloudSigma;
uniform float uRuiOvc, uRuiBase, uRuiTop, uRuiTau;
uniform sampler2D uWeather;                   // 1024×512 等面积 (φ,y)：r 覆盖，g 类型(0 层云…1 积云)，b 厚度系数，a 降水
uniform sampler3D uNoise3, uNoise3D;
uniform vec3  uWind; uniform float uJetPhase;

// ======================= 0. 工具 =======================
float sq(float x){ return x*x; }
float sat(float x){ return clamp(x, 0.0, 1.0); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float sinS(float x){ float x2 = x*x; return abs(x) < 0.02 ? x*(1.0 - x2*(1.0/6.0)*(1.0 - x2*0.05)) : sin(x); }
float sstep(float a, float b, float x){ float u = clamp((x - a)/(b - a), 0.0, 1.0); return u*u*(3.0 - 2.0*u); } // 允许 a>b
float ign(vec2 p, int f){ p += float(f & 63)*5.588238; return fract(52.9829189*fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewRay(vec2 fc, vec2 res, vec2 jitFull, float scale){   // scale＝本 pass 相对全分辨率的倍数
  vec2 ndc = (2.0*(fc + jitFull*scale) - res)/res.y;
  return normalize(uCamFwd + uTanHalfFov*(ndc.x*uCamRight + ndc.y*uCamUp));
}

// ======================= 1. 求交（相机用 K，其余用稳定二次根） =======================
float Kat(float t, float cd){ return uCamK + t*(2.0*cd + t); }
float zOfK(float K){ return -K/(uR + sqrt(max(uR*uR + K, 0.0))); }
float Kof(vec3 X){ return dot(X, X) - uR*uR; }                  // 非相机点：误差约 2 km²，高度误差约 0.2 m
float tWallCam(float cd){ return -cd + sqrt(max(cd*cd - uCamK, 0.0)); }
vec2 tShellCam(float cd, float z){                               // 离壁高度 z 的球壳
  float c = uCamK + z*(2.0*uR - z), D = cd*cd - c;
  if (D < 0.0) return vec2(-1.0);
  float s = sqrt(D); return vec2(-cd - s, -cd + s);
}
vec2 iSphere(vec3 o, vec3 d, float rad){
  float b = dot(o, d), c = dot(o, o) - rad*rad, D = b*b - c;
  if (D < 0.0) return vec2(INF, -INF);
  float s = sqrt(D), q = -b - (b >= 0.0 ? s : -s);
  if (abs(q) < 1e-20) return vec2(0.0);
  float t1 = q, t2 = c/q; return vec2(min(t1, t2), max(t1, t2));
}
float iTower(vec3 o, vec3 d){                                    // 沿 y 的无限长圆柱，返回首个正交点
  vec2 od = o.xz, dd = d.xz; float A = dot(dd, dd);
  if (A < 1e-14) return INF;
  float B = dot(od, dd); if (B >= 0.0) return INF;
  float cr = od.x*dd.y - od.y*dd.x, D = A*uA*uA - cr*cr;         // 无相消的判别式
  if (D < 0.0) return INF;
  float t = (-B - sqrt(D))/A; return t > 0.0 ? t : INF;
}
// 视线分段（第四节第 1 条）：x 近段终点 e，y 远段起点 b0，z t_end，w 1＝有真空段
vec4 segments(float cd, float tEnd){
  if (-cd <= 0.0) return vec4(tEnd, INF, tEnd, 0.0);            // 视线朝地：全部给近段（评审 2·9）
  vec2 core = tShellCam(cd, uZtop);
  float a1 = -cd, b0 = -cd;
  if (core.y > 0.0){ a1 = max(core.x, 0.0); b0 = core.y; }
  return vec4(min(a1, tEnd), b0, tEnd, (core.y > 0.0 && a1 < tEnd) ? 1.0 : 0.0);
}

// ======================= 2. 遮挡 =======================
// 从 X 看半径 rho、中心 S 的发光球露在塔外的面积比例。带边＝过 X 且与塔相切的竖直平面，日面被切出弓形（闭式）
float towerVis(vec3 X, vec3 S, float rho){
  vec2 p = X.xz; float rp2 = dot(p, p), a2 = uA*uA;
  if (rp2 <= a2) return 0.0;
  float rp = sqrt(rp2); vec2 q = S.xz - p; float Lh = length(q);
  if (Lh < 1e-3) return 1.0;
  vec2 c = -p/rp; float cosA = dot(q, c)/Lh;
  if (cosA <= 0.0) return 1.0;
  float sinA = abs(c.x*q.y - c.y*q.x)/Lh, sd = uA/rp, cdd = sqrt(max(1.0 - sd*sd, 0.0));
  float u = Lh*(sinA*cdd - cosA*sd)/rho;                         // 日心到带边平面的有符号距离／半径
  if (u >= 1.0) return 1.0;
  if (sinA < sd){ float tHit = rp*cosA - sqrt(max(a2 - rp2*sinA*sinA, 0.0)); if (Lh < tHit) return 1.0; }
  else if (Lh < rp*cdd) return 1.0;                               // 日在切点之前（塔前）
  if (u <= -1.0) return 0.0;
  return 0.5 + (u*sqrt(1.0 - u*u) + asin(u))/PI;
}
float eclipseVis(vec3 X){                                        // 月掩日：日面露出比例（透镜面积闭式）
  vec3 ds = uSunW - X, dm = uMoonW - X; float Ds = length(ds), Dm = length(dm);
  if (Dm >= Ds || dot(ds, dm) <= 0.0) return 1.0;
  float r1 = uSunRho/Ds, r2 = uMoonRho/Dm, sep = length(cross(ds/Ds, dm/Dm));
  if (sep >= r1 + r2) return 1.0;
  if (sep <= r2 - r1) return 0.0;
  if (sep <= r1 - r2) return 1.0 - sq(r2/r1);
  float x = (sep*sep + r1*r1 - r2*r2)/(2.0*sep);
  float A = r1*r1*acos(clamp(x/r1, -1.0, 1.0)) + r2*r2*acos(clamp((sep - x)/r2, -1.0, 1.0)) - sep*sqrt(max(r1*r1 - x*x, 0.0));
  return 1.0 - A/(PI*r1*r1);
}
// ---- 静滞夜幕（设定，默认关；sky 修订） ----
// 夜幕是灰吸收，充满离壁 Zv＝VEIL_ZF·Ztop 以上的整个空腔（默认 160 km：空气密度已不到壁面的 2%）。
// 原先只在真空核（Ztop 以上）里：从两京朝塔根看过去的掠射弦（最高 300–430 km）整根在大气里，落在极冠背面正处白昼的内壁上，
// 夜幕管不着，开到最强也剩几百勒克斯（crit_sky：圣禁城 k＝1、不补偿仍 643 lux，塔根四周一圈奶白光环）。
// 昼光补偿不再整体放大日光（原先 uSunI×e^{k·白天平均路程}：凡是在夜幕里走得比这短的光，都比不开夜幕还亮，
// 圣禁城子夜 k＝1 时 21.9 klux，是不开的 2.7 倍）。改成：日光到 X 的那一段，夜幕路程先扣掉 uVeilComp·veilLocal(X)
// 再取正——只补相机附近（veilLocal：1000 km 内全补，2500 km 外不补）、补到不开夜幕为止，绝不更亮。
// 所以每条光路的透射都 ≤1、随 k 单调降：夜只会越调越黑；正午此地的日照、天光、云、地面照旧。
#define VEIL_ZF 0.4
#define VEIL_D0 1000.0
#define VEIL_D1 2500.0
float veilRad(){ return uR - VEIL_ZF*uZtop; }
float veilLocal(vec3 X){ return 1.0 - sstep(VEIL_D0, VEIL_D1, length(X - uCamW)); }
float veilLen(vec3 X, vec3 S){                                   // 线段 X→S 在夜幕里的长度
  vec3 dv = S - X; float L = length(dv);
  if (L < 1e-6) return 0.0;
  vec2 c = iSphere(X, dv/L, veilRad());
  if (c.x >= c.y) return 0.0;
  return clamp(min(c.y, L) - max(c.x, 0.0), 0.0, L);
}
// S 是太阳（调用方一律直接传 uSunW，clouds.glsl 也是）时扣掉昼光补偿；其余（月、塔……）照实算
float veilT(vec3 X, vec3 S){
  if (uVeilK <= 0.0) return 1.0;
  float Lv = veilLen(X, S);
  if (S == uSunW) Lv = max(Lv - uVeilComp*veilLocal(X), 0.0);
  return exp(-uVeilK*Lv);
}
// 相机视线在夜幕里的一段 [v0, v1]（没有则 v0＝v1＝0）；对象在 tO 处时只算到 tO
vec2 veilSegCam(float cd){
  vec2 s = tShellCam(cd, VEIL_ZF*uZtop);
  if (s.y <= 0.0) return vec2(0.0);
  return vec2(max(s.x, 0.0), s.y);
}
float veilViewT(float cd, float tO){
  if (uVeilK <= 0.0) return 1.0;
  vec2 v = veilSegCam(cd);
  return exp(-uVeilK*max(min(tO, v.y) - v.x, 0.0));
}
// 任意起点 O 沿 d 走到 tHit 为止，在夜幕里的长度（探针：从相机、从月心看出去）
float veilRayT(vec3 O, vec3 d, float tHit){
  if (uVeilK <= 0.0) return 1.0;
  vec2 c = iSphere(O, d, veilRad());
  if (c.x >= c.y) return 1.0;
  return exp(-uVeilK*max(min(c.y, tHit) - max(c.x, 0.0), 0.0));
}

// ---- 塔缘气层（设定，默认关；02 第七节第 10 条。sky 修订：从 sheath.glsl 并到这里） ----
// 原先只在 airSource 里乘到空气样本的直射上，日面、到眼日照、地面、云、远壁都没乘，开了看不出来（crit_sky s2/18、19）。
// 现在 sunE 一律乘 sunSheathT（日面上取三条弦按露出的部分平均），合成里日面逐像素乘、塔的轮廓加一道前向散射的亮边。
const vec3 SHEATH_C = vec3(0.43, 1.0, 2.44);                     // 按瑞利色散（绿＝1）
float sheathPhi(float x){ return 0.5 + 0.5*tanh(0.7978846*(x + 0.044715*x*x*x)); }   // 标准正态分布函数（近似）
// 从 X 沿单位方向 d 走 Ls 公里（光源或命中点的距离），穿过塔缘气层的绿光光学厚度；blk＝直线在到终点之前先撞进塔（只积到塔面）。
// 抛物近似（Chapman）：τ＝n₀·√(2π·r·H)·e^{−d⊥/H}·[Φ((s₁−s_c)/σ)−Φ(−s_c/σ)]／sin（三维＝二维÷光线与塔轴夹角的正弦），σ＝√(r·H)
float sheathTau(vec3 X, vec3 d, float Ls, out bool blk){
  blk = false;
  float lh = length(d.xz);
  if (uSheath.x <= 0.0 || lh < 1e-4) return 0.0;
  vec2 q = d.xz/lh, p = X.xz;
  float tc = -dot(p, q), rmin = abs(p.x*q.y - p.y*q.x), dp = rmin - uA, H = uSheath.y;
  if (dp > 8.0*H) return 0.0;
  float sh = Ls*lh;
  if (dp < 0.0){                                                  // 直线穿塔：积到塔面为止（正对塔面的视线 f≈0；贴着轮廓的约为一半）
    float tIn = tc - sqrt(max(uA*uA - rmin*rmin, 0.0));
    if (sh > tIn){ blk = true; sh = max(tIn, 0.0); }
    rmin = uA;
  }
  float sg = sqrt(rmin*H);
  float f = sheathPhi((sh - tc)/sg) - sheathPhi(-tc/sg);
  return uSheath.x*sqrt(2.0*PI*rmin*H)*exp(-max(dp, 0.0)/H)*max(f, 0.0)/lh;
}
// 视线上塔缘气层自己的散射光（单次散射、瑞利相函数）。sky 二修：原先只在气柱中点取一次日照、乘 (1−e^{−τ})，
// 朝着日面看时（日光与视线几乎同一根气柱）等于只让光穿了半根柱子，日边一圈亮得发白发蓝，盖住了变红的日面。
// 现在把视线上的气柱按光学厚度四等分，每段取自己的日照（各自穿过的塔缘气层）再乘它到人眼之间剩下的透射。
// 朝着日面时每段的“进来＋出去”加起来就是整根柱子，散射光与日面同样变红；离日面远的方向照旧是一道亮边。
vec3 sunSheathT(vec3 X);
float phaseR(float c);
vec3 sheathGlow(vec3 O, vec3 d, float Ls, float tau){
  float lh = max(length(d.xz), 1e-4); vec2 q = d.xz/lh, p = O.xz;
  float tc = -dot(p, q), rmin = abs(p.x*q.y - p.y*q.x), sh = Ls*lh;
  if (rmin < uA){ float tIn = tc - sqrt(max(uA*uA - rmin*rmin, 0.0)); sh = min(sh, max(tIn, 0.0)); rmin = uA; }
  float sg = sqrt(rmin*uSheath.y), F0 = sheathPhi(-tc/sg), F1 = sheathPhi((sh - tc)/sg);
  vec3 g = vec3(0.0), Tc = vec3(1.0), sT = exp(-0.25*tau*SHEATH_C);
  for (int k = 0; k < 4; k++){
    float F = clamp(mix(F0, F1, (float(k) + 0.5)*0.25), 1e-4, 1.0 - 1e-4);
    vec3 P = O + d*((tc + sg*0.5876*log(F/(1.0 - F)))/lh);        // Φ⁻¹ 取 logistic 近似
    float r = length(P.xz); if (r < uA + 0.5) P.xz *= (uA + 0.5)/max(r, 1e-3);
    vec3 v = uSunW - P; float d2 = dot(v, v);
    vec3 E = uSunI/d2*towerVis(P, uSunW, uSunRho)*veilT(P, uSunW)*sunSheathT(P);
    g += Tc*E*phaseR(dot(d, v*inversesqrt(d2)))*(vec3(1.0) - sT);
    Tc *= sT;
  }
  return g;
}
// 太阳光到 X 的塔缘气层透射（RGB），按日面露出塔外的那部分平均：日面上取横向三条弦（垂直于塔缘），按弦长加权。
// 三条弦取在“露出的那一段”上（sky 二修）：原先固定取 o＝−0.7、0、0.7，日面只露一两成时三条全被塔挡住，透射成了 0——
// 日面明明还露着一线（towerVis＞0），直射、到眼日照却一下子没了（伊美忒黄昏露 3%：Edir 1644 → 0）。
// 现在先求两端弦（o＝±1）离塔轴的有符号距离 b(o)（随 o 近似线性），解出 |b|＝塔半径的那一点 o*，三条弦落在 [o*, 露出的一端] 里。
float sheathImpact(vec3 X, vec3 v){ vec2 q = normalize(v.xz); return X.x*q.y - X.z*q.x; }
vec3 sunSheathT(vec3 X){
  if (uSheath.x <= 0.0) return vec3(1.0);
  vec3 v = uSunW - X; vec2 q = normalize(v.xz); vec3 np = vec3(-q.y, 0.0, q.x);
  float lo = -1.0, hi = 1.0;
  if (dot(-X.xz, q) > 0.0){                                       // 塔在 X 朝日的前方，才可能挡
    float bm = sheathImpact(X, v - np*uSunRho), bp = sheathImpact(X, v + np*uSunRho);
    bool cm = abs(bm) < uA, cp = abs(bp) < uA;
    if (cm && cp) return vec3(0.0);                               // 整个日面都在塔后
    if (cm != cp){
      float bt = cm ? sign(bp)*uA : sign(bm)*uA;                  // 露出的那一端所在一侧的塔缘
      float os = clamp(-1.0 + 2.0*(bt - bm)/(bp - bm), -1.0, 1.0);
      if (cm) lo = os; else hi = os;
    }
  }
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 3; i++){
    float o = mix(lo, hi, (float(i) + 0.5)/3.0), w = sqrt(max(1.0 - o*o, 0.02));
    vec3 vi = v + np*(o*uSunRho); float Li = length(vi);
    bool blk; float tau = sheathTau(X, vi/Li, Li, blk);
    if (blk) continue;
    acc += w*exp(-tau*SHEATH_C); ws += w;
  }
  return ws > 0.0 ? acc/ws : vec3(0.0);
}

// ======================= 3. 弦表（凹面透射） =======================
// W(α_w, z)：弦上离壁高度 z 处沿弦“向外”到内壁的光学厚度（RGB）；弦由它在内壁处与切面的夹角 α_w 决定
vec3 chordW(float al, float z){
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  vec2 uv = vec2(sqrt(clamp(al/(0.5*PI), 0.0, 1.0)), sqrt(clamp(z/max(zmax, 1e-6), 0.0, 1.0)));
  return textureLod(uTau, uv*(1.0 - 1.0/uTauSize) + 0.5/uTauSize, 0.0).rgb;
}
float alphaOf(float K, float pd){ return asin(clamp(sqrt(max(pd*pd - K, 0.0))/uR, 0.0, 1.0)); }  // pd＝X·d
vec3 cumTau(float al, float z, float pd){ vec3 w = chordW(al, z); return pd < 0.0 ? w : 2.0*chordW(al, 1e9) - w; }
vec3 sunTrans(vec3 X, float K, vec3 l){                          // 太阳在真空里：沿 l 必定穿出大气顶
  float al = alphaOf(K, dot(X, l));
  return exp(-max(chordW(al, 1e9) - chordW(al, zOfK(K)), vec3(0.0)));
}
vec3 transCam(float al, float cd, float t){                      // 相机到视线 t 处
  float K = Kat(t, cd);
  return exp(-max(cumTau(al, zOfK(K), cd + t) - cumTau(al, uCamZ, cd), vec3(0.0)));
}

// ======================= 4. 介质与相函数 =======================
struct Med { vec3 sR; vec3 sM; float sY; vec3 ext; float extX; };   // extX＝弦表之外的灰消光
float ruiW(vec3 X){ float c = dot(normalize(X), uRuiDir); return sstep(cos(uRuiRad/uR), cos(0.75*uRuiRad/uR), c); }
float sGround(vec3 X){ return uR*atan(length(X.xz), -X.y); }       // 离塔根的地面距离 km
// ---- clouds 路（2026-10-14）：阶地模式下近处云层按重力找平；云影图（含雨量）的取样；余息风痕 ----
uniform mat3 uCM2W;                                              // CM → 地固（云、余息风痕的噪声随地面固定；原在 clouds.glsl，挪到这里给 medium 用）
// 阶地模式：踏面按重力找平，球面相对重力倾斜（倾角＝纬度）。云高原先一律按“离球面高度”：罪域云底离人 0.2 km、朝南几百米就扎进地面，
// 伊美忒南面一堵白墙、朝北看不见云底。现在离相机 CLV_R0 km 以内，云底、云顶是离相机脚下重力高 zNom 的水平面（与塔同轴的圆柱面），
// CLV_R0–CLV_R1 之间渐变回贴球面（远处与天气图、对面世界的云衔接）。返回把名义高度 zNom 抬高多少（离壁高度口径）：
//   z(X) − (zNom＋lift)＝(gX − zNom＋眼高)/cosψ_C，gX＝X 离相机的重力高（朝塔轴为上）。斜坡模式为 0。
#define CLV_R0 25.0
#define CLV_R1 80.0
float cloudLift(vec3 X, float zNom){
  if (uGroundMode != 1) return 0.0;
  vec3 v = X - uCamW;
  float w = 1.0 - sstep(CLV_R0, CLV_R1, length(v));
  if (w <= 0.0) return 0.0;
  vec2 p = uCamW.xz, q = v.xz; float num = 2.0*dot(p, q) + dot(q, q);
  float gX = -num/(uCamRho + sqrt(max(uCamRho*uCamRho + num, 0.0)));   // −Δρ（与第 7 节 dRxz 同式）
  float cp = max(uRsC/uR, 0.2);                                   // 相机处纬度的余弦
  return w*(zOfK(Kof(X)) + (zNom - uCamAlt - gX)/cp - zNom);
}
float cloudBaseAt(vec3 X){ float zb = mix(uCloudBase, uRuiBase, ruiW(X)); return zb + cloudLift(X, zb); }
// 云影图（cloud_shadow.frag 写，clouds 路）：逐轴 q→q(1＋k)/(1＋k|q|)，中心一格约 0.2 km、边上约 7 km（脚边的云影边看得出在动）。
// r＝沿日光的整柱 τ；g、b＝从地面到云层相对高度 CS_H1、CS_H2 处的累计 τ（云里一点上方还剩多少）；a＝落到地面的雨量（1≈中雨）
#define CS_WARP 5.0
#define CS_H1 0.15
#define CS_H2 0.4
vec2 csWarp(vec2 q){ return q*(1.0 + CS_WARP)/(1.0 + CS_WARP*abs(q)); }
vec2 csUnwarp(vec2 u){ return u/(1.0 + CS_WARP - CS_WARP*abs(u)); }
vec4 csFetch(vec2 dc){                                            // 图外返回 r＜0
  vec2 q = (dc - uCsInfo.xy)/uCsInfo.z;
  if (max(abs(q.x), abs(q.y)) > 1.0) return vec4(-1.0);
  return textureLod(uCloudSh, csWarp(q)*0.5 + 0.5, 0.0);
}
vec2 chartD(vec3 v);                                              // 定义在第 7 节
// 雨量：云影图以内按图（哪里有降水的云，哪里下；阵雨、雨带、雨幕）；图外只认罪域阴云
float rainAt(vec3 X){
  vec3 v = X - uCamW;
  if (dot(v, v) < sq(1.42*uCsInfo.z)){ vec4 c = csFetch(chartD(v)); if (c.r >= 0.0) return max(c.a, 0.0); }
  return uCloudOn > 0.5 ? 0.8*ruiW(X)*uRuiOvc : 0.0;
}
// 余息贴地一层（标高 0.5 km）的风痕：沿塔轴方向（地面上大致南北）拉长 3 倍，随时间向南（离塔根）刮；0.15–1.85
#define YUXI_GND 55.0
float yuxiStreak(vec3 X){
  vec3 P = uCM2W*X;
  vec4 n = textureLod(uNoise3, vec3(P.x, P.y/3.0, P.z)/12.0 - vec3(0.0, uWind.x*0.012, 0.0), 0.0);
  return 0.15 + 1.7*sat((0.6*n.r + 0.4*n.g - 0.42)/0.36);
}
Med medium(vec3 X, float z){
  Med m; float zz = max(z, -3.0*uHM), zp = max(z, 0.0);
  float dR = exp(-zz/uHR), dM = exp(-zz/uHM);
  m.sR = uBetaR*dR; m.sM = vec3(uBetaMs*dM); m.sY = 0.0;
  float extM = (uBetaMs + uBetaMa)*dM;
  m.extX = 0.0;
  if (z < 0.0) m.extX += lum(uBetaR)*(dR - 1.0) + (uBetaMs + uBetaMa)*(dM - 1.0);  // 深渊里比弦表（z≥0 截断）多出的部分
  // 雨雾（clouds 路）：uRainBeta＝中雨（雨量 1）时云底下的消光；雨量取云影图，哪里下雨哪里有雨幕。酸霾只在罪域
  // 雨的量级（clouds 路 2026-10-14，问题单第 17 条）：滑杆的数（0.03 /km）原样当消光，雨雾能见度 130 km。这里乘 RAIN_K：
  // 中雨（雨量 1）0.03×20＝0.6 /km，能见度六七公里，大雨、雨带里两三公里。（酸霾的量级由 sky 路改 fp.set.acidExt 的默认值，这里不另乘）
  #define RAIN_K 20.0
  float rw = uAcid.w > 0.0 ? ruiW(X) : 0.0;
  float below = uRainBeta > 0.0 ? sat((cloudBaseAt(X) + 0.3 - z)/0.6) : 0.0;
  float rain = below > 0.0 ? RAIN_K*uRainBeta*rainAt(X)*below : 0.0;
  if (rw > 0.0 || rain > 0.0){
    // 酸霾按“离脚下地面多高”（sky 二修，同余息贴地层）：阶地模式下罪域相机所在踏面离球面约 1 km，按离球面高度算，人身边的霾只剩一半
    float za = max(zp - max(uCamZ - uCamAlt, 0.0)*(1.0 - sstep(30.0, 90.0, length(X - uCamW))), 0.0);
    float acid = uAcid.w*uAcid.x*rw*exp(-za/uAcid.z);
    m.sM += vec3(0.95*rain) + uAcidTint*acid*uAcid.y;
    m.extX += rain + acid;
  }
  if (uYuxi.x > 0.0){
    float fr = 1.0 - sstep(uYuxi.y - uYuxi.w, uYuxi.y, sGround(X));
    if (fr > 0.0){                                                // 高空一层（标高 uYuxi.z）＋贴地的风痕层（YUXI_GND 倍、标高 0.6 km）
      // 贴地层按“离脚下地面多高”：阶地模式下相机所在踏面离球面可有一公里多（圣禁城 1.1 km），按离球面高度算，
      // 人身边的风痕层只剩一成（问题单第 15 条：余息开关前后只差几个灰阶）。相机 30 km 内以踏面为底，往外渐回球面
      float zg = zp - max(uCamZ - uCamAlt, 0.0)*(1.0 - sstep(30.0, 90.0, length(X - uCamW)));
      zg = max(zg, 0.0);
      float gnd = zg < 3.5 ? YUXI_GND*exp(-zg/0.6)*yuxiStreak(X) : 0.0;
      m.sY = uYuxi.x*(exp(-zp/uYuxi.z) + gnd)*fr;
      m.extX += m.sY/0.98;
    }
  }
  m.ext = m.sR + vec3(extM + m.extX);
  return m;
}
float phaseR(float c){ return 0.0596831*(1.0 + c*c); }
float phaseCS(float c, float g){ float g2 = g*g; return 0.1193662*(1.0 - g2)*(1.0 + c*c)/((2.0 + g2)*pow(max(1.0 + g2 - 2.0*g*c, 1e-4), 1.5)); }
float phaseHG(float c, float g){ float g2 = g*g; return 0.0795775*(1.0 - g2)/pow(max(1.0 + g2 - 2.0*g*c, 1e-4), 1.5); }
vec3 msLUT(float z, float mus){ vec2 uv = vec2(sat(mus*0.5 + 0.5), sqrt(sat(z/uZtop))); return textureLod(uMS, (uv*31.0 + 0.5)/32.0, 0.0).rgb; }
vec3 skyLUT(float mus){ return textureLod(uSkyLUT, vec2((sat(mus*0.5 + 0.5)*63.0 + 0.5)/64.0, 0.5), 0.0).rgb; }

// ======================= 5. 日照 =======================
// X 处垂直于日光的照度（klux）：距离平方、塔影、暗幕、弦表透射；ecl＝真时乘月掩日
vec3 sunE(vec3 X, float K, out vec3 l, out float vis, bool ecl){
  vec3 v = uSunW - X; float d2 = dot(v, v); l = v*inversesqrt(d2);
  vis = towerVis(X, uSunW, uSunRho);
  if (ecl && vis > 0.0) vis *= eclipseVis(X);
  if (vis <= 0.0) return vec3(0.0);
  return uSunI/d2*vis*sunTrans(X, K, l)*veilT(X, uSunW)*sunSheathT(X);
}
float msVis(vec3 X){ return towerVis(X, uSunW, uSunRho + 4.0*uHR); }   // 多次散射用加宽半影（评审 2·4）

// ======================= 6. 球谐与空腔 =======================
vec3 shC(int i, int row){ return texelFetch(uSH, ivec2(i, row), 0).rgb; }
vec3 shIrr(vec3 n, int row){
  const float c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  float x = n.x, y = n.y, z = n.z;
  vec3 e = c1*shC(8,row)*(x*x - y*y) + c3*shC(6,row)*z*z + c4*shC(0,row) - c5*shC(6,row)
         + 2.0*c1*(shC(4,row)*x*y + shC(7,row)*x*z + shC(5,row)*y*z) + 2.0*c2*(shC(3,row)*x + shC(1,row)*y + shC(2,row)*z);
  return max(e, vec3(0.0));
}
vec3 shAvg(int row){ return max(shC(0, row)*0.2820948, vec3(0.0)); }
// 积分球：凹球腔里任一点受到的壁间照度与位置无关；只按塔遮住的半球份额修正（评审 2·嫁接 4）
float towerOcc(float rho){ return 1.0 - 0.6366*asin(min(uA/max(rho, uA), 1.0)); }
vec3 cavityE(vec3 X){ return 2.0*PI*shAvg(1)*towerOcc(length(X.xz))/towerOcc(uCamRho); }
vec3 cavityL(){ return shAvg(1); }                               // 空气样本的各向同性空腔入射
// 同上，但在罪域厚云盖之下的空气只拿到透过云的漫射（双流 Td＝2/(2＋ξτ)，ξ＝0.15）。
// 探针行 1 不再乘本地云的透射（否则云顶、远壁的 cavityE 在厚云下归零，夜里云底一片死黑；E 路对 02 第十三节的改正）
float ruiUnder(vec3 X, float z){                                 // 在罪域厚云盖之下的程度 0–1
  if (uCloudOn < 0.5 || uRuiOvc <= 0.0) return 0.0;
  return ruiW(X)*uRuiOvc*sat((cloudBaseAt(X) + 0.3 - z)/0.6);
}
float ruiTd(){ return 2.0/(2.0 + 0.15*uRuiTau); }                 // 厚云盖的漫射透射（双流）
float cavityDim(vec3 X, float z){ return mix(1.0, ruiTd(), ruiUnder(X, z)); }

// ======================= 7. 地面图表（第三节第 4 条） =======================
const float TILE = 32.0;                                          // 每张平铺 32 个特征
const float LAY_L[7] = float[7](60.0, 6.0, 1.1, 0.2, 0.035, 0.006, 15.0);       // 特征尺度 km
const float LAY_A[7] = float[7](1.2, 0.32, 0.085, 0.018, 0.0032, 0.0007, 0.0);  // 幅度 km（乘域系数）
float dRxz(vec3 v){ vec2 p = uCamW.xz, w = v.xz; float num = 2.0*dot(p, w) + dot(w, w); return num/(uCamRho + sqrt(max(uCamRho*uCamRho + num, 0.0))); }
float dRho(vec3 v){ float rc = sqrt(uR*uR + uCamK), num = 2.0*dot(uCamW, v) + dot(v, v); return num/(rc + sqrt(max(rc*rc + num, 0.0))); }
vec2 chartD(vec3 v){                                              // 相对相机的图表坐标差（东, 北）km
  float dLam = atan(v.z, uCamRho + v.x);
  float dn;
  if (uGroundMode == 1) dn = -v.y;
  else { float dr = dRxz(v), yC = uCamW.y;
    dn = -uR*atan(uCamRho*v.y - yC*dr, uCamRho*(uCamRho + dr) + yC*(yC + v.y)); }
  return vec2(-uRref*dLam, dn);
}
void chartGrad(vec3 X, out vec3 gE, out vec3 gN){                // 图表坐标对世界坐标的梯度
  float r2 = dot(X.xz, X.xz);
  gE = -uRref*vec3(-X.z, 0.0, X.x)/r2;
  if (uGroundMode == 1) gN = vec3(0.0, -1.0, 0.0);
  else { float rr = sqrt(r2); gN = -uR*(-X.y*vec3(X.x, 0.0, X.z)/rr + rr*vec3(0.0, 1.0, 0.0))/dot(X, X); }
}
mat2 rotK(int k){ float an = 1.31*float(k); return mat2(cos(an), sin(an), -sin(an), cos(an)); }
vec4 layerTex(int k, vec2 dc){                                     // r 值；gb 对 dc 的梯度（已换算）；a 材质噪声
  mat2 Rk = rotK(k); float s = 1.0/(LAY_L[k]*TILE);
  vec4 t = textureLod(uHeight, (Rk*dc)*s + uOrg[k], 0.0);          // 显式 0 级：循环里调用（探针等）不要隐式导数（HLSL X3595）
  return vec4(t.r, s*(transpose(Rk)*t.gb), t.a);
}
vec2 eqArea(vec3 X){ return vec2(fract((atan(X.z, X.x) + uLamCam)/(2.0*PI)), X.y/(2.0*uR) + 0.5); }  // 地固 (φ,y)
// 深渊沟（F 路 2026-10 改：沟沿以内 w＝min(10, 0.4h) km 的陡壁，沟沿处坡 2D/w≈80°、往下渐缓到沟底；原式把落差摊在 0.45h≈99 km 上，是一道宽谷）。JS 镜像 fp/ground.js 的 trench
float trench(float y){ float w = min(10.0, 0.4*uAbyssHalf), x = sat((uAbyssHalf - abs(y))/w); return uAbyssDepth*x*(2.0 - x); }
float trenchD(float y){ float w = min(10.0, 0.4*uAbyssHalf), x = sat((uAbyssHalf - abs(y))/w); return x > 0.0 && x < 1.0 ? -uAbyssDepth*2.0*(1.0 - x)/w*sign(y) : 0.0; }
vec4 zoneW(vec3 X){                                               // x 轻域 y 平域 z 重域 w 罪域
  float g = uGEq*length(X.xz)/uR;
  float wl = 1.0 - sstep(uGLight - 0.04, uGLight + 0.04, g), wh = sstep(uGHeavy - 0.04, uGHeavy + 0.04, g);
  return vec4(wl, max(1.0 - wl - wh, 0.0), wh, ruiW(X));
}
float limboW(vec3 X){ return 1.0 - sstep(uLimboKm*0.8, uLimboKm, abs(X.y)); }
