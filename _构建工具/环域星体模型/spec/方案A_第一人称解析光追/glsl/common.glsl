// =====================================================================================
//  环域星体 · 第一人称写实渲染（方案 A：单个全屏片元着色器解析光追）—— 公共库  GLSL ES 3.00
//  单位：长度 km，角度 rad；辐亮度 cd/m²，照度 lux（太阳强度 uSunI = 照度×km²，按 1/d² 衰减）。
//  世界坐标（与天体模块一致）：原点＝星体球心；+y＝塔轴指向塔顶，塔根极在 (0,-R,0)；xz＝塔腰平面；
//  经度自 +x 量向 +z，增大方向＝自转方向＝本地“西”。观察点本地：上 U＝垂直指向塔轴，北 N＝(0,-1,0)，东 E＝N×U。
//  精度约定：float32 在 6371 km 处只有 ~0.4 m 分辨率，所以凡是“离地多高”的量（地形、眼高）都用
//  相机相对的稳定差分（dRxz / dRho），绝对量由 CPU 用双精度算好、以 uniform 传入。
// =====================================================================================
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

#define PI  3.14159265359
#define INF 1e30

// ---------------- 质量档（JS 以 #define 注入；不同档编译不同程序） ----------------
#ifndef Q_ATM_NEAR
#define Q_ATM_NEAR 14        // 视线上升段（相机→真空核）样本
#endif
#ifndef Q_ATM_FAR
#define Q_ATM_FAR 10         // 视线下降段（真空核→对面内壁）样本
#endif
#ifndef Q_TER_STEPS
#define Q_TER_STEPS 96       // 近处高度场步进上限
#endif
#ifndef Q_NEAR_KM
#define Q_NEAR_KM 80.0       // 近场高度场的最远距离
#endif
#ifndef Q_SHADOW_STEPS
#define Q_SHADOW_STEPS 20
#endif
#ifndef Q_CLOUD_STEPS
#define Q_CLOUD_STEPS 32
#endif
#ifndef Q_CLOUD_LIGHT
#define Q_CLOUD_LIGHT 4
#endif

// ---------------- uniform ----------------
uniform vec2  uRes;            // 本 pass 渲染分辨率
uniform vec2  uJitter;         // TAA 子像素抖动（像素）
uniform int   uFrame;
uniform float uClock;          // 秒（云流动）
// 相机
uniform vec3  uCamPos;         // 相机世界坐标（已 fround；下面各量由 CPU 用这个舍入值、双精度算出）
uniform vec3  uCamRight, uCamUp, uCamFwd;
uniform float uTanHalfFov;
uniform float uCamC0;          // |P|² − R²
uniform float uCamRho;         // |P|
uniform float uCamR0;          // |P.xz|（离塔轴）
uniform float uCamAltS;        // R + trench(yP) − |P|           球面模式：相机离基准面
uniform float uCamAltT;        // rb(yP) − r0                     阶地模式：相机离阶地基准面
uniform float uRsphP;          // sqrt(R² − yP²)
uniform float uCamFy;          // fract(yP / W)
uniform float uTrenchP;        // trench(yP)
uniform vec3  uFrameE, uFrameN, uFrameU;
uniform vec2  uLayerOrg[5];    // 各层地形噪声在相机处的纹理坐标（CPU 取模，避免大数）
uniform float uZoneAmp;        // 相机所在域的地形起伏系数
uniform vec4  uZoneW;          // 相机所在域权重：x 轻域 y 平域 z 重域 w 罪域
uniform float uLimboW;         // 相机处灵薄带权重
uniform float uClearMax;       // 近场地形相对宏观球面的最大可能高出（km）
uniform float uLip;            // 位移场的坡度上界（CPU 由各层幅度/尺度估算）
// 星体
uniform float uR, uA, uGEq, uGLight, uGHeavy, uLimboKm;
// 日月
uniform vec3  uSunPos;   uniform float uSunRad;  uniform vec3 uSunI;
uniform vec3  uMoonPos;  uniform float uMoonRad; uniform float uMoonAlb;
uniform mat3  uMoonBasis;                       // 月面本体系（列：朝塔轴、朝塔顶、切向）
uniform vec3  uMoonW0;   uniform mat3 uMoonW1;  // 壁照：E(n) = W0 + W1·n （lux）
uniform vec3  uMoonE;                           // 月光在观察点的照度（大气外；CPU 解析）
uniform float uMoonD2;                          // 观察点到月心距离²
// 大气
uniform float uAtmoOn;
uniform vec3  uBetaR;          // 瑞利散射 @壁面（1/km）
uniform float uBetaM, uBetaMA; // 米氏散射 / 吸收 @壁面
uniform float uHR, uHM, uMieG, uHcut;
uniform float uRainBeta;       // 罪域云底以下的雨雾附加消光
uniform vec3  uAmbK;           // 远壁天光 / 直射（CPU 由光学厚度估算）
uniform float uVeilK;          // 可选“静滞暗幕”：真空核内的灰吸收（1/km），0＝纯物理
uniform sampler2D uMSLut;      // 32×32 多重散射
uniform sampler2D uSkySH;      // 9×1：观察点天空辐亮度的 SH9（上一帧）
// 地形
uniform int   uGroundMode;     // 0 顺球面斜坡；1 水平阶地 + 朝南（背塔根）一侧落差的崖
uniform float uTerW, uHcS, uCliffFrac;
uniform float uTerWig, uWigS, uW0;   // 崖线蜿蜒：幅度（踏面宽为单位）、噪声尺度（1/km）、相机处噪声值
uniform vec2  uWigOrg;
uniform float uCliffJit, uB0;  // 崖线细碎进退（踏面宽为单位）与相机处的该层噪声值
uniform float uDispScale;
uniform sampler2D uHeightTex;  // RGBA16F：R 高度[-1,1]，G/B 对 uv 的偏导，A 材质噪声
uniform float uAbyssDepth, uAbyssHalf;
uniform vec3  uRuiDir;  uniform float uRuiRad;
uniform float uWet;
// 云
uniform float uCloudOn, uCloudBase, uCloudTop, uCloudCover, uCloudSigma, uRuiOvercast;
uniform sampler3D uNoise3D;    // 64³ RGBA8：R Perlin-Worley，G/B/A Worley×3 频
uniform vec3  uWind;
// 塔与曝光
uniform float uTowerAlb;
uniform sampler2D uExpTex;     // 1×1：x 曝光（上一帧），y 适应亮度

// =====================================================================================
//  0. 小工具
// =====================================================================================
float sat(float x) { return clamp(x, 0.0, 1.0); }
float ign(vec2 p, int f) {     // 交错梯度噪声，逐帧平移（配合 TAA 变成蓝噪声般的收敛）
  p += float(f & 63) * 5.588238;
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// =====================================================================================
//  1. 解析求交
// =====================================================================================
// t² + 2bt + c = 0 的两根（数值稳定写法），无实根返回 (INF,-INF)
vec2 iSphereBC(float b, float c) {
  float D = b * b - c;
  if (D < 0.0) return vec2(INF, -INF);
  float s = sqrt(D);
  float q = -b - (b >= 0.0 ? s : -s);
  if (abs(q) < 1e-20) return vec2(0.0);
  float t1 = q, t2 = c / q;
  return vec2(min(t1, t2), max(t1, t2));
}
vec2 iSphere(vec3 o, vec3 d, float rad) { return iSphereBC(dot(o, d), dot(o, o) - rad * rad); }

// 巨塔：沿 y 的无限长圆柱（球内部分就是 |y|<sqrt(R²−a²)，更远处必先撞内壁，故不必截断）
float iTower(vec3 o, vec3 d) {
  vec2 od = o.xz, dd = d.xz;
  float A = dot(dd, dd);
  if (A < 1e-14) return INF;
  float B = dot(od, dd);
  if (B >= 0.0) return INF;                       // 水平上背离塔轴
  float cr = od.x * dd.y - od.y * dd.x;           // |od×dd|：无相消的垂距
  float D = A * uA * uA - cr * cr;                // = A(a² − p⊥²)
  if (D < 0.0) return INF;
  float t = (-B - sqrt(D)) / A;
  return t > 0.0 ? t : INF;
}

// =====================================================================================
//  2. 遮挡：塔挡日（半影解析）、月掩日
// =====================================================================================
// 从 X 看半径 rho、中心 S 的发光球，露在塔外的面积比例。塔是竖直无限圆柱 → 在 X 处的剪影是
// 方位角上的一条带 [−δ, δ]，带边是过 X 的竖直平面；日面被平面切掉的弓形面积有闭式解。
float bodyVisTower(vec3 X, vec3 S, float rho) {
  vec2 p = X.xz;
  float rp2 = dot(p, p), a2 = uA * uA;
  if (rp2 <= a2) return 0.0;
  float rp = sqrt(rp2);
  vec2 q = S.xz - p;
  float Lh = length(q);
  if (Lh < 1e-3) return 1.0;
  vec2 c = -p / rp;                               // 水平上指向塔轴
  float cosA = dot(q, c) / Lh;
  if (cosA <= 0.0) return 1.0;                    // 日在背离塔的一侧
  float sinA = abs(c.x * q.y - c.y * q.x) / Lh;
  float sd = uA / rp, cd = sqrt(max(1.0 - sd * sd, 0.0));
  float u = Lh * (sinA * cd - cosA * sd) / rho;   // 日心到“塔缘平面”的有符号距离 / 日半径
  if (u >= 1.0) return 1.0;
  if (sinA < sd) {                                // 日心视线穿塔：日在塔前就全亮
    float tHit = rp * cosA - sqrt(max(a2 - rp2 * sinA * sinA, 0.0));
    if (Lh < tHit) return 1.0;
  } else if (Lh < rp * cd) return 1.0;            // 日在切点之前（塔前的边上）
  if (u <= -1.0) return 0.0;
  return 0.5 + (u * sqrt(1.0 - u * u) + asin(u)) / PI;
}
// 月掩日：两圆面重叠（角半径小，用叉积求夹角保精度）
float occultVis(vec3 X, vec3 S, float rs, vec3 M, float rm) {
  vec3 ds = S - X, dm = M - X;
  float Ds = length(ds), Dm = length(dm);
  if (Dm >= Ds) return 1.0;
  float r1 = rs / Ds, r2 = rm / Dm;
  float sep = length(cross(ds / Ds, dm / Dm));
  if (dot(ds, dm) < 0.0 || sep >= r1 + r2) return 1.0;
  if (sep <= r2 - r1) return 0.0;
  if (sep <= r1 - r2) return 1.0 - (r2 * r2) / (r1 * r1);
  float x = (sep * sep + r1 * r1 - r2 * r2) / (2.0 * sep);
  float A = r1 * r1 * acos(clamp(x / r1, -1.0, 1.0)) + r2 * r2 * acos(clamp((sep - x) / r2, -1.0, 1.0))
          - sep * sqrt(max(r1 * r1 - x * x, 0.0));
  return 1.0 - A / (PI * r1 * r1);
}

// =====================================================================================
//  3. 大气（瑞利 + 米氏 + 罪域雨雾；密度随“离壁高度”h＝R−|X| 指数变稀）
// =====================================================================================
float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
float phaseCS(float c, float g) {
  float g2 = g * g;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
float phaseHG(float c, float g) {
  float g2 = g * g;
  return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
float ruiMask(vec3 X) {
  float cd = dot(X / length(X), uRuiDir);
  return smoothstep(cos(uRuiRad), cos(uRuiRad * 0.75), cd);
}
vec3 densities(vec3 X, float h) {
  float hh = max(h, -3.0 * uHM);                  // 深渊底部更稠
  vec3 r = vec3(exp(-hh / uHR), exp(-hh / uHM), 0.0);
  if (uRainBeta > 0.0 && h < uCloudBase + 0.5) r.z = ruiMask(X) * sat((uCloudBase + 0.5 - h) / 1.0);
  return r;
}
// 到日/月的透射率：日月都在“真空核”里且恒在 μ≥0.7 的方向（日离球心 ≤3250 km），平行平面近似误差 <1%
vec3 transToward(float h, float mu) {
  mu = max(mu, 0.05);
  float hh = max(h, 0.0);
  float oR = uHR * exp(-hh / uHR), oM = uHM * exp(-hh / uHM);
  return exp(-(uBetaR * oR + (uBetaM + uBetaMA) * oM) / mu);
}
// 静滞暗幕：从 X 到核内天体 S 的连线在核里走过的长度 → 灰透射率
float veilT(vec3 X, vec3 S) {
  if (uVeilK <= 0.0) return 1.0;
  vec3 dv = S - X; float L = length(dv);
  vec2 c = iSphere(X, dv / L, uR - uHcut);
  if (c.x >= c.y) return 1.0;
  float inCore = clamp(min(c.y, L) - max(c.x, 0.0), 0.0, L);
  return exp(-uVeilK * inCore);
}
vec3 msLookup(float h, float mu) {
  vec2 uv = vec2(sqrt(sat(h / uHcut)), sat(mu));
  return texture(uMSLut, (uv * 31.0 + 0.5) / 32.0).rgb;
}
// 天空 SH9（世界系方向）
vec3 shC(int i) { return texelFetch(uSkySH, ivec2(i, 0), 0).rgb; }
vec3 skyIrradiance(vec3 n) {
  const float c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  float x = n.x, y = n.y, z = n.z;
  vec3 e = c1 * shC(8) * (x * x - y * y) + c3 * shC(6) * z * z + c4 * shC(0) - c5 * shC(6)
         + 2.0 * c1 * (shC(4) * x * y + shC(7) * x * z + shC(5) * y * z)
         + 2.0 * c2 * (shC(3) * x + shC(1) * y + shC(2) * z);
  return max(e, vec3(0.0));
}
vec3 skyMeanRadiance() { return max(shC(0) * 0.2820948, vec3(0.0)); }

// 视线积分的“快照”：云的合成需要知道 [0, tc] 段的结果
float gSnapT = INF;
vec3  gSnapL = vec3(0.0), gSnapT3 = vec3(1.0);
bool  gSnapped = false;

float warpU(float u, float k, float ek) { return k < 1e-3 ? u : -log(1.0 - u * ek) / k; }

// 一段 [ta,tb] 的积分。toEnd=false：样本向 ta 端加密；true：向 tb 端加密。k＝两端密度相差的 e 倍数。
void atmoMarch(vec3 o, vec3 d, float ta, float tb, float k, bool toEnd, int n, float jit,
               vec3 skyMean, inout vec3 Lin, inout vec3 Tr) {
  float len = tb - ta;
  if (len <= 1e-6 || n <= 0) return;
  k = clamp(k, 0.0, 30.0);
  float ek = 1.0 - exp(-k);
  float fn = float(n);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float u0 = float(i) / fn, u1 = float(i + 1) / fn, um = (float(i) + jit) / fn;
    float t0, t1, tm;
    if (!toEnd) { t0 = ta + len * warpU(u0, k, ek); t1 = ta + len * warpU(u1, k, ek); tm = ta + len * warpU(um, k, ek); }
    else { t0 = tb - len * warpU(1.0 - u0, k, ek); t1 = tb - len * warpU(1.0 - u1, k, ek); tm = tb - len * warpU(1.0 - um, k, ek); }
    float dt = t1 - t0;
    if (!gSnapped && t0 >= gSnapT) { gSnapL = Lin; gSnapT3 = Tr; gSnapped = true; }
    vec3 X = o + d * tm;
    float r = length(X), h = uR - r;
    vec3 up = -X / r;
    vec3 rho = densities(X, h);
    vec3 sR = uBetaR * rho.x;
    float sM = uBetaM * rho.y + 0.95 * uRainBeta * rho.z;
    vec3 sE = sR + vec3((uBetaM + uBetaMA) * rho.y + uRainBeta * rho.z);
    vec3 S = vec3(0.0);
    // —— 太阳：单次散射（塔影＝体积阴影，逐样本解析）＋多次散射 LUT ——
    vec3 Ls = uSunPos - X;
    float ds2 = dot(Ls, Ls);
    vec3 l = Ls * inversesqrt(ds2);
    float vis = bodyVisTower(X, uSunPos, uSunRad);
    if (vis > 0.0) {
      float mu = dot(l, up), c = dot(d, l);
      vec3 E = uSunI / ds2 * vis * veilT(X, uSunPos);
      S += E * (transToward(h, mu) * (sR * phaseR(c) + sM * phaseCS(c, uMieG)) + (sR + sM) * msLookup(h, mu));
    }
    // —— 月光 ——
    if (uMoonE.g > 1e-7) {
      vec3 Lm = uMoonPos - X;
      float dm2 = dot(Lm, Lm);
      vec3 lm = Lm * inversesqrt(dm2);
      float vm = bodyVisTower(X, uMoonPos, uMoonRad);
      float cm = dot(d, lm);
      S += uMoonE * (uMoonD2 / dm2) * vm * veilT(X, uMoonPos) * transToward(h, dot(lm, up)) * (sR * phaseR(cm) + sM * phaseCS(cm, uMieG));
    }
    // —— 塔影里的空气被“天光”（夜里主要是对面世界的白昼辉光）照亮：二次散射的廉价近似 ——
    S += (sR + sM) * skyMean * (1.0 - vis);
    vec3 Tst = exp(-sE * dt);
    Lin += Tr * (S - S * Tst) / max(sE, vec3(1e-9));
    Tr *= Tst;
  }
}

// 整条视线 [0, tEnd]：在“最高点”切成上升段与下降段，并跳过中间近乎真空的核；
// 每段再按霾层（5·HM）与空气层分开加密 —— 即“两端加密”的非均匀采样。
void integrateAtmo(vec3 o, vec3 d, float tEnd, float jit, vec3 skyMean, int nNear, int nFar,
                   out vec3 Lin, out vec3 Tr) {
  Lin = vec3(0.0); Tr = vec3(1.0);
  gSnapped = false;
  if (uAtmoOn < 0.5 || tEnd <= 0.0) { gSnapL = Lin; gSnapT3 = Tr; return; }
  tEnd = min(tEnd, 2.0 * uR);
  float tAp = clamp(-dot(o, d), 0.0, tEnd);
  vec2 core = iSphere(o, d, uR - uHcut);
  float a1 = tAp, b0 = tAp;
  if (core.x < core.y && core.y > 0.0) { a1 = min(a1, max(core.x, 0.0)); b0 = max(b0, core.y); }
  a1 = min(a1, tEnd); b0 = min(b0, tEnd);
  float hz = min(5.0 * uHM, uHcut * 0.5);
  vec2 zb = iSphere(o, d, uR - hz);
  bool zHit = zb.x < zb.y && zb.y > 0.0;
  float z1 = zHit ? clamp(zb.x, 0.0, a1) : a1;
  float z2 = zHit ? clamp(zb.y, b0, tEnd) : b0;
  float h0 = uR - length(o);
  float hz1 = uR - length(o + d * z1), ha1 = uR - length(o + d * a1);
  float hb0 = uR - length(o + d * b0), hz2 = uR - length(o + d * z2), he = uR - length(o + d * tEnd);
  bool hasDn = tEnd - b0 > 1e-3;
  int nUp = hasDn ? nNear : nNear + nFar;
  int nDn = hasDn ? nFar : 0;
  int nUpH = (a1 - z1 > 1e-3) ? max(2, nUp * 2 / 5) : nUp;
  int nDnH = (z2 - b0 > 1e-3) ? max(2, nDn * 2 / 5) : nDn;
  atmoMarch(o, d, 0.0, z1, (hz1 - h0) / uHM, false, nUpH, jit, skyMean, Lin, Tr);
  atmoMarch(o, d, z1, a1, (ha1 - hz1) / uHR, false, nUp - nUpH, jit, skyMean, Lin, Tr);
  if (uVeilK > 0.0) {                                // 穿过真空核：暗幕（快照若落在核内也按比例）
    float lc = max(b0 - a1, 0.0);
    if (!gSnapped && gSnapT < b0) { gSnapL = Lin; gSnapT3 = Tr * exp(-uVeilK * max(gSnapT - a1, 0.0)); gSnapped = true; }
    Tr *= exp(-uVeilK * lc);
  }
  atmoMarch(o, d, b0, z2, (hb0 - hz2) / uHR, true, nDn - nDnH, jit, skyMean, Lin, Tr);
  atmoMarch(o, d, z2, tEnd, (hz2 - he) / uHM, true, nDnH, jit, skyMean, Lin, Tr);
  if (!gSnapped) { gSnapL = Lin; gSnapT3 = Tr; }
}

// =====================================================================================
//  4. 地形：基准面（球面 / 阶地）＋ 多尺度位移；全部相机相对
// =====================================================================================
const float TILE_FEAT = 32.0;                                   // 高度图一张平铺横跨 32 个特征
const float LAYER_L[5] = float[5](6.0, 1.1, 0.2, 0.035, 0.006); // 各层特征尺度 km
const float LAYER_A[5] = float[5](0.32, 0.085, 0.018, 0.0032, 0.0007); // 各层幅度 km（×域系数）
const float LAYER_REST[5] = float[5](0.427, 0.107, 0.022, 0.0039, 0.0007); // 本层及更细各层幅度之和

float dRxz(vec3 v) {                 // r(P+v) − r(P)
  vec2 p = uCamPos.xz, w = v.xz;
  float num = 2.0 * dot(p, w) + dot(w, w);
  return num / (uCamR0 + sqrt(max(uCamR0 * uCamR0 + num, 0.0)));
}
float dRho(vec3 v) {                 // |P+v| − |P|
  float num = 2.0 * dot(uCamPos, v) + dot(v, v);
  return num / (uCamRho + sqrt(max(uCamRho * uCamRho + num, 0.0)));
}
float trench(float y) { return uAbyssDepth * (1.0 - smoothstep(uAbyssHalf * 0.55, uAbyssHalf, abs(y))); }
float trenchD(float y) {
  float a = uAbyssHalf * 0.55, b = uAbyssHalf, x = sat((abs(y) - a) / (b - a));
  return -uAbyssDepth * 6.0 * x * (1.0 - x) / (b - a) * sign(y);
}
// 阶地锯齿：踏面上 s=f−0.5（与球面坡度相消 → 水平），f∈[1−c,1] 是崖面（陡降）
float sawS(float f) { return (f - 0.5) - smoothstep(1.0 - uCliffFrac, 1.0, f); }
float sawSD(float f) {
  float a = 1.0 - uCliffFrac, x = sat((f - a) / uCliffFrac);
  return 1.0 - 6.0 * x * (1.0 - x) / uCliffFrac;
}
float altSphere(vec3 v) { return uCamAltS - uTrenchP - dRho(v); }   // 相对半径 R 的宏观球面（不含深渊，用于“已高过一切地形”的判断）
vec2 tanCoord(vec3 v) { return vec2(dot(v, uFrameE), dot(v, uFrameN)); }
// 阶地相位：phase = y/W + wig·w(地表, 15 km 级) + jit·b(地表, 1 km 级)；f = fract(phase)
// 前者让崖线蜿蜒、踏面宽窄不一；后者让崖面前后进退（扶壁与冲沟），崖面法线因此有起伏
float terNoise(vec3 v, out vec3 gradW) {
  vec2 c = tanCoord(v);
  vec4 a = texture(uHeightTex, c * uWigS + uWigOrg);
  const float an = 1.31;
  mat2 R1 = mat2(cos(an), sin(an), -sin(an), cos(an));
  float s1 = 1.0 / (LAYER_L[1] * TILE_FEAT);
  vec4 b = texture(uHeightTex, (R1 * c) * s1 + uLayerOrg[1]);
  vec2 g = uTerWig * a.gb * uWigS + uCliffJit * (transpose(R1) * b.gb) * s1;
  gradW = g.x * uFrameE + g.y * uFrameN;
  return uTerWig * (a.r - uW0) + uCliffJit * (b.r - uB0);
}
float terF(vec3 v) { vec3 g; return fract(uCamFy + v.y / uTerW + terNoise(v, g)); }
vec3 terGradPhase(vec3 v) { vec3 g; terNoise(v, g); return vec3(0.0, 1.0 / uTerW, 0.0) + g; }
float gF = 0.0; vec3 gGradW = vec3(0.0);           // altBase 顺手留下的阶地相位与噪声梯度（步进时复用，省纹理读取）
float altBase(vec3 v) {
  float yX = uCamPos.y + v.y;
  float tr = trench(yX) - uTrenchP;
  if (uGroundMode == 0) return uCamAltS - dRho(v) + tr;
  float rsX = sqrt(max(uR * uR - yX * yX, 0.0));
  float dRs = -(2.0 * uCamPos.y * v.y + v.y * v.y) / (rsX + uRsphP);
  gF = fract(uCamFy + v.y / uTerW + terNoise(v, gGradW));
  return uCamAltT + dRs - uHcS * (sawS(gF) - sawS(uCamFy)) + tr - dRxz(v);
}

// 多尺度位移（大→小），返回 x＝位移 km（向上为正），yz＝对东、北的偏导。
// foot＝像素足迹（km）：小于足迹的层淡出＝预滤波；clear＝当前离基准面的间隙：远大于余下各层幅度就提前停。
vec3 dispLayers(vec2 c, float foot, float clear) {
  vec3 acc = vec3(0.0);
  float amp = uZoneAmp * uDispScale;
  for (int k = 0; k < 5; k++) {
    float L = LAYER_L[k];
    float fade = 1.0 - smoothstep(0.3 * L, 1.2 * L, foot);
    if (fade <= 0.0) break;
    if (clear - acc.x > 2.5 * LAYER_REST[k] * amp) break;
    float an = float(k) * 1.31;
    mat2 Rk = mat2(cos(an), sin(an), -sin(an), cos(an));
    float s = 1.0 / (L * TILE_FEAT);
    vec4 tx = texture(uHeightTex, (Rk * c) * s + uLayerOrg[k]);
    float A = LAYER_A[k] * amp * fade;
    acc.x += A * tx.r;
    acc.yz += A * s * (transpose(Rk) * tx.gb);
  }
  return acc;
}
float altAt(vec3 v, float foot) {
  float b = altBase(v);
  return b - dispLayers(tanCoord(v), foot, b).x;
}
float dSaw(float x, float a, float b) { float u = sat((x - a) / (b - a)); return 6.0 * u * (1.0 - u) / (b - a); }

vec3 terrainNormal(vec3 v, float foot) {
  vec3 X = uCamPos + v;
  vec3 g;
  if (uGroundMode == 1) {
    float rs = sqrt(max(uR * uR - X.y * X.y, 1.0));
    vec3 gp = terGradPhase(v);
    vec3 rh = vec3(X.x, 0.0, X.z) / length(X.xz);
    g = vec3(0.0, -X.y / rs + trenchD(X.y), 0.0) - uHcS * sawSD(terF(v)) * gp - rh;
  } else {
    g = -normalize(X) + vec3(0.0, trenchD(X.y), 0.0);
  }
  vec3 dd = dispLayers(tanCoord(v), foot, 0.0);
  g -= dd.y * uFrameE + dd.z * uFrameN;
  return normalize(g);
}

// 近处高度场步进。阶地模式下崖面区（f∈[1−c,1]）坡度大，进入前把步长截在崖面边界，崖内小步走。
float marchTerrain(vec3 d, float tMax, float pix) {
  float t = 0.0, tPrev = 0.0, aPrev = altAt(vec3(0.0), 1e-4);
  float rampSlope = abs(uHcS) / max(uCliffFrac * uTerW, 1e-4);
  // 锥形步进：地面坡度不超过 uLip，视线仰角 θ（相对踏面或球面）越大，一步可以走得越远
  vec3 nUp = uGroundMode == 1 ? uFrameU : -normalize(uCamPos);
  float sinT = dot(d, nUp), cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
  float kStep = 1.0 / max(uLip * cosT - sinT, 0.3);
  for (int i = 0; i < Q_TER_STEPS; i++) {
    vec3 v = d * t;
    float foot = max(t * pix, 2e-4);
    float a = altAt(v, foot);
    if (a < 0.0) {                                   // 越过地面：割线法细化
      float tl = tPrev, th = t, al = aPrev, ah = a;
      for (int j = 0; j < 5; j++) {
        float tm = tl + (th - tl) * al / max(al - ah, 1e-9);
        float am = altAt(d * tm, max(tm * pix, 2e-4));
        if (am < 0.0) { th = tm; ah = am; } else { tl = tm; al = am; }
      }
      return tl;
    }
    if (a < 0.3 * foot) return t;
    // 高过一切可能的地形且仍在上升 → 近处不会再碰地面（凹面里要过了弦的中点才往下走）
    float aS = altSphere(v);
    if (aS > uClearMax && dot(d, -normalize(uCamPos + v)) > 0.02) return INF;
    float dt = a * min(kStep, 3.0);
    if (uGroundMode == 1) {
      float f = gF;                                  // 来自刚才的 altAt → altBase
      float a0 = 1.0 - uCliffFrac;
      float dfdt = dot(d, vec3(0.0, 1.0 / uTerW, 0.0) + gGradW);
      if (f >= a0) dt = a / (1.0 + rampSlope);
      else if (abs(dfdt) > 1e-6) {
        float df = dfdt > 0.0 ? (a0 - f) : f;       // 到下一段崖面边界（相位非线性，打八折）
        dt = min(dt, 0.8 * df / abs(dfdt) + 1e-4);
      }
    }
    dt = max(dt, 3e-4 + foot * 0.8);                 // 最小步长＝像素足迹（远处自动放粗）
    tPrev = t; aPrev = a;
    t += dt;
    if (t > tMax) return INF;
  }
  // 步数用尽：多半是贴地掠射，就近当作命中（比漏成天空好）
  return altAt(d * t, max(t * pix, 2e-4)) < 0.05 * t + 0.02 ? t : -1.0;
}

float terrainShadow(vec3 v0, vec3 l) {
  float res = 1.0, t = 0.004;
  for (int i = 0; i < Q_SHADOW_STEPS; i++) {
    vec3 v = v0 + l * t;
    float a = altAt(v, 0.05 + t * 0.01);              // 阴影只看大尺度（细层淡出，省读取）
    res = min(res, 10.0 * a / t);
    if (res < 0.02) return 0.0;
    t += clamp(a * 0.7, 0.004, 0.25 * uTerW + 0.5);
    if (t > 30.0) break;
  }
  return sat(res);
}

// =====================================================================================
//  5. 材质：各域地表（程序生成，无外部纹理）
// =====================================================================================
struct Surf { vec3 alb; float rough; float wet; };

vec4 zoneWeightsAt(vec3 X) {            // x 轻 y 平 z 重 w 罪域
  float g = uGEq * length(X.xz) / uR;
  float wl = 1.0 - smoothstep(uGLight - 0.04, uGLight + 0.04, g);
  float wh = smoothstep(uGHeavy - 0.04, uGHeavy + 0.04, g);
  return vec4(wl, max(1.0 - wl - wh, 0.0), wh, ruiMask(X));
}
float limboWeightAt(vec3 X) { return 1.0 - smoothstep(uLimboKm * 0.8, uLimboKm, abs(X.y)); }

Surf terrainSurf(vec3 v, vec3 n, float noiseA, vec4 zw, float limbo) {
  vec3 X = uCamPos + v;
  vec3 upG = -vec3(X.x, 0.0, X.z) / length(X.xz);
  float flatW = sat((dot(n, upG) - 0.55) / 0.4);        // 1＝平地，0＝崖
  float strata = fract(dRxz(v) / 0.045 + noiseA * 1.7);   // 崖面上的水平岩层（等离轴半径，噪声扭曲）
  float band = (smoothstep(0.3, 0.5, strata) - smoothstep(0.7, 0.95, strata)) * smoothstep(0.2, 0.6, noiseA);
  float nz = noiseA;
  // 罪域：赤红黑岩 + 酸蚀硫酸盐结壳 + 湿
  vec3 basalt = vec3(0.034, 0.030, 0.030), rust = vec3(0.20, 0.068, 0.036), crust = vec3(0.40, 0.36, 0.21);
  vec3 rui = mix(mix(basalt, rust, band * 0.85), mix(rust * 0.8, basalt, smoothstep(0.4, 0.7, nz)), flatW);
  rui = mix(rui, crust, flatW * smoothstep(0.78, 0.92, nz) * 0.8);
  // 重域（非罪域）：暗褐岩、稀灌丛
  vec3 heavy = mix(mix(vec3(0.085, 0.07, 0.058), vec3(0.13, 0.09, 0.06), band), vec3(0.06, 0.07, 0.035), flatW * 0.6);
  // 平域：草、土、裸岩
  vec3 grass = mix(vec3(0.055, 0.085, 0.03), vec3(0.11, 0.10, 0.045), smoothstep(0.3, 0.8, nz));
  vec3 plain = mix(mix(vec3(0.19, 0.18, 0.165), vec3(0.15, 0.12, 0.08), band), grass, flatW);
  // 轻域：白垩、灰白（余息带来的细白灰）
  vec3 light = mix(vec3(0.42, 0.41, 0.40), vec3(0.62, 0.62, 0.64), flatW * smoothstep(0.3, 0.7, nz));
  vec3 lim = mix(vec3(0.23, 0.23, 0.24), vec3(0.03, 0.03, 0.035), smoothstep(0.7, 0.8, nz));
  vec3 alb = light * zw.x + plain * zw.y + heavy * zw.z;
  alb = mix(alb, rui, zw.w);
  alb = mix(alb, lim, limbo);
  float wet = uWet * zw.w;
  float puddle = wet * flatW * smoothstep(0.15, 0.05, nz);
  alb *= mix(1.0, 0.55, wet * 0.8);
  Surf s;
  s.alb = alb;
  s.rough = mix(0.9, 0.35, wet * 0.7);
  s.rough = mix(s.rough, 0.06, puddle);
  s.wet = max(wet * 0.5, puddle);
  return s;
}

// 宏观（远处）反照率：随域与大陆尺度噪声
vec3 macroAlbedo(vec3 X, vec4 zw, float limbo) {
  vec4 nz = texture(uNoise3D, X / 2600.0);
  float v = nz.r;
  vec3 light = vec3(0.40, 0.40, 0.39) + 0.1 * v;
  vec3 plain = mix(vec3(0.07, 0.09, 0.045), vec3(0.16, 0.13, 0.085), smoothstep(0.35, 0.7, v));
  vec3 heavy = mix(vec3(0.09, 0.07, 0.055), vec3(0.12, 0.08, 0.055), v);
  vec3 rui = mix(vec3(0.06, 0.035, 0.03), vec3(0.11, 0.05, 0.035), v);
  vec3 a = light * zw.x + plain * zw.y + heavy * zw.z;
  a = mix(a, rui, zw.w);
  return mix(a, vec3(0.2, 0.2, 0.21), limbo);
}

// =====================================================================================
//  6. 云：近处体积步进（快照合成）＋ 远处（对面世界）二维近似
// =====================================================================================
float cloudCoverage(vec3 X) {
  vec3 n = X / length(X);
  // 自转一周约 71 分钟 → 科氏力强，云街沿方位（东西）拉长；纬向急流相间：按纬度差速旋转采样
  float th = uWind.z * sin(n.y * 9.0);
  vec3 q = vec3(n.x * cos(th) - n.z * sin(th), n.y * 2.6, n.x * sin(th) + n.z * cos(th));
  vec4 a = texture(uNoise3D, q * 0.55 + 0.37);
  vec4 b = texture(uNoise3D, q * 1.9 + 0.11);
  float base = a.r * 0.7 + b.r * 0.3;
  float cov = smoothstep(1.0 - uCloudCover - 0.18, 1.0 - uCloudCover + 0.2, base);
  float hole = smoothstep(0.62, 0.8, b.g);                    // 罪域阴云里偶尔的云缝
  return max(cov, ruiMask(X) * uRuiOvercast * (1.0 - 0.6 * hole));
}
float cloudDens(vec3 X, float hn, float cov, int lod) {
  if (hn <= 0.0 || hn >= 1.0 || cov <= 0.01) return 0.0;
  float prof = smoothstep(0.0, 0.1, hn) * (1.0 - smoothstep(0.35 + 0.6 * cov, 1.0, hn));
  vec4 s = texture(uNoise3D, X / 24.0 + uWind * 0.02);
  float wfbm = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  float shape = sat((s.r - (1.0 - wfbm) * 0.45) / 0.55 + 0.1);
  float dens = sat((shape * prof - (1.0 - cov)) / max(cov, 0.05));
  if (lod == 0 && dens > 0.0) {
    vec4 dn = texture(uNoise3D, X / 3.2 + uWind * 0.08);
    float det = dn.g * 0.625 + dn.b * 0.25 + dn.a * 0.125;
    dens = sat(dens - (1.0 - det) * 0.32 * (1.0 - dens));
  }
  return dens;
}
float cloudHn(vec3 X) { return (uR - length(X) - uCloudBase) / (uCloudTop - uCloudBase); }

// 体积云：返回 rgb＝云自身的散射光（不含云前大气），a＝透射率；tMean＝透射率加权深度
vec4 marchClouds(vec3 o, vec3 d, float t0, float t1, float jit, out float tMean) {
  tMean = INF;
  float len = min(t1 - t0, 160.0);
  if (len <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = len / float(Q_CLOUD_STEPS);
  float T = 1.0, wsum = 0.0, tw = 0.0;
  vec3 L = vec3(0.0);
  vec3 skyUp = vec3(0.0), skyDn = vec3(0.0);
  vec3 Xm = o + d * (t0 + 0.5 * len);
  vec3 upM = -Xm / length(Xm);
  skyUp = skyIrradiance(upM) / PI;     // 云顶方向的天光辐亮度
  skyDn = skyIrradiance(-upM) / PI;    // 地面方向的反照
  for (int i = 0; i < Q_CLOUD_STEPS; i++) {
    float t = t0 + (float(i) + jit) * dt;
    vec3 X = o + d * t;
    float hn = cloudHn(X);
    float cov = cloudCoverage(X);
    float dens = cloudDens(X, hn, cov, t < 40.0 ? 0 : 1);
    if (dens > 0.003) {
      float sig = dens * uCloudSigma;
      vec3 Ls = uSunPos - X;
      float ds2 = dot(Ls, Ls);
      vec3 l = Ls * inversesqrt(ds2);
      vec3 up = -X / length(X);
      float vis = bodyVisTower(X, uSunPos, uSunRad);
      float tauL = 0.0;
      if (vis > 0.0) {                                   // 朝太阳的自遮挡：步长倍增
        float s = 0.25;
        for (int j = 0; j < Q_CLOUD_LIGHT; j++) {
          vec3 Y = X + l * s;
          tauL += cloudDens(Y, cloudHn(Y), cov, 1) * uCloudSigma * s * 0.75;
          s *= 2.2;
        }
      }
      float mu = max(dot(l, up), 0.05);
      vec3 Esun = uSunI / ds2 * vis * transToward(uR - length(X), mu) * veilT(X, uSunPos);
      float c = dot(d, l);
      // 多次散射八度近似（Wrenninge）：光学厚度、散射率、各向异性逐级减半
      float ms = 0.0, aa = 1.0, bb = 1.0, cc = 1.0;
      for (int o2 = 0; o2 < 3; o2++) {
        ms += aa * exp(-tauL * bb) * mix(phaseHG(c, 0.8 * cc), phaseHG(c, -0.25 * cc), 0.25);
        aa *= 0.55; bb *= 0.45; cc *= 0.5;
      }
      // 厚云深处的漫射场（双流近似）：τ' 为上方光学厚度，云底亮度 → (1−R)·Eμ/π
      float tauUp = tauL * mu;
      float tauBelow = sig * max(uR - length(X) - uCloudBase, 0.0) * 0.6;
      float tauTot = tauUp + tauBelow;
      float diff = (2.0 + 0.15 * tauBelow) / (2.0 + 0.15 * tauTot) * (1.0 - exp(-tauUp));
      vec3 S = Esun * (ms + diff * mu / PI) + mix(skyDn, skyUp, sat(hn)) * 0.5;
      if (uMoonE.g > 1e-7) S += uMoonE * 0.6 * mix(phaseHG(dot(d, normalize(uMoonPos - X)), 0.7), 0.08, 0.5);
      float Tst = exp(-sig * dt);
      L += T * S * (1.0 - Tst);
      tw += T * (1.0 - Tst) * t; wsum += T * (1.0 - Tst);
      T *= Tst;
      if (T < 0.01) break;
    }
  }
  if (wsum > 0.0) tMean = tw / wsum;
  return vec4(L, T);
}

// 对面世界的云：像素足迹有几公里，单样本 + 双流反照率
vec4 farCloud(vec3 X, float pathLen) {
  float cov = cloudCoverage(X);
  float dens = cloudDens(X, 0.45, cov, 2);
  float tau = dens * uCloudSigma * pathLen * 0.5;
  if (tau < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  float R = 0.15 * tau / (2.0 + 0.15 * tau);
  vec3 up = -X / length(X);
  vec3 Ls = uSunPos - X;
  float ds2 = dot(Ls, Ls);
  vec3 l = Ls * inversesqrt(ds2);
  float vis = bodyVisTower(X, uSunPos, uSunRad);
  float mu = max(dot(l, up), 0.0);
  vec3 E = uSunI / ds2 * vis * transToward(uR - length(X), mu) * mu * veilT(X, uSunPos);
  vec3 Lc = (R / PI) * E * (1.0 + uAmbK);
  float Tc = 1.0 - R;
  return vec4(Lc, Tc * Tc);
}

// =====================================================================================
//  7. 着色
// =====================================================================================
// 远处内壁（宏观）：阶地按“踏面 + 崖面”两朵微面的投影面积加权，崖遮踏面按解析比例
vec3 shadeWall(vec3 X, vec3 d) {
  float rX = length(X.xz);
  vec3 nS = -X / length(X);
  vec3 upG = -vec3(X.x, 0.0, X.z) / max(rX, 1e-3);
  vec4 zw = zoneWeightsAt(X);
  float limbo = limboWeightAt(X);
  vec3 alb = macroAlbedo(X, zw, limbo);
  float abyss = 1.0 - smoothstep(uAbyssHalf * 0.6, uAbyssHalf, abs(X.y));
  vec3 Ls = uSunPos - X;
  float ds2 = dot(Ls, Ls);
  vec3 l = Ls * inversesqrt(ds2);
  float vis = bodyVisTower(X, uSunPos, uSunRad);
  float h = uR - length(X);
  float muS = max(dot(l, nS), 0.0);
  vec3 E = uSunI / ds2 * transToward(h, muS) * veilT(X, uSunPos);
  float cosI = muS;
  if (uGroundMode == 1 && abs(X.y) > 1.0) {
    vec3 nR = vec3(0.0, -sign(X.y), 0.0);           // 崖面朝向：背离近极（朝赤道）
    float W = uTerW, H = abs(uHcS);
    float wt = W * max(dot(-d, upG), 0.0), wr = H * max(dot(-d, nR), 0.0);
    float tread = max(dot(upG, l), 0.0), riser = max(dot(nR, l), 0.0);
    float shadowFrac = sat(H * sqrt(max(1.0 - tread * tread, 0.0)) / max(tread, 1e-3) / W * max(dot(l, -nR), 0.0));
    cosI = (wt * tread * (1.0 - shadowFrac) + wr * riser) / max(wt + wr, 1e-6);
  }
  vec3 col = alb / PI * E * (vis * cosI + uAmbK * mix(0.25, 1.0, vis) * muS);
  col *= 1.0 - 0.97 * abyss * (uAbyssDepth > 0.0 ? 1.0 : 0.0);
  return col;
}

vec3 shadeTower(vec3 X, vec3 d) {
  if (uTowerAlb <= 0.0) return vec3(0.0);
  vec3 n = normalize(vec3(X.x, 0.0, X.z));
  vec3 Ls = uSunPos - X;
  vec3 l = normalize(Ls);
  float vis = bodyVisTower(X + n * 0.5, uSunPos, uSunRad);
  return uTowerAlb / PI * (uSunI / dot(Ls, Ls) * vis * max(dot(n, l), 0.0) + skyIrradiance(n));
}

vec3 shadeSunDisk(vec3 o, vec3 d, float t) {
  vec3 n = normalize(o + d * t - uSunPos);
  float mu = max(dot(n, -d), 0.0);
  float limb = (1.0 - 0.6 * (1.0 - mu)) / 0.8;       // 一次临边昏暗，平均亮度守恒
  return uSunI / (PI * uSunRad * uSunRad) * limb;
}

vec3 shadeMoonDisk(vec3 o, vec3 d, float t) {
  vec3 Q = o + d * t;
  vec3 n = normalize(Q - uMoonPos);
  vec3 nb = transpose(uMoonBasis) * n;
  vec4 nz = texture(uNoise3D, nb * 0.33 + 0.5);
  vec4 nz2 = texture(uNoise3D, nb * 1.4 + 0.2);
  float maria = smoothstep(0.42, 0.6, nz.r);
  float craters = smoothstep(0.75, 0.95, nz2.g) - 0.6 * smoothstep(0.92, 1.0, nz2.g);
  float A = uMoonAlb * mix(1.2, 0.62, maria) * (0.92 + 0.25 * craters);
  vec3 Ls = uSunPos - Q;
  float ds2 = dot(Ls, Ls);
  vec3 l = Ls * inversesqrt(ds2);
  float vis = bodyVisTower(Q, uSunPos, uSunRad);    // 塔影落在月面：黑月与半影的过渡
  float mu0 = max(dot(n, l), 0.0), mu = max(dot(n, -d), 0.0);
  vec3 L = A / PI * uSunI / ds2 * vis * exp(-uVeilK * sqrt(ds2)) * (2.0 * mu0 / (mu0 + mu + 1e-4));   // Lommel–Seeliger：月面平光
  vec3 Ew = max(uMoonW0 + uMoonW1 * n, vec3(0.0)); // 壁照：内壁白昼反照到月面
  return L + A / PI * Ew;
}

vec3 shadeTerrain(vec3 v, vec3 d, float t, float pix) {
  vec3 X = uCamPos + v;
  float foot = max(t * pix, 2e-4);
  vec3 n = terrainNormal(v, foot);
  float hAtm = uR - length(X);
  vec2 c = tanCoord(v);
  float noiseA = texture(uHeightTex, c / (0.9 * TILE_FEAT) + uLayerOrg[1]).a;
  Surf s = terrainSurf(v, n, noiseA, uZoneW, uLimboW);
  vec3 upG = -vec3(X.x, 0.0, X.z) / length(X.xz);
  // 太阳
  vec3 Ls = uSunPos - X;
  float ds2 = dot(Ls, Ls);
  vec3 l = Ls * inversesqrt(ds2);
  float vis = bodyVisTower(X, uSunPos, uSunRad) * occultVis(X, uSunPos, uSunRad, uMoonPos, uMoonRad);
  float nl = dot(n, l);
  vec3 col = vec3(0.0);
  if (vis > 0.0 && nl > 0.0) {
    float sh = terrainShadow(v + n * 0.0015, l);
    float cT = 1.0;
    if (uCloudOn > 0.5 && sh > 0.0) {               // 云影：沿日光穿过云层的三个样本
      vec2 sb = iSphere(X, l, uR - uCloudBase);
      float tb = sb.y > 0.0 ? max(sb.x, 0.0) : 0.0;
      float tau = 0.0;
      for (int j = 0; j < 3; j++) {
        vec3 Y = X + l * (tb + (float(j) + 0.5) / 3.0 * (uCloudTop - uCloudBase) / max(dot(l, -normalize(X)), 0.2));
        tau += cloudDens(Y, cloudHn(Y), cloudCoverage(Y), 1);
      }
      cT = exp(-tau / 3.0 * uCloudSigma * (uCloudTop - uCloudBase) / max(dot(l, -normalize(X)), 0.2));
    }
    vec3 E = uSunI / ds2 * vis * sh * cT * transToward(hAtm, dot(l, -normalize(X))) * veilT(X, uSunPos);
    // 漫反射 + 湿面的 GGX 高光
    vec3 hv = normalize(l - d);
    float a2 = s.rough * s.rough * s.rough * s.rough;
    float nh = max(dot(n, hv), 0.0);
    float D = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(hv, -d), 0.0), 5.0);
    float spec = D * F * 0.25 / max(nl * max(dot(n, -d), 0.05), 1e-3) * nl;
    col += E * (s.alb / PI * nl + s.wet * spec);
  }
  // 月
  if (uMoonE.g > 1e-7) {
    vec3 lm = normalize(uMoonPos - X);
    float vm = bodyVisTower(X, uMoonPos, uMoonRad);
    col += s.alb / PI * uMoonE * vm * veilT(X, uMoonPos) * max(dot(n, lm), 0.0) * transToward(hAtm, dot(lm, -normalize(X)));
  }
  // 天光（含夜里对面世界的辉光）× 崖脚遮蔽
  float ao = 1.0;
  if (uGroundMode == 1) {
    float f = terF(v);
    float dist = (uHcS > 0.0 ? f : (1.0 - uCliffFrac - f)) / length(terGradPhase(v));
    float beta = atan(abs(uHcS), max(dist, 1e-4));
    ao = 1.0 - (1.0 - cos(beta)) * 0.5 * sat((dot(n, upG) - 0.8) / 0.2);
  }
  col += s.alb / PI * skyIrradiance(n) * ao;
  return col;
}
