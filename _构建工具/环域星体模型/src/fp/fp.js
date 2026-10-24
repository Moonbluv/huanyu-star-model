/* HY.fp —— 第一人称入口：生命周期、每帧调度、读数、取数（规格：spec/03 第七节第 1、4–8 条；spec/02 第五节、第十六节第 5–6 条）
 * 负责：E 路（第一人称·管线）。
 * 视图接口（与 HY.ov 共用）：init(gfx) → Promise / activate / deactivate / frame(ctx) / resize / dispose / status
 * HY.app 的第一人称取数接口在 HY.fp.api（G 路，fp/camera.js），它转到本文件的 readPx、Eh、gpuTimes、perf、setQuality。
 *
 * 生命周期（03 第七节第 4 条）：
 *   idle ─init→ loading（能力检测 → 建渲染目标 → 逐个编“低”档程序并发 progress → 生成高度图、查找表、天气图 → 首帧）→ ready
 *   ready 之后若 fp.quality 不是“低”，在帧循环里逐个编目标档位（每帧至多一个），编完再切过去（发 quality）。
 *   失败 → failed（reason，中文）。离开第一人称默认保留资源；低档与手机由 app 在 60 s 后调 dispose。
 * 每帧（02 第十六节第 5 条）：控制输入 → 相机步行 → cam／cel／set 三个写入方各算各的 uniform → passes 帧图 → 动态分辨率
 *   → 后台编译 → 眼的读回（0.5 s 一次，异步）→ 节流写回状态。
 * 唯一的状态写入：步行时 patch site（src:'walk'，每走 0.5 km 或停步，≤1 Hz）；每 0.5 s 写回 fp.yaw/pitch/fov（src:'fp'）；
 *   动态分辨率在下限仍超时时把 fp.quality 降一档（src:'fp'）。
 * 统筹修订：夜默认如实画“白夜”（fp.set.veil 默认关，见 settings.js）；地面默认阶地。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var fp = HY.fp = HY.fp || {};

  var TIER_ORDER = ['low', 'mid', 'high', 'photo'];
  var TIER_NAME = { low: '低', mid: '中', high: '高', photo: '拍照' };
  var st = { phase: 'idle', progress: 0, reason: '' };
  var gfxRef = null, U = null, graph = null, cam = null, initP = null, active = false, gen = 0, relaunch = null;
  var size = { w: 1, h: 1 };
  var offs = [], ctxOff = null;
  var dirty = { set: true, model: false, teleport: null, look: false, jump: false, tier: null, tierReason: '' };   // look：{yaw, pitch, fov} 哪几项要从状态套到相机
  var ro = { lux: NaN, eye: '明视', ev: NaN, fps: 0, res: 0, tier: 'low', La: NaN, LaTarget: NaN, Esun: NaN, Edir: NaN, expo: NaN, at: 0 };
  var catRGB = [1 / 3, 1 / 3, 1 / 3], catAim = null, CAT = [1, 0, 0, 0, 1, 0, 0, 0, 1], catJump = true;
  var perfS = { fps: 0, cpuMs: 0 };
  var clock = { real: 0, look: 0, read: 0, walkSince: 0, walkKm: 0, walkWas: false, upHint: '', lastStill: false };
  var lastCam = new Float64Array(7), sunDir = [0, 0, -1];
  // 相机与上一帧完全相同（拍照累积用）；顺便记下这一帧
  function sameCam(cv) {
    var a = cv.uCamW, f = cv.uCamFwd, v = [a[0], a[1], a[2], f[0], f[1], f[2], cv.uTanHalfFov], same = true;
    for (var i = 0; i < 7; i++) { if (lastCam[i] !== v[i]) same = false; lastCam[i] = v[i]; }
    return same;
  }

  function nowMs() { return HY.util && HY.util.now ? HY.util.now() : Date.now(); }
  function emit(ev, p) { if (HY.bus) HY.bus.emit(ev, p); }
  function msgOf(e) { return (e && e.message) || String(e); }
  function wrapDeg(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; }

  /* ───────── 能力 ───────── */
  // 需要 WebGL2 与浮点渲染目标；缺 EXT_color_buffer_float 时报 degraded（02 第十六节第 1 条的 RGBM 降级暂未实现，先不放行）
  fp.supported = function () {
    var THREE = G.THREE, caps = HY.gfx && HY.gfx.caps;
    if (!THREE) return { ok: false, degraded: false, reason: '三维视图需要联网加载 three.js（cdnjs）' };
    if (!caps || !caps.ok) return { ok: false, degraded: false, reason: (caps && caps.reason) || '三维视图还没有启动' };
    if (!caps.webgl2) return { ok: false, degraded: false, reason: '第一人称需要 WebGL2，这个浏览器不支持' };
    if (!THREE.DataTexture3D || !THREE.GLSL3) return { ok: false, degraded: false, reason: 'three.js 版本不对（第一人称按 r128 写）' };
    if (!caps.floatRT) return { ok: false, degraded: true, reason: '这块显卡不支持浮点渲染目标（EXT_color_buffer_float），写实管线没法运行' };
    return { ok: true, degraded: false, reason: '' };
  };

  /* ───────── 启动 ───────── */
  function progress(done, total, label, phase) {
    st.progress = total > 0 ? done / total : 0;
    emit('progress', { phase: phase || 'loading', done: done, total: total, label: label });
  }
  function later(ms) { return new Promise(function (res) { setTimeout(res, ms || 0); }); }

  fp.init = function (gfx) {
    if (st.phase === 'ready') return Promise.resolve();
    if (initP) return initP;
    var sup = fp.supported();
    if (!sup.ok) {
      st = { phase: 'failed', progress: 0, reason: sup.reason };
      return Promise.reject(new Error(sup.reason));
    }
    gfxRef = gfx || HY.gfx;
    st = { phase: 'loading', progress: 0, reason: '' };
    var my = ++gen;
    var me = initP = later(0).then(function () {
      if (my !== gen) throw new Error('已取消');
      boot();
      return compileAll(my);
    }).then(function () {
      if (my !== gen) throw new Error('已取消');
      var cs = graph.compileStatus();
      progress(cs.total + 1, cs.total + 2, '正在生成地形、查找表与天气');
      compileInst();
      return later(0);
    }).then(function () {
      if (my !== gen) throw new Error('已取消');
      firstFrame();
      var cs = graph.compileStatus();
      progress(cs.total + 2, cs.total + 2, '第一人称就绪');
      st = { phase: 'ready', progress: 1, reason: '' };
      initP = null;
      var want = HY.state.fp.quality;
      if (want !== graph.tier) { dirty.tier = want; dirty.tierReason = '着色器已编译'; }
    }).catch(function (e) {
      if (my === gen) {
        st = { phase: 'failed', progress: 0, reason: msgOf(e) };
        teardown();
        initP = null;
        throw e;
      }
      // 已作废：被 dispose 取消就照样报错；被图形上下文恢复重启的，跟着新的一轮走（initP 此时已是新的，不能清掉）
      if (relaunch && relaunch !== me) return relaunch;
      throw e;
    });
    return initP;
  };

  function boot() {
    var THREE = G.THREE, S = HY.state, P = HY.model.P;
    if (!P) throw new Error('天体参数还没有准备好');
    U = fp.makeU(THREE);
    cam = fp.cam.create(P, S.site, S.fp);
    cam.setLook(S.fp.yaw, S.fp.pitch, S.fp.fov);
    var r = fp.set.apply(S, P, U, null, 'low');         // 首次：全部写入，标志全真（帧图先编“低”档，眩光级数按它）
    graph = fp.passes.build(gfxRef, U, 'low', {
      defines: function (pass) { return fp.set.defines(HY.state, pass); },
      onError: function (m) { if (G.console) G.console.error('[第一人称] ' + m); }
    });
    graph.invalidate(r);
    graph.onTier = onTier;
    graph.resize(size.w, size.h);
    ro.tier = graph.tier;
    applyFrameUniforms(HY.state.time.t, 0);
    wire();
    makeNoise();
    if (fp.inst && !fp.inst.__stub && typeof fp.inst.build === 'function') {
      try { fp.inst.build(gfxRef, U, graph.tier); } catch (e) { if (G.console) G.console.error(e); }
    }
  }
  // 实例材质预编（F 路 HY.fp.inst.compile）：放在加载阶段，不留到第一次绘制时卡一下
  function compileInst() {
    if (fp.inst && !fp.inst.__stub && typeof fp.inst.compile === 'function') {
      try { fp.inst.compile(); } catch (e) { if (G.console) G.console.warn('[第一人称] 实例材质预编失败：' + msgOf(e)); }
    }
  }
  // 逐个编“低”档程序：每编一个让出一次主线程（总览照常出图），发 progress
  function compileAll(my) {
    return new Promise(function (resolve, reject) {
      function tick() {
        if (my !== gen) { reject(new Error('已取消')); return; }
        var more;
        try { more = graph.compileNext(); } catch (e) { reject(e); return; }
        var cs = graph.compileStatus();
        if (cs.error) { reject(new Error(cs.error)); return; }
        progress(cs.done, cs.total + 2, '正在编译着色器');
        if (more) setTimeout(tick, 0); else resolve();
      }
      tick();
    });
  }
  // 三维噪声分帧生成（F 路 HY.fp.noise.gen3D）；生成完之前云按全零噪声算（没有体积云，平板与天气图照常）
  function makeNoise() {
    var N = fp.noise;
    if (!N || typeof N.gen3D !== 'function') return;
    var my = gen;
    try {
      var a = N.gen3D(64), b = N.gen3D(32);
      Promise.all([a.done, b.done]).then(function (d) {
        if (my !== gen || !graph) return;
        graph.setNoise(d[0] || a.data, d[1] || b.data);
        if (fp.cel && fp.cel.calibrateMare) { try { fp.cel.calibrateMare({ data: d[0] || a.data, size: 64 }); } catch (e) { /* 忽略 */ } }
      }, function (e) { if (G.console) G.console.warn('[第一人称] 三维噪声没有生成：' + msgOf(e)); });
    } catch (e) { if (G.console) G.console.warn('[第一人称] 三维噪声没有生成：' + msgOf(e)); }
  }
  function firstFrame() {
    var S = HY.state;
    applyFrameUniforms(S.time.t, 0);
    graph.run(frameInfo(S, HY.model.P, S.time.t, 0, 0, false, true));
    graph.readEyeAsync();
  }

  /* ───────── 听状态 ───────── */
  function wire() {
    unwire();
    var bus = HY.bus;
    if (!bus) return;
    offs.push(bus.on('fp', function (e) {
      if (!e || e.src === 'fp') return;
      var ps = e.paths || [e.path];
      var onlyLook = ps.every(function (p) { return /^fp\.(yaw|pitch|fov)$/.test(p); });
      // 只套用真正变了的那几项（别处可能只改了视角，偏航、俯仰还没写回）
      ps.forEach(function (p) {
        var m = /^fp\.(yaw|pitch|fov)$/.exec(p);
        if (m || p === 'fp') { dirty.look = dirty.look || {}; if (m) dirty.look[m[1]] = true; else dirty.look.yaw = dirty.look.pitch = dirty.look.fov = true; }
      });
      if (ps.some(function (p) { return p === 'fp.quality' || p === 'fp'; })) { dirty.tier = HY.state.fp.quality; dirty.tierReason = ''; }
      if (!onlyLook) dirty.set = true;
    }));
    offs.push(bus.on('zones', function () { dirty.set = true; }));
    offs.push(bus.on('astro', function () { dirty.set = true; }));
    offs.push(bus.on('model', function (e) { if (e && e.what === 'P') { dirty.model = true; dirty.set = true; } }));
    offs.push(bus.on('site', function (e) {
      if (e && e.src === 'walk') return;
      var s = HY.state.site; dirty.teleport = { s: s.s, az: s.az };
    }));
    offs.push(bus.on('time', function (e) { if (fp._timeJumps(e)) dirty.jump = true; }));
    if (gfxRef && gfxRef.onContext && !ctxOff) ctxOff = gfxRef.onContext(onContext);
  }
  function unwire() { offs.forEach(function (f) { try { f(); } catch (e) { /* 忽略 */ } }); offs = []; }
  // time 事件是不是一次时间跳变（03 第七节第 5 条：｜Δt｜＞1 小时或 src＝'jump'）。只看 time.t：
  // 开关播放（time.playing）、改流速（time.speed.*）同样发 time 事件，它们不是跳变，不能清历史、让眼直接跳。
  fp._timeJumps = function (e) {
    if (!e || e.src === 'play') return false;
    var paths = e.paths || [e.path], whole = e.path === 'time';
    if (!paths.some(function (p) { return p === 'time.t' || p === 'time'; })) return false;
    var v = whole ? e.value && e.value.t : e.value, pv = whole ? e.prev && e.prev.t : e.prev;
    if (whole && v === pv) return false;                         // 整组写入（patch／reset）但 t 没变
    return e.src === 'jump' || !(Math.abs(v - pv) <= 1 / 24);
  };

  // 上下文丢失：停画；恢复后按启动流程重建全部 GPU 资源（03 第五节第 4 条）。
  // 加载中恢复：旧的加载作废（gen 加一），等着它的人（app 的进第一人称）改为等新的这一轮（见 init 的 catch）。
  function onContext(lost) {
    if (lost) { if (graph) graph.contextLost(); return; }
    if (st.phase !== 'ready' && st.phase !== 'loading') return;
    var wasActive = active;
    gen++; initP = null;
    teardown();
    st = { phase: 'idle', progress: 0, reason: '' };
    var p = relaunch = fp.init(gfxRef);
    p.then(function () {
      if (relaunch === p) relaunch = null;
      if (wasActive && HY.state.view.mode === 'fp') fp.activate();
    }, function (e) {
      if (relaunch === p) relaunch = null;
      emit('error', { part: 'fp', message: '图形上下文恢复后第一人称没能重建：' + msgOf(e) });
    });
  }

  /* ───────── 视图接口 ───────── */
  fp.activate = function () {
    if (st.phase !== 'ready' || !graph) return;
    active = true;
    var S = HY.state, q = cam.toSite();
    cam.setLook(S.fp.yaw, S.fp.pitch, S.fp.fov);
    if (Math.abs(q.s - S.site.s) > 1e-3 || Math.abs(wrapDeg(q.az - S.site.az)) > 1e-4) dirty.teleport = { s: S.site.s, az: S.site.az };
    if (fp.ctl && typeof fp.ctl.attach === 'function' && gfxRef && gfxRef.canvas) { try { fp.ctl.attach(gfxRef.canvas); } catch (e) { /* 忽略 */ } }
    graph.resize(size.w, size.h);
    graph.reset('all'); catJump = true;
    clock.look = clock.read = 0;
  };
  fp.deactivate = function () {
    if (!active) return;
    active = false;
    if (fp.ctl && typeof fp.ctl.detach === 'function') { try { fp.ctl.detach(); } catch (e) { /* 忽略 */ } }
    writeLook(true);
    writeSite(true);
  };
  fp.resize = function (w, h) {
    size.w = Math.max(1, w | 0); size.h = Math.max(1, h | 0);
    if (graph) graph.resize(size.w, size.h);
  };
  function teardown() {
    unwire();
    if (graph) { try { graph.dispose(); } catch (e) { /* 忽略 */ } }
    if (fp.inst && !fp.inst.__stub && typeof fp.inst.dispose === 'function') { try { fp.inst.dispose(); } catch (e) { /* 忽略 */ } }
    if (cam && cam.dispose) cam.dispose();
    graph = null; cam = null; U = null; active = false;
  }
  fp.dispose = function () {
    gen++;
    initP = null; relaunch = null;
    if (fp.ctl && typeof fp.ctl.detach === 'function' && active) { try { fp.ctl.detach(); } catch (e) { /* 忽略 */ } }
    teardown();
    if (ctxOff) { ctxOff(); ctxOff = null; }
    st = { phase: 'idle', progress: 0, reason: '' };
  };
  fp.status = function () { return { phase: st.phase, progress: st.progress, reason: st.reason }; };

  /* ───────── 每帧 ───────── */
  // 三个写入方各算各的（cam、cel、set），由这里统一 apply
  function applyFrameUniforms(t, dtSim) {
    var S = HY.state, P = HY.model.P;
    var cv = cam.compute();
    fp.apply(U, cv, 'cam');
    var info = cam.info();
    var cel = fp.cel.compute(P, t, info.phi, S.fp, cam.posW());
    fp.apply(U, cel, 'cel');
    fp.apply(U, fp.set.perFrame(S, P, t, dtSim, cam.mode()), 'set');
    // 日方向（CM）与日方位（相机处 N＝(0,−1,0)、E＝(0,0,−1)）
    var dx = cel.uSunW[0] - cv.uCamW[0], dy = cel.uSunW[1] - cv.uCamW[1], dz = cel.uSunW[2] - cv.uCamW[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    sunDir[0] = dx / L; sunDir[1] = dy / L; sunDir[2] = dz / L;
    return { cv: cv, info: info };
  }
  // 图表坐标取相机自己的 cam.chart()（双精度真实相机，与 uOrg 同一个锚）。原先对 rho、y 做 fround，
  // 与锚差到 0.5 m：每走过 float32 的一格，地平线角图与云影的级中心就跳一下（整合时按 G 路建议改）
  function chartOf() { return cam.chart(); }
  function frameInfo(S, P, t, dtReal, dtSim, still, skipFinal) {
    var info = cam.info();
    return {
      dtReal: dtReal, dtSim: dtSim, t: t,
      chart: chartOf(), chartKey: info.Rref.toFixed(6) + '|' + info.mode,
      sunAz: Math.atan2(-sunDir[2], -sunDir[1]) * 180 / Math.PI, sunDir: sunDir,
      still: still, rainK: fp.set.rainK(S, P, cam.posW(), clock.real, t),
      bakeHour: fp.set.bakeHour(t), bakeTime: fp.set.bakeTime(S, t),
      cat: CAT, skipFinal: !!skipFinal
    };
  }

  fp.frame = function (ctx) {
    if (st.phase !== 'ready' || !graph || graph.lost) return;
    var t0 = nowMs(), S = HY.state, P = HY.model.P;
    if (!P) return;
    var dtReal = Math.max(0, ctx && ctx.dtReal || 0), dtSim = ctx && ctx.dtSim || 0, t = ctx && ctx.t != null ? ctx.t : S.time.t;
    clock.real += dtReal;

    // ---- 状态变化（事件里只记标志，这里统一处理） ----
    if (dirty.model) { dirty.model = false; cam.setParams(P); graph.reset('all'); catJump = true; }
    if (dirty.teleport) {
      var tp = dirty.teleport; dirty.teleport = null; cam.teleport(tp.s, tp.az); graph.reset('all'); catJump = true;
      clock.walkKm = 0; clock.walkWas = false;          // 被瞬移了：之前那段步行不再写回（否则会把 site.id 清掉）
    }
    if (dirty.look) { var dl = dirty.look; dirty.look = false; cam.setLook(dl.yaw ? S.fp.yaw : null, dl.pitch ? S.fp.pitch : null, dl.fov ? S.fp.fov : null); }
    if (dirty.set) {
      dirty.set = false;
      var r = fp.set.apply(S, P, U, null, graph.tier);
      graph.invalidate(r);
      (r.recompile || []).forEach(function (p) { graph.recompile(p); });
      // r.recam（换地面模式）：不再原地瞬移。cam.compute() 每帧 place() 会按新模式贴地；瞬移会重定 R_ref，
      // 走过一段之后脚下图表的东向坐标整体跳动（G 路建议）。地平线角图、云影由 chartKey（含模式）失效重烘。
    }
    if (dirty.jump) { dirty.jump = false; graph.reset('jump'); catJump = true; }
    if (dirty.tier) { setTier(dirty.tier, dirty.tierReason); dirty.tier = null; }

    // ---- 相机 ----
    var inp = fp.ctl && typeof fp.ctl.input === 'function' ? fp.ctl.input() : null;
    var mv = cam.step(dtReal, inp);
    trackWalk(mv, dtReal);
    var u = applyFrameUniforms(t, dtSim);
    var still = sameCam(u.cv) && !dtSim;

    // ---- 色适应：照明色按 τ＝6 s 趋近 ----
    stepCat(dtReal);

    // ---- 帧图 ----
    graph.run(frameInfo(S, P, t, dtReal, dtSim, still, false));

    // ---- 动态分辨率、后台编译 ----
    // 静止累积（相机与时间都不动）期间冻结动态分辨率：改比例会重建目标、清掉 TAA 历史（M6 路建议）。
    // “拍照”档是读者主动选的、本来就慢：不因超时自动降档。
    clock.lastStill = still;
    var ar = still ? { down: false, up: false, changed: false } : graph.autoRes(dtReal, S.fp.dynRes);
    if (ar.down && graph.tier !== 'photo') {
      var i = TIER_ORDER.indexOf(graph.tier);
      if (i > 0 && !graph.compileStatus().pending) fp.setQuality(TIER_ORDER[i - 1], 'fp', '帧时超出预算，自动降档');
    }
    if (ar.up && !clock.upHint) {
      var j = TIER_ORDER.indexOf(graph.tier);
      if (j >= 0 && j < 2) { clock.upHint = TIER_ORDER[j + 1]; emit('quality', { tier: graph.tier, reason: '画面很流畅，可以在参数里升到“' + TIER_NAME[TIER_ORDER[j + 1]] + '”档', suggest: TIER_ORDER[j + 1] }); }
    }
    var cs = graph.compileStatus();
    if (cs.pending) {
      graph.compileNext();
      var c2 = graph.compileStatus();
      if (c2.error) emit('error', { part: 'fp', message: c2.error + '；保持“' + TIER_NAME[graph.tier] + '”档' });
      else progress(c2.done, c2.total, '正在编译“' + TIER_NAME[c2.tier] + '”档', 'tier');
    }

    // ---- 眼的读回（异步，0.5 s 一次） ----
    var e = graph.pollEye();
    if (e) takeEye(e);
    clock.read += dtReal;
    if (clock.read >= 0.5) { if (graph.readEyeAsync()) clock.read = 0; }

    // ---- 写回状态（节流） ----
    clock.look += dtReal;
    if (clock.look >= 0.5) { clock.look = 0; writeLook(false); }

    // ---- 统计 ----
    perfS.cpuMs = 0.9 * perfS.cpuMs + 0.1 * (nowMs() - t0);
    if (dtReal > 0) perfS.fps = perfS.fps ? 0.95 * perfS.fps + 0.05 / dtReal : 1 / dtReal;
    ro.fps = perfS.fps; ro.res = graph.scale; ro.tier = graph.tier;
  };

  function setTier(t, reason) {
    if (!graph || !fp.passes.TIERS[t]) return;
    dirty.tierReason = '';
    graph._reason = reason || '';
    graph.setTier(t);
    var cs = graph.compileStatus();
    if (cs.pending) progress(0, cs.total, '正在编译“' + TIER_NAME[t] + '”档', 'tier');
  }
  function onTier(t, old) {
    clock.upHint = '';
    ro.tier = t;
    if (fp.inst && !fp.inst.__stub && typeof fp.inst.build === 'function') {
      try { if (fp.inst.dispose) fp.inst.dispose(); fp.inst.build(gfxRef, U, t); } catch (e) { if (G.console) G.console.error(e); }
      compileInst();
    }
    fp.apply(U, fp.set.values(HY.state, HY.model.P, HY.state.time.t, cam ? cam.mode() : undefined, t), 'set');   // uBloomK 跟着实际档位的级数
    var cs = graph.compileStatus();
    progress(cs.total, cs.total, '', 'tier');
    emit('quality', { tier: t, reason: graph._reason || '' });
    graph._reason = '';
  }

  // 眼 pass 的读回 → 照度、人眼状态、照明色
  function takeEye(e) {
    var S = fp.set;
    ro.expo = e[0]; ro.La = e[1]; ro.Esun = e[2] * 1000; ro.lux = e[4] * 1000; ro.Edir = e[5] * 1000; ro.LaTarget = e[6];
    ro.eye = S.eyeState(e[1]); ro.ev = S.ev(e[7] > 0 ? e[7] : e[1]); ro.at = clock.real;   // e[7]：与此刻画面等亮的固定 EV 所对应的亮度（eye 路）
    catAim = S.unpackChroma(e[3]);
    if (catJump) { catRGB = catAim.slice(); catJump = false; }
  }
  function stepCat(dt) {
    if (catAim) {
      var a = 1 - Math.exp(-Math.max(dt, 0) / 6);
      for (var i = 0; i < 3; i++) catRGB[i] += (catAim[i] - catRGB[i]) * a;
    }
    CAT = fp.set.catMatrix(catRGB, HY.state.fp.eyeo.cat);
  }

  // 步行：每走 0.5 km 或停步时 patch site（src:'walk'），频率不超过 1 Hz（03 第七节第 8 条）
  function trackWalk(mv, dt) {
    clock.walkSince += dt;
    if (mv && mv.moved) { clock.walkKm += mv.dist || 0; clock.walkWas = true; }
    var stopped = clock.walkWas && !(mv && mv.moved);
    if ((clock.walkKm >= 0.5 || stopped) && clock.walkSince >= 1) writeSite(false);
  }
  function writeSite(force) {
    if (!cam || !clock.walkWas) return;
    // 还有没处理的瞬移（setSite 之后、下一帧之前就离开了第一人称）：状态里的地点更新，相机还在旧处，不能写回
    if (dirty.teleport) { clock.walkWas = false; clock.walkKm = 0; return; }
    if (!force && clock.walkSince < 1) return;
    var q = cam.toSite();
    HY.store.patch('site', { id: null, s: q.s, az: q.az }, 'walk');
    clock.walkSince = 0; clock.walkKm = 0; clock.walkWas = false;
  }
  function writeLook(force) {
    if (!cam) return;
    var lk = cam.look(), f = HY.state.fp;
    var dy = Math.abs(wrapDeg(lk.yaw - f.yaw)), dp = Math.abs(lk.pitch - f.pitch), df = Math.abs(lk.fov - f.fov);
    if (dy > 0.05 || dp > 0.05 || df > 0.05 || (force && (dy > 0 || dp > 0 || df > 0))) {
      HY.store.patch('fp', { yaw: Math.round(lk.yaw * 10) / 10, pitch: Math.round(lk.pitch * 10) / 10, fov: Math.round(lk.fov) }, 'fp');
    }
  }

  /* ───────── 取数 ───────── */
  fp.teleport = function (site) {
    if (!site) return;
    dirty.teleport = { s: site.s != null ? site.s : HY.state.site.s, az: site.az != null ? site.az : HY.state.site.az };
  };
  fp.pose = function () {
    if (cam) { var i = cam.info(); return { s: i.s, az: i.az, yaw: i.yaw, pitch: i.pitch, fov: i.fov, alt: i.eye }; }
    var s = HY.state;
    return { s: s.site.s, az: s.site.az, yaw: s.fp.yaw, pitch: s.fp.pitch, fov: s.fp.fov, alt: s.fp.eye / 1000 };
  };
  // eye pass 的 1×1 异步读回（0.5 s 一次）：lux＝水平面照度，eye＝明视／中间视／暗视，ev，fps，res＝内部渲染比例，tier
  fp.readouts = function () {
    return { lux: ro.lux, eye: ro.eye, ev: ro.ev, fps: ro.fps, res: ro.res, tier: graph ? graph.tier : HY.state ? HY.state.fp.quality : 'mid',
      La: ro.La, Esun: ro.Esun, Edir: ro.Edir, expo: ro.expo, age: clock.real - ro.at };
  };
  // 测试用：同步读本帧 tHDR 的一个像素 → 亮度 cd/m²。fx、fy ∈ [0,1]，原点在左下（与 A 原型的 readPx 相同）
  fp.readPx = function (fx, fy) {
    if (!graph || st.phase !== 'ready') return NaN;
    var r = graph.readPx(fx == null ? 0.5 : fx, fy == null ? 0.5 : fy);
    if (!r || !(r.expo > 0)) return NaN;
    return (0.2126 * r.rgb[0] + 0.7152 * r.rgb[1] + 0.0722 * r.rgb[2]) / r.expo * 1000;
  };
  // 同上，返回 {L:[r,g,b] cd/m², dist km}（浏览器验收用）
  fp.readPxRGB = function (fx, fy) {
    if (!graph || st.phase !== 'ready') return null;
    var r = graph.readPx(fx == null ? 0.5 : fx, fy == null ? 0.5 : fy);
    if (!r || !(r.expo > 0)) return null;
    var k = 1000 / r.expo;
    return { L: [r.rgb[0] * k, r.rgb[1] * k, r.rgb[2] * k], dist: r.dist, expo: r.expo };
  };
  // 实测水平面照度（lux）：最近一次读回；同步读一次眼（测试接口在 settle 之后调用时数要新）
  fp.Eh = function () {
    if (!graph || st.phase !== 'ready') return NaN;
    var e = graph.readEyeSync();
    if (e) { takeEye(e); return e[4] * 1000; }
    return ro.lux;
  };
  fp.gpuTimes = function () { return graph ? graph.gpuTimes() : {}; };
  // 上一帧是不是“静止”（相机与模拟时间都没动；拍照累积、冻结动态分辨率按它）
  fp.still = function () { return !!clock.lastStill; };
  fp.setQuality = function (tier, src, reason) {
    if (!fp.passes.TIERS[tier]) return;
    if (HY.store) HY.store.set('fp.quality', tier, src || 'api');
    dirty.tier = tier; dirty.tierReason = reason || '';
  };
  fp.perf = function () {
    var g = fp.gpuTimes(), sum = 0;
    for (var k in g) sum += g[k];
    return { fps: perfS.fps, cpuMs: perfS.cpuMs, gpuMs: sum, res: graph ? graph.scale : 0, tier: graph ? graph.tier : (HY.state ? HY.state.fp.quality : 'mid'),
      w: graph ? graph.W : 0, h: graph ? graph.H : 0 };
  };
  // 调试：帧图、目标、编译状态（浏览器验收与控制台用）
  fp.debug = function () { return graph ? { tier: graph.tier, W: graph.W, H: graph.H, scale: graph.scale, plan: graph.lastPlan.slice(), compile: graph.compileStatus(), errors: graph.errors.slice(), state: graph.state() } : null; };
  fp._graph = function () { return graph; };
  // 调试：某个 uniform 此刻的值（数组化）；names 省略＝全部非 sampler
  fp.uniformValues = function (names) {
    if (!U) return null;
    var o = {}, list = names || Object.keys(U);
    list.forEach(function (n) {
      var u = U[n]; if (!u) return;
      var v = u.value;
      if (v && v.isTexture) return;
      if (Array.isArray(v)) o[n] = v.map(function (x) { return x && x.toArray ? x.toArray() : x; });
      else if (v && v.elements) o[n] = Array.prototype.slice.call(v.elements);
      else if (v && v.toArray) o[n] = v.toArray();
      else if (v == null || typeof v !== 'object') o[n] = v;
    });
    return o;
  };
  // 注意：HY.fp.api（HY.app 的第一人称取数接口）归 G 路，定义在 fp/camera.js，本文件不要定义它。
})(typeof globalThis !== 'undefined' ? globalThis : window);
