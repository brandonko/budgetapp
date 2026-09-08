"use strict";
(() => {
  const el = (id) => document.getElementById(id);
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const model = window.LedgerMerchants;
  let transactions = [], entries = [], selected = "", limit = 20, scope = {}, loaded = false;
  const node = (tag, value) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; return element; };
  function message(value) { el("merchant-status").textContent = value; el("merchant-status").hidden = !value; }
  function detail() {
    const container = el("merchant-detail");
    const item = entries.find((value) => value.id === selected);
    container.replaceChildren();
    if (!item) { container.append(node("h2", "Select a description"), node("p", "See its monthly totals, typical purchase, and recorded activity span.")); return; }
    container.append(node("h2", item.name),
      node("p", item.count + " recorded entries · " + item.firstDate + " to " + item.lastDate),
      node("p", "Typical purchase: " + (item.median === null ? "No positive charges" : currency.format(item.median)) + " · " + item.purchaseCount + " purchases"),
      node("p", "Credits: " + currency.format(item.credits) + " · " + (item.share * 100).toFixed(1) + "% of this period's gross purchases"));
    const link = node("a", "Search matching transactions");
    const query = new URLSearchParams({ description: item.name, startDate: scope.startDate || "", endDate: scope.endDate || "", category: scope.category || "" });
    link.href = "/transactions?" + query.toString();
    container.append(link, node("p", "Opens description search with this date/category scope. Descriptions containing the same phrase may also appear."));
    const table = node("table"); table.className = "merchant-months";
    table.append(node("caption", "Recorded months · net spending"));
    const head = node("thead"), hr = node("tr");
    for (const title of ["Month", "Net spending"]) { const th = node("th", title); th.scope = "col"; hr.append(th); }
    head.append(hr); table.append(head);
    const body = node("tbody");
    for (const month of item.months) { const row = node("tr"); row.append(node("th", month.month), node("td", currency.format(month.spent))); body.append(row); }
    table.append(body); const scroll = node("div"); scroll.className = "merchant-month-scroll"; scroll.append(table); container.append(scroll);
  }
  function render() {
    if (!loaded) return;
    try {
      const result = model.analyze(transactions, { ...scope, merchantSearch: el("merchant-search").value,
        minimumPurchases: el("merchant-minimum").value, sort: el("merchant-sort").value });
      entries = result.entries;
      el("merchant-summary").hidden = false;
      el("merchant-spent").textContent = currency.format(result.summary.spent);
      el("merchant-charges").textContent = currency.format(result.totalCharges);
      el("merchant-count").textContent = String(entries.length);
      el("merchant-scope").textContent = result.summary.count + " budget-counted entries · " + (scope.startDate || "First recorded date") + " through " + (scope.endDate || "latest recorded date") + ". Description groups preserve every transaction occurrence.";
      const list = el("merchant-list"); list.replaceChildren();
      entries.slice(0, limit).forEach((item) => {
        const button = node("button"); button.type = "button"; button.className = "merchant-item"; button.setAttribute("aria-pressed", String(item.id === selected));
        const heading = node("span"), amount = node("span", currency.format(item.spent)); amount.className = "merchant-amount";
        heading.append(node("strong", item.name), amount);
        const bar = node("span"); bar.className = "merchant-bar"; bar.setAttribute("aria-hidden", "true");
        const fill = node("i"); fill.style.width = (item.share * 100) + "%"; bar.append(fill);
        button.append(heading, node("small", item.purchaseCount + " purchases · " + (item.share * 100).toFixed(1) + "% of gross purchases"), bar);
        button.addEventListener("click", () => { selected = item.id; render();
          el("merchant-detail").tabIndex = -1; el("merchant-detail").focus();
          el("merchant-detail").scrollIntoView({ block: "nearest" }); });
        list.append(button);
      });
      if (!entries.length) { const empty = node("p", transactions.length ? "No descriptions match. Try a wider date range or fewer filters." : "No transactions yet. "); empty.className = "merchant-empty";
        if (!transactions.length) { const link = node("a", "Import data to get started."); link.href = "/import"; empty.append(link); } list.append(empty); }
      el("merchant-more").hidden = entries.length <= limit;
      detail();
    } catch (error) { message(error.message); }
  }
  function apply() {
    const start = el("merchant-start").value, end = el("merchant-end").value;
    if (start && end && start > end) { message("Through date must be on or after From. Your previous results are still shown."); return; }
    scope = { startDate: start, endDate: end, category: el("merchant-category").value };
    limit = 20; message(""); render();
  }
  el("merchant-filters").addEventListener("submit", (event) => { event.preventDefault(); apply(); });
  el("merchant-alltime").addEventListener("click", () => { el("merchant-start").value = ""; el("merchant-end").value = ""; apply(); });
  for (const id of ["merchant-search", "merchant-minimum", "merchant-sort"]) el(id).addEventListener(id === "merchant-search" ? "input" : "change", () => { limit = 20; render(); });
  el("merchant-more").addEventListener("click", () => { limit += 20; render(); });
  async function load() {
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok && !(response.status === 404 && payload.code === "transaction_file_missing")) throw Error(payload.error || "Could not load transactions.");
      if (payload.internalTransferReviewRequired) {
        message("Review internal transfers in Settings before viewing spending insights.");
        const link = node("a", " Open Settings"); link.href = "/settings"; el("merchant-status").append(link);
        el("merchant-scope").textContent = "Spending insights are waiting for your transfer review."; return;
      }
      transactions = payload.transactions || []; loaded = true;
      const categories = [...new Set(transactions.filter((tx) => String(tx.category).toLowerCase() !== "income").map((tx) => tx.category).filter(Boolean))].sort();
      categories.forEach((name) => el("merchant-category").append(new Option(name, name)));
      render();
    } catch (error) {
      message(error.message + " "); el("merchant-scope").textContent = "Insights could not be loaded.";
      const retry = node("button", "Try again"); retry.type = "button"; retry.className = "secondary-button"; retry.addEventListener("click", () => { message(""); void load(); }); el("merchant-status").append(retry);
    }
  }
  void load();
})();
