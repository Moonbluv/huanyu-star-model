/* test/_load.js —— node 测试加载器（规格：spec/03 第十一节第 1 条）
 *
 *   const HY = require('./_load.js')();                 // 载入 manifest 里全部 node: true 的脚本 ＋ HY.glsl
 *   const HY = require('./_load.js')({ upto: 'core/store.js' });   // 只载到某个文件为止（含）
 *   const HY = require('./_load.js')({ only: ['astro.js', 'core/util.js'] });
 *
 * 脚本按 src/manifest.json 的顺序用 vm.runInThisContext 载入同一个全局（与浏览器里的经典脚本一致），
 * 所以每个测试文件应在自己的进程里跑（run_all.js 就是这样做的）。
 * HY.glsl 的键规则与 build.py 一致：文件名去扩展名；.vert 另加 _vert 后缀。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
}

function glslKey(name) {
  const ext = path.extname(name), stem = name.slice(0, -ext.length);
  return ext === '.vert' ? stem + '_vert' : stem;
}

function readGlsl() {
  const dir = path.join(SRC, 'glsl'), out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.(glsl|frag|vert)$/.test(f)) continue;
    out[glslKey(f)] = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n');
  }
  return out;
}

let loaded = null;
function load(opts) {
  opts = opts || {};
  if (loaded && !opts.force) return globalThis.HY;
  const m = manifest();
  const list = [];
  for (const e of m.scripts) {
    if (e.glsl) { list.push({ glsl: true }); continue; }
    if (!e.node) continue;
    if (opts.only && opts.only.indexOf(e.src) < 0) continue;
    list.push({ src: e.src });
    if (opts.upto && e.src === opts.upto) break;
  }
  for (const it of list) {
    if (it.glsl) {
      if (opts.glsl === false) continue;
      const HY = globalThis.HY = globalThis.HY || {};
      HY.glsl = readGlsl();
      HY.BUILD = { time: new Date().toISOString(), hash: 'node', dev: true };
      continue;
    }
    const file = path.join(SRC, it.src);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInThisContext(code, { filename: file });
  }
  loaded = list.map(x => x.src || '(glsl)');
  return globalThis.HY;
}

load.manifest = manifest;
load.glslKey = glslKey;
load.readGlsl = readGlsl;
load.ROOT = ROOT;
load.SRC = SRC;
load.loaded = () => loaded;

/* 小断言库：所有 *_check.js 共用 */
load.tester = function (title) {
  let fails = 0, passes = 0;
  const t0 = Date.now();
  function ok(cond, msg) {
    if (cond) { passes++; return true; }
    fails++; console.log('  ✗ ' + msg); return false;
  }
  function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, msg + `（得 ${a}，应为 ${b}±${tol}）`); }
  function eq(a, b, msg) { return ok(a === b, msg + `（得 ${JSON.stringify(a)}，应为 ${JSON.stringify(b)}）`); }
  function throws(fn, msg) { try { fn(); } catch (e) { return ok(true, msg); } return ok(false, msg + '（没有抛错）'); }
  function section(s) { console.log('【' + s + '】'); }
  function done() {
    console.log(`${title}：通过 ${passes}，失败 ${fails}，用时 ${((Date.now() - t0) / 1000).toFixed(2)} 秒`);
    process.exit(fails ? 1 : 0);
  }
  return { ok, near, eq, throws, section, done, get fails() { return fails; } };
};

module.exports = load;
