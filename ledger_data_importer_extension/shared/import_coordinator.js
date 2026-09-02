"use strict";

import { exportAliExpressOrders } from "../aliexpress_extension/importer.js";

// Shared service worker that coordinates source tabs with Ledger import sessions.

const AMAZON_PENDING_KEY = "ledgerAmazonPendingImport";
const AMAZON_PENDING_BACKUP_KEY = "ledgerAmazonPendingImportBackup";
const AMAZON_RECENT_COMPLETION_KEY = "ledgerAmazonRecentCompletion";
const CREDIT_KARMA_PENDING_KEY = "ledgerCreditKarmaPendingImport";
const CREDIT_KARMA_BACKUP_KEY = "ledgerCreditKarmaPendingImportBackup";
const ALIEXPRESS_PENDING_KEY = "ledgerAliExpressPendingImport";
const ALIEXPRESS_BACKUP_KEY = "ledgerAliExpressPendingImportBackup";
const PENDING_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const AMAZON_RECENT_COMPLETION_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMAZON_ORDER_PATH = /\/(?:gp\/(?:your-account|css)\/order-history|your-orders(?:\/orders)?)/;
const cancelledAliExpressTokens = new Set();

// Shared request validation ---------------------------------------------------

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function validateRequest(payload, sender) {
  if (!payload || typeof payload !== "object") throw new Error("Missing import request.");
  if (!TOKEN_PATTERN.test(payload.token || "")) throw new Error("Invalid import token.");
  if (!DATE_PATTERN.test(payload.startDate || "") || !DATE_PATTERN.test(payload.endDate || "")) {
    throw new Error("Invalid import date range.");
  }
  if (payload.startDate > payload.endDate) throw new Error("Invalid import date range.");
  if (!isLoopbackOrigin(payload.ledgerOrigin)) throw new Error("Ledger must run on localhost.");
  let senderUrl;
  try {
    senderUrl = new URL(sender.url);
  } catch {
    throw new Error("Import requests must come from Ledger's upload page.");
  }
  if (
    senderUrl.origin !== payload.ledgerOrigin ||
    !["/upload", "/upload.html"].includes(senderUrl.pathname)
  ) {
    throw new Error("Import requests must come from Ledger's upload page.");
  }
}

// Amazon import coordination -------------------------------------------------

async function getAmazonPending() {
  const sessionPending = (await chrome.storage.session.get(AMAZON_PENDING_KEY))[AMAZON_PENDING_KEY];
  if (sessionPending) return sessionPending;

  const backup = (await chrome.storage.local.get(AMAZON_PENDING_BACKUP_KEY))[
    AMAZON_PENDING_BACKUP_KEY
  ];
  if (!backup) return null;
  if (!backup.updatedAt || Date.now() - backup.updatedAt > PENDING_MAX_AGE_MS) {
    await chrome.storage.local.remove(AMAZON_PENDING_BACKUP_KEY);
    return null;
  }
  await chrome.storage.session.set({ [AMAZON_PENDING_KEY]: backup });
  return backup;
}

async function setAmazonPending(pending) {
  const saved = { ...pending, updatedAt: Date.now() };
  await Promise.all([
    chrome.storage.session.set({ [AMAZON_PENDING_KEY]: saved }),
    chrome.storage.local.set({ [AMAZON_PENDING_BACKUP_KEY]: saved }),
  ]);
}

async function clearAmazonPending() {
  await Promise.all([
    chrome.storage.session.remove(AMAZON_PENDING_KEY),
    chrome.storage.local.remove(AMAZON_PENDING_BACKUP_KEY),
  ]);
}

async function updateAmazonLedger(pending, data, action = "progress") {
  const response = await fetch(
    `${pending.ledgerOrigin}/api/amazon-import-sessions/${encodeURIComponent(pending.token)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Preserve the HTTP status in the error below when a response is not JSON.
  }
  if (!response.ok) {
    throw new Error(payload.error || `Ledger returned HTTP ${response.status}.`);
  }
  return payload;
}

async function broadcast(action, data) {
  try {
    await chrome.runtime.sendMessage({ action, data, forwarded: true });
  } catch {
    // The upload page or extension popup may be closed.
  }
}

async function reportAmazonFailure(pending, error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await updateAmazonLedger(pending, { status: "error", progress: 0, message });
  } catch {
    // If Ledger is no longer running there is nowhere else to report the failure.
  }
  await broadcast("ledgerImportError", { message });
}

async function startAmazonImport(payload, sender) {
  validateRequest(payload, sender);
  const existing = await getAmazonPending();
  if (existing) throw new Error("Another Amazon import is already running.");
  await chrome.storage.local.remove(AMAZON_RECENT_COMPLETION_KEY);

  const pending = {
    token: payload.token,
    startDate: payload.startDate,
    endDate: payload.endDate,
    ledgerOrigin: payload.ledgerOrigin,
    tabId: null,
    started: false,
  };
  await setAmazonPending(pending);
  await updateAmazonLedger(pending, {
    status: "opening_amazon",
    progress: 2,
    message: "Opening Amazon order history. Sign in if Amazon asks you to.",
  });
  const tab = await chrome.tabs.create({
    url: "https://www.amazon.com/gp/your-account/order-history",
    active: true,
  });
  pending.tabId = tab.id;
  await setAmazonPending(pending);
  return { success: true };
}

async function cancelAmazonImport(payload) {
  const pending = await getAmazonPending();
  if (!pending || pending.token !== payload?.token) return { success: true };
  if (pending.tabId !== null) {
    try {
      await chrome.tabs.sendMessage(pending.tabId, { action: "stopExport" });
    } catch {
      // The Amazon content script may not have started yet.
    }
  }
  try {
    await updateAmazonLedger(pending, {}, "cancel");
  } finally {
    await clearAmazonPending();
  }
  return { success: true };
}

async function downloadFile(data) {
  const encoded = btoa(unescape(encodeURIComponent(data.content)));
  return chrome.downloads.download({
    url: `data:${data.mimeType};base64,${encoded}`,
    filename: data.fileName,
    saveAs: true,
  });
}

async function handleAmazonExport(data, sender) {
  const pending = await getAmazonPending();
  if (!pending || data.mimeType !== "application/json") {
    const recent = (await chrome.storage.local.get(AMAZON_RECENT_COMPLETION_KEY))[
      AMAZON_RECENT_COMPLETION_KEY
    ];
    if (
      data.mimeType === "application/json" &&
      recent?.tabId === sender.tab?.id &&
      Date.now() - recent.completedAt < AMAZON_RECENT_COMPLETION_MS
    ) {
      return { success: true };
    }
    await downloadFile(data);
    return { success: true };
  }

  try {
    await updateAmazonLedger(pending, {
      status: "importing",
      progress: 96,
      message: "Amazon export complete. Adding new transactions to Ledger…",
    });
    const result = await updateAmazonLedger(pending, { content: data.content }, "complete");
    await broadcast("ledgerImportComplete", result);
    await chrome.storage.local.set({
      [AMAZON_RECENT_COMPLETION_KEY]: { tabId: sender.tab?.id, completedAt: Date.now() },
    });
    await clearAmazonPending();
    return { success: true };
  } catch (error) {
    await reportAmazonFailure(pending, error);
    await clearAmazonPending();
    throw error;
  }
}

// Credit Karma import coordination ------------------------------------------

async function getCreditKarmaPending() {
  const active = (await chrome.storage.session.get(CREDIT_KARMA_PENDING_KEY))[
    CREDIT_KARMA_PENDING_KEY
  ];
  if (active) return active;
  const backup = (await chrome.storage.local.get(CREDIT_KARMA_BACKUP_KEY))[
    CREDIT_KARMA_BACKUP_KEY
  ];
  if (!backup) return null;
  if (!backup.updatedAt || Date.now() - backup.updatedAt > PENDING_MAX_AGE_MS) {
    await chrome.storage.local.remove(CREDIT_KARMA_BACKUP_KEY);
    return null;
  }
  await chrome.storage.session.set({ [CREDIT_KARMA_PENDING_KEY]: backup });
  return backup;
}

async function setCreditKarmaPending(pending) {
  const saved = { ...pending, updatedAt: Date.now() };
  await Promise.all([
    chrome.storage.session.set({ [CREDIT_KARMA_PENDING_KEY]: saved }),
    chrome.storage.local.set({ [CREDIT_KARMA_BACKUP_KEY]: saved }),
  ]);
}

async function clearCreditKarmaPending() {
  await Promise.all([
    chrome.storage.session.remove(CREDIT_KARMA_PENDING_KEY),
    chrome.storage.local.remove(CREDIT_KARMA_BACKUP_KEY),
  ]);
}

async function updateCreditKarmaLedger(pending, data, action = "progress") {
  const response = await fetch(
    `${pending.ledgerOrigin}/api/creditkarma-import-sessions/${encodeURIComponent(pending.token)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Ledger returned HTTP ${response.status}.`);
  }
  return payload;
}

async function reportCreditKarmaFailure(pending, error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await updateCreditKarmaLedger(pending, { status: "error", progress: 0, message });
  } catch {
    // Ledger may have stopped while Credit Karma was exporting.
  }
  await broadcast("ledgerCreditKarmaImportError", { message });
}

async function startCreditKarmaImport(payload, sender) {
  validateRequest(payload, sender);
  if (await getCreditKarmaPending()) {
    throw new Error("Another Credit Karma import is already running.");
  }
  const pending = {
    token: payload.token,
    startDate: payload.startDate,
    endDate: payload.endDate,
    ledgerOrigin: payload.ledgerOrigin,
    tabId: null,
    started: false,
  };
  await setCreditKarmaPending(pending);
  await updateCreditKarmaLedger(pending, {
    status: "opening_credit_karma",
    progress: 2,
    message: "Opening Credit Karma. Sign in if Credit Karma asks you to.",
  });
  const tab = await chrome.tabs.create({
    url: "https://www.creditkarma.com/networth/transactions",
    active: true,
  });
  pending.tabId = tab.id;
  await setCreditKarmaPending(pending);
  return { success: true };
}

async function cancelCreditKarmaImport(payload) {
  const pending = await getCreditKarmaPending();
  if (!pending || pending.token !== payload?.token) return { success: true };
  if (pending.tabId !== null) {
    try {
      await chrome.tabs.sendMessage(pending.tabId, { action: "ledgerCancelCreditKarma" });
    } catch {
      // The Credit Karma content script may not have started yet.
    }
  }
  try {
    await updateCreditKarmaLedger(pending, {}, "cancel");
  } finally {
    await clearCreditKarmaPending();
  }
  return { success: true };
}

// Credit Karma message routing ----------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.forwarded) return false;
  let operation;
  if (message?.action === "ledgerCreditKarmaAccessToken") {
    operation = (async () => {
      if (!sender.tab?.id) throw new Error("Credit Karma tab was not available.");
      const senderUrl = new URL(sender.url || "");
      if (
        senderUrl.hostname !== "creditkarma.com" &&
        !senderUrl.hostname.endsWith(".creditkarma.com")
      ) {
        throw new Error("Login tokens can only be read from Credit Karma.");
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: () => window._ACCESS_TOKEN || null,
      });
      return { success: true, token: results[0]?.result || null };
    })();
  } else if (message?.action === "ledgerStartCreditKarmaImport") {
    operation = startCreditKarmaImport(message.data, sender);
  } else if (message?.action === "ledgerCancelCreditKarmaImport") {
    operation = cancelCreditKarmaImport(message.data);
  } else if (message?.action === "ledgerCreditKarmaProgress") {
    operation = (async () => {
      const pending = await getCreditKarmaPending();
      if (!pending || pending.tabId !== sender.tab?.id) return { success: false };
      await updateCreditKarmaLedger(pending, {
        status: "scraping",
        progress: Math.max(3, Math.min(95, Math.floor(message.data?.progress || 0))),
        message: message.data?.message || "Collecting Credit Karma transactions…",
      });
      await broadcast("ledgerCreditKarmaImportProgress", message.data);
      return { success: true };
    })();
  } else if (message?.action === "ledgerCreditKarmaComplete") {
    operation = (async () => {
      const pending = await getCreditKarmaPending();
      if (!pending || pending.tabId !== sender.tab?.id) {
        throw new Error("The active Credit Karma import session was lost.");
      }
      await updateCreditKarmaLedger(pending, {
        status: "importing",
        progress: 96,
        message: "Credit Karma export complete. Adding new transactions to Ledger…",
      });
      const result = await updateCreditKarmaLedger(
        pending,
        { content: message.data?.content },
        "complete",
      );
      await broadcast("ledgerCreditKarmaImportComplete", result);
      await clearCreditKarmaPending();
      return { success: true };
    })();
  } else if (message?.action === "ledgerCreditKarmaError") {
    operation = (async () => {
      const pending = await getCreditKarmaPending();
      if (pending) await reportCreditKarmaFailure(pending, message.data?.message || "Export failed.");
      await clearCreditKarmaPending();
      return { success: true };
    })();
  } else {
    return false;
  }

  operation.then(sendResponse).catch(async (error) => {
    const pending = await getCreditKarmaPending();
    if (pending) await reportCreditKarmaFailure(pending, error);
    if (
      message?.action === "ledgerStartCreditKarmaImport" ||
      message?.action === "ledgerCreditKarmaComplete"
    ) {
      await clearCreditKarmaPending();
    }
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

// Amazon message routing -----------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.forwarded) return false;

  let operation;
  if (message?.action === "ledgerStartImport") {
    operation = startAmazonImport(message.data, sender);
  } else if (message?.action === "ledgerCancelImport") {
    operation = cancelAmazonImport(message.data);
  } else if (message?.action === "downloadFile") {
    operation = handleAmazonExport(message.data, sender);
  } else if (message?.action === "updateProgress") {
    operation = (async () => {
      const pending = await getAmazonPending();
      if (pending) {
        await updateAmazonLedger(pending, {
          status: "scraping",
          progress: Math.max(3, Math.min(95, Math.floor(message.data?.percent || 0))),
          message: message.data?.message || "Collecting Amazon orders…",
        });
        await broadcast("ledgerImportProgress", message.data);
      }
      await broadcast("updateProgress", message.data);
      return { success: true };
    })();
  } else {
    return false;
  }

  operation.then(sendResponse).catch(async (error) => {
    const pending = await getAmazonPending();
    if (pending) await reportAmazonFailure(pending, error);
    if (message?.action === "ledgerStartImport") await clearAmazonPending();
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

// Amazon tab lifecycle -------------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const pending = await getAmazonPending();
  if (!pending || pending.tabId !== tabId || pending.started) return;

  const url = tab.url || "";
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }
  if (parsedUrl.hostname !== "amazon.com" && !parsedUrl.hostname.endsWith(".amazon.com")) return;
  if (!AMAZON_ORDER_PATH.test(parsedUrl.pathname)) {
    await updateAmazonLedger(pending, {
      status: "waiting_for_amazon",
      progress: 2,
      message: "Sign in to Amazon, then open Your Orders to continue automatically.",
    });
    return;
  }

  pending.started = true;
  await setAmazonPending(pending);
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "exportOrders",
      options: {
        format: "json",
        startDate: pending.startDate,
        endDate: pending.endDate,
        exportAll: false,
      },
    });
    await updateAmazonLedger(pending, {
      status: "scraping",
      progress: 3,
      message: "Collecting Amazon orders…",
    });
  } catch (error) {
    pending.started = false;
    await setAmazonPending(pending);
    await reportAmazonFailure(pending, error);
  }
});

// Credit Karma tab lifecycle -------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const pending = await getCreditKarmaPending();
  if (!pending || pending.tabId !== tabId || pending.started) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(tab.url || "");
  } catch {
    return;
  }
  if (
    parsedUrl.hostname !== "creditkarma.com" &&
    !parsedUrl.hostname.endsWith(".creditkarma.com")
  ) {
    return;
  }
  if (
    parsedUrl.hostname !== "www.creditkarma.com" ||
    !parsedUrl.pathname.startsWith("/networth/transactions")
  ) {
    await updateCreditKarmaLedger(pending, {
      status: "waiting_for_credit_karma",
      progress: 2,
      message: "Sign in to Credit Karma, then open Transactions to continue automatically.",
    });
    return;
  }

  pending.started = true;
  await setCreditKarmaPending(pending);
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "ledgerCaptureCreditKarma",
      startDate: pending.startDate,
      endDate: pending.endDate,
    });
    await updateCreditKarmaLedger(pending, {
      status: "scraping",
      progress: 3,
      message: "Collecting all Credit Karma transactions in the selected date range…",
    });
  } catch (error) {
    pending.started = false;
    await setCreditKarmaPending(pending);
    await reportCreditKarmaFailure(pending, error);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getAmazonPending();
  if (!pending || pending.tabId !== tabId) return;
  await reportAmazonFailure(pending, new Error("The Amazon tab was closed before import completed."));
  await clearAmazonPending();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getCreditKarmaPending();
  if (!pending || pending.tabId !== tabId) return;
  await reportCreditKarmaFailure(
    pending,
    new Error("The Credit Karma tab was closed before import completed."),
  );
  await clearCreditKarmaPending();
});

// AliExpress import coordination -------------------------------------------

async function getAliExpressPending() {
  const active = (await chrome.storage.session.get(ALIEXPRESS_PENDING_KEY))[ALIEXPRESS_PENDING_KEY];
  if (active) return active;
  const backup = (await chrome.storage.local.get(ALIEXPRESS_BACKUP_KEY))[ALIEXPRESS_BACKUP_KEY];
  if (!backup) return null;
  if (!backup.updatedAt || Date.now() - backup.updatedAt > PENDING_MAX_AGE_MS) {
    await chrome.storage.local.remove(ALIEXPRESS_BACKUP_KEY);
    return null;
  }
  await chrome.storage.session.set({ [ALIEXPRESS_PENDING_KEY]: backup });
  return backup;
}

async function setAliExpressPending(pending) {
  const saved = { ...pending, updatedAt: Date.now() };
  await Promise.all([
    chrome.storage.session.set({ [ALIEXPRESS_PENDING_KEY]: saved }),
    chrome.storage.local.set({ [ALIEXPRESS_BACKUP_KEY]: saved }),
  ]);
}

async function clearAliExpressPending() {
  await Promise.all([
    chrome.storage.session.remove(ALIEXPRESS_PENDING_KEY),
    chrome.storage.local.remove(ALIEXPRESS_BACKUP_KEY),
  ]);
}

async function updateAliExpressLedger(pending, data, action = "progress") {
  const response = await fetch(
    `${pending.ledgerOrigin}/api/aliexpress-import-sessions/${encodeURIComponent(pending.token)}/${action}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ledger returned HTTP ${response.status}.`);
  return payload;
}

async function reportAliExpressFailure(pending, error) {
  const message = error instanceof Error ? error.message : String(error);
  try { await updateAliExpressLedger(pending, { status: "error", progress: 0, message }); } catch { /* Ledger may have stopped. */ }
  await broadcast("ledgerAliExpressImportError", { message });
}

async function startAliExpressImport(payload, sender) {
  validateRequest(payload, sender);
  if (await getAliExpressPending()) throw new Error("Another AliExpress import is already running.");
  const pending = { token: payload.token, startDate: payload.startDate, endDate: payload.endDate,
    ledgerOrigin: payload.ledgerOrigin, tabId: null, started: false };
  cancelledAliExpressTokens.delete(pending.token);
  await setAliExpressPending(pending);
  await updateAliExpressLedger(pending, { status: "opening_aliexpress", progress: 2,
    message: "Opening AliExpress. Sign in if AliExpress asks you to." });
  const tab = await chrome.tabs.create({ url: "https://www.aliexpress.com/p/order/index.html", active: true });
  pending.tabId = tab.id;
  await setAliExpressPending(pending);
  return { success: true };
}

async function cancelAliExpressImport(payload) {
  const pending = await getAliExpressPending();
  if (!pending || pending.token !== payload?.token) return { success: true };
  cancelledAliExpressTokens.add(pending.token);
  try { await updateAliExpressLedger(pending, {}, "cancel"); }
  finally { await clearAliExpressPending(); }
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.forwarded) return false;
  let operation;
  if (message?.action === "ledgerStartAliExpressImport") operation = startAliExpressImport(message.data, sender);
  else if (message?.action === "ledgerCancelAliExpressImport") operation = cancelAliExpressImport(message.data);
  else return false;
  operation.then(sendResponse).catch(async (error) => {
    const pending = await getAliExpressPending();
    if (pending) await reportAliExpressFailure(pending, error);
    await clearAliExpressPending();
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const pending = await getAliExpressPending();
  if (!pending || pending.tabId !== tabId || pending.started) return;
  let parsedUrl;
  try { parsedUrl = new URL(tab.url || ""); } catch { return; }
  if (parsedUrl.hostname !== "aliexpress.com" && !parsedUrl.hostname.endsWith(".aliexpress.com")) return;
  if (!parsedUrl.pathname.startsWith("/p/order/index.html")) {
    await updateAliExpressLedger(pending, { status: "waiting_for_aliexpress", progress: 2,
      message: "Sign in to AliExpress, then open My Orders to continue automatically." });
    return;
  }
  pending.started = true;
  await setAliExpressPending(pending);
  try {
    const content = await exportAliExpressOrders({
      startDate: pending.startDate,
      endDate: pending.endDate,
      isCancelled: () => cancelledAliExpressTokens.has(pending.token),
      onProgress: async (progress, message) => {
        await updateAliExpressLedger(pending, { status: "scraping", progress, message });
        await broadcast("ledgerAliExpressImportProgress", { progress, message });
      },
    });
    await updateAliExpressLedger(pending, { status: "importing", progress: 96,
      message: "AliExpress export complete. Adding new transactions to Ledger…" });
    const result = await updateAliExpressLedger(pending, { content }, "complete");
    await broadcast("ledgerAliExpressImportComplete", result);
    await clearAliExpressPending();
  } catch (error) {
    if (!cancelledAliExpressTokens.has(pending.token)) await reportAliExpressFailure(pending, error);
    await clearAliExpressPending();
  } finally {
    cancelledAliExpressTokens.delete(pending.token);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getAliExpressPending();
  if (!pending || pending.tabId !== tabId) return;
  cancelledAliExpressTokens.add(pending.token);
  await reportAliExpressFailure(pending, new Error("The AliExpress tab was closed before import completed."));
  await clearAliExpressPending();
});
