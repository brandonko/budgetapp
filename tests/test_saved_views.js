"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const views = require("../app/saved-views.js");
test("rolling date ranges resolve when reopened, including leap February and inclusive last 30", () => {
  const now = new Date(2024, 2, 15, 12);
  assert.deepEqual(views.resolveView({ period: "lastMonth" }, now).filters.endDate, "2024-02-29");
  assert.equal(views.resolveView({ period: "lastMonth" }, now).filters.startDate, "2024-02-01");
  assert.equal(views.resolveView({ period: "last30" }, now).filters.startDate, "2024-02-15");
  assert.equal(views.resolveView({ period: "year" }, now).filters.startDate, "2024-01-01");
  assert.equal(views.resolveView({ period: "month" }, new Date(2025, 0, 2)).filters.endDate, "2025-01-02");
  assert.equal(views.resolveView({ period: "fixed", filters: { startDate: "2020-01-01" } }, now).filters.startDate, "2020-01-01");
});
test("saved views preserve query, tags, group, exclusion and sort without financial fields", () => {
  const result = views.normalizeView({ filters: { tags: ["Bike", "Tools"], tagMode: "all", group: "Trip",
    showExcluded: false, amount: 100, category: "Shopping" }, sort: { field: "cost", direction: "asc" } });
  assert.deepEqual(result.filters.tags, ["Bike", "Tools"]); assert.equal(result.filters.tagMode, "all");
  assert.equal(result.filters.group, "Trip"); assert.equal(result.filters.showExcluded, false);
  assert.equal(result.sort.field, "cost"); assert.equal(Object.hasOwn(result.filters, "amount"), false);
  assert.throws(() => views.normalizeView({ filters: { startDate: "2025-02-30" } }));
});
test("create, rename, update and confirmed delete reread storage and preserve other tabs' additions", () => {
  let raw = null; const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  views.write(storage, { action: "create", id: "a", name: "Groceries", view: {} });
  views.write(storage, { action: "create", id: "b", name: "Trips", view: { filters: { group: "Trip" } } });
  views.write(storage, { action: "rename", id: "a", name: "Food" });
  assert.equal(views.read(storage)[1].filters.group, "Trip");
  views.write(storage, { action: "update", id: "a", name: "Food", view: { period: "month" } });
  assert.throws(() => views.write(storage, { action: "create", id: "c", name: "food", view: {} }));
  views.write(storage, { action: "delete", id: "a" });
  assert.equal(views.read(storage).length, 1);
  assert.throws(() => views.write(storage, { action: "update", id: "a", name: "Stale", view: {} }));
});
test("malformed or inaccessible storage is not silently replaced", () => {
  let raw = "broken"; const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  assert.throws(() => views.write(storage, { action: "create", id: "a", name: "A", view: {} }));
  assert.equal(raw, "broken");
  assert.throws(() => views.write({ getItem: () => null, setItem: () => { throw Error("full"); } },
    { action: "create", id: "a", name: "A", view: {} }), /full/);
});
