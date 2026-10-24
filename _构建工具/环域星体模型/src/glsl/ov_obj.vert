// ov_obj.vert：总览里一般网格的顶点着色器（巨塔、日、月、塔影面、光晕；负责：B 路；GLSL1 写法；键名 ov_obj_vert）。
varying vec3 vP;    // 物体坐标（单位几何；各片元着色器自己换算成 km）
varying vec3 vN;    // 物体法线
varying vec3 vW;    // 世界坐标，场景单位
varying vec3 vVn;   // 视空间法线
varying vec3 vVv;   // 视空间里从表面指向相机
varying vec2 vUv;
void main(){
  vP = position; vN = normal; vUv = uv;
  vec4 w = modelMatrix*vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix*w;
  vVn = normalize(normalMatrix*normal);
  vVv = -mv.xyz;
  gl_Position = projectionMatrix*mv;
}
