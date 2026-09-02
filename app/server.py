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
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

from importers import ImportDataError, parse_amazon, parse_credit_karma


APP_DIR = Path(__file__).resolve().parent
PROCESSED_DATA_DIR = APP_DIR.parent / "processed_data_files"
COLUMNS = (
    "date",
    "description",
    "amount",
    "category",
    "accountName",
    "accountType",
    "provider",
)
DEFAULT_CSV = PROCESSED_DATA_DIR / "transactions.csv"
TEXT_COLUMNS = tuple(column for column in COLUMNS if column not in {"date", "amount"})
CENT = Decimal("0.01")
MAX_REQUEST_BYTES = 1_000_000
MAX_IMPORT_REQUEST_BYTES = 50_000_000
BILL_PAYMENT_WINDOW_DAYS = 5
TRANSACTION_PATH = re.compile(r"^/api/transactions/(\d+)$")
AMAZON_IMPORT_SESSION_PATH = re.compile(
    r"^/api/amazon-import-sessions/([A-Za-z0-9_-]{32,})$"
)
AMAZON_IMPORT_ACTION_PATH = re.compile(
    r"^/api/amazon-import-sessions/([A-Za-z0-9_-]{32,})/(progress|complete|cancel)$"
)
AMAZON_IMPORT_SESSION_TTL_SECONDS = 60 * 60
TERMINAL_IMPORT_STATUSES = {"complete", "error", "cancelled"}
STATIC_FILES = {
    "/": APP_DIR / "index.html",
    "/index.html": APP_DIR / "index.html",
    "/styles.css": APP_DIR / "styles.css",
    "/app.js": APP_DIR / "app.js",
    "/upload": APP_DIR / "upload.html",
    "/upload.html": APP_DIR / "upload.html",
    "/upload.js": APP_DIR / "upload.js",
}


class CsvDataError(ValueError):
    """Raised when transaction data is invalid."""


class RevisionConflict(RuntimeError):
    """Raised when a client tries to modify an out-of-date CSV revision."""


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
    for column in TEXT_COLUMNS:
        value = raw.get(column)
        if not isinstance(value, str) or not value.strip():
            raise CsvDataError(f"{location}.{column} cannot be blank")
        transaction[column] = value.strip()
    return transaction


def read_transaction_state(csv_path: Path) -> tuple[list[dict[str, Any]], str]:
    """Read and validate a single, revisioned snapshot of the master CSV."""
    try:
        raw_bytes = csv_path.read_bytes()
        text = raw_bytes.decode("utf-8-sig")
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


def transaction_identity(transaction: Mapping[str, Any]) -> tuple[str, Decimal]:
    """Return the user-specified import identity, normalized to exact cents."""
    return (
        str(transaction["date"]),
        Decimal(str(transaction["amount"])).quantize(CENT, rounding=ROUND_HALF_UP),
    )


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
        if path == "/api/transactions":
            try:
                with self.data_lock:
                    transactions, revision = read_transaction_state(self.csv_path)
                self.send_json(HTTPStatus.OK, public_state(transactions, revision))
            except CsvDataError as exc:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        session_match = AMAZON_IMPORT_SESSION_PATH.fullmatch(path)
        if session_match is not None:
            self.get_amazon_import_session(session_match.group(1))
            return
        if path in STATIC_FILES:
            self.send_static_file(STATIC_FILES[path])
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        if path == "/api/transactions":
            self.mutate_transactions("create")
        elif path == "/api/import":
            self.import_transactions()
        elif path == "/api/amazon-import-sessions":
            self.create_amazon_import_session()
        else:
            action_match = AMAZON_IMPORT_ACTION_PATH.fullmatch(path)
            if action_match is None:
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return
            self.update_amazon_import_session(action_match.group(1), action_match.group(2))

    def do_PUT(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        match = TRANSACTION_PATH.fullmatch(urlparse(self.path).path)
        if match is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        self.mutate_transactions("update", int(match.group(1)))

    def do_DELETE(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        match = TRANSACTION_PATH.fullmatch(urlparse(self.path).path)
        if match is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        self.mutate_transactions("delete", int(match.group(1)))

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
            "status": session["status"],
            "progress": session["progress"],
            "message": session["message"],
            "startDate": session["startDate"],
            "endDate": session["endDate"],
        }
        if "import" in session:
            response["import"] = session["import"]
        return response

    def create_amazon_import_session(self) -> None:
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

            self.prune_amazon_import_sessions()
            token = secrets.token_urlsafe(32)
            now = time.time()
            session: dict[str, Any] = {
                "status": "waiting_for_extension",
                "progress": 0,
                "message": "Waiting for the Amazon importer extension.",
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "createdAt": now,
                "updatedAt": now,
            }
            with self.amazon_import_lock:
                self.amazon_import_sessions[token] = session
            response = self.public_amazon_import_session(session)
            response["token"] = token
            self.send_json(HTTPStatus.CREATED, response)
        except CsvDataError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def get_amazon_import_session(self, token: str) -> None:
        self.prune_amazon_import_sessions()
        with self.amazon_import_lock:
            session = self.amazon_import_sessions.get(token)
            response = (
                self.public_amazon_import_session(session) if session is not None else None
            )
        if response is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Import session not found or expired."})
            return
        self.send_json(HTTPStatus.OK, response)

    def update_amazon_import_session(self, token: str, action: str) -> None:
        try:
            payload = self.read_json_body(MAX_IMPORT_REQUEST_BYTES)
            self.prune_amazon_import_sessions()
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None:
                    self.send_json(
                        HTTPStatus.NOT_FOUND, {"error": "Import session not found or expired."}
                    )
                    return
                if session["status"] in TERMINAL_IMPORT_STATUSES:
                    self.send_json(HTTPStatus.OK, self.public_amazon_import_session(session))
                    return

            if action == "complete":
                self.complete_amazon_import_session(token, payload)
                return

            now = time.time()
            with self.amazon_import_lock:
                session = self.amazon_import_sessions.get(token)
                if session is None:
                    raise CsvDataError("Import session expired.")
                if action == "cancel":
                    session.update(
                        status="cancelled",
                        progress=session["progress"],
                        message="Amazon import cancelled.",
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
                        "scraping",
                        "importing",
                        "error",
                    }
                    if raw_status not in allowed_statuses:
                        raise CsvDataError("unsupported import status")
                    raw_message = payload.get("message", "Importing Amazon orders.")
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
        self, token: str, payload: Mapping[str, Any]
    ) -> None:
        content = payload.get("content")
        if not isinstance(content, str) or not content.strip():
            raise CsvDataError("Amazon export content is required")

        try:
            parsed_amazon = parse_amazon(content)
            with self.data_lock:
                existing, _revision = read_transaction_state(self.csv_path)
                additions, added_by_source, skipped_by_source = merge_imported_transactions(
                    existing, {"amazon": parsed_amazon}
                )
                if additions:
                    existing.extend(additions)
                    existing.sort(key=lambda row: (row["date"], row["description"].casefold()))
                    write_transactions_atomic(self.csv_path, existing)
                _saved_transactions, saved_revision = read_transaction_state(self.csv_path)

            result = {
                "added": len(additions),
                "duplicatesSkipped": skipped_by_source["amazon"],
                "sources": {
                    "amazon": {
                        "parsed": len(parsed_amazon),
                        "added": added_by_source["amazon"],
                        "duplicatesSkipped": skipped_by_source["amazon"],
                    }
                },
                "revision": saved_revision,
            }
            with self.amazon_import_lock:
                session = self.amazon_import_sessions[token]
                session.update(
                    status="complete",
                    progress=100,
                    message=f"Imported {len(additions)} new Amazon transactions.",
                    updatedAt=time.time(),
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
                    transactions.append(normalize_transaction(payload.get("transaction"), "transaction"))
                    response_status = HTTPStatus.CREATED
                else:
                    if transaction_id is None or not 0 <= transaction_id < len(transactions):
                        raise CsvDataError("transaction no longer exists")
                    if action == "update":
                        transactions[transaction_id] = normalize_transaction(
                            payload.get("transaction"), "transaction"
                        )
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
            r"(/api/amazon-import-sessions/)[A-Za-z0-9_-]{32,}",
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
        initialize_csv_if_missing(args.csv)
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
