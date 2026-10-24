// ov_glow.frag：太阳的屏幕空间光晕（负责：B 路；GLSL1 写法；spec/03 第六节第 4 条）。拼法：ov_common ＋ 本文件；顶点用 ov_obj.vert。
// 一块始终朝向相机的方片（overview 每帧摆正、按距离缩放成固定屏幕大小），加色混合、做深度测试：
// 转到塔后自然被挡。方片放在日面朝相机的一侧，免得被日球本身挡住。
uniform vec3  uColor;
uniform float uAlpha;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
varying vec3 vVn;
varying vec3 vVv;
varying vec2 vUv;
void main(){
  vec2 q = vUv*2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 >= 1.0) discard;
  float g = 1.1*exp(-r2*30.0) + 0.32*exp(-r2*7.0) + 0.07*exp(-r2*2.0);
  g *= 1.0 - r2;
  gl_FragColor = ovOut(uColor*(g*uAlpha), 1.0);
}
