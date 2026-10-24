/* HY.ov.labels —— HTML 标签投影与遮挡、悬停提示框（#labels 层；规格：spec/03 第六节第 8、10 条）
 * 负责：B 路。只往附录 B 的 #labels 里放节点，不查别的模块的 DOM；样式写在行内（不依赖 style.css 的类）。
 *   init(el)
 *   frame(view)   view＝{show, anchors:[{id, text, X, kind, prio, cur, place}], project(a) → {x, y, ok}}
 *                 x、y 为相对画布左上角的 CSS 像素；ok 为假（在相机背后、被剖掉、被塔或内壁挡住）就不画。
 *                 place：摆法的候选表，依次试，取第一个不与已画标签重叠的；省略＝['right']（锚点右侧、竖直居中）；
 *                 另有 'above'／'below'（锚点正上方／正下方、水平居中）。
 *                 同屏按优先级（当前地点＞日月＞两极＞其它地点＞其它）做简单避让：与已画的矩形重叠就隐藏。
 *   tip(text, x, y) / hideTip()   悬停内壁的提示框
 *   clear() / dispose()
 * 每帧约 20 个锚点；文字变了才量一次尺寸，位置没变不写 DOM。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ov = HY.ov = HY.ov || {};

  var L = ov.labels = {};
  var el = null, pool = {}, tipEl = null, sizes = {}, lastShown = [];

  var BASE = 'position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;padding:0 3px;border-radius:3px;'
    + 'font:12px/1.35 var(--f-body);letter-spacing:.02em;text-shadow:0 0 3px #000,0 0 7px rgba(0,0,0,.85);will-change:transform;';
  var KIND = {
    cur: 'color:#fff;font-weight:700;font-size:13px;',
    site: 'color:var(--fg);opacity:.86;',
    body: 'color:var(--fg);font-weight:500;',
    sun: 'color:var(--sun);font-weight:500;',
    moon: 'color:var(--moon);font-weight:500;',
    pole: 'color:var(--fg);font-size:11.5px;background:rgba(10,12,17,.66);',   // 常压在黑塔剪影上：垫深底、用正文色（原 --muted 几乎看不见）
    free: 'color:#fff;font-size:11.5px;opacity:.92;'
  };

  L.init = function (container) {
    el = container || null;
    pool = {}; sizes = {}; tipEl = null; lastShown = [];
    if (el) el.textContent = '';
  };

  function node(id) {
    var n = pool[id];
    if (n) return n;
    var d = G.document.createElement('div');
    d.style.cssText = BASE + 'display:none';
    el.appendChild(d);
    n = pool[id] = { el: d, text: null, style: '', x: NaN, y: NaN, shown: false, w: 0, h: 0 };
    return n;
  }
  function styleOf(a) {
    if (a.cur) return KIND.cur;
    if (a.id === 'sun') return KIND.sun;
    if (a.id === 'moon') return KIND.moon;
    return KIND[a.kind] || KIND.site;
  }
  function hide(n) { if (n.shown) { n.el.style.display = 'none'; n.shown = false; } }
  // 标签的尺寸（避让用）：同样式同文字量一次就记下。量不出来时（标签层被隐藏，宽 0；或这一枚此刻没显示）
  //   先按字数估、不记，之后每帧再试，直到量到为止
  function size(n) {
    var key = n.style + '|' + n.text, sz = sizes[key];
    if (!sz && n.shown) {
      var ow = n.el.offsetWidth, oh = n.el.offsetHeight;
      if (ow > 0) sz = sizes[key] = { w: ow, h: oh || 16 };
    }
    if (sz) { n.w = sz.w; n.h = sz.h; n.sized = true; }
    else { n.w = 12 * n.text.length + 6; n.h = 16; }
  }

  // 标签矩形 [左, 上, 右, 下]（CSS 像素）。'right'：锚点右侧 8 px、竖直居中（默认）；'left'：左侧；
  //   'above'／'below'：锚点正上方／正下方 8 px、水平居中（锚点在一条横线上、同一高度还挤着别的标签时用）。
  //   'above2'／'below2'：再往外 26 px（同一高度上日、月圆盘挨着锚点，上下 8 px 处都被圆盘占着时用）。
  //   pr.r：锚点本身在屏幕上的半径（日、月的圆盘）：标签挪到圆盘外面，不写在月面上
  var PLACE_DEF = ['right'];
  L.PLACE_ALL = ['right', 'left', 'above', 'below'];
  function rectAt(place, pr, n) {
    var rx, ry, g = 8 + (pr.r > 0 ? pr.r : 0);
    if (place === 'above') { rx = pr.x - n.w / 2; ry = pr.y - n.h - g; }
    else if (place === 'below') { rx = pr.x - n.w / 2; ry = pr.y + g; }
    else if (place === 'above2') { rx = pr.x - n.w / 2; ry = pr.y - n.h - g - 26; }      // 再高一层：日月圆盘挨着锚点时跳过它
    else if (place === 'below2') { rx = pr.x - n.w / 2; ry = pr.y + g + 26; }
    else if (place === 'left') { rx = pr.x - g - n.w; ry = pr.y - n.h / 2; }
    else { rx = pr.x + g; ry = pr.y - n.h / 2; }
    rx = Math.round(rx); ry = Math.round(ry);
    return [rx, ry, rx + n.w, ry + n.h];
  }
  L.rectAt = rectAt;
  // 画布边缘也算禁区：标签不出画面（出了画面就换个摆法）
  function inside(r, W, H) { return !W || !H || (r[0] >= 2 && r[1] >= 2 && r[2] <= W - 2 && r[3] <= H - 2); }
  function overlaps(r, rects) {
    for (var j = 0; j < rects.length; j++) {
      var q = rects[j];
      if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true;
    }
    return false;
  }

  L.frame = function (view) {
    if (!el) return;
    var used = {};
    if (view && view.show) {
      // 优先级 0（当前地点）最高；不能写 prio || 9，那会把 0 当成没给、排到最后
      var list = view.anchors.slice().sort(function (p, q) { return (p.prio == null ? 9 : p.prio) - (q.prio == null ? 9 : q.prio); });
      // 禁区：顶栏的按钮与要点、图例、示意小字、字幕（view.block，画布坐标），以及日月圆盘本身
      var rects = (view.block || []).slice(), W = view.w || el.clientWidth || 0, Hh = view.h || el.clientHeight || 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i], pr = view.project(a);
        if (!pr || !pr.ok) continue;
        var n = node(a.id), st = styleOf(a);
        used[a.id] = 1;
        if (n.text !== a.text || n.style !== st) {
          n.el.style.cssText = BASE + st + 'display:block';
          n.el.textContent = a.text;
          n.text = a.text; n.style = st; n.shown = true; n.sized = false;
          n.x = n.y = NaN;
        }
        if (!n.sized) size(n);
        // 摆法依次试，第一个不与已画的标签重叠的就用；都重叠就隐藏（后画的让先画的）
        var places = a.place == null ? PLACE_DEF : a.place, r = null;
        for (var k = 0; k < places.length && !r; k++) {
          var c = rectAt(places[k], pr, n);
          if (!overlaps(c, rects) && inside(c, W, Hh)) r = c;
        }
        if (!r) { hide(n); continue; }
        rects.push(r);
        if (!n.shown) { n.el.style.display = 'block'; n.shown = true; }
        if (r[0] !== n.x || r[1] !== n.y) { n.el.style.transform = 'translate(' + r[0] + 'px,' + r[1] + 'px)'; n.x = r[0]; n.y = r[1]; }
      }
    }
    lastShown = [];
    for (var id in pool) {
      if (!used[id]) hide(pool[id]);
      else if (pool[id].shown) lastShown.push(id);
    }
  };
  // 测试与调试：此刻画出来的标签 id
  L.shown = function () { return lastShown.slice(); };

  L.tip = function (text, x, y) {
    if (!el) return;
    if (!tipEl) {
      tipEl = G.document.createElement('div');
      tipEl.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;display:none;z-index:2;'
        + 'padding:4px 8px;border-radius:4px;background:rgba(15,18,25,.93);border:1px solid var(--line2);color:var(--fg);'
        + 'font:12px/1.4 var(--f-body);font-variant-numeric:tabular-nums;box-shadow:0 2px 10px rgba(0,0,0,.45)';
      el.appendChild(tipEl);
    }
    if (tipEl.textContent !== text) tipEl.textContent = text;
    tipEl.style.display = 'block';
    var W = el.clientWidth || 0, H = el.clientHeight || 0, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var px = x + 14, py = y + 16;
    if (W && px + w > W - 4) px = Math.max(4, x - 14 - w);
    if (H && py + h > H - 4) py = Math.max(4, y - 12 - h);
    tipEl.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
  };
  L.hideTip = function () { if (tipEl) tipEl.style.display = 'none'; };

  L.clear = function () {
    for (var id in pool) hide(pool[id]);
    L.hideTip();
    lastShown = [];
  };
  L.dispose = function () {
    if (el) el.textContent = '';
    pool = {}; sizes = {}; tipEl = null; lastShown = [];
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
