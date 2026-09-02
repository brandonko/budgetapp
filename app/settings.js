"use strict";

const elements = {
  tabs: [...document.querySelectorAll('[role="tab"][aria-controls]')],
  createBackup: document.querySelector("#create-backup-button"),
  refreshBackups: document.querySelector("#refresh-backups-button"),
  backupStatus: document.querySelector("#backup-status"),
  backupList: document.querySelector("#backup-list"),
};

const backupDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function selectSettingsTab(selectedTab, { focus = false } = {}) {
  for (const tab of elements.tabs) {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute("aria-controls"));
    if (panel) panel.hidden = !selected;
  }
  if (focus) selectedTab.focus();
}

function initializeSettingsTabs() {
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

function setBusy(busy) {
  elements.createBackup.disabled = busy;
  elements.refreshBackups.disabled = busy;
  elements.backupList.querySelectorAll("button").forEach((button) => {
    button.disabled = busy || button.dataset.valid === "false";
  });
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
  const remove = document.createElement("button");
  remove.className = "danger-button backup-delete-button";
  remove.type = "button";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => deleteBackup(backup));
  actions.append(restore, remove);

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
    await loadBackups();
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

elements.createBackup.addEventListener("click", createBackup);
elements.refreshBackups.addEventListener("click", loadBackups);
initializeSettingsTabs();
loadBackups();
