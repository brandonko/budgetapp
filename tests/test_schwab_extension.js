"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const root = path.join(__dirname, "..", "ledger_data_importer_extension");
const source = (file) => fs.readFileSync(path.join(root, "schwab_extension", file), "utf8");
const csv = 'Date,Type,Check #,Description,Withdrawal (-),Deposit (+),RunningBalance\r\n09/01/2026,VISA,9999,"Shop, with ""quotes""",12.34,,999999\r\n';
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test("checking sanitizer removes account title and balances while preserving amounts and every occurrence", () => {
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(source("csv.js"), context);
  const { sanitize } = context.LedgerSchwabCsv;
  const data = '\uFEFF"Transactions for checking account PRIVATE as of 09/09/2026"\r\n' + csv + csv.split("\r\n")[1];
  const cleaned = sanitize(data);
  assert.doesNotMatch(cleaned, /PRIVATE|9999|check #|runningbalance/i);
  assert.equal(cleaned.split("\r\n").length, 3);
  assert.match(cleaned, /Shop, with ""quotes""/);
  assert.match(cleaned, /12.34/);
  assert.equal(sanitize(cleaned), cleaned);
  for (const invalid of [csv + '"unclosed', csv + "wrong,columns", csv.replace("RunningBalance", "Date"),
      "Date,Action,Symbol,Amount\n", "x".repeat(16 * 1024 * 1024 + 1)]) assert.throws(() => sanitize(invalid));
});

test("standalone CSV capture is opt-in, passive and stops after cancel; isolated normalization strips account data", async () => {
  const listeners = {}, sent = [], clicks = [];
  class FakeURL extends URL { static createObjectURL() { return "blob:https://client.schwab.com/test"; } }
  class XHR { send() {} }
  const window = { addEventListener(name, fn) { listeners[name] = fn; }, postMessage(data) { sent.push(data); },
    fetch: () => Promise.resolve(new Response(csv, { headers: { "content-type": "text/csv" } })) };
  const originalFetch = window.fetch;
  const context = vm.createContext({ window, location: { origin: "https://client.schwab.com" },
    document: { addEventListener(_name, fn) { clicks.push(fn); } }, URL: FakeURL, XMLHttpRequest: XHR, TextEncoder, Blob, AbortSignal });
  vm.runInContext(source("capture.js"), context);
  FakeURL.createObjectURL(new Blob([csv])); await flush();
  assert.equal(sent.length, 0);
  const nonce = randomUUID();
  const event = (action, eventSource = window) => listeners.message({ source: eventSource, origin: "https://client.schwab.com",
    data: { source: "ledger-schwab-control", action, nonce } });
  event("arm", {});
  FakeURL.createObjectURL(new Blob([csv])); await flush(); assert.equal(sent.length, 0);
  event("arm");
  FakeURL.createObjectURL(new Blob([csv])); await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].nonce, nonce);
  assert.equal(sent[0].content, csv, "The site's CSV stays in-browser until isolated normalization");
  const isolated = vm.createContext({ TextEncoder });
  vm.runInContext(source("csv.js"), isolated);
  assert.doesNotMatch(isolated.LedgerSchwabCsv.sanitize(sent[0].content), /9999|check #|runningbalance/i);
  const response = await window.fetch("/export");
  assert.equal(await response.text(), csv, "Bank receives its original response untouched");
  await flush(); assert.equal(sent.length, 2);
  event("stop");
  FakeURL.createObjectURL(new Blob([csv])); await window.fetch("/export"); await flush();
  assert.equal(sent.length, 2);
  assert.equal(typeof originalFetch, "function");
});

function coordinator(store = {}) {
  const listeners = {}, calls = [];
  const context = vm.createContext({ URL, Date, AbortSignal, TextEncoder, crypto: { randomUUID },
    chrome: { storage: { session: { async get(key) { return { [key]: store[key] }; }, async set(value) { Object.assign(store, value); }, async remove(key) { delete store[key]; } } },
      runtime: { onMessage: { addListener(fn) { listeners.message = fn; } } },
      tabs: { async create(data) { calls.push(data); return { id: 1 }; }, async update(id, data) { calls.push({ id, ...data }); },
        async sendMessage(id, message) { calls.push({ id, ...message }); return { success: true }; }, onRemoved: { addListener(fn) { listeners.removed = fn; } } } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ status: url.endsWith("/complete") ? "review" : "waiting_for_schwab" }) }; },
  });
  vm.runInContext(source("coordinator.js").replace("export function", "function"), context);
  context.registerSchwabImporter({ validateRequest(data, sender) {
    if (new URL(sender.url).origin !== data.ledgerOrigin || new URL(sender.url).pathname !== "/import") throw new Error("Untrusted sender");
  }, broadcast: async () => {} });
  return { calls, store, message: (action, data, sender) => new Promise((resolve) => listeners.message({ action, data }, sender, resolve)) };
}
const start = { token: "t".repeat(40), ledgerOrigin: "http://localhost:8000", startDate: "2026-08-20", endDate: "2026-08-21" };
const ledger = { tab: { id: 12 }, url: "http://localhost:8000/import" };
const bankSender = { tab: { id: 1 }, frameId: 0, url: "https://client.schwab.com/transactions" };

test("Schwab coordinator scopes source tab, frame, nonce and origin; never shares session tokens", async () => {
  const env = coordinator();
  assert.equal((await env.message("ledgerStartSchwabImport", start, { url: "https://evil.example/import" })).success, false);
  assert.equal(env.calls.length, 0);
  assert.equal((await env.message("ledgerStartSchwabImport", { ...start, secret: "Never store" }, ledger)).success, true);
  assert.doesNotMatch(JSON.stringify(env.store), /Never store/);
  const ready = await env.message("ledgerSchwabReady", {}, bankSender);
  assert.equal(ready.success, true);
  assert.equal(ready.token, undefined);
  for (const sender of [{ ...bankSender, tab: { id: 2 } }, { ...bankSender, frameId: 2 }, { ...bankSender, url: "https://evil.example" }]) {
    assert.equal((await env.message("ledgerSchwabComplete", { content: csv, nonce: ready.nonce }, sender)).success, false);
  }
  const newer = await env.message("ledgerSchwabReady", {}, bankSender);
  assert.equal((await env.message("ledgerSchwabComplete", { content: csv, nonce: ready.nonce }, bankSender)).success, false);
  assert.equal((await env.message("ledgerSchwabComplete", { content: csv, nonce: newer.nonce }, bankSender)).success, true);
  assert.equal(env.calls.filter((call) => call.url?.endsWith("/complete")).length, 1);
  assert.equal(env.calls.some((call) => call.url?.endsWith("/commit")), false);
  assert.equal(Object.keys(env.store).length, 0);
});

test("Schwab cancellation rejects unrelated origins and late exports", async () => {
  const env = coordinator();
  await env.message("ledgerStartSchwabImport", start, ledger);
  const ready = await env.message("ledgerSchwabReady", {}, bankSender);
  assert.equal((await env.message("ledgerCancelSchwabImport", start, { url: "https://evil.example/import" })).success, false);
  assert.equal((await env.message("ledgerCancelSchwabImport", start, { ...ledger, tab: { id: 13 } })).success, false);
  assert.equal((await env.message("ledgerCancelSchwabImport", start, ledger)).success, true);
  assert.equal((await env.message("ledgerSchwabComplete", { nonce: ready.nonce, content: csv }, bankSender)).success, false);
  assert.equal(Object.keys(env.store).length, 0);
  assert.equal(env.calls.some((call) => call.url?.endsWith("/complete")), false);
});

test("current export retains blank interest amounts for server warnings without sending balances", () => {
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(source("csv.js"), context);
  const data = '"Date","Status","Type","CheckNumber","Description","Withdrawal","Deposit","RunningBalance"\r\n'
    + '"09/01/2026","Posted","INTADJUST","","Synthetic interest","","","$999.99"\r\n'
    + '"09/02/2026","Posted","VISA","","Synthetic shop","$8.25","","$999.99"\r\n';
  const cleaned = context.LedgerSchwabCsv.sanitize(data);
  assert.equal(cleaned, '"date","status","type","description","withdrawal","deposit"\r\n'
    + '"09/01/2026","Posted","INTADJUST","Synthetic interest","",""\r\n'
    + '"09/02/2026","Posted","VISA","Synthetic shop","$8.25",""');
  assert.doesNotMatch(cleaned, /999\.99|runningbalance|checknumber/i);
});

test("worker suspension preserves job ownership and rejects stale documents", async () => {
  const first = coordinator();
  await first.message("ledgerStartSchwabImport", start, ledger);
  const ready = await first.message("ledgerSchwabReady", {}, { ...bankSender, documentId: "old-document" });
  const resumed = coordinator(first.store);
  assert.equal((await resumed.message("ledgerSchwabComplete", { nonce: ready.nonce, content: csv },
    { ...bankSender, documentId: "another-document" })).success, false);
  const newer = await resumed.message("ledgerSchwabReady", {}, { ...bankSender, documentId: "new-document" });
  assert.equal((await resumed.message("ledgerSchwabComplete", { nonce: ready.nonce, content: csv },
    { ...bankSender, documentId: "old-document" })).success, false);
  assert.equal((await resumed.message("ledgerSchwabComplete", { nonce: newer.nonce, content: csv },
    { ...bankSender, documentId: "new-document" })).success, true);
  assert.equal(resumed.calls.filter((c) => c.url?.endsWith("/complete")).length, 1);
  assert.equal(Object.keys(first.store).length, 0);
});

test("Schwab manifest uses one exact source origin and advertises compatible version", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const entries = manifest.content_scripts.filter((entry) => entry.js.some((file) => file.startsWith("schwab_extension/")));
  assert.equal(entries.length, 2);
  for (const entry of entries) assert.deepEqual(entry.matches, ["https://client.schwab.com/*"]);
  assert.deepEqual(manifest.host_permissions.filter((v) => v.includes("schwab")), ["https://client.schwab.com/*"]);
  assert.ok(manifest.version.localeCompare("0.11.0", undefined, { numeric: true }) >= 0);
});

function importPageFixture() {
  const script = fs.readFileSync(path.join(root, "..", "app", "upload.js"), "utf8");
  const elements = {};
  for (const name of ["StartDate", "EndDate", "Progress", "ProgressBar", "ProgressMessage", "Error", "ImportButton", "CancelButton"]) {
    elements[`schwab${name}`] = { hidden: true, disabled: false, value: "2026-09-01", style: {}, classList: { toggle() {} } };
  }
  const calls = [], messages = [], reviews = [];
  let resolvePoll;
  const context = vm.createContext({ Date, Math, Number, Error, encodeURIComponent,
    MIN_SCHWAB_EXTENSION_VERSION: "0.11.0", elements,
    state: { schwabExtensionReady: true, schwabBusy: false, schwabSessionToken: "", schwabPollTimer: null },
    importAccountIdentity: () => ({ accountName: "Travel checking", accountType: "BANK", provider: "Charles Schwab" }),
    suggestRefundMatches: () => true,
    renderResult: (...args) => reviews.push(args),
    window: { location: { origin: "http://localhost:8000" }, postMessage: (m) => messages.push(m), clearTimeout() {}, setTimeout() { return 1; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options?.method === "POST") return { ok: true, json: async () => ({ token: "synthetic-token" }) };
      return new Promise((resolve) => { resolvePoll = (data) => resolve({ ok: true, json: async () => data }); });
    },
  });
  vm.runInContext(script.slice(script.indexOf("function renderSchwabProgress"), script.indexOf("function renderCapitalOneProgress")), context);
  return { context, calls, messages, reviews, finishPoll: (data) => resolvePoll(data) };
}

test("Schwab import page sends account identity and opens shared review without committing", async () => {
  const env = importPageFixture();
  await env.context.startSchwabImport();
  assert.equal(JSON.parse(env.calls[0].options.body).accountName, "Travel checking");
  assert.equal(env.messages[0].action, "startSchwabImport");
  assert.equal(env.context.elements.schwabCancelButton.hidden, false);
  env.finishPoll({ status: "review", import: { parsed: 1 } });
  await flush();
  assert.equal(env.reviews.length, 1);
  assert.equal(env.reviews[0][1], "schwab");
  assert.equal(env.calls.some((call) => call.url.endsWith("/commit")), false);
});

test("cancelled Schwab page ignores an in-flight review response", async () => {
  const env = importPageFixture();
  await env.context.startSchwabImport();
  await env.context.cancelSchwabImport();
  env.finishPoll({ status: "review", import: { parsed: 1 } });
  await flush();
  assert.equal(env.reviews.length, 0);
  assert.equal(env.context.state.schwabSessionToken, "");
  assert.equal(env.calls.some((call) => call.url.endsWith("/cancel")), true);
  assert.equal(env.calls.some((call) => call.url.endsWith("/commit")), false);
});
