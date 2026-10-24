// final.frag：放大 → 局部适应 → 眩光 → 色适应 → 暗视 → AgX（加对比 look）→ sRGB → 抖动
// eye 路修订（2026-10-14 问题单 6、7、11、12、18、2）：
//  · 放大的 Catmull–Rom 夹到最近 2×2 纹素的最小、最大值之间（反振铃）：日面是天空的约 10⁴ 倍，负旁瓣按通道截断后成了黑圈、彩圈。
//  · 局部适应：眩光金字塔各级之和（uBloom 再取 3×3 宽样本）当局部平均亮度，比适应亮度 La 暗 d 时提 35%·d，最多 2 EV 的份
//    （人看暗处的草地会局部适应：草是绿的、叶和石块看得清；以 La 为轴，平视与低头时同一片地补得一样多。亮处不压：会在日面四周压出暗晕）。
//  · 失能眩光用到眼日光的实际颜色（eye 纹素 2：弦表透射、云、塔缘气层、露出部分的临边昏暗色），不再写死大气外日色；
//    望远时按眼看到的角度算（视角小于 70° 时 θ 乘放大倍数），不再铺满半个画面。
//  · 暗视：V 按白点归一（D65 白 V＝2.573·Y），中性灰明度大致不变；红变暗（浦肯野）、蓝变亮，整体略偏蓝、去饱和。
//  · AgX 接对比 look：对数编码以中灰为轴，中灰以上按 1.5 倍拉开、以下不动（平滑过渡），整体下移 0.03：中灰落在 sRGB 约 112，
//    中灰处对数斜率约 1.1（原 0.8），亮部更亮、更饱和，暗部不比原来更黑（夜里的红土仍看得见）；编码域饱和度 ×1.05。显示器暗、周围也暗时，要约 1.1–1.3 的系统伽马才像真实场景（Bartleson–Breneman）。
uniform sampler2D uHDR, uBloom, uEye, uEyePrev;
uniform vec2 uOutRes; uniform float uBloomK, uPurkinje, uGlareK;
uniform vec3 uSunDirScr; uniform vec3 uCamFwd, uCamRight, uCamUp; uniform float uTanHalfFov;
uniform mat3 uCAT;                                                  // CPU 由 eye pass 的照明色算出的 Bradford 矩阵（强度 0.7）
#ifndef BLOOM_LV
#define BLOOM_LV 5.0
#endif
#define AGX_KL 1.0
#define AGX_KH 1.5
#define AGX_D 0.03
#define AGX_SAT 1.05
#define LOC_W 0.35
#define LOC_EV 2.0
vec3 agx(vec3 c){
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = (log2(inM*max(c, vec3(1e-10))) + 12.47393)/16.5;
  vec3 kc = mix(vec3(AGX_KL), vec3(AGX_KH), smoothstep(0.48606061, 0.72606061, c));   // 对比 look：中灰（10/16.5）以上拉开 1.5 倍，以下不动（暗部不再更黑）
  c = clamp(0.60606061 + (c - 0.60606061)*kc - AGX_D, 0.0, 1.0);
  vec3 x2 = c*c, x4 = x2*x2;
  c = 15.5*x4*x2 - 40.14*x4*c + 31.96*x4 - 6.868*x2*c + 0.4298*x2 + 0.1191*c - 0.00232;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(y + AGX_SAT*(c - y), 0.0);
  return pow(max(outM*c, 0.0), vec3(2.2));
}
vec3 catmull(sampler2D t, vec2 uv){                                  // Catmull–Rom 五点，夹到最近 2×2 纹素（反振铃）
  vec2 sz = vec2(textureSize(t, 0)), p = uv*sz - 0.5, f = fract(p), c = floor(p) + 0.5;
  vec2 w0 = f*(-0.5 + f*(1.0 - 0.5*f)), w1 = 1.0 + f*f*(-2.5 + 1.5*f), w2 = f*(0.5 + f*(2.0 - 1.5*f)), w3 = f*f*(-0.5 + 0.5*f);
  vec2 w12 = w1 + w2, o12 = (c + w2/w12)/sz, o0 = (c - 1.0)/sz, o3 = (c + 2.0)/sz;
  vec3 r = texture(t, vec2(o12.x, o0.y)).rgb*w12.x*w0.y + texture(t, vec2(o0.x, o12.y)).rgb*w0.x*w12.y + texture(t, o12).rgb*w12.x*w12.y
         + texture(t, vec2(o3.x, o12.y)).rgb*w3.x*w12.y + texture(t, vec2(o12.x, o3.y)).rgb*w12.x*w3.y;
  r /= w12.x*w0.y + w0.x*w12.y + w12.x*w12.y + w3.x*w12.y + w12.x*w3.y;
  ivec2 b = ivec2(floor(p)), mx = ivec2(sz) - 1;
  vec3 a0 = texelFetch(t, clamp(b, ivec2(0), mx), 0).rgb, a1 = texelFetch(t, clamp(b + ivec2(1, 0), ivec2(0), mx), 0).rgb;
  vec3 a2 = texelFetch(t, clamp(b + ivec2(0, 1), ivec2(0), mx), 0).rgb, a3 = texelFetch(t, clamp(b + ivec2(1, 1), ivec2(0), mx), 0).rgb;
  return clamp(r, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
}
vec3 acesHill(vec3 c){                                               // ACES（Stephen Hill 拟合），设置里的对照项
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = inM*c; v = (v*(v + 0.0245786) - 0.000090537)/(v*(0.983729*v + 0.4329510) + 0.238081);
  return clamp(outM*v, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(12.92*c, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 uv = gl_FragCoord.xy/uOutRes;
  vec4 eN = texelFetch(uEye, ivec2(0), 0), eP = texelFetch(uEyePrev, ivec2(0), 0);
  vec4 eS = texelFetch(uEye, ivec2(2, 0), 0);
  float r = eN.x/eP.x;                                               // HDR 里乘的是旧曝光
  vec3 c = (catmull(uHDR, uv) + uBloomK*texture(uBloom, uv).rgb)*r;
  // 局部适应：金字塔各级之和 ÷ 级数＝低频亮度；再取 3×3 宽样本（约画面高的 4%）
  vec2 ro = vec2(0.04*uOutRes.y/uOutRes.x, 0.04);
  vec3 bl = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) bl += texture(uBloom, uv + vec2(float(i), float(j))*ro).rgb;
  float Lloc = max(dot(bl, vec3(0.2126, 0.7152, 0.0722))/(9.0*BLOOM_LV)*r/max(eN.x, 1e-30)*1000.0, 1e-6);   // cd/m²
  float dL = clamp(log(Lloc/max(eN.y, 1e-6)), -LOC_EV*0.6931472, 0.0);   // 以适应亮度为轴；只提暗处（压亮处会在日面、亮云四周压出一圈暗晕）
  c *= exp(-LOC_W*dL);
  // 失能眩光（Stiles–Holladay／CIE）：E 以 klux 计时 L 直接是 kn；颜色＝到眼日光的实际颜色
  vec2 ndc = (2.0*gl_FragCoord.xy - uOutRes)/uOutRes.y;
  vec3 d = normalize(uCamFwd + uTanHalfFov*(ndc.x*uCamRight + ndc.y*uCamUp));
  float M = max(1.0, 0.70021/max(uTanHalfFov, 1e-4));
  float th = max(degrees(2.0*asin(clamp(0.5*length(d - uSunDirScr), 0.0, 1.0)))*M, 0.3);
  c += uGlareK*10.0/(th*th)*(1.0 - smoothstep(20.0, 40.0, th))*eN.x*max(eS.rgb, 0.0);
  c = uCAT*c;                                                        // 照明色适应
  float s = uPurkinje*(1.0 - smoothstep(log(0.003), log(3.0), log(max(eN.y, 1e-6))));
  if (s > 0.0){
    vec3 xyz = mat3(0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505)*c;
    float V = max(xyz.y*(1.33*(1.0 + (xyz.y + xyz.z)/max(xyz.x, 1e-6)) - 1.68), 0.0)/2.573;   // 按白点归一：V(白)＝Y
    c = mix(c, V*vec3(0.82, 0.92, 1.15)*0.93, s*0.85);              // (0.82, 0.92, 1.15)·0.93 的亮度≈0.85：暗视下整体略暗
  }
  float n = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
#ifdef TONE_ACES
  fragColor = vec4(toSRGB(acesHill(c)) + (n - 0.5)/255.0, 1.0);
#else
  fragColor = vec4(toSRGB(agx(c)) + (n - 0.5)/255.0, 1.0);
#endif
}
