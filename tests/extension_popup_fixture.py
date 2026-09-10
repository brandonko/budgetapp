"""Manual popup preview with synthetic Chrome APIs; no imports or real browser storage.

Run this file, open its printed loopback URL, and use ?theme=dark or ?theme=light
to inspect both popup palettes. Only the popup's public assets are served.
Open /options.html to test the saved-server Reconnect UI with synthetic APIs.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1] / "ledger_data_importer_extension"
MOCK = """<script>
window.chrome = {
  runtime: {
    getManifest: () => ({version: '0.10.2'}),
    openOptionsPage: async () => { document.getElementById('fixture-result').textContent = 'Connection settings opened'; }
  },
  storage: {local: {
    get: async () => ({ledgerTrustedOrigins: ['https://ledger.example']}),
    set: async () => {}
  }},
  permissions: {contains: async () => true},
  tabs: {
    query: async () => [{url: 'http://127.0.0.1:8000/import'}],
    create: async ({url}) => { document.getElementById('fixture-result').textContent = 'Opened ' + url; }
  }
};
</script>"""
CONTROLS = """<aside style="padding:16px;font:12px system-ui;border-top:1px solid #999">
Synthetic preview: <a href="?theme=light">Light</a> · <a href="?theme=dark">Dark</a>
<p id="fixture-result" role="status">No action taken</p></aside>"""

OPTIONS_MOCK = """<script>
const fixtureSaved = { ledgerTrustedOrigins: ['http://192.168.1.142:8000'] };
window.chrome = {
  runtime: { sendMessage: async () => ({success:true, connectedTabs:1}) },
  permissions: { contains: async () => true, request: async () => true },
  storage: {local: {
    get: async () => fixtureSaved,
    set: async values => Object.assign(fixtureSaved, values)
  }}
};
</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/popup.html":
            page = (ROOT / "shared/popup.html").read_text(encoding="utf-8")
            theme = parse_qs(url.query).get("theme", ["light"])[0]
            page = page.replace('href="popup.css"', f'href="popup.css?theme={"dark" if theme == "dark" else "light"}"')
            page = page.replace('<script src="trusted_origins.js">', MOCK + CONTROLS + '<script src="trusted_origins.js">')
            body, content_type = page.encode(), "text/html; charset=utf-8"
        elif url.path == "/options.html":
            page = (ROOT / "shared/options.html").read_text(encoding="utf-8")
            page = page.replace('<script src="trusted_origins.js">', OPTIONS_MOCK + '<script src="trusted_origins.js">')
            body, content_type = page.encode(), "text/html; charset=utf-8"
        elif url.path == "/options.css":
            body, content_type = (ROOT / "shared/options.css").read_bytes(), "text/css"
        elif url.path == "/popup.css":
            css = (ROOT / "shared/popup.css").read_text(encoding="utf-8")
            media = "all" if parse_qs(url.query).get("theme") == ["dark"] else "not all"
            body = css.replace("(prefers-color-scheme: dark)", media).encode()
            content_type = "text/css"
        elif url.path in ("/popup.js", "/options.js", "/trusted_origins.js", "/icons/ledger.svg", "/icons/icon-32.png"):
            body = (ROOT / "shared" / url.path.lstrip("/")).read_bytes()
            content_type = "image/svg+xml" if url.path.endswith(".svg") else "image/png" if url.path.endswith(".png") else "text/javascript"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(f"http://127.0.0.1:{server.server_port}/popup.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
