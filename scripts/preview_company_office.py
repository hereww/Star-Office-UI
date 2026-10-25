#!/usr/bin/env python3
"""Run the real Flask/main-map page, loopback only, with isolated local state.

Use an existing environment that already has backend/requirements.txt installed.
Production's default data paths and original map remain untouched.
"""
import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=19000)
parser.add_argument('--data-dir', type=Path, default=ROOT / '.local/company-office-preview')
args = parser.parse_args()
args.data_dir.mkdir(parents=True, exist_ok=True)
os.environ['STAR_OFFICE_DATA_DIR'] = str(args.data_dir.resolve())
sys.path.insert(0, str(ROOT / 'backend'))
import app as backend_app  # noqa: E402
from flask import request  # noqa: E402

app = backend_app.app

# Reload edited templates in this local preview only (Flask debug remains off).
# The browser root uses a module-level HTML cache, not the Jinja template loader.
@app.before_request
def reload_preview_index():
    if request.path == '/':
        backend_app._INDEX_HTML_CACHE = None
        backend_app.VERSION_TIMESTAMP = str(Path(backend_app.FRONTEND_INDEX_FILE).stat().st_mtime_ns)


# Relative ES-module imports have no VERSION_TIMESTAMP query. Override the
# production immutable cache at the outer WSGI boundary in this preview only.
# This runs after Flask's existing after_request handler without altering it.
production_wsgi = app.wsgi_app


def preview_wsgi(environ, start_response):
    def start_uncached(status, headers, exc_info=None):
        excluded = {'cache-control', 'pragma', 'expires'}
        headers = [(key, value) for key, value in headers if key.lower() not in excluded]
        headers.extend([
            ('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0'),
            ('Pragma', 'no-cache'),
            ('Expires', '0'),
        ])
        return start_response(status, headers, exc_info)
    return production_wsgi(environ, start_uncached)


app.wsgi_app = preview_wsgi

app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

print(f'Company office main-map preview: http://127.0.0.1:{args.port}/', flush=True)
app.run(host='127.0.0.1', port=args.port, debug=False, use_reloader=False)
