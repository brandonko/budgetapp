"""Deferred flags and bidirectional links: temporary databases only."""
import unittest

import test_groups_bulk as bulk_tests
from test_groups_bulk import row
from server import read_transaction_state, write_transactions_atomic
import reconciliation
from test_import_preferences import csv_text


class ReconcileUpdatesTests(unittest.TestCase):
    setUp = bulk_tests.BulkApiTests.setUp
    tearDown = bulk_tests.BulkApiTests.tearDown
    request = bulk_tests.BulkApiTests.request

    def seed(self, rows):
        write_transactions_atomic(self.path, rows)
        return read_transaction_state(self.path)[1]

    def test_flags_batch_is_atomic_preserves_financial_fields_and_noop_does_not_write(self):
        rows = [row(id="a", flags="custom,refunded"), row(id="b", flags="flagged,include-in-budget")]
        revision = self.seed(rows)
        before = self.path.read_bytes()
        updates = [{"id": 0, "flagged": True}, {"id": 1, "flagged": False}]
        status, result = self.request("/api/transactions/flags", {"revision": revision, "updates": updates, "confirm": True})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["changed"], 2)
        backups = list((self.path.parent / "backups").glob("*.csv"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)
        saved = read_transaction_state(self.path)[0]
        for old, new in zip(rows, saved):
            self.assertEqual({k: v for k, v in old.items() if k != "flags"}, {k: v for k, v in new.items() if k != "flags"})
        self.assertEqual(set(saved[0]["flags"].split(",")), {"custom", "refunded", "flagged"})
        self.assertEqual(saved[1]["flags"], "include-in-budget")
        before = self.path.read_bytes()
        status, result = self.request("/api/transactions/flags", {"revision": result["revision"], "updates": updates, "confirm": True})
        self.assertEqual((status, result["changed"]), (200, 0))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(len(list((self.path.parent / "backups").glob("*.csv"))), 1)

    def test_invalid_flag_batch_and_stale_revision_never_partially_write(self):
        revision = self.seed([row(id="a"), row(id="b")])
        before = self.path.read_bytes()
        good = {"id": 0, "flagged": True}
        for updates, rev, confirm, expected in [
            ([good, {"id": 99, "flagged": True}], revision, True, 400),
            ([good, good], revision, True, 400),
            ([{"id": True, "flagged": True}], revision, True, 400),
            ([{"id": 0, "flagged": "true"}], revision, True, 400),
            ([good], "stale", True, 409), ([good], revision, False, 400),
        ]:
            status, result = self.request("/api/transactions/flags", {"updates": updates, "revision": rev, "confirm": confirm})
            self.assertEqual(status, expected, result)
            self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.path.parent / "backups").exists())

    def test_decimal_scan_filters_both_types_and_binds_option_to_confirmation(self):
        rows = [row(id="a", amount=10, category="Transfer"), row(id="b", amount=-10, accountName="Checking"),
                row(id="c", amount=12.34, category="Transfer"), row(id="d", amount=-12.34, accountName="Checking"),
                row(id="e", amount=20), row(id="f", amount=-20, description="Refund"),
                row(id="g", amount=22.25), row(id="h", amount=-22.25, description="Refund")]
        self.seed(rows)
        before = self.path.read_bytes()
        status, full = self.request("/api/reconciliation/preview", {})
        self.assertEqual(status, 200, full)
        self.assertEqual(full["transferPairs"], 2)
        self.assertEqual(len(full["refundSuggestions"]), 2)
        status, cents = self.request("/api/reconciliation/preview", {"nonzeroDecimal": True})
        self.assertEqual(status, 200, cents)
        self.assertEqual(cents["transferPairs"], 1)
        self.assertEqual([r["id"] for r in cents["refundSuggestions"]], ["h"])
        self.assertEqual(self.path.read_bytes(), before)
        payload = {"revision": cents["revision"], "plan": cents["plan"], "confirm": True}
        status, _ = self.request("/api/reconciliation/confirm", payload)
        self.assertEqual(status, 409)
        status, saved = self.request("/api/reconciliation/confirm", {**payload, "nonzeroDecimal": True})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["transferPairs"], 1)
        status, second = self.request("/api/reconciliation/preview", {"nonzeroDecimal": True})
        self.assertEqual(len(second["alreadyFlagged"]), 2)

    def test_credit_side_can_link_retype_and_unlink_without_changing_source_amounts(self):
        rows = [row(id="expense", amount=100), row(id="credit", amount=-100, accountName="Checking", flags="flagged")]
        revision = self.seed(rows)
        for target, kind in [("expense", "refund"), ("expense", "transfer"), ("expense", "repayment"), ("", "repayment")]:
            status, result = self.request("/api/transactions/1", {"revision": revision,
                "transaction": {**rows[1], "linkTo": {"transactionId": target, "type": kind}}}, method="PUT")
            self.assertEqual(status, 200, result)
            revision = result["revision"]
            saved = read_transaction_state(self.path)[0]
            self.assertEqual([r["amount"] for r in saved], [100, -100])
            self.assertEqual(saved[1]["flags"], "flagged")
            self.assertEqual(reconciliation.links(saved[0]), [{"transactionId": "credit", "type": kind}] if target else [])
            self.assertTrue(all("linkTo" not in r for r in saved))

    def test_repayments_share_one_expense_but_credit_has_one_owner_and_refunds_are_single(self):
        rows = [row(id="expense", amount=100), row(id="other", amount=50),
                row(id="credit-a", amount=-30), row(id="credit-b", amount=-20)]
        rows[2]["linkTo"] = {"transactionId": "expense", "type": "repayment"}
        rows[3]["linkTo"] = {"transactionId": "expense", "type": "repayment"}
        updated = reconciliation.apply_repayment_targets(rows)
        self.assertEqual(len(reconciliation.links(updated[0])), 2)
        updated[2]["linkTo"] = {"transactionId": "other", "type": "repayment"}
        moved = reconciliation.apply_repayment_targets(updated)
        self.assertEqual(len(reconciliation.links(moved[0])), 1)
        self.assertEqual(len(reconciliation.links(moved[1])), 1)
        self.assertEqual(reconciliation.validate(moved)[1]["credit-a"], "other")
        for target, kind in [("expense", "refund"), ("expense", "transfer"), ("credit-b", "repayment")]:
            updated[2]["linkTo"] = {"transactionId": target, "type": kind}
            with self.assertRaises(ValueError): reconciliation.apply_repayment_targets(updated)
        self.assertEqual(len(reconciliation.links(updated[0])), 2, "Failed attempts never mutate inputs")

    def test_forced_import_copies_remap_reverse_link_intents(self):
        rows = [row(id="expense", amount=100), row(id="credit", amount=-100)]
        incoming = [rows[0], {**rows[1], "linkTo": {"transactionId": "expense", "type": "refund"}}]
        prepared = reconciliation.prepare_incoming(rows, incoming, "seed")
        self.assertNotEqual(prepared[0]["id"], "expense")
        self.assertEqual(prepared[1]["linkTo"]["transactionId"], prepared[0]["id"])
        linked = reconciliation.apply_repayment_targets(rows + prepared)
        self.assertFalse(reconciliation.links(linked[0]))
        self.assertEqual(reconciliation.links(linked[2])[0]["transactionId"], prepared[1]["id"])

    def test_import_reverse_refund_stays_staged_and_requires_its_reviewed_plan(self):
        self.seed([row(id="expense", amount=100)])
        before = self.path.read_bytes()
        status, session = self.request("/api/csv-import-sessions", {
            "content": csv_text([row(id="credit", amount=-80, description="Partial refund")]), "matchRefunds": False})
        self.assertEqual(status, 201, session)
        review = session["import"]
        pending = [{**review["transactions"][0], "_selected": True,
                    "linkTo": {"transactionId": "expense", "type": "refund"}}]
        status, preview = self.request("/api/transactions/staged-preview", {
            "transactions": pending, "revision": review["revision"]})
        self.assertEqual(status, 200, preview)
        self.assertEqual(self.path.read_bytes(), before)
        route = f"/api/csv-import-sessions/{session['token']}/commit"
        status, result = self.request(route, {"transactions": pending, "transferPlan": "old"})
        self.assertEqual(status, 409, result)
        self.assertEqual(self.path.read_bytes(), before)
        status, result = self.request(route, {"transactions": pending, "transferPlan": preview["transferPlan"]})
        self.assertEqual(status, 200, result)
        saved = read_transaction_state(self.path)[0]
        self.assertEqual(reconciliation.decorate(saved)[0]["_budgetAmount"], 20)
        self.assertEqual(len(saved), 2)
        self.assertTrue(all("linkTo" not in item for item in saved))
