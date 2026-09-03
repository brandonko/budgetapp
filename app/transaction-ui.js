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
  ];

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
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox") {
      refunded.checked = hasTransactionFlag(transaction, "refunded");
    }
    const transferTreatment = form.elements.namedItem("internalTransferTreatment");
    if (transferTreatment instanceof HTMLSelectElement) {
      transferTreatment.value = internalTransferTreatment(transaction);
    }
  }

  function transactionFromEditor(form, existingTransaction = null) {
    const transaction = {};
    for (const fieldName of editableFields) {
      const field = form.elements.namedItem(fieldName);
      transaction[fieldName] = field?.value ?? "";
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

    const description = document.createElement("div");
    description.className = "transaction-description";
    const title = document.createElement("strong");
    title.textContent = transaction.description;
    title.title = transaction.description;
    const metadata = document.createElement("span");
    const categoryLabel = transaction.subcategory
      ? `${transaction.category} / ${transaction.subcategory}`
      : transaction.category;
    metadata.textContent = `${categoryLabel} · ${transaction.accountName} · ${transaction.provider}`;
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
    createTransactionRow,
    createTransactionSortControls,
    hasTransactionFlag,
    internalTransferTreatment,
    isInternalTransfer,
    populateTransactionEditor,
    renderTransactionList,
    sortTransactions,
    transactionFlags,
    transactionFromEditor,
  });
})(window);
