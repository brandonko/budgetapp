"""Capital One CSV signs and source-scoped review; synthetic data only."""
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from importers import ImportDataError, parse_capital_one
from server import BudgetRequestHandler


def card_csv(*rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Transaction Date", "Posted Date", "Card No.", "Description", "Category", "Debit", "Credit"])
    writer.writerows(rows or [["2026-08-20", "2026-08-22", "1234", "Test shop", "Shopping", "12.34", ""]])
    return output.getvalue()


class CapitalOneParserTests(unittest.TestCase):
    def test_card_signs_dates_categories_and_privacy(self):
        rows = parse_capital_one("\ufeff" + card_csv(
            ["2026-08-20", "2026-08-22", "1234", "SHOP,\n  one", "Shopping", "12.34", ""],
            ["08/21/2026", "2026-08-23", "1234", "Refund", "Shopping", "0", "3.21"],
            ["2026-08-21", "2026-08-23", "1234", "Zero", "", "0", ""],
        ), ("Venture", "CREDIT CARD", "Capital One"))
        self.assertEqual([row["amount"] for row in rows], [12.34, -3.21, 0])
        self.assertEqual(rows[0]["date"], "2026-08-20")
        self.assertEqual(rows[0]["description"], "SHOP, one")
        self.assertEqual(rows[2]["category"], "Uncategorized")
        self.assertEqual(rows[0]["accountName"], "Venture")
        self.assertEqual(rows[0]["subcategory"], "")
        self.assertNotIn("1234", json.dumps(rows))
        self.assertNotIn("createdAt", rows[0])

    def test_bank_explicit_types(self):
        content = "Account Number,Transaction Date,Transaction Amount,Transaction Type,Transaction Description,Balance\n"
        content += "999999,08/20/2026,-20.00,Debit,Purchase,1000\n999999,08/21/2026,300.00,Credit,Salary,1300\n"
        rows = parse_capital_one(content)
        self.assertEqual([row["amount"] for row in rows], [20, -300])
        self.assertEqual(rows[0]["accountType"], "BANK")
        self.assertNotIn("999999", json.dumps(rows))
        with self.assertRaisesRegex(ImportDataError, "Transaction Type"):
            parse_capital_one(content.replace(",Debit,", ",Unknown,"))

    def test_ambiguous_amounts_and_malformed_rows_fail_whole_export(self):
        for debit, credit in [("", ""), ("-1", ""), ("1", "2"), ("NaN", ""), ("1.001", ""), ("1e3", ""), ("1,23", "")]:
            with self.subTest(debit=debit, credit=credit), self.assertRaises(ImportDataError):
                parse_capital_one(card_csv(["2026-08-20", "", "", "Test", "", debit, credit]))
        for content in [card_csv() + '"unclosed', card_csv() + "wrong,columns\n", card_csv().replace("2026-08-20", "2026-02-30"),
                        card_csv().replace("Test shop", ""), "date,description,amount\n2026-08-20,Test,1\n",
                        card_csv().replace("Posted Date", "Transaction Date")]:
            with self.subTest(content=content), self.assertRaises(ImportDataError):
                parse_capital_one(content)

    def test_empty_export_and_identical_occurrences(self):
        header = card_csv().splitlines()[0]
        self.assertEqual(parse_capital_one(header), [])
        row = ["2026-08-20", "", "", "Same", "", "5", ""]
        self.assertEqual(len(parse_capital_one(card_csv(row, row))), 2)
        with self.assertRaisesRegex(ImportDataError, "USD"):
            parse_capital_one("Transaction Date,Description,Debit,Credit,Currency\n2026-08-20,Test,1,,CAD\n")


class CapitalOneSessionTests(unittest.TestCase):
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
        req = Request(f"http://127.0.0.1:{self.server.server_port}{path}", method=method,
                      data=None if payload is None else json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def stage(self, content=None):
        code, session = self.request("POST", "/api/capitalone-import-sessions", {
            "startDate": "2026-08-20", "endDate": "2026-08-21",
            "accountName": "Venture", "accountType": "CREDIT CARD", "provider": "Capital One",
        })
        self.assertEqual(code, 201)
        base = f'/api/capitalone-import-sessions/{session["token"]}'
        code, result = self.request("POST", base + "/complete", {"content": content or card_csv()})
        self.assertEqual(code, 200, result)
        return base, result

    def test_inclusive_range_and_cancel_never_write(self):
        content = card_csv(*[[f"2026-08-{day}", "2026-08-25", "", "Test", "Shopping", "1", ""] for day in (19, 20, 21, 22)])
        base, preview = self.stage(content)
        self.assertEqual(preview["import"]["parsed"], 2)
        self.assertEqual(preview["status"], "review")
        self.assertFalse(self.path.exists())
        self.assertEqual(self.request("GET", base.replace("capitalone", "walmart"))[0], 404)
        self.request("POST", base + "/cancel", {})
        _, late = self.request("POST", base + "/complete", {"content": content})
        self.assertEqual(late["status"], "cancelled")
        _, commit = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(commit["status"], "cancelled")
        self.assertFalse(self.path.exists())

    def test_commit_identity_duplicates_and_stale_revision(self):
        row = ["2026-08-20", "", "", "Same", "Shopping", "5", ""]
        base, preview = self.stage(card_csv(row, row))
        stale_base, stale = self.stage(card_csv())
        code, result = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(code, 200, result)
        with self.path.open(newline="", encoding="utf-8") as file:
            rows = list(csv.DictReader(file))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["accountName"], "Venture")
        self.assertTrue(rows[0]["createdAt"])
        self.assertEqual(rows[0]["createdAt"], rows[1]["createdAt"])
        self.assertEqual(self.request("POST", stale_base + "/commit", {"transactions": stale["import"]["transactions"]})[0], 409)
        _, again = self.stage(card_csv(row, row))
        self.assertEqual(again["import"]["duplicates"], 2)
        self.assertEqual(again["import"]["new"], 0)

    def test_invalid_request_and_progress_route(self):
        self.assertEqual(self.request("POST", "/api/capitalone-import-sessions", {"startDate": "invalid", "endDate": "2026-08-21"})[0], 400)
        _, session = self.request("POST", "/api/capitalone-import-sessions", {"startDate": "2026-08-20", "endDate": "2026-08-21"})
        base = f'/api/capitalone-import-sessions/{session["token"]}'
        self.assertEqual(self.request("POST", base + "/progress", {"status": "waiting_for_capitalone", "progress": 10, "message": "Waiting for CSV"})[0], 200)
        self.assertEqual(self.request("POST", base + "/complete", {"content": "date,amount\nnot,csv"})[0], 400)
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
