"""Parsers for transaction source exports used by the dashboard import API."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping


CENT = Decimal("0.01")
AMAZON_TAX_MULTIPLIER = Decimal("1.10502")


class ImportDataError(ValueError):
    """Raised when an uploaded export has an invalid schema or value."""


@dataclass(frozen=True)
class CreditKarmaImport:
    transactions: list[dict[str, Any]]
    amazon_account: tuple[str, str, str] | None
    ignored_amazon_count: int


def load_json_text(content: Any, parser_name: str) -> Any:
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError(f"{parser_name} file is empty")
    try:
        return json.loads(content, parse_float=Decimal)
    except json.JSONDecodeError as exc:
        raise ImportDataError(f"{parser_name} file contains invalid JSON: {exc}") from exc


def require_mapping(value: Any, location: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ImportDataError(f"{location} must be a JSON object")
    return value


def require_list(value: Any, location: str) -> list[Any]:
    if not isinstance(value, list):
        raise ImportDataError(f"{location} must be a JSON array")
    return value


def require_text(record: Mapping[str, Any], field: str, location: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ImportDataError(f"{location}.{field} must be a non-empty string")
    return value.strip()


def require_date(record: Mapping[str, Any], field: str, location: str) -> str:
    value = require_text(record, field, location)
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ImportDataError(f"{location}.{field} must use YYYY-MM-DD") from exc


def require_decimal(record: Mapping[str, Any], field: str, location: str) -> Decimal:
    value = record.get(field)
    if isinstance(value, bool) or value is None:
        raise ImportDataError(f"{location}.{field} must be numeric")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ImportDataError(f"{location}.{field} must be numeric") from exc
    if not number.is_finite():
        raise ImportDataError(f"{location}.{field} must be finite")
    return number


def as_money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def parse_credit_karma(content: Any) -> CreditKarmaImport:
    document = load_json_text(content, "Credit Karma")
    root = require_mapping(document, "Credit Karma document")
    raw_transactions = require_list(root.get("transactions"), "Credit Karma document.transactions")
    transactions: list[dict[str, Any]] = []
    amazon_accounts: list[tuple[str, str, str]] = []
    ignored_amazon_count = 0

    for index, raw in enumerate(raw_transactions):
        location = f"Credit Karma transaction[{index}]"
        transaction = require_mapping(raw, location)
        description = require_text(transaction, "description", location)
        if "amazon" in description.casefold():
            ignored_amazon_count += 1
            amazon_accounts.append(
                (
                    require_text(transaction, "accountName", location),
                    require_text(transaction, "accountType", location),
                    require_text(transaction, "provider", location),
                )
            )
            continue

        transaction_type = require_text(transaction, "transactionType", location).casefold()
        if transaction_type not in {"credit", "debit"}:
            raise ImportDataError(f"{location}.transactionType must be credit or debit")
        unsigned_amount = abs(require_decimal(transaction, "amount", location))
        signed_amount = unsigned_amount if transaction_type == "debit" else -unsigned_amount
        transactions.append(
            {
                "date": require_date(transaction, "date", location),
                "description": description,
                "amount": as_money(signed_amount),
                "category": require_text(transaction, "category", location),
                "accountName": require_text(transaction, "accountName", location),
                "accountType": require_text(transaction, "accountType", location),
                "provider": require_text(transaction, "provider", location),
            }
        )

    amazon_account = Counter(amazon_accounts).most_common(1)[0][0] if amazon_accounts else None
    return CreditKarmaImport(transactions, amazon_account, ignored_amazon_count)


def parse_amazon(
    content: Any,
    amazon_account: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    document = load_json_text(content, "Amazon")
    if isinstance(document, list):
        raw_orders = document
    else:
        root = require_mapping(document, "Amazon document")
        if "orders" in root:
            raw_orders = require_list(root.get("orders"), "Amazon document.orders")
        elif "orderDate" in root and "items" in root:
            raw_orders = [root]
        else:
            raise ImportDataError(
                "Amazon document must be an order array, an orders object, or a single order"
            )

    account_name, account_type, provider = amazon_account or ("Amazon", "Amazon", "Amazon")
    transactions: list[dict[str, Any]] = []
    for order_index, raw_order in enumerate(raw_orders):
        order_location = f"Amazon order[{order_index}]"
        order = require_mapping(raw_order, order_location)
        order_date = require_date(order, "orderDate", order_location)
        items = require_list(order.get("items"), f"{order_location}.items")

        for item_index, raw_item in enumerate(items):
            item_location = f"{order_location}.items[{item_index}]"
            item = require_mapping(raw_item, item_location)
            quantity_value = item.get("quantity", 1)
            if isinstance(quantity_value, bool):
                raise ImportDataError(f"{item_location}.quantity must be a positive integer")
            try:
                quantity = int(quantity_value)
                exact_quantity = Decimal(str(quantity_value))
            except (TypeError, ValueError, InvalidOperation, OverflowError) as exc:
                raise ImportDataError(
                    f"{item_location}.quantity must be a positive integer"
                ) from exc
            if quantity < 1 or exact_quantity != quantity:
                raise ImportDataError(f"{item_location}.quantity must be a positive integer")

            amount = require_decimal(item, "price", item_location) * quantity
            transactions.append(
                {
                    "date": order_date,
                    "description": require_text(item, "title", item_location),
                    "amount": as_money(amount * AMAZON_TAX_MULTIPLIER),
                    "category": "Shopping",
                    "accountName": account_name,
                    "accountType": account_type,
                    "provider": provider,
                }
            )
    return transactions
