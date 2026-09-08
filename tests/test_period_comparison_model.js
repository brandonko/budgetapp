"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../app/period-comparison-model.js");
const row = (overrides = {}) => ({ date: "2026-05-01", description: "Synthetic purchase", category: "Food", amount: 10, flags: "", ...overrides });
const focus = { startDate: "2026-05-01", endDate: "2026-05-31" };
const baseline = { startDate: "2026-04-01", endDate: "2026-04-30" };

test("inclusive ranges count every occurrence and preserve cents, negative credits, and income signs", () => {
  const rows = [row({ amount: .1 }), row({ amount: .2 }), row({ amount: .1 }),
    row({ amount: -.05, date: "2026-05-31" }), row({ amount: -100, category: "Income" }),
    row({ amount: 1000, flags: "refunded" }), row({ amount: -500, category: "Income", flags: "internal-transfer" }),
    row({ amount: 200, _isInternalTransfer: true }), row({ amount: 2, _isInternalTransfer: true, flags: "include-in-budget" }),
    row({ amount: 3, category: "Transfer" }), row({ amount: 1, date: "2026-06-01" })];
  const result = model.comparePeriods(rows, focus, baseline);
  assert.equal(result.focus.spent, 5.35); assert.equal(result.focus.income, 100); assert.equal(result.focus.net, 94.65);
  assert.equal(result.focus.count, 10); assert.equal(result.focus.excludedCount, 3);
  assert.equal(result.focus.days, 31); assert.equal(result.focus.perDay.spent, 5.35 / 31);
  assert.equal(result.differences.spent.percent, null); assert.equal(result.baseline.count, 0);
});
test("category union distinguishes no activity from zero and reports negative spending deltas", () => {
  const result = model.comparePeriods([row({ amount: 10 }), row({ amount: -10 }),
    row({ category: "Travel", amount: 40, date: "2026-04-01" }),
    row({ category: "", amount: -5 })], focus, baseline);
  const food = result.categories.find((item) => item.category === "Food");
  assert.equal(food.focus, 0); assert.equal(food.focusCount, 2); assert.equal(food.baselineCount, 0);
  const travel = result.categories.find((item) => item.category === "Travel");
  assert.equal(travel.delta, -40); assert.equal(travel.percent, -100);
  assert.equal(result.categories[0].category, "Travel");
  assert.equal(result.focus.spent, -5); assert.equal(result.focus.net, 5);
});
test("range validation rejects missing, impossible, reversed and oversized years", () => {
  for (const range of [{}, { startDate: "2026-02-30", endDate: "2026-03-01" },
    { startDate: "2026-03-01", endDate: "2026-02-28" }, { startDate: "10000-01-01", endDate: "10000-02-01" }]) {
    assert.ok(model.validateRange(range)); assert.throws(() => model.comparePeriods([], range, baseline));
  }
  assert.equal(model.days({ startDate: "2024-02-29", endDate: "2024-02-29" }), 1);
});
test("previous period is equal length across DST/year boundaries; leap anniversaries clamp", () => {
  assert.deepEqual(model.previousPeriod({ startDate: "2026-03-08", endDate: "2026-03-14" }), { startDate: "2026-03-01", endDate: "2026-03-07" });
  assert.deepEqual(model.previousPeriod({ startDate: "2026-01-01", endDate: "2026-01-31" }), { startDate: "2025-12-01", endDate: "2025-12-31" });
  assert.deepEqual(model.previousYear({ startDate: "2024-02-29", endDate: "2024-03-31" }), { startDate: "2023-02-28", endDate: "2023-03-31" });
  assert.throws(() => model.previousYear({ startDate: "0001-01-01", endDate: "0001-01-31" }));
});
test("default latest month ignores excluded rows and differences never divide by zero", () => {
  const defaults = model.defaultPeriods([row(), row({ date: "2027-01-01", flags: "refunded" })], "2026-09-07");
  assert.deepEqual(defaults.focus, focus);
  assert.equal(model.difference(20, 0).percent, null); assert.equal(model.difference(20, -10).percent, null);
  assert.equal(model.difference(15, 10).percent, 50);
});
test("drilldown links round-trip only whitelisted filters, with strict date validation", () => {
  const url = model.drilldownUrl(focus, { type: "spending", category: "Food & drink" });
  assert.deepEqual(model.parseDrilldown(url.split("?")[1]), { ...focus, category: "Food & drink", type: "spending", showExcluded: false });
  assert.equal(model.parseDrilldown("?report=other&startDate=2026-05-01&endDate=2026-05-31"), null);
  assert.equal(model.parseDrilldown("?report=period-comparison&startDate=2026-05-31&endDate=2026-05-01"), null);
  assert.equal(model.parseDrilldown("?report=period-comparison&startDate=2026-05-01&endDate=2026-05-31&type=DELETE"), null);
  assert.equal(model.parseDrilldown(`${url.split("?")[1]}&amount=1000&flags=refunded`).amount, undefined);
});
