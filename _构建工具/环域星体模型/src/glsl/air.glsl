// air.glsl：近段、远段、探针共用（拼在 common 之后）
#define HY_AIR 1                                                   // clouds.glsl 的 cloudMarch 要 airSource：只在拼了 air 的 pass 里编（云影图不拼 air）
uniform vec3 uMoonE0; uniform float uMoonD2;   // 相机处大气外、未被塔挡的月光照度（klux）；相机到月心距离²
// 1 − u(1 − e^−k) 写成 (1 − u) + u·e^−k（代数相同）：原式在 k≳17 时 1 − e^−k 在 float32 里舍成 1，u＝1 的最后一步
// 得 −log(0)＝∞，t1＝∞、dt＝∞，局地介质为 0 时 TX *= exp(−0·∞)＝NaN（整合验收：低档云天整片发白）
float warpU(float u, float k){ return abs(k) < 1e-3 ? u : -log((1.0 - u) + u*exp(-k))/k; }
vec3 uMoonE_air(vec3 X){ vec3 v = uMoonW - X; return uMoonE0*(uMoonD2/dot(v, v))*towerVis(X, uMoonW, uMoonRho)*veilT(X, uMoonW); }
// 单个空气样本的源项 J（每单位长度、每单位立体角的辐亮度增量）与消光
vec3 airSource(vec3 X, float K, float z, vec3 d, Med m, out vec3 ext){
  ext = m.ext;
  vec3 l; float vis; vec3 E = sunE(X, K, l, vis, Q_ECL_AIR == 1);    // sunE 已乘塔缘气层（sky 修订：并进 common）
  float c = dot(d, l), mus = dot(-normalize(X), l);
  // 云底以下的空气：直射与多次散射乘云影（02 第十节第 4 条只在高档做；罪域厚云盖下各档都要，否则雨雾被日光照亮）
  float csT = 1.0, under = 0.0;
  if (uCloudOn > 0.5 && z < cloudBaseAt(X) + 0.3){ csT = cloudShadowT(chartD(X - uCamW)); under = ruiUnder(X, z); }
  vec3 J = E*csT*(m.sR*phaseR(c) + m.sM*phaseCS(c, uMieG) + m.sY*phaseHG(c, 0.6));
  vec3 Eun = uSunI/dot(uSunW - X, uSunW - X)*veilT(X, uSunW)*sunSheathT(X);   // 未遮挡日照（多次散射用；照进这片天的日光同样擦过塔缘）
  vec3 ss = m.sR + m.sM + vec3(m.sY);
  J += ss*msLUT(z, mus)*Eun*msVis(X)*csT;                             // 多次散射：加宽半影
  if (under > 0.0) J += ss*(under*ruiTd()/PI)*E*max(mus, 0.0);        // 厚云盖底的漫射（日光部分，各向同性）
  // clouds 路（2026-10-14）：别处的云下空气在云影里时，多次散射表（晴空）照不到它，雨雾、余息、酸霾只吸光不发亮，
  // 阴天下雨时满天灰得发黑（伊美忒正午 25.8 → 5.3 klux）。按相机处的天光（探针行 0）补上漫射：雨滴、灰粒的散射偏前向，
  // 视线方向前方那片天（shIrr(d)/π，云底或地平线）占六成，全天平均占四成
  if (csT < 1.0) J += ss*mix(shAvg(0), shIrr(d, 0)/PI, 0.6)*((1.0 - csT)*(1.0 - under));
  J += ss*cavityL()*cavityDim(X, z);                                  // 空腔：对面世界的光，昼夜都在（评审 2·3）；罪域云盖下只剩漫射
  if (uMoonAir > 0.5){                                                // 月光（开暗幕时才有存在感）
    vec3 lm = normalize(uMoonW - X); float cm = dot(d, lm);
    J += uMoonE_air(X)*sunTrans(X, K, lm)*(m.sR*phaseR(cm) + m.sM*phaseCS(cm, uMieG));
  }
  return J;
}
// 在 [ta, tb] 上积分；toEnd＝真时样本向 tb 加密；kz＝两端离壁高度差 / 标高
void airMarch(vec3 d, float cd, float ta, float tb, float k, bool toEnd, int n, float jit,
              inout vec3 S, inout vec3 T, inout float TX){
  float len = tb - ta; if (len <= 1e-6 || n <= 0) return;
  k = clamp(k, 0.0, 30.0); n = min(n, 48);
  for (int i = 0; i < n; i++){                                       // 上界在运行时才知道：编译器不展开（ANGLE/D3D 编译量）
    float u0 = float(i)/float(n), u1 = float(i + 1)/float(n), um = (float(i) + jit)/float(n);
    float t0, t1, tm;
    if (!toEnd){ t0 = ta + len*warpU(u0, k); t1 = ta + len*warpU(u1, k); tm = ta + len*warpU(um, k); }
    else { t0 = tb - len*warpU(1.0 - u0, k); t1 = tb - len*warpU(1.0 - u1, k); tm = tb - len*warpU(1.0 - um, k); }
    float dt = abs(t1 - t0), K = Kat(tm, cd), z = zOfK(K);
    vec3 X = uCamW + d*tm;
    Med m = medium(X, z); vec3 ext; vec3 J = airSource(X, K, z, d, m, ext);
    vec3 sT = exp(-ext*dt);
    S += T*(J - J*sT)/max(ext, vec3(1e-9));
    T *= sT; TX *= exp(-m.extX*dt);
  }
}
// 在积分途中插入一个“事件”（平板云）：rgb＝朝相机的辐亮度，a＝灰透射
void applyEvent(vec4 ev, inout vec3 S, inout vec3 T, inout float TX){ S += T*ev.rgb; T *= ev.a; TX *= ev.a; }
