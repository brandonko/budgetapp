from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DashboardEditFlowTests(unittest.TestCase):
    def test_all_search_bars_describe_notes_and_load_the_shared_matcher_before_controllers(self) -> None:
        for page in ("index", "transactions", "upload", "settings", "classifications"):
            with self.subTest(page=page):
                html = (ROOT / "app" / f"{page}.html").read_text(encoding="utf-8")
                self.assertIn('placeholder="Search descriptions and notes"', html)
                self.assertEqual(html.count('src="/transactions-model.js?'), 1)
                self.assertLess(html.index('src="/transactions-model.js?'), html.index('src="/transaction-ui.js?'))
        shared = (ROOT / "app" / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertIn("globalObject.LedgerTransactionsModel.matchesTransactionSearch(transaction, query)", shared)
        for page in ("app", "settings", "upload"):
            javascript = (ROOT / "app" / f"{page}.js").read_text(encoding="utf-8")
            self.assertIn("transactionUi.matchesTransactionSearch(transaction,", javascript)
            self.assertNotIn("transaction.description.toLocaleLowerCase().includes(", javascript)

    def test_today_and_period_dropdowns_share_sizing_on_desktop_and_mobile(self) -> None:
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        shared = css.split('.period-controls .select-wrap select,', 1)[1].split('}', 1)[0]
        self.assertIn('.period-controls .period-today', shared)
        self.assertIn('height: var(--period-control-height)', shared)
        self.assertIn('min-height: var(--period-control-height)', shared)
        self.assertRegex(css, r'\.period-controls \{[^}]*--period-control-height: 48px')
        mobile = css.split('@media (max-width: 600px)', 1)[1]
        self.assertIn('--period-control-height: 40px', mobile)
        self.assertIn('.period-controls .period-today:hover', mobile)
        self.assertIn('transform: translateX(-50%)', mobile)
        today = css.split('.period-controls .period-today {', 2)[2].split('}', 1)[0]
        self.assertIn('font-size: inherit', today)
        self.assertIn('padding: 0 14px', today)

    def test_today_button_uses_the_existing_period_controller_and_respects_setup(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        header = html.split('<header', 1)[1].split('</header>', 1)[0]
        self.assertIn('id="today-button" type="button"', header)
        self.assertIn('disabled>Today</button>', header)
        self.assertIn('elements.todayButton.addEventListener("click", goToToday)', javascript)
        for start, end in [('function setError(', 'function clearError('),
                           ('async function loadTransactions(', 'elements.viewModeSelect.addEventListener')]:
            block = javascript.split(start, 1)[1].split(end, 1)[0]
            self.assertIn('elements.todayButton.disabled = true', block)
        loaded = javascript.split('function applyPayload(', 1)[1].split('async function saveTransaction(', 1)[0]
        self.assertIn('elements.todayButton.disabled = false', loaded)

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
        self.assertEqual(index_html.count("data-transaction-tag-picker"), 1)
        self.assertEqual(upload_html.count("data-transaction-tag-picker"), 1)
        self.assertEqual(settings_html.count("data-transaction-tag-picker"), 1)
        self.assertIn("function configureTransactionTagPicker", shared_javascript)
        self.assertIn('button.setAttribute("aria-pressed", String(selected.has(key)))', shared_javascript)
        self.assertIn('state.input.setCustomValidity("A tag cannot contain a comma.")', shared_javascript)
        self.assertIn('state.selectedTags.join(", ")', shared_javascript)
        self.assertIn("transactionUi.configureTransactionTagPicker", (ROOT / "app" / "app.js").read_text(encoding="utf-8"))
        self.assertIn("transactionUi.configureTransactionTagPicker", (ROOT / "app" / "upload.js").read_text(encoding="utf-8"))
        self.assertIn("transactionUi.configureTransactionTagPicker", (ROOT / "app" / "settings.js").read_text(encoding="utf-8"))

    def test_persistent_theme_is_loaded_before_page_styles(self) -> None:
        for page in ["index.html", "transactions.html", "upload.html", "classifications.html", "settings.html"]:
            html = (ROOT / "app" / page).read_text(encoding="utf-8")
            self.assertEqual(html.count('<script src="/theme.js?v=20260905-display-preferences-1"></script>'), 1)
            self.assertLess(html.index('/theme.js'), html.index('/styles.css'))
        theme = (ROOT / "app" / "theme.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        server = (ROOT / "app" / "server.py").read_text(encoding="utf-8")
        self.assertIn('ledger.color-theme.v1', theme)
        self.assertIn('globalObject.matchMedia?.("(prefers-color-scheme: dark)").matches', theme)
        self.assertIn('root.dataset.theme = normalized', theme)
        self.assertIn('html[data-theme="dark"]', css)
        self.assertIn('"/theme.js": APP_DIR / "theme.js"', server)

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
        self.assertIn('id="tag-explorer"', html)
        self.assertIn('id="monthly-tag-explorer-slot"', html)
        self.assertIn('id="annual-tag-explorer-slot"', html)
        self.assertIn('id="tag-search" type="search"', html)
        self.assertIn('data-tag-match-mode="any" aria-pressed="true"', html)
        self.assertIn('data-tag-match-mode="all" aria-pressed="false"', html)
        self.assertIn('id="view-tag-query-transactions"', html)
        self.assertIn('selectedTags: []', javascript)
        self.assertIn('tagMatchMode: "any"', javascript)
        self.assertIn('function transactionMatchesTagSelection(transaction)', javascript)
        self.assertIn('state.tagMatchMode === "all" ? matches.every(Boolean) : matches.some(Boolean)', javascript)
        self.assertIn('function matchingTagTransactions(transactions)', javascript)
        self.assertIn('target.append(elements.tagExplorer)', javascript)
        self.assertIn('function renderAnnualTagSpendingChart(spendingTransactions)', javascript)
        self.assertIn('function renderAnnualTagBreakdown(spendingTransactions)', javascript)
        self.assertIn('Matching transactions', javascript)
        self.assertIn('elements.categoriesSection.hidden = annual', javascript)
        self.assertIn('elements.categoryGrid.hidden = tagMode', javascript)
        self.assertIn('if (tagMode) return', javascript)
        self.assertIn('tagMode ? "Spending by tags" : "Spending by category"', javascript)
        self.assertNotIn('"tag-query-category"', javascript)
        self.assertIn('.tag-option[aria-pressed="true"]', css)
        self.assertIn('.annual-breakdown-table--tag-results', css)

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
        self.assertRegex(index_html, r'<script src="/transaction-ui\.js(?:\?[^\"]*)?" defer>')
        self.assertRegex(upload_html, r'<script src="/transaction-ui\.js(?:\?[^\"]*)?" defer>')
        self.assertIn("dashboardBulk.render", dashboard_javascript)
        self.assertIn("importBulk.render", import_javascript)
        self.assertIn("ui.renderTransactionList", (ROOT / "app" / "transaction-bulk.js").read_text(encoding="utf-8"))
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
        self.assertNotIn('id="apply-transaction-filters"', html)
        self.assertIn('transactionUi.bindLiveTransactionFilters(elements.transactionFilterPopover', javascript)
        self.assertIn('id="subcategory-summary"', html)
        self.assertIn(
            "transactionUi.matchesTransactionSearch(transaction, filters.description)",
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
        self.assertIn("background: var(--surface)", subcategory_style)
        active_filter_style = css.split(".transaction-active-filters {", 1)[1].split("}", 1)[0]
        self.assertIn("background: var(--surface)", active_filter_style)

    def test_import_history_modal_has_shared_search_and_field_filters(self) -> None:
        html = (ROOT / "app" / "settings.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "settings.js").read_text(encoding="utf-8")
        dialog_start = html.index('id="import-history-dialog"')
        for control_id in (
            "import-history-search", "import-history-filter-button",
            "import-history-filter-popover", "import-history-category-filter",
            "import-history-subcategory-filter", "import-history-tag-filter",
            "import-history-account-filter", "import-history-provider-filter",
            "import-history-filter-chips", "reset-import-history-filters",
            "clear-import-history-filters",
        ):
            self.assertIn(f'id="{control_id}"', html[dialog_start:])
        self.assertIn("function configureImportHistoryFilters", javascript)
        self.assertNotIn('id="apply-import-history-filters"', html)
        self.assertIn('transactionUi.bindLiveTransactionFilters(elements.importHistoryFilterPopover', javascript)
        self.assertIn("function renderImportHistoryFilterChips", javascript)
        self.assertIn("function setImportHistoryFilterPopover", javascript)
        self.assertIn("No transactions match these filters.", javascript)
        self.assertIn("transactionUi.matchesTransactionSearch(transaction, filters.description)", javascript)
        self.assertIn("tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase()", javascript)

        # History filters must compose with shared group filtering and bulk edits.
        render_start = javascript.index("function renderImportHistoryTransactions()")
        render_end = javascript.index("async function openImportHistoryBatch", render_start)
        render_history = javascript[render_start:render_end]
        self.assertIn("historyBulk.filter(visible)", render_history)
        self.assertIn("historyBulk.render(visible, importHistoryTransactionOptions)", render_history)
        self.assertIn("groupFiltered.length", render_history)
        bulk_start = javascript.index("const historyBulk =")
        bulk_end = javascript.index("const unclassifiedBulk =", bulk_start)
        self.assertIn("configureImportHistoryFilters()", javascript[bulk_start:bulk_end])

        save_start = javascript.index("async function saveImportHistoryTransaction")
        save_end = javascript.index("async function removeImportBatch", save_start)
        save_transaction = javascript[save_start:save_end]
        self.assertLess(
            save_transaction.index("state.importHistoryTransactions = payload.transactions"),
            save_transaction.index("configureImportHistoryFilters(state.importHistoryFilters)"),
        )
        self.assertLess(
            save_transaction.index("configureImportHistoryFilters(state.importHistoryFilters)"),
            save_transaction.index("renderImportHistoryTransactions()"),
        )

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
        self.assertIn(
            'id="unclassified-internal-transfer-filter" type="button"',
            html,
        )
        self.assertIn('aria-pressed="false">Internal transfer</button>', html)
        self.assertIn("openUnclassifiedDialog", javascript)
        self.assertIn('fetch("/api/transactions"', javascript)
        self.assertIn(
            ".filter((transaction) => !transaction.subcategory)",
            javascript,
        )
        self.assertIn("closeUnclassifiedDialog", javascript)
        self.assertIn("event.target === elements.unclassifiedDialog", javascript)
        self.assertIn("unclassifiedBulk.render", javascript)
        self.assertIn("needsClassification: !transactionUi.isInternalTransfer(transaction)", javascript)
        self.assertIn("showEdit: false", javascript)
        self.assertIn("let showUnclassifiedInternalTransfers = false", javascript)
        self.assertIn(
            "showUnclassifiedInternalTransfers || !transactionUi.isInternalTransfer(transaction)",
            javascript,
        )
        self.assertIn(
            'elements.unclassifiedInternalTransferFilter.setAttribute("aria-pressed", "false")',
            javascript,
        )

    def test_annual_view_drills_into_subcategories_and_has_exact_dollar_table(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="annual-breakdown-head"', html)
        self.assertIn('id="annual-breakdown-body"', html)
        self.assertIn("function selectAnnualSubcategory", javascript)
        self.assertIn("function renderAnnualBreakdown", javascript)
        self.assertIn("Monthly ${breakdownLabel(state.annualCategoryFilter)} spending by subcategory", javascript)
        self.assertIn("button.textContent = `${seriesLabel(key)} · ${currency.format(annualTotal)}`", javascript)
        self.assertIn("subcategoryLabel(subcategory)", javascript)
        self.assertIn('expandButton.setAttribute("aria-expanded"', javascript)
        self.assertIn("renderAnnualBreakdown(transactions);", javascript)
        self.assertIn("function captureAnnualBarHeights(", javascript)
        self.assertIn("function animateAnnualBars(updates, frameProperty, enabled)", javascript)
        self.assertIn("function animateStackedMonthBars(container, previousHeights)", javascript)
        self.assertIn('"annualSpendingAnimationFrame"', javascript)
        self.assertIn('"annualNetAnimationFrame"', javascript)
        self.assertIn("track.dataset.month = monthData.month", javascript)
        self.assertIn("area.dataset.month = monthData.month", javascript)
        self.assertIn("position: sticky", css)
        self.assertIn("annual-breakdown-table", css)

    def test_year_over_year_view_compares_selectable_cumulative_series(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('<option value="year-over-year">Year over year</option>', html)
        self.assertIn('id="comparison-start-year"', html)
        self.assertIn('data-comparison-metric="spending"', html)
        self.assertIn('data-comparison-metric="income"', html)
        self.assertIn('data-comparison-metric="net"', html)
        self.assertIn('data-comparison-chart-mode="cumulative"', html)
        self.assertIn('data-comparison-chart-mode="monthly"', html)
        self.assertNotIn('id="comparison-period-mode"', html)
        self.assertNotIn("Comparable months", html)
        self.assertIn('id="comparison-year-picker"', html)
        self.assertIn('id="comparison-chart"', html)
        self.assertIn('id="comparison-chart-tooltip"', html)
        self.assertIn('id="comparison-table-body"', html)
        self.assertIn('comparisonStartYear: ""', javascript)
        self.assertIn('selectedComparisonYears: []', javascript)
        self.assertIn('VISUALIZATION_COLOR_COUNT = 12', javascript)
        self.assertIn('function visualizationColor(index)', javascript)
        self.assertNotIn("comparisonPeriodMode", javascript)
        self.assertIn('comparisonChartMode: "cumulative"', javascript)
        self.assertIn('comparisonChartMode: state.comparisonChartMode', javascript)
        self.assertIn('function comparisonSeries()', javascript)
        self.assertIn("const cutoff = comparisonCutoffForYear(year);", javascript)
        self.assertIn("return lastObservedMonth(year);", javascript)
        self.assertIn("Each line continues through the latest month available in that year.", javascript)
        self.assertIn('state.comparisonChartMode === "cumulative" ? runningTotal : monthlyTotal', javascript)
        self.assertIn('function animateComparisonChart(updates, enabled)', javascript)
        self.assertNotIn('prefers-reduced-motion: reduce', javascript)
        self.assertIn('const duration = 700', javascript)
        self.assertIn('updates.forEach((update) => update(0))', javascript)
        self.assertIn('window.requestAnimationFrame(step)', javascript)
        self.assertIn('"data-point-key": pointKey', javascript)
        self.assertIn('elements.comparisonChartModeButtons.forEach((button)', javascript)
        self.assertIn('function comparisonAmount(transaction', javascript)
        self.assertIn('function openComparisonMonthTransactions(year, month)', javascript)
        self.assertIn('function showComparisonTooltip(point, year, clientX, clientY)', javascript)
        self.assertIn('circle.addEventListener("pointerenter"', javascript)
        self.assertIn('circle.addEventListener("focus"', javascript)
        self.assertIn('series.forEach((yearSeries)', javascript)
        self.assertIn('colorForComparisonYear(yearSeries.year)', javascript)
        self.assertIn('colorForComparisonYear(item.year)', javascript)
        self.assertIn('colorForComparisonYear(year)', javascript)
        self.assertNotIn('Number(year) % comparisonYearColors.length', javascript)
        self.assertIn('type: "comparison-month"', javascript)
        self.assertIn('transactionUi.isInternalTransfer(transaction)', javascript)
        self.assertIn('comparisonMetric: state.comparisonMetric', javascript)
        self.assertIn('.comparison-point', css)
        self.assertIn('.comparison-chart-tooltip', css)
        self.assertIn('.comparison-table-scroll', css)
        self.assertIn('.comparison-summary', css)

    def test_monthly_and_annual_summary_values_use_odometer_reels(self) -> None:
        html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")

        self.assertIn('id="total-spent"', html)
        self.assertIn('id="total-income"', html)
        self.assertIn('id="net-total"', html)
        self.assertIn("function renderOdometerValue(element, value)", javascript)
        self.assertIn("function odometerDigitSequence", javascript)
        self.assertIn("renderOdometerValue(elements.totalSpent, spent)", javascript)
        self.assertIn("renderOdometerValue(elements.totalIncome, income)", javascript)
        self.assertIn("renderOdometerValue(elements.netTotal, net)", javascript)
        self.assertIn('accessibleText.className = "sr-only"', javascript)
        self.assertIn("reel.animate(", javascript)
        animation_settle = javascript.split("animation.finished.then(() => {", 1)[1].split("});", 1)[0]
        self.assertLess(animation_settle.index("animation.cancel()"), animation_settle.index("reel.replaceChildren(finalItem)"))
        self.assertIn(".summary-odometer-digit", css)
        digit_style = css.split(".summary-odometer-digit {", 1)[1].split("}", 1)[0]
        self.assertIn("overflow: hidden", digit_style)

    def test_summary_abbreviation_preference_controls_odometer_formatting(self) -> None:
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        preferences = (ROOT / "app" / "theme.js").read_text(encoding="utf-8")

        self.assertIn('numberAbbreviationStorageKey = "ledger.number-abbreviation.v1"', preferences)
        self.assertIn('numberAbbreviationOptions = ["none", "k", "m", "b", "t"]', preferences)
        self.assertIn('return "m";', preferences)
        self.assertIn("globalObject.LedgerPreferences", preferences)
        self.assertIn('new globalObject.CustomEvent("ledger-number-abbreviation-change"', preferences)
        setter = preferences.split("function setNumberAbbreviation", 1)[1]
        self.assertLess(
            setter.index("numberAbbreviation = normalized;"),
            setter.index("globalObject.dispatchEvent"),
        )
        for tier in (
            '{ preference: "t", value: 1e12, suffix: "T" }',
            '{ preference: "b", value: 1e9, suffix: "B" }',
            '{ preference: "m", value: 1e6, suffix: "M" }',
            '{ preference: "k", value: 1e3, suffix: "K" }',
        ):
            self.assertIn(tier, javascript)
        self.assertIn('if (preference === "none") return currency.format(amount);', javascript)
        self.assertIn("if (absoluteAmount >= 1e15) return scientificCurrency.format(amount);", javascript)
        self.assertIn("if (tierIndex === 0) return scientificCurrency.format(amount);", javascript)
        self.assertIn("const formattedValue = formatSummaryAmount(value);", javascript)
        self.assertIn('window.addEventListener("ledger-number-abbreviation-change", renderDashboard)', javascript)

    def test_missing_database_prompts_the_user_to_import(self) -> None:
        index_html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="import-data-button" href="/import"', index_html)
        self.assertIn('"Import your transaction data."', javascript)
        self.assertNotIn("Create your transaction file.", javascript)
        self.assertNotIn("create-file-button", index_html)


if __name__ == "__main__":
    unittest.main()
