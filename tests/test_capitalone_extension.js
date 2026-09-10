"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const root = path.join(__dirname, "..", "ledger_data_importer_extension");
const source = (file) => fs.readFileSync(path.join(root, "capitalone_extension", file), "utf8");
const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\r\n2026-08-20,2026-08-22,9999,"Shop, with ""quotes""",Shopping,12.34,\r\n';
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test("Capital One CSV sanitizer preserves rows/quoted text/sign columns and removes account data", () => {
  const context = vm.createContext({ TextEncoder });
  vm.runInContext(source("csv.js"), context);
  const { sanitize } = context.LedgerCapitalOneCsv;
  const sanitized = sanitize("\ufeff" + csv + csv.split("\r\n")[1]);
  assert.doesNotMatch(sanitized, /9999|posted date|2026-08-22|card no/i);
  assert.match(sanitized, /Shop, with ""quotes""/);
  assert.equal(sanitized.split("\r\n").length, 3, "Identical financial occurrences stay distinct");
  assert.equal(sanitize(sanitized), sanitized);
  const bank = sanitize("Account Number,Transaction Date,Transaction Amount,Transaction Type,Transaction Description,Balance\n987654321,08/20/2026,-20.00,Debit,Test,999999\n");
  assert.doesNotMatch(bank, /987654321|999999|balance|account number/i);
  assert.match(bank, /-20.00/);
  for (const invalid of ['Date,Amount\n2026-08-20,1', csv + '"unfinished', csv + "wrong,columns", csv.replace("Posted Date", "Transaction Date")]) {
    assert.throws(() => sanitize(invalid));
  }
});

test("standalone CSV capture is opt-in, passive and stops after cancel; isolated normalization strips account data", async () => {
  const listeners = {}, sent = [], clicks = [];
  class FakeURL extends URL { static createObjectURL() { return "blob:https://myaccounts.capitalone.com/test"; } }
  class XHR { send() {} }
  const window = { addEventListener(name, fn) { listeners[name] = fn; }, postMessage(data) { sent.push(data); },
    fetch: () => Promise.resolve(new Response(csv, { headers: { "content-type": "text/csv" } })) };
  const originalFetch = window.fetch;
  const context = vm.createContext({ window, location: { origin: "https://myaccounts.capitalone.com" },
    document: { addEventListener(_name, fn) { clicks.push(fn); } }, URL: FakeURL, XMLHttpRequest: XHR, TextEncoder, Blob, AbortSignal });
  vm.runInContext(source("capture.js"), context);
  FakeURL.createObjectURL(new Blob([csv])); await flush();
  assert.equal(sent.length, 0);
  const nonce = randomUUID();
  const event = (action, eventSource = window) => listeners.message({ source: eventSource, origin: "https://myaccounts.capitalone.com",
    data: { source: "ledger-capitalone-control", action, nonce } });
  event("arm", {});
  FakeURL.createObjectURL(new Blob([csv])); await flush(); assert.equal(sent.length, 0);
  event("arm");
  FakeURL.createObjectURL(new Blob([csv])); await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].nonce, nonce);
  assert.equal(sent[0].content, csv, "The site's CSV stays in-browser until isolated normalization");
  const isolated = vm.createContext({ TextEncoder });
  vm.runInContext(source("csv.js"), isolated);
  assert.doesNotMatch(isolated.LedgerCapitalOneCsv.sanitize(sent[0].content), /9999|card no/i);
  const response = await window.fetch("/export");
  assert.equal(await response.text(), csv, "Bank receives its original response untouched");
  await flush(); assert.equal(sent.length, 2);
  event("stop");
  FakeURL.createObjectURL(new Blob([csv])); await window.fetch("/export"); await flush();
  assert.equal(sent.length, 2);
  assert.equal(typeof originalFetch, "function");
});

function coordinator() {
  const store = {}, listeners = {}, calls = [];
  const context = vm.createContext({ URL, Date, AbortSignal, TextEncoder, crypto: { randomUUID },
    chrome: { storage: { session: { async get(key) { return { [key]: store[key] }; }, async set(value) { Object.assign(store, value); }, async remove(key) { delete store[key]; } } },
      runtime: { onMessage: { addListener(fn) { listeners.message = fn; } } },
      tabs: { async create(data) { calls.push(data); return { id: 1 }; }, async update(id, data) { calls.push({ id, ...data }); },
        async sendMessage(id, message) { calls.push({ id, ...message }); return { success: true }; }, onRemoved: { addListener(fn) { listeners.removed = fn; } } } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ status: url.endsWith("/complete") ? "review" : "waiting_for_capitalone" }) }; },
  });
  vm.runInContext(source("coordinator.js").replace("export function", "function"), context);
  context.registerCapitalOneImporter({ validateRequest(data, sender) {
    if (new URL(sender.url).origin !== data.ledgerOrigin || new URL(sender.url).pathname !== "/import") throw new Error("Untrusted sender");
  }, broadcast: async () => {} });
  return { calls, store, message: (action, data, sender) => new Promise((resolve) => listeners.message({ action, data }, sender, resolve)) };
}
const start = { token: "t".repeat(40), ledgerOrigin: "http://localhost:8000", startDate: "2026-08-20", endDate: "2026-08-21" };
const ledger = { url: "http://localhost:8000/import" };
const bankSender = { tab: { id: 1 }, frameId: 0, url: "https://myaccounts.capitalone.com/transactions" };

test("Capital One coordinator scopes source tab, frame, nonce and origin; never shares session tokens", async () => {
  const env = coordinator();
  assert.equal((await env.message("ledgerStartCapitalOneImport", start, { url: "https://evil.example/import" })).success, false);
  assert.equal(env.calls.length, 0);
  assert.equal((await env.message("ledgerStartCapitalOneImport", { ...start, secret: "Never store" }, ledger)).success, true);
  assert.doesNotMatch(JSON.stringify(env.store), /Never store/);
  const ready = await env.message("ledgerCapitalOneReady", {}, bankSender);
  assert.equal(ready.success, true);
  assert.equal(ready.token, undefined);
  for (const sender of [{ ...bankSender, tab: { id: 2 } }, { ...bankSender, frameId: 2 }, { ...bankSender, url: "https://evil.example" }]) {
    assert.equal((await env.message("ledgerCapitalOneComplete", { content: csv, nonce: ready.nonce }, sender)).success, false);
  }
  const newer = await env.message("ledgerCapitalOneReady", {}, bankSender);
  assert.equal((await env.message("ledgerCapitalOneComplete", { content: csv, nonce: ready.nonce }, bankSender)).success, false);
  assert.equal((await env.message("ledgerCapitalOneComplete", { content: csv, nonce: newer.nonce }, bankSender)).success, true);
  assert.equal(env.calls.filter((call) => call.url?.endsWith("/complete")).length, 1);
  assert.equal(env.calls.some((call) => call.url?.endsWith("/commit")), false);
  assert.equal(Object.keys(env.store).length, 0);
});

test("Capital One cancellation rejects unrelated origins and late exports", async () => {
  const env = coordinator();
  await env.message("ledgerStartCapitalOneImport", start, ledger);
  const ready = await env.message("ledgerCapitalOneReady", {}, bankSender);
  assert.equal((await env.message("ledgerCancelCapitalOneImport", start, { url: "https://evil.example/import" })).success, false);
  assert.equal((await env.message("ledgerCancelCapitalOneImport", start, ledger)).success, true);
  assert.equal((await env.message("ledgerCapitalOneComplete", { nonce: ready.nonce, content: csv }, bankSender)).success, false);
  assert.equal(Object.keys(env.store).length, 0);
  assert.equal(env.calls.some((call) => call.url?.endsWith("/complete")), false);
});

test("Capital One manifest adds only the two banking origins and retains existing collectors", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const entries = manifest.content_scripts.filter((entry) => entry.js.some((file) => file.startsWith("capitalone_extension/")));
  assert.equal(entries.length, 2);
  assert.equal(entries.filter((entry) => entry.world === "MAIN").length, 1);
  for (const entry of entries) assert.deepEqual(entry.matches, ["https://verified.capitalone.com/*", "https://myaccounts.capitalone.com/*"]);
  assert.ok(!manifest.host_permissions.includes("https://*.capitalone.com/*"));
  for (const source of ["walmart", "apple_card", "creditkarma", "amazon"]) assert.ok(manifest.content_scripts.some((entry) => entry.js.includes(`${source}_extension/content.js`)));
});

async function exportFormFixture({ unfamiliar = false, wrongDates = false } = {}) {
  const messages = [], controls = [], timeouts = [], listeners = {};
  class Input {
    constructor(name) { this.type = "date"; this.name = name; this.labels = [{ textContent: name }]; this.validity = { valid: true }; this._value = ""; }
    get value() { return this._value; }
    set value(v) { this._value = wrongDates ? "2026-01-01" : v; }
    getAttribute(name) { return name === "aria-label" ? this.name : null; }
    getBoundingClientRect() { return { width: 100, height: 30 }; }
    dispatchEvent() {}
  }
  const startInput = new Input(unfamiliar ? "Date selector" : "Start date"), endInput = new Input("End date");
  const format = { value: "pdf", options: [{ value: "pdf", text: "PDF" }, { value: "csv", text: "CSV" }],
    get selectedOptions() { return this.options.filter((v) => v.value === this.value); },
    getBoundingClientRect: () => ({ width: 100, height: 30 }), dispatchEvent() {} };
  const button = { innerText: "Download", getAttribute: () => null, getBoundingClientRect: () => ({ width: 100, height: 30 }), click() { controls.push("download"); } };
  const form = { innerText: "Download transactions", getAttribute: () => null, getBoundingClientRect: () => ({ width: 100, height: 100 }),
    querySelectorAll(selector) {
      if (selector === "select") return [format];
      if (selector === 'input[type="radio"]') return [];
      if (selector.startsWith('input[type="date"]')) return [startInput, endInput];
      if (selector.startsWith("button")) return [button];
      return [];
    } };
  const nonce = randomUUID();
  const window = { addEventListener(name, fn) { listeners[name] = fn; }, postMessage(data) { controls.push(data); } };
  const context = vm.createContext({ Date, TextEncoder, window, location: { origin: "https://myaccounts.capitalone.com" },
    document: { querySelectorAll(selector) { return selector.includes("dialog") ? [form] : []; } },
    getComputedStyle: () => ({ visibility: "visible" }), HTMLInputElement: Input, Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn) { timeouts.push(fn); return timeouts.length; }, clearTimeout() {},
    chrome: { runtime: { onMessage: { addListener(fn) { listeners.runtime = fn; } }, async sendMessage(message) {
      messages.push(message);
      return message.action === "ledgerCapitalOneReady" ? { success: true, nonce, startDate: "2026-08-20", endDate: "2026-08-21" } : { success: true };
    } } },
  });
  vm.runInContext(source("csv.js") + source("content.js"), context); await flush();
  return { messages, controls, timeouts, listeners, window, nonce, startInput, endInput, format };
}

test("recognizable Capital One export form sets both dates and CSV before clicking only once", async () => {
  const env = await exportFormFixture();
  assert.equal(env.startInput.value, "2026-08-20"); assert.equal(env.endInput.value, "2026-08-21");
  assert.equal(env.format.value, "csv");
  assert.equal(env.controls.includes("download"), false, "Wait for the bank to accept date changes");
  await env.timeouts.shift()();
  assert.equal(env.controls.filter((v) => v === "download").length, 1);
  await env.timeouts.shift()();
  assert.equal(env.controls.filter((v) => v === "download").length, 1);
  await env.listeners.message({ source: env.window, origin: "https://myaccounts.capitalone.com",
    data: { source: "ledger-capitalone-csv", nonce: env.nonce, content: csv } });
  const completed = env.messages.find((m) => m.action === "ledgerCapitalOneComplete");
  assert.ok(completed);
  assert.doesNotMatch(completed.data.content, /9999|Card No/);
  assert.equal(completed.data.token, undefined);
});

test("unknown or rejected date controls never auto-submit, but allow manual CSV capture", async () => {
  for (const options of [{ unfamiliar: true }, { wrongDates: true }]) {
    const env = await exportFormFixture(options);
    await env.timeouts.shift()();
    assert.equal(env.controls.includes("download"), false);
    assert.match(env.messages.find((m) => m.action === "ledgerCapitalOneProgress").data.message, /unfamiliar|did not accept/);
    await env.listeners.message({ source: env.window, origin: "https://myaccounts.capitalone.com",
      data: { source: "ledger-capitalone-csv", nonce: env.nonce, content: csv } });
    assert.ok(env.messages.find((m) => m.action === "ledgerCapitalOneComplete"));
  }
});

test("cancelled Capital One collector ignores matching late CSV and stops automation", async () => {
  const env = await exportFormFixture();
  env.listeners.runtime({ action: "ledgerCancelCapitalOne" }, {}, () => {});
  await env.timeouts.shift()();
  await env.listeners.message({ source: env.window, origin: "https://myaccounts.capitalone.com",
    data: { source: "ledger-capitalone-csv", nonce: env.nonce, content: csv } });
  assert.equal(env.controls.includes("download"), false);
  assert.equal(env.messages.some((m) => m.action === "ledgerCapitalOneComplete"), false);
});
