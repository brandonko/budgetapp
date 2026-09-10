"""Explicit full-refund proposals and legacy occurrence receipts, without I/O.

Old releases omitted the credit and recorded a receipt on the purchase. Keep
those receipts readable for deduplication. New confirmations retain the actual
credit and create an explicit link in server.py; the virtual receipt here is
only a revision-bound proposal and is not persisted for new refunds.
"""
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import re
import reconciliation

WINDOW_DAYS = 90
RECEIPT = re.compile(r"^refund-receipt-(\d{4}-\d{2}-\d{2})-([1-9]\d*)$")


def flags(row):
    return {part.strip().casefold() for part in row.get("flags", "").split(",") if part.strip()}


def identity(row):
    return row["date"], Decimal(str(row["amount"])).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)


def receipt_counts(rows):
    counts = Counter()
    for row in rows:
        for flag in flags(row):
            match = RECEIPT.fullmatch(flag)
            if match:
                day, cents = match.groups()
                try:
                    date.fromisoformat(day)
                except ValueError:
                    continue
                counts[(day, -Decimal(cents) / 100)] += 1
    return counts


def purchase_index(existing):
    buckets = defaultdict(list)
    consumed = {entry["transactionId"] for row in existing for entry in reconciliation.links(row)}
    for index, row in enumerate(existing):
        if (identity(row)[1] > 0 and not reconciliation.links(row) and row.get("id") not in consumed
                and not row.get("_isInternalTransfer") and not row.get("_linkRole")
                and not flags(row) & {"refunded", "internal-transfer"}
                and row.get("category", "").strip().casefold() != "income"):
            buckets[identity(row)[1]].append((index, row))
    return buckets


def candidates(existing, credit, buckets=None):
    day, amount = identity(credit)
    if (amount >= 0 or flags(credit) & {"refunded", "internal-transfer"}
            or credit.get("_linkRole") or credit.get("linkTo", {}).get("transactionId")):
        return []
    refund_day = date.fromisoformat(day).toordinal()
    matches = []
    if buckets is None:
        buckets = purchase_index(existing)
    for index, row in buckets.get(-amount, ()):
        age = refund_day - date.fromisoformat(row["date"]).toordinal()
        if 0 <= age <= WINDOW_DAYS:
            matches.append((index, row))
    def rank(item):
        index, row = item
        same_account = all(row.get(field, "").strip().casefold() == credit.get(field, "").strip().casefold()
                           for field in ("accountName", "provider"))
        return (not same_account, -date.fromisoformat(row["date"]).toordinal(), index)
    return [dict(row, _id=index) for index, row in sorted(matches, key=rank)]


def selections_by_id(selections):
    if not isinstance(selections, list) or len(selections) > 50_000:
        raise ValueError("refundSelections must be a list of at most 50000 matches")
    result = {}
    used = set()
    for selection in selections:
        if not isinstance(selection, dict) or set(selection) != {"stagedId", "purchaseId"}:
            raise ValueError("Each refund selection needs a stagedId and purchaseId")
        staged_id, target = selection["stagedId"], selection["purchaseId"]
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (staged_id, target)):
            raise ValueError("Refund and purchase IDs must be nonnegative integers")
        if staged_id in result or target in used:
            raise ValueError("Each refund and each purchase can be matched only once")
        result[staged_id] = target
        used.add(target)
    return result


def apply(existing, credits, selections, included_ids, buckets=None):
    """Validate explicit selections against server-owned source credits and a revision's rows."""
    choices = selections_by_id(selections)
    if buckets is None and choices:
        buckets = purchase_index(existing)
    updated = [dict(row) for row in existing]
    for staged_id, target in choices.items():
        if staged_id not in credits or staged_id in included_ids:
            raise ValueError("A matched refund must be an eligible source credit and must not also be imported")
        credit = credits[staged_id]
        if target not in {row["_id"] for row in candidates(existing, credit, buckets)}:
            raise ValueError("The chosen purchase is not an eligible exact-price refund match")
        day, amount = identity(credit)
        receipt = f"refund-receipt-{day}-{int(-amount * 100)}"
        updated[target]["flags"] = ",".join(sorted(flags(existing[target]) | {"refunded", receipt}))
    return updated, choices


def import_credits(preview, enabled=True):
    """Freeze eligible credit occurrences for every source's staged review."""
    consumed = {entry["transactionId"] for row in preview for entry in reconciliation.links(row)}
    return {row["_stagedId"]: dict(row) for row in preview
            if enabled and row["amount"] < 0 and not row["_isDuplicate"]
            and row.get("id") not in consumed and not row.get("repaymentTo")
            and not row.get("_isInternalTransfer") and not row.get("_linkRole")
            and not flags(row) & {"refunded", "internal-transfer", "include-in-budget"}}


def decorate(existing, preview, credits, selections):
    """Attach review-only suggestions; decisions do not rewrite the incoming credit."""
    included = {row["_stagedId"] for row in preview if row.get("_selected", not row["_isDuplicate"] and row["amount"] != 0)}
    updated, choices = apply(existing, credits, selections, included)
    # The same selected graph drives both suggestions and the shared editor.
    # Unselected and duplicate incoming purchases are never automatic candidates,
    # even when a duplicate has deliberately been selected for forced import.
    selected = sorted((dict(row) for row in preview if row["_stagedId"] in included),
                      key=lambda row: row["_stagedId"])
    resolved = reconciliation.apply_repayment_targets(updated + selected)
    if any(reconciliation.links(resolved[index]) for index in choices.values()):
        raise ValueError("Each refund and each purchase can be matched only once")
    eligible = [row for row in resolved if "_stagedId" not in row or not row["_isDuplicate"]]
    buckets = purchase_index(eligible) if credits else {}
    rows_by_id = {row["_stagedId"]: row for row in preview}
    consumed = {entry["transactionId"] for row in resolved for entry in reconciliation.links(row)}
    for staged_id in choices:
        row = rows_by_id.get(staged_id)
        if (row is None or row["_isDuplicate"] or identity(row) != identity(credits[staged_id])
                or row.get("repaymentTo") or row.get("linkTo", {}).get("transactionId")
                or row.get("_linkRole") or row.get("id") in consumed
                or flags(row) & {"refunded", "internal-transfer"}):
            raise ValueError("This refund changed. Undo its match and review it again")
    used_targets = set(choices.values())
    for row in preview:
        staged_id = row["_stagedId"]
        row["_refundPurchaseId"] = choices.get(staged_id)
        row["_refundCandidates"] = []
        credit = credits.get(staged_id)
        if (credit is None or row["_isDuplicate"] or row.get("_isInternalTransfer")
                or row.get("repaymentTo") or row.get("linkTo", {}).get("transactionId")
                or row.get("_linkRole") or row.get("id") in consumed
                or identity(row) != identity(credit)):
            continue
        row["_refundCandidates"] = [candidate for candidate in candidates(eligible, row, buckets)
            if candidate["_id"] not in used_targets or candidate["_id"] == choices.get(staged_id)]
    return updated, choices
