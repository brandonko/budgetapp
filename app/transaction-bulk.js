"use strict";

// Shared selection and staged, explicit bulk edits for every transaction list.
(function initializeTransactionBulk(globalObject) {
  const ui = globalObject.LedgerTransactionUI;
  const fields = [
    ["group", "Group"], ["tags", "Tags"], ["category", "Category"], ["subcategory", "Subcategory"],
    ["description", "Description"], ["date", "Date"], ["amount", "Amount"],
    ["accountName", "Account name"], ["accountType", "Account type"], ["provider", "Provider"],
    ["notes", "Notes"], ["refunded", "Refunded"], ["flagged", "Flagged"], ["internalTransferTreatment", "Budget treatment"],
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
      } else if (["refunded", "flagged", "internalTransferTreatment"].includes(field)) {
        const flags = new Set(ui.transactionFlags(result));
        if (field === "refunded" || field === "flagged") {
          if (typeof value !== "boolean") throw new Error(field === "flagged" ? "Choose a flag status." : "Choose a refund treatment.");
          if (value) flags.add(field); else flags.delete(field);
        } else {
          if (!["automatic", "internal-transfer", "include-in-budget"].includes(value)) throw new Error("Choose a budget treatment.");
          flags.delete("internal-transfer"); flags.delete("include-in-budget");
          if (value !== "internal-transfer") for (const flag of flags) if (flag.startsWith("transfer-pair-")) flags.delete(flag);
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
    const comparable = value => value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    return [...new Set([...fields.map(([field]) => ["refunded", "flagged", "internalTransferTreatment"].includes(field) ? "flags" : field), "links", "linkTo", "repaymentTo"])]
      .filter((field) => comparable(before[field]) !== comparable(after[field]));
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
    if (!response.ok) throw new Error(result.error || (path.endsWith("/bulk-delete") && response.status === 404
      ? "Restart the Ledger Python server to enable bulk deletion, then try again."
      : `Could not update transactions (${response.status}).`));
    return result;
  }

  let activeDialog = null;

  function openDeleteReview({ rows, hiddenCount, apply, onClose }) {
    if (activeDialog) return;
    const dialog = node("dialog", undefined, "transaction-bulk-dialog bulk-delete-dialog");
    activeDialog = dialog;
    dialog.setAttribute("aria-labelledby", "bulk-delete-title");
    dialog.setAttribute("aria-describedby", "bulk-delete-warning");
    const shell = node("div", undefined, "transaction-form");
    const header = node("header", undefined, "form-header");
    const heading = node("div");
    const title = node("h2", `Delete ${rows.length} selected ${rows.length === 1 ? "transaction" : "transactions"}?`);
    title.id = "bulk-delete-title";
    const warning = node("p", "These transactions will be permanently removed from your master CSV. This cannot be undone in the app. A safety backup will be created first. Links to deleted rows are removed; surviving purchases or credits may count toward your budget again.", "dialog-subtitle");
    warning.id = "bulk-delete-warning";
    heading.append(node("p", "CONFIRM DELETION", "eyebrow"), title, warning);
    const body = node("div", undefined, "form-body");
    if (hiddenCount) body.append(node("p", `${hiddenCount} selected ${hiddenCount === 1 ? "transaction is" : "transactions are"} outside your current filters or page. All selected transactions are listed below.`, "bulk-hint"));
    const list = node("div", undefined, "bulk-delete-list");
    const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
    ui.renderTransactionList(list, ui.sortTransactions(rows), () => ({ currency, shortMonthFormatter, showEdit: false, showYear: true }));
    const error = node("p", "", "form-error"); error.hidden = true; error.setAttribute("role", "alert");
    body.append(list, error);
    const footer = node("footer", undefined, "form-footer");
    let busy = false;
    function close() {
      if (busy) return;
      dialog.close(); dialog.remove(); activeDialog = null; onClose?.();
    }
    const cancel = button("Cancel", close, "secondary-button");
    const closeButton = button("×", close, "icon-button"); closeButton.setAttribute("aria-label", "Cancel deletion");
    const confirm = button(`Delete permanently (${rows.length})`, async () => {
      if (busy) return;
      busy = true; error.hidden = true;
      confirm.disabled = true; cancel.disabled = true; closeButton.disabled = true;
      try {
        await apply();
        busy = false; close();
      } catch (failure) {
        error.textContent = failure.message || "Could not delete selected transactions.";
        error.hidden = false;
      } finally {
        busy = false; confirm.disabled = false; cancel.disabled = false; closeButton.disabled = false;
      }
    }, "danger-button");
    header.append(heading, closeButton);
    footer.append(cancel, node("span", undefined, "form-footer-spacer"), confirm);
    shell.append(header, body, footer); dialog.append(shell); document.body.append(dialog);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    // Enter on the initially focused control must never confirm a destructive action.
    dialog.showModal(); cancel.focus();
  }

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
    const valuePickers = new Map();
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
      top.append(node("strong", labelText), button("Remove", () => { changes.delete(field); valuePickers.delete(field); item.remove(); update(); }, "text-button bulk-remove"));
      item.append(top);
      let read;
      if (field === "group") {
        const container = node("div"); item.append(container);
        const picker = ui.createGroupPicker(container);
        picker.set("", ui.groupsFromTransactions(available));
        read = () => picker.value();
        item.append(node("small", "Choose an existing group, create one, or select No group to clear it."));
      } else if (["category", "subcategory", "accountName", "accountType", "provider"].includes(field)) {
        const container = node("div"); item.append(container);
        const picker = ui.createTransactionValuePicker(container, field, {
          transactions: available,
          getCategory: () => changes.get("category")?.() || "",
          onSelectCategory: (category) => {
            // Keep the inferred parent visible and part of explicit bulk review.
            addField("category");
            valuePickers.get("category").set(category);
          },
        });
        valuePickers.set(field, picker);
        picker.set("");
        read = () => picker.value();
        item.append(node("small", "Choose an existing value, add a new one, or choose the blank option to clear this field."));
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
      } else if (["refunded", "flagged", "internalTransferTreatment"].includes(field)) {
        const control = select(field === "flagged" ? [["true", "Flag for follow-up"], ["false", "Remove flag"]]
          : field === "refunded" ? [["true", "Mark refunded"], ["false", "Mark not refunded"]]
          : [["automatic", "Eligible for detection"], ["internal-transfer", "Internal transfer — exclude"], ["include-in-budget", "Count normally"]], labelText);
        item.append(control); read = () => field !== "internalTransferTreatment" ? control.value === "true" : control.value;
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
    toolbar.hidden = true;
    const controls = node("div", undefined, "transaction-bulk-controls");
    const count = node("span", "", "bulk-selection-count"); count.setAttribute("role", "status");
    const selected = new Set();
    const id = options.getKey || ((row) => row._id);
    let active = false;
    let flagBusy = false;
    let flagError = "";
    const pendingFlags = new Map();
    const acceptedPayloads = new WeakSet();
    const flagKey = (row) => row.id || id(row);
    let flagRevision = null;
    let savingFlags = null;
    const isStaged = () => typeof options.staged === "function" ? options.staged() : options.staged === true;
    let revision = null;
    let visible = [];
    const rangeSelection = ui.createCheckboxRangeSelection((ids, checked) => {
      ids.forEach((item) => { if (checked) selected.add(item); else selected.delete(item); });
      options.render();
    });
    function resetSelection() { selected.clear(); rangeSelection.reset(); active = false; revision = null; options.onModeChange?.(false); }
    function changeMode(value) {
      resetSelection(); active = value; revision = options.getRevision(); options.onModeChange?.(value); options.render();
    }
    const toggle = button("Edit multiple", () => changeMode(!active), "secondary-button bulk-mode-button");
    toggle.setAttribute("aria-pressed", "false");
    const selectVisible = button("Select visible", () => { rangeSelection.reset(); visible.forEach((row) => selected.add(id(row))); options.render(); });
    const clear = button("Clear selection", () => { rangeSelection.reset(); selected.clear(); options.render(); });
    const edit = button("Edit selected (0)", () => {
      const rows = options.getTransactions().filter((row) => selected.has(id(row)));
      if (!rows.length || revision !== options.getRevision()) { resetSelection(); options.render(); return; }
      const ids = rows.map(id);
      const staged = isStaged();
      openEditor({ rows, revision, staged,
        available: options.getAllTransactions?.() || options.getTransactions(),
        preview: staged ? null : (changes, baseline) => request("/api/transactions/bulk-preview", { ids, changes, revision: baseline }),
        apply: async (changes, baseline, proposed) => {
          if (baseline !== options.getRevision()) throw new Error("This list changed. Cancel and select transactions again.");
          if (staged) await options.onStage(ids, proposed);
          else {
            const payload = await request("/api/transactions/bulk", { ids, changes, revision: baseline, confirm: true });
            acceptSaved(payload, { ids, changes });
            resetSelection();
            await options.onSaved(payload);
          }
          resetSelection(); options.render();
        },
        onClose: () => { (active ? edit : toggle).focus(); },
      });
    }, "primary-button");
    const remove = button("Delete selected (0)", () => {
      if (isStaged()) return;
      const rows = options.getTransactions().filter((row) => selected.has(id(row)));
      if (!rows.length || revision !== options.getRevision()) { resetSelection(); options.render(); return; }
      // Capture both the selection and revision; neither may drift during confirmation.
      const baseline = revision;
      const ids = rows.map(id);
      openDeleteReview({ rows: rows.map((row) => ({ ...row })),
        hiddenCount: rows.length - visible.filter((row) => selected.has(id(row))).length,
        apply: async () => {
          if (isStaged() || baseline !== options.getRevision()) throw new Error("This list changed. Cancel and select transactions again.");
          const payload = await request("/api/transactions/bulk-delete", { ids, revision: baseline, confirm: true });
          acceptSaved(payload);
          resetSelection();
          await options.onSaved(payload);
          options.render();
        },
        onClose: () => { (active ? remove : toggle).focus(); },
      });
    }, "danger-button bulk-delete-button");
    controls.append(count, selectVisible, clear, edit, remove);
    const header = options.header || (container.closest(".dialog-shell") || container.parentElement).querySelector("header");
    const actions = node("div", undefined, "transaction-list-header-actions");
    const close = header.querySelector(".icon-button");
    if (close) { close.before(actions); actions.append(close); }
    else header.append(actions);
    actions.append(toggle);
    const flagStatus = node("small", "", "bulk-hint");
    flagStatus.setAttribute("role", "status"); flagStatus.hidden = true;
    actions.append(flagStatus);
    const saveFlagsButton = button("Save flags", () => flushFlags(), "text-button");
    saveFlagsButton.hidden = true; actions.append(saveFlagsButton);
    toolbar.append(controls);
    const hint = node("p", "Selection is for editing only; it does not change which rows will be imported.", "bulk-import-hint");
    hint.hidden = true; toolbar.append(hint);
    container.before(toolbar);
    function filter(rows) {
      return rows.filter((row) => ui.matchesGroupFilter(row, options.getGroupFilter?.() || ""));
    }
    function toggleFlag(row, value) {
      if (flagBusy || activeDialog) return;
      const before = { ...row };
      const identity = flagKey(row);
      const original = pendingFlags.get(identity)?.original ?? ui.hasTransactionFlag(row, "flagged");
      if (!pendingFlags.size) flagRevision = options.getRevision();
      if (original === value && !isStaged()) pendingFlags.delete(identity);
      else pendingFlags.set(identity, { original, value });
      for (const item of new Set([row, ...options.getTransactions(), ...(isStaged() ? [] : options.getAllTransactions?.() || [])])) {
        if (flagKey(item) === identity) item.flags = applyChanges(item, { flagged: value }).flags;
      }
      flagError = "";
      options.onFlagChange?.(row, before);
      options.render();
      const currentRow = [...container.children].find((element) => element.dataset.transactionKey === String(id(row)));
      (currentRow?.querySelector(".transaction-flag-toggle") || toggle).focus();
    }
    // Called only for a successful write made by this editor/list, never to accept
    // an unrelated refresh. Preserve queued flags across edits and row reindexing.
    function acceptSaved(payload, { ids = [], changes = {} } = {}) {
      if (acceptedPayloads.has(payload)) return payload;
      acceptedPayloads.add(payload);
      if (Object.hasOwn(changes, "flagged")) {
        options.getTransactions().filter(row => ids.includes(id(row))).forEach(row => pendingFlags.delete(flagKey(row)));
      }
      const present = new Set(payload.transactions.map(flagKey));
      for (const identity of pendingFlags.keys()) if (!present.has(identity)) pendingFlags.delete(identity);
      for (const row of payload.transactions) {
        const pending = pendingFlags.get(flagKey(row));
        if (!pending) continue;
        pending.original = ui.hasTransactionFlag(row, "flagged");
        if (pending.original === pending.value) pendingFlags.delete(flagKey(row));
        else row.flags = applyChanges(row, { flagged: pending.value }).flags;
      }
      flagRevision = payload.revision;
      return payload;
    }
    function prepareSave(transaction, original) {
      const pending = pendingFlags.get(flagKey(original));
      if (!pending) return transaction;
      const value = ui.hasTransactionFlag(transaction, "flagged");
      pending.value = value;
      if (pending.original === value) pendingFlags.delete(flagKey(original));
      return applyChanges(transaction, { flagged: pending.original });
    }
    async function savePendingFlags() {
      if (!pendingFlags.size) return true;
      flagBusy = true; flagError = ""; options.render();
      try {
        if (isStaged()) {
          const rows = options.getTransactions().filter(row => pendingFlags.has(flagKey(row)));
          await options.onStage(rows.map(id), rows.map(row => ({ ...row })));
          pendingFlags.clear();
        } else {
          if (flagRevision !== options.getRevision()) throw new Error("This list changed. Your flags have not been saved. Reload and review them again.");
          const payload = await request("/api/transactions/flags", {
            updates: [...new Map([...(options.getAllTransactions?.() || []), ...options.getTransactions()].map(row => [flagKey(row), row])).values()]
              .filter(row => pendingFlags.has(flagKey(row)))
              .map(row => ({ id: row._id, flagged: pendingFlags.get(flagKey(row)).value })),
            revision: flagRevision, confirm: true,
          });
          pendingFlags.clear(); flagRevision = null;
          resetSelection(); await options.onSaved(payload);
        }
        return true;
      } catch (error) { flagError = `${error.message || "Could not save flags."} Your pending flags are kept here; try saving again.`; return false; }
      finally { flagBusy = false; options.render(); }
    }
    function flushFlags() {
      if (!savingFlags) savingFlags = savePendingFlags().finally(() => { savingFlags = null; });
      return savingFlags;
    }
    // Browser reload/close cannot reliably await writes. Warn instead of fire-and-forget.
    globalObject.addEventListener("beforeunload", event => {
      if (pendingFlags.size && !isStaged()) { event.preventDefault(); event.returnValue = ""; }
    });
    if (options.page) document.addEventListener("click", async event => {
      const link = event.target.closest?.("a[href]");
      if (!link || !pendingFlags.size || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
          || event.button > 0 || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, globalObject.location.href);
      if (destination.origin !== globalObject.location.origin || destination.href.split("#")[0] === globalObject.location.href.split("#")[0]) return;
      event.preventDefault();
      if (await flushFlags()) globalObject.location.assign(destination.href);
    });
    function render(rows, rowOptions) {
      if (active && revision !== options.getRevision()) resetSelection();
      const eligible = new Set(options.getTransactions().map(id));
      for (const selectedId of selected) if (!eligible.has(selectedId)) selected.delete(selectedId);
      visible = filter(rows);
      rangeSelection.sync(visible.map(id), revision);
      ui.setAvailableGroups(ui.groupsFromTransactions(options.getAllTransactions?.() || options.getTransactions()));
      toolbar.hidden = !active;
      toggle.textContent = active ? "Done editing" : "Edit multiple";
      toggle.setAttribute("aria-pressed", String(active));
      toggle.disabled = flagBusy || !options.getTransactions().length;
      selectVisible.disabled = !visible.length; clear.disabled = !selected.size;
      const hidden = selected.size - visible.filter((row) => selected.has(id(row))).length;
      count.textContent = `${selected.size} selected${hidden > 0 ? ` · ${hidden} outside this view` : ""}`;
      edit.textContent = `Edit selected (${selected.size})`; edit.disabled = flagBusy || !selected.size;
      remove.textContent = `Delete selected (${selected.size})`; remove.disabled = flagBusy || !selected.size || isStaged();
      remove.hidden = isStaged();
      hint.hidden = !(options.staged && active && options.importSelection);
      flagStatus.hidden = !pendingFlags.size && !flagError;
      flagStatus.textContent = flagError || (flagBusy ? "Saving flags…" : isStaged() ? "Flags staged for review"
        : options.page ? "Flags save when leaving this page" : "Flags save when this list closes");
      saveFlagsButton.hidden = !pendingFlags.size || (!options.page && !flagError) || isStaged();
      saveFlagsButton.disabled = flagBusy;
      ui.renderTransactionList(container, visible, (row, index) => {
        const supplied = rowOptions(row, index);
        const original = { ...supplied, disabled: flagBusy || supplied.disabled,
          onToggleFlag: supplied.onToggleFlag || ((value) => toggleFlag(row, value)) };
        if (!active) return original;
        const selection = node("label", undefined, "bulk-row-selection");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(id(row));
        checkbox.setAttribute("aria-label", `Select ${row.description} for bulk editing`);
        rangeSelection.bind(checkbox, id(row));
        selection.append(checkbox);
        // Selection is additive: keep each variant's existing row editor available.
        // Explicitly read-only preview rows still retain their showEdit: false.
        return { ...original, leadingControl: selection };
      });
      [...container.children].forEach((row, index) => {
        row.dataset.transactionKey = String(id(visible[index]));
        row.classList.toggle("transaction-row--bulk-selectable", active);
        options.decorateRow?.(row, visible[index]);
      });
      if (!visible.length) container.append(node("p", "No transactions match this view.", "empty-transaction-list"));
      if (flagError) {
        const error = node("p", flagError, "transaction-flag-error");
        error.setAttribute("role", "alert"); container.prepend(error);
      }
      return visible;
    }
    return { render, filter, flushFlags, acceptSaved, prepareSave,
      hasPendingFlags: () => pendingFlags.size > 0,
      discardFlags() { pendingFlags.clear(); flagError = ""; },
      reset() { resetSelection(); flagError = ""; toolbar.hidden = true; toggle.textContent = "Edit multiple"; toggle.setAttribute("aria-pressed", "false"); }, isActive: () => active };
  }

  globalObject.LedgerTransactionBulk = Object.freeze({ create, applyChanges, changedFields });
})(window);
