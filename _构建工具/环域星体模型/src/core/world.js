/* HY.world —— 地点表、分域、节令标记、历法叫法（规格：spec/03 第四节第 1 条；统筹修订见 spec/04）
 * 负责：A 路（核心计算）。自检：test/world_check.js。
 * 节点可测：不碰 DOM、THREE、HY.state（一律显式传 P、Z）。
 *
 * 历法（统筹修订）：界面不用“几月初几”。一律显示
 *   第 N 年（庆典年 · 周期第 k 年）· 入冬后第 d 日 · 冬／夏第 n 日 · 月态第几夜
 * 文字只由 HY.world.fmtCal 生成；作者定了叫法，只改 HY.world.CAL（names 里的模板；要换整套写法，
 * 用 HY.world.addCalStyle 登记一个格式函数，再把 CAL.style 指过去）。内部时间 t 与 01 相同，不受影响。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var W = HY.world = HY.world || {};
  var PI = Math.PI, R2D = 180 / PI;

  /* ───────── 地点表（有序；astro 列是 HY.astro.SITES 的键） ───────── */
  W.SITES = [
    { id: 'zuiyu', name: '罪域·啜泣堡', short: '罪域', s: 6670, az: -4, astro: '罪域', note: '《对巨塔的观测》：约六分之一周长；日月回归线' },
    { id: 'shengjin', name: '圣禁城', short: '圣禁城', s: 3600, az: 0, astro: '圣禁城', note: '方位暂定；在轻域一侧，离轻／平分界仅 1.9 公里' },
    { id: 'yimeite', name: '伊美忒', short: '伊美忒', s: 4000, az: 2, astro: '伊美忒', note: '王城；入冬交节落在此地子夜' },
    { id: 'niehe', name: '涅赫莱恩（盐眠洲）', short: '涅赫莱恩', s: 5600, az: 25, astro: '涅赫莱恩', note: '位置暂定' },
    { id: 'abyss', name: '深渊边', short: '深渊边', s: function (P) { return PI * P.R / 2 - 230; }, az: 0, astro: null, note: '赤道往北 230 公里' },
    { id: 'qing', name: '轻域', short: '轻域', s: 2000, az: 0, astro: null, note: '尖峰陡崖' },
    { id: 'equator', name: '赤道', short: '赤道', s: function (P) { return PI * P.R / 2; }, az: 0, astro: '赤道', note: '深渊一带，重力最大' },
    { id: 'far', name: '世界另一端', short: '另一端', s: function (P) { return 0.72 * PI * P.R; }, az: 180, astro: null, note: '塔顶半球，冬夏与帝国相反' }
  ];
  // 按当前 P 求值：s 为函数的条目在这里换成数
  W.siteList = function (P) {
    return W.SITES.map(function (q) {
      return { id: q.id, name: q.name, short: q.short, s: typeof q.s === 'function' ? q.s(P) : q.s, az: q.az, astro: q.astro, note: q.note };
    });
  };
  W.siteById = function (id, P) {
    var L = W.siteList(P);
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  };

  /* ───────── 分域 ───────── */
  var ZNAME = { tower: '塔基', light: '轻域', plain: '平域', heavy: '重域', limbo: '灵薄' };
  W.ZONE_NAMES = ZNAME;
  // Z：{gLight, gHeavy, limboKm}（HY.state.zones 的副本）
  W.zoneOf = function (s, P, Z) {
    var psi = s / P.R, g = P.gEq * Math.sin(psi), lat = 90 - psi * R2D;
    var sTower = P.R * Math.asin(Math.min(1, P.a / P.R)), sMir = Math.min(s, PI * P.R - s);
    var id;
    if (sMir < sTower) id = 'tower';
    else if (Math.abs(s - PI * P.R / 2) < Z.limboKm) id = 'limbo';
    else if (g < Z.gLight) id = 'light';
    else if (g >= Z.gHeavy) id = 'heavy';
    else id = 'plain';
    return { id: id, name: ZNAME[id], g: g, lat: lat };
  };
  // 塔根半球的分界（沿地面离塔根 km）；塔顶半球与之对称（πR − s）
  W.zoneBounds = function (P, Z) {
    function sOfG(g) { return g >= P.gEq ? PI * P.R / 2 : P.R * Math.asin(Math.max(0, g / P.gEq)); }
    return {
      tower: P.R * Math.asin(Math.min(1, P.a / P.R)),
      light: sOfG(Z.gLight),
      heavy: sOfG(Z.gHeavy),
      limbo: [PI * P.R / 2 - Z.limboKm, PI * P.R / 2 + Z.limboKm]
    };
  };

  /* ───────── 历法：叫法与口径（统筹修订：不用“几月初几”；作者定稿后只改这一处） ───────── */
  W.CAL = {
    // 年号口径（不改内部时间 t，只改“第 N 年”从哪天换号）：
    //   'civil'     沿用 HY.astro.dateOf 的帝国年（默认；正典年份不变：D1、庆典交节都在 10018，黑曜日在 10008）
    //   'winter'    入冬交节起算新年（庆典年的第一天＝飞升日）
    //   'winterEnd' 以入冬交节收尾（第 N 年在 N 年的入冬交节结束；庆典夜是年末最后一夜）
    yearStart: 'civil',
    // 用哪一套格式函数（见 W.calStyles）；'draft'＝现行草案
    style: 'draft',
    names: {
      year: '第 {N} 年', festivalYear: '庆典年', cycle: '周期第 {k} 年',
      winterDay: '入冬后第 {d} 日', seasonDay: '{s}第 {n} 日', moonNight: '{m}第 {n} 夜',
      chip: '入冬后 {d} 日',
      season: { '冬': '冬', '夏': '夏', '赤道': '赤道' },
      moon: { '亮月': '亮月', '灰月': '灰月', '黑月': '黑月' },
      sep: ' · ', tbd: '待定'
    }
  };
  function tpl(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : String(o[k]); }); }
  W.tpl = tpl;
  // 日数吸附：离整数不到 1e-9 日（约 0.1 毫秒）就当整数，免得子夜整点因浮点误差落到前一日
  function snap(x) { var r = Math.round(x); return Math.abs(x - r) < 1e-9 ? r : x; }
  W.snapDay = snap;
  // 年 N 的起点 t（伊美忒经线，即 HY.astro 的 epochAz 地方时；换成别的经线加 (az−epochAz)/360）
  W.yearStartT = function (N, P) {
    var tW = (N - P.epochYear) * P.Y;
    switch (W.CAL.yearStart) {
      case 'winter': return tW;
      case 'winterEnd': return tW - P.Y;
      default: return tW - P.winterDoy;           // 'civil'：旧民用历的岁首（入冬前 300 日）
    }
  };
  // 年 N 的入冬交节 t（伊美忒子夜）：与年号口径无关
  W.winterT = function (N, P) { return (N - P.epochYear) * P.Y; };
  // 年 N 覆盖的 [t0, t1)（地方时 az；az 省略＝伊美忒）
  W.yearSpan = function (N, P, az) {
    var off = az == null ? 0 : (az - P.epochAz) / 360, t0 = W.yearStartT(N, P) + off;
    return [t0, t0 + P.Y];
  };
  /* 格式化：c＝CalInfo { N, cyc, festival, wd, hour, season, seasonDay, moonState, moonNight }（缺的字段跳过）
   * form：'full'（默认）| 'year' | 'date' | 'season' | 'moon' | 'chip'
   *   full   第 10018 年（庆典年 · 周期第 1 年）· 入冬后第 294 日 · 夏第 114 日 · 亮月第 9 夜
   *   year   第 10018 年（庆典年 · 周期第 1 年）
   *   date   入冬后第 294 日
   *   season 夏第 114 日
   *   moon   亮月第 9 夜
   *   chip   入冬后 294 日（顶栏要点，最短）
   */
  // 现行草案的格式函数：c＝CalInfo，form 见上，n＝W.CAL.names
  function fmtDraft(c, form, n) {
    var sep = n.sep;
    function year() {
      var y = tpl(n.year, { N: c.N });
      var tag = [];
      if (c.festival) tag.push(n.festivalYear);
      if (c.cyc) tag.push(tpl(n.cycle, { k: c.cyc }));
      return tag.length ? y + '（' + tag.join(sep) + '）' : y;
    }
    function date() { return c.wd == null ? '' : tpl(n.winterDay, { d: c.wd }); }
    // 赤道没有冬夏：季这一节省掉
    function season() { return c.season && c.seasonDay != null ? tpl(n.seasonDay, { s: n.season[c.season] || c.season, n: c.seasonDay }) : ''; }
    // 数不出第几夜（参数极端、月态两个月都不变）时只写月态
    function moon() {
      if (!c.moonState) return '';
      var m = n.moon[c.moonState] || c.moonState;
      return c.moonNight == null ? m : tpl(n.moonNight, { m: m, n: c.moonNight });
    }
    switch (form) {
      case 'year': return c.N == null ? '' : year();
      case 'date': return date();
      case 'season': return season();
      case 'moon': return moon();
      case 'chip': return c.wd == null ? '' : tpl(n.chip, { d: c.wd });
      default: return [c.N == null ? '' : year(), date(), season(), moon()].filter(Boolean).join(sep);
    }
  }
  // 可切换的格式函数表：作者定了整套叫法，在这里加一个 (c, form, names) → 文字，再把 W.CAL.style 指过去
  W.calStyles = { draft: fmtDraft };
  W.addCalStyle = function (name, fn) {
    if (typeof fn !== 'function') throw new Error('addCalStyle：' + name + ' 不是函数');
    W.calStyles[name] = fn;
  };
  W.fmtCal = function (c, form) {
    var f = W.calStyles[W.CAL.style] || fmtDraft;
    return f(c || {}, form || 'full', W.CAL.names);
  };

  /* ───────── 节令与正文日期（统筹修订：一律写成“相对入冬交节的日数”，只在这里改） ─────────
   * rel：相对入冬交节（伊美忒子夜）的整日数，负＝入冬前；hour：当地钟点（地方时）。
   * every 为真：每年都有（rel 按 Y 取模）；year：只属于某一年（相对“该年入冬交节”＝(year−10018)·Y）。
   * relFrom：rel 取自某条状态（余息＝−fp.set.yuxiLead）；festivalOnly：只在庆典年标出；tbd：图上加“待定”。
   * yFrac：交节类标记落在一年的几分之几（冬至 ¼、入夏 ½、夏至 ¾）；改了年长 Y 时 rel＝⌊yFrac·Y⌋ 跟着交节走，
   *   rel 栏写的是 Y＝360 时的值。
   * 对照旧草案：D1＝八月廿四（入冬前 67 日），黑曜日＝10008 年九月初十（入冬前 51 日）。
   */
  W.MARKS = [
    { id: 'winter', label: '入冬·飞升日', kind: 'season', every: true, rel: 0, hour: 0, note: '交节在伊美忒子夜' },
    { id: 'festival', label: '庆典夜', kind: 'festival', every: true, festivalOnly: true, rel: -1, hour: 21, note: '入冬前夜，守夜到子夜交节' },
    { id: 'wsol', label: '冬至', kind: 'season', every: true, rel: 90, yFrac: 0.25, hour: 0, note: '塔根半球日照最少' },
    { id: 'summer', label: '入夏', kind: 'season', every: true, rel: 180, yFrac: 0.5, hour: 0, note: '' },
    { id: 'ssol', label: '夏至', kind: 'season', every: true, rel: 270, yFrac: 0.75, hour: 0, note: '罪域正午日在天顶' },
    { id: 'yuxi', label: '余息', kind: 'setting', every: true, rel: -45, relFrom: 'fp.set.yuxiLead', hour: 0, note: '入冬前若干日起（设定）；轻域日照降得最快在入冬前 48–54 日' },
    { id: 'd1', label: '审判 D1 夜', kind: 'story', year: 10018, rel: -67, hour: 21, tbd: true, note: 'ch7 月下打斗；整夜亮月' },
    { id: 'd2', label: '审判 D2 夜', kind: 'story', year: 10018, rel: -66, hour: 21, tbd: true, note: 'ch9–11；前半夜灰月、后半夜转黑' },
    { id: 'd3', label: '审判 D3 夜', kind: 'story', year: 10018, rel: -65, hour: 21, tbd: true, note: '无亮月' },
    { id: 'heiyao', label: '黑曜日之夜', kind: 'story', year: 10008, rel: -51, hour: 21, tbd: true, note: '罪域黑月高悬' }
  ];
  W.markById = function (id) {
    for (var i = 0; i < W.MARKS.length; i++) if (W.MARKS[i].id === id) return W.MARKS[i];
    return null;
  };
  // 标记的 rel（处理 relFrom；opt.yuxiLead 由调用方从状态里取来；给了 P 时交节类标记按 yFrac·Y 取）
  W.markRel = function (m, opt, P) {
    if (m.relFrom === 'fp.set.yuxiLead' && opt && opt.yuxiLead != null) return -opt.yuxiLead;
    if (m.yFrac != null && P && P.Y) return Math.floor(m.yFrac * P.Y + 1e-9);
    return m.rel;
  };
  // 标记在“入冬年 N”（相对 N 年入冬交节）的时刻，方位 az 的地方时；year 专属的标记忽略 N
  W.markT = function (m, N, az, P, opt) {
    if (typeof m === 'string') m = W.markById(m);
    if (!m) return NaN;
    var Ny = m.year != null ? m.year : N;
    var off = ((az == null ? P.epochAz : az) - P.epochAz) / 360;
    return W.winterT(Ny, P) + W.markRel(m, opt, P) + (m.hour || 0) / (P.dayHours || 24) + off;
  };
  // 落在第 N 年（按 CAL.yearStart）里的标记：[{id,label,kind,tbd,note,t,doy,wd,rel,winterYear}]，按 t 排序
  // opt：{az, yuxiLead, festival: N→bool（不给则用 HY.astro.isFestival）}
  W.markList = function (N, P, opt) {
    opt = opt || {};
    var t0 = W.yearStartT(N, P), off = ((opt.az == null ? P.epochAz : opt.az) - P.epochAz) / 360, out = [];
    var isF = typeof opt.festival === 'function' ? opt.festival :
      function (n) { return HY.astro ? HY.astro.isFestival(n, P) : (n - P.epochYear) % 4 === 0; };
    W.MARKS.forEach(function (m) {
      var years = m.year != null ? [m.year] : [N - 1, N, N + 1];
      years.forEach(function (Ny) {
        if (m.festivalOnly && !isF(Ny)) return;
        var t = W.markT(m, Ny, opt.az, P, opt);
        // 按当地日判断落在哪一年：子夜整点的标记（入冬等）t − t0 应为整数，浮点误差可能差一丝，
        // 先吸附再比较、取整（与 HY.calc.civil 同一做法），免得落到前一年或前一日
        var u = snap(t - off - t0);
        if (u < 0 || u >= P.Y) return;
        var rel = W.markRel(m, opt, P), wd = ((rel % P.Y) + P.Y) % P.Y + 1;
        out.push({ id: m.id, label: m.label, kind: m.kind, tbd: !!m.tbd, note: m.note, t: t, doy: Math.floor(u), wd: wd, rel: rel, winterYear: Ny });
      });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
