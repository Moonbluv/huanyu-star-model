// bake_weather.frag：天气图 1024×512，拼在 common 之后（02 第十节第 1 条）。负责：M5（云与设定）。
// 等面积 (φ, y)、地固系：纹素中心 → φ＝2π·u，y＝2v−1（u, v＝纹素中心的纹理坐标；与 common 的 eqArea 同一口径）。
// 输出：r 覆盖度（已按覆盖度滑杆映好，0–1；shade_wall、远段、2.5D 平板都直接用它）、g 类型（0 层云 … 1 积云）、
//       b 厚度系数（存 (厚度−0.6)/0.8，weatherAt 解回 0.6–1.4；八位目标装不下 1 以上）、a 降水势。罪域阴云与云缝不进图，由 clouds.glsl 的 weatherAt 查用时加（罪域的位置随参数变）。
//
// 环流（赤道 1.4 g、自转一周约 71 分钟，科氏参数约为地球的 20 倍 → 多条窄急流，像木星）：
//   · 纬带：y 分成 2·JET_N 条（每条约 700 km），相邻两条一条多云、一条少云；带边就是急流。
//   · 差速：每条带整体绕塔轴转（带内是刚体，不剪切），角速度 ω_k＝JET_RATE·(±1)·(0.55＋0.45·哈希)，相邻两条反向；
//     带边 JET_BLEND 宽度内把两条带的图样交叉淡化：急流处两层云交错滑过，时间再长也不会被剪成细丝。
//   · 底图：东西拉长 2.6 倍的域扭曲 fbm，在噪声的第三维里随时间慢慢演化（EVOLVE／模拟小时）。
//   · 气旋：每条带 2 个，在带的转动坐标里不动（随带漂），寿命 CYC_LIFE 小时上下，到期换个位置重生；
//     对数螺线臂，旋向按半球（科氏力）定，中心一团密云。
//   · 锋面：每条带一条波状长线，沿经度时断时续，宽约 50 km。
// 统计：成云势 pr 过 logistic（近似正态的累积分布）变成大致均匀的 u，再按滑杆 C 映成覆盖度
//   cov＝sstep(1−C−RAMP, 1−C＋RAMP, u)，于是全图平均覆盖度≈C（test/clouds_check.js 的 JS 镜像逐条照抄本文件核对）。
// 时间：uBakeTime＝模拟小时×风速倍率（passes 每 10 模拟分钟重烘）；两次烘焙之间 weatherAt 按同一条带速度补转角（uJetPhase）。
uniform float uBakeTime;                                         // 模拟小时 × 风速倍率
uniform float uCloudCov;                                         // 覆盖度滑杆 C
layout(location = 0) out vec4 oc;

// ---- 常数（test/clouds_check.js 解析这一块；改数不用改测试） ----
const float JET_N = 9.0;          // 纬带：sin(JET_N·π·y)，[−1, 1] 上 18 条
const float JET_RATE = 0.01;      // 带转动角速度的上限 rad/模拟小时（＝HY.fp.set.WIND.jetRadPerHour）
const float JET_BLEND = 0.14;     // 带边交叉淡化的半宽（以带宽计）
const float EVOLVE = 0.004;       // 底图在噪声第三维里演化的速度 /模拟小时
const float WARP = 0.12;          // 域扭曲幅度（噪声坐标）
const float F_MU = 0.684;         // 4 层 fbm（r 通道）的均值、标准差（JS 统计）
const float F_SD = 0.056;
const float R_MU = 0.69;          // 单次取样 r 通道的均值、标准差
const float R_SD = 0.091;
const float A_BAND = 0.9;         // 纬带对成云势的贡献
const float A_CYC = 2.2;          // 气旋
const float A_FRONT = 1.6;        // 锋面
const float CYC_LIFE = 96.0;      // 气旋寿命（模拟小时，按哈希 0.7–1.5 倍）
const float CYC_R0 = 0.03;        // 气旋半径（单位球弦长，×R≈190 km）＋哈希×CYC_R1
const float CYC_R1 = 0.02; 
const float FRONT_W = 0.008;      // 锋面半宽（单位球 y，≈50 km）
const float PR_MU = 0.08;         // 成云势的 logistic：u＝1/(1＋exp(−1.7(pr−PR_MU)/PR_SD))
const float PR_SD = 1.22;
const float RAMP = 0.25;          // 覆盖度映射的半宽

uint wHash(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float wH01(int a, int b){ return float(wHash(uint(a)*0x9e3779b9u + wHash(uint(b) + 0x632be5abu)) >> 8)/16777216.0; }
vec3 rotY(vec3 n, float a){ float c = cos(a), s = sin(a); return vec3(c*n.x - s*n.z, n.y, s*n.x + c*n.z); }
float fbmR(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*texture(uNoise3, p).r; p = p*2.03 + 0.17; a *= 0.5; } return s/0.9375; }
// 第 k 条带的角速度（rad/模拟小时）；k 越界时按边上那条
float bandOmega(int k){ return JET_RATE*((k & 1) == 0 ? 1.0 : -1.0)*(0.55 + 0.45*wH01(k, 1)); }

// 第 k 条带的图样（带的转动坐标里求）：x 成云势 pr，y 气旋强度，z 锋面强度
vec3 bandPattern(vec3 n, int k, float T){
  float th = mod(bandOmega(k)*T, 6.2831853);
  vec3 m = rotY(n, -th);                                          // 转回带坐标：图样随带向 +φ 漂
  float phb = atan(m.z, m.x);
  vec3 q = vec3(m.x, m.y*2.6, m.z);                               // 东西拉长
  float ev = mod(T*EVOLVE, 1.0);                                  // 噪声是周期 1 的：取模不改结果，只保精度
  vec3 w = vec3(texture(uNoise3, q*0.6 + 0.13).r, texture(uNoise3, q*0.6 + 0.71).r, texture(uNoise3, q*0.6 + 0.37).r) - R_MU;
  float bz = (fbmR(q*1.3 + w*(WARP/R_SD) + vec3(0.0, 0.0, ev)) - F_MU)/F_SD;
  float yc = (float(k) + 0.5)/JET_N - 1.0, hw = 0.5/JET_N;       // 带中心、半宽（y）
  // 气旋：带内 2 个，各有寿命，到期在新位置重生
  float cyc = 0.0, hs = m.y >= 0.0 ? 1.0 : -1.0;
  for (int i = 0; i < 2; i++){
    float life = CYC_LIFE*(0.7 + 0.8*wH01(k*4 + i, 2)), cpos = T/life + wH01(k*4 + i, 3);
    int gen = int(floor(cpos)) + 1048576; float fr = cpos - floor(cpos), I = pow(max(sin(PI*fr), 0.0), 1.5);   // 加偏移：t＜0（10018 年以前）时代号也是正数
    float py = yc + (wH01(k*4 + i, gen*7 + 4) - 0.5)*0.3*hw, pp = 6.2831853*wH01(k*4 + i, gen*7 + 5), rr = sqrt(max(1.0 - py*py, 0.0));
    vec3 c = vec3(rr*cos(pp), py, rr*sin(pp));
    float rad = CYC_R0 + CYC_R1*wH01(k*4 + i, gen*7 + 6);
    vec3 dv = m - c; float d = length(dv);
    if (d < rad){
      vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), c)), e2 = cross(c, e1);
      float a = atan(dot(dv, e2), dot(dv, e1)), x = d/rad;
      float arms = 0.5 + 0.5*sin(2.0*a - hs*7.0*log(x + 0.03));   // 两条对数螺线臂；旋向按半球
      cyc = max(cyc, I*(1.0 - sstep(0.55, 1.0, x))*mix(1.0, arms, sstep(0.12, 0.35, x)));
    }
  }
  // 锋面：一条波状线，沿经度时断时续
  float mfr = 3.0 + floor(4.0*wH01(k, 8)), psi = 6.2831853*wH01(k, 9) + mod(0.02*T*(wH01(k, 10) - 0.5), 6.2831853);
  float yf = yc + 0.4*hw*sin(mfr*phb + psi);
  float along = sstep(-0.3, 0.6, (texture(uNoise3, vec3(cos(phb)*0.8, float(k)*0.053 + mod(0.5*T*EVOLVE, 1.0), sin(phb)*0.8)).r - R_MU)/R_SD);
  float front = exp(-sq((m.y - yf)/FRONT_W))*along;
  float pr = bz + A_BAND*sin(JET_N*PI*m.y) + A_CYC*cyc + A_FRONT*front;
  return vec3(pr, cyc, front);
}

void main(){
  vec2 uv = gl_FragCoord.xy/vec2(1024.0, 512.0);
  float ph = uv.x*2.0*PI, y = uv.y*2.0 - 1.0, r = sqrt(max(1.0 - y*y, 0.0));
  vec3 n = vec3(r*cos(ph), y, r*sin(ph));                         // 地固系单位方向
  float T = uBakeTime;
  // 所在的带与带边交叉淡化
  float vb = (y + 1.0)*JET_N; int k = int(clamp(floor(vb), 0.0, 2.0*JET_N - 1.0)); float f = vb - float(k);
  int k2 = k; float wb = 0.0;
  if (f < JET_BLEND && k > 0){ k2 = k - 1; wb = 0.5*(1.0 - f/JET_BLEND); }
  else if (f > 1.0 - JET_BLEND && k < int(2.0*JET_N) - 1){ k2 = k + 1; wb = 0.5*(1.0 - (1.0 - f)/JET_BLEND); }
  wb = sstep(0.0, 1.0, wb);
  vec3 pa = bandPattern(n, k, T);
  if (wb > 0.0) pa = mix(pa, bandPattern(n, k2, T), wb);
  float u = 1.0/(1.0 + exp(-1.7*(pa.x - PR_MU)/PR_SD));
  float C = clamp(uCloudCov, 0.0, 1.0);
  float cov = sstep(1.0 - C - RAMP, 1.0 - C + RAMP, u)*sat(C/0.03);
  cov = max(cov, sat((C - 0.97)/0.03));
  // 类型：低频噪声；轻域偏层云，平域夏季偏积云；气旋、锋面里是成片的层状云
  float gz = uGEq*r, light = 1.0 - sstep(uGLight - 0.05, uGLight + 0.05, gz), heavy = sstep(uGHeavy - 0.05, uGHeavy + 0.05, gz);
  float summer = sat(0.5 + 0.5*(y/(abs(y) + 0.05))*uSunW.y/(0.5*uR));   // 此半球的夏：日在本半球一侧（夏至日在塔根一侧 y＜0，塔根半球是夏）
  float tn = (texture(uNoise3, n*0.9 + 0.5).g - 0.4)/0.19;
  float typ = sat(0.5 + 0.22*tn - 0.35*light + 0.3*(1.0 - light - heavy)*(summer - 0.4) + 0.1*heavy - 0.5*pa.y - 0.35*pa.z
                - 0.45*sstep(0.7, 1.0, cov));                     // 满覆盖的地方多是成片的层积云
  float thick = clamp(1.0 + 0.4*(texture(uNoise3, n*2.1 + 0.3).b - 0.4)/0.19 + 0.25*pa.y, 0.6, 1.4);
  float prec = sstep(0.55, 0.9, cov)*(1.0 - typ) + sstep(0.75, 0.95, cov)*typ*sstep(1.1, 1.35, thick);
  oc = vec4(cov, typ, (thick - 0.6)/0.8, sat(prec));
}
