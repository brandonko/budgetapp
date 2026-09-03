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
from urllib.parse import unquote, urlparse

from importers import (
    ALIEXPRESS_DEFAULT_ACCOUNT,
    AMAZON_DEFAULT_ACCOUNT,
    APPLE_CARD_DEFAULT_ACCOUNT,
    EBAY_DEFAULT_ACCOUNT,
    ImportDataError,
    VENMO_DEFAULT_ACCOUNT,
    parse_aliexpress,
    parse_amazon,
    parse_apple_card,
    parse_credit_karma,
    parse_ebay,
    parse_venmo,
)


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent / "data"
COLUMNS = (
    "date",
    "description",
    "amount",
    "category",
    "accountName",
    "accountType",
    "provider",
    "notes",
    "flags",
    "createdAt",
)
DEFAULT_CSV = DATA_DIR / "transactions.csv"
LEGACY_COLUMNS = COLUMNS[:7]
NOTES_COLUMNS = COLUMNS[:8]
FLAGS_COLUMNS = COLUMNS[:9]
CREATED_AT_COLUMNS = COLUMNS[:8] + ("createdAt",)
COMPATIBLE_COLUMNS = (COLUMNS, FLAGS_COLUMNS, CREATED_AT_COLUMNS, NOTES_COLUMNS, LEGACY_COLUMNS)
REQUIRED_TEXT_COLUMNS = tuple(
    column
    for column in COLUMNS
    if column not in {"date", "amount", "notes", "flags", "createdAt"}
)
FLAG_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")
CENT = Decimal("0.01")
MAX_REQUEST_BYTES = 1_000_000
MAX_IMPORT_REQUEST_BYTES = 50_000_000
BILL_PAYMENT_WINDOW_DAYS = 5
TRANSACTION_PATH = re.compile(r"^/api/transactions/(\d+)$")
BACKUP_RESTORE_PATH = re.compile(
    r"^/api/backups/([^/]+)/restore$"
)
BACKUP_DELETE_PATH = re.compile(r"^/api/backups/([^/]+)$")
IMPORT_HISTORY_DELETE_PATH = re.compile(r"^/api/import-history/([^/]+)$")
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
}
IMPORT_ACCOUNT_DEFAULTS = {
    "amazon": AMAZON_DEFAULT_ACCOUNT,
    "aliexpress": ALIEXPRESS_DEFAULT_ACCOUNT,
    "venmo": VENMO_DEFAULT_ACCOUNT,
    "applecard": APPLE_CARD_DEFAULT_ACCOUNT,
    "ebay": EBAY_DEFAULT_ACCOUNT,
}
STATIC_FILES = {
    "/": APP_DIR / "index.html",
    "/index.html": APP_DIR / "index.html",
    "/styles.css": APP_DIR / "styles.css",
    "/app.js": APP_DIR / "app.js",
    "/navigation.js": APP_DIR / "navigation.js",
    "/import": APP_DIR / "upload.html",
    "/import.html": APP_DIR / "upload.html",
    "/upload.js": APP_DIR / "upload.js",
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
    amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)

    transaction: dict[str, Any] = {
        "date": normalized_date,
        "amount": float(amount),
    }
    for column in REQUIRED_TEXT_COLUMNS:
        value = raw.get(column)
        if not isinstance(value, str) or not value.strip():
            raise CsvDataError(f"{location}.{column} cannot be blank")
        transaction[column] = value.strip()
    notes = raw.get("notes", "")
    if not isinstance(notes, str):
        raise CsvDataError(f"{location}.notes must be text")
    transaction["notes"] = notes.strip()
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
    return transaction


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
    missing = set(COLUMNS) - actual_columns
    if missing:
        raise CsvDataError(f"CSV is missing columns: {', '.join(sorted(missing))}")

    transactions = [
        normalize_transaction(row, f"line {line_number}")
        for line_number, row in enumerate(reader, start=2)
    ]
    revision = hashlib.sha256(raw_bytes).hexdigest()
    return transactions, revision


def write_transactions_atomic(csv_path: Path, transactions: list[dict[str, Any]]) -> None:
    """Replace the CSV atomically so readers never observe a partial write."""
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
            for transaction in transactions:
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
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise


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
                    notes=row.get("notes", ""),
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
        return False
    if not any(fieldname_set == set(columns) for columns in COMPATIBLE_COLUMNS[1:]):
        return False
    transactions = [
        normalize_transaction(
            dict(
                row,
                notes=row.get("notes", ""),
                flags=row.get("flags", ""),
                createdAt=row.get("createdAt", ""),
            ),
            f"line {line_number}",
        )
        for line_number, row in enumerate(reader, start=2)
    ]
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
    existing_counts = Counter(transaction_identity(row) for row in existing)
    upload_occurrences: Counter[tuple[str, Decimal]] = Counter()
    added_by_source = {source: 0 for source in parsed_by_source}
    skipped_by_source = {source: 0 for source in parsed_by_source}
    additions: list[dict[str, Any]] = []

    for source, parsed_transactions in parsed_by_source.items():
        for parsed_transaction in parsed_transactions:
            normalized = normalize_transaction(parsed_transaction, f"{source} transaction")
            key = transaction_identity(normalized)
            upload_occurrences[key] += 1
            if upload_occurrences[key] <= existing_counts[key]:
                skipped_by_source[source] += 1
            else:
                additions.append(normalized)
                added_by_source[source] += 1
    return additions, added_by_source, skipped_by_source


def preview_imported_transactions(
    existing: list[dict[str, Any]], parsed_transactions: list[dict[str, Any]], source: str
) -> tuple[list[dict[str, Any]], int, int]:
    """Classify every parsed occurrence without changing the master CSV."""
    existing_counts = Counter(transaction_identity(row) for row in existing)
    upload_occurrences: Counter[tuple[str, Decimal]] = Counter()
    preview: list[dict[str, Any]] = []
    duplicate_count = 0

    for staged_id, parsed_transaction in enumerate(parsed_transactions):
        normalized = normalize_transaction(parsed_transaction, f"{source} transaction")
        key = transaction_identity(normalized)
        upload_occurrences[key] += 1
        is_duplicate = upload_occurrences[key] <= existing_counts[key]
        duplicate_count += int(is_duplicate)
        preview.append(
            dict(
                normalized,
                _stagedId=staged_id,
                _isDuplicate=is_duplicate,
            )
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


def find_bill_payment_ids(transactions: list[dict[str, Any]]) -> set[int]:
    """Reconcile one-to-one transfers between bank and credit accounts."""
    bank_entries: list[tuple[int, date, Decimal, str]] = []
    credit_entries: list[tuple[int, date, Decimal, str]] = []
    for index, transaction in enumerate(transactions):
        category = str(transaction["category"]).strip().casefold()
        if category not in {"transfer", "income"}:
            continue
        account_type = str(transaction["accountType"]).strip().casefold()
        amount = Decimal(str(transaction["amount"])).quantize(CENT, rounding=ROUND_HALF_UP)
        transaction_date = date.fromisoformat(str(transaction["date"]))
        if account_type == "bank":
            bank_entries.append((index, transaction_date, amount, category))
        elif account_type == "credit":
            credit_entries.append((index, transaction_date, amount, category))

    candidates: list[tuple[int, int, int]] = []
    for bank_id, bank_date, bank_amount, bank_category in bank_entries:
        for credit_id, credit_date, credit_amount, credit_category in credit_entries:
            day_distance = abs((bank_date - credit_date).days)
            if (
                "transfer" in {bank_category, credit_category}
                and bank_amount != 0
                and bank_amount == -credit_amount
                and day_distance <= BILL_PAYMENT_WINDOW_DAYS
            ):
                candidates.append((day_distance, bank_id, credit_id))

    matched_banks: set[int] = set()
    matched_credits: set[int] = set()
    for _day_distance, bank_id, credit_id in sorted(candidates):
        if bank_id in matched_banks or credit_id in matched_credits:
            continue
        matched_banks.add(bank_id)
        matched_credits.add(credit_id)
    return matched_banks | matched_credits


def public_state(transactions: list[dict[str, Any]], revision: str) -> dict[str, Any]:
    bill_payment_ids = find_bill_payment_ids(transactions)
    return {
        "revision": revision,
        "transactions": [
            dict(transaction, _id=index, _isBillPayment=index in bill_payment_ids)
            for index, transaction in enumerate(transactions)
        ],
    }


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
            str(transaction["accountName"]),
            str(transaction["accountType"]),
            str(transaction["provider"]),
            str(transaction["notes"]),
            str(transaction["flags"]),
            str(transaction["createdAt"]),
        )

    remaining = Counter(content_identity(transaction) for transaction in additions)
    public_transactions = [
        dict(transaction, _id=index)
        for index, transaction in enumerate(saved_transactions)
    ]
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
        path = urlparse(self.path).path
        if path in {"/upload", "/upload.html"}:
            self.send_response(HTTPStatus.PERMANENT_REDIRECT)
            self.send_header("Location", "/import")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/api/transactions":
            try:
                with self.data_lock:
                    transactions, revision = read_transaction_state(self.csv_path)
                self.send_json(HTTPStatus.OK, public_state(transactions, revision))
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
        if path in STATIC_FILES:
            self.send_static_file(STATIC_FILES[path])
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        if path == "/api/transactions/initialize":
            self.initialize_transaction_file()
        elif path == "/api/backups":
            self.create_backup()
        elif path == "/api/transactions":
            self.mutate_transactions("create")
        elif path == "/api/import":
            self.import_transactions()
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
        else:
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
        match = TRANSACTION_PATH.fullmatch(urlparse(self.path).path)
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
        import_history_delete_match = IMPORT_HISTORY_DELETE_PATH.fullmatch(path)
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
        }
        if "import" in session:
            response["import"] = session["import"]
        if session.get("source") == "creditkarma":
            response["ignoreAmazon"] = session.get("ignoreAmazon", True)
            response["ignoreAliExpress"] = session.get("ignoreAliExpress", True)
            response["ignoreVenmo"] = session.get("ignoreVenmo", True)
            response["ignoreEbay"] = session.get("ignoreEbay", True)
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
            if source == "creditkarma" and (
                not isinstance(ignore_amazon, bool)
                or not isinstance(ignore_aliexpress, bool)
                or not isinstance(ignore_venmo, bool)
                or not isinstance(ignore_ebay, bool)
            ):
                raise CsvDataError("Credit Karma ignore options must be true or false")

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
                )
            elif account_identity is not None:
                session.update(
                    accountName=account_identity[0],
                    accountType=account_identity[1],
                    provider=account_identity[2],
                )
            with self.amazon_import_lock:
                self.amazon_import_sessions[token] = session
            response = self.public_amazon_import_session(session)
            response["token"] = token
            self.send_json(HTTPStatus.CREATED, response)
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

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
            if source == "creditkarma":
                with self.amazon_import_lock:
                    session = self.amazon_import_sessions.get(token, {})
                    ignore_amazon = session.get("ignoreAmazon", True)
                    ignore_aliexpress = session.get("ignoreAliExpress", True)
                    ignore_venmo = session.get("ignoreVenmo", True)
                    ignore_ebay = session.get("ignoreEbay", True)
                credit_karma = parse_credit_karma(
                    content,
                    ignore_amazon=ignore_amazon,
                    ignore_aliexpress=ignore_aliexpress,
                    ignore_venmo=ignore_venmo,
                    ignore_ebay=ignore_ebay,
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
                parsed_transactions = [
                    transaction
                    for transaction in parsed_transactions
                    if start_date <= transaction["date"] <= end_date
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
            with self.data_lock:
                if self.csv_path.exists():
                    existing, baseline_revision = read_transaction_state(self.csv_path)
                else:
                    existing, baseline_revision = [], MISSING_CSV_REVISION
                preview, new_count, duplicate_count = preview_imported_transactions(
                    existing, parsed_transactions, source
                )

            result = {
                "parsed": len(preview),
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
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            with self.amazon_import_lock:
                session = self.amazon_import_sessions[token]
                session.update(
                    status="review",
                    progress=98,
                    message=f"Review {len(preview)} parsed {source_label} transactions.",
                    updatedAt=time.time(),
                    baselineRevision=baseline_revision,
                    stagedIds={transaction["_stagedId"] for transaction in preview},
                    **{"import": result},
                )
                response = self.public_amazon_import_session(session)
            self.send_json(HTTPStatus.OK, response)
        except (CsvDataError, ImportDataError, OSError) as exc:
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is not None:
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
                additions.append(normalize_transaction(raw_transaction, f"transactions[{index}]"))

            with self.data_lock:
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

                if additions:
                    stamp_imported_transactions(additions)
                    existing.extend(additions)
                    existing.sort(key=lambda row: (row["date"], row["description"].casefold()))
                    self.csv_path.parent.mkdir(parents=True, exist_ok=True)
                    write_transactions_atomic(self.csv_path, existing)

                if self.csv_path.exists():
                    saved_transactions, saved_revision = read_transaction_state(self.csv_path)
                    committed = imported_transaction_state(saved_transactions, additions)
                else:
                    saved_revision = MISSING_CSV_REVISION
                    committed = []

            result = {
                "committed": len(additions),
                "transactions": committed,
                "revision": saved_revision,
            }
            source_label = IMPORT_SOURCE_LABELS.get(source, source)
            with self.amazon_import_lock:
                session = self.amazon_import_sessions[token]
                session.pop("stagedIds", None)
                session.pop("baselineRevision", None)
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

    def import_transactions(self) -> None:
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            expected_revision = payload.get("revision")
            if not isinstance(expected_revision, str) or not expected_revision:
                raise CsvDataError("revision is required")
            files = payload.get("files")
            if not isinstance(files, Mapping):
                raise CsvDataError("files must be an object")
            unknown_parsers = set(files) - {"creditkarma", "amazon"}
            if unknown_parsers:
                raise CsvDataError(f"unsupported parser: {sorted(unknown_parsers)[0]}")
            if not files:
                raise CsvDataError("select at least one file to import")

            def file_content(parser: str) -> Any:
                uploaded_file = files.get(parser)
                if not isinstance(uploaded_file, Mapping):
                    raise CsvDataError(f"{parser} upload must be an object")
                return uploaded_file.get("content")

            parsed_by_source: dict[str, list[dict[str, Any]]] = {}
            ignored_amazon_count = 0
            amazon_account: tuple[str, str, str] | None = None
            if "creditkarma" in files:
                credit_karma = parse_credit_karma(file_content("creditkarma"))
                parsed_by_source["creditkarma"] = credit_karma.transactions
                ignored_amazon_count = credit_karma.ignored_amazon_count
                amazon_account = credit_karma.amazon_account
            if "amazon" in files:
                parsed_by_source["amazon"] = parse_amazon(
                    file_content("amazon"), amazon_account=amazon_account
                )

            with self.data_lock:
                existing, revision = read_transaction_state(self.csv_path)
                if revision != expected_revision:
                    raise RevisionConflict(
                        "The transaction file changed after this page loaded. Reload and try again."
                    )

                additions, added_by_source, skipped_by_source = merge_imported_transactions(
                    existing, parsed_by_source
                )

                if additions:
                    stamp_imported_transactions(additions)
                    existing.extend(additions)
                    existing.sort(key=lambda row: (row["date"], row["description"].casefold()))
                    write_transactions_atomic(self.csv_path, existing)
                saved_transactions, saved_revision = read_transaction_state(self.csv_path)

            source_results = {
                source: {
                    "parsed": len(parsed_by_source[source]),
                    "added": added_by_source[source],
                    "duplicatesSkipped": skipped_by_source[source],
                }
                for source in parsed_by_source
            }
            if "creditkarma" in source_results:
                source_results["creditkarma"]["amazonTransactionsIgnored"] = ignored_amazon_count
            response = public_state(saved_transactions, saved_revision)
            response["import"] = {
                "added": len(additions),
                "duplicatesSkipped": sum(skipped_by_source.values()),
                "sources": source_results,
            }
            self.send_json(HTTPStatus.OK, response)
        except RevisionConflict as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
        except (CsvDataError, ImportDataError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except OSError as exc:
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not update {self.csv_path}: {exc}"},
            )

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

                if action == "create":
                    created = normalize_transaction(payload.get("transaction"), "transaction")
                    created["createdAt"] = ""
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
                        transactions[transaction_id] = updated
                    elif action == "delete":
                        del transactions[transaction_id]
                    else:
                        raise CsvDataError("unsupported transaction action")
                    response_status = HTTPStatus.OK

                transactions.sort(key=lambda row: (row["date"], row["description"].casefold()))
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
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message_format: str, *args: object) -> None:
        message = message_format % args
        message = re.sub(
            r"(/api/(?:amazon|creditkarma|aliexpress|venmo|applecard|ebay)-import-sessions/)[A-Za-z0-9_-]{32,}",
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
