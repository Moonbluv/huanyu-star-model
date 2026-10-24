// =====================================================================================
//  主 pass：每像素一条视线。解析求交（内壁/塔/日/月）→ 近处高度场步进 → 云 → 大气（快照合成）
//  输出：rgb＝预曝光后的辐亮度（RGBA16F），a＝命中距离 km（供 TAA 重投影）
//  依赖 common.glsl（拼接在前）
// =====================================================================================
layout(location = 0) out vec4 fragColor;
uniform int uDebug;

void main() {
  vec2 fc = gl_FragCoord.xy;
  float jit = ign(fc, uFrame);
  vec2 ndc = (2.0 * (fc + uJitter) - uRes) / uRes.y;
  vec3 d = normalize(uCamFwd + uTanHalfFov * (ndc.x * uCamRight + ndc.y * uCamUp));
  vec3 o = uCamPos;
  float pix = 2.0 * uTanHalfFov / uRes.y;           // 每像素弧度
  float expo = texelFetch(uExpTex, ivec2(0), 0).x;
  vec3 skyMean = skyMeanRadiance();

  // —— 1. 解析求交 ——
  vec2 wall = iSphereBC(dot(o, d), uCamC0);          // c 由 CPU 双精度给出，近地不丢精度
  float tWall = wall.y > 0.0 ? wall.y : INF;
  float tTower = iTower(o, d);
  vec2 sI = iSphere(o - uSunPos, d, uSunRad);
  float tSun = (sI.x < sI.y && sI.x > 0.0) ? sI.x : INF;
  vec2 mI = iSphere(o - uMoonPos, d, uMoonRad);
  float tMoon = (mI.x < mI.y && mI.x > 0.0) ? mI.x : INF;

  // —— 2. 近处地形（高度场）——
  float tLim = min(Q_NEAR_KM, tTower);
  if (wall.y > 0.0) {                                // 朝下的视线：地面可能低于宏观球面，多走一点
    vec2 w2 = iSphere(o, d, uR + uClearMax + abs(uHcS) + uAbyssDepth);
    tLim = min(tLim, max(w2.y, 0.0) + 0.5);
  }
  float tTer = marchTerrain(d, tLim, pix);
  bool exhausted = tTer < 0.0;
  if (exhausted) tTer = INF;

  // —— 3. 第一个命中 ——
  int kind = 0;                 // 0 远处内壁，1 近处地形，2 塔，3 太阳，4 月
  float tHit = tWall;
  if (tTer < tHit)   { tHit = tTer;   kind = 1; }
  if (tTower < tHit) { tHit = tTower; kind = 2; }
  if (tMoon < tHit)  { tHit = tMoon;  kind = 4; }
  if (tSun < tHit)   { tHit = tSun;   kind = 3; }
  if (tHit >= INF * 0.5) { fragColor = vec4(0.0, 0.0, 0.0, 6e4); return; }
  if (uDebug == 1) {                                  // 调试：按命中类别着色
    vec3 kc = kind == 0 ? vec3(0.2, 0.4, 1.0) : kind == 1 ? vec3(0.2, 0.9, 0.2) : kind == 2 ? vec3(0.0) : kind == 3 ? vec3(1.0, 0.9, 0.2) : vec3(0.8);
    if (exhausted) kc = vec3(1.0, 0.0, 0.0);
    fragColor = vec4(kc * 1000.0 * expo, tHit); return;
  }

  // —— 4. 表面辐亮度 ——
  vec3 Ls;
  vec3 X = o + d * tHit;
  if (kind == 1)      Ls = shadeTerrain(d * tHit, d, tHit, pix);
  else if (kind == 2) Ls = shadeTower(X, d);
  else if (kind == 3) Ls = shadeSunDisk(o, d, tHit);
  else if (kind == 4) Ls = shadeMoonDisk(o, d, tHit);
  else                Ls = shadeWall(X, d);

  // —— 5. 云：近处体积，远处（对面世界）二维 ——
  vec4 nearC = vec4(0.0, 0.0, 0.0, 1.0);
  float tc = INF;
  if (uCloudOn > 0.5) {
    vec2 sb = iSphere(o, d, uR - uCloudBase);
    vec2 st = iSphere(o, d, uR - uCloudTop);
    bool stHit = st.x < st.y;
    if (sb.x < sb.y) {
      float a0 = max(sb.x, 0.0), a1 = stHit ? st.x : sb.y;
      float b0 = stHit ? st.y : INF, b1 = sb.y;
      a1 = min(a1, tHit);
      if (a1 > a0 && a0 < 400.0) nearC = marchClouds(o, d, a0, a1, jit, tc);
      // 第二段：要么是对面世界的云（远），要么是相机在云顶之上往下看（近）
      if (stHit && kind == 0 && b1 <= tHit + 1.0 && b1 > b0) {
        if (b0 > 400.0) {
          vec4 fc2 = farCloud(o + d * (0.5 * (b0 + b1)), min(b1 - b0, 60.0));
          Ls = Ls * fc2.a + fc2.rgb;
        } else if (nearC.a > 0.99) nearC = marchClouds(o, d, max(b0, 0.0), min(b1, tHit), jit, tc);
      }
    }
  }

  // —— 6. 大气：两端加密积分；在云深度处取快照，按 L = A[0,tc] + T[0,tc]·C + Tc·(A[tc,end] + T·Ls) 合成 ——
  gSnapT = tc;
  vec3 Lin, Tr;
  integrateAtmo(o, d, tHit, jit, skyMean, Q_ATM_NEAR, Q_ATM_FAR, Lin, Tr);
  vec3 col;
  if (tc < INF * 0.5) col = gSnapL + gSnapT3 * nearC.rgb + nearC.a * (Lin - gSnapL + Tr * Ls);
  else                col = Lin + Tr * Ls;

  fragColor = vec4(min(col * expo, vec3(6.0e4)), min(tHit, 6.0e4));
}
