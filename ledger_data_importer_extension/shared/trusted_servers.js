"use strict";

// The worker owns dynamic registrations. Saved trust and Chrome's registered
// scripts are separate stores; reconcile them after reloads and permission changes.
(() => {
  const registrationId = "ledger-trusted-servers";
  const importPaths = new Set(["/import", "/import.html", "/upload", "/upload.html"]);
  let queue = Promise.resolve();

  async function synchronize() {
    const saved = (await chrome.storage.local.get("ledgerTrustedOrigins")).ledgerTrustedOrigins;
    const origins = [];
    for (const origin of Array.isArray(saved) ? [...new Set(saved)] : []) {
      if (await LedgerOrigins.allowed(origin)) origins.push(origin);
    }
    const matches = [...new Set(origins.flatMap(origin => {
      const base = LedgerOrigins.pattern(origin).slice(0, -1);
      return [base + "import*", base + "upload*"];
    }))].sort();
    const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [registrationId] });
    if (!matches.length) {
      if (existing) await chrome.scripting.unregisterContentScripts({ ids: [registrationId] });
      return { success: true, connectedTabs: 0 };
    }
    const script = { id: registrationId, matches, js: ["shared/ledger_bridge.js"],
      runAt: "document_idle", world: "ISOLATED", allFrames: false, persistAcrossSessions: true };
    if (!existing) await chrome.scripting.registerContentScripts([script]);
    else if (Object.keys(script).some(key => JSON.stringify(existing[key]) !== JSON.stringify(script[key]))) {
      await chrome.scripting.updateContentScripts([script]);
    }

    // Registration affects future documents. Also reconnect already-open Import
    // pages, but never other ports, unrelated pages, subframes, or source sites.
    let connectedTabs = 0;
    const tabs = await chrome.tabs.query({ url: matches });
    for (const tab of tabs) {
      let url;
      try { url = new URL(tab.url); } catch { continue; }
      if (!origins.includes(url.origin) || !importPaths.has(url.pathname)
          || !await LedgerOrigins.allowed(url.origin)) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] },
          files: ["shared/ledger_bridge.js"], world: "ISOLATED" });
        connectedTabs++;
      } catch { /* A closed/navigating tab can reconnect on its next page load. */ }
    }
    return { success: true, connectedTabs };
  }

  function repair() {
    const result = queue.then(synchronize);
    queue = result.catch(() => {});
    return result;
  }
  const backgroundRepair = () => repair().catch(() => {
    console.warn("Ledger connection setup could not finish. Use Reconnect in Ledger connection settings.");
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action !== "ledgerRepairConnections") return false;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("shared/options.html")) {
      respond({ success: false, error: "Reconnect from Ledger connection settings." });
      return false;
    }
    repair().then(respond, () => respond({ success: false,
      error: "Connection setup failed. Reload Ledger Data Importer in chrome://extensions and try Reconnect again." }));
    return true;
  });
  chrome.runtime.onInstalled.addListener(backgroundRepair);
  chrome.runtime.onStartup.addListener(backgroundRepair);
  chrome.permissions.onAdded.addListener(backgroundRepair);
  chrome.permissions.onRemoved.addListener(backgroundRepair);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, "ledgerTrustedOrigins")) backgroundRepair();
  });
  backgroundRepair();
})();
