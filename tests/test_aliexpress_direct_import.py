from __future__ import annotations

import csv
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

from importers import ImportDataError, parse_aliexpress, parse_credit_karma  # noqa: E402
from server import BudgetRequestHandler, ThreadingHTTPServer, initialize_csv_if_missing  # noqa: E402


class AliExpressParserTests(unittest.TestCase):
    def test_allocates_actual_order_total_across_items(self) -> None:
        content = json.dumps({"orders": [{
            "orderDate": "2026-08-20", "status": "Finished", "currency": "USD",
            "total": "US $25.00", "items": [
                {"title": "Cable", "price": "$10.00", "quantity": 2},
                {"title": "Adapter", "price": "$10.00", "quantity": 1},
            ],
        }]})
        transactions = parse_aliexpress(content)
        self.assertEqual([row["description"] for row in transactions], ["Cable (x2)", "Adapter"])
        self.assertEqual(sum(row["amount"] for row in transactions), 25.0)
        self.assertEqual([row["amount"] for row in transactions], [16.67, 8.33])

    def test_skips_cancelled_orders_and_rejects_non_usd(self) -> None:
        cancelled = {"orderDate": "2026-08-20", "status": "Cancelled", "currency": "USD",
                     "items": [{"title": "Nope", "price": "$1", "quantity": 1}]}
        self.assertEqual(parse_aliexpress(json.dumps({"orders": [cancelled]})), [])
        cancelled["status"] = "Finished"
        cancelled["currency"] = "EUR"
        with self.assertRaises(ImportDataError):
            parse_aliexpress(json.dumps({"orders": [cancelled]}))

    def test_credit_karma_excludes_aggregate_aliexpress_charges(self) -> None:
        transaction = {"date": "2026-08-20", "description": "ALIPAY US*ALIEXPRESS",
            "amount": 12.34, "transactionType": "debit", "category": "Shopping",
            "accountName": "Card", "accountType": "CREDIT", "provider": "Bank"}
        parsed = parse_credit_karma(json.dumps({"transactions": [transaction]}))
        self.assertEqual(parsed.transactions, [])
        self.assertEqual(parsed.ignored_aliexpress_count, 1)
        included = parse_credit_karma(
            json.dumps({"transactions": [transaction]}), ignore_aliexpress=False
        )
        self.assertEqual(included.transactions[0]["amount"], 12.34)
        self.assertEqual(included.ignored_aliexpress_count, 0)


class AliExpressDirectImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "transactions.csv"
        initialize_csv_if_missing(self.csv_path)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
        self.server.csv_path = self.csv_path
        self.server.data_lock = threading.Lock()
        self.server.amazon_import_sessions = {}
        self.server.amazon_import_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def request(self, method: str, path: str, payload: object | None = None):
        body = None if payload is None else json.dumps(payload).encode()
        request = Request(f"{self.base_url}{path}", data=body, method=method,
                          headers={"Content-Type": "application/json"} if body else {})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_session_is_source_scoped_and_imports_items(self) -> None:
        status, created = self.request("POST", "/api/aliexpress-import-sessions",
                                       {"startDate": "2026-08-01", "endDate": "2026-08-31"})
        self.assertEqual(status, 201)
        self.assertEqual(created["source"], "aliexpress")
        token = created["token"]
        self.assertEqual(self.request("GET", f"/api/amazon-import-sessions/{token}")[0], 404)
        content = json.dumps({"orders": [{"orderDate": "2026-08-20", "status": "Finished",
            "currency": "USD", "total": "$12.34",
            "items": [{"title": "Widget", "price": "$10.00", "quantity": 1}]}]})
        status, result = self.request("POST", f"/api/aliexpress-import-sessions/{token}/complete",
                                      {"content": content})
        self.assertEqual(status, 200)
        self.assertEqual(result["import"]["added"], 1)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            row = next(csv.DictReader(handle))
        self.assertEqual(row["description"], "Widget")
        self.assertEqual(row["amount"], "12.34")


if __name__ == "__main__":
    unittest.main()
