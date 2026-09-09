// Observe Walmart's own list requests; do not replay requests or collect headers.
(() => {
  "use strict";
  // Keep this entry point standalone. Chrome deduplicates static script paths
  // across worlds, so loading receipts.js here would skip it in ISOLATED.
  // Copy only bounded history identifiers/dates. The isolated parser validates
  // and normalizes these untrusted values before requesting any receipts.
  function historyFields(payload) {
    const props = payload?.props?.pageProps || payload?.pageProps;
    const nodes = [payload, payload?.data, props?.initialData?.data, props?.phRedesignInitialData?.data];
    const history = nodes.find((node) => node?.purchaseHistory)?.purchaseHistory;
    if (!history) return null;
    if (!Array.isArray(history.orders) || history.orders.length > 1000
      || !history.pageInfo || !("nextPageCursor" in history.pageInfo)) throw new Error("Invalid pagination");
    const cursor = history.pageInfo.nextPageCursor;
    if (cursor != null && (typeof cursor !== "string" || cursor.length > 10000)) throw new Error("Invalid cursor");
    const orders = history.orders.map((order) => {
      const orderId = String(order?.id || order?.orderId || "");
      const orderDate = order?.orderDate || order?.title || order?.shortTitle;
      if (!/^[\d-]{5,80}$/.test(orderId) || typeof orderDate !== "string" || !orderDate || orderDate.length > 200) {
        throw new Error("Invalid order identifier/date");
      }
      return { orderId, orderDate };
    });
    return { orders, nextPageCursor: cursor ?? null };
  }
  const isHistory = (value) => {
    try {
      const url = new URL(value, location.href);
      return url.origin === "https://www.walmart.com"
        && url.pathname.startsWith("/orchestra/cph/graphql/PurchaseHistoryV3/");
    } catch { return false; }
  };
  const publish = (payload) => {
    try {
      const snapshot = historyFields(payload);
      if (snapshot) window.postMessage({ source: "ledger-walmart-history", snapshot }, location.origin);
    } catch {
      window.postMessage({ source: "ledger-walmart-history", error: "Walmart changed its purchase-history data format." }, location.origin);
    }
  };
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    if (isHistory(args[0]?.url || args[0])) {
      result.then((response) => {
        if (response.ok) response.clone().json().then(publish).catch(() => {});
      }).catch(() => {});
    }
    return result;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isHistory(url)) this.addEventListener("load", () => {
      try {
        if (this.status === 200) publish(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
      } catch { /* A login/challenge page is not an empty history. */ }
    }, { once: true });
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
})();
