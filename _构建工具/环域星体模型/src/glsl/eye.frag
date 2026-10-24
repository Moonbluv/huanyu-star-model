// eye.frag：眼 pass，5×1 RGBA32F 乒乓，拼在 common、shadow、clouds 之后（02 第十四节第 3 条；eye 路 2026-10-14 修订）
// 纹素 0：x 曝光（乘在场景单位 kn 上）、y 适应亮度 cd/m²、z 到眼的日照度 klux（亮度）、w 照明色度（r、g 各 12 位打包）
// 纹素 1：x 水平面照度 klux、y 其中的直射、z 测光目标 cd/m²（对称预滤波之后）、w 与此刻画面等亮的“固定 EV”所对应的亮度（HUD 的 EV 用它）
// 纹素 2：rgb 到眼的日照度 klux（带颜色：弦表透射、云、塔缘气层、露出部分的临边昏暗色；失能眩光用它的颜色），w 测光目标的对数（预滤波状态）
// 纹素 3：x 本帧模拟秒步长，y 1＝雨丝或余息飘尘在画（TAA 读：下一帧），z 已适应的水平面照度对数（key 用），w 慢变的水平面照度对数（判“环境变了没有”）
// 纹素 4：x 画面的对数平均亮度，y key，z 环境项 ln L_环境，w 混合后的测光目标（预滤波之前）
//
// 修订（问题单 4、5、8、10、14、15、16、2、18）：
//  · key 不再由画面亮度定（02 原式 0.18·min(1,(La/100)^0.2) 在这个世界的夜里永远满额），改由与朝向无关的水平面照度定，
//    整段连续：key＝0.18·clamp((Eh/π ÷ 2×10⁴ cd/m²)^¼, 0.01, 1)。CIECAM02 的 F_L^¼：适应亮度越低，同一物体看着越暗。
//    圣禁城晴天正午满额；罪域阴雨正午约 −0.6 EV；白夜约 −0.9 EV；罪域子夜约 −1.8 EV；十几 lux 约 −3 EV；月光量级 −4.5 EV。
//  · 适应亮度不只看 70° 画面：ln La＝ln L_环境＋f(d)，d＝ln L_画面 − ln L_环境（EV）；f＝0.4·clamp(d, −1, 1)＋0.5·clamp(d − 1, 0, 3)。
//    L_环境＝0.3·E_水平/π（与朝向无关；0.3 让各地平视画面的 d≈0）：人眼对整个视野适应，原地转头只摆一个 EV 以内；
//    画面比环境亮得多时（迎着晨昏的亮云、对岸亮地）多跟一些，不至于一片白。迎着太阳的那份由光幕计入（meter.frag）。
//    望远时（视角 60° → 10°）渐渐全跟画面：画面只是注视的那一小块。
//  · 测光目标先在对数域做对称的 0.25 s 预滤波，再进“变亮快、变暗慢”的不对称适应（否则噪声的尖峰被快速跟上、低谷慢慢回落，
//    曝光整体偏暗、持续抽动）；差不到 0.1 EV 时只以四分之一的速度跟。
//  · 环境没变、只是转头：变亮、变暗都用快 τ（0.4／0.6 s）；环境变了（日落、进阴影）：0.6／3 s；进中间视、暗视时变暗再慢到 24 s。
//    快进时 τ 按 √(倍速/60) 缩短，并把适应亮度限在目标 ±0.3 EV 内（看的是光怎样变，不是眼睛的滞后）。
//  · 到眼日照不再取相机处云影图的一个纹素：在相机处沿日光方向用画云的同一套密度函数步进 32 步（每帧换抖动），再做 0.2 s 的时间平滑；
//    日面被塔缘、地形、月切掉一部分时，按露出部分算平均临边昏暗色——最后一线是 3000 K 上下的橙色光（亮度仍是 10⁸ cd/m² 量级）。
//  · 固定 EV 与读数同一口径（测光表 K＝12.5）：曝光＝0.18/(2^EV·0.125)；读数的 EV 按“与此刻画面等亮的固定 EV”给（纹素 1 的 w）。
uniform sampler2D uMeter, uEyePrev;
uniform vec4 uEyeCtl;                 // x 真实秒步长，y 1＝直接跳到目标（瞬移、时间跳变、首帧），z 本帧模拟秒步长，w 1＝雨丝或余息飘尘在画
uniform vec4 uEyeCfg;                 // x 自动曝光 1／固定 EV 0，y 固定 EV，z EV 补偿，w 色适应强度（CPU 用）
layout(location = 0) out vec4 oc;

const float LN2 = 0.69314718;
const float L_ENV_K = 0.3;            // 环境项：0.3·E_水平/π（与各地平视画面的对数平均亮度对齐）
const float KEY_REF = 2.0e4;          // key 满额的参考亮度 Eh/π（cd/m²）：约 63 klux

// 日面露出 f（0–1，被一条直边切）时，露出部分相对整盘平均的临边昏暗色。临边昏暗 I(μ)∝1−u(1−μ)，u＝(0.55, 0.70, 0.85)。
// 直边在离日心 u_e 处：露出面积 f＝½＋(u_e√(1−u_e²)＋asin u_e)/π；露出部分的 ⟨μ⟩＝(u_e − u_e³/3 + 2/3)/(2f)。
vec3 limbTint(float f){
  if (f >= 0.999) return vec3(1.0);
  f = clamp(f, 1e-5, 0.999);
  float c = 3.0*PI/(4.0*sqrt(2.0));
  float ue = f < 0.5 ? -1.0 + pow(c*f, 2.0/3.0) : 1.0 - pow(c*(1.0 - f), 2.0/3.0);
  for (int i = 0; i < 5; i++){
    ue = clamp(ue, -1.0, 1.0);
    float s = sqrt(max(1.0 - ue*ue, 1e-8));
    float g = 0.5 + (ue*s + asin(ue))/PI - f;
    ue -= g/max(2.0*s/PI, 1e-4);
  }
  ue = clamp(ue, -1.0, 1.0);
  float mu = clamp((ue - ue*ue*ue/3.0 + 2.0/3.0)/(2.0*f), 0.0, 1.0);
  vec3 ld = vec3(0.55, 0.70, 0.85);
  return (1.0 - ld*(1.0 - mu))/(1.0 - ld/3.0);
}
// 相机处沿日光方向穿过云层的透射：与近段画云同一个密度（Q_CLOUD_KM 内体积云，往外平均场），32 步
float cloudTsun(vec3 l, float jit){
  if (uCloudOn < 0.5) return 1.0;
  float cd = dot(uCamW, l);
  vec2 sp = cloudSpanCam(l, cd, 400.0);
  if (sp.x < 0.0) return 1.0;
  float L = sp.y - sp.x, tau = 0.0;
  for (int i = 0; i < 32; i++){
    float t = sp.x + L*(float(i) + jit)/32.0;
    vec3 X = uCamW + l*t; float z = zOfK(Kat(t, cd)); vec4 wx = weatherAt(X);
    float fm = sstep(0.6*Q_CLOUD_KM, Q_CLOUD_KM, t), dens = 0.0;
    if (fm < 1.0) dens = cloudDens(X, z, wx, t < 0.5*Q_CLOUD_KM ? 0 : 1)*(1.0 - fm);
    if (fm > 0.0) dens += cloudMean(X, z, wx)*fm;
    tau += dens*uCloudSigma*L/32.0;
    if (tau > 40.0) break;
  }
  return exp(-tau);
}
void main(){
  vec4 p0 = texelFetch(uEyePrev, ivec2(0, 0), 0), p2 = texelFetch(uEyePrev, ivec2(2, 0), 0), p3 = texelFetch(uEyePrev, ivec2(3, 0), 0);
  bool jump = uEyeCtl.y > 0.5 || !(p0.y > 0.0);
  float dt = max(uEyeCtl.x, 0.0);
  float speed = uEyeCtl.z/max(dt, 1e-4);                           // 模拟秒／真实秒（暂停时 0）
  float fs = sqrt(max(1.0, speed/60.0));                            // 快进时各个 τ 缩短的倍数

  // ---- 到眼的日光 ----
  vec3 Up = vec3(-1.0, 0.0, 0.0), l; float vis;
  vec3 E = sunE(uCamW, uCamK, l, vis, true);
  if (vis > 0.0){
    float hv = horizonVis(vec2(0.0), uCamW, l);
    float jit = fract(float(uFrame & 1023)*0.61803399 + 0.5*fract(float(uFrame >> 10)*0.7548777));
    E *= hv*cloudTsun(l, jit)*limbTint(vis*hv);
  }
  vec3 Es = jump ? E : mix(p2.rgb, E, 1.0 - exp(-dt*fs/0.2));
  if (!(Es.r + Es.g + Es.b < 1e30)) Es = E;                          // 首帧的初值（EYE0）不是颜色

  // ---- 照度：水平面（读数、key、色适应、适应的环境项） ----
  vec3 Esky = shIrr(Up, 0), Ehz = Es*max(dot(Up, l), 0.0);
  vec3 ill = Ehz + Esky; float s3 = max(ill.r + ill.g + ill.b, 1e-12);
  float Eh = max(lum(ill), 1e-9);                                   // klux
  float lnEnv = log(clamp(L_ENV_K*Eh*1000.0/PI, 0.003, 1e5));

  // ---- 测光：画面（含失能眩光的光幕，见 meter.frag）与环境混合 ----
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 32; j++) for (int i = 0; i < 64; i++){ vec4 m = texelFetch(uMeter, ivec2(i, j), 0); acc += vec2(m.x*m.y, m.y); }
  float lnFrame = acc.y > 0.0 ? acc.x/acc.y : lnEnv;
  float dF = (lnFrame - lnEnv)/LN2;                                 // 画面比环境亮几个 EV
  float lnT = lnEnv + LN2*(0.4*clamp(dF, -1.0, 1.0) + 0.5*clamp(dF - 1.0, 0.0, 3.0));
  lnT = clamp(mix(lnFrame, lnT, smoothstep(0.0875, 0.5774, uTanHalfFov)), log(0.003), log(1e5));   // 望远（视角 10° 以下）：画面就是注视的那一小块，全跟画面

  // ---- 适应 ----
  float lnEhNow = log(Eh*1000.0);
  float lnEhS = jump ? lnEhNow : mix(p3.w, lnEhNow, 1.0 - exp(-dt*fs/2.0));   // 慢变的环境（2 s）
  float lnF = jump ? lnT : mix(p2.w, lnT, 1.0 - exp(-dt*fs/0.25));              // 对称预滤波（0.25 s）
  float lnLa = lnF, lnEhA = lnEhNow;
  if (!jump){
    float lnLa0 = log(p0.y), dl = lnF - lnLa0;
    bool env = abs(lnEhNow - lnEhS) > 0.15;                          // 环境在变（日落、进阴影、瞬移以外的大变化）
    float tau = dl > 0.0 ? (env ? 0.6 : 0.4) : (env ? 3.0 : 0.6);
    float meso = 1.0 - sstep(log(0.003), log(3.0), min(lnF, lnLa0));  // 往中间视、暗视里走：暗适应要慢得多
    if (dl < 0.0) tau *= 1.0 + 7.0*meso;
    float k = (1.0 - exp(-dt*fs/tau))*mix(0.25, 1.0, sstep(0.035, 0.1, abs(dl)));   // 0.1 EV 以内只慢慢跟（噪声不抽动）
    lnLa = lnLa0 + dl*k;
    if (speed > 60.0) lnLa = clamp(lnLa, lnF - 0.3*LN2, lnF + 0.3*LN2);
    float tauE = lnEhNow > p3.z ? 0.6 : 3.0*(1.0 + 7.0*meso);       // key 跟着环境适应：变亮快、变暗慢（同光照变化时的 τ）
    lnEhA = p3.z + (lnEhNow - p3.z)*(1.0 - exp(-dt*fs/tauE));
    if (speed > 60.0) lnEhA = clamp(lnEhA, lnEhNow - 0.3*LN2, lnEhNow + 0.3*LN2);
  }
  float La = clamp(exp(lnLa), 0.003, 1e5);
  float key = 0.18*clamp(pow(exp(lnEhA)/PI/KEY_REF, 0.25), 0.01, 1.0);
  float expo = (uEyeCfg.x > 0.5 ? key/La*exp2(uEyeCfg.z) : 0.18/(exp2(uEyeCfg.y)*0.125))*1000.0;   // 每 cd/m² → 每 kn
  float LaEq = La*0.18/key;                                         // 读数：S.ev(LaEq)＝锁住后画面不变的 EV

  vec2 ch = clamp(ill.rg/s3, 0.0, 1.0);
  float pk = floor(ch.x*4095.0 + 0.5)*4096.0 + floor(ch.y*4095.0 + 0.5);
  if (s3 <= 1e-12) pk = floor(4095.0/3.0 + 0.5)*4096.0 + floor(4095.0/3.0 + 0.5);
  float x = gl_FragCoord.x;
  if (x < 1.0) oc = vec4(expo, La, lum(Es), pk);
  else if (x < 2.0) oc = vec4(Eh, lum(Ehz), exp(lnF), LaEq);
  else if (x < 3.0) oc = vec4(Es, lnF);
  else if (x < 4.0) oc = vec4(uEyeCtl.z, uEyeCtl.w, lnEhA, lnEhS);
  else oc = vec4(lnFrame, key, lnEnv, lnT);
}
