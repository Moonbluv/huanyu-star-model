// =====================================================================================
//  后处理三件：SH9 投影（sh）、自动曝光（expo）、色调映射（final）。各自以 #define PASS_* 编译。
// =====================================================================================
precision highp float;
precision highp int;
precision highp sampler2D;
#define PI 3.14159265359
layout(location = 0) out vec4 fragColor;

#ifdef PASS_SH
// 9×1：每个像素是一个 SH 系数，遍历 32×16 探针（世界系方向，立体角加权）
uniform sampler2D uProbe;
float Y9(int i, vec3 n) {
  if (i == 0) return 0.282095;
  if (i == 1) return 0.488603 * n.y;
  if (i == 2) return 0.488603 * n.z;
  if (i == 3) return 0.488603 * n.x;
  if (i == 4) return 1.092548 * n.x * n.y;
  if (i == 5) return 1.092548 * n.y * n.z;
  if (i == 6) return 0.315392 * (3.0 * n.z * n.z - 1.0);
  if (i == 7) return 1.092548 * n.x * n.z;
  return 0.546274 * (n.x * n.x - n.y * n.y);
}
void main() {
  int k = int(gl_FragCoord.x);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 16; j++) for (int i = 0; i < 32; i++) {
    float th = (float(j) + 0.5) / 16.0 * PI, ph = (float(i) + 0.5) / 32.0 * 2.0 * PI;
    vec3 d = vec3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
    float dOm = (2.0 * PI / 32.0) * (PI / 16.0) * sin(th);
    acc += texelFetch(uProbe, ivec2(i, j), 0).rgb * Y9(k, d) * dOm;
  }
  fragColor = vec4(acc, 1.0);
}
#endif

#ifdef PASS_EXPO
// 1×1：中心加权测光（人眼注视点）→ 对数平均亮度 → 目标曝光；亮→暗慢、暗→亮快；适应下限让夜晚仍然是夜晚
uniform sampler2D uHDR;       // 预曝光的 HDR
uniform sampler2D uPrev;      // 上一帧 (曝光, 适应亮度)
uniform float uDt, uEV, uAdaptMin, uAdaptMax, uLock, uLockEV;
void main() {
  vec2 prev = texelFetch(uPrev, ivec2(0), 0).xy;
  float expoPrev = max(prev.x, 1e-9);
  float sw = 0.0, sl = 0.0;
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) {
    vec2 uv = (vec2(i, j) + 0.5) / 16.0;
    vec3 c = textureLod(uHDR, uv, 0.0).rgb / expoPrev;
    float w = exp(-6.0 * dot(uv - 0.5, uv - 0.5));
    sl += w * log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
    sw += w;
  }
  float La = clamp(exp(sl / sw), uAdaptMin, uAdaptMax);
  float Lprev = prev.y > 0.0 ? prev.y : La;
  float tau = La > Lprev ? 0.6 : 3.0;                       // 秒
  float Lnew = exp(mix(log(Lprev), log(La), 1.0 - exp(-uDt / tau)));
  // 人眼式 key：适应亮度 ≥100 cd/m² 时按中灰 0.18；更暗时 key 随之下降（暗处仍然显得暗，不被拉成白天）
  float key = 0.18 * pow(clamp(Lnew / 100.0, 1e-5, 1.0), 0.2);
  float expo = key / Lnew * exp2(uEV);
  if (uLock > 0.5) expo = exp2(-uLockEV) / 1.2;              // 固定 EV：看绝对明暗
  fragColor = vec4(expo, Lnew, 0.0, 1.0);
}
#endif

#ifdef PASS_TAA
// 时域累积（渲染分辨率）：按本帧命中距离把像素重投影到上一帧，邻域方差裁剪防拖影；
// 相机静止且时间不走时 uBlend = 1/n 逐帧收敛（“拍照模式”）
uniform sampler2D uCur, uHist;
uniform vec3 uPrevPos;          // 上一帧相机位置 − 本帧相机位置（km，CPU 双精度相减）
uniform mat3 uPrevBasisT;       // 上一帧相机基的转置：世界 → (右, 上, 前)
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform float uTanHalfFov, uExpoRatio, uBlend;
uniform vec2 uRes, uJitter;
vec3 toY(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromY(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uCur, ip, 0);
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 s = toY(texelFetch(uCur, clamp(ip + ivec2(i, j), ivec2(0), ivec2(uRes) - 1), 0).rgb);
    m1 += s; m2 += s * s;
  }
  m1 /= 9.0; m2 /= 9.0;
  vec3 sig = sqrt(max(m2 - m1 * m1, 0.0));
  vec2 ndc = (2.0 * (gl_FragCoord.xy + uJitter) - uRes) / uRes.y;
  vec3 d = normalize(uCamFwd + uTanHalfFov * (ndc.x * uCamRight + ndc.y * uCamUp));
  vec3 q = uPrevBasisT * (d * c.a - uPrevPos);
  vec2 pn = q.xy / max(q.z * uTanHalfFov, 1e-6);
  vec2 uvp = (pn * uRes.y + uRes) * 0.5 / uRes;
  bool ok = q.z > 0.0 && all(greaterThan(uvp, vec2(0.0))) && all(lessThan(uvp, vec2(1.0)));
  vec3 h = clamp(toY(texture(uHist, uvp).rgb * uExpoRatio), m1 - 1.25 * sig, m1 + 1.25 * sig);
  vec3 y = ok ? mix(h, toY(c.rgb), uBlend) : toY(c.rgb);
  fragColor = vec4(max(fromY(y), 0.0), c.a);
}
#endif

#ifdef PASS_BLOOM_DOWN
// 眩光金字塔下采样（Jimenez 13 点），第一级做亮度软阈并按 Karis 平均抑制萤火
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;          // 源纹理的 1/尺寸
uniform float uFirst;
vec3 kw(vec3 c) { return uFirst > 0.5 ? c / (1.0 + max(c.r, max(c.g, c.b))) : c; }
void main() {
  vec2 uv = gl_FragCoord.xy * 2.0 * uSrcTexel;
  vec2 t = uSrcTexel;
  vec3 a = texture(uSrc, uv + t * vec2(-2, -2)).rgb, b = texture(uSrc, uv + t * vec2(0, -2)).rgb, c = texture(uSrc, uv + t * vec2(2, -2)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2, 0)).rgb, e = texture(uSrc, uv).rgb, f = texture(uSrc, uv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2, 2)).rgb, h = texture(uSrc, uv + t * vec2(0, 2)).rgb, i = texture(uSrc, uv + t * vec2(2, 2)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1, -1)).rgb, k = texture(uSrc, uv + t * vec2(1, -1)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1, 1)).rgb, m = texture(uSrc, uv + t * vec2(1, 1)).rgb;
  vec3 o = kw((j + k + l + m) * 0.25) * 0.5 + kw((a + b + d + e) * 0.25) * 0.125 + kw((b + c + e + f) * 0.25) * 0.125
         + kw((d + e + g + h) * 0.25) * 0.125 + kw((e + f + h + i) * 0.25) * 0.125;
  fragColor = vec4(o, 1.0);
}
#endif

#ifdef PASS_BLOOM_UP
// 上采样 3×3 帐篷并与本级相加；越大的级权重按 1/θ² 式衰减（人眼散射的点扩散函数）
uniform sampler2D uSrc, uBase;
uniform vec2 uSrcTexel;
uniform float uW;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uBase, 0));
  vec2 t = uSrcTexel;
  vec3 s = texture(uSrc, uv + t * vec2(-1, -1)).rgb + 2.0 * texture(uSrc, uv + t * vec2(0, -1)).rgb + texture(uSrc, uv + t * vec2(1, -1)).rgb
         + 2.0 * texture(uSrc, uv + t * vec2(-1, 0)).rgb + 4.0 * texture(uSrc, uv).rgb + 2.0 * texture(uSrc, uv + t * vec2(1, 0)).rgb
         + texture(uSrc, uv + t * vec2(-1, 1)).rgb + 2.0 * texture(uSrc, uv + t * vec2(0, 1)).rgb + texture(uSrc, uv + t * vec2(1, 1)).rgb;
  fragColor = vec4(texture(uBase, uv).rgb + uW * s / 16.0, 1.0);
}
#endif

#ifdef PASS_FINAL
// 全分辨率：辉光叠加 → 中间视觉（Purkinje：暗处向视杆细胞过渡，去饱和、偏蓝）→ AgX → sRGB → 抖动
uniform sampler2D uHDR;
uniform sampler2D uBloom;
uniform sampler2D uExpo;
uniform vec2 uOutRes;
uniform float uBloomK, uPurkinje;
vec3 agx(vec3 c) {
  const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                        0.0784335999999992, 0.878468636469772, 0.0784336,
                        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                         -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                         -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = inM * max(c, vec3(1e-10));
  c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 x2 = c * c, x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  c = outM * c;
  return pow(max(c, 0.0), vec3(2.2));                       // AgX 输出是显示编码，这里回到线性再统一编码
}
// Catmull–Rom 五点双三次：从渲染分辨率放大到屏幕分辨率
vec3 bicubic(sampler2D t, vec2 uv) {
  vec2 sz = vec2(textureSize(t, 0)), p = uv * sz - 0.5, f = fract(p), c = floor(p) + 0.5;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, o12 = c + w2 / w12, o0 = c - 1.0, o3 = c + 2.0;
  o0 /= sz; o3 /= sz; o12 /= sz;
  vec3 r = (texture(t, vec2(o12.x, o0.y)).rgb * w12.x * w0.y)
         + (texture(t, vec2(o0.x, o12.y)).rgb * w0.x * w12.y + texture(t, o12).rgb * w12.x * w12.y + texture(t, vec2(o3.x, o12.y)).rgb * w3.x * w12.y)
         + (texture(t, vec2(o12.x, o3.y)).rgb * w12.x * w3.y);
  return max(r / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y), 0.0);
}
vec3 toSRGB(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 c = bicubic(uHDR, uv);
  c += uBloomK * texture(uBloom, uv).rgb;
  vec2 ex = texelFetch(uExpo, ivec2(0), 0).xy;
  // 中间视觉：按“适应亮度”（cd/m²）在 0.003～3 之间对数插值
  float s = uPurkinje * (1.0 - smoothstep(log(0.003), log(3.0), log(max(ex.y, 1e-6))));
  if (s > 0.0) {
    mat3 toXYZ = mat3(0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505);
    vec3 xyz = toXYZ * c;
    float V = max(xyz.y * (1.33 * (1.0 + (xyz.y + xyz.z) / max(xyz.x, 1e-6)) - 1.68), 0.0);   // Jensen 2000 视杆亮度
    c = mix(c, V * vec3(0.82, 0.92, 1.15) * 0.75, s * 0.85);
  }
  vec3 o = toSRGB(agx(c));
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(o + (n - 0.5) / 255.0, 1.0);
}
#endif
