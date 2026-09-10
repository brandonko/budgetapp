"use strict";
const status = document.getElementById("status");
const form = document.getElementById("server-form");
async function repairConnections() {
  let result;
  try { result = await chrome.runtime.sendMessage({ action: "ledgerRepairConnections" }); }
  catch { throw new Error("Reload Ledger Data Importer in chrome://extensions, then try Reconnect below."); }
  if (!result?.success) throw new Error(result?.error || "Connection setup did not finish. Reload the extension, then try Reconnect below.");
}

async function saveOrigins(origins) {
  // Trust is checked on every bridge message, including in already-open tabs.
  await chrome.storage.local.set({ ledgerTrustedOrigins: origins });
  try { await repairConnections(); }
  finally { await render(); }
}

async function render() {
  const { ledgerTrustedOrigins = [] } = await chrome.storage.local.get("ledgerTrustedOrigins");
  const list = document.getElementById("servers");
  list.replaceChildren();
  for (const origin of ledgerTrustedOrigins) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = origin;
    const access = document.createElement("span");
    access.className = "server-access";
    const allowed = await LedgerOrigins.allowed(origin);
    access.textContent = allowed ? "Site access allowed" : "Site access needed";
    const reconnect = document.createElement("button");
    reconnect.type = "button";
    reconnect.textContent = allowed ? "Reconnect" : "Allow site access";
    reconnect.addEventListener("click", async () => {
      reconnect.disabled = true;
      try {
        if (!await chrome.permissions.request({ origins: [LedgerOrigins.pattern(origin)] })) {
          throw new Error("Site access was not granted. This server cannot connect yet.");
        }
        await repairConnections();
        status.textContent = "Connection repaired. Open or refresh this server's Import data page.";
        await render();
      } catch (error) { status.textContent = error.message; reconnect.disabled = false; }
    });
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const current = (await chrome.storage.local.get("ledgerTrustedOrigins")).ledgerTrustedOrigins || [];
        await saveOrigins(current.filter((value) => value !== origin));
        status.textContent = "Server removed. New connections from this address are blocked.";
      } catch (error) { status.textContent = error.message; remove.disabled = false; }
    });
    item.append(name, access, reconnect, remove);
    list.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const origin = LedgerOrigins.normalize(document.getElementById("server-address").value.trim());
    // Request directly from the user gesture, before storage or other awaits.
    if (!await chrome.permissions.request({ origins: [LedgerOrigins.pattern(origin)] })) {
      throw new Error("Site access was not granted. The server was not added.");
    }
    const current = (await chrome.storage.local.get("ledgerTrustedOrigins")).ledgerTrustedOrigins || [];
    await saveOrigins([...new Set([...current, origin])]);
    status.textContent = "Server trusted. Refresh its Ledger Import data page to connect.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
render().catch((error) => { status.textContent = error.message; });
