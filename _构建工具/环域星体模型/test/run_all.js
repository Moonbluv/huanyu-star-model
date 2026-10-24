#!/usr/bin/env node
/* test/run_all.js —— node 自检入口（规格：spec/03 第十一节第 1 条）
 *
 *   node test/run_all.js              跑 test/ 下全部测试（每个文件一个独立进程）
 *   node test/run_all.js store calc   只跑文件名含这些词的
 *   node test/run_all.js -v           成功的也打印完整输出
 *
 * 收录规则：test/*.js，去掉 _load.js、run_all.js 与浏览器用的 render_*.js。任何一个失败，以 1 退出。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const filters = args.filter(a => !a.startsWith('-'));
const SKIP = new Set(['_load.js', 'run_all.js']);

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.js') && !SKIP.has(f) && !/^render_/.test(f))
  .filter(f => !filters.length || filters.some(k => f.includes(k)))
  .sort((a, b) => (a === 'astro_check.js' ? -1 : b === 'astro_check.js' ? 1 : a.localeCompare(b)));

const t0 = Date.now();
const rows = [];
let failed = 0;
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { cwd: path.join(DIR, '..'), encoding: 'utf8', timeout: 120000 });
  const ms = Date.now() - t, out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && !r.error;
  if (!ok) failed++;
  rows.push({ f, ok, ms });
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${f.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(5)} 秒${r.error ? '（' + r.error.code + '）' : ''}`);
  if (!ok || verbose) {
    const lines = out.trimEnd().split('\n');
    const tail = ok ? lines : lines.slice(-40);
    console.log(tail.map(s => '    ' + s).join('\n'));
  }
}
const total = (Date.now() - t0) / 1000;
console.log(`\n共 ${files.length} 个测试，失败 ${failed} 个，总用时 ${total.toFixed(1)} 秒${total > 60 ? '（超过 60 秒预算）' : ''}`);
process.exit(failed ? 1 : 0);
