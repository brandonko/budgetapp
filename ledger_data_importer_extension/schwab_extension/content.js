// The user selects the checking account, range and CSV export on Schwab.
// No guessed account selectors, private endpoints, or authentication automation.
(() => {
  let job = null, timer = null, completing = false;
  const control = (action, nonce) => window.postMessage({ source: "ledger-schwab-control", action, nonce }, location.origin);
  const send = (action, data = {}) => chrome.runtime.sendMessage({ action, data: { ...data, nonce: job?.nonce } });
  function stop() {
    if (job) control("stop", job.nonce);
    job = null;
    clearTimeout(timer);
    timer = null;
  }
  async function tick() {
    if (!job) return;
    try {
      if (Date.now() - job.started > 25 * 60 * 1000) {
        await send("ledgerSchwabError", { message: "Schwab import timed out. Start again after signing in." });
        stop();
        return;
      }
      const result = await send("ledgerSchwabProgress", {
        message: `Select your checking account in Schwab, open transaction history, and export CSV covering ${job.startDate} through ${job.endDate}. Keep this tab open.`,
      });
      if (!result?.success) stop();
    } catch { stop(); }
    if (job) timer = setTimeout(tick, 5000);
  }
  window.addEventListener("message", async (event) => {
    if (!job || completing || event.source !== window || event.origin !== location.origin
        || event.data?.source !== "ledger-schwab-csv" || event.data.nonce !== job.nonce) return;
    try {
      const content = globalThis.LedgerSchwabCsv.sanitize(event.data.content);
      completing = true;
      control("stop", job.nonce);
      const response = await send("ledgerSchwabComplete", { content });
      if (!response?.success && job) await send("ledgerSchwabError", { message: response?.error || "Schwab export could not reach Ledger." });
    } catch (error) {
      if (job) await send("ledgerSchwabError", { message: error.message }).catch(() => {});
    } finally { stop(); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.action !== "ledgerCancelSchwab") return false;
    stop(); respond({ success: true }); return false;
  });
  chrome.runtime.sendMessage({ action: "ledgerSchwabReady" }).then((response) => {
    if (!response?.success) return;
    job = { nonce: response.nonce, startDate: response.startDate, endDate: response.endDate, started: Date.now() };
    if (typeof globalThis.LedgerSchwabCsv?.sanitize !== "function") {
      void send("ledgerSchwabError", { message: "Schwab parser did not load. Reload Ledger Data Importer in chrome://extensions, refresh Ledger, and retry." }).catch(() => {});
      stop(); return;
    }
    control("arm", job.nonce);
    void tick();
  }).catch(() => {});
})();
