"""Pack the Vite build into one self-contained HTML file (for publishing the playable build as a claude.ai artifact).

Usage: npm run build && python3 tools/bundle-artifact.py out/loophole.html
"""
import glob
import re
import sys

out_path = sys.argv[1] if len(sys.argv) > 1 else 'loophole.html'
html = open('dist/index.html').read()
css = open(glob.glob('dist/assets/*.css')[0]).read()
js = open(glob.glob('dist/assets/*.js')[0]).read().replace('</script', '<\\/script')
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>', '', body)
fonts = (
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Pixelify+Sans:wght@400;600&display=swap" />'
)
# The artifact host adds its own <!doctype>/<head>/<body>, so emit only the page contents.
out = f'<title>Loophole</title>\n{fonts}\n<style>\n{css}\n</style>\n{body.strip()}\n<script type="module">\n{js}\n</script>\n'
open(out_path, 'w').write(out)
print(f'wrote {out_path} ({len(out):,} bytes)')
