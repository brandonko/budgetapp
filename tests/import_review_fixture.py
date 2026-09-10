"""Manual browser fixture using only synthetic data in a temporary database.

Run: python tests/import_review_fixture.py
Open the printed URL (add ?theme=dark for dark mode). Ctrl-C cleans up.
"""
import json
import argparse
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from test_groups_bulk import APP, make_server, row
from server import BudgetRequestHandler, transaction_export_csv, write_classifications_atomic, write_transactions_atomic, acknowledge_transfer_review


class ImportReviewFixtureHandler(BudgetRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in {"/review-fixture", "/review-fixture-narrow", "/refund-fixture", "/filter-fixture"}:
            return super().do_GET()
        if path == "/review-fixture-narrow":
            html = ('<!doctype html><html lang="en"><head><title>390px import review</title></head><body>'
                    '<iframe title="Narrow import review" src="/review-fixture?theme=dark" '
                    'style="width:390px;height:690px;border:0"></iframe></body></html>')
        else:
            preview_rows = [
                row(description="Synthetic bike tool", subcategory="", amount="53.20"),
                row(description="Synthetic travel meal", subcategory="", amount="21.00", tags="travel"),
                row(description="Synthetic existing purchase", subcategory="", amount="12.50"),
            ]
            if path == "/filter-fixture":
                preview_rows.extend([
                    row(description="Synthetic salary", amount="-1200.00", category="Income"),
                    row(description="Synthetic shop refund", amount="-25.00", flags="flagged"),
                ])
            if "many" in urlsplit(self.path).query:
                preview_rows.extend(row(description=f"Synthetic import row {index:03}", amount=500 + index)
                                    for index in range(80))
            content, _ = transaction_export_csv(preview_rows, "2026-01-01", "2026-12-31")
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
            if path == "/refund-fixture":
                html = html.replace("Open synthetic import review", "Open synthetic refund review")
                # Keep the normal CSV fixture intact; the refund variant uses real session APIs.
                first = html.index("    const response = await fetch('/api/csv-import-sessions'")
                last = html.index("    renderResult(result.import, 'csv', result.token);", first)
                replacement = """    const created = await fetch('/api/creditkarma-import-sessions', {method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({startDate:'2026-09-01',endDate:'2026-09-09',matchRefunds:true})});
    const session = await created.json();
    const content = JSON.stringify({transactions:[{date:'2026-09-09',description:'AMAZON refund received',amount:12.5,
      transactionType:'credit',category:'Shopping',accountName:'Synthetic card',accountType:'CREDIT CARD',provider:'Synthetic bank'}]});
    const response = await fetch('/api/creditkarma-import-sessions/'+session.token+'/complete', {method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderResult(result.import, 'creditkarma', session.token);"""
                html = html[:first] + replacement + html[last + len("    renderResult(result.import, 'csv', result.token);"):]
        encoded = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reconciliation", action="store_true")
    parser.add_argument("--many", action="store_true")
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ledger-import-review-") as directory:
        path = Path(directory) / "transactions.csv"
        rows = [row(description="Synthetic existing purchase", amount="12.50"),
            row(description="Synthetic second same-price item", amount="12.50", date="2026-07-15")]
        if options.reconciliation:
            rows.extend([
                row(description="Synthetic jacket purchase", amount=100, date="2026-07-20"),
                row(description="Synthetic partial jacket refund", amount=-80, date="2026-08-24"),
                row(description="Synthetic shared dinner", amount=200),
                row(description="Alex dinner repayment", amount=-60, category="Income"),
                row(description="Sam dinner repayment", amount=-40, category="Income"),
                row(description="Synthetic store refund", amount=-12.5, date="2026-08-25"),
            ])
        if options.many:
            rows.extend(row(description=f"Synthetic scrolling row {index:03}", amount=500 + index,
                            subcategory="", createdAt="2026-09-01T00:00:00Z") for index in range(80))
        write_transactions_atomic(path, rows)
        acknowledge_transfer_review(path)
        # Mix plain, highlighted, and duplicate rows to expose theme/divider bugs.
        write_classifications_atomic(path, {"version": 2, "classifications": [{
            "updates": {"category": "Food", "subcategory": "Restaurant"},
            "rules": [{"description": "Synthetic travel meal"}],
        }]})
        server = make_server(path)
        server.RequestHandlerClass = ImportReviewFixtureHandler
        print(f"Synthetic import review: http://127.0.0.1:{server.server_port}/review-fixture", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
