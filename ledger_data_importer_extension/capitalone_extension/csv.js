// Small strict CSV reader loaded only in the isolated collector's world.
// Only known transaction columns may cross the browser-to-Ledger boundary.
(() => {
  const MAX_BYTES = 16 * 1024 * 1024;
  function sanitize(content) {
    if (typeof content !== "string" || new TextEncoder().encode(content).length > MAX_BYTES) {
      throw new Error("Capital One CSV is missing or exceeds 16 MB. Use a shorter date range.");
    }
    const rows = [];
    let row = [], value = "", quoted = false, closed = false;
    const input = content.replace(/^\uFEFF/, "");
    for (let i = 0; i <= input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === undefined) throw new Error("Capital One CSV has an unclosed quote.");
        if (char === '"') {
          if (input[i + 1] === '"') { value += '"'; i++; }
          else { quoted = false; closed = true; }
        } else value += char;
      } else if (char === '"' && value === "" && !closed) quoted = true;
      else if (char === "," || char === "\r" || char === "\n" || char === undefined) {
        row.push(value); value = ""; closed = false;
        if (char !== ",") {
          if (row.some((cell) => cell.trim())) rows.push(row);
          row = [];
          if (char === "\r" && input[i + 1] === "\n") i++;
        }
      } else {
        if (closed || char === '"') throw new Error("Capital One CSV has malformed quoting.");
        value += char;
      }
      if (rows.length > 100001) throw new Error("Capital One CSV exceeds 100,000 rows.");
    }
    const headers = (rows.shift() || []).map((v) => v.trim().toLowerCase());
    if (!headers.length || headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error("Invalid Capital One CSV headers.");
    const card = ["transaction date", "description", "debit", "credit"].every((h) => headers.includes(h));
    const bank = ["transaction date", "transaction description", "transaction amount", "transaction type"].every((h) => headers.includes(h));
    if (card === bank) throw new Error("Unrecognized Capital One CSV format. Use the account's transaction CSV export.");
    const allowed = card ? ["transaction date", "description", "category", "debit", "credit", "currency"]
      : ["transaction date", "transaction description", "category", "transaction amount", "transaction type", "currency"];
    const indexes = headers.map((h, i) => allowed.includes(h) ? i : -1).filter((i) => i >= 0);
    const quote = (v) => '"' + v.replaceAll('"', '""') + '"';
    const result = [indexes.map((i) => quote(headers[i])).join(",")];
    for (const values of rows) {
      if (values.length !== headers.length) throw new Error("Capital One CSV has an incomplete row.");
      result.push(indexes.map((i) => quote(values[i])).join(","));
    }
    return result.join("\r\n");
  }
  globalThis.LedgerCapitalOneCsv = Object.freeze({ sanitize, MAX_BYTES });
})();
