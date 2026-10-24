// =====================================================================================
//  多重散射 LUT（Hillaire 2020 的凹面版）：32×32，x＝sqrt(h/hcut)，y＝μs（日对“球心方向”的余弦）
//  从离壁 h 的点向 64 个方向积分二阶散射；朝里的射线进入真空核即止，朝外/平的射线落到内壁（地面反照 0.15）。
//  Ψms = L2 / (1 − f_ms)；主 pass 里多次散射源＝σs · Ψms · E太阳 · 塔影可见度。
//  只在 H、能见度改变时重算一次。依赖 common.glsl 的大气部分。
// =====================================================================================
layout(location = 0) out vec4 fragColor;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / 31.0;
  float h = uv.x * uv.x * uHcut;
  float muS = uv.y;
  vec3 X0 = vec3(0.0, uR - h, 0.0);                  // 局部：−y 是“朝球心”（天顶）
  vec3 zen = vec3(0.0, -1.0, 0.0);
  vec3 l = vec3(sqrt(max(1.0 - muS * muS, 0.0)), -muS, 0.0);
  const int ND = 64, NS = 20;
  vec3 L2 = vec3(0.0), fms = vec3(0.0);
  for (int i = 0; i < ND; i++) {
    float z = 1.0 - 2.0 * (float(i) + 0.5) / float(ND);           // Fibonacci 球面
    float ph = float(i) * 2.39996323;
    vec3 w = vec3(sqrt(max(1.0 - z * z, 0.0)) * cos(ph), z, sqrt(max(1.0 - z * z, 0.0)) * sin(ph));
    vec2 wl = iSphere(X0, w, uR);
    float tW = wl.y;                                               // 必与内壁相交
    vec2 cr = iSphere(X0, w, uR - uHcut);
    float tEnd = tW;
    bool ground = true;
    if (cr.x < cr.y && cr.x > 0.0 && cr.x < tW) { tEnd = cr.x; ground = false; }
    tEnd = min(tEnd, 3000.0);
    vec3 Lw = vec3(0.0), fw = vec3(0.0), T = vec3(1.0);
    float dt = tEnd / float(NS);
    for (int j = 0; j < NS; j++) {
      vec3 Y = X0 + w * ((float(j) + 0.5) * dt);
      float hy = uR - length(Y);
      vec3 rho = densities(vec3(1e9), hy);
      vec3 sS = uBetaR * rho.x + uBetaM * rho.y;
      vec3 sE = uBetaR * rho.x + (uBetaM + uBetaMA) * rho.y;
      vec3 Tst = exp(-sE * dt);
      vec3 up = -Y / length(Y);
      vec3 Tsun = transToward(hy, dot(l, up));
      vec3 S = sS * Tsun * (1.0 / (4.0 * PI));
      Lw += T * (S - S * Tst) / max(sE, vec3(1e-9));
      fw += T * (sS - sS * Tst) / max(sE, vec3(1e-9));
      T *= Tst;
    }
    if (ground) {
      vec3 Yg = X0 + w * tEnd;
      vec3 ng = -Yg / length(Yg);
      Lw += T * transToward(0.0, dot(l, ng)) * max(dot(l, ng), 0.0) * 0.15 / PI;
    }
    L2 += Lw / float(ND);
    fms += fw / float(ND);
  }
  vec3 psi = L2 / max(1.0 - fms, vec3(1e-3));
  fragColor = vec4(psi, 1.0);
}
