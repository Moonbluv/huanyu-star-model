/* HY.ov.shell —— 内壁、巨塔、剖切、网格、分域环、地点针（规格：spec/03 第六节第 2、3、7 条）
 * 负责：B 路。只给 overview.js 用（内部接口）：
 *   build(c)            建网格与材质；c＝{THREE, spin, world, U, col, mat}（见 overview.js 的 ctx()）
 *   rebuild(P, Z)       参数变了：半径、分界、塔的尺寸（几何只换缩放，不重建）
 *   pins(P, sites, cur, opt)  重建地点针；cur＝{s, az, id}；返回针头锚点 [{id, name, X:[km], cur}]
 *   update(f)           每帧：剖切、外表面星点、剖口环、第一人称朝向锥
 *   dispose()
 * 分域环与赤道描边、经纬网都在 ov_shell.frag 里逐片元画（抗锯齿、随剖切一起消失），这里只传 uniform。
 * 巨塔、内壁、地点针都挂在“随星体转”的组（c.spin）里：本地坐标＝地固系（单位 1000 km）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ov = HY.ov = HY.ov || {};
  var K = 1e-3;                       // km → 场景单位
  var TOWER_HALF = 1.06;              // 塔长 2.12R

  var sh = ov.shell = {};
  var c = null, m = {};               // m：本模块的网格与材质

  sh.build = function (ctx) {
    c = ctx;
    var THREE = c.THREE, U = c.U, col = c.col;
    // 内壁：单位球，三角形翻成朝内（正面＝内壁，背面＝外表面）
    var g = new THREE.SphereGeometry(1, 192, 128), idx = g.index.array;
    for (var i = 0; i < idx.length; i += 3) { var tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; }
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    m.shellGeo = g;
    var shellU = {
      uR: U.uR, uA: U.uA, uSunW: U.uSunW, uSunRho: U.uSunRho, uMoonW: U.uMoonW, uMoonRho: U.uMoonRho, uDref: U.uDref, uClipN: U.uClipN,
      uGEq: { value: 1.4 }, uLimboKm: { value: 333 }, uGLight: { value: 0.75 }, uGHeavy: { value: 1.2 }, uPsiL: { value: -1 }, uPsiH: { value: -1 },
      uEcl: { value: 1 }, uGrid: { value: 1 }, uStars: U.uStars, uSpin: U.uSpin,
      uZLight: { value: v3(col.zLight) }, uZPlain: { value: v3(col.zPlain) }, uZHeavy: { value: v3(col.zHeavy) },
      uZLimbo: { value: v3(col.zLimbo) }, uZTower: { value: v3(col.zTower) },
      uNight: { value: v3(col.skyNight) }, uGridCol: { value: v3(col.line2) }, uStone: { value: v3(col.stone) }, uStarCol: { value: v3(col.star) }
    };
    m.shellU = shellU;
    m.shellMat = c.mat('ov_shell_vert', 'ov_shell', merge(shellU, { uCutMode: { value: 0 }, uAlpha: { value: 1 } }), { occl: true, side: THREE.DoubleSide });
    m.ghostMat = c.mat('ov_shell_vert', 'ov_shell', merge(shellU, { uCutMode: { value: 2 }, uAlpha: { value: 0.18 } }),
      { occl: true, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    m.shell = new THREE.Mesh(g, m.shellMat);
    m.shell.name = '内壁';
    m.ghost = new THREE.Mesh(g, m.ghostMat);
    m.ghost.name = '内壁·半透明近侧';
    m.ghost.renderOrder = 20;
    m.ghost.visible = false;
    c.spin.add(m.shell); c.spin.add(m.ghost);

    // 巨塔：单位圆柱（y∈[−1,1]），缩放成半径 a、长 2.12R
    m.towerGeo = new THREE.CylinderGeometry(1, 1, 2, 128, 1, false);
    m.towerMat = c.mat('ov_obj_vert', 'ov_tower', {
      uA: U.uA, uSunW: U.uSunW, uSunRho: U.uSunRho, uMoonW: U.uMoonW, uMoonRho: U.uMoonRho, uDref: U.uDref, uClipN: U.uClipN,
      uCutMode: { value: 0 }, uKm: { value: new THREE.Vector3(600, 6753, 600) },
      uSunCol: { value: v3(col.sun) }, uRimCol: { value: v3(col.moon) }, uWaistCol: { value: v3(col.line2).multiplyScalar(1.6) }
    }, { occl: true });
    m.tower = new THREE.Mesh(m.towerGeo, m.towerMat);
    m.tower.name = '巨塔';
    c.spin.add(m.tower);

    // 地点针（共用单位几何）、第一人称朝向锥
    m.pinGroup = new THREE.Group(); m.pinGroup.name = '地点针';
    c.spin.add(m.pinGroup);
    m.stickGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false); m.stickGeo.translate(0, 0.5, 0);
    m.headGeo = new THREE.SphereGeometry(1, 16, 12);
    m.pinMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(col.fg).multiplyScalar(0.55) }, uAlpha: { value: 1 }, uCutMode: U.uWallCut, uClipN: U.uClipN });
    m.pinCurMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: new THREE.Vector3(1.4, 1.4, 1.4) }, uAlpha: { value: 1 }, uCutMode: U.uWallCut, uClipN: U.uClipN });
    m.coneGeo = new THREE.ConeGeometry(1, 1, 20, 1, false); m.coneGeo.translate(0, 0.5, 0);
    m.coneMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: new THREE.Vector3(1.2, 1.2, 1.2) }, uAlpha: { value: 0.85 }, uCutMode: U.uWallCut, uClipN: U.uClipN },
      { transparent: true });
    m.cone = new THREE.Mesh(m.coneGeo, m.coneMat);
    m.cone.name = '刚才的站位与朝向';
    m.cone.visible = false;
    c.spin.add(m.cone);
    m.pins = [];

    // 剖口环：过原点、垂直于视线的大圆（世界坐标，每帧摆正）
    var n = 256, pos = new Float32Array(3 * n);
    for (var j = 0; j < n; j++) { var a = 2 * Math.PI * j / n; pos[3 * j] = Math.cos(a); pos[3 * j + 1] = Math.sin(a); pos[3 * j + 2] = 0; }
    m.ringGeo = new THREE.BufferGeometry();
    m.ringGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.ringMat = c.mat('ov_line_vert', 'ov_line', { uColor: { value: v3(col.line2).multiplyScalar(1.5) }, uAlpha: { value: 1 } });
    m.ring = new THREE.LineLoop(m.ringGeo, m.ringMat);
    m.ring.name = '剖口';
    m.ring.frustumCulled = false;
    c.world.add(m.ring);
    return m;
  };

  function v3(a) { return new c.THREE.Vector3(a[0], a[1], a[2]); }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  // 参数变了：半径、分界、塔的尺寸
  sh.rebuild = function (P, Z) {
    if (!c) return;
    var u = m.shellU;
    u.uGEq.value = P.gEq;
    u.uGLight.value = Z.gLight; u.uGHeavy.value = Z.gHeavy; u.uLimboKm.value = Z.limboKm;
    u.uPsiL.value = Z.gLight < P.gEq ? Math.asin(Z.gLight / P.gEq) : -1;
    u.uPsiH.value = Z.gHeavy < P.gEq ? Math.asin(Z.gHeavy / P.gEq) : -1;
    var s = P.R * K;
    m.shell.scale.set(s, s, s); m.ghost.scale.set(s, s, s);
    m.tower.scale.set(P.a * K, TOWER_HALF * P.R * K, P.a * K);
    m.towerMat.uniforms.uKm.value.set(P.a, TOWER_HALF * P.R, P.a);
    m.ring.scale.set(s * 1.0015, s * 1.0015, s * 1.0015);
  };

  // 地点针：sites＝HY.world.siteList(P)；cur＝{s, az, id}；opt＝{show}
  //   针沿“上”（垂直指向塔轴）立起；针头锚点给标签与点选用。
  sh.pins = function (P, sites, cur, opt) {
    if (!c) return [];
    var THREE = c.THREE, A = HY.astro;
    m.pins.forEach(function (o) { m.pinGroup.remove(o); });
    m.pins = []; m.pinK = 1;
    var out = [], L = 0.045 * P.R, up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), d = new THREE.Vector3();
    function add(s, az, id, name, isCur) {
      var O = A.site(s, az, P), rs = (isCur ? 0.0021 : 0.0012) * P.R, rh = (isCur ? 0.0095 : 0.0062) * P.R;
      var len = isCur ? L * 1.25 : L;
      d.set(O.U[0], O.U[1], O.U[2]);
      q.setFromUnitVectors(up, d);
      var mat = isCur ? m.pinCurMat : m.pinMat;
      var st = new THREE.Mesh(m.stickGeo, mat);
      st.position.set(O.x * K, O.y * K, O.z * K); st.quaternion.copy(q); st.scale.set(rs * K, len * K, rs * K);
      var hd = new THREE.Mesh(m.headGeo, mat);
      var H = [O.x + O.U[0] * len, O.y + O.U[1] * len, O.z + O.U[2] * len];
      hd.position.set(H[0] * K, H[1] * K, H[2] * K); hd.scale.set(rh * K, rh * K, rh * K);
      // 镜头拉近时整根针按比例缩小（针脚不动）：记下原始尺寸，update 里乘 pinK
      st.userData.base = { s: st.scale.clone() }; hd.userData.base = { s: hd.scale.clone(), foot: [O.x * K, O.y * K, O.z * K], head: [H[0] * K, H[1] * K, H[2] * K] };
      m.pinGroup.add(st); m.pinGroup.add(hd); m.pins.push(st, hd);
      out.push({ id: id, name: name, X: H, base: [O.x, O.y, O.z], cur: isCur, s: s, az: az });
    }
    sites.forEach(function (q0) { if (q0.id !== cur.id) add(q0.s, q0.az, q0.id, q0.short, false); });
    var curName = null;
    if (cur.id) sites.forEach(function (q0) { if (q0.id === cur.id) curName = q0.short; });
    add(cur.s, cur.az, cur.id, curName || '此地', true);
    m.pinGroup.visible = !opt || opt.show !== false;
    return out;
  };

  // 每帧。f＝{P, o（HY.state.ov）, camOut, fpLook: {yaw, pitch}|null, site: {s, az}, clipW: Vector3}
  sh.update = function (f) {
    if (!c) return;
    var o = f.o, half = f.camOut && o.cut === 'half', ghost = f.camOut && o.cut === 'ghost';
    m.shellMat.uniforms.uCutMode.value = f.camOut && o.cut !== 'none' ? 1 : 0;
    m.ghost.visible = ghost;
    c.U.uWallCut.value = half ? 1 : 0;
    m.shellU.uGrid.value = o.grid ? 1 : 0;
    m.pinGroup.visible = !!o.sites;
    var pk = f.pinK == null ? 1 : f.pinK;
    if (pk !== m.pinK) {
      m.pinK = pk;
      m.pins.forEach(function (p) {
        var b = p.userData.base; if (!b) return;
        p.scale.copy(b.s).multiplyScalar(pk);
        if (b.head) p.position.set(b.foot[0] + (b.head[0] - b.foot[0]) * pk, b.foot[1] + (b.head[1] - b.foot[1]) * pk, b.foot[2] + (b.head[2] - b.foot[2]) * pk);
      });
    }
    // 剖口环：只在相机在球外、剖开时
    m.ring.visible = f.camOut && o.cut !== 'none';
    if (m.ring.visible) m.ring.quaternion.setFromUnitVectors(Z_AXIS(), f.clipW);
    // 第一人称用过后，当前地点处的小锥指向 fp.yaw/pitch
    if (f.fpLook && o.sites) {
      var P = f.P, O = HY.astro.site(f.site.s, f.site.az, P), D2R = Math.PI / 180;
      // 偏航自北向东、俯仰相对重力水平（03 第三节第 3 条 fp.yaw／fp.pitch）
      var y = f.fpLook.yaw * D2R, p = f.fpLook.pitch * D2R, cp = Math.cos(p), cy = Math.cos(y), sy = Math.sin(y), sp = Math.sin(p);
      var dir = _d || (_d = new c.THREE.Vector3());
      dir.set(cp * (cy * O.N[0] + sy * O.E[0]) + sp * O.U[0], cp * (cy * O.N[1] + sy * O.E[1]) + sp * O.U[1], cp * (cy * O.N[2] + sy * O.E[2]) + sp * O.U[2]);
      var pk2 = f.pinK == null ? 1 : f.pinK, lift = 0.012 * P.R * pk2, len = 0.055 * P.R * pk2, rad = 0.011 * P.R * pk2;
      m.cone.position.set((O.x + O.U[0] * lift) * K, (O.y + O.U[1] * lift) * K, (O.z + O.U[2] * lift) * K);
      m.cone.quaternion.setFromUnitVectors(Y_AXIS(), dir.normalize());
      m.cone.scale.set(rad * K, len * K, rad * K);
      m.cone.visible = true;
    } else m.cone.visible = false;
  };
  var _z = null, _y = null, _d = null;
  function Z_AXIS() { return _z || (_z = new c.THREE.Vector3(0, 0, 1)); }
  function Y_AXIS() { return _y || (_y = new c.THREE.Vector3(0, 1, 0)); }

  sh.meshes = function () { return m; };
  sh.dispose = function () {
    if (!c) return;
    ['shellGeo', 'towerGeo', 'stickGeo', 'headGeo', 'coneGeo', 'ringGeo'].forEach(function (k) { if (m[k]) m[k].dispose(); });
    ['shellMat', 'ghostMat', 'towerMat', 'pinMat', 'pinCurMat', 'coneMat', 'ringMat'].forEach(function (k) { if (m[k]) m[k].dispose(); });
    [m.shell, m.ghost, m.tower, m.pinGroup, m.cone].forEach(function (o) { if (o && o.parent) o.parent.remove(o); });
    if (m.ring && m.ring.parent) m.ring.parent.remove(m.ring);
    m = {}; c = null; _z = _y = _d = null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
