/* render_checks.js —— 浏览器验收的运行器（规格：spec/03 第十一节第 2 条）。
 * 由 py build.py --harness 打进 test/render_checks.html（同一份代码＋manifest.harness 里的脚本）。
 * 各路的检查写在自己的文件里，只调 HY_CHECKS.add(组, 名, fn)，不改本文件：
 *   test/render_ov.js（B 总览）、test/render_fp.js（E／F／G 第一人称）、test/render_ui.js（D 界面）
 * fn 可以返回 Promise；抛错或返回 false 算失败，返回字符串算通过并附说明。
 * 结果放在 window.HY_TEST_RESULT = {done, pass, fail, rows:[{group, name, ok, note, ms}]}，并在页面上方列表。
 */
(function (G) {
  'use strict';
  var list = [];
  var C = G.HY_CHECKS = G.HY_CHECKS || {
    add: function (group, name, fn) { list.push({ group: group, name: name, fn: fn }); }
  };
  if (!C.add) return;

  /* M1 自带的几条：页面骨架、状态存取 */
  C.add('骨架', '启动无报错：HY.app、HY.store、HY.model 就位', function () {
    var H = G.HY;
    return !!(H && H.app && H.store && H.model && H.model.now && H.model.now.cal);
  });
  C.add('骨架', 'DOM 挂载点齐全（附录 B）', function () {
    var ids = ['app', 'stage', 'gl', 'labels', 'fpHud', 'topbar', 'viewSwitch', 'ovPresets', 'nowChips', 'legend', 'ovNote', 'busy', 'toast',
      'fallback', 'timebar', 'panel', 'tabs', 'tab-site', 'tab-year', 'tab-params', 'tab-notes', 'siteCard', 'readouts', 'cSky', 'cDay', 'cMonth',
      'cYear', 'cHelix', 'cMerid', 'calendar', 'params', 'notes'];
    var miss = ids.filter(function (id) { return !G.document.getElementById(id); });
    if (miss.length) throw new Error('缺：' + miss.join('、'));
    return ids.length + ' 个';
  });
  C.add('骨架', '状态写入后存进 localStorage（huanyu-xingti-v3）', function () {
    var H = G.HY, old = H.state.fp.atmo.HR;
    H.app.setParam('fp.atmo.HR', old === 41 ? 42 : 41);
    H.store.flush();
    var raw = H.util.storage.get(H.store.KEY), ok = raw && JSON.parse(raw).state.fp.atmo.HR === H.state.fp.atmo.HR;
    H.app.setParam('fp.atmo.HR', old); H.store.flush();
    return ok ? '存储：' + H.util.storage.kind() : false;
  });
  C.add('骨架', 'settle 推进帧、frame 事件发出', function () {
    var H = G.HY, n = 0, off = H.bus.on('frame', function () { n++; });
    return H.app.settle(5).then(function () { off(); return n === 5 ? '5 帧' : false; });
  });

  function run() {
    var res = { done: false, pass: 0, fail: 0, rows: [] };
    G.HY_TEST_RESULT = res;
    var box = G.document.createElement('div');
    box.id = 'hyTest';
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;max-height:60vh;overflow:auto;max-width:min(92vw,720px);padding:8px 12px;'
      + 'font:12px/1.5 ui-monospace,Consolas,monospace;background:rgba(10,12,17,.95);color:#ddd6c4;border:1px solid #353d50;border-radius:6px';
    box.textContent = '验收进行中…';
    G.document.body.appendChild(box);
    return list.reduce(function (p, c) {
      return p.then(function () {
        var t0 = performance.now();
        return Promise.resolve().then(c.fn).then(function (v) {
          var ok = v !== false;
          res.rows.push({ group: c.group, name: c.name, ok: ok, note: typeof v === 'string' ? v : '', ms: performance.now() - t0 });
        }, function (e) {
          res.rows.push({ group: c.group, name: c.name, ok: false, note: String(e && e.message || e), ms: performance.now() - t0 });
        });
      });
    }, Promise.resolve()).then(function () {
      res.rows.forEach(function (r) { if (r.ok) res.pass++; else res.fail++; });
      res.done = true;
      box.textContent = '';
      var h = G.document.createElement('div');
      h.textContent = '验收：通过 ' + res.pass + '，失败 ' + res.fail;
      h.style.color = res.fail ? '#d0644b' : '#8fb07a';
      box.appendChild(h);
      res.rows.forEach(function (r) {
        var d = G.document.createElement('div');
        d.textContent = (r.ok ? '✓ ' : '✗ ') + '［' + r.group + '］' + r.name + (r.note ? ' — ' + r.note : '');
        d.style.color = r.ok ? '#ddd6c4' : '#d0644b';
        box.appendChild(d);
      });
      return res;
    });
  }
  // 等页面启动、其余检查文件登记完再跑
  function start() { setTimeout(run, 500); }
  if (G.document.readyState === 'complete') start(); else G.addEventListener('load', start);
})(typeof globalThis !== 'undefined' ? globalThis : window);
