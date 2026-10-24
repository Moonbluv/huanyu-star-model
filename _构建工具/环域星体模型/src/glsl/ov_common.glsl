// ov_common.glsl：总览各片元着色器共用的输出与剖切（负责：B 路；GLSL1 写法；spec/03 第六节第 2、11 条）。
// 拼在每个总览片元着色器的最前面（ov_present 也用这里的色调曲线）。PI、sq() 不在这里定义（在 ov_occl.glsl）。
// 输出三种走法（overview.js 按能力选，以宏区分）：
//   默认      WebGL2＋浮点渲染目标：材质输出线性值，ov_present 做色调与 sRGB
//   OV_TONED  WebGL2、无浮点渲染目标（8 位目标）：材质先做色调与 sRGB 再写进 8 位目标（线性值存 8 位，
//             夜侧 0.02 上下只剩五六级，sRGB 下一级一跳、色带明显）；ov_present 只做暗角与抖动
//   OV_DIRECT WebGL1：直接画到画布，材质自己做色调与 sRGB（spec/03 第六节第 11 条）
//   后两种的半透明混合是在 sRGB 值上做的，与默认走法略有出入，只作降级。
uniform float uCutMode;   // 0 不剖；1 丢弃近侧（dot(W, uClipN) > 0）；2 只留近侧（半透明外壳那一遍）
uniform vec3  uClipN;     // 剖切法向：世界坐标里从原点指向相机的单位向量；相机在球内时为零向量

// 胶片色调：0.6 以下原样，以上用指数肩部压到 1（亮日偏白、暗处不动）
float ovToneC(float x){ return x < 0.6 ? x : 0.6 + 0.4*(1.0 - exp(-(x - 0.6)/0.4)); }
vec3 ovTone(vec3 c){ c = max(c, vec3(0.0)); return vec3(ovToneC(c.r), ovToneC(c.g), ovToneC(c.b)); }
float ovSrgbC(float x){ x = clamp(x, 0.0, 1.0); return x <= 0.0031308 ? 12.92*x : 1.055*pow(x, 1.0/2.4) - 0.055; }
vec3 ovSrgb(vec3 c){ return vec3(ovSrgbC(c.r), ovSrgbC(c.g), ovSrgbC(c.b)); }

vec4 ovOut(vec3 c, float a){
#if defined(OV_DIRECT) || defined(OV_TONED)
  return vec4(ovSrgb(ovTone(c)), a);
#else
  return vec4(c, a);
#endif
}

// W：世界坐标（场景单位）。剖切面过原点，所以与参照系、单位都无关
bool ovCut(vec3 W){
  if (uCutMode < 0.5) return false;
  float s = dot(W, uClipN);
  return uCutMode < 1.5 ? s > 0.0 : s <= 0.0;
}
// 抗锯齿细线：d 为到线的距离，w 为一个像素对应的同一量（fwidth）
float ovLine(float d, float w){ return 1.0 - smoothstep(0.5, 1.5, d/max(w, 1e-6)); }
