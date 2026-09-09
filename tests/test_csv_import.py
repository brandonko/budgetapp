from __future__ import annotations

import csv
import io
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
    LEDGER_IMPORT_COLUMNS,
    ThreadingHTTPServer,
    read_transaction_state,
)


def ledger_csv(rows: list[dict[str, str]], columns=LEDGER_IMPORT_COLUMNS) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


class CsvImportTests(unittest.TestCase):
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

    def request(self, method: str, path: str, payload: object):
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_valid_rows_are_staged_while_invalid_rows_are_reported(self) -> None:
        content = ledger_csv(
            [
                {"date": "2026-08-01", "description": "Minimal row", "amount": "12.34"},
                {
                    "date": "2026-08-02",
                    "description": "Detailed row",
                    "amount": "45.67",
                    "category": "Food",
                    "subcategory": "Groceries",
                    "tags": "weekly, errands",
                },
                {"date": "2026-08-03", "description": "", "amount": "1.00"},
                {"date": "not-a-date", "description": "Bad date", "amount": "2.00"},
                {"date": "2026-08-05", "description": "Bad amount", "amount": "free"},
            ]
        )
        status, preview = self.request("POST", "/api/csv-import-sessions", {"content": content})
        self.assertEqual(status, 201)
        result = preview["import"]
        self.assertEqual(result["rowCount"], 5)
        self.assertEqual(result["parsed"], 2)
        self.assertEqual(result["invalid"], 3)
        self.assertEqual(result["new"], 2)
        self.assertEqual(result["duplicates"], 0)
        self.assertEqual([row["line"] for row in result["invalidRows"]], [4, 5, 6])
        self.assertFalse(self.csv_path.exists())
        minimal = next(
            row for row in result["transactions"] if row["description"] == "Minimal row"
        )
        self.assertEqual(minimal["category"], "")
        self.assertEqual(minimal["accountName"], "")
        self.assertEqual(minimal["createdAt"], "")

        status, committed = self.request(
            "POST",
            f"/api/csv-import-sessions/{preview['token']}/commit",
            {"transactions": result["transactions"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(committed["import"]["committed"], 2)
        saved, _revision = read_transaction_state(self.csv_path)
        self.assertEqual(len(saved), 2)
        self.assertTrue(all(row["createdAt"].endswith("Z") for row in saved))

    def test_header_must_match_ledger_schema_without_created_at(self) -> None:
        columns = LEDGER_IMPORT_COLUMNS + ("createdAt",)
        content = ledger_csv(
            [{"date": "2026-08-01", "description": "Row", "amount": "1.00"}],
            columns=columns,
        )
        status, payload = self.request("POST", "/api/csv-import-sessions", {"content": content})
        self.assertEqual(status, 400)
        self.assertIn("columns must exactly match", payload["error"])

    def test_saved_classifications_can_be_bypassed(self) -> None:
        self.csv_path.parent.mkdir(parents=True, exist_ok=True)
        (self.csv_path.parent / "classifications.json").write_text(
            json.dumps(
                {
                    "version": 2,
                    "classifications": [
                        {
                            "updates": {
                                "category": "Food",
                                "subcategory": "Restaurant",
                                "notes": "Changed by a saved rule",
                            },
                            "rules": [{"description": "coffee"}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        content = ledger_csv(
            [
                {
                    "date": "2026-08-10",
                    "description": "Coffee Shop",
                    "amount": "8.25",
                    "category": "Personal",
                    "subcategory": "Treat",
                    "notes": "Keep this note",
                }
            ]
        )

        status, classified = self.request(
            "POST", "/api/csv-import-sessions", {"content": content}
        )
        self.assertEqual(status, 201)
        classified_row = classified["import"]["transactions"][0]
        self.assertTrue(classified["import"]["classificationsApplied"])
        self.assertEqual(classified_row["category"], "Food")
        self.assertEqual(classified_row["subcategory"], "Restaurant")
        self.assertEqual(classified_row["notes"], "Changed by a saved rule")

        status, unchanged = self.request(
            "POST",
            "/api/csv-import-sessions",
            {"content": content, "applyClassifications": False},
        )
        self.assertEqual(status, 201)
        unchanged_row = unchanged["import"]["transactions"][0]
        self.assertFalse(unchanged["import"]["classificationsApplied"])
        self.assertEqual(unchanged_row["category"], "Personal")
        self.assertEqual(unchanged_row["subcategory"], "Treat")
        self.assertEqual(unchanged_row["notes"], "Keep this note")
        self.assertTrue(unchanged_row["_classificationMatched"])

        status, invalid = self.request(
            "POST",
            "/api/csv-import-sessions",
            {"content": content, "applyClassifications": "false"},
        )
        self.assertEqual(status, 400)
        self.assertIn("must be a boolean", invalid["error"])


if __name__ == "__main__":
    unittest.main()
