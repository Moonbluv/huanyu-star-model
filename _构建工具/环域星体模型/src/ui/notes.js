/* HY.ui.notes —— 说明页：设定条文、按这套物理会推出什么（14 条，数字随参数）、与正文对照、待作者拍板、操作说明
 * 规格：spec/03 第九节第 4、6 条；条文出自 01 第一节，对照出自 01 第十四节，待定出自 01 第十五节＋02 第十九节（合并去重）。
 * 负责：D 路（界面）。统筹修订：说明文字简短、直白；引号用中文引号；日期一律写“入冬后第 d 日”（HY.world.fmtCal）。
 * 只读：数字全部来自 HY.astro／HY.calc／HY.model；不写状态（“数一数日食”按钮只算不写）。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};
  var N_ = ui.notes = ui.notes || {};
  N_.__stub = false;

  var KEYS = [
    ['空格', '播放／暂停'], ['1 ／ 2', '总览／站在此地'], ['[ ／ ]', '前后一小时'], ['Shift + [ ／ ]', '前后一日'],
    ['Alt + [ ／ ]', '前后一个月（朔望月）'], ['P', '侧栏开合'], ['H', '隐藏全部界面'], ['F', '画面全屏'], ['O', '依次切总览镜头'],
    ['WASD ／ 方向键', '第一人称：行走'], ['Shift', '第一人称：跑（按住）'], ['R', '第一人称：骑马（开关）'], ['T', '第一人称：望远（开关）'],
    ['3 – 9', '第一人称：朝向快捷（北·塔根、东、南·塔顶、西、天顶、太阳、月亮）'],
    ['滚轮 ／ 双指', '第一人称：凝视'], ['Esc', '第一人称：松开鼠标（退出指针锁定），不回总览；准备中按它取消'], ['1', '第一人称里回总览']
  ];
  N_.KEYS = KEYS;

  // 与正文的对照（01 第十四节；判定按默认参数）。d(n)＝“入冬后第 n 日”，由 fmtCal 生成；
  // D1–D3、黑曜日取 HY.world.MARKS（作者改了标记，这里跟着变），其余日子是 01 的静态结论
  function markWd(id, Y) {
    var m = HY.world.markById(id);
    return m ? ((m.rel % Y) + Y) % Y + 1 : null;
  }
  /* ch26“余息吹进罪域、离庆典还有一个多月”（正文日期）：按此刻参数查前锋哪天推到罪域（HY.ui.yuxiReach，读 HY.fp.set.yuxi）。
   * 01 原先只核对了余息开始的日子（入冬前 48–54 日），没核对前锋什么时候到罪域：默认前锋 1,500 → 7,000 公里摊在 45 日里，
   * 罪域在 6,670 公里，入冬前 2.7 日才到。这里不替作者改设定，只如实判定并给出要对上正文需要的推进速度。 */
  N_.yuxiVerdict = function (state, P) {
    var R = ui.yuxiReach, q = HY.world.siteById('zuiyu', P), U = HY.util, S = HY.fp && HY.fp.set && HY.fp.set.YUXI;
    if (!R || !q || !state || !P) return ['△', '与余息时段、庆典日期一致；前锋何时到罪域要看余息设定'];
    if (state.fp.set.yuxi === 'off') return ['△', '余息现在关着（参数·设定）'];
    if (state.fp.set.yuxi === 'on') return ['✓', '余息设成“开”：不看日期，罪域一直有'];
    var d = R.days(state, P, q.s), need = R.STORY_DAYS, L = +state.fp.set.yuxiLead || 0, s0 = S && S.s0 != null ? S.s0 : 1500;
    var rate = L > 0 && S ? (S.s1 - S.s0) / L : NaN;
    if (d != null && d >= need) return ['✓', '前锋入冬前 ' + U.fixed(d, 0) + ' 日推到罪域，离庆典一个多月'];
    var fix = L > need ? '前锋要从入冬前 ' + Math.round(L) + ' 日起、每日推约 ' + U.thousands((q.s - s0) / (L - need), 0) + ' 公里（现为 ' + U.thousands(rate, 0) + ' 公里）'
      : '余息得从入冬前 ' + need + ' 日以前起，前锋也要推得更快';
    return ['✗（按现设）', '余息入冬前 ' + Math.round(L) + ' 日起，但前锋入冬前 ' + (d == null ? '—' : U.fixed(d, 1)) + ' 日才推到罪域（' + U.thousands(q.s, 0) +
      ' 公里）。要对上正文，' + fix + '才行；待作者定'];
  };
  function verdicts(d, Y) {
    Y = Y || 360;
    var d1 = markWd('d1', Y), d2 = markWd('d2', Y), d3 = markWd('d3', Y), hy = markWd('heiyao', Y);
    var hyN = (HY.world.markById('heiyao') || {}).year || 10008;
    var yv = N_.yuxiVerdict(HY.state, HY.model && HY.model.P);
    return [
      ['ch1 罪域看巨塔：笔直的黑带把灰白的天劈成两半', '✓', '黑带宽 12.5°，过天顶；塔根端在北天 57° 处接上翘起的地面'],
      ['ch1 十轮满月刚够填满那道黑', '✓', '近满月 1.16°，十轮 11.6°，塔宽 12.5°'],
      ['伊美忒看巨塔“立在天边”“遮住半边天”', '✗（按字面）', '18.5° 宽的黑带过天顶，北端在仰角 69° 插进地面，南端低到 15°；两说只能当修辞'],
      ['平域看不到星，只有神的国有星空', '✓', '内腔的天就是对岸与巨塔'],
      ['罪域终年酸雨云，白天只有灰白天光', '✓', '太阳整天高挂、只左右挪七度上下，云下的光没有方向'],
      ['ch23 天光永远是同一种灰白，没法计时', '✓', '日影一天几乎不动'],
      ['罪域夜里偶有月光', '✓', '晴空下 56% 的夜见得到亮月，再乘上云缝的机会'],
      ['ch7 D1 夜（' + d(d1) + '）月下打斗', '✓', '罪域整夜亮月，亮面 82%–94%，21 时在正南、仰角 27°'],
      ['ch9、ch11 D2 夜（' + d(d2) + '）的月光', '△', '19–24 时是渐暗的灰月，子夜后全黑、黑月高悬约 5 小时；整夜明亮只属于 D1'],
      ['ch11 月光从东墙上方的半圆窗透进来', '✗', 'D2 夜月在正南'],
      ['ch9 尖塔在月色底下拖出一截长影', '△', '21 时仰角 24°，影长约为塔高 2.2 倍；但那时是灰月'],
      ['D3 夜（' + d(d3) + '）暴雨无月', '✓', '整夜黑月'],
      ['序章“十年前那个黑月高悬的夜晚”', '△', HY.world.fmtCal({ N: hyN }, 'year') + d(hy) + '夜起，罪域高悬 6.5 小时、最高 54°；“年初深冬”版（' + d(65) + '）是半亮月，不成立'],
      ['ch20 黑曜日夜，涅赫莱恩的月亮隔一阵从云缝露面；“王城的夜里从来没有真正黑透过”', '✓', d(301) + '到' + d(308) + '整夜亮月，' + d(309) + '整夜灰月；“没黑透”正是对岸光'],
      ['涅赫莱恩夏日傍晚，月亮从云缝露脸', '✓', '夏天亮月近满，入夜就在'],
      ['涅赫莱恩夏日傍晚的落日红光', '✗', '日落在仰角 78° 的高处，气路短，染不红；只有日面被塔缘切去的最后几分钟偏暗偏橙'],
      ['ch26 圣禁城每日午后“过影”一刻钟', '✗', '日月运动做不出每日固定的塔影；可写成静滞的非光学现象，或改写'],
      ['余息：入冬前从塔根往外刮的冷风', '✓', '轻域日照降得最快在入冬前 48–54 日，冷空气离轴外泄'],
      ['ch26 余息吹进罪域，“离庆典还有一个多月”', yv[0], yv[1]],
      ['四年一次圣皇庆典，10018 为庆典年，入冬即飞升', '✓', '400 年逐年验证无例外'],
      ['ch17“入冬之日，圣座于伊美忒行大典”', '✓', '新推论：庆典之夜，两京通宵无月'],
      ['ch7 墙上的光斑在移动；ch26 午后光斑从东挪到西', '✗（幅度）', '太阳一天只摆几度；方向上光斑应自西往东挪'],
      ['ch23 东墙高窗照进落日', '✗', '日落在塔的西缘、南偏西的高空'],
      ['第一部事件只在教域一、二', '✓', '日食只见于涅赫莱恩以南，两京看不到']
    ];
  }
  // 待作者拍板（01 第十五节＋02 第十九节，合并去重）
  var PENDING = [
    ['白夜还是静滞夜幕', '纯物理下子夜被对岸照到几千勒克斯。默认如实画“白夜”；“参数·设定·静滞夜幕”可以压暗夜，代价是季节差变大。'],
    ['历法', '入冬日、D1–D3、黑曜日都按“相对入冬的日数”标了“待定”；“第 N 年”从哪天换号有三种口径（一年页·历法卡）；各种叫法也待定。'],
    ['序章的季节', '“年初深冬”版不成立，须放进某个黑月期。'],
    ['圣禁城“过影”', '天体做不出每日午后的塔影：写成静滞现象、改写，或用丙原参数的冬季影期。'],
    ['光度定标与月面反照率', '日面 5772 K 还是 1361 W/m²；白月 0.6 还是地球月 0.12（参数·天体·高级）。'],
    ['圣禁城的冷', '天体给的是强季节、年均日照比赤道还高；要冷得靠海拔、峭壁、静滞，或把振幅调小。'],
    ['日食', '罪域一年约四次、涅赫莱恩约七次，几乎都是全食；正文写不写。'],
    ['庆典之夜的叫法', '本稿默认：入冬前夜守夜，子夜交节，次日是飞升日。'],
    ['白天看不见巨塔', '大气标高 40 公里时正午塔带只比旁边暗 1.2 倍；“黑带劈开天空”只在黄昏、夜里、薄大气或云缝里成立。'],
    ['没有红色落日', '只有日面切进塔缘时的一线橙边；要浓红须另设尘幕或塔缘气层（设定）。'],
    ['阶地', '本稿取踏面宽固定、崖高＝踏面宽 × tan 纬度；也可以改成崖高处处相同。'],
    ['舆图锚点', '作者给锚点之前，第一人称里对面的世界只用程序底图。'],
    ['余息几时到罪域', '正文 ch26 要余息在离庆典一个多月时就吹进罪域；按默认设定，前锋从塔根外慢慢往外推，入冬前几天才到罪域。要么把前锋调快，要么改写正文（数字见“与正文的对照”）。'],
    ['其他可选设定', '昼光补偿、罪域酸霾、塔缘气层、余息的强度与时段，都默认关。'],
    ['可选素材', '圣禁城若在 3336 公里，夜长恰等于黑月期；庆典之年有十三次黑月正中。']
  ];
  N_.PENDING = PENDING;
  N_.verdicts = verdicts;
  /* 一日里太阳重力仰角的形状（纯函数）：ds＝HY.calc.dayStats 的结果（sun：逐刻仰角，夜里 NaN；noonEl：正午）
   *   罪域这类日在天顶附近的地方，正午最高；伊美忒、圣禁城这类离塔近的地方，太阳正对塔时反而最低、早晚贴着塔缘时最高 */
  N_.noonShape = function (ds) {
    var U = HY.util, lo = Infinity, hi = -Infinity;
    if (!ds || !ds.sun) return '';
    for (var i = 0; i < ds.sun.length; i++) { var e = ds.sun[i]; if (isFinite(e)) { if (e < lo) lo = e; if (e > hi) hi = e; } }
    var nE = ds.noonEl;
    if (!isFinite(nE) || !isFinite(hi)) return '终日不见日。';
    if (hi - lo < 0.5) return '重力仰角一天里几乎不变（约 ' + U.fixed(nE, 0) + '°）。';
    if (nE >= hi - 0.3) return '重力仰角正午最高（' + U.fixed(nE, 1) + '°），早晚低到 ' + U.fixed(lo, 0) + '°。';
    if (nE <= lo + 0.3) return '重力仰角正午反而最低（' + U.fixed(nE, 1) + '°），贴着塔缘时最高（' + U.fixed(hi, 1) + '°）。';
    return '重力仰角正午 ' + U.fixed(nE, 1) + '°，一天里在 ' + U.fixed(lo, 0) + '°–' + U.fixed(hi, 0) + '° 之间。';
  };

  N_.init = function () {
    var el = G.document.getElementById('notes'), w = ui.w, U = HY.util, W = HY.world, A = HY.astro;
    el.textContent = '';
    function sec(title, key, open) { var f = w.fold(title, '说明' + key, open, { cls: 'card nsec' }); el.appendChild(f.el); return f; }
    var s1 = sec('设定条文', '条文', true);
    var ol1 = w.h('ol', 'nlist'); s1.body.appendChild(ol1);
    var s2 = sec('按这套物理会推出什么', '推论', true);
    var ol2 = w.h('ol', 'nlist'); s2.body.appendChild(ol2);
    var eclBtn = w.btn('数一数此地四年的日食', { cls: 'btn btn-mini', onClick: countEclipses });
    var eclOut = w.h('span', 'w-note');
    var eclRow = w.h('div', 'p-actions'); eclRow.appendChild(eclBtn); eclRow.appendChild(eclOut);
    s2.body.appendChild(eclRow);
    var s3 = sec('与正文的对照', '对照', false);
    s3.body.appendChild(w.h('p', 'w-note', '判定按默认参数：✓ 成立，△ 有条件成立，✗ 不成立（只列，不改正文）。'));
    var tbl = w.h('table', 'tbl tbl-wrap'), tb = w.h('tbody');
    tbl.appendChild(tb); s3.body.appendChild(tbl);
    var s4 = sec('待作者拍板', '待定', false);
    var ol4 = w.h('ol', 'nlist'); s4.body.appendChild(ol4);
    PENDING.forEach(function (p) { var li = w.h('li'); li.appendChild(w.h('b', '', p[0] + '：')); li.appendChild(G.document.createTextNode(p[1])); ol4.appendChild(li); });
    var s5 = sec('操作说明与快捷键', '操作', false);
    s5.body.appendChild(w.h('p', '', '拖动画面转视角，滚轮缩放；点内壁设地点，双击进第一人称。时间栏的滑杆、“跳到…”“日期…”都按此地地方时。'));
    var kt = w.h('table', 'tbl'), kb = w.h('tbody');
    KEYS.forEach(function (k) { var tr = w.h('tr'); tr.appendChild(w.h('td', 'kbd', k[0])); tr.appendChild(w.h('td', '', k[1])); kb.appendChild(tr); });
    kt.appendChild(kb); s5.body.appendChild(kt);
    s5.body.appendChild(w.h('p', 'w-note', '焦点在输入框里时快捷键不响应。'));

    function li(ol, title, text) { var x = w.h('li'); x.appendChild(w.h('b', '', title)); x.appendChild(G.document.createTextNode(' ' + text)); ol.appendChild(x); }
    function n(v, d) { return U.fixed(v, d == null ? 1 : d); }
    function km(v) { return U.thousands(v, 0) + ' 公里'; }
    function d(k) { return W.fmtCal({ wd: k }, 'date'); }
    function festYears(N, P) {
      var out = [];
      for (var y = N - 8; y <= N + 8; y++) if (A.isFestival(y, P)) out.push(y);
      return out.join('、');
    }

    var farCache = { key: '', v: null };
    function farAtMidnight(O, P, now) {
      var key = HY.model.pv + '|' + HY.model.siteKey();
      if (farCache.key !== key) {
        var tm = now.t - now.hour / P.dayHours;
        try { farCache.v = HY.calc.illum(O, tm, P, { far: true }).farLuxUpper; } catch (e) { farCache.v = null; }
        farCache.key = key;
      }
      return farCache.v;
    }
    function dayOf(O, P, now) {
      var tm = now.t - now.hour / P.dayHours;
      return HY.model.cached('notes.day', [Math.round(tm * 1000)], function () { return HY.calc.dayStats(O, tm, P); });
    }
    // 重力仰角在一天里的形状（与“此地”页的一日图同一份数据）：正午是最高还是最低
    function noonShape(O, P, now) { return N_.noonShape(dayOf(O, P, now)); }
    function hoffMax(O, P, now) {
      var ds = dayOf(O, P, now), m = 0;
      for (var i = 0; i < ds.hoff.length; i++) if (isFinite(ds.sun[i]) && Math.abs(ds.hoff[i]) > m) m = Math.abs(ds.hoff[i]);
      return m;
    }

    function render() {
      var P = HY.model.P, O = HY.model.O, now = HY.model.now, st = HY.state;
      if (!P || !now) return;
      var dayR = W.siteList(P).filter(function (q) { return q.astro; }).map(function (q) { return A.dayFraction(A.site(q.s, q.az, P).r, P) * P.dayHours; });
      var dMin = Math.min.apply(null, dayR), dMax = Math.max.apply(null, dayR);
      var aS = A.holdAccel(P.dS, 1, P), aM = A.holdAccel(P.rM, 1 - 1 / P.M, P);
      var far = farAtMidnight(O, P, now), fy = festYears(now.date.N, P), mg = A.festivalMargin(P);
      // 设定条文（01 第一节，简写）
      ol1.textContent = '';
      li(ol1, '日月同出塔腰，一升一降。', '日心离塔面 ' + km(P.dS - P.a) + '；月轨离塔轴 ' + km(P.rM) + '（星体半径的 ' + n(P.rM / P.R, 2) + ' 倍）。两者一年沿塔身上下一个来回，高度永远相反，旋向相反；只在入冬、入夏那两刻同在塔腰。');
      li(ol1, '罪域是日月的回归线。', '两条螺旋都在塔腰上下 ' + km(P.A) + '处折返，正压在离塔根 ' + km(P.sTrop) + '的纬线上。夏至正午，太阳在罪域天顶。');
      li(ol1, '日不行天，只过塔。', '太阳先被塔的东缘用一道直边切出来（约 ' + n(A.duskMinutes(P), 0) + ' 分），贴着东缘挂一阵，再滑到黑带正面，最后贴到西缘、被切没。各地昼长终年不变，' + n(dMin, 1) + '–' + n(dMax, 1) + ' 小时。');
      li(ol1, '一个月 ' + n(P.M, 2) + ' 日。', '一年 ' + n(P.lunPerYear, 2) + ' 个月，四年 ' + n(P.lunPerYear * 4, 0) + ' 月整。');
      li(ol1, '黑月就是月亮自己的夜。', '月转到太阳背后、落进塔影就是黑月，每月约 ' + n(P.blackFrac * P.M, 1) + ' 夜；进出塔影各有约 ' + n(A.greyHours(P), 0) + ' 小时的灰月，光被一道直的影边慢慢吃掉。');
      li(ol1, '近月缺，远月圆。', '夜里看得见的亮月总在世界对面，挂在黑带两旁，从不衬在塔前；转到自己这一侧的是黑月。');
      li(ol1, '冬月高而半，夏月低而圆。', '冬天月亮沉到这一半球，夜里挂得高、显得大，只亮五到八成；夏天它在另一半球，低而近满。');
      li(ol1, '黑月高悬。', '黑月挂在黑带旁，背后是对岸的白昼，看上去是一枚清清楚楚的深灰盘。');
      li(ol1, '四年一度，三点一线。', '入冬那一刻（伊美忒子夜）太阳往上、月亮往下同过塔腰；月相每年挪四分之一圈，四年里只有一次正落在塔影中，这一夜就是圣皇庆典：' + (fy || '当前参数下没有') + '……年。');
      li(ol1, '日月不相撞，对称也不彻底。', '对称只在“高度互为镜像、旋向相反”这一层；日食只在涅赫莱恩以南看得到。');
      li(ol1, '夜不全黑（待定）。', '不加遮挡时，子夜地上的光有几千勒克斯，是月光的千倍以上。要么认下“白夜”，要么设一层静滞夜幕。');
      li(ol1, '神代定数。', '托住太阳要指向塔轴 ' + n(aS, 2) + ' m/s²，月亮 ' + n(aM, 2) + ' m/s²；“一年 ' + n(P.lunPerYear, 2) + ' 个月”“黑月半角 ' + n(P.beta * 180 / Math.PI, 1) + '°＞90°”也是定数，庆典的节律押在它们上面。');
      // 推论（03 第九节第 6 条，数字随参数与此地）
      ol2.textContent = '';
      var place = O.id && O.name ? O.name : '此地';            // 自定义地点（点选、步行）写“此地”，不写“自定义地点”
      li(ol2, '只有两季。', '日在塔腰以上时塔根半球为冬，冬夏各 ' + n(P.Y / 2, 0) + ' 日。' + (now.season === '赤道' ? '赤道无冬夏。' : place + '此刻是' + W.fmtCal(now.cal, 'season') + '。'));
      li(ol2, '昼夜不随季节变。', '夜就是塔影，宽窄只看日轨离塔多远。' + place + '常年昼 ' + n(now.dayH, 2) + ' 小时、夜 ' + n(now.nightH, 2) + ' 小时。');
      li(ol2, '日不行天，只过塔。', '白天分五段：东缘切出、贴东缘、衬着黑塔、贴西缘、西缘切没；其余是塔后的夜。' + place + '离塔中线最多约 ' + n(hoffMax(O, P, now), 1) + '°；' + noonShape(O, P, now));
      li(ol2, '日月镜像。', '日升则月降，旋向相反；入冬、入夏两刻同过塔腰；罪域是日月的回归线。');
      li(ol2, '黑月就是月亮自己的夜。', '黑月占一个月的 ' + n(P.blackFrac * 100, 1) + '%，和离塔轴 ' + km(P.rM) + '处夜占一日是同一条公式。');
      li(ol2, '四年一度，三点一线。', '一年 ' + n(P.lunPerYear, 2) + ' 个月，入冬那一刻的月相每年转四分之一圈。庆典年：' + (fy || '无') + '。余量 ' + n(mg, 2) + ' 日。');
      li(ol2, '冬月高而半，夏月低而圆。', '冬天的月离这一半球近，挂得高、亮一半多；夏天远而低、近满。');
      li(ol2, '重力方向与阶地。', '“上”指向塔轴；地面倾角等于纬度，' + place + '是 ' + n(O.lat, 1) + '°。往塔走就是往上爬，' + (st.fp.ground.mode === 'terrace' ? '阶地每级崖高约 ' + n(st.fp.ground.W * Math.tan(Math.abs(O.lat) * Math.PI / 180), 2) + ' 公里。' : '地面是一面斜坡。'));
      li(ol2, '往外就是往下。', '赤道最低，可以安放深渊。余息是入冬前塔根先冷、冷风顺坡往外泄（现设入冬前 ' + st.fp.set.yuxiLead + ' 日起' + (st.fp.set.yuxi === 'off' ? '，已关' : '') + '）。');
      li(ol2, '没有星星。', '视线最后都落在对面的内壁上；只有外表面（神的国）有星空，它每 ' + n(P.spinPeriodMin, 1) + ' 分转一圈。');
      li(ol2, '夜不全黑（设定开关）。', place + '子夜的对岸光上限约 ' + (far != null ? ui.fmt.lux(far) : '几千勒克斯') + '，是月光的千倍以上；“参数·设定·静滞夜幕”可以把它压下去' + (st.fp.set.veil ? '（现在开着）' : '（默认关）') + '。');
      li(ol2, '白天几乎看不见巨塔，也没有红色落日。', (st.fp.atmo.HR === 40 ? '空气标高 40 公里时' : '现在空气标高 ' + st.fp.atmo.HR + ' 公里；标高 40 公里时') + '，正午塔带只比旁边暗 1.2 倍；日落发生在高处，气路短，不变红。');
      li(ol2, '空气与自转。', '纯物理下空气会沉向赤道，需要静滞按住；赤道 ' + n(P.gEq, 2) + 'g 要求每 ' + n(P.spinPeriodMin, 1) + ' 分自转一圈。');
      li(ol2, '日食。', '只在涅赫莱恩以南看得到，两京永远看不到。');
      // 对照表
      tb.textContent = '';
      verdicts(d, Math.round(P.Y)).forEach(function (r) {
        var tr = w.h('tr');
        tr.appendChild(w.h('td', '', r[0]));
        var v = w.h('td', 'verdict ' + (r[1].charAt(0) === '✓' ? 'v-ok' : r[1].charAt(0) === '✗' ? 'v-bad' : 'v-mid'), r[1]);
        tr.appendChild(v);
        tr.appendChild(w.h('td', 'w-note', r[2]));
        tb.appendChild(tr);
      });
    }
    // 此地四年的日食：按需算（findNext('eclipse') 连续搜）
    function countEclipses() {
      var P = HY.model.P, O = HY.model.O, t0 = HY.state.time.t, t = t0, n = 0, guard = 0;
      eclOut.textContent = '正在算…';
      setTimeout(function () {
        try {
          while (guard++ < 60) {
            var nx = HY.calc.findNext('eclipse', O, t, P, 1);
            if (nx == null || nx > t0 + 4 * P.Y) break;
            n++; t = nx + 0.5;
          }
          eclOut.textContent = (O.name || '此地') + '往后四年约 ' + n + ' 次日食' + (n ? '' : '（这里看不到）') + '。';
        } catch (e) { eclOut.textContent = '没算出来：' + e.message; }
      }, 20);
    }
    var dirty = true, timer = null;
    function schedule() {
      dirty = true;
      if (HY.state.ui.tab !== 'notes') return;
      clearTimeout(timer);
      timer = setTimeout(function () { if (dirty) { dirty = false; render(); } }, 200);
    }
    N_.render = function () { dirty = false; render(); };
    HY.bus.on('model', schedule);
    HY.bus.on('fp', function (e) { if (['fp.ground', 'fp.set', 'fp.atmo'].some(function (p) { return ui.touches(e, p); })) schedule(); });
    HY.bus.on('ui', function (e) { if (e && (e.path === 'ui.tab' || e.path === 'ui') && HY.state.ui.tab === 'notes' && dirty) { dirty = false; render(); } });
    var lastSeason = '';
    HY.bus.on('time', function () { var s = HY.model.now ? HY.model.now.season + HY.model.now.date.N : ''; if (s !== lastSeason) { lastSeason = s; schedule(); } });
    if (HY.state.ui.tab === 'notes') N_.render();
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
