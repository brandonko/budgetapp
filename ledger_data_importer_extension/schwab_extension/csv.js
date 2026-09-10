// Small strict CSV reader loaded only in the isolated collector's world.
// Only known transaction columns may cross the browser-to-Ledger boundary.
(() => {
  const MAX_BYTES = 16 * 1024 * 1024;
  function sanitize(content) {
    if (typeof content !== "string" || new TextEncoder().encode(content).length > MAX_BYTES) {
      throw new Error("Schwab CSV is missing or exceeds 16 MB. Use a shorter date range.");
    }
    const rows = [];
    let row = [], value = "", quoted = false, closed = false;
    const input = content.replace(/^\uFEFF/, "");
    for (let i = 0; i <= input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === undefined) throw new Error("Schwab CSV has an unclosed quote.");
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
        if (closed || char === '"') throw new Error("Schwab CSV has malformed quoting.");
        value += char;
      }
      if (rows.length > 100001) throw new Error("Schwab CSV exceeds 100,000 rows.");
    }
    if (/^Transactions\s+for\s+.+\s+as of\s+/i.test(rows[0]?.[0] || "") && !rows[0].slice(1).some((v) => v.trim())) rows.shift();
    const aliases = { "withdrawal (-)": "withdrawal", "deposit (+)": "deposit" };
    const headers = (rows.shift() || []).map((v) => aliases[v.trim().toLowerCase()] || v.trim().toLowerCase());
    if (!headers.length || headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error("Invalid Schwab checking CSV headers.");
    if (!["date", "type", "description", "withdrawal", "deposit"].every((h) => headers.includes(h))
        || ["action", "symbol", "quantity", "amount"].some((h) => headers.includes(h))) {
      throw new Error("Export one Schwab checking account as CSV. Brokerage exports are not supported.");
    }
    const allowed = ["date", "type", "description", "withdrawal", "deposit", "status", "currency"];
    const notices = new Set(["posted transactions", "pending transactions are not reflected within this sort criterion.", "there were no transactions for the search criteria you selected."]);
    const indexes = headers.map((h, i) => allowed.includes(h) ? i : -1).filter((i) => i >= 0);
    const quote = (v) => '"' + v.replaceAll('"', '""') + '"';
    const result = [indexes.map((i) => quote(headers[i])).join(",")];
    for (const values of rows) {
      if (notices.has(values[0].trim().toLowerCase()) && !values.slice(1).some((v) => v.trim())) continue;
      if (values.length !== headers.length) throw new Error("Schwab CSV has an incomplete row.");
      result.push(indexes.map((i) => quote(values[i])).join(","));
    }
    return result.join("\r\n");
  }
  globalThis.LedgerSchwabCsv = Object.freeze({ sanitize, MAX_BYTES });
})();
