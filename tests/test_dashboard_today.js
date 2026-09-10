"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

// Exercise the real period controller without chart animation/browser dependencies.
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  assert(start >= 0 && end > start, `Missing standalone controller function: ${name}`);
  return source.slice(start, end);
}

function dashboard(months = ["2024-08", "2023-12"], viewMode = "annual") {
  const clock = { year: 2026, month: 11 };
  // UTC is already January, but the user's local date is still December.
  class LocalDate extends Date {
    constructor(...args) { super(...(args.length ? args : ["2027-01-01T01:00:00Z"])); }
    getFullYear() { return clock.year; }
    getMonth() { return clock.month; }
  }
  function select() {
    return { options: [], value: "", replaceChildren() { this.options = []; }, append(option) { this.options.push(option); } };
  }
  const elements = { todayButton: { disabled: false }, yearSelect: select(), monthSelect: select(),
    viewModeSelect: select(), comparisonStartYear: select() };
  const state = { viewMode, selectedYear: "2024", selectedMonth: "08", comparisonStartYear: "2023",
    selectedComparisonYears: ["2023", "2024"], selectedTags: ["bike"], breakdownDimension: "tag",
    annualCategoryFilter: "Shopping", tagMatchMode: "all" };
  const storage = new Map();
  let renders = 0;
  const context = { state, elements, Date: LocalDate, Intl,
    DASHBOARD_VIEW_STORAGE_KEY: "ledger.dashboardView.v1",
    availableMonths: () => [...months].sort().reverse(),
    selectedMonthKey: () => state.selectedYear && state.selectedMonth ? `${state.selectedYear}-${state.selectedMonth}` : "",
    parseLocalDate: (value) => new Date(`${value}T12:00:00Z`),
    document: { createElement: () => ({value:"",textContent:""}) },
    window: { localStorage: { setItem: (key, value) => storage.set(key, value) } },
    renderDashboard: () => { renders += 1; },
    fetch: () => { throw new Error("Today must not fetch or mutate data"); },
  };
  vm.createContext(context);
  for (const name of ["saveDashboardView", "populatePeriodSelects", "goToToday"]) {
    vm.runInContext(functionSource(name), context);
  }
  return { state, elements, clock, storage, renderCount: () => renders,
    run: (code) => vm.runInContext(code, context) };
}

test("Today switches every dashboard view to the current local month, including an empty year", () => {
  for (const mode of ["monthly", "annual", "year-over-year"]) {
    const app = dashboard(undefined, mode);
    app.run("goToToday()");
    assert.equal(app.state.viewMode, "monthly");
    assert.equal(app.state.selectedYear, "2026");
    assert.equal(app.state.selectedMonth, "12");
    assert.equal(app.elements.viewModeSelect.value, "monthly");
    assert.equal(app.elements.yearSelect.value, "2026");
    assert.equal(app.elements.monthSelect.value, "12");
    assert.deepEqual(app.elements.yearSelect.options.map(option => option.value), ["2026", "2024", "2023"]);
    assert.equal(app.renderCount(), 1);
    const saved = JSON.parse(app.storage.get("ledger.dashboardView.v1"));
    assert.equal(saved.selectedYear, "2026");
    assert.equal(saved.selectedMonth, "12");
    assert.deepEqual(saved.selectedTags, ["bike"]);
    assert.equal(saved.breakdownDimension, "tag");
    assert.equal(saved.annualCategoryFilter, "Shopping");
    app.run("populatePeriodSelects()");
    assert.equal(app.state.selectedYear, "2026", "An empty current-year selection must survive repopulation/navigation");
  }
});

test("Today reads the clock on each click and does not add duplicate year options", () => {
  const app = dashboard(["2026-07"]);
  app.run("goToToday()");
  app.clock.year = 2027; app.clock.month = 0;
  app.run("goToToday(); goToToday()");
  assert.equal(app.state.selectedYear, "2027");
  assert.equal(app.state.selectedMonth, "01");
  assert.equal(app.elements.yearSelect.options.filter(option => option.value === "2027").length, 1);
});

test("initial selection still uses the latest imported month, not Today", () => {
  const app = dashboard(["2024-08", "2023-12"]);
  app.state.selectedYear = ""; app.state.selectedMonth = "";
  app.run("populatePeriodSelects()");
  assert.equal(app.state.selectedYear, "2024");
  assert.equal(app.state.selectedMonth, "08");
});

test("Today works with a valid empty database and does nothing while loading or blocked", () => {
  const app = dashboard([]);
  app.elements.todayButton.disabled = true;
  app.run("goToToday()");
  assert.equal(app.renderCount(), 0);
  assert.equal(app.state.viewMode, "annual");
  assert.equal(app.storage.size, 0);
  app.elements.todayButton.disabled = false;
  app.run("goToToday()");
  assert.equal(app.state.selectedYear, "2026");
  assert.equal(app.state.selectedMonth, "12");
  assert.equal(app.elements.monthSelect.options.length, 12);
});
