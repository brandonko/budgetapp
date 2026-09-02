#!/usr/bin/env python3
"""Build one normalized transactions CSV from BudgetLens and Amazon exports.

BudgetLens transactions whose description contains "amazon" are excluded. Each
line item in the Amazon export replaces those card transactions as its own row.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import tempfile
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


COLUMNS = (
    "date",
    "description",
    "amount",
    "category",
    "accountName",
    "accountType",
    "provider",
)
CENT = Decimal("0.01")
AMAZON_TAX_MULTIPLIER = Decimal("1.10502")


class DataError(ValueError):
    """Raised when an input file does not have the expected data."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Combine a BudgetLens JSON export and an Amazon orders JSON export into CSV."
    )
    parser.add_argument("credit_card_json", type=Path, help="BudgetLens JSON export")
    parser.add_argument("amazon_orders_json", type=Path, help="Amazon orders JSON export")
    parser.add_argument("output_csv", type=Path, help="CSV file to create or replace")
    parser.add_argument(
        "--amazon-category",
        default="Shopping",
        help="Category assigned to Amazon item rows (default: Shopping)",
    )
    parser.add_argument(
        "--amazon-account-name",
        help="Override the accountName inferred from Amazon card transactions",
    )
    parser.add_argument(
        "--amazon-account-type",
        help="Override the accountType inferred from Amazon card transactions",
    )
    parser.add_argument(
        "--amazon-provider",
        help="Override the provider inferred from Amazon card transactions",
    )
    return parser.parse_args(argv)


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle, parse_float=Decimal)
    except json.JSONDecodeError as exc:
        raise DataError(f"{path}: invalid JSON ({exc})") from exc


def require_mapping(value: Any, location: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise DataError(f"{location} must be a JSON object")
    return value


def require_list(value: Any, location: str) -> list[Any]:
    if not isinstance(value, list):
        raise DataError(f"{location} must be a JSON array")
    return value


def require_text(record: Mapping[str, Any], field: str, location: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise DataError(f"{location}.{field} must be a non-empty string")
    return value.strip()


def require_iso_date(record: Mapping[str, Any], field: str, location: str) -> str:
    value = require_text(record, field, location)
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise DataError(f"{location}.{field} must be an ISO date (YYYY-MM-DD)") from exc


def require_decimal(record: Mapping[str, Any], field: str, location: str) -> Decimal:
    value = record.get(field)
    if isinstance(value, bool) or value is None:
        raise DataError(f"{location}.{field} must be a number")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise DataError(f"{location}.{field} must be a number") from exc
    if not number.is_finite():
        raise DataError(f"{location}.{field} must be finite")
    return number


def money(value: Decimal) -> str:
    """Return a predictable, conventional two-decimal CSV amount."""
    return format(value.quantize(CENT, rounding=ROUND_HALF_UP), ".2f")


def is_amazon(description: str) -> bool:
    return "amazon" in description.casefold()


def normalize_card_transactions(
    document: Any,
) -> tuple[list[dict[str, str]], list[Mapping[str, Any]]]:
    root = require_mapping(document, "credit card document")
    raw_transactions = require_list(root.get("transactions"), "credit card document.transactions")
    rows: list[dict[str, str]] = []
    amazon_transactions: list[Mapping[str, Any]] = []

    for index, raw in enumerate(raw_transactions):
        location = f"credit card document.transactions[{index}]"
        transaction = require_mapping(raw, location)
        description = require_text(transaction, "description", location)
        if is_amazon(description):
            amazon_transactions.append(transaction)
            continue

        transaction_type = require_text(transaction, "transactionType", location).casefold()
        if transaction_type not in {"credit", "debit"}:
            raise DataError(
                f"{location}.transactionType must be 'credit' or 'debit', "
                f"not {transaction_type!r}"
            )
        unsigned_amount = abs(require_decimal(transaction, "amount", location))
        # This CSV uses an expense-oriented convention: purchases/debits add to
        # spending totals, while credits/refunds reduce those totals.
        signed_amount = unsigned_amount if transaction_type == "debit" else -unsigned_amount
        rows.append(
            {
                "date": require_iso_date(transaction, "date", location),
                "description": description,
                "amount": money(signed_amount),
                "category": require_text(transaction, "category", location),
                "accountName": require_text(transaction, "accountName", location),
                "accountType": require_text(transaction, "accountType", location),
                "provider": require_text(transaction, "provider", location),
            }
        )
    return rows, amazon_transactions


def infer_amazon_account(
    amazon_transactions: Iterable[Mapping[str, Any]],
) -> tuple[str, str, str]:
    """Infer payment metadata from the most common Amazon card transaction."""
    candidates: list[tuple[str, str, str]] = []
    for index, transaction in enumerate(amazon_transactions):
        location = f"Amazon credit card transaction[{index}]"
        candidates.append(
            (
                require_text(transaction, "accountName", location),
                require_text(transaction, "accountType", location),
                require_text(transaction, "provider", location),
            )
        )
    if not candidates:
        raise DataError(
            "cannot infer Amazon account metadata because the credit card export has no "
            "Amazon transactions; supply all three --amazon-account-* options"
        )
    # Counter preserves first-seen order for equal counts, making the choice stable.
    return Counter(candidates).most_common(1)[0][0]


def extract_orders(document: Any) -> list[Any]:
    if isinstance(document, list):
        return document
    root = require_mapping(document, "Amazon document")
    return require_list(root.get("orders"), "Amazon document.orders")


def normalize_amazon_orders(
    document: Any,
    *,
    category: str,
    account_name: str,
    account_type: str,
    provider: str,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for order_index, raw_order in enumerate(extract_orders(document)):
        order_location = f"Amazon order[{order_index}]"
        order = require_mapping(raw_order, order_location)
        order_date = require_iso_date(order, "orderDate", order_location)
        items = require_list(order.get("items"), f"{order_location}.items")

        for item_index, raw_item in enumerate(items):
            item_location = f"{order_location}.items[{item_index}]"
            item = require_mapping(raw_item, item_location)
            quantity_value = item.get("quantity", 1)
            if isinstance(quantity_value, bool):
                raise DataError(f"{item_location}.quantity must be a positive integer")
            try:
                quantity = int(quantity_value)
            except (TypeError, ValueError) as exc:
                raise DataError(f"{item_location}.quantity must be a positive integer") from exc
            if quantity < 1 or Decimal(str(quantity_value)) != quantity:
                raise DataError(f"{item_location}.quantity must be a positive integer")

            # The Amazon export's price is pre-tax. One row represents one line item,
            # so quantity is included in its amount before tax is applied.
            pretax_amount = require_decimal(item, "price", item_location) * quantity
            taxed_amount = pretax_amount * AMAZON_TAX_MULTIPLIER
            rows.append(
                {
                    "date": order_date,
                    "description": require_text(item, "title", item_location),
                    "amount": money(taxed_amount),
                    "category": category,
                    "accountName": account_name,
                    "accountType": account_type,
                    "provider": provider,
                }
            )
    return rows


def write_csv_atomic(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="raise")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_name, path)
    except BaseException:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        raise


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        card_rows, ignored_amazon_transactions = normalize_card_transactions(
            load_json(args.credit_card_json)
        )

        overrides = (
            args.amazon_account_name,
            args.amazon_account_type,
            args.amazon_provider,
        )
        if all(overrides):
            account_name, account_type, provider = overrides
        elif any(overrides):
            raise DataError("supply either all three --amazon-account-* options or none of them")
        else:
            account_name, account_type, provider = infer_amazon_account(
                ignored_amazon_transactions
            )

        amazon_rows = normalize_amazon_orders(
            load_json(args.amazon_orders_json),
            category=args.amazon_category,
            account_name=account_name,
            account_type=account_type,
            provider=provider,
        )
        rows = card_rows + amazon_rows
        rows.sort(key=lambda row: (row["date"], row["description"].casefold()))
        write_csv_atomic(args.output_csv, rows)
    except (DataError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(
        f"Wrote {len(rows)} rows to {args.output_csv} "
        f"({len(card_rows)} card transactions, {len(amazon_rows)} Amazon items; "
        f"ignored {len(ignored_amazon_transactions)} Amazon card transactions)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
