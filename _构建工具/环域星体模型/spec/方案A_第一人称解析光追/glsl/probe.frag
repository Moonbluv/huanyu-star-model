// =====================================================================================
//  天空探针：32×16 经纬图（世界系方向），给 SH9 投影用。复用主 pass 的函数，但：
//  不走近处高度场（脚下用宏观内壁代替）、不画日面、样本减半。输出未曝光的辐亮度（cd/m²）。
// =====================================================================================
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(32.0, 16.0);
  float th = uv.y * PI, ph = uv.x * 2.0 * PI;
  vec3 d = vec3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
  vec3 o = uCamPos;
  float jit = fract(ign(gl_FragCoord.xy, uFrame) + 0.5);
  vec3 skyMean = skyMeanRadiance();
  vec2 wall = iSphereBC(dot(o, d), min(uCamC0, -1e-3));
  float tWall = wall.y > 0.0 ? wall.y : 1e-3;
  float tTower = iTower(o, d);
  vec2 mI = iSphere(o - uMoonPos, d, uMoonRad);
  float tMoon = (mI.x < mI.y && mI.x > 0.0) ? mI.x : INF;
  float tHit = tWall; int kind = 0;
  if (tTower < tHit) { tHit = tTower; kind = 2; }
  if (tMoon < tHit)  { tHit = tMoon;  kind = 4; }
  vec3 X = o + d * tHit;
  vec3 Ls = kind == 2 ? shadeTower(X, d) : kind == 4 ? shadeMoonDisk(o, d, tHit) : shadeWall(X, d);
  vec4 nearC = vec4(0.0, 0.0, 0.0, 1.0);
  float tc = INF;
  if (uCloudOn > 0.5) {
    vec2 sb = iSphere(o, d, uR - uCloudBase);
    vec2 st = iSphere(o, d, uR - uCloudTop);
    bool stHit = st.x < st.y;
    if (sb.x < sb.y) {
      float a0 = max(sb.x, 0.0), a1 = min(stHit ? st.x : sb.y, tHit);
      if (a1 > a0 && a0 < 400.0) nearC = marchClouds(o, d, a0, a1, jit, tc);
      if (stHit && kind == 0 && st.y > 400.0 && sb.y <= tHit + 1.0) {
        vec4 fc2 = farCloud(o + d * (0.5 * (st.y + sb.y)), min(sb.y - st.y, 60.0));
        Ls = Ls * fc2.a + fc2.rgb;
      }
    }
  }
  gSnapT = tc;
  vec3 Lin, Tr;
  integrateAtmo(o, d, tHit, jit, skyMean, max(Q_ATM_NEAR / 2, 4), max(Q_ATM_FAR / 2, 4), Lin, Tr);
  vec3 col = tc < INF * 0.5 ? gSnapL + gSnapT3 * nearC.rgb + nearC.a * (Lin - gSnapL + Tr * Ls) : Lin + Tr * Ls;
  fragColor = vec4(min(col, vec3(6.0e4)), 1.0);
}
