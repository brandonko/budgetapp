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
    COLUMNS,
    LEGACY_COLUMNS,
    ThreadingHTTPServer,
    initialize_csv_if_missing,
    migrate_transaction_schema,
    read_transaction_state,
)


class AmazonDirectImportTests(unittest.TestCase):
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

    def create_session(self, **options: str):
        status, payload = self.request(
            "POST",
            "/api/amazon-import-sessions",
            {"startDate": "2026-01-01", "endDate": "2026-08-31", **options},
        )
        self.assertEqual(status, 201)
        self.assertRegex(payload["token"], r"^[A-Za-z0-9_-]{32,}$")
        return payload["token"]

    def test_completes_import_and_skips_repeat_occurrences(self) -> None:
        export = json.dumps(
            [
                {
                    "orderDate": "2026-08-20",
                    "items": [
                        {"title": "First item", "price": 10, "quantity": 1},
                        {"title": "Second item", "price": 10, "quantity": 1},
                    ],
                }
            ]
        )

        first_token = self.create_session()
        status, first = self.request(
            "POST",
            f"/api/amazon-import-sessions/{first_token}/complete",
            {"content": export},
        )
        self.assertEqual(status, 200)
        self.assertEqual(first["status"], "review")
        self.assertEqual(first["import"]["new"], 2)
        self.assertEqual(first["import"]["duplicates"], 0)
        self.assertEqual(len(first["import"]["transactions"]), 2)
        self.assertEqual(
            {transaction["description"] for transaction in first["import"]["transactions"]},
            {"First item", "Second item"},
        )
        self.assertTrue(
            all(
                isinstance(transaction["_stagedId"], int)
                for transaction in first["import"]["transactions"]
            )
        )
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(list(csv.DictReader(handle)), [])
        status, first_committed = self.request(
            "POST",
            f"/api/amazon-import-sessions/{first_token}/commit",
            {"transactions": first["import"]["transactions"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(first_committed["status"], "complete")
        self.assertEqual(first_committed["import"]["committed"], 2)

        second_token = self.create_session()
        status, second = self.request(
            "POST",
            f"/api/amazon-import-sessions/{second_token}/complete",
            {"content": export},
        )
        self.assertEqual(status, 200)
        self.assertEqual(second["import"]["new"], 0)
        self.assertEqual(second["import"]["duplicates"], 2)
        self.assertTrue(all(row["_isDuplicate"] for row in second["import"]["transactions"]))

        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 2)
        self.assertEqual(set(rows[0]), set(COLUMNS))
        self.assertEqual([row["amount"] for row in rows], ["11.05", "11.05"])
        self.assertTrue(all(row["accountName"] == "Prime VISA" for row in rows))
        self.assertTrue(all(row["accountType"] == "CREDIT CARD" for row in rows))
        self.assertTrue(all(row["provider"] == "chase" for row in rows))

        created = first_committed["import"]["transactions"][0]
        edited = {column: created[column] for column in COLUMNS}
        edited["description"] = "Reviewed imported item"
        edited["category"] = "Household"
        edited["notes"] = "Gift, keep the receipt\nReturn window ends September 15."
        status, updated = self.request(
            "PUT",
            f"/api/transactions/{created['_id']}",
            {"revision": second["import"]["revision"], "transaction": edited},
        )
        self.assertEqual(status, 200)
        self.assertTrue(
            any(
                transaction["description"] == "Reviewed imported item"
                and transaction["category"] == "Household"
                and transaction["notes"] == edited["notes"]
                for transaction in updated["transactions"]
            )
        )

    def test_direct_import_creates_missing_transaction_file(self) -> None:
        self.csv_path.unlink()
        export = json.dumps(
            [
                {
                    "orderDate": "2026-08-20",
                    "items": [{"title": "First imported item", "price": 10, "quantity": 1}],
                }
            ]
        )

        token = self.create_session()
        status, completed = self.request(
            "POST",
            f"/api/amazon-import-sessions/{token}/complete",
            {"content": export},
        )

        self.assertEqual(status, 200)
        self.assertEqual(completed["import"]["new"], 1)
        self.assertFalse(self.csv_path.exists())
        status, committed = self.request(
            "POST",
            f"/api/amazon-import-sessions/{token}/commit",
            {"transactions": completed["import"]["transactions"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 1)
        self.assertTrue(self.csv_path.exists())
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), set(COLUMNS))

    def test_cancelled_preview_writes_nothing_and_duplicate_can_be_forced(self) -> None:
        export = json.dumps([{"orderDate": "2026-08-20", "items": [
            {"title": "Item", "price": 10, "quantity": 1}
        ]}])
        token = self.create_session()
        _, preview = self.request("POST", f"/api/amazon-import-sessions/{token}/complete", {"content": export})
        _, cancelled = self.request("POST", f"/api/amazon-import-sessions/{token}/cancel", {})
        self.assertEqual(cancelled["status"], "cancelled")
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(list(csv.DictReader(handle)), [])

        token = self.create_session()
        _, preview = self.request("POST", f"/api/amazon-import-sessions/{token}/complete", {"content": export})
        self.request("POST", f"/api/amazon-import-sessions/{token}/commit", {"transactions": preview["import"]["transactions"]})
        token = self.create_session()
        _, duplicate = self.request("POST", f"/api/amazon-import-sessions/{token}/complete", {"content": export})
        self.assertTrue(duplicate["import"]["transactions"][0]["_isDuplicate"])
        status, forced = self.request("POST", f"/api/amazon-import-sessions/{token}/commit", {
            "transactions": duplicate["import"]["transactions"]
        })
        self.assertEqual(status, 200)
        self.assertEqual(forced["import"]["committed"], 1)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(len(list(csv.DictReader(handle))), 2)

    def test_commit_writes_only_selected_rows_and_rejects_a_stale_preview(self) -> None:
        export = json.dumps([{"orderDate": "2026-08-20", "items": [
            {"title": "First", "price": 10, "quantity": 1},
            {"title": "Second", "price": 20, "quantity": 1},
        ]}])
        token = self.create_session()
        _, preview = self.request("POST", f"/api/amazon-import-sessions/{token}/complete", {"content": export})
        selected = [row for row in preview["import"]["transactions"] if row["description"] == "Second"]
        status, committed = self.request("POST", f"/api/amazon-import-sessions/{token}/commit", {
            "transactions": selected
        })
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 1)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual([row["description"] for row in csv.DictReader(handle)], ["Second"])

        token = self.create_session()
        _, stale_preview = self.request("POST", f"/api/amazon-import-sessions/{token}/complete", {"content": export})
        status, state = self.request("GET", "/api/transactions")
        self.assertEqual(status, 200)
        self.request("POST", "/api/transactions", {
            "revision": state["revision"],
            "transaction": {
                "date": "2026-08-21", "description": "Concurrent edit", "amount": 1,
                "category": "Other", "accountName": "Cash", "accountType": "CASH",
                "provider": "Manual", "notes": "",
            },
        })
        status, conflict = self.request("POST", f"/api/amazon-import-sessions/{token}/commit", {
            "transactions": stale_preview["import"]["transactions"]
        })
        self.assertEqual(status, 409)
        self.assertIn("changed during review", conflict["error"])


    def test_migrates_legacy_csv_with_blank_notes_without_losing_rows(self) -> None:
        legacy_path = Path(self.temporary_directory.name) / "legacy.csv"
        legacy_row = {
            "date": "2026-08-20",
            "description": "Legacy purchase",
            "amount": "12.34",
            "category": "Shopping",
            "accountName": "Card",
            "accountType": "CREDIT",
            "provider": "Bank",
        }
        with legacy_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=LEGACY_COLUMNS)
            writer.writeheader()
            writer.writerow(legacy_row)

        self.assertTrue(migrate_transaction_schema(legacy_path))
        transactions, _revision = read_transaction_state(legacy_path)
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0]["description"], "Legacy purchase")
        self.assertEqual(transactions[0]["notes"], "")
        with legacy_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(next(csv.reader(handle)), list(COLUMNS))
        self.assertFalse(migrate_transaction_schema(legacy_path))

    def test_progress_cancel_and_terminal_updates_are_idempotent(self) -> None:
        token = self.create_session()
        status, progress = self.request(
            "POST",
            f"/api/amazon-import-sessions/{token}/progress",
            {"status": "scraping", "progress": 42, "message": "Collecting orders"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(progress["progress"], 42)

        status, cancelled = self.request(
            "POST", f"/api/amazon-import-sessions/{token}/cancel", {}
        )
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["status"], "cancelled")

        status, still_cancelled = self.request(
            "POST",
            f"/api/amazon-import-sessions/{token}/progress",
            {"status": "scraping", "progress": 80, "message": "Too late"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(still_cancelled["status"], "cancelled")

    def test_rejects_invalid_date_range_and_invalid_export(self) -> None:
        status, error = self.request(
            "POST",
            "/api/amazon-import-sessions",
            {"startDate": "2026-09-01", "endDate": "2026-01-01"},
        )
        self.assertEqual(status, 400)
        self.assertIn("cannot be after", error["error"])

        status, error = self.request(
            "POST",
            "/api/amazon-import-sessions",
            {
                "startDate": "2026-08-01",
                "endDate": "2026-08-31",
                "accountName": " ",
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("account fields", error["error"])

        token = self.create_session()
        status, error = self.request(
            "POST",
            f"/api/amazon-import-sessions/{token}/complete",
            {"content": "not json"},
        )
        self.assertEqual(status, 400)
        self.assertIn("invalid JSON", error["error"])

        status, session = self.request(
            "GET", f"/api/amazon-import-sessions/{token}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(session["status"], "error")

    def test_existing_file_upload_endpoint_still_uses_shared_merge_logic(self) -> None:
        status, state = self.request("GET", "/api/transactions")
        self.assertEqual(status, 200)
        credit_karma = json.dumps(
            {
                "transactions": [
                    {
                        "date": "2026-08-21",
                        "description": "Coffee",
                        "amount": 4.5,
                        "transactionType": "debit",
                        "category": "Dining",
                        "accountName": "Test card",
                        "accountType": "CREDIT",
                        "provider": "Test provider",
                    }
                ]
            }
        )
        status, imported = self.request(
            "POST",
            "/api/import",
            {
                "revision": state["revision"],
                "files": {"creditkarma": {"name": "credit.json", "content": credit_karma}},
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(imported["import"]["added"], 1)
        self.assertEqual(imported["transactions"][0]["amount"], 4.5)

    def test_missing_transaction_file_can_be_initialized_from_api(self) -> None:
        self.csv_path.unlink()

        status, missing = self.request("GET", "/api/transactions")
        self.assertEqual(status, 404)
        self.assertEqual(missing["code"], "transaction_file_missing")

        status, initialized = self.request("POST", "/api/transactions/initialize")
        self.assertEqual(status, 201)
        self.assertEqual(initialized["transactions"], [])
        self.assertTrue(initialized["revision"])
        self.assertTrue(self.csv_path.exists())

        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            self.assertEqual(next(csv.reader(handle)), list(COLUMNS))

        status, unchanged = self.request("POST", "/api/transactions/initialize")
        self.assertEqual(status, 200)
        self.assertEqual(unchanged["revision"], initialized["revision"])

    def test_import_page_is_canonical_and_legacy_upload_url_redirects(self) -> None:
        with urlopen(f"{self.base_url}/import", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("Import data", response.read().decode("utf-8"))
        with urlopen(f"{self.base_url}/upload", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.geturl(), f"{self.base_url}/import")


if __name__ == "__main__":
    unittest.main()
