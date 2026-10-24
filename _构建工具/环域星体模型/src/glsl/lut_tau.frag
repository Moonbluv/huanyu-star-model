// lut_tau.frag：拼在 common 之后
layout(location = 0) out vec4 oc;
void main(){
  vec2 uv = clamp((gl_FragCoord.xy/uTauSize - 0.5/uTauSize)/(1.0 - 1.0/uTauSize), 0.0, 1.0);
  float al = uv.x*uv.x*0.5*PI;
  float zmax = min(uZtop, 2.0*uR*sq(sinS(0.5*al)));
  float z = uv.y*uv.y*zmax;
  float b = uR*cos(al), xR = uR*sinS(al);
  float xz = sqrt(max(xR*xR - z*(2.0*uR - z), 0.0));            // (R−z)²−b²，不相减
  float span = z*(2.0*uR - z)/max(xR + xz, 1e-6);                // xR − x(z)，不相减
  vec3 tau = vec3(0.0);
  const int N = 192;
  for (int i = 0; i < N; i++){
    float s0 = float(i)/float(N), s1 = float(i + 1)/float(N), sm = 0.5*(s0 + s1);
    float dx = span*(sq(1.0 - s0) - sq(1.0 - s1));               // 向内壁一端二次加密
    float dxR = span*sq(1.0 - sm), x = xR - dxR;
    float zz = dxR*(xR + x)/(uR + sqrt(b*b + x*x));              // 高度＝(xR−x)(xR+x)/(R+ρ)
    tau += (uBetaR*exp(-zz/uHR) + vec3((uBetaMs + uBetaMa)*exp(-zz/uHM)))*dx;
  }
  oc = vec4(tau, 1.0);
}
