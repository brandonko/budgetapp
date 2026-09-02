"use strict";

const state = {
  revision: "",
  busy: false,
  extensionReady: false,
  amazonSessionToken: "",
  amazonPollTimer: null,
};

const parsers = {
  creditkarma: {
    input: document.querySelector("#creditkarma-file"),
    filename: document.querySelector("#creditkarma-filename"),
    status: document.querySelector("#creditkarma-status"),
    label: "Credit Karma",
  },
  amazon: {
    input: document.querySelector("#amazon-file"),
    filename: document.querySelector("#amazon-filename"),
    status: document.querySelector("#amazon-status"),
    label: "Amazon",
  },
};

const elements = {
  form: document.querySelector("#upload-form"),
  button: document.querySelector("#upload-button"),
  error: document.querySelector("#upload-error"),
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
};

function localIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initializeAmazonDates() {
  const today = new Date();
  const todayIso = localIsoDate(today);
  elements.amazonStartDate.value = `${today.getFullYear()}-01-01`;
  elements.amazonEndDate.value = todayIso;
  elements.amazonStartDate.max = todayIso;
  elements.amazonEndDate.max = todayIso;
}

function setExtensionReady(ready) {
  state.extensionReady = ready;
  elements.extensionDot.classList.toggle("extension-dot--ready", ready);
  elements.extensionStatus.textContent = ready
    ? "Companion extension connected"
    : "Companion extension not detected";
  elements.extensionHelp.open = !ready;
  elements.amazonImportButton.disabled = !ready || Boolean(state.amazonSessionToken);
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
      if (payload.import?.revision) state.revision = payload.import.revision;
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
  clearError();
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

function selectedFiles() {
  return Object.entries(parsers).filter(([, parser]) => parser.input.files.length > 0);
}

function formatFileSize(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function updateFileCard(key) {
  const parser = parsers[key];
  const file = parser.input.files[0];
  parser.filename.textContent = file?.name ?? "Choose JSON file";
  parser.status.textContent = file ? formatFileSize(file.size) : "No file selected";
  parser.input.closest(".parser-card").classList.toggle("parser-card--selected", Boolean(file));
  elements.button.disabled = state.busy || selectedFiles().length === 0 || !state.revision;
  elements.result.hidden = true;
}

function setBusy(busy) {
  state.busy = busy;
  for (const parser of Object.values(parsers)) {
    parser.input.disabled = busy;
  }
  elements.button.disabled = busy || selectedFiles().length === 0 || !state.revision;
  elements.button.firstChild.textContent = busy ? " Importing data " : " Upload selected data ";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
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
      title.textContent = parsers[key]?.label ?? key;
      const detail = document.createElement("span");
      detail.textContent = `${source.parsed} parsed · ${source.added} added · ${source.duplicatesSkipped} skipped`;
      card.append(title, detail);
      return card;
    }),
  );
  elements.result.hidden = false;
  elements.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function initializeRevision() {
  try {
    const response = await fetch("/api/transactions", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "The master CSV could not be loaded.");
    }
    state.revision = payload.revision;
    elements.button.disabled = selectedFiles().length === 0;
  } catch (error) {
    showError(error instanceof Error ? error.message : "The master CSV could not be loaded.");
  }
}

async function uploadData(event) {
  event.preventDefault();
  clearError();
  const selections = selectedFiles();
  if (selections.length === 0) {
    showError("Select at least one source file.");
    return;
  }

  setBusy(true);
  try {
    const files = {};
    for (const [key, parser] of selections) {
      const file = parser.input.files[0];
      files[key] = { name: file.name, content: await file.text() };
    }
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: state.revision, files }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Import failed with status ${response.status}`);
    }
    state.revision = payload.revision;
    elements.form.reset();
    Object.keys(parsers).forEach(updateFileCard);
    renderResult(payload.import);
  } catch (error) {
    showError(error instanceof Error ? error.message : "The selected data could not be imported.");
  } finally {
    setBusy(false);
  }
}

for (const [key, parser] of Object.entries(parsers)) {
  parser.input.addEventListener("change", () => updateFileCard(key));
}
elements.form.addEventListener("submit", uploadData);
elements.amazonImportButton.addEventListener("click", startAmazonImport);
elements.amazonCancelButton.addEventListener("click", cancelAmazonImport);

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== "ledger-amazon-extension"
  ) {
    return;
  }
  if (event.data.action === "ready") {
    setExtensionReady(true);
  } else if (event.data.action === "progress" && state.amazonSessionToken) {
    const { progress, message, status } = event.data.payload ?? {};
    renderAmazonProgress(progress, message || "Importing Amazon orders…", status);
  } else if (event.data.action === "error") {
    showAmazonError(event.data.payload?.message || "The Amazon importer extension reported an error.");
    if (state.amazonSessionToken) {
      const token = state.amazonSessionToken;
      fetch(`/api/amazon-import-sessions/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      finishAmazonSession();
    }
  }
});

initializeAmazonDates();
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

initializeRevision();
