// far.frag（FAR_SCALE：低／中／高 0.5，拍照 1.0，由 defines 注入）
#ifndef FAR_SCALE
#define FAR_SCALE 0.5
#endif
uniform float uAbyssFog;                                          // 深渊雾开关（fp.ground.abyssFog）
layout(location = 0) out vec4 oc;
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec3 d = viewRay(fc, uRes, uJitter, 1.0);                       // 按本 pass 的整个纹素抖动（合成的 upFar 同口径）
  float cd = dot(uCamW, d);
  float tW = tWallCam(cd), tT = iTower(uCamW, d);
  vec4 sg = segments(cd, tW); float b0 = sg.y;
  if (-cd <= 0.0 || b0 >= tW){ oc = vec4(0.0, 0.0, 0.0, -1.0); return; }   // 没有远段
  bool towerFar = tT > b0 && tT < tW;                               // 塔脚浸在对面大气里：积到塔面为止
  float tEnd = towerFar ? tT : tW;
  vec3 X = uCamW + d*tEnd;
  // 深渊：壁点在沟里且开了深渊雾 → 视线延长到沟底，下段空气更稠
  float abyssExt = 0.0;
  if (!towerFar && uAbyssFog > 0.5 && uAbyssDepth > 0.0 && abs(X.y) < uAbyssHalf){
    float mu = max(dot(d, normalize(X)), 0.05);
    abyssExt = trench(X.y)/mu;
  }
  float jit = ign(fc, uFrame + 7);
  vec3 S = vec3(0.0), T = vec3(1.0); float TX = 1.0;
  // 对面云：视线在下降段穿过云壳
  vec2 Ct = tShellCam(cd, uCloudTop), Cb = tShellCam(cd, uCloudBase);
  float tc = (uCloudOn > 0.5 && Ct.y > b0 && Cb.y > Ct.y && Cb.y <= tEnd + 1.0) ? 0.5*(Ct.y + Cb.y) : -1.0;
  // 霾层底（离壁 5H_M）把下降段分成“空气段＋霾段”
  float hz = min(5.0*uHM, 0.5*uZtop); vec2 sh = tShellCam(cd, hz);
  float z2 = (sh.y > b0 && sh.y < tEnd) ? sh.y : b0;
  int nH = (tEnd - z2 > 1e-3) ? max(2, Q_FAR_N*2/5) : 0;
  float zb0 = zOfK(Kat(b0, cd)), zz2 = zOfK(Kat(z2, cd)), ze = zOfK(Kat(tEnd, cd));
  // 段表（E 路改写，只为编译量：02 原式 5 处 airMarch 各展开一份；这里段数在运行时才知道，只留一份。次序与结果不变）：
  // 空气段 [b0, z2] → 霾段 [z2, tc] → 对面云（平板事件）→ 霾段 [tc, tEnd]；没有云时霾段 [z2, tEnd]；最后是沟里的雾
  bool cl = tc > 0.0 && tc > z2;                                     // 云在霾段里（常见）
  float zc = cl ? zOfK(Kat(tc, cd)) : ze;
  float sa[4], sb[4], sk[4]; int sn[4];
  sa[0] = b0; sb[0] = z2; sk[0] = (zb0 - zz2)/uHR; sn[0] = Q_FAR_N - nH;
  sa[1] = z2; sb[1] = cl ? tc : tEnd; sk[1] = (zz2 - zc)/uHM; sn[1] = cl ? nH/2 : nH;
  sa[2] = tc; sb[2] = tEnd; sk[2] = (zc - ze)/uHM; sn[2] = nH - nH/2;
  int ns = cl ? 3 : 2;
  if (abyssExt > 0.0){ sa[ns] = tEnd; sb[ns] = tEnd + abyssExt; sk[ns] = 2.0; sn[ns] = 2; ns++; }   // 沟里的雾
  for (int i = 0; i < ns; i++){
    if (cl && i == 2){
      vec3 Y = uCamW + d*tc; vec4 w = weatherAt(Y);
      float tau = w.r*mix(20.0, 10.0, w.g)*w.b;
      applyEvent(slabCloud(Y, d, tau), S, T, TX);
    }
    airMarch(d, cd, sa[i], sb[i], sk[i], true, sn[i], jit, S, T, TX);
  }
  vec3 Lend = towerFar ? shadeTower(X) : shadeWall(X, d);
  oc = vec4(min(S + T*Lend, vec3(6.0e4)), tEnd);
}
