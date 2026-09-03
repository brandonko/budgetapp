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
    def test_matchers_treat_repeated_source_whitespace_as_one_space(self) -> None:
        document = normalize_classifications(
            {
                "version": 2,
                "classifications": [
                    {
                        "updates": {"category": "Recurring", "subcategory": "Auto"},
                        "rules": [{"description": "ally des:ally paymt"}],
                    }
                ],
            }
        )

        [classified] = apply_classifications(
            [transaction(description="ALLY             DES:ALLY PAYMT ID:123")],
            document,
        )

        self.assertEqual(classified["category"], "Recurring")
        self.assertEqual(classified["subcategory"], "Auto")

    def test_mass_action_can_update_supported_fields_and_preserve_other_flags(self) -> None:
        document = normalize_classifications(
            {
                "version": 2,
                "classifications": [
                    {
                        "updates": {
                            "description": "Corrected purchase",
                            "category": "Food",
                            "subcategory": "Restaurants",
                            "accountName": "Gold Card",
                            "accountType": "CREDIT CARD",
                            "provider": "American Express",
                            "notes": "Reviewed in bulk",
                            "refunded": True,
                        },
                        "rules": [{"description": "whole foods"}],
                    }
                ],
            }
        )

        [classified] = apply_classifications(
            [transaction(flags="manual")], document
        )

        self.assertEqual(classified["date"], "2026-08-20")
        self.assertEqual(classified["description"], "Corrected purchase")
        self.assertEqual(classified["amount"], 42.50)
        self.assertEqual(classified["category"], "Food")
        self.assertEqual(classified["subcategory"], "Restaurants")
        self.assertEqual(classified["accountName"], "Gold Card")
        self.assertEqual(classified["accountType"], "CREDIT CARD")
        self.assertEqual(classified["provider"], "American Express")
        self.assertEqual(classified["notes"], "Reviewed in bulk")
        self.assertEqual(classified["flags"], "manual,refunded")

    def test_classifications_are_sorted_alphabetically_and_legacy_amount_actions_are_dropped(self) -> None:
        document = normalize_classifications(
            {
                "version": 2,
                "classifications": [
                    {
                        "updates": {"category": "Travel", "date": "2026-01-01", "amount": 1},
                        "rules": [{"description": "flight"}],
                    },
                    {
                        "updates": {"refunded": True},
                        "rules": [{"description": "refund"}],
                    },
                    {
                        "updates": {"category": "Food", "subcategory": "Restaurants"},
                        "rules": [{"description": "cafe"}],
                    },
                ],
            }
        )

        self.assertEqual(
            [classification["updates"]["category"] for classification in document["classifications"]],
            ["Food", "Travel", None],
        )
        travel_updates = document["classifications"][1]["updates"]
        self.assertNotIn("date", travel_updates)
        self.assertNotIn("amount", travel_updates)

    def test_null_actions_leave_values_untouched_and_refund_can_be_removed(self) -> None:
        document = normalize_classifications(
            {
                "classifications": [
                    {
                        "updates": {"subcategory": "", "notes": "", "refunded": False},
                        "rules": [{"provider": "chase"}],
                    }
                ]
            }
        )
        [classified] = apply_classifications(
            [transaction(subcategory="Groceries", notes="old", flags="refunded,manual")],
            document,
        )
        self.assertEqual(classified["category"], "Shopping")
        self.assertEqual(classified["subcategory"], "")
        self.assertEqual(classified["notes"], "")
        self.assertEqual(classified["flags"], "manual")

    def test_internal_transfer_action_can_exclude_or_force_include(self) -> None:
        excluded_document = normalize_classifications(
            {
                "classifications": [
                    {
                        "updates": {"internalTransfer": True},
                        "rules": [{"description": "payment"}],
                    }
                ]
            }
        )
        [excluded] = apply_classifications(
            [transaction(description="CARD PAYMENT", flags="manual,include-in-budget")],
            excluded_document,
        )
        self.assertEqual(excluded["flags"], "internal-transfer,manual")

        included_document = normalize_classifications(
            {
                "classifications": [
                    {
                        "updates": {"internalTransfer": False},
                        "rules": [{"description": "payment"}],
                    }
                ]
            }
        )
        [included] = apply_classifications([excluded], included_document)
        self.assertEqual(included["flags"], "include-in-budget,manual")

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
                                "notes": "Most shared grocery purchases are paid with this card.",
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

    def test_rule_notes_are_normalized_but_do_not_participate_in_matching(self) -> None:
        document = normalize_classifications(
            {
                "classifications": [
                    {
                        "category": "Food",
                        "subcategory": "Restaurants",
                        "rules": [
                            {
                                "description": "venmo",
                                "notes": "  Usually reimbursements for meals.\nConfirm exceptions manually.  ",
                            }
                        ],
                    }
                ]
            }
        )
        rule = document["classifications"][0]["rules"][0]
        self.assertEqual(
            rule["notes"],
            "Usually reimbursements for meals.\nConfirm exceptions manually.",
        )
        [matched] = apply_classifications([transaction(description="VENMO PAYMENT")], document)
        [unmatched] = apply_classifications([transaction(description="BOOK STORE")], document)
        self.assertEqual((matched["category"], matched["subcategory"]), ("Food", "Restaurants"))
        self.assertEqual((unmatched["category"], unmatched["subcategory"]), ("Shopping", ""))

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
        with self.assertRaisesRegex(CsvDataError, "change at least one transaction field"):
            normalize_classifications(
                {
                    "classifications": [
                        {"updates": {}, "rules": [{"description": "market"}]}
                    ]
                }
            )
        with self.assertRaisesRegex(CsvDataError, "true, false, or null"):
            normalize_classifications(
                {
                    "classifications": [
                        {
                            "updates": {"refunded": "yes"},
                            "rules": [{"description": "market"}],
                        }
                    ]
                }
            )
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
        with self.assertRaisesRegex(CsvDataError, "notes must be text"):
            normalize_classifications(
                {
                    "classifications": [
                        {
                            "category": "Food",
                            "rules": [{"description": "venmo", "notes": 42}],
                        }
                    ]
                }
            )
        with self.assertRaisesRegex(CsvDataError, "notes cannot exceed 2000 characters"):
            normalize_classifications(
                {
                    "classifications": [
                        {
                            "category": "Food",
                            "rules": [{"description": "venmo", "notes": "x" * 2001}],
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
        self.assertEqual(empty, {"version": 2, "classifications": []})

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
                            "notes": "This market is where we buy groceries.\nKeep separate from dining.",
                        }
                    ],
                }
            ],
        }
        expected = normalize_classifications(document)
        status, saved = self.request("PUT", "/api/classifications", document)
        self.assertEqual(status, 200)
        self.assertEqual(saved, expected)
        self.assertEqual(
            json.loads(classifications_path(self.csv_path).read_text(encoding="utf-8")),
            expected,
        )

        with urlopen(f"{self.base_url}/api/classifications/export", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), expected)
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
        self.assertTrue(row["_classificationMatched"])

    def test_direct_import_preview_marks_transactions_that_match_no_rule(self) -> None:
        status, session = self.request(
            "POST",
            "/api/applecard-import-sessions",
            {"startDate": "2026-08-01", "endDate": "2026-08-31"},
        )
        self.assertEqual(status, 201)
        apple_csv = (
            "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n"
            "08/20/2026,08/21/2026,BOOK STORE,Book Store,Shopping,Purchase,5.25\n"
        )
        status, preview = self.request(
            "POST",
            f'/api/applecard-import-sessions/{session["token"]}/complete',
            {"content": apple_csv},
        )

        self.assertEqual(status, 200)
        [row] = preview["import"]["transactions"]
        self.assertFalse(row["_classificationMatched"])

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

    def test_preview_and_apply_report_all_mass_action_fields(self) -> None:
        initialize_csv_if_missing(self.csv_path)
        write_transactions_atomic(
            self.csv_path,
            [transaction(description="RETURNED ITEM", flags="manual")],
        )
        document = {
            "version": 2,
            "classifications": [
                {
                    "updates": {
                        "category": "Shopping",
                        "subcategory": "Returns",
                        "notes": "Refund confirmed",
                        "refunded": True,
                    },
                    "rules": [{"description": "returned item"}],
                }
            ],
        }

        status, preview = self.request("POST", "/api/classifications/preview", document)
        self.assertEqual(status, 200)
        self.assertEqual(
            preview["changes"][0]["changedFields"],
            ["subcategory", "notes", "refunded"],
        )
        self.assertFalse(preview["changes"][0]["before"]["refunded"])
        self.assertTrue(preview["changes"][0]["after"]["refunded"])

        status, result = self.request(
            "POST",
            "/api/classifications/apply",
            {"confirm": True, "revision": preview["revision"], "document": document},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["changed"], 1)
        [saved], _revision = read_transaction_state(self.csv_path)
        self.assertEqual(saved["subcategory"], "Returns")
        self.assertEqual(saved["notes"], "Refund confirmed")
        self.assertEqual(saved["flags"], "manual,refunded")

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
