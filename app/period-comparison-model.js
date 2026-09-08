"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./transactions-model.js"));
  else root.LedgerPeriodComparisonModel = factory(root.LedgerTransactionsModel);
})(typeof window === "undefined" ? globalThis : window, function (transactionsModel) {
  const day = (value) => Date.parse(`${value}T00:00:00Z`);
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01"
      && Number.isFinite(day(value)) && new Date(day(value)).toISOString().slice(0, 10) === value;
  }
  function validateRange(range) {
    if (!range || !validDate(range.startDate) || !validDate(range.endDate)) return "Enter both dates for each period.";
    if (range.startDate > range.endDate) return "The start date must be on or before the end date.";
    return "";
  }
  function days(range) { return Math.round((day(range.endDate) - day(range.startDate)) / 86400000) + 1; }
  function iso(milliseconds) { return new Date(milliseconds).toISOString().slice(0, 10); }
  function previousPeriod(range) {
    const error = validateRange(range); if (error) throw new TypeError(error);
    const result = { startDate: iso(day(range.startDate) - days(range) * 86400000), endDate: iso(day(range.startDate) - 86400000) };
    if (validateRange(result)) throw new RangeError("This period is too early for a previous period.");
    return result;
  }
  function previousYear(range) {
    const error = validateRange(range); if (error) throw new TypeError(error);
    function shift(value) {
      const year = Number(value.slice(0, 4)) - 1;
      const candidate = `${String(year).padStart(4, "0")}${value.slice(4)}`;
      // A leap-day anniversary is February 28 in a non-leap year.
      return validDate(candidate) ? candidate : `${String(year).padStart(4, "0")}-02-28`;
    }
    const result = { startDate: shift(range.startDate), endDate: shift(range.endDate) };
    if (validateRange(result)) throw new RangeError("This period is too early for a previous year.");
    return result;
  }
  function defaultPeriods(transactions, today) {
    const dates = transactionsModel.filterTransactions(transactions, { showExcluded: false })
      .map((row) => row.date).filter(validDate).sort();
    const latest = dates.at(-1) || today;
    if (!validDate(latest)) throw new TypeError("A valid current date is required.");
    const startDate = `${latest.slice(0, 7)}-01`;
    const cursor = new Date(`${startDate}T00:00:00Z`); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const focus = { startDate, endDate: iso(cursor.getTime() - 86400000) };
    return { focus, baseline: previousPeriod(focus) };
  }
  function difference(focus, baseline) {
    const delta = (Math.round(focus * 100) - Math.round(baseline * 100)) / 100;
    // Relative change from zero/negative spending is easy to misread: show dollars only.
    return { delta, percent: baseline > 0 ? delta / baseline * 100 : null };
  }
  function summarizePeriod(transactions, range) {
    const error = validateRange(range); if (error) throw new TypeError(error);
    const matching = transactionsModel.filterTransactions(transactions, range);
    const totals = transactionsModel.summarizeTransactions(matching);
    const length = days(range);
    return { ...totals, ...range, recordedStartDate: totals.startDate, recordedEndDate: totals.endDate, days: length,
      perDay: { spent: totals.spent / length, income: totals.income / length, net: totals.net / length },
      categories: transactionsModel.spendingByCategory(matching) };
  }
  function comparePeriods(transactions, focusRange, baselineRange) {
    const focus = summarizePeriod(transactions, focusRange);
    const baseline = summarizePeriod(transactions, baselineRange);
    const categories = new Map();
    for (const [name, summary] of [["focus", focus], ["baseline", baseline]]) {
      for (const item of summary.categories) {
        const key = item.category.toLocaleLowerCase();
        if (!categories.has(key)) categories.set(key, { category: item.category, focus: 0, baseline: 0, focusCount: 0, baselineCount: 0 });
        const category = categories.get(key); category[name] = item.total; category[`${name}Count`] = item.count;
      }
    }
    return { focus, baseline, differences: Object.fromEntries(["spent", "income", "net"].map((metric) => [metric, difference(focus[metric], baseline[metric])])),
      categories: [...categories.values()].map((category) => ({ ...category, ...difference(category.focus, category.baseline) }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.category.localeCompare(b.category)) };
  }
  function drilldownUrl(range, { category = "", type = "all" } = {}) {
    if (validateRange(range)) throw new TypeError("Choose a valid date range.");
    const params = new URLSearchParams({ report: "period-comparison", startDate: range.startDate, endDate: range.endDate, type });
    if (category) params.set("category", category);
    return `/transactions?${params.toString()}`;
  }
  function parseDrilldown(search) {
    const params = new URLSearchParams(search);
    if (params.get("report") !== "period-comparison") return null;
    const range = { startDate: params.get("startDate"), endDate: params.get("endDate") };
    const type = params.get("type") || "all";
    const category = params.get("category") || "";
    if (validateRange(range) || !["all", "income", "spending"].includes(type) || category.length > 200) return null;
    return { ...range, category, type, showExcluded: type === "all" };
  }
  return Object.freeze({ validDate, validateRange, days, previousPeriod, previousYear, defaultPeriods,
    difference, comparePeriods, drilldownUrl, parseDrilldown });
});
