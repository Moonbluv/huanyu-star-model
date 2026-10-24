/* render_charts.js —— 浏览器验收：图表（负责：C 路；规格：spec/03 第八节、第十一节第 2 条）
 * 只调 HY_CHECKS.add('图表', 名, fn)；fn 可返回 Promise，抛错或返回 false 算失败。
 * 要进 test/render_checks.html，需在 src/manifest.json 的 harness 里加 "../test/render_charts.js"（统筹改）。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var H = function () { return G.HY; };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function show(tab, id) {
    H().store.set('ui.tab', tab, 'api');
    return wait(60).then(function () {
      var el = G.document.getElementById(id);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      return wait(250);
    });
  }
  var PAGES = { sky: ['site', 'cSky'], day: ['site', 'cDay'], month: ['site', 'cMonth'], year: ['year', 'cYear'], helix: ['year', 'cHelix'], meridian: ['year', 'cMerid'] };

  C.add('图表', '六张图都不是桩、都画出来了（页签切过去、滚到视口里）', function () {
    var chs = H().app.charts(), names = Object.keys(PAGES), errs = [];
    var off = H().bus.on('error', function (e) { if (e.part === 'charts') errs.push(e.message); });
    return names.reduce(function (p, k) {
      var tries = 0;
      function once() {
        return show(PAGES[k][0], PAGES[k][1]).then(function () {
          var ch = chs[k];
          if (!ch || ch.__stub) throw new Error(k + ' 还是桩');
          ch.update('visible');
          if (ch.stats && ch.stats.drawn > 0) return;
          if (++tries < 4) return wait(300).then(once);     // 刚载入时 IntersectionObserver 可能还没回报
          throw new Error(k + ' 没画（visible＝' + ch.visible() + '）');
        });
      }
      return p.then(once);
    }, Promise.resolve()).then(function () {
      off();
      if (errs.length) throw new Error(errs[0]);
      return names.map(function (k) { return k + ' ' + chs[k].stats.drawn + ' 次'; }).join('，');
    });
  });

  C.add('图表', '一年图点选：跳到那一日、钟点不变', function () {
    var A = H().astro, ch = H().app.charts().year;
    H().app.setSite('zuiyu');
    H().app.setTime(A.tOf(10018, 8, 24, 21, -4, H().model.P));
    return show('year', 'cYear').then(function () {
      ch.draw();
      var lay = ch.lay, h0 = A.localHour(H().state.time.t, H().model.O, H().model.P);
      var r = ch.pickAt(lay.X(100.5), (lay.p[0] + lay.p[1]) / 2);
      var h1 = A.localHour(H().state.time.t, H().model.O, H().model.P);
      if (!r || r.doy !== 100 || Math.abs(h1 - h0) > 1e-6) return false;
      return H().world.fmtCal(H().model.tick().cal, 'date');
    });
  });

  C.add('图表', '子午线点选：只改离塔根距离，方位不变', function () {
    var ch = H().app.charts().meridian;
    H().app.setSite('zuiyu');
    return show('year', 'cMerid').then(function () {
      ch.draw();
      var az = H().state.site.az, r = ch.pickAt(ch.lay.X(8000), 100);
      return !!r && H().state.site.az === az && Math.abs(H().state.site.s - r.s) < 1e-9 ? '离塔根 ' + Math.round(r.s) + ' 公里' : false;
    });
  });

  C.add('图表', '本月月相：今夜有金圈，点选跳到子夜', function () {
    var ch = H().app.charts().month;
    H().app.setSite('zuiyu');
    return show('site', 'cMonth').then(function () {
      ch.draw();
      if (!(ch.lay.tonight >= 0)) return false;
      var i = (ch.lay.tonight + 3) % ch.lay.n, r = ch.pickAt(ch.lay.x0 + (i + 0.5) * ch.lay.slot, 10);
      return !!r && H().state.time.t === r.t ? '共 ' + ch.lay.n + ' 夜' : false;
    });
  });

  C.add('图表', '悬停提示：没有 NaN、没有“几月初几”', function () {
    var chs = H().app.charts(), bad = [];
    return show('year', 'cYear').then(function () {
      ['year', 'helix', 'meridian'].forEach(function (k) {
        var ch = chs[k]; ch.draw();
        for (var x = 40; x < (ch.lay.x1 || 300); x += 37) {
          var t = ch.probe(x, 80) || [];
          t.forEach(function (s) { if (/NaN|undefined|[一二三四五六七八九十]月|初[一二三四五六七八九十]/.test(s)) bad.push(k + '：' + s); });
        }
      });
      if (bad.length) throw new Error(bad[0]);
      return true;
    });
  });

  C.add('图表', '第一人称时点天空图上的太阳会转头（总览时不会）', function () {
    var ch = H().app.charts().sky, called = null, old = H().app.look;
    return show('site', 'cSky').then(function () {
      ch.draw();
      var s = ch.lay.sun;
      if (!s) return '此刻在塔基里，跳过';
      if (ch.pickAt(s.x, s.y)) return false;
      H().state.view.mode = 'fp';
      H().app.look = function (y, p) { called = [y, p]; };
      try { ch.pickAt(s.x, s.y); } finally { H().app.look = old; H().state.view.mode = 'ov'; }
      return called ? '转到 ' + called[0].toFixed(1) + '°, ' + called[1].toFixed(1) + '°' : false;
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
