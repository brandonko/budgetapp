export function registerAmexImporter({ validateRequest, broadcast }) {
  const key = "ledgerAmexPendingImport";
  const origins = new Set(["https://global.americanexpress.com"]);
  let queue = Promise.resolve();
  const serial = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const clear = () => chrome.storage.session.remove(key);
  const save = (job) => chrome.storage.session.set({ [key]: job });
  async function current() {
    const job = (await chrome.storage.session.get(key))[key];
    if (!job) return null;
    if (Date.now() - job.createdAt > 30 * 60 * 1000) { await clear(); return null; }
    return job;
  }
  const isSource = (sender, job) => {
    try { return sender.tab?.id === job.tabId && (sender.frameId ?? 0) === 0 && origins.has(new URL(sender.url || sender.tab.url).origin); }
    catch { return false; }
  };
  async function update(job, data, action = "progress") {
    await validateRequest(job, { frameId: 0, url: (await chrome.tabs.get(job.ledgerTabId)).url, tab: { id: job.ledgerTabId } });
    const response = await fetch(`${job.ledgerOrigin}/api/amex-import-sessions/${encodeURIComponent(job.token)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Ledger returned HTTP ${response.status}. Restart its Python server if it needs updating.`);
    return result;
  }
  async function stop(job) {
    try { await chrome.tabs.sendMessage(job.tabId, { action: "ledgerCancelAmex" }); } catch { /* Closed or navigating. */ }
  }
  async function fail(job, error) {
    const message = String(error.message || error).slice(0, 500);
    try { await update(job, { status: "error", progress: 0, message }); } catch { /* Server offline. */ }
    await broadcast("ledgerAmexImportError", { message, token: job.token });
    await stop(job);
    await clear();
  }
  // Navigation downloads do not go through page fetch/XHR. Observe only the
  // known GET export in the confirmed, owned tab, without headers or bodies.
  // Forward to that exact existing document, where the bounded reader fetches
  // the clicked export. Never persist/log its account-specific query string.
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.method !== "GET" || !["main_frame", "sub_frame"].includes(details.type)
        || details.initiator !== "https://global.americanexpress.com" || details.url.length > 8192) return;
    let url;
    try { url = new URL(details.url); } catch { return; }
    if (!origins.has(url.origin) || url.username || url.password || url.hash
        || url.pathname !== "/api/servicing/v1/financials/documents"
        || url.searchParams.getAll("file_format").length !== 1
        || !/^(csv|excel|xlsx)$/i.test(url.searchParams.get("file_format") || "")) return;
    void serial(async () => {
      const job = await current();
      if (!job?.armedAt || !job.nonce || !job.documentId || job.tabId !== details.tabId
          || !Number.isFinite(details.timeStamp) || details.timeStamp < job.armedAt) return;
      await validateRequest(job, { frameId: 0, url: (await chrome.tabs.get(job.ledgerTabId)).url, tab: { id: job.ledgerTabId } });
      await chrome.tabs.sendMessage(job.tabId, { action: "ledgerAmexDownload", nonce: job.nonce, url: details.url }, { documentId: job.documentId });
    }).catch(() => { /* Stale/cancelled/navigated jobs cannot receive exports. */ });
  }, { urls: ["https://global.americanexpress.com/api/servicing/v1/financials/documents*"], types: ["main_frame", "sub_frame"] });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.forwarded || !["ledgerStartAmexImport", "ledgerCancelAmexImport", "ledgerAmexReady",
      "ledgerAmexArm", "ledgerAmexDisarm", "ledgerAmexProgress", "ledgerAmexComplete", "ledgerAmexError"].includes(message?.action)) return false;
    serial(async () => {
      let job = await current();
      if (message.action === "ledgerStartAmexImport") {
        await validateRequest(message.data, sender);
        if (job) throw new Error("Another Amex import is already running.");
        job = { token: message.data.token, startDate: message.data.startDate, endDate: message.data.endDate,
          ledgerOrigin: message.data.ledgerOrigin, ledgerTabId: sender.tab.id,
          includeMerchantDetails: message.data.includeMerchantDetails !== false,
          tabId: null, createdAt: Date.now(), nonce: "", documentId: "" };
        try {
          await save(job);
          await update(job, { status: "opening_amex", progress: 2, message: "Opening American Express Activity. Sign in and select the card to import." });
          const tab = await chrome.tabs.create({ url: "about:blank", active: true });
          job.tabId = tab.id;
          await save(job);
          await chrome.tabs.update(tab.id, { url: "https://global.americanexpress.com/activity?days=30&inav=myca_statements" });
        } catch (error) { await fail(job, error); throw error; }
        return { success: true };
      }
      if (message.action === "ledgerCancelAmexImport") {
        if (!job || job.token !== message.data?.token) return { success: true };
        await validateRequest(job, sender);
        if (sender.tab.id !== job.ledgerTabId) throw new Error("Cancel Amex from the Ledger tab that started this import.");
        await stop(job);
        try { await update(job, {}, "cancel"); } finally { await clear(); }
        return { success: true };
      }
      if (!job || !isSource(sender, job)) return { success: false, error: "No matching Amex import." };
      try {
        if (message.action === "ledgerAmexReady") {
          // A new document after sign-in/account navigation gets a new capture nonce.
          job.nonce = crypto.randomUUID();
          job.documentId = sender.documentId || "";
          job.armedAt = 0;
          await save(job);
          return { success: true, nonce: job.nonce, startDate: job.startDate, endDate: job.endDate, includeMerchantDetails: job.includeMerchantDetails };
        }
        if (!job.nonce || message.data?.nonce !== job.nonce || (sender.documentId || "") !== job.documentId) return { success: false, error: "Stale Amex capture." };
        if (message.action === "ledgerAmexArm" || message.action === "ledgerAmexDisarm") {
          await validateRequest(job, { frameId: 0, url: (await chrome.tabs.get(job.ledgerTabId)).url, tab: { id: job.ledgerTabId } });
          if (message.action === "ledgerAmexArm" && !/^\/activity\/?$/.test(new URL(sender.url).pathname)) return { success: false };
          job.armedAt = message.action === "ledgerAmexArm" ? Date.now() : 0;
          await save(job);
        } else if (message.action === "ledgerAmexProgress") {
          const data = { status: "waiting_for_amex", progress: 10,
            message: String(message.data.message || "Waiting for American Express activity export...").slice(0, 500) };
          const result = await update(job, data);
          if (["cancelled", "error", "complete", "review"].includes(result.status)) { await stop(job); await clear(); }
          else await broadcast("ledgerAmexImportProgress", { ...data, token: job.token });
        } else if (message.action === "ledgerAmexComplete") {
          if (typeof message.data.content !== "string" || new TextEncoder().encode(message.data.content).length > 16 * 1024 * 1024) {
            throw new Error("Amex CSV is missing or too large.");
          }
          const result = await update(job, { content: message.data.content }, "complete"); // Staged only. Never /commit.
          await stop(job);
          await clear();
          if (result.status === "review") {
            try { await chrome.tabs.update(job.ledgerTabId, { active: true }); } catch { /* The user can return to Ledger manually. */ }
          }
        } else if (message.action === "ledgerAmexError") {
          await fail(job, message.data.message || "Amex export failed.");
        }
        return { success: true };
      } catch (error) { await fail(job, error); throw error; }
    }).then(respond, (error) => respond({ success: false, error: error.message || "Amex import failed." }));
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => serial(async () => {
    const job = await current();
    if (job?.tabId === tabId) await fail(job, "Amex was closed before its CSV was captured. No transactions were saved.");
  }));
}
