#!/usr/bin/env node
/* test/shoot.js —— 截图工具：无头 Chrome／Edge（真 GPU）按场景表逐张出图，并导出数值读数
 *
 *   node test/shoot.js                                   只检查 test/scenes_std.json（不开浏览器；run_all.js 也这样跑它）
 *   node test/shoot.js test/scenes_std.json              跑一遍场景表，图放 test/shots/<日期_时刻>/
 *   node test/shoot.js --std --out test/shots/baseline --clean
 *   node test/shoot.js 场景.json --only 圣禁城,总览 --ui full --size 1920x1080
 *   node test/shoot.js 场景.json --check                 只检查、列出解析后的地点与时刻
 *
 * 用法、场景字段、输出格式见 test/SHOOT.md。
 *
 * 做法：经 Chrome DevTools 协议驱动浏览器（--headless=new、--use-angle=d3d11、--ignore-gpu-blocklist）；
 *   每次运行端口由系统随机分配（--remote-debugging-port=0，从 DevToolsActivePort 读回），
 *   用户目录放 test/.shoot_profiles/ 下、运行完删除。用 file:/// 打开构建产物（URL 编码）。
 *   页面里只用现成的测试接口（HY.app.view／setSite／setTime／look／quality／settle／Eh／perf／gpuTimes，
 *   HY.fp.api.lookPreset／pose，HY.fp.readouts／readPxRGB／debug，HY.fp.eye.accum），不改 src。
 *   唯一的“插手”：进第一人称之前包一层 HY.fp.noise.gen3D，只为知道三维云噪声什么时候生成完。
 *
 * 不改 src、不改构建产物；本文件在 node 里与页面里共用 shootLib（解析地点、时刻、朝向），所以 shootLib 不能引用外部变量。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const TEST = __dirname;
const ROOT = path.join(TEST, '..');
const PAGE_DEFAULT = path.join(ROOT, '..', '..', '环域星体模型.html');
const STD = path.join(TEST, 'scenes_std.json');
const PROFILES = path.join(TEST, '.shoot_profiles');

/* ═════════════════════ 共用：场景解析（node 与页面里各跑一份；不许引用外部变量） ═════════════════════ */
function shootLib(HY) {
  'use strict';
  var A = HY.astro, W = HY.world, C = HY.calc;
  var SITE_ALIAS = {
    '罪域': 'zuiyu', '啜泣堡': 'zuiyu', '罪域·啜泣堡': 'zuiyu', '伊美忒': 'yimeite', '王城': 'yimeite', '圣禁城': 'shengjin',
    '涅赫莱恩': 'niehe', '盐眠洲': 'niehe', '深渊边': 'abyss', '深渊': 'abyss', '赤道': 'equator', '赤道深渊': 'equator',
    '轻域': 'qing', '世界另一端': 'far', '另一端': 'far'
  };
  var LOOK_IDS = ['north', 'east', 'south', 'west', 'zenith', 'sun', 'moon'];
  var LOOK_ALIAS = {
    '看太阳': 'sun', '太阳': 'sun', '看月': 'moon', '看月亮': 'moon', '月亮': 'moon',
    '看塔根': 'north', '塔根': 'north', '北·塔根': 'north', '看塔顶': 'south', '塔顶': 'south', '南·塔顶': 'south',
    '天顶': 'zenith', '看天顶': 'zenith', '仰望天顶': 'zenith', '东': 'east', '西': 'west'
  };
  var Q_IDS = ['low', 'mid', 'high', 'photo'];
  var Q_ALIAS = { '低': 'low', '中': 'mid', '高': 'high', '拍照': 'photo' };
  var VIEW_ALIAS = { fp: 'fp', ov: 'ov', '第一人称': 'fp', '站在此地': 'fp', '总览': 'ov' };
  var OV_IDS = ['oblique', 'side', 'fromTop', 'fromRoot', 'above', 'sun', 'moon', 'winter'];
  var OV_ALIAS = { '斜看': 'oblique', '侧看': 'side', '从塔顶看帝国': 'fromTop', '看另一端': 'fromRoot', '此地上空': 'above' };
  var TAB_IDS = ['site', 'year', 'params', 'notes'];
  var TAB_ALIAS = { '此地': 'site', '一年': 'year', '参数': 'params', '说明': 'notes' };
  var AT_IDS = ['noon', 'midnight', 'dawn0', 'rise', 'dawn1', 'dusk0', 'set', 'dusk1', 'dawn', 'dusk'];
  var AT_ALIAS = { '正午': 'noon', '子夜': 'midnight', '黎明': 'rise', '日出': 'rise', '黄昏': 'set', '日落': 'set' };
  // 开关 → 状态路径（场景没写的一律回到默认，场景之间互不影响）
  var TOGGLES = { atmo: 'fp.atmo.on', veil: 'fp.set.veil', ground: 'fp.ground.mode', clouds: 'fp.cloud.on' };
  var GROUND_ALIAS = { terrace: 'terrace', slope: 'slope', '阶地': 'terrace', '斜坡': 'slope' };
  var DEFAULTS = { view: 'fp', quality: 'mid', fov: 70, eye: 1.6, year: 10018 };

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function pick(map, ids, v) { if (v == null) return null; if (ids.indexOf(v) >= 0) return v; return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : undefined; }
  function P0() { return (HY.model && HY.model.P) || A.params(); }

  /* 地点：预设（id、名称、简称）| {s（离塔根公里）, az（方位）} | {km, az} */
  function site(spec, P) {
    P = P || P0();
    if (spec == null) spec = 'zuiyu';
    if (typeof spec === 'string') {
      var id = SITE_ALIAS[spec] || spec, list = W.siteList(P);
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        if (q.id === id || q.name === spec || q.short === spec) return { id: q.id, name: q.name, s: q.s, az: q.az, preset: true };
      }
      throw new Error('没有这个地点：“' + spec + '”（预设有 ' + list.map(function (x) { return x.id + '／' + x.short; }).join('、') + '）');
    }
    var s = spec.s != null ? spec.s : spec.km;
    if (!isNum(s) || s < 0 || s > Math.PI * P.R) throw new Error('地点的离塔根公里数不对：' + JSON.stringify(spec));
    var az = spec.az == null ? 0 : spec.az;
    if (!isNum(az)) throw new Error('地点的方位不对：' + JSON.stringify(spec));
    return { id: null, name: spec.name || ('离塔根 ' + Math.round(s) + ' 公里 · 方位 ' + az + '°'), s: s, az: az, preset: false };
  }

  /* 时刻（地方时一律按该地点的方位换算）：
   *   数                                绝对 t（日）
   *   {t}                               同上
   *   {rel, hour}                       第 year 年入冬交节起第 rel 个当地日（负＝入冬前；正文“入冬前 66 日”＝rel −66）的 hour 时
   *   {wd, hour}                        第 year 年“入冬后第 wd 日”（HY.calc.tOfWd，按年号口径落在第 year 年里）
   *   {mark}                            HY.world.MARKS 的标记（d1 d2 d3 festival heiyao winter …）；可再给 hour 改钟点
   *   at：noon 正午 · midnight 当夜子夜（次日 0 时）· dawn0／rise／dawn1 日面开始露出／露出一半／全露（塔东缘）
   *       · dusk0／set／dusk1 开始被切／切去一半／全没（塔西缘）· dawn／dusk 配 vis（露出比例）二分
   *   find：HY.calc.findNext 的 kind（blackHigh、litMoonNight、eclipse、festivalCross …），从上面算出的时刻往后找
   *   plusHours：最后再加几小时
   */
  function time(spec, st, P) {
    P = P || P0();
    if (spec == null) throw new Error('缺 time');
    if (isNum(spec)) return { t: spec, how: 't=' + spec };
    if (isNum(spec.t)) return { t: spec.t + (spec.plusHours || 0) / P.dayHours, how: 't=' + spec.t };
    var year = spec.year == null ? DEFAULTS.year : spec.year, off = (st.az - P.epochAz) / 360, O = A.site(st.s, st.az, P);
    var t, mid, how = [];
    if (spec.mark) {
      var m = W.markById(spec.mark);
      if (!m) throw new Error('没有这个标记：' + spec.mark + '（有 ' + W.MARKS.map(function (x) { return x.id; }).join('、') + '）');
      t = W.markT(m, year, st.az, P);
      mid = Math.floor(t - off + 1e-9) + off;
      how.push('标记 ' + m.label);
    } else if (spec.wd != null) {
      if (!isNum(spec.wd)) throw new Error('wd 要是数：' + spec.wd);
      mid = C.tOfWd(year, spec.wd, 0, st.az, P);
      how.push('入冬后第 ' + spec.wd + ' 日');
    } else {
      var rel = spec.rel == null ? 0 : spec.rel;
      if (!isNum(rel)) throw new Error('rel 要是数：' + rel);
      mid = W.winterT(year, P) + rel + off;
      how.push(rel < 0 ? '入冬前 ' + (-rel) + ' 日' : rel === 0 ? '入冬当日' : '入冬后 ' + rel + ' 日');
    }
    var at = spec.at == null ? null : (AT_ALIAS[spec.at] || spec.at);
    if (at != null && AT_IDS.indexOf(at) < 0) throw new Error('at 不认识：' + spec.at + '（可用 ' + AT_IDS.join('、') + '）');
    if (at) {
      if (at === 'noon') t = mid + 0.5;
      else if (at === 'midnight') t = mid + 1;
      else {
        var sp = C.sunSpan(O, P);
        if (!sp) throw new Error('这个地点终日不见日（塔基里），没有日出日落');
        if ((at === 'dawn' || at === 'dusk') && spec.vis != null) {
          var v = spec.vis, a = mid + (at === 'dawn' ? sp.dawn0 : sp.dusk0), b = mid + (at === 'dawn' ? sp.dawn1 : sp.dusk1);
          if (!(v > 0 && v < 1)) throw new Error('vis 要在 0 与 1 之间：' + v);
          // 早上露出随时间增、傍晚随时间减
          for (var k = 0; k < 40; k++) {
            var mm = (a + b) / 2, vv = A.sunlitAt(O, mm, P);
            if ((at === 'dawn') === (vv < v)) a = mm; else b = mm;
          }
          t = (a + b) / 2;
          how.push((at === 'dawn' ? '日面露出 ' : '日面剩 ') + v);
        } else {
          var key = at === 'dawn' ? 'rise' : at === 'dusk' ? 'set' : at;
          t = mid + sp[key];
        }
      }
      how.push(at);
    } else if (spec.hour != null) {
      if (!isNum(spec.hour)) throw new Error('hour 要是数：' + spec.hour);
      t = mid + spec.hour / P.dayHours;
      how.push(spec.hour + ' 时');
    } else if (t == null) t = mid;
    if (spec.find) {
      if (C.FIND_KINDS && C.FIND_KINDS.indexOf(spec.find) < 0) throw new Error('find 不认识：' + spec.find + '（可用 ' + C.FIND_KINDS.join('、') + '）');
      var f = C.findNext(spec.find, O, t, P, 1);
      if (f == null || !isFinite(f)) throw new Error('从这个时刻往后找不到 ' + spec.find);
      how.push('往后找 ' + spec.find + '（' + ((f - t) * 24).toFixed(2) + ' 时后）');
      t = f;
    }
    if (spec.plusHours) { t += spec.plusHours / P.dayHours; how.push('再加 ' + spec.plusHours + ' 时'); }
    return { t: t, how: how.join(' · ') };
  }

  /* 朝向：'sun'／'看太阳' 等快捷 | {yaw, pitch, fov} | {preset, pitch?, yaw?, dYaw?, dPitch?} */
  function look(spec) {
    if (spec == null) return null;
    if (typeof spec === 'string') spec = { preset: spec };
    if (Array.isArray(spec)) spec = { yaw: spec[0], pitch: spec[1], fov: spec[2] };
    var o = { preset: null, yaw: null, pitch: null, fov: null, dYaw: 0, dPitch: 0 };
    if (spec.preset != null) {
      var p = pick(LOOK_ALIAS, LOOK_IDS, spec.preset);
      if (!p) throw new Error('朝向快捷不认识：' + spec.preset + '（可用 ' + LOOK_IDS.join('、') + '，或 看太阳／看月／看塔根／看塔顶／天顶）');
      o.preset = p;
    }
    ['yaw', 'pitch', 'fov', 'dYaw', 'dPitch'].forEach(function (k) {
      if (spec[k] == null) return;
      if (!isNum(spec[k])) throw new Error('朝向的 ' + k + ' 要是数：' + spec[k]);
      o[k] = spec[k];
    });
    if (o.preset == null && o.yaw == null && o.pitch == null) throw new Error('朝向至少要给 preset 或 yaw／pitch');
    if (o.pitch != null && Math.abs(o.pitch) > 89) throw new Error('pitch 在 −89 到 89 之间：' + o.pitch);
    if (o.fov != null && (o.fov < 5 || o.fov > 100)) throw new Error('fov 在 5 到 100 之间：' + o.fov);
    if (o.preset === 'zenith' && o.yaw == null) o.yaw = 0;      // 天顶快捷不改方位：给定 0（朝北为上），免得跟着上一个场景
    return o;
  }

  /* 一个场景 → 规范化后的场景（不解析时刻；时刻要等地点与参数都设好，在页面里按当时的 P 算） */
  function normalize(sc, dflt) {
    dflt = dflt || {};
    if (!sc || typeof sc !== 'object') throw new Error('场景要是对象');
    if (!sc.name || typeof sc.name !== 'string') throw new Error('场景缺 name');
    var g = function (k) { return sc[k] != null ? sc[k] : dflt[k] != null ? dflt[k] : DEFAULTS[k]; };
    var view = VIEW_ALIAS[g('view')];
    if (!view) throw new Error('view 只能是 fp／ov（第一人称／总览）：' + g('view'));
    var n = { name: sc.name, view: view, site: sc.site != null ? sc.site : dflt.site != null ? dflt.site : 'zuiyu', time: sc.time != null ? sc.time : dflt.time };
    if (n.time == null) throw new Error('场景缺 time');
    if (n.time && typeof n.time === 'object' && n.time.year == null && dflt.year != null) n.time = Object.assign({}, n.time, { year: dflt.year });
    var ui = sc.ui != null ? sc.ui : dflt.ui;
    if (ui == null) ui = view === 'ov' ? 'full' : 'clean';
    if (ui !== 'clean' && ui !== 'full') throw new Error('ui 只能是 clean（只要画面）或 full（带界面）：' + ui);
    n.ui = ui;
    var tab = sc.tab != null ? pick(TAB_ALIAS, TAB_IDS, sc.tab) : 'site';
    if (!tab) throw new Error('tab 不认识：' + sc.tab);
    n.tab = tab;
    n.expect = sc.expect || null;
    n.note = sc.note || '';
    n.params = Object.assign({}, dflt.params || {}, sc.params || {});
    if (view === 'ov') {
      var ovp = sc.ov != null ? sc.ov : dflt.ov != null ? dflt.ov : 'oblique';
      n.ov = pick(OV_ALIAS, OV_IDS, ovp);
      if (!n.ov) throw new Error('总览预设不认识：' + ovp + '（可用 ' + OV_IDS.join('、') + '）');
      return n;
    }
    n.look = look(sc.look != null ? sc.look : dflt.look);
    n.fov = sc.fov != null ? sc.fov : n.look && n.look.fov != null ? n.look.fov : g('fov');
    if (!isNum(n.fov) || n.fov < 5 || n.fov > 100) throw new Error('fov 在 5 到 100 之间：' + n.fov);
    n.quality = pick(Q_ALIAS, Q_IDS, g('quality'));
    if (!n.quality) throw new Error('画质档不认识：' + g('quality') + '（low／mid／high／photo 或 低／中／高／拍照）');
    n.eye = g('eye');
    if (!isNum(n.eye) || n.eye < 1.2 || n.eye > 2) throw new Error('眼高（米）在 1.2 到 2 之间：' + n.eye);
    n.toggles = {};
    Object.keys(TOGGLES).forEach(function (k) {
      var v = sc[k] != null ? sc[k] : dflt[k];
      if (v == null) return;
      if (k === 'ground') { v = GROUND_ALIAS[v]; if (!v) throw new Error('ground 只能是 terrace／slope（阶地／斜坡）：' + sc[k]); }
      else if (typeof v !== 'boolean') throw new Error(k + ' 要是 true／false：' + v);
      n.toggles[k] = v;
    });
    n.minFrames = sc.minFrames || dflt.minFrames || 48;
    return n;
  }

  /* 天上此刻（给 index.json 与 --check 列表用） */
  function sky(st, t, P) {
    P = P || P0();
    var O = A.site(st.s, st.az, P), sun = A.look(O, A.sunPos(t, P), P), mo = A.look(O, A.moonPos(t, P), P);
    var cv = C.civil(t, st.az, P), so = C.seasonOf(t, O, P);
    var mn = C.moonNight ? C.moonNight(O, t, P) : null, state = A.moonState(t, P);
    var cal = W.fmtCal({ N: cv.N, cyc: cv.cyc, festival: cv.festival, wd: cv.wd, season: so.season, seasonDay: so.n, moonState: state, moonNight: mn ? mn.night : null }, 'full');
    var z = W.zoneOf(st.s, P, (HY.state && HY.state.zones) || { gLight: 0.75, gHeavy: 1.2, limboKm: 333 });
    return {
      cal: cal, rel: cv.rel, wd: cv.wd, hhmm: C.hhmm(cv.hour), shichen: C.shichen(cv.hour), lat: +O.lat.toFixed(3), zone: z.name,
      sunVis: +sun.vis.toFixed(3), sunEl: +sun.el.toFixed(2), sunAz: +A.wrapDeg(sun.az).toFixed(2),
      moonState: state, moonVis: +mo.vis.toFixed(3), moonEl: +mo.el.toFixed(2), moonAz: +A.wrapDeg(mo.az).toFixed(2),
      blackHigh: !!A.blackMoonHigh(O, t, P), litMoon: !!A.litMoonVisible(O, t, P), night: sun.vis < 0.5,
      eclipse: +A.eclipseFrac(O, t, P).toFixed(3)
    };
  }

  /* expect：场景的自检（不合时记警告，不算失败） */
  function expect(ex, s) {
    var out = [];
    if (!ex) return out;
    if (ex.blackHigh != null && !!ex.blackHigh !== s.blackHigh) out.push('预期' + (ex.blackHigh ? '' : '不是') + '黑月高悬，实际' + (s.blackHigh ? '是' : '不是'));
    if (ex.moonState != null && ex.moonState !== s.moonState) out.push('预期' + ex.moonState + '，实际' + s.moonState);
    if (ex.night != null && !!ex.night !== s.night) out.push('预期' + (ex.night ? '夜' : '昼') + '，实际' + (s.night ? '夜' : '昼'));
    if (ex.sunVis != null) {
      var r = Array.isArray(ex.sunVis) ? ex.sunVis : [ex.sunVis - 0.05, ex.sunVis + 0.05];
      if (s.sunVis < r[0] || s.sunVis > r[1]) out.push('日面露出 ' + s.sunVis + ' 不在 ' + r[0] + '–' + r[1]);
    }
    return out;
  }

  return { DEFAULTS: DEFAULTS, TOGGLES: TOGGLES, site: site, time: time, look: look, normalize: normalize, sky: sky, expect: expect };
}

/* ═════════════════════ 页面里：套用场景、等画面稳定、取读数（window.__shoot） ═════════════════════ */
function pageMain(libFn) {
  'use strict';
  var HY = window.HY, L = libFn(HY);
  var S = window.__shootState = window.__shootState || { fpInitMs: null, tierMs: {}, touched: {}, noise: [], contextLost: 0 };
  function now() { return performance.now(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function raf(n) { return new Promise(function (r) { var k = 0; function f() { if (++k >= (n || 1)) r(); else requestAnimationFrame(f); } requestAnimationFrame(f); }); }
  function msg(e) { return (e && e.message) || String(e); }
  function r3(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v; }
  function sig(v, n) { return typeof v === 'number' && isFinite(v) ? +v.toPrecision(n || 4) : null; }

  // 三维云噪声：fp.js 进第一人称时调 HY.fp.noise.gen3D 分帧生成；包一层只为拿到它的 done（测试侧，不改 src）
  if (HY.fp && HY.fp.noise && typeof HY.fp.noise.gen3D === 'function' && !HY.fp.noise.__shootWrapped) {
    var g0 = HY.fp.noise.gen3D;
    HY.fp.noise.gen3D = function () { var j = g0.apply(this, arguments); try { if (j && j.done) S.noise.push(j.done); } catch (e) { /* 忽略 */ } return j; };
    HY.fp.noise.__shootWrapped = true;
  }
  if (HY.bus && !S.ctxHooked) { S.ctxHooked = true; HY.bus.on('context', function (e) { if (e && e.lost) S.contextLost++; }); }

  function css(mode) {
    var el = document.getElementById('__shootCss');
    if (!el) { el = document.createElement('style'); el.id = '__shootCss'; document.head.appendChild(el); }
    // 提示条一律不进图；只要画面时再藏起“显示界面”按钮与加载框
    el.textContent = '#toast{display:none!important}' + (mode === 'clean' ? '#chromeBtn,#busy{display:none!important}' : '');
  }
  function glErr() {
    var gl = HY.gfx && HY.gfx.renderer && HY.gfx.renderer.getContext(), e, out = [];
    if (!gl) return out;
    for (var i = 0; i < 8 && (e = gl.getError()); i++) out.push('0x' + e.toString(16));
    return out;
  }
  function setParam(path, v) {
    var cur = HY.util && HY.util.getPath ? HY.util.getPath(HY.state, path) : path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, HY.state);
    if (cur !== v) HY.app.setParam(path, v);
  }
  function schemaDef(path) { var sp = HY.store.SCHEMA[path]; if (!sp) throw new Error('状态里没有这一项：' + path); return sp.def; }

  // 本场景要的开关与参数；上一场景动过、这一场景没写的回到默认
  function applyParams(n) {
    var want = {};
    Object.keys(L.TOGGLES).forEach(function (k) { var p = L.TOGGLES[k]; want[p] = n.toggles && n.toggles[k] != null ? n.toggles[k] : schemaDef(p); });
    Object.keys(n.params || {}).forEach(function (p) { schemaDef(p); want[p] = n.params[p]; });
    Object.keys(S.touched).forEach(function (p) { if (!(p in want)) want[p] = schemaDef(p); });
    if (n.view === 'fp') { want['fp.eye'] = n.eye; want['fp.dynRes'] = !!S.dynRes; }
    Object.keys(want).forEach(function (p) { setParam(p, want[p]); });
    S.touched = {};
    Object.keys(n.params || {}).forEach(function (p) { S.touched[p] = 1; });
  }
  async function applyUi(n) {
    var clean = n.ui === 'clean';
    css(n.ui);
    if (HY.state.ui.chrome !== !clean) HY.store.set('ui.chrome', !clean, 'api');
    if (!clean && !HY.state.ui.panel) HY.store.set('ui.panel', true, 'api');
    if (HY.state.ui.tab !== n.tab) HY.store.set('ui.tab', n.tab, 'api');
    await sleep(60);
    HY.app.resize();
  }
  // 等目标档位编完（每帧至多编一个程序；KHR_parallel_shader_compile 在后台编，所以帧之间让出主线程）
  async function waitTier(q, maxMs) {
    var t0 = now();
    for (;;) {
      var d = HY.fp.debug();
      if (d && !d.compile.pending && d.tier === q && HY.state.fp.quality === q) return { ms: now() - t0, tier: d.tier };
      if (d && d.compile.error) throw new Error('“' + q + '”档着色器编译出错：' + d.compile.error);
      if (HY.state.fp.quality !== q) return { ms: now() - t0, tier: d && d.tier, warn: '档位被改成了 ' + HY.state.fp.quality + '（自动降档？）' };
      if (now() - t0 > maxMs) throw new Error('等“' + q + '”档编译超时（' + Math.round(maxMs / 1000) + ' 秒）');
      await HY.app.settle(1); await sleep(4);
    }
  }
  async function waitNoise(maxMs) {
    if (!S.noise.length) return 0;
    var t0 = now(), all = Promise.all(S.noise.slice());
    await Promise.race([all, sleep(maxMs || 20000)]);
    return now() - t0;
  }
  async function applyLook(n) {
    var lk = n.look || {};
    if (lk.preset) { HY.fp.api.lookPreset(lk.preset, { instant: true }); await HY.app.settle(2); }
    var ps = HY.fp.api.pose();
    var yaw = (lk.yaw != null ? lk.yaw : ps.yaw) + (lk.dYaw || 0);
    var pitch = Math.max(-89, Math.min(89, (lk.pitch != null ? lk.pitch : ps.pitch) + (lk.dPitch || 0)));
    HY.app.look(yaw, pitch, n.fov);
    await HY.app.settle(1);
  }
  // 眼 pass 的读回（同步，2×1）：[曝光, 适应亮度 La, 到眼日照 klux, 照明色, 水平面照度 klux, 其中直射, 测光目标 La*, 1]。
  // HY.fp.readouts() 不带测光目标，这里直接读帧图（HY.fp._graph() 是 E 路留给浏览器验收的调试口）
  function eyeRaw() {
    var g = HY.fp._graph && HY.fp._graph(), e = g && g.readEyeSync ? g.readEyeSync() : null;
    return e && e.length >= 7 ? { expo: e[0], La: e[1], Eeye: e[2] * 1000, Eh: e[4] * 1000, Edir: e[5] * 1000, LaT: e[6] } : null;
  }
  // 画面稳定：眼的适应亮度收敛到测光目标（|ln La/目标|＜2%），TAA 累积满（下雨、余息飘尘时不累积：静止满 max(累积数, 20) 帧即可）。
  // 连着两次检查都达标才算；至少 minFrames 帧。每次检查前连跑 8 帧（HY.app.settle，固定 1/60 秒一帧）。
  // 上限：MAX_FRAMES 帧（＝20 秒的眼适应，变暗 τ＝3 s，足够从任何起点收敛）或 maxMs 墙钟；到了还不稳＝测光目标在逐帧跳（画面闪）
  var MAX_FRAMES = 1200;
  async function stabilize(n, maxMs) {
    var t0 = now(), frames = 0, okRun = 0, r = null, timeout = false, capped = false;
    for (;;) {
      await HY.app.settle(8); frames += 8;
      await sleep(0);
      var ey = eyeRaw(), acc = HY.fp.eye.accum();
      var err = ey && ey.La > 0 && ey.LaT > 0 ? Math.abs(Math.log(ey.La / ey.LaT)) : Infinity;
      var eyeOk = HY.state.fp.eyeo.auto === false || err < 0.02;
      var falling = !acc.still && acc.frames === 0 && frames >= 40;
      var taaOk = acc.done || (falling && frames >= Math.max(acc.of, 20) + 16);
      r = { eyeErr: r3(err), taa: { n: acc.n, of: acc.of, still: acc.still, done: acc.done }, falling: falling };
      if (frames >= n.minFrames && eyeOk && taaOk) { if (++okRun >= 2) break; } else okRun = 0;
      if (frames >= MAX_FRAMES) { capped = true; break; }
      if (now() - t0 > maxMs) { timeout = true; break; }
    }
    r.frames = frames; r.ms = Math.round(now() - t0); r.timeout = timeout; r.capped = capped;
    return r;
  }
  // 真实帧率：放开 app 自己的 rAF 帧循环跑 sec 秒（相机、时间都不动，TAA 照样累积）
  async function rafFps(sec) {
    var t0 = now(), frames = 0;
    await new Promise(function (res) { function f() { frames++; if (now() - t0 < sec * 1000) requestAnimationFrame(f); else res(); } requestAnimationFrame(f); });
    return frames / ((now() - t0) / 1000);
  }
  // 画面漂移：TAA 输出（屏上看到的那一层，已累积）9×9 个点的亮度，隔一段时间再取一次比相对变化。
  // 读的是最近写完的那张 tTAA（交换之后 taaCur 指向下一帧要写的，所以取 1−taaCur）；雨丝、飘尘时 TAA 不累积，会偏大
  function lumGrid() {
    var g = HY.fp._graph && HY.fp._graph(), out = [];
    if (!g || !g.targets || !g.readRegion) return out;
    var idx = 1 - g.state().taaCur, T = g.targets.tTAA, rt = Array.isArray(T) ? T[idx] : T;
    if (!rt) return out;
    for (var j = 0; j < 9; j++) for (var i = 0; i < 9; i++) {
      var x = Math.round((i + 0.5) / 9 * (rt.width - 1)), y = Math.round((j + 0.5) / 9 * (rt.height - 1));
      var d = g.readRegion('tTAA', idx, x, y, 1, 1);
      out.push(d ? 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2] : NaN);
    }
    return out;
  }
  function drift(a, b) {
    var d = [];
    for (var k = 0; k < a.length; k++) if (isFinite(a[k]) && isFinite(b[k]) && a[k] + b[k] > 0) d.push(Math.abs(b[k] - a[k]) / Math.max(1e-6, 0.5 * (a[k] + b[k])));
    if (!d.length) return null;
    d.sort(function (x, y) { return x - y; });
    return { median: r3(d[Math.floor(d.length / 2)]), p90: r3(d[Math.floor(d.length * 0.9)]), max: r3(d[d.length - 1]) };
  }
  function nanScan() {
    var n = 0, bad = 0, lo = Infinity, hi = -Infinity;
    for (var j = 0; j < 9; j++) for (var i = 0; i < 9; i++) {
      var r = HY.fp.readPxRGB((i + 0.5) / 9, (j + 0.5) / 9); n++;
      if (!r) { bad++; continue; }
      var Lm = 0.2126 * r.L[0] + 0.7152 * r.L[1] + 0.0722 * r.L[2];
      if (!isFinite(Lm)) bad++; else { lo = Math.min(lo, Lm); hi = Math.max(hi, Lm); }
    }
    return { samples: n, nonFinite: bad, Lmin: sig(lo, 3), Lmax: sig(hi, 3) };
  }
  function perfOf() {
    var p = HY.app.perf(), g = HY.app.gpuTimes() || {}, top = [];
    for (var k in g) if (isFinite(g[k])) top.push([k, r3(g[k])]);
    top.sort(function (a, b) { return b[1] - a[1]; });
    return { appFps: r3(p.fps), cpuMs: r3(p.cpuMs), gpuMs: r3(p.gpuMs), res: p.w && p.h ? p.w + '×' + p.h : String(p.res), scale: p.w ? r3(p.res) : null, tier: p.tier, gpuTop: top.slice(0, 6) };
  }

  async function runFp(n, rec, T0, opt) {
    if (HY.app.active() !== 'fp') {
      var av = HY.app.fpAvail();
      if (!av.ok) throw new Error('第一人称不可用：' + av.reason);
      var ti = now();
      await HY.app.view('fp');
      var dt = Math.round(now() - ti);
      rec.timing.enterMs = dt;
      if (S.fpInitMs == null) S.fpInitMs = dt;
    }
    HY.app.play(false);
    applyParams(n);
    if (HY.state.fp.quality !== n.quality) HY.app.quality(n.quality);
    var st = L.site(n.site, HY.model.P);
    HY.app.setSite(st.preset ? st.id : { s: st.s, az: st.az });
    var tm = L.time(n.time, st, HY.model.P);
    HY.app.setTime(tm.t);
    HY.fp.teleport({ s: st.s, az: st.az });                  // 地点没变也重新落脚：每个场景与先后次序无关
    var tc = now(), w = await waitTier(n.quality, opt.compileMs || 300000);
    rec.timing.compileMs = Math.round(w.ms);
    if (w.ms > 500 && S.tierMs[n.quality] == null) S.tierMs[n.quality] = Math.round(w.ms);
    if (w.warn) rec.warnings.push(w.warn);
    await HY.app.settle(2);
    await applyLook(n);
    rec.timing.firstFrameMs = Math.round(now() - T0);
    rec.timing.noiseWaitMs = Math.round(await waitNoise(20000));
    var sz = await stabilize(n, opt.settleMs || 90000);
    rec.converge = sz;
    rec.timing.settleMs = sz.ms; rec.timing.settleFrames = sz.frames;
    if (sz.timeout) rec.warnings.push('画面没有在 ' + Math.round((opt.settleMs || 90000) / 1000) + ' 秒内稳定（眼差 ' + sz.eyeErr + '，TAA ' + sz.taa.n + '/' + sz.taa.of + '）');
    if (sz.capped) rec.warnings.push('连跑 ' + sz.frames + ' 帧（' + Math.round(sz.frames / 60) + ' 秒的眼适应）仍不稳：眼差 ' + sz.eyeErr + '，测光目标在逐帧跳，画面在闪');
    var tf = now(), g0 = lumGrid();
    var fps = await rafFps(opt.fpsSec || 1.5);
    var dr = drift(g0, lumGrid());
    var eh = HY.app.Eh(), ey = eyeRaw() || {}, ro = HY.fp.readouts(), ps = HY.fp.api.pose(), cam = HY.fp.cam && HY.fp.cam.current ? HY.fp.cam.current.info() : null;
    rec.timing.measureMs = Math.round(now() - tf);
    rec.site = { id: HY.state.site.id, name: st.name, s: r3(ps.s), az: r3(ps.az) };
    rec.time = { t: tm.t, how: tm.how };
    rec.look = { yaw: r3(ps.yaw), pitch: r3(ps.pitch), fov: r3(ps.fov), eyeM: r3(ps.alt * 1000) };
    rec.quality = n.quality;
    rec.toggles = { atmo: HY.state.fp.atmo.on, veil: HY.state.fp.set.veil, ground: HY.state.fp.ground.mode, clouds: HY.state.fp.cloud.on };
    if (cam) rec.toggles.groundActual = cam.mode === 1 ? 'terrace' : 'slope';
    if (Object.keys(n.params || {}).length) rec.params = n.params;
    rec.readouts = { lux: sig(eh && eh.lux, 4), luxEst: !!(eh && eh.est), ev: r3(ro.ev), eye: ro.eye, La: sig(ey.La, 4), LaTarget: sig(ey.LaT, 4),
      Eeye: sig(ey.Eeye, 4), Edir: sig(ey.Edir, 4), expo: sig(ey.expo, 4) };
    var pf = perfOf(); pf.rafFps = r3(fps);
    rec.perf = pf;
    rec.tier = pf.tier;
    if (pf.tier !== n.quality) rec.warnings.push('实际档位 ' + pf.tier + '，要的是 ' + n.quality);
    if (cam) rec.camera = { zone: cam.zone, lat: r3(cam.lat), level: cam.level, tread: r3(cam.tread), slope: r3(cam.slope), Hc: r3(cam.Hc) };
    var sc = nanScan(); rec.checks = { nan: sc, drift: dr, glErr: glErr(), fpErrors: (HY.fp.debug().errors || []).slice(-5), contextLost: S.contextLost };
    if (dr && dr.p90 > 0.05) rec.warnings.push('画面还在变：测帧率那 ' + (opt.fpsSec || 1.5) + ' 秒里 9×9 采样亮度变化 p90＝' + Math.round(dr.p90 * 100) + '%' + (sz.falling ? '（有雨丝或飘尘）' : ''));
    if (sc.nonFinite) rec.warnings.push('画面里有 ' + sc.nonFinite + '/' + sc.samples + ' 个采样不是有限数');
    if (rec.checks.glErr.length) rec.warnings.push('GL 错误 ' + rec.checks.glErr.join(','));
    return tm.t;
  }
  async function runOv(n, rec, T0) {
    if (HY.app.active() !== 'ov') await HY.app.view('ov');
    if (HY.app.active() !== 'ov') throw new Error('总览不可用' + (HY.ov && HY.ov.status ? '：' + HY.ov.status().reason : ''));
    HY.app.play(false);
    applyParams(n);
    var st = L.site(n.site, HY.model.P);
    HY.app.setSite(st.preset ? st.id : { s: st.s, az: st.az });
    var tm = L.time(n.time, st, HY.model.P);
    HY.app.setTime(tm.t);
    HY.app.ovPreset(n.ov);
    await HY.app.settle(4);
    rec.timing.firstFrameMs = Math.round(now() - T0);
    await sleep(600);                                        // 图表按 ≤10 Hz 刷新、标签与读数按真实时间节流
    var tf = now(), fps = await rafFps(1.5);
    rec.timing.measureMs = Math.round(now() - tf);
    rec.site = { id: HY.state.site.id, name: st.name, s: r3(st.s), az: r3(st.az) };
    rec.time = { t: tm.t, how: tm.how };
    rec.ov = n.ov;
    var eh = HY.app.Eh(), pf = perfOf(); pf.rafFps = r3(fps);
    rec.readouts = { lux: sig(eh && eh.lux, 4), luxEst: true };
    rec.perf = pf;
    rec.checks = { glErr: glErr() };
    return tm.t;
  }

  window.__shoot = {
    info: function () {
      var gl = HY.gfx && HY.gfx.renderer && HY.gfx.renderer.getContext(), dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      var caps = (HY.gfx && HY.gfx.caps) || {};
      return {
        build: HY.BUILD || null, title: document.title, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight,
        gpu: { renderer: gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null, vendor: gl ? (dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) : null,
          ok: !!caps.ok, webgl2: !!caps.webgl2, floatRT: !!caps.floatRT, floatLinear: !!caps.floatLinear, timer: !!caps.timer, parallel: !!caps.parallel, reason: caps.reason || '' },
        fp: HY.app.fpAvail ? HY.app.fpAvail() : null, ov: HY.ov && HY.ov.status ? HY.ov.status() : null
      };
    },
    // 只解析不出图（--check 在页面里复核用）
    resolve: function (sc, dflt) {
      var n = L.normalize(sc, dflt), st = L.site(n.site, HY.model.P), tm = L.time(n.time, st, HY.model.P);
      return { n: n, site: st, time: tm, sky: L.sky(st, tm.t, HY.model.P) };
    },
    run: async function (sc, dflt, opt) {
      opt = opt || {};
      S.dynRes = !!opt.dynRes;
      var T0 = now(), rec = { name: sc && sc.name, ok: false, warnings: [], timing: {} }, t = null;
      try {
        var n = L.normalize(sc, dflt);
        rec.view = n.view; rec.ui = n.ui; if (n.note) rec.note = n.note;
        await applyUi(n);
        t = n.view === 'ov' ? await runOv(n, rec, T0) : await runFp(n, rec, T0, opt);
        var st = L.site(n.site, HY.model.P), sk = L.sky(st, t, HY.model.P);
        var tick = HY.model.tick();
        rec.time.cal = tick && tick.calText ? tick.calText : sk.cal;
        rec.time.hhmm = sk.hhmm; rec.time.shichen = sk.shichen; rec.time.rel = sk.rel; rec.time.wd = sk.wd;
        rec.site.lat = sk.lat; rec.site.zone = sk.zone;
        if (n.view === 'fp') {                                  // 第一人称：按相机此刻的真实位置
          sk.sunVis = +(+HY.app.sunVis()).toFixed(3);
        }
        delete sk.cal; delete sk.hhmm; delete sk.shichen; delete sk.rel; delete sk.wd; delete sk.lat; delete sk.zone;
        rec.sky = sk;
        L.expect(n.expect, sk).forEach(function (w) { rec.warnings.push(w); });
        await raf(2);                                           // 让最后一帧合成上屏，再由 node 截图
        rec.ok = true;
      } catch (e) {
        rec.error = msg(e);
        if (e && e.stack) rec.stack = String(e.stack).split('\n').slice(0, 6).join('\n');
      }
      rec.timing.totalMs = Math.round(now() - T0);
      return rec;
    },
    state: function () { return { fpInitMs: S.fpInitMs, tierMs: S.tierMs, contextLost: S.contextLost, view: HY.app.active(), fp: HY.fp.status ? HY.fp.status() : null }; }
  };
  return true;
}

/* ═════════════════════ node：命令行、浏览器、CDP ═════════════════════ */
function usage() {
  return [
    '用法：node test/shoot.js [场景文件…] [选项]',
    '  不给场景文件：只检查 test/scenes_std.json（不开浏览器）',
    '  --std                 用 test/scenes_std.json',
    '  --check               只检查场景、列出解析后的地点与时刻，不开浏览器',
    '  --out <目录>          输出目录（默认 test/shots/<日期_时刻>）',
    '  --clean               先删掉输出目录里旧的 .png 与 index.json',
    '  --only <词,词>        只跑名字含这些词的场景（也可写序号，如 1,5-8）',
    '  --ui clean|full       没写 ui 的第一人称场景用哪种（默认 clean＝只要画面；总览默认 full）',
    '  --size 1440x900       窗口（CSS 像素，像素比 1）',
    '  --page <html>         要打开的页面（默认 🗺️ 互动地图/环域星体模型.html）',
    '  --browser <exe>       指定 Chrome／Edge；也可设环境变量 HY_BROWSER',
    '  --prefer chrome|edge  自动找浏览器时先找哪个（默认 chrome）',
    '  --dynres              保留动态分辨率（默认关掉，内部分辨率按档位固定，截图可比）',
    '  --settle <秒>         每个场景等画面稳定的上限（默认 90）',
    '  --swiftshader         允许退回软件渲染（默认不允许：要真 GPU）',
    '  --headful             开窗口跑（调试用）',
    '  --keep-profile        运行完不删用户目录（调试用）'
  ].join('\n');
}

function parseArgs(argv) {
  const o = { files: [], out: null, clean: false, only: null, ui: null, size: [1440, 900], page: PAGE_DEFAULT, browser: process.env.HY_BROWSER || null,
    prefer: 'chrome', dynRes: false, settle: 90, swiftshader: false, headful: false, keepProfile: false, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(a + ' 后面缺值'); return argv[++i]; };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--std': o.files.push(STD); break;
      case '--check': case '--list': o.check = true; break;
      case '--out': o.out = path.resolve(next()); break;
      case '--clean': o.clean = true; break;
      case '--only': o.only = next().split(/[,，]/).map(s => s.trim()).filter(Boolean); break;
      case '--ui': o.ui = next(); if (o.ui !== 'clean' && o.ui !== 'full') throw new Error('--ui 只能是 clean 或 full'); break;
      case '--size': { const m = /^(\d+)[x×*](\d+)$/.exec(next()); if (!m) throw new Error('--size 写成 1440x900'); o.size = [+m[1], +m[2]]; break; }
      case '--page': o.page = path.resolve(next()); break;
      case '--browser': o.browser = next(); break;
      case '--prefer': o.prefer = next(); break;
      case '--dynres': o.dynRes = true; break;
      case '--settle': o.settle = +next(); break;
      case '--swiftshader': o.swiftshader = true; break;
      case '--headful': o.headful = true; break;
      case '--keep-profile': o.keepProfile = true; break;
      default:
        if (a.startsWith('-')) throw new Error('不认识的选项 ' + a + '\n' + usage());
        o.files.push(path.resolve(a));
    }
  }
  if (!o.files.length) { o.files.push(STD); if (!o.help) o.check = true; }
  return o;
}

function readScenes(files) {
  const all = [];
  for (const f of files) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('读不了场景文件 ' + f + '：' + e.message); }
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.scenes) ? raw.scenes : null;
    if (!list) throw new Error('场景文件要是数组，或 {defaults, scenes:[…]}：' + f);
    const dflt = Array.isArray(raw) ? {} : raw.defaults || {};
    list.forEach(sc => all.push({ sc, dflt, file: f }));
  }
  return all;
}
function selectScenes(items, only) {
  if (!only) return items.map((it, i) => Object.assign({ i: i + 1 }, it));
  const idx = new Set(), words = [];
  only.forEach(w => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(w);
    if (m) { for (let k = +m[1]; k <= +(m[2] || m[1]); k++) idx.add(k); } else words.push(w);
  });
  return items.map((it, i) => Object.assign({ i: i + 1 }, it))
    .filter(it => idx.has(it.i) || words.some(w => String(it.sc && it.sc.name).includes(w)));
}
function safeName(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').slice(0, 80); }
// 按显示宽度补空格（汉字算两格）
function padW(s, w) { let n = 0; for (const ch of String(s)) n += /[ᄀ-￿]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(1, w - n)); }
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function stamp(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 只检查：node 里载入 HY（test/_load.js），逐个规范化并解析地点、时刻 ── */
function checkScenes(items, opt) {
  const HY = require('./_load.js')();
  const L = shootLib(HY), P = HY.astro.params();
  let bad = 0;
  const names = new Set();
  console.log('场景检查：' + items.length + ' 个（' + [...new Set(items.map(x => path.relative(ROOT, x.file)))].join('、') + '）');
  for (const it of items) {
    try {
      const n = L.normalize(it.sc, Object.assign({}, it.dflt, opt.ui ? { ui: opt.ui } : {}));
      if (names.has(n.name)) throw new Error('场景名重复：' + n.name);
      names.add(n.name);
      Object.keys(n.params || {}).forEach(p => { if (!HY.store.SCHEMA[p]) throw new Error('状态里没有这一项：' + p); });
      const st = L.site(n.site, P), tm = L.time(n.time, st, P), sk = L.sky(st, tm.t, P), ex = L.expect(n.expect, sk);
      const lk = n.view === 'ov' ? '总览·' + n.ov + (n.tab !== 'site' ? '·' + n.tab : '') :
        (n.look ? [n.look.preset, n.look.yaw != null ? 'yaw ' + n.look.yaw : '', n.look.pitch != null ? 'pitch ' + n.look.pitch : ''].filter(Boolean).join(' ') : '朝向不变') + ' · fov ' + n.fov + ' · ' + n.quality;
      const tg = (n.toggles ? Object.keys(n.toggles).map(k => k + '=' + n.toggles[k]) : []).concat(Object.keys(n.params || {}).map(k => k + '=' + n.params[k])).join(' ');
      console.log(`  ${pad2(it.i)} ${padW(n.name, 26)} ${st.name} · ${sk.cal.replace(/^第 \d+ 年（[^）]*） · /, '')} ${sk.hhmm} · 日面 ${sk.sunVis} 仰 ${sk.sunEl}° · ${sk.moonState}${sk.blackHigh ? '·黑月高悬' : ''} · ${lk}${tg ? ' · ' + tg : ''}`);
      ex.forEach(w => console.log('       ⚠ ' + w));
    } catch (e) {
      bad++;
      console.log(`  ${pad2(it.i)} ✗ ${it.sc && it.sc.name || '（无名）'}：${e.message}`);
    }
  }
  console.log(bad ? `\n${bad} 个场景有错` : '\n全部可以解析');
  return bad;
}

/* ── 浏览器 ── */
function findBrowser(o) {
  const tried = [];
  const ok = p => { tried.push(p); try { return p && fs.statSync(p).isFile(); } catch (e) { return false; } };
  if (o.browser) { if (ok(o.browser)) return o.browser; throw new Error('找不到指定的浏览器：' + o.browser); }
  const env = process.env, PF = env.ProgramFiles || 'C:\\Program Files', PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', LAD = env.LOCALAPPDATA || '';
  const chrome = process.platform === 'win32'
    ? [path.join(PF, 'Google/Chrome/Application/chrome.exe'), path.join(PF86, 'Google/Chrome/Application/chrome.exe'), LAD && path.join(LAD, 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const edge = process.platform === 'win32'
    ? [path.join(PF86, 'Microsoft/Edge/Application/msedge.exe'), path.join(PF, 'Microsoft/Edge/Application/msedge.exe')]
    : process.platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/microsoft-edge'];
  const order = o.prefer === 'edge' ? edge.concat(chrome) : chrome.concat(edge);
  for (const p of order) if (p && ok(p)) return p;
  throw new Error('没找到 Chrome 或 Edge（找过：' + tried.filter(Boolean).join('；') + '）。用 --browser 指定，或设环境变量 HY_BROWSER');
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pend = new Map(); this.listeners = []; this.closed = false; }
  open() {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(this.wsUrl);
      ws.onopen = () => res();
      ws.onerror = e => rej(new Error('连不上 DevTools：' + (e && e.message || this.wsUrl)));
      ws.onclose = () => { this.closed = true; for (const [, p] of this.pend) p.rej(new Error('DevTools 连接断了')); this.pend.clear(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.id != null && this.pend.has(m.id)) {
          const p = this.pend.get(m.id); this.pend.delete(m.id); clearTimeout(p.timer);
          if (m.error) p.rej(new Error(m.error.message + (m.error.data ? '：' + m.error.data : ''))); else p.res(m.result || {});
        } else if (m.method) this.listeners.forEach(f => { try { f(m.method, m.params || {}); } catch (e) { /* 忽略 */ } });
      };
    });
  }
  on(f) { this.listeners.push(f); }
  send(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error('DevTools 连接已断'));
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pend.delete(id); rej(new Error(method + ' 超时（' + Math.round((timeoutMs || 60000) / 1000) + ' 秒）')); }, timeoutMs || 60000);
      this.pend.set(id, { res, rej, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  // 在页面里求值（可 await）；页面抛错时在 node 里抛出
  async eval(expr, timeoutMs) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面里出错：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws && this.ws.close(); } catch (e) { /* 忽略 */ } }
}

async function launch(o, exe) {
  fs.mkdirSync(PROFILES, { recursive: true });
  const prof = path.join(PROFILES, 'run_' + process.pid + '_' + Date.now().toString(36));
  fs.mkdirSync(prof, { recursive: true });
  const args = [
    o.headful ? null : '--headless=new',
    '--remote-debugging-port=0',                             // 系统随机分配空闲端口，写进用户目录的 DevToolsActivePort
    '--user-data-dir=' + prof,
    process.platform === 'win32' ? '--use-angle=d3d11' : null,
    '--ignore-gpu-blocklist', '--enable-gpu',
    o.swiftshader ? '--enable-unsafe-swiftshader' : null,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=1', '--window-size=' + o.size[0] + ',' + o.size[1],
    'about:blank'
  ].filter(Boolean);
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', exited = null;
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  proc.on('exit', code => { exited = code; });
  proc.on('error', e => { exited = e.message; });
  const portFile = path.join(prof, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 150 && !port; i++) {
    if (exited !== null) throw new Error('浏览器启动就退出了（' + exited + '）：' + stderr.slice(-800));
    try { const s = fs.readFileSync(portFile, 'utf8').split(/\r?\n/); if (+s[0] > 0) port = +s[0]; } catch (e) { /* 还没写 */ }
    if (!port) await sleep(100);
  }
  if (!port) throw new Error('15 秒内没等到浏览器的 DevTools 端口：' + stderr.slice(-800));
  const base = 'http://127.0.0.1:' + port;
  let ver = {}, page = null;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      ver = await (await fetch(base + '/json/version')).json();
      const list = await (await fetch(base + '/json/list')).json();
      page = list.find(t => t.type === 'page');
    } catch (e) { /* 还没好 */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('浏览器里没有可用的页签');
  return { proc, prof, port, args, ver, page, exited: () => exited };
}

async function shutdown(b, cdp, keep) {
  if (cdp) { try { await cdp.send('Browser.close', {}, 3000); } catch (e) { /* 忽略 */ } cdp.close(); }
  if (b && b.proc) {
    for (let i = 0; i < 50 && b.exited() === null; i++) await sleep(100);
    if (b.exited() === null) { try { b.proc.kill(); } catch (e) { /* 忽略 */ } await sleep(500); }
  }
  if (b && b.prof && !keep) {
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(b.prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); break; } catch (e) { await sleep(500); }
    }
    try { if (!fs.readdirSync(PROFILES).length) fs.rmdirSync(PROFILES); } catch (e) { /* 忽略 */ }
  }
}

function fmtMs(ms) { return ms == null ? '—' : ms >= 10000 ? (ms / 1000).toFixed(0) + ' s' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms'; }
function fmtLux(v) { return v == null || !isFinite(v) ? '—' : v === 0 ? '0 lux' : v >= 1000 ? (v / 1000).toPrecision(3) + ' klux' : v >= 1 ? v.toPrecision(3) + ' lux' : v.toPrecision(2) + ' lux'; }

async function shoot(o, items) {
  if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') throw new Error('需要 node 22 或更新（要内置的 WebSocket 与 fetch），现在是 ' + process.version);
  if (!fs.existsSync(o.page)) throw new Error('页面不存在：' + o.page + '（先 py build.py）');
  const outDir = o.out || path.join(TEST, 'shots', stamp(new Date()));
  fs.mkdirSync(outDir, { recursive: true });
  if (o.clean) for (const f of fs.readdirSync(outDir)) if (/\.png$/i.test(f) || f === 'index.json') fs.rmSync(path.join(outDir, f), { force: true });
  const exe = findBrowser(o);
  const pageStat = fs.statSync(o.page), pageUrl = url.pathToFileURL(o.page).href;
  const started = new Date();
  console.log('浏览器：' + exe);
  console.log('页面：' + o.page);
  console.log('输出：' + outDir);

  let b = null, cdp = null, aborted = false;
  const onSig = () => { aborted = true; console.log('\n中断，正在关浏览器……'); shutdown(b, cdp, o.keepProfile).then(() => process.exit(130)); };
  process.on('SIGINT', onSig);
  const index = {
    tool: 'test/shoot.js', started: started.toISOString(), finished: null, seconds: null,
    page: { path: o.page, url: pageUrl, bytes: pageStat.size, mtime: pageStat.mtime.toISOString(), build: null },
    browser: { path: exe, product: null, args: null }, gpu: null, viewport: { w: o.size[0], h: o.size[1], dpr: 1 },
    options: { ui: o.ui, dynRes: o.dynRes, settleS: o.settle, only: o.only, scenes: o.files.map(f => path.relative(ROOT, f)) },
    fp: null, summary: null, scenes: []
  };
  const writeIndex = () => fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n', 'utf8');
  let bucket = [];
  try {
    b = await launch(o, exe);
    index.browser.product = b.ver.Browser || null; index.browser.args = b.args.filter(a => !a.startsWith('--user-data-dir'));
    cdp = new CDP(b.page.webSocketDebuggerUrl);
    await cdp.open();
    cdp.on((m, p) => {
      if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning' || p.type === 'assert')) {
        bucket.push({ type: p.type, text: (p.args || []).map(a => a.value != null ? String(a.value) : a.description || '').join(' ').slice(0, 600) });
      } else if (m === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails || {};
        bucket.push({ type: 'exception', text: String((d.exception && d.exception.description) || d.text).slice(0, 600) });
      } else if (m === 'Log.entryAdded' && p.entry && (p.entry.level === 'error')) {
        bucket.push({ type: 'log', text: (p.entry.source + '：' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : '')).slice(0, 600) });
      }
    });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.size[0], height: o.size[1], deviceScaleFactor: 1, mobile: false });
    const tNav = Date.now();
    await cdp.send('Page.navigate', { url: pageUrl });
    let ready = null;
    for (let i = 0; i < 240; i++) {
      try {
        ready = await cdp.eval('(function(){var H=window.HY;if(!(H&&H.app&&H.ov&&H.fp&&document.readyState==="complete"))return null;var ph=H.ov.status().phase;var c=H.gfx&&H.gfx.caps;if(c&&!c.ok)return{fail:c.reason};return ph==="ready"?{ok:1}:ph==="failed"?{fail:H.ov.status().reason}:null;})()', 10000);
      } catch (e) { ready = null; }
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error('60 秒内页面没有就绪（three.js 要从 cdnjs 加载，需要联网）');
    if (ready.fail) throw new Error('三维视图没起来：' + ready.fail);
    const loadMs = Date.now() - tNav;
    await cdp.eval('(' + pageMain.toString() + ')(' + shootLib.toString() + ')');
    const info = await cdp.eval('window.__shoot.info()');
    index.page.build = info.build; index.gpu = info.gpu; index.page.loadMs = loadMs; index.page.ua = info.ua;
    console.log('构建：' + (info.build ? JSON.stringify(info.build) : '—') + '；页面就绪 ' + fmtMs(loadMs));
    console.log('GPU：' + (info.gpu.renderer || '—') + (info.gpu.webgl2 ? '（WebGL2' + (info.gpu.floatRT ? '，浮点目标' : '') + (info.gpu.timer ? '，GPU 计时' : '') + '）' : ''));
    if (/swiftshader|llvmpipe|software/i.test(info.gpu.renderer || '') && !o.swiftshader) throw new Error('浏览器退回了软件渲染（' + info.gpu.renderer + '），不是真 GPU；确有需要加 --swiftshader');
    if (info.fp && !info.fp.ok) console.log('⚠ 第一人称不可用：' + info.fp.reason);
    writeIndex();

    const dfltCli = o.ui ? { ui: o.ui } : {};
    let ok = 0, fail = 0, warn = 0;
    for (const it of items) {
      if (aborted) break;
      if (b.exited() !== null) throw new Error('浏览器中途退出了');
      bucket = [];
      const sc = it.sc, file = pad2(it.i) + '_' + safeName(sc && sc.name || 'scene') + '.png';
      const dflt = Object.assign({}, it.dflt, dfltCli);
      const opt = { dynRes: o.dynRes, settleMs: o.settle * 1000, compileMs: 300000, fpsSec: 1.5 };
      const t0 = Date.now();
      process.stdout.write(`${pad2(it.i)} ${sc && sc.name} … `);
      let rec;
      try {
        rec = await cdp.eval('window.__shoot.run(' + JSON.stringify(sc) + ',' + JSON.stringify(dflt) + ',' + JSON.stringify(opt) + ')', opt.settleMs + opt.compileMs + 120000);
      } catch (e) {
        rec = { name: sc && sc.name, ok: false, error: e.message, warnings: [], timing: {} };
        if (/超时|断/.test(e.message)) aborted = true;           // 页面卡住或连接断了：后面的场景不再跑
      }
      rec.i = it.i;
      if (rec.ok) {
        try {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 60000);
          fs.writeFileSync(path.join(outDir, file), Buffer.from(shot.data, 'base64'));
          rec.file = file;
        } catch (e) { rec.ok = false; rec.error = '截图失败：' + e.message; }
      }
      const errs = bucket.filter(x => x.type !== 'warning'), x4000 = bucket.filter(x => x.type === 'warning' && /X4000/.test(x.text)).length;
      const warns = bucket.filter(x => x.type === 'warning' && !/X4000/.test(x.text));
      if (bucket.length) rec.console = { errors: errs.slice(0, 20), warnings: warns.slice(0, 20), hlslX4000: x4000 };
      if (errs.length) rec.warnings.push('控制台有 ' + errs.length + ' 条报错');
      rec.timing.wallMs = Date.now() - t0;
      // 记录按固定次序排好键
      const order = ['i', 'name', 'file', 'ok', 'error', 'warnings', 'note', 'view', 'ui', 'site', 'time', 'look', 'ov', 'quality', 'tier', 'toggles', 'params', 'sky', 'readouts', 'perf', 'timing', 'converge', 'camera', 'checks', 'console', 'stack'];
      const r2 = {}; order.forEach(k => { if (rec[k] !== undefined) r2[k] = rec[k]; }); Object.keys(rec).forEach(k => { if (!(k in r2)) r2[k] = rec[k]; });
      index.scenes.push(r2);
      if (rec.ok) ok++; else fail++;
      if (rec.warnings && rec.warnings.length) warn++;
      if (rec.ok) {
        const rd = rec.readouts || {}, pf = rec.perf || {};
        console.log(`✓ ${fmtLux(rd.lux)}${rd.ev != null ? ' · EV ' + rd.ev.toFixed(1) : ''}${pf.gpuMs != null ? ' · GPU ' + pf.gpuMs.toFixed(2) + ' ms' : ''}${pf.rafFps != null ? ' · ' + Math.round(pf.rafFps) + ' fps' : ''} · ${fmtMs(rec.timing.wallMs)}${rec.warnings.length ? '\n     ⚠ ' + rec.warnings.join('；') : ''}`);
      } else console.log('✗ ' + rec.error);
      writeIndex();
    }
    try { index.fp = await cdp.eval('window.__shoot.state()', 10000); } catch (e) { /* 忽略 */ }
    index.summary = { total: items.length, ok, failed: fail, withWarnings: warn, skipped: items.length - index.scenes.length };
  } catch (e) {
    index.error = e.message;
    console.log('出错：' + e.message);
  } finally {
    process.removeListener('SIGINT', onSig);
    const fin = new Date();
    index.finished = fin.toISOString(); index.seconds = Math.round((fin - started) / 1000);
    if (!index.summary) index.summary = { total: items.length, ok: index.scenes.filter(r => r.ok).length, failed: index.scenes.filter(r => !r.ok).length, skipped: items.length - index.scenes.length };
    writeIndex();
    await shutdown(b, cdp, o.keepProfile);
  }
  const s = index.summary;
  console.log(`\n${s.ok}/${s.total} 张成功${s.failed ? '，失败 ' + s.failed : ''}${s.skipped ? '，没跑 ' + s.skipped : ''}${s.withWarnings ? '，带警告 ' + s.withWarnings : ''}；用时 ${index.seconds} 秒`);
  if (index.fp && index.fp.fpInitMs != null) console.log('首次进第一人称 ' + fmtMs(index.fp.fpInitMs) + (index.fp.tierMs && Object.keys(index.fp.tierMs).length ? '；换档编译 ' + Object.keys(index.fp.tierMs).map(k => k + ' ' + fmtMs(index.fp.tierMs[k])).join('、') : ''));
  console.log('索引：' + path.join(outDir, 'index.json'));
  return index.error || s.failed || s.skipped ? 1 : 0;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (o.help) { console.log(usage()); return 0; }
  let items;
  try { items = selectScenes(readScenes(o.files), o.only); } catch (e) { console.error(e.message); return 1; }
  if (!items.length) { console.error('没有要跑的场景' + (o.only ? '（--only ' + o.only.join(',') + ' 一个也没选中）' : '')); return 1; }
  if (o.check) {
    const bad = checkScenes(items, o);
    if (process.argv.length <= 2) console.log('\n（只做了检查。出图：node test/shoot.js test/scenes_std.json，详见 test/SHOOT.md）');
    return bad ? 1 : 0;
  }
  // 出图前先在 node 里检查一遍，免得跑到一半才发现场景写错
  const bad = checkScenes(items, o);
  if (bad) return 1;
  console.log('');
  return shoot(o, items);
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, e => { console.error(e && e.stack || e); process.exitCode = 1; });
}
// 给临时诊断脚本用：const S = require('./shoot.js'); const b = await S.launch(o, S.findBrowser(o)); …（见 SHOOT.md 末节）
module.exports = { shootLib, pageMain, parseArgs, readScenes, findBrowser, launch, shutdown, CDP, PAGE_DEFAULT };
