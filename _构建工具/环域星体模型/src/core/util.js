/* HY.util —— 数学、格式化、路径、存储包装、节流、颜色（规格：spec/03 第二节）
 * 节点可测：不引用 window、document、THREE；本地存储只经 HY.util.storage，取不到时退回内存。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var U = HY.util = HY.util || {};

  var TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  U.TAU = TAU; U.D2R = D2R; U.R2D = R2D;

  /* ───────── 数学 ───────── */
  U.clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.invLerp = function (a, b, x) { return b === a ? 0 : (x - a) / (b - a); };
  U.frac = function (x) { return x - Math.floor(x); };
  U.mod = function (x, m) { var r = x % m; return r < 0 ? r + m : r; };
  // 角度折回 (−180, 180]
  U.wrapDeg = function (d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };
  U.wrap360 = function (d) { return ((d % 360) + 360) % 360; };
  U.deg = function (r) { return r * R2D; };
  U.rad = function (d) { return d * D2R; };
  // smoothstep，允许 a>b（与 GLSL 的 sstep 同式）
  U.sstep = function (a, b, x) { var u = U.clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  U.near = function (a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); };
  U.roundTo = function (x, step) { return step > 0 ? Math.round(x / step) * step : x; };
  // 二分：f(lo) 与 f(hi) 异号时求根；n 次迭代
  U.bisect = function (f, lo, hi, n) {
    var flo = f(lo);
    for (var i = 0; i < (n || 50); i++) {
      var m = 0.5 * (lo + hi), fm = f(m);
      if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  U.v3 = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; },
    len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    norm: function (a) { var l = U.v3.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };

  /* ───────── 格式化（数字一律给等宽字体显示；单位与中文空一格） ───────── */
  var NBSP = ' ';
  U.thousands = function (v, digits) {
    if (!isFinite(v)) return '—';
    var s = Math.abs(v).toFixed(digits || 0), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 && +s !== 0 ? '−' : '') + p.join('.');
  };
  U.fixed = function (v, digits) {
    if (!isFinite(v)) return '—';
    var s = v.toFixed(digits == null ? 1 : digits);
    return s.charAt(0) === '-' && +s !== 0 ? '−' + s.slice(1) : s.replace(/^-/, '');
  };
  U.pct = function (v, digits) { return isFinite(v) ? U.fixed(v * 100, digits == null ? 0 : digits) + '%' : '—'; };
  U.pad2 = function (n) { n = Math.floor(n); return (n < 10 ? '0' : '') + n; };
  U.unit = function (num, unit) { return num + NBSP + unit; };
  U.cnNum = function (n) {   // 0–99 的中文数字（历法、序号用）
    var d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    n = Math.floor(n);
    if (n < 10) return d[n];
    if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
    return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  };

  /* ───────── 对象与路径 ───────── */
  U.isObj = function (x) { return x !== null && typeof x === 'object' && !Array.isArray(x); };
  U.clone = function (x) {
    if (Array.isArray(x)) return x.map(U.clone);
    if (U.isObj(x)) { var o = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = U.clone(x[k]); return o; }
    return x;
  };
  U.equal = function (a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b;  // NaN
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!U.equal(a[i], b[i])) return false;
      return true;
    }
    if (U.isObj(a) && U.isObj(b)) {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) if (!Object.prototype.hasOwnProperty.call(b, ka[j]) || !U.equal(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return false;
  };
  U.getPath = function (obj, path) {
    if (!path) return obj;
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length; i++) { if (o == null) return undefined; o = o[p[i]]; }
    return o;
  };
  U.setPath = function (obj, path, v) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length - 1; i++) { if (!U.isObj(o[p[i]])) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = v;
  };
  U.delPath = function (obj, path) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length - 1; i++) { o = o[p[i]]; if (!U.isObj(o)) return; }
    delete o[p[p.length - 1]];
  };
  // path 是否在前缀 scope 之下（'fp.atmo' 覆盖 'fp.atmo.HR'，不覆盖 'fp.atmos'）
  U.under = function (path, scope) { return !scope || path === scope || path.indexOf(scope + '.') === 0; };

  /* ───────── 时钟、节流、防抖 ───────── */
  U.now = function () {
    var p = G.performance;
    return p && typeof p.now === 'function' ? p.now() : Date.now();
  };
  U.throttle = function (fn, ms) {
    var last = -Infinity, timer = null, args = null, self = null;
    function fire() { timer = null; last = U.now(); fn.apply(self, args); }
    return function () {
      args = arguments; self = this;
      var wait = ms - (U.now() - last);
      if (wait <= 0) { if (timer) { clearTimeout(timer); timer = null; } fire(); }
      else if (!timer) timer = setTimeout(fire, wait);
    };
  };
  U.debounce = function (fn, ms) {
    var timer = null, args = null, self = null;
    function d() { args = arguments; self = this; if (timer) clearTimeout(timer); timer = setTimeout(run, ms); }
    function run() { timer = null; fn.apply(self, args); }
    d.flush = function () { if (timer) { clearTimeout(timer); run(); } };
    d.cancel = function () { if (timer) clearTimeout(timer); timer = null; };
    d.pending = function () { return !!timer; };
    return d;
  };

  /* ───────── 存储包装：localStorage 可用就用，否则（node、隐私窗口、被禁）退回内存 ───────── */
  U.storage = (function () {
    var mem = {}, backend = null, probed = false;
    function probe() {
      probed = true;
      try {
        var ls = G['localStorage'];
        if (!ls) return null;
        var k = '__hy_probe__'; ls.setItem(k, '1'); ls.removeItem(k);
        return ls;
      } catch (e) { return null; }
    }
    function be() { if (!probed) backend = probe(); return backend; }
    return {
      get: function (key) {
        var b = be();
        if (b) { try { return b.getItem(key); } catch (e) { /* 落到内存 */ } }
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      },
      set: function (key, val) {
        var b = be(); val = String(val);
        if (b) { try { b.setItem(key, val); return true; } catch (e) { /* 落到内存 */ } }
        mem[key] = val; return false;
      },
      remove: function (key) {
        var b = be();
        if (b) { try { b.removeItem(key); } catch (e) { /* 忽略 */ } }
        delete mem[key];
      },
      // 测试用：换后端（null＝内存）；kind() 返回 'local' | 'memory'
      use: function (b) { backend = b || null; probed = true; mem = {}; },
      kind: function () { return be() ? 'local' : 'memory'; }
    };
  })();

  /* ───────── 颜色 ───────── */
  U.hexToRgb = function (hex) {
    var h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h.slice(0, 6), 16);
    if (!isFinite(n)) return [0, 0, 0];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };
  U.rgbToHex = function (c) {
    function b(x) { var v = Math.round(U.clamp(x, 0, 1) * 255); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + b(c[0]) + b(c[1]) + b(c[2]);
  };
  U.srgbToLinear = function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  U.linearToSrgb = function (c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  U.hexToLinear = function (hex) { return U.hexToRgb(hex).map(U.srgbToLinear); };
  U.mixRgb = function (a, b, t) { return [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)]; };
  U.rgba = function (c, a) {
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')';
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
