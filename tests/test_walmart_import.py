"""Synthetic Walmart receipts and source-scoped, staged import regressions."""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import threading
import unittest
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
from importers import ImportDataError, parse_credit_karma, parse_walmart
from server import BudgetRequestHandler, ThreadingHTTPServer


def receipt(**changes):
    return {"orderId": "1234500001", "orderDate": "2026-08-20", "currency": "USD", "total": "22.01",
            "items": [{"title": "Synthetic apples", "quantity": 2, "lineTotal": "10.00"},
                      {"title": "Synthetic soap", "quantity": 1, "lineTotal": "10.00"}], **changes}


def exported(*orders):
    return json.dumps({"version": 1, "orders": list(orders)})


class WalmartParserTests(unittest.TestCase):
    def test_receipt_allocation_does_not_multiply_quantity_again(self):
        rows, warnings = parse_walmart(exported(receipt()), ("My card", "CREDIT CARD", "Bank"))
        self.assertEqual([row["amount"] for row in rows], [11.01, 11.0])
        self.assertEqual(rows[0]["description"], "Synthetic apples (x2)")
        self.assertEqual(rows[0]["accountName"], "My card")
        self.assertEqual(warnings, [])

    def test_tiny_totals_and_zero_lines_never_create_negative_expenses(self):
        items = [{"title": "Same item", "quantity": 1, "lineTotal": "1.00"}] * 20
        items += [{"title": "Free item", "quantity": "0.5", "lineTotal": "0.00"}]
        rows, _ = parse_walmart(exported(receipt(total="0.10", items=items)))
        self.assertEqual(len(rows), 21)
        self.assertEqual(sum(Decimal(str(row["amount"])) for row in rows), Decimal("0.10"))
        self.assertTrue(all(row["amount"] >= 0 for row in rows))
        self.assertEqual(rows[-1]["amount"], 0)

    def test_rejects_bad_money_currency_dates_and_missing_items(self):
        for changes in ({"total": "NaN"}, {"total": True}, {"total": "-1"}, {"total": "0.001"},
                        {"currency": "CAD"}, {"orderDate": "2026-02-30"}, {"items": []}):
            with self.subTest(changes=changes), self.assertRaises(ImportDataError):
                parse_walmart(exported(receipt(**changes)))
        for quantity in (0, -1, True, "NaN"):
            with self.subTest(quantity=quantity), self.assertRaises(ImportDataError):
                parse_walmart(exported(receipt(items=[{"title": "Item", "quantity": quantity, "lineTotal": "1"}])))

    def test_skip_reasons_are_explicit_and_dates_are_inclusive(self):
        orders = [receipt(orderId=str(1234500000 + i), skipReason=reason)
                  for i, reason in enumerate(("pending", "refund", "cancelled"))]
        rows, warnings = parse_walmart(exported(*orders, receipt(orderId="9999900000")),
                                      start_date="2026-08-20", end_date="2026-08-20")
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(warnings), 3)
        self.assertIn("refund", warnings[1])
        self.assertEqual(parse_walmart(exported(*orders), start_date="2026-08-21"), ([], []))

    def test_duplicate_order_is_error_not_duplicate_item_loss(self):
        with self.assertRaises(ImportDataError):
            parse_walmart(exported(receipt(), receipt()))
        items = [{"title": "Two separate identical lines", "quantity": 1, "lineTotal": "5.00"}] * 2
        rows, _ = parse_walmart(exported(receipt(total="10.00", items=items)))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], rows[1])

    def test_credit_karma_walmart_exclusion_defaults_on_and_can_be_disabled(self):
        descriptions = ["WALMART.COM", "Wal-Mart Store", "wal   mart purchase", "WM SUPERCENTER #123", "Other store"]
        rows = [{"description": name, "date": "2026-08-20", "amount": 10,
                 "transactionType": "credit" if i == 0 else "debit", "category": "Shopping",
                 "accountName": "Card", "accountType": "CREDIT", "provider": "Bank"}
                for i, name in enumerate(descriptions)]
        content = json.dumps({"transactions": rows})
        unfiltered = parse_credit_karma(content, ignore_walmart=False)
        self.assertEqual(len(unfiltered.transactions), 5)
        self.assertEqual(unfiltered.ignored_walmart_count, 0)
        self.assertEqual(unfiltered.transactions[0]["amount"], -10)
        self.assertEqual(unfiltered.transactions[1]["amount"], 10)
        filtered = parse_credit_karma(content)
        self.assertEqual(filtered, parse_credit_karma(content, ignore_walmart=True))
        self.assertEqual(filtered.ignored_walmart_count, 4)
        self.assertEqual([row["description"] for row in filtered.transactions], ["Other store"])


class WalmartSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "transactions.csv"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
        self.server.csv_path = self.path
        self.server.data_lock = threading.Lock()
        self.server.amazon_import_sessions = {}
        self.server.amazon_import_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, method, path, payload=None):
        request = Request(f"http://127.0.0.1:{self.server.server_port}{path}", method=method,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def stage(self, *orders):
        status, session = self.request("POST", "/api/walmart-import-sessions", {
            "startDate": "2026-08-01", "endDate": "2026-08-31",
            "accountName": "Card", "accountType": "CREDIT CARD", "provider": "Test bank",
        })
        self.assertEqual(status, 201)
        base = f'/api/walmart-import-sessions/{session["token"]}'
        status, preview = self.request("POST", base + "/complete", {"content": exported(*orders)})
        self.assertEqual(status, 200, preview)
        return base, preview

    def test_preview_cancel_and_late_complete_do_not_create_database(self):
        base, preview = self.stage(receipt())
        self.assertEqual(preview["status"], "review")
        self.assertFalse(self.path.exists())
        self.assertEqual(self.request("POST", base + "/cancel", {})[0], 200)
        # Terminal sessions acknowledge retries idempotently without reopening review.
        _, late = self.request("POST", base + "/complete", {"content": exported(receipt())})
        self.assertEqual(late["status"], "cancelled")
        _, commit = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(commit["status"], "cancelled")
        self.assertFalse(self.path.exists())

    def test_confirmation_persists_identity_timestamp_and_occurrence_counts(self):
        order = receipt(total="10.00", items=[{"title": "Identical", "quantity": 1, "lineTotal": "5.00"}] * 2)
        base, preview = self.stage(order)
        self.assertEqual(preview["import"]["new"], 2)
        status, result = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(status, 200, result)
        with self.path.open(newline="", encoding="utf-8") as file:
            rows = list(csv.DictReader(file))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["provider"], "Test bank")
        self.assertTrue(rows[0]["createdAt"])
        self.assertEqual(rows[0]["createdAt"], rows[1]["createdAt"])
        _, again = self.stage(order)
        self.assertEqual(again["import"]["duplicates"], 2)
        self.assertEqual(again["import"]["new"], 0)

    def test_cancellation_during_parsing_cannot_reopen_review(self):
        _, session = self.request("POST", "/api/walmart-import-sessions", {
            "startDate": "2026-08-01", "endDate": "2026-08-31",
        })
        base = f'/api/walmart-import-sessions/{session["token"]}'
        entered, release = threading.Event(), threading.Event()
        completed = []

        def slow_parser(*args, **kwargs):
            entered.set()
            if not release.wait(2):
                raise AssertionError("Test did not release the parser")
            return parse_walmart(*args, **kwargs)

        with patch("server.parse_walmart", side_effect=slow_parser):
            worker = threading.Thread(target=lambda: completed.append(
                self.request("POST", base + "/complete", {"content": exported(receipt())})))
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.request("POST", base + "/cancel", {})[1]["status"], "cancelled")
            finally:
                release.set()
                worker.join(3)
        self.assertEqual(completed[0][1]["status"], "cancelled")
        self.assertEqual(self.request("GET", base)[1]["status"], "cancelled")
        self.assertFalse(self.path.exists())

    def test_stale_review_and_cross_source_tokens_are_rejected(self):
        base, preview = self.stage(receipt())
        other, other_preview = self.stage(receipt(orderId="1234599999"))
        self.request("POST", other + "/commit", {"transactions": other_preview["import"]["transactions"]})
        before = self.path.read_bytes()
        status, _ = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(status, 409)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotEqual(self.request("GET", base.replace("walmart", "ebay"))[0], 200)

    def test_warnings_and_credit_karma_option_survive_server_boundary(self):
        _, preview = self.stage(receipt(skipReason="refund"))
        self.assertEqual(preview["import"]["parsed"], 0)
        self.assertEqual(preview["import"]["skippedOrders"], 1)
        self.assertFalse(self.path.exists())
        options = {"startDate": "2026-08-01", "endDate": "2026-08-31", "ignoreWalmart": "yes"}
        self.assertEqual(self.request("POST", "/api/creditkarma-import-sessions", options)[0], 400)
        options["ignoreWalmart"] = True
        status, session = self.request("POST", "/api/creditkarma-import-sessions", options)
        self.assertEqual(status, 201)
        self.assertTrue(session["ignoreWalmart"])
        tx = {"date": "2026-08-20", "description": "WALMART.COM", "amount": 15,
              "transactionType": "debit", "category": "Shopping", "accountName": "Card", "accountType": "CREDIT", "provider": "Bank"}
        status, result = self.request("POST", f'/api/creditkarma-import-sessions/{session["token"]}/complete',
                                      {"content": json.dumps({"transactions": [tx]})})
        self.assertEqual(status, 200)
        self.assertEqual(result["import"]["sources"]["creditkarma"]["walmartTransactionsIgnored"], 1)

    def test_credit_karma_session_defaults_to_excluding_walmart_but_honors_opt_out(self):
        tx = {"date": "2026-08-20", "description": "WALMART.COM", "amount": 15,
              "transactionType": "debit", "category": "Shopping", "accountName": "Card",
              "accountType": "CREDIT", "provider": "Bank"}
        for choice, expected in (({}, True), ({"ignoreWalmart": True}, True), ({"ignoreWalmart": False}, False)):
            with self.subTest(choice=choice):
                status, session = self.request("POST", "/api/creditkarma-import-sessions", {
                    "startDate": "2026-08-01", "endDate": "2026-08-31", **choice,
                })
                self.assertEqual(status, 201)
                self.assertEqual(session["ignoreWalmart"], expected)
                base = f'/api/creditkarma-import-sessions/{session["token"]}'
                self.assertEqual(self.request("GET", base)[1]["ignoreWalmart"], expected)
                status, result = self.request("POST", base + "/complete", {
                    "content": json.dumps({"transactions": [tx]}),
                })
                self.assertEqual(status, 200)
                self.assertEqual(result["import"]["sources"]["creditkarma"]["walmartTransactionsIgnored"], int(expected))
                self.assertEqual(result["import"]["parsed"], 0 if expected else 1)
                if not expected:
                    self.assertEqual(result["import"]["transactions"][0]["amount"], 15)
                self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
