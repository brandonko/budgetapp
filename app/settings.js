"use strict";
const transactionUi = window.LedgerTransactionUI;
void transactionUi.loadEditorTaxonomy();
const IMPORT_HISTORY_PAGE_SIZE = 5;

const state = {
  exportTransactions: [],
  exportBusy: false,
  importHistoryRevision: "",
  importHistoryImports: [],
  importHistoryPage: 0,
  importHistoryBatch: null,
  importHistoryTransactions: [],
  importHistoryFilters: {
    description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
  },
  transactionEdit: null,
  importHistoryEditBusy: false,
  availableTransactionTags: [],
  availableTransactions: [],
  transferReview: null,
  transferReviewBusy: false,
  transferReviewFilters: { proposed: true, flagged: false },
  reconciliationRefundChoices: new Map(),
  reconciliationRefundExpanded: new Set(),
  taxonomy: { version: 1, categories: [] },
  taxonomyRevision: "",
  taxonomyBusy: false,
  hideTaxonomyCategoriesWithoutSubcategories: true,
};

const elements = {
  tabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
  exportsTab: document.querySelector("#exports-settings-tab"),
  exportForm: document.querySelector("#transaction-export-form"),
  exportStartDate: document.querySelector("#export-start-date"),
  exportEndDate: document.querySelector("#export-end-date"),
  exportSummary: document.querySelector("#export-transaction-summary"),
  exportButton: document.querySelector("#export-transactions-button"),
  exportStatus: document.querySelector("#export-status"),
  refreshImportHistory: document.querySelector("#refresh-import-history-button"),
  importHistoryStatus: document.querySelector("#import-history-status"),
  importHistoryList: document.querySelector("#import-history-list"),
  importHistoryPagination: document.querySelector("#import-history-pagination"),
  previousImportHistoryPage: document.querySelector("#previous-import-history-page"),
  nextImportHistoryPage: document.querySelector("#next-import-history-page"),
  importHistoryPageIndicator: document.querySelector("#import-history-page-indicator"),
  importHistoryDialog: document.querySelector("#import-history-dialog"),
  importHistoryDialogSubtitle: document.querySelector("#import-history-dialog-subtitle"),
  importHistoryDialogError: document.querySelector("#import-history-dialog-error"),
  importHistoryTransactions: document.querySelector("#import-history-transactions"),
  importHistorySearch: document.querySelector("#import-history-search"),
  importHistoryCategory: document.querySelector("#import-history-category-filter"),
  importHistorySubcategory: document.querySelector("#import-history-subcategory-filter"),
  importHistoryTag: document.querySelector("#import-history-tag-filter"),
  importHistoryAccount: document.querySelector("#import-history-account-filter"),
  importHistoryProvider: document.querySelector("#import-history-provider-filter"),
  importHistoryFilterButton: document.querySelector("#import-history-filter-button"),
  importHistoryFilterPopover: document.querySelector("#import-history-filter-popover"),
  importHistoryGroup: document.querySelector("#import-history-group-filter"),
  importHistoryFlagged: document.querySelector("#import-history-flagged-filter"),
  importHistoryFilterCount: document.querySelector("#import-history-filter-count"),
  resetImportHistoryFilters: document.querySelector("#reset-import-history-filters"),
  importHistoryActiveFilters: document.querySelector("#import-history-active-filters"),
  importHistoryFilterChips: document.querySelector("#import-history-filter-chips"),
  clearImportHistoryFilters: document.querySelector("#clear-import-history-filters"),
  importHistorySort: document.querySelector("#import-history-sort"),
  transferReviewFilters: document.querySelector("#transfer-review-filters"),
  transferReviewProposedFilter: document.querySelector("#transfer-review-proposed-filter"),
  transferReviewFlaggedFilter: document.querySelector("#transfer-review-flagged-filter"),
  closeImportHistoryDialog: document.querySelector("#close-import-history-dialog"),
  importHistoryEditDialog: document.querySelector("#import-history-edit-dialog"),
  importHistoryEditForm: document.querySelector("#import-history-edit-form"),
  importHistoryEditError: document.querySelector("#import-history-edit-error"),
  closeImportHistoryEdit: document.querySelector("#close-import-history-edit"),
  cancelImportHistoryEdit: document.querySelector("#cancel-import-history-edit"),
  saveImportHistoryEdit: document.querySelector("#save-import-history-edit"),
  taxonomyTab: document.querySelector("#taxonomy-settings-tab"),
  taxonomyStatus: document.querySelector("#taxonomy-status"),
  taxonomySummary: document.querySelector("#taxonomy-summary"),
  taxonomyTree: document.querySelector("#taxonomy-tree"),
  taxonomySearch: document.querySelector("#taxonomy-search"),
  taxonomySubcategoryFilter: document.querySelector("#taxonomy-subcategory-filter"),
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
  unclassifiedSubcategory: document.querySelector("#unclassified-subcategory-filter"),
  unclassifiedTag: document.querySelector("#unclassified-tag-filter"),
  unclassifiedAccount: document.querySelector("#unclassified-account-filter"),
  unclassifiedProvider: document.querySelector("#unclassified-provider-filter"),
  unclassifiedFilterButton: document.querySelector("#unclassified-filter-button"),
  unclassifiedFilterPopover: document.querySelector("#unclassified-filter-popover"),
  unclassifiedGroup: document.querySelector("#unclassified-group-filter"),
  unclassifiedFlagged: document.querySelector("#unclassified-flagged-filter"),
  unclassifiedFilterCount: document.querySelector("#unclassified-filter-count"),
  resetUnclassifiedFilters: document.querySelector("#reset-unclassified-filters"),
  unclassifiedActiveFilters: document.querySelector("#unclassified-active-filters"),
  unclassifiedFilterChips: document.querySelector("#unclassified-filter-chips"),
  clearUnclassifiedFilters: document.querySelector("#clear-unclassified-filters"),
  unclassifiedInternalTransferFilter: document.querySelector("#unclassified-internal-transfer-filter"),
  unclassifiedError: document.querySelector("#unclassified-error"),
  unclassifiedList: document.querySelector("#unclassified-list"),
  unclassifiedSort: document.querySelector("#unclassified-sort"),
  closeUnclassified: document.querySelector("#close-unclassified-dialog"),
  previewDialog: document.querySelector("#classification-preview-dialog"),
  previewSummary: document.querySelector("#classification-preview-summary"),
  previewError: document.querySelector("#classification-preview-error"),
  previewList: document.querySelector("#classification-preview-list"),
  previewSort: document.querySelector("#classification-preview-sort"),
  previewFilters: document.querySelector("#classification-preview-filters"),
  previewFilterButton: document.querySelector("#classification-preview-filter-button"),
  previewGroupFilter: document.querySelector("#classification-preview-group-filter"),
  previewFlaggedFilter: document.querySelector("#classification-preview-flagged-filter"),
  previewFilterCount: document.querySelector("#classification-preview-filter-count"),
  closePreview: document.querySelector("#close-classification-preview"),
  cancelPreview: document.querySelector("#cancel-classification-preview"),
  confirmPreview: document.querySelector("#confirm-classification-preview"),
  darkModeToggle: document.querySelector("#dark-mode-toggle"),
  numberAbbreviationThreshold: document.querySelector("#number-abbreviation-threshold"),
  numberAbbreviationValue: document.querySelector("#number-abbreviation-value"),
};

const NUMBER_ABBREVIATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "k", label: "Thousands (K)" },
  { value: "m", label: "Millions (M)" },
  { value: "b", label: "Billions (B)" },
  { value: "t", label: "Trillions (T)" },
];

function renderNumberAbbreviationPreference(value) {
  if (!elements.numberAbbreviationThreshold || !elements.numberAbbreviationValue) return;
  const optionIndex = NUMBER_ABBREVIATION_OPTIONS.findIndex((option) => option.value === value);
  const normalizedIndex = optionIndex >= 0 ? optionIndex : 2;
  elements.numberAbbreviationThreshold.value = String(normalizedIndex);
  elements.numberAbbreviationValue.textContent = NUMBER_ABBREVIATION_OPTIONS[normalizedIndex].label;
}

let classifications = [];
let classificationsBusy = false;
let selectedClassificationIndex = 0;
let classificationEdit = null;
let ruleEdits = new Map();
let pendingNewClassificationIndex = null;
let pendingClassificationPreview = null;
let classificationPreviewGroup = "";
let classificationPreviewFlagged = "";
let unclassifiedTransactions = [];
let unclassifiedRevision = "";
let unclassifiedFieldFilters = {
  description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
};
let showUnclassifiedInternalTransfers = false;

const backupDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const importHistorySort = elements.importHistorySort
  ? transactionUi.createTransactionSortControls(
      elements.importHistorySort,
      { onChange: () => renderImportHistoryTransactions() },
    )
  : null;
const unclassifiedSort = elements.unclassifiedSort
  ? transactionUi.createTransactionSortControls(
      elements.unclassifiedSort,
      { onChange: () => renderUnclassifiedTransactions() },
    )
  : null;
const classificationPreviewSort = elements.previewSort
  ? transactionUi.createTransactionSortControls(
      elements.previewSort,
      { onChange: () => renderClassificationPreviewChanges() },
    )
  : null;

const transactionDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

const unclassifiedMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const historyBulk = elements.importHistoryTransactions ? window.LedgerTransactionBulk.create({
  container: elements.importHistoryTransactions,
  staged: () => Boolean(state.transferReview),
  onModeChange: (active) => {
    const confirm = document.querySelector("#confirm-transfer-review");
    if (confirm) confirm.disabled = active || state.transferReviewBusy;
  },
  onStage: async (_ids, proposed) => refreshTransferReview(proposed),
  onFlagChange: (row, before) => {
    if (!state.transferReview) return;
    const review = state.transferReview;
    const overrides = new Map(review.overrides.map(item => [item._id, item]));
    overrides.set(row._id, { ...row });
    review.overrides = [...overrides.values()];
    const existing = review.changes.find(entry => entry._id === row._id);
    if (existing) {
      existing.transaction = row;
      existing.after = window.LedgerTransactionBulk.applyChanges(existing.after, { flagged: transactionUi.hasTransactionFlag(row, "flagged") });
      existing.changedFields = window.LedgerTransactionBulk.changedFields(existing.before, existing.after);
      if (!existing.changedFields.length) review.changes = review.changes.filter(entry => entry !== existing);
    } else review.changes.push({ _id: row._id, transaction: row, before, after: { ...row }, changedFields: ["flags"] });
    document.querySelector("#confirm-transfer-review").textContent = review.changes.length
      ? `Save reviewed changes (${review.changes.length})` : "Finish review";
  },
  decorateRow: (row, transaction) => {
    if (!state.transferReview) return;
    const change = state.transferReview.changes.find((entry) => entry._id === transaction._id);
    if (!change) return;
    const details = document.createElement("div");
    details.className = "transfer-change-details";
    for (const field of change.changedFields) {
      const line = document.createElement("p");
      const display = (value) => field === "links"
        ? (()=>{const links=JSON.parse(value || "[]");return links.length ? `${links.length} ${links[0].type === "transfer" ? "internal transfer" : links[0].type} link${links.length===1?"":"s"}` : "No links";})()
        : field === "flags"
        ? String(value).split(",").filter((flag) => !flag.startsWith("transfer-pair-")).join(", ") || "Counted / eligible for detection"
        : String(value || "(blank)");
      line.textContent = `${field === "flags" ? "Budget flags" : field}: ${display(change.before[field])} → ${display(change.after[field])}`;
      details.append(line);
    }
    row.append(details);
  },
  getGroupFilter: () => state.importHistoryFilters.group,
  getTransactions: () => state.importHistoryTransactions,
  getAllTransactions: () => state.availableTransactions,
  getRevision: () => state.importHistoryRevision,
  render: () => renderImportHistoryTransactions(),
  onSaved: (payload) => {
    state.importHistoryRevision = payload.revision;
    state.availableTransactions = payload.transactions;
    state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
    state.importHistoryTransactions = state.importHistoryBatch
      ? payload.transactions.filter((row) => row.createdAt === state.importHistoryBatch.createdAt) : [];
    if (Array.isArray(payload.imports)) renderImportHistory(payload.imports);
    configureImportHistoryFilters();
  },
}) : null;

const unclassifiedBulk = elements.unclassifiedList ? window.LedgerTransactionBulk.create({
  container: elements.unclassifiedList,
  getGroupFilter: () => unclassifiedFieldFilters.group,
  getTransactions: () => unclassifiedTransactions,
  getAllTransactions: () => state.availableTransactions,
  getRevision: () => unclassifiedRevision,
  render: () => renderUnclassifiedTransactions(),
  onSaved: updateUnclassifiedTransactions,
}) : null;

function updateUnclassifiedTransactions(payload) {
  unclassifiedBulk.acceptSaved(payload);
  unclassifiedRevision = payload.revision;
  state.availableTransactions = payload.transactions;
  state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
  unclassifiedTransactions = payload.transactions.filter((row) => !row.subcategory);
  configureUnclassifiedFilters(unclassifiedFieldFilters);
}

const classificationBulk = elements.previewList ? window.LedgerTransactionBulk.create({
  container: elements.previewList, staged: true,
  getGroupFilter: () => classificationPreviewGroup,
  getTransactions: () => pendingClassificationPreview?.changes.map((entry) => entry.transaction) || [],
  getAllTransactions: () => [...state.availableTransactions, ...(pendingClassificationPreview?.changes.map((entry) => entry.transaction) || [])],
  getRevision: () => pendingClassificationPreview?.revision,
  render: () => renderClassificationPreviewChanges(),
  onFlagChange: (row) => stageClassificationRows([row._id], [row]),
  onStage: stageClassificationRows,
  decorateRow: (row, transaction) => {
    const entry = pendingClassificationPreview.changes.find((item) => item._id === transaction._id);
    const details = classificationPreviewRow(entry);
    const transitions = details.querySelector(".classification-preview-transitions");
    transitions.classList.add("bulk-classification-transitions");
    row.append(transitions);
  },
}) : null;

function stageClassificationRows(ids, proposed) {
    const replacements = new Map(proposed.map((row) => [row._id, row]));
    pendingClassificationPreview.changes.forEach((entry) => {
      if (replacements.has(entry._id)) {
        entry.transaction = replacements.get(entry._id);
        entry.bulkEdited = true;
      }
      entry.changedFields = window.LedgerTransactionBulk.changedFields(entry.beforeTransaction, entry.transaction);
      entry.before = entry.beforeTransaction;
      entry.after = entry.transaction;
    });
    pendingClassificationPreview.changed = pendingClassificationPreview.changes.filter((entry) => entry.changedFields.length).length;
    const count = pendingClassificationPreview.changed;
    elements.previewSummary.textContent = `${count} ${count === 1 ? "transaction" : "transactions"} will be modified. Changes are not saved yet.`;
    elements.confirmPreview.textContent = `Apply changes (${pendingClassificationPreview.changed})`;
    elements.confirmPreview.disabled = !pendingClassificationPreview.changed;
}

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
  if (selectedTab === elements.exportsTab) loadExportTransactions();
  if (selectedTab === elements.taxonomyTab) loadTaxonomy();
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

function setExportStatus(message, kind = "success") {
  elements.exportStatus.textContent = message;
  elements.exportStatus.className = `settings-status settings-status--${kind}`;
  elements.exportStatus.hidden = false;
}

function setImportHistoryStatus(message, kind = "success") {
  elements.importHistoryStatus.textContent = message;
  elements.importHistoryStatus.className = `settings-status settings-status--${kind}`;
  elements.importHistoryStatus.hidden = false;
}

function exportTransactionsInRange() {
  const startDate = elements.exportStartDate.value;
  const endDate = elements.exportEndDate.value;
  if (!startDate || !endDate || startDate > endDate) return [];
  const selected = state.exportTransactions.filter(
    (transaction) => transaction.date >= startDate && transaction.date <= endDate,
  );
  const ids = new Set(selected.map(row=>row.id).filter(Boolean));
  for (const row of selected) {
    if (row._linkedTo) ids.add(row._linkedTo.id);
    for (const child of row._linkedTransactions || []) ids.add(child.id);
  }
  for (const row of state.exportTransactions) {
    if (ids.has(row.id)) for (const child of row._linkedTransactions || []) ids.add(child.id);
  }
  return state.exportTransactions.filter(row=>selected.includes(row) || ids.has(row.id));
}

function renderExportSummary() {
  const startDate = elements.exportStartDate.value;
  const endDate = elements.exportEndDate.value;
  const rangeIsValid = Boolean(startDate && endDate && startDate <= endDate);
  const count = rangeIsValid ? exportTransactionsInRange().length : 0;
  elements.exportButton.disabled = state.exportBusy || !rangeIsValid || count === 0;
  if (!rangeIsValid) {
    elements.exportSummary.textContent = startDate && endDate
      ? "Start date must be on or before end date."
      : "Select a start and end date.";
    return;
  }
  const outside = exportTransactionsInRange().filter(row=>row.date < startDate || row.date > endDate).length;
  elements.exportSummary.textContent = `${count} ${count === 1 ? "transaction" : "transactions"}${outside ? `, including ${outside} linked counterparts outside this range` : " in this range"}`;
}

async function loadExportTransactions() {
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    if (response.status === 404) {
      state.exportTransactions = [];
      elements.exportSummary.textContent = "Import transactions before creating an export.";
      elements.exportButton.disabled = true;
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load transactions (${response.status}).`);
    state.exportTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    const dates = state.exportTransactions.map((transaction) => transaction.date).sort();
    if (dates.length > 0) {
      if (!elements.exportStartDate.value) elements.exportStartDate.value = dates[0];
      if (!elements.exportEndDate.value) elements.exportEndDate.value = dates.at(-1);
    }
    renderExportSummary();
  } catch (error) {
    state.exportTransactions = [];
    elements.exportButton.disabled = true;
    setExportStatus(error instanceof Error ? error.message : "Could not load transactions.", "error");
  }
}

async function exportTransactions(event) {
  event.preventDefault();
  if (state.exportBusy || elements.exportButton.disabled) return;
  const startDate = elements.exportStartDate.value;
  const endDate = elements.exportEndDate.value;
  const suggestedName = `ledger-transactions_${startDate}_to_${endDate}.csv`;
  state.exportBusy = true;
  renderExportSummary();
  elements.exportButton.textContent = "Exporting…";
  elements.exportStatus.hidden = true;
  try {
    const handle = typeof window.showSaveFilePicker === "function"
      ? await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: "CSV files",
          accept: { "text/csv": [".csv"] },
        }],
      })
      : null;
    const query = new URLSearchParams({ startDate, endDate });
    const response = await fetch(`/api/transactions/export?${query}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Could not export transactions (${response.status}).`);
    }
    const blob = await response.blob();
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = suggestedName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
    const count = exportTransactionsInRange().length;
    setExportStatus(`Exported ${count} ${count === 1 ? "transaction" : "transactions"}.`);
  } catch (error) {
    if (error?.name !== "AbortError") {
      setExportStatus(error instanceof Error ? error.message : "Could not export transactions.", "error");
    }
  } finally {
    state.exportBusy = false;
    elements.exportButton.textContent = "Export CSV";
    renderExportSummary();
  }
}

function setImportHistoryBusy(busy) {
  elements.refreshImportHistory.disabled = busy;
  elements.previousImportHistoryPage.disabled = busy || state.importHistoryPage === 0;
  elements.nextImportHistoryPage.disabled = busy || (
    state.importHistoryPage + 1 >= Math.ceil(state.importHistoryImports.length / IMPORT_HISTORY_PAGE_SIZE)
  );
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
  state.importHistoryImports = imports;
  if (imports.length === 0) {
    state.importHistoryPage = 0;
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "No tracked imports yet. New imports will appear here after they are committed.";
    elements.importHistoryList.replaceChildren(empty);
    elements.importHistoryPagination.hidden = true;
    return;
  }
  const pageCount = Math.ceil(imports.length / IMPORT_HISTORY_PAGE_SIZE);
  state.importHistoryPage = Math.min(Math.max(state.importHistoryPage, 0), pageCount - 1);
  const pageStart = state.importHistoryPage * IMPORT_HISTORY_PAGE_SIZE;
  const visibleImports = imports.slice(pageStart, pageStart + IMPORT_HISTORY_PAGE_SIZE);
  elements.importHistoryList.replaceChildren(...visibleImports.map(importHistoryRow));
  elements.importHistoryPagination.hidden = pageCount <= 1;
  elements.importHistoryPageIndicator.textContent = `Page ${state.importHistoryPage + 1} of ${pageCount}`;
  elements.previousImportHistoryPage.disabled = state.importHistoryPage === 0;
  elements.nextImportHistoryPage.disabled = state.importHistoryPage === pageCount - 1;
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
    detailContent: reconciliationRefundControl(transaction),
    detailPlacement: "row",
    showLinks: !(state.transferReview?.refundLinks || []).some(link => link.transactionId === transaction.id),
    disabled: state.transferReviewBusy,
    onEdit: () => openImportHistoryTransactionEditor(transaction),
  };
}

function reconciliationRefundControl(transaction) {
  const review = state.transferReview;
  if (!review) return null;
  const selected = (review.refundLinks || []).find(link => link.transactionId === transaction.id);
  const candidates = transaction._refundCandidates || [];
  if (!selected && !candidates.length) return null;
  const detail = document.createElement("details");
  detail.className = "transaction-linked-details reconciliation-refund-match";
  detail.open = state.reconciliationRefundExpanded.has(transaction.id);
  detail.addEventListener("toggle", () => {
    if (detail.isConnected === false) return;
    if (detail.open) state.reconciliationRefundExpanded.add(transaction.id);
    else state.reconciliationRefundExpanded.delete(transaction.id);
  });
  const summary = document.createElement("summary");
  summary.textContent = selected ? "Refund link staged" : `Possible refund · ${candidates.length} matching purchase${candidates.length === 1 ? "" : "s"}`;
  const note = document.createElement("p");
  note.textContent = selected
    ? "This refund will reduce the purchase's cost. Both transactions stay in Ledger. Select Save reviewed changes to save the link, or undo it below."
    : "Choose the original purchase, then select Link selected purchase below. This stages the link; Save reviewed changes is the final confirmation. Both transactions stay in Ledger and the refund is not counted twice.";
  detail.append(summary, note);
  const remembered = state.reconciliationRefundChoices.get(transaction.id);
  let chosen = candidates.some(row => row.id === remembered) ? remembered
    : remembered === undefined && candidates.length === 1 ? candidates[0].id : null;
  const action = document.createElement("button");
  action.type = "button";
  action.className = selected ? "secondary-button" : "primary-button";
  action.textContent = selected ? "Undo refund link" : "Link selected purchase";
  action.disabled = state.transferReviewBusy || (!selected && !chosen);
  const purchases = selected
    ? [transaction._linkedTo || [...review.transactions, ...state.availableTransactions].find(row => row.id === selected.purchaseId)].filter(Boolean)
    : candidates;
  for (const purchase of purchases) {
    let selection = null;
    if (!selected) {
      selection = document.createElement("label"); selection.className = "import-selection";
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = `reconcile-refund-${transaction.id}`;
      radio.checked = chosen === purchase.id;
      radio.disabled = state.transferReviewBusy;
      radio.setAttribute("aria-label", `Match refund to ${purchase.description} on ${purchase.date}`);
      radio.addEventListener("change", () => {
        if (!radio.checked || state.transferReviewBusy) return;
        chosen = purchase.id;
        state.reconciliationRefundChoices.set(transaction.id, chosen);
        state.reconciliationRefundExpanded.add(transaction.id);
        action.disabled = false;
      });
      selection.append(radio);
    }
    detail.append(transactionUi.createTransactionRow(purchase, {
      currency: currencyFormatter, shortMonthFormatter: unclassifiedMonthFormatter,
      showYear: true, showEdit: false, showLinks: false, leadingControl: selection,
    }));
  }
  const footer = document.createElement("div"); footer.className = "reconciliation-refund-actions";
  footer.append(action); detail.append(footer);
  action.addEventListener("click", async () => {
    if (action.disabled || state.transferReviewBusy || state.transferReview !== review) return;
    const next = (review.refundLinks || []).filter(link => link.transactionId !== transaction.id);
    if (!selected) next.push({ transactionId: transaction.id, purchaseId: chosen });
    state.reconciliationRefundExpanded.add(transaction.id);
    action.disabled = true;
    try { await refreshTransferReview([], next); }
    catch (error) {
      elements.importHistoryDialogError.textContent = error.message;
      elements.importHistoryDialogError.hidden = false;
    }
  });
  return detail;
}

function importHistoryTags(transaction) {
  return String(transaction.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function populateImportHistoryFilter(select, values, allLabel, selected = "") {
  const options = values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  });
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  select.replaceChildren(all, ...options);
  select.value = values.includes(selected) ? selected : "";
}

function importHistoryFilterValues(field, transactions = state.importHistoryTransactions) {
  return [...new Set(transactions.map((transaction) => transaction[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function populateImportHistorySubcategories(category, selected = "") {
  const matching = category
    ? state.importHistoryTransactions.filter((transaction) => transaction.category === category)
    : state.importHistoryTransactions;
  populateImportHistoryFilter(
    elements.importHistorySubcategory,
    importHistoryFilterValues("subcategory", matching),
    "All subcategories",
    selected,
  );
}

function configureImportHistoryFilters(filters = state.importHistoryFilters) {
  transactionUi.setFlagFilter(elements.importHistoryFlagged, filters.flagged || "");
  transactionUi.populateGroupFilter(elements.importHistoryGroup, state.importHistoryTransactions, filters.group);
  const tags = new Map();
  state.importHistoryTransactions.forEach((transaction) => importHistoryTags(transaction).forEach((tag) => {
    if (!tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
  }));
  const tagValues = [...tags.values()].sort((left, right) => left.localeCompare(right));
  const selectedTag = tagValues.find(
    (tag) => tag.toLocaleLowerCase() === String(filters.tag || "").toLocaleLowerCase(),
  ) || "";
  elements.importHistorySearch.value = filters.description || "";
  populateImportHistoryFilter(elements.importHistoryCategory, importHistoryFilterValues("category"), "All categories", filters.category);
  populateImportHistorySubcategories(elements.importHistoryCategory.value, filters.subcategory);
  populateImportHistoryFilter(elements.importHistoryTag, tagValues, "All tags", selectedTag);
  populateImportHistoryFilter(elements.importHistoryAccount, importHistoryFilterValues("accountName"), "All accounts", filters.accountName);
  populateImportHistoryFilter(elements.importHistoryProvider, importHistoryFilterValues("provider"), "All providers", filters.provider);
  state.importHistoryFilters = {
    flagged: transactionUi.flagFilterValue(elements.importHistoryFlagged),
    description: elements.importHistorySearch.value.trim(),
    group: elements.importHistoryGroup.value,
    category: elements.importHistoryCategory.value,
    subcategory: elements.importHistorySubcategory.value,
    tag: elements.importHistoryTag.value,
    accountName: elements.importHistoryAccount.value,
    provider: elements.importHistoryProvider.value,
  };
  renderImportHistoryFilterChips();
}

function importHistoryFilterDraft() {
  return {
    flagged: transactionUi.flagFilterValue(elements.importHistoryFlagged),
    group: elements.importHistoryGroup.value,
    category: elements.importHistoryCategory.value,
    subcategory: elements.importHistorySubcategory.value,
    tag: elements.importHistoryTag.value,
    accountName: elements.importHistoryAccount.value,
    provider: elements.importHistoryProvider.value,
  };
}

function renderImportHistoryFilterChips() {
  const definitions = [
    ["flagged", "Flag status"],
    ["group", "Group"],
    ["category", "Category"], ["subcategory", "Subcategory"], ["tag", "Tag"],
    ["accountName", "Account"], ["provider", "Provider"],
  ];
  const active = definitions.filter(([field]) => state.importHistoryFilters[field]);
  elements.importHistoryFilterCount.textContent = String(active.length);
  elements.importHistoryFilterCount.hidden = active.length === 0;
  elements.importHistoryFilterButton.classList.toggle("has-active-filters", active.length > 0);
  elements.importHistoryActiveFilters.hidden = active.length === 0;
  elements.importHistoryFilterChips.replaceChildren(...active.map(([field, label]) => {
    const value = field === "flagged" ? transactionUi.flagFilterLabel(state.importHistoryFilters[field]) : field === "group" ? transactionUi.groupFilterLabel(state.importHistoryFilters[field]) : state.importHistoryFilters[field];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "transaction-filter-chip";
    chip.textContent = `${label}: ${value} ×`;
    chip.setAttribute("aria-label", `Remove ${label.toLocaleLowerCase()} filter ${value}`);
    chip.addEventListener("click", () => {
      state.importHistoryFilters[field] = "";
      configureImportHistoryFilters(state.importHistoryFilters);
      renderImportHistoryTransactions();
    });
    return chip;
  }));
}

function setImportHistoryFilterPopover(open, restore = true) {
  if (!open && restore) configureImportHistoryFilters(state.importHistoryFilters);
  transactionUi.setTransactionFilterPanel(elements.importHistoryFilterPopover, elements.importHistoryFilterButton, open);
}

function renderImportHistoryTransactions() {
  if (!state.importHistoryBatch) return;
  const transactions = state.importHistoryTransactions;
  const review = state.transferReview;
  const flaggedIds = new Set((review?.alreadyFlagged || []).map((transaction) => transaction._id));
  elements.transferReviewFilters.hidden = !review;
  if (review) {
    elements.transferReviewProposedFilter.textContent = `To review (${transactions.filter(row=>!flaggedIds.has(row._id)).length})`;
    elements.transferReviewFlaggedFilter.textContent = `Already reconciled (${review.alreadyFlagged.length})`;
    elements.transferReviewProposedFilter.setAttribute("aria-pressed", String(state.transferReviewFilters.proposed));
    elements.transferReviewFlaggedFilter.setAttribute("aria-pressed", String(state.transferReviewFilters.flagged));
  }
  state.importHistoryFilters.description = elements.importHistorySearch.value.trim();
  const filters = state.importHistoryFilters;
  const visible = transactionUi.sortTransactions(transactions.filter((transaction) =>
    (!review || state.transferReviewFilters[flaggedIds.has(transaction._id) ? "flagged" : "proposed"])
    && transactionUi.matchesTransactionSearch(transaction, filters.description)
    && transactionUi.matchesFlagFilter(transaction, filters.flagged)
    && (!filters.category || transaction.category === filters.category)
    && (!filters.subcategory || transaction.subcategory === filters.subcategory)
    && (!filters.tag || importHistoryTags(transaction).some(
      (tag) => tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase(),
    ))
    && (!filters.accountName || transaction.accountName === filters.accountName)
    && (!filters.provider || transaction.provider === filters.provider)
  ), importHistorySort.value());
  const groupFiltered = historyBulk.filter(visible);
  const filtered = Object.values(filters).some(Boolean) || groupFiltered.length !== transactions.length;
  const count = filtered ? `${groupFiltered.length} of ${transactions.length}` : String(transactions.length);
  elements.importHistoryDialogSubtitle.textContent = state.transferReview
    ? `${review.changes.length} proposed change${review.changes.length===1?"":"s"} · ${(review.refundSuggestions || []).length} possible refund${review.refundSuggestions?.length===1?"":"s"} · ${review.alreadyFlagged.length} already reconciled · ${groupFiltered.length} shown. Changes are saved only when you confirm; visibility filters do not affect saving.`
    : `${count} ${
    transactions.length === 1 ? "transaction" : "transactions"
  } imported ${backupDateFormatter.format(new Date(state.importHistoryBatch.createdAt))}`;
  renderImportHistoryFilterChips();
  if (transactions.length === 0) {
    historyBulk.render([], importHistoryTransactionOptions);
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = state.transferReview
      ? "No new transfer or refund matches found. Existing links and manual overrides stay unchanged."
      : "This import no longer contains any transactions.";
    elements.importHistoryTransactions.replaceChildren(empty);
    return;
  }
  historyBulk.render(visible, importHistoryTransactionOptions);
  if (groupFiltered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = review && review.changes.length === 0 && !state.transferReviewFilters.flagged
      ? "No proposed changes. Turn on Already reconciled to review your saved links and exclusions."
      : "No transactions match these filters.";
    elements.importHistoryTransactions.replaceChildren(empty);
    return;
  }
}

async function openImportHistoryBatch(importBatch) {
  state.transferReview = null;
  elements.transferReviewFilters.hidden = true;
  document.querySelector("#transfer-review-footer").hidden = true;
  elements.importHistoryDialog.querySelector("h2").textContent = "Imported transactions";
  elements.importHistoryDialog.querySelector(".eyebrow").textContent = "Import history";
  elements.closeImportHistoryDialog.setAttribute("aria-label", "Close imported transactions");
  historyBulk.reset();
  state.importHistoryBatch = importBatch;
  state.importHistoryTransactions = [];
  state.importHistoryFilters = {
    description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
  };
  configureImportHistoryFilters();
  setImportHistoryFilterPopover(false, false);
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
    configureImportHistoryFilters();
    renderImportHistoryTransactions();
  } catch (error) {
    elements.importHistoryDialogSubtitle.textContent = "";
    elements.importHistoryDialogError.textContent =
      error instanceof Error ? error.message : "Could not load imported transactions.";
    elements.importHistoryDialogError.hidden = false;
  }
}

async function refreshTransferReview(proposed = [], refundLinks = state.transferReview?.refundLinks || []) {
  const previous = state.transferReview;
  const overrides = new Map((previous?.overrides || []).map((row) => [row._id, row]));
  proposed.forEach((row) => overrides.set(row._id, row));
  state.transferReviewBusy = true;
  const confirm = document.querySelector("#confirm-transfer-review");
  confirm.disabled = true;
  try {
    const response = await fetch("/api/internal-transfers/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(previous?.revision ? { revision: previous.revision } : {}), overrides: [...overrides.values()], includeRefunds:true, refundLinks,
        nonzeroDecimal: previous?.nonzeroDecimal ?? Boolean(document.querySelector("#reconciliation-nonzero-decimal")?.checked) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || (response.status === 404
      ? "Restart the Ledger Python server to enable transfer reviews, then try again."
      : "Could not scan internal transfers."));
    if (!Array.isArray(payload.alreadyFlagged)) {
      throw new Error("Restart the Ledger Python server to view already flagged transfers, then scan again.");
    }
    state.transferReview = { ...payload, overrides: [...overrides.values()] };
    state.importHistoryRevision = payload.revision;
    const refundCandidates = new Map((payload.refundSuggestions || []).map(row => [row.id, row._refundCandidates]));
    state.importHistoryTransactions = [...payload.transactions, ...(payload.refundSuggestions || []), ...payload.alreadyFlagged]
      .filter((row,index,rows)=>rows.findIndex(other=>other._id===row._id)===index)
      // Edited rows take precedence, but their matching metadata is additive.
      .map(row => refundCandidates.has(row.id) ? { ...row, _refundCandidates: refundCandidates.get(row.id) } : row);
    state.importHistoryBatch = { transferReview: true };
    configureImportHistoryFilters();
    renderImportHistoryTransactions();
    confirm.textContent = payload.changes.length ? `Save reviewed changes (${payload.changes.length})` : "Finish review";
  } finally {
    state.transferReviewBusy = false;
    confirm.disabled = historyBulk.isActive() || !state.transferReview;
    if (state.transferReview) renderImportHistoryTransactions();
  }
}

async function openTransferReview() {
  if (state.transferReviewBusy) return;
  state.reconciliationRefundChoices.clear();
  state.reconciliationRefundExpanded.clear();
  historyBulk.reset();
  state.transferReview = null;
  state.transferReviewFilters = { proposed: true, flagged: false };
  elements.transferReviewFilters.hidden = true;
  state.importHistoryFilters = { description: "", category: "", subcategory: "", tag: "", group: "", accountName: "", provider: "" };
  elements.importHistorySearch.value = "";
  setImportHistoryFilterPopover(false, false);
  elements.importHistoryDialog.querySelector("h2").textContent = "Review reconciliation";
  elements.importHistoryDialog.querySelector(".eyebrow").textContent = "Proposed changes";
  elements.closeImportHistoryDialog.setAttribute("aria-label", "Cancel transfer review");
  elements.importHistoryDialogSubtitle.textContent = "Scanning all dates…";
  elements.importHistoryDialogError.hidden = true;
  elements.importHistoryTransactions.replaceChildren();
  document.querySelector("#transfer-review-footer").hidden = false;
  if (!elements.importHistoryDialog.open) elements.importHistoryDialog.showModal();
  try { await refreshTransferReview(); }
  catch (error) {
    elements.importHistoryDialogError.textContent = error.message;
    elements.importHistoryDialogError.hidden = false;
  }
}

async function confirmTransferReview() {
  if (!state.transferReview || state.transferReviewBusy || historyBulk.isActive()) return;
  if (!await historyBulk.flushFlags()) return;
  if (!state.transferReview || state.transferReviewBusy) return;
  const review = state.transferReview;
  const button = document.querySelector("#confirm-transfer-review");
  state.transferReviewBusy = true;
  button.disabled = true;
  elements.closeImportHistoryDialog.disabled = true;
  document.querySelector("#cancel-transfer-review").disabled = true;
  elements.importHistoryDialog.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  try {
    const response = await fetch("/api/internal-transfers/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: review.revision, plan: review.plan, overrides: review.overrides, confirm: true, includeRefunds:true, refundLinks:review.refundLinks || [], nonzeroDecimal: review.nonzeroDecimal || false }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not save the transfer review.");
    const status = document.querySelector("#transfer-review-status");
    status.textContent = `${payload.changed} transaction${payload.changed===1?"":"s"} updated · ${payload.transferPairs} transfer pair${payload.transferPairs===1?"":"s"} · ${payload.refundsLinked || 0} refund${payload.refundsLinked===1?"":"s"} linked. ` +
      (payload.changed ? "A safety backup was created. " : "") + "Your dashboards now use saved links.";
    status.hidden = false;
    state.availableTransactions = payload.transactions;
    state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
    state.transferReviewBusy = false;
    closeImportHistoryDialog();
  } catch (error) {
    elements.importHistoryDialogError.textContent = error.message;
    elements.importHistoryDialogError.hidden = false;
  } finally {
    state.transferReviewBusy = false;
    elements.importHistoryDialog.querySelectorAll("button, input, select").forEach((control) => { control.disabled = false; });
    button.disabled = false;
    elements.closeImportHistoryDialog.disabled = false;
    document.querySelector("#cancel-transfer-review").disabled = false;
  }
}

document.querySelector("#find-internal-transfers")?.addEventListener("click", openTransferReview);
document.querySelector("#cancel-transfer-review")?.addEventListener("click", closeImportHistoryDialog);
document.querySelector("#confirm-transfer-review")?.addEventListener("click", confirmTransferReview);

for (const [button, filter] of [
  [elements.transferReviewProposedFilter, "proposed"],
  [elements.transferReviewFlaggedFilter, "flagged"],
]) {
  button?.addEventListener("click", () => {
    if (!state.transferReview || state.transferReviewBusy) return;
    state.transferReviewFilters[filter] = !state.transferReviewFilters[filter];
    renderImportHistoryTransactions();
  });
}

async function closeImportHistoryDialog() {
  if (state.transferReviewBusy) return;
  if (!state.transferReview && !await historyBulk.flushFlags()) return;
  historyBulk.discardFlags();
  state.reconciliationRefundChoices.clear();
  state.reconciliationRefundExpanded.clear();
  state.transferReview = null;
  elements.transferReviewFilters.hidden = true;
  document.querySelector("#transfer-review-footer").hidden = true;
  historyBulk.reset();
  if (elements.importHistoryDialog.open) elements.importHistoryDialog.close();
  state.importHistoryBatch = null;
  state.importHistoryTransactions = [];
}

// One editor/save path for history, staged transfer reviews and unclassified rows.
function openImportHistoryTransactionEditor(transaction, source = "history") {
  const unclassified = source === "unclassified";
  const staged = !unclassified && Boolean(state.transferReview);
  const returnDialog = unclassified ? elements.unclassifiedDialog : elements.importHistoryDialog;
  state.transactionEdit = {
    source, staged, returnDialog, transaction: { ...transaction },
    revision: unclassified ? unclassifiedRevision : state.importHistoryRevision,
  };
  elements.importHistoryEditError.hidden = true;
  elements.importHistoryEditError.textContent = "";
  transactionUi.configureTransactionTagPicker(
    elements.importHistoryEditForm,
    transactionUi.tagsFromTransactions(state.availableTransactions),
  );
  transactionUi.populateTransactionEditor(elements.importHistoryEditForm, transaction, {}, {
    transactions: [...state.availableTransactions, ...state.importHistoryTransactions],
  });
  elements.importHistoryEditForm.querySelector(".dialog-subtitle").textContent = staged
    ? "Changes remain staged until you confirm the reconciliation review."
    : "Changes are saved directly to the master CSV.";
  elements.importHistoryEditForm.querySelector(".eyebrow").textContent = unclassified
    ? "Unclassified transactions" : staged ? "Reconcile" : "Import history";
  if (returnDialog.open) returnDialog.close();
  elements.importHistoryEditDialog.showModal();
  elements.importHistoryEditForm.elements.namedItem("description").focus();
}

function closeImportHistoryTransactionEditor() {
  if (state.importHistoryEditBusy) return;
  finishTransactionEdit();
}

function finishTransactionEdit() {
  const returnDialog = state.transactionEdit?.returnDialog;
  if (elements.importHistoryEditDialog.open) elements.importHistoryEditDialog.close();
  state.transactionEdit = null;
  if (returnDialog && !returnDialog.open) returnDialog.showModal();
}

function setImportHistoryEditBusy(busy) {
  state.importHistoryEditBusy = busy;
  elements.importHistoryEditForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = busy;
  });
  if (!busy) transactionUi.refreshTransactionTagPicker(elements.importHistoryEditForm);
  elements.saveImportHistoryEdit.textContent = busy ? "Saving…" : "Save transaction";
}

async function saveImportHistoryTransaction(event) {
  event.preventDefault();
  const edit = state.transactionEdit;
  if (!edit || state.importHistoryEditBusy) return;
  const { transaction } = edit;
  elements.importHistoryEditError.hidden = true;
  setImportHistoryEditBusy(true);
  try {
    if (edit.staged) {
      await refreshTransferReview([{
        ...transaction,
        ...transactionUi.transactionFromEditor(elements.importHistoryEditForm, transaction),
      }]);
      finishTransactionEdit();
      return;
    }
    const response = await fetch(`/api/transactions/${transaction._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: edit.revision,
        transaction: (edit.source === "unclassified" ? unclassifiedBulk : historyBulk)
          .prepareSave(transactionUi.transactionFromEditor(elements.importHistoryEditForm, transaction), transaction),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not save transaction (${response.status}).`);
    (edit.source === "unclassified" ? unclassifiedBulk : historyBulk).acceptSaved(payload);
    state.availableTransactions = payload.transactions;
    state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
    if (edit.source === "unclassified") {
      updateUnclassifiedTransactions(payload);
      renderUnclassifiedTransactions();
    } else {
      state.importHistoryRevision = payload.revision;
      state.importHistoryTransactions = payload.transactions
        .filter((candidate) => candidate.createdAt === state.importHistoryBatch.createdAt)
        .sort((left, right) => right.date.localeCompare(left.date) || right._id - left._id);
      configureImportHistoryFilters(state.importHistoryFilters);
      renderImportHistoryTransactions();
    }
    finishTransactionEdit();
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
      "Ledger will create a safety backup first. This action removes the entire import batch and its links. Surviving purchases or credits may count toward your budget again.",
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

const UNCLASSIFIED_FILTER_VALUE = "__ledger_unclassified_subcategory__";

function unclassifiedTags(transaction) {
  return String(transaction.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

async function loadAvailableTransactionTags() {
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
    state.availableTransactions = payload.transactions;
    transactionUi.setAvailableGroups(transactionUi.groupsFromTransactions(payload.transactions));
  } catch {
    // Settings remains usable before a transaction database exists.
  }
}

function configureUnclassifiedFilters(filters = unclassifiedFieldFilters) {
  transactionUi.setFlagFilter(elements.unclassifiedFlagged, filters.flagged || "");
  transactionUi.populateGroupFilter(elements.unclassifiedGroup, unclassifiedTransactions, filters.group);
  const unique = (field) => [...new Set(
    unclassifiedTransactions.map((transaction) => transaction[field]).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
  const tags = new Map();
  unclassifiedTransactions.forEach((transaction) => unclassifiedTags(transaction).forEach((tag) => {
    if (!tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
  }));
  const tagValues = [...tags.values()].sort((left, right) => left.localeCompare(right));
  const selectedTag = tagValues.find(
    (tag) => tag.toLocaleLowerCase() === String(filters.tag || "").toLocaleLowerCase(),
  ) || "";
  elements.unclassifiedSearch.value = filters.description || "";
  populateUnclassifiedFilter(elements.unclassifiedCategory, unique("category"), "All categories");
  populateUnclassifiedFilter(elements.unclassifiedAccount, unique("accountName"), "All accounts");
  populateUnclassifiedFilter(elements.unclassifiedProvider, unique("provider"), "All providers");
  populateUnclassifiedFilter(
    elements.unclassifiedTag,
    tagValues,
    "All tags",
  );
  populateUnclassifiedFilter(elements.unclassifiedSubcategory, [], "All subcategories");
  if (unclassifiedTransactions.length > 0) {
    const option = document.createElement("option");
    option.value = UNCLASSIFIED_FILTER_VALUE;
    option.textContent = "Unclassified";
    elements.unclassifiedSubcategory.append(option);
  }
  elements.unclassifiedCategory.value = unique("category").includes(filters.category) ? filters.category : "";
  elements.unclassifiedAccount.value = unique("accountName").includes(filters.accountName) ? filters.accountName : "";
  elements.unclassifiedProvider.value = unique("provider").includes(filters.provider) ? filters.provider : "";
  elements.unclassifiedTag.value = selectedTag;
  elements.unclassifiedSubcategory.value = filters.subcategory === UNCLASSIFIED_FILTER_VALUE
    ? UNCLASSIFIED_FILTER_VALUE
    : "";
  unclassifiedFieldFilters = {
    flagged: transactionUi.flagFilterValue(elements.unclassifiedFlagged),
    description: elements.unclassifiedSearch.value.trim(),
    group: elements.unclassifiedGroup.value,
    category: elements.unclassifiedCategory.value,
    subcategory: elements.unclassifiedSubcategory.value,
    tag: elements.unclassifiedTag.value,
    accountName: elements.unclassifiedAccount.value,
    provider: elements.unclassifiedProvider.value,
  };
  renderUnclassifiedFilterChips();
}

function unclassifiedFilterDraft() {
  return {
    flagged: transactionUi.flagFilterValue(elements.unclassifiedFlagged),
    group: elements.unclassifiedGroup.value,
    category: elements.unclassifiedCategory.value,
    subcategory: elements.unclassifiedSubcategory.value,
    tag: elements.unclassifiedTag.value,
    accountName: elements.unclassifiedAccount.value,
    provider: elements.unclassifiedProvider.value,
  };
}

function renderUnclassifiedFilterChips() {
  const definitions = [
    ["flagged", "Flag status"],
    ["group", "Group"],
    ["category", "Category"], ["subcategory", "Subcategory"], ["tag", "Tag"],
    ["accountName", "Account"], ["provider", "Provider"],
  ];
  const active = definitions.filter(([field]) => unclassifiedFieldFilters[field]);
  elements.unclassifiedFilterCount.textContent = String(active.length);
  elements.unclassifiedFilterCount.hidden = active.length === 0;
  elements.unclassifiedFilterButton.classList.toggle("has-active-filters", active.length > 0);
  elements.unclassifiedActiveFilters.hidden = active.length === 0;
  elements.unclassifiedFilterChips.replaceChildren(...active.map(([field, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "transaction-filter-chip";
    const value = field === "flagged" ? transactionUi.flagFilterLabel(unclassifiedFieldFilters[field]) : field === "subcategory" ? "Unclassified" : field === "group" ? transactionUi.groupFilterLabel(unclassifiedFieldFilters[field]) : unclassifiedFieldFilters[field];
    chip.textContent = `${label}: ${value} ×`;
    chip.setAttribute("aria-label", `Remove ${label.toLocaleLowerCase()} filter ${value}`);
    chip.addEventListener("click", () => {
      unclassifiedFieldFilters[field] = "";
      configureUnclassifiedFilters(unclassifiedFieldFilters);
      renderUnclassifiedTransactions();
    });
    return chip;
  }));
}

function setUnclassifiedFilterPopover(open, restore = true) {
  if (!open && restore) configureUnclassifiedFilters(unclassifiedFieldFilters);
  transactionUi.setTransactionFilterPanel(elements.unclassifiedFilterPopover, elements.unclassifiedFilterButton, open);
}

function renderUnclassifiedTransactions() {
  unclassifiedFieldFilters.description = elements.unclassifiedSearch.value.trim();
  const visible = transactionUi.sortTransactions(
    unclassifiedTransactions.filter((transaction) =>
      (showUnclassifiedInternalTransfers || !transactionUi.isInternalTransfer(transaction))
      && transactionUi.matchesTransactionSearch(transaction, unclassifiedFieldFilters.description)
      && transactionUi.matchesFlagFilter(transaction, unclassifiedFieldFilters.flagged)
      && (!unclassifiedFieldFilters.category || transaction.category === unclassifiedFieldFilters.category)
      && (!unclassifiedFieldFilters.subcategory || !transaction.subcategory)
      && (!unclassifiedFieldFilters.tag || unclassifiedTags(transaction).some(
        (tag) => tag.toLocaleLowerCase() === unclassifiedFieldFilters.tag.toLocaleLowerCase(),
      ))
      && (!unclassifiedFieldFilters.accountName || transaction.accountName === unclassifiedFieldFilters.accountName)
      && (!unclassifiedFieldFilters.provider || transaction.provider === unclassifiedFieldFilters.provider),
    ),
    unclassifiedSort.value(),
  );
  const groupFiltered = unclassifiedBulk.filter(visible);
  const filtered = !showUnclassifiedInternalTransfers
    || groupFiltered.length !== unclassifiedTransactions.length
    || Object.values(unclassifiedFieldFilters).some(Boolean);
  elements.unclassifiedSummary.textContent = filtered
    ? `${groupFiltered.length} of ${unclassifiedTransactions.length} transactions`
    : `${unclassifiedTransactions.length} ${unclassifiedTransactions.length === 1 ? "transaction" : "transactions"}`;
  renderUnclassifiedFilterChips();
  unclassifiedBulk.render(visible, (transaction) => ({
    currency: currencyFormatter, shortMonthFormatter: unclassifiedMonthFormatter,
    needsClassification: !transactionUi.isInternalTransfer(transaction),
    onEdit: () => openImportHistoryTransactionEditor(transaction, "unclassified"),
  }));
  if (groupFiltered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-transaction-list";
    empty.textContent = unclassifiedTransactions.length
      ? "No transactions match these filters."
      : "Every transaction has a subcategory.";
    elements.unclassifiedList.replaceChildren(empty);
    return;
  }
}

async function openUnclassifiedDialog() {
  unclassifiedBulk.reset();
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
    state.availableTransactions = payload.transactions;
    unclassifiedRevision = payload.revision;
    unclassifiedTransactions = payload.transactions
      .filter((transaction) => !transaction.subcategory)
      .sort((left, right) => right.date.localeCompare(left.date)
        || right.description.localeCompare(left.description));
    unclassifiedFieldFilters = {
      description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
    };
    showUnclassifiedInternalTransfers = false;
    elements.unclassifiedInternalTransferFilter.setAttribute("aria-pressed", "false");
    configureUnclassifiedFilters(unclassifiedFieldFilters);
    setUnclassifiedFilterPopover(false);
    renderUnclassifiedTransactions();
  } catch (error) {
    elements.unclassifiedError.textContent =
      error instanceof Error ? error.message : "Could not load unclassified transactions.";
    elements.unclassifiedError.hidden = false;
    elements.unclassifiedSummary.textContent = "";
  }
}

async function closeUnclassifiedDialog() {
  if (!await unclassifiedBulk.flushFlags()) return;
  unclassifiedBulk.reset();
  setUnclassifiedFilterPopover(false);
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

function renderClassificationPreviewChanges() {
  if (!pendingClassificationPreview) return;
  const changes = transactionUi.sortTransactions(
    pendingClassificationPreview.changes.map((entry) => entry.transaction)
      .filter((transaction) => transactionUi.matchesFlagFilter(transaction, classificationPreviewFlagged)),
    classificationPreviewSort.value(),
  );
  transactionUi.populateGroupFilter(elements.previewGroupFilter,
    pendingClassificationPreview.changes.map((entry) => entry.transaction), classificationPreviewGroup);
  transactionUi.setFlagFilter(elements.previewFlaggedFilter, classificationPreviewFlagged);
  const filterCount = Number(!!classificationPreviewGroup) + Number(!!classificationPreviewFlagged);
  elements.previewFilterCount.textContent = String(filterCount);
  elements.previewFilterCount.hidden = !filterCount;
  elements.previewFilterButton.classList.toggle("has-active-filters", !!filterCount);
  classificationBulk.render(changes, (transaction) => ({
    currency: currencyFormatter, shortMonthFormatter: unclassifiedMonthFormatter,
    showEdit: false, onEdit: () => {},
  }));
}

function closeClassificationPreview() {
  classificationBulk.discardFlags();
  if (classificationsBusy) return;
  classificationBulk.reset();
  classificationPreviewGroup = "";
  classificationPreviewFlagged = "";
  transactionUi.setTransactionFilterPanel(elements.previewFilters, elements.previewFilterButton, false);
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
    classificationPreviewGroup = "";
    classificationPreviewFlagged = "";
    transactionUi.setTransactionFilterPanel(elements.previewFilters, elements.previewFilterButton, false);
    classificationBulk.reset();
    const matched = preview.matched || preview.changed;
    const unchangedMatches = Math.max(0, matched - preview.changed);
    elements.previewSummary.textContent =
      `${matched} matched · ${preview.changed} will be modified · ` +
      `${unchangedMatches} already have the selected values.`;
    elements.previewError.hidden = true;
    elements.previewError.textContent = "";
    elements.confirmPreview.textContent = `Apply changes (${preview.changed})`;
    renderClassificationPreviewChanges();
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
  if (!await classificationBulk.flushFlags()) return;
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
        overrides: pendingClassificationPreview.changes.filter((entry) => entry.bulkEdited)
          .map((entry) => ({ _id: entry._id, transaction: entry.transaction })),
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

function taxonomyPlural(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function setTaxonomyStatus(message, kind = "success") {
  elements.taxonomyStatus.textContent = message;
  elements.taxonomyStatus.className = `settings-status settings-status--${kind}`;
  elements.taxonomyStatus.hidden = false;
}

function taxonomyDocument() {
  return {
    version: 1,
    categories: state.taxonomy.categories.map((category) => ({
      name: category.name,
      subcategories: category.subcategories.map((subcategory) => subcategory.name),
    })),
  };
}

function createTaxonomyInlineForm(mode, parentCategory = "") {
  const addingCategory = mode === "category";
  const form = document.createElement("form");
  form.className = addingCategory
    ? "taxonomy-category-card taxonomy-category-card--create"
    : "taxonomy-inline-create taxonomy-inline-create--subcategory";
  form.setAttribute(
    "aria-label",
    addingCategory ? "Add category" : `Add a subcategory under ${parentCategory}`,
  );

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 500;
  input.autocomplete = "off";
  input.required = true;
  const inputLabel = addingCategory ? "Category name" : "Subcategory name";
  input.setAttribute("placeholder", inputLabel);
  input.setAttribute("aria-label", inputLabel);
  input.disabled = state.taxonomyBusy;

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "+";
  button.setAttribute(
    "aria-label",
    addingCategory ? "Add category" : `Add subcategory under ${parentCategory}`,
  );
  button.disabled = true;
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    button.disabled = state.taxonomyBusy || !input.value.trim();
  });
  form.append(input, button);
  form.addEventListener("submit", (event) => (
    saveTaxonomyEntry(event, mode, parentCategory, input, button)
  ));
  return form;
}

function renderTaxonomy() {
  if (!elements.taxonomyTree) return;
  const query = elements.taxonomySearch.value.trim().toLocaleLowerCase();
  const cards = [];
  let visibleSubcategoryCount = 0;
  for (const category of state.taxonomy.categories) {
    if (
      state.hideTaxonomyCategoriesWithoutSubcategories
      && category.subcategories.length === 0
    ) continue;
    const categoryMatches = category.name.toLocaleLowerCase().includes(query);
    const subcategories = category.subcategories.filter(
      (subcategory) => !query || categoryMatches || subcategory.name.toLocaleLowerCase().includes(query),
    );
    if (query && !categoryMatches && subcategories.length === 0) continue;
    visibleSubcategoryCount += subcategories.length;

    const card = document.createElement("article");
    card.className = "taxonomy-category-card";
    card.dataset.category = category.name;

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = category.name;
    const count = document.createElement("span");
    count.textContent = taxonomyPlural(category.transactionCount, "transaction");
    heading.append(name, count);
    const deleteCategory = document.createElement("button");
    deleteCategory.className = "taxonomy-delete-button taxonomy-delete-category";
    deleteCategory.type = "button";
    deleteCategory.textContent = "Delete";
    deleteCategory.setAttribute("aria-label", `Delete category ${category.name}`);
    deleteCategory.disabled = state.taxonomyBusy || category.transactionCount > 0;
    deleteCategory.title = category.transactionCount > 0
      ? `${taxonomyPlural(category.transactionCount, "transaction")} must be reclassified before this category can be deleted.`
      : `Delete ${category.name}`;
    deleteCategory.addEventListener("click", () => deleteTaxonomyEntry("category", category.name));
    header.append(heading, deleteCategory);

    const list = document.createElement("div");
    list.className = "taxonomy-subcategory-list";
    if (subcategories.length === 0) {
      const empty = document.createElement("p");
      empty.className = "taxonomy-subcategory-empty";
      empty.textContent = query ? "No matching subcategories." : "No subcategories yet.";
      list.append(empty);
    } else {
      for (const subcategory of subcategories) {
        const chip = document.createElement("div");
        chip.className = "taxonomy-subcategory";
        const subcategoryName = document.createElement("span");
        subcategoryName.textContent = subcategory.name;
        const subcategoryCount = document.createElement("small");
        subcategoryCount.textContent = String(subcategory.transactionCount);
        subcategoryCount.title = taxonomyPlural(subcategory.transactionCount, "transaction");
        const deleteSubcategory = document.createElement("button");
        deleteSubcategory.className = "taxonomy-delete-button taxonomy-delete-subcategory";
        deleteSubcategory.type = "button";
        deleteSubcategory.textContent = "×";
        deleteSubcategory.setAttribute(
          "aria-label",
          `Delete subcategory ${subcategory.name} from ${category.name}`,
        );
        deleteSubcategory.disabled = state.taxonomyBusy || subcategory.transactionCount > 0;
        deleteSubcategory.title = subcategory.transactionCount > 0
          ? `${taxonomyPlural(subcategory.transactionCount, "transaction")} must be reclassified before this subcategory can be deleted.`
          : `Delete ${subcategory.name}`;
        deleteSubcategory.addEventListener("click", () => (
          deleteTaxonomyEntry("subcategory", subcategory.name, category.name)
        ));
        chip.append(subcategoryName, subcategoryCount, deleteSubcategory);
        list.append(chip);
      }
    }
    list.append(createTaxonomyInlineForm("subcategory", category.name));
    card.append(header, list);
    cards.push(card);
  }

  const totalSubcategories = state.taxonomy.categories.reduce(
    (total, category) => total + category.subcategories.length,
    0,
  );
  elements.taxonomySummary.textContent = query
    ? `${taxonomyPlural(cards.length, "category", "categories")} · ${taxonomyPlural(visibleSubcategoryCount, "subcategory", "subcategories")} shown`
    : state.hideTaxonomyCategoriesWithoutSubcategories
      ? `${taxonomyPlural(cards.length, "category", "categories")} shown · ${taxonomyPlural(totalSubcategories, "subcategory", "subcategories")}`
      : `${taxonomyPlural(state.taxonomy.categories.length, "category", "categories")} · ${taxonomyPlural(totalSubcategories, "subcategory", "subcategories")}`;
  if (cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "backup-empty taxonomy-empty";
    empty.textContent = query
      ? "No categories or subcategories match your search."
      : "No categories yet. Add one here or import transactions with a category.";
    cards.push(empty);
  }
  cards.push(createTaxonomyInlineForm("category"));
  elements.taxonomyTree.replaceChildren(...cards);
  elements.taxonomySubcategoryFilter.setAttribute(
    "aria-pressed",
    String(state.hideTaxonomyCategoriesWithoutSubcategories),
  );
}

async function loadTaxonomy() {
  if (!elements.taxonomyTree || state.taxonomyBusy) return;
  state.taxonomyBusy = true;
  renderTaxonomy();
  try {
    const response = await fetch("/api/taxonomy", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not load taxonomy (${response.status}).`);
    state.taxonomy = { version: payload.version, categories: payload.categories };
    transactionUi.setEditorTaxonomy(payload.categories);
    state.taxonomyRevision = payload.revision;
  } catch (error) {
    setTaxonomyStatus(error instanceof Error ? error.message : "Could not load taxonomy.", "error");
  } finally {
    state.taxonomyBusy = false;
    renderTaxonomy();
  }
}

async function saveTaxonomyEntry(event, mode, parentCategory, input, button) {
  event.preventDefault();
  if (state.taxonomyBusy) return;
  const name = input.value.replace(/\s+/g, " ").trim();
  if (!name) {
    input.setCustomValidity("Enter a name.");
    input.reportValidity();
    return;
  }

  const document = taxonomyDocument();
  if (mode === "category") {
    if (document.categories.some((category) => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      input.setCustomValidity(`The category “${name}” already exists.`);
      input.reportValidity();
      return;
    }
    document.categories.push({ name, subcategories: [] });
  } else {
    const category = document.categories.find(
      (candidate) => candidate.name.toLocaleLowerCase() === parentCategory.toLocaleLowerCase(),
    );
    if (!category) {
      input.setCustomValidity("That category is no longer available. Refresh and try again.");
      input.reportValidity();
      return;
    }
    if (category.subcategories.some((subcategory) => subcategory.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      input.setCustomValidity(`The subcategory “${name}” already exists under ${category.name}.`);
      input.reportValidity();
      return;
    }
    category.subcategories.push(name);
  }

  state.taxonomyBusy = true;
  input.disabled = true;
  button.disabled = true;
  let saved = false;
  try {
    const response = await fetch("/api/taxonomy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...document, revision: state.taxonomyRevision }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not save taxonomy (${response.status}).`);
    state.taxonomy = { version: payload.version, categories: payload.categories };
    transactionUi.setEditorTaxonomy(payload.categories);
    state.taxonomyRevision = payload.revision;
    elements.taxonomySearch.value = "";
    if (mode === "category") state.hideTaxonomyCategoriesWithoutSubcategories = false;
    setTaxonomyStatus(
      mode === "category"
        ? `Added category “${name}”.`
        : `Added subcategory “${name}” under ${parentCategory}.`,
    );
    saved = true;
  } catch (error) {
    setTaxonomyStatus(error instanceof Error ? error.message : "Could not save taxonomy.", "error");
  } finally {
    state.taxonomyBusy = false;
    if (saved) {
      renderTaxonomy();
    } else {
      input.disabled = false;
      button.disabled = !input.value.trim();
      input.focus();
    }
  }
}

async function deleteTaxonomyEntry(mode, name, parentCategory = "") {
  if (state.taxonomyBusy) return;
  const category = state.taxonomy.categories.find((candidate) => (
    candidate.name.toLocaleLowerCase() === (mode === "category" ? name : parentCategory).toLocaleLowerCase()
  ));
  if (!category) {
    setTaxonomyStatus("That taxonomy value is no longer available. Refresh and try again.", "error");
    return;
  }

  const subcategory = mode === "subcategory"
    ? category.subcategories.find((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    : null;
  const transactionCount = mode === "category"
    ? category.transactionCount
    : subcategory?.transactionCount;
  if (typeof transactionCount !== "number") {
    setTaxonomyStatus("That taxonomy value is no longer available. Refresh and try again.", "error");
    return;
  }
  if (transactionCount > 0) {
    setTaxonomyStatus(
      `${taxonomyPlural(transactionCount, "transaction")} must be reclassified before “${name}” can be deleted.`,
      "error",
    );
    return;
  }

  const childCount = mode === "category" ? category.subcategories.length : 0;
  const confirmed = window.confirm(
    mode === "category"
      ? `Delete category “${name}”${childCount ? ` and its ${taxonomyPlural(childCount, "subcategory", "subcategories")}` : ""}?\n\nThis removes the saved taxonomy value and cannot be undone. Transactions are not changed.`
      : `Delete subcategory “${name}” from ${parentCategory}?\n\nThis removes the saved taxonomy value and cannot be undone. Transactions are not changed.`,
  );
  if (!confirmed) return;

  const document = taxonomyDocument();
  if (mode === "category") {
    document.categories = document.categories.filter(
      (candidate) => candidate.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
    );
  } else {
    const documentCategory = document.categories.find(
      (candidate) => candidate.name.toLocaleLowerCase() === parentCategory.toLocaleLowerCase(),
    );
    if (!documentCategory) {
      setTaxonomyStatus("That category is no longer available. Refresh and try again.", "error");
      return;
    }
    documentCategory.subcategories = documentCategory.subcategories.filter(
      (candidate) => candidate.toLocaleLowerCase() !== name.toLocaleLowerCase(),
    );
  }

  state.taxonomyBusy = true;
  renderTaxonomy();
  try {
    const response = await fetch("/api/taxonomy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...document, revision: state.taxonomyRevision }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not delete taxonomy value (${response.status}).`);
    state.taxonomy = { version: payload.version, categories: payload.categories };
    transactionUi.setEditorTaxonomy(payload.categories);
    state.taxonomyRevision = payload.revision;
    setTaxonomyStatus(
      mode === "category"
        ? `Deleted category “${name}”.`
        : `Deleted subcategory “${name}” from ${parentCategory}.`,
    );
  } catch (error) {
    setTaxonomyStatus(error instanceof Error ? error.message : "Could not delete taxonomy value.", "error");
  } finally {
    state.taxonomyBusy = false;
    renderTaxonomy();
  }
}

if (elements.exportForm) {
  const importLookback = document.querySelector("#import-lookback");
  const importRefunds = document.querySelector("#import-match-refunds");
  if (importLookback && importRefunds && window.LedgerPreferences?.imports) {
    const renderImportPreferences = () => {
      const preferences = window.LedgerPreferences.imports();
      importLookback.value = preferences.lookback;
      importRefunds.checked = preferences.matchRefunds;
    };
    renderImportPreferences();
    importLookback.addEventListener("change", () => window.LedgerPreferences.setImports({ lookback: importLookback.value }));
    importRefunds.addEventListener("change", () => window.LedgerPreferences.setImports({ matchRefunds: importRefunds.checked }));
    window.addEventListener("ledger-import-preferences-change", renderImportPreferences);
  }
  if (elements.darkModeToggle && window.LedgerTheme) {
    elements.darkModeToggle.checked = window.LedgerTheme.isDark();
    elements.darkModeToggle.addEventListener("change", () => {
      window.LedgerTheme.setDark(elements.darkModeToggle.checked);
    });
    window.addEventListener("ledger-theme-change", (event) => {
      elements.darkModeToggle.checked = event.detail.theme === "dark";
    });
  }
  if (elements.numberAbbreviationThreshold && window.LedgerPreferences) {
    renderNumberAbbreviationPreference(window.LedgerPreferences.numberAbbreviation());
    elements.numberAbbreviationThreshold.addEventListener("input", () => {
      const option = NUMBER_ABBREVIATION_OPTIONS[Number(elements.numberAbbreviationThreshold.value)];
      renderNumberAbbreviationPreference(window.LedgerPreferences.setNumberAbbreviation(option?.value));
    });
    window.addEventListener("ledger-number-abbreviation-change", (event) => {
      renderNumberAbbreviationPreference(event.detail.value);
    });
  }
  elements.exportForm.addEventListener("submit", exportTransactions);
  elements.exportStartDate.addEventListener("change", renderExportSummary);
  elements.exportEndDate.addEventListener("change", renderExportSummary);
  elements.refreshImportHistory.addEventListener("click", loadImportHistory);
  elements.importHistorySearch.addEventListener("input", () => {
    state.importHistoryFilters.description = elements.importHistorySearch.value.trim();
    renderImportHistoryTransactions();
  });
  elements.importHistoryFilterButton.addEventListener("click", () => {
    const open = elements.importHistoryFilterButton.getAttribute("aria-expanded") !== "true";
    setImportHistoryFilterPopover(open);
    if (open) elements.importHistoryCategory.focus();
  });
  elements.importHistoryCategory.addEventListener("change", () => {
    populateImportHistorySubcategories(
      elements.importHistoryCategory.value,
      elements.importHistorySubcategory.value,
    );
  });
  elements.resetImportHistoryFilters.addEventListener("click", () => {
    transactionUi.setFlagFilter(elements.importHistoryFlagged, "");
    elements.importHistoryGroup.value = "";
    elements.importHistoryCategory.value = "";
    populateImportHistorySubcategories("");
    elements.importHistoryTag.value = "";
    elements.importHistoryAccount.value = "";
    elements.importHistoryProvider.value = "";
    elements.importHistoryCategory.focus();
  });
  transactionUi.bindLiveTransactionFilters(elements.importHistoryFilterPopover, () => {
    state.importHistoryFilters = { ...state.importHistoryFilters, ...importHistoryFilterDraft() };
    renderImportHistoryTransactions();
  }, elements.resetImportHistoryFilters);
  elements.clearImportHistoryFilters.addEventListener("click", () => {
    state.importHistoryFilters = {
      ...state.importHistoryFilters,
      flagged: "",
      group: "",
      category: "", subcategory: "", tag: "", accountName: "", provider: "",
    };
    configureImportHistoryFilters(state.importHistoryFilters);
    renderImportHistoryTransactions();
    elements.importHistoryFilterButton.focus();
  });

  elements.importHistoryDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.importHistoryFilterButton.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      event.stopPropagation();
      setImportHistoryFilterPopover(false);
      elements.importHistoryFilterButton.focus();
    }
  });
  elements.previousImportHistoryPage.addEventListener("click", () => {
    if (state.importHistoryPage === 0) return;
    state.importHistoryPage -= 1;
    renderImportHistory(state.importHistoryImports);
  });
  elements.nextImportHistoryPage.addEventListener("click", () => {
    const pageCount = Math.ceil(state.importHistoryImports.length / IMPORT_HISTORY_PAGE_SIZE);
    if (state.importHistoryPage + 1 >= pageCount) return;
    state.importHistoryPage += 1;
    renderImportHistory(state.importHistoryImports);
  });
  elements.closeImportHistoryDialog.addEventListener("click", closeImportHistoryDialog);
  elements.importHistoryDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImportHistoryDialog();
  });
  elements.importHistoryDialog.addEventListener("click", (event) => {
    if (event.target === elements.importHistoryDialog) closeImportHistoryDialog();
  });
  elements.taxonomySearch.addEventListener("input", renderTaxonomy);
  elements.taxonomySubcategoryFilter.addEventListener("click", () => {
    state.hideTaxonomyCategoriesWithoutSubcategories =
      !state.hideTaxonomyCategoriesWithoutSubcategories;
    renderTaxonomy();
  });
  initializeSettingsTabs();
  loadExportTransactions();
  loadAvailableTransactionTags();
}

// The editor exists on both Settings and Classifications, independently of history.
if (elements.importHistoryEditForm) {
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
  elements.unclassifiedSearch.addEventListener("input", () => {
  unclassifiedFieldFilters.description = elements.unclassifiedSearch.value.trim();
  renderUnclassifiedTransactions();
  });
  elements.unclassifiedFilterButton.addEventListener("click", () => {
  const open = elements.unclassifiedFilterButton.getAttribute("aria-expanded") !== "true";
  setUnclassifiedFilterPopover(open);
  if (open) elements.unclassifiedCategory.focus();
  });
  elements.resetUnclassifiedFilters.addEventListener("click", () => {
  transactionUi.setFlagFilter(elements.unclassifiedFlagged, "");
  elements.unclassifiedGroup.value = "";
  elements.unclassifiedCategory.value = "";
  elements.unclassifiedSubcategory.value = "";
  elements.unclassifiedTag.value = "";
  elements.unclassifiedAccount.value = "";
  elements.unclassifiedProvider.value = "";
  elements.unclassifiedCategory.focus();
  });
  transactionUi.bindLiveTransactionFilters(elements.unclassifiedFilterPopover, () => {
  unclassifiedFieldFilters = { ...unclassifiedFieldFilters, ...unclassifiedFilterDraft() };
  renderUnclassifiedTransactions();
  }, elements.resetUnclassifiedFilters);
  elements.clearUnclassifiedFilters.addEventListener("click", () => {
  unclassifiedFieldFilters = {
    ...unclassifiedFieldFilters,
    flagged: "",
    group: "",
    category: "", subcategory: "", tag: "", accountName: "", provider: "",
  };
  configureUnclassifiedFilters(unclassifiedFieldFilters);
  renderUnclassifiedTransactions();
  elements.unclassifiedFilterButton.focus();
  });
  elements.unclassifiedInternalTransferFilter.addEventListener("click", () => {
  showUnclassifiedInternalTransfers = !showUnclassifiedInternalTransfers;
  elements.unclassifiedInternalTransferFilter.setAttribute(
    "aria-pressed",
    String(showUnclassifiedInternalTransfers),
  );
  renderUnclassifiedTransactions();
  });

  elements.unclassifiedDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.unclassifiedFilterButton.getAttribute("aria-expanded") === "true") {
    event.preventDefault();
    event.stopPropagation();
    setUnclassifiedFilterPopover(false);
    elements.unclassifiedFilterButton.focus();
  }
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
  elements.previewFilterButton.addEventListener("click", () => {
    transactionUi.setTransactionFilterPanel(elements.previewFilters, elements.previewFilterButton, elements.previewFilters.hidden);
    transactionUi.populateGroupFilter(elements.previewGroupFilter,
      pendingClassificationPreview?.changes.map((entry) => entry.transaction) || [], classificationPreviewGroup);
    if (!elements.previewFilters.hidden) elements.previewGroupFilter.focus();
  });
  document.querySelector("#reset-classification-preview-filters").addEventListener("click", () => {
    transactionUi.setFlagFilter(elements.previewFlaggedFilter, "");
    elements.previewGroupFilter.value = "";
  });
  transactionUi.bindLiveTransactionFilters(elements.previewFilters, () => {
    classificationPreviewGroup = elements.previewGroupFilter.value;
    classificationPreviewFlagged = transactionUi.flagFilterValue(elements.previewFlaggedFilter);
    renderClassificationPreviewChanges();
  }, document.querySelector("#reset-classification-preview-filters"));

  elements.previewDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.previewFilters.hidden) {
      event.preventDefault(); event.stopPropagation();
      transactionUi.setTransactionFilterPanel(elements.previewFilters, elements.previewFilterButton, false);
      elements.previewFilterButton.focus();
    }
  });
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
