"""Schwab checking fixtures are synthetic; no live account or database is used."""
import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import test_capitalone_import as harness
from importers import ImportDataError, parse_schwab_checking


def checking_csv(*rows, legacy=False):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    if legacy:
        writer.writerow(["Transactions for checking account PRIVATE-TITLE as of 09/09/2026"])
    writer.writerow(["Date", "Type", "Check #", "Description", "Withdrawal (-)" if legacy else "Withdrawal",
                     "Deposit (+)" if legacy else "Deposit", "RunningBalance"])
    writer.writerows(rows or [["09/01/2026", "VISA", "PRIVATE-CHECK", "Synthetic shop", "$12.34", "", "$999.99"]])
    return out.getvalue()


class SchwabParserTests(unittest.TestCase):
    def test_both_layouts_signs_repetitions_categories_and_privacy(self):
        for legacy in (False, True):
            data = checking_csv(
                ["09/01/2026", "VISA", "PRIVATE-CHECK", "Shop,\n two", "$12.34", "", "$999.99"],
                ["09/01/2026", "VISA", "", "Shop,\n two", "$12.34", "", "$999.99"],
                ["09/02/2026", "TRANSFER", "", "Transfer", "", "$1,200.00", "$999.99"],
                ["09/03/2026", "INTADJUST", "", "Interest", "", "$0.12", "$999.99"],
                ["09/03/2026", "ATMREBATE", "", "ATM rebate", "", "$3.00", "$999.99"], legacy=legacy)
            rows, warnings = parse_schwab_checking("\ufeff" + data, ("Travel checking", "BANK", "Charles Schwab"))
            self.assertEqual([row["amount"] for row in rows], [12.34, 12.34, -1200, -.12, -3])
            self.assertEqual([row["category"] for row in rows], ["Uncategorized", "Uncategorized", "Transfer", "Income", "Uncategorized"])
            self.assertEqual(rows[0]["description"], "Shop, two")
            self.assertEqual(rows[0]["accountName"], "Travel checking")
            self.assertNotIn("PRIVATE", json.dumps(rows))
            self.assertNotIn("999.99", json.dumps(rows))
            self.assertNotIn("createdAt", rows[0])
            self.assertEqual(warnings, [])

    def test_pending_is_reported_unknown_status_is_rejected(self):
        data = "Date,Status,Type,Description,Withdrawal,Deposit\n09/01/2026,Posted,VISA,Shop,5,\n,Pending,VISA,Pending shop,9,\n"
        rows, warnings = parse_schwab_checking(data)
        self.assertEqual(len(rows), 1)
        self.assertIn("Skipped 1 pending", warnings[0])
        for status in ("", "Settled", "Failed"):
            with self.assertRaisesRegex(ImportDataError, "status"):
                parse_schwab_checking(data.replace("Posted", status))

    def test_amountless_interest_is_reported_without_inventing_zero_or_losing_valid_rows(self):
        for legacy in (False, True):
            data = checking_csv(
                ["09/01/2026", "INTADJUST", "", "Synthetic interest adjustment", "", "", "$999.99"],
                ["09/01/2026", "INTADJUST", "", "Synthetic interest adjustment", " ", " ", "$999.99"],
                ["09/02/2026", "VISA", "", "Synthetic shop", "8.25", "", "$999.99"],
                ["09/02/2026", "VISA", "", "Synthetic shop", "8.25", "", "$999.99"],
                ["09/03/2026", "INTADJUST", "", "Synthetic paid interest", "", "0.17", "$999.99"],
                ["09/03/2026", "INTADJUST", "", "Synthetic explicit zero", "", "0.00", "$999.99"],
                legacy=legacy,
            )
            rows, warnings = parse_schwab_checking(data)
            self.assertEqual([row["amount"] for row in rows], [8.25, 8.25, -.17, 0])
            self.assertEqual(rows[2]["category"], "Income")
            self.assertEqual(len(warnings), 1)
            self.assertIn("Skipped 2 Schwab interest-adjustment rows", warnings[0])
            self.assertIn("No amount was inferred", warnings[0])
            self.assertNotIn("999.99", json.dumps((rows, warnings)))
        rows, warnings = parse_schwab_checking(checking_csv(
            ["09/01/2026", "INTADJUST", "", "Synthetic interest", "", "", ""]
        ))
        self.assertEqual(rows, [])
        self.assertIn("Skipped 1 Schwab", warnings[0])
        # Only amount-less interest is skipped. Corrupt/conflicting data still
        # stops the import, including malformed dates on those entries.
        for date, withdrawal, deposit in [
            ("09/01/2026", "1", "2"), ("09/01/2026", "NaN", ""),
            ("09/01/2026", "-1", ""), ("02/30/2026", "", ""),
        ]:
            with self.assertRaises(ImportDataError):
                parse_schwab_checking(checking_csv(
                    [date, "INTADJUST", "", "Synthetic interest", withdrawal, deposit, ""]
                ))

    def test_malformed_money_rows_and_brokerage_fail_whole_import(self):
        for debit, credit in [("", ""), ("1", "2"), ("-1", ""), ("($1.00)", ""),
                              ("NaN", ""), ("1e3", ""), ("1.001", ""), ("1,23", ""), ("1000000001", "")]:
            with self.subTest(debit=debit), self.assertRaises(ImportDataError):
                parse_schwab_checking(checking_csv(["09/01/2026", "VISA", "", "Shop", debit, credit, ""]))
        for content in [checking_csv() + '"unclosed', checking_csv() + "wrong,columns\n",
                        checking_csv().replace("09/01/2026", "02/30/2026"), checking_csv().replace("Synthetic shop", ""),
                        checking_csv().replace("RunningBalance", "Date"),
                        "Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount\n",
                        "Date,Type,Description,Withdrawal,Deposit,Currency\n09/01/2026,VISA,Shop,1,,CAD\n"]:
            with self.subTest(content=content), self.assertRaises(ImportDataError):
                parse_schwab_checking(content)

    def test_empty_and_known_notices_only(self):
        header = checking_csv().splitlines()[0]
        self.assertEqual(parse_schwab_checking(header), ([], []))
        self.assertEqual(parse_schwab_checking(header + "\nPosted Transactions\n"), ([], []))
        with self.assertRaises(ImportDataError):
            parse_schwab_checking(header + "\nPosted Transactions,,,,1,,\n")
        with self.assertRaises(ImportDataError):
            parse_schwab_checking("")
        with self.assertRaises(ImportDataError):
            parse_schwab_checking("x" * (16 * 1024 * 1024 + 1))


class SchwabSessionTests(unittest.TestCase):
    setUp = harness.CapitalOneSessionTests.setUp
    tearDown = harness.CapitalOneSessionTests.tearDown
    request = harness.CapitalOneSessionTests.request

    def stage(self, content=None, name="Travel checking"):
        code, session = self.request("POST", "/api/schwab-import-sessions", {
            "startDate": "2026-09-01", "endDate": "2026-09-03",
            "accountName": name, "accountType": "BANK", "provider": "Charles Schwab",
        })
        self.assertEqual(code, 201)
        base = f'/api/schwab-import-sessions/{session["token"]}'
        code, result = self.request("POST", base + "/complete", {"content": content or checking_csv()})
        self.assertEqual(code, 200, result)
        return base, result

    def test_range_account_identity_cancel_and_wrong_source(self):
        data = checking_csv(*[[f"09/0{day}/2026", "VISA", "", "Shop", "5", "", ""] for day in (1, 2, 3, 4)])
        base, result = self.stage(data)
        self.assertEqual(result["import"]["parsed"], 3)
        self.assertTrue(all(r["accountName"] == "Travel checking" for r in result["import"]["transactions"]))
        self.assertFalse(self.path.exists())
        self.assertEqual(self.request("GET", base.replace("schwab", "capitalone"))[0], 404)
        self.request("POST", base + "/cancel", {})
        self.assertEqual(self.request("POST", base + "/complete", {"content": data})[1]["status"], "cancelled")
        self.request("POST", base + "/commit", {"transactions": result["import"]["transactions"]})
        self.assertFalse(self.path.exists())

    def test_confirm_duplicates_stale_revision_and_backup(self):
        row = ["09/01/2026", "VISA", "", "Same", "5", "", ""]
        base, result = self.stage(checking_csv(row, row))
        stale_base, stale = self.stage()
        self.assertEqual(result["import"]["new"], 2)
        self.assertEqual(self.request("POST", base + "/commit", {"transactions": result["import"]["transactions"]})[0], 200)
        before = self.path.read_bytes()
        records = list(csv.DictReader(io.StringIO(before.decode("utf-8-sig"))))
        self.assertEqual(len(records), 2)
        self.assertTrue(records[0]["createdAt"])
        self.assertEqual(records[0]["createdAt"], records[1]["createdAt"])
        self.assertEqual(self.request("POST", stale_base + "/commit", {"transactions": stale["import"]["transactions"]})[0], 409)
        _, repeat = self.stage(checking_csv(row, row), "Second checking")
        self.assertEqual(repeat["import"]["duplicates"], 2)  # Existing cross-account rule stays explicit.
        base, added = self.stage()
        self.assertEqual(self.request("POST", base + "/commit", {"transactions": added["import"]["transactions"]})[0], 200)
        self.assertTrue(any(p.read_bytes() == before for p in (self.path.parent / "backups").glob("*.csv")))

    def test_warnings_are_visible_and_bad_payload_never_writes(self):
        base, result = self.stage("Date,Status,Type,Description,Withdrawal,Deposit\n09/01/2026,Pending,VISA,Shop,5,\n")
        self.assertIn("pending", result["import"]["warnings"][0])
        self.assertNotIn("skippedOrders", result["import"])
        self.assertFalse(self.path.exists())
        base, _ = self.stage()
        # A malformed fresh session cannot produce a preview or initialize the CSV.
        _, fresh = self.request("POST", "/api/schwab-import-sessions", {"startDate": "2026-09-01", "endDate": "2026-09-03"})
        fresh_base = '/api/schwab-import-sessions/' + fresh['token']
        self.assertEqual(self.request("POST", fresh_base + "/complete", {"content": "Date,Amount\n"})[0], 400)
        self.assertFalse(self.path.exists())

    def test_current_export_blank_interest_reaches_review_with_warning_and_no_early_write(self):
        data = (
            '"Date","Status","Type","CheckNumber","Description","Withdrawal","Deposit","RunningBalance"\r\n'
            '"09/01/2026","Posted","INTADJUST","","Synthetic blank interest","","","$999.99"\r\n'
            '"09/01/2026","Posted","INTADJUST","","Synthetic paid interest","","$0.17","$999.99"\r\n'
            '"09/02/2026","Posted","VISA","","Synthetic shop","$8.25","","$999.99"\r\n'
            '"","Pending","VISA","","Synthetic pending shop","$6.50","",""\r\n'
        )
        base, result = self.stage(data)
        review = result["import"]
        self.assertEqual(review["parsed"], 2)
        self.assertEqual(len(review["warnings"]), 2)
        self.assertIn("Skipped 1 Schwab interest-adjustment row", " ".join(review["warnings"]))
        self.assertFalse(self.path.exists())
        self.assertNotIn("999.99", json.dumps(review))
        self.assertEqual(self.request("POST", base + "/commit", {"transactions": review["transactions"]})[0], 200)
        with self.path.open(newline="", encoding="utf-8-sig") as saved:
            amounts = sorted(float(row["amount"]) for row in csv.DictReader(saved))
        self.assertEqual(amounts, [-.17, 8.25])


class SchwabExtensionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is needed for extension runtime tests")
    def test_extension_runtime(self):
        result = subprocess.run([shutil.which("node"), str(Path(__file__).with_name("test_schwab_extension.js"))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
