"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app/theme.js"), "utf8");

function preferences(saved = {}, blocked = false) {
  const values = new Map(Object.entries(saved));
  const listeners = {};
  const storage = {
    getItem(key) { if (blocked) throw Error("blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error("blocked"); values.set(key, value); },
  };
  const window = { localStorage: storage, addEventListener: (name, fn) => { listeners[name] = fn; },
    dispatchEvent() {}, CustomEvent: class { constructor(type, props) { Object.assign(this, { type }, props); } } };
  vm.runInNewContext(source, { window, document: { documentElement: { dataset: {}, style: {} } } });
  return { api: window.LedgerPreferences, values, listeners };
}
const key = "ledger.import-preferences.v1";
function localDay(date) { return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-"); }

test("import preferences default to two weeks and refund suggestions, and survive reload", () => {
  const { api, values } = preferences();
  assert.equal(api.imports().lookback, "2w");
  assert.equal(api.imports().matchRefunds, true);
  api.setImports({ lookback: "3m", matchRefunds: false });
  const reloaded = preferences(Object.fromEntries(values));
  assert.equal(reloaded.api.imports().lookback, "3m");
  assert.equal(reloaded.api.imports().matchRefunds, false);
  const copy = api.imports(); copy.matchRefunds = true;
  assert.equal(api.imports().matchRefunds, false, "Callers cannot mutate the stored value");
});

test("all six lookbacks use local dates, cross year boundaries and clamp calendar months", () => {
  const { api } = preferences();
  for (const [value, today, expected] of [
    ["1w", new Date(2026, 0, 3), "2025-12-27"],
    ["2w", new Date(2026, 8, 9), "2026-8-26"],
    ["3w", new Date(2026, 8, 9), "2026-8-19"],
    ["1m", new Date(2026, 2, 31), "2026-2-28"],
    ["2m", new Date(2026, 0, 31), "2025-11-30"],
    ["3m", new Date(2024, 4, 31), "2024-2-29"],
  ]) {
    api.setImports({ lookback: value });
    const before = today.getTime();
    assert.equal(localDay(api.importStartDate(today)), expected, value);
    assert.equal(today.getTime(), before);
  }
});

test("old refund opt-out migrates and corrupt, blocked, or invalid preferences stay safe", () => {
  assert.equal(preferences({ "ledger.creditkarma-refund-matching.v1": "false" }).api.imports().matchRefunds, false);
  for (const saved of ["broken JSON", '{"lookback":"9y","matchRefunds":"false"}', "null"]) {
    const { api } = preferences({ [key]: saved });
    assert.equal(api.imports().lookback, "2w");
    assert.equal(api.imports().matchRefunds, true);
    api.setImports({ lookback: "invalid", matchRefunds: "false" });
    assert.equal(api.imports().matchRefunds, true);
  }
  const { api } = preferences({}, true);
  api.setImports({ lookback: "1m", matchRefunds: false });
  assert.equal(api.imports().lookback, "1m");
  assert.equal(api.imports().matchRefunds, false);
});

test("import defaults sync between tabs without changing theme or number preferences", () => {
  const { api, values, listeners } = preferences();
  values.set(key, JSON.stringify({ lookback: "3w", matchRefunds: false }));
  listeners.storage({ key });
  assert.equal(api.imports().lookback, "3w");
  assert.equal(api.imports().matchRefunds, false);
  assert.equal(api.numberAbbreviation(), "m");
});
