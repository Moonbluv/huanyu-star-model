// ov_line.vert：总览里的线、点与纯色小网格（负责：B 路；GLSL1 写法；键名 ov_line_vert）。
// 用于：实际轨迹、每日同刻、塔影交线、视线、剖口环、三点一线、交节小环、地点针、日球、包络圆筒、背景星。
// aT：通用标量（按 uTMode 解释：透明度、沿线距离）；几何里没有 aT 时读到 0。
// uSky＝1：把 position 当方向，画在无穷远（远裁剪面上），用于背景星。
attribute float aT;
uniform float uPointSize;   // 点的像素大小（只对 Points 有效）
uniform float uSky;
varying float vT;
varying vec3 vW;
void main(){
  vT = aT;
  vec4 w = modelMatrix*vec4(position, 1.0);
  vW = w.xyz;
  if (uSky > 0.5){
    vec3 dv = (viewMatrix*vec4((modelMatrix*vec4(position, 0.0)).xyz, 0.0)).xyz;
    vec4 p = projectionMatrix*vec4(normalize(dv), 1.0);
    p.z = p.w*0.99999;
    gl_Position = p;
    gl_PointSize = uPointSize*(0.6 + 1.2*aT);
  } else {
    gl_Position = projectionMatrix*viewMatrix*w;
    gl_PointSize = uPointSize;
  }
}
