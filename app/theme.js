"use strict";

(function initializeTheme(globalObject) {
  const themeStorageKey = "ledger.color-theme.v1";
  const numberAbbreviationStorageKey = "ledger.number-abbreviation.v1";
  const numberAbbreviationOptions = ["none", "k", "m", "b", "t"];
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

  globalObject.LedgerPreferences = {
    numberAbbreviation: () => numberAbbreviation,
    setNumberAbbreviation: (value) => setNumberAbbreviation(value),
  };

  globalObject.addEventListener("storage", (event) => {
    if (event.key === themeStorageKey) apply(storedTheme());
    if (event.key === numberAbbreviationStorageKey) {
      setNumberAbbreviation(storedNumberAbbreviation(), { persist: false });
    }
  });
})(window);
