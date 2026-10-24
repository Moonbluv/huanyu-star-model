#!/usr/bin/env node
/* test/fp_ctl_check.js —— 第一人称输入（HY.fp.ctl）自检：用假的 window／document／canvas 驱动（负责：G 路）
 * 规格：spec/02 第十七节第 1 条、spec/03 第七节第 2 条、第九节第 7 条。
 *   键盘：WASD／方向键、Shift 跑、R 骑马、T 望远（开关）、3–9 朝向快捷；输入框里、带 Ctrl／⌘／Alt、不在第一人称时都不响应
 *   鼠标：拖动转头（画面跟手）、单击锁定指针、锁定后按 movementX/Y 转头、Esc 解锁、锁定被拒后拖动照常；滚轮凝视
 *   触屏：左下摇杆（死区、推满自动跑）、右侧拖动转头、两指捏合凝视
 *   接口：set／toggle／setMove／state／hint；attach 设 touch-action、detach 全部撤掉；input() 取走即清零
 *   接上相机：按住 W 一秒，相机走 1.4 m
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const load = require('./_load.js');
const HY = load();
vm.runInThisContext(fs.readFileSync(path.join(load.SRC, 'fp/controls.js'), 'utf8'), { filename: 'fp/controls.js' });
const T = load.tester('fp_ctl_check');
const { near, section } = T;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); return T.ok(c, m); };
console.warn = () => {};
const C = HY.fp.ctl, K = HY.fp.cam;
HY.model.rebuildP();

/* ───────── 假 DOM ───────── */
class Tgt {
  constructor() { this.l = {}; }
  addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
  removeEventListener(t, f) { const a = this.l[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  fire(t, e) { e = e || {}; e.type = t; let pd = false; e.preventDefault = () => { pd = true; }; (this.l[t] || []).slice().forEach(f => f(e)); return pd; }
  count() { return Object.values(this.l).reduce((n, a) => n + a.length, 0); }
}
const win = new Tgt(), doc = new Tgt(), cv = new Tgt();
doc.defaultView = win; doc.pointerLockElement = null;
let lockAllowed = true, lockCalls = 0;
doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange'); };
cv.ownerDocument = doc; cv.style = { touchAction: 'auto' };
cv.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
cv.setPointerCapture = () => {};
cv.requestPointerLock = () => { lockCalls++; if (lockAllowed) { doc.pointerLockElement = cv; doc.fire('pointerlockchange'); } else doc.fire('pointerlockerror'); };
const key = (code, extra) => Object.assign({ code, key: code.replace(/^(Key|Digit)/, '').toLowerCase(), target: { tagName: 'CANVAS' }, shiftKey: false, repeat: false }, extra || {});
const ptr = (type, id, x, y, extra) => Object.assign({ pointerType: type, pointerId: id, clientX: x, clientY: y, button: 0, movementX: 0, movementY: 0 }, extra || {});

HY.store.set('view.mode', 'fp', 'api');
const cam = K.create(HY.model.P, HY.state.site, HY.state.fp);    // HY.fp.cam.current：转头灵敏度按它的视角

section('1 挂上、撤下');
{
  C.attach(cv);
  ok(C.attached() && cv.style.touchAction === 'none', 'attach：画布 touch-action 设成 none（触屏拖动不滚页面）');
  ok(win.count() >= 3 && cv.count() >= 7 && doc.count() >= 2, `监听挂在 window（${win.count()}）、canvas（${cv.count()}）、document（${doc.count()}）上`);
  const z = C.input();
  ok(z.fwd === 0 && z.right === 0 && z.dYaw === 0 && z.zoom === 0 && z.run === false, '初始输入为零');
}

section('2 键盘');
{
  win.fire('keydown', key('KeyW'));
  let i = C.input();
  ok(i.fwd === 1 && i.right === 0, 'W：前进');
  win.fire('keydown', key('KeyA'));
  i = C.input();
  ok(i.fwd === 1 && i.right === -1, 'W＋A：前进＋左移');
  win.fire('keyup', key('KeyW')); win.fire('keyup', key('KeyA'));
  ok(C.input().fwd === 0, '松开归零');
  const pd = win.fire('keydown', key('ArrowDown'));
  ok(C.input().fwd === -1 && pd, '方向键↓：后退，并拦下默认（不滚页面）');
  win.fire('keyup', key('ArrowDown'));
  win.fire('keydown', key('ShiftLeft', { shiftKey: true }));
  ok(C.input().run === true, 'Shift 按住：跑');
  win.fire('keyup', key('ShiftLeft', { shiftKey: false }));
  ok(C.input().run === false, '松开 Shift：不跑');
  win.fire('keydown', key('KeyR'));
  ok(C.input().ride === true, 'R：骑马（开）');
  win.fire('keydown', key('KeyR', { repeat: true }));
  ok(C.input().ride === true, '按住不放的自动重复不再切换');
  win.fire('keydown', key('KeyR'));
  ok(C.input().ride === false, '再按 R：下马');
  win.fire('keydown', key('KeyT'));
  ok(C.input().tele === true, 'T：望远（开）');
  win.fire('keydown', key('KeyT'));
  ok(C.input().tele === false, '再按 T：收起');
  win.fire('keydown', key('KeyW', { target: { tagName: 'INPUT' } }));
  ok(C.input().fwd === 0, '焦点在输入框里：不响应');
  win.fire('keydown', key('KeyW', { target: { tagName: 'DIV', isContentEditable: true } }));
  ok(C.input().fwd === 0, '焦点在可编辑区里：不响应');
  win.fire('keydown', key('KeyW', { ctrlKey: true }));
  ok(C.input().fwd === 0, 'Ctrl＋W：不拦（留给浏览器）');
  HY.store.set('view.mode', 'ov', 'api');
  win.fire('keydown', key('KeyW'));
  ok(C.input().fwd === 0, '不在第一人称：不响应');
  HY.store.set('view.mode', 'fp', 'api');
  // 朝向快捷：3＝北·塔根（第一人称还没就绪时直接写状态）
  HY.store.set('fp.yaw', 77, 'api');
  win.fire('keydown', key('Digit3', { key: '3' }));
  const tv = HY.astro.towerView(cam.observer(), HY.model.P);
  ok(HY.state.fp.yaw === 0 && Math.abs(HY.state.fp.pitch - tv.rootEl) < 0.06, `3：北·塔根（yaw 0，pitch ${HY.state.fp.pitch}）`);
  win.fire('keydown', key('Numpad7', { key: '7' }));
  ok(HY.state.fp.pitch === 89, '小键盘 7：天顶');
  win.fire('keydown', key('Digit4', { key: '$' }));      // 别的键盘布局：按 code 认
  ok(HY.state.fp.yaw === 90 && HY.state.fp.pitch === 0, '4（按 code 认，不看 key）：东');
  win.fire('keydown', key('KeyD')); win.fire('blur');
  ok(C.input().right === 0, '窗口失焦：清掉按住的键');
}

section('3 鼠标');
{
  const fov = cam.look().fovEff;
  cv.fire('pointerdown', ptr('mouse', 1, 100, 100));
  cv.fire('pointermove', ptr('mouse', 1, 180, 70));
  let i = C.input();
  near(i.dYaw, -80 * fov / 600, 1e-9, '拖动：手往右 80 像素，视线往左转 80×视角/画布高');
  near(i.dPitch, -30 * fov / 600, 1e-9, '拖动：手往上 30 像素，视线往下（画面跟手）');
  cv.fire('pointerup', ptr('mouse', 1, 180, 70));
  ok(lockCalls === 0 && !C.state().locked, '拖动过的抬起：不锁指针');
  cv.fire('pointerdown', ptr('mouse', 2, 300, 300));
  cv.fire('pointerup', ptr('mouse', 2, 302, 301));
  ok(lockCalls === 1 && C.state().locked, '单击（移动 ≤5 像素）：锁定指针');
  cv.fire('pointermove', ptr('mouse', 2, 0, 0, { movementX: 10, movementY: -4 }));
  i = C.input();
  near(i.dYaw, 10 * 0.11 * fov / 55, 1e-9, '锁定后：鼠标右移 10 → 右转 1.1°（按视角缩放）');
  near(i.dPitch, 4 * 0.11 * fov / 55, 1e-9, '锁定后：鼠标上移 → 抬头');
  win.fire('keydown', key('Escape'));
  ok(!C.state().locked, 'Esc：解锁');
  // 偶尔被拒一次（Chrome：Esc 退出后约 1 秒内再请求会被拒）：下次单击照样能锁上，计数清零
  const click = id => { cv.fire('pointerdown', ptr('mouse', id, 300, 300)); cv.fire('pointerup', ptr('mouse', id, 300, 300)); };
  lockAllowed = false;
  click(30);
  ok(!C.state().locked && C.state().canLock === true && lockCalls === 2, '被拒一次：没锁上，但还可以再试');
  lockAllowed = true;
  click(31);
  ok(C.state().locked && lockCalls === 3, '被拒一次之后再单击：锁上了（不因一次被拒就整个会话锁不上）');
  win.fire('keydown', key('Escape'));
  // 新浏览器：同一次被拒既发 pointerlockerror 又拒绝 Promise，只记一次
  {
    const saved = cv.requestPointerLock;
    let rejects = 0;
    cv.requestPointerLock = () => { lockCalls++; doc.fire('pointerlockerror'); return { then: (ok1, bad) => { rejects++; bad(new Error('拒绝')); } }; };
    click(32); click(33);
    ok(rejects === 2 && C.state().canLock === true, '事件＋Promise 双重报错：两次单击只算两次被拒（还没到三次）');
    cv.requestPointerLock = () => { lockCalls++; throw new Error('不支持'); };
    click(34);
    ok(C.state().canLock === false, '再被拒一次（同步抛错也算）：连续三次，canLock 变假');
    cv.requestPointerLock = saved;
  }
  // 连续被拒三次（iframe 没给权限）：之后不再尝试，拖动照常
  const calls0 = lockCalls;
  click(35);
  ok(lockCalls === calls0 && !C.state().locked, '连续被拒三次之后，单击不再请求锁定');
  cv.fire('pointerdown', ptr('mouse', 5, 300, 300)); cv.fire('pointermove', ptr('mouse', 5, 330, 300)); cv.fire('pointerup', ptr('mouse', 5, 330, 300));
  ok(C.input().dYaw < 0, '被拒之后拖动转头照常');
  ok(/拖动/.test(C.hint()), `提示：“${C.hint()}”`);
  // 右键不拖
  cv.fire('pointerdown', ptr('mouse', 6, 300, 300, { button: 2 })); cv.fire('pointermove', ptr('mouse', 6, 400, 300));
  ok(C.input().dYaw === 0, '右键按下拖动：不转头');
  ok(cv.fire('contextmenu', {}) === true, '画面上的右键菜单被拦下');
  // 滚轮
  let pd = cv.fire('wheel', { deltaY: -100, deltaMode: 0 });
  near(C.input().zoom, 1, 1e-12, '滚轮向上 100 像素：凝视一格（zoom＋1）');
  ok(pd, '滚轮拦下默认（不滚页面）');
  cv.fire('wheel', { deltaY: 3, deltaMode: 1 });
  near(C.input().zoom, -0.99, 1e-12, '按行滚动的鼠标（3 行）：约一格');
}

section('4 触屏');
{
  // 左下摇杆：画布左 45%、上沿 40% 以下（画布在页面 (10,20) 处，800×600）
  const pd = cv.fire('pointerdown', ptr('touch', 11, 110, 520));
  ok(pd && C.state().joy && C.state().joy.cx === 100 && C.state().joy.cy === 500, '左下按下：出摇杆（中心＝按下点，画布内坐标），拦下默认');
  cv.fire('pointermove', ptr('touch', 11, 110, 516));
  ok(C.input().fwd === 0, '死区内（推 4 像素）不动');
  cv.fire('pointermove', ptr('touch', 11, 110, 464));
  let i = C.input();
  near(i.fwd, 1, 1e-12, '推满（56 像素）往上：前进 1');
  ok(i.run === true, '推满：自动跑');
  cv.fire('pointermove', ptr('touch', 11, 110 + 28, 520));
  i = C.input();
  near(i.right, (0.5 - 0.12) / 0.88, 1e-12, '往右推一半：右移 0.43（扣掉死区）');
  ok(i.run === false && Math.abs(i.fwd) < 1e-12, '推一半：不跑、不前进');
  // 右侧拖动转头（摇杆同时按着）
  cv.fire('pointerdown', ptr('touch', 12, 610, 300));
  cv.fire('pointermove', ptr('touch', 12, 660, 300));
  const fov = cam.look().fovEff;
  i = C.input();
  near(i.dYaw, -50 * fov / 600, 1e-9, '右侧单指拖动：转头（摇杆同时在推）');
  ok(i.right > 0.4, '转头时摇杆照常');
  // 两指捏合
  cv.fire('pointerdown', ptr('touch', 13, 710, 300));       // 两指相距 50
  cv.fire('pointermove', ptr('touch', 13, 760, 300));       // 相距 100
  i = C.input();
  near(i.zoom, 2, 1e-12, '两指距离翻一倍：凝视两格');
  ok(i.dYaw === 0, '两指时不转头');
  cv.fire('pointerup', ptr('touch', 13, 760, 300));
  cv.fire('pointermove', ptr('touch', 12, 640, 300));
  ok(C.input().dYaw > 0, '松开一指：剩下那一指继续转头');
  cv.fire('pointerup', ptr('touch', 12, 640, 300));
  cv.fire('pointercancel', ptr('touch', 11, 0, 0));
  ok(C.state().joy === null && C.input().right === 0, '摇杆抬起（取消）：停');
  // 摇杆区以外按下：不出摇杆
  cv.fire('pointerdown', ptr('touch', 14, 700, 520));
  ok(C.state().joy === null, '右下按下：不出摇杆（是转头）');
  cv.fire('pointerup', ptr('touch', 14, 700, 520));
}

section('5 开关与外部摇杆');
{
  C.toggle('run');
  ok(C.state().run && C.input().run, 'toggle(\'run\')：触屏“跑”按钮');
  C.set('run', false); C.set('ride', true);
  ok(!C.input().run && C.input().ride, 'set(\'ride\', true)');
  C.set('ride', false);
  C.setMove(0.5, -0.25);
  let i = C.input();
  ok(i.fwd === 0.5 && i.right === -0.25 && C.state().moving, 'setMove：HUD 自己画的摇杆喂进来');
  C.setMove(0, 0);
  ok(C.input().fwd === 0 && !C.state().moving, 'setMove(0, 0)：松开');
  C.addLook(3, -2); C.addZoom(1);
  i = C.input();
  ok(i.dYaw === 3 && i.dPitch === -2 && i.zoom === 1, 'addLook／addZoom 累计');
  i = C.input();
  ok(i.dYaw === 0 && i.zoom === 0, 'input() 取走即清零');
  ok(C.KEY_HELP.length >= 6, '键位说明表');
}

section('6 接上相机');
{
  const P = HY.model.P;
  const c2 = K.create(P, { s: 6670, az: -4 }, { eye: 1.6, yaw: 90, pitch: 0, fov: 55, bob: false, ground: { mode: 'slope', W: 1.5, cliff: 0.07, resid: 0, wig: 0.35, jit: 0.07, amp: 0, abyssDepth: 30, abyssHalf: 220 } });
  win.fire('keydown', key('KeyW'));
  let d = 0;
  for (let i = 0; i < 60; i++) d += c2.step(1 / 60, C.input()).dist;
  win.fire('keyup', key('KeyW'));
  near(d * 1000, 1.4, 1e-9, '按住 W 一秒：相机走 1.4 m');
  cv.fire('pointerdown', ptr('mouse', 21, 400, 300)); cv.fire('pointermove', ptr('mouse', 21, 400 - 600 / 55 * 10, 300)); cv.fire('pointerup', ptr('mouse', 21, 0, 0));
  c2.step(1 / 60, C.input());
  near(c2.look().yaw, 100, 1e-9, '往左拖 10° 对应的像素：相机右转 10°（画面跟手）');
  win.fire('keydown', key('KeyT'));
  for (let i = 0; i < 60; i++) c2.step(1 / 60, C.input());
  ok(c2.look().fovEff < 5.5, `T：望远，视角 ${c2.look().fovEff.toFixed(2)}°`);
  win.fire('keydown', key('KeyT'));
}

section('7 撤下');
{
  C.set('ride', true);
  C.detach();
  ok(!C.attached() && cv.style.touchAction === 'auto', 'detach：touch-action 还原');
  ok(win.count() === 0 && cv.count() === 0 && doc.count() === 0, '监听全部撤掉');
  win.fire('keydown', key('KeyW'));
  ok(C.input().fwd === 0, '撤下后按键无效');
  ok(C.input().ride === true, '“骑马”是开关，撤下再挂上时保持');
  C.attach(cv); C.attach(cv);
  ok(cv.count() === 7, '重复 attach 同一块画布不重复挂监听');
  ok(C.state().canLock === false, '锁定连续被拒的记录撤下再挂上时保留（iframe 不给权限时不必每次进来再试三回）');
  C.detach();
}

T.done();
