"""Parsers for transaction source exports used by the dashboard import API."""

from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping


CENT = Decimal("0.01")
AMAZON_TAX_MULTIPLIER = Decimal("1.10502")
AMAZON_DEFAULT_ACCOUNT = ("Prime VISA", "CREDIT CARD", "chase")
ALIEXPRESS_DEFAULT_ACCOUNT = (
    "Credit Card Mastercard",
    "CREDIT CARD",
    "Bank of America",
)
VENMO_DEFAULT_ACCOUNT = ("Checking Account", "BANK", "Bank of America")
APPLE_CARD_DEFAULT_ACCOUNT = ("Apple Card", "CREDIT CARD", "Goldman Sachs")
EBAY_DEFAULT_ACCOUNT = ("eBay", "CREDIT CARD", "eBay")


class ImportDataError(ValueError):
    """Raised when an uploaded export has an invalid schema or value."""


@dataclass(frozen=True)
class CreditKarmaImport:
    transactions: list[dict[str, Any]]
    amazon_account: tuple[str, str, str] | None
    ignored_amazon_count: int
    ignored_aliexpress_count: int
    ignored_venmo_count: int
    ignored_ebay_count: int


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
    ignore_venmo: bool = True,
    ignore_ebay: bool = True,
) -> CreditKarmaImport:
    document = load_json_text(content, "Credit Karma")
    root = require_mapping(document, "Credit Karma document")
    raw_transactions = require_list(root.get("transactions"), "Credit Karma document.transactions")
    transactions: list[dict[str, Any]] = []
    amazon_accounts: list[tuple[str, str, str]] = []
    ignored_amazon_count = 0
    ignored_aliexpress_count = 0
    ignored_venmo_count = 0
    ignored_ebay_count = 0

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
        if ignore_venmo and "venmo" in normalized_description:
            ignored_venmo_count += 1
            continue
        if ignore_ebay and "ebay" in normalized_description:
            ignored_ebay_count += 1
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
                "notes": "",
            }
        )

    amazon_account = Counter(amazon_accounts).most_common(1)[0][0] if amazon_accounts else None
    return CreditKarmaImport(
        transactions,
        amazon_account,
        ignored_amazon_count,
        ignored_aliexpress_count,
        ignored_venmo_count,
        ignored_ebay_count,
    )


VENMO_REQUIRED_COLUMNS = {
    "datetime",
    "type",
    "status",
    "note",
    "from",
    "to",
    "amount (total)",
}
VENMO_SKIPPED_STATUSES = {"cancelled", "canceled", "declined", "failed", "pending", "reversed"}
VENMO_TRANSFER_TYPES = {
    "bank transfer",
    "cashout",
    "instant transfer",
    "standard transfer",
    "transfer",
}


def _venmo_date(value: str, location: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ImportDataError(f"{location}.Datetime cannot be blank")
    iso_candidate = cleaned.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_candidate).date().isoformat()
    except ValueError:
        pass
    for pattern in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(cleaned, pattern).date().isoformat()
        except ValueError:
            continue
    raise ImportDataError(f"{location}.Datetime is not a recognized Venmo date")


def _venmo_amount(value: str, location: str) -> Decimal:
    cleaned = str(value or "").strip().replace("\u00a0", " ")
    negative_parentheses = cleaned.startswith("(") and cleaned.endswith(")")
    match = re.search(r"[+-]?\s*\$?\s*\d[\d,]*(?:\.\d+)?", cleaned)
    if match is None:
        raise ImportDataError(f"{location}.Amount (total) must contain a monetary amount")
    token = re.sub(r"[\s$,]", "", match.group(0))
    try:
        amount = Decimal(token)
    except InvalidOperation as exc:
        raise ImportDataError(f"{location}.Amount (total) must contain a monetary amount") from exc
    if negative_parentheses:
        amount = -abs(amount)
    if not amount.is_finite():
        raise ImportDataError(f"{location}.Amount (total) must be finite")
    return amount


def _parse_venmo_csv(content: str, statement_index: int) -> list[dict[str, Any]]:
    rows = list(csv.reader(io.StringIO(content.lstrip("\ufeff"), newline="")))
    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if VENMO_REQUIRED_COLUMNS.issubset({cell.strip().casefold() for cell in row})
        ),
        None,
    )
    if header_index is None:
        raise ImportDataError(
            f"Venmo statement[{statement_index}] does not contain the expected transaction columns"
        )
    header = [cell.strip() for cell in rows[header_index]]
    transactions: list[dict[str, Any]] = []
    for row_index, values in enumerate(rows[header_index + 1 :], start=header_index + 2):
        if not values or not any(cell.strip() for cell in values):
            continue
        record = {
            column.casefold(): (values[index].strip() if index < len(values) else "")
            for index, column in enumerate(header)
        }
        location = f"Venmo statement[{statement_index}] row {row_index}"
        raw_datetime = record.get("datetime", "")
        raw_amount = record.get("amount (total)", "")
        if not raw_datetime and not raw_amount:
            continue
        status = record.get("status", "").casefold()
        if status in VENMO_SKIPPED_STATUSES:
            continue
        transaction_type = record.get("type", "").strip()
        if transaction_type.casefold() in VENMO_TRANSFER_TYPES:
            # The payment rows already represent the budget event. Importing a
            # Venmo balance transfer as well would count the same money twice.
            continue
        venmo_amount = _venmo_amount(raw_amount, location)
        if venmo_amount == 0:
            continue
        outgoing = venmo_amount < 0
        counterparty = record.get("to" if outgoing else "from", "").strip()
        note = record.get("note", "").strip()
        description_parts = [part for part in (counterparty, note) if part]
        description = " — ".join(description_parts) or transaction_type or "Venmo transaction"
        transactions.append(
            {
                "date": _venmo_date(raw_datetime, location),
                "description": description,
                # Venmo signs money from the wallet's perspective; Ledger signs
                # expenses positive and income negative.
                "amount": as_money(-venmo_amount),
                "category": "Venmo",
                "accountName": "Venmo",
                "accountType": "WALLET",
                "provider": "Venmo",
                "notes": "",
            }
        )
    return transactions


def parse_venmo(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    """Parse one or more official Venmo statement CSV downloads."""
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError("Venmo export is empty")
    statements = [content]
    if content.lstrip().startswith("{"):
        document = load_json_text(content, "Venmo")
        root = require_mapping(document, "Venmo document")
        raw_statements = require_list(root.get("statements"), "Venmo document.statements")
        statements = []
        for index, statement in enumerate(raw_statements):
            if isinstance(statement, str):
                statements.append(statement)
            elif isinstance(statement, Mapping) and isinstance(statement.get("content"), str):
                statements.append(statement["content"])
            else:
                raise ImportDataError(f"Venmo document.statements[{index}] must contain CSV text")
    transactions: list[dict[str, Any]] = []
    for index, statement in enumerate(statements):
        transactions.extend(_parse_venmo_csv(statement, index))
    account_name, account_type, provider = account_identity or VENMO_DEFAULT_ACCOUNT
    for transaction in transactions:
        transaction.update(
            accountName=account_name,
            accountType=account_type,
            provider=provider,
        )
    return transactions


APPLE_CARD_REQUIRED_COLUMNS = {
    "transaction date",
    "description",
    "category",
    "type",
}
APPLE_CARD_EXPENSE_TYPES = {"purchase", "debit"}
APPLE_CARD_CREDIT_TYPES = {"credit", "payment", "refund"}


def _apple_card_date(value: str, location: str) -> str:
    cleaned = value.strip()
    for pattern in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(cleaned, pattern).date().isoformat()
        except ValueError:
            continue
    raise ImportDataError(f"{location}.Transaction Date is not a recognized date")


def parse_apple_card(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    """Parse Apple's official Apple Card transaction CSV export."""
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError("Apple Card export is empty")
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""))
    original_headers = [str(header or "").strip() for header in (reader.fieldnames or [])]
    normalized_headers = {header.casefold(): header for header in original_headers}
    if not APPLE_CARD_REQUIRED_COLUMNS.issubset(normalized_headers):
        missing = sorted(APPLE_CARD_REQUIRED_COLUMNS - set(normalized_headers))
        raise ImportDataError(
            f"Apple Card CSV is missing columns: {', '.join(missing)}"
        )
    amount_header = next(
        (header for header in original_headers if header.casefold().startswith("amount")),
        None,
    )
    if amount_header is None:
        raise ImportDataError("Apple Card CSV is missing an Amount column")

    account_name, account_type, provider = account_identity or APPLE_CARD_DEFAULT_ACCOUNT
    transactions: list[dict[str, Any]] = []
    for row_number, raw_row in enumerate(reader, start=2):
        record = {
            str(key or "").strip().casefold(): str(value or "").strip()
            for key, value in raw_row.items()
        }
        if not any(record.values()):
            continue
        location = f"Apple Card row {row_number}"
        raw_amount = record.get(amount_header.casefold(), "")
        amount = parse_money_text(raw_amount, f"{location}.Amount")
        transaction_type = record["type"].casefold()
        if transaction_type in APPLE_CARD_EXPENSE_TYPES:
            amount = abs(amount)
        elif transaction_type in APPLE_CARD_CREDIT_TYPES:
            amount = -abs(amount)
        else:
            source_type = record["type"] or "<blank>"
            raise ImportDataError(
                f"{location}.Type is not supported: {source_type}"
            )

        description = record["description"] or record.get("merchant", "")
        if not description:
            raise ImportDataError(f"{location}.Description cannot be blank")
        category = record["category"] or "Uncategorized"
        if transaction_type == "payment":
            category = "Transfer"
        transactions.append(
            {
                "date": _apple_card_date(record["transaction date"], location),
                "description": description,
                "amount": as_money(amount),
                "category": category,
                "accountName": account_name,
                "accountType": account_type,
                "provider": provider,
                "notes": "",
            }
        )
    return transactions


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


def parse_aliexpress(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    """Convert normalized AliExpress order/detail data into item-level transactions."""
    document = load_json_text(content, "AliExpress")
    root = require_mapping(document, "AliExpress document")
    raw_orders = require_list(root.get("orders"), "AliExpress document.orders")
    transactions: list[dict[str, Any]] = []
    account_name, account_type, provider = account_identity or ALIEXPRESS_DEFAULT_ACCOUNT

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
                    "accountName": account_name,
                    "accountType": account_type,
                    "provider": provider,
                    "notes": "",
                }
            )
    return transactions


def parse_ebay(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    """Convert normalized eBay purchase-history data into item-level transactions."""
    document = load_json_text(content, "eBay")
    root = require_mapping(document, "eBay document")
    raw_orders = require_list(root.get("orders"), "eBay document.orders")
    account_name, account_type, provider = account_identity or EBAY_DEFAULT_ACCOUNT
    transactions: list[dict[str, Any]] = []

    for order_index, raw_order in enumerate(raw_orders):
        location = f"eBay order[{order_index}]"
        order = require_mapping(raw_order, location)
        status = str(order.get("status", "")).casefold()
        if any(word in status for word in ("cancelled", "canceled", "unpaid", "payment failed")):
            continue
        order_date = require_date(order, "orderDate", location)
        items = require_list(order.get("items"), f"{location}.items")
        if not items:
            continue

        parsed_items: list[tuple[str, Decimal, int, str]] = []
        for item_index, raw_item in enumerate(items):
            item_location = f"{location}.items[{item_index}]"
            item = require_mapping(raw_item, item_location)
            title = require_text(item, "title", item_location)
            raw_quantity = item.get("quantity", 1)
            try:
                quantity = int(raw_quantity)
                exact_quantity = Decimal(str(raw_quantity))
            except (TypeError, ValueError, InvalidOperation, OverflowError) as exc:
                raise ImportDataError(f"{item_location}.quantity must be a positive integer") from exc
            if quantity < 1 or exact_quantity != quantity:
                raise ImportDataError(f"{item_location}.quantity must be a positive integer")
            currency = str(item.get("currency") or order.get("currency") or "USD").upper().replace(" ", "")
            if currency not in {"USD", "US$", "$"}:
                raise ImportDataError(f"{item_location}.currency must be USD (found {currency})")
            raw_price = item.get("price")
            price = (
                abs(parse_money_text(raw_price, f"{item_location}.price"))
                if raw_price not in (None, "")
                else Decimal(0)
            )
            description = title if quantity == 1 else f"{title} (x{quantity})"
            seller = str(item.get("seller", "") or "").strip()
            parsed_items.append((description, price, quantity, seller))

        raw_total = order.get("total")
        weights = [price * quantity for _description, price, quantity, _seller in parsed_items]
        if raw_total not in (None, ""):
            total = abs(parse_money_text(raw_total, f"{location}.total"))
            amounts = allocate_total(total, weights)
        else:
            if any(weight <= 0 for weight in weights):
                raise ImportDataError(f"{location} must include an order total or every item price")
            amounts = [weight.quantize(CENT, rounding=ROUND_HALF_UP) for weight in weights]

        order_id = str(order.get("orderId", "") or "").strip()
        for (description, _price, _quantity, seller), amount in zip(parsed_items, amounts):
            note_parts = []
            if seller:
                note_parts.append(f"Seller: {seller}")
            if order_id:
                note_parts.append(f"Order: {order_id}")
            transactions.append(
                {
                    "date": order_date,
                    "description": description,
                    "amount": as_money(amount),
                    "category": "Shopping",
                    "accountName": account_name,
                    "accountType": account_type,
                    "provider": provider,
                    "notes": " · ".join(note_parts),
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

    account_name, account_type, provider = amazon_account or AMAZON_DEFAULT_ACCOUNT
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
                    "notes": "",
                }
            )
    return transactions
