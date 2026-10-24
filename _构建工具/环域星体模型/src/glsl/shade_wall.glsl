// shade_wall.glsl：拼在 common 之后（远段 pass、探针）
vec3 shadeWall(vec3 X, vec3 d){
  float rX = length(X.xz);
  vec3 nS = -X/length(X), upG = -vec3(X.x, 0.0, X.z)/max(rX, 1e-3);
  vec4 wm = texture(uWorld, eqArea(X));
  vec3 alb = wm.rgb; float water = wm.a;
  worldDetail(X, alb, water);                                    // clouds 路：底图在塔两端沿经向拉长、一格十几公里，叠各向同性的细节（望远可见）
  float K = 0.0;
  vec3 l; float vis; vec3 E = sunE(X, K, l, vis, true);
  float muS = max(dot(l, nS), 0.0), cosI = muS;
  if (uGroundMode == 1 && abs(X.y) > 1.0){
    vec3 nR = vec3(0.0, -sign(X.y), 0.0);                      // 崖面朝赤道
    float W = uW, H = uW*abs(X.y)/max(rX, 1.0);
    float wt = W*max(dot(-d, upG), 0.0), wr = H*max(dot(-d, nR), 0.0);
    float tread = max(dot(upG, l), 0.0), riser = max(dot(nR, l), 0.0);
    float shadowFrac = sat(H*max(dot(l, -nR), 0.0)/(W*max(tread, 1e-3)));   // 评审 2·5
    cosI = (wt*tread*(1.0 - shadowFrac) + wr*riser)/max(wt + wr, 1e-6);
  }
  float cov = 0.0;
  if (uCloudOn > 0.5){                                         // 云影：沿日光挪到云层中高度
    float zc = 0.5*(uCloudBase + uCloudTop);
    vec3 off = (l - nS*dot(l, nS))*(zc/max(dot(l, nS), 0.15));
    cov = weatherAt(X + off).r;                                  // clouds 路：经 weatherAt（极冠改用三维噪声，不成放射条纹）
  }
  // 本地天光同样是穿过夜幕来的日光（原先漏乘 veilT：对岸内壁的天光直接吃到补偿后的日光，夜幕越强越亮）
  vec3 Esky = skyLUT(dot(l, nS))*uSunI/dot(uSunW - X, uSunW - X)*msVis(X)*veilT(X, uSunW)*sunSheathT(X);
  vec3 L = alb/PI*(E*cosI*(1.0 - 0.85*cov) + Esky + cavityE(X));
  if (water > 0.0){ vec3 h = normalize(l - d); L += water*E*muS*(188.0/(8.0*PI))*pow(max(dot(nS, h), 0.0), 180.0)*0.025; }
  float abyss = 1.0 - sstep(uAbyssHalf*0.6, uAbyssHalf, abs(X.y));
  return L*(1.0 - 0.97*abyss*step(0.001, uAbyssDepth));
}
