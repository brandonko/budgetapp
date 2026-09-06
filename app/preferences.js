"use strict";

(function initializePreferences(globalObject) {
  const numberAbbreviationStorageKey = "ledger.number-abbreviation.v1";
  const numberAbbreviationOptions = ["none", "k", "m", "b", "t"];

  function storedNumberAbbreviation() {
    try {
      const stored = globalObject.localStorage.getItem(numberAbbreviationStorageKey);
      if (numberAbbreviationOptions.includes(stored)) return stored;
    } catch (_error) {
      // Use the default when storage is unavailable.
    }
    return "m";
  }

  function applyNumberAbbreviation(value, { persist = true } = {}) {
    const normalized = numberAbbreviationOptions.includes(value) ? value : "m";
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

  let numberAbbreviation = storedNumberAbbreviation();
  globalObject.LedgerPreferences = {
    numberAbbreviation: () => numberAbbreviation,
    setNumberAbbreviation: (value) => {
      numberAbbreviation = applyNumberAbbreviation(value);
      return numberAbbreviation;
    },
  };

  globalObject.addEventListener("storage", (event) => {
    if (event.key === numberAbbreviationStorageKey) {
      numberAbbreviation = applyNumberAbbreviation(storedNumberAbbreviation(), { persist: false });
    }
  });
})(window);
