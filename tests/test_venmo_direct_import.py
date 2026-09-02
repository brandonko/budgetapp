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

from importers import ImportDataError, parse_venmo  # noqa: E402
from server import BudgetRequestHandler, ThreadingHTTPServer, initialize_csv_if_missing  # noqa: E402


HEADER = ",ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (fee),Funding Source,Destination\n"


class VenmoParserTests(unittest.TestCase):
    def test_parses_official_csv_signs_and_excludes_non_budget_activity(self) -> None:
        content = (
            "Account Statement - (@ledger)\n\n"
            + HEADER
            + ',1,08/20/2026 13:15:00,Payment,Complete,Dinner,Me,Alex,- $24.50,,Visa 1234,Alex\n'
            + ',2,08/21/2026 09:00:00,Payment,Complete,Rent,Jordan,Me,+ $700.00,,Jordan,Venmo balance\n'
            + ',3,08/22/2026 09:00:00,Standard Transfer,Complete,,Venmo,Bank,+ $100.00,,,Bank\n'
            + ',4,08/23/2026 09:00:00,Payment,Pending,Coffee,Me,Taylor,- $5.00,,,Taylor\n'
            + "In case of errors, contact Venmo support\n"
        )
        transactions = parse_venmo(content)
        self.assertEqual(len(transactions), 2)
        self.assertEqual(transactions[0]["description"], "Alex — Dinner")
        self.assertEqual(transactions[0]["amount"], 24.5)
        self.assertEqual(transactions[1]["description"], "Jordan — Rent")
        self.assertEqual(transactions[1]["amount"], -700.0)
        self.assertEqual(transactions[0]["accountName"], "Checking Account")
        self.assertEqual(transactions[0]["accountType"], "BANK")
        self.assertEqual(transactions[0]["provider"], "Bank of America")

    def test_accepts_monthly_statement_envelope_and_rejects_unknown_csv(self) -> None:
        first = HEADER + ',1,2026-08-01T12:00:00,Payment,Complete,Lunch,Me,A,- $8.00,,,,\n'
        second = HEADER + ',2,2026-09-01T12:00:00,Payment,Complete,Lunch,Me,A,- $8.00,,,,\n'
        parsed = parse_venmo(json.dumps({"statements": [{"content": first}, {"content": second}]}))
        self.assertEqual([row["date"] for row in parsed], ["2026-08-01", "2026-09-01"])
        with self.assertRaises(ImportDataError):
            parse_venmo("not,a,venmo,statement")


class VenmoDirectImportTests(unittest.TestCase):
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

    def test_session_imports_and_deduplicates_venmo_statement(self) -> None:
        status, created = self.request("POST", "/api/venmo-import-sessions", {
            "startDate": "2026-08-01", "endDate": "2026-08-31",
            "accountName": "Venmo balance", "accountType": "WALLET", "provider": "Venmo",
        })
        self.assertEqual(status, 201)
        self.assertEqual(created["source"], "venmo")
        token = created["token"]
        self.assertEqual(self.request("GET", f"/api/amazon-import-sessions/{token}")[0], 404)
        content = HEADER + ',1,08/20/2026 13:15:00,Payment,Complete,Dinner,Me,Alex,- $24.50,,,,\n'
        status, completed = self.request(
            "POST", f"/api/venmo-import-sessions/{token}/complete", {"content": content},
        )
        self.assertEqual(status, 200)
        self.assertEqual(completed["status"], "review")
        self.assertEqual(completed["import"]["new"], 1)
        _, committed = self.request(
            "POST", f"/api/venmo-import-sessions/{token}/commit",
            {"transactions": completed["import"]["transactions"]},
        )
        self.assertEqual(committed["import"]["committed"], 1)
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(rows[0]["amount"], "24.50")
        self.assertEqual(rows[0]["accountName"], "Venmo balance")
        self.assertEqual(rows[0]["accountType"], "WALLET")
        self.assertEqual(rows[0]["provider"], "Venmo")

        _, second = self.request("POST", "/api/venmo-import-sessions", {
            "startDate": "2026-08-01", "endDate": "2026-08-31",
        })
        _, duplicate = self.request(
            "POST", f'/api/venmo-import-sessions/{second["token"]}/complete', {"content": content},
        )
        self.assertEqual(duplicate["import"]["new"], 0)
        self.assertEqual(duplicate["import"]["duplicates"], 1)


if __name__ == "__main__":
    unittest.main()
