"""Global import options and reverse repayment links, using temporary synthetic data."""
import io
import csv
import unittest
from unittest.mock import patch

import test_groups_bulk as base
import server
import reconciliation


def csv_text(rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=server.LEDGER_IMPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


class ImportPreferencesTests(unittest.TestCase):
    setUp = base.BulkApiTests.setUp
    tearDown = base.BulkApiTests.tearDown
    request = base.BulkApiTests.request

    def seed(self):
        rows = [base.row(id="purchase", date="2026-08-01", amount=100),
                base.row(id="earlier-credit", date="2026-08-03", amount=-20)]
        server.write_transactions_atomic(self.path, rows)
        return rows, self.path.read_bytes(), server.read_transaction_state(self.path)[1]

    def test_every_source_freezes_and_validates_refund_preference(self):
        self.seed()
        parsers = {"amazon": "parse_amazon", "aliexpress": "parse_aliexpress", "venmo": "parse_venmo",
                   "applecard": "parse_apple_card", "ebay": "parse_ebay", "walmart": "parse_walmart",
                   "capitalone": "parse_capital_one", "schwab": "parse_schwab_checking"}
        credit = base.row(date="2026-08-20", amount=-100, description="Synthetic store credit")
        for source, parser in parsers.items():
            route = f"/api/{source}-import-sessions"
            for enabled in (True, False):
                with self.subTest(source=source, enabled=enabled):
                    status, session = self.request(route, {"startDate": "2026-08-01", "endDate": "2026-08-31", "matchRefunds": enabled})
                    self.assertEqual(status, 201, session)
                    self.assertIs(session["matchRefunds"], enabled)
                    result = ([credit], []) if source in {"walmart", "schwab"} else [credit]
                    with patch.object(server, parser, return_value=result):
                        status, review = self.request(f"{route}/{session['token']}/complete", {"content": "synthetic", "matchRefunds": not enabled})
                    self.assertEqual(status, 200, review)
                    self.assertEqual(len(review["import"]["transactions"][0]["_refundCandidates"]), int(enabled))
            status, error = self.request(route, {"startDate": "2026-08-01", "endDate": "2026-08-31", "matchRefunds": "false"})
            self.assertEqual(status, 400, error)

    def test_csv_refund_defaults_on_off_is_enforced_and_confirmed_refund_deduplicates(self):
        _, before, _ = self.seed()
        content = csv_text([base.row(date="2026-08-20", amount=-100)])
        status, disabled = self.request("/api/csv-import-sessions", {"content": content, "matchRefunds": False})
        self.assertEqual(status, 201, disabled)
        self.assertEqual(disabled["import"]["transactions"][0]["_refundCandidates"], [])
        choices = [{"stagedId": 0, "purchaseId": 0}]
        status, error = self.request(f"/api/csv-import-sessions/{disabled['token']}/commit", {"transactions": [], "refundSelections": choices})
        self.assertEqual(status, 400, error)
        status, session = self.request("/api/csv-import-sessions", {"content": content})
        self.assertIs(session["matchRefunds"], True)
        review = session["import"]
        self.assertEqual(len(review["transactions"][0]["_refundCandidates"]), 1)
        pending = [dict(review["transactions"][0], _selected=False)]
        status, proposal = self.request("/api/transactions/staged-preview", {
            "revision": review["revision"], "transactions": pending, "importToken": session["token"], "refundSelections": choices})
        self.assertEqual(status, 200, proposal)
        self.assertEqual(self.path.read_bytes(), before)
        status, saved = self.request(f"/api/csv-import-sessions/{session['token']}/commit", {
            "transactions": [], "refundSelections": choices, "transferPlan": proposal["transferPlan"]})
        self.assertEqual(status, 200, saved)
        status, repeat = self.request("/api/csv-import-sessions", {"content": content})
        self.assertEqual(repeat["import"]["duplicates"], 1)
        self.assertTrue(repeat["import"]["transactions"][0]["_refundAlreadyHandled"])
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)

    def test_repayment_can_be_saved_from_credit_and_moved_or_unlinked_atomically(self):
        rows, before, revision = self.seed()
        status, saved = self.request("/api/transactions/1", {
            "revision": revision, "transaction": {**rows[1], "repaymentTo": "purchase"}}, method="PUT")
        self.assertEqual(status, 200, saved)
        purchase = next(row for row in saved["transactions"] if row["id"] == "purchase")
        self.assertEqual(purchase["_budgetAmount"], 80)
        self.assertEqual(reconciliation.links(purchase), [{"transactionId": "earlier-credit", "type": "repayment"}])
        self.assertNotIn("repaymentTo", self.path.read_text())
        self.assertEqual(next((self.path.parent / "backups").glob("*.csv")).read_bytes(), before)
        status, _ = self.request("/api/transactions/1", {
            "revision": revision, "transaction": {**rows[1], "repaymentTo": ""}}, method="PUT")
        self.assertEqual(status, 409)
        status, unlinked = self.request("/api/transactions/1", {
            "revision": saved["revision"], "transaction": {**rows[1], "repaymentTo": ""}}, method="PUT")
        self.assertEqual(status, 200, unlinked)
        self.assertTrue(all(not reconciliation.links(row) for row in unlinked["transactions"]))

    def test_import_repayment_appends_to_existing_family_only_after_confirmation(self):
        rows, _, _ = self.seed()
        rows = reconciliation.set_links(rows, "purchase", [{"transactionId": "earlier-credit", "type": "repayment"}])
        server.write_transactions_atomic(self.path, rows)
        before = self.path.read_bytes()
        content = csv_text([base.row(date="2026-08-20", amount=-30, description="Shared dinner repayment")])
        _, session = self.request("/api/csv-import-sessions", {"content": content})
        review = session["import"]
        pending = [dict(review["transactions"][0], repaymentTo="purchase", _selected=True)]
        status, proposal = self.request("/api/transactions/staged-preview", {
            "revision": review["revision"], "transactions": pending, "importToken": session["token"]})
        self.assertEqual(status, 200, proposal)
        self.assertEqual(proposal["transactions"][0]["_netAmount"], 50)
        self.assertEqual(self.path.read_bytes(), before)
        for unseen in ({}, {"transferPlan": "unseen-plan"}):
            status, error = self.request(f"/api/csv-import-sessions/{session['token']}/commit", {
                "transactions": proposal["transactions"], **unseen})
            self.assertEqual(status, 409, error)
            self.assertEqual(self.path.read_bytes(), before)
        status, saved = self.request(f"/api/csv-import-sessions/{session['token']}/commit", {
            "transactions": proposal["transactions"], "transferPlan": proposal["transferPlan"]})
        self.assertEqual(status, 200, saved)
        stored, _ = server.read_transaction_state(self.path)
        purchase = next(row for row in reconciliation.decorate(stored) if row["id"] == "purchase")
        self.assertEqual(purchase["_budgetAmount"], 50)
        self.assertEqual(len(reconciliation.links(purchase)), 2)

    def test_unchecked_or_cancelled_repayment_never_updates_existing_purchase(self):
        _, before, _ = self.seed()
        content = csv_text([base.row(date="2026-08-20", amount=-30)])
        for cancel in (True, False):
            _, session = self.request("/api/csv-import-sessions", {"content": content})
            review = session["import"]
            pending = [dict(review["transactions"][0], repaymentTo="purchase", _selected=False)]
            status, proposal = self.request("/api/transactions/staged-preview", {
                "revision": review["revision"], "transactions": pending, "importToken": session["token"]})
            self.assertEqual(status, 200, proposal)
            route = "cancel" if cancel else "commit"
            status, result = self.request(f"/api/csv-import-sessions/{session['token']}/{route}", {
                "transactions": [], "transferPlan": proposal["transferPlan"]})
            self.assertEqual(status, 200, result)
            self.assertEqual(self.path.read_bytes(), before)

    def test_reverse_link_invalid_targets_leave_database_untouched(self):
        rows, before, revision = self.seed()
        for target in ("missing", "earlier-credit", False, 23, []):
            status, result = self.request("/api/transactions/1", {
                "revision": revision, "transaction": {**rows[1], "repaymentTo": target}}, method="PUT")
            self.assertEqual(status, 400, result)
            self.assertEqual(self.path.read_bytes(), before)

    def test_repayment_target_in_same_import_must_be_selected(self):
        _, before, _ = self.seed()
        content = csv_text([base.row(id="new-purchase", amount=150), base.row(id="new-credit", amount=-50)])
        _, session = self.request("/api/csv-import-sessions", {"content": content})
        review = session["import"]
        pending = [dict(row, _selected=True, **({"repaymentTo":"new-purchase"} if row["id"] == "new-credit" else {}))
                   for row in review["transactions"]]
        status, proposal = self.request("/api/transactions/staged-preview", {
            "revision": review["revision"], "transactions": pending, "importToken": session["token"]})
        self.assertEqual(status, 200, proposal)
        credit = next(row for row in proposal["transactions"] if row["id"] == "new-credit")
        self.assertEqual(credit["_netAmount"], 100)
        self.assertEqual(credit["_refundCandidates"], [])
        pending = [dict(row, _selected=row["id"] == "new-credit") for row in pending]
        status, error = self.request("/api/transactions/staged-preview", {
            "revision": review["revision"], "transactions": pending, "importToken": session["token"]})
        self.assertEqual(status, 400, error)
        self.assertEqual(self.path.read_bytes(), before)

    def test_reverse_mapping_preserves_other_repayments_and_cannot_steal_refunds(self):
        rows = [base.row(id="a", amount=100), base.row(id="b", amount=50),
                base.row(id="c", amount=-20), base.row(id="d", amount=-30)]
        rows = reconciliation.set_links(rows, "a", [{"transactionId":"c","type":"repayment"}, {"transactionId":"d","type":"repayment"}])
        rows[2]["repaymentTo"] = "b"
        moved = reconciliation.apply_repayment_targets(rows)
        self.assertEqual(reconciliation.links(moved[0]), [{"transactionId":"d","type":"repayment"}])
        self.assertEqual(reconciliation.links(moved[1]), [{"transactionId":"c","type":"repayment"}])
        self.assertEqual(len(reconciliation.links(rows[0])), 2, "Input rows stay untouched")
        moved = reconciliation.set_links(moved, "b", [{"transactionId":"c","type":"refund"}])
        moved[2]["repaymentTo"] = "a"
        with self.assertRaisesRegex(ValueError, "refund or transfer"):
            reconciliation.apply_repayment_targets(moved)
