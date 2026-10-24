// gen_height_d.frag：拼在 common 之后（02 第八节第 6 条；负责：F 路）。
// 输入：uHeight 在本 pass 运行时绑 gen_height 的输出 tHeight32（1024² RGBA32F，R 高度、A 材质）。
// 输出：tHeight（RGBA16F）：R 高度；G、B 对 u、v 的偏导（中心差分，平铺，单位 1/uv）；A 材质。JS 镜像：fp/noise.js 的 heightTexel。
layout(location = 0) out vec4 oc;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), n = textureSize(uHeight, 0);
  vec4 c = texelFetch(uHeight, p, 0);
  float hx1 = texelFetch(uHeight, ivec2((p.x + 1) % n.x, p.y), 0).r;
  float hx0 = texelFetch(uHeight, ivec2((p.x + n.x - 1) % n.x, p.y), 0).r;
  float hy1 = texelFetch(uHeight, ivec2(p.x, (p.y + 1) % n.y), 0).r;
  float hy0 = texelFetch(uHeight, ivec2(p.x, (p.y + n.y - 1) % n.y), 0).r;
  oc = vec4(c.r, (hx1 - hx0)*0.5*float(n.x), (hy1 - hy0)*0.5*float(n.y), c.a);
}
