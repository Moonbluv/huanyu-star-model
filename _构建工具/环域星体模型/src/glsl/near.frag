// near.frag（NEAR_SCALE 在 common 里给默认值，高档由 defines 改成 0.5）
// E 路改写（只为编译量，积分次序与结果同 02 第十二节第 2 条）：02 原式在 main 里有 5 处 airSeg、每处再展开 2–3 份 airMarch，
// 加上写死上界的云循环，ANGLE/D3D11 上单这一个程序要编 15 秒以上。这里改成“段循环”：段数与步数都在运行时才知道，
// 编译器只保留一份 airMarch 与一份云步进。
uniform sampler2D uSurf;                                         // tSurf：a＝表面距离
layout(location = 0) out vec4 oc;
// 空气段：按两端离壁高度差定加密强度，霾层另分 2/5 样本（至多两小段，一处 airMarch）
void airSeg(vec3 d, float cd, float ta, float tb, int n, float jit, inout vec3 S, inout vec3 T, inout float TX){
  if (tb - ta <= 1e-5 || n <= 0) return;
  float za = zOfK(Kat(ta, cd)), zb = zOfK(Kat(tb, cd));
  float hz = min(5.0*uHM, 0.5*uZtop);
  vec2 sh = tShellCam(cd, hz);                                   // 霾层顶
  float tz = (sh.x > ta && sh.x < tb) ? sh.x : -1.0;
  bool split = tz > 0.0 && n >= 4;
  int nh = max(2, n*2/5), ns = split ? 2 : 1;
  for (int s = 0; s < ns; s++){
    float a = ta, b = tb, k = abs(zb - za)/(za < hz ? uHM : uHR); bool toEnd = zb < za; int m = n;
    if (split && s == 0){ b = tz; k = (hz - za)/uHM; toEnd = false; m = nh; }
    else if (split){ a = tz; k = (zb - hz)/uHR; toEnd = false; m = n - nh; }
    airMarch(d, cd, a, b, k, toEnd, m, jit, S, T, TX);
  }
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec3 d = viewRay(fc, uRes, uJitter, 1.0);                      // 按本 pass 的整个纹素抖动（合成的 upNear 同口径）
  float cd = dot(uCamW, d);
  float ts = texelFetch(uSurf, clamp(ivec2((fc + uJitter)/NEAR_SCALE), ivec2(0), textureSize(uSurf, 0) - 1), 0).a;
  float tEnd = min(tWallCam(cd), iTower(uCamW, d));
  if (ts > 0.0) tEnd = min(tEnd, ts);
  float e = segments(cd, tEnd).x;
  // 有地形／实例命中时一律积到命中点（E 路对 02 第四节第 1 条的改正）：不进真空核的掠射弦（α_w＜约 20°）若在弦中点之后
  // 才落到地面（远处 100–400 km 的阶地、翘起的地平线），02 原式只积到中点，后半段的空气没人积（远段 pass 不读 tSurf、
  // 积到内壁为止，合成又直接用 tSurf），远山少了一半雾。地形求交的上限是塔，所以命中点不会在塔后面。
  if (ts > 0.0) e = tEnd;
  float jit = ign(fc, uFrame);
  vec3 S = vec3(0.0), T = vec3(1.0); float TX = 1.0;
  if (uAtmoOn < 0.5 && uCloudOn < 0.5){ oc = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // ---- 云（clouds 路 2026-10-14 接管这一段）：交段与积分都在 clouds.glsl ----
  // cloudSpanCam：视线与云层（含罪域碎雨云；阶地模式近处按重力找平）的第一段交 [c0, c1]。
  // cloudMarch：[c0, c1] 上云与空气一起积——Q_CLOUD_KM 内体积云，往外平均场，中间连续换过去（不再有平板事件、圆环接缝、
  // 地平线云带的台阶）；罪域云盖与云缝同一套密度连续过渡（不再按云缝等值线一刀切两种算法）。
  vec2 cs = cloudSpanCam(d, cd, e);
  bool hasC = cs.x >= 0.0 && cs.x < e;
  float c0 = hasC ? cs.x : e, c1 = hasC ? min(cs.y, e) : e;
  int nA = hasC ? Q_NEAR_N/2 : Q_NEAR_N, nP = Q_NEAR_N - Q_NEAR_N/2;
  // ---- 段循环：0 空气 [0, c0)（无云时 [0, e]）；1 云＋空气 [c0, c1]；2 空气 (c1, e] ----
  int nst = hasC ? 3 : 1;
  for (int s = 0; s < nst; s++){
    if (s == 1){ cloudMarch(d, cd, c0, c1, jit, S, T, TX); continue; }
    float a = s == 0 ? 0.0 : c1, b = s == 0 ? c0 : e;
    airSeg(d, cd, a, b, s == 0 ? nA : nP, jit, S, T, TX);
  }
  oc = vec4(min(S, vec3(6.0e4)), TX);
}
