from __future__ import annotations

import csv
import io
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

APP = Path(__file__).resolve().parents[1] / "app"
# This is a deadlock guard, not a response-time assertion. Hosted Windows runners
# can pause during backed-up, fsynced writes; keep real durability enabled and
# allow scheduling/filesystem variance without retrying a mutation.
HTTP_TIMEOUT = 15
sys.path.insert(0, str(APP))
from server import (  # noqa: E402
    BudgetRequestHandler, ThreadingHTTPServer, COLUMNS, PRE_GROUP_COLUMNS,
    CsvDataError, apply_bulk_changes, bulk_edit_result, normalize_transaction,
    migrate_transaction_schema, read_transaction_state, read_backup_transactions,
    write_transactions_atomic, parse_ledger_import_csv, transaction_export_csv,
    write_classifications_atomic,
)


def row(**overrides):
    return normalize_transaction({"date": "2026-08-20", "description": "Bike helmet", "amount": "50.00",
        "category": "Shopping", "subcategory": "Apparel", "accountName": "Test card", "accountType": "CREDIT CARD",
        "provider": "Test bank", "tags": "tools", "group": "", "notes": "Synthetic only",
        "createdAt": "2026-09-01T00:00:00Z", **overrides}, "fixture")


def fixture_rows():
    return [row(), row(description="Bike jersey", amount=80, tags="bike, apparel", group="Canyon Aeroad"),
        row(description="Hotel stay", amount=400, category="Travel", subcategory="Lodging", group="LA trip"),
        row(description="Cafe lunch", amount=25, category="Food", subcategory="", group="LA trip"),
        row(description="Bike tool", amount=20, subcategory="", tags="tools", flags="refunded"),
        row(description="Salary", amount=-2000, category="Income", subcategory="Salary", tags="")]


def make_server(csv_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
    server.csv_path = csv_path
    server.data_lock = threading.Lock()
    server.amazon_import_sessions = {}
    server.amazon_import_lock = threading.Lock()
    return server


class GroupSchemaTests(unittest.TestCase):
    def test_previous_database_migrates_with_exact_safety_copy_and_no_tag_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "transactions.csv"
            original = row(tags="LA trip (group), bike", notes="comma, and\nnew line")
            original.pop("group")
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, PRE_GROUP_COLUMNS)
                writer.writeheader(); writer.writerow(original)
            before = path.read_bytes()
            self.assertEqual(read_transaction_state(path)[0][0]["group"], "")
            self.assertTrue(migrate_transaction_schema(path))
            self.assertEqual(next((path.parent / "backups").glob("*.csv")).read_bytes(), before)
            after = read_transaction_state(path)[0][0]
            self.assertEqual({key: after[key] for key in original}, original)
            self.assertEqual(after["group"], "")
            self.assertFalse(migrate_transaction_schema(path))
            self.assertEqual(read_backup_transactions(next((path.parent / "backups").glob("*.csv")))[0]["group"], "")

    def test_exports_round_trip_groups_and_old_exports_are_accepted(self):
        original = row(group="Trip, September", tags="bike, tools")
        content, _ = transaction_export_csv([original], "2026-01-01", "2026-12-31")
        parsed, count, invalid = parse_ledger_import_csv(content.decode("utf-8-sig"))
        self.assertEqual((count, invalid, parsed[0]["group"]), (1, [], "Trip, September"))
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, [column for column in PRE_GROUP_COLUMNS if column != "createdAt"], extrasaction="ignore")
        writer.writeheader(); writer.writerow(original)
        self.assertEqual(parse_ledger_import_csv(output.getvalue())[0][0]["group"], "")

    def test_group_is_single_text_and_reuses_existing_case_and_spacing(self):
        self.assertEqual(row(group="  LA   trip ")["group"], "LA trip")
        for invalid in (None, [], ["LA", "Hawaii"], True, "x" * 101):
            with self.subTest(invalid=invalid), self.assertRaises(CsvDataError):
                row(group=invalid)
        rows = [row(group="Canyon Aeroad"), row()]
        updated, _ = bulk_edit_result(rows, [1], {"group": " canyon   AEROAD "})
        self.assertEqual(updated[1]["group"], "Canyon Aeroad")
        self.assertEqual(updated[0], rows[0])

    def test_tag_modes_and_flags_preserve_unselected_fields(self):
        original = row(tags="tools, apparel", flags="custom,refunded,internal-transfer")
        changes = {"tags": {"mode": "add", "value": "BIKE, Tools"}, "refunded": False, "internalTransferTreatment": "include-in-budget"}
        result = apply_bulk_changes(original, changes)
        self.assertEqual(result["tags"], "tools, apparel, BIKE")
        self.assertEqual(set(result["flags"].split(",")), {"custom", "include-in-budget"})
        for field in set(COLUMNS) - {"tags", "flags"}:
            self.assertEqual(result.get(field, ""), original.get(field, ""))
        self.assertEqual(apply_bulk_changes(result, {"tags": {"mode": "remove", "value": "TOOLS"}})["tags"], "apparel, BIKE")
        self.assertEqual(apply_bulk_changes(result, {"tags": {"mode": "replace", "value": "bike"}})["tags"], "bike")
        self.assertEqual(apply_bulk_changes(result, {"tags": {"mode": "clear", "value": ""}})["tags"], "")


class BulkApiTests(unittest.TestCase):
    def test_follow_up_flags_persist_without_changing_money_or_other_fields(self):
        original = row(flags="custom,refunded,internal-transfer,refund-receipt-2026-08-22-5000")
        write_transactions_atomic(self.path, [original])
        revision = read_transaction_state(self.path)[1]
        before = self.path.read_bytes()
        status, result = self.request("/api/transactions/bulk", {
            "revision": revision, "ids": [0], "changes": {"flagged": True}, "confirm": True})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["changed"], 1)
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)
        [saved], _ = read_transaction_state(self.path)
        self.assertEqual(set(saved["flags"].split(",")), set(original["flags"].split(",")) | {"flagged"})
        self.assertEqual({key: value for key, value in saved.items() if key != "flags"},
                         {key: value for key, value in original.items() if key != "flags"})
        exported, _ = transaction_export_csv([saved], "2026-01-01", "2026-12-31")
        self.assertIn("flagged", parse_ledger_import_csv(exported.decode("utf-8-sig"))[0][0]["flags"])
        status, cleared = self.request("/api/transactions/bulk", {
            "revision": result["revision"], "ids": [0], "changes": {"flagged": False}, "confirm": True})
        self.assertEqual(status, 200, cleared)
        self.assertEqual(read_transaction_state(self.path)[0], [original])

    def test_flags_reject_stale_revisions_invalid_values_and_missing_confirmation(self):
        before = self.path.read_bytes()
        for changes, revision, confirm, expected in [
            ({"flagged": "true"}, self.revision, True, 400),
            ({"flagged": 1}, self.revision, True, 400),
            ({"flagged": True}, "stale", True, 409),
            ({"flagged": True}, self.revision, False, 400),
        ]:
            status, _ = self.request("/api/transactions/bulk", {
                "revision": revision, "ids": [0], "changes": changes, "confirm": confirm})
            self.assertEqual(status, expected)
            self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "transactions.csv"
        self.rows = fixture_rows()
        write_transactions_atomic(self.path, self.rows)
        self.server = make_server(self.path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.revision = read_transaction_state(self.path)[1]

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2); self.temporary.cleanup()

    def request(self, route, payload, method="POST"):
        request = Request(self.base + route, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method=method)
        try:
            with urlopen(request, timeout=HTTP_TIMEOUT) as response: return response.status, json.load(response)
        except HTTPError as error:
            try: return error.code, json.load(error)
            finally: error.close()

    def payload(self, **kwargs):
        return {"revision": self.revision, "ids": [0, 1], "changes": {"group": "LA trip", "tags": {"mode": "add", "value": "bike"}}, **kwargs}

    def test_every_transaction_page_loads_the_shared_bulk_assets(self):
        for route in ("/", "/transactions", "/import", "/settings", "/classifications"):
            with self.subTest(route=route), urlopen(self.base + route, timeout=3) as response:
                html = response.read().decode()
                self.assertLess(html.index('/transaction-ui.js?'), html.index('/transaction-bulk.js?'))
                self.assertIn('/transaction-tools.css?', html)
        for route in ("/transaction-bulk.js?v=20260906-1", "/transaction-tools.css?v=20260906-1"):
            with self.subTest(route=route), urlopen(self.base + route, timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.read())

    def test_preview_cancel_and_confirm_are_atomic_and_revision_bound(self):
        before = self.path.read_bytes()
        status, preview = self.request("/api/transactions/bulk-preview", self.payload())
        self.assertEqual((status, preview["changed"]), (200, 2))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())
        self.assertEqual(self.request("/api/transactions/bulk", self.payload())[0], 400)
        self.assertEqual(self.path.read_bytes(), before)
        status, saved = self.request("/api/transactions/bulk", self.payload(confirm=True))
        self.assertEqual((status, saved["changed"]), (200, 2))
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)
        rows = read_transaction_state(self.path)[0]
        self.assertEqual(rows[0]["tags"], "tools, bike")
        self.assertEqual(rows[0]["group"], "LA trip")
        self.assertEqual(rows[0]["createdAt"], self.rows[0]["createdAt"])
        self.assertEqual(rows[2:], self.rows[2:])
        after = self.path.read_bytes()
        self.assertEqual(self.request("/api/transactions/bulk", self.payload(confirm=True))[0], 409)
        self.assertEqual(self.path.read_bytes(), after)

    def test_invalid_batches_never_partially_write_or_backup(self):
        before = self.path.read_bytes()
        invalid = [self.payload(ids=[]), self.payload(ids=[0, 0]), self.payload(ids=[False]), self.payload(ids=[0, 99]),
            self.payload(changes={"createdAt": "2020-01-01"}), self.payload(changes={}),
            self.payload(changes={"date": "nonsense"}), self.payload(changes={"description": ""}),
            self.payload(changes={"amount": "1e999"}), self.payload(changes={"tags": {"mode": [], "value": "x"}}),
            self.payload(changes={"group": ["two", "groups"]})]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assertEqual(self.request("/api/transactions/bulk", {**payload, "confirm": True})[0], 400)
                self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())

    def test_noop_does_not_write_and_atomic_failure_preserves_original(self):
        before = self.path.read_bytes()
        status, result = self.request("/api/transactions/bulk", self.payload(ids=[0], changes={"group": ""}, confirm=True))
        self.assertEqual((status, result["changed"], result["backup"]), (200, 0, None))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())
        with patch("server.write_transactions_atomic", side_effect=OSError("simulated disk failure")):
            self.assertEqual(self.request("/api/transactions/bulk", self.payload(confirm=True))[0], 500)
        self.assertEqual(self.path.read_bytes(), before)

    def test_older_editor_cannot_erase_group_and_new_names_reuse_existing_spelling(self):
        old = dict(self.rows[1]); old.pop("group")
        status, _ = self.request("/api/transactions/1", {"revision": self.revision, "transaction": old}, "PUT")
        self.assertEqual(status, 200)
        rows, revision = read_transaction_state(self.path)
        current = next((i, row) for i, row in enumerate(rows) if row["description"] == "Bike jersey")
        self.assertEqual(current[1]["group"], "Canyon Aeroad")
        changed = {**current[1], "group": "  la TRIP "}
        self.assertEqual(self.request(f"/api/transactions/{current[0]}", {"revision": revision, "transaction": changed}, "PUT")[0], 200)
        self.assertEqual(next(row for row in read_transaction_state(self.path)[0] if row["description"] == "Bike jersey")["group"], "LA trip")

    def test_staged_preview_rechecks_edited_duplicates_without_writes(self):
        before = self.path.read_bytes()
        staged = [dict(self.rows[0], _stagedId=5, _classificationMatched=False, _selected=False),
                  dict(self.rows[0], _stagedId=9, group=" la TRIP ", _classificationMatched=True)]
        for item in staged:
            item.pop("id", None)  # Two incoming occurrences are distinct records.
        status, result = self.request("/api/transactions/staged-preview", {"revision": self.revision, "transactions": staged})
        self.assertEqual((status, result["new"], result["duplicates"]), (200, 1, 1))
        self.assertEqual({item["_stagedId"] for item in result["transactions"]}, {5, 9})
        self.assertEqual(next(item for item in result["transactions"] if item["_stagedId"] == 9)["group"], "LA trip")
        staged[0]["amount"] = 999
        status, result = self.request("/api/transactions/staged-preview", {"revision": self.revision, "transactions": staged})
        self.assertEqual((status, result["new"], result["duplicates"]), (200, 1, 1))
        self.assertFalse(next(item for item in result["transactions"] if item["_stagedId"] == 5)["_isDuplicate"])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())
        self.assertEqual(self.request("/api/transactions/staged-preview", {"revision": "stale", "transactions": staged})[0], 409)
        staged[1]["_stagedId"] = 5
        self.assertEqual(self.request("/api/transactions/staged-preview", {"revision": self.revision, "transactions": staged})[0], 400)

    def test_bulk_backup_failure_prevents_any_write(self):
        before = self.path.read_bytes()
        with patch("server.create_backup_copy", side_effect=OSError("backup unavailable")):
            self.assertEqual(self.request("/api/transactions/bulk", self.payload(confirm=True))[0], 500)
        self.assertEqual(self.path.read_bytes(), before)

    def test_classification_preview_overrides_stay_staged_and_commit_together(self):
        document = {"version": 2, "classifications": [{"updates": {"category": "Food", "subcategory": "Restaurant"}, "rules": [{"description": "Cafe"}]}]}
        before = self.path.read_bytes()
        status, preview = self.request("/api/classifications/preview", document)
        self.assertEqual(status, 200)
        self.assertEqual(self.path.read_bytes(), before)
        proposed = preview["changes"][0]["transaction"]
        proposed.update(group="LA trip", tags="vacation", amount=30)
        status, result = self.request("/api/classifications/apply", {"revision": preview["revision"], "document": document,
            "confirm": True, "overrides": [{"_id": proposed["_id"], "transaction": proposed}]})
        self.assertEqual((status, result["changed"]), (200, 1))
        changed = next(row for row in read_transaction_state(self.path)[0] if row["description"] == "Cafe lunch")
        self.assertEqual((changed["category"], changed["subcategory"], changed["group"], changed["tags"], changed["amount"]),
            ("Food", "Restaurant", "LA trip", "vacation", 30))


if __name__ == "__main__":
    if "--serve-ui" in sys.argv:
        with tempfile.TemporaryDirectory(prefix="ledger-groups-ui-") as directory:
            path = Path(directory) / "transactions.csv"
            write_transactions_atomic(path, fixture_rows())
            write_classifications_atomic(path, {"version": 2, "classifications": [{"updates": {"category": "Food", "subcategory": "Restaurant"}, "rules": [{"description": "Cafe"}]}]})
            export, _ = transaction_export_csv(fixture_rows(), "2026-01-01", "2026-12-31")
            (path.parent / "import-demo.csv").write_bytes(export)
            server = make_server(path)
            print(f"UI fixture: http://127.0.0.1:{server.server_port}; CSV: {path.parent / 'import-demo.csv'}", flush=True)
            try: server.serve_forever()
            finally: server.server_close()
    else:
        unittest.main()
