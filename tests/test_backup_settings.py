from __future__ import annotations

import csv
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(APP_DIR))

from server import (  # noqa: E402
    GENERATED_BACKUP_FILENAME,
    BudgetRequestHandler,
    DEFAULT_CSV,
    ThreadingHTTPServer,
    initialize_csv_if_missing,
    read_transaction_state,
    write_transactions_atomic,
)


def transaction(description: str, amount: float) -> dict[str, object]:
    return {
        "date": "2026-09-01",
        "description": description,
        "amount": amount,
        "category": "Other",
        "accountName": "Checking",
        "accountType": "BANK",
        "provider": "Bank",
        "notes": "",
    }


class BackupApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "data" / "transactions.csv"
        initialize_csv_if_missing(self.csv_path)
        write_transactions_atomic(
            self.csv_path,
            [transaction("First", 1), transaction("Second", 2)],
        )
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

    def test_create_list_and_restore_with_a_safety_backup(self) -> None:
        status, initial = self.request("GET", "/api/backups")
        self.assertEqual(status, 200)
        self.assertEqual(initial["backups"], [])

        status, created = self.request("POST", "/api/backups", {})
        self.assertEqual(status, 201)
        backup = created["backup"]
        self.assertRegex(backup["name"], GENERATED_BACKUP_FILENAME)
        self.assertEqual(backup["transactionCount"], 2)
        self.assertTrue((self.csv_path.parent / "backups" / backup["name"]).exists())

        write_transactions_atomic(self.csv_path, [transaction("Replacement", 9)])
        status, rejected = self.request(
            "POST", f'/api/backups/{backup["name"]}/restore', {"confirm": False}
        )
        self.assertEqual(status, 400)
        self.assertIn("confirmation", rejected["error"])
        self.assertEqual(len(read_transaction_state(self.csv_path)[0]), 1)

        status, restored = self.request(
            "POST", f'/api/backups/{backup["name"]}/restore', {"confirm": True}
        )
        self.assertEqual(status, 200)
        self.assertEqual(restored["transactionCount"], 2)
        self.assertEqual(restored["restoredBackup"]["name"], backup["name"])
        self.assertEqual(restored["safetyBackup"]["transactionCount"], 1)

        _, listed = self.request("GET", "/api/backups")
        self.assertEqual(len(listed["backups"]), 2)
        self.assertEqual(
            [item["modifiedAt"] for item in listed["backups"]],
            sorted((item["modifiedAt"] for item in listed["backups"]), reverse=True),
        )

    def test_lists_and_restores_any_csv_filename_in_the_backup_directory(self) -> None:
        backup_directory = self.csv_path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        custom_backup = backup_directory / "My saved transactions.CSV"
        write_transactions_atomic(custom_backup, [transaction("Custom backup", 12)])

        status, listed = self.request("GET", "/api/backups")
        self.assertEqual(status, 200)
        self.assertIn(custom_backup.name, [backup["name"] for backup in listed["backups"]])
        custom = next(backup for backup in listed["backups"] if backup["name"] == custom_backup.name)
        self.assertEqual(custom["transactionCount"], 1)
        self.assertIn("modifiedAt", custom)

        status, restored = self.request(
            "POST",
            f'/api/backups/{quote(custom_backup.name)}/restore',
            {"confirm": True},
        )
        self.assertEqual(status, 200)
        self.assertEqual(restored["transactionCount"], 1)
        self.assertEqual(read_transaction_state(self.csv_path)[0][0]["description"], "Custom backup")

    def test_legacy_backup_is_listed_and_restored_with_blank_notes(self) -> None:
        backup_directory = self.csv_path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        legacy_backup = backup_directory / "transactions_old_export.csv"
        legacy_columns = [
            "date", "description", "amount", "category", "accountName", "accountType", "provider"
        ]
        legacy_row = transaction("Legacy backup", 4)
        legacy_row.pop("notes")
        with legacy_backup.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=legacy_columns)
            writer.writeheader()
            writer.writerow(legacy_row)

        _, listed = self.request("GET", "/api/backups")
        metadata = next(item for item in listed["backups"] if item["name"] == legacy_backup.name)
        self.assertTrue(metadata["valid"])
        self.assertEqual(metadata["transactionCount"], 1)

        status, restored = self.request(
            "POST", f"/api/backups/{legacy_backup.name}/restore", {"confirm": True}
        )
        self.assertEqual(status, 200)
        self.assertEqual(restored["transactionCount"], 1)
        restored_rows, _revision = read_transaction_state(self.csv_path)
        self.assertEqual(restored_rows[0]["notes"], "")
        self.assertEqual(restored_rows[0]["createdAt"], "")

    def test_import_history_groups_batches_and_removes_one_with_a_backup(self) -> None:
        first_timestamp = "2026-09-02T10:00:00.000000Z"
        second_timestamp = "2026-09-02T11:00:00.000000Z"
        rows = [
            dict(transaction("First import A", 1), createdAt=first_timestamp),
            dict(transaction("First import B", 2), createdAt=first_timestamp),
            dict(transaction("Second import", 3), createdAt=second_timestamp),
            transaction("Manual transaction", 4),
        ]
        write_transactions_atomic(self.csv_path, rows)

        status, history = self.request("GET", "/api/import-history")
        self.assertEqual(status, 200)
        self.assertEqual(
            history["imports"],
            [
                {"createdAt": second_timestamp, "transactionCount": 1},
                {"createdAt": first_timestamp, "transactionCount": 2},
            ],
        )

        status, rejected = self.request(
            "DELETE",
            f"/api/import-history/{quote(first_timestamp)}",
            {"confirm": False, "revision": history["revision"]},
        )
        self.assertEqual(status, 400)
        self.assertIn("confirmation", rejected["error"])

        status, removed = self.request(
            "DELETE",
            f"/api/import-history/{quote(first_timestamp)}",
            {"confirm": True, "revision": history["revision"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(removed["removedCount"], 2)
        self.assertEqual(removed["imports"], [{"createdAt": second_timestamp, "transactionCount": 1}])
        self.assertEqual(removed["safetyBackup"]["transactionCount"], 4)
        remaining, _revision = read_transaction_state(self.csv_path)
        self.assertEqual(
            {row["description"] for row in remaining},
            {"Second import", "Manual transaction"},
        )

    def test_delete_backup_requires_confirmation_and_removes_only_selected_file(self) -> None:
        backup_directory = self.csv_path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        selected = backup_directory / "My selected backup.csv"
        retained = backup_directory / "Keep this backup.csv"
        write_transactions_atomic(selected, [transaction("Selected", 4)])
        write_transactions_atomic(retained, [transaction("Retained", 5)])

        status, rejected = self.request(
            "DELETE", f"/api/backups/{quote(selected.name)}", {"confirm": False}
        )
        self.assertEqual(status, 400)
        self.assertIn("confirmation", rejected["error"])
        self.assertTrue(selected.exists())

        status, deleted = self.request(
            "DELETE", f"/api/backups/{quote(selected.name)}", {"confirm": True}
        )
        self.assertEqual(status, 200)
        self.assertEqual(deleted["deletedBackup"]["name"], selected.name)
        self.assertFalse(selected.exists())
        self.assertTrue(retained.exists())

        status, missing = self.request(
            "DELETE", f"/api/backups/{quote(selected.name)}", {"confirm": True}
        )
        self.assertEqual(status, 404)
        self.assertIn("not found", missing["error"].lower())

    def test_missing_master_file_cannot_be_backed_up(self) -> None:
        self.csv_path.unlink()
        status, payload = self.request("POST", "/api/backups", {})
        self.assertEqual(status, 404)
        self.assertEqual(payload["code"], "transaction_file_missing")


class SettingsPageTests(unittest.TestCase):
    def test_backup_is_the_first_accessible_settings_tab(self) -> None:
        html = (APP_DIR / "settings.html").read_text(encoding="utf-8")
        javascript = (APP_DIR / "settings.js").read_text(encoding="utf-8")
        self.assertLess(html.index('id="backup-settings-tab"'), html.index('id="general-settings-tab"'))
        self.assertIn('aria-selected="true" aria-controls="backup-settings-panel"', html)
        self.assertIn('id="import-history-settings-tab"', html)
        self.assertIn('id="import-history-settings-panel"', html)
        self.assertIn('fetch("/api/import-history"', javascript)
        self.assertIn('method: "DELETE"', javascript)
        self.assertIn('id="create-backup-button"', html)
        self.assertIn('id="backup-list"', html)
        self.assertIn("window.confirm", javascript)
        self.assertIn("completely replace transactions.csv", javascript)
        self.assertIn("JSON.stringify({ confirm: true })", javascript)
        self.assertIn('method: "DELETE"', javascript)
        self.assertIn("cannot be recovered after deletion", javascript)
        self.assertEqual(DEFAULT_CSV.parent.name, "data")


if __name__ == "__main__":
    unittest.main()
