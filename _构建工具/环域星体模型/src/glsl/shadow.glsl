// 查用（terrain.frag、实例、云下）
float horizonVis(vec2 dc, vec3 X, vec3 l){
  float el = asin(clamp(dot(l, -normalize(vec3(X.x, 0.0, X.z))), -1.0, 1.0));
  float th = uSunRho/length(uSunW - X);
  for (int i = 0; i < 3; i++){
    vec4 L = uHzLvl[i]; vec2 p = (dc - L.xy)/L.z;
    if (L.w > 0.5 && max(abs(p.x), abs(p.y)) < 0.96){
      vec2 hz = textureLod(uHorizon, vec2(p.x*0.5 + 0.5, (p.y*0.5 + 0.5 + float(i))/3.0), 0.0).rg;
      return sat((hz.r + (el - hz.g))/(2.0*th) + 0.5);
    }
  }
  return 1.0;
}

float cloudShadowT(vec2 dc){                                     // 云影图的取样与变形见 common.glsl 的 csFetch（clouds 路）
  if (uCloudOn < 0.5) return 1.0;
  vec4 c = csFetch(dc);
  return c.r < 0.0 ? 1.0 : exp(-c.r);
}
