// moon.glsl：拼在 common 之后
uniform float uTowerAlb;                                         // 塔的反照率（默认 0）
uniform float uMoonMare;                                         // 月海门槛：JS 按三维噪声标定（HY.fp.cel.calibrateMare），朝内壁那半个月面约三分之一是月海
// ———— 月面（sky 修订，crit_sky 第 8 条“白色塑料球”）————
// 原先月海＝sstep(0.42, 0.6, 低频噪声)，大半个盘面落在“月海”档（×0.62）、少数小岛进“高地”档（×1.18），归一后高地的反照率到了 1.6，
// 成了一块块像高光的白斑；环形山只是小点；没有法线起伏，交界线光滑；朗伯占一半，满月显出球面明暗。改成：
//   反照率：高地 1、月海 0.55（暗四五成），月海约占三分之一、边界不规则；高地斑驳，年轻的环形山发亮（月海里淡些）。
//     JS 镜像 HY.fp.cel.mareMod 逐式相同，盘面平均仍归一到 pMoon（uMoonAlb）。
//   起伏：大小环形山的碗，用来扰动法线（坑壁一侧亮一侧暗）和做交界线附近的自遮挡（高处过了交界线还亮着、坑底先暗），交界线成锯齿。
//   反射：Lommel–Seeliger 占八成、朗伯两成（满月几乎是平的）；另乘相位遮蔽 S(α)＝Φ_朗伯/Φ_LS（≤1），
//     使整个月盘的光通量随相位仍按 01 的朗伯式走（月光读数 HY.astro.moonLux 照旧对得上，test/moon_norm 守着）。
#define MOON_WLS 0.8
#define MOON_WL 0.2
#define MARE_W 0.045
float moonMareField(vec3 nb){
  return textureLod(uNoise3, nb*0.27 + vec3(0.5, 0.17, 0.83), 0.0).r + 0.22*(textureLod(uNoise3, nb*0.85 + vec3(0.31), 0.0).g - 0.5);
}
float moonAlbMod(vec3 nb){
  float mare = sstep(uMoonMare + MARE_W, uMoonMare - MARE_W, moonMareField(nb));   // 月海边缘有一段渐变（原 ±0.02 像剪纸）
  vec4 c = textureLod(uNoise3, nb*1.9 + vec3(0.13), 0.0);
  float fresh = sstep(0.86, 0.98, c.a);
  return mix(1.0, 0.55, mare)*(0.88 + 0.24*c.r)*(1.0 + 0.4*fresh*(1.0 - 0.5*mare));
}
float moonRelief(vec3 nb){                                       // 起伏（0–1 上下）：Worley 胞心是坑底
  vec4 s = textureLod(uNoise3, nb*1.3 + vec3(0.71, 0.29, 0.47), 0.0);
  return 0.5 - 0.45*s.g*s.g - 0.3*s.b*s.b*s.b + 0.25*(s.r - 0.68);
}
float moonPhaseS(float ca){                                      // 相位遮蔽 S(α)＝Φ_L(α)/Φ_LS(α)，夹到 ≤1
  float al = acos(clamp(ca, -0.98, 1.0));
  if (al < 0.02) return 1.0;
  float phiL = (sin(al) + (PI - al)*cos(al))/PI;
  float phiLS = 1.0 - sin(0.5*al)*tan(0.5*al)*log(1.0/tan(0.25*al));
  return min(1.0, phiL/max(phiLS, 1e-4));
}
vec3 shadeMoon(vec3 Q, vec3 d){
  vec3 n = normalize(Q - uMoonW), nb = transpose(uMoonBasis)*n;
  float A = uMoonAlb*moonAlbMod(nb);
  vec3 v = uSunW - Q; float d2 = dot(v, v); vec3 l = v*inversesqrt(d2);
  float vis = towerVis(Q, uSunW, uSunRho);                       // 逐点塔影：黑月、灰月的直影边
  vec3 t1 = normalize(cross(abs(nb.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), nb)), t2 = cross(nb, t1);
  float h0 = moonRelief(nb), h1 = moonRelief(normalize(nb + t1*0.012)), h2 = moonRelief(normalize(nb + t2*0.012));
  vec3 np = normalize(n - 0.035*(uMoonBasis*((t1*(h1 - h0) + t2*(h2 - h0))/0.012)));
  float sh = sstep(-0.02, 0.02, dot(n, l) + 0.06*(h0 - 0.5));   // 自遮挡：交界线按高低前后错开
  float mu0 = max(dot(np, l), 0.0), mu = max(dot(np, -d), 0.0);
  float brdf = MOON_WL*mu0 + MOON_WLS*2.0*mu0/(mu0 + mu + 1e-4)*moonPhaseS(dot(l, -d));
  return A/PI*(uSunI/d2*vis*veilT(Q, uSunW)*brdf*sh + shIrr(np, 2));
}
vec3 shadeTower(vec3 X){
  if (uTowerAlb <= 0.0) return vec3(0.0);
  vec3 n = normalize(vec3(X.x, 0.0, X.z)); vec3 l; float vis;
  vec3 E = sunE(X + n*0.5, Kof(X), l, vis, false);
  return uTowerAlb/PI*(E*max(dot(n, l), 0.0) + cavityE(X));
}
vec3 sunDisk(float mu){ vec3 u = vec3(0.55, 0.70, 0.85); return uSunI/(PI*uSunRho*uSunRho)*(1.0 - u*(1.0 - mu))/(1.0 - u/3.0); }
