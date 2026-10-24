// ov_helix.frag：螺旋管着色（负责：B 路；GLSL1 写法；spec/03 第六节第 5 条）。拼法：ov_common ＋ 本文件。
// 离“此刻”越近越亮：前后各四分之一年衰减到 25%；过去略冷、将来略暖；
// 冬半年段（u∈[0, 0.5)，日在塔腰以上、塔根半球为冬）比夏半年段亮一些，读得出“往上是入冬”。
uniform vec3  uColor;       // 日：--sun；月：--moon（线性）
uniform vec3  uCool, uWarm; // 过去、将来的色偏
uniform float uNowU;        // 此刻的年相位 u(t)
uniform float uGain;
varying float vU;
varying vec3 vVn;
varying vec3 vVv;
void main(){
  float d = vU - uNowU; d -= floor(d + 0.5);          // [-0.5, 0.5)：负＝过去，正＝将来
  float k = clamp(abs(d)/0.25, 0.0, 1.0);
  float b = mix(1.0, 0.25, k);
  vec3 tint = mix(vec3(1.0), d < 0.0 ? uCool : uWarm, 0.45*k);
  float winter = 1.0 - step(0.5, fract(vU));
  b *= mix(0.72, 1.0, winter);
  float lit = 0.55 + 0.45*max(dot(normalize(vVn), normalize(vVv)), 0.0);
  gl_FragColor = ovOut(uColor*tint*(b*lit*uGain), 1.0);
}
