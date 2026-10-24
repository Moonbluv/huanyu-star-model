// ov_helix.vert：螺旋管（负责：B 路；GLSL1 写法；键名 ov_helix_vert；spec/03 第六节第 5 条）。
// 顶点属性 aU＝年相位 u∈[0,1]（0＝入冬交节，0.5＝入夏交节）。管子的网格由 HY.ov.geom.tube 生成，只建一次，
// 每帧整条绕 y 转 geom.helixAngle，让它在 u(t) 处恰好穿过天体的真实位置。
// 近处收细（验收第 4 条返修）：“此地上空”的相机在球腔里、离螺旋只有几百公里，16 km 粗的管子占掉半幅画面。
// 管壁点＝中心线＋normal·uTubeR；在视空间里把半径限到 uMaxAng·距离（看上去的半粗不超过 uMaxAng 弧度），
// 远处（各预设的常规距离）原样不动。
attribute float aU;
uniform float uTubeR;       // 管半径（场景单位；与 geom.tube 建网格时的 radius 相同）
uniform float uMaxAng;      // 看上去的半粗上限（弧度）
varying float vU;
varying vec3 vVn;
varying vec3 vVv;
void main(){
  vU = aU;
  vec3 c = position - normal*uTubeR;                       // 中心线（物体空间）
  vec4 mc = modelViewMatrix*vec4(c, 1.0);
  vec3 off = mat3(modelViewMatrix)*(normal*uTubeR);        // 视空间里的半径向量（含整组的缩放）
  float rv = length(off), rMax = uMaxAng*length(mc.xyz);
  vec4 mv = vec4(mc.xyz + (rv > rMax && rv > 0.0 ? off*(rMax/rv) : off), 1.0);
  vVn = normalize(normalMatrix*normal);
  vVv = -mv.xyz;
  gl_Position = projectionMatrix*mv;
}
