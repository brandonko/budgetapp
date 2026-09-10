"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else {
    let storage; try { storage = root.localStorage; } catch { /* Optional browser preference. */ }
    factory(document, { model: root.LedgerPeriodComparisonModel, fetch: root.fetch.bind(root), storage });
  }
})(typeof window === "undefined" ? globalThis : window, function mountPeriods(document, dependencies) {
  const { model, fetch, storage, now = () => new Date() } = dependencies;
  const el = (id) => document.getElementById(`period-${id}`);
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const signed = (value) => `${value > 0 ? "+" : ""}${currency.format(value)}`;
  let rows = [], loaded = false, loading = false, stored = null;
  try { stored = JSON.parse(storage?.getItem("ledger.period-comparison.v1") || "null"); } catch { /* Invalid view state is ignored. */ }
  function node(tag, text, className = "") {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
    if (className) element.className = className; return element;
  }
  function status(message, error = false) {
    el("status").textContent = message; el("status").hidden = !message;
    el("status").classList.toggle("settings-status--error", error);
  }
  function ranges() { return Object.fromEntries(["focus", "baseline"].map((name) => [name, { startDate: el(`${name}-start`).value, endDate: el(`${name}-end`).value }])); }
  function setRange(name, range) { el(`${name}-start`).value = range.startDate; el(`${name}-end`).value = range.endDate; }
  function render() {
    if (!loaded) return;
    const selected = ranges();
    const focusError = model.validateRange(selected.focus), baselineError = model.validateRange(selected.baseline);
    const error = focusError ? `Focus period: ${focusError}` : baselineError ? `Comparison: ${baselineError}` : "";
    el("validation").textContent = error; el("validation").hidden = !error; el("results").hidden = !!error;
    el("previous").disabled = !!focusError; el("previous-year").disabled = !!focusError; el("swap").disabled = !!error;
    for (const name of ["focus", "baseline"]) el(`${name}-caption`).textContent = model.validateRange(selected[name]) ? "" : `${model.days(selected[name])} calendar days · both dates included`;
    if (error) return;
    let result;
    try { result = model.comparePeriods(rows, selected.focus, selected.baseline); }
    catch { el("results").hidden = true; status("Some recorded amounts could not be summarized. Check your transaction file and refresh.", true); return; }
    try { storage?.setItem("ledger.period-comparison.v1", JSON.stringify(selected)); } catch { /* Read-only reporting remains available. */ }
    const equalDays = result.focus.days === result.baseline.days;
    const overlaps = selected.focus.startDate <= selected.baseline.endDate && selected.baseline.startDate <= selected.focus.endDate;
    el("scope").textContent = `Focus: ${result.focus.count} recorded rows (${result.focus.excludedCount} excluded from totals). Comparison: ${result.baseline.count} rows (${result.baseline.excludedCount} excluded). `
      + (equalDays ? "These periods have the same number of days. " : "These periods have different lengths; use the daily averages for context. ")
      + (overlaps ? "The periods overlap, so some transactions appear in both. " : "")
      + ((!result.focus.count || !result.baseline.count) ? "A period has no recorded activity; this does not establish complete coverage." : "");
    el("metrics").replaceChildren();
    for (const [metric, title] of [["spent", "Spending"], ["income", "Income"], ["net", "Net total"]]) {
      const card = node("article", undefined, "period-metric");
      const change = result.differences[metric];
      const favorable = metric === "spent" ? change.delta < 0 : change.delta > 0;
      const baseline = node("p", `${currency.format(result.baseline[metric])} comparison · ${currency.format(result.baseline.perDay[metric])}/day`, "period-metric-baseline");
      const delta = node("span", `${signed(change.delta)}${change.percent === null ? " · % not applicable" : ` · ${change.percent > 0 ? "+" : ""}${percent.format(change.percent)}%`}`,
        `period-delta${change.delta ? favorable ? " is-favorable" : " is-unfavorable" : ""}`);
      card.append(node("h2", title), node("strong", currency.format(result.focus[metric]), "period-metric-value"),
        node("small", `Focus period · ${currency.format(result.focus.perDay[metric])}/day`), baseline, delta);
      el("metrics").append(card);
    }
    el("category-rows").replaceChildren();
    for (const category of result.categories) {
      const row = node("tr"); const name = category.category || "Uncategorized";
      const heading = node("th", name); heading.setAttribute("scope", "row"); row.append(heading);
      for (const period of ["focus", "baseline"]) {
        const cell = node("td");
        if (category[`${period}Count`]) {
          const link = node("a", currency.format(category[period]));
          link.href = model.drilldownUrl(selected[period], { category: category.category || "__ledger_blank__", type: "spending" });
          link.setAttribute("aria-label", `${name}: ${currency.format(category[period])} in ${period === "focus" ? "focus" : "comparison"} period. View transactions`);
          cell.append(link);
        } else { cell.textContent = "—"; cell.setAttribute("aria-label", "No counted transactions"); }
        row.append(cell);
      }
      row.append(node("td", signed(category.delta)), node("td", category.percent === null ? "—" : `${category.percent > 0 ? "+" : ""}${percent.format(category.percent)}%`));
      el("category-rows").append(row);
    }
    el("category-empty").hidden = result.categories.length > 0;
    el("focus-link").href = model.drilldownUrl(selected.focus);
    el("baseline-link").href = model.drilldownUrl(selected.baseline);
  }
  function preset(kind) {
    try { setRange("baseline", model[kind](ranges().focus)); render(); }
    catch (error) { el("validation").textContent = error.message; el("validation").hidden = false; }
  }
  async function load() {
    if (loading) return;
    loading = true; loaded = false; el("refresh").disabled = true;
    for (const name of ["content", "setup", "review"]) el(name).hidden = true;
    status("Loading your transactions…");
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" }); const payload = await response.json();
      if (response.status === 404 && payload.code === "transaction_file_missing") rows = [];
      else {
        if (!response.ok) throw new Error("Could not load your records. Use Refresh records to try again.");
        if (!Array.isArray(payload.transactions)) throw new Error("Ledger returned an unfamiliar response. Try refreshing your records.");
        rows = payload.transactions;
      }
      if (payload.internalTransferReviewRequired) { el("review").hidden = false; status(""); return; }
      if (!rows.length) { el("setup").hidden = false; status(""); return; }
      if (!stored || model.validateRange(stored.focus) || model.validateRange(stored.baseline)) {
        const date = now(); const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        stored = model.defaultPeriods(rows, today);
      }
      setRange("focus", stored.focus); setRange("baseline", stored.baseline);
      loaded = true; el("content").hidden = false; status(""); render();
    } catch (error) { status(error instanceof Error ? error.message : "Could not load your records. Try again.", true); }
    finally { loading = false; el("refresh").disabled = false; }
  }
  for (const name of ["focus", "baseline"]) for (const bound of ["start", "end"]) el(`${name}-${bound}`).addEventListener("input", () => { render(); if (!model.validateRange(ranges().focus) && !model.validateRange(ranges().baseline)) stored = ranges(); });
  el("previous").addEventListener("click", () => { preset("previousPeriod"); stored = ranges(); });
  el("previous-year").addEventListener("click", () => { preset("previousYear"); stored = ranges(); });
  el("swap").addEventListener("click", () => { const current = ranges(); setRange("focus", current.baseline); setRange("baseline", current.focus); render(); stored = ranges(); });
  el("refresh").addEventListener("click", load);
  const ready = load(); return { ready, load };
});
