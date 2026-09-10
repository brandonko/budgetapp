// ISOLATED-world export reader. Raw workbooks, account covers and reference
// numbers never leave this page. Only allowlisted transaction CSV is relayed.
(() => {
  const MAX_BYTES = 16 * 1024 * 1024;
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const merchant = ["appears on your statement as", "address", "city/state", "zip code", "country", "extended details"];
  const required = ["date", "description", "amount"];
  const fail = (message) => { throw new Error(`American Express export: ${message}`); };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const nodes = (node, name) => [...node.getElementsByTagNameNS(NS, name)];
  function csvRows(content) {
    const rows = []; let row = [], value = "", quoted = false, closed = false;
    const input = content.replace(/^\uFEFF/, "");
    for (let i = 0; i <= input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === undefined) fail("unclosed CSV quote.");
        if (char === '"') {
          if (input[i + 1] === '"') { value += '"'; i++; }
          else { quoted = false; closed = true; }
        } else value += char;
      } else if (char === '"' && !value && !closed) quoted = true;
      else if ([",", "\r", "\n", undefined].includes(char)) {
        row.push(value); value = ""; closed = false;
        if (char !== ",") {
          if (row.some((v) => v.trim())) rows.push({ values: row, formulas: [] });
          row = [];
          if (char === "\r" && input[i + 1] === "\n") i++;
        }
      } else {
        if (closed || char === '"') fail("malformed CSV quoting.");
        value += char;
      }
      if (row.length > 256 || rows.length > 100001) fail("too many rows or columns.");
    }
    return rows;
  }
  function normalize(rows, { workbook = false, date1904 = false, includeMerchantDetails = true } = {}) {
    const allowed = [...required, "category", "status", "currency", ...(includeMerchantDetails ? merchant : [])];
    let headers = null, indexes = [], output = [];
    const quote = (v) => '"' + String(v).replaceAll('"', '""') + '"';
    for (let r = 0; r < rows.length; r++) {
      const { formulas = [] } = rows[r];
      const values = rows[r].values.map((v) => String(v).trim());
      if (!values.some(Boolean)) continue;
      if (!headers) {
        const candidate = values.map((v) => v.toLowerCase());
        if (workbook && r < 100 && !required.every((v) => candidate.includes(v))) continue;
        const nonempty = candidate.filter(Boolean);
        if (!required.every((v) => candidate.includes(v)) || new Set(nonempty).size !== nonempty.length
            || (!workbook && candidate.some((v) => !v)) || formulas.length) fail("expected Date, Description and Amount columns.");
        headers = candidate;
        indexes = headers.map((h, i) => allowed.includes(h) ? i : -1).filter((i) => i >= 0);
        output.push(indexes.map((i) => quote(headers[i])).join(","));
        continue;
      }
      if ((!workbook && values.length !== headers.length) || values.slice(headers.length).some(Boolean)) fail("incomplete transaction row.");
      if (formulas.some((i) => allowed.includes(headers[i]))) fail("transaction fields must not contain formulas.");
      if (workbook) {
        const i = headers.indexOf("date"), value = values[i] || "";
        if (/^\d+(?:\.0+)?$/.test(value)) {
          const serial = Number(value);
          if (!(serial < 3000000 && (date1904 ? serial >= 0 : serial > 0 && serial !== 60))) fail("invalid Excel date.");
          const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial > 60 ? 30 : 31);
          values[i] = new Date(base + serial * 86400000).toISOString().slice(0, 10);
        }
      }
      output.push(indexes.map((i) => quote(values[i] || "")).join(","));
      if (output.length > 100001) fail("more than 100,000 transactions.");
    }
    if (!headers) fail("transaction headers were not found.");
    const result = output.join("\r\n");
    if (new TextEncoder().encode(result).length > MAX_BYTES) fail("transaction data exceeds 16 MB; choose a shorter range.");
    return result;
  }
  // ZIPs are read in memory, not extracted. Enforce both declared and actual
  // expanded limits before XML parsing; never fetch external workbook links.
  async function workbookRows(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (i) => view.getUint16(i, true), u32 = (i) => view.getUint32(i, true);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail("invalid workbook archive.");
    const count = u16(end + 10), directory = u32(end + 16), directorySize = u32(end + 12);
    if (!count || count > 500 || directory + directorySize !== end) fail("unsupported workbook size.");
    const entries = new Map(); let pos = directory, total = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || u32(pos) !== 0x02014b50) fail("invalid workbook directory.");
      const flags = u16(pos + 8), method = u16(pos + 10), size = u32(pos + 24), packed = u32(pos + 20);
      const n = u16(pos + 28), extra = u16(pos + 30), comment = u16(pos + 32), offset = u32(pos + 42);
      if (pos + 46 + n + extra + comment > end) fail("invalid workbook entry.");
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + n));
      total += size;
      if ((flags & 1) || ![0, 8].includes(method) || size > 32 * 1024 * 1024 || total > 100 * 1024 * 1024
          || entries.has(name) || u16(pos + 34) || offset + 30 > directory || u32(offset) !== 0x04034b50
          || u16(offset + 8) !== method || (u16(offset + 6) & 1)) fail("unsafe or oversized workbook.");
      const localName = u16(offset + 26), start = offset + 30 + localName + u16(offset + 28);
      if (start + packed > directory || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localName)) !== name) fail("invalid workbook part.");
      entries.set(name, { start, packed, size, method, crc: u32(pos + 16) });
      pos += 46 + n + extra + comment;
    }
    if (pos !== end) fail("invalid workbook directory length.");
    async function xml(name) {
      const entry = entries.get(name);
      if (!entry) fail("missing workbook part.");
      let data = bytes.subarray(entry.start, entry.start + entry.packed);
      if (entry.method === 8) {
        const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const chunks = []; let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > entry.size) { await reader.cancel(); fail("expanded workbook part is too large."); }
            chunks.push(value);
          }
          data = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        } finally { reader.releaseLock(); }
      }
      if (data.length !== entry.size) fail("truncated workbook part.");
      let crc = -1;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ -1) >>> 0) !== entry.crc) fail("corrupt workbook part.");
      const text = decoder.decode(data);
      if (/\0|<!DOCTYPE|<!ENTITY/i.test(text)) fail("unsupported XML declaration.");
      const document = new DOMParser().parseFromString(text, "application/xml");
      if (document.getElementsByTagName("parsererror").length) fail("invalid workbook XML.");
      return document;
    }
    const workbook = await xml("xl/workbook.xml");
    const sheets = nodes(workbook, "sheet").filter((n) => n.getAttribute("name")?.trim().toLowerCase() === "transaction details");
    if (sheets.length !== 1) fail("choose an activity XLSX with a Transaction Details sheet.");
    const relationId = sheets[0].getAttributeNS(REL, "id");
    const relations = await xml("xl/_rels/workbook.xml.rels");
    const matches = [...relations.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship")]
      .filter((n) => n.getAttribute("Id") === relationId);
    if (matches.length !== 1 || matches[0].getAttribute("TargetMode") === "External") fail("invalid worksheet reference.");
    const target = matches[0].getAttribute("Target") || "";
    const part = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (!/^xl\/worksheets\/[\w.-]+\.xml$/.test(part)) fail("invalid worksheet path.");
    const strings = entries.has("xl/sharedStrings.xml") ? nodes(await xml("xl/sharedStrings.xml"), "si")
      .map((n) => nodes(n, "t").map((t) => t.textContent).join("")) : [];
    const sheetRows = nodes(await xml(part), "row");
    if (sheetRows.length > 100100) fail("too many worksheet rows.");
    const rows = sheetRows.map((row) => {
      const values = [], formulas = [], seen = new Set();
      for (const cell of nodes(row, "c")) {
        const ref = /^([A-Z]{1,3})[1-9]\d*$/.exec(cell.getAttribute("r") || "");
        if (!ref) fail("invalid cell reference.");
        let col = 0; for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        col--;
        if (col > 255 || seen.has(col)) fail("duplicate or excessive columns.");
        seen.add(col);
        const kind = cell.getAttribute("t") || "n";
        let value = nodes(cell, "v")[0]?.textContent || "";
        if (nodes(cell, "f").length) formulas.push(col);
        if (kind === "s") {
          if (!/^\d+$/.test(value) || Number(value) >= strings.length) fail("invalid shared string.");
          value = strings[Number(value)];
        } else if (kind === "inlineStr") value = nodes(cell, "t").map((t) => t.textContent).join("");
        else if (!["n", "str", "d"].includes(kind)) value = "[unsupported cell value]";
        values[col] = value;
      }
      return { values: Array.from(values, (v) => v || ""), formulas };
    });
    return { rows, date1904: ["1", "true"].includes(nodes(workbook, "workbookPr")[0]?.getAttribute("date1904")) };
  }
  async function sanitize(content, options = {}) {
    if (typeof content === "string") {
      if (new TextEncoder().encode(content).length > MAX_BYTES) fail("file exceeds 16 MB.");
      return normalize(csvRows(content), options);
    }
    if (!(content instanceof ArrayBuffer) || content.byteLength > MAX_BYTES) fail("missing or oversized export.");
    const bytes = new Uint8Array(content);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const { rows, date1904 } = await workbookRows(bytes);
      return normalize(rows, { ...options, workbook: true, date1904 });
    }
    return normalize(csvRows(decoder.decode(bytes)), options);
  }
  globalThis.LedgerAmexExport = Object.freeze({ sanitize });
})();
