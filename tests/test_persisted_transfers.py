"""Synthetic-only regression coverage for explicit, durable transfer reviews."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from test_groups_bulk import make_server, row
from test_csv_import import ledger_csv
from server import (LEDGER_IMPORT_COLUMNS, read_transaction_state, write_transactions_atomic,
                    transfer_review_path, transfer_plan, public_state,
                    INTERNAL_TRANSFER_DESCRIPTION_PATTERN, BILL_PAYMENT_WINDOW_DAYS)
import transfers
import reconciliation


def pair():
    return [row(description="Online transfer", category="Transfer", amount=100, accountName="Savings"),
            row(description="Received transfer", category="Transfer", amount=-100, accountName="Checking")]


class PersistedTransferTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "transactions.csv"
        self.server = make_server(self.path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.directory.cleanup()

    def request(self, path, data=None, method="POST"):
        request = Request(f"http://127.0.0.1:{self.server.server_port}{path}",
                          data=json.dumps(data or {}).encode() if method != "GET" else None,
                          headers={"Content-Type": "application/json"}, method=method)
        try:
            with urlopen(request) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def scan(self, **options):
        status, result = self.request("/api/internal-transfers/preview", options)
        self.assertEqual(status, 200, result)
        return result

    def confirm(self, preview, overrides=None):
        return self.request("/api/internal-transfers/confirm", {
            "confirm": True, "revision": preview["revision"], "plan": preview["plan"],
            "overrides": overrides or [],
        })

    def stage(self, rows):
        content = ledger_csv([{column: item.get(column, "") for column in LEDGER_IMPORT_COLUMNS} for item in rows])
        status, result = self.request("/api/csv-import-sessions", {"content": content, "applyClassifications": False})
        self.assertEqual(status, 201, result)
        return result["token"], result["import"]

    def commit(self, token, preview, selected=None):
        return self.request(f"/api/csv-import-sessions/{token}/commit", {
            "transactions": selected if selected is not None else preview["transactions"],
            "transferPlan": preview["transferPlan"],
        })

    def refresh(self, rows):
        revision = read_transaction_state(self.path)[1] if self.path.exists() else "missing"
        # Use the public missing-file sentinel rather than a fabricated revision.
        if not self.path.exists():
            from server import MISSING_CSV_REVISION
            revision = MISSING_CSV_REVISION
        status, result = self.request("/api/transactions/staged-preview", {"revision": revision, "transactions": rows})
        self.assertEqual(status, 200, result)
        return result

    def test_reads_never_detect_or_write_and_require_initial_review(self):
        write_transactions_atomic(self.path, pair())
        before = self.path.read_bytes()
        with patch("transfers.find_pairs", side_effect=AssertionError("read ran detection")):
            status, payload = self.request("/api/transactions", method="GET")
        self.assertEqual(status, 200)
        self.assertTrue(payload["internalTransferReviewRequired"])
        self.assertFalse(any(item["_isInternalTransfer"] for item in payload["transactions"]))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())

    def test_scan_is_staged_and_confirmation_persists_pairs_and_backup(self):
        original = pair()
        write_transactions_atomic(self.path, original)
        before = self.path.read_bytes()
        preview = self.scan()
        self.assertEqual(preview["transferPairs"], 1)
        self.assertEqual(len(preview["transactions"]), 2)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(transfer_review_path(self.path).exists())
        status, result = self.confirm(preview)
        self.assertEqual(status, 200, result)
        saved, revision = read_transaction_state(self.path)
        for old, new in zip(original, saved):
            self.assertEqual({key: value for key, value in new.items() if key not in {"flags", "links"}},
                             {key: value for key, value in old.items() if key not in {"flags", "links"}})
        self.assertEqual(reconciliation.links(saved[0]), [{"transactionId": saved[1]["id"], "type": "transfer"}])
        tokens = [transfers.flags(item) - {"internal-transfer"} for item in saved]
        self.assertEqual(tokens[0], tokens[1])
        self.assertTrue(tokens[0])
        self.assertTrue(all(item["_internalTransferSource"] == "linked" for item in result["transactions"]))
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)
        self.assertEqual(self.confirm(preview)[0], 409)
        repeat = self.scan()
        self.assertEqual(repeat["transactions"], [])
        self.assertEqual(self.confirm(repeat)[0], 200)
        self.assertEqual(read_transaction_state(self.path)[1], revision)
        self.assertEqual(len(list((self.path.parent / "backups").glob("*.csv"))), 1)

    def test_settings_rejects_missing_confirmation_plan_and_stale_revision(self):
        write_transactions_atomic(self.path, pair())
        before = self.path.read_bytes()
        preview = self.scan()
        self.assertEqual(self.request("/api/internal-transfers/confirm", preview)[0], 400)
        self.assertEqual(self.request("/api/internal-transfers/confirm", {"confirm": True, "revision": preview["revision"]})[0], 409)
        self.assertEqual(self.path.read_bytes(), before)
        write_transactions_atomic(self.path, pair() + [row()])
        self.assertEqual(self.confirm(preview)[0], 409)
        self.assertFalse(transfer_review_path(self.path).exists())

    def test_preview_separates_saved_flags_from_changes_without_rewriting_them(self):
        saved, _, _ = transfer_plan(pair(), "saved-pair")
        saved.append(row(description="Manually excluded", amount=37, flags="internal-transfer"))
        pending = [dict(item, amount=item["amount"] * 2) for item in pair()]
        write_transactions_atomic(self.path, saved + pending + [row(flags="include-in-budget")])
        before = self.path.read_bytes()
        preview = self.scan()
        self.assertEqual(len(preview["alreadyFlagged"]), 3)
        self.assertEqual(len(preview["changes"]), 2)
        self.assertEqual(preview["transferPairs"], 1)
        self.assertTrue(all(item["_isInternalTransfer"] for item in preview["alreadyFlagged"]))
        self.assertEqual({item["_id"] for item in preview["alreadyFlagged"]}, {0, 1, 2})
        self.assertEqual({item["_id"] for item in preview["transactions"]}, {3, 4})
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())
        self.assertEqual(self.confirm(preview)[0], 200)
        current, _ = read_transaction_state(self.path)
        self.assertEqual(current[:3], saved)
        repeat = self.scan()
        self.assertEqual(repeat["changes"], [])
        self.assertEqual(len(repeat["alreadyFlagged"]), 5)

    def test_edit_saved_flag_stays_staged_and_moves_to_changes_exactly_once(self):
        saved, _, _ = transfer_plan(pair(), "saved-pair")
        write_transactions_atomic(self.path, saved)
        before = self.path.read_bytes()
        preview = self.scan()
        self.assertEqual(preview["changes"], [])
        self.assertEqual(len(preview["alreadyFlagged"]), 2)
        override = dict(preview["alreadyFlagged"][0], notes="Reviewed note")
        edited = self.scan(revision=preview["revision"], overrides=[override])
        self.assertEqual([item["_id"] for item in edited["alreadyFlagged"]], [1])
        self.assertEqual([item["_id"] for item in edited["transactions"]], [0])
        self.assertEqual(edited["changes"][0]["changedFields"], ["notes"])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.confirm(preview, [override])[0], 409)
        self.assertEqual(self.confirm(edited, [override])[0], 200)
        current, _ = read_transaction_state(self.path)
        self.assertEqual(current[0], dict(saved[0], notes="Reviewed note"))
        self.assertEqual(current[1], saved[1])

    def test_safety_backup_failure_writes_nothing(self):
        write_transactions_atomic(self.path, pair())
        before = self.path.read_bytes()
        preview = self.scan()
        with patch("server.create_backup_copy", side_effect=OSError("no backup")):
            self.assertEqual(self.confirm(preview)[0], 500)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(transfer_review_path(self.path).exists())

    def test_manual_overrides_and_existing_flags_are_not_reused(self):
        for flag in ("include-in-budget", "internal-transfer"):
            rows = pair()
            rows[0]["flags"] = flag
            self.assertEqual(transfers.find_pairs(rows, INTERNAL_TRANSFER_DESCRIPTION_PATTERN), [])

    def test_settings_editor_changes_stay_staged_and_keep_created_at(self):
        original = pair()
        write_transactions_atomic(self.path, original)
        before = self.path.read_bytes()
        first = self.scan()
        override = dict(first["transactions"][0], flags="include-in-budget", tags="bike", createdAt="2020-01-01T00:00:00Z")
        preview = self.scan(revision=first["revision"], overrides=[override])
        self.assertEqual(preview["transferPairs"], 0)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.confirm(preview, [override])[0], 200)
        changed = next(item for item in read_transaction_state(self.path)[0] if item["tags"] == "bike")
        self.assertEqual(changed["createdAt"], original[0]["createdAt"])

    def test_new_import_persists_both_sides_and_clears_fresh_database_gate(self):
        token, preview = self.stage(pair())
        self.assertFalse(self.path.exists())
        self.assertTrue(all(item["_isInternalTransfer"] for item in preview["transactions"]))
        self.assertTrue(all(not item["flags"] for item in preview["transactions"]))
        self.assertEqual(self.commit(token, preview)[0], 200)
        saved, revision = read_transaction_state(self.path)
        self.assertTrue(all("internal-transfer" in transfers.flags(item) for item in saved))
        self.assertEqual(len({item["createdAt"] for item in saved}), 1)
        self.assertFalse(self.request("/api/transactions", method="GET")[1]["internalTransferReviewRequired"])
        with patch("transfers.find_pairs", side_effect=AssertionError("must not detect")):
            self.assertTrue(all(item["_isInternalTransfer"] for item in public_state(saved, revision)["transactions"]))

    def test_separate_import_proposes_existing_side_and_preserves_original_fields(self):
        original = pair()[0]
        write_transactions_atomic(self.path, [original])
        before = self.path.read_bytes()
        token, preview = self.stage([pair()[1]])
        self.assertEqual(len(preview["existingTransferUpdates"]), 1)
        self.assertEqual(self.path.read_bytes(), before)
        status, result = self.commit(token, preview)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["import"]["existingTransfersUpdated"], 1)
        old = next(item for item in read_transaction_state(self.path)[0] if item["amount"] == 100)
        self.assertEqual({k: v for k, v in old.items() if k not in {"flags", "links"}},
                         {k: v for k, v in original.items() if k not in {"flags", "links"}})
        self.assertEqual(reconciliation.links(old)[0]["type"], "transfer")
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)

    def test_deselection_and_edits_invalidate_old_plan_and_do_not_flag_missing_side(self):
        token, initial = self.stage(pair())
        rows = [dict(item, _selected=index == 0) for index, item in enumerate(initial["transactions"])]
        selected = [rows[0]]
        self.assertEqual(self.commit(token, initial, selected)[0], 409)
        refreshed = self.refresh(rows)
        self.assertFalse(any(item["_isInternalTransfer"] for item in refreshed["transactions"]))
        self.assertEqual(self.commit(token, refreshed, selected)[0], 200)
        self.assertEqual(read_transaction_state(self.path)[0][0]["flags"], "")

    def test_edited_amount_recalculates_matches(self):
        token, initial = self.stage(pair())
        rows = [dict(item, _selected=True) for item in initial["transactions"]]
        rows[0]["amount"] = 101
        refreshed = self.refresh(rows)
        self.assertEqual(refreshed["existingTransferUpdates"], [])
        self.assertFalse(any(item["_isInternalTransfer"] for item in refreshed["transactions"]))
        self.assertEqual(self.commit(token, refreshed, rows)[0], 200)

    def test_cancelled_import_never_persists_existing_side(self):
        write_transactions_atomic(self.path, [pair()[0]])
        before = self.path.read_bytes()
        token, preview = self.stage([pair()[1]])
        self.request(f"/api/csv-import-sessions/{token}/cancel")
        self.commit(token, preview)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())

    def test_duplicate_force_selection_never_reuses_saved_pairs(self):
        token, initial = self.stage(pair())
        self.assertEqual(self.commit(token, initial)[0], 200)
        token, duplicate = self.stage([pair()[0]])
        self.assertEqual(duplicate["duplicates"], 1)
        selected = [dict(item, _selected=True) for item in duplicate["transactions"]]
        refreshed = self.refresh(selected)
        self.assertEqual(refreshed["existingTransferUpdates"], [])
        self.assertFalse(refreshed["transactions"][0]["_isInternalTransfer"])
        self.assertEqual(self.commit(token, refreshed, selected)[0], 200)
        self.assertEqual(sum("internal-transfer" in transfers.flags(item) for item in read_transaction_state(self.path)[0]), 2)

    def test_saved_pair_survives_description_edits_but_deletion_unlinks_counterpart(self):
        saved, _, _ = transfer_plan(pair(), "baseline")
        saved[0]["description"] = "Renamed"
        result = public_state(saved, "new revision")["transactions"][0]
        self.assertTrue(result["_isInternalTransfer"])
        self.assertEqual(transfers.find_pairs(saved + [pair()[1]], INTERNAL_TRANSFER_DESCRIPTION_PATTERN), [])
        remaining = reconciliation.unlink_deleted(saved, saved[:1])
        self.assertFalse(public_state(remaining, "new revision")["transactions"][0]["_isInternalTransfer"])

    def test_empty_preview_does_not_create_database(self):
        preview = self.scan()
        self.assertEqual(preview["transactions"], [])
        self.assertFalse(self.path.exists())
        self.assertFalse(transfer_review_path(self.path).exists())

    def test_initial_review_preserves_legacy_matches_with_one_manually_excluded_side(self):
        rows = pair()
        rows[0]["flags"] = "internal-transfer"
        write_transactions_atomic(self.path, rows)
        preview = self.scan()
        self.assertEqual(preview["transferPairs"], 1)
        self.assertEqual(self.confirm(preview)[0], 200)
        saved, _ = read_transaction_state(self.path)
        self.assertTrue(all("internal-transfer" in transfers.flags(item) for item in saved))
        self.assertEqual(self.scan()["transactions"], [])

    def test_zero_rows_are_not_matching_candidates_and_noop_import_writes_nothing(self):
        token, preview = self.stage([dict(item, amount=0) for item in pair()])
        self.assertFalse(any(item["_isInternalTransfer"] for item in preview["transactions"]))
        refreshed = self.refresh([dict(item, _selected=False) for item in preview["transactions"]])
        self.assertEqual(self.commit(token, refreshed, [])[0], 200)
        self.assertFalse(self.path.exists())
        self.assertFalse(transfer_review_path(self.path).exists())

    def test_refund_flag_and_amounts_survive_transfer_confirmation(self):
        rows = pair()
        rows[0]["flags"] = "refunded,custom"
        token, preview = self.stage(rows)
        self.assertEqual(self.commit(token, preview)[0], 200)
        saved = next(item for item in read_transaction_state(self.path)[0] if item["amount"] == 100)
        self.assertTrue({"refunded", "custom", "internal-transfer"} <= transfers.flags(saved))

    def test_indexed_pairing_matches_the_original_closest_date_order(self):
        import random
        from datetime import date, timedelta
        from decimal import Decimal
        generator = random.Random(321)
        for _ in range(30):
            rows = [row(date=(date(2025, 12, 24) + timedelta(days=generator.randrange(16))).isoformat(),
                        amount=generator.choice([-20, -10, 0, 10, 20]), category=generator.choice(["Transfer", "Food"]),
                        accountName=generator.choice(["A", "B", "C"]), description="Synthetic") for _ in range(45)]
            candidates = []
            for left, first in enumerate(rows):
                for right in range(left + 1, len(rows)):
                    second = rows[right]
                    distance = abs((date.fromisoformat(first["date"]) - date.fromisoformat(second["date"])).days)
                    if (first["accountName"] != second["accountName"] and first["amount"] != 0
                            and Decimal(str(first["amount"])) == -Decimal(str(second["amount"]))
                            and "Transfer" in (first["category"], second["category"])
                            and distance <= BILL_PAYMENT_WINDOW_DAYS):
                        candidates.append((distance, left, right))
            used, expected = set(), []
            for distance, left, right in sorted(candidates):
                if left not in used and right not in used:
                    expected.append((left, right))
                    used.update((left, right))
            self.assertEqual(transfers.find_pairs(rows, INTERNAL_TRANSFER_DESCRIPTION_PATTERN), expected)


if __name__ == "__main__":
    unittest.main()
