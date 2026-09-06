"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const model = require("../app/transactions-model.js");

function transaction(overrides = {}) {
  return {
    date: "2026-08-10", description: "A purchase", amount: 10,
    category: "Shopping", subcategory: "", accountName: "A card", provider: "A bank",
    tags: "", flags: "", ...overrides,
  };
}

const bikeTransactions = [
  transaction({ description: "Lockring tool", tags: "bike, tools", amount: 20 }),
  transaction({ description: "Maap jersey", tags: "Bike, Apparel", amount: 80 }),
  transaction({ description: "Uniqlo pants", tags: "apparel", amount: 40 }),
  transaction({ description: "Downhill bike", tags: "bike", amount: 1000 }),
];

test("tag OR includes overlapping transactions once and AND narrows to the intersection", () => {
  const any = model.filterTransactions(bikeTransactions, { tags: ["bike", "apparel"], tagMode: "any" });
  const all = model.filterTransactions(bikeTransactions, { tags: ["bike", "apparel"], tagMode: "all" });
  assert.deepEqual(any, bikeTransactions);
  assert.equal(model.summarizeTransactions(any).spent, 1140);
  assert.deepEqual(all, [bikeTransactions[1]]);
  assert.equal(model.summarizeTransactions(all).spent, 80);
  assert.deepEqual(model.filterTransactions(bikeTransactions, { tags: [] }), bikeTransactions);
});

test("tag names and groups match exactly and case insensitively, without flattening occurrences", () => {
  const rows = [
    transaction({ tags: "bike repair, Tools" }),
    transaction({ tags: "bike, BIKE, Hawaii 2022 (group)" }),
    transaction({ tags: ["HAWAII   2022 (group)", "bike"] }),
    transaction({ tags: "bike, BIKE, Hawaii 2022 (group)" }),
  ];
  const selected = model.filterTransactions(rows, { tags: ["bike", "BIKE", "hawaii 2022 (GROUP)"], tagMode: "all" });
  assert.deepEqual(selected, rows.slice(1));
  assert.equal(model.summarizeTransactions(selected).spent, 30);
  assert.deepEqual(model.filterTransactions(rows, { tags: ["unknown"] }), []);
});

test("Untagged works alone and with OR, while impossible AND matches nothing", () => {
  const rows = [transaction(), transaction({ tags: " ,  " }), ...bikeTransactions];
  assert.deepEqual(model.filterTransactions(rows, { tags: ["__ledger_untagged__"] }), rows.slice(0, 2));
  assert.equal(model.filterTransactions(rows, { tags: ["__ledger_untagged__", "tools"] }).length, 3);
  assert.deepEqual(model.filterTransactions(rows, { tags: ["__ledger_untagged__", "tools"], tagMode: "all" }), []);
});

test("description, paired categories, account and provider combine with tag queries", () => {
  const row = transaction({
    description: "ALLY   DES:ALLY\tPAYMT", category: "Recurring", subcategory: "Auto",
    accountName: "Checking Account", provider: "Bank of America", tags: "Car",
  });
  const filters = {
    description: "  ally des ", category: "recurring", subcategory: "AUTO",
    accountName: "checking  account", provider: "bank OF america", tags: ["car"],
  };
  assert.deepEqual(model.filterTransactions([row, ...bikeTransactions], filters), [row]);
  assert.deepEqual(model.filterTransactions([row], { ...filters, provider: "another bank" }), []);
  assert.deepEqual(model.filterTransactions([row], { category: "cur" }), []);
  assert.deepEqual(model.filterTransactions([row], { description: ".*" }), []);
});

test("blank category and subcategory filters do not confuse a literal Unclassified category", () => {
  const rows = [transaction({ category: "", subcategory: "" }), transaction({ category: "Unclassified" }), transaction({ subcategory: "Tools" })];
  assert.deepEqual(model.filterTransactions(rows, { category: "__ledger_blank__" }), [rows[0]]);
  assert.deepEqual(model.filterTransactions(rows, { subcategory: "__ledger_blank__" }), rows.slice(0, 2));
  assert.deepEqual(model.filterTransactions(rows, { category: "Unclassified" }), [rows[1]]);
  assert.deepEqual(model.filterTransactions(rows, { category: "Unknown" }), []);
});

test("dates are inclusive across all years and bad or reversed ranges never match", () => {
  const rows = ["2020-01-01", "2024-02-29", "2026-08-10", "2026-12-31"].map((date) => transaction({ date }));
  assert.deepEqual(model.filterTransactions(rows), rows);
  assert.deepEqual(model.filterTransactions(rows, { startDate: "2024-02-29", endDate: "2026-08-10" }), rows.slice(1, 3));
  assert.deepEqual(model.filterTransactions(rows, { endDate: "2020-01-01" }), [rows[0]]);
  assert.deepEqual(model.filterTransactions(rows, { startDate: "2026-12-31" }), [rows[3]]);
  assert.deepEqual(model.filterTransactions(rows, { startDate: "2026-08-11", endDate: "2026-08-10" }), []);
  assert.deepEqual(model.filterTransactions(rows, { startDate: "2026-02-30" }), []);
  assert.deepEqual(model.filterTransactions(rows, { startDate: "last year" }), []);
});

test("spending includes negative purchase refunds and income follows the Income category", () => {
  const rows = [
    transaction({ amount: 10.1 }), transaction({ amount: 0.2 }),
    transaction({ amount: -0.3 }), transaction({ amount: -25, category: " Income " }),
    transaction({ amount: 5, category: "income" }),
  ];
  assert.deepEqual(model.summarizeTransactions(rows), {
    spent: 10, income: 30, net: 20, count: 5, excludedCount: 0,
    startDate: "2026-08-10", endDate: "2026-08-10",
  });
  assert.deepEqual(model.filterTransactions(rows, { type: "spending" }), rows.slice(0, 3));
  assert.deepEqual(model.filterTransactions(rows, { type: "income" }), rows.slice(3));
});

test("exclusion flags mirror shared transaction rows, including explicit overrides", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/transaction-ui.js"), "utf8"), context);
  const shared = context.window.LedgerTransactionUI;
  const cases = [
    {}, { _isInternalTransfer: true }, { _isInternalTransfer: false },
    { flags: "internal-transfer" }, { flags: " REFUNDED " },
    { _isInternalTransfer: true, flags: "include-in-budget" },
    { _isInternalTransfer: true, flags: "include-in-budget,refunded" },
    { flags: "include-in-budget,internal-transfer" },
    { flags: "refunded", category: "Income", amount: -10 },
  ];
  for (const overrides of cases) {
    const row = transaction(overrides);
    const excluded = shared.hasTransactionFlag(row, "refunded") || shared.isInternalTransfer(row);
    assert.equal(model.summarizeTransactions([row]).excludedCount, Number(excluded));
    assert.equal(model.filterTransactions([row], { showExcluded: false }).length, excluded ? 0 : 1);
    assert.deepEqual(model.filterTransactions([row]), [row]);
    assert.equal(model.summarizeTransactions([row]).spent, excluded || overrides.category === "Income" ? 0 : 10);
  }
});

test("summary span and counts include excluded rows while all financial totals exclude them", () => {
  const rows = [
    transaction({ date: "2001-01-01", flags: "internal-transfer", amount: 1000 }),
    transaction({ date: "2002-05-02", amount: 20 }),
    transaction({ date: "2026-01-01", flags: "refunded", amount: 100 }),
  ];
  assert.deepEqual(model.summarizeTransactions(rows), {
    spent: 20, income: 0, net: -20, count: 3, excludedCount: 2,
    startDate: "2001-01-01", endDate: "2026-01-01",
  });
  assert.deepEqual(model.summarizeTransactions([]), {
    spent: 0, income: 0, net: 0, count: 0, excludedCount: 0, startDate: "", endDate: "",
  });
});

test("category spending reconciles to totals without combining overlapping tag amounts", () => {
  const rows = [
    transaction({ amount: 0.1, category: "Food", tags: "bike, trip (group)" }),
    transaction({ amount: 0.2, category: "food" }),
    transaction({ amount: -0.3, category: "Food" }),
    transaction({ amount: 20, category: "", subcategory: "" }),
    transaction({ amount: 30, category: "Shopping", flags: "refunded" }),
    transaction({ amount: 10, category: "Shopping", _isInternalTransfer: true }),
    transaction({ amount: -1000, category: "Income" }),
    transaction({ amount: -1, category: "Travel" }),
  ];
  const groups = model.spendingByCategory(rows);
  assert.deepEqual(groups, [
    { category: "", total: 20, count: 1 },
    { category: "Food", total: 0, count: 3 },
    { category: "Travel", total: -1, count: 1 },
  ]);
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), model.summarizeTransactions(rows).spent);
  assert.deepEqual(model.spendingByCategory([]), []);
});

test("queries and aggregations preserve input rows, order and duplicate occurrences", () => {
  const first = Object.freeze(transaction({ date: "2020-01-01" }));
  const rows = Object.freeze([first, Object.freeze(transaction({ date: "2026-01-01" })), first]);
  assert.deepEqual(model.filterTransactions(rows), rows);
  assert.equal(model.summarizeTransactions(rows).spent, 30);
  assert.deepEqual(model.spendingByCategory(rows), [{ category: "Shopping", total: 30, count: 3 }]);
});

test("browser and CommonJS entry points expose the same pure model", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/transactions-model.js"), "utf8"), context);
  assert.deepEqual(Object.keys(context.window.LedgerTransactionsModel), Object.keys(model));
  assert.equal(context.window.LedgerTransactionsModel.summarizeTransactions(bikeTransactions).spent, 1140);
});
