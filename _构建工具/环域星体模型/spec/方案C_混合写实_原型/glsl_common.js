/* 方案C · 混合写实渲染 —— 公共 GLSL（GLSL ES 3.00，供 three r128 ShaderMaterial{glslVersion:GLSL3} 拼接）
 * 坐标：CM 系＝把星体地固系绕塔轴转到“相机经度＝0”。原点＝球心，+y＝塔轴指向塔顶，塔根极 (0,-R,0)。
 *       相机在 (r,y,0) 附近；U＝(-1,0,0) 指向塔轴（重力的“上”），N＝(0,-1,0) 朝塔根，E＝(0,0,-1)。
 * 单位：长度 km；亮度“场景单位”1 ＝ 1000 cd/m²，照度 1 ＝ 1000 lux（太阳 127 ＝ 127 klux）。
 * 精度：凡是“离内壁的高度”，一律用 K＝|p|²−R²（相机的 K 由 CPU 用双精度算好）推出，不做 R−|p| 相减。 */
window.GLSL_COMMON = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
#define PI 3.14159265359
uniform float uR; uniform float uA; uniform float uZtop;
uniform vec3 uBetaR; uniform vec3 uBetaMs; uniform vec3 uBetaMa;
uniform float uHR; uniform float uHM; uniform float uMieG;
uniform sampler2D uTauLUT; uniform vec2 uTauSize;
uniform sampler2D uMsLUT;  uniform vec2 uMsSize;
uniform sampler2D uSH;
uniform sampler2D uExpTex;
uniform sampler3D uNoise3;
uniform vec3 uSunW; uniform float uSunRho; uniform vec3 uSunE0; uniform float uSunD0;
uniform vec3 uMoonW; uniform float uMoonRho; uniform float uMoonAlb;
uniform vec3 uCamW; uniform float uCamK; uniform float uCamZ;
uniform mat4 uInvVP; uniform mat3 uCM2W;
uniform float uTime; uniform float uGroundAlb; uniform float uTowerAlb;
uniform float uStairOn; uniform float uStairD; uniform float uTerrAmp;
uniform float uCloudOn; uniform float uCloudB; uniform float uCloudT; uniform float uCloudSig; uniform float uCloudCov;
uniform vec3 uZuiyuN; uniform float uZuiyuOvc;
uniform float uAbyssHalf;

float sq(float x){ return x*x; }
// GPU 的 sin 只保证绝对误差（~4e-7），小角度必须用级数，否则阶地相位、网格位移、弦表全会塌
float sinS(float x){ return abs(x) < 0.02 ? x*(1.0 - x*x*(1.0/6.0)*(1.0 - x*x*0.05)) : sin(x); }
vec3 sigT(float z){ return uBetaR*exp(-z/uHR) + (uBetaMs+uBetaMa)*exp(-z/uHM); }
vec3 sigS(float z, out vec3 sR, out vec3 sM){ sR = uBetaR*exp(-z/uHR); sM = uBetaMs*exp(-z/uHM); return sR+sM; }
float phaseR(float c){ return 0.0596831*(1.0+c*c); }
float phaseCS(float c, float g){ float g2=g*g; return 0.1193662*(1.0-g2)*(1.0+c*c)/((2.0+g2)*pow(max(1.0+g2-2.0*g*c,1e-4),1.5)); }
float phaseHG(float c, float g){ float g2=g*g; return 0.0795775*(1.0-g2)/pow(max(1.0+g2-2.0*g*c,1e-4),1.5); }

/* ---------------- 弦表（chord LUT） ----------------
 * 凹面世界里每条视线都是内壁的一根弦。弦由它在内壁处与切面的夹角 alphaW 决定（等价于离球心的冲距 b＝R cos alphaW）。
 * W(alphaW, z)＝从弦上高度 z 的点沿弦“向外”走到内壁的光学厚度（两半对称）。
 * 任一点在弦上的累计光学厚度（从弦的起点那一端内壁算起）：未过弦中点＝W(z)，过了＝2W(顶)−W(z)。 */
vec3 chordW(float al, float z){
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  vec2 uv = vec2(sqrt(clamp(al/(0.5*PI),0.0,1.0)), sqrt(clamp(z/max(zmax,1e-6),0.0,1.0)));
  uv = uv*(1.0-1.0/uTauSize) + 0.5/uTauSize;
  return textureLod(uTauLUT, uv, 0.0).rgb;
}
float zOfK(float K){ return -K/(uR + sqrt(max(uR*uR+K, 0.0))); }
float alphaOf(float K, float pd){ return asin(clamp(sqrt(max(pd*pd-K,0.0))/uR, 0.0, 1.0)); }
vec3 cumTau(float al, float z, float pd){ vec3 w = chordW(al,z); return pd < 0.0 ? w : 2.0*chordW(al,1e9) - w; }
// 点 X（K＝|X|²−R²）到太阳方向 ls 的大气透过率；太阳在真空区里，这条线必然“朝里走”并穿出大气顶
vec3 sunTrans(vec3 X, float K, vec3 ls){
  float al = alphaOf(K, dot(X, ls));
  return exp(-max(chordW(al,1e9) - chordW(al, zOfK(K)), vec3(0.0)));
}

/* ---------------- 遮挡：塔（无限长圆柱，只看水平投影）与月（日食） ---------------- */
float diskFrac(float u){ u = clamp(u,-1.0,1.0); return 0.5 + (u*sqrt(1.0-u*u) + asin(u))/PI; }
// 从 X 看半径 rho 的光盘（中心 S）露在塔外的面积比例；rho 放大即得“软塔影”（多次散射用）
float towerVis(vec3 X, vec3 S, float rho){
  vec2 x = X.xz; vec2 D = S.xz - x; float L = length(D); vec2 dn = D/max(L,1e-6);
  float tc = -dot(x, dn);
  if (tc <= 0.0 || tc >= L) return 1.0;
  float dp = abs(x.x*dn.y - x.y*dn.x);
  float Dt = sqrt(max(dot(x,x) - uA*uA, 1.0));
  return diskFrac((dp - uA)/Dt * L / rho);
}
float lensCover(float r1, float r2, float c){
  if (c >= r1 + r2) return 0.0;
  if (c <= abs(r2 - r1)) return r2 >= r1 ? 1.0 : sq(r2/r1);
  float a1 = acos(clamp((c*c + r1*r1 - r2*r2)/(2.0*c*r1),-1.0,1.0));
  float a2 = acos(clamp((c*c + r2*r2 - r1*r1)/(2.0*c*r2),-1.0,1.0));
  return (r1*r1*(a1 - 0.5*sin(2.0*a1)) + r2*r2*(a2 - 0.5*sin(2.0*a2)))/(PI*r1*r1);
}
float moonCoverSun(vec3 X){
  vec3 vs = uSunW - X, vm = uMoonW - X; float ls = length(vs), lm = length(vm);
  if (lm >= ls) return 0.0;
  float c = 2.0*asin(clamp(0.5*length(vs/ls - vm/lm),0.0,1.0));
  return lensCover(uSunRho/ls, uMoonRho/lm, c);
}
float sunVis(vec3 X){ return towerVis(X, uSunW, uSunRho)*(1.0 - moonCoverSun(X)); }
// X 处垂直于日光的照度（已含塔影、月食、距离平方、大气透过）
vec3 sunIrr(vec3 X, float K, out vec3 ls){
  vec3 v = uSunW - X; float d = length(v); ls = v/d;
  float vis = sunVis(X); if (vis <= 0.0) return vec3(0.0);
  return uSunE0*sq(uSunD0/d)*vis*sunTrans(X, K, ls);
}
vec3 msLUT(float z, float mus){
  vec2 uv = vec2(clamp(mus,0.0,1.0), sqrt(clamp(z/uZtop,0.0,1.0)));
  uv = (uv*(uMsSize-1.0)+0.5)/uMsSize; return textureLod(uMsLUT, uv, 0.0).rgb;
}
/* ---------------- 球谐（行 0＝相机全天空，行 1＝相机所见“大气之外”，行 2＝月亮所见） ---------------- */
vec3 shC(int i, int row){ return texelFetch(uSH, ivec2(i,row), 0).rgb; }
vec3 shIrr(vec3 n, int row){
  const float c1=0.429043, c2=0.511664, c3=0.743125, c4=0.886227, c5=0.247708;
  vec3 L00=shC(0,row), L1m1=shC(1,row), L10=shC(2,row), L11=shC(3,row), L2m2=shC(4,row), L2m1=shC(5,row), L20=shC(6,row), L21=shC(7,row), L22=shC(8,row);
  float x=n.x, y=n.y, z=n.z;
  return max(vec3(0.0), c1*L22*(x*x-y*y) + c3*L20*z*z + c4*L00 - c5*L20 + 2.0*c1*(L2m2*x*y + L21*x*z + L2m1*y*z) + 2.0*c2*(L11*x + L1m1*y + L10*z));
}
vec3 shAvg(int row){ return max(shC(0,row)*0.2820948, vec3(0.0)); }

/* ---------------- 射线 ---------------- */
vec3 rayDir(vec2 uv){ vec4 p = uInvVP*vec4(uv*2.0-1.0, 1.0, 1.0); return normalize(p.xyz/p.w); }
float tWall(float cd){ return -cd + sqrt(max(cd*cd - uCamK, 0.0)); }
vec2 tShell(float cd, float Rs){ float c = uCamK + (uR-Rs)*(uR+Rs); float disc = cd*cd - c; if (disc < 0.0) return vec2(-1.0); float s = sqrt(disc); return vec2(-cd-s, -cd+s); }
float rayCyl(vec3 O, vec3 d){ float a = dot(d.xz,d.xz); float b = dot(O.xz,d.xz); float c = dot(O.xz,O.xz) - uA*uA; float disc = b*b - a*c; if (disc < 0.0 || a < 1e-12) return -1.0; float t = (-b - sqrt(disc))/a; return t > 0.0 ? t : -1.0; }
float raySph(vec3 O, vec3 d, vec3 C, float r){ vec3 oc = O - C; float b = dot(oc,d); float c = dot(oc,oc) - r*r; float disc = b*b - c; if (disc < 0.0) return -1.0; float t = -b - sqrt(disc); return t > 0.0 ? t : -1.0; }

/* ---------------- 噪声与地理 ---------------- */
float nz(vec3 p){ return textureLod(uNoise3, p, 0.0).r; }
float fbm3(vec3 p, int oct){ float a=0.5, s=0.0, w=0.0; for (int i=0;i<6;i++){ if (i>=oct) break; s += a*textureLod(uNoise3,p,0.0).r; w += a; p = p*2.07 + vec3(0.31,0.17,0.43); a *= 0.5; } return s/w; }
struct Geo { vec3 nw; float psi; float q; float lat; float g; };
Geo geoOf(vec3 Xcm){ Geo o; vec3 Pw = uCM2W*Xcm; o.nw = normalize(Pw); o.psi = atan(length(Pw.xz), -Pw.y); o.q = min(o.psi, PI-o.psi); o.lat = 0.5*PI - o.q; o.g = 1.4*sin(o.q); return o; }
// 阶地：塔根半球的车削台阶。f＝级内相位，qk＝第 k 个外角的余纬，dq＝每级角宽。返回离球面的高度 km
float stairProfile(float f, float qk, float dq){
  float q = qk + f*dq;
  float uT = 2.0*cos(qk + 0.5*f*dq)*sinS(0.5*f*dq)/max(sin(q),1e-4);          // 阶面（圆柱 r＝r_k）
  float uC = 2.0*sin(q + 0.5*(1.0-f)*dq)*sinS(0.5*(1.0-f)*dq)/max(cos(q),1e-4); // 崖面（平面 y＝y_{k+1}）
  return uR*min(uT, uC);
}
float stairH(float psi){
  float q = min(psi, PI-psi); float x = q/uStairD; float k = floor(x);
  return stairProfile(x-k, k*uStairD, uStairD) - 0.25*uStairD*uR*sin(2.0*(0.5*PI-q));
}
float terrNoise(vec3 nw){ vec3 q = nw*(uR/40.0); return (nz(q)*0.6 + nz(q*4.0+0.37)*0.3 + nz(q*16.0+0.71)*0.1)*2.0 - 1.0; }
float terrAmp(float g){ return uTerrAmp/max(g, 0.3); }
float reliefH(vec3 Xcm){ Geo o = geoOf(Xcm); float h = terrAmp(o.g)*terrNoise(o.nw)*(uStairOn > 0.5 ? 0.35 : 1.0); if (uStairOn > 0.5) h += stairH(o.psi); return h; }
float zuiyuW(vec3 nw, float r0, float r1){ return 1.0 - smoothstep(r0, r1, acos(clamp(dot(nw, uZuiyuN),-1.0,1.0))*uR); }

/* 远处内壁的地表（每像素 ~10 km 级别）；成品里应改为启动时烘焙的等经纬图 */
struct Mat { vec3 alb; float water; };
Mat worldMat(Geo o){
  Mat m; vec3 nw = o.nw;
  float cont = fbm3(nw*2.3, 5);
  float det = fbm3(nw*19.0 + vec3(3.1), 4);
  float latd = o.lat*57.29578;
  vec3 light = mix(vec3(0.40,0.40,0.42), vec3(0.55,0.55,0.56), det);
  vec3 plain = mix(vec3(0.06,0.09,0.04), vec3(0.19,0.16,0.10), smoothstep(0.35,0.65,det));
  plain = mix(plain, vec3(0.21,0.20,0.18), smoothstep(0.6,0.8,cont));
  vec3 heavy = mix(vec3(0.055,0.05,0.045), vec3(0.10,0.085,0.07), det);
  vec3 limbo = mix(vec3(0.25,0.25,0.26), vec3(0.33,0.33,0.34), det);
  vec3 c = plain;
  c = mix(c, light, smoothstep(55.0, 60.0, latd));
  c = mix(c, heavy, 1.0 - smoothstep(28.0, 33.0, latd));
  c = mix(c, limbo, 1.0 - smoothstep(5.0, 8.0, latd));
  float zy = zuiyuW(nw, 600.0, 1100.0);
  c = mix(c, mix(vec3(0.045,0.035,0.032), vec3(0.16,0.06,0.04), smoothstep(0.45,0.7,det)), zy);
  float wm = (1.0 - smoothstep(0.40,0.43,cont))*smoothstep(8.0,12.0,latd)*(1.0 - smoothstep(54.0,57.0,latd))*(1.0 - zy);
  c = mix(c, vec3(0.022,0.03,0.04), wm); m.water = wm;
  c *= 1.0 - 0.97*(1.0 - smoothstep(uAbyssHalf, uAbyssHalf*1.6, latd));
  m.alb = c; return m;
}
float cloudCover(vec3 nw){
  float c = fbm3(nw*4.1 + vec3(uTime*0.0005, 0.0, uTime*0.0002), 4);
  float cov = smoothstep(1.0-uCloudCov-0.12, 1.0-uCloudCov+0.18, c);
  cov = max(cov, uZuiyuOvc*zuiyuW(nw, 700.0, 1200.0));
  return cov*uCloudOn;
}
// 近处地面反照率（阶面/崖面 × 各域）
vec3 groundAlbedo(Geo o, float up, float det, float det2){
  float latd = o.lat*57.29578;
  vec3 pf = mix(vec3(0.07,0.10,0.04), vec3(0.19,0.16,0.09), smoothstep(0.3,0.7,det));
  pf = mix(pf, vec3(0.05,0.08,0.035), smoothstep(0.55,0.75,det2));
  vec3 pc = mix(vec3(0.20,0.19,0.17), vec3(0.29,0.27,0.24), det2);
  vec3 lf = mix(vec3(0.45,0.45,0.47), vec3(0.62,0.62,0.64), det);
  vec3 lc = mix(vec3(0.33,0.33,0.34), vec3(0.40,0.40,0.41), det2);
  vec3 hf = mix(vec3(0.06,0.055,0.05), vec3(0.11,0.09,0.07), det);
  vec3 hc = mix(vec3(0.065,0.06,0.055), vec3(0.09,0.08,0.07), det2);
  vec3 zf = mix(vec3(0.045,0.033,0.03), vec3(0.17,0.065,0.045), smoothstep(0.35,0.75,det));
  zf = mix(zf, vec3(0.05,0.06,0.025), smoothstep(0.7,0.8,det2)*0.8);   // 酸水洼
  vec3 zc = mix(vec3(0.04,0.036,0.034), vec3(0.13,0.05,0.035), smoothstep(0.5,0.8,det2));
  float wl = smoothstep(55.0,60.0,latd), wh = 1.0 - smoothstep(28.0,33.0,latd), wz = zuiyuW(o.nw, 600.0, 1100.0);
  vec3 F = mix(mix(mix(pf, lf, wl), hf, wh), zf, wz);
  vec3 C = mix(mix(mix(pc, lc, wl), hc, wh), zc, wz);
  return mix(C, F, smoothstep(0.55, 0.85, up));
}
`;
