// gen_height.frag：输出 RGBA32F（R 高度，A 材质）；随后 gen_height_d.frag 差分出 GB 并转存 RGBA16F
layout(location = 0) out vec4 oc;
uvec3 pcg3(uvec3 v){ v = v*1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
vec2 gradT(ivec2 p, int per, int seed){ p = ((p % per) + per) % per;
  float a = float(pcg3(uvec3(uint(p.x), uint(p.y), uint(seed))).x >> 8u)/16777216.0*6.2831853; return vec2(cos(a), sin(a)); }
float perlinT(vec2 x, int per, int seed){
  ivec2 i = ivec2(floor(x)); vec2 f = x - floor(x), u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  float n00 = dot(gradT(i, per, seed), f), n10 = dot(gradT(i + ivec2(1, 0), per, seed), f - vec2(1.0, 0.0));
  float n01 = dot(gradT(i + ivec2(0, 1), per, seed), f - vec2(0.0, 1.0)), n11 = dot(gradT(i + ivec2(1, 1), per, seed), f - vec2(1.0));
  return 1.414*mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}
void main(){
  vec2 x = (gl_FragCoord.xy - 0.5)/1024.0;
  float f = 0.0, ridge = 0.0, a = 1.0; int per = 32;
  // 山脊项（1−|n|）只取前两个八度：细八度的折线在各层的法线上成了满地的细褶（中景像兽皮、枯草皮），2026-10 改
  for (int o = 0; o < 4; o++){ float n = perlinT(x*float(per), per, 11 + o); f += a*n; if (o < 2) ridge += a*(1.0 - abs(n)); a *= 0.5; per *= 2; }
  float h = clamp((0.6*f + 0.4*(ridge - 0.95))*1.45, -1.0, 1.0);          // 1.45 为经验归一系数（test/noise_mirror 第 3 节校核）
  float m = 0.0; a = 1.0; per = 16;
  for (int o = 0; o < 3; o++){ m += a*perlinT(x*float(per), per, 77 + o); a *= 0.5; per *= 2; }
  oc = vec4(h, 0.0, 0.0, clamp(0.5 + 0.5*m, 0.0, 1.0));
}
