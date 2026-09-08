"use strict";
(function (root, factory) {
  const model = typeof module === "object" && module.exports ? require("./transactions-model.js") : root.LedgerTransactionsModel;
  const api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api; else root.LedgerMerchants = api;
})(typeof window === "undefined" ? globalThis : window, function (model) {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const key = (value) => clean(value).toLocaleLowerCase();
  const cents = (value) => Math.sign(Number(value)) * Math.round((Math.abs(Number(value)) + Number.EPSILON) * 100);
  function analyze(transactions, filters = {}) {
    const scoped = model.filterTransactions(transactions, { ...filters, type: "spending", showExcluded: false });
    const groups = new Map();
    for (const tx of scoped) {
      const name = clean(tx.description) || "Unnamed description";
      const id = key(name);
      if (!groups.has(id)) groups.set(id, { id, name, charges: 0, credits: 0, count: 0, purchaseCount: 0,
        firstDate: tx.date, lastDate: tx.date, months: new Map(), amounts: [] });
      const item = groups.get(id);
      const value = cents(tx.amount);
      if (!Number.isSafeInteger(value)) throw new Error("An amount is too large for exact merchant totals.");
      if (value > 0) { item.charges += value; item.purchaseCount++; item.amounts.push(value); }
      else item.credits += value;
      item.count++;
      item.firstDate = item.firstDate < tx.date ? item.firstDate : tx.date;
      item.lastDate = item.lastDate > tx.date ? item.lastDate : tx.date;
      const month = tx.date.slice(0, 7);
      item.months.set(month, (item.months.get(month) || 0) + value);
      if (![item.charges, item.credits].every(Number.isSafeInteger)) throw new Error("Merchant totals exceed the supported exact range.");
    }
    const totalCharges = [...groups.values()].reduce((total, item) => total + item.charges, 0);
    if (!Number.isSafeInteger(totalCharges)) throw new Error("The selected range is too large for exact totals.");
    let entries = [...groups.values()].map((item) => {
      item.amounts.sort((a, b) => a - b);
      const half = Math.floor(item.amounts.length / 2);
      const median = item.amounts.length ? item.amounts.length % 2 ? item.amounts[half] : (item.amounts[half - 1] + item.amounts[half]) / 2 : null;
      return { id: item.id, name: item.name, charges: item.charges / 100, credits: item.credits / 100,
        spent: (item.charges + item.credits) / 100, count: item.count, purchaseCount: item.purchaseCount,
        median: median === null ? null : median / 100, firstDate: item.firstDate, lastDate: item.lastDate,
        share: totalCharges ? item.charges / totalCharges : 0,
        months: [...item.months].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, spent: value / 100 })) };
    });
    if (filters.merchantSearch) entries = entries.filter((item) => item.id.includes(key(filters.merchantSearch)));
    entries = entries.filter((item) => item.purchaseCount >= (Number(filters.minimumPurchases) || 0));
    entries.sort(filters.sort === "count" ? (a, b) => b.purchaseCount - a.purchaseCount || b.spent - a.spent
      : filters.sort === "name" ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
    return { entries, summary: model.summarizeTransactions(scoped), totalCharges: totalCharges / 100 };
  }
  return Object.freeze({ analyze });
});
