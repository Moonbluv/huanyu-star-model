// 把 glsl/ 下的着色器内联进试验台：node build.js → harness.html
const fs = require('fs'), path = require('path');
const dir = __dirname, g = f => fs.readFileSync(path.join(dir, 'glsl', f), 'utf8');
let html = fs.readFileSync(path.join(dir, 'harness.src.html'), 'utf8');
const map = { COMMON: 'common.glsl', MAIN: 'main.frag', PROBE: 'probe.frag', MSLUT: 'mslut.frag', POST: 'post.frag' };
for (const [k, f] of Object.entries(map)) html = html.replace('/*' + k + '*/', () => g(f));
fs.writeFileSync(path.join(dir, 'harness.html'), html);
console.log('harness.html', html.length, 'bytes');
