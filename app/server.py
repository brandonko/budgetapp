#!/usr/bin/env python3
"""Small, dependency-free server for the budget dashboard."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
from datetime import date
from decimal import Decimal, InvalidOperation
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlparse


APP_DIR = Path(__file__).resolve().parent
DEFAULT_CSV = APP_DIR.parent / "processed_data_files" / "transactions.csv"
REQUIRED_COLUMNS = {
    "date",
    "description",
    "amount",
    "category",
    "accountName",
    "accountType",
    "provider",
}
STATIC_FILES = {
    "/": APP_DIR / "index.html",
    "/index.html": APP_DIR / "index.html",
    "/styles.css": APP_DIR / "styles.css",
    "/app.js": APP_DIR / "app.js",
}


class CsvDataError(ValueError):
    """Raised when the master transactions CSV is invalid."""


def load_transactions(csv_path: Path) -> list[dict[str, Any]]:
    """Read and validate the current master CSV."""
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            actual_columns = set(reader.fieldnames or [])
            missing = REQUIRED_COLUMNS - actual_columns
            if missing:
                raise CsvDataError(f"CSV is missing columns: {', '.join(sorted(missing))}")

            transactions: list[dict[str, Any]] = []
            for line_number, row in enumerate(reader, start=2):
                try:
                    parsed_date = date.fromisoformat((row["date"] or "").strip())
                except ValueError as exc:
                    raise CsvDataError(
                        f"line {line_number}: date must use YYYY-MM-DD"
                    ) from exc
                try:
                    amount = Decimal((row["amount"] or "").strip())
                except InvalidOperation as exc:
                    raise CsvDataError(
                        f"line {line_number}: amount must be numeric"
                    ) from exc
                if not amount.is_finite():
                    raise CsvDataError(f"line {line_number}: amount must be finite")

                normalized: dict[str, Any] = {
                    "date": parsed_date.isoformat(),
                    "amount": float(amount),
                }
                for column in REQUIRED_COLUMNS - {"date", "amount"}:
                    value = (row[column] or "").strip()
                    if not value:
                        raise CsvDataError(f"line {line_number}: {column} cannot be blank")
                    normalized[column] = value
                transactions.append(normalized)
            return transactions
    except OSError as exc:
        raise CsvDataError(f"could not read {csv_path}: {exc}") from exc


class BudgetRequestHandler(BaseHTTPRequestHandler):
    server_version = "BudgetDashboard/1.0"

    @property
    def csv_path(self) -> Path:
        return self.server.csv_path  # type: ignore[attr-defined]

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        path = urlparse(self.path).path
        if path == "/api/transactions":
            self.send_transactions()
            return
        if path in STATIC_FILES:
            self.send_static_file(STATIC_FILES[path])
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def send_transactions(self) -> None:
        try:
            transactions = load_transactions(self.csv_path)
            body = json.dumps({"transactions": transactions}, separators=(",", ":")).encode(
                "utf-8"
            )
            self.send_response(HTTPStatus.OK)
        except CsvDataError as exc:
            body = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
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
        print(f"{self.address_string()} - {message_format % args}")


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
        load_transactions(args.csv)
    except CsvDataError as exc:
        print(f"error: {exc}")
        return 1

    server = ThreadingHTTPServer((args.host, args.port), BudgetRequestHandler)
    server.csv_path = args.csv.resolve()  # type: ignore[attr-defined]
    print(f"Budget dashboard: http://{args.host}:{args.port}")
    print(f"Reading transactions from: {server.csv_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
