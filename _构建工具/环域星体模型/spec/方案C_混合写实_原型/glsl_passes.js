/* 方案C · 各渲染 pass 的着色器（依赖 GLSL_COMMON） */
(function () {
const C = window.GLSL_COMMON;
const VS_FULL = /* glsl */`
out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* ---------- 共用：沿一段射线积分大气内散射（单次＋多次＋“空心之光”） ----------
 * O,KO：起点及其 K；[t0,t1]：区间；N：步数；pw>0 时步长朝 t0 加密（t=t0+(t1−t0)x^pw），pw<0 朝 t1 加密。
 * Lamb：从大气之外照进来的平均辐亮度（对面世界、对面大气），按各向同性相函数入射。 */
const INSCATTER = /* glsl */`
vec3 inscatter(vec3 O, float KO, vec3 d, float t0, float t1, int N, float pw, vec3 Lamb, inout vec3 T){
  float od = dot(O,d); vec3 S = vec3(0.0);
  for (int i=0;i<48;i++){
    if (i>=N) break;
    float x0 = float(i)/float(N), x1 = float(i+1)/float(N);
    float ta, tb;
    if (pw > 0.0){ ta = t0 + (t1-t0)*pow(x0,pw); tb = t0 + (t1-t0)*pow(x1,pw); }
    else { ta = t0 + (t1-t0)*(1.0-pow(1.0-x0,-pw)); tb = t0 + (t1-t0)*(1.0-pow(1.0-x1,-pw)); }
    float t = 0.5*(ta+tb), dt = tb-ta;
    float K = KO + 2.0*t*od + t*t; float z = zOfK(K);
    vec3 X = O + d*t;
    vec3 sR, sM; vec3 ss = sigS(z, sR, sM); vec3 st = sigT(z);
    vec3 ls; vec3 E = sunIrr(X, K, ls);
    float c = dot(d, ls);
    vec3 J = (sR*phaseR(c) + sM*phaseCS(c,uMieG))*E;
    float mus = dot(-normalize(X), ls);
    vec3 Eu = uSunE0*sq(uSunD0/length(uSunW-X))*towerVis(X, uSunW, uSunRho*40.0);
    J += ss*(msLUT(z, mus)*Eu + Lamb);
    vec3 sT = exp(-st*dt);
    S += T*(J - J*sT)/max(st, vec3(1e-9));
    T *= sT;
  }
  return S;
}`;

/* ---------- 远处内壁的辐亮度（含它头上的云、云影、水面镜面反光、本地天光与空心环境光） ---------- */
const WALL = /* glsl */`
vec3 wallRadiance(vec3 X, vec3 V, vec3 Eamb){
  Geo o = geoOf(X); vec3 n = -normalize(X);
  Mat m = worldMat(o);
  vec3 ls; vec3 E = sunIrr(X, 0.0, ls);
  float ndl = max(dot(n, ls), 0.0);
  vec3 Eun = uSunE0*sq(uSunD0/length(uSunW-X))*sunVis(X);
  vec3 Esky = 0.5*max(Eun - E, vec3(0.0))*(0.5+0.5*ndl);
  vec3 L = m.alb/PI*(E*ndl + Esky + Eamb);
  if (m.water > 0.0){
    vec3 h = normalize(ls + V); float sp = 180.0;
    L += m.water*E*ndl*(sp+8.0)/(8.0*PI)*pow(max(dot(n,h),0.0), sp)*0.025;
  }
  float cov = cloudCover(o.nw);
  if (uCloudOn > 0.5){
    float zc = 0.5*(uCloudB+uCloudT);
    vec3 off = (ls - n*dot(ls,n))*(zc/max(dot(ls,n),0.15));
    float covS = cloudCover(normalize(uCM2W*(X+off)));
    L *= 1.0 - 0.8*covS;
    vec3 Lc = 0.85/PI*(E*(0.45+0.55*ndl) + Esky + Eamb);
    L = mix(L, Lc, cov*0.95);
  }
  return L;
}
vec3 moonRadiance(vec3 X, vec3 d){
  vec3 N = normalize(X - uMoonW);
  vec3 v = uSunW - X; float ds = length(v); vec3 ls = v/ds;
  float mu0 = dot(N, ls), mu = max(dot(N, -d), 0.0);
  float vis = towerVis(X, uSunW, uSunRho);                  // 逐点塔影：月面上会扫过一条半影边
  float mm = fbm3(N*1.7 + 4.0, 4); float alb = uMoonAlb*mix(0.55, 1.3, smoothstep(0.35,0.65,mm));
  float lsT = mu0 > 0.0 ? mix(mu0, 2.0*mu0/(mu0+mu+1e-4), 0.6) : 0.0;
  vec3 E = uSunE0*sq(uSunD0/ds)*vis*lsT;
  return alb/PI*(E + shIrr(N, 2));                           // shIrr(.,2)＝“世界照”：被照亮的内壁照在月上
}`;

/* ---------- 相机/月亮出发的整条辐亮度（探针用） ---------- */
const RADIANCE = /* glsl */`
vec3 radianceCam(vec3 d, bool farOnly){
  float cd = dot(uCamW, d);
  float al = alphaOf(uCamK, cd);
  vec2 ti = tShell(cd, uR - uZtop);
  float tw = tWall(cd);
  vec3 L1 = shAvg(1);
  if (cd < 0.0 && ti.x > 0.0){
    vec3 Tf = vec3(1.0); vec3 Sf = inscatter(uCamW, uCamK, d, ti.y, tw, 6, -2.0, L1, Tf);
    vec3 Lfar = Sf + Tf*wallRadiance(uCamW + d*tw, -d, 2.0*PI*L1);
    float tT = rayCyl(uCamW, d); float tM = raySph(uCamW, d, uMoonW, uMoonRho);
    if (tT > tw) tT = -1.0;
    if (tM > 0.0 && (tT < 0.0 || tM < tT)) Lfar = moonRadiance(uCamW + d*tM, d);
    else if (tT > 0.0) Lfar = vec3(0.0);
    vec3 Tn = exp(-max(chordW(al,1e9) - chordW(al, uCamZ), vec3(0.0)));
    if (farOnly) return Tn*Lfar;
    vec3 Ta = vec3(1.0); vec3 Sn = inscatter(uCamW, uCamK, d, 0.0, ti.x, 6, 2.0, L1, Ta);
    return Sn + Tn*Lfar;
  }
  if (farOnly) return vec3(0.0);
  if (cd > 0.0){
    vec3 n = -normalize(uCamW); vec3 ls; vec3 E = sunIrr(uCamW, uCamK, ls);
    return uGroundAlb/PI*(E*max(dot(n,ls),0.0) + PI*L1);
  }
  vec3 Ta = vec3(1.0); vec3 Sn = inscatter(uCamW, uCamK, d, 0.0, tw, 8, 2.0, L1, Ta);
  return Sn + Ta*wallRadiance(uCamW + d*tw, -d, 2.0*PI*L1);
}
vec3 radianceMoon(vec3 d){
  vec3 O = uMoonW; float KO = dot(O,O) - uR*uR; float od = dot(O,d);
  float Rt = uR - uZtop; float tIn = -od + sqrt(max(od*od - (dot(O,O) - Rt*Rt), 0.0));
  float tw = -od + sqrt(max(od*od - KO, 0.0));
  float tT = rayCyl(O, d);
  if (tT > 0.0 && tT < tw) return vec3(0.0);
  vec3 L1 = shAvg(1);
  vec3 Tf = vec3(1.0); vec3 Sf = inscatter(O, KO, d, tIn, tw, 6, -2.0, L1, Tf);
  return Sf + Tf*wallRadiance(O + d*tw, -d, 2.0*PI*L1);
}`;

const P = {};
P.full = VS_FULL;

/* 1. 弦表：RGB＝光学厚度 W(alphaW, z) */
P.tau = C + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  vec2 uv = clamp((vUv - 0.5/uTauSize)/(1.0-1.0/uTauSize), 0.0, 1.0);
  float al = uv.x*uv.x*0.5*PI;
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  float z = uv.y*uv.y*zmax;
  float b = uR*cos(al), xR = uR*sinS(al);
  float xz = sqrt(max(xR*xR - z*(2.0*uR - z), 0.0));   // (R−z)²−b² 不相减
  float span = z*(2.0*uR - z)/max(xR + xz, 1e-6);   // xR − x(z)，不相减
  vec3 tau = vec3(0.0);
  const int N = 192;
  for (int i=0;i<N;i++){
    float s0 = float(i)/float(N), s1 = float(i+1)/float(N), sm = 0.5*(s0+s1);
    float dx = span*(sq(1.0-s0) - sq(1.0-s1));
    float dxR = span*sq(1.0-sm); float x = xR - dxR;
    float rho = sqrt(b*b + x*x);
    float zz = dxR*(xR + x)/(uR + rho);
    tau += sigT(zz)*dx;
  }
  oc = vec4(tau, 1.0);
}`;

/* 2. 多次散射表（Hillaire 2020 改凹面）：Ψms(z, μs)，单位太阳照度 */
P.ms = C + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5)/(uMsSize - 1.0);
  float mus = uv.x; float z = uv.y*uv.y*uZtop;
  float r = uR - z; vec3 P0 = vec3(0.0, -r, 0.0);      // 内法线＝+y
  vec3 ls = vec3(sqrt(max(1.0-mus*mus,0.0)), mus, 0.0);
  float K0 = -z*(2.0*uR - z);
  float Rt = uR - uZtop;
  vec3 L2 = vec3(0.0), Fm = vec3(0.0);
  const int ND = 64; const int NS = 24;
  for (int i=0;i<ND;i++){
    float fy = 1.0 - (float(i)+0.5)*2.0/float(ND); float rr = sqrt(max(1.0-fy*fy,0.0)); float ph = float(i)*2.39996323;
    vec3 w = vec3(rr*cos(ph), fy, rr*sin(ph));
    float pd = dot(P0, w);
    float tw = -pd + sqrt(max(pd*pd - K0, 0.0));
    float cT = K0 + (uR-Rt)*(uR+Rt); float disc = pd*pd - cT;
    bool ex = pd < 0.0 && disc > 0.0;
    float tEnd = ex ? (-pd - sqrt(disc)) : tw;
    vec3 T = vec3(1.0), Lw = vec3(0.0), Fw = vec3(0.0);
    for (int j=0;j<NS;j++){
      float a0 = float(j)/float(NS), a1 = float(j+1)/float(NS);
      float t = tEnd*sq(0.5*(a0+a1)), dt = tEnd*(a1*a1 - a0*a0);
      vec3 X = P0 + w*t; float Kx = K0 + 2.0*t*pd + t*t; float zx = zOfK(Kx);
      vec3 sR, sM; vec3 ss = sigS(zx, sR, sM); vec3 st = sigT(zx);
      vec3 sT = exp(-st*dt);
      vec3 Sint = (ss - ss*sT)/max(st, vec3(1e-9));
      Lw += T*Sint*sunTrans(X, Kx, ls)*(1.0/(4.0*PI));
      Fw += T*Sint;
      T *= sT;
    }
    if (!ex){ vec3 X = P0 + w*tEnd; vec3 ng = -normalize(X); Lw += T*uGroundAlb/PI*max(dot(ng,ls),0.0)*sunTrans(X, 0.0, ls); }
    L2 += Lw; Fm += Fw;
  }
  L2 /= float(ND); Fm /= float(ND);
  oc = vec4(L2/max(vec3(1.0) - Fm, vec3(1e-3)), 1.0);
}`;

/* 3. 探针：32×16 等面积经纬，三行（相机全天/相机大气外/月亮） */
P.probe = C + INSCATTER + WALL + RADIANCE + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); int row = ij.y/16;
  vec2 uv = (vec2(float(ij.x), float(ij.y - row*16)) + 0.5)/vec2(32.0,16.0);
  float ph = uv.x*2.0*PI, ct = 1.0 - 2.0*uv.y, st = sqrt(max(1.0-ct*ct,0.0));
  vec3 d = vec3(st*cos(ph), ct, st*sin(ph));
  vec3 L = row == 2 ? radianceMoon(d) : radianceCam(d, row == 1);
  oc = vec4(min(L, vec3(5000.0)), 1.0);
}`;
/* 4. 探针 → 9 个球谐系数（9×3） */
P.sh = /* glsl */`
precision highp float; uniform sampler2D tProbe; in vec2 vUv; layout(location=0) out vec4 oc;
float Y(int i, vec3 d){
  if (i==0) return 0.2820948; if (i==1) return 0.4886025*d.y; if (i==2) return 0.4886025*d.z; if (i==3) return 0.4886025*d.x;
  if (i==4) return 1.0925484*d.x*d.y; if (i==5) return 1.0925484*d.y*d.z; if (i==6) return 0.3153916*(3.0*d.z*d.z-1.0);
  if (i==7) return 1.0925484*d.x*d.z; return 0.5462742*(d.x*d.x-d.y*d.y);
}
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); int ci = ij.x, row = ij.y; vec3 acc = vec3(0.0);
  for (int y=0;y<16;y++) for (int x=0;x<32;x++){
    vec2 uv = (vec2(float(x),float(y))+0.5)/vec2(32.0,16.0);
    float ph = uv.x*6.2831853, ct = 1.0 - 2.0*uv.y, st = sqrt(max(1.0-ct*ct,0.0));
    acc += texelFetch(tProbe, ivec2(x, row*16+y), 0).rgb*Y(ci, vec3(st*cos(ph), ct, st*sin(ph)));
  }
  oc = vec4(acc*(12.566371/512.0), 1.0);
}`;

/* 5. 远场（半分辨率）：低空贴地起伏的步进求交 / 穿出大气→对面大气→对面内壁。
 *    rgb＝已乘近段大气透过的背景辐亮度；a＝−1 表示“看得见真空”（塔、月、日可能出现），否则＝命中距离 km。 */
P.far = C + INSCATTER + WALL + /* glsl */`
uniform float uMeshR; uniform float uHmax; uniform int uReliefN; uniform int uFarN;
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  vec3 d = rayDir(vUv); float cd = dot(uCamW, d);
  float al = alphaOf(uCamK, cd);
  vec3 cumCam = cumTau(al, uCamZ, cd);
  float tw = tWall(cd);
  vec3 L1 = shAvg(1);
  // ---- 贴地起伏：只有从网格边缘起仍处在起伏层里的掠射线才步进 ----
  float t = uMeshR*0.92;
  float tHit = -1.0;
  {
    float K = uCamK + 2.0*t*cd + t*t; float z = zOfK(K);
    if (z < uHmax && t < tw){
      float tPrev = t, dPrev = 1.0;
      for (int i=0;i<96;i++){
        if (i >= uReliefN) break;
        K = uCamK + 2.0*t*cd + t*t; z = zOfK(K);
        vec3 X = uCamW + d*t;
        float dz = z - reliefH(X);
        if (dz < 0.0){
          float a = tPrev, b = t;
          for (int k=0;k<5;k++){ float m = 0.5*(a+b); float Km = uCamK + 2.0*m*cd + m*m; if (zOfK(Km) - reliefH(uCamW + d*m) < 0.0) b = m; else a = m; }
          tHit = 0.5*(a+b); break;
        }
        if (z > uHmax && t < -cd) break;           // 已升出起伏层且仍在上升
        if (t >= tw) { tHit = tw; break; }
        tPrev = t; dPrev = dz;
        t += max(dz*0.5, t*0.006);
        t = min(t, tw);
      }
    }
  }
  if (tHit > 0.0){
    vec3 X = uCamW + d*tHit; float K = uCamK + 2.0*tHit*cd + tHit*tHit;
    // 法线：在切平面上差分
    vec3 nS = -normalize(X); vec3 e1 = normalize(cross(nS, vec3(0.0,1.0,0.0))); vec3 e2 = cross(e1, nS);
    float dl = 0.02 + tHit*0.002;
    float h0 = reliefH(X), h1 = reliefH(X + e1*dl), h2 = reliefH(X + e2*dl);
    vec3 n = normalize(nS - e1*(h1-h0)/dl - e2*(h2-h0)/dl);
    Geo o = geoOf(X);
    vec3 Ug = -normalize(vec3(X.x,0.0,X.z));
    vec3 alb = groundAlbedo(o, dot(n,Ug), fbm3(o.nw*(uR/3.0),3), fbm3(o.nw*(uR/0.9)+0.5,2));
    vec3 ls; vec3 E = sunIrr(X, K, ls);
    if (uCloudOn > 0.5){ float zc = 0.5*(uCloudB+uCloudT); vec3 off = (ls - nS*dot(ls,nS))*(zc/max(dot(ls,nS),0.15)); E *= 1.0 - 0.85*cloudCover(normalize(uCM2W*(X+off))); }
    vec3 Ls = alb/PI*(E*max(dot(n,ls),0.0) + shIrr(n, 0));
    float pdH = dot(X, d);
    vec3 Tseg = exp(-max(cumTau(al, zOfK(K), pdH) - cumCam, vec3(0.0)));
    oc = vec4(min(Tseg*Ls, vec3(60000.0)), tHit); return;
  }
  // ---- 穿出大气：对面大气＋对面内壁 ----
  vec2 ti = tShell(cd, uR - uZtop);
  if (cd < 0.0 && ti.x > 0.0){
    vec3 Tn = exp(-max(chordW(al,1e9) - chordW(al, uCamZ), vec3(0.0)));
    // 塔的两端（塔根、塔顶）插在对面内壁的大气里：这一段由远场积分到塔面为止，合成 pass 只在真空段画塔
    float tT = rayCyl(uCamW, d);
    bool towerFar = tT > ti.y && tT < tw;
    vec3 Tf = vec3(1.0); vec3 Sf = inscatter(uCamW, uCamK, d, ti.y, towerFar ? tT : tw, uFarN, -2.0, L1, Tf);
    vec3 Lend = towerFar ? uTowerAlb*2.0*L1 : wallRadiance(uCamW + d*tw, -d, 2.0*PI*L1);
    oc = vec4(min(Tn*(Sf + Tf*Lend), vec3(60000.0)), -1.0); return;
  }
  // ---- 掠射弦：整条留在大气里，直到另一处内壁 ----
  vec3 Tseg = exp(-max(cumTau(al, 0.0, 1.0) - cumCam, vec3(0.0)));
  oc = vec4(min(Tseg*wallRadiance(uCamW + d*tw, -d, 2.0*PI*L1), vec3(60000.0)), tw);
}`;

/* 6. 近段（半分辨率）：相机→(穿出大气顶 | 远场命中点) 的大气＋本地云层。rgb＝内散射，a＝云的透过率 */
P.near = C + /* glsl */`
uniform sampler2D tFar; uniform int uNearN; uniform int uCloudN; uniform float uJit;
in vec2 vUv; layout(location=0) out vec4 oc;
float cloudDens(vec3 X, float z){
  float hf = (z - uCloudB)/(uCloudT - uCloudB);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec3 Pw = uCM2W*X; vec3 nw = normalize(Pw);
  float cov = cloudCover(nw); if (cov <= 0.0) return 0.0;
  float prof = smoothstep(0.0,0.18,hf)*smoothstep(1.0,0.55,hf);
  vec3 q = Pw*(1.0/14.0) + vec3(uTime*0.004, 0.0, uTime*0.0017);
  vec4 nn = textureLod(uNoise3, q, 0.0);
  float base = nn.r*0.65 + nn.g*0.35;
  float det = textureLod(uNoise3, q*4.7, 0.0).g;
  float dd = cov*prof - (1.0-base)*0.85*(1.0 - 0.5*cov) - (1.0-det)*0.12;
  return clamp(dd*3.0, 0.0, 1.0)*uCloudSig;
}
void integ(float t0, float t1, int N, float pw, bool cl, vec3 d, float cd, inout vec3 S, inout vec3 Ta, inout float Tc, vec3 L1, vec3 L0){
  for (int i=0;i<48;i++){
    if (i >= N) break;
    float x0 = float(i)/float(N), x1 = float(i+1)/float(N);
    float ta = t0 + (t1-t0)*pow(x0,pw), tb = t0 + (t1-t0)*pow(x1,pw);
    float t = mix(ta, tb, uJit), dt = tb - ta;
    float K = uCamK + 2.0*t*cd + t*t; float z = zOfK(K);
    vec3 X = uCamW + d*t;
    vec3 sR, sM; vec3 ss = sigS(z, sR, sM); vec3 st = sigT(z);
    vec3 ls; vec3 E = sunIrr(X, K, ls); float c = dot(d, ls);
    vec3 J = (sR*phaseR(c) + sM*phaseCS(c, uMieG))*E;
    float mus = dot(-normalize(X), ls);
    vec3 Eu = uSunE0*sq(uSunD0/length(uSunW-X))*towerVis(X, uSunW, uSunRho*40.0);
    J += ss*(msLUT(z, mus)*Eu + L1);
    float sc = 0.0;
    if (cl){
      sc = cloudDens(X, z);
      if (sc > 0.0){
        float tau = 0.0; float pd = dot(X, ls);
        for (int j=0;j<3;j++){ float dd = j==0 ? 0.15 : (j==1 ? 0.5 : 1.2); float wl = j==0 ? 0.3 : (j==1 ? 0.5 : 1.0);
          float Ky = K + 2.0*dd*pd + dd*dd; tau += cloudDens(X + ls*dd, zOfK(Ky))*wl; }
        float hf = clamp((z - uCloudB)/(uCloudT - uCloudB), 0.0, 1.0);
        vec3 Jc = vec3(0.0); float a = 1.0, b = 1.0, g = 1.0;
        for (int o=0;o<3;o++){ Jc += a*E*exp(-b*tau)*mix(phaseHG(c,0.8*g), phaseHG(c,-0.25*g), 0.25); a *= 0.5; b *= 0.4; g *= 0.5; }
        Jc += L0*(0.35 + 0.65*hf);
        J += sc*Jc;
      }
    }
    vec3 stT = st + vec3(sc);
    vec3 sT = exp(-stT*dt);
    S += Ta*Tc*(J - J*sT)/max(stT, vec3(1e-9));
    Ta *= exp(-st*dt); Tc *= exp(-sc*dt);
  }
}
void main(){
  vec3 d = rayDir(vUv); float cd = dot(uCamW, d);
  float fa = texelFetch(tFar, ivec2(gl_FragCoord.xy), 0).a;
  float tEnd = fa >= 0.0 ? fa : tShell(cd, uR - uZtop).x;
  if (!(tEnd > 0.0)) tEnd = tWall(cd);
  vec3 L1 = shAvg(1), L0 = shAvg(0);
  vec3 S = vec3(0.0), Ta = vec3(1.0); float Tc = 1.0;
  float c0 = -1.0, c1 = -1.0;
  if (uCloudOn > 0.5){
    float cB = uCamK + uCloudB*(2.0*uR - uCloudB), dB = cd*cd - cB;
    float cT = uCamK + uCloudT*(2.0*uR - uCloudT), dT = cd*cd - cT;
    if (uCamZ < uCloudB){
      if (cd < 0.0 && dB >= 0.0){ c0 = -cd - sqrt(dB); c1 = dT >= 0.0 ? -cd - sqrt(dT) : -cd + sqrt(dB); }
    } else if (uCamZ < uCloudT){
      c0 = 0.0; c1 = (cd < 0.0 && dT >= 0.0) ? -cd - sqrt(dT) : (dB >= 0.0 ? -cd + sqrt(dB) : 60.0);
    }
  }
  if (c0 >= 0.0 && c0 < tEnd){
    c1 = min(c1, tEnd);
    if (c0 > 0.0) integ(0.0, c0, uNearN/2, 2.0, false, d, cd, S, Ta, Tc, L1, L0);
    integ(c0, c1, uCloudN, 1.0, true, d, cd, S, Ta, Tc, L1, L0);
    integ(c1, tEnd, uNearN/2, 2.0, false, d, cd, S, Ta, Tc, L1, L0);
  } else {
    integ(0.0, tEnd, uNearN, 2.0, false, d, cd, S, Ta, Tc, L1, L0);
  }
  oc = vec4(min(S, vec3(60000.0)), Tc);
}`;

/* 7. 全分辨率合成：塔、月、日盘用解析求交（4 子样抗锯齿），远场/近段从半分辨率上采样 */
P.composite = C + INSCATTER + WALL + /* glsl */`
uniform sampler2D tFar; uniform sampler2D tNear; uniform vec2 uLowSize; uniform vec2 uPix;
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  vec2 uv = vUv; vec3 d = rayDir(uv);
  vec2 st = uv*uLowSize - 0.5; vec2 i0 = floor(st); vec2 f = st - i0;
  vec3 farc = vec3(0.0); float wsky = 0.0;
  for (int k=0;k<4;k++){
    vec2 o = vec2(float(k & 1), float(k >> 1));
    ivec2 ij = ivec2(clamp(i0+o, vec2(0.0), uLowSize-1.0));
    vec4 v = texelFetch(tFar, ij, 0);
    float w = mix(1.0-f.x, f.x, o.x)*mix(1.0-f.y, f.y, o.y);
    farc += v.rgb*w; wsky += (v.a < 0.0 ? 1.0 : 0.0)*w;
  }
  vec4 nr = texture(tNear, uv);
  vec3 L = farc;
  if (wsky > 0.0){
    float cd = dot(uCamW, d); float al = alphaOf(uCamK, cd);
    vec3 Tn = exp(-max(chordW(al,1e9) - chordW(al, uCamZ), vec3(0.0)));
    float covT = 0.0, covM = 0.0; vec3 Lm = vec3(0.0);
    for (int s=0;s<4;s++){
      vec2 jo = (vec2(float(s & 1), float(s >> 1)) - 0.5)*0.5*uPix;
      vec3 ds = rayDir(uv + jo);
      float tT = rayCyl(uCamW, ds), tM = raySph(uCamW, ds, uMoonW, uMoonRho);
      float cds = dot(uCamW, ds);
      if (tT > tShell(cds, uR - uZtop).y) tT = -1.0;           // 塔面落在对面大气里（或内壁之外）：远场已经画了
      if (tM > 0.0 && (tT < 0.0 || tM < tT)) { covM += 0.25; Lm += 0.25*moonRadiance(uCamW + ds*tM, ds); }
      else if (tT > 0.0) covT += 0.25;
    }
    float occ = covT + covM;
    vec3 Locc = Lm + covT*uTowerAlb*2.0*shAvg(1);
    vec3 vs = uSunW - uCamW; float dsun = length(vs); float rs = uSunRho/dsun;
    float ang = 2.0*asin(clamp(0.5*length(d - vs/dsun), 0.0, 1.0));
    float pa = max(length(fwidth(d)), 1e-5);
    float mask = clamp((rs - ang)/pa + 0.5, 0.0, 1.0);
    float mu = sqrt(max(1.0 - sq(min(ang/rs,1.0)), 0.0));
    vec3 Lsun = uSunE0*sq(uSunD0/uSunRho)/PI*(1.0 - 0.6*(1.0-mu))/0.8;
    L = farc*(1.0 - wsky*occ) + wsky*Tn*(Locc + (1.0-occ)*mask*Lsun);
  }
  vec3 col = nr.rgb + nr.a*L;
  float ePre = texelFetch(uExpTex, ivec2(0), 0).r;
  oc = vec4(min(col*ePre, vec3(60000.0)), 1.0);
}`;

/* 8. 近处地形网格：指数网格、阶地/斜坡两种模式、逐顶点空气透视 */
P.terrainV = C + INSCATTER + /* glsl */`
uniform float uPsiG; uniform float uRG; uniform vec3 uCamOff; uniform float uStairF0; uniform float uStairK0;
uniform float uMeshR; uniform float uMeshD0; uniform float uLogFC; uniform vec3 uG;
out vec3 vRel; out vec3 vNrm; out vec3 vAPs; out vec3 vAPt; out vec3 vNw; out float vPsi;
vec3 gridRel(vec2 g, out vec3 nP, out float psi, out float sOff){
  float k = log(1.0 + uMeshR/uMeshD0);
  vec2 e = sign(g)*uMeshD0*(exp(k*abs(g)) - 1.0);
  float dpsi = -e.y/uR, dlam = -e.x/uRG;
  psi = uPsiG + dpsi;
  float sp = sin(psi), cp = cos(psi), s2 = sinS(0.5*dpsi), sl = sinS(dlam);
  float a = 2.0*cos(uPsiG + 0.5*dpsi)*s2, b = 2.0*sin(uPsiG + 0.5*dpsi)*s2, omc = 2.0*sq(sinS(0.5*dlam));
  nP = vec3(-sp*(1.0-omc), cp, -sp*sl);
  sOff = -e.y;
  return uR*vec3(a - sp*omc, b, sp*sl);
}
float meshH(float sOff, float psi, vec3 nw){
  float q = min(psi, PI-psi);
  float h = terrAmp(1.4*sin(q))*terrNoise(nw)*(uStairOn > 0.5 ? 0.35 : 1.0);
  if (uStairOn > 0.5){
    float x = uStairF0 + sOff/(uStairD*uR); float kk = floor(x);
    h += stairProfile(x-kk, (uStairK0+kk)*uStairD, uStairD) - 0.25*uStairD*uR*sin(2.0*(0.5*PI-q));
  }
  return h;
}
vec3 vtx(vec2 g, out vec3 nw, out float psi){
  vec3 nP; float sOff; vec3 rel = gridRel(g, nP, psi, sOff);
  nw = normalize(uCM2W*(uG + rel));
  return rel + nP*meshH(sOff, psi, nw) - uCamOff;
}
void main(){
  vec3 nw; float psi;
  vec3 p = vtx(position.xy, nw, psi);
  float dg = 0.5/` + 'float(GRIDN)' + /* glsl */`;
  vec3 nw2; float ps2;
  vec3 px = vtx(position.xy + vec2(dg,0.0), nw2, ps2) - vtx(position.xy - vec2(dg,0.0), nw2, ps2);
  vec3 py = vtx(position.xy + vec2(0.0,dg), nw2, ps2) - vtx(position.xy - vec2(0.0,dg), nw2, ps2);
  vec3 n = normalize(cross(px, py)); if (dot(n, -normalize(uCamW + p)) < 0.0) n = -n;
  vRel = p; vNrm = n; vNw = nw; vPsi = psi;
  float dist = length(p); vec3 dir = p/max(dist,1e-6);
  vec3 Ta = vec3(1.0); vAPs = inscatter(uCamW, uCamK, dir, 0.0, dist, 8, 1.5, shAvg(1), Ta); vAPt = Ta;
  gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0);   // 网格只到 uMeshR，普通深度够用；顶点版对数深度会把跨到相机背后的三角形翻到屏上
}`;
P.terrainF = C + /* glsl */`
in vec3 vRel; in vec3 vNrm; in vec3 vAPs; in vec3 vAPt; in vec3 vNw; in float vPsi;
layout(location=0) out vec4 oc;
void main(){
  vec3 n = normalize(vNrm);
  vec3 X = uCamW + vRel; float K = uCamK + 2.0*dot(uCamW, vRel) + dot(vRel, vRel);
  vec3 Ug = -normalize(vec3(X.x, 0.0, X.z));
  Geo o; o.nw = vNw; o.psi = vPsi; o.q = min(vPsi, PI-vPsi); o.lat = 0.5*PI - o.q; o.g = 1.4*sin(o.q);
  float det = fbm3(vNw*(uR/3.0), 3), det2 = fbm3(vNw*(uR/0.25) + 0.5, 3);
  // 细节法线（贴图级）
  vec3 q = vNw*(uR/0.06); float e = 0.02;
  float h0 = nz(q), hx = nz(q + vec3(e,0.0,0.0)), hy = nz(q + vec3(0.0,e,0.0)), hz = nz(q + vec3(0.0,0.0,e));
  vec3 gn = vec3(hx-h0, hy-h0, hz-h0)/e; gn -= n*dot(gn,n);
  n = normalize(n - gn*0.015);
  vec3 alb = groundAlbedo(o, dot(n, Ug), det, det2)*(0.8 + 0.4*h0);
  vec3 ls; vec3 E = sunIrr(X, K, ls);
  if (uCloudOn > 0.5){ vec3 nS = -normalize(X); float zc = 0.5*(uCloudB+uCloudT); vec3 off = (ls - nS*dot(ls,nS))*(zc/max(dot(ls,nS),0.15)); E *= 1.0 - 0.85*cloudCover(normalize(uCM2W*(X+off))); }
  vec3 L = alb/PI*(E*max(dot(n,ls),0.0) + shIrr(n, 0));
  vec3 col = L*vAPt + vAPs;
  float ePre = texelFetch(uExpTex, ivec2(0), 0).r;
  oc = vec4(min(col*ePre, vec3(60000.0)), 1.0);
}`;

/* 9. 测光与适应 */
P.meter = /* glsl */`
precision highp float; uniform sampler2D tHDR; uniform sampler2D uExpTex; in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  float e = texelFetch(uExpTex, ivec2(0), 0).r; vec2 px = 1.0/vec2(64.0,32.0);
  float s = 0.0;
  for (int i=0;i<4;i++){ vec2 o = (vec2(float(i&1), float(i>>1)) - 0.5)*0.5*px; vec3 c = texture(tHDR, vUv + o).rgb/e; s += log2(max(dot(c, vec3(0.2126,0.7152,0.0722)), 1e-7)); }
  vec2 cc = (vUv - 0.5)*vec2(1.6, 2.2); float w = exp(-dot(cc,cc)*1.5) + 0.15;
  oc = vec4(0.25*s*w, w, 0.0, 1.0);
}`;
P.adapt = /* glsl */`
precision highp float; uniform sampler2D tMeter; uniform sampler2D uExpTex; uniform sampler2D tNear;
uniform float uDt; uniform float uEvBias; uniform vec2 uSunUV; uniform float uSunEye;
in vec2 vUv; layout(location=0) out vec4 oc;
void main(){
  float sw = 0.0, sl = 0.0;
  for (int y=0;y<32;y++) for (int x=0;x<64;x++){ vec4 m = texelFetch(tMeter, ivec2(x,y), 0); sl += m.r; sw += m.g; }
  float Lavg = exp2(sl/sw);                               // 场景单位（千 cd/m²）
  float lg = log(Lavg*1000.0)/log(10.0);
  float key = mix(0.045, 0.16, smoothstep(-1.5, 2.5, lg)); // 人眼：暗处适应不完全
  float target = clamp(key/Lavg*exp2(uEvBias), 1e-5, 2e4);
  float prev = texelFetch(uExpTex, ivec2(0), 0).r;
  float tau = target > prev ? 2.2 : 0.5;
  float e = prev <= 0.0 ? target : exp(mix(log(prev), log(target), 1.0 - exp(-uDt/tau)));
  float tc = (uSunUV.x > 0.0 && uSunUV.x < 1.0 && uSunUV.y > 0.0 && uSunUV.y < 1.0) ? texture(tNear, uSunUV).a : 1.0;
  oc = vec4(e, uSunEye*tc, Lavg, 1.0);
}`;
P.bloomDown = /* glsl */`
precision highp float; uniform sampler2D tSrc; uniform vec2 uTexel; in vec2 vUv; layout(location=0) out vec4 oc;
void main(){ vec3 c = vec3(0.0); for (int i=0;i<4;i++){ vec2 o = (vec2(float(i&1), float(i>>1)) - 0.5)*2.0*uTexel; c += texture(tSrc, vUv + o).rgb; } oc = vec4(c*0.25, 1.0); }`;
P.blur = /* glsl */`
precision highp float; uniform sampler2D tSrc; uniform vec2 uDir; in vec2 vUv; layout(location=0) out vec4 oc;
void main(){ const float w[5] = float[5](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);
  vec3 c = texture(tSrc, vUv).rgb*w[0]; for (int i=1;i<5;i++){ c += (texture(tSrc, vUv + uDir*float(i)).rgb + texture(tSrc, vUv - uDir*float(i)).rgb)*w[i]; } oc = vec4(c, 1.0); }`;
/* 10. 色调映射：再曝光、人眼眩光（CIE 失能眩光 L=10E/θ²）、Purkinje 暗视、ACES、抖动 */
P.tonemap = C + /* glsl */`
uniform sampler2D tHDR; uniform sampler2D tBloom; uniform sampler2D tExpNew; uniform float uBloom; uniform float uGlare; uniform vec3 uSunDir;
in vec2 vUv; layout(location=0) out vec4 oc;
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrt(vec3 v){ vec3 a = v*(v + 0.0245786) - 0.000090537; vec3 b = v*(0.983729*v + 0.4329510) + 0.238081; return a/b; }
void main(){
  float eA = texelFetch(uExpTex, ivec2(0), 0).r; vec4 ex = texelFetch(tExpNew, ivec2(0), 0); float eB = ex.r;
  vec3 col = texture(tHDR, vUv).rgb*(eB/eA) + texture(tBloom, vUv).rgb*(eB/eA)*uBloom;
  vec3 d = rayDir(vUv);
  float th = degrees(2.0*asin(clamp(0.5*length(d - uSunDir), 0.0, 1.0)));
  col += uGlare*10.0*ex.g/(th*th + 0.15)*eB*vec3(1.0, 0.97, 0.92);
  float La = 1000.0*ex.b;                                  // 适应亮度 cd/m²
  float s = 1.0 - smoothstep(-2.0, 0.5, log(max(La,1e-6))/log(10.0));
  float Ys = dot(col, vec3(0.06, 0.55, 0.39));
  col = mix(col, Ys*vec3(0.78, 0.90, 1.18), 0.85*s);
  col = clamp(ACESOut*rrt(ACESIn*col), 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  float n = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  oc = vec4(col + (n - 0.5)/255.0, 1.0);
}`;
window.PASSES = P;
})();
