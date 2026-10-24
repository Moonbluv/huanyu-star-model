// lut_sky.frag：64×1，拼在 common 之后
layout(location = 0) out vec4 oc;
void main(){
  float mus = (gl_FragCoord.x - 0.5)/63.0*2.0 - 1.0;
  vec3 ls = vec3(sqrt(max(1.0 - mus*mus, 0.0)), mus, 0.0), P0 = vec3(0.0, -uR + 1e-3, 0.0);
  vec3 E = vec3(0.0);
  const int ND = 64, NS = 16;
  for (int i = 0; i < ND; i++){                                    // 余弦加权半球
    float u = (float(i) + 0.5)/float(ND), ct = sqrt(1.0 - u), st = sqrt(u), ph = float(i)*2.39996323;
    vec3 w = vec3(st*cos(ph), ct, st*sin(ph));
    float pd = dot(P0, w), K0 = dot(P0, P0) - uR*uR;
    float disc = pd*pd - (K0 + uZtop*(2.0*uR - uZtop));            // 能否穿出大气顶进真空
    float tEnd = disc > 0.0 ? (-pd - sqrt(disc)) : (-pd + sqrt(max(pd*pd - K0, 0.0)));
    vec3 T = vec3(1.0), L = vec3(0.0); float c = dot(w, ls);
    for (int j = 0; j < NS; j++){
      float a0 = float(j)/float(NS), a1 = float(j + 1)/float(NS);
      float t = tEnd*sq(0.5*(a0 + a1)), dt = tEnd*(a1*a1 - a0*a0);
      vec3 X = P0 + w*t; float Kx = K0 + 2.0*t*pd + t*t, zx = zOfK(Kx);
      vec3 sR = uBetaR*exp(-zx/uHR); float sM = uBetaMs*exp(-zx/uHM);
      vec3 st3 = sR + vec3((uBetaMs + uBetaMa)*exp(-zx/uHM)), sT = exp(-st3*dt);
      vec3 J = (sR*phaseR(c) + sM*phaseCS(c, uMieG))*sunTrans(X, Kx, ls) + (sR + vec3(sM))*msLUT(zx, dot(-normalize(X), ls));
      L += T*(J - J*sT)/max(st3, vec3(1e-9)); T *= sT;
    }
    E += L*(PI/float(ND));                                         // 余弦加权：E＝π·平均 L
  }
  oc = vec4(E, 1.0);
}
