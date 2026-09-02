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
    ThreadingHTTPServer,
    initialize_csv_if_missing,
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

    def create_session(self):
        status, payload = self.request(
            "POST",
            "/api/amazon-import-sessions",
            {"startDate": "2026-01-01", "endDate": "2026-08-31"},
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
        self.assertEqual(first["status"], "complete")
        self.assertEqual(first["import"]["added"], 2)

        second_token = self.create_session()
        status, second = self.request(
            "POST",
            f"/api/amazon-import-sessions/{second_token}/complete",
            {"content": export},
        )
        self.assertEqual(status, 200)
        self.assertEqual(second["import"]["added"], 0)
        self.assertEqual(second["import"]["duplicatesSkipped"], 2)

        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 2)
        self.assertEqual(set(rows[0]), set(COLUMNS))
        self.assertEqual([row["amount"] for row in rows], ["11.05", "11.05"])

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


if __name__ == "__main__":
    unittest.main()
