# Ledger project context

This document records the product and implementation preferences that should
guide future work on Ledger. Update it whenever a decision changes.

## Product direction

Ledger is a local-first personal budgeting application. It should remain simple,
clean, fast, and understandable. The current scope is a single-user application
running on the user's machine, with a CSV acting as its database.

Prefer dependable behavior and clear data ownership over framework complexity.
Do not introduce a database server, frontend framework, build system, or
third-party Python dependency unless a future requirement clearly justifies it.

## Canonical database

- The default and canonical database is
  `processed_data_files/transactions.csv`.
- Never automatically select another CSV in `processed_data_files/`.
- If the canonical file does not exist when the server starts, create a new
  header-only `transactions.csv` so the user can import or add data.
- A noncanonical CSV may be used only through the explicit `--csv` server
  option.
- Treat the CSV as the source of truth. Manual adds, edits, deletes, and imports
  must persist to it immediately.
- Never overwrite an existing database during import. Merge only rows that are
  determined to be new.
- Writes must be validated, revision-checked, serialized within the server, and
  performed using atomic file replacement.
- The seven persisted columns, in order, are:

  ```text
  date,description,amount,category,accountName,accountType,provider
  ```

- Internal UI identifiers and derived flags must not be written as extra CSV
  columns.

## Privacy

- `raw_data_files/` and `processed_data_files/` contain private financial data
  and must remain ignored by Git.
- Never include real transaction data, account details, or test copies of the
  master CSV in commits.
- Test mutations against an isolated copy or synthetic database, never the
  canonical master file.
- Bind the server to `127.0.0.1` by default.

## Amount conventions

The stored convention is expense-oriented:

- Debit expenses and purchases are positive.
- Credits, refunds, and income are negative.
- Amazon item purchases are positive.

Keep this backend convention because import, reconciliation, and CSV logic rely
on it. Translate it for people in the interface:

- Income is always displayed as a positive amount.
- Income category cards, income transactions, and income modal totals should use
  positive presentation and green styling.
- Total spent uses a neutral background.
- Net total is `income - spending`.
- A positive net is a surplus and uses a light-green background.
- A negative net means spending exceeded income and uses a light-red background.
- Refunds outside the `Income` category remain negative and reduce the total for
  their spending category.

## Monthly dashboard

- The home page is a month view.
- Default to the latest month containing a budget-visible transaction.
- Changing month/year updates summaries, category cards, and dialogs together.
- Render one card for every visible category, including unmatched `Transfer`
  transactions.
- A category card shows its transaction count and net category total.
- Clicking a category opens its transactions in a modal.
- Provide a **View all transactions** action for the selected month.
- All transaction lists are ordered by date, latest first.
- The interface must remain responsive and usable on desktop and mobile.

## Credit-card bill-payment reconciliation

Do not exclude the entire `Transfer` category. Venmo, Zelle, and other unmatched
transfers may be legitimate expenses or incoming money.

Exclude only reconciled credit-card bill-payment pairs. The current rule is:

1. One row has category `Transfer`, case-insensitively; the other may be
   `Transfer` or `Income` because source exports may label the receiving side
   as income.
2. One row belongs to an account with type `BANK` and the other to an account
   with type `CREDIT`.
3. Their nonzero amounts are exact opposites. Either direction is valid, which
   covers both bill payments and credit-balance refunds back to a bank account.
4. Their posting dates are no more than five calendar days apart.
5. Matching is one-to-one, choosing the closest-date candidates first.
6. Reconciliation runs against the complete database, not only the selected
   month, so pairs can cross month boundaries.

Matched rows do not affect category cards, spending, income, or net totals.
They must remain accessible and editable through **View excluded bill-payment
transactions**. Editing either row may intentionally break the match and make
the transaction budget-visible again.

## Transaction editing

- Every CSV field must be editable: date, description, amount, category,
  accountName, accountType, and provider.
- Saving updates the master CSV, then refreshes all derived dashboard state.
- Manual transaction creation uses the same validation as editing.
- Permanent deletion requires an explicit confirmation explaining that the CSV
  will be changed and the action cannot be undone.
- Reject stale writes with a clear message instead of silently overwriting a
  newer database revision.
- Even excluded bill-payment rows must remain editable.

## Upload-first ingestion

The app should not depend on a separate `build_transactions.py` workflow. Data
ingestion belongs in the **Upload data** page.

- Show one file-selection card per supported parser.
- Currently supported parsers are `Credit Karma` and `Amazon`.
- Allow either parser to be used alone or both in the same import.
- Validate every selected file before writing anything. A multi-file import is
  all-or-nothing.
- Report parsed, added, and duplicate-skipped counts after import.
- If the database is new and empty, the first valid import populates it.

### Direct browser ingestion

- Keep browser-authenticated Credit Karma and Amazon access in the companion
  Chrome extension; the localhost application must never request, store, or
  transmit site passwords, access tokens, or cookies.
- The Upload data page owns date selection, progress, cancellation, results,
  and extension-install guidance.
- Default each direct-import date range to a 14-day lookback ending today while
  keeping both dates editable.
- Use random, expiring, source-scoped server-side import sessions. Do not place
  an import token in a source URL, persist it to the CSV, or print it in server
  request logs.
- Preserve an active extension request across Manifest V3 background-worker
  suspension. A short-lived extension-local recovery copy is acceptable when
  it is deleted on completion/cancellation and rejected when stale.
- The extension may communicate only with loopback Ledger origins and must
  verify that start requests came from that origin's Upload data page.
- Direct imports merge against the latest CSV state at completion rather than
  requiring the CSV revision from the start of a potentially long scrape.
  Imports append through the same validation, occurrence-aware deduplication,
  data lock, and atomic write path as file uploads.
- Preserve both manual JSON uploaders as fallbacks for extension errors, source
  page/API changes, login challenges, and unsupported browsers.
- Keep the upstream scraper isolated and attributed. It currently derives from
  Order History Exporter for Amazon 1.3.0 under the Unlicense.
- Direct Credit Karma import must request the BudgetLens equivalent of **All
  transactions** for the user-selected date range. Only transaction data needed
  by Ledger is required; wealth histories can remain empty.
- Preserve identical same-day transactions. During browser extraction, collapse
  duplicates only when Credit Karma supplies the same stable transaction ID;
  final CSV deduplication remains occurrence-aware by date and amount.
- The Credit Karma bridge is a clean implementation based on the documented
  export contract and observed API behavior. Do not copy CreditKarmaExtractor
  source unless that project adopts a compatible license.
- Treat direct importing as Chrome-only. Keep manual fallbacks available because
  private APIs, page markup, pagination, and sign-in behavior can change.

### Credit Karma parser

- Read the export's `transactions` array.
- Convert debit transactions to positive amounts.
- Convert credit transactions to negative amounts.
- Preserve category and account metadata.
- Ignore descriptions containing `amazon`, case-insensitively, because Amazon
  orders provide item-level detail.
- When Credit Karma and Amazon files are uploaded together, infer the Amazon
  payment account from the most common ignored Amazon card transaction.

### Amazon parser

- Accept a root order array, an `{ "orders": [...] }` wrapper, or a single order
  object.
- Create one transaction for each item line, including quantity.
- Calculate the amount using the pre-tax item price multiplied by `1.10502`.
- Use `Shopping` as the category.
- Use account metadata inferred from Credit Karma when both files are present.
- For an Amazon-only upload, default unknown accountName, accountType, and
  provider values to `Amazon`.

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

## Visual preferences

- Keep the visual language simple, spacious, and editorial rather than looking
  like a dense enterprise dashboard.
- Use the existing neutral canvas, serif display typography, restrained green
  accent, soft borders, and subtle shadows.
- Total spent stays visually neutral.
- Green communicates income or surplus; red communicates deficit or destructive
  action.
- Forms and dialogs must use plain labels, sign guidance, accessible focus
  states, and clear confirmation language.
- Avoid unnecessary charts, animation, navigation layers, or decorative assets.

## Development expectations

- Keep the app dependency-free unless explicitly reconsidered.
- Maintain compatibility with Python 3.10 or newer and modern browsers.
- Validate JSON schemas, dates, finite numeric values, positive quantities, and
  required text fields at the server boundary.
- Cap request sizes and do not expose arbitrary filesystem paths over HTTP.
- Preserve user changes already present in the working tree.
- For persistence changes, test create, update, delete, stale revision conflict,
  atomic failure, missing-database creation, and import deduplication.
- For reconciliation changes, test exact pairing, duplicate one-to-one pairing,
  cross-month dates, and retention of unmatched Venmo/Zelle transfers.
- Perform rendered desktop and mobile checks for material UI changes.
- Keep `README.md` and this file current when behavior or preferences change.
