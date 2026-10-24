// ov_tower.frag：巨塔（负责：B 路；GLSL1 写法；spec/03 第六节第 3 条）。拼法：ov_common ＋ ov_occl ＋ 本文件；顶点用 ov_obj.vert。
// 近黑（反射率 0.012）：被身边的太阳照亮的一侧泛起一片暖光（按真实距离平方，截到 30 倍）；
// 一道很弱的视角边缘光（菲涅耳 0.05），否则在黑背景上看不出圆柱的体感；塔腰（y＝0）一道细环；
// 竖向细棱（塔面纹理，随星体转，惯性系里看得出塔在转）。
uniform vec3  uKm;          // 单位圆柱 → km 的三轴倍数 (a, 1.06R, a)
uniform float uDref;
uniform vec3  uSunCol, uRimCol, uWaistCol;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
varying vec3 vVn;
varying vec3 vVv;
varying vec2 vUv;
void main(){
  vec3 X = vP*uKm;
  vec3 n = normalize(vN);
  vec3 v = uSunW - X; float d = length(v);
  float E = min(sq(uDref/d)*max(dot(n, v/d), 0.0), 30.0);
  float side = 1.0 - step(0.5, abs(n.y));
  float fl = atan(X.z, X.x)*(48.0/(2.0*PI));
  float flute = mix(1.0, 0.75 + 0.25*smoothstep(0.15, 0.5, abs(fract(fl) - 0.5)), side);
  vec3 c = vec3(0.012*0.6*flute) + uSunCol*(0.012*E);
  float rim = pow(1.0 - abs(dot(normalize(vVn), normalize(vVv))), 4.0);
  c += uRimCol*(0.05*rim);
  float yw = X.y;
  float kw = ovLine(abs(yw), fwidth(yw)*1.4)*side;
  c = mix(c, uWaistCol, 0.7*kw);
  gl_FragColor = ovOut(c, 1.0);
}
