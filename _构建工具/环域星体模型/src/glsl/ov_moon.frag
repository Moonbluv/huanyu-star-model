// ov_moon.frag：月（负责：B 路；GLSL1 写法；spec/03 第六节第 4 条）。拼法：ov_common ＋ ov_occl ＋ 本文件；顶点用 ov_obj.vert。
// 月的网格是单位球，挂在“随星体转”的组里、不另转，所以物体坐标的方向就是地固系里的法线 n。
// 显示半径按 bodyScale 放大，但物理采样点取“月心 ＋ n·真半径”（uMoonW、uMoonRho 是真实值），保证影边位置对：
//   亮 ＝ max(n·l, 0)·towerVis(采样点, 日心, 日半径)，于是灰月时一道直的影边扫过月面。
// 暗面给 0.05 的“对岸光”底色（示意值），黑月因此是深灰而不是纯黑；月面加少量程序斑纹。
uniform vec3  uMoonCol;
uniform float uDarkBase;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
varying vec3 vVn;
varying vec3 vVv;
varying vec2 vUv;
float mh(vec3 p){ p = fract(p*0.3183099 + vec3(0.11, 0.17, 0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float mnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(mh(i), mh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(mh(i + vec3(0.0, 1.0, 0.0)), mh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(mh(i + vec3(0.0, 0.0, 1.0)), mh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(mh(i + vec3(0.0, 1.0, 1.0)), mh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main(){
  vec3 n = normalize(vP);
  vec3 X = uMoonW + n*uMoonRho;
  vec3 l = normalize(uSunW - X);
  float lit = max(dot(n, l), 0.0)*towerVis(X, uSunW, uSunRho);
  float m = 0.62*mnoise(n*2.3 + 1.7) + 0.38*mnoise(n*6.1);
  float mare = 0.80 + 0.20*smoothstep(0.35, 0.65, m);
  vec3 c = uMoonCol*mare*(uDarkBase + (1.0 - uDarkBase)*1.1*lit);
  gl_FragColor = ovOut(c, 1.0);
}
