"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { deflateRawSync } = require("node:zlib");
const root = path.join(__dirname, "../ledger_data_importer_extension");
const read = (file) => fs.readFileSync(path.join(root, "amex_extension", file), "utf8");
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const csv = 'Date,Description,Amount,Address,Reference,Category\r\n08/20/2026,"Shop, test",12.34,Example Street,PRIVATE,Shopping\r\n08/21/2026,Refund,-12.34,,,Shopping';

// Minimal DOM stand-in for our synthetic XML fixture only. Production uses
// the browser's native namespace-aware DOMParser; no XML dependency is added.
class FixtureXml {
  parseFromString(text) {
    const stack = [], top = { children: [], ns: {} };
    stack.push(top);
    for (const part of text.match(/<[^>]+>|[^<]+/g) || []) {
      if (part.startsWith("<?")) continue;
      if (part.startsWith("</")) { stack.pop(); continue; }
      if (part.startsWith("<")) {
        const parent = stack.at(-1), tag = /^<([^\s/>]+)/.exec(part)[1];
        const attrs = Object.fromEntries([...part.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
        const ns = { ...parent.ns };
        for (const [key, value] of Object.entries(attrs)) if (key.startsWith("xmlns")) ns[key.split(":")[1] || ""] = value;
        const split = tag.split(":"), name = split.at(-1), space = ns[split.length === 2 ? split[0] : ""];
        const node = { name, space, ns, children: [], content: "", getAttribute: (key) => attrs[key] ?? null,
          getAttributeNS: (uri, local) => Object.entries(attrs).find(([key]) => key.includes(":") && ns[key.split(":")[0]] === uri && key.split(":")[1] === local)?.[1] || null,
          getElementsByTagNameNS(uri, local) { return this.children.flatMap((n) => [...(n.name === local && n.space === uri ? [n] : []), ...n.getElementsByTagNameNS(uri, local)]); },
          get textContent() { return this.content + this.children.map((n) => n.textContent).join(""); },
        };
        parent.children.push(node); if (!part.endsWith("/>")) stack.push(node);
      } else stack.at(-1).content += part;
    }
    top.getElementsByTagNameNS = (uri, name) => top.children.flatMap((n) => [...(n.name === name && n.space === uri ? [n] : []), ...n.getElementsByTagNameNS(uri, name)]);
    top.getElementsByTagName = () => [];
    return top;
  }
}
function reader() {
  const context = vm.createContext({ TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, DataView, Blob, DecompressionStream, DOMParser: FixtureXml });
  vm.runInContext(read("export.js"), context);
  return context.LedgerAmexExport.sanitize;
}
function zip(parts, compress = true) {
  const locals = [], directory = []; let offset = 0;
  for (const [name, value] of Object.entries(parts)) {
    const data = Buffer.from(value), packed = compress ? deflateRawSync(data) : data, nameBytes = Buffer.from(name);
    let crc = -1;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ -1) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compress ? 8 : 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(compress ? 8 : 0, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes); offset += local.length + nameBytes.length + packed.length;
  }
  const tail = Buffer.alloc(22); tail.writeUInt32LE(0x06054b50);
  tail.writeUInt16LE(directory.length / 2, 8); tail.writeUInt16LE(directory.length / 2, 10);
  tail.writeUInt32LE(Buffer.concat(directory).length, 12); tail.writeUInt32LE(offset, 16);
  const buffer = Buffer.concat([...locals, ...directory, tail]);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function parts({ formula = "", date1904 = false, target = "worksheets/sheet2.xml", external = "", header = "Date" } = {}) {
  const str = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  return {
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><workbookPr date1904="${date1904}"/><sheets><sheet name="Summary" r:id="ignore"/><sheet name="Transaction Details" r:id="details"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="details" Target="${target}" ${external}/></Relationships>`,
    "xl/worksheets/sheet1.xml": "PRIVATE COVER NOT READ",
    "xl/sharedStrings.xml": `<sst xmlns="${ns}"><si><t>Shared shop</t></si></sst>`,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns="${ns}"><sheetData><row r="1">${str("A1", "PRIVATE ACCOUNT COVER")}</row>
      <row r="7">${[header, "Description", "Amount", "Address", "Reference", "Category"].map((v, i) => str(String.fromCharCode(65 + i) + "7", v)).join("")}</row>
      <row r="8"><c r="A8"><v>${date1904 ? 0 : 46254}</v></c><c r="B8" t="s"><v>0</v></c><c r="C8">${formula}<v>12.34</v></c>${str("D8", "Example Street")}${str("E8", "PRIVATE REFERENCE")}${str("F8", "Shopping")}</row>
      <row r="9">${str("A9", "08/21/2026")}${str("B9", "Refund")}<c r="C9"><v>-12.34</v></c></row></sheetData></worksheet>`,
  };
}

test("Amex CSV keeps occurrences/signs/categories but strips reference fields and optionally merchant notes", async () => {
  const sanitize = reader();
  const result = await sanitize(csv);
  assert.match(result, /12\.34/); assert.match(result, /-12\.34/); assert.match(result, /Example Street/);
  assert.doesNotMatch(result, /PRIVATE|Reference/i);
  assert.equal(await sanitize(result), result);
  assert.doesNotMatch(await sanitize(csv, { includeMerchantDetails: false }), /Example Street|Address/i);
  for (const invalid of [csv + '\n"unclosed', csv + "\nwrong,columns", csv.replace("Reference", "Date"), "Date,Amount\n", "x".repeat(16 * 1024 * 1024 + 1)]) {
    await assert.rejects(sanitize(invalid));
  }
});

test("Amex XLSX stored/deflated ZIPs retain table only, shared strings, sparse rows and both date systems", async () => {
  const sanitize = reader();
  for (const compress of [false, true]) {
    const result = await sanitize(zip(parts(), compress));
    assert.match(result, /2026-08-20/); assert.match(result, /Shared shop/); assert.match(result, /-12.34/);
    assert.match(result, /Example Street/); assert.doesNotMatch(result, /PRIVATE|REFERENCE|COVER/i);
    assert.match(await sanitize(zip(parts({ date1904: true }), compress)), /1904-01-01/);
    assert.doesNotMatch(await sanitize(zip(parts(), compress), { includeMerchantDetails: false }), /Example Street/);
  }
});

test("Amex workbook boundaries reject external references, formulas, duplicate headers, corrupt and oversized ZIPs", async () => {
  const sanitize = reader();
  for (const options of [{ target: "../../private.xml" }, { target: "https://evil.example/data" },
    { external: 'TargetMode="External"' }, { formula: "<f>1+1</f>" }, { header: "Amount" }]) await assert.rejects(sanitize(zip(parts(options))));
  await assert.rejects(sanitize(zip({ ...parts(), "xl/workbook.xml": '<!DOCTYPE x [<!ENTITY x "bad">]><x/>' })));
  const damaged = zip(parts(), false); new Uint8Array(damaged)[60] ^= 1;
  await assert.rejects(sanitize(damaged));
  await assert.rejects(sanitize(new ArrayBuffer(16 * 1024 * 1024 + 1)));
  await assert.rejects(sanitize(new Uint8Array([80, 75, 3, 4]).buffer));
});

function coordinator(store = {}) {
  const listeners = {}, calls = []; let trusted = true, ledgerUrl = "http://localhost:8000/import";
  const context = vm.createContext({ URL, Date, AbortSignal, TextEncoder, crypto: { randomUUID },
    chrome: { storage: { session: { async get(key) { return { [key]: store[key] }; }, async set(value) { Object.assign(store, value); }, async remove(key) { delete store[key]; } } },
      runtime: { onMessage: { addListener(fn) { listeners.message = fn; } } },
      webRequest: { onBeforeRequest: { addListener(fn, filter, extras) { listeners.request = fn; calls.push({ filter, extras }); } } },
      tabs: { async get() { return { url: ledgerUrl }; }, async create(data) { calls.push(data); return { id: 1 }; },
        async update(id, data) { calls.push({ id, ...data }); }, async sendMessage(id, message, options) { calls.push({ id, ...message, options }); }, onRemoved: { addListener(fn) { listeners.removed = fn; } } } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ status: url.endsWith("/complete") ? "review" : "waiting_for_amex" }) }; },
  });
  vm.runInContext(read("coordinator.js").replace("export function", "function"), context);
  context.registerAmexImporter({ validateRequest(data, sender) {
    if (!trusted || new URL(sender.url).origin !== data.ledgerOrigin || new URL(sender.url).pathname !== "/import") throw new Error("Untrusted sender");
  }, broadcast: async () => {} });
  return { calls, store, revoke() { trusted = false; }, navigate() { ledgerUrl = "https://evil.example/import"; }, removed: listeners.removed,
    request: async (details) => { assert.equal(listeners.request(details), undefined, "Never block or alter the site's download"); await flush(); },
    message: (action, data, sender) => new Promise((resolve) => listeners.message({ action, data }, sender, resolve)) };
}
const start = { token: "t".repeat(40), ledgerOrigin: "http://localhost:8000", startDate: "2026-08-20", endDate: "2026-08-21", includeMerchantDetails: false };
const ledger = { tab: { id: 12 }, frameId: 0, url: "http://localhost:8000/import" };
const bank = { tab: { id: 1 }, frameId: 0, url: "https://global.americanexpress.com/activity", documentId: "doc1" };
const documentURL = "https://global.americanexpress.com/api/servicing/v1/financials/documents?file_format=excel&account_key=SYNTHETIC_PRIVATE&start_date=2026-08-20&end_date=2026-08-21";
const navigation = (changes = {}) => ({ url: documentURL, method: "GET", type: "main_frame", tabId: 1,
  initiator: "https://global.americanexpress.com", timeStamp: Date.now(), ...changes });

test("Amex navigation capture targets only a confirmed owned document, including after worker suspension", async () => {
  const env = coordinator(); await env.message("ledgerStartAmexImport", start, ledger);
  const ready = await env.message("ledgerAmexReady", {}, bank);
  await env.request(navigation()); assert.equal(env.calls.some((c) => c.action === "ledgerAmexDownload"), false);
  assert.equal((await env.message("ledgerAmexArm", { nonce: "stale" }, bank)).success, false);
  assert.equal((await env.message("ledgerAmexArm", { nonce: ready.nonce }, { ...bank, frameId: 1 })).success, false);
  await env.message("ledgerAmexArm", { nonce: ready.nonce }, bank);
  const resumed = coordinator(env.store);
  for (const type of ["main_frame", "sub_frame"]) await resumed.request(navigation({ type }));
  const downloads = resumed.calls.filter((c) => c.action === "ledgerAmexDownload");
  assert.equal(downloads.length, 2);
  for (const item of downloads) {
    assert.equal(item.id, bank.tab.id); assert.equal(item.options.documentId, bank.documentId);
    assert.equal(item.nonce, ready.nonce); assert.equal(item.url, documentURL);
  }
  assert.doesNotMatch(JSON.stringify(env.store), /SYNTHETIC_PRIVATE|account_key|financials/);
  assert.doesNotMatch(JSON.stringify(resumed.calls.filter((c) => c.body)), /SYNTHETIC_PRIVATE|account_key/);
  const registration = resumed.calls.find((c) => c.filter);
  assert.equal(registration.extras, undefined, "No headers, request bodies or blocking permission");
  assert.deepEqual(Array.from(registration.filter.types), ["main_frame", "sub_frame"]);
  assert.deepEqual(Array.from(registration.filter.urls), ["https://global.americanexpress.com/api/servicing/v1/financials/documents*"]);
});

test("Amex navigation capture ignores unrelated tabs, stale requests, POSTs, other formats and URL lookalikes", async () => {
  const env = coordinator(); await env.message("ledgerStartAmexImport", start, ledger);
  const ready = await env.message("ledgerAmexReady", {}, bank);
  await env.message("ledgerAmexArm", { nonce: ready.nonce }, bank);
  for (const changed of [{ tabId: 2 }, { tabId: -1 }, { method: "POST" }, { type: "xmlhttprequest" },
    { initiator: "https://evil.example" }, { initiator: undefined }, { timeStamp: 0 },
    ...[documentURL.replace("file_format=excel", "file_format=pdf"), documentURL + "&file_format=csv",
      documentURL.replace("/documents?", "/documents/other?"), documentURL.replace("/documents?", "/make-payment?"),
      documentURL.replace("https://", "http://"), documentURL.replace("https://", "https://user:secret@"),
      documentURL.replace("global.americanexpress.com", "global.americanexpress.com.evil.example"), documentURL + "#fragment"].map((url) => ({ url }))]) {
    await env.request(navigation(changed));
  }
  assert.equal(env.calls.some((c) => c.action === "ledgerAmexDownload"), false);
});

test("Amex navigation capture stops on cancellation, disarm, new document, trust removal, tab close or expiry", async () => {
  for (const action of ["cancel", "disarm", "document", "revoke", "navigate", "close", "expire"]) {
    const env = coordinator(); await env.message("ledgerStartAmexImport", start, ledger);
    const ready = await env.message("ledgerAmexReady", {}, bank);
    await env.message("ledgerAmexArm", { nonce: ready.nonce }, bank);
    if (action === "cancel") await env.message("ledgerCancelAmexImport", start, ledger);
    else if (action === "disarm") await env.message("ledgerAmexDisarm", { nonce: ready.nonce }, bank);
    else if (action === "document") await env.message("ledgerAmexReady", {}, { ...bank, documentId: "new-doc" });
    else if (action === "close") await env.removed(bank.tab.id);
    else if (action === "expire") env.store.ledgerAmexPendingImport.createdAt = 0;
    else env[action]();
    await env.request(navigation());
    assert.equal(env.calls.some((c) => c.action === "ledgerAmexDownload"), false, action);
  }
});

test("Amex worker enforces owned tab/frame/origin/document/nonce and stages exactly once across suspension", async () => {
  const env = coordinator();
  assert.equal((await env.message("ledgerStartAmexImport", start, { ...ledger, url: "https://evil.example/import" })).success, false);
  await env.message("ledgerStartAmexImport", { ...start, secret: "NEVER STORE" }, ledger);
  assert.doesNotMatch(JSON.stringify(env.store), /NEVER STORE/);
  const ready = await env.message("ledgerAmexReady", {}, bank);
  assert.equal(ready.token, undefined); assert.equal(ready.includeMerchantDetails, false);
  assert.equal(env.calls.find((c) => c.url?.startsWith("https://global"))?.url, "https://global.americanexpress.com/activity?days=30&inav=myca_statements");
  const resumed = coordinator(env.store);
  for (const wrong of [{ ...bank, tab: { id: 2 } }, { ...bank, frameId: 1 }, { ...bank, url: "https://evil.example" }, { ...bank, documentId: "doc2" }]) {
    assert.equal((await resumed.message("ledgerAmexComplete", { content: csv, nonce: ready.nonce }, wrong)).success, false);
  }
  const newer = await resumed.message("ledgerAmexReady", {}, bank);
  assert.equal((await resumed.message("ledgerAmexComplete", { content: csv, nonce: ready.nonce }, bank)).success, false);
  assert.equal((await resumed.message("ledgerAmexComplete", { content: csv, nonce: newer.nonce }, bank)).success, true);
  assert.equal((await resumed.message("ledgerAmexComplete", { content: csv, nonce: newer.nonce }, bank)).success, false);
  assert.equal(resumed.calls.filter((c) => c.url?.endsWith("/complete")).length, 1);
  assert.equal(resumed.calls.some((c) => c.url?.endsWith("/commit")), false);
  assert.equal(Object.keys(env.store).length, 0);
});

test("Amex cancel, closed source, trust removal and Ledger navigation reject late exports", async () => {
  for (const action of ["cancel", "close", "revoke", "navigate"]) {
    const env = coordinator(); await env.message("ledgerStartAmexImport", start, ledger);
    const ready = await env.message("ledgerAmexReady", {}, bank);
    if (action === "cancel") {
      assert.equal((await env.message("ledgerCancelAmexImport", start, { ...ledger, tab: { id: 13 } })).success, false);
      await env.message("ledgerCancelAmexImport", start, ledger);
    } else if (action === "close") await env.removed(1);
    else env[action]();
    assert.equal((await env.message("ledgerAmexComplete", { content: csv, nonce: ready.nonce }, bank)).success, false);
    assert.equal(env.calls.some((c) => c.url?.endsWith("/complete")), false);
    assert.equal(Object.keys(env.store).length, 0);
  }
});

test("Amex MAIN capture is opt-in, supports XLSX Blob and CSV fetch, and suppresses stale capture", async () => {
  const listeners = {}, messages = [];
  class FakeURL extends URL { static createObjectURL() { return "blob:synthetic"; } }
  class XHR { send() {} }
  class Anchor { click() {} dispatchEvent() {} }
  const window = { addEventListener(name, fn) { listeners[name] = fn; }, postMessage(data) { messages.push(data); },
    fetch: () => Promise.resolve(new Response(csv, { headers: { "content-type": "text/csv" } })) };
  vm.runInContext(read("capture.js"), vm.createContext({ window, location: { origin: "https://global.americanexpress.com" },
    URL: FakeURL, XMLHttpRequest: XHR, HTMLAnchorElement: Anchor, document: { addEventListener() {} }, Blob, Uint8Array, TextDecoder }));
  const exports = () => messages.filter((m) => m.source === "ledger-amex-export");
  const nonce = randomUUID();
  const control = (action, source = window) => listeners.message({ source, origin: "https://global.americanexpress.com", data: { source: "ledger-amex-control", action, nonce } });
  FakeURL.createObjectURL(new Blob([csv])); await flush(); assert.equal(messages.length, 0);
  control("arm", {}); FakeURL.createObjectURL(new Blob([csv])); await flush(); assert.equal(messages.length, 0);
  control("arm"); FakeURL.createObjectURL(new Blob([zip(parts())])); await flush();
  assert.equal(exports().length, 1); assert.equal(exports()[0].nonce, nonce);
  assert.equal(messages.some((m) => m.state === "armed"), true);
  const normalized = await reader()(exports()[0].content); assert.doesNotMatch(normalized, /PRIVATE/);
  assert.equal(await (await window.fetch("/export")).text(), csv); await flush(); assert.equal(exports().length, 2);
  FakeURL.createObjectURL(new Blob([csv])); control("stop"); await flush(); assert.equal(exports().length, 2);
});

test("Amex manifest separates execution worlds, exact host, and parser before controller", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const entries = manifest.content_scripts.filter((s) => s.js.some((f) => f.startsWith("amex_extension/")));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((s) => s.world), ["MAIN", "ISOLATED"]);
  assert.deepEqual(entries[1].js, ["amex_extension/export.js", "amex_extension/content.js"]);
  for (const entry of entries) assert.deepEqual(entry.matches, ["https://global.americanexpress.com/*"]);
  assert.ok(manifest.host_permissions.includes("https://global.americanexpress.com/*"));
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.equal(manifest.permissions.includes("webRequestBlocking"), false);
  assert.ok(manifest.version.localeCompare("0.12.2", undefined, { numeric: true }) >= 0);
});

function linkCapture({ response } = {}) {
  const listeners = {}, messages = [], requests = [], clicks = [];
  const origin = "https://global.americanexpress.com";
  class FakeURL extends URL { static createObjectURL() { return `blob:${origin}/synthetic`; } }
  class XHR { send() {} }
  class Anchor {
    constructor(href, name = "activity.csv") { this.tagName = "A"; this.href = href; this.name = name; }
    getAttribute() { return this.name; } hasAttribute() { return this.name !== null; }
    click() { clicks.push("click"); }
    dispatchEvent(event) { clicks.push(event.type); return true; }
  }
  const opened = [], nativeWindow = {};
  const window = { open(...args) { opened.push(args); return nativeWindow; }, addEventListener(name, fn) { listeners[name] = fn; }, postMessage(data) { messages.push(data); },
    fetch: (url, options) => { requests.push({ url, options }); return response ? response(url, options) : Promise.resolve(new Response(csv)); } };
  vm.runInContext(read("capture.js"), vm.createContext({ window, location: { origin, href: origin + "/activity" },
    URL: FakeURL, XMLHttpRequest: XHR, HTMLAnchorElement: Anchor, document: { addEventListener(name, fn) { listeners[name] = fn; } },
    Blob, Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout, atob }));
  const nonce = randomUUID();
  return { requests, messages, clicks, opened, nativeWindow, open: (...args) => window.open(...args), anchor: (href, name) => new Anchor(href, name),
    control: (action, details = {}) => listeners.message({ source: window, origin, data: { source: "ledger-amex-control", action, nonce, ...details } }),
    exports: () => messages.filter((m) => m.source === "ledger-amex-export"),
    userClick: (anchor) => listeners.click({ composedPath: () => [anchor], target: anchor }),
  };
}

test("Amex link capture covers detached data/old blob anchors and direct same-origin file links without changing the download", async () => {
  for (const href of ["data:text/csv;base64," + Buffer.from(csv).toString("base64"),
      "data:application/octet-stream," + encodeURIComponent(csv),
      "blob:https://global.americanexpress.com/pre-created", "https://global.americanexpress.com/download/activity.csv"]) {
    for (const method of ["click", "dispatchEvent", "userClick"]) {
      const env = linkCapture(), anchor = env.anchor(href);
      anchor.click(); await flush(); assert.equal(env.requests.length, 0, "Never fetch without card confirmation");
      env.control("arm");
      if (method === "click") anchor.click();
      if (method === "dispatchEvent") assert.equal(anchor.dispatchEvent({ type: "click" }), true);
      if (method === "userClick") env.userClick(anchor);
      await flush();
      assert.equal(env.exports().length, 1, `${method}: ${href.slice(0, 35)}`);
      if (href.startsWith("data:")) assert.equal(env.requests.length, 0, "Embedded exports decode directly, without CSP-blocked fetches");
      else {
        assert.equal(env.requests[0].options.credentials, "same-origin");
        assert.equal(env.requests[0].options.redirect, "error");
        assert.equal(env.requests[0].options.method, undefined, "Never replay a form POST");
      }
      const progress = env.messages.filter((m) => m.source === "ledger-amex-capture-status");
      assert.doesNotMatch(JSON.stringify(progress), /PRIVATE|activity\.csv|global\.americanexpress|Shop/);
      env.control("stop"); anchor.click(); await flush(); assert.equal(env.exports().length, 1);
    }
  }
});

test("Amex link capture rejects other origins, local files, credential URLs and non-export actions", async () => {
  const env = linkCapture(); env.control("arm");
  for (const href of ["https://evil.example/activity.csv", "http://global.americanexpress.com/activity.csv", "file:///C:/private.csv",
    "javascript:alert(1)", "https://user:secret@global.americanexpress.com/activity.csv", "blob:https://evil.example/id"]) {
    env.anchor(href).click();
  }
  env.anchor("https://global.americanexpress.com/make-payment", null).click();
  await flush(); assert.equal(env.requests.length, 0);
  env.control("stop");
});

test("Amex extensionless force-download exports capture via anchor, new window and navigation relay", async () => {
  for (const format of ["csv", "excel", "xlsx"]) for (const method of ["anchor", "window", "navigation"]) {
    const bytes = format === "csv" ? csv : zip(parts());
    const env = linkCapture({ response: () => Promise.resolve(new Response(bytes, { headers: { "content-type": "application/force-download" } })) });
    const href = documentURL.replace("file_format=excel", `file_format=${format}`);
    assert.equal(env.open(href, "_blank", "noopener"), env.nativeWindow); await flush();
    assert.equal(env.requests.length, 0, "No background reading before confirmation");
    env.control("arm");
    if (method === "anchor") env.anchor(href, null).click();
    if (method === "window") {
      assert.equal(env.open(href, "_blank", "noopener"), env.nativeWindow);
      assert.deepEqual(env.opened.at(-1), [href, "_blank", "noopener"]);
    }
    if (method === "navigation") env.control("download", { url: href });
    // Page hook and browser navigation can observe the same download together.
    env.control("download", { url: href });
    await flush();
    assert.equal(env.requests.length, 1); assert.equal(env.requests[0].url, href);
    assert.equal(env.requests[0].options.redirect, "error"); assert.equal(env.requests[0].options.credentials, "same-origin");
    assert.equal(env.exports().length, 1, `${format}: ${method}`);
    assert.match(await reader()(env.exports()[0].content), /12\.34/);
    const status = env.messages.filter((m) => m.source === "ledger-amex-capture-status");
    assert.equal(status.some((m) => m.method === "document-link"), true);
    assert.doesNotMatch(JSON.stringify(status), /SYNTHETIC_PRIVATE|account_key|financials|Shop/);
    env.control("stop");
  }
});

test("Amex navigation reader rejects unsafe routes and stops pending downloads on cancellation", async () => {
  let release;
  const env = linkCapture({ response: () => new Promise((resolve) => { release = resolve; }) });
  env.control("arm");
  for (const url of [documentURL.replace("file_format=excel", "file_format=pdf"), documentURL + "&file_format=csv",
    documentURL.replace("global.americanexpress.com", "evil.example"), documentURL.replace("https://", "https://user:secret@"),
    documentURL.replace("/documents?", "/documents/other?"), "file:///private.csv", documentURL + "#fragment"]) {
    env.open(url); env.control("download", { url });
  }
  env.control("download", { url: documentURL, nonce: "stale" });
  assert.equal(env.requests.length, 0);
  env.control("download", { url: documentURL });
  assert.equal(env.requests.length, 1);
  env.control("stop"); assert.equal(env.requests[0].options.signal.aborted, true);
  release(new Response(csv)); await flush(); assert.equal(env.exports().length, 0);
});

test("Amex direct downloads reject oversized, empty and non-export responses without exposing response details", async () => {
  let cancelled = false;
  const oversized = linkCapture({ response: async () => ({ ok: true, body: { getReader: () => ({
    async read() { return { value: new Uint8Array(16 * 1024 * 1024 + 1), done: false }; },
    async cancel() { cancelled = true; }, releaseLock() {},
  }) } }) });
  oversized.control("arm"); oversized.control("download", { url: documentURL }); await flush();
  assert.equal(cancelled, true); assert.equal(oversized.exports().length, 0);
  assert.equal(oversized.messages.some((m) => m.state === "too-large"), true);
  oversized.control("stop");
  for (const response of [() => new Response(null), () => new Response("<html>PRIVATE account error</html>"),
    () => new Response("PRIVATE error", { status: 403 }), () => Promise.reject(new Error("PRIVATE redirect URL"))]) {
    const env = linkCapture({ response: async () => response() }); env.control("arm");
    env.control("download", { url: documentURL }); await flush();
    assert.equal(env.exports().length, 0); assert.equal(env.messages.some((m) => m.state === "read-error"), true);
    assert.doesNotMatch(JSON.stringify(env.messages), /PRIVATE|account_key|financials/); env.control("stop");
  }
});

test("Amex link capture cancels delayed reads and reports unreadable exports without leaking response details", async () => {
  let release;
  const env = linkCapture({ response: () => new Promise((resolve) => { release = resolve; }) }); env.control("arm");
  const anchor = env.anchor("https://global.americanexpress.com/activity.csv"); anchor.click(); env.userClick(anchor);
  assert.equal(env.requests.length, 1, "Programmatic and bubbling click share the same capture");
  env.control("stop");
  assert.equal(env.requests[0].options.signal.aborted, true);
  release(new Response(csv)); await flush(); assert.equal(env.exports().length, 0);
  const bad = linkCapture({ response: () => Promise.reject(new Error("SECRET URL")) }); bad.control("arm");
  bad.anchor("https://global.americanexpress.com/activity.csv").click(); await flush();
  assert.equal(bad.messages.some((m) => m.state === "read-error"), true);
  assert.doesNotMatch(JSON.stringify(bad.messages), /SECRET URL/);
  bad.control("stop");
});

async function contentEnvironment({ ready, parse, arm } = {}) {
  const listeners = {}, sent = [], pageMessages = [], created = [], timers = [];
  const element = (tag) => {
    const el = { tag, children: [], handlers: {}, style: {}, textContent: "", hidden: false,
      setAttribute() {}, append(...children) { this.children.push(...children); }, remove() { this.removed = true; },
      attachShadow() { return element("shadow"); }, addEventListener(name, handler) { this.handlers[name] = handler; } };
    created.push(el); return el;
  };
  const window = { addEventListener(name, fn) { listeners[name] = fn; }, postMessage(value) { pageMessages.push(value); } };
  const context = vm.createContext({ window, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, DataView, Blob, DecompressionStream,
    location: { origin: "https://global.americanexpress.com", pathname: "/activity" },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    document: { body: element("body"), createElement: element, querySelectorAll: () => [] },
    chrome: { runtime: { onMessage: { addListener(fn) { listeners.cancel = fn; } }, async sendMessage(message) {
      sent.push(message);
      if (message.action === "ledgerAmexReady") return ready || { success: true, nonce: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", startDate: "2026-08-20", endDate: "2026-08-21", includeMerchantDetails: false };
      if (message.action === "ledgerAmexArm") return arm || { success: true };
      return { success: true };
    } } },
  });
  // Load the actual manifest's isolated entrypoints in order (not helper
  // functions injected into the wrong execution world).
  vm.runInContext(read("export.js"), context);
  if (parse) context.LedgerAmexExport = { sanitize: parse };
  vm.runInContext(read("content.js"), context);
  await flush();
  return { sent, pageMessages, created, timers,
    confirm() { return created.find((n) => n.textContent === "Use this card").handlers.click(); },
    cancel() { listeners.cancel({ action: "ledgerCancelAmex" }, {}, () => {}); },
    download(url, nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
      let response; listeners.cancel({ action: "ledgerAmexDownload", url, nonce }, {}, (result) => { response = result; }); return response;
    },
    status(state, method = "", nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
      return listeners.message({ source: window, origin: "https://global.americanexpress.com", data: { source: "ledger-amex-capture-status", nonce, state, method } });
    },
    capture(nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", source = window) {
      return listeners.message({ source, origin: "https://global.americanexpress.com", data: { source: "ledger-amex-export", nonce, content: csv } });
    },
  };
}

test("Amex isolated controller requires card confirmation and redacts before relay without committing", async () => {
  const env = await contentEnvironment();
  assert.equal(env.pageMessages.length, 0, "Not armed until the user checks the card");
  await env.capture(); assert.equal(env.sent.some((m) => m.action === "ledgerAmexComplete"), false);
  await env.confirm(); assert.equal(env.pageMessages[0].action, "arm");
  await env.status("armed");
  assert.equal(env.created.some((n) => n.textContent.includes("Listening for an Amex")), true);
  await env.capture("wrong"); await env.capture(undefined, {});
  assert.equal(env.sent.some((m) => m.action === "ledgerAmexComplete"), false);
  await env.capture(); await env.capture();
  const completed = env.sent.filter((m) => m.action === "ledgerAmexComplete");
  assert.equal(completed.length, 1); assert.doesNotMatch(completed[0].data.content, /PRIVATE|Reference|Example Street|Address/i);
  assert.equal(env.pageMessages.at(-1).action, "stop");
});

test("Amex capture diagnostics accept only known stages/methods and never arbitrary page data", async () => {
  const env = await contentEnvironment(); await env.confirm();
  const status = env.created.find((n) => n.className === "status");
  assert.equal(status.textContent, "Connecting to the download listener…");
  await env.status("armed", "", "wrong"); assert.match(status.textContent, /Connecting/);
  await env.status("private account text", "SECRET"); assert.match(status.textContent, /Connecting/);
  await env.status("armed"); await env.status("download-seen", "data-link");
  await env.status("reading", "https://example.invalid/secret");
  const diagnostics = env.created.find((n) => n.textContent.startsWith("Amex capture 0.12.2"));
  assert.match(diagnostics.textContent, /data-link/);
  assert.doesNotMatch(diagnostics.textContent, /SECRET|example.invalid|secret/);
});

test("Amex isolated controller ignores cancellation during asynchronous export parsing or ready handshake", async () => {
  let finish; const parsing = new Promise((resolve) => { finish = resolve; });
  const env = await contentEnvironment({ parse: () => parsing }); await env.confirm();
  const capturing = env.capture(); env.cancel(); finish(csv); await capturing;
  assert.equal(env.sent.some((m) => m.action === "ledgerAmexComplete"), false);
  let ready; const pending = new Promise((resolve) => { ready = resolve; });
  const waiting = await contentEnvironment({ ready: pending }); waiting.cancel();
  ready({ success: true, nonce: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }); await flush();
  assert.equal(waiting.created.some((n) => n.textContent === "Use this card"), false);
  assert.equal(waiting.pageMessages.some((m) => m.action === "arm"), false);
});

test("Amex navigation relay requires completed confirmation, the current nonce and an active review job", async () => {
  let arm;
  const env = await contentEnvironment({ arm: new Promise((resolve) => { arm = resolve; }) });
  const confirming = env.confirm();
  assert.equal(env.download(documentURL).success, false);
  assert.equal(env.pageMessages.length, 0, "Do not arm MAIN before the worker can observe navigation");
  arm({ success: true }); await confirming;
  assert.equal(env.download(documentURL, "stale").success, false);
  assert.equal(env.download(documentURL).success, true);
  assert.equal(env.pageMessages.at(-1).action, "download");
  assert.equal(env.pageMessages.at(-1).url, documentURL);
  assert.doesNotMatch(JSON.stringify(env.sent), /SYNTHETIC_PRIVATE|account_key/);
  await env.status("download-seen", "document-link");
  assert.equal(env.created.some((n) => n.textContent.includes("document-link")), true);
  env.cancel(); assert.equal(env.download(documentURL).success, false);
  const failure = await contentEnvironment({ arm: { success: false } }); await failure.confirm();
  assert.equal(failure.pageMessages.length, 0);
  assert.equal(failure.created.some((n) => n.textContent.includes("approve its permissions")), true);
  let resolveArm;
  const cancelled = await contentEnvironment({ arm: new Promise((resolve) => { resolveArm = resolve; }) });
  const pending = cancelled.confirm(); cancelled.cancel(); resolveArm({ success: true }); await pending;
  assert.equal(cancelled.pageMessages.some((m) => m.action === "arm"), false);
});
