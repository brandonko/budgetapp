"use strict";
const transactionUi = window.LedgerTransactionUI;
void transactionUi.loadEditorTaxonomy();

const state = {
  extensionReady: false,
  extensionVersion: "",
  aliExpressExtensionReady: false,
  amazonSessionToken: "",
  amazonPollTimer: null,
  creditKarmaSessionToken: "",
  creditKarmaPollTimer: null,
  aliExpressSessionToken: "",
  aliExpressPollTimer: null,
  aliExpressStartedAt: 0,
  venmoExtensionReady: false,
  venmoSessionToken: "",
  venmoPollTimer: null,
  venmoStartedAt: 0,
  ebayExtensionReady: false,
  ebaySessionToken: "",
  ebayPollTimer: null,
  ebayStartedAt: 0,
  walmartExtensionReady: false,
  walmartSessionToken: "",
  walmartPollTimer: null,
  walmartStartedAt: 0,
  walmartBusy: false,
  capitalOneExtensionReady: false,
  capitalOneSessionToken: "",
  capitalOnePollTimer: null,
  capitalOneStartedAt: 0,
  capitalOneBusy: false,
  schwabExtensionReady: false,
  schwabSessionToken: "",
  schwabPollTimer: null,
  schwabStartedAt: 0,
  schwabBusy: false,
  appleCardBusy: false,
  appleCardExtensionReady: false,
  appleCardSessionToken: "",
  appleCardPollTimer: null,
  appleCardStartedAt: 0,
  csvImportBusy: false,
  revision: "",
  importedTransactions: [],
  reviewEditedIds: new Set(),
  refundSelections: new Map(),
  refundDetailsOpen: new Set(),
  refundCandidateChoices: new Map(),
  reviewSession: null,
  reviewCommitted: false,
  reviewCommitting: false,
  reviewRefreshing: false,
  reviewValidationFailed: false,
  reviewGeneration: 0,
  transferPlan: null,
  existingTransferUpdates: [],
  reviewFilters: {
    duplicate: false,
    unmatched: true,
    new: true,
  },
  reviewFieldFilters: {
    description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
  },
  editingImportedIndex: null,
  editBusy: false,
  availableTransactionTags: [],
  availableTransactions: [],
};

const sourceLabels = { creditkarma: "Credit Karma", amazon: "Amazon", aliexpress: "AliExpress", venmo: "Venmo", ebay: "eBay", walmart: "Walmart", applecard: "Apple Card", capitalone: "Capital One", schwab: "Schwab Checking", csv: "CSV" };
const MIN_WALMART_EXTENSION_VERSION = "0.9.1";
const MIN_SCHWAB_EXTENSION_VERSION = "0.11.0";
const MIN_CAPITAL_ONE_EXTENSION_VERSION = "0.9.1";
const MIN_ALIEXPRESS_EXTENSION_VERSION = "0.4.0";
const MIN_VENMO_EXTENSION_VERSION = "0.5.0";
const MIN_APPLE_CARD_EXTENSION_VERSION = "0.6.2";
const MIN_EBAY_EXTENSION_VERSION = "0.7.0";
const extensionMessageSources = new Set(["ledger-data-importer", "ledger-amazon-extension"]);
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const elements = {
  capitalOneStartDate: document.querySelector("#capitalone-start-date"),
  capitalOneEndDate: document.querySelector("#capitalone-end-date"),
  capitaloneAccountName: document.querySelector("#capitalone-account-name"),
  capitaloneAccountType: document.querySelector("#capitalone-account-type"),
  capitaloneProvider: document.querySelector("#capitalone-provider"),
  capitalOneImportButton: document.querySelector("#capitalone-import-button"),
  capitalOneCancelButton: document.querySelector("#capitalone-cancel-button"),
  capitalOneProgress: document.querySelector("#capitalone-progress"),
  capitalOneProgressBar: document.querySelector("#capitalone-progress-bar"),
  capitalOneProgressMessage: document.querySelector("#capitalone-progress-message"),
  capitalOneError: document.querySelector("#capitalone-error"),
  capitalOneFile: document.querySelector("#capitalone-file"),
  capitalOneFileButton: document.querySelector("#capitalone-file-import-button"),
  schwabStartDate: document.querySelector("#schwab-start-date"),
  schwabEndDate: document.querySelector("#schwab-end-date"),
  schwabAccountName: document.querySelector("#schwab-account-name"),
  schwabAccountType: document.querySelector("#schwab-account-type"),
  schwabProvider: document.querySelector("#schwab-provider"),
  schwabImportButton: document.querySelector("#schwab-import-button"),
  schwabCancelButton: document.querySelector("#schwab-cancel-button"),
  schwabProgress: document.querySelector("#schwab-progress"),
  schwabProgressBar: document.querySelector("#schwab-progress-bar"),
  schwabProgressMessage: document.querySelector("#schwab-progress-message"),
  schwabError: document.querySelector("#schwab-error"),
  amazonStartDate: document.querySelector("#amazon-start-date"),
  amazonEndDate: document.querySelector("#amazon-end-date"),
  amazonAccountName: document.querySelector("#amazon-account-name"),
  amazonAccountType: document.querySelector("#amazon-account-type"),
  amazonProvider: document.querySelector("#amazon-provider"),
  amazonImportButton: document.querySelector("#amazon-import-button"),
  amazonCancelButton: document.querySelector("#amazon-cancel-button"),
  amazonProgress: document.querySelector("#amazon-progress"),
  amazonProgressBar: document.querySelector("#amazon-progress-bar"),
  amazonProgressMessage: document.querySelector("#amazon-progress-message"),
  amazonDirectError: document.querySelector("#amazon-direct-error"),
  extensionDot: document.querySelector("#extension-dot"),
  extensionStatus: document.querySelector("#extension-status"),
  extensionHelp: document.querySelector("#extension-help"),
  creditKarmaStartDate: document.querySelector("#creditkarma-start-date"),
  creditKarmaEndDate: document.querySelector("#creditkarma-end-date"),
  creditKarmaIgnoreAmazon: document.querySelector("#creditkarma-ignore-amazon"),
  creditKarmaIgnoreAliExpress: document.querySelector("#creditkarma-ignore-aliexpress"),
  creditKarmaIgnoreVenmo: document.querySelector("#creditkarma-ignore-venmo"),
  creditKarmaIgnoreEbay: document.querySelector("#creditkarma-ignore-ebay"),
  creditKarmaIgnoreWalmart: document.querySelector("#creditkarma-ignore-walmart"),
  creditKarmaImportButton: document.querySelector("#creditkarma-import-button"),
  creditKarmaCancelButton: document.querySelector("#creditkarma-cancel-button"),
  creditKarmaProgress: document.querySelector("#creditkarma-progress"),
  creditKarmaProgressBar: document.querySelector("#creditkarma-progress-bar"),
  creditKarmaProgressMessage: document.querySelector("#creditkarma-progress-message"),
  creditKarmaDirectError: document.querySelector("#creditkarma-direct-error"),
  aliExpressStartDate: document.querySelector("#aliexpress-start-date"),
  aliExpressEndDate: document.querySelector("#aliexpress-end-date"),
  aliExpressAccountName: document.querySelector("#aliexpress-account-name"),
  aliExpressAccountType: document.querySelector("#aliexpress-account-type"),
  aliExpressProvider: document.querySelector("#aliexpress-provider"),
  aliExpressImportButton: document.querySelector("#aliexpress-import-button"),
  aliExpressCancelButton: document.querySelector("#aliexpress-cancel-button"),
  aliExpressProgress: document.querySelector("#aliexpress-progress"),
  aliExpressProgressBar: document.querySelector("#aliexpress-progress-bar"),
  aliExpressProgressMessage: document.querySelector("#aliexpress-progress-message"),
  aliExpressDirectError: document.querySelector("#aliexpress-direct-error"),
  venmoStartDate: document.querySelector("#venmo-start-date"),
  venmoEndDate: document.querySelector("#venmo-end-date"),
  venmoAccountName: document.querySelector("#venmo-account-name"),
  venmoAccountType: document.querySelector("#venmo-account-type"),
  venmoProvider: document.querySelector("#venmo-provider"),
  venmoImportButton: document.querySelector("#venmo-import-button"),
  venmoCancelButton: document.querySelector("#venmo-cancel-button"),
  venmoProgress: document.querySelector("#venmo-progress"),
  venmoProgressBar: document.querySelector("#venmo-progress-bar"),
  venmoProgressMessage: document.querySelector("#venmo-progress-message"),
  venmoDirectError: document.querySelector("#venmo-direct-error"),
  ebayStartDate: document.querySelector("#ebay-start-date"),
  ebayEndDate: document.querySelector("#ebay-end-date"),
  ebayAccountName: document.querySelector("#ebay-account-name"),
  ebayAccountType: document.querySelector("#ebay-account-type"),
  ebayProvider: document.querySelector("#ebay-provider"),
  ebayImportButton: document.querySelector("#ebay-import-button"),
  ebayCancelButton: document.querySelector("#ebay-cancel-button"),
  ebayProgress: document.querySelector("#ebay-progress"),
  ebayProgressBar: document.querySelector("#ebay-progress-bar"),
  ebayProgressMessage: document.querySelector("#ebay-progress-message"),
  ebayError: document.querySelector("#ebay-error"),
  walmartStartDate: document.querySelector("#walmart-start-date"),
  walmartEndDate: document.querySelector("#walmart-end-date"),
  walmartAccountName: document.querySelector("#walmart-account-name"),
  walmartAccountType: document.querySelector("#walmart-account-type"),
  walmartProvider: document.querySelector("#walmart-provider"),
  walmartImportButton: document.querySelector("#walmart-import-button"),
  walmartCancelButton: document.querySelector("#walmart-cancel-button"),
  walmartProgress: document.querySelector("#walmart-progress"),
  walmartProgressBar: document.querySelector("#walmart-progress-bar"),
  walmartProgressMessage: document.querySelector("#walmart-progress-message"),
  walmartError: document.querySelector("#walmart-error"),
  appleCardStartDate: document.querySelector("#applecard-start-date"),
  appleCardEndDate: document.querySelector("#applecard-end-date"),
  appleCardFile: document.querySelector("#applecard-file"),
  applecardAccountName: document.querySelector("#applecard-account-name"),
  applecardAccountType: document.querySelector("#applecard-account-type"),
  applecardProvider: document.querySelector("#applecard-provider"),
  appleCardImportButton: document.querySelector("#applecard-import-button"),
  appleCardFileImportButton: document.querySelector("#applecard-file-import-button"),
  appleCardCancelButton: document.querySelector("#applecard-cancel-button"),
  appleCardProgress: document.querySelector("#applecard-progress"),
  appleCardProgressBar: document.querySelector("#applecard-progress-bar"),
  appleCardProgressMessage: document.querySelector("#applecard-progress-message"),
  appleCardError: document.querySelector("#applecard-error"),
  csvImportFile: document.querySelector("#csv-import-file"),
  csvApplyClassifications: document.querySelector("#csv-apply-classifications"),
  csvImportButton: document.querySelector("#csv-import-button"),
  csvImportError: document.querySelector("#csv-import-error"),
  importerTabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
  reviewDialog: document.querySelector("#import-review-dialog"),
  reviewEyebrow: document.querySelector("#import-review-eyebrow"),
  reviewTitle: document.querySelector("#import-review-title"),
  reviewSubtitle: document.querySelector("#import-review-subtitle"),
  reviewError: document.querySelector("#import-review-error"),
  reviewInvalidNote: document.querySelector("#import-review-invalid-note"),
  reviewList: document.querySelector("#import-review-list"),
  reviewSort: document.querySelector("#import-review-sort"),
  reviewSearch: document.querySelector("#import-review-search"),
  reviewFilterButton: document.querySelector("#import-review-filter-button"),
  reviewFilterPopover: document.querySelector("#import-review-filter-popover"),
  reviewGroupFilter: document.querySelector("#import-review-group-filter"),
  reviewFlaggedFilter: document.querySelector("#import-review-flagged-filter"),
  reviewFilterCount: document.querySelector("#import-review-filter-count"),
  reviewCategoryFilter: document.querySelector("#import-review-category-filter"),
  reviewSubcategoryFilter: document.querySelector("#import-review-subcategory-filter"),
  reviewTagFilter: document.querySelector("#import-review-tag-filter"),
  reviewAccountFilter: document.querySelector("#import-review-account-filter"),
  reviewProviderFilter: document.querySelector("#import-review-provider-filter"),
  resetReviewFieldFilters: document.querySelector("#reset-import-review-filters"),
  clearReviewFieldFilters: document.querySelector("#clear-import-review-field-filters"),
  reviewActiveFilters: document.querySelector("#import-review-active-filters"),
  reviewFilterChips: document.querySelector("#import-review-filter-chips"),
  reviewFilters: [...document.querySelectorAll("[data-review-filter]")],
  closeReview: document.querySelector("#close-import-review"),
  cancelReview: document.querySelector("#cancel-import-review"),
  confirmReview: document.querySelector("#confirm-import-review"),
  reviewDashboardLink: document.querySelector("#review-dashboard-link"),
  editDialog: document.querySelector("#import-edit-dialog"),
  editForm: document.querySelector("#import-edit-form"),
  editError: document.querySelector("#import-edit-error"),
  closeEdit: document.querySelector("#close-import-edit"),
  cancelEdit: document.querySelector("#cancel-import-edit"),
  saveEdit: document.querySelector("#save-import-edit"),
};

const importReviewSort = transactionUi.createTransactionSortControls(
  elements.reviewSort,
  { onChange: () => renderImportedTransactions() },
);

function importedTags(transaction) {
  return String(transaction.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function populateReviewFilter(select, values, label, selected = "") {
  const options = [""];
  select.replaceChildren(...options.concat(values).map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || label;
    return option;
  }));
  select.value = values.includes(selected) ? selected : "";
}

function populateReviewSubcategories(category, selected = "") {
  const candidates = category
    ? state.importedTransactions.filter((transaction) => transaction.category === category)
    : state.importedTransactions;
  const values = [...new Set(candidates.map((transaction) => transaction.subcategory).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  populateReviewFilter(elements.reviewSubcategoryFilter, values, "All subcategories", selected);
}

function configureReviewFieldFilters(filters = state.reviewFieldFilters) {
  transactionUi.setFlagFilter(elements.reviewFlaggedFilter, filters.flagged || "");
  transactionUi.populateGroupFilter(elements.reviewGroupFilter, state.importedTransactions, filters.group);
  const unique = (field) => [...new Set(state.importedTransactions.map((transaction) => transaction[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const tags = new Map();
  state.importedTransactions.forEach((transaction) => importedTags(transaction).forEach((tag) => {
    if (!tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag);
  }));
  const tagValues = [...tags.values()].sort((left, right) => left.localeCompare(right));
  const selectedTag = tagValues.find(
    (tag) => tag.toLocaleLowerCase() === String(filters.tag || "").toLocaleLowerCase(),
  ) || "";
  elements.reviewSearch.value = filters.description || "";
  populateReviewFilter(elements.reviewCategoryFilter, unique("category"), "All categories", filters.category);
  populateReviewSubcategories(elements.reviewCategoryFilter.value, filters.subcategory);
  populateReviewFilter(
    elements.reviewTagFilter,
    tagValues,
    "All tags",
    selectedTag,
  );
  populateReviewFilter(elements.reviewAccountFilter, unique("accountName"), "All accounts", filters.accountName);
  populateReviewFilter(elements.reviewProviderFilter, unique("provider"), "All providers", filters.provider);
  state.reviewFieldFilters = {
    flagged: transactionUi.flagFilterValue(elements.reviewFlaggedFilter),
    description: elements.reviewSearch.value.trim(),
    group: elements.reviewGroupFilter.value,
    category: elements.reviewCategoryFilter.value,
    subcategory: elements.reviewSubcategoryFilter.value,
    tag: elements.reviewTagFilter.value,
    accountName: elements.reviewAccountFilter.value,
    provider: elements.reviewProviderFilter.value,
  };
  renderReviewFieldFilterChips();
}

function reviewFilterDraft() {
  return {
    flagged: transactionUi.flagFilterValue(elements.reviewFlaggedFilter),
    group: elements.reviewGroupFilter.value,
    category: elements.reviewCategoryFilter.value,
    subcategory: elements.reviewSubcategoryFilter.value,
    tag: elements.reviewTagFilter.value,
    accountName: elements.reviewAccountFilter.value,
    provider: elements.reviewProviderFilter.value,
  };
}

function renderReviewFieldFilterChips() {
  const definitions = [["flagged", "Flag status"], ["category", "Category"], ["subcategory", "Subcategory"], ["tag", "Tag"], ["group", "Group"], ["accountName", "Account"], ["provider", "Provider"]];
  const active = definitions.filter(([field]) => state.reviewFieldFilters[field]);
  elements.reviewFilterCount.textContent = String(active.length);
  elements.reviewFilterCount.hidden = active.length === 0;
  elements.reviewFilterButton.classList.toggle("has-active-filters", active.length > 0);
  elements.reviewActiveFilters.hidden = active.length === 0;
  elements.reviewFilterChips.replaceChildren(...active.map(([field, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "transaction-filter-chip";
    const value = field === "flagged" ? transactionUi.flagFilterLabel(state.reviewFieldFilters[field]) : field === "group" ? transactionUi.groupFilterLabel(state.reviewFieldFilters[field]) : state.reviewFieldFilters[field];
    chip.textContent = `${label}: ${value} ×`;
    chip.setAttribute("aria-label", `Remove ${label.toLocaleLowerCase()} filter ${value}`);
    chip.addEventListener("click", () => {
      state.reviewFieldFilters[field] = "";
      configureReviewFieldFilters(state.reviewFieldFilters);
      renderImportedTransactions();
    });
    return chip;
  }));
}

function setReviewFilterPopover(open, restore = true) {
  if (!open && restore) configureReviewFieldFilters(state.reviewFieldFilters);
  transactionUi.setTransactionFilterPanel(elements.reviewFilterPopover, elements.reviewFilterButton, open);
}

function importedTransactionMatchesFieldFilters(transaction) {
  const filters = state.reviewFieldFilters;
  return transactionUi.matchesTransactionSearch(transaction, filters.description)
    && transactionUi.matchesFlagFilter(transaction, filters.flagged)
    && (!filters.category || transaction.category === filters.category)
    && (!filters.subcategory || transaction.subcategory === filters.subcategory)
    && (!filters.tag || importedTags(transaction).some((tag) => tag.toLocaleLowerCase() === filters.tag.toLocaleLowerCase()))
    && (!filters.accountName || transaction.accountName === filters.accountName)
    && (!filters.provider || transaction.provider === filters.provider);
}

function importAccountIdentity(source) {
  const prefix = source === "aliexpress" ? "aliExpress" : source;
  const identity = {
    accountName: elements[`${prefix}AccountName`].value.trim(),
    accountType: elements[`${prefix}AccountType`].value.trim(),
    provider: elements[`${prefix}Provider`].value.trim(),
  };
  return Object.values(identity).every(Boolean) ? identity : null;
}

function selectImporterTab(selectedTab, { focus = false } = {}) {
  for (const tab of elements.importerTabs) {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) panel.hidden = !selected;
  }
  if (focus) selectedTab.focus();
}

function initializeImporterTabs() {
  elements.importerTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectImporterTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % elements.importerTabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + elements.importerTabs.length) % elements.importerTabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = elements.importerTabs.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      selectImporterTab(elements.importerTabs[nextIndex], { focus: true });
    });
  });
  const initiallySelected =
    elements.importerTabs.find((tab) => tab.getAttribute("aria-selected") === "true") ||
    elements.importerTabs[0];
  if (initiallySelected) selectImporterTab(initiallySelected);
}

function localIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function suggestRefundMatches() {
  return window.LedgerPreferences?.imports?.().matchRefunds !== false;
}

const defaultImportDates = new Map();
function initializeDirectImportDates({ preserveEdits = false } = {}) {
  const today = new Date();
  const lookbackStart = window.LedgerPreferences?.importStartDate?.(today) || new Date(today);
  if (!window.LedgerPreferences?.importStartDate) lookbackStart.setDate(lookbackStart.getDate() - 14);
  const todayIso = localIsoDate(today);
  // Discover every importer's date controls, including future import tabs.
  for (const [name, field] of Object.entries(elements)) {
    if (!field || !/(Start|End)Date$/.test(name)) continue;
    const value = name.endsWith("StartDate") ? localIsoDate(lookbackStart) : todayIso;
    if (!preserveEdits || field.value === defaultImportDates.get(name)) field.value = value;
    field.max = todayIso;
    defaultImportDates.set(name, value);
  }
}

function versionAtLeast(version, minimum) {
  const actual = String(version || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const required = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(actual.length, required.length); index += 1) {
    if ((actual[index] || 0) !== (required[index] || 0)) {
      return (actual[index] || 0) > (required[index] || 0);
    }
  }
  return true;
}

function setExtensionReady(ready, version = "") {
  state.extensionReady = ready;
  state.extensionVersion = ready ? version : "";
  state.aliExpressExtensionReady =
    ready && versionAtLeast(version, MIN_ALIEXPRESS_EXTENSION_VERSION);
  state.venmoExtensionReady = ready && versionAtLeast(version, MIN_VENMO_EXTENSION_VERSION);
  state.appleCardExtensionReady = ready && versionAtLeast(version, MIN_APPLE_CARD_EXTENSION_VERSION);
  state.ebayExtensionReady = ready && versionAtLeast(version, MIN_EBAY_EXTENSION_VERSION);
  state.walmartExtensionReady = ready && versionAtLeast(version, MIN_WALMART_EXTENSION_VERSION);
  state.capitalOneExtensionReady = ready && versionAtLeast(version, MIN_CAPITAL_ONE_EXTENSION_VERSION);
  elements.capitalOneImportButton.disabled = !state.capitalOneExtensionReady || state.capitalOneBusy;
  if (ready && !state.capitalOneExtensionReady) {
    elements.capitalOneError.textContent = `Capital One requires companion extension ${MIN_CAPITAL_ONE_EXTENSION_VERSION} or newer. Reload Ledger Data Importer in chrome://extensions, then reload this page.`;
    elements.capitalOneError.hidden = false;
  } else if (!state.capitalOneBusy) elements.capitalOneError.hidden = true;
  state.schwabExtensionReady = ready && versionAtLeast(version, MIN_SCHWAB_EXTENSION_VERSION);
  elements.schwabImportButton.disabled = !state.schwabExtensionReady || state.schwabBusy;
  if (ready && !state.schwabExtensionReady) {
    elements.schwabError.textContent = `Schwab requires companion extension ${MIN_SCHWAB_EXTENSION_VERSION} or newer. Reload Ledger Data Importer in chrome://extensions, then reload this page.`;
    elements.schwabError.hidden = false;
  } else if (!state.schwabBusy) elements.schwabError.hidden = true;
  elements.walmartImportButton.disabled = !state.walmartExtensionReady || state.walmartBusy;
  if (ready && !state.walmartExtensionReady) {
    elements.walmartError.textContent = `Walmart requires companion extension ${MIN_WALMART_EXTENSION_VERSION} or newer. Reload Ledger Data Importer in chrome://extensions, then reload this page.`;
    elements.walmartError.hidden = false;
  } else if (!state.walmartBusy) {
    elements.walmartError.hidden = true;
  }
  elements.extensionDot.classList.toggle("extension-dot--ready", ready);
  elements.extensionStatus.textContent = ready
    ? `Companion extension connected · v${version || "unknown"}`
    : (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.protocol === "http:"
      ? "Companion extension not detected"
      : "Extension not connected — check Ledger connection settings");
  elements.extensionHelp.open = !ready;
  elements.amazonImportButton.disabled = !ready || Boolean(state.amazonSessionToken);
  elements.creditKarmaImportButton.disabled =
    !ready || Boolean(state.creditKarmaSessionToken);
  elements.aliExpressImportButton.disabled =
    !state.aliExpressExtensionReady || Boolean(state.aliExpressSessionToken);
  elements.venmoImportButton.disabled =
    !state.venmoExtensionReady || Boolean(state.venmoSessionToken);
  elements.appleCardImportButton.disabled =
    !state.appleCardExtensionReady || Boolean(state.appleCardSessionToken);
  elements.ebayImportButton.disabled =
    !state.ebayExtensionReady || Boolean(state.ebaySessionToken);
  if (ready && !state.aliExpressExtensionReady) {
    elements.aliExpressDirectError.textContent =
      `AliExpress requires companion extension ${MIN_ALIEXPRESS_EXTENSION_VERSION} or newer. ` +
      "Open chrome://extensions, reload Ledger Data Importer, then reload this page.";
    elements.aliExpressDirectError.hidden = false;
  } else if (!state.aliExpressSessionToken) {
    clearAliExpressError();
  }
  if (ready && !state.venmoExtensionReady) {
    elements.venmoDirectError.textContent =
      `Venmo requires companion extension ${MIN_VENMO_EXTENSION_VERSION} or newer. ` +
      "Open chrome://extensions, reload Ledger Data Importer, then reload this page.";
    elements.venmoDirectError.hidden = false;
  } else if (!state.venmoSessionToken) {
    clearVenmoError();
  }
  if (ready && !state.appleCardExtensionReady) {
    elements.appleCardError.textContent =
      `Apple Card requires companion extension ${MIN_APPLE_CARD_EXTENSION_VERSION} or newer. ` +
      "Open chrome://extensions, reload Ledger Data Importer, then reload this page.";
    elements.appleCardError.hidden = false;
  } else if (!state.appleCardSessionToken) {
    clearAppleCardError();
  }
  if (ready && !state.ebayExtensionReady) {
    elements.ebayError.textContent =
      `eBay requires companion extension ${MIN_EBAY_EXTENSION_VERSION} or newer. ` +
      "Open chrome://extensions, reload Ledger Data Importer, then reload this page.";
    elements.ebayError.hidden = false;
  } else if (!state.ebaySessionToken) {
    clearEbayError();
  }
}

function renderAmazonProgress(progress, message, status = "scraping") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.amazonProgress.hidden = false;
  elements.amazonProgressBar.style.width = `${boundedProgress}%`;
  elements.amazonProgressMessage.textContent = message;
  elements.amazonProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showAmazonError(message) {
  elements.amazonDirectError.textContent = message;
  elements.amazonDirectError.hidden = false;
  renderAmazonProgress(0, "Amazon import could not continue.", "error");
}

function clearAmazonError() {
  elements.amazonDirectError.textContent = "";
  elements.amazonDirectError.hidden = true;
}

function stopAmazonPolling() {
  if (state.amazonPollTimer !== null) {
    window.clearTimeout(state.amazonPollTimer);
    state.amazonPollTimer = null;
  }
}

function finishAmazonSession() {
  stopAmazonPolling();
  state.amazonSessionToken = "";
  elements.amazonImportButton.disabled = !state.extensionReady;
  elements.amazonCancelButton.hidden = true;
}

async function pollAmazonSession() {
  if (!state.amazonSessionToken) return;
  try {
    const response = await fetch(
      `/api/amazon-import-sessions/${encodeURIComponent(state.amazonSessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Amazon import status failed (${response.status}).`);

    renderAmazonProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "amazon", state.amazonSessionToken);
      finishAmazonSession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showAmazonError(payload.message);
      finishAmazonSession();
      return;
    }
    state.amazonPollTimer = window.setTimeout(pollAmazonSession, 1200);
  } catch (error) {
    showAmazonError(error instanceof Error ? error.message : "Amazon import status is unavailable.");
    finishAmazonSession();
  }
}

async function startAmazonImport() {
  clearAmazonError();
  const startDate = elements.amazonStartDate.value;
  const endDate = elements.amazonEndDate.value;
  const accountIdentity = importAccountIdentity("amazon");
  if (!startDate || !endDate) {
    showAmazonError("Choose both a start date and an end date.");
    return;
  }
  if (startDate > endDate) {
    showAmazonError("The Amazon start date cannot be after the end date.");
    return;
  }
  if (!accountIdentity) {
    showAmazonError("Complete all three payment account fields.");
    return;
  }
  if (!state.extensionReady) {
    showAmazonError("Install the companion extension and reload this page first.");
    return;
  }

  elements.amazonImportButton.disabled = true;
  renderAmazonProgress(0, "Creating a secure import session…", "waiting_for_extension");
  try {
    const response = await fetch("/api/amazon-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not start the Amazon import (${response.status}).`);

    state.amazonSessionToken = payload.token;
    elements.amazonCancelButton.hidden = false;
    window.postMessage(
      {
        source: "ledger-web-app",
        action: "startAmazonImport",
        payload: {
          token: payload.token,
          startDate,
          endDate,
          ledgerOrigin: window.location.origin,
        },
      },
      window.location.origin,
    );
    renderAmazonProgress(1, "Opening Amazon order history…", "opening_amazon");
    pollAmazonSession();
  } catch (error) {
    showAmazonError(error instanceof Error ? error.message : "Could not start the Amazon import.");
    finishAmazonSession();
  }
}

async function cancelAmazonImport() {
  const token = state.amazonSessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelAmazonImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/amazon-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } finally {
    renderAmazonProgress(0, "Amazon import cancelled.", "cancelled");
    finishAmazonSession();
  }
}

function renderCreditKarmaProgress(progress, message, status = "scraping") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.creditKarmaProgress.hidden = false;
  elements.creditKarmaProgressBar.style.width = `${boundedProgress}%`;
  elements.creditKarmaProgressMessage.textContent = message;
  elements.creditKarmaProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showCreditKarmaError(message) {
  elements.creditKarmaDirectError.textContent = message;
  elements.creditKarmaDirectError.hidden = false;
  renderCreditKarmaProgress(0, "Credit Karma import could not continue.", "error");
}

function clearCreditKarmaError() {
  elements.creditKarmaDirectError.textContent = "";
  elements.creditKarmaDirectError.hidden = true;
}

function stopCreditKarmaPolling() {
  if (state.creditKarmaPollTimer !== null) {
    window.clearTimeout(state.creditKarmaPollTimer);
    state.creditKarmaPollTimer = null;
  }
}

function finishCreditKarmaSession() {
  stopCreditKarmaPolling();
  state.creditKarmaSessionToken = "";
  elements.creditKarmaImportButton.disabled = !state.extensionReady;
  elements.creditKarmaCancelButton.hidden = true;
}

async function pollCreditKarmaSession() {
  if (!state.creditKarmaSessionToken) return;
  try {
    const response = await fetch(
      `/api/creditkarma-import-sessions/${encodeURIComponent(state.creditKarmaSessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Credit Karma import status failed (${response.status}).`);
    }

    renderCreditKarmaProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "creditkarma", state.creditKarmaSessionToken);
      finishCreditKarmaSession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showCreditKarmaError(payload.message);
      finishCreditKarmaSession();
      return;
    }
    state.creditKarmaPollTimer = window.setTimeout(pollCreditKarmaSession, 1200);
  } catch (error) {
    showCreditKarmaError(
      error instanceof Error ? error.message : "Credit Karma import status is unavailable.",
    );
    finishCreditKarmaSession();
  }
}

async function startCreditKarmaImport() {
  clearCreditKarmaError();
  const startDate = elements.creditKarmaStartDate.value;
  const endDate = elements.creditKarmaEndDate.value;
  const ignoreAmazon = elements.creditKarmaIgnoreAmazon.checked;
  const ignoreAliExpress = elements.creditKarmaIgnoreAliExpress.checked;
  const ignoreVenmo = elements.creditKarmaIgnoreVenmo.checked;
  const ignoreEbay = elements.creditKarmaIgnoreEbay.checked;
  const ignoreWalmart = elements.creditKarmaIgnoreWalmart.checked;
  const matchRefunds = suggestRefundMatches();
  if (!startDate || !endDate) {
    showCreditKarmaError("Choose both a start date and an end date.");
    return;
  }
  if (startDate > endDate) {
    showCreditKarmaError("The Credit Karma start date cannot be after the end date.");
    return;
  }
  if (!state.extensionReady) {
    showCreditKarmaError("Install the companion extension and reload this page first.");
    return;
  }

  elements.creditKarmaImportButton.disabled = true;
  renderCreditKarmaProgress(0, "Creating a secure import session…", "waiting_for_extension");
  try {
    const response = await fetch("/api/creditkarma-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ignoreAmazon, ignoreAliExpress, ignoreVenmo, ignoreEbay, ignoreWalmart, matchRefunds }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not start the Credit Karma import (${response.status}).`);
    }
    if (matchRefunds && payload.matchRefunds !== true) {
      throw new Error("Restart the Ledger Python server to enable refund matching, then try this import again.");
    }

    state.creditKarmaSessionToken = payload.token;
    elements.creditKarmaCancelButton.hidden = false;
    window.postMessage(
      {
        source: "ledger-web-app",
        action: "startCreditKarmaImport",
        payload: {
          token: payload.token,
          startDate,
          endDate,
          ledgerOrigin: window.location.origin,
        },
      },
      window.location.origin,
    );
    renderCreditKarmaProgress(1, "Opening Credit Karma transactions…", "opening_credit_karma");
    pollCreditKarmaSession();
  } catch (error) {
    showCreditKarmaError(
      error instanceof Error ? error.message : "Could not start the Credit Karma import.",
    );
    finishCreditKarmaSession();
  }
}

async function cancelCreditKarmaImport() {
  const token = state.creditKarmaSessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelCreditKarmaImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/creditkarma-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } finally {
    renderCreditKarmaProgress(0, "Credit Karma import cancelled.", "cancelled");
    finishCreditKarmaSession();
  }
}

function renderAliExpressProgress(progress, message, status = "scraping") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.aliExpressProgress.hidden = false;
  elements.aliExpressProgressBar.style.width = `${boundedProgress}%`;
  elements.aliExpressProgressMessage.textContent = message;
  elements.aliExpressProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showAliExpressError(message) {
  elements.aliExpressDirectError.textContent = message;
  elements.aliExpressDirectError.hidden = false;
  renderAliExpressProgress(0, "AliExpress import could not continue.", "error");
}

function clearAliExpressError() {
  elements.aliExpressDirectError.textContent = "";
  elements.aliExpressDirectError.hidden = true;
}

function finishAliExpressSession() {
  if (state.aliExpressPollTimer !== null) window.clearTimeout(state.aliExpressPollTimer);
  state.aliExpressPollTimer = null;
  state.aliExpressSessionToken = "";
  state.aliExpressStartedAt = 0;
  elements.aliExpressImportButton.disabled = !state.aliExpressExtensionReady;
  elements.aliExpressCancelButton.hidden = true;
}

async function pollAliExpressSession() {
  if (!state.aliExpressSessionToken) return;
  try {
    const response = await fetch(
      `/api/aliexpress-import-sessions/${encodeURIComponent(state.aliExpressSessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `AliExpress import status failed (${response.status}).`);
    if (
      payload.status === "waiting_for_extension" &&
      Date.now() - state.aliExpressStartedAt > 10000
    ) {
      throw new Error(
        "The companion extension did not accept the AliExpress import. Open chrome://extensions, " +
        "reload Ledger Data Importer, then reload this page and try again.",
      );
    }
    renderAliExpressProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "aliexpress", state.aliExpressSessionToken);
      finishAliExpressSession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showAliExpressError(payload.message);
      finishAliExpressSession();
      return;
    }
    state.aliExpressPollTimer = window.setTimeout(pollAliExpressSession, 1200);
  } catch (error) {
    const token = state.aliExpressSessionToken;
    if (token) {
      fetch(`/api/aliexpress-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
    }
    showAliExpressError(error instanceof Error ? error.message : "AliExpress import status is unavailable.");
    finishAliExpressSession();
  }
}

async function startAliExpressImport() {
  clearAliExpressError();
  const startDate = elements.aliExpressStartDate.value;
  const endDate = elements.aliExpressEndDate.value;
  const accountIdentity = importAccountIdentity("aliexpress");
  if (!startDate || !endDate) return showAliExpressError("Choose both a start date and an end date.");
  if (startDate > endDate) return showAliExpressError("The AliExpress start date cannot be after the end date.");
  if (!accountIdentity) return showAliExpressError("Complete all three payment account fields.");
  if (!state.aliExpressExtensionReady) {
    return showAliExpressError(
      `Reload companion extension ${MIN_ALIEXPRESS_EXTENSION_VERSION} from chrome://extensions, then reload this page.`,
    );
  }

  elements.aliExpressImportButton.disabled = true;
  renderAliExpressProgress(0, "Creating a secure import session…", "waiting_for_extension");
  try {
    const response = await fetch("/api/aliexpress-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not start the AliExpress import (${response.status}).`);
    state.aliExpressSessionToken = payload.token;
    state.aliExpressStartedAt = Date.now();
    elements.aliExpressCancelButton.hidden = false;
    window.postMessage({
      source: "ledger-web-app",
      action: "startAliExpressImport",
      payload: { token: payload.token, startDate, endDate, ledgerOrigin: window.location.origin },
    }, window.location.origin);
    renderAliExpressProgress(1, "Opening AliExpress orders…", "opening_aliexpress");
    pollAliExpressSession();
  } catch (error) {
    showAliExpressError(error instanceof Error ? error.message : "Could not start the AliExpress import.");
    finishAliExpressSession();
  }
}

async function cancelAliExpressImport() {
  const token = state.aliExpressSessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelAliExpressImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/aliexpress-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  } finally {
    renderAliExpressProgress(0, "AliExpress import cancelled.", "cancelled");
    finishAliExpressSession();
  }
}

function renderVenmoProgress(progress, message, status = "scraping") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.venmoProgress.hidden = false;
  elements.venmoProgressBar.style.width = `${boundedProgress}%`;
  elements.venmoProgressMessage.textContent = message;
  elements.venmoProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showVenmoError(message) {
  elements.venmoDirectError.textContent = message;
  elements.venmoDirectError.hidden = false;
  renderVenmoProgress(0, "Venmo import could not continue.", "error");
}

function clearVenmoError() {
  elements.venmoDirectError.textContent = "";
  elements.venmoDirectError.hidden = true;
}

function finishVenmoSession() {
  if (state.venmoPollTimer !== null) window.clearTimeout(state.venmoPollTimer);
  state.venmoPollTimer = null;
  state.venmoSessionToken = "";
  state.venmoStartedAt = 0;
  elements.venmoImportButton.disabled = !state.venmoExtensionReady;
  elements.venmoCancelButton.hidden = true;
}

async function pollVenmoSession() {
  if (!state.venmoSessionToken) return;
  try {
    const response = await fetch(
      `/api/venmo-import-sessions/${encodeURIComponent(state.venmoSessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Venmo import status failed (${response.status}).`);
    if (payload.status === "waiting_for_extension" && Date.now() - state.venmoStartedAt > 10000) {
      throw new Error(
        "The companion extension did not accept the Venmo import. Reload Ledger Data Importer " +
        "from chrome://extensions, reload this page, and try again.",
      );
    }
    renderVenmoProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "venmo", state.venmoSessionToken);
      finishVenmoSession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showVenmoError(payload.message);
      finishVenmoSession();
      return;
    }
    state.venmoPollTimer = window.setTimeout(pollVenmoSession, 1200);
  } catch (error) {
    const token = state.venmoSessionToken;
    if (token) {
      fetch(`/api/venmo-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
    }
    showVenmoError(error instanceof Error ? error.message : "Venmo import status is unavailable.");
    finishVenmoSession();
  }
}

async function startVenmoImport() {
  clearVenmoError();
  const startDate = elements.venmoStartDate.value;
  const endDate = elements.venmoEndDate.value;
  const accountIdentity = importAccountIdentity("venmo");
  if (!startDate || !endDate) return showVenmoError("Choose both a start date and an end date.");
  if (startDate > endDate) return showVenmoError("The Venmo start date cannot be after the end date.");
  if (!accountIdentity) return showVenmoError("Complete all three account identity fields.");
  if (!state.venmoExtensionReady) {
    return showVenmoError(
      `Reload companion extension ${MIN_VENMO_EXTENSION_VERSION} from chrome://extensions, then reload this page.`,
    );
  }
  elements.venmoImportButton.disabled = true;
  renderVenmoProgress(0, "Creating a secure import session…", "waiting_for_extension");
  try {
    const response = await fetch("/api/venmo-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not start the Venmo import (${response.status}).`);
    state.venmoSessionToken = payload.token;
    state.venmoStartedAt = Date.now();
    elements.venmoCancelButton.hidden = false;
    window.postMessage({
      source: "ledger-web-app",
      action: "startVenmoImport",
      payload: { token: payload.token, startDate, endDate, ledgerOrigin: window.location.origin },
    }, window.location.origin);
    renderVenmoProgress(1, "Opening Venmo statements…", "opening_venmo");
    pollVenmoSession();
  } catch (error) {
    showVenmoError(error instanceof Error ? error.message : "Could not start the Venmo import.");
    finishVenmoSession();
  }
}

async function cancelVenmoImport() {
  const token = state.venmoSessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelVenmoImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/venmo-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  } finally {
    renderVenmoProgress(0, "Venmo import cancelled.", "cancelled");
    finishVenmoSession();
  }
}

function renderWalmartProgress(progress, message, status = "scraping") {
  elements.walmartProgress.hidden = false;
  elements.walmartProgressBar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  elements.walmartProgressMessage.textContent = message;
  elements.walmartProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showWalmartError(message) {
  elements.walmartError.textContent = message;
  elements.walmartError.hidden = false;
  renderWalmartProgress(0, "Walmart import could not continue.", "error");
}

function finishWalmartSession() {
  if (state.walmartPollTimer !== null) window.clearTimeout(state.walmartPollTimer);
  state.walmartPollTimer = null;
  state.walmartSessionToken = "";
  state.walmartBusy = false;
  elements.walmartImportButton.disabled = !state.walmartExtensionReady;
  elements.walmartCancelButton.hidden = true;
}

async function walmartRequest(path, payload) {
  const response = await fetch(`/api/walmart-import-sessions${path}`, payload === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || (response.status === 404
    ? "Restart the Ledger Python server to enable Walmart imports, then retry."
    : `Walmart import request failed (${response.status}).`));
  return result;
}

async function pollWalmartSession(token) {
  if (state.walmartSessionToken !== token) return;
  try {
    const result = await walmartRequest(`/${encodeURIComponent(token)}`);
    if (state.walmartSessionToken !== token) return; // Ignore replies from a cancelled/older job.
    const elapsed = Date.now() - state.walmartStartedAt;
    if (elapsed > 30 * 60 * 1000 || (result.status === "waiting_for_extension" && elapsed > 15000)) {
      throw new Error("Walmart import timed out. Reload the companion extension, complete any Walmart sign-in/security check, and retry.");
    }
    renderWalmartProgress(result.progress, result.message, result.status);
    if (result.status === "review") {
      renderResult(result.import, "walmart", token);
      finishWalmartSession();
    } else if (["error", "cancelled", "complete"].includes(result.status)) {
      if (result.status === "error") showWalmartError(result.message);
      finishWalmartSession();
    } else {
      state.walmartPollTimer = window.setTimeout(() => pollWalmartSession(token), 1200);
    }
  } catch (error) {
    if (state.walmartSessionToken !== token) return;
    await cancelWalmartImport();
    showWalmartError(error.message || "Walmart import status is unavailable.");
  }
}

async function startWalmartImport() {
  if (state.walmartBusy) return;
  elements.walmartError.hidden = true;
  const startDate = elements.walmartStartDate.value;
  const endDate = elements.walmartEndDate.value;
  const identity = importAccountIdentity("walmart");
  if (!startDate || !endDate || startDate > endDate) return showWalmartError("Choose a valid start and end date.");
  if (!identity) return showWalmartError("Complete all three account fields.");
  if (!state.walmartExtensionReady) return showWalmartError(`Reload companion extension ${MIN_WALMART_EXTENSION_VERSION} or newer, then reload this page.`);
  state.walmartBusy = true;
  elements.walmartImportButton.disabled = true;
  renderWalmartProgress(0, "Creating a secure import session…");
  try {
    const result = await walmartRequest("", { startDate, endDate, ...identity, matchRefunds: suggestRefundMatches() });
    state.walmartSessionToken = result.token;
    state.walmartStartedAt = Date.now();
    elements.walmartCancelButton.hidden = false;
    window.postMessage({ source: "ledger-web-app", action: "startWalmartImport", payload: {
      token: result.token, startDate, endDate, ledgerOrigin: window.location.origin,
    } }, window.location.origin);
    void pollWalmartSession(result.token);
  } catch (error) {
    showWalmartError(error.message || "Could not start Walmart import.");
    finishWalmartSession();
  }
}

async function cancelWalmartImport() {
  const token = state.walmartSessionToken;
  finishWalmartSession(); // Invalidate in-flight polling before awaiting cancellation.
  if (!token) return;
  window.postMessage({ source: "ledger-web-app", action: "cancelWalmartImport", payload: { token } }, window.location.origin);
  try { await walmartRequest(`/${encodeURIComponent(token)}/cancel`, {}); }
  catch { /* No commit was sent; expired sessions cannot change the CSV. */ }
  renderWalmartProgress(0, "Walmart import cancelled.", "cancelled");
}

function renderSchwabProgress(progress, message, status = "scraping") {
  elements.schwabProgress.hidden = false;
  elements.schwabProgressBar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  elements.schwabProgressMessage.textContent = message;
  elements.schwabProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showSchwabError(message) {
  elements.schwabError.textContent = message;
  elements.schwabError.hidden = false;
  renderSchwabProgress(0, "Schwab import could not continue.", "error");
}

function finishSchwabSession() {
  if (state.schwabPollTimer !== null) window.clearTimeout(state.schwabPollTimer);
  state.schwabPollTimer = null;
  state.schwabSessionToken = "";
  state.schwabBusy = false;
  elements.schwabImportButton.disabled = !state.schwabExtensionReady;
  elements.schwabCancelButton.hidden = true;
}

async function schwabRequest(path, payload) {
  const response = await fetch(`/api/schwab-import-sessions${path}`, payload === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || (response.status === 404
    ? "Restart the Ledger Python server to enable Schwab imports, then retry."
    : `Schwab import request failed (${response.status}).`));
  return result;
}

async function pollSchwabSession(token) {
  if (state.schwabSessionToken !== token) return;
  try {
    const result = await schwabRequest(`/${encodeURIComponent(token)}`);
    if (state.schwabSessionToken !== token) return; // Ignore replies from a cancelled/older job.
    const elapsed = Date.now() - state.schwabStartedAt;
    if (elapsed > 30 * 60 * 1000 || (result.status === "waiting_for_extension" && elapsed > 15000)) {
      throw new Error("Schwab import timed out. Reload the companion extension, complete any Schwab sign-in/security check, and retry.");
    }
    renderSchwabProgress(result.progress, result.message, result.status);
    if (result.status === "review") {
      renderResult(result.import, "schwab", token);
      finishSchwabSession();
    } else if (["error", "cancelled", "complete"].includes(result.status)) {
      if (result.status === "error") showSchwabError(result.message);
      finishSchwabSession();
    } else {
      state.schwabPollTimer = window.setTimeout(() => pollSchwabSession(token), 1200);
    }
  } catch (error) {
    if (state.schwabSessionToken !== token) return;
    await cancelSchwabImport();
    showSchwabError(error.message || "Schwab import status is unavailable.");
  }
}

async function startSchwabImport() {
  if (state.schwabBusy) return;
  elements.schwabError.hidden = true;
  const startDate = elements.schwabStartDate.value;
  const endDate = elements.schwabEndDate.value;
  const identity = importAccountIdentity("schwab");
  if (!startDate || !endDate || startDate > endDate) return showSchwabError("Choose a valid start and end date.");
  if (!identity) return showSchwabError("Complete all three account fields.");
  if (!state.schwabExtensionReady) return showSchwabError(`Reload companion extension ${MIN_SCHWAB_EXTENSION_VERSION} or newer, then reload this page.`);
  state.schwabBusy = true;
  elements.schwabImportButton.disabled = true;
  renderSchwabProgress(0, "Creating a secure import session…");
  try {
    const result = await schwabRequest("", { startDate, endDate, ...identity, matchRefunds: suggestRefundMatches() });
    state.schwabSessionToken = result.token;
    state.schwabStartedAt = Date.now();
    elements.schwabCancelButton.hidden = false;
    window.postMessage({ source: "ledger-web-app", action: "startSchwabImport", payload: {
      token: result.token, startDate, endDate, ledgerOrigin: window.location.origin,
    } }, window.location.origin);
    void pollSchwabSession(result.token);
  } catch (error) {
    showSchwabError(error.message || "Could not start Schwab import.");
    finishSchwabSession();
  }
}

async function cancelSchwabImport() {
  const token = state.schwabSessionToken;
  finishSchwabSession(); // Invalidate in-flight polling before awaiting cancellation.
  if (!token) return;
  window.postMessage({ source: "ledger-web-app", action: "cancelSchwabImport", payload: { token } }, window.location.origin);
  try { await schwabRequest(`/${encodeURIComponent(token)}/cancel`, {}); }
  catch { /* No commit was sent; expired sessions cannot change the CSV. */ }
  renderSchwabProgress(0, "Schwab import cancelled.", "cancelled");
}

function renderCapitalOneProgress(progress, message, status = "scraping") {
  elements.capitalOneProgress.hidden = false;
  elements.capitalOneProgressBar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  elements.capitalOneProgressMessage.textContent = message;
  elements.capitalOneProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showCapitalOneError(message) {
  elements.capitalOneError.textContent = message;
  elements.capitalOneError.hidden = false;
  renderCapitalOneProgress(0, "Capital One import could not continue.", "error");
}

function finishCapitalOneSession() {
  if (state.capitalOnePollTimer !== null) window.clearTimeout(state.capitalOnePollTimer);
  state.capitalOnePollTimer = null;
  state.capitalOneSessionToken = "";
  state.capitalOneBusy = false;
  elements.capitalOneImportButton.disabled = !state.capitalOneExtensionReady;
  elements.capitalOneCancelButton.hidden = true;
  elements.capitalOneFileButton.disabled = !elements.capitalOneFile.files?.length;
}

async function capitalOneRequest(path, payload) {
  const response = await fetch(`/api/capitalone-import-sessions${path}`, payload === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || (response.status === 404
    ? "Restart the Ledger Python server to enable Capital One imports, then retry."
    : `Capital One import request failed (${response.status}).`));
  return result;
}

async function pollCapitalOneSession(token) {
  if (state.capitalOneSessionToken !== token) return;
  try {
    const result = await capitalOneRequest(`/${encodeURIComponent(token)}`);
    if (state.capitalOneSessionToken !== token) return; // Ignore replies from a cancelled/older job.
    const elapsed = Date.now() - state.capitalOneStartedAt;
    if (elapsed > 30 * 60 * 1000 || (result.status === "waiting_for_extension" && elapsed > 15000)) {
      throw new Error("Capital One import timed out. Reload the companion extension, complete any Capital One sign-in/security check, and retry.");
    }
    renderCapitalOneProgress(result.progress, result.message, result.status);
    if (result.status === "review") {
      renderResult(result.import, "capitalone", token);
      finishCapitalOneSession();
    } else if (["error", "cancelled", "complete"].includes(result.status)) {
      if (result.status === "error") showCapitalOneError(result.message);
      finishCapitalOneSession();
    } else {
      state.capitalOnePollTimer = window.setTimeout(() => pollCapitalOneSession(token), 1200);
    }
  } catch (error) {
    if (state.capitalOneSessionToken !== token) return;
    await cancelCapitalOneImport();
    showCapitalOneError(error.message || "Capital One import status is unavailable.");
  }
}

async function startCapitalOneImport() {
  if (state.capitalOneBusy) return;
  elements.capitalOneError.hidden = true;
  const startDate = elements.capitalOneStartDate.value;
  const endDate = elements.capitalOneEndDate.value;
  const identity = importAccountIdentity("capitalone");
  if (!startDate || !endDate || startDate > endDate) return showCapitalOneError("Choose a valid start and end date.");
  if (!identity) return showCapitalOneError("Complete all three account fields.");
  if (!state.capitalOneExtensionReady) return showCapitalOneError(`Reload companion extension ${MIN_CAPITAL_ONE_EXTENSION_VERSION} or newer, then reload this page.`);
  state.capitalOneBusy = true;
  elements.capitalOneImportButton.disabled = true;
  elements.capitalOneFileButton.disabled = true;
  renderCapitalOneProgress(0, "Creating a secure import session…");
  try {
    const result = await capitalOneRequest("", { startDate, endDate, ...identity, matchRefunds: suggestRefundMatches() });
    state.capitalOneSessionToken = result.token;
    state.capitalOneStartedAt = Date.now();
    elements.capitalOneCancelButton.hidden = false;
    window.postMessage({ source: "ledger-web-app", action: "startCapitalOneImport", payload: {
      token: result.token, startDate, endDate, ledgerOrigin: window.location.origin,
    } }, window.location.origin);
    void pollCapitalOneSession(result.token);
  } catch (error) {
    showCapitalOneError(error.message || "Could not start Capital One import.");
    finishCapitalOneSession();
  }
}

async function cancelCapitalOneImport() {
  const token = state.capitalOneSessionToken;
  finishCapitalOneSession(); // Invalidate in-flight polling before awaiting cancellation.
  if (!token) return;
  window.postMessage({ source: "ledger-web-app", action: "cancelCapitalOneImport", payload: { token } }, window.location.origin);
  try { await capitalOneRequest(`/${encodeURIComponent(token)}/cancel`, {}); }
  catch { /* No commit was sent; expired sessions cannot change the CSV. */ }
  renderCapitalOneProgress(0, "Capital One import cancelled.", "cancelled");
}

async function importCapitalOneFile() {
  if (state.capitalOneBusy) return;
  const file = elements.capitalOneFile.files?.[0];
  const startDate = elements.capitalOneStartDate.value;
  const endDate = elements.capitalOneEndDate.value;
  const identity = importAccountIdentity("capitalone");
  if (!file || !/\.csv$/i.test(file.name)) return showCapitalOneError("Choose a Capital One CSV export.");
  if (file.size > 16 * 1024 * 1024) return showCapitalOneError("Capital One CSV cannot exceed 16 MB.");
  if (!startDate || !endDate || startDate > endDate) return showCapitalOneError("Choose a valid start and end date.");
  if (!identity) return showCapitalOneError("Complete all three account fields.");
  state.capitalOneBusy = true;
  elements.capitalOneImportButton.disabled = true;
  elements.capitalOneFileButton.disabled = true;
  elements.capitalOneError.hidden = true;
  renderCapitalOneProgress(5, "Reading Capital One CSV…");
  let token = "";
  try {
    const content = await file.text();
    const session = await capitalOneRequest("", { startDate, endDate, ...identity, matchRefunds: suggestRefundMatches() });
    token = session.token;
    state.capitalOneSessionToken = token;
    elements.capitalOneCancelButton.hidden = false;
    const result = await capitalOneRequest(`/${encodeURIComponent(token)}/complete`, { content });
    if (state.capitalOneSessionToken !== token) return;
    if (result.status !== "review") throw new Error(result.message || "Capital One export was not ready to review.");
    renderResult(result.import, "capitalone", token);
    renderCapitalOneProgress(98, "Capital One transactions are ready to review.");
    finishCapitalOneSession();
  } catch (error) {
    if (token && state.capitalOneSessionToken !== token) return;
    await cancelCapitalOneImport();
    showCapitalOneError(error.message || "Could not read Capital One CSV.");
  }
}

function renderEbayProgress(progress, message, status = "scraping") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.ebayProgress.hidden = false;
  elements.ebayProgressBar.style.width = `${boundedProgress}%`;
  elements.ebayProgressMessage.textContent = message;
  elements.ebayProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showEbayError(message) {
  elements.ebayError.textContent = message;
  elements.ebayError.hidden = false;
  renderEbayProgress(0, "eBay import could not continue.", "error");
}

function clearEbayError() {
  elements.ebayError.textContent = "";
  elements.ebayError.hidden = true;
}

function finishEbaySession() {
  if (state.ebayPollTimer !== null) window.clearTimeout(state.ebayPollTimer);
  state.ebayPollTimer = null;
  state.ebaySessionToken = "";
  state.ebayStartedAt = 0;
  elements.ebayImportButton.disabled = !state.ebayExtensionReady;
  elements.ebayCancelButton.hidden = true;
}

async function pollEbaySession() {
  if (!state.ebaySessionToken) return;
  try {
    const response = await fetch(
      `/api/ebay-import-sessions/${encodeURIComponent(state.ebaySessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `eBay import status failed (${response.status}).`);
    if (payload.status === "waiting_for_extension" && Date.now() - state.ebayStartedAt > 10000) {
      throw new Error(
        "The companion extension did not accept the eBay import. Reload Ledger Data Importer " +
        "from chrome://extensions, reload this page, and try again.",
      );
    }
    renderEbayProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "ebay", state.ebaySessionToken);
      finishEbaySession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showEbayError(payload.message);
      finishEbaySession();
      return;
    }
    state.ebayPollTimer = window.setTimeout(pollEbaySession, 1200);
  } catch (error) {
    const token = state.ebaySessionToken;
    if (token) {
      fetch(`/api/ebay-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
    }
    showEbayError(error instanceof Error ? error.message : "eBay import status is unavailable.");
    finishEbaySession();
  }
}

async function startEbayImport() {
  clearEbayError();
  const startDate = elements.ebayStartDate.value;
  const endDate = elements.ebayEndDate.value;
  const accountIdentity = importAccountIdentity("ebay");
  if (!startDate || !endDate) return showEbayError("Choose both a start date and an end date.");
  if (startDate > endDate) return showEbayError("The eBay start date cannot be after the end date.");
  if (!accountIdentity) return showEbayError("Complete all three account identity fields.");
  if (!state.ebayExtensionReady) {
    return showEbayError(
      `Reload companion extension ${MIN_EBAY_EXTENSION_VERSION} from chrome://extensions, then reload this page.`,
    );
  }
  elements.ebayImportButton.disabled = true;
  renderEbayProgress(0, "Creating a secure import session...", "waiting_for_extension");
  try {
    const response = await fetch("/api/ebay-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not start the eBay import (${response.status}).`);
    state.ebaySessionToken = payload.token;
    state.ebayStartedAt = Date.now();
    elements.ebayCancelButton.hidden = false;
    window.postMessage({
      source: "ledger-web-app",
      action: "startEbayImport",
      payload: { token: payload.token, startDate, endDate, ledgerOrigin: window.location.origin },
    }, window.location.origin);
    renderEbayProgress(1, "Opening eBay purchase history...", "opening_ebay");
    pollEbaySession();
  } catch (error) {
    showEbayError(error instanceof Error ? error.message : "Could not start the eBay import.");
    finishEbaySession();
  }
}

async function cancelEbayImport() {
  const token = state.ebaySessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelEbayImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/ebay-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  } finally {
    renderEbayProgress(0, "eBay import cancelled.", "cancelled");
    finishEbaySession();
  }
}

function renderAppleCardProgress(progress, message, status = "importing") {
  const boundedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  elements.appleCardProgress.hidden = false;
  elements.appleCardProgressBar.style.width = `${boundedProgress}%`;
  elements.appleCardProgressMessage.textContent = message;
  elements.appleCardProgress.classList.toggle("amazon-progress--error", status === "error");
}

function showAppleCardError(message) {
  elements.appleCardError.textContent = message;
  elements.appleCardError.hidden = false;
  renderAppleCardProgress(0, "Apple Card import could not continue.", "error");
}

function clearAppleCardError() {
  elements.appleCardError.textContent = "";
  elements.appleCardError.hidden = true;
}

function updateAppleCardFileButton() {
  elements.appleCardFileImportButton.disabled =
    state.appleCardBusy || !elements.appleCardFile.files?.length;
}

function finishAppleCardSession() {
  if (state.appleCardPollTimer !== null) window.clearTimeout(state.appleCardPollTimer);
  state.appleCardPollTimer = null;
  state.appleCardSessionToken = "";
  state.appleCardStartedAt = 0;
  elements.appleCardImportButton.disabled = !state.appleCardExtensionReady;
  elements.appleCardCancelButton.hidden = true;
}

async function pollAppleCardSession() {
  if (!state.appleCardSessionToken) return;
  try {
    const response = await fetch(
      `/api/applecard-import-sessions/${encodeURIComponent(state.appleCardSessionToken)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Apple Card import status failed (${response.status}).`);
    if (payload.status === "waiting_for_file" && Date.now() - state.appleCardStartedAt > 10000) {
      throw new Error(
        "The companion extension did not accept the Apple Card import. Reload Ledger Data Importer " +
        "from chrome://extensions, reload this page, and try again.",
      );
    }
    renderAppleCardProgress(payload.progress, payload.message, payload.status);
    if (payload.status === "review") {
      renderResult(payload.import, "applecard", state.appleCardSessionToken);
      finishAppleCardSession();
      return;
    }
    if (payload.status === "error" || payload.status === "cancelled") {
      if (payload.status === "error") showAppleCardError(payload.message);
      finishAppleCardSession();
      return;
    }
    state.appleCardPollTimer = window.setTimeout(pollAppleCardSession, 1200);
  } catch (error) {
    const token = state.appleCardSessionToken;
    if (token) {
      fetch(`/api/applecard-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
    }
    showAppleCardError(error instanceof Error ? error.message : "Apple Card import status is unavailable.");
    finishAppleCardSession();
  }
}

async function startAppleCardImport() {
  if (state.appleCardBusy || state.appleCardSessionToken) return;
  clearAppleCardError();
  const startDate = elements.appleCardStartDate.value;
  const endDate = elements.appleCardEndDate.value;
  const accountIdentity = importAccountIdentity("applecard");
  if (!startDate || !endDate) return showAppleCardError("Choose both a start date and an end date.");
  if (startDate > endDate) return showAppleCardError("The Apple Card start date cannot be after the end date.");
  if (!accountIdentity) return showAppleCardError("Complete all three account identity fields.");
  if (!state.appleCardExtensionReady) {
    return showAppleCardError(
      `Reload companion extension ${MIN_APPLE_CARD_EXTENSION_VERSION} from chrome://extensions, then reload this page.`,
    );
  }
  elements.appleCardImportButton.disabled = true;
  renderAppleCardProgress(0, "Creating a secure import session...", "waiting_for_file");
  try {
    const response = await fetch("/api/applecard-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not start the Apple Card import (${response.status}).`);
    state.appleCardSessionToken = payload.token;
    state.appleCardStartedAt = Date.now();
    elements.appleCardCancelButton.hidden = false;
    window.postMessage({
      source: "ledger-web-app",
      action: "startAppleCardImport",
      payload: { token: payload.token, startDate, endDate, ledgerOrigin: window.location.origin },
    }, window.location.origin);
    renderAppleCardProgress(1, "Opening Apple Card...", "opening_apple_card");
    pollAppleCardSession();
  } catch (error) {
    showAppleCardError(error instanceof Error ? error.message : "Could not start the Apple Card import.");
    finishAppleCardSession();
  }
}

async function cancelAppleCardImport() {
  const token = state.appleCardSessionToken;
  if (!token) return;
  window.postMessage(
    { source: "ledger-web-app", action: "cancelAppleCardImport", payload: { token } },
    window.location.origin,
  );
  try {
    await fetch(`/api/applecard-import-sessions/${encodeURIComponent(token)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  } finally {
    renderAppleCardProgress(0, "Apple Card import cancelled.", "cancelled");
    finishAppleCardSession();
  }
}

async function importAppleCardFile() {
  if (state.appleCardBusy || state.appleCardSessionToken) return;
  clearAppleCardError();
  const startDate = elements.appleCardStartDate.value;
  const endDate = elements.appleCardEndDate.value;
  const file = elements.appleCardFile.files?.[0];
  const accountIdentity = importAccountIdentity("applecard");
  if (!startDate || !endDate) return showAppleCardError("Choose both a start date and an end date.");
  if (startDate > endDate) return showAppleCardError("The Apple Card start date cannot be after the end date.");
  if (!file) return showAppleCardError("Choose the CSV exported from Apple Card.");
  if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
    return showAppleCardError("Apple Card imports must use a CSV file.");
  }
  if (file.size > 40_000_000) return showAppleCardError("The Apple Card CSV cannot exceed 40 MB.");
  if (!accountIdentity) return showAppleCardError("Complete all three account identity fields.");

  state.appleCardBusy = true;
  elements.appleCardFileImportButton.disabled = true;
  elements.appleCardImportButton.disabled = true;
  renderAppleCardProgress(5, "Reading Apple Card CSV...");
  try {
    const content = await file.text();
    if (!content.trim()) throw new Error("The selected Apple Card CSV is empty.");
    renderAppleCardProgress(25, "Creating a secure import session...");
    const sessionResponse = await fetch("/api/applecard-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, filterDateRange: false, ...accountIdentity, matchRefunds: suggestRefundMatches() }),
    });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok) {
      throw new Error(session.error || `Could not start the Apple Card import (${sessionResponse.status}).`);
    }
    renderAppleCardProgress(60, "Validating and importing transactions...");
    const completeResponse = await fetch(
      `/api/applecard-import-sessions/${encodeURIComponent(session.token)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    const completed = await completeResponse.json().catch(() => ({}));
    if (!completeResponse.ok) {
      throw new Error(completed.error || `Apple Card import failed (${completeResponse.status}).`);
    }
    renderAppleCardProgress(98, completed.message || "Apple Card import ready to review.", "review");
    renderResult(completed.import, "applecard", session.token);
  } catch (error) {
    showAppleCardError(error instanceof Error ? error.message : "Could not import Apple Card transactions.");
  } finally {
    state.appleCardBusy = false;
    updateAppleCardFileButton();
    elements.appleCardImportButton.disabled = !state.appleCardExtensionReady;
  }
}

function updateCsvImportButton() {
  elements.csvImportButton.disabled =
    state.csvImportBusy || !elements.csvImportFile.files?.length;
}

function showCsvImportError(message) {
  elements.csvImportError.textContent = message;
  elements.csvImportError.hidden = false;
}

async function importLedgerCsv() {
  if (state.csvImportBusy) return;
  elements.csvImportError.hidden = true;
  elements.csvImportError.textContent = "";
  const file = elements.csvImportFile.files?.[0];
  if (!file) return showCsvImportError("Choose a Ledger transaction CSV.");
  if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
    return showCsvImportError("Ledger transaction imports must use a CSV file.");
  }
  if (file.size > 40_000_000) return showCsvImportError("The transaction CSV cannot exceed 40 MB.");

  state.csvImportBusy = true;
  updateCsvImportButton();
  elements.csvImportButton.textContent = "Validating CSV…";
  try {
    const content = await file.text();
    if (!content.trim()) throw new Error("The selected CSV is empty.");
    const response = await fetch("/api/csv-import-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        applyClassifications: elements.csvApplyClassifications.checked,
        matchRefunds: suggestRefundMatches(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `CSV import failed (${response.status}).`);
    }
    renderResult(payload.import, "csv", payload.token);
  } catch (error) {
    showCsvImportError(error instanceof Error ? error.message : "Could not import the transaction CSV.");
  } finally {
    state.csvImportBusy = false;
    elements.csvImportButton.innerHTML = 'Import selected CSV <span aria-hidden="true">&rarr;</span>';
    updateCsvImportButton();
  }
}

const importRangeSelection = transactionUi.createCheckboxRangeSelection((ids, checked) => {
  if (!state.reviewSession || state.reviewCommitted || state.reviewCommitting || importBulk.isActive()) return;
  const affected = new Set(ids);
  state.importedTransactions.forEach((row) => {
    if (affected.has(row._stagedId) && !state.refundSelections.has(row._stagedId)) row._selected = checked;
  });
  const refresh = refreshEditedImport(state.importedTransactions);
  renderImportedTransactions();
  refresh.then(renderImportedTransactions).catch(showReviewValidationError);
});

function importedTransactionRowOptions(transaction, index) {
  const selection = document.createElement("label");
  selection.className = "import-selection";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = transaction._selected;
  checkbox.disabled = state.reviewCommitted || state.reviewCommitting || state.refundSelections.has(transaction._stagedId);
  checkbox.setAttribute("aria-label", `Include ${transaction.description} in import`);
  importRangeSelection.bind(checkbox, transaction._stagedId);
  selection.append(checkbox);
  return {
    currency,
    shortMonthFormatter,
    leadingControl: selection,
    duplicate: transaction._isDuplicate,
    edited: state.reviewEditedIds.has(transaction._stagedId),
    detailContent: refundReviewControl(transaction),
    detailPlacement: "row",
    needsClassification:
      !transaction._refundAlreadyHandled && !state.refundSelections.has(transaction._stagedId)
      && !transactionUi.isInternalTransfer(transaction) && transaction._classificationMatched === false,
    disabled: state.reviewCommitted || state.reviewRefreshing || state.reviewCommitting,
    onEdit: () => openImportedTransactionEditor(index),
  };
}

function refundSelectionPayload(selections = state.refundSelections) {
  return [...selections].map(([stagedId, purchaseId]) => ({ stagedId, purchaseId }));
}

function importRowsForRequest(rows) {
  // Candidate purchases are server-owned suggestions, not client transaction edits.
  return rows.map(({ _refundCandidates, ...row }) => row);
}

async function chooseRefundMatch(transaction, purchaseId) {
  if (state.reviewCommitted || state.reviewCommitting || state.reviewRefreshing || importBulk.isActive()) return;
  const choices = new Map(state.refundSelections);
  if (purchaseId === null) choices.delete(transaction._stagedId);
  else choices.set(transaction._stagedId, purchaseId);
  const rows = state.importedTransactions.map((row) => row._stagedId === transaction._stagedId
    ? { ...row, _selected: purchaseId === null } : row);
  try {
    const request = refreshEditedImport(rows, [], choices);
    renderImportedTransactions();
    await request;
  } catch (error) { showReviewValidationError(error); }
  renderImportedTransactions();
}

function refundReviewControl(transaction) {
  const candidates = transaction._refundCandidates || [];
  const purchaseId = state.refundSelections.get(transaction._stagedId);
  const matched = purchaseId !== undefined;
  if (!candidates.length && !matched && !transaction._refundAlreadyHandled) return null;
  const box = document.createElement("section");
  box.className = "import-refund-match";
  const id = transaction._stagedId;
  const busy = state.reviewRefreshing || state.reviewCommitting || importBulk.isActive();
  const controls = document.createElement("div");
  controls.className = "import-refund-controls";
  const panel = document.createElement("div");
  panel.id = `refund-details-${id}`;
  panel.className = "import-refund-details";
  panel.hidden = !state.refundDetailsOpen.has(id);
  const title = document.createElement("h4");
  title.textContent = matched
    ? (state.reviewCommitted ? "Purchase marked refunded" : "Purchase will be marked refunded")
    : transaction._refundAlreadyHandled ? "Refund already handled"
      : `Possible refund · ${candidates.length === 1 ? "same-price purchase found" : `${candidates.length} same-price purchases found`}`;
  const explanation = document.createElement("p");
  explanation.textContent = transaction._refundAlreadyHandled
    ? "A prior import matched this credit to a purchase. It is a duplicate and is unchecked; importing it again would also count the credit."
    : matched
    ? (state.reviewCommitted ? "The refund credit was saved and linked to the original purchase." : "On confirmation: save this credit linked to the purchase, reducing its net cost without counting the credit twice. Nothing is saved yet.")
    : "Check the purchase below: the exact price within 90 days is only a suggestion. On confirmation, both transactions stay in the CSV with a one-to-one refund link. The purchase shows the net cost and the credit is not counted twice.";
  panel.append(title, explanation);
  const detailToggle = document.createElement("button");
  detailToggle.type = "button";
  detailToggle.className = "import-refund-expand";
  detailToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>';
  detailToggle.setAttribute("aria-label", `Refund match details for ${transaction.description}`);
  detailToggle.setAttribute("aria-controls", panel.id);
  const setExpanded = (open) => {
    if (open) state.refundDetailsOpen.add(id); else state.refundDetailsOpen.delete(id);
    panel.hidden = !open;
    detailToggle.setAttribute("aria-expanded", String(open));
  };
  setExpanded(!panel.hidden);
  detailToggle.addEventListener("click", () => setExpanded(panel.hidden));
  const chosenId = () => purchaseId ?? (candidates.length === 1 ? candidates[0]._id : state.refundCandidateChoices.get(id));
  const purchaseRows = document.createElement("div");
  purchaseRows.className = "import-refund-purchases";
  for (const purchase of candidates.filter((row) => !matched || row._id === purchaseId)) {
    let selection = null;
    if (!matched && candidates.length > 1) {
      selection = document.createElement("label");
      selection.className = "import-selection";
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = `refund-purchase-${id}`;
      radio.value = String(purchase._id); radio.checked = chosenId() === purchase._id;
      radio.disabled = busy || state.reviewCommitted;
      radio.setAttribute("aria-label", `Match refund to ${purchase.description} on ${purchase.date}`);
      radio.addEventListener("change", () => { if (radio.checked) state.refundCandidateChoices.set(id, purchase._id); });
      selection.append(radio);
    }
    purchaseRows.append(transactionUi.createTransactionRow(purchase, {
      currency, shortMonthFormatter, showYear: true, showEdit: false, leadingControl: selection,
    }));
  }
  panel.append(purchaseRows);
  if (!state.reviewCommitted && !transaction._refundAlreadyHandled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "import-refund-action";
    button.textContent = matched ? "Undo match" : "Mark as refunded";
    button.title = matched ? "Undo this staged refund match" : "Match this credit to a saved purchase; saved only on import confirmation";
    button.disabled = busy;
    button.addEventListener("click", () => {
      if (!matched && !candidates.some((purchase) => purchase._id === chosenId())) {
        setExpanded(true); purchaseRows.querySelector("input")?.focus(); return;
      }
      chooseRefundMatch(transaction, matched ? null : chosenId());
    });
    controls.append(button);
  } else {
    const status = document.createElement("span");
    status.className = "import-refund-status";
    status.textContent = transaction._refundAlreadyHandled ? "Refund already handled" : "Purchase marked refunded";
    controls.append(status);
  }
  controls.append(detailToggle);
  box.append(controls, panel);
  return box;
}

const importBulk = window.LedgerTransactionBulk.create({
  container: elements.reviewList, staged: true, importSelection: true,
  getGroupFilter: () => state.reviewFieldFilters.group,
  getTransactions: () => state.importedTransactions,
  getAllTransactions: () => [...state.availableTransactions, ...state.importedTransactions],
  getKey: (row) => row._stagedId,
  getRevision: () => state.reviewSession?.token,
  render: () => renderImportedTransactions(),
  onModeChange: () => { importRangeSelection.reset(); updateReviewSelection(); },
  onFlagChange: (row) => state.reviewEditedIds.add(row._stagedId),
  onStage: async (ids, proposed) => {
    const replacements = new Map(proposed.map((row) => [row._stagedId, row]));
    const updated = state.importedTransactions.map((row) => replacements.get(row._stagedId) || row);
    await refreshEditedImport(updated, ids);
    // Import inclusion and duplicate markers are not bulk-edit selections.
    configureReviewFieldFilters(state.reviewFieldFilters);
  },
});

async function refreshEditedImport(transactions, editedIds = [], refundSelections = state.refundSelections) {
  // Track explicit user changes only, not inclusion toggles or automatic detection.
  // Occurrence IDs keep identical transactions independent and never enter the CSV.
  const originals = new Map(state.importedTransactions.map((row) => [row._stagedId, row]));
  const edited = new Set(editedIds);
  const changedIds = transactions.filter((row) => edited.has(row._stagedId)
    && originals.has(row._stagedId)
    && window.LedgerTransactionBulk.changedFields(originals.get(row._stagedId), row).length)
    .map((row) => row._stagedId);
  refundSelections = new Map(refundSelections);
  for (const id of changedIds) {
    const before = originals.get(id);
    const after = transactions.find((row) => row._stagedId === id);
    const withoutFollowUpFlag = (row) => ({ ...row, flags: transactionUi.transactionFlags(row).filter((flag) => flag !== "flagged").sort().join(",") });
    if (!window.LedgerTransactionBulk.changedFields(withoutFollowUpFlag(before), withoutFollowUpFlag(after)).length) continue;
    // An editor change discards just this row's refund decision; it can be reviewed again.
    if (refundSelections.delete(id)) {
      transactions = transactions.map((row) => row._stagedId === id ? { ...row, _selected: true } : row);
    }
  }
  const generation = ++state.reviewGeneration;
  const session = state.reviewSession;
  state.reviewRefreshing = true;
  state.reviewValidationFailed = true;
  updateReviewSelection();
  try {
    const response = await fetch("/api/transactions/staged-preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: state.revision, transactions: importRowsForRequest(transactions),
        ...(session?.source === "creditkarma" ? { importToken: session.token } : {}),
        refundSelections: refundSelectionPayload(refundSelections) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (generation !== state.reviewGeneration || session !== state.reviewSession) return;
    if (!response.ok) throw new Error(payload.error || "Could not validate the edited import.");
    if (typeof payload.transferPlan !== "string") {
      throw new Error("Restart the Ledger Python server to enable persisted transfer detection, then start the import again.");
    }
    const checked = new Map(payload.transactions.map((row) => [row._stagedId, row]));
    state.importedTransactions = transactions.map((row) => ({ ...row, ...checked.get(row._stagedId), _selected: row._selected }));
    state.refundSelections = refundSelections;
    changedIds.forEach((id) => state.reviewEditedIds.add(id));
    state.transferPlan = payload.transferPlan;
    state.existingTransferUpdates = payload.existingTransferUpdates || [];
    state.reviewValidationFailed = false;
    elements.reviewError.hidden = true;
    const unmatched = state.importedTransactions.filter((row) => !row._isDuplicate && !state.refundSelections.has(row._stagedId) && !transactionUi.isInternalTransfer(row) && row._classificationMatched === false).length;
    const transfers = state.importedTransactions.filter((row) => !row._isDuplicate && transactionUi.isInternalTransfer(row)).length;
    elements.reviewSubtitle.textContent = `${transactions.length} parsed · ${payload.new} new (${unmatched} no rule matched, ${transfers} internal transfers) · ${payload.duplicates} duplicates`;
    return true;
  } catch (error) {
    if (generation !== state.reviewGeneration || session !== state.reviewSession) return;
    throw error;
  } finally {
    if (generation === state.reviewGeneration) {
      state.reviewRefreshing = false;
      updateReviewSelection();
    }
  }
}

function showReviewValidationError(error) {
  if (!state.reviewSession) return;
  elements.reviewError.textContent = error.message || "Could not refresh transfer matches. Change the selection to retry.";
  elements.reviewError.hidden = false;
}

function updateReviewSelection() {
  const selected = state.importedTransactions.filter((transaction) => transaction._selected).length;
  const matched = state.refundSelections.size;
  elements.confirmReview.textContent = matched
    ? `Confirm ${selected} ${selected === 1 ? "import" : "imports"} · ${matched} ${matched === 1 ? "refund" : "refunds"}`
    : `Import selected (${selected})`;
  elements.confirmReview.disabled = state.reviewCommitted || state.reviewCommitting || state.reviewRefreshing
    || state.reviewValidationFailed || (selected === 0 && matched === 0) || importBulk.isActive();
}

function importReviewType(transaction) {
  if (transaction._isDuplicate) return "duplicate";
  if (state.refundSelections.has(transaction._stagedId)) return "new";
  if (transactionUi.isInternalTransfer(transaction)) return "new";
  if (transaction._classificationMatched === false) return "unmatched";
  return "new";
}

function updateImportReviewFilters() {
  for (const button of elements.reviewFilters) {
    const enabled = state.reviewFilters[button.dataset.reviewFilter] === true;
    button.setAttribute("aria-pressed", String(enabled));
  }
}

function toggleImportReviewFilter(event) {
  const filter = event.currentTarget.dataset.reviewFilter;
  if (!(filter in state.reviewFilters)) return;
  state.reviewFilters[filter] = !state.reviewFilters[filter];
  renderImportedTransactions();
}

function renderImportedTransactions() {
  renderReviewFieldFilterChips();
  const count = state.importedTransactions.length;
  updateReviewSelection();
  updateImportReviewFilters();
  if (count === 0) {
    importRangeSelection.sync([], state.reviewSession);
    importBulk.render([], importedTransactionRowOptions);
    const empty = document.createElement("p");
    empty.className = "empty-import-review";
    empty.textContent = "No valid transactions were found in this import.";
    elements.reviewList.replaceChildren(empty);
    return;
  }
  const visibleIndexes = state.importedTransactions
    .map((_transaction, index) => index)
    .filter((index) => (
      state.reviewFilters[importReviewType(state.importedTransactions[index])]
      && importedTransactionMatchesFieldFilters(state.importedTransactions[index])
    ));
  if (visibleIndexes.length === 0) {
    importRangeSelection.sync([], state.reviewSession);
    importBulk.render([], importedTransactionRowOptions);
    const empty = document.createElement("p");
    empty.className = "empty-import-review";
    empty.textContent = "No transactions match the enabled filters.";
    elements.reviewList.replaceChildren(empty);
    renderExistingTransferUpdates();
    return;
  }
  const visibleTransactions = transactionUi.sortTransactions(
    visibleIndexes.map((index) => state.importedTransactions[index]),
    importReviewSort.value(),
  );
  importRangeSelection.sync(importBulk.filter(visibleTransactions).filter((row) => !state.refundSelections.has(row._stagedId)).map((row) => row._stagedId), state.reviewSession);
  importBulk.render(
    visibleTransactions,
    (transaction) => importedTransactionRowOptions(
      transaction,
      state.importedTransactions.indexOf(transaction),
    ),
  );
  renderExistingTransferUpdates();
}

function renderExistingTransferUpdates() {
  if (state.existingTransferUpdates.length && !state.reviewCommitted) {
    const review = document.createElement("details");
    review.className = "import-transfer-updates";
    review.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${state.existingTransferUpdates.length} existing transactions will also be flagged as internal transfers`;
    const note = document.createElement("p");
    note.textContent = "These are the matching sides already in Ledger. Only their transfer flags change. Uncheck the incoming counterpart to leave an existing row unchanged.";
    review.append(summary, note);
    for (const row of transactionUi.sortTransactions(state.existingTransferUpdates, importReviewSort.value())) {
      review.append(transactionUi.createTransactionRow(row, { currency, shortMonthFormatter, showEdit: false }));
    }
    elements.reviewList.prepend(review);
  }
}

function editField(name) {
  return elements.editForm.elements.namedItem(name);
}

function showEditError(message) {
  elements.editError.textContent = message;
  elements.editError.hidden = false;
}

function clearEditError() {
  elements.editError.textContent = "";
  elements.editError.hidden = true;
}

function setEditBusy(busy) {
  state.editBusy = busy;
  elements.editForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = busy;
  });
  if (!busy) transactionUi.refreshTransactionTagPicker(elements.editForm);
  elements.saveEdit.textContent = busy ? "Saving…" : "Save transaction";
}

function openImportedTransactionEditor(index) {
  const transaction = state.importedTransactions[index];
  if (!transaction) return;
  state.editingImportedIndex = index;
  clearEditError();
  transactionUi.configureTransactionTagPicker(
    elements.editForm,
    transactionUi.tagsFromTransactions(state.importedTransactions).concat(
      state.availableTransactionTags,
    ),
  );
  transactionUi.populateTransactionEditor(elements.editForm, transaction, {}, {
    transactions: [...state.availableTransactions, ...state.importedTransactions],
  });
  if (elements.reviewDialog.open) elements.reviewDialog.close();
  elements.editDialog.showModal();
  editField("description").focus();
}

function closeImportedTransactionEditor() {
  if (state.editBusy) return;
  elements.editDialog.close();
  elements.reviewDialog.showModal();
}

function transactionFromEditForm() {
  return transactionUi.transactionFromEditor(
    elements.editForm,
    state.importedTransactions[state.editingImportedIndex],
  );
}

async function saveImportedTransaction(event) {
  event.preventDefault();
  const index = state.editingImportedIndex;
  const current = state.importedTransactions[index];
  if (!current) return;
  const transaction = transactionFromEditForm();
  clearEditError();
  const updated = [...state.importedTransactions];
  updated[index] = {
    ...current,
    ...transaction,
    amount: Number(transaction.amount),
    _selected: true,
  };
  setEditBusy(true);
  try {
    if (!await refreshEditedImport(updated, [current._stagedId])) return;
    configureReviewFieldFilters(state.reviewFieldFilters);
    renderImportedTransactions();
    elements.editDialog.close();
    elements.reviewDialog.showModal();
  } catch (error) {
    showEditError(error.message || "Could not validate the edited transaction.");
  } finally { setEditBusy(false); }
}

function renderResult(result, source, token) {
  importBulk.reset();
  if (
    !result ||
    !Number.isInteger(result.parsed) ||
    !Number.isInteger(result.new) ||
    !Number.isInteger(result.duplicates) ||
    typeof result.transferPlan !== "string" ||
    !Array.isArray(result.transactions)
  ) {
    throw new Error("Ledger returned an outdated import response. Restart the Ledger server and try again.");
  }
  elements.reviewEyebrow.textContent = `${sourceLabels[source] ?? source} import`;
  elements.reviewTitle.textContent = "Review transactions";
  const unmatched = result.transactions.filter(
    (transaction) => !transaction._isDuplicate &&
      !transactionUi.isInternalTransfer(transaction) &&
      transaction._classificationMatched === false,
  ).length;
  const internalTransfers = result.transactions.filter(
    (transaction) => !transaction._isDuplicate && transactionUi.isInternalTransfer(transaction),
  ).length;
  const invalid = Number.isInteger(result.invalid) ? result.invalid : 0;
  elements.reviewSubtitle.textContent = source === "csv"
    ? `${result.rowCount ?? result.parsed + invalid} rows · ${result.parsed} valid (` +
      `${result.new} new, ${result.duplicates} duplicates) · ${invalid} invalid · ` +
      `${unmatched} no rule matched · ${internalTransfers} internal transfers`
    : `${result.parsed} parsed · ${result.new} new (` +
      `${unmatched} no rule matched, ${internalTransfers} internal transfers) · ` +
      `${result.duplicates} duplicates`;
  elements.reviewInvalidNote.hidden = invalid === 0;
  elements.reviewInvalidNote.textContent = invalid === 0
    ? ""
    : `${invalid} invalid CSV ${invalid === 1 ? "row was" : "rows were"} skipped. ` +
      "Every row needs a valid date, description, and amount.";
  if (source === "walmart" && result.skippedOrders) {
    elements.reviewInvalidNote.hidden = false;
    elements.reviewInvalidNote.textContent = `${result.skippedOrders} Walmart ${result.skippedOrders === 1 ? "order was" : "orders were"} not imported. `
      + "Cancelled, pending, and returned/refunded orders need separate review. Keep Credit Karma's Walmart exclusion off to retain uncovered charges. "
      + (result.warnings || []).slice(0, 3).join(" ")
      + (result.skippedOrders > 3 ? ` (${result.skippedOrders - 3} more skipped orders.)` : "");
  }
  if (source === "schwab" && result.warnings?.length) {
    elements.reviewInvalidNote.hidden = false;
    elements.reviewInvalidNote.textContent = result.warnings.join(" ");
  }
  elements.reviewError.hidden = true;
  elements.reviewError.textContent = "";
  state.revision = result.revision;
  state.reviewSession = { source, token };
  state.reviewEditedIds.clear();
  state.refundSelections.clear();
  state.refundDetailsOpen.clear();
  state.refundCandidateChoices.clear();
  state.reviewCommitted = false;
  state.reviewCommitting = false;
  state.reviewRefreshing = false;
  state.reviewValidationFailed = false;
  state.reviewGeneration += 1;
  state.transferPlan = result.transferPlan;
  state.existingTransferUpdates = result.existingTransferUpdates || [];
  state.reviewFilters = { duplicate: false, unmatched: true, new: true };
  state.importedTransactions = Array.isArray(result.transactions)
    ? result.transactions.map((transaction) => ({
        ...transaction,
        _selected: !transaction._isDuplicate && Number(transaction.amount) !== 0,
      }))
    : [];
  state.editingImportedIndex = null;
  state.reviewFieldFilters = {
    description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
  };
  configureReviewFieldFilters(state.reviewFieldFilters);
  setReviewFilterPopover(false);
  elements.cancelReview.hidden = false;
  elements.cancelReview.disabled = false;
  elements.confirmReview.hidden = false;
  elements.reviewDashboardLink.hidden = true;
  renderImportedTransactions();
  if (elements.reviewDialog.open) elements.reviewDialog.close();
  elements.reviewDialog.showModal();
}

function reviewSessionUrl(action) {
  const session = state.reviewSession;
  if (!session) return "";
  return `/api/${session.source}-import-sessions/${encodeURIComponent(session.token)}/${action}`;
}

function clearReviewState() {
  importBulk.discardFlags();
  state.reviewGeneration += 1;
  state.reviewRefreshing = false;
  state.reviewValidationFailed = false;
  state.transferPlan = null;
  state.existingTransferUpdates = [];
  importBulk.reset();
  state.reviewSession = null;
  state.reviewCommitted = false;
  state.importedTransactions = [];
  state.reviewEditedIds.clear();
  state.refundSelections.clear();
  state.refundDetailsOpen.clear();
  state.refundCandidateChoices.clear();
  state.editingImportedIndex = null;
  state.reviewFieldFilters = {
    description: "", category: "", subcategory: "", tag: "", accountName: "", provider: "",
  };
  elements.reviewInvalidNote.hidden = true;
  elements.reviewInvalidNote.textContent = "";
}

async function loadAvailableTransactionTags() {
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    state.availableTransactionTags = transactionUi.tagsFromTransactions(payload.transactions);
    state.availableTransactions = payload.transactions;
  } catch {
    // A missing or temporarily unavailable database simply means there are no existing tags yet.
  }
}

async function cancelImportReview() {
  if (state.reviewCommitting) return;
  if (state.reviewCommitted) {
    if (elements.reviewDialog.open) elements.reviewDialog.close();
    clearReviewState();
    return;
  }
  if (state.reviewSession && state.importedTransactions.length && !window.confirm(
    "Discard this import review? No transactions or refund changes from this review will be saved. " +
    "Your edits and selections will be lost, and you will need to import the source again. " +
    "Choose Cancel to keep reviewing.",
  )) return;
  const cancelUrl = reviewSessionUrl("cancel");
  if (elements.reviewDialog.open) elements.reviewDialog.close();
  clearReviewState();
  if (cancelUrl) {
    try {
      await fetch(cancelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (_error) {
      // The preview is already discarded locally; the expiring server session is harmless.
    }
  }
}

async function confirmImportReview() {
  const commitUrl = reviewSessionUrl("commit");
  if (!commitUrl || state.reviewCommitted || state.reviewCommitting || state.reviewRefreshing || state.reviewValidationFailed) return;
  if (!await importBulk.flushFlags()) return;
  if (state.reviewCommitting || state.reviewCommitted || reviewSessionUrl("commit") !== commitUrl) return;
  const transactions = state.importedTransactions.filter((transaction) => transaction._selected);
  if (transactions.length === 0 && state.refundSelections.size === 0) return;

  elements.reviewError.hidden = true;
  state.reviewCommitting = true;
  elements.closeReview.disabled = true;
  elements.confirmReview.disabled = true;
  elements.cancelReview.disabled = true;
  renderImportedTransactions();
  elements.reviewDialog.querySelectorAll(".bulk-mode-button").forEach((button) => { button.disabled = true; });
  elements.confirmReview.textContent = "Importing…";
  try {
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: importRowsForRequest(transactions), transferPlan: state.transferPlan, refundSelections: refundSelectionPayload() }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Import failed (${response.status}).`);

    state.reviewCommitted = true;
    state.revision = payload.import?.revision || state.revision;
    elements.reviewEyebrow.textContent = "Import complete";
    elements.reviewTitle.textContent = state.refundSelections.size ? "Import review saved" : "Transactions imported";
    const committed = payload.import?.committed ?? transactions.length;
    elements.reviewSubtitle.textContent = `${committed} ${
      committed === 1 ? "transaction was" : "transactions were"
    } added to Ledger. ${payload.import?.existingTransfersUpdated || 0} existing transactions flagged as internal transfers.`
      + (payload.import?.purchasesRefunded ? ` ${payload.import.purchasesRefunded} ${payload.import.purchasesRefunded === 1 ? "purchase" : "purchases"} marked refunded; matching credits were not imported.` : "");
    elements.cancelReview.hidden = true;
    elements.confirmReview.hidden = true;
    elements.reviewDashboardLink.hidden = false;
    renderImportedTransactions();
  } catch (error) {
    elements.reviewError.textContent = error instanceof Error ? error.message : "The import could not be saved.";
    elements.reviewError.hidden = false;
    elements.confirmReview.disabled = false;
    elements.cancelReview.disabled = false;
    updateReviewSelection();
  } finally {
    state.reviewCommitting = false;
    elements.closeReview.disabled = false;
    elements.reviewDialog.querySelectorAll(".bulk-mode-button").forEach((button) => { button.disabled = false; });
    renderImportedTransactions();
  }
}

elements.amazonImportButton.addEventListener("click", startAmazonImport);
elements.amazonCancelButton.addEventListener("click", cancelAmazonImport);
elements.creditKarmaImportButton.addEventListener("click", startCreditKarmaImport);
elements.creditKarmaCancelButton.addEventListener("click", cancelCreditKarmaImport);
elements.aliExpressImportButton.addEventListener("click", startAliExpressImport);
elements.aliExpressCancelButton.addEventListener("click", cancelAliExpressImport);
elements.venmoImportButton.addEventListener("click", startVenmoImport);
elements.venmoCancelButton.addEventListener("click", cancelVenmoImport);
elements.ebayImportButton.addEventListener("click", startEbayImport);
elements.ebayCancelButton.addEventListener("click", cancelEbayImport);
elements.walmartImportButton.addEventListener("click", startWalmartImport);
elements.schwabImportButton.addEventListener("click", startSchwabImport);
elements.schwabCancelButton.addEventListener("click", cancelSchwabImport);
elements.capitalOneImportButton.addEventListener("click", startCapitalOneImport);
elements.capitalOneCancelButton.addEventListener("click", cancelCapitalOneImport);
elements.capitalOneFile.addEventListener("change", () => {
  elements.capitalOneFileButton.disabled = state.capitalOneBusy || !elements.capitalOneFile.files?.length;
});
elements.capitalOneFileButton.addEventListener("click", importCapitalOneFile);
elements.walmartCancelButton.addEventListener("click", cancelWalmartImport);
elements.appleCardImportButton.addEventListener("click", startAppleCardImport);
elements.appleCardCancelButton.addEventListener("click", cancelAppleCardImport);
elements.appleCardFileImportButton.addEventListener("click", importAppleCardFile);
elements.appleCardFile.addEventListener("change", updateAppleCardFileButton);
elements.csvImportFile.addEventListener("change", updateCsvImportButton);
elements.csvImportButton.addEventListener("click", importLedgerCsv);
elements.closeReview.addEventListener("click", cancelImportReview);
elements.cancelReview.addEventListener("click", cancelImportReview);
elements.confirmReview.addEventListener("click", confirmImportReview);
elements.reviewFilters.forEach((button) => {
  button.addEventListener("click", toggleImportReviewFilter);
});
elements.reviewSearch.addEventListener("input", () => {
  state.reviewFieldFilters.description = elements.reviewSearch.value.trim();
  renderImportedTransactions();
});
elements.reviewFilterButton.addEventListener("click", () => {
  const open = elements.reviewFilterButton.getAttribute("aria-expanded") !== "true";
  setReviewFilterPopover(open);
  if (open) elements.reviewCategoryFilter.focus();
});
elements.reviewCategoryFilter.addEventListener("change", () => {
  populateReviewSubcategories(
    elements.reviewCategoryFilter.value,
    elements.reviewSubcategoryFilter.value,
  );
});
elements.resetReviewFieldFilters.addEventListener("click", () => {
  transactionUi.setFlagFilter(elements.reviewFlaggedFilter, "");
  elements.reviewGroupFilter.value = "";
  elements.reviewCategoryFilter.value = "";
  populateReviewSubcategories("");
  elements.reviewTagFilter.value = "";
  elements.reviewAccountFilter.value = "";
  elements.reviewProviderFilter.value = "";
  elements.reviewCategoryFilter.focus();
});
transactionUi.bindLiveTransactionFilters(elements.reviewFilterPopover, () => {
  state.reviewFieldFilters = { ...state.reviewFieldFilters, ...reviewFilterDraft() };
  renderImportedTransactions();
}, elements.resetReviewFieldFilters);
elements.clearReviewFieldFilters.addEventListener("click", () => {
  state.reviewFieldFilters = {
    ...state.reviewFieldFilters,
    flagged: "",
    group: "",
    category: "", subcategory: "", tag: "", accountName: "", provider: "",
  };
  configureReviewFieldFilters(state.reviewFieldFilters);
  renderImportedTransactions();
  elements.reviewFilterButton.focus();
});

elements.reviewDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.reviewFilterButton.getAttribute("aria-expanded") === "true") {
    event.preventDefault();
    event.stopPropagation();
    setReviewFilterPopover(false);
    elements.reviewFilterButton.focus();
  }
});
elements.reviewDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelImportReview();
});
elements.reviewDialog.addEventListener("click", (event) => {
  if (event.target === elements.reviewDialog) cancelImportReview();
});
elements.editForm.addEventListener("submit", saveImportedTransaction);
elements.closeEdit.addEventListener("click", closeImportedTransactionEditor);
elements.cancelEdit.addEventListener("click", closeImportedTransactionEditor);
elements.editDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeImportedTransactionEditor();
});
elements.editDialog.addEventListener("click", (event) => {
  if (event.target === elements.editDialog) closeImportedTransactionEditor();
});

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !extensionMessageSources.has(event.data?.source)
  ) {
    return;
  }
  if (event.data.action === "ready") {
    setExtensionReady(true, event.data.payload?.version || "");
  } else if (event.data.action === "capitalOneProgress" && state.capitalOneSessionToken
    && event.data.payload?.token === state.capitalOneSessionToken) {
    renderCapitalOneProgress(event.data.payload.progress, event.data.payload.message);
  } else if (event.data.action === "capitalOneError" && state.capitalOneSessionToken
    && (!event.data.payload?.token || event.data.payload.token === state.capitalOneSessionToken)) {
    const message = event.data.payload?.message || "Capital One import failed.";
    void cancelCapitalOneImport().then(() => showCapitalOneError(message));
  } else if (event.data.action === "schwabProgress" && state.schwabSessionToken
    && event.data.payload?.token === state.schwabSessionToken) {
    renderSchwabProgress(event.data.payload.progress, event.data.payload.message);
  } else if (event.data.action === "schwabError" && state.schwabSessionToken
    && (!event.data.payload?.token || event.data.payload.token === state.schwabSessionToken)) {
    const message = event.data.payload?.message || "Schwab import failed.";
    void cancelSchwabImport().then(() => showSchwabError(message));
  } else if (event.data.action === "walmartProgress" && state.walmartSessionToken
    && event.data.payload?.token === state.walmartSessionToken) {
    renderWalmartProgress(event.data.payload.progress, event.data.payload.message);
  } else if (event.data.action === "walmartError" && state.walmartSessionToken
    && (!event.data.payload?.token || event.data.payload.token === state.walmartSessionToken)) {
    const message = event.data.payload?.message || "Walmart import failed.";
    void cancelWalmartImport().then(() => showWalmartError(message));
  } else if (event.data.action === "progress" && state.amazonSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderAmazonProgress(progress, message || "Importing Amazon orders…", status);
  } else if (event.data.action === "error") {
    showAmazonError(event.data.payload?.message || "The companion extension reported an Amazon import error.");
    if (state.amazonSessionToken) {
      const token = state.amazonSessionToken;
      fetch(`/api/amazon-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      finishAmazonSession();
    }
  } else if (event.data.action === "creditKarmaProgress" && state.creditKarmaSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderCreditKarmaProgress(
      progress,
      message || "Importing Credit Karma transactions…",
      status,
    );
  } else if (event.data.action === "creditKarmaError") {
    showCreditKarmaError(
      event.data.payload?.message || "The Credit Karma importer extension reported an error.",
    );
    if (state.creditKarmaSessionToken) {
      const token = state.creditKarmaSessionToken;
      fetch(`/api/creditkarma-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      finishCreditKarmaSession();
    }
  } else if (event.data.action === "aliExpressProgress" && state.aliExpressSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderAliExpressProgress(progress, message || "Importing AliExpress orders…", status);
  } else if (event.data.action === "aliExpressError") {
    showAliExpressError(event.data.payload?.message || "The AliExpress importer extension reported an error.");
    if (state.aliExpressSessionToken) {
      const token = state.aliExpressSessionToken;
      fetch(`/api/aliexpress-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
      finishAliExpressSession();
    }
  } else if (event.data.action === "venmoProgress" && state.venmoSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderVenmoProgress(progress, message || "Importing Venmo transactions…", status);
  } else if (event.data.action === "venmoError") {
    showVenmoError(event.data.payload?.message || "The Venmo importer extension reported an error.");
    if (state.venmoSessionToken) {
      const token = state.venmoSessionToken;
      fetch(`/api/venmo-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
      finishVenmoSession();
    }
  } else if (event.data.action === "ebayProgress" && state.ebaySessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderEbayProgress(progress, message || "Importing eBay purchases...", status);
  } else if (event.data.action === "ebayError") {
    showEbayError(event.data.payload?.message || "The eBay importer extension reported an error.");
    if (state.ebaySessionToken) {
      const token = state.ebaySessionToken;
      fetch(`/api/ebay-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
      finishEbaySession();
    }
  } else if (event.data.action === "appleCardProgress" && state.appleCardSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderAppleCardProgress(progress, message || "Importing Apple Card transactions...", status);
  } else if (event.data.action === "appleCardError") {
    showAppleCardError(event.data.payload?.message || "The Apple Card importer extension reported an error.");
    if (state.appleCardSessionToken) {
      const token = state.appleCardSessionToken;
      fetch(`/api/applecard-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }).catch(() => {});
      finishAppleCardSession();
    }
  }
});

initializeImporterTabs();
initializeDirectImportDates();
window.addEventListener("ledger-import-preferences-change", () => initializeDirectImportDates({ preserveEdits: true }));
loadAvailableTransactionTags();
setExtensionReady(false);
for (const delay of [0, 400, 1200]) {
  window.setTimeout(
    () =>
      window.postMessage(
        { source: "ledger-web-app", action: "extensionPing" },
        window.location.origin,
      ),
    delay,
  );
}
