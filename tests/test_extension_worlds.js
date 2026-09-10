"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "ledger_data_importer_extension");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

// Chromium deduplicates static content-script paths per extension/document,
// not per execution world. Run actual manifest entries in independent globals,
// skipping previously injected paths instead of manually preloading helpers.
// https://github.com/chromium/chromium/blob/main/extensions/renderer/user_script_injector.cc
function loadWorlds(source, href, { initialHistory = true, omitFiles = [] } = {}) {
  const messages = [], events = [], sentToPage = [], listeners = [], requests = [];
  const location = { href, origin: new URL(href).origin };
  const emptyHistory = { data: { purchaseHistory: { orders: [], pageInfo: { nextPageCursor: null } } } };
  const document = { querySelector: () => initialHistory ? ({ textContent: JSON.stringify(emptyHistory) }) : null,
    querySelectorAll: () => [], addEventListener() {} };
  const worlds = {};
  for (const world of ["MAIN", "ISOLATED"]) {
    class TestURL extends URL { static createObjectURL() { return `blob:${location.origin}/synthetic`; } }
    const window = { fetch: (...args) => { requests.push(args); return Promise.resolve({ ok: true, clone: () => ({ json: async () => emptyHistory }) }); },
      addEventListener(type, handler) { if (type === "message") events.push({ window, handler }); },
      postMessage(data) {
        sentToPage.push(plain(data));
        queueMicrotask(() => events.forEach((entry) => entry.handler({ source: entry.window, origin: location.origin, data })));
      } };
    const context = vm.createContext({ window, document, location, URL: TestURL, Date, Blob, TextEncoder,
      AbortController, AbortSignal, DOMException, JSON, queueMicrotask,
      XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
      setTimeout: () => 1, clearTimeout() {}, getComputedStyle: () => ({ visibility: "visible" }),
      chrome: world === "ISOLATED" ? { runtime: {
        onMessage: { addListener(handler) { listeners.push(handler); } },
        async sendMessage(message) {
          messages.push(plain(message));
          return ["ledgerCapitalOneReady", "ledgerSchwabReady"].includes(message.action)
            ? { success: true, nonce: "12345678-1234-1234-1234-123456789abc", startDate: "2026-08-20", endDate: "2026-08-21" }
            : { success: true };
        },
      } } : undefined,
    });
    worlds[world] = context;
  }
  const injected = new Set(), skipped = [];
  const entries = manifest.content_scripts.filter((entry) => entry.js.some((file) => file.startsWith(`${source}_extension/`)));
  for (const entry of entries) {
    for (const file of entry.js) {
      if (omitFiles.includes(file)) continue;
      if (injected.has(file)) { skipped.push(file); continue; }
      injected.add(file);
      vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), worlds[entry.world || "ISOLATED"], { filename: file });
    }
  }
  return { worlds, skipped, messages, sentToPage, requests,
    send: (message) => {
      const responses = [];
      listeners.forEach((handler) => handler(message, {}, (value) => responses.push(plain(value))));
      return responses;
    } };
}

test("Walmart's manifest boots the isolated collector without preloading its parser", async () => {
  const env = loadWorlds("walmart", "https://www.walmart.com/orders");
  env.send({ action: "ledgerCaptureWalmart", startDate: "2026-08-20", endDate: "2026-08-21" });
  await flush();
  const failure = env.messages.find((message) => message.action === "ledgerWalmartError");
  assert.equal(failure, undefined, JSON.stringify(failure));
  const completed = env.messages.find((message) => message.action === "ledgerWalmartComplete");
  assert.ok(completed, "A valid empty history should complete, not crash on reader.history");
  assert.deepEqual(JSON.parse(completed.data.content), { version: 1, orders: [] });
});

test("Capital One's manifest captures and sanitizes CSV across separate globals", async () => {
  const env = loadWorlds("capitalone", "https://myaccounts.capitalone.com/transactions");
  await flush();
  vm.runInContext(`URL.createObjectURL(new Blob(['Transaction Date,Posted Date,Card No.,Description,Debit,Credit\\n2026-08-20,2026-08-22,9999,Test shop,12.34,\\n']));`, env.worlds.MAIN);
  await flush();
  const completed = env.messages.find((message) => message.action === "ledgerCapitalOneComplete");
  assert.ok(completed, JSON.stringify(env.messages));
  assert.doesNotMatch(completed.data.content, /9999|card no|posted date/i);
  assert.match(completed.data.content, /Test shop/);
  assert.equal(env.messages.some((message) => message.action === "ledgerCapitalOneError"), false);
});

test("Walmart's standalone page observer feeds the isolated collector without embedded history", async () => {
  const env = loadWorlds("walmart", "https://www.walmart.com/orders", { initialHistory: false });
  await env.worlds.MAIN.window.fetch("/orchestra/cph/graphql/PurchaseHistoryV3/synthetic");
  await flush();
  assert.equal(env.sentToPage.length, 1);
  assert.deepEqual(env.sentToPage[0].snapshot, { orders: [], nextPageCursor: null });
  env.send({ action: "ledgerCaptureWalmart", startDate: "2026-08-20", endDate: "2026-08-21" });
  await flush();
  assert.ok(env.messages.some((message) => message.action === "ledgerWalmartComplete"));
  assert.equal(env.messages.some((message) => message.action === "ledgerWalmartError"), false);
});

test("missing source parsers fail with reload instructions rather than TypeErrors or exports", async () => {
  const walmart = loadWorlds("walmart", "https://www.walmart.com/orders", { omitFiles: ["walmart_extension/receipts.js"] });
  const [response] = walmart.send({ action: "ledgerCaptureWalmart", startDate: "2026-08-20", endDate: "2026-08-21" });
  assert.equal(response.success, false);
  assert.match(response.error, /parser did not load.*Reload Ledger Data Importer/);
  await flush();
  assert.equal(walmart.messages.some((message) => message.action === "ledgerWalmartComplete"), false);
  assert.equal(walmart.requests.length, 0);
  const capital = loadWorlds("capitalone", "https://myaccounts.capitalone.com/transactions", { omitFiles: ["capitalone_extension/csv.js"] });
  await flush();
  const error = capital.messages.find((message) => message.action === "ledgerCapitalOneError");
  assert.match(error.data.message, /parser did not load.*Reload Ledger Data Importer/);
  assert.equal(capital.messages.some((message) => message.action === "ledgerCapitalOneComplete"), false);
});

test("manifest never reuses a JavaScript path across different execution worlds", () => {
  const paths = new Map();
  for (const entry of manifest.content_scripts) {
    const world = entry.world || "ISOLATED";
    for (const file of entry.js || []) {
      if (paths.has(file)) assert.equal(paths.get(file), world, `${file} cannot be initialized in two worlds using the same static path`);
      paths.set(file, world);
    }
  }
});


test("Schwab manifest loads separate capture and sanitizer worlds; late downloads are ignored", async () => {
  const env = loadWorlds("schwab", "https://client.schwab.com/");
  await flush();
  vm.runInContext(`URL.createObjectURL(new Blob(['Date,Type,Check #,Description,Withdrawal (-),Deposit (+),RunningBalance\\n09/01/2026,VISA,PRIVATE,Test shop,12.34,,999999\\n']));`, env.worlds.MAIN);
  await flush();
  const completed = env.messages.filter((message) => message.action === "ledgerSchwabComplete");
  assert.equal(completed.length, 1, JSON.stringify(env.messages));
  assert.doesNotMatch(completed[0].data.content, /PRIVATE|999999|check #|runningbalance/i);
  assert.equal(env.skipped.length, 0);
  assert.equal(env.requests.length, 0, "Capture does not initiate bank requests");
  const cancelled = loadWorlds("schwab", "https://client.schwab.com/");
  await flush();
  cancelled.send({ action: "ledgerCancelSchwab" });
  vm.runInContext(`URL.createObjectURL(new Blob(['Date,Type,Description,Withdrawal,Deposit\\n09/01/2026,VISA,Test,5,\\n']));`, cancelled.worlds.MAIN);
  await flush();
  assert.equal(cancelled.messages.some((m) => m.action === "ledgerSchwabComplete"), false);
});
