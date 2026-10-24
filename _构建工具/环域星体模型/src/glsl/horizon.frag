// horizon.frag：拼在 common＋terrain_lib 之后；每级一次，uLvl＝级号（02 第八节第 7 条；负责：F 路）
// 目标 tHorizon 是三级竖拼（宽 n、高 3n，n＝档位的 hzSize：低 128、中 256、高 512）；本 pass 的 uRes＝(n, 3n)，只写第 uLvl 级的视口。
// 级中心与半宽来自 uHzLvl（CPU 排程在 E 路 fp/passes.js：ps.hzDue、ps.HZ_HALF）。r＝沿日光的最小净空角，g＝烘焙时的太阳重力仰角。
// 2026-10：落地（groundPoint 的两次修正）、沿日光 32 步、高档的 8 方向扫描遮蔽都在同一个循环里，altAt 只有一个调用点（编译时间）。
uniform int uLvl;
layout(location = 0) out vec4 oc;
void main(){
  vec4 L = uHzLvl[uLvl];
  float n = uRes.x;
  vec2 p = (gl_FragCoord.xy - vec2(0.0, n*float(uLvl)))/n*2.0 - 1.0;
  vec2 dc = L.xy + p*L.z;
  vec3 dir, vg = chartPoint(dc, dir), X = uCamW + vg, up = vec3(-1.0, 0.0, 0.0), l = vec3(0.0, 1.0, 0.0), e1 = vec3(0.0), e2 = vec3(0.0);
  float s0 = 2.0*L.z/n, s1 = 16.0, r = 1.0, g = 0.0, occ = 0.0, th = 0.0, ao = 1.0;
  bool grounded = false, scan = TER_AO_SCAN != 0 && uLvl == 0;
  gFull = true;                                                    // 落地时读全部细层
  for (int i = -2; i < 64; i++){
    if (i == -1 && grounded) continue;
    if (i == 0){                                                   // 落好地：抬高 0.5 m，取日光方向与扫描用的切向基
      gFull = false;
      X = uCamW + vg;
      up = uGroundMode == 1 ? -normalize(vec3(X.x, 0.0, X.z)) : -normalize(X);
      vg += up*0.0005;
      l = normalize(uSunW - X);
      g = asin(clamp(dot(l, -normalize(vec3(X.x, 0.0, X.z))), -1.0, 1.0));   // 烘焙时的重力仰角
      e1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); e2 = cross(up, e1);
    }
    if (i >= 32 && !scan) break;
    vec3 q; float foot, s = 1.0; int j = 0;
    if (i < 0){ q = vg; foot = 1e-3; }
    else if (i < 32){ s = s0*pow(s1/s0, float(i)/31.0); q = vg + l*s; foot = max(s*0.002, 1e-3); }
    else {
      // 高档第 0 级的 8 方向扫描遮蔽：从这个地面点（已抬高 0.5 m）沿 8 个水平方向各看 4、16、64、256 m 处，
      // 取地形最大仰角 h（tan h＝−离地高度／距离），余弦加权的天空可见度＝1 − 平均 sin²h。与太阳无关，只随相机挪动重烘。JS 镜像 ground.aoScan
      int k = i - 32, di = k/4; j = k - 4*di;
      float an = 0.78539816*float(di);
      s = 0.004*exp2(2.0*float(j));
      q = vg + (cos(an)*e1 + sin(an)*e2)*s; foot = max(s*0.01, 1e-3);
    }
    float a = altAt(q, foot, 0);                                    // 全文件唯一的 altAt 调用点
    if (i < 0){ vg += a*dir; if (uGroundMode == 1 || abs(a) <= 0.05) grounded = true; continue; }
    if (i < 32) r = min(r, a/s);
    else { th = max(th, -a/s); if (j == 3){ occ += th*th/(1.0 + th*th); th = 0.0; } }
  }
#if TER_AO_SCAN
  if (uLvl == 0) ao = 1.0 - occ/8.0;
#endif
  oc = vec4(r, g, ao, 1.0);                                       // b＝扫描遮蔽（只第 0 级、只高档；其余为 1）
}
