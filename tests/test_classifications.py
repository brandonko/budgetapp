from __future__ import annotations

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
    CsvDataError,
    ThreadingHTTPServer,
    apply_classifications,
    backup_directory,
    classifications_path,
    initialize_csv_if_missing,
    normalize_classifications,
    read_transaction_state,
    write_transactions_atomic,
)


def transaction(**overrides):
    value = {
        "date": "2026-08-20",
        "description": "WHOLE FOODS MARKET",
        "amount": 42.50,
        "category": "Shopping",
        "accountName": "Prime VISA",
        "accountType": "CREDIT CARD",
        "provider": "Chase",
        "notes": "",
    }
    value.update(overrides)
    return value


class ClassificationEngineTests(unittest.TestCase):
    def test_first_matching_rule_wins_and_matchers_within_rule_are_combined(self) -> None:
        document = normalize_classifications(
            {
                "version": 1,
                "classifications": [
                    {
                        "category": "Food",
                        "subcategory": "Groceries",
                        "rules": [
                            {
                                "description": "whole foods",
                                "accountName": "prime visa",
                                "provider": "chase",
                            }
                        ],
                    },
                    {
                        "category": "Miscellaneous",
                        "subcategory": "Leisure",
                        "rules": [{"description": "whole foods"}],
                    },
                ],
            }
        )
        [classified] = apply_classifications([transaction()], document)
        self.assertEqual(classified["category"], "Food")
        self.assertEqual(classified["subcategory"], "Groceries")

        [account_did_not_match] = apply_classifications(
            [transaction(accountName="Debit")], document
        )
        self.assertEqual(account_did_not_match["category"], "Miscellaneous")
        self.assertEqual(account_did_not_match["subcategory"], "Leisure")

    def test_no_match_preserves_source_category_and_adds_blank_subcategory(self) -> None:
        document = normalize_classifications(
            {
                "classifications": [
                    {
                        "category": "Food",
                        "subcategory": "Restaurants",
                        "rules": [{"description": "restaurant"}],
                    }
                ]
            }
        )
        [classified] = apply_classifications([transaction(description="BOOK STORE")], document)
        self.assertEqual(classified["category"], "Shopping")
        self.assertEqual(classified["subcategory"], "")

    def test_category_and_subcategory_regexes_are_independent(self) -> None:
        document = normalize_classifications(
            {
                "classifications": [
                    {
                        "category": "Miscellaneous",
                        "subcategory": "Leisure",
                        "rules": [{"category": "^shopping$"}],
                    }
                ]
            }
        )
        classified = apply_classifications(
            [
                transaction(description="BOOK", category="Shopping"),
                transaction(description="DINNER", category="Dining"),
            ],
            document,
        )
        self.assertEqual(
            (classified[0]["category"], classified[0]["subcategory"]),
            ("Miscellaneous", "Leisure"),
        )
        self.assertEqual((classified[1]["category"], classified[1]["subcategory"]), ("Dining", ""))

        subcategory_document = normalize_classifications(
            {
                "classifications": [
                    {
                        "category": "Food",
                        "subcategory": "Takeout",
                        "rules": [{"subcategory": "^restaurant$"}],
                    }
                ]
            }
        )
        [from_subcategory] = apply_classifications(
            [transaction(category="Food", subcategory="Restaurant")],
            subcategory_document,
        )
        self.assertEqual(
            (from_subcategory["category"], from_subcategory["subcategory"]),
            ("Food", "Takeout"),
        )

    def test_invalid_or_empty_rules_are_rejected(self) -> None:
        with self.assertRaisesRegex(CsvDataError, "valid regular expression"):
            normalize_classifications(
                {
                    "classifications": [
                        {
                            "category": "Food",
                            "subcategory": "Groceries",
                            "rules": [{"description": "["}],
                        }
                    ]
                }
            )
        with self.assertRaisesRegex(CsvDataError, "at least one matcher"):
            normalize_classifications(
                {
                    "classifications": [
                        {
                            "category": "Food",
                            "subcategory": "Groceries",
                            "rules": [{}],
                        }
                    ]
                }
            )


class ClassificationApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "data" / "transactions.csv"
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

    def test_settings_api_persists_and_exports_rules_beside_transaction_csv(self) -> None:
        status, empty = self.request("GET", "/api/classifications")
        self.assertEqual(status, 200)
        self.assertEqual(empty, {"version": 1, "classifications": []})

        document = {
            "version": 1,
            "classifications": [
                {
                    "category": "Food",
                    "subcategory": "Groceries",
                    "rules": [
                        {
                            "category": "",
                            "subcategory": "",
                            "description": "market",
                            "accountName": "",
                            "provider": "",
                        }
                    ],
                }
            ],
        }
        status, saved = self.request("PUT", "/api/classifications", document)
        self.assertEqual(status, 200)
        self.assertEqual(saved, document)
        self.assertEqual(
            json.loads(classifications_path(self.csv_path).read_text(encoding="utf-8")),
            document,
        )

        with urlopen(f"{self.base_url}/api/classifications/export", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), document)
            self.assertIn("ledger-classifications.json", response.headers["Content-Disposition"])

    def test_direct_import_preview_applies_saved_classification(self) -> None:
        document = {
            "version": 1,
            "classifications": [
                {
                    "category": "Food",
                    "subcategory": "Restaurants",
                    "rules": [
                        {"description": "coffee shop", "accountName": "", "provider": "goldman"}
                    ],
                }
            ],
        }
        self.assertEqual(self.request("PUT", "/api/classifications", document)[0], 200)
        status, session = self.request(
            "POST",
            "/api/applecard-import-sessions",
            {"startDate": "2026-08-01", "endDate": "2026-08-31"},
        )
        self.assertEqual(status, 201)
        apple_csv = (
            "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n"
            "08/20/2026,08/21/2026,COFFEE SHOP,Coffee Shop,Food & Drink,Purchase,5.25\n"
        )
        status, preview = self.request(
            "POST",
            f'/api/applecard-import-sessions/{session["token"]}/complete',
            {"content": apple_csv},
        )
        self.assertEqual(status, 200)
        [row] = preview["import"]["transactions"]
        self.assertEqual(row["category"], "Food")
        self.assertEqual(row["subcategory"], "Restaurants")

    def test_bulk_apply_updates_existing_rows_and_creates_one_safety_backup(self) -> None:
        initialize_csv_if_missing(self.csv_path)
        write_transactions_atomic(
            self.csv_path,
            [transaction(description="WHOLE FOODS", category="Shopping")],
        )
        document = {
            "version": 1,
            "classifications": [
                {
                    "category": "Food",
                    "subcategory": "Groceries",
                    "rules": [{"description": "whole foods", "accountName": "", "provider": ""}],
                }
            ],
        }
        status, rejected = self.request("POST", "/api/classifications/apply", {})
        self.assertEqual(status, 400)
        self.assertIn("confirmation", rejected["error"])

        status, preview = self.request(
            "POST", "/api/classifications/preview", document
        )
        self.assertEqual(status, 200)
        self.assertEqual(preview["total"], 1)
        self.assertEqual(preview["changed"], 1)
        self.assertEqual(preview["changes"][0]["before"]["category"], "Shopping")
        self.assertEqual(preview["changes"][0]["after"]["subcategory"], "Groceries")
        self.assertFalse(classifications_path(self.csv_path).exists())

        status, applied = self.request(
            "POST",
            "/api/classifications/apply",
            {"confirm": True, "revision": preview["revision"], "document": document},
        )
        self.assertEqual(status, 200)
        self.assertEqual(applied["total"], 1)
        self.assertEqual(applied["changed"], 1)
        self.assertIsNotNone(applied["backup"])
        [saved], _revision = read_transaction_state(self.csv_path)
        self.assertEqual((saved["category"], saved["subcategory"]), ("Food", "Groceries"))
        backup_count = len(list(backup_directory(self.csv_path).glob("*.csv")))

        status, second_preview = self.request(
            "POST", "/api/classifications/preview", document
        )
        self.assertEqual(status, 200)
        self.assertEqual(second_preview["changed"], 0)
        status, unchanged = self.request(
            "POST",
            "/api/classifications/apply",
            {
                "confirm": True,
                "revision": second_preview["revision"],
                "document": document,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(unchanged["changed"], 0)
        self.assertIsNone(unchanged["backup"])
        self.assertEqual(
            len(list(backup_directory(self.csv_path).glob("*.csv"))), backup_count
        )

    def test_preview_counts_matches_that_already_have_the_destination(self) -> None:
        initialize_csv_if_missing(self.csv_path)
        write_transactions_atomic(
            self.csv_path,
            [
                transaction(description="UBER EATS", category="Food", subcategory="Restaurant"),
                transaction(description="UBER TRIP", category="Auto & transport"),
            ],
        )
        document = {
            "classifications": [
                {
                    "category": "Food",
                    "subcategory": "Restaurant",
                    "rules": [{"description": "uber"}],
                }
            ]
        }

        status, preview = self.request("POST", "/api/classifications/preview", document)

        self.assertEqual(status, 200)
        self.assertEqual(preview["matched"], 2)
        self.assertEqual(preview["changed"], 1)
        self.assertEqual(preview["changes"][0]["description"], "UBER TRIP")

    def test_bulk_apply_rejects_a_stale_transaction_preview(self) -> None:
        initialize_csv_if_missing(self.csv_path)
        original = transaction(description="WHOLE FOODS")
        write_transactions_atomic(self.csv_path, [original])
        document = {
            "classifications": [
                {
                    "category": "Food",
                    "subcategory": "Groceries",
                    "rules": [{"description": "whole foods"}],
                }
            ]
        }
        status, preview = self.request("POST", "/api/classifications/preview", document)
        self.assertEqual(status, 200)
        write_transactions_atomic(
            self.csv_path,
            [original, transaction(description="NEW ROW", amount=1.23)],
        )
        status, conflict = self.request(
            "POST",
            "/api/classifications/apply",
            {"confirm": True, "revision": preview["revision"], "document": document},
        )
        self.assertEqual(status, 409)
        self.assertIn("preview", conflict["error"])


if __name__ == "__main__":
    unittest.main()
