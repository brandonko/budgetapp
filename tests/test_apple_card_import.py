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

from importers import ImportDataError, parse_apple_card  # noqa: E402
from server import BudgetRequestHandler, ThreadingHTTPServer  # noqa: E402


APPLE_CARD_CSV = """Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)
08/20/2026,08/21/2026,COFFEE SHOP,Coffee Shop,Food & Drink,Purchase,5.25
08/22/2026,08/23/2026,RETURNED ITEM,Store,Shopping,Refund,12.00
08/24/2026,08/24/2026,PAYMENT THANK YOU,,Payment,Payment,100.00
"""


class AppleCardParserTests(unittest.TestCase):
    def test_parses_official_csv_with_ledger_signs(self) -> None:
        transactions = parse_apple_card(APPLE_CARD_CSV)
        self.assertEqual(len(transactions), 3)
        self.assertEqual(transactions[0]["date"], "2026-08-20")
        self.assertEqual(transactions[0]["amount"], 5.25)
        self.assertEqual(transactions[1]["amount"], -12.0)
        self.assertEqual(transactions[2]["amount"], -100.0)
        self.assertEqual(transactions[2]["category"], "Transfer")
        self.assertEqual(transactions[0]["accountName"], "Apple Card")
        self.assertEqual(transactions[0]["accountType"], "CREDIT CARD")
        self.assertEqual(transactions[0]["provider"], "Goldman Sachs")

    def test_rejects_non_apple_card_csv(self) -> None:
        with self.assertRaises(ImportDataError):
            parse_apple_card("date,merchant,amount\n2026-08-20,Coffee,5.00\n")

    def test_rejects_unknown_or_blank_transaction_types(self) -> None:
        template = (
            "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n"
            "08/20/2026,08/21/2026,ADJUSTMENT,Apple,Other,{transaction_type},5.25\n"
        )
        for transaction_type in ("Adjustment", ""):
            with self.subTest(transaction_type=transaction_type or "blank"):
                with self.assertRaisesRegex(ImportDataError, r"Type is not supported"):
                    parse_apple_card(template.format(transaction_type=transaction_type))


class AppleCardDirectImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "transactions.csv"
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
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_imports_csv_filters_range_and_creates_missing_database(self) -> None:
        status, session = self.request(
            "POST",
            "/api/applecard-import-sessions",
            {
                "startDate": "2026-08-21",
                "endDate": "2026-08-31",
                "accountName": "My Apple Card",
                "accountType": "CARD",
                "provider": "Apple",
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(session["source"], "applecard")
        status, completed = self.request(
            "POST",
            f'/api/applecard-import-sessions/{session["token"]}/complete',
            {"content": APPLE_CARD_CSV},
        )
        self.assertEqual(status, 200)
        self.assertEqual(completed["status"], "review")
        self.assertEqual(completed["import"]["new"], 2)
        self.assertFalse(self.csv_path.exists())
        status, committed = self.request(
            "POST",
            f'/api/applecard-import-sessions/{session["token"]}/commit',
            {"transactions": completed["import"]["transactions"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 2)
        self.assertTrue(self.csv_path.exists())
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["accountName"] == "My Apple Card" for row in rows))
        self.assertTrue(all(row["provider"] == "Apple" for row in rows))

    def test_manual_csv_session_can_review_every_row_without_date_filtering(self) -> None:
        status, session = self.request(
            "POST",
            "/api/applecard-import-sessions",
            {
                "startDate": "2026-08-21",
                "endDate": "2026-08-31",
                "filterDateRange": False,
            },
        )
        self.assertEqual(status, 201)
        status, completed = self.request(
            "POST",
            f'/api/applecard-import-sessions/{session["token"]}/complete',
            {"content": APPLE_CARD_CSV},
        )
        self.assertEqual(status, 200)
        self.assertEqual(completed["import"]["parsed"], 3)
        self.assertEqual(completed["import"]["new"], 3)
        self.assertFalse(self.csv_path.exists())


if __name__ == "__main__":
    unittest.main()
