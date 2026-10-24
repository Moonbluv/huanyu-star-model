/* HY.fp.cam —— 双精度相机（两种地面模式）、图表坐标与原点 uOrg[k]、朝向基、上一帧量、步行与碰撞、朝向快捷
 * 规格：spec/02 第三、五节，第八节第 3–4 条（阶地几何），第十四节第 1 条（上一帧量），第十七节第 1 条（眼睛与身体）。
 * 负责：G 路（第一人称·天体与相机）。
 * 节点可测（test/chart_slide.js、fp_cam_check.js）：compute() 返回 UNIFORMS 里写入方为 'cam' 的普通数值对象，
 *   由 fp.js 用 HY.fp.apply(U, vals, 'cam') 写入。不碰 DOM、不碰 THREE。
 *
 * 坐标（02 第三节）：CM 系＝地固系绕塔轴转 −φ_C，相机在 (ρ_C, y_C, 0)；上 U＝(−1,0,0)（指向塔轴），北 N＝(0,−1,0)（朝塔根），
 *   东 E＝(0,0,−1)。φ 增大＝往西。相机内部一律双精度，进 uniform 前 fround；uCamK、uCamZ、uRsC 用舍入后的值推（02 第五节）。
 * 地面（统筹修订）：默认阶地（踏面宽 W 固定，崖高＝W·tan 纬度），可切“顺着球面的斜坡”；纬度＜2° 自动按斜坡算
 *   （K.groundMode；uGroundMode 要跟 cam.mode() 走，E 路 settings 已按 cam.mode() 写）。
 * 图表坐标（02 第三节第 4 条）：阶地 c＝(−R_ref·φ, −y)；斜坡 c＝(−R_ref·φ, −R·ψ)。R_ref＝瞬移处的离轴距离（取 float32 可表示的值），
 *   行走中不变。地面的锚（uOrg、uTerF0、uStrataC、uPrevPos）用双精度的真实相机，不用 fround 后的 uCamW（见 compute 前的说明）。
 * 地面的细节层（第 0–6 层噪声）由 F 路的 HY.fp.ground.foot(org, amp, mode) → [d_f, w, b, P] 给（foot.frag 的 JS 镜像）；
 *   没有时按 0 处理（裸球面上的阶地，几何仍然自洽）。求交器参数 uAmpZone/uLip/uClearMax/uHc 取 HY.fp.ground.limits(info)。
 *
 * 另外在本文件：HY.fp.api（HY.app 的第一人称取数接口；03 第十四节第 3 条）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  fp.cam = fp.cam || {};
  var K = fp.cam;
  var PI = Math.PI, TAU = 2 * PI, D2R = PI / 180, R2D = 180 / PI, fr = Math.fround;

  /* ───────── 常量（02 第十七节第 1 条） ───────── */
  K.SPEED = { walk: 1.4, run: 4.5, ride: 12 };       // m/s
  K.BOB = { hz: 1.8, amp: 0.015 };                    // 头部起伏：步频 Hz、幅度 m
  // 碰撞（02 第五节、第十七节第 1 条）：阶地前方 1 m 内高差超过 0.6 m（崖）就停步——只看阶地本身（踏面＋崖），
  //   细层起伏（第 3–5 层，6–200 m 尺度、米级）不算崖，否则一成以上的地面都迈不开步；
  //   斜坡模式没有崖，坡度超过 35° 减速，局部起伏陡过 60°（1 m 内 1.73 m）才当崖停步。两种模式都按坡度减速
  K.CLIFF = { probe: 1, stop: 0.6, steep: 1.73 };
  K.SLOPE_SLOW = 35;                                  // 坡度超过 35° 减速，每多 30° 慢到 0，最慢两成
  K.LAT_TERRACE_MIN = 2;                              // 纬度小于 2° 自动退回斜坡
  K.LAT_HYST = 0.02;                                  // 步行时从斜坡换回阶地的回差（度，约 2 km）
  K.TELE_FOV = 5;                                     // 望远（T）
  K.GAZE = 0.5;                                       // 凝视：视角在默认与 1/2 之间
  K.TILE = 32;
  K.STRATA = 0.045;                                   // 岩层厚度 km（uStrataC＝fract(ρ_C/0.045)）
  var DEF_GROUND = { mode: 'terrace', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 1, abyssDepth: 30, abyssHalf: 220 };
  var DEF_ZONES = { gLight: 0.75, gHeavy: 1.2, limboKm: 333 };
  var ZONE_AMP = { light: 1.6, plain: 0.7, heavy: 1.0, rui: 1.25, limbo: 0.4 };
  function layL() { return (fp.ground && fp.ground.LAY_L) || [60.0, 6.0, 1.1, 0.2, 0.035, 0.006, 15.0]; }
  function layA() { return (fp.ground && fp.ground.LAY_A) || [1.2, 0.32, 0.085, 0.018, 0.0032, 0.0007, 0.0]; }

  // 朝向快捷：北·塔根／东／南·塔顶／西／天顶／看太阳／看月亮（键位只在第一人称里生效，见 fp/controls.js）
  K.LOOK_PRESETS = [
    { id: 'north', label: '北·塔根', key: '3', note: '朝北，抬头看塔根那一端' },
    { id: 'east', label: '东', key: '4', note: '朝东平视' },
    { id: 'south', label: '南·塔顶', key: '5', note: '朝南，看塔顶那一端' },
    { id: 'west', label: '西', key: '6', note: '朝西平视' },
    { id: 'zenith', label: '天顶', key: '7', note: '抬头看正上方' },
    { id: 'sun', label: '看太阳', key: '8', note: '转向太阳' },
    { id: 'moon', label: '看月亮', key: '9', note: '转向月亮' }
  ];

  /* ───────── 小工具 ───────── */
  function frac(x) { return x - Math.floor(x); }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { var u = (x - a) / (b - a); u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }
  function wrapPi(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; a -= PI; return a === -PI ? PI : a; }
  function wrapDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }
  function ground(fps) { var g = fps && fps.ground; return g || DEF_GROUND; }
  function isStub(mod, name) { return !mod || typeof mod[name] !== 'function' || !!(mod.__stubs && mod.__stubs.indexOf(name) >= 0); }

  /* ───────── 静态函数（settings、HUD、测试共用） ───────── */
  // 实际使用的地面模式：1 阶地，0 斜坡。state 里选了斜坡，或纬度 < 2°（赤道一带阶地自然消失），都按斜坡
  K.groundMode = function (P, s, modeStr) {
    if (modeStr === 'slope') return 0;
    var lat = 90 - (s / P.R) * R2D;
    return Math.abs(lat) < K.LAT_TERRACE_MIN ? 0 : 1;
  };
  // 坡度 β（度）→ 步速系数：超过 35° 减速，每多 30° 慢到 0，最慢两成
  K.slowdown = function (beta) { return beta > K.SLOPE_SLOW ? Math.max(0.2, 1 - (beta - K.SLOPE_SLOW) / 30) : 1; };
  // 第 k 层的图表原点 uOrg[k]＝fract(Rot_k·c/(L_k·32))（双精度，02 第三节第 4 条）。c＝[东, 北] km
  K.origins = function (c, out) {
    var L = layL(); out = out || [];
    for (var k = 0; k < 7; k++) {
      var an = 1.31 * k, cs = Math.cos(an), sn = Math.sin(an), s = 1 / (L[k] * K.TILE);
      var o = out[k] || (out[k] = [0, 0]);
      o[0] = frac((cs * c[0] - sn * c[1]) * s);
      o[1] = frac((sn * c[0] + cs * c[1]) * s);
    }
    return out;
  };
  // 深渊沟（与 common.glsl 的 trench 同式）：地面在赤道一带往外（往下）退 abyssDepth
  K.trench = function (y, gs) { var g = fp.ground; if (g && typeof g.trench === 'function') return g.trench(y, gs.abyssDepth, gs.abyssHalf); return gs.abyssDepth * (1 - sstep(gs.abyssHalf * 0.55, gs.abyssHalf, Math.abs(y))); };   // F 路 2026-10：沟壁改陡，以 fp/ground.js 为准
  // 阶地台阶函数 S(g)（terrain_lib.glsl 的 Sg）
  K.Sg = function (g, gs) { return gs.resid * g + (1 - gs.resid) * sstep(1 - gs.cliff, 1, g); };

  // 脚下各层的取值 [d_f, w, b, P]（foot.frag 的 JS 镜像，F 路提供）；没有时全 0
  var FOOT0 = [0, 0, 0, 0];
  function groundFoot(org, amp, mode, out) {
    out = out || [0, 0, 0, 0];
    var g = fp.ground;
    if (!isStub(g, 'foot')) {
      var r = g.foot(org, amp, mode, out);                 // 第四个参数：写进 out（每帧要调十几次，不另分配）
      if (r && r.length >= 4 && isFinite(r[0]) && isFinite(r[3])) { out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; out[3] = r[3]; return out; }
    }
    out[0] = FOOT0[0]; out[1] = FOOT0[1]; out[2] = FOOT0[2]; out[3] = FOOT0[3];
    return out;
  }

  // 求交器参数（02 第八节第 4 条）。F 路的 ground.limits 是正式实现；它还是桩时走这里的过渡版（同式）
  function limitsFallback(info) {
    var A = layA(), L = layL(), zw = info.zoneW, gs = info.ground;
    var a0 = zw[0] * ZONE_AMP.light + zw[1] * ZONE_AMP.plain + zw[2] * ZONE_AMP.heavy;
    a0 = a0 * (1 - info.ruiW) + ZONE_AMP.rui * info.ruiW;
    a0 = a0 * (1 - info.limboW) + ZONE_AMP.limbo * info.limboW;
    var amp = a0 * (gs.amp == null ? 1 : gs.amp), lip = 0, sumA = 0;
    for (var k = 0; k < 6; k++) { lip += 3 * A[k] / L[k]; sumA += A[k]; }
    return {
      uAmpZone: amp,
      uLip: 1.2 * lip * amp + 0.05,
      uClearMax: sumA * amp + (info.mode === 1 ? info.Hc * 1.2 : 0) + 0.02,
      uHc: info.Hc
    };
  }
  function limitsOf(info) {
    var g = fp.ground, lim = null;
    if (!isStub(g, 'limits')) { try { lim = g.limits(info); } catch (e) { lim = null; } }
    if (!lim || !isFinite(lim.uAmpZone) || !isFinite(lim.uLip) || !isFinite(lim.uClearMax) || !isFinite(lim.uHc)) lim = limitsFallback(info);
    return lim;
  }

  K.isPreset = function (name) {
    for (var i = 0; i < K.LOOK_PRESETS.length; i++) if (K.LOOK_PRESETS[i].id === name) return true;
    return false;
  };
  // 朝向快捷的目标角度：O＝观察者（HY.astro.site 的形状，或 cam.observer()）。返回 {yaw, pitch}；yaw 为 null 表示保持
  K.presetAngles = function (name, O, t, P) {
    var A = HY.astro, tv, lk;
    if (!O && (name === 'north' || name === 'south' || name === 'sun' || name === 'moon')) return null;   // 这四个要观察者
    switch (name) {
      case 'north': tv = A.towerView(O, P); return { yaw: 0, pitch: clamp(tv.rootEl, -89, 89) };
      case 'south': tv = A.towerView(O, P); return { yaw: 180, pitch: clamp(tv.topEl, -89, 89) };
      case 'east': return { yaw: 90, pitch: 0 };
      case 'west': return { yaw: -90, pitch: 0 };
      case 'zenith': return { yaw: null, pitch: 89 };
      case 'sun': lk = A.look(O, A.sunPos(t, P), P); return { yaw: wrapDeg(lk.az), pitch: clamp(lk.el, -89, 89) };
      case 'moon': lk = A.look(O, A.moonPos(t, P), P); return { yaw: wrapDeg(lk.az), pitch: clamp(lk.el, -89, 89) };
      default: return null;
    }
  };

  // 朝向基（CM 系）：fwd＝cosp·(cosy·N＋siny·E)＋sinp·U；right＝normalize(fwd×U)；up＝right×fwd（02 第五节）
  K.basis = function (yawDeg, pitchDeg, out) {
    out = out || { fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
    var y = yawDeg * D2R, p = clamp(pitchDeg, -89.9, 89.9) * D2R;
    var cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    // N＝(0,−1,0)，E＝(0,0,−1)，U＝(−1,0,0)
    var f = out.fwd; f[0] = -sp; f[1] = -cp * cy; f[2] = -cp * sy;
    // fwd × U，U＝(−1,0,0)：(f1·0 − f2·0, f2·(−1) − f0·0, f0·0 − f1·(−1)) ＝ (0, −f2, f1)
    var rx = 0, ry = -f[2], rz = f[1], rl = Math.sqrt(ry * ry + rz * rz) || 1;
    var r = out.right; r[0] = rx / rl; r[1] = ry / rl; r[2] = rz / rl;
    var u = out.up;    // right × fwd
    u[0] = r[1] * f[2] - r[2] * f[1]; u[1] = r[2] * f[0] - r[0] * f[2]; u[2] = r[0] * f[1] - r[1] * f[0];
    return out;
  };

  /* ───────── 相机对象 ─────────
   * K.create(P, site, fpState, opts) → cam
   *   P＝HY.model.P；site＝{s, az}（HY.state.site）；fpState＝HY.state.fp（传 HY.state.fp 时一律现读，状态变了自动跟上）；
   *   opts.zones＝分域参数（省略取 HY.state.zones）。
   * cam.teleport(s, az)            瞬移：重定 R_ref 与图表原点；阶地模式落在最近的踏面上（02 第十七节第 3 条）
   * cam.step(dt, input) → {moved, dist}   dt 真实秒；input＝HY.fp.ctl.input()；dist km（本步实际走过的）
   * cam.setLook(yaw, pitch, fov)   立即设朝向（null＝不变）；fov 是基准竖直视角（凝视、望远在它之上）
   * cam.lookAt(yaw, pitch, dur)    平滑转过去（默认 0.6 s）；用户转头时打断
   * cam.lookPreset(name, t)        朝向快捷（K.LOOK_PRESETS 的 id），按此刻位置立即算角度
   * cam.requestPreset(name, dur)   同上，但留到下一次 step() 开头再算（同一时刻排下的瞬移先生效）；cam.pending()、cam.cancelPreset()
   * cam.look() → {yaw, pitch, fov, fovEff}   fov＝基准（写回 fp.fov 用这个），fovEff＝此刻实际
   * cam.compute() → 'cam' 写入方的全部 uniform（每帧调一次：它同时把“本帧”记成下一帧的“上一帧”）
   * cam.toSite() → {s, az}；cam.alt() → 眼离地 km；cam.posW() → 地固 [x,y,z]；cam.observer() → HY.astro 观察者
   * cam.lam() → φ_C（给 HY.fp.cel.compute 的 camLam）；cam.chart() → 图表坐标 [东, 北] km
   * cam.info() → 诊断（模式、相位、级、纬度、R_ref…）；cam.mode() → 1 阶地 / 0 斜坡；cam.setParams(P)；cam.params()；cam.dispose()
   * cam.nudge(dN, dE)              不查碰撞地平移（测试、调试）
   * fpState 就是 HY.state.fp 时，HY.model.P 换了会自动 setParams（R、a 变了原地重新瞬移，否则原地不动、R_ref 不变）；
   * 地面参数变了会自动重新贴地。
   */
  K.current = null;
  K.create = function (P, site, fpState, opts) {
    opts = opts || {};
    var live = !fpState || (HY.state && fpState === HY.state.fp);
    var fps0 = fpState || { eye: 1.6, yaw: 0, pitch: 15, fov: 55, bob: true, ground: DEF_GROUND };
    function fps() { return (live && HY.state && HY.state.fp) || fps0; }
    function zones() { return opts.zones || (HY.state && HY.state.zones) || DEF_ZONES; }

    var st = {
      P: P, mode: 1, psi: 0, y: 0, phi: 0, Rref: 1,
      yaw: fps0.yaw || 0, pitch: fps0.pitch == null ? 15 : fps0.pitch, fovBase: fps0.fov || 55,
      gaze: 0, gazeT: 0, tele: 0, teleT: 0, anim: null,
      bobPh: 0, bobA: 0, moving: false, free: false,
      // 派生量（place() 更新）
      rho: 0, xC: 0, yC: 0, f: 0.5, k: 0, rad: 0, amp: 1, lim: null, info: null,
      prev: null
    };
    var ORG = [], ORG2 = [], CH = [0, 0], FOOT = [0, 0, 0, 0], E1 = {}, E2 = {}, BAS = K.basis(0, 0), BASP = K.basis(0, 0);
    var OUT = {
      uCamW: [0, 0, 0], uCamK: 0, uCamZ: 0, uCamRho: 0,
      uCamFwd: [0, 0, 0], uCamRight: [0, 0, 0], uCamUp: [0, 0, 0], uTanHalfFov: 0.5,
      uLamCam: 0, uOrg: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], uRref: 1, uTerF0: 0, uRsC: 0, uCamAlt: 0,
      uHc: 0, uLip: 0, uClearMax: 0, uAmpZone: 1,
      uPrevPos: [0, 0, 0], uPrevBasisT: [1, 0, 0, 0, 1, 0, 0, 0, 1], uCM2W: [1, 0, 0, 0, 1, 0, 0, 0, 1], uStrataC: 0
    };

    function eyeKm() {
      var e = fps().eye; e = (e == null ? 1.6 : e) / 1000;
      if (fps().bob !== false && st.bobA > 0) e += K.BOB.amp / 1000 * st.bobA * Math.sin(st.bobPh);
      return e;
    }
    function psiMin() { var P = st.P; return Math.asin(Math.min(1, (P.a + 1) / P.R)); }

    // 罪域中心（地固单位向量），按 P 缓存
    var ruiP = null, ruiC = [0, -1, 0];
    function ruiCenter(P) {
      if (P !== ruiP) { ruiP = P; ruiC = fp.cel && fp.cel.ruiCenter ? fp.cel.ruiCenter(P) : [0, -1, 0]; }
      return ruiC;
    }
    // 相机所在处的分域信息（给 ground.limits；只看裸球面位置，不看噪声）
    function siteInfo(psi, phi) {
      var P = st.P, Z = zones(), gs = ground(fps());
      var y = -P.R * Math.cos(psi), rs = P.R * Math.sin(psi), g = P.gEq * Math.sin(psi);
      var wl = 1 - sstep(Z.gLight - 0.04, Z.gLight + 0.04, g), wh = sstep(Z.gHeavy - 0.04, Z.gHeavy + 0.04, g);
      var rc = ruiCenter(P);
      var dir = [Math.sin(psi) * Math.cos(phi), -Math.cos(psi), Math.sin(psi) * Math.sin(phi)];
      var rr = (fp.cel && fp.cel.RUI_RAD) || 900, cr = dir[0] * rc[0] + dir[1] * rc[1] + dir[2] * rc[2];
      var zone = HY.world && HY.world.zoneOf ? HY.world.zoneOf(P.R * psi, P, Z) : null;
      return {
        P: P, Z: Z, ground: gs, mode: st.mode, s: P.R * psi, az: wrapDeg(phi * R2D), psi: psi, phi: phi,
        lat: 90 - psi * R2D, y: y, rho: rs, rhoS: rs, g: g, zone: zone,
        zoneW: [wl, Math.max(0, 1 - wl - wh), wh], ruiW: sstep(Math.cos(rr / P.R), Math.cos(0.75 * rr / P.R), cr),
        limboW: 1 - sstep(Z.limboKm * 0.8, Z.limboKm, Math.abs(y)),
        W: gs.W, Hc: gs.W * Math.abs(y) / Math.max(rs, 1e-6), amp: gs.amp == null ? 1 : gs.amp
      };
    }

    // 阶地：给 (y, φ) 求地面离轴半径 r_g（含深渊沟）与相位（02 第八节第 3 条）
    function evalTerrace(y, phi, out) {
      var P = st.P, R = P.R, gs = ground(fps());
      K.origins([-st.Rref * phi, -y], ORG2);
      groundFoot(ORG2, st.amp, 1, FOOT);
      var rs = Math.sqrt(Math.max(R * R - y * y, 0)), rraw = rs - FOOT[3];
      var Yraw = Math.sqrt(Math.max(R * R - rraw * rraw, 0));
      var u = Yraw / gs.W - gs.wig * FOOT[1] - gs.jit * FOOT[2], k = Math.floor(u), f = u - k;
      var gr = fp.ground, Yq = gr && typeof gr.terraceYq === 'function' ? gr.terraceYq(u, ORG2, y, gs, st.amp, R) : gs.W * (k + 1 - K.Sg(1 - f, gs));   // F 路 2026-10：逐级随机的阶地剖面在 fp/ground.js
      var rq = Math.sqrt(Math.max(R * R - Yq * Yq, 0));
      out.rq0 = rq + K.trench(y, gs);              // 阶地本身（踏面＋崖），不含细层起伏
      out.rg = out.rq0 - FOOT[0];
      out.f = f; out.k = k; out.u = u; out.Yraw = Yraw; out.rs = rs;
      return out;
    }
    // 斜坡：给 (ψ, φ) 求脚点离球心距离（含深渊沟与位移）
    function evalSlope(psi, phi, out) {
      var P = st.P, R = P.R, gs = ground(fps()), y = -R * Math.cos(psi);
      K.origins([-st.Rref * phi, -R * psi], ORG2);
      groundFoot(ORG2, st.amp, 0, FOOT);
      out.D = FOOT[3] + FOOT[0];
      out.rad = R + K.trench(y, gs) - out.D;
      out.f = 0; out.k = 0;
      return out;
    }

    // 按当前模式算派生量：分域、求交器参数、相机双精度位置。
    // 阶地上行走从不进崖带（tryMove 拦着），所以这里若发现相位落在崖带里，一定是参数变了（踏面宽、崖带、起伏倍率、分域、
    // 地面模式、星体参数），就地挪到最近的踏面（“相机重新贴地”，spec/03 第七节第 5 条）
    function place() {
      var P = st.P, gs = ground(fps()), m = K.groundMode(P, P.R * st.psi, gs.mode);
      // 自动退回的斜坡要走出 2° 再多 K.LAT_HYST 才换回阶地：换回时贴踏面会把人往赤道挪几十米，
      // 没有这一段回差，就在 2° 线上一帧阶地一帧斜坡地来回跳（眼高差几十米）
      if (m === 1 && st.mode === 0 && Math.abs(90 - st.psi * R2D) < K.LAT_TERRACE_MIN + K.LAT_HYST) m = 0;
      if (m !== st.mode) {
        st.mode = m;
        st.y = -P.R * Math.cos(st.psi);
      }
      var info = siteInfo(st.psi, st.phi);
      info.mode = st.mode;
      st.info = info;
      st.lim = limitsOf(info);
      st.amp = st.lim.uAmpZone;
      var eye = eyeKm();
      if (st.mode === 1) {
        evalTerrace(st.y, st.phi, E1);
        if (E1.f < gs.cliff && !st.free) { snapTread(); evalTerrace(st.y, st.phi, E1); }
        st.f = E1.f; st.k = E1.k; st.tread = E1.rq0;
        st.rho = E1.rg;
        st.xC = E1.rg - eye; st.yC = st.y;
      } else {
        evalSlope(st.psi, st.phi, E1);
        st.f = 0; st.k = 0; st.rad = E1.rad;
        st.rho = E1.rad * Math.sin(st.psi);
        st.xC = E1.rad * Math.sin(st.psi) - eye; st.yC = -E1.rad * Math.cos(st.psi);
      }
    }

    // 阶地相位落在崖带里（f < cliff）时挪到最近的踏面：近崖沿就上崖沿，否则下到崖脚
    function snapTread() {
      var P = st.P, gs = ground(fps());
      for (var it = 0; it < 6; it++) {
        evalTerrace(st.y, st.phi, E2);
        if (E2.f >= gs.cliff + 5e-4 && E2.f <= 1 - 5e-4) break;
        var target = E2.f >= 1 - 5e-4 ? 1 - 2e-3 : E2.f > gs.cliff / 2 ? gs.cliff + 2e-3 : -2e-3;
        var dYraw = (target - E2.f) * gs.W;
        // Y_raw 随 |y| 近似一比一（裸球面上 Y＝|y|）；按局部斜率修正
        var ay = Math.abs(st.y), slope = ay > 1 ? (E2.rs / Math.max(E2.Yraw, 1)) * (ay / Math.max(E2.rs, 1)) * ((E2.rs - FOOT[3]) / Math.max(E2.rs, 1)) : 1;
        var ny = Math.max(0, ay + dYraw / Math.max(slope, 0.2));
        st.y = (st.y < 0 ? -1 : 1) * Math.min(ny, Math.sqrt(P.R * P.R - Math.pow(P.a + 1, 2)));
      }
      st.psi = Math.acos(clamp(-st.y / P.R, -1, 1));
    }

    var cam = {};
    cam.teleport = function (s, az) {
      var P = st.P, pm = psiMin();
      // 给了非数（坏状态、半截的 {s} 对象）：那一项留在原处；刚建相机时没有“原处”，取罪域
      if (!fin(s)) s = st.info ? P.R * st.psi : 6670;
      if (!fin(az)) az = st.info ? st.phi * R2D : -4;
      st.psi = clamp(s / P.R, pm, PI - pm);
      st.phi = az * D2R;
      st.y = -P.R * Math.cos(st.psi);
      st.Rref = fr(Math.max(P.R * Math.sin(st.psi), 1));     // 取 float32 能精确表示的值：CPU 原点与 GPU 差分用同一个 R_ref
      st.mode = K.groundMode(P, P.R * st.psi, ground(fps()).mode);
      var info = siteInfo(st.psi, st.phi); info.mode = st.mode;
      st.lim = limitsOf(info); st.amp = st.lim.uAmpZone;
      if (st.mode === 1) snapTread();
      st.prev = null; st.moving = false; st.free = false;
      place();
      return cam.toSite();
    };
    // 换星体参数。球半径 R 与塔半径 a 没变（只改了定标、月面反照率、日月轨道等天体量）：原地不动、R_ref 不变，
    // 否则走了一段之后改个月面反照率，图表东向比例一换，脚下的碎石草木整片换了样；分域按新 P 重算，必要时贴回踏面。
    // R 或 a 变了：原地重新瞬移（02 附录 B；地点按离塔根距离与方位保留）
    cam.setParams = function (P) {
      var old = st.P;
      if (old && P && P.R === old.R && P.a === old.a) {
        st.P = P;
        place();
        return cam.toSite();
      }
      var q = cam.toSite();
      st.P = P;
      return cam.teleport(q.s, q.az);
    };
    // 跟着 HY.model.P 走（只在 fpState 就是 HY.state.fp 时）：改星体参数后按 setParams 的规矩跟上
    function syncP() {
      var P = live && HY.model && HY.model.P;
      if (P && P !== st.P && isFinite(P.R)) cam.setParams(P);
    }
    cam.params = function () { return st.P; };
    cam.setLook = function (yaw, pitch, fov) {
      if (yaw != null && isFinite(yaw)) st.yaw = wrapDeg(+yaw);
      if (pitch != null && isFinite(pitch)) st.pitch = clamp(+pitch, -89, 89);
      if (fov != null && isFinite(fov)) st.fovBase = clamp(+fov, 5, 100);
      st.anim = null;
    };
    cam.lookAt = function (yaw, pitch, dur) {
      // null 或非数＝那一项不变（与 setLook 同一口径）
      var y1 = yaw != null && isFinite(yaw) ? wrapDeg(+yaw) : st.yaw, p1 = pitch != null && isFinite(pitch) ? clamp(+pitch, -89, 89) : st.pitch;
      var dy = wrapDeg(y1 - st.yaw);
      dur = dur == null ? 0.6 : dur;
      if (!(dur > 0)) { cam.setLook(y1, p1); return; }
      st.anim = { y0: st.yaw, dy: dy, p0: st.pitch, p1: p1, t: 0, dur: dur };
    };
    cam.lookPreset = function (name, t, dur) {
      var a = K.presetAngles(name, cam.observer(), t == null ? (HY.state ? HY.state.time.t : 0) : t, st.P);
      if (!a) return null;
      cam.lookAt(a.yaw, a.pitch, dur);
      return { yaw: a.yaw == null ? st.yaw : a.yaw, pitch: a.pitch };
    };
    // 朝向快捷，留到下一次 step() 开头再算（那时 fp.js 已处理完同一时刻排下的瞬移、改参数，时间也取那时的 HY.state.time.t）。
    // HY.fp.api.lookPreset 在第一人称里走这条：HY.app.setSite(…) 紧接着 look('sun') 时，按新地点转，不按旧地点。
    // dur＝0：一步到位；省略：平滑 0.6 s。返回是否认得这个名字
    cam.requestPreset = function (name, dur) {
      if (!K.isPreset(name)) return false;
      st.pend = { name: name, dur: dur };
      return true;
    };
    cam.pending = function () { return st.pend ? st.pend.name : null; };
    cam.cancelPreset = function () { st.pend = null; };
    cam.look = function () {
      var fg = st.fovBase * (1 - K.GAZE * st.gaze);
      var fe = Math.exp(Math.log(fg) * (1 - st.tele) + Math.log(K.TELE_FOV) * st.tele);
      return { yaw: st.yaw, pitch: st.pitch, fov: st.fovBase, fovEff: Math.min(fg, fe) };
    };
    cam.mode = function () { return st.mode; };

    // 走一步：dN、dE 为水平北、东向位移（km）。阶地：崖面不能站、前方 1 m 阶地高差超过 0.6 m 停步；
    // 斜坡：前方 1 m 位移层高差超过 1.73 m（陡过 60°）停步。不动就返回 false
    function tryMove(dN, dE) {
      var P = st.P, R = P.R, L = Math.sqrt(dN * dN + dE * dE);
      if (!(L > 0)) return false;
      var pN = dN / L * K.CLIFF.probe / 1000, pE = dE / L * K.CLIFF.probe / 1000, stop = K.CLIFF.stop / 1000;
      if (st.mode === 1) {
        var gs = ground(fps()), rho = Math.max(st.xC, 1);
        var y1 = st.y - dN, phi1 = st.phi - dE / rho, yMax = Math.sqrt(R * R - Math.pow(P.a + 1, 2));
        if (Math.abs(y1) > yMax) return false;
        evalTerrace(y1, phi1, E1);
        if (E1.f < gs.cliff) return false;                         // 崖面不能站（退回上一步）
        var r1 = E1.rq0;
        evalTerrace(y1 - pN, phi1 - pE / rho, E2);
        if (Math.abs(E2.rq0 - r1) > stop) return false;            // 前方 1 m 是崖（只看阶地本身）
        st.y = y1; st.phi = phi1; st.psi = Math.acos(clamp(-y1 / R, -1, 1));
        return true;
      }
      var pm = psiMin(), sp = Math.max(Math.sin(st.psi), 1e-6);
      var psi1 = st.psi - dN / R, phi2 = st.phi - dE / (R * sp);
      if (psi1 < pm || psi1 > PI - pm) return false;
      evalSlope(psi1, phi2, E1);
      var D1 = E1.D;
      evalSlope(psi1 - pN / R, phi2 - pE / (R * sp), E2);
      if (Math.abs(E2.D - D1) > K.CLIFF.steep / 1000) return false;   // 陡过 60° 的起伏当崖
      st.psi = psi1; st.phi = phi2; st.y = -R * Math.cos(psi1);
      return true;
    }
    // 被挡时贴着崖线（或陡坡的等高线）滑：去掉位移里朝着障碍的法向分量。正对着崖推就不动，斜着推就沿崖走。
    // 法向＝挡路那个量的梯度：阶地是相位 u（崖带是 u 的一段），斜坡是位移 D。返回实际走的距离（km）
    function slide(dN, dE, d) {
      var h = 0.001, gN, gE, R = st.P.R;
      if (st.mode === 1) {
        var rho = Math.max(st.xC, 1);
        evalTerrace(st.y, st.phi, E1); var u0 = E1.u;
        evalTerrace(st.y - h, st.phi, E2); gN = (E2.u - u0) / h;
        evalTerrace(st.y, st.phi - h / rho, E2); gE = (E2.u - u0) / h;
      } else {
        var sp = Math.max(Math.sin(st.psi), 1e-6);
        evalSlope(st.psi, st.phi, E1); var D0 = E1.D;
        evalSlope(st.psi - h / R, st.phi, E2); gN = (E2.D - D0) / h;
        evalSlope(st.psi, st.phi - h / (R * sp), E2); gE = (E2.D - D0) / h;
      }
      var gl = Math.sqrt(gN * gN + gE * gE);
      if (gl > 0) {
        var nN = gN / gl, nE = gE / gl, dot = dN * nN + dE * nE, sN = dN - dot * nN, sE = dE - dot * nE, sl = Math.sqrt(sN * sN + sE * sE);
        if (sl > 0.05 * d && tryMove(sN, sE)) return sl;
      }
      if (Math.abs(dE) > 0.05 * d && tryMove(0, dE)) return Math.abs(dE);          // 退而求其次：只走东西或只走南北
      if (Math.abs(dN) > 0.05 * d && tryMove(dN, 0)) return Math.abs(dN);
      return 0;
    }
    // 沿行进方向（单位向量 nN、nE）的坡度（度，相对重力水平），量 2 m。
    // 阶地：踏面水平，坡度全来自细层起伏（快到崖边时也会变陡）；斜坡：宏观坡＝纬度沿行进方向的分量，加位移层的局部坡
    function slopeAlong(nN, nE) {
      var h = 0.002;
      if (st.mode === 1) {
        var rho = Math.max(st.xC, 1);
        evalTerrace(st.y, st.phi, E1); var r0 = E1.rg;
        evalTerrace(st.y - nN * h, st.phi - nE * h / rho, E2);
        return Math.atan(Math.abs(E2.rg - r0) / h) * R2D;
      }
      var lat = Math.abs(90 - st.psi * R2D) * D2R, tq = Math.tan(lat) * nN;
      var R = st.P.R, sp = Math.max(Math.sin(st.psi), 1e-6);
      evalSlope(st.psi, st.phi, E1); var D0 = E1.D;
      evalSlope(st.psi - nN * h / R, st.phi - nE * h / (R * sp), E2);
      return Math.atan(Math.abs(tq + (E2.D - D0) / h)) * R2D;
    }
    // 不查碰撞地平移（km；北、东）：测试与调试用（chart_slide 要走满 1 km，不能被崖挡住）。R_ref 不变；
    // 之后可以停在崖带里（不自动贴回踏面），直到下一次 step／teleport
    cam.nudge = function (dN, dE) {
      var P = st.P, R = P.R;
      st.free = true;
      if (st.mode === 1) {
        st.y -= dN || 0; st.phi -= (dE || 0) / Math.max(st.xC, 1);
        st.psi = Math.acos(clamp(-st.y / R, -1, 1));
      } else {
        st.psi -= (dN || 0) / R; st.phi -= (dE || 0) / (R * Math.max(Math.sin(st.psi), 1e-6));
        st.y = -R * Math.cos(st.psi);
      }
      place();
      return cam.toSite();
    };

    cam.step = function (dt, input) {
      st.free = false;
      syncP();
      dt = clamp(dt || 0, 0, 0.1);
      var inp = input || {}, moved = false, dist = 0;
      // 排着的朝向快捷（cam.requestPreset）：此刻的位置、此刻的时间
      if (st.pend) {
        var pq = st.pend; st.pend = null;
        var pa = K.presetAngles(pq.name, cam.observer(), HY.state && HY.state.time ? HY.state.time.t : 0, st.P);
        if (pa) cam.lookAt(pa.yaw, pa.pitch, pq.dur);
      }
      // 转头：用户输入打断平滑转向（非数当 0：一项坏了不能把朝向变成 NaN）
      var dYaw = fin(inp.dYaw) ? inp.dYaw : 0, dPitch = fin(inp.dPitch) ? inp.dPitch : 0, zoom = fin(inp.zoom) ? inp.zoom : 0;
      if (dYaw || dPitch) {
        st.anim = null;
        st.yaw = wrapDeg(st.yaw + dYaw);
        st.pitch = clamp(st.pitch + dPitch, -89, 89);
      }
      if (st.anim) {
        var a = st.anim; a.t += dt;
        var u = a.dur > 0 ? Math.min(1, a.t / a.dur) : 1, e = u * u * (3 - 2 * u);
        st.yaw = wrapDeg(a.y0 + a.dy * e); st.pitch = a.p0 + (a.p1 - a.p0) * e;
        if (u >= 1) st.anim = null;
      }
      // 凝视、望远
      if (zoom) st.gazeT = clamp(st.gazeT + zoom * 0.25, 0, 1);
      if (inp.tele != null) st.teleT = inp.tele ? 1 : 0;
      st.gaze += (st.gazeT - st.gaze) * (1 - Math.exp(-dt / 0.12));
      st.tele += (st.teleT - st.tele) * (1 - Math.exp(-dt / 0.15));
      if (Math.abs(st.gaze - st.gazeT) < 1e-4) st.gaze = st.gazeT;
      if (Math.abs(st.tele - st.teleT) < 1e-4) st.tele = st.teleT;
      // 行走
      var f = clamp(inp.fwd || 0, -1, 1), r = clamp(inp.right || 0, -1, 1), m = Math.sqrt(f * f + r * r);
      if (m > 1) { f /= m; r /= m; m = 1; }
      if (m > 1e-3 && dt > 0) {
        var yw = st.yaw * D2R, cy = Math.cos(yw), sy = Math.sin(yw);
        var nN = cy * f - sy * r, nE = sy * f + cy * r, nl = Math.sqrt(nN * nN + nE * nE) || 1;
        var v = inp.ride ? K.SPEED.ride : inp.run ? K.SPEED.run : K.SPEED.walk;
        st.slope = slopeAlong(nN / nl, nE / nl);
        v *= K.slowdown(st.slope);
        var d = v * dt / 1000 * Math.min(m, 1), dN = nN / nl * d, dE = nE / nl * d;
        if (tryMove(dN, dE)) { moved = true; dist = d; }
        else dist = slide(dN, dE, d), moved = dist > 0;
      }
      // 头部起伏
      st.moving = moved;
      if (moved) { st.bobPh += dt * TAU * K.BOB.hz; st.bobA += (1 - st.bobA) * (1 - Math.exp(-dt / 0.2)); }
      else { st.bobA *= Math.exp(-dt / 0.25); if (st.bobA < 1e-3) st.bobA = 0; }
      place();
      return { moved: moved, dist: dist };
    };

    /* 每帧 uniform。精度口径（02 第三、五节，外加一条）：
     *   · 球、塔、大气这些“大几何”用 float32 的相机 C_f（uCamW、uCamK、uCamZ、uCamRho、uRsC），K 由 C_f 双精度算；
     *   · 地面的“锚”——图表原点 uOrg、阶地相位 uTerF0、层理 uStrataC、上一帧位移 uPrevPos——用双精度的真实相机 C。
     * GPU 上近处地形只用相对相机的小量（v、Δρ、ΔY…），C_f 只出现在比值里，所以画面跟着 C 连续地走；
     * 若锚也用 C_f，人每走过 float32 的一格（罪域 y 约 0.24 m、ρ 约 0.49 m）整片地面就跳一下，步行时一秒跳五六次。
     * 代价是 GPU 世界坐标里地面与球面差 C−C_f（≤0.25 m，只影响几百公里尺度的量，看不出来）。
     * 实例格网、地平线角图的级中心等一切“相机在图表上的位置”一律用 cam.chart()（与 uOrg 同一个锚，不要自己 fround）。
     */
    cam.compute = function () {
      syncP();
      place();
      var P = st.P, R = P.R, o = OUT;
      var x = fr(st.xC), y = fr(st.yC);
      o.uCamW[0] = x; o.uCamW[1] = y; o.uCamW[2] = 0;
      var Kc = x * x + y * y - R * R;
      o.uCamK = Kc; o.uCamZ = -Kc / (R + Math.sqrt(Math.max(R * R + Kc, 0)));
      o.uCamRho = x; o.uRsC = Math.sqrt(Math.max(R * R - y * y, 0));
      var eye = eyeKm();
      o.uCamAlt = st.mode === 1 ? eye : eye * Math.sin(st.psi);
      o.uLamCam = wrapPi(st.phi);
      o.uRref = st.Rref;
      // 图表原点：真实相机的图表坐标（02 第三节第 4 条；见上方精度口径）
      K.origins(cam.chart(CH), ORG);
      for (var k = 0; k < 7; k++) { o.uOrg[k][0] = fr(ORG[k][0]); o.uOrg[k][1] = fr(ORG[k][1]); }
      o.uTerF0 = st.mode === 1 ? st.f : 0;
      o.uHc = st.lim.uHc; o.uLip = st.lim.uLip; o.uClearMax = st.lim.uClearMax; o.uAmpZone = st.lim.uAmpZone;
      // 朝向
      var lk = cam.look();
      K.basis(st.yaw, st.pitch, BAS);
      for (var i = 0; i < 3; i++) { o.uCamFwd[i] = BAS.fwd[i]; o.uCamRight[i] = BAS.right[i]; o.uCamUp[i] = BAS.up[i]; }
      o.uTanHalfFov = Math.tan(lk.fovEff * D2R / 2);
      // CM → 地固；层理
      if (fp.cel && fp.cel.cm2w) fp.cel.cm2w(st.phi, o.uCM2W);
      o.uStrataC = frac(st.xC / K.STRATA);
      // 上一帧量：上一帧的真实相机与基向量，转到本帧 CM 系；位置写成相对本帧相机
      var pv = st.prev;
      if (!pv) pv = st.prev = { x: st.xC, y: st.yC, phi: st.phi, fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] }, copyBasis(pv, BAS);
      var a = pv.phi - st.phi, ca = Math.cos(a), sa = Math.sin(a);
      // 上一帧 CM 的 (px, py, 0) → 本帧 CM：绕 y 转 a（toW 方向）
      o.uPrevPos[0] = pv.x * ca - st.xC; o.uPrevPos[1] = pv.y - st.yC; o.uPrevPos[2] = pv.x * sa;
      rot(pv.right, ca, sa, BASP.right); rot(pv.up, ca, sa, BASP.up); rot(pv.fwd, ca, sa, BASP.fwd);
      var T = o.uPrevBasisT;
      T[0] = BASP.right[0]; T[1] = BASP.right[1]; T[2] = BASP.right[2];
      T[3] = BASP.up[0]; T[4] = BASP.up[1]; T[5] = BASP.up[2];
      T[6] = BASP.fwd[0]; T[7] = BASP.fwd[1]; T[8] = BASP.fwd[2];
      // 本帧记成下一帧的“上一帧”
      pv.x = st.xC; pv.y = st.yC; pv.phi = st.phi; copyBasis(pv, BAS);
      return o;
    };
    function rot(v, ca, sa, out) { out[0] = v[0] * ca - v[2] * sa; out[1] = v[1]; out[2] = v[0] * sa + v[2] * ca; return out; }
    function copyBasis(dst, b) { for (var i = 0; i < 3; i++) { dst.fwd[i] = b.fwd[i]; dst.right[i] = b.right[i]; dst.up[i] = b.up[i]; } }

    cam.toSite = function () { return { s: st.P.R * st.psi, az: wrapDeg(st.phi * R2D) }; };
    cam.alt = function () { return eyeKm(); };
    cam.lam = function () { return st.phi; };            // 相机地固经度 φ_C（弧度，未取模）：HY.fp.cel.compute 的 camLam
    // 图表坐标 c＝[东, 北]（km，双精度，02 第三节第 4 条）：阶地 (−R_ref·φ, −y)，斜坡 (−R_ref·φ, −R·ψ)，取真实相机（眼）处。
    // 这就是 uOrg 的锚：实例格网、地平线角图、云影图等要“相机在图表上的位置”时都用它
    cam.chart = function (out) {
      out = out || [0, 0];
      out[0] = -st.Rref * st.phi;
      out[1] = st.mode === 1 ? -st.yC : -st.P.R * Math.atan2(st.xC, -st.yC);
      return out;
    };
    cam.posW = function () {
      var c = Math.cos(st.phi), s = Math.sin(st.phi);
      return [st.xC * c, st.yC, st.xC * s];
    };
    // HY.astro.look／towerView 用的观察者（相机此刻的真实位置）
    cam.observer = function () {
      var c = Math.cos(st.phi), s = Math.sin(st.phi), X = cam.posW(), L = Math.sqrt(X[0] * X[0] + X[1] * X[1] + X[2] * X[2]);
      return {
        x: X[0], y: X[1], z: X[2], r: st.xC, s: st.P.R * st.psi, az: wrapDeg(st.phi * R2D), psi: st.psi, phi: wrapPi(st.phi),
        lat: 90 - st.psi * R2D, U: [-c, 0, -s], N: [0, -1, 0], E: [s, 0, -c], n: [-X[0] / L, -X[1] / L, -X[2] / L]
      };
    };
    cam.info = function () {
      var lk = cam.look();
      return {
        mode: st.mode, s: st.P.R * st.psi, az: wrapDeg(st.phi * R2D), psi: st.psi, phi: st.phi, y: st.yC, rho: st.xC,
        lat: 90 - st.psi * R2D, f: st.f, level: st.k, Rref: st.Rref, eye: eyeKm(), amp: st.amp,
        yaw: lk.yaw, pitch: lk.pitch, fov: lk.fov, fovEff: lk.fovEff, gaze: st.gaze, tele: st.tele, moving: st.moving,
        zone: st.info && st.info.zone ? st.info.zone.id : null, Hc: st.lim ? st.lim.uHc : 0,
        tread: st.mode === 1 ? st.tread : NaN, slope: st.slope || 0, R: st.P.R
      };
    };
    cam.dispose = function () { if (K.current === cam) K.current = null; };

    cam.teleport(site && site.s != null ? site.s : 6670, site && site.az != null ? site.az : -4);
    K.current = cam;
    return cam;
  };

  /* ───────── HY.fp.api：HY.app 的第一人称取数接口（G 路；签名见 spec/03 第十四节第 3 条） ─────────
   * app.js 的 look、readPx、Eh、sunVis、moonState、gpuTimes、quality、perf 在第一人称时都转到这里。
   * 放在本文件（G 路）而不是 fp/fp.js（E 路），两路不改同一个文件；函数体在调用时才找 HY.fp.*，与载入次序无关。
   */
  function fpActive() {
    return !!(HY.state && HY.state.view && HY.state.view.mode === 'fp' && fp.status && fp.status().phase === 'ready');
  }
  // 观察者：第一人称在用时取相机此刻的真实位置；否则取当前地点（HY.model.O）。
  // 离开第一人称后 K.current 仍在（资源保留），但它停在上次的位置，不能拿来算总览里的朝向
  function observerNow() {
    if (K.current && fpActive()) return K.current.observer();
    return HY.model && HY.model.O ? HY.model.O : null;
  }
  fp.api = {
    // look(yaw, pitch, fov)：立即设朝向（null＝不变）；look('sun') 等＝朝向快捷（见 lookPreset）
    look: function (yaw, pitch, fov) {
      if (typeof yaw === 'string') return fp.api.lookPreset(yaw, pitch);
      var o = {}, cam = K.current, on = !!(cam && fpActive());
      if (cam) { cam.setLook(yaw, pitch, fov); if (on) cam.cancelPreset(); }
      if (on) {
        // 第一人称在用：三项一起写回。只写给了的那项时，fp.js 收到事件会拿状态里另两项（每 0.5 s 才写回一次，是旧的）
        // 去 setLook，相机会跳回半秒前的朝向
        var lk = cam.look();
        o.yaw = lk.yaw; o.pitch = lk.pitch; o.fov = lk.fov;
      } else {
        if (yaw != null) o.yaw = yaw;
        if (pitch != null) o.pitch = pitch;
        if (fov != null) o.fov = fov;
      }
      if (HY.store && Object.keys(o).length) HY.store.patch('fp', o, 'api');
      return HY.state ? { yaw: HY.state.fp.yaw, pitch: HY.state.fp.pitch, fov: HY.state.fp.fov } : o;
    },
    // 朝向快捷：'north'（北·塔根）'east' 'south'（南·塔顶）'west' 'zenith' 'sun' 'moon'。
    // 第一人称在用时交给相机，下一帧开头按那时的位置与时间算（同一时刻刚设的地点、时间都算数），平滑转过去
    //   （fp.js 每 0.5 s 写回 fp.yaw/pitch）；opts.instant＝一步到位，opts.dur＝转多久（秒）。
    // 否则按当前地点直接写状态。返回按此刻位置估的 {yaw, pitch}（yaw 为 null＝方位不变）；不认识的名字返回 null
    lookPreset: function (name, opts) {
      opts = opts || {};
      if (!K.isPreset(name)) return null;
      var O = observerNow(), P = HY.model && HY.model.P;
      if (!O || !P) return null;
      var t = HY.state ? HY.state.time.t : 0, a = K.presetAngles(name, O, t, P);
      if (!a) return null;
      if (K.current && fpActive()) { K.current.requestPreset(name, opts.instant ? 0 : opts.dur); return a; }
      fp.api.look(a.yaw, a.pitch, null);
      return a;
    },
    presets: function () { return K.LOOK_PRESETS.slice(); },
    readPx: function (x, y) { return typeof fp.readPx === 'function' ? fp.readPx(x, y) : NaN; },
    // 第一人称实测水平面照度；第一人称没就绪（读数还没回来）时退回总览的估算（est: true）
    Eh: function () {
      var lux = typeof fp.Eh === 'function' ? fp.Eh() : NaN;
      if (isFinite(lux)) return { lux: lux, est: false };
      if (HY.calc && HY.calc.illum && HY.model && HY.model.O) {
        try {
          var il = HY.calc.illum(HY.model.O, HY.state.time.t, HY.model.P, {});
          return { lux: il.sunLuxGround, est: true };
        } catch (e) { /* 估算出错：给 NaN，不让取数接口抛错 */ }
      }
      return { lux: NaN, est: true };
    },
    // 日面露出比例：第一人称里按相机此刻的真实位置算（行走中地点写回有 1 Hz 节流），否则取 HY.model.now
    sunVis: function () {
      var P = HY.model && HY.model.P;
      var O = K.current && fpActive() ? K.current.observer() : HY.model && HY.model.O;
      if (O && P && HY.state) return HY.astro.look(O, HY.astro.sunPos(HY.state.time.t, P), P).vis;
      return HY.model && HY.model.now ? HY.model.now.sun.vis : NaN;
    },
    moonState: function () {
      var P = HY.model && HY.model.P;
      if (P && HY.state) return HY.astro.moonState(HY.state.time.t, P);
      return HY.model && HY.model.now ? HY.model.now.moon.state : '';
    },
    // 此刻的位置与朝向：第一人称在用时取相机（步行中比 HY.state.site 新）；否则取状态（离开后留着的相机停在旧处）
    pose: function () {
      if (K.current && fpActive()) { var i = K.current.info(); return { s: i.s, az: i.az, yaw: i.yaw, pitch: i.pitch, fov: i.fov, alt: i.eye }; }
      var S = HY.state;
      if (S && S.site && S.fp) return { s: S.site.s, az: S.site.az, yaw: S.fp.yaw, pitch: S.fp.pitch, fov: S.fp.fov, alt: (S.fp.eye == null ? 1.6 : S.fp.eye) / 1000 };
      return typeof fp.pose === 'function' ? fp.pose() : null;
    },
    gpuTimes: function () { return typeof fp.gpuTimes === 'function' ? fp.gpuTimes() : {}; },
    quality: function (tier) {
      if (typeof fp.setQuality === 'function') return fp.setQuality(tier, 'api');
      if (HY.store) HY.store.set('fp.quality', tier, 'api');
    },
    perf: function () {
      return typeof fp.perf === 'function' ? fp.perf() : { fps: 0, cpuMs: 0, gpuMs: 0, res: 0, tier: HY.state ? HY.state.fp.quality : 'mid' };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
