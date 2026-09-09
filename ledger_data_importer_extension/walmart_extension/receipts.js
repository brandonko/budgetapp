/* Independent, dependency-free reader for Walmart's purchase-history page data.
 * Loaded only in the isolated collector's world; also used by fixture tests.
 * Only allowlisted receipt fields leave this reader; never addresses or payments.
 */
(() => {
  "use strict";
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  function date(value) {
    const raw = clean(value);
    let iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
    if (!iso) {
      const match = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
      if (match) {
        const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
        iso = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
      }
    }
    if (!iso || new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) !== iso) {
      throw new Error("Walmart returned an unfamiliar order date; no partial import was created.");
    }
    return iso; // Keep Walmart's calendar date, not the UTC-converted day.
  }
  function money(value) {
    if (object(value)) {
      if (value.currency && value.currency !== "USD") throw new Error("Only USD Walmart receipts are supported.");
      value = value.displayValue ?? value.value;
    }
    const text = clean(value).replace(/^(?:USD\s*|US\$\s*|\$\s*)/, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
      throw new Error("Walmart returned a missing or unfamiliar receipt price; no amounts were guessed.");
    }
    const number = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(number) || number > 1e9) throw new Error("Walmart receipt amount is out of range.");
    return number.toFixed(2);
  }
  function dataNodes(payload) {
    const props = payload?.props?.pageProps || payload?.pageProps;
    return [payload, payload?.data, props?.initialData?.data, props?.phRedesignInitialData?.data];
  }
  function orderKey(order) {
    const orderId = clean(order?.id || order?.orderId).replace(/-/g, "");
    if (!/^\d{5,50}$/.test(orderId)) throw new Error("Walmart returned an unfamiliar order identifier.");
    return { orderId, orderDate: date(order.orderDate || order.title || order.shortTitle) };
  }
  function history(payload) {
    const node = dataNodes(payload).find((value) => object(value?.purchaseHistory))?.purchaseHistory;
    if (!node) return null;
    if (!Array.isArray(node.orders) || node.orders.length > 1000 || !object(node.pageInfo)
        || !("nextPageCursor" in node.pageInfo)) {
      throw new Error("Walmart changed its purchase-history pagination; no partial import was created.");
    }
    return {
      orders: node.orders.map(orderKey),
      nextPageCursor: node.pageInfo.nextPageCursor == null ? null : String(node.pageInfo.nextPageCursor),
    };
  }
  function status(value) {
    if (typeof value === "string") return clean(value);
    if (Array.isArray(value)) return value.map(status).filter(Boolean).join(" ");
    if (!object(value)) return "";
    return status(value.message || value.parts || value.text || value.label || "");
  }
  const cancelled = (value) => /\bcancel|unavailable|out of stock/i.test(value);
  function receipt(payload, expected) {
    const order = dataNodes(payload).find((value) => object(value?.order))?.order;
    if (!order) throw new Error("Walmart receipt data was not found. Sign in or complete any security check in Walmart, then retry.");
    const key = orderKey(order);
    if (key.orderId !== expected.orderId || key.orderDate !== expected.orderDate) {
      throw new Error("Walmart returned a different receipt than requested; collection stopped.");
    }
    const groups = order.groups_2101?.length ? order.groups_2101 : order.groups;
    if (!Array.isArray(groups) || !groups.length) throw new Error("Walmart returned a receipt with no fulfillment groups.");
    const prices = order.priceDetails || {};
    const states = groups.map((group) => status(group.status));
    if (states.every(cancelled)) return { ...key, skipReason: "cancelled" };
    if ((prices.refund != null && Number(money(prices.refund)) > 0)
        || states.some((text) => /return|refund/i.test(text))) return { ...key, skipReason: "refund" };
    if (states.some((text) => !cancelled(text) && !/delivered|picked up|purchased|complete/i.test(text))) {
      return { ...key, skipReason: "pending" };
    }
    const items = [];
    for (const group of groups) {
      if (cancelled(status(group.status))) continue;
      // The flat ordered-items view may duplicate the charged categories view.
      // Traverse one view only, keeping legitimate identical charged lines.
      const categories = group.categories?.length ? group.categories
        : (group.subGroups || []).flatMap((child) => child.categories || []);
      if (categories.some((category) => /return|refund/i.test(category.type || ""))) {
        return { ...key, skipReason: "refund" };
      }
      const charged = categories.length ? categories.filter((category) => !cancelled(category.type || ""))
        .flatMap((category) => category.items || []) : group.items;
      if (!Array.isArray(charged)) throw new Error("Walmart changed its itemized receipt format.");
      for (const item of charged) {
        if (cancelled(status(item.status))) continue;
        const title = clean(item.productInfo?.name || item.name);
        const quantity = Number(item.quantity);
        if (!title || title.length > 500 || typeof item.quantity === "boolean" || !Number.isFinite(quantity)
            || quantity <= 0 || quantity > 10000) throw new Error("Walmart returned an incomplete receipt item.");
        // linePrice is already quantity-extended, including weighted groceries.
        const lineTotal = money(item.priceInfo?.linePrice ?? item.linePrice);
        items.push({ title, quantity, lineTotal });
      }
    }
    if (!items.length) throw new Error("Walmart returned no charged item lines for a completed receipt.");
    const total = prices.grandTotalWithTips != null ? money(prices.grandTotalWithTips)
      : ((Math.round(Number(money(prices.grandTotal)) * 100)
        + Math.round(Number(prices.driverTip == null ? 0 : money(prices.driverTip)) * 100)) / 100).toFixed(2);
    return { ...key, currency: "USD", total, items };
  }
  globalThis.LedgerWalmartReceipts = Object.freeze({ date, money, history, receipt });
})();
