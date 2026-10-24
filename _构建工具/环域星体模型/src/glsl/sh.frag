// sh.frag：9×3。行 r 的第 i 个系数（不拼 common，只要精度声明）
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uProbe;
layout(location = 0) out vec4 oc;
float Y9(int i, vec3 d){
  if (i == 0) return 0.2820948; if (i == 1) return 0.4886025*d.y; if (i == 2) return 0.4886025*d.z; if (i == 3) return 0.4886025*d.x;
  if (i == 4) return 1.0925484*d.x*d.y; if (i == 5) return 1.0925484*d.y*d.z; if (i == 6) return 0.3153916*(3.0*d.z*d.z - 1.0);
  if (i == 7) return 1.0925484*d.x*d.z; return 0.5462742*(d.x*d.x - d.y*d.y);
}
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy); vec3 acc = vec3(0.0);
  for (int y = 0; y < 16; y++) for (int x = 0; x < 32; x++){
    vec2 uv = (vec2(float(x), float(y)) + 0.5)/vec2(32.0, 16.0);
    float ph = uv.x*6.2831853, ct = 1.0 - 2.0*uv.y, st = sqrt(max(1.0 - ct*ct, 0.0));
    acc += texelFetch(uProbe, ivec2(x, ij.y*16 + y), 0).rgb*Y9(ij.x, vec3(st*cos(ph), ct, st*sin(ph)));
  }
  oc = vec4(acc*(12.566371/512.0), 1.0);                            // 等面积：每格立体角 4π/512
}
