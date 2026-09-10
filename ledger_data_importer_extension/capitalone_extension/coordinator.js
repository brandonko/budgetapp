export function registerCapitalOneImporter({ validateRequest, broadcast }) {
  const key = "ledgerCapitalOnePendingImport";
  const origins = new Set(["https://verified.capitalone.com", "https://myaccounts.capitalone.com"]);
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
    const response = await fetch(`${job.ledgerOrigin}/api/capitalone-import-sessions/${encodeURIComponent(job.token)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Ledger returned HTTP ${response.status}. Restart its Python server if it needs updating.`);
    return result;
  }
  async function stop(job) {
    try { await chrome.tabs.sendMessage(job.tabId, { action: "ledgerCancelCapitalOne" }); } catch { /* Closed or navigating. */ }
  }
  async function fail(job, error) {
    const message = String(error.message || error).slice(0, 500);
    try { await update(job, { status: "error", progress: 0, message }); } catch { /* Server offline. */ }
    await broadcast("ledgerCapitalOneImportError", { message, token: job.token });
    await stop(job);
    await clear();
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.forwarded || !["ledgerStartCapitalOneImport", "ledgerCancelCapitalOneImport", "ledgerCapitalOneReady",
      "ledgerCapitalOneProgress", "ledgerCapitalOneComplete", "ledgerCapitalOneError"].includes(message?.action)) return false;
    serial(async () => {
      let job = await current();
      if (message.action === "ledgerStartCapitalOneImport") {
        await validateRequest(message.data, sender);
        if (job) throw new Error("Another Capital One import is already running.");
        job = { token: message.data.token, startDate: message.data.startDate, endDate: message.data.endDate,
          ledgerOrigin: message.data.ledgerOrigin, tabId: null, createdAt: Date.now(), nonce: "" };
        try {
          await save(job);
          await update(job, { status: "opening_capitalone", progress: 2, message: "Opening Capital One. Sign in and open the account you want to import." });
          const tab = await chrome.tabs.create({ url: "about:blank", active: true });
          job.tabId = tab.id;
          await save(job);
          await chrome.tabs.update(tab.id, { url: "https://verified.capitalone.com/auth/signin" });
        } catch (error) { await fail(job, error); throw error; }
        return { success: true };
      }
      if (message.action === "ledgerCancelCapitalOneImport") {
        if (!job || job.token !== message.data?.token) return { success: true };
        await validateRequest(job, sender);
        await stop(job);
        try { await update(job, {}, "cancel"); } finally { await clear(); }
        return { success: true };
      }
      if (!job || !isSource(sender, job)) return { success: false, error: "No matching Capital One import." };
      try {
        if (message.action === "ledgerCapitalOneReady") {
          // A new document after sign-in/account navigation gets a new capture nonce.
          job.nonce = crypto.randomUUID();
          await save(job);
          return { success: true, nonce: job.nonce, startDate: job.startDate, endDate: job.endDate };
        }
        if (!job.nonce || message.data?.nonce !== job.nonce) return { success: false, error: "Stale Capital One capture." };
        if (message.action === "ledgerCapitalOneProgress") {
          const data = { status: "waiting_for_capitalone", progress: 10,
            message: String(message.data.message || "Waiting for Capital One CSV export…").slice(0, 500) };
          const result = await update(job, data);
          if (["cancelled", "error", "complete", "review"].includes(result.status)) { await stop(job); await clear(); }
          else await broadcast("ledgerCapitalOneImportProgress", { ...data, token: job.token });
        } else if (message.action === "ledgerCapitalOneComplete") {
          if (typeof message.data.content !== "string" || new TextEncoder().encode(message.data.content).length > 16 * 1024 * 1024) {
            throw new Error("Capital One CSV is missing or too large.");
          }
          await update(job, { content: message.data.content }, "complete"); // Staged only. Never /commit.
          await stop(job);
          await clear();
        } else if (message.action === "ledgerCapitalOneError") {
          await fail(job, message.data.message || "Capital One export failed.");
        }
        return { success: true };
      } catch (error) { await fail(job, error); throw error; }
    }).then(respond, (error) => respond({ success: false, error: error.message || "Capital One import failed." }));
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => serial(async () => {
    const job = await current();
    if (job?.tabId === tabId) await fail(job, "Capital One was closed before its CSV was captured. No transactions were saved.");
  }));
}
