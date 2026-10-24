// inst.frag：实例层片元（02 第九节；负责：F 路）。拼在 common＋shadow＋terrain_lib＋shade_terrain 之后。
// 写入 tSurf：rgb＝表面辐亮度（kn，不含大气），a＝距离 km；深度测试对着 terrain pass 写的 gl_FragDepth（LessEqual）。
// 光照与地形同一套（shade_terrain.glsl 的 litSurface：日照、塔影、月掩日、地平线角图、云影、SH 天光与空腔）。本文件不声明新 uniform。
in vec3 vV;
in vec3 vN;
in vec3 vAlb;
in vec3 vMat;
in vec2 vDc;
layout(location = 0) out vec4 oc;
void main(){
  float t = length(vV);
  vec3 d = vV/max(t, 1e-9), n = normalize(vN);
  if (!gl_FrontFacing) n = -n;                                 // 草叶两面
  Surf s = surf0(vAlb, vMat.x); s.wet = vMat.y;
  vec3 L = litSurface(uCamW + vV, d, t, n, s, vDc, vMat.z*aoScan(vDc));   // 高档：洼地、崖脚里的石头草木也暗一些
  oc = vec4(min(L, vec3(6.0e4)), t);
}
