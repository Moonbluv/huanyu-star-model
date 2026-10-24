// bloom_up.frag：眩光金字塔帐篷上采样，拼在 post_common 之后（02 第十四节第 5 条）
// 读小一级，3×3 帐篷滤波，以加法混合叠到大一级上（各级相加后在 final 里按 uBloomK 归一）。
uniform sampler2D uCur;                                           // 小一级
uniform vec2 uRes;
uniform float uUpW;
void main(){
  vec2 uv = gl_FragCoord.xy/uRes, t = 1.0/vec2(textureSize(uCur, 0));
  vec3 s = 4.0*texture(uCur, uv).rgb
         + 2.0*(texture(uCur, uv + vec2(t.x, 0.0)).rgb + texture(uCur, uv - vec2(t.x, 0.0)).rgb
              + texture(uCur, uv + vec2(0.0, t.y)).rgb + texture(uCur, uv - vec2(0.0, t.y)).rgb)
         + texture(uCur, uv + t).rgb + texture(uCur, uv - t).rgb
         + texture(uCur, uv + vec2(t.x, -t.y)).rgb + texture(uCur, uv + vec2(-t.x, t.y)).rgb;
  fragColor = vec4(s*(uUpW/16.0), 1.0);
}
