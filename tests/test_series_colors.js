"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
const sharedSource = fs.readFileSync(path.join(__dirname, "../app/transaction-ui.js"), "utf8");

function ui() {
  const context = { window: {} }; vm.runInNewContext(sharedSource, context);
  return context.window.LedgerTransactionUI;
}

test("series retain colors through sorting and selection removal, and additions take the first free slot", () => {
  const slots = ui().createSeriesColorSlots({ size: 4 });
  slots.sync(["Trip Z", "Trip M", "Trip H"]);
  assert.equal(slots.slot("Trip Z"), 0); assert.equal(slots.slot("Trip M"), 1);
  slots.sync(["Trip A", "Trip H", "Trip M", "Trip Z"]);
  assert.equal(slots.slot("Trip A"), 3); assert.equal(slots.slot("Trip H"), 2);
  slots.sync(["Trip A", "Trip M", "Trip Z"]);
  assert.equal(slots.slot("Trip A"), 3); assert.equal(slots.slot("Trip Z"), 0);
  slots.sync(["Trip A", "New bike", "Trip M", "Trip Z"]);
  assert.equal(slots.slot("New bike"), 2);
  slots.sync([]); slots.sync(["Fresh start"]); assert.equal(slots.slot("Fresh start"), 0);
});

test("color slots normalize group/tag names without assigning colors to merely available choices", () => {
  const slots = ui().createSeriesColorSlots();
  slots.sync(["Bike   tools", "bike tools", "TRAVEL"]);
  assert.equal(slots.snapshot().length, 2);
  assert.equal(slots.slot(" BIKE TOOLS "), 0);
  assert.equal(slots.slot("Available but not selected"), undefined);
  slots.sync(["Apparel", "Travel", "bike tools"]);
  assert.equal(slots.slot("Apparel"), 2); assert.equal(slots.slot("Travel"), 1);
});

test("palette exhaustion wraps only after using all distinct colors, without shuffling survivors", () => {
  const slots = ui().createSeriesColorSlots({ size: 3 });
  slots.sync(["A", "B", "C", "D"]);
  assert.deepEqual(Array.from(slots.snapshot(), ([, slot]) => slot), [0, 1, 2, 3]);
  slots.sync(["A", "C", "D"]);
  const saved = slots.snapshot();
  const restored = ui().createSeriesColorSlots({ size: 3, initial: saved });
  restored.sync(["D", "C", "A", "E"]);
  assert.equal(restored.slot("D"), 3); assert.equal(restored.slot("A"), 0);
  assert.equal(restored.slot("E"), 1, "Reuse a free distinct color before repeating another");
  assert.deepEqual(Array.from(saved, ([key, slot]) => [key, slot]), [["a", 0], ["c", 2], ["d", 3]]);
});

test("restored preferences preserve gaps and safely discard invalid or conflicting slots", () => {
  const initial = [["Z", 2], ["M", 1], ["M", 0], ["bad", -1], ["NaN", NaN], ["too big", Infinity], ["conflict", 1], [null, 0], null];
  const slots = ui().createSeriesColorSlots({ size: 4, initial });
  slots.sync(["Z", "M", "New"]);
  assert.equal(slots.slot("Z"), 2); assert.equal(slots.slot("M"), 1); assert.equal(slots.slot("New"), 0);
  const snapshot = slots.snapshot(); snapshot[0][1] = 999;
  assert.equal(slots.slot("Z"), 2, "Snapshots do not expose mutable state");
  assert.equal(ui().createSeriesColorSlots({ initial: {} }).snapshot().length, 0);
});

function dashboard(storage = new Map(), blocked = false) {
  const context = { window: { localStorage: {
    getItem(key) { if (blocked) throw Error("blocked"); return storage.get(key) || null; },
    setItem(key, value) { if (blocked) throw Error("blocked"); storage.set(key, value); },
  } }, state: { selectedComparisonYears: ["2024", "2025"], annualCategoryFilter: "Food" },
    VISUALIZATION_COLOR_COUNT: 12, dashboardColorAssignments: new Map(), theme: "light" };
  vm.createContext(context); vm.runInContext(sharedSource, context);
  context.transactionUi = context.window.LedgerTransactionUI;
  context.visualizationColor = (slot) => `${context.theme}-${slot % 12}`;
  for (const name of ["dashboardSeriesColors", "colorForComparisonYear", "colorForCategory", "colorForSubcategory"]) {
    const start = source.indexOf(`function ${name}(`); const end = source.indexOf("\n}", start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  context.mixHexColor = (color, ratio) => `${color}-${ratio.toFixed(2)}`;
  return { context, storage, run: (code) => vm.runInContext(code, context) };
}

test("adding an earlier comparison year preserves year colors, including navigation and theme changes", () => {
  const app = dashboard();
  assert.equal(app.run('colorForComparisonYear("2024")'), "light-0");
  assert.equal(app.run('colorForComparisonYear("2025")'), "light-1");
  assert.equal(app.run('colorForComparisonYear("2023")'), "var(--muted)");
  app.run('state.selectedComparisonYears.push("2023")');
  assert.equal(app.run('colorForComparisonYear("2023")'), "light-2");
  assert.equal(app.run('colorForComparisonYear("2024")'), "light-0");
  app.run('state.selectedComparisonYears = ["2023", "2025"]');
  assert.equal(app.run('colorForComparisonYear("2023")'), "light-2");
  const restored = dashboard(app.storage);
  restored.run('state.selectedComparisonYears = ["2023", "2025"]');
  assert.equal(restored.run('colorForComparisonYear("2023")'), "light-2");
  restored.context.theme = "dark";
  assert.equal(restored.run('colorForComparisonYear("2025")'), "dark-1");
  restored.run('state.selectedComparisonYears.push("2022")');
  assert.equal(restored.run('colorForComparisonYear("2022")'), "dark-0");
});

test("category/subcategory rankings do not change colors, and blocked storage remains usable", () => {
  const app = dashboard(new Map(), true);
  assert.equal(app.run('colorForCategory("Food", ["Food", "Travel"])'), "light-0");
  assert.equal(app.run('colorForCategory("Travel", ["Travel", "Food"])'), "light-1");
  assert.equal(app.run('colorForCategory("Bike", ["Bike", "Travel", "Food"])'), "light-2");
  assert.equal(app.run('colorForSubcategory("Grocery", ["Grocery", "Restaurant"], "green")'), "green-0.08");
  assert.equal(app.run('colorForSubcategory("Restaurant", ["Restaurant", "Grocery"], "green")'), "green-0.20");
});
