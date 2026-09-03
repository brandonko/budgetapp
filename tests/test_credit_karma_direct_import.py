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

from server import (  # noqa: E402
    BudgetRequestHandler,
    ThreadingHTTPServer,
    classifications_path,
    initialize_csv_if_missing,
)


class CreditKarmaDirectImportTests(unittest.TestCase):
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
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def create_session(self, **options: bool) -> str:
        status, payload = self.request(
            "POST",
            "/api/creditkarma-import-sessions",
            {"startDate": "2026-08-01", "endDate": "2026-08-31", **options},
        )
        self.assertEqual(status, 201)
        self.assertEqual(payload["source"], "creditkarma")
        return payload["token"]

    @staticmethod
    def export() -> str:
        def transaction(description: str, amount: float, transaction_type: str):
            return {
                "date": "2026-08-20",
                "description": description,
                "amount": amount,
                "transactionType": transaction_type,
                "category": "Dining",
                "accountName": "Test card",
                "accountType": "CREDIT",
                "provider": "Test provider",
            }

        return json.dumps(
            {
                "format": "budgetlens",
                "version": 1,
                "transactions": [
                    transaction("Same-day coffee", 4.5, "debit"),
                    transaction("Same-day coffee", 4.5, "debit"),
                    transaction("Paycheck", 100, "credit"),
                    transaction("AMAZON MARKETPLACE", 12, "debit"),
                    transaction("ALIPAY US", 8, "debit"),
                    transaction("VENMO PAYMENT", 14, "debit"),
                ],
                "netWorthHistory": [],
                "investmentHistory": [],
                "netWorthBreakdown": [],
                "wealthAccounts": [],
            }
        )

    def test_imports_budgetlens_all_transactions_and_preserves_occurrences(self) -> None:
        token = self.create_session()
        status, result = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/complete",
            {"content": self.export()},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["import"]["new"], 3)
        self.assertEqual(len(result["import"]["transactions"]), 3)
        self.assertEqual(
            [transaction["date"] for transaction in result["import"]["transactions"]],
            sorted(
                [transaction["date"] for transaction in result["import"]["transactions"]],
                reverse=True,
            ),
        )
        self.assertEqual(
            result["import"]["sources"]["creditkarma"]["amazonTransactionsIgnored"],
            1,
        )
        self.assertEqual(
            result["import"]["sources"]["creditkarma"]["aliExpressTransactionsIgnored"],
            1,
        )
        self.assertEqual(
            result["import"]["sources"]["creditkarma"]["venmoTransactionsIgnored"],
            1,
        )

        status, committed = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/commit",
            {"transactions": result["import"]["transactions"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 3)

        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 3)
        self.assertEqual([row["amount"] for row in rows].count("4.50"), 2)
        self.assertEqual(next(row["amount"] for row in rows if row["description"] == "Paycheck"), "-100.00")

        second_token = self.create_session()
        status, duplicate = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{second_token}/complete",
            {"content": self.export()},
        )
        self.assertEqual(status, 200)
        self.assertEqual(duplicate["import"]["new"], 0)
        self.assertEqual(duplicate["import"]["duplicates"], 3)
        self.assertTrue(all(row["_isDuplicate"] for row in duplicate["import"]["transactions"]))

    def test_filter_options_can_keep_amazon_and_alipay_transactions(self) -> None:
        token = self.create_session(ignoreAmazon=False, ignoreAliExpress=False, ignoreVenmo=False)
        status, result = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/complete",
            {"content": self.export()},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["import"]["new"], 6)
        descriptions = {row["description"] for row in result["import"]["transactions"]}
        self.assertIn("AMAZON MARKETPLACE", descriptions)
        self.assertIn("ALIPAY US", descriptions)
        self.assertIn("VENMO PAYMENT", descriptions)

    def test_import_collapses_source_whitespace_before_classification_and_storage(self) -> None:
        classifications_path(self.csv_path).write_text(
            json.dumps(
                {
                    "version": 2,
                    "classifications": [
                        {
                            "updates": {
                                "category": "Recurring",
                                "subcategory": "Auto",
                            },
                            "rules": [{"description": "ally des:ally paymt"}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        export = json.loads(self.export())
        export["transactions"] = [
            {
                **export["transactions"][0],
                "description": "ALLY             DES:ALLY PAYMT   ID:123",
            }
        ]

        token = self.create_session()
        status, result = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/complete",
            {"content": json.dumps(export)},
        )

        self.assertEqual(status, 200)
        [preview] = result["import"]["transactions"]
        self.assertEqual(preview["description"], "ALLY DES:ALLY PAYMT ID:123")
        self.assertEqual(preview["category"], "Recurring")
        self.assertEqual(preview["subcategory"], "Auto")

        status, _committed = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/commit",
            {"transactions": [preview]},
        )
        self.assertEqual(status, 200)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            [saved] = list(csv.DictReader(handle))
        self.assertEqual(saved["description"], "ALLY DES:ALLY PAYMT ID:123")

    def test_sessions_are_source_scoped_and_support_progress(self) -> None:
        token = self.create_session()
        status, missing = self.request("GET", f"/api/amazon-import-sessions/{token}")
        self.assertEqual(status, 404)
        self.assertIn("not found", missing["error"].lower())

        status, progress = self.request(
            "POST",
            f"/api/creditkarma-import-sessions/{token}/progress",
            {
                "status": "waiting_for_credit_karma",
                "progress": 2,
                "message": "Waiting for sign-in",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(progress["status"], "waiting_for_credit_karma")


if __name__ == "__main__":
    unittest.main()
