#!/usr/bin/env python3
"""Loopback-only, read-only preview with an explicit static-file allowlist."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
ROOT = Path(__file__).resolve().parents[2]
PREVIEW = Path(__file__).resolve().parent
WALK = ROOT / '.agents/skills/star-office-character-animation/assets/approved-walk-directions-v1'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, request):
        path = unquote(urlsplit(request).path)
        if path == '/': return str(PREVIEW / 'index.html')
        if path in ['/index.html', '/preview.mjs', '/navigation.mjs', '/style.css', '/scene.json']:
            return str(PREVIEW / path[1:])
        if path.startswith('/source/'):
            relative = path.removeprefix('/source/')
            allowed = {'map-layout.json', 'office-assets.json', 'seated-compositor.mjs', 'office-map-floorplan-v2.webp'}
            allowed.update('media/' + file.name for file in (ROOT / 'frontend/company-office/media').glob('*.png'))
            if relative in allowed: return str(ROOT / 'frontend/company-office' / relative)
        if path.startswith('/walking/'):
            relative = path.removeprefix('/walking/')
            if relative in {f'{d}/{f}.png' for d in ['up', 'down', 'left', 'right'] for f in ['A', 'B']}:
                return str(WALK / relative)
        if path in ['/fonts/ark-pixel-12px-proportional-zh_cn.ttf.woff2', '/fonts/ark-pixel-12px-proportional-latin.ttf.woff2']:
            return str(ROOT / 'frontend' / path[1:])
        return str(PREVIEW / '__not_available__')
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
    def do_POST(self): self.send_error(405, 'Read-only preview')
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=19020)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(PREVIEW)))
    print(f'Combined map preview: http://127.0.0.1:{server.server_port}/', flush=True)
    server.serve_forever()
