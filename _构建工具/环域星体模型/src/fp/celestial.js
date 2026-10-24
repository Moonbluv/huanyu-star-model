/* HY.fp.cel —— 地固 → CM 变换、日月 uniform、月体系、光度、罪域方向（规格：spec/02 第二、三、五、七、十一节）
 * 负责：G 路（第一人称·天体与相机）。
 * 节点可测（test/fp_cel_check.js、moon_norm.js、tower_vis.js）：不依赖 THREE，返回普通数值对象，
 *   由 fp.js 用 HY.fp.apply(U, vals, 'cel') 写入。
 * 日月位置、半径、定标、月光一律取 HY.astro（日心 sunPos、月心 moonPos、Eref/Dref、pMoon、sunlitAt、phaseAngle、
 *   lambertPhase），本文件不另立天体公式，只做坐标变换与单位换算。
 * 统筹修订：光度定标默认 5772 K（astro.calib）、月面反照率默认 0.6（astro.o.pMoon 不覆盖），都是 HY.model.P 里的值；
 *   静滞暗幕默认关（fp.set.veil），开了以后 fp.set.dayComp 才起作用。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};
  fp.cel = fp.cel || {};
  var C = fp.cel;
  var fr = Math.fround, PI = Math.PI, D2R = PI / 180;
  // sky 修订新增：昼光补偿改成“扣路程”（km），由本模块写（04 第三节：在自己的文件里登记）
  if (fp.registerUniforms) fp.registerUniforms([['uVeilComp', 'float', 0, 'cel'], ['uMoonMare', 'float', -0.11, 'cel']]);

  // 日色：5772 K 黑体在线性 sRGB 里（亮度归一，02 第二节第 2 条）
  C.SUN_RGB = [1.104, 0.978, 0.919];
  // 罪域阴云的半径（km，沿地面；02 第十节第 1 条、附录 A）
  C.RUI_RAD = 900;
  // 月面 BRDF（sky 修订，与 moon.glsl 的 MOON_WLS／MOON_WL 同值）：Lommel–Seeliger 八成、朗伯两成，满月几乎是平的；
  // 盘面几何反照率＝系数×(0.8＋0.2·2/3)。相位遮蔽 S(α) 让整盘光通量仍按朗伯式随相位走（见 moon.glsl）
  C.MOON_WLS = 0.8; C.MOON_WL = 0.2;
  C.BRDF_P = C.MOON_WLS + C.MOON_WL * 2 / 3;
  C.MARE_W = 0.045;   // 月海边缘渐变的半宽（与 moon.glsl 的 MARE_W 同值）
  // ⟨月海调制⟩：shadeMoon 的 moonAlbMod 在月球外侧半球（朝内壁那面）上的盘面加权均值；C.mareT＝月海门槛（uMoonMare）。
  // 三维噪声没生成前按全零纹理（GPU 此时采到的也是 0）；fp.js 生成 uNoise3 后调 C.calibrateMare(tex) 更新（下一帧起生效）。
  // 文件末尾赋初值。
  C.mareT = -0.11;
  C.mareMean = 1.0856;

  /* ───────── 坐标 ───────── */
  // 地固 → CM：绕塔轴转 −φ_C，使相机经度＝0（02 第三节第 1 条）。p：{x,y,z} 或 [x,y,z]；返回 [x′, y, z′]（双精度）
  C.toCM = function (p, camLam, out) {
    var x = p.x != null ? p.x : p[0], y = p.y != null ? p.y : p[1], z = p.z != null ? p.z : p[2];
    var c = Math.cos(camLam), s = Math.sin(camLam);
    out = out || [0, 0, 0];
    out[0] = x * c + z * s; out[1] = y; out[2] = -x * s + z * c;
    return out;
  };
  // CM → 地固：φ＝atan2(z′, x′)＋φ_C
  C.toW = function (q, camLam, out) {
    var c = Math.cos(camLam), s = Math.sin(camLam);
    out = out || [0, 0, 0];
    var x = q[0], y = q[1], z = q[2];
    out[0] = x * c - z * s; out[1] = y; out[2] = x * s + z * c;
    return out;
  };
  // CM → 地固 的 mat3，行优先 9 个数（与 THREE.Matrix3.set 的参数顺序相同）
  C.cm2w = function (camLam, out) {
    var c = Math.cos(camLam), s = Math.sin(camLam);
    out = out || new Array(9);
    out[0] = c; out[1] = 0; out[2] = -s;
    out[3] = 0; out[4] = 1; out[5] = 0;
    out[6] = s; out[7] = 0; out[8] = c;
    return out;
  };

  // 罪域中心（地固单位向量）：地点表里的 zuiyu（6670 km、−4°）
  C.ruiCenter = function (P) {
    var q = HY.world && HY.world.siteById ? HY.world.siteById('zuiyu', P) : null;
    var s = q ? q.s : 6670, az = q ? q.az : -4;
    var O = HY.astro.site(s, az, P), L = Math.sqrt(O.x * O.x + O.y * O.y + O.z * O.z);
    return [O.x / L, O.y / L, O.z / L];
  };

  /* ───────── 设定量（只读 state.fp，写入方仍是本模块） ───────── */
  // 大气顶离壁高度（与 settings 的 uZtop 同式：min(10·max(HR, HM), 800)）
  C.ztop = function (fps) {
    var a = fps && fps.atmo ? fps.atmo : { HR: 40, HM: 6 };
    if (fp.set && typeof fp.set.ztop === 'function') return fp.set.ztop(a.HR, a.HM);   // E 路的同一个函数
    return Math.min(10 * Math.max(a.HR, a.HM), 800);
  };
  // 静滞暗幕 /km（与 settings 的 uVeilK 同一映射：veil ? veilK/1000 : 0；veilK 缺了取默认 0.3，也与 settings 相同）
  C.veilK = function (fps) {
    var s = fps && fps.set;
    if (!s || !s.veil) return 0;
    var k = typeof s.veilK === 'number' && isFinite(s.veilK) ? s.veilK : 0.3;
    return k / 1000;
  };
  // 夜幕的几何（与 common.glsl 的 VEIL_ZF、VEIL_D0、VEIL_D1 同值；sky 修订，见那里的注释）：
  //   夜幕充满离壁 VEIL_ZF·Ztop 以上的空腔；昼光补偿只补相机附近（1000 km 内全补，2500 km 外不补），补到不开夜幕为止
  C.VEIL_ZF = 0.4; C.VEIL_D0 = 1000; C.VEIL_D1 = 2500;
  C.veilR = function (P, fps) { return P.R - C.VEIL_ZF * C.ztop(fps); };
  C.veilLocal = function (dist) { return 1 - sstep(C.VEIL_D0, C.VEIL_D1, dist); };
  // 线段 X→S 在半径 Rc 的球里的长度（与 common.glsl 的 veilLen 同一几何）
  C.corePath = function (X, S, Rc) {
    var dx = S[0] - X[0], dy = S[1] - X[1], dz = S[2] - X[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(L > 0)) return 0;
    dx /= L; dy /= L; dz /= L;
    var b = X[0] * dx + X[1] * dy + X[2] * dz, c = X[0] * X[0] + X[1] * X[1] + X[2] * X[2] - Rc * Rc, D = b * b - c;
    if (D <= 0) return 0;
    var sq = Math.sqrt(D), t0 = -b - sq, t1 = -b + sq;
    return Math.max(0, Math.min(t1, L) - Math.max(t0, 0));
  };
  // 昼光补偿用的“日光在夜幕里的平均路径”（02 第七节第 7 条）：观察点 X 处、日高取 Sy 时，日轨（半径 P.dS）上均匀取 n 处，
  // 按“从 X 看日面露出塔外的比例”加权，求日→X 在夜幕里路程的平均（km）。也就是“此地这一天白天的平均”。
  // 它只随季节（日高）和地点慢慢变，一天之内不变。补偿扣的是“路程”且不扣过头（透射 ≤1），正午此地照旧、夜里不被抬亮。
  C.dayPath = function (X, Sy, P, Rc, n) {
    n = n || 48;
    var A = HY.astro, S = [0, Sy, 0], sw = 0, sl = 0;
    for (var i = 0; i < n; i++) {
      var th = (i + 0.5) / n * 2 * PI;
      S[0] = P.dS * Math.cos(th); S[2] = P.dS * Math.sin(th);
      var w = A.diskVisible(X[0], X[2], S[0], S[2], P.rhoS, P.a);
      if (w > 0) { sw += w; sl += w * C.corePath(X, S, Rc); }
    }
    return sw > 0 ? sl / sw : 0;
  };
  // 昼光补偿（km）＝dayComp·白天平均路径（uVeilComp）。暗幕关、dayComp＝0 时为 0。按 0.25 km／日高 0.25 km 缓存
  var compKey = '', compVal = 0;
  C.veilComp = function (P, t, X, fps) {
    var k = C.veilK(fps), dc = fps && fps.set ? +fps.set.dayComp || 0 : 0;
    if (!(k > 0) || !(dc > 0)) return 0;
    var Sy = HY.astro.sunPos(t, P).y, Rc = C.veilR(P, fps);
    var key = [Math.round(X[0] * 4), Math.round(X[1] * 4), Math.round(X[2] * 4), Math.round(Sy * 4), Rc, P.dS, P.a, P.rhoS, dc].join('|');
    if (key !== compKey) { compKey = key; compVal = dc * C.dayPath(X, Sy, P, Rc); }
    return compVal;
  };
  // 日光到 Q 的夜幕透射（与 common.glsl 的 veilT(Q, uSunW) 同式）：camX＝相机，comp＝C.veilComp 的值。恒 ≤1、随 k 单调降
  C.sunVeilT = function (P, fps, Q, S, camX, comp) {
    var k = C.veilK(fps);
    if (!(k > 0)) return 1;
    var Lv = C.corePath(Q, S, C.veilR(P, fps));
    if (comp > 0) Lv = Math.max(Lv - comp * C.veilLocal(Math.hypot(Q[0] - camX[0], Q[1] - camX[1], Q[2] - camX[2])), 0);
    return Math.exp(-k * Lv);
  };

  /* ───────── 月光（01 第九节第 2 条：即 HY.astro.moonLux 去掉最后的 lk.vis） ───────── */
  // X：观察点（地固 [x,y,z]）。返回 lux：大气外、未乘“观察者看月被塔挡”的月光照度；受照比例与相位都取 HY.astro
  C.moonE0lux = function (P, t, X) {
    var A = HY.astro, S = A.sunPos(t, P), Mo = A.moonPos(t, P);
    var O = { x: X[0], y: X[1], z: X[2] };
    var dx = S.x - Mo.x, dy = S.y - Mo.y, dz = S.z - Mo.z, dSM = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var ex = Mo.x - O.x, ey = Mo.y - O.y, ez = Mo.z - O.z, dOM = Math.sqrt(ex * ex + ey * ey + ez * ez);
    var Esun = P.Eref * (P.Dref / dSM) * (P.Dref / dSM) * A.sunlitAt(Mo, t, P);
    return Esun * P.pMoon * (P.rhoM / dOM) * (P.rhoM / dOM) * A.lambertPhase(A.phaseAngle(O, S, Mo));
  };

  // 没给相机位置时的退路：当前相机 → 当前地点 → 交节经线上的罪域
  function camPosW(P, camLam) {
    var cam = fp.cam && fp.cam.current;
    if (cam && cam.posW) return cam.posW();
    var O = HY.model && HY.model.O;
    if (O && isFinite(O.x)) return [O.x, O.y, O.z];
    O = HY.astro.site(6670, camLam / D2R, P);
    return [O.x, O.y, O.z];
  }

  /* ───────── 每帧：全部 'cel' uniform ─────────
   * P＝HY.model.P，t＝日，camLam＝相机地固经度 φ_C（弧度），settings＝HY.state.fp，
   * camW（可省）＝相机地固位置 [x,y,z]（km，双精度）；省略时取 HY.fp.cam.current。
   * → { uSunW, uSunRho, uSunI, uMoonW, uMoonRho, uMoonAlb, uMoonBasis, uMoonE0, uMoonD2, uMoonAir, uRuiDir, uRuiRad }
   * 返回的对象每帧复用（热路径不分配），调用方不要长期持有。
   */
  var OUT = {
    uSunW: [0, 0, 0], uSunRho: 20, uSunI: [0, 0, 0],
    uMoonW: [0, 0, 0], uMoonRho: 100, uMoonAlb: 0.72, uMoonBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    uMoonE0: [0, 0, 0], uMoonD2: 1, uMoonAir: 0, uRuiDir: [0, 0, 0], uRuiRad: 900, uVeilComp: 0, uMoonMare: -0.11
  };
  var tmpS = [0, 0, 0], tmpM = [0, 0, 0], tmpR = [0, 0, 0], tmpC = [0, 0, 0];
  var ruiKey = '', ruiW = [0, 0, 0];
  C.compute = function (P, t, camLam, settings, camW) {
    var A = HY.astro, o = OUT, fps = settings || (HY.state && HY.state.fp) || {};
    if (camLam == null) camLam = fp.cam && fp.cam.current && fp.cam.current.lam ? fp.cam.current.lam() : 0;
    var X = camW || camPosW(P, camLam);
    var S = A.sunPos(t, P), Mo = A.moonPos(t, P);

    // 日月心（CM，双精度旋转后再 fround）
    C.toCM(S, camLam, tmpS); C.toCM(Mo, camLam, tmpM);
    o.uSunW[0] = fr(tmpS[0]); o.uSunW[1] = fr(tmpS[1]); o.uSunW[2] = fr(tmpS[2]);
    o.uMoonW[0] = fr(tmpM[0]); o.uMoonW[1] = fr(tmpM[1]); o.uMoonW[2] = fr(tmpM[2]);
    o.uSunRho = P.rhoS; o.uMoonRho = P.rhoM;

    // 光度：uSunI＝Eref·Dref²·日色/1000（klux·km²），不随夜幕变。昼光补偿是 uVeilComp（km）：GPU 在 veilT 里给日光那一段
    // 扣掉这么多夜幕路程（只在相机附近、扣到 0 为止），不再整体放大日光（sky 修订：原先夜幕越强夜越亮）
    var k = C.veilK(fps), comp = C.veilComp(P, t, X, fps);
    o.uVeilComp = comp;
    var I = P.Eref * P.Dref * P.Dref / 1000;
    o.uSunI[0] = I * C.SUN_RGB[0]; o.uSunI[1] = I * C.SUN_RGB[1]; o.uSunI[2] = I * C.SUN_RGB[2];

    // 月面反照：L‑S 与朗伯各半 → 系数＝pMoon/(0.5＋0.5·2/3)/⟨月海调制⟩
    o.uMoonAlb = P.pMoon / C.BRDF_P / (C.mareMean > 0 ? C.mareMean : 1);
    o.uMoonMare = C.mareT;

    // 月体系（潮汐锁定，一面朝塔轴）：z_b＝−(M.x,0,M.z)/|·|，y_b＝(0,1,0)，x_b＝y_b×z_b；mat3 的列＝x_b、y_b、z_b
    var hx = -tmpM[0], hz = -tmpM[2], hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-9) { hx = 1; hz = 0; hl = 1; }
    var zx = hx / hl, zz = hz / hl, xx = zz, xz = -zx;
    var B = o.uMoonBasis;
    B[0] = xx; B[1] = 0; B[2] = zx;
    B[3] = 0;  B[4] = 1; B[5] = 0;
    B[6] = xz; B[7] = 0; B[8] = zz;

    // 相机处大气外、未乘塔挡的月光（klux，带日色）；相机到月心距离²。
    // 开暗幕时与 shadeMoon 同口径：照到月面的日光乘“日→月”那段的夜幕透射（月离相机远，补偿按 veilLocal 只剩一点或没有；
    // 月→相机那段 GPU 自己乘）
    var Em = C.moonE0lux(P, t, X) / 1000;
    if (k > 0) Em *= C.sunVeilT(P, fps, [Mo.x, Mo.y, Mo.z], [S.x, S.y, S.z], X, comp);
    o.uMoonE0[0] = Em * C.SUN_RGB[0]; o.uMoonE0[1] = Em * C.SUN_RGB[1]; o.uMoonE0[2] = Em * C.SUN_RGB[2];
    var mx = Mo.x - X[0], my = Mo.y - X[1], mz = Mo.z - X[2];
    o.uMoonD2 = mx * mx + my * my + mz * mz;
    // 空气样本计月光：开暗幕或高档（02 第七节第 5 条）
    o.uMoonAir = (k > 0 || fps.quality === 'high' || fps.quality === 'photo') ? 1 : 0;

    // 罪域中心方向（CM 单位向量）与阴云半径
    var key = P.R + '|' + P.a;
    if (key !== ruiKey) { ruiW = C.ruiCenter(P); ruiKey = key; }
    C.toCM(ruiW, camLam, tmpR);
    o.uRuiDir[0] = fr(tmpR[0]); o.uRuiDir[1] = fr(tmpR[1]); o.uRuiDir[2] = fr(tmpR[2]);
    o.uRuiRad = C.RUI_RAD;
    return o;
  };

  /* ───────── 月海调制的 JS 镜像（moon.glsl 的 shadeMoon 前两行）与定标 ───────── */
  function sstep(a, b, x) { var u = (x - a) / (b - a); u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }
  // tex：{data: Uint8Array(size³·4), size}（x 最快、其次 y、再次 z，与 DataTexture3D 相同）；p：[0,1]³ 归一坐标；
  // 三线性、重复环绕，与 GL 的 LINEAR＋REPEAT 一致。返回该通道 0–1
  C.sample3 = function (tex, p, ch) {
    var n = tex.size, d = tex.data;
    var ux = p[0] * n - 0.5, uy = p[1] * n - 0.5, uz = p[2] * n - 0.5;
    var x0 = Math.floor(ux), y0 = Math.floor(uy), z0 = Math.floor(uz);
    var fx = ux - x0, fy = uy - y0, fz = uz - z0, acc = 0;
    for (var k = 0; k < 2; k++) for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) {
      var xi = ((x0 + i) % n + n) % n, yj = ((y0 + j) % n + n) % n, zk = ((z0 + k) % n + n) % n;
      var w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
      acc += w * d[((zk * n + yj) * n + xi) * 4 + ch];
    }
    return acc / 255;
  };
  // nb：月面本体系里的单位法向（transpose(uMoonBasis)·n）。tex 省略＝噪声未生成（取 0）。与 moon.glsl 的 moonMareField／moonAlbMod 逐式相同
  function s3(tex, nb, k, o, ch) { return tex ? C.sample3(tex, [nb[0] * k + o[0], nb[1] * k + o[1], nb[2] * k + o[2]], ch) : 0; }
  var O_MARE = [0.5, 0.17, 0.83], O_EDGE = [0.31, 0.31, 0.31], O_CRAT = [0.13, 0.13, 0.13];
  C.mareField = function (nb, tex) { return s3(tex, nb, 0.27, O_MARE, 0) + 0.22 * (s3(tex, nb, 0.85, O_EDGE, 1) - 0.5); };
  C.mareMod = function (nb, tex, thr) {
    if (thr == null) thr = C.mareT;
    var mare = sstep(thr + C.MARE_W, thr - C.MARE_W, C.mareField(nb, tex));
    var cr = s3(tex, nb, 1.9, O_CRAT, 0), ca = s3(tex, nb, 1.9, O_CRAT, 3), fresh = sstep(0.86, 0.98, ca);
    return (1 + (0.55 - 1) * mare) * (0.88 + 0.24 * cr) * (1 + 0.4 * fresh * (1 - 0.5 * mare));
  };
  // 外侧半球（本体系 −z_b，从内壁看过去的那一面）上的斐波那契点，满相时的盘面权重 w＝0.2·μ²（朗伯）＋0.8·μ（L‑S）
  function face(n, fn) {
    var ga = PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), ph = i * ga, mu = -z;
      if (mu <= 0) continue;
      fn([r * Math.cos(ph), r * Math.sin(ph), z], C.MOON_WL * mu * mu + C.MOON_WLS * mu);
    }
  }
  // 满相盘面加权均值（与 uMoonAlb 的归一同口径）
  C.mareWeighted = function (tex, n, thr) {
    var sw = 0, sm = 0;
    face(n || 4096, function (nb, w) { sw += w; sm += w * C.mareMod(nb, tex, thr); });
    return sm / sw;
  };
  // 月海门槛：外侧半球按投影面积（μ）加权、月海场的 frac 分位（默认三分之一）
  C.mareThreshold = function (tex, n, frac) {
    var a = [];
    face(n || 4096, function (nb, w, mu) { a.push([C.mareField(nb, tex), -nb[2]]); });
    a.sort(function (x, y) { return x[0] - y[0]; });
    var tot = 0, k; for (k = 0; k < a.length; k++) tot += a[k][1];
    var acc = 0, want = (frac || 1 / 3) * tot;
    for (k = 0; k < a.length; k++) { acc += a[k][1]; if (acc >= want) return a[k][0]; }
    return a.length ? a[a.length - 1][0] : -0.11;
  };
  // 三维噪声 uNoise3 生成后调用一次：先定月海门槛（uMoonMare），再更新 C.mareMean（uMoonAlb 下一帧起生效），返回新的均值
  C.calibrateMare = function (tex, n) {
    if (tex && tex.data && !tex.size) tex = { data: tex.data, size: Math.round(Math.cbrt(tex.data.length / 4)) };
    var tx = tex && tex.data ? tex : null;
    var thr = C.mareThreshold(tx, n);
    if (isFinite(thr)) C.mareT = thr;
    var m = C.mareWeighted(tx, n);
    if (isFinite(m) && m > 0) C.mareMean = m;
    return C.mareMean;
  };
  C.mareMean = C.mareMod([0, 0, -1], null);
})(typeof globalThis !== 'undefined' ? globalThis : window);
