/* HY.ui.readouts —— 读数卡：所在／时与季／天气／太阳／月／光（规格：spec/03 第九节第 4 条“读数”表）
 * 负责：D 路（界面）。全部取自 HY.model.now；照度另调 HY.calc.illum（光组展开时 1 Hz，对岸光上限只在展开时算）。
 * 不自算日月：一切数从 HY.astro／HY.calc 来。第一人称时追加“实测水平面照度”（HY.fp.readouts）。
 * 天气（R.weather，纯函数）：罪域阴云按第一人称同一个范围（HY.fp.cel 的阴云中心与半径、settings.rainK 的同一条平滑）；
 *   余息按 HY.fp.set.yuxi（经 HY.ui.yuxiReach）。别处的云由第一人称的天气图逐处生成，这里只按覆盖度说个大概。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var R = ui.readouts = ui.readouts || {};
  R.__stub = false;

  var ASPECT = { behind: '塔后（夜）', front: '亮日衬着黑塔' };
  // 一日五段的哪一段
  R.aspectName = function (kind, side) {
    if (ASPECT[kind]) return ASPECT[kind];
    if (kind === 'cut') return side === '东' ? '正被东缘切出' : '正被西缘切没';
    if (kind === 'beside') return side === '东' ? '贴着东缘' : '贴着西缘';
    return kind || '—';
  };

  /* “亮面”一行（纯函数）：k 是几何上朝着人的受照比例（01 第六节）；黑月在塔影里，k 再大也不亮，
   * 灰月另给月心受照（影边正在吃月面） */
  R.litText = function (m) {
    var U = HY.util;
    if (!m) return '—';
    if (m.state === '黑月') return '不亮（在塔影里）';
    if (m.state === '灰月') return U.pct(m.k) + ' · 月心受照 ' + U.pct(m.sunlit);
    return U.pct(m.k);
  };

  // “地面直射”一行（纯函数）：日在塔后时直射是零，不拿“星光”去比（夜里地上的光是对岸光，另见“对岸光上限”）
  R.directText = function (v) {
    var F = ui.fmt;
    if (!isFinite(v)) return '—';
    if (v <= 0) return '0（日在塔后）';
    return F.lux(v) + ' ≈ ' + F.luxEarth(v);
  };

  /* ───────── 此地天气（纯函数，节点可测） ─────────
   * state：HY.state；P：HY.model.P；s、az：地点（第一人称步行时用相机此刻的位置）；t：时刻（日）
   * → { on（云开着）, rui（罪域阴云权重 0–1）, overcast（阴云盖住了天）, sky, rain, base（云底，公里）, text, yuxi, yuxiText } */
  function sstep(a, b, x) { var u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); }
  R.ruiWeight = function (state, P, s, az) {
    var c = state.fp.cloud, cel = HY.fp && HY.fp.cel;
    if (!(c.rui > 0) || !cel || typeof cel.ruiCenter !== 'function') return 0;
    var rc = cel.ruiCenter(P), O = HY.astro.site(s, az, P), L = Math.sqrt(O.x * O.x + O.y * O.y + O.z * O.z) || 1;
    var cc = (O.x * rc[0] + O.y * rc[1] + O.z * rc[2]) / L, rad = cel.RUI_RAD || 900;
    return sstep(Math.cos(rad / P.R), Math.cos(0.75 * rad / P.R), cc) * c.rui;      // 与 fp/settings.js 的 rainK 同一条
  };
  R.weather = function (state, P, s, az, t) {
    var U = HY.util, c = state.fp.cloud, on = !!(c.on && state.fp.atmo.on), out = { on: on, rui: 0, overcast: false, sky: '', rain: '', base: null, text: '' };
    if (!on) out.text = state.fp.atmo.on ? '云已关（参数·第一人称·云）' : '大气已关：没有云';
    else {
      var rw = R.ruiWeight(state, P, s, az), rk = rw * (c.rain || 0) / 0.03;
      out.rui = rw;
      if (rw >= 0.5) {
        out.overcast = true; out.sky = '阴'; out.base = c.ruiBase;
        out.rain = rk >= 1.4 ? '大雨' : rk >= 0.6 ? '下雨' : rk > 0.05 ? '小雨' : '';
      } else if (rw > 0.05) {
        out.sky = '阴云边上，碎云'; out.base = c.ruiBase;
        out.rain = rk > 0.3 ? '零星小雨' : '';
      } else {
        var cv = c.cover;
        out.sky = cv < 0.12 ? '晴' : cv < 0.35 ? '晴，少云' : cv < 0.6 ? '晴间多云' : cv < 0.85 ? '多云' : '阴';
        out.base = cv < 0.12 ? null : c.base;
      }
      out.text = [out.sky, out.rain].filter(Boolean).join('，') + (out.base != null ? '；云底约 ' + U.fixed(out.base, 1) + ' 公里' : '');
    }
    // 余息
    var yr = ui.yuxiReach, y = yr ? yr.now(state, P, t, s) : null;
    out.yuxi = y;
    if (!y) out.yuxiText = '';
    else if (y.mode === 'off') out.yuxiText = '已关（参数·设定）';
    else if (y.on) {
      var fr = HY.calc.km(y.front);
      out.yuxiText = y.here === 'past' ? '已到此地，风里带着白灰（前锋离塔根 ' + fr + '）'
        : y.here === 'edge' ? '前锋正经过此地（离塔根 ' + fr + '）'
        : '前锋离塔根 ' + fr + '，还没到此地（差 ' + HY.calc.km(y.toGo) + '）';
    } else {
      var Y = P.Y || 360, L = +state.fp.set.yuxiLead || 0, before = Y * Math.ceil(t / Y - 1e-9) - t, wait = before - L;
      out.yuxiText = wait > 0 ? '还没起：入冬前 ' + Math.round(L) + ' 日起，还有 ' + U.fixed(wait, 0) + ' 日' : '没有';
    }
    return out;
  };
  // 日月被云遮没有（纯函数）：wx＝R.weather 的结果；ratio＝第一人称实测的到眼日照 ÷ 大气顶直射（null＝没有实测）
  //   → '' 看得见 | '隔着薄云' | '在云后'
  R.cloudOver = function (wx, ratio) {
    if (!wx || !wx.on) return '';
    if (ratio != null && isFinite(ratio)) return ratio < 0.08 ? '在云后' : ratio < 0.4 ? '隔着薄云' : '';
    return wx.overcast ? '在云后' : '';
  };

  R.init = function () {
    var el = G.document.getElementById('readouts'), w = ui.w, U = HY.util, F = ui.fmt, W = HY.world;
    el.textContent = '';
    el.appendChild(w.h('h3', '', '读数'));
    var rows = {};
    function group(title, key, def, list) {
      var f = w.fold(title, '读数' + key, def, { cls: 'rgroup' });
      var dl = w.h('dl', 'kv');
      list.forEach(function (k) { rows[k[0]] = w.kv(dl, k[1], k[2]); });
      f.body.appendChild(dl);
      el.appendChild(f.el);
      return f;
    }
    group('所在', '所在', true, [['zone', '域', 'zone-dd'], ['g', '重力'], ['r', '离塔轴'], ['lat', '地面倾角'], ['hEq', '比赤道高'], ['tw', '头顶塔宽'], ['tEnds', '塔两端仰角']]);
    group('时与季', '时与季', true, [['year', '年'], ['date', '日期'], ['clock', '时刻'], ['season', '季'], ['dn', '昼夜'], ['dayLen', '常年昼长']]);
    group('天气', '天气', true, [['wx', '天'], ['yuxi', '余息']]);
    group('太阳', '太阳', true, [['sAsp', '在哪'], ['sEl', '重力仰角'], ['sElG', '对地仰角'], ['sAz', '方位'], ['sOff', '离塔中线'], ['sVis', '露出'], ['sDiam', '视径'], ['ecl', '日食']]);
    group('月', '月', true, [['mState', '月态'], ['mK', '亮面'], ['mEl', '重力仰角'], ['mAz', '方位'], ['mDiam', '视径'], ['mAge', '月龄'], ['mHigh', '黑月高悬']]);
    var light = group('光', '光', false, [['sunW', '大气顶日照'], ['luxG', '地面直射'], ['luxM', '月光'], ['far', '对岸光上限'], ['fpLux', '实测照度']]);
    var fpRow = rows.fpLux.previousSibling;
    var zoneSw = w.h('i', 'lg-sw'), zoneTx = w.h('span', '');
    rows.zone.textContent = ''; rows.zone.appendChild(zoneSw); rows.zone.appendChild(zoneTx);
    var eclRow = rows.ecl.previousSibling;
    el.appendChild(w.h('p', 'w-note', '“光”这一组只按日月的位置粗算，不算空气、云和对岸的光；站在此地（第一人称）时另有实测。天气按参数说个大概，罪域阴云的范围与第一人称一致。'));

    var last = 0, lastIll = 0, ill = null, illKey = '';
    function lightNow(force) {
      var t = Date.now(), n = HY.model.now;
      if (!light.isOpen()) return;
      var key = HY.model.pv + '|' + HY.model.siteKey();
      if (!force && t - lastIll < 1000 && key === illKey) return;
      lastIll = t; illKey = key;
      try { ill = HY.calc.illum(HY.model.O, n.t, HY.model.P, { far: true }); } catch (e) { ill = null; }
    }
    function show(force) {
      var n = HY.model.now, t = Date.now();
      if (!n || !n.cal || (!force && t - last < 250)) return;
      last = t;
      var s = n.site, P = HY.model.P, c = n.cal, st = HY.state;
      zoneSw.className = 'lg-sw z-' + s.zone.id; zoneTx.textContent = s.zone.name;
      rows.g.textContent = U.fixed(s.g, 2) + ' g';
      rows.r.textContent = HY.calc.km(s.r);
      rows.lat.textContent = F.deg(s.lat) + '（＝纬度）';
      rows.hEq.textContent = HY.calc.km(P.R - s.r) + '（重力朝外，离塔轴越近越高）';
      rows.tw.textContent = F.deg(n.tower.width);
      rows.tEnds.textContent = '塔根端 ' + F.deg(n.tower.rootEl) + ' 北 · 塔顶端 ' + F.deg(n.tower.topEl) + ' 南';
      rows.year.textContent = W.fmtCal(c, 'year');
      rows.date.textContent = W.fmtCal(c, 'date') + (ui.timebar && ui.timebar.toWinterText ? '（' + ui.timebar.toWinterText(c.wd, P) + '）' : '');
      rows.clock.textContent = n.hhmm + ' · ' + n.shichen;
      rows.season.textContent = [W.fmtCal(c, 'season'), W.fmtCal(c, 'moon')].filter(Boolean).join(W.CAL.names.sep) || '—';
      rows.dn.textContent = n.night ? '夜（日在塔后）' : '昼';
      rows.dayLen.textContent = '昼 ' + U.fixed(n.dayH, 2) + ' 时 · 夜 ' + U.fixed(n.nightH, 2) + ' 时（终年不变）';
      // 天气（地点卡的地点；第一人称步行中由 HUD 按相机位置另算）
      var wx = R.weather(st, P, st.site.s, st.site.az, n.t), cl = R.cloudOver(wx, null);
      rows.wx.textContent = wx.text || '—';
      rows.yuxi.textContent = wx.yuxiText || '—';
      var su = n.sun;
      rows.sAsp.textContent = R.aspectName(su.aspect, su.side);
      rows.sEl.textContent = F.deg(su.el);
      rows.sElG.textContent = F.deg(su.elG);
      rows.sAz.textContent = HY.calc.dirName(su.az);
      rows.sOff.textContent = F.hoff(su.hoff);
      rows.sVis.textContent = (su.vis > 0.999 ? '全部' : su.vis < 0.001 ? '被塔挡住' : U.pct(su.vis, 1)) + (su.vis >= 0.5 && cl ? '（' + cl + '，看不见日面）' : '');
      rows.sDiam.textContent = F.deg(su.diam, 2);
      var ec = n.eclipse || 0;
      eclRow.hidden = rows.ecl.hidden = !(ec > 0);
      rows.ecl.textContent = U.pct(ec, 1);
      var mo = n.moon;
      rows.mState.textContent = W.fmtCal(c, 'moon') || mo.state;
      rows.mK.textContent = R.litText(mo) + (mo.vis < 0.5 ? ' · 被塔挡住' : '') + (mo.litVisible ? (cl ? ' · 亮月在云后' : ' · 此刻看得见亮月') : '');
      rows.mEl.textContent = F.deg(mo.el);
      rows.mAz.textContent = HY.calc.dirName(mo.az);
      rows.mDiam.textContent = F.deg(mo.diam, 2);
      rows.mAge.textContent = U.fixed(mo.age * P.M, 1) + ' 日（0＝黑月正中）';
      rows.mHigh.textContent = mo.blackHigh ? '是' + (cl ? '（在云后）' : '') : '否';
      rows.mHigh.classList.toggle('hl', !!mo.blackHigh);
      // 光
      lightNow(force);
      var il = n.illum || {};
      rows.sunW.textContent = ill && isFinite(ill.sunW) ? U.thousands(ill.sunW, 0) + ' W/m²' : '展开时计算';
      rows.luxG.textContent = R.directText(il.sunLuxGround);
      rows.luxM.textContent = F.lux(il.moonLux);
      rows.far.textContent = ill && ill.farLuxUpper != null ? F.lux(ill.farLuxUpper) + '（不计大气，' + F.luxEarth(ill.farLuxUpper) + '）' : '—';
      var fpOn = !!(HY.app && HY.app.active && HY.app.active() === 'fp');     // 第一人称真在出图时才有实测
      fpRow.hidden = rows.fpLux.hidden = !fpOn;
      if (fpOn) {
        var ro = HY.fp.readouts ? HY.fp.readouts() : null;
        rows.fpLux.textContent = ro && isFinite(ro.lux) ? F.luxLine(ro.lux) : '测量中';
      }
    }
    HY.bus.on('frame', function () { show(false); });
    HY.bus.on('model', function () { HY.model.tick(); show(true); });     // 地点或参数刚变：先刷新此刻快照
    HY.bus.on('time', function (e) { if (e && e.src !== 'play') { HY.model.tick(); show(true); } });
    HY.bus.on('ui', function (e) { if (e && /^ui\.open/.test(e.path || '')) show(true); });
    HY.bus.on('fp', function (e) { if (ui.touches(e, 'fp.cloud') || ui.touches(e, 'fp.set') || ui.touches(e, 'fp.atmo')) show(true); });
    show(true);
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
