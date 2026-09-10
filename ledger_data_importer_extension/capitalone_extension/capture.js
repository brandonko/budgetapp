// Passive, opt-in CSV capture. Never reads cookies, request headers or login fields.
(() => {
  let activeNonce = "";
  // Standalone MAIN entry point; shared static file paths cannot be injected
  // again into ISOLATED. CSV validation/redaction happens there before relay
  // to the extension worker or Ledger. Original CSV stays inside the browser.
  const MAX_BYTES = 16 * 1024 * 1024;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ledger-capitalone-control") return;
    if (event.data.action === "arm" && /^[a-f0-9-]{36}$/.test(event.data.nonce || "")) activeNonce = event.data.nonce;
    if (event.data.action === "stop" && event.data.nonce === activeNonce) activeNonce = "";
  });
  async function emit(candidate, nonce = activeNonce) {
    if (!nonce) return;
    try {
      if (candidate?.size > MAX_BYTES) throw new Error("Capital One CSV exceeds 16 MB.");
      const raw = typeof candidate === "string" ? candidate : await candidate.text();
      // Text blobs used by the rest of the site are not transaction exports.
      if (!/transaction date/i.test(raw.slice(0, 2048))) return;
      if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_BYTES) return;
      if (activeNonce === nonce) window.postMessage({ source: "ledger-capitalone-csv", nonce, content: raw }, location.origin);
    } catch {
      // Do not interrupt the bank's download. The user can upload its CSV if capture fails.
    }
  }
  async function readResponse(response, nonce) {
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES || activeNonce !== nonce) { void reader.cancel().catch(() => {}); return; }
        chunks.push(value);
      }
      await emit(new Blob(chunks), nonce);
    } catch { /* The original response remains untouched. */ }
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const promise = originalFetch(...args);
    const nonce = activeNonce;
    if (nonce) promise.then((response) => {
      if (/csv|comma-separated/i.test((response.headers.get("content-type") || "") + (response.headers.get("content-disposition") || ""))) {
        void readResponse(response.clone(), nonce);
      }
    }).catch(() => {});
    return promise;
  };
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    if (activeNonce && blob instanceof Blob && blob.size <= MAX_BYTES) void emit(blob);
    return createObjectURL(blob);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const nonce = activeNonce;
    if (nonce) this.addEventListener("load", () => {
      const type = this.getResponseHeader("content-type") || "";
      const disposition = this.getResponseHeader("content-disposition") || "";
      if (!/csv|comma-separated/i.test(type + disposition)) return;
      if (this.responseType === "blob" || this.responseType === "" || this.responseType === "text") void emit(this.response, nonce);
    }, { once: true });
    return originalSend.apply(this, args);
  };
  // Capture same-origin CSV download links without cancelling the normal download.
  document.addEventListener("click", (event) => {
    const anchor = event.target?.closest?.("a[href]");
    if (!activeNonce || !anchor || !/csv/i.test(anchor.download || anchor.href)) return;
    let url;
    try { url = new URL(anchor.href, location.href); } catch { return; }
    if (url.origin !== location.origin || !["https:", "blob:"].includes(url.protocol)) return;
    const nonce = activeNonce;
    originalFetch(url.href, { credentials: "same-origin", signal: AbortSignal.timeout(30000) })
      .then((response) => readResponse(response, nonce)).catch(() => {});
  }, true);
})();
