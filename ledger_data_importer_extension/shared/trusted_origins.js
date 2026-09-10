"use strict";

// Shared by the isolated page bridge, extension settings, and service worker.
globalThis.LedgerOrigins = {
  normalize(value) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Enter only the server address, including http:// or https:// and its port.");
    }
    return url.origin;
  },
  pattern(origin) {
    const url = new URL(origin);
    return `${url.protocol}//${url.hostname}/*`;
  },
  async allowed(origin) {
    try {
      if (this.normalize(origin) !== origin) return false;
      const url = new URL(origin);
      if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return true;
      const { ledgerTrustedOrigins = [] } = await chrome.storage.local.get("ledgerTrustedOrigins");
      return ledgerTrustedOrigins.includes(origin)
        && await chrome.permissions.contains({ origins: [this.pattern(origin)] });
    } catch { return false; }
  },
};
