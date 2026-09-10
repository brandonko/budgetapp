# Capital One

An independent, dependency-free adapter for Capital One transaction CSV exports.
Requires companion 0.9.1+. Load the repository's **root** extension folder, not
this directory. Start on Ledger's Capital One import tab at localhost.

- `coordinator.js`: short-lived, owned-tab session and nonce validation; only
  normalized CSV goes to Ledger's `/complete` (staging), never `/commit`.
- `content.js`: waits for sign-in/account choice, attempts recognizable export
  controls and explicit date/CSV fields. Unknown forms stay under user control.
- `capture.js`: standalone MAIN-world, armed-only passive fetch/XHR/blob CSV
  capture. Original responses/downloads continue normally. Captured CSV stays
  in-browser until the isolated collector sanitizes it. No private API, cookies
  or login-field access.
- `csv.js`: ISOLATED-only strict CSV shape/size checks and allowed-field
  normalization. Drops account numbers, card numbers, balances and posting
  dates before forwarding to the extension worker and Ledger. Do not register
  it again in MAIN: Chrome deduplicates the path across execution worlds.

Sign in and select your account manually. A matching export form can then be
automated. Otherwise choose your requested range and CSV in Capital One; the
collector remains listening. A downloaded-CSV fallback is in the same Ledger
tab. Both paths filter by original Transaction Date, inclusive endpoints.

Only US credit CSV (Debit/Credit columns) and bank CSV with explicit Debit/Credit
Transaction Type are supported. No guessed signed Amount-only formats, live
pending-transaction scraping, account selection heuristics or account combining.
Unknown/malformed files fail before review. Keep source categories when present.
The current live export form still needs verification with the user's account.

Format research: [credit CSV parser](https://github.com/mtlynch/beancount-capitalone),
[checking CSV layout](https://github.com/wgwz/capital-one-recurring-expenses).
No source code or financial fixtures from those projects are bundled here.
