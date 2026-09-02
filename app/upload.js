"use strict";

const state = {
  revision: "",
  busy: false,
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
};

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

initializeRevision();
