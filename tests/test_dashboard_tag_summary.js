"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const read = (file) => fs.readFileSync(path.join(__dirname, "../app", file), "utf8");
const source = read("app.js");
const UNTAGGED = "__ledger_untagged__";

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  assert(start >= 0 && end > start, `Missing dashboard function: ${name}`);
  return source.slice(start, end);
}

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.listeners = {}; this.value = ""; this._text = ""; this.disabled = false;
    const classes = new Set();
    this.classList = {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    };
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) { this.children = []; this._text = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { if (!this.disabled) for (const callback of this.listeners[name] || []) callback({target:this}); }
  click() { this.dispatch("click"); }
  animate() { return { finished: Promise.resolve(), cancel() {} }; }
}

function transactions() {
  const row = (description, amount, tags, overrides = {}) => ({
    date:"2026-08-20", description, amount, category:"Shopping", tags, flags:"", ...overrides,
  });
  return [
    row("Tool",40,"bike, tools"), row("Jersey",60,"Bike, apparel, bike"),
    row("Pants",30,"apparel"), row("Bike",100,"bike"), row("Return credit",-10,"bike"),
    row("Tagged income",-500,"bike",{category:"Income"}),
    row("Other income",-1000,"",{category:"Income"}), row("Untagged expense",15,""),
    row("Refunded",1000,"bike",{flags:"refunded"}),
    row("Internal transfer",9999,"bike",{flags:"internal-transfer"}),
    row("Tool",40,"bike, tools"), // A separate same-day occurrence, not the same row twice.
    row("Refunded income",-900,"bike",{flags:"refunded",category:"Income"}),
    row("Explicit inclusion",25,"bike",{flags:"include-in-budget"}),
    row("July repair",20,"bike",{date:"2026-07-20"}),
    row("July income",-100,"bike",{date:"2026-07-20",category:"Income"}),
    row("Prior year",1000,"bike",{date:"2025-08-20"}),
  ].map((row,index)=>({...row,_id:index}));
}

// Run the real dashboard orchestrator, tag controls, financial helpers and odometer.
// Only the unrelated chart/category renderers are replaced with recording adapters.
function dashboard(viewMode = "monthly", saved = null) {
  const state = {transactions:transactions(), viewMode, selectedYear:"2026", selectedMonth:"08",
    selectedTags:[], tagMatchMode:"any", breakdownDimension:"category", comparisonStartYear:"2025",
    selectedComparisonYears:["2025","2026"], annualCategoryFilter:"", annualSubcategoryFilter:""};
  const elements = new Proxy({}, {get(target,name) { return target[name] ||= new Element(); }});
  elements.breakdownDimensionButtons = ["category","tag"].map(dimension => Object.assign(new Element(),{dataset:{breakdownDimension:dimension}}));
  elements.tagMatchModeButtons = ["any","all"].map(mode => Object.assign(new Element(),{dataset:{tagMatchMode:mode}}));
  let savedView = saved && JSON.stringify(saved);
  const calls = {};
  const context = {state, elements, UNTAGGED, UNCATEGORIZED:"__ledger_uncategorized__",
    DASHBOARD_VIEW_STORAGE_KEY:"ledger.dashboardView.v1", currency:new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}),
    monthLabel:key=>key, window:{LedgerPreferences:{numberAbbreviation:()=>"none"},localStorage:{
      setItem(_key,value){savedView=value;}, getItem(){return savedView;},
    }}, document:{createElement:()=>new Element()},
    renderCategories:rows=>{calls.categories=rows;}, renderAnnualCharts:rows=>{calls.annual=rows;},
    renderYearComparison:()=>{calls.comparison=true;},
    fetch:()=>{throw new Error("Tag filters must not fetch or write transactions");},
  };
  vm.createContext(context);
  vm.runInContext(read("transaction-ui.js"),context);
  context.transactionUi = context.window.LedgerTransactionUI;
  for(const name of ["saveDashboardView","restoreDashboardView","monthKey","yearKey","selectedMonthKey",
    "isInternalTransfer","isIncome","displayAmount","displaySum","compareLatestFirst",
    "transactionsForSelectedPeriod","excludedInternalTransfersForSelectedPeriod","calculateSummary",
    "numberAbbreviationPreference","formatSummaryAmount","odometerDigitSequence","renderOdometerValue","renderSummary",
    "transactionTags","normalizeTagKey","availableTagKeys","selectedTagSet","transactionMatchesTag",
    "transactionMatchesTagSelection","matchingTagTransactions","tagQueryLabel","toggleTagSelection",
    "renderTagExplorer","breakdownLabel","renderDashboard"]) {
    vm.runInContext(functionSource(name),context);
  }
  for(const [start,end] of [
    ["elements.breakdownDimensionButtons.forEach", "elements.yearSelect.addEventListener"],
    ["elements.tagSearch.addEventListener", "elements.viewTagQueryTransactions.addEventListener"],
    ["elements.viewModeSelect.addEventListener", "elements.todayButton.addEventListener"],
    ["elements.monthSelect.addEventListener", "elements.clearCategoryFilter.addEventListener"],
  ]) {
    const startIndex=source.indexOf(`\n${start}`);
    vm.runInContext(source.slice(startIndex,source.indexOf(`\n${end}`,startIndex)),context);
  }
  const run = code=>vm.runInContext(code,context);
  if(saved) run("restoreDashboardView()");
  run("renderDashboard()");
  return {state,elements,calls,run,
    totals:()=>[elements.totalSpent,elements.totalIncome,elements.netTotal].map(element=>Number(element.dataset.summaryValue)),
    dimension:value=>elements.breakdownDimensionButtons.find(button=>button.dataset.breakdownDimension===value).click(),
    mode:value=>elements.tagMatchModeButtons.find(button=>button.dataset.tagMatchMode===value).click(),
    tag:name=>elements.tagOptions.children.find(button=>button.textContent.split(" · ")[0]===name).click(),
    saved:()=>JSON.parse(savedView),
  };
}

test("monthly summary cards follow OR/AND tag controls, tagged income and exact occurrence counts", async () => {
  const app=dashboard(); assert.deepEqual(app.totals(),[300,1500,1200]);
  app.dimension("tag"); assert.deepEqual(app.totals(),[0,0,0]);
  app.tag("bike"); assert.deepEqual(app.totals(),[255,500,245]);
  assert.match(app.elements.incomeSummaryNote.textContent,/matching selected tags/);
  app.tag("apparel"); assert.deepEqual(app.totals(),[285,500,215]);
  app.mode("all"); assert.deepEqual(app.totals(),[60,0,-60]);
  assert.equal(app.elements.netTotalCard.classList.contains("summary-card--net-negative"),true);
  assert.equal(app.elements.netTotalCard.classList.contains("summary-card--net-positive"),false);
  await Promise.resolve();
  assert.equal(app.elements.totalSpent.title,"$60.00");
  assert.equal(app.elements.totalSpent.children[0].textContent,"$60.00","The final visible reels use the filtered value");
  assert.equal(app.elements.netTotal.children[1].textContent,"-$60.00","Accessible values match visible values");
  app.mode("any"); assert.deepEqual(app.totals(),[285,500,215]);
  assert.equal(app.elements.netTotalCard.classList.contains("summary-card--net-positive"),true);
});

test("annual and monthly summary cards preserve tag scope through period changes", () => {
  const app=dashboard("annual"); app.dimension("tag"); app.tag("bike");
  assert.deepEqual(app.totals(),[275,600,325]);
  assert.equal(app.elements.summaryGrid.getAttribute("aria-label"),"Annual summary for selected tags");
  // The annual renderer still receives the period scope: its spending components
  // apply the query, while the net chart intentionally remains full-year context.
  assert.equal(app.calls.annual.some(row=>row.description==="Other income"),true);
  app.elements.viewModeSelect.value="monthly"; app.elements.viewModeSelect.dispatch("change");
  assert.deepEqual(app.totals(),[255,500,245]);
  app.elements.monthSelect.value="07"; app.elements.monthSelect.dispatch("change");
  assert.deepEqual(app.totals(),[20,100,80]);
  app.elements.monthSelect.value="01"; app.elements.monthSelect.dispatch("change");
  assert.deepEqual(app.totals(),[0,0,0]);
  app.state.viewMode="annual"; app.state.selectedYear="2025"; app.run("renderDashboard()");
  assert.deepEqual(app.totals(),[1000,0,-1000]);
});

test("clearing or nonmatching tags shows zero, category mode restores the full period, and YoY remains independent", () => {
  for(const view of ["monthly","annual"]) {
    const app=dashboard(view); const original=app.totals(); const before=JSON.stringify(app.state.transactions);
    app.dimension("tag"); app.tag("bike"); app.elements.clearTagSelection.click();
    assert.deepEqual(app.totals(),[0,0,0]);
    assert.match(app.elements.netTotalNote.textContent,/Select tags/);
    app.run('toggleTagSelection("Removed tag")'); assert.deepEqual(app.totals(),[0,0,0]);
    app.dimension("category"); assert.deepEqual(app.totals(),original);
    assert.doesNotMatch(app.elements.summaryGrid.getAttribute("aria-label"),/selected tags/);
    assert.match(app.elements.incomeSummaryNote.textContent,/Income received/);
    app.state.viewMode="year-over-year"; app.run("renderDashboard()");
    assert.equal(app.elements.summaryGrid.hidden,true); assert.equal(app.calls.comparison,true);
    assert.equal(JSON.stringify(app.state.transactions),before,"Filtering must never alter stored rows");
  }
});

test("restored Untagged plus AND normalizes once before explorer, summary and annual labels", () => {
  const app=dashboard("annual",{viewMode:"annual",selectedYear:"2026",selectedMonth:"08",
    breakdownDimension:"tag",selectedTags:[UNTAGGED,"bike"],tagMatchMode:"all"});
  assert.equal(app.state.tagMatchMode,"any");
  assert.deepEqual(app.totals(),[290,1600,1310]);
  assert.match(app.elements.tagQueryResult.textContent,/\$290.00 unique spending/);
  assert.match(app.elements.annualBreakdownDescription.textContent,/Untagged OR bike/);
  app.mode("all"); assert.equal(app.state.tagMatchMode,"any","Impossible AND stays disabled");
  app.elements.clearTagSelection.click(); app.tag("Untagged");
  assert.deepEqual(app.totals(),[15,1000,985]);
});

test("tag search changes choices only, and restored selections and edited rows recompute matching totals", () => {
  const app=dashboard(); app.dimension("tag"); app.tag("bike");
  app.elements.tagSearch.value="apparel"; app.elements.tagSearch.dispatch("input");
  assert.deepEqual(app.totals(),[255,500,245]);
  assert.equal(app.elements.tagOptions.children.length,1);
  const restored=dashboard("monthly",app.saved()); assert.deepEqual(restored.totals(),app.totals());
  restored.state.transactions[0]={...restored.state.transactions[0],tags:"tools"};
  restored.run("renderDashboard()"); assert.deepEqual(restored.totals(),[215,500,285]);
  restored.elements.clearTagSelection.click();
  restored.state.transactions.push({date:"2026-08-21",description:"Income only",amount:-123,category:"Income",tags:"salary",flags:""});
  restored.run("renderDashboard()"); restored.tag("salary");
  assert.deepEqual(restored.totals(),[0,123,123]);
});
