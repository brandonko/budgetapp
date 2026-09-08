"use strict";

(() => {
  const transactionUi = window.LedgerTransactionUI;
  const model = window.LedgerTransactionsModel;
  const PAGE_SIZE = 50;
  const STORAGE_KEY = "ledger.transactions-view.v1";
  const BLANK = "__ledger_blank__";
  const UNTAGGED = "__ledger_untagged__";
  const defaults = () => ({ description: "", category: "", subcategory: "", accountName: "",
    provider: "", group: "", tags: [], tagMode: "any", startDate: "", endDate: "", type: "all", showExcluded: true });
  const key = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const byId = (id) => document.getElementById(id);
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
  const formatDate = (date) => dateFormatter.format(new Date(`${date}T12:00:00Z`));
  const filterForm = byId("alltime-filter-popover");
  const editor = byId("transaction-form");
  const dialog = byId("transaction-form-dialog");
  const tagPicker = byId("tag-picker");
  const field = (name) => filterForm.elements.namedItem(name);
  const state = { transactions: [], taxonomy: [], revision: null, page: 0, loaded: false,
    loading: false, busy: false, editing: null, editingRevision: null, returnFocus: null };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { /* Storage is optional. */ }
  let filters = defaults();
  if (saved.filters && typeof saved.filters === "object") {
    for (const name of Object.keys(filters)) {
      if (typeof filters[name] === "string" && typeof saved.filters[name] === "string") {
        filters[name] = saved.filters[name];
      }
    }
    filters.tags = Array.isArray(saved.filters.tags)
      ? [...new Set(saved.filters.tags.filter((tag) => typeof tag === "string" && tag.trim()).map(key))] : [];
    filters.tagMode = filters.tagMode === "all" ? "all" : "any";
    filters.type = ["all", "income", "spending"].includes(filters.type) ? filters.type : "all";
    filters.showExcluded = saved.filters.showExcluded !== false;
    if (filters.tags.includes(UNTAGGED)) filters.tagMode = "any";
  }
  const periodFilters = window.LedgerPeriodComparisonModel?.parseDrilldown(window.location?.search || "");
  if (periodFilters) filters = { ...defaults(), ...periodFilters };
  byId("alltime-search").value = filters.description;
  const sortControl = transactionUi.createTransactionSortControls(byId("alltime-sort"), {
    initial: saved.sort || {}, onChange: () => updateResults(),
  });
  transactionUi.configureTransactionTagPicker(editor, []);
  const bulk = window.LedgerTransactionBulk.create({
    container: byId("alltime-list"), getTransactions: () => state.transactions,
    getRevision: () => state.revision, render: () => updateResults(false),
    getGroupFilter: () => filters.group, onGroupChange: (value) => { filters.group = value; state.page = 0; },
    onSaved: (payload) => { applyPayload(payload); status(`Updated ${payload.changed} transactions. A safety backup was created.`); },
  });

  function node(tag, text, className = "") {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, onClick, className = "") {
    const element = node("button", text, className);
    element.type = "button";
    element.addEventListener("click", onClick);
    return element;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, sort: sortControl.value() })); }
    catch { /* The view still works when browser storage is unavailable. */ }
  }

  function status(message, error = false) {
    const element = byId("page-status");
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle("settings-status--error", error);
  }

  function uniqueValues(values) {
    const entries = new Map();
    for (const value of values) if (key(value) && !entries.has(key(value))) entries.set(key(value), String(value).trim());
    return [...entries.values()].sort((a, b) => a.localeCompare(b));
  }

  function populateSelect(name, values, selected, label, blankLabel = "") {
    const select = field(name);
    select.replaceChildren(new Option(label, ""));
    if (blankLabel) select.append(new Option(blankLabel, BLANK));
    const options = uniqueValues([...values, selected === BLANK ? "" : selected]);
    for (const value of options) select.append(new Option(value, value));
    select.value = selected === BLANK ? BLANK : options.find((value) => key(value) === key(selected)) || "";
  }

  function populateSubcategories(selected = "") {
    const category = field("category").value;
    const candidates = state.transactions.filter((tx) => !category
      || (category === BLANK ? !key(tx.category) : key(tx.category) === key(category)));
    populateSelect("subcategory", candidates.map((tx) => tx.subcategory), selected, "All subcategories", "No subcategory");
  }

  function populateFilterForm(values = filters) {
    populateSelect("category", state.transactions.map((tx) => tx.category), values.category, "All categories", "Uncategorized");
    populateSubcategories(values.subcategory);
    populateSelect("accountName", state.transactions.map((tx) => tx.accountName), values.accountName, "All accounts");
    populateSelect("provider", state.transactions.map((tx) => tx.provider), values.provider, "All providers");
    for (const name of ["startDate", "endDate", "type"]) field(name).value = values[name];
    field("showExcluded").checked = values.showExcluded;
    field("endDate").setCustomValidity("");
  }

  function closeFilters(returnFocus = false) {
    filterForm.hidden = true;
    byId("alltime-filter-button").setAttribute("aria-expanded", "false");
    if (returnFocus) byId("alltime-filter-button").focus();
  }

  function availableTags() {
    return uniqueValues([...transactionUi.tagsFromTransactions(state.transactions),
      ...filters.tags.filter((tag) => tag !== UNTAGGED)]);
  }

  function tagLabel(tag) {
    return tag === UNTAGGED ? "Untagged" : availableTags().find((value) => key(value) === key(tag)) || tag;
  }

  function renderTagOptions(focusTag = null) {
    const search = key(byId("tag-search").value);
    const options = [UNTAGGED, ...availableTags()];
    const container = byId("tag-options");
    container.replaceChildren();
    for (const tag of options) {
      const label = tag === UNTAGGED ? "Untagged" : tag;
      if (search && !key(label).includes(search)) continue;
      const value = key(tag);
      const toggle = button(label, () => {
        filters.tags = filters.tags.includes(value) ? filters.tags.filter((item) => item !== value) : [...filters.tags, value];
        // No transaction can be both tagged and untagged.
        if (filters.tags.includes(UNTAGGED)) filters.tagMode = "any";
        updateResults();
        renderTagOptions(value);
      });
      toggle.setAttribute("aria-pressed", String(filters.tags.includes(value)));
      container.append(toggle);
      if (focusTag === value) toggle.focus();
    }
    if (!container.children.length) container.append(node("p", "No matching tags.", "alltime-hint"));
  }

  function renderFilterChips() {
    const chips = byId("filter-chips");
    chips.replaceChildren();
    function chip(label, clear) {
      const element = button(`${label} ×`, () => { clear(); updateResults(); }, "transaction-filter-chip");
      element.setAttribute("aria-label", `Remove ${label} filter`);
      chips.append(element);
    }
    const labels = { description: "Description", category: "Category", subcategory: "Subcategory",
      accountName: "Account", provider: "Provider", startDate: "From", endDate: "Through", type: "Activity" };
    for (const [name, label] of Object.entries(labels)) {
      if (!filters[name] || (name === "type" && filters[name] === "all")) continue;
      const value = filters[name] === BLANK ? (name === "category" ? "Uncategorized" : "No subcategory") : filters[name];
      chip(`${label}: ${value}`, () => {
        filters[name] = defaults()[name];
        if (name === "category") filters.subcategory = "";
        if (name === "description") byId("alltime-search").value = "";
      });
    }
    if (!filters.showExcluded) chip("Excluded hidden", () => { filters.showExcluded = true; });
    if (filters.group) chip(`Group: ${filters.group === "__ledger_no_group__" ? "No group" : filters.group}`, () => { filters.group = ""; });
    for (const tag of filters.tags) chip(tagLabel(tag), () => { filters.tags = filters.tags.filter((item) => item !== tag); });
    byId("active-filters").hidden = !chips.children.length;
    const filterCount = ["category", "subcategory", "accountName", "provider", "startDate", "endDate"]
      .filter((name) => filters[name]).length + Number(filters.type !== "all") + Number(!filters.showExcluded);
    byId("alltime-filter-count").textContent = String(filterCount);
    byId("alltime-filter-count").hidden = filterCount === 0;
    byId("alltime-filter-button").classList.toggle("has-active-filters", filterCount > 0);
    byId("selected-tag-count").textContent = String(filters.tags.length);
    byId("selected-tag-count").hidden = !filters.tags.length;
    tagPicker.querySelector("summary").classList.toggle("has-active-filters", filters.tags.length > 0);
    document.querySelectorAll("[data-tag-mode]").forEach((element) => {
      element.setAttribute("aria-pressed", String(element.dataset.tagMode === filters.tagMode));
      element.disabled = element.dataset.tagMode === "all" && filters.tags.includes(UNTAGGED);
    });
    byId("tag-query-hint").textContent = filters.tags.length
      ? filters.tags.map(tagLabel).join(filters.tagMode === "all" ? " AND " : " OR ")
      : "No tags selected · all tags included";
  }

  function renderBreakdown(matching) {
    const container = byId("category-breakdown");
    const categories = model.spendingByCategory(matching);
    const maximum = Math.max(1, ...categories.map((item) => Math.abs(item.total)));
    container.replaceChildren();
    for (const item of categories) {
      const category = item.category || BLANK;
      const control = button(undefined, () => {
        filters.category = key(filters.category) === key(category) ? "" : category;
        filters.subcategory = "";
        updateResults();
      }, "alltime-category");
      control.setAttribute("aria-pressed", String(key(filters.category) === key(category)));
      const heading = node("span");
      heading.append(node("strong", item.category || "Uncategorized"), node("span", currency.format(item.total), "alltime-category-amount"));
      const track = node("span", undefined, "alltime-category-track");
      track.setAttribute("aria-hidden", "true");
      const bar = node("span");
      bar.style.width = `${Math.abs(item.total) / maximum * 100}%`;
      track.append(bar);
      control.append(heading, node("small", `${item.count} transaction${item.count === 1 ? "" : "s"}`), track);
      container.append(control);
    }
    if (!categories.length) container.append(node("p", "No budget-counted spending in this search.", "alltime-empty"));
  }

  function renderResults() {
    const matching = bulk.filter(model.filterTransactions(state.transactions, filters));
    const summary = model.summarizeTransactions(matching);
    byId("matching-spent").textContent = currency.format(summary.spent);
    byId("matching-income").textContent = currency.format(summary.income);
    byId("matching-net").textContent = currency.format(summary.net);
    byId("matching-net-card").classList.toggle("is-positive", summary.net > 0);
    byId("matching-net-card").classList.toggle("is-negative", summary.net < 0);
    const span = summary.startDate ? ` · ${formatDate(summary.startDate)} – ${formatDate(summary.endDate)}` : "";
    byId("matching-scope").textContent = `${summary.count} matching of ${state.transactions.length} recorded transactions${span}. `
      + `${summary.excludedCount} refunded or internal transfer transaction${summary.excludedCount === 1 ? " is" : "s are"} excluded from totals.`;
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const sorted = transactionUi.sortTransactions(matching, sortControl.value());
    const visible = sorted.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    bulk.render(visible, (transaction) => ({
      currency, shortMonthFormatter, showYear: true, onEdit: () => openEditor(transaction),
    }));
    if (!visible.length) {
      const empty = node("p", state.transactions.length ? "No transactions match these filters. Try clearing a filter or widening the date range."
        : "No transactions yet. ", "alltime-empty");
      if (!state.transactions.length) {
        const link = node("a", "Import data to get started.");
        link.href = "/import";
        empty.append(link);
      }
      byId("alltime-list").replaceChildren(empty);
    }
    byId("result-count").textContent = matching.length
      ? `${state.page * PAGE_SIZE + 1}–${state.page * PAGE_SIZE + visible.length} of ${matching.length}` : "0 transactions";
    byId("page-indicator").textContent = `Page ${state.page + 1} of ${pages}`;
    byId("previous-page").disabled = state.page === 0;
    byId("next-page").disabled = state.page === pages - 1;
    renderBreakdown(matching);
    renderFilterChips();
  }

  function updateResults(resetPage = true) {
    if (resetPage) state.page = 0;
    renderResults();
    renderTagOptions();
    persist();
  }

  function populateEditorSuggestions() {
    for (const [name, id] of [["category", "category-options"], ["subcategory", "subcategory-options"],
      ["accountName", "account-name-options"], ["accountType", "account-type-options"], ["provider", "provider-options"]]) {
      const taxonomyValues = name === "category" ? state.taxonomy.map((item) => item.name)
        : name === "subcategory" ? state.taxonomy.flatMap((item) => (item.subcategories || []).map((sub) => sub.name)) : [];
      byId(id).replaceChildren(...uniqueValues([...state.transactions.map((tx) => tx[name]), ...taxonomyValues])
        .map((value) => new Option(value, value)));
    }
    transactionUi.configureTransactionTagPicker(editor, transactionUi.tagsFromTransactions(state.transactions));
  }

  function applyPayload(payload) {
    if (!Array.isArray(payload.transactions) || typeof payload.revision !== "string") {
      throw new Error("Ledger returned an unfamiliar response. Refresh the page before editing.");
    }
    state.transactions = payload.transactions;
    state.revision = payload.revision;
    state.loaded = true;
    updateResults(false);
  }

  async function loadTransactions() {
    if (state.loading || dialog.open) return;
    state.loading = true;
    byId("refresh-transactions").disabled = true;
    status("");
    try {
      const response = await fetch("/api/transactions", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 404 && payload.code === "transaction_file_missing") {
        state.transactions = [];
        state.revision = null;
        state.loaded = true;
        updateResults();
      } else {
        if (!response.ok) throw new Error(payload.error || "Could not load transactions.");
        applyPayload(payload);
      }
    } catch (error) {
      status(`${error.message} Use Refresh to try again.`, true);
      if (!state.loaded) byId("matching-scope").textContent = "Transactions could not be loaded.";
    } finally {
      state.loading = false;
      byId("refresh-transactions").disabled = false;
    }
  }

  function openEditor(transaction) {
    if (state.loading || state.busy) return;
    state.editing = transaction;
    // Keep the revision paired with this exact row, even if other data changes.
    state.editingRevision = state.revision;
    state.returnFocus = document.activeElement;
    populateEditorSuggestions();
    transactionUi.populateTransactionEditor(editor, transaction);
    byId("form-eyebrow").textContent = "Update transaction";
    byId("form-title").textContent = "Edit transaction";
    byId("delete-transaction-button").hidden = false;
    byId("form-error").hidden = true;
    byId("refresh-transactions").disabled = true;
    closeFilters();
    tagPicker.open = false;
    dialog.showModal();
  }

  function closeEditor(force = false) {
    if (state.busy && !force) return;
    dialog.close();
    state.editing = null;
    byId("refresh-transactions").disabled = false;
    if (state.returnFocus?.isConnected) state.returnFocus.focus();
    else {
      byId("results-title").tabIndex = -1;
      byId("results-title").focus({ preventScroll: true });
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const control of editor.elements) control.disabled = busy;
    if (!busy) transactionUi.refreshTransactionTagPicker(editor);
    byId("save-transaction-button").textContent = busy ? "Saving…" : "Save transaction";
  }

  async function mutate(method) {
    if (!state.editing || state.busy) return;
    const original = state.editing;
    const body = { revision: state.editingRevision };
    if (method === "PUT") body.transaction = transactionUi.transactionFromEditor(editor, original);
    setBusy(true);
    byId("form-error").hidden = true;
    try {
      const response = await fetch(`/api/transactions/${original._id}`, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Could not save transaction (${response.status}).`);
      applyPayload(payload);
      closeEditor(true);
      status(method === "DELETE" ? "Transaction deleted. Totals have been updated." : "Transaction saved. Your search and filters have been kept.");
    } catch (error) {
      byId("form-error").textContent = error.message;
      byId("form-error").hidden = false;
    } finally { setBusy(false); }
  }

  byId("alltime-search").addEventListener("input", (event) => { filters.description = event.target.value; updateResults(); });
  byId("alltime-filter-button").addEventListener("click", () => {
    if (!filterForm.hidden) { closeFilters(true); return; }
    tagPicker.open = false;
    populateFilterForm();
    filterForm.hidden = false;
    byId("alltime-filter-button").setAttribute("aria-expanded", "true");
    field("category").focus();
  });
  field("category").addEventListener("change", () => populateSubcategories());
  for (const name of ["startDate", "endDate"]) field(name).addEventListener("input", () => field("endDate").setCustomValidity(""));
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = field("startDate").value;
    const end = field("endDate").value;
    if (start && end && start > end) {
      field("endDate").setCustomValidity("Through date must be on or after the From date.");
      field("endDate").reportValidity();
      return;
    }
    for (const name of ["category", "subcategory", "accountName", "provider", "startDate", "endDate", "type"]) filters[name] = field(name).value;
    filters.showExcluded = field("showExcluded").checked;
    closeFilters(true);
    updateResults();
  });
  byId("reset-alltime-filters").addEventListener("click", () => populateFilterForm(defaults()));
  byId("clear-alltime-filters").addEventListener("click", () => {
    filters = defaults();
    byId("alltime-search").value = "";
    updateResults();
  });
  document.querySelectorAll("[data-tag-mode]").forEach((element) => element.addEventListener("click", () => {
    filters.tagMode = element.dataset.tagMode;
    updateResults();
  }));
  byId("tag-search").addEventListener("input", () => renderTagOptions());
  tagPicker.addEventListener("toggle", () => {
    if (tagPicker.open) { closeFilters(); renderTagOptions(); byId("tag-search").focus(); }
  });
  byId("close-tag-picker").addEventListener("click", () => { tagPicker.open = false; tagPicker.querySelector("summary").focus(); });
  document.addEventListener("click", (event) => {
    // A tag click rerenders its button before bubbling; use the original event
    // path so selecting several tags never accidentally closes the picker.
    const path = event.composedPath();
    if (!path.includes(filterForm) && !path.includes(byId("alltime-filter-button"))) closeFilters();
    if (!path.includes(tagPicker)) tagPicker.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!filterForm.hidden) { closeFilters(true); event.preventDefault(); }
    if (tagPicker.open) { tagPicker.open = false; tagPicker.querySelector("summary").focus(); event.preventDefault(); }
  });
  for (const [id, step] of [["previous-page", -1], ["next-page", 1]]) byId(id).addEventListener("click", () => {
    state.page = Math.max(0, state.page + step);
    updateResults(false);
    byId("results-title").scrollIntoView({ block: "start" });
  });
  byId("refresh-transactions").addEventListener("click", loadTransactions);
  byId("close-form-dialog").addEventListener("click", () => closeEditor());
  byId("cancel-form-button").addEventListener("click", () => closeEditor());
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeEditor(); });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeEditor();
  });
  editor.addEventListener("submit", (event) => { event.preventDefault(); if (editor.reportValidity()) void mutate("PUT"); });
  byId("delete-transaction-button").addEventListener("click", () => {
    if (!state.editing || state.busy) return;
    if (window.confirm(`Permanently delete “${state.editing.description}” for ${currency.format(state.editing.amount)}?\n\nThis removes the transaction from the master CSV.`)) void mutate("DELETE");
  });
  populateFilterForm();
  renderTagOptions();
  void loadTransactions();
  // Saved taxonomy values are suggestions only, never additional transactions.
  void fetch("/api/taxonomy", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
    .then((payload) => { if (Array.isArray(payload?.categories)) state.taxonomy = payload.categories; }).catch(() => {});
})();
