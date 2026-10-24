// foot.frag：拼在 common 之后。输出：x 细层 d_f(C)，y 蜿蜒 w(C)，z 扶壁＋冲沟 b̃(C)，w 量化前起伏 P(C)（负责：F 路；JS 镜像 fp/ground.js 的 foot）
// 各层都用手工双线性 layerTexHQ（与 terrain_lib.glsl 里的那份逐字相同，test/noise_mirror 比对原文）：altAt 在近处（足迹 < HQ_FOOT，
// 相机处必然如此）也用它，dc＝0 时两边逐位一致，各 pass 的 alt(0) 才严格等于眼高。
// 冲沟项 T_GUL·gullyF(第 3 层) 并进扶壁层 b（terrain_lib.glsl 的 altAt 同式；gullyF、T_GUL 两份逐字相同，test/terrace_geom 比对原文）。
layout(location = 0) out vec4 oc;
#define T_GUL 0.171
vec4 layerTexHQ(int k, vec2 dc){
  mat2 Rk = rotK(k); float s = 1.0/(LAY_L[k]*TILE);
  vec2 uv = (Rk*dc)*s + uOrg[k];
  ivec2 n = textureSize(uHeight, 0), m = n - 1;
  vec2 x = uv*vec2(n) - 0.5, f = fract(x); ivec2 i0 = ivec2(floor(x));
  vec4 a = texelFetch(uHeight, i0 & m, 0), b = texelFetch(uHeight, (i0 + ivec2(1, 0)) & m, 0);
  vec4 c = texelFetch(uHeight, (i0 + ivec2(0, 1)) & m, 0), d = texelFetch(uHeight, (i0 + ivec2(1, 1)) & m, 0);
  vec4 t = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return vec4(t.r, s*(transpose(Rk)*t.gb), t.a);
}
float gullyF(float n, out float dg){ float u = sat(1.0 - abs(n)/0.16); dg = -sign(n)*6.0*u*(1.0 - u)/0.16; return u*u*(3.0 - 2.0*u); }
float gullyMask(float ba){ return sstep(0.56, 0.72, ba); }
void main(){
  vec2 dc = vec2(0.0); float amp = uAmpZone;
  vec4 L0 = layerTexHQ(0, dc), L1 = layerTexHQ(1, dc);                       // 与 terrain_lib.glsl 的 altAt 同式（逐位一致）
  float P = amp*(LAY_A[0]*L0.r + LAY_A[1]*L1.r);
  float df = 0.0;
  for (int k = 2; k < 6; k++){ if (uGroundMode == 1 && k == 2) continue; df += amp*LAY_A[k]*layerTexHQ(k, dc).r; }
  vec4 Lb = layerTexHQ(2, dc); float dg, b = Lb.r;
  if (uGroundMode == 1) b += T_GUL*sat(uAmpZone/0.7)*gullyMask(Lb.a)*gullyF(layerTexHQ(3, dc).r, dg);
  oc = vec4(df, layerTexHQ(6, dc).r, b, P);
}
