"use strict";

const DASHBOARD_VIEW_STORAGE_KEY = "ledger.dashboardView.v1";
const UNCLASSIFIED_SUBCATEGORY = "__ledger_unclassified_subcategory__";
const UNTAGGED = "__ledger_untagged__";
const UNCATEGORIZED = "__ledger_uncategorized__";
const transactionUi = window.LedgerTransactionUI;

const state = {
  transactions: [],
  taxonomyCategories: [],
  revision: "",
  viewMode: "monthly",
  selectedYear: "",
  selectedMonth: "",
  comparisonStartYear: "",
  selectedComparisonYears: [],
  comparisonMetric: "spending",
  comparisonChartMode: "cumulative",
  comparisonAnimationFrame: null,
  annualSpendingAnimationFrame: null,
  annualNetAnimationFrame: null,
  breakdownDimension: "category",
  selectedTags: [],
  tagMatchMode: "any",
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
        comparisonStartYear: state.comparisonStartYear,
        selectedComparisonYears: state.selectedComparisonYears,
        comparisonMetric: state.comparisonMetric,
        comparisonChartMode: state.comparisonChartMode,
        breakdownDimension: state.breakdownDimension,
        selectedTags: state.selectedTags,
        tagMatchMode: state.tagMatchMode,
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
    if (["monthly", "annual", "year-over-year"].includes(saved.viewMode)) {
      state.viewMode = saved.viewMode;
    }
    if (/^\d{4}$/.test(saved.selectedYear || "")) state.selectedYear = saved.selectedYear;
    if (/^(0[1-9]|1[0-2])$/.test(saved.selectedMonth || "")) {
      state.selectedMonth = saved.selectedMonth;
    }
    if (/^\d{4}$/.test(saved.comparisonStartYear || "")) {
      state.comparisonStartYear = saved.comparisonStartYear;
    }
    if (Array.isArray(saved.selectedComparisonYears)) {
      state.selectedComparisonYears = saved.selectedComparisonYears
        .filter((year) => /^\d{4}$/.test(year))
        .slice(0, 20);
    }
    if (["spending", "income", "net"].includes(saved.comparisonMetric)) {
      state.comparisonMetric = saved.comparisonMetric;
    }
    if (["cumulative", "monthly"].includes(saved.comparisonChartMode)) {
      state.comparisonChartMode = saved.comparisonChartMode;
    }
    if (["category", "tag"].includes(saved.breakdownDimension)) {
      state.breakdownDimension = saved.breakdownDimension;
    }
    if (Array.isArray(saved.selectedTags)) {
      state.selectedTags = saved.selectedTags
        .filter((tag) => typeof tag === "string" && tag.length <= 200)
        .slice(0, 50);
    }
    if (["any", "all"].includes(saved.tagMatchMode)) state.tagMatchMode = saved.tagMatchMode;
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

const scientificCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "scientific",
  maximumFractionDigits: 2,
});

const SUMMARY_ABBREVIATION_TIERS = [
  { preference: "t", value: 1e12, suffix: "T" },
  { preference: "b", value: 1e9, suffix: "B" },
  { preference: "m", value: 1e6, suffix: "M" },
  { preference: "k", value: 1e3, suffix: "K" },
];

function numberAbbreviationPreference() {
  return window.LedgerPreferences?.numberAbbreviation?.() || "m";
}

function formatSummaryAmount(amount) {
  const preference = numberAbbreviationPreference();
  const absoluteAmount = Math.abs(amount);
  if (preference === "none") return currency.format(amount);
  if (absoluteAmount >= 1e15) return scientificCurrency.format(amount);

  const minimumTierIndex = SUMMARY_ABBREVIATION_TIERS.findIndex(
    (tier) => tier.preference === preference,
  );
  let tierIndex = SUMMARY_ABBREVIATION_TIERS.findIndex(
    (tier, index) => index <= minimumTierIndex && absoluteAmount >= tier.value,
  );
  if (tierIndex < 0) return currency.format(amount);

  let roundedAmount = Math.round(absoluteAmount / SUMMARY_ABBREVIATION_TIERS[tierIndex].value);
  if (roundedAmount >= 1000) {
    if (tierIndex === 0) return scientificCurrency.format(amount);
    tierIndex -= 1;
    roundedAmount = Math.round(absoluteAmount / SUMMARY_ABBREVIATION_TIERS[tierIndex].value);
  }
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${roundedAmount.toLocaleString("en-US")}${SUMMARY_ABBREVIATION_TIERS[tierIndex].suffix}`;
}

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const VISUALIZATION_COLOR_COUNT = 12;
const visualizationFallbackColors = [
  "#2563b8", "#c45a14", "#16805c", "#b33c86",
  "#6f49b5", "#087e96", "#c53f3f", "#746b00",
  "#5d83c4", "#d17a3d", "#4a9277", "#c46a9d",
];

function visualizationColors() {
  const styles = window.getComputedStyle(document.documentElement);
  return Array.from({ length: VISUALIZATION_COLOR_COUNT }, (_, index) => (
    styles.getPropertyValue(`--viz-${index + 1}`).trim() || visualizationFallbackColors[index]
  ));
}

function visualizationColor(index) {
  const colors = visualizationColors();
  const normalizedIndex = ((index % colors.length) + colors.length) % colors.length;
  return colors[normalizedIndex];
}

const dashboardColorAssignments = new Map();

function dashboardSeriesColors(scope, keys, size = VISUALIZATION_COLOR_COUNT) {
  const storageKey = `ledger.series-colors.v1.${scope}`;
  if (!dashboardColorAssignments.has(scope)) {
    let initial = [];
    try { initial = JSON.parse(window.localStorage.getItem(storageKey) || "[]"); } catch { /* Optional preferences. */ }
    dashboardColorAssignments.set(scope, { slots: transactionUi.createSeriesColorSlots({ size, initial }), serialized: "" });
  }
  const entry = dashboardColorAssignments.get(scope);
  entry.slots.sync(keys);
  const serialized = JSON.stringify(entry.slots.snapshot());
  if (entry.serialized !== serialized) {
    entry.serialized = serialized;
    try { window.localStorage.setItem(storageKey, serialized); } catch { /* In-memory assignments still work. */ }
  }
  return entry.slots;
}

function colorForComparisonYear(year) {
  // Use selection order for new colors, while the chart/table remain chronological.
  const slots = dashboardSeriesColors("years", state.selectedComparisonYears);
  return slots.slot(year) === undefined ? "var(--muted)" : visualizationColor(slots.slot(year));
}

const elements = {
  viewModeSelect: document.querySelector("#view-mode-select"),
  yearSelect: document.querySelector("#year-select"),
  yearControlLabel: document.querySelector("#year-control-label"),
  comparisonStartYearControl: document.querySelector("#comparison-start-year-control"),
  comparisonStartYear: document.querySelector("#comparison-start-year"),
  monthSelect: document.querySelector("#month-select"),
  todayButton: document.querySelector("#today-button"),
  monthControl: document.querySelector("#month-control"),
  overviewEyebrow: document.querySelector("#overview-eyebrow"),
  periodDescription: document.querySelector("#period-description"),
  summaryGrid: document.querySelector("#summary-grid"),
  totalSpent: document.querySelector("#total-spent"),
  spendingSummaryNote: document.querySelector("#spending-summary-note"),
  totalIncome: document.querySelector("#total-income"),
  incomeSummaryNote: document.querySelector("#income-summary-note"),
  netTotal: document.querySelector("#net-total"),
  netTotalCard: document.querySelector("#net-total-card"),
  netTotalNote: document.querySelector("#net-total-note"),
  categoryGrid: document.querySelector("#category-grid"),
  categoriesSection: document.querySelector(".categories-section"),
  categoriesHeading: document.querySelector("#categories-heading"),
  breakdownDimensionButtons: [...document.querySelectorAll("[data-breakdown-dimension]")],
  monthlyBreakdownTabs: document.querySelector("#monthly-breakdown-tabs"),
  tagExplorer: document.querySelector("#tag-explorer"),
  monthlyTagExplorerSlot: document.querySelector("#monthly-tag-explorer-slot"),
  annualTagExplorerSlot: document.querySelector("#annual-tag-explorer-slot"),
  tagSearch: document.querySelector("#tag-search"),
  tagOptions: document.querySelector("#tag-options"),
  tagMatchModeButtons: [...document.querySelectorAll("[data-tag-match-mode]")],
  clearTagSelection: document.querySelector("#clear-tag-selection"),
  tagQueryExpression: document.querySelector("#tag-query-expression"),
  tagQueryResult: document.querySelector("#tag-query-result"),
  viewTagQueryTransactions: document.querySelector("#view-tag-query-transactions"),
  categoryTemplate: document.querySelector("#category-template"),
  annualInsights: document.querySelector("#annual-insights"),
  yearComparison: document.querySelector("#year-comparison"),
  yearComparisonDescription: document.querySelector("#year-comparison-description"),
  comparisonMetricButtons: [...document.querySelectorAll("[data-comparison-metric]")],
  comparisonChartModeButtons: [...document.querySelectorAll("[data-comparison-chart-mode]")],
  comparisonYearPicker: document.querySelector("#comparison-year-picker"),
  comparisonChart: document.querySelector("#comparison-chart"),
  comparisonChartTooltip: document.querySelector("#comparison-chart-tooltip"),
  comparisonTooltipLabel: document.querySelector("#comparison-tooltip-label"),
  comparisonTooltipValue: document.querySelector("#comparison-tooltip-value"),
  comparisonChartTitle: document.querySelector("#comparison-chart-title"),
  comparisonChartSubtitle: document.querySelector("#comparison-chart-subtitle"),
  comparisonChartHelp: document.querySelector(".comparison-chart-help"),
  comparisonTableHead: document.querySelector("#comparison-table-head"),
  comparisonTableBody: document.querySelector("#comparison-table-body"),
  comparisonTableDescription: document.querySelector("#comparison-table-description"),
  comparisonPrimaryLabel: document.querySelector("#comparison-primary-label"),
  comparisonPrimaryValue: document.querySelector("#comparison-primary-value"),
  comparisonChangeLabel: document.querySelector("#comparison-change-label"),
  comparisonChangeValue: document.querySelector("#comparison-change-value"),
  comparisonAverageLabel: document.querySelector("#comparison-average-label"),
  comparisonAverageValue: document.querySelector("#comparison-average-value"),
  viewComparisonExcludedButton: document.querySelector("#view-comparison-excluded-button"),
  comparisonExcludedButtonLabel: document.querySelector("#comparison-excluded-button-label"),
  annualCategoryLegend: document.querySelector("#annual-category-legend"),
  annualSpendingChart: document.querySelector("#annual-spending-chart"),
  spendingChartSubtitle: document.querySelector("#spending-chart-subtitle"),
  clearCategoryFilter: document.querySelector("#clear-category-filter"),
  spendingChartTitle: document.querySelector("#spending-chart-title"),
  annualBreakdownHead: document.querySelector("#annual-breakdown-head"),
  annualBreakdownBody: document.querySelector("#annual-breakdown-body"),
  annualBreakdownDescription: document.querySelector("#annual-breakdown-description"),
  annualBreakdownTable: document.querySelector("#annual-breakdown-table"),
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
  transactionGroupFilter: document.querySelector("#transaction-group-filter"),
  transactionFlaggedFilter: document.querySelector("#transaction-flagged-filter"),
  transactionFilterCount: document.querySelector("#transaction-filter-count"),
  resetTransactionFilters: document.querySelector("#reset-transaction-filters"),
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
  dashboardSections: document.querySelectorAll(".hero, .summary-grid, .tag-explorer, .annual-insights, .year-comparison, .categories-section"),
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
  if (state.viewMode === "annual") return state.selectedYear;
  if (state.viewMode === "year-over-year") {
    return state.comparisonStartYear === state.selectedYear
      ? state.selectedYear
      : `${state.comparisonStartYear}\u2013${state.selectedYear}`;
  }
  return monthLabel(selectedMonthKey());
}

function isInternalTransfer(transaction) {
  return transactionUi.isInternalTransfer(transaction);
}

function isIncome(transaction) {
  return transaction.category.trim().toLocaleLowerCase() === "income";
}

function displayAmount(transaction) {
  if (transaction._budgetAmount !== undefined) return transaction._budgetAmount;
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
      const transactionYear = yearKey(transaction);
      const inPeriod = state.viewMode === "annual"
        ? transactionYear === state.selectedYear
        : state.viewMode === "year-over-year"
          ? transactionYear >= state.comparisonStartYear && transactionYear <= state.selectedYear
          : monthKey(transaction) === selectedMonthKey();
      return inPeriod && !isInternalTransfer(transaction);
    })
    .sort(compareLatestFirst);
}

function excludedInternalTransfersForSelectedPeriod() {
  return state.transactions
    .filter((transaction) => {
      const transactionYear = yearKey(transaction);
      const inPeriod = state.viewMode === "annual"
        ? transactionYear === state.selectedYear
        : state.viewMode === "year-over-year"
          ? transactionYear >= state.comparisonStartYear && transactionYear <= state.selectedYear
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
  const currentYear = String(new Date().getFullYear());
  // Today (and its restored view) can select a year with no imported data.
  // Merely opening Ledger still defaults to the latest available month.
  if (years.length === 0 || (preferredYear === currentYear && !years.includes(currentYear))) {
    years.push(currentYear);
    years.sort().reverse();
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

  const ascendingYears = [...years].sort();
  elements.comparisonStartYear.replaceChildren();
  for (const year of ascendingYears) {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    elements.comparisonStartYear.append(option);
  }
  const eligibleStartYears = ascendingYears.filter((year) => year <= state.selectedYear);
  state.comparisonStartYear = eligibleStartYears.includes(state.comparisonStartYear)
    ? state.comparisonStartYear
    : (eligibleStartYears[0] || state.selectedYear);
  elements.comparisonStartYear.value = state.comparisonStartYear;
  const yearsInRange = ascendingYears.filter(
    (year) => year >= state.comparisonStartYear && year <= state.selectedYear,
  );
  state.selectedComparisonYears = state.selectedComparisonYears.filter(
    (year) => yearsInRange.includes(year),
  );
  if (state.selectedComparisonYears.length === 0) {
    state.selectedComparisonYears = yearsInRange.slice(-3);
  }

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

function goToToday() {
  if (elements.todayButton.disabled) return;
  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  state.viewMode = "monthly";
  populatePeriodSelects(month);
  renderDashboard();
}

function populateDatalists() {
  for (const [field, datalist] of Object.entries(elements.datalists)) {
    const taxonomyValues = field === "category"
      ? state.taxonomyCategories.map((category) => category.name)
      : field === "subcategory"
        ? state.taxonomyCategories.flatMap(
            (category) => category.subcategories.map((subcategory) => subcategory.name),
          )
        : [];
    const values = [...new Set([
      ...state.transactions.map((transaction) => transaction[field]),
      ...taxonomyValues,
    ])]
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

function odometerDigitSequence(startDigit, targetDigit, direction, extraTurns) {
  const sequence = [startDigit];
  const distance = direction > 0
    ? (targetDigit - startDigit + 10) % 10
    : (startDigit - targetDigit + 10) % 10;
  const steps = distance + (extraTurns * 10);
  for (let step = 1; step <= steps; step += 1) {
    sequence.push((startDigit + (direction * step) + 1000) % 10);
  }
  return sequence;
}

function renderOdometerValue(element, value) {
  const formattedValue = formatSummaryAmount(value);
  const accessibleValue = currency.format(value);
  const previousValue = Number(element.dataset.summaryValue);
  const hasPreviousValue = Number.isFinite(previousValue);
  const previousDigits = [...formatSummaryAmount(hasPreviousValue ? previousValue : 0)]
    .filter((character) => /\d/.test(character))
    .map(Number);
  const targetDigits = [...formattedValue]
    .filter((character) => /\d/.test(character))
    .map(Number);
  const direction = !hasPreviousValue || value >= previousValue ? 1 : -1;
  const digitOffset = previousDigits.length - targetDigits.length;
  let targetDigitIndex = 0;
  const visualValue = document.createElement("span");
  visualValue.className = "summary-odometer";
  visualValue.setAttribute("aria-hidden", "true");

  for (const character of formattedValue) {
    if (!/\d/.test(character)) {
      const fixedCharacter = document.createElement("span");
      fixedCharacter.className = "summary-odometer-character";
      fixedCharacter.textContent = character;
      visualValue.append(fixedCharacter);
      continue;
    }

    const targetDigit = Number(character);
    const previousDigitIndex = targetDigitIndex + digitOffset;
    const startDigit = previousDigitIndex >= 0
      ? previousDigits[previousDigitIndex]
      : 0;
    const extraTurns = 1 + Math.min(targetDigitIndex, 2);
    const sequence = odometerDigitSequence(startDigit, targetDigit, direction, extraTurns);
    const digitWindow = document.createElement("span");
    digitWindow.className = "summary-odometer-digit";
    const reel = document.createElement("span");
    reel.className = "summary-odometer-reel";
    reel.replaceChildren(...sequence.map((digit) => {
      const item = document.createElement("span");
      item.className = "summary-odometer-reel-item";
      item.textContent = String(digit);
      return item;
    }));
    digitWindow.append(reel);
    visualValue.append(digitWindow);

    const distance = sequence.length - 1;
    const animation = reel.animate(
      [
        { transform: "translateY(0)" },
        { transform: `translateY(-${distance * 1.05}em)` },
      ],
      {
        duration: 500 + (targetDigitIndex * 75),
        easing: "cubic-bezier(0.22, 0.75, 0.2, 1)",
        fill: "forwards",
      },
    );
    animation.finished.then(() => {
      // Remove the forwards-filled transform before collapsing the reel. If the
      // finished animation stays active, it translates the single final digit
      // outside the clipped digit window.
      animation.cancel();
      const finalItem = document.createElement("span");
      finalItem.className = "summary-odometer-reel-item";
      finalItem.textContent = String(targetDigit);
      reel.replaceChildren(finalItem);
      reel.style.transform = "translateY(0)";
    }).catch(() => {
      // A subsequent dashboard render can remove a reel before it finishes.
    });
    targetDigitIndex += 1;
  }

  const accessibleText = document.createElement("span");
  accessibleText.className = "sr-only";
  accessibleText.textContent = accessibleValue;
  element.replaceChildren(visualValue, accessibleText);
  element.dataset.summaryValue = String(value);
  element.title = accessibleValue;
}

function renderSummary(transactions) {
  const { spent, income, net } = calculateSummary(transactions);
  renderOdometerValue(elements.totalSpent, spent);
  renderOdometerValue(elements.totalIncome, income);
  renderOdometerValue(elements.netTotal, net);
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

async function loadTaxonomySuggestions() {
  try {
    const response = await fetch("/api/taxonomy", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!Array.isArray(payload.categories)) return;
    state.taxonomyCategories = payload.categories;
    transactionUi.setEditorTaxonomy(payload.categories);
    populateDatalists();
  } catch {
    // Taxonomy suggestions are optional; transaction data remains usable without them.
  }
}

function normalizeTagKey(tag) {
  return tag === UNTAGGED ? UNTAGGED : String(tag).toLocaleLowerCase();
}

function availableTagKeys() {
  const tags = new Map();
  let hasUntagged = false;
  for (const transaction of state.transactions) {
    if (isInternalTransfer(transaction)) continue;
    const transactionTagList = transactionTags(transaction);
    if (transactionTagList.length === 0) hasUntagged = true;
    for (const tag of transactionTagList) {
      const normalized = normalizeTagKey(tag);
      if (!tags.has(normalized)) tags.set(normalized, tag);
    }
  }
  const values = [...tags.values()].sort((left, right) => left.localeCompare(right));
  if (hasUntagged) values.push(UNTAGGED);
  return values;
}

function selectedTagSet() {
  return new Set(state.selectedTags.map(normalizeTagKey));
}

function transactionMatchesTag(transaction, selectedTag) {
  const tags = transactionTags(transaction);
  if (selectedTag === UNTAGGED) return tags.length === 0;
  const normalized = normalizeTagKey(selectedTag);
  return tags.some((tag) => normalizeTagKey(tag) === normalized);
}

function transactionMatchesTagSelection(transaction) {
  if (state.selectedTags.length === 0) return false;
  const matches = state.selectedTags.map((tag) => transactionMatchesTag(transaction, tag));
  return state.tagMatchMode === "all" ? matches.every(Boolean) : matches.some(Boolean);
}

function matchingTagTransactions(transactions) {
  return transactions.filter(transactionMatchesTagSelection);
}

function tagQueryLabel() {
  if (state.selectedTags.length === 0) return "Select one or more tags";
  const separator = state.tagMatchMode === "all" ? " AND " : " OR ";
  return state.selectedTags.map(breakdownLabel).join(separator);
}

function toggleTagSelection(tag) {
  const normalized = normalizeTagKey(tag);
  const selected = selectedTagSet();
  state.selectedTags = selected.has(normalized)
    ? state.selectedTags.filter((candidate) => normalizeTagKey(candidate) !== normalized)
    : [...state.selectedTags, tag];
  if (
    state.tagMatchMode === "all"
    && state.selectedTags.length > 1
    && state.selectedTags.some((candidate) => candidate === UNTAGGED)
  ) state.tagMatchMode = "any";
  saveDashboardView();
  renderDashboard();
}

function renderTagExplorer(transactions) {
  const tagMode = state.breakdownDimension === "tag";
  const target = state.viewMode === "annual"
    ? elements.annualTagExplorerSlot
    : elements.monthlyTagExplorerSlot;
  if (elements.tagExplorer.parentElement !== target) target.append(elements.tagExplorer);
  elements.tagExplorer.hidden = !tagMode;
  if (!tagMode) return;

  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const selected = selectedTagSet();
  const impossibleAll = state.selectedTags.length > 1
    && state.selectedTags.some((tag) => tag === UNTAGGED);
  if (impossibleAll && state.tagMatchMode === "all") state.tagMatchMode = "any";
  const queryTransactions = matchingTagTransactions(spendingTransactions);

  elements.tagMatchModeButtons.forEach((button) => {
    const mode = button.dataset.tagMatchMode;
    button.setAttribute("aria-pressed", String(mode === state.tagMatchMode));
    button.disabled = mode === "all" && impossibleAll;
    button.title = button.disabled
      ? "Untagged cannot be combined with another tag using Match all."
      : "";
  });

  const search = elements.tagSearch.value.trim().toLocaleLowerCase();
  const buttons = availableTagKeys()
    .filter((tag) => !search || breakdownLabel(tag).toLocaleLowerCase().includes(search))
    .map((tag) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-option";
      const count = spendingTransactions.filter(
        (transaction) => transactionMatchesTag(transaction, tag),
      ).length;
      button.textContent = `${breakdownLabel(tag)} · ${count}`;
      button.setAttribute("aria-pressed", String(selected.has(normalizeTagKey(tag))));
      button.addEventListener("click", () => toggleTagSelection(tag));
      return button;
    });
  if (buttons.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tag-options-empty";
    empty.textContent = availableTagKeys().length === 0 ? "No tags are available yet." : "No tags match this search.";
    elements.tagOptions.replaceChildren(empty);
  } else {
    elements.tagOptions.replaceChildren(...buttons);
  }

  elements.tagQueryExpression.textContent = tagQueryLabel();
  elements.tagQueryResult.textContent = state.selectedTags.length === 0
    ? "Choose tags to build a combined spending view. Tag counts can overlap when transactions have multiple tags."
    : `${queryTransactions.length} ${queryTransactions.length === 1 ? "transaction" : "transactions"} · ${currency.format(displaySum(queryTransactions))} unique spending`;
  elements.clearTagSelection.hidden = state.selectedTags.length === 0;
  elements.viewTagQueryTransactions.disabled = state.selectedTags.length === 0;
}

function breakdownLabel(key) {
  if (key === UNTAGGED) return "Untagged";
  if (key === UNCATEGORIZED || !String(key).trim()) return "Uncategorized";
  return key;
}

function transactionMatchesBreakdown(transaction, key) {
  if (state.breakdownDimension === "category") {
    return key === UNCATEGORIZED ? !transaction.category : transaction.category === key;
  }
  const tags = transactionTags(transaction);
  const normalizedKey = key.toLocaleLowerCase();
  return key === UNTAGGED
    ? tags.length === 0
    : tags.some((tag) => tag.toLocaleLowerCase() === normalizedKey);
}

function groupByBreakdownDimension(transactions) {
  if (state.breakdownDimension === "category") {
    return groupByCategory(transactions).map(
      (group) => ({ ...group, key: group.category || UNCATEGORIZED }),
    );
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
  const tagMode = state.breakdownDimension === "tag";
  elements.categoriesHeading.textContent = tagMode ? "Spending by tags" : "Spending by category";
  elements.categoryGrid.replaceChildren();
  elements.categoryGrid.hidden = tagMode;
  if (tagMode) return;

  const groups = groupByBreakdownDimension(transactions);
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = `No transactions found for this ${state.viewMode === "annual" ? "year" : "month"}.`;
    elements.categoryGrid.append(empty);
    return;
  }

  const maximum = Math.max(...groups.map((group) => Math.abs(group.total)), 1);
  const colors = dashboardSeriesColors("categories", groups.map((group) => group.key));
  groups.forEach((group) => {
    const card = elements.categoryTemplate.content.firstElementChild.cloneNode(true);
    const color = visualizationColor(colors.slot(group.key));
    card.style.setProperty("--category-color", color);
    card.style.setProperty("--bar-width", `${Math.max((Math.abs(group.total) / maximum) * 100, 3)}%`);
    card.querySelector(".category-count").textContent = `${group.transactions.length} ${
      group.transactions.length === 1 ? "transaction" : "transactions"
    }`;
    const groupLabel = breakdownLabel(group.key);
    card.querySelector(".category-name").textContent = groupLabel;
    const totalElement = card.querySelector(".category-total");
    totalElement.textContent = currency.format(group.total);
    totalElement.classList.toggle(
      "is-credit",
      group.total < 0 || (
        state.breakdownDimension === "category" &&
        group.category.trim().toLocaleLowerCase() === "income"
      ),
    );
    card.setAttribute("aria-label", `View ${groupLabel} transactions`);
    card.addEventListener("click", () =>
      openTransactionDialog(groupLabel, group.transactions, {
        type: state.breakdownDimension,
        title: groupLabel,
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

function captureAnnualBarHeights(container, columnSelector, barSelector) {
  return new Map([...container.querySelectorAll(columnSelector)].map((column) => {
    const bars = [...column.querySelectorAll(barSelector)];
    const representative = bars.at(-1);
    return [column.dataset.month, {
      height: bars.reduce(
        (total, bar) => total + (Number.parseFloat(bar.style.height) || 0),
        0,
      ),
      backgroundColor: representative
        ? window.getComputedStyle(representative).backgroundColor
        : "",
      className: representative?.className || "",
    }];
  }));
}

function animateAnnualBars(updates, frameProperty, enabled) {
  if (state[frameProperty] !== null) {
    window.cancelAnimationFrame(state[frameProperty]);
    state[frameProperty] = null;
  }
  if (!enabled) {
    updates.forEach((update) => update(1));
    return;
  }
  const duration = 650;
  updates.forEach((update) => update(0));
  state[frameProperty] = window.requestAnimationFrame(() => {
    const startedAt = window.performance.now();
    const step = (timestamp) => {
      const progress = Math.min((timestamp - startedAt) / duration, 1);
      const easedProgress = 1 - ((1 - progress) ** 3);
      updates.forEach((update) => update(easedProgress));
      if (progress < 1) {
        state[frameProperty] = window.requestAnimationFrame(step);
      } else {
        state[frameProperty] = null;
      }
    };
    state[frameProperty] = window.requestAnimationFrame(step);
  });
}

function animateStackedMonthBars(container, previousHeights) {
  const updates = [];
  for (const track of container.querySelectorAll(".stacked-bar-track[data-month]")) {
    const previous = previousHeights.get(track.dataset.month);
    const segments = [...track.querySelectorAll(".stacked-bar-segment")];
    if (segments.length === 0 && previous?.height > 0) {
      const exitBar = document.createElement("span");
      exitBar.className = "stacked-bar-segment annual-bar-exit";
      exitBar.style.height = `${previous.height}%`;
      exitBar.style.backgroundColor = previous.backgroundColor;
      track.append(exitBar);
      updates.push((progress) => {
        exitBar.style.height = `${previous.height * (1 - progress)}%`;
        exitBar.style.opacity = String(1 - progress);
        if (progress === 1) exitBar.remove();
      });
      continue;
    }
    const targets = segments.map((segment) => Number.parseFloat(segment.style.height) || 0);
    const targetTotal = targets.reduce((total, height) => total + height, 0);
    const previousTotal = previous?.height || 0;
    const startScale = targetTotal > 0 ? previousTotal / targetTotal : 0;
    segments.forEach((segment, index) => {
      const target = targets[index];
      const start = target * startScale;
      updates.push((progress) => {
        segment.style.height = `${start + ((target - start) * progress)}%`;
      });
    });
  }
  animateAnnualBars(
    updates,
    "annualSpendingAnimationFrame",
    previousHeights.size > 0 && updates.length > 0,
  );
}

function colorForCategory(category, categories) {
  return visualizationColor(dashboardSeriesColors("categories", categories).slot(category));
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
  const scope = `subcategories.${String(state.annualCategoryFilter).trim().toLocaleLowerCase()}`;
  const index = dashboardSeriesColors(scope, subcategories, 6).slot(subcategory);
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

function renderAnnualTagSpendingChart(spendingTransactions) {
  const previousHeights = captureAnnualBarHeights(
    elements.annualSpendingChart,
    ".stacked-bar-track[data-month]",
    ".stacked-bar-segment",
  );
  const matching = matchingTagTransactions(spendingTransactions);
  elements.annualCategoryLegend.replaceChildren();
  elements.annualCategoryLegend.hidden = true;
  elements.clearCategoryFilter.hidden = true;
  elements.spendingChartTitle.textContent = state.selectedTags.length > 0
    ? `Monthly spending matching ${tagQueryLabel()}`
    : "Monthly spending by tag";
  elements.spendingChartSubtitle.textContent = state.selectedTags.length > 0
    ? `${matching.length} ${matching.length === 1 ? "transaction" : "transactions"} · ${currency.format(displaySum(matching))} unique spending`
    : "Select tags above to chart a combined result without double-counting.";
  elements.annualSpendingChart.replaceChildren();
  if (state.selectedTags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "Select one or more tags to chart unique monthly spending.";
    elements.annualSpendingChart.append(empty);
    return;
  }

  const byMonth = annualTransactionsByMonth(matching);
  const months = [...byMonth.entries()].map(([month, monthTransactions]) => ({
    month,
    transactions: monthTransactions,
    total: Math.max(displaySum(monthTransactions), 0),
  }));
  const maximum = Math.max(...months.map((month) => month.total), 1);
  for (const monthData of months) {
    const column = document.createElement("div");
    column.className = "stacked-month";
    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = monthData.total > 0 ? currency.format(monthData.total) : "—";
    const track = document.createElement("div");
    track.className = "stacked-bar-track";
    track.dataset.month = monthData.month;
    track.setAttribute(
      "aria-label",
      `${monthLabel(`${state.selectedYear}-${monthData.month}`)} matching spending: ${currency.format(monthData.total)}`,
    );
    if (monthData.total > 0) {
      const bar = document.createElement("span");
      bar.className = "stacked-bar-segment tag-query-bar";
      bar.style.height = `${(monthData.total / maximum) * 100}%`;
      bar.title = `${currency.format(monthData.total)} · ${monthData.transactions.length} ${monthData.transactions.length === 1 ? "transaction" : "transactions"}`;
      track.append(bar);
    }
    const label = document.createElement("span");
    label.className = "chart-month-label";
    label.textContent = shortMonthFormatter.format(
      parseLocalDate(`${state.selectedYear}-${monthData.month}-01`),
    );
    column.append(value, track, label);
    elements.annualSpendingChart.append(column);
  }
  animateStackedMonthBars(elements.annualSpendingChart, previousHeights);
}

function renderAnnualSpendingChart(transactions) {
  const previousHeights = captureAnnualBarHeights(
    elements.annualSpendingChart,
    ".stacked-bar-track[data-month]",
    ".stacked-bar-segment",
  );
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const categoryMode = state.breakdownDimension === "category";
  if (!categoryMode) {
    renderAnnualTagSpendingChart(spendingTransactions);
    return;
  }
  elements.annualCategoryLegend.hidden = false;
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
      ? transactionMatchesBreakdown(transaction, state.annualCategoryFilter)
        && subcategoryKey(transaction) === key
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
    ? `Monthly ${breakdownLabel(state.annualCategoryFilter)} spending by subcategory`
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
    track.dataset.month = monthData.month;
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
  animateStackedMonthBars(elements.annualSpendingChart, previousHeights);
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

function renderAnnualTagBreakdown(spendingTransactions) {
  elements.annualBreakdownTable.classList.add("annual-breakdown-table--tag-results");
  const headerRow = document.createElement("tr");
  for (const label of ["Month", "Matching transactions", "Unique spending"]) {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    headerRow.append(header);
  }
  elements.annualBreakdownHead.replaceChildren(headerRow);

  if (state.selectedTags.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "annual-breakdown-empty";
    cell.textContent = "Select one or more tags to compare unique monthly totals.";
    row.append(cell);
    elements.annualBreakdownBody.replaceChildren(row);
    return;
  }

  const matching = matchingTagTransactions(spendingTransactions);
  const byMonth = annualTransactionsByMonth(matching);
  const rows = [...byMonth.entries()].map(([month, monthTransactions]) => {
    const row = document.createElement("tr");
    const monthCell = document.createElement("th");
    monthCell.scope = "row";
    monthCell.textContent = monthLabel(`${state.selectedYear}-${month}`);
    const countCell = document.createElement("td");
    countCell.textContent = String(monthTransactions.length);
    const amountCell = annualAmountCell(displaySum(monthTransactions));
    row.append(monthCell, countCell, amountCell);
    return row;
  });
  const totalRow = document.createElement("tr");
  totalRow.className = "annual-category-row tag-query-total-row";
  const totalLabel = document.createElement("th");
  totalLabel.scope = "row";
  totalLabel.textContent = "Annual total";
  const totalCount = document.createElement("td");
  totalCount.textContent = String(matching.length);
  const totalAmount = annualAmountCell(displaySum(matching));
  totalAmount.classList.add("annual-total-cell");
  totalRow.append(totalLabel, totalCount, totalAmount);
  rows.push(totalRow);
  elements.annualBreakdownBody.replaceChildren(...rows);
}

function renderAnnualBreakdown(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const categoryMode = state.breakdownDimension === "category";
  if (!categoryMode) {
    renderAnnualTagBreakdown(spendingTransactions);
    return;
  }
  elements.annualBreakdownTable.classList.remove("annual-breakdown-table--tag-results");
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
    expandButton.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} ${breakdownLabel(group.key)} subcategories`,
    );
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";
    const label = document.createElement("span");
    label.textContent = breakdownLabel(group.key);
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
  const previousHeights = captureAnnualBarHeights(
    elements.annualNetChart,
    ".net-bar-area[data-month]",
    ".net-bar",
  );
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
    area.dataset.month = monthData.month;
    const axis = document.createElement("span");
    axis.className = "net-zero-axis";
    area.append(axis);
    if (monthData.net !== 0) {
      const bar = document.createElement("span");
      bar.className = `net-bar ${monthData.net > 0 ? "is-positive" : "is-negative"}`;
      const targetHeight = Math.max((Math.abs(monthData.net) / maximum) * 46, 2);
      const startHeight = previousHeights.get(monthData.month)?.height || 0;
      bar.style.height = `${targetHeight}%`;
      bar.dataset.startHeight = String(startHeight);
      bar.dataset.targetHeight = String(targetHeight);
      bar.title = `${monthLabel(`${state.selectedYear}-${monthData.month}`)}: ${currency.format(monthData.net)}`;
      area.append(bar);
    } else {
      const previous = previousHeights.get(monthData.month);
      if (previous?.height > 0) {
        const exitBar = document.createElement("span");
        exitBar.className = `${previous.className} annual-bar-exit`;
        exitBar.style.height = "0%";
        exitBar.style.backgroundColor = previous.backgroundColor;
        exitBar.dataset.startHeight = String(previous.height);
        exitBar.dataset.targetHeight = "0";
        area.append(exitBar);
      }
    }
    const label = document.createElement("span");
    label.className = "chart-month-label";
    label.textContent = shortMonthFormatter.format(parseLocalDate(`${state.selectedYear}-${monthData.month}-01`));
    column.append(value, area, label);
    elements.annualNetChart.append(column);
  }
  const updates = [...elements.annualNetChart.querySelectorAll(".net-bar")].map((bar) => {
    const start = Number(bar.dataset.startHeight) || 0;
    const target = Number(bar.dataset.targetHeight) || 0;
    return (progress) => {
      bar.style.height = `${start + ((target - start) * progress)}%`;
      if (target === 0) {
        bar.style.opacity = String(1 - progress);
        if (progress === 1) bar.remove();
      }
    };
  });
  animateAnnualBars(
    updates,
    "annualNetAnimationFrame",
    previousHeights.size > 0 && updates.length > 0,
  );
}

function renderAnnualCharts(transactions) {
  renderAnnualSpendingChart(transactions);
  if (state.breakdownDimension === "category" && state.annualCategoryFilter) {
    state.annualExpandedCategories.add(state.annualCategoryFilter);
  }
  renderAnnualBreakdown(transactions);
  renderAnnualNetChart(transactions);
}

function comparisonMetricLabel(metric = state.comparisonMetric) {
  return { spending: "spending", income: "income", net: "net total" }[metric];
}

function comparisonValueLabel() {
  const prefix = state.comparisonChartMode === "cumulative" ? "cumulative" : "monthly";
  return `${prefix} ${comparisonMetricLabel()}`;
}

function comparisonAmount(transaction, metric = state.comparisonMetric) {
  const amount = displayAmount(transaction);
  if (metric === "spending") return isIncome(transaction) ? 0 : amount;
  if (metric === "income") return isIncome(transaction) ? Math.abs(amount) : 0;
  return isIncome(transaction) ? Math.abs(amount) : -amount;
}

function comparisonTransactionsForMonth(year, month, metric = state.comparisonMetric) {
  return state.transactions
    .filter((transaction) => (
      yearKey(transaction) === year
      && transaction.date.slice(5, 7) === month
      && !isInternalTransfer(transaction)
      && (metric === "net" || (metric === "income") === isIncome(transaction))
    ))
    .sort(compareLatestFirst);
}

function lastObservedMonth(year) {
  return state.transactions.reduce((latest, transaction) => {
    if (yearKey(transaction) !== year || isInternalTransfer(transaction)) return latest;
    return Math.max(latest, Number(transaction.date.slice(5, 7)));
  }, 0);
}

function selectedComparisonYears() {
  return [...state.selectedComparisonYears].sort();
}

function comparisonCutoffForYear(year) {
  return lastObservedMonth(year);
}

function comparisonSeries() {
  const years = selectedComparisonYears();
  return years.map((year) => {
    const cutoff = comparisonCutoffForYear(year);
    let runningTotal = 0;
    const points = [];
    for (let monthNumber = 1; monthNumber <= cutoff; monthNumber += 1) {
      const month = String(monthNumber).padStart(2, "0");
      const transactions = comparisonTransactionsForMonth(year, month);
      const monthlyTotal = transactions.reduce(
        (total, transaction) => total + comparisonAmount(transaction),
        0,
      );
      runningTotal += monthlyTotal;
      points.push({
        month,
        value: state.comparisonChartMode === "cumulative" ? runningTotal : monthlyTotal,
        transactions,
      });
    }
    return { year, cutoff, points, total: runningTotal };
  });
}

function compactCurrency(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1000000) return `${value < 0 ? "-" : ""}$${(absolute / 1000000).toFixed(1)}m`;
  if (absolute >= 1000) return `${value < 0 ? "-" : ""}$${(absolute / 1000).toFixed(0)}k`;
  return currency.format(value);
}

function svgElement(name, attributes = {}, textContent = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (textContent) element.textContent = textContent;
  return element;
}

function openComparisonMonthTransactions(year, month) {
  hideComparisonTooltip();
  const metric = comparisonMetricLabel();
  const title = `${monthLabel(`${year}-${month}`)} ${metric}`;
  openTransactionDialog(title, comparisonTransactionsForMonth(year, month), {
    type: "comparison-month",
    title,
    year,
    month,
    metric: state.comparisonMetric,
    eyebrow: "Year-over-year comparison",
  });
}

function showComparisonTooltip(point, year, clientX, clientY) {
  elements.comparisonTooltipLabel.textContent = `${monthLabel(`${year}-${point.month}`)} - ${comparisonValueLabel()}`;
  elements.comparisonTooltipValue.textContent = currency.format(point.value);
  elements.comparisonChartTooltip.hidden = false;
  const tooltipRect = elements.comparisonChartTooltip.getBoundingClientRect();
  const gap = 14;
  const left = Math.min(
    Math.max(clientX + gap, 8),
    window.innerWidth - tooltipRect.width - 8,
  );
  const above = clientY - tooltipRect.height - gap;
  const top = above >= 8 ? above : Math.min(clientY + gap, window.innerHeight - tooltipRect.height - 8);
  elements.comparisonChartTooltip.style.left = `${left}px`;
  elements.comparisonChartTooltip.style.top = `${top}px`;
}

function hideComparisonTooltip() {
  elements.comparisonChartTooltip.hidden = true;
}

function renderComparisonYearPicker() {
  const years = [...elements.comparisonStartYear.options]
    .map((option) => option.value)
    .filter((year) => year >= state.comparisonStartYear && year <= state.selectedYear);
  const selected = new Set(state.selectedComparisonYears);
  const buttons = years.map((year) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comparison-year-button";
    button.style.setProperty("--year-color", colorForComparisonYear(year));
    button.textContent = year;
    button.setAttribute("aria-pressed", String(selected.has(year)));
    button.addEventListener("click", () => {
      if (selected.has(year) && selected.size === 1) return;
      state.selectedComparisonYears = selected.has(year)
        ? state.selectedComparisonYears.filter((candidate) => candidate !== year)
        : [...state.selectedComparisonYears, year];
      saveDashboardView();
      renderYearComparison();
    });
    return button;
  });
  elements.comparisonYearPicker.replaceChildren(...buttons);
}

function animateComparisonChart(updates, enabled) {
  if (!enabled) {
    updates.forEach((update) => update(1));
    state.comparisonAnimationFrame = null;
    return;
  }
  const duration = 700;
  updates.forEach((update) => update(0));
  // The first frame paints the old coordinates. Starting on the following frame
  // prevents browsers from coalescing the old and new SVG states into one redraw.
  state.comparisonAnimationFrame = window.requestAnimationFrame(() => {
    const startedAt = window.performance.now();
    const step = (timestamp) => {
      const progress = Math.min((timestamp - startedAt) / duration, 1);
      const easedProgress = 1 - ((1 - progress) ** 3);
      updates.forEach((update) => update(easedProgress));
      if (progress < 1) {
        state.comparisonAnimationFrame = window.requestAnimationFrame(step);
      } else {
        state.comparisonAnimationFrame = null;
      }
    };
    state.comparisonAnimationFrame = window.requestAnimationFrame(step);
  });
}

function renderComparisonChart(series) {
  const svg = elements.comparisonChart;
  const previousCoordinates = new Map(
    [...svg.querySelectorAll(".comparison-point[data-point-key]")].map((point) => [
      point.dataset.pointKey,
      Number(point.getAttribute("cy")),
    ]),
  );
  if (state.comparisonAnimationFrame !== null) {
    window.cancelAnimationFrame(state.comparisonAnimationFrame);
    state.comparisonAnimationFrame = null;
  }
  hideComparisonTooltip();
  svg.replaceChildren();
  if (series.length === 0 || series.every((item) => item.points.length === 0)) {
    const message = series.length === 0
      ? "Select at least one year to compare."
      : "No transactions are available for the selected years.";
    svg.append(svgElement("text", { x: 500, y: 210, class: "comparison-empty" }, message));
    return;
  }
  const plot = { left: 88, top: 24, width: 874, height: 342 };
  const values = [0, ...series.flatMap((item) => item.points.map((point) => point.value))];
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) maximum = minimum + 1;
  const padding = (maximum - minimum) * 0.08;
  minimum = Math.min(0, minimum - padding);
  maximum = Math.max(0, maximum + padding);
  const yFor = (value) => plot.top + ((maximum - value) / (maximum - minimum)) * plot.height;
  const xFor = (monthIndex) => plot.left + (monthIndex / 11) * plot.width;
  const zeroY = yFor(0);
  const animationUpdates = [];

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = maximum - ((maximum - minimum) * tick) / 4;
    const y = yFor(value);
    svg.append(
      svgElement("line", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y, class: "comparison-grid-line" }),
      svgElement("text", { x: plot.left - 12, y: y + 4, class: "comparison-axis-value", "text-anchor": "end" }, compactCurrency(value)),
    );
  }
  if (minimum < 0 && maximum > 0) {
    svg.append(svgElement("line", { x1: plot.left, y1: zeroY, x2: plot.left + plot.width, y2: zeroY, class: "comparison-zero-line" }));
  }
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const month = String(monthIndex + 1).padStart(2, "0");
    svg.append(svgElement("text", {
      x: xFor(monthIndex),
      y: 405,
      class: "comparison-axis-month",
      "text-anchor": "middle",
    }, shortMonthFormatter.format(parseLocalDate(`2000-${month}-01`))));
  }

  series.forEach((yearSeries) => {
    const color = colorForComparisonYear(yearSeries.year);
    const coordinates = yearSeries.points.map((point, index) => {
      const key = `${yearSeries.year}-${point.month}`;
      return {
        x: xFor(index),
        fromY: previousCoordinates.get(key) ?? zeroY,
        toY: yFor(point.value),
      };
    });
    const line = svgElement("polyline", {
      points: coordinates.map(({ x, fromY }) => `${x},${fromY}`).join(" "),
      fill: "none",
      stroke: color,
      "stroke-width": 4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "comparison-line",
    });
    animationUpdates.push((progress) => {
      line.setAttribute("points", coordinates.map(({ x, fromY, toY }) => (
        `${x},${fromY + ((toY - fromY) * progress)}`
      )).join(" "));
    });
    svg.append(line);
    yearSeries.points.forEach((point, index) => {
      const pointKey = `${yearSeries.year}-${point.month}`;
      const fromY = previousCoordinates.get(pointKey) ?? zeroY;
      const toY = yFor(point.value);
      const circle = svgElement("circle", {
        cx: xFor(index),
        cy: fromY,
        r: 6,
        fill: color,
        class: "comparison-point",
        "data-point-key": pointKey,
        tabindex: 0,
        role: "button",
        "aria-label": `${monthLabel(`${yearSeries.year}-${point.month}`)}: ${currency.format(point.value)} ${comparisonValueLabel()}. Review ${point.transactions.length} monthly transactions.`,
      });
      animationUpdates.push((progress) => {
        circle.setAttribute("cy", String(fromY + ((toY - fromY) * progress)));
      });
      circle.addEventListener("pointerenter", (event) => {
        showComparisonTooltip(point, yearSeries.year, event.clientX, event.clientY);
      });
      circle.addEventListener("pointermove", (event) => {
        showComparisonTooltip(point, yearSeries.year, event.clientX, event.clientY);
      });
      circle.addEventListener("pointerleave", hideComparisonTooltip);
      circle.addEventListener("focus", () => {
        const bounds = circle.getBoundingClientRect();
        showComparisonTooltip(point, yearSeries.year, bounds.left + bounds.width / 2, bounds.top);
      });
      circle.addEventListener("blur", hideComparisonTooltip);
      circle.addEventListener("click", () => openComparisonMonthTransactions(yearSeries.year, point.month));
      circle.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openComparisonMonthTransactions(yearSeries.year, point.month);
      });
      svg.append(circle);
    });
  });
  animateComparisonChart(animationUpdates, previousCoordinates.size > 0);
}

function renderComparisonTable(series) {
  const metricLabel = comparisonMetricLabel();
  const header = document.createElement("tr");
  const labels = ["Year", ...Array.from({ length: 12 }, (_, index) => (
    shortMonthFormatter.format(parseLocalDate(`2000-${String(index + 1).padStart(2, "0")}-01`))
  )), "Period total", "Change"];
  header.replaceChildren(...labels.map((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    return cell;
  }));
  elements.comparisonTableHead.replaceChildren(header);

  const ascending = [...series].sort((left, right) => left.year.localeCompare(right.year));
  const priorByYear = new Map(ascending.map((item, index) => [item.year, ascending[index - 1]]));
  const rows = [...series].sort((left, right) => right.year.localeCompare(left.year)).map((item) => {
    const row = document.createElement("tr");
    const yearCell = document.createElement("th");
    yearCell.scope = "row";
    yearCell.textContent = item.year;
    yearCell.style.setProperty("--year-color", colorForComparisonYear(item.year));
    row.append(yearCell);
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const cell = document.createElement("td");
      const point = item.points[monthIndex];
      cell.textContent = point ? currency.format(point.value) : "\u2014";
      if (point) {
        const valueType = state.comparisonChartMode === "cumulative" ? "Cumulative" : "Monthly";
        const datePreposition = state.comparisonChartMode === "cumulative" ? "through" : "for";
        cell.title = `${valueType} ${metricLabel} ${datePreposition} ${monthLabel(`${item.year}-${point.month}`)}`;
      }
      row.append(cell);
    }
    const totalCell = document.createElement("td");
    totalCell.className = "comparison-total-cell";
    totalCell.textContent = currency.format(item.total);
    row.append(totalCell);
    const changeCell = document.createElement("td");
    const prior = priorByYear.get(item.year);
    if (!prior) {
      changeCell.textContent = "\u2014";
    } else {
      const change = item.total - prior.total;
      const percent = prior.total === 0 ? "" : ` (${Math.abs((change / prior.total) * 100).toFixed(1)}%)`;
      changeCell.textContent = `${change > 0 ? "+" : ""}${currency.format(change)}${percent}`;
      changeCell.classList.toggle("is-positive", state.comparisonMetric === "net" ? change > 0 : change < 0);
      changeCell.classList.toggle("is-negative", state.comparisonMetric === "net" ? change < 0 : change > 0);
    }
    row.append(changeCell);
    return row;
  });
  elements.comparisonTableBody.replaceChildren(...rows);
}

function renderYearComparison() {
  renderComparisonYearPicker();
  elements.comparisonMetricButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.comparisonMetric === state.comparisonMetric));
  });
  elements.comparisonChartModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.comparisonChartMode === state.comparisonChartMode));
  });
  const label = comparisonMetricLabel();
  const valueType = state.comparisonChartMode === "cumulative" ? "Cumulative" : "Monthly";
  elements.yearComparisonDescription.textContent = state.comparisonChartMode === "cumulative"
    ? "Running totals make it easy to compare each year's financial pace month by month."
    : "Monthly totals make seasonal changes and one-off spikes easy to compare across years.";
  elements.comparisonChartTitle.textContent = `${valueType} ${label}`;
  elements.comparisonChartSubtitle.textContent = "Each line continues through the latest month available in that year.";
  elements.comparisonTableDescription.textContent = `${valueType} ${label} values and year-over-year changes include every available month.`;
  const series = comparisonSeries();
  const latest = series.at(-1);
  const prior = series.at(-2);
  elements.comparisonPrimaryLabel.textContent = latest ? `${latest.year} ${label}` : "Latest period";
  elements.comparisonPrimaryValue.textContent = latest ? currency.format(latest.total) : "\u2014";
  elements.comparisonChangeLabel.textContent = prior
    ? `Change from ${prior.year}`
    : "Change from prior year";
  elements.comparisonChangeValue.classList.remove("is-positive", "is-negative");
  if (latest && prior) {
    const change = latest.total - prior.total;
    elements.comparisonChangeValue.textContent = `${change > 0 ? "+" : ""}${currency.format(change)}`;
    elements.comparisonChangeValue.classList.toggle(
      "is-positive", state.comparisonMetric === "net" ? change > 0 : change < 0,
    );
    elements.comparisonChangeValue.classList.toggle(
      "is-negative", state.comparisonMetric === "net" ? change < 0 : change > 0,
    );
  } else {
    elements.comparisonChangeValue.textContent = "\u2014";
  }
  elements.comparisonAverageLabel.textContent = latest
    ? `${latest.year} monthly average`
    : "Monthly average";
  elements.comparisonAverageValue.textContent = latest && latest.cutoff
    ? currency.format(latest.total / latest.cutoff)
    : "\u2014";
  renderComparisonChart(series);
  renderComparisonTable(series);
}

function transactionRowOptions(transaction) {
  return {
    currency,
    shortMonthFormatter,
    amountForDisplay: displayAmount,
    onEdit: () => openTransactionForm(transaction),
  };
}

const dashboardBulk = window.LedgerTransactionBulk.create({
  container: elements.transactionList,
  getGroupFilter: () => state.transactionDialogFilters.group,
  getTransactions: () => state.transactionDialogTransactions,
  getAllTransactions: () => state.transactions,
  getRevision: () => state.revision,
  render: () => renderTransactionDialogTransactions(),
  onSaved: (payload) => {
    const context = state.transactionDialogContext;
    const wasOpen = elements.dialog.open;
    elements.dialog.close();
    applyPayload(payload);
    if (wasOpen) reopenTransactionDialog(context);
  },
});

function currentTransactionDialogFilters() {
  return {
    flagged: state.transactionDialogFilters.flagged || "",
    group: state.transactionDialogFilters.group || "",
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
    flagged: transactionUi.flagFilterValue(elements.transactionFlaggedFilter),
    group: elements.transactionGroupFilter.value,
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
  transactionUi.setFlagFilter(elements.transactionFlaggedFilter, filters.flagged || "");
  transactionUi.populateGroupFilter(elements.transactionGroupFilter, transactions, filters.group);
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
    flagged: transactionUi.flagFilterValue(elements.transactionFlaggedFilter),
    group: elements.transactionGroupFilter.value,
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
  if (field === "flagged") return transactionUi.flagFilterLabel(value);
  if (field === "group") return transactionUi.groupFilterLabel(value);
  if (field === "subcategory" && value === UNCLASSIFIED_SUBCATEGORY) return "Unclassified";
  return value;
}

function renderActiveTransactionFilters() {
  const definitions = [
    ["flagged", "Flag status"],
    ["group", "Group"],
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
          flagged: elements.transactionFlaggedFilter,
          group: elements.transactionGroupFilter,
          subcategory: elements.transactionSubcategoryFilter,
          tag: elements.transactionTagFilter,
          accountName: elements.transactionAccountFilter,
          provider: elements.transactionProviderFilter,
        }[field];
        if (field === "flagged") transactionUi.setFlagFilter(select, "");
        else if (select) select.value = "";
      }
      renderTransactionDialogTransactions();
    });
    return chip;
  });
  elements.transactionFilterChips.replaceChildren(...chips);
}

function syncTransactionFilterDraft() {
  const filters = state.transactionDialogFilters;
  transactionUi.setFlagFilter(elements.transactionFlaggedFilter, filters.flagged || "");
  elements.transactionGroupFilter.value = filters.group || "";
  elements.transactionCategoryFilter.value = filters.category || "";
  populateTransactionSubcategoryFilter(filters.category || "", filters.subcategory || "");
  elements.transactionTagFilter.value = filters.tag || "";
  elements.transactionAccountFilter.value = filters.accountName || "";
  elements.transactionProviderFilter.value = filters.provider || "";
}

function setTransactionFilterPopover(open, { restoreDraft = true } = {}) {
  if (!open && restoreDraft) syncTransactionFilterDraft();
  transactionUi.setTransactionFilterPanel(elements.transactionFilterPopover, elements.transactionFilterButton, open);
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
  const visibleTransactions = transactionUi.sortTransactions(
    state.transactionDialogTransactions.filter((transaction) => (
      transactionUi.matchesTransactionSearch(transaction, filters.description) &&
      transactionUi.matchesFlagFilter(transaction, filters.flagged) &&
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
  const groupFiltered = dashboardBulk.filter(visibleTransactions);
  const total = state.transactionDialogTransactions.length;
  const filtered = Object.values(filters).some(Boolean) || groupFiltered.length !== total;
  elements.dialogSubtitle.textContent = filtered
    ? `${groupFiltered.length} of ${total} transactions`
    : `${total} ${total === 1 ? "transaction" : "transactions"}`;
  renderActiveTransactionFilters();
  renderSubcategorySummary();
  dashboardBulk.render(visibleTransactions, transactionRowOptions);
  if (groupFiltered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = "No transactions match these filters.";
    elements.transactionList.replaceChildren(empty);
    return;
  }
}

function openTransactionDialog(title, transactions, context, { preserveFilters = false } = {}) {
  if (!preserveFilters) dashboardBulk.reset();
  const filters = preserveFilters
    ? state.transactionDialogFilters
    : { description: "", category: "", tag: "", accountName: "", provider: "", subcategory: "" };
  state.transactionDialogContext = context;
  state.transactionDialogTransactions = [...transactions].sort(compareLatestFirst);
  elements.dialogEyebrow.textContent = context?.eyebrow || selectedPeriodLabel();
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
        if (context.type === "category") {
          return context.key === UNCATEGORIZED
            ? !transaction.category
            : transaction.category === context.key;
        }
        const tags = transactionTags(transaction);
        return context.key === UNTAGGED ? tags.length === 0 : tags.includes(context.key);
      },
    );
  } else if (context.type === "tag-query") {
    transactions = matchingTagTransactions(
      transactionsForSelectedPeriod().filter((transaction) => !isIncome(transaction)),
    );
  } else if (context.type === "excluded") {
    transactions = excludedInternalTransfersForSelectedPeriod();
  } else if (context.type === "comparison-month") {
    transactions = comparisonTransactionsForMonth(context.year, context.month, context.metric);
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
  if (state.viewMode === "annual" || state.viewMode === "year-over-year") {
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
  if (!isBusy) transactionUi.refreshTransactionTagPicker(elements.form);
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

  transactionUi.configureTransactionTagPicker(
    elements.form,
    transactionUi.tagsFromTransactions(state.transactions),
  );
  transactionUi.populateTransactionEditor(elements.form, transaction, {
    date: defaultNewTransactionDate(),
  }, { transactions: state.transactions });
  elements.formDialog.showModal();
  formField(editing ? "description" : "date").focus();
}

function transactionFromForm() {
  const existingTransaction = state.transactions.find(
    (transaction) => transaction._id === state.editingTransactionId,
  );
  const transaction = transactionUi.transactionFromEditor(elements.form, existingTransaction);
  return existingTransaction ? dashboardBulk.prepareSave(transaction, existingTransaction) : transaction;
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
  dashboardBulk.acceptSaved(payload);
  state.transactions = payload.transactions;
  state.revision = payload.revision;
  const stablePreferredMonth = state.viewMode === "year-over-year"
    ? `${state.selectedYear}-${state.selectedMonth}`
    : preferredMonth;
  populatePeriodSelects(stablePreferredMonth);
  populateDatalists();
  renderDashboard();
  elements.todayButton.disabled = false;
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
      "This updates the master CSV and cannot be undone. A safety backup is created first. Any links to this row are removed, which can change the remaining purchase or credit’s budget amount.",
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
  const comparison = state.viewMode === "year-over-year";
  const tagMode = !comparison && state.breakdownDimension === "tag";
  elements.monthControl.hidden = annual || comparison;
  elements.comparisonStartYearControl.hidden = !comparison;
  elements.yearControlLabel.textContent = comparison ? "End year" : "Year";
  elements.monthlyBreakdownTabs.hidden = annual || comparison;
  elements.categoriesSection.hidden = annual || comparison;
  elements.summaryGrid.hidden = comparison;
  elements.breakdownDimensionButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.breakdownDimension === state.breakdownDimension),
    );
  });
  // Normalize the active tag query before any summary or chart uses it.
  if (!comparison) renderTagExplorer(transactions);
  else elements.tagExplorer.hidden = true;
  elements.annualBreakdownDescription.textContent = state.breakdownDimension === "category"
    ? "Expand a category to compare exact subcategory totals across months."
    : state.selectedTags.length > 0
      ? `Unique monthly results for ${tagQueryLabel()}. Each matching transaction is counted once.`
      : "Select tags to compare unique monthly totals without double-counting overlaps.";
  elements.overviewEyebrow.textContent = comparison
    ? "Year-over-year overview"
    : annual ? "Annual overview" : "Monthly overview";
  elements.summaryGrid.setAttribute("aria-label", `${annual ? "Annual" : "Monthly"} summary${tagMode ? " for selected tags" : ""}`);
  elements.spendingSummaryNote.textContent = tagMode
    ? state.selectedTags.length ? "Selected tags · internal transfers excluded" : "Select tags to see spending"
    : "Internal transfers are excluded";
  elements.incomeSummaryNote.textContent = tagMode
    ? state.selectedTags.length ? "Income matching selected tags" : "Select tags to see income"
    : annual ? "Income received this year" : "Income received this month";
  elements.periodDescription.textContent = state.selectedYear
    ? comparison
      ? `Compare financial progress from ${state.comparisonStartYear} through ${state.selectedYear}.`
      : annual
      ? `A full-year view of where your money went in ${state.selectedYear}.`
      : `A clear view of where your money went in ${monthLabel(selectedMonthKey())}.`
    : "No transaction data is available yet.";
  if (!comparison) {
    // Filter the complete period, not the spending-only explorer result: tagged
    // income belongs in the cards too. Filtering rows counts overlapping tags once.
    renderSummary(tagMode ? matchingTagTransactions(transactions) : transactions);
    if (tagMode && state.selectedTags.length === 0) {
      elements.netTotalNote.textContent = "Select tags to see net total";
    }
  }
  if (!annual && !comparison) renderCategories(transactions);
  elements.annualInsights.hidden = !annual;
  if (annual) {
    renderAnnualCharts(transactions);
  }
  elements.yearComparison.hidden = !comparison;
  if (comparison) renderYearComparison();
  elements.viewAllButton.disabled = transactions.length === 0;
  const excludedLabel =
    `View ${excludedInternalTransfers.length} excluded internal transfer transactions`;
  elements.excludedButtonLabel.textContent = excludedLabel;
  elements.annualExcludedButtonLabel.textContent = excludedLabel;
  elements.viewExcludedButton.hidden = annual || comparison || excludedInternalTransfers.length === 0;
  elements.viewAnnualExcludedButton.hidden = !annual;
  elements.viewAnnualExcludedButton.disabled = excludedInternalTransfers.length === 0;
  elements.comparisonExcludedButtonLabel.textContent = excludedLabel;
  elements.viewComparisonExcludedButton.hidden = !comparison;
  elements.viewComparisonExcludedButton.disabled = excludedInternalTransfers.length === 0;
}

function setError(message, code = "") {
  elements.todayButton.disabled = true;
  const fileMissing = code === "transaction_file_missing";
  const transferReview = code === "internal_transfer_review_required";
  elements.errorState.classList.toggle("error-state--setup", fileMissing);
  elements.errorEyebrow.textContent = fileMissing ? "Get started" : "Unable to load data";
  elements.errorTitle.textContent = fileMissing ? "Import your transaction data." : "Something went wrong.";
  elements.errorMessage.textContent = fileMissing
    ? "Choose a data source to create your transaction file and start using Ledger."
    : message;
  elements.importDataButton.hidden = !fileMissing;
  elements.retryButton.hidden = fileMissing;
  elements.importDataButton.href = transferReview ? "/settings#internal-transfers" : "/import";
  elements.importDataButton.textContent = transferReview ? "Review internal transfers" : "Import data";
  if (transferReview) {
    elements.errorState.classList.add("error-state--setup");
    elements.errorEyebrow.textContent = "One-time review";
    elements.errorTitle.textContent = "Save your internal transfers.";
    elements.importDataButton.hidden = false;
  }
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
  elements.todayButton.disabled = true;
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
    if (payload.internalTransferReviewRequired) {
      setError("Transfer detection now runs only when you import or request a scan. Review existing matches once before viewing updated totals; your CSV has not been changed.", "internal_transfer_review_required");
      return;
    }
    applyPayload(payload);
    loadTaxonomySuggestions();
  } catch (error) {
    setError(error instanceof Error ? error.message : "The transaction data could not be loaded.");
  }
}

elements.viewModeSelect.addEventListener("change", (event) => {
  state.viewMode = event.target.value;
  saveDashboardView();
  renderDashboard();
});
elements.todayButton.addEventListener("click", goToToday);
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
  if (state.comparisonStartYear > state.selectedYear) {
    state.comparisonStartYear = state.selectedYear;
    elements.comparisonStartYear.value = state.comparisonStartYear;
  }
  const validYears = [...elements.comparisonStartYear.options]
    .map((option) => option.value)
    .filter((year) => year >= state.comparisonStartYear && year <= state.selectedYear);
  state.selectedComparisonYears = state.selectedComparisonYears.filter((year) => validYears.includes(year));
  if (state.selectedComparisonYears.length === 0) state.selectedComparisonYears = validYears.slice(-3);
  saveDashboardView();
  renderDashboard();
});
elements.comparisonStartYear.addEventListener("change", (event) => {
  state.comparisonStartYear = event.target.value;
  if (state.comparisonStartYear > state.selectedYear) {
    state.selectedYear = state.comparisonStartYear;
    elements.yearSelect.value = state.selectedYear;
  }
  const validYears = [...elements.comparisonStartYear.options]
    .map((option) => option.value)
    .filter((year) => year >= state.comparisonStartYear && year <= state.selectedYear);
  state.selectedComparisonYears = state.selectedComparisonYears.filter((year) => validYears.includes(year));
  if (state.selectedComparisonYears.length === 0) state.selectedComparisonYears = validYears.slice(-3);
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
elements.tagSearch.addEventListener("input", () => {
  renderTagExplorer(transactionsForSelectedPeriod());
});
elements.tagMatchModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.tagMatchMode;
    if (!["any", "all"].includes(mode) || button.disabled || mode === state.tagMatchMode) return;
    state.tagMatchMode = mode;
    saveDashboardView();
    renderDashboard();
  });
});
elements.clearTagSelection.addEventListener("click", () => {
  state.selectedTags = [];
  saveDashboardView();
  renderDashboard();
});
elements.viewTagQueryTransactions.addEventListener("click", () => {
  if (state.selectedTags.length === 0) return;
  const transactions = matchingTagTransactions(
    transactionsForSelectedPeriod().filter((transaction) => !isIncome(transaction)),
  );
  const title = tagQueryLabel();
  openTransactionDialog(title, transactions, {
    type: "tag-query",
    title,
    selectedTags: [...state.selectedTags],
    tagMatchMode: state.tagMatchMode,
  });
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
elements.viewComparisonExcludedButton.addEventListener("click", openExcludedInternalTransfers);
elements.comparisonMetricButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const metric = button.dataset.comparisonMetric;
    if (!["spending", "income", "net"].includes(metric) || metric === state.comparisonMetric) return;
    state.comparisonMetric = metric;
    saveDashboardView();
    renderYearComparison();
  });
});
elements.comparisonChartModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.comparisonChartMode;
    if (!["cumulative", "monthly"].includes(mode) || mode === state.comparisonChartMode) return;
    state.comparisonChartMode = mode;
    saveDashboardView();
    renderYearComparison();
  });
});
async function closeTransactionList() {
  if (await dashboardBulk.flushFlags()) elements.dialog.close();
}
elements.closeDialog.addEventListener("click", closeTransactionList);
elements.dialog.addEventListener("cancel", event => { event.preventDefault(); closeTransactionList(); });
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
  transactionUi.setFlagFilter(elements.transactionFlaggedFilter, "");
  elements.transactionGroupFilter.value = "";
  elements.transactionCategoryFilter.value = "";
  populateTransactionSubcategoryFilter("");
  elements.transactionAccountFilter.value = "";
  elements.transactionProviderFilter.value = "";
  elements.transactionTagFilter.value = "";
  elements.transactionCategoryFilter.focus();
});
transactionUi.bindLiveTransactionFilters(elements.transactionFilterPopover, () => {
  state.transactionDialogFilters = {
    ...state.transactionDialogFilters,
    ...transactionFilterDraft(),
  };
  renderTransactionDialogTransactions();
}, elements.resetTransactionFilters);
elements.clearTransactionFilters.addEventListener("click", () => {
  state.transactionDialogFilters = {
    ...state.transactionDialogFilters,
    flagged: "",
    group: "",
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
    closeTransactionList();
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
window.addEventListener("ledger-number-abbreviation-change", renderDashboard);


restoreDashboardView();
loadTransactions();
