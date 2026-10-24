/* HY.store / HY.state / HY.bus —— 共享状态、校验、事件、持久化（规格：spec/03 第三节；统筹修订见 spec/04）
 * 契约表之一：HY.store.SCHEMA（状态路径、默认、范围、是否持久）。不在表里的路径一律不许用。
 * 其他路要加状态：在自己的文件里调 HY.store.extendSchema({...})，不要改这个文件。
 * 节点可测：不碰 DOM；存储只经 HY.util.storage（node 里是内存）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var U = HY.util;
  if (!U) throw new Error('HY.store 需要先加载 core/util.js');

  /* ───────── 事件总线 ───────── */
  var bus = HY.bus = HY.bus || (function () {
    var L = {};
    function on(evt, fn) {
      (L[evt] = L[evt] || []).push(fn);
      return function () { off(evt, fn); };
    }
    function off(evt, fn) {
      var a = L[evt]; if (!a) return;
      var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }
    function once(evt, fn) {
      var u = on(evt, function (p, e) { u(); fn(p, e); });
      return u;
    }
    function call(fn, p, evt) {
      try { fn(p, evt); } catch (e) {
        if (G.console) G.console.error('[HY.bus] 监听器出错（' + evt + '）：', e);
      }
    }
    // 同步分发；单个监听器抛错只记日志。'*' 收到全部事件，第二个参数是事件名
    function emit(evt, payload) {
      var a = (L[evt] || []).slice(), w = evt === '*' ? [] : (L['*'] || []).slice(), i;
      for (i = 0; i < a.length; i++) call(a[i], payload, evt);
      for (i = 0; i < w.length; i++) call(w[i], payload, evt);
    }
    function count(evt) { return (L[evt] || []).length; }
    function clear() { L = {}; }
    return { on: on, off: off, once: once, emit: emit, count: count, clear: clear };
  })();

  /* ───────── SCHEMA ─────────
   * 每条：{ def, type: 'num'|'bool'|'enum'|'str'|'obj', min, max, step, int, wrap, opts, nullable, persist, opt, free, setting }
   *   persist 省略＝真；wrap: 360 表示角度折回 (−180, 180]；int 为真时取整；
   *   opt 为真：可缺省的覆盖项（def 为 null，写 null＝删除）；free 为真的 obj 允许写子键（'ui.open.天体'）；
   *   setting 为真：“设定／非物理”（界面标“设定”）。
   */
  function num(def, min, max, step, x) { var o = { def: def, type: 'num', min: min, max: max, step: step }; return ext(o, x); }
  function bool(def, x) { return ext({ def: def, type: 'bool' }, x); }
  function en(def, opts, x) { return ext({ def: def, type: 'enum', opts: opts }, x); }
  function ext(o, x) { if (x) for (var k in x) o[k] = x[k]; return o; }
  function ovr(min, max, step, x) { return ext({ def: null, type: 'num', min: min, max: max, step: step, opt: true }, x); }

  // 默认时刻：罪域 D1 夜 21 时（HY.world.MARKS 的 d1；不写死数字，历法参数变了也对）
  function defaultT() {
    var A = HY.astro, W = HY.world;
    if (A && W && W.markById && W.markById('d1')) return W.markT('d1', 10018, -4, A.params());
    if (A) return A.tOf(10018, 8, 24, 21, -4, A.params());
    return -67 + 21 / 24 - 6 / 360;
  }

  var SCHEMA = {
    // 时间
    'time.t': num(defaultT(), -73000, 73000, 1 / 1440),
    'time.playing': bool(false, { persist: false }),
    'time.speed.ov': num(86400, 0, 1e7, 1),
    'time.speed.fp': num(1, 0, 86400, 1),
    // 地点
    'site.id': { def: 'zuiyu', type: 'str', nullable: true },
    'site.s': num(6670, 0, 40000, 1),
    'site.az': num(-4, -180, 180, 0.1, { wrap: 360 }),
    // 视图
    'view.mode': en('ov', ['ov', 'fp']),
    // 总览
    'ov.preset': en('oblique', ['oblique', 'side', 'fromTop', 'fromRoot', 'above', 'sun', 'moon', 'winter']),
    'ov.cam': { def: null, type: 'obj', nullable: true },
    'ov.cut': en('half', ['half', 'ghost', 'none']),
    'ov.frame': en('ground', ['ground', 'inertial']),
    'ov.helix': en('mirror', ['mirror', 'real', 'strobe', 'off']),
    'ov.helixTurns': num(12, 4, 48, 1, { int: true }),
    'ov.sunGapX': num(1, 1, 10, 0.5),
    'ov.bodyScale': num(3, 1, 10, 0.5),
    'ov.trails': bool(true), 'ov.shadowVol': bool(true), 'ov.grid': bool(true), 'ov.labels': bool(true),
    'ov.sites': bool(true), 'ov.stars': bool(true), 'ov.sight': bool(true), 'ov.showMoon': bool(true),
    // 第一人称
    'fp.quality': en('mid', ['low', 'mid', 'high', 'photo']),
    'fp.dynRes': bool(true),
    'fp.yaw': num(0, -180, 180, 0.1, { wrap: 360 }),
    'fp.pitch': num(15, -89, 89, 0.1),
    'fp.fov': num(55, 5, 100, 1),
    'fp.eye': num(1.6, 1.2, 2.0, 0.05),
    'fp.bob': bool(true), 'fp.hud': bool(true), 'fp.cross': bool(false),
    'fp.atmo.on': bool(true),
    'fp.atmo.HR': num(40, 4, 80, 1),
    'fp.atmo.HM': num(6, 1, 20, 0.1),
    'fp.atmo.V': num(200, 20, 288, 1),
    'fp.atmo.g': num(0.76, 0.5, 0.9, 0.01),
    'fp.cloud.on': bool(true),
    'fp.cloud.cover': num(0.42, 0, 1, 0.01),
    'fp.cloud.base': num(1.5, 0.3, 10, 0.1),
    'fp.cloud.top': num(6.5, 0.3, 10, 0.1),
    'fp.cloud.sigma': num(22, 5, 60, 1),
    'fp.cloud.rui': num(1, 0, 1, 0.01),
    'fp.cloud.ruiBase': num(1.2, 0.3, 5, 0.1),
    'fp.cloud.ruiTop': num(6, 1, 10, 0.1),
    'fp.cloud.ruiTau': num(60, 0, 120, 1),
    'fp.cloud.rain': num(0.03, 0, 0.2, 0.005),
    'fp.cloud.wind': num(1, 0, 5, 0.1),
    'fp.ground.mode': en('terrace', ['terrace', 'slope']),          // 统筹修订：默认阶地（W 固定），可切“顺着球面的斜坡”
    'fp.ground.W': num(1.5, 0.3, 8, 0.1),
    'fp.ground.cliff': num(0.07, 0.02, 0.2, 0.01),
    'fp.ground.resid': num(0, 0, 0.5, 0.01),
    'fp.ground.wig': num(0.35, 0, 0.5, 0.01),
    'fp.ground.jit': num(0.07, 0, 0.5, 0.01),
    'fp.ground.amp': num(1, 0, 3, 0.05),
    'fp.ground.abyssDepth': num(30, 0, 80, 1),
    'fp.ground.abyssHalf': num(220, 50, 400, 5),
    'fp.ground.abyssFog': bool(true),
    'fp.ground.wet': num(0.7, 0, 1, 0.05),
    // 设定（非物理）。统筹修订：夜默认如实画“白夜”；静滞夜幕＝开关 veil（默认关）＋强度 veilK（/千公里）
    'fp.set.veil': bool(false, { setting: true }),
    'fp.set.veilK': num(0.3, 0, 1, 0.01, { setting: true }),
    'fp.set.dayComp': num(1, 0, 1, 0.05, { setting: true }),
    'fp.set.acid': bool(false, { setting: true }),
    'fp.set.acidExt': num(0.3, 0, 1.5, 0.01, { setting: true }),   // sky 二修：0.02 时能见度 78 km 以上，开不开看不出；0.3 → 地面能见度约 13 km
    'fp.set.acidOmega': num(0.8, 0.6, 0.95, 0.01, { setting: true }),
    'fp.set.yuxi': en('auto', ['auto', 'on', 'off'], { setting: true }),
    'fp.set.yuxiLead': num(45, 0, 120, 1, { setting: true, int: true }),
    'fp.set.sheathN0': num(0, 0, 0.05, 0.001, { setting: true }),
    'fp.set.sheathHt': num(20, 5, 50, 1, { setting: true }),
    'fp.set.towerAlb': num(0, 0, 0.04, 0.001, { setting: true }),
    // 眼睛与后期
    'fp.eyeo.auto': bool(true),
    'fp.eyeo.evLock': num(12, -6, 20, 0.5),
    'fp.eyeo.evComp': num(0, -3, 3, 0.1),
    'fp.eyeo.cat': num(0.7, 0, 1, 0.05),
    'fp.eyeo.scotopic': bool(true),
    'fp.eyeo.tone': en('agx', ['agx', 'aces']),
    'fp.eyeo.glare': num(1, 0, 2, 0.05),
    // 天体（只放覆盖项，透传 HY.astro.params）
    'astro.preset': en('default', ['default', 'bing']),
    'astro.o': { def: {}, type: 'obj', group: true },
    'astro.o.R': ovr(2000, 12000, 10),
    'astro.o.a': ovr(100, 2000, 5),
    'astro.o.gEq': ovr(0.3, 3, 0.01),
    'astro.o.dS': ovr(125, 2600, 1),
    'astro.o.rhoS': ovr(5, 60, 1),
    'astro.o.sTrop': ovr(3000, 9000, 10),
    'astro.o.A': ovr(500, 6000, 5),
    'astro.o.rM': ovr(1800, 6000, 5),
    'astro.o.rhoM': ovr(30, 300, 1),
    'astro.o.Y': ovr(300, 420, 1, { int: true }),
    'astro.o.lunPerYear': ovr(6, 24, 0.25),
    'astro.o.epochAz': ovr(-180, 180, 0.5),
    'astro.o.pMoon': ovr(0.05, 1, 0.01),                         // 统筹修订：默认 0.6（不覆盖即 0.6），界面放“高级”
    'astro.linkA': bool(true),
    'astro.linkRM': bool(true),
    'astro.calib': en('5772K', ['5772K', '1361']),                // 统筹修订：默认 5772 K，界面放“高级”
    // 分域
    'zones.gLight': num(0.75, 0.1, 2.5, 0.01),
    'zones.gHeavy': num(1.2, 0.2, 3, 0.01),
    'zones.limboKm': num(333, 0, 1500, 1),
    // 界面
    'ui.tab': en('site', ['site', 'year', 'params', 'notes']),
    'ui.panel': bool(true),
    'ui.chrome': bool(true, { persist: false }),
    'ui.open': { def: {}, type: 'obj', free: true }
  };
  var SRC = ['ui', 'play', 'jump', 'walk', 'ov', 'fp', 'api', 'load', 'reset'];
  var KEY = 'huanyu-xingti-v3', VERSION = 3;

  var store = HY.store = HY.store || {};
  store.SCHEMA = SCHEMA;
  store.SRC = SRC;
  store.KEY = KEY;
  store.VERSION = VERSION;

  function warn(msg) { if (G.console) G.console.warn('[HY.store] ' + msg); }
  function persistOf(spec) { return spec.persist !== false; }
  function topOf(path) { return path.split('.')[0]; }

  /* ───────── 默认与初始化 ───────── */
  function defaults() {
    var s = {};
    Object.keys(SCHEMA).forEach(function (p) {
      var sp = SCHEMA[p];
      if (sp.opt) return;                     // 覆盖项缺省＝不存在
      U.setPath(s, p, U.clone(sp.def));
    });
    return s;
  }
  store.defaults = defaults;
  var state = HY.state = defaults();

  /* ───────── 校验 ───────── */
  // 返回 {ok, v}；ok 为假表示拒收（枚举不在表里、类型不对）
  function coerce(spec, v, path) {
    if (v === undefined) return { ok: false, why: '值为 undefined' };
    if (v === null) {
      if (spec.opt || spec.nullable) return { ok: true, v: null };
      return { ok: false, why: '不许为 null' };
    }
    switch (spec.type) {
      case 'num': {
        var x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
        if (typeof x !== 'number' || !isFinite(x)) return { ok: false, why: '不是有限数：' + v };
        if (spec.wrap) x = U.wrapDeg(x);
        if (spec.int) x = Math.round(x);
        if (spec.min != null && x < spec.min) x = spec.min;
        if (spec.max != null && x > spec.max) x = spec.max;
        return { ok: true, v: x };
      }
      case 'bool':
        if (typeof v === 'boolean') return { ok: true, v: v };
        if (v === 0 || v === 1) return { ok: true, v: !!v };
        if (v === 'true' || v === 'false') return { ok: true, v: v === 'true' };
        return { ok: false, why: '不是布尔：' + v };
      case 'enum':
        if (spec.opts.indexOf(v) >= 0) return { ok: true, v: v };
        return { ok: false, why: '“' + v + '”不在可选值 ' + spec.opts.join('|') + ' 里' };
      case 'str':
        return typeof v === 'string' ? { ok: true, v: v } : { ok: false, why: '不是字符串' };
      case 'obj':
        if (!U.isObj(v)) return { ok: false, why: '不是对象' };
        if (spec.group) {                       // astro.o：逐个子键按子条目校验
          var o = {}, bad = [];
          Object.keys(v).forEach(function (k) {
            var cs = SCHEMA[path + '.' + k];
            if (!cs) { bad.push(k); return; }
            if (v[k] == null) return;
            var r = coerce(cs, v[k], path + '.' + k);
            if (r.ok) o[k] = r.v; else bad.push(k);
          });
          if (bad.length) warn(path + ' 丢弃了不认识或无效的子键：' + bad.join('、'));
          return { ok: true, v: o };
        }
        return { ok: true, v: U.clone(v) };
      default:
        return { ok: false, why: '未知类型 ' + spec.type };
    }
  }

  /* ───────── 跨字段约束（违反时夹到边界，并发 error{part:'params'}） ───────── */
  function astroEff(k) {
    var o = state.astro.o || {};
    if (o[k] != null) return o[k];
    var pre = HY.astro && HY.astro.PRESETS[state.astro.preset];
    if (pre && pre[k] != null) return pre[k];
    var D = HY.astro ? HY.astro.DEFAULTS : { R: 6371, a: 600, dS: 640, rhoS: 20 };
    return D[k];
  }
  var EPS = 1e-6;
  var CONSTRAINTS = [
    { paths: ['zones.gLight', 'zones.gHeavy'], msg: '平／重界须比轻／平界至少大 0.02 g',
      fix: function (p, v) {
        if (p === 'zones.gLight') return Math.min(v, state.zones.gHeavy - 0.02);
        return Math.max(v, state.zones.gLight + 0.02);
      } },
    { paths: ['astro.o.rM', 'astro.o.a'], msg: '月轨须比塔面高出 50 公里以上（rM > a + 50）',
      fix: function (p, v) {
        var rM = state.astro.o.rM;
        if (p === 'astro.o.rM') return v == null ? v : Math.max(v, astroEff('a') + 50 + EPS);
        if (rM == null || v == null) return v;
        return Math.min(v, rM - 50 - EPS);
      } },
    { paths: ['astro.o.dS', 'astro.o.a', 'astro.o.rhoS'], msg: '日轨须离塔面至少日半径加 5 公里（dS ≥ a + ρS + 5）',
      fix: function (p, v) {
        if (v == null) return v;
        if (p === 'astro.o.dS') return Math.max(v, astroEff('a') + astroEff('rhoS') + 5);
        if (p === 'astro.o.a') return Math.min(v, astroEff('dS') - astroEff('rhoS') - 5);
        return Math.min(v, astroEff('dS') - astroEff('a') - 5);
      } },
    { paths: ['fp.cloud.base', 'fp.cloud.top'], msg: '云顶须比云底高 0.2 公里以上',
      fix: function (p, v) {
        return p === 'fp.cloud.base' ? Math.min(v, state.fp.cloud.top - 0.2) : Math.max(v, state.fp.cloud.base + 0.2);
      } },
    { paths: ['fp.cloud.ruiBase', 'fp.cloud.ruiTop'], msg: '罪域云顶须比云底高 0.2 公里以上',
      fix: function (p, v) {
        return p === 'fp.cloud.ruiBase' ? Math.min(v, state.fp.cloud.ruiTop - 0.2) : Math.max(v, state.fp.cloud.ruiBase + 0.2);
      } },
    { paths: ['site.s'], msg: '离塔根距离不能超过半周（πR）',
      fix: function (p, v) { return U.clamp(v, 0, Math.PI * astroEff('R')); } }
  ];
  store.CONSTRAINTS = CONSTRAINTS;
  function constrain(path, v, quiet) {
    for (var i = 0; i < CONSTRAINTS.length; i++) {
      var c = CONSTRAINTS[i];
      if (c.paths.indexOf(path) < 0) continue;
      var w = c.fix(path, v);
      if (w !== v && !(typeof w === 'number' && typeof v === 'number' && Math.abs(w - v) < 1e-12)) {
        if (!quiet) bus.emit('error', { part: 'params', level: 'warn', path: path, message: c.msg });
        v = w;
      }
    }
    return v;
  }

  /* ───────── 读写 ───────── */
  function specOf(path) {
    if (SCHEMA[path]) return { spec: SCHEMA[path], path: path };
    var i = path.lastIndexOf('.');
    if (i > 0) {                               // free 对象的子键：'ui.open.天体'
      var parent = path.slice(0, i), ps = SCHEMA[parent];
      if (ps && ps.free) return { spec: { type: 'any' }, path: path, freeParent: parent, key: path.slice(i + 1) };
    }
    return null;
  }
  store.spec = function (path) { return SCHEMA[path] || null; };
  store.paths = function (prefix) {
    return Object.keys(SCHEMA).filter(function (p) { return U.under(p, prefix); });
  };
  store.get = function (path) { return path ? U.getPath(state, path) : state; };
  store.snapshot = function () { return U.clone(state); };

  // 写一个叶子；返回 {changed, v, prev}。不发事件。noC 为真时先不做跨字段约束（批量写完再统一做）
  function writeLeaf(path, value, src, noC) {
    var sp = specOf(path);
    if (!sp) { warn('未登记的路径：' + path); return null; }
    var prev = U.getPath(state, path), v;
    if (sp.freeParent) {
      v = U.clone(value);
      if (U.equal(prev, v)) return { changed: false, v: prev, prev: prev };
      if (v === undefined) U.delPath(state, path); else U.setPath(state, path, v);
      return { changed: true, v: v, prev: prev, persist: persistOf(SCHEMA[sp.freeParent]) };
    }
    var r = coerce(sp.spec, value, path);
    if (!r.ok) { warn(path + ' 拒收：' + r.why); return { changed: false, v: prev, prev: prev, rejected: true }; }
    v = r.v;
    if (!noC && sp.spec.type === 'num' && v != null) v = constrain(path, v, src === 'load');
    if (sp.spec.opt) {
      if (v == null) {
        if (prev === undefined) return { changed: false, v: null, prev: prev };
        U.delPath(state, path);
        return { changed: true, v: null, prev: prev, persist: true };
      }
    }
    if (U.equal(prev, v)) return { changed: false, v: prev, prev: prev };
    U.setPath(state, path, v);
    return { changed: true, v: v, prev: prev, persist: persistOf(sp.spec) };
  }
  // 参数变化可能让别处越界（改 R 后 site.s 超出 πR）：复核并补发事件
  function recheck(src) {
    var s = state.site.s, w = constrain('site.s', s, true);
    if (w !== s) { var prev = U.clone(state.site); state.site.s = w; bus.emit('site', { path: 'site.s', value: U.clone(state.site), prev: prev, src: src }); }
  }

  // 批量写完后统一复核约束：changed 里受约束的路径按当前值再夹一次
  function settle(paths, quiet) {
    var touched = [];
    paths.forEach(function (p) {
      if (!constrained(p)) return;
      var cur = U.getPath(state, p);
      if (typeof cur !== 'number') return;
      var w = constrain(p, cur, quiet);
      if (w !== cur) { U.setPath(state, p, w); touched.push(p); }
    });
    return touched;
  }

  store.set = function (path, value, src) {
    src = src || 'api';
    if (SCHEMA[path] && SCHEMA[path].group) {
      // 整组覆盖（'astro.o' ← {dS: 700}）：没给的子键删掉，按 patch 写
      var full = {};
      store.paths(path).forEach(function (p) { if (p !== path) full[p.slice(path.length + 1)] = null; });
      if (U.isObj(value)) Object.keys(value).forEach(function (k) {
        if (full.hasOwnProperty(k)) full[k] = value[k]; else warn(path + ' 丢弃了不认识的子键：' + k);
      });
      store.patch(path, full, src);
      return U.getPath(state, path);
    }
    if (SCHEMA[path] === undefined && !specOf(path)) {
      // 组路径（'fp.atmo'、'site'）给对象＝patch
      if (U.isObj(value) && Object.keys(SCHEMA).some(function (p) { return U.under(p, path) && p !== path; })) {
        store.patch(path, value, src); return U.getPath(state, path);
      }
      warn('未登记的路径：' + path); return undefined;
    }
    var r = writeLeaf(path, value, src);
    if (!r || !r.changed) return r ? r.v : undefined;
    var top = topOf(path);
    bus.emit(top, { path: path, value: r.v, prev: r.prev, src: src });
    if (top === 'astro') recheck(src);
    if (r.persist) scheduleSave();
    return r.v;
  };

  // 一次写多个字段，只发一次事件：store.patch('site', {id, s, az}, 'ov')
  store.patch = function (path, obj, src) {
    src = src || 'api';
    if (!U.isObj(obj)) { warn('patch 需要对象：' + path); return; }
    var top = topOf(path), prevTop = U.clone(state[top]), changed = [], persist = false;
    // 先全部写入、再统一复核约束，避免“先夹后改”（如 gLight、gHeavy 同时改，a、dS 同时改）
    Object.keys(obj).forEach(function (k) {
      var p = path ? path + '.' + k : k;
      var r = writeLeaf(p, obj[k], src, true);
      if (r && r.changed) { changed.push(p); persist = persist || r.persist; }
    });
    settle(changed, false);
    changed = changed.filter(function (p) { return !U.equal(U.getPath(state, p), U.getPath(prevTop, p.slice(top.length + 1))); });
    if (!changed.length) return;
    bus.emit(top, { path: path, value: U.clone(state[top]), prev: prevTop, src: src, paths: changed });
    if (top === 'astro') recheck(src);
    if (persist) scheduleSave();
  };
  function constrained(p) { return CONSTRAINTS.some(function (c) { return c.paths.indexOf(p) >= 0; }); }

  // 恢复默认：scope 省略＝全部；可为前缀（'astro'、'fp.atmo'）或前缀数组；except＝要保留的前缀数组
  store.reset = function (scope, src, except) {
    src = src || 'reset';
    var scopes = scope == null ? [''] : Array.isArray(scope) ? scope : [scope];
    except = except || [];
    var D = defaults(), before = U.clone(state), tops = {};
    Object.keys(SCHEMA).forEach(function (p) {
      if (!scopes.some(function (s) { return U.under(p, s); })) return;
      if (except.some(function (s) { return U.under(p, s); })) return;
      var sp = SCHEMA[p], prev = U.getPath(state, p), v;
      if (sp.opt) { if (prev !== undefined) { U.delPath(state, p); tops[topOf(p)] = 1; } return; }
      v = U.clone(U.getPath(D, p));
      if (!U.equal(prev, v)) { U.setPath(state, p, v); tops[topOf(p)] = 1; }
    });
    Object.keys(tops).forEach(function (t) {
      bus.emit(t, { path: scope == null ? t : (Array.isArray(scope) ? t : scope), value: U.clone(state[t]), prev: before[t], src: src });
    });
    if (tops.astro) recheck(src);
    if (Object.keys(tops).length) scheduleSave();
  };

  /* ───────── 持久化 ───────── */
  function persistSubset() {
    var out = {};
    Object.keys(SCHEMA).forEach(function (p) {
      var sp = SCHEMA[p];
      if (!persistOf(sp) || sp.group) return;
      var v = U.getPath(state, p);
      if (v === undefined) return;
      U.setPath(out, p, U.clone(v));
    });
    return out;
  }
  var saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; store.flush(); }, 400);
    if (saveTimer && typeof saveTimer.unref === 'function') saveTimer.unref();
  }
  store.save = scheduleSave;
  store.flush = function () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { U.storage.set(KEY, JSON.stringify({ v: VERSION, state: persistSubset() })); return true; }
    catch (e) { warn('保存失败：' + e); return false; }
  };
  store.pendingSave = function () { return !!saveTimer; };

  // 启动时读：坏 JSON、版本号不符 → 整体丢弃、用默认；单个字段无效只丢该字段
  // opts.mobile：手机首次启动（没存过 fp.quality）时默认低档
  store.load = function (opts) {
    opts = opts || {};
    var raw = null, data = null, res = { ok: false, reason: '', fields: 0 };
    try { raw = U.storage.get(KEY); } catch (e) { raw = null; }
    if (raw) {
      try { data = JSON.parse(raw); } catch (e) { data = null; res.reason = '解析失败，已丢弃'; }
      if (data && (data.v !== VERSION || !U.isObj(data.state))) { data = null; res.reason = '版本不符，已丢弃'; }
    } else res.reason = '没有存档';
    var tops = {}, before = U.clone(state);
    if (data) {
      res.ok = true;
      var loaded = [];
      Object.keys(SCHEMA).forEach(function (p) {
        var sp = SCHEMA[p];
        if (!persistOf(sp) || sp.group) return;
        var v = U.getPath(data.state, p);
        if (v === undefined) return;
        var r = writeLeaf(p, v, 'load', true);
        if (r && r.changed) { tops[topOf(p)] = 1; res.fields++; loaded.push(p); }
      });
      settle(Object.keys(SCHEMA), true).forEach(function (p) { tops[topOf(p)] = 1; });
    } else if (raw) {
      try { U.storage.remove(KEY); } catch (e) { /* 忽略 */ }
    }
    if (opts.mobile && !(data && U.getPath(data.state, 'fp.quality'))) {
      if (state.fp.quality !== 'low') { state.fp.quality = 'low'; tops.fp = 1; }
    }
    Object.keys(tops).forEach(function (t) { bus.emit(t, { path: t, value: U.clone(state[t]), prev: before[t], src: 'load' }); });
    return res;
  };

  /* ───────── 契约扩展：其他路在自己的文件里登记新状态 ───────── */
  // entries：{ 'fp.debug.passTimes': {def:false, type:'bool'}, … }；已存在且不同则抛错
  store.extendSchema = function (entries) {
    Object.keys(entries).forEach(function (p) {
      var sp = entries[p];
      if (!sp || !sp.type) throw new Error('extendSchema：' + p + ' 缺 type');
      if (SCHEMA[p]) {
        if (U.equal(SCHEMA[p], sp)) return;
        throw new Error('extendSchema：' + p + ' 已存在且定义不同（改契约请改 core/store.js 并跑 store_check）');
      }
      var parts = p.split('.');
      for (var i = 1; i < parts.length; i++) {
        var pre = parts.slice(0, i).join('.');
        if (SCHEMA[pre] && !SCHEMA[pre].group) throw new Error('extendSchema：' + p + ' 落在叶子 ' + pre + ' 下面');
      }
      if (sp.type === 'enum' && (!sp.opts || sp.opts.indexOf(sp.def) < 0)) throw new Error('extendSchema：' + p + ' 的默认值不在 opts 里');
      SCHEMA[p] = sp;
      if (!sp.opt && U.getPath(state, p) === undefined) U.setPath(state, p, U.clone(sp.def));
    });
  };

  // 测试用：回到默认（不发事件、不清存储）
  store._resetForTest = function () {
    var D = defaults();
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.keys(D).forEach(function (k) { state[k] = D[k]; });
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
