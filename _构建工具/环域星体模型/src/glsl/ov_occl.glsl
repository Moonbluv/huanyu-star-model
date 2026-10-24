// ov_occl.glsl：总览用的遮挡函数（负责：B 路；spec/03 第六节第 2 条）。
// towerVis、eclipseVis 是 common.glsl 同名函数的逐字副本（test/ov_geom_check.js 与 glsl_check.js 断言去空白后一致），
// 改公式只改 common.glsl，再把这两段原样抄过来。外加 PI、sq() 与它们要用的 uniform（单位 km，地固系）。
#define PI 3.14159265359
float sq(float x){ return x*x; }
uniform float uA;                              // 巨塔半径
uniform vec3  uSunW;  uniform float uSunRho;   // 真实日心、日半径
uniform vec3  uMoonW; uniform float uMoonRho;  // 真实月心、月半径
float towerVis(vec3 X, vec3 S, float rho){
  vec2 p = X.xz; float rp2 = dot(p, p), a2 = uA*uA;
  if (rp2 <= a2) return 0.0;
  float rp = sqrt(rp2); vec2 q = S.xz - p; float Lh = length(q);
  if (Lh < 1e-3) return 1.0;
  vec2 c = -p/rp; float cosA = dot(q, c)/Lh;
  if (cosA <= 0.0) return 1.0;
  float sinA = abs(c.x*q.y - c.y*q.x)/Lh, sd = uA/rp, cdd = sqrt(max(1.0 - sd*sd, 0.0));
  float u = Lh*(sinA*cdd - cosA*sd)/rho;                         // 日心到带边平面的有符号距离／半径
  if (u >= 1.0) return 1.0;
  if (sinA < sd){ float tHit = rp*cosA - sqrt(max(a2 - rp2*sinA*sinA, 0.0)); if (Lh < tHit) return 1.0; }
  else if (Lh < rp*cdd) return 1.0;                               // 日在切点之前（塔前）
  if (u <= -1.0) return 0.0;
  return 0.5 + (u*sqrt(1.0 - u*u) + asin(u))/PI;
}
float eclipseVis(vec3 X){                                        // 月掩日：日面露出比例（透镜面积闭式）
  vec3 ds = uSunW - X, dm = uMoonW - X; float Ds = length(ds), Dm = length(dm);
  if (Dm >= Ds || dot(ds, dm) <= 0.0) return 1.0;
  float r1 = uSunRho/Ds, r2 = uMoonRho/Dm, sep = length(cross(ds/Ds, dm/Dm));
  if (sep >= r1 + r2) return 1.0;
  if (sep <= r2 - r1) return 0.0;
  if (sep <= r1 - r2) return 1.0 - sq(r2/r1);
  float x = (sep*sep + r1*r1 - r2*r2)/(2.0*sep);
  float A = r1*r1*acos(clamp(x/r1, -1.0, 1.0)) + r2*r2*acos(clamp((sep - x)/r2, -1.0, 1.0)) - sep*sqrt(max(r1*r1 - x*x, 0.0));
  return 1.0 - A/(PI*r1*r1);
}
