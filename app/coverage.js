"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else {
    let storage;
    try { storage = root.localStorage; } catch { /* Browser storage may be disabled. */ }
    factory(document, { model: root.LedgerCoverageModel, fetch: root.fetch.bind(root), storage });
  }
})(typeof window === "undefined" ? globalThis : window, function mountCoverage(document, dependencies) {
  const { model, fetch, storage, now = () => new Date() } = dependencies;
  const el = (id) => document.getElementById(`coverage-${id}`);
  const count = (value) => new Intl.NumberFormat("en-US").format(value);
  const date = (value) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const stamp = (value) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const localToday = () => { const value = now(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; };
  let rows = [], loading = false, today = localToday(), selectedYear = "";
  try { const saved = JSON.parse(storage?.getItem("ledger.coverage-view.v1") || "null");
    if (saved && /^\d{4}$/.test(saved.year)) selectedYear = saved.year;
    if (saved && [14, 30, 60, 90].includes(saved.olderThan)) el("threshold").value = String(saved.olderThan);
  } catch { /* Optional preferences cannot block this read-only report. */ }
  function node(tag, text, className = "") {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(message, error = false) {
    el("status").textContent = message; el("status").hidden = !message;
    el("status").classList.toggle("settings-status--error", error);
  }
  function render() {
    const olderThan = Number(el("threshold").value) || 30;
    const report = model.buildCoverage(rows, { today, year: selectedYear, olderThan, query: el("search").value });
    try { storage?.setItem("ledger.coverage-view.v1", JSON.stringify({ year: selectedYear, olderThan })); } catch { /* Storage is optional. */ }
    el("account-total").textContent = count(report.totalAccounts);
    el("row-total").textContent = count(report.totalRows);
    el("older-label").textContent = `Last activity over ${olderThan} days ago`;
    el("older-total").textContent = count(report.olderAccounts);
    el("as-of").textContent = `As of ${date(today)} · all recorded accounts`;
    el("results-count").textContent = `${report.accounts.length} of ${report.totalAccounts} accounts shown for ${selectedYear}.`;
    el("unknown-imports").textContent = `${count(report.unknownImportCount)} recorded rows have no usable import timestamp.`;
    const accounts = el("accounts"); accounts.replaceChildren();
    for (const account of report.accounts) {
      const card = node("article", undefined, "coverage-account");
      const heading = node("div", undefined, "coverage-account-heading");
      const title = node("div");
      title.append(node("h3", account.accountName || "Unnamed account"), node("p", `${account.provider || "No provider"} · ${account.accountType || "No account type"}`));
      const age = account.age === null ? "No dated activity" : account.age < 0 ? "Future-dated activity"
        : account.age === 0 ? "Activity today" : `${count(account.age)} days since activity`;
      heading.append(title, node("span", age, `coverage-age${account.older ? " is-older" : ""}`));
      const months = node("ol", undefined, "coverage-months");
      months.setAttribute("aria-label", `Recorded transactions by month in ${selectedYear}`);
      for (let month = 0; month < 12; month += 1) {
        const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1)));
        const cell = node("li", undefined, `coverage-month${account.months[month] ? " has-activity" : ""}`);
        cell.setAttribute("aria-label", `${label} ${selectedYear}: ${account.months[month] ? `${count(account.months[month])} recorded transactions` : "no recorded activity"}`);
        cell.append(node("span", label), node("strong", account.months[month] ? count(account.months[month]) : "—")); months.append(cell);
      }
      const facts = node("dl", undefined, "coverage-account-facts");
      for (const [label, value] of [
        [`${selectedYear} activity`, `${count(account.yearCount)} rows · ${account.activeMonths} of 12 months`],
        ["Recorded date span", account.firstDate ? `${date(account.firstDate)} – ${date(account.lastDate)}` : "No valid recorded dates"],
        ["Latest recorded import", account.latestImport === null ? "No import timestamp" : stamp(account.latestImport)],
      ]) { const fact = node("div"); fact.append(node("dt", label), node("dd", value)); facts.append(fact); }
      card.append(heading, months, facts); accounts.append(card);
    }
    if (!report.accounts.length) accounts.append(node("p", "No accounts match this search. Try a different name or provider.", "coverage-hint"));
  }
  async function load() {
    if (loading) return;
    loading = true; el("refresh").disabled = true;
    el("content").hidden = true; el("setup").hidden = true; status("Loading your recorded activity…");
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 404 && payload.code === "transaction_file_missing") rows = [];
      else {
        if (!response.ok) throw new Error("Could not load your records. Use Refresh records to try again.");
        if (!Array.isArray(payload.transactions)) throw new Error("Ledger returned an unfamiliar response. Try refreshing your records.");
        rows = payload.transactions;
      }
      today = localToday();
      const available = model.buildCoverage(rows, { today });
      if (!available.years.includes(selectedYear)) {
        const currentYear = today.slice(0, 4);
        selectedYear = available.years.includes(currentYear) ? currentYear : available.years[0];
      }
      el("year").replaceChildren(...available.years.map((year) => { const option = node("option", year); option.value = year; return option; }));
      el("year").value = selectedYear;
      el("setup").hidden = rows.length > 0; el("content").hidden = rows.length === 0;
      if (rows.length) render();
      status("");
    } catch (error) { status(error instanceof Error ? error.message : "Could not load your records. Try again.", true); }
    finally { loading = false; el("refresh").disabled = false; }
  }
  el("search").addEventListener("input", render);
  el("threshold").addEventListener("change", render);
  el("year").addEventListener("change", () => { selectedYear = el("year").value; render(); });
  el("refresh").addEventListener("click", load);
  const ready = load();
  return { ready, load };
});
