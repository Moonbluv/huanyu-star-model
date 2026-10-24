// ov_line.frag：纯色的线、点、小网格（负责：B 路；GLSL1 写法）。拼法：ov_common ＋ 本文件；顶点用 ov_line.vert。
// uTMode：0 不用 aT；1 透明度乘 aT（渐隐的轨迹尾、每日同刻）；2 虚线（aT＝沿线距离，uDash＝段长，同单位）；
//         3 亮度乘 aT（背景星）。uPoint＝1 时画圆点。贴在内壁上的东西用 uCutMode＝1 跟着剖切。
uniform vec3  uColor;
uniform float uAlpha, uTMode, uDash, uPoint;
varying float vT;
varying vec3 vW;
void main(){
  if (ovCut(vW)) discard;
  float a = uAlpha;
  vec3 c = uColor;
  if (uTMode > 0.5 && uTMode < 1.5) a *= clamp(vT, 0.0, 1.0);
  else if (uTMode > 1.5 && uTMode < 2.5){ if (mod(vT, 2.0*uDash) > uDash) discard; }
  else if (uTMode > 2.5) c *= vT;
  if (uPoint > 0.5){
    vec2 q = gl_PointCoord*2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    a *= 1.0 - smoothstep(0.35, 1.0, r2);
  }
  gl_FragColor = ovOut(c, a);
}
