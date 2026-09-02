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
  revision: "",
  importedTransactions: [],
  editingImportedIndex: null,
  editBusy: false,
};

const sourceLabels = { creditkarma: "Credit Karma", amazon: "Amazon", aliexpress: "AliExpress" };
const MIN_ALIEXPRESS_EXTENSION_VERSION = "0.4.0";
const extensionMessageSources = new Set(["ledger-data-importer", "ledger-amazon-extension"]);
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

const elements = {
  result: document.querySelector("#import-result"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  resultSources: document.querySelector("#result-sources"),
  amazonStartDate: document.querySelector("#amazon-start-date"),
  amazonEndDate: document.querySelector("#amazon-end-date"),
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
  creditKarmaImportButton: document.querySelector("#creditkarma-import-button"),
  creditKarmaCancelButton: document.querySelector("#creditkarma-cancel-button"),
  creditKarmaProgress: document.querySelector("#creditkarma-progress"),
  creditKarmaProgressBar: document.querySelector("#creditkarma-progress-bar"),
  creditKarmaProgressMessage: document.querySelector("#creditkarma-progress-message"),
  creditKarmaDirectError: document.querySelector("#creditkarma-direct-error"),
  aliExpressStartDate: document.querySelector("#aliexpress-start-date"),
  aliExpressEndDate: document.querySelector("#aliexpress-end-date"),
  aliExpressImportButton: document.querySelector("#aliexpress-import-button"),
  aliExpressCancelButton: document.querySelector("#aliexpress-cancel-button"),
  aliExpressProgress: document.querySelector("#aliexpress-progress"),
  aliExpressProgressBar: document.querySelector("#aliexpress-progress-bar"),
  aliExpressProgressMessage: document.querySelector("#aliexpress-progress-message"),
  aliExpressDirectError: document.querySelector("#aliexpress-direct-error"),
  reviewDialog: document.querySelector("#import-review-dialog"),
  reviewSubtitle: document.querySelector("#import-review-subtitle"),
  reviewList: document.querySelector("#import-review-list"),
  closeReview: document.querySelector("#close-import-review"),
  editDialog: document.querySelector("#import-edit-dialog"),
  editForm: document.querySelector("#import-edit-form"),
  editError: document.querySelector("#import-edit-error"),
  closeEdit: document.querySelector("#close-import-edit"),
  cancelEdit: document.querySelector("#cancel-import-edit"),
  deleteImported: document.querySelector("#delete-imported-transaction"),
  saveEdit: document.querySelector("#save-import-edit"),
};

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
  if (ready && !state.aliExpressExtensionReady) {
    elements.aliExpressDirectError.textContent =
      `AliExpress requires companion extension ${MIN_ALIEXPRESS_EXTENSION_VERSION} or newer. ` +
      "Open chrome://extensions, reload Ledger Data Importer, then reload this page.";
    elements.aliExpressDirectError.hidden = false;
  } else if (!state.aliExpressSessionToken) {
    clearAliExpressError();
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
    if (payload.status === "complete") {
      renderResult(payload.import);
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
  if (!startDate || !endDate) {
    showAmazonError("Choose both a start date and an end date.");
    return;
  }
  if (startDate > endDate) {
    showAmazonError("The Amazon start date cannot be after the end date.");
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
      body: JSON.stringify({ startDate, endDate }),
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
    if (payload.status === "complete") {
      renderResult(payload.import);
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
      body: JSON.stringify({ startDate, endDate, ignoreAmazon, ignoreAliExpress }),
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
    if (payload.status === "complete") {
      renderResult(payload.import);
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
  if (!startDate || !endDate) return showAliExpressError("Choose both a start date and an end date.");
  if (startDate > endDate) return showAliExpressError("The AliExpress start date cannot be after the end date.");
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
      body: JSON.stringify({ startDate, endDate }),
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

function importedTransactionKey(transaction) {
  return JSON.stringify([
    transaction.date,
    transaction.description,
    Number(transaction.amount).toFixed(2),
    transaction.category,
    transaction.accountName,
    transaction.accountType,
    transaction.provider,
  ]);
}

function remapImportedTransactions(currentTransactions) {
  const matchesByKey = new Map();
  for (const transaction of currentTransactions) {
    const key = importedTransactionKey(transaction);
    if (!matchesByKey.has(key)) matchesByKey.set(key, []);
    matchesByKey.get(key).push(transaction);
  }
  state.importedTransactions = state.importedTransactions.flatMap((transaction) => {
    const matches = matchesByKey.get(importedTransactionKey(transaction));
    return matches?.length ? [matches.shift()] : [];
  });
}

function createImportedTransactionRow(transaction, index) {
  const row = document.createElement("article");
  row.className = "transaction-row";

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
  editButton.setAttribute("aria-label", `Edit ${transaction.description}`);
  editButton.addEventListener("click", () => openImportedTransactionEditor(index));
  actions.append(amount, editButton);

  row.append(dateElement, description, actions);
  return row;
}

function renderImportedTransactions() {
  const count = state.importedTransactions.length;
  elements.reviewSubtitle.textContent = `${count} new ${count === 1 ? "transaction" : "transactions"} created · Review and adjust before continuing`;
  if (count === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-import-review";
    empty.textContent = "No new transactions were created. Everything in this import already existed.";
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
  elements.editForm.querySelectorAll("button, input").forEach((control) => {
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
  ]) {
    editField(field).value = transaction[field];
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
  };
}

async function importedMutation(url, method, transaction = undefined) {
  const body = { revision: state.revision };
  if (transaction !== undefined) body.transaction = transaction;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

async function saveImportedTransaction(event) {
  event.preventDefault();
  const index = state.editingImportedIndex;
  const current = state.importedTransactions[index];
  if (!current) return;
  const transaction = transactionFromEditForm();
  clearEditError();
  setEditBusy(true);
  try {
    const payload = await importedMutation(
      `/api/transactions/${current._id}`,
      "PUT",
      transaction,
    );
    state.revision = payload.revision;
    state.importedTransactions[index] = { ...transaction, amount: Number(transaction.amount) };
    remapImportedTransactions(payload.transactions);
    renderImportedTransactions();
    elements.editDialog.close();
    elements.reviewDialog.showModal();
  } catch (error) {
    showEditError(error instanceof Error ? error.message : "The transaction could not be saved.");
  } finally {
    setEditBusy(false);
  }
}

async function deleteImportedTransaction() {
  const index = state.editingImportedIndex;
  const current = state.importedTransactions[index];
  if (!current) return;
  const confirmed = window.confirm(
    `Permanently delete “${current.description}” for ${currency.format(current.amount)}?\n\n` +
      "This updates the master CSV and cannot be undone.",
  );
  if (!confirmed) return;

  clearEditError();
  setEditBusy(true);
  try {
    const payload = await importedMutation(`/api/transactions/${current._id}`, "DELETE");
    state.revision = payload.revision;
    state.importedTransactions.splice(index, 1);
    remapImportedTransactions(payload.transactions);
    renderImportedTransactions();
    elements.editDialog.close();
    elements.reviewDialog.showModal();
  } catch (error) {
    showEditError(error instanceof Error ? error.message : "The transaction could not be deleted.");
  } finally {
    setEditBusy(false);
  }
}

function renderResult(result) {
  const added = result.added;
  elements.resultTitle.textContent =
    added === 0 ? "Everything was already up to date." : `${added} new ${added === 1 ? "transaction" : "transactions"} added.`;
  elements.resultSummary.textContent = `${result.duplicatesSkipped} duplicate ${
    result.duplicatesSkipped === 1 ? "transaction was" : "transactions were"
  } safely skipped.`;
  elements.resultSources.replaceChildren(
    ...Object.entries(result.sources).map(([key, source]) => {
      const card = document.createElement("article");
      card.className = "result-source";
      const title = document.createElement("strong");
      title.textContent = sourceLabels[key] ?? key;
      const detail = document.createElement("span");
      detail.textContent = `${source.parsed} parsed · ${source.added} added · ${source.duplicatesSkipped} skipped`;
      card.append(title, detail);
      return card;
    }),
  );
  elements.result.hidden = false;
  state.revision = result.revision;
  state.importedTransactions = Array.isArray(result.transactions) ? result.transactions : [];
  state.editingImportedIndex = null;
  renderImportedTransactions();
  if (elements.reviewDialog.open) elements.reviewDialog.close();
  elements.reviewDialog.showModal();
}

elements.amazonImportButton.addEventListener("click", startAmazonImport);
elements.amazonCancelButton.addEventListener("click", cancelAmazonImport);
elements.creditKarmaImportButton.addEventListener("click", startCreditKarmaImport);
elements.creditKarmaCancelButton.addEventListener("click", cancelCreditKarmaImport);
elements.aliExpressImportButton.addEventListener("click", startAliExpressImport);
elements.aliExpressCancelButton.addEventListener("click", cancelAliExpressImport);
elements.closeReview.addEventListener("click", () => elements.reviewDialog.close());
elements.reviewDialog.addEventListener("click", (event) => {
  if (event.target === elements.reviewDialog) elements.reviewDialog.close();
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
  }
});

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
