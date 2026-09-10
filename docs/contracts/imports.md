# Import review, browser ingestion, and deduplication

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Upload-first ingestion

The app should not depend on a separate `build_transactions.py` workflow. Data
ingestion belongs in the **Import data** page at `/import`.

- Show one import card per supported source: `Credit Karma`, `Amazon`, `AliExpress`,
  `Venmo`, `eBay`, `Walmart`, `Apple Card`, `Capital One`, `Schwab Checking`, and generic `CSV`.
- Present importer cards as accessible tabs with only one card visible at a time.
  Keep Credit Karma selected initially, support arrow/Home/End keyboard navigation,
  and preserve every importer's form and progress state while switching tabs.
- Do not show manual JSON file pickers or a shared exported-files section.
  Apple Card and Capital One have deliberate source-specific CSV fallbacks.
  Apple Card's manual CSV ignores date selectors; Capital One's manual CSV
  deliberately uses the same inclusive Transaction Date range as its direct import.
- The generic CSV tab accepts exactly the Ledger schema without `createdAt`:
  `date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links`.
  Also accept previous headers without id/links or group, defaulting optional fields.
  Require a valid date, nonblank description, and finite numeric amount on each
  row; allow every other value to be blank. Validate rows independently, stage
  every valid row, and report the total invalid-row count in the shared review
  modal. Never accept a caller-supplied `createdAt`; stamp selected rows only at
  commit time. Show an **Apply classification rules** checkbox that defaults on.
  When it is off, bypass classification entirely and preserve supplied CSV values;
  intentionally bypassed rows must not be presented as **No rule matched**.
- Keep source parsing and validation on the server boundary.
- Amazon, AliExpress, eBay, Venmo, and Apple Card import tabs must expose editable `accountName`,
  `accountType`, and `provider` fields. Store their trimmed values in the
  source-scoped import session and apply them server-side to every resulting row.
- Prefill Amazon with `Prime VISA`, `CREDIT CARD`, `chase`; AliExpress with
  `Credit Card Mastercard`, `CREDIT CARD`, `Bank of America`; and Venmo with
  `Checking Account`, `BANK`, `Bank of America`. Prefill Apple Card with
  `Apple Card`, `CREDIT CARD`, `Goldman Sachs`.
- Prefill eBay with `eBay`, `CREDIT CARD`, `eBay` and create item-level rows whose
  allocated amounts reconcile to each final order total.
- In the Credit Karma importer, remind users that disconnected linked accounts
  cause missing transactions and link to Credit Karma's Manage Accounts page so
  they can reconnect a bank or service before importing.
- Present Credit Karma transaction filters as one vertical checkbox list. Each
  label must state the exact case-insensitive description substring or substrings
  used by that filter.
- Report parsed, new, and duplicate counts in a pre-commit review modal.
- Put the shared compact search/filter/sort toolbar directly below the import
  review header. Place Duplicate, No rule matched, and New visibility toggles
  below that toolbar; these toggles affect visibility, while checkboxes alone
  determine which rows will be committed.
- Display every parsed transaction in the preview. Select nonzero new occurrences
  by default; leave duplicates and $0 transactions deselected. Keep duplicates
  visibly marked and highlighted soft red.
- Carry each row's rule-match result into the import preview. Highlight rows
  that matched no classification rule in soft amber and label them **No rule
  matched** so users can identify manual work or missing rules. Duplicate red
  styling takes visual precedence when both states apply.
- Transaction-list modal subtitles show counts only and never an aggregate amount.
  Provide case-insensitive description/notes search plus category, subcategory,
  account-name, and provider filters while retaining latest-first ordering and
  preserving active filters when returning from the transaction editor.
- Allow every field to be edited locally before confirmation. A user may select
  a duplicate to force its inclusion or uncheck a staged row to omit it; do not
  remove rows from the preview or delete existing matches through import review.
- Show an **Edited** badge after a successful single or bulk edit changes an
  imported row. Track this only for the current review by occurrence ID, never
  in user tags, flags, or the CSV. Preserve it through filtering, inclusion
  changes, and revalidation; reset for a new/discarded review. Cancelled, failed,
  no-op, and automatic changes must not mark a row as edited. Keep existing
  rule-match and duplicate badges, counts, and visibility filters unchanged.
  Edited unmatched rows keep both **No rule matched** and **Edited** badges,
  but lose the yellow background. A follow-up flag still takes visual priority.
- Each shared transaction list has an icon-only follow-up flag to the right of
  **Edit**, with an accessible label and `aria-pressed`. Store `flagged` in the
  existing CSV `flags` column; preserve unknown flags and refund receipts. This
  flag never changes budget treatment, amounts, or import inclusion. Red
  highlighting wins over yellow/duplicate styling while enabled; clearing it
  restores the row's underlying state. **Filters → Flagged only** is a two-state
  switch: on filters to flagged rows; off includes all matching rows. Retire old
  Not flagged selections to All. Apply across dashboard, all-time, import, import-history,
  unclassified, classification-preview, and transfer-review lists. Bulk editing
  also supports setting/clearing this flag. Use the shared list controller;
  saved rows use revision-checked, backed-up writes, while all proposal/import
  contexts stage the flag until their existing final confirmation. Do not
  expose editing/flagging controls on read-only nested refund candidate rows.
  Row flag toggles are synchronous optimistic updates, not per-click requests.
  Cache net changes in the shared controller, preserving filters and inclusion.
  Saved-list X/Escape/backdrop closing awaits a single atomic flag batch with
  revision protection and a safety backup; failure keeps the list and queue open.
  Temporarily opening an editor is not closing the review. Keep queued flags
  across successful editor/bulk writes and row reindexing using durable IDs; do
  not let unrelated refreshes silently accept a stale revision. On Transactions,
  flush before in-app navigation and offer Save flags; browser reload/close warns
  while pending rather than trusting unload writes. Staged imports/reconciliation
  revalidate cached flags before their own final confirmation; all cancellation
  paths discard them without database writes.
- Write only checked rows after explicit confirmation. For an uncommitted review
  with rows, Cancel, the top-right close control, Escape, and backdrop dismissal
  must ask before discarding it. Declining keeps all rows, edits, selections,
  filters, and the session intact. Confirmed discard never modifies or creates
  the master CSV. Empty or already committed reviews close without this warning;
  prevent dismissal during commit. Temporarily opening an editor is not discard.
- Bind previews to the CSV revision used for duplicate classification and reject
  confirmation if the database changed during review.
- Do not expose an alternate direct-upload endpoint that parses and writes in one
  request. Every supported file and browser import must use the staged session,
  preview, explicit-confirmation, and revision-check flow.
- If the database is new and empty, the first valid import populates it.

### Direct browser ingestion

- Keep companion-extension source integrations isolated under
  `ledger_data_importer_extension/<source>_extension/`.
- Keep cross-source UI, branding, connection settings, orchestration, and the page bridge under
  `ledger_data_importer_extension/shared/`.
- The toolbar action must open the Ledger-owned `shared/popup.html`, never the
  retained Amazon upstream popup. Show Ledger branding, all supported website
  sources, the server selector, Open Import data, and Ledger connection settings.
  This is only a launcher: date selection, source execution, progress, and
  confirmation remain in the app. Do not start scrapes, read import jobs, request
  new permissions, or claim a server is connected merely by opening the popup.
  Offer HTTP loopback or exact trusted origins with current host permission;
  recheck trust on navigation. Remember only the chosen origin, not full URLs
  or tokens. Test the actual manifest entry point as well as navigation behavior.
- Shared extension branding lives in `shared/icons/`: preserve the outlined
  Ledger SVG master and Chrome PNG sizes, using the app's #3f7659 green,
  white Georgia L, and asymmetric rounded badge corners.
- Never register the same JavaScript path in both MAIN and ISOLATED worlds.
  Chrome's static injection deduplicates paths across worlds, leaving the second
  context without its helper. Keep page observers self-contained and parsers in
  ISOLATED, with bounded, untrusted data messages between them. Test actual
  manifest loading in separate globals with path deduplication; preloading
  helpers into each test context alone does not exercise extension startup.
- The root `_locales/` catalog is Amazon-specific but must remain at the
  manifest root because Chrome requires that location.

- Keep browser-authenticated Credit Karma, Amazon, AliExpress, eBay, Walmart,
  Venmo, Apple Card, Capital One, and Schwab Checking access in the companion
  Chrome extension; the localhost application must never request, store, or
  transmit site passwords, access tokens, or cookies.
- The Import data page owns date selection, progress, cancellation, results,
  and extension-install guidance.
- **Settings → Preferences** owns browser-local import defaults via
  `LedgerPreferences` in `theme.js`: lookback choices `1w`, `2w`, `3w`, `1m`, `2m`,
  `3m`, default `2w`, and `matchRefunds`, default true. Weeks mean 7-day multiples;
  months mean calendar subtraction clamped at month end. Use local calendar dates.
  Every importer's date controls use these defaults and remain editable. Preference
  changes in another tab may update untouched defaults, never overwrite custom
  dates or change an active import session. Ledger-format and Apple Card CSV
  imports still read the entire file without date filtering.
  Use the former Credit Karma refund opt-out when no valid global `matchRefunds`
  boolean has been saved.
- Apple Card direct import opens `card.apple.com`, drives Apple's official
  Export Transactions form with the selected range and CSV format, and captures
  the structured response. Keep manual CSV selection as a fallback because the
  site's markup and private export implementation can change.
- Apply the selected date range to automatic Apple Card imports. Manual Apple
  Card CSV imports must stage every valid row in the selected file because the
  export itself already defines its range.
- Accept only the explicitly supported Apple Card transaction types: purchase
  and debit as expenses; credit, refund, and payment as negative amounts. Reject
  blank or unknown types rather than trusting their source amount sign.
- Keep the manual Apple Card **Import selected CSV** action disabled until the
  user has selected a file.
- Use random, expiring, source-scoped server-side import sessions. Do not place
  an import token in a source URL, persist it to the CSV, or print it in server
  request logs.
- Preserve an active extension request across Manifest V3 background-worker
  suspension. A short-lived extension-local recovery copy is acceptable when
  it is deleted on completion/cancellation and rejected when stale.
- The extension supports HTTP localhost/127.0.0.1 automatically and exact
  user-approved HTTP/HTTPS server origins configured in its connection settings.
  Request optional host permission only when the user adds or reconnects a server. Check the
  saved scheme, hostname, and port at detection and import start, and require
  a top-level Import data page from that same origin. Never trust every LAN host.
- Treat saved trusted origins and dynamic bridge registrations as separate state.
  The service worker must synchronize registrations at startup/update, worker
  wake, and trust/permission changes; missing scripts must not require deleting
  and re-adding a saved server. Keep this work serialized and ignore origins with
  revoked permissions. Connection settings show current site access and offer
  Reconnect for each saved server. Reconnect may inject only the isolated bridge
  into already-open, exactly trusted top-level Import pages; never start imports,
  collect source data, or request permissions in the background. Repeated bridge
  injection reannounces readiness without adding duplicate message listeners.
- Direct imports classify against the latest CSV state after scraping, then hold
  a revision-bound preview. Only explicit user confirmation appends selected rows
  through the validation, data lock, and atomic write path.
- Keep the upstream scraper isolated and attributed. It currently derives from
  Order History Exporter for Amazon 1.3.0 under the Unlicense.
- Direct Credit Karma import must request the BudgetLens equivalent of **All
  transactions** for the user-selected date range. Only transaction data needed
  by Ledger is required; wealth histories can remain empty.
- Credit Karma imports expose independent **Ignore Amazon transactions**,
  **Ignore AliExpress transactions**, **Ignore Venmo transactions**,
  **Ignore eBay transactions**, and **Ignore Walmart transactions** checkboxes.
  All default to enabled, and
  the chosen values belong to that source-scoped import session.
- Preserve identical same-day transactions. During browser extraction, collapse
  duplicates only when Credit Karma supplies the same stable transaction ID;
  final CSV deduplication remains occurrence-aware by date and amount.
- The Credit Karma bridge is a clean implementation based on the documented
  export contract and observed API behavior. Do not copy CreditKarmaExtractor
  source unless that project adopts a compatible license.
- Treat browser importing as Chrome-only. Private APIs, page markup, pagination,
  and sign-in behavior can change and should produce clear errors.
- AliExpress import uses Chrome's existing AliExpress cookies to sign MTop requests.
  Cookies and signing tokens must stay inside the extension and must never be sent
  to Ledger or written to disk. Normalize only order and item data for the server.
- Derive AliExpress request behavior from `nrbrook/AliExpress-Order-Export` under
  its MIT license, retain its copyright/license notice, and keep the integration
  isolated in `aliexpress_extension/`.
- Venmo import must use the signed-in `account.venmo.com` Statements session to
  retrieve official CSV data in bounded monthly requests. Cookies and credentials
  stay in Chrome; only statement CSV contents go to the local server.
- Treat Venmo's signed amounts as wallet-perspective values and invert them for
  Ledger: outgoing payments are positive expenses and incoming payments are negative
  backend income. Skip pending, failed, cancelled, declined, and reversed activity.
- Skip Venmo balance transfers/cash-outs because payment rows are the budget events;
  importing both creates double counting, especially when Credit Karma's Venmo filter is enabled.

## Import deduplication

The requested import identity is normalized `(date, amount)`; description is
deliberately ignored so a description edit does not create a duplicate.

Deduplication must use occurrence counts rather than a simple set:

- Existing count zero, uploaded count two: add both.
- Existing count one, uploaded count two: add one.
- Existing count two, uploaded count two: add none.

Apply counting across all files selected in one upload.

Known consequences of the chosen identity rule:

- An incremental source containing one genuinely new transaction that exactly
  matches an existing date and amount cannot be distinguished from a duplicate.
- Editing a stored date or amount may cause the original source row to be added
  again during a later import.
- Deleting an imported transaction and importing its source again will restore
  it.

Solving these cases later would require persistent source identifiers or a
separate import ledger; do not silently change the CSV schema to address them.

## Known parser decisions still needing future policy

- Amazon promotions and per-item discounts
- Shipping charges
- Returns, refunds, and canceled orders
- Multiple currencies
- Multiple simultaneous server processes writing the same CSV

Handle these deliberately when requirements are defined. Do not guess in ways
that could silently alter financial totals.
