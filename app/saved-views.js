"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LedgerSavedViews = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const STORAGE_KEY = "ledger.saved-transaction-views.v1";
  const PERIODS = { fixed: "Keep current dates", month: "This month", lastMonth: "Last month", last30: "Last 30 days", year: "This year", all: "All time" };
  const text = (value) => typeof value === "string" ? value.trim().slice(0, 200) : "";
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z"))
      && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  }
  function normalizeView(view = {}) {
    const source = view.filters || {};
    const filters = {};
    for (const field of ["description", "category", "subcategory", "accountName", "provider", "group"]) filters[field] = text(source[field]);
    filters.tags = [...new Set((Array.isArray(source.tags) ? source.tags : []).map(text).filter(Boolean))].slice(0, 50);
    filters.tagMode = source.tagMode === "all" && !filters.tags.includes("__ledger_untagged__") ? "all" : "any";
    filters.showExcluded = source.showExcluded !== false;
    filters.type = ["income", "spending"].includes(source.type) ? source.type : "all";
    for (const field of ["startDate", "endDate"]) {
      const value = text(source[field]);
      if (value && !validDate(value)) throw new Error("Correct the saved view's dates before saving.");
      filters[field] = value;
    }
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new Error("The end date must follow the start date.");
    const sort = { field: ["date", "description", "cost"].includes(view.sort?.field) ? view.sort.field : "date",
      direction: view.sort?.direction === "asc" ? "asc" : "desc" };
    return { filters, sort, period: Object.hasOwn(PERIODS, view.period) ? view.period : "fixed" };
  }
  function resolveView(view, now = new Date()) {
    const result = normalizeView(view);
    const today = new Date(0);
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    const date = (value) => value.toISOString().slice(0, 10);
    let start = new Date(today), end = new Date(today);
    switch (result.period) {
      case "month": start.setUTCDate(1); break;
      case "lastMonth": start.setUTCDate(1); end = new Date(start); end.setUTCDate(0); start.setUTCMonth(start.getUTCMonth() - 1); break;
      case "last30": start.setUTCDate(start.getUTCDate() - 29); break;
      case "year": start.setUTCMonth(0, 1); break;
      case "all": result.filters.startDate = ""; result.filters.endDate = ""; return result;
      default: return result;
    }
    result.filters.startDate = date(start); result.filters.endDate = date(end);
    return result;
  }
  function read(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error("Saved views could not be read. Existing saved views have been preserved."); }
    if (!Array.isArray(parsed) || parsed.length > 50) throw new Error("Saved views have an unsupported format.");
    return parsed.map((item) => {
      if (!item || !text(item.name) || !text(item.id)) throw new Error("A saved view is invalid. Existing views have been preserved.");
      return { id: text(item.id), name: text(item.name), ...normalizeView(item) };
    });
  }
  function write(storage, { action, id, name, view }) {
    const list = read(storage);
    const index = list.findIndex((item) => item.id === id);
    if (action !== "create" && index < 0) throw new Error("This view was removed in another tab. Select it again.");
    if (action === "delete") list.splice(index, 1);
    else {
      const label = text(name);
      if (!label) throw new Error("Name this view first.");
      if (list.some((item, i) => i !== index && item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error("Choose a unique view name.");
      if (action === "create" && list.length >= 50) throw new Error("You can keep up to 50 saved views.");
      const item = action === "rename" ? { ...list[index], name: label }
        : { id, name: label, ...normalizeView(view) };
      if (action === "create") list.push(item); else list[index] = item;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
    return list;
  }
  function mount({ container, getView, applyView }) {
    if (!container) return;
    const element = (tag, content) => { const el = document.createElement(tag); if (content) el.textContent = content; return el; };
    const top = element("div"); top.className = "saved-views-heading";
    const heading = element("strong", "Saved views");
    const hint = element("span", "Keep useful searches a click away. Saved in this browser.");
    top.append(heading, hint);
    const form = element("form"); form.className = "saved-views-controls";
    const label = (name, input) => { const el = element("label", name); el.append(input); return el; };
    const select = element("select"); select.id = "saved-view-select";
    const name = element("input"); name.id = "saved-view-name"; name.maxLength = 80; name.placeholder = "e.g. Monthly groceries";
    const period = element("select"); period.id = "saved-view-period";
    for (const [value, title] of Object.entries(PERIODS)) { const option = element("option", title); option.value = value; period.append(option); }
    const message = element("p"); message.id = "saved-view-status"; message.setAttribute("role", "status"); message.hidden = true;
    const action = (title, id, callback) => { const el = element("button", title); el.id = id; el.type = "button"; el.className = "secondary-button"; el.addEventListener("click", callback); return el; };
    function report(text, error = false) { message.textContent = text; message.hidden = !text; message.className = error ? "saved-views-error" : ""; }
    function attempt(callback) { try { callback(); } catch (error) { report(error.message || "Browser storage is unavailable. No saved views were changed.", true); } }
    function render(selected = select.value) {
      const list = read(localStorage).sort((a, b) => a.name.localeCompare(b.name));
      select.replaceChildren(new Option("Choose a saved view…", ""));
      list.forEach((item) => select.append(new Option(item.name, item.id)));
      select.value = list.some((item) => item.id === selected) ? selected : "";
      update.disabled = rename.disabled = remove.disabled = !select.value;
    }
    function selected() { const view = read(localStorage).find((item) => item.id === select.value); if (!view) throw new Error("Choose a saved view."); return view; }
    function save(action) { attempt(() => {
      const id = action === "create" ? crypto.randomUUID() : select.value;
      write(localStorage, { action, id, name: name.value, view: { ...getView(), period: period.value } });
      render(id); report(action === "create" ? "View saved. Choose it anytime to restore these filters." : "Saved view updated.");
    }); }
    const create = action("Save new view", "saved-view-create", () => save("create"));
    const update = action("Update selected", "saved-view-update", () => save("update"));
    const rename = action("Rename", "saved-view-rename", () => save("rename"));
    const remove = action("Delete", "saved-view-delete", () => attempt(() => {
      const item = selected();
      if (!window.confirm('Delete saved view “' + item.name + '”? Your transactions will stay unchanged.')) return;
      write(localStorage, { action: "delete", id: item.id }); render(""); report("Saved view deleted.");
    }));
    select.addEventListener("change", () => attempt(() => {
      if (!select.value) { render(""); return; }
      const item = selected();
      applyView(resolveView(item));
      name.value = item.name; period.value = item.period; render(item.id);
      report("View applied · " + PERIODS[item.period] + ". Changes to filters do not alter the saved view until you update it.");
    }));
    form.addEventListener("submit", (event) => { event.preventDefault(); save("create"); });
    form.append(label("Open view", select), label("View name", name), label("Dates when reopened", period), create, update, rename, remove);
    container.append(top, form, message);
    attempt(() => render());
    window.addEventListener?.("storage", (event) => { if (event.key === STORAGE_KEY) attempt(() => render()); });
  }
  return Object.freeze({ normalizeView, resolveView, read, write, mount, STORAGE_KEY });
});
