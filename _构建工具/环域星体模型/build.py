# -*- coding: utf-8 -*-
"""环域星体模型 v3 构建脚本（规格：spec/03_应用结构.md 第十节）。

    py build.py                 构建 → ../../环域星体模型.html（🗺️ 互动地图/环域星体模型.html）
    py build.py --out PATH      写到别处
    py build.py --check         只做检查，不写文件
    py build.py --harness       另外生成 test/render_checks.html（同一份代码＋manifest.harness 里的脚本）
    py build.py --test          构建后跑 node test/run_all.js
    py build.py --dev           HY.DEV＝真、HY.BUILD.dev＝真（渲染器保留着色器报错检查）
    py build.py --extract-glsl  从 spec/02 的 ```glsl 代码块抽出 src/glsl/*（只写不存在的文件），然后退出

脚本顺序与外部依赖只写在 src/manifest.json（test/_load.js 也读它）。
HY.glsl 的键：文件名去扩展名；.vert 文件另加 _vert 后缀（inst.vert → inst_vert，inst.frag → inst）。
任何一项检查失败：非零退出、不写文件。
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / 'src'
GLSL_DIR = SRC / 'glsl'
TEST = HERE / 'test'
SPEC02 = HERE / 'spec' / '02_第一人称渲染.md'
DEFAULT_OUT = Path(__file__).resolve().parents[2] / '环域星体模型.html'
HARNESS_OUT = TEST / 'render_checks.html'

# src/ 下允许不进 manifest 的 .js（相对 src/ 的路径）
IGNORE_JS = set()
GLSL_EXT = ('.glsl', '.frag', '.vert')
SIZE_HARD = 16 * 1024 * 1024
SIZE_WARN = 1024 * 1024

ALLOWED_HOSTS = {'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'}
ALLOWED_URL_PREFIX = ('http://www.w3.org/',)
FORBIDDEN = [
    (re.compile(r'\bfetch\s*\('), 'fetch('),
    (re.compile(r'XMLHttpRequest'), 'XMLHttpRequest'),
    (re.compile(r'importScripts'), 'importScripts'),
    (re.compile(r'new\s+Worker\s*\('), 'new Worker('),
    (re.compile(r'(?<![\w.$])import\s*\('), 'import('),
    (re.compile(r'document\.write'), 'document.write'),
    (re.compile(r'^\s*import\s', re.M), '行首 import'),
    (re.compile(r'^\s*export\s', re.M), '行首 export'),
]

# --extract-glsl：02 的代码块按“第一行”认领文件；同名的按出现顺序合并
EXTRACT_RULES = [
    ('// ======================= common.glsl', 'common.glsl'),
    ('// lut_tau.frag', 'lut_tau.frag'),
    ('// lut_ms.frag', 'lut_ms.frag'),
    ('// lut_sky.frag', 'lut_sky.frag'),
    ('// air.glsl', 'air.glsl'),
    ('// 视线 X→太阳', 'sheath.glsl'),
    ('// foot.frag', 'foot.frag'),
    ('// terrain_lib.glsl', 'terrain_lib.glsl'),
    ('// terrain_coarse.frag', 'terrain_coarse.frag'),
    ('// terrain.frag', 'terrain.frag'),
    ('// gen_height.frag', 'gen_height.frag'),
    ('// horizon.frag', 'horizon.frag'),
    ('// 查用（terrain.frag', 'shadow.glsl'),
    ('float cloudShadowT(', 'shadow.glsl'),
    ('// shade_terrain.glsl', 'shade_terrain.glsl'),
    ('// shade_wall.glsl', 'shade_wall.glsl'),
    ('// bake_weather.frag', 'bake_weather.frag'),
    ('// clouds.glsl', 'clouds.glsl'),
    ('// 拼在 common＋terrain_lib＋clouds 之后', 'cloud_shadow.frag'),
    ('// moon.glsl', 'moon.glsl'),
    ('// near.frag', 'near.frag'),
    ('// far.frag', 'far.frag'),
    ('// composite.frag', 'composite.frag'),
    ('// probe.frag', 'probe.frag'),
    ('// sh.frag', 'sh.frag'),
    ('// taa.frag', 'taa.frag'),
    ('// final.frag', 'final.frag'),
]


class BuildError(Exception):
    pass


def rd(p):
    return Path(p).read_text(encoding='utf-8')


def wr(p, text):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def norm_nl(s):
    return s.replace('\r\n', '\n').replace('\r', '\n')


def glsl_key(name):
    stem, ext = os.path.splitext(name)
    return stem + '_vert' if ext == '.vert' else stem


# ───────────────────────── 抽取 GLSL ─────────────────────────
def extract_glsl():
    text = norm_nl(rd(SPEC02))
    blocks = re.findall(r'^```glsl\n(.*?)^```', text, re.S | re.M)
    if not blocks:
        raise BuildError('spec/02 里没有找到 ```glsl 代码块')
    files, unmatched = {}, []
    for b in blocks:
        first = b.split('\n', 1)[0].strip()
        for needle, fn in EXTRACT_RULES:
            if first.startswith(needle):
                files.setdefault(fn, []).append(b.rstrip('\n'))
                break
        else:
            unmatched.append(first)
    if unmatched:
        raise BuildError('这些代码块没有认领规则：\n  ' + '\n  '.join(unmatched))
    want = sorted(set(fn for _, fn in EXTRACT_RULES))
    missing = [fn for fn in want if fn not in files]
    if missing:
        raise BuildError('02 里缺这些文件的代码块：' + '、'.join(missing))
    GLSL_DIR.mkdir(parents=True, exist_ok=True)
    wrote, kept = [], []
    for fn in want:
        p = GLSL_DIR / fn
        if p.exists():
            kept.append(fn)
            continue
        wr(p, '\n\n'.join(files[fn]) + '\n')
        wrote.append(fn)
    print('抽取 GLSL：代码块 %d 个 → 文件 %d 个；新写 %d，已存在未覆盖 %d' % (len(blocks), len(want), len(wrote), len(kept)))
    for fn in wrote:
        print('  + src/glsl/' + fn)


# ───────────────────────── 读源 ─────────────────────────
def load_manifest():
    try:
        m = json.loads(rd(SRC / 'manifest.json'))
    except Exception as e:
        raise BuildError('src/manifest.json 读不了：%s' % e)
    for k in ('title', 'cdn', 'fonts', 'scripts'):
        if k not in m:
            raise BuildError('manifest 缺字段 %s' % k)
    return m


def collect_glsl():
    out, keys = [], {}
    if not GLSL_DIR.exists():
        return out
    for p in sorted(GLSL_DIR.iterdir(), key=lambda q: q.name):
        if p.is_dir():
            raise BuildError('src/glsl/ 下不许有子目录：%s' % p.name)
        if not p.name.endswith(GLSL_EXT):
            raise BuildError('src/glsl/ 下有不认识的文件：%s（只收 .glsl .frag .vert）' % p.name)
        k = glsl_key(p.name)
        if k in keys:
            raise BuildError('HY.glsl 键冲突：%s 与 %s 都成了 %s' % (keys[k], p.name, k))
        keys[k] = p.name
        out.append((k, p.name, norm_nl(rd(p))))
    out.sort(key=lambda x: x[0])
    return out


def glsl_script(glsl, build_info, dev):
    parts = []
    for k, _, src in glsl:
        s = json.dumps(src, ensure_ascii=False).replace('</', '<\\/')
        parts.append('    %s: %s' % (json.dumps(k), s))
    body = ',\n'.join(parts)
    return ('(function (G) { var HY = G.HY = G.HY || {};\n'
            '  HY.glsl = {\n%s\n  };\n'
            '  HY.BUILD = %s;\n'
            '%s'
            '})(typeof globalThis !== \'undefined\' ? globalThis : window);\n'
            % (body, json.dumps(build_info, ensure_ascii=False), '  HY.DEV = true;\n' if dev else ''))


# ───────────────────────── 拼装 ─────────────────────────
def assemble(manifest, dev, extra_scripts=None):
    warns = []
    tpl = norm_nl(rd(SRC / 'index.html'))
    css = norm_nl(rd(SRC / 'style.css'))
    glsl = collect_glsl()

    scripts, listed = [], set()
    for ent in manifest['scripts']:
        if 'glsl' in ent:
            scripts.append(('glsl', None))
            continue
        rel = ent['src']
        p = SRC / rel
        if not p.exists():
            raise BuildError('manifest 列了不存在的脚本：src/%s' % rel)
        listed.add(rel.replace('\\', '/'))
        scripts.append(('js', (rel, norm_nl(rd(p)))))
    for rel in (extra_scripts or []):
        p = (SRC / rel).resolve()
        if not p.exists():
            warns.append('harness 脚本不存在，跳过：%s' % rel)
            continue
        scripts.append(('js', (os.path.relpath(p, HERE).replace('\\', '/'), norm_nl(rd(p)))))

    h = hashlib.sha1()
    for kind, v in scripts:
        if kind == 'js':
            h.update(v[1].encode('utf-8'))
    for k, _, s in glsl:
        h.update(s.encode('utf-8'))
    h.update(tpl.encode('utf-8'))
    h.update(css.encode('utf-8'))
    build_info = {
        'time': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'hash': h.hexdigest()[:8],
        'dev': bool(dev),
    }

    fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
             '<link rel="stylesheet" href="%s">' % manifest['fonts'])
    style = '<style>\n' + css.rstrip('\n') + '\n</style>'
    cdn = '\n'.join('<script src="%s"></script>' % u for u in manifest['cdn'])
    sparts, sizes = [], {}
    for kind, v in scripts:
        if kind == 'glsl':
            code = glsl_script(glsl, build_info, dev)
            sparts.append('<script>\n/* HY.glsl（src/glsl/，%d 个文件）＋ HY.BUILD */\n%s</script>' % (len(glsl), code))
            sizes['glsl'] = len(code.encode('utf-8'))
        else:
            rel, code = v
            label = rel if rel.startswith('test/') else 'src/' + rel
            sparts.append('<script>\n/* %s */\n%s\n</script>' % (label, code.rstrip('\n')))
            sizes[label] = len(code.encode('utf-8'))
    scripts_html = '\n'.join(sparts)

    for ph in ('<!--@FONTS-->', '<!--@STYLE-->', '<!--@CDN-->', '<!--@SCRIPTS-->'):
        if tpl.count(ph) != 1:
            raise BuildError('模板 src/index.html 里占位符 %s 应恰有一处（现有 %d）' % (ph, tpl.count(ph)))
    out = (tpl.replace('<!--@FONTS-->', fonts)
              .replace('<!--@STYLE-->', style)
              .replace('<!--@CDN-->', cdn)
              .replace('<!--@SCRIPTS-->', scripts_html))
    if not out.endswith('\n'):
        out += '\n'
    ctx = {'tpl': tpl, 'css': css, 'glsl': glsl, 'scripts': scripts, 'listed': listed,
           'sizes': sizes, 'build': build_info, 'manifest': manifest}
    return out, ctx, warns


# ───────────────────────── 检查 ─────────────────────────
def js_strings(code):
    """粗略切出 JS 字符串字面量的内容（'…'、"…"、`…`），跳过注释与正则不细究。"""
    res, i, n = [], 0, len(code)
    while i < n:
        c = code[i]
        if c == '/' and i + 1 < n and code[i + 1] == '/':
            j = code.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and i + 1 < n and code[i + 1] == '*':
            j = code.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in '\'"`':
            q, j, buf = c, i + 1, []
            while j < n and code[j] != q:
                if code[j] == '\\':
                    buf.append(code[j:j + 2])
                    j += 2
                    continue
                if code[j] == '\n' and q != '`':
                    break
                buf.append(code[j])
                j += 1
            res.append((q, ''.join(buf)))
            i = j + 1
            continue
        i += 1
    return res


def strip_js_comments(code):
    """去掉注释（保留字符串），供“运行时取资源”检查用。"""
    out, i, n = [], 0, len(code)
    while i < n:
        c = code[i]
        if c == '/' and i + 1 < n and code[i + 1] == '/':
            j = code.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and i + 1 < n and code[i + 1] == '*':
            j = code.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in '\'"`':
            q, j = c, i + 1
            while j < n and code[j] != q:
                j += 2 if code[j] == '\\' else 1
            out.append(code[i:j + 1])
            i = j + 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)


CJK_IN_QUOTES = re.compile(r'"[^"\n]*[一-鿿][^"\n]*"')


def run_checks(out, ctx, node):
    errs, warns = [], []
    low = out.lower()
    # 骨架
    for tag in ('<!doctype', '<html', '<head', '<body'):
        if re.search(re.escape(tag) + r'[\s>/]', low):
            errs.append('骨架：产物里出现了 %s' % tag)
    t = '<title>%s</title>' % ctx['manifest']['title']
    if out.count(t) != 1 or low.count('<title') != 1:
        errs.append('骨架：应恰有一个 %s' % t)
    if out.split('\n', 1)[0].strip() != '<meta charset="utf-8">':
        errs.append('骨架：第一行必须是 <meta charset="utf-8">')
    # 外部依赖
    srcs = re.findall(r'<script\b[^>]*\bsrc\s*=\s*"([^"]*)"', out, re.I)
    if srcs != list(ctx['manifest']['cdn']):
        errs.append('外部依赖：<script src> 应恰为 manifest.cdn 两条，实为 %s' % srcs)
    for u in ctx['manifest']['cdn']:
        if not re.search(r'(three\.js/r128/|three@0\.128\.0/)', u):
            errs.append('外部依赖：没有锁定 three r128：%s' % u)
    for tag in re.findall(r'<link\b[^>]*>', out, re.I):
        href = re.search(r'href\s*=\s*"([^"]*)"', tag)
        host = re.match(r'https://([^/"?#]+)', href.group(1)) if href else None
        if not host or host.group(1) not in ('fonts.googleapis.com', 'fonts.gstatic.com'):
            errs.append('外部依赖：<link> 指向了 Google Fonts 以外：%s' % tag)
        elif 'stylesheet' in tag and host.group(1) != 'fonts.googleapis.com':
            errs.append('外部依赖：样式表只许来自 fonts.googleapis.com：%s' % tag)
    for m in re.finditer(r'https?://[^\s"\'<>)\\]+', out):
        u = m.group(0)
        if u.startswith(ALLOWED_URL_PREFIX):
            continue
        hm = re.match(r'https?://([^/:]+)', u)
        if not hm or hm.group(1) not in ALLOWED_HOSTS or not u.startswith('https://'):
            errs.append('外部依赖：出现不许可的网址 %s' % u[:120])
    # 运行时取资源
    sources = [('src/index.html', ctx['tpl'])] + [(('src/' + v[0]) if not v[0].startswith('test/') else v[0], v[1])
                                                    for k, v in ctx['scripts'] if k == 'js']
    for name, code in sources:
        body = strip_js_comments(code) if name.endswith('.js') else code
        for rx, label in FORBIDDEN:
            if rx.search(body):
                errs.append('运行时取资源：%s 里出现 %s' % (name, label))
    # 内联安全
    for k, v in ctx['scripts']:
        if k == 'js' and re.search(r'</script', v[1], re.I):
            errs.append('内联安全：%s 里有未转义的 </script' % v[0])
    if re.search(r'</style', ctx['css'], re.I):
        errs.append('内联安全：style.css 里有 </style')
    # 完整
    for p in SRC.rglob('*.js'):
        rel = p.relative_to(SRC).as_posix()
        if rel not in ctx['listed'] and rel not in IGNORE_JS:
            errs.append('完整：src/%s 不在 manifest 里（也不在忽略表里）' % rel)
    keys = set(k for k, _, _ in ctx['glsl'])
    files = set(glsl_key(p.name) for p in GLSL_DIR.iterdir()) if GLSL_DIR.exists() else set()
    if keys != files:
        errs.append('完整：HY.glsl 与 src/glsl/ 不一致')
    if not any(k == 'glsl' for k, _ in ctx['scripts']):
        errs.append('完整：manifest 里没有 {"glsl": "glsl"} 一项')
    # 语法
    if node:
        bad = node_syntax(node, [(v[0], v[1]) for k, v in ctx['scripts'] if k == 'js'])
        errs.extend('语法：' + b for b in bad)
    else:
        warns.append('语法：没有 node，跳过脚本语法检查')
    # 体积
    size = len(out.encode('utf-8'))
    if size >= SIZE_HARD:
        errs.append('体积：%s 字节，超过 16 MB 硬限' % format(size, ','))
    elif size > SIZE_WARN:
        warns.append('体积：%s 字节，超过 1 MB（目标 < 600 KB）' % format(size, ','))
    # 引号（只告警）：模板正文文字，以及 JS 字符串内容里的直双引号包中文
    tpl_text = re.sub(r'<[^>]*>', ' ', re.sub(r'<!--.*?-->', ' ', ctx['tpl'], flags=re.S))
    for m in CJK_IN_QUOTES.finditer(tpl_text):
        warns.append('引号：src/index.html 正文里有直引号包着的中文 %s' % m.group(0)[:40])
    for k, v in ctx['scripts']:
        if k != 'js':
            continue
        for q, s in js_strings(v[1]):
            if q != '"':
                for m in CJK_IN_QUOTES.finditer(s):
                    warns.append('引号：%s 的界面字符串里有直引号包着的中文 %s' % (v[0], m.group(0)[:40]))
    return errs, warns


def node_syntax(node, files):
    """一次 node 进程里用 vm.Script 逐个解析（等价于 node --check）。"""
    tmp = tempfile.mkdtemp(prefix='hy_syntax_')
    try:
        lst = []
        for i, (name, code) in enumerate(files):
            p = os.path.join(tmp, '%03d.js' % i)
            with open(p, 'w', encoding='utf-8', newline='\n') as f:
                f.write(code)
            lst.append([name, p])
        jp = os.path.join(tmp, 'list.json')
        with open(jp, 'w', encoding='utf-8') as f:
            json.dump(lst, f, ensure_ascii=False)
        js = ("const fs=require('fs'),vm=require('vm');const L=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
              "const bad=[];for(const [n,p] of L){try{new vm.Script(fs.readFileSync(p,'utf8'),{filename:n});}"
              "catch(e){bad.push(n+'：'+String(e.message).split('\\n')[0]);}}"
              "process.stdout.write(JSON.stringify(bad));")
        r = subprocess.run([node, '-e', js, jp], capture_output=True, timeout=120)
        if r.returncode != 0:
            return ['node 语法检查进程失败：' + r.stderr.decode('utf-8', 'replace')[:400]]
        return json.loads(r.stdout.decode('utf-8'))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def report(out, ctx, warns, errs, target):
    size = len(out.encode('utf-8'))
    print('环域星体模型 v3 · 构建 %s · %s%s' % (ctx['build']['hash'], ctx['build']['time'], ' · 开发' if ctx['build']['dev'] else ''))
    print('  总计 %s 字节（%.1f KB）' % (format(size, ','), size / 1024))
    print('  模板 %s · 样式 %s · GLSL %s（%d 个文件）' % (
        format(len(ctx['tpl'].encode('utf-8')), ','), format(len(ctx['css'].encode('utf-8')), ','),
        format(ctx['sizes'].get('glsl', 0), ','), len(ctx['glsl'])))
    js = sorted(((k, v) for k, v in ctx['sizes'].items() if k != 'glsl'), key=lambda x: -x[1])
    print('  脚本 %d 个，共 %s 字节；最大：%s' % (len(js), format(sum(v for _, v in js), ','),
                                       '，'.join('%s %s' % (k, format(v, ',')) for k, v in js[:5])))
    print('  外部依赖：' + '；'.join(ctx['manifest']['cdn']) + '；Google Fonts')
    for w in warns:
        print('  ! 告警：' + w)
    for e in errs:
        print('  ✗ ' + e)
    if target:
        print('  → ' + str(target))


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding='utf-8')
        except Exception:
            pass
    ap = argparse.ArgumentParser(description='环域星体模型 v3 构建')
    ap.add_argument('--out')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--harness', action='store_true')
    ap.add_argument('--test', action='store_true')
    ap.add_argument('--dev', action='store_true')
    ap.add_argument('--extract-glsl', action='store_true')
    a = ap.parse_args(argv)
    try:
        if a.extract_glsl:
            extract_glsl()
            return 0
        node = shutil.which('node')
        manifest = load_manifest()
        out, ctx, w0 = assemble(manifest, a.dev)
        errs, warns = run_checks(out, ctx, node)
        warns = w0 + warns
        target = None if a.check else Path(a.out).resolve() if a.out else DEFAULT_OUT
        report(out, ctx, warns, errs, None if errs else target)
        if errs:
            print('构建失败：%d 项检查未通过，未写文件。' % len(errs))
            return 1
        if target:
            wr(target, out)
        if a.harness:
            hout, hctx, hw = assemble(manifest, True, manifest.get('harness', []))
            for w in hw:
                print('  ! 告警：' + w)
            wr(HARNESS_OUT, hout)
            print('  → ' + str(HARNESS_OUT))
        if a.test:
            if not node:
                print('没有 node，跑不了测试。')
                return 1
            print('\n跑 node test/run_all.js …', flush=True)
            r = subprocess.run([node, str(TEST / 'run_all.js')], cwd=str(HERE))
            return r.returncode
        return 0
    except BuildError as e:
        print('构建失败：' + str(e))
        return 1


if __name__ == '__main__':
    sys.exit(main())
