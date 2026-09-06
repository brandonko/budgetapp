"use strict";

(function initializeTransactionsModel(globalObject, createModel) {
  const model = createModel();
  if (typeof module === "object" && module.exports) module.exports = model;
  else globalObject.LedgerTransactionsModel = model;
})(typeof window === "undefined" ? globalThis : window, function createTransactionsModel() {
  const BLANK_VALUE = "__ledger_blank__";
  const UNTAGGED_VALUE = "__ledger_untagged__";

  function normalizedText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function matchKey(value) {
    return normalizedText(value).toLocaleLowerCase();
  }

  function tagsFor(transaction) {
    const values = Array.isArray(transaction.tags)
      ? transaction.tags
      : String(transaction.tags ?? "").split(",");
    return new Set(values.map(matchKey).filter(Boolean));
  }

  function isIncome(transaction) {
    return matchKey(transaction.category) === "income";
  }

  // Keep treatment precedence identical to LedgerTransactionUI.isInternalTransfer.
  // The server reconciles automatic pairs across the whole database before querying.
  function isExcluded(transaction) {
    const flags = new Set(String(transaction.flags ?? "").split(",").map(matchKey));
    if (flags.has("refunded") || flags.has("internal-transfer")) return true;
    if (flags.has("include-in-budget")) return false;
    return transaction._isInternalTransfer === true;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function amountInCents(transaction) {
    const amount = Number(transaction.amount);
    if (!Number.isFinite(amount)) throw new TypeError("Transaction amounts must be finite numbers.");
    // Round each row before adding; ordinary negative refunds reduce spending.
    return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  }

  function filterTransactions(transactions, filters = {}) {
    const description = matchKey(filters.description);
    const exactFields = ["category", "subcategory", "accountName", "provider"]
      .map((field) => [field, matchKey(filters[field])])
      .filter(([, value]) => value);
    const selectedTags = [...new Set((filters.tags || []).map(matchKey).filter(Boolean))];
    const startDate = normalizedText(filters.startDate);
    const endDate = normalizedText(filters.endDate);
    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) return [];
    if (startDate && endDate && startDate > endDate) return [];

    return transactions.filter((transaction) => {
      if (description && !matchKey(transaction.description).includes(description)) return false;
      for (const [field, value] of exactFields) {
        const current = matchKey(transaction[field]);
        if (value === BLANK_VALUE && (field === "category" || field === "subcategory")) {
          if (current) return false;
        } else if (current !== value) return false;
      }
      if ((startDate || endDate) && !validDate(transaction.date)) return false;
      if (startDate && transaction.date < startDate) return false;
      if (endDate && transaction.date > endDate) return false;
      if (filters.type === "spending" && isIncome(transaction)) return false;
      if (filters.type === "income" && !isIncome(transaction)) return false;
      if (filters.showExcluded === false && isExcluded(transaction)) return false;
      if (selectedTags.length) {
        const tags = tagsFor(transaction);
        const matches = (tag) => tag === UNTAGGED_VALUE ? tags.size === 0 : tags.has(tag);
        if (!(filters.tagMode === "all"
          ? selectedTags.every(matches)
          : selectedTags.some(matches))) return false;
      }
      return true;
    });
  }

  function summarizeTransactions(transactions) {
    let spentCents = 0;
    let incomeCents = 0;
    let excludedCount = 0;
    let startDate = "";
    let endDate = "";
    for (const transaction of transactions) {
      if (validDate(transaction.date)) {
        if (!startDate || transaction.date < startDate) startDate = transaction.date;
        if (!endDate || transaction.date > endDate) endDate = transaction.date;
      }
      if (isExcluded(transaction)) {
        excludedCount += 1;
        continue;
      }
      const cents = amountInCents(transaction);
      if (isIncome(transaction)) incomeCents += Math.abs(cents);
      else spentCents += cents;
    }
    return {
      spent: spentCents / 100,
      income: incomeCents / 100,
      net: (incomeCents - spentCents) / 100,
      count: transactions.length,
      excludedCount,
      startDate,
      endDate,
    };
  }

  function spendingByCategory(transactions) {
    const categories = new Map();
    for (const transaction of transactions) {
      if (isIncome(transaction) || isExcluded(transaction)) continue;
      const category = normalizedText(transaction.category);
      const key = matchKey(category);
      if (!categories.has(key)) categories.set(key, { category, cents: 0, count: 0 });
      const group = categories.get(key);
      group.cents += amountInCents(transaction);
      group.count += 1;
    }
    return [...categories.values()]
      .sort((left, right) => right.cents - left.cents || left.category.localeCompare(right.category))
      .map(({ category, cents, count }) => ({ category, total: cents / 100, count }));
  }

  return Object.freeze({ filterTransactions, summarizeTransactions, spendingByCategory });
});
