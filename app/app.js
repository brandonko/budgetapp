"use strict";

const DASHBOARD_VIEW_STORAGE_KEY = "ledger.dashboardView.v1";
const UNCLASSIFIED_SUBCATEGORY = "__ledger_unclassified_subcategory__";
const UNTAGGED = "__ledger_untagged__";
const transactionUi = window.LedgerTransactionUI;

const state = {
  transactions: [],
  revision: "",
  viewMode: "monthly",
  selectedYear: "",
  selectedMonth: "",
  breakdownDimension: "category",
  annualCategoryFilter: "",
  annualSubcategoryFilter: "",
  annualExpandedCategories: new Set(),
  editingTransactionId: null,
  transactionDialogContext: null,
  transactionDialogTransactions: [],
  transactionDialogFilters: {
    description: "",
    category: "",
    tag: "",
    accountName: "",
    provider: "",
    subcategory: "",
  },
  returnToTransactionDialog: null,
  formBusy: false,
};

function saveDashboardView() {
  try {
    window.localStorage.setItem(
      DASHBOARD_VIEW_STORAGE_KEY,
      JSON.stringify({
        viewMode: state.viewMode,
        selectedYear: state.selectedYear,
        selectedMonth: state.selectedMonth,
        breakdownDimension: state.breakdownDimension,
        annualCategoryFilter: state.annualCategoryFilter,
        annualSubcategoryFilter: state.annualSubcategoryFilter,
      }),
    );
  } catch {
    // Storage may be unavailable in a private or locked-down browser profile.
  }
}

function restoreDashboardView() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    if (["monthly", "annual"].includes(saved.viewMode)) state.viewMode = saved.viewMode;
    if (/^\d{4}$/.test(saved.selectedYear || "")) state.selectedYear = saved.selectedYear;
    if (/^(0[1-9]|1[0-2])$/.test(saved.selectedMonth || "")) {
      state.selectedMonth = saved.selectedMonth;
    }
    if (["category", "tag"].includes(saved.breakdownDimension)) {
      state.breakdownDimension = saved.breakdownDimension;
    }
    if (typeof saved.annualCategoryFilter === "string") {
      state.annualCategoryFilter = saved.annualCategoryFilter.slice(0, 200);
    }
    if (typeof saved.annualSubcategoryFilter === "string") {
      state.annualSubcategoryFilter = saved.annualSubcategoryFilter.slice(0, 200);
    }
  } catch {
    // Ignore malformed or inaccessible preferences and use the latest month.
  }
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const categoryColors = [
  "#4f755f",
  "#b87945",
  "#63789a",
  "#927056",
  "#7b6d99",
  "#a55c59",
  "#667c7a",
  "#8a854e",
];

const elements = {
  viewModeSelect: document.querySelector("#view-mode-select"),
  yearSelect: document.querySelector("#year-select"),
  monthSelect: document.querySelector("#month-select"),
  monthControl: document.querySelector("#month-control"),
  overviewEyebrow: document.querySelector("#overview-eyebrow"),
  periodDescription: document.querySelector("#period-description"),
  summaryGrid: document.querySelector("#summary-grid"),
  totalSpent: document.querySelector("#total-spent"),
  totalIncome: document.querySelector("#total-income"),
  incomeSummaryNote: document.querySelector("#income-summary-note"),
  netTotal: document.querySelector("#net-total"),
  netTotalCard: document.querySelector("#net-total-card"),
  netTotalNote: document.querySelector("#net-total-note"),
  categoryGrid: document.querySelector("#category-grid"),
  categoriesHeading: document.querySelector("#categories-heading"),
  breakdownDimensionButtons: [...document.querySelectorAll("[data-breakdown-dimension]")],
  monthlyBreakdownTabs: document.querySelector("#monthly-breakdown-tabs"),
  categoryTemplate: document.querySelector("#category-template"),
  annualInsights: document.querySelector("#annual-insights"),
  annualCategoryLegend: document.querySelector("#annual-category-legend"),
  annualSpendingChart: document.querySelector("#annual-spending-chart"),
  spendingChartSubtitle: document.querySelector("#spending-chart-subtitle"),
  clearCategoryFilter: document.querySelector("#clear-category-filter"),
  spendingChartTitle: document.querySelector("#spending-chart-title"),
  annualBreakdownHead: document.querySelector("#annual-breakdown-head"),
  annualBreakdownBody: document.querySelector("#annual-breakdown-body"),
  annualBreakdownDescription: document.querySelector("#annual-breakdown-description"),
  annualNetChart: document.querySelector("#annual-net-chart"),
  viewExcludedButton: document.querySelector("#view-excluded-button"),
  excludedButtonLabel: document.querySelector("#excluded-button-label"),
  viewAnnualExcludedButton: document.querySelector("#view-annual-excluded-button"),
  annualExcludedButtonLabel: document.querySelector("#annual-excluded-button-label"),
  addTransactionButton: document.querySelector("#add-transaction-button"),
  viewAllButton: document.querySelector("#view-all-button"),
  dialog: document.querySelector("#transaction-dialog"),
  dialogEyebrow: document.querySelector("#dialog-eyebrow"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogSubtitle: document.querySelector("#dialog-subtitle"),
  internalTransferInfo: document.querySelector("#internal-transfer-info"),
  transactionList: document.querySelector("#transaction-list"),
  transactionSearch: document.querySelector("#transaction-search"),
  transactionCategoryFilter: document.querySelector("#transaction-category-filter"),
  transactionAccountFilter: document.querySelector("#transaction-account-filter"),
  transactionProviderFilter: document.querySelector("#transaction-provider-filter"),
  transactionSubcategoryFilter: document.querySelector("#transaction-subcategory-filter"),
  transactionTagFilter: document.querySelector("#transaction-tag-filter"),
  transactionFilterButton: document.querySelector("#transaction-filter-button"),
  transactionFilterPopover: document.querySelector("#transaction-filter-popover"),
  transactionFilterCount: document.querySelector("#transaction-filter-count"),
  resetTransactionFilters: document.querySelector("#reset-transaction-filters"),
  applyTransactionFilters: document.querySelector("#apply-transaction-filters"),
  transactionActiveFilters: document.querySelector("#transaction-active-filters"),
  transactionFilterChips: document.querySelector("#transaction-filter-chips"),
  transactionDialogSort: document.querySelector("#transaction-dialog-sort"),
  subcategorySummary: document.querySelector("#subcategory-summary"),
  clearTransactionFilters: document.querySelector("#clear-transaction-filters"),
  closeDialog: document.querySelector("#close-dialog"),
  formDialog: document.querySelector("#transaction-form-dialog"),
  form: document.querySelector("#transaction-form"),
  formEyebrow: document.querySelector("#form-eyebrow"),
  formTitle: document.querySelector("#form-title"),
  formError: document.querySelector("#form-error"),
  closeFormDialog: document.querySelector("#close-form-dialog"),
  cancelFormButton: document.querySelector("#cancel-form-button"),
  deleteTransactionButton: document.querySelector("#delete-transaction-button"),
  saveTransactionButton: document.querySelector("#save-transaction-button"),
  errorState: document.querySelector("#error-state"),
  errorEyebrow: document.querySelector("#error-eyebrow"),
  errorTitle: document.querySelector("#error-title"),
  errorMessage: document.querySelector("#error-message"),
  importDataButton: document.querySelector("#import-data-button"),
  retryButton: document.querySelector("#retry-button"),
  dashboardSections: document.querySelectorAll(".hero, .summary-grid, .annual-insights, .categories-section"),
  datalists: {
    category: document.querySelector("#category-options"),
    subcategory: document.querySelector("#subcategory-options"),
    accountName: document.querySelector("#account-name-options"),
    accountType: document.querySelector("#account-type-options"),
    provider: document.querySelector("#provider-options"),
  },
};

const transactionDialogSort = transactionUi.createTransactionSortControls(
  elements.transactionDialogSort,
  { onChange: () => renderTransactionDialogTransactions() },
);

function parseLocalDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function monthKey(transaction) {
  return transaction.date.slice(0, 7);
}

function monthLabel(key) {
  return monthFormatter.format(parseLocalDate(`${key}-01`));
}

function yearKey(transaction) {
  return transaction.date.slice(0, 4);
}

function selectedMonthKey() {
  return state.selectedYear && state.selectedMonth ? `${state.selectedYear}-${state.selectedMonth}` : "";
}

function selectedPeriodLabel() {
  return state.viewMode === "annual" ? state.selectedYear : monthLabel(selectedMonthKey());
}

function isInternalTransfer(transaction) {
  return transactionUi.isInternalTransfer(transaction);
}

function isIncome(transaction) {
  return transaction.category.trim().toLocaleLowerCase() === "income";
}

function displayAmount(transaction) {
  if (transactionUi.hasTransactionFlag(transaction, "refunded") || isInternalTransfer(transaction)) {
    return 0;
  }
  return isIncome(transaction) ? Math.abs(transaction.amount) : transaction.amount;
}

function displaySum(transactions) {
  return transactions.reduce((total, transaction) => total + displayAmount(transaction), 0);
}

function compareLatestFirst(left, right) {
  return right.date.localeCompare(left.date) || right._id - left._id;
}

function transactionsForSelectedPeriod() {
  return state.transactions
    .filter((transaction) => {
      const inPeriod =
        state.viewMode === "annual"
          ? yearKey(transaction) === state.selectedYear
          : monthKey(transaction) === selectedMonthKey();
      return inPeriod && !isInternalTransfer(transaction);
    })
    .sort(compareLatestFirst);
}

function excludedInternalTransfersForSelectedPeriod() {
  return state.transactions
    .filter((transaction) => {
      const inPeriod =
        state.viewMode === "annual"
          ? yearKey(transaction) === state.selectedYear
          : monthKey(transaction) === selectedMonthKey();
      return inPeriod && isInternalTransfer(transaction);
    })
    .sort(compareLatestFirst);
}

function availableMonths() {
  return [...new Set(state.transactions.filter((transaction) => !isInternalTransfer(transaction)).map(monthKey))]
    .sort()
    .reverse();
}

function populatePeriodSelects(preferredMonth = selectedMonthKey()) {
  const months = availableMonths();
  const latestMonth = months[0] ?? "";
  const preferredYear = preferredMonth.slice(0, 4) || state.selectedYear;
  const years = [...new Set(months.map((month) => month.slice(0, 4)))];
  if (years.length === 0) {
    years.push(String(new Date().getFullYear()));
  }

  elements.yearSelect.replaceChildren();
  for (const year of years) {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    elements.yearSelect.append(option);
  }
  state.selectedYear = years.includes(preferredYear) ? preferredYear : (latestMonth.slice(0, 4) || years[0]);
  elements.yearSelect.value = state.selectedYear;

  elements.monthSelect.replaceChildren();
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const month = String(monthNumber).padStart(2, "0");
    const option = document.createElement("option");
    option.value = month;
    option.textContent = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
      parseLocalDate(`2000-${month}-01`),
    );
    elements.monthSelect.append(option);
  }
  const preferredMonthNumber = preferredMonth.slice(5, 7);
  state.selectedMonth = preferredMonthNumber || latestMonth.slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, "0");
  elements.monthSelect.value = state.selectedMonth;
  elements.viewModeSelect.value = state.viewMode;
  saveDashboardView();
}

function populateDatalists() {
  for (const [field, datalist] of Object.entries(elements.datalists)) {
    const values = [...new Set(state.transactions.map((transaction) => transaction[field]))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    datalist.replaceChildren(
      ...values.map((value) => {
        const option = document.createElement("option");
        option.value = value;
        return option;
      }),
    );
  }
}

function calculateSummary(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const incomeTransactions = transactions.filter(isIncome);
  const spent = displaySum(spendingTransactions);
  const income = Math.abs(displaySum(incomeTransactions));
  return { spent, income, net: income - spent };
}

const COMPACT_CURRENCY_TIERS = [
  { value: 1e33, suffix: "D" },
  { value: 1e30, suffix: "N" },
  { value: 1e27, suffix: "O" },
  { value: 1e24, suffix: "Sp" },
  { value: 1e21, suffix: "Sx" },
  { value: 1e18, suffix: "Qi" },
  { value: 1e15, suffix: "Q" },
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
];

function formatSummaryAmount(amount) {
  if (!Number.isFinite(amount)) {
    return "—";
  }
  const absAmount = Math.abs(amount);
  if (absAmount < 999999.995) {
    return currency.format(amount);
  }

  const sign = amount < 0 ? "-" : "";
  for (let i = 0; i < COMPACT_CURRENCY_TIERS.length; i += 1) {
    const tier = COMPACT_CURRENCY_TIERS[i];
    if (absAmount >= tier.value) {
      let scaled = absAmount / tier.value;
      let formattedNumber = scaled.toFixed(2);
      if (Number(formattedNumber) >= 1000 && i > 0) {
        const nextTier = COMPACT_CURRENCY_TIERS[i - 1];
        scaled = absAmount / nextTier.value;
        formattedNumber = scaled.toFixed(2);
        return `${sign}$${formattedNumber}${nextTier.suffix}`;
      }
      return `${sign}$${formattedNumber}${tier.suffix}`;
    }
  }

  return currency.format(amount);
}

function renderSummary(transactions) {
  const { spent, income, net } = calculateSummary(transactions);
  elements.totalSpent.textContent = formatSummaryAmount(spent);
  elements.totalSpent.title = currency.format(spent);
  elements.totalIncome.textContent = formatSummaryAmount(income);
  elements.totalIncome.title = currency.format(income);
  elements.netTotal.textContent = formatSummaryAmount(net);
  elements.netTotal.title = currency.format(net);
  elements.netTotalCard.classList.toggle("summary-card--net-positive", net > 0);
  elements.netTotalCard.classList.toggle("summary-card--net-negative", net < 0);
  elements.netTotalNote.textContent =
    net > 0 ? "Income exceeded spending" : net < 0 ? "Spending exceeded income" : "Income matched spending";
}

function groupByCategory(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (!groups.has(transaction.category)) {
      groups.set(transaction.category, []);
    }
    groups.get(transaction.category).push(transaction);
  }
  return [...groups.entries()]
    .map(([category, categoryTransactions]) => ({
      category,
      transactions: categoryTransactions,
      total: displaySum(categoryTransactions),
    }))
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total));
}

function transactionTags(transaction) {
  const tags = [];
  const seen = new Set();
  for (const rawTag of String(transaction.tags || "").split(",")) {
    const tag = rawTag.trim();
    const normalized = tag.toLocaleLowerCase();
    if (!tag || seen.has(normalized)) continue;
    tags.push(tag);
    seen.add(normalized);
  }
  return tags;
}

function breakdownLabel(key) {
  return key === UNTAGGED ? "Untagged" : key;
}

function transactionMatchesBreakdown(transaction, key) {
  if (state.breakdownDimension === "category") return transaction.category === key;
  const tags = transactionTags(transaction);
  const normalizedKey = key.toLocaleLowerCase();
  return key === UNTAGGED
    ? tags.length === 0
    : tags.some((tag) => tag.toLocaleLowerCase() === normalizedKey);
}

function groupByBreakdownDimension(transactions) {
  if (state.breakdownDimension === "category") {
    return groupByCategory(transactions).map((group) => ({ ...group, key: group.category }));
  }
  const groups = new Map();
  for (const transaction of transactions) {
    const tags = transactionTags(transaction);
    for (const key of tags.length > 0 ? tags : [UNTAGGED]) {
      const normalizedKey = key.toLocaleLowerCase();
      if (!groups.has(normalizedKey)) {
        groups.set(normalizedKey, { key, transactions: [] });
      }
      groups.get(normalizedKey).transactions.push(transaction);
    }
  }
  return [...groups.values()]
    .map(({ key, transactions: tagTransactions }) => ({
      key,
      category: breakdownLabel(key),
      transactions: tagTransactions,
      total: displaySum(tagTransactions),
    }))
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total));
}

function renderCategories(transactions) {
  const groups = groupByBreakdownDimension(transactions);
  elements.categoryGrid.replaceChildren();
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = `No transactions found for this ${state.viewMode === "annual" ? "year" : "month"}.`;
    elements.categoryGrid.append(empty);
    return;
  }

  const maximum = Math.max(...groups.map((group) => Math.abs(group.total)), 1);
  groups.forEach((group, index) => {
    const card = elements.categoryTemplate.content.firstElementChild.cloneNode(true);
    const color = categoryColors[index % categoryColors.length];
    card.style.setProperty("--category-color", color);
    card.style.setProperty("--bar-width", `${Math.max((Math.abs(group.total) / maximum) * 100, 3)}%`);
    card.querySelector(".category-count").textContent = `${group.transactions.length} ${
      group.transactions.length === 1 ? "transaction" : "transactions"
    }`;
    card.querySelector(".category-name").textContent = group.category;
    const totalElement = card.querySelector(".category-total");
    totalElement.textContent = currency.format(group.total);
    totalElement.classList.toggle(
      "is-credit",
      group.total < 0 || (
        state.breakdownDimension === "category" &&
        group.category.trim().toLocaleLowerCase() === "income"
      ),
    );
    card.setAttribute("aria-label", `View ${group.category} transactions`);
    card.addEventListener("click", () =>
      openTransactionDialog(group.category, group.transactions, {
        type: state.breakdownDimension,
        title: group.category,
        key: group.key,
      }),
    );
    elements.categoryGrid.append(card);
  });
}

function annualTransactionsByMonth(transactions) {
  const byMonth = new Map();
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    byMonth.set(String(monthNumber).padStart(2, "0"), []);
  }
  for (const transaction of transactions) {
    byMonth.get(transaction.date.slice(5, 7))?.push(transaction);
  }
  return byMonth;
}

function colorForCategory(category, categories) {
  return categoryColors[categories.indexOf(category) % categoryColors.length];
}

function subcategoryKey(transaction) {
  return transaction.subcategory || UNCLASSIFIED_SUBCATEGORY;
}

function subcategoryLabel(subcategory) {
  return subcategory === UNCLASSIFIED_SUBCATEGORY ? "Unclassified" : subcategory;
}

function mixHexColor(color, whiteRatio) {
  const channels = color.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16));
  return `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * whiteRatio)).join(" ")})`;
}

function colorForSubcategory(subcategory, subcategories, categoryColor) {
  const index = subcategories.indexOf(subcategory);
  return mixHexColor(categoryColor, Math.min(0.08 + (index % 6) * 0.12, 0.68));
}

function annualSpendingKeys(transactions) {
  return groupByBreakdownDimension(transactions.filter((transaction) => !isIncome(transaction)))
    .map((group) => group.key);
}

function selectAnnualGroup(key) {
  state.annualCategoryFilter = key;
  state.annualSubcategoryFilter = "";
  if (state.breakdownDimension === "category" && key) {
    state.annualExpandedCategories.add(key);
  }
  saveDashboardView();
  renderAnnualSpendingChart(transactionsForSelectedPeriod());
  renderAnnualBreakdown(transactionsForSelectedPeriod());
}

function selectAnnualSubcategory(subcategory) {
  state.annualSubcategoryFilter =
    state.annualSubcategoryFilter === subcategory ? "" : subcategory;
  saveDashboardView();
  renderAnnualSpendingChart(transactionsForSelectedPeriod());
}

function renderSpendingBreadcrumb() {
  const pluralLabel = state.breakdownDimension === "category" ? "categories" : "tags";
  if (!state.annualCategoryFilter) {
    elements.spendingChartSubtitle.textContent = `All spending ${pluralLabel}`;
    return;
  }
  const all = document.createElement("button");
  all.type = "button";
  all.className = "chart-breadcrumb-button";
  all.textContent = `All ${pluralLabel}`;
  all.addEventListener("click", clearAnnualSpendingFilter);
  const categorySeparator = document.createElement("span");
  categorySeparator.textContent = "›";
  const category = document.createElement(
    state.annualSubcategoryFilter ? "button" : "span",
  );
  category.textContent = breakdownLabel(state.annualCategoryFilter);
  if (state.annualSubcategoryFilter) {
    category.type = "button";
    category.className = "chart-breadcrumb-button";
    category.addEventListener("click", () => {
      state.annualSubcategoryFilter = "";
      saveDashboardView();
      renderAnnualSpendingChart(transactionsForSelectedPeriod());
    });
  }
  const parts = [all, categorySeparator, category];
  if (state.annualSubcategoryFilter) {
    const subcategorySeparator = document.createElement("span");
    subcategorySeparator.textContent = "›";
    const subcategory = document.createElement("strong");
    subcategory.textContent = subcategoryLabel(state.annualSubcategoryFilter);
    parts.push(subcategorySeparator, subcategory);
  }
  elements.spendingChartSubtitle.replaceChildren(...parts);
}

function clearAnnualSpendingFilter() {
  state.annualCategoryFilter = "";
  state.annualSubcategoryFilter = "";
  saveDashboardView();
  renderAnnualSpendingChart(transactionsForSelectedPeriod());
}

function renderAnnualSpendingChart(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const categoryMode = state.breakdownDimension === "category";
  const groups = annualSpendingKeys(spendingTransactions);
  if (state.annualCategoryFilter && !groups.includes(state.annualCategoryFilter)) {
    state.annualCategoryFilter = "";
    state.annualSubcategoryFilter = "";
    saveDashboardView();
  }

  const categoryTransactions = state.annualCategoryFilter
    ? spendingTransactions.filter(
        (transaction) => transactionMatchesBreakdown(transaction, state.annualCategoryFilter),
      )
    : spendingTransactions;
  const subcategories = categoryMode && state.annualCategoryFilter
    ? [...new Set(categoryTransactions.map(subcategoryKey))].sort((left, right) => {
        const totalDifference = Math.abs(displaySum(categoryTransactions.filter(
          (transaction) => subcategoryKey(transaction) === right,
        ))) - Math.abs(displaySum(categoryTransactions.filter(
          (transaction) => subcategoryKey(transaction) === left,
        )));
        return totalDifference || subcategoryLabel(left).localeCompare(subcategoryLabel(right));
      })
    : [];
  if (
    state.annualSubcategoryFilter &&
    !subcategories.includes(state.annualSubcategoryFilter)
  ) {
    state.annualSubcategoryFilter = "";
    saveDashboardView();
  }

  const series = categoryMode && state.annualCategoryFilter ? subcategories : groups;
  const visibleSeries = state.annualSubcategoryFilter
    ? [state.annualSubcategoryFilter]
    : !categoryMode && state.annualCategoryFilter
      ? [state.annualCategoryFilter]
      : series;
  const parentColor = categoryMode && state.annualCategoryFilter
    ? colorForCategory(state.annualCategoryFilter, groups)
    : "";
  const seriesLabel = (key) => categoryMode && state.annualCategoryFilter
    ? subcategoryLabel(key)
    : breakdownLabel(key);
  const seriesColor = (key) => categoryMode && state.annualCategoryFilter
    ? colorForSubcategory(key, subcategories, parentColor)
    : colorForCategory(key, groups);
  const seriesTransactions = (key, candidates) => candidates.filter((transaction) => (
    categoryMode && state.annualCategoryFilter
      ? transaction.category === state.annualCategoryFilter && subcategoryKey(transaction) === key
      : transactionMatchesBreakdown(transaction, key)
  ));

  elements.annualCategoryLegend.replaceChildren();
  elements.annualCategoryLegend.setAttribute(
    "aria-label",
    categoryMode && state.annualCategoryFilter
      ? "Filter spending chart by subcategory"
      : `Filter spending chart by ${state.breakdownDimension}`,
  );
  for (const key of series) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-button";
    button.style.setProperty("--legend-color", seriesColor(key));
    button.setAttribute(
      "aria-pressed",
      String(categoryMode && state.annualCategoryFilter
        ? state.annualSubcategoryFilter === key
        : state.annualCategoryFilter === key),
    );
    const annualTotal = displaySum(seriesTransactions(key, spendingTransactions));
    button.textContent = `${seriesLabel(key)} · ${currency.format(annualTotal)}`;
    button.addEventListener("click", () => {
      if (categoryMode && state.annualCategoryFilter) selectAnnualSubcategory(key);
      else selectAnnualGroup(state.annualCategoryFilter === key ? "" : key);
    });
    elements.annualCategoryLegend.append(button);
  }

  elements.spendingChartTitle.textContent = categoryMode && state.annualCategoryFilter
    ? `Monthly ${state.annualCategoryFilter} spending by subcategory`
    : `Monthly spending by ${state.breakdownDimension}`;
  renderSpendingBreadcrumb();
  elements.clearCategoryFilter.hidden = !state.annualCategoryFilter;
  elements.clearCategoryFilter.textContent =
    `Back to ${state.breakdownDimension === "category" ? "categories" : "tags"}`;

  const byMonth = annualTransactionsByMonth(spendingTransactions);
  const monthSeries = [...byMonth.entries()].map(([month, monthTransactions]) => {
    const values = new Map();
    for (const key of series) {
      const matching = seriesTransactions(key, monthTransactions);
      values.set(key, { amount: Math.max(displaySum(matching), 0), count: matching.length });
    }
    return {
      month,
      values,
      total: visibleSeries.reduce(
        (total, key) => total + (values.get(key)?.amount || 0),
        0,
      ),
    };
  });
  const maximum = Math.max(...monthSeries.map((month) => month.total), 1);

  elements.annualSpendingChart.replaceChildren();
  if (series.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "No spending transactions found for this year.";
    elements.annualSpendingChart.append(empty);
    return;
  }

  for (const monthData of monthSeries) {
    const column = document.createElement("div");
    column.className = "stacked-month";
    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = monthData.total > 0 ? currency.format(monthData.total) : "—";
    const track = document.createElement("div");
    track.className = "stacked-bar-track";
    track.setAttribute(
      "aria-label",
      `${monthLabel(`${state.selectedYear}-${monthData.month}`)} spending: ${currency.format(monthData.total)}`,
    );
    for (const key of visibleSeries) {
      const { amount, count } = monthData.values.get(key) || { amount: 0, count: 0 };
      if (amount <= 0) continue;
      const segment = document.createElement("span");
      segment.className = "stacked-bar-segment";
      segment.style.height = `${(amount / maximum) * 100}%`;
      segment.style.backgroundColor = seriesColor(key);
      segment.title = `${seriesLabel(key)}: ${currency.format(amount)} · ${count} ${count === 1 ? "transaction" : "transactions"}`;
      track.append(segment);
    }
    const label = document.createElement("span");
    label.className = "chart-month-label";
    label.textContent = shortMonthFormatter.format(parseLocalDate(`${state.selectedYear}-${monthData.month}-01`));
    column.append(value, track, label);
    elements.annualSpendingChart.append(column);
  }
}

function annualTotals(transactions) {
  const monthly = new Map();
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const month = String(monthNumber).padStart(2, "0");
    monthly.set(month, displaySum(transactions.filter(
      (transaction) => transaction.date.slice(5, 7) === month,
    )));
  }
  return { monthly, annual: displaySum(transactions) };
}

function annualAmountCell(amount) {
  const cell = document.createElement("td");
  cell.textContent = amount === 0 ? "—" : currency.format(amount);
  cell.classList.toggle("is-negative", amount < 0);
  return cell;
}

function appendAnnualAmounts(row, transactions) {
  const totals = annualTotals(transactions);
  for (const amount of totals.monthly.values()) row.append(annualAmountCell(amount));
  const annual = annualAmountCell(totals.annual);
  annual.classList.add("annual-total-cell");
  row.append(annual);
}

function renderAnnualBreakdown(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const categoryMode = state.breakdownDimension === "category";
  const groups = groupByBreakdownDimension(spendingTransactions);
  const headerRow = document.createElement("tr");
  const categoryHeader = document.createElement("th");
  categoryHeader.scope = "col";
  categoryHeader.textContent = categoryMode ? "Category" : "Tag";
  headerRow.append(categoryHeader);
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const month = String(monthNumber).padStart(2, "0");
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = shortMonthFormatter.format(
      parseLocalDate(`${state.selectedYear}-${month}-01`),
    );
    headerRow.append(header);
  }
  const annualHeader = document.createElement("th");
  annualHeader.scope = "col";
  annualHeader.textContent = "Annual";
  headerRow.append(annualHeader);
  elements.annualBreakdownHead.replaceChildren(headerRow);

  const rows = [];
  if (groups.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 14;
    emptyCell.className = "annual-breakdown-empty";
    emptyCell.textContent = "No spending transactions found for this year.";
    emptyRow.append(emptyCell);
    rows.push(emptyRow);
  }
  for (const group of groups) {
    const expanded = categoryMode && state.annualExpandedCategories.has(group.key);
    const categoryRow = document.createElement("tr");
    categoryRow.className = "annual-category-row";
    const categoryCell = document.createElement("th");
    categoryCell.scope = "row";
    if (!categoryMode) {
      categoryCell.textContent = breakdownLabel(group.key);
      categoryRow.append(categoryCell);
      appendAnnualAmounts(categoryRow, group.transactions);
      rows.push(categoryRow);
      continue;
    }
    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "annual-category-expand";
    expandButton.setAttribute("aria-expanded", String(expanded));
    expandButton.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${group.category} subcategories`);
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    const label = document.createElement("span");
    label.textContent = group.category;
    expandButton.append(arrow, label);
    expandButton.addEventListener("click", () => {
      if (expanded) state.annualExpandedCategories.delete(group.key);
      else state.annualExpandedCategories.add(group.key);
      renderAnnualBreakdown(transactionsForSelectedPeriod());
    });
    categoryCell.append(expandButton);
    categoryRow.append(categoryCell);
    appendAnnualAmounts(categoryRow, group.transactions);
    rows.push(categoryRow);

    if (!expanded) continue;
    const subcategoryGroups = new Map();
    for (const transaction of group.transactions) {
      const key = subcategoryKey(transaction);
      if (!subcategoryGroups.has(key)) subcategoryGroups.set(key, []);
      subcategoryGroups.get(key).push(transaction);
    }
    const sortedSubcategories = [...subcategoryGroups.entries()].sort(
      (left, right) => Math.abs(displaySum(right[1])) - Math.abs(displaySum(left[1])) ||
        subcategoryLabel(left[0]).localeCompare(subcategoryLabel(right[0])),
    );
    for (const [subcategory, subcategoryTransactions] of sortedSubcategories) {
      const subcategoryRow = document.createElement("tr");
      subcategoryRow.className = "annual-subcategory-row";
      const subcategoryCell = document.createElement("th");
      subcategoryCell.scope = "row";
      subcategoryCell.textContent = subcategoryLabel(subcategory);
      subcategoryRow.append(subcategoryCell);
      appendAnnualAmounts(subcategoryRow, subcategoryTransactions);
      rows.push(subcategoryRow);
    }
  }
  elements.annualBreakdownBody.replaceChildren(...rows);
}

function renderAnnualNetChart(transactions) {
  const byMonth = annualTransactionsByMonth(transactions);
  const months = [...byMonth.entries()].map(([month, monthTransactions]) => ({
    month,
    net: calculateSummary(monthTransactions).net,
  }));
  const maximum = Math.max(...months.map((month) => Math.abs(month.net)), 1);
  elements.annualNetChart.replaceChildren();

  for (const monthData of months) {
    const column = document.createElement("div");
    column.className = "net-month";
    const value = document.createElement("span");
    value.className = `chart-value ${monthData.net > 0 ? "is-positive" : monthData.net < 0 ? "is-negative" : ""}`;
    value.textContent = monthData.net === 0 ? "—" : currency.format(monthData.net);
    const area = document.createElement("div");
    area.className = "net-bar-area";
    const axis = document.createElement("span");
    axis.className = "net-zero-axis";
    area.append(axis);
    if (monthData.net !== 0) {
      const bar = document.createElement("span");
      bar.className = `net-bar ${monthData.net > 0 ? "is-positive" : "is-negative"}`;
      bar.style.height = `${Math.max((Math.abs(monthData.net) / maximum) * 46, 2)}%`;
      bar.title = `${monthLabel(`${state.selectedYear}-${monthData.month}`)}: ${currency.format(monthData.net)}`;
      area.append(bar);
    }
    const label = document.createElement("span");
    label.className = "chart-month-label";
    label.textContent = shortMonthFormatter.format(parseLocalDate(`${state.selectedYear}-${monthData.month}-01`));
    column.append(value, area, label);
    elements.annualNetChart.append(column);
  }
}

function renderAnnualCharts(transactions) {
  renderAnnualSpendingChart(transactions);
  if (state.breakdownDimension === "category" && state.annualCategoryFilter) {
    state.annualExpandedCategories.add(state.annualCategoryFilter);
  }
  renderAnnualBreakdown(transactions);
  renderAnnualNetChart(transactions);
}

function transactionRowOptions(transaction) {
  return {
    currency,
    shortMonthFormatter,
    amountForDisplay: displayAmount,
    onEdit: () => openTransactionForm(transaction),
  };
}

function currentTransactionDialogFilters() {
  return {
    description: elements.transactionSearch.value.trim(),
    category: state.transactionDialogFilters.category || "",
    tag: state.transactionDialogFilters.tag || "",
    accountName: state.transactionDialogFilters.accountName || "",
    provider: state.transactionDialogFilters.provider || "",
    subcategory: state.transactionDialogFilters.subcategory || "",
  };
}

function transactionFilterDraft() {
  return {
    category: elements.transactionCategoryFilter.value,
    subcategory: elements.transactionSubcategoryFilter.value,
    tag: elements.transactionTagFilter.value,
    accountName: elements.transactionAccountFilter.value,
    provider: elements.transactionProviderFilter.value,
  };
}

function populateTransactionFilter(select, values, allLabel, selectedValue) {
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  const options = values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  });
  select.replaceChildren(allOption, ...options);
  select.value = values.includes(selectedValue) ? selectedValue : "";
}

function configureTransactionFilters(transactions, filters) {
  elements.transactionSearch.value = filters.description || "";
  const categories = [...new Set(transactions.map((transaction) => transaction.category))]
    .sort((left, right) => left.localeCompare(right));
  const accounts = [...new Set(transactions.map((transaction) => transaction.accountName))]
    .sort((left, right) => left.localeCompare(right));
  const providers = [...new Set(transactions.map((transaction) => transaction.provider))]
    .sort((left, right) => left.localeCompare(right));
  const tagsByName = new Map();
  for (const transaction of transactions) {
    for (const tag of transactionTags(transaction)) {
      const normalized = tag.toLocaleLowerCase();
      if (!tagsByName.has(normalized)) tagsByName.set(normalized, tag);
    }
  }
  const tags = [...tagsByName.values()].sort((left, right) => left.localeCompare(right));
  const selectedTag = tags.find(
    (tag) => tag.toLocaleLowerCase() === String(filters.tag || "").toLocaleLowerCase(),
  ) || "";
  populateTransactionFilter(
    elements.transactionCategoryFilter, categories, "All categories", filters.category,
  );
  populateTransactionFilter(
    elements.transactionAccountFilter, accounts, "All accounts", filters.accountName,
  );
  populateTransactionFilter(
    elements.transactionProviderFilter, providers, "All providers", filters.provider,
  );
  populateTransactionFilter(
    elements.transactionTagFilter, tags, "All tags", selectedTag,
  );
  populateTransactionSubcategoryFilter(filters.category, filters.subcategory);
  state.transactionDialogFilters = {
    description: filters.description || "",
    category: elements.transactionCategoryFilter.value,
    subcategory: elements.transactionSubcategoryFilter.value,
    tag: elements.transactionTagFilter.value,
    accountName: elements.transactionAccountFilter.value,
    provider: elements.transactionProviderFilter.value,
  };
  renderActiveTransactionFilters();
}

function populateTransactionSubcategoryFilter(category, selectedValue = "") {
  const candidates = category
    ? state.transactionDialogTransactions.filter((transaction) => transaction.category === category)
    : state.transactionDialogTransactions;
  const subcategories = [...new Set(candidates.map((transaction) => transaction.subcategory).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  populateTransactionFilter(
    elements.transactionSubcategoryFilter,
    subcategories,
    "All subcategories",
    selectedValue,
  );
  if (candidates.some((transaction) => !transaction.subcategory)) {
    const option = document.createElement("option");
    option.value = UNCLASSIFIED_SUBCATEGORY;
    option.textContent = "Unclassified";
    elements.transactionSubcategoryFilter.append(option);
    if (selectedValue === UNCLASSIFIED_SUBCATEGORY) {
      elements.transactionSubcategoryFilter.value = UNCLASSIFIED_SUBCATEGORY;
    }
  }
}

function transactionFilterLabel(field, value) {
  if (field === "subcategory" && value === UNCLASSIFIED_SUBCATEGORY) return "Unclassified";
  return value;
}

function renderActiveTransactionFilters() {
  const definitions = [
    ["category", "Category"],
    ["subcategory", "Subcategory"],
    ["tag", "Tag"],
    ["accountName", "Account"],
    ["provider", "Provider"],
  ];
  const active = definitions.filter(([field]) => state.transactionDialogFilters[field]);
  elements.transactionFilterCount.textContent = String(active.length);
  elements.transactionFilterCount.hidden = active.length === 0;
  elements.transactionFilterButton.classList.toggle("has-active-filters", active.length > 0);
  elements.transactionActiveFilters.hidden = active.length === 0;
  const chips = active.map(([field, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "transaction-filter-chip";
    const value = transactionFilterLabel(field, state.transactionDialogFilters[field]);
    chip.textContent = `${label}: ${value} ×`;
    chip.setAttribute("aria-label", `Remove ${label.toLocaleLowerCase()} filter ${value}`);
    chip.addEventListener("click", () => {
      state.transactionDialogFilters[field] = "";
      if (field === "category") {
        elements.transactionCategoryFilter.value = "";
        populateTransactionSubcategoryFilter("", state.transactionDialogFilters.subcategory);
      } else {
        const select = {
          subcategory: elements.transactionSubcategoryFilter,
          tag: elements.transactionTagFilter,
          accountName: elements.transactionAccountFilter,
          provider: elements.transactionProviderFilter,
        }[field];
        if (select) select.value = "";
      }
      renderTransactionDialogTransactions();
    });
    return chip;
  });
  elements.transactionFilterChips.replaceChildren(...chips);
}

function syncTransactionFilterDraft() {
  const filters = state.transactionDialogFilters;
  elements.transactionCategoryFilter.value = filters.category || "";
  populateTransactionSubcategoryFilter(filters.category || "", filters.subcategory || "");
  elements.transactionTagFilter.value = filters.tag || "";
  elements.transactionAccountFilter.value = filters.accountName || "";
  elements.transactionProviderFilter.value = filters.provider || "";
}

function setTransactionFilterPopover(open, { restoreDraft = true } = {}) {
  if (!open && restoreDraft) syncTransactionFilterDraft();
  elements.transactionFilterPopover.hidden = !open;
  elements.transactionFilterButton.setAttribute("aria-expanded", String(open));
}

function renderSubcategorySummary() {
  const show = state.transactionDialogContext?.type === "category";
  elements.subcategorySummary.hidden = !show;
  if (!show) {
    elements.subcategorySummary.replaceChildren();
    return;
  }
  const groups = new Map();
  for (const transaction of state.transactionDialogTransactions) {
    const key = transaction.subcategory || UNCLASSIFIED_SUBCATEGORY;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  }
  const buttons = [...groups.entries()]
    .map(([subcategory, transactions]) => ({
      subcategory,
      transactions,
      total: displaySum(transactions),
    }))
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total))
    .map((group) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "subcategory-summary-button";
      button.classList.toggle(
        "is-active", state.transactionDialogFilters.subcategory === group.subcategory,
      );
      const label = document.createElement("span");
      label.textContent = group.subcategory === UNCLASSIFIED_SUBCATEGORY
        ? "Unclassified"
        : group.subcategory;
      const amount = document.createElement("strong");
      amount.textContent = currency.format(group.total);
      button.append(label, amount);
      button.addEventListener("click", () => {
        state.transactionDialogFilters.subcategory =
          state.transactionDialogFilters.subcategory === group.subcategory ? "" : group.subcategory;
        syncTransactionFilterDraft();
        renderTransactionDialogTransactions();
      });
      return button;
    });
  elements.subcategorySummary.replaceChildren(...buttons);
}

function renderTransactionDialogTransactions() {
  const filters = currentTransactionDialogFilters();
  state.transactionDialogFilters = filters;
  const descriptionQuery = filters.description.toLocaleLowerCase();
  const visibleTransactions = transactionUi.sortTransactions(
    state.transactionDialogTransactions.filter((transaction) => (
      (!descriptionQuery || transaction.description.toLocaleLowerCase().includes(descriptionQuery)) &&
      (!filters.category || transaction.category === filters.category) &&
      (!filters.tag || transactionTags(transaction).some(
        (tag) => tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase(),
      )) &&
      (!filters.accountName || transaction.accountName === filters.accountName) &&
      (!filters.provider || transaction.provider === filters.provider) &&
      (!filters.subcategory || (
        filters.subcategory === UNCLASSIFIED_SUBCATEGORY
          ? !transaction.subcategory
          : transaction.subcategory === filters.subcategory
      ))
    )),
    transactionDialogSort.value(),
  );
  const total = state.transactionDialogTransactions.length;
  const filtered = Object.values(filters).some(Boolean);
  elements.dialogSubtitle.textContent = filtered
    ? `${visibleTransactions.length} of ${total} transactions`
    : `${total} ${total === 1 ? "transaction" : "transactions"}`;
  renderActiveTransactionFilters();
  renderSubcategorySummary();
  if (visibleTransactions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = "No transactions match these filters.";
    elements.transactionList.replaceChildren(empty);
    return;
  }
  transactionUi.renderTransactionList(
    elements.transactionList,
    visibleTransactions,
    transactionRowOptions,
  );
}

function openTransactionDialog(title, transactions, context, { preserveFilters = false } = {}) {
  const filters = preserveFilters
    ? state.transactionDialogFilters
    : { description: "", category: "", tag: "", accountName: "", provider: "", subcategory: "" };
  state.transactionDialogContext = context;
  state.transactionDialogTransactions = [...transactions].sort(compareLatestFirst);
  elements.dialogEyebrow.textContent = selectedPeriodLabel();
  elements.dialogTitle.textContent = title;
  elements.internalTransferInfo.hidden = context.type !== "excluded";
  configureTransactionFilters(state.transactionDialogTransactions, filters);
  setTransactionFilterPopover(false);
  renderTransactionDialogTransactions();
  elements.dialog.showModal();
}

function reopenTransactionDialog(context) {
  if (!context) return;
  let transactions;
  if (context.type === "category" || context.type === "tag") {
    transactions = transactionsForSelectedPeriod().filter(
      (transaction) => {
        if (context.type === "category") return transaction.category === context.key;
        const tags = transactionTags(transaction);
        return context.key === UNTAGGED ? tags.length === 0 : tags.includes(context.key);
      },
    );
  } else if (context.type === "excluded") {
    transactions = excludedInternalTransfersForSelectedPeriod();
  } else {
    transactions = transactionsForSelectedPeriod();
  }
  openTransactionDialog(context.title, transactions, context, { preserveFilters: true });
}

function formField(name) {
  return elements.form.elements.namedItem(name);
}

function defaultNewTransactionDate() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const periodMonth = selectedMonthKey();
  if (state.viewMode === "annual") {
    return todayIso.startsWith(state.selectedYear) ? todayIso : `${state.selectedYear}-01-01`;
  }
  if (!periodMonth || todayIso.startsWith(periodMonth)) {
    return todayIso;
  }
  return `${periodMonth}-01`;
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

function clearFormError() {
  elements.formError.textContent = "";
  elements.formError.hidden = true;
}

function setFormBusy(isBusy) {
  state.formBusy = isBusy;
  elements.form.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = isBusy;
  });
  elements.saveTransactionButton.textContent = isBusy ? "Saving…" : "Save transaction";
}

function openTransactionForm(transaction = null) {
  state.returnToTransactionDialog =
    transaction !== null && elements.dialog.open ? state.transactionDialogContext : null;
  if (elements.dialog.open) {
    elements.dialog.close();
  }
  clearFormError();
  state.editingTransactionId = transaction?._id ?? null;
  const editing = transaction !== null;
  elements.formEyebrow.textContent = editing ? "Edit transaction" : "New transaction";
  elements.formTitle.textContent = editing ? "Update transaction" : "Add transaction";
  elements.deleteTransactionButton.hidden = !editing;

  transactionUi.populateTransactionEditor(elements.form, transaction, {
    date: defaultNewTransactionDate(),
  });
  elements.formDialog.showModal();
  formField(editing ? "description" : "date").focus();
}

function transactionFromForm() {
  const existingTransaction = state.transactions.find(
    (transaction) => transaction._id === state.editingTransactionId,
  );
  return transactionUi.transactionFromEditor(elements.form, existingTransaction);
}

function closeTransactionForm({ returnToList = true, force = false } = {}) {
  if (state.formBusy && !force) return;
  const context = returnToList ? state.returnToTransactionDialog : null;
  state.returnToTransactionDialog = null;
  elements.formDialog.close();
  reopenTransactionDialog(context);
}

async function mutationRequest(url, method, transaction = undefined) {
  const body = { revision: state.revision };
  if (transaction !== undefined) {
    body.transaction = transaction;
  }
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function applyPayload(payload, preferredMonth = selectedMonthKey()) {
  state.transactions = payload.transactions;
  state.revision = payload.revision;
  populatePeriodSelects(preferredMonth);
  populateDatalists();
  renderDashboard();
}

async function saveTransaction(event) {
  event.preventDefault();
  clearFormError();
  const transaction = transactionFromForm();
  const editing = state.editingTransactionId !== null;
  const url = editing ? `/api/transactions/${state.editingTransactionId}` : "/api/transactions";
  const method = editing ? "PUT" : "POST";
  setFormBusy(true);
  try {
    const payload = await mutationRequest(url, method, transaction);
    applyPayload(payload, transaction.date.slice(0, 7));
    closeTransactionForm({ force: true });
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "The transaction could not be saved.");
  } finally {
    setFormBusy(false);
  }
}

async function deleteTransaction() {
  const transaction = state.transactions.find((item) => item._id === state.editingTransactionId);
  if (!transaction) {
    showFormError("This transaction no longer exists. Reload the page and try again.");
    return;
  }
  const confirmed = window.confirm(
    `Permanently delete “${transaction.description}” for ${currency.format(transaction.amount)}?\n\n` +
      "This updates the master CSV and cannot be undone.",
  );
  if (!confirmed) {
    return;
  }

  clearFormError();
  setFormBusy(true);
  try {
    const payload = await mutationRequest(`/api/transactions/${transaction._id}`, "DELETE");
    applyPayload(payload);
    closeTransactionForm({ force: true });
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "The transaction could not be deleted.");
  } finally {
    setFormBusy(false);
  }
}

function renderDashboard() {
  const transactions = transactionsForSelectedPeriod();
  const excludedInternalTransfers = excludedInternalTransfersForSelectedPeriod();
  const annual = state.viewMode === "annual";
  elements.monthControl.hidden = annual;
  elements.monthlyBreakdownTabs.hidden = annual;
  elements.breakdownDimensionButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.breakdownDimension === state.breakdownDimension),
    );
  });
  elements.categoriesHeading.textContent = `Spending by ${state.breakdownDimension}`;
  elements.annualBreakdownDescription.textContent = state.breakdownDimension === "category"
    ? "Expand a category to compare exact subcategory totals across months."
    : "Compare exact tag totals across months. Transactions with multiple tags appear in each tag total.";
  elements.overviewEyebrow.textContent = annual ? "Annual overview" : "Monthly overview";
  elements.summaryGrid.setAttribute("aria-label", annual ? "Annual summary" : "Monthly summary");
  elements.incomeSummaryNote.textContent = annual ? "Income received this year" : "Income received this month";
  elements.periodDescription.textContent = state.selectedYear
    ? annual
      ? `A full-year view of where your money went in ${state.selectedYear}.`
      : `A clear view of where your money went in ${monthLabel(selectedMonthKey())}.`
    : "No transaction data is available yet.";
  renderSummary(transactions);
  renderCategories(transactions);
  elements.annualInsights.hidden = !annual;
  if (annual) {
    renderAnnualCharts(transactions);
  }
  elements.viewAllButton.disabled = transactions.length === 0;
  const excludedLabel =
    `View ${excludedInternalTransfers.length} excluded internal transfer transactions`;
  elements.excludedButtonLabel.textContent = excludedLabel;
  elements.annualExcludedButtonLabel.textContent = excludedLabel;
  elements.viewExcludedButton.hidden = annual || excludedInternalTransfers.length === 0;
  elements.viewAnnualExcludedButton.hidden = !annual;
  elements.viewAnnualExcludedButton.disabled = excludedInternalTransfers.length === 0;
}

function setError(message, code = "") {
  const fileMissing = code === "transaction_file_missing";
  elements.errorState.classList.toggle("error-state--setup", fileMissing);
  elements.errorEyebrow.textContent = fileMissing ? "Get started" : "Unable to load data";
  elements.errorTitle.textContent = fileMissing ? "Import your transaction data." : "Something went wrong.";
  elements.errorMessage.textContent = fileMissing
    ? "Choose a data source to create your transaction file and start using Ledger."
    : message;
  elements.importDataButton.hidden = !fileMissing;
  elements.retryButton.hidden = fileMissing;
  elements.errorState.hidden = false;
  elements.dashboardSections.forEach((section) => {
    section.hidden = true;
  });
}

function clearError() {
  elements.errorState.classList.remove("error-state--setup");
  elements.errorState.hidden = true;
  elements.dashboardSections.forEach((section) => {
    section.hidden = false;
  });
}

async function loadTransactions() {
  clearError();
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      if (payload.code === "transaction_file_missing") {
        setError(payload.error, payload.code);
        return;
      }
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    applyPayload(payload);
  } catch (error) {
    setError(error instanceof Error ? error.message : "The transaction data could not be loaded.");
  }
}

elements.viewModeSelect.addEventListener("change", (event) => {
  state.viewMode = event.target.value;
  saveDashboardView();
  renderDashboard();
});
elements.breakdownDimensionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const dimension = button.dataset.breakdownDimension;
    if (!["category", "tag"].includes(dimension) || dimension === state.breakdownDimension) return;
    state.breakdownDimension = dimension;
    state.annualCategoryFilter = "";
    state.annualSubcategoryFilter = "";
    saveDashboardView();
    renderDashboard();
  });
});
elements.yearSelect.addEventListener("change", (event) => {
  state.selectedYear = event.target.value;
  saveDashboardView();
  renderDashboard();
});
elements.monthSelect.addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  saveDashboardView();
  renderDashboard();
});
elements.clearCategoryFilter.addEventListener("click", () => {
  clearAnnualSpendingFilter();
});
elements.addTransactionButton.addEventListener("click", () => openTransactionForm());
elements.viewAllButton.addEventListener("click", () => {
  openTransactionDialog("All transactions", transactionsForSelectedPeriod(), {
    type: "all",
    title: "All transactions",
  });
});
function openExcludedInternalTransfers() {
  openTransactionDialog("Excluded internal transfers", excludedInternalTransfersForSelectedPeriod(), {
    type: "excluded",
    title: "Excluded internal transfers",
  });
}

elements.viewExcludedButton.addEventListener("click", openExcludedInternalTransfers);
elements.viewAnnualExcludedButton.addEventListener("click", openExcludedInternalTransfers);
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.transactionSearch.addEventListener("input", renderTransactionDialogTransactions);
elements.transactionFilterButton.addEventListener("click", () => {
  const open = elements.transactionFilterButton.getAttribute("aria-expanded") !== "true";
  setTransactionFilterPopover(open);
  if (open) elements.transactionCategoryFilter.focus();
});
elements.transactionCategoryFilter.addEventListener("change", () => {
  populateTransactionSubcategoryFilter(
    elements.transactionCategoryFilter.value,
    elements.transactionSubcategoryFilter.value,
  );
});
elements.resetTransactionFilters.addEventListener("click", () => {
  elements.transactionCategoryFilter.value = "";
  populateTransactionSubcategoryFilter("");
  elements.transactionAccountFilter.value = "";
  elements.transactionProviderFilter.value = "";
  elements.transactionTagFilter.value = "";
  elements.transactionCategoryFilter.focus();
});
elements.applyTransactionFilters.addEventListener("click", () => {
  state.transactionDialogFilters = {
    ...state.transactionDialogFilters,
    ...transactionFilterDraft(),
  };
  setTransactionFilterPopover(false, { restoreDraft: false });
  renderTransactionDialogTransactions();
  elements.transactionFilterButton.focus();
});
elements.clearTransactionFilters.addEventListener("click", () => {
  state.transactionDialogFilters = {
    ...state.transactionDialogFilters,
    category: "",
    subcategory: "",
    tag: "",
    accountName: "",
    provider: "",
  };
  syncTransactionFilterDraft();
  renderTransactionDialogTransactions();
  elements.transactionFilterButton.focus();
});
document.addEventListener("click", (event) => {
  const open = elements.transactionFilterButton.getAttribute("aria-expanded") === "true";
  if (open && !event.target.closest(".transaction-filter-menu")) {
    setTransactionFilterPopover(false);
  }
});
elements.dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.transactionFilterButton.getAttribute("aria-expanded") === "true") {
    event.preventDefault();
    event.stopPropagation();
    setTransactionFilterPopover(false);
    elements.transactionFilterButton.focus();
  }
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    elements.dialog.close();
  }
});
elements.form.addEventListener("submit", saveTransaction);
elements.deleteTransactionButton.addEventListener("click", deleteTransaction);
elements.closeFormDialog.addEventListener("click", () => closeTransactionForm());
elements.cancelFormButton.addEventListener("click", () => closeTransactionForm());
elements.formDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTransactionForm();
});
elements.formDialog.addEventListener("click", (event) => {
  if (event.target === elements.formDialog && !state.formBusy) {
    closeTransactionForm();
  }
});
elements.retryButton.addEventListener("click", loadTransactions);

restoreDashboardView();
loadTransactions();
