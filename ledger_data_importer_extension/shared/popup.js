"use strict";

// The toolbar is a launcher, not a second import flow. Dates, source selection,
// progress and confirmation remain in Ledger; no source credentials are read here.
(() => {
  const form = document.getElementById("open-ledger-form");
  const server = document.getElementById("ledger-server");
  const openButton = document.getElementById("open-ledger");
  const settingsButton = document.getElementById("connection-settings");
  const status = document.getElementById("status");
  const availableOrigins = new Set();
  const defaultOrigin = "http://127.0.0.1:8000";
  const ledgerPaths = new Set(["/", "/import", "/upload", "/transactions", "/classifications", "/settings"]);
  let opening = false;

  function showStatus(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }

  async function permittedOrigin(value) {
    if (typeof value !== "string") return null;
    try {
      const origin = LedgerOrigins.normalize(value);
      return await LedgerOrigins.allowed(origin) ? origin : null;
    } catch { return null; }
  }

  async function initialize() {
    document.getElementById("version").textContent = `v${chrome.runtime.getManifest().version}`;
    // Only read popup/server preferences, never the extension's saved import jobs.
    const saved = await chrome.storage.local.get(["ledgerTrustedOrigins", "ledgerPopupOrigin"]);
    const trusted = Array.isArray(saved.ledgerTrustedOrigins) ? saved.ledgerTrustedOrigins : [];
    let activeOrigin = null;
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(active?.url);
      if (!url.username && !url.password && ledgerPaths.has(url.pathname)) {
        activeOrigin = await permittedOrigin(url.origin);
      }
    } catch { /* Browser-internal pages or unavailable tabs do not block the launcher. */ }

    const preferredOrigin = await permittedOrigin(saved.ledgerPopupOrigin);
    for (const candidate of [activeOrigin, preferredOrigin, ...trusted, defaultOrigin]) {
      const origin = await permittedOrigin(candidate);
      if (origin) availableOrigins.add(origin);
    }
    server.replaceChildren();
    for (const origin of availableOrigins) {
      const option = document.createElement("option");
      option.value = origin;
      option.textContent = origin;
      server.append(option);
    }
    server.value = [...availableOrigins][0] || "";
    server.disabled = availableOrigins.size === 0;
    openButton.disabled = server.disabled;
    if (server.disabled) showStatus("No server is available. Check Ledger connection settings.");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (opening || openButton.disabled) return;
    opening = true;
    openButton.disabled = true;
    server.disabled = true;
    showStatus();
    try {
      const origin = server.value;
      // Settings/permissions may have changed since the popup was opened.
      if (!availableOrigins.has(origin) || await permittedOrigin(origin) !== origin) {
        throw new Error("This server is no longer trusted. Check Ledger connection settings and reopen the popup.");
      }
      await chrome.tabs.create({ url: `${origin}/import` });
      // Remember only the chosen origin, never a full tab URL or session token.
      try { await chrome.storage.local.set({ ledgerPopupOrigin: origin }); }
      catch { /* A preference write failure must not make a successful open look failed. */ }
    } catch (error) {
      showStatus(error.message || "Could not open Ledger. Check your connection settings and try again.");
    } finally {
      opening = false;
      server.disabled = availableOrigins.size === 0;
      openButton.disabled = server.disabled;
    }
  });

  settingsButton.addEventListener("click", async () => {
    try { await chrome.runtime.openOptionsPage(); }
    catch { showStatus("Could not open settings. In Chrome's extension details, choose Extension options."); }
  });

  initialize().catch(() => {
    showStatus("Could not load your Ledger servers. Reopen the popup or check Ledger connection settings.");
  });
})();
