// eye_taa.frag：TAA（W×H，乒乓），拼在 post_common 之后。M6 人眼与画质（fp/eye.js 用 addDefs 把 DEFS.taa 的主文件改指这里）。
// 规格：02 第十四节第 1 条（按距离重投影、YCoCg 3×3 方差裁剪、α＝max(1/n, α_min)、快进按模拟时间衰减、拍照累积），另有改正：
//  1. 历史取样位置扣“本帧”的抖动。本帧像素 p 的样本取在 p＋J（J＝uJitter），历史纹素 q 存的是像素 q 中心的累积值，
//     所以历史位置＝上一帧投影(X)−J。02 原式扣的是上一帧抖动：静止相机也每帧把历史挪 J−J′ 再双线性取样，越积越糊（实测锐度只剩 0.4–0.6）。
//  2. 方差裁剪的邻域另加一圈步长 1/NEAR_SCALE 的样本（近段只有 1/4 或 1/2 分辨率，它的噪声在全分辨率 3×3 里几乎一样，
//     被当成信号锁住，云与空气的颗粒收不掉）。静止时全权并进；转头、行走时也并进六成（问题单 9：原先运动时只剩 3×3，
//     近段一个纹素里方差约为零，历史被夹回带噪声的当前值，近段抖动的斜纹原样露出）。
//  3. 拍照累积逐像素计数：n 存在历史 a 通道的整数部分。静止时 n 每帧加一、α＝1/n，起点接着运动时的等效样本数 1/uBlend；
//     到 TAA_ACCUM（低 8、中 16、高与拍照 64）时“累积满”（出图），之后继续数到 256（问题单 13：原先停在 TAA_ACCUM 成了指数平均，
//     残余噪声只降到原始的 0.18 倍，云在静止画面里一直蠕动；开销不变）。静止时裁剪放宽到 1.5σ。
//  4. 历史存 32 位浮点（tTAA 为 'f32lin'）。16F 只有 11 位有效数字，α≤0.1 时舍入一边倒。
//  5. 历史的 a 通道小数部分存本像素的视线距离（对数编码，32F 下相对精度 0.05%）。近处（60 m 以内）重投影后距离对不上 3% 的像素
//     ——风里摆动的草叶、走动时露出来的地面——不用历史，改用按距离加权的 3×3 帐篷滤波（问题单 1：实例层没有运动矢量，
//     摆动的叶片被历史抹成半透明、叶尖拖重影）。没有 32 位浮点线性过滤的设备 TAA_DEPTH＝0：不比距离，n 上限 64。
//  6. 下雨、余息飘尘时（眼 pass 纹素 3 的 y，上一帧）帧图给 α＝0.1，不做拍照累积；相机与时间都不动时，这里照样累积到 32，
//     只是亮起来的像素（雨丝刚落到这里）当帧直接用当前值、暗下去的（雨丝刚走）历史只留三帧（问题单 3：原先雨天只平均约 10 帧，
//     近段抖动的斜条网纹一直在，雨丝也被历史拖出长尾）。
//  7. 历史的 Catmull–Rom 夹到最近 2×2 纹素的最小、最大值之间（问题单 11：日面是天空的 10⁴ 倍，负旁瓣成了黑圈、彩圈，
//     日面附近的裁剪框又极宽，暗圈在历史里留得住）。静止时历史位置正落在纹素中心，五点退化成原值。
// “静止”由 uBlend 判断：passes 在相机与时间都不动时给 max(1/taaN, 1/accum)，运动时不小于 0.1（02 的 α_min）——
//   所以 uBlend＜0.1 或正好等于 1/TAA_ACCUM（低档 1/8＞0.1）都是静止。
#ifndef NEAR_SCALE
#define NEAR_SCALE 0.25
#endif
#ifndef TAA_ACCUM
#define TAA_ACCUM 16.0
#endif
#ifndef TAA_DEPTH
#define TAA_DEPTH 1
#endif
#if TAA_DEPTH == 1
#define TAA_NMAX 256.0
#else
#define TAA_NMAX 64.0
#endif
#define TAA_NRAIN 32.0
#define NEAR_KM 0.06
uniform sampler2D uCur, uHist;
uniform vec3 uPrevPos; uniform mat3 uPrevBasisT;                   // 上一帧相机（本帧 CM 系）
uniform vec3 uCamFwd, uCamRight, uCamUp; uniform float uTanHalfFov;
uniform vec2 uRes, uJitter, uPrevJitter; uniform float uExpoRatio, uBlend;   // uPrevJitter：契约里保留，历史取样已不用它（见改正 1）
uniform sampler2D uEye, uEyePrev;                                  // 本帧合成用的眼状态（纹素 3：上一帧的模拟秒步长、雨丝）／上一帧合成用的
vec3 toY(vec3 c){ return vec3(0.25*c.r + 0.5*c.g + 0.25*c.b, 0.5*c.r - 0.5*c.b, -0.25*c.r + 0.5*c.g - 0.25*c.b); }
vec3 fromY(vec3 y){ return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
vec4 curAt(ivec2 p){ return texelFetch(uCur, clamp(p, ivec2(0), ivec2(uRes) - 1), 0); }
vec3 curY(ivec2 p){ return toY(curAt(p).rgb); }
float dCode(float dkm){ return clamp(log2(1.0 + max(dkm, 0.0)*1000.0)/26.0, 1e-3, 0.999); }
float dDecode(float code){ return (exp2(code*26.0) - 1.0)/1000.0; }
float packA(float n, float dkm){
#if TAA_DEPTH == 1
  return floor(n + 0.5) + dCode(dkm);
#else
  return n;
#endif
}
vec3 histCR(vec2 uv){                                               // Catmull–Rom 五点，夹到最近 2×2 纹素（反振铃）
  vec2 sz = vec2(textureSize(uHist, 0)), p = uv*sz - 0.5, f = fract(p), c = floor(p) + 0.5;
  vec2 w0 = f*(-0.5 + f*(1.0 - 0.5*f)), w1 = 1.0 + f*f*(-2.5 + 1.5*f), w2 = f*(0.5 + f*(2.0 - 1.5*f)), w3 = f*f*(-0.5 + 0.5*f);
  vec2 w12 = w1 + w2, o12 = (c + w2/w12)/sz, o0 = (c - 1.0)/sz, o3 = (c + 2.0)/sz;
  vec3 r = texture(uHist, vec2(o12.x, o0.y)).rgb*w12.x*w0.y + texture(uHist, vec2(o0.x, o12.y)).rgb*w0.x*w12.y + texture(uHist, o12).rgb*w12.x*w12.y
         + texture(uHist, vec2(o3.x, o12.y)).rgb*w3.x*w12.y + texture(uHist, vec2(o12.x, o3.y)).rgb*w12.x*w3.y;
  r /= w12.x*w0.y + w0.x*w12.y + w12.x*w12.y + w3.x*w12.y + w12.x*w3.y;
  ivec2 b = ivec2(floor(p)), mx = ivec2(sz) - 1;
  vec3 a0 = texelFetch(uHist, clamp(b, ivec2(0), mx), 0).rgb, a1 = texelFetch(uHist, clamp(b + ivec2(1, 0), ivec2(0), mx), 0).rgb;
  vec3 a2 = texelFetch(uHist, clamp(b + ivec2(0, 1), ivec2(0), mx), 0).rgb, a3 = texelFetch(uHist, clamp(b + ivec2(1, 1), ivec2(0), mx), 0).rgb;
  return max(clamp(r, min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3))), 0.0);
}
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy); vec4 c = texelFetch(uCur, ip, 0);
  // 重投影：本帧（带抖动的）视线距离 → 上一帧相机系 → 扣本帧抖动
  vec2 ndc = (2.0*(gl_FragCoord.xy + uJitter) - uRes)/uRes.y;
  vec3 d = normalize(uCamFwd + uTanHalfFov*(ndc.x*uCamRight + ndc.y*uCamUp));
  vec3 q = uPrevBasisT*(d*c.a - uPrevPos);                          // 上一帧相机系（x 右、y 上、z 前）
  vec2 pp = (q.xy/max(q.z*uTanHalfFov, 1e-6))*uRes.y*0.5 + uRes*0.5 - uJitter;
  vec2 uvp = pp/uRes;
  bool ok = q.z > 0.0 && all(greaterThan(uvp, vec2(0.0))) && all(lessThan(uvp, vec2(1.0))) && uBlend < 0.999;
  if (!ok){ fragColor = vec4(max(c.rgb, 0.0), packA(1.0, c.a)); return; }   // 重置后第一帧、出画：只用当前，n＝1
  float mv = length(pp - gl_FragCoord.xy);                          // 重投影位移（像素，已不含抖动）
  vec4 fl = texelFetch(uEye, ivec2(3, 0), 0);                       // 上一帧：x 模拟秒步长，y 雨丝／飘尘在画
  bool still0 = uBlend < 0.0999 || abs(uBlend - 1.0/TAA_ACCUM) < 1e-5;   // 低档 TAA_ACCUM＝8：静止时 uBlend＝1/8，比运动的 0.1 还大
  bool rainStill = !still0 && fl.y > 0.5 && fl.x <= 0.0 && abs(uBlend - 0.1) < 1e-4 && mv < 0.05;
  bool still = still0 || rainStill;
  float ha = texelFetch(uHist, clamp(ivec2(floor(pp)), ivec2(0), ivec2(uRes) - 1), 0).a;
  // 逐像素等效样本数
  float n = still ? min(max(floor(ha), 1.0) + 1.0, rainStill ? TAA_NRAIN : TAA_NMAX) : 1.0/max(uBlend, 1e-3);
  // 近处的距离对不上：摆动的草叶、露出来的地面——不用历史
  bool moved = false;
#if TAA_DEPTH == 1
  float code = ha - floor(ha);
  if (code > 2e-3){
    float dh = dDecode(code), dq = length(q);
    moved = min(dq, dh) < NEAR_KM && abs(log(max(dq, 1e-6)/max(dh, 1e-6))) > 0.03;
  }
#endif
  if (moved){
    vec3 acc = vec3(0.0); float ws = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec4 s = curAt(ip + ivec2(i, j));
      float w = (i == 0 ? 2.0 : 1.0)*(j == 0 ? 2.0 : 1.0)*(abs(log(max(s.a, 1e-6)/max(c.a, 1e-6))) < 0.03 ? 1.0 : 0.0);
      acc += w*s.rgb; ws += w;
    }
    fragColor = vec4(max(acc/max(ws, 1e-6), 0.0), packA(1.0, c.a));
    return;
  }
  // 3×3 邻域（全分辨率）
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec3 s = curY(ip + ivec2(i, j)); m1 += s; m2 += s*s; }
  vec3 cen = m1/9.0, vr = max(m2/9.0 - cen*cen, 0.0);
  // 外圈 8 个（步长＝近段纹素宽）：静止全权并进，运动时六成
  float wc = 1.0 - 0.4*smoothstep(0.5, 2.0, mv);
  {
    int S = int(1.0/NEAR_SCALE + 0.5);
    vec3 n1 = m1, n2 = m2;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      if (i == 0 && j == 0) continue;
      vec3 s = curY(ip + ivec2(i, j)*S); n1 += s; n2 += s*s;
    }
    n1 /= 17.0; n2 /= 17.0;
    vr += wc*max(n2 - n1*n1, 0.0);
    cen = mix(cen, n1, 0.5*wc);
  }
  vec3 box = (still ? 1.5 : 1.25)*sqrt(vr);
  float er = uExpoRatio*texelFetch(uEye, ivec2(0), 0).x/max(texelFetch(uEyePrev, ivec2(0), 0).x, 1e-30);
  vec3 h = clamp(toY(histCR(uvp)*er), cen - box, cen + box), cy = toY(c.rgb);
  if (rainStill){                                                   // 雨丝：来了当帧就亮，走了历史只留三帧
    float dy = cy.x - h.x, th = max(3.0*sqrt(vr.x), 0.05*max(h.x, 0.0));
    if (dy > th) n = 1.0; else if (-dy > th) n = min(n, 3.0);
  }
  fragColor = vec4(max(fromY(mix(h, cy, 1.0/n)), 0.0), packA(n, c.a));
}
