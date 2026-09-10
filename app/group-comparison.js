"use strict";

// Read-only comparison workspace. Transaction inspection delegates back to the
// existing list/editor, so filters, bulk actions and safety checks stay shared.
(function initializeGroupComparison(globalObject) {
  const STORAGE_KEY = "ledger.group-comparison.v1";
  const key = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
  const date = (value) => dateFormat.format(new Date(`${value}T12:00:00Z`));
  const node = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (text, handler, className = "text-button") => {
    const element = node("button", text, className);
    element.type = "button"; element.addEventListener("click", handler); return element;
  };
  const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

  function create({ onInspect }) {
    const byId = (id) => document.getElementById(id);
    const model = globalObject.LedgerTransactionsModel;
    const panel = byId("group-comparison-panel");
    const picker = byId("comparison-group-picker");
    const start = byId("comparison-start-date");
    const end = byId("comparison-end-date");
    let transactions = [];
    let allCategories = false;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { /* Optional storage. */ }
    const chosen = new Map();
    for (const name of Array.isArray(saved.groups) ? saved.groups : []) {
      if (typeof name === "string" && key(name) && name.length <= 100 && chosen.size < 4) chosen.set(key(name), name);
    }
    const state = { groups: [...chosen.values()], baseline: typeof saved.baseline === "string" ? key(saved.baseline) : "",
      startDate: typeof saved.startDate === "string" && validDate(saved.startDate) ? saved.startDate : "",
      endDate: typeof saved.endDate === "string" && validDate(saved.endDate) ? saved.endDate : "" };
    if (state.startDate && state.endDate && state.startDate > state.endDate) state.startDate = state.endDate = "";
    const initialColors = Array.isArray(saved.colorSlots) ? saved.colorSlots.filter((entry) => Array.isArray(entry) && entry[1] < 4) : [];
    const colorSlots = globalObject.LedgerTransactionUI.createSeriesColorSlots({ size: 4, initial: initialColors });
    start.value = state.startDate; end.value = state.endDate;
    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, colorSlots: colorSlots.snapshot() })); } catch { /* Still works without persistence. */ }
    }
    function closePicker(focus = false) {
      picker.hidden = true; byId("choose-comparison-groups").setAttribute("aria-expanded", "false");
      if (focus) byId("choose-comparison-groups").focus();
    }
    function inspect(group, category) { closePicker(); onInspect({ group: group.name, category, startDate: state.startDate, endDate: state.endDate }); }
    function renderPicker(focusKey = null) {
      const names = globalObject.LedgerTransactionUI.groupsFromTransactions(transactions);
      const search = key(byId("comparison-group-search").value);
      const options = byId("comparison-group-options"); options.replaceChildren();
      let focusButton;
      for (const name of names.filter((name) => key(name).includes(search))) {
        const selected = state.groups.some((value) => key(value) === key(name));
        const control = button(name, () => {
          state.groups = selected ? state.groups.filter((value) => key(value) !== key(name)) : [...state.groups, name];
          render(); renderPicker(key(name));
        }, "comparison-group-option");
        control.setAttribute("aria-pressed", String(selected));
        control.setAttribute("aria-label", name);
        control.disabled = !selected && state.groups.length >= 4;
        if (control.disabled) control.title = "Remove a selected group to compare another (maximum 4).";
        options.append(control);
        if (focusKey === key(name)) focusButton = control;
      }
      if (!options.children.length) options.append(node("p", names.length ? "No groups match your search." : "No groups yet. Assign a group using Edit or Edit multiple in Transactions."));
      focusButton?.focus({ preventScroll: true });
    }
    function swatch() { const element = node("span", undefined, "comparison-swatch"); element.setAttribute("aria-hidden", "true"); return element; }
    function color(element, group) { element.style.setProperty("--group-color", `var(--viz-${colorSlots.slot(group.key) + 1})`); }
    function track(value, minimum, maximum) {
      const extent = maximum - minimum || 1;
      const zero = -minimum / extent * 100;
      const position = (value - minimum) / extent * 100;
      const wrapper = node("span", undefined, "comparison-bar-track"); wrapper.setAttribute("aria-hidden", "true");
      const origin = node("span", undefined, "comparison-bar-zero"); origin.style.left = `${zero}%`;
      const bar = node("span", undefined, "comparison-bar-fill");
      bar.style.left = `${Math.min(zero, position)}%`; bar.style.width = `${Math.abs(position - zero)}%`;
      wrapper.append(origin, bar); return wrapper;
    }
    function render() {
      const result = model.compareGroups(transactions, state.groups, state);
      state.groups = result.groups.map((group) => group.name); state.baseline = result.baseline;
      const { groups } = result;
      colorSlots.sync(groups.map((group) => group.key));
      const selected = byId("comparison-selected-groups"); selected.replaceChildren();
      groups.forEach((group) => {
        const chip = button(undefined, () => {
          state.groups = state.groups.filter((name) => key(name) !== group.key); render(); byId("choose-comparison-groups").focus();
        }, "comparison-selected-group");
        chip.setAttribute("aria-label", `Remove ${group.name} from comparison`);
        chip.append(swatch(), node("span", group.name), node("span", "×")); color(chip, group); selected.append(chip);
      });
      byId("choose-comparison-groups").textContent = groups.length ? `Choose groups (${groups.length}/4)` : "Choose groups +";
      byId("comparison-scope").textContent = `${state.startDate || state.endDate
        ? `${state.startDate ? date(state.startDate) : "First recorded transaction"} – ${state.endDate ? date(state.endDate) : "Latest recorded transaction"}`
        : "All recorded history"} · Transactions search filters do not apply here.`;
      const empty = byId("comparison-empty"); empty.hidden = groups.length >= 2;
      empty.replaceChildren(node("h3", groups.length ? "Add another group to compare." : "What would you like to compare?"),
        node("p", transactions.some((row) => key(row.group))
          ? "Choose 2–4 groups above — for example, two bike builds or a few past trips."
          : "Assign groups to your transactions first. Use Edit multiple to group a bike build, a trip, or another project."));
      byId("comparison-results").hidden = !groups.length;
      const baseline = byId("comparison-baseline"); baseline.replaceChildren(...groups.map((group) => new Option(group.name, group.key)));
      baseline.value = state.baseline; baseline.disabled = groups.length < 2;
      const cards = byId("comparison-cards"); cards.replaceChildren();
      groups.forEach((group) => {
        const card = node("article", undefined, "group-compare-card"); color(card, group);
        const heading = node("h3"); heading.append(swatch(), node("span", group.name));
        card.append(heading, node("span", "Spending", "comparison-metric-label"), node("strong", group.count ? money.format(group.spent) : "—", "comparison-total"));
        const difference = group.key === state.baseline ? "Reference group" : group.difference === null ? "No activity to compare"
          : group.difference === 0 ? "Same spending as reference" : `${money.format(Math.abs(group.difference))} ${group.difference > 0 ? "more" : "less"} than reference`;
        card.append(node("p", difference, "comparison-difference"));
        if (!group.count) card.append(node("p", group.savedCount ? "No transactions in this date range." : "No saved transactions remain in this group.", "comparison-card-note"));
        else {
          card.append(node("p", `${group.count} transaction${group.count === 1 ? "" : "s"} · ${group.excludedCount} excluded`, "comparison-card-note"));
          if (group.credits) card.append(node("p", `${money.format(group.purchases)} purchases − ${money.format(group.credits)} credits`, "comparison-card-note"));
          if (group.income) card.append(node("p", `${money.format(group.income)} income · shown separately`, "comparison-card-note"));
          card.append(node("p", `Recorded activity: ${date(group.startDate)}${group.startDate !== group.endDate ? ` – ${date(group.endDate)}` : ""}`, "comparison-card-note"));
        }
        const view = button("View transactions →", () => inspect(group)); view.disabled = !group.count;
        view.setAttribute("aria-label", `View transactions for ${group.name}`); card.append(view); cards.append(card);
      });
      const minimum = Math.min(0, ...groups.map((group) => group.spent));
      const maximum = Math.max(0, ...groups.map((group) => group.spent));
      const bars = byId("comparison-spending-bars"); bars.replaceChildren();
      groups.forEach((group) => {
        const control = button(undefined, () => inspect(group), "comparison-spend-row"); color(control, group);
        control.disabled = !group.count;
        const title = node("span", undefined, "comparison-spend-name"); title.append(swatch(), node("span", group.name));
        control.append(title, track(group.spent, minimum, maximum), node("strong", group.count ? money.format(group.spent) : "—")); bars.append(control);
      });
      const scale = node("p", `Scale: ${money.format(minimum)} to ${money.format(maximum)}. ${minimum < 0 ? "Bars left of zero mean credits exceed purchases." : "Bars start at zero."}`, "alltime-hint"); bars.append(scale);
      renderCategories(result);
      renderPicker(); persist();
    }
    function renderCategories({ groups, categories }) {
      const root = byId("comparison-category-table"); root.replaceChildren();
      const toggle = byId("comparison-category-toggle"); toggle.hidden = categories.length <= 6;
      toggle.textContent = allCategories ? "Show top 6" : `Show all ${categories.length} categories`;
      toggle.setAttribute("aria-expanded", String(allCategories));
      if (!categories.length) { root.append(node("p", "No budget-counted spending categories in this selection.", "alltime-hint")); return; }
      const table = node("table"); const caption = node("caption", "Each category uses a shared dollar scale across groups. A dash means no counted transactions; $0.00 means they net to zero.");
      const head = node("thead"); const headings = node("tr"); const first = node("th", "Category"); first.setAttribute("scope", "col"); headings.append(first);
      groups.forEach((group) => { const cell = node("th"); cell.setAttribute("scope", "col"); color(cell, group); cell.append(swatch(), node("span", group.name)); headings.append(cell); });
      head.append(headings); const body = node("tbody");
      for (const category of allCategories ? categories : categories.slice(0, 6)) {
        const row = node("tr"); const label = node("th", category.category || "Uncategorized"); label.setAttribute("scope", "row"); row.append(label);
        const min = Math.min(0, ...category.cells.map((cell) => cell.total));
        const max = Math.max(0, ...category.cells.map((cell) => cell.total));
        category.cells.forEach((value, index) => {
          const cell = node("td"); color(cell, groups[index]);
          if (!value.count) cell.append(node("span", "—", "comparison-missing"));
          else {
            const control = button(undefined, () => inspect(groups[index], category.category || "__ledger_blank__"), "comparison-cell");
            control.setAttribute("aria-label", `${groups[index].name}, ${category.category || "Uncategorized"}: ${money.format(value.total)}. View transactions`);
            control.append(node("span", money.format(value.total)), track(value.total, min, max)); cell.append(control);
          }
          row.append(cell);
        }); body.append(row);
      }
      table.append(caption, head, body); root.append(table);
    }
    byId("choose-comparison-groups").addEventListener("click", () => {
      if (!picker.hidden) return closePicker(true);
      renderPicker(); picker.hidden = false;
      byId("choose-comparison-groups").setAttribute("aria-expanded", "true"); byId("comparison-group-search").focus();
    });
    byId("close-comparison-picker").addEventListener("click", () => closePicker(true));
    byId("comparison-group-search").addEventListener("input", () => renderPicker());
    byId("comparison-baseline").addEventListener("change", (event) => { state.baseline = event.target.value; render(); });
    byId("comparison-category-toggle").addEventListener("click", () => { allCategories = !allCategories; render(); });
    function updateDates() {
      const invalid = [start, end].some((control) => control.validity?.badInput || !validDate(control.value)) || (start.value && end.value && start.value > end.value);
      const error = byId("comparison-date-error"); error.hidden = !invalid;
      error.textContent = invalid ? "Enter a valid date range, with Through on or after From. The last valid range is still shown." : "";
      start.setAttribute("aria-invalid", String(Boolean(invalid))); end.setAttribute("aria-invalid", String(Boolean(invalid)));
      if (invalid) return;
      state.startDate = start.value; state.endDate = end.value; render();
    }
    for (const control of [start, end]) { control.addEventListener("input", updateDates); control.addEventListener("change", updateDates); }
    byId("comparison-all-time").addEventListener("click", () => { start.value = end.value = ""; updateDates(); });
    document.addEventListener("click", (event) => {
      const path = event.composedPath();
      if (!path.includes(picker) && !path.includes(byId("choose-comparison-groups"))) closePicker();
    });
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape" && !picker.hidden) { event.preventDefault(); closePicker(true); } });
    return { setTransactions(rows) { transactions = rows; render(); }, closePicker };
  }
  globalObject.LedgerGroupComparison = Object.freeze({ create });
})(window);
