#!/usr/bin/env python3
"""Dependency-free HTTP and CSV persistence server for the budget dashboard."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import tempfile
import threading
import time
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, unquote, urlparse
import transfers
import refunds
import reconciliation

from importers import (
    ALIEXPRESS_DEFAULT_ACCOUNT,
    AMAZON_DEFAULT_ACCOUNT,
    APPLE_CARD_DEFAULT_ACCOUNT,
    EBAY_DEFAULT_ACCOUNT,
    WALMART_DEFAULT_ACCOUNT,
    ImportDataError,
    VENMO_DEFAULT_ACCOUNT,
    parse_aliexpress,
    parse_amazon,
    parse_apple_card,
    parse_credit_karma,
    parse_ebay,
    parse_walmart,
    parse_capital_one,
    parse_schwab_checking,
    CAPITAL_ONE_DEFAULT_ACCOUNT,
    SCHWAB_DEFAULT_ACCOUNT,
    parse_venmo,
)


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent / "data"
COLUMNS = (
    "date",
    "description",
    "amount",
    "category",
    "subcategory",
    "accountName",
    "accountType",
    "provider",
    "notes",
    "tags",
    "group",
    "flags",
    "createdAt",
)
PRE_LINK_COLUMNS = COLUMNS
COLUMNS = COLUMNS + ("id", "links")
LEDGER_IMPORT_COLUMNS = tuple(column for column in COLUMNS if column != "createdAt")
PRE_GROUP_COLUMNS = tuple(column for column in PRE_LINK_COLUMNS if column != "group")
PRE_TAG_COLUMNS = tuple(column for column in PRE_GROUP_COLUMNS if column != "tags")
DEFAULT_CSV = DATA_DIR / "transactions.csv"
LEGACY_COLUMNS = (
    "date", "description", "amount", "category", "accountName", "accountType", "provider"
)
NOTES_COLUMNS = LEGACY_COLUMNS + ("notes",)
SUBCATEGORY_NOTES_COLUMNS = (
    "date", "description", "amount", "category", "subcategory",
    "accountName", "accountType", "provider", "notes",
)
FLAGS_COLUMNS = NOTES_COLUMNS + ("flags",)
CREATED_AT_COLUMNS = NOTES_COLUMNS + ("createdAt",)
PRE_SUBCATEGORY_COLUMNS = NOTES_COLUMNS + ("flags", "createdAt")
COMPATIBLE_COLUMNS = (
    COLUMNS,
    PRE_LINK_COLUMNS,
    PRE_GROUP_COLUMNS,
    PRE_TAG_COLUMNS,
    PRE_SUBCATEGORY_COLUMNS,
    SUBCATEGORY_NOTES_COLUMNS,
    FLAGS_COLUMNS,
    CREATED_AT_COLUMNS,
    NOTES_COLUMNS,
    LEGACY_COLUMNS,
)
REQUIRED_TEXT_COLUMNS = ("description",)
OPTIONAL_TEXT_COLUMNS = ("category", "accountName", "accountType", "provider")
IMPORT_TEXT_COLUMNS = (
    "description", "category", "subcategory", "accountName", "accountType", "provider"
)
FLAG_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")
CENT = Decimal("0.01")
MAX_REQUEST_BYTES = 1_000_000
MAX_IMPORT_REQUEST_BYTES = 50_000_000
BILL_PAYMENT_WINDOW_DAYS = 5
INTERNAL_TRANSFER_DESCRIPTION_PATTERN = re.compile(
    r"\b(?:transfer|payment|paymt|pmt|autopay)\b|"
    r"\b(?:to|from)\s+(?:chk|checking|sav|savings|acct|account)\b|"
    r"\bcredit\s+bal(?:ance)?\b",
    re.IGNORECASE,
)
TRANSACTION_PATH = re.compile(r"^/api/transactions/(\d+)$")
BACKUP_RESTORE_PATH = re.compile(
    r"^/api/backups/([^/]+)/restore$"
)
BACKUP_RENAME_PATH = re.compile(r"^/api/backups/([^/]+)/rename$")
BACKUP_DELETE_PATH = re.compile(r"^/api/backups/([^/]+)$")
IMPORT_HISTORY_PATH = re.compile(r"^/api/import-history/([^/]+)$")
GENERATED_BACKUP_FILENAME = re.compile(r"^transactions_\d{8}_\d{6}_\d{6}\.csv$")
AMAZON_IMPORT_SESSION_PATH = re.compile(
    r"^/api/amazon-import-sessions/([A-Za-z0-9_-]{32,})$"
)
AMAZON_IMPORT_ACTION_PATH = re.compile(
    r"^/api/amazon-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
CREDIT_KARMA_IMPORT_SESSION_PATH = re.compile(
    r"^/api/creditkarma-import-sessions/([A-Za-z0-9_-]{32,})$"
)
CREDIT_KARMA_IMPORT_ACTION_PATH = re.compile(
    r"^/api/creditkarma-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
ALIEXPRESS_IMPORT_SESSION_PATH = re.compile(
    r"^/api/aliexpress-import-sessions/([A-Za-z0-9_-]{32,})$"
)
ALIEXPRESS_IMPORT_ACTION_PATH = re.compile(
    r"^/api/aliexpress-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
VENMO_IMPORT_SESSION_PATH = re.compile(
    r"^/api/venmo-import-sessions/([A-Za-z0-9_-]{32,})$"
)
VENMO_IMPORT_ACTION_PATH = re.compile(
    r"^/api/venmo-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
APPLE_CARD_IMPORT_SESSION_PATH = re.compile(
    r"^/api/applecard-import-sessions/([A-Za-z0-9_-]{32,})$"
)
APPLE_CARD_IMPORT_ACTION_PATH = re.compile(
    r"^/api/applecard-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
EBAY_IMPORT_SESSION_PATH = re.compile(
    r"^/api/ebay-import-sessions/([A-Za-z0-9_-]{32,})$"
)
EBAY_IMPORT_ACTION_PATH = re.compile(
    r"^/api/ebay-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
CSV_IMPORT_SESSION_PATH = re.compile(
    r"^/api/csv-import-sessions/([A-Za-z0-9_-]{32,})$"
)
WALMART_IMPORT_SESSION_PATH = re.compile(
    r"^/api/walmart-import-sessions/([A-Za-z0-9_-]{32,})$"
)
CAPITAL_ONE_IMPORT_SESSION_PATH = re.compile(
    r"^/api/capitalone-import-sessions/([A-Za-z0-9_-]{32,})$"
)
CAPITAL_ONE_IMPORT_ACTION_PATH = re.compile(
    r"^/api/capitalone-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
SCHWAB_IMPORT_SESSION_PATH = re.compile(
    r"^/api/schwab-import-sessions/([A-Za-z0-9_-]{32,})$"
)
SCHWAB_IMPORT_ACTION_PATH = re.compile(
    r"^/api/schwab-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
WALMART_IMPORT_ACTION_PATH = re.compile(
    r"^/api/walmart-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|commit|cancel)$"
)
CSV_IMPORT_ACTION_PATH = re.compile(
    r"^/api/csv-import-sessions/([A-Za-z0-9_-]{32,})/(commit|cancel)$"
)
AMAZON_IMPORT_SESSION_TTL_SECONDS = 60 * 60
TERMINAL_IMPORT_STATUSES = {"complete", "error", "cancelled"}
MISSING_CSV_REVISION = "missing"
IMPORT_SOURCE_LABELS = {
    "amazon": "Amazon",
    "creditkarma": "Credit Karma",
    "aliexpress": "AliExpress",
    "venmo": "Venmo",
    "applecard": "Apple Card",
    "ebay": "eBay",
    "walmart": "Walmart",
    "capitalone": "Capital One",
    "schwab": "Schwab Checking",
    "csv": "CSV",
}
IMPORT_ACCOUNT_DEFAULTS = {
    "amazon": AMAZON_DEFAULT_ACCOUNT,
    "aliexpress": ALIEXPRESS_DEFAULT_ACCOUNT,
    "venmo": VENMO_DEFAULT_ACCOUNT,
    "applecard": APPLE_CARD_DEFAULT_ACCOUNT,
    "ebay": EBAY_DEFAULT_ACCOUNT,
    "walmart": WALMART_DEFAULT_ACCOUNT,
    "capitalone": CAPITAL_ONE_DEFAULT_ACCOUNT,
    "schwab": SCHWAB_DEFAULT_ACCOUNT,
}
STATIC_FILES = {
    "/": APP_DIR / "index.html",
    "/index.html": APP_DIR / "index.html",
    "/styles.css": APP_DIR / "styles.css",
    "/theme.js": APP_DIR / "theme.js",
    "/app.js": APP_DIR / "app.js",
    "/navigation.js": APP_DIR / "navigation.js",
    "/transaction-ui.js": APP_DIR / "transaction-ui.js",
    "/transaction-bulk.js": APP_DIR / "transaction-bulk.js",
    "/group-comparison.js": APP_DIR / "group-comparison.js",
    "/group-comparison.css": APP_DIR / "group-comparison.css",
    "/transaction-tools.css": APP_DIR / "transaction-tools.css",
    "/transactions": APP_DIR / "transactions.html",
    "/transactions.html": APP_DIR / "transactions.html",
    "/transactions.js": APP_DIR / "transactions.js",
    "/transactions-model.js": APP_DIR / "transactions-model.js",
    "/transactions.css": APP_DIR / "transactions.css",
    "/import": APP_DIR / "upload.html",
    "/import.html": APP_DIR / "upload.html",
    "/upload.js": APP_DIR / "upload.js",
    "/classifications": APP_DIR / "classifications.html",
    "/classifications.html": APP_DIR / "classifications.html",
    "/settings": APP_DIR / "settings.html",
    "/settings.html": APP_DIR / "settings.html",
    "/settings.js": APP_DIR / "settings.js",
}


class CsvDataError(ValueError):
    """Raised when transaction data is invalid."""


class CsvFileMissingError(CsvDataError):
    """Raised when the transaction CSV has not been created yet."""


class RevisionConflict(RuntimeError):
    """Raised when a client tries to modify an out-of-date CSV revision."""


def normalize_created_at(value: Any, location: str) -> str:
    if not isinstance(value, str):
        raise CsvDataError(f"{location} must be an ISO 8601 timestamp")
    created_at = value.strip()
    if not created_at:
        return ""
    try:
        parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CsvDataError(f"{location} must be an ISO 8601 timestamp") from exc
    if parsed_created_at.tzinfo is None:
        raise CsvDataError(f"{location} must include a timezone")
    return (
        parsed_created_at.astimezone(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def normalize_transaction(raw: Any, location: str) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise CsvDataError(f"{location} must be an object")

    raw_date = raw.get("date")
    if not isinstance(raw_date, str):
        raise CsvDataError(f"{location}.date must use YYYY-MM-DD")
    try:
        normalized_date = date.fromisoformat(raw_date.strip()).isoformat()
    except ValueError as exc:
        raise CsvDataError(f"{location}.date must use YYYY-MM-DD") from exc

    raw_amount = raw.get("amount")
    if isinstance(raw_amount, bool) or raw_amount is None:
        raise CsvDataError(f"{location}.amount must be numeric")
    try:
        amount = Decimal(str(raw_amount).strip())
    except (InvalidOperation, ValueError) as exc:
        raise CsvDataError(f"{location}.amount must be numeric") from exc
    if not amount.is_finite():
        raise CsvDataError(f"{location}.amount must be finite")
    try:
        amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise CsvDataError(f"{location}.amount is too large") from exc

    transaction: dict[str, Any] = {
        "date": normalized_date,
        "amount": float(amount),
    }
    for column in REQUIRED_TEXT_COLUMNS:
        value = raw.get(column)
        if not isinstance(value, str) or not value.strip():
            raise CsvDataError(f"{location}.{column} cannot be blank")
        transaction[column] = value.strip()
    for column in OPTIONAL_TEXT_COLUMNS:
        value = raw.get(column, "")
        if not isinstance(value, str):
            raise CsvDataError(f"{location}.{column} must be text")
        transaction[column] = value.strip()
    subcategory = raw.get("subcategory", "")
    if not isinstance(subcategory, str):
        raise CsvDataError(f"{location}.subcategory must be text")
    transaction["subcategory"] = subcategory.strip()
    notes = raw.get("notes", "")
    if not isinstance(notes, str):
        raise CsvDataError(f"{location}.notes must be text")
    transaction["notes"] = notes.strip()
    raw_tags = raw.get("tags", "")
    if not isinstance(raw_tags, str):
        raise CsvDataError(f"{location}.tags must be comma-separated text")
    tags: list[str] = []
    seen_tags: set[str] = set()
    for raw_tag in raw_tags.split(","):
        tag = collapse_whitespace(raw_tag)
        if not tag:
            continue
        if len(tag) > 100:
            raise CsvDataError(f"{location}.tags entries cannot exceed 100 characters")
        normalized_tag = tag.casefold()
        if normalized_tag in seen_tags:
            continue
        tags.append(tag)
        seen_tags.add(normalized_tag)
    if len(tags) > 50:
        raise CsvDataError(f"{location}.tags cannot contain more than 50 entries")
    transaction["tags"] = ", ".join(tags)
    transaction["group"] = normalize_group(raw.get("group", ""), f"{location}.group")
    raw_flags = raw.get("flags", "")
    if not isinstance(raw_flags, str):
        raise CsvDataError(f"{location}.flags must be comma-separated text")
    flags: list[str] = []
    for raw_flag in raw_flags.split(","):
        flag = raw_flag.strip().casefold()
        if not flag:
            continue
        if not FLAG_PATTERN.fullmatch(flag):
            raise CsvDataError(
                f"{location}.flags entries must use letters, numbers, hyphens, or underscores"
            )
        if flag not in flags:
            flags.append(flag)
    transaction["flags"] = ",".join(flags)
    transaction["createdAt"] = normalize_created_at(
        raw.get("createdAt", ""), f"{location}.createdAt"
    )
    identity = raw.get("id", "")
    if identity:
        if not isinstance(identity, str) or not reconciliation.IDENTIFIER.fullmatch(identity):
            raise CsvDataError(f"{location}.id must be a valid transaction identifier")
        transaction["id"] = identity
    try:
        entries = reconciliation.links(raw)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    if entries or "links" in raw:
        transaction["links"] = reconciliation.encode_links(entries)
    if "repaymentTo" in raw:
        target = raw["repaymentTo"]
        if not isinstance(target, str) or (target and not reconciliation.IDENTIFIER.fullmatch(target)):
            raise CsvDataError(f"{location}.repaymentTo must be a purchase identifier or blank")
        transaction["repaymentTo"] = target
    if "linkTo" in raw:
        target = raw["linkTo"]
        if ("repaymentTo" in raw or not isinstance(target, dict)
                or set(target) != {"transactionId", "type"}
                or not isinstance(target["transactionId"], str)
                or (target["transactionId"] and not reconciliation.IDENTIFIER.fullmatch(target["transactionId"]))
                or target["type"] not in ("repayment", "refund", "transfer")):
            raise CsvDataError(f"{location}.linkTo needs a transactionId (or blank to unlink) and a valid link type")
        transaction["linkTo"] = dict(target)
    return transaction


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_group(value: Any, location: str = "group") -> str:
    if not isinstance(value, str):
        raise CsvDataError(f"{location} must be text (one group per transaction)")
    name = collapse_whitespace(value)
    if len(name) > 100:
        raise CsvDataError(f"{location} cannot exceed 100 characters")
    return name


def canonicalize_new_groups(
    transactions: Sequence[dict[str, Any]], existing: Sequence[Mapping[str, Any]]
) -> None:
    """Reuse existing spelling without changing unrelated rows or converting tags."""
    names: dict[str, str] = {}
    for row in existing:
        name = normalize_group(row.get("group", ""))
        if name:
            names.setdefault(name.casefold(), name)
    for row in transactions:
        name = normalize_group(row.get("group", ""))
        if name:
            name = names.setdefault(name.casefold(), name)
        row["group"] = name


BULK_TEXT_FIELDS = {
    "date", "description", "amount", "category", "subcategory", "accountName",
    "accountType", "provider", "notes", "group",
}
BULK_FIELDS = BULK_TEXT_FIELDS | {"tags", "refunded", "flagged", "internalTransferTreatment"}


def validate_bulk_changes(changes: Any) -> dict[str, Any]:
    if not isinstance(changes, dict) or not changes:
        raise CsvDataError("Choose at least one field to change.")
    if set(changes) - BULK_FIELDS:
        raise CsvDataError("Bulk edits can only change supported user-editable fields.")
    if "tags" in changes:
        action = changes["tags"]
        if (not isinstance(action, dict) or set(action) != {"mode", "value"}
                or not isinstance(action["mode"], str)
                or action["mode"] not in {"add", "remove", "replace", "clear"}
                or not isinstance(action["value"], str)):
            raise CsvDataError("Tags need an add, remove, replace, or clear action and a text value.")
    if "refunded" in changes and not isinstance(changes["refunded"], bool):
        raise CsvDataError("Refunded must be true or false.")
    if "flagged" in changes and not isinstance(changes["flagged"], bool):
        raise CsvDataError("Flagged must be true or false.")
    if "internalTransferTreatment" in changes and changes["internalTransferTreatment"] not in (
        "automatic", "internal-transfer", "include-in-budget",
    ):
        raise CsvDataError("Unknown internal-transfer treatment.")
    return changes


def apply_bulk_changes(transaction: Mapping[str, Any], changes: Mapping[str, Any]) -> dict[str, Any]:
    """Apply explicit fields only. Validate each entire result before any write."""
    raw = dict(transaction)
    for field in BULK_TEXT_FIELDS & changes.keys():
        raw[field] = changes[field]
    if "tags" in changes:
        action = changes["tags"]
        incoming = [collapse_whitespace(tag) for tag in action["value"].split(",") if tag.strip()]
        current = [tag.strip() for tag in str(raw.get("tags", "")).split(",") if tag.strip()]
        if action["mode"] == "add":
            raw["tags"] = ", ".join(current + incoming)
        elif action["mode"] == "remove":
            removed = {tag.casefold() for tag in incoming}
            raw["tags"] = ", ".join(tag for tag in current if tag.casefold() not in removed)
        else:
            raw["tags"] = "" if action["mode"] == "clear" else ", ".join(incoming)
    flags = [flag for flag in str(raw.get("flags", "")).split(",") if flag]
    if "refunded" in changes:
        flags = [flag for flag in flags if flag != "refunded"]
        if changes["refunded"]:
            flags.append("refunded")
    if "flagged" in changes:
        flags = [flag for flag in flags if flag != "flagged"]
        if changes["flagged"]:
            flags.append("flagged")
    if "internalTransferTreatment" in changes:
        flags = [flag for flag in flags if flag not in {"internal-transfer", "include-in-budget"}]
        treatment = changes["internalTransferTreatment"]
        if treatment != "internal-transfer":
            flags = [flag for flag in flags if not flag.startswith(transfers.PAIR_PREFIX)]
        if treatment != "automatic":
            flags.append(treatment)
    raw["flags"] = ",".join(flags)
    normalized = normalize_transaction(raw, "transaction")
    # Never re-normalize or drop untouched fields (especially notes/timestamps).
    result = dict(transaction)
    for field in changes:
        target = "flags" if field in {"refunded", "flagged", "internalTransferTreatment"} else field
        result[target] = normalized[target]
    return result


def validate_transaction_ids(transactions: Sequence[Mapping[str, Any]], ids: Any) -> list[int]:
    """Validate the entire revision-local selection before any batch mutation."""
    if not isinstance(ids, list) or not 1 <= len(ids) <= 50_000:
        raise CsvDataError("Select between 1 and 50000 transactions.")
    if any(isinstance(item, bool) or not isinstance(item, int) or not 0 <= item < len(transactions) for item in ids):
        raise CsvDataError("A selected transaction no longer exists.")
    if len(set(ids)) != len(ids):
        raise CsvDataError("Selected transaction IDs must be unique.")
    return ids


def bulk_edit_result(
    transactions: list[dict[str, Any]], ids: Any, changes: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    changes = dict(validate_bulk_changes(changes))
    if "group" in changes:
        group_value = {"group": changes["group"]}
        canonicalize_new_groups([group_value], transactions)
        changes["group"] = group_value["group"]
    ids = validate_transaction_ids(transactions, ids)
    updated = list(transactions)
    edits = []
    for transaction_id in ids:
        before = transactions[transaction_id]
        after = apply_bulk_changes(before, changes)
        changed_fields = [column for column in COLUMNS if before.get(column, "") != after.get(column, "")]
        if changed_fields:
            edits.append({"_id": transaction_id, "before": before, "after": after, "changedFields": changed_fields})
        updated[transaction_id] = after
    try:
        reconciliation.validate_mutation(transactions, updated)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    return updated, edits


def normalize_imported_transaction(raw: Any, location: str) -> dict[str, Any]:
    """Validate an imported row and collapse source formatting whitespace."""
    transaction = normalize_transaction(raw, location)
    for column in IMPORT_TEXT_COLUMNS:
        transaction[column] = collapse_whitespace(transaction[column])
    return transaction


def parse_ledger_import_csv(
    content: str,
) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
    """Parse Ledger-shaped CSV rows independently so invalid rows do not hide valid ones."""
    if not isinstance(content, str) or not content.strip():
        raise CsvDataError("The selected CSV is empty.")
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""))
    actual_columns = tuple(reader.fieldnames or ())
    legacy_import_columns = tuple(column for column in PRE_GROUP_COLUMNS if column != "createdAt")
    if actual_columns not in (LEDGER_IMPORT_COLUMNS, legacy_import_columns,
                              tuple(column for column in PRE_LINK_COLUMNS if column != "createdAt")):
        raise CsvDataError(
            "CSV columns must exactly match: " + ",".join(LEDGER_IMPORT_COLUMNS)
        )

    valid: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    row_count = 0
    for line_number, row in enumerate(reader, start=2):
        if not any(value is not None and value != "" for value in row.values()):
            continue
        row_count += 1
        try:
            if None in row:
                raise CsvDataError("row has more values than the CSV header")
            raw = {column: row.get(column, "") for column in LEDGER_IMPORT_COLUMNS}
            raw["createdAt"] = ""
            valid.append(normalize_imported_transaction(raw, f"line {line_number}"))
        except CsvDataError as exc:
            invalid.append({"line": line_number, "error": str(exc)})
    return valid, row_count, invalid


def read_transaction_state(csv_path: Path) -> tuple[list[dict[str, Any]], str]:
    """Read and validate a single, revisioned snapshot of the master CSV."""
    try:
        raw_bytes = csv_path.read_bytes()
        text = raw_bytes.decode("utf-8-sig")
    except FileNotFoundError as exc:
        raise CsvFileMissingError(f"transaction file does not exist: {csv_path}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise CsvDataError(f"could not read {csv_path}: {exc}") from exc

    reader = csv.DictReader(io.StringIO(text, newline=""))
    actual_columns = set(reader.fieldnames or [])
    # Accept the immediately previous schema without rewriting on read. Startup
    # migration (with a safety snapshot) upgrades it, and old exports remain usable.
    missing = set(PRE_GROUP_COLUMNS) - actual_columns
    if missing:
        raise CsvDataError(f"CSV is missing columns: {', '.join(sorted(missing))}")

    transactions = [
        normalize_transaction(row, f"line {line_number}")
        for line_number, row in enumerate(reader, start=2)
    ]
    revision = hashlib.sha256(raw_bytes).hexdigest()
    try:
        transactions = reconciliation.identified(transactions, revision)
        reconciliation.validate(transactions)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    return transactions, revision


def write_transactions_atomic(csv_path: Path, transactions: list[dict[str, Any]]) -> None:
    """Replace the CSV atomically so readers never observe a partial write."""
    try:
        identified = reconciliation.identified(transactions)
        reconciliation.validate(identified)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=csv_path.parent,
            prefix=f".{csv_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="raise")
            writer.writeheader()
            for transaction in identified:
                row = dict(transaction)
                row.pop("_id", None)
                row["amount"] = format(
                    Decimal(str(row["amount"])).quantize(CENT, rounding=ROUND_HALF_UP),
                    ".2f",
                )
                writer.writerow(row)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, csv_path)
        # Publish generated identities only after durable replacement succeeds.
        for original, saved in zip(transactions, identified):
            original["id"] = saved["id"]
            original["links"] = saved.get("links", "")
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise


def transaction_export_csv(
    transactions: Sequence[Mapping[str, Any]], start_date: str, end_date: str
) -> tuple[bytes, int]:
    """Build a re-importable Ledger CSV for an inclusive ISO date range."""
    for value, label in ((start_date, "startDate"), (end_date, "endDate")):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value or ""):
            raise CsvDataError(f"{label} must use YYYY-MM-DD")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise CsvDataError(f"{label} must be a valid date") from exc
    if start_date > end_date:
        raise CsvDataError("startDate must be on or before endDate")

    selected = [
        transaction
        for transaction in transactions
        if start_date <= str(transaction.get("date", "")) <= end_date
    ]
    selected = reconciliation.export_closure(transactions, selected)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=LEDGER_IMPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for transaction in selected:
        row = dict(transaction)
        row["amount"] = format(
            Decimal(str(row["amount"])).quantize(CENT, rounding=ROUND_HALF_UP),
            ".2f",
        )
        writer.writerow(row)
    return ("\ufeff" + output.getvalue()).encode("utf-8"), len(selected)


def initialize_csv_if_missing(csv_path: Path) -> None:
    """Create a header-only database without replacing an existing file."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with csv_path.open("x", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        pass


def backup_directory(csv_path: Path) -> Path:
    return csv_path.parent / "backups"


def classifications_path(csv_path: Path) -> Path:
    return csv_path.parent / "classifications.json"


def taxonomy_path(csv_path: Path) -> Path:
    return csv_path.parent / "taxonomy.json"


def normalize_taxonomy(raw: Any) -> dict[str, Any]:
    """Validate and alphabetize the user-managed category vocabulary."""
    if not isinstance(raw, Mapping):
        raise CsvDataError("taxonomy must be a JSON object")
    raw_categories = raw.get("categories")
    if not isinstance(raw_categories, list):
        raise CsvDataError("taxonomy.categories must be a list")
    if len(raw_categories) > 500:
        raise CsvDataError("taxonomy cannot contain more than 500 categories")

    categories: dict[str, dict[str, Any]] = {}
    for category_index, raw_category in enumerate(raw_categories):
        location = f"taxonomy.categories[{category_index}]"
        if not isinstance(raw_category, Mapping):
            raise CsvDataError(f"{location} must be an object")
        name = raw_category.get("name")
        if not isinstance(name, str) or not collapse_whitespace(name):
            raise CsvDataError(f"{location}.name cannot be blank")
        name = collapse_whitespace(name)
        if len(name) > 500:
            raise CsvDataError(f"{location}.name is too long")
        category_key = name.casefold()
        category = categories.setdefault(category_key, {"name": name, "subcategories": {}})

        raw_subcategories = raw_category.get("subcategories", [])
        if not isinstance(raw_subcategories, list):
            raise CsvDataError(f"{location}.subcategories must be a list")
        if len(raw_subcategories) > 500:
            raise CsvDataError(f"{location}.subcategories cannot contain more than 500 entries")
        for subcategory_index, raw_subcategory in enumerate(raw_subcategories):
            subcategory_location = f"{location}.subcategories[{subcategory_index}]"
            if isinstance(raw_subcategory, Mapping):
                subcategory_name = raw_subcategory.get("name")
            else:
                subcategory_name = raw_subcategory
            if not isinstance(subcategory_name, str) or not collapse_whitespace(subcategory_name):
                raise CsvDataError(f"{subcategory_location} cannot be blank")
            subcategory_name = collapse_whitespace(subcategory_name)
            if len(subcategory_name) > 500:
                raise CsvDataError(f"{subcategory_location} is too long")
            category["subcategories"].setdefault(
                subcategory_name.casefold(), subcategory_name
            )

    return {
        "version": 1,
        "categories": [
            {
                "name": category["name"],
                "subcategories": sorted(
                    category["subcategories"].values(), key=str.casefold
                ),
            }
            for category in sorted(categories.values(), key=lambda item: item["name"].casefold())
        ],
    }


def load_taxonomy(csv_path: Path) -> dict[str, Any]:
    path = taxonomy_path(csv_path)
    try:
        content = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {"version": 1, "categories": []}
    except (OSError, UnicodeDecodeError) as exc:
        raise CsvDataError(f"could not read {path}: {exc}") from exc
    try:
        return normalize_taxonomy(json.loads(content))
    except json.JSONDecodeError as exc:
        raise CsvDataError(f"taxonomy file contains invalid JSON: {exc}") from exc


def taxonomy_revision(csv_path: Path) -> str:
    try:
        return hashlib.sha256(taxonomy_path(csv_path).read_bytes()).hexdigest()
    except FileNotFoundError:
        return MISSING_CSV_REVISION


def write_taxonomy_atomic(csv_path: Path, document: Mapping[str, Any]) -> None:
    normalized = normalize_taxonomy(document)
    destination = taxonomy_path(csv_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=destination.parent,
            prefix=".taxonomy.", suffix=".tmp", delete=False,
        ) as handle:
            temporary_name = handle.name
            json.dump(normalized, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise


def taxonomy_summary(
    transactions: Sequence[Mapping[str, Any]], document: Mapping[str, Any]
) -> dict[str, Any]:
    """Merge saved vocabulary with category pairs observed in transactions."""
    categories: dict[str, dict[str, Any]] = {}
    for saved_category in document.get("categories", []):
        category = {
            "name": saved_category["name"],
            "transactionCount": 0,
            "subcategories": {},
        }
        for subcategory in saved_category["subcategories"]:
            category["subcategories"][subcategory.casefold()] = {
                "name": subcategory,
                "transactionCount": 0,
            }
        categories[category["name"].casefold()] = category

    for transaction in transactions:
        category_name = collapse_whitespace(str(transaction.get("category", "")))
        if not category_name:
            continue
        category = categories.setdefault(
            category_name.casefold(),
            {"name": category_name, "transactionCount": 0, "subcategories": {}},
        )
        category["transactionCount"] += 1
        subcategory_name = collapse_whitespace(str(transaction.get("subcategory", "")))
        if not subcategory_name:
            continue
        subcategory = category["subcategories"].setdefault(
            subcategory_name.casefold(),
            {"name": subcategory_name, "transactionCount": 0},
        )
        subcategory["transactionCount"] += 1

    return {
        "version": 1,
        "categories": [
            {
                "name": category["name"],
                "transactionCount": category["transactionCount"],
                "subcategories": sorted(
                    category["subcategories"].values(),
                    key=lambda item: item["name"].casefold(),
                ),
            }
            for category in sorted(categories.values(), key=lambda item: item["name"].casefold())
        ],
    }


CLASSIFICATION_MATCHER_FIELDS = (
    "category", "subcategory", "description", "accountName", "provider"
)
CLASSIFICATION_ACTION_FIELDS = (
    "description",
    "category",
    "subcategory",
    "accountName",
    "accountType",
    "provider",
    "notes",
    "refunded",
    "internalTransfer",
)
DEPRECATED_CLASSIFICATION_ACTION_FIELDS = {"date", "amount"}
CLASSIFICATION_REQUIRED_TEXT_ACTION_FIELDS = {
    "description", "category", "accountName", "accountType", "provider"
}
CLASSIFICATION_RULE_NOTES_MAX_LENGTH = 2_000


def validate_classification_regex(pattern: str, location: str) -> None:
    try:
        compiled_pattern = re.compile(pattern, re.IGNORECASE)
    except (re.error, OverflowError, RecursionError) as exc:
        raise CsvDataError(
            f"{location} is not a valid regular expression: {exc}"
        ) from exc

    groups: list[dict[str, bool]] = []
    last_group: dict[str, bool] | None = None
    # Python 3.10 also accepts later global flags, which apply retroactively.
    verbose = bool(compiled_pattern.flags & re.VERBOSE)
    verbose_stack: list[bool] = []
    index = 0
    while index < len(pattern):
        character = pattern[index]
        # Verbose whitespace/comments preserve the preceding atom: a later
        # quantifier still applies to that atom, even across comment lines.
        if verbose and character in " \t\n\r\v\f":
            index += 1
            continue
        if verbose and character == "#":
            index += 1
            while index < len(pattern):
                if pattern[index] == "\\":
                    index += 2
                elif pattern[index] == "\n":
                    index += 1
                    break
                else:
                    index += 1
            continue
        if character == "\\":
            following = pattern[index + 1 : index + 4]
            digit_escape = re.match(r"[0-9]{1,3}", following)
            is_octal_escape = following.startswith("0") or (
                digit_escape is not None
                and len(digit_escape.group()) == 3
                and all(digit in "01234567" for digit in digit_escape.group())
            )
            if digit_escape is not None and not is_octal_escape:
                raise CsvDataError(
                    f"{location} cannot use regular-expression backreferences"
                )
            last_group = None
            index += 2
            continue
        if character == "[":
            index += 1
            if pattern[index:index + 1] == "^":
                index += 1
            # ] is a literal in the first position, including after ^.
            if pattern[index:index + 1] == "]":
                index += 1
            while index < len(pattern):
                if pattern[index] == "\\":
                    index += 2
                elif pattern[index] == "]":
                    index += 1
                    break
                else:
                    index += 1
            last_group = None
            continue
        if pattern.startswith("(?P=", index) or pattern.startswith("(?(", index):
            raise CsvDataError(
                f"{location} cannot use regular-expression backreferences"
            )
        if pattern.startswith("(?#", index):
            index += 3
            while index < len(pattern):
                if pattern[index] == "\\":
                    index += 2
                elif pattern[index] == ")":
                    index += 1
                    break
                else:
                    index += 1
            continue
        if character == "(":
            prefix = re.match(r"\(\?([aiLmsux]*)(?:-([imsx]+))?([:)])", pattern[index:])
            if prefix is not None:
                enabled, disabled, ending = prefix.groups()
                next_verbose = (verbose or "x" in enabled) and "x" not in (disabled or "")
                if ending == ")":
                    verbose = next_verbose
                    index += len(prefix.group())
                    continue
                verbose_stack.append(verbose)
                verbose = next_verbose
            else:
                verbose_stack.append(verbose)
            groups.append({"repetition": False, "alternation": False})
            if pattern.startswith(("(?<=", "(?<!"), index):
                index += 4
            elif pattern.startswith(("(?:", "(?=", "(?!", "(?>"), index):
                index += 3
            elif pattern.startswith("(?P<", index):
                index = pattern.index(">", index + 4) + 1
            elif pattern.startswith("(?", index):
                if prefix is not None:
                    index += len(prefix.group())
                else:
                    index += 1
            else:
                index += 1
            last_group = None
            continue
        if character == ")":
            last_group = groups.pop()
            verbose = verbose_stack.pop()
            if groups:
                groups[-1]["repetition"] |= last_group["repetition"]
                groups[-1]["alternation"] |= last_group["alternation"]
            index += 1
            continue
        if character == "|":
            if groups:
                groups[-1]["alternation"] = True
            last_group = None
            index += 1
            continue

        quantifier_end = None
        if character in "*+?":
            quantifier_end = index + 1
        elif character == "{":
            quantifier = re.match(r"\{(?:[0-9]+(?:,[0-9]*)?|,[0-9]*)\}", pattern[index:])
            if quantifier is not None:
                quantifier_end = index + len(quantifier.group())
        if quantifier_end is not None:
            if last_group is not None and (
                last_group["repetition"] or last_group["alternation"]
            ):
                raise CsvDataError(
                    f"{location} cannot repeat a group that contains another "
                    "repetition or alternation"
                )
            if groups:
                groups[-1]["repetition"] = True
            if quantifier_end < len(pattern) and pattern[quantifier_end] in "?+":
                quantifier_end += 1
            index = quantifier_end
            last_group = None
            continue

        last_group = None
        index += 1


def normalize_classification_updates(raw: Any, location: str) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise CsvDataError(f"{location} must be an object")
    unknown = set(raw) - set(CLASSIFICATION_ACTION_FIELDS) - DEPRECATED_CLASSIFICATION_ACTION_FIELDS
    if unknown:
        raise CsvDataError(f"{location} contains unsupported fields: {', '.join(sorted(unknown))}")

    updates: dict[str, Any] = {field: None for field in CLASSIFICATION_ACTION_FIELDS}
    for field in CLASSIFICATION_ACTION_FIELDS:
        value = raw.get(field)
        if value is None:
            continue
        field_location = f"{location}.{field}"
        if field in {"refunded", "internalTransfer"}:
            if not isinstance(value, bool):
                raise CsvDataError(f"{field_location} must be true, false, or null")
            updates[field] = value
        elif field == "date":
            if not isinstance(value, str):
                raise CsvDataError(f"{field_location} must use YYYY-MM-DD")
            try:
                updates[field] = date.fromisoformat(value.strip()).isoformat()
            except ValueError as exc:
                raise CsvDataError(f"{field_location} must use YYYY-MM-DD") from exc
        elif field == "amount":
            if isinstance(value, bool):
                raise CsvDataError(f"{field_location} must be numeric")
            try:
                amount = Decimal(str(value).strip())
            except (InvalidOperation, ValueError) as exc:
                raise CsvDataError(f"{field_location} must be numeric") from exc
            if not amount.is_finite():
                raise CsvDataError(f"{field_location} must be finite")
            updates[field] = float(amount.quantize(CENT, rounding=ROUND_HALF_UP))
        else:
            if not isinstance(value, str):
                raise CsvDataError(f"{field_location} must be text or null")
            value = value.strip()
            if field in CLASSIFICATION_REQUIRED_TEXT_ACTION_FIELDS and not value:
                raise CsvDataError(f"{field_location} cannot be blank")
            if len(value) > (2_000 if field == "notes" else 500):
                raise CsvDataError(f"{field_location} is too long")
            updates[field] = value
    if not any(value is not None for value in updates.values()):
        raise CsvDataError(f"{location} must change at least one transaction field")
    return updates


def normalize_classifications(
    raw: Any, *, allow_invalid_regex: bool = False
) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise CsvDataError("classifications must be a JSON object")
    raw_items = raw.get("classifications")
    if not isinstance(raw_items, list):
        raise CsvDataError("classifications must be a list")
    if len(raw_items) > 200:
        raise CsvDataError("classifications cannot contain more than 200 entries")

    classifications: list[dict[str, Any]] = []
    for classification_index, raw_classification in enumerate(raw_items):
        location = f"classifications[{classification_index}]"
        if not isinstance(raw_classification, Mapping):
            raise CsvDataError(f"{location} must be an object")
        if "updates" in raw_classification:
            updates = normalize_classification_updates(
                raw_classification.get("updates"), f"{location}.updates"
            )
        else:
            # Version 1 files assigned only category and subcategory. Normalize
            # them into the action model so existing saved rules keep working.
            category = raw_classification.get("category")
            subcategory = raw_classification.get("subcategory", "")
            if not isinstance(category, str) or not category.strip():
                raise CsvDataError(f"{location}.category cannot be blank")
            if not isinstance(subcategory, str):
                raise CsvDataError(f"{location}.subcategory must be text")
            updates = normalize_classification_updates(
                {"category": category, "subcategory": subcategory}, f"{location}.updates"
            )
        raw_rules = raw_classification.get("rules")
        if not isinstance(raw_rules, list) or not raw_rules:
            raise CsvDataError(f"{location}.rules must contain at least one rule")
        if len(raw_rules) > 100:
            raise CsvDataError(f"{location}.rules cannot contain more than 100 entries")

        rules: list[dict[str, str]] = []
        for rule_index, raw_rule in enumerate(raw_rules):
            rule_location = f"{location}.rules[{rule_index}]"
            if not isinstance(raw_rule, Mapping):
                raise CsvDataError(f"{rule_location} must be an object")
            rule: dict[str, str] = {}
            for field in CLASSIFICATION_MATCHER_FIELDS:
                pattern = raw_rule.get(field, "")
                if not isinstance(pattern, str):
                    raise CsvDataError(f"{rule_location}.{field} must be text")
                pattern = pattern.strip()
                if len(pattern) > 300:
                    raise CsvDataError(f"{rule_location}.{field} cannot exceed 300 characters")
                if pattern and not allow_invalid_regex:
                    validate_classification_regex(pattern, f"{rule_location}.{field}")
                rule[field] = pattern
            if not any(rule[field] for field in CLASSIFICATION_MATCHER_FIELDS):
                raise CsvDataError(f"{rule_location} must include at least one matcher")
            notes = raw_rule.get("notes", "")
            if not isinstance(notes, str):
                raise CsvDataError(f"{rule_location}.notes must be text")
            notes = notes.strip()
            if len(notes) > CLASSIFICATION_RULE_NOTES_MAX_LENGTH:
                raise CsvDataError(
                    f"{rule_location}.notes cannot exceed "
                    f"{CLASSIFICATION_RULE_NOTES_MAX_LENGTH} characters"
                )
            rule["notes"] = notes
            rules.append(rule)
        classifications.append({"updates": updates, "rules": rules})
    classifications.sort(key=classification_sort_key)
    return {"version": 2, "classifications": classifications}


def classification_sort_key(classification: Mapping[str, Any]) -> tuple[str, str, str]:
    updates = classification["updates"]
    category = updates.get("category")
    subcategory = updates.get("subcategory")
    if category is not None:
        return (
            str(category).casefold(),
            str(subcategory or "").casefold(),
            json.dumps(updates, ensure_ascii=False, sort_keys=True).casefold(),
        )
    return (
        "\uffff",
        "",
        json.dumps(updates, ensure_ascii=False, sort_keys=True).casefold(),
    )


def classification_regex_errors(document: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Inspect an editable library without ever matching a transaction."""
    errors = []
    for classification_index, classification in enumerate(document["classifications"]):
        for rule_index, rule in enumerate(classification["rules"]):
            for field in CLASSIFICATION_MATCHER_FIELDS:
                if not rule[field]:
                    continue
                location = f"Classification {classification_index + 1}, rule {rule_index + 1}, {field}"
                try:
                    validate_classification_regex(rule[field], location)
                except CsvDataError as exc:
                    errors.append({
                        "classificationIndex": classification_index,
                        "ruleIndex": rule_index,
                        "field": field,
                        "message": str(exc),
                    })
    return errors


def load_classifications(csv_path: Path, *, for_editing: bool = False) -> dict[str, Any]:
    path = classifications_path(csv_path)
    try:
        content = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {"version": 2, "classifications": []}
    except (OSError, UnicodeDecodeError) as exc:
        raise CsvDataError(f"could not read {path}: {exc}") from exc
    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise CsvDataError(f"classifications file contains invalid JSON: {exc}") from exc
    if for_editing:
        # Read-only recovery: preserve every rule in memory and leave the saved
        # bytes untouched. Only GET/export may opt into this path.
        document = normalize_classifications(raw, allow_invalid_regex=True)
        errors = classification_regex_errors(document)
        if errors:
            document["regexErrors"] = errors
        return document
    try:
        return normalize_classifications(raw)
    except CsvDataError as exc:
        raise CsvDataError(
            "Saved classifications need repair. Open Classifications to edit "
            f"or export and replace the rules before importing. {exc}"
        ) from exc


def write_classifications_atomic(csv_path: Path, document: Mapping[str, Any]) -> None:
    normalized = normalize_classifications(document)
    destination = classifications_path(csv_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=destination.parent,
            prefix=".classifications.", suffix=".tmp", delete=False,
        ) as handle:
            temporary_name = handle.name
            json.dump(normalized, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise


def classify_transactions(
    transactions: list[dict[str, Any]], document: Mapping[str, Any]
) -> tuple[list[dict[str, Any]], list[bool]]:
    # Editable legacy documents are never trusted for execution, including
    # callers that bypass the HTTP handler or the strict disk loader.
    document = normalize_classifications(document)
    compiled = [
        (
            classification["updates"],
            [
                {
                    field: re.compile(rule[field], re.IGNORECASE) if rule[field] else None
                    for field in CLASSIFICATION_MATCHER_FIELDS
                }
                for rule in classification["rules"]
            ],
        )
        for classification in document.get("classifications", [])
    ]
    classified: list[dict[str, Any]] = []
    match_status: list[bool] = []
    for transaction in transactions:
        result = dict(transaction)
        result.setdefault("subcategory", "")
        matched = False
        for updates, rules in compiled:
            for rule in rules:
                if all(
                    pattern is None
                    or pattern.search(collapse_whitespace(str(result.get(field, ""))))
                    is not None
                    for field, pattern in rule.items()
                ):
                    for field, value in updates.items():
                        if value is None:
                            continue
                        if field == "refunded":
                            flags = [flag for flag in result.get("flags", "").split(",") if flag]
                            if value and "refunded" not in flags:
                                flags.append("refunded")
                            elif not value:
                                flags = [flag for flag in flags if flag != "refunded"]
                            result["flags"] = ",".join(flags)
                        elif field == "internalTransfer":
                            flags = {
                                flag for flag in result.get("flags", "").split(",") if flag
                            }
                            flags.discard("internal-transfer")
                            flags.discard("include-in-budget")
                            flags = {flag for flag in flags if not flag.startswith(transfers.PAIR_PREFIX)}
                            flags.add("internal-transfer" if value else "include-in-budget")
                            result["flags"] = ",".join(sorted(flags))
                        else:
                            result[field] = value
                    matched = True
                    break
            if matched:
                break
        classified.append(result)
        match_status.append(matched)
    return classified, match_status


def apply_classifications(
    transactions: list[dict[str, Any]], document: Mapping[str, Any]
) -> list[dict[str, Any]]:
    classified, _match_status = classify_transactions(transactions, document)
    return classified


def classification_action_values(transaction: Mapping[str, Any]) -> dict[str, Any]:
    """Expose only user-editable values when comparing or previewing actions."""
    values = {
        field: transaction.get(field, "")
        for field in CLASSIFICATION_ACTION_FIELDS
        if field not in {"refunded", "internalTransfer"}
    }
    flags = {
        flag.strip().casefold() for flag in str(transaction.get("flags", "")).split(",")
    }
    values["refunded"] = "refunded" in flags
    values["internalTransfer"] = (
        True
        if "internal-transfer" in flags
        else False
        if "include-in-budget" in flags
        else None
    )
    return values


def classification_changed_fields(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> list[str]:
    before_values = classification_action_values(before)
    after_values = classification_action_values(after)
    return [
        field for field in CLASSIFICATION_ACTION_FIELDS
        if before_values[field] != after_values[field]
    ]


def valid_backup_filename(filename: str) -> bool:
    return (
        bool(filename)
        and len(filename) <= 255
        and Path(filename).name == filename
        and filename not in {".", ".."}
        and filename.casefold().endswith(".csv")
    )


def read_backup_transactions(path: Path) -> list[dict[str, Any]]:
    """Validate a current or legacy backup without modifying the backup file."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError as exc:
        raise CsvFileMissingError(f"backup does not exist: {path}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise CsvDataError(f"could not read {path}: {exc}") from exc
    reader = csv.DictReader(io.StringIO(text, newline=""))
    fieldnames = tuple(reader.fieldnames or ())
    if any(set(fieldnames) == set(columns) for columns in COMPATIBLE_COLUMNS):
        return [
            normalize_transaction(
                dict(
                    row,
                    subcategory=row.get("subcategory", ""),
                    notes=row.get("notes", ""),
                    tags=row.get("tags", ""),
                    flags=row.get("flags", ""),
                    createdAt=row.get("createdAt", ""),
                ),
                f"line {line_number}",
            )
            for line_number, row in enumerate(reader, start=2)
        ]
    raise CsvDataError("backup CSV must use Ledger's current or legacy transaction columns")


def backup_metadata(path: Path) -> dict[str, Any]:
    stat = path.stat()
    metadata: dict[str, Any] = {
        "name": path.name,
        "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "sizeBytes": stat.st_size,
        "valid": True,
    }
    try:
        transactions = read_backup_transactions(path)
        metadata["transactionCount"] = len(transactions)
    except CsvDataError as exc:
        metadata.update(valid=False, transactionCount=None, error=str(exc))
    return metadata


def create_backup_copy(csv_path: Path, *, require_valid: bool = True) -> dict[str, Any]:
    """Atomically snapshot the master CSV into its sibling backups directory."""
    if require_valid:
        _transactions, revision = read_transaction_state(csv_path)
        raw_bytes = csv_path.read_bytes()
        if hashlib.sha256(raw_bytes).hexdigest() != revision:
            raise RevisionConflict("The transaction file changed while the backup was being created.")
    else:
        try:
            raw_bytes = csv_path.read_bytes()
        except FileNotFoundError as exc:
            raise CsvFileMissingError(f"transaction file does not exist: {csv_path}") from exc

    destination_directory = backup_directory(csv_path)
    destination_directory.mkdir(parents=True, exist_ok=True)
    while True:
        timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
        destination = destination_directory / f"transactions_{timestamp}.csv"
        if not destination.exists():
            break
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination_directory,
            prefix=".backup.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(raw_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise
    return backup_metadata(destination)


def list_backups(csv_path: Path) -> list[dict[str, Any]]:
    directory = backup_directory(csv_path)
    if not directory.exists():
        return []
    backups = [
        backup_metadata(path)
        for path in directory.iterdir()
        if path.is_file() and not path.is_symlink() and valid_backup_filename(path.name)
    ]
    backups.sort(key=lambda backup: (backup["modifiedAt"], backup["name"]), reverse=True)
    return backups


def migrate_transaction_schema(csv_path: Path) -> bool:
    """Atomically add optional columns to a legacy master CSV."""
    try:
        text = csv_path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise CsvDataError(f"could not read {csv_path}: {exc}") from exc
    reader = csv.DictReader(io.StringIO(text, newline=""))
    fieldnames = tuple(reader.fieldnames or ())
    fieldname_set = set(fieldnames)
    if fieldname_set == set(COLUMNS):
        current = list(reader)
        if all(row.get("id") for row in current):
            return False
        reader = iter(current)
    if not any(fieldname_set == set(columns) for columns in COMPATIBLE_COLUMNS):
        return False
    transactions = [
        normalize_transaction(
            dict(
                row,
                subcategory=row.get("subcategory", ""),
                notes=row.get("notes", ""),
                tags=row.get("tags", ""),
                flags=row.get("flags", ""),
                createdAt=row.get("createdAt", ""),
            ),
            f"line {line_number}",
        )
        for line_number, row in enumerate(reader, start=2)
    ]
    try:
        transactions = reconciliation.migrate_legacy_pairs(transactions)
        reconciliation.validate(transactions)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    # Preserve the exact pre-migration bytes so adding schema columns is
    # recoverable even if the process or disk fails during replacement.
    create_backup_copy(csv_path, require_valid=False)
    write_transactions_atomic(csv_path, transactions)
    return True


def transaction_identity(transaction: Mapping[str, Any]) -> tuple[str, Decimal]:
    """Return the user-specified import identity, normalized to exact cents."""
    return (
        str(transaction["date"]),
        Decimal(str(transaction["amount"])).quantize(CENT, rounding=ROUND_HALF_UP),
    )


def import_timestamp() -> str:
    """Return a sortable UTC identifier shared by one committed import batch."""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def stamp_imported_transactions(transactions: list[dict[str, Any]]) -> str:
    """Assign one immutable creation timestamp to every row in an import batch."""
    created_at = import_timestamp()
    for transaction in transactions:
        transaction["createdAt"] = created_at
    return created_at


def import_history(transactions: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Summarize persisted imported rows by their shared creation timestamp."""
    counts = Counter(
        str(transaction.get("createdAt", ""))
        for transaction in transactions
        if str(transaction.get("createdAt", "")).strip()
    )
    return [
        {"createdAt": created_at, "transactionCount": count}
        for created_at, count in sorted(counts.items(), reverse=True)
    ]


def merge_imported_transactions(
    existing: list[dict[str, Any]],
    parsed_by_source: Mapping[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
    """Merge imports using occurrence-aware date-and-amount deduplication."""
    existing_counts = Counter(transaction_identity(row) for row in existing) + refunds.receipt_counts(existing)
    upload_occurrences: Counter[tuple[str, Decimal]] = Counter()
    added_by_source = {source: 0 for source in parsed_by_source}
    skipped_by_source = {source: 0 for source in parsed_by_source}
    additions: list[dict[str, Any]] = []

    for source, parsed_transactions in parsed_by_source.items():
        for parsed_transaction in parsed_transactions:
            normalized = normalize_imported_transaction(
                parsed_transaction, f"{source} transaction"
            )
            key = transaction_identity(normalized)
            upload_occurrences[key] += 1
            if upload_occurrences[key] <= existing_counts[key]:
                skipped_by_source[source] += 1
            else:
                additions.append(normalized)
                added_by_source[source] += 1
    canonicalize_new_groups(additions, existing)
    return additions, added_by_source, skipped_by_source


def preview_imported_transactions(
    existing: list[dict[str, Any]],
    parsed_transactions: list[dict[str, Any]],
    source: str,
    classification_matches: Sequence[bool] | None = None,
    selected_ids: set[int] | None = None,
) -> tuple[list[dict[str, Any]], int, int]:
    """Classify every parsed occurrence without changing the master CSV."""
    if classification_matches is not None and len(classification_matches) != len(parsed_transactions):
        raise CsvDataError("classification results do not match parsed transactions")
    actual_counts = Counter(transaction_identity(row) for row in existing)
    receipt_counts = refunds.receipt_counts(existing)
    linked_refund_ids = {entry["transactionId"] for row in existing for entry in reconciliation.links(row)
                         if entry["type"] == "refund"}
    linked_refund_counts = Counter(transaction_identity(row) for row in existing if row.get("id") in linked_refund_ids)
    existing_counts = actual_counts + receipt_counts
    upload_occurrences: Counter[tuple[str, Decimal]] = Counter()
    preview: list[dict[str, Any]] = []
    duplicate_count = 0

    try:
        parsed_transactions = reconciliation.prepare_incoming(existing, parsed_transactions,
            hashlib.sha256(json.dumps({"existing": existing, "incoming": parsed_transactions},
                                      sort_keys=True, default=str).encode()).hexdigest())
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    for staged_id, parsed_transaction in enumerate(parsed_transactions):
        normalized = normalize_imported_transaction(
            parsed_transaction, f"{source} transaction"
        )
        key = transaction_identity(normalized)
        upload_occurrences[key] += 1
        is_duplicate = upload_occurrences[key] <= existing_counts[key]
        duplicate_count += int(is_duplicate)
        preview.append(
            dict(
                normalized,
                _stagedId=staged_id,
                _isDuplicate=is_duplicate,
                _refundAlreadyHandled=(is_duplicate and (upload_occurrences[key] > actual_counts[key]
                    or upload_occurrences[key] <= linked_refund_counts[key])),
                _classificationMatched=(
                    bool(classification_matches[staged_id])
                    if classification_matches is not None
                    else False
                ),
            )
        )
    canonicalize_new_groups(preview, existing)
    candidate_transactions = list(existing)
    candidate_indexes: dict[int, int] = {}
    for transaction in preview:
        if (transaction["_stagedId"] not in selected_ids if selected_ids is not None
                else transaction["_isDuplicate"] or transaction["amount"] == 0):
            continue
        candidate_indexes[transaction["_stagedId"]] = len(candidate_transactions)
        candidate_transactions.append(transaction)
    pairs = transfers.find_pairs(candidate_transactions, INTERNAL_TRANSFER_DESCRIPTION_PATTERN,
                                 BILL_PAYMENT_WINDOW_DAYS, incoming_start=len(existing))
    automatic_transfer_ids = {index for pair in pairs for index in pair}
    for transaction in preview:
        flags = {
            flag.strip().casefold()
            for flag in str(transaction.get("flags", "")).split(",")
            if flag.strip()
        }
        manually_excluded = "internal-transfer" in flags
        candidate_index = candidate_indexes.get(transaction["_stagedId"])
        automatically_excluded = (
            candidate_index is not None and candidate_index in automatic_transfer_ids
        )
        transaction["_isBillPayment"] = automatically_excluded
        transaction["_isInternalTransfer"] = manually_excluded or automatically_excluded
        transaction["_internalTransferSource"] = (
            "manual" if manually_excluded else "automatic" if automatically_excluded else ""
        )
    preview.sort(
        key=lambda transaction: (
            transaction["date"],
            transaction["description"].casefold(),
            transaction["_stagedId"],
        ),
        reverse=True,
    )
    return preview, len(preview) - duplicate_count, duplicate_count


def find_internal_transfer_ids(transactions: list[dict[str, Any]]) -> set[int]:
    """Explicit detection only; saved-transaction reads must never call this."""
    return {index for pair in transfers.find_pairs(
        transactions, INTERNAL_TRANSFER_DESCRIPTION_PATTERN, BILL_PAYMENT_WINDOW_DAYS
    ) for index in pair}


def find_bill_payment_ids(transactions: list[dict[str, Any]]) -> set[int]:
    """Backward-compatible name for explicit internal-transfer detection."""
    return find_internal_transfer_ids(transactions)


def public_state(transactions: list[dict[str, Any]], revision: str) -> dict[str, Any]:
    return {"revision": revision, "transactions": reconciliation.decorate([
        transfers.public_row(transaction, index) for index, transaction in enumerate(transactions)
    ])}


def transfer_review_path(csv_path: Path) -> Path:
    return csv_path.with_name(csv_path.stem + ".transfer-review.json")


def transfer_review_required(csv_path: Path) -> bool:
    # Read-only compatibility gate. Only an explicit full-database review clears it.
    if not csv_path.exists():
        return False
    try:
        marker = transfer_review_path(csv_path)
        if marker.stat().st_size > 1024:
            return True
        return json.loads(marker.read_text(encoding="utf-8")) != {"version": 1}
    except (OSError, ValueError):
        return True


def acknowledge_transfer_review(csv_path: Path) -> None:
    destination = transfer_review_path(csv_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".transfer-review-", delete=False) as handle:
            temporary_name = handle.name
            json.dump({"version": 1}, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def transfer_plan(rows: list[dict[str, Any]], revision: str, incoming_start: int | None = None,
                  *, initial_review: bool = False, excluded_ids=(), nonzero_decimal: bool = False):
    try:
        rows = reconciliation.identified(rows, revision)
        rows = reconciliation.apply_repayment_targets(rows)
        reconciliation.validate(rows)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc
    pairs = transfers.find_pairs(rows, INTERNAL_TRANSFER_DESCRIPTION_PATTERN,
                                 BILL_PAYMENT_WINDOW_DAYS, incoming_start=incoming_start,
                                 include_unpaired_exclusions=initial_review, excluded_ids=excluded_ids,
                                 nonzero_decimal=nonzero_decimal)
    updated, pair_ids = transfers.proposal(rows, pairs, revision)
    digest = hashlib.sha256(json.dumps(
        {"revision": revision, "rows": updated, "pairs": pairs},
        sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()
    return updated, pair_ids, digest


def refund_proposal_digest(digest, reviewed_credits):
    if not reviewed_credits:
        return digest
    return hashlib.sha256(json.dumps({"plan": digest, "refundCredits": reviewed_credits},
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def new_refund_link_count(existing, updated):
    previous = {(row["id"], entry["transactionId"]) for row in existing
                for entry in reconciliation.links(row) if entry["type"] == "refund"}
    return sum((row["id"], entry["transactionId"]) not in previous for row in updated
               for entry in reconciliation.links(row) if entry["type"] == "refund")


def import_transfer_review(existing, preview, revision, refund_purchase_ids=()):
    selected = sorted((row for row in preview if row.get(
        "_selected", not row["_isDuplicate"] and row["amount"] != 0
    )), key=lambda row: row["_stagedId"])
    selected_by_id = {row["id"]: row for row in selected}
    for parent in preview:
        if parent["id"] in selected_by_id:
            continue
        for entry in reconciliation.links(parent):
            child = selected_by_id.get(entry["transactionId"])
            if child is not None and "linkTo" not in child and "repaymentTo" not in child:
                raise CsvDataError("A linked purchase is not selected. Include its counterpart or unlink the credit first")
    additions = [normalize_imported_transaction(row, "review") for row in selected]
    updated, pair_ids, digest = transfer_plan(existing + additions, revision, len(existing), excluded_ids=refund_purchase_ids)
    projected = reconciliation.decorate([transfers.public_row(row, index) for index, row in enumerate(updated)])
    for row in projected:
        # Empty is meaningful after a reverse unlink: the request's raw links
        # remain an intent, not the editor's resolved relationship state.
        row["_reviewLinks"] = reconciliation.links(row)
    updates = []
    for index, original in enumerate(existing):
        if index in pair_ids or reconciliation.links(original) != reconciliation.links(updated[index]):
            row = projected[index]
            row["_existingLinkUpdate"] = True
            if index in pair_ids:
                row["_existingTransferUpdate"] = True
            updates.append(row)
    for offset, row in enumerate(selected, start=len(existing)):
        # Keep proposed automatic flags out of editable CSV fields until confirmation.
        for key in ("_linkType", "_linkRole", "_budgetAmount", "_netAmount", "_linkedTo",
                    "_linkedTransactions", "_isLinkedRefund"):
            row.pop(key, None)
        row.update({key: value for key, value in projected[offset].items()
                    if key.startswith("_") and key != "_id"})
    reserved = {row["id"] for row in projected if row.get("_linkRole")}
    for row in preview:
        if row.get("_linkRole"):
            row["_refundCandidates"] = []
        elif "_refundCandidates" in row:
            row["_refundCandidates"] = [candidate for candidate in row["_refundCandidates"]
                                        if candidate["id"] not in reserved]
    return {"transferPlan": digest, "existingTransferUpdates": updates,
            "transferPairs": len(pair_ids) // 2,
            "purchasesRefunded": new_refund_link_count(existing, updated)}


def import_refund_review(existing, preview, credits, selections):
    """Keep domain validation failures inside the import API's no-write boundary."""
    try:
        return refunds.decorate(existing, preview, credits, selections)
    except ValueError as exc:
        raise CsvDataError(str(exc)) from exc


def imported_transaction_state(
    saved_transactions: list[dict[str, Any]],
    additions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return public rows corresponding to newly appended occurrences."""

    def content_identity(transaction: Mapping[str, Any]) -> tuple[Any, ...]:
        return (
            str(transaction["date"]),
            str(transaction["description"]),
            Decimal(str(transaction["amount"])).quantize(CENT, rounding=ROUND_HALF_UP),
            str(transaction["category"]),
            str(transaction["subcategory"]),
            str(transaction["accountName"]),
            str(transaction["accountType"]),
            str(transaction["provider"]),
            str(transaction["notes"]),
            str(transaction["flags"]),
            str(transaction["createdAt"]),
        )

    remaining = Counter(content_identity(transaction) for transaction in additions)
    public_transactions = reconciliation.decorate([
        transfers.public_row(transaction, index)
        for index, transaction in enumerate(saved_transactions)
    ])
    selected: list[dict[str, Any]] = []
    # Existing rows precede newly appended, otherwise-identical rows after the
    # stable CSV sort. Walking backward selects the occurrences just imported.
    for transaction in reversed(public_transactions):
        key = content_identity(transaction)
        if remaining[key] <= 0:
            continue
        selected.append(transaction)
        remaining[key] -= 1
    selected.sort(
        key=lambda transaction: (
            transaction["date"],
            transaction["description"].casefold(),
        ),
        reverse=True,
    )
    return selected


class BudgetRequestHandler(BaseHTTPRequestHandler):
    server_version = "BudgetDashboard/2.0"

    @property
    def csv_path(self) -> Path:
        return self.server.csv_path  # type: ignore[attr-defined]

    @property
    def data_lock(self) -> threading.Lock:
        return self.server.data_lock  # type: ignore[attr-defined]

    @property
    def amazon_import_sessions(self) -> dict[str, dict[str, Any]]:
        return self.server.amazon_import_sessions  # type: ignore[attr-defined]

    @property
    def amazon_import_lock(self) -> threading.Lock:
        return self.server.amazon_import_lock  # type: ignore[attr-defined]

    def prune_amazon_import_sessions(self) -> None:
        cutoff = time.time() - AMAZON_IMPORT_SESSION_TTL_SECONDS
        with self.amazon_import_lock:
            expired = [
                token
                for token, session in self.amazon_import_sessions.items()
                if float(session["updatedAt"]) < cutoff
            ]
            for token in expired:
                del self.amazon_import_sessions[token]

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path in {"/upload", "/upload.html"}:
            self.send_response(HTTPStatus.PERMANENT_REDIRECT)
            self.send_header("Location", "/import")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/api/transactions/export":
            self.get_transactions_export(parse_qs(parsed_url.query))
            return
        if path == "/api/transactions":
            try:
                with self.data_lock:
                    transactions, revision = read_transaction_state(self.csv_path)
                result = public_state(transactions, revision)
                result["internalTransferReviewRequired"] = transfer_review_required(self.csv_path)
                self.send_json(HTTPStatus.OK, result)
            except CsvFileMissingError:
                self.send_json(
                    HTTPStatus.NOT_FOUND,
                    {
                        "code": "transaction_file_missing",
                        "error": "Import data to start using Ledger.",
                    },
                )
            except CsvDataError as exc:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        if path == "/api/backups":
            self.get_backups()
            return
        if path == "/api/import-history":
            self.get_import_history()
            return
        import_history_match = IMPORT_HISTORY_PATH.fullmatch(path)
        if import_history_match is not None:
            self.get_import_batch(unquote(import_history_match.group(1)))
            return
        if path == "/api/classifications":
            self.get_classifications()
            return
        if path == "/api/classifications/export":
            self.get_classifications(export=True)
            return
        if path == "/api/taxonomy":
            self.get_taxonomy()
            return
        session_match = AMAZON_IMPORT_SESSION_PATH.fullmatch(path)
        if session_match is not None:
            self.get_amazon_import_session(session_match.group(1))
            return
        credit_karma_session_match = CREDIT_KARMA_IMPORT_SESSION_PATH.fullmatch(path)
        if credit_karma_session_match is not None:
            self.get_amazon_import_session(
                credit_karma_session_match.group(1), source="creditkarma"
            )
            return
        aliexpress_session_match = ALIEXPRESS_IMPORT_SESSION_PATH.fullmatch(path)
        if aliexpress_session_match is not None:
            self.get_amazon_import_session(
                aliexpress_session_match.group(1), source="aliexpress"
            )
            return
        venmo_session_match = VENMO_IMPORT_SESSION_PATH.fullmatch(path)
        if venmo_session_match is not None:
            self.get_amazon_import_session(venmo_session_match.group(1), source="venmo")
            return
        apple_card_session_match = APPLE_CARD_IMPORT_SESSION_PATH.fullmatch(path)
        if apple_card_session_match is not None:
            self.get_amazon_import_session(
                apple_card_session_match.group(1), source="applecard"
            )
            return
        ebay_session_match = EBAY_IMPORT_SESSION_PATH.fullmatch(path)
        if ebay_session_match is not None:
            self.get_amazon_import_session(ebay_session_match.group(1), source="ebay")
            return
        csv_session_match = CSV_IMPORT_SESSION_PATH.fullmatch(path)
        capital_one_session_match = CAPITAL_ONE_IMPORT_SESSION_PATH.fullmatch(path)
        if capital_one_session_match is not None:
            self.get_amazon_import_session(capital_one_session_match.group(1), source="capitalone")
            return
        schwab_session_match = SCHWAB_IMPORT_SESSION_PATH.fullmatch(path)
        if schwab_session_match is not None:
            self.get_amazon_import_session(schwab_session_match.group(1), source="schwab")
            return
        walmart_session_match = WALMART_IMPORT_SESSION_PATH.fullmatch(path)
        if walmart_session_match is not None:
            self.get_amazon_import_session(walmart_session_match.group(1), source="walmart")
            return
        if csv_session_match is not None:
            self.get_amazon_import_session(csv_session_match.group(1), source="csv")
            return
        if path in STATIC_FILES:
            self.send_static_file(STATIC_FILES[path])
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        if path == "/api/transactions/initialize":
            self.initialize_transaction_file()
        elif path in {"/api/transactions/bulk-preview", "/api/transactions/bulk"}:
            self.bulk_edit_transactions(preview=path.endswith("-preview"))
        elif path == "/api/transactions/bulk-delete":
            self.bulk_delete_transactions()
        elif path == "/api/transactions/flags":
            self.save_transaction_flags()
        elif path == "/api/transactions/staged-preview":
            self.refresh_staged_preview()
        elif path in {"/api/internal-transfers/preview", "/api/internal-transfers/confirm",
                      "/api/reconciliation/preview", "/api/reconciliation/confirm"}:
            self.review_internal_transfers(commit=path.endswith("/confirm"))
        elif path == "/api/classifications/preview":
            self.preview_existing_transaction_classifications()
        elif path == "/api/classifications/apply":
            self.apply_classifications_to_existing_transactions()
        elif path == "/api/backups":
            self.create_backup()
        elif path == "/api/transactions":
            self.mutate_transactions("create")
        elif path == "/api/import":
            self.send_json(
                HTTPStatus.GONE,
                {
                    "error": (
                        "Direct file imports are no longer supported. "
                        "Use a staged import session and confirm its preview."
                    )
                },
            )
        elif path == "/api/amazon-import-sessions":
            self.create_amazon_import_session()
        elif path == "/api/creditkarma-import-sessions":
            self.create_amazon_import_session(source="creditkarma")
        elif path == "/api/aliexpress-import-sessions":
            self.create_amazon_import_session(source="aliexpress")
        elif path == "/api/venmo-import-sessions":
            self.create_amazon_import_session(source="venmo")
        elif path == "/api/applecard-import-sessions":
            self.create_amazon_import_session(source="applecard")
        elif path == "/api/ebay-import-sessions":
            self.create_amazon_import_session(source="ebay")
        elif path == "/api/walmart-import-sessions":
            self.create_amazon_import_session(source="walmart")
        elif path == "/api/capitalone-import-sessions":
            self.create_amazon_import_session(source="capitalone")
        elif path == "/api/schwab-import-sessions":
            self.create_amazon_import_session(source="schwab")
        elif path == "/api/csv-import-sessions":
            self.create_csv_import_session()
        else:
            backup_rename_match = BACKUP_RENAME_PATH.fullmatch(path)
            if backup_rename_match is not None:
                self.rename_backup(unquote(backup_rename_match.group(1)))
                return
            backup_restore_match = BACKUP_RESTORE_PATH.fullmatch(path)
            if backup_restore_match is not None:
                self.restore_backup(unquote(backup_restore_match.group(1)))
                return
            action_match = AMAZON_IMPORT_ACTION_PATH.fullmatch(path)
            if action_match is not None:
                self.update_amazon_import_session(
                    action_match.group(1), action_match.group(2)
                )
                return
            credit_karma_action_match = CREDIT_KARMA_IMPORT_ACTION_PATH.fullmatch(path)
            if credit_karma_action_match is not None:
                self.update_amazon_import_session(
                    credit_karma_action_match.group(1),
                    credit_karma_action_match.group(2),
                    source="creditkarma",
                )
                return
            aliexpress_action_match = ALIEXPRESS_IMPORT_ACTION_PATH.fullmatch(path)
            if aliexpress_action_match is not None:
                self.update_amazon_import_session(
                    aliexpress_action_match.group(1),
                    aliexpress_action_match.group(2),
                    source="aliexpress",
                )
                return
            venmo_action_match = VENMO_IMPORT_ACTION_PATH.fullmatch(path)
            if venmo_action_match is not None:
                self.update_amazon_import_session(
                    venmo_action_match.group(1), venmo_action_match.group(2), source="venmo"
                )
                return
            apple_card_action_match = APPLE_CARD_IMPORT_ACTION_PATH.fullmatch(path)
            if apple_card_action_match is not None:
                self.update_amazon_import_session(
                    apple_card_action_match.group(1),
                    apple_card_action_match.group(2),
                    source="applecard",
                )
                return
            ebay_action_match = EBAY_IMPORT_ACTION_PATH.fullmatch(path)
            if ebay_action_match is not None:
                self.update_amazon_import_session(
                    ebay_action_match.group(1), ebay_action_match.group(2), source="ebay"
                )
                return
            csv_action_match = CSV_IMPORT_ACTION_PATH.fullmatch(path)
            capital_one_action_match = CAPITAL_ONE_IMPORT_ACTION_PATH.fullmatch(path)
            if capital_one_action_match is not None:
                self.update_amazon_import_session(
                    capital_one_action_match.group(1), capital_one_action_match.group(2), source="capitalone"
                )
                return
            schwab_action_match = SCHWAB_IMPORT_ACTION_PATH.fullmatch(path)
            if schwab_action_match is not None:
                self.update_amazon_import_session(
                    schwab_action_match.group(1), schwab_action_match.group(2), source="schwab"
                )
                return
            walmart_action_match = WALMART_IMPORT_ACTION_PATH.fullmatch(path)
            if walmart_action_match is not None:
                self.update_amazon_import_session(
                    walmart_action_match.group(1), walmart_action_match.group(2), source="walmart"
                )
                return
            if csv_action_match is not None:
                self.update_amazon_import_session(
                    csv_action_match.group(1), csv_action_match.group(2), source="csv"
                )
                return
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def initialize_transaction_file(self) -> None:
        try:
            with self.data_lock:
                created = not self.csv_path.exists()
                initialize_csv_if_missing(self.csv_path)
                transactions, revision = read_transaction_state(self.csv_path)
            status = HTTPStatus.CREATED if created else HTTPStatus.OK
            self.send_json(status, public_state(transactions, revision))
        except CsvDataError as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not create {self.csv_path}: {exc}"},
            )

    def do_PUT(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        if path == "/api/classifications":
            self.put_classifications()
            return
        if path == "/api/taxonomy":
            self.put_taxonomy()
            return
        match = TRANSACTION_PATH.fullmatch(path)
        if match is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        self.mutate_transactions("update", int(match.group(1)))

    def do_DELETE(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        transaction_match = TRANSACTION_PATH.fullmatch(path)
        if transaction_match is not None:
            self.mutate_transactions("delete", int(transaction_match.group(1)))
            return
        backup_delete_match = BACKUP_DELETE_PATH.fullmatch(path)
        if backup_delete_match is not None:
            self.delete_backup(unquote(backup_delete_match.group(1)))
            return
        import_history_delete_match = IMPORT_HISTORY_PATH.fullmatch(path)
        if import_history_delete_match is not None:
            self.delete_import_batch(unquote(import_history_delete_match.group(1)))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def read_json_body(self, maximum_bytes: int = MAX_REQUEST_BYTES) -> Mapping[str, Any]:
        raw_length = self.headers.get("Content-Length")
        try:
            content_length = int(raw_length or "")
        except ValueError as exc:
            raise CsvDataError("a valid Content-Length header is required") from exc
        if content_length < 1 or content_length > maximum_bytes:
            raise CsvDataError(
                f"request body must be between 1 byte and {maximum_bytes // 1_000_000} MB"
            )
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CsvDataError("request body must be valid UTF-8 JSON") from exc
        if not isinstance(payload, Mapping):
            raise CsvDataError("request body must be a JSON object")
        return payload

    @staticmethod
    def public_amazon_import_session(session: Mapping[str, Any]) -> dict[str, Any]:
        response = {
            "source": session.get("source", "amazon"),
            "status": session["status"],
            "progress": session["progress"],
            "message": session["message"],
            "startDate": session["startDate"],
            "endDate": session["endDate"],
            "matchRefunds": session.get("matchRefunds", True),
        }
        if "import" in session:
            response["import"] = session["import"]
        if session.get("source") == "creditkarma":
            response["ignoreAmazon"] = session.get("ignoreAmazon", True)
            response["ignoreAliExpress"] = session.get("ignoreAliExpress", True)
            response["ignoreVenmo"] = session.get("ignoreVenmo", True)
            response["ignoreEbay"] = session.get("ignoreEbay", True)
            response["ignoreWalmart"] = session.get("ignoreWalmart", True)
        if session.get("source") in IMPORT_ACCOUNT_DEFAULTS:
            response["accountName"] = session["accountName"]
            response["accountType"] = session["accountType"]
            response["provider"] = session["provider"]
        return response

    def create_amazon_import_session(self, source: str = "amazon") -> None:
        try:
            payload = self.read_json_body()
            raw_start = payload.get("startDate")
            raw_end = payload.get("endDate")
            if not isinstance(raw_start, str) or not isinstance(raw_end, str):
                raise CsvDataError("startDate and endDate must use YYYY-MM-DD")
            try:
                start_date = date.fromisoformat(raw_start)
                end_date = date.fromisoformat(raw_end)
            except ValueError as exc:
                raise CsvDataError("startDate and endDate must use YYYY-MM-DD") from exc
            if start_date > end_date:
                raise CsvDataError("startDate cannot be after endDate")

            ignore_amazon = payload.get("ignoreAmazon", True)
            ignore_aliexpress = payload.get("ignoreAliExpress", True)
            ignore_venmo = payload.get("ignoreVenmo", True)
            ignore_ebay = payload.get("ignoreEbay", True)
            ignore_walmart = payload.get("ignoreWalmart", True)
            match_refunds = payload.get("matchRefunds", True)
            if not isinstance(match_refunds, bool):
                raise CsvDataError("matchRefunds must be true or false")
            if source == "creditkarma" and (
                not isinstance(ignore_amazon, bool)
                or not isinstance(ignore_aliexpress, bool)
                or not isinstance(ignore_venmo, bool)
                or not isinstance(ignore_ebay, bool)
                or not isinstance(ignore_walmart, bool)
            ):
                raise CsvDataError("Credit Karma ignore options must be true or false")
            filter_date_range = payload.get("filterDateRange", True)
            if source == "applecard" and not isinstance(filter_date_range, bool):
                raise CsvDataError("Apple Card filterDateRange must be true or false")

            account_identity: tuple[str, str, str] | None = None
            if source in IMPORT_ACCOUNT_DEFAULTS:
                defaults = IMPORT_ACCOUNT_DEFAULTS[source]
                values = tuple(
                    payload.get(field, default)
                    for field, default in zip(
                        ("accountName", "accountType", "provider"), defaults
                    )
                )
                if any(
                    not isinstance(value, str) or not value.strip()
                    for value in values
                ):
                    raise CsvDataError("Import account fields must be non-empty text")
                if any(len(value.strip()) > 200 for value in values):
                    raise CsvDataError("Import account fields cannot exceed 200 characters")
                account_identity = tuple(value.strip() for value in values)

            self.prune_amazon_import_sessions()
            token = secrets.token_urlsafe(32)
            now = time.time()
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            waiting_status = (
                "waiting_for_file" if source == "applecard" else "waiting_for_extension"
            )
            waiting_message = (
                "Waiting for the Apple Card CSV."
                if source == "applecard"
                else f"Waiting for the {source_label} importer extension."
            )
            session: dict[str, Any] = {
                "source": source,
                "matchRefunds": match_refunds,
                "status": waiting_status,
                "progress": 0,
                "message": waiting_message,
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "createdAt": now,
                "updatedAt": now,
            }
            if source == "creditkarma":
                session.update(
                    ignoreAmazon=ignore_amazon,
                    ignoreAliExpress=ignore_aliexpress,
                    ignoreVenmo=ignore_venmo,
                    ignoreEbay=ignore_ebay,
                    ignoreWalmart=ignore_walmart,
                )
            elif account_identity is not None:
                session.update(
                    accountName=account_identity[0],
                    accountType=account_identity[1],
                    provider=account_identity[2],
                )
                if source == "applecard":
                    session["filterDateRange"] = filter_date_range
            with self.amazon_import_lock:
                self.amazon_import_sessions[token] = session
            response = self.public_amazon_import_session(session)
            response["token"] = token
            self.send_json(HTTPStatus.CREATED, response)
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def create_csv_import_session(self) -> None:
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            content = payload.get("content")
            if not isinstance(content, str):
                raise CsvDataError("CSV content is required")
            apply_saved_classifications = payload.get("applyClassifications", True)
            match_refunds = payload.get("matchRefunds", True)
            if not isinstance(match_refunds, bool):
                raise CsvDataError("matchRefunds must be true or false")
            if not isinstance(apply_saved_classifications, bool):
                raise CsvDataError("applyClassifications must be a boolean")
            parsed_transactions, row_count, invalid_rows = parse_ledger_import_csv(content)

            with self.data_lock:
                if apply_saved_classifications:
                    parsed_transactions, classification_matches = classify_transactions(
                        parsed_transactions, load_classifications(self.csv_path)
                    )
                else:
                    classification_matches = [True] * len(parsed_transactions)
                if self.csv_path.exists():
                    existing, baseline_revision = read_transaction_state(self.csv_path)
                else:
                    existing, baseline_revision = [], MISSING_CSV_REVISION
                preview, new_count, duplicate_count = preview_imported_transactions(
                    existing, parsed_transactions, "csv", classification_matches
                )

            refund_credits = refunds.import_credits(preview, match_refunds)
            import_refund_review(existing, preview, refund_credits, [])
            result = {
                "rowCount": row_count,
                **import_transfer_review(existing, preview, baseline_revision),
                "parsed": len(preview),
                "invalid": len(invalid_rows),
                "invalidRows": invalid_rows[:100],
                "new": new_count,
                "duplicates": duplicate_count,
                "classificationsApplied": apply_saved_classifications,
                "transactions": preview,
                "sources": {
                    "csv": {
                        "rowCount": row_count,
                        "parsed": len(preview),
                        "invalid": len(invalid_rows),
                        "new": new_count,
                        "duplicates": duplicate_count,
                    }
                },
                "revision": baseline_revision,
            }
            self.prune_amazon_import_sessions()
            token = secrets.token_urlsafe(32)
            now = time.time()
            session: dict[str, Any] = {
                "source": "csv",
                "matchRefunds": match_refunds,
                "refundCredits": refund_credits,
                "status": "review",
                "progress": 98,
                "message": f"Review {len(preview)} valid CSV transactions.",
                "startDate": "",
                "endDate": "",
                "createdAt": now,
                "updatedAt": now,
                "baselineRevision": baseline_revision,
                "stagedIds": {transaction["_stagedId"] for transaction in preview},
                "import": result,
            }
            with self.amazon_import_lock:
                self.amazon_import_sessions[token] = session
            response = self.public_amazon_import_session(session)
            response["token"] = token
            self.send_json(HTTPStatus.CREATED, response)
        except (CsvDataError, OSError) as exc:
            status = (
                HTTPStatus.INTERNAL_SERVER_ERROR
                if isinstance(exc, OSError)
                else HTTPStatus.BAD_REQUEST
            )
            self.send_json(status, {"error": str(exc)})

    def get_backups(self) -> None:
        try:
            with self.data_lock:
                backups = list_backups(self.csv_path)
            self.send_json(HTTPStatus.OK, {"backups": backups})
        except (CsvDataError, OSError) as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not list backups: {exc}"},
            )

    def get_transactions_export(self, query: Mapping[str, list[str]]) -> None:
        start_date = query.get("startDate", [""])[0]
        end_date = query.get("endDate", [""])[0]
        try:
            with self.data_lock:
                transactions, _revision = read_transaction_state(self.csv_path)
                body, transaction_count = transaction_export_csv(
                    transactions, start_date, end_date
                )
            filename = f"ledger-transactions_{start_date}_to_{end_date}.csv"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
            self.send_header("X-Ledger-Transaction-Count", str(transaction_count))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except CsvFileMissingError as exc:
            self.send_json(
                HTTPStatus.NOT_FOUND,
                {"code": "transaction_file_missing", "error": str(exc)},
            )
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not export transactions: {exc}"},
            )

    def get_import_history(self) -> None:
        try:
            with self.data_lock:
                if self.csv_path.exists():
                    transactions, revision = read_transaction_state(self.csv_path)
                else:
                    transactions, revision = [], MISSING_CSV_REVISION
            self.send_json(
                HTTPStatus.OK,
                {"imports": import_history(transactions), "revision": revision},
            )
        except (CsvDataError, OSError) as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not load import history: {exc}"},
            )

    def get_import_batch(self, created_at: str) -> None:
        try:
            normalized_created_at = normalize_created_at(created_at, "import batch timestamp")
            if not normalized_created_at:
                raise CsvDataError("import batch timestamp is required")
            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                state = public_state(transactions, revision)
            imported_transactions = [
                transaction
                for transaction in state["transactions"]
                if transaction["createdAt"] == normalized_created_at
            ]
            if not imported_transactions:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "import batch no longer exists"})
                return
            self.send_json(
                HTTPStatus.OK,
                {
                    "createdAt": normalized_created_at,
                    "transactions": imported_transactions,
                    "revision": revision,
                },
            )
        except CsvFileMissingError as exc:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not load imported transactions: {exc}"},
            )

    def delete_import_batch(self, created_at: str) -> None:
        try:
            payload = self.read_json_body()
            if payload.get("confirm") is not True:
                raise CsvDataError("confirmation is required to remove an imported batch")
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")
            normalized_created_at = normalize_created_at(created_at, "import batch timestamp")
            if not normalized_created_at:
                raise CsvDataError("import batch timestamp is required")

            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict(
                        "The transaction file changed after import history loaded. Refresh and try again."
                    )
                retained = [
                    transaction
                    for transaction in transactions
                    if transaction["createdAt"] != normalized_created_at
                ]
                retained = reconciliation.unlink_deleted(transactions, retained)
                removed_count = len(transactions) - len(retained)
                if removed_count == 0:
                    self.send_json(HTTPStatus.NOT_FOUND, {"error": "import batch no longer exists"})
                    return
                safety_backup = create_backup_copy(self.csv_path)
                write_transactions_atomic(self.csv_path, retained)
                saved_transactions, saved_revision = read_transaction_state(self.csv_path)

            self.send_json(
                HTTPStatus.OK,
                {
                    "removedCount": removed_count,
                    "safetyBackup": safety_backup,
                    "imports": import_history(saved_transactions),
                    "revision": saved_revision,
                },
            )
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvFileMissingError as exc:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not remove imported transactions: {exc}"},
            )

    def get_classifications(self, *, export: bool = False) -> None:
        try:
            with self.data_lock:
                document = load_classifications(self.csv_path, for_editing=True)
            if not export:
                self.send_json(HTTPStatus.OK, document)
                return
            body = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header(
                "Content-Disposition", 'attachment; filename="ledger-classifications.json"'
            )
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (CsvDataError, OSError) as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not load classifications: {exc}"},
            )

    def get_taxonomy(self) -> None:
        try:
            with self.data_lock:
                document = load_taxonomy(self.csv_path)
                revision = taxonomy_revision(self.csv_path)
                try:
                    transactions, _transaction_revision = read_transaction_state(self.csv_path)
                except CsvFileMissingError:
                    transactions = []
                response = taxonomy_summary(transactions, document)
                response["revision"] = revision
            self.send_json(HTTPStatus.OK, response)
        except (CsvDataError, OSError) as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not load taxonomy: {exc}"},
            )

    def put_taxonomy(self) -> None:
        try:
            payload = self.read_json_body()
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("taxonomy revision is required")
            normalized = normalize_taxonomy(payload)
            with self.data_lock:
                if taxonomy_revision(self.csv_path) != expected_revision:
                    raise RevisionConflict(
                        "The taxonomy changed after it loaded. Refresh and try again."
                    )
                write_taxonomy_atomic(self.csv_path, normalized)
                revision = taxonomy_revision(self.csv_path)
                try:
                    transactions, _transaction_revision = read_transaction_state(self.csv_path)
                except CsvFileMissingError:
                    transactions = []
                response = taxonomy_summary(transactions, normalized)
                response["revision"] = revision
            self.send_json(HTTPStatus.OK, response)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not save taxonomy: {exc}"},
            )

    def put_classifications(self) -> None:
        try:
            payload = self.read_json_body()
            normalized = normalize_classifications(payload)
            with self.data_lock:
                write_classifications_atomic(self.csv_path, normalized)
            self.send_json(HTTPStatus.OK, normalized)
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not save classifications: {exc}"},
            )

    def apply_classifications_to_existing_transactions(self) -> None:
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            if payload.get("confirm") is not True:
                raise CsvDataError("classification confirmation is required")
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")
            document = normalize_classifications(payload.get("document"))
            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict(
                        "The transaction file changed after this preview was created. Review the changes again."
                    )
                classified = apply_classifications(transactions, document)
                allowed_override_ids = {
                    index for index, (before, after) in enumerate(zip(transactions, classified))
                    if classification_changed_fields(before, after)
                }
                overrides = payload.get("overrides", [])
                if not isinstance(overrides, list):
                    raise CsvDataError("classification overrides must be a list")
                seen_override_ids = set()
                override_rows = []
                for override in overrides:
                    if not isinstance(override, dict):
                        raise CsvDataError("classification override must be an object")
                    transaction_id = override.get("_id")
                    if (isinstance(transaction_id, bool) or not isinstance(transaction_id, int)
                            or transaction_id not in allowed_override_ids or transaction_id in seen_override_ids):
                        raise CsvDataError("classification override has an invalid transaction ID")
                    seen_override_ids.add(transaction_id)
                    updated = normalize_transaction(override.get("transaction"), "classification override")
                    updated["createdAt"] = transactions[transaction_id]["createdAt"]
                    updated["id"] = transactions[transaction_id]["id"]
                    updated["links"] = transactions[transaction_id].get("links", "")
                    override_rows.append(updated)
                    classified[transaction_id] = updated
                canonicalize_new_groups(override_rows, transactions)
                try:
                    reconciliation.validate_mutation(transactions, classified)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                changed = sum(
                    1
                    for before, after in zip(transactions, classified)
                    if any(before.get(column, "") != after.get(column, "") for column in COLUMNS)
                )
                backup = None
                if changed:
                    backup = create_backup_copy(self.csv_path)
                write_classifications_atomic(self.csv_path, document)
                if changed:
                    write_transactions_atomic(self.csv_path, classified)
                    _saved, revision = read_transaction_state(self.csv_path)
            self.send_json(
                HTTPStatus.OK,
                {
                    "total": len(transactions),
                    "changed": changed,
                    "revision": revision,
                    "backup": backup,
                    "classifications": document["classifications"],
                },
            )
        except CsvFileMissingError:
            self.send_json(
                HTTPStatus.NOT_FOUND,
                {
                    "code": "transaction_file_missing",
                    "error": "There is no transaction file to classify.",
                },
            )
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not classify existing transactions: {exc}"},
            )

    def preview_existing_transaction_classifications(self) -> None:
        try:
            document = normalize_classifications(self.read_json_body())
            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                classified, match_status = classify_transactions(transactions, document)
                try:
                    reconciliation.validate_mutation(transactions, classified)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
            before_public = public_state(transactions, revision)["transactions"]
            after_public = public_state(classified, revision)["transactions"]
            changes = []
            for index, (before, after) in enumerate(zip(transactions, classified)):
                changed_fields = classification_changed_fields(before, after)
                if not changed_fields:
                    continue
                changes.append(
                    {
                        "beforeTransaction": before_public[index],
                        "transaction": after_public[index],
                        "_id": index,
                        "date": before["date"],
                        "description": before["description"],
                        "amount": before["amount"],
                        "accountName": before["accountName"],
                        "provider": before["provider"],
                        "before": classification_action_values(before),
                        "after": classification_action_values(after),
                        "changedFields": changed_fields,
                    }
                )
            changes.sort(
                key=lambda transaction: (
                    transaction["date"],
                    transaction["description"].casefold(),
                    transaction["_id"],
                ),
                reverse=True,
            )
            self.send_json(
                HTTPStatus.OK,
                {
                    "total": len(transactions),
                    "matched": sum(match_status),
                    "changed": len(changes),
                    "changes": changes,
                    "revision": revision,
                },
            )
        except CsvFileMissingError:
            self.send_json(
                HTTPStatus.NOT_FOUND,
                {
                    "code": "transaction_file_missing",
                    "error": "There is no transaction file to classify.",
                },
            )
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not preview classifications: {exc}"},
            )

    def create_backup(self) -> None:
        try:
            # Require a JSON object so browser requests cannot trigger a backup
            # through a cross-origin form submission.
            self.read_json_body()
            with self.data_lock:
                backup = create_backup_copy(self.csv_path)
            self.send_json(HTTPStatus.CREATED, {"backup": backup})
        except CsvFileMissingError:
            self.send_json(
                HTTPStatus.NOT_FOUND,
                {"code": "transaction_file_missing", "error": "There is no transaction file to back up."},
            )
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except (CsvDataError, OSError) as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not create backup: {exc}"},
            )

    def restore_backup(self, filename: str) -> None:
        try:
            payload = self.read_json_body()
            if payload.get("confirm") is not True:
                raise CsvDataError("restore confirmation is required")
            if not valid_backup_filename(filename):
                raise CsvDataError("invalid backup name")
            selected_path = backup_directory(self.csv_path) / filename
            if selected_path.parent.resolve() != backup_directory(self.csv_path).resolve():
                raise CsvDataError("invalid backup path")
            if selected_path.is_symlink():
                raise CsvDataError("backup links cannot be restored")

            with self.data_lock:
                restored_transactions = read_backup_transactions(selected_path)
                try:
                    restored_transactions = reconciliation.migrate_legacy_pairs(restored_transactions)
                    reconciliation.validate(restored_transactions)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                safety_backup = (
                    create_backup_copy(self.csv_path, require_valid=False)
                    if self.csv_path.exists()
                    else None
                )
                self.csv_path.parent.mkdir(parents=True, exist_ok=True)
                write_transactions_atomic(self.csv_path, restored_transactions)
                transactions, revision = read_transaction_state(self.csv_path)
            response = {
                "revision": revision,
                "transactionCount": len(transactions),
                "restoredBackup": backup_metadata(selected_path),
                "safetyBackup": safety_backup,
            }
            self.send_json(HTTPStatus.OK, response)
        except CsvFileMissingError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Backup not found."})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not restore backup: {exc}"},
            )

    def rename_backup(self, filename: str) -> None:
        try:
            payload = self.read_json_body()
            requested_name = payload.get("newName")
            if not isinstance(requested_name, str):
                raise CsvDataError("newName must be a string")
            new_name = requested_name.strip()
            if new_name and not new_name.casefold().endswith(".csv"):
                new_name += ".csv"
            if not valid_backup_filename(filename) or not valid_backup_filename(new_name):
                raise CsvDataError("invalid backup name")

            directory = backup_directory(self.csv_path)
            selected_path = directory / filename
            renamed_path = directory / new_name
            if (
                selected_path.parent.resolve() != directory.resolve()
                or renamed_path.parent.resolve() != directory.resolve()
            ):
                raise CsvDataError("invalid backup path")
            if selected_path.is_symlink():
                raise CsvDataError("backup links cannot be renamed")

            with self.data_lock:
                if not selected_path.is_file():
                    raise CsvFileMissingError(f"backup does not exist: {selected_path}")
                if selected_path.name == renamed_path.name:
                    renamed = backup_metadata(selected_path)
                else:
                    destination_is_source = False
                    if renamed_path.exists():
                        try:
                            destination_is_source = selected_path.samefile(renamed_path)
                        except OSError:
                            destination_is_source = False
                        if not destination_is_source:
                            self.send_json(
                                HTTPStatus.CONFLICT,
                                {"error": f'A backup named "{new_name}" already exists.'},
                            )
                            return
                    selected_path.rename(renamed_path)
                    renamed = backup_metadata(renamed_path)
            self.send_json(HTTPStatus.OK, {"backup": renamed})
        except CsvFileMissingError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Backup not found."})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not rename backup: {exc}"},
            )

    def delete_backup(self, filename: str) -> None:
        try:
            payload = self.read_json_body()
            if payload.get("confirm") is not True:
                raise CsvDataError("delete confirmation is required")
            if not valid_backup_filename(filename):
                raise CsvDataError("invalid backup name")
            directory = backup_directory(self.csv_path)
            selected_path = directory / filename
            if selected_path.parent.resolve() != directory.resolve():
                raise CsvDataError("invalid backup path")
            if selected_path.is_symlink():
                raise CsvDataError("backup links cannot be deleted")

            with self.data_lock:
                if not selected_path.is_file():
                    raise CsvFileMissingError(f"backup does not exist: {selected_path}")
                selected_path.unlink()
            self.send_json(HTTPStatus.OK, {"deletedBackup": {"name": filename}})
        except CsvFileMissingError:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Backup not found."})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not delete backup: {exc}"},
            )

    def get_amazon_import_session(self, token: str, source: str = "amazon") -> None:
        self.prune_amazon_import_sessions()
        with self.amazon_import_lock:
            session = self.amazon_import_sessions.get(token)
            response = None
            if session is not None and session.get("source", "amazon") == source:
                response = self.public_amazon_import_session(session)
        if response is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Import session not found or expired."})
            return
        self.send_json(HTTPStatus.OK, response)

    def update_amazon_import_session(
        self, token: str, action: str, source: str = "amazon"
    ) -> None:
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            self.prune_amazon_import_sessions()
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None or session.get("source", "amazon") != source:
                    self.send_json(
                        HTTPStatus.NOT_FOUND, {"error": "Import session not found or expired."}
                    )
                    return
                if session["status"] in TERMINAL_IMPORT_STATUSES:
                    self.send_json(HTTPStatus.OK, self.public_amazon_import_session(session))
                    return

            if action == "complete":
                self.complete_amazon_import_session(token, payload, source=source)
                return
            if action == "commit":
                self.commit_amazon_import_session(token, payload, source=source)
                return

            now = time.time()
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None:
                    raise CsvDataError("Import session expired.")
                if action == "cancel":
                    source_label = IMPORT_SOURCE_LABELS.get(source, source)
                    session.pop("stagedIds", None)
                    session.pop("baselineRevision", None)
                    session.update(
                        status="cancelled",
                        progress=session["progress"],
                        message=f"{source_label} import cancelled.",
                        updatedAt=now,
                    )
                else:
                    raw_progress = payload.get("progress", session["progress"])
                    if isinstance(raw_progress, bool) or not isinstance(raw_progress, (int, float)):
                        raise CsvDataError("progress must be a number")
                    progress = max(0, min(99, int(raw_progress)))
                    raw_status = payload.get("status", "scraping")
                    allowed_statuses = {
                        "waiting_for_amazon",
                        "opening_amazon",
                        "waiting_for_credit_karma",
                        "opening_credit_karma",
                        "waiting_for_aliexpress",
                        "opening_aliexpress",
                        "waiting_for_venmo",
                        "opening_venmo",
                        "waiting_for_apple_card",
                        "opening_apple_card",
                        "waiting_for_ebay",
                        "opening_ebay",
                        "waiting_for_walmart",
                        "opening_walmart",
                        "opening_capitalone",
                        "waiting_for_capitalone",
                        "opening_schwab",
                        "waiting_for_schwab",
                        "scraping",
                        "importing",
                        "error",
                    }
                    if raw_status not in allowed_statuses:
                        raise CsvDataError("unsupported import status")
                    source_label = IMPORT_SOURCE_LABELS.get(source, source)
                    raw_message = payload.get("message", f"Importing {source_label} transactions.")
                    if not isinstance(raw_message, str) or not raw_message.strip():
                        raise CsvDataError("message cannot be blank")
                    session.update(
                        status=raw_status,
                        progress=progress,
                        message=raw_message.strip()[:500],
                        updatedAt=now,
                    )
                response = self.public_amazon_import_session(session)
            self.send_json(HTTPStatus.OK, response)
        except (CsvDataError, ImportDataError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def complete_amazon_import_session(
        self, token: str, payload: Mapping[str, Any], source: str = "amazon"
    ) -> None:
        content = payload.get("content")
        if not isinstance(content, str) or not content.strip():
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            raise CsvDataError(f"{source_label} export content is required")

        try:
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token, {})
                account_identity = (
                    session.get("accountName", ""),
                    session.get("accountType", ""),
                    session.get("provider", ""),
                )
            warnings: list[str] = []
            if source == "creditkarma":
                with self.amazon_import_lock:
                    session = self.amazon_import_sessions.get(token, {})
                    ignore_amazon = session.get("ignoreAmazon", True)
                    ignore_aliexpress = session.get("ignoreAliExpress", True)
                    ignore_venmo = session.get("ignoreVenmo", True)
                    ignore_ebay = session.get("ignoreEbay", True)
                    ignore_walmart = session.get("ignoreWalmart", True)
                    match_refunds = session.get("matchRefunds", True)
                credit_karma = parse_credit_karma(
                    content,
                    ignore_amazon=ignore_amazon,
                    ignore_aliexpress=ignore_aliexpress,
                    ignore_venmo=ignore_venmo,
                    ignore_ebay=ignore_ebay,
                    ignore_walmart=ignore_walmart,
                    match_refunds=match_refunds,
                )
                parsed_transactions = credit_karma.transactions
            elif source == "aliexpress":
                credit_karma = None
                parsed_transactions = parse_aliexpress(content, account_identity)
            elif source == "venmo":
                credit_karma = None
                parsed_transactions = parse_venmo(content, account_identity)
                with self.amazon_import_lock:
                    session = self.amazon_import_sessions.get(token, {})
                    start_date = session.get("startDate", "")
                    end_date = session.get("endDate", "")
                parsed_transactions = [
                    transaction
                    for transaction in parsed_transactions
                    if start_date <= transaction["date"] <= end_date
                ]
            elif source == "applecard":
                credit_karma = None
                parsed_transactions = parse_apple_card(content, account_identity)
                with self.amazon_import_lock:
                    session = self.amazon_import_sessions.get(token, {})
                    start_date = session.get("startDate", "")
                    end_date = session.get("endDate", "")
                    filter_date_range = session.get("filterDateRange", True)
                if filter_date_range:
                    parsed_transactions = [
                        transaction
                        for transaction in parsed_transactions
                        if start_date <= transaction["date"] <= end_date
                    ]
            elif source == "walmart":
                credit_karma = None
                parsed_transactions, warnings = parse_walmart(
                    content, account_identity,
                    start_date=session["startDate"], end_date=session["endDate"],
                )
            elif source == "schwab":
                credit_karma = None
                parsed_transactions, warnings = parse_schwab_checking(content, account_identity)
                parsed_transactions = [
                    transaction for transaction in parsed_transactions
                    if session["startDate"] <= transaction["date"] <= session["endDate"]
                ]
            elif source == "capitalone":
                credit_karma = None
                parsed_transactions = [
                    transaction for transaction in parse_capital_one(content, account_identity)
                    if session["startDate"] <= transaction["date"] <= session["endDate"]
                ]
            elif source == "ebay":
                credit_karma = None
                parsed_transactions = parse_ebay(content, account_identity)
                with self.amazon_import_lock:
                    session = self.amazon_import_sessions.get(token, {})
                    start_date = session.get("startDate", "")
                    end_date = session.get("endDate", "")
                parsed_transactions = [
                    transaction
                    for transaction in parsed_transactions
                    if start_date <= transaction["date"] <= end_date
                ]
            else:
                credit_karma = None
                parsed_transactions = parse_amazon(content, amazon_account=account_identity)
            parsed_transactions = [
                normalize_imported_transaction(transaction, f"{source} transaction")
                for transaction in parsed_transactions
            ]
            with self.data_lock:
                parsed_transactions, classification_matches = classify_transactions(
                    parsed_transactions, load_classifications(self.csv_path)
                )
                if self.csv_path.exists():
                    existing, baseline_revision = read_transaction_state(self.csv_path)
                else:
                    existing, baseline_revision = [], MISSING_CSV_REVISION
                preview, new_count, duplicate_count = preview_imported_transactions(
                    existing, parsed_transactions, source, classification_matches
                )

            refund_credits = refunds.import_credits(preview, session.get("matchRefunds", True))
            import_refund_review(existing, preview, refund_credits, [])

            result = {
                "parsed": len(preview),
                **import_transfer_review(existing, preview, baseline_revision),
                "new": new_count,
                "duplicates": duplicate_count,
                "transactions": preview,
                "sources": {
                    source: {
                        "parsed": len(preview),
                        "new": new_count,
                        "duplicates": duplicate_count,
                    }
                },
                "revision": baseline_revision,
            }
            if credit_karma is not None:
                result["sources"][source]["walmartTransactionsIgnored"] = (
                    credit_karma.ignored_walmart_count
                )
                result["sources"][source]["amazonTransactionsIgnored"] = (
                    credit_karma.ignored_amazon_count
                )
                result["sources"][source]["aliExpressTransactionsIgnored"] = (
                    credit_karma.ignored_aliexpress_count
                )
                result["sources"][source]["venmoTransactionsIgnored"] = (
                    credit_karma.ignored_venmo_count
                )
                result["sources"][source]["ebayTransactionsIgnored"] = (
                    credit_karma.ignored_ebay_count
                )
            if warnings:
                if source == "walmart":
                    result["skippedOrders"] = len(warnings)
                result["warnings"] = warnings[:100]
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            with self.amazon_import_lock:
                session = self.amazon_import_sessions[token]
                # Cancellation can arrive while the source parser is running.
                # Never reopen that review or replace another terminal result.
                if session["status"] in TERMINAL_IMPORT_STATUSES:
                    self.send_json(HTTPStatus.OK, self.public_amazon_import_session(session))
                    return
                session.update(
                    status="review",
                    progress=98,
                    message=f"Review {len(preview)} parsed {source_label} transactions.",
                    updatedAt=time.time(),
                    baselineRevision=baseline_revision,
                    stagedIds={transaction["_stagedId"] for transaction in preview},
                    refundCredits=refund_credits,
                    **{"import": result},
                )
                response = self.public_amazon_import_session(session)
            self.send_json(HTTPStatus.OK, response)
        except (CsvDataError, ImportDataError, OSError) as exc:
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is not None and session["status"] not in TERMINAL_IMPORT_STATUSES:
                    session.update(
                        status="error",
                        progress=session["progress"],
                        message=str(exc)[:500],
                        updatedAt=time.time(),
                    )
            if isinstance(exc, OSError):
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            else:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def commit_amazon_import_session(
        self, token: str, payload: Mapping[str, Any], source: str = "amazon"
    ) -> None:
        try:
            selected = payload.get("transactions")
            if not isinstance(selected, list):
                raise CsvDataError("transactions must be a list")

            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None or session.get("source", "amazon") != source:
                    raise CsvDataError("Import session not found or expired.")
                if session.get("status") != "review":
                    raise CsvDataError("Import session is not awaiting review.")
                valid_staged_ids = set(session.get("stagedIds", set()))
                baseline_revision = session.get("baselineRevision")

            staged_ids: set[int] = set()
            additions: list[dict[str, Any]] = []
            for index, raw_transaction in enumerate(selected):
                if not isinstance(raw_transaction, Mapping):
                    raise CsvDataError(f"transactions[{index}] must be an object")
                staged_id = raw_transaction.get("_stagedId")
                if (
                    isinstance(staged_id, bool)
                    or not isinstance(staged_id, int)
                    or staged_id not in valid_staged_ids
                    or staged_id in staged_ids
                ):
                    raise CsvDataError(f"transactions[{index}] has an invalid staged ID")
                staged_ids.add(staged_id)
                additions.append(
                    normalize_imported_transaction(
                        raw_transaction, f"transactions[{index}]"
                    )
                )

            additions = [row for _, row in sorted(zip(
                [row["_stagedId"] for row in selected], additions
            ))]

            with self.data_lock, self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None or session.get("status") != "review":
                    raise CsvDataError("Import session is no longer awaiting review.")
                if self.csv_path.exists():
                    existing, revision = read_transaction_state(self.csv_path)
                    if revision != baseline_revision:
                        raise RevisionConflict(
                            "The transaction file changed during review. Start the import again."
                        )
                else:
                    if baseline_revision != MISSING_CSV_REVISION:
                        raise RevisionConflict(
                            "The transaction file changed during review. Start the import again."
                        )
                    existing = []

                try:
                    refund_existing, refund_choices = refunds.apply(
                        existing, session.get("refundCredits", {}), payload.get("refundSelections", []), staged_ids
                    )
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                updated, pair_ids, transfer_digest = transfer_plan(
                    refund_existing + additions, baseline_revision, len(existing), excluded_ids=set(refund_choices.values())
                )
                if any(reconciliation.links(updated[index]) for index in refund_choices.values()):
                    raise CsvDataError("Each refund and each purchase can be matched only once")
                purchases_refunded = new_refund_link_count(existing, updated) + len(refund_choices)
                reviewed_credits = session.get("reviewedRefundCredits", {})
                if refund_choices and set(reviewed_credits) != set(refund_choices):
                    raise RevisionConflict("Review the refund choices again before importing.")
                transfer_digest = refund_proposal_digest(transfer_digest, reviewed_credits if refund_choices else {})
                # A transfer proposal can affect existing rows. Never accept an unseen
                # proposal (including one changed by deselection, editing or duplicates).
                if pair_ids and payload.get("transferPlan") != transfer_digest:
                    raise RevisionConflict("Transfer matches changed. Review the selected transactions again before importing.")
                if refund_choices and payload.get("transferPlan") != transfer_digest:
                    raise RevisionConflict("Refund matches changed. Review the selected transactions again before importing.")
                if any("repaymentTo" in row or "linkTo" in row or reconciliation.links(row)
                       for row in additions) and payload.get("transferPlan") != transfer_digest:
                    raise RevisionConflict("Review the transaction links before confirming this import.")
                if (any(reconciliation.links(row) for row in session.get("import", {}).get("transactions", []))
                        and payload.get("transferPlan") != transfer_digest):
                    raise RevisionConflict("Review the complete linked selection before confirming this import.")
                if payload.get("transferPlan") is not None and payload["transferPlan"] != transfer_digest:
                    raise RevisionConflict("The import review changed. Review it again before importing.")
                existing_update_count = sum(index < len(existing) for index in pair_ids)
                fresh_database = not self.csv_path.exists()
                if additions or refund_choices:
                    # Future refunds retain the real credit and link it to the
                    # purchase. Only pre-upgrade refunds use virtual receipts.
                    for staged_id, purchase_index in refund_choices.items():
                        credit = normalize_imported_transaction(reviewed_credits[staged_id], "refund credit")
                        credit = reconciliation.identified([credit], f"{token}:{staged_id}")[0]
                        updated[purchase_index]["flags"] = existing[purchase_index]["flags"]
                        updated.append(credit)
                        try:
                            updated = reconciliation.set_links(updated, updated[purchase_index]["id"],
                                [{"transactionId": credit["id"], "type": "refund"}])
                        except ValueError as exc:
                            raise CsvDataError(str(exc)) from exc
                    try:
                        reconciliation.validate(updated)
                    except ValueError as exc:
                        raise CsvDataError(str(exc)) from exc
                    if not fresh_database:
                        create_backup_copy(self.csv_path)
                    additions = updated[len(existing):]
                    existing = updated[:len(existing)]
                    canonicalize_new_groups(additions, existing)
                    stamp_imported_transactions(additions)
                    existing.extend(additions)
                    existing.sort(key=lambda row: (row["date"], row["description"].casefold()))
                    self.csv_path.parent.mkdir(parents=True, exist_ok=True)
                    write_transactions_atomic(self.csv_path, existing)
                    if fresh_database:
                        acknowledge_transfer_review(self.csv_path)

                if self.csv_path.exists():
                    saved_transactions, saved_revision = read_transaction_state(self.csv_path)
                    committed = imported_transaction_state(saved_transactions, additions)
                else:
                    saved_revision = MISSING_CSV_REVISION
                    committed = []
                session.update(status="complete", progress=100, **{"import": {
                    "committed": len(additions), "transactions": committed,
                    "revision": saved_revision, "existingTransfersUpdated": existing_update_count,
                    "purchasesRefunded": purchases_refunded,
                }})

            result = {
                "committed": len(additions),
                "existingTransfersUpdated": existing_update_count,
                "purchasesRefunded": purchases_refunded,
                "transactions": committed,
                "revision": saved_revision,
            }
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            with self.amazon_import_lock:
                session = self.amazon_import_sessions[token]
                session.pop("stagedIds", None)
                session.pop("baselineRevision", None)
                session.pop("refundCredits", None)
                session.update(
                    status="complete",
                    progress=100,
                    message=f"Imported {len(additions)} {source_label} transactions.",
                    updatedAt=time.time(),
                    **{"import": result},
                )
                response = self.public_amazon_import_session(session)
            self.send_json(HTTPStatus.OK, response)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except (CsvDataError, OSError) as exc:
            status = HTTPStatus.INTERNAL_SERVER_ERROR if isinstance(exc, OSError) else HTTPStatus.BAD_REQUEST
            self.send_json(status, {"error": str(exc)})

    def mutate_transactions(self, action: str, transaction_id: int | None = None) -> None:
        try:
            payload = self.read_json_body()
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")

            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict(
                        "The transaction file changed after this page loaded. Reload and try again."
                    )

                original_transactions = list(transactions)
                if action == "create":
                    created = normalize_transaction(payload.get("transaction"), "transaction")
                    created["createdAt"] = ""
                    created["id"] = secrets.token_hex(16)
                    canonicalize_new_groups([created], transactions)
                    transactions.append(created)
                    response_status = HTTPStatus.CREATED
                else:
                    if transaction_id is None or not 0 <= transaction_id < len(transactions):
                        raise CsvDataError("transaction no longer exists")
                    if action == "update":
                        updated = normalize_transaction(
                            payload.get("transaction"), "transaction"
                        )
                        updated["createdAt"] = transactions[transaction_id]["createdAt"]
                        updated["id"] = transactions[transaction_id]["id"]
                        updated["links"] = transactions[transaction_id].get("links", "")
                        if "group" not in payload.get("transaction", {}):
                            updated["group"] = transactions[transaction_id].get("group", "")
                        canonicalize_new_groups([updated], transactions)
                        transactions[transaction_id] = updated
                        if "links" in payload.get("transaction", {}):
                            try:
                                transactions = reconciliation.set_links(transactions, updated["id"],
                                    reconciliation.links(payload["transaction"]))
                            except ValueError as exc:
                                raise CsvDataError(str(exc)) from exc
                    elif action == "delete":
                        previous_transactions = list(transactions)
                        del transactions[transaction_id]
                        transactions = reconciliation.unlink_deleted(previous_transactions, transactions)
                    else:
                        raise CsvDataError("unsupported transaction action")
                    response_status = HTTPStatus.OK

                try:
                    transactions = reconciliation.apply_repayment_targets(transactions)
                    transactions.sort(key=lambda row: (row["date"], row["description"].casefold()))
                    reconciliation.validate_mutation(original_transactions, transactions)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                create_backup_copy(self.csv_path)
                write_transactions_atomic(self.csv_path, transactions)
                saved_transactions, saved_revision = read_transaction_state(self.csv_path)
            self.send_json(response_status, public_state(saved_transactions, saved_revision))
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not update {self.csv_path}: {exc}"},
            )

    def refresh_staged_preview(self) -> None:
        """Recheck edited import rows without changing the file or import selection."""
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            rows = payload.get("transactions")
            if not isinstance(rows, list) or len(rows) > 50_000:
                raise CsvDataError("transactions must be a list of at most 50000 rows")
            ids = [row.get("_stagedId") if isinstance(row, Mapping) else None for row in rows]
            if any(isinstance(item, bool) or not isinstance(item, int) for item in ids) or len(set(ids)) != len(ids):
                raise CsvDataError("Staged IDs must be unique integers")
            if any("_selected" in row and not isinstance(row["_selected"], bool) for row in rows):
                raise CsvDataError("Import selection must be true or false")
            # Occurrence allocation follows source IDs, not a client's current display sort.
            rows = sorted(rows, key=lambda row: row["_stagedId"])
            ids = [row["_stagedId"] for row in rows]
            with self.data_lock:
                if self.csv_path.exists():
                    existing, revision = read_transaction_state(self.csv_path)
                else:
                    existing, revision = [], MISSING_CSV_REVISION
                if payload.get("revision") != revision:
                    raise RevisionConflict("The transaction file changed during review. Start the import again.")
                selected = {index for index, row in enumerate(rows) if row.get("_selected", True)}
                result, new, duplicates = preview_imported_transactions(
                    existing, rows, "review", [row.get("_classificationMatched") is not False for row in rows],
                    selected_ids=selected,
                )
                for row in result:
                    row["_selected"] = row["_stagedId"] in selected
                    row["_stagedId"] = ids[row["_stagedId"]]
                credits = {}
                token = payload.get("importToken")
                if token is not None:
                    if not isinstance(token, str):
                        raise CsvDataError("importToken must be text")
                    with self.amazon_import_lock:
                        session = self.amazon_import_sessions.get(token)
                        if not session or session.get("status") != "review" or session.get("baselineRevision") != revision:
                            raise CsvDataError("Import session is no longer awaiting this review")
                        if set(ids) != session.get("stagedIds"):
                            raise CsvDataError("Review must contain every original staged occurrence")
                        credits = session.get("refundCredits", {})
                refund_existing, choices = import_refund_review(existing, result, credits, payload.get("refundSelections", []))
                review = import_transfer_review(refund_existing, result, revision, set(choices.values()))
                reviewed_credits = {row["_stagedId"]: normalize_imported_transaction(row, "reviewed refund")
                                    for row in result if row["_stagedId"] in choices}
                review["transferPlan"] = refund_proposal_digest(review["transferPlan"], reviewed_credits)
                if token is not None:
                    with self.amazon_import_lock:
                        session = self.amazon_import_sessions.get(token)
                        if not session or session.get("status") != "review":
                            raise CsvDataError("Import session is no longer awaiting this review")
                        session["reviewedRefundCredits"] = reviewed_credits
                review["purchasesRefunded"] += len(choices)
            self.send_json(HTTPStatus.OK, {"transactions": result, "new": new, "duplicates": duplicates, **review})
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def review_internal_transfers(self, *, commit: bool) -> None:
        """Explicit all-dates scan and revision-bound review; no writes on preview."""
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            nonzero_decimal = payload.get("nonzeroDecimal", False)
            if not isinstance(nonzero_decimal, bool):
                raise CsvDataError("nonzeroDecimal must be a boolean")
            if commit and payload.get("confirm") is not True:
                raise CsvDataError("Explicit transfer-review confirmation is required.")
            overrides = payload.get("overrides", [])
            if not isinstance(overrides, list) or len(overrides) > 50_000:
                raise CsvDataError("overrides must be a list of at most 50000 transactions")
            with self.data_lock:
                if self.csv_path.exists():
                    existing, revision = read_transaction_state(self.csv_path)
                else:
                    existing, revision = [], MISSING_CSV_REVISION
                if (commit or overrides or "revision" in payload) and payload.get("revision") != revision:
                    raise RevisionConflict("The transaction file changed. Close this review and scan again.")
                working = [dict(row) for row in existing]
                seen = set()
                drafts = {}
                for raw in overrides:
                    index = raw.get("_id") if isinstance(raw, Mapping) else None
                    if (isinstance(index, bool) or not isinstance(index, int)
                            or index in seen or not 0 <= index < len(working)):
                        raise CsvDataError("Invalid transaction ID in transfer review")
                    seen.add(index)
                    working[index] = normalize_transaction(raw, "transaction")
                    working[index]["createdAt"] = existing[index]["createdAt"]
                    working[index]["id"] = existing[index]["id"]
                    if "links" not in raw:
                        working[index]["links"] = existing[index].get("links", "")
                    drafts[index] = dict(working[index])
                try:
                    for index in seen:
                        if working[index].get("links", "") != existing[index].get("links", ""):
                            entries = reconciliation.links(working[index])
                            working[index]["links"] = existing[index].get("links", "")
                            working = reconciliation.set_links(working, working[index]["id"], entries)
                    working = reconciliation.apply_repayment_targets(working)
                    reconciliation.validate_mutation(existing, working)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                canonicalize_new_groups([working[index] for index in seen], existing)
                updated, pair_ids, digest = transfer_plan(
                    working, revision, initial_review=transfer_review_required(self.csv_path),
                    nonzero_decimal=nonzero_decimal
                )
                include_refunds = payload.get("includeRefunds") is True or "/reconciliation/" in self.path
                choices = payload.get("refundLinks", [])
                if not isinstance(choices, list) or len(choices) > 50_000:
                    raise CsvDataError("refundLinks must be a list")
                suggestions = []
                if include_refunds:
                    consumed = {entry["transactionId"] for row in updated for entry in reconciliation.links(row)}
                    buckets = refunds.purchase_index(updated)
                    for index, credit in enumerate(updated):
                        if nonzero_decimal and reconciliation.cents(credit) % 100 == 0:
                            continue
                        if (credit["amount"] >= 0 or credit["id"] in consumed or reconciliation.links(credit)
                                or refunds.flags(credit) & {"refunded", "internal-transfer", "include-in-budget"}):
                            continue
                        candidates = refunds.candidates(updated, credit, buckets)
                        if candidates:
                            suggestions.append(dict(credit, _id=index, _refundCandidates=candidates))
                elif choices:
                    raise CsvDataError("Enable refund scanning before choosing a refund")
                available_matches = {row["id"]: {candidate["id"] for candidate in row["_refundCandidates"]} for row in suggestions}
                used_credits = set()
                try:
                    for choice in choices:
                        if not isinstance(choice, dict) or set(choice) != {"transactionId", "purchaseId"}:
                            raise ValueError("Each refund link needs a transactionId and purchaseId")
                        credit_id, purchase_id = choice["transactionId"], choice["purchaseId"]
                        if not isinstance(credit_id, str) or not isinstance(purchase_id, str):
                            raise ValueError("Refund link IDs must be text")
                        if credit_id in used_credits or purchase_id not in available_matches.get(credit_id, set()):
                            raise ValueError("This refund suggestion is no longer available; scan again")
                        used_credits.add(credit_id)
                        if reconciliation.links(next(row for row in updated if row["id"] == purchase_id)):
                            raise ValueError("A purchase can have only one refund")
                        updated = reconciliation.set_links(updated, purchase_id, [{"transactionId": credit_id, "type": "refund"}])
                    reconciliation.validate(updated)
                except ValueError as exc:
                    raise CsvDataError(str(exc)) from exc
                if include_refunds:
                    digest = hashlib.sha256(json.dumps({"revision": revision, "rows": updated, "refundLinks": choices},
                        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                digest = hashlib.sha256(f"{digest}:nonzeroDecimal={nonzero_decimal}".encode()).hexdigest()
                public_updated = public_state(updated, revision)["transactions"]
                for row in public_updated:
                    row["_reviewLinks"] = reconciliation.links(row)
                changes = []
                for index, (before, after) in enumerate(zip(existing, updated)):
                    fields = [field for field in COLUMNS if before.get(field, "") != after.get(field, "")]
                    if fields:
                        proposed = dict(public_updated[index])
                        # Keep inferred flags/links out of staged editor fields.
                        draft = drafts.get(index, existing[index])
                        proposed["flags"] = draft["flags"]
                        proposed["links"] = draft.get("links", "")
                        for field in ("linkTo", "repaymentTo"):
                            if field in draft:
                                proposed[field] = draft[field]
                        if index in pair_ids:
                            proposed.update(_isInternalTransfer=True, _isBillPayment=True,
                                            _internalTransferSource="automatic", _transferPair=pair_ids[index])
                        changes.append({"_id": index, "transaction": proposed,
                                        "before": before, "after": after, "changedFields": fields})
                if commit:
                    if payload.get("plan") != digest:
                        raise RevisionConflict("The proposed transfer changes changed. Review them again before saving.")
                    if changes:
                        create_backup_copy(self.csv_path)
                        write_transactions_atomic(self.csv_path, updated)
                        updated, revision = read_transaction_state(self.csv_path)
                    acknowledge_transfer_review(self.csv_path)
                    result = public_state(updated, revision)
                    result.update(changed=len(changes), transferPairs=len(pair_ids) // 2,
                                  refundsLinked=new_refund_link_count(existing, updated))
                else:
                    changed_ids = {entry["_id"] for entry in changes}
                    related_ids = set(used_credits)
                    for before, after in zip(existing, updated):
                        if reconciliation.links(before) != reconciliation.links(after):
                            related_ids.update(entry["transactionId"]
                                               for entry in reconciliation.links(before) + reconciliation.links(after))
                    linked_credit_rows = []
                    for row in public_updated:
                        if row["id"] not in related_ids or row["_id"] in changed_ids:
                            continue
                        proposed = dict(row)
                        draft = drafts.get(row["_id"], {})
                        for field in ("linkTo", "repaymentTo"):
                            if field in draft:
                                proposed[field] = draft[field]
                        linked_credit_rows.append(proposed)
                    result = {"revision": revision, "plan": digest, "changes": changes,
                              "transactions": [entry["transaction"] for entry in changes] + linked_credit_rows,
                              "alreadyFlagged": [public_updated[index]
                                                 for index, row in enumerate(existing)
                                                 if index not in changed_ids
                                                 and row["id"] not in related_ids
                                                 and (transfers.flags(row) & {"internal-transfer", "refunded"}
                                                      or row.get("links") or public_updated[index].get("_linkRole"))],
                              "refundSuggestions": [row for row in suggestions if row["id"] not in used_credits],
                              "refundLinks": choices,
                              "nonzeroDecimal": nonzero_decimal,
                              "transferPairs": len(pair_ids) // 2,
                              "initialReview": transfer_review_required(self.csv_path)}
            self.send_json(HTTPStatus.OK, result)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def save_transaction_flags(self) -> None:
        """Commit a list's follow-up toggles once, preserving all financial fields."""
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            if payload.get("confirm") is not True:
                raise CsvDataError("Explicit flag-save confirmation is required.")
            updates = payload.get("updates")
            if not isinstance(updates, list) or not 1 <= len(updates) <= 50_000:
                raise CsvDataError("updates must contain between 1 and 50000 flag changes")
            if any(not isinstance(item, dict) or set(item) != {"id", "flagged"}
                   or not isinstance(item["flagged"], bool) for item in updates):
                raise CsvDataError("Each flag update requires an id and a boolean flagged value")
            with self.data_lock:
                rows, revision = read_transaction_state(self.csv_path)
                if payload.get("revision") != revision:
                    raise RevisionConflict("The transaction file changed. Reload and review your flags again.")
                validate_transaction_ids(rows, [item["id"] for item in updates])
                updated = [dict(row) for row in rows]
                changed = 0
                for item in updates:
                    index = item["id"]
                    flags = transfers.flags(rows[index])
                    if ("flagged" in flags) == item["flagged"]:
                        continue
                    if item["flagged"]:
                        flags.add("flagged")
                    else:
                        flags.discard("flagged")
                    updated[index]["flags"] = ",".join(sorted(flags))
                    changed += 1
                backup = None
                if changed:
                    backup = create_backup_copy(self.csv_path)
                    write_transactions_atomic(self.csv_path, updated)
                    updated, revision = read_transaction_state(self.csv_path)
                result = public_state(updated, revision)
                result.update(changed=changed, backup=backup, imports=import_history(updated))
            self.send_json(HTTPStatus.OK, result)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvFileMissingError as exc:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Could not save flags: {exc}"})

    def bulk_delete_transactions(self) -> None:
        try:
            payload = self.read_json_body()
            if payload.get("confirm") is not True:
                raise CsvDataError("Explicit bulk-delete confirmation is required.")
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")
            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict("The transaction file changed. Cancel and reload the page before selecting transactions again.")
                ids = set(validate_transaction_ids(transactions, payload.get("ids")))
                # IDs refer to row occurrences, never date/amount or description matches.
                # Keep every unselected row and its persisted flags/timestamp unchanged.
                remaining = [row for index, row in enumerate(transactions) if index not in ids]
                remaining = reconciliation.unlink_deleted(transactions, remaining)
                backup = create_backup_copy(self.csv_path)
                write_transactions_atomic(self.csv_path, remaining)
                remaining, revision = read_transaction_state(self.csv_path)
                result = public_state(remaining, revision)
                result.update(deleted=len(ids), backup=backup, imports=import_history(remaining))
            self.send_json(HTTPStatus.OK, result)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvFileMissingError as exc:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Could not delete selected transactions: {exc}"})

    def bulk_edit_transactions(self, *, preview: bool) -> None:
        try:
            payload = self.read_json_body()
            if not preview and payload.get("confirm") is not True:
                raise CsvDataError("Explicit bulk-edit confirmation is required.")
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")
            with self.data_lock:
                transactions, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict("The transaction file changed. Close this review and refresh before selecting transactions again.")
                updated, edits = bulk_edit_result(transactions, payload.get("ids"), payload.get("changes"))
                if preview:
                    result = {"revision": revision, "changed": len(edits), "changes": edits}
                else:
                    backup = None
                    if edits:
                        backup = create_backup_copy(self.csv_path)
                        write_transactions_atomic(self.csv_path, updated)
                        updated, revision = read_transaction_state(self.csv_path)
                    result = public_state(updated, revision)
                    result.update(changed=len(edits), backup=backup)
            self.send_json(HTTPStatus.OK, result)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except CsvFileMissingError as exc:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Could not save bulk changes: {exc}"})

    def send_json(self, status: HTTPStatus, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static_file(self, path: Path) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message_format: str, *args: object) -> None:
        message = message_format % args
        message = re.sub(
            r"(/api/(?:amazon|creditkarma|aliexpress|venmo|applecard|ebay|walmart|capitalone|schwab|csv)-import-sessions/)[A-Za-z0-9_-]{32,}",
            r"\1[redacted]",
            message,
        )
        print(f"{self.address_string()} - {message}")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the budget dashboard")
    parser.add_argument("--host", default="127.0.0.1", help="Listening host")
    parser.add_argument("--port", type=int, default=8000, help="Listening port")
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV,
        help=f"Master transactions CSV (default: {DEFAULT_CSV})",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.csv.exists():
            migrate_transaction_schema(args.csv)
            read_transaction_state(args.csv)
    except CsvDataError as exc:
        print(f"error: {exc}")
        return 1

    server = ThreadingHTTPServer((args.host, args.port), BudgetRequestHandler)
    server.csv_path = args.csv.resolve()  # type: ignore[attr-defined]
    server.data_lock = threading.Lock()  # type: ignore[attr-defined]
    server.amazon_import_sessions = {}  # type: ignore[attr-defined]
    server.amazon_import_lock = threading.Lock()  # type: ignore[attr-defined]
    print(f"Budget dashboard: http://{args.host}:{args.port}")
    print(f"Reading and writing transactions at: {server.csv_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
