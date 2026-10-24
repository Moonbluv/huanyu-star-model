// bloom_down.frag：眩光金字塔下采样，拼在 post_common 之后（02 第十四节第 5 条）
// Jimenez 13 点；第 0 级（读 TAA 结果）用 Karis 平均，日面截断值不会炸成萤火。
uniform sampler2D uCur;                                           // 上一级（第 0 级为 TAA 结果）
uniform vec2 uRes;
uniform int uLevel;
vec3 smp(vec2 uv){ return texture(uCur, uv).rgb; }
float kw(vec3 c){ return 1.0/(1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes, t = 1.0/vec2(textureSize(uCur, 0));
  vec3 a = smp(uv + t*vec2(-2.0, 2.0)), b = smp(uv + t*vec2(0.0, 2.0)), c = smp(uv + t*vec2(2.0, 2.0));
  vec3 d = smp(uv + t*vec2(-2.0, 0.0)), e = smp(uv), f = smp(uv + t*vec2(2.0, 0.0));
  vec3 g = smp(uv + t*vec2(-2.0, -2.0)), h = smp(uv + t*vec2(0.0, -2.0)), i = smp(uv + t*vec2(2.0, -2.0));
  vec3 j = smp(uv + t*vec2(-1.0, 1.0)), k = smp(uv + t*vec2(1.0, 1.0)), l = smp(uv + t*vec2(-1.0, -1.0)), m = smp(uv + t*vec2(1.0, -1.0));
  vec3 o;
  if (uLevel == 0){
    vec3 g0 = (a + b + d + e)*0.25, g1 = (b + c + e + f)*0.25, g2 = (d + e + g + h)*0.25, g3 = (e + f + h + i)*0.25, g4 = (j + k + l + m)*0.25;
    float w0 = 0.125*kw(g0), w1 = 0.125*kw(g1), w2 = 0.125*kw(g2), w3 = 0.125*kw(g3), w4 = 0.5*kw(g4);
    o = (w0*g0 + w1*g1 + w2*g2 + w3*g3 + w4*g4)/(w0 + w1 + w2 + w3 + w4);
  } else {
    o = e*0.125 + (a + c + g + i)*0.03125 + (b + d + f + h)*0.0625 + (j + k + l + m)*0.125;
  }
  fragColor = vec4(min(o, vec3(6.0e4)), 1.0);
}
