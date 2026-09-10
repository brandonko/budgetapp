// ISOLATED controller. Authentication and choosing the correct card stay with
// the user. Only identifiable activity-export controls may be automated.
(() => {
  let job = null, timer = null, completing = false, host = null, messageNode = null, confirmed = false;
  let lastProgress = 0;
  let stopped = false;
  let statusNode = null, captureState = "", confirmedAt = 0;
  let diagnosticsNode = null;
  const captureSteps = [];
  const captureMessages = {
    armed: "Listening for an Amex XLSX or CSV download.",
    "download-seen": "Download link detected. Reading the export…",
    reading: "Download captured. Reading its transactions…",
    "too-large": "This export exceeds 16 MB. Choose a shorter date range and download again.",
    "read-error": "The download was detected but could not be read. Try downloading again, or return to Ledger and upload the file.",
    "unsupported-link": "This download uses a different website address. Use Ledger’s file upload for this export.",
    connecting: "Connecting to the download listener…",
    missing: "The download listener did not respond. Reload Ledger Data Importer in chrome://extensions, then restart this import from Ledger.",
    "connection-error": "The download connection could not start. Reload Ledger Data Importer in chrome://extensions, approve its permissions, and restart the import.",
    sending: "Export read successfully. Sending transactions to Ledger for review…",
  };
  function showCaptureState(state, method = "") {
    if (!captureMessages[state]) return;
    const knownMethods = ["blob", "fetch", "xhr", "data-link", "blob-link", "file-link", "document-link"];
    const step = `${state}${knownMethods.includes(method) ? ` (${method})` : ""}`;
    if (captureSteps.at(-1) !== step) captureSteps.push(step);
    if (captureSteps.length > 8) captureSteps.shift();
    if (diagnosticsNode) diagnosticsNode.textContent = `Amex capture 0.12.2\nCard confirmed: ${confirmed ? "yes" : "no"}\n${captureSteps.join(" → ")}\nNo account details, filenames, or transaction data included.`;
    captureState = state;
    if (statusNode) { statusNode.textContent = captureMessages[state]; statusNode.hidden = false; }
  }
  const clicked = new WeakSet();
  const control = (action, nonce, details = {}) => window.postMessage({ source: "ledger-amex-control", action, nonce, ...details }, location.origin);
  const send = (action, data = {}) => chrome.runtime.sendMessage({ action, data: { ...data, nonce: job?.nonce } });
  const visible = (node) => node && !node.disabled && node.getBoundingClientRect().width > 0
    && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== "hidden";
  const text = (node) => (node.getAttribute("aria-label") || node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  const label = (input) => [input.getAttribute("aria-label") || "", ...[...(input.labels || [])].map((n) => n.textContent)].join(" ").trim();
  function stop() {
    stopped = true;
    if (job) control("stop", job.nonce);
    job = null; clearTimeout(timer); timer = null;
    host?.remove(); host = null;
  }
  function showGuide() {
    if (host || !document.body) return;
    host = document.createElement("div");
    host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 40px);";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{color-scheme:light}.guide{font:14px/1.5 system-ui,sans-serif;background:#fff;color:#19382e;border:1px solid #bacfc5;border-radius:14px;padding:18px;max-width:360px;box-shadow:0 8px 30px #0003}strong{display:block}p{display:block;color:#19382e;font:14px/1.5 system-ui,sans-serif;margin:8px 0 12px}.status{border-top:1px solid #bacfc5;padding-top:10px;font-weight:600}[hidden]{display:none!important}button{font:600 14px system-ui,sans-serif;background:#245b45;color:white;border:0;border-radius:8px;padding:10px 14px;cursor:pointer}button:focus-visible{outline:3px solid #156fd1;outline-offset:3px}";
    const card = document.createElement("section"); card.className = "guide";
    card.setAttribute("aria-label", "Ledger American Express import");
    const title = document.createElement("strong"); title.textContent = "Import to Ledger";
    messageNode = document.createElement("p"); messageNode.setAttribute("role", "status");
    messageNode.textContent = `Check the selected Amex card first. Ledger will capture its activity export for ${job.startDate} through ${job.endDate}. Nothing is saved until you review in Ledger.`;
    statusNode = document.createElement("p"); statusNode.className = "status";
    statusNode.setAttribute("role", "status"); statusNode.hidden = true;
    const diagnostics = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = "Capture details";
    diagnosticsNode = document.createElement("p");
    diagnosticsNode.style.whiteSpace = "pre-wrap";
    diagnosticsNode.textContent = "Amex capture 0.12.2\nWaiting for card confirmation.\nNo account details, filenames, or transaction data included.";
    diagnostics.append(summary, diagnosticsNode);
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Use this card";
    button.addEventListener("click", async () => {
      if (!job || button.disabled) return;
      const owner = job; button.disabled = true;
      showCaptureState("connecting");
      try {
        const response = await send("ledgerAmexArm");
        if (job !== owner) return;
        if (!response?.success) throw new Error("Connection failed");
        confirmed = true; confirmedAt = Date.now(); button.hidden = true;
        control("arm", owner.nonce);
      } catch { if (job === owner) { button.disabled = false; showCaptureState("connection-error"); } }
    });
    card.append(title, messageNode, button, statusNode, diagnostics); root.append(style, card); document.body.append(host);
  }
  function exportStep() {
    const manual = `Open Download activity, choose XLSX (preferred) or CSV, and cover ${job.startDate} through ${job.endDate}. Ledger will capture the export automatically; keep this tab open.`;
    const forms = [...document.querySelectorAll('[role="dialog"], dialog, form')].filter((n) => visible(n)
      && /(?:download|export)/i.test(text(n)) && /(?:activity|transactions|xlsx|csv|excel)/i.test(text(n)));
    if (forms.length !== 1) {
      const openers = [...document.querySelectorAll('button, a, [role="button"]')].filter((n) => visible(n)
        && /^(?:download|export)(?: your)? (?:activity|transactions)(?:\s|$)/i.test(text(n)));
      if (openers.length === 1 && !clicked.has(openers[0])) { clicked.add(openers[0]); openers[0].click(); }
      return manual;
    }
    const form = forms[0], selects = [...form.querySelectorAll("select")].filter(visible);
    const formats = selects.filter((n) => [...n.options].some((o) => /xlsx|excel|comma.?separated|\bcsv\b/i.test(o.text)));
    const radios = [...form.querySelectorAll('input[type="radio"]')].filter(visible);
    const preferred = (items, getText) => items.find((n) => /xlsx|excel/i.test(getText(n))) || items.find((n) => /comma.?separated|\bcsv\b/i.test(getText(n)));
    let formatOk = false;
    if (formats.length === 1) {
      const select = formats[0], option = preferred([...select.options], (n) => n.text);
      if (select.value !== option.value) {
        select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true }));
        return "Selecting the Amex activity export format…";
      }
      formatOk = true;
    } else {
      const radio = preferred(radios, label);
      if (radio && !radio.checked) { radio.click(); return "Selecting the Amex activity export format…"; }
      formatOk = Boolean(radio?.checked);
    }
    const inputs = [...form.querySelectorAll('input[type="date"], input[type="text"], input:not([type])')].filter(visible);
    const starts = inputs.filter((n) => /^(?:start|from)(?: date)?\b/i.test(label(n)));
    const ends = inputs.filter((n) => /^(?:end|to)(?: date)?\b/i.test(label(n)));
    if (!formatOk || starts.length !== 1 || ends.length !== 1 || starts[0] === ends[0]) return manual;
    const desired = (input, iso) => input.type === "date" ? iso : `${iso.slice(5, 7)}/${iso.slice(8)}/${iso.slice(0, 4)}`;
    if (!clicked.has(starts[0])) {
      for (const [input, iso] of [[starts[0], job.startDate], [ends[0], job.endDate]]) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, desired(input, iso));
        for (const name of ["input", "change", "blur"]) input.dispatchEvent(new Event(name, { bubbles: true }));
      }
      clicked.add(starts[0]); return "Setting the Amex export dates…";
    }
    if (starts[0].value !== desired(starts[0], job.startDate) || ends[0].value !== desired(ends[0], job.endDate)
        || !starts[0].validity.valid || !ends[0].validity.valid) return manual;
    const buttons = [...form.querySelectorAll('button, [role="button"], input[type="submit"]')].filter((n) => visible(n)
      && /^(?:download|export)(?: activity| transactions| file)?$/i.test(text(n) || n.value || ""));
    if (buttons.length === 1 && !clicked.has(buttons[0])) { clicked.add(buttons[0]); buttons[0].click(); }
    return "Waiting for the Amex export. Ledger will open the transaction review when it arrives.";
  }
  async function tick() {
    if (!job) return;
    try {
      if (Date.now() - job.started > 25 * 60 * 1000) {
        await send("ledgerAmexError", { message: "American Express import timed out. Retry after signing in, or upload the downloaded export." }); stop(); return;
      }
      const activity = /^\/activity\/?$/.test(location.pathname);
      if (activity) showGuide();
      let message = "Sign in to American Express and open Activity for the card you want to import.";
      if (activity && !confirmed) message = "Check the selected card in Amex Activity, then click Use this card in the Ledger guide.";
      if (activity && confirmed) {
        if (captureState === "connecting" && Date.now() - confirmedAt > 3000) showCaptureState("missing");
        // Never auto-download before the MAIN listener has acknowledged arming,
        // or while parsing an export that is already on its way to review.
        if (!["connecting", "missing", "reading", "sending"].includes(captureState) && !completing) {
          try { message = exportStep(); } catch { message = "Set the export dates and download XLSX or CSV in Amex Activity. Ledger is listening for the export."; }
        } else message = "Keep this Amex tab open until Ledger opens the transaction review.";
        if (messageNode) messageNode.textContent = message;
        message = `${captureMessages[captureState] || ""} ${message}`.trim();
      }
      if (!activity && confirmed) {
        confirmed = false; control("stop", job.nonce); host?.remove(); host = null;
        await send("ledgerAmexDisarm");
      }
      if (Date.now() - lastProgress > 5000) {
        lastProgress = Date.now();
        const response = await send("ledgerAmexProgress", { message }); if (!response?.success) stop();
      }
    } catch { stop(); }
    if (job) timer = setTimeout(tick, 1000);
  }
  window.addEventListener("message", async (event) => {
    if (job && confirmed && event.source === window && event.origin === location.origin
        && event.data?.source === "ledger-amex-capture-status" && event.data.nonce === job.nonce && !completing) {
      showCaptureState(event.data.state, event.data.method);
      return;
    }
    if (!job || !confirmed || completing || event.source !== window || event.origin !== location.origin
        || event.data?.source !== "ledger-amex-export" || event.data.nonce !== job.nonce) return;
    const owner = job;
    completing = true; // XLSX decompression is async: claim before awaiting.
    showCaptureState("reading");
    control("stop", owner.nonce);
    try {
      const content = await globalThis.LedgerAmexExport.sanitize(event.data.content, { includeMerchantDetails: owner.includeMerchantDetails });
      if (job !== owner) return;
      showCaptureState("sending");
      const response = await send("ledgerAmexComplete", { content });
      if (!response?.success && job === owner) await send("ledgerAmexError", { message: response?.error || "American Express export could not reach Ledger." });
    } catch (error) {
      if (job === owner) await send("ledgerAmexError", { message: error.message.startsWith("American Express export:")
        ? error.message : "American Express export could not be read. Try a fresh CSV or XLSX download." }).catch(() => {});
    } finally { if (job === owner) stop(); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.action === "ledgerAmexDownload") {
      const accepted = Boolean(job && confirmed && !completing && message.nonce === job.nonce && /^\/activity\/?$/.test(location.pathname));
      if (accepted) control("download", job.nonce, { url: message.url });
      respond({ success: accepted }); return false;
    }
    if (message?.action !== "ledgerCancelAmex") return false;
    stop(); respond({ success: true }); return false;
  });
  chrome.runtime.sendMessage({ action: "ledgerAmexReady" }).then((response) => {
    if (stopped || !response?.success) return;
    job = { ...response, started: Date.now() };
    if (typeof globalThis.LedgerAmexExport?.sanitize !== "function") {
      void send("ledgerAmexError", { message: "The Amex reader did not load. Reload Ledger Data Importer in chrome://extensions and retry." }); stop(); return;
    }
    void tick();
  }).catch(() => {});
})();
