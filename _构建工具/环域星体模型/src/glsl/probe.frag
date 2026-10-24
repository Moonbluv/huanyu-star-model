// probe.frag：32×48，拼在 common → … → shade_wall 之后
layout(location = 0) out vec4 oc;
vec3 airO(vec3 O, vec3 d, float ta, float tb, int n, inout vec3 T){   // 任意起点的简化空气积分（探针用）
  vec3 S = vec3(0.0); float len = tb - ta; if (len <= 0.0) return S;
  n = min(n, 8);
  for (int i = 0; i < n; i++){                                       // 上界在运行时才知道：编译器不展开
    float t = ta + len*(float(i) + 0.5)/float(n), dt = len/float(n);
    vec3 X = O + d*t; float K = Kof(X), z = zOfK(K);
    Med m = medium(X, z); vec3 ext; vec3 J = airSource(X, K, z, d, m, ext);
    vec3 sT = exp(-ext*dt); S += T*(J - J*sT)/max(ext, vec3(1e-9)); T *= sT;
  }
  return S;
}
vec3 beyond(vec3 O, vec3 d){                                       // 真空以远：塔、月、对面大气与对面内壁
  vec2 wall = iSphere(O, d, uR); float tW = wall.y;
  vec2 core = iSphere(O, d, uR - uZtop);
  float tT = iTower(O, d);
  vec2 hm = iSphere(O - uMoonW, d, uMoonRho); float tM = (hm.x < hm.y && hm.x > 0.0) ? hm.x : INF;
  float b0 = core.y;
  // 夜幕：从 O 出发到撞上的东西为止在夜幕里的路程（从相机看出去是视线穿过夜幕的那一段；从月心看出去时月本身就在夜幕里）
  if (tM < min(tT, b0)) return shadeMoon(O + d*tM, d)*veilRayT(O, d, tM);
  if (tT < b0) return shadeTower(O + d*tT)*veilRayT(O, d, tT);
  float tEnd = min(tT, tW); vec3 T = vec3(1.0);
  vec3 S = airO(O, d, max(b0, 0.0), tEnd, 6, T);
  return (S + T*(tT < tW ? shadeTower(O + d*tT) : shadeWall(O + d*tW, d)))*veilRayT(O, d, tEnd);
}
// 相机上空云层在视线上的区间 [t0, t1]（没有则 −1）：与近段同一个交段（clouds 路：阶地模式近处的云层按重力找平）
vec2 slabSpan(vec3 d){ return cloudSpanCam(d, dot(uCamW, d), 3000.0); }
// 相机上空的云（clouds 路，问题单第 4 条）：只给漫射、按覆盖度加权——原先每个穿过云壳的方向都当一块满覆盖的平板、
// 透下来的光含完整的直射，地面的直射又按云影图全额另算，圣禁城正午开云 213 klux，比关云（131）、关大气（165）都亮
vec4 localSlab(vec3 d){ return cloudSkyProbe(d); }
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); int row = ij.y/16;
  vec2 uv = (vec2(float(ij.x), float(ij.y - row*16)) + 0.5)/vec2(32.0, 16.0);
  float ph = uv.x*2.0*PI, ct = 1.0 - 2.0*uv.y, st = sqrt(max(1.0 - ct*ct, 0.0));
  vec3 d = vec3(st*cos(ph), ct, st*sin(ph)), L = vec3(0.0);
  // E 路改写（结构只为编译量）：beyond、airO 各只留一处调用（02 原式各调两次，大函数整份展开两遍）
  float cd = dot(uCamW, d);
  vec3 up = uGroundMode == 1 ? vec3(-1.0, 0.0, 0.0) : -normalize(uCamW);
  vec4 sg = segments(cd, tWallCam(cd));
  if (row != 2 && dot(d, up) < -0.02){                             // 朝地：地面（行 1 为 0）
    if (row == 0){ vec3 n = up; vec3 l; float vis; vec3 E = sunE(uCamW, uCamK, l, vis, true);
      vec3 alb = vec3(0.12); L = alb/PI*(E*max(dot(n, l), 0.0)*cloudShadowT(vec2(0.0)) + shIrr(n, 0)); }
  } else {
    bool vac = row == 2 || sg.w > 0.5;
    vec3 Lb = vac ? beyond(row == 2 ? uMoonW : uCamW, d)
                  : shadeWall(uCamW + d*tWallCam(cd), d)*veilRayT(uCamW, d, tWallCam(cd));   // 掠射弦：整根在大气里（高过 Zv 的一段仍穿夜幕）
    if (row == 2) L = Lb;
    else {
      // 空气按云层切开：云下的空气在云前，云上的空气在云后（02 原式把整段空气都放在云前，云上受日照的空气会漏进云下的天光）
      // 不进真空核的掠射弦（α_w＜约 20°）整根都在大气里：近端积到内壁（02 原式只积到弦中点 sg.x，后半段的空气没积，
      // 内壁还只隔着半根弦的透射，地平线上方那一圈天光偏暗、偏透）。没有云时在中点切成上升、下降两段。
      float tN = vac ? sg.x : tWallCam(cd);
      float tAp = (vac || cd >= 0.0) ? tN : min(-cd, tN);
      vec3 T = vec3(1.0), T2 = vec3(1.0), Sn = vec3(0.0), Sf = vec3(0.0);
      vec2 sp = slabSpan(d);
      float tA = sp.x > 0.0 ? min(sp.x, tN) : tAp, tB = sp.x > 0.0 ? sp.y : tAp;
      int ns = tB < tN ? 2 : 1;
      for (int s = 0; s < ns; s++){
        vec3 Tt = vec3(1.0);
        vec3 Ss = airO(uCamW, d, s == 0 ? 0.0 : tB, s == 0 ? tA : tN, s == 0 ? 6 : 4, Tt);
        if (s == 0){ Sn = Ss; T = Tt; } else { Sf = Ss; T2 = Tt; }
      }
      vec4 cl = localSlab(d);
      // 行 1 只乘本地空气的透射（云的遮挡由 cavityDim 在云下的空气里补，E 路对 02 第十三节的改正）
      L = row == 1 ? T*T2*Lb : Sn + T*(cl.rgb + cl.a*(Sf + T2*Lb));
    }
  }
  oc = vec4(min(L, vec3(5000.0)), 1.0);
}
