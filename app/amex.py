"""American Express US activity exports; bounded, dependency-free CSV/XLSX reads.

Only transaction fields are retained. XLSX files are never extracted, formulas
are never evaluated, and workbook links are never fetched.
"""
from __future__ import annotations

import base64
import binascii
import csv
import io
import posixpath
import re
import struct
import zipfile
import zlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from xml.etree import ElementTree as ET

from importers import ImportDataError

AMEX_DEFAULT_ACCOUNT = ("American Express", "CREDIT CARD", "American Express")
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_ROWS = 100000
MAX_PART_BYTES = 32 * 1024 * 1024
MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PACKAGE_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REQUIRED = {"date", "description", "amount"}
MERCHANT_FIELDS = (
    ("appears on your statement as", "Statement name"),
    ("address", "Merchant address"),
    ("city/state", "City/state"),
    ("zip code", "Postal code"),
    ("country", "Country"),
    ("extended details", "Extended details"),
)
KEPT = REQUIRED | {"category", "status", "currency"} | {name for name, _ in MERCHANT_FIELDS}


def _xlsx_rows(encoded):
    if len(encoded) > (MAX_FILE_BYTES + 2) // 3 * 4:
        raise ImportDataError("American Express XLSX exceeds 16 MB")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ImportDataError("American Express XLSX content is invalid") from exc
    if len(raw) > MAX_FILE_BYTES:
        raise ImportDataError("American Express XLSX exceeds 16 MB")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        names = [info.filename for info in members]
        if (len(members) > 500 or len(set(names)) != len(names)
                or sum(info.file_size for info in members) > 100 * 1024 * 1024
                or any(info.file_size > MAX_PART_BYTES or info.flag_bits & 1
                       or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                       for info in members)):
            raise ImportDataError("American Express XLSX is encrypted or exceeds safe workbook limits")

        def xml(part):
            info = archive.getinfo(part)
            # Let ZipFile validate local headers, names and overlapping members,
            # but do not let ZipExtFile trust the declared expanded size: it can
            # inflate more than that size before silently truncating the result.
            with archive.open(info):
                name_size, extra_size = struct.unpack_from("<HH", raw, info.header_offset + 26)
                start = info.header_offset + 30 + name_size + extra_size
                compressed = raw[start:start + info.compress_size]
            if len(compressed) != info.compress_size:
                raise ImportDataError("American Express XLSX contains a truncated workbook part")
            if info.compress_type == zipfile.ZIP_DEFLATED:
                inflater = zlib.decompressobj(-zlib.MAX_WBITS)
                data = inflater.decompress(compressed, min(info.file_size, MAX_PART_BYTES) + 1)
                if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
                    raise ImportDataError("American Express XLSX contains invalid or oversized compressed data")
            else:
                data = compressed
            if len(data) != info.file_size or binascii.crc32(data) != info.CRC:
                raise ImportDataError("American Express XLSX contains an invalid workbook part size or checksum")
            text = data.decode("utf-8-sig")
            if "\x00" in text or re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
                raise ImportDataError("American Express XLSX contains unsupported XML declarations")
            return ET.fromstring(text)

        workbook = xml("xl/workbook.xml")
        sheets = workbook.findall(f"{MAIN_NS}sheets/{MAIN_NS}sheet")
        details = [sheet for sheet in sheets if sheet.get("name", "").strip().casefold() == "transaction details"]
        if len(details) != 1:
            raise ImportDataError("Choose an American Express activity XLSX with a Transaction Details sheet")
        properties = workbook.find(f"{MAIN_NS}workbookPr")
        date_1904 = properties is not None and properties.get("date1904") in {"1", "true"}
        relations = xml("xl/_rels/workbook.xml.rels")
        matches = [rel for rel in relations.findall(f"{PACKAGE_NS}Relationship")
                   if rel.get("Id") == details[0].get(f"{REL_NS}id")]
        if len(matches) != 1 or matches[0].get("TargetMode") == "External":
            raise ImportDataError("American Express XLSX has an invalid worksheet reference")
        target = matches[0].get("Target", "")
        part = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
        if not part.startswith("xl/worksheets/") or not part.endswith(".xml"):
            raise ImportDataError("American Express XLSX has an invalid worksheet path")
        strings = []
        if "xl/sharedStrings.xml" in names:
            strings = ["".join(t.text or "" for t in item.iter(f"{MAIN_NS}t"))
                       for item in xml("xl/sharedStrings.xml").findall(f"{MAIN_NS}si")]
        rows = []
        for row in xml(part).findall(f"{MAIN_NS}sheetData/{MAIN_NS}row"):
            if len(rows) >= MAX_ROWS + 100:
                raise ImportDataError("American Express export exceeds 100,000 transactions")
            values, formulas = {}, set()
            for cell in row.findall(f"{MAIN_NS}c"):
                reference = re.fullmatch(r"([A-Z]{1,3})[1-9]\d*", cell.get("r", ""))
                if reference is None:
                    raise ImportDataError("American Express XLSX has an invalid cell reference")
                column = 0
                for char in reference[1]:
                    column = column * 26 + ord(char) - ord("A") + 1
                column -= 1
                if column > 255 or column in values:
                    raise ImportDataError("American Express XLSX has duplicate or excessive columns")
                kind = cell.get("t", "n")
                value = cell.findtext(f"{MAIN_NS}v", "")
                if cell.find(f"{MAIN_NS}f") is not None:
                    formulas.add(column)
                if kind == "s":
                    if not value.isdigit() or int(value) >= len(strings):
                        raise ImportDataError("American Express XLSX has an invalid shared string")
                    value = strings[int(value)]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in cell.iter(f"{MAIN_NS}t"))
                elif kind not in {"n", "str", "d"}:
                    # Boolean/error cells in required fields must not become money.
                    value = "[unsupported cell value]"
                values[column] = value
            width = max(values, default=-1) + 1
            rows.append(([values.get(i, "") for i in range(width)], formulas))
        return rows, date_1904


def parse_amex(content, account_identity=None, *, file_format="csv", include_merchant_details=True):
    """Preserve US activity signs: charges positive, payments/refunds negative."""
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError("American Express export is empty")
    if not isinstance(file_format, str) or file_format not in {"csv", "xlsx"}:
        raise ImportDataError("American Express imports support CSV or XLSX activity exports")
    if not isinstance(include_merchant_details, bool):
        raise ImportDataError("includeMerchantDetails must be true or false")
    try:
        if file_format == "xlsx":
            raw_rows, date_1904 = _xlsx_rows(content)
        else:
            if len(content.encode("utf-8")) > MAX_FILE_BYTES:
                raise ImportDataError("American Express CSV exceeds 16 MB")
            reader = csv.reader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
            raw_rows, date_1904 = [], False
            for row in reader:
                if len(raw_rows) >= MAX_ROWS + 100:
                    raise ImportDataError("American Express export exceeds 100,000 transactions")
                raw_rows.append((row, set()))
        headers = None
        transactions, pending = [], 0
        identity = account_identity or AMEX_DEFAULT_ACCOUNT
        for index, (raw, formulas) in enumerate(raw_rows, 1):
            values = [str(cell).strip() for cell in raw]
            if not any(values):
                continue
            if headers is None:
                candidate = [cell.casefold() for cell in values]
                if file_format == "xlsx" and index <= 100 and not REQUIRED.issubset(candidate):
                    continue  # XLSX has a statement cover above the table.
                nonempty = [name for name in candidate if name]
                if (not REQUIRED.issubset(candidate) or len(set(nonempty)) != len(nonempty)
                        or (file_format == "csv" and not all(candidate)) or formulas):
                    raise ImportDataError("Choose an American Express US activity export with Date, Description, and Amount columns")
                headers = candidate
                continue
            location = f"American Express row {index}"
            if (file_format == "csv" and len(values) != len(headers)) or any(values[len(headers):]):
                raise ImportDataError(f"{location}: incorrect number of columns")
            values += [""] * max(0, len(headers) - len(values))
            if any(headers[i] in KEPT for i in formulas if i < len(headers)):
                raise ImportDataError(f"{location}: transaction fields must contain values, not formulas")
            record = {name: values[i] for i, name in enumerate(headers) if name in KEPT}
            if record.get("currency", "USD").upper() not in {"", "USD"}:
                raise ImportDataError(f"{location}: only USD activity exports are supported")
            status = record.get("status", "posted").casefold()
            if status == "pending":
                pending += 1
                continue
            if status != "posted":
                raise ImportDataError(f"{location}: unknown transaction status")
            description = " ".join(record["description"].split())
            if not description:
                raise ImportDataError(f"{location}: Description cannot be blank")
            value = record["amount"]
            if not re.fullmatch(r"-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", value):
                raise ImportDataError(f"{location}: invalid Amount; use the original signed amount")
            amount = Decimal(value.replace("$", "").replace(",", ""))
            if abs(amount) > Decimal("1000000000"):
                raise ImportDataError(f"{location}: Amount is too large")
            raw_date, parsed_date = record["date"], None
            for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
                try:
                    parsed_date = datetime.strptime(raw_date, fmt).date()
                    break
                except ValueError:
                    pass
            if parsed_date is None and file_format == "xlsx" and re.fullmatch(r"\d+(?:\.0+)?", raw_date):
                serial = int(Decimal(raw_date))
                if (0 <= serial < 3000000 if date_1904 else 0 < serial < 3000000 and serial != 60):
                    base = date(1904, 1, 1) if date_1904 else date(1899, 12, 30 if serial > 60 else 31)
                    parsed_date = base + timedelta(days=serial)
            if parsed_date is None:
                raise ImportDataError(f"{location}: Date must use MM/DD/YYYY or YYYY-MM-DD")
            transactions.append({
                "date": parsed_date.isoformat(), "description": description, "amount": float(amount),
                "category": " ".join(record.get("category", "").split()) or "Uncategorized",
                "subcategory": "", "accountName": identity[0], "accountType": identity[1],
                "provider": identity[2],
                "notes": "\n".join(f"{label}: {' '.join(record[name].split())}"
                                   for name, label in MERCHANT_FIELDS if record.get(name, "").strip())
                         if include_merchant_details else "",
            })
            if len(transactions) > MAX_ROWS:
                raise ImportDataError("American Express export exceeds 100,000 transactions")
        if headers is None:
            raise ImportDataError("American Express transaction headers were not found")
        warnings = [f"Skipped {pending} pending American Express transactions; import them after they post."] if pending else []
        return transactions, warnings
    except (csv.Error, zipfile.BadZipFile, zlib.error, EOFError, struct.error,
            KeyError, ET.ParseError, UnicodeError, OverflowError, RuntimeError) as exc:
        raise ImportDataError("American Express export is malformed; download a fresh CSV or XLSX activity export") from exc
