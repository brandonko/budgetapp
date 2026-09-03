"use strict";
const transactionUi = window.LedgerTransactionUI;

const state = {
  importHistoryRevision: "",
  importHistoryBatch: null,
  importHistoryTransactions: [],
  editingImportTransactionId: null,
  importHistoryEditBusy: false,
};

const elements = {
  tabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
  createBackup: document.querySelector("#create-backup-button"),
  refreshBackups: document.querySelector("#refresh-backups-button"),
  backupStatus: document.querySelector("#backup-status"),
  backupList: document.querySelector("#backup-list"),
  refreshImportHistory: document.querySelector("#refresh-import-history-button"),
  importHistoryStatus: document.querySelector("#import-history-status"),
  importHistoryList: document.querySelector("#import-history-list"),
  importHistoryDialog: document.querySelector("#import-history-dialog"),
  importHistoryDialogSubtitle: document.querySelector("#import-history-dialog-subtitle"),
  importHistoryDialogError: document.querySelector("#import-history-dialog-error"),
  importHistoryTransactions: document.querySelector("#import-history-transactions"),
  closeImportHistoryDialog: document.querySelector("#close-import-history-dialog"),
  importHistoryEditDialog: document.querySelector("#import-history-edit-dialog"),
  importHistoryEditForm: document.querySelector("#import-history-edit-form"),
  importHistoryEditError: document.querySelector("#import-history-edit-error"),
  closeImportHistoryEdit: document.querySelector("#close-import-history-edit"),
  cancelImportHistoryEdit: document.querySelector("#cancel-import-history-edit"),
  saveImportHistoryEdit: document.querySelector("#save-import-history-edit"),
  importClassifications: document.querySelector("#import-classifications-button"),
  importClassificationsInput: document.querySelector("#import-classifications-input"),
  exportClassifications: document.querySelector("#export-classifications-button"),
  addClassification: document.querySelector("#add-classification-button"),
  applyClassifications: document.querySelector("#apply-classifications-button"),
  classificationStatus: document.querySelector("#classification-status"),
  classificationPagination: document.querySelector("#classification-pagination"),
  previousClassification: document.querySelector("#previous-classification-button"),
  nextClassification: document.querySelector("#next-classification-button"),
  classificationPageIndicator: document.querySelector("#classification-page-indicator"),
  classificationList: document.querySelector("#classification-list"),
  reviewUnclassified: document.querySelector("#review-unclassified-button"),
  unclassifiedDialog: document.querySelector("#unclassified-dialog"),
  unclassifiedSummary: document.querySelector("#unclassified-summary"),
  unclassifiedSearch: document.querySelector("#unclassified-search"),
  unclassifiedCategory: document.querySelector("#unclassified-category-filter"),
  unclassifiedAccount: document.querySelector("#unclassified-account-filter"),
  unclassifiedProvider: document.querySelector("#unclassified-provider-filter"),
  clearUnclassifiedFilters: document.querySelector("#clear-unclassified-filters"),
  unclassifiedError: document.querySelector("#unclassified-error"),
  unclassifiedList: document.querySelector("#unclassified-list"),
  closeUnclassified: document.querySelector("#close-unclassified-dialog"),
  previewDialog: document.querySelector("#classification-preview-dialog"),
  previewSummary: document.querySelector("#classification-preview-summary"),
  previewError: document.querySelector("#classification-preview-error"),
  previewList: document.querySelector("#classification-preview-list"),
  closePreview: document.querySelector("#close-classification-preview"),
  cancelPreview: document.querySelector("#cancel-classification-preview"),
  confirmPreview: document.querySelector("#confirm-classification-preview"),
};

let classifications = [];
let classificationsBusy = false;
let selectedClassificationIndex = 0;
let classificationEdit = null;
let ruleEdits = new Map();
let pendingNewClassificationIndex = null;
let pendingClassificationPreview = null;
let unclassifiedTransactions = [];

const backupDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const transactionDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const unclassifiedMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

function selectSettingsTab(selectedTab, { focus = false, updateHash = true } = {}) {
  for (const tab of elements.tabs) {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) panel.hidden = !selected;
  }
  if (updateHash) {
    const section = selectedTab.id.replace("-settings-tab", "");
    window.history.replaceState(null, "", `#${section}`);
  }
  if (focus) selectedTab.focus();
  if (selectedTab === document.querySelector("#import-history-settings-tab")) {
    loadImportHistory();
  }
}

function initializeSettingsTabs() {
  const requestedSection = window.location.hash.slice(1);
  const requestedTab = elements.tabs.find(
    (tab) => tab.id === `${requestedSection}-settings-tab`,
  );
  if (requestedTab) selectSettingsTab(requestedTab, { updateHash: false });
  elements.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectSettingsTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % elements.tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + elements.tabs.length) % elements.tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = elements.tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      selectSettingsTab(elements.tabs[nextIndex], { focus: true });
    });
  });
}

function setStatus(message, kind = "success") {
  elements.backupStatus.textContent = message;
  elements.backupStatus.className = `settings-status settings-status--${kind}`;
  elements.backupStatus.hidden = false;
}

function setImportHistoryStatus(message, kind = "success") {
  elements.importHistoryStatus.textContent = message;
  elements.importHistoryStatus.className = `settings-status settings-status--${kind}`;
  elements.importHistoryStatus.hidden = false;
}

function setBusy(busy) {
  elements.createBackup.disabled = busy;
  elements.refreshBackups.disabled = busy;
  elements.backupList.querySelectorAll("button").forEach((button) => {
    button.disabled = busy || button.dataset.valid === "false";
  });
}

function setImportHistoryBusy(busy) {
  elements.refreshImportHistory.disabled = busy;
  elements.importHistoryList.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });
}

function importHistoryRow(importBatch) {
  const row = document.createElement("article");
  row.className = "backup-row";

  const details = document.createElement("div");
  const date = document.createElement("strong");
  const parsedDate = new Date(importBatch.createdAt);
  date.textContent = Number.isNaN(parsedDate.getTime())
    ? importBatch.createdAt
    : backupDateFormatter.format(parsedDate);
  const metadata = document.createElement("span");
  metadata.textContent = `${importBatch.transactionCount} ${
    importBatch.transactionCount === 1 ? "transaction" : "transactions"
  } imported`;
  details.append(date, metadata);

  const view = document.createElement("button");
  view.className = "secondary-button";
  view.type = "button";
  view.textContent = "View transactions";
  view.addEventListener("click", () => openImportHistoryBatch(importBatch));

  const remove = document.createElement("button");
  remove.className = "danger-button backup-delete-button";
  remove.type = "button";
  remove.textContent = "Remove transactions";
  remove.addEventListener("click", () => removeImportBatch(importBatch));

  const actions = document.createElement("div");
  actions.className = "backup-actions";
  actions.append(view, remove);
  row.append(details, actions);
  return row;
}

function renderImportHistory(imports) {
  if (imports.length === 0) {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "No tracked imports yet. New imports will appear here after they are committed.";
    elements.importHistoryList.replaceChildren(empty);
    return;
  }
  elements.importHistoryList.replaceChildren(...imports.map(importHistoryRow));
}

async function loadImportHistory() {
  setImportHistoryBusy(true);
  try {
    const response = await fetch("/api/import-history", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not load import history (${response.status}).`);
    }
    state.importHistoryRevision = payload.revision;
    renderImportHistory(Array.isArray(payload.imports) ? payload.imports : []);
  } catch (error) {
    setImportHistoryStatus(
      error instanceof Error ? error.message : "Could not load import history.",
      "error",
    );
  } finally {
    setImportHistoryBusy(false);
  }
}

function importHistoryTransactionOptions(transaction) {
  return {
    currency: currencyFormatter,
    shortMonthFormatter: unclassifiedMonthFormatter,
    onEdit: () => openImportHistoryTransactionEditor(transaction),
  };
}

function renderImportHistoryTransactions() {
  const transactions = state.importHistoryTransactions;
  elements.importHistoryDialogSubtitle.textContent = `${transactions.length} ${
    transactions.length === 1 ? "transaction" : "transactions"
  } imported ${backupDateFormatter.format(new Date(state.importHistoryBatch.createdAt))}`;
  if (transactions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = "This import no longer contains any transactions.";
    elements.importHistoryTransactions.replaceChildren(empty);
    return;
  }
  transactionUi.renderTransactionList(
    elements.importHistoryTransactions,
    transactions,
    importHistoryTransactionOptions,
  );
}

async function openImportHistoryBatch(importBatch) {
  state.importHistoryBatch = importBatch;
  state.importHistoryTransactions = [];
  elements.importHistoryDialogError.hidden = true;
  elements.importHistoryDialogError.textContent = "";
  elements.importHistoryDialogSubtitle.textContent = "Loading transactions…";
  elements.importHistoryTransactions.replaceChildren();
  if (!elements.importHistoryDialog.open) elements.importHistoryDialog.showModal();
  try {
    const response = await fetch(
      `/api/import-history/${encodeURIComponent(importBatch.createdAt)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not load imported transactions (${response.status}).`);
    }
    state.importHistoryRevision = payload.revision;
    state.importHistoryTransactions = payload.transactions.sort(
      (left, right) => right.date.localeCompare(left.date) || right._id - left._id,
    );
    renderImportHistoryTransactions();
  } catch (error) {
    elements.importHistoryDialogSubtitle.textContent = "";
    elements.importHistoryDialogError.textContent =
      error instanceof Error ? error.message : "Could not load imported transactions.";
    elements.importHistoryDialogError.hidden = false;
  }
}

function closeImportHistoryDialog() {
  if (elements.importHistoryDialog.open) elements.importHistoryDialog.close();
  state.importHistoryBatch = null;
  state.importHistoryTransactions = [];
}

function openImportHistoryTransactionEditor(transaction) {
  state.editingImportTransactionId = transaction._id;
  elements.importHistoryEditError.hidden = true;
  elements.importHistoryEditError.textContent = "";
  transactionUi.populateTransactionEditor(elements.importHistoryEditForm, transaction);
  if (elements.importHistoryDialog.open) elements.importHistoryDialog.close();
  elements.importHistoryEditDialog.showModal();
  elements.importHistoryEditForm.elements.namedItem("description").focus();
}

function closeImportHistoryTransactionEditor() {
  if (state.importHistoryEditBusy) return;
  if (elements.importHistoryEditDialog.open) elements.importHistoryEditDialog.close();
  state.editingImportTransactionId = null;
  if (state.importHistoryBatch && !elements.importHistoryDialog.open) {
    elements.importHistoryDialog.showModal();
  }
}

function setImportHistoryEditBusy(busy) {
  state.importHistoryEditBusy = busy;
  elements.importHistoryEditForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = busy;
  });
  elements.saveImportHistoryEdit.textContent = busy ? "Saving…" : "Save transaction";
}

async function saveImportHistoryTransaction(event) {
  event.preventDefault();
  const transaction = state.importHistoryTransactions.find(
    (candidate) => candidate._id === state.editingImportTransactionId,
  );
  if (!transaction) return;
  elements.importHistoryEditError.hidden = true;
  setImportHistoryEditBusy(true);
  try {
    const response = await fetch(`/api/transactions/${transaction._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: state.importHistoryRevision,
        transaction: transactionUi.transactionFromEditor(elements.importHistoryEditForm, transaction),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not save transaction (${response.status}).`);
    state.importHistoryRevision = payload.revision;
    state.importHistoryTransactions = payload.transactions
      .filter((candidate) => candidate.createdAt === state.importHistoryBatch.createdAt)
      .sort((left, right) => right.date.localeCompare(left.date) || right._id - left._id);
    renderImportHistoryTransactions();
    elements.importHistoryEditDialog.close();
    state.editingImportTransactionId = null;
    elements.importHistoryDialog.showModal();
  } catch (error) {
    elements.importHistoryEditError.textContent =
      error instanceof Error ? error.message : "Could not save transaction.";
    elements.importHistoryEditError.hidden = false;
  } finally {
    setImportHistoryEditBusy(false);
  }
}

async function removeImportBatch(importBatch) {
  const count = importBatch.transactionCount;
  const importedAt = backupDateFormatter.format(new Date(importBatch.createdAt));
  const confirmed = window.confirm(
    `Remove all ${count} ${count === 1 ? "transaction" : "transactions"} imported ${importedAt}?\n\n` +
      "Ledger will create a safety backup first. This action removes the entire import batch.",
  );
  if (!confirmed) return;

  setImportHistoryBusy(true);
  try {
    const response = await fetch(`/api/import-history/${encodeURIComponent(importBatch.createdAt)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, revision: state.importHistoryRevision }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not remove imported transactions (${response.status}).`);
    }
    state.importHistoryRevision = payload.revision;
    renderImportHistory(Array.isArray(payload.imports) ? payload.imports : []);
    setImportHistoryStatus(
      `Removed ${payload.removedCount} imported ${
        payload.removedCount === 1 ? "transaction" : "transactions"
      }. A safety backup was created.`,
    );
  } catch (error) {
    setImportHistoryStatus(
      error instanceof Error ? error.message : "Could not remove imported transactions.",
      "error",
    );
  } finally {
    setImportHistoryBusy(false);
  }
}

function backupRow(backup) {
  const row = document.createElement("article");
  row.className = "backup-row";
  if (!backup.valid) row.classList.add("backup-row--invalid");

  const details = document.createElement("div");
  const date = document.createElement("strong");
  const parsedDate = new Date(backup.modifiedAt);
  date.textContent = Number.isNaN(parsedDate.getTime())
    ? backup.name
    : backupDateFormatter.format(parsedDate);
  const metadata = document.createElement("span");
  metadata.textContent = backup.valid
    ? `${backup.transactionCount} ${backup.transactionCount === 1 ? "transaction" : "transactions"} · ${backup.name}`
    : `Unavailable · ${backup.name}`;
  details.append(date, metadata);

  const restore = document.createElement("button");
  restore.className = "secondary-button";
  restore.type = "button";
  restore.textContent = "Restore";
  restore.dataset.valid = String(Boolean(backup.valid));
  restore.disabled = !backup.valid;
  if (!backup.valid) restore.title = backup.error || "This backup is not valid.";
  restore.addEventListener("click", () => restoreBackup(backup));

  const actions = document.createElement("div");
  actions.className = "backup-actions";
  const rename = document.createElement("button");
  rename.className = "secondary-button";
  rename.type = "button";
  rename.textContent = "Rename";
  rename.setAttribute("aria-label", `Rename ${backup.name}`);
  rename.addEventListener("click", () => renameBackup(backup));
  const remove = document.createElement("button");
  remove.className = "danger-button backup-delete-button";
  remove.type = "button";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => deleteBackup(backup));
  actions.append(restore, rename, remove);

  row.append(details, actions);
  return row;
}

function renderBackups(backups) {
  if (backups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "No backups yet. Create one to protect your current transaction data.";
    elements.backupList.replaceChildren(empty);
    return;
  }
  elements.backupList.replaceChildren(...backups.map(backupRow));
}

async function loadBackups() {
  setBusy(true);
  try {
    const response = await fetch("/api/backups", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load backups (${response.status}).`);
    renderBackups(Array.isArray(payload.backups) ? payload.backups : []);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not load backups.", "error");
  } finally {
    setBusy(false);
  }
}

async function createBackup() {
  setBusy(true);
  elements.createBackup.textContent = "Creating…";
  try {
    const response = await fetch("/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not create backup (${response.status}).`);
    setStatus(`Backup created with ${payload.backup.transactionCount} transactions.`);
    if (elements.backupList) await loadBackups();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not create backup.", "error");
  } finally {
    elements.createBackup.textContent = "Create backup";
    setBusy(false);
  }
}

async function restoreBackup(backup) {
  const confirmed = window.confirm(
    `Restore the backup last modified ${backupDateFormatter.format(new Date(backup.modifiedAt))}?\n\n` +
      `This will completely replace transactions.csv with its ${backup.transactionCount} transactions. ` +
      "Ledger will create a safety backup of the current file first.",
  );
  if (!confirmed) return;

  setBusy(true);
  try {
    const response = await fetch(`/api/backups/${encodeURIComponent(backup.name)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not restore backup (${response.status}).`);
    setStatus(`Backup restored. transactions.csv now contains ${payload.transactionCount} transactions.`);
    await loadBackups();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not restore backup.", "error");
  } finally {
    setBusy(false);
  }
}

async function renameBackup(backup) {
  const requestedName = window.prompt("Rename this backup:", backup.name);
  if (requestedName === null) return;
  const newName = requestedName.trim();
  if (!newName || newName === backup.name) return;

  setBusy(true);
  try {
    const response = await fetch(`/api/backups/${encodeURIComponent(backup.name)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not rename backup (${response.status}).`);
    setStatus(`Backup renamed to ${payload.backup.name}.`);
    await loadBackups();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not rename backup.", "error");
  } finally {
    setBusy(false);
  }
}

async function deleteBackup(backup) {
  const confirmed = window.confirm(
    `Permanently delete ${backup.name}?\n\nThis backup cannot be recovered after deletion.`,
  );
  if (!confirmed) return;

  setBusy(true);
  try {
    const response = await fetch(`/api/backups/${encodeURIComponent(backup.name)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not delete backup (${response.status}).`);
    setStatus(`Backup deleted: ${backup.name}.`);
    await loadBackups();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not delete backup.", "error");
  } finally {
    setBusy(false);
  }
}

function setClassificationStatus(message, kind = "success") {
  elements.classificationStatus.textContent = message;
  elements.classificationStatus.className = `settings-status settings-status--${kind}`;
  elements.classificationStatus.hidden = false;
}

function populateUnclassifiedFilter(select, values, allLabel) {
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  const options = values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  });
  select.replaceChildren(all, ...options);
}

function unclassifiedTransactionRow(transaction) {
  const row = document.createElement("article");
  row.className = "transaction-row";
  const parsedDate = new Date(`${transaction.date}T12:00:00Z`);
  const date = document.createElement("time");
  date.className = "transaction-date";
  date.dateTime = transaction.date;
  const month = document.createTextNode(unclassifiedMonthFormatter.format(parsedDate));
  const day = document.createElement("strong");
  day.textContent = parsedDate.getUTCDate();
  date.append(month, day);

  const details = document.createElement("div");
  details.className = "transaction-description";
  const description = document.createElement("strong");
  description.textContent = transaction.description;
  description.title = transaction.description;
  const metadata = document.createElement("span");
  metadata.textContent = `${transaction.category} · ${transaction.accountName} · ${transaction.provider}`;
  details.append(description, metadata);

  const amount = document.createElement("span");
  amount.className = "transaction-amount";
  amount.classList.toggle("is-credit", transaction.amount < 0);
  amount.textContent = currencyFormatter.format(Math.abs(transaction.amount));
  row.append(date, details, amount);
  return row;
}

function renderUnclassifiedTransactions() {
  const description = elements.unclassifiedSearch.value.trim().toLocaleLowerCase();
  const category = elements.unclassifiedCategory.value;
  const account = elements.unclassifiedAccount.value;
  const provider = elements.unclassifiedProvider.value;
  const visible = unclassifiedTransactions.filter((transaction) =>
    (!description || transaction.description.toLocaleLowerCase().includes(description))
    && (!category || transaction.category === category)
    && (!account || transaction.accountName === account)
    && (!provider || transaction.provider === provider),
  );
  const filtered = Boolean(description || category || account || provider);
  elements.unclassifiedSummary.textContent = filtered
    ? `${visible.length} of ${unclassifiedTransactions.length} transactions`
    : `${unclassifiedTransactions.length} ${unclassifiedTransactions.length === 1 ? "transaction" : "transactions"}`;
  elements.clearUnclassifiedFilters.disabled = !filtered;
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = unclassifiedTransactions.length
      ? "No transactions match these filters."
      : "Every transaction has a subcategory.";
    elements.unclassifiedList.replaceChildren(empty);
    return;
  }
  elements.unclassifiedList.replaceChildren(...visible.map(unclassifiedTransactionRow));
}

async function openUnclassifiedDialog() {
  elements.unclassifiedError.hidden = true;
  elements.unclassifiedError.textContent = "";
  elements.unclassifiedSummary.textContent = "Loading transactions…";
  elements.unclassifiedList.replaceChildren();
  elements.unclassifiedSearch.value = "";
  if (!elements.unclassifiedDialog.open) elements.unclassifiedDialog.showModal();
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load transactions (${response.status}).`);
    unclassifiedTransactions = payload.transactions
      .filter((transaction) => !transaction.subcategory)
      .sort((left, right) => right.date.localeCompare(left.date)
        || right.description.localeCompare(left.description));
    populateUnclassifiedFilter(
      elements.unclassifiedCategory,
      [...new Set(unclassifiedTransactions.map((transaction) => transaction.category))]
        .sort((left, right) => left.localeCompare(right)),
      "All categories",
    );
    populateUnclassifiedFilter(
      elements.unclassifiedAccount,
      [...new Set(unclassifiedTransactions.map((transaction) => transaction.accountName))]
        .sort((left, right) => left.localeCompare(right)),
      "All accounts",
    );
    populateUnclassifiedFilter(
      elements.unclassifiedProvider,
      [...new Set(unclassifiedTransactions.map((transaction) => transaction.provider))]
        .sort((left, right) => left.localeCompare(right)),
      "All providers",
    );
    renderUnclassifiedTransactions();
  } catch (error) {
    elements.unclassifiedError.textContent =
      error instanceof Error ? error.message : "Could not load unclassified transactions.";
    elements.unclassifiedError.hidden = false;
    elements.unclassifiedSummary.textContent = "";
  }
}

function closeUnclassifiedDialog() {
  elements.unclassifiedDialog.close();
}

function blankRule() {
  return { category: "", subcategory: "", description: "", accountName: "", provider: "", notes: "" };
}

const CLASSIFICATION_ACTIONS = [
  { field: "description", label: "Description", type: "text", required: true },
  { field: "category", label: "Category", type: "text", required: true },
  { field: "subcategory", label: "Subcategory", type: "text" },
  { field: "accountName", label: "Account name", type: "text", required: true },
  { field: "accountType", label: "Account type", type: "text", required: true },
  { field: "provider", label: "Provider", type: "text", required: true },
  { field: "notes", label: "Notes", type: "textarea" },
  { field: "refunded", label: "Refund status", type: "refund" },
  {
    field: "internalTransfer",
    label: "Internal transfer treatment",
    type: "internal-transfer",
  },
];

function blankClassificationUpdates() {
  return Object.fromEntries(CLASSIFICATION_ACTIONS.map(({ field }) => [field, null]));
}

function blankClassification() {
  const updates = blankClassificationUpdates();
  updates.category = "";
  updates.subcategory = "";
  return { updates, rules: [blankRule()] };
}

function classificationHasActions(classification) {
  return CLASSIFICATION_ACTIONS.some(({ field }) => classification?.updates?.[field] !== null);
}

function classificationActionSignature(classification) {
  return JSON.stringify(CLASSIFICATION_ACTIONS.map(({ field, type }) => {
    const value = classification?.updates?.[field] ?? null;
    if (value === null) return null;
    if (type === "refund") return Boolean(value);
    return String(value).trim();
  }));
}

function duplicateClassificationIndex(index) {
  const signature = classificationActionSignature(classifications[index]);
  return classifications.findIndex((classification, candidateIndex) =>
    candidateIndex !== index && classificationActionSignature(classification) === signature,
  );
}

function classificationInput(label, value, onInput, { required = false } = {}) {
  const field = document.createElement("label");
  field.className = "classification-field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.required = required;
  input.autocomplete = "off";
  input.disabled = classificationsBusy;
  input.addEventListener("input", () => {
    onInput(input.value);
    updateAddClassificationAvailability();
  });
  field.append(caption, input);
  return field;
}

function classificationNotes(value, onInput) {
  const field = document.createElement("label");
  field.className = "classification-field classification-rule-notes";
  const caption = document.createElement("span");
  caption.textContent = "Rule note (optional)";
  const textarea = document.createElement("textarea");
  textarea.value = value || "";
  textarea.rows = 3;
  textarea.maxLength = 2000;
  textarea.disabled = classificationsBusy;
  textarea.addEventListener("input", () => onInput(textarea.value));
  const help = document.createElement("small");
  help.textContent = "For your reference only. This text is not used when matching transactions.";
  field.append(caption, textarea, help);
  return field;
}

function classificationActionEditor(classification, index, definition) {
  const { field, label, type } = definition;
  const row = document.createElement("div");
  row.className = "classification-action-field";
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "classification-action-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = classification.updates[field] !== null;
  toggle.disabled = classificationsBusy;
  const caption = document.createElement("span");
  caption.textContent = label;
  toggleLabel.append(toggle, caption);

  let control;
  if (type === "refund" || type === "internal-transfer") {
    control = document.createElement("select");
    const choices = type === "refund"
      ? [["true", "Mark as refunded"], ["false", "Mark as not refunded"]]
      : [
        ["true", "Mark as internal transfer"],
        ["false", "Always count normally"],
      ];
    for (const [value, text] of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      control.append(option);
    }
    control.value = classification.updates[field] === false ? "false" : "true";
    control.addEventListener("change", () => {
      classification.updates[field] = control.value === "true";
    });
  } else if (type === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
    control.maxLength = 2000;
    control.value = classification.updates[field] ?? "";
    control.addEventListener("input", () => { classification.updates[field] = control.value; });
  } else {
    control = document.createElement("input");
    control.type = type;
    control.autocomplete = "off";
    control.value = classification.updates[field] ?? "";
    control.addEventListener("input", () => { classification.updates[field] = control.value; });
  }
  control.disabled = classificationsBusy || !toggle.checked;
  control.setAttribute("aria-label", `${label} value`);

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      classification.updates[field] = ["refund", "internal-transfer"].includes(type)
        ? control.value === "true"
        : control.value;
    } else {
      classification.updates[field] = null;
    }
    control.disabled = classificationsBusy || !toggle.checked;
    updateAddClassificationAvailability();
    if (toggle.checked && !["refund", "internal-transfer"].includes(type)) control.focus();
  });
  row.append(toggleLabel, control);
  return row;
}

function displayClassificationAction(definition, value) {
  if (definition.field === "refunded") return value ? "Mark as refunded" : "Mark as not refunded";
  if (definition.field === "internalTransfer") {
    return value ? "Mark as internal transfer" : "Always count normally";
  }
  if (value === "") return "Clear value";
  return String(value);
}

function smallAction(label, onClick, { danger = false, disabled = false } = {}) {
  const button = document.createElement("button");
  button.className = danger ? "text-button classification-remove" : "text-button";
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled || classificationsBusy;
  button.addEventListener("click", onClick);
  return button;
}

const RULE_FIELD_LABELS = {
  category: "Category",
  subcategory: "Subcategory",
  description: "Description",
  accountName: "Account name",
  provider: "Provider",
};

function editorOpen() {
  return classificationEdit !== null || ruleEdits.size > 0;
}

function ruleEditKey(classificationIndex, ruleIndex) {
  return `${classificationIndex}:${ruleIndex}`;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function inlineEditorActions(onCancel, onSave) {
  const actions = document.createElement("div");
  actions.className = "classification-inline-actions";
  const cancel = smallAction("Cancel", onCancel);
  cancel.className = "secondary-button";
  const save = smallAction("Save", onSave);
  save.className = "primary-button";
  actions.append(cancel, save);
  return actions;
}

function cancelRuleEdit(classificationIndex, ruleIndex) {
  const key = ruleEditKey(classificationIndex, ruleIndex);
  const edit = ruleEdits.get(key);
  if (!edit) return;
  if (edit.isNew && pendingNewClassificationIndex === classificationIndex) {
    classifications.splice(classificationIndex, 1);
    classificationEdit = null;
    pendingNewClassificationIndex = null;
    selectedClassificationIndex = Math.max(0, classificationIndex - 1);
    ruleEdits.clear();
  } else if (edit.isNew) {
    classifications[classificationIndex].rules.splice(ruleIndex, 1);
    ruleEdits.delete(key);
  } else {
    classifications[classificationIndex].rules[ruleIndex] = edit.original;
    ruleEdits.delete(key);
  }
  renderClassifications();
}

async function saveRuleEdit(classificationIndex, ruleIndex) {
  const key = ruleEditKey(classificationIndex, ruleIndex);
  const targetEdit = ruleEdits.get(key);
  if (!targetEdit) return;

  if (pendingNewClassificationIndex === classificationIndex && classificationEdit?.isNew) {
    try {
      validateRule(classifications[classificationIndex].rules[ruleIndex], classificationIndex, ruleIndex);
    } catch (error) {
      setClassificationStatus(error.message, "error");
      return;
    }
    ruleEdits.delete(key);
    setClassificationStatus("Rule ready. Save the classification details to create it.");
    renderClassifications();
    return;
  }

  const candidate = cloneValue(classifications);
  if (classificationEdit) {
    candidate[classificationEdit.index].updates = cloneValue(classificationEdit.original.updates);
  }
  const otherEdits = [...ruleEdits.values()]
    .filter((edit) => !(edit.classificationIndex === classificationIndex && edit.ruleIndex === ruleIndex))
    .sort((left, right) => right.ruleIndex - left.ruleIndex);
  for (const edit of otherEdits) {
    if (edit.original === null) candidate[edit.classificationIndex].rules.splice(edit.ruleIndex, 1);
    else candidate[edit.classificationIndex].rules[edit.ruleIndex] = cloneValue(edit.original);
  }
  const preservedEdits = [...ruleEdits.values()]
    .filter((edit) => edit !== targetEdit)
    .map((edit) => ({ ...edit, draft: cloneValue(classifications[edit.classificationIndex].rules[edit.ruleIndex]) }));
  const classificationDraft = classificationEdit
    ? cloneValue(classifications[classificationEdit.index].updates)
    : null;
  if (await persistClassifications("Rule saved.", candidate, () => {
    ruleEdits = new Map();
    if (classificationEdit && classificationDraft) {
      classifications[classificationEdit.index].updates = classificationDraft;
    }
    for (const edit of preservedEdits) {
      classifications[edit.classificationIndex].rules[edit.ruleIndex] = edit.draft;
      ruleEdits.set(ruleEditKey(edit.classificationIndex, edit.ruleIndex), {
        classificationIndex: edit.classificationIndex,
        ruleIndex: edit.ruleIndex,
        original: edit.original,
        isNew: edit.isNew,
      });
    }
  })) {
    ruleEdits.delete(key);
    if (targetEdit.isNew && pendingNewClassificationIndex === classificationIndex) {
      pendingNewClassificationIndex = null;
    }
    renderClassifications();
  }
}

async function deleteRule(classificationIndex, ruleIndex) {
  if (classifications[classificationIndex].rules.length === 1) {
    setClassificationStatus("A classification must contain at least one rule.", "error");
    return;
  }
  if (!window.confirm("Delete this rule?")) return;
  const removed = classifications[classificationIndex].rules.splice(ruleIndex, 1)[0];
  if (!await persistClassifications("Rule deleted.")) {
    classifications[classificationIndex].rules.splice(ruleIndex, 0, removed);
    renderClassifications();
  }
}

function renderRule(rule, classificationIndex, ruleIndex) {
  const row = document.createElement("article");
  row.className = "classification-rule";
  const key = ruleEditKey(classificationIndex, ruleIndex);
  const editState = ruleEdits.get(key);
  const editing = editState !== undefined;

  const header = document.createElement("div");
  header.className = "classification-rule-display-header";
  const titleBlock = document.createElement("div");
  titleBlock.className = "classification-rule-title";
  const number = document.createElement("strong");
  number.textContent = `Rule ${ruleIndex + 1}`;
  titleBlock.append(number);
  if (!editing && rule.notes) {
    const note = document.createElement("p");
    note.textContent = rule.notes;
    titleBlock.append(note);
  }
  header.append(titleBlock);

  if (editing) {
    const fields = document.createElement("div");
    fields.className = "classification-rule-fields";
    for (const [field, label] of Object.entries(RULE_FIELD_LABELS)) {
      fields.append(classificationInput(`${label} regex`, rule[field], (value) => {
        classifications[classificationIndex].rules[ruleIndex][field] = value;
      }));
    }
    const note = classificationNotes(rule.notes, (value) => {
      classifications[classificationIndex].rules[ruleIndex].notes = value;
    });
    row.classList.add("is-editing");
    row.append(header, fields, note);
    row.append(inlineEditorActions(
      () => cancelRuleEdit(classificationIndex, ruleIndex),
      () => saveRuleEdit(classificationIndex, ruleIndex),
    ));
    return row;
  }

  const actions = document.createElement("div");
  actions.className = "classification-compact-actions";
  const edit = smallAction("Edit", () => {
    ruleEdits.set(key, {
      classificationIndex,
      ruleIndex,
      original: { ...rule },
      isNew: false,
    });
    renderClassifications();
  });
  const remove = smallAction("Delete rule", () => deleteRule(classificationIndex, ruleIndex), {
    danger: true,
    disabled: editorOpen(),
  });
  actions.append(edit, remove);
  header.append(actions);

  const summary = document.createElement("div");
  summary.className = "classification-rule-summary";
  for (const [field, label] of Object.entries(RULE_FIELD_LABELS)) {
    if (!rule[field]) continue;
    const line = document.createElement("p");
    const name = document.createElement("span");
    name.textContent = label;
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    const pattern = document.createElement("code");
    pattern.textContent = rule[field];
    line.append(name, arrow, pattern);
    summary.append(line);
  }
  row.append(header, summary);
  return row;
}

function cancelClassificationEdit() {
  if (!classificationEdit) return;
  const { index, original, isNew } = classificationEdit;
  if (isNew) {
    classifications.splice(index, 1);
    ruleEdits = new Map(
      [...ruleEdits.entries()].filter(([, edit]) => edit.classificationIndex !== index),
    );
    pendingNewClassificationIndex = null;
    selectedClassificationIndex = Math.max(0, Math.min(index - 1, classifications.length - 1));
  } else {
    classifications[index].updates = original.updates;
  }
  classificationEdit = null;
  renderClassifications();
}

async function saveClassificationEdit() {
  if (!classificationEdit) return;
  const editedIndex = classificationEdit.index;
  const duplicateIndex = duplicateClassificationIndex(editedIndex);
  if (duplicateIndex !== -1) {
    setClassificationStatus(
      `This classification already exists on page ${duplicateIndex + 1}. Add the rule there instead.`,
      "error",
    );
    return;
  }

  if (classificationEdit.isNew && ruleEdits.has(ruleEditKey(editedIndex, 0))) {
    try {
      validateClassificationActions(classifications[editedIndex], editedIndex);
    } catch (error) {
      setClassificationStatus(error.message, "error");
      return;
    }
    classificationEdit = null;
    setClassificationStatus("Classification details ready. Save its rule to create it.");
    renderClassifications();
    return;
  }

  const candidate = cloneValue(classifications);
  const preservedEdits = [...ruleEdits.values()].map((edit) => ({
    ...edit,
    classificationSignature: classificationActionSignature(candidate[edit.classificationIndex]),
    draft: cloneValue(classifications[edit.classificationIndex].rules[edit.ruleIndex]),
  }));
  const editsToRevert = [...ruleEdits.values()].sort(
    (left, right) => right.ruleIndex - left.ruleIndex,
  );
  for (const edit of editsToRevert) {
    if (edit.original === null) candidate[edit.classificationIndex].rules.splice(edit.ruleIndex, 1);
    else candidate[edit.classificationIndex].rules[edit.ruleIndex] = cloneValue(edit.original);
  }
  if (await persistClassifications("Classification saved.", candidate, () => {
    const remappedEdits = new Map();
    for (const edit of preservedEdits) {
      const classificationIndex = classifications.findIndex(
        (classification) => classificationActionSignature(classification) === edit.classificationSignature,
      );
      if (classificationIndex === -1) continue;
      classifications[classificationIndex].rules[edit.ruleIndex] = edit.draft;
      remappedEdits.set(ruleEditKey(classificationIndex, edit.ruleIndex), {
        classificationIndex,
        ruleIndex: edit.ruleIndex,
        original: edit.original,
        isNew: edit.isNew,
      });
    }
    ruleEdits = remappedEdits;
  })) {
    classificationEdit = null;
    pendingNewClassificationIndex = null;
    renderClassifications();
  }
}

async function deleteClassification(index) {
  if (!window.confirm("Delete this classification?")) return;
  const removed = classifications.splice(index, 1)[0];
  selectedClassificationIndex = Math.max(0, Math.min(index, classifications.length - 1));
  if (!await persistClassifications("Classification deleted.")) {
    classifications.splice(index, 0, removed);
    selectedClassificationIndex = index;
    renderClassifications();
  }
}

function renderClassification(classification, index) {
  const card = document.createElement("article");
  card.className = "classification-card";
  const editing = classificationEdit?.index === index;

  const header = document.createElement("div");
  header.className = "classification-card-header";
  const title = document.createElement("strong");
  title.textContent = editing ? "Edit classification" : "Classification details";
  header.append(title);

  if (editing) {
    const destination = document.createElement("div");
    destination.className = "classification-destination";
    const guidance = document.createElement("p");
    guidance.className = "classification-action-guidance";
    guidance.textContent = "Select each field this classification should change. Unselected fields stay untouched.";
    destination.append(guidance);
    for (const definition of CLASSIFICATION_ACTIONS) {
      destination.append(classificationActionEditor(classification, index, definition));
    }
    card.append(
      header,
      destination,
      inlineEditorActions(cancelClassificationEdit, saveClassificationEdit),
    );
  } else {
    const actions = document.createElement("div");
    actions.className = "classification-compact-actions";
    actions.append(
      smallAction("Edit", () => {
        classificationEdit = {
          index,
          original: { updates: structuredClone(classification.updates) },
          isNew: false,
        };
        renderClassifications();
      }, {
        disabled: classificationEdit !== null || pendingNewClassificationIndex === index,
      }),
      smallAction("Delete classification", () => deleteClassification(index), {
        danger: true,
        disabled: editorOpen(),
      }),
    );
    header.append(actions);
    const summary = document.createElement("dl");
    summary.className = "classification-summary";
    for (const definition of CLASSIFICATION_ACTIONS) {
      const value = classification.updates[definition.field];
      if (value === null) continue;
      const term = document.createElement("dt");
      term.textContent = definition.label;
      const detail = document.createElement("dd");
      detail.textContent = displayClassificationAction(definition, value);
      summary.append(term, detail);
    }
    card.append(header, summary);
  }

  const ruleHeading = document.createElement("div");
  ruleHeading.className = "classification-rule-heading";
  const ruleTitle = document.createElement("span");
  ruleTitle.textContent = "Match any of these rules";
  const addRule = smallAction("Add rule", () => {
    const ruleIndex = classifications[index].rules.length;
    classifications[index].rules.push(blankRule());
    ruleEdits.set(ruleEditKey(index, ruleIndex), {
      classificationIndex: index,
      ruleIndex,
      original: null,
      isNew: true,
    });
    renderClassifications();
  }, { disabled: editorOpen() });
  addRule.classList.add("classification-add-rule");
  ruleHeading.append(ruleTitle, addRule);

  const rules = document.createElement("div");
  rules.className = "classification-rules";
  rules.append(...classification.rules.map((rule, ruleIndex) => renderRule(rule, index, ruleIndex)));
  card.append(ruleHeading, rules);
  return card;
}

function classificationCanBeFollowedByAnother(classification) {
  if (!classificationHasActions(classification)) return false;
  for (const { field, required } of CLASSIFICATION_ACTIONS) {
    if (required && classification.updates[field] !== null
      && !String(classification.updates[field]).trim()) return false;
  }
  return classification.rules.length > 0 && classification.rules.every((rule) =>
    [rule.category, rule.subcategory, rule.description, rule.accountName, rule.provider]
      .some((matcher) => matcher.trim()),
  );
}

function updateAddClassificationAvailability() {
  const lastClassification = classifications.at(-1);
  const canAdd = !lastClassification || classificationCanBeFollowedByAnother(lastClassification);
  elements.addClassification.disabled = classificationsBusy || editorOpen() || !canAdd;
  elements.addClassification.title = canAdd
    ? ""
    : "Complete the last classification with at least one action and one matcher in every rule first.";
}

function renderClassifications() {
  updateAddClassificationAvailability();
  elements.importClassifications.disabled = classificationsBusy || editorOpen();
  elements.importClassificationsInput.disabled = classificationsBusy || editorOpen();
  elements.exportClassifications.disabled = classificationsBusy || editorOpen();
  elements.applyClassifications.disabled =
    classificationsBusy || editorOpen() || classifications.length === 0;
  elements.classificationPagination.hidden = classifications.length === 0;
  if (classifications.length === 0) {
    const empty = document.createElement("div");
    empty.className = "classification-empty";
    const title = document.createElement("strong");
    title.textContent = "No classifications yet";
    const message = document.createElement("p");
    message.textContent = "Imported transactions will retain their source category and use a blank subcategory.";
    empty.append(title, message);
    elements.classificationList.replaceChildren(empty);
    return;
  }
  selectedClassificationIndex = Math.min(selectedClassificationIndex, classifications.length - 1);
  elements.classificationPageIndicator.textContent =
    `Classification ${selectedClassificationIndex + 1} of ${classifications.length}`;
  elements.previousClassification.disabled =
    classificationsBusy || editorOpen() || selectedClassificationIndex === 0;
  elements.nextClassification.disabled =
    classificationsBusy || editorOpen() || selectedClassificationIndex === classifications.length - 1;
  elements.classificationList.replaceChildren(
    renderClassification(classifications[selectedClassificationIndex], selectedClassificationIndex),
  );
}

function validateClassificationActions(classification, classificationIndex) {
  if (!classificationHasActions(classification)) {
    throw new Error(`Classification ${classificationIndex + 1} needs at least one action.`);
  }
  for (const { field, label, required } of CLASSIFICATION_ACTIONS) {
    const value = classification.updates[field];
    if (value === null) continue;
    if (required && !String(value).trim()) {
      throw new Error(`Classification ${classificationIndex + 1} needs a ${label.toLowerCase()} value.`);
    }
  }
}

function validateRule(rule, classificationIndex, ruleIndex) {
  const matchers = [rule.category, rule.subcategory, rule.description, rule.accountName, rule.provider];
  if (!matchers.some((value) => value.trim())) {
    throw new Error(`Rule ${ruleIndex + 1} in classification ${classificationIndex + 1} needs a matcher.`);
  }
  for (const value of matchers.filter((matcher) => matcher.trim())) {
    try {
      new RegExp(value, "i");
    } catch (error) {
      throw new Error(
        `Rule ${ruleIndex + 1} in classification ${classificationIndex + 1} has an invalid regular expression.`,
      );
    }
  }
}

function validateClassifications(candidate = classifications) {
  for (const [classificationIndex, classification] of candidate.entries()) {
    validateClassificationActions(classification, classificationIndex);
    if (classification.rules.length === 0) {
      throw new Error(`Classification ${classificationIndex + 1} needs at least one rule.`);
    }
    for (const [ruleIndex, rule] of classification.rules.entries()) {
      validateRule(rule, classificationIndex, ruleIndex);
    }
  }
}

async function loadClassifications() {
  classificationsBusy = true;
  renderClassifications();
  try {
    const response = await fetch("/api/classifications", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load classifications (${response.status}).`);
    classifications = Array.isArray(payload.classifications) ? payload.classifications : [];
    selectedClassificationIndex = Math.min(selectedClassificationIndex, classifications.length - 1);
  } catch (error) {
    setClassificationStatus(error instanceof Error ? error.message : "Could not load classifications.", "error");
  } finally {
    classificationsBusy = false;
    renderClassifications();
  }
}

async function persistClassifications(successMessage, candidate = classifications, afterLoad = null) {
  try {
    validateClassifications(candidate);
  } catch (error) {
    setClassificationStatus(error.message, "error");
    return false;
  }
  const selectedSignature = candidate[selectedClassificationIndex]
    ? classificationActionSignature(candidate[selectedClassificationIndex])
    : null;
  classificationsBusy = true;
  renderClassifications();
  try {
    const response = await fetch("/api/classifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, classifications: candidate }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not save classifications (${response.status}).`);
    classifications = payload.classifications;
    if (selectedSignature !== null) {
      const sortedIndex = classifications.findIndex(
        (classification) => classificationActionSignature(classification) === selectedSignature,
      );
      if (sortedIndex !== -1) selectedClassificationIndex = sortedIndex;
    }
    if (afterLoad) afterLoad();
    setClassificationStatus(successMessage);
    return true;
  } catch (error) {
    setClassificationStatus(error instanceof Error ? error.message : "Could not save classifications.", "error");
    return false;
  } finally {
    classificationsBusy = false;
    renderClassifications();
  }
}

function formatPreviewActionValue(field, value) {
  if (field === "refunded") return value ? "Refunded" : "Not refunded";
  if (field === "internalTransfer") {
    if (value === null) return "Automatic";
    return value ? "Internal transfer" : "Count normally";
  }
  if (value === "") return "Blank";
  return String(value);
}

function classificationPreviewRow(change) {
  const row = document.createElement("article");
  row.className = "classification-preview-row";
  const details = document.createElement("div");
  details.className = "classification-preview-details";
  const description = document.createElement("strong");
  description.textContent = change.description;
  const metadata = document.createElement("span");
  metadata.textContent = `${transactionDateFormatter.format(new Date(`${change.date}T12:00:00Z`))} · ${change.accountName} · ${change.provider}`;
  details.append(description, metadata);

  const transitions = document.createElement("div");
  transitions.className = "classification-preview-transitions";
  for (const field of change.changedFields) {
    const definition = CLASSIFICATION_ACTIONS.find((candidate) => candidate.field === field);
    const transition = document.createElement("div");
    transition.className = "classification-preview-transition";
    const label = document.createElement("span");
    label.className = "classification-preview-field";
    label.textContent = definition?.label || field;
    const before = document.createElement("span");
    before.textContent = formatPreviewActionValue(field, change.before[field]);
    const arrow = document.createElement("span");
    arrow.className = "classification-preview-arrow";
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    const after = document.createElement("strong");
    after.textContent = formatPreviewActionValue(field, change.after[field]);
    transition.append(label, before, arrow, after);
    transitions.append(transition);
  }

  const amount = document.createElement("span");
  amount.className = "classification-preview-amount";
  amount.textContent = currencyFormatter.format(change.amount);
  row.append(details, transitions, amount);
  return row;
}

function closeClassificationPreview() {
  if (classificationsBusy) return;
  pendingClassificationPreview = null;
  elements.previewDialog.close();
}

function showPreviewError(message) {
  elements.previewError.textContent = message;
  elements.previewError.hidden = false;
}

async function previewClassificationsForExisting() {
  try {
    validateClassifications();
  } catch (error) {
    setClassificationStatus(error.message, "error");
    return;
  }
  classificationsBusy = true;
  elements.applyClassifications.textContent = "Preparing preview…";
  renderClassifications();
  try {
    const document = JSON.parse(JSON.stringify({ version: 2, classifications }));
    const response = await fetch("/api/classifications/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    const preview = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(preview.error || `Could not preview classifications (${response.status}).`);
    }
    if (preview.changed === 0) {
      const alreadyClassified = preview.matched || 0;
      const matchMessage = alreadyClassified
        ? `${alreadyClassified} matched, but already have the selected values.`
        : "No transactions matched these rules.";
      setClassificationStatus(`Checked ${preview.total} transactions. ${matchMessage}`);
      return;
    }
    pendingClassificationPreview = { ...preview, document };
    const matched = preview.matched || preview.changed;
    const unchangedMatches = Math.max(0, matched - preview.changed);
    elements.previewSummary.textContent =
      `${matched} matched · ${preview.changed} will be modified · ` +
      `${unchangedMatches} already have the selected values.`;
    elements.previewError.hidden = true;
    elements.previewError.textContent = "";
    elements.confirmPreview.textContent = `Apply changes (${preview.changed})`;
    elements.previewList.replaceChildren(...preview.changes.map(classificationPreviewRow));
    elements.previewDialog.showModal();
  } catch (error) {
    setClassificationStatus(
      error instanceof Error ? error.message : "Could not preview classifications.",
      "error",
    );
  } finally {
    classificationsBusy = false;
    elements.applyClassifications.textContent = "Apply to existing transactions";
    renderClassifications();
  }
}

async function confirmClassificationPreview() {
  if (!pendingClassificationPreview || classificationsBusy) return;
  classificationsBusy = true;
  elements.closePreview.disabled = true;
  elements.cancelPreview.disabled = true;
  elements.confirmPreview.disabled = true;
  elements.confirmPreview.textContent = "Applying…";
  try {
    const response = await fetch("/api/classifications/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: true,
        revision: pendingClassificationPreview.revision,
        document: pendingClassificationPreview.document,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Could not apply classifications (${response.status}).`);
    }
    classifications = result.classifications;
    pendingClassificationPreview = null;
    elements.previewDialog.close();
    setClassificationStatus(
      `Updated ${result.changed} of ${result.total} transactions. A safety backup was created.`,
    );
    if (elements.backupList) await loadBackups();
  } catch (error) {
    showPreviewError(error instanceof Error ? error.message : "Could not apply classifications.");
  } finally {
    classificationsBusy = false;
    elements.closePreview.disabled = false;
    elements.cancelPreview.disabled = false;
    elements.confirmPreview.disabled = false;
    elements.confirmPreview.textContent = pendingClassificationPreview
      ? `Apply changes (${pendingClassificationPreview.changed})`
      : "Apply changes";
    elements.applyClassifications.textContent = "Apply to existing transactions";
    renderClassifications();
  }
}

if (elements.createBackup) {
  elements.createBackup.addEventListener("click", createBackup);
  elements.refreshBackups.addEventListener("click", loadBackups);
  elements.refreshImportHistory.addEventListener("click", loadImportHistory);
  elements.closeImportHistoryDialog.addEventListener("click", closeImportHistoryDialog);
  elements.importHistoryDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImportHistoryDialog();
  });
  elements.importHistoryDialog.addEventListener("click", (event) => {
    if (event.target === elements.importHistoryDialog) closeImportHistoryDialog();
  });
  elements.importHistoryEditForm.addEventListener("submit", saveImportHistoryTransaction);
  elements.closeImportHistoryEdit.addEventListener("click", closeImportHistoryTransactionEditor);
  elements.cancelImportHistoryEdit.addEventListener("click", closeImportHistoryTransactionEditor);
  elements.importHistoryEditDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImportHistoryTransactionEditor();
  });
  elements.importHistoryEditDialog.addEventListener("click", (event) => {
    if (event.target === elements.importHistoryEditDialog) closeImportHistoryTransactionEditor();
  });
  initializeSettingsTabs();
  loadBackups();
}

async function exportClassifications() {
  if (classificationsBusy) return;
  classificationsBusy = true;
  renderClassifications();
  try {
    const handle = typeof window.showSaveFilePicker === "function"
      ? await window.showSaveFilePicker({
        suggestedName: "classifications.json",
        types: [{
          description: "JSON files",
          accept: { "application/json": [".json"] },
        }],
      })
      : null;
    const response = await fetch("/api/classifications/export", { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Could not export classifications (${response.status}).`);
    }
    const blob = await response.blob();
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "classifications.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    setClassificationStatus("Classifications exported.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setClassificationStatus(
      error instanceof Error ? error.message : "Could not export classifications.",
      "error",
    );
  } finally {
    classificationsBusy = false;
    renderClassifications();
  }
}

async function importClassifications(event) {
  const input = event.currentTarget;
  const [file] = input.files;
  input.value = "";
  if (!file || classificationsBusy || editorOpen()) return;
  try {
    const document = JSON.parse(await file.text());
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("The selected file must contain a classifications JSON object.");
    }
    if (!window.confirm(
      `Import ${file.name}? This will replace the current classification library.`,
    )) return;

    classificationsBusy = true;
    renderClassifications();
    const response = await fetch("/api/classifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not import classifications (${response.status}).`);
    }
    classifications = payload.classifications;
    selectedClassificationIndex = 0;
    classificationEdit = null;
    ruleEdits.clear();
    pendingNewClassificationIndex = null;
    setClassificationStatus(
      `Imported ${classifications.length} classification${classifications.length === 1 ? "" : "s"} from ${file.name}.`,
    );
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "The selected file is not valid JSON."
      : error instanceof Error ? error.message : "Could not import classifications.";
    setClassificationStatus(message, "error");
  } finally {
    classificationsBusy = false;
    renderClassifications();
  }
}

if (elements.addClassification) {
  elements.importClassifications.addEventListener("click", () => {
  elements.importClassificationsInput.click();
  });
  elements.importClassificationsInput.addEventListener("change", importClassifications);
  elements.exportClassifications.addEventListener("click", exportClassifications);
  elements.addClassification.addEventListener("click", () => {
  const lastClassification = classifications.at(-1);
  if (lastClassification && !classificationCanBeFollowedByAnother(lastClassification)) return;
  classifications.push(blankClassification());
  selectedClassificationIndex = classifications.length - 1;
  pendingNewClassificationIndex = selectedClassificationIndex;
  classificationEdit = { index: selectedClassificationIndex, original: null, isNew: true };
  ruleEdits.set(ruleEditKey(selectedClassificationIndex, 0), {
    classificationIndex: selectedClassificationIndex,
    ruleIndex: 0,
    original: null,
    isNew: true,
  });
  renderClassifications();
  });
  elements.previousClassification.addEventListener("click", () => {
  if (editorOpen() || selectedClassificationIndex === 0) return;
  selectedClassificationIndex -= 1;
  renderClassifications();
  });
  elements.nextClassification.addEventListener("click", () => {
  if (editorOpen() || selectedClassificationIndex >= classifications.length - 1) return;
  selectedClassificationIndex += 1;
  renderClassifications();
  });
  elements.reviewUnclassified.addEventListener("click", openUnclassifiedDialog);
  elements.unclassifiedSearch.addEventListener("input", renderUnclassifiedTransactions);
  elements.unclassifiedCategory.addEventListener("change", renderUnclassifiedTransactions);
  elements.unclassifiedAccount.addEventListener("change", renderUnclassifiedTransactions);
  elements.unclassifiedProvider.addEventListener("change", renderUnclassifiedTransactions);
  elements.clearUnclassifiedFilters.addEventListener("click", () => {
  elements.unclassifiedSearch.value = "";
  elements.unclassifiedCategory.value = "";
  elements.unclassifiedAccount.value = "";
  elements.unclassifiedProvider.value = "";
  renderUnclassifiedTransactions();
  elements.unclassifiedSearch.focus();
  });
  elements.closeUnclassified.addEventListener("click", closeUnclassifiedDialog);
  elements.unclassifiedDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeUnclassifiedDialog();
  });
  elements.unclassifiedDialog.addEventListener("click", (event) => {
  if (event.target === elements.unclassifiedDialog) closeUnclassifiedDialog();
  });
  elements.applyClassifications.addEventListener("click", previewClassificationsForExisting);
  elements.closePreview.addEventListener("click", closeClassificationPreview);
  elements.cancelPreview.addEventListener("click", closeClassificationPreview);
  elements.confirmPreview.addEventListener("click", confirmClassificationPreview);
  elements.previewDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeClassificationPreview();
  });
  elements.previewDialog.addEventListener("click", (event) => {
  if (event.target === elements.previewDialog) closeClassificationPreview();
  });
  loadClassifications();
}
