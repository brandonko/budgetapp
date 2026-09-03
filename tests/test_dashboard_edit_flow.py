from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardEditFlowTests(unittest.TestCase):
    def test_dashboard_and_import_review_forms_include_notes(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        self.assertIn('textarea id="field-notes" name="notes"', index_html)
        self.assertIn('textarea name="notes"', upload_html)
        self.assertIn('input id="field-refunded" name="refunded"', index_html)

    def test_dashboard_editor_reopens_its_originating_transaction_list(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn("returnToTransactionDialog", javascript)
        self.assertIn("reopenTransactionDialog(context)", javascript)
        self.assertIn("closeTransactionForm({ force: true })", javascript)
        self.assertIn("formData.get(\"notes\")", javascript)
        self.assertIn('flags.add("refunded")', javascript)
        self.assertIn('hasTransactionFlag(transaction, "refunded")', javascript)
        self.assertIn('if (hasTransactionFlag(transaction, "refunded")) return 0;', javascript)

    def test_reporting_view_is_saved_and_restored_across_navigation(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn(
            'DASHBOARD_VIEW_STORAGE_KEY = "ledger.dashboardView.v1"', javascript
        )
        self.assertIn("window.localStorage.setItem", javascript)
        self.assertIn("window.localStorage.getItem", javascript)
        self.assertLess(
            javascript.rindex("restoreDashboardView();"),
            javascript.rindex("loadTransactions();"),
        )

    def test_missing_database_prompts_the_user_to_import(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="import-data-button" href="/import"', index_html)
        self.assertIn('"Import your transaction data."', javascript)
        self.assertNotIn("Create your transaction file.", javascript)
        self.assertNotIn("create-file-button", index_html)


if __name__ == "__main__":
    unittest.main()
