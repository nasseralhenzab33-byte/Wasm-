import base64, re
r=lambda f: open(f, encoding='utf-8').read()
logo = 'data:image/svg+xml;base64,' + base64.b64encode(open('../wasm/public/img/logo.svg','rb').read()).decode()
def wrap(code, name):
    return "(function(){ const module = { exports: {} };\n" + code + "\n__mods['" + name + "'] = module.exports; })();\n"
js = r('core.js') + "\nconst LOGO = '" + logo + "';\n" + wrap(r('ageNames.js'), '../../lib/ageNames') + wrap(r('nlu.js'), './nlu') \
   + r('store.js') + r('services.js') + r('assistant.js') + r('router.js') + r('icons.js') + r('ui.js')
css = r('app.css') + """
.boot { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; }
"""
html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>وسم | WASM — السوق الخليجي لأهل الإبل</title>
<link rel="icon" href="{logo}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@500;600;700&display=swap">
<style>{css}</style>
</head>
<body>
<div id="app" aria-live="polite"></div>
<div class="toast-wrap" id="toasts" role="status"></div>
<script>{js}</script>
</body>
</html>
"""
open('index.html','w',encoding='utf-8').write(html)
print(len(html))
