"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mount = require("../app/coverage.js");
const model = require("../app/coverage-model.js");
const { documentFor } = require("./coverage-dom.js");
const ids = ["status", "setup", "content", "account-total", "row-total", "older-label", "older-total", "as-of", "search", "year", "threshold", "results-count", "accounts", "unknown-imports", "refresh"];
const row = (overrides = {}) => ({ date: "2026-01-01", accountName: "Checking", accountType: "BANK", provider: "North", createdAt: "", ...overrides });
async function start(responses, stored = null) {
  const document = documentFor(ids.map((id) => `coverage-${id}`));
  const el = (id) => document.getElementById(`coverage-${id}`); el("threshold").value = "30";
  const calls = []; const writes = [];
  const app = mount(document, { model, now: () => new Date(2026, 8, 7),
    storage: { getItem: () => stored, setItem: (...args) => writes.push(args) },
    fetch: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next;
      return { ok: next.status === undefined || next.status === 200, status: next.status || 200, json: async () => next.payload }; },
  }); await app.ready; return { app, el, calls, writes };
}
test("filters rerender locally while summary remains all-account and preferences persist", async () => {
  const app = await start([{ payload: { transactions: [row(), row({ accountName: "Savings", date: "2025-05-01" })] } }]);
  assert.equal(app.el("content").hidden, false); assert.equal(app.el("accounts").children.length, 2);
  app.el("search").value = "Savings"; app.el("search").fire("input");
  assert.equal(app.el("accounts").children.length, 1); assert.equal(app.el("account-total").textContent, "2");
  app.el("year").value = "2025"; app.el("year").fire("change");
  assert.match(app.el("accounts").textContent, /1 rows · 1 of 12 months/);
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0][1].method, undefined);
  assert.equal(JSON.parse(app.writes.at(-1)[1]).year, "2025");
});
test("initial year prefers local current activity even with future dates and invalid saved years", async () => {
  for (const stored of [null, JSON.stringify({ year: "2024" })]) {
    const app = await start([{ payload: { transactions: [row(), row({ date: "2027-02-01" })] } }], stored);
    assert.equal(app.el("year").value, "2026");
    assert.match(app.el("results-count").textContent, /2026/);
    assert.match(app.el("accounts").textContent, /2026 activity1 rows/);
    assert.equal(JSON.parse(app.writes.at(-1)[1]).year, "2026");
  }
});

test("a valid saved year remains selected, including a deliberately selected future year", async () => {
  for (const year of ["2025", "2027"]) {
    const app = await start([{ payload: { transactions: [row(), row({ date: `${year}-02-01` })] } }], JSON.stringify({ year }));
    assert.equal(app.el("year").value, year);
  }
});

test("missing CSV is setup, while load failure hides stale data and permits retry", async () => {
  const missing = await start([{ status: 404, payload: { code: "transaction_file_missing" } }]);
  assert.equal(missing.el("setup").hidden, false); assert.equal(missing.el("status").hidden, true);
  const app = await start([{ payload: { transactions: [row()] } }, new Error("Offline"), { payload: { transactions: [row()] } }]);
  await app.app.load(); assert.equal(app.el("content").hidden, true); assert.match(app.el("status").textContent, /Offline/);
  assert.equal(app.el("refresh").disabled, false);
  await app.app.load(); assert.equal(app.el("content").hidden, false); assert.equal(app.el("status").hidden, true);
  assert.ok(app.calls.every(([, options]) => !options.method));
});
test("unfamiliar response and unavailable storage fail safely", async () => {
  const app = await start([{ payload: { transactions: "broken" } }], "{broken");
  assert.equal(app.el("content").hidden, true); assert.match(app.el("status").textContent, /unfamiliar/);
  assert.equal(app.el("refresh").disabled, false);
});
