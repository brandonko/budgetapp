"use strict";

// Shared selection and staged, explicit bulk edits for every transaction list.
(function initializeTransactionBulk(globalObject) {
  const ui = globalObject.LedgerTransactionUI;
  const fields = [
    ["group", "Group"], ["tags", "Tags"], ["category", "Category"], ["subcategory", "Subcategory"],
    ["description", "Description"], ["date", "Date"], ["amount", "Amount"],
    ["accountName", "Account name"], ["accountType", "Account type"], ["provider", "Provider"],
    ["notes", "Notes"], ["refunded", "Refunded"], ["internalTransferTreatment", "Budget treatment"],
  ];
  const key = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const tags = (value) => {
    const names = new Map();
    for (const raw of String(value || "").split(",")) {
      const name = raw.replace(/\s+/g, " ").trim();
      if (name && !names.has(key(name))) names.set(key(name), name);
    }
    return [...names.values()];
  };

  function applyChanges(transaction, changes) {
    if (!changes || !Object.keys(changes).length) throw new Error("Choose at least one field to change.");
    const result = { ...transaction };
    for (const [field, value] of Object.entries(changes)) {
      if (!fields.some(([name]) => name === field)) throw new Error("Unsupported bulk-edit field.");
      if (field === "tags") {
        if (!value || !["add", "remove", "replace", "clear"].includes(value.mode) || typeof value.value !== "string") throw new Error("Choose how to update tags.");
        const incoming = tags(value.value);
        const current = tags(result.tags);
        const removed = new Set(incoming.map(key));
        result.tags = (value.mode === "add" ? tags([...current, ...incoming].join(","))
          : value.mode === "remove" ? current.filter((tag) => !removed.has(key(tag)))
            : value.mode === "clear" ? [] : incoming).join(", ");
        if (tags(result.tags).length > 50 || tags(result.tags).some((tag) => tag.length > 100)) throw new Error("Use at most 50 tags of 100 characters each.");
      } else if (["refunded", "internalTransferTreatment"].includes(field)) {
        const flags = new Set(ui.transactionFlags(result));
        if (field === "refunded") {
          if (typeof value !== "boolean") throw new Error("Choose a refund treatment.");
          if (value) flags.add("refunded"); else flags.delete("refunded");
        } else {
          if (!["automatic", "internal-transfer", "include-in-budget"].includes(value)) throw new Error("Choose a budget treatment.");
          flags.delete("internal-transfer"); flags.delete("include-in-budget");
          if (value !== "automatic") flags.add(value);
        }
        result.flags = [...flags].sort().join(",");
      } else if (field === "amount") {
        if (typeof value === "boolean" || value == null || !String(value).trim() || !Number.isFinite(Number(value))) throw new Error("Amount must be a finite number.");
        result.amount = Math.sign(Number(value)) * Math.round((Math.abs(Number(value)) + Number.EPSILON) * 100) / 100;
      } else {
        if (typeof value !== "string") throw new Error(`${field} must be text.`);
        result[field] = field === "group" ? value.replace(/\s+/g, " ").trim() : value.trim();
        if (field === "description" && !result.description) throw new Error("Description cannot be blank.");
        if (field === "group" && result.group.length > 100) throw new Error("Group names cannot exceed 100 characters.");
        if (field === "date") {
          const parsed = new Date(`${value}T00:00:00Z`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Date must be a valid YYYY-MM-DD date.");
        }
      }
    }
    return result;
  }

  function changedFields(before, after) {
    return [...new Set(fields.map(([field]) => ["refunded", "internalTransferTreatment"].includes(field) ? "flags" : field))]
      .filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
  }

  function node(tag, text, className = "") {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, handler, className = "text-button") {
    const element = node("button", text, className);
    element.type = "button"; element.addEventListener("click", handler);
    return element;
  }
  function select(values, label) {
    const element = node("select");
    element.setAttribute("aria-label", label);
    for (const [value, text] of values) element.append(new Option(text, value));
    return element;
  }
  async function request(path, payload) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Could not update transactions (${response.status}).`);
    return result;
  }

  let activeDialog = null;

  function openEditor({ rows, revision, apply, preview, staged = false, available = [], onClose }) {
    if (activeDialog) return;
    const dialog = node("dialog", undefined, "transaction-bulk-dialog");
    activeDialog = dialog;
    dialog.setAttribute("aria-labelledby", "bulk-edit-title");
    const form = node("form", undefined, "transaction-form");
    const header = node("header", undefined, "form-header");
    const heading = node("div");
    const title = node("h2", `Edit ${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`); title.id = "bulk-edit-title";
    const subtitle = node("p", staged ? "Changes stay in this review until you confirm it." : "Only selected fields will change. A safety backup is created before saving.", "dialog-subtitle");
    heading.append(node("p", "BULK EDIT", "eyebrow"), title, subtitle);
    let busy = false;
    let reviewing = false;
    let pending = null;
    const changes = new Map();
    const body = node("div", undefined, "form-body bulk-edit-body");
    const editSection = node("div");
    const actionList = node("div", undefined, "bulk-action-list");
    const add = select([["", "+ Add a field to change"], ...fields], "Add a field to change");
    add.className = "bulk-add-field";
    editSection.append(node("p", "Add only the fields you want to change; everything else stays as it is.", "bulk-hint"), actionList, add);
    const reviewSection = node("div", undefined, "bulk-review"); reviewSection.hidden = true;
    const error = node("p", "", "form-error"); error.hidden = true; error.setAttribute("role", "alert");
    body.append(editSection, reviewSection, error);
    const footer = node("footer", undefined, "form-footer");
    function close() {
      if (busy) return;
      dialog.close(); dialog.remove(); activeDialog = null; onClose?.();
    }
    const cancel = button("Cancel", close, "secondary-button");
    const back = button("Back", () => {
      reviewing = false; pending = null; reviewSection.hidden = true; editSection.hidden = false;
      back.hidden = true; update();
    }, "secondary-button"); back.hidden = true;
    const confirm = node("button", "Review changes", "primary-button"); confirm.type = "submit"; confirm.disabled = true;
    const closeButton = button("×", close, "icon-button"); closeButton.setAttribute("aria-label", "Cancel bulk edit");
    header.append(heading, closeButton);
    footer.append(cancel, node("span", undefined, "form-footer-spacer"), back, confirm);
    form.append(header, body, footer); dialog.append(form); document.body.append(dialog);
    function update() {
      confirm.textContent = reviewing ? `${staged ? "Update review" : "Apply changes"} (${pending?.changed || 0})` : "Review changes";
      confirm.disabled = busy || (reviewing ? !pending?.changed : changes.size === 0);
      [...add.options].forEach((option) => { option.disabled = changes.has(option.value); });
    }
    function addField(field) {
      if (!field || changes.has(field)) return;
      const labelText = fields.find(([name]) => name === field)[1];
      const item = node("section", undefined, "bulk-action");
      const top = node("div", undefined, "bulk-action-heading");
      top.append(node("strong", labelText), button("Remove", () => { changes.delete(field); item.remove(); update(); }, "text-button bulk-remove"));
      item.append(top);
      let read;
      if (field === "group") {
        const container = node("div"); item.append(container);
        const picker = ui.createGroupPicker(container);
        picker.set("", ui.groupsFromTransactions(available));
        read = () => picker.value();
        item.append(node("small", "Choose an existing group, create one, or select No group to clear it."));
      } else if (field === "tags") {
        const mode = select([["add", "Add tags"], ["remove", "Remove tags"], ["replace", "Replace all tags"], ["clear", "Clear all tags"]], "Tag action");
        const tagForm = node("div");
        // Reuse the transaction tag picker's controls, using the outer form.
        const root = node("fieldset", undefined, "transaction-tag-field"); root.setAttribute("data-transaction-tag-picker", "");
        root.append(node("legend", "Tags"));
        const hidden = node("input"); hidden.type = "hidden"; hidden.name = "tags";
        const controls = node("div", undefined, "transaction-tag-controls"); controls.setAttribute("data-tag-controls", "");
        const empty = node("span", "No existing tags yet.", "transaction-tag-empty"); empty.setAttribute("data-tag-empty", "");
        const create = node("span", undefined, "transaction-tag-create");
        const input = node("input"); input.type = "text"; input.placeholder = "New tag"; input.setAttribute("data-new-tag-input", ""); input.setAttribute("aria-label", "New tag name");
        const plus = button("+", () => {}); plus.setAttribute("data-new-tag-button", ""); plus.setAttribute("aria-label", "Add new tag"); plus.disabled = true;
        create.append(input, plus); controls.append(empty, create); root.append(hidden, controls); tagForm.append(root);
        item.append(mode, tagForm);
        // Configured after attachment, because the helper resolves form fields.
        actionList.append(item);
        ui.configureTransactionTagPicker(form, ui.tagsFromTransactions(available));
        mode.addEventListener("change", () => { tagForm.hidden = mode.value === "clear"; });
        read = () => ({ mode: mode.value, value: ui.transactionFromEditor(form).tags });
        item.append(node("small", "Add and Remove preserve the other tags. Replace and Clear affect the entire tag list."));
      } else if (["refunded", "internalTransferTreatment"].includes(field)) {
        const control = select(field === "refunded" ? [["true", "Mark refunded"], ["false", "Mark not refunded"]]
          : [["automatic", "Automatic"], ["internal-transfer", "Internal transfer — exclude"], ["include-in-budget", "Count normally"]], labelText);
        item.append(control); read = () => field === "refunded" ? control.value === "true" : control.value;
      } else {
        const control = node(field === "notes" ? "textarea" : "input");
        if (field !== "notes") control.type = field === "amount" ? "number" : field === "date" ? "date" : "text";
        if (field === "amount") control.step = "0.01";
        control.required = ["description", "amount", "date"].includes(field);
        control.setAttribute("aria-label", labelText);
        item.append(control); read = () => control.value;
        if (field === "amount") item.append(node("small", "Sets the same amount on every selected transaction. Expenses are positive; income and credits are negative."));
        else if (!control.required) item.append(node("small", "A blank value clears this field on the selected transactions."));
      }
      if (!item.parentElement) actionList.append(item);
      changes.set(field, read); add.value = ""; update();
    }
    add.addEventListener("change", () => addField(add.value));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      error.hidden = true;
      try {
        busy = true; confirm.disabled = true; cancel.disabled = true; back.disabled = true; closeButton.disabled = true;
        if (!reviewing) {
          const values = Object.fromEntries([...changes].map(([field, read]) => [field, read()]));
          const proposed = rows.map((row) => ({ before: row, after: applyChanges(row, values) }));
          const result = preview ? await preview(values, revision) : {
            changes: proposed.map((entry) => ({ ...entry, changedFields: changedFields(entry.before, entry.after) })).filter((entry) => entry.changedFields.length),
          };
          pending = { values, changed: result.changes.length, rows: proposed.map((entry) => entry.after) };
          reviewSection.replaceChildren(node("p", `${pending.changed} of ${rows.length} selected transactions will change.`, "bulk-review-summary"));
          for (const entry of result.changes) {
            const row = node("article", undefined, "bulk-review-row");
            row.append(node("strong", entry.before.description), node("small", entry.before.date));
            for (const field of entry.changedFields) {
              const label = fields.find(([name]) => name === field)?.[1] || "Flags";
              const line = node("div", undefined, "bulk-review-change");
              line.append(node("span", label), node("del", String(entry.before[field] ?? "") || "(blank)"), node("strong", String(entry.after[field] ?? "") || "(blank)"));
              row.append(line);
            }
            reviewSection.append(row);
          }
          if (!pending.changed) reviewSection.append(node("p", "The selected transactions already have these values."));
          reviewing = true; editSection.hidden = true; reviewSection.hidden = false; back.hidden = false;
        } else {
          await apply(pending.values, revision, pending.rows);
          busy = false; close(); return;
        }
      } catch (failure) {
        error.textContent = failure.message || "Could not apply these changes."; error.hidden = false;
      } finally {
        busy = false; cancel.disabled = false; back.disabled = false; closeButton.disabled = false; update();
      }
    });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    dialog.showModal(); add.focus();
  }

  function create(options) {
    const { container } = options;
    const toolbar = node("div", undefined, "transaction-bulk-toolbar");
    const filterWrap = node("div", undefined, "transaction-group-filter");
    const label = node("span", "Group");
    const filterRoot = node("div"); filterWrap.append(label, filterRoot);
    let groupFilter = "";
    const groupPicker = ui.createGroupPicker(filterRoot, { allowCreate: false, includeUngrouped: true, emptyLabel: "All groups", label: "Filter by group", onChange(value) {
      groupFilter = value; options.onGroupChange?.(value); options.render();
    } });
    const controls = node("div", undefined, "transaction-bulk-controls");
    const count = node("span", "", "bulk-selection-count"); count.setAttribute("role", "status");
    const selected = new Set();
    const id = options.getKey || ((row) => row._id);
    let active = false;
    let revision = null;
    let visible = [];
    function resetSelection() { selected.clear(); active = false; revision = null; options.onModeChange?.(false); }
    function changeMode(value) {
      resetSelection(); active = value; revision = options.getRevision(); options.onModeChange?.(value); options.render();
    }
    const toggle = button("Edit multiple", () => changeMode(true), "secondary-button bulk-mode-button");
    const selectVisible = button("Select visible", () => { visible.forEach((row) => selected.add(id(row))); options.render(); });
    const clear = button("Clear selection", () => { selected.clear(); options.render(); });
    const done = button("Done", () => changeMode(false));
    const edit = button("Edit selected (0)", () => {
      const rows = options.getTransactions().filter((row) => selected.has(id(row)));
      if (!rows.length || revision !== options.getRevision()) { resetSelection(); options.render(); return; }
      const ids = rows.map(id);
      openEditor({ rows, revision, staged: options.staged === true,
        available: options.getAllTransactions?.() || options.getTransactions(),
        preview: options.staged ? null : (changes, baseline) => request("/api/transactions/bulk-preview", { ids, changes, revision: baseline }),
        apply: async (changes, baseline, proposed) => {
          if (baseline !== options.getRevision()) throw new Error("This list changed. Cancel and select transactions again.");
          if (options.staged) await options.onStage(ids, proposed);
          else {
            const payload = await request("/api/transactions/bulk", { ids, changes, revision: baseline, confirm: true });
            resetSelection();
            await options.onSaved(payload);
          }
          resetSelection(); options.render();
        },
        onClose: () => { edit.focus(); },
      });
    }, "primary-button");
    controls.append(count, toggle, selectVisible, clear, edit, done);
    for (const control of [count, selectVisible, clear, edit, done]) control.hidden = true;
    toolbar.append(filterWrap, controls);
    const hint = node("p", "Selection is for editing only; it does not change which rows will be imported.", "bulk-import-hint");
    hint.hidden = true; toolbar.append(hint);
    container.before(toolbar);
    function filter(rows) {
      groupFilter = options.getGroupFilter?.() ?? groupFilter;
      return rows.filter((row) => !groupFilter || (groupFilter === "__ledger_no_group__" ? !key(row.group) : key(row.group) === key(groupFilter)));
    }
    function render(rows, rowOptions) {
      if (active && revision !== options.getRevision()) resetSelection();
      const eligible = new Set(options.getTransactions().map(id));
      for (const selectedId of selected) if (!eligible.has(selectedId)) selected.delete(selectedId);
      visible = filter(rows);
      ui.setAvailableGroups(ui.groupsFromTransactions(options.getAllTransactions?.() || options.getTransactions()));
      groupPicker.set(groupFilter, ui.groupsFromTransactions(options.getTransactions()));
      toggle.hidden = active; toggle.disabled = !options.getTransactions().length;
      for (const control of [count, selectVisible, clear, edit, done]) control.hidden = !active;
      selectVisible.disabled = !visible.length; clear.disabled = !selected.size;
      const hidden = selected.size - visible.filter((row) => selected.has(id(row))).length;
      count.textContent = `${selected.size} selected${hidden > 0 ? ` · ${hidden} outside this view` : ""}`;
      edit.textContent = `Edit selected (${selected.size})`; edit.disabled = !selected.size;
      hint.hidden = !(options.staged && active && options.importSelection);
      ui.renderTransactionList(container, visible, (row, index) => {
        const original = rowOptions(row, index);
        if (!active) return original;
        const selection = node("label", undefined, "bulk-row-selection");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(id(row));
        checkbox.setAttribute("aria-label", `Select ${row.description} for bulk editing`);
        checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(id(row)); else selected.delete(id(row)); options.render(); });
        selection.append(checkbox);
        return { ...original, leadingControl: selection, showEdit: false };
      });
      [...container.children].forEach((row, index) => {
        row.classList.toggle("transaction-row--bulk-selectable", active);
        options.decorateRow?.(row, visible[index]);
      });
      if (!visible.length) container.append(node("p", "No transactions match this view.", "empty-transaction-list"));
      return visible;
    }
    return { render, filter, reset({ keepFilter = false } = {}) { resetSelection(); if (!keepFilter) groupFilter = ""; }, isActive: () => active };
  }

  globalObject.LedgerTransactionBulk = Object.freeze({ create, applyChanges, changedFields });
})(window);
