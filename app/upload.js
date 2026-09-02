"use strict";

const state = {
  extensionReady: false,
  amazonSessionToken: "",
  amazonPollTimer: null,
  creditKarmaSessionToken: "",
  creditKarmaPollTimer: null,
};

const sourceLabels = { creditkarma: "Credit Karma", amazon: "Amazon" };

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
  creditKarmaImportButton: document.querySelector("#creditkarma-import-button"),
  creditKarmaCancelButton: document.querySelector("#creditkarma-cancel-button"),
  creditKarmaProgress: document.querySelector("#creditkarma-progress"),
  creditKarmaProgressBar: document.querySelector("#creditkarma-progress-bar"),
  creditKarmaProgressMessage: document.querySelector("#creditkarma-progress-message"),
  creditKarmaDirectError: document.querySelector("#creditkarma-direct-error"),
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
}

function setExtensionReady(ready) {
  state.extensionReady = ready;
  elements.extensionDot.classList.toggle("extension-dot--ready", ready);
  elements.extensionStatus.textContent = ready
    ? "Companion extension connected"
    : "Companion extension not detected";
  elements.extensionHelp.open = !ready;
  elements.amazonImportButton.disabled = !ready || Boolean(state.amazonSessionToken);
  elements.creditKarmaImportButton.disabled =
    !ready || Boolean(state.creditKarmaSessionToken);
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
      body: JSON.stringify({ startDate, endDate }),
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
  elements.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

elements.amazonImportButton.addEventListener("click", startAmazonImport);
elements.amazonCancelButton.addEventListener("click", cancelAmazonImport);
elements.creditKarmaImportButton.addEventListener("click", startCreditKarmaImport);
elements.creditKarmaCancelButton.addEventListener("click", cancelCreditKarmaImport);

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
