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
    this.style = {setProperty(name,value) { this[name] = value; }}; this.hidden = false; this.disabled = false;
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
  prepend(child) { this.insertBefore(child, this.childNodes[0]); }
  contains(element) { return element === this || this.childNodes.some((child) => child.contains(element)); }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }
  matches(selector) {
    if (/^(\[[^\]]+\]){2,}$/.test(selector)) {
      return selector.match(/\[[^\]]+\]/g).every((part) => this.matches(part));
    }
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

async function start(rows, { stored = null, comparisonStored = null, mutationStatus = 200, missingCsv = false, transferReviewRequired = false, query = "" } = {}) {
  const document = parseDocument(read("transactions.html"));
  const requests = []; let currentRows = rows; let currentRevision = "revision-1";
  const storage = new Map(stored ? [["ledger.transactions-view.v1", JSON.stringify(stored)]] : []);
  if (comparisonStored) storage.set("ledger.group-comparison.v1", JSON.stringify(comparisonStored));
  const localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    if (url === "/api/taxonomy") return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    if (url === "/api/transactions" && missingCsv) return { ok: false, status: 404,
      json: async () => ({ code: "transaction_file_missing", error: "No transaction file yet." }) };
    if (options.method) {
      if (mutationStatus !== 200) return { ok: false, status: mutationStatus, json: async () => ({ error: "The transaction file changed. Refresh before saving." }) };
      const body = JSON.parse(options.body); const id = Number(url.split("/").at(-1));
      currentRows = url === "/api/transactions/bulk-delete" ? currentRows.filter((row) => !body.ids.includes(row._id))
        : options.method === "DELETE" ? currentRows.filter((row) => row._id !== id)
        : currentRows.map((row) => row._id === id ? { ...row, ...body.transaction, amount: Number(body.transaction.amount) } : row);
      currentRevision = "revision-2";
    }
    return { ok: true, status: 200, json: async () => ({ transactions: currentRows, revision: currentRevision,
      internalTransferReviewRequired: transferReviewRequired,
      ...(url === "/api/transactions/bulk-delete" ? { deleted: JSON.parse(options.body).ids.length, backup: "synthetic.csv" } : {}) }) };
  };
  const window = { confirm: () => false, location: { search: query } };
  const context = { window, document, localStorage, fetch, URLSearchParams, HTMLInputElement: Input, HTMLSelectElement: Select,
    Option: function Option(text, value) { const option = document.createElement("option"); option.textContent = text; option.value = value; return option; } };
  vm.createContext(context);
  for (const file of ["transaction-ui.js", "transaction-bulk.js", "transactions-model.js", "group-comparison.js", "period-comparison-model.js", "transactions.js"]) vm.runInContext(read(file), context, { filename: file });
  await flush();
  const el = (id) => document.getElementById(id);
  const field = (name) => el("transaction-form").elements.namedItem(name);
  const writes = () => requests.filter((request) => request.method);
  const edits = () => el("alltime-list").querySelectorAll("button");
  return { document, el, field, writes, edits, requests, window, storage, shared: window.LedgerTransactionUI };
}

test("period-report links replace stale browse filters and show only the linked spending scope", async () => {
  const app = await start([tx({ category: "Food", amount: 12 }), tx({ category: "Food", date: "2023-05-12", amount: 99 }),
    tx({ category: "Food", amount: 100, flags: "refunded" }), tx({ category: "Income", amount: -500 })], {
    stored: { filters: { description: "old search", provider: "Other bank", tags: ["missing"] } },
    query: "?report=period-comparison&startDate=2024-05-01&endDate=2024-05-31&category=Food&type=spending",
  });
  assert.equal(app.el("matching-spent").textContent, "$12.00");
  assert.equal(app.el("matching-income").textContent, "$0.00");
  assert.equal(app.el("alltime-search").value, "");
  assert.equal(app.edits().length, 1); assert.equal(app.writes().length, 0);
});

test("period drilldown preserves long accepted categories instead of falling back to unrelated remembered filters", async () => {
  const category = "Household & home / ".repeat(40);
  const app = await start([tx({ category, amount: 12 }), tx({ _id: 2, category: "Other", amount: 99 })], {
    stored: { filters: { category: "Other" } },
    query: "?report=period-comparison&startDate=2024-05-01&endDate=2024-05-31&type=spending&category=" + encodeURIComponent(category),
  });
  assert.equal(app.el("matching-spent").textContent, "$12.00");
  assert.equal(app.edits().length, 1);
  assert.equal(app.writes().length, 0);
});

test("comparison selection is searchable, live, limited to four and stored separately from browsing", async () => {
  const app = await start(["Bike A", "Bike B", "Trip C", "Trip D", "Build E"].map((group, i) => tx({ _id: i, group, amount: i * 10 })));
  app.el("compare-groups-tab").click();
  assert.equal(app.el("browse-transactions-panel").hidden, true);
  assert.equal(app.el("group-comparison-panel").hidden, false);
  app.el("choose-comparison-groups").click();
  const option = (name) => app.el("comparison-group-options").children.find((el) => el.textContent === name);
  for (const name of ["Bike A", "Bike B", "Trip C", "Trip D"]) option(name).click();
  assert.equal(option("Build E").disabled, true);
  assert.equal(app.el("comparison-cards").children.length, 4);
  assert.equal(app.el("comparison-group-picker").hidden, false, "Selection keeps the picker open");
  app.el("comparison-group-search").value = "BIKE"; app.el("comparison-group-search").dispatch("input");
  assert.equal(app.el("comparison-group-options").children.length, 2);
  option("Bike A").click();
  assert.equal(app.el("comparison-cards").children.length, 3);
  app.el("group-comparison-panel").dispatch("keydown", { key: "Escape" });
  assert.equal(app.el("comparison-group-picker").hidden, true);
  assert.equal(app.document.activeElement.id, "choose-comparison-groups");
  assert.deepEqual(JSON.parse(app.storage.get("ledger.group-comparison.v1")).groups, ["Bike B", "Trip C", "Trip D"]);
  assert.equal(app.writes().length, 0);
});

test("comparison chips, cards, bars and category cells keep each group's color after removing an earlier group", async () => {
  const rows = ["Z", "M", "H", "A"].map((group, i) => tx({ _id: i, group, amount: i + 1 }));
  const app = await start(rows, { comparisonStored: { groups: ["Z", "M", "H"] } });
  const colors = () => app.el("comparison-cards").children.map((card) => card.style["--group-color"]);
  assert.deepEqual(colors(), ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"]);
  app.el("comparison-selected-groups").children[0].click();
  assert.deepEqual(colors(), ["var(--viz-2)", "var(--viz-3)"]);
  app.el("choose-comparison-groups").click();
  app.el("comparison-group-options").children.find((el) => el.textContent === "A").click();
  const expected = ["var(--viz-2)", "var(--viz-3)", "var(--viz-1)"];
  assert.deepEqual(colors(), expected);
  assert.deepEqual(app.el("comparison-selected-groups").children.map((el) => el.style["--group-color"]), expected);
  assert.deepEqual(app.el("comparison-spending-bars").querySelectorAll("button").map((el) => el.style["--group-color"]), expected);
  assert.deepEqual(app.el("comparison-category-table").querySelectorAll("td").map((el) => el.style["--group-color"]), expected);
  app.el("comparison-baseline").value = "a"; app.el("comparison-baseline").dispatch("change");
  assert.deepEqual(colors(), expected);
  const restored = await start(rows, { comparisonStored: JSON.parse(app.storage.get("ledger.group-comparison.v1")) });
  assert.deepEqual(restored.el("comparison-cards").children.map((card) => card.style["--group-color"]), expected);
  assert.equal(app.writes().length, 0);
});

test("comparison ignores browse filters, drills into the shared editable list, recomputes after saves, and restores the old search", async () => {
  const app = await start([tx({ _id: 1, group: "Bike A", amount: 100 }), tx({ _id: 2, group: "Bike B", amount: 50 })], {
    stored: { filters: { description: "No matching purchase", tags: ["nonexistent"] } }, comparisonStored: { groups: ["Bike A", "Bike B"] },
  });
  app.el("compare-groups-tab").click();
  assert.match(app.el("comparison-cards").textContent, /\$100\.00/);
  app.el("comparison-cards").querySelectorAll("button")[0].click();
  assert.equal(app.el("comparison-drilldown").hidden, false);
  assert.match(app.el("matching-spent").textContent, /\$100\.00/);
  assert.equal(app.el("alltime-list").querySelectorAll(".transaction-row").length, 1);
  app.edits()[0].click();
  app.field("amount").value = "120.00";
  app.el("transaction-form").dispatch("submit"); await flush();
  app.el("back-to-comparison").click();
  assert.equal(app.el("group-comparison-panel").hidden, false);
  assert.match(app.el("comparison-cards").textContent, /\$120\.00/);
  assert.match(app.el("comparison-cards").textContent, /\$70\.00 less/);
  app.el("browse-transactions-tab").click();
  assert.equal(app.el("alltime-search").value, "No matching purchase");
  assert.equal(app.el("alltime-list").querySelectorAll(".transaction-row").length, 0);
  assert.equal(app.writes().length, 1, "Only explicit editor Save writes");
});

test("comparison date ranges are inclusive, retain last valid results on error, and can reset to all time", async () => {
  const app = await start([tx({ group: "Bike", amount: 10, date: "2025-01-01" }), tx({ _id: 2, group: "Bike", amount: 20, date: "2026-01-01" })], {
    stored: { mode: "compare" }, comparisonStored: { groups: ["Bike"] },
  });
  const end = app.el("comparison-end-date"); end.value = "2025-01-01"; end.dispatch("input");
  assert.match(app.el("comparison-cards").textContent, /\$10\.00/);
  const startDate = app.el("comparison-start-date"); startDate.value = "2026-01-01"; startDate.dispatch("input");
  assert.equal(app.el("comparison-date-error").hidden, false);
  assert.match(app.el("comparison-cards").textContent, /\$10\.00/);
  assert.equal(JSON.parse(app.storage.get("ledger.group-comparison.v1")).startDate, "");
  app.el("comparison-all-time").click();
  assert.equal(app.el("comparison-date-error").hidden, true);
  assert.match(app.el("comparison-cards").textContent, /\$30\.00/);
  assert.equal(app.writes().length, 0);
});

test("comparison category drilldown scopes group, dates and category; reference changes and missing groups remain safe", async () => {
  const app = await start([tx({ _id: 1, group: "A", amount: 100 }), tx({ _id: 2, group: "B", amount: 40 }),
    tx({ _id: 3, group: "A", category: "Food", amount: 10 })], {
    comparisonStored: { groups: ["A", "B", "Removed"], startDate: "2024-01-01" },
  });
  app.el("comparison-baseline").value = "b"; app.el("comparison-baseline").dispatch("change");
  assert.match(app.el("comparison-cards").textContent, /\$70\.00 more/);
  assert.match(app.el("comparison-cards").textContent, /No saved transactions remain/);
  assert.equal(app.el("comparison-cards").querySelectorAll("button")[2].disabled, true);
  app.el("comparison-category-table").querySelectorAll("button")[0].click();
  const fields = app.el("alltime-filter-popover").elements;
  assert.equal(fields.namedItem("group").value, "A");
  assert.equal(fields.namedItem("category").value, "Shopping");
  assert.equal(fields.namedItem("startDate").value, "2024-01-01");
  assert.equal(app.el("alltime-list").querySelectorAll(".transaction-row").length, 1);
  assert.equal(app.writes().length, 0);
});

test("comparison restores safely with removed or malformed preferences and respects setup gates", async () => {
  const app = await start([], { stored: { mode: "compare" }, comparisonStored: { groups: [null, "", "A", "a", {}, 3], startDate: "bad" } });
  assert.equal(app.el("group-comparison-panel").hidden, false);
  assert.equal(app.el("comparison-cards").children.length, 1);
  assert.match(app.el("comparison-cards").textContent, /No saved transactions remain/);
  assert.equal(app.el("comparison-start-date").value, "");
  for (const gate of [{ missingCsv: true }, { transferReviewRequired: true }]) {
    const gated = await start([tx()], { ...gate, stored: { mode: "compare" } });
    assert.equal(gated.el("compare-groups-tab").disabled, true);
    assert.equal(gated.el("group-comparison-panel").hidden, true);
    assert.equal(gated.writes().length, 0);
  }
});

test("comparison keyboard tabs, category expansion, and removing the reference never write data", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => tx({ _id: i, group: "A", category: `Category ${i}`, amount: i }));
  const app = await start([...rows, tx({ _id: 20, group: "B" })], { comparisonStored: { groups: ["A", "B"] } });
  app.el("browse-transactions-tab").dispatch("keydown", { key: "ArrowRight" });
  assert.equal(app.document.activeElement.id, "compare-groups-tab");
  assert.equal(app.el("compare-groups-tab").getAttribute("aria-selected"), "true");
  assert.equal(app.el("comparison-category-table").querySelector("tbody").children.length, 6);
  app.el("comparison-category-toggle").click();
  assert.equal(app.el("comparison-category-table").querySelector("tbody").children.length, 10);
  app.el("comparison-selected-groups").children[0].click();
  assert.equal(app.el("comparison-baseline").value, "b");
  assert.equal(app.el("comparison-baseline").disabled, true);
  app.el("compare-groups-tab").dispatch("keydown", { key: "Home" });
  assert.equal(app.el("browse-transactions-panel").hidden, false);
  assert.equal(app.writes().length, 0);
});

test("confirmed deletion in a comparison drilldown recomputes missing-group state while keeping the comparison selection", async () => {
  const app = await start([tx({ _id: 1, group: "A" }), tx({ _id: 2, group: "B" })], { comparisonStored: { groups: ["A", "B"] } });
  app.el("compare-groups-tab").click();
  app.el("comparison-cards").querySelectorAll("button")[0].click();
  app.edits()[0].click(); app.window.confirm = () => true;
  app.el("delete-transaction-button").click(); await flush();
  app.el("back-to-comparison").click();
  assert.match(app.el("comparison-cards").children[0].textContent, /No saved transactions remain/);
  assert.match(app.el("comparison-cards").children[1].textContent, /No activity to compare/);
  assert.deepEqual(JSON.parse(app.storage.get("ledger.group-comparison.v1")).groups, ["A", "B"]);
  assert.equal(app.writes().length, 1);
});

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

test("tags live inside Filters and apply OR/AND without double-counting matching rows", async () => {
  const rows = [tx({ _id: 1, amount: 20, tags: "bike, tools" }),
    tx({ _id: 2, amount: 80, tags: "bike, apparel" }),
    tx({ _id: 3, amount: 40, tags: "apparel" }),
    tx({ _id: 4, amount: 1000, tags: "bike" })];
  const app = await start(rows);
  app.el("alltime-filter-button").click();
  const form = app.el("alltime-filter-popover");
  assert.equal(form.querySelector("#tag-options"), app.el("tag-options"));
  assert.notEqual(form.querySelector('[data-tag-mode="all"]'), null);
  assert.equal(app.document.querySelector(".alltime-tag-bar"), null);
  const tagButton = (tag) => app.el("tag-options").children.find((element) => element.textContent === tag);
  tagButton("bike").click();
  assert.equal(form.hidden, false);
  assert.equal(app.el("matching-spent").textContent, "$1,100.00");
  tagButton("apparel").click();
  assert.equal(form.hidden, false);
  assert.equal(app.el("matching-spent").textContent, "$1,140.00");
  assert.equal(app.el("result-count").textContent, "1–4 of 4");
  assert.equal(app.el("alltime-filter-count").textContent, "2");
  assert.match(app.el("filter-chips").textContent, /match any \(OR\)/);
  app.document.querySelector('[data-tag-mode="all"]').click();
  assert.equal(app.el("matching-spent").textContent, "$80.00");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  assert.match(app.el("filter-chips").textContent, /match all \(AND\)/);
  assert.deepEqual(JSON.parse(app.storage.get("ledger.transactions-view.v1")).filters.tags, ["bike", "apparel"]);
  textButton(app.el("filter-chips"), "apparel ×").click();
  assert.equal(app.el("matching-spent").textContent, "$1,100.00");
  assert.equal(app.el("alltime-filter-count").textContent, "1");
  assert.doesNotMatch(app.el("filter-chips").textContent, /match all/);
});

test("live tag filters survive closing the popover and Reset updates results immediately", async () => {
  const app = await start([tx({ tags: "bike", amount: 20 }), tx({ _id: 2, tags: "tools", amount: 40 })]);
  const form = app.el("alltime-filter-popover");
  for (const dismiss of [
    () => app.el("alltime-filter-button").click(),
    () => app.document.dispatch("keydown", { key: "Escape" }),
    () => app.document.dispatch("click"),
  ]) {
    app.el("alltime-filter-button").click();
    textButton(app.el("tag-options"), "bike").click();
    app.document.querySelector('[data-tag-mode="all"]').click();
    dismiss();
    assert.equal(form.hidden, true);
    assert.equal(app.el("matching-spent").textContent, "$20.00");
    app.el("alltime-filter-button").click();
    assert.equal(textButton(app.el("tag-options"), "bike").getAttribute("aria-pressed"), "true");
    assert.equal(app.document.querySelector('[data-tag-mode="all"]').getAttribute("aria-pressed"), "true");
    app.el("reset-alltime-filters").click();
    assert.equal(app.el("matching-spent").textContent, "$60.00");
    assert.equal(app.el("alltime-filter-count").hidden, true);
    app.el("alltime-filter-button").click();
  }
  app.el("alltime-filter-button").click();
  textButton(app.el("tag-options"), "bike").click();
  assert.equal(app.el("matching-spent").textContent, "$20.00");
  app.el("reset-alltime-filters").click();
  assert.equal(textButton(app.el("tag-options"), "bike").getAttribute("aria-pressed"), "false");
  assert.equal(app.el("matching-spent").textContent, "$60.00");
  assert.equal(app.el("alltime-filter-count").hidden, true);
  assert.equal(app.writes().length, 0);
});

test("tag search preserves hidden selections and Untagged forces Any matching", async () => {
  const app = await start([tx({ tags: "bike", amount: 20 }), tx({ _id: 2, tags: "", amount: 40 })]);
  app.el("alltime-filter-button").click();
  textButton(app.el("tag-options"), "bike").click();
  app.document.querySelector('[data-tag-mode="all"]').click();
  app.el("tag-search").value = "UNTAG"; app.el("tag-search").dispatch("input");
  assert.doesNotMatch(app.el("tag-options").textContent, /bike/);
  textButton(app.el("tag-options"), "Untagged").click();
  assert.equal(app.document.querySelector('[data-tag-mode="all"]').disabled, true);
  assert.equal(app.document.querySelector('[data-tag-mode="any"]').getAttribute("aria-pressed"), "true");
  assert.equal(app.el("matching-spent").textContent, "$60.00");
  assert.equal(app.el("alltime-filter-count").textContent, "2");
  assert.match(app.el("filter-chips").textContent, /bike/);
  assert.match(app.el("filter-chips").textContent, /Untagged/);
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
  field("category").value = "Travel"; field("category").dispatch("change");
  field("startDate").value = "2024-05-12"; field("endDate").value = "2024-05-12";
  field("endDate").dispatch("input");
  assert.equal(app.el("result-count").textContent, "1–3 of 3");
  assert.equal(app.el("matching-spent").textContent, "$50.00");
  assert.equal(app.el("matching-income").textContent, "$0.00");
  assert.match(app.el("matching-scope").textContent, /2 refunded or internal transfer/);
  field("showExcluded").checked = false; field("showExcluded").dispatch("change");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  assert.equal(app.el("matching-spent").textContent, "$50.00");
  field("startDate").value = "2025-01-01"; field("startDate").dispatch("input");
  assert.match(field("endDate").validityMessage, /on or after/);
  assert.equal(app.el("matching-spent").textContent, "$50.00");
  assert.equal(app.el("alltime-date-error").hidden, false);
  field("endDate").value = "2026-12-31"; field("endDate").dispatch("change");
  assert.equal(app.el("alltime-date-error").hidden, true);
  assert.equal(form.hidden, false);
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
  assert.equal(app.el("refresh-transactions"), null);
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

function toggleCheckbox(checkbox, checked, shiftKey = false) {
  // Browser activation toggles checked before click, then emits change.
  checkbox.checked = checked; checkbox.focus();
  checkbox.dispatch("click", {shiftKey}); checkbox.dispatch("change");
}

test("Shift-click selects and clears inclusive bulk ranges in both directions without saving", async () => {
  for (const reverse of [false,true]) {
    const app = await start(Array.from({length:5},(_,i)=>tx({_id:i,description:`Row ${i}`})));
    textButton(app.document,"Edit multiple").click();
    const boxes = () => app.el("alltime-list").querySelectorAll("input");
    const first = reverse ? 4 : 0; const last = reverse ? 1 : 3;
    toggleCheckbox(boxes()[first],true);
    toggleCheckbox(boxes()[last],true,true);
    assert.deepEqual(boxes().map(box=>box.checked), reverse ? [false,true,true,true,true] : [true,true,true,true,false]);
    assert.equal(textButton(app.document,"Delete selected (4)").disabled,false);
    assert.equal(app.document.activeElement,boxes()[last],"Focus survives selection rerender");
    toggleCheckbox(boxes()[first],false);
    toggleCheckbox(boxes()[last],false,true);
    assert.equal(boxes().some(box=>box.checked),false);
    assert.equal(textButton(app.document,"Delete selected (0)").disabled,true);
    assert.equal(app.writes().length,0);
  }
});

test("Shift ranges ignore filtered-out rows and reset when sorting or clearing changes the anchor", async () => {
  const rows = Array.from({length:6},(_,i)=>tx({_id:i,description:`Row ${i}`,category:i%2 ? "Travel":"Food"}));
  const app = await start(rows); textButton(app.document,"Edit multiple").click();
  const boxes = () => app.el("alltime-list").querySelectorAll("input");
  toggleCheckbox(boxes()[5],true); // Row 0 will be hidden, but stays selected.
  app.el("alltime-filter-button").click();
  const category = app.el("alltime-filter-popover").elements.namedItem("category");
  category.value="Travel"; category.dispatch("change");
  toggleCheckbox(boxes()[2],true,true); // Anchor disappeared: only Row 1 changes.
  assert.equal(textButton(app.document,"Delete selected (2)").disabled,false);
  toggleCheckbox(boxes()[0],true,true);
  assert.equal(textButton(app.document,"Delete selected (4)").disabled,false);
  assert.equal(app.document.querySelector(".bulk-selection-count").textContent,"4 selected · 1 outside this view");
  const sort=app.document.querySelector('[aria-label="Sort transactions"]');
  sort.value="description:asc"; sort.dispatch("change");
  toggleCheckbox(boxes()[1],false,true); // New order: no inherited range.
  assert.deepEqual(boxes().map(box=>box.checked),[true,false,true]);
  textButton(app.document,"Clear selection").click();
  toggleCheckbox(boxes()[2],true,true);
  assert.deepEqual(boxes().map(box=>box.checked),[false,false,true]);
  assert.equal(app.writes().length,0);
});

test("Shift ranges stay on the current page and selection mode changes reset the anchor", async () => {
  const app=await start(Array.from({length:53},(_,i)=>tx({_id:i,description:`Row ${i}`})));
  textButton(app.document,"Edit multiple").click();
  const boxes=()=>app.el("alltime-list").querySelectorAll("input");
  toggleCheckbox(boxes()[0],true);
  app.el("next-page").click();
  toggleCheckbox(boxes()[2],true,true);
  assert.deepEqual(boxes().map(box=>box.checked),[false,false,true]);
  assert.equal(app.document.querySelector(".bulk-selection-count").textContent,"2 selected · 1 outside this view");
  textButton(app.document,"Done editing").click(); textButton(app.document,"Edit multiple").click();
  toggleCheckbox(boxes()[0],true,true);
  assert.deepEqual(boxes().map(box=>box.checked),[true,false,false]);
  assert.equal(app.writes().length,0);
});

test("shared range helper skips disabled rows, rejects stale controls and handles ordinary changes", async () => {
  const app=await start([]); const changes=[];
  const range=app.shared.createCheckboxRangeSelection((ids,checked)=>changes.push({ids:[...ids],checked}));
  function controls(scope) {
    range.sync([0,1,2],scope);
    return [0,1,2].map(id=>{const box=app.document.createElement("input"); box.type="checkbox"; box.disabled=id===1; range.bind(box,id); return box;});
  }
  const old=controls("r1"); toggleCheckbox(old[0],true); toggleCheckbox(old[2],true,true);
  assert.deepEqual(changes[1],{ids:[0,2],checked:true});
  const fresh=controls("r2"); toggleCheckbox(old[0],false,true);
  assert.equal(changes.length,2,"Old revision's control cannot change selection");
  toggleCheckbox(fresh[2],true,true);
  assert.deepEqual(changes[2],{ids:[2],checked:true},"Revision reset the anchor");
  fresh[0].checked=false; fresh[0].dispatch("change");
  assert.deepEqual(changes[3],{ids:[0],checked:false},"Non-mouse change has no stale Shift modifier");
  toggleCheckbox(fresh[1],true,true); assert.equal(changes.length,4);
});

test("import Shift ranges revalidate once, leave hidden duplicates alone and stay separate from bulk selection", async () => {
  const rows=Array.from({length:5},(_,i)=>tx({_id:i,_stagedId:i,description:`Row ${i}`,_isDuplicate:i===2}));
  const app=await reviewPageFixture("upload",(url,options)=>url.endsWith("staged-preview")
    ? {transactions:JSON.parse(options.body).transactions,new:4,duplicates:1,transferPlan:"p",existingTransferUpdates:[]} : null);
  app.run(`renderResult(${JSON.stringify({parsed:5,new:4,duplicates:1,revision:"r1",transferPlan:"p",transactions:rows})},"csv","session")`);
  const boxes=()=>app.el("import-review-list").querySelectorAll("input");
  assert.equal(boxes().length,4);
  toggleCheckbox(boxes()[0],false); await flush();
  toggleCheckbox(boxes()[3],false,true);
  assert.equal(boxes().some(box=>box.checked),false,"Range checkmarks update immediately");
  assert.equal(app.el("confirm-import-review").disabled,true);
  await flush();
  assert.equal(app.requests.filter(request=>request.url.endsWith("staged-preview")).length,2,"One validation for each gesture, not each row");
  assert.equal(app.run("state.importedTransactions.find(row=>row._stagedId===2)._selected"),false);
  toggleCheckbox(boxes()[0],true,true); await flush();
  assert.equal(app.run("state.importedTransactions.filter(row=>row._selected).length"),4);
  const dialog=app.el("import-review-dialog"); textButton(dialog,"Edit multiple").click();
  toggleCheckbox(boxes()[0],true); toggleCheckbox(boxes()[3],true,true);
  assert.equal(textButton(dialog,"Edit selected (4)").disabled,false);
  assert.equal(app.el("confirm-import-review").disabled,true);
  textButton(dialog,"Done editing").click();
  toggleCheckbox(boxes()[3],false,true); await flush();
  assert.equal(app.run("state.importedTransactions.filter(row=>row._selected).length"),3,"Import anchor reset after leaving bulk mode");
  assert.equal(app.requests.some(request=>request.url.endsWith("/commit")||request.url.includes("/transactions/bulk")),false);
});

test("history and unclassified lists use the same Shift range behavior", async () => {
  for(const [page,dialogId,listId,open] of [
    ["settings","import-history-dialog","import-history-transactions",'openImportHistoryBatch({createdAt:"2026-01-01T00:00:00Z"})'],
    ["classifications","unclassified-dialog","unclassified-list","openUnclassifiedDialog()"],
  ]) {
    const rows=Array.from({length:4},(_,i)=>tx({_id:i,description:`Row ${i}`,subcategory:""}));
    const app=await reviewPageFixture(page,()=>({transactions:rows,revision:"r1",imports:[],classifications:[]}));
    await app.run(open); const dialog=app.el(dialogId); textButton(dialog,"Edit multiple").click();
    const boxes=()=>app.el(listId).querySelectorAll("input");
    toggleCheckbox(boxes()[0],true); toggleCheckbox(boxes()[3],true,true);
    assert.equal(textButton(dialog,"Delete selected (4)").disabled,false,page);
    assert.equal(app.requests.some(request=>request.url.includes("/transactions/bulk")),false,page);
  }
});

test("bulk deletion reviews hidden selections and confirms exactly once before updating results", async () => {
  const app = await start([tx({_id:1,description:"Helmet"}), tx({_id:2,description:"Jersey"}), tx({_id:3,description:"Hotel"})]);
  textButton(app.document, "Edit multiple").click();
  const toolbar = app.document.querySelector(".transaction-bulk-toolbar");
  assert.equal(textButton(toolbar, "Delete selected (0)").disabled, true);
  textButton(toolbar, "Select visible").click();
  const hotel = app.el("alltime-list").querySelector('[aria-label="Select Hotel for bulk editing"]');
  hotel.checked = false; hotel.dispatch("change");
  app.el("alltime-search").value = "Helmet"; app.el("alltime-search").dispatch("input");
  textButton(toolbar, "Delete selected (2)").click();
  const dialog = app.document.querySelector(".bulk-delete-dialog");
  assert.equal(app.document.activeElement, textButton(dialog, "Cancel"));
  assert.match(dialog.textContent, /1 selected transaction is outside/);
  assert.match(dialog.textContent, /permanently removed from your master CSV/);
  assert.match(dialog.querySelector(".bulk-delete-list").textContent, /Helmet/);
  assert.match(dialog.querySelector(".bulk-delete-list").textContent, /Jersey/);
  assert.doesNotMatch(dialog.querySelector(".bulk-delete-list").textContent, /Hotel/);
  assert.equal(app.writes().length, 0);
  const confirm = textButton(dialog, "Delete permanently (2)");
  confirm.click(); confirm.click();
  await flush();
  assert.equal(app.writes().length, 1);
  assert.deepEqual(JSON.parse(app.writes()[0].body), {ids:[1,2],revision:"revision-1",confirm:true});
  assert.equal(app.writes()[0].url, "/api/transactions/bulk-delete");
  assert.equal(dialog.open, false);
  assert.equal(app.el("alltime-search").value, "Helmet");
  assert.equal(app.el("matching-spent").textContent, "$0.00");
  assert.match(app.el("page-status").textContent, /Deleted 2 transactions/);
});

test("bulk deletion Cancel, X, Escape and backdrop preserve selection and never write", async () => {
  for (const how of ["cancel", "x", "escape", "backdrop"]) {
    const app = await start([tx()]);
    textButton(app.document, "Edit multiple").click();
    textButton(app.document, "Select visible").click();
    textButton(app.document, "Delete selected (1)").click();
    const dialog = app.document.querySelector(".bulk-delete-dialog");
    if (how === "cancel") textButton(dialog, "Cancel").click();
    if (how === "x") dialog.querySelector('[aria-label="Cancel deletion"]').click();
    if (how === "escape") dialog.dispatch("cancel");
    if (how === "backdrop") dialog.dispatch("click", {clientX:-10,clientY:-10});
    assert.equal(app.writes().length, 0, how);
    assert.equal(dialog.open, false, how);
    assert.equal(textButton(app.document, "Delete selected (1)").disabled, false, how);
    assert.match(app.el("alltime-list").textContent, /Bike purchase/, how);
  }
});

test("failed or stale bulk deletion keeps the review and rows intact", async () => {
  for (const mutationStatus of [409,500,404]) {
    const app = await start([tx()], {mutationStatus});
    textButton(app.document, "Edit multiple").click(); textButton(app.document, "Select visible").click();
    textButton(app.document, "Delete selected (1)").click();
    const dialog = app.document.querySelector(".bulk-delete-dialog");
    textButton(dialog, "Delete permanently (1)").click(); await flush();
    assert.equal(dialog.open, true);
    assert.equal(dialog.querySelector(".form-error").hidden, false);
    assert.match(app.el("alltime-list").textContent, /Bike purchase/);
    assert.equal(textButton(dialog, "Cancel").disabled, false);
  }
});

test("bulk delete Select visible only selects the current page and clamps an empty last page", async () => {
  const app = await start(Array.from({length:51}, (_,i)=>tx({_id:i,description:`Purchase ${i}`})));
  app.el("next-page").click(); textButton(app.document, "Edit multiple").click();
  textButton(app.document, "Select visible").click(); textButton(app.document, "Delete selected (1)").click();
  const dialog = app.document.querySelector(".bulk-delete-dialog");
  textButton(dialog, "Delete permanently (1)").click(); await flush();
  assert.deepEqual(JSON.parse(app.writes()[0].body).ids, [0]);
  assert.match(app.el("page-indicator").textContent, /Page 1/);
  assert.equal(app.el("alltime-list").children.length, 50);
});

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

test("transaction field dropdowns merge database and taxonomy options, scope subcategories and preserve untouched fields", async () => {
  const original=tx({description:"Original",category:"  Shopping  ",provider:"Test   bank"});
  const app=await start([original,tx({_id:2,description:"Food row",category:"Food",subcategory:"Groceries",accountName:"Checking",accountType:"BANK",provider:"Other bank"}),
    tx({_id:3,description:"Another shop",subcategory:"Apparel",provider:"test bank"})]);
  app.shared.setEditorTaxonomy([{name:"Food",subcategories:[{name:"Restaurant"}]},{name:"Travel",subcategories:[{name:"Lodging"}]}]);
  app.el("alltime-list").querySelector('[aria-label="Edit Original"]').click();
  const form=app.el("transaction-form");
  for(const field of ["category","subcategory","accountName","accountType","provider"]) {
    const input=app.field(field); input.click();
    assert.equal(input.getAttribute("role"),"combobox",field);
    assert.equal(input.getAttribute("list"),null,field);
    assert.match(input.parentElement.textContent,/Add new/,field);
    input.dispatch("keydown",{key:"Escape"});
    assert.equal(input.value,original[field],`Opening must not normalize ${field}`);
  }
  const category=app.field("category"); category.click();
  assert.match(category.parentElement.textContent,/Travel/);
  textButton(category.parentElement,"Food").click();
  const subcategory=app.field("subcategory"); subcategory.click();
  const values=subcategory.parentElement.querySelectorAll('[role="option"]').map(option=>option.textContent);
  assert(values.includes("Restaurant") && values.includes("Groceries"));
  assert(values.includes("Bike"),"Keep the current subcategory until explicitly changed");
  assert(!values.includes("Apparel") && !values.includes("Lodging"),"Do not mix other categories' options");
  textButton(subcategory.parentElement,"Restaurant").click();
  const provider=app.field("provider"); provider.value="TEST BANK"; provider.dispatch("input");
  assert.equal(provider.parentElement.querySelectorAll('[role="option"]').filter(option=>option.textContent.toLowerCase()==="test bank").length,1);
  assert.doesNotMatch(provider.parentElement.textContent,/Add new/);
  provider.dispatch("keydown",{key:"Enter"}); assert.equal(provider.value,"Test bank");
  assert.equal(app.writes().length,0);
  form.dispatch("submit"); await flush();
  const saved=JSON.parse(app.writes()[0].body).transaction;
  assert.equal(saved.category,"Food"); assert.equal(saved.subcategory,"Restaurant");
  assert.equal(saved.accountName,original.accountName); assert.equal(saved.accountType,original.accountType);
  assert.equal(saved.provider,"Test bank"); assert.equal(saved.tags,original.tags);
});

test("inline Add new, clearing, keyboard selection and cancelled value drafts do not leak between editors", async () => {
  for(const how of ["cancel","x","escape","backdrop"]) {
    const app=await start([tx()]); app.edits()[0].click();
    const field=app.field("accountName"); field.click();
    textButton(field.parentElement,"+ Add new account name…").click();
    field.value="New   account"; field.dispatch("input");
    textButton(field.parentElement,"+ Add new account name “New account”").click();
    assert.equal(field.value,"New account"); assert.equal(app.writes().length,0);
    const dialog=app.el("transaction-form-dialog");
    if(how==="cancel") app.el("cancel-form-button").click();
    if(how==="x") app.el("close-form-dialog").click();
    if(how==="escape") dialog.dispatch("cancel");
    if(how==="backdrop") dialog.dispatch("click",{clientX:-10,clientY:-10});
    assert.equal(dialog.open,false,how);
    app.edits()[0].click(); field.click();
    assert.equal(field.value,"Test card"); assert.doesNotMatch(field.parentElement.textContent,/New account/);
    assert.equal(app.writes().length,0,how);
    field.dispatch("keydown",{key:"ArrowDown"});
    assert(field.getAttribute("aria-activedescendant"));
    field.dispatch("keydown",{key:"Enter"});
    assert.equal(field.value,"","Blank choice explicitly clears the value");
  }
});

test("all single-editor page templates use the same five dropdowns and creation stays local until save", async () => {
  const app=await start([]);
  const sources=[tx({category:"Food",subcategory:"Restaurant",accountName:"Checking",accountType:"BANK",provider:"Bank"})];
  for(const [page,id] of [["index.html","transaction-form"],["transactions.html","transaction-form"],
    ["upload.html","import-edit-form"],["settings.html","import-history-edit-form"],["classifications.html","import-history-edit-form"]]) {
    const doc=parseDocument(read(page)); const form=doc.getElementById(id);
    app.shared.populateTransactionEditor(form,tx(),{}, {transactions:sources});
    for(const [field,value] of [["category","Food"],["subcategory","Restaurant"],["accountName","Checking"],["accountType","BANK"],["provider","Bank"]]) {
      const input=form.elements.namedItem(field); input.click();
      textButton(input.parentElement,value).click();
      assert.equal(input.value,value,`${page}: ${field}`);
      input.value=`New ${field}`; input.dispatch("input"); input.dispatch("keydown",{key:"Enter"});
      assert.equal(input.value,`New ${field}`);
      // Restore category so the following subcategory tests the correct parent.
      if(field==="category") { input.click(); textButton(input.parentElement,"Food").click(); }
    }
    const fields=app.shared.transactionFromEditor(form,tx());
    assert.equal(fields.provider,"New provider");
    assert.equal(fields.accountType,"New accountType");
    assert.equal(fields.flags,"");
  }
  assert.equal(app.writes().length,0);
});

test("every transaction editor searches all subcategories without a category and selects the first alphabetical parent", async () => {
  const app = await start([]);
  const sources = [tx({ category: "Zebra", subcategory: "Service" }),
    tx({ category: "Food", subcategory: "Groceries" }),
    tx({ category: "Bike", subcategory: "service" }),
    tx({ category: "", subcategory: "Service" })];
  app.shared.setEditorTaxonomy([{ name: "Auto", subcategories: [{ name: "Service" }] },
    { name: "Travel", subcategories: [{ name: "Lodging" }] }]);
  for (const [page, id] of [["index.html", "transaction-form"], ["transactions.html", "transaction-form"],
    ["upload.html", "import-edit-form"], ["settings.html", "import-history-edit-form"], ["classifications.html", "import-history-edit-form"]]) {
    const form = parseDocument(read(page)).getElementById(id);
    const original = tx({ category: "", subcategory: "Service" });
    app.shared.populateTransactionEditor(form, original, {}, { transactions: sources });
    const category = form.elements.namedItem("category");
    const subcategory = form.elements.namedItem("subcategory");
    assert.equal(category.value, "", "Opening does not classify existing values");
    subcategory.click();
    for (const value of ["Groceries", "Lodging", "Service"]) assert.match(subcategory.parentElement.textContent, new RegExp(value), page);
    subcategory.value = "GRO"; subcategory.dispatch("input");
    assert.equal(category.value, "", "Typing alone must not change category");
    textButton(subcategory.parentElement, "Groceries").click();
    assert.equal(category.value, "Food", page);
    category.click(); category.dispatch("keydown", { key: "Escape" });
    assert.equal(category.value, "Food", "Picker state must retain the inferred category");
    category.click(); textButton(category.parentElement, "No category").click();
    subcategory.value = "  SERVICE  "; subcategory.dispatch("input");
    subcategory.dispatch("keydown", { key: "Enter" });
    assert.equal(category.value, "Auto", "Choose the first alphabetical parent across taxonomy and transactions");
    const fields = app.shared.transactionFromEditor(form, original);
    assert.equal(fields.category, "Auto"); assert.equal(fields.subcategory, "Service");
    assert.equal(fields.accountName, original.accountName);
    // Populate another draft: neither inferred values nor search text may leak.
    app.shared.populateTransactionEditor(form, tx({ category: "", subcategory: "" }), {}, { transactions: sources });
    subcategory.value = "Lodging"; subcategory.dispatch("input");
    subcategory.dispatch("keydown", { key: "Escape" });
    assert.equal(category.value, ""); assert.equal(subcategory.value, "");
    subcategory.value = "Brand new subcategory"; subcategory.dispatch("input");
    subcategory.dispatch("keydown", { key: "Enter" });
    assert.equal(category.value, "", "Unknown subcategories cannot invent a parent");
    subcategory.click(); textButton(subcategory.parentElement, "No subcategory").click();
    assert.equal(category.value, "");
  }
  assert.equal(app.writes().length, 0);
});

test("subcategory selection respects a nonblank category and does not rewrite unrelated legacy values", async () => {
  const original = tx({ category: "  Shopping  ", subcategory: "Restaurant", provider: "Test   bank" });
  const app = await start([original]);
  app.shared.setEditorTaxonomy([{ name: "Food", subcategories: [{ name: "Restaurant" }] }]);
  app.edits()[0].click();
  const subcategory = app.field("subcategory"); subcategory.click();
  textButton(subcategory.parentElement, "Restaurant").click();
  assert.equal(app.field("category").value, original.category);
  app.el("transaction-form").dispatch("submit"); await flush();
  const saved = JSON.parse(app.writes()[0].body).transaction;
  assert.equal(saved.category, original.category); assert.equal(saved.provider, original.provider);
});

test("inferred categories stay staged in imports and cancelled inference restores both fields", async () => {
  const original = tx({ _stagedId: 0, category: "", subcategory: "", _classificationMatched: false });
  const app = await editableImportFixture([original]);
  app.run('transactionUi.setEditorTaxonomy([{name:"Food", subcategories:[{name:"Groceries"}]}])');
  app.el("import-review-list").querySelector(".edit-button").click();
  const form = app.el("import-edit-form");
  const subcategory = form.elements.namedItem("subcategory");
  subcategory.click(); textButton(subcategory.parentElement, "Groceries").click();
  assert.equal(form.elements.namedItem("category").value, "Food");
  app.el("cancel-import-edit").click();
  assert.equal(app.run("state.importedTransactions[0].category"), "");
  assert.equal(app.run("state.reviewEditedIds.size"), 0);
  app.el("import-review-list").querySelector(".edit-button").click();
  assert.equal(form.elements.namedItem("category").value, ""); assert.equal(subcategory.value, "");
  subcategory.click(); textButton(subcategory.parentElement, "Groceries").click();
  form.dispatch("submit"); await flush();
  assert.equal(app.run("state.importedTransactions[0].category"), "Food");
  assert.equal(app.run("state.importedTransactions[0].subcategory"), "Groceries");
  assert.equal(app.run("state.reviewEditedIds.size"), 1);
  assert.equal(app.requests.some(r => r.method === "PUT" || r.url.endsWith("/commit")), false);
});

test("bulk subcategory selection visibly adds its parent category and reviews both before applying", async () => {
  const fixture = await stagedList(); const dialog = fixture.open();
  fixture.app.shared.setEditorTaxonomy([{ name: "Food", subcategories: [{ name: "Restaurant" }] }]);
  const add = dialog.querySelector(".bulk-add-field"); add.value = "subcategory"; add.dispatch("change");
  const subcategory = dialog.querySelector('[aria-label="Subcategory"]'); subcategory.click();
  textButton(subcategory.parentElement, "Restaurant").click();
  assert.equal(dialog.querySelector('[aria-label="Category"]').value, "Food");
  assert.equal(fixture.rows()[0].category, "Shopping");
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.match(dialog.querySelector(".bulk-review").textContent, /Category.*Food/s);
  assert.match(dialog.querySelector(".bulk-review").textContent, /Subcategory.*Restaurant/s);
  assert.equal(fixture.rows()[0].category, "Shopping", "Review cannot write the inferred parent");
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].category, "Food"); assert.equal(fixture.rows()[0].subcategory, "Restaurant");
  assert.equal(fixture.app.writes().length, 0);
});

test("staged import dropdowns combine existing and incoming values without writing the database", async () => {
  const rows=[tx({_stagedId:0,_isDuplicate:false})];
  const app=await reviewPageFixture("upload",(url,options)=>url.endsWith("staged-preview")
    ? {transactions:JSON.parse(options.body).transactions,new:1,duplicates:0,transferPlan:"p",existingTransferUpdates:[]}
    : {transactions:[tx({provider:"Existing provider"})],revision:"r1",categories:[]});
  app.run(`renderResult(${JSON.stringify({parsed:1,new:1,duplicates:0,revision:"r1",transferPlan:"p",transactions:rows})},"csv","session")`);
  app.el("import-review-list").querySelector(".edit-button").click();
  const input=app.el("import-edit-form").elements.namedItem("provider"); input.click();
  assert.match(input.parentElement.textContent,/Existing provider/); assert.match(input.parentElement.textContent,/Test bank/);
  input.value="New provider"; input.dispatch("input"); input.dispatch("keydown",{key:"Enter"});
  app.el("import-edit-form").dispatch("submit"); await flush();
  assert.equal(app.run("state.importedTransactions[0].provider"),"New provider");
  assert.equal(app.requests.some(request=>request.method==="PUT" || request.url.endsWith("/commit")),false);
});

test("bulk dropdown edits remain staged and subcategory options follow the explicitly selected category", async () => {
  const fixture=await stagedList(); const dialog=fixture.open();
  fixture.app.shared.setEditorTaxonomy([{name:"Food",subcategories:[{name:"Restaurant"}]},{name:"Travel",subcategories:[{name:"Lodging"}]}]);
  const add=dialog.querySelector(".bulk-add-field");
  add.value="category"; add.dispatch("change");
  const category=dialog.querySelector('[aria-label="Category"]'); category.click(); textButton(category.parentElement,"Food").click();
  add.value="subcategory"; add.dispatch("change");
  const subcategory=dialog.querySelector('[aria-label="Subcategory"]'); subcategory.click();
  assert.match(subcategory.parentElement.textContent,/Restaurant/); assert.doesNotMatch(subcategory.parentElement.textContent,/Lodging/);
  textButton(subcategory.parentElement,"Restaurant").click();
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].category,"Shopping");
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(fixture.rows()[0].category,"Food"); assert.equal(fixture.rows()[0].subcategory,"Restaurant");
  assert.equal(fixture.rows()[0].amount,50); assert.equal(fixture.rows()[0].tags,"tools");
  assert.equal(fixture.app.writes().length,0);
});

test("all-time search includes notes-only matches in results and totals and keeps its saved query compatible", async () => {
  const rows = [tx({ _id: 1, description: "Helmet", notes: "LA\n trip", amount: 10 }),
    tx({ _id: 2, description: "LA trip hotel", notes: "LA trip stay", amount: 20 }),
    tx({ _id: 3, description: "Book", notes: null, amount: 99 })];
  const app = await start(rows);
  app.el("alltime-search").value = "  LA TRIP "; app.el("alltime-search").dispatch("input");
  assert.equal(app.el("alltime-list").querySelectorAll(".transaction-row").length, 2);
  assert.match(app.el("alltime-list").textContent, /Helmet/);
  assert.doesNotMatch(app.el("alltime-list").textContent, /Book/);
  assert.equal(app.el("matching-spent").textContent, "$30.00");
  assert.match(app.el("filter-chips").textContent, /Search:.*LA TRIP/);
  const restored = await start(rows, { stored: { filters: { description: "la trip" } } });
  assert.equal(restored.el("alltime-list").querySelectorAll(".transaction-row").length, 2);
  assert.equal(app.writes().length, 0);
});

test("import, history, internal-transfer and unclassified searches all include notes without changing selection or data", async () => {
  const rows = [tx({ _id: 1, _stagedId: 0, _isDuplicate: false, _classificationMatched: false,
    description: "Helmet", notes: "Road\n  trip", subcategory: "" }),
    tx({ _id: 2, _stagedId: 1, _isDuplicate: false, _classificationMatched: false,
      description: "Road trip meal", notes: "Road trip", subcategory: "" }),
    tx({ _id: 3, _stagedId: 2, _isDuplicate: false, _classificationMatched: false,
      description: "Book", notes: null, subcategory: "" })];
  for (const surface of ["upload", "history", "transfers", "classifications"]) {
    const page = ["history", "transfers"].includes(surface) ? "settings" : surface;
    const app = await reviewPageFixture(page, url => surface === "transfers" && url.endsWith("/preview")
      ? { revision: "r1", plan: "p", transactions: rows, alreadyFlagged: [],
        changes: rows.map(transaction => ({ _id: transaction._id, transaction, before: transaction, after: transaction, changedFields: ["flags"] })) }
      : { transactions: rows, revision: "r1", imports: [], classifications: [], categories: [] });
    const [searchId, listId] = surface === "upload" ? ["import-review-search", "import-review-list"]
      : surface === "classifications" ? ["unclassified-search", "unclassified-list"]
        : ["import-history-search", "import-history-transactions"];
    if (surface === "upload") app.run(`renderResult(${JSON.stringify({ parsed: 3, new: 3, duplicates: 0, revision: "r1", transferPlan: "p", transactions: rows })}, "csv", "session")`);
    else if (surface === "classifications") await app.run("openUnclassifiedDialog()");
    else if (surface === "transfers") await app.run("openTransferReview()");
    else await app.run('openImportHistoryBatch({createdAt:"2026-01-01T00:00:00Z"})');
    const requestCount = app.requests.length;
    const input = app.el(searchId); input.value = "ROAD TRIP"; input.dispatch("input");
    const list = app.el(listId);
    assert.equal(list.querySelectorAll(".transaction-row").length, 2, surface);
    assert.match(list.textContent, /Helmet/, surface); assert.doesNotMatch(list.textContent, /Book/, surface);
    assert.equal(app.requests.length, requestCount, "Search must not fetch or write data");
    if (surface === "upload") {
      assert.equal(app.run("state.importedTransactions.filter(row => row._selected).length"), 3);
      assert.equal(app.run("state.reviewEditedIds.size"), 0);
    }
    input.value = ""; input.dispatch("input");
    assert.equal(list.querySelectorAll(".transaction-row").length, 3, surface);
  }
});

test("group filtering includes ungrouped transactions and updates all-time totals", async () => {
  const app = await start([tx({ group: "LA trip", amount: 80 }), tx({ _id: 2, amount: 20 })]);
  const root = app.el("alltime-filter-popover");
  app.el("alltime-filter-button").click();
  const group = root.elements.namedItem("group");
  assert(group && root.contains(group), "Group belongs inside Filters");
  group.value = "LA trip";
  group.dispatch("change");
  assert.equal(app.el("matching-spent").textContent, "$80.00");
  assert.equal(app.el("result-count").textContent, "1–1 of 1");
  assert.equal(app.el("alltime-filter-count").textContent, "1");
  assert.match(app.el("filter-chips").textContent, /Group: LA trip/);
  group.value = "__ledger_no_group__"; group.dispatch("change");
  assert.equal(app.el("matching-spent").textContent, "$20.00");
  assert.match(app.el("filter-chips").textContent, /Group: No group/);
  app.el("reset-alltime-filters").click();
  assert.equal(app.el("matching-spent").textContent, "$100.00");
  assert.equal(app.el("alltime-filter-count").hidden, true);
  assert.equal(app.writes().length, 0);
});

async function stagedList() {
  const app = await start([]);
  const shell = app.document.createElement("section"); app.document.body.append(shell);
  const header = app.document.createElement("header");
  const close = app.document.createElement("button"); close.className = "icon-button"; close.textContent = "Close";
  header.append(close);
  const container = app.document.createElement("div"); shell.append(header, container);
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
    assert.equal(toolbar.hidden, true, "No inactive bulk toolbar");
    const actions = header.querySelector(".transaction-list-header-actions");
    assert.equal(actions.children[0], close, "Close precedes Edit multiple");
    textButton(header, "Edit multiple").click();
    assert.equal(toolbar.hidden, false, "Selection tools appear only in edit mode");
    assert.equal(textButton(toolbar, "Edit selected (0)").disabled, true);
    assert.equal(toolbar.querySelector(".bulk-delete-button").hidden, true, "No database deletion in staged imports");
    textButton(toolbar, "Select visible").click(); textButton(toolbar, "Edit selected (2)").click();
    return app.document.querySelector(".transaction-bulk-dialog");
  }
  return { app, bulk, toolbar, header, rows: () => rows, open };
}

test("every modal keeps Group in Filters and Edit multiple under its close button", async () => {
  const app = await start([]);
  const surfaces = [
    ["index.html", "transaction-list", "transaction-filter-popover", "transaction-group-filter"],
    ["upload.html", "import-review-list", "import-review-filter-popover", "import-review-group-filter"],
    ["settings.html", "import-history-transactions", "import-history-filter-popover", "import-history-group-filter"],
    ["classifications.html", "unclassified-list", "unclassified-filter-popover", "unclassified-group-filter"],
    ["classifications.html", "classification-preview-list", "classification-preview-filters", "classification-preview-group-filter"],
  ];
  for (const [file, listId, popoverId, groupId] of surfaces) {
    const document = parseDocument(read(file));
    const list = document.getElementById(listId);
    const select = document.getElementById(groupId);
    assert(document.getElementById(popoverId).contains(select), file);
    const rows = [tx({group:"LA trip"}), tx({_id:2,group:""}), tx({_id:3,group:"la TRIP"})];
    app.shared.populateGroupFilter(select, rows);
    assert.deepEqual(select.options.map(option => option.textContent), ["All groups", "No group", "LA trip"]);
    let group = "";
    const rowOptions = () => ({currency:new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}),
      shortMonthFormatter:new Intl.DateTimeFormat("en-US",{month:"short"}),onEdit:()=>{}});
    const bulk = app.window.LedgerTransactionBulk.create({container:list,
      getTransactions:()=>rows,getRevision:()=>"test",getGroupFilter:()=>group,
      render:()=>bulk.render(rows,rowOptions)});
    bulk.render(rows,rowOptions);
    const header = list.parentElement.querySelector("header");
    const actions = header.querySelector(".transaction-list-header-actions");
    assert.equal(actions.children[0].className,"icon-button",file);
    assert.equal(actions.children[1].textContent,"Edit multiple",file);
    const toolbar = list.parentElement.querySelector(".transaction-bulk-toolbar");
    assert.equal(toolbar.hidden,true,file);
    assert.equal(toolbar.querySelector("select"),null,file);
    assert.equal(toolbar.querySelector(".bulk-mode-button"),null,file);
    group = "LA trip"; bulk.render(rows,rowOptions); assert.equal(list.children.length,2,file);
    group = "__ledger_no_group__"; bulk.render(rows,rowOptions); assert.equal(list.children.length,1,file);
    textButton(header,"Edit multiple").click(); assert.equal(toolbar.hidden,false,file);
    textButton(toolbar,"Select visible").click(); assert.equal(textButton(toolbar,"Edit selected (1)").disabled,false,file);
    assert.equal(toolbar.querySelector(".bulk-delete-button").hidden, false, file);
    assert.equal(toolbar.querySelector(".bulk-delete-button").disabled, false, file);
    textButton(header,"Done editing").click(); assert.equal(toolbar.hidden,true,file);
  }
});

test("group filters reset pagination, persist, combine with tags, and clear through chips", async () => {
  const rows = Array.from({length:61},(_,i)=>tx({_id:i,group:i<55?"LA trip":"Other trip",amount:10}));
  const app = await start(rows);
  app.el("next-page").click(); assert.match(app.el("page-indicator").textContent,/Page 2/);
  app.el("alltime-filter-button").click();
  const form = app.el("alltime-filter-popover"); form.elements.namedItem("group").value="LA trip"; form.elements.namedItem("group").dispatch("change");
  assert.match(app.el("page-indicator").textContent,/Page 1/);
  assert.equal(app.el("matching-spent").textContent,"$550.00");
  assert.equal(app.el("alltime-list").children.length,50);
  const stored = JSON.parse(app.storage.get("ledger.transactions-view.v1"));
  const restored = await start(rows,{stored}); assert.equal(restored.el("matching-spent").textContent,"$550.00");
  textButton(restored.el("filter-chips"),"Group: LA trip ×").click();
  assert.equal(restored.el("matching-spent").textContent,"$610.00");
  assert.equal(restored.el("alltime-filter-count").hidden,true);
  const combined = await start([...rows,tx({_id:99,group:"LA trip",tags:"apparel",amount:25})],
    {stored:{filters:{group:"LA trip",tags:["apparel"]}}});
  assert.equal(combined.el("matching-spent").textContent,"$25.00");
  combined.el("clear-alltime-filters").click(); assert.equal(combined.el("matching-spent").textContent,"$635.00");
});

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

test("legacy databases offer transfer review instead of silently changing displayed totals", async () => {
  const app = await start([tx()], { transferReviewRequired: true });
  assert.equal(app.document.querySelector(".alltime-summary").hidden, true);
  assert.equal(app.document.querySelector(".alltime-results").hidden, true);
  assert.equal(app.el("matching-scope").querySelector("a").href, "/settings#internal-transfers");
  assert.equal(app.writes().length, 0);
});

async function reviewPageFixture(page, handler) {
  const document = parseDocument(read(`${page}.html`));
  const requests = [];
  const window = { location: { hash: "", origin: "http://ledger.invalid" },
    confirm: () => false,
    history: { replaceState() {} }, addEventListener() {}, setTimeout() {}, clearTimeout() {}, postMessage() {} };
  const context = { document, window, localStorage: { getItem() { return null; }, setItem() {} },
    HTMLInputElement: Input, HTMLSelectElement: Select, URLSearchParams,
    Option: function Option(text, value) { const option = document.createElement("option"); option.textContent = text; option.value = value; return option; },
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      const result = await handler(url, options);
      const status = result?._status || 200;
      return { ok: status < 400, status, json: async () => result || { transactions: [], revision: "r1", imports: [] } };
    },
  };
  vm.createContext(context);
  for (const file of ["transactions-model.js", "transaction-ui.js", "transaction-bulk.js", `${page === "classifications" ? "settings" : page}.js`]) vm.runInContext(read(file), context, { filename: file });
  await flush();
  return { document, window, requests, el: (id) => document.getElementById(id), run: (code) => vm.runInContext(code, context) };
}

test("Walmart tab gates old extensions, preserves account/date inputs and stages shared review", async () => {
  const rows = [tx({_stagedId:0,_isDuplicate:false,description:"Synthetic Walmart item"})];
  const app = await reviewPageFixture("upload", (url, options) => {
    if (url === "/api/walmart-import-sessions") return {token:"walmart-session"};
    if (url.endsWith("/walmart-session")) return {status:"review", progress:98, message:"Review Walmart", import:{
      parsed:1,new:1,duplicates:0,revision:"r1",transferPlan:"p",transactions:rows,
      skippedOrders:1,warnings:["Order 12345: returned/refunded."],
    }};
    return null;
  });
  app.run('setExtensionReady(true,"0.7.0")');
  assert.equal(app.el("walmart-import-button").disabled,true);
  assert.match(app.el("walmart-error").textContent,/0.9.1/);
  app.run('setExtensionReady(true,"0.9.1")');
  assert.equal(app.el("walmart-import-button").disabled,false);
  app.el("walmart-import-tab").click();
  assert.equal(app.el("walmart-import-panel").hidden,false);
  assert.equal(app.el("creditkarma-import-panel").hidden,true);
  app.el("walmart-start-date").value="2026-08-01"; app.el("walmart-end-date").value="2026-08-31";
  app.el("walmart-account-name").value="My selected card";
  await app.run("startWalmartImport()"); await flush();
  assert.equal(JSON.parse(app.requests.find(r=>r.url === "/api/walmart-import-sessions").body).accountName,"My selected card");
  assert.equal(app.el("import-review-dialog").open,true);
  assert.equal(app.el("import-review-eyebrow").textContent,"Walmart import");
  assert.match(app.el("import-review-invalid-note").textContent,/1 Walmart order was not imported/);
  assert.equal(app.el("import-review-list").querySelectorAll(".edit-button").length,1);
  assert.equal(app.requests.some(r=>r.url.endsWith("/commit")),false);
  app.window.confirm = () => true;
  app.el("cancel-import-review").click(); await flush();
  assert.equal(app.el("import-review-dialog").open,false);
  assert.equal(app.requests.some(r=>r.url.endsWith("/cancel")),true);
  assert.equal(app.requests.some(r=>r.url.endsWith("/commit")),false);
});

test("Capital One gates old extensions, keeps account metadata, and uses shared staged review", async () => {
  const rows = [tx({ _stagedId: 0, _isDuplicate: false, description: "Capital One purchase" })];
  const app = await reviewPageFixture("upload", (url) => {
    if (url === "/api/capitalone-import-sessions") return { token: "capital-session" };
    if (url.endsWith("/capital-session")) return { status: "review", progress: 98, import: {
      parsed: 1, new: 1, duplicates: 0, revision: "r1", transferPlan: "p", transactions: rows,
    } };
    return null;
  });
  app.run('setExtensionReady(true,"0.8.0")');
  assert.equal(app.el("capitalone-import-button").disabled, true);
  assert.match(app.el("capitalone-error").textContent, /0.9.1/);
  app.run('setExtensionReady(true,"0.9.1")');
  assert.equal(app.el("capitalone-import-button").disabled, false);
  app.el("capitalone-import-tab").click();
  assert.equal(app.el("capitalone-import-panel").hidden, false);
  assert.equal(app.el("creditkarma-import-panel").hidden, true);
  app.el("capitalone-start-date").value = "2026-08-01";
  app.el("capitalone-end-date").value = "2026-08-31";
  app.el("capitalone-account-name").value = "My Venture";
  await app.run("startCapitalOneImport()"); await flush();
  assert.equal(JSON.parse(app.requests.find((r) => r.url === "/api/capitalone-import-sessions").body).accountName, "My Venture");
  assert.equal(app.el("import-review-dialog").open, true);
  assert.equal(app.el("import-review-eyebrow").textContent, "Capital One import");
  assert.equal(app.el("import-review-list").querySelectorAll(".edit-button").length, 1);
  app.window.confirm = () => true;
  app.el("cancel-import-review").click(); await flush();
  assert.equal(app.requests.some((r) => r.url.endsWith("/cancel")), true);
  assert.equal(app.requests.some((r) => r.url.endsWith("/commit")), false);
});

test("Capital One file action needs a file and cancelling in-flight parsing cannot reopen review", async () => {
  let release;
  const app = await reviewPageFixture("upload", (url) => {
    if (url === "/api/capitalone-import-sessions") return { token: "file-session" };
    if (url.endsWith("/complete")) return new Promise((resolve) => { release = resolve; });
    return { status: "cancelled" };
  });
  const button = app.el("capitalone-file-import-button");
  assert.equal(button.disabled, true);
  app.el("capitalone-start-date").value = "2026-08-01";
  app.el("capitalone-end-date").value = "2026-08-31";
  app.el("capitalone-file").files = [{ name: "capital.csv", size: 200, text: async () => "synthetic CSV" }];
  app.el("capitalone-file").dispatch("change");
  assert.equal(button.disabled, false);
  const importing = app.run("importCapitalOneFile()"); await flush();
  assert.equal(button.disabled, true);
  await app.run("cancelCapitalOneImport()");
  release({ status: "review", import: { parsed: 0, new: 0, duplicates: 0, revision: "r1", transactions: [] } });
  await importing;
  assert.equal(app.el("import-review-dialog").open, false);
  assert.equal(app.requests.some((r) => r.url.endsWith("/commit")), false);
});

test("Credit Karma sends the default Walmart filter and cancelled Walmart polling cannot reopen review", async () => {
  let release;
  const app = await reviewPageFixture("upload", (url) => {
    if (url === "/api/creditkarma-import-sessions") return {token:"ck"};
    if (url.endsWith("/old-walmart")) return new Promise(resolve=>{release=resolve;});
    return {status:"cancelled"};
  });
  assert.equal(app.el("creditkarma-ignore-walmart").checked,true);
  app.run('setExtensionReady(true,"0.8.0")');
  await app.run("startCreditKarmaImport()");
  assert.equal(JSON.parse(app.requests.find(r=>r.url === "/api/creditkarma-import-sessions").body).ignoreWalmart,true);
  app.run('state.walmartSessionToken="old-walmart"; state.walmartBusy=true; state.walmartStartedAt=Date.now()');
  const polling=app.run('pollWalmartSession("old-walmart")');
  await app.run("cancelWalmartImport()");
  release({status:"review",import:{parsed:0,new:0,duplicates:0,revision:"r1",transferPlan:"p",transactions:[]}});
  await polling;
  assert.equal(app.el("import-review-dialog").open,false);
  assert.equal(app.run("state.walmartSessionToken"),"");
});

test("Credit Karma lets users turn off the default Walmart exclusion", async () => {
  const app = await reviewPageFixture("upload", (url) => {
    if (url === "/api/creditkarma-import-sessions") return {token:"ck"};
    return {status:"cancelled"};
  });
  assert.equal(app.el("creditkarma-ignore-walmart").checked, true);
  app.el("creditkarma-ignore-walmart").checked = false;
  app.run('setExtensionReady(true,"0.9.1")');
  await app.run("startCreditKarmaImport()");
  const request = app.requests.find(r => r.url === "/api/creditkarma-import-sessions");
  assert.equal(JSON.parse(request.body).ignoreWalmart, false);
});

test("history and unclassified single editors have identical fields and remain available during bulk selection", async () => {
  const editorBlock = (page) => read(page).replace(/\r\n/g,"\n").match(/<dialog class="transaction-form-dialog" id="import-history-edit-dialog">[^]*?<\/dialog>/)[0];
  assert.equal(editorBlock("classifications.html"), editorBlock("settings.html"));
  for (const [page, prefix, listId, open] of [
    ["settings", "import-history", "import-history-transactions", 'openImportHistoryBatch({createdAt:"2026-01-01T00:00:00Z"})'],
    ["classifications", "unclassified", "unclassified-list", "openUnclassifiedDialog()"],
  ]) {
    for (const bulk of [false, true]) {
      let rows = [tx({_id:0, subcategory:"", description:"Helmet", flags:"custom,refunded", group:"Bike build"})];
      const app = await reviewPageFixture(page, (url, options) => {
        if (options.method === "PUT") {
          const body = JSON.parse(options.body);
          assert.equal(url, "/api/transactions/0"); assert.equal(body.revision, "r1");
          assert.equal(body.transaction.flags, "custom,refunded");
          assert.equal(body.transaction.group, "Bike build");
          assert.equal(body.transaction.tags, "bike");
          assert.equal(body.transaction.date, rows[0].date);
          assert.equal(Number(body.transaction.amount), rows[0].amount);
          assert.equal("createdAt" in body.transaction, false);
          rows = [{...rows[0], ...body.transaction}];
          return {transactions:rows, revision:"r2", imports:[]};
        }
        return {transactions:rows, revision:"r1", classifications:[], imports:[]};
      });
      await app.run(open);
      const dialog = app.el(`${prefix}-dialog`); const list = app.el(listId);
      app.el(`${prefix}-search`).value = "Helmet"; app.el(`${prefix}-search`).dispatch("input");
      if (bulk) { textButton(dialog,"Edit multiple").click(); textButton(dialog,"Select visible").click(); }
      assert.equal(list.querySelectorAll(".edit-button").length,1);
      list.querySelector(".edit-button").click();
      assert.equal(dialog.open,false);
      assert.equal(app.el("import-history-edit-dialog").open,true);
      const form = app.el("import-history-edit-form");
      assert.equal(form.elements.namedItem("refunded").checked,true);
      form.elements.namedItem("notes").value = "Individually reviewed";
      form.dispatch("submit"); await flush();
      assert.equal(app.requests.filter(request=>request.method === "PUT").length,1);
      assert.equal(rows[0].notes,"Individually reviewed");
      assert.equal(dialog.open,true);
      assert.equal(app.el("import-history-edit-dialog").open,false);
      assert.equal(app.el(`${prefix}-search`).value,"Helmet");
      assert.equal(list.querySelectorAll(".edit-button").length,1);
      assert.equal(list.querySelectorAll(".bulk-row-selection").length,0,"Saved revisions reset bulk selection");
    }
  }
});

test("unclassified Save removes newly classified rows but preserves filters, sort and classification drafts", async () => {
  const rows = [tx({_id:0, subcategory:"", description:"Helmet"}), tx({_id:1, subcategory:"", description:"Jersey"}),
    tx({_id:2, subcategory:"Lodging", description:"Hotel", tags:"travel"})];
  const app = await reviewPageFixture("classifications", (_url, options) => ({
    transactions: options.method === "PUT" ? [{...rows[0],...JSON.parse(options.body).transaction},...rows.slice(1)] : rows,
    revision: options.method === "PUT" ? "r2" : "r1", classifications:[], imports:[],
  }));
  await app.run("openUnclassifiedDialog()");
  app.run('classificationEdit = {draft:{category:"Unsaved classification"}}; ruleEdits.set("rule",{draft:{description:"Unsaved regex"}})');
  app.el("unclassified-category-filter").value="Shopping";
  app.el("unclassified-category-filter").dispatch("change");
  const sort = app.el("unclassified-sort").querySelector("select"); sort.value="description:asc"; sort.dispatch("change");
  const sortBefore = app.run("JSON.stringify(unclassifiedSort.value())");
  app.el("unclassified-list").querySelector('[aria-label="Edit Helmet"]').click();
  const form=app.el("import-history-edit-form");
  assert.match(form.querySelector("[data-tag-controls]").textContent,/travel/,"Include tags from already-classified rows");
  form.elements.namedItem("subcategory").value="Equipment";
  form.dispatch("submit"); await flush();
  assert.equal(app.el("unclassified-dialog").open,true);
  assert.doesNotMatch(app.el("unclassified-list").textContent,/Helmet/);
  assert.match(app.el("unclassified-list").textContent,/Jersey/);
  assert.equal(app.el("unclassified-category-filter").value,"Shopping");
  assert.equal(app.run("JSON.stringify(unclassifiedSort.value())"),sortBefore);
  assert.equal(app.run("classificationEdit.draft.category"),"Unsaved classification");
  assert.equal(app.run('ruleEdits.get("rule").draft.description'),"Unsaved regex");
  assert.equal(app.requests.some(request=>request.url === "/api/classifications" && request.method === "PUT"),false);
});

test("unclassified editor Cancel, X, Escape and backdrop preserve drafts, bulk selection and the originating list", async () => {
  for (const bulk of [false,true]) for (const how of ["cancel","x","escape","backdrop"]) {
    const app=await reviewPageFixture("classifications",()=>({transactions:[tx({subcategory:""})],revision:"r1",classifications:[]}));
    await app.run("openUnclassifiedDialog()");
    const listDialog=app.el("unclassified-dialog");
    if (bulk) { textButton(listDialog,"Edit multiple").click(); textButton(listDialog,"Select visible").click(); }
    app.el("unclassified-list").querySelector(".edit-button").click();
    app.el("import-history-edit-form").elements.namedItem("notes").value="Do not save";
    const dialog=app.el("import-history-edit-dialog");
    if(how === "cancel") app.el("cancel-import-history-edit").click();
    if(how === "x") app.el("close-import-history-edit").click();
    if(how === "escape") dialog.dispatch("cancel");
    if(how === "backdrop") dialog.dispatch("click");
    assert.equal(dialog.open,false,how); assert.equal(listDialog.open,true,how);
    if(bulk) assert.equal(textButton(listDialog,"Edit selected (1)").disabled,false,how);
    assert.equal(app.requests.some(request=>request.method && request.method !== "GET"),false,how);
    app.el("unclassified-list").querySelector(".edit-button").click();
    assert.equal(app.el("import-history-edit-form").elements.namedItem("notes").value,"Initial note",how);
  }
});

test("unclassified stale saves use the opening revision and keep the draft open without replacing loaded data", async () => {
  const app=await reviewPageFixture("classifications",(_url,options)=>options.method === "PUT"
    ? {_status:409,error:"Transactions changed. Reopen and try again."}
    : {transactions:[tx({subcategory:""})],revision:"r1",classifications:[]});
  await app.run("openUnclassifiedDialog()");
  app.el("unclassified-list").querySelector(".edit-button").click();
  app.run('unclassifiedRevision="r2"');
  const form=app.el("import-history-edit-form"); form.elements.namedItem("notes").value="Keep draft";
  form.dispatch("submit"); form.dispatch("submit"); await flush();
  const writes=app.requests.filter(request=>request.method === "PUT");
  assert.equal(writes.length,1,"Ignore a second submit while saving");
  assert.equal(JSON.parse(writes[0].body).revision,"r1");
  assert.equal(app.el("import-history-edit-dialog").open,true);
  assert.equal(app.el("unclassified-dialog").open,false);
  assert.equal(form.elements.namedItem("notes").value,"Keep draft");
  assert.match(app.el("import-history-edit-error").textContent,/Transactions changed/);
  assert.equal(app.run("unclassifiedTransactions[0].notes"),"Initial note");
});

test("import row editing remains staged during bulk selection and retains independent selection controls", async () => {
  const rows=[tx({_stagedId:0,_isDuplicate:false})];
  const app=await reviewPageFixture("upload",(url,options)=>url.endsWith("staged-preview")
    ? {transactions:JSON.parse(options.body).transactions,new:1,duplicates:0,transferPlan:"p",existingTransferUpdates:[]} : null);
  app.run(`renderResult(${JSON.stringify({parsed:1,new:1,duplicates:0,revision:"r1",transferPlan:"p",transactions:rows})},"csv","session")`);
  const dialog=app.el("import-review-dialog"); textButton(dialog,"Edit multiple").click();
  textButton(dialog,"Select visible").click();
  app.el("import-review-list").querySelector(".edit-button").click();
  app.el("import-edit-form").elements.namedItem("notes").value="Staged single edit";
  app.el("import-edit-form").dispatch("submit"); await flush();
  assert.equal(dialog.open,true);
  assert.equal(app.run("state.importedTransactions[0].notes"),"Staged single edit");
  assert.equal(textButton(dialog,"Edit selected (1)").disabled,false);
  assert.equal(app.el("confirm-import-review").disabled,true);
  assert.equal(app.requests.some(request=>request.method === "PUT" || request.url.endsWith("/commit")),false);
});

test("shared history and unclassified modal filters update immediately without saving data", async () => {
  const rows = [tx({ _id: 1, description: "Trip hotel", category: "Travel", subcategory: "", group: "LA", tags: "bike" }),
    tx({ _id: 2, description: "Dinner", category: "Food", subcategory: "", tags: "apparel" })];
  for (const [page, prefix, open] of [
    ["settings", "import-history", 'openImportHistoryBatch({createdAt:"2026-09-01T00:00:00Z"})'],
    ["classifications", "unclassified", "openUnclassifiedDialog()"],
  ]) {
    const app = await reviewPageFixture(page, () => ({transactions: rows, revision:"r1", imports:[], classifications:[]}));
    await app.run(open);
    const list = app.el(prefix === "import-history" ? "import-history-transactions" : "unclassified-list");
    app.el(`${prefix}-filter-button`).click();
    const category = app.el(`${prefix}-category-filter`);
    category.value = "Travel"; category.dispatch("change");
    assert.match(list.textContent, /Trip hotel/, page);
    assert.doesNotMatch(list.textContent, /Dinner/, page);
    assert.equal(app.el(`${prefix}-filter-popover`).hidden, false, page);
    app.el(`reset-${prefix}-filters`).click();
    assert.match(list.textContent, /Dinner/, page);
    assert.equal(app.requests.some((request) => request.method && request.method !== "GET"), false, page);
  }
});

test("live import filters preserve inclusion and never commit or revalidate the import", async () => {
  const rows = [tx({ _stagedId: 0, _isDuplicate: false, description: "Trip hotel", category: "Travel" }),
    tx({ _id: 2, _stagedId: 1, _isDuplicate: true, description: "Dinner", category: "Food" })];
  const app = await reviewPageFixture("upload", () => null);
  app.run(`renderResult(${JSON.stringify({parsed:2,new:1,duplicates:1,revision:"r1",transferPlan:"p",transactions:rows})}, "csv", "session")`);
  const requestsBefore = app.requests.length;
  const inclusionBefore = app.run("JSON.stringify(state.importedTransactions.map(row=>row._selected))");
  app.el("import-review-filter-button").click();
  const category = app.el("import-review-category-filter");
  category.value = "Food"; category.dispatch("change");
  assert.doesNotMatch(app.el("import-review-list").textContent, /Trip hotel/);
  assert.equal(app.el("import-review-filter-popover").hidden, false);
  app.el("reset-import-review-filters").click();
  assert.match(app.el("import-review-list").textContent, /Trip hotel/);
  assert.equal(app.run("JSON.stringify(state.importedTransactions.map(row=>row._selected))"), inclusionBefore);
  assert.equal(app.requests.length, requestsBefore);
});

test("import history and Review unclassified share confirmed deletion and refresh their lists", async () => {
  for (const [page, dialogId, open] of [
    ["settings", "import-history-dialog", 'openImportHistoryBatch({createdAt:"2026-01-01T00:00:00Z"})'],
    ["classifications", "unclassified-dialog", "openUnclassifiedDialog()"],
  ]) {
    const rows = [tx({_id:0, subcategory:"", description:"Remove me"})];
    const app = await reviewPageFixture(page, (url) => url === "/api/transactions/bulk-delete"
      ? {transactions:[],revision:"r2",deleted:1,backup:"synthetic.csv",imports:[]}
      : {transactions:rows,revision:"r1",imports:[{createdAt:rows[0].createdAt,transactionCount:1}],classifications:[]});
    await app.run(open);
    const listDialog = app.el(dialogId);
    textButton(listDialog,"Edit multiple").click(); textButton(listDialog,"Select visible").click();
    textButton(listDialog,"Delete selected (1)").click();
    const confirmDialog = app.document.querySelector(".bulk-delete-dialog");
    assert.equal(app.requests.some(request=>request.url.endsWith("/bulk-delete")),false,page);
    textButton(confirmDialog,"Delete permanently (1)").click(); await flush();
    assert.equal(confirmDialog.open,false,page);
    assert.equal(listDialog.open,true,page);
    assert.doesNotMatch(listDialog.textContent,/Remove me/,page);
    const writes = app.requests.filter(request=>request.url.endsWith("/bulk-delete"));
    assert.equal(writes.length,1,page);
    assert.deepEqual(JSON.parse(writes[0].body),{ids:[0],revision:"r1",confirm:true});
    if(page==="settings") assert.equal(app.run("state.importHistoryImports.length"),0);
  }
});

test("staged import and classification reviews never expose database deletion", async () => {
  const original = tx({_stagedId:0, _isDuplicate:false});
  const imported = await reviewPageFixture("upload",()=>null);
  imported.run(`renderResult(${JSON.stringify({parsed:1,new:1,duplicates:0,revision:"r1",transferPlan:"p",transactions:[original]})},"csv","session")`);
  const source = imported.el("import-review-dialog");
  textButton(source,"Edit multiple").click(); textButton(source,"Select visible").click();
  assert.equal(source.querySelector(".bulk-delete-button").hidden,true);
  assert.equal(source.querySelector(".bulk-delete-button").disabled,true);
  const classification = await reviewPageFixture("classifications",()=>({classifications:[]}));
  classification.run(`pendingClassificationPreview = ${JSON.stringify({revision:"r1",changes:[{...original,transaction:original,beforeTransaction:original,changedFields:[]}]})}; renderClassificationPreviewChanges();`);
  const preview = classification.el("classification-preview-dialog");
  textButton(preview,"Edit multiple").click(); textButton(preview,"Select visible").click();
  assert.equal(preview.querySelector(".bulk-delete-button").hidden,true);
  assert.equal(preview.querySelector(".bulk-delete-button").disabled,true);
});

test("import selection revalidates matches, disables confirmation while pending, and ignores late results", async () => {
  const pending = [];
  const app = await reviewPageFixture("upload", (url, options) => {
    if (url.endsWith("staged-preview")) return new Promise((resolve) => pending.push({ resolve, rows: JSON.parse(options.body).transactions }));
  });
  const rows = [tx({ _stagedId: 0, _isDuplicate: false, _classificationMatched: false })];
  app.run(`renderResult(${JSON.stringify({ parsed: 1, new: 1, duplicates: 0, revision: "r1", transferPlan: "initial", transactions: rows })}, "csv", "session")`);
  const checkbox = app.el("import-review-list").querySelector("input");
  checkbox.checked = false; checkbox.dispatch("change");
  assert.equal(app.el("confirm-import-review").disabled, true);
  checkbox.checked = true; checkbox.dispatch("change");
  assert.equal(pending.length, 2);
  pending[1].resolve({ transactions: pending[1].rows, new: 1, duplicates: 0, transferPlan: "latest", existingTransferUpdates: [] });
  await flush();
  assert.equal(app.el("confirm-import-review").disabled, false);
  pending[0].resolve({ transactions: pending[0].rows, new: 1, duplicates: 0, transferPlan: "stale" });
  await flush();
  assert.equal(app.run("state.transferPlan"), "latest");
  assert.equal(app.run("state.importedTransactions[0]._selected"), true);
  assert.equal(app.requests.filter((request) => request.url.endsWith("/commit")).length, 0);
});

test("import Cancel, X, Escape and backdrop never confirm a pending transfer proposal", async () => {
  for (const how of ["cancel", "x", "escape", "backdrop"]) {
    const app = await reviewPageFixture("upload", () => null);
    app.window.confirm = () => true;
    app.run(`renderResult(${JSON.stringify({ parsed: 1, new: 1, duplicates: 0, revision: "r1", transferPlan: "pending", transactions: [tx({ _stagedId: 0 })] })}, "csv", "session")`);
    if (how === "cancel") app.el("cancel-import-review").click();
    if (how === "x") app.el("close-import-review").click();
    if (how === "escape") app.el("import-review-dialog").dispatch("cancel");
    if (how === "backdrop") app.el("import-review-dialog").dispatch("click");
    await flush();
    assert.equal(app.el("import-review-dialog").open, false, how);
    assert.equal(app.run("state.transferPlan"), null, how);
    assert.equal(app.requests.filter((request) => request.url.endsWith("/commit")).length, 0, how);
  }
});

function dismissImportReview(app, how) {
  if (how === "cancel") app.el("cancel-import-review").click();
  if (how === "x") app.el("close-import-review").click();
  if (how === "escape") app.el("import-review-dialog").dispatch("cancel");
  if (how === "backdrop") app.el("import-review-dialog").dispatch("click");
}

test("all sources ask before discarding a nonempty review and keep all state when declined", async () => {
  for (const source of ["creditkarma", "amazon", "aliexpress", "venmo", "ebay", "walmart", "applecard", "capitalone", "csv"]) {
    for (const how of ["cancel", "x", "escape", "backdrop"]) {
      const app = await reviewPageFixture("upload", () => null);
      const data = { parsed: 1, new: 1, duplicates: 0, revision: "r1", transferPlan: "p",
        transactions: [tx({ _stagedId: 0, _classificationMatched: false })] };
      app.run(`renderResult(${JSON.stringify(data)}, "${source}", "session");
        state.importedTransactions[0]._selected = false;
        state.importedTransactions[0].notes = "Reviewed manually";
        state.reviewEditedIds.add(0);
        state.reviewFieldFilters.description = "Bike"; renderImportedTransactions();`);
      const before = app.run("JSON.stringify([state.importedTransactions, state.reviewFieldFilters, state.reviewFilters, [...state.reviewEditedIds], state.reviewSession, state.transferPlan, state.reviewGeneration])");
      const prompts = [];
      app.window.confirm = (message) => { prompts.push(message); return false; };
      dismissImportReview(app, how); await flush();
      assert.equal(prompts.length, 1, `${source}: ${how}`);
      assert.match(prompts[0], /Discard this import review/);
      assert.equal(app.el("import-review-dialog").open, true);
      assert.equal(app.run("JSON.stringify([state.importedTransactions, state.reviewFieldFilters, state.reviewFilters, [...state.reviewEditedIds], state.reviewSession, state.transferPlan, state.reviewGeneration])"), before);
      assert.equal(app.requests.some(r => r.url.endsWith("/cancel") || r.url.endsWith("/commit")), false);
      app.window.confirm = () => true;
      dismissImportReview(app, how); await flush();
      assert.equal(app.el("import-review-dialog").open, false);
      assert.equal(app.run("state.reviewEditedIds.size"), 0);
      assert.equal(app.requests.filter(r => r.url === `/api/${source}-import-sessions/session/cancel`).length, 1);
      assert.equal(app.requests.some(r => r.url.endsWith("/commit")), false);
    }
  }
});

test("empty and committed reviews close quietly, while an in-flight commit cannot be discarded", async () => {
  for (const kind of ["empty", "committed", "committing"]) {
    const app = await reviewPageFixture("upload", () => null);
    const rows = kind === "empty" ? [] : [tx({ _stagedId: 0 })];
    app.run(`renderResult(${JSON.stringify({ parsed: rows.length, new: rows.length, duplicates: 0, revision: "r1", transferPlan: "p", transactions: rows })}, "csv", "session");
      state.reviewCommitted = ${kind === "committed"}; state.reviewCommitting = ${kind === "committing"};`);
    app.window.confirm = () => { assert.fail("Must not ask to discard this review"); };
    dismissImportReview(app, "escape"); await flush();
    assert.equal(app.el("import-review-dialog").open, kind === "committing", kind);
    assert.equal(app.requests.some(r => r.url.endsWith("/cancel")), kind === "empty", kind);
  }
});

async function editableImportFixture(rows, response) {
  const app = await reviewPageFixture("upload", (url, options) => {
    if (url.endsWith("staged-preview")) {
      const transactions = JSON.parse(options.body).transactions;
      return response ? response(transactions) : { transactions, new: rows.length, duplicates: 0, transferPlan: "updated" };
    }
  });
  app.run(`renderResult(${JSON.stringify({ parsed: rows.length, new: rows.length, duplicates: 0, revision: "r1", transferPlan: "p", transactions: rows })}, "csv", "session")`);
  return app;
}

test("successful single edits mark only that occurrence and survive revalidation without becoming saved tags", async () => {
  const rows = [0, 1].map(_stagedId => tx({ _stagedId, _isDuplicate: false, _classificationMatched: false }));
  const app = await editableImportFixture(rows);
  app.window.confirm = () => { assert.fail("Opening or returning from an editor is not discard"); };
  app.el("import-review-list").querySelector(".edit-button").click();
  const form = app.el("import-edit-form"); form.elements.namedItem("notes").value = "Manually checked";
  form.dispatch("submit"); await flush();
  assert.equal(app.el("import-review-dialog").open, true);
  const rendered = app.el("import-review-list").querySelectorAll(".transaction-row");
  assert.equal(rendered[0].querySelector(".transaction-edited-badge").textContent, "Edited");
  assert.notEqual(rendered[0].querySelector(".classification-needed-badge"), null);
  assert.equal(rendered[1].querySelector(".transaction-edited-badge"), null);
  app.run('state.reviewFilters.unmatched = false; renderImportedTransactions(); state.reviewFilters.unmatched = true; renderImportedTransactions();');
  const checkbox = app.el("import-review-list").querySelector("input");
  checkbox.checked = false; checkbox.dispatch("change"); await flush();
  assert.equal(app.el("import-review-list").querySelectorAll(".transaction-edited-badge").length, 1);
  assert.equal(app.run("state.reviewEditedIds.size"), 1);
  assert.equal(app.run("state.importedTransactions[0]._selected"), false);
  for (const request of app.requests.filter(r => r.url.endsWith("staged-preview"))) {
    const outgoing = JSON.parse(request.body).transactions;
    assert.equal(outgoing[0].tags, "bike"); assert.equal(outgoing[0].flags, "");
    assert.doesNotMatch(request.body, /reviewEditedIds|_edited|_reviewEdited/);
  }
  assert.equal(app.requests.some(r => r.url.endsWith("/commit") || r.method === "PUT"), false);
  app.run(`renderResult(${JSON.stringify({ parsed: 2, new: 2, duplicates: 0, revision: "r1", transferPlan: "p", transactions: rows })}, "csv", "new-session")`);
  assert.equal(app.el("import-review-list").querySelectorAll(".transaction-edited-badge").length, 0);
});

test("no-op, failed and cancelled edits never earn the Edited badge", async () => {
  let fail = false;
  const app = await editableImportFixture([tx({ _stagedId: 0, _classificationMatched: false })], transactions => fail
    ? { _status: 409, error: "Validation failed" } : { transactions, new: 1, duplicates: 0, transferPlan: "p" });
  app.el("import-review-list").querySelector(".edit-button").click();
  const form = app.el("import-edit-form");
  form.dispatch("submit"); await flush();
  assert.equal(app.run("state.reviewEditedIds.size"), 0, "No-op saves aren't edits");
  app.el("import-review-list").querySelector(".edit-button").click();
  form.elements.namedItem("notes").value = "Invalid draft"; fail = true;
  form.dispatch("submit"); await flush();
  assert.equal(app.el("import-edit-dialog").open, true);
  assert.equal(app.run("state.reviewEditedIds.size"), 0);
  app.el("cancel-import-edit").click();
  assert.equal(app.el("import-review-dialog").open, true);
  assert.equal(app.run("state.importedTransactions[0].notes"), "Initial note");
  assert.equal(app.el("import-review-list").querySelector(".transaction-edited-badge"), null);
});

test("bulk edits mark changed occurrences only and preserve duplicate, refund and transfer badges", async () => {
  const rows = [tx({ _stagedId: 0, _isDuplicate: true, _classificationMatched: false, flags: "refunded", notes: "Before" }),
    tx({ _stagedId: 1, flags: "internal-transfer", notes: "Before" }),
    tx({ _stagedId: 2, notes: "After" })];
  const app = await editableImportFixture(rows);
  app.run("state.reviewFilters.duplicate = true; renderImportedTransactions()");
  const source = app.el("import-review-dialog");
  textButton(source, "Edit multiple").click(); textButton(source, "Select visible").click();
  textButton(source, "Edit selected (3)").click();
  const editor = app.document.querySelector(".transaction-bulk-dialog");
  const add = editor.querySelector(".bulk-add-field"); add.value = "notes"; add.dispatch("change");
  editor.querySelector("textarea").value = "After";
  editor.querySelector("form").dispatch("submit"); await flush();
  assert.equal(app.run("state.reviewEditedIds.size"), 0, "Bulk preview is not a saved edit");
  editor.querySelector("form").dispatch("submit"); await flush();
  assert.equal(app.run("state.reviewEditedIds.size"), 2);
  const list = app.el("import-review-list");
  assert.equal(list.querySelectorAll(".transaction-edited-badge").length, 2);
  assert.notEqual(list.querySelector(".duplicate-badge"), null);
  assert.notEqual(list.querySelector(".classification-needed-badge"), null);
  assert.notEqual(list.querySelector(".transaction-flag--refunded"), null);
  assert.notEqual(list.querySelector(".transaction-flag--internal-transfer"), null);
  assert.equal(app.run("state.importedTransactions[0]._selected"), false, "Edited duplicates remain unchecked after bulk changes");
  assert.equal(app.requests.some(r => r.url.endsWith("/commit")), false);
});

test("existing-side transfer updates remain visible even when all incoming type filters are off", async () => {
  const app = await reviewPageFixture("upload", () => null);
  const data = { parsed: 1, new: 1, duplicates: 0, revision: "r1", transferPlan: "p",
    existingTransferUpdates: [tx({ description: "Existing savings transfer", _isInternalTransfer: true })],
    transactions: [tx({ _stagedId: 0, _isDuplicate: false, _classificationMatched: false })] };
  app.run(`renderResult(${JSON.stringify(data)}, "csv", "session"); state.reviewFilters = {new:false, unmatched:false, duplicate:false}; renderImportedTransactions();`);
  assert.match(app.el("import-review-list").textContent, /Existing savings transfer/);
  assert.match(app.el("import-review-list").textContent, /Only their transfer flags change/);
});

test("Settings transfer review reuses shared filters and stages edits until its own confirmation", async () => {
  const original = tx({ flags: "", _isInternalTransfer: true });
  const app = await reviewPageFixture("settings", (url, options) => {
    if (url.endsWith("/preview")) {
      const override = JSON.parse(options.body).overrides?.[0];
      const transaction = override || original;
      return { revision: "r1", plan: "p", transferPairs: 1, transactions: [transaction], alreadyFlagged: [],
        changes: [{ _id: transaction._id, transaction, before: original, after: { ...transaction, flags: "internal-transfer" }, changedFields: ["flags"] }] };
    }
  });
  await app.run("openTransferReview()");
  assert.equal(app.el("import-history-dialog").open, true);
  assert.equal(app.el("import-history-filter-button").textContent.includes("Filters"), true);
  await app.run('openImportHistoryTransactionEditor(state.importHistoryTransactions[0])');
  app.el("import-history-edit-form").elements.namedItem("notes").value = "Draft only";
  app.el("import-history-edit-form").dispatch("submit"); await flush();
  assert.equal(app.el("import-history-dialog").open, true);
  assert.equal(app.run("state.transferReview.overrides[0].notes"), "Draft only");
  app.el("cancel-transfer-review").click();
  assert.equal(app.run("state.transferReview"), null);
  assert.equal(app.requests.some((request) => request.method === "PUT" || request.url.endsWith("/confirm")), false);
});

test("all Settings transfer-review dismissal paths discard the proposal without confirming", async () => {
  for (const how of ["cancel", "x", "escape", "backdrop"]) {
    const app = await reviewPageFixture("settings", (url) => url.endsWith("/preview")
      ? { revision: "r1", plan: "p", transferPairs: 0, transactions: [], changes: [], alreadyFlagged: [] } : null);
    await app.run("openTransferReview()");
    if (how === "cancel") app.el("cancel-transfer-review").click();
    if (how === "x") app.el("close-import-history-dialog").click();
    if (how === "escape") app.el("import-history-dialog").dispatch("cancel");
    if (how === "backdrop") app.el("import-history-dialog").dispatch("click");
    assert.equal(app.el("import-history-dialog").open, false, how);
    assert.equal(app.run("state.transferReview"), null, how);
    assert.equal(app.requests.some((request) => request.url.endsWith("/confirm")), false, how);
  }
});

test("Settings Edit multiple uses staged bulk editing, not the live transaction bulk endpoint", async () => {
  const original = tx({ _isInternalTransfer: true });
  const app = await reviewPageFixture("settings", (url, options) => {
    if (!url.endsWith("/preview")) return null;
    const transaction = JSON.parse(options.body).overrides?.[0] || original;
    return { revision: "r1", plan: "p", transferPairs: 1, transactions: [transaction], alreadyFlagged: [],
      changes: [{ _id: transaction._id, transaction, before: original, after: transaction, changedFields: [] }] };
  });
  await app.run("openTransferReview()");
  const list = app.el("import-history-dialog");
  textButton(list, "Edit multiple").click();
  assert.equal(list.querySelector(".bulk-delete-button").hidden, true, "Transfer review cannot bypass staged confirmation");
  textButton(list, "Select visible").click();
  textButton(list, "Edit selected (1)").click();
  const dialog = app.document.querySelector(".transaction-bulk-dialog");
  const add = dialog.querySelector(".bulk-add-field"); add.value = "notes"; add.dispatch("change");
  dialog.querySelector("textarea").value = "Staged bulk note";
  dialog.querySelector("form").dispatch("submit"); await flush();
  dialog.querySelector("form").dispatch("submit"); await flush();
  assert.equal(app.run("state.transferReview.overrides[0].notes"), "Staged bulk note");
  assert.equal(app.requests.some((request) => request.url.includes("/transactions/bulk") || request.url.endsWith("/confirm")), false);
});

test("transfer type toggles filter saved flags without changing the proposal or import history", async () => {
  const proposed = tx({ _id: 1, description: "New transfer", _isInternalTransfer: true });
  const saved = tx({ _id: 2, description: "Saved transfer", flags: "internal-transfer", _isInternalTransfer: true });
  const app = await reviewPageFixture("settings", (url) => url.endsWith("/preview")
    ? { revision: "r1", plan: "p", transferPairs: 1, transactions: [proposed],
        changes: [{ _id: 1, changedFields: [] }], alreadyFlagged: [saved] }
    : { transactions: [saved], revision: "r1" });
  await app.run("openTransferReview()");
  const list = app.el("import-history-transactions");
  const flaggedButton = app.el("transfer-review-flagged-filter");
  const proposedButton = app.el("transfer-review-proposed-filter");
  assert.equal(flaggedButton.getAttribute("aria-pressed"), "false");
  assert.match(flaggedButton.textContent, /Already flagged \(1\)/);
  assert.match(list.textContent, /New transfer/);
  assert.doesNotMatch(list.textContent, /Saved transfer/);
  const requestCount = app.requests.length;
  flaggedButton.click();
  assert.equal(flaggedButton.getAttribute("aria-pressed"), "true");
  assert.match(list.textContent, /Saved transfer/);
  proposedButton.click();
  assert.doesNotMatch(list.textContent, /New transfer/);
  assert.match(list.textContent, /Saved transfer/);
  app.el("import-history-search").value = "does not match";
  app.el("import-history-search").dispatch("input");
  assert.match(list.textContent, /No transactions match/);
  assert.equal(app.run("state.transferReview.changes.length"), 1);
  assert.equal(app.el("confirm-transfer-review").textContent, "Save reviewed changes (1)");
  assert.equal(app.requests.length, requestCount);
  app.el("cancel-transfer-review").click();
  assert.equal(app.el("transfer-review-filters").hidden, true);
  await app.run("openTransferReview()");
  assert.equal(flaggedButton.getAttribute("aria-pressed"), "false");
  assert.equal(proposedButton.getAttribute("aria-pressed"), "true");
  await app.run('openImportHistoryBatch({createdAt:"2026-09-01T00:00:00Z"})');
  assert.equal(app.el("transfer-review-filters").hidden, true);
  assert.match(list.textContent, /Saved transfer/);
});

test("editing an already flagged transfer becomes a staged proposal, not a live write", async () => {
  const saved = tx({ _id: 2, description: "Saved transfer", flags: "internal-transfer", _isInternalTransfer: true });
  const app = await reviewPageFixture("settings", (url, options) => {
    if (!url.endsWith("/preview")) return null;
    const override = JSON.parse(options.body).overrides?.[0];
    return { revision: "r1", plan: override ? "edited" : "p", transferPairs: 0,
      transactions: override ? [override] : [], alreadyFlagged: override ? [] : [saved],
      changes: override ? [{ _id: 2, before: saved, after: override, changedFields: ["notes"] }] : [] };
  });
  await app.run("openTransferReview()");
  const list = app.el("import-history-transactions");
  assert.match(list.textContent, /Turn on Already flagged/);
  assert.equal(app.el("confirm-transfer-review").textContent, "Finish review");
  app.el("transfer-review-flagged-filter").click();
  textButton(list, "Edit").click();
  app.el("import-history-edit-form").elements.namedItem("notes").value = "Staged saved-transfer note";
  app.el("import-history-edit-form").dispatch("submit"); await flush();
  assert.match(list.textContent, /Staged saved-transfer note/);
  assert.equal(app.el("confirm-transfer-review").textContent, "Save reviewed changes (1)");
  assert.equal(app.el("transfer-review-flagged-filter").textContent, "Already flagged (0)");
  assert.equal(app.el("transfer-review-proposed-filter").textContent, "Proposed changes (1)");
  app.el("cancel-transfer-review").click();
  assert.equal(app.requests.some((request) => request.method === "PUT" || request.url.endsWith("/confirm")), false);
});
