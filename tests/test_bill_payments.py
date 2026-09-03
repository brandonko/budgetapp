from __future__ import annotations

import sys
import unittest
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

from server import find_bill_payment_ids, preview_imported_transactions, public_state  # noqa: E402


def transaction(
    *,
    date: str,
    amount: float,
    category: str,
    account_type: str,
    description: str = "Test transaction",
    flags: str = "",
    account_name: str | None = None,
) -> dict[str, object]:
    return {
        "date": date,
        "description": description,
        "amount": amount,
        "category": category,
        "accountName": account_name or f"{account_type} account",
        "accountType": account_type,
        "provider": "Test provider",
        "flags": flags,
    }


class BillPaymentReconciliationTests(unittest.TestCase):
    def test_matches_standard_payment_when_credit_side_is_income(self) -> None:
        transactions = [
            transaction(date="2026-01-08", amount=-34.37, category="Income", account_type="CREDIT"),
            transaction(date="2026-01-08", amount=34.37, category="Transfer", account_type="BANK"),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), {0, 1})

    def test_matches_credit_balance_refund_in_reverse_direction(self) -> None:
        transactions = [
            transaction(
                date="2026-05-08",
                amount=2230.70,
                category="Transfer",
                account_type="CREDIT",
                description="ACH CREDIT BALANCE REF",
            ),
            transaction(
                date="2026-05-08",
                amount=-2230.70,
                category="Income",
                account_type="BANK",
                description="BANK OF AMERICA DES:Credit Bal",
            ),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), {0, 1})

    def test_does_not_match_two_income_transactions(self) -> None:
        transactions = [
            transaction(date="2026-05-08", amount=-100.00, category="Income", account_type="BANK"),
            transaction(date="2026-05-08", amount=100.00, category="Income", account_type="CREDIT"),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), set())

    def test_does_not_hide_unmatched_bank_transfer(self) -> None:
        transactions = [
            transaction(date="2026-05-08", amount=150.00, category="Transfer", account_type="BANK"),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), set())

    def test_does_not_match_an_ordinary_purchase_and_refund(self) -> None:
        transactions = [
            transaction(
                date="2026-05-08",
                amount=100.00,
                category="Shopping",
                account_type="CREDIT",
                account_name="First card",
                description="CARD PURCHASE",
            ),
            transaction(
                date="2026-05-09",
                amount=-100.00,
                category="Shopping",
                account_type="CREDIT",
                account_name="Second card",
                description="MERCHANT REFUND",
            ),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), set())

    def test_matches_transfer_between_two_bank_accounts(self) -> None:
        transactions = [
            transaction(
                date="2026-08-24",
                amount=2223.09,
                category="Transfer",
                account_type="BANK",
                account_name="Savings Account",
                description="Online Banking transfer to CHK 2051 Confirmation# 11714",
            ),
            transaction(
                date="2026-08-24",
                amount=-2223.09,
                category="Transfer",
                account_type="BANK",
                account_name="Checking Account",
                description="Online Banking transfer from SAV 9417 Confirmation# 11714",
            ),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), {0, 1})

    def test_does_not_pair_opposite_entries_within_the_same_account(self) -> None:
        transactions = [
            transaction(
                date="2026-08-24",
                amount=100.00,
                category="Transfer",
                account_type="BANK",
                account_name="Checking Account",
            ),
            transaction(
                date="2026-08-24",
                amount=-100.00,
                category="Income",
                account_type="BANK",
                account_name="Checking Account",
            ),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), set())

    def test_manual_internal_transfer_is_excluded_without_an_automatic_pair(self) -> None:
        transactions = [
            transaction(
                date="2026-05-08",
                amount=150.00,
                category="Transfer",
                account_type="BANK",
                flags="internal-transfer",
            ),
        ]

        [row] = public_state(transactions, "revision")["transactions"]
        self.assertTrue(row["_isInternalTransfer"])
        self.assertEqual(row["_internalTransferSource"], "manual")

    def test_include_in_budget_overrides_automatic_pair_detection(self) -> None:
        transactions = [
            transaction(
                date="2026-01-08",
                amount=-34.37,
                category="Income",
                account_type="CREDIT",
                flags="include-in-budget",
            ),
            transaction(
                date="2026-01-08",
                amount=34.37,
                category="Transfer",
                account_type="BANK",
            ),
        ]

        self.assertEqual(find_bill_payment_ids(transactions), set())
        rows = public_state(transactions, "revision")["transactions"]
        self.assertFalse(any(row["_isInternalTransfer"] for row in rows))

    def test_automatic_pair_is_exposed_as_internal_transfer(self) -> None:
        transactions = [
            transaction(date="2026-01-08", amount=-34.37, category="Income", account_type="CREDIT"),
            transaction(date="2026-01-08", amount=34.37, category="Transfer", account_type="BANK"),
        ]

        rows = public_state(transactions, "revision")["transactions"]
        self.assertTrue(all(row["_isInternalTransfer"] for row in rows))
        self.assertTrue(all(row["_internalTransferSource"] == "automatic" for row in rows))

    def test_import_preview_exposes_new_automatic_pair_as_internal_transfer(self) -> None:
        parsed = [
            transaction(
                date="2026-08-31",
                amount=-334.47,
                category="Income",
                account_type="BANK",
                account_name="Credit Card Mastercard",
                description="ONLINE/MOBILE RECURRING FROM CHK 2051",
            ),
            transaction(
                date="2026-08-31",
                amount=334.47,
                category="Business services",
                account_type="BANK",
                account_name="Checking Account",
                description="Online Scheduled Payment to ACCT# 9215 Confirmation# 94455",
            ),
        ]

        preview, new_count, duplicate_count = preview_imported_transactions(
            [], parsed, "creditkarma", [False, False]
        )

        self.assertEqual((new_count, duplicate_count), (2, 0))
        self.assertTrue(all(row["_isInternalTransfer"] for row in preview))
        self.assertTrue(all(row["_internalTransferSource"] == "automatic" for row in preview))
        self.assertTrue(all(not row["_classificationMatched"] for row in preview))

    def test_import_preview_detects_a_pair_completed_by_an_existing_transaction(self) -> None:
        existing = [
            transaction(
                date="2026-08-24",
                amount=2223.09,
                category="Transfer",
                account_type="BANK",
                account_name="Savings Account",
            )
        ]
        parsed = [
            transaction(
                date="2026-08-24",
                amount=-2223.09,
                category="Transfer",
                account_type="BANK",
                account_name="Checking Account",
            )
        ]

        preview, new_count, duplicate_count = preview_imported_transactions(
            existing, parsed, "creditkarma", [False]
        )

        self.assertEqual((new_count, duplicate_count), (1, 0))
        self.assertTrue(preview[0]["_isInternalTransfer"])
        self.assertEqual(preview[0]["_internalTransferSource"], "automatic")


if __name__ == "__main__":
    unittest.main()
