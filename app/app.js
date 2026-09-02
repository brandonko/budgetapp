"use strict";

const state = {
  transactions: [],
  selectedMonth: "",
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
  netTotalNote: document.querySelector("#net-total-note"),
  categoryGrid: document.querySelector("#category-grid"),
  categoryTemplate: document.querySelector("#category-template"),
  viewAllButton: document.querySelector("#view-all-button"),
  dialog: document.querySelector("#transaction-dialog"),
  dialogEyebrow: document.querySelector("#dialog-eyebrow"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogSubtitle: document.querySelector("#dialog-subtitle"),
  transactionList: document.querySelector("#transaction-list"),
  closeDialog: document.querySelector("#close-dialog"),
  errorState: document.querySelector("#error-state"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
  dashboardSections: document.querySelectorAll(".hero, .summary-grid, .categories-section"),
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

function isTransfer(transaction) {
  return transaction.category.trim().toLocaleLowerCase() === "transfer";
}

function isIncome(transaction) {
  return transaction.category.trim().toLocaleLowerCase() === "income";
}

function sum(transactions) {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}

function compareLatestFirst(left, right) {
  return right.date.localeCompare(left.date);
}

function transactionsForSelectedMonth() {
  return state.transactions
    .filter((transaction) => monthKey(transaction) === state.selectedMonth && !isTransfer(transaction))
    .sort(compareLatestFirst);
}

function populateMonthSelect() {
  // A month containing only transfers has no reportable activity, so omit it
  // instead of making the default dashboard appear empty.
  const months = [
    ...new Set(state.transactions.filter((transaction) => !isTransfer(transaction)).map(monthKey)),
  ]
    .sort()
    .reverse();
  elements.monthSelect.replaceChildren();
  for (const month of months) {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = monthLabel(month);
    elements.monthSelect.append(option);
  }
  state.selectedMonth = months[0] ?? "";
  elements.monthSelect.value = state.selectedMonth;
  elements.monthSelect.disabled = months.length === 0;
}

function calculateSummary(transactions) {
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const incomeTransactions = transactions.filter(isIncome);
  const spent = sum(spendingTransactions);
  const income = Math.abs(sum(incomeTransactions));
  return { spent, income, net: spent - income };
}

function renderSummary(transactions) {
  const { spent, income, net } = calculateSummary(transactions);
  elements.totalSpent.textContent = currency.format(spent);
  elements.totalIncome.textContent = currency.format(income);
  elements.netTotal.textContent = currency.format(Math.abs(net));
  elements.netTotal.classList.toggle("is-credit", net < 0);
  elements.netTotalNote.textContent = net < 0 ? "Income exceeded spending" : "Spending minus income";
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
      total: sum(categoryTransactions),
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
    totalElement.classList.toggle("is-credit", group.total < 0);
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
  dateElement.innerHTML = `${shortMonthFormatter.format(parsedDate)}<strong>${parsedDate.getUTCDate()}</strong>`;

  const description = document.createElement("div");
  description.className = "transaction-description";
  const title = document.createElement("strong");
  title.textContent = transaction.description;
  title.title = transaction.description;
  const metadata = document.createElement("span");
  metadata.textContent = `${transaction.category} · ${transaction.accountName} · ${transaction.provider}`;
  description.append(title, metadata);

  const amount = document.createElement("span");
  amount.className = "transaction-amount";
  amount.classList.toggle("is-credit", transaction.amount < 0);
  amount.textContent = currency.format(transaction.amount);

  row.append(dateElement, description, amount);
  return row;
}

function openTransactionDialog(title, transactions) {
  const sortedTransactions = [...transactions].sort(compareLatestFirst);
  const total = sum(sortedTransactions);
  elements.dialogEyebrow.textContent = monthLabel(state.selectedMonth);
  elements.dialogTitle.textContent = title;
  elements.dialogSubtitle.textContent = `${sortedTransactions.length} ${
    sortedTransactions.length === 1 ? "transaction" : "transactions"
  } · ${currency.format(total)}`;
  elements.transactionList.replaceChildren(...sortedTransactions.map(createTransactionRow));
  elements.dialog.showModal();
}

function renderDashboard() {
  const transactions = transactionsForSelectedMonth();
  elements.periodDescription.textContent = state.selectedMonth
    ? `A clear view of where your money went in ${monthLabel(state.selectedMonth)}.`
    : "No transaction data is available yet.";
  renderSummary(transactions);
  renderCategories(transactions);
  elements.viewAllButton.disabled = transactions.length === 0;
}

function setError(message) {
  elements.errorMessage.textContent = message;
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
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    state.transactions = payload.transactions;
    populateMonthSelect();
    renderDashboard();
  } catch (error) {
    setError(error instanceof Error ? error.message : "The transaction data could not be loaded.");
  }
}

elements.monthSelect.addEventListener("change", (event) => {
  state.selectedMonth = event.target.value;
  renderDashboard();
});

elements.viewAllButton.addEventListener("click", () => {
  openTransactionDialog("All transactions", transactionsForSelectedMonth());
});

elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    elements.dialog.close();
  }
});
elements.retryButton.addEventListener("click", loadTransactions);

loadTransactions();
