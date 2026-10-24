// terrain.frag（W×H，RGBA16F＋深度）：地形着色（02 第八节第 8 条；负责：F 路）。rgb＝表面辐亮度（kn，不含大气），a＝命中距离 km（无为 −1）。
// 2026-10 求交挪到 terrain_march.frag（pass terrain_g，写 G 缓冲 uTerG），本 pass 只着色：读命中距离、法线、阶地相位与级，
// 第 3、4、5 层就地取样（不再调 altAt），然后 shadeTerrainC。拆开是为了编译时间（见 terrain_march.frag 文件头）。
uniform sampler2D uTerG; uniform float uPixF;
uniform float uInstNear, uInstFar;                          // 实例相机的 near/far（km）
layout(location = 0) out vec4 oc;
vec3 unpackN(float p){
  float qx = floor(p/4096.0), qy = p - qx*4096.0;
  vec2 e = vec2(qx, qy)/4095.0*2.0 - 1.0;
  vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) n.xz = (1.0 - abs(n.zx))*vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
void main(){
  vec4 G = texelFetch(uTerG, ivec2(gl_FragCoord.xy), 0);
  float hit = G.r;
  if (hit < 0.0){ oc = vec4(0.0, 0.0, 0.0, -1.0); gl_FragDepth = 1.0; return; }
  vec3 d = viewRay(gl_FragCoord.xy, uRes, uJitter, 1.0), v = d*hit;
  float foot = max(hit*uPixF, 2e-4);
  // 解包阶地缓存（与 terrain_march.frag 的打包同式）
  float pk = G.a, ld = mod(pk, 8.0); pk = floor(pk/8.0);
  float tl = mod(pk, 8.0); pk = floor(pk/8.0);
  float q = mod(pk, 32.0); pk = floor(pk/32.0);
  float st = mod(pk, 8.0), kk = floor(pk/8.0) - 512.0;
  gU = G.b; gK = kk; gQ = q < 0.5 ? -1.0 : (q - 1.0)/30.0; gTal = tl/7.0; gLedge = ld/7.0; gStep = st - 1.0; gCliffH = 1.0;
  if (uGroundMode == 1){
    vec4 F = texelFetch(uFoot, ivec2(0), 0);
    float rawC = uRsC - F.w, YC = sqrt(max(uR*uR - rawC*rawC, 1.0));
    gKA = floor(YC/uW - uWig*F.y - uJit*F.z - uTerF0 + 0.5) + kk;   // 相机所在级的绝对级号＋相对级号（altAt 同式）
  } else gKA = 0.0;
  gDc = chartD(v);
  gL3 = layerTexF(3, gDc, foot); gL4 = layerTexF(4, gDc, foot); gL5 = layerTexF(5, gDc, foot);
  vec3 L = shadeTerrainC(v, d, hit, foot, unpackN(G.g));
  oc = vec4(min(L, vec3(6.0e4)), hit);
  float zv = hit*dot(d, uCamFwd);                             // 写出与实例相机同一投影的深度
  gl_FragDepth = zv > uInstFar ? 1.0 : clamp(((uInstFar + uInstNear) - 2.0*uInstFar*uInstNear/zv)/(uInstFar - uInstNear)*0.5 + 0.5, 0.0, 1.0);
}
