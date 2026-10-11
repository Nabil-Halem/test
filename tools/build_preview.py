"""Build a self-contained preview bundle of the site (used to publish a private preview page).

Differences from site/: the home page loses its <html>/<head>/<body> wrapper (the preview host adds one),
and the fonts are inlined into the stylesheet as data URIs. Everything else is copied as is.

    python3 tools/build_preview.py OUT_DIR
"""
import base64
import pathlib
import re
import shutil
import sys

src = pathlib.Path(__file__).resolve().parent.parent / 'site'
out = pathlib.Path(sys.argv[1]).resolve()
if out.exists():
    shutil.rmtree(out)
shutil.copytree(src, out, ignore=shutil.ignore_patterns('_*.html'))

css = out / 'assets/css/site.css'
text = css.read_text(encoding='utf-8')
def inline(m):
    font = (out / 'assets/css' / m.group(1)).resolve()
    return 'url("data:font/woff2;base64,' + base64.b64encode(font.read_bytes()).decode() + '")'
text = re.sub(r'url\("(\.\./fonts/[^"]+\.woff2)"\)', inline, text)
css.write_text(text, encoding='utf-8')

home = out / 'index.html'
html = home.read_text(encoding='utf-8')
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = re.sub(r'\s*<meta charset="utf-8">', '', head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', '', head)
head = re.sub(r'\s*<link rel="preload"[^>]*>', '', head)
home.write_text(head.strip() + '\n' + body.strip() + '\n', encoding='utf-8')
for p in out.glob('*.html'):
    t = p.read_text(encoding='utf-8')
    t = re.sub(r'\s*<link rel="preload"[^>]*>', '', t)
    p.write_text(t, encoding='utf-8')
# Artifact hosting does not serve .glb files: ship the model base64-encoded as text instead
glb = out / 'assets/models/sm150-v5.glb'
if glb.exists():
    (out / 'assets/models/sm150-v5.glb.txt').write_text(base64.b64encode(glb.read_bytes()).decode(), encoding='ascii')
    glb.unlink()
    for js in (out / 'assets/js').glob('*.js'):
        t = js.read_text(encoding='utf-8')
        js.write_text(t.replace("'assets/models/sm150-v5.glb'", "'assets/models/sm150-v5.glb.txt'"), encoding='utf-8')
shutil.rmtree(out / 'assets/fonts', ignore_errors=True)
print('preview bundle in', out)
