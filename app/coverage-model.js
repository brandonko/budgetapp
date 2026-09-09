"use strict";

(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.LedgerCoverageModel = model;
})(typeof window === "undefined" ? globalThis : window, function () {
  const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const key = (value) => text(value).toLowerCase();
  const day = (value) => Date.parse(`${value}T00:00:00Z`);
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(day(value)) && new Date(day(value)).toISOString().slice(0, 10) === value;
  }
  function importTime(value) {
    if (typeof value !== "string" || !validDate(value.slice(0, 10))
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  function buildCoverage(transactions, { today, year = today?.slice(0, 4), olderThan = 30, query = "" } = {}) {
    if (!validDate(today)) throw new TypeError("Choose a valid reference date.");
    if (!/^\d{4}$/.test(String(year))) throw new TypeError("Choose a four-digit year.");
    if (!Number.isInteger(olderThan) || olderThan < 1) throw new TypeError("Choose a positive number of days.");
    const accounts = new Map();
    const years = new Set([today.slice(0, 4)]);
    for (const transaction of transactions) {
      const identity = [transaction.provider, transaction.accountType, transaction.accountName].map(text);
      const accountKey = JSON.stringify(identity.map(key));
      if (!accounts.has(accountKey)) accounts.set(accountKey, {
        key: accountKey, provider: identity[0], accountType: identity[1], accountName: identity[2],
        count: 0, months: Array(12).fill(0), firstDate: "", lastDate: "", latestImport: null,
        importedCount: 0, unknownImportCount: 0, invalidDateCount: 0,
      });
      const account = accounts.get(accountKey);
      account.count += 1;
      if (validDate(transaction.date)) {
        years.add(transaction.date.slice(0, 4));
        if (transaction.date.slice(0, 4) === String(year)) account.months[Number(transaction.date.slice(5, 7)) - 1] += 1;
        if (!account.firstDate || transaction.date < account.firstDate) account.firstDate = transaction.date;
        if (!account.lastDate || transaction.date > account.lastDate) account.lastDate = transaction.date;
      } else account.invalidDateCount += 1;
      const stamp = importTime(transaction.createdAt);
      if (stamp !== null) {
        account.importedCount += 1;
        if (account.latestImport === null || stamp > account.latestImport) account.latestImport = stamp;
      } else account.unknownImportCount += 1;
    }
    const allAccounts = [...accounts.values()].map((account) => {
      const age = account.lastDate ? Math.round((day(today) - day(account.lastDate)) / 86400000) : null;
      return { ...account, age, older: age !== null && age > olderThan,
        yearCount: account.months.reduce((sum, count) => sum + count, 0),
        activeMonths: account.months.filter(Boolean).length };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.accountName.localeCompare(b.accountName)
      || a.provider.localeCompare(b.provider) || a.accountType.localeCompare(b.accountType));
    return {
      accounts: allAccounts.filter((account) => !key(query)
        || key([account.accountName, account.provider, account.accountType].join(" ")).includes(key(query))),
      years: [...years].sort().reverse(), totalAccounts: allAccounts.length, totalRows: transactions.length,
      olderAccounts: allAccounts.filter((account) => account.older).length,
      unknownImportCount: allAccounts.reduce((sum, account) => sum + account.unknownImportCount, 0),
    };
  }
  return Object.freeze({ buildCoverage, validDate });
});
