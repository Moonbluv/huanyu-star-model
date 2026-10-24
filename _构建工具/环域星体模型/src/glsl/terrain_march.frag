// terrain_march.frag（W×H，RGBA32F；pass terrain_g，fp/instances.js 登记）：地形求交（02 第八节第 5 条；负责：F 路）。
// 2026-10 求交与着色拆成两个 pass：求交（本文件，只拼 common＋terrain_lib）写一张 G 缓冲，着色在 terrain.frag（读 uTerG）。
// 原先两者在一个程序里，ANGLE/fxc 冷编译 10–20 s（求交循环里的 altAt 与着色的数据流交织，优化耗时成倍上涨）；拆开后各 2–3 s、并行编。
// 单循环状态机：步进、割线细化、步数将尽时的跳步、命中点上的最后一次求值都在同一个循环里，altAt 只有一个调用点。
// G 缓冲：r＝命中距离 km（无为 −1）；g＝法线（八面体编码，两个 12 位整数拼成一个浮点）；b＝阶地相位 f；
//   a＝打包的整数（24 位）：相对级号 kk（10 位，+512）、子台阶 gStep+1（3 位）、崖面高度比例 gQ（5 位，0＝不在崖带）、倒石坡位置 gTal（3 位）、台坎 gLedge（3 位）
uniform sampler2D uTerC; uniform float uPixF;
layout(location = 0) out vec4 oc;
#define TER_N (Q_TER_F + 14)
float packN(vec3 n){
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 e = n.y >= 0.0 ? n.xz : (1.0 - abs(n.zx))*vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  vec2 q = floor(clamp(e*0.5 + 0.5, 0.0, 1.0)*4095.0 + 0.5);
  return q.x*4096.0 + q.y;
}
void main(){
  vec3 d = viewRay(gl_FragCoord.xy, uRes, uJitter, 1.0);
  float cd = dot(uCamW, d);
  ivec2 cp = ivec2(gl_FragCoord.xy*0.25); ivec2 cs = textureSize(uTerC, 0);
  float tc = INF; bool anyHit = false;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    float s = texelFetch(uTerC, clamp(cp + ivec2(i, j), ivec2(0), cs - 1), 0).x;
    if (s >= 0.0){ tc = min(tc, s); anyHit = true; }
  }
  if (!anyHit){ oc = vec4(-1.0, 0.0, 0.0, 0.0); return; }
  float tMax = min(min(Q_TER_FAR_KM, iTower(uCamW, d)), tTerFar(cd));   // 远界不用 tWallCam（相机可能在内壁球面之外，见 terrain_lib 的 tTerFar）
  float t = max(0.0, 0.9*tc - min(0.01, 0.15*tc));             // 02 原式减 10 m：近处像素一律从 0 起步，白耗步数
  vec3 nUp = uGroundMode == 1 ? vec3(-1.0, 0.0, 0.0) : -normalize(uCamW);
  float sinT = dot(d, nUp), cosT = sqrt(max(1.0 - sinT*sinT, 0.0));
  // 状态：ph 0 步进、1 割线细化、2 在命中点上求一次（置着色缓存）
  int ph = 0, nRef = 0, nJump = 0;
  float tPrev = t, aPrev = 1.0, dtSafe = 0.0, tLo = 0.0, aLo = 0.0, tHi = 0.0, aHi = 0.0, hit = -1.0;
  bool relaxed = false, hasPrev = false;
  for (int i = 0; i < TER_N; i++){
    float foot = max(t*uPixF, 2e-4);
    int lod = (ph == 2 || t < Q_TER_KM) ? 0 : 1;
    float a = altAt(d*t, foot, lod);                              // 全文件唯一的 altAt 调用点
    if (ph == 2) break;                                           // 命中点的缓存已置好
    bool last = i >= TER_N - 2;
    if (ph == 1){                                                 // 割线细化（台阶处收敛慢：插值点夹在 15%–85%）
      if (a < 0.0){ tHi = t; aHi = a; } else { tLo = t; aLo = a; }
      nRef++;
      if (nRef >= 6 || tHi - tLo < 0.25*foot || last){ hit = tLo; ph = 2; t = hit; continue; }
      t = tLo + (tHi - tLo)*clamp(aLo/max(aLo - aHi, 1e-9), 0.15, 0.85);
      continue;
    }
    if (!hasPrev && a < 0.0){ t *= 0.5; continue; }               // 起点启发式失手（落在地下）：退半步
    if (relaxed && (a < 0.0 || !relaxOK(t - tPrev, dtSafe, a, sinT, cosT, lod))){   // 松弛步盖不住：退回安全步
      t = tPrev + dtSafe; relaxed = false; continue;
    }
    if (a < 0.0){                                                 // 跨过地面：进割线细化
      tLo = tPrev; aLo = aPrev; tHi = t; aHi = a; nRef = 0;
      if (last){ hit = tLo; ph = 2; t = hit; continue; }
      ph = 1; t = tLo + (tHi - tLo)*clamp(aLo/max(aLo - aHi, 1e-9), 0.1, 0.9);
      continue;
    }
    if (a < 0.4*foot){ hit = t; if (lod == 0) break; ph = 2; continue; }   // 离地不到半个像素足迹：就是这里
    if (last){ if (a < 3.0*foot) hit = t; break; }                // 用完了：贴地掠射（3 个足迹内）按命中，否则不中
    float dt = coneStep(a, sinT, cosT, lod);
    bool canRelax = true;
    float du = 0.0;
    if (uGroundMode == 1 && lod == 0){ du = duDt(d*t, d); float zs = zoneStep(gU, du, a, sinT, cosT); if (zs < dt){ dt = zs; canRelax = false; } }
    float ts = trenchStep(uCamW.y + d.y*t, d.y, a); if (ts < dt){ dt = ts; canRelax = false; }
    dt = max(dt, 3e-4 + foot*0.8); if (lod == 1) dt *= 2.0;
    // 步数将尽（两次机会）：跳到候选点里最近的一个。候选：粗级确认的命中（.y＝0；保守下界 .y＝1 只在视线不离开宏观地面时信）、
    // 相对宏观地面（球面＋深渊沟）的下降、阶地的“落到本级踏面”（相对重力往下）与“到下一级崖带中间”（往塔根走时）
    if (nJump < 2 && i >= Q_TER_F - 2 + 6*nJump){
      nJump++;
      vec3 X = uCamW + d*t;
      bool rising = dot(d, macroUp(X)) > 0.02;
      float tj = INF;
      for (int jj = -1; jj <= 1; jj++) for (int ii = -1; ii <= 1; ii++){
        vec4 s4 = texelFetch(uTerC, clamp(cp + ivec2(ii, jj), ivec2(0), cs - 1), 0);
        if (s4.x > t + dt && (s4.y < 0.5 || !rising)) tj = min(tj, s4.x);
      }
      float sd = -dot(d, macroUp(X));
      if (sd > 0.02) tj = min(tj, t + a/sd);
      if (uGroundMode == 1){
        if (d.x > 0.02) tj = min(tj, t + a/d.x);                 // 重力“上”＝(−1, 0, 0)
        if (du > 1e-4) tj = min(tj, t + (1.0 - gU + 0.5*uCliffC)/du);
      }
      tj = min(tj, tMax);
      if (tj < INF*0.5 && tj > t + dt){ tPrev = t; aPrev = a; hasPrev = true; dtSafe = tj - t; relaxed = false; t = tj; continue; }
    }
    tPrev = t; aPrev = a; hasPrev = true; dtSafe = dt; relaxed = canRelax;
    t += relaxed ? TER_RELAX*dt : dt;
    if (t > tMax) break;
  }
  if (hit < 0.0){ oc = vec4(-1.0, 0.0, 0.0, 0.0); return; }
  vec3 n = terrainNormal(d*hit, max(hit*uPixF, 2e-4)*3.0);          // 法线用 3 倍足迹预过滤（细层的折线不在中景闪）
  float kk = clamp(gK + 512.0, 0.0, 1023.0);                       // 相对级号（相机级号在着色 pass 里按同式重算）
  float st = clamp(gStep + 1.0, 0.0, 4.0), q = gQ < 0.0 ? 0.0 : 1.0 + floor(sat(gQ)*30.0 + 0.5);
  float tl = floor(sat(gTal)*7.0 + 0.5), ld = floor(sat(gLedge)*7.0 + 0.5);
  oc = vec4(hit, packN(n), gU, (((kk*8.0 + st)*32.0 + q)*8.0 + tl)*8.0 + ld);
}
