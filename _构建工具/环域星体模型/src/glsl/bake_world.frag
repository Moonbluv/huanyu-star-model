// bake_world.frag：拼在 common 之后（02 第八节第 10 条）。启动时与改分域参数时烘焙一次。（F 路写，clouds 路 2026-10-14 改：问题单第 3 条）
// 输出 tWorld：2048×1024 RGBA8 等面积 (φ, y) 图（与 eqArea 互逆：u＝地固经度/2π，v＝y/2R＋0.5）：rgb 宏观反照率（线性，已含植被与常年雪），a 水面比例。
// 程序底图：按纬度分域（轻、平、重、罪域、灵薄），叠 3 个尺度的大陆噪声与湖海；罪域一圈赤褐、轻域白、深渊黑。
// 噪声源：高度图 uHeight（可平铺；本 pass 排在 gen_height_d 之后）。罪域位置用 uRuiDir（CM 系）＋ uLamCam 换回地固系，
// 所以烘焙时 cel 与 cam 的 uniform 须已写好（同一帧的值即可，结果与相机经度无关）。舆图接口（作者定锚点后）见 02 第八节第 10 条。
// 改：噪声按三维地固位置三向投影取（各向同性）——原先在 (φ, y) 纹理坐标里直接取二维噪声，离塔两端越近一个纹素沿经向拉得越长
// （长宽比约 0.64/sin²ψ），地貌拉成汇向塔脚的辐射条纹；细的几层再按本纹素沿经向有多长淡出（不混叠成条纹，细节交给 shade_wall 的 worldDetail）。
// 常年雪线随大陆起伏、物质噪声弯折，不再是一条纬线圆；冰原上有裂隙、露出的山脊。
layout(location = 0) out vec4 oc;
const float H_MU = 0.3355, A_MU = 0.4998;                        // 高度图 r、a 的均值（JS 镜像统计）
// 三向投影（权重 |n|⁴），按方差不变混合：三张平面图在 45° 处混合时不发灰
vec2 hTri(vec3 P, float S, vec3 nw, vec2 o){
  vec3 w = nw*nw; w *= w; w /= (w.x + w.y + w.z);
  vec4 a = textureLod(uHeight, P.yz/S + o, 0.0), b = textureLod(uHeight, P.zx/S + o.yx, 0.0), c = textureLod(uHeight, P.xy/S + o + 0.37, 0.0);
  vec2 m = vec2(H_MU, A_MU), v = w.x*(a.ra - m) + w.y*(b.ra - m) + w.z*(c.ra - m);
  return m + v/sqrt(dot(w, w));
}
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  float phiW = uv.x*2.0*PI, y = (uv.y*2.0 - 1.0)*uR, rho = sqrt(max(uR*uR - y*y, 0.0));
  float lam = phiW - uLamCam;                                    // 地固经度 → CM 经度
  vec3 X = vec3(rho*cos(lam), y, rho*sin(lam));
  vec3 Pw = vec3(rho*cos(phiW), y, rho*sin(phiW)), nw = Pw/uR;   // 地固位置（km）与单位方向
  vec4 zw = zoneW(X); float limbo = limboW(X);
  // 本纹素沿经向（南北）多长（km）：2R/1024 ÷ cosψ。太细的噪声在这里会混叠，按它淡出
  float ds = (2.0*uR/uRes.y)/max(rho/uR, 0.02);
  float k2 = 1.0 - sstep(40.0, 110.0, ds), k3 = 1.0 - sstep(12.0, 35.0, ds);
  float c1 = hTri(Pw, 10000.0, nw, vec2(0.13, 0.71)).x;
  float c2 = H_MU + (hTri(Pw, 3300.0, nw, vec2(0.37, 0.19)).x - H_MU)*k2;
  float c3 = H_MU + (hTri(Pw, 1100.0, nw, vec2(0.59, 0.43)).x - H_MU)*k3;
  float cont = 0.65*c1 + 0.3*c2 + 0.12*c3 - 0.2;               // 高度图均值约 0.34，cont 均值约 0.16、标准差约 0.3
  float mat = A_MU + (hTri(Pw, 1700.0, nw, vec2(0.21, 0.83)).y - A_MU)*mix(0.4, 1.0, k3);
  // 湖海：平域、重域约三成水面，轻域少，罪域没有
  float sea = mix(-0.02, -0.4, zw.x);
  float water = sstep(sea + 0.03, sea - 0.03, cont)*(1.0 - zw.w)*(1.0 - limbo);
  float g = uGEq*rho/uR;                                         // 当地重力（离轴越远越重）
  // 常年雪：近塔根（重力小）一圈，雪线随大陆高低、物质噪声上下几百公里地弯
  float snowLine = 0.36 + 0.1*(c2 - H_MU)/0.29 + 0.06*(mat - A_MU)/0.18 + 0.05*(cont - 0.16)/0.3;
  float snow = sstep(snowLine + 0.06, snowLine - 0.1, g);
  float ridge = 1.0 - abs(2.0*sat((c3 - H_MU)/0.57 + 0.5) - 1.0);          // 山脊线（露出的黑岩）
  float crev = sstep(0.82, 0.97, 1.0 - abs(2.0*fract(3.0*mat + 0.6*c3) - 1.0))*k3;   // 冰裂隙
  vec3 rock = mix(vec3(0.46, 0.46, 0.47), vec3(0.70, 0.71, 0.74), sstep(0.35, 0.65, mat));   // 白垩、灰白岩
  vec3 ice = mix(vec3(0.78, 0.80, 0.84), vec3(0.86, 0.88, 0.91), sstep(0.3, 0.7, mat));
  ice = mix(ice, vec3(0.35, 0.37, 0.41), 0.5*sstep(0.55, 0.85, ridge)*k2 + 0.55*crev);
  vec3 light = mix(rock, ice, snow);
  vec3 forest = vec3(0.045, 0.07, 0.03), field = vec3(0.13, 0.12, 0.065), dry = vec3(0.18, 0.16, 0.12);
  vec3 plain = mix(mix(forest, field, sstep(0.3, 0.6, mat)), dry, sstep(0.25, 0.6, c3));
  vec3 heavy = mix(vec3(0.085, 0.072, 0.06), vec3(0.125, 0.09, 0.06), sstep(0.3, 0.7, mat));
  vec3 rui = mix(vec3(0.05, 0.04, 0.038), vec3(0.20, 0.075, 0.04), sstep(0.25, 0.65, mat));           // 玄武黑与锈红
  vec3 lim = mix(vec3(0.22, 0.22, 0.23), vec3(0.035, 0.035, 0.04), sstep(0.62, 0.72, mat));           // 灰烬夹黑玻璃
  // 轻域的地貌边界（只管颜色，不改 zoneW 的分域）：按纬线圈一刀切时，对岸塔根一圈是一个正圆的白盘（问题单第 3 条）。
  // 按大陆起伏与物质噪声把边界前后推三四百公里，白岩、冰原沿山地伸出去、在低地缩回来
  float gP = g*(1.0 - 0.16*(c2 - H_MU)/0.29 - 0.08*(c3 - H_MU)/0.29*k3 + 0.06*(mat - A_MU)/0.18);
  float wl = 1.0 - sstep(uGLight - 0.05, uGLight + 0.05, gP), wh = zw.z;
  wl *= 1.0 - zw.w;
  vec3 alb = light*wl + plain*max(1.0 - wl - wh, 0.0) + heavy*wh;
  alb *= 0.85 + 0.3*sstep(-0.2, 0.6, c2);                        // 山地明暗
  alb = mix(alb, rui, zw.w);
  // 灵薄带的颜色边界（sky 二修，问题单“对岸一圈圈虚线亮弧”；只管颜色，不改 limboW 的分域）：按纬线一刀切时，
  // 深渊两侧各一条 100 多公里宽、比重域亮一倍半的灰烬带，从对岸看是两道以塔为心的正圆细线，黑玻璃斑又把它切成虚线。
  // 边界随大陆起伏、物质噪声前后推约三成，灰烬色压暗一些，与两侧的重域衔接
  float lW = uLimboKm*(1.0 + 0.32*(c2 - H_MU)/0.29 + 0.18*(mat - A_MU)/0.18*mix(0.4, 1.0, k3));
  float limboC = 1.0 - sstep(lW*0.7, lW*1.05, abs(y));
  alb = mix(alb, lim*vec3(0.72), limboC);
  alb = mix(alb, vec3(0.03, 0.045, 0.06), water);
  float abyss = 1.0 - sstep(uAbyssHalf*0.6, uAbyssHalf, abs(y));
  alb = mix(alb, vec3(0.015, 0.015, 0.017), abyss*step(0.001, uAbyssDepth));
  oc = vec4(clamp(alb, 0.0, 1.0), water);
}
