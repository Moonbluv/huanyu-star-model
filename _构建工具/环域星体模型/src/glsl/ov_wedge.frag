// ov_wedge.frag：塔影体（负责：界面路接手 B 路；GLSL1 写法；spec/03 第六节第 6 条）。拼法：ov_common ＋ ov_occl ＋ 本文件；顶点用 ov_obj.vert。
// 两种面共用：
//   uDisk＝0：本影、半影的四个竖直面，从塔面切点沿切线画到内壁，y 方向贯通 −R..R；球外的片元丢弃。
//             面上越靠近内壁越淡一点，免得与内壁交线处糊成一片（交线另由细线描出）。
//   uDisk＝1：水平切片（单位圆盘，物体坐标 x、z × uKmPer＝地固系 km，高度 uSliceY km），逐片元按真实日心算塔影
//             （ov_occl 的 towerVis，与内壁上的夜同一个函数）：本影最浓、半影渐淡、亮处丢弃。
//             从塔顶往下看、斜看都能看见一道楔形——竖直面从塔顶看是侧对着的，只剩几条线。
uniform vec3  uColor;
uniform float uAlpha;
uniform float uRs;          // 星体半径，场景单位
uniform float uDisk;
uniform float uKmPer;
uniform float uSliceY;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
varying vec3 vVn;
varying vec3 vVv;
varying vec2 vUv;
void main(){
  float r = length(vW);
  if (r > uRs) discard;
  if (uDisk > 0.5){
    vec3 X = vec3(vP.x*uKmPer, uSliceY, vP.z*uKmPer);
    if (length(X.xz) < uA*1.002) discard;                    // 塔里面不画
    float sh = 1.0 - towerVis(X, uSunW, uSunRho);
    if (sh < 0.004) discard;
    float rim = 1.0 - 0.55*smoothstep(0.8, 1.0, length(vP.xz));   // 靠内壁处淡一点，壁上的夜由内壁自己画
    gl_FragColor = ovOut(uColor, uAlpha*sh*rim);
    return;
  }
  float f = 1.0 - 0.45*smoothstep(0.7*uRs, uRs, r);
  gl_FragColor = ovOut(uColor, uAlpha*f);
}
