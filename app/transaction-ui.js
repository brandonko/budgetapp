"use strict";

(function initializeTransactionUi(globalObject) {
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

  function flagsFromEditor(form, transaction) {
    const flags = new Set(transactionFlags(transaction));
    const refunded = form.elements.namedItem("refunded");
    if (refunded instanceof HTMLInputElement && refunded.type === "checkbox") {
      if (refunded.checked) flags.add("refunded");
      else flags.delete("refunded");
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

  function createTransactionRow(transaction, options) {
    const {
      currency,
      shortMonthFormatter,
      onEdit,
      leadingControl = null,
      duplicate = false,
      disabled = false,
      amountForDisplay = null,
    } = options;
    const refunded = hasTransactionFlag(transaction, "refunded");
    const income = transaction.category.trim().toLocaleLowerCase() === "income";
    const displayedAmount = amountForDisplay
      ? amountForDisplay(transaction)
      : refunded
        ? 0
        : income
          ? Math.abs(Number(transaction.amount))
          : Number(transaction.amount);

    const row = document.createElement("article");
    row.className = "transaction-row";
    row.classList.toggle("transaction-row--duplicate", duplicate);
    row.classList.toggle("transaction-row--refunded", refunded);

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
    if (refunded) {
      const refundedBadge = document.createElement("span");
      refundedBadge.className = "transaction-flag transaction-flag--refunded";
      refundedBadge.textContent = "Refunded";
      description.append(refundedBadge);
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
    if (refunded) {
      amount.title = `Original amount: ${currency.format(Number(transaction.amount))}; excluded from totals`;
    }
    const editButton = document.createElement("button");
    editButton.className = "edit-button";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.disabled = disabled;
    editButton.setAttribute("aria-label", `Edit ${transaction.description}`);
    editButton.addEventListener("click", onEdit);
    actions.append(amount, editButton);

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
    createTransactionRow,
    hasTransactionFlag,
    populateTransactionEditor,
    renderTransactionList,
    transactionFlags,
    transactionFromEditor,
  });
})(window);
