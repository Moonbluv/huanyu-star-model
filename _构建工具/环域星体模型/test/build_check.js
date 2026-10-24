#!/usr/bin/env node
/* build_check —— 读构建产物，把 spec/03 第十节第 3 条的检查独立再做一遍（负责：M1／构建）
 * 产物取默认输出 🗺️ 互动地图/环域星体模型.html；它不存在或比 src/ 旧时，先用 py build.py --out 临时文件 现建一份。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const load = require('./_load.js');
const T = load.tester('build_check');
const { ok, eq, section } = T;

const ROOT = load.ROOT, SRC = load.SRC;
const DEFAULT_OUT = path.resolve(ROOT, '..', '..', '环域星体模型.html');
const m = load.manifest();

function newest(dir) {
  let t = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    t = Math.max(t, f.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
let file = DEFAULT_OUT;
if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < newest(SRC) || !/HY\.BUILD/.test(fs.readFileSync(file, 'utf8'))) {
  file = path.join(os.tmpdir(), 'hy_build_check.html');
  const py = process.platform === 'win32' ? 'py' : 'python3';
  const r = spawnSync(py, [path.join(ROOT, 'build.py'), '--out', file], { cwd: ROOT, encoding: 'utf8' });
  ok(r.status === 0, '现建产物：py build.py --out 临时文件' + (r.status ? '\n' + (r.stdout || '') + (r.stderr || '') : ''));
  if (r.status !== 0) T.done();
}
console.log('  产物：' + file);
const raw = fs.readFileSync(file);
const html = raw.toString('utf8');
const low = html.toLowerCase();

section('1 骨架与编码');
ok(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), 'UTF-8 无 BOM');
ok(!/\r\n/.test(html), 'LF 换行');
eq(html.split('\n', 1)[0], '<meta charset="utf-8">', '第一行是 <meta charset="utf-8">');
for (const tag of ['<!doctype', '<html', '<head', '<body']) ok(!new RegExp(tag.replace('!', '!') + '[\\s>/]').test(low), `没有 ${tag}`);
eq((html.match(/<title>环域星体模型<\/title>/g) || []).length, 1, '恰有一个 <title>环域星体模型</title>');
eq((low.match(/<title/g) || []).length, 1, '只有一个 title');

section('2 外部依赖与运行时取资源');
const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]*)"/gi)].map(x => x[1]);
ok(JSON.stringify(srcs) === JSON.stringify(m.cdn), '<script src> 恰为 manifest.cdn 两条：' + srcs.join('，'));
ok(m.cdn.every(u => /three\.js\/r128\/|three@0\.128\.0\//.test(u)), 'three 锁定 r128');
for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
  const h = /href\s*=\s*"https:\/\/([^/"?#]+)/.exec(tag);
  ok(h && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(h[1]), '<link> 只指向 Google Fonts：' + tag);
  if (/stylesheet/.test(tag)) ok(h && h[1] === 'fonts.googleapis.com', '样式表只来自 fonts.googleapis.com');
}
const hosts = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
for (const u of html.match(/https?:\/\/[^\s"'<>)\\]+/g) || []) {
  if (u.startsWith('http://www.w3.org/')) continue;
  const h = /^https:\/\/([^/:]+)/.exec(u);
  ok(h && hosts.has(h[1]), '网址主机在白名单里：' + u.slice(0, 100));
}
// 内联脚本
const inline = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(x => x[1]);
ok(inline.length >= m.scripts.length, `内联脚本 ${inline.length} 段（manifest ${m.scripts.length} 项）`);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
for (const code of inline) {
  const name = (/^\/\* (.*?) \*\//.exec(code) || [])[1] || '(无名)';
  try { new vm.Script(code, { filename: name }); ok(true, ''); } catch (e) { ok(false, `${name} 解析失败：${e.message}`); }
  const body = strip(code);
  for (const [rx, label] of [[/\bfetch\s*\(/, 'fetch('], [/XMLHttpRequest/, 'XMLHttpRequest'], [/importScripts/, 'importScripts'],
    [/new\s+Worker\s*\(/, 'new Worker('], [/document\.write/, 'document.write'], [/^\s*(import|export)\s/m, '行首 import/export']]) {
    if (name.indexOf('HY.glsl') >= 0) continue;
    ok(!rx.test(body), `${name} 里没有 ${label}`);
  }
}
ok(!/<\/script/i.test(inline.join('\n')), '内联脚本里没有未转义的 </script');
const style = (/<style>\n([\s\S]*?)\n<\/style>/.exec(html) || [])[1] || '';
ok(style.length > 1000 && !/<\/style/i.test(style), '样式内联且没有 </style');

section('3 HY.glsl 与 src/glsl/ 一致；HY.BUILD');
{
  const g = inline.find(c => /HY\.glsl = \{/.test(c));
  ok(!!g, '有 HY.glsl 段');
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(g, ctx);
  const keys = Object.keys(ctx.HY.glsl).sort(), want = Object.keys(load.readGlsl()).sort();
  ok(JSON.stringify(keys) === JSON.stringify(want), `HY.glsl 键集合（${keys.length}）＝ src/glsl/ 文件集合（${want.length}）`);
  const src = load.readGlsl();
  ok(keys.every(k => ctx.HY.glsl[k] === src[k]), 'HY.glsl 内容与源文件逐字一致');
  ok(ctx.HY.BUILD && /^[0-9a-f]{8}$/.test(ctx.HY.BUILD.hash) && typeof ctx.HY.BUILD.dev === 'boolean', 'HY.BUILD {time, hash, dev}');
}

section('4 完整与体积');
{
  const listed = new Set(m.scripts.filter(e => e.src).map(e => e.src));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]);
  for (const f of walk(SRC).filter(f => f.endsWith('.js'))) {
    const rel = path.relative(SRC, f).replace(/\\/g, '/');
    ok(listed.has(rel), `src/${rel} 在 manifest 里`);
    ok(html.includes('/* src/' + rel + ' */'), `src/${rel} 进了产物`);
  }
  for (const e of m.scripts.filter(e => e.src)) ok(fs.existsSync(path.join(SRC, e.src)), `manifest 列的 src/${e.src} 存在`);
  const size = raw.length;
  ok(size < 16 * 1024 * 1024, `体积 ${size.toLocaleString()} 字节 < 16 MB`);
  if (size > 1024 * 1024) console.log('  ! 告警：超过 1 MB');
  const order = [...html.matchAll(/\/\* src\/([^ ]+?) \*\//g)].map(x => x[1]);
  const want = m.scripts.filter(e => e.src).map(e => e.src);
  ok(JSON.stringify(order) === JSON.stringify(want), '脚本顺序与 manifest 一致');
}

T.done();
