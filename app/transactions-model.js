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

  // One literal, case-insensitive search contract for every transaction surface.
  // Normalize a view of multiline notes, never the stored freeform text.
  function matchesTransactionSearch(transaction, query) {
    const key = matchKey(query);
    return !key || [transaction.description, transaction.notes]
      .some((value) => matchKey(value).includes(key));
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
  // Detection runs on import or an explicit scan; queries use persisted treatment.
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
      if (!matchesTransactionSearch(transaction, description)) return false;
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

  function compareGroups(transactions, selectedGroups, { startDate = "", endDate = "", baseline = "" } = {}) {
    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate)) || (startDate && endDate && startDate > endDate)) {
      throw new TypeError("Choose a valid date range.");
    }
    const names = new Map();
    for (const transaction of transactions) {
      const name = normalizedText(transaction.group);
      if (name && !names.has(matchKey(name))) names.set(matchKey(name), name);
    }
    const chosen = new Map();
    for (const value of selectedGroups) {
      const name = normalizedText(value);
      if (name && !chosen.has(matchKey(name))) chosen.set(matchKey(name), names.get(matchKey(name)) || name);
    }
    if (chosen.size > 4) throw new RangeError("Compare up to four groups at a time.");
    const groups = [...chosen].map(([key, name]) => {
      const all = transactions.filter((transaction) => matchKey(transaction.group) === key);
      const rows = filterTransactions(all, { startDate, endDate });
      const summary = summarizeTransactions(rows);
      let purchases = 0; let credits = 0;
      for (const transaction of rows) {
        if (isIncome(transaction) || isExcluded(transaction)) continue;
        const amount = amountInCents(transaction);
        if (amount < 0) credits -= amount; else purchases += amount;
      }
      return { key, name, ...summary, savedCount: all.length, purchases: purchases / 100, credits: credits / 100,
        categories: spendingByCategory(rows) };
    });
    const reference = groups.find((group) => group.key === matchKey(baseline)) || groups[0];
    for (const group of groups) {
      group.difference = reference?.count && group.count
        ? (Math.round(group.spent * 100) - Math.round(reference.spent * 100)) / 100 : null;
    }
    const categories = new Map();
    for (const group of groups) for (const entry of group.categories) {
      const key = matchKey(entry.category);
      if (!categories.has(key)) categories.set(key, { key, category: entry.category, magnitude: 0, cells: new Map() });
      const category = categories.get(key);
      category.magnitude += Math.abs(Math.round(entry.total * 100));
      category.cells.set(group.key, entry);
    }
    return { groups, baseline: reference?.key || "", categories: [...categories.values()]
      .sort((a, b) => b.magnitude - a.magnitude || a.category.localeCompare(b.category))
      .map((entry) => ({ key: entry.key, category: entry.category,
        cells: groups.map((group) => entry.cells.get(group.key) || { category: entry.category, total: 0, count: 0 }) })) };
  }

  return Object.freeze({ matchesTransactionSearch, filterTransactions, summarizeTransactions, spendingByCategory, compareGroups });
});
