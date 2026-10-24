// composite.frag（FAR_SCALE 与 far.frag 一致，由 defines 注入）
#ifndef FAR_SCALE
#define FAR_SCALE 0.5
#endif
uniform sampler2D uSurf, uNear, uFar, uExpTex;
uniform vec2 uNearRes, uFarRes;
layout(location = 0) out vec4 oc;
// 深度感知上采样：低分辨率纹素的“终点键”取它那条视线对应的全分辨率表面距离（无表面为 −1）。
// 低分辨率 pass 每帧按本 pass 的整个纹素抖动（sky 修订：原先只抖全分辨率的 ±1/2 像素×倍数，即本纹素的 ±1/8，
// TAA 抹不平低分辨率的边，地平线云带上缘成了 4 像素一级的台阶）：纹素 q 的视线在本 pass 的 q＋½＋J 处，
// 合成时本像素的视线在全分辨率的 fc＋J 处，所以双线性的位置是 (fc＋J)·s − J − ½。
ivec2 surfAt(vec2 q, float s){ return clamp(ivec2((q + 0.5 + uJitter)/s), ivec2(0), textureSize(uSurf, 0) - 1); }
vec4 upNear(vec2 fc, float key){
  vec2 p = fc*NEAR_SCALE - uJitter*(1.0 - NEAR_SCALE) - 0.5; ivec2 i0 = ivec2(floor(p)); vec2 f = p - floor(p);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int k = 0; k < 4; k++){
    ivec2 o = ivec2(k & 1, k >> 1), q = clamp(i0 + o, ivec2(0), ivec2(uNearRes) - 1);
    float kq = texelFetch(uSurf, surfAt(vec2(q), NEAR_SCALE), 0).a;
    float sim = (key < 0.0) == (kq < 0.0) ? exp(-abs(kq - key)/(0.1*abs(key) + 0.05)) : 1e-3;
    float w = mix(1.0 - f.x, f.x, float(o.x))*mix(1.0 - f.y, f.y, float(o.y))*sim + 1e-6;
    acc += w*texelFetch(uNear, q, 0); ws += w;
  }
  return acc/ws;
}
vec3 upFar(vec2 fc, float key){
  vec2 p = fc*FAR_SCALE - uJitter*(1.0 - FAR_SCALE) - 0.5; ivec2 i0 = ivec2(floor(p)); vec2 f = p - floor(p);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int k = 0; k < 4; k++){
    ivec2 o = ivec2(k & 1, k >> 1), q = clamp(i0 + o, ivec2(0), ivec2(uFarRes) - 1);
    vec4 v = texelFetch(uFar, q, 0);
    float sim = v.a < 0.0 ? 1e-3 : exp(-abs(v.a - key)/(0.02*key + 1.0));
    float w = mix(1.0 - f.x, f.x, float(o.x))*mix(1.0 - f.y, f.y, float(o.y))*sim + 1e-6;
    acc += w*v.rgb; ws += w;
  }
  return acc/ws;
}
// 地形漏洞补洞（整合验收加）：视线朝内壁（cd＞0，远段不管这类视线）却没有表面命中，只能是地形求交漏掉了
// （阶沿上一两像素宽的缝，原先合成成一条黑线）。取上下左右 4 像素内最近的表面像素顶上；找不到才照旧。
const ivec2 HOLE_DIR[8] = ivec2[8](ivec2(0, 1), ivec2(0, -1), ivec2(1, 0), ivec2(-1, 0), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
vec4 holeFill(ivec2 p){
  ivec2 sz = textureSize(uSurf, 0);
  for (int r = 1; r <= 4; r++){
    for (int k = 0; k < 8; k++){
      vec4 s = texelFetch(uSurf, clamp(p + HOLE_DIR[k]*r, ivec2(0), sz - 1), 0);
      if (s.a > 0.0) return s;
    }
  }
  return vec4(0.0, 0.0, 0.0, -1.0);
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec4 surf = texelFetch(uSurf, ivec2(fc), 0);
  vec3 d = viewRay(fc, uRes, uJitter, 1.0);
  float cd = dot(uCamW, d), al = alphaOf(uCamK, cd);
  if (surf.a <= 0.0 && cd > 0.0) surf = holeFill(ivec2(fc));
  float tW = tWallCam(cd), tT = iTower(uCamW, d);
  bool onSurf = surf.a > 0.0;
  float tEnd = onSurf ? surf.a : min(tW, tT);
  vec4 sg = segments(cd, tEnd); float e = sg.x;
  if (onSurf) e = tEnd;                                              // 与 near.frag 同一口径：有表面就积到表面（掠射弦过了中点才落地）
  vec4 nv = upNear(fc, onSurf ? surf.a : -1.0);
  vec3 Le;
  if (onSurf) Le = surf.rgb;
  else if (tT <= e + 1e-3) Le = shadeTower(uCamW + d*tT);           // 离塔根很近时，塔在近段里
  else {
    vec3 acc = vec3(0.0);
    for (int s = 0; s < 4; s++){                                     // 4 子样：日、月、真空里的塔
      vec2 jo = (vec2(float(s & 1), float(s >> 1)) - 0.5)*0.5;
      vec3 ds = viewRay(fc + jo, uRes, uJitter, 1.0);
      float cds = dot(uCamW, ds), tWs = tWallCam(cds);
      vec4 sgs = segments(cds, tWs);
      float tTs = iTower(uCamW, ds);
      // 远段的深度键逐子样取（sky 修订）：原先整个像素用中心视线的键，塔脚从真空进到对面大气的那一圈（塔面与真空核壳的交线）上，
      // 塔脚在对面大气里的子样拿到的是“塔后面的内壁”（远段在塔在真空里的纹素上画的是它），成了一道断断续续的亮弧
      float keyS = (tTs > sgs.y && tTs < tWs) ? tTs : tWs;
      if (tTs >= sgs.y) tTs = INF;                                    // 塔面在对面大气里：远段已画
      vec2 hs = iSphere(uCamW - uSunW, ds, uSunRho), hm = iSphere(uCamW - uMoonW, ds, uMoonRho);
      float tS = (hs.x < hs.y && hs.x > 0.0) ? hs.x : INF, tM = (hm.x < hm.y && hm.x > 0.0) ? hm.x : INF;
      // 夜幕：视线在夜幕球（离壁 Zv 以上）里的那一段；掠射弦（不进真空核）也照算（第 8 条，sky 修订）
      float tO = min(tS, min(tM, tTs)), Vo = veilViewT(cds, tO);
      // 塔缘气层（设定）：视线擦过塔身时穿过的那一薄层——身后的东西被吃掉蓝光（日面逐像素变黄→橙→红），
      // 这一层自己被日光照着、朝人前向散射，在塔的轮廓上镶一道亮边（只在日照得到的那一侧，即日出日落时日边的塔缘）
      vec3 shT = vec3(1.0), glow = vec3(0.0);
      if (uSheath.x > 0.0){
        float tE = min(tO, tWs); bool blk;
        float tau = sheathTau(uCamW, ds, tE, blk);
        if (tau > 1e-4){
          shT = exp(-tau*SHEATH_C);
          glow = sheathGlow(uCamW, ds, tE, tau);                         // 沿气柱四段取样（sky 二修，见 common.glsl）
        }
      }
      if (tO >= INF*0.5) acc += veilViewT(cds, INF)*(upFar(fc + jo, keyS)*shT + glow);
      else if (tO == tS){ float mu = max(dot(normalize(uCamW + ds*tS - uSunW), -ds), 0.0); acc += Vo*(sunDisk(mu)*shT + glow); }
      else if (tO == tM) acc += Vo*(shadeMoon(uCamW + ds*tM, ds)*shT + glow);
      else acc += Vo*(shadeTower(uCamW + ds*tTs)*shT + glow);
    }
    Le = acc*0.25;
  }
  vec3 L = nv.rgb + nv.a*transCam(al, cd, e)*Le;
  float expo = texelFetch(uExpTex, ivec2(0), 0).x;
  oc = vec4(min(L*expo, vec3(6.0e4)), min(onSurf ? surf.a : tEnd, 6.0e4));   // a＝视线距离（TAA 重投影用）
}
