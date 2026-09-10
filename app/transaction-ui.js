"use strict";

(function initializeTransactionUi(globalObject) {
  const transactionDescriptionCollator = new Intl.Collator(undefined, {
    sensitivity: "base",
    numeric: true,
  });
  const editableFields = [
    "date",
    "description",
    "amount",
    "category",
    "subcategory",
    "accountName",
    "accountType",
    "provider",
    "notes",
    "tags",
    "group",
  ];
  const tagPickerStates = new WeakMap();
  const groupPickerStates = new WeakMap();
  let availableGroups = [];
  let groupPickerId = 0;
  const valuePickerStates = new WeakMap();
  const transactionValueLabels = Object.freeze({
    category: "Category", subcategory: "Subcategory", accountName: "Account name",
    accountType: "Account type", provider: "Provider",
  });
  let editorTaxonomy = [];
  let editorTaxonomyRequest = null;

  function setEditorTaxonomy(categories) {
    if (Array.isArray(categories)) editorTaxonomy = categories;
  }

  function loadEditorTaxonomy() {
    if (!editorTaxonomyRequest) {
      editorTaxonomyRequest = fetch("/api/taxonomy", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => { if (payload) setEditorTaxonomy(payload.categories); })
        .catch(() => { editorTaxonomyRequest = null; });
    }
    return editorTaxonomyRequest;
  }

  function transactionFieldValues(field, transactions = [], category = "") {
    const key = groupName(category).toLocaleLowerCase();
    const rows = field === "subcategory" && key
      ? transactions.filter((row) => groupName(row.category).toLocaleLowerCase() === key) : transactions;
    const taxonomy = editorTaxonomy.filter((entry) => !key || groupName(entry.name).toLocaleLowerCase() === key);
    const extras = field === "category" ? editorTaxonomy.map((entry) => entry.name)
      : field === "subcategory" ? taxonomy.flatMap((entry) => (entry.subcategories || []).map((sub) => sub.name)) : [];
    return groupsFromTransactions([...rows.map((row) => row[field]), ...extras].map((group) => ({ group })));
  }

  function createTransactionValuePicker(container, field, options = {}) {
    const label = transactionValueLabels[field];
    if (!label) throw new Error("Unsupported transaction dropdown field.");
    return createGroupPicker(container, {
      ...options, label, emptyLabel: `No ${label.toLocaleLowerCase()}`, maxLength: 500,
      createLabel: `Add new ${label.toLocaleLowerCase()}`,
      getScope: () => field === "subcategory" ? groupName(options.getCategory?.()).toLocaleLowerCase() : "",
      getValues: () => transactionFieldValues(field, options.transactions || [], options.getCategory?.() || ""),
      onChange: (value) => {
        if (field === "subcategory" && value && !groupName(options.getCategory?.())) {
          const category = categoryForSubcategory(value, options.transactions || []);
          if (category) options.onSelectCategory?.(category);
        }
        options.onChange?.(value);
      },
    });
  }

  function categoryForSubcategory(subcategory, transactions) {
    const key = groupName(subcategory).toLocaleLowerCase();
    if (!key) return "";
    const fromRows = transactions.filter((row) => groupName(row.subcategory).toLocaleLowerCase() === key)
      .map((row) => row.category);
    const fromTaxonomy = editorTaxonomy.filter((entry) => (entry.subcategories || [])
      .some((sub) => groupName(sub.name).toLocaleLowerCase() === key)).map((entry) => entry.name);
    // The same alphabetic order as the Category dropdown, independent of row order.
    return groupsFromTransactions([...fromRows, ...fromTaxonomy].map((group) => ({ group })))[0] || "";
  }

  function configureTransactionValuePickers(form, transactions) {
    let pickers = valuePickerStates.get(form);
    if (!pickers) { pickers = new Map(); valuePickerStates.set(form, pickers); }
    for (const field of Object.keys(transactionValueLabels)) {
      const input = form.elements.namedItem(field);
      if (!input || input.type !== "text") continue;
      let entry = pickers.get(field);
      if (!entry) {
        // Options are interactive buttons, so they must not live inside a label
        // that would also activate the input. The combobox has its own aria-label.
        if (input.parentElement.tagName === "LABEL") {
          const label = input.parentElement;
          const fieldWrap = document.createElement("div");
          fieldWrap.className = label.className;
          label.parentElement.insertBefore(fieldWrap, label);
          fieldWrap.append(...label.childNodes);
          label.remove();
        }
        const container = document.createElement("div");
        container.className = "transaction-value-field";
        input.parentElement.insertBefore(container, input);
        input.removeAttribute("list");
        const data = { transactions: [] };
        const picker = createTransactionValuePicker(container, field, {
          input,
          get transactions() { return data.transactions; },
          getCategory: () => form.elements.namedItem("category")?.value || "",
          onSelectCategory: (category) => pickers.get("category")?.picker.set(category),
        });
        entry = { picker, data }; pickers.set(field, entry);
      }
      entry.data.transactions = transactions || [];
      // Cancelled new values must not leak into another transaction. Preserve
      // the original spelling and every other field until explicitly changed.
      entry.picker.set(input.value, []);
    }
  }

  // Selection identity, not sorting or array position, owns a palette slot.
  // Call sync with the whole active selection, never just search-visible items.
  function createSeriesColorSlots({ size = 12, initial = [] } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new RangeError("Invalid palette size");
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const slots = new Map();
    const restoredSlots = new Set();
    for (const entry of Array.isArray(initial) ? initial : []) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const [name, slot] = entry; const key = normalize(name);
      if (!key || slots.has(key) || !Number.isSafeInteger(slot) || slot < 0 || slot > 100000 || restoredSlots.has(slot)) continue;
      slots.set(key, slot); restoredSlots.add(slot);
    }
    return Object.freeze({
      sync(keys) {
        const active = new Set(keys.map(normalize).filter(Boolean));
        for (const key of slots.keys()) if (!active.has(key)) slots.delete(key);
        const usage = Array(size).fill(0);
        const occupied = new Set(slots.values());
        for (const slot of occupied) usage[slot % size] += 1;
        for (const key of active) {
          if (slots.has(key)) continue;
          const color = usage.indexOf(Math.min(...usage));
          let slot = color;
          // Logical slots beyond the palette wrap. Keeping them distinct also
          // preserves overflow assignments when saved and later restored.
          while (occupied.has(slot)) slot += size;
          slots.set(key, slot); occupied.add(slot); usage[color] += 1;
        }
      },
      slot(key) { return slots.get(normalize(key)); },
      snapshot() { return [...slots]; },
    });
  }

  function groupName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function groupsFromTransactions(transactions) {
    const names = new Map();
    for (const transaction of transactions || []) {
      const name = groupName(transaction.group);
      if (name && !names.has(name.toLocaleLowerCase())) names.set(name.toLocaleLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }

  function setAvailableGroups(groups) {
    availableGroups = groupsFromTransactions(groups.map((group) => ({ group })));
  }

  function groupFilterLabel(value) {
    return value === "__ledger_no_group__" ? "No group" : value;
  }

  function matchesGroupFilter(transaction, value) {
    const name = groupName(transaction.group).toLocaleLowerCase();
    return !value || (value === "__ledger_no_group__" ? !name : name === groupName(value).toLocaleLowerCase());
  }

  function populateGroupFilter(select, transactions, selected = "") {
    const names = groupsFromTransactions([...transactions, ...(selected && selected !== "__ledger_no_group__" ? [{group:selected}] : [])]);
    select.replaceChildren(new Option("All groups", ""), new Option("No group", "__ledger_no_group__"),
      ...names.map((name) => new Option(name, name)));
    select.value = selected === "__ledger_no_group__" ? selected
      : names.find((name) => name.toLocaleLowerCase() === groupName(selected).toLocaleLowerCase()) || "";
  }

  function setTransactionFilterPanel(panel, button, open) {
    // In-flow disclosure: its height is independent of the filtered row count.
    // The modal body owns scrolling; never fit controls to the remaining space.
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function flagFilterValue(control) {
    return control.checked ? "flagged" : "";
  }

  function setFlagFilter(control, value) {
    control.checked = value === "flagged";
  }

  // Bind after dependent controls (such as category/subcategory) and Reset
  // have been wired. Filtering is local UI state, never transaction mutation.
  function bindLiveTransactionFilters(container, onChange, resetButton) {
    container.querySelectorAll("select, input").forEach((control) => {
      if (control.tagName === "INPUT" && !control.name) return;
      control.addEventListener("change", onChange);
      if (["date", "search", "text", "number"].includes(control.type)) {
        control.addEventListener("input", onChange);
      }
    });
    resetButton?.addEventListener("click", onChange);
  }

  // One controller per selection purpose: bulk actions and import inclusion must
  // never share an anchor. Keys identify occurrences, not descriptions/amounts.
  function createCheckboxRangeSelection(onChange) {
    let keys = [];
    let anchor = null;
    let scope = null;
    let generation = 0;
    let controls = new Map();
    function reset() { anchor = null; generation += 1; }
    function sync(nextKeys, nextScope) {
      if (scope !== nextScope || keys.length !== nextKeys.length || keys.some((key, index) => key !== nextKeys[index])) reset();
      keys = [...nextKeys]; scope = nextScope; controls = new Map();
    }
    function bind(checkbox, key) {
      controls.set(key, checkbox);
      const boundGeneration = generation;
      let extend = false;
      checkbox.title = "Shift-click another checkbox to select or clear the visible range.";
      // change is not a MouseEvent. Capture the modifier on click, then use the
      // native checked value in change (also preserves ordinary Space/AT input).
      checkbox.addEventListener("click", (event) => { extend = event.shiftKey === true; });
      checkbox.addEventListener("change", () => {
        const useRange = extend; extend = false;
        if (checkbox.disabled || boundGeneration !== generation) return;
        const end = keys.indexOf(key);
        if (end < 0) return;
        const start = useRange ? keys.indexOf(anchor) : -1;
        const affected = start < 0 ? [key] : keys.slice(Math.min(start, end), Math.max(start, end) + 1);
        const enabled = affected.filter((item) => !controls.get(item)?.disabled);
        const restoreFocus = document.activeElement === checkbox;
        anchor = key;
        // One callback for the whole range, never one render/request per row.
        onChange(enabled, checkbox.checked);
        if (restoreFocus) controls.get(key)?.focus({ preventScroll: true });
      });
    }
    return { bind, sync, reset };
  }

  function createGroupPicker(container, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "transaction-group-picker";
    const input = options.input || document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = options.maxLength || 100;
    input.placeholder = options.emptyLabel || "No group";
    input.setAttribute("aria-label", options.label || "Group");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const list = document.createElement("div");
    list.id = `group-options-${++groupPickerId}`;
    list.className = "transaction-group-options";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    input.setAttribute("aria-controls", list.id);
    wrap.append(input, list);
    container.replaceChildren(wrap);
    let selected = "";
    let names = [];
    let activeIndex = -1;
    let choices = [];
    let searching = false;
    const draftValues = new Map();

    function refreshNames() {
      if (options.getValues) {
        const scope = options.getScope?.() || "";
        names = groupsFromTransactions([
          ...options.getValues(), ...(draftValues.get(scope) || []), selected,
        ].map((group) => ({ group })));
      }
    }

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      input.value = selected === "__ledger_no_group__" ? "No group" : selected;
      input.setCustomValidity("");
      input.placeholder = options.emptyLabel || "No group";
      searching = false;
    }
    function choose(value) {
      selected = value;
      const scope = options.getScope?.() || "";
      if (value && options.getValues) {
        if (!draftValues.has(scope)) draftValues.set(scope, new Set());
        draftValues.get(scope).add(value);
      }
      if (value && value !== "__ledger_no_group__" && !names.some((name) => name.toLocaleLowerCase() === value.toLocaleLowerCase())) names.push(value);
      close();
      options.onChange?.(selected);
      input.focus();
      close();
    }
    function render() {
      refreshNames();
      const query = searching ? groupName(input.value) : "";
      const lower = query.toLocaleLowerCase();
      choices = [{ value: "", label: options.emptyLabel || "No group" }];
      if (options.includeUngrouped) choices.push({ value: "__ledger_no_group__", label: "No group" });
      choices.push(...names.filter((name) => !lower || name.toLocaleLowerCase().includes(lower))
        .map((value) => ({ value, label: value })));
      if (options.allowCreate !== false && query && !names.some((name) => name.toLocaleLowerCase() === lower)) {
        choices.push({ value: query, label: `+ ${options.createLabel || "Create"} “${query}”`, create: true });
      } else if (options.createLabel && !query) {
        choices.push({ label: `+ ${options.createLabel}…`, startCreate: true });
      }
      list.replaceChildren(...choices.map((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `${list.id}-${index}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(choice.value === selected));
        button.tabIndex = -1;
        button.textContent = choice.label;
        if (choice.create || choice.startCreate) button.className = "transaction-value-create";
        button.addEventListener("click", () => activate(choice));
        return button;
      }));
      activeIndex = -1;
      list.hidden = false;
      // Keep long menus inside the editor's scroll area, opening upward near
      // its bottom edge rather than clipping options behind the footer.
      const bounds = wrap.closest?.(".form-body")?.getBoundingClientRect();
      const control = wrap.getBoundingClientRect();
      const below = Math.min(globalObject.innerHeight || 800, bounds?.bottom ?? Infinity) - control.bottom - 10;
      const above = control.top - Math.max(0, bounds?.top ?? 0) - 10;
      const opensUp = below < 160 && above > below;
      list.classList.toggle("opens-up", opensUp);
      list.style.maxHeight = `${Math.max(80, Math.min(220, opensUp ? above : below))}px`;
      input.setAttribute("aria-expanded", "true");
    }
    function activate(choice) {
      if (choice.startCreate) {
        searching = true;
        input.value = "";
        input.placeholder = `Enter a new ${(options.label || "group").toLocaleLowerCase()}`;
        input.focus(); render();
      } else choose(choice.value);
    }
    input.addEventListener("focus", () => { input.select(); render(); });
    input.addEventListener("click", render);
    input.addEventListener("input", () => {
      searching = true;
      input.setCustomValidity(`Choose ${(options.label || "group").toLocaleLowerCase()} from the list, or add the new value.`);
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) render();
        activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        input.setAttribute("aria-activedescendant", `${list.id}-${activeIndex}`);
        [...list.children].forEach((item, index) => item.classList.toggle("is-focused", index === activeIndex));
        list.children[activeIndex]?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && !list.hidden) {
        event.preventDefault();
        const exact = names.find((name) => name.toLocaleLowerCase() === groupName(input.value).toLocaleLowerCase());
        if (activeIndex >= 0) activate(choices[activeIndex]);
        else if (exact || !groupName(input.value)) choose(exact || "");
        else if (options.allowCreate !== false) choose(groupName(input.value));
      }
    });
    wrap.addEventListener("focusout", (event) => { if (!wrap.contains(event.relatedTarget)) close(); });
    return {
      value: () => selected,
      set(value, groups = names) {
        draftValues.clear();
        names = groupsFromTransactions([...groups, value].map((group) => ({ group })))
          .filter((name) => name !== "__ledger_no_group__");
        selected = options.input ? String(value ?? "")
          : names.find((name) => name.toLocaleLowerCase() === groupName(value).toLocaleLowerCase()) || groupName(value);
        close();
      },
      input,
    };
  }

  function configureTransactionGroupPicker(form, groups = availableGroups) {
    const root = form.querySelector("[data-transaction-group-picker]");
    const hidden = form.elements.namedItem("group");
    if (!root || !hidden) return;
    let picker = groupPickerStates.get(form);
    if (!picker) {
      picker = createGroupPicker(root, { onChange: (value) => { hidden.value = value; } });
      groupPickerStates.set(form, picker);
    }
    picker.set(hidden.value, groups);
  }

  function transactionTags(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(",");
    const tags = [];
    const seen = new Set();
    for (const rawTag of source) {
      const tag = String(rawTag).replace(/\s+/g, " ").trim();
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) continue;
      tags.push(tag);
      seen.add(key);
    }
    return tags;
  }

  function tagsFromTransactions(transactions) {
    return transactionTags(
      (transactions || []).flatMap((transaction) => transactionTags(transaction.tags)),
    ).sort((left, right) => left.localeCompare(right));
  }

  function renderTransactionTagPicker(form) {
    const state = tagPickerStates.get(form);
    if (!state) return;
    const hidden = form.elements.namedItem("tags");
    if (!(hidden instanceof HTMLInputElement)) return;
    const selectedTags = state.selectedTags;
    const selected = new Map(selectedTags.map((tag) => [tag.toLocaleLowerCase(), tag]));
    const available = new Map();
    for (const tag of [...state.availableTags, ...selectedTags]) {
      const key = tag.toLocaleLowerCase();
      if (!available.has(key)) available.set(key, tag);
    }
    const tags = [...available.values()].sort((left, right) => left.localeCompare(right));
    state.controls.querySelectorAll("[data-tag-option]").forEach((button) => button.remove());
    state.empty.hidden = tags.length > 0;
    for (const tag of tags) {
      const key = tag.toLocaleLowerCase();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "transaction-tag-option";
      button.dataset.tagOption = tag;
      button.textContent = tag;
      button.setAttribute("aria-pressed", String(selected.has(key)));
      button.addEventListener("click", () => {
        const current = new Map(
          state.selectedTags.map((item) => [item.toLocaleLowerCase(), item]),
        );
        if (current.has(key)) current.delete(key);
        else if (current.size < 50) current.set(key, tag);
        state.selectedTags = [...current.values()]
          .sort((left, right) => left.localeCompare(right));
        hidden.value = state.selectedTags.join(", ");
        renderTransactionTagPicker(form);
      });
      state.controls.insertBefore(button, state.createControl);
    }
  }

  function addTagFromPicker(form) {
    const state = tagPickerStates.get(form);
    if (!state) return;
    const hidden = form.elements.namedItem("tags");
    if (!(hidden instanceof HTMLInputElement)) return;
    const tag = state.input.value.replace(/\s+/g, " ").trim();
    state.input.setCustomValidity("");
    if (!tag) return;
    if (tag.includes(",")) {
      state.input.setCustomValidity("A tag cannot contain a comma.");
      state.input.reportValidity();
      return;
    }
    const selected = new Map(
      state.selectedTags.map((item) => [item.toLocaleLowerCase(), item]),
    );
    const available = new Map(
      state.availableTags.map((item) => [item.toLocaleLowerCase(), item]),
    );
    const key = tag.toLocaleLowerCase();
    const canonicalTag = available.get(key) || selected.get(key) || tag;
    if (!selected.has(key) && selected.size >= 50) {
      state.input.setCustomValidity("A transaction cannot have more than 50 tags.");
      state.input.reportValidity();
      return;
    }
    if (!available.has(key)) state.availableTags.push(canonicalTag);
    selected.set(key, canonicalTag);
    state.selectedTags = [...selected.values()]
      .sort((left, right) => left.localeCompare(right));
    hidden.value = state.selectedTags.join(", ");
    state.input.value = "";
    state.button.disabled = true;
    renderTransactionTagPicker(form);
  }

  function configureTransactionTagPicker(form, availableTags = []) {
    const root = form.querySelector("[data-transaction-tag-picker]");
    if (!root) return;
    let state = tagPickerStates.get(form);
    if (!state || state.root !== root) {
      const controls = root.querySelector("[data-tag-controls]");
      const input = root.querySelector("[data-new-tag-input]");
      const button = root.querySelector("[data-new-tag-button]");
      const empty = root.querySelector("[data-tag-empty]");
      const createControl = root.querySelector(".transaction-tag-create");
      if (!controls || !input || !button || !empty || !createControl) return;
      state = {
        root,
        controls,
        input,
        button,
        empty,
        createControl,
        availableTags: [],
        selectedTags: [],
      };
      tagPickerStates.set(form, state);
      form.addEventListener("reset", () => {
        Promise.resolve().then(() => {
          if (tagPickerStates.get(form) !== state) return;
          const tagField = form.elements.namedItem("tags");
          if (tagField instanceof HTMLInputElement) {
            tagField.value = state.selectedTags.join(", ");
          }
          renderTransactionTagPicker(form);
        });
      });
      input.addEventListener("input", () => {
        input.setCustomValidity("");
        button.disabled = !input.value.trim();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addTagFromPicker(form);
      });
      button.addEventListener("click", () => addTagFromPicker(form));
    }
    state.availableTags = transactionTags(availableTags);
    state.selectedTags = transactionTags(form.elements.namedItem("tags")?.value);
    renderTransactionTagPicker(form);
  }

  function refreshTransactionTagPicker(form) {
    for (const name of ["refunded", "internalTransferTreatment"]) {
      const field = form.elements.namedItem(name);
      if (field?.dataset.reconciliationLocked === "true") field.disabled = true;
    }
    const state = tagPickerStates.get(form);
    if (!state) return;
    state.button.disabled = !state.input.value.trim();
    renderTransactionTagPicker(form);
  }

  function transactionFlags(transaction) {
    return String(transaction?.flags ?? "")
      .split(",")
      .map((flag) => flag.trim().toLocaleLowerCase())
      .filter(Boolean);
  }

  function hasTransactionFlag(transaction, flag) {
    return transactionFlags(transaction).includes(flag.toLocaleLowerCase());
  }

  function internalTransferTreatment(transaction) {
    if (hasTransactionFlag(transaction, "internal-transfer")) return "internal-transfer";
    if (hasTransactionFlag(transaction, "include-in-budget")) return "include-in-budget";
    return "automatic";
  }

  function isInternalTransfer(transaction) {
    if (transaction?._linkRole) return transaction._linkType === "transfer";
    const treatment = internalTransferTreatment(transaction);
    if (treatment === "internal-transfer") return true;
    if (treatment === "include-in-budget") return false;
    return transaction?._isInternalTransfer === true;
  }

  function flagsFromEditor(form, transaction) {
    const flags = new Set(transactionFlags(transaction));
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox" && !refunded.disabled) {
      if (refunded.checked) flags.add("refunded");
      else flags.delete("refunded");
    }
    const transferTreatment = form.elements.namedItem("internalTransferTreatment");
    if (transferTreatment instanceof HTMLSelectElement && !transferTreatment.disabled) {
      if (transferTreatment.value !== "internal-transfer") {
        for (const flag of flags) if (flag.startsWith("transfer-pair-")) flags.delete(flag);
      }
      flags.delete("internal-transfer");
      flags.delete("include-in-budget");
      if (transferTreatment.value === "internal-transfer") flags.add("internal-transfer");
      if (transferTreatment.value === "include-in-budget") flags.add("include-in-budget");
    }
    return [...flags].sort().join(",");
  }

  function populateTransactionEditor(form, transaction, defaults = {}, options = {}) {
    form.reset();
    for (const fieldName of editableFields) {
      const field = form.elements.namedItem(fieldName);
      if (field) field.value = transaction?.[fieldName] ?? defaults[fieldName] ?? "";
    }
    configureTransactionGroupPicker(form);
    configureTransactionValuePickers(form, options.transactions || []);
    configureTransactionLinks(form, transaction, options.transactions || []);
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox") {
      refunded.checked = transaction?._isLinkedRefund === true || hasTransactionFlag(transaction, "refunded");
    }
    const transferTreatment = form.elements.namedItem("internalTransferTreatment");
    if (transferTreatment instanceof HTMLSelectElement) {
      transferTreatment.value = transaction?._linkType === "transfer" ? "internal-transfer" : internalTransferTreatment(transaction);
    }
    const pickerState = tagPickerStates.get(form);
    if (pickerState) {
      pickerState.selectedTags = transactionTags(form.elements.namedItem("tags")?.value);
      pickerState.input.value = "";
      pickerState.input.setCustomValidity("");
      pickerState.button.disabled = true;
      renderTransactionTagPicker(form);
    }
  }

  function transactionFromEditor(form, existingTransaction = null) {
    const transaction = {};
    for (const fieldName of editableFields) {
      const field = form.elements.namedItem(fieldName);
      transaction[fieldName] = fieldName === "tags" && tagPickerStates.has(form)
        ? tagPickerStates.get(form).selectedTags.join(", ")
        : field?.value ?? "";
    }
    transaction.flags = flagsFromEditor(form, existingTransaction);
    if (existingTransaction?.id) transaction.id = existingTransaction.id;
    const linkState = linkEditorStates.get(form);
    if (linkState?.reverse) {
      if (linkState.target !== linkState.initial || linkState.type !== linkState.initialType
          || existingTransaction?.repaymentTo !== undefined || existingTransaction?.linkTo !== undefined) {
        // Retain the legacy repayment intent for compatible clients; general links
        // use the same purchase-owned relationship, never a second child-side link.
        if (linkState.type === "repayment" && linkState.initialType === "repayment") transaction.repaymentTo = linkState.target;
        else transaction.linkTo = { transactionId: linkState.target, type: linkState.type };
      }
    } else if (linkState) transaction.links = linkState.entries.length ? JSON.stringify(linkState.entries) : "";
    else if (existingTransaction?.links) transaction.links = existingTransaction.links;
    return transaction;
  }

  const linkEditorStates = new WeakMap();
  const expandedLinks = new Set();
  const linkLabels = { refund: "Refund", transfer: "Internal transfer", repayment: "Repayment" };

  function linkTransactionCard(transaction, label, action, disabled = false) {
    const row = createTransactionRow({ ...transaction, _budgetAmount: Number(transaction.amount) }, {
      currency: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
      shortMonthFormatter: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }),
      showYear: true, showEdit: false, showLinks: false,
      amountForDisplay: item => Number(item.amount),
    });
    const button = document.createElement("button"); button.type = "button";
    button.className = "secondary-button transaction-link-action"; button.textContent = label;
    button.setAttribute("aria-label", `${label} ${transaction.description}`); button.disabled = disabled;
    button.addEventListener("click", action);
    row.querySelector(".transaction-actions").append(button);
    return row;
  }

  function transactionLinks(transaction) {
    try { return JSON.parse(transaction?.links || "[]"); } catch { return []; }
  }

  function configureCreditLinkTarget(form, transaction, available, section, summary, help, lockBudgetFields) {
    help.textContent = "Money received · choose one original expense. Repayments join any other repayments on that expense. Refunds and internal transfers are one-to-one; transfers must balance exactly. Changes stay staged until you save this editor or confirm the enclosing review.";
    const unique = new Map(available.filter(row => row.id).map(row => [row.id, row]));
    const original = transaction._linkedTo;
    if (original && !unique.has(original.id)) unique.set(original.id, original);
    const initial = original?.id || "";
    const initialType = transaction._linkType || "repayment";
    const state = { reverse: true, initial, initialType, type: transaction.linkTo?.type || initialType,
      target: transaction.linkTo?.transactionId ?? transaction.repaymentTo ?? initial };
    linkEditorStates.set(form, state);
    const type = document.createElement("select"); type.setAttribute("aria-label", "Link type");
    for (const [value, label] of Object.entries(linkLabels)) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; type.append(option);
    }
    type.value = state.type;
    const selected = document.createElement("div"); selected.className = "transaction-linked-selections";
    const search = document.createElement("input"); search.type = "search";
    search.placeholder = "Search purchases by description or notes";
    search.setAttribute("aria-label", "Find the original purchase");
    const choices = document.createElement("div"); choices.className = "transaction-link-choices";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    function render() {
      lockBudgetFields(Boolean(state.target));
      summary.textContent = state.target ? `${linkLabels[state.type]} · original expense linked` : "Refunds & repayments";
      selected.replaceChildren();
      const purchase = unique.get(state.target);
      if (state.target) {
        if (purchase) {
          const card = linkTransactionCard(purchase, "Unlink", () => { state.target = ""; render(); });
          card.querySelector(".transaction-link-action").setAttribute("aria-label", "Unlink original purchase");
          selected.append(card);
        }
      }
      status.textContent = state.target ? "Linked to one original expense. This money received will not be counted twice."
        : "No purchase linked. This transaction will be counted normally.";
      const eligible = [...unique.values()].filter(row => Number(row.amount) > 0 && row.id !== transaction.id
        && !row._linkedTo && row.id !== state.target
        && transactionLinks(row).filter(entry => entry.transactionId !== transaction.id)
          .every(entry => state.type === "repayment" && entry.type === "repayment")
        && (!row._linkType || row._linkType === "repayment" || row.id === initial)
        && (state.type !== "transfer" || (Math.round(Number(row.amount) * 100) === -Math.round(Number(transaction.amount) * 100)
          && ["accountName", "accountType", "provider"].some(field => String(row[field] || "").trim().toLowerCase() !== String(transaction[field] || "").trim().toLowerCase())))
        && globalObject.LedgerTransactionsModel.matchesTransactionSearch(row, search.value));
      choices.replaceChildren();
      if (!search.value.trim()) return;
      for (const row of eligible.slice(0, 20)) {
        choices.append(linkTransactionCard(row, "Link", () => { state.target = row.id; search.value = ""; render(); }, Boolean(state.target)));
      }
      if (!eligible.length || eligible.length > 20) {
        const hint = document.createElement("p");
        hint.textContent = !eligible.length ? "No available purchases match this search." : "Showing 20 matches. Keep typing to narrow the search.";
        choices.append(hint);
      }
    }
    search.addEventListener("input", render);
    type.addEventListener("change", () => {
      const otherLinks = transactionLinks(unique.get(state.target)).filter(entry => entry.transactionId !== transaction.id);
      if (type.value !== "repayment" && otherLinks.length) {
        type.value = state.type; status.textContent = "This expense has other repayments. Unlink this repayment first to choose a one-to-one relationship."; return;
      }
      const purchase = unique.get(state.target);
      if (type.value === "transfer" && purchase && (Math.round(Number(purchase.amount) * 100) !== -Math.round(Number(transaction.amount) * 100)
          || ["accountName", "accountType", "provider"].every(field => String(purchase[field] || "").trim().toLowerCase() === String(transaction[field] || "").trim().toLowerCase()))) {
        type.value = state.type; status.textContent = "Internal transfers require equal and opposite amounts in different accounts."; return;
      }
      state.type = type.value; render();
    });
    search.addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
    section.append(type, selected, search, choices, status); render();
  }

  function configureTransactionLinks(form, transaction, available) {
    linkEditorStates.get(form)?.cleanup?.();
    form.querySelector(".transaction-link-editor")?.remove();
    linkEditorStates.delete(form);
    const budgetFields = ["refunded", "internalTransferTreatment"].map(name=>form.elements.namedItem(name)).filter(Boolean);
    const lockBudgetFields = linked => budgetFields.forEach(field=>{
      if (!linked && field.dataset.reconciliationLocked === "true") {
        if (field.name === "refunded") field.checked = hasTransactionFlag(transaction, "refunded");
        else field.value = internalTransferTreatment(transaction);
      }
      field.disabled = linked;
      field.dataset.reconciliationLocked = String(linked);
      field.title = linked ? "Budget treatment comes from the linked transactions. Unlink them to use this override." : "";
    });
    lockBudgetFields(transaction?._linkRole === "credit");
    if (!transaction?.id) return;
    const section = document.createElement("details");
    section.className = "transaction-link-editor form-field form-field--wide";
    const summary = document.createElement("summary");
    summary.textContent = "Refunds & repayments";
    const help = document.createElement("p");
    help.textContent = "A zero-dollar transaction cannot be linked. Select a nonzero expense or money received.";
    section.append(summary, help);
    (form.querySelector(".form-body") || form.querySelector(".form-grid") || form).append(section);
    if (Number(transaction.amount) < 0) {
      configureCreditLinkTarget(form, transaction, available, section, summary, help, lockBudgetFields);
      return;
    }
    if (transaction._linkRole === "credit" || Number(transaction.amount) <= 0) return;
    help.textContent = "Original expense · link one refund or internal transfer, or multiple repayments received. A credit can belong to only one expense. Refunds may be partial; transfers must balance exactly. Changes stay staged until you save this editor or confirm the enclosing review.";
    const unique = new Map(available.filter(row=>row.id).map(row=>[row.id,row]));
    for(const child of transaction._linkedTransactions || []) unique.set(child.id,child);
    const entries = transactionLinks(transaction).map(entry=>({...entry}));
    const state = {entries}; linkEditorStates.set(form,state);
    const type = document.createElement("select");
    type.setAttribute("aria-label","Link type");
    for(const [value,label] of Object.entries(linkLabels)) {
      const option=document.createElement("option"); option.value=value; option.textContent=label;
      type.append(option);
    }
    type.value=entries[0]?.type || "repayment";
    const selected=document.createElement("div"); selected.className="transaction-linked-selections";
    const search=document.createElement("input"); search.type="search"; search.placeholder="Search credits by description or notes";
    search.setAttribute("aria-label","Find a transaction to link");
    const choices=document.createElement("div"); choices.className="transaction-link-choices";
    const status=document.createElement("p"); status.setAttribute("role","status");
    function render() {
      lockBudgetFields(entries.length > 0);
      selected.replaceChildren(...entries.map(entry=>{
        const child=unique.get(entry.transactionId);
        return child ? linkTransactionCard(child, "Unlink", () => { entries.splice(entries.indexOf(entry),1); render(); })
          : document.createTextNode("Linked transaction unavailable");
      }));
      const net=Number(form.elements.namedItem("amount")?.value || transaction.amount)
        + entries.reduce((total,entry)=>total+Number(unique.get(entry.transactionId)?.amount || 0),0);
      summary.textContent=`Refunds & repayments${entries.length ? ` (${entries.length})` : ""}`;
      status.textContent=`Net cost: ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(net)}`;
      const eligible=[...unique.values()].filter(row=> Number(row.amount)<0 && row.id!==transaction.id
        && !transactionLinks(row).length && (!row._linkedTo || row._linkedTo.id===transaction.id)
        && (type.value!=="transfer" || (Math.round(Number(row.amount)*100) === -Math.round(Number(form.elements.namedItem("amount")?.value || transaction.amount)*100)
          && ["accountName","accountType","provider"].some(field=>String(row[field]||"").toLowerCase() !== String(form.elements.namedItem(field)?.value||"").toLowerCase())))
        && !entries.some(entry=>entry.transactionId===row.id)
        && globalObject.LedgerTransactionsModel.matchesTransactionSearch(row,search.value));
      choices.replaceChildren();
      if(!search.value.trim()) return;
      for(const row of eligible.slice(0,20)) {
        choices.append(linkTransactionCard(row, "Link", () => { entries.push({transactionId:row.id,type:type.value});search.value="";render(); }, type.value!=="repayment" && entries.length>0));
      }
      if(!eligible.length) {const empty=document.createElement("p");empty.textContent="No available credits match this search.";choices.append(empty);}
      if(eligible.length>20) {const more=document.createElement("p");more.textContent="Showing 20 matches. Keep typing to narrow the search.";choices.append(more);}
    }
    type.addEventListener("change",()=>{
      if(type.value!=="repayment" && entries.length>1) {type.value="repayment";status.textContent="Unlink extra credits before choosing a one-to-one match.";return;}
      if (type.value === "transfer" && entries.some(entry => {
        const child = unique.get(entry.transactionId);
        return !child || Math.round(Number(child.amount)*100) !== -Math.round(Number(form.elements.namedItem("amount")?.value || transaction.amount)*100)
          || ["accountName","accountType","provider"].every(field => String(child[field] || "").trim().toLowerCase() === String(form.elements.namedItem(field)?.value || "").trim().toLowerCase());
      })) { type.value = entries[0].type; status.textContent = "Internal transfers require equal and opposite amounts in different accounts."; return; }
      entries.forEach(entry=>entry.type=type.value);render();
    });
    search.addEventListener("input",render);
    search.addEventListener("keydown",event=>{if(event.key==="Enter")event.preventDefault();});
    form.elements.namedItem("amount")?.addEventListener("input",render);
    state.cleanup = () => form.elements.namedItem("amount")?.removeEventListener("input",render);
    section.append(type,selected,search,choices,status);render();
  }

  function normalizeTransactionSort(sort = {}) {
    return {
      field: ["date", "description", "cost"].includes(sort.field) ? sort.field : "date",
      direction: sort.direction === "asc" ? "asc" : "desc",
    };
  }

  function compareTransactions(left, right, sort = {}) {
    const normalized = normalizeTransactionSort(sort);
    let comparison = 0;
    if (normalized.field === "description") {
      comparison = transactionDescriptionCollator.compare(
        String(left.description || ""),
        String(right.description || ""),
      );
    } else if (normalized.field === "cost") {
      comparison = Math.abs(Number(left.amount) || 0) - Math.abs(Number(right.amount) || 0);
    } else {
      comparison = String(left.date || "").localeCompare(String(right.date || ""));
    }
    if (comparison !== 0) return normalized.direction === "asc" ? comparison : -comparison;
    const dateFallback = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateFallback !== 0) return dateFallback;
    return Number(right._id ?? -1) - Number(left._id ?? -1);
  }

  function sortTransactions(transactions, sort = {}) {
    return [...transactions].sort((left, right) => compareTransactions(left, right, sort));
  }

  function createTransactionSortControls(container, options = {}) {
    const current = normalizeTransactionSort(options.initial);
    const fieldLabel = document.createElement("label");
    const fieldText = document.createElement("span");
    fieldText.textContent = "Sort";
    const field = document.createElement("select");
    field.setAttribute("aria-label", "Sort transactions");
    for (const [value, label] of [
      ["date:desc", "Newest first"],
      ["date:asc", "Oldest first"],
      ["description:asc", "Description A–Z"],
      ["description:desc", "Description Z–A"],
      ["cost:desc", "Cost: high to low"],
      ["cost:asc", "Cost: low to high"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      field.append(option);
    }
    field.value = `${current.field}:${current.direction}`;
    fieldLabel.append(fieldText, field);
    function notify() {
      options.onChange?.({ ...current });
    }
    field.addEventListener("change", () => {
      [current.field, current.direction] = field.value.split(":");
      notify();
    });
    container.classList.add("transaction-sort-controls");
    container.replaceChildren(fieldLabel);
    return Object.freeze({
      value: () => ({ ...current }),
    });
  }

  function createTransactionRow(transaction, options) {
    const {
      currency,
      shortMonthFormatter,
      onEdit,
      leadingControl = null,
      duplicate = false,
      needsClassification = false,
      edited = false,
      disabled = false,
      showEdit = true,
      amountForDisplay = null,
      showYear = false,
      detailContent = null,
      detailPlacement = "description",
      onToggleFlag = null,
      showLinks = true,
    } = options;
    const refunded = transaction._linkRole ? transaction._isLinkedRefund === true : hasTransactionFlag(transaction, "refunded");
    const internalTransfer = isInternalTransfer(transaction);
    const income = transaction.category.trim().toLocaleLowerCase() === "income";
    const originalDisplayedAmount = income
      ? Math.abs(Number(transaction.amount))
      : Number(transaction.amount);
    const displayedAmount = refunded || internalTransfer || transaction._linkRole === "credit"
      ? originalDisplayedAmount
      : transaction._budgetAmount !== undefined ? transaction._budgetAmount : amountForDisplay
        ? amountForDisplay(transaction)
        : originalDisplayedAmount;

    const row = document.createElement("article");
    row.className = "transaction-row";
    row.classList.toggle("transaction-row--duplicate", duplicate);
    row.classList.toggle("transaction-row--needs-classification", needsClassification && !edited);
    row.classList.toggle("transaction-row--flagged", hasTransactionFlag(transaction, "flagged"));
    row.classList.toggle("transaction-row--refunded", refunded);
    row.classList.toggle("transaction-row--internal-transfer", internalTransfer);

    const parsedDate = new Date(`${transaction.date}T12:00:00Z`);
    const dateElement = document.createElement("time");
    dateElement.className = "transaction-date";
    dateElement.classList.toggle("transaction-date--with-year", showYear);
    dateElement.dateTime = transaction.date;
    const month = document.createElement("span");
    month.className = "transaction-date-month";
    month.textContent = shortMonthFormatter.format(parsedDate);
    const day = document.createElement("strong");
    day.textContent = parsedDate.getUTCDate();
    dateElement.append(month, day);
    if (showYear) {
      const year = document.createElement("small");
      year.className = "transaction-date-year";
      year.textContent = String(parsedDate.getUTCFullYear());
      dateElement.append(year);
    }
    const description = document.createElement("div");
    description.className = "transaction-description";
    const title = document.createElement("strong");
    title.textContent = transaction.description;
    title.title = transaction.description;
    const metadata = document.createElement("span");
    metadata.className = "transaction-metadata";
    const baseCategory = transaction.category || "Uncategorized";
    const categoryLabel = transaction.subcategory
      ? `${baseCategory} / ${transaction.subcategory}`
      : baseCategory;
    metadata.textContent = [categoryLabel, transaction.accountName, transaction.provider]
      .filter(Boolean)
      .join(" · ");
    description.append(title, metadata);

    if (duplicate) {
      const duplicateBadge = document.createElement("span");
      duplicateBadge.className = "duplicate-badge";
      duplicateBadge.textContent = "Duplicate";
      description.append(duplicateBadge);
    }
    if (needsClassification) {
      const classificationBadge = document.createElement("span");
      classificationBadge.className = "classification-needed-badge";
      classificationBadge.textContent = "No rule matched";
      classificationBadge.title = "Review this transaction manually or create a classification rule.";
      description.append(classificationBadge);
    }
    if (edited) {
      const editedBadge = document.createElement("span");
      editedBadge.className = "transaction-edited-badge";
      editedBadge.textContent = "Edited";
      editedBadge.title = "Changed manually during this import review. Not a saved transaction tag.";
      description.append(editedBadge);
    }
    if (refunded) {
      const refundedBadge = document.createElement("span");
      refundedBadge.className = "transaction-flag transaction-flag--refunded";
      refundedBadge.textContent = "Refunded";
      description.append(refundedBadge);
    }
    if (internalTransfer) {
      const transferBadge = document.createElement("span");
      transferBadge.className = "transaction-flag transaction-flag--internal-transfer";
      transferBadge.textContent = "Internal transfer";
      transferBadge.title = transaction._internalTransferSource === "automatic"
        ? "Detected automatically"
        : "Marked manually";
      description.append(transferBadge);
    }
    if (transaction._linkRole === "credit") {
      row.classList.add("transaction-row--linked-credit");
      const badge=document.createElement("span");badge.className="transaction-flag";
      badge.textContent=`Linked ${linkLabels[transaction._linkType]?.toLowerCase() || "credit"}`;
      description.append(badge);
    }
    const tags = String(transaction.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 0) {
      const tagList = document.createElement("span");
      tagList.className = "transaction-tags";
      for (const tag of tags) {
        const badge = document.createElement("span");
        badge.className = "transaction-tag";
        badge.textContent = tag;
        tagList.append(badge);
      }
      description.append(tagList);
    }
    if (transaction.group) {
      const group = document.createElement("span");
      group.className = "transaction-group-badge";
      group.textContent = `▱ ${transaction.group}`;
      group.title = `Group: ${transaction.group}`;
      group.setAttribute("aria-label", `Group: ${transaction.group}`);
      description.append(group);
    }
    if (transaction.notes) {
      const notes = document.createElement("span");
      notes.className = "transaction-note";
      notes.textContent = transaction.notes;
      description.append(notes);
    }
    // Additive source-specific review controls belong inside the shared row.
    if (detailContent && detailPlacement !== "row") description.append(detailContent);
    let linkedDetails = null;
    if(showLinks && (transaction._linkedTransactions?.length || transaction._linkedTo)) {
      const disclosure=document.createElement("details");disclosure.className="transaction-linked-details";
      disclosure.open=expandedLinks.has(transaction.id);
      disclosure.addEventListener("toggle",()=>{if(disclosure.open)expandedLinks.add(transaction.id);else expandedLinks.delete(transaction.id);});
      const label=document.createElement("summary");
      const children=transaction._linkedTransactions || [transaction._linkedTo];
      label.textContent=transaction._linkedTo ? (transaction._linkType === "transfer" ? "Other account" : "Original purchase") : `${linkLabels[transaction._linkType]}${children.length>1?"s":""} (${children.length})`;
      const note=document.createElement("p");
      note.textContent=`Original amount: ${currency.format(transaction.amount)}. ${transaction._linkedTo ? "Counted with the original purchase, not again here." : `Net cost: ${currency.format(transaction._netAmount)}. Linked credits reduce this purchase in its original month.`}`;
      disclosure.append(label,note);
      for(const child of children) disclosure.append(createTransactionRow(child,{currency,shortMonthFormatter,showYear:true,showEdit:false,showLinks:false}));
      linkedDetails = disclosure;
    }

    const actions = document.createElement("div");
    actions.className = "transaction-actions";
    const amount = document.createElement("span");
    amount.className = "transaction-amount";
    // Storage is expense-positive. Communicate money received with an explicit
    // plus, not color, even on warning/flagged rows or read-only linked credits.
    const signedAmount = refunded || internalTransfer || transaction._linkRole === "credit"
      ? Number(transaction.amount) : Number(transaction._budgetAmount ?? transaction.amount);
    amount.textContent = `${signedAmount < 0 ? "+" : ""}${currency.format(Math.abs(displayedAmount))}`;
    if (refunded || internalTransfer) {
      amount.title = "Excluded from budget totals";
    }
    actions.append(amount);
    if (showEdit) {
      const editButton = document.createElement("button");
      editButton.className = "edit-button";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.disabled = disabled;
      editButton.setAttribute("aria-label", `Edit ${transaction.description}`);
      editButton.addEventListener("click", onEdit);
      actions.append(editButton);
    }
    if (onToggleFlag) {
      const flagged = hasTransactionFlag(transaction, "flagged");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "transaction-flag-toggle";
      toggle.disabled = disabled;
      toggle.setAttribute("aria-pressed", String(flagged));
      toggle.setAttribute("aria-label", `${flagged ? "Unflag" : "Flag"} ${transaction.description}`);
      toggle.title = flagged ? "Remove flag" : "Flag for follow-up";
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 21V4m0 0c5-4 9 4 15 0v11c-6 4-10-4-15 0" /></svg>';
      toggle.addEventListener("click", async () => {
        if (toggle.disabled) return;
        toggle.disabled = true;
        try { await onToggleFlag(!flagged); }
        catch (error) {
          const message = document.createElement("p");
          message.className = "transaction-flag-error";
          message.setAttribute("role", "alert");
          message.textContent = error.message || "Could not save this flag. Try again.";
          description.append(message);
        } finally { toggle.disabled = disabled; }
      });
      actions.append(toggle);
    }

    row.append(...(leadingControl ? [leadingControl] : []), dateElement, description, actions);
    if (detailContent && detailPlacement === "row") row.append(detailContent);
    if (linkedDetails) row.append(linkedDetails);
    return row;
  }

  function renderTransactionList(container, transactions, optionsForTransaction) {
    container.replaceChildren(
      ...transactions.map((transaction, index) =>
        createTransactionRow(transaction, optionsForTransaction(transaction, index)),
      ),
    );
  }

  globalObject.LedgerTransactionUI = Object.freeze({
    matchesFlagFilter: (transaction, filter) => globalObject.LedgerTransactionsModel.matchesFlagFilter(transaction, filter),
    flagFilterLabel: (value) => value === "flagged" ? "Flagged only" : "All transactions",
    flagFilterValue,
    setFlagFilter,
    matchesTransactionSearch: (transaction, query) => globalObject.LedgerTransactionsModel.matchesTransactionSearch(transaction, query),
    createTransactionValuePicker,
    configureTransactionValuePickers,
    transactionFieldValues,
    setEditorTaxonomy,
    loadEditorTaxonomy,
    compareTransactions,
    configureTransactionTagPicker,
    configureTransactionGroupPicker,
    createGroupPicker,
    groupsFromTransactions,
    groupFilterLabel,
    matchesGroupFilter,
    populateGroupFilter,
    setTransactionFilterPanel,
    bindLiveTransactionFilters,
    createCheckboxRangeSelection,
    createSeriesColorSlots,
    setAvailableGroups,
    createTransactionRow,
    createTransactionSortControls,
    hasTransactionFlag,
    internalTransferTreatment,
    isInternalTransfer,
    populateTransactionEditor,
    refreshTransactionTagPicker,
    renderTransactionList,
    sortTransactions,
    tagsFromTransactions,
    transactionFlags,
    transactionFromEditor,
  });
})(window);
