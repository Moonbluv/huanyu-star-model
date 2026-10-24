// ov_env.frag：实际轨迹的包络圆筒（负责：B 路；GLSL1 写法；spec/03 第六节第 5 条）。拼法：ov_common ＋ 本文件；顶点用 ov_obj.vert。
// 像一层薄玻璃：正对视线的部分几乎透明，掠射的轮廓边亮一些——只勾出“日月在这只圆筒上走”，不给塔和夜侧蒙一层纱。
uniform vec3  uColor;
uniform float uAlpha;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
varying vec3 vVn;
varying vec3 vVv;
varying vec2 vUv;
void main(){
  float f = 1.0 - abs(dot(normalize(vVn), normalize(vVv)));
  float a = uAlpha*(0.08 + 0.92*f*f*f);
  gl_FragColor = ovOut(uColor, a);
}
