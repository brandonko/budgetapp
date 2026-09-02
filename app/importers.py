"""Parsers for transaction source exports used by the dashboard import API."""

from __future__ import annotations

import json
import re
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
    ignored_aliexpress_count: int


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


def parse_credit_karma(
    content: Any,
    *,
    ignore_amazon: bool = True,
    ignore_aliexpress: bool = True,
) -> CreditKarmaImport:
    document = load_json_text(content, "Credit Karma")
    root = require_mapping(document, "Credit Karma document")
    raw_transactions = require_list(root.get("transactions"), "Credit Karma document.transactions")
    transactions: list[dict[str, Any]] = []
    amazon_accounts: list[tuple[str, str, str]] = []
    ignored_amazon_count = 0
    ignored_aliexpress_count = 0

    for index, raw in enumerate(raw_transactions):
        location = f"Credit Karma transaction[{index}]"
        transaction = require_mapping(raw, location)
        description = require_text(transaction, "description", location)
        normalized_description = description.casefold()
        transaction_type = require_text(transaction, "transactionType", location).casefold()
        if transaction_type not in {"credit", "debit"}:
            raise ImportDataError(f"{location}.transactionType must be credit or debit")
        if ignore_amazon and "amazon" in normalized_description:
            ignored_amazon_count += 1
            amazon_accounts.append(
                (
                    require_text(transaction, "accountName", location),
                    require_text(transaction, "accountType", location),
                    require_text(transaction, "provider", location),
                )
            )
            continue
        if ignore_aliexpress and any(
            merchant in normalized_description
            for merchant in ("alipay", "ali express", "aliexpress")
        ):
            ignored_aliexpress_count += 1
            continue

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
    return CreditKarmaImport(
        transactions, amazon_account, ignored_amazon_count, ignored_aliexpress_count
    )


MONEY_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def parse_money_text(value: Any, location: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ImportDataError(f"{location} must contain a monetary amount")
    match = MONEY_NUMBER.search(str(value).replace("\u00a0", " "))
    if match is None:
        raise ImportDataError(f"{location} must contain a monetary amount")
    try:
        amount = Decimal(match.group(0).replace(",", ""))
    except InvalidOperation as exc:
        raise ImportDataError(f"{location} must contain a monetary amount") from exc
    if not amount.is_finite():
        raise ImportDataError(f"{location} must contain a finite monetary amount")
    return amount


def allocate_total(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Allocate an order total across item lines while preserving the exact cent total."""
    rounded_total = total.quantize(CENT, rounding=ROUND_HALF_UP)
    positive_total = sum((max(weight, Decimal(0)) for weight in weights), Decimal(0))
    if positive_total == 0:
        weights = [Decimal(1)] * len(weights)
        positive_total = Decimal(len(weights))
    allocated: list[Decimal] = []
    remaining = rounded_total
    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            share = remaining
        else:
            share = (rounded_total * max(weight, Decimal(0)) / positive_total).quantize(
                CENT, rounding=ROUND_HALF_UP
            )
            remaining -= share
        allocated.append(share)
    return allocated


def parse_aliexpress(content: Any) -> list[dict[str, Any]]:
    """Convert normalized AliExpress order/detail data into item-level transactions."""
    document = load_json_text(content, "AliExpress")
    root = require_mapping(document, "AliExpress document")
    raw_orders = require_list(root.get("orders"), "AliExpress document.orders")
    transactions: list[dict[str, Any]] = []

    for order_index, raw_order in enumerate(raw_orders):
        location = f"AliExpress order[{order_index}]"
        order = require_mapping(raw_order, location)
        status = str(order.get("status", "")).casefold()
        if any(word in status for word in ("cancelled", "canceled", "closed", "unpaid")):
            continue
        order_date = require_date(order, "orderDate", location)
        currency = str(order.get("currency", "USD") or "USD").upper().replace(" ", "")
        if currency not in {"USD", "US$", "$"}:
            raise ImportDataError(f"{location}.currency must be USD (found {currency})")
        items = require_list(order.get("items"), f"{location}.items")
        if not items:
            continue

        parsed_items: list[tuple[str, Decimal, int]] = []
        for item_index, raw_item in enumerate(items):
            item_location = f"{location}.items[{item_index}]"
            item = require_mapping(raw_item, item_location)
            title = require_text(item, "title", item_location)
            raw_quantity = item.get("quantity", 1)
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError, OverflowError) as exc:
                raise ImportDataError(f"{item_location}.quantity must be a positive integer") from exc
            if quantity < 1 or Decimal(str(raw_quantity)) != quantity:
                raise ImportDataError(f"{item_location}.quantity must be a positive integer")
            price = parse_money_text(item.get("price"), f"{item_location}.price")
            description = title if quantity == 1 else f"{title} (x{quantity})"
            parsed_items.append((description, abs(price), quantity))

        raw_total = order.get("total")
        if raw_total in (None, ""):
            weights = [price * quantity for _, price, quantity in parsed_items]
            amounts = [amount.quantize(CENT, rounding=ROUND_HALF_UP) for amount in weights]
        else:
            total = abs(parse_money_text(raw_total, f"{location}.total"))
            unit_price_weights = [price * quantity for _, price, quantity in parsed_items]
            line_total_weights = [price for _, price, _quantity in parsed_items]
            weights = min(
                (unit_price_weights, line_total_weights),
                key=lambda candidates: abs(sum(candidates, Decimal(0)) - total),
            )
            amounts = allocate_total(total, weights)

        for (description, _price, _quantity), amount in zip(parsed_items, amounts):
            transactions.append(
                {
                    "date": order_date,
                    "description": description,
                    "amount": as_money(amount),
                    "category": "Shopping",
                    "accountName": "AliExpress",
                    "accountType": "AliExpress",
                    "provider": "AliExpress",
                }
            )
    return transactions


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
