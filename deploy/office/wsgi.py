"""Deployment-only fail-closed guard for legacy HTTPS compatibility.

Backend owns new /api/office APIs. No assumption about its session internals:
check authentication against config API, CSRF against session API. This keeps
legacy mutation routes authenticated even when the legacy app has no guard.
"""
import importlib
import io
import json
import os
import secrets

PUBLIC = frozenset(('/', '/admin', '/health', '/api/office/snapshot'))
OFFICE_API = '/api/office/'
COMPAT_PREFIX = '/api/office/admin/compat/'


class CompatibilityGuard:
    def __init__(self, app, origin='https://192.168.100.221:19443'):
        self.app = app
        self.origin = origin

    def _probe(self, environ, path):
        probe = dict(environ)
        probe.update(REQUEST_METHOD='GET', PATH_INFO=path, QUERY_STRING='',
                     CONTENT_LENGTH='0', **{'wsgi.input': io.BytesIO(b'')})
        probe.pop('CONTENT_TYPE', None)
        captured = []
        def start(status, headers, exc_info=None):
            captured.append(status)
        chunks = self.app(probe, start)
        try:
            content = b''
            for chunk in chunks:
                content += chunk
                if len(content) > 1024 * 1024:
                    return 503, None
            status = int(captured[0].split()[0]) if captured else 503
            return status, json.loads(content) if status == 200 else None
        except (ValueError, TypeError):
            return 503, None
        finally:
            close = getattr(chunks, 'close', None)
            if close:
                close()

    @staticmethod
    def _deny(start_response, status, code):
        data = json.dumps({'error': {'code': code, 'message': 'Compatibility access denied'}}).encode()
        start_response(status, [('Content-Type', 'application/json'),
                                ('Content-Length', str(len(data))), ('Cache-Control', 'no-store')])
        return [data]

    def __call__(self, environ, start_response):
        path = environ.get('PATH_INFO', '/')
        is_compat = path.startswith(COMPAT_PREFIX)
        if is_compat:
            # Explicit compatibility namespace for migrated legacy clients.
            # The hardened office cookie has Path=/; the backend independently
            # checks the same session and CSRF after this path rewrite.
            path = '/' + path[len(COMPAT_PREFIX):]
            environ = dict(environ, PATH_INFO=path)
            if path.startswith(OFFICE_API) or path == '/':
                return self._deny(start_response, '404 Not Found', 'NOT_FOUND')
        # /local is a development resource tree and is never a release route.
        if path == '/local' or path.startswith('/local/'):
            return self._deny(start_response, '404 Not Found', 'NOT_FOUND')
        rid = os.environ.get('OFFICE_RELEASE_ID', '')
        versioned = bool(rid) and path.startswith('/static/releases/' + rid + '/')
        if not is_compat and (path in PUBLIC or path.startswith(OFFICE_API) or versioned):
            return self.app(environ, start_response)
        # Nginx serves employee/admin HTML and immutable static paths itself.
        # All other backend paths, INCLUDING /static and /assets, are legacy.
        if (environ.get('wsgi.url_scheme') != 'https'
                and os.environ.get('OFFICE_ADMIN_ALLOW_HTTP', '0') != '1'):
            return self._deny(start_response, '403 Forbidden', 'HTTPS_REQUIRED')
        try:
            status, _ = self._probe(environ, '/api/office/admin/config')
            if status != 200:
                return self._deny(start_response, '401 Unauthorized', 'AUTH_REQUIRED')
            if environ.get('REQUEST_METHOD', 'GET') not in ('GET', 'HEAD'):
                origin = environ.get('HTTP_ORIGIN', '')
                if origin != self.origin:
                    return self._deny(start_response, '403 Forbidden', 'CSRF')
                status, session = self._probe(environ, '/api/office/admin/session')
                token = environ.get('HTTP_X_CSRF_TOKEN', '')
                expected = (session or {}).get('csrf_token', '')
                if (status != 200 or not session.get('authenticated') or not token
                        or not isinstance(expected, str) or not secrets.compare_digest(token, expected)):
                    return self._deny(start_response, '403 Forbidden', 'CSRF')
        except Exception:
            # Never reveal application exceptions, source bodies or credentials.
            return self._deny(start_response, '503 Service Unavailable', 'COMPAT_UNAVAILABLE')
        return self.app(environ, start_response)


def load_application():
    # Main thread registers OFFICE APIs inside app.py; this never registers them.
    from werkzeug.middleware.proxy_fix import ProxyFix
    app = importlib.import_module('app').app
    return ProxyFix(CompatibilityGuard(app, os.environ.get('OFFICE_COMPAT_ORIGIN',
                    'https://192.168.100.221:19443')), x_proto=1, x_host=1)


# Lazy initialization permits fixture tests without importing the real backend.
_application = None

def application(environ, start_response):
    global _application
    if _application is None:
        _application = load_application()
    return _application(environ, start_response)
