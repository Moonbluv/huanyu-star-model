// ov_present.frag：呈现（负责：B 路；GLSL1 写法；spec/03 第六节第 11 条）。拼法：ov_common ＋ 本文件；顶点用 HY.gfx.FS_VERT。
// WebGL2：场景画进 4×MSAA 渲染目标（HalfFloat），这里做简单胶片色调＋sRGB＋极弱暗角，
// 再加 ±0.5/255 的抖动压色带，输出到画布。无浮点渲染能力时（OV_TONED）目标是 8 位、里面已是色调后的 sRGB 值，
// 这里只做暗角（在 sRGB 值上乘，强度按 1/2.2 次方折算，与线性走法观感相近）与抖动。
uniform sampler2D uTex;
uniform vec2  uRes;          // 画布像素
uniform float uVig;          // 暗角强度（0.10 左右）
varying vec2 vUv;
float dither(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453) - 0.5; }
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  vec2 q = vUv*2.0 - 1.0; q.x *= uRes.x/max(uRes.y, 1.0);
  float vig = 1.0 - uVig*0.5*dot(q, q);
#if defined(OV_TONED)
  c *= pow(max(vig, 0.0), 1.0/2.2);
#else
  c = ovSrgb(ovTone(c)*vig);
#endif
  gl_FragColor = vec4(c + dither(gl_FragCoord.xy)/255.0, 1.0);
}
