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

  function createGroupPicker(container, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "transaction-group-picker";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = 100;
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

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      input.value = selected === "__ledger_no_group__" ? "No group" : selected;
      input.setCustomValidity("");
    }
    function choose(value) {
      selected = value;
      if (value && value !== "__ledger_no_group__" && !names.some((name) => name.toLocaleLowerCase() === value.toLocaleLowerCase())) names.push(value);
      close();
      options.onChange?.(selected);
      input.focus();
      close();
    }
    function render() {
      const query = groupName(input.value);
      const lower = query.toLocaleLowerCase();
      choices = [{ value: "", label: options.emptyLabel || "No group" }];
      if (options.includeUngrouped) choices.push({ value: "__ledger_no_group__", label: "No group" });
      choices.push(...names.filter((name) => !lower || name.toLocaleLowerCase().includes(lower))
        .map((value) => ({ value, label: value })));
      if (options.allowCreate !== false && query && !names.some((name) => name.toLocaleLowerCase() === lower)) {
        choices.push({ value: query, label: `+ Create “${query}”` });
      }
      list.replaceChildren(...choices.map((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = `${list.id}-${index}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(choice.value === selected));
        button.tabIndex = -1;
        button.textContent = choice.label;
        button.addEventListener("click", () => choose(choice.value));
        return button;
      }));
      activeIndex = -1;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    input.addEventListener("focus", () => { input.select(); render(); });
    input.addEventListener("click", render);
    input.addEventListener("input", () => {
      input.setCustomValidity("Choose a group from the list, or use Create to add it.");
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
        if (activeIndex >= 0) choose(choices[activeIndex].value);
        else if (exact || !groupName(input.value)) choose(exact || "");
        else if (options.allowCreate !== false) choose(groupName(input.value));
      }
    });
    wrap.addEventListener("focusout", (event) => { if (!wrap.contains(event.relatedTarget)) close(); });
    return {
      value: () => selected,
      set(value, groups = names) {
        names = groupsFromTransactions([...groups, value].map((group) => ({ group })))
          .filter((name) => name !== "__ledger_no_group__");
        selected = names.find((name) => name.toLocaleLowerCase() === groupName(value).toLocaleLowerCase()) || groupName(value);
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
    const treatment = internalTransferTreatment(transaction);
    if (treatment === "internal-transfer") return true;
    if (treatment === "include-in-budget") return false;
    return transaction?._isInternalTransfer === true;
  }

  function flagsFromEditor(form, transaction) {
    const flags = new Set(transactionFlags(transaction));
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox") {
      if (refunded.checked) flags.add("refunded");
      else flags.delete("refunded");
    }
    const transferTreatment = form.elements.namedItem("internalTransferTreatment");
    if (transferTreatment instanceof HTMLSelectElement) {
      flags.delete("internal-transfer");
      flags.delete("include-in-budget");
      if (transferTreatment.value === "internal-transfer") flags.add("internal-transfer");
      if (transferTreatment.value === "include-in-budget") flags.add("include-in-budget");
    }
    return [...flags].sort().join(",");
  }

  function populateTransactionEditor(form, transaction, defaults = {}) {
    form.reset();
    for (const fieldName of editableFields) {
      const field = form.elements.namedItem(fieldName);
      if (field) field.value = transaction?.[fieldName] ?? defaults[fieldName] ?? "";
    }
    configureTransactionGroupPicker(form);
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox") {
      refunded.checked = hasTransactionFlag(transaction, "refunded");
    }
    const transferTreatment = form.elements.namedItem("internalTransferTreatment");
    if (transferTreatment instanceof HTMLSelectElement) {
      transferTreatment.value = internalTransferTreatment(transaction);
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
    return transaction;
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
      disabled = false,
      showEdit = true,
      amountForDisplay = null,
      showYear = false,
    } = options;
    const refunded = hasTransactionFlag(transaction, "refunded");
    const internalTransfer = isInternalTransfer(transaction);
    const income = transaction.category.trim().toLocaleLowerCase() === "income";
    const originalDisplayedAmount = income
      ? Math.abs(Number(transaction.amount))
      : Number(transaction.amount);
    const displayedAmount = refunded || internalTransfer
      ? originalDisplayedAmount
      : amountForDisplay
        ? amountForDisplay(transaction)
        : originalDisplayedAmount;

    const row = document.createElement("article");
    row.className = "transaction-row";
    row.classList.toggle("transaction-row--duplicate", duplicate);
    row.classList.toggle("transaction-row--needs-classification", needsClassification);
    row.classList.toggle("transaction-row--refunded", refunded);
    row.classList.toggle("transaction-row--internal-transfer", internalTransfer);

    const parsedDate = new Date(`${transaction.date}T12:00:00Z`);
    const dateElement = document.createElement("time");
    dateElement.className = "transaction-date";
    dateElement.dateTime = transaction.date;
    const month = document.createTextNode(shortMonthFormatter.format(parsedDate));
    const day = document.createElement("strong");
    day.textContent = parsedDate.getUTCDate();
    dateElement.append(month, day);
    if (showYear) {
      const year = document.createElement("small");
      year.textContent = String(parsedDate.getUTCFullYear());
      dateElement.append(year);
    }
    const description = document.createElement("div");
    description.className = "transaction-description";
    const title = document.createElement("strong");
    title.textContent = transaction.description;
    title.title = transaction.description;
    const metadata = document.createElement("span");
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

    const actions = document.createElement("div");
    actions.className = "transaction-actions";
    const amount = document.createElement("span");
    amount.className = "transaction-amount";
    amount.classList.toggle("is-credit", Number(transaction.amount) < 0 || income);
    amount.textContent = currency.format(displayedAmount);
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

    row.append(...(leadingControl ? [leadingControl] : []), dateElement, description, actions);
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
    compareTransactions,
    configureTransactionTagPicker,
    configureTransactionGroupPicker,
    createGroupPicker,
    groupsFromTransactions,
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
