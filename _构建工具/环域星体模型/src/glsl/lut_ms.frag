// lut_ms.frag：拼在 common 之后
uniform float uGroundAlb;
layout(location = 0) out vec4 oc;
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5)/31.0;
  float mus = uv.x*2.0 - 1.0, z = uv.y*uv.y*uZtop;
  vec3 P0 = vec3(0.0, -(uR - z), 0.0);                            // 内法线＝+y
  vec3 ls = vec3(sqrt(max(1.0 - mus*mus, 0.0)), mus, 0.0);
  float K0 = -z*(2.0*uR - z), Rt = uR - uZtop;
  vec3 L2 = vec3(0.0), Fm = vec3(0.0);
  const int ND = 64, NS = 24;
  for (int i = 0; i < ND; i++){
    float fy = 1.0 - (float(i) + 0.5)*2.0/float(ND), rr = sqrt(max(1.0 - fy*fy, 0.0)), ph = float(i)*2.39996323;
    vec3 w = vec3(rr*cos(ph), fy, rr*sin(ph));
    float pd = dot(P0, w), tw = -pd + sqrt(max(pd*pd - K0, 0.0));
    float disc = pd*pd - (K0 + (uR - Rt)*(uR + Rt));
    bool ex = pd < 0.0 && disc > 0.0;
    float tEnd = ex ? (-pd - sqrt(disc)) : tw;
    vec3 T = vec3(1.0), Lw = vec3(0.0), Fw = vec3(0.0);
    for (int j = 0; j < NS; j++){
      float a0 = float(j)/float(NS), a1 = float(j + 1)/float(NS);
      float t = tEnd*sq(0.5*(a0 + a1)), dt = tEnd*(a1*a1 - a0*a0);
      vec3 X = P0 + w*t; float Kx = K0 + 2.0*t*pd + t*t, zx = zOfK(Kx);
      vec3 sR = uBetaR*exp(-zx/uHR); float sM = uBetaMs*exp(-zx/uHM);
      vec3 ss = sR + vec3(sM), st = sR + vec3((uBetaMs + uBetaMa)*exp(-zx/uHM));
      vec3 sT = exp(-st*dt), Sint = (ss - ss*sT)/max(st, vec3(1e-9));
      Lw += T*Sint*sunTrans(X, Kx, ls)*(1.0/(4.0*PI));
      Fw += T*Sint; T *= sT;
    }
    if (!ex){ vec3 X = P0 + w*tEnd; Lw += T*uGroundAlb/PI*max(dot(-normalize(X), ls), 0.0)*sunTrans(X, 0.0, ls); }
    L2 += Lw; Fm += Fw;
  }
  L2 /= float(ND); Fm /= float(ND);
  oc = vec4(L2/max(vec3(1.0) - Fm, vec3(1e-3)), 1.0);             // Ψ_ms：用时乘 σ_s 与未遮挡日照
}
