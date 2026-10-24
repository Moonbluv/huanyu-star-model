/* render_ov.js —— 浏览器验收：总览（负责：B 路；规格：spec/03 第十一节第 2 条“总览”一项）
 * 只调 HY_CHECKS.add('总览', 名, fn)；fn 可返回 Promise，抛错或返回 false 算失败，返回字符串算通过并附说明。
 * 像素一律经 HY.app.readPx 读（总览时转到 HY.ov.readPx：先重画一帧再读，显示值 0–255），比较时换回线性亮度。
 * 每条检查自己改的状态在末尾恢复（ov 整组、时间、地点）。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;

  // 启动阶段就开始记：ready{part:'ov'} 的时刻、控制台错误
  var t0 = G.performance ? G.performance.now() : Date.now(), readyAt = null, errors = [];
  if (G.HY && G.HY.bus) G.HY.bus.on('ready', function (e) { if (e && e.part === 'ov' && readyAt == null) readyAt = (G.performance ? G.performance.now() : Date.now()) - t0; });
  if (G.console && G.console.error) {
    var orig = G.console.error;
    G.console.error = function () {
      try { errors.push(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ')); } catch (e) { /* 忽略 */ }
      return orig.apply(this, arguments);
    };
  }

  function H() { return G.HY; }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(px) { return 0.2126 * lin(px[0]) + 0.7152 * lin(px[1]) + 0.0722 * lin(px[2]); }
  function save() {
    var h = H();
    return { ov: JSON.parse(JSON.stringify(h.state.ov)), t: h.state.time.t, site: JSON.parse(JSON.stringify(h.state.site)), playing: h.state.time.playing, speed: h.state.time.speed.ov, view: h.state.view.mode };
  }
  function restore(s) {
    var h = H();
    h.store.set('time.playing', s.playing, 'api');
    h.store.set('time.speed.ov', s.speed, 'api');
    h.store.patch('ov', s.ov, 'api');
    h.store.patch('site', s.site, 'api');
    h.store.set('time.t', s.t, 'api');
    return h.app.settle(2);
  }
  // 读像素时关掉叠加物（螺旋、塔影体、视线、针、网格），免得落在采样点上
  function plain() { H().store.patch('ov', { helix: 'off', shadowVol: false, sight: false, sites: false, grid: false, trails: false, cut: 'half', frame: 'ground', bodyScale: 3, sunGapX: 1 }, 'api'); }
  function need() { var h = H(); if (!h.ov || !h.ov.status || h.ov.status().phase !== 'ready') throw new Error('总览没有就绪：' + (h.ov && h.ov.status ? h.ov.status().reason || h.ov.status().phase : '无')); }
  function fin(a) { return a && a.every(function (v) { return typeof v === 'number' && isFinite(v); }); }

  C.add('总览', '启动 3 s 内发出 ready（part＝ov）', function () {
    var h = H();
    if (h.ov.status().phase !== 'ready') throw new Error('状态：' + h.ov.status().phase + ' ' + h.ov.status().reason);
    if (readyAt == null) return '已就绪（ready 事件早于检查脚本登记，未计时）';
    if (readyAt > 3000) throw new Error('用了 ' + Math.round(readyAt) + ' ms');
    return Math.round(readyAt) + ' ms';
  });

  C.add('总览', '每个总览材质都列全了着色器里声明的 uniform（同程序的材质不串值）', function () {
    need();
    var h = H(), seen = 0, bad = [];
    var root = h.ov.bodies.meshes().sun.parent.parent;
    root.traverse(function (o) {
      var m = o.material; if (!m || !m.isShaderMaterial) return;
      seen++;
      var src = (m.vertexShader + '\n' + m.fragmentShader).replace(/\/\/[^\n]*/g, ''), re = /uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g, mm;
      while ((mm = re.exec(src))) mm[2].split(',').forEach(function (n) { n = n.replace(/\[.*$/, '').trim(); if (n && !m.uniforms[n]) bad.push((o.name || o.type) + '.' + n); });
    });
    if (bad.length) throw new Error('缺：' + bad.slice(0, 8).join('、'));
    return seen + ' 个网格的材质都齐';
  });

  C.add('总览', 't＝0（庆典交节）：日月都在塔腰、分居塔两侧；黑月；月盘中心比旁边内壁暗（＜30%）', function () {
    need();
    var h = H(), s = save(), P = h.model.P, A = h.astro;
    plain();
    h.app.setTime(0);
    var S = A.sunPos(0, P), Mo = A.moonPos(0, P);
    if (Math.abs(S.y) > 1e-6 || Math.abs(Mo.y) > 1e-6) throw new Error('高度不为 0');
    if (S.x * Mo.x + S.z * Mo.z >= 0) throw new Error('日月不在塔两侧');
    if (h.app.moonState() !== '黑月') throw new Error('月态：' + h.app.moonState());
    // 相机：在月的外侧往里看，视线擦过塔旁 2000 km，落在对面被照亮的内壁上（方位约 φ0＋123°）
    var al = Math.asin(2000 / P.rM), D = 2.4 * P.R, ph = P.phi0;
    function rot(p) { var c = Math.cos(ph), q = Math.sin(ph); return [p[0] * c - p[2] * q, p[1], p[0] * q + p[2] * c]; }
    var cam = rot([P.rM + D * Math.cos(al), 0.04 * P.R, -D * Math.sin(al)]), tgt = [Mo.x, Mo.y, Mo.z];
    h.store.set('ov.cam', { pos: cam.map(function (v) { return v / 1000; }), target: tgt.map(function (v) { return v / 1000; }) }, 'api');
    return h.app.settle(3).then(function () {
      var pm = h.ov.projectKm(tgt, false), pa = h.ov.projectKm([0, 0, 0], false);
      if (!pm.visible && pm.why !== 'wall') throw new Error('月不在画面里：' + pm.why);
      var rpx = (P.rhoM * h.state.ov.bodyScale) / (Math.hypot(cam[0] - tgt[0], cam[1] - tgt[1], cam[2] - tgt[2])) / Math.tan(19 * Math.PI / 180) * (h.gfx.size.cssH / 2);
      var dx = pm.x - pa.x, dy = pm.y - pa.y, dl = Math.hypot(dx, dy) || 1;
      var mx = pm.x, my = pm.y, wx = pm.x + dx / dl * rpx * 3, wy = pm.y + dy / dl * rpx * 3;
      var m = h.app.readPx(mx, my), w = h.app.readPx(wx, wy);
      var lm = lum(m), lw = lum(w), r = lm / Math.max(lw, 1e-6);
      var note = '月心 ' + m.join(',') + '，旁边内壁 ' + w.join(',') + '，线性亮度比 ' + (r * 100).toFixed(1) + '%（月盘半径约 ' + rpx.toFixed(0) + ' px）';
      return restore(s).then(function () { if (!(lw > 0.02)) throw new Error('旁边内壁太暗，采样点可能落在夜里：' + note); if (r >= 0.3) throw new Error(note); return note; });
    });
  });

  C.add('总览', '罪域子夜：罪域针下的内壁比对面白昼内壁暗 ≥5 倍', function () {
    need();
    var h = H(), s = save(), P = h.model.P, A = h.astro;
    plain();
    h.app.setSite('zuiyu');
    var O = A.site(6670, -4, P), t = A.localMidnight(-67, O, P);
    h.app.setTime(t);
    h.app.ovPreset('fromTop');
    return h.app.settle(3).then(function () {
      var a = h.ov.project(6670, -4), b = h.ov.project(6670, 176);
      if (!a.visible || !b.visible) throw new Error('看不到：罪域 ' + a.why + '，对面 ' + b.why);
      var pa = h.app.readPx(a.x, a.y), pb = h.app.readPx(b.x, b.y), r = lum(pb) / Math.max(lum(pa), 1e-6);
      var night = A.sunlitAt(O, t, P), day = A.sunlitAt(A.site(6670, 176, P), t, P);
      var note = '罪域 ' + pa.join(',') + '（受照 ' + night.toFixed(2) + '），对面 ' + pb.join(',') + '（受照 ' + day.toFixed(2) + '），线性亮度比 ' + r.toFixed(1) + ' 倍';
      return restore(s).then(function () { if (r < 5) throw new Error(note); return note; });
    });
  });

  C.add('总览', 'project 与 pick 往返（三个预设、各两处地点）', function () {
    need();
    var h = H(), s = save(), out = [];
    plain();
    var cases = [['fromTop', 6670, 176], ['fromTop', 4000, 120], ['oblique', 5600, 205], ['oblique', 3000, 230], ['side', 6000, 170], ['side', 9000, 200]];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        h.app.ovPreset(c[0]);
        return h.app.settle(2).then(function () {
          var q = h.ov.project(c[1], c[2]);
          if (!q.visible) { out.push(c[0] + ' ' + c[1] + '/' + c[2] + '：' + q.why + '（跳过）'); return; }
          var r = h.ov.pick(q.clientX, q.clientY);
          if (!r) throw new Error(c[0] + '：pick 没打中 ' + c[1] + '/' + c[2]);
          var e = Math.max(Math.abs(r.s - c[1]), Math.abs(((r.az - c[2] + 540) % 360) - 180) * Math.PI / 180 * 6371);
          if (e > 0.5) throw new Error(c[0] + ' ' + c[1] + '/' + c[2] + ' → ' + r.s.toFixed(2) + '/' + r.az.toFixed(3) + '，误差 ' + e.toFixed(2) + ' km');
          out.push(c[0] + ' ' + e.toFixed(3) + ' km');
        });
      });
    }, Promise.resolve()).then(function () { return restore(s); }).then(function () { return out.join('；'); });
  });

  C.add('总览', '切换全部 8 个预设无报错、相机有限、跟随预设跟得上', function () {
    need();
    var h = H(), s = save(), names = ['oblique', 'side', 'fromTop', 'fromRoot', 'above', 'sun', 'moon', 'winter'], e0 = errors.length, out = [];
    return names.reduce(function (p, n) {
      return p.then(function () {
        h.app.ovPreset(n);
        return h.app.settle(3).then(function () {
          var d = h.ov.debug();
          if (!fin(d.cam.pos) || !fin(d.cam.target)) throw new Error(n + '：相机不是有限数');
          if (h.state.ov.cam !== null) throw new Error(n + '：用了预设，ov.cam 应清空');
          out.push(n);
        });
      });
    }, Promise.resolve()).then(function () {
      // 跟随太阳：推进 6 小时，目标高度跟着 yS
      h.app.ovPreset('sun');
      h.app.setTime(h.state.time.t + 0.25);
      return h.app.settle(2);
    }).then(function () {
      var d = h.ov.debug(), yS = h.astro.sunPos(h.state.time.t, h.model.P).y / 1000;
      if (Math.abs(d.cam.target[1] - yS) > 1e-6) throw new Error('跟随太阳：目标高度 ' + d.cam.target[1] + '，应为 ' + yS);
      if (errors.length > e0) throw new Error('控制台报错：' + errors.slice(e0).join(' | '));
      return restore(s);
    }).then(function () { return out.join('、'); });
  });

  C.add('总览', '惯性系连续播放 300 帧无 NaN（读回中心像素）', function () {
    need();
    var h = H(), s = save();
    h.store.patch('ov', { frame: 'inertial', helix: 'mirror', trails: true, shadowVol: true, sight: true }, 'api');
    h.app.ovPreset('oblique');
    h.app.play(true, 864000);
    return h.app.settle(300).then(function () {
      h.app.play(false);
      var d = h.ov.debug(), px = h.app.readPx(h.gfx.size.cssW / 2, h.gfx.size.cssH / 2);
      if (!fin(d.sun) || !fin(d.moon) || !fin(d.cam.pos)) throw new Error('出现非有限数：' + JSON.stringify(d.sun) + JSON.stringify(d.moon));
      if (!px || !fin(px)) throw new Error('中心像素读不回来');
      var sp = h.ov.geom.spin(h.model.P, h.state.time.t), q = h.astro.toInertial({ x: 1, y: 0, z: 0 }, h.state.time.t, h.model.P);
      var dd = Math.abs(((sp - Math.atan2(q.z, q.x)) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      var note = '中心像素 ' + px.join(',') + '；转角与 toInertial 相差 ' + dd.toExponential(1) + ' rad';
      return restore(s).then(function () { if (dd > 1e-9) throw new Error(note); return note; });
    });
  });

  C.add('总览', '螺旋四种画法、剖切三种、开关全翻两遍：无报错，第二遍后几何数与第一遍后相同（不泄漏）', function () {
    need();
    var h = H(), s = save(), e0 = errors.length, infos = [];
    // 第一遍里各画法的几何是头一次上传（按需建），所以拿第一遍后的数当基准，第二遍后必须一样
    var steps = [
      { helix: 'real' }, { helix: 'strobe' }, { helix: 'off' }, { helix: 'mirror' },
      { helixTurns: 20 }, { helixTurns: 48 }, { sunGapX: 6 }, { bodyScale: 8 },
      { cut: 'ghost' }, { cut: 'none' }, { cut: 'half' }, { frame: 'inertial' }, { frame: 'ground' },
      { trails: false }, { shadowVol: false }, { grid: false }, { labels: false }, { sites: false }, { stars: false }, { sight: false }, { showMoon: false },
      { helix: 'mirror', trails: true, shadowVol: true, grid: true, labels: true, sites: true, stars: true, sight: true, showMoon: true, helixTurns: 12, sunGapX: 1, bodyScale: 3 }
    ];
    function pass() {
      return steps.reduce(function (p, st) { return p.then(function () { h.store.patch('ov', st, 'api'); return h.app.settle(2); }); }, Promise.resolve())
        .then(function () { infos.push(h.ov.debug().info); });
    }
    return pass().then(pass).then(pass).then(function () {
      if (errors.length > e0) throw new Error('控制台报错：' + errors.slice(e0).join(' | '));
      var a = infos[0], b = infos[2];
      var note = '三遍后几何 ' + infos.map(function (x) { return x.geometries; }).join('→') + '，纹理 ' + infos.map(function (x) { return x.textures; }).join('→') + '，绘制调用 ' + b.calls + '，三角形 ' + b.triangles;
      return restore(s).then(function () { if (a.geometries !== b.geometries || a.textures !== b.textures) throw new Error(note); return note; });
    });
  });

  C.add('总览', '跟随太阳时日面带光晕（日心像素明亮）；转到塔后被挡', function () {
    need();
    var h = H(), s = save(), P = h.model.P, A = h.astro;
    plain();
    h.store.patch('site', { id: 'yimeite', s: 4000, az: 2 }, 'api');
    var O = A.site(4000, 2, P), tNoon = A.localMidnight(10, O, P) + 0.5;
    h.app.setTime(tNoon);
    h.app.ovPreset('sun');
    return h.app.settle(3).then(function () {
      var S = A.sunPos(tNoon, P), p = h.ov.projectKm([S.x, S.y, S.z], false);
      if (!p.visible) throw new Error('跟随太阳时看不到太阳：' + p.why);
      var px = h.app.readPx(p.x, p.y), L = lum(px);
      // 从塔的另一侧看：太阳被塔挡住，光晕也看不见
      var th = Math.atan2(S.z, S.x) + Math.PI, D = 2.2 * P.R;
      h.store.set('ov.cam', { pos: [D * Math.cos(th) / 1000, S.y / 1000, D * Math.sin(th) / 1000], target: [0, S.y / 1000, 0] }, 'api');
      return h.app.settle(2).then(function () {
        var q = h.ov.projectKm([S.x, S.y, S.z], false), pq = h.app.readPx(q.x, q.y), Lq = lum(pq);
        var note = '日心 ' + px.join(',') + '（亮度 ' + L.toFixed(2) + '）；塔后 ' + q.why + ' ' + pq.join(',') + '（亮度 ' + Lq.toFixed(3) + '）';
        return restore(s).then(function () { if (L < 0.4 || q.why !== 'tower' || Lq > 0.1) throw new Error(note); return note; });
      });
    });
  });

  C.add('总览', '入冬镜头：10018 年为庆典，交节前后各半日里三点一线白线与标签一直在', function () {
    need();
    var h = H(), s = save(), miss = [], lab = '';
    h.store.patch('ov', { helix: 'mirror', labels: true, sites: true }, 'api');
    h.app.setTime(-0.5);
    h.app.ovPreset('winter');
    // 入冬镜头播的那一段（交节前 0.5 日到后 0.5 日）逐 0.05 日看：白线在、“三点一线·圣皇庆典”标签没被别的标签压掉
    var ts = [];
    for (var k = 0; k <= 20; k++) ts.push(-0.5 + k * 0.05);
    return ts.reduce(function (p, t) {
      return p.then(function () {
        h.app.setTime(t);
        return h.app.settle(1).then(function () {
          var d = h.ov.debug(), fest = h.ov.bodies.meshes().fest;
          if (!fest || !fest.visible || d.labels.indexOf('festival') < 0) miss.push(t.toFixed(2) + '（' + d.labels.join('、') + '）');
          if (Math.abs(t + 0.3) < 1e-9) lab = d.labels.join('、');
        });
      });
    }, Promise.resolve()).then(function () {
      var w = h.ov.geom.winterNear(h.model.P, h.state.time.t);
      var note = '第 ' + w.N + ' 年：' + w.phrase + '；21 个时刻里缺 ' + miss.length + ' 个' + (miss.length ? '：' + miss.slice(0, 4).join('；') : '') + '；t＝−0.3 的标签 ' + lab;
      return restore(s).then(function () {
        if (!w.festival || miss.length) throw new Error(note);
        return note;
      });
    });
  });

  C.add('总览', '螺旋画法“关”＝只画天体：没有螺旋、轨迹尾、每日同刻、三点一线', function () {
    need();
    var h = H(), s = save();
    h.store.patch('ov', { helix: 'off', trails: true, showMoon: true }, 'api');
    h.app.setTime(0.2);
    return h.app.settle(2).then(function () {
      var m = h.ov.bodies.meshes(), on = [];
      if (m.helix.sun.group.visible || m.helix.moon.group.visible) on.push('螺旋');
      if (m.trail.sun.line.visible || m.trail.moon.line.visible) on.push('轨迹尾');
      if (m.strobe.sun.pts.visible || m.strobe.moon.pts.visible) on.push('每日同刻');
      if (m.fest.visible) on.push('三点一线');
      if (!m.sun.visible || !m.moon.visible) on.push('（日月不见了）');
      h.store.patch('ov', { helix: 'mirror' }, 'api');
      return h.app.settle(1).then(function () {
        var tailBack = m.trail.sun.line.visible && m.helix.sun.group.visible;
        return restore(s).then(function () {
          if (on.length) throw new Error('“关”时还画着：' + on.join('、'));
          if (!tailBack) throw new Error('切回镜像双螺旋后螺旋与轨迹尾没回来');
          return '关：只剩日月；切回镜像双螺旋：螺旋与轨迹尾都回来';
        });
      });
    });
  });

  C.add('总览', 'ov.cam 是坏的（读档残缺）：当作没有，退回预设，相机仍是有限数', function () {
    need();
    var h = H(), s = save(), bad = [{ pos: [1, 2], target: [0, 0, 0] }, { pos: [1, null, 3], target: [0, 0, 0] }, { pos: 'x', target: [0, 0, 0] }], out = [];
    return bad.reduce(function (p, c) {
      return p.then(function () {
        h.store.patch('ov', { preset: 'side', cam: null }, 'api');
        return h.app.settle(1).then(function () {
          h.store.set('ov.cam', c, 'api');
          return h.app.settle(30);
        }).then(function () {
          var d = h.ov.debug();
          if (!fin(d.cam.pos) || !fin(d.cam.target)) throw new Error(JSON.stringify(c) + ' → 相机变成非有限数');
          if (d.follow !== 'side') throw new Error(JSON.stringify(c) + ' → 没有退回预设（follow＝' + d.follow + '）');
          out.push(JSON.stringify(c.pos));
        });
      });
    }, Promise.resolve()).then(function () { return restore(s); }).then(function () { return out.join('、') + ' 都退回“侧看”'; });
  });

  C.add('总览', '从第一人称回来：当前地点处的小锥指向 fp.yaw／fp.pitch', function () {
    need();
    var h = H(), s = save(), fpKeep = { yaw: h.state.fp.yaw, pitch: h.state.fp.pitch }, P = h.model.P, A = h.astro;
    h.store.patch('ov', { sites: true, frame: 'ground' }, 'api');
    h.app.setSite('zuiyu');
    h.store.patch('fp', { yaw: 30, pitch: 20 }, 'api');
    // 模拟一次“进第一人称再回来”（app 切视图时就是这样调的）
    h.ov.deactivate(); h.ov.activate();
    return h.app.settle(2).then(function () {
      var cone = h.ov.shell.meshes().cone, O = A.site(6670, -4, P), D = Math.PI / 180, y = 30 * D, p = 20 * D;
      var e = [0, 1, 2].map(function (i) { return Math.cos(p) * (Math.cos(y) * O.N[i] + Math.sin(y) * O.E[i]) + Math.sin(p) * O.U[i]; });
      var v = new G.THREE.Vector3(0, 1, 0).applyQuaternion(cone.quaternion);
      var err = Math.acos(Math.min(1, v.x * e[0] + v.y * e[1] + v.z * e[2])) / D;
      var note = '锥 ' + (cone.visible ? '在' : '不在') + '，方向偏差 ' + err.toFixed(4) + '°';
      h.store.patch('fp', fpKeep, 'api');
      return restore(s).then(function () { if (!cone.visible || err > 0.01) throw new Error(note); return note; });
    });
  });

  C.add('总览', '触屏两次轻点（＜350 ms）＝双击：设地点并要求进第一人称；鼠标单击不进', function () {
    need();
    var h = H(), s = save(), cv = h.gfx.canvas, orig = h.store.set, wrote = [];
    plain();
    h.app.setSite('zuiyu');
    h.app.ovPreset('fromTop');
    // 拦下 view.mode 的写入（真进第一人称会去编译着色器，这里只看总览有没有发出请求）
    h.store.set = function (p, v, src) { if (p === 'view.mode') { wrote.push(v + '/' + src); return h.state.view.mode; } return orig.apply(this, arguments); };
    function tap(type, x, y, pt) {
      ['pointerdown', 'pointerup'].forEach(function (k) {
        cv.dispatchEvent(new PointerEvent(k, { pointerId: 21, isPrimary: true, pointerType: pt, clientX: x, clientY: y, button: 0, buttons: k === 'pointerup' ? 0 : 1, bubbles: true }));
      });
    }
    return h.app.settle(2).then(function () {
      var q = h.ov.project(4000, 120), afterMouse, afterTouch, site;
      try {
        if (!q.visible) throw new Error('目标点看不到：' + q.why);
        tap('', q.clientX, q.clientY, 'mouse'); tap('', q.clientX, q.clientY, 'mouse');
        afterMouse = wrote.length;
        tap('', q.clientX, q.clientY, 'touch'); tap('', q.clientX + 2, q.clientY, 'touch');   // 第二下偏 2 px（＜24 仍算双击）
        afterTouch = wrote.slice();
        site = JSON.parse(JSON.stringify(h.state.site));
      } finally { h.store.set = orig; }
      var note = '鼠标两次单击后写 view.mode ' + afterMouse + ' 次；触屏两次轻点后 ' + (afterTouch.join('、') || '无') + '；地点 ' + site.s.toFixed(1) + '/' + site.az.toFixed(2);
      return restore(s).then(function () {
        if (afterMouse !== 0) throw new Error('鼠标单击不该进第一人称（鼠标双击走原生 dblclick）：' + note);
        if (afterTouch.join() !== 'fp/ov') throw new Error(note);
        // 从塔顶看远壁，一像素约 50 公里：第二下偏了 2 px，容差放到 200 公里
        if (Math.abs(site.s - 4000) > 200 || Math.abs(site.az - 120) > 3) throw new Error('没设上地点：' + note);
        return note;
      });
    }, function (e) { h.store.set = orig; throw e; });
  });

  C.add('总览', '预算：三角形＜15 万（默认与 48 圈）；每帧 CPU（总览这一段）', function () {
    need();
    var h = H(), s = save(), out = [];
    var orig = h.ov.frame, ms = [], now = function () { return G.performance ? G.performance.now() : Date.now(); };
    h.ov.frame = function (ctx) { var a = now(); orig(ctx); ms.push(now() - a); };
    h.store.patch('ov', { helix: 'mirror', helixTurns: 12, cut: 'half', trails: true, shadowVol: true, sight: true, labels: true, sites: true }, 'api');
    h.app.ovPreset('oblique');
    h.app.play(true, 86400);
    return h.app.settle(5).then(function () { ms.length = 0; return h.app.settle(120); }).then(function () {
      var d = h.ov.debug().info, avg = ms.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, ms.length);
      out.push('默认 ' + d.triangles + ' 个三角形、' + d.calls + ' 次绘制；总览每帧 CPU 平均 ' + avg.toFixed(2) + ' ms（含提交绘制）');
      var tri0 = d.triangles;
      h.store.set('ov.helixTurns', 48, 'api');
      return h.app.settle(3).then(function () {
        var d2 = h.ov.debug().info, gt = h.gfx.timer.results();
        out.push('48 圈 ' + d2.triangles + ' 个三角形');
        if (gt.ov != null) out.push('GPU ' + gt.ov.toFixed(2) + ' ms');
        h.ov.frame = orig;
        h.app.play(false);
        return restore(s).then(function () {
          if (tri0 >= 150000 || d2.triangles >= 150000) throw new Error(out.join('；'));
          return out.join('；');
        });
      });
    }, function (e) { h.ov.frame = orig; throw e; });
  });

  C.add('总览', '标签：当前地点优先（不被别的地点压掉）；塔根端被塔挡住时，“塔根·北极”改标在塔与内壁相接处', function () {
    need();
    var h = H(), s = save(), P = h.model.P, R = P.R / 1000;
    h.store.patch('ov', { labels: true, sites: true, helix: 'mirror', cut: 'half', frame: 'ground' }, 'api');
    h.app.setSite('zuiyu');
    h.app.ovPreset('fromTop');
    return h.app.settle(2).then(function () {
      var top = h.ov.debug().labels;
      // 镜头在球内、从塔腰斜上方往塔根看：塔端（穿出外壳处）在塔背后
      h.store.set('ov.cam', { pos: [0.3 * R, 0.2 * R, 0.3 * R], target: [0, -0.9 * R, 0] }, 'api');
      return h.app.settle(2).then(function () {
        var ins = h.ov.debug().labels, tip = h.ov.projectKm([0, -1.12 * P.R, 0], false);
        var note = '从塔顶看：' + top.join('、') + '；球内看塔根：' + ins.join('、') + '（塔端 ' + (tip.why || '可见') + '）';
        return restore(s).then(function () {
          if (top.indexOf('site:此地') < 0) throw new Error('从塔顶看罪域就在眼前，当前地点的标签却没画：' + note);
          if (tip.visible) return note + '（塔端可见，未验到改标）';
          if (ins.indexOf('root') < 0) throw new Error('塔端被挡时没有改标“塔根·北极”：' + note);
          return note;
        });
      });
    });
  });

  C.add('总览', '预设随画面宽高比重摆：竖屏拉远到 1/宽高比，转回来复原', function () {
    need();
    var h = H(), s = save();
    function dist() { var c = h.ov.debug().cam; return Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]); }
    h.app.ovPreset('oblique');
    return h.app.settle(2).then(function () {
      var d0 = dist(), W = h.gfx.size.w, Hh = h.gfx.size.h;
      if (W < Hh) return restore(s).then(function () { return '画布本身是竖的（' + W + '×' + Hh + '），跳过'; });
      h.ov.resize(400, 800);
      var d1 = dist();
      h.app.resize();
      var d2 = dist();
      var note = '横屏 ' + d0.toFixed(2) + '，竖屏 1:2 → ' + d1.toFixed(2) + '，复原 ' + d2.toFixed(2);
      return restore(s).then(function () {
        if (Math.abs(d1 / d0 - 2) > 1e-6 || Math.abs(d2 - d0) > 1e-6) throw new Error(note);
        return note;
      });
    });
  });

  C.add('总览', '单击设地点；双指（第二根指针中途按下）不算单击', function () {
    need();
    var h = H(), s = save(), cv = h.gfx.canvas;
    plain();
    h.app.setSite('zuiyu');
    h.app.ovPreset('fromTop');
    function ev(type, id, x, y, prim) {
      cv.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: !!prim, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
    }
    return h.app.settle(2).then(function () {
      var q = h.ov.project(4000, 120);
      if (!q.visible) throw new Error('目标点看不到：' + q.why);
      ev('pointerdown', 11, q.clientX, q.clientY, true);
      ev('pointerdown', 12, q.clientX + 60, q.clientY, false);
      ev('pointerup', 11, q.clientX, q.clientY);
      ev('pointerup', 12, q.clientX + 60, q.clientY);
      var a = JSON.parse(JSON.stringify(h.state.site));
      ev('pointerdown', 11, q.clientX, q.clientY, true);
      ev('pointerup', 11, q.clientX + 1, q.clientY);
      var b = JSON.parse(JSON.stringify(h.state.site));
      var note = '双指后 ' + a.id + ' ' + a.s + '/' + a.az + '；单击后 ' + b.id + ' ' + b.s.toFixed(1) + '/' + b.az.toFixed(2);
      return restore(s).then(function () {
        if (a.id !== 'zuiyu') throw new Error('双指被当成了单击：' + note);
        // 抬起时挪了 1 像素（＜4 仍算单击）：从塔顶看远壁一像素约 50 公里
        if (b.id !== null || Math.abs(b.s - 4000) > 150 || Math.abs(b.az - 120) > 2) throw new Error('单击没有设上地点：' + note);
        return note;
      });
    });
  });

  C.add('总览', '降级走法：8 位目标（OV_TONED）、WebGL1 直出（OV_DIRECT）都能编译出图，读数与浮点走法相近', function () {
    need();
    var h = H(), s = save(), caps = h.gfx.caps, keep = { webgl2: caps.webgl2, floatRT: caps.floatRT }, e0 = errors.length, out = [], base = null;
    plain();
    h.app.setSite('zuiyu');
    var P = h.model.P, O = h.astro.site(6670, 176, P), t = h.astro.localMidnight(-67, O, P) + 0.5;
    h.app.setTime(t);
    function shot(label) {
      h.ov.init(h.gfx); h.ov.activate(); h.app.resize();
      h.app.ovPreset('fromTop');
      return h.app.settle(2).then(function () {
        var q = h.ov.project(6670, 176), px = q.visible ? h.app.readPx(q.x, q.y) : null, bg = h.app.readPx(3, 3);
        out.push(label + '（' + h.ov.debug().mode + '）内壁 ' + (px ? px.join(',') : q.why) + '，角上背景 ' + (bg ? bg.join(',') : '无'));
        return px && bg ? px.concat(bg) : null;
      });
    }
    function back() { caps.webgl2 = keep.webgl2; caps.floatRT = keep.floatRT; h.ov.init(h.gfx); h.ov.activate(); h.app.resize(); }
    return shot('浮点').then(function (p) {
      base = p; caps.floatRT = false; return shot('8 位');
    }).then(function (p8) {
      caps.webgl2 = false; return shot('直出').then(function (pd) { return [p8, pd]; });
    }).then(function (r) {
      back();
      var bad = !base || !r[0] || !r[1] ? '读不到像素' : '';
      [r[0], r[1]].forEach(function (p) {
        if (!p || !base) return;
        for (var i = 0; i < 6; i++) if (Math.abs(p[i] - base[i]) > 10) bad = '与浮点走法相差超过 10/255（内壁或背景）';
      });
      if (errors.length > e0) bad = '控制台报错：' + errors.slice(e0).join(' | ');
      return restore(s).then(function () { if (bad) throw new Error(bad + '：' + out.join('；')); return out.join('；'); });
    }, function (err) { back(); throw err; });
  });

  C.add('总览', '控制台无错误', function () {
    if (errors.length) throw new Error(errors.length + ' 条：' + errors.slice(0, 3).join(' | '));
    return '0 条';
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
