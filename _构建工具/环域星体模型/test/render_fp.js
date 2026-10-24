/* render_fp.js —— 浏览器验收：第一人称（负责：E／F／G 路；规格：spec/03 第十一节第 2 条“第一人称”一项与 02 第十八节 GPU 表）
 * 只调 HY_CHECKS.add('第一人称', 名, fn)；fn 可返回 Promise，抛错或返回 false 算失败。M1 状态：空。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  // C.add('第一人称', '示例', function () { return true; });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── G 路：第一人称·天体与相机（组名“第一人称·天体与相机”；只在本块里增删） ───────── */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·天体与相机';
  function H() { return G.HY; }
  // 进第一人称；不支持（无 WebGL2 等）时返回说明字符串，各项就记“跳过”
  var entered = null;
  function enter() {
    if (entered) return entered;
    var sup = H().fp.supported();
    if (!sup.ok) { entered = Promise.resolve('跳过：' + sup.reason); return entered; }
    entered = H().app.view('fp').then(function () { return H().fp.status().phase === 'ready' ? '' : '跳过：第一人称没就绪（' + H().fp.status().reason + '）'; },
      function (e) { return '跳过：' + (e && e.message || e); });
    return entered;
  }
  function near(a, b, tol) { return Math.abs(a - b) <= tol; }
  function key(type, code) { G.dispatchEvent(new G.KeyboardEvent(type, { code: code, key: code.replace(/^Key|^Digit/, '').toLowerCase(), bubbles: true })); }

  C.add(GROUP, '进第一人称后输入挂在画布上、相机就绪', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H();
      if (!hy.fp.ctl.attached()) throw new Error('HY.fp.ctl 没挂上');
      if (!hy.fp.cam.current) throw new Error('HY.fp.cam.current 为空');
      return '地点 ' + hy.fp.api.pose().s.toFixed(1) + ' km';
    });
  });
  C.add(GROUP, '朝向快捷：北·塔根、南·塔顶、看太阳（转完与 HY.astro 一致）', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H(), out = [];
      hy.app.setSite('zuiyu'); hy.app.setTime(0.5);
      return hy.app.settle(4).then(function () {
        var O = hy.fp.cam.current.observer(), P = hy.model.P, tv = hy.astro.towerView(O, P);
        hy.app.look('north');
        return hy.app.settle(60).then(function () {
          var p = hy.fp.api.pose(); if (!near(p.pitch, tv.rootEl, 0.2) || !near(p.yaw, 0, 0.2)) throw new Error('北·塔根 pitch ' + p.pitch);
          out.push('塔根 ' + p.pitch.toFixed(1) + '°');
          hy.app.look('south');
          return hy.app.settle(60);
        }).then(function () {
          var p = hy.fp.api.pose(); if (!near(p.pitch, tv.topEl, 0.2)) throw new Error('南·塔顶 pitch ' + p.pitch);
          out.push('塔顶 ' + p.pitch.toFixed(1) + '°');
          hy.app.look('sun');
          return hy.app.settle(60);
        }).then(function () {
          var lk = hy.astro.look(hy.fp.cam.current.observer(), hy.astro.sunPos(hy.state.time.t, hy.model.P), hy.model.P), p = hy.fp.api.pose();
          var dy = Math.abs(((p.yaw - lk.az) % 360 + 540) % 360 - 180);
          if (dy > 0.2 || !near(p.pitch, Math.min(89, lk.el), 0.2)) throw new Error('看太阳偏 ' + dy.toFixed(2) + '°');
          out.push('太阳 ' + lk.el.toFixed(1) + '°');
          return out.join('，');
        });
      });
    });
  });
  C.add(GROUP, '同一时刻改地点再“看太阳”：按新地点转（瞬移先生效）', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H();
      hy.app.setSite('zuiyu'); hy.app.setTime(3.3);
      return hy.app.settle(4).then(function () {
        hy.app.setSite({ s: 5600, az: 25 });
        hy.fp.api.lookPreset('sun', { instant: true });
        return hy.app.settle(2);
      }).then(function () {
        var P = hy.model.P, O = hy.fp.cam.current.observer(), lk = hy.astro.look(O, hy.astro.sunPos(hy.state.time.t, P), P), p = hy.fp.api.pose();
        if (Math.abs(p.s - 5600) > 0.5) throw new Error('没有瞬移过去：s＝' + p.s.toFixed(2));
        var dy = Math.abs(((p.yaw - lk.az) % 360 + 540) % 360 - 180), dp = p.pitch - Math.max(-89, Math.min(89, lk.el));
        if (dy > 0.2 || Math.abs(dp) > 0.2) throw new Error('偏 ' + dy.toFixed(2) + '°（方位）、' + dp.toFixed(2) + '°（仰角）');
        hy.app.setSite('zuiyu');
        return hy.app.settle(2).then(function () { return '涅赫莱恩：太阳方位 ' + lk.az.toFixed(1) + '°、仰角 ' + lk.el.toFixed(1) + '°'; });
      });
    });
  });
  C.add(GROUP, '按住 W 一秒走 1.4 m 上下（随地形减速）', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H(), cam = hy.fp.cam.current, w0 = cam.posW();
      hy.app.look(90, 0);
      key('keydown', 'KeyW');
      return hy.app.settle(60).then(function () {
        key('keyup', 'KeyW');
        var w1 = cam.posW(), d = Math.sqrt(Math.pow(w1[0] - w0[0], 2) + Math.pow(w1[1] - w0[1], 2) + Math.pow(w1[2] - w0[2], 2)) * 1000;
        if (!(d > 0.5 && d < 1.6)) throw new Error('走了 ' + d.toFixed(2) + ' m');
        return d.toFixed(2) + ' m';
      });
    });
  });
  C.add(GROUP, '拖动画面转头（画面跟手）', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H(), cv = hy.gfx && hy.gfx.canvas || G.document.getElementById('gl'), r = cv.getBoundingClientRect();
      hy.app.look(0, 0, 55);
      return hy.app.settle(2).then(function () {
        var y0 = hy.fp.api.pose().yaw, px = r.height * 10 / hy.fp.cam.current.look().fovEff;
        function pe(type, x) { cv.dispatchEvent(new G.PointerEvent(type, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: r.top + r.height / 2, bubbles: true })); }
        pe('pointerdown', r.left + r.width / 2 + px); pe('pointermove', r.left + r.width / 2); pe('pointerup', r.left + r.width / 2);
        return hy.app.settle(2).then(function () {
          var dy = hy.fp.api.pose().yaw - y0;
          if (!near(dy, 10, 0.5)) throw new Error('转了 ' + dy.toFixed(2) + '°');
          return '往左拖 ' + px.toFixed(0) + ' 像素 → 右转 ' + dy.toFixed(1) + '°';
        });
      });
    });
  });
  C.add(GROUP, '天体 uniform 与 HY.astro 一致（日月 CM 坐标、uMoonE0）', function () {
    return enter().then(function (skip) {
      var hy = H(), wasPlaying = hy.state.time.playing;
      // 先停住时间再跑一帧：交给 GPU 的值就是此刻 t 的值
      if (!skip && wasPlaying) hy.store.set('time.playing', false, 'api');
      return (skip ? Promise.resolve() : hy.app.settle(1)).then(function () {
        var P = hy.model.P, t = hy.state.time.t, cam = hy.fp.cam.current;
        var lam = cam ? cam.lam() : 0, X = cam ? cam.posW() : [hy.model.O.x, hy.model.O.y, hy.model.O.z];
        var u = hy.fp.cel.compute(P, t, lam, hy.state.fp, X), s = hy.fp.cel.toCM(hy.astro.sunPos(t, P), lam), m = hy.fp.cel.toCM(hy.astro.moonPos(t, P), lam);
        if (Math.abs(u.uSunW[0] - Math.fround(s[0])) > 0 || Math.abs(u.uSunW[2] - Math.fround(s[2])) > 0) throw new Error('uSunW 不对');
        var res = skip ? skip + '；' : '';
        // 真正交给 GPU 的值（fp.js 每帧用 HY.fp.apply 写进去的）＝fround(toCM(HY.astro))
        var gu = !skip && hy.fp.uniformValues ? hy.fp.uniformValues(['uSunW', 'uMoonW', 'uLamCam']) : null;
        if (gu && gu.uSunW && gu.uMoonW) {
          var ds = 0, dm = 0;
          for (var k = 0; k < 3; k++) { ds = Math.max(ds, Math.abs(gu.uSunW[k] - Math.fround(s[k]))); dm = Math.max(dm, Math.abs(gu.uMoonW[k] - Math.fround(m[k]))); }
          var dl = Math.abs(((gu.uLamCam - lam) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
          if (ds > 1e-3 || dm > 1e-3 || dl > 1e-6) throw new Error('GPU 上的 uSunW／uMoonW／uLamCam 与 HY.astro 不符：差 ' + (ds * 1000).toFixed(2) + ' m、' + (dm * 1000).toFixed(2) + ' m、' + dl.toExponential(1) + ' rad');
          res += 'GPU 上的日月位置＝fround(toCM(HY.astro))（差 ' + (Math.max(ds, dm) * 1000).toFixed(2) + ' m）；';
        }
        return res + 'uSunW＝(' + u.uSunW.map(function (v) { return v.toFixed(1); }).join(', ') + ')';
      }).then(function (r) {
        if (wasPlaying) hy.store.set('time.playing', true, 'api');
        return r;
      }, function (e) {
        if (wasPlaying) hy.store.set('time.playing', true, 'api');
        throw e;
      });
    });
  });
  C.add(GROUP, '回到总览：输入撤下', function () {
    return enter().then(function (skip) {
      if (skip) return skip;
      var hy = H();
      return hy.app.view('ov').then(function () {
        entered = null;
        if (hy.fp.ctl.attached()) throw new Error('HY.fp.ctl 还挂着');
        return true;
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── E 路：第一人称·管线（组名“第一人称·管线”；只在本块里增删） ─────────
 * 02 第十八节 GPU 表：编译、无 GL 报错、无 NaN、弦表读回、日面露出、照度（晴、子夜、真空、厚云盖）、黑月、塔、静滞夜幕、换档、bench。
 * 各项自己设场景，最后一项把动过的参数恢复默认。读数一律取绝对量（readPx 已除以曝光；Eh 来自眼 pass），与人眼适应快慢无关。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·管线';
  function H() { return G.HY; }
  var entered = null, t0 = 0;
  function enter() {
    var hy = H();
    if (entered && hy.app.active && hy.app.active() === 'fp') return entered;
    var sup = hy.fp.supported();
    if (!sup.ok) { entered = Promise.resolve('跳过：' + sup.reason); return entered; }
    t0 = G.performance.now();
    entered = hy.app.view('fp').then(function () { return hy.fp.status().phase === 'ready' ? '' : '跳过：第一人称没就绪（' + hy.fp.status().reason + '）'; },
      function (e) { return '跳过：' + (e && e.message || e); });
    return entered;
  }
  function with_(fn) { return function () { return enter().then(function (skip) { return skip ? skip : fn(H()); }); }; }
  // 设场景：site、time（t 或 {year, wd, hour}）、params、look:[yaw, pitch, fov]；n 帧后返回
  function scene(hy, o, n) {
    if (o.site) hy.app.setSite(o.site);
    if (o.time != null) hy.app.setTime(o.time);
    if (o.params) Object.keys(o.params).forEach(function (k) { hy.app.setParam(k, o.params[k]); });
    if (o.look) hy.app.look(o.look[0], o.look[1], o.look[2]);
    return hy.app.settle(n || 30);
  }
  function eh(hy) { return hy.fp.Eh(); }
  function lum(L) { return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]; }
  var TOUCHED = ['fp.cloud.on', 'fp.atmo.on', 'fp.set.veil', 'fp.set.veilK', 'fp.quality', 'fp.ground.mode', 'fp.eyeo.auto', 'fp.eyeo.evLock', 'fp.fov'];
  // 内部分辨率上 (fx, fy) 像素的视线（CM）与它撞塔的距离（没撞返回 Infinity）
  function rayAt(hy, fx, fy) {
    var d = hy.fp.debug(), u = hy.fp.uniformValues(['uCamW', 'uCamFwd', 'uCamRight', 'uCamUp', 'uTanHalfFov', 'uA']);
    var x = Math.round(fx * (d.W - 1)) + 0.5, y = Math.round(fy * (d.H - 1)) + 0.5, nx = (2 * x - d.W) / d.H, ny = (2 * y - d.H) / d.H, v = [0, 0, 0], k;
    for (k = 0; k < 3; k++) v[k] = u.uCamFwd[k] + u.uTanHalfFov * (nx * u.uCamRight[k] + ny * u.uCamUp[k]);
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); v = v.map(function (q) { return q / l; });
    var o = u.uCamW, A = v[0] * v[0] + v[2] * v[2], B = o[0] * v[0] + o[2] * v[2], cr = o[0] * v[2] - o[2] * v[0], D = A * u.uA * u.uA - cr * cr;
    if (A < 1e-14 || B >= 0 || D < 0) return Infinity;
    var t = (-B - Math.sqrt(D)) / A; return t > 0 ? t : Infinity;
  }

  C.add(GROUP, '进第一人称：“低”档程序全部编完、首帧就绪', with_(function (hy) {
    var d = hy.fp.debug(), cs = d.compile;
    if (cs.error) throw new Error(cs.error);
    return '用时 ' + ((G.performance.now() - t0) / 1000).toFixed(1) + ' s，档位 ' + d.tier + '，内部 ' + d.W + '×' + d.H;
  }));

  C.add(GROUP, '没有 GL 报错、画面没有 NaN／Inf（罪域昼夜、开关云与大气、圣禁城）', with_(function (hy) {
    var gl = hy.gfx.gl, bad = [], cases = [
      { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 12 }, params: { 'fp.cloud.on': true, 'fp.atmo.on': true }, look: [0, 20, 70] },
      { time: { year: 10018, wd: 1, hour: 0 }, look: [180, 60, 90] },
      { params: { 'fp.cloud.on': false }, look: [90, 85, 90] },
      { params: { 'fp.atmo.on': false }, look: [0, 30, 70] },
      { site: 'shengjin', params: { 'fp.atmo.on': true }, time: { year: 10018, wd: 200, hour: 15 }, look: [0, 40, 70] }
    ];
    gl.getError();
    return cases.reduce(function (p, c, k) {
      return p.then(function () { return scene(hy, c, 12); }).then(function () {
        var e = gl.getError(); if (e) bad.push('场景 ' + k + ' GL 错误 0x' + e.toString(16));
        for (var j = 0; j <= 8; j++) for (var i = 0; i <= 8; i++) {
          var r = hy.fp.readPxRGB(i / 8, j / 8);
          if (!r || !isFinite(r.L[0] + r.L[1] + r.L[2]) || !(r.L[1] >= 0)) { bad.push('场景 ' + k + ' (' + i + ',' + j + ')'); return; }
        }
      });
    }, Promise.resolve()).then(function () {
      if (bad.length) throw new Error(bad.slice(0, 4).join('；'));
      return cases.length + ' 个场景各 81 点';
    });
  }));

  C.add(GROUP, '弦表读回与 CPU 积分一致（< 1%，16F 时 < 3%）', with_(function (hy) {
    var g = hy.fp._graph(), U = hy.fp.uniformValues(['uR', 'uZtop', 'uHR', 'uHM', 'uBetaR', 'uBetaMs', 'uBetaMa']);
    var R = U.uR, Z = U.uZtop, BR = U.uBetaR, BM = U.uBetaMs + U.uBetaMa, worst = 0;
    function cell(al, z) {
      var b = R * Math.cos(al), xR = R * Math.sin(al), xz = Math.sqrt(Math.max(xR * xR - z * (2 * R - z), 0)), span = z * (2 * R - z) / Math.max(xR + xz, 1e-6), tau = 0;
      for (var i = 0; i < 2000; i++) {
        var s0 = i / 2000, s1 = (i + 1) / 2000, sm = 0.5 * (s0 + s1), dx = span * ((1 - s0) * (1 - s0) - (1 - s1) * (1 - s1)), dxR = span * (1 - sm) * (1 - sm), x = xR - dxR;
        var zz = dxR * (xR + x) / (R + Math.sqrt(b * b + x * x)); tau += (BR[1] * Math.exp(-zz / U.uHR) + BM * Math.exp(-zz / U.uHM)) * dx;
      }
      return tau;
    }
    var lin = hy.gfx.caps.floatLinear, tol = lin ? 0.01 : 0.03;
    [[255, 127], [128, 64], [10, 100], [3, 127], [200, 20], [60, 127]].forEach(function (q) {
      var u = q[0] / 255, v = q[1] / 127, al = u * u * 0.5 * Math.PI, zmax = Math.min(Z, 2 * R * Math.pow(Math.sin(0.5 * al), 2)), z = v * v * zmax;
      var gpu = g.readTexel('tTau', 0, q[0], q[1])[1], cpu = cell(al, z);
      if (cpu > 1e-4) worst = Math.max(worst, Math.abs(gpu - cpu) / cpu);
    });
    if (!(worst < tol)) throw new Error('最大相对差 ' + (worst * 100).toFixed(2) + '%');
    return '最大相对差 ' + (worst * 100).toFixed(3) + '%（' + (lin ? '32F' : '16F') + '）';
  }));

  C.add(GROUP, '日面露出：眼 pass 的到眼日照 ÷ 大气外日照 与 HY.astro 的露出比例相差 < 0.02（大气关）', with_(function (hy) {
    var P = hy.model.P, A = hy.astro;
    hy.app.setSite('zuiyu'); hy.app.setParam('fp.atmo.on', false); hy.app.setParam('fp.cloud.on', false);
    // 从此刻往后扫两天，挑日面被塔缘切着（露出 0.05–0.95）的 10 个时刻
    var O = A.site(hy.state.site.s, hy.state.site.az, P), tA = hy.state.time.t, ts = [], k;
    for (k = 0; k < 1440 * 2 && ts.length < 10; k += 1) { var t = tA + k / 1440, v = A.look(O, A.sunPos(t, P), P).vis; if (v > 0.05 && v < 0.95) { ts.push(t); k += 2; } }
    if (ts.length < 4) { hy.app.setParam('fp.atmo.on', true); return '跳过：两天里没找到塔缘切日的时刻'; }
    var worst = 0, out = [], lumSun = lum([1.104, 0.978, 0.919]);
    return ts.reduce(function (p, t) {
      return p.then(function () { hy.app.setTime(t); return hy.app.settle(3); }).then(function () {
        var cam = hy.fp.cam.current, Ob = cam.observer(), S = A.sunPos(t, P), X = cam.posW();
        var d = Math.sqrt(Math.pow(S.x - X[0], 2) + Math.pow(S.y - X[1], 2) + Math.pow(S.z - X[2], 2));
        var e = hy.fp._graph().readEyeSync(), Eeye = e[2] * 1000, E0 = P.Eref * Math.pow(P.Dref / d, 2) * lumSun;
        var vis = A.look(Ob, S, P).vis, ecl = A.eclipseFrac(Ob, t, P) || 0, meas = Eeye / (E0 * (1 - ecl));
        worst = Math.max(worst, Math.abs(meas - vis)); out.push(vis.toFixed(2) + '/' + meas.toFixed(2));
      });
    }, Promise.resolve()).then(function () {
      hy.app.setParam('fp.atmo.on', true);
      if (!(worst < 0.02)) throw new Error('最大差 ' + worst.toFixed(3) + '（astro/实测：' + out.join(' ') + '）');
      return ts.length + ' 个时刻，最大差 ' + worst.toFixed(4);
    });
  }));

  // 02 第十八节原文：合成 pass 的日面覆盖率。望远 5°、固定 EV 20（日面不被 6×10⁴ 截断）、大气与云关，把 tHDR 里日面周围一块的亮度
  // 按像素立体角积分成照度 E，除以大气外日照 E0 得到“露出的光通量比”。合成画的日面带临边昏暗，塔缘切掉的是暗的边，光通量比
  // 小于面积比；所以另在 CPU 上把日面按角度细分，逐点做同样的“塔在前还是日在前”判断，得到面积比 A 与光通量比 F：
  //   覆盖率＝(E/E0)·A/F 与 HY.astro 的露出比例比（＜0.02）；顺带断言 E/E0 与 F 相差＜0.02（合成 pass 本身的日面与塔）
  C.add(GROUP, '日面露出：合成 pass 的日面覆盖率与 HY.astro 的露出比例相差 < 0.02（罪域，塔缘切日的时刻）', with_(function (hy) {
    var P = hy.model.P, A = hy.astro;
    hy.app.setSite('zuiyu'); hy.app.setParam('fp.atmo.on', false); hy.app.setParam('fp.cloud.on', false);
    hy.app.setParam('fp.eyeo.auto', false); hy.app.setParam('fp.eyeo.evLock', 20);
    var O = A.site(hy.state.site.s, hy.state.site.az, P), tA = hy.state.time.t, ts = [], k;
    for (k = 0; k < 1440 * 2 && ts.length < 10; k += 1) { var t = tA + k / 1440, v = A.look(O, A.sunPos(t, P), P).vis; if (v > 0.05 && v < 0.95) { ts.push(t); k += 2; } }
    function restore() { hy.app.setParam('fp.atmo.on', true); hy.app.setParam('fp.eyeo.auto', true); hy.app.setParam('fp.eyeo.evLock', 12); hy.app.look(null, null, 55); }
    if (ts.length < 4) { restore(); return '跳过：两天里没找到塔缘切日的时刻'; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function nrm(a) { var l = Math.sqrt(dot(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    // CPU：日面上 N×N 个方向，塔（无限长圆柱，半径 uA）先挡住就不算；L(μ) 按 sunDisk 的临边昏暗（按亮度）
    function disk(C, S, rho, a) {
      var D = sub(S, C), dist = Math.sqrt(dot(D, D)), s0 = nrm(D), e1 = nrm(cross(s0, Math.abs(s0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(s0, e1);
      var beta = Math.asin(rho / dist), N = 160, nA = 0, nV = 0, fA = 0, fV = 0, u = [0.55, 0.70, 0.85];
      for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
        var x = ((i + 0.5) / N * 2 - 1) * beta, y = ((j + 0.5) / N * 2 - 1) * beta, dd = nrm([s0[0] + Math.tan(x) * e1[0] + Math.tan(y) * e2[0], s0[1] + Math.tan(x) * e1[1] + Math.tan(y) * e2[1], s0[2] + Math.tan(x) * e1[2] + Math.tan(y) * e2[2]]);
        var oc = sub(C, S), b = dot(oc, dd), c = dot(oc, oc) - rho * rho, Dq = b * b - c; if (Dq < 0) continue;
        var tS = -b - Math.sqrt(Dq), H = [C[0] + dd[0] * tS - S[0], C[1] + dd[1] * tS - S[1], C[2] + dd[2] * tS - S[2]], mu = Math.max(-dot(nrm(H), dd), 0);
        var Lm = lum(u.map(function (q) { return (1 - q * (1 - mu)) / (1 - q / 3); }));
        nA++; fA += Lm;
        var A2 = dd[0] * dd[0] + dd[2] * dd[2], B = C[0] * dd[0] + C[2] * dd[2], cr = C[0] * dd[2] - C[2] * dd[0], Dt = A2 * a * a - cr * cr, tT = Infinity;
        if (A2 > 1e-14 && B < 0 && Dt >= 0) { var tt = (-B - Math.sqrt(Dt)) / A2; if (tt > 0) tT = tt; }
        if (tT < tS) continue;
        nV++; fV += Lm;
      }
      return { A: nV / nA, F: fV / fA, dist: dist };
    }
    var worst = 0, worstF = 0, out = [], lumSun = lum([1.104, 0.978, 0.919]);
    return ts.reduce(function (p, t) {
      return p.then(function () { hy.app.setTime(t); hy.app.look(null, null, 5); hy.fp.api.lookPreset('sun', { instant: true }); return hy.app.settle(4); }).then(function () {
        var cam = hy.fp.cam.current, Ob = cam.observer(), S = A.sunPos(t, P);
        var g = hy.fp._graph(), d = hy.fp.debug(), u = hy.fp.uniformValues(['uTanHalfFov', 'uCamW', 'uSunW', 'uSunRho', 'uA']), th = u.uTanHalfFov;
        var ref = disk(u.uCamW, u.uSunW, u.uSunRho, u.uA);
        var rPx = Math.atan(u.uSunRho / ref.dist) / Math.atan(th) * d.H / 2, half = Math.ceil(2 * rPx + 6);
        var x0 = Math.max(0, Math.round(d.W / 2) - half), y0 = Math.max(0, Math.round(d.H / 2) - half), w = Math.min(d.W - x0, 2 * half), h = Math.min(d.H - y0, 2 * half);
        var px = g.readRegion('tHDR', 0, x0, y0, w, h), expo = g.readPx(0.5, 0.5).expo, E = 0, s = 2 * th / d.H;
        for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
          var q = 4 * (j * w + i), nx = (2 * (x0 + i + 0.5) - d.W) / d.H * th, ny = (2 * (y0 + j + 0.5) - d.H) / d.H * th;
          E += lum([px[q], px[q + 1], px[q + 2]]) / expo * 1000 * s * s / Math.pow(1 + nx * nx + ny * ny, 1.5);   // cd/m² × sr＝lux
        }
        var E0 = P.Eref * Math.pow(P.Dref / ref.dist, 2) * lumSun, vis = A.look(Ob, S, P).vis, ecl = A.eclipseFrac(Ob, t, P) || 0;   // P.Eref 以 lux 计
        var flux = E / (E0 * (1 - ecl)), cover = ref.F > 1e-6 ? flux * ref.A / ref.F : 0;
        worst = Math.max(worst, Math.abs(cover - vis)); worstF = Math.max(worstF, Math.abs(flux - ref.F));
        out.push(vis.toFixed(2) + '/' + cover.toFixed(3));
      });
    }, Promise.resolve()).then(function () {
      restore();
      var s2 = ts.length + ' 个时刻，覆盖率最大差 ' + worst.toFixed(4) + '，光通量与 CPU 逐点最大差 ' + worstF.toFixed(4) + '（astro/实测：' + out.slice(0, 5).join(' ') + ' …）';
      if (!(worst < 0.02 && worstF < 0.02)) throw new Error(s2);
      return s2;
    }, function (e) { restore(); throw e; });
  }));

  C.add(GROUP, '照度：罪域入冬正午 35–65 klux；子夜在对岸光上限的 0.6–1.1 倍；真空子夜 0.8–1.2 倍（云关；上限按世界底图的平均反照率算）', with_(function (hy) {
    var P = hy.model.P, out = [], errs = [];
    // 01 的 farLight 默认对岸反照率 0.30（含云）；渲染器的对面内壁用世界底图 tWorld（F 路烘焙），这里按它的平均反照率算上限
    var alb = P.albedoFar, wr = hy.fp._graph().readRegion('tWorld', 0, 0, 0, 2048, 1024);
    if (wr) { var sm = 0, n = 0; for (var q = 0; q < wr.length; q += 4 * 37) { sm += 0.2126 * wr[q] + 0.7152 * wr[q + 1] + 0.0722 * wr[q + 2]; n++; } alb = sm / n; }
    out.push('底图平均反照率 ' + alb.toFixed(3) + '（01 取 ' + P.albedoFar + '）');
    function far() { var O = hy.fp.cam.current.observer(); return hy.astro.farLight(O, O.U, hy.state.time.t, P, { nTheta: 24, nPhi: 48, albedo: alb }); }
    return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 12 }, params: { 'fp.cloud.on': false, 'fp.atmo.on': true } }, 30).then(function () {
      var e = eh(hy); out.push('正午 ' + (e / 1000).toFixed(1) + ' klux'); if (!(e > 35e3 && e < 65e3)) errs.push('正午 ' + Math.round(e));
      return scene(hy, { time: { year: 10018, wd: 1, hour: 0 } }, 40);
    }).then(function () {
      var e = eh(hy), f = far(); out.push('子夜 ' + Math.round(e) + ' lux ÷ 上限 ' + Math.round(f) + ' = ' + (e / f).toFixed(2)); if (!(e / f > 0.6 && e / f < 1.1)) errs.push('子夜 ' + (e / f).toFixed(2));
      return scene(hy, { params: { 'fp.atmo.on': false } }, 40);
    }).then(function () {
      // 阶地模式下对面内壁按“踏面＋崖面”两朵微面着色（F 路 shade_wall），比光滑球面暗两成上下；断言按斜坡模式，阶地只记录
      var e = eh(hy), f = far(); out.push('真空子夜（阶地）' + (e / f).toFixed(2));
      return scene(hy, { params: { 'fp.ground.mode': 'slope' } }, 40);
    }).then(function () {
      var e = eh(hy), f = far(); out.push('真空子夜（斜坡）' + (e / f).toFixed(2)); if (!(e / f > 0.8 && e / f < 1.2)) errs.push('真空子夜（斜坡）' + (e / f).toFixed(2));
      hy.app.setParam('fp.ground.mode', 'terrace'); hy.app.setParam('fp.atmo.on', true);
      if (errs.length) throw new Error(errs.join('；') + '（' + out.join('，') + '）');
      return out.join('，');
    });
  }));

  C.add(GROUP, '罪域厚云盖：正午云下 5–15 klux（02：8–10），子夜为晴夜的 5%–35%', with_(function (hy) {
    var a, b, c;
    return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 294, hour: 12.5 }, params: { 'fp.cloud.on': true, 'fp.atmo.on': true } }, 40).then(function () {
      a = eh(hy); return scene(hy, { time: { year: 10018, wd: 294, hour: 0 } }, 40);
    }).then(function () {
      b = eh(hy); return scene(hy, { params: { 'fp.cloud.on': false } }, 40);
    }).then(function () {
      c = eh(hy); hy.app.setParam('fp.cloud.on', true);
      var s = '正午 ' + (a / 1000).toFixed(1) + ' klux，子夜 ' + Math.round(b) + ' lux（晴夜 ' + Math.round(c) + '，比 ' + (b / c).toFixed(2) + '）';
      if (!(a > 5e3 && a < 15e3) || !(b / c > 0.05 && b / c < 0.35)) throw new Error(s);
      return s;
    });
  }));

  C.add(GROUP, '静滞夜幕（设定）：开 0.3 /千公里后罪域晴夜压到几百勒克斯，关掉恢复白夜', with_(function (hy) {
    var a, b;
    return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 0 }, params: { 'fp.cloud.on': false, 'fp.set.veil': false } }, 30).then(function () {
      a = eh(hy); return scene(hy, { params: { 'fp.set.veil': true, 'fp.set.veilK': 0.3 } }, 40);
    }).then(function () {
      b = eh(hy); hy.app.setParam('fp.set.veil', false);
      var s = '白夜 ' + Math.round(a) + ' lux → 夜幕 ' + Math.round(b) + ' lux';
      if (!(b < a / 5 && b > 20 && b < 3000)) throw new Error(s);
      return s;
    });
  }));

  C.add(GROUP, '黑月：庆典夜罪域，月面／背后对岸＝10%–30%（云关）', with_(function (hy) {
    var P = hy.model.P, A = hy.astro;
    hy.app.setSite('zuiyu'); hy.app.setParam('fp.cloud.on', false);
    // 入冬交节（t＝0）前夜：找黑月高悬的时刻（01 第九节：罪域庆典夜 22 时）
    var O = A.site(hy.state.site.s, hy.state.site.az, P), t = null;
    for (var k = 0; k < 24 * 12 && t == null; k++) { var tt = -0.5 + k / 288; if (A.blackMoonHigh(O, tt, P)) t = tt; }
    if (t == null) return '跳过：交节前后半日内罪域没有黑月高悬';
    hy.app.setTime(t + 0.01);
    var lk = A.look(O, A.moonPos(hy.state.time.t, P), P);
    hy.app.look(null, null, Math.max(3 * lk.diam, 4)); hy.fp.api.lookPreset('moon', { instant: true });   // 先定视角再转（look 会取消还没执行的朝向快捷）
    return hy.app.settle(30).then(function () {
      var fov = hy.fp.cam.current.look().fovEff, frac = lk.diam / fov, d = hy.fp.debug(), asp = d.H / d.W;
      var c = hy.fp.readPxRGB(0.5, 0.5), mc = lum(c.L), bgs = [], Mo = A.moonPos(hy.state.time.t, P), X = hy.fp.cam.current.posW();
      var dM = Math.sqrt(Math.pow(Mo.x - X[0], 2) + Math.pow(Mo.y - X[1], 2) + Math.pow(Mo.z - X[2], 2));
      var pz = hy.fp.api.pose(), lk2 = A.look(hy.fp.cam.current.observer(), Mo, P);
      if (Math.abs(((pz.yaw - lk2.az) % 360 + 540) % 360 - 180) > 0.5 || Math.abs(pz.pitch - lk2.el) > 0.5) throw new Error('没对准月亮（朝向 ' + pz.yaw.toFixed(1) + '/' + pz.pitch.toFixed(1) + '，月 ' + lk2.az.toFixed(1) + '/' + lk2.el.toFixed(1) + '）');
      [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]].forEach(function (q) {
        var r = hy.fp.readPxRGB(0.5 + q[0] * frac * asp, 0.5 + q[1] * frac); if (r && r.dist > dM + P.rhoM * 2) bgs.push(lum(r.L));   // 月盘以外、比月远的（塔或对岸）
      });
      hy.app.look(null, null, 55);
      if (!bgs.length) return '跳过：月盘四周都不是对岸';
      var bg = bgs.reduce(function (a, b) { return a + b; }, 0) / bgs.length;   // 月盘四周（1.8 个半径处）的平均
      var ratio = mc / bg, s = A.moonState(hy.state.time.t, P) + '，月面 ' + Math.round(mc) + ' cd/m²，背后 ' + Math.round(bg) + ' cd/m²（' + bgs.length + ' 点平均），比 ' + (ratio * 100).toFixed(1) + '%（01 的估算 635/3500＝18%）';
      if (!(ratio > 0.1 && ratio < 0.3)) throw new Error(s);
      return s;
    });
  }));

  C.add(GROUP, '塔：罪域子夜北天仰角 70° 塔带比旁边暗 ≥5 倍，正午 ≤2 倍（H＝40，云关）', with_(function (hy) {
    function band() {
      var tower = [], sky = [], m = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
      for (var i = 0; i <= 60; i++) {
        var f = i / 60, r = hy.fp.readPxRGB(f, 0.5); if (!r) continue;
        var tT = rayAt(hy, f, 0.5);
        if (isFinite(tT) && Math.abs(r.dist - tT) < 0.01 * tT) tower.push(lum(r.L));
        else if (!isFinite(tT) && r.dist > 3000) sky.push(lum(r.L));
      }
      return tower.length && sky.length ? { k: m(sky) / m(tower), n: tower.length + '/' + sky.length } : null;
    }
    var a, b;
    return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 0 }, params: { 'fp.cloud.on': false, 'fp.atmo.on': true }, look: [0, 70, 50] }, 30).then(function () {
      a = band(); return scene(hy, { time: { year: 10018, wd: 1, hour: 12 } }, 30);
    }).then(function () {
      b = band(); hy.app.setParam('fp.cloud.on', true);
      if (!a || !b) throw new Error('沿水平线找不到塔带或旁边的天（地形挡住了视线？）');
      var s = '子夜 ' + a.k.toFixed(1) + ' 倍（' + a.n + '），正午 ' + b.k.toFixed(2) + ' 倍';
      if (!(a.k >= 5 && b.k <= 2)) throw new Error(s);
      return s;
    });
  }));

  C.add(GROUP, '换档：中→高→拍照→低逐档编译、出图无报错', with_(function (hy) {
    var out = [], gl = hy.gfx.gl;
    return ['mid', 'high', 'photo', 'low'].reduce(function (p, tier) {
      return p.then(function () {
        hy.app.quality(tier);
        var n = 0;
        // 每轮回一次事件循环：并行编译的完成状态要回到事件循环才更新
        function wait() { return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return hy.app.settle(2); }).then(function () { n++; var cs = hy.fp.debug().compile; if (cs.error) throw new Error(cs.error); if (hy.fp.debug().tier !== tier && n < 600) return wait(); }); }
        return wait().then(function () {
          if (hy.fp.debug().tier !== tier) throw new Error(tier + ' 档没切过去');
          var e = gl.getError(); if (e) throw new Error(tier + ' 档 GL 错误 0x' + e.toString(16));
          var r = hy.fp.readPxRGB(0.5, 0.5); if (!r || !isFinite(lum(r.L))) throw new Error(tier + ' 档中心像素无效');
          out.push(tier + ' ' + hy.fp.debug().W + '×' + hy.fp.debug().H);
        });
      });
    }, Promise.resolve()).then(function () { return out.join('，'); });
  }));

  C.add(GROUP, 'bench：5 个机位各 60 帧的 GPU 毫秒（中档；只记录不断言）', with_(function (hy) {
    var R = hy.model.P.R, out = [], views = [
      { site: 'zuiyu', time: { year: 10018, wd: 294, hour: 12 }, params: { 'fp.cloud.on': true, 'fp.quality': 'mid' }, look: [0, 60, 55] },
      { site: 'zuiyu', look: [180, -5, 55] },
      { site: 'shengjin', time: { year: 10018, wd: 294, hour: 12 }, look: [0, 30, 55] },
      { site: 'shengjin', time: { year: 10018, wd: 294, hour: 0 }, look: [0, 60, 55] },
      { site: { s: R * Math.PI / 2 - 230, az: 0 }, look: [180, 0, 55] }
    ];
    // GPU 计时的结果要回到事件循环才拿得到：设好机位后让帧循环自己跑 1.5 秒再读。
    // 第一个机位把档位设回“中”：要等后台编完、真切过去再量（编译占着主线程与 GPU，计时会被污染）
    function tierReady(n) {
      if (hy.fp.debug().tier === 'mid' || n > 600) return Promise.resolve();
      return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return hy.app.settle(2); }).then(function () { return tierReady(n + 1); });
    }
    return views.reduce(function (p, v, k) {
      return p.then(function () { return scene(hy, v, 10); }).then(function () { return tierReady(0); }).then(function () { return new Promise(function (r) { setTimeout(r, 1500); }); }).then(function () {
        var g = hy.fp.gpuTimes(), tot = 0, top = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; }).slice(0, 3);
        for (var n in g) tot += g[n];
        out.push('机位 ' + (k + 1) + '：' + tot.toFixed(1) + ' ms（' + top.map(function (n) { return n + ' ' + g[n].toFixed(1); }).join('、') + '）');
      });
    }, Promise.resolve()).then(function () { return out.join('；') || '这台机器不支持 GPU 计时'; });
  }));

  C.add(GROUP, '收尾：动过的参数恢复默认', function () {
    var hy = H();
    TOUCHED.forEach(function (p) { var sp = hy.store.SCHEMA && hy.store.SCHEMA[p]; if (sp) hy.app.setParam(p, sp.def); });
    return true;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── F 路：第一人称·地面（组名“第一人称·地面”；只在本块里增删） ─────────
 * 高度图与脚下读回对 CPU 镜像；GPU 上的 altAt 对 CPU（探针着色器）；地形逐像素命中距离对 CPU 步进；整屏漏洞与假地面；
 * 相机低于内壁球面（深渊沟、洼地）仍有地面；实例层出图；世界底图；地平线角图。
 * 各项自己设场景，最后一项把动过的参数恢复默认。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·地面';
  function H() { return G.HY; }
  var entered = null;
  function enter() {
    var hy = H();
    if (entered && hy.app.active && hy.app.active() === 'fp') return entered;
    var sup = hy.fp.supported();
    if (!sup.ok) { entered = Promise.resolve('跳过：' + sup.reason); return entered; }
    entered = hy.app.view('fp').then(function () { return hy.fp.status().phase === 'ready' ? '' : '跳过：第一人称没就绪（' + hy.fp.status().reason + '）'; },
      function (e) { return '跳过：' + (e && e.message || e); });
    return entered;
  }
  function with_(fn) { return function () { return enter().then(function (skip) { return skip ? skip : fn(H()); }); }; }
  function scene(hy, o, n) {
    if (o.site) hy.app.setSite(o.site);
    if (o.time != null) hy.app.setTime(o.time);
    if (o.params) Object.keys(o.params).forEach(function (k) { hy.app.setParam(k, o.params[k]); });
    if (o.look) hy.app.look(o.look[0], o.look[1], o.look[2]);
    return hy.app.settle(n || 20);
  }
  function S(hy) { var v = hy.fp.uniformValues(), o = {}; for (var k in v) o[k] = v[k]; return o; }
  function tex(name) { var t = H().fp._graph().targets[name]; t = Array.isArray(t) ? t[0] : t; return t && t.texture; }
  // GPU 探针：在一个 64×1 的浮点目标上对给定的相对位移 v 求 altAt（与地形 pass 同一份 terrain_lib.glsl）
  var probe = null;
  function gpuAlt(hy, vs) {
    var THREE = G.THREE, R = hy.gfx.renderer, ps = hy.fp.passes;
    if (!probe) {
      var U = hy.fp.makeU(THREE); U.uProbeV = { value: [] }; for (var i = 0; i < 64; i++) U.uProbeV.value.push(new THREE.Vector3());
      var fsrc = hy.glsl.common + '\n' + hy.glsl.terrain_lib + '\nuniform vec3 uProbeV[64]; uniform float uPixF;\nlayout(location = 0) out vec4 oc;\n' +
        'void main(){ int i = int(gl_FragCoord.x); oc = vec4(altAt(uProbeV[i], max(length(uProbeV[i])*uPixF, 2e-4), 0), gU, gK, 1.0); }';
      var mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, defines: ps.definesFor(hy.fp.debug().tier), vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: fsrc, depthTest: false, depthWrite: false });
      var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      var mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; var sc = new THREE.Scene(); sc.add(mesh);
      probe = { U: U, sc: sc, cam: new THREE.Camera(), mat: mat, geo: geo,
        rt: new THREE.WebGLRenderTarget(64, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false }) };
    }
    hy.fp.apply(probe.U, hy.fp.uniformValues());
    probe.U.uHeight.value = tex('tHeight'); probe.U.uFoot.value = tex('tFoot');
    for (var j = 0; j < 64; j++) { var v = vs[j] || [0, 0, 0]; probe.U.uProbeV.value[j].set(v[0], v[1], v[2]); }
    R.setRenderTarget(probe.rt); R.render(probe.sc, probe.cam);
    var buf = new Float32Array(256); R.readRenderTargetPixels(probe.rt, 0, 0, 64, 1, buf); R.setRenderTarget(null);
    var out = []; for (var k = 0; k < vs.length; k++) out.push(buf[k * 4]); return out;
  }
  // 内部分辨率上 (px, py) 像素的视线（不含抖动）与 CPU 镜像步进的命中距离
  function rayOf(hy, Sx, px, py) {
    var d = hy.fp.debug(), nx = (2 * (px + 0.5) - d.W) / d.H, ny = (2 * (py + 0.5) - d.H) / d.H, v = [0, 0, 0];
    for (var k = 0; k < 3; k++) v[k] = Sx.uCamFwd[k] + Sx.uTanHalfFov * (nx * Sx.uCamRight[k] + ny * Sx.uCamUp[k]);
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cpuHit(g, Sx, d, tmax) {
    var t = 0;
    for (var i = 0; i < 200000; i++) { var a = g.altAt(Sx, [d[0] * t, d[1] * t, d[2] * t]); if (a < 0) return t; t += Math.max(a * 0.08, 5e-5); if (t > tmax) return -1; }
    return -2;
  }
  var TOUCHED = ['fp.cloud.on', 'fp.atmo.on', 'fp.ground.mode', 'fp.quality'];

  C.add(GROUP, '高度图读回与 CPU 镜像一致（float32 ＜2e-6，半精度逐位）', with_(function (hy) {
    var g = hy.fp._graph(), N = hy.fp.noise, d32 = 0, bad = 0, n = 0;
    for (var k = 0; k < 64; k++) {
      var i = (k * 137 + 11) % 1024, j = (k * 311 + 7) % 1024, a = g.readTexel('tHeight32', 0, i, j), b = g.readTexel('tHeight', 0, i, j);
      if (!a || !b) continue;
      var m = N.heightTexel(i, j, [0, 0, 0, 0]); n++;
      d32 = Math.max(d32, Math.abs(a[0] - N.h32(i, j)));
      if (b[0] !== m[0] || b[3] !== m[3]) bad++;
    }
    if (!n) throw new Error('读不回高度图');
    if (!(d32 < 2e-6)) throw new Error('float32 最大差 ' + d32.toExponential(2));
    var s = n + ' 个纹素，float32 最大差 ' + d32.toExponential(2) + '，半精度不同 ' + bad + ' 个（镜像按向零截断；' + N.HALF_ROUND + '）';
    if (bad > 2) throw new Error(s + '——这台 GPU 的半精度舍入方式可能不同，把 HY.fp.noise.HALF_ROUND 改成 nearest 再试');
    return s;
  }));

  C.add(GROUP, '脚下：tFoot 与镜像一致；GPU 上 alt(0)＝眼高（＜1 mm）', with_(function (hy) {
    var out = [];
    return ['terrace', 'slope'].reduce(function (p, mode) {
      return p.then(function () { return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 294, hour: 12 }, params: { 'fp.ground.mode': mode }, look: [0, 0, 55] }, 4); }).then(function () {
        var Sx = S(hy), F = hy.fp._graph().readTexel('tFoot', 0, 0, 0), Fj = hy.fp.ground.foot(Sx.uOrg, Sx.uAmpZone, Sx.uGroundMode);
        var dP = Math.abs(F[3] - Fj[3]), dF = Math.abs(F[0] - Fj[0]);
        if (!(dP < 3e-4 && dF < 3e-4)) throw new Error(mode + '：脚下与镜像差 P ' + (dP * 1000).toFixed(2) + ' m、d_f ' + (dF * 1000).toFixed(2) + ' m（允许 0.3 m）');
        var a0 = gpuAlt(hy, [[0, 0, 0]])[0];
        if (!(Math.abs(a0 - Sx.uCamAlt) < 1e-6)) throw new Error(mode + '：GPU alt(0)−眼高＝' + ((a0 - Sx.uCamAlt) * 1e6).toFixed(2) + ' mm');
        out.push(mode + ' alt(0)−眼高 ' + ((a0 - Sx.uCamAlt) * 1e6).toFixed(3) + ' mm，P 差 ' + (dP * 1000).toFixed(3) + ' m');
      });
    }, Promise.resolve()).then(function () { hy.app.setParam('fp.ground.mode', 'terrace'); return out.join('；'); });
  }));

  C.add(GROUP, 'GPU 的 altAt 与 CPU 镜像一致（罪域、圣禁城，两种地面，0.6 km 内各 60 点 ＜10 cm；CPU 碰撞只要 0.3 m）', with_(function (hy) {
    var out = [];
    return [['zuiyu', 'terrace'], ['zuiyu', 'slope'], ['shengjin', 'terrace']].reduce(function (p, c) {
      return p.then(function () { return scene(hy, { site: c[0], params: { 'fp.ground.mode': c[1] } }, 4); }).then(function () {
        var Sx = S(hy), g = hy.fp.ground, vs = [], seed = 7;
        function r() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
        for (var i = 0; i < 60; i++) { var v = g.groundPoint(Sx, [(r() - 0.5) * 0.8, (r() - 0.5) * 0.8]); var h = (r() - 0.5) * 0.004; vs.push([v[0] - h, v[1], v[2]]); }   // 0.6 km 内：足迹 < 2 m，GPU 用手工双线性
        // 崖带附近不比：蜿蜒、扶壁两层用硬件线性过滤（子纹素权重 8 位），崖线在 GPU 上有约 0.4 m 的小台阶，崖面又近乎竖直
        var gp = gpuAlt(hy, vs), worst = 0, used = 0;
        for (var k = 0; k < vs.length; k++) {
          var a = g.altAt(Sx, vs[k], Math.max(Math.sqrt(vs[k][0] * vs[k][0] + vs[k][1] * vs[k][1] + vs[k][2] * vs[k][2]) * Sx.uPixF, 2e-4), 0);
          if (Sx.uGroundMode === 1 && (g.last.U < Sx.uCliffC + 0.03 || g.last.U > 0.97)) continue;
          worst = Math.max(worst, Math.abs(gp[k] - a)); used++;
        }
        if (!(worst < 1e-4)) throw new Error(c.join('·') + '：' + used + ' 点最大差 ' + (worst * 1e5).toFixed(1) + ' cm');
        out.push(c.join('·') + ' ' + used + ' 点 ' + (worst * 1e5).toFixed(2) + ' cm');
      });
    }, Promise.resolve()).then(function () { hy.app.setParam('fp.ground.mode', 'terrace'); return out.join('，'); });
  }));

  C.add(GROUP, '逐像素求交：地形命中距离与 CPU 步进一致（罪域看北崖、看南阶沿；≥90% 像素差 ＜15%）', with_(function (hy) {
    var out = [], errs = [];
    return [[0, 10], [180, -3], [90, 0]].reduce(function (p, lk) {
      return p.then(function () { return scene(hy, { site: 'zuiyu', params: { 'fp.ground.mode': 'terrace', 'fp.cloud.on': false }, look: [lk[0], lk[1], 70] }, 6); }).then(function () {
        var Sx = S(hy), d = hy.fp.debug(), g = hy.fp._graph(), good = 0, tot = 0;
        for (var fx = 0.2; fx < 0.85; fx += 0.3) for (var fy = 0.3; fy < 0.9; fy += 0.04) {
          var px = Math.round(fx * (d.W - 1)), py = Math.round(fy * (d.H - 1)), s = g.readTexel('tSurf', 0, px, py)[3];
          var c = cpuHit(hy.fp.ground, Sx, rayOf(hy, Sx, px, py), 30); tot++;
          if ((s < 0 && (c < 0 || c > 20)) || (s >= 0 && c >= 0 && Math.abs(s - c) < Math.max(0.15 * c, 0.001)) || (s > 20 && c < 0)) good++;
        }
        out.push('朝 ' + lk[0] + '° ' + good + '/' + tot); if (good < 0.9 * tot) errs.push('朝 ' + lk[0] + '° 只有 ' + good + '/' + tot);
      });
    }, Promise.resolve()).then(function () { if (errs.length) throw new Error(errs.join('；') + '（' + out.join('，') + '）'); return out.join('，'); });
  }));

  // 漏洞（GPU 没命中、CPU 步进命中）与假地面（GPU 命中、CPU 30 km 内没有）：精级步数用尽时的三层处理（贴地、按宏观几何外推并验证、
  // 只信粗级的确认命中）把这两种都压到轮廓上的个别像素。斜坡平域一处洼地（相机低于球面）以前整片漏，阶沿外以前长一条假地面
  C.add(GROUP, '整屏扫描：漏洞与假地面都只在轮廓上零星出现（罪域看北崖、看南阶沿，圣禁城看南，斜坡平域洼地，沟壁）', with_(function (hy) {
    var out = [], errs = [];
    function fine(g, Sx, d, tmax) { var t = 0; for (var i = 0; i < 400000; i++) { var a = g.altAt(Sx, [d[0] * t, d[1] * t, d[2] * t]); if (a < 0) return t; t += Math.max(a * 0.08, 5e-5); if (t > tmax) return -1; } return -1; }
    var views = [['罪域北', 'zuiyu', 'terrace', 0, 2], ['罪域南', 'zuiyu', 'terrace', 180, -2], ['圣禁城南', 'shengjin', 'terrace', 180, -1],
      ['平域洼地·斜坡', { s: 5000, az: 10 }, 'slope', 60, 0], ['沟壁·斜坡', { s: Math.PI * hy.model.P.R / 2 - 150, az: 10 }, 'slope', 0, -10]];
    return views.reduce(function (p, v) {
      return p.then(function () { return scene(hy, { site: v[1], params: { 'fp.cloud.on': false, 'fp.ground.mode': v[2] }, look: [v[3], v[4], 70] }, 6); }).then(function () {
        var Sx = S(hy), d = hy.fp.debug(), g = hy.fp._graph(), holes = 0, falseHit = 0, tot = 0;
        for (var j = 0; j < 10; j++) for (var i = 0; i < 16; i++) {
          var px = Math.round((i + 0.5) / 16 * (d.W - 1)), py = Math.round((j + 0.5) / 10 * (d.H - 1)), s = g.readTexel('tSurf', 0, px, py)[3];
          var c = fine(hy.fp.ground, Sx, rayOf(hy, Sx, px, py), 30); tot++;
          if (s < 0 && c > 0) holes++; else if (s > 0 && c < 0 && s < 27) falseHit++;
        }
        var m = v[0] + ' 漏 ' + holes + '、假 ' + falseHit + '／' + tot;
        out.push(m); if (holes > 3 || falseHit > 4) errs.push(m);
      });
    }, Promise.resolve()).then(function () {
      hy.app.setParam('fp.ground.mode', 'terrace');
      if (errs.length) throw new Error(errs.join('；') + '（' + out.join('，') + '）');
      return out.join('，');
    });
  }));

  C.add(GROUP, '相机低于内壁球面（深渊沟壁上、洼地里）往下看仍有地面（地形远界用 tTerFar，不用 tWallCam）', with_(function (hy) {
    var out = [];
    return [[{ s: Math.PI * hy.model.P.R / 2 - 150, az: 10 }, 'slope', '沟壁'], [{ s: 5000, az: 10 }, 'slope', '平域洼地']].reduce(function (p, c) {
      return p.then(function () { return scene(hy, { site: c[0], params: { 'fp.cloud.on': false, 'fp.ground.mode': c[1] }, look: [60, -15, 60] }, 8); }).then(function () {
        var Sx = S(hy), d = hy.fp.debug(), g = hy.fp._graph(), hit = 0, tot = 0;
        for (var j = 0; j < 8; j++) for (var i = 0; i < 16; i++) {
          var px = Math.round((i + 0.5) / 16 * (d.W - 1)), py = Math.round((j + 0.5) / 20 * (d.H - 1)), s = g.readTexel('tSurf', 0, px, py)[3];
          tot++; if (s > 0) hit++;
        }
        var msg = c[2] + '（uCamZ ' + (Sx.uCamZ * 1000).toFixed(0) + ' m）下半屏 ' + hit + '/' + tot + ' 有地面';
        if (hit < 0.95 * tot) throw new Error(msg);
        out.push(msg);
      });
    }, Promise.resolve()).then(function () { hy.app.setParam('fp.ground.mode', 'terrace'); return out.join('；'); });
  }));

  C.add(GROUP, '实例层：中档建好、画进 tSurf（脚边有比地面更近的石头或草）', with_(function (hy) {
    hy.app.quality('mid');
    function wait(n) { return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return hy.app.settle(2); }).then(function () { if (hy.fp.debug().tier !== 'mid' && n < 400) return wait(n + 1); }); }
    return wait(0).then(function () { return scene(hy, { site: { s: 5000, az: 10 }, params: { 'fp.ground.mode': 'terrace' }, look: [60, -35, 60] }, 6); }).then(function () {
      var st = hy.fp.inst.stats(); if (!(st.instances > 1000 && st.meshes >= 4)) throw new Error('实例太少：' + JSON.stringify(st));
      var Sx = S(hy), d = hy.fp.debug(), g = hy.fp._graph(), nearer = 0, tot = 0;
      // 整合时加密到 36×18（原 16×12：通过时也只有 1/192 个采样碰上实例，三次里失败一次，属于采样太疏）
      for (var j = 0; j < 18; j++) for (var i = 0; i < 36; i++) {
        var px = Math.round((i + 0.5) / 36 * (d.W - 1)), py = Math.round((j + 0.5) / 36 * (d.H - 1)), s = g.readTexel('tSurf', 0, px, py)[3];
        var c = cpuHit(hy.fp.ground, Sx, rayOf(hy, Sx, px, py), 1); tot++;
        if (s > 0 && c > 0 && s < c - 0.0003) nearer++;
      }
      if (!nearer) throw new Error('下半屏 ' + tot + ' 个采样里没有一个比地面近（实例没画进去？）');
      return st.instances + ' 个实例、' + st.meshes + ' 个网格、约 ' + Math.round(st.tris / 1000) + 'k 三角；下半屏 ' + nearer + '/' + tot + ' 个采样被石头或草挡住';
    });
  }));

  C.add(GROUP, '世界底图：反照率、水面、深渊黑环、罪域赤褐', with_(function (hy) {
    var g = hy.fp._graph(), W = 2048, Hh = 1024, img = g.readRegion ? g.readRegion('tWorld', 0, 0, 0, W, Hh) : null;
    if (!img) return '跳过：读不回 tWorld';
    var sc = img[0] > 1.5 ? 255 : 1, sum = 0, n = 0, water = 0, eq = 0, ne = 0;
    for (var y = 0; y < Hh; y += 8) for (var x = 0; x < W; x += 8) {
      var o = (y * W + x) * 4, a = (0.2126 * img[o] + 0.7152 * img[o + 1] + 0.0722 * img[o + 2]) / sc;
      sum += a; n++; if (img[o + 3] / sc > 0.5) water++;
      if (Math.abs(y - Hh / 2) < 6) { eq += a; ne++; }
    }
    var mean = sum / n, wf = water / n, eqm = eq / Math.max(ne, 1);
    var s = '平均反照率 ' + mean.toFixed(3) + '，水面 ' + (wf * 100).toFixed(1) + '%，赤道带 ' + eqm.toFixed(3);
    if (!(mean > 0.06 && mean < 0.4) || !(wf > 0.02 && wf < 0.5) || !(eqm < 0.05)) throw new Error(s);
    return s;
  }));

  C.add(GROUP, '地平线角图：各级有效、与 CPU 沿日光步进的净空角一致（相机处，±0.02 rad）', with_(function (hy) {
    return scene(hy, { site: 'zuiyu', time: { year: 10018, wd: 294, hour: 15 }, params: { 'fp.ground.mode': 'terrace' }, look: [0, 0, 55] }, 12).then(function () {
      var Sx = S(hy), lv = Sx.uHzLvl, ok = lv.filter(function (l) { return l[3] > 0.5; }).length;
      if (!ok) throw new Error('uHzLvl 没有有效级');
      var g = hy.fp._graph(), sz = g.specs && g.specs.tHorizon ? g.specs.tHorizon.w : 256, L = lv[0];
      var px = Math.round(((0 - L[0]) / L[2] * 0.5 + 0.5) * sz - 0.5), py = Math.round(((0 - L[1]) / L[2] * 0.5 + 0.5) * sz - 0.5);
      var hz = g.readTexel('tHorizon', 0, px, py);
      // CPU：同一个地面点（相机脚下，抬高 0.5 m）沿日光 32 步几何分布，取 min(alt/s)
      var gr = hy.fp.ground, X = Sx.uCamW, l = [Sx.uSunW[0] - X[0], Sx.uSunW[1] - X[1], Sx.uSunW[2] - X[2]], ll = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
      l = l.map(function (q) { return q / ll; });
      var dcx = ((px + 0.5) / sz * 2 - 1) * L[2] + L[0], dcy = ((py + 0.5) / sz * 2 - 1) * L[2] + L[1];
      var vg = gr.groundPoint(Sx, [dcx, dcy]); vg[0] -= 0.0005;
      var s0 = 2 * L[2] / sz, r = 1;
      for (var i = 0; i < 32; i++) { var s = s0 * Math.pow(16 / s0, i / 31); r = Math.min(r, gr.altAt(Sx, [vg[0] + l[0] * s, vg[1] + l[1] * s, vg[2] + l[2] * s], Math.max(s * 0.002, 1e-3), 0) / s); }
      var msg = ok + ' 级有效；相机处净空角 GPU ' + hz[0].toFixed(4) + '、CPU ' + r.toFixed(4) + ' rad';
      if (!(Math.abs(hz[0] - r) < 0.02)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '高档：地平线角图第 0 级的 B 通道是 8 方向扫描遮蔽，与 CPU 镜像一致', with_(function (hy) {
    hy.app.quality('high');
    function wait(n) { return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return hy.app.settle(2); }).then(function () { if (hy.fp.debug().tier !== 'high' && n < 600) return wait(n + 1); }); }
    return wait(0).then(function () { return scene(hy, { site: 'shengjin', params: { 'fp.ground.mode': 'terrace' }, look: [0, 0, 55] }, 12); }).then(function () {
      if (hy.fp.debug().tier !== 'high') return '跳过：高档没编好（现在是 ' + hy.fp.debug().tier + '）';
      var Sx = S(hy), g = hy.fp._graph(), sz = g.specs && g.specs.tHorizon ? g.specs.tHorizon.w : 512, L = Sx.uHzLvl[0], gr = hy.fp.ground;
      if (!(L[3] > 0.5)) throw new Error('第 0 级无效');
      var vals = [], diffs = [];
      for (var j = 0; j < 9; j++) for (var i = 0; i < 9; i++) {
        var px = Math.round((i + 0.5) / 9 * sz - 0.5), py = Math.round((j + 0.5) / 9 * sz - 0.5), b = g.readTexel('tHorizon', 0, px, py)[2];
        vals.push(b);
        if ((i + j) % 4 === 0) {
          var dcx = ((px + 0.5) / sz * 2 - 1) * L[2] + L[0], dcy = ((py + 0.5) / sz * 2 - 1) * L[2] + L[1];
          var vg = gr.groundPoint(Sx, [dcx, dcy]); vg[0] -= 0.0005;
          diffs.push(Math.abs(gr.aoScan(Sx, vg) - b));
        }
      }
      diffs.sort(function (a, b) { return a - b; });
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, med = diffs[diffs.length >> 1], mx = diffs[diffs.length - 1];
      var msg = vals.length + ' 个纹素均值 ' + mean.toFixed(3) + '（最小 ' + Math.min.apply(null, vals).toFixed(3) + '）；' + diffs.length + ' 点对 CPU 中位差 ' + med.toFixed(3) + '、最大 ' + mx.toFixed(3);
      if (!(vals.every(function (v) { return v >= 0 && v <= 1.001; }) && mean > 0.75 && mean < 1 && med < 0.03 && mx < 0.2)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '收尾：动过的参数恢复默认', function () {
    var hy = H();
    TOUCHED.forEach(function (p) { var sp = hy.store.SCHEMA && hy.store.SCHEMA[p]; if (sp) hy.app.setParam(p, sp.def); });
    if (probe) { probe.mat.dispose(); probe.geo.dispose(); probe.rt.dispose(); probe = null; }
    return true;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── M6 路：第一人称·人眼与画质（组名“第一人称·人眼”；只在本块里增删） ─────────
 * TAA（静止不糊、转头跟得上、拍照累积到 TAA_ACCUM）、眼的逐帧适应对 JS 镜像、最终 pass 的画布像素对 JS 镜像（AgX、ACES、暗视）、
 * 失能眩光（看日有光雾、日在塔后没有）、“出一张”、bench（02 第十八节：5 个机位各 300 帧）。镜像在 fp/eye.js（HY.fp.eye）。
 * 各项自己设场景，最后一项把动过的参数恢复默认。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·人眼';
  function H() { return G.HY; }
  var entered = null;
  function enter() {
    var hy = H();
    if (entered && hy.app.active && hy.app.active() === 'fp') return entered;
    var sup = hy.fp.supported();
    if (!sup.ok) { entered = Promise.resolve('跳过：' + sup.reason); return entered; }
    entered = hy.app.view('fp').then(function () { return hy.fp.status().phase === 'ready' ? '' : '跳过：第一人称没就绪（' + hy.fp.status().reason + '）'; },
      function (e) { return '跳过：' + (e && e.message || e); });
    return entered;
  }
  function with_(fn) { return function () { return enter().then(function (skip) { return skip ? skip : fn(H()); }); }; }
  var TOUCHED = ['fp.eyeo.auto', 'fp.eyeo.evLock', 'fp.eyeo.evComp', 'fp.eyeo.glare', 'fp.eyeo.tone', 'fp.eyeo.scotopic', 'fp.set.veil', 'fp.set.veilK',
    'fp.cloud.on', 'fp.atmo.on', 'fp.fov', 'fp.quality'];
  function g() { return H().fp._graph(); }
  function lastTAA() { return 1 - g().state().taaCur; }                   // 刚写完的那张 tTAA（run 末尾已交换）
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tierReady(want, n) {
    var hy = H(); n = n || 0;
    if (hy.fp.debug().tier === want || n > 900) return Promise.resolve(hy.fp.debug().tier === want);
    return wait(0).then(function () { return hy.app.settle(2); }).then(function () { return tierReady(want, n + 1); });
  }
  // 一块区域（内部分辨率，左下原点）
  function rect(fx, fy, w, h) { var d = H().fp.debug(); return { x: Math.max(0, Math.round(d.W * fx - w / 2)), y: Math.max(0, Math.round(d.H * fy - h / 2)), w: w, h: h }; }
  function rd(name, i, r) { return g().readRegion(name, i, r.x, r.y, r.w, r.h); }
  function avgRaw(n, r) {
    var acc = new Float64Array(r.w * r.h * 4), k = 0, hy = H();
    function step() {
      if (k >= n) return Promise.resolve(acc);
      return hy.app.settle(1).then(function () { var a = rd('tHDR', 0, r); for (var i = 0; i < a.length; i++) acc[i] += a[i] / n; k++; return step(); });
    }
    return step();
  }
  // 相对均方根误差（绿通道亮度权重）与锐度比（平均 |拉普拉斯| 之比）
  function err(a, ref) { var s = 0, m = 0, n = 0; for (var i = 0; i < a.length; i += 4) { var y = a[i + 1], yr = ref[i + 1]; s += (y - yr) * (y - yr); m += yr; n++; } return Math.sqrt(s / n) / (m / n); }
  function lap(a, w, h) { var s = 0, n = 0; for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var i = y * w + x; s += Math.abs(4 * a[4 * i + 1] - a[4 * i - 3] - a[4 * i + 5] - a[4 * (i - w) + 1] - a[4 * (i + w) + 1]); n++; } return s / n; }
  function fixEV(hy, ev) { hy.app.setParam('fp.eyeo.auto', false); hy.app.setParam('fp.eyeo.evLock', ev); }
  // 画布像素（左下原点，0–255）：必须在出帧的同一个任务里读（渲染器不保留绘图缓冲）
  var PX = new Uint8Array(4);
  function canvasPx(x, y) { var hy = H(), gl = hy.gfx.gl; hy.gfx.renderer.setRenderTarget(null); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PX); return [PX[0], PX[1], PX[2]]; }
  function setScene(hy, o) {
    if (o.params) Object.keys(o.params).forEach(function (k) { hy.app.setParam(k, o.params[k]); });
    if (o.site) hy.app.setSite(o.site);
    if (o.time != null) hy.app.setTime(o.time);
    if (o.look) hy.app.look(o.look[0], o.look[1], o.look[2]);
  }
  // 等画面真正静下来：档位编完、三维噪声与各种烘焙到位。暂停、相机不动、不下雨时合成结果按 64 帧（IGN 周期）严格重复，
  // 所以拿相隔 64 帧的两帧 tHDR 逐字节比，完全一样才算稳（最多试 12 轮）
  function stable(hy) {
    return tierReady(hy.state.fp.quality).then(function () {
      var k = 0;
      function once() {
        var r = rect(0.5, 0.5, 32, 32), a = rd('tHDR', 0, r);
        return hy.app.settle(64).then(function () {
          var b = rd('tHDR', 0, r), same = true;
          for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
          if (same || ++k >= 12) return same;
          return wait(50).then(once);
        });
      }
      return once();
    });
  }

  C.add(GROUP, 'TAA：静止时历史不糊（锐度≈参考）、累积满时误差 < 单帧的 15%（历史位置扣本帧抖动、32F 历史）', with_(function (hy) {
    fixEV(hy, 13); hy.app.play(false);
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, look: [120, -12, 55] });
    var out = [], bad = [];
    return hy.app.settle(30).then(function () { return stable(hy); }).then(function (st) {
      if (!st) out.push('（画面没完全静下来）');
      var r = rect(0.5, 0.25, 96, 64), r2 = rect(0.6, 0.85, 96, 64);
      return avgRaw(128, r).then(function (ref) {
        var raw = err(rd('tHDR', 0, r), ref);
        g().reset('taa');
        var acc = hy.fp.passes.TIERS[g().tier].TAA_ACCUM | 0;
        return hy.app.settle(acc + 1).then(function () {
          var a = rd('tTAA', lastTAA(), r), e = err(a, ref), sh = lap(a, r.w, r.h) / lap(ref, r.w, r.h);
          out.push('地面：单帧 ' + (raw * 100).toFixed(2) + '%，累积 ' + acc + ' 帧 ' + (e * 100).toFixed(3) + '%，锐度比 ' + sh.toFixed(2));
          if (!(e < (hy.gfx.caps.floatLinear ? 0.15 : 0.6) * raw)) bad.push('地面误差');
          if (!(sh > 0.9 && sh < 1.25)) bad.push('地面锐度 ' + sh.toFixed(2));
          return avgRaw(128, r2).then(function (ref2) {
            var a2 = rd('tTAA', lastTAA(), r2), sh2 = lap(a2, r2.w, r2.h) / lap(ref2, r2.w, r2.h);
            out.push('天空锐度比 ' + sh2.toFixed(2));
            if (!(sh2 > 0.9 && sh2 < 1.25)) bad.push('天空锐度 ' + sh2.toFixed(2));
          });
        });
      });
    }).then(function () {
      if (!hy.gfx.caps.floatLinear) out.push('（这台设备没有浮点线性过滤，历史退回 16F）');
      if (bad.length) throw new Error(bad.join('；') + '（' + out.join('，') + '）');
      return out.join('，');
    });
  }));

  C.add(GROUP, 'TAA：转头 0.25°/帧时重投影跟得上（锐度比 ≥ 0.6，误差 < 单帧的 60%）', with_(function (hy) {
    fixEV(hy, 13); hy.app.play(false);
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, look: [100, -12, 55] });
    var yaw = 100, k = 0;
    function turn() {
      if (k++ >= 40) return Promise.resolve();
      yaw += 0.25; hy.app.look(yaw, -12, 55);
      return hy.app.settle(1).then(turn);
    }
    return hy.app.settle(20).then(function () { return stable(hy); }).then(turn).then(function () {
      var r = rect(0.5, 0.25, 128, 64), A = rd('tTAA', lastTAA(), r), raw = rd('tHDR', 0, r);
      return avgRaw(128, r).then(function (ref) {
        var e = err(A, ref), e0 = err(raw, ref), sh = lap(A, r.w, r.h) / lap(ref, r.w, r.h);
        var s = '转头时误差 ' + (e * 100).toFixed(3) + '%（单帧 ' + (e0 * 100).toFixed(3) + '%），锐度比 ' + sh.toFixed(2);
        if (!(e < 0.6 * e0 && sh >= 0.6)) throw new Error(s);
        return s;
      });
    });
  }));

  C.add(GROUP, '拍照累积：暂停、静止后逐像素 n 数过 TAA_ACCUM（a 通道整数部分，之后继续数到 256），累积满了误差 < 0.2%（32F 历史；再跑 64 帧不漂）', with_(function (hy) {
    fixEV(hy, 13); hy.app.play(false);
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, look: [120, -12, 55] });
    var r = rect(0.5, 0.3, 64, 48), acc = 0, out = [];
    return hy.app.settle(20).then(function () { return stable(hy); }).then(function () { return avgRaw(128, r); }).then(function (ref) {
      acc = hy.fp.passes.TIERS[g().tier].TAA_ACCUM | 0;
      g().reset('taa');
      return hy.app.settle(acc + 2).then(function () {
        var a = rd('tTAA', lastTAA(), r), nMin = 1e9, nMax = 0, hit = 0, tot = 0;
        for (var i = 3; i < a.length; i += 4) { var nn = Math.floor(a[i]); nMin = Math.min(nMin, nn); nMax = Math.max(nMax, nn); tot++; if (nn === acc + 2) hit++; }
        var e1 = err(a, ref), st = hy.fp.eye.accum();
        out.push('n ' + nMin + '–' + nMax + '（TAA_ACCUM ' + acc + '，跑了 ' + (acc + 2) + ' 帧；' + (100 * hit / tot).toFixed(1) + '% 的像素正好数到），误差 ' + (e1 * 100).toFixed(3) + '%，accum() ' + st.n + '/' + st.of + (st.done ? ' 已满' : ''));
        if (nMax !== acc + 2 || hit < 0.95 * tot) throw new Error('逐像素 n 没数到 ' + (acc + 2) + '：' + out.join('，'));
        if (!st.still || !st.done) throw new Error('HY.fp.eye.accum() 没报满：' + JSON.stringify(st));
        return hy.app.settle(64).then(function () {
          var e2 = err(rd('tTAA', lastTAA(), r), ref), lim = hy.gfx.caps.floatLinear ? 0.002 : 0.005;
          out.push('再 64 帧 ' + (e2 * 100).toFixed(3) + '%');
          if (!(e1 < lim && e2 < lim)) throw new Error(out.join('，'));
          return out.join('，');
        });
      });
    });
  }));

  C.add(GROUP, '眼：GPU 逐帧的适应亮度与 JS 镜像一致（环境变了 0.6／3 s，只是转头 0.4／0.6 s，0.1 EV 内慢跟）；时间跳变直接跳到目标；固定 EV 的曝光', with_(function (hy) {
    var E = hy.fp.eye, worst = 0, n = 0, out = [], dirs = { up: 0, down: 0 };
    hy.app.setParam('fp.eyeo.auto', true); hy.app.play(false);
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, params: { 'fp.cloud.on': false }, look: [300, 40, 60] });
    function track(frames) {
      var k = 0, prev = g().readEyeSync();
      function step() {
        if (k++ >= frames) return Promise.resolve();
        return hy.app.settle(1).then(function () {
          var e = g().readEyeSync(), gr = g(), t3 = gr.readTexel('tEye', gr.state().eyeCur, 3, 0);
          var env = Math.abs(Math.log(e[4] * 1000) - t3[3]) > 0.15, want = E.adapt(prev[1], e[6], 1 / 60, { env: env }), rel = Math.abs(e[1] - want) / want;
          if (Math.abs(e[6] - prev[1]) / prev[1] > 0.005) { dirs[e[6] > prev[1] ? 'up' : 'down']++; worst = Math.max(worst, rel); n++; }
          prev = e; return step();
        });
      }
      return step();
    }
    return hy.app.settle(240).then(function () {
      hy.app.look(300, -70, 60); return track(90);                                // 低头看地：变暗（目标约降到 2/5）
    }).then(function () { hy.app.look(300, 40, 60); return track(60); })               // 抬头看天：变亮
      .then(function () {
        out.push('逐帧对拍 ' + n + ' 帧（变暗 ' + dirs.down + '、变亮 ' + dirs.up + '），最大相对差 ' + worst.toExponential(1));
        if (!(dirs.down > 30 && dirs.up > 30 && worst < 2e-3)) throw new Error(out.join('，'));
        hy.app.setTime({ year: 10018, wd: 1, hour: 0 });                           // 跳到子夜
        return hy.app.settle(2);
      }).then(function () {
        var e = g().readEyeSync(), jr = Math.abs(e[1] - e[6]) / e[6];
        out.push('时间跳变后 La＝目标（差 ' + jr.toExponential(1) + '）');
        if (!(jr < 1e-3)) throw new Error(out.join('，'));
        fixEV(hy, 10);
        return hy.app.settle(2);
      }).then(function () {
        var e = g().readEyeSync(), want = E.exposure(1, { auto: false, evLock: 10 }), rel = Math.abs(e[0] - want) / want;   // 0.18/(2^EV·0.125)，与读数同口径
        out.push('固定 EV 10：曝光 ' + e[0].toPrecision(4) + '（应为 ' + want.toPrecision(4) + '）');
        hy.app.setParam('fp.eyeo.auto', true);
        if (!(rel < 1e-5)) throw new Error(out.join('，'));
        return out.join('，');
      });
  }));

  // 最终 pass 的 JS 镜像：画布像素 ← tTAA（Catmull–Rom 五点）＋眩光金字塔 → ×新/旧曝光 → 失能眩光 → 色适应 → 暗视 → AgX/ACES → sRGB → 抖动
  function finalCheck(hy, pts) {
    var E = hy.fp.eye, gr = g(), d = hy.fp.debug(), outW = gr.outW, outH = gr.outH;
    var obs = pts.map(function (p) { var x = Math.round(p[0] * (outW - 1)), y = Math.round(p[1] * (outH - 1)); return { x: x, y: y, c: canvasPx(x, y) }; });   // 先读画布
    var U = hy.fp.uniformValues(['uCAT', 'uBloomK', 'uGlareK', 'uPurkinje', 'uSunDirScr', 'uCamFwd', 'uCamRight', 'uCamUp', 'uTanHalfFov']);
    var ec = gr.state().eyeCur, eN = gr.readTexel('tEye', ec, 0, 0), eP = gr.readTexel('tEye', 1 - ec, 0, 0), ti = lastTAA();
    var eS = gr.readTexel('tEye', ec, 2, 0), lv = parseFloat(hy.fp.passes.TIERS[gr.tier].BLOOM_LV) || 5;
    var el = U.uCAT, cat = [el[0], el[3], el[6], el[1], el[4], el[7], el[2], el[5], el[8]];   // three 的 Matrix3.elements 按列 → 行优先
    var bl = gr.targets.tBloom && gr.targets.tBloom[0], bw = bl ? bl.width : 1, bh = bl ? bl.height : 1;
    function sampler(name, i, w, h) {
      var cache = {};
      function texel(ix, iy) {
        ix = Math.max(0, Math.min(w - 1, ix)); iy = Math.max(0, Math.min(h - 1, iy));
        var k = ix + ',' + iy; if (!cache[k]) cache[k] = gr.readTexel(name, i, ix, iy); return cache[k];
      }
      return function (u, v) {                                         // texture()：线性过滤、边缘夹取
        var px = u * w - 0.5, py = v * h - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, o = [0, 0, 0];
        var a = texel(x0, y0), b = texel(x0 + 1, y0), c = texel(x0, y0 + 1), e = texel(x0 + 1, y0 + 1);
        for (var k = 0; k < 3; k++) o[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + e[k] * fx) * fy;
        return o;
      };
    }
    var hdrS = sampler('tTAA', ti, d.W, d.H), blS = bl ? sampler('tBloom', 0, bw, bh) : null;
    function catmull(u, v) {
      var sz = [d.W, d.H], P = [u * sz[0] - 0.5, v * sz[1] - 0.5], f = P.map(function (q) { return q - Math.floor(q); }), c = P.map(function (q) { return Math.floor(q) + 0.5; });
      function w(i) { var t = f[i]; return [t * (-0.5 + t * (1 - 0.5 * t)), 1 + t * t * (-2.5 + 1.5 * t), t * (0.5 + t * (2 - 1.5 * t)), t * t * (-0.5 + 0.5 * t)]; }
      var wx = w(0), wy = w(1), w12 = [wx[1] + wx[2], wy[1] + wy[2]];
      var o12 = [(c[0] + wx[2] / w12[0]) / sz[0], (c[1] + wy[2] / w12[1]) / sz[1]], o0 = [(c[0] - 1) / sz[0], (c[1] - 1) / sz[1]], o3 = [(c[0] + 2) / sz[0], (c[1] + 2) / sz[1]];
      var taps = [[o12[0], o0[1], w12[0] * wy[0]], [o0[0], o12[1], wx[0] * w12[1]], [o12[0], o12[1], w12[0] * w12[1]], [o3[0], o12[1], wx[3] * w12[1]], [o12[0], o3[1], w12[0] * wy[3]]];
      var r = [0, 0, 0], ws = 0;
      taps.forEach(function (t) { var s = hdrS(t[0], t[1]); for (var k = 0; k < 3; k++) r[k] += s[k] * t[2]; ws += t[2]; });
      // 反振铃：夹到最近 2×2 纹素的最小、最大值之间
      var bx = Math.floor(P[0]), by = Math.floor(P[1]), q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(function (o) { return gr.readTexel('tTAA', ti, Math.max(0, Math.min(d.W - 1, bx + o[0])), Math.max(0, Math.min(d.H - 1, by + o[1]))); });
      return r.map(function (x, k) { var lo = Math.min(q[0][k], q[1][k], q[2][k], q[3][k]), hi = Math.max(q[0][k], q[1][k], q[2][k], q[3][k]); return Math.max(Math.min(Math.max(x / ws, lo), hi), 0); });
    }
    var worst = 0, rows = [];
    obs.forEach(function (o) {
      var fc = [o.x + 0.5, o.y + 0.5], u = fc[0] / outW, v = fc[1] / outH, nx = (2 * fc[0] - outW) / outH, ny = (2 * fc[1] - outH) / outH, dv = [0, 0, 0], k;
      for (k = 0; k < 3; k++) dv[k] = U.uCamFwd[k] + U.uTanHalfFov * (nx * U.uCamRight[k] + ny * U.uCamUp[k]);
      var l = Math.hypot(dv[0], dv[1], dv[2]); dv = dv.map(function (q) { return q / l; });
      var ch = Math.hypot(dv[0] - U.uSunDirScr[0], dv[1] - U.uSunDirScr[1], dv[2] - U.uSunDirScr[2]), th = 2 * Math.asin(Math.min(Math.max(0.5 * ch, 0), 1)) * 180 / Math.PI;
      var ro = [0.04 * outH / outW, 0.04], bsum = [0, 0, 0];
      if (blS) for (var jj = -1; jj <= 1; jj++) for (var ii = -1; ii <= 1; ii++) { var bs = blS(u + ii * ro[0], v + jj * ro[1]); for (k = 0; k < 3; k++) bsum[k] += bs[k]; }
      var lin = E.finalPixel({ hdr: catmull(u, v), bloom: blS ? blS(u, v) : [0, 0, 0], bloomK: U.uBloomK, eN: eN, eP: eP, cat: cat, purkinje: U.uPurkinje, glareK: U.uGlareK, th: th, tone: hy.state.fp.eyeo.tone,
        Ergb: [eS[0], eS[1], eS[2]], bloomLoc: blS ? bsum : null, levels: lv, tanHalf: U.uTanHalfFov });
      var n = (52.9829189 * ((fc[0] * 0.06711056 + fc[1] * 0.00583715) % 1)) % 1;
      var want = lin.map(function (x) { return Math.round(Math.min(Math.max(x + (n - 0.5) / 255, 0), 1) * 255); });
      var dd = Math.max(Math.abs(want[0] - o.c[0]), Math.abs(want[1] - o.c[1]), Math.abs(want[2] - o.c[2]));
      worst = Math.max(worst, dd); rows.push(o.c.join('/') + '≈' + want.join('/'));
    });
    return { worst: worst, rows: rows, La: eN[1] };
  }
  var PTS = [[0.5, 0.5], [0.2, 0.8], [0.8, 0.75], [0.3, 0.3], [0.7, 0.15], [0.05, 0.5]];
  C.add(GROUP, '最终：画布像素与 JS 镜像一致（AgX、ACES、暗视；≤ 2/255）', with_(function (hy) {
    var out = [], bad = [];
    hy.app.setParam('fp.eyeo.auto', true); hy.app.play(false);
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, params: { 'fp.cloud.on': true }, look: [150, 15, 60] });
    var las = [];
    function one(label) {
      return hy.app.settle(1).then(function () {
        var r = finalCheck(hy, PTS);
        las.push(r.La);
        out.push(label + ' 最大差 ' + r.worst + '/255（适应亮度 ' + r.La.toPrecision(3) + ' cd/m²）');
        if (r.worst > 2) bad.push(label + '：' + r.rows.join(' '));
      });
    }
    return hy.app.settle(90).then(function () { return one('AgX'); }).then(function () {
      hy.app.setParam('fp.eyeo.tone', 'aces'); return hy.app.settle(30);
    }).then(function () { return one('ACES'); }).then(function () {
      hy.app.setParam('fp.eyeo.tone', 'agx');
      // 暗视：赤道深渊边的子夜，静滞夜幕开到最强（适应亮度到 0.003 cd/m² 左右）
      setScene(hy, { site: { s: hy.model.P.R * Math.PI / 2, az: 0 }, time: { year: 10018, wd: 1, hour: 0 }, params: { 'fp.set.veil': true, 'fp.set.veilK': 1 }, look: [0, -30, 55] });
      return hy.app.settle(600);
    }).then(function () { return one('暗视'); }).then(function () {
      hy.app.setParam('fp.set.veil', false);
      if (!(las[2] < 0.1)) out.push('（深渊子夜的适应亮度没降到暗视区，暗视那一步只是部分混合）');
      if (bad.length) throw new Error(bad.join('；') + '｜' + out.join('，'));
      return out.join('，');
    });
  }));

  C.add(GROUP, '失能眩光：晴天看日，日旁 2° 的光雾远大于 30°；日面滑进塔后（到眼日照≈0）光雾随之消失', with_(function (hy) {
    var A = hy.astro, P = hy.model.P, out = [];
    hy.app.setParam('fp.eyeo.auto', true); hy.app.play(false);
    setScene(hy, { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 9 }, params: { 'fp.cloud.on': false } });
    hy.app.look(null, null, 60); hy.fp.api.lookPreset('sun', { instant: true });
    function ring() {                                                // 日在画面正中：2°、30° 处四个方向的平均亮度（0–255）
      var gr = g(), th = hy.fp.uniformValues(['uTanHalfFov']).uTanHalfFov, cx = gr.outW / 2, cy = gr.outH / 2, o = {};
      [2, 30].forEach(function (deg) {
        var r = Math.tan(deg * Math.PI / 180) / th * gr.outH / 2, s = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (q) { var c = canvasPx(Math.round(cx + q[0] * r), Math.round(cy + q[1] * r)); s += 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; });
        o[deg] = s / 4;
      });
      return o;
    }
    var on, off, Eeye;
    return hy.app.settle(120).then(function () {
      hy.fp.api.lookPreset('sun', { instant: true }); return hy.app.settle(2);
    }).then(function () { on = ring(); Eeye = g().readEyeSync()[2]; hy.app.setParam('fp.eyeo.glare', 0); return hy.app.settle(2); })
      .then(function () {
        off = ring(); hy.app.setParam('fp.eyeo.glare', 1);
        var d2 = on[2] - off[2], d30 = on[30] - off[30];
        out.push('到眼日照 ' + Eeye.toFixed(1) + ' klux，光雾 2° +' + d2.toFixed(1) + '，30° +' + d30.toFixed(1) + '（0–255）');
        if (!(Eeye > 5 && d2 > 8 && d2 > 4 * Math.max(d30, 0.5))) throw new Error(out.join('，'));
        // 找日面整个在塔后、仰角 > 5° 的时刻
        var O = A.site(hy.state.site.s, hy.state.site.az, P), t0 = hy.state.time.t, tb = null;
        for (var k = 0; k < 1440 * 2 && tb == null; k += 2) { var t = t0 + k / 1440, lk = A.look(O, A.sunPos(t, P), P); if (lk.vis === 0 && lk.el > 5) tb = t; }
        if (tb == null) { out.push('两天里没有日在塔后的时刻，后半跳过'); return null; }
        hy.app.setTime(tb + 3 / 1440); hy.fp.api.lookPreset('sun', { instant: true });
        return hy.app.settle(60);
      }).then(function (skip) {
        if (skip === null) return out.join('，');
        hy.fp.api.lookPreset('sun', { instant: true });
        return hy.app.settle(2).then(function () {
          var e2 = g().readEyeSync()[2], a = ring(); hy.app.setParam('fp.eyeo.glare', 0);
          return hy.app.settle(2).then(function () {
            var b = ring(); hy.app.setParam('fp.eyeo.glare', 1);
            var d2 = a[2] - b[2];
            out.push('日在塔后：到眼日照 ' + e2.toExponential(1) + ' klux，光雾 2° ' + d2.toFixed(1));
            if (!(e2 < 1e-3 && Math.abs(d2) < 4)) throw new Error(out.join('，'));             // 只剩亮天的眼内散射（金字塔），约 1–2/255
            return out.join('，');
          });
        });
      });
  }));

  C.add(GROUP, '“出一张”：暂停后 HY.fp.eye.shoot() 等累积满了从画布取 PNG；时间在走时拒绝；余息飘尘里照样出图（不累积）', with_(function (hy) {
    setScene(hy, { site: 'shengjin', time: { year: 10018, wd: 200, hour: 9 }, look: [120, 10, 55] });
    hy.app.play(true, 1);
    var out = [];
    return hy.fp.eye.shoot().then(function () { throw new Error('时间在走时不该出图'); }, function (e) {
      if (!/暂停/.test(e && e.message)) throw e;
      var p = hy.fp.eye.shoot({ pause: true });
      var acc = hy.fp.passes.TIERS[g().tier].TAA_ACCUM | 0;
      return hy.app.settle(acc + 20).then(function () { return p; }).then(function (r) {
        var cv = hy.gfx.canvas;
        if (!(r && /^data:image\/png;base64,/.test(r.url) && r.w === cv.width && r.h === cv.height && r.n === r.of)) throw new Error(JSON.stringify({ w: r.w, h: r.h, n: r.n, of: r.of }));
        if (hy.state.time.playing) throw new Error('pause:true 没把时间停下');
        if (r.falling) throw new Error('圣禁城晴天不该算“在下雨”');
        out.push(r.w + '×' + r.h + '，累积 ' + r.n + '/' + r.of + '（' + r.tier + ' 档），' + Math.round(r.url.length / 1024) + ' KB');
        // 罪域入冬后第 1 日：余息飘尘在落，帧图不累积；静止 max(TAA_ACCUM, 20) 帧后照样出图
        setScene(hy, { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 9 } });
        var p2 = hy.fp.eye.shoot();
        return hy.app.settle(Math.max(acc, 20) + 10).then(function () { return p2; });
      }).then(function (r2) {
        var rk = hy.fp.set.rainK(hy.state, hy.model.P, hy.fp.cam.current.posW(), 0, hy.state.time.t);
        if (rk[0] > 0.001 || rk[1] > 0.001) { if (!r2.falling) throw new Error('余息飘尘里应标 falling'); out.push('余息飘尘里出图（不累积，n＝' + r2.n + '）'); }
        else out.push('（罪域此刻没有雨与余息，后半只验出图）');
        return out.join('，');
      });
    });
  }));

  // 02 第十八节：5 个固定机位各跑 300 帧，逐 pass GPU 中位数与总帧时；中档总帧时在目标机上 ≤ 33 ms（这里是本机，集显另测）
  C.add(GROUP, 'bench：5 个机位各 300 帧（中档），逐 pass GPU 中位数与总帧时 ≤ 33 ms', with_(function (hy) {
    var R = hy.model.P.R, out = [], over = [], views = [
      { name: '罪域阴云仰望', site: 'zuiyu', time: { year: 10018, wd: 294, hour: 12 }, params: { 'fp.cloud.on': true }, look: [0, 60, 55] },
      { name: '罪域贴地看南方', site: 'zuiyu', time: { year: 10018, wd: 294, hour: 12 }, look: [180, -5, 55] },
      { name: '圣禁城看北面台阶', site: 'shengjin', time: { year: 10018, wd: 294, hour: 12 }, look: [0, 30, 55] },
      { name: '圣禁城子夜', site: 'shengjin', time: { year: 10018, wd: 294, hour: 0 }, look: [0, 60, 55] },
      { name: '深渊边', site: { s: R * Math.PI / 2 - 230, az: 0 }, time: { year: 10018, wd: 294, hour: 12 }, look: [180, 0, 55] }
    ];
    function med(a) { if (!a.length) return NaN; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
    hy.app.play(false); hy.app.setParam('fp.quality', 'mid'); hy.app.setParam('fp.eyeo.auto', true);
    return tierReady('mid').then(function () {
      return views.reduce(function (p, v) {
        return p.then(function () {
          setScene(hy, v);
          return hy.app.settle(10).then(function () { return wait(400); }).then(function () {
            return new Promise(function (res) {
              var per = {}, tot = [], dts = [], last = G.performance.now(), n = 0;
              var off = hy.bus.on('frame', function () {
                var t = G.performance.now(); dts.push(t - last); last = t;
                var gt = hy.fp.gpuTimes(), s = 0;
                for (var k in gt) { (per[k] = per[k] || []).push(gt[k]); s += gt[k]; }
                if (Object.keys(gt).length) tot.push(s);
                if (++n >= 300) { off(); res({ per: per, tot: tot, dts: dts }); }
              });
            });
          }).then(function (r) {
            var top = Object.keys(r.per).map(function (k) { return [k, med(r.per[k])]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4);
            var T = med(r.tot), F = med(r.dts);
            out.push(v.name + '：GPU ' + (isFinite(T) ? T.toFixed(2) + ' ms' : '无计时') + '（' + top.map(function (q) { return q[0] + ' ' + q[1].toFixed(2); }).join('、') + '），帧间隔 ' + F.toFixed(1) + ' ms');
            if (isFinite(T) && T > 33) over.push(v.name);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      var d = hy.fp.debug(), s = '内部 ' + d.W + '×' + d.H + '；' + out.join('；');
      if (over.length) throw new Error('超过 33 ms：' + over.join('、') + '｜' + s);
      return s;
    });
  }));

  C.add(GROUP, '收尾：动过的参数恢复默认、时间停住', function () {
    var hy = H();
    TOUCHED.forEach(function (p) { var sp = hy.store.SCHEMA && hy.store.SCHEMA[p]; if (sp) hy.app.setParam(p, sp.def); });
    hy.app.play(false);
    return true;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── M5：第一人称·云与设定（组名“第一人称·云”；只在本块里增删） ─────────
 * 天气图读回（覆盖度跟滑杆、东西拉长）、对面世界的云、罪域厚云盖（云底一块亮一块暗、看不见日面）、云影、
 * 雨与余息（该下的地方才下；余息把地面提亮）、各种设定组合下没有 NaN／GL 报错。最后一项把动过的参数恢复默认。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·云';
  function H() { return G.HY; }
  var entered = null;
  function enter() {
    var hy = H();
    if (entered && hy.app.active && hy.app.active() === 'fp') return entered;
    var sup = hy.fp.supported();
    if (!sup.ok) { entered = Promise.resolve('跳过：' + sup.reason); return entered; }
    entered = hy.app.view('fp').then(function () { return hy.fp.status().phase === 'ready' ? '' : '跳过：第一人称没就绪（' + hy.fp.status().reason + '）'; },
      function (e) { return '跳过：' + (e && e.message || e); });
    return entered;
  }
  function with_(fn) { return function () { return enter().then(function (skip) { return skip ? skip : fn(H()); }); }; }
  // site：预设 id 或 {s, az}；time：{year, wd, hour}；params；look：[yaw, pitch, fov]
  // 地点写进去以后核对相机真到了：前面的组走过路时，第一人称“停步写回地点”（src:'walk'）可能晚一帧把旧位置写回来
  function scene(hy, o, n) {
    if (o.params) Object.keys(o.params).forEach(function (k) { hy.app.setParam(k, o.params[k]); });
    var want = null;
    if (typeof o.site === 'string') { hy.app.setSite(o.site); want = hy.world.siteById(o.site, hy.model.P); }
    else if (o.site) { hy.app.setSite({ s: o.site.s, az: o.site.az }); want = o.site; }
    if (o.time != null) hy.app.setTime(o.time);
    if (o.look) hy.app.look(o.look[0], o.look[1], o.look[2]);
    function check(k) {
      var p = hy.fp.pose();
      if (!want || !p || (Math.abs(p.s - want.s) < 1 && Math.abs(((p.az - want.az + 540) % 360) - 180) < 0.01) || k > 3) return;
      hy.app.setSite({ id: want.id || null, s: want.s, az: want.az });
      if (o.look) hy.app.look(o.look[0], o.look[1], o.look[2]);
      return hy.app.settle(n || 30).then(function () { return check(k + 1); });
    }
    return hy.app.settle(n || 30).then(function () { return check(0); });
  }
  function lum(L) { return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2]; }
  function grid(hy, x0, x1, y0, y1, n) {                      // n×n 个像素的亮度（cd/m²）
    var out = [];
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var r = hy.fp.readPxRGB(x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n);
      out.push(r ? lum(r.L) : NaN);
    }
    return out;
  }
  function q(a, f) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]; }
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
  var TOUCHED = ['fp.cloud.on', 'fp.cloud.cover', 'fp.set.veil', 'fp.set.acid', 'fp.set.yuxi', 'fp.atmo.on'];
  var PLAIN = { s: 5000, az: 10 }, NOON = { year: 10018, wd: 200, hour: 12 };

  C.add(GROUP, '天气图：平均覆盖度跟着滑杆（0.42、0.7），各通道在 0–1，沿纬线拉长', with_(function (hy) {
    var g = hy.fp._graph(), W = 1024, Hh = 512;
    function stat() {
      var d = g.readRegion('tWeather', 0, 0, 0, W, Hh), m = 0, bad = 0;
      for (var i = 0; i < W * Hh; i++) { m += d[i * 4]; for (var c = 0; c < 4; c++) if (!(d[i * 4 + c] >= 0 && d[i * 4 + c] <= 1)) bad++; }
      function corr(dx, dy) {
        var sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
        for (var j = 40; j < Hh - 40; j += 3) for (var i2 = 0; i2 < W; i2 += 3) {
          var a = d[(j * W + i2) * 4], b = d[((j + dy) * W + (i2 + dx) % W) * 4];
          sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
        }
        return (sab / n - sa * sb / n / n) / Math.sqrt((saa / n - sa * sa / n / n) * (sbb / n - sb * sb / n / n));
      }
      return { mean: m / (W * Hh), bad: bad, ce: corr(8, 0), cn: corr(0, 12) };
    }
    var a, b;
    return scene(hy, { site: PLAIN, time: NOON, params: { 'fp.cloud.on': true, 'fp.cloud.cover': 0.42 } }, 8).then(function () {
      a = stat(); hy.app.setParam('fp.cloud.cover', 0.7); return hy.app.settle(6);
    }).then(function () {
      b = stat(); hy.app.setParam('fp.cloud.cover', 0.42); return hy.app.settle(4);
    }).then(function () {
      var msg = '覆盖 0.42 → 均值 ' + a.mean.toFixed(3) + '；0.7 → ' + b.mean.toFixed(3) + '；错开约 300 km 的相关：东西 ' + a.ce.toFixed(2) + '、南北 ' + a.cn.toFixed(2);
      if (a.bad || b.bad) throw new Error('有 ' + (a.bad + b.bad) + ' 个通道值不在 0–1；' + msg);
      if (!(Math.abs(a.mean - 0.42) < 0.05 && Math.abs(b.mean - 0.7) < 0.05 && a.ce > a.cn + 0.1)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '对面世界的云：平域正午抬头看对面，云顶反光让天空比关掉云时亮 15% 以上', with_(function (hy) {
    var on, off;
    return scene(hy, { site: PLAIN, time: NOON, params: { 'fp.cloud.on': true, 'fp.cloud.cover': 0.42 }, look: [270, 75, 60] }, 30).then(function () {
      on = grid(hy, 0.15, 0.85, 0.15, 0.85, 9); hy.app.setParam('fp.cloud.on', false); return hy.app.settle(30);
    }).then(function () {
      off = grid(hy, 0.15, 0.85, 0.15, 0.85, 9); hy.app.setParam('fp.cloud.on', true); return hy.app.settle(4);
    }).then(function () {
      var a = mean(on), b = mean(off), msg = '天空平均亮度：有云 ' + Math.round(a) + '，没云 ' + Math.round(b) + ' cd/m²（比 ' + (a / b).toFixed(2) + '）';
      if (!(on.every(isFinite) && a > 1.15 * b)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '罪域厚云盖：正午抬头，云底一块亮一块暗；日光透不下来（地面直射 ＜ 500 lux，晴天约 6 万）', with_(function (hy) {
    return scene(hy, { site: 'zuiyu', time: NOON, params: { 'fp.cloud.on': true, 'fp.cloud.cover': 0.42 }, look: [0, 80, 70] }, 40).then(function () {
      var L = grid(hy, 0.1, 0.9, 0.1, 0.9, 9), lo = q(L, 0.1), hi = q(L, 0.9);
      hy.fp.Eh(); var ro = hy.fp.readouts();
      var msg = '云底亮度 10%–90% 分位 ' + Math.round(lo) + '–' + Math.round(hi) + ' cd/m²（比 ' + (hi / lo).toFixed(2) + '）；地面直射 ' + Math.round(ro.Edir) + ' lux';
      if (!(L.every(isFinite) && hi / lo > 1.15 && ro.Edir < 500)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '云影：平域满覆盖时脚下云影图 τ＞3、照度不到零覆盖时的六成；零覆盖时没有云影', with_(function (hy) {
    var g = hy.fp._graph(), a, b, ea, eb;
    function tauMid() { var n = g.specs && g.specs.tCloudSh ? g.specs.tCloudSh.w : 256, h = n >> 3, d = g.readRegion('tCloudSh', 0, (n >> 1) - h, (n >> 1) - h, 2 * h, 2 * h), v = []; for (var i = 0; i < 4 * h * h; i++) v.push(d[i * 4]); return v; }
    return scene(hy, { site: PLAIN, time: NOON, params: { 'fp.cloud.on': true, 'fp.cloud.cover': 1 }, look: [0, 10, 70] }, 30).then(function () {
      a = tauMid(); ea = hy.fp.Eh(); hy.app.setParam('fp.cloud.cover', 0); return hy.app.settle(30);
    }).then(function () {
      b = tauMid(); eb = hy.fp.Eh(); hy.app.setParam('fp.cloud.cover', 0.42); return hy.app.settle(4);
    }).then(function () {
      var msg = '满覆盖：τ 中位 ' + q(a, 0.5).toFixed(1) + '、照度 ' + Math.round(ea) + ' lux；零覆盖：τ 最大 ' + Math.max.apply(null, b).toFixed(3) + '、照度 ' + Math.round(eb) + ' lux';
      if (!(q(a, 0.5) > 3 && Math.max.apply(null, b) < 0.01 && ea < 0.6 * eb)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '雨与余息：罪域里有雨丝，平域入夏没有；入冬前 20 日前锋以内有余息，几十米外的地面被风里的白灰提亮（五次平均＞5%）', with_(function (hy) {
    var tier = hy.fp.debug().tier, opt = hy.fp.passes.TIER_OPTS[tier];
    if (!opt || !opt.rain) return '跳过：' + tier + ' 档不画雨丝与飘尘';
    function has() { return hy.fp.debug().plan.indexOf('rain') >= 0; }
    // 灰片、风痕按真实时间动（风痕约 80 m 一缕、8 m/s 吹过）、阵风有起伏：隔 1.2 s 取一次，五次平均
    function avg3() {
      var acc = [];
      function one() { acc = acc.concat(grid(hy, 0.2, 0.8, 0.2, 0.45, 7)); return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return hy.app.settle(8); }); }
      return one().then(one).then(one).then(one).then(one).then(function () { return acc; });
    }
    var r1, r2, r3, on, off, where = '';
    return scene(hy, { site: 'zuiyu', time: NOON, params: { 'fp.cloud.on': true, 'fp.set.yuxi': 'auto' }, look: [90, 0, 70] }, 8).then(function () {
      r1 = has(); return scene(hy, { site: PLAIN, time: NOON }, 8);
    }).then(function () {
      r2 = has(); return scene(hy, { site: { s: 4200, az: 0 }, time: { year: 10018, wd: 340, hour: 11 }, look: [90, 2, 70] }, 30);
    }).then(function () {
      r3 = has();
      var ps = hy.fp.pose(), rk = hy.fp.set.rainK(hy.state, hy.model.P, hy.fp.cam && hy.fp.cam.current ? hy.fp.cam.current.posW() : null, 0, hy.state.time.t);
      var gg = hy.fp._graph(), sh = gg.readTexel('tSH', gg.state().shCur, 0, 0), sf = gg.readTexel('tSurf', 0, gg.W >> 1, Math.round(gg.H * 0.3));
      where = '（相机 ' + Math.round(ps.s) + ' km、' + ps.az.toFixed(1) + '°、俯仰 ' + ps.pitch.toFixed(1) + '°，余息强度 ' + (rk ? rk[1].toFixed(2) : '—') +
        '，天光 ' + (sh ? (sh[1] * 0.282).toFixed(2) : '—') + ' kn，地面 ' + (sf ? sf[1].toFixed(2) + ' kn@' + (sf[3] * 1000).toFixed(0) + ' m' : '—') + '）';
      return avg3();
    }).then(function (v) {
      on = v; hy.app.setParam('fp.set.yuxi', 'off'); return hy.app.settle(30).then(avg3);
    }).then(function (v) {
      off = v; hy.app.setParam('fp.set.yuxi', 'auto'); return hy.app.settle(4);
    }).then(function () {
      var mo = on.reduce(function (s, x) { return s + x; }, 0) / on.length, mf = off.reduce(function (s, x) { return s + x; }, 0) / off.length;
      var msg = '罪域 ' + (r1 ? '有' : '无') + '雨丝 pass；平域入夏 ' + (r2 ? '有' : '无') + '；余息 ' + (r3 ? '有' : '无') + '，地面亮度 ' + Math.round(mf) + ' → ' + Math.round(mo) + ' cd/m²' + where;
      if (!(r1 && !r2 && r3 && mo > 1.05 * mf)) throw new Error(msg);
      return msg;
    });
  }));

  C.add(GROUP, '没有 GL 报错、画面没有 NaN／Inf（满覆盖、罪域子夜、夜幕、酸霾、余息、云关）', with_(function (hy) {
    var gl = hy.gfx.gl, bad = [], cases = [
      { site: PLAIN, time: NOON, params: { 'fp.cloud.cover': 1 }, look: [0, 30, 70] },
      { site: 'zuiyu', time: { year: 10018, wd: 1, hour: 0 }, params: { 'fp.cloud.cover': 0.42 }, look: [180, 60, 90] },
      { params: { 'fp.set.veil': true }, look: [0, 40, 90] },
      { params: { 'fp.set.veil': false, 'fp.set.acid': true }, time: NOON, look: [90, 5, 70] },
      { params: { 'fp.set.acid': false }, site: { s: 3000, az: 0 }, time: { year: 10018, wd: 340, hour: 8 }, look: [180, 10, 70] },
      { params: { 'fp.cloud.on': false }, look: [0, 60, 70] }
    ];
    gl.getError();
    return cases.reduce(function (p, c, k) {
      return p.then(function () { return scene(hy, c, 12); }).then(function () {
        var e = gl.getError(); if (e) bad.push('场景 ' + k + ' GL 错误 0x' + e.toString(16));
        for (var j = 0; j <= 6; j++) for (var i = 0; i <= 6; i++) {
          var r = hy.fp.readPxRGB(i / 6, j / 6);
          if (!r || !isFinite(r.L[0] + r.L[1] + r.L[2]) || !(r.L[1] >= 0)) { bad.push('场景 ' + k + ' (' + i + ',' + j + ')'); return; }
        }
      });
    }, Promise.resolve()).then(function () {
      hy.app.setParam('fp.cloud.on', true);
      if (bad.length) throw new Error(bad.slice(0, 4).join('；'));
      return cases.length + ' 个场景各 49 点';
    });
  }));

  C.add(GROUP, '收尾：动过的参数恢复默认', function () {
    var hy = H();
    TOUCHED.forEach(function (p) { var sp = hy.store.SCHEMA && hy.store.SCHEMA[p]; if (sp) hy.app.setParam(p, sp.def); });
    return true;
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* ───────── 整合：第一人称·整帧数值（组名“第一人称·整帧数值”；整合验收时加） ─────────
 * 合成把 L 夹到 6e4（D3D 上 min(NaN, 6e4)＝6e4），NaN 在最终像素里看不出来，只会是一片白。这里直接读 tNear／tFar／tHDR
 * 的原始浮点。回归对象：air.glsl 的 warpU 在 k≳17 时 float32 得 ∞，低档云天近段 TX＝NaN（罪域整屏发白）。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var GROUP = '第一人称·整帧数值';
  function H() { return G.HY; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tierReady(hy, want) {
    var t0 = Date.now();
    return (function loop() {
      var d = hy.fp.debug();
      if (d && d.tier === want && !d.compile.pending) return Promise.resolve(true);
      if (Date.now() - t0 > 240000) return Promise.resolve(false);
      return hy.app.settle(1).then(function () { return wait(10); }).then(loop);
    })();
  }
  function scan(hy) {
    var g = hy.fp._graph(), out = [];
    ['tNear', 'tFar', 'tHDR'].forEach(function (n) {
      var rt = g.targets[n]; rt = Array.isArray(rt) ? rt[0] : rt; if (!rt) return;
      var d = g.readRegion(n, 0, 0, 0, rt.width, rt.height), bad = 0;
      for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) bad++;
      if (bad) out.push(n + ' ' + bad + ' 个');
    });
    return out;
  }
  C.add(GROUP, '低档：罪域正午、伊美忒黄昏、圣禁城子夜，tNear／tFar／tHDR 全是有限数', function () {
    var hy = H(), sup = hy.fp.supported();
    if (!sup.ok) return '跳过：' + sup.reason;
    var q0 = hy.state.fp.quality, bad = [];
    var cases = [['zuiyu', { year: 10018, wd: 294, hour: 12 }, [180, 20, 75]], ['yimeite', { year: 10018, wd: 294, hour: 18.75 }, [196, 59, 75]], ['shengjin', { year: 10018, wd: 295, hour: 0 }, [201, 20, 75]]];
    return hy.app.view('fp').then(function () {
      if (hy.fp.status().phase !== 'ready') return '跳过：第一人称没就绪';
      hy.app.quality('low');
      return tierReady(hy, 'low').then(function (ok) {
        if (!ok) throw new Error('低档没编完');
        return cases.reduce(function (p, c) {
          return p.then(function () {
            hy.app.setSite(c[0]); hy.app.setTime(c[1]);
            return hy.app.settle(2).then(function () { hy.app.look(c[2][0], c[2][1], c[2][2]); return hy.app.settle(20); })
              .then(function () { var s = scan(hy); if (s.length) bad.push(c[0] + '：' + s.join('、')); });
          });
        }, Promise.resolve());
      }).then(function () {
        hy.app.quality(q0);
        return tierReady(hy, q0);
      }).then(function () {
        if (bad.length) throw new Error(bad.join('；'));
        return cases.length + ' 个场景，三张目标逐个浮点都有限';
      });
    });
  });
  // 地形求交在阶沿上漏掉的像素（tSurf 无命中、视线却朝内壁）由合成取邻近表面补上，不再是一条黑线
  C.add(GROUP, '地形漏洞补洞：圣禁城正午朝北（阶地），漏掉的像素不发黑', function () {
    var hy = H(), sup = hy.fp.supported();
    if (!sup.ok) return '跳过：' + sup.reason;
    return hy.app.view('fp').then(function () {
      if (hy.fp.status().phase !== 'ready') return '跳过：第一人称没就绪';
      hy.app.setSite('shengjin'); hy.app.setTime({ year: 10018, wd: 294, hour: 12 });
      return hy.app.settle(2).then(function () { hy.app.look(0, 15, 75); return hy.app.settle(40); }).then(function () {
        var g = hy.fp._graph(), W = g.W, Hh = g.H, hdr = g.readRegion('tHDR', 0, 0, 0, W, Hh), sf = g.readRegion('tSurf', 0, 0, 0, W, Hh);
        var holes = 0, black = 0, Ls = [];
        for (var i = 0; i < W * Hh; i++) {
          var k = i * 4, L = 0.2126 * hdr[k] + 0.7152 * hdr[k + 1] + 0.0722 * hdr[k + 2];
          if (sf[k + 3] > 0) { if (i % 97 === 0) Ls.push(L); continue; }
          if (hdr[k + 3] < 50) { holes++; if (L < 0.003) black++; }
        }
        Ls.sort(function (a, b) { return a - b; });
        var med = Ls[Ls.length >> 1] || 0;
        if (black > 0) throw new Error('漏洞 ' + holes + ' 像素里 ' + black + ' 个发黑（地面中位亮度 ' + med.toPrecision(3) + '）');
        return '漏洞 ' + holes + ' 像素（' + (holes / (W * Hh) * 100).toFixed(2) + '%），都已补上';
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
