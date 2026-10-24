/* render_ui.js —— 浏览器验收：界面（负责：D 路；规格：spec/03 第十一节第 2 条“视图切换”“界面”两项）
 * 只调 HY_CHECKS.add(组, 名, fn)；fn 可返回 Promise，抛错或返回 false 算失败，返回字符串算通过并附说明。
 * 每条检查结束时把动过的状态复原（时间、地点、页签、参数），不影响别的组。
 */
(function (G) {
  'use strict';
  var C = G.HY_CHECKS; if (!C) return;
  var D = G.document;
  function H() { return G.HY; }
  function $(id) { return D.getElementById(id); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function keep() { var S = H().store; return { t: S.get('time.t'), site: H().util.clone(S.get('site')), tab: S.get('ui.tab'), playing: S.get('time.playing') }; }
  function restore(k) {
    var S = H().store;
    S.set('time.playing', false, 'api');
    S.patch('site', k.site, 'api');
    S.set('time.t', k.t, 'api');
    S.set('ui.tab', k.tab, 'api');
  }
  // 监听全部事件与报错
  function spy() {
    var ev = {}, errs = [];
    var off = H().bus.on('*', function (p, name) { ev[name] = (ev[name] || 0) + 1; });
    var onErr = function (e) { errs.push(e.message || String(e)); };
    G.addEventListener('error', onErr);
    var origErr = G.console.error;
    G.console.error = function () { errs.push([].slice.call(arguments).map(String).join(' ')); return origErr.apply(G.console, arguments); };
    return { ev: ev, errs: errs, stop: function () { off(); G.removeEventListener('error', onErr); G.console.error = origErr; } };
  }
  function key(k, code, mods) {
    var o = { key: k, code: code, bubbles: true, cancelable: true };
    for (var m in (mods || {})) o[m] = mods[m];
    var e = new G.KeyboardEvent('keydown', o);
    D.body.dispatchEvent(e);
    return e;
  }

  C.add('界面', '布局：附录 B 的容器都被填上，页签四个、预设八个、要点四个', function () {
    var tabs = D.querySelectorAll('#tabs [role=tab]').length, pres = D.querySelectorAll('#ovPresets .btn-preset').length;
    var chips = D.querySelectorAll('#nowChips .chip').length;
    var empty = ['viewSwitch', 'timebar', 'siteCard', 'readouts', 'calendar', 'params', 'notes', 'fpHud', 'legend']
      .filter(function (id) { return !$(id) || !$(id).children.length; });
    if (empty.length) throw new Error('没填：' + empty.join('、'));
    if (tabs !== 4 || pres !== 8 || chips !== 4) throw new Error('页签 ' + tabs + '、预设 ' + pres + '、要点 ' + chips);
    var stubs = ['layout', 'timebar', 'sitecard', 'readouts', 'calendar', 'notes', 'fphud', 'keys', 'params'].filter(function (k) { return H().ui[k].__stub !== false; });
    if (stubs.length) throw new Error('仍是桩：' + stubs.join('、'));
    return '页签 4、预设 8、要点 4';
  });

  C.add('界面', '页签：点一下切过去，其余隐藏；方向键也能切', function () {
    var k = keep(), ids = ['site', 'year', 'params', 'notes'], bad = [];
    ids.forEach(function (t) {
      $('tabbtn-' + t).click();
      ids.forEach(function (u) { if ($('tab-' + u).hidden === (u === t)) bad.push(t + '→' + u); });
      if ($('tabbtn-' + t).getAttribute('aria-selected') !== 'true') bad.push(t + ' 没有 aria-selected');
    });
    $('tabbtn-notes').dispatchEvent(new G.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    if (H().state.ui.tab !== 'site') bad.push('方向键没有从“说明”绕回“此地”');
    restore(k);
    if (bad.length) throw new Error(bad.join('；'));
    return true;
  });

  C.add('界面', '参数页：每个控件改一次（取中值），无报错，对应事件各发一次', function () {
    var Hy = H(), k = keep(), ctl = Hy.ui.params.controls(), sp = spy(), n = 0, skipped = [], bad = [];
    Hy.store.set('ui.tab', 'params', 'api');
    ctl.forEach(function (c) {
      var r = c.r, w = c.w, top = r.path.split('.')[0], before = Hy.store.get(r.path);
      if (r.when && !r.when(Hy.state)) { skipped.push(r.label); return; }
      var cnt0 = sp.ev[top] || 0, target;
      if (r.kind === 'range') {
        var lo = +w.input.min, hi = +w.input.max, st = r.step || 1;
        target = Math.round(((lo + hi) / 2) / st) * st;
        if (before != null && Math.abs(target - before) < st / 2) target = Math.min(hi, target + st);
        w.input.value = target; w.input.dispatchEvent(new G.Event('change', { bubbles: true }));
      } else if (r.kind === 'toggle') {
        target = !before; w.input.click();
      } else if (r.kind === 'seg') {
        var b = w.buttons.filter(function (x) { return x.dataset.v !== String(before); })[0];
        target = b.dataset.v; b.click();
      } else {
        var opt = [].slice.call(w.input.options).filter(function (o) { return o.value !== String(before); })[0];
        target = opt.value; w.input.value = target; w.input.dispatchEvent(new G.Event('change', { bubbles: true }));
      }
      n++;
      var after = Hy.store.get(r.path), fired = (sp.ev[top] || 0) - cnt0;
      if (after === before && fired === 0) bad.push(r.label + '没变');
      else if (fired !== 1) bad.push(r.label + ' 发了 ' + fired + ' 次 ' + top + ' 事件');
    });
    sp.stop();
    Hy.ui.params.resetAll();
    restore(k);
    if (sp.errs.length) throw new Error('报错：' + sp.errs.slice(0, 3).join(' ｜ '));
    if (bad.length) throw new Error(bad.slice(0, 6).join('；'));
    return n + ' 个控件；置灰跳过 ' + skipped.length + ' 个';
  });

  C.add('界面', '恢复默认：HY.state 与 SCHEMA 默认深度相等（视图与界面布局保留）', function () {
    var Hy = H(), k = keep();
    Hy.store.set('astro.o.dS', 800, 'api'); Hy.store.set('zones.limboKm', 600, 'api'); Hy.store.set('ov.cut', 'none', 'api'); Hy.store.set('fp.set.veil', true, 'api');
    Hy.store.set('time.speed.ov', 3600, 'api');
    Hy.ui.params.resetAll();
    var Dft = Hy.store.defaults(), bad = [];
    // 时间栏的流速下拉跟着回到默认（reset 的事件路径是 'time'，不是 'time.speed.ov'）
    var spSel = D.querySelector('#timebar .tb-speed');
    if (Hy.state.view.mode === 'ov' && spSel && spSel.value !== String(Hy.state.time.speed.ov)) bad.push('流速下拉没跟着恢复（' + spSel.value + '）');
    ['time', 'site', 'ov', 'fp', 'astro', 'zones'].forEach(function (top) {
      var a = Hy.util.clone(Hy.state[top]), b = Dft[top];
      if (top === 'time') { delete a.speed; delete b.speed; }          // 流速另有手机默认，不比
      if (top === 'fp') { a.quality = b.quality; }
      if (!Hy.util.equal(a, b)) bad.push(top);
    });
    restore(k);
    if (bad.length) throw new Error('不等：' + bad.join('、'));
    return true;
  });

  C.add('界面', '本组默认：只恢复这一组', function () {
    var Hy = H();
    Hy.store.set('fp.atmo.HR', 12, 'api'); Hy.store.set('fp.cloud.cover', 0.9, 'api');
    Hy.ui.params.resetGroup('第一人称·大气');
    var ok = Hy.state.fp.atmo.HR === 40 && Hy.state.fp.cloud.cover === 0.9;
    Hy.ui.params.resetGroup('第一人称·云');
    return ok && Hy.state.fp.cloud.cover === 0.42;
  });

  C.add('界面', '参数约束：违反时参数页出黄字', function () {
    var Hy = H();
    Hy.store.set('astro.o.lunPerYear', 12.5, 'api');
    var w = D.querySelector('#params .p-warn');
    var shown = w && !w.hidden && /¼/.test(w.textContent);
    Hy.store.set('astro.o.lunPerYear', null, 'api');
    var gone = w.hidden;
    if (!shown) throw new Error('改成 12.5 个月后没有黄字');
    if (!gone) throw new Error('改回后黄字没消失');
    return true;
  });

  C.add('界面', '数值框：值不在步长格上时照实显示；越界按此刻的上限夹回', function () {
    var Hy = H(), bad = [];
    Hy.store.patch('fp.atmo', { HR: 8.5, HM: 1.2 }, 'api');                    // “地球式大气”
    var row = D.querySelector('#params [data-path="fp.atmo.HR"] input[type=number]');
    if (!row) bad.push('找不到空气标高的数值框');
    else if (row.value !== '8.5') bad.push('空气标高框里是 ' + row.value + '，应为 8.5');
    Hy.ui.params.resetGroup('第一人称·大气');
    var nb = Hy.ui.w.numBox({ label: '测试', min: 1, max: 360, step: 1 });
    nb.setRange(1, 400); nb.el.value = 380; nb.el.dispatchEvent(new G.Event('change'));
    if (nb.get() !== 380) bad.push('改了上限后 380 被夹成 ' + nb.get());
    nb.el.value = 999; nb.el.dispatchEvent(new G.Event('change'));
    if (nb.get() !== 400) bad.push('越界没有夹回 400：' + nb.get());
    if (bad.length) throw new Error(bad.join('；'));
    return true;
  });

  C.add('界面', '要点与读数：黑月不写几何亮面', function () {
    var Hy = H(), k = keep();
    Hy.app.setSite('yimeite'); Hy.app.setTime(0); Hy.model.tick();      // 10018 年庆典交节：黑月
    Hy.ui.layout.chips(Hy.model.now);
    Hy.bus.emit('model', { what: 'site', pv: Hy.model.pv });
    var chip = D.querySelector('#nowChips .chip-moon').textContent, txt = $('readouts').textContent;
    restore(k);
    if (chip !== '黑月' && chip !== '黑月 · 高悬') throw new Error('要点写成了：' + chip);
    if (txt.indexOf('不亮（在塔影里）') < 0) throw new Error('读数的亮面没写“不亮”');
    return chip;
  });

  C.add('界面', 'localStorage 抛错时存取不崩（隐私窗口）', function () {
    var Hy = H(), U = Hy.util, ls = null;
    try { ls = G.localStorage; } catch (e) { ls = null; }
    var bomb = { getItem: function () { throw new Error('禁'); }, setItem: function () { throw new Error('禁'); }, removeItem: function () { throw new Error('禁'); } };
    U.storage.use(bomb);
    var ok = true;
    try { Hy.store.flush(); Hy.store.load(); Hy.store.set('fp.atmo.HR', 41, 'api'); Hy.store.flush(); Hy.store.set('fp.atmo.HR', 40, 'api'); }
    catch (e) { ok = false; }
    U.storage.use(ls);
    return ok ? '存取退回内存，照常' : false;
  });

  C.add('界面', '时间栏：“跳到…”每一项都能跳（或给出中文提示）', function () {
    var Hy = H(), k = keep(), sp = spy(), out = [], miss = [];
    var items = [].slice.call(D.querySelectorAll('#timebar .tb-jump .menu-item'));
    if (items.length < Hy.ui.timebar.JUMPS.filter(function (x) { return !x.head; }).length) throw new Error('只有 ' + items.length + ' 项');
    items.forEach(function (b) {
      Hy.store.set('time.t', k.t + 3.3, 'api');            // 离开正文标记的时刻，免得“跳到 D1”原地不动
      var t0 = Hy.state.time.t;
      b.click();
      var t1 = Hy.state.time.t, toast = $('toast');
      if (t1 !== t0) out.push(b.textContent);
      else if (toast && !toast.hidden && toast.textContent) out.push(b.textContent + '（' + toast.textContent + '）');
      else miss.push(b.textContent);
    });
    sp.stop();
    restore(k);
    if (sp.errs.length) throw new Error('报错：' + sp.errs[0]);
    if (miss.length) throw new Error('没动静：' + miss.join('、'));
    return out.length + ' 项';
  });

  C.add('界面', '时间栏：日期滑杆、钟点滑杆、年份步进写回时间，文字用自创历法', function () {
    var Hy = H(), k = keep(), W = Hy.world;
    Hy.app.setTime({ year: 10018, wd: 294, hour: 21 });
    Hy.model.tick();
    var lab = D.querySelector('#timebar .tb-date').textContent;
    if (lab.indexOf('入冬后第 294 日') < 0) throw new Error('日期文字：' + lab);
    if (/[一二三四五六七八九十]月|初[一二三四五六七八九十]|廿/.test(D.getElementById('timebar').textContent)) throw new Error('时间栏出现了几月初几');
    var d = D.querySelector('#timebar .tb-dslider'), h = D.querySelector('#timebar .tb-hslider');
    var doy0 = Hy.model.now.date.doy;
    d.value = doy0 + 10; d.dispatchEvent(new G.Event('input', { bubbles: true })); Hy.model.tick();
    if (Hy.model.now.date.doy !== doy0 + 10) throw new Error('日期滑杆没写回');
    h.value = 6; h.dispatchEvent(new G.Event('input', { bubbles: true })); Hy.model.tick();
    if (Math.abs(Hy.model.now.hour - 6) > 0.02) throw new Error('钟点滑杆没写回：' + Hy.model.now.hour);
    var note0 = D.querySelector('#timebar .tb-ynote').textContent;
    D.querySelector('#timebar .tb-year .btn-icon:last-of-type').click(); Hy.model.tick();
    var N = Hy.model.now.date.N;
    var yl = D.querySelector('#timebar .tb-ylab').textContent, note1 = D.querySelector('#timebar .tb-ynote').textContent;
    restore(k);
    if (N !== 10019 || yl.indexOf('10019') < 0) throw new Error('年份步进：' + N + ' ' + yl);
    if (note0 !== '庆典年 · 周期第 1 年' || note1 !== '距庆典 3 年 · 周期第 2 年') throw new Error('年份旁注：' + note0 + ' ／ ' + note1);
    if (getComputedStyle(D.querySelector('#timebar .tb-ynote')).display === 'none') throw new Error('年份旁注被藏起来了（手机上也要看得到庆典与周期）');
    return W.fmtCal(Hy.model.now.cal, 'full');
  });

  C.add('界面', '快捷键：[ ] 前后一小时、Shift 一日、Alt 一月；空格播放；P 侧栏；H 隐藏界面', function () {
    var Hy = H(), k = keep(), P = Hy.model.P, t0 = Hy.state.time.t, bad = [];
    key('[', 'BracketLeft'); if (Math.abs(Hy.state.time.t - (t0 - 1 / 24)) > 1e-9) bad.push('[');
    key('{', 'BracketLeft', { shiftKey: true }); if (Math.abs(Hy.state.time.t - (t0 - 1 / 24 - 1)) > 1e-9) bad.push('Shift+[');
    key(']', 'BracketRight', { altKey: true }); if (Math.abs(Hy.state.time.t - (t0 - 1 / 24 - 1 + P.M)) > 1e-9) bad.push('Alt+]');
    key(' ', 'Space'); if (!Hy.state.time.playing) bad.push('空格');
    key(' ', 'Space'); if (Hy.state.time.playing) bad.push('空格（停）');
    var w0 = $('stage').getBoundingClientRect().width;
    key('p', 'KeyP'); var w1 = $('stage').getBoundingClientRect().width;
    if (Hy.state.ui.panel) bad.push('P');
    key('p', 'KeyP');
    if (G.innerWidth >= 1024 && !(w1 > w0)) bad.push('收起侧栏后画布没变宽');
    key('h', 'KeyH');
    var cb = $('chromeBtn'), cbShown = cb && getComputedStyle(cb).display !== 'none', tbHidden = getComputedStyle($('timebar')).display === 'none';
    key('h', 'KeyH');
    if (!cbShown || !tbHidden) bad.push('H 隐藏后应只留“显示界面”');
    // 焦点在输入框里不响应
    var box = D.querySelector('#params input[type=number]'); var t1 = Hy.state.time.t;
    if (box) { box.focus(); box.dispatchEvent(new G.KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', bubbles: true })); box.blur(); }
    if (Hy.state.time.t !== t1) bad.push('输入框里按 [ 也动了时间');
    restore(k);
    if (bad.length) throw new Error(bad.join('；'));
    return true;
  });

  C.add('界面', '地点卡：预设下拉与距离滑杆写回地点，读数跟着变', function () {
    var Hy = H(), k = keep();
    var sel = D.querySelector('#siteCard select');
    sel.value = 'yimeite'; sel.dispatchEvent(new G.Event('change', { bubbles: true }));
    var okId = Hy.state.site.id === 'yimeite' && Hy.state.site.s === 4000;
    var rng = D.querySelector('#siteCard input[type=range]');
    rng.value = 5000; rng.dispatchEvent(new G.Event('change', { bubbles: true }));
    var okS = Hy.state.site.s === 5000 && Hy.state.site.id === null;
    Hy.model.tick();
    Hy.bus.emit('model', { what: 'site', pv: Hy.model.pv });
    var zone = D.querySelector('#readouts .zone-dd').textContent;
    restore(k);
    if (!okId) throw new Error('预设没写回');
    if (!okS) throw new Error('距离滑杆没写回');
    return '5,000 公里处：' + zone;
  });

  C.add('界面', '入冬镜头：跳到交节前半日、每秒一小时播放、中央字幕', function () {
    var Hy = H(), k = keep(), sp0 = Hy.state.time.speed.ov;
    Hy.app.setTime(Hy.world.winterT(10019, Hy.model.P) - 60.3);          // 离 10019 年入冬交节最近
    Hy.ui.layout.preset('winter');
    var cap = $('ovCaption'), txt = cap ? cap.textContent : '';
    var tW = Hy.world.winterT(10019, Hy.model.P);
    var ok = Math.abs(Hy.state.time.t - (tW - 0.5)) < 1e-9 && Hy.state.time.playing && Hy.state.time.speed.ov === 3600 && !cap.hidden;
    Hy.store.set('time.playing', false, 'ui');
    var back = Hy.state.time.speed.ov === sp0;
    Hy.store.set('ov.preset', 'oblique', 'api');
    restore(k);
    if (!ok) throw new Error('时间、流速或字幕不对：' + txt);
    if (txt.indexOf('月在日西 90°') < 0) throw new Error('10019 年字幕：' + txt);
    if (!back) throw new Error('暂停后流速没还原');
    return txt.replace(/\s+/g, ' ');
  });

  C.add('界面', '读数与历法：只出现“入冬后第 N 日”，不出现几月初几', function () {
    var Hy = H(), k = keep();
    Hy.store.set('ui.tab', 'year', 'api');
    Hy.app.setTime({ year: 10018, wd: 294, hour: 21 });
    Hy.model.tick();
    Hy.bus.emit('model', { what: 'P', pv: Hy.model.pv });
    var txt = $('readouts').textContent + $('calendar').textContent + $('nowChips').textContent + $('notes').textContent;
    restore(k);
    var m = txt.match(/[一二三四五六七八九十]+月(?![亮灰黑态])|初[一二三四五六七八九十]|廿[一二三四五六七八九]/);
    if (m) throw new Error('出现了“' + m[0] + '”');
    if (txt.indexOf('入冬后第 294 日') < 0) throw new Error('没有“入冬后第 294 日”');
    return true;
  });

  C.add('视图切换', '第一人称不可用时按钮置灰并带中文原因；可用时反复往返不涨显存、时间地点不变', function () {
    var Hy = H(), av = Hy.app.fpAvail(), bFp = D.querySelector('#viewSwitch button:last-child');
    if (!av.ok) {
      // 置灰用 aria-disabled（不用 disabled：点不动、手机上看不到 title）；点一下提示原因、不切视图
      if (bFp.getAttribute('aria-disabled') !== 'true' || bFp.title.indexOf(av.reason) < 0) throw new Error('按钮没有置灰或没写原因');
      bFp.click();
      var tt = $('toast');
      if (Hy.state.view.mode !== 'ov') throw new Error('点了不可用的按钮却切了视图');
      if (!tt || tt.hidden || tt.textContent.indexOf(av.reason) < 0) throw new Error('点了没有提示原因');
      Hy.store.set('view.mode', 'fp', 'ui');            // 从别处（如读档）进：也要退回总览
      return wait(50).then(function () {
        if (Hy.state.view.mode !== 'ov') throw new Error('不可用时没有退回总览');
        return '第一人称不可用（' + av.reason + '），按钮已置灰，点了提示原因';
      });
    }
    if (bFp.getAttribute('aria-disabled') === 'true') throw new Error('第一人称可用，按钮却是灰的');
    // 第一人称的后台生成（噪声分帧、换档编译）与总览按需建的几何会在前几次往返里陆续出现；
    // 判据：最后 5 次往返之后的纹理／几何数完全相同（真泄漏会每次都涨）
    var k = keep(), mems = [], i = 0;
    function info() { var m = Hy.gfx.renderer.info.memory; return m.textures + '/' + m.geometries; }
    function once() {
      return Hy.app.view('fp').then(function () { return Hy.app.settle(3); }).then(function () { return Hy.app.view('ov'); })
        .then(function () { return Hy.app.settle(3); }).then(function () { return wait(150); }).then(function () { mems.push(info()); });
    }
    function stable5() { var t = mems.slice(-5); return t.length === 5 && t.every(function (m) { return m === t[0]; }); }
    // 至少 10 次；后台换档会让数在中途跳一次，所以最多跑到 24 次，直到连续 5 次不变
    function round() { return once().then(function () { if (++i < 10 || (!stable5() && i < 24)) return round(); }); }
    return round().then(function () {
      var tail = mems.slice(-5), stable = stable5();
      var same = Hy.state.time.t === k.t && Hy.util.equal(Hy.state.site, k.site);
      restore(k);
      if (!stable) throw new Error('显存对象数一直在涨：' + mems.join(' → '));
      if (!same) throw new Error('时间或地点变了');
      return mems.length + ' 次往返；纹理／几何 ' + mems[0] + ' → ' + tail[0] + '（最后 5 次不变）';
    });
  });

  C.add('视图切换', '视图每帧都抛错时只报一次（不刷屏）', function () {
    var Hy = H();
    if (Hy.app.active() !== 'ov') return '总览没在出图：跳过';
    var f0 = Hy.ov.frame, n = 0, ce = G.console.error, logged = 0;
    var off = Hy.bus.on('error', function (e) { if (e && e.part === 'ov') n++; });
    Hy.ov.frame = function () { throw new Error('测试：故意抛错'); };
    G.console.error = function () { logged++; };
    return Hy.app.settle(120).then(function () {
      Hy.ov.frame = f0; G.console.error = ce; off();
      Hy.ui.layout.fallback(''); $('toast').hidden = true;
      return Hy.app.settle(2);
    }).then(function () {
      if (n !== 1 || logged !== 1) throw new Error('120 帧报了 ' + n + ' 次错、记了 ' + logged + ' 次日志');
      return '120 帧只报 1 次';
    });
  });

  C.add('视图切换', '第一人称 HUD：只在第一人称出图时显示；罗盘、地名、日期、读数、快捷朝向齐全', function () {
    var Hy = H(), hud = $('fpHud');
    if (Hy.app.active() !== 'fp' && !hud.hidden) throw new Error('总览时 HUD 没隐藏');
    if (!hud.querySelector('.hud-compass') || hud.querySelectorAll('.hud-looks .btn').length !== 5) throw new Error('HUD 部件不全');
    if (!Hy.app.fpAvail().ok) return '第一人称不可用：总览时隐藏、部件齐全';
    var k = keep();
    Hy.app.setSite('zuiyu'); Hy.app.setTime({ year: 10018, wd: 294, hour: 21 });
    return Hy.app.view('fp').then(function () { return Hy.app.settle(3); }).then(function () { return wait(400); }).then(function () {
      var bad = [];
      if (hud.hidden) bad.push('第一人称时 HUD 没显示');
      var place = hud.querySelector('.hud-place').textContent, date = hud.querySelector('.hud-date').textContent;
      if (place !== '罪域·啜泣堡') bad.push('地名：' + place);
      if (date.indexOf('入冬后第 294 日') < 0) bad.push('日期：' + date);
      var cv = hud.querySelector('.hud-compass');
      if (!(cv.width > 0)) bad.push('罗盘没画');
      if (!hud.querySelector('.hud-heading').textContent) bad.push('没有朝向文字');
      // 按 dt 的文字找行（不靠第几行，读数加行时不必改这里）
      function hudRow(name) {
        var dts = hud.querySelectorAll('.hud-kv dt');
        for (var i = 0; i < dts.length; i++) if (dts[i].textContent === name) return dts[i].nextElementSibling;
        return null;
      }
      var lux = hudRow('光'), here = hudRow('所在');
      if (!lux || !/lux|测量中/.test(lux.textContent)) bad.push('照度：' + (lux && lux.textContent));
      if (!here || !/^离塔根 6,6\d\d 公里 · 1\.2\d g · 纬度 30\.\d°$/.test(here.textContent)) bad.push('所在：' + (here && here.textContent));
      var wx = hud.querySelector('.hud-wx');
      if (!wx || !/阴/.test(wx.textContent) || !/雨/.test(wx.textContent)) bad.push('罪域的天气一行：' + (wx && wx.textContent));
      var sunRow = hudRow('太阳');
      if (!sunRow || /全部露出/.test(sunRow.textContent)) bad.push('罪域阴云下太阳不该写“全部露出”：' + (sunRow && sunRow.textContent));
      if (hud.querySelector('.hud-read').open) bad.push('读数默认应收起');
      // 快捷朝向：看天顶后俯仰接近 90°
      hud.querySelectorAll('.hud-looks .btn')[1].click();
      return Hy.app.settle(120).then(function () {          // 转头是平滑的：连跑 2 秒的帧
        var p = Hy.fp.api.pose();
        if (!(p && p.pitch > 60)) bad.push('“看天顶”后俯仰只有 ' + (p && p.pitch));
        return Hy.app.view('ov');
      }).then(function () {
        restore(k);
        if (bad.length) throw new Error(bad.join('；'));
        return place + ' · ' + date;
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
