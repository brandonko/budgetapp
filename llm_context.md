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
  `data/transactions.csv`.
- Never automatically select another CSV in `data/`.
- If the canonical file does not exist, keep the app available without creating
  an empty database at server startup. Direct the dashboard user to Import data;
  the first successful import creates `transactions.csv` before merging rows.
- A noncanonical CSV may be used only through the explicit `--csv` server
  option.
- Treat the CSV as the source of truth. Manual adds, edits, and deletes persist
  immediately; imports remain staged until the user explicitly confirms them.
- Never overwrite an existing database during import. Append only the staged
  rows the user explicitly selected.
- Writes must be validated, revision-checked, serialized within the server, and
  performed using atomic file replacement.
- The eleven persisted columns, in order, are:

  ```text
  date,description,amount,category,subcategory,accountName,accountType,provider,notes,flags,createdAt
  ```

- `flags` contains normalized, comma-separated identifiers. `refunded` is the
  first supported flag. Internal UI identifiers and derived properties such as
  `_id` and `_isBillPayment` must not be written as extra CSV columns.
- `createdAt` is an immutable UTC ISO 8601 timestamp shared by every row from
  one committed import. It is blank for manual and legacy transactions.

## Backups

- Settings is organized as accessible tabs; **Backup** is the first tab.
- Store app-managed snapshots in `data/backups/` with timestamped
  `transactions_<timestamp>.csv` filenames.
- List every regular CSV placed directly in `data/backups/`, regardless of its
  filename. Order backups newest first by last-modified date and show their
  validated transaction count. Accept the current schema and compatible older
  seven- through ten-column Ledger schemas without modifying the backup file. Never follow symlinks or
  allow nested paths.
- Restoring a backup completely replaces the canonical CSV only after explicit
  user confirmation. Create a safety backup of the current file immediately
  before every restore, and perform the replacement atomically.
- Allow permanent deletion of an individual backup only after explicit user
  confirmation. Never let backup deletion affect the active CSV, other backups,
  symlinks, or nested paths.
- Allow backups to be renamed to any safe local CSV filename. Never overwrite
  another backup during a rename, and keep renamed files discoverable by their
  last-modified date.
- Keep backups private and ignored by Git together with the rest of `data/`.

## Import history

- Settings includes an **Import history** tab that groups persisted imported
  rows by `createdAt`, newest first, and displays each batch's remaining row
  count.
- Every import commit path stamps all newly added rows with one shared
  `createdAt` value. Previewing or cancelling an import never assigns one.
- Removing an import batch requires confirmation and the current CSV revision,
  deletes only rows with that exact timestamp, and creates a safety backup
  before changing the master CSV.
- Once every row in a batch is removed, that batch no longer appears in history.

## Categories and classifications

- Keep exactly two category levels for now: required `category` and optional
  `subcategory`. Do not introduce arbitrary-depth category trees without a new
  product decision.
- Dashboard cards and annual charts group by the top-level category. Opening a
  category surfaces subcategory dollar totals and permits filtering; blank
  subcategories are labeled **Unclassified** in the UI.
- Store ordered import classifications in `data/classifications.json`, beside
  the canonical CSV. Keep the file private through the existing `data/` ignore
  rule and expose an explicit JSON export action in Settings.
- Each classification maps to one required category and one optional
  subcategory and contains one or more rules.
- Each rule has separate optional case-insensitive regular expressions for the
  current category, subcategory, description, account name, and provider. Ignore
  blank matchers. All populated matchers in
  one rule must match; multiple rules within a classification are alternatives.
- Evaluate classifications and their rules in displayed order and stop at the
  first match. Present one classification at a time with a clear current/total
  pagination indicator. Append new classifications to the end and navigate to
  them immediately; do not expose manual reordering controls. Disable adding
  another classification until the last one has a category and every rule has
  at least one populated matcher, preventing repeated empty entries.
- Show classification destinations and only populated rule regexes in compact
  read-only mode. Each classification and rule has its own Edit, Cancel, and Save
  flow. Cancel restores the prior in-memory values; Save validates and atomically
  persists the entire classifications JSON. Allow classification details and one
  rule to be edited concurrently. Cancelling one restores only that section;
  saving either commits all visible drafts and closes both editors. Do not show
  a global Save button.
- Apply classifications before import preview and duplicate detection. Do not
  automatically reclassify existing CSV rows when rules are changed.
- Provide a confirmed **Apply to existing transactions** bulk action. Save the
  currently displayed rules as part of confirmation, preserve unmatched rows,
  and create a safety backup before atomically writing any category or
  subcategory changes. Before confirmation, show a modal containing every
  affected transaction and its before/after category path. All modal dismissal
  paths must write nothing. Bind the preview to the CSV revision and reject a
  stale confirmation. Do not create a backup or rewrite the CSV when no rows
  changed.
- If nothing matches, preserve the category supplied by the parser and populate
  a blank subcategory.
- From Classification settings, provide an all-dates modal of every transaction
  with a blank subcategory. Include description search plus category, account,
  and provider filters. Keep the user on Classification settings and preserve
  any draft when the modal closes.

## Privacy

- `raw_data_files/` and `data/` contain private financial data
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

## Dashboard periods

- The home page supports `Monthly` and `Annual` views.
- Default to the latest month containing a budget-visible transaction.
- Monthly view has independent month and year selectors. Annual view has a year
  selector and summarizes the full selected year.
- Changing the period updates summaries, category cards, charts, and dialogs
  together.
- Persist the selected view mode, year, month, and annual category/subcategory
  filter in the browser so dashboard context survives navigation to Import data or Settings.
  Validate restored values against the current transaction data and fall back
  safely when a saved selection is no longer available.
- Render one card for every visible category, including unmatched `Transfer`
  transactions.
- A category card shows its transaction count and net category total.
- Opening a category shows dollar totals for its subcategories. Transactions
  without a subcategory are presented as **Unclassified**.
- Clicking a category opens its transactions in a modal.
- Annual view includes a monthly spending chart stacked by category. Its legend
  shows annual dollar totals. Selecting a category redraws the same monthly
  chart as subcategory stacks; selecting a subcategory isolates it. Use a
  breadcrumb and **Back to categories** action for upward navigation.
- Include an expandable exact-dollar annual table below the spending chart.
  Category rows show January through December plus annual totals; expanding a
  row reveals its subcategories, including **Unclassified**. Keep the first
  column sticky and allow horizontal scrolling on narrow screens.
- Annual view includes a zero-centered monthly net chart. Months with positive
  net totals are green; months with negative net totals are red.
- Provide a **View all transactions** action for the selected period.
- All transaction lists are ordered by date, latest first.
- The interface must remain responsive and usable on desktop and mobile.

## Navigation

- The Ledger brand links to the dashboard home page.
- On the dashboard, center the view/year/month reporting controls in the header.
- Keep page-level destinations in the top-right hamburger menu: Dashboard,
  Import data, and Settings.
- Use the same menu across pages, clearly mark the current page, close it on an
  outside click or Escape, and return focus to the menu button after Escape.
- Organize Settings as accessible tabs, beginning with Backup. Add future user
  preferences there instead of adding unrelated controls to the dashboard or
  import page.

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

- A missing master CSV is an uninitialized state, not a generic load failure.
  Tell the user to get started by importing data and link directly to `/import`.
  Every supported importer must create a missing CSV before merging its
  parsed rows and must never replace an existing database.

- User-editable CSV fields are date, description, amount, category,
  subcategory, accountName, accountType, provider, notes, and supported flags. Notes are
  optional freeform text and may safely contain commas or line breaks.
- Users can toggle the `refunded` flag in the transaction editor. A refunded
  transaction remains visible and retains its original date and amount for
  duplicate detection, but contributes zero to all dashboard calculations.
- `createdAt` is system-managed and must survive edits unchanged.
- Migrate compatible older CSVs to the eleven-column schema
  atomically by adding missing optional fields; never require users to recreate
  an existing database.
- When an editor was opened from a monthly or annual transaction-list modal,
  saving, deleting, cancelling, or closing the editor returns to that refreshed
  list modal. Manual Add transaction continues to return to the dashboard.
- Saving updates the master CSV, then refreshes all derived dashboard state.
- Manual transaction creation uses the same validation as editing.
- Permanent deletion requires an explicit confirmation explaining that the CSV
  will be changed and the action cannot be undone.
- Reject stale writes with a clear message instead of silently overwriting a
  newer database revision.
- Even excluded bill-payment rows must remain editable.

## Upload-first ingestion

The app should not depend on a separate `build_transactions.py` workflow. Data
ingestion belongs in the **Import data** page at `/import`.

- Show one import card per supported source: `Credit Karma`, `Amazon`, `AliExpress`,
  `Venmo`, and `Apple Card`.
- Present importer cards as accessible tabs with only one card visible at a time.
  Keep Credit Karma selected initially, support arrow/Home/End keyboard navigation,
  and preserve every importer's form and progress state while switching tabs.
- Do not show manual JSON file pickers or a shared exported-files section.
  Apple Card is the deliberate exception: its source tab accepts the official
  date-range CSV exported from `card.apple.com`.
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
- Display every parsed transaction in the preview. Select new occurrences by
  default; leave duplicates deselected, visibly marked, and highlighted soft red.
- Transaction-list modal subtitles show counts only and never an aggregate amount.
  Provide case-insensitive description search plus category, subcategory,
  account-name, and provider filters while retaining latest-first ordering and
  preserving active filters when returning from the transaction editor.
- Allow every field to be edited locally before confirmation. A user may select
  a duplicate to force its inclusion or remove any staged row from the preview.
- Write only checked rows after explicit confirmation. Cancel, the top-right
  close control, Escape, and backdrop dismissal must discard the staged import
  without modifying or creating the master CSV.
- Bind previews to the CSV revision used for duplicate classification and reject
  confirmation if the database changed during review.
- If the database is new and empty, the first valid import populates it.

### Direct browser ingestion

- Keep companion-extension source integrations isolated under
  `ledger_data_importer_extension/<source>_extension/`.
- Keep only cross-source orchestration and the localhost page bridge under
  `ledger_data_importer_extension/shared/`.
- The root `_locales/` catalog is Amazon-specific but must remain at the
  manifest root because Chrome requires that location.

- Keep browser-authenticated Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card access in the companion
  Chrome extension; the localhost application must never request, store, or
  transmit site passwords, access tokens, or cookies.
- The Import data page owns date selection, progress, cancellation, results,
  and extension-install guidance.
- Default each direct-import date range to a 14-day lookback ending today while
  keeping both dates editable.
- Apple Card direct import opens `card.apple.com`, drives Apple's official
  Export Transactions form with the selected range and CSV format, and captures
  the structured response. Keep manual CSV selection as a fallback because the
  site's markup and private export implementation can change.
- Apply the selected date range to automatic Apple Card imports. Manual Apple
  Card CSV imports must stage every valid row in the selected file because the
  export itself already defines its range.
- Keep the manual Apple Card **Import selected CSV** action disabled until the
  user has selected a file.
- Use random, expiring, source-scoped server-side import sessions. Do not place
  an import token in a source URL, persist it to the CSV, or print it in server
  request logs.
- Preserve an active extension request across Manifest V3 background-worker
  suspension. A short-lived extension-local recovery copy is acceptable when
  it is deleted on completion/cancellation and rejected when stale.
- The extension may communicate only with loopback Ledger origins and must
  verify that start requests came from that origin's Import data page.
- Direct imports classify against the latest CSV state after scraping, then hold
  a revision-bound preview. Only explicit user confirmation appends selected rows
  through the validation, data lock, and atomic write path.
- Keep the upstream scraper isolated and attributed. It currently derives from
  Order History Exporter for Amazon 1.3.0 under the Unlicense.
- Direct Credit Karma import must request the BudgetLens equivalent of **All
  transactions** for the user-selected date range. Only transaction data needed
  by Ledger is required; wealth histories can remain empty.
- Credit Karma imports expose independent **Ignore Amazon transactions**,
  **Ignore AliExpress transactions**, and **Ignore Venmo transactions** checkboxes.
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

### Credit Karma parser

- Read the export's `transactions` array.
- Convert debit transactions to positive amounts.
- Convert credit transactions to negative amounts.
- Preserve category and account metadata.
- When its filter is enabled, ignore descriptions containing `amazon`,
  case-insensitively.
- When its filter is enabled, ignore AliExpress transactions by matching
  `alipay` case-insensitively; also accept `aliexpress` and `ali express` as
  defensive aliases.
- When its filter is enabled, ignore descriptions containing `venmo`, case-insensitively.
- When Credit Karma and Amazon files are uploaded together, infer the Amazon
  payment account from the most common ignored Amazon card transaction.

### Amazon parser

- Accept a root order array, an `{ "orders": [...] }` wrapper, or a single order
  object.
- Create one transaction for each item line, including quantity.
- Calculate the amount using the pre-tax item price multiplied by `1.10502`.
- Use `Shopping` as the category.
- Use account metadata inferred from Credit Karma when both files are present.
- For Amazon data without inferred or user-supplied metadata, default accountName,
  accountType, and provider to `Prime VISA`, `CREDIT CARD`, and `chase`.

### AliExpress and Venmo account metadata

- AliExpress defaults unknown account identity to `Credit Card Mastercard`,
  `CREDIT CARD`, and `Bank of America`.
- Venmo defaults unknown account identity to `Checking Account`, `BANK`, and
  `Bank of America`.

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
