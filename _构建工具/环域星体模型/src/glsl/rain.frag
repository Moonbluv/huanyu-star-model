// rain.frag：近处的雨丝与余息（带白灰的风），拼在 post_common 之后（02 第十节第 5 条、第七节第 9 条）。负责：M5（云与设定）。
// 以加法混合叠到 tHDR（只加 rgb，alpha 里的视线距离不动）。全分辨率，与合成同一组抖动视线。
// 粒子不贴在屏幕上：每一层是绕重力轴、半径 D 的圆柱面（离人 D 米），视线落在圆柱上的“方位弧长 u、高度 v”就是图样坐标，
//   所以转头时雨丝、灰片留在世界里，抬头时雨丝按透视汇向天顶。比地形近处（tSurf.a）更远的层被挡住。
// 雨（clouds 路 2026-10-14 改，问题单第 17、21 条）：哪里下看云影图——cloud_shadow 在每块地面上记了雨量（头顶有降水的云才下，
//   阵雨、雨带时大时小，罪域云缝里不下），这里取相机脚下那一格 × 雨量滑杆（uRainBeta／默认 0.03），不再只看“离罪域中心多远”。
//   uRainK.x（settings.rainK）只剩“罪域里帧图不做累积”的旧用途。雨丝沿重力“下”落，被阵风吹斜（斜度随时间摆），亮度取当地天光
//   （探针行 0 平均），与背后的表面亮度相减才是看得见的那一点（天空前的雨丝几乎看不出来）。低档只画两层。
// 余息（uRainK.y＝0–1）：入冬前从塔根往外（向南、往下坡）刮的冷风，带着白色细灰——
//   ① 灰片：四层圆柱上的小白片，顺风横飞、微微下沉，按风向在圆柱上的切向分量移动，阵风时成团；
//   ② 灰幕：视线前 150 m 里取 4 个三维值噪声样本，噪声随风平移，成一缕缕发白的风痕（只能加亮：把比灰暗的背景往灰白拉）。
uniform sampler2D uSH, uExpTex, uSurf;
uniform vec4 uRainK;                  // x 雨（0–2），y 余息（0–1），z 真实秒（按 3600 取模），w 未用
uniform vec2 uRes, uJitter;
uniform vec3 uCamFwd, uCamRight, uCamUp;
uniform float uTanHalfFov;
uniform sampler2D uCloudSh; uniform vec3 uCsInfo; uniform float uRainBeta;   // 云影图（a＝落到地面的雨量）、雨量滑杆
#if defined(Q_NEAR_N) && Q_NEAR_N < 10
#define RAIN_LAYERS 2
#else
#define RAIN_LAYERS 4
#endif
float rainHere(){                                                  // 相机脚下的雨量（common.glsl csFetch 的同式，CS_WARP＝5）
  if (uRainBeta <= 0.0) return 0.0;
  vec2 q = clamp(-uCsInfo.xy/max(uCsInfo.z, 1e-3), vec2(-1.0), vec2(1.0));
  vec2 u = q*6.0/(1.0 + 5.0*abs(q))*0.5 + 0.5;
  vec4 c = textureLod(uCloudSh, u, 0.0);
  return c.r < 0.0 ? 0.0 : max(c.a, 0.0)*uRainBeta/0.03;
}
uint rHsh(uvec3 v){ v = v*1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; v ^= v >> 16u; return v.x + v.y*v.z; }
float h01(ivec3 p){ return float(rHsh(uvec3(p + 1048576)) >> 8u)/16777216.0; }   // 先挪到正数再转 uint
float sat1(float x){ return clamp(x, 0.0, 1.0); }
// 相机处：重力“上”U、北 N（朝塔根）、东 E（CM 系，02 第三节第 1 条）；余息的风朝南（远离塔根）
const vec3 U_UP = vec3(-1.0, 0.0, 0.0), N_N = vec3(0.0, -1.0, 0.0), E_E = vec3(0.0, 0.0, -1.0);
void main(){
  vec2 fc = gl_FragCoord.xy;
  float expo = texelFetch(uExpTex, ivec2(0), 0).x;
  vec3 sky = max(texelFetch(uSH, ivec2(0, 0), 0).rgb*0.2820948, vec3(0.0));   // 行 0 平均辐亮度（kn）
  vec4 surf = texelFetch(uSurf, ivec2(fc), 0);
  float tS = surf.a > 0.0 ? surf.a*1000.0 : 1e9;                   // 表面距离（米）
  vec3 Lbg = surf.a > 0.0 ? surf.rgb : sky;                        // 背后大致的亮度（表面不含雾；没有表面时按天空）
  float t = uRainK.z;
  vec2 ndc = (2.0*(fc + uJitter) - uRes)/uRes.y;
  vec3 d = normalize(uCamFwd + uTanHalfFov*(ndc.x*uCamRight + ndc.y*uCamUp));
  float pixA = 2.0*uTanHalfFov/uRes.y;                            // 一个像素的张角（rad）
  float dv = dot(d, U_UP), hl = max(length(d - U_UP*dv), 1e-3);
  float az = atan(dot(d, E_E), dot(d, N_N));                       // 方位：北起向东
  vec3 acc = vec3(0.0);
  // ---------- 雨丝 ----------
  float rk = min(rainHere(), 2.0);
  if (rk > 0.02){
    float tilt = 0.14 + 0.09*sin(t*0.23) + 0.05*sin(t*0.71 + 2.0);  // 阵风：斜度在 0–0.28 之间摆
    for (int i = 0; i < RAIN_LAYERS; i++){
      float fi = float(i), D = 1.6*pow(2.3, fi);                    // 1.6、3.7、8.5、19.5 米
      float tr = D/hl; if (tr > tS || tr > 80.0) continue;         // 被近处地物挡住；太陡的视线（抬头、低头）不画远层
      float u = az*D, v = dv*tr;                                   // 圆柱上的弧长、高度（米）
      float cw = 0.05*D, spd = 7.5 + 1.5*h01(ivec3(i, 3, 1));       // 列宽随层放大（每层的角密度相近）；落速 7.5–9 m/s
      float up = u - tilt*v, vp = v + spd*t;                      // 被风吹斜；图样随时间向下走
      float col = floor(up/cw), h = h01(ivec3(int(col), i, 7));
      float xc = (fract(up/cw) - (0.15 + 0.7*h))*cw;               // 离雨丝中线（米）
      float per = 0.9 + 0.8*h, L = 0.22 + 0.12*h;                  // 每列一滴的间隔、拖影长（米）
      float y = vp/per + 13.7*h, cell = floor(y), f = fract(y)*per;
      float on = step(h01(ivec3(int(col), int(cell), i + 11)), 0.3*rk);
      float wpx = pixA*tr;                                         // 一个像素在这一层上是多宽（米）
      float wid = max(0.0018, 0.7*wpx);
      float across = 1.0 - smoothstep(0.3*wid, wid, abs(xc));
      float along = smoothstep(0.0, 0.25*L, f)*(1.0 - smoothstep(0.6*L, L, f));
      float cov = min(0.0025/wid, 0.6);                            // 雨滴直径约 2.5 mm：远层的雨丝只盖住像素的一小部分
      acc += on*across*along*cov*0.7*max(sky*1.05 - Lbg, 0.1*sky);
    }
  }
  // ---------- 余息：白灰的风 ----------
  if (uRainK.y > 0.001){
    float yk = uRainK.y;
    // 风：向南（远离塔根）8 m/s 上下，阵风按 9 s、23 s 两个周期起伏
    float gust = 0.75 + 0.25*sin(t*0.7) + 0.2*sin(t*0.27 + 1.3);
    float W = 8.0*gust, Wp = 8.0*(0.75*t - (0.25/0.7)*cos(t*0.7) - (0.2/0.27)*cos(t*0.27 + 1.3));   // 风速、风走过的路（风速对时间的积分）
    vec3 ashL = sky*1.15;                                          // 白灰：比平均天光略亮
    // ① 灰片（四层）：一厘米上下的白片，顺风横飞、微微下沉；人眼约 1/120 s 的拖影
    float azW = 3.14159265;                                        // 风去的方位：正南
    for (int i = 0; i < 4; i++){
      float fi = float(i), D = 2.0*pow(2.2, fi);                    // 2、4.4、9.7、21 米
      float tr = D/hl; if (tr > tS || tr > 60.0) continue;
      float u = az*D, v = dv*tr;
      float sa = sin(az - azW), vt = W*sa;                         // 风在圆柱切向上的分量：迎着风看和顺着风看时几乎不横移
      float up = u + Wp*sa + 0.4*sin(t*1.7 + fi), vp = v + (0.5 + 0.3*fi)*t;   // 横飞＋微微下沉
      float cs = 0.07*D;                                           // 胞的边长（米）
      vec2 q = vec2(up, vp)/cs, cid = floor(q), fq = fract(q);
      float h = h01(ivec3(ivec2(cid), 30 + i)), h2 = h01(ivec3(ivec2(cid), 40 + i));
      float band = 0.5 + 0.5*sin(0.12*up/(1.0 + 0.1*fi) + 0.9*gust + 2.0*h);   // 阵风时成团
      float on = step(h01(ivec3(ivec2(cid), 50 + i)), (0.4 + 0.4*band)*yk);
      vec2 c = vec2(h, h2)*0.7 + 0.15;
      float wpx = pixA*tr, sz = max(0.02, 1.2*wpx);               // 灰片一两厘米（原先 1.2 cm，静帧里只有一两个像素）
      float bl = 1.0 + (abs(vt)/120.0)/sz;                          // 顺风方向的拖影：拉长 bl 倍，亮度摊薄
      vec2 dd = (fq - c)*cs; dd.x /= bl;
      float cov = min(0.02/sz, 0.85)/bl;
      acc += on*(1.0 - smoothstep(0.4*sz, sz, length(dd)))*cov*max(ashL - 0.6*Lbg, 0.25*ashL);
    }
    // ② 灰幕：视线前 150 m 里的灰。底子一直在（能见度两三公里），风痕里局地消光可到 5 /km，顺风拉长、随风向南走；
    //    只能加亮：按“背后比灰暗多少”把画面往灰白拉 (1−e^(−τ)) 那么多，天空前几乎不变
    float tauW = 0.0, tPrev = 0.0;
    for (int i = 0; i < 4; i++){
      float tt = 10.0*pow(2.2, float(i));                          // 10、22、48、106 米
      float t1 = min(tt*1.45, tS);
      if (tPrev >= t1) break;
      vec3 X = d*tt;                                               // 相对相机（米）
      vec3 Xw = X - vec3(0.0, Wp, 0.0) - U_UP*(0.3*t);             // 噪声随风向南平移、略下沉
      vec3 nq = vec3(dot(Xw, N_N)*0.012, dot(Xw, U_UP)*0.03, dot(Xw, E_E)*0.02);   // 顺风方向拉长
      vec3 fl = floor(nq), fq = fract(nq); fq = fq*fq*(3.0 - 2.0*fq);
      ivec3 b0 = ivec3(fl);
      float n000 = h01(b0), n100 = h01(b0 + ivec3(1, 0, 0)), n010 = h01(b0 + ivec3(0, 1, 0)), n110 = h01(b0 + ivec3(1, 1, 0));
      float n001 = h01(b0 + ivec3(0, 0, 1)), n101 = h01(b0 + ivec3(1, 0, 1)), n011 = h01(b0 + ivec3(0, 1, 1)), n111 = h01(b0 + ivec3(1, 1, 1));
      float nv = mix(mix(mix(n000, n100, fq.x), mix(n010, n110, fq.x), fq.y), mix(mix(n001, n101, fq.x), mix(n011, n111, fq.x), fq.y), fq.z);
      tauW += 0.005*(0.35 + 0.65*sat1((nv - 0.45)/0.35))*(t1 - tPrev);   // 底子 1.75 /km（能见度两三公里），风痕里到 5 /km（米 → km）
      tPrev = t1;
    }
    acc += max(ashL - Lbg, vec3(0.0))*(1.0 - exp(-tauW*yk*(0.6 + 0.4*gust)));   // 风一直在刮，阵风时更浓
  }
  fragColor = vec4(min(acc*expo, vec3(6.0e4)), 0.0);
}
