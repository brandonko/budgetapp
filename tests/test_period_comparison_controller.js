"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mount = require("../app/period-comparison.js");
const model = require("../app/period-comparison-model.js");
const { documentFor } = require("./period-comparison-dom.js");
const ids = ["status", "setup", "review", "content", "refresh", "focus-start", "focus-end", "baseline-start", "baseline-end", "focus-caption", "baseline-caption", "previous", "previous-year", "swap", "validation", "results", "scope", "metrics", "category-rows", "category-empty", "focus-link", "baseline-link"];
const row = (overrides = {}) => ({ date: "2026-05-10", category: "Food", amount: 10, flags: "", ...overrides });
async function start(responses, saved = null) {
  const document = documentFor(ids.map((id) => `period-${id}`));
  const el = (id) => document.getElementById(`period-${id}`);
  const calls = [], savedViews = [];
  const app = mount(document, { model, now: () => new Date(2026, 8, 7),
    storage: { getItem: () => saved, setItem: (_key, value) => savedViews.push(JSON.parse(value)) },
    fetch: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next;
      return { ok: next.status === undefined || next.status === 200, status: next.status || 200, json: async () => next.payload }; },
  }); await app.ready; return { app, el, calls, savedViews };
}
test("date edits, previous-year and swap update comparison locally and persist valid ranges", async () => {
  const app = await start([{ payload: { transactions: [row(), row({ date: "2025-05-11", amount: 20 })] } }]);
  assert.equal(app.el("content").hidden, false); assert.equal(app.el("metrics").children.length, 3);
  app.el("previous-year").fire("click"); assert.equal(app.el("baseline-start").value, "2025-05-01");
  assert.match(app.el("metrics").textContent, /-\$10.00.*-50%/);
  app.el("swap").fire("click"); assert.equal(app.el("focus-start").value, "2025-05-01");
  assert.equal(app.savedViews.at(-1).focus.startDate, "2025-05-01"); assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][1].method, undefined);
  const url = app.el("category-rows").children[0].children[1].children[0].href;
  assert.equal(model.parseDrilldown(url.split("?")[1]).category, "Food");
});
test("invalid date entry hides stale totals without persisting it; corrections restore results", async () => {
  const app = await start([{ payload: { transactions: [row()] } }]);
  const count = app.savedViews.length;
  app.el("focus-start").value = ""; app.el("focus-start").fire("input");
  assert.equal(app.el("results").hidden, true); assert.equal(app.el("previous").disabled, true);
  assert.equal(app.savedViews.length, count); assert.match(app.el("validation").textContent, /both dates/);
  app.el("focus-start").value = "2026-05-31"; app.el("focus-start").fire("input");
  assert.equal(app.el("results").hidden, false); assert.match(app.el("focus-caption").textContent, /1 calendar days/);
});
test("missing CSV is setup, transfer-review gate hides totals, and failures can be retried", async () => {
  const setup = await start([{ status: 404, payload: { code: "transaction_file_missing" } }]);
  assert.equal(setup.el("setup").hidden, false); assert.equal(setup.el("content").hidden, true);
  const gate = await start([{ payload: { transactions: [row()], internalTransferReviewRequired: true } }]);
  assert.equal(gate.el("review").hidden, false); assert.equal(gate.el("content").hidden, true);
  const retry = await start([new Error("Offline"), { payload: { transactions: [row()] } }]);
  assert.match(retry.el("status").textContent, /Offline/); assert.equal(retry.el("refresh").disabled, false);
  await retry.app.load(); assert.equal(retry.el("content").hidden, false); assert.equal(retry.calls.length, 2);
});
test("unequal/overlapping periods explain their scope and invalid stored ranges fall back", async () => {
  const app = await start([{ payload: { transactions: [row()] } }], "{broken");
  app.el("baseline-start").value = "2026-05-10"; app.el("baseline-end").value = "2026-05-10"; app.el("baseline-end").fire("input");
  assert.match(app.el("scope").textContent, /different lengths/); assert.match(app.el("scope").textContent, /overlap/);
});
