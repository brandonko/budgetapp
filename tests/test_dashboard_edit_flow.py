from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardEditFlowTests(unittest.TestCase):
    def test_transaction_forms_include_subcategory_notes_and_tags(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        settings_html = (ROOT / "app" / "settings.html").read_text(encoding="utf-8")
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn('textarea id="field-notes" name="notes"', index_html)
        self.assertIn('textarea name="notes"', upload_html)
        self.assertIn('input id="field-refunded" name="refunded"', index_html)
        self.assertIn('input name="refunded" type="checkbox"', upload_html)
        self.assertIn('select id="field-internal-transfer-treatment" name="internalTransferTreatment"', index_html)
        self.assertIn('select name="internalTransferTreatment"', upload_html)
        self.assertIn('name="subcategory"', index_html)
        self.assertIn('name="subcategory"', upload_html)
        self.assertIn('input id="field-tags" name="tags"', index_html)
        self.assertIn('input name="tags"', upload_html)
        self.assertIn('input name="tags"', settings_html)
        self.assertIn('"tags",', shared_javascript)
        self.assertIn('badge.className = "transaction-tag"', shared_javascript)

    def test_dashboard_supports_category_and_tag_breakdowns(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertEqual(html.count('data-breakdown-dimension="category"'), 2)
        self.assertEqual(html.count('data-breakdown-dimension="tag"'), 2)
        self.assertIn('breakdownDimension: "category"', javascript)
        self.assertIn('function transactionTags(transaction)', javascript)
        self.assertIn('function groupByBreakdownDimension(transactions)', javascript)
        self.assertIn('tag.toLocaleLowerCase() === normalizedKey', javascript)
        self.assertIn('`Monthly spending by ${state.breakdownDimension}`', javascript)
        self.assertIn('categoryHeader.textContent = categoryMode ? "Category" : "Tag"', javascript)
        self.assertIn('.breakdown-tabs button[aria-pressed="true"]', css)

    def test_dashboard_editor_reopens_its_originating_transaction_list(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn("returnToTransactionDialog", javascript)
        self.assertIn("reopenTransactionDialog(context)", javascript)
        self.assertIn("closeTransactionForm({ force: true })", javascript)
        self.assertIn("transactionUi.transactionFromEditor", javascript)
        self.assertIn('flags.add("refunded")', shared_javascript)
        self.assertIn('refunded.checked = hasTransactionFlag(transaction, "refunded")', shared_javascript)
        self.assertIn('flags.add("internal-transfer")', shared_javascript)
        self.assertIn('flags.add("include-in-budget")', shared_javascript)
        self.assertIn("transactionUi.isInternalTransfer(transaction)", javascript)
        self.assertIn('transactionUi.hasTransactionFlag(transaction, "refunded")', javascript)

    def test_dashboard_and_import_use_the_shared_transaction_list_component(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        upload_html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        settings_html = (ROOT / "app" / "settings.html").read_text(encoding="utf-8")
        classifications_html = (ROOT / "app" / "classifications.html").read_text(encoding="utf-8")
        dashboard_javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        import_javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn('<script src="/transaction-ui.js" defer>', index_html)
        self.assertIn('<script src="/transaction-ui.js" defer>', upload_html)
        self.assertIn("transactionUi.renderTransactionList", dashboard_javascript)
        self.assertIn("transactionUi.renderTransactionList", import_javascript)
        self.assertIn("function renderTransactionList", shared_javascript)
        self.assertIn("function sortTransactions", shared_javascript)
        self.assertIn("function createTransactionSortControls", shared_javascript)
        self.assertIn('id="transaction-dialog-sort"', index_html)
        self.assertIn('id="import-review-sort"', upload_html)
        self.assertIn('id="import-history-sort"', settings_html)
        self.assertIn('id="unclassified-sort"', classifications_html)
        self.assertIn('id="classification-preview-sort"', classifications_html)
        self.assertNotIn("Remove from import", upload_html)

    def test_transaction_modal_has_search_and_field_filters_without_amount_total(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="transaction-search" type="search"', html)
        self.assertIn('id="transaction-category-filter"', html)
        self.assertIn('id="transaction-account-filter"', html)
        self.assertIn('id="transaction-provider-filter"', html)
        self.assertIn('id="transaction-subcategory-filter"', html)
        self.assertIn('id="transaction-tag-filter"', html)
        self.assertIn('id="transaction-filter-button"', html)
        self.assertIn('id="transaction-filter-popover"', html)
        self.assertIn('id="transaction-filter-chips"', html)
        self.assertIn('id="reset-transaction-filters"', html)
        self.assertIn('id="apply-transaction-filters"', html)
        self.assertIn('id="subcategory-summary"', html)
        self.assertIn(
            "transaction.description.toLocaleLowerCase().includes(descriptionQuery)",
            javascript,
        )
        self.assertIn("transaction.category === filters.category", javascript)
        self.assertIn("transaction.accountName === filters.accountName", javascript)
        self.assertIn("transaction.provider === filters.provider", javascript)
        self.assertIn("transaction.subcategory === filters.subcategory", javascript)
        self.assertIn("tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase()", javascript)
        self.assertIn("preserveFilters: true", javascript)
        self.assertIn("function renderActiveTransactionFilters()", javascript)
        self.assertIn("function setTransactionFilterPopover", javascript)
        self.assertIn("populateTransactionSubcategoryFilter", javascript)
        self.assertNotIn("currency.format(total)}`", javascript)
        toolbar_style = css.split(".transaction-toolbar {", 1)[1].split("}", 1)[0]
        self.assertIn("minmax(220px, 1fr) auto auto", toolbar_style)
        filter_pair_style = css.split(".transaction-filter-pair {", 1)[1].split("}", 1)[0]
        self.assertIn("grid-template-columns: 1fr 1fr", filter_pair_style)
        self.assertIn("@media (max-width: 860px)", css)
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

    def test_refunded_transactions_are_zeroed_in_all_aggregate_paths(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn("const spent = displaySum(spendingTransactions);", javascript)
        self.assertIn("const income = Math.abs(displaySum(incomeTransactions));", javascript)
        self.assertIn("Math.max(displaySum(matching), 0)", javascript)
        self.assertIn("monthly.set(month, displaySum(", javascript)
        self.assertNotIn("function sum(transactions)", javascript)

    def test_internal_transfers_are_excluded_and_available_in_monthly_or_annual_review(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function excludedInternalTransfersForSelectedPeriod", javascript)
        self.assertIn("state.viewMode === \"annual\"", javascript)
        self.assertIn("inPeriod && !isInternalTransfer(transaction)", javascript)
        self.assertIn(
            "View ${excludedInternalTransfers.length} excluded internal transfer transactions",
            javascript,
        )
        self.assertIn("Excluded internal transfers", javascript)
        self.assertIn("View excluded internal transfer transactions", html)
        self.assertIn('id="view-annual-excluded-button"', html)
        self.assertIn('id="annual-excluded-button-label"', html)
        self.assertNotIn("Select a category to focus the spending chart.", html)
        self.assertIn("elements.viewExcludedButton.hidden = annual", javascript)
        self.assertIn("elements.viewAnnualExcludedButton.hidden = !annual", javascript)
        self.assertIn("openExcludedInternalTransfers", javascript)
        self.assertIn('id="internal-transfer-info"', html)
        self.assertIn("How automatic matching works", html)
        self.assertIn("transactions from different accounts", html)
        self.assertIn('context.type !== "excluded"', javascript)

    def test_excluded_rows_show_their_original_amount_with_strikethrough(self) -> None:
        shared_javascript = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("const originalDisplayedAmount = income", shared_javascript)
        self.assertIn("refunded || internalTransfer", shared_javascript)
        self.assertIn('? originalDisplayedAmount', shared_javascript)
        excluded_style = css.split(
            ".transaction-row--refunded .transaction-amount,", 1
        )[1].split("}", 1)[0]
        self.assertIn("color: var(--muted)", excluded_style)
        self.assertIn("text-decoration: line-through", excluded_style)

    def test_classifications_page_can_open_an_all_dates_unclassified_review_modal(self) -> None:
        html = (ROOT / "app" / "classifications.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "settings.js").read_text(encoding="utf-8")
        self.assertIn('id="review-unclassified-button"', html)
        self.assertIn('id="unclassified-dialog"', html)
        self.assertIn('id="unclassified-search"', html)
        self.assertIn('id="unclassified-category-filter"', html)
        self.assertIn('id="unclassified-subcategory-filter"', html)
        self.assertIn('id="unclassified-tag-filter"', html)
        self.assertIn('id="unclassified-account-filter"', html)
        self.assertIn('id="unclassified-provider-filter"', html)
        self.assertIn('id="unclassified-filter-popover"', html)
        self.assertIn("openUnclassifiedDialog", javascript)
        self.assertIn('fetch("/api/transactions"', javascript)
        self.assertIn(
            ".filter((transaction) => !transaction.subcategory)",
            javascript,
        )
        self.assertIn("closeUnclassifiedDialog", javascript)
        self.assertIn("event.target === elements.unclassifiedDialog", javascript)
        self.assertIn("transactionUi.renderTransactionList", javascript)
        self.assertIn("needsClassification: !transactionUi.isInternalTransfer(transaction)", javascript)
        self.assertIn("showEdit: false", javascript)

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
