// meter.frag：测光 64×32，拼在 post_common 之后（02 第十四节第 2 条）
// 每格从 TAA 结果取 4 个双线性样本，除以本帧合成用的曝光换回绝对亮度（cd/m²），取对数；
// 每个样本截到上一帧适应亮度 ±5 EV；中心加权（注视点）；日面周围约 1° 不进测光（评审 2 第 7 条）。
// eye 路修订（问题单 14）：每个样本加上失能眩光的光幕亮度（10·E_眼/θ²，与 final.frag 同式、同一个“眼角度”）。
//   迎着太阳看时，眼内散射光抬高视网膜的适应，四周显得更暗、塔缘衬成剪影；日面滑进塔缘后光幕收拢，四周一秒左右亮回来。
// 输出：x 本格加权平均 ln L，y 本格权重和（眼 pass 再按 y 加权求总平均）。
uniform sampler2D uHDR, uEye;                       // uHDR＝本帧 TAA 结果；uEye＝本帧合成所用的眼状态（x 曝光，y 适应亮度，z 到眼日照 klux）
uniform vec2 uRes;
uniform vec3 uSunDirScr, uCamFwd, uCamRight, uCamUp;
uniform float uTanHalfFov, uGlareK;
void main(){
  vec4 e = texelFetch(uEye, ivec2(0), 0);
  float ex = max(e.x, 1e-30), lp = log(clamp(e.y, 0.003, 1e5));
  float Ee = max(e.z, 0.0)*uGlareK, M = max(1.0, 0.70021/max(uTanHalfFov, 1e-4));   // 望远时按眼看到的角度算光幕（与 final 同）
  vec2 isz = vec2(textureSize(uHDR, 0)); float asp = isz.x/isz.y;
  float s = 0.0, ws = 0.0;
  for (int k = 0; k < 4; k++){
    vec2 o = vec2(float(k & 1), float(k >> 1))*0.5 + 0.25;
    vec2 uv = (floor(gl_FragCoord.xy) + o)/uRes, q = 2.0*uv - 1.0;
    vec3 d = normalize(uCamFwd + uTanHalfFov*(q.x*asp*uCamRight + q.y*uCamUp));
    if (dot(d, uSunDirScr) > 0.99985) continue;                 // 日面附近（约 1°）
    float L = dot(texture(uHDR, uv).rgb, vec3(0.2126, 0.7152, 0.0722))/ex*1000.0;
    if (Ee > 0.0){
      float th = max(degrees(2.0*asin(clamp(0.5*length(d - uSunDirScr), 0.0, 1.0)))*M, 0.3);
      L += 1.0e4*Ee/(th*th)*(1.0 - smoothstep(20.0, 40.0, th));   // 10·E/θ²（kn）×1000 → cd/m²
    }
    float lg = clamp(log(max(L, 1e-4)), lp - 3.4657, lp + 3.4657);   // ±5 EV
    float w = 0.25 + exp(-2.0*dot(q, q));
    s += w*lg; ws += w;
  }
  fragColor = vec4(ws > 0.0 ? s/ws : 0.0, ws, 0.0, 1.0);
}
