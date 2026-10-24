# 截图工具 `test/shoot.js`

按一张场景表，用本机的 Chrome 或 Edge（无头、真 GPU）逐个打开第一人称或总览，等画面稳定后截 PNG，同时记下照度、EV、帧率、GPU 用时、首帧耗时等读数，写进 `index.json`。用来做“改前／改后”对照和验收截图。

不改 `src/`，也不改构建产物：页面里只用现成的测试接口（`HY.app`、`HY.fp.api`、`HY.fp.readouts`、`HY.fp.eye.accum` 等）。

---

## 一、前提

- 先构建：`py build.py`（产物是 `🗺️ 互动地图/环域星体模型.html`）。
- node 22 或更新（要用内置的 `WebSocket` 与 `fetch`）。
- 本机装有 Chrome 或 Edge。工具按下面的次序找：`--browser` 参数 → 环境变量 `HY_BROWSER` → Chrome 的常见安装位置 → Edge。
- 要联网：页面运行时从 cdnjs 加载 three.js、从 jsdelivr 加载 OrbitControls。

## 二、用法

在 `环域星体模型/` 目录下：

```
node test/shoot.js                                   只检查 test/scenes_std.json，不开浏览器
node test/shoot.js --std --out test/shots/baseline --clean     重出标准基线
node test/shoot.js test/scenes_std.json              出图到 test/shots/<日期_时刻>/
node test/shoot.js --std --only 圣禁城,总览           只跑名字含这些词的场景
node test/shoot.js --std --only 5,9-12               也可以写序号
node test/shoot.js 我的场景.json --ui full            第一人称也带界面截
node test/shoot.js --std --check                     只列出每个场景解析出的地点、时刻、日月
```

| 选项 | 作用 |
|---|---|
| `--std` | 用 `test/scenes_std.json` |
| `--check` | 只检查场景，不开浏览器（不给场景文件时默认就是这个） |
| `--out <目录>` | 输出目录；默认 `test/shots/<日期_时刻>/` |
| `--clean` | 先删掉输出目录里旧的 `.png` 和 `index.json` |
| `--only <词,词>` | 只跑名字含这些词的场景，或序号、序号段 |
| `--ui clean\|full` | 没写 `ui` 的第一人称场景用哪种：`clean` 只要画面（默认），`full` 带界面 |
| `--size 1440x900` | 窗口大小（CSS 像素），像素比固定为 1 |
| `--page <html>` | 换一个页面（默认 `🗺️ 互动地图/环域星体模型.html`） |
| `--browser <exe>` | 指定浏览器 |
| `--prefer edge` | 自动找浏览器时先找 Edge |
| `--dynres` | 保留动态分辨率。默认关掉，内部分辨率按档位固定，前后两次的截图才好比 |
| `--settle <秒>` | 每个场景等画面稳定的墙钟上限，默认 90 |
| `--swiftshader` | 允许退回软件渲染。默认不允许：发现不是真 GPU 就停 |
| `--headful` | 开着窗口跑，调试用 |
| `--keep-profile` | 跑完不删浏览器用户目录，调试用 |

出图前会先在 node 里把场景表检查一遍，写错了直接报出来，不开浏览器。任何一个场景失败，退出码为 1。

`node test/run_all.js` 也会跑到这个文件：不带参数时它只检查 `scenes_std.json`（约 0.1 秒），不开浏览器。

## 三、浏览器怎么开

- 参数：`--headless=new --use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu`，另有关掉后台节流、固定像素比 1 等几项。实际参数写在 `index.json` 的 `browser.args`。
- 端口：`--remote-debugging-port=0`，由系统随机分配空闲端口，从用户目录的 `DevToolsActivePort` 文件读回。几个人同时跑互不冲突。
- 用户目录：`test/.shoot_profiles/run_<进程号>_<时刻>/`，跑完删除；目录空了连 `.shoot_profiles` 一起删。按 Ctrl+C 中断也会清理。
- 页面用 `file:///` 打开，路径按 URL 编码（中文和 emoji 都没问题）。每次都是全新的用户目录，所以页面里的存档、着色器缓存都是空的，首次进第一人称要编一遍着色器（RTX 4080 上约 14 秒，再编中档约 17 秒）。

## 四、场景表

一个 JSON 数组，每项一个场景；也可以写成 `{"defaults": {…}, "scenes": […]}`，`defaults` 里的字段作为每个场景的缺省值。

```json
[
  {"name": "圣禁城_黄昏_塔西缘", "site": "圣禁城", "time": {"rel": -67, "at": "set"}, "look": "看太阳"},
  {"name": "圣禁城_子夜_静滞夜幕开", "site": "圣禁城", "time": {"rel": -67, "at": "midnight"}, "look": "看月", "veil": true},
  {"name": "罪域_审判夜_黑月高悬", "site": "罪域", "time": {"rel": -65, "hour": 18, "find": "blackHigh", "plusHours": 1},
   "look": "看月", "expect": {"blackHigh": true}},
  {"name": "总览_斜看", "view": "ov", "ov": "oblique", "site": "罪域", "time": {"mark": "d1"}}
]
```

| 字段 | 说明 | 缺省 |
|---|---|---|
| `name` | 场景名，也是图的文件名（前面加两位序号）。不能重复 | 必填 |
| `view` | `fp`（第一人称）或 `ov`（总览）；也认“第一人称”“总览” | `fp` |
| `site` | 地点，见下 | `罪域` |
| `time` | 时刻，见下 | 必填 |
| `look` | 朝向，见下（只对第一人称） | 不改 |
| `fov` | 竖直视角，5–100 度 | 70 |
| `quality` | 画质档：`low` `mid` `high` `photo`，或“低”“中”“高”“拍照” | `mid` |
| `atmo` | 大气开关（`fp.atmo.on`） | 默认（开） |
| `veil` | 静滞夜幕开关（`fp.set.veil`） | 默认（关） |
| `ground` | 地面：`terrace` 阶地 或 `slope` 斜坡（也认“阶地”“斜坡”） | 默认（阶地） |
| `clouds` | 云开关（`fp.cloud.on`） | 默认（开） |
| `params` | 任意状态项，如 `{"fp.set.acid": true}`；路径必须在 `HY.store.SCHEMA` 里 | 无 |
| `eye` | 眼高（米），1.2–2 | 1.6 |
| `ui` | `clean` 只要画面，`full` 带界面 | 第一人称 `clean`，总览 `full` |
| `tab` | 侧栏页签：`site` `year` `params` `notes`（“此地”“一年”“参数”“说明”） | `site` |
| `ov` | 总览预设：`oblique` `side` `fromTop` `fromRoot` `above` `sun` `moon` `winter`（也认“斜看”“侧看”“从塔顶看帝国”“看另一端”“此地上空”） | `oblique` |
| `expect` | 自检，不合时记警告：`blackHigh`（真／假）、`moonState`（“亮月”等）、`night`（真／假）、`sunVis`（[下限, 上限]） | 无 |
| `note` | 说明，原样写进 `index.json` | 无 |
| `minFrames` | 至少跑多少帧再判断稳定 | 48 |

场景之间互不影响：每个场景开头，上面四个开关和上一个场景动过的 `params` 都先回到默认，再套用本场景写的；地点即使没变也重新落脚一次（`HY.fp.teleport`）。

### 地点 `site`

- 预设：`HY.world.SITES` 的 id、全名或简称。`zuiyu` 罪域，`yimeite` 伊美忒，`shengjin` 圣禁城，`niehe` 涅赫莱恩，`abyss` 深渊边，`equator` 赤道，`qing` 轻域，`far` 世界另一端。
- 任意一点：`{"s": 离塔根公里, "az": 方位度}`，`s` 也可以写成 `km`。

### 时刻 `time`

地方时一律按该地点的方位换算。年份缺省是第 10018 年（庆典年）。

| 写法 | 意思 |
|---|---|
| `{"rel": -66, "hour": 21}` | 第 `year` 年入冬交节起第 `rel` 个当地日的 21 时。负数是入冬前，正文的“入冬前 66 日”就是 `rel: -66` |
| `{"wd": 294, "hour": 12}` | 第 `year` 年“入冬后第 294 日”（`HY.calc.tOfWd`，按年号口径落在这一年里） |
| `{"mark": "d1"}` | `HY.world.MARKS` 的标记：`d1` `d2` `d3`（审判三夜）、`festival`（庆典夜）、`heiyao`（黑曜日之夜）、`winter` 等；可再给 `hour` |
| `"at"` | 代替 `hour`：`noon` 正午；`midnight` 当夜子夜（次日 0 时）；`dawn0`／`rise`／`dawn1` 日面在塔东缘开始露出／露出一半／全露；`dusk0`／`set`／`dusk1` 在塔西缘开始被切／切去一半／全没；也认“正午”“子夜”“黎明”“黄昏” |
| `"at": "dawn", "vis": 0.3` | 早上日面露出三成的那一刻（傍晚用 `dusk`），二分求得 |
| `"find": "blackHigh"` | 从上面算出的时刻往后找 `HY.calc.findNext` 的事件：`blackHigh` 黑月高悬开始、`litMoonNight`、`eclipse`、`festivalCross` 等 |
| `"plusHours": 1` | 最后再加几小时 |
| 一个数，或 `{"t": …}` | 绝对时刻 t（日） |

### 朝向 `look`

- 快捷：`sun`（看太阳）、`moon`（看月）、`north`（看塔根，朝北抬头到塔根端）、`south`（看塔顶）、`zenith`（天顶）、`east`、`west`。中文写法“看太阳”“看月”“看塔根”“看塔顶”“天顶”也认。
- 角度：`{"yaw": 0, "pitch": 2}`，yaw 北 0、东 90，pitch 仰为正。
- 快捷加修正：`{"preset": "sun", "pitch": 10}` 朝日的方位、仰角改成 10°；`dYaw`、`dPitch` 是在快捷的结果上加减。
- 天顶快捷不改方位，工具把方位定为 0（朝北为上），免得跟着上一个场景走。

## 五、怎样算“画面稳定”

每个第一人称场景按这个次序：

1. 套用开关与画质档，设地点、时刻，重新落脚。
2. 等这一档的着色器编完（`HY.fp.debug().compile.pending` 为假、实际档位就是要的档位），记“首帧耗时”。第一次进第一人称另记 `HY.app.view('fp')` 的耗时。
3. 设朝向；第一次进第一人称时还要等三维云噪声生成完（工具在进第一人称之前给 `HY.fp.noise.gen3D` 包了一层，只为拿到它的完成通知）。
4. 每次连跑 8 帧（`HY.app.settle`，一帧按 1/60 秒算），然后同步读一次眼 pass 的结果，看两件事：
   - 眼：适应亮度 La 与测光目标的差 |ln(La／目标)| 小于 2%；
   - TAA：拍照累积满了（`HY.fp.eye.accum().done`）。下雨或有余息飘尘时帧图不做累积，改为静止满 max(累积数, 20) 帧就算。
   连着两次都达标、并且至少跑了 48 帧，才算稳定。最多跑 1200 帧（相当于 20 秒的眼适应，变暗的时间常数是 3 秒，从任何起点都该收敛了）；到了还不稳，说明测光目标在逐帧跳，记一条“画面在闪”的警告，照样出图。
5. 放开页面自己的帧循环跑 1.5 秒量真实帧率与 GPU 用时；这 1.5 秒前后各取一次 TAA 输出 9×9 个点的亮度，算出“漂移”。p90 超过 5% 记警告（云的噪点没平均掉、或者画面在闪）。
6. 再等两帧上屏，由 node 用 DevTools 截整个窗口。

总览场景：设好地点、时刻、预设后跑 4 帧，再等 0.6 秒（图表、标签按真实时间刷新），量 1.5 秒帧率后截图。

## 六、输出

- `NN_场景名.png`：整个窗口，1440×900（或 `--size` 给的大小）。`clean` 模式下界面藏起来、画布铺满窗口；提示条一律不进图。
- `index.json`：

| 字段 | 内容 |
|---|---|
| `page` | 页面路径、URL、字节数、修改时间、`HY.BUILD`（构建时刻与哈希）、加载耗时 |
| `browser`、`gpu`、`viewport` | 浏览器版本与启动参数；WebGL 渲染器名与能力（浮点目标、GPU 计时、并行编译）；窗口大小 |
| `fp` | `fpInitMs` 首次进第一人称耗时；`tierMs` 各档第一次编译的耗时 |
| `summary` | 总数、成功、失败、带警告、没跑的 |
| `scenes[]` | 每个场景一条，见下 |

每个场景：

| 字段 | 内容 |
|---|---|
| `file`、`ok`、`error`、`warnings` | 图的文件名；成没成；失败原因；警告（没稳定、画面在闪、NaN、GL 错误、`expect` 不合、控制台报错） |
| `site`、`time` | 地点（离塔根、方位、纬度、所在域）；时刻（t、怎么算出来的、界面上的历法文字、钟点、时辰、`rel`、`wd`） |
| `look`、`quality`、`tier`、`toggles`、`params` | 实际朝向与视角、眼高；要的档与实际档；四个开关的实际值（`groundActual` 是相机实际用的地面模式，纬度小于 2° 时阶地会自动退回斜坡） |
| `sky` | 日面露出、日月的仰角与方位、月态、是否黑月高悬、是否亮月可见、是否夜、日食比例 |
| `readouts` | `lux` 水平面照度、`ev`、`eye`（明视／中间视／暗视）、`La` 与 `LaTarget`（cd/m²）、`Eeye` 到眼日照、`Edir` 直射、`expo` 曝光 |
| `perf` | `rafFps` 实测帧率、`appFps`、`cpuMs`、`gpuMs`（各 pass 之和）、`gpuTop` 最重的 6 个 pass、内部分辨率与比例 |
| `timing` | `enterMs` 进第一人称、`compileMs` 等编译、`firstFrameMs` 首帧、`settleMs`／`settleFrames` 等稳定、`measureMs`、`totalMs`、`wallMs`（毫秒） |
| `converge` | 最后一次检查的眼差、TAA 累积数、是否在下雨（不累积）、是否超时或到了帧数上限 |
| `camera` | 相机自报的所在域、纬度、阶地级数、踏面、坡度 |
| `checks` | `nan`（tHDR 上 9×9 采样里非有限数的个数、亮度范围）、`drift`（漂移的中位数／p90／最大值）、GL 错误、帧图报错、上下文丢失次数 |
| `console` | 这个场景期间控制台的报错与告警；HLSL X4000 告警只计数 |

帧率说明：无头浏览器不受显示器刷新率限制，`rafFps` 在快机器上约 155，主要看 `gpuMs`。

## 七、标准场景集 `scenes_std.json`

36 个场景。日期统一取第 10018 年（庆典年）入冬前 67 日，即入冬后第 294 日、审判 D1 那一天（夏第 114 日，亮月）；`黑月高悬` 取入冬前 66、65 日的夜里，`庆典之夜` 取入冬前夜 21 时。第一人称默认中档、视角 70°、眼高 1.6 米、只要画面。

| 组 | 场景 |
|---|---|
| 总览（带界面） | 斜看、侧看、从塔顶看帝国、一年页 |
| 罪域 | 正午朝日、黎明塔东缘、黄昏塔西缘、子夜看月、审判夜黑月高悬、审判夜带界面、正午朝北阶地、正午关云、正午酸霾 |
| 伊美忒 | 正午平视地平线、黎明塔东缘、黄昏塔西缘、子夜看月、庆典之夜仰望天顶 |
| 圣禁城 | 正午朝日、黎明、黄昏、子夜白夜、子夜静滞夜幕开、正午大气关、正午朝北阶地、正午朝北斜坡、正午朝南看塔、正午看塔根、正午仰望天顶、审判夜黑月高悬 |
| 赤道深渊 | 深渊边朝南望深渊、赤道沟底朝东 |
| 世界另一端 | 正午朝日、子夜看塔顶 |
| 画质档 | 伊美忒黄昏 低档、高档（中档即上面那张） |

基线在 `test/shots/baseline/`（构建 4f0f2e9d，RTX 4080，Chrome 154）。改了渲染之后：

```
node test/shoot.js --std --out test/shots/改后 --clean
```

再拿两个目录里同名的图和 `index.json` 的读数对照。同一台机器上连跑两次，36 个场景里 33 个的照度相差不到 1%、EV 相差不到 0.02；另外三个见下一节。

## 八、已知的局限

- 下雨、余息飘尘时帧图本来就不做拍照累积，这类场景（罪域全部、庆典夜）的图带着雨丝或飘尘，`converge.falling` 为真。
- 赤道沟底那个场景云在逐帧闪，眼收敛不了，读数每次都不一样；伊美忒黄昏的低档、高档两张，换档之后的水平面照度两次运行相差两三成（EV 一样）。这三处是渲染本身的问题，不是工具的。
- 截的是窗口，不是累积后的高精度 HDR。要无界面的单张高质量图，可以在页面里用 `HY.fp.eye.shoot()`。
- 只在 RTX 4080 上跑过。集显上首次编译会更久，必要时加大 `--settle`。

## 九、临时诊断脚本

`shoot.js` 导出了启动与连接的函数，临时脚本可以直接用：

```js
const S = require('./test/shoot.js');
const o = S.parseArgs([]);
const b = await S.launch(o, S.findBrowser(o));            // 随机端口、独立用户目录
const cdp = new S.CDP(b.page.webSocketDebuggerUrl);
await cdp.open();
await cdp.send('Page.navigate', { url: require('url').pathToFileURL(S.PAGE_DEFAULT).href });
// 等 HY.ov.status().phase === 'ready' 之后：
await cdp.eval('(' + S.pageMain.toString() + ')(' + S.shootLib.toString() + ')');
const rec = await cdp.eval('window.__shoot.run(' + JSON.stringify(场景) + ', {}, {})', 400000);
await S.shutdown(b, cdp, false);                         // 关浏览器、删用户目录
```
