// ov_shell.frag：内壁（负责：B 路；GLSL1 写法；spec/03 第六节第 2、7 条）。
// 拼法：ov_common ＋ ov_occl ＋ 本文件。逐片元：分域底色、日照、塔影（towerVis）、日食月影（eclipseVis）、
// 分域环与赤道描边、经纬网、剖切；背面（gl_FrontFacing 为假）画外表面：暗石色＋程序星点。
// 光照一律按真实日月位置（uSunW、uMoonW 来自 HY.astro，不受“日轨放大”影响）。
uniform float uR, uGEq, uLimboKm, uDref, uEcl, uGrid, uStars, uSpin, uAlpha;
uniform float uGLight, uGHeavy;           // 轻／平、平／重分界的重力（g）
uniform float uPsiL, uPsiH;               // 同上两条分界在塔根半球的角距 ψ（弧度）；<0＝该分界不存在
uniform vec3  uZLight, uZPlain, uZHeavy, uZLimbo, uZTower;   // 域色（线性）
uniform vec3  uNight, uGridCol, uStone, uStarCol;
varying vec3 vX;
varying vec3 vW;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }

vec3 outerFace(vec3 X){
  vec3 n = X/uR;
  // 暗石：粗细两层三维格子噪声
  vec3 q1 = floor(n*36.0), q2 = floor(n*110.0);
  float t = 0.82 + 0.10*hash12(q1.xy + q1.z*17.13) + 0.08*hash12(q2.yz + q2.x*7.31);
  vec3 c = uStone*t;
  if (uStars > 0.001){
    // 星空不随星体转：取惯性系坐标（绕 y 转 uSpin，与 HY.astro.toInertial 同向）
    float cs = cos(uSpin), sn = sin(uSpin);
    vec3 q = vec3(n.x*cs - n.z*sn, n.y, n.x*sn + n.z*cs);
    float lat = asin(clamp(q.y, -1.0, 1.0));
    vec2 uv = vec2(atan(q.z, q.x)/(2.0*PI)*180.0, lat/PI*90.0);
    vec2 cell = floor(uv), f = fract(uv);
    float px = max(fwidth(uv.y), 1e-4);    // 求导放在分支外（非一致控制流里导数无定义）
    float h = hash12(cell + 7.0);
    if (h > 0.82){
      vec2 sp = 0.2 + 0.6*vec2(hash12(cell + 17.3), hash12(cell + 41.7));
      vec2 dd = (f - sp)*vec2(max(cos(lat), 0.05), 1.0);
      float k = 1.0 - smoothstep(0.6, 1.6, length(dd)/px);
      float b = (h - 0.82)/0.18;
      c += uStarCol*k*(0.25 + 1.4*b*b)*uStars;
    }
  }
  return c;
}

void main(){
  if (ovCut(vW)) discard;
  vec3 X = vX;
  if (!gl_FrontFacing){ gl_FragColor = ovOut(outerFace(X), uAlpha); return; }

  float rr = length(X.xz);
  float psi = atan(rr, -X.y);              // 离塔根的角距
  float s = uR*psi;                        // 沿地面离塔根 km
  float g = uGEq*rr/uR;                    // 重力（g）
  float de = abs(s - 0.5*PI*uR);           // 离赤道的地面距离

  // 分域底色：塔基＞灵薄＞轻／重／平；各分界 ±1% 软过渡
  vec3 base = uZPlain;
  base = mix(base, uZHeavy, smoothstep(uGHeavy*0.99, uGHeavy*1.01, g));
  base = mix(base, uZLight, 1.0 - smoothstep(uGLight*0.99, uGLight*1.01, g));
  if (uLimboKm > 0.0) base = mix(base, uZLimbo, 1.0 - smoothstep(uLimboKm*0.99, uLimboKm*1.01, de));
  base = mix(base, uZTower, 1.0 - smoothstep(uA*0.99, uA*1.01, rr));

  // 日照：E＝(Dref/|S−X|)²·max(0, n·l)，n 为指向球心的内法线；夜就是塔影
  vec3 v = uSunW - X; float d = length(v);
  vec3 n = -X/uR;
  float E = sq(uDref/d)*max(dot(n, v/d), 0.0);
  float vis = towerVis(X, uSunW, uSunRho);
  if (uEcl > 0.5 && vis > 0.0) vis *= eclipseVis(X);
  vec3 day = base*(0.10 + 0.90*sqrt(min(E, 1.3)));
  vec3 night = base*0.06 + uNight*0.05;
  vec3 col = mix(night, day, vis);

  // 经纬网：ψ 每 15°、φ 每 30°
  if (uGrid > 0.5){
    float pd = psi*57.2957795;
    float kP = ovLine(abs(fract(pd/15.0 + 0.5) - 0.5)*15.0, fwidth(pd));
    float fd = atan(X.z, X.x)*57.2957795;
    float wf = min(fwidth(fd), fwidth(mod(fd + 360.0, 360.0)));
    float kF = ovLine(abs(fract(fd/30.0 + 0.5) - 0.5)*30.0, wf)*smoothstep(0.05, 0.3, rr/uR);
    col = mix(col, uGridCol*(0.35 + 0.65*vis), 0.32*max(kP, kF));
  }

  // 分域环（两半球）与赤道：域色描边，昼夜都看得见
  float ws = fwidth(s)*1.3;
  float kE = ovLine(de, ws);
  float kB = uLimboKm > 0.0 ? ovLine(abs(de - uLimboKm), ws) : 0.0;
  float kL = uPsiL >= 0.0 ? ovLine(uR*min(abs(psi - uPsiL), abs(psi - (PI - uPsiL))), ws) : 0.0;
  float kH = uPsiH >= 0.0 ? ovLine(uR*min(abs(psi - uPsiH), abs(psi - (PI - uPsiH))), ws) : 0.0;
  float lk = 0.45 + 0.55*vis;
  col = mix(col, uZLimbo*1.7*lk, 0.85*max(kE, kB));
  col = mix(col, uZLight*1.5*lk, 0.85*kL);
  col = mix(col, uZHeavy*1.5*lk, 0.85*kH);

  gl_FragColor = ovOut(col, uAlpha);
}
