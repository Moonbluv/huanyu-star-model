// 把 proto.html 里的本地 <script src> 内联，得到可单文件打开的 proto_inline.html
const fs = require('fs'), path = require('path');
const dir = __dirname;
let html = fs.readFileSync(path.join(dir, 'proto.html'), 'utf8');
html = html.replace(/<script src="(glsl_[a-z_]+\.js)"><\/script>/g, (m, f) => '<script>\n' + fs.readFileSync(path.join(dir, f), 'utf8').replace(/<\/script/gi, '<\/script') + '\n</script>');
fs.writeFileSync(path.join(dir, 'proto_inline.html'), html);
console.log('ok', html.length);
