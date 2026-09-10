"""Refund suggestions and manual editing share one selected, no-write graph."""
import unittest
from unittest.mock import patch

import test_credit_karma_direct_import as session_tests
from test_import_preferences import csv_text
from test_refund_import import purchase
import reconciliation
import server


class RefundReviewLinksTests(unittest.TestCase):
    setUp = session_tests.CreditKarmaDirectImportTests.setUp
    tearDown = session_tests.CreditKarmaDirectImportTests.tearDown
    request = session_tests.CreditKarmaDirectImportTests.request

    def stage(self, rows, **options):
        status, session = self.request("POST", "/api/csv-import-sessions", {
            "content": csv_text(rows), "applyClassifications": False, **options})
        self.assertEqual(status, 201, session)
        return session["token"], session["import"]

    def refresh(self, token, review, rows=None, expected=200):
        status, result = self.request("POST", "/api/transactions/staged-preview", {
            "importToken": token, "revision": review["revision"],
            "transactions": rows if rows is not None else review["transactions"]})
        self.assertEqual(status, expected, result)
        return {"revision": review["revision"], **result}

    def commit(self, token, review, **overrides):
        return self.request("POST", f"/api/csv-import-sessions/{token}/commit", {
            "transactions": [row for row in review["transactions"]
                             if row.get("_selected", not row["_isDuplicate"])],
            "transferPlan": review["transferPlan"], **overrides})

    @staticmethod
    def pair():
        return [purchase(id="purchase", date="2026-09-07", amount=219,
                         description="SYNTHETIC MEMBERSHIP"),
                purchase(id="credit", date="2026-09-08", amount=-219,
                         description="Synthetic membership statement credit", category="Income")]

    def assert_untouched(self, before):
        self.assertEqual(self.csv_path.read_bytes(), before)
        self.assertFalse((self.csv_path.parent / "backups").exists())

    def test_same_batch_suggestion_and_editor_intent_persist_two_original_rows_once(self):
        before = self.csv_path.read_bytes()
        originals = self.pair()
        token, review = self.stage(originals)
        credit = next(row for row in review["transactions"] if row["amount"] < 0)
        [candidate] = credit["_refundCandidates"]
        self.assertEqual((candidate["id"], candidate["_stagedId"]), ("purchase", 0))
        self.assertNotIn("_linkRole", credit, "A suggestion is not a confirmed decision")
        credit["linkTo"] = {"transactionId": candidate["id"], "type": "refund"}
        review = self.refresh(token, review)
        self.assertEqual({row["id"]: row["_budgetAmount"] for row in review["transactions"]},
                         {"purchase": 0, "credit": 0})
        credit = next(row for row in review["transactions"] if row["id"] == "credit")
        self.assertEqual(credit["_linkedTo"]["id"], "purchase")
        self.assertEqual(credit["_linkType"], "refund")
        self.assertEqual(credit["_refundCandidates"], [])
        self.assertTrue(credit["_selected"])
        unchanged = self.refresh(token, review)
        self.assertEqual(unchanged["transferPlan"], review["transferPlan"])
        credit["notes"] = "Edited after matching"
        edited = self.refresh(token, review)
        self.assertNotEqual(edited["transferPlan"], review["transferPlan"])
        self.assertEqual(self.commit(token, edited, transferPlan=review["transferPlan"])[0], 409)
        self.assert_untouched(before)
        status, result = self.commit(token, edited)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["import"]["committed"], 2)
        self.assertEqual(result["import"]["purchasesRefunded"], 1)
        saved, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual([(row["id"], row["date"], row["amount"]) for row in saved],
                         [("purchase", "2026-09-07", 219), ("credit", "2026-09-08", -219)])
        self.assertEqual(reconciliation.links(saved[0]), [{"transactionId": "credit", "type": "refund"}])
        self.assertEqual(saved[1]["notes"], "Edited after matching")
        self.assertEqual(saved[0]["createdAt"], saved[1]["createdAt"])
        self.assertTrue(saved[0]["createdAt"])
        self.assertEqual(next((self.csv_path.parent / "backups").glob("*.csv")).read_bytes(), before)
        _, repeated = self.stage(originals)
        self.assertEqual((repeated["new"], repeated["duplicates"]), (0, 2))
        self.assertTrue(next(row for row in repeated["transactions"] if row["amount"] < 0)["_refundAlreadyHandled"])

    def test_saved_purchase_link_is_visible_and_undo_clears_every_derived_field(self):
        original, credit = self.pair()
        server.write_transactions_atomic(self.csv_path, [original])
        before = self.csv_path.read_bytes()
        token, review = self.stage([credit])
        review["transactions"][0]["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        linked = self.refresh(token, review)
        [counterpart] = linked["existingTransferUpdates"]
        self.assertEqual(counterpart["id"], "purchase")
        self.assertEqual(counterpart["_linkedTransactions"][0]["id"], "credit")
        linked["transactions"][0]["linkTo"] = {"transactionId": "", "type": "refund"}
        unlinked = self.refresh(token, linked)
        self.assertEqual(unlinked["existingTransferUpdates"], [])
        for field in ("_linkRole", "_linkType", "_linkedTo", "_budgetAmount", "_netAmount"):
            self.assertNotIn(field, unlinked["transactions"][0])
        self.assertEqual(unlinked["transactions"][0]["_refundCandidates"][0]["id"], "purchase")
        self.assert_untouched(before)
        status, result = self.commit(token, unlinked)
        self.assertEqual(status, 200, result)
        saved, _ = server.read_transaction_state(self.csv_path)
        self.assertFalse(any(reconciliation.links(row) for row in saved))
        self.assertEqual(saved[0]["createdAt"], original["createdAt"])

    def test_same_batch_link_does_not_initialize_missing_database_until_confirmation(self):
        self.csv_path.unlink()
        token, review = self.stage(self.pair())
        next(row for row in review["transactions"] if row["amount"] < 0)["linkTo"] = {
            "transactionId": "purchase", "type": "refund"}
        linked = self.refresh(token, review)
        self.assertFalse(self.csv_path.exists())
        self.assertFalse((self.csv_path.parent / "backups").exists())
        status, result = self.commit(token, linked)
        self.assertEqual(status, 200, result)
        saved, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual(len(saved), 2)
        self.assertEqual([row["_budgetAmount"] for row in reconciliation.decorate(saved)], [0, 0])

    def test_selection_controls_candidates_and_incomplete_families_cannot_write(self):
        before = self.csv_path.read_bytes()
        token, review = self.stage(self.pair())
        rows = [dict(row, _selected=row["amount"] < 0) for row in review["transactions"]]
        refreshed = self.refresh(token, review, rows)
        self.assertEqual(next(row for row in refreshed["transactions"] if row["amount"] < 0)["_refundCandidates"], [])
        credit = next(row for row in rows if row["amount"] < 0)
        credit["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        self.refresh(token, review, rows, expected=400)
        self.assertEqual(self.commit(token, {**review, "transactions": rows})[0], 400)
        credit["_selected"] = False
        next(row for row in rows if row["amount"] > 0)["_selected"] = True
        refreshed = self.refresh(token, review, rows)
        self.assertTrue(all("_linkRole" not in row for row in refreshed["transactions"]))
        self.assert_untouched(before)
        status, result = self.commit(token, refreshed)
        self.assertEqual(status, 200, result)
        saved, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual([(row["id"], row["amount"], row["links"]) for row in saved], [("purchase", 219, "")])

    def test_claimed_purchase_is_not_offered_twice_and_conflicting_manual_link_is_rejected(self):
        original, first = self.pair()
        second = {**first, "id": "credit-two", "description": "Another credit"}
        token, review = self.stage([original, first, second])
        for credit in (row for row in review["transactions"] if row["amount"] < 0):
            self.assertEqual([row["id"] for row in credit["_refundCandidates"]], ["purchase"])
        next(row for row in review["transactions"] if row["id"] == "credit")["linkTo"] = {
            "transactionId": "purchase", "type": "refund"}
        review = self.refresh(token, review)
        second = next(row for row in review["transactions"] if row["id"] == "credit-two")
        self.assertEqual(second["_refundCandidates"], [])
        second["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        self.refresh(token, review, expected=400)

    def test_saved_and_same_batch_candidates_have_stable_distinct_ids_and_account_ranking(self):
        original, credit = self.pair()
        saved = {**original, "id": "saved", "date": "2026-09-01", "accountName": "Other card"}
        server.write_transactions_atomic(self.csv_path, [saved])
        token, review = self.stage([original, credit])
        candidates = next(row for row in review["transactions"] if row["id"] == "credit")["_refundCandidates"]
        self.assertEqual([row["id"] for row in candidates], ["purchase", "saved"])
        self.assertEqual(candidates[0]["_stagedId"], 0)
        self.assertNotIn("_stagedId", candidates[1])
        refreshed = self.refresh(token, review)
        refreshed_candidates = next(row for row in refreshed["transactions"] if row["id"] == "credit")["_refundCandidates"]
        self.assertEqual([(row["id"], row.get("_stagedId")) for row in refreshed_candidates],
                         [("purchase", 0), ("saved", None)])

    def test_forced_duplicate_purchase_is_not_an_automatic_same_batch_candidate(self):
        original, credit = self.pair()
        server.write_transactions_atomic(self.csv_path, [original])
        token, review = self.stage([original, credit])
        rows = [dict(row, _selected=True) for row in review["transactions"]]
        refreshed = self.refresh(token, review, rows)
        candidates = next(row for row in refreshed["transactions"] if row["amount"] < 0)["_refundCandidates"]
        self.assertEqual([row["id"] for row in candidates], ["purchase"])
        self.assertNotIn("_stagedId", candidates[0])

    def test_session_opt_out_survives_refresh_but_does_not_disable_explicit_manual_linking(self):
        token, review = self.stage(self.pair(), matchRefunds=False)
        self.assertTrue(all(row["_refundCandidates"] == [] for row in review["transactions"]))
        refreshed = self.refresh(token, review)
        self.assertTrue(all(row["_refundCandidates"] == [] for row in refreshed["transactions"]))
        next(row for row in refreshed["transactions"] if row["amount"] < 0)["linkTo"] = {
            "transactionId": "purchase", "type": "refund"}
        linked = self.refresh(token, refreshed)
        self.assertEqual({row["_budgetAmount"] for row in linked["transactions"]}, {0})
        self.assertEqual(self.commit(token, linked)[0], 200)

    def test_automatic_transfer_purchase_is_not_offered_to_a_second_refund_credit(self):
        original, credit = self.pair()
        original.update(date="2026-09-07", description="Online transfer", category="Transfer")
        server.write_transactions_atomic(self.csv_path, [original])
        transfer = {**credit, "id": "transfer", "accountName": "Other checking"}
        _, review = self.stage([transfer, credit])
        self.assertEqual(review["transferPairs"], 1)
        self.assertTrue(all(row["_refundCandidates"] == [] for row in review["transactions"]))

    def test_child_only_selection_of_imported_linked_family_requires_explicit_unlink(self):
        before = self.csv_path.read_bytes()
        family = reconciliation.set_links(self.pair(), "purchase", [{"transactionId": "credit", "type": "refund"}])
        token, review = self.stage(family)
        rows = [dict(row, _selected=row["amount"] < 0) for row in review["transactions"]]
        self.refresh(token, review, rows, expected=400)
        self.assertEqual(self.commit(token, {**review, "transactions": rows}, transferPlan=None)[0], 409)
        self.assert_untouched(before)
        next(row for row in rows if row["amount"] < 0)["linkTo"] = {"transactionId": "", "type": "refund"}
        unlinked = self.refresh(token, review, rows)
        status, result = self.commit(token, unlinked)
        self.assertEqual(status, 200, result)
        saved, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual([(row["id"], row["amount"]) for row in saved], [("credit", -219)])

    def test_reverse_unlink_projects_explicit_empty_links_without_rewriting_import_drafts(self):
        family = reconciliation.set_links(self.pair(), "purchase", [{"transactionId": "credit", "type": "refund"}])
        token, review = self.stage(family)
        next(row for row in review["transactions"] if row["id"] == "credit")["linkTo"] = {
            "transactionId": "", "type": "refund"}
        unlinked = self.refresh(token, review)
        parent = next(row for row in unlinked["transactions"] if row["id"] == "purchase")
        self.assertEqual(reconciliation.links(parent), [{"transactionId": "credit", "type": "refund"}])
        self.assertEqual(parent["_reviewLinks"], [], "An explicit empty projection overrides the retained request intent")
        self.assertNotIn("_linkRole", parent)
        status, result = self.commit(token, unlinked)
        self.assertEqual(status, 200, result)
        self.assertTrue(all(not reconciliation.links(row) for row in server.read_transaction_state(self.csv_path)[0]))

    def test_saved_reverse_unlink_projects_explicit_empty_links_for_settings_editor(self):
        family = reconciliation.set_links(self.pair(), "purchase", [{"transactionId": "credit", "type": "refund"}])
        server.write_transactions_atomic(self.csv_path, family)
        _, revision = server.read_transaction_state(self.csv_path)
        before = self.csv_path.read_bytes()
        credit = {**family[1], "_id": 1, "linkTo": {"transactionId": "", "type": "refund"}}
        status, review = self.request("POST", "/api/reconciliation/preview", {
            "revision": revision, "overrides": [credit]})
        self.assertEqual(status, 200, review)
        parent = next(row for row in review["transactions"] if row["id"] == "purchase")
        self.assertEqual(reconciliation.links(parent), [{"transactionId": "credit", "type": "refund"}])
        self.assertEqual(parent["_reviewLinks"], [])
        self.assertNotIn("_linkRole", parent)
        self.assertEqual({row["id"] for row in review["transactions"]}, {"purchase", "credit"})
        self.assert_untouched(before)

    def test_settings_reverse_link_projects_both_sides_and_keeps_request_intent_for_editing(self):
        server.write_transactions_atomic(self.csv_path, self.pair())
        before = self.csv_path.read_bytes()
        _, revision = server.read_transaction_state(self.csv_path)
        credit = {**self.pair()[1], "_id": 1,
                  "linkTo": {"transactionId": "purchase", "type": "refund"}}
        status, linked = self.request("POST", "/api/reconciliation/preview", {
            "revision": revision, "overrides": [credit]})
        self.assertEqual(status, 200, linked)
        self.assertEqual({row["id"] for row in linked["transactions"]}, {"purchase", "credit"})
        self.assertEqual(linked["alreadyFlagged"], [])
        projected_credit = next(row for row in linked["transactions"] if row["id"] == "credit")
        self.assertEqual(projected_credit["linkTo"], credit["linkTo"])
        self.assertEqual(projected_credit["_linkedTo"]["id"], "purchase")
        projected_purchase = next(row for row in linked["transactions"] if row["id"] == "purchase")
        self.assertEqual(projected_purchase["links"], "", "Canonical projection is not a second draft intent")
        self.assertEqual(projected_purchase["_linkedTransactions"][0]["id"], "credit")
        credit["linkTo"] = {"transactionId": "", "type": "refund"}
        status, unlinked = self.request("POST", "/api/reconciliation/preview", {
            "revision": revision, "overrides": [credit]})
        self.assertEqual(status, 200, unlinked)
        self.assertEqual(unlinked["changes"], [])
        self.assertEqual(unlinked["transactions"], [])
        self.assertEqual([row["id"] for row in unlinked["refundSuggestions"]], ["credit"])
        self.assert_untouched(before)
        credit["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        status, result = self.request("POST", "/api/reconciliation/confirm", {
            "revision": revision, "overrides": [credit], "plan": linked["plan"], "confirm": True})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["refundsLinked"], 1)
        self.assertEqual({row["_budgetAmount"] for row in result["transactions"]}, {0})
        self.assertEqual(next((self.csv_path.parent / "backups").glob("*.csv")).read_bytes(), before)

    def test_cancel_stale_revision_missing_plan_and_backup_failure_do_not_save_link(self):
        original, credit = self.pair()
        server.write_transactions_atomic(self.csv_path, [original])
        before = self.csv_path.read_bytes()
        token, review = self.stage([credit])
        review["transactions"][0]["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        linked = self.refresh(token, review)
        self.assertEqual(self.commit(token, linked, transferPlan=None)[0], 409)
        with patch.object(server, "create_backup_copy", side_effect=OSError("Synthetic backup failure")):
            self.assertEqual(self.commit(token, linked)[0], 500)
        self.assert_untouched(before)
        self.request("POST", f"/api/csv-import-sessions/{token}/cancel", {})
        self.commit(token, linked)
        self.assert_untouched(before)
        token, review = self.stage([credit])
        review["transactions"][0]["linkTo"] = {"transactionId": "purchase", "type": "refund"}
        linked = self.refresh(token, review)
        server.write_transactions_atomic(self.csv_path, [{**original, "notes": "New saved revision"}])
        revised = self.csv_path.read_bytes()
        self.assertEqual(self.commit(token, linked)[0], 409)
        self.assertEqual(self.csv_path.read_bytes(), revised)


if __name__ == "__main__":
    unittest.main()
