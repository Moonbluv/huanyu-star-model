/* HY.ov.bodies —— 日、月、镜像双螺旋、实际轨迹、每日同刻、塔影体、视线、三点一线（规格：spec/03 第六节第 4–6 条）
 * 负责：B 路。只给 overview.js 用（内部接口）：
 *   build(c)          建网格与材质；c＝{THREE, spin, world, U, col, mat}
 *   rebuild(P, o)     参数或画法参数变了：螺旋管（只在 P、圈数、日轨放大变时重建）、包络、本体大小
 *   update(f)         每帧：日月位置、螺旋转角、轨迹、每日同刻、塔影体、视线、三点一线 → 返回标签锚点
 *   dispose()
 * 日月位置一律取 HY.astro（sunPos、moonPos、toInertial、look、isFestival），画法的几何取 HY.ov.geom；这里不另立公式。
 * 日轨放大（ov.sunGapX＞1）只改“画在哪”：太阳本体、示意螺旋、轨迹画在离轴 a＋(dS−a)·gapX 处（同方位、同高度）；
 * 内壁光照（共享 uniform uSunW）、塔影体、视线的遮挡判定一律仍按真实位置。
 * 大多数东西挂在“随星体转”的组（地固系）；实际轨迹在惯性系里逐点 toInertial，所以挂在世界组。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ov = HY.ov = HY.ov || {};
  var K = 1e-3;
  var TRAIL_MAX = 2800, STROBE_MAX = 512;
  // 交节那一刻日、塔、月在一条横线上，紧挨着的上下两处常被日月圆盘与它们的字占着：再试更高、更低一层，最后才左右
  var FEST_PLACE = ['above', 'below', 'above2', 'below2', 'left', 'right'];

  var b = ov.bodies = {};
  var c = null, m = {}, helixKey = '';

  b.build = function (ctx) {
    c = ctx;
    var THREE = c.THREE, U = c.U, col = c.col;
    // 太阳：自发光小球＋屏幕空间光晕
    m.sunGeo = new THREE.SphereGeometry(1, 32, 24);
    m.sunMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(col.sun).multiplyScalar(3.2) }, uAlpha: { value: 1 } });
    m.sun = new THREE.Mesh(m.sunGeo, m.sunMat); m.sun.name = '日';
    c.spin.add(m.sun);
    m.glowGeo = new THREE.PlaneGeometry(1, 1);
    m.glowMat = c.mat('ov_obj_vert', 'ov_glow', { uColor: { value: v3(col.sun).multiplyScalar(1.6) }, uAlpha: { value: 1 } },
      { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.glow = new THREE.Mesh(m.glowGeo, m.glowMat); m.glow.name = '日·光晕';
    m.glow.renderOrder = 30; m.glow.frustumCulled = false;
    c.world.add(m.glow);
    // 月
    m.moonGeo = new THREE.SphereGeometry(1, 64, 48);
    m.moonMat = c.mat('ov_obj_vert', 'ov_moon', {
      uA: U.uA, uSunW: U.uSunW, uSunRho: U.uSunRho, uMoonW: U.uMoonW, uMoonRho: U.uMoonRho,
      uMoonCol: { value: v3(col.moon) }, uDarkBase: { value: 0.05 }
    }, { occl: true });
    m.moon = new THREE.Mesh(m.moonGeo, m.moonMat); m.moon.name = '月';
    c.spin.add(m.moon);

    // 镜像双螺旋：两组（各含管子与交节小环），每帧整组绕 y 转。
    //   一金一银要读得出是一对：日管更亮（贴着塔面、按实比例只有 40 km 宽的空隙，暗了就被黑塔吞掉），月管细一些、偏银蓝
    //   （--moon 本身近灰，乘上远离此刻的 25% 衰减后整条发灰，看不出“银蓝”）
    m.helix = {};
    var moonHelixCol = [0, 1, 2].map(function (i) { return col.moon[i] * 0.55 + [0.30, 0.48, 0.95][i] * 0.45; });
    ['sun', 'moon'].forEach(function (body) {
      var gp = new THREE.Group(); gp.name = body === 'sun' ? '日螺旋' : '月螺旋';
      var mat = c.mat('ov_helix_vert', 'ov_helix', {
        uColor: { value: v3(body === 'sun' ? col.sun : moonHelixCol) }, uCool: { value: new THREE.Vector3(0.62, 0.78, 1.25) },
        uWarm: { value: new THREE.Vector3(1.25, 0.92, 0.66) }, uNowU: { value: 0 }, uGain: { value: body === 'sun' ? 2.2 : 1.35 },
        uTubeR: { value: 0 }, uMaxAng: { value: 0.0035 }      // 近处收细：看上去的半粗至多约 0.2°（ov_helix.vert）
      });
      c.spin.add(gp);
      m.helix[body] = { group: gp, mat: mat, mesh: null, geo: null, rings: [] };
    });
    m.ringGeo = new THREE.TorusGeometry(1, 0.14, 8, 40); m.ringGeo.rotateX(Math.PI / 2);
    m.winterMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(col.winter).multiplyScalar(1.5) }, uAlpha: { value: 1 } });
    m.summerMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(col.summer).multiplyScalar(1.5) }, uAlpha: { value: 1 } });

    // 实际轨迹的包络圆筒（r＝dS 或放大后的半径、rM；y∈[−A, A]）
    //   薄玻璃似的筒面（ov_env：掠射处亮、正对处几乎透明）＋上下两道折返圈（y＝±A）
    m.envGeo = new THREE.CylinderGeometry(1, 1, 2, 128, 1, true);
    m.envSun = new THREE.Mesh(m.envGeo, c.mat('ov_obj_vert', 'ov_env', { uColor: { value: v3(col.sun) }, uAlpha: { value: 0.16 } },
      { transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.envMoon = new THREE.Mesh(m.envGeo, c.mat('ov_obj_vert', 'ov_env', { uColor: { value: v3(col.moon) }, uAlpha: { value: 0.22 } },
      { transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.envSun.name = '日轨包络'; m.envMoon.name = '月轨包络';
    m.envSun.renderOrder = m.envMoon.renderOrder = 12;
    var rn = 128, rp = new Float32Array(3 * 2 * rn), ri = [];
    for (var e = 0; e < rn; e++) {
      var ea = 2 * Math.PI * e / rn;
      rp.set([Math.cos(ea), 1, Math.sin(ea)], 3 * e); rp.set([Math.cos(ea), -1, Math.sin(ea)], 3 * (rn + e));
      ri.push(e, (e + 1) % rn, rn + e, rn + (e + 1) % rn);
    }
    m.envRimGeo = new THREE.BufferGeometry();
    m.envRimGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    m.envRimGeo.setIndex(ri);
    [['envSun', col.sun, 0.55], ['envMoon', col.moon, 0.45]].forEach(function (q) {
      var rim = new THREE.LineSegments(m.envRimGeo, c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(q[1]) }, uAlpha: { value: q[2] } },
        { transparent: true, depthWrite: false }));
      rim.name = '折返圈'; m[q[0]].add(rim);
    });
    c.spin.add(m.envSun); c.spin.add(m.envMoon);

    // 实际轨迹／彗尾（世界组）：位置＋每点透明度
    m.trail = {};
    ['sun', 'moon'].forEach(function (body) {
      var geo = new THREE.BufferGeometry(), pos = new Float32Array(3 * TRAIL_MAX), al = new Float32Array(TRAIL_MAX);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aT', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      var line = new THREE.Line(geo, c.mat('ov_line_vert', 'ov_line', {
        uColor: { value: v3(body === 'sun' ? col.sun : col.moon).multiplyScalar(body === 'sun' ? 1.4 : 1.1) }, uAlpha: { value: 0.95 }, uTMode: { value: 1 }
      }, { transparent: true, depthWrite: false }));
      line.frustumCulled = false; line.name = body === 'sun' ? '日·实际轨迹' : '月·实际轨迹';
      c.world.add(line);
      m.trail[body] = { line: line, geo: geo, pos: pos, al: al };
    });

    // 每日同刻（随星体转的组）：一年里每天同一时刻的位置
    m.strobe = {};
    ['sun', 'moon'].forEach(function (body) {
      var geo = new THREE.BufferGeometry(), pos = new Float32Array(3 * STROBE_MAX), al = new Float32Array(STROBE_MAX);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aT', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      var pts = new THREE.Points(geo, c.mat('ov_line_vert', 'ov_line', {
        uColor: { value: v3(body === 'sun' ? col.sun : col.moon).multiplyScalar(1.3) }, uAlpha: { value: 1 }, uTMode: { value: 1 },
        uPoint: { value: 1 }, uPointSize: U.uPointSize
      }, { transparent: true, depthWrite: false }));
      pts.frustumCulled = false; pts.name = body === 'sun' ? '日·每日同刻' : '月·每日同刻';
      // 同一份几何再画一条淡线把逐日的点连起来：太阳是一条竖线，月亮是一年 12¼ 圈的螺旋
      var ln = new THREE.Line(geo, c.mat('ov_line_vert', 'ov_line', {
        uColor: { value: v3(body === 'sun' ? col.sun : col.moon) }, uAlpha: { value: 0.38 }, uTMode: { value: 1 }
      }, { transparent: true, depthWrite: false }));
      ln.frustumCulled = false; ln.name = pts.name + '·连线';
      c.spin.add(pts); c.spin.add(ln);
      m.strobe[body] = { pts: pts, line: ln, geo: geo, pos: pos, al: al, key: '' };
    });

    // 塔影体：本影、半影四个竖直面＋与内壁的交线＋三张水平切片（塔腰与上下各半个 R；按真实日心逐片元算塔影，
    //   本影最浓、半影渐淡）。原先只有 8% 的暗灰竖面，在深色内壁前完全看不出，从塔顶往下看时又侧对着相机；
    //   切片从塔顶、斜看都看得到一道贯通两极的楔形（03 第六节第 6 条）
    m.wedge = [];
    var nightTint = [0, 1, 2].map(function (i) { return col.night[i] * 0.16; });
    for (var i = 0; i < 4; i++) {
      var um = i < 2;
      var qg = new THREE.BufferGeometry(), qp = new Float32Array(12);
      qg.setAttribute('position', new THREE.BufferAttribute(qp, 3).setUsage(THREE.DynamicDrawUsage));
      qg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
      qg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
      qg.setIndex([0, 1, 2, 2, 1, 3]);
      var quad = new THREE.Mesh(qg, c.mat('ov_obj_vert', 'ov_wedge', {
        uColor: { value: um ? v3(nightTint) : v3(nightTint).multiplyScalar(1.4) },
        uAlpha: { value: um ? 0.2 : 0.09 }, uRs: U.uRs, uDisk: { value: 0 }, uKmPer: { value: 1 / K }
      }, { transparent: true, depthWrite: false, side: THREE.DoubleSide, occl: true }));
      quad.frustumCulled = false; quad.renderOrder = 14; quad.name = um ? '塔影体·本影面' : '塔影体·半影面';
      var ag = new THREE.BufferGeometry(), ap = new Float32Array(3 * 49);
      ag.setAttribute('position', new THREE.BufferAttribute(ap, 3).setUsage(THREE.DynamicDrawUsage));
      var arc = new THREE.Line(ag, c.mat('ov_line_vert', 'ov_line', {
        uColor: { value: v3(col.night).multiplyScalar(um ? 1.1 : 0.8) }, uAlpha: { value: um ? 0.9 : 0.45 }, uCutMode: U.uWallCut, uClipN: U.uClipN
      }, { transparent: true, depthWrite: false }));
      arc.frustumCulled = false; arc.name = '塔影与内壁的交线';
      c.spin.add(quad); c.spin.add(arc);
      m.wedge.push({ quad: quad, qp: qp, arc: arc, ap: ap });
    }
    // 水平切片：单位圆盘（y＝0 平面），按 P 缩放、摆到各自高度；物体坐标＝地固系 km（÷R），着色器里乘 uKmPer 换回 km
    m.sliceGeo = new THREE.CircleGeometry(1, 128); m.sliceGeo.rotateX(-Math.PI / 2);
    m.slices = [[0, 0.34], [0.5, 0.2], [-0.5, 0.2]].map(function (q) {
      var mesh = new THREE.Mesh(m.sliceGeo, c.mat('ov_obj_vert', 'ov_wedge', {
        uColor: { value: v3(nightTint) }, uAlpha: { value: q[1] }, uRs: U.uRs, uDisk: { value: 1 }, uKmPer: { value: 1 }, uSliceY: { value: 0 }
      }, { transparent: true, depthWrite: false, side: THREE.DoubleSide, occl: true }));
      mesh.frustumCulled = false; mesh.renderOrder = 13; mesh.name = '塔影体·切片'; mesh.userData.h = q[0];
      c.spin.add(mesh);
      return mesh;
    });

    // 视线：地点 → 日、月（被塔挡住时红色虚线）
    m.sight = {};
    ['sun', 'moon'].forEach(function (body) {
      var geo = new THREE.BufferGeometry(), pos = new Float32Array(6), dist = new Float32Array(2);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aT', new THREE.BufferAttribute(dist, 1).setUsage(THREE.DynamicDrawUsage));
      var mat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: new THREE.Vector3(1, 1, 1) }, uAlpha: { value: 0.9 }, uTMode: { value: 0 }, uDash: { value: 0.05 } },
        { transparent: true, depthWrite: false });
      var line = new THREE.Line(geo, mat); line.frustumCulled = false; line.name = body === 'sun' ? '视线·日' : '视线·月';
      c.spin.add(line);
      m.sight[body] = { line: line, geo: geo, pos: pos, dist: dist, mat: mat };
    });
    m.sightCol = { sun: v3(col.sun).multiplyScalar(1.2), moon: v3(col.moon), bad: v3(col.bad).multiplyScalar(1.3) };

    // 三点一线（庆典年入冬交节那一刻的日、塔轴、月）
    var fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
    m.fest = new THREE.Line(fg, c.mat('ov_line_vert', 'ov_line', { uColor: { value: new THREE.Vector3(1.3, 1.3, 1.3) }, uAlpha: { value: 0.85 } },
      { transparent: true, depthWrite: false }));
    m.fest.frustumCulled = false; m.fest.name = '三点一线';
    c.spin.add(m.fest);
    return m;
  };

  function v3(a) { return new c.THREE.Vector3(a[0], a[1], a[2]); }

  // 参数变了。o＝HY.state.ov。螺旋管只在 (pv, 圈数, 日轨放大) 变时重建
  b.rebuild = function (P, o, pv) {
    if (!c) return;
    var gm = ov.geom, key = pv + '|' + o.helixTurns + '|' + o.sunGapX;
    if (key !== helixKey) {
      helixKey = key;
      ['sun', 'moon'].forEach(function (body) {
        var h = m.helix[body];
        if (h.mesh) { h.group.remove(h.mesh); h.geo.dispose(); }
        h.rings.forEach(function (r) { h.group.remove(r); });
        h.rings = [];
        var hx = gm.helix(P, body, o.helixTurns, o.sunGapX), rOrb = gm.orbitRadius(P, body, o.sunGapX);
        // 日管 16 km（不放大时；离塔面 40 km，管壁离塔面还有 24 km），月管 15 km：两条粗细相近，读得出是一对
        var rTube = body === 'sun' ? Math.min(16 * (1 + 0.25 * (o.sunGapX - 1)), 0.6 * (rOrb - P.a)) : 15;
        var pos = new Float32Array(hx.pos.length);
        for (var i = 0; i < pos.length; i++) pos[i] = hx.pos[i] * K;
        var tb = gm.tube(pos, rTube * K, o.helixTurns > 24 ? 6 : 8), au = new Float32Array(tb.src.length);
        for (var j = 0; j < au.length; j++) au[j] = hx.u[tb.src[j]];
        var geo = new c.THREE.BufferGeometry();
        geo.setAttribute('position', new c.THREE.BufferAttribute(tb.position, 3));
        geo.setAttribute('normal', new c.THREE.BufferAttribute(tb.normal, 3));
        geo.setAttribute('aU', new c.THREE.BufferAttribute(au, 1));
        geo.setIndex(new c.THREE.BufferAttribute(tb.index, 1));
        geo.computeBoundingSphere();
        h.geo = geo;
        h.mat.uniforms.uTubeR.value = rTube * K;
        h.mesh = new c.THREE.Mesh(geo, h.mat);
        h.mesh.name = body === 'sun' ? '日螺旋管' : '月螺旋管';
        h.group.add(h.mesh);
        // 交节小环：入冬（u＝0）、入夏（u＝0.5）；圈数为偶数时两处在螺旋上重合，入夏的环画大一圈
        [[0, m.winterMat, 2.6], [0.5, m.summerMat, 3.6]].forEach(function (q) {
          var p = gm.helixPoint(P, body, q[0], o.helixTurns, o.sunGapX);
          var ring = new c.THREE.Mesh(m.ringGeo, q[1]), rr = rTube * q[2] * K;
          ring.position.set(p[0] * K, p[1] * K, p[2] * K); ring.scale.set(rr, rr, rr);
          ring.name = q[0] ? '入夏交节' : '入冬交节';
          h.group.add(ring); h.rings.push(ring);
        });
      });
    }
    // 包络圆筒
    var rS = gm.orbitRadius(P, 'sun', o.sunGapX);
    m.envSun.scale.set(rS * K, P.A * K, rS * K);
    m.envMoon.scale.set(P.rM * K, P.A * P.mirror * K, P.rM * K);
    m.wedgeLen = Math.sqrt(Math.max(0, P.R * P.R - P.a * P.a));
    // 塔影切片：高 y＝h·R 处的圆盘，半径到内壁 rr。物体坐标是单位圆：x、z 乘 uKmPer（＝rr）是地固系 km，高度另给 uSliceY
    (m.slices || []).forEach(function (s) {
      var y = s.userData.h * P.R, rr = Math.sqrt(Math.max(0, P.R * P.R - y * y));
      s.position.set(0, y * K, 0); s.scale.set(rr * K, 1, rr * K);
      s.material.uniforms.uKmPer.value = rr;
      s.material.uniforms.uSliceY.value = y;
    });
  };

  var tmpV = null, tmpQ = null;
  // f＝{P, t, o（HY.state.ov）, cal: now.cal, camera, camWorld(Vector3, 场景单位), dispSpin, site: astro.site, siteCut: bool,
  //     moonState, winter: {N, t, festival}}
  // → 标签锚点 [{id, text, X:[km 地固系], kind, prio}]
  b.update = function (f) {
    if (!c) return [];
    var P = f.P, t = f.t, o = f.o, A = HY.astro, gm = ov.geom, U = c.U, THREE = c.THREE;
    tmpV = tmpV || new THREE.Vector3(); tmpQ = tmpQ || new THREE.Quaternion();
    var S = A.sunPos(t, P), Mo = A.moonPos(t, P), gs = gm.gapScale(P, o.sunGapX);
    var Sd = [S.x * gs, S.y, S.z * gs], showMoon = !!o.showMoon;
    U.uSunW.value.set(S.x, S.y, S.z); U.uSunRho.value = P.rhoS;
    U.uMoonW.value.set(Mo.x, Mo.y, Mo.z); U.uMoonRho.value = P.rhoM;
    var anchors = [];

    // 本体
    var rDisp = gm.orbitRadius(P, 'sun', o.sunGapX), rSun = Math.min(P.rhoS * o.bodyScale, 0.8 * (rDisp - P.a));
    m.sun.position.set(Sd[0] * K, Sd[1] * K, Sd[2] * K);
    m.sun.scale.setScalar(rSun * K);
    var rMoon = P.rhoM * o.bodyScale;
    m.moon.position.set(Mo.x * K, Mo.y * K, Mo.z * K);
    m.moon.scale.setScalar(rMoon * K);
    m.moon.visible = showMoon;
    // 光晕：世界坐标里的日心，朝相机挪出日球半径，按距离缩放成固定屏幕大小
    var cs = Math.cos(f.dispSpin), sn = Math.sin(f.dispSpin);
    var wx = (Sd[0] * cs - Sd[2] * sn) * K, wy = Sd[1] * K, wz = (Sd[0] * sn + Sd[2] * cs) * K;
    tmpV.set(f.camWorld.x - wx, f.camWorld.y - wy, f.camWorld.z - wz);
    var dCam = tmpV.length() || 1;
    tmpV.multiplyScalar(1 / dCam);
    var off = Math.min(rSun * K * 1.05, dCam * 0.5);
    m.glow.position.set(wx + tmpV.x * off, wy + tmpV.y * off, wz + tmpV.z * off);
    m.glow.quaternion.copy(f.camera.quaternion);
    m.glow.scale.setScalar(dCam * 0.085);
    // rad：本体半径（km），标签按它在屏幕上的大小挪到圆盘外（不写在月面上）；px：再加的像素（日的光晕是固定屏幕大小）
    anchors.push({ id: 'sun', text: '日', X: Sd, kind: 'body', prio: 1, rad: rSun, px: 10 });
    if (showMoon) anchors.push({ id: 'moon', text: '月（' + f.moonState + '）', X: [Mo.x, Mo.y, Mo.z], kind: 'body', prio: 1, rad: rMoon });

    // 螺旋画法
    var mode = o.helix, u = gm.uOf(P, t);
    ['sun', 'moon'].forEach(function (body) {
      var h = m.helix[body], on = mode === 'mirror' && (body === 'sun' || showMoon);
      h.group.visible = on;
      if (on) { h.group.rotation.y = -gm.helixAngle(P, body, t, o.helixTurns); h.mat.uniforms.uNowU.value = u; }
    });
    m.envSun.visible = mode === 'real';
    m.envMoon.visible = mode === 'real' && showMoon;
    // 轨迹尾（ov.trails）只跟示意螺旋、每日同刻两种画法；“实际轨迹”自带前后整段；“关”＝只画天体（03 第六节第 5 条）
    var tailHow = mode === 'real' ? 'full' : mode !== 'off' && o.trails ? 'tail' : 'off';
    trail('sun', tailHow);
    trail('moon', showMoon ? tailHow : 'off');
    strobe('sun', mode === 'strobe');
    strobe('moon', mode === 'strobe' && showMoon);

    function trail(body, how) {
      var T = m.trail[body];
      T.line.visible = how !== 'off';
      if (how === 'off') return;
      var win = body === 'sun' ? 0.5 : 1, inert = o.frame === 'inertial';
      var from = -win, to = how === 'full' ? win : 0;
      var turns = (to - from) * (inert ? P.spinOmega * P.daySec / (2 * Math.PI) + 1 : 1);
      var n = Math.min(TRAIL_MAX, Math.max(121, Math.ceil(turns * 64) + 1));
      var arr = gm.trail(P, body, t, from, to, n, inert ? 'inertial' : 'ground'), g = body === 'sun' ? gs : 1;
      for (var i = 0; i < n; i++) {
        T.pos[3 * i] = arr[3 * i] * g * K; T.pos[3 * i + 1] = arr[3 * i + 1] * K; T.pos[3 * i + 2] = arr[3 * i + 2] * g * K;
        var off2 = from + (to - from) * i / (n - 1), k = 1 - Math.abs(off2) / win;
        T.al[i] = Math.pow(Math.max(k, 0), 1.5) * (off2 > 0 ? 0.55 : 1);
      }
      T.geo.attributes.position.needsUpdate = true; T.geo.attributes.aT.needsUpdate = true;
      T.geo.setDrawRange(0, n);
    }
    function strobe(body, on) {
      var Sx = m.strobe[body];
      Sx.pts.visible = Sx.line.visible = on;
      if (!on) return;
      var n = Math.min(STROBE_MAX, Math.max(2, Math.round(P.Y))), key = t + '|' + n + '|' + o.sunGapX + '|' + f.pv;
      if (key === Sx.key) return;
      Sx.key = key;
      var arr = gm.strobe(P, body, t, n), h = Math.floor(n / 2), g = body === 'sun' ? gs : 1;
      for (var i = 0; i < n; i++) {
        Sx.pos[3 * i] = arr[3 * i] * g * K; Sx.pos[3 * i + 1] = arr[3 * i + 1] * K; Sx.pos[3 * i + 2] = arr[3 * i + 2] * g * K;
        Sx.al[i] = 1 - 0.78 * Math.abs(i - h) / h;
      }
      Sx.geo.attributes.position.needsUpdate = true; Sx.geo.attributes.aT.needsUpdate = true;
      Sx.geo.setDrawRange(0, n);
    }

    // 塔影体：一律按真实日心
    var wOn = !!o.shadowVol;
    (m.slices || []).forEach(function (s) { s.visible = wOn; });
    var W = wOn ? gm.shadowWedge(P, S) : null, Rk = P.R * K, lines = W ? [W.umbra[0], W.umbra[1], W.penumbra[0], W.penumbra[1]] : [];
    m.wedge.forEach(function (w, i) {
      w.quad.visible = w.arc.visible = wOn;
      if (!wOn) return;
      var e = lines[i], p = e.p, d = e.dir, L = e.len;
      var x0 = p[0] * K, z0 = p[2] * K, x1 = (p[0] + d[0] * L) * K, z1 = (p[2] + d[2] * L) * K, q = w.qp;
      q[0] = x0; q[1] = -Rk; q[2] = z0;  q[3] = x1; q[4] = -Rk; q[5] = z1;
      q[6] = x0; q[7] = Rk;  q[8] = z0;  q[9] = x1; q[10] = Rk; q[11] = z1;
      w.quad.geometry.attributes.position.needsUpdate = true;
      gm.wedgeArc(e, 49, w.ap);
      for (var k2 = 0; k2 < w.ap.length; k2++) w.ap[k2] *= K * 0.998;
      w.arc.geometry.attributes.position.needsUpdate = true;
    });

    // 视线：画到显示位置；被挡与否按真实位置（露出不足一半算被挡）
    var O = f.site;
    ['sun', 'moon'].forEach(function (body) {
      var sl = m.sight[body], on = !!o.sight && !f.siteCut && (body === 'sun' || showMoon);
      sl.line.visible = on;
      if (!on) return;
      var real = body === 'sun' ? S : Mo, disp = body === 'sun' ? Sd : [Mo.x, Mo.y, Mo.z];
      var vis = A.look(O, real, P).vis, blocked = vis < 0.5;
      var p = sl.pos;
      p[0] = O.x * K; p[1] = O.y * K; p[2] = O.z * K; p[3] = disp[0] * K; p[4] = disp[1] * K; p[5] = disp[2] * K;
      sl.dist[0] = 0; sl.dist[1] = Math.sqrt((p[3] - p[0]) * (p[3] - p[0]) + (p[4] - p[1]) * (p[4] - p[1]) + (p[5] - p[2]) * (p[5] - p[2]));
      sl.geo.attributes.position.needsUpdate = true; sl.geo.attributes.aT.needsUpdate = true;
      var u2 = sl.mat.uniforms;
      u2.uTMode.value = blocked ? 2 : 0;
      u2.uDash.value = Math.max(0.004, f.camDist * 0.006);
      u2.uColor.value.copy(blocked ? m.sightCol.bad : m.sightCol[body]);
      u2.uAlpha.value = blocked ? 0.95 : 0.75;
    });

    // 三点一线：当年入冬交节若是庆典年，交节那一刻的日（显示位置）、塔轴、月（月隐藏时一并隐藏）
    var fw = f.winter, fOn = !!(fw && fw.festival && mode !== 'off' && showMoon);
    m.fest.visible = fOn;
    if (fOn) {
      var Sw = A.sunPos(fw.t, P), Mw = A.moonPos(fw.t, P), fp = m.fest.geometry.attributes.position;
      fp.array[0] = Sw.x * gs * K; fp.array[1] = Sw.y * K; fp.array[2] = Sw.z * gs * K;
      fp.array[3] = Mw.x * K; fp.array[4] = Mw.y * K; fp.array[5] = Mw.z * K;
      fp.needsUpdate = true;
      // 标签放在塔与月之间的线上，文字摆在线的正上方（挤不下就正下方）：入冬镜头里日、月、“塔腰”都挤在塔腰
      //   这一条横线上，月还会从锚点前面经过，放在锚点右侧会被“月”的标签压掉（避让时后画的隐藏）。
      //   优先级排在两极之后、其它地点之前。
      //   文案写明是哪一刻：画的是本年入冬交节那一刻的连线，平日看过去不能让人以为“此刻正三点一线”
      anchors.push({ id: 'festival', text: '入冬交节时三点一线·圣皇庆典', X: [Mw.x * 0.62, Mw.y, Mw.z * 0.62], kind: 'free', prio: 2.5, place: FEST_PLACE });
    }
    return anchors;
  };

  b.meshes = function () { return m; };
  b.dispose = function () {
    if (!c) return;
    function kill(o) {
      if (!o) return;
      if (o.parent) o.parent.remove(o);
      if (o.geometry && o.geometry !== m.ringGeo && o.geometry !== m.envGeo) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    }
    [m.envSun, m.envMoon].forEach(function (o) { if (o) o.children.slice().forEach(function (ch) { o.remove(ch); ch.material.dispose(); }); });
    if (m.envRimGeo) m.envRimGeo.dispose();
    [m.sun, m.glow, m.moon, m.envSun, m.envMoon, m.fest].forEach(kill);
    ['sun', 'moon'].forEach(function (body) {
      var h = m.helix[body];
      if (h) { if (h.mesh) kill(h.mesh); h.rings.forEach(function (r) { if (r.parent) r.parent.remove(r); }); if (h.group.parent) h.group.parent.remove(h.group); }
      if (m.trail[body]) kill(m.trail[body].line);
      if (m.strobe[body]) { if (m.strobe[body].line) { if (m.strobe[body].line.parent) m.strobe[body].line.parent.remove(m.strobe[body].line); m.strobe[body].line.material.dispose(); } kill(m.strobe[body].pts); }
      if (m.sight[body]) kill(m.sight[body].line);
    });
    m.wedge.forEach(function (w) { kill(w.quad); kill(w.arc); });
    (m.slices || []).forEach(function (s) { if (s.parent) s.parent.remove(s); s.material.dispose(); });
    [m.ringGeo, m.envGeo, m.sliceGeo].forEach(function (g) { if (g) g.dispose(); });
    [m.winterMat, m.summerMat].forEach(function (x) { if (x) x.dispose(); });
    m = {}; c = null; helixKey = ''; tmpV = tmpQ = null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
