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

test("linked refunds and multiple repayments reduce only their original purchase, across months and categories", () => {
  const root=transaction({date:"2026-07-01",amount:100,_budgetAmount:20,_linkRole:"primary",_linkType:"refund"});
  const credit=transaction({date:"2026-08-01",amount:-80,category:"Income",_budgetAmount:0,_linkRole:"credit",_linkType:"refund"});
  assert.equal(model.summarizeTransactions([root,credit]).spent,20);
  assert.equal(model.summarizeTransactions([root,credit]).income,0);
  assert.equal(model.summarizeTransactions(model.filterTransactions([root,credit],{startDate:"2026-08-01"})).spent,0);
  assert.equal(model.summarizeTransactions([{...root,_budgetAmount:-10,_linkType:"repayment"},credit]).spent,-10);
});

test("follow-up flags filter independently of refund/transfer treatment and never alter totals", () => {
  const rows=[transaction({flags:"custom, FLAGGED ",amount:10}),transaction({flags:"refunded",amount:30}),
    transaction({flags:"internal-transfer,flagged",amount:80}),transaction({amount:20})];
  assert.deepEqual(model.filterTransactions(rows,{flagged:"flagged"}),[rows[0],rows[2]]);
  assert.deepEqual(model.filterTransactions(rows,{flagged:"unflagged"}),rows,
    "Removed legacy Not flagged selections fall back to all transactions");
  assert.equal(model.summarizeTransactions(rows).spent,30);
  assert.equal(model.summarizeTransactions(rows.map(row=>({...row,flags:row.flags?.replace(/flagged/ig,"")}))).spent,30);
  assert.deepEqual(model.filterTransactions(rows,{flagged:"flagged",showExcluded:false}),[rows[0]]);
});

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

test("shared transaction search matches descriptions or notes literally without modifying freeform text", () => {
  const rows = [transaction({ description: "BIKE helmet", notes: "For the LA\n  trip; cost [20]." }),
    transaction({ description: "LA trip hotel", notes: "LA trip stay" }),
    transaction({ description: "Book", notes: null }), transaction({ description: "Shoes" })];
  const before = JSON.stringify(rows);
  for (const [query, expected] of [["bike", [0]], ["  la  TRIP ", [0, 1]], ["cost [20]", [0]],
    [".*", []], ["Book", [2]], ["Shoes", [3]], ["", [0, 1, 2, 3]], [" \n\t ", [0, 1, 2, 3]],
    ["helmet for", []], ["missing", []]]) {
    const matches = expected.map(index => rows[index]);
    assert.deepEqual(rows.filter(row => model.matchesTransactionSearch(row, query)), matches, query);
    assert.deepEqual(model.filterTransactions(rows, { description: query }), matches, query);
  }
  assert.deepEqual(model.filterTransactions(rows, { description: "la trip", provider: "Not this bank" }), []);
  assert.equal(JSON.stringify(rows), before, "Notes and descriptions must not be normalized in storage");
  assert.equal(model.filterTransactions([rows[1], { ...rows[1] }], { description: "la trip" }).length, 2,
    "Preserve identical occurrences without duplicating a row matching both fields");
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

test("group comparison uses exact normalized groups, preserves occurrences, and never infers groups from tags", () => {
  const first = Object.freeze(transaction({ group: "Road  bike", amount: 10.1 }));
  const rows = Object.freeze([first, first, Object.freeze(transaction({ group: "road bike", amount: .2 })),
    Object.freeze(transaction({ group: "Other bike", amount: 25 })),
    Object.freeze(transaction({ tags: "Road bike (group)", amount: 1000 }))]);
  const result = model.compareGroups(rows, [" ROAD BIKE ", "road bike", "Other bike"]);
  assert.deepEqual(result.groups.map(({ name, spent, count, difference }) => ({ name, spent, count, difference })), [
    { name: "Road bike", spent: 20.4, count: 3, difference: 0 },
    { name: "Other bike", spent: 25, count: 1, difference: 4.6 },
  ]);
  assert.equal(result.baseline, "road bike");
  assert.equal(rows[0].group, "Road  bike");
  assert.throws(() => model.compareGroups([], ["A", "B", "C", "D", "E"]), RangeError);
});

test("group spending reconciles credits, category cells, exclusions, income and explicit overrides in cents", () => {
  const rows = [
    transaction({ group: "A", amount: 10.1, category: "Food" }),
    transaction({ group: "A", amount: .2, category: "food" }),
    transaction({ group: "A", amount: -.3, category: "FOOD" }),
    transaction({ group: "A", amount: 8, category: "" }),
    transaction({ group: "A", amount: -100, category: "Income" }),
    transaction({ group: "A", amount: 500, flags: "refunded" }),
    transaction({ group: "A", amount: 500, flags: "internal-transfer" }),
    transaction({ group: "A", amount: 2, flags: "include-in-budget", _isInternalTransfer: true }),
    transaction({ group: "B", amount: -30, category: "food" }),
  ];
  const result = model.compareGroups(rows, ["A", "B"], { baseline: "b" });
  const [a, b] = result.groups;
  assert.equal(a.spent, 20); assert.equal(a.income, 100); assert.equal(a.excludedCount, 2);
  assert.equal(a.purchases, 20.3); assert.equal(a.credits, .3); assert.equal(a.difference, 50);
  assert.equal(b.spent, -30); assert.equal(b.difference, 0);
  assert.equal(result.categories.filter((entry) => entry.key === "food").length, 1);
  for (let i = 0; i < 2; i++) {
    assert.equal(result.categories.reduce((sum, entry) => sum + Math.round(entry.cells[i].total * 100), 0), result.groups[i].spent * 100);
  }
  assert.equal(result.categories.find((entry) => entry.key === "").cells[1].count, 0);
});

test("comparison distinguishes genuine zero, no date-range activity, and a removed group", () => {
  const rows = [transaction({ group: "Zero", amount: 10, date: "2025-01-01" }),
    transaction({ group: "Zero", amount: -10, date: "2025-01-31" }),
    transaction({ group: "Later", date: "2026-01-01" })];
  const result = model.compareGroups(rows, ["Zero", "Later", "Removed"], { startDate: "2025-01-01", endDate: "2025-01-31" });
  assert.deepEqual(result.groups.map((group) => [group.spent, group.count, group.savedCount, group.difference]), [
    [0, 2, 2, 0], [0, 0, 1, null], [0, 0, 0, null],
  ]);
  assert.equal(result.categories[0].cells[0].count, 2);
  assert.equal(result.categories[0].cells[0].total, 0);
  const missingReference = model.compareGroups(rows, ["Removed", "Zero"]);
  assert.equal(missingReference.groups[1].difference, null);
  assert.deepEqual(model.compareGroups(rows, []), { groups: [], baseline: "", categories: [] });
});

test("comparison validates ranges and includes both date boundaries across years", () => {
  const rows = [transaction({ group: "Bike", date: "2024-12-31" }), transaction({ group: "Bike", date: "2025-01-01" })];
  assert.equal(model.compareGroups(rows, ["Bike"], { startDate: "2024-12-31", endDate: "2025-01-01" }).groups[0].spent, 20);
  for (const dates of [{ startDate: "invalid" }, { endDate: "2025-02-30" }, { startDate: "2026-01-01", endDate: "2025-01-01" }]) {
    assert.throws(() => model.compareGroups(rows, ["Bike"], dates), TypeError);
  }
});
