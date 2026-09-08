"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { analyze } = require("../app/merchants-model.js");
const row = (overrides) => ({date:"2026-08-01", description:"Market", amount:10, category:"Groceries", flags:"", ...overrides});
test("groups conservatively and preserves repeated purchases; credits reduce spending", () => {
  const data = [row({}), row({ description:" market  ", amount:20 }), row({ amount:-5 }), row({ description:"Market #2", amount:7 })];
  const copy = JSON.stringify(data), result = analyze(data);
  assert.equal(result.entries.length, 2); assert.equal(result.entries[0].spent, 25);
  assert.equal(result.entries[0].count, 3); assert.equal(result.entries[0].purchaseCount, 2);
  assert.equal(result.entries[0].median, 15); assert.equal(result.totalCharges, 37);
  assert.equal(result.summary.spent, 32); assert.equal(JSON.stringify(data), copy);
});
test("refunds and internal transfers never inflate insights, including public reconciliation flags", () => {
  const result = analyze([row({}), row({amount:100,flags:"refunded"}),row({flags:"internal-transfer"}),
    row({_isInternalTransfer:true}), row({amount:-500,category:"Income"}), row({flags:"include-in-budget",_isInternalTransfer:true})]);
  assert.equal(result.summary.spent, 20); assert.equal(result.entries[0].count, 2);
});
test("dates and categories apply inclusively; monthly buckets and counts retain identical occurrences", () => {
  const result = analyze([row({}),row({}),row({date:"2026-09-01",amount:30}),row({category:"Other",amount:99})],
    {startDate:"2026-08-01",endDate:"2026-09-01",category:"Groceries"});
  assert.deepEqual(result.entries[0].months,[{month:"2026-08",spent:20},{month:"2026-09",spent:30}]);
  assert.equal(result.summary.spent,50); assert.equal(result.entries[0].count,3);
});
test("net credit only groups have no invented typical purchase or positive share", () => {
  const result=analyze([row({amount:-12})]); assert.equal(result.entries[0].spent,-12);
  assert.equal(result.entries[0].median,null); assert.equal(result.entries[0].share,0);
  assert.equal(analyze([],{}).entries.length,0);
});
test("search and purchase thresholds narrow ranks without silently changing scope totals", () => {
  const result=analyze([row({}),row({}),row({description:"Bookstore",amount:5})],{merchantSearch:"market",minimumPurchases:2});
  assert.equal(result.entries.length,1);assert.equal(result.summary.spent,25);
});
test("cent rounding remains exact and enormous totals fail visibly", () => {
  assert.equal(analyze([row({amount:1.005}),row({amount:-1.005})]).summary.spent,0);
  assert.throws(()=>analyze([row({amount:1e20})]),/too large/);
});
