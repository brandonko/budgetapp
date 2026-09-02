"use strict";

let activeController = null;

function textContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .filter(([key]) => !["accessibilityText", "url", "action", "trackingList"].includes(key))
    .map(([, child]) => textContent(child))
    .filter(Boolean)
    .join(" ");
}

function isoDate(value) {
  const text = String(value || "").replace(/^(?:purchased|ordered|paid)(?:\s+on)?\s*/i, "").trim();
  const direct = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (direct) return direct[0];
  const named = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i,
  );
  if (!named) throw new Error(`eBay returned an unfamiliar purchase date: ${value || "(blank)"}.`);
  const parsed = new Date(`${named[1]} ${named[2]}, ${named[3]} 12:00:00 UTC`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`eBay returned an invalid purchase date: ${value}.`);
  return parsed.toISOString().slice(0, 10);
}

function moneyValue(value) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    if (value.value !== undefined) return moneyValue(value.value);
    if (value.text !== undefined) return moneyValue(value.text);
  }
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : null;
}

function quantityFor(card) {
  const aspects = Array.isArray(card?.aspectValuesList) ? card.aspectValuesList : [];
  for (const aspect of aspects) {
    const match = textContent(aspect).match(/\bquantity\s*:\s*(\d+)\b/i);
    if (match) return Number(match[1]);
  }
  return 1;
}

function normalizeOrder(wrapper) {
  const cards = Array.isArray(wrapper?.itemCards) ? wrapper.itemCards : [];
  if (!cards.length) return null;
  const dateText = wrapper?.secondaryMessage?.[1]?.textSpans?.[0]?.text || textContent(wrapper?.secondaryMessage?.[1]);
  const totalText = wrapper?.secondaryMessage?.[3]?.textSpans?.[0]?.text || textContent(wrapper?.secondaryMessage?.[3]);
  const items = cards.map((card) => {
    const rawPrice = card?.additionalPrice?.value;
    return {
      title: card?.image?.title || textContent(card?.title) || "eBay purchase",
      price: moneyValue(rawPrice),
      currency: rawPrice?.currency || rawPrice?.value?.currency || "USD",
      quantity: quantityFor(card),
      seller: card?.__myb?.sellerInfo?.[1]?.textSpans?.[0]?.text || "",
      listingId: card?.listingId ? String(card.listingId) : "",
    };
  });
  const orderId = cards.find((card) => card?.__myb?.orderId)?.__myb?.orderId || "";
  return {
    orderDate: isoDate(dateText),
    orderId: String(orderId),
    total: moneyValue(totalText),
    currency: "USD",
    status: textContent(wrapper?.primaryMessage),
    items,
  };
}

function yearFilter(year) {
  const difference = new Date().getFullYear() - year;
  if (difference < 0 || difference > 20) {
    throw new Error(`eBay purchase history does not provide a supported filter for ${year}.`);
  }
  if (difference === 0) return "CURRENT_YEAR";
  if (difference === 1) return "LAST_YEAR";
  const words = ["TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY"];
  return `${words[difference - 2]}_YEARS_AGO`;
}

async function fetchYear(year, signal, reportProgress) {
  const orders = [];
  const seenPages = new Set();
  for (let page = 1; page <= 300; page += 1) {
    reportProgress(page);
    const params = new URLSearchParams({
      filter: `year_filter:${yearFilter(year)}`,
      page: String(page),
      modules: "ALL_TRANSACTIONS",
      moduleId: "122164",
      pg: "purchase",
      mp: "purchase-module-v2",
    });
    const response = await fetch(`/mye/myebay/ajax/v2/purchase/mp/get?${params}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    const body = await response.text();
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error("Sign in to eBay, then try the import again.");
      throw new Error(`eBay purchase history returned HTTP ${response.status}.`);
    }
    let payload;
    try { payload = JSON.parse(body); } catch {
      if (/sign[ -]?in|log[ -]?in/i.test(body)) throw new Error("Sign in to eBay, then try the import again.");
      throw new Error("eBay returned an unfamiliar purchase-history response.");
    }
    const wrappers = payload?.modules?.RIVER?.[0]?.data?.items;
    if (!Array.isArray(wrappers) || wrappers.length === 0) break;
    const fingerprint = JSON.stringify(wrappers.map((item) => item?.itemCards?.[0]?.__myb?.orderId || item?.itemCards?.[0]?.listingId || ""));
    if (seenPages.has(fingerprint)) break;
    seenPages.add(fingerprint);
    orders.push(...wrappers.map(normalizeOrder).filter(Boolean));
  }
  return orders;
}

async function captureEbay(startDate, endDate) {
  if (activeController) throw new Error("An eBay import is already running in this tab.");
  activeController = new AbortController();
  try {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    const orders = [];
    for (let index = 0; index < years.length; index += 1) {
      const year = years[index];
      const fetched = await fetchYear(year, activeController.signal, (page) => {
        chrome.runtime.sendMessage({
          action: "ledgerEbayProgress",
          data: {
            progress: 5 + Math.min(85, Math.floor(((index + Math.min(page / 20, 0.9)) / years.length) * 85)),
            message: `Reading ${year} eBay purchases (page ${page})...`,
          },
        });
      });
      orders.push(...fetched);
    }
    await chrome.runtime.sendMessage({
      action: "ledgerEbayComplete",
      data: { content: JSON.stringify({ orders }) },
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      await chrome.runtime.sendMessage({
        action: "ledgerEbayError",
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  } finally {
    activeController = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "ledgerCaptureEbay") {
    captureEbay(message.startDate, message.endDate);
    sendResponse({ success: true });
  } else if (message?.action === "ledgerCancelEbay") {
    activeController?.abort();
    sendResponse({ success: true });
  } else {
    return false;
  }
  return true;
});
