// cloud_shadow.frag：云影图（256²，低档 128²，每 csEvery 帧一次），拼在 common＋shadow＋clouds＋terrain_lib 之后（02 第十节第 4 条）。负责：clouds 路。
// 每个纹素＝相机周围的一块地面（common 的 csWarp：中心一格约 0.2 km、边上约 7 km）；沿日光穿过云层（clouds 的 cloudSpanAt：
// 阶地模式近处的云层按重力找平）积 τ，与近段 pass 同一个密度（相机附近 20 km 内带细节）——看得见日面时，地面、眼睛也在阳光里：
//   r＝整柱 τ（cloudShadowT 取 exp(−τ)）；g、b＝从地面到云层相对高度 CS_H1、CS_H2 处的累计 τ（cloudSrc 的自遮挡：这一点上方还剩多少）；
//   a＝落到这块地面的雨量（1≈中雨）：头顶云底以上 1 km 里有云、且天气图说有降水才下——阵雨落在云下，罪域云盖下处处下，云缝里不下。
// 罪域厚云盖与别的云同一个密度一起步进（不再另加一份 τ，近段看到的与地上的影子是同一层云）。
// 样本位置固定（不逐帧抖动）：云影与云的受光逐帧稳定，不闪。夜里也照算（日在塔后时日光方向仍有定义）。
layout(location = 0) out vec4 oc;
void main(){
  vec2 u = gl_FragCoord.xy/uRes*2.0 - 1.0, dc = uCsInfo.xy + csUnwarp(u)*uCsInfo.z;   // uRes＝本图边长（低档 128，其余 256）
  vec3 G = uCamW + groundPoint(dc), l = normalize(uSunW - G);
  int lod = dot(dc, dc) < 400.0 ? 0 : 1;
  float tau = 0.0, cg = 0.0, cb = 0.0;
  vec2 sp = cloudSpanAt(G, l, 400.0);
  if (sp.x >= 0.0){
    float dt = (sp.y - sp.x)/16.0;
    for (int i = 0; i < 16; i++){
      vec3 Y = G + l*(sp.x + (float(i) + 0.5)*dt); float z = zOfK(Kof(Y)); vec4 w = weatherAt(Y);
      float s = cloudDens(Y, z, w, lod)*uCloudSigma*dt;
      if (s <= 0.0) continue;
      float zb = cloudBaseAt(Y), hL = (z - zb)/max(cloudTopAt(Y) - zb, 0.05);
      tau += s; cg += hL < CS_H1 ? s : 0.0; cb += hL < CS_H2 ? s : 0.0;
    }
  }
  // 雨量：沿“上”找到头顶的云层，在云底以上 0.15、0.5、1 km 取密度
  float rain = 0.0;
  vec3 up = uGroundMode == 1 ? -vec3(G.x, 0.0, G.z)/max(length(G.xz), 1.0) : -normalize(G);
  vec2 su = cloudSpanAt(G, up, 30.0);
  if (su.x >= 0.0){
    vec3 Yb = G + up*(su.x + scudDepth(G)); vec4 w = weatherAt(Yb);
    if (w.a > 0.01){
      float dn = 0.0;
      for (int j = 0; j < 3; j++){ vec3 Y = Yb + up*(0.15 + 0.85*float(j*j)/4.0); dn += cloudDens(Y, zOfK(Kof(Y)), w, 1)/3.0; }
      float nr = textureLod(uNoise3, wq(uCM2W*Yb, 24.0), 0.0).r;           // 雨带：时大时小
      rain = w.a*sstep(0.04, 0.4, dn)*mix(1.0, 1.6, w.g)*(0.4 + 1.8*sat((nr - 0.5)/0.35));
    }
  }
  oc = vec4(tau, cg, cb, rain);
}
