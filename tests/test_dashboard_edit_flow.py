from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardEditFlowTests(unittest.TestCase):
    def test_dashboard_and_import_review_forms_include_subcategory_and_notes(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        self.assertIn('textarea id="field-notes" name="notes"', index_html)
        self.assertIn('textarea name="notes"', upload_html)
        self.assertIn('input id="field-refunded" name="refunded"', index_html)
        self.assertIn('input name="refunded" type="checkbox"', upload_html)
        self.assertIn('name="subcategory"', index_html)
        self.assertIn('name="subcategory"', upload_html)

    def test_dashboard_editor_reopens_its_originating_transaction_list(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn("returnToTransactionDialog", javascript)
        self.assertIn("reopenTransactionDialog(context)", javascript)
        self.assertIn("closeTransactionForm({ force: true })", javascript)
        self.assertIn("transactionUi.transactionFromEditor", javascript)
        self.assertIn('flags.add("refunded")', shared_javascript)
        self.assertIn('refunded.checked = hasTransactionFlag(transaction, "refunded")', shared_javascript)
        self.assertIn('transactionUi.hasTransactionFlag(transaction, "refunded")', javascript)

    def test_dashboard_and_import_use_the_shared_transaction_list_component(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        dashboard_javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        import_javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn('<script src="/transaction-ui.js" defer>', index_html)
        self.assertIn('<script src="/transaction-ui.js" defer>', upload_html)
        self.assertIn("transactionUi.renderTransactionList", dashboard_javascript)
        self.assertIn("transactionUi.renderTransactionList", import_javascript)
        self.assertIn("function renderTransactionList", shared_javascript)
        self.assertNotIn("Remove from import", upload_html)

    def test_transaction_modal_has_search_and_account_filters_without_amount_total(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="transaction-search" type="search"', html)
        self.assertIn('id="transaction-account-filter"', html)
        self.assertIn('id="transaction-provider-filter"', html)
        self.assertIn('id="transaction-subcategory-filter"', html)
        self.assertIn('id="subcategory-summary"', html)
        self.assertIn(
            "transaction.description.toLocaleLowerCase().includes(descriptionQuery)",
            javascript,
        )
        self.assertIn("transaction.accountName === filters.accountName", javascript)
        self.assertIn("transaction.provider === filters.provider", javascript)
        self.assertIn("transaction.subcategory === filters.subcategory", javascript)
        self.assertIn("preserveFilters: true", javascript)
        self.assertNotIn("currency.format(total)}`", javascript)
        subcategory_style = css.split(".subcategory-summary {", 1)[1].split("}", 1)[0]
        self.assertIn("flex: 0 0 auto", subcategory_style)
        self.assertIn("overflow-y: hidden", subcategory_style)

    def test_reporting_view_is_saved_and_restored_across_navigation(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn(
            'DASHBOARD_VIEW_STORAGE_KEY = "ledger.dashboardView.v1"', javascript
        )
        self.assertIn("window.localStorage.setItem", javascript)
        self.assertIn("window.localStorage.getItem", javascript)
        self.assertIn("annualSubcategoryFilter", javascript)
        self.assertLess(
            javascript.rindex("restoreDashboardView();"),
            javascript.rindex("loadTransactions();"),
        )

    def test_settings_can_open_an_all_dates_unclassified_review_modal(self) -> None:
        html = (ROOT / "app" / "settings.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "settings.js").read_text(encoding="utf-8")
        self.assertIn('id="review-unclassified-button"', html)
        self.assertIn('id="unclassified-dialog"', html)
        self.assertIn('id="unclassified-search"', html)
        self.assertIn('id="unclassified-category-filter"', html)
        self.assertIn('id="unclassified-account-filter"', html)
        self.assertIn('id="unclassified-provider-filter"', html)
        self.assertIn("openUnclassifiedDialog", javascript)
        self.assertIn('fetch("/api/transactions"', javascript)
        self.assertIn(
            ".filter((transaction) => !transaction.subcategory)",
            javascript,
        )
        self.assertIn("closeUnclassifiedDialog", javascript)
        self.assertIn("event.target === elements.unclassifiedDialog", javascript)

    def test_annual_view_drills_into_subcategories_and_has_exact_dollar_table(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="annual-breakdown-head"', html)
        self.assertIn('id="annual-breakdown-body"', html)
        self.assertIn("function selectAnnualSubcategory", javascript)
        self.assertIn("function renderAnnualBreakdown", javascript)
        self.assertIn("Monthly ${state.annualCategoryFilter} spending by subcategory", javascript)
        self.assertIn("button.textContent = `${seriesLabel(key)} · ${currency.format(annualTotal)}`", javascript)
        self.assertIn("subcategoryLabel(subcategory)", javascript)
        self.assertIn('expandButton.setAttribute("aria-expanded"', javascript)
        self.assertIn("renderAnnualBreakdown(transactions);", javascript)
        self.assertIn("position: sticky", css)
        self.assertIn("annual-breakdown-table", css)

    def test_missing_database_prompts_the_user_to_import(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="import-data-button" href="/import"', index_html)
        self.assertIn('"Import your transaction data."', javascript)
        self.assertNotIn("Create your transaction file.", javascript)
        self.assertNotIn("create-file-button", index_html)


if __name__ == "__main__":
    unittest.main()
