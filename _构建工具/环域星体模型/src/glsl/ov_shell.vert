// ov_shell.vert：内壁球面（负责：B 路；GLSL1 写法；键名 ov_shell_vert）。
// 几何是单位球、三角形朝内（正面＝内壁，背面＝外表面），挂在“随星体转”的组里，所以本地坐标就是地固系。
uniform float uR;      // 星体半径 km
varying vec3 vX;       // 地固系坐标，km（光照、分域、网格用）
varying vec3 vW;       // 世界坐标，场景单位（剖切用）
void main(){
  vX = position*uR;
  vec4 w = modelMatrix*vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w;
}
