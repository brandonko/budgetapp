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
WALMART_DEFAULT_ACCOUNT = ("Walmart", "CREDIT CARD", "Walmart")
CAPITAL_ONE_DEFAULT_ACCOUNT = ("Capital One", "CREDIT CARD", "Capital One")
SCHWAB_DEFAULT_ACCOUNT = ("Schwab Checking", "BANK", "Charles Schwab")
WALMART_MERCHANT_STRINGS = ("walmart", "wal-mart", "wal mart", "wm supercenter")


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
    ignored_walmart_count: int = 0
    refund_indexes: tuple[int, ...] = ()


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
    ignore_walmart: bool = True,
    match_refunds: bool = False,
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
    ignored_walmart_count = 0
    refund_indexes: list[int] = []

    for index, raw in enumerate(raw_transactions):
        location = f"Credit Karma transaction[{index}]"
        transaction = require_mapping(raw, location)
        description = require_text(transaction, "description", location)
        normalized_description = re.sub(r"\s+", " ", description.casefold())
        transaction_type = require_text(transaction, "transactionType", location).casefold()
        if transaction_type not in {"credit", "debit"}:
            raise ImportDataError(f"{location}.transactionType must be credit or debit")
        merchant_credit = transaction_type == "credit" and any(
            merchant in normalized_description
            for merchant in ("amazon", "alipay", "ali express", "aliexpress", "venmo", "ebay", *WALMART_MERCHANT_STRINGS)
        )
        retain_refund = match_refunds and merchant_credit
        if not retain_refund and ignore_amazon and "amazon" in normalized_description:
            ignored_amazon_count += 1
            amazon_accounts.append(
                (
                    require_text(transaction, "accountName", location),
                    require_text(transaction, "accountType", location),
                    require_text(transaction, "provider", location),
                )
            )
            continue
        if not retain_refund and ignore_aliexpress and any(
            merchant in normalized_description
            for merchant in ("alipay", "ali express", "aliexpress")
        ):
            ignored_aliexpress_count += 1
            continue
        if not retain_refund and ignore_venmo and "venmo" in normalized_description:
            ignored_venmo_count += 1
            continue
        if not retain_refund and ignore_ebay and "ebay" in normalized_description:
            ignored_ebay_count += 1
            continue
        if not retain_refund and ignore_walmart and any(
            merchant in normalized_description
            for merchant in WALMART_MERCHANT_STRINGS
        ):
            ignored_walmart_count += 1
            continue

        unsigned_amount = abs(require_decimal(transaction, "amount", location))
        signed_amount = unsigned_amount if transaction_type == "debit" else -unsigned_amount
        if retain_refund and unsigned_amount:
            refund_indexes.append(len(transactions))
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
        ignored_walmart_count,
        tuple(refund_indexes),
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


def parse_schwab_checking(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse checking CSV only. Direction comes from Withdrawal/Deposit columns.

    Accept the legacy bank export and normalized/current column names. Never
    infer brokerage cash flows or retain export titles, balances or check numbers.
    """
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError("Schwab checking export is empty")
    if len(content.encode("utf-8")) > 16 * 1024 * 1024:
        raise ImportDataError("Schwab checking export exceeds 16 MB; use a shorter range")
    aliases = {"withdrawal (-)": "withdrawal", "deposit (+)": "deposit"}
    notices = {
        "posted transactions",
        "pending transactions are not reflected within this sort criterion.",
        "there were no transactions for the search criteria you selected.",
    }
    reader = csv.reader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
    transactions: list[dict[str, Any]] = []
    skipped = 0
    missing_interest_amounts = 0
    headers: list[str] | None = None
    title_seen = False
    identity = account_identity or SCHWAB_DEFAULT_ACCOUNT

    def money(value: str, location: str) -> Decimal:
        if not value:
            return Decimal(0)
        if not re.fullmatch(r"\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", value):
            raise ImportDataError(f"{location}: invalid Withdrawal/Deposit amount")
        result = Decimal(value.replace("$", "").replace(",", ""))
        if result > Decimal("1000000000"):
            raise ImportDataError(f"{location}: amount is too large")
        return result

    try:
        for index, raw in enumerate(reader, 1):
            if index > 100010:
                raise ImportDataError("Schwab checking export exceeds 100,000 rows")
            values = [cell.strip() for cell in raw]
            if not any(values):
                continue
            location = f"Schwab checking row {index}"
            if headers is None:
                if not title_seen and re.match(r"^Transactions\s+for\s+.+\s+as of\s+", values[0], re.I) and not any(values[1:]):
                    title_seen = True
                    continue
                headers = [aliases.get(v.casefold(), v.casefold()) for v in values]
                if (not all(headers) or len(set(headers)) != len(headers)
                        or not {"date", "type", "description", "withdrawal", "deposit"}.issubset(headers)
                        or {"action", "symbol", "quantity", "amount"}.intersection(headers)):
                    raise ImportDataError("Export one Schwab checking account as CSV with Date, Type, Description, Withdrawal and Deposit columns. Brokerage exports are not supported.")
                continue
            if values[0].casefold() in notices and not any(values[1:]):
                continue
            if len(values) != len(headers):
                raise ImportDataError(f"{location}: incomplete CSV row")
            record = dict(zip(headers, values))
            if "currency" in record and record["currency"].upper() != "USD":
                raise ImportDataError(f"{location}: only USD is supported")
            status = record.get("status", "posted").casefold()
            if status == "pending":
                skipped += 1
                continue
            if status != "posted":
                raise ImportDataError(f"{location}: unknown transaction status; export posted transactions")
            description = " ".join(record["description"].split())
            if not description:
                raise ImportDataError(f"{location}: description is required")
            transaction_date = _apple_card_date(record["date"], location)
            entry_type = record["type"].upper()
            if not (record["withdrawal"] or record["deposit"]):
                # Current Schwab exports can contain posted INTADJUST entries
                # without either amount. Missing is not zero: report and skip
                # these known entries, never reconstruct money from balances.
                if entry_type == "INTADJUST":
                    missing_interest_amounts += 1
                    continue
                raise ImportDataError(f"{location}: missing Withdrawal/Deposit amount")
            withdrawal = money(record["withdrawal"], location)
            deposit = money(record["deposit"], location)
            if withdrawal and deposit:
                raise ImportDataError(f"{location}: ambiguous Withdrawal/Deposit amounts")
            category = "Transfer" if entry_type == "TRANSFER" else "Uncategorized"
            if entry_type == "INTADJUST" and deposit:
                category = "Income"
            transactions.append({
                "date": transaction_date,
                "description": description, "amount": float(withdrawal - deposit),
                "category": category, "subcategory": "", "accountName": identity[0],
                "accountType": identity[1], "provider": identity[2],
            })
    except csv.Error as exc:
        raise ImportDataError("Schwab checking CSV is malformed") from exc
    if headers is None:
        raise ImportDataError("Schwab checking CSV headers are missing")
    warnings = [f"Skipped {skipped} pending Schwab transactions; import them after they post."] if skipped else []
    if missing_interest_amounts:
        row_label = "row" if missing_interest_amounts == 1 else "rows"
        warnings.append(
            f"Skipped {missing_interest_amounts} Schwab interest-adjustment {row_label} with no Withdrawal or Deposit amount. "
            "No amount was inferred; check the source export if you expected an interest payment."
        )
    return transactions, warnings


def parse_capital_one(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
) -> list[dict[str, Any]]:
    """Read Capital One's explicit debit/credit CSV layouts, never guess signs.

    Account numbers, card numbers, balances and posting dates are deliberately
    not retained. Reject a malformed export as a whole rather than silently
    dropping financial rows. Range filtering happens at the session boundary.
    """
    if not isinstance(content, str) or not content.strip():
        raise ImportDataError("Capital One export is empty")
    if len(content.encode("utf-8")) > 16 * 1024 * 1024:
        raise ImportDataError("Capital One export exceeds 16 MB; use a shorter range")
    reader = csv.reader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
    try:
        headers = [value.strip().casefold() for value in next(reader, [])]
        if len(set(headers)) != len(headers) or not all(headers):
            raise ImportDataError("Capital One CSV has blank or duplicate column names")
        card = {"transaction date", "description", "debit", "credit"}.issubset(headers)
        bank = {"transaction date", "transaction description", "transaction amount", "transaction type"}.issubset(headers)
        if card == bank:
            raise ImportDataError("Unrecognized Capital One CSV. Export CSV with Debit/Credit columns (card), or Transaction Amount/Transaction Type columns (bank).")
        identity = account_identity or ("Capital One", "CREDIT CARD" if card else "BANK", "Capital One")
        transactions = []

        def money(value: str, location: str) -> Decimal:
            if not re.fullmatch(r"-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", value):
                raise ImportDataError(f"{location}: invalid monetary amount")
            number = Decimal(value.replace("$", "").replace(",", ""))
            if abs(number) > Decimal("1000000000"):
                raise ImportDataError(f"{location}: amount is too large")
            return number

        for values in reader:
            if not any(value.strip() for value in values):
                continue
            location = f"Capital One CSV line {reader.line_num}"
            if len(values) != len(headers):
                raise ImportDataError(f"{location}: incorrect number of columns")
            row = dict(zip(headers, (value.strip() for value in values)))
            if row.get("currency", "USD").upper() not in {"", "USD"}:
                raise ImportDataError(f"{location}: only USD exports are supported")
            raw_date = row["transaction date"]
            parsed_date = None
            for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
                try:
                    parsed_date = datetime.strptime(raw_date, fmt).date().isoformat()
                    break
                except ValueError:
                    pass
            if parsed_date is None:
                raise ImportDataError(f"{location}: invalid Transaction Date")
            description = row["description" if card else "transaction description"]
            if not description:
                raise ImportDataError(f"{location}: description cannot be blank")
            if card:
                debit = money(row["debit"], location) if row["debit"] else Decimal(0)
                credit = money(row["credit"], location) if row["credit"] else Decimal(0)
                if (not row["debit"] and not row["credit"]) or debit < 0 or credit < 0 or (debit and credit):
                    raise ImportDataError(f"{location}: expected one nonnegative Debit or Credit amount")
                amount = debit - credit
            else:
                kind = row["transaction type"].casefold()
                if kind not in {"debit", "credit"}:
                    raise ImportDataError(f"{location}: unrecognized Transaction Type; expected Debit or Credit")
                amount = abs(money(row["transaction amount"], location)) * (1 if kind == "debit" else -1)
            transactions.append({
                "date": parsed_date, "description": " ".join(description.split()),
                "amount": as_money(amount), "category": row.get("category", "") or "Uncategorized",
                "subcategory": "", "accountName": identity[0], "accountType": identity[1],
                "provider": identity[2], "notes": "",
            })
            if len(transactions) > 100000:
                raise ImportDataError("Capital One CSV exceeds 100,000 transactions")
        return transactions
    except csv.Error as exc:
        raise ImportDataError("Capital One CSV is malformed") from exc


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


def parse_walmart(
    content: Any,
    account_identity: tuple[str, str, str] | None = None,
    *,
    start_date: str = "0001-01-01",
    end_date: str = "9999-12-31",
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate the companion's minimal receipt export; never infer missing prices.

    lineTotal already includes quantity. Allocate the final receipt total (tax,
    discounts, fees and tips included) by line value, using integer cents and
    largest remainders so even tiny totals cannot produce negative last lines.
    Refund/pending orders are explicitly omitted, not silently netted on a
    fabricated refund date. Their bank entries can still be imported separately.
    """
    root = require_mapping(load_json_text(content, "Walmart"), "Walmart document")
    if root.get("version") != 1 or isinstance(root.get("version"), bool):
        raise ImportDataError("Unsupported Walmart export version")
    orders = require_list(root.get("orders"), "Walmart orders")
    if len(orders) > 10000:
        raise ImportDataError("Walmart export exceeds 10,000 orders")
    identity = account_identity or WALMART_DEFAULT_ACCOUNT
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[str] = set()
    reasons = {
        "cancelled": "cancelled or unavailable",
        "pending": "not yet completed (prices may change)",
        "refund": "returned/refunded; import the charge and refund from your account instead",
    }

    def money(record: Mapping[str, Any], field: str, location: str) -> Decimal:
        value = require_decimal(record, field, location)
        if value < 0 or value > Decimal("1000000000") or value != value.quantize(CENT):
            raise ImportDataError(f"{location}.{field} must be a nonnegative USD cent amount")
        return value

    for index, raw in enumerate(orders):
        location = f"Walmart order[{index}]"
        order = require_mapping(raw, location)
        order_id = require_text(order, "orderId", location)
        if not re.fullmatch(r"[0-9-]{5,50}", order_id):
            raise ImportDataError(f"{location}.orderId is invalid")
        if order_id in seen:
            raise ImportDataError("Walmart export repeats an order; retry the collection")
        seen.add(order_id)
        order_date = require_date(order, "orderDate", location)
        if not start_date <= order_date <= end_date:
            continue
        skipped = order.get("skipReason")
        if skipped:
            if skipped not in reasons:
                raise ImportDataError(f"{location}.skipReason is unsupported")
            warnings.append(f"Order {order_id}: {reasons[skipped]}.")
            continue
        if order.get("currency") != "USD":
            raise ImportDataError(f"{location}.currency must be USD")
        total = money(order, "total", location)
        items = require_list(order.get("items"), f"{location}.items")
        if not items or len(items) > 1000:
            raise ImportDataError(f"{location} must have 1–1,000 item lines")
        parsed = []
        for item_index, raw_item in enumerate(items):
            item_location = f"{location}.items[{item_index}]"
            item = require_mapping(raw_item, item_location)
            title = require_text(item, "title", item_location)
            quantity = require_decimal(item, "quantity", item_location)
            if not 0 < quantity <= 10000:
                raise ImportDataError(f"{item_location}.quantity must be positive and at most 10,000")
            label = title if quantity == 1 else f"{title} (x{format(quantity.normalize(), 'f')})"
            parsed.append((label, int(money(item, "lineTotal", item_location) * 100)))
        cents = int(total * 100)
        weight = sum(value for _, value in parsed)
        if not weight and cents:
            raise ImportDataError(f"{location} has a paid total but no priced items")
        allocations = [cents * value // weight if weight else 0 for _, value in parsed]
        remainders = sorted(range(len(parsed)), key=lambda i: -(cents * parsed[i][1] % weight) if weight else 0)
        for i in remainders[:cents - sum(allocations)]:
            allocations[i] += 1
        for (description, _), amount in zip(parsed, allocations):
            rows.append({
                "date": order_date, "description": description, "amount": amount / 100,
                "category": "Shopping", "accountName": identity[0],
                "accountType": identity[1], "provider": identity[2],
                "notes": f"Walmart order: {order_id} · Receipt total allocated across items, including tax, fees, tips and discounts.",
            })
    return rows, warnings


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
