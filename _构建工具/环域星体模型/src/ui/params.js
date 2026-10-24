/* HY.ui.PARAMS —— 参数面板的声明表＋生成器（规格：spec/03 第九节第 5 条；第一人称各组照 02 第十七节第 5 条、附录 A）
 * 负责：D 路（界面）。
 * 每行 { group, path, label, kind:'range'|'toggle'|'select'|'seg', min, max, step, opts:[{v,label}], unit（或 fmt）, note,
 *        setting, advanced, narrow, dyn(P)→[min,max], when(state)→bool, off（when 为假时的说明）, hint(v, P, state)→文本 }
 *   path 必须在 HY.store.SCHEMA 里；范围与 SCHEMA 一致（narrow 为真的行可以更窄）；setting 为真的行只能在“设定”组（test/params_check.js）。
 * 其他路要给自己新加的状态配控件：在自己的文件里调 HY.ui.addParams(rows)。
 * 节点可测：表、addParams、paramWarnings、fmt 不碰 DOM；init(el) 才碰。
 */
(function (G) {
  'use strict';
  var HY = G.HY = G.HY || {};
  var ui = HY.ui = HY.ui || {};

  // 界面新增的状态（只在这里登记，见 04 第三节）：第一人称读数里的调试项（帧率、内部分辨率、EV、逐 pass 用时）默认不显示
  if (HY.store && HY.store.extendSchema) HY.store.extendSchema({ 'fp.debug.hudPerf': { def: false, type: 'bool' } });

  ui.PARAM_GROUPS = ['天体', '星体与分域', '总览显示', '第一人称·画质', '第一人称·大气', '第一人称·云', '第一人称·地面', '设定', '眼睛'];
  // 组说明（标题下一行小字）
  ui.PARAM_GROUP_NOTES = {
    '天体': '全部透传给天体模块；没动过的项显示当前值，不写进存档。',
    '星体与分域': '改星体半径、塔半径，各地的数都会跟着变。',
    '总览显示': '只影响总览的画法，光照与塔影一律按真实位置算。',
    '第一人称·画质': '画质越高越吃显卡；手机默认低档。',
    '设定': '这一组不是物理推出来的，是待作者拍板的设定。开关默认关；余息默认按日期。',
    '眼睛': '模拟人眼的曝光、色适应与暗视觉。'
  };
  var KM = '公里';
  function terrace(s) { return s.fp.ground.mode === 'terrace'; }
  ui.PARAMS = [
    // ── 天体（透传 HY.astro）
    { group: '天体', path: 'astro.preset', label: '预设', kind: 'select', opts: [{ v: 'default', label: '定稿' }, { v: 'bing', label: '丙原参数' }], note: '丙原参数带“圣禁城冬季影期”。' },
    { group: '天体', path: 'astro.o.dS', label: '日轨离塔轴', kind: 'range', min: 125, max: 2600, step: 1, unit: KM,
      dyn: function (P) { return [Math.max(125, P.a + 25), Math.min(2600, P.a + 600)]; },
      hint: function (v, P) { return '离塔面 ' + fmtN(v - P.a, 0) + ' 公里'; }, note: '决定昼长、日落时长与黑月半角。' },
    { group: '天体', path: 'astro.o.rhoS', label: '日半径', kind: 'range', min: 5, max: 60, step: 1, unit: KM },
    { group: '天体', path: 'astro.o.sTrop', label: '回归纬线', kind: 'range', min: 3000, max: 9000, step: 10, unit: KM, note: '离塔根的地面距离；默认 πR/3，即罪域。' },
    { group: '天体', path: 'astro.linkA', label: '振幅随回归纬线', kind: 'toggle', note: '开着时罪域永远是日月的回归线。' },
    { group: '天体', path: 'astro.o.A', label: '日月振幅', kind: 'range', min: 500, max: 6000, step: 5, unit: KM,
      when: function (s) { return !s.astro.linkA; }, off: '由回归纬线推出；关掉上一项才能调' },
    { group: '天体', path: 'astro.linkRM', label: '月轨随振幅', kind: 'toggle' },
    { group: '天体', path: 'astro.o.rM', label: '月轨离塔轴', kind: 'range', min: 1800, max: 6000, step: 5, unit: KM,
      when: function (s) { return !s.astro.linkRM; }, off: '跟着振幅走；关掉上一项才能调',
      note: '黑月半角要大于 90°，月轨须大于约 1,725 公里（日轨 640 时）。' },
    { group: '天体', path: 'astro.o.rhoM', label: '月半径', kind: 'range', min: 30, max: 300, step: 1, unit: KM },
    { group: '天体', path: 'astro.o.Y', label: '一年', kind: 'range', min: 300, max: 420, step: 1, unit: '日', note: '改了它，“入冬后第几日”就和正文对不齐。' },
    { group: '天体', path: 'astro.o.lunPerYear', label: '一年几个月', kind: 'range', min: 6, max: 24, step: 0.25, unit: '月', note: '尾数须是 ¼ 或 ¾，才有四年一度的庆典。' },
    { group: '天体', path: 'astro.o.epochAz', label: '交节经线', kind: 'range', min: -180, max: 180, step: 0.5, unit: '°', note: '入冬交节落在这条经线的子夜（伊美忒 2°）。' },
    // 统筹修订：光度定标默认 5772 K、月面反照率默认 0.6，放进“高级”
    { group: '天体', path: 'astro.calib', label: '光度定标', kind: 'seg', opts: [{ v: '5772K', label: '日面 5772 K' }, { v: '1361', label: '1361 W/m²' }], advanced: true,
      note: '5772 K：日光和地球太阳同色；1361：照度全部乘 1.78。' },
    { group: '天体', path: 'astro.o.pMoon', label: '月面反照率', kind: 'range', min: 0.05, max: 1, step: 0.01, advanced: true, note: '白月 0.6；地球的月亮 0.12。' },

    // ── 星体与分域
    { group: '星体与分域', path: 'astro.o.R', label: '星体半径', kind: 'range', min: 2000, max: 12000, step: 10, unit: KM },
    { group: '星体与分域', path: 'astro.o.a', label: '巨塔半径', kind: 'range', min: 100, max: 2000, step: 5, unit: KM },
    { group: '星体与分域', path: 'astro.o.gEq', label: '赤道重力', kind: 'range', min: 0.3, max: 3, step: 0.01, unit: 'g',
      hint: function (v, P) { return '自转一周 ' + fmtN(2 * Math.PI / Math.sqrt(v * 9.80665 / (P.R * 1000)) / 60, 1) + ' 分'; } },
    { group: '星体与分域', path: 'zones.gLight', label: '轻／平分界', kind: 'range', min: 0.1, max: 2.5, step: 0.01, unit: 'g' },
    { group: '星体与分域', path: 'zones.gHeavy', label: '平／重分界', kind: 'range', min: 0.2, max: 3, step: 0.01, unit: 'g' },
    { group: '星体与分域', path: 'zones.limboKm', label: '灵薄带半宽', kind: 'range', min: 0, max: 1500, step: 1, unit: KM,
      hint: function (v, P) { return '赤道两侧各约 ' + fmtN(v / P.R * 180 / Math.PI, 1) + '°'; } },

    // ── 总览显示
    { group: '总览显示', path: 'ov.helix', label: '螺旋画法', kind: 'select', opts: [{ v: 'mirror', label: '镜像双螺旋（示意）' }, { v: 'real', label: '实际轨迹' }, { v: 'strobe', label: '每日同刻' }, { v: 'off', label: '不画' }] },
    { group: '总览显示', path: 'ov.helixTurns', label: '示意螺旋圈数', kind: 'range', min: 4, max: 48, step: 1, unit: '圈/年', note: '实际是太阳一年 360 圈，看不出螺旋，所以压缩。' },
    { group: '总览显示', path: 'ov.sunGapX', label: '日轨离塔面放大', kind: 'range', min: 1, max: 10, step: 0.5, unit: '倍' },
    { group: '总览显示', path: 'ov.bodyScale', label: '日月本体放大', kind: 'range', min: 1, max: 10, step: 0.5, unit: '倍' },
    { group: '总览显示', path: 'ov.frame', label: '参照系', kind: 'seg', opts: [{ v: 'ground', label: '随星体转' }, { v: 'inertial', label: '惯性系' }] },
    { group: '总览显示', path: 'ov.cut', label: '剖切', kind: 'seg', opts: [{ v: 'half', label: '剖开近侧' }, { v: 'ghost', label: '半透明' }, { v: 'none', label: '完整' }] },
    { group: '总览显示', path: 'ov.trails', label: '轨迹尾', kind: 'toggle' },
    { group: '总览显示', path: 'ov.shadowVol', label: '塔影体', kind: 'toggle' },
    { group: '总览显示', path: 'ov.grid', label: '经纬网', kind: 'toggle' },
    { group: '总览显示', path: 'ov.labels', label: '标签', kind: 'toggle' },
    { group: '总览显示', path: 'ov.sites', label: '地点针', kind: 'toggle' },
    { group: '总览显示', path: 'ov.stars', label: '外侧星空', kind: 'toggle' },
    { group: '总览显示', path: 'ov.sight', label: '视线', kind: 'toggle' },
    { group: '总览显示', path: 'ov.showMoon', label: '显示月', kind: 'toggle' },

    // ── 第一人称·画质（含视角与身体）
    { group: '第一人称·画质', path: 'fp.quality', label: '画质', kind: 'seg', opts: [{ v: 'low', label: '低' }, { v: 'mid', label: '中' }, { v: 'high', label: '高' }, { v: 'photo', label: '拍照' }],
      note: '换档时先照常出图，新的一档在后台准备好（十几秒）再切过去。' },
    { group: '第一人称·画质', path: 'fp.dynRes', label: '动态分辨率', kind: 'toggle', note: '画面卡顿时自动降低内部分辨率保住流畅；关掉则始终按这一档的分辨率画。' },
    { group: '第一人称·画质', path: 'fp.eyeo.glare', label: '眩光强度', kind: 'range', min: 0, max: 2, step: 0.05, note: '太阳、亮月四周的光晕有多强；0 是没有。' },
    { group: '第一人称·画质', path: 'fp.fov', label: '竖直视角', kind: 'range', min: 30, max: 100, step: 1, unit: '°', narrow: true, note: '画面上下能看到多大的角度；望远（T 键）是 5°。' },
    { group: '第一人称·画质', path: 'fp.eye', label: '眼高', kind: 'range', min: 1.2, max: 2, step: 0.05, unit: '米', note: '站着时眼睛离地面多高。' },
    { group: '第一人称·画质', path: 'fp.bob', label: '走路时头部起伏', kind: 'toggle' },
    { group: '第一人称·画质', path: 'fp.hud', label: '罗盘与读数', kind: 'toggle', note: '罗盘、地名与读数；按 H 连同全部界面一起藏起来。' },
    { group: '第一人称·画质', path: 'fp.cross', label: '准星', kind: 'toggle', note: '画面正中的小十字。' },
    { group: '第一人称·画质', path: 'fp.debug.hudPerf', label: '显示帧率与用时', kind: 'toggle', note: '调试用：第一人称读数里多出帧率、内部分辨率、曝光值与各步骤的显卡用时。' },

    // ── 第一人称·大气
    { group: '第一人称·大气', path: 'fp.atmo.on', label: '大气', kind: 'toggle', note: '关掉就是没有空气：天空不发亮，对岸与巨塔清清楚楚。' },
    { group: '第一人称·大气', path: 'fp.atmo.HR', label: '空气标高', kind: 'range', min: 4, max: 80, step: 1, unit: KM, note: '地球是 8.5。越厚，白天的天光越会把巨塔洗灰。' },
    { group: '第一人称·大气', path: 'fp.atmo.HM', label: '霾标高', kind: 'range', min: 1, max: 20, step: 0.1, unit: KM, note: '尘与水汽（霾）聚在离地多高的一层里；越高，远处的山越朦胧。' },
    { group: '第一人称·大气', path: 'fp.atmo.V', label: '能见度', kind: 'range', min: 20, max: 288, step: 1, unit: KM, note: '晴天时能看多远；越小，远处越白、越淡。' },
    { group: '第一人称·大气', path: 'fp.atmo.g', label: '霾的前向散射', kind: 'range', min: 0.5, max: 0.9, step: 0.01,
      note: '霾把光往前方散的程度：越大，太阳四周那圈白亮越集中；越小，整片天越均匀地发白。' },

    // ── 第一人称·云
    { group: '第一人称·云', path: 'fp.cloud.on', label: '云', kind: 'toggle' },
    { group: '第一人称·云', path: 'fp.cloud.cover', label: '覆盖度', kind: 'range', min: 0, max: 1, step: 0.01, note: '天上大约几成是云（罪域阴云另算）。' },
    { group: '第一人称·云', path: 'fp.cloud.base', label: '云底', kind: 'range', min: 0.3, max: 10, step: 0.1, unit: KM, note: '云的下沿离地多高。' },
    { group: '第一人称·云', path: 'fp.cloud.top', label: '云顶', kind: 'range', min: 0.3, max: 10, step: 0.1, unit: KM, note: '云的上沿；云越厚，云底越暗。' },
    { group: '第一人称·云', path: 'fp.cloud.sigma', label: '消光系数', kind: 'range', min: 5, max: 60, step: 1, unit: '/公里', note: '云有多密：越大越不透光，云边越清楚。' },
    { group: '第一人称·云', path: 'fp.cloud.rui', label: '罪域阴云强度', kind: 'range', min: 0, max: 1, step: 0.01, note: '罪域上空终年不散的厚云盖，半径约 900 公里；0 是没有。' },
    { group: '第一人称·云', path: 'fp.cloud.ruiBase', label: '罪域云底', kind: 'range', min: 0.3, max: 5, step: 0.1, unit: KM },
    { group: '第一人称·云', path: 'fp.cloud.ruiTop', label: '罪域云顶', kind: 'range', min: 1, max: 10, step: 0.1, unit: KM },
    { group: '第一人称·云', path: 'fp.cloud.ruiTau', label: '罪域云的光学厚度', kind: 'range', min: 0, max: 120, step: 1, note: '越大，罪域云下越暗；60 时直射的日光几乎透不过来。' },
    { group: '第一人称·云', path: 'fp.cloud.rain', label: '雨雾消光', kind: 'range', min: 0, max: 0.2, step: 0.005, unit: '/公里', note: '罪域的雨与雨雾让远处发灰的程度；0 是不下雨。' },
    { group: '第一人称·云', path: 'fp.cloud.wind', label: '风速倍率', kind: 'range', min: 0, max: 5, step: 0.1, note: '云随时间流速一起快进。' },

    // ── 第一人称·地面。统筹修订：地面默认“阶地”（W 固定），可切到“顺着球面的斜坡”
    { group: '第一人称·地面', path: 'fp.ground.mode', label: '地面', kind: 'seg', opts: [{ v: 'terrace', label: '阶地' }, { v: 'slope', label: '顺着球面的斜坡' }],
      note: '阶地：踏面水平、宽度处处相同，崖高＝踏面宽 × tan 纬度。' },
    { group: '第一人称·地面', path: 'fp.ground.W', label: '踏面宽', kind: 'range', min: 0.3, max: 8, step: 0.1, unit: KM, when: terrace, off: '斜坡模式下不用',
      hint: function (v, P, s) {
        var lat = HY.model && HY.model.O ? HY.model.O.lat : 30;
        return '此地崖高约 ' + fmtN(v * Math.tan(Math.abs(lat) * Math.PI / 180), 2) + ' 公里';
      } },
    { group: '第一人称·地面', path: 'fp.ground.cliff', label: '崖带占比', kind: 'range', min: 0.02, max: 0.2, step: 0.01, when: terrace, off: '斜坡模式下不用',
      note: '每一级里陡崖占踏面宽的几成；越大，崖越缓、越宽。' },
    { group: '第一人称·地面', path: 'fp.ground.resid', label: '踏面余坡', kind: 'range', min: 0, max: 0.5, step: 0.01, when: terrace, off: '斜坡模式下不用',
      note: '踏面保留原来坡度的几成；0 是完全水平。' },
    { group: '第一人称·地面', path: 'fp.ground.wig', label: '阶沿蜿蜒', kind: 'range', min: 0, max: 0.5, step: 0.01, unit: '级', when: terrace, off: '斜坡模式下不用',
      note: '崖边线左右弯曲的幅度（以一级为单位）；0 是笔直的等高线。' },
    { group: '第一人称·地面', path: 'fp.ground.jit', label: '扶壁', kind: 'range', min: 0, max: 0.5, step: 0.01, unit: '级', when: terrace, off: '斜坡模式下不用',
      note: '崖壁上凸出的石墩、扶壁有多大（以一级为单位）；0 是平整的崖面。' },
    { group: '第一人称·地面', path: 'fp.ground.amp', label: '起伏倍率', kind: 'range', min: 0, max: 3, step: 0.05, note: '小山、沟谷的高低；0 是完全平整。' },
    { group: '第一人称·地面', path: 'fp.ground.abyssDepth', label: '深渊深度', kind: 'range', min: 0, max: 80, step: 1, unit: KM },
    { group: '第一人称·地面', path: 'fp.ground.abyssHalf', label: '深渊半宽', kind: 'range', min: 50, max: 400, step: 5, unit: KM, note: '赤道深渊从中线到一侧边缘有多宽。' },
    { group: '第一人称·地面', path: 'fp.ground.abyssFog', label: '深渊雾', kind: 'toggle', note: '深渊里积着雾。' },
    { group: '第一人称·地面', path: 'fp.ground.wet', label: '湿度', kind: 'range', min: 0, max: 1, step: 0.05, note: '罪域地面有多湿：越湿越暗、越反光。' },

    // ── 设定（非物理）。统筹修订：夜默认如实画“白夜”；静滞夜幕是设定开关＋强度，默认关
    { group: '设定', path: 'fp.set.veil', label: '静滞夜幕', kind: 'toggle', setting: true, note: '默认关：夜如实画成被对岸照亮的“白夜”。' },
    { group: '设定', path: 'fp.set.veilK', label: '夜幕强度', kind: 'range', min: 0, max: 1, step: 0.01, setting: true, unit: '/千公里',
      when: function (s) { return s.fp.set.veil; }, off: '先打开静滞夜幕', note: '越强夜越黑：0.3 时子夜几百勒克斯（很暗的阴天），0.6 时几十到几勒克斯（黄昏后），1 时只剩几勒克斯。' },
    { group: '设定', path: 'fp.set.dayComp', label: '昼光补偿', kind: 'range', min: 0, max: 1, step: 0.05, setting: true, note: '把此地白天被夜幕吃掉的日光补回来（最多补到不开夜幕时那样），夜里不受影响。0 是不补，白天也跟着暗。' },
    { group: '设定', path: 'fp.set.acid', label: '罪域酸霾', kind: 'toggle', setting: true, note: '罪域低空一层昏黄的酸雾。' },
    { group: '设定', path: 'fp.set.acidExt', label: '酸霾消光', kind: 'range', min: 0, max: 1.5, step: 0.01, setting: true, unit: '/公里',
      when: function (s) { return s.fp.set.acid; }, off: '先打开罪域酸霾', note: '酸霾有多浓：0.3 时地面能见度十来公里，五到十公里外的山就隐进黄灰色的雾里；1 以上只看得清两三公里。' },
    { group: '设定', path: 'fp.set.acidOmega', label: '酸霾反照率', kind: 'range', min: 0.6, max: 0.95, step: 0.01, setting: true,
      when: function (s) { return s.fp.set.acid; }, off: '先打开罪域酸霾', note: '越小，酸霾吸的光越多，越暗、越偏褐。' },
    { group: '设定', path: 'fp.set.yuxi', label: '余息', kind: 'seg', setting: true, opts: [{ v: 'auto', label: '按日期' }, { v: 'on', label: '开' }, { v: 'off', label: '关' }],
      note: '入冬前从塔根往外刮的冷风与白灰。' },
    { group: '设定', path: 'fp.set.yuxiLead', label: '余息提前', kind: 'range', min: 0, max: 120, step: 1, setting: true, unit: '日',
      when: function (s) { return s.fp.set.yuxi !== 'off'; }, off: '余息已关',
      hint: function (v, P, s) { return ui.yuxiReach ? ui.yuxiReach.hint(s, P, v) : '前锋按日期往外推'; },
      note: '入冬前多少日起，前锋从塔根外 1,500 公里往外推。' },
    { group: '设定', path: 'fp.set.sheathN0', label: '塔缘气层', kind: 'range', min: 0, max: 0.05, step: 0.001, setting: true, note: '0＝没有。有了它，日面切入塔缘时会泛出红边。' },
    { group: '设定', path: 'fp.set.sheathHt', label: '塔缘气层厚度', kind: 'range', min: 5, max: 50, step: 1, setting: true, unit: KM,
      when: function (s) { return s.fp.set.sheathN0 > 0; }, off: '塔缘气层为 0' },
    { group: '设定', path: 'fp.set.towerAlb', label: '塔反照率', kind: 'range', min: 0, max: 0.04, step: 0.001, setting: true, note: '塔面反光的比例；0 是纯黑。' },

    // ── 眼睛
    { group: '眼睛', path: 'fp.eyeo.auto', label: '自动曝光', kind: 'toggle', note: '像眼睛一样随明暗慢慢适应；关掉后按下面的固定曝光。' },
    { group: '眼睛', path: 'fp.eyeo.evLock', label: '固定曝光', kind: 'range', min: -6, max: 20, step: 0.5, unit: 'EV',
      when: function (s) { return !s.fp.eyeo.auto; }, off: '自动曝光开着', note: '固定以后能直接比较昼夜的明暗；数越大画面越暗。' },
    { group: '眼睛', path: 'fp.eyeo.evComp', label: '曝光补偿', kind: 'range', min: -3, max: 3, step: 0.1, unit: 'EV', note: '整体调亮或调暗；+1 亮一倍。' },
    { group: '眼睛', path: 'fp.eyeo.cat', label: '色适应强度', kind: 'range', min: 0, max: 1, step: 0.05,
      note: '眼睛对光色的适应：1 时黄昏的橙光、阴天的蓝灰都被看得接近白；0 时照原色显示。' },
    { group: '眼睛', path: 'fp.eyeo.scotopic', label: '暗视觉', kind: 'toggle', note: '很暗时颜色褪去、偏蓝。' },
    { group: '眼睛', path: 'fp.eyeo.tone', label: '色调映射', kind: 'seg', opts: [{ v: 'agx', label: 'AgX' }, { v: 'aces', label: 'ACES' }],
      note: '把明暗压进屏幕的方式：AgX 太亮时褪成白，像眼睛；ACES 颜色更浓，像电影。' }
  ];
  // 组里的快捷动作（不对应单一路径）：patch 一组值
  ui.PARAM_ACTIONS = [
    { group: '第一人称·大气', label: '地球式大气', note: '空气标高 8.5、霾标高 1.2 公里', patch: { 'fp.atmo.HR': 8.5, 'fp.atmo.HM': 1.2 } },
    { group: '第一人称·大气', label: '本稿默认', note: '空气标高 40、霾标高 6 公里', patch: { 'fp.atmo.HR': 40, 'fp.atmo.HM': 6 } }
  ];

  ui.addParams = function (rows) {
    rows.forEach(function (r) {
      if (!r.group || !r.path || !r.kind) throw new Error('PARAMS 行缺 group／path／kind');
      if (ui.PARAM_GROUPS.indexOf(r.group) < 0) ui.PARAM_GROUPS.push(r.group);
      ui.PARAMS.push(r);
    });
  };

  /* 事件 e（store 的 set／patch／reset 载荷）是否碰到了 prefix 下的状态。
   * patch 带 paths（逐个叶子）；set 只有 path；reset 的 path 是范围（可能比 prefix 还宽）。
   * 第一人称每 0.5 s 以 patch('fp', {yaw, pitch, fov}) 写回朝向：听 'fp' 事件的模块用它过滤，免得跟着重算。 */
  ui.touches = function (e, prefix) {
    if (!e) return false;
    var ps = e.paths || [e.path || ''];
    return ps.some(function (p) {
      return p === prefix || p.indexOf(prefix + '.') === 0 || prefix.indexOf(p + '.') === 0 || p === '';
    });
  };

  /* ───────── 小工具：数字格式、照度对照（节点可测；读数卡与第一人称 HUD 共用） ───────── */
  function fmtN(v, d) { return HY.util ? HY.util.fixed(v, d) : (+v).toFixed(d); }
  var UNIT = { km: KM, g: 'g', deg: '°' };
  ui.unitOf = function (r) { return r.unit || (typeof r.fmt === 'string' ? (UNIT[r.fmt] || r.fmt) : ''); };
  // 照度 → 地球上的对照（02 第十四节第 3 条）。地球晴天正午约 10–12 万勒克斯；离日近的地方（圣禁城入夏正午 21 万）
  //   比它还亮，直接说亮几倍，不再套“晴天正午”
  var LUX = [[5e4, '晴天正午'], [1e4, '阴天白昼、晴天上午'], [1e3, '阴天、日出后不久'], [1e2, '很暗的阴天、日落时'], [10, '民用晨昏'], [1, '深黄昏'], [0.1, '满月夜'], [-1, '星光']];
  var EARTH_NOON = 1.1e5;
  ui.LUX_EARTH = LUX;
  ui.fmt = {
    n: fmtN,
    lux: function (v) {
      if (!isFinite(v)) return '—';
      if (v >= 1e4) return fmtN(v / 1000, 0) + ' klux';
      if (v >= 1000) return fmtN(v / 1000, 1) + ' klux';
      if (v >= 10) return fmtN(v, 0) + ' lux';
      if (v >= 0.1) return fmtN(v, 2) + ' lux';
      if (v >= 1e-4) return String(+v.toPrecision(2)) + ' lux';            // 0.025 lux：小数比科学计数好读
      return (v > 0 ? v.toExponential(1).replace('-', '−') : '0') + ' lux';
    },
    /* 月的简短说法（顶栏要点、第一人称 HUD 共用）：亮月给亮面；灰月给“亮面×月心受照”（影边吃掉的那部分不算亮）；
     * 黑月在塔影里，几何上的亮面没有意义，不写百分比，只写“高悬”与否 */
    moonShort: function (m) {
      if (!m || !m.state) return '—';
      if (m.state === '黑月') return '黑月' + (m.blackHigh ? ' · 高悬' : '');
      var lit = m.state === '灰月' && isFinite(m.sunlit) ? m.k * m.sunlit : m.k;
      return m.state + (isFinite(lit) ? ' ' + Math.round(lit * 100) + '%' : '');
    },
    luxEarth: function (v) {
      if (!isFinite(v)) return '';
      if (v >= 1.3 * EARTH_NOON) return '比晴天正午还亮（约 ' + fmtN(v / EARTH_NOON, 1) + ' 倍）';
      for (var i = 0; i < LUX.length; i++) if (v >= LUX[i][0]) return LUX[i][1];
      return '';
    },
    // 照度的一句人话：“13 klux，相当于地球上阴天的白昼”“213 klux，比地球晴天正午还亮约 1.9 倍”
    luxLine: function (v) {
      if (!isFinite(v)) return '—';
      var e = ui.fmt.luxEarth(v), s = ui.fmt.lux(v);
      if (!e) return s;
      return s + (/^比/.test(e) ? '，比地球' + e.slice(1) : '，相当于地球上' + e);
    },
    deg: function (v, d) { return fmtN(v, d == null ? 1 : d) + '°'; },
    hoff: function (v) { return Math.abs(v) < 0.05 ? '正对塔中线' : (v > 0 ? '东 ' : '西 ') + fmtN(Math.abs(v), 1) + '°'; }
  };

  /* ───────── 余息前锋（节点可测；说明页的正文对照、参数提示、读数、第一人称 HUD 共用） ─────────
   * 一律查 HY.fp.set.yuxi（第一人称画的就是它），不另立公式：前锋什么时候推到离塔根 s 公里处、此刻推到了哪里。 */
  ui.yuxiReach = {
    STORY_DAYS: 32,              // 正文 ch26：余息吹进罪域时“离庆典还有一个多月”（庆典夜＝入冬前 1 日）→ 入冬前 32 日以上
    // 前锋在入冬前几日推到离塔根 s 公里处（按此刻参数，步长 0.05 日；一直推不到返回 null）
    days: function (state, P, s) {
      var F = HY.fp && HY.fp.set && HY.fp.set.yuxi;
      if (!F || !P || !state || !state.fp || state.fp.set.yuxi === 'off') return null;
      var Y = P.Y || 360, tW = Y * 3, L = Math.max(1, +state.fp.set.yuxiLead || 0) + 1;
      for (var b = L; b >= -1e-9; b -= 0.05) { var y = F(state, P, tW - b); if (y[0] > 0 && y[1] >= s) return Math.max(0, b); }
      return null;
    },
    // 此刻：{on（此刻有余息）, front（前锋离塔根 km）, width, here（'past' 已过此地｜'edge' 前锋正经过｜'ahead' 还没到）, toGo（还差几公里）, k（强度 0–1）}
    now: function (state, P, t, s) {
      var F = HY.fp && HY.fp.set && HY.fp.set.yuxi, S = HY.fp && HY.fp.set && HY.fp.set.YUXI;
      if (!F || !P || !state) return null;
      var y = F(state, P, t), k = S && S.ext ? y[0] / S.ext : (y[0] > 0 ? 1 : 0), w = y[3] || 300;
      var here = s <= y[1] - w ? 'past' : s <= y[1] ? 'edge' : 'ahead';
      return { on: y[0] > 0, front: y[1], width: w, here: here, toGo: Math.max(0, s - y[1]), k: k, mode: state.fp.set.yuxi };
    },
    // 参数页“余息提前”下面的一行：按 v 日起推，前锋入冬前几日到罪域
    hint: function (state, P, v) {
      var q = HY.world.siteById('zuiyu', P);
      if (!q || !state) return '';
      var st = { fp: { set: {} } }, k;
      for (k in state.fp.set) st.fp.set[k] = state.fp.set[k];
      if (v != null) st.fp.set.yuxiLead = v;
      var d = ui.yuxiReach.days(st, P, q.s);
      return d == null ? '前锋在入冬前推不到罪域' : '前锋入冬前 ' + fmtN(d, d < 10 ? 1 : 0) + ' 日推到罪域（正文：离庆典还有一个多月）';
    }
  };

  /* ───────── 约束提示（节点可测）：当前参数下哪些推论不成立 → [文字] ───────── */
  ui.paramWarnings = function (state, P) {
    var A = HY.astro, out = [], D2R = Math.PI / 180;
    if (!A || !P) return out;
    var q = ((P.lunPerYear % 1) + 1) % 1;
    if (Math.abs(q - 0.25) > 1e-9 && Math.abs(q - 0.75) > 1e-9) out.push('一年 ' + fmtN(P.lunPerYear, 2) + ' 个月：尾数不是 ¼ 或 ¾，四年一度的庆典节律不成立。');
    var bDeg = P.beta / D2R;
    if (!(bDeg > 90)) {
      var need = P.a / Math.sqrt(Math.max(1e-9, 1 - (P.a / P.dS) * (P.a / P.dS)));
      out.push('黑月半角只有 ' + fmtN(bDeg, 1) + '°，不足 90°：庆典节律不成立（月轨须大于 ' + fmtN(need, 0) + ' 公里）。');
    }
    var ok4 = true;
    for (var k = 0; k < 4; k++) if (A.isFestival(P.epochYear + k, P) !== (k === 0)) ok4 = false;
    var m = A.festivalMargin(P);
    if (!ok4) out.push('当前参数下庆典四年节律不成立，余量 −' + fmtN(m, 2) + ' 日。');
    else if (m < 0.25) out.push('庆典四年节律只剩 ' + fmtN(m, 2) + ' 日余量，参数再动一点就会破。');
    if (P.Y !== 360) out.push('一年改成 ' + P.Y + ' 日：“入冬后第几日”与正文的日期对不齐。');
    if (state && state.astro && !state.astro.linkA) {
      var A0 = P.R * Math.cos(P.sTrop / P.R);
      if (Math.abs(P.A - A0) > 1) out.push('振幅与回归纬线脱钩：罪域不再是日月的回归线。');
    }
    return out;
  };

  /* ───────── 生成器 ───────── */
  var P_ = ui.params = ui.params || {};
  P_.__stub = false;
  var ctl = [], warnEl = null, flashEl = null, flashTimer = null;

  function curVal(path) {
    var v = HY.store.get(path);
    if (v == null && /^astro\.o\./.test(path) && HY.model && HY.model.P) v = HY.model.P[path.slice(8)];
    if (path === 'astro.o.A' && HY.state.astro.linkA && HY.model.P) v = HY.model.P.A;
    if (path === 'astro.o.rM' && HY.state.astro.linkRM && HY.model.P) v = HY.model.P.rM;
    return v;
  }
  function makeRow(r) {
    var w = ui.w, unit = ui.unitOf(r), throttled = null;
    var write = function (v) { HY.store.set(r.path, v, 'ui'); };
    var o = { label: r.label, min: r.min, max: r.max, step: r.step, opts: r.opts, setting: r.setting, advanced: false, note: r.note, unit: unit, value: curVal(r.path) };
    var wg;
    if (r.kind === 'range') {
      throttled = HY.util.throttle(write, 60);
      o.onInput = throttled; o.onChange = write;
      if (r.hint) o.hint = function (v) { return r.hint(v, HY.model.P, HY.state); };
      wg = w.range(o);
    } else if (r.kind === 'toggle') { o.onInput = write; wg = w.toggle(o); }
    else if (r.kind === 'seg') { o.onInput = write; wg = w.seg(o); }
    else { o.onInput = write; wg = w.select(o); }
    wg.el.dataset.path = r.path;
    return { r: r, w: wg };
  }
  function syncRow(c) {
    var r = c.r, v = curVal(r.path);
    if (r.kind === 'range' && r.dyn && HY.model.P) { var b = r.dyn(HY.model.P); c.w.setRange(Math.min(b[0], v), Math.max(b[1], v)); }
    if (v != null) c.w.set(v);
    if (r.when && c.w.disable) { var on = !!r.when(HY.state); c.w.disable(!on, r.off); }
  }
  // e 为 store 事件时只刷新被碰到的行（第一人称写回朝向时不必把八十多行全刷一遍）
  function sync(e) {
    if (e && e.path && e.src !== 'reset' && e.src !== 'load') {
      var hit = ctl.filter(function (c) { return ui.touches(e, c.r.path); });
      if (!hit.length && e.src === 'fp') return;
      if (hit.length && hit.length < ctl.length) { hit.forEach(syncRow); ctl.forEach(function (c) { if (c.r.when) syncRow(c); }); showWarnings(); return; }
    }
    ctl.forEach(syncRow); showWarnings();
  }
  function showWarnings() {
    if (!warnEl) return;
    var list = ui.paramWarnings(HY.state, HY.model.P);
    warnEl.textContent = '';
    warnEl.hidden = !list.length;
    list.forEach(function (s) { warnEl.appendChild(ui.w.h('p', '', s)); });
  }
  function flash(msg) {
    if (!flashEl) return;
    flashEl.textContent = msg; flashEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashEl.hidden = true; }, 6000);
  }
  function groupPaths(g) {
    var ps = ui.PARAMS.filter(function (r) { return r.group === g; }).map(function (r) { return r.path; });
    ui.PARAM_ACTIONS.forEach(function (a) { if (a.group === g) Object.keys(a.patch).forEach(function (p) { if (ps.indexOf(p) < 0) ps.push(p); }); });
    return ps;
  }
  P_.resetGroup = function (g) { HY.store.reset(groupPaths(g), 'reset'); };
  // 恢复默认：全部，保留 view.mode 与 ui.*（03 第三节第 4 条）；手机上画质仍取低档
  P_.resetAll = function () {
    HY.store.reset(null, 'reset', ['view', 'ui']);
    var mob = G.matchMedia && G.matchMedia('(pointer: coarse) and (max-width: 767px)').matches;
    if (mob) HY.store.set('fp.quality', 'low', 'reset');
  };
  P_.controls = function () { return ctl; };

  P_.init = function (el) {
    if (!el || !ui.w) return;
    var w = ui.w;
    el.textContent = '';
    ctl = [];
    warnEl = w.h('div', 'p-warn'); warnEl.setAttribute('role', 'status'); warnEl.hidden = true;
    flashEl = w.h('div', 'p-warn p-flash'); flashEl.setAttribute('role', 'status'); flashEl.hidden = true;
    el.appendChild(warnEl); el.appendChild(flashEl);
    ui.PARAM_GROUPS.forEach(function (g, gi) {
      var rows = ui.PARAMS.filter(function (r) { return r.group === g; });
      if (!rows.length) return;
      var f = w.fold(g, '参数' + g.replace(/[.·]/g, ''), gi < 2, { cls: 'card pgroup' + (g === '设定' ? ' pgroup-setting' : '') });
      var rb = w.btn('本组默认', { cls: 'btn btn-mini', title: '把“' + g + '”这一组恢复默认', onClick: function (e) { e.preventDefault(); e.stopPropagation(); P_.resetGroup(g); } });
      f.head.appendChild(rb);
      if (ui.PARAM_GROUP_NOTES[g]) f.body.appendChild(w.h('p', 'w-note pgroup-note', ui.PARAM_GROUP_NOTES[g]));
      var adv = null;
      rows.forEach(function (r) {
        var c = makeRow(r);
        ctl.push(c);
        if (r.advanced) {
          if (!adv) adv = w.fold('高级', '参数' + g.replace(/[.·]/g, '') + '高级', false, { cls: 'pgroup-adv' });
          adv.body.appendChild(c.w.el);
        } else f.body.appendChild(c.w.el);
      });
      ui.PARAM_ACTIONS.filter(function (a) { return a.group === g; }).forEach(function (a) {
        var b = w.btn(a.label, { cls: 'btn btn-mini', title: a.note, onClick: function () {
          var o = {}; Object.keys(a.patch).forEach(function (p) { o[p.split('.').pop()] = a.patch[p]; });
          var base = Object.keys(a.patch)[0].split('.').slice(0, -1).join('.');
          HY.store.patch(base, o, 'ui');
        } });
        var row = w.h('div', 'p-actions'); row.appendChild(b); row.appendChild(w.h('span', 'w-note', a.note));
        f.body.appendChild(row);
      });
      if (adv) f.body.appendChild(adv.el);
      el.appendChild(f.el);
    });
    // 底部：恢复默认（点两次才生效）
    var foot = w.h('div', 'p-foot'), armed = false, armTimer = null;
    var all = w.btn('恢复默认', { cls: 'btn btn-warn', title: '把全部参数、时间与地点恢复默认（视图与界面布局保留）', onClick: function () {
      if (!armed) { armed = true; all.textContent = '再点一次确认'; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = false; all.textContent = '恢复默认'; }, 3000); return; }
      armed = false; all.textContent = '恢复默认'; P_.resetAll();
    } });
    foot.appendChild(all);
    foot.appendChild(w.h('span', 'w-note', '时间、地点、全部参数回到默认；视图与界面布局保留。'));
    el.appendChild(foot);

    ['astro', 'zones', 'ov', 'fp'].forEach(function (e) { HY.bus.on(e, sync); });
    ['model', 'site'].forEach(function (e) { HY.bus.on(e, function () { sync(null); }); });
    HY.bus.on('error', function (e) { if (e && e.part === 'params') flash(e.message); });
    sync();
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
