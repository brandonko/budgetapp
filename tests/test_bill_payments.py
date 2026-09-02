from __future__ import annotations

import sys
import unittest
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

from server import find_bill_payment_ids  # noqa: E402


def transaction(
    *,
    date: str,
    amount: float,
    category: str,
    account_type: str,
    description: str = "Test transaction",
) -> dict[str, object]:
    return {
        "date": date,
        "description": description,
        "amount": amount,
        "category": category,
        "accountName": f"{account_type} account",
        "accountType": account_type,
        "provider": "Test provider",
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


if __name__ == "__main__":
    unittest.main()
