"use strict";

const state = {
  transactions: [],
  revision: "",
  selectedMonth: "",
  editingTransactionId: null,
  formBusy: false,
};

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
  monthSelect: document.querySelector("#month-select"),
  periodDescription: document.querySelector("#period-description"),
  totalSpent: document.querySelector("#total-spent"),
  totalIncome: document.querySelector("#total-income"),
  netTotal: document.querySelector("#net-total"),
  netTotalCard: document.querySelector("#net-total-card"),
  netTotalNote: document.querySelector("#net-total-note"),
  categoryGrid: document.querySelector("#category-grid"),
  categoryTemplate: document.querySelector("#category-template"),
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
  createFileButton: document.querySelector("#create-file-button"),
  retryButton: document.querySelector("#retry-button"),
  dashboardSections: document.querySelectorAll(".hero, .summary-grid, .categories-section"),
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

function transactionsForSelectedMonth() {
  return state.transactions
    .filter((transaction) => monthKey(transaction) === state.selectedMonth && !isBillPayment(transaction))
    .sort(compareLatestFirst);
}

function excludedBillPaymentsForSelectedMonth() {
  return state.transactions
    .filter((transaction) => monthKey(transaction) === state.selectedMonth && isBillPayment(transaction))
    .sort(compareLatestFirst);
}

function availableMonths() {
  return [...new Set(state.transactions.filter((transaction) => !isBillPayment(transaction)).map(monthKey))]
    .sort()
    .reverse();
}

function populateMonthSelect(preferredMonth = state.selectedMonth) {
  const months = availableMonths();
  elements.monthSelect.replaceChildren();
  for (const month of months) {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = monthLabel(month);
    elements.monthSelect.append(option);
  }
  state.selectedMonth = months.includes(preferredMonth) ? preferredMonth : (months[0] ?? "");
  elements.monthSelect.value = state.selectedMonth;
  elements.monthSelect.disabled = months.length === 0;
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
    empty.textContent = "No transactions found for this month.";
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
    card.addEventListener("click", () => openTransactionDialog(group.category, group.transactions));
    elements.categoryGrid.append(card);
  });
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

function openTransactionDialog(title, transactions) {
  const sortedTransactions = [...transactions].sort(compareLatestFirst);
  const total = displaySum(sortedTransactions);
  elements.dialogEyebrow.textContent = monthLabel(state.selectedMonth);
  elements.dialogTitle.textContent = title;
  elements.dialogSubtitle.textContent = `${sortedTransactions.length} ${
    sortedTransactions.length === 1 ? "transaction" : "transactions"
  } · ${currency.format(total)}`;
  elements.transactionList.replaceChildren(...sortedTransactions.map(createTransactionRow));
  elements.dialog.showModal();
}

function formField(name) {
  return elements.form.elements.namedItem(name);
}

function defaultNewTransactionDate() {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  if (!state.selectedMonth || todayIso.startsWith(state.selectedMonth)) {
    return todayIso;
  }
  return `${state.selectedMonth}-01`;
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
  elements.form.querySelectorAll("button, input").forEach((control) => {
    control.disabled = isBusy;
  });
  elements.saveTransactionButton.textContent = isBusy ? "Saving…" : "Save transaction";
}

function openTransactionForm(transaction = null) {
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
  };
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

function applyPayload(payload, preferredMonth = state.selectedMonth) {
  state.transactions = payload.transactions;
  state.revision = payload.revision;
  populateMonthSelect(preferredMonth);
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
    elements.formDialog.close();
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
    elements.formDialog.close();
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "The transaction could not be deleted.");
  } finally {
    setFormBusy(false);
  }
}

function renderDashboard() {
  const transactions = transactionsForSelectedMonth();
  const excludedBillPayments = excludedBillPaymentsForSelectedMonth();
  elements.periodDescription.textContent = state.selectedMonth
    ? `A clear view of where your money went in ${monthLabel(state.selectedMonth)}.`
    : "No transaction data is available yet.";
  renderSummary(transactions);
  renderCategories(transactions);
  elements.viewAllButton.disabled = transactions.length === 0;
  elements.viewExcludedButton.hidden = excludedBillPayments.length === 0;
  elements.excludedButtonLabel.textContent = `View ${excludedBillPayments.length} excluded bill-payment ${
    excludedBillPayments.length === 1 ? "transaction" : "transactions"
  }`;
}

function setError(message, code = "") {
  const fileMissing = code === "transaction_file_missing";
  elements.errorEyebrow.textContent = fileMissing ? "Set up Ledger" : "Unable to load data";
  elements.errorTitle.textContent = fileMissing ? "Create your transaction file." : "Something went wrong.";
  elements.errorMessage.textContent = message;
  elements.createFileButton.hidden = !fileMissing;
  elements.retryButton.hidden = fileMissing;
  elements.errorState.hidden = false;
  elements.dashboardSections.forEach((section) => {
    section.hidden = true;
  });
}

function clearError() {
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

async function createTransactionFile() {
  elements.createFileButton.disabled = true;
  elements.createFileButton.textContent = "Creating…";
  try {
    const response = await fetch("/api/transactions/initialize", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    clearError();
    applyPayload(payload);
  } catch (error) {
    setError(error instanceof Error ? error.message : "The transaction file could not be created.");
  } finally {
    elements.createFileButton.disabled = false;
    elements.createFileButton.textContent = "Create transaction file";
  }
}

elements.monthSelect.addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  renderDashboard();
});
elements.addTransactionButton.addEventListener("click", () => openTransactionForm());
elements.viewAllButton.addEventListener("click", () => {
  openTransactionDialog("All transactions", transactionsForSelectedMonth());
});
elements.viewExcludedButton.addEventListener("click", () => {
  openTransactionDialog("Excluded bill payments", excludedBillPaymentsForSelectedMonth());
});
elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    elements.dialog.close();
  }
});
elements.form.addEventListener("submit", saveTransaction);
elements.deleteTransactionButton.addEventListener("click", deleteTransaction);
elements.closeFormDialog.addEventListener("click", () => elements.formDialog.close());
elements.cancelFormButton.addEventListener("click", () => elements.formDialog.close());
elements.formDialog.addEventListener("click", (event) => {
  if (event.target === elements.formDialog && !state.formBusy) {
    elements.formDialog.close();
  }
});
elements.retryButton.addEventListener("click", loadTransactions);
elements.createFileButton.addEventListener("click", createTransactionFile);

loadTransactions();
