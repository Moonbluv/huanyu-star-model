// ground_bake.frag：地面细节贴图的烘焙（启动时一次；负责：F 路）。由 fp/instances.js 自己编、自己画（不进帧图），
// 结果交给 shade_terrain.glsl 的 uGrDet、uGrVor。自带 pcg3（与 terrain_lib.glsl 逐字相同），不拼任何 chunk。
// uBakeMode 0：碎石贴图（1024²，一张贴图覆盖 2.4 m，平铺）。三个尺度的格（每边 10、20、40 格，即 24、12、6 cm）各放一块石头：
//   八边形截锥（平顶 45%，四周斜面），随机朝向、长短轴、高度。每个纹素记“最高的那块石头”：
//   r＝石高（0–1 ↔ 0–10 cm；石外为 0），g＝这块石头的出现序（(尺度号＋随机)/3，着色时与该尺度的密度比较决定它在不在），
//   b＝石色随机数，a＝到这块石头的八边形距离 m/1.75（石外一圈 m∈[1, 1.75) 是石根的接触暗边；离所有石头都远为 1）。
// uBakeMode 1：多边形板贴图（1024²，每边 16 格的 Voronoi，平铺）：r＝到最近边的距离（格单位 ×2），gba＝本格的三个随机数。
layout(location = 0) out vec4 oc;
uniform int uBakeMode;
uvec3 pcg3(uvec3 v){ v = v*1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
vec3 hash3f(uvec3 v){ return vec3(pcg3(v) >> 8u)/16777216.0; }
vec3 cellR(vec2 c, float per, uint seed){ vec2 w = mod(c, per); return hash3f(uvec3(uvec2(w + 0.5), seed)); }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5)/1024.0;                    // 纹素中心 → [0,1)
  if (uBakeMode == 1){
    vec2 q = uv*16.0, iq = floor(q), fq = q - iq; float d1 = 9.0, d2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(1.0); vec3 h1 = vec3(0.0);
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
      vec2 c = iq + vec2(float(i), float(j)); vec3 h = cellR(c, 16.0, 811u);
      vec2 o = vec2(float(i), float(j)) + 0.15 + 0.7*h.xy - fq; float dd = dot(o, o);
      if (dd < d1){ d2 = d1; m2 = m1; d1 = dd; m1 = o; h1 = h; } else if (dd < d2){ d2 = dd; m2 = o; }
    }
    vec2 nn = normalize(m2 - m1 + 1e-6);
    float e = dot(0.5*(m1 + m2), nn);
    oc = vec4(clamp(e*2.0, 0.0, 1.0), h1.z, fract(h1.x*7.31 + h1.y*3.17), fract(h1.y*5.13 + h1.z*11.7));
    return;
  }
  float zBest = 0.0, rk = 1.0, tint = 0.0, mBest = 1.75; bool on = false;
  for (int s = 0; s < 3; s++){
    float per = s == 0 ? 10.0 : s == 1 ? 20.0 : 40.0;
    vec2 q = uv*per, iq = floor(q), fq = q - iq;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 c = iq + vec2(float(i), float(j));
      vec3 h = cellR(c, per, 701u + 37u*uint(s)), h2 = cellR(c, per, 802u + 37u*uint(s));
      vec2 ctr = vec2(float(i), float(j)) + 0.2 + 0.6*h.yz;
      float R = 0.17 + 0.3*h2.x, an = 6.2832*h2.y, el = 1.0 + 0.8*h2.z;
      vec2 cs = vec2(cos(an), sin(an)), ax2 = vec2(-cs.y, cs.x);
      float k = 0.66 + 0.14*fract(h.y*7.31 + h2.x*3.1);
      float Hs = (0.3 + 0.45*fract(h.z*5.7 + h2.y*2.3))*R/per*2.4;      // 石高（米）
      vec2 r0 = fq - ctr, r = vec2(dot(r0, cs), dot(r0, ax2)*el), ar = abs(r);
      float m = max(max(ar.x, ar.y), (ar.x + ar.y)*k)/R;
      float z = m < 1.0 ? Hs*min(1.0, (1.0 - m)/0.55) : 0.0;
      if (z > zBest || (!on && m < mBest)){                           // 石上取最高的；石外取最近的（接触暗边）
        if (m < 1.0){ zBest = z; on = true; }
        mBest = m; rk = (float(s) + h.x)/3.0; tint = fract(h.z*23.1 + h2.z*0.37);
      }
    }
  }
  oc = vec4(clamp(zBest/0.1, 0.0, 1.0), rk, tint, clamp(mBest/1.75, 0.0, 1.0));
}
