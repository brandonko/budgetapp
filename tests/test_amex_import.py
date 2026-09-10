"""Synthetic American Express CSV/XLSX parsing and staged-import regressions."""
import base64
import csv
import io
import json
from pathlib import Path
import sys
import struct
import unittest
from unittest.mock import patch
import zipfile
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import amex
from amex import parse_amex
from importers import ImportDataError
import test_capitalone_import as harness


HEADERS = ["Date", "Description", "Amount", "Extended Details", "Appears On Your Statement As",
           "Address", "City/State", "Zip Code", "Country", "Reference", "Category"]
PURCHASE = ["08/20/2026", "TEST  SHOP", "12.34", "Shop,\n receipt details", "TEST SHOP LLC",
            "123 Example Street", "Example City / WA", "01234", "UNITED STATES", "PRIVATE-REFERENCE", "Shopping"]


def activity_csv(*rows, headers=HEADERS):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def activity_xlsx(*rows, headers=HEADERS, shared=False, date1904=False, overrides=None):
    """Minimal in-memory workbook; no Excel dependency and no personal fixtures."""
    ns = amex.MAIN_NS
    worksheet = ET.Element(f"{ns}worksheet")
    data = ET.SubElement(worksheet, f"{ns}sheetData")
    strings = []
    # Cover text and a separate summary must never become transactions/notes.
    source = [["PRIVATE-CARDHOLDER"], ["PRIVATE-ACCOUNT-NUMBER"], [], [], [], [], headers, *rows]
    for index, values in enumerate(source, 1):
        row = ET.SubElement(data, f"{ns}row", r=str(index))
        for column, value in enumerate(values):
            if value is None:
                continue  # Amex XLSX omits some blank trailing cells.
            cell = ET.SubElement(row, f"{ns}c", r=f"{chr(65 + column)}{index}")
            if isinstance(value, (int, float)):
                ET.SubElement(cell, f"{ns}v").text = str(value)
            elif shared:
                cell.set("t", "s")
                ET.SubElement(cell, f"{ns}v").text = str(len(strings))
                strings.append(str(value))
            else:
                cell.set("t", "inlineStr")
                ET.SubElement(ET.SubElement(cell, f"{ns}is"), f"{ns}t").text = str(value)
    string_tree = ET.Element(f"{ns}sst")
    for value in strings:
        ET.SubElement(ET.SubElement(string_tree, f"{ns}si"), f"{ns}t").text = value
    parts = {
        "xl/workbook.xml": f'''<workbook xmlns="{ns[1:-1]}" xmlns:r="{amex.REL_NS[1:-1]}">
          <workbookPr date1904="{int(date1904)}"/><sheets>
          <sheet name="Transaction Summary" sheetId="1" r:id="summary"/>
          <sheet name="Transaction Details" sheetId="2" r:id="details"/></sheets></workbook>''',
        "xl/_rels/workbook.xml.rels": f'''<Relationships xmlns="{amex.PACKAGE_NS[1:-1]}">
          <Relationship Id="summary" Target="worksheets/sheet1.xml"/>
          <Relationship Id="details" Target="worksheets/sheet2.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": "<summary>PRIVATE-SUMMARY-TOTAL</summary>",
        "xl/worksheets/sheet2.xml": ET.tostring(worksheet),
        "xl/sharedStrings.xml": ET.tostring(string_tree),
    }
    parts.update(overrides or {})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, value)
    return base64.b64encode(output.getvalue()).decode("ascii")


def malformed_xlsx(kind):
    """Corrupt only synthetic ZIP metadata/data, keeping the activity intact."""
    content = activity_xlsx(PURCHASE)
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(content))) as archive:
        prefix = archive.read("xl/workbook.xml")
    if kind == "forged-size":
        # Real expansion exceeds the part cap, but both directory entries claim
        # a small, valid XML prefix with its correct CRC. ZipExtFile hides this.
        content = activity_xlsx(PURCHASE, overrides={
            "xl/workbook.xml": prefix + b" " * (amex.MAX_PART_BYTES + 1)})
    raw = bytearray(base64.b64decode(content))
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        member = archive.getinfo("xl/workbook.xml")
        directory = archive.start_dir
    offset = member.header_offset
    name_size, extra_size = struct.unpack_from("<HH", raw, offset + 26)
    start = offset + 30 + name_size + extra_size
    if kind == "corrupt-deflate":
        raw[start] = 0xff  # Reserved/invalid deflate block type.
    elif kind == "forged-size":
        # workbook.xml is the fixture's first central-directory member.
        assert raw[directory:directory + 4] == b"PK\x01\x02"
        crc = zipfile.crc32(prefix)
        struct.pack_into("<I", raw, offset + 14, crc)
        struct.pack_into("<I", raw, offset + 22, len(prefix))
        struct.pack_into("<I", raw, directory + 16, crc)
        struct.pack_into("<I", raw, directory + 24, len(prefix))
    else:
        raise AssertionError(kind)
    return base64.b64encode(raw).decode("ascii")


class AmexParserTests(unittest.TestCase):
    def test_actual_inflate_size_and_corrupt_deflate_are_rejected(self):
        for kind in ("forged-size", "corrupt-deflate"):
            with self.subTest(kind=kind), self.assertRaises(ImportDataError):
                parse_amex(malformed_xlsx(kind), file_format="xlsx")

    def test_csv_and_xlsx_preserve_signs_occurrences_and_notes_option(self):
        rows = [PURCHASE, PURCHASE, ["08/21/2026", "PAYMENT", "-12.34"] + [""] * 8,
                ["08/22/2026", "ZERO", "0"] + [""] * 8]
        for format_, content in [("csv", "\ufeff" + activity_csv(*rows)),
                                 ("xlsx", activity_xlsx(*rows)),
                                 ("xlsx", activity_xlsx(*rows, shared=True))]:
            with self.subTest(format=format_):
                parsed, warnings = parse_amex(content, ("Gold", "CREDIT CARD", "Amex"), file_format=format_)
                self.assertEqual(warnings, [])
                self.assertEqual([r["amount"] for r in parsed], [12.34, 12.34, -12.34, 0])
                first = parsed[0]
                self.assertEqual(first["description"], "TEST SHOP")
                self.assertEqual(first["date"], "2026-08-20")
                self.assertEqual(first["accountName"], "Gold")
                self.assertEqual(first["category"], "Shopping")
                self.assertEqual(first["subcategory"], "")
                self.assertIn("Merchant address: 123 Example Street", first["notes"])
                self.assertIn("Postal code: 01234", first["notes"])
                self.assertIn("Extended details: Shop, receipt details", first["notes"])
                self.assertNotIn("PRIVATE-", json.dumps(parsed))
                self.assertNotIn("createdAt", first)
                self.assertNotIn("id", first)
                without, _ = parse_amex(content, ("Gold", "CREDIT CARD", "Amex"),
                                        file_format=format_, include_merchant_details=False)
                self.assertEqual(without, [{**row, "notes": ""} for row in parsed])

    def test_basic_csv_and_empty_exports(self):
        parsed, _ = parse_amex("Date,Description,Amount\n08/20/2026,SHOP,1.23\n")
        self.assertEqual(parsed[0]["category"], "Uncategorized")
        self.assertEqual(parsed[0]["notes"], "")
        self.assertEqual(parsed[0]["accountName"], "American Express")
        self.assertEqual(parse_amex(activity_csv()), ([], []))
        self.assertEqual(parse_amex(activity_xlsx(), file_format="xlsx"), ([], []))

    def test_sparse_numeric_xlsx_dates_and_trailing_empty_columns(self):
        for serial, system, expected in [(46254, False, "2026-08-20"), (0, True, "1904-01-01"),
                                         (1, False, "1900-01-01"), (61, False, "1900-03-01")]:
            with self.subTest(serial=serial):
                row = [serial, "Test", 12.34] + [None] * 9
                parsed, _ = parse_amex(activity_xlsx(row, headers=[*HEADERS, ""], date1904=system), file_format="xlsx")
                self.assertEqual(parsed[0]["date"], expected)
                self.assertEqual(parsed[0]["notes"], "")

    def test_pending_rows_warn_and_currency_is_not_guessed(self):
        headers = ["Date", "Description", "Amount", "Status", "Currency"]
        content = activity_csv(["08/20/2026", "Test", "1", "Posted", "USD"],
                               ["", "Pending", "", "Pending", "USD"], headers=headers)
        parsed, warnings = parse_amex(content)
        self.assertEqual(len(parsed), 1)
        self.assertIn("1 pending", warnings[0])
        for bad in (content.replace("USD", "CAD"), content.replace("Posted", "unknown")):
            with self.assertRaises(ImportDataError):
                parse_amex(bad)

    def test_malformed_rows_and_options_fail_without_partial_results(self):
        for amount in ("", "NaN", "Infinity", "1e3", "1.001", "1,23", "(1.00)", "+1.00", "1000000001"):
            with self.subTest(amount=amount), self.assertRaises(ImportDataError):
                parse_amex(activity_csv(PURCHASE, [*PURCHASE[:2], amount, *PURCHASE[3:]]))
        for content in ("", "Date,Amount\n08/20/2026,1", activity_csv(PURCHASE) + '"unclosed',
                        activity_csv(PURCHASE) + "wrong,columns\n", activity_csv(PURCHASE).replace("08/20/2026", "02/30/2026"),
                        activity_csv(PURCHASE).replace("TEST  SHOP", ""), activity_csv(PURCHASE).replace("Reference", "Amount")):
            with self.subTest(content=content), self.assertRaises(ImportDataError):
                parse_amex(content)
        for value in ("false", 0, None):
            with self.assertRaisesRegex(ImportDataError, "includeMerchantDetails"):
                parse_amex(activity_csv(PURCHASE), include_merchant_details=value)
        for value in ("xls", [], None):
            with self.assertRaises(ImportDataError):
                parse_amex(activity_csv(PURCHASE), file_format=value)

    def test_xlsx_rejects_untrusted_structures_and_formula_values(self):
        for part in ["xl/workbook.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet2.xml"]:
            with self.subTest(part=part), self.assertRaises(ImportDataError):
                parse_amex(activity_xlsx(PURCHASE, overrides={part: '<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>'}), file_format="xlsx")
        relations = f'<Relationships xmlns="{amex.PACKAGE_NS[1:-1]}"><Relationship Id="details" Target="{{target}}" {{external}}/></Relationships>'
        for target, external in [("../../private.xml", ""), ("https://example.invalid/file", 'TargetMode="External"')]:
            with self.assertRaises(ImportDataError):
                parse_amex(activity_xlsx(PURCHASE, overrides={"xl/_rels/workbook.xml.rels": relations.format(target=target, external=external)}), file_format="xlsx")
        # A cached formula result is not a valid original transaction amount.
        for column in ("C", "D"):
            original = base64.b64decode(activity_xlsx(PURCHASE))
            with zipfile.ZipFile(io.BytesIO(original)) as archive:
                xml = ET.fromstring(archive.read("xl/worksheets/sheet2.xml"))
            cell = next(c for c in xml.iter(f"{amex.MAIN_NS}c") if c.get("r") == f"{column}8")
            ET.SubElement(cell, f"{amex.MAIN_NS}f").text = "1+1"
            with self.assertRaisesRegex(ImportDataError, "not formulas"):
                parse_amex(activity_xlsx(PURCHASE, overrides={"xl/worksheets/sheet2.xml": ET.tostring(xml)}), file_format="xlsx")
        for content in ("not base64", base64.b64encode(b"not a zip").decode()):
            with self.assertRaises(ImportDataError):
                parse_amex(content, file_format="xlsx")
        with self.assertRaises(ImportDataError):
            parse_amex(activity_xlsx([60, "Test", 1]), file_format="xlsx")

    def test_file_and_row_limits(self):
        for format_, content in [("csv", activity_csv(PURCHASE)), ("xlsx", activity_xlsx(PURCHASE))]:
            with patch.object(amex, "MAX_FILE_BYTES", 8), self.assertRaises(ImportDataError):
                parse_amex(content, file_format=format_)
            with patch.object(amex, "MAX_ROWS", 1), self.assertRaises(ImportDataError):
                doubled = activity_csv(PURCHASE, PURCHASE) if format_ == "csv" else activity_xlsx(PURCHASE, PURCHASE)
                parse_amex(doubled, file_format=format_)


class AmexSessionTests(unittest.TestCase):
    setUp = harness.CapitalOneSessionTests.setUp
    tearDown = harness.CapitalOneSessionTests.tearDown
    request = harness.CapitalOneSessionTests.request

    def stage(self, content=None, format_="xlsx", **options):
        code, session = self.request("POST", "/api/amex-import-sessions", {
            "startDate": "2026-08-20", "endDate": "2026-08-21", "matchRefunds": False,
            "accountName": "Gold", "accountType": "CREDIT CARD", "provider": "Amex", **options,
        })
        self.assertEqual(code, 201, session)
        self.assertEqual(session["includeMerchantDetails"], options.get("includeMerchantDetails", True))
        base = f'/api/amex-import-sessions/{session["token"]}'
        code, result = self.request("POST", base + "/complete", {"content": content or activity_xlsx(PURCHASE), "fileFormat": format_})
        self.assertEqual(code, 200, result)
        self.assertEqual(result["status"], "review")
        return base, result

    def test_notes_choice_survives_preview_commit_and_csv_roundtrip(self):
        for include in (False, True):
            with self.subTest(include=include):
                # Separate occurrence/date so the second case tests another new row.
                purchase = ["08/20/2026" if include else "01/01/2026", *PURCHASE[1:]]
                base, preview = self.stage(activity_xlsx(purchase), includeMerchantDetails=include)
                row = preview["import"]["transactions"][0]
                self.assertEqual(bool(row["notes"]), include)
                self.assertEqual(row["category"], "Shopping")
                self.assertEqual(row["amount"], 12.34)
                before = self.path.read_bytes() if self.path.exists() else None
                code, result = self.request("POST", base + "/commit", {"transactions": [row]})
                self.assertEqual(code, 200, result)
                with self.path.open(newline="", encoding="utf-8") as file:
                    saved = list(csv.DictReader(file))
                stored = next(r for r in saved if r["date"] == row["date"])
                self.assertEqual(stored["notes"], row["notes"])
                self.assertEqual(stored["accountName"], "Gold")
                self.assertTrue(stored["createdAt"])
                self.assertTrue(stored["id"])
                if before is not None:
                    self.assertTrue(any(p.read_bytes() == before for p in self.path.parent.glob("backups/*.csv")))

    def test_same_import_refund_survives_edit_refresh_commit_and_reimport(self):
        content = activity_csv(
            ["08/20/2026", "Synthetic membership purchase", "219.00"],
            ["08/21/2026", "Synthetic statement credit", "-219.00"],
            headers=HEADERS[:3],
        )
        base, preview = self.stage(content, "csv", matchRefunds=True)
        review = preview["import"]
        credit = next(row for row in review["transactions"] if row["amount"] < 0)
        [candidate] = credit["_refundCandidates"]
        self.assertEqual((candidate["description"], candidate["_stagedId"]),
                         ("Synthetic membership purchase", 0))
        credit["linkTo"] = {"transactionId": candidate["id"], "type": "refund"}
        credit["notes"] = "Edited after matching"
        code, refreshed = self.request("POST", "/api/transactions/staged-preview", {
            "importToken": base.rsplit("/", 1)[1], "revision": review["revision"],
            "transactions": review["transactions"],
        })
        self.assertEqual(code, 200, refreshed)
        self.assertEqual([row["_budgetAmount"] for row in refreshed["transactions"]], [0, 0])
        linked_credit = next(row for row in refreshed["transactions"] if row["amount"] < 0)
        self.assertEqual(linked_credit["_linkedTo"]["id"], candidate["id"])
        self.assertEqual(linked_credit["_linkType"], "refund")
        self.assertTrue(all(row["_selected"] for row in refreshed["transactions"]))
        self.assertFalse(self.path.exists(), "Preview and edits must not initialize the database")
        self.assertFalse(list(self.path.parent.glob("backups/*.csv")))
        code, result = self.request("POST", base + "/commit", {
            "transactions": refreshed["transactions"], "transferPlan": refreshed["transferPlan"],
        })
        self.assertEqual(code, 200, result)
        self.assertEqual(result["import"]["committed"], 2)
        self.assertEqual(result["import"]["purchasesRefunded"], 1)
        with self.path.open(newline="", encoding="utf-8") as file:
            saved = list(csv.DictReader(file))
        self.assertEqual([(row["date"], row["amount"]) for row in saved],
                         [("2026-08-20", "219.00"), ("2026-08-21", "-219.00")])
        self.assertEqual(saved[1]["notes"], "Edited after matching")
        self.assertEqual(json.loads(saved[0]["links"]),
                         [{"transactionId": saved[1]["id"], "type": "refund"}])
        self.assertEqual(saved[0]["createdAt"], saved[1]["createdAt"])
        self.assertTrue(saved[0]["createdAt"])
        before = self.path.read_bytes()
        _, repeated = self.stage(content, "csv", matchRefunds=True)
        self.assertEqual((repeated["import"]["new"], repeated["import"]["duplicates"]), (0, 2))
        self.assertEqual(self.path.read_bytes(), before)

    def test_all_rows_default_optional_inclusive_dates_and_cancel(self):
        content = activity_xlsx(*[[f"08/{day}/2026", *PURCHASE[1:]] for day in (19, 20, 21, 22)])
        base, preview = self.stage(content)
        self.assertEqual(preview["import"]["parsed"], 4)
        _, filtered = self.stage(content, filterDateRange=True, includeMerchantDetails=False)
        self.assertEqual(sorted(r["date"] for r in filtered["import"]["transactions"]), ["2026-08-20", "2026-08-21"])
        self.assertFalse(self.path.exists())
        self.assertEqual(self.request("GET", base.replace("amex", "capitalone"))[0], 404)
        self.request("POST", base + "/cancel", {})
        _, late = self.request("POST", base + "/complete", {"content": content, "fileFormat": "xlsx"})
        self.assertEqual(late["status"], "cancelled")
        _, commit = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(commit["status"], "cancelled")
        self.assertFalse(self.path.exists())

    def test_occurrence_dedup_ignores_notes_format_and_description_changes_and_stale_commit(self):
        base, preview = self.stage(activity_xlsx(PURCHASE, PURCHASE))
        stale_base, stale = self.stage()
        self.assertFalse(self.path.exists())
        code, result = self.request("POST", base + "/commit", {"transactions": preview["import"]["transactions"]})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.request("POST", stale_base + "/commit", {"transactions": stale["import"]["transactions"]})[0], 409)
        before = self.path.read_bytes()
        basic = activity_csv(*[["08/20/2026", "Changed description", "12.34"]] * 2, headers=HEADERS[:3])
        _, again = self.stage(basic, "csv", includeMerchantDetails=False)
        self.assertEqual(again["import"]["duplicates"], 2)
        self.assertEqual(again["import"]["new"], 0)
        self.assertEqual(self.path.read_bytes(), before)

    def test_boundary_rejects_invalid_boolean_options_and_bad_export(self):
        for option in ("filterDateRange", "includeMerchantDetails", "matchRefunds", "browserImport"):
            for value in ("false", 0, None):
                with self.subTest(option=option, value=value):
                    code, _ = self.request("POST", "/api/amex-import-sessions", {
                        "startDate": "2026-08-20", "endDate": "2026-08-21", option: value})
                    self.assertEqual(code, 400)
        for payload in ({"content": "bad", "fileFormat": "xlsx"}, {"content": activity_csv(PURCHASE), "fileFormat": []}):
            _, session = self.request("POST", "/api/amex-import-sessions", {"startDate": "2026-08-20", "endDate": "2026-08-21"})
            base = f'/api/amex-import-sessions/{session["token"]}'
            self.assertEqual(self.request("POST", base + "/complete", payload)[0], 400)
        self.assertFalse(self.path.exists())

    def test_malformed_compression_returns_400_without_changing_saved_data(self):
        base, preview = self.stage()
        self.assertEqual(self.request("POST", base + "/commit", {
            "transactions": preview["import"]["transactions"]})[0], 200)
        before = self.path.read_bytes()
        backups = {p.name: p.read_bytes() for p in self.path.parent.glob("backups/*.csv")}
        for kind in ("forged-size", "corrupt-deflate"):
            with self.subTest(kind=kind):
                _, session = self.request("POST", "/api/amex-import-sessions", {
                    "startDate": "2026-08-20", "endDate": "2026-08-21"})
                base = f'/api/amex-import-sessions/{session["token"]}'
                code, result = self.request("POST", base + "/complete", {
                    "content": malformed_xlsx(kind), "fileFormat": "xlsx"})
                self.assertEqual(code, 400, result)
                self.assertEqual(self.path.read_bytes(), before)
                self.assertEqual({p.name: p.read_bytes() for p in self.path.parent.glob("backups/*.csv")}, backups)

    def test_browser_session_progress_range_sanitized_csv_and_cancel(self):
        options = {"startDate": "2026-08-20", "endDate": "2026-08-21", "browserImport": True,
                   "filterDateRange": False, "includeMerchantDetails": False, "matchRefunds": False}
        _, session = self.request("POST", "/api/amex-import-sessions", options)
        base = f'/api/amex-import-sessions/{session["token"]}'
        self.assertEqual(session["status"], "waiting_for_extension")
        self.assertTrue(session["filterDateRange"], "Browser exports are always bounded by the selected range")
        for status in ("opening_amex", "waiting_for_amex"):
            code, result = self.request("POST", base + "/progress", {"status": status, "progress": 10, "message": "Waiting for activity export"})
            self.assertEqual(code, 200)
            self.assertEqual(result["status"], status)
        content = activity_csv(*[[f"08/{day}/2026", "Synthetic purchase", "12.34"] for day in (19, 20, 21, 22)], headers=HEADERS[:3])
        code, preview = self.request("POST", base + "/complete", {"content": content})
        self.assertEqual(code, 200, preview)
        self.assertEqual(preview["status"], "review")
        self.assertEqual(preview["import"]["parsed"], 2)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.request("POST", base.replace("amex", "schwab") + "/progress", {"status": "opening_schwab"})[0], 404)
        self.request("POST", base + "/cancel", {})
        self.assertEqual(self.request("POST", base + "/complete", {"content": content})[1]["status"], "cancelled")
        self.assertEqual(self.request("POST", base + "/progress", {"status": "waiting_for_amex"})[1]["status"], "cancelled")
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
