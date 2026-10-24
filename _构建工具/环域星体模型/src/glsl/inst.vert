// inst.vert：实例层顶点（02 第九节、第十六节第 4 条；负责：F 路）。拼在 common＋shadow＋terrain_lib＋shade_terrain 之后（DEFS.inst.chunks）。
// 构建后键名为 inst_vert。three 注入 position、normal（网格本地坐标，米，y 朝上）；aCell＝(局部格号 i, j, 格内序号)。
// 放置全在 GPU 上：全局格号＝uInstGrid.xy（相机所在格，CPU 双精度取模）＋局部格号 → PCG3D 哈希出偏移、朝向、缩放、是否存在
// （先按域与材质噪声在相机高度上粗筛，再贴地按坡度、阶地相位细筛）→ groundPoint 贴地。相机跨格时整体平移，实例不游动。
// 投影不用 three 的相机矩阵：直接用 uCamFwd/Right/Up、uTanHalfFov、uJitter，与 viewRay 逐像素一致；深度与 terrain.frag 的 gl_FragDepth 同式。
// 每种实例一个材质，defines：INST_TYPE（0 碎石 1 草丛 2 枯木灌丛 3 阶沿墙）、INST_LOD（0 近 1 远 2 不分）、INST_SPLIT（近远分界 km）。
uniform vec4 uInstGrid[4];                    // xy 相机所在格的全局格号（按 65536 取模），zw 该格原点相对相机的图表偏移 km
uniform vec4 uInstPar[4];                     // x 格宽 km，y 半径 km，z 每格个数，w 启用（阶沿墙＝近城才 1）
uniform float uInstTime;                      // 真实秒（草的摆动）
uniform float uInstNear, uInstFar;            // 实例相机 near/far（km；与 terrain.frag 写深度用的同一对，pass 写入）
in vec3 aCell;
out vec3 vV;                                  // 相对相机的位置 km
out vec3 vN;                                  // 法线（CM 系）
out vec3 vAlb;
out vec3 vMat;                                // x 粗糙度，y 湿，z 遮蔽
out vec2 vDc;                                 // 实例锚点的图表偏移（地平线角图、云影查用）
#ifndef INST_TYPE
#define INST_TYPE 0
#endif
#ifndef INST_LOD
#define INST_LOD 2
#endif
#ifndef INST_SPLIT
#define INST_SPLIT 0.04
#endif
void cull(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vV = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vAlb = vec3(0.0); vMat = vec3(1.0); vDc = vec2(0.0); }
vec3 eastAt(vec3 X){ float r = length(X.xz); return vec3(X.z, 0.0, -X.x)/max(r, 1e-6); }   // 图表“东”在 X 处的方向
void main(){
  vec4 GR = uInstGrid[INST_TYPE], PA = uInstPar[INST_TYPE];
  float cw = PA.x, rad = PA.y;
  ivec2 lc = ivec2(aCell.xy);
  uvec2 gc = uvec2((ivec2(GR.xy) + lc + 65536) & 65535);
  uint sub = uint(aCell.z) + uint(INST_TYPE)*16u;
  vec3 h = hash3f(uvec3(gc, 7919u + sub)), h2 = hash3f(uvec3(gc, 104729u + sub));
  vec2 dc = GR.zw + (vec2(lc) + (INST_TYPE == 3 ? vec2(0.5) : h.xy))*cw;
  float dist = length(dc);
  if (PA.w < 0.5 || dist > rad || aCell.z >= PA.z){ cull(); return; }
#if INST_LOD == 0
  if (dist > INST_SPLIT){ cull(); return; }
#elif INST_LOD == 1
  if (dist <= INST_SPLIT){ cull(); return; }
#endif
  // 先在“相机高度上的同一图表点”（不读细层，便宜）按分域、材质噪声筛：这些都是公里级才变的量，与贴地后的点差不出来。
  // 每个顶点都要把整套放置重算一遍，被筛掉的实例（罪域的草、平域的枯木、离崖沿远的墙格）在这里就退出，不做贴地与法线
  vec3 dir0, v0 = chartPoint(dc, dir0), X0 = uCamW + v0;
  vec4 zw = zoneW(X0); float limbo = limboW(X0);
  float nz = layerTex(3, dc).a, rnd = h.z, pre;
#if INST_TYPE == 0
  pre = 0.8*(0.55 + 0.45*(zw.x + zw.z + zw.w))*(1.0 - 0.6*limbo)*(0.7 + 0.6*sstep(0.35, 0.75, nz));   // 碎石：全部域；灵薄少
#elif INST_TYPE == 1
  pre = (zw.y + 0.35*zw.z)*(1.0 - zw.w)*(1.0 - limbo)*(0.5 + 0.8*sstep(0.25, 0.7, nz));               // 草丛：平域、重域
#elif INST_TYPE == 2
  pre = (0.45*zw.w + 0.5*zw.z*(1.0 - zw.w) + 0.08*zw.y)*(1.0 - limbo);                               // 枯木（罪域）、灌丛（重域）
#else
  pre = uGroundMode == 1 ? 0.85 : 0.0;                                                               // 阶沿墙：阶地模式；断续（一成五空着）
#endif
  if (rnd > pre){ cull(); return; }
  vec3 ex, up, alb, vg, X, upG; float s, bury = 0.0, rough = 0.85, wet = uWet*zw.w*0.6, ao = 1.0;
  vec3 p = position, nl = normal;
#if INST_TYPE == 3
  // 阶沿干砌石墙：沿崖沿内侧（相位 f＝c＋0.01），每个 20 m 格放本格里那一截，顺崖线走向。
  // 先在相机高度上取相位与梯度（altAt 低频档，置 gU 与梯度缓存；同一图表点的相位与地面点相同）
  altAt(v0, 1e-3, 1);
  vec3 E0 = eastAt(X0), Nn = vec3(0.0, -1.0, 0.0);
  vec2 gu = vec2(duDt(v0, E0), duDt(v0, Nn)); float gl = length(gu);   // 相位对（东, 北）的梯度（/km）
  if (gl < 1e-4){ cull(); return; }
  float df = uCliffC + 0.01 - gU; df -= floor(df + 0.5);       // 到最近的崖沿内侧（相位）
  if (abs(df) > 1.5*cw*gl){ cull(); return; }                   // 崖沿离格心超过 30 m：不归本格
  vec2 tc = vec2(-gu.y, gu.x)/gl;                               // 崖线切向（图表，单位向量）
  vec2 pl = dc + df/gl*gu/gl;                                   // 崖沿上离格心最近的点（沿相位梯度挪过去，km）
  // 把格心附近的这段崖沿（按直线）裁到本格的方块里：墙只盖本格这一段，相邻格首尾相接，不重叠、不留缝
  vec2 co = GR.zw + vec2(lc)*cw, q0 = co - pl, q1 = co + cw - pl; float s0 = -1e9, s1 = 1e9;   // 两个轴分开写（不用动态下标：ANGLE 会模拟，慢）
  if (abs(tc.x) > 1e-6){ vec2 ab = vec2(q0.x, q1.x)/tc.x; s0 = max(s0, min(ab.x, ab.y)); s1 = min(s1, max(ab.x, ab.y)); }
  else if (q0.x > 0.0 || q1.x <= 0.0) s1 = -1e9;
  if (abs(tc.y) > 1e-6){ vec2 ab = vec2(q0.y, q1.y)/tc.y; s0 = max(s0, min(ab.x, ab.y)); s1 = min(s1, max(ab.x, ab.y)); }
  else if (q0.y > 0.0 || q1.y <= 0.0) s1 = -1e9;
  if (s1 - s0 < 0.002){ cull(); return; }                       // 只擦过一个角（不到 2 m）：留给邻格
  dc = pl + tc*(0.5*(s0 + s1));
  vg = groundPoint(dc); X = uCamW + vg; upG = -vec3(X.x, 0.0, X.z)/length(X.xz);
  if (abs(gU - uCliffC - 0.01) > 0.004){ cull(); return; }      // 直线近似失手（崖沿在这里拐得急）或落进崖带：不放
  up = upG;
  ex = normalize(tc.x*eastAt(X) + tc.y*Nn); ex = normalize(ex - up*dot(ex, up));
  s = 1.0;
  p = position*vec3((s1 - s0)*1000.0/20.0, 0.8 + 0.4*h2.y, 1.0);   // 网格长 20 m，按本格这段崖沿的长度伸缩
  alb = mix(vec3(0.17, 0.16, 0.15), vec3(0.24, 0.22, 0.19), h2.x)*mix(1.0, 0.45, zw.w);
  bury = 0.05; rough = 0.85; ao = 0.8;
#else
  vg = groundPoint(dc);                                         // 置缓存 gU、gK、gDc 与梯度
  X = uCamW + vg;
  upG = -vec3(X.x, 0.0, X.z)/length(X.xz);                      // 重力“上”
  vec3 nG = terrainNormal(vg, 1e-3);
  float flatG = dot(nG, upG), cliff = uGroundMode == 1 ? 1.0 - sstep(uCliffC - 0.01, uCliffC + 0.01, gU) : 0.0;
#if INST_TYPE == 0
  // 碎石、卵石：贴着地面的坡
  up = normalize(mix(upG, nG, 0.75));
  float hy2 = h2.y*h2.y;
  s = (0.06 + 0.25*hy2 + 0.4*hy2*hy2*hy2)*(h2.x < 0.03 ? 3.0 : 1.0);      // 半径 m：多为 6–30 cm，少数半米，偶有大石
  vec3 ax = vec3(0.7 + 0.6*h2.z, 0.45 + 0.35*h.y, 0.7 + 0.6*h.x);
  float dsp = 1.0 + 0.22*sin(dot(normal, vec3(3.1, 1.7, 2.3))*(1.0 + 2.0*h2.y) + 6.283*h2.z) + 0.12*sin(dot(normal, vec3(-5.3, 4.1, 1.9)) + 6.283*h.z);
  p = position*ax*dsp; nl = normalize(normal/ax);
  bury = 0.3*s*ax.y;
  vec3 basalt = vec3(0.04, 0.036, 0.034), rust = vec3(0.17, 0.07, 0.04);
  vec3 rr = mix(basalt, rust, step(0.7, h2.x)*0.8), hv = vec3(0.10, 0.085, 0.07), pl = vec3(0.19, 0.18, 0.17), lt = vec3(0.48, 0.47, 0.46);
  vec3 lm = mix(vec3(0.22, 0.22, 0.23), vec3(0.03, 0.03, 0.035), step(0.6, h2.z));
  alb = mix(mix(lt*zw.x + pl*zw.y + hv*zw.z, rr, zw.w), lm, limbo)*(0.75 + 0.5*h.x);
  rough = mix(0.8, 0.4, wet); ao = 0.85;
#elif INST_TYPE == 1
  // 草丛：踏面上，崖面没有
  if (rnd > pre*sstep(0.8, 0.92, flatG)*(1.0 - cliff)){ cull(); return; }
  up = upG;
  s = 0.25 + 0.35*h2.y;
  float hgt = max(position.y, 0.0);                            // 草叶本地高度 0..1，按高度摆动
  float sw = 0.12*hgt*hgt*sin(uInstTime*(1.3 + h2.z) + 6.283*h.x);
  p = position + vec3(sw, 0.0, 0.5*sw);
  nl = normalize(normal + vec3(0.0, 1.6, 0.0));                // 一丛草整体近似朝上受光（细叶的法线太随机，会显得发黑）
  vec3 green = vec3(0.07, 0.11, 0.035), dryg = vec3(0.17, 0.15, 0.075);
  alb = mix(green, dryg, sstep(0.2, 0.9, h2.x*0.6 + zw.z*0.5))*(0.8 + 0.4*h.y)*(0.65 + 0.35*hgt);
  rough = 0.7; wet = 0.0; ao = 0.7 + 0.3*hgt;
#else
  // 枯木（罪域）、灌丛（重域）：不长在崖面上
  if (rnd > pre*sstep(0.7, 0.85, flatG)*(1.0 - cliff)){ cull(); return; }
  up = upG;
  float shrub = (1.0 - zw.w)*step(0.35, h2.z);                 // 重域多为灌丛：同一网格压扁
  s = mix(2.5 + 4.0*h2.y, 0.7 + 0.8*h2.y, shrub);
  vec3 ax = mix(vec3(1.0), vec3(1.8, 0.45, 1.8), shrub);
  p = position*ax; nl = normalize(normal/ax);
  float lean = 0.15*(h.x - 0.5);
  p.x += lean*p.y;
  alb = mix(vec3(0.11, 0.09, 0.075), vec3(0.06, 0.07, 0.04), shrub)*(0.8 + 0.4*h.y);
  if (zw.w > 0.5) alb = mix(alb, vec3(0.05, 0.045, 0.042), 0.5);   // 罪域的枯木被酸雨泡黑
  bury = 0.05*s; rough = 0.9;
#endif
  float ang = 6.283185*h2.x;
  vec3 t0 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t1 = cross(up, t0);
  ex = cos(ang)*t0 + sin(ang)*t1;
#endif
  vec3 ez = cross(ex, up);                                      // (ex, up, ez) 右手系：网格的绕序保持不变
  vec3 V = vg + (p.x*ex + p.y*up + p.z*ez)*(s*0.001) - up*(bury*0.001);
  vV = V; vN = normalize(nl.x*ex + nl.y*up + nl.z*ez);
  vAlb = alb; vMat = vec3(rough, wet, ao); vDc = gDc;
  float zc = dot(V, uCamFwd), aspect = uRes.x/uRes.y;
  gl_Position = vec4(dot(V, uCamRight)/(uTanHalfFov*aspect) - 2.0*uJitter.x/uRes.x*zc,
                     dot(V, uCamUp)/uTanHalfFov - 2.0*uJitter.y/uRes.y*zc,
                     zc*(uInstFar + uInstNear)/(uInstFar - uInstNear) - 2.0*uInstFar*uInstNear/(uInstFar - uInstNear),
                     zc);
}
