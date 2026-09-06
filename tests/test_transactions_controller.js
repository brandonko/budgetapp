"use strict";

// Small DOM double for browser-independent behavior checks. The controller, shared
// transaction UI, and financial query model all run unmodified against synthetic data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const APP = path.join(__dirname, "../app");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.parentElement = null; this.childNodes = []; this.attributes = {}; this.listeners = {};
    this.dataset = new Proxy({}, { set: (target, name, value) => {
      target[name] = String(value);
      this.attributes[`data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`] = String(value);
      return true;
    } });
    this.style = {}; this.hidden = false; this.disabled = false;
    this.checked = false; this.open = false; this._value = ""; this.validityMessage = "";
    this.classList = {
      add: (...items) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...items])].join(" "); },
      toggle: (item, force) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = force === undefined ? !current.has(item) : force;
        if (add) current.add(item); else current.delete(item);
        this.className = [...current].join(" "); return add;
      },
      contains: (item) => this.className.split(/\s+/).includes(item),
    };
  }
  get children() { return this.childNodes.filter((child) => child.tagName !== "#TEXT"); }
  get id() { return this.attributes.id || ""; }
  set id(value) { this.attributes.id = value; }
  get className() { return this.attributes.class || ""; }
  set className(value) { this.attributes.class = value; }
  get name() { return this.attributes.name || ""; }
  set name(value) { this.attributes.name = value; }
  get options() { return this.tagName === "SELECT" ? this.children : []; }
  get type() { return this.attributes.type || (this.tagName === "INPUT" ? "text" : ""); }
  set type(value) { this.attributes.type = value; }
  get textContent() { return this._text || this.childNodes.map((child) => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ""); }
  get value() {
    if (this.tagName === "SELECT") {
      return this.children.some((option) => option.value === this._value)
        ? this._value : this.children[0]?.value || "";
    }
    return this._value;
  }
  set value(value) { this._value = String(value ?? ""); }
  get isConnected() { return this === this.ownerDocument || !!this.parentElement?.isConnected; }
  get elements() {
    const values = this.querySelectorAll("input,select,textarea,button");
    values.namedItem = (name) => values.find((element) => element.name === name) || null;
    return values;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "value") this.value = value;
    if (name === "checked") this.checked = true;
    if (name === "hidden") this.hidden = true;
    if (name === "disabled") this.disabled = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) {
    if (this._text) {
      const existingText = this.ownerDocument.createTextNode(this._text);
      existingText.parentElement = this; this.childNodes.push(existingText);
    }
    this._text = "";
    for (let child of children) {
      if (!(child instanceof Element)) child = this.ownerDocument.createTextNode(String(child));
      child.remove(); child.parentElement = this; this.childNodes.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = []; this._text = ""; this.append(...children);
  }
  remove() {
    if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this);
    this.parentElement = null;
  }
  insertBefore(child, before) {
    child.remove(); child.parentElement = this;
    const index = this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child);
  }
  before(child) { this.parentElement.insertBefore(child, this); }
  contains(element) { return element === this || this.childNodes.some((child) => child.contains(element)); }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return attribute[2] === undefined ? attribute[1] in this.attributes : this.getAttribute(attribute[1]) === attribute[2];
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    return this.children.flatMap((child) => [
      ...(selectors.some((item) => child.matches(item)) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  dispatch(name, values = {}) {
    if (this.disabled && name === "click") return;
    const eventPath = [];
    for (let current = this; current; current = current.parentElement) eventPath.push(current);
    const event = { type: name, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, composedPath: () => eventPath, ...values };
    for (const current of eventPath) {
      event.currentTarget = current;
      for (const listener of current.listeners[name] || []) listener(event);
      if (values.bubbles === false || event.stopped) break;
    }
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  select() {}
  click() { this.focus(); return this.dispatch("click"); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, right: 600, top: 0, bottom: 600 }; }
  setCustomValidity(message) { this.validityMessage = message; }
  reportValidity() { return !this.validityMessage && this.elements.every((element) => !element.validityMessage); }
  reset() {
    for (const element of this.elements) {
      element.value = element.getAttribute("value") || "";
      element.checked = element.getAttribute("checked") !== null;
    }
    this.dispatch("reset");
  }
}

class Input extends Element {}
class Select extends Element {}
class Document extends Element {
  constructor() { super("#document"); this.ownerDocument = this; this.activeElement = null; }
  createElement(tag) { return new (tag === "input" ? Input : tag === "select" ? Select : Element)(tag, this); }
  createTextNode(text) { const element = new Element("#text", this); element._text = text; return element; }
  getElementById(id) { return this.querySelector(`#${id}`); }
  get body() { return this.querySelector("body"); }
}

function parseDocument(html) {
  const document = new Document(); const stack = [document];
  const voidTags = new Set(["meta", "link", "input", "br", "hr", "img", "path"]);
  for (const token of html.match(/<!--[^]*?-->|<[^>]+>|[^<]+/g) || []) {
    if (/^<!/.test(token)) continue;
    if (token.startsWith("</")) {
      const tag = token.match(/^<\/([^\s>]+)/)?.[1].toUpperCase();
      while (stack.length > 1) if (stack.pop().tagName === tag) break;
    } else if (token.startsWith("<")) {
      const tag = token.match(/^<([^\s/>]+)/)?.[1];
      if (!tag) continue;
      const element = document.createElement(tag);
      const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, "");
      for (const match of attrs.matchAll(/([^\s=]+)(?:\s*=\s*"([^"]*)")?/g)) element.setAttribute(match[1], match[2] ?? "");
      stack.at(-1).append(element);
      if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(element);
    } else if (token.trim()) {
      stack.at(-1).append(document.createTextNode(token.replaceAll("&amp;", "&").trim()));
    }
  }
  return document;
}

function tx(overrides = {}) {
  return { _id: 1, date: "2024-05-12", description: "Bike purchase", amount: 50,
    category: "Shopping", subcategory: "Bike", accountName: "Test card", accountType: "CREDIT",
    provider: "Test bank", notes: "Initial note", tags: "bike", group: "", flags: "",
    createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

async function start(rows, { stored = null, mutationStatus = 200, missingCsv = false } = {}) {
  const document = parseDocument(read("transactions.html"));
  const requests = []; let currentRows = rows; let currentRevision = "revision-1";
  const storage = new Map(stored ? [["ledger.transactions-view.v1", JSON.stringify(stored)]] : []);
  const localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url === "/api/taxonomy") return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    if (url === "/api/transactions" && missingCsv) return { ok: false, status: 404,
      json: async () => ({ code: "transaction_file_missing", error: "No transaction file yet." }) };
    if (options.method) {
      if (mutationStatus !== 200) return { ok: false, status: mutationStatus, json: async () => ({ error: "The transaction file changed. Refresh before saving." }) };
      const body = JSON.parse(options.body); const id = Number(url.split("/").at(-1));
      currentRows = options.method === "DELETE" ? currentRows.filter((row) => row._id !== id)
        : currentRows.map((row) => row._id === id ? { ...row, ...body.transaction, amount: Number(body.transaction.amount) } : row);
      currentRevision = "revision-2";
    }
    return { ok: true, status: 200, json: async () => ({ transactions: currentRows, revision: currentRevision }) };
  };
  const window = { confirm: () => false };
  const context = { window, document, localStorage, fetch, HTMLInputElement: Input, HTMLSelectElement: Select,
    Option: function Option(text, value) { const option = document.createElement("option"); option.textContent = text; option.value = value; return option; } };
  vm.createContext(context);
  for (const file of ["transaction-ui.js", "transaction-bulk.js", "transactions-model.js", "transactions.js"]) vm.runInContext(read(file), context, { filename: file });
  await flush();
  const el = (id) => document.getElementById(id);
  const field = (name) => el("transaction-form").elements.namedItem(name);
  const writes = () => requests.filter((request) => request.method);
  const edits = () => el("alltime-list").querySelectorAll("button");
  return { document, el, field, writes, edits, requests, window, storage, shared: window.LedgerTransactionUI };
}

test("Edit uses the clicked transaction and shared editor; save includes original revision and preserved fields", async () => {
  const original = tx({ _id: 7, flags: "include-in-budget", tags: "bike, tools" });
  const app = await start([original]);
  app.edits()[0].click();
  assert.equal(app.el("transaction-form-dialog").open, true);
  for (const name of ["date", "description", "amount", "category", "subcategory", "accountName", "accountType", "provider", "notes", "tags"]) {
    assert.equal(app.field(name).value, String(original[name]), name);
  }
  assert.equal(app.field("internalTransferTreatment").value, "include-in-budget");
  app.field("description").value = "Updated bike purchase";
  app.field("notes").value = "Updated note";
  app.el("transaction-form").dispatch("submit");
  await flush();
  assert.equal(app.writes().length, 1);
  assert.equal(app.writes()[0].url, "/api/transactions/7");
  const body = JSON.parse(app.writes()[0].body);
  assert.equal(body.revision, "revision-1");
  assert.equal(body.transaction.description, "Updated bike purchase");
  assert.equal(body.transaction.notes, "Updated note");
  assert.equal(body.transaction.tags, "bike, tools");
  assert.equal(body.transaction.flags, "include-in-budget");
  assert.equal(body.transaction.date, original.date);
  assert.equal(body.transaction.accountName, original.accountName);
  assert.equal(Object.hasOwn(body.transaction, "createdAt"), false);
  assert.equal(app.el("transaction-form-dialog").open, false);
  assert.match(app.el("alltime-list").textContent, /Updated bike purchase/);
});

test("all editor cancellation paths discard drafts without sending a mutation", async () => {
  const app = await start([tx()]);
  const actions = [
    () => app.el("cancel-form-button").click(),
    () => app.el("close-form-dialog").click(),
    () => app.el("transaction-form-dialog").dispatch("cancel"),
    () => app.el("transaction-form-dialog").dispatch("click", { clientX: -10, clientY: -10 }),
  ];
  for (const cancel of actions) {
    app.edits()[0].click(); app.field("notes").value = "Unsaved draft";
    cancel();
    assert.equal(app.el("transaction-form-dialog").open, false);
    assert.equal(app.writes().length, 0);
    assert.match(app.el("alltime-list").textContent, /Initial note/);
  }
});

test("a stale revision leaves the draft open and does not replace loaded results", async () => {
  const app = await start([tx()], { mutationStatus: 409 });
  app.edits()[0].click(); app.field("description").value = "Keep this draft";
  app.el("transaction-form").dispatch("submit"); await flush();
  assert.equal(app.writes().length, 1);
  assert.equal(app.el("transaction-form-dialog").open, true);
  assert.equal(app.field("description").value, "Keep this draft");
  assert.equal(app.el("form-error").hidden, false);
  assert.match(app.el("form-error").textContent, /file changed/);
  assert.match(app.el("alltime-list").textContent, /Bike purchase/);
  assert.equal(app.el("save-transaction-button").disabled, false);
});

test("tag buttons remain open for multi-selection; OR and AND update all totals and preserve unique rows", async () => {
  const rows = [tx({ _id: 1, amount: 20, tags: "bike, tools" }),
    tx({ _id: 2, amount: 80, tags: "bike, apparel" }),
    tx({ _id: 3, amount: 40, tags: "apparel" }),
    tx({ _id: 4, amount: 1000, tags: "bike" })];
  const app = await start(rows);
  app.el("tag-picker").open = true;
  const tagButton = (tag) => app.el("tag-options").children.find((element) => element.textContent === tag);
  tagButton("bike").click();
  assert.equal(app.el("tag-picker").open, true);
  tagButton("apparel").click();
  assert.equal(app.el("tag-picker").open, true);
  assert.equal(app.el("matching-spent").textContent, "$1,140.00");
  assert.equal(app.el("result-count").textContent, "1–4 of 4");
  app.document.querySelector('[data-tag-mode="all"]').click();
  assert.equal(app.el("matching-spent").textContent, "$80.00");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
});

test("pagination displays 50 rows while summaries always cover every matching transaction", async () => {
  const rows = Array.from({ length: 61 }, (_, index) => tx({ _id: index, description: `Purchase ${index}`, amount: 1 }));
  const app = await start(rows);
  assert.equal(app.el("alltime-list").children.length, 50);
  assert.equal(app.el("matching-spent").textContent, "$61.00");
  assert.equal(app.el("page-indicator").textContent, "Page 1 of 2");
  app.el("next-page").click();
  assert.equal(app.el("alltime-list").children.length, 11);
  assert.equal(app.el("matching-spent").textContent, "$61.00");
  assert.equal(app.el("result-count").textContent, "51–61 of 61");
  assert.equal(app.el("next-page").disabled, true);
  app.el("alltime-search").value = "Purchase 60";
  app.el("alltime-search").dispatch("input");
  assert.equal(app.el("matching-spent").textContent, "$1.00");
  assert.equal(app.el("page-indicator").textContent, "Page 1 of 1");
});

test("category and date filters combine; excluded rows remain visible but cannot inflate totals", async () => {
  const rows = [tx({ _id: 1, category: "Travel", amount: 100, date: "2024-05-10" }),
    tx({ _id: 2, category: "Travel", amount: 50, date: "2024-05-12" }),
    tx({ _id: 3, category: "Travel", amount: 25, flags: "refunded" }),
    tx({ _id: 4, category: "Travel", amount: 200, _isInternalTransfer: true }),
    tx({ _id: 5, category: "Income", amount: -1000 }), tx({ _id: 6, amount: 10 })];
  const app = await start(rows);
  app.el("alltime-filter-button").click();
  const form = app.el("alltime-filter-popover"); const field = (name) => form.elements.namedItem(name);
  field("category").value = "Travel";
  field("startDate").value = "2024-05-12"; field("endDate").value = "2024-05-12";
  form.dispatch("submit");
  assert.equal(app.el("result-count").textContent, "1–3 of 3");
  assert.equal(app.el("matching-spent").textContent, "$50.00");
  assert.equal(app.el("matching-income").textContent, "$0.00");
  assert.match(app.el("matching-scope").textContent, /2 refunded or internal transfer/);
  app.el("alltime-filter-button").click(); field("showExcluded").checked = false;
  form.dispatch("submit");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  assert.equal(app.el("matching-spent").textContent, "$50.00");
  app.el("alltime-filter-button").click(); field("startDate").value = "2025-01-01";
  form.dispatch("submit");
  assert.match(field("endDate").validityMessage, /on or after/);
  assert.equal(app.el("matching-spent").textContent, "$50.00");
});

test("delete requires confirmation and clamps an empty final page after removal", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => tx({ _id: index, amount: 1 }));
  const app = await start(rows); app.el("next-page").click(); app.edits()[0].click();
  let confirmation = "";
  app.window.confirm = (message) => { confirmation = message; return false; };
  app.el("delete-transaction-button").click(); await flush();
  assert.match(confirmation, /Permanently delete/); assert.equal(app.writes().length, 0);
  assert.equal(app.el("transaction-form-dialog").open, true);
  app.window.confirm = () => true;
  app.el("delete-transaction-button").click(); await flush();
  assert.equal(app.writes().length, 1); assert.equal(app.writes()[0].method, "DELETE");
  assert.equal(JSON.parse(app.writes()[0].body).revision, "revision-1");
  assert.equal(app.el("transaction-form-dialog").open, false);
  assert.equal(app.el("page-indicator").textContent, "Page 1 of 1");
  assert.equal(app.el("matching-spent").textContent, "$50.00");
});

test("saved filters restore and stay applied after an edit that removes a matching tag", async () => {
  const app = await start([tx(), tx({ _id: 2, tags: "tools" })], {
    stored: { filters: { tags: ["bike"], tagMode: "all", category: "Shopping" }, sort: { field: "cost", direction: "asc" } },
  });
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  app.edits()[0].click();
  const editorBike = app.el("transaction-form").querySelectorAll("[data-tag-option]")
    .find((element) => element.dataset.tagOption === "bike");
  editorBike.click(); app.el("transaction-form").dispatch("submit"); await flush();
  assert.equal(app.el("result-count").textContent, "0 transactions");
  assert.equal(app.el("matching-spent").textContent, "$0.00");
  const saved = JSON.parse(app.storage.get("ledger.transactions-view.v1"));
  assert.deepEqual(saved.filters.tags, ["bike"]);
  assert.equal(saved.filters.category, "Shopping");
  assert.deepEqual(saved.sort, { field: "cost", direction: "asc" });
});

test("a missing CSV offers Import data and does not create or mutate a database", async () => {
  const app = await start([], { missingCsv: true });
  const link = app.el("alltime-list").querySelector("a");
  assert.equal(link.href, "/import");
  assert.match(app.el("alltime-list").textContent, /No transactions yet/);
  assert.equal(app.el("matching-spent").textContent, "$0.00");
  assert.equal(app.writes().length, 0);
  assert.equal(app.el("refresh-transactions").disabled, false);
});

test("the all-time list shows each row's year without changing the shared default", async () => {
  const original = tx({ date: "2022-07-12" });
  const app = await start([original]);
  const date = app.el("alltime-list").querySelector("time");
  assert.equal(date.querySelector("small").textContent, "2022");
  assert.equal(date.dateTime, "2022-07-12");
  const defaultRow = app.shared.createTransactionRow(original, {
    currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    shortMonthFormatter: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }),
    onEdit: () => {},
  });
  assert.equal(defaultRow.querySelector("time").querySelector("small"), null);
});

const textButton = (root, text) => root.querySelectorAll("button").find((button) => button.textContent === text);

test("group picker searches, reuses case-insensitive names, creates explicitly and clears", async () => {
  const app = await start([tx({ group: "Canyon Aeroad" }), tx({ _id: 2, group: "canyon aeroad" })]);
  app.edits()[0].click();
  const root = app.el("transaction-form").querySelector("[data-transaction-group-picker]");
  const input = root.querySelector("input");
  assert.equal(input.value, "Canyon Aeroad");
  input.value = "canyon"; input.dispatch("input");
  assert.equal(root.querySelectorAll('[role="option"]').filter((item) => item.textContent === "Canyon Aeroad").length, 1);
  input.value = "canyon aeroad"; input.dispatch("input");
  assert.equal(root.querySelectorAll("button").some((item) => item.textContent.includes("Create")), false);
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(app.field("group").value, "Canyon Aeroad");
  input.value = "Weekend   trip"; input.dispatch("input");
  assert.equal(app.field("group").value, "Canyon Aeroad", "typing does not change the stored selection");
  textButton(root, "+ Create “Weekend trip”").click();
  assert.equal(app.field("group").value, "Weekend trip");
  input.click(); textButton(root, "No group").click();
  assert.equal(app.field("group").value, "");
  app.el("cancel-form-button").click();
  assert.equal(app.writes().length, 0);
  assert.match(app.el("alltime-list").querySelector(".transaction-group-badge").textContent, /Canyon Aeroad/i);
});

test("group filtering includes ungrouped transactions and updates all-time totals", async () => {
  const app = await start([tx({ group: "LA trip", amount: 80 }), tx({ _id: 2, amount: 20 })]);
  const root = app.document.querySelector(".transaction-group-filter");
  root.querySelector("input").click(); textButton(root, "LA trip").click();
  assert.equal(app.el("matching-spent").textContent, "$80.00");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  root.querySelector("input").click(); textButton(root, "No group").click();
  assert.equal(app.el("matching-spent").textContent, "$20.00");
  root.querySelector("input").click(); textButton(root, "All groups").click();
  assert.equal(app.el("matching-spent").textContent, "$100.00");
});

async function stagedList() {
  const app = await start([]);
  const container = app.document.createElement("div"); app.document.body.append(container);
  let rows = [tx({ _id: 1, tags: "tools", _selected: true }), tx({ _id: 2, tags: "apparel", _selected: false })];
  const bulk = app.window.LedgerTransactionBulk.create({ container, staged: true, importSelection: true,
    getTransactions: () => rows, getAllTransactions: () => rows, getRevision: () => "staged-revision",
    onStage: (ids, proposed) => { const byId = new Map(proposed.map((row) => [row._id, row])); rows = rows.map((row) => byId.get(row._id) || row); },
    render: () => bulk.render(rows, () => ({ currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
      shortMonthFormatter: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }), onEdit: () => {} })),
  });
  bulk.render(rows, () => ({ currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    shortMonthFormatter: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }), onEdit: () => {} }));
  const toolbar = app.document.querySelectorAll(".transaction-bulk-toolbar").at(-1);
  function open() {
    textButton(toolbar, "Edit multiple").click();
    assert.equal(textButton(toolbar, "Edit selected (0)").disabled, true);
    textButton(toolbar, "Select visible").click(); textButton(toolbar, "Edit selected (2)").click();
    return app.document.querySelector(".transaction-bulk-dialog");
  }
  return { app, bulk, toolbar, rows: () => rows, open };
}

test("bulk edit reviews first, preserves import selection and unselected fields, and never sends a database write", async () => {
  const fixture = await stagedList(); const dialog = fixture.open();
  const add = dialog.querySelector(".bulk-add-field");
  assert.equal(textButton(dialog, "Review changes").disabled, true);
  add.value = "group"; add.dispatch("change");
  const input = dialog.querySelector('[role="combobox"]'); input.value = "Canyon Aeroad"; input.dispatch("input");
  textButton(dialog, "+ Create “Canyon Aeroad”").click();
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].group, "", "review must not apply changes");
  assert.match(dialog.querySelector(".bulk-review").textContent, /2 of 2 selected transactions will change/);
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].group, "Canyon Aeroad");
  assert.equal(fixture.rows()[1].group, "Canyon Aeroad");
  assert.equal(fixture.rows()[0]._selected, true); assert.equal(fixture.rows()[1]._selected, false);
  assert.equal(fixture.rows()[0].tags, "tools");
  assert.equal(fixture.rows()[0].createdAt, "2026-01-01T00:00:00Z");
  assert.equal(fixture.app.writes().length, 0);
  assert.equal(fixture.app.document.querySelector(".transaction-bulk-dialog"), null);
});

test("bulk Cancel, X, Escape and backdrop all discard reviewed drafts", async () => {
  for (const how of ["cancel", "x", "escape", "backdrop"]) {
    const fixture = await stagedList(); const dialog = fixture.open();
    const add = dialog.querySelector(".bulk-add-field"); add.value = "notes"; add.dispatch("change");
    dialog.querySelector("textarea").value = "Unsaved bulk draft";
    dialog.querySelector("form").dispatch("submit"); await flush();
    if (how === "cancel") textButton(dialog, "Cancel").click();
    else if (how === "x") dialog.querySelector('[aria-label="Cancel bulk edit"]').click();
    else if (how === "escape") dialog.dispatch("cancel");
    else dialog.dispatch("click", { clientX: -10, clientY: -10 });
    assert.equal(fixture.rows()[0].notes, "Initial note", how);
    assert.equal(fixture.app.writes().length, 0, how);
    assert.equal(dialog.open, false, how);
  }
});

test("removing then readding the bulk tags action reconnects the shared tag picker", async () => {
  const fixture = await stagedList(); const dialog = fixture.open();
  const add = dialog.querySelector(".bulk-add-field"); add.value = "tags"; add.dispatch("change");
  textButton(dialog, "Remove").click(); add.value = "tags"; add.dispatch("change");
  const input = dialog.querySelector("[data-new-tag-input]"); input.value = "bike"; input.dispatch("input");
  dialog.querySelector("[data-new-tag-button]").click();
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.match(dialog.querySelector(".bulk-review").textContent, /tools, bike/);
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].tags, "tools, bike");
  assert.equal(fixture.rows()[1].tags, "apparel, bike");
});

test("bulk field transformations preserve identity, allow explicit clearing and reject invalid input", async () => {
  const app = await start([]); const bulk = app.window.LedgerTransactionBulk;
  const original = tx({ flags: "custom,refunded", group: "LA trip", tags: "bike, tools" });
  const updated = bulk.applyChanges(original, { group: "", notes: "", refunded: false,
    internalTransferTreatment: "internal-transfer", tags: { mode: "remove", value: "BIKE" } });
  assert.equal(updated.group, ""); assert.equal(updated.notes, ""); assert.equal(updated.tags, "tools");
  assert.equal(updated.flags, "custom,internal-transfer");
  assert.equal(updated._id, original._id); assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.amount, original.amount);
  for (const changes of [{ createdAt: "new" }, { date: "2026-02-30" }, { description: "" }, { amount: "NaN" }, { group: ["a", "b"] }]) {
    assert.throws(() => bulk.applyChanges(original, changes));
  }
});
