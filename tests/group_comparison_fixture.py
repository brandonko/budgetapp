"""Synthetic, loopback-only UI fixture: python tests/group_comparison_fixture.py.

No private data is read. Ctrl-C closes the server and removes the temporary CSV.
"""
from pathlib import Path
import tempfile

from test_groups_bulk import make_server, row
from server import BudgetRequestHandler, acknowledge_transfer_review, write_transactions_atomic


class FixtureHandler(BudgetRequestHandler):
    def do_GET(self):
        if self.path == "/narrow":
            html = b'<!doctype html><html lang="en"><title>390px responsive test</title><body style="margin:0;background:#888"><iframe title="Ledger at 390px" src="/transactions" style="display:block;width:390px;height:1000px;border:0;margin:0 auto"></iframe></body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        super().do_GET()


def comparison_rows():
    return [
        row(group="Canyon Aeroad", description="Road bike frame", amount="2400", category="Bike", date="2025-03-01"),
        row(group="Canyon Aeroad", description="Road wheels", amount="600", category="Parts", date="2025-04-01"),
        row(group="Canyon Aeroad", description="Replacement derailleur", amount="200", category="Parts", date="2026-08-20"),
        row(group="Canyon Aeroad", description="Return credit", amount="-100", category="Parts"),
        row(group="Canyon Aeroad", description="Returned saddle", amount="180", flags="refunded"),
        row(group="Canyon Aeroad", description="Card payment", amount="3300", flags="internal-transfer"),
        row(group="Trail bike", description="Trail bike", amount="2800", category="Bike", date="2026-01-10"),
        row(group="Trail bike", description="Trail wheels", amount="400", category="Parts"),
        row(group="Trail bike", description="Fork setup", amount="80", category="Maintenance"),
        row(group="Hawaii trip", description="Hotel", amount="1200", category="Travel", date="2024-06-01"),
        row(group="Hawaii trip", description="Meals", amount="320", category="Food", date="2024-06-03"),
        row(group="Canceled project", description="Parts returned", amount="-75", category="Parts"),
        row(group="A long project name for testing narrow screen layouts and readable labels", amount="0"),
        row(description="Ungrouped income", amount="-2000", category="Income"),
    ]


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="ledger-comparison-") as directory:
        path = Path(directory) / "transactions.csv"
        write_transactions_atomic(path, comparison_rows())
        acknowledge_transfer_review(path)
        server = make_server(path)
        server.RequestHandlerClass = FixtureHandler
        print(f"Synthetic comparison UI: http://127.0.0.1:{server.server_port}/transactions", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
