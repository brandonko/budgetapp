// MAIN-world observer: captures an export only while the owned Amex job is armed.
// Observes exports and reads clicked file links; never reads credentials or changes the download.
(() => {
  let nonce = "";
  const MAX = 16 * 1024 * 1024;
  const pendingLinks = new Map();
  // Observed Amex activity-export endpoint. Do not accept arbitrary documents,
  // account APIs, PDF statements, or guessed URLs. Query values stay in memory.
  const isDocumentExport = (url) => url.origin === location.origin && !url.username && !url.password
    && url.pathname === "/api/servicing/v1/financials/documents" && !url.hash
    && url.searchParams.getAll("file_format").length === 1
    && /^(csv|excel|xlsx)$/i.test(url.searchParams.get("file_format") || "");
  const publish = (state, owner = nonce, method = "") => {
    if (owner && owner === nonce) window.postMessage({ source: "ledger-amex-capture-status", nonce: owner, state, method }, location.origin);
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "ledger-amex-control") return;
    if (event.data.action === "arm" && /^[a-f0-9-]{36}$/.test(event.data.nonce || "")) {
      nonce = event.data.nonce;
      publish("armed");
    }
    if (event.data.action === "stop" && event.data.nonce === nonce) {
      nonce = "";
      for (const controller of pendingLinks.values()) controller.abort();
      pendingLinks.clear();
    }
    if (event.data.action === "download" && nonce && event.data.nonce === nonce) {
      void captureDocument(event.data.url);
    }
  });
  async function emit(blob, owner = nonce, method = "blob") {
    if (!owner || owner !== nonce || !(blob instanceof Blob)) return;
    if (blob.size > MAX) { publish("too-large", owner); return; }
    try {
      const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
      const zip = head[0] === 0x50 && head[1] === 0x4b;
      const text = zip ? "" : new TextDecoder().decode(head);
      if (!zip && (!/date/i.test(text) || !/description/i.test(text) || !/amount/i.test(text))) {
        if (method.endsWith("-link")) publish("read-error", owner);
        return;
      }
      publish("reading", owner, method);
      const content = await blob.arrayBuffer();
      if (nonce === owner) window.postMessage({ source: "ledger-amex-export", nonce: owner, content }, location.origin);
    } catch { /* The site's original download always continues. */ }
  }
  async function readResponse(response, owner, explicitDownload = false, method = "fetch") {
    const reader = response.body?.getReader();
    if (!reader) { if (explicitDownload) publish("read-error", owner); return; }
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX || nonce !== owner) {
          if (size > MAX) publish("too-large", owner);
          await reader.cancel(); return;
        }
        chunks.push(value);
      }
      await emit(new Blob(chunks), owner, method);
    } catch { if (explicitDownload) publish("read-error", owner); }
    finally { reader.releaseLock(); }
  }
  const isExport = (type) => /csv|comma-separated|spreadsheetml|application\/(?:vnd\.ms-excel|force-download)|\.xlsx\b/i.test(type);
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (...args) => {
    const result = fetchOriginal(...args), owner = nonce;
    if (owner) result.then((response) => {
      if (isExport((response.headers.get("content-type") || "") + (response.headers.get("content-disposition") || ""))) {
        void readResponse(response.clone(), owner);
      }
    }).catch(() => {});
    return result;
  };
  const createOriginal = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { if (nonce) void emit(blob); return createOriginal(blob); };

  // FileSaver-style downloads may use data URLs, pre-created blob URLs, or
  // detached anchors. They never pass through createObjectURL while armed.
  // Read only the clicked export link, inside this browser page. Never read the
  // Downloads folder, replay a POST, follow redirects, or fetch another origin.
  function captureLink(anchor) {
    if (!anchor || anchor.tagName !== "A") return;
    return captureURL(anchor.href || "", anchor.getAttribute("download") || "", anchor.hasAttribute("download"));
  }
  function captureDocument(href) {
    if (!nonce || typeof href !== "string" || href.length > 8192) return;
    try { if (isDocumentExport(new URL(href, location.href))) return captureURL(href); } catch { /* Not an export URL. */ }
  }
  async function captureURL(href, filename = "", hasDownload = false) {
    const owner = nonce;
    if (!owner || typeof href !== "string") return;
    const namedExport = /\.(?:csv|xlsx)$/i.test(filename);
    if (href.length > Math.ceil(MAX * 4 / 3) + 4096) { if (namedExport) publish("too-large", owner); return; }
    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (url.username || url.password) return;
    const embedded = url.protocol === "data:" && (namedExport || /^data:(?:text\/csv|application\/(?:csv|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet))(?:;|,)/i.test(href)
      || (hasDownload && /^data:(?:text\/plain|application\/octet-stream)(?:;|,)/i.test(href)));
    const localBlob = url.protocol === "blob:" && url.origin === location.origin;
    const exportFile = /\.(?:csv|xlsx)$/i.test(url.pathname);
    const documentExport = ["http:", "https:"].includes(url.protocol) && isDocumentExport(url);
    const sameOriginFile = ["http:", "https:"].includes(url.protocol) && url.origin === location.origin && (namedExport || exportFile || documentExport);
    if (!embedded && !localBlob && !sameOriginFile) {
      if (namedExport) publish("unsupported-link", owner);
      return;
    }
    if (pendingLinks.has(href) || pendingLinks.size >= 4) return;
    const controller = new AbortController();
    pendingLinks.set(href, controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    const method = embedded ? "data-link" : localBlob ? "blob-link" : documentExport ? "document-link" : "file-link";
    publish("download-seen", owner, method);
    try {
      if (embedded) {
        // Decode embedded downloads directly. A site's connect-src policy can
        // block fetch(data:...) even though Chrome successfully downloads it.
        const comma = href.indexOf(",");
        if (comma < 0) throw new Error("Invalid embedded export");
        const payload = decodeURIComponent(href.slice(comma + 1));
        if (/;base64$/i.test(href.slice(0, comma))) {
          const binary = atob(payload);
          if (binary.length > MAX) { publish("too-large", owner); return; }
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          await emit(new Blob([bytes]), owner, method);
        } else await emit(new Blob([payload]), owner, method);
        return;
      }
      // Use the original fetch to avoid observing our own copy of the export.
      const response = await fetchOriginal(href, { credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (!response.ok) { publish("read-error", owner); return; }
      await readResponse(response, owner, true, method);
    } catch { publish("read-error", owner); }
    finally {
      clearTimeout(timeout);
      if (pendingLinks.get(href) === controller) pendingLinks.delete(href);
    }
  }
  document.addEventListener("click", (event) => {
    const anchor = event.composedPath?.().find((node) => node?.tagName === "A") || event.target?.closest?.("a");
    void captureLink(anchor);
  }, true);
  // Both methods must still invoke the site's original download unchanged.
  const clickOriginal = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) { void captureLink(this); return clickOriginal.apply(this, args); };
  const dispatchOriginal = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (event) {
    if (event?.type === "click") void captureLink(this);
    return dispatchOriginal.call(this, event);
  };
  // Amex can open an extensionless attachment in a new window. Observe its
  // exact export URL without suppressing the site's normal window/download.
  const openOriginal = window.open;
  if (openOriginal) window.open = function (...args) {
    void captureDocument(args[0]);
    return openOriginal.apply(this, args);
  };
  const sendOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const owner = nonce;
    if (owner) this.addEventListener("load", () => {
      if (!isExport((this.getResponseHeader("content-type") || "") + (this.getResponseHeader("content-disposition") || ""))) return;
      if (["blob", "arraybuffer", "", "text"].includes(this.responseType)) void emit(new Blob([this.response]), owner, "xhr");
    }, { once: true });
    return sendOriginal.apply(this, args);
  };
})();
