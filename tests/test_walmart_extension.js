"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..", "ledger_data_importer_extension");
const source = (file) => fs.readFileSync(path.join(root, "walmart_extension", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const key = { orderId: "123450001", orderDate: "2026-08-20" };
function order() {
  return { id: key.orderId, orderDate: "2026-08-20T23:30:00-07:00",
    priceDetails: { grandTotal: { displayValue: "$20.05" }, driverTip: { displayValue: "$2.00" } },
    paymentMethods: [{ secret: "NEVER EXPORT" }], deliveryAddress: { secret: "PRIVATE ADDRESS" },
    groups_2101: [{ status: { message: { parts: [{ text: "Delivered" }] } }, categories: [
      { type: "PURCHASED", items: [
        { productInfo: { name: "Synthetic milk" }, quantity: 2, priceInfo: { linePrice: { displayValue: "$8.00" } } },
        { productInfo: { name: "Synthetic fruit" }, quantity: 0.75, priceInfo: { linePrice: { displayValue: "$4.00" } } },
      ] },
      { type: "UNAVAILABLE", items: [{ productInfo: { name: "Uncharged" }, quantity: 1 }] },
    ] }],
  };
}
const payload = (order) => ({ props: { pageProps: { initialData: { data: { order } } } } });
const history = (orders, nextPageCursor = null) => ({ data: { purchaseHistory: { orders, pageInfo: { nextPageCursor } } } });
function core() {
  const ctx = vm.createContext({ URL, Date });
  vm.runInContext(source("receipts.js"), ctx);
  return ctx.LedgerWalmartReceipts;
}

test("Walmart keeps local order date and extracts only charged receipt fields", () => {
  const reader = core();
  const data = order();
  data.groups_2101[0].items = [{ name: "Duplicate flat ordered view" }];
  data.groups_2101[0].subGroups = [{ categories: data.groups_2101[0].categories }];
  const result = reader.receipt(payload(data), key);
  assert.equal(result.total, "22.05");
  assert.equal(result.orderDate, "2026-08-20");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].lineTotal, "8.00");
  assert.equal(result.items[1].quantity, 0.75);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|NEVER|paymentMethods|deliveryAddress|Uncharged|Duplicate/);
});

test("Walmart prefers total-with-tips and preserves identical charged occurrences", () => {
  const data = order();
  data.priceDetails.grandTotalWithTips = { displayValue: "$23.25" };
  data.groups_2101[0].categories[0].items.push(data.groups_2101[0].categories[0].items[0]);
  const result = core().receipt(payload(data), key);
  assert.equal(result.total, "23.25");
  assert.equal(result.items.length, 3);
  assert.deepEqual(plain(result.items[0]), plain(result.items[2]));
});

test("Walmart classifies pending, cancelled and refunded receipts as explicit skips", () => {
  for (const [status, skipReason] of [["Arriving tomorrow", "pending"], ["Canceled", "cancelled"], ["Returned", "refund"]]) {
    const data = order(); data.groups_2101[0].status = status;
    assert.equal(core().receipt(payload(data), key).skipReason, skipReason);
  }
  const data = order(); data.priceDetails.refund = { displayValue: "$1.00" };
  assert.equal(core().receipt(payload(data), key).skipReason, "refund");
});

test("Walmart refuses guessed prices, invalid dates and mismatched receipts", () => {
  const reader = core();
  for (const value of [null, "CAD 1.00", "about $2", "NaN", "$-2", true, "$1.234"]) {
    assert.throws(() => reader.money(value));
  }
  assert.throws(() => reader.date("2026-02-30"));
  assert.equal(reader.date("August 20, 2026 order"), key.orderDate);
  assert.throws(() => reader.receipt(payload(order()), { ...key, orderId: "999990001" }));
  const data = order(); delete data.groups_2101[0].categories[0].items[0].priceInfo.linePrice;
  assert.throws(() => reader.receipt(payload(data), key), /price/);
});

test("Walmart history distinguishes an explicit empty last page from unknown pagination", () => {
  const reader = core();
  assert.deepEqual(plain(reader.history(history([]))), { orders: [], nextPageCursor: null });
  assert.equal(reader.history({ login: true }), null);
  assert.throws(() => reader.history({ data: { purchaseHistory: { orders: [] } } }));
  const data = reader.history(history([order()], "next-page"));
  assert.deepEqual(plain(data.orders), [key]);
  assert.doesNotMatch(JSON.stringify(data), /price|PRIVATE|NEVER/);
});

test("Walmart observer only publishes minimal history and does not change the site's response", async () => {
  const messages = [];
  const response = { ok: true, clone() { return { json: async () => history([order()]) }; } };
  const originalPromise = Promise.resolve(response);
  const window = { fetch() { return originalPromise; }, postMessage(message) { messages.push(message); } };
  const context = vm.createContext({ URL, Date, window, location:{href:"https://www.walmart.com/orders",origin:"https://www.walmart.com"},
    XMLHttpRequest: class { open() {} addEventListener() {} },
  });
  vm.runInContext(source("observer.js"), context);
  assert.equal(window.fetch("/orchestra/cph/graphql/PurchaseHistoryV3/observed"),originalPromise);
  await new Promise(setImmediate);
  assert.equal(messages.length,1);
  assert.deepEqual(plain(messages[0].snapshot.orders),[{ orderId: key.orderId, orderDate: order().orderDate }]);
  const normalized = core().history({ purchaseHistory: { orders: messages[0].snapshot.orders, pageInfo: messages[0].snapshot } });
  assert.deepEqual(plain(normalized.orders), [key]);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE|NEVER|price|cookie|token/i);
  window.fetch("https://unrelated.example/orchestra/cph/graphql/PurchaseHistoryV3/no");
  window.fetch("/orchestra/payments/private");
  await new Promise(setImmediate);
  assert.equal(messages.length,1);
});

test("Walmart collector follows real Next control, preserves range and waits for fresh history", {timeout:3000}, async () => {
  const events = {};
  const messages = [];
  let listener;
  let clicks = 0;
  let requested = [];
  const second = { ...order(), id: "123450002" };
  const firstHistory = history([order(), { ...order(), id: "123450099", orderDate: "2025-01-01" }], "page-two");
  let finished;
  const complete = new Promise((resolve) => { finished = resolve; });
  const fakeWindow = { addEventListener(type, callback) { events[type] = callback; } };
  const context = vm.createContext({ URL, Date, AbortController, DOMException, JSON,
    window: fakeWindow,
    document: {
      querySelector() { return { textContent: JSON.stringify(firstHistory) }; },
      querySelectorAll() { return [{ disabled: false, getAttribute() { return null; }, getClientRects() { return [1]; },
        click() { clicks += 1; events.message({ source: fakeWindow, origin: "https://www.walmart.com", data: {
          source: "ledger-walmart-history", snapshot: { orders: [key, { ...key, orderId: second.id }], nextPageCursor: null },
        } }); } }]; },
    },
    DOMParser: class { parseFromString(text) { return { querySelector() { return { textContent: text }; } }; } },
    fetch: async (url, options) => {
      requested.push(url);
      assert.equal(options.credentials, "include");
      return { ok: true, url: `https://www.walmart.com${url}`, text: async () => JSON.stringify(payload(url.endsWith(second.id) ? second : order())) };
    },
    setTimeout(fn, delay) { return delay < 1000 ? setTimeout(fn, 0) : null; }, clearTimeout,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(message) { messages.push(message); if (message.action === "ledgerWalmartComplete") finished(message); return { success: true }; },
    } },
  });
  vm.runInContext(source("receipts.js"), context);
  vm.runInContext(source("content.js"), context);
  listener({ action: "ledgerCaptureWalmart", startDate: key.orderDate, endDate: key.orderDate }, {}, () => {});
  const result = await complete;
  assert.equal(clicks, 1);
  assert.equal(requested.length, 2);
  assert.equal(JSON.parse(result.data.content).orders.length, 2);
  assert.equal(messages.some((message) => message.action === "ledgerWalmartError"), false);
  assert.doesNotMatch(result.data.content, /PRIVATE|NEVER/);
});

function coordinator() {
  const stores = { session: {}, local: {} };
  const listeners = {};
  const calls = [];
  const responses = [];
  let tabId = 0;
  const storage = (name) => ({ async get(key) { return { [key]: stores[name][key] }; },
    async set(value) { Object.assign(stores[name], value); }, async remove(key) { delete stores[name][key]; } });
  const context = vm.createContext({ URL, Date, AbortSignal, TextEncoder,
    chrome: { storage: { session: storage("session"), local: storage("local") },
      runtime: { onMessage: { addListener(fn) { listeners.message = fn; } } },
      tabs: { async create(data) { calls.push(data); return { id: ++tabId }; },
        async update(id, data) { calls.push({ id, ...data }); }, async sendMessage(id, message) { calls.push({ id, ...message }); return { success: true }; },
        onUpdated: { addListener(fn) { listeners.updated = fn; } }, onRemoved: { addListener(fn) { listeners.removed = fn; } },
      } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ status: "review" }) }; },
  });
  vm.runInContext(source("coordinator.js").replace("export function", "function"), context);
  context.registerWalmartImporter({ validateRequest(data, sender) {
    if (!sender.url?.startsWith("http://localhost:8000/import")) throw new Error("Untrusted sender");
  }, broadcast: async (...args) => responses.push(args) });
  const message = (action, data, sender) => new Promise((resolve) => listeners.message({ action, data }, sender, resolve));
  return { stores, calls, listeners, responses, message };
}

test("Walmart coordinator validates source ownership, strips start payload and cancels durably", async () => {
  const env = coordinator();
  const data = { token: "t".repeat(40), ledgerOrigin: "http://localhost:8000", startDate: key.orderDate, endDate: key.orderDate, secret: "do not retain" };
  assert.equal((await env.message("ledgerStartWalmartImport", data, { url: "https://evil.example/import" })).success, false);
  assert.equal(env.calls.length, 0);
  const ledger = { url: "http://localhost:8000/import" };
  assert.equal((await env.message("ledgerStartWalmartImport", data, ledger)).success, true);
  assert.doesNotMatch(JSON.stringify(env.stores), /do not retain|secret/);
  assert.equal((await env.message("ledgerWalmartComplete", { content: "{}" }, { tab: { id: 99 }, url: "https://www.walmart.com/orders" })).success, false);
  assert.equal(env.calls.some((call) => call.url?.endsWith("/complete")), false);
  assert.equal((await env.message("ledgerCancelWalmartImport", { token: data.token }, { url: "https://evil.example/import" })).success, false);
  assert.equal((await env.message("ledgerCancelWalmartImport", { token: data.token }, ledger)).success, true);
  assert.deepEqual(env.stores, { session: {}, local: {} });
  assert.equal(env.calls.some((call) => call.url?.endsWith("/cancel")), true);
  assert.equal((await env.message("ledgerWalmartComplete", { content: "{}" }, { tab: { id: 1 }, url: "https://www.walmart.com/orders" })).success, false);
});

test("Walmart coordinator completes only the owned tab and removes recovery state", async () => {
  const env = coordinator();
  const data = { token: "t".repeat(40), ledgerOrigin: "http://localhost:8000", startDate: key.orderDate, endDate: key.orderDate };
  await env.message("ledgerStartWalmartImport", data, { url: "http://localhost:8000/import" });
  const sender = { tab: { id: 1 }, url: "https://www.walmart.com/orders" };
  await env.message("ledgerWalmartReady", {}, sender);
  const capture = env.calls.find((call) => call.action === "ledgerCaptureWalmart");
  assert.equal(capture.startDate, key.orderDate);
  assert.equal(capture.token, undefined, "Session token never reaches Walmart's content script");
  await env.message("ledgerWalmartComplete", { content: '{"version":1,"orders":[]}' }, sender);
  assert.equal(env.calls.filter((call) => call.url?.endsWith("/complete")).length, 1);
  assert.deepEqual(env.stores, { session: {}, local: {} });
  assert.equal(env.calls.some((call) => call.url?.includes("/commit")), false);
});

test("Walmart manifest scopes observer to purchase pages and retains other importers", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.ok(manifest.host_permissions.includes("https://www.walmart.com/*"));
  assert.ok(!manifest.host_permissions.includes("*://*.walmart.com/*"));
  const observer = manifest.content_scripts.find((entry) => entry.js.includes("walmart_extension/observer.js"));
  assert.deepEqual(observer.matches, ["https://www.walmart.com/orders*"]);
  assert.equal(observer.world, "MAIN");
  for (const importer of ["ebay", "creditkarma", "venmo", "apple_card", "amazon"]) {
    assert.ok(manifest.content_scripts.some((entry) => entry.js.includes(`${importer}_extension/content.js`)));
  }
});
