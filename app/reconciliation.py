"""Durable transaction identities and explicit, shallow reconciliation links.

Amounts remain source amounts. Links form disjoint stars: one purchase and its
credit(s), never chains, cycles, or a credit consumed by two purchases. All I/O,
revision checks and confirmation belong to the server's existing CSV boundary.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
import secrets

KINDS = {"refund", "transfer", "repayment"}
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


def cents(row):
    return int(Decimal(str(row["amount"])).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) * 100)


def links(row):
    value = row.get("links", "")
    if value == "" or value == []:
        return []
    try:
        value = json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError) as exc:
        raise ValueError("Transaction links must contain valid JSON") from exc
    if not isinstance(value, list) or len(value) > 500:
        raise ValueError("Use at most 500 linked transactions per purchase")
    result = []
    for item in value:
        if (not isinstance(item, dict) or set(item) != {"transactionId", "type"}
                or not isinstance(item["type"], str) or item["type"] not in KINDS
                or not isinstance(item["transactionId"], str)
                or not IDENTIFIER.fullmatch(item["transactionId"])):
            raise ValueError("Each link needs a valid transactionId and refund, transfer, or repayment type")
        result.append(dict(item))
    return result


def encode_links(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True) if value else ""


def identified(rows, seed=None):
    """Assign missing IDs once, or reproducibly for a revision-bound preview."""
    result = [dict(row) for row in rows]
    used = set()
    for row in result:
        identity = row.get("id", "")
        if identity:
            if not isinstance(identity, str) or not IDENTIFIER.fullmatch(identity):
                raise ValueError("Transaction id must be a valid immutable identifier")
            if identity in used:
                raise ValueError("Transaction IDs must be unique")
            used.add(identity)
    for index, row in enumerate(result):
        if row.get("id"):
            continue
        attempt = 0
        while True:
            identity = (hashlib.sha256(f"ledger:{seed}:{index}:{attempt}".encode()).hexdigest()[:32]
                        if seed is not None else secrets.token_hex(16))
            if identity not in used:
                break
            attempt += 1
        row["id"] = identity
        used.add(identity)
    return result


def validate(rows):
    by_id = {}
    for row in rows:
        identity = row.get("id", "")
        if identity:
            if identity in by_id:
                raise ValueError("Transaction IDs must be unique")
            by_id[identity] = row
    owners = {}
    for parent in rows:
        entries = links(parent)
        if not entries:
            continue
        parent_id = parent.get("id")
        if not parent_id or cents(parent) <= 0:
            raise ValueError("Link repayments or refunds from the original positive-amount purchase")
        types = {entry["type"] for entry in entries}
        if ("refund" in types or "transfer" in types) and len(entries) != 1:
            raise ValueError("Refunds and transfers are one-to-one; use repayments for multiple credits")
        for entry in entries:
            child_id = entry["transactionId"]
            if child_id == parent_id:
                raise ValueError("A transaction cannot link to itself")
            child = by_id.get(child_id)
            if child is None:
                raise ValueError("A linked transaction is missing. Include its counterpart or unlink it first")
            if child_id in owners:
                raise ValueError("A credit can belong to only one purchase; unlink its current match first")
            if links(child):
                raise ValueError("Linked transactions cannot form chains or cycles")
            if cents(child) >= 0:
                raise ValueError("A refund, transfer credit, or repayment must have a negative stored amount")
            if entry["type"] == "transfer" and cents(parent) + cents(child) != 0:
                raise ValueError("Internal transfers must have equal and opposite amounts; keep any fee as a separate expense")
            if entry["type"] == "transfer" and all(parent.get(f, "").casefold() == child.get(f, "").casefold()
                                                        for f in ("accountName", "accountType", "provider")):
                raise ValueError("Internal transfers must link different accounts")
            owners[child_id] = parent_id
    return by_id, owners


def set_links(rows, parent_id, entries):
    updated = [dict(row) for row in rows]
    target = next((row for row in updated if row.get("id") == parent_id), None)
    if target is None:
        raise ValueError("The original transaction no longer exists")
    previous = links(target)
    target["links"] = encode_links(links({"links": entries}))
    # Explicit links supersede legacy exclusion flags only on the affected pair.
    touched = {parent_id} | {item["transactionId"] for item in previous + entries}
    for row in updated:
        if row.get("id") in touched and previous != entries:
            row["flags"] = ",".join(flag for flag in row.get("flags", "").split(",")
                if flag not in {"refunded", "internal-transfer", "include-in-budget"}
                and not flag.startswith("transfer-pair-"))
    validate(updated)
    return updated


def apply_repayment_targets(rows):
    """Resolve credit-side editor intents into canonical purchase-owned links.

    This request-only field never becomes a CSV column. Copy before editing so
    preview, cancel, and failed validation cannot mutate the caller's rows.
    """
    updated = [dict(row) for row in rows]
    intents = []
    for row in updated:
        if "linkTo" in row and "repaymentTo" in row:
            raise ValueError("Choose a single link target")
        if "repaymentTo" in row:
            intents.append((row.get("id"), row.pop("repaymentTo"), "repayment", False))
        if "linkTo" in row:
            target = row.pop("linkTo")
            if (not isinstance(target, dict) or set(target) != {"transactionId", "type"}
                    or target["type"] not in ("repayment", "refund", "transfer")):
                raise ValueError("Choose a valid link target and type")
            intents.append((row.get("id"), target["transactionId"], target["type"], True))
    for credit_id, target_id, kind, explicit in intents:
        if not isinstance(target_id, str) or (target_id and not IDENTIFIER.fullmatch(target_id)):
            raise ValueError("repaymentTo must be a purchase identifier or blank to unlink")
        by_id, owners = validate(updated)
        credit = by_id.get(credit_id)
        if credit is None or cents(credit) >= 0:
            raise ValueError("Only a negative-amount repayment can be linked to an original purchase")
        owner_id = owners.get(credit_id)
        if not explicit and owner_id and any(entry["type"] != "repayment" for entry in links(by_id[owner_id])):
            raise ValueError("This credit is linked as a refund or transfer. Unlink it from the original transaction first")
        if target_id == (owner_id or "") and (not owner_id or links(by_id[owner_id])[0]["type"] == kind):
            continue
        target = by_id.get(target_id) if target_id else None
        if target_id and (target is None or cents(target) <= 0 or target_id in owners
                          or any(entry["transactionId"] != credit_id and (entry["type"] != kind or kind != "repayment")
                                 for entry in links(target))):
            raise ValueError("Choose an available positive-amount purchase; refunds and transfers cannot also have repayments")
        if owner_id:
            updated = set_links(updated, owner_id,
                [entry for entry in links(by_id[owner_id]) if entry["transactionId"] != credit_id])
        if target_id:
            target = next(row for row in updated if row.get("id") == target_id)
            updated = set_links(updated, target_id,
                links(target) + [{"transactionId": credit_id, "type": kind}])
    return updated


def validate_mutation(before, after):
    """Budget-treatment flags cannot override an explicit relationship."""
    by_id, owners = validate(after)
    original = {row.get("id"): row for row in before}
    treatment = {"refunded", "internal-transfer", "include-in-budget"}
    for identity, row in by_id.items():
        old = original.get(identity)
        if old is None or not (links(row) or identity in owners):
            continue
        added = set(row.get("flags", "").split(",")) - set(old.get("flags", "").split(","))
        if added & treatment:
            raise ValueError("Linked transactions use their net amount. Unlink the original purchase before changing its budget treatment")


def migrate_legacy_pairs(rows):
    """Upgrade only exact saved two-member pairs; never guess missing credits."""
    updated = identified(rows)
    buckets = defaultdict(list)
    for row in updated:
        for flag in row.get("flags", "").split(","):
            if flag.startswith("transfer-pair-"):
                buckets[flag].append(row)
    used = {entry["transactionId"] for row in updated for entry in links(row)}
    used.update(row["id"] for row in updated if links(row))
    for family in buckets.values():
        if len(family) != 2 or any(row["id"] in used for row in family):
            continue
        parent, child = sorted(family, key=cents, reverse=True)
        previous = parent.get("links", "")
        parent["links"] = encode_links([{"transactionId": child["id"], "type": "transfer"}])
        try:
            validate(updated)
        except ValueError:
            parent["links"] = previous
        else:
            used.update(row["id"] for row in family)
    return updated


def unlink_deleted(rows, remaining):
    """Explicit deletion removes dangling references; surviving source rows remain."""
    present = {row.get("id") for row in remaining}
    result = [dict(row) for row in remaining]
    detached = set()
    for row in rows:
        family = {row.get("id")} | {entry["transactionId"] for entry in links(row)}
        if family - present:
            detached.update(family & present)
    for row in result:
        row["links"] = encode_links([entry for entry in links(row) if entry["transactionId"] in present])
        if row.get("id") in detached:
            row["flags"] = ",".join(flag for flag in row.get("flags", "").split(",")
                if flag not in {"internal-transfer", "refunded"} and not flag.startswith("transfer-pair-"))
    return result


def decorate(rows):
    """Linear projection of persisted relationships, NOT heuristic matching."""
    by_id, owners = validate(rows)
    result = [dict(row) for row in rows]
    for row in result:
        entries = links(row)
        parent_id = owners.get(row.get("id"))
        if not entries and not parent_id:
            continue
        parent = by_id[parent_id] if parent_id else row
        family = links(parent)
        kind = family[0]["type"]
        net = (cents(parent) + sum(cents(by_id[item["transactionId"]]) for item in family)) / 100
        row.update(_linkType=kind, _linkRole="credit" if parent_id else "primary",
                   _budgetAmount=0 if parent_id else net, _netAmount=net)
        if parent_id:
            # Keep large parent link arrays out of every child's read-only preview.
            row["_linkedTo"] = {**{key: value for key, value in by_id[parent_id].items() if key != "links"}, "_linkType": kind}
        else:
            row["_linkedTransactions"] = [{**by_id[item["transactionId"]], "_linkType": item["type"]} for item in family]
        if kind == "transfer":
            row.update(_isInternalTransfer=True, _isBillPayment=True, _internalTransferSource="linked")
        else:
            row.update(_isInternalTransfer=False, _isBillPayment=False, _internalTransferSource="")
        row["_isLinkedRefund"] = kind == "refund" and not parent_id and net == 0
    return result


def export_closure(rows, selected):
    by_id, owners = validate(rows)
    wanted = {row.get("id") for row in selected if row.get("id")}
    for identity in list(wanted):
        parent_id = owners.get(identity, identity)
        wanted.add(parent_id)
        wanted.update(entry["transactionId"] for entry in links(by_id[parent_id]))
    selected_objects = {id(row) for row in selected}
    return [row for row in rows if id(row) in selected_objects or row.get("id") in wanted]


def prepare_incoming(existing, rows, seed):
    """Fresh imported occurrences never reuse an existing durable identity."""
    used = {row.get("id") for row in existing}
    pending = [dict(row) for row in rows]
    old_ids = [row.get("id", "") for row in pending]
    if len([value for value in old_ids if value]) != len({value for value in old_ids if value}):
        raise ValueError("The import contains duplicate transaction IDs")
    for row in pending:
        if row.get("id") in used:
            row.pop("id", None)
    pending = identified(pending, seed)
    remap = {old: row["id"] for old, row in zip(old_ids, pending) if old}
    for row in pending:
        if row.get("linkTo", {}).get("transactionId"):
            row["linkTo"] = {**row["linkTo"], "transactionId": remap.get(row["linkTo"]["transactionId"], row["linkTo"]["transactionId"])}
        if row.get("repaymentTo"):
            row["repaymentTo"] = remap.get(row["repaymentTo"], row["repaymentTo"])
        row["links"] = encode_links([{**entry, "transactionId": remap.get(entry["transactionId"], entry["transactionId"])}
                                     for entry in links(row)])
    return pending
