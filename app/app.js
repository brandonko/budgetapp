"use strict";

const DASHBOARD_VIEW_STORAGE_KEY = "ledger.dashboardView.v1";

const state = {
  transactions: [],
  revision: "",
  viewMode: "monthly",
  selectedYear: "",
  selectedMonth: "",
  annualCategoryFilter: "",
  editingTransactionId: null,
  transactionDialogContext: null,
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
        annualCategoryFilter: state.annualCategoryFilter,
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
    if (typeof saved.annualCategoryFilter === "string") {
      state.annualCategoryFilter = saved.annualCategoryFilter.slice(0, 200);
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
  categoryTemplate: document.querySelector("#category-template"),
  annualInsights: document.querySelector("#annual-insights"),
  annualCategoryLegend: document.querySelector("#annual-category-legend"),
  annualSpendingChart: document.querySelector("#annual-spending-chart"),
  spendingChartSubtitle: document.querySelector("#spending-chart-subtitle"),
  clearCategoryFilter: document.querySelector("#clear-category-filter"),
  annualNetChart: document.querySelector("#annual-net-chart"),
  viewExcludedButton: document.querySelector("#view-excluded-button"),
  excludedButtonLabel: document.querySelector("#excluded-button-label"),
  addTransactionButton: document.querySelector("#add-transaction-button"),
  viewAllButton: document.querySelector("#view-all-button"),
  dialog: document.querySelector("#transaction-dialog"),
  dialogEyebrow: document.querySelector("#dialog-eyebrow"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogSubtitle: document.querySelector("#dialog-subtitle"),
  transactionList: document.querySelector("#transaction-list"),
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
    accountName: document.querySelector("#account-name-options"),
    accountType: document.querySelector("#account-type-options"),
    provider: document.querySelector("#provider-options"),
  },
};

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

function isBillPayment(transaction) {
  return transaction._isBillPayment === true;
}

function isIncome(transaction) {
  return transaction.category.trim().toLocaleLowerCase() === "income";
}

function sum(transactions) {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}

function displayAmount(transaction) {
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
      return inPeriod && !isBillPayment(transaction);
    })
    .sort(compareLatestFirst);
}

function excludedBillPaymentsForSelectedPeriod() {
  return state.transactions
    .filter((transaction) => {
      const inPeriod =
        state.viewMode === "annual"
          ? yearKey(transaction) === state.selectedYear
          : monthKey(transaction) === selectedMonthKey();
      return inPeriod && isBillPayment(transaction);
    })
    .sort(compareLatestFirst);
}

function availableMonths() {
  return [...new Set(state.transactions.filter((transaction) => !isBillPayment(transaction)).map(monthKey))]
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
    const values = [...new Set(state.transactions.map((transaction) => transaction[field]))].sort((a, b) =>
      a.localeCompare(b),
    );
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
  const spent = sum(spendingTransactions);
  const income = Math.abs(sum(incomeTransactions));
  return { spent, income, net: income - spent };
}

function renderSummary(transactions) {
  const { spent, income, net } = calculateSummary(transactions);
  elements.totalSpent.textContent = currency.format(spent);
  elements.totalIncome.textContent = currency.format(income);
  elements.netTotal.textContent = currency.format(net);
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

function renderCategories(transactions) {
  const groups = groupByCategory(transactions);
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
      group.total < 0 || group.category.trim().toLocaleLowerCase() === "income",
    );
    card.setAttribute("aria-label", `View ${group.category} transactions`);
    card.addEventListener("click", () =>
      openTransactionDialog(group.category, group.transactions, {
        type: "category",
        title: group.category,
        category: group.category,
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

function setAnnualCategoryFilter(category) {
  state.annualCategoryFilter = state.annualCategoryFilter === category ? "" : category;
  saveDashboardView();
  renderAnnualCharts(transactionsForSelectedPeriod());
}

function renderAnnualSpendingChart(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const categories = [...new Set(spendingTransactions.map((transaction) => transaction.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (state.annualCategoryFilter && !categories.includes(state.annualCategoryFilter)) {
    state.annualCategoryFilter = "";
    saveDashboardView();
  }

  elements.annualCategoryLegend.replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-button";
    button.style.setProperty("--legend-color", colorForCategory(category, categories));
    button.setAttribute("aria-pressed", String(state.annualCategoryFilter === category));
    button.textContent = category;
    button.addEventListener("click", () => setAnnualCategoryFilter(category));
    elements.annualCategoryLegend.append(button);
  }

  elements.spendingChartSubtitle.textContent = state.annualCategoryFilter || "All spending categories";
  elements.clearCategoryFilter.hidden = !state.annualCategoryFilter;

  const byMonth = annualTransactionsByMonth(spendingTransactions);
  const monthSeries = [...byMonth.entries()].map(([month, monthTransactions]) => {
    const values = new Map();
    for (const category of categories) {
      const categoryTotal = sum(monthTransactions.filter((transaction) => transaction.category === category));
      values.set(category, Math.max(categoryTotal, 0));
    }
    const visibleCategories = state.annualCategoryFilter ? [state.annualCategoryFilter] : categories;
    return {
      month,
      values,
      total: visibleCategories.reduce((total, category) => total + (values.get(category) || 0), 0),
    };
  });
  const maximum = Math.max(...monthSeries.map((month) => month.total), 1);

  elements.annualSpendingChart.replaceChildren();
  if (categories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "No spending transactions found for this year.";
    elements.annualSpendingChart.append(empty);
    return;
  }

  const visibleCategories = state.annualCategoryFilter ? [state.annualCategoryFilter] : categories;
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
    for (const category of visibleCategories) {
      const amount = monthData.values.get(category) || 0;
      if (amount <= 0) continue;
      const segment = document.createElement("span");
      segment.className = "stacked-bar-segment";
      segment.style.height = `${(amount / maximum) * 100}%`;
      segment.style.backgroundColor = colorForCategory(category, categories);
      segment.title = `${category}: ${currency.format(amount)}`;
      track.append(segment);
    }
    const label = document.createElement("span");
    label.className = "chart-month-label";
    label.textContent = shortMonthFormatter.format(parseLocalDate(`${state.selectedYear}-${monthData.month}-01`));
    column.append(value, track, label);
    elements.annualSpendingChart.append(column);
  }
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
  renderAnnualNetChart(transactions);
}

function createTransactionRow(transaction) {
  const row = document.createElement("article");
  row.className = "transaction-row";

  const parsedDate = parseLocalDate(transaction.date);
  const dateElement = document.createElement("time");
  dateElement.className = "transaction-date";
  dateElement.dateTime = transaction.date;
  const month = document.createTextNode(shortMonthFormatter.format(parsedDate));
  const day = document.createElement("strong");
  day.textContent = parsedDate.getUTCDate();
  dateElement.append(month, day);

  const description = document.createElement("div");
  description.className = "transaction-description";
  const title = document.createElement("strong");
  title.textContent = transaction.description;
  title.title = transaction.description;
  const metadata = document.createElement("span");
  metadata.textContent = `${transaction.category} · ${transaction.accountName} · ${transaction.provider}`;
  description.append(title, metadata);
  if (transaction.notes) {
    const notes = document.createElement("span");
    notes.className = "transaction-note";
    notes.textContent = transaction.notes;
    description.append(notes);
  }

  const actions = document.createElement("div");
  actions.className = "transaction-actions";
  const amount = document.createElement("span");
  amount.className = "transaction-amount";
  amount.classList.toggle("is-credit", transaction.amount < 0 || isIncome(transaction));
  amount.textContent = currency.format(displayAmount(transaction));
  const editButton = document.createElement("button");
  editButton.className = "edit-button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.setAttribute("aria-label", `Edit ${transaction.description}`);
  editButton.addEventListener("click", () => openTransactionForm(transaction));
  actions.append(amount, editButton);

  row.append(dateElement, description, actions);
  return row;
}

function openTransactionDialog(title, transactions, context) {
  state.transactionDialogContext = context;
  const sortedTransactions = [...transactions].sort(compareLatestFirst);
  const total = displaySum(sortedTransactions);
  elements.dialogEyebrow.textContent = selectedPeriodLabel();
  elements.dialogTitle.textContent = title;
  elements.dialogSubtitle.textContent = `${sortedTransactions.length} ${
    sortedTransactions.length === 1 ? "transaction" : "transactions"
  } · ${currency.format(total)}`;
  elements.transactionList.replaceChildren(...sortedTransactions.map(createTransactionRow));
  elements.dialog.showModal();
}

function reopenTransactionDialog(context) {
  if (!context) return;
  let transactions;
  if (context.type === "category") {
    transactions = transactionsForSelectedPeriod().filter(
      (transaction) => transaction.category === context.category,
    );
  } else if (context.type === "excluded") {
    transactions = excludedBillPaymentsForSelectedPeriod();
  } else {
    transactions = transactionsForSelectedPeriod();
  }
  openTransactionDialog(context.title, transactions, context);
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
  elements.form.querySelectorAll("button, input, textarea").forEach((control) => {
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
  elements.form.reset();
  state.editingTransactionId = transaction?._id ?? null;
  const editing = transaction !== null;
  elements.formEyebrow.textContent = editing ? "Edit transaction" : "New transaction";
  elements.formTitle.textContent = editing ? "Update transaction" : "Add transaction";
  elements.deleteTransactionButton.hidden = !editing;

  formField("date").value = transaction?.date ?? defaultNewTransactionDate();
  formField("description").value = transaction?.description ?? "";
  formField("amount").value = transaction?.amount ?? "";
  formField("category").value = transaction?.category ?? "";
  formField("accountName").value = transaction?.accountName ?? "";
  formField("accountType").value = transaction?.accountType ?? "";
  formField("provider").value = transaction?.provider ?? "";
  formField("notes").value = transaction?.notes ?? "";
  elements.formDialog.showModal();
  formField(editing ? "description" : "date").focus();
}

function transactionFromForm() {
  const formData = new FormData(elements.form);
  return {
    date: formData.get("date"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    accountName: formData.get("accountName"),
    accountType: formData.get("accountType"),
    provider: formData.get("provider"),
    notes: formData.get("notes"),
  };
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
  const excludedBillPayments = excludedBillPaymentsForSelectedPeriod();
  const annual = state.viewMode === "annual";
  elements.monthControl.hidden = annual;
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
  elements.viewExcludedButton.hidden = excludedBillPayments.length === 0;
  elements.excludedButtonLabel.textContent = `View ${excludedBillPayments.length} excluded bill-payment ${
    excludedBillPayments.length === 1 ? "transaction" : "transactions"
  }`;
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
  state.annualCategoryFilter = "";
  saveDashboardView();
  renderDashboard();
});
elements.yearSelect.addEventListener("change", (event) => {
  state.selectedYear = event.target.value;
  state.annualCategoryFilter = "";
  saveDashboardView();
  renderDashboard();
});
elements.monthSelect.addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  saveDashboardView();
  renderDashboard();
});
elements.clearCategoryFilter.addEventListener("click", () => {
  state.annualCategoryFilter = "";
  saveDashboardView();
  renderAnnualCharts(transactionsForSelectedPeriod());
});
elements.addTransactionButton.addEventListener("click", () => openTransactionForm());
elements.viewAllButton.addEventListener("click", () => {
  openTransactionDialog("All transactions", transactionsForSelectedPeriod(), {
    type: "all",
    title: "All transactions",
  });
});
elements.viewExcludedButton.addEventListener("click", () => {
  openTransactionDialog("Excluded bill payments", excludedBillPaymentsForSelectedPeriod(), {
    type: "excluded",
    title: "Excluded bill payments",
  });
});
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
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
