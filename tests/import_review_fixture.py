"""Manual browser fixture using only synthetic data in a temporary database.

Run: python tests/import_review_fixture.py
Open the printed URL (add ?theme=dark for dark mode). Ctrl-C cleans up.
"""
import json
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from test_groups_bulk import APP, make_server, row
from server import BudgetRequestHandler, transaction_export_csv, write_transactions_atomic


class ImportReviewFixtureHandler(BudgetRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in {"/review-fixture", "/review-fixture-narrow"}:
            return super().do_GET()
        if path == "/review-fixture-narrow":
            html = ('<!doctype html><html lang="en"><head><title>390px import review</title></head><body>'
                    '<iframe title="Narrow import review" src="/review-fixture?theme=dark" '
                    'style="width:390px;height:690px;border:0"></iframe></body></html>')
        else:
            content, _ = transaction_export_csv([
                row(description="Synthetic bike tool", subcategory="", amount="53.20"),
                row(description="Synthetic travel meal", subcategory="", amount="21.00", tags="travel"),
                row(description="Synthetic existing purchase", subcategory="", amount="12.50"),
            ], "2026-01-01", "2026-12-31")
            html = (APP / "upload.html").read_text(encoding="utf-8")
            script = """<script>
window.addEventListener('load', () => {
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  const button = document.createElement('button');
  button.textContent = 'Open synthetic import review';
  button.className = 'primary-button';
  document.querySelector('main').prepend(button);
  button.addEventListener('click', async () => {
    const response = await fetch('/api/csv-import-sessions', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: CONTENT, applyClassifications: true})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderResult(result.import, 'csv', result.token);
  });
});
</script>""".replace("CONTENT", json.dumps(content.decode("utf-8-sig")))
            html = html.replace("</body>", script + "</body>")
        encoded = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="ledger-import-review-") as directory:
        path = Path(directory) / "transactions.csv"
        write_transactions_atomic(path, [row(description="Synthetic existing purchase", amount="12.50")])
        server = make_server(path)
        server.RequestHandlerClass = ImportReviewFixtureHandler
        print(f"Synthetic import review: http://127.0.0.1:{server.server_port}/review-fixture", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
