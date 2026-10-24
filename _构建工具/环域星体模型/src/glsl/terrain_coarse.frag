// terrain_coarse.frag（W/4×H/4，RGBA32F）：x＝保守起点 t（无地形则 −1），y＝1 表示 x 只是步数用尽时的保守下界、不是确认的命中
// （02 第八节第 5 条；负责：F 路。远界用 terrain_lib 的 tTerFar：相机可能在内壁球面之外）
// 粗足迹包络求交：减去“在这个足迹下已淡出、但全分辨率仍在”的细层幅度（envMargin），求到的交点是保守的。
// 步进＝振幅感知锥形步（coneStep）× 过松弛（relaxOK 校验，跨不过就退回安全步）；阶地模式另按分区截步（zoneStep：崖带、倒石坡，不松弛），
// 深渊沟壁一带按 trenchStep 截步。循环里只有一处 altAt（ANGLE 把每个调用点各内联一份）。
uniform float uPixC, uPixF;                                 // 粗、精像素的张角（rad）
layout(location = 0) out vec4 oc;
void main(){
  vec3 d = viewRay(gl_FragCoord.xy, uRes, uJitter, 0.25);
  float cd = dot(uCamW, d);
  float tMax = min(min(Q_TER_FAR_KM, iTower(uCamW, d)), tTerFar(cd));   // 远界不用 tWallCam（相机可能在内壁球面之外，见 terrain_lib 的 tTerFar）
  vec3 nUp = uGroundMode == 1 ? vec3(-1.0, 0.0, 0.0) : -normalize(uCamW);
  float sinT = dot(d, nUp), cosT = sqrt(max(1.0 - sinT*sinT, 0.0));
  float t = 0.0, res = -1.0, tPrev = 0.0, dtSafe = 0.0; bool relaxed = false, done = false;
  for (int i = 0; i < Q_TER_C; i++){
    vec3 v = d*t; float footC = max(t*uPixC, 2e-4);
    int lod = t < Q_TER_KM ? 0 : 1;
    float a = altAt(v, footC, lod) - envMargin(footC, max(t*uPixF, 2e-4));
    if (relaxed && (a < 0.0 || !relaxOK(t - tPrev, dtSafe, a, sinT, cosT, lod))){   // 松弛步可能跨过了地面：退回安全步
      t = tPrev + dtSafe; relaxed = false; continue;
    }
    if (a < 0.0){ if (t > 0.0){ res = 0.97*t; done = true; break; } a = 0.0; }   // 起点（相机）不算命中，按最小步长离开
    float zr = zOfK(Kat(t, cd));                              // 离壁高度
    if (zr > uClearMax && dot(d, -normalize(uCamW + v)) > 0.02){ done = true; break; }
    float dt = coneStep(a, sinT, cosT, lod);                   // 振幅感知的锥形步（terrain_lib.glsl）
    bool canRelax = true;
    if (uGroundMode == 1 && lod == 0){ float zs = zoneStep(gU, duDt(v, d), a, sinT, cosT); if (zs < dt){ dt = zs; canRelax = false; } }
    float ts = trenchStep(uCamW.y + v.y, d.y, a); if (ts < dt){ dt = ts; canRelax = false; }
    dt = max(dt, 3e-4 + footC*0.8);
    if (lod == 1) dt *= 2.0;
    tPrev = t; dtSafe = dt; relaxed = canRelax;
    t += relaxed ? TER_RELAX*dt : dt;
    if (t > tMax){ done = true; break; }
  }
  if (!done) res = 0.97*min(relaxed ? tPrev + dtSafe : t, tMax);   // 步数用尽：保守地当作命中（最后一步若是松弛步，只信安全步）
  oc = vec4(res, done ? 0.0 : 1.0, 0.0, 1.0);                     // y＝1：步数用尽的保守下界（不是确认的命中；精级据此区分）
}
