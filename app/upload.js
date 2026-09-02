"use strict";

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
  appleCardBusy: false,
  appleCardExtensionReady: false,
  appleCardSessionToken: "",
  appleCardPollTimer: null,
  appleCardStartedAt: 0,
  revision: "",
  importedTransactions: [],
  reviewSession: null,
  reviewCommitted: false,
  editingImportedIndex: null,
  editBusy: false,
};

const sourceLabels = { creditkarma: "Credit Karma", amazon: "Amazon", aliexpress: "AliExpress", venmo: "Venmo", ebay: "eBay", applecard: "Apple Card" };
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
  importerTabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
  reviewDialog: document.querySelector("#import-review-dialog"),
  reviewEyebrow: document.querySelector("#import-review-eyebrow"),
  reviewTitle: document.querySelector("#import-review-title"),
  reviewSubtitle: document.querySelector("#import-review-subtitle"),
  reviewError: document.querySelector("#import-review-error"),
  reviewList: document.querySelector("#import-review-list"),
  closeReview: document.querySelector("#close-import-review"),
  cancelReview: document.querySelector("#cancel-import-review"),
  confirmReview: document.querySelector("#confirm-import-review"),
  reviewDashboardLink: document.querySelector("#review-dashboard-link"),
  editDialog: document.querySelector("#import-edit-dialog"),
  editForm: document.querySelector("#import-edit-form"),
  editError: document.querySelector("#import-edit-error"),
  closeEdit: document.querySelector("#close-import-edit"),
  cancelEdit: document.querySelector("#cancel-import-edit"),
  deleteImported: document.querySelector("#delete-imported-transaction"),
  saveEdit: document.querySelector("#save-import-edit"),
};

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

function initializeDirectImportDates() {
  const today = new Date();
  const lookbackStart = new Date(today);
  lookbackStart.setDate(lookbackStart.getDate() - 14);
  const todayIso = localIsoDate(today);
  elements.amazonStartDate.value = localIsoDate(lookbackStart);
  elements.amazonEndDate.value = todayIso;
  elements.amazonStartDate.max = todayIso;
  elements.amazonEndDate.max = todayIso;
  elements.creditKarmaStartDate.value = localIsoDate(lookbackStart);
  elements.creditKarmaEndDate.value = todayIso;
  elements.creditKarmaStartDate.max = todayIso;
  elements.creditKarmaEndDate.max = todayIso;
  elements.aliExpressStartDate.value = localIsoDate(lookbackStart);
  elements.aliExpressEndDate.value = todayIso;
  elements.aliExpressStartDate.max = todayIso;
  elements.aliExpressEndDate.max = todayIso;
  elements.venmoStartDate.value = localIsoDate(lookbackStart);
  elements.venmoEndDate.value = todayIso;
  elements.venmoStartDate.max = todayIso;
  elements.venmoEndDate.max = todayIso;
  elements.ebayStartDate.value = localIsoDate(lookbackStart);
  elements.ebayEndDate.value = todayIso;
  elements.ebayStartDate.max = todayIso;
  elements.ebayEndDate.max = todayIso;
  elements.appleCardStartDate.value = localIsoDate(lookbackStart);
  elements.appleCardEndDate.value = todayIso;
  elements.appleCardStartDate.max = todayIso;
  elements.appleCardEndDate.max = todayIso;
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
  elements.extensionDot.classList.toggle("extension-dot--ready", ready);
  elements.extensionStatus.textContent = ready
    ? `Companion extension connected · v${version || "unknown"}`
    : "Companion extension not detected";
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
      body: JSON.stringify({ startDate, endDate, ignoreAmazon, ignoreAliExpress, ignoreVenmo, ignoreEbay }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Could not start the Credit Karma import (${response.status}).`);
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
      body: JSON.stringify({ startDate, endDate, ...accountIdentity }),
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
    elements.appleCardFileImportButton.disabled = false;
    elements.appleCardImportButton.disabled = !state.appleCardExtensionReady;
  }
}

function createImportedTransactionRow(transaction, index) {
  const row = document.createElement("article");
  row.className = "transaction-row";
  row.classList.toggle("transaction-row--duplicate", transaction._isDuplicate);

  const selection = document.createElement("label");
  selection.className = "import-selection";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = transaction._selected;
  checkbox.disabled = state.reviewCommitted;
  checkbox.setAttribute("aria-label", `Include ${transaction.description} in import`);
  checkbox.addEventListener("change", () => {
    transaction._selected = checkbox.checked;
    updateReviewSelection();
  });
  selection.append(checkbox);

  const parsedDate = new Date(`${transaction.date}T12:00:00Z`);
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
  if (transaction._isDuplicate) {
    const duplicate = document.createElement("span");
    duplicate.className = "duplicate-badge";
    duplicate.textContent = "Duplicate";
    description.append(duplicate);
  }
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
  const income = transaction.category.trim().toLocaleLowerCase() === "income";
  amount.classList.toggle("is-credit", Number(transaction.amount) < 0 || income);
  amount.textContent = currency.format(income ? Math.abs(transaction.amount) : transaction.amount);
  const editButton = document.createElement("button");
  editButton.className = "edit-button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.disabled = state.reviewCommitted;
  editButton.setAttribute("aria-label", `Edit ${transaction.description}`);
  editButton.addEventListener("click", () => openImportedTransactionEditor(index));
  actions.append(amount, editButton);

  row.append(selection, dateElement, description, actions);
  return row;
}

function updateReviewSelection() {
  const selected = state.importedTransactions.filter((transaction) => transaction._selected).length;
  elements.confirmReview.textContent = `Import selected (${selected})`;
  elements.confirmReview.disabled = state.reviewCommitted || selected === 0;
}

function renderImportedTransactions() {
  const count = state.importedTransactions.length;
  updateReviewSelection();
  if (count === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-import-review";
    empty.textContent = "No transactions were found in the selected date range.";
    elements.reviewList.replaceChildren(empty);
    return;
  }
  elements.reviewList.replaceChildren(
    ...state.importedTransactions.map(createImportedTransactionRow),
  );
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
  elements.editForm.querySelectorAll("button, input, textarea").forEach((control) => {
    control.disabled = busy;
  });
  elements.saveEdit.textContent = busy ? "Saving…" : "Save transaction";
}

function openImportedTransactionEditor(index) {
  const transaction = state.importedTransactions[index];
  if (!transaction) return;
  state.editingImportedIndex = index;
  clearEditError();
  elements.editForm.reset();
  for (const field of [
    "date",
    "description",
    "amount",
    "category",
    "accountName",
    "accountType",
    "provider",
    "notes",
  ]) {
    editField(field).value = transaction[field] ?? "";
  }
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
  const formData = new FormData(elements.editForm);
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

async function saveImportedTransaction(event) {
  event.preventDefault();
  const index = state.editingImportedIndex;
  const current = state.importedTransactions[index];
  if (!current) return;
  const transaction = transactionFromEditForm();
  clearEditError();
  state.importedTransactions[index] = {
    ...current,
    ...transaction,
    amount: Number(transaction.amount),
    _selected: true,
  };
  renderImportedTransactions();
  elements.editDialog.close();
  elements.reviewDialog.showModal();
}

function deleteImportedTransaction() {
  const index = state.editingImportedIndex;
  const current = state.importedTransactions[index];
  if (!current) return;
  state.importedTransactions.splice(index, 1);
  renderImportedTransactions();
  elements.editDialog.close();
  elements.reviewDialog.showModal();
}

function renderResult(result, source, token) {
  if (
    !result ||
    !Number.isInteger(result.parsed) ||
    !Number.isInteger(result.new) ||
    !Number.isInteger(result.duplicates) ||
    !Array.isArray(result.transactions)
  ) {
    throw new Error("Ledger returned an outdated import response. Restart the Ledger server and try again.");
  }
  elements.reviewEyebrow.textContent = `${sourceLabels[source] ?? source} import`;
  elements.reviewTitle.textContent = "Review transactions";
  elements.reviewSubtitle.textContent = `${result.parsed} parsed · ${result.new} new · ${result.duplicates} duplicates`;
  elements.reviewError.hidden = true;
  elements.reviewError.textContent = "";
  state.revision = result.revision;
  state.reviewSession = { source, token };
  state.reviewCommitted = false;
  state.importedTransactions = Array.isArray(result.transactions)
    ? result.transactions.map((transaction) => ({
        ...transaction,
        _selected: !transaction._isDuplicate,
      }))
    : [];
  state.editingImportedIndex = null;
  elements.cancelReview.hidden = false;
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
  state.reviewSession = null;
  state.reviewCommitted = false;
  state.importedTransactions = [];
  state.editingImportedIndex = null;
}

async function cancelImportReview() {
  if (state.reviewCommitted) {
    if (elements.reviewDialog.open) elements.reviewDialog.close();
    clearReviewState();
    return;
  }
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
  if (!commitUrl || state.reviewCommitted) return;
  const transactions = state.importedTransactions.filter((transaction) => transaction._selected);
  if (transactions.length === 0) return;

  elements.reviewError.hidden = true;
  elements.confirmReview.disabled = true;
  elements.cancelReview.disabled = true;
  elements.confirmReview.textContent = "Importing…";
  try {
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Import failed (${response.status}).`);

    state.reviewCommitted = true;
    state.revision = payload.import?.revision || state.revision;
    elements.reviewEyebrow.textContent = "Import complete";
    elements.reviewTitle.textContent = "Transactions imported";
    const committed = payload.import?.committed ?? transactions.length;
    elements.reviewSubtitle.textContent = `${committed} ${
      committed === 1 ? "transaction was" : "transactions were"
    } added to Ledger.`;
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
elements.appleCardImportButton.addEventListener("click", startAppleCardImport);
elements.appleCardCancelButton.addEventListener("click", cancelAppleCardImport);
elements.appleCardFileImportButton.addEventListener("click", importAppleCardFile);
elements.closeReview.addEventListener("click", cancelImportReview);
elements.cancelReview.addEventListener("click", cancelImportReview);
elements.confirmReview.addEventListener("click", confirmImportReview);
elements.reviewDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelImportReview();
});
elements.reviewDialog.addEventListener("click", (event) => {
  if (event.target === elements.reviewDialog) cancelImportReview();
});
elements.editForm.addEventListener("submit", saveImportedTransaction);
elements.deleteImported.addEventListener("click", deleteImportedTransaction);
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
