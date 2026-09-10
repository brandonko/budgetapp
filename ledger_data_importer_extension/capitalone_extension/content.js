// Drives only recognizable export controls. Account choice and authentication
// are always the user's job; unknown forms remain available for manual export.
(() => {
  let job = null, timer = null, completing = false, lastProgress = 0;
  const clicked = new WeakSet();
  const visible = (node) => !!node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    && getComputedStyle(node).visibility !== "hidden" && !node.disabled;
  const text = (node) => (node.getAttribute("aria-label") || node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  const label = (input) => [input.getAttribute("aria-label"), ...(input.labels || [])].map((v) => typeof v === "string" ? v : v?.textContent || "").join(" ").trim();
  const send = (action, data = {}) => chrome.runtime.sendMessage({ action, data: { ...data, nonce: job?.nonce } });
  const control = (action, nonce) => window.postMessage({ source: "ledger-capitalone-control", action, nonce }, location.origin);
  function stop() {
    if (job) control("stop", job.nonce);
    job = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  async function progress(message) {
    if (Date.now() - lastProgress < 5000) return;
    lastProgress = Date.now();
    const response = await send("ledgerCapitalOneProgress", { message });
    if (!response?.success) stop();
  }
  function setDate(input, iso) {
    const parts = iso.split("-");
    const desired = input.type === "date" ? iso : `${parts[1]}/${parts[2]}/${parts[0]}`;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, desired);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return input.value === desired && input.validity.valid;
  }
  function exportStep() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, form')].filter(visible);
    const form = dialogs.find((node) => /(?:download|export).*transaction|(?:download|export).*csv/i.test(text(node)));
    if (!form) {
      const openers = [...document.querySelectorAll('button, a, [role="button"]')].filter((node) => visible(node)
        && /^(?:download|export)(?: account)? transactions(?:\s|$)/i.test(text(node)));
      // Never choose an arbitrary account when more than one export is visible.
      if (openers.length === 1 && !clicked.has(openers[0])) { clicked.add(openers[0]); openers[0].click(); }
      return "Sign in and open the Capital One account you want. If needed, open Download transactions and choose CSV.";
    }
    const selects = [...form.querySelectorAll("select")].filter(visible);
    for (const select of selects) {
      const custom = [...select.options].find((option) => /^(custom|custom date range|date range|specific date range)$/i.test(option.text.trim()));
      if (custom && select.value !== custom.value && !clicked.has(select)) {
        clicked.add(select); select.value = custom.value; select.dispatchEvent(new Event("change", { bubbles: true }));
        return "Setting the requested Capital One export dates…";
      }
    }
    const inputs = [...form.querySelectorAll('input[type="date"], input[type="text"], input:not([type])')].filter(visible);
    const starts = inputs.filter((input) => /^(?:start(?: date)?|from(?: date)?)\b/i.test(label(input)));
    const ends = inputs.filter((input) => /^(?:end(?: date)?|to(?: date)?)\b/i.test(label(input)));
    if (starts.length !== 1 || ends.length !== 1 || starts[0] === ends[0]) {
      return "Capital One uses an unfamiliar date control. Set the requested dates and export CSV yourself; Ledger is listening for the download.";
    }
    const format = selects.find((select) => [...select.options].some((option) => /csv|comma.?separated/i.test(option.text)));
    const radios = [...form.querySelectorAll('input[type="radio"]')];
    const csvRadio = radios.find((input) => /\bcsv\b|comma.?separated/i.test(label(input)));
    if (format) {
      const option = [...format.options].find((item) => /csv|comma.?separated/i.test(item.text));
      if (format.value !== option.value) { format.value = option.value; format.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (csvRadio && !csvRadio.checked) csvRadio.click();
    if (!format && !csvRadio) return "Choose CSV in Capital One's export form and download it. Ledger is listening for the export.";
    if (!clicked.has(starts[0])) {
      if (!setDate(starts[0], job.startDate) || !setDate(ends[0], job.endDate)) return "Capital One did not accept the dates. Set them manually and export CSV.";
      clicked.add(starts[0]);
      return "Dates set. Preparing Capital One CSV export…";
    }
    // Re-read after the site's change handlers have rendered; never submit a
    // stale/default range if the bank rejected or clamped the dates.
    const dateMatches = (input, iso) => input.value === iso || input.value === `${iso.slice(5, 7)}/${iso.slice(8)}/${iso.slice(0, 4)}`;
    const csvSelected = format ? /csv|comma.?separated/i.test(format.selectedOptions[0]?.text || "") : csvRadio?.checked;
    if (!dateMatches(starts[0], job.startDate) || !dateMatches(ends[0], job.endDate) || !csvSelected) return "Check the requested dates and CSV format, then export in Capital One.";
    const buttons = [...form.querySelectorAll('button, [role="button"], input[type="submit"]')].filter((node) => visible(node)
      && /^(?:download|export)(?: transactions| csv| file)?$/i.test(text(node) || node.value || ""));
    if (buttons.length === 1 && !clicked.has(buttons[0])) { clicked.add(buttons[0]); buttons[0].click(); }
    return "Waiting for the Capital One CSV. If a file downloads without opening Ledger review, upload it from the Capital One tab in Ledger.";
  }
  async function tick() {
    if (!job) return;
    try {
      if (Date.now() - job.started > 25 * 60 * 1000) {
        await send("ledgerCapitalOneError", { message: "Capital One import timed out. Retry after signing in, or use the downloaded CSV." });
        stop(); return;
      }
      await progress(exportStep());
    } catch {
      await progress("The Capital One export form could not be automated. Export CSV manually; Ledger is listening for it.").catch(() => stop());
    }
    if (job) timer = setTimeout(tick, 1000);
  }
  window.addEventListener("message", async (event) => {
    if (!job || completing || event.source !== window || event.origin !== location.origin
      || event.data?.source !== "ledger-capitalone-csv" || event.data.nonce !== job.nonce) return;
    const nonce = job.nonce;
    try {
      const content = globalThis.LedgerCapitalOneCsv.sanitize(event.data.content);
      completing = true;
      control("stop", nonce);
      const response = await send("ledgerCapitalOneComplete", { content });
      if (!response?.success && job) await send("ledgerCapitalOneError", { message: response?.error || "Capital One CSV could not reach Ledger." });
      stop();
    } catch (error) {
      if (job) await send("ledgerCapitalOneError", { message: error.message }).catch(() => {});
      stop();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.action !== "ledgerCancelCapitalOne") return false;
    stop(); respond({ success: true }); return false;
  });
  chrome.runtime.sendMessage({ action: "ledgerCapitalOneReady" }).then((response) => {
    if (!response?.success) return;
    job = { nonce: response.nonce, startDate: response.startDate, endDate: response.endDate, started: Date.now() };
    if (typeof globalThis.LedgerCapitalOneCsv?.sanitize !== "function") {
      void send("ledgerCapitalOneError", { message: "The Capital One parser did not load. Reload Ledger Data Importer in chrome://extensions, refresh Ledger, and start a new import." }).catch(() => {});
      stop();
      return;
    }
    control("arm", job.nonce);
    void tick();
  }).catch(() => {});
})();
