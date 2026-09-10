"""Explicit, deterministic transfer proposals. Never called to render saved rows."""

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import reconciliation

PAIR_PREFIX = "transfer-pair-"


def flags(row):
    return {part.strip().casefold() for part in row.get("flags", "").split(",") if part.strip()}


def public_row(row, index):
    saved_flags = flags(row)
    excluded = "internal-transfer" in saved_flags
    automatic = excluded and any(flag.startswith(PAIR_PREFIX) for flag in saved_flags)
    return dict(row, _id=index, _isBillPayment=automatic, _isInternalTransfer=excluded,
                _internalTransferSource="automatic" if automatic else "manual" if excluded else "")


def find_pairs(rows, pattern, window=5, incoming_start=None, *, include_unpaired_exclusions=False, excluded_ids=(), nonzero_decimal=False):
    """Closest-date, one-to-one pairs; bucket by opposite amount and nearby date.

    Already excluded/paired rows and explicit budget overrides cannot be reused.
    An import only proposes pairs involving at least one selected incoming row.
    Initial upgrade review can include unpaired manual exclusions to preserve
    their counterparts under the legacy matcher; saved pairs are never reused.
    """
    buckets = defaultdict(list)
    candidates = []
    linked = {entry["transactionId"] for row in rows for entry in reconciliation.links(row)}
    for index, row in enumerate(rows):
        if index in excluded_ids:
            continue
        saved_flags = flags(row)
        if reconciliation.links(row) or row.get("id") in linked:
            continue
        paired = any(flag.startswith(PAIR_PREFIX) for flag in saved_flags)
        if ("include-in-budget" in saved_flags or paired
                or ("internal-transfer" in saved_flags and not include_unpaired_exclusions)):
            continue
        amount = Decimal(str(row["amount"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if not amount or (nonzero_decimal and amount == amount.to_integral_value()):
            continue
        day = date.fromisoformat(row["date"]).toordinal()
        identity = tuple(row.get(field, "").strip().casefold()
                         for field in ("accountName", "accountType", "provider"))
        transfer = (row.get("category", "").strip().casefold() == "transfer"
                    or pattern.search(" ".join(row["description"].split())) is not None)
        for other_day in range(day - window, day + window + 1):
            for other, other_account, other_transfer in buckets.get((-amount, other_day), ()):
                if incoming_start is not None and index < incoming_start:
                    continue
                if identity != other_account and (transfer or other_transfer):
                    candidates.append((abs(day - other_day), other, index))
        buckets[(amount, day)].append((index, identity, transfer))
    used = set()
    result = []
    for distance, left, right in sorted(candidates):
        if left not in used and right not in used:
            used.update((left, right))
            result.append((left, right))
    return result


def proposal(rows, pairs, revision):
    """Build a portable preview and exact durable flags without mutating inputs."""
    updated = [dict(row) for row in rows]
    pair_ids = {}
    for left, right in pairs:
        pair = PAIR_PREFIX + hashlib.sha256(f"{revision}:{left}:{right}".encode()).hexdigest()[:32]
        for index in (left, right):
            updated[index]["flags"] = ",".join(sorted(flags(rows[index]) | {"internal-transfer", pair}))
            pair_ids[index] = pair
        parent, child = (left, right) if reconciliation.cents(rows[left]) > 0 else (right, left)
        if rows[child].get("id"):
            updated[parent]["links"] = reconciliation.encode_links([
                {"transactionId": rows[child]["id"], "type": "transfer"}])
    return updated, pair_ids
