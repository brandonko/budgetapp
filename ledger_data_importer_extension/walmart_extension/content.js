(() => {
  "use strict";
  const reader = globalThis.LedgerWalmartReceipts;
  let active = null;
  let latest = null;
  let sequence = 0;
  let historyError = "";
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== "https://www.walmart.com"
        || event.data?.source !== "ledger-walmart-history") return;
    const snapshot = event.data.snapshot;
    if (event.data.error) historyError = "Walmart changed its purchase-history data format.";
    if (!snapshot || !Array.isArray(snapshot.orders) || snapshot.orders.length > 1000) return;
    // Page messages are untrusted, even though our observer emits them.
    if (snapshot.orders.some((order) => typeof order?.orderId !== "string" || !/^[\d-]{5,80}$/.test(order.orderId)
      || typeof order.orderDate !== "string" || order.orderDate.length > 200)) return;
    if (snapshot.nextPageCursor !== null && (typeof snapshot.nextPageCursor !== "string"
      || snapshot.nextPageCursor.length > 10000)) return;
    if (typeof reader?.history !== "function") return;
    try {
      latest = reader.history({ purchaseHistory: {
        orders: snapshot.orders, pageInfo: { nextPageCursor: snapshot.nextPageCursor },
      } });
      sequence += 1;
    } catch {
      historyError = "Walmart returned an unfamiliar order identifier or date. No partial import was created.";
    }
  });
  const send = (action, data) => chrome.runtime.sendMessage({ action, data });
  function nextData(doc) {
    const text = doc.querySelector("script#__NEXT_DATA__")?.textContent;
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw new Error("Walmart returned an unreadable receipt page."); }
  }
  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  async function waitFor(read, signal) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (historyError) throw new Error(historyError);
      const value = read();
      if (value) return value;
      await pause(200, signal);
    }
    throw new Error("Walmart did not load the next purchase-history page. Complete any sign-in/security check, then retry. No partial import was created.");
  }
  function nextButton() {
    const candidates = document.querySelectorAll('button[data-automation-id*="next-pages-button"], button[aria-label="Next page"]');
    return [...candidates].find((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true" && button.getClientRects().length);
  }
  async function fetchReceipt(order, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 30000);
    try {
      signal.throwIfAborted();
      const response = await fetch(`/orders/${encodeURIComponent(order.orderId)}`, {
        credentials: "include", signal: controller.signal, headers: { Accept: "text/html" },
      });
      if (!response.ok) throw new Error(`Walmart receipt returned HTTP ${response.status}. Complete any security check in Walmart and retry.`);
      if (new URL(response.url).origin !== "https://www.walmart.com") throw new Error("Sign in to Walmart and try again.");
      const html = await response.text();
      if (html.length > 20 * 1024 * 1024) throw new Error("Walmart receipt page was too large.");
      return reader.receipt(nextData(new DOMParser().parseFromString(html, "text/html")), order);
    } catch (error) {
      if (controller.signal.aborted && !signal.aborted) throw new Error("Walmart receipt request timed out. Please retry.");
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  async function collect(startDate, endDate, signal) {
    const orders = [];
    const seenOrders = new Set();
    const seenPages = new Set();
    let snapshot = await waitFor(() => latest || reader.history(nextData(document)), signal);
    for (let page = 1; page <= 300; page += 1) {
      const fingerprint = JSON.stringify(snapshot);
      if (seenPages.has(fingerprint)) throw new Error("Walmart repeated a history page. Collection stopped to avoid an incomplete import.");
      seenPages.add(fingerprint);
      await send("ledgerWalmartProgress", { progress: Math.min(90, 5 + page), message: `Scanning Walmart history page ${page} · ${orders.length} receipts in range…` });
      for (const order of snapshot.orders) {
        if (seenOrders.has(order.orderId)) continue; // list render duplicates, not item duplicates
        seenOrders.add(order.orderId);
        if (order.orderDate < startDate || order.orderDate > endDate) continue;
        await send("ledgerWalmartProgress", { progress: Math.min(90, 5 + page), message: `Reading Walmart history page ${page} · ${orders.length + 1} receipts in range…` });
        orders.push(await fetchReceipt(order, signal));
        if (JSON.stringify(orders).length > 15 * 1024 * 1024) throw new Error("Walmart export is too large. Use a shorter date range.");
        await pause(350, signal);
      }
      if (!snapshot.nextPageCursor) return { version: 1, orders };
      if (page === 300) throw new Error("Walmart history exceeds the 300-page safety limit; no partial import was created.");
      const before = sequence;
      const button = await waitFor(nextButton, signal);
      button.click(); // Only Walmart's next-page control; no checkout/payment actions.
      snapshot = await waitFor(() => sequence > before ? latest : null, signal);
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.action === "ledgerCancelWalmart") {
      active?.abort(); respond({ success: true }); return false;
    }
    if (message?.action !== "ledgerCaptureWalmart") return false;
    if (typeof reader?.history !== "function" || typeof reader?.receipt !== "function") {
      respond({ success: false, error: "The Walmart parser did not load. Reload Ledger Data Importer in chrome://extensions, refresh Ledger, and start a new import." });
      return false;
    }
    if (active) { respond({ success: true }); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(message.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(message.endDate)
        || message.startDate > message.endDate) { respond({ success: false, error: "Invalid Walmart date range." }); return false; }
    active = new AbortController();
    const controller = active;
    let timedOut = false;
    const limit = setTimeout(() => { timedOut = true; controller.abort(); }, 25 * 60 * 1000);
    collect(message.startDate, message.endDate, controller.signal).then(async (exported) => {
      controller.signal.throwIfAborted();
      const result = await send("ledgerWalmartComplete", { content: JSON.stringify(exported) });
      if (!result?.success) throw new Error(result?.error || "Ledger could not receive the Walmart export.");
    }).catch(async (error) => {
      if (timedOut || error?.name !== "AbortError") await send("ledgerWalmartError", {
        message: timedOut ? "Walmart collection timed out. Retry after checking Walmart's page." : error.message || "Walmart export failed.",
      }).catch(() => {});
    }).finally(() => { clearTimeout(limit); if (active === controller) active = null; });
    respond({ success: true });
    return false;
  });
  send("ledgerWalmartReady", {}).catch(() => {});
})();
