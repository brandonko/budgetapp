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
        self.assertEqual(restored_rows[0]["flags"], "")

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

        status, batch = self.request(
            "GET", f"/api/import-history/{quote(first_timestamp)}"
        )
        self.assertEqual(status, 200)
        self.assertEqual(batch["createdAt"], first_timestamp)
        self.assertEqual(
            {row["description"] for row in batch["transactions"]},
            {"First import A", "First import B"},
        )
        self.assertTrue(all("_id" in row for row in batch["transactions"]))
        self.assertEqual(batch["revision"], history["revision"])

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

    def test_rename_backup_accepts_a_custom_name_and_adds_csv_extension(self) -> None:
        backup_directory = self.csv_path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        original = backup_directory / "transactions_old.csv"
        write_transactions_atomic(original, [transaction("Renamed", 4)])

        status, payload = self.request(
            "POST",
            f"/api/backups/{quote(original.name)}/rename",
            {"newName": "Before vacation"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["backup"]["name"], "Before vacation.csv")
        self.assertEqual(payload["backup"]["transactionCount"], 1)
        self.assertFalse(original.exists())
        self.assertTrue((backup_directory / "Before vacation.csv").exists())

    def test_rename_backup_rejects_invalid_names_and_existing_files(self) -> None:
        backup_directory = self.csv_path.parent / "backups"
        backup_directory.mkdir(parents=True, exist_ok=True)
        original = backup_directory / "Original.csv"
        existing = backup_directory / "Existing.csv"
        write_transactions_atomic(original, [transaction("Original", 4)])
        write_transactions_atomic(existing, [transaction("Existing", 5)])

        status, invalid = self.request(
            "POST",
            f"/api/backups/{quote(original.name)}/rename",
            {"newName": "../outside.csv"},
        )
        self.assertEqual(status, 400)
        self.assertIn("invalid", invalid["error"].lower())

        status, collision = self.request(
            "POST",
            f"/api/backups/{quote(original.name)}/rename",
            {"newName": existing.name},
        )
        self.assertEqual(status, 409)
        self.assertIn("already exists", collision["error"])
        self.assertTrue(original.exists())
        self.assertTrue(existing.exists())

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
        self.assertNotIn('id="classification-settings-tab"', html)
        self.assertNotIn('id="classification-settings-panel"', html)
        self.assertIn('href="/classifications"', html)
        self.assertIn(
            '<section class="settings-panel" id="general-settings-panel" role="tabpanel"',
            html,
        )
        self.assertIn('aria-selected="true" aria-controls="backup-settings-panel"', html)
        self.assertIn('id="import-history-settings-tab"', html)
        self.assertIn('tabindex="-1">Imports</button>', html)
        self.assertIn('id="import-history-settings-panel"', html)
        self.assertIn('fetch("/api/import-history"', javascript)
        self.assertIn(
            'selectedTab === document.querySelector("#import-history-settings-tab")',
            javascript,
        )
        self.assertEqual(javascript.count("loadImportHistory();"), 1)
        self.assertIn('view.textContent = "View transactions"', javascript)
        self.assertIn('id="import-history-dialog"', html)
        self.assertIn('id="import-history-edit-form"', html)
        self.assertIn('<script src="/transaction-ui.js" defer>', html)
        self.assertIn("transactionUi.renderTransactionList", javascript)
        self.assertIn("transactionUi.transactionFromEditor", javascript)
        self.assertIn('method: "PUT"', javascript)
        self.assertIn('method: "DELETE"', javascript)
        self.assertIn('id="create-backup-button"', html)
        self.assertIn('id="backup-list"', html)
        self.assertIn("window.confirm", javascript)
        self.assertIn("completely replace transactions.csv", javascript)
        self.assertIn("JSON.stringify({ confirm: true })", javascript)
        self.assertIn('method: "DELETE"', javascript)
        self.assertIn("cannot be recovered after deletion", javascript)
        self.assertIn('rename.textContent = "Rename"', javascript)
        self.assertIn("window.prompt", javascript)
        self.assertIn("/rename", javascript)
        self.assertEqual(DEFAULT_CSV.parent.name, "data")

    def test_classifications_page_explains_order_and_offers_export(self) -> None:
        html = (APP_DIR / "classifications.html").read_text(encoding="utf-8")
        settings_html = (APP_DIR / "settings.html").read_text(encoding="utf-8")
        javascript = (APP_DIR / "settings.js").read_text(encoding="utf-8")
        self.assertNotIn('id="classification-settings-panel"', settings_html)
        self.assertIn('href="/classifications" aria-current="page"', html)
        self.assertIn('<p class="eyebrow">Transaction rules</p>', html)
        self.assertNotIn('<p class="eyebrow">Import automation</p>', html)
        self.assertIn('<details class="import-note import-guide classification-guide">', html)
        self.assertIn("How matching works", html)
        self.assertIn("Classification flow", html)
        self.assertIn("for each transaction:", html)
        self.assertIn("if every populated matcher matches the transaction:", html)
        self.assertNotIn("Apply reusable transaction changes when imported", html)
        self.assertIn("first matching classification wins", html)
        self.assertIn("current category, subcategory, description, account name", html)
        self.assertIn("and provider with case-insensitive regular expressions", html)
        self.assertIn('href="/api/classifications/export"', html)
        self.assertIn('id="apply-classifications-button"', html)
        self.assertIn('id="classification-preview-dialog"', html)
        self.assertIn('id="cancel-classification-preview"', html)
        self.assertIn('fetch("/api/classifications"', javascript)
        self.assertIn('fetch("/api/classifications/preview"', javascript)
        self.assertIn('fetch("/api/classifications/apply"', javascript)
        self.assertIn("pendingClassificationPreview = null", javascript)
        self.assertNotIn("Move up", javascript)
        self.assertNotIn("Move down", javascript)
        self.assertIn('category: "Category"', javascript)
        self.assertIn('subcategory: "Subcategory"', javascript)
        self.assertIn('classificationInput(`${label} regex`', javascript)
        self.assertIn('caption.textContent = "Rule note (optional)"', javascript)
        self.assertIn('textarea.maxLength = 2000', javascript)
        self.assertIn('className = "classification-rule-title"', javascript)
        self.assertIn("This text is not used when matching transactions", javascript)
        self.assertIn("A rule note is only a reminder for you", html)
        self.assertNotIn("input.placeholder", javascript)
        self.assertIn('id="classification-pagination"', html)
        self.assertIn('id="classification-page-indicator"', html)
        self.assertIn("selectedClassificationIndex", javascript)
        self.assertIn("classificationCanBeFollowedByAnother", javascript)
        self.assertIn("Complete the last classification", javascript)
        self.assertIn("classification.rules.length > 0 && classification.rules.every", javascript)
        self.assertIn("if (lastClassification && !classificationCanBeFollowedByAnother", javascript)
        self.assertIn(
            "renderClassification(classifications[selectedClassificationIndex]",
            javascript,
        )
        self.assertLess(
            html.index('id="classification-list"'),
            html.index('id="add-classification-button"'),
        )
        self.assertIn('smallAction("Add rule"', javascript)
        self.assertIn('smallAction("Delete rule"', javascript)
        self.assertIn("classification-add-rule", javascript)
        self.assertIn("openUnclassifiedDialog", javascript)
        self.assertNotIn('id="save-classifications-button"', html)
        self.assertIn('/settings.js?v=20260903-classifications-page', html)
        self.assertIn('/styles.css?v=20260903-classifications-page', html)
        self.assertIn("persistClassifications", javascript)
        self.assertIn('smallAction("Edit"', javascript)
        self.assertIn('smallAction("Cancel"', javascript)
        self.assertIn('smallAction("Save"', javascript)
        self.assertIn("let ruleEdits = new Map()", javascript)
        self.assertIn("function ruleEditKey", javascript)
        self.assertIn("const candidate = cloneValue(classifications)", javascript)
        self.assertIn('persistClassifications("Rule saved.", candidate', javascript)
        self.assertIn('persistClassifications("Classification saved.", candidate', javascript)
        rule_save = javascript[
            javascript.index("async function saveRuleEdit"):javascript.index("async function deleteRule")
        ]
        self.assertNotIn("classificationEdit = null", rule_save)
        self.assertIn("preservedEdits", rule_save)
        self.assertIn("ruleEdits.set(key", javascript)
        self.assertIn("disabled: classificationEdit !== null", javascript)
        self.assertIn("classifications[index].updates = original.updates", javascript)
        self.assertIn("const CLASSIFICATION_ACTIONS", javascript)
        self.assertIn('field: "refunded"', javascript)
        self.assertIn('field: "internalTransfer"', javascript)
        self.assertIn("Mark as internal transfer", javascript)
        self.assertIn("Always count normally", javascript)
        self.assertNotIn('field: "date", label: "Date"', javascript)
        self.assertNotIn('field: "amount", label: "Amount"', javascript)
        self.assertIn("classificationHasActions", javascript)
        self.assertIn('updates.subcategory = ""', javascript)
        self.assertNotIn("Enable with a blank value to clear this field", javascript)
        self.assertIn("duplicateClassificationIndex", javascript)
        self.assertIn("This classification already exists on page", javascript)
        self.assertIn("Add the rule there instead.", javascript)
        self.assertIn("ruleEdits.delete(key)", javascript)
        self.assertIn("classificationEdit = null;", javascript)
        self.assertIn("pattern.textContent = rule[field]", javascript)
        self.assertIn('successMessage)', javascript)


if __name__ == "__main__":
    unittest.main()
