"""Serve the real app against a fresh synthetic CSV; stdin EOF cleans up.

There are no test HTTP endpoints, configurable data paths, or fixed ports.
Only this process's temporary database and classifications are ever opened.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app"))

from server import (  # noqa: E402
    BudgetRequestHandler, ThreadingHTTPServer, acknowledge_transfer_review,
    normalize_transaction, write_classifications_atomic, write_transactions_atomic,
)


def synthetic_rows():
    common = {
        "category": "Shopping", "subcategory": "", "accountName": "Synthetic card",
        "accountType": "CREDIT CARD", "provider": "Synthetic bank", "notes": "Synthetic fixture only",
        "tags": "example", "group": "", "flags": "", "links": "",
        "createdAt": "2026-09-01T00:00:00.000000Z",
    }
    examples = [
        {"id": "synthetic-purchase", "date": "2026-07-15", "description": "Synthetic jacket", "amount": "100.00"},
        {"id": "synthetic-refund", "date": "2026-08-05", "description": "Synthetic jacket refund", "amount": "-30.00", "category": "Income"},
        {"id": "synthetic-grocery", "date": "2026-07-20", "description": "Synthetic groceries", "amount": "25.00"},
        {"id": "synthetic-income", "date": "2026-07-01", "description": "Synthetic salary", "amount": "-1000.00", "category": "Income"},
    ]
    return [normalize_transaction({**common, **example}, "browser fixture") for example in examples]


def main():
    with tempfile.TemporaryDirectory(prefix="ledger-browser-") as directory:
        csv_path = Path(directory) / "transactions.csv"
        write_transactions_atomic(csv_path, synthetic_rows())
        acknowledge_transfer_review(csv_path)
        write_classifications_atomic(csv_path, {"version": 2, "classifications": [{
            "updates": {"category": "Food", "subcategory": "Groceries"},
            "rules": [{"description": "Synthetic groceries"}],
        }]})
        server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
        server.csv_path = csv_path
        server.data_lock = threading.Lock()
        server.amazon_import_sessions = {}
        server.amazon_import_lock = threading.Lock()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(json.dumps({"baseURL": f"http://127.0.0.1:{server.server_port}", "csvPath": str(csv_path)}), flush=True)
        try:
            # The test runner owns stdin. Normal teardown, runner exit, and Ctrl-C
            # all release it, so no process discovery or unrelated server stop is needed.
            sys.stdin.buffer.read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
