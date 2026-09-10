from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import refunds
import server
from importers import parse_credit_karma
import test_credit_karma_direct_import as ck_tests


def purchase(**values):
    return server.normalize_transaction({
        "date": "2026-08-01", "description": "Synthetic item", "amount": 25,
        "category": "Shopping", "subcategory": "Tools", "accountName": "Test card",
        "accountType": "CREDIT CARD", "provider": "Test provider", "notes": "Keep my notes",
        "tags": "bike", "group": "Project", "flags": "custom-flag",
        "createdAt": "2026-08-01T00:00:00Z", **values,
    }, "test")


def raw_credit(**values):
    return {"date": "2026-08-20", "description": "AMAZON refund", "amount": 25,
        "transactionType": "credit", "category": "Shopping", "accountName": "Test card",
        "accountType": "CREDIT CARD", "provider": "Test provider", **values}


class RefundLogicTests(unittest.TestCase):
    def test_merchant_credits_bypass_only_the_selected_exclusions_when_enabled(self):
        merchants = ["AMAZON", "ALIPAY", "Ali Express", "Ali   Express", "AliExpress", "VENMO", "EBAY", "WALMART", "wal-mart", "wal   mart", "WM SUPERCENTER"]
        rows = [raw_credit(description=name, amount=(-25 if i % 2 else 25)) for i, name in enumerate(merchants)]
        rows += [raw_credit(description=name, transactionType="debit") for name in merchants]
        export = json.dumps({"transactions": rows})
        enabled = parse_credit_karma(export, match_refunds=True)
        self.assertEqual(len(enabled.transactions), len(merchants))
        self.assertTrue(all(row["amount"] == -25 for row in enabled.transactions))
        self.assertEqual(len(enabled.refund_indexes), len(merchants))
        self.assertEqual(parse_credit_karma(export, match_refunds=False).transactions, [])
        ordinary = parse_credit_karma(json.dumps({"transactions": [raw_credit(description="Salary")]}), match_refunds=True)
        self.assertEqual(ordinary.refund_indexes, ())
        self.assertEqual(ordinary.transactions[0]["amount"], -25)

    def test_exact_cent_lookback_and_purchase_eligibility_with_account_ranking(self):
        credit = purchase(date="2026-08-20", amount=-25, flags="")
        cutoff = (date(2026, 8, 20) - timedelta(days=90)).isoformat()
        rows = [purchase(date="2026-08-19", accountName="Different card"), purchase(date=cutoff),
            purchase(date="2026-08-20"), purchase(date="2026-08-21"), purchase(date="2026-01-01"),
            purchase(amount=24.99), purchase(amount=-25), purchase(flags="refunded"),
            purchase(flags="internal-transfer"), purchase(category="Income"), purchase(amount=0)]
        self.assertEqual([row["_id"] for row in refunds.candidates(rows, credit)], [2, 1, 0])
        self.assertEqual(refunds.candidates(rows, dict(credit, amount=-10)), [], "Partial refunds are not guessed")
        self.assertEqual(refunds.candidates(rows, dict(credit, flags="internal-transfer")), [])

    def test_receipts_survive_normalization_and_count_each_occurrence(self):
        credit = purchase(date="2026-08-20", amount=-25)
        original = [purchase(), purchase()]
        updated, choices = refunds.apply(original, {0: credit, 1: credit}, [
            {"stagedId": 0, "purchaseId": 0}, {"stagedId": 1, "purchaseId": 1}], set())
        self.assertEqual(len(choices), 2)
        self.assertEqual(original[0]["flags"], "custom-flag")
        normalized = [server.normalize_transaction(row, "receipt") for row in updated]
        self.assertEqual(refunds.receipt_counts(normalized)[refunds.identity(credit)], 2)
        normalized.append(purchase(date=credit["date"], amount=-25))
        preview, new, duplicate = server.preview_imported_transactions(normalized, [credit] * 4, "creditkarma")
        self.assertEqual((new, duplicate), (1, 3))
        self.assertEqual(sum(row["_refundAlreadyHandled"] for row in preview), 2)
        self.assertEqual(len(server.merge_imported_transactions(normalized, {"creditkarma": [credit] * 4})[0]), 1)
        self.assertEqual(server.preview_imported_transactions(updated, original, "amazon")[1:], (0, 2))

    def test_purchases_in_this_refund_proposal_are_not_also_paired_as_transfers(self):
        rows = [purchase(flags="refunded", description="Online transfer"),
                purchase(amount=-25, accountName="Other bank")]
        self.assertEqual(server.transfer_plan(rows, "revision", 1, excluded_ids={0})[1], {})

    def test_export_roundtrip_and_clearing_refunded_keep_the_credit_receipt(self):
        rows = [purchase(flags="refund-receipt-2026-08-20-2500,refunded")]
        exported, _ = server.transaction_export_csv(rows, "2026-01-01", "2026-12-31")
        restored, count, invalid = server.parse_ledger_import_csv(exported.decode("utf-8-sig"))
        self.assertEqual((count, invalid), (1, []))
        restored[0]["flags"] = restored[0]["flags"].replace(",refunded", "")
        credit = purchase(date="2026-08-20", amount=-25)
        self.assertEqual(server.preview_imported_transactions(restored, [credit], "creditkarma")[1:], (0, 1))


class RefundImportTests(unittest.TestCase):
    setUp = ck_tests.CreditKarmaDirectImportTests.setUp
    tearDown = ck_tests.CreditKarmaDirectImportTests.tearDown
    request = ck_tests.CreditKarmaDirectImportTests.request
    create_session = ck_tests.CreditKarmaDirectImportTests.create_session

    def seed(self, rows=None):
        server.write_transactions_atomic(self.csv_path, rows or [purchase()])
        return self.csv_path.read_bytes()

    def stage(self, rows=None, **options):
        token = self.create_session(**options)
        status, result = self.request("POST", f"/api/creditkarma-import-sessions/{token}/complete",
            {"content": json.dumps({"transactions": rows or [raw_credit()]})})
        self.assertEqual(status, 200, result)
        return token, result["import"]

    def propose(self, token, result, selections):
        omitted = {choice["stagedId"] for choice in selections}
        rows = [dict(row, _selected=row["_stagedId"] not in omitted and not row["_isDuplicate"])
                for row in result["transactions"]]
        status, response = self.request("POST", "/api/transactions/staged-preview", {
            "importToken": token, "revision": result["revision"], "transactions": rows,
            "refundSelections": selections})
        self.assertEqual(status, 200, response)
        return response

    def commit(self, token, review, selections):
        return self.request("POST", f"/api/creditkarma-import-sessions/{token}/commit", {
            "transactions": [row for row in review["transactions"] if row.get("_selected", not row["_isDuplicate"])],
            "transferPlan": review["transferPlan"], "refundSelections": selections})

    def test_match_is_staged_then_atomically_links_actual_credit_and_reimports_as_duplicate(self):
        before = self.seed()
        token, result = self.stage()
        self.assertEqual(result["new"], 1)
        [credit] = result["transactions"]
        self.assertEqual(credit["amount"], -25)
        self.assertEqual(len(credit["_refundCandidates"]), 1)
        selections = [{"stagedId": credit["_stagedId"], "purchaseId": 0}]
        review = self.propose(token, result, selections)
        self.assertEqual(self.csv_path.read_bytes(), before)
        self.assertFalse((self.csv_path.parent / "backups").exists())
        self.assertEqual(review["purchasesRefunded"], 1)
        status, saved = self.commit(token, review, selections)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["import"]["committed"], 1)
        self.assertEqual(saved["import"]["purchasesRefunded"], 1)
        rows, _ = server.read_transaction_state(self.csv_path)
        after, refund = rows
        self.assertEqual(after["amount"], 25)
        self.assertEqual(after["flags"], "custom-flag")
        self.assertEqual(refund["amount"], -25)
        self.assertEqual(json.loads(after["links"]), [{"transactionId": refund["id"], "type": "refund"}])
        self.assertEqual([item["_budgetAmount"] for item in server.public_state(rows, "saved")["transactions"]], [0, 0])
        self.assertEqual(len(list((self.csv_path.parent / "backups").glob("*.csv"))), 1)
        _, repeat = self.stage([raw_credit(description="AMAZON credit changed description")])
        self.assertEqual((repeat["new"], repeat["duplicates"]), (0, 1))
        self.assertTrue(repeat["transactions"][0]["_refundAlreadyHandled"])
        self.assertEqual(repeat["transactions"][0]["_refundCandidates"], [])

    def test_identical_refunds_map_one_to_one_and_additional_occurrences_are_new(self):
        self.seed([purchase(), purchase(description="Second item")])
        token, result = self.stage([raw_credit(), raw_credit()])
        selections = [{"stagedId": 0, "purchaseId": 0}, {"stagedId": 1, "purchaseId": 1}]
        review = self.propose(token, result, selections)
        status, _ = self.commit(token, review, selections)
        self.assertEqual(status, 200)
        _, repeat = self.stage([raw_credit()] * 3)
        self.assertEqual((repeat["new"], repeat["duplicates"]), (1, 2))
        self.assertEqual(len(server.read_transaction_state(self.csv_path)[0]), 4)

    def test_mixed_import_and_refund_changes_share_one_atomic_write(self):
        self.seed([purchase(description="Online transfer", date="2026-08-19")])
        token, result = self.stage([raw_credit(), raw_credit(description="Unrelated credit", accountName="Other account")])
        choices = [{"stagedId": 0, "purchaseId": 0}]
        review = self.propose(token, result, choices)
        self.assertEqual(review["transferPairs"], 0, "A newly refunded purchase must not also pair with another credit")
        with patch.object(server, "write_transactions_atomic", wraps=server.write_transactions_atomic) as writer:
            status, saved = self.commit(token, review, choices)
        self.assertEqual(status, 200, saved)
        self.assertEqual(writer.call_count, 1)
        self.assertEqual(saved["import"]["committed"], 2)
        self.assertEqual(saved["import"]["purchasesRefunded"], 1)
        rows, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual(len(rows), 3)
        self.assertEqual(json.loads(rows[0]["links"])[0]["type"], "refund")
        self.assertTrue(all("internal-transfer" not in row["flags"] for row in rows))
        _, repeat = self.stage([raw_credit(), raw_credit(description="Unrelated credit")])
        self.assertEqual((repeat["new"], repeat["duplicates"]), (0, 2))

    def test_refund_provenance_survives_classification_description_changes(self):
        self.seed()
        server.write_classifications_atomic(self.csv_path, {"version": 2, "classifications": [{
            "updates": {"description": "My returned purchase", "category": "Shopping"},
            "rules": [{"description": "amazon"}],
        }]})
        token, result = self.stage()
        [credit] = result["transactions"]
        self.assertEqual(credit["description"], "My returned purchase")
        self.assertTrue(credit["_classificationMatched"])
        self.assertEqual(len(credit["_refundCandidates"]), 1)
        choices = [{"stagedId": 0, "purchaseId": 0}]
        self.assertEqual(self.commit(token, self.propose(token, result, choices), choices)[0], 200)

    def test_reviewed_credit_edits_survive_linking_and_change_the_confirmation_plan(self):
        self.seed()
        token,result=self.stage()
        choices=[{"stagedId":0,"purchaseId":0}]
        first=self.propose(token,result,choices)
        result["transactions"][0].update(notes="Return receipt saved",tags="bike",group="Bike build",flags="flagged")
        second=self.propose(token,result,choices)
        self.assertNotEqual(first["transferPlan"],second["transferPlan"])
        self.assertEqual(self.commit(token,first,choices)[0],409)
        status,saved=self.commit(token,second,choices)
        self.assertEqual(status,200,saved)
        credit=next(row for row in server.read_transaction_state(self.csv_path)[0] if row["amount"]<0)
        self.assertEqual((credit["notes"],credit["tags"],credit["group"],credit["flags"]),
                         ("Return receipt saved","bike","Bike build","flagged"))

    def test_no_database_has_no_matches_and_is_created_only_on_import_confirmation(self):
        self.csv_path.unlink()
        token, result = self.stage()
        self.assertEqual(result["transactions"][0]["_refundCandidates"], [])
        self.assertFalse(self.csv_path.exists())
        status, saved = self.commit(token, result, [])
        self.assertEqual(status, 200, saved)
        [credit], _ = server.read_transaction_state(self.csv_path)
        self.assertEqual(credit["amount"], -25)
        self.assertNotIn("refunded", credit["flags"])

    def test_declining_match_imports_credit_normally_and_disabled_toggle_keeps_legacy_filter(self):
        self.seed()
        token, result = self.stage()
        status, saved = self.commit(token, result, [])
        self.assertEqual(status, 200, saved)
        rows, _ = server.read_transaction_state(self.csv_path)
        self.assertEqual(len(rows), 2)
        self.assertNotIn("refunded", rows[0]["flags"])
        _, repeat = self.stage()
        self.assertEqual(repeat["duplicates"], 1)
        _, disabled = self.stage(matchRefunds=False)
        self.assertEqual(disabled["parsed"], 0)
        for value in ("true", 1, None, []):
            status, _ = self.request("POST", "/api/creditkarma-import-sessions", {
                "startDate": "2026-08-01", "endDate": "2026-08-31", "matchRefunds": value})
            self.assertEqual(status, 400)

    def test_cancel_stale_revision_and_unseen_plan_never_save_refund_changes(self):
        before = self.seed()
        token, result = self.stage()
        selections = [{"stagedId": 0, "purchaseId": 0}]
        review = self.propose(token, result, selections)
        status, _ = self.commit(token, dict(review, transferPlan="unseen"), selections)
        self.assertEqual(status, 409)
        self.assertEqual(self.csv_path.read_bytes(), before)
        self.request("POST", f"/api/creditkarma-import-sessions/{token}/cancel", {})
        _, cancelled = self.commit(token, review, selections)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(self.csv_path.read_bytes(), before)
        token, result = self.stage()
        review = self.propose(token, result, selections)
        server.write_transactions_atomic(self.csv_path, [purchase(notes="New revision")])
        revised = self.csv_path.read_bytes()
        self.assertEqual(self.commit(token, review, selections)[0], 409)
        self.assertEqual(self.csv_path.read_bytes(), revised)

    def test_forged_or_double_used_matches_reject_entire_batch(self):
        before = self.seed([purchase(), purchase(amount=26), purchase(flags="refunded")])
        token, result = self.stage([raw_credit(), raw_credit(), raw_credit(description="Purchase", transactionType="debit")])
        for selections in ([{"stagedId": 0, "purchaseId": 99}], [{"stagedId": 0, "purchaseId": 1}],
            [{"stagedId": 0, "purchaseId": 2}], [{"stagedId": True, "purchaseId": 0}],
            [{"stagedId": 2, "purchaseId": 0}], [{"stagedId": 99, "purchaseId": 0}],
            [{"stagedId": 0, "purchaseId": 0}, {"stagedId": 1, "purchaseId": 0}]):
            status, _ = self.request("POST", f"/api/creditkarma-import-sessions/{token}/commit", {
                "transactions": [], "refundSelections": selections})
            self.assertEqual(status, 400, selections)
            self.assertEqual(self.csv_path.read_bytes(), before)
        self.assertEqual(self.commit(token, result, [{"stagedId": 0, "purchaseId": 0}])[0], 400,
                         "Cannot flag purchase and also import the same refund")
        status, _ = self.request("POST", "/api/transactions/staged-preview", {
            "revision": result["revision"], "transactions": result["transactions"],
            "refundSelections": [{"stagedId": 0, "purchaseId": 0}]})
        self.assertEqual(status, 400, "A client cannot invent refund provenance without a session")

    def test_backup_or_atomic_write_failure_preserves_csv_and_can_retry(self):
        before = self.seed()
        token, result = self.stage()
        choices = [{"stagedId": 0, "purchaseId": 0}]
        review = self.propose(token, result, choices)
        for function in ("create_backup_copy", "write_transactions_atomic"):
            with patch.object(server, function, side_effect=OSError("Synthetic failure")):
                self.assertEqual(self.commit(token, review, choices)[0], 500)
            self.assertEqual(self.csv_path.read_bytes(), before)
            self.assertEqual(self.server.amazon_import_sessions[token]["status"], "review")
        self.assertEqual(self.commit(token, review, choices)[0], 200)

    def test_edited_refund_identity_and_reordered_duplicates_are_revalidated(self):
        self.seed([purchase(), purchase(date="2026-08-20", amount=-25)])
        token, result = self.stage([raw_credit(), raw_credit()])
        self.assertEqual((result["new"], result["duplicates"]), (1, 1))
        review = self.propose(token, result, [{"stagedId": 1, "purchaseId": 0}])
        self.assertTrue(next(row for row in review["transactions"] if row["_stagedId"] == 0)["_isDuplicate"])
        rows = [dict(row, amount=-26) if row["_stagedId"] == 1 else row for row in review["transactions"]]
        status, _ = self.request("POST", "/api/transactions/staged-preview", {
            "importToken": token, "revision": result["revision"], "transactions": rows,
            "refundSelections": [{"stagedId": 1, "purchaseId": 0}]})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
