// clouds.glsl：拼在 common、shadow（、sheath、air）之后（近段、远段、探针、地形、云影图、远壁共用；02 第十节）。负责：clouds 路。
// 对外函数（签名不改）：cloudTopAt(X)、weatherAt(X)、cloudDens(X, z, wx, lod)、cloudSource(X, K, z, sig, d)、slabCloud(X, d, tau)、
//   ruiDeckTau(X)、ruiDeck(X, cov)、jetProf(y)、cloudShadowTau(dc)
// 2026-10-14 clouds 路修订（问题单 1–21）新增：
//   cloudSpanCam(d, cd, tMax)／cloudSpanAt(O, dir, tMax)：射线与云层（含罪域碎雨云；阶地模式近处按重力找平，见 common 的 cloudLift）的第一段交
//   cloudMean(X, z, wx)：体积云在噪声上的平均密度（远处的平均场；clouds_check 用 JS 镜像标定，与体积云同一均值）
//   cloudMarch(d, cd, c0, c1, jit, S, T, TX)：近段的云＋空气（只在拼了 air 的 pass 里有）——Q_CLOUD_KM 内体积云，往外平均场，
//     0.6·Q 到 Q 之间连续换过去；罪域云盖与云缝同一套密度连续过渡，不再按“云缝等值线”一刀切两种算法
//   cloudSkyProbe(d)：探针的云（只给漫射；直射由云影图在地面、眼睛那里算，不重复）
//   csTauAbove(Y, l, hL)：云影图里，Y 朝日一侧上方还剩多厚的云（按高度分层存，自遮挡才有向阳面、背阴面）
//   worldDetail(X, alb, water)：远壁、对面世界的细节（极区各向同性；望远能看到一两公里的结构）
// 取样一律 textureLod(…, 0)：这些纹理都没有多级，且多在运行时才知道次数的循环里调用（隐式导数在循环里没有定义，HLSL 报 X3595）。
uniform float uCloudCov;                                         // 覆盖度滑杆（uCM2W 已挪到 common.glsl）

// ======================= 风 =======================
// 一切噪声都按同一个风程平移（问题单第 19 条：原先各层按 P/L＋uWind·k 平移，k 与 L 不成比例，云形、细节、云缝各走各的）。
// uWind 一个单位＝0.48 km 的风程（settings.js S.wind：P/24＋uWind·0.02）；uWind 各分量按 1000 取模，所以 L 取 480/整数（整周期，不跳）。
const float CL_WKM = 0.48;
vec3 wq(vec3 P, float L){ return P/L - uWind*(CL_WKM/L); }

// ======================= 天气图查用 =======================
// 第 k 条纬带的转速（÷JET_RATE，±0.55–1，相邻两条反向）：与 bake_weather.frag 的 bandOmega 逐位相同
uint cwHash(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float cwH01(int a, int b){ return float(cwHash(uint(a)*0x9e3779b9u + cwHash(uint(b) + 0x632be5abu)) >> 8)/16777216.0; }
float bandRel(int k){ return ((k & 1) == 0 ? 1.0 : -1.0)*(0.55 + 0.45*cwH01(k, 1)); }
float jetProf(float y){                                          // y＝单位方向的 y；带边 0.14 带宽内线性过渡（烘焙也在这里交叉淡化）
  float vb = (y + 1.0)*9.0, k = clamp(floor(vb), 0.0, 17.0), f = vb - k;
  float a = bandRel(int(k));
  if (f < 0.14 && k > 0.0) return mix(bandRel(int(k) - 1), a, 0.5 + 0.5*f/0.14);
  if (f > 0.86 && k < 17.0) return mix(a, bandRel(int(k) + 1), 0.5*(f - 0.86)/0.14);
  return a;
}
float cloudTopAt(vec3 X){ float zt = mix(uCloudTop, uRuiTop, ruiW(X)); return zt + cloudLift(X, zt); }
float scudDepth(vec3 X){ return uRuiOvc > 0.0 ? 0.75*ruiW(X)*uRuiOvc : 0.0; }   // 罪域云盖下挂着的碎雨云层厚（km）

// 云影图里的整柱 τ（cloudShadowT 给 exp(−τ)；这里直接给 τ，厚云不被截在 τ≈9）
float cloudShadowTau(vec2 dc){
  if (uCloudOn < 0.5) return 0.0;
  vec4 c = csFetch(dc);
  return c.r < 0.0 ? 0.0 : max(c.r, 0.0);
}

// 塔两端（极冠）：等面积图在那里一个纹素沿经向拉得很长（长宽比约 0.64/sin²ψ，ψ＝10° 时 20:1），直接取会成放射条纹。
// 这里按三维位置现算一份同口径的天气（纬带＋底图 fbm＋覆盖度映射），按纹素长宽比渐变替换（|y|＞0.8 起，0.93 全换）。
vec4 polarWeather(vec3 n){
  vec3 q = n*1.3 + vec3(0.21, 0.0, 0.47);
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ f += a*textureLod(uNoise3, q, 0.0).r; q = q*2.03 + 0.17; a *= 0.5; }
  float bz = (f/0.9375 - 0.684)/0.056;
  float pr = bz + 0.9*sin(9.0*PI*n.y);
  float u = 1.0/(1.0 + exp(-1.7*(pr - 0.08)/1.22));
  float C = clamp(uCloudCov, 0.0, 1.0);
  float cov = max(sstep(1.0 - C - 0.25, 1.0 - C + 0.25, u)*sat(C/0.03), sat((C - 0.97)/0.03));
  float typ = sat(0.25 + 0.22*(textureLod(uNoise3, n*0.9 + 0.5, 0.0).g - 0.4)/0.19 - 0.45*sstep(0.7, 1.0, cov));   // 轻域偏层云
  float thick = clamp(1.0 + 0.4*(textureLod(uNoise3, n*2.1 + 0.3, 0.0).b - 0.4)/0.19, 0.6, 1.4);
  return vec4(cov, typ, thick, sstep(0.55, 0.9, cov)*(1.0 - typ));
}
// 罪域云缝：40 km 胞的反 Worley，过阈值处是缝（约 6% 的面积）；边缘再用 24 km 的噪声撕碎。
// 云缝场随风走（与云形同一风程），另外每约 4 模拟小时在两组错开的图样之间渐变一轮（按方差不变的方式混合，缝的总面积不随相位涨落）：
// 缝会开、会合，住在罪域的人隔几天总能遇到一次（问题单第 20 条）。相位取 uWind.x（随模拟时间增长，按 1000 取模时 4 轮整周期）。
float ruiGap(vec3 P){
  float ph = uWind.x*0.004, i0 = floor(ph), f = ph - i0, w = f*f*(3.0 - 2.0*f);
  vec3 q = wq(P, 160.0);
  vec3 o0 = vec3(0.37, 0.11, 0.73)*mod(i0, 4.0), o1 = vec3(0.37, 0.11, 0.73)*mod(i0 + 1.0, 4.0);
  float a = textureLod(uNoise3, q + o0, 0.0).g, b = textureLod(uNoise3, q + o1, 0.0).g;
  float g = 0.408 + ((1.0 - w)*(a - 0.408) + w*(b - 0.408))/sqrt(sq(1.0 - w) + w*w);
  float r = textureLod(uNoise3, wq(P, 24.0), 0.0).r;
  return sstep(0.62, 0.78, g + 0.35*(r - 0.684));
}
// 查用：差速旋转＋解码＋极冠＋罪域阴云（带云缝）＋阴云带外缘的碎云。返回 (覆盖, 类型, 厚度 0.6–1.4, 降水)
vec4 weatherAt(vec3 X){
  vec3 n = normalize(X); vec2 uv = eqArea(X);
  uv.x = fract(uv.x - uJetPhase*jetProf(n.y)/(2.0*PI));         // 补上距上次烘焙的转角（各带按自己的速度）
  vec4 w = textureLod(uWeather, uv, 0.0);
  float cov = w.r, typ = w.g, thick = 0.6 + 0.8*w.b, prec = w.a;
  float pk = sstep(0.8, 0.93, abs(n.y));
  if (pk > 0.0){ vec4 pw = polarWeather(uCM2W*n); cov = mix(cov, pw.r, pk); typ = mix(typ, pw.g, pk); thick = mix(thick, pw.b, pk); prec = mix(prec, pw.a, pk); }
  if (uRuiOvc > 0.0){
    float c = dot(n, uRuiDir), rw = ruiW(X)*uRuiOvc;
    // 阴云带外缘：罪域半径的 0.9–1.5 倍一圈碎云（从外面看，地平线上是一堵云墙）
    float ro = sstep(cos(1.5*uRuiRad/uR), cos(0.9*uRuiRad/uR), c)*uRuiOvc;
    if (ro > 0.0){
      float br = textureLod(uNoise3, wq(uCM2W*X, 60.0), 0.0).g;
      cov = max(cov, ro*(0.35 + 0.6*sstep(0.15, 0.5, br)));
    }
    if (rw > 0.0){
      float gap = ruiGap(uCM2W*X);
      cov = max(cov, rw*(1.0 - 0.72*gap));                      // 缝里覆盖降到约 0.3：碎云，透出塔带、日面、月亮
      typ = mix(typ, 0.3*gap, rw); prec = max(prec, rw*0.85*(1.0 - gap));
    }
  }
  return vec4(cov, typ, thick, prec);
}

// ======================= 密度 =======================
// 小尺度云形的隆起度 B（0–1，大致均匀分布，所以覆盖 cov 的格子里约 cov 那么多的体积有云）：
// 积云以 3 km 的 Worley 胞为主（一朵一朵的圆顶；1.5 km 的胞给子泡，6 km 的胞让它们成簇），层云用 Perlin-Worley 的连片起伏
float cloudBillow(vec4 s, float typ){
  float cum = (0.25*s.g + 0.6*s.b + 0.15*s.a - 0.403)/0.127;
  float lay = (s.r - 0.684)/0.092;
  float zc = mix(lay, cum, typ)/sqrt(sq(1.0 - typ) + sq(typ));
  return 1.0/(1.0 + exp(-1.7*zc));
}
// 一朵云自己能长多高（离云底 km）：层云约层高的 0.16，积云 0.42；厚度系数按平方放大（0.6 淡积云 → 1.4 浓积云）
float cloudHTop(float H, vec4 wx){ return H*mix(0.16, 0.42, wx.g)*sq(wx.b); }
// 罪域厚云盖的光学厚度：uRuiTau × 低频（96 km）× 中频起伏（40 km：云底一大片浅灰深灰）
float ruiDeckTau(vec3 X){
  vec3 P = uCM2W*X;
  float lo = 0.6 + 0.8*textureLod(uNoise3, wq(P, 96.0), 0.0).r;
  vec4 s = textureLod(uNoise3, wq(P, 40.0), 0.0);
  float mid = clamp(1.0 + 0.55*((0.55*s.g + 0.3*s.b + 0.15*s.a) - 0.4)/0.13, 0.45, 1.8);
  return uRuiTau*lo*mid;
}
// 罪域云盖的小尺度起伏（0.3–2 km 的胞与卷，0.45–1.9 倍；问题单第 14 条：原先只有 8 km 以上的软斑）
float ruiFine(vec3 P){
  vec4 a = textureLod(uNoise3, wq(P, 8.0), 0.0), b = textureLod(uNoise3D, wq(P, 2.4), 0.0);
  float f = 0.35*(0.6*a.g + 0.4*a.b) + 0.3*(a.r - 0.284) + 0.35*(0.6*b.g + 0.4*b.b);
  return clamp(1.0 + 1.6*(f - 0.4), 0.45, 1.9);
}
// 罪域云盖的程度（0–1）：阴云区里、覆盖接近满的地方（云缝里不算）。宽过渡：缝边的云盖渐渐变薄、变成碎云
float ruiDeck(vec3 X, float cov){ return uRuiOvc > 0.0 ? ruiW(X)*uRuiOvc*sstep(0.55, 0.95, cov) : 0.0; }
// 碎雨云（罪域云盖下 0.05–0.7 km 一缕缕低云，比云盖暗）：dz＝在云底以下多深。
// 原先 12 km 的胞取阈值，从下面看是一个个圆滚滚的暗团（像圆点花布）。改成三层（10 km 成片、1.6 km 成缕、0.5 km 撕碎），
// 占天空一成上下，边缘破碎发虚
float scudDens(vec3 P, float dz, float dk){
  float pr = sstep(0.05, 0.2, dz)*(1.0 - sstep(0.35, 0.7, dz));
  if (pr <= 0.0) return 0.0;
  vec4 a = textureLod(uNoise3, wq(P, 9.6), 0.0), b = textureLod(uNoise3D, wq(P, 1.6), 0.0), c = textureLod(uNoise3D, wq(P, 0.48), 0.0);
  float f = 0.45*a.b + 0.15*a.a + 0.25*b.g + 0.15*c.b;
  return dk*pr*sat((f - 0.54)/0.07)*0.32;
}
// 密度（0–1，乘 uCloudSigma 得消光 /km）。层云薄而平、边缘软；积云底平、越往上门槛越高，收成圆顶，外壳薄（问题单第 13 条：
// 原先外壳几百米，边缘像喷枪柔化的棉花）；积云的有效覆盖打八折，满覆盖的格子里也留着朵与朵之间的空当。
// 罪域云盖：整层（云底到云顶）都是云，整层光学厚度约 ruiDeckTau×小尺度起伏，云底 0.3 km 更密；云底挂着乳状云包，再往下是碎雨云。
// lod 0（近处）再用细节噪声侵蚀边缘：0.3–1.2 km 的胞，积云顶上翻卷成花椰菜，底部絮状。
float cloudDens(vec3 X, float z, vec4 wx, int lod){
  float cov = wx.r, typ = wx.g;
  if (cov <= 0.01) return 0.0;
  float zb = cloudBaseAt(X), zt = cloudTopAt(X), dk = ruiDeck(X, cov);
  if (z >= zt || z <= zb - 0.75*dk) return 0.0;
  vec3 P = uCM2W*X;
  if (z < zb) return scudDens(P, zb - z, dk);
  vec4 s = textureLod(uNoise3, wq(P, 24.0), 0.0);
  float H = zt - zb;
  // 云底高低：24 km 的大起伏（原先 0.35 km 的乳状大包，从下面看是一个个圆暗团）收成 0.15 km，另加 6 km、1.5 km 两层小起伏
  float zb2 = zb;
  if (dk > 0.0){
    vec4 u = textureLod(uNoise3, wq(P, 6.0), 0.0), v = textureLod(uNoise3D, wq(P, 1.5), 0.0);
    zb2 += dk*(0.15*(1.0 - sstep(0.2, 0.75, s.a)) + 0.12*sat((u.g - 0.2)/0.5) + 0.06*v.g);
  }
  float hh = (z - zb2)/max(mix(cloudHTop(H, wx), H - 0.35*dk, dk), 0.05);
  if (hh <= 0.0 || hh >= 1.0) return 0.0;
  float B = mix(cloudBillow(s, typ), 1.0, 0.55*dk);
  hh -= (1.0 - B)*mix(0.25, 0.04, typ)*(1.0 - dk);               // 层积云的底高低不平（隆起度低处云底抬高）；积云底平
  float floorK = sstep(0.0, mix(0.1, 0.035, typ), hh);           // 底平：积云 1/30 云高内长满
  // 门槛随高度升：积云收成圆顶；层云顶也按隆起度高低起伏，整层厚薄不一，从下面看才一块亮一块暗
  float thr = (1.0 - cov*mix(1.0, 0.8, typ)) + mix(0.45, 0.55, typ)*hh*hh*(1.0 - 0.7*dk) + 0.4*(1.0 - floorK);
  float k = mix(0.75, 1.0, typ)*wx.b;
  if (dk > 0.0) k = mix(k, ruiDeckTau(X)*ruiFine(P)/(uCloudSigma*max(H, 0.5))*(1.0 + 2.0*(1.0 - sstep(0.0, 0.08, hh))), dk);
  // 细节（lod 0）：在“隆起度 − 门槛”上加带符号的细节噪声，再取边——轮廓按 2.4 km、0.7 km 两层鼓包、絮卷起伏，
  // 不再是底图 375 m 纹素三线性插值出来的多边形（问题单第 13 条：近云像棉花团、橡皮泥）。细的一层按像素多大淡出（不闪），
  // 整个细节按离相机的距离在 0.6–0.95·Q 淡出（与平均场衔接）。
  float x = B - thr;
  if (lod == 0 && x > -0.3){
    float dist = length(X - uCamW), fd = 1.0 - sstep(0.6*Q_CLOUD_KM, 0.95*Q_CLOUD_KM, dist);
    if (fd > 0.0){
      float fpx = dist*2.0*uTanHalfFov/uRes.y;                     // 一个（本 pass 的）像素在那里多大（km）
      vec4 dn = textureLod(uNoise3D, wq(P, 2.4), 0.0);
      float det = (dn.g*0.625 + dn.b*0.25 + dn.a*0.125) - 0.4;
      float f2 = 1.0 - sstep(0.04, 0.12, fpx);
      if (f2 > 0.0){ vec4 dm = textureLod(uNoise3D, wq(P, 0.7), 0.0); det += 0.55*f2*((0.6*dm.g + 0.4*dm.b) - 0.4); }
      det = mix(-det, det, sat(hh*4.0));                          // 底部絮状（反相）、上部翻卷
      x += fd*mix(0.22, 0.32, typ)*(1.0 - 0.6*dk)*(det - 0.1);    // 略偏负：细节把边啃进去，云团不胖一圈
    }
  }
  float sh = sat(x/mix(0.08, 0.04, typ));
  sh *= 2.0 - sh;                                                 // 边缘很快就密起来：云边是一条清楚的轮廓，不是几百米的薄纱
  // 积云的芯比边密（液水含量往里、往上增）：边薄、透光、亮边，芯厚、背阴面才暗得下去。均值约 1.2 倍（cloudMean 同口径）
  float core = sat(x/0.3);
  return sh*k*mix(1.0, 0.45 + 1.5*core, mix(0.6, 1.0, typ)*(1.0 - dk));
}
// 平均密度：cloudDens（lod 1）在噪声上的期望（B 按 0–1 均匀算解析期望，再乘 CL_MEAN_K 标定；clouds_check 用 JS 镜像核对）。
// 远处的平均场用它：顶部按 12 km 的胞起伏（0.65–1.35 倍），地平线上的云堤顶不再是一条平线。
const float CL_MEAN_K = 1.0;
float satMean(float a, float w){                                  // ∫₀¹ clamp((B − a)/w, 0, 1) dB
  float lo = clamp(a, 0.0, 1.0), hi = clamp(a + w, 0.0, 1.0);
  return (sq(hi - a) - sq(lo - a))/(2.0*w) + (1.0 - hi);
}
float cloudMean(vec3 X, float z, vec4 wx){
  float cov = wx.r, typ = wx.g;
  if (cov <= 0.01) return 0.0;
  float zb = cloudBaseAt(X), zt = cloudTopAt(X), dk = ruiDeck(X, cov);
  if (z <= zb || z >= zt) return 0.0;
  float H = zt - zb;
  vec3 P = uCM2W*X;
  float tm = 0.65 + 0.7*sat((textureLod(uNoise3, wq(P, 48.0), 0.0).g - 0.1)/0.65);
  float hc = mix(cloudHTop(H, wx)*tm, H, dk);
  float hh = (z - zb)/max(hc, 0.05);
  if (hh >= 1.0) return 0.0;
  float floorK = sstep(0.0, mix(0.1, 0.035, typ), hh);
  float thr = (1.0 - cov*mix(1.0, 0.8, typ)) + mix(0.45, 0.55, typ)*hh*hh + 0.4*(1.0 - floorK);
  float m = satMean(thr, mix(0.08, 0.04, typ))*mix(0.75, 1.0, typ)*wx.b*CL_MEAN_K;
  m *= mix(1.0, 1.2, mix(0.6, 1.0, typ)*(1.0 - dk));                             // 积云芯更密（cloudDens 的 core 项的均值）
  if (dk > 0.0) m = mix(m, ruiDeckTau(X)/(uCloudSigma*max(H, 0.5)), dk);
  return m;
}
// 平均场的纹理（只在近段 Q 以外那一段用，均值约 1）：12 km、4 km 两层团块，远处一叠叠云堤顶部起伏、有一团一团的体积感，
// 不是一条条光滑的长条（问题单第 11、13 条）。细的一层按像素多大淡出
float cloudMeanTex(vec3 X, float t){
  vec3 P = uCM2W*X;
  vec4 q = textureLod(uNoise3, wq(P, 12.0), 0.0), r = textureLod(uNoise3, wq(P, 4.0), 0.0);
  float fpx = t*2.0*uTanHalfFov/uRes.y, f2 = 1.0 - sstep(0.4, 1.2, fpx);
  float n = (0.6*q.g + 0.4*q.b - 0.403)/0.17 + 0.6*f2*(r.b - 0.403)/0.196;
  return clamp(1.0 + 0.5*n, 0.0, 2.4);
}
// 一柱云的平均竖直光学厚度（探针、远处平均场的自遮挡用）：四个高度上平均密度的积分
float cloudColTau(vec3 X, vec4 wx){
  float zb = cloudBaseAt(X), zt = cloudTopAt(X), s = 0.0;
  for (int i = 0; i < 4; i++){ float z = zb + (zt - zb)*(float(i) + 0.5)/4.0; s += cloudMean(X, z, wx); }
  return s*(zt - zb)/4.0*uCloudSigma;
}

// ======================= 射线与云层的交段 =======================
// 云层（含罪域碎雨云）以内为正
float layerIn(vec3 X, float z){ return min(z - (cloudBaseAt(X) - scudDepth(X)), cloudTopAt(X) - z); }
float spanF(vec3 O, vec3 dir, float t, bool cam, float cd){
  vec3 X = O + dir*t; return layerIn(X, cam ? zOfK(Kat(t, cd)) : zOfK(Kof(X)));
}
// 解析：同心球壳（斜坡模式；阶地模式在 CLV_R1 以外也是它）。zLo、zHi＝全局最低云底（含碎雨云）、最高云顶
vec2 shellSpan(vec3 O, vec3 dir, bool cam, float cd, float tMin){
  float zLo = min(uCloudBase, uRuiBase - (uRuiOvc > 0.0 ? 0.75 : 0.0)), zHi = max(uCloudTop, uRuiTop);
  vec2 B, Tt; float zO;
  if (cam){ B = tShellCam(cd, zLo); Tt = tShellCam(cd, zHi); zO = uCamZ; cd = cd; }
  else { B = iSphere(O, dir, uR - zLo); Tt = iSphere(O, dir, uR - zHi); zO = zOfK(Kof(O)); if (B.x > B.y) B = vec2(-1.0); if (Tt.x > Tt.y) Tt = vec2(-1.0); cd = dot(O, dir); }
  // 所有边界穿越点里，取 tMin 之后的第一个“进入”和它之后的第一个“离开”
  float c0 = -1.0, c1 = -1.0;
  bool up = cd < 0.0;
  if (zO < zLo){ if (up && B.x > 0.0){ c0 = B.x; c1 = Tt.x > 0.0 ? Tt.x : B.y; } }
  else if (zO < zHi){ c0 = 0.0; c1 = (up && Tt.x > 0.0) ? Tt.x : (B.y > 0.0 ? B.y : 1e9); }
  else if (!up && B.y > 0.0){ c0 = max(Tt.y, 0.0); c1 = B.y; }
  if (c0 < 0.0 || c1 <= tMin) return vec2(-1.0);
  return vec2(max(c0, tMin), c1);
}
// 数值：近处（阶地模式按重力找平，云层不是球壳）。tN 以内 20 个样本（平方分布，近密远疏）找第一段，二分各 6 次；tN 以外交给 shellSpan
vec2 spanNumeric(vec3 O, vec3 dir, float tMax, bool cam, float cd){
  float tN = min(tMax, 1.3*CLV_R1), tPrev = 0.0, a0 = -1.0, b0 = -1.0, a1 = -1.0, b1 = -1.0;
  bool inP = spanF(O, dir, 0.0, cam, cd) > 0.0;
  if (inP){ a0 = 0.0; b0 = 0.0; }
  for (int i = 1; i <= 20; i++){
    float u = float(i)/20.0, t = tN*u*u;
    bool inT = spanF(O, dir, t, cam, cd) > 0.0;
    if (a0 < 0.0 && inT){ a0 = tPrev; b0 = t; }
    else if (a0 >= 0.0 && !inT){ a1 = tPrev; b1 = t; break; }
    tPrev = t;
  }
  if (a0 < 0.0){                                                   // tN 以内没有云层：tN 以外按球壳
    if (tMax <= tN) return vec2(-1.0);
    vec2 s = shellSpan(O, dir, cam, cd, tN);
    return s.x < 0.0 ? s : vec2(s.x, min(s.y, tMax));
  }
  for (int j = 0; j < 6; j++){ float m = 0.5*(a0 + b0); if (spanF(O, dir, m, cam, cd) > 0.0) b0 = m; else a0 = m; }
  float c0 = b0, c1;
  if (a1 >= 0.0){
    for (int j = 0; j < 6; j++){ float m = 0.5*(a1 + b1); if (spanF(O, dir, m, cam, cd) > 0.0) a1 = m; else b1 = m; }
    c1 = b1;
  } else {                                                         // 到 tN 还在云层里：出口按球壳
    vec2 s = shellSpan(O, dir, cam, cd, tN);
    c1 = s.x >= 0.0 && s.x <= tN + 1e-3 ? s.y : tN;
  }
  return vec2(c0, min(c1, tMax));
}
vec2 cloudSpanCam(vec3 d, float cd, float tMax){
  if (uCloudOn < 0.5) return vec2(-1.0);
  if (uGroundMode != 1){ vec2 s = shellSpan(uCamW, d, true, cd, 0.0); return (s.x < 0.0 || s.x >= tMax) ? vec2(-1.0) : vec2(s.x, min(s.y, tMax)); }
  return spanNumeric(uCamW, d, tMax, true, cd);
}
vec2 cloudSpanAt(vec3 O, vec3 dir, float tMax){
  if (uCloudOn < 0.5) return vec2(-1.0);
  if (uGroundMode != 1 || length(O - uCamW) > 1.5*CLV_R1){ vec2 s = shellSpan(O, dir, false, 0.0, 0.0); return (s.x < 0.0 || s.x >= tMax) ? vec2(-1.0) : vec2(s.x, min(s.y, tMax)); }
  return spanNumeric(O, dir, tMax, false, 0.0);
}

// ======================= 光照 =======================
// 云影图：Y 朝日方向上方还剩多少光学厚度。Y 的那一柱＝沿 −l 落到相机脚下那一层地面的点；hL＝Y 在整层里的相对高度。
// 图外 ok＝假（调用方按平均柱估）。
float csTauAbove(vec3 Y, vec3 l, float hL, out bool ok){
  vec3 v = Y - uCamW, up; float h;
  if (uGroundMode == 1){ up = -vec3(Y.x, 0.0, Y.z)/max(length(Y.xz), 1.0); h = -dRxz(v) + uCamAlt; }
  else { up = -normalize(Y); h = zOfK(Kof(Y)) - uCamZ + uCamAlt; }
  vec4 c = csFetch(chartD(v - l*(max(h, 0.0)/max(dot(l, up), 0.03))));
  ok = c.r >= 0.0;
  if (!ok) return 0.0;
  float cum = hL < CS_H1 ? c.g*hL/CS_H1 : (hL < CS_H2 ? mix(c.g, c.b, (hL - CS_H1)/(CS_H2 - CS_H1)) : mix(c.b, c.r, (hL - CS_H2)/(1.0 - CS_H2)));
  return max(c.r - cum, 0.0);
}
// 云内一点的源项（每单位消光的辐亮度）：
//   直射（单次＋三阶多次散射，Wrenninge；三瓣相函数：衍射峰 g＝0.97 给日周几度的亮晕和银边、0.75 前向、−0.25 后向）×塔影（硬边）
//     × e^(−τ_L)：τ_L＝朝日的短样本（这朵云自己）＋云影图里上方的那一截（问题单第 12、13 条：原先取“整柱 τ×(1−hn)”、
//     还取错了柱子，没有自遮挡，向阳面背阴面一样亮）；罪域云盖按 ruiDeckTau×小尺度起伏×上方份额。
//   漫射（双流，ξ＝0.15）：往下的漫射＝Td·(1−e^(−τ_L))，往上的＝R_下·(直射剩余＋往下的漫射)；这一项的塔影用加宽半影
//     （厚云里光要横走几公里，问题单第 5 条：塔影不再在云底切出直边）。云底≈Td·μ0E/π，“灰白天光”靠它。
//   天光（本地天光表＋对面世界的空腔光）按双流透进来；地面反光取探针行 0 朝下的照度，云底多吃。
//   碎雨云（云盖之下）：上面是云盖的漫射、下面是地面，各占半边天（比云盖暗）。夜里直射为 0，只剩对面白昼透过云层的漫射。
//   far＝真：平均场（不取短样本、τ_L 按平均柱估）。
vec3 cloudSrc(vec3 X, float K, float z, float sig, vec3 d, vec4 wx, bool far){
  float zb = cloudBaseAt(X), zt = cloudTopAt(X), H = max(zt - zb, 0.05), dk = ruiDeck(X, wx.r);
  float hn = sat((z - zb)/max(mix(cloudHTop(H, wx), H, dk), 0.05)), hL = sat((z - zb)/H);
  vec3 up = -normalize(X);
  vec3 v = uSunW - X; float d2 = dot(v, v); vec3 l = v*inversesqrt(d2);
  float vis = towerVis(X, uSunW, uSunRho), visS = msVis(X);
  vec3 E0 = visS > 0.0 ? uSunI/d2*sunTrans(X, K, l)*veilT(X, uSunW)*sunSheathT(X) : vec3(0.0);
  vec3 E = E0*vis, Es = E0*visS;
  float c = dot(d, l), mus = dot(l, up), mu = max(mus, 0.05);
  vec3 P = uCM2W*X;
  // 朝日的光学厚度
  float tauL = 0.0, tauB = sig*max(z - zb, 0.0)*0.6;
  if (z < zb){                                                     // 碎雨云：上面整个云盖
    tauL = ruiDeckTau(X)*ruiFine(P)/mu;
  } else {
    float tN = 0.0;
    if (dk < 1.0){
      if (far) tN = cloudColTau(X, wx)*pow(1.0 - hL, 1.5)/mu;
      else {
        float s = 0.12, sEnd = 0.0;
        if (vis > 0.0) for (int j = 0; j < Q_CLOUD_L; j++){ vec3 Y = X + l*s; tN += cloudDens(Y, zOfK(Kof(Y)), wx, 1)*uCloudSigma*s*0.7; sEnd = s; s *= 3.0; }
        bool ok; vec3 Ye = X + l*sEnd;
        float tm = csTauAbove(Ye, l, sat((zOfK(Kof(Ye)) - zb)/H), ok);
        tN += ok ? tm : cloudColTau(X, wx)*pow(1.0 - hL, 1.5)/mu;
        vec3 Yb = X - l*0.5;                                       // 背日一侧还有多少云（向阳面的反射靠它）
        tauB = max(tauB, cloudDens(Yb, zOfK(Kof(Yb)), wx, 1)*uCloudSigma*0.8 + sig*0.1);
      }
    }
    float tD = dk > 0.0 ? ruiDeckTau(X)*ruiFine(P)*(1.0 - hL)/mu : 0.0;
    tauL = mix(tN, tD, dk);
  }
  float ms = 0.0, a = 1.0, b = 1.0, g = 1.0;                      // 三阶多次散射（三瓣 HG）
  for (int o = 0; o < 3; o++){
    float ph = 0.22*phaseHG(c, 0.97*g) + 0.58*phaseHG(c, 0.75*g) + 0.2*phaseHG(c, -0.25*g);
    ms += a*exp(-tauL*b)*ph; a *= 0.55; b *= 0.45; g *= 0.5;
  }
  float xi = 0.15, tauUp = tauL*mu;
  float Td = (2.0 + xi*tauB)/(2.0 + xi*(tauUp + tauB)), Rb = xi*tauB/(2.0 + xi*tauB);
  float eDir = exp(-tauL), fDn = Td*(1.0 - eDir), fUp = Rb*(eDir + fDn);
  vec3 Eun = uSunI/d2*visS*veilT(X, uSunW)*sunSheathT(X);
  vec3 Esky = skyLUT(mus)*Eun + cavityE(X);                       // 云顶受的天光：本地大气＋对面世界
  vec3 Egr = shIrr(-up, 0);                                       // 地面反光（探针行 0 朝下）
  if (z < zb) return 0.65*(Es*(Td*mu/PI) + Esky*(Td*0.75/PI)) + Egr*(0.35/PI);   // 上面是云盖的漫射、下面是地面
  return E*ms + Es*((fDn + fUp)*mu/PI) + Esky*(Td*(1.0 + Rb)*0.75/PI) + Egr*((1.0 - hn)*0.5/PI);
}
vec3 cloudSource(vec3 X, float K, float z, float sig, vec3 d){ return cloudSrc(X, K, z, sig, d, weatherAt(X), false); }

#ifdef HY_AIR
// 近段 pass 的云（near.frag 调；air.glsl 定义 HY_AIR）：[c0, c1] 上云与空气一起积。
//   体积段 [c0, min(c1, Q)]：Q_CLOUD_N 步，从 c0 起按等比加密（云底、近处细，远处粗）；0.5·Q 以内用细节噪声；
//     0.6·Q 到 Q 之间密度从体积云换到平均场（问题单第 10 条：原先在 Q 处一刀切成平板，天上画出一个圆环）。
//   平均场段 (Q, min(c1, CL_FAR_KM)]：CL_FAR_N 步，平均密度＋平均场光照（问题单第 11 条：原先只取 4 个天气图样本、一个平板事件，
//     地平线上一条均匀的米黄带、上沿一级级台阶）。
// 罪域云盖与云缝用同一套密度连续过渡（问题单第 7 条：原先按 step(0.9, 覆盖) 逐像素切换两种算法，晨昏天上一条带锯齿的硬边）。
#define CL_FAR_N 10
#define CL_FAR_KM 2000.0
float clWarp(float u, float k){ return k < 1e-3 ? u : (exp(k*u) - 1.0)/(exp(k) - 1.0); }
void cloudMarch(vec3 d, float cd, float c0, float c1, float jit, inout vec3 S, inout vec3 T, inout float TX){
  float tv = min(c1, Q_CLOUD_KM), tf = min(c1, CL_FAR_KM);
  for (int seg = 0; seg < 2; seg++){
    float a = seg == 0 ? c0 : max(c0, tv), b = seg == 0 ? tv : tf;
    if (b - a <= 1e-4) continue;
    int n = seg == 0 ? Q_CLOUD_N : CL_FAR_N;
    float L = b - a, kp = clamp(log(b/max(a, 0.3)), 0.0, 4.0);
    for (int i = 0; i < n; i++){
      // 亮度已收敛（T＜1%）后不再算光照，但透射 TX 接着积到 1e−6：日面、月面、对面白昼都乘 TX，
      // 原先在 T＜1% 处直接停，TX 卡在 0.003 左右——罪域 τ≈60 的云盖后面还透出日面一点、夜里透出对面世界的白昼
      bool lit = max(T.r, max(T.g, T.b)) >= 0.01;
      if (!lit && TX < 1e-6) break;
      float fn = float(n), t0 = a + L*clWarp(float(i)/fn, kp), t1 = a + L*clWarp(float(i + 1)/fn, kp), t = a + L*clWarp((float(i) + jit)/fn, kp);
      float dt = t1 - t0, K = Kat(t, cd), z = zOfK(K);
      vec3 X = uCamW + d*t;
      vec4 wx = weatherAt(X);
      float fm = sstep(0.6*Q_CLOUD_KM, Q_CLOUD_KM, t), dens = 0.0;
      if (!lit){
        dens = fm < 0.5 ? cloudDens(X, z, wx, 1) : cloudMean(X, z, wx);
        TX *= exp(-(medium(X, z).extX + dens*uCloudSigma)*dt);
        continue;
      }
      Med m = medium(X, z); vec3 ext; vec3 J = airSource(X, K, z, d, m, ext);
      if (fm < 1.0) dens = cloudDens(X, z, wx, t < 0.95*Q_CLOUD_KM ? 0 : 1)*(1.0 - fm);
      if (fm > 0.0) dens += cloudMean(X, z, wx)*mix(1.0, cloudMeanTex(X, t), 1.0 - ruiDeck(X, wx.r))*fm;
      float sig = dens*uCloudSigma;
      if (sig > 0.0) J += sig*cloudSrc(X, K, z, sig, d, wx, fm > 0.5);
      vec3 e3 = ext + vec3(sig), sT = exp(-e3*dt);
      S += T*(J - J*sT)/max(e3, vec3(1e-9));
      T *= sT; TX *= exp(-(m.extX + sig)*dt);
    }
  }
}
#endif

// 探针：从相机朝 d 看过去的云层（问题单第 4 条）。只给漫射：透过云的日光扣掉直射那一份（直射由云影图在地面、眼睛那里单独算），
// 再按覆盖度加权——云只会重新分配光，不会让地面比晴天亮出六成。斜着看时视线穿过好几朵云（有效覆盖 1−(1−f)^n）。
// rgb＝云的辐亮度（已乘有效覆盖），a＝云后面的东西还剩多少。
vec4 cloudSkyProbe(vec3 d){
  if (uCloudOn < 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
  float cd = dot(uCamW, d);
  vec2 sp = cloudSpanCam(d, cd, 3000.0);
  if (sp.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t1 = min(sp.y, sp.x + 400.0), f = 0.0, tc = 0.0, typ = 0.0, hc = 0.0; vec3 Xm = uCamW;
  for (int i = 0; i < 3; i++){
    vec3 X = uCamW + d*mix(sp.x, t1, (float(i) + 0.5)/3.0); vec4 w = weatherAt(X);
    float dk = ruiDeck(X, w.r), H = cloudTopAt(X) - cloudBaseAt(X);
    float fi = mix(sat(w.r*mix(1.0, 0.8, w.g)*1.1), 1.0, dk);
    float ti = mix(cloudColTau(X, w)/max(fi, 0.05), ruiDeckTau(X), dk);
    f += fi/3.0; tc += ti/3.0; typ += w.g/3.0; hc += mix(cloudHTop(H, w), H, dk)/3.0;
    if (i == 0) Xm = X;
  }
  if (f <= 0.005) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 up = uGroundMode == 1 ? vec3(-1.0, 0.0, 0.0) : -normalize(uCamW);
  float mv = max(abs(dot(d, up)), 0.02);
  float nC = 1.0 + hc*sqrt(max(1.0 - mv*mv, 0.0))/mv/mix(10.0, 3.0, typ);
  float fe = 1.0 - pow(1.0 - min(f, 0.999), nC), tp = min(tc/mv, 200.0);
  vec3 upX = -normalize(Xm), v = uSunW - Xm; float d2 = dot(v, v); vec3 l = v*inversesqrt(d2);
  float vis = towerVis(Xm, uSunW, uSunRho), visS = msVis(Xm), mus = dot(l, upX), mu = max(mus, 0.0);
  vec3 E0 = visS > 0.0 ? uSunI/d2*sunTrans(Xm, Kof(Xm), l)*veilT(Xm, uSunW)*sunSheathT(Xm) : vec3(0.0);
  vec3 Esky = skyLUT(mus)*(uSunI/d2*visS*veilT(Xm, uSunW)*sunSheathT(Xm)) + cavityE(Xm);
  float xi = 0.15, Td = 2.0/(2.0 + xi*tc), R = 1.0 - Td;
  vec3 Egr = shIrr(-up, 0);
  vec3 Lb = (max(Td - exp(-tc/max(mu, 0.05)), 0.0)*E0*visS*mu + Td*Esky*0.75 + R*Egr)/PI;   // 从云下看：漫透射（不含直射）＋云底反射的地光
  vec3 La = R*(E0*vis*mu + Esky)/PI;                               // 从云上看：反射
  float below = sat(dot(d, up)*4.0 + 0.5);
  return vec4(fe*mix(La, Lb, below), 1.0 - fe*(1.0 - exp(-tp)));
}

// ======================= 远处 =======================
// 对面世界云的细节（问题单第 6 条）：天气图 23 km 一格，望远看是一片糊的色块。这里给平均 τ 乘上 1–12 km 的云团、云街
// （沿纬线拉长 2.5 倍），按这个像素在那里多大（km）把太细的几层淡掉（不闪）；均值约 1，所以平均光学厚度不变。
float farCloudDetail(vec3 X){
  float fp = length(X - uCamW)*2.0*uTanHalfFov/uRes.y;
  vec3 P = uCM2W*X, Q = vec3(P.x, P.y*2.5, P.z);
  float w1 = 1.0 - sstep(1.5, 6.0, fp/6.0), w2 = 1.0 - sstep(1.5, 6.0, fp/1.5);
  if (w1 <= 0.0) return 1.0;
  vec4 a = textureLod(uNoise3, wq(Q, 48.0), 0.0), b = textureLod(uNoise3, wq(Q, 12.0), 0.0);
  float f = 1.0 + w1*1.6*(0.6*a.b + 0.4*a.r - 0.515) + w2*1.4*(0.6*b.b + 0.4*b.a - 0.403);
  return max(f, 0.0);
}
// 双流平板（远段 pass 画对面世界的云）：光学厚度 τ（再乘上面的细节），返回 rgb＝朝观察者的辐亮度，a＝透射（灰）。
// 云顶受照＝直射＋本地天光＋对面世界的空腔光；从上往下看是反射 R＝ξτ/(2＋ξτ)，从下往上看是漫透射（扣掉直射：直射另算）。
vec4 slabCloud(vec3 X, vec3 d, float tau){
  tau *= farCloudDetail(X);
  if (tau < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 nIn = -normalize(X);
  vec3 l; float vis; vec3 E = sunE(X, Kof(X), l, vis, false);
  float mus = dot(l, nIn), mu = max(mus, 0.0), xi = 0.15;
  float R = xi*tau/(2.0 + xi*tau), Td = 2.0/(2.0 + xi*tau);
  vec3 Eun = uSunI/dot(uSunW - X, uSunW - X)*msVis(X)*veilT(X, uSunW)*sunSheathT(X);
  vec3 Esky = skyLUT(mus)*Eun + cavityE(X), Etop = E*mu + Esky;
  float below = sat(dot(d, nIn)*40.0 + 0.5);                       // 视线从下往上＝看云底（从云下看不到云顶的反射：过渡收窄）
  vec3 Lt = (max(Td - exp(-tau/max(mu, 0.05)), 0.0)*E*mu + Td*Esky)/PI;
  return vec4(mix(R*Etop/PI, Lt, below), exp(-tau));
}
// 远壁、对面世界的地面细节（问题单第 3、6 条；shade_wall 调）：底图 2048×1024 等面积图在塔两端沿经向拉长，赤道附近一格也有
// 十几公里。按三维位置叠各向同性的细节（3–50 km 的明暗、0.75–3 km 的纹理），海岸线按细节噪声重新取阈值（破碎、有港湾），
// 离得越远、像素越大，细的几层淡出。
void worldDetail(vec3 X, inout vec3 alb, inout float water){
  float fp = length(X - uCamW)*2.0*uTanHalfFov/uRes.y;
  float w1 = 1.0 - sstep(2.0, 8.0, fp/12.0), w2 = 1.0 - sstep(2.0, 8.0, fp/3.0), w3 = 1.0 - sstep(2.0, 8.0, fp/0.75);
  if (w1 <= 0.0) return;
  vec3 P = uCM2W*X;
  vec4 a = textureLod(uNoise3, P/48.0, 0.0), b = textureLod(uNoise3, P/12.0, 0.0), c = textureLod(uNoise3D, P/3.0, 0.0);
  float n1 = (a.r - 0.684)/0.092, n2 = (0.5*b.r + 0.5*b.b - 0.544)/0.1, n3 = (c.r - 0.5)/0.15;
  float m = 1.0 + 0.16*w1*n1 + 0.12*w2*n2 + 0.08*w3*n3;
  alb *= clamp(m, 0.4, 1.8);
  if (water > 0.02 && water < 0.98) water = sstep(0.38, 0.62, water + 0.12*(w2*n2 + 0.6*w3*n3));
}
