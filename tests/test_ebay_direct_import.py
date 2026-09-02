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

from importers import ImportDataError, parse_credit_karma, parse_ebay  # noqa: E402
from server import BudgetRequestHandler, ThreadingHTTPServer, initialize_csv_if_missing  # noqa: E402


EBAY_EXPORT = json.dumps({
    "orders": [
        {
            "orderDate": "2026-08-20",
            "orderId": "12-34567-89012",
            "status": "Delivered",
            "total": "$25.00",
            "currency": "USD",
            "items": [
                {"title": "Cable", "price": "10.00", "quantity": 2, "currency": "USD", "seller": "seller-a"},
                {"title": "Adapter", "price": "10.00", "quantity": 1, "currency": "USD", "seller": "seller-b"},
            ],
        }
    ]
})


class EbayParserTests(unittest.TestCase):
    def test_credit_karma_excludes_aggregate_ebay_charge_by_default(self) -> None:
        transaction = {
            "date": "2026-08-20", "description": "EBAY O*12-34567-89012",
            "amount": 25, "transactionType": "debit", "category": "Shopping",
            "accountName": "Card", "accountType": "CREDIT", "provider": "Bank",
        }
        content = json.dumps({"transactions": [transaction]})
        parsed = parse_credit_karma(content)
        self.assertEqual(parsed.transactions, [])
        self.assertEqual(parsed.ignored_ebay_count, 1)
        included = parse_credit_karma(content, ignore_ebay=False)
        self.assertEqual(included.transactions[0]["amount"], 25.0)

    def test_allocates_order_total_into_item_rows(self) -> None:
        transactions = parse_ebay(EBAY_EXPORT)
        self.assertEqual([row["description"] for row in transactions], ["Cable (x2)", "Adapter"])
        self.assertEqual([row["amount"] for row in transactions], [16.67, 8.33])
        self.assertEqual(sum(row["amount"] for row in transactions), 25.0)
        self.assertEqual(transactions[0]["accountName"], "eBay")
        self.assertIn("Seller: seller-a", transactions[0]["notes"])
        self.assertIn("Order: 12-34567-89012", transactions[0]["notes"])

    def test_skips_cancelled_and_rejects_non_usd_orders(self) -> None:
        cancelled = json.loads(EBAY_EXPORT)
        cancelled["orders"][0]["status"] = "Order canceled"
        self.assertEqual(parse_ebay(json.dumps(cancelled)), [])
        foreign = json.loads(EBAY_EXPORT)
        foreign["orders"][0]["items"][0]["currency"] = "EUR"
        with self.assertRaises(ImportDataError):
            parse_ebay(json.dumps(foreign))


class EbayDirectImportTests(unittest.TestCase):
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
        body = None if payload is None else json.dumps(payload).encode("utf-8")
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

    def test_stages_then_commits_selected_ebay_items(self) -> None:
        status, session = self.request("POST", "/api/ebay-import-sessions", {
            "startDate": "2026-08-01", "endDate": "2026-08-31",
            "accountName": "Mastercard", "accountType": "CREDIT CARD", "provider": "Bank",
        })
        self.assertEqual(status, 201)
        self.assertEqual(session["source"], "ebay")
        token = session["token"]
        status, preview = self.request(
            "POST", f"/api/ebay-import-sessions/{token}/complete", {"content": EBAY_EXPORT}
        )
        self.assertEqual(status, 200)
        self.assertEqual(preview["status"], "review")
        self.assertEqual(preview["import"]["parsed"], 2)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(list(csv.DictReader(handle)), [])

        status, committed = self.request(
            "POST", f"/api/ebay-import-sessions/{token}/commit",
            {"transactions": [preview["import"]["transactions"][0]]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 1)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["accountName"], "Mastercard")


if __name__ == "__main__":
    unittest.main()
