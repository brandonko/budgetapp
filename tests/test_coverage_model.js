"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCoverage, validDate } = require("../app/coverage-model.js");
const row = (overrides = {}) => ({ date: "2026-01-02", accountName: "Checking", provider: "North", accountType: "BANK", createdAt: "", ...overrides });
const options = { today: "2026-09-07", year: "2026" };

test("account identity includes provider and type, with conservative whitespace/case normalization", () => {
  const result = buildCoverage([row(), row({ provider: "  NORTH " }), row({ provider: "South" }), row({ accountType: "CREDIT" })], options);
  assert.equal(result.totalAccounts, 3);
  assert.equal(result.totalRows, 4);
  assert.deepEqual(result.accounts.map((account) => account.count).sort(), [1, 1, 2]);
});
test("account identity and search do not depend on the browser's Turkish locale", () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const context = vm.createContext({});
  vm.runInContext("const nativeLocaleLower = String.prototype.toLocaleLowerCase; String.prototype.toLocaleLowerCase = function () { return nativeLocaleLower.call(this, 'tr'); };", context);
  vm.runInContext(fs.readFileSync(require.resolve("../app/coverage-model.js"), "utf8"), context);
  const result = context.LedgerCoverageModel.buildCoverage([
    row({ provider: "FIRST", accountName: "IRA" }),
    row({ provider: "first", accountName: "ira" }),
  ], { ...options, query: "IRA" });
  assert.equal(result.totalAccounts, 1);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].count, 2);
});

test("all occurrences count, including refunds/transfers and distinct years", () => {
  const result = buildCoverage([row(), row(), row({ flags: "refunded" }), row({ flags: "internal-transfer" }),
    row({ date: "2025-12-31" }), row({ date: "2026-09-07" })], options);
  const account = result.accounts[0];
  assert.equal(account.count, 6); assert.equal(account.months[0], 4); assert.equal(account.months[8], 1);
  assert.equal(account.yearCount, 5); assert.equal(account.activeMonths, 2);
  assert.equal(account.age, 0); assert.equal(account.firstDate, "2025-12-31");
  assert.deepEqual(result.years, ["2026", "2025"]);
});
test("freshness uses calendar days without DST shifts and preserves future-dated status", () => {
  const result = buildCoverage([row({ date: "2026-03-07" }), row({ accountName: "Future", date: "2026-03-11" })], { today: "2026-03-09", year: "2026", olderThan: 1 });
  assert.equal(result.accounts.find((account) => account.accountName === "Checking").age, 2);
  assert.equal(result.accounts.find((account) => account.accountName === "Future").age, -2);
  assert.equal(result.olderAccounts, 1);
});
test("newest retained import compares instants, blanks do not become epoch dates", () => {
  const result = buildCoverage([row({ createdAt: "2026-09-07T01:00:00Z" }),
    row({ createdAt: "2026-09-06T19:00:00-07:00" }), row(), row({ createdAt: "invalid" })], options);
  assert.equal(result.accounts[0].latestImport, Date.parse("2026-09-07T02:00:00Z"));
  assert.equal(result.accounts[0].importedCount, 2); assert.equal(result.unknownImportCount, 2);
});
test("search does not change global summary and invalid dates do not invent activity", () => {
  const result = buildCoverage([row(), row({ accountName: "Other", date: "2026-02-30" })], { ...options, query: "north bank checking" });
  assert.equal(result.accounts.length, 0); assert.equal(result.totalAccounts, 2);
  assert.equal(buildCoverage([row({ date: "2026-02-30" })], options).accounts[0].activeMonths, 0);
  assert.equal(validDate("2024-02-29"), true); assert.equal(validDate("2026-02-29"), false);
  assert.throws(() => buildCoverage([], { today: "2026-02-30" }));
});
test("empty data still offers the current year with zero accounts", () => {
  assert.deepEqual(buildCoverage([], options).years, ["2026"]);
  assert.equal(buildCoverage([], options).totalAccounts, 0);
});
