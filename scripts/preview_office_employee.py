"""Loopback V5 employee preview. Only proxies the existing anonymous snapshot.

No collector, credentials, admin routes, or persistent configuration writes.
Browser tests inject fixture responses in their own isolated browser context.
"""
import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
PREFIX = "/static/releases/hover-preview"
ALLOWED = {".mjs", ".js", ".json", ".css", ".html", ".png", ".webp", ".svg", ".woff", ".woff2", ".ttf"}
UPSTREAM = "http://192.168.100.221:19000/api/office/snapshot"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, data, kind):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/":
            config = {"mode": "employee", "release_prefix": PREFIX}
            text = (FRONTEND / "office/index.html").read_text().replace("{{OFFICE_BOOT_JSON}}", json.dumps(config))
            text = text.replace("<title>律动 · 实时办公室</title>", "<title>V5 悬停验收 · 律动办公室</title>")
            text = text.replace("<body>", '<body><div data-testid="v5-preview-banner" style="padding:10px 24px;background:#f1e2be;color:#26443d;text-align:center">V5 本地验收 · 仅只读获取内网办公室快照 · 尚未部署服务器</div>')
            return self.reply(200, text.encode(), "text/html; charset=utf-8")
        if path == "/api/office/snapshot":
            try:
                with build_opener(ProxyHandler({})).open(UPSTREAM, timeout=5) as response:
                    data = response.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
                    raise ValueError("snapshot too large")
                json.loads(data)
                return self.reply(200, data, "application/json; charset=utf-8")
            except Exception:
                return self.reply(502, b'{"error":"snapshot_unavailable"}', "application/json")
        if path.startswith(PREFIX + "/"):
            file = (FRONTEND / path[len(PREFIX) + 1:]).resolve()
            if (file.is_relative_to(FRONTEND) and file.is_file() and file.suffix in ALLOWED
                    and not any(part.startswith(".") for part in file.relative_to(FRONTEND).parts)):
                kind = "text/javascript" if file.suffix in {".mjs", ".js"} else mimetypes.guess_type(str(file))[0] or "application/octet-stream"
                return self.reply(200, file.read_bytes(), kind)
        self.reply(404, b"Not found", "text/plain")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=19025)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"V5 employee preview: http://127.0.0.1:{server.server_port}/", flush=True)
    server.serve_forever()
