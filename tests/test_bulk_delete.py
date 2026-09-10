"""Bulk deletion uses synthetic CSVs only, never the user's database."""
from __future__ import annotations

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_groups_bulk as fixtures
from server import read_transaction_state, write_transactions_atomic


class BulkDeleteApiTests(unittest.TestCase):
    setUp = fixtures.BulkApiTests.setUp
    tearDown = fixtures.BulkApiTests.tearDown
    request = fixtures.BulkApiTests.request

    def delete(self, **overrides):
        return self.request("/api/transactions/bulk-delete", {
            "revision": self.revision, "ids": [0, 3, 4], "confirm": True, **overrides,
        })

    def test_deletes_only_selected_occurrences_and_keeps_exact_safety_copy(self):
        before = self.path.read_bytes()
        status, result = self.delete()
        self.assertEqual((status, result["deleted"]), (200, 3))
        remaining, revision = read_transaction_state(self.path)
        self.assertEqual(remaining, [self.rows[i] for i in (1, 2, 5)])
        self.assertEqual(result["revision"], revision)
        self.assertEqual(len(result["transactions"]), 3)
        self.assertEqual(result["imports"][0]["transactionCount"], 3)
        backups = list((self.path.parent / "backups").glob("*.csv"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)
        # A replay cannot delete different rows after indices shift.
        self.assertEqual(self.delete()[0], 409)
        self.assertEqual(read_transaction_state(self.path)[0], remaining)
        self.assertEqual(len(list((self.path.parent / "backups").glob("*.csv"))), 1)

    def test_identical_rows_and_transfer_counterparts_are_not_deleted_by_matching(self):
        original = [fixtures.row(), fixtures.row(), fixtures.row(flags="internal-transfer,transfer-pair-test,custom"),
                    fixtures.row(amount=-50, flags="internal-transfer,transfer-pair-test,custom", notes="untouched\nnotes")]
        write_transactions_atomic(self.path, original)
        self.revision = read_transaction_state(self.path)[1]
        status, _ = self.delete(ids=[0, 2])
        self.assertEqual(status, 200)
        self.assertEqual(read_transaction_state(self.path)[0], [original[1], original[3]])

    def test_empty_invalid_or_unconfirmed_selection_never_writes(self):
        before = self.path.read_bytes()
        invalid = [{"ids": value} for value in ([], None, "0", [True], [0.0], ["0"], [-1], [0, 99], [0, 0], [0] * 50_001)]
        invalid += [{"confirm": value} for value in (False, None, 1, "true")]
        invalid += [{"revision": value} for value in (None, "", False, 123)]
        for payload in invalid:
            with self.subTest(payload=str(payload)[:100]):
                self.assertEqual(self.delete(**payload)[0], 400)
                self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.request("/api/transactions/bulk-delete", {"revision": self.revision, "ids": [0]})[0], 400)
        self.assertEqual(self.delete(revision="stale")[0], 409)
        self.assertFalse((self.path.parent / "backups").exists())

    def test_all_rows_can_be_deleted_leaving_a_valid_header_only_database(self):
        status, result = self.delete(ids=list(range(len(self.rows))))
        self.assertEqual((status, result["deleted"]), (200, len(self.rows)))
        self.assertTrue(self.path.exists())
        self.assertEqual(read_transaction_state(self.path)[0], [])
        self.assertEqual(result["transactions"], [])
        self.assertEqual(result["imports"], [])

    def test_missing_database_is_not_created(self):
        self.path.unlink()  # Only this test's TemporaryDirectory fixture.
        self.assertEqual(self.delete()[0], 404)
        self.assertFalse(self.path.exists())
        self.assertFalse((self.path.parent / "backups").exists())

    def test_backup_or_atomic_replace_failure_preserves_the_original(self):
        before = self.path.read_bytes()
        with patch("server.create_backup_copy", side_effect=OSError("backup unavailable")):
            self.assertEqual(self.delete()[0], 500)
        self.assertEqual(self.path.read_bytes(), before)
        replace = os.replace
        def fail_master_replace(source, destination):
            if str(destination) == str(self.path):
                raise OSError("replace unavailable")
            return replace(source, destination)
        with patch("server.os.replace", side_effect=fail_master_replace):
            self.assertEqual(self.delete()[0], 500)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob(".transactions.csv.*.tmp")), [])

    def test_concurrent_confirmations_allow_only_one_atomic_delete(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: self.delete()[0], range(2)))
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(read_transaction_state(self.path)[0], [self.rows[i] for i in (1, 2, 5)])
        self.assertEqual(len(list((self.path.parent / "backups").glob("*.csv"))), 1)


if __name__ == "__main__":
    unittest.main()
