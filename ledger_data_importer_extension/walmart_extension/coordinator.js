// Source-specific lifecycle, using the shared Ledger request trust boundary.
export function registerWalmartImporter({ validateRequest, broadcast }) {
  const key = "ledgerWalmartPendingImport";
  const maxAge = 2 * 60 * 60 * 1000;
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const clear = () => Promise.all([chrome.storage.session.remove(key), chrome.storage.local.remove(key)]);
  async function pending() {
    const value = (await chrome.storage.session.get(key))[key] || (await chrome.storage.local.get(key))[key];
    if (!value) return null;
    if (!value.updatedAt || Date.now() - value.updatedAt > maxAge) { await clear(); return null; }
    return value;
  }
  const save = (value) => {
    const saved = { ...value, updatedAt: Date.now() };
    return Promise.all([chrome.storage.session.set({ [key]: saved }), chrome.storage.local.set({ [key]: saved })]);
  };
  async function update(job, data, action = "progress") {
    const response = await fetch(`${job.ledgerOrigin}/api/walmart-import-sessions/${encodeURIComponent(job.token)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Ledger returned HTTP ${response.status}. Restart the Ledger server if it needs updating.`);
    return body;
  }
  function walmartSender(job, sender) {
    try { return job.tabId === sender.tab?.id && new URL(sender.url || sender.tab?.url).origin === "https://www.walmart.com"; }
    catch { return false; }
  }
  async function fail(job, error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await update(job, { status: "error", progress: 0, message }); } catch { /* Local server may have stopped. */ }
    await broadcast("ledgerWalmartImportError", { message, token: job.token });
    try { await chrome.tabs.sendMessage(job.tabId, { action: "ledgerCancelWalmart" }); } catch { /* Tab may be gone. */ }
    await clear();
  }
  async function begin(job, tab) {
    if (job.started) return;
    let url;
    try { url = new URL(tab.url); } catch { return; }
    if (url.origin !== "https://www.walmart.com" || !/^\/orders\/?$/.test(url.pathname)) {
      await update(job, { status: "waiting_for_walmart", progress: 2, message: "Sign in to Walmart, then open Purchase history to continue automatically." });
      return;
    }
    await update(job, { status: "scraping", progress: 3, message: "Reading Walmart purchase history…" });
    const response = await chrome.tabs.sendMessage(job.tabId, {
      action: "ledgerCaptureWalmart", startDate: job.startDate, endDate: job.endDate,
    });
    if (!response?.success) throw new Error(response?.error || "Walmart collector did not start. Reload the companion extension and retry.");
    await save({ ...job, started: true });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.forwarded || !["ledgerStartWalmartImport", "ledgerCancelWalmartImport", "ledgerWalmartReady",
      "ledgerWalmartProgress", "ledgerWalmartComplete", "ledgerWalmartError"].includes(message?.action)) return false;
    serialize(async () => {
      let job = await pending();
      if (message.action === "ledgerStartWalmartImport") {
        validateRequest(message.data, sender);
        if (job) throw new Error("Another Walmart import is already running.");
        // Whitelist fields: no arbitrary source URLs or credentials in recovery storage.
        job = { token: message.data.token, startDate: message.data.startDate, endDate: message.data.endDate,
          ledgerOrigin: message.data.ledgerOrigin, tabId: null, started: false };
        try {
          await save(job);
          await update(job, { status: "opening_walmart", progress: 2, message: "Opening Walmart. Sign in if asked." });
          const tab = await chrome.tabs.create({ url: "about:blank", active: true });
          job.tabId = tab.id;
          await save(job);
          await chrome.tabs.update(tab.id, { url: "https://www.walmart.com/orders" });
        } catch (error) { await fail(job, error); throw error; }
        return { success: true };
      }
      if (message.action === "ledgerCancelWalmartImport") {
        if (!job || job.token !== message.data?.token) return { success: true };
        validateRequest({ ...job }, sender);
        try { await chrome.tabs.sendMessage(job.tabId, { action: "ledgerCancelWalmart" }); } catch { /* Still opening. */ }
        try { await update(job, {}, "cancel"); } finally { await clear(); }
        return { success: true };
      }
      if (!job || !walmartSender(job, sender)) return { success: false, error: "No matching Walmart import." };
      try {
        if (message.action === "ledgerWalmartReady") {
          if (job.started) throw new Error("Walmart reloaded during collection. Retry the import; no partial results were saved.");
          await begin(job, { url: sender.url });
        } else if (message.action === "ledgerWalmartProgress") {
          const data = { progress: Math.max(3, Math.min(95, Number(message.data?.progress) || 3)),
            status: "scraping", message: String(message.data?.message || "Reading Walmart purchases…").slice(0, 500) };
          await update(job, data);
          await save(job);
          await broadcast("ledgerWalmartImportProgress", { ...data, token: job.token });
        } else if (message.action === "ledgerWalmartComplete") {
          if (typeof message.data?.content !== "string" || new TextEncoder().encode(message.data.content).length > 16 * 1024 * 1024) {
            throw new Error("Walmart export is missing or too large. Choose a shorter date range.");
          }
          await update(job, { content: message.data.content }, "complete");
          await clear(); // No raw receipts in extension storage; Ledger now owns the staged review.
        } else if (message.action === "ledgerWalmartError") {
          await fail(job, String(message.data?.message || "Walmart export failed.").slice(0, 500));
        }
        return { success: true };
      } catch (error) { await fail(job, error); throw error; }
    }).then(respond, (error) => respond({ success: false, error: error.message || "Walmart import failed." }));
    return true;
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== "complete") return;
    serialize(async () => {
      const job = await pending();
      if (!job || job.tabId !== tabId || job.started) return;
      try { await begin(job, tab); } catch (error) { await fail(job, error); }
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => serialize(async () => {
    const job = await pending();
    if (job?.tabId === tabId) await fail(job, "The Walmart tab was closed before collection completed.");
  }));
}
