"use strict";

(function initializeTheme(globalObject) {
  const themeStorageKey = "ledger.color-theme.v1";
  const numberAbbreviationStorageKey = "ledger.number-abbreviation.v1";
  const numberAbbreviationOptions = ["none", "k", "m", "b", "t"];
  const importStorageKey = "ledger.import-preferences.v1";
  const lookbackOptions = ["1w", "2w", "3w", "1m", "2m", "3m"];
  const root = document.documentElement;

  function storedTheme() {
    try {
      const stored = globalObject.localStorage.getItem(themeStorageKey);
      if (stored === "dark" || stored === "light") return stored;
    } catch (_error) {
      // Fall through to the browser preference when storage is unavailable.
    }
    return globalObject.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme, { persist = false } = {}) {
    const normalized = theme === "dark" ? "dark" : "light";
    root.dataset.theme = normalized;
    root.style.colorScheme = normalized;
    if (persist) {
      try {
        globalObject.localStorage.setItem(themeStorageKey, normalized);
      } catch (_error) {
        // The visual preference still applies when storage is unavailable.
      }
    }
    if (typeof globalObject.CustomEvent === "function") {
      globalObject.dispatchEvent(new globalObject.CustomEvent("ledger-theme-change", {
        detail: { theme: normalized },
      }));
    }
    return normalized;
  }

  const current = apply(storedTheme());
  globalObject.LedgerTheme = {
    current: () => root.dataset.theme || current,
    isDark: () => (root.dataset.theme || current) === "dark",
    setDark: (enabled) => apply(enabled ? "dark" : "light", { persist: true }),
  };

  function storedNumberAbbreviation() {
    try {
      const stored = globalObject.localStorage.getItem(numberAbbreviationStorageKey);
      if (numberAbbreviationOptions.includes(stored)) return stored;
    } catch (_error) {
      // Use the default when storage is unavailable.
    }
    return "m";
  }

  let numberAbbreviation = storedNumberAbbreviation();

  function setNumberAbbreviation(value, { persist = true } = {}) {
    const normalized = numberAbbreviationOptions.includes(value) ? value : "m";
    numberAbbreviation = normalized;
    if (persist) {
      try {
        globalObject.localStorage.setItem(numberAbbreviationStorageKey, normalized);
      } catch (_error) {
        // The preference still applies to this page when storage is unavailable.
      }
    }
    if (typeof globalObject.CustomEvent === "function") {
      globalObject.dispatchEvent(new globalObject.CustomEvent("ledger-number-abbreviation-change", {
        detail: { value: normalized },
      }));
    }
    return normalized;
  }

  function storedImportPreferences() {
    try {
      const saved = JSON.parse(globalObject.localStorage.getItem(importStorageKey) || "null");
      return {
        lookback: lookbackOptions.includes(saved?.lookback) ? saved.lookback : "2w",
        matchRefunds: typeof saved?.matchRefunds === "boolean" ? saved.matchRefunds
          : globalObject.localStorage.getItem("ledger.creditkarma-refund-matching.v1") !== "false",
      };
    } catch (_error) {
      return { lookback: "2w", matchRefunds: true };
    }
  }
  let importPreferences = storedImportPreferences();
  function setImportPreferences(changes, { persist = true } = {}) {
    importPreferences = {
      lookback: lookbackOptions.includes(changes.lookback) ? changes.lookback : importPreferences.lookback,
      matchRefunds: typeof changes.matchRefunds === "boolean" ? changes.matchRefunds : importPreferences.matchRefunds,
    };
    if (persist) {
      try { globalObject.localStorage.setItem(importStorageKey, JSON.stringify(importPreferences)); }
      catch (_error) { /* Keep the preference for this page when storage is unavailable. */ }
    }
    if (typeof globalObject.CustomEvent === "function") {
      globalObject.dispatchEvent(new globalObject.CustomEvent("ledger-import-preferences-change", {
        detail: { ...importPreferences },
      }));
    }
    return { ...importPreferences };
  }
  globalObject.LedgerPreferences = {
    imports: () => ({ ...importPreferences }),
    setImports: setImportPreferences,
    importStartDate: (today = new Date()) => {
      const start = new Date(today);
      const count = Number(importPreferences.lookback[0]);
      if (importPreferences.lookback.endsWith("w")) start.setDate(start.getDate() - count * 7);
      else {
        const day = start.getDate();
        start.setDate(1);
        start.setMonth(start.getMonth() - count);
        const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
        start.setDate(Math.min(day, lastDay));
      }
      return start;
    },
    numberAbbreviation: () => numberAbbreviation,
    setNumberAbbreviation: (value) => setNumberAbbreviation(value),
  };

  globalObject.addEventListener("storage", (event) => {
    if (event.key === importStorageKey || event.key === null) {
      setImportPreferences(storedImportPreferences(), { persist: false });
    }
    if (event.key === themeStorageKey) apply(storedTheme());
    if (event.key === numberAbbreviationStorageKey) {
      setNumberAbbreviation(storedNumberAbbreviation(), { persist: false });
    }
  });
})(window);
