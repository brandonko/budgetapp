"""Synthetic-only financial, graph, migration, and confirmation regressions."""
import csv
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path

from test_groups_bulk import make_server, row
import test_groups_bulk as bulk_tests
from server import (read_transaction_state, write_transactions_atomic, migrate_transaction_schema,
                    PRE_LINK_COLUMNS, COLUMNS, public_state, transaction_export_csv, parse_ledger_import_csv)
import reconciliation as links


def family():
    return [row(id="purchase", amount=100, date="2026-07-20"),
            row(id="credit", amount=-80, description="Store refund", date="2026-08-01"),
            row(id="repayment", amount=-15, category="Income", description="Venmo repayment", date="2026-08-03")]


class ReconciliationModelTests(unittest.TestCase):
    def test_partial_refund_preserves_sources_and_counts_only_residual_at_purchase(self):
        rows=family()
        updated=links.set_links(rows,"purchase",[{"transactionId":"credit","type":"refund"}])
        projected=public_state(updated,"revision")["transactions"]
        self.assertEqual([r["amount"] for r in projected],[100,-80,-15])
        self.assertEqual(projected[0]["_budgetAmount"],20)
        self.assertEqual(projected[1]["_budgetAmount"],0)
        self.assertEqual(projected[0]["date"],"2026-07-20")
        self.assertEqual(projected[0]["_linkedTransactions"][0]["id"],"credit")
        self.assertNotIn("links",rows[0])

    def test_multiple_repayments_and_overpayment_are_exactly_netted_once(self):
        rows=links.set_links(family(),"purchase",[
            {"transactionId":"credit","type":"repayment"}, {"transactionId":"repayment","type":"repayment"}])
        projected=links.decorate(rows)
        self.assertEqual([r["_budgetAmount"] for r in projected],[5,0,0])
        rows[2]["amount"]=-30
        self.assertEqual(links.decorate(rows)[0]["_budgetAmount"],-10)

    def test_graph_rejects_self_missing_cycles_chains_multiple_owners_and_wrong_sign(self):
        for entries in [
            [{"transactionId":"purchase","type":"refund"}],
            [{"transactionId":"missing","type":"refund"}],
            [{"transactionId":"credit","type":"refund"},{"transactionId":"repayment","type":"refund"}],
            [{"transactionId":"credit","type":"repayment"},{"transactionId":"credit","type":"repayment"}],
        ]:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                links.set_links(family(),"purchase",entries)
        rows=links.set_links(family(),"purchase",[{"transactionId":"credit","type":"refund"}])
        rows.append(row(id="other",amount=100,links=rows[0]["links"]))
        with self.assertRaisesRegex(ValueError,"only one"): links.validate(rows)
        rows=family(); rows[1]["links"]=links.encode_links([{"transactionId":"repayment","type":"repayment"}])
        with self.assertRaises(ValueError): links.set_links(rows,"purchase",[{"transactionId":"credit","type":"refund"}])
        with self.assertRaises(ValueError): links.set_links(family(),"credit",[{"transactionId":"purchase","type":"refund"}])

    def test_transfer_requires_balanced_pair_and_distinct_accounts(self):
        rows=family(); rows[1]["amount"]=-100; rows[1]["accountName"]="Checking"
        updated=links.set_links(rows,"purchase",[{"transactionId":"credit","type":"transfer"}])
        projected=links.decorate(updated)
        self.assertEqual([r["_budgetAmount"] for r in projected[:2]],[0,0])
        self.assertTrue(all(r["_isInternalTransfer"] for r in projected[:2]))
        for amount,account in [(-80,"Checking"),(-100,rows[0]["accountName"])]:
            rows[1].update(amount=amount,accountName=account)
            with self.assertRaises(ValueError): links.set_links(rows,"purchase",[{"transactionId":"credit","type":"transfer"}])

    def test_export_includes_linked_counterparts_outside_range_and_roundtrips(self):
        rows=links.set_links(family(),"purchase",[{"transactionId":"credit","type":"refund"}])
        content,count=transaction_export_csv(rows,"2026-07-01","2026-07-31")
        self.assertEqual(count,2)
        imported,total,invalid=parse_ledger_import_csv(content.decode("utf-8-sig"))
        self.assertEqual((total,len(invalid)),(2,0))
        self.assertEqual(links.decorate(imported)[0]["_budgetAmount"],20)

    def test_delete_unlinks_survivors_without_changing_source_amounts(self):
        rows=family();rows[1].update(amount=-100,accountName="Checking")
        updated=links.set_links(rows,"purchase",[{"transactionId":"credit","type":"transfer"}])
        updated[1]["flags"]="internal-transfer,transfer-pair-old,flagged"
        survivors=links.unlink_deleted(updated,updated[1:])
        self.assertEqual(survivors[0]["flags"],"flagged")
        self.assertEqual(survivors[0]["amount"],-100)
        links.validate(survivors)

    def test_ids_survive_reordering_edits_and_reimports_get_fresh_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"transactions.csv"
            original=family();write_transactions_atomic(path,original)
            saved,_=read_transaction_state(path);saved.reverse();saved[0]["notes"]="Edited"
            write_transactions_atomic(path,saved)
            self.assertEqual({r["id"] for r in read_transaction_state(path)[0]}, {"purchase","credit","repayment"})
        incoming=links.set_links(family(),"purchase",[{"transactionId":"credit","type":"refund"}])
        remapped=links.prepare_incoming(incoming,incoming,"new-import")
        self.assertFalse({r["id"] for r in incoming} & {r["id"] for r in remapped})
        links.validate(remapped)

    def test_legacy_migration_is_backed_up_preserves_amounts_and_assigns_unique_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"transactions.csv"
            with path.open("w",newline="") as handle:
                writer=csv.DictWriter(handle,fieldnames=PRE_LINK_COLUMNS,extrasaction="ignore")
                writer.writeheader();writer.writerows([row(),row()])
            before=path.read_bytes()
            self.assertTrue(migrate_transaction_schema(path))
            rows,_=read_transaction_state(path)
            self.assertEqual(len({r["id"] for r in rows}),2)
            self.assertEqual([r["amount"] for r in rows],[50,50])
            self.assertEqual(next((path.parent/"backups").glob("*.csv")).read_bytes(),before)
            self.assertFalse(migrate_transaction_schema(path))


class ReconciliationApiTests(unittest.TestCase):
    setUp=bulk_tests.BulkApiTests.setUp
    tearDown=bulk_tests.BulkApiTests.tearDown
    request=bulk_tests.BulkApiTests.request

    def test_manual_link_is_revision_checked_backed_up_and_keeps_ids_immutable(self):
        rows=family();write_transactions_atomic(self.path,rows)
        baseline=read_transaction_state(self.path)[1];before=self.path.read_bytes()
        edited={**rows[0],"id":"attempted-change","links":links.encode_links([{"transactionId":"credit","type":"refund"}])}
        status,payload=self.request("/api/transactions/0",{"revision":baseline,"transaction":edited},method="PUT")
        self.assertEqual(status,200,payload)
        self.assertEqual(payload["transactions"][0]["id"],"purchase")
        self.assertEqual(payload["transactions"][0]["_budgetAmount"],20)
        self.assertEqual(next((self.path.parent/"backups").glob("*.csv")).read_bytes(),before)
        status,_=self.request("/api/transactions/0",{"revision":baseline,"transaction":edited},method="PUT")
        self.assertEqual(status,409)

    def test_scan_suggests_refund_but_does_not_link_until_selection_and_confirmation(self):
        rows=family();rows[1]["amount"]=-100;write_transactions_atomic(self.path,rows)
        before=self.path.read_bytes()
        status,preview=self.request("/api/reconciliation/preview",{})
        self.assertEqual(status,200,preview)
        self.assertEqual(len(preview["refundSuggestions"]),1)
        self.assertEqual(preview["changes"],[])
        chosen=[{"transactionId":"credit","purchaseId":"purchase"}]
        status,review=self.request("/api/reconciliation/preview",{"revision":preview["revision"],"refundLinks":chosen})
        self.assertEqual(status,200,review)
        self.assertEqual(len(review["changes"]),1)
        self.assertEqual(len(review["transactions"]),2)
        self.assertEqual(self.path.read_bytes(),before)
        payload={"revision":review["revision"],"plan":review["plan"],"refundLinks":chosen}
        status,_=self.request("/api/reconciliation/confirm",payload)
        self.assertEqual(status,400)
        status,saved=self.request("/api/reconciliation/confirm",{**payload,"confirm":True})
        self.assertEqual(status,200,saved)
        self.assertEqual(saved["refundsLinked"],1)
        self.assertEqual(saved["transactions"][0]["_budgetAmount"],0)

    def test_invalid_graph_write_leaves_csv_and_backups_untouched(self):
        rows=family();write_transactions_atomic(self.path,rows)
        revision=read_transaction_state(self.path)[1];before=self.path.read_bytes()
        for entries in [[{"transactionId":"missing","type":"refund"}], [{"transactionId":"purchase","type":"repayment"}],
                        [{"transactionId":"credit","type":[]}]]:
            status,_=self.request("/api/transactions/0",{"revision":revision,"transaction":{**rows[0],"links":links.encode_links(entries)}},method="PUT")
            self.assertEqual(status,400)
            self.assertEqual(self.path.read_bytes(),before)
        self.assertFalse((self.path.parent/"backups").exists())

    def test_editing_credit_updates_net_without_losing_links_and_rejects_wrong_sign(self):
        rows=links.set_links(family(),"purchase",[{"transactionId":"credit","type":"refund"}])
        write_transactions_atomic(self.path,rows)
        revision=read_transaction_state(self.path)[1]
        status,result=self.request("/api/transactions/1",{"revision":revision,"transaction":{**rows[1],"amount":-70,"notes":"Restocking fee"}},method="PUT")
        self.assertEqual(status,200,result)
        self.assertEqual(result["transactions"][0]["_budgetAmount"],30)
        before=self.path.read_bytes()
        status,result=self.request("/api/transactions/1",{"revision":result["revision"],"transaction":{**rows[1],"amount":70}},method="PUT")
        self.assertEqual(status,400,result)
        self.assertEqual(self.path.read_bytes(),before)

    def test_bulk_treatment_cannot_override_links_and_delete_unlinks_safely(self):
        rows=links.set_links(family(),"purchase",[{"transactionId":"credit","type":"refund"}])
        write_transactions_atomic(self.path,rows)
        revision=read_transaction_state(self.path)[1];before=self.path.read_bytes()
        status,result=self.request("/api/transactions/bulk",{"revision":revision,"confirm":True,"ids":[0],"changes":{"refunded":True}})
        self.assertEqual(status,400,result)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertFalse((self.path.parent/"backups").exists())
        status,result=self.request("/api/transactions/bulk-delete",{"revision":revision,"confirm":True,"ids":[1]})
        self.assertEqual(status,200,result)
        self.assertEqual(result["transactions"][0]["links"],"")
        self.assertEqual(result["transactions"][0]["amount"],100)
        self.assertNotIn("_budgetAmount",result["transactions"][0])
        self.assertEqual(next((self.path.parent/"backups").glob("*.csv")).read_bytes(),before)

    def test_unlinking_saved_transfer_restores_both_sides_and_preserves_follow_up_flag(self):
        rows=family();rows[1].update(amount=-100,accountName="Checking")
        rows=links.set_links(rows,"purchase",[{"transactionId":"credit","type":"transfer"}])
        for entry in rows[:2]:entry["flags"]="internal-transfer,transfer-pair-test,flagged"
        write_transactions_atomic(self.path,rows);revision=read_transaction_state(self.path)[1]
        status,result=self.request("/api/transactions/0",{"revision":revision,"transaction":{**rows[0],"links":""}},method="PUT")
        self.assertEqual(status,200,result)
        self.assertTrue(all(not entry["_isInternalTransfer"] for entry in result["transactions"]))
        self.assertEqual([entry["flags"] for entry in result["transactions"][:2]],["flagged","flagged"])

    def test_saved_pair_migration_uses_only_valid_explicit_pairs_not_guesses(self):
        rows=family();rows[1].update(amount=-100,accountName="Checking")
        for entry in rows[:2]:entry["flags"]="internal-transfer,transfer-pair-test"
        migrated=links.migrate_legacy_pairs(rows)
        self.assertEqual(links.links(migrated[0]),[{"transactionId":"credit","type":"transfer"}])
        self.assertEqual([entry["amount"] for entry in migrated],[100,-100,-15])
        rows[1]["amount"]=-99
        self.assertFalse(any(links.links(entry) for entry in links.migrate_legacy_pairs(rows)))

    def test_csv_force_import_remaps_linked_copies_and_incomplete_selection_cannot_write(self):
        originals=family();write_transactions_atomic(self.path,originals)
        exported=links.set_links(originals,"purchase",[{"transactionId":"credit","type":"refund"}])
        content,_=transaction_export_csv(exported,"2026-07-01","2026-07-31")
        before=self.path.read_bytes()
        status,session=self.request("/api/csv-import-sessions",{"content":content.decode("utf-8-sig"),"applyClassifications":False})
        self.assertEqual(status,201,session)
        preview=session["import"]
        self.assertEqual(preview["duplicates"],2)
        pending=[{**entry,"_selected":entry["amount"]>0} for entry in preview["transactions"]]
        status,result=self.request("/api/transactions/staged-preview",{"revision":preview["revision"],"transactions":pending})
        self.assertEqual(status,400,result)
        self.assertEqual(self.path.read_bytes(),before)
        for entry in pending:entry["_selected"]=True
        status,review=self.request("/api/transactions/staged-preview",{"revision":preview["revision"],"transactions":pending})
        self.assertEqual(status,200,review)
        status,result=self.request(f"/api/csv-import-sessions/{session['token']}/commit",{"transactions":review["transactions"],"transferPlan":review["transferPlan"]})
        self.assertEqual(status,200,result)
        saved,_=read_transaction_state(self.path)
        self.assertEqual(len(saved),5)
        self.assertEqual(len({entry["id"] for entry in saved}),5)
        linked_purchase=next(entry for entry in saved if links.links(entry))
        self.assertNotEqual(linked_purchase["id"],"purchase")
        self.assertNotEqual(links.links(linked_purchase)[0]["transactionId"],"credit")
        self.assertEqual(next(entry for entry in links.decorate(saved) if entry["id"]==linked_purchase["id"])["_budgetAmount"],20)
