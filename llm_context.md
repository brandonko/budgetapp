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
- The twelve persisted columns, in order, are:

  ```text
  date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,flags,createdAt
  ```

- `flags` contains normalized, comma-separated identifiers. `refunded`,
  `internal-transfer`, and `include-in-budget` are supported budget-treatment
  flags. `refunded` is the
  first supported flag. Internal UI identifiers and derived properties such as
  `_id` and `_isBillPayment` must not be written as extra CSV columns.
- `createdAt` is an immutable UTC ISO 8601 timestamp shared by every row from
  one committed import. It is blank for manual and legacy transactions.
- `tags` is an optional comma-separated list of user-defined labels. Trim each
  label, discard blanks, and deduplicate case-insensitively while preserving the
  first spelling and order. A comma is therefore the tag delimiter and is not
  part of an individual tag.

## Backups

- Settings is organized as accessible tabs; **Backup** is the first tab.
- Store app-managed snapshots in `data/backups/` with timestamped
  `transactions_<timestamp>.csv` filenames.
- List every regular CSV placed directly in `data/backups/`, regardless of its
  filename. Order backups newest first by last-modified date and show their
  validated transaction count. Accept the current schema and compatible older
  seven- through eleven-column Ledger schemas without modifying the backup file. Never follow symlinks or
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
- Dashboard cards, annual charts, and the annual breakdown table can group by
  top-level category or by user-defined tag. Opening a category surfaces
  subcategory dollar totals and permits filtering; blank subcategories are
  labeled **Unclassified** in the UI. Tag grouping is flat, labels blank-tag
  rows **Untagged**, and ignores category entirely.
- A transaction with multiple tags contributes its full budget amount to every
  applicable tag. Tag totals can overlap and must not be presented as additive
  parts of a grand total. Classification rules do not set tags for now; tags are
  explicitly user-managed transaction metadata.
- Store alphabetically ordered import classifications in `data/classifications.json`, beside
  the canonical CSV. Keep the file private through the existing `data/` ignore
  rule and expose an explicit JSON export action on the dedicated Classifications page.
- Treat Classifications as a primary app destination. It belongs in the shared
  hamburger menu and must not be nested under Settings.
- Keep explanatory classification content inside a compact, accessible info
  disclosure patterned after the Import page. Include plain-language sections
  for actions and matching plus concise pseudocode showing nested transaction,
  classification, and rule evaluation. Avoid a redundant page subtitle.
- Treat classifications as ordered, reusable mass actions. Each classification
  contains one or more rules and explicitly sets at least one user-editable
  transaction field: description, category, subcategory, account name, account
  type, provider, notes, refund status, or internal-transfer treatment. Date and amount are intentionally not
  classification actions. An unselected action
  leaves its field unchanged. An enabled blank subcategory or notes action
  intentionally clears that field. Refund is tri-state: unchanged, mark
  refunded, or mark not refunded. Never let classifications change `createdAt`
  or arbitrary internal flags.
- Each rule has separate optional case-insensitive regular expressions for the
  current category, subcategory, description, account name, and provider. Ignore
  blank matchers. All populated matchers in
  one rule must match; multiple rules within a classification are alternatives.
  Reject backreferences and repeated groups containing another repetition or
  alternation so user-authored patterns cannot cause catastrophic backtracking.
- Each rule may include optional freeform notes documenting its rationale. Keep
  the notes editor visually separate from regex matchers and explicitly explain
  that notes do not participate in matching. In read-only mode, show a saved note
  as subtitle text immediately beneath the rule title. Preserve line breaks.
- Sort classifications alphabetically by category and subcategory, with
  classifications that do not set a category afterward. Evaluate them in that
  displayed order and stop at the first match. Present one classification at a
  time with a clear current/total pagination indicator. Place newly saved
  classifications into alphabetical order; do not expose manual reordering controls. Disable adding
  another classification until the last one has an action and every rule has
  at least one populated matcher, preventing repeated empty entries.
- Do not save two classifications with identical configured actions. Keep the
  duplicate draft open, identify the existing classification's one-based page
  number, and direct the user to add another rule to that classification.
- Show configured classification actions and only populated rule regexes in compact
  read-only mode. Each classification and rule has its own Edit, Cancel, and Save
  flow. Cancel restores only that editor's prior in-memory values. Save validates
  and persists only the corresponding draft, without committing or closing any
  other open editor. Allow classification details and multiple rules to be edited
  concurrently. For a new classification, stage its details and first rule
  independently and persist after both have been accepted. The server may still
  atomically replace the complete classifications JSON, but unsaved UI drafts
  must never be included in that request. Do not show a global Save button.
- Apply classifications before import preview and duplicate detection. Do not
  automatically reclassify existing CSV rows when rules are changed.
- Before classification matching, collapse every run of whitespace in imported
  description, category, subcategory, account name, account type, and provider
  values to one regular space. Persist and preview those normalized values. Do
  not apply this policy to freeform notes or retroactively rewrite existing rows.
- Match classification regexes against a whitespace-collapsed view of each
  matcher field so existing rows with source padding behave like their rendered text.
- Provide a confirmed **Apply to existing transactions** bulk action. Save the
  currently displayed rules as part of confirmation, preserve unmatched rows,
  and create a safety backup before atomically writing any transaction changes.
  Before confirmation, show a modal containing every affected transaction and
  each field's before/after value. All modal dismissal
  paths must write nothing. Bind the preview to the CSV revision and reject a
  stale confirmation. Do not create a backup or rewrite the CSV when no rows
  changed.
- If nothing matches, preserve the category supplied by the parser and populate
  a blank subcategory.
- From the Classifications page, provide an all-dates modal of every transaction
  with a blank subcategory. Use the shared transaction row and compact
  search/filter/sort toolbar. Show **Internal transfer** on excluded rows and
  **No rule matched** on the remaining rows, while preserving refund and custom
  tag badges. Keep the user on Classifications and preserve any draft when the
  modal closes.

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
- Persist the selected view mode, year, month, breakdown dimension, and annual category/subcategory
  filter in the browser so dashboard context survives navigation to any primary page.
  Validate restored values against the current transaction data and fall back
  safely when a saved selection is no longer available.
- Let users switch the monthly and annual spending breakdown between **By
  category** and **By tag**. Keep the selected dimension synchronized between
  views and persist it across navigation.
- In category mode, render one card for every visible category, including
  unmatched `Transfer` transactions. In tag mode, render a card for each tag
  plus **Untagged** when needed.
- A category or tag card shows its transaction count and net total.
- Opening a category shows dollar totals for its subcategories. Transactions
  without a subcategory are presented as **Unclassified**.
- Clicking a category opens its transactions in a modal.
- Annual view includes a monthly spending chart stacked by category. Its legend
  shows annual dollar totals. Selecting a category redraws the same monthly
  chart as subcategory stacks; selecting a subcategory isolates it. Use a
  breadcrumb and **Back to categories** action for upward navigation.
- In tag mode, the annual spending chart is stacked by tag, its legend filters
  to one tag, and the annual table has flat tag rows without subcategory
  expansion. Keep the monthly net chart unchanged.
- Include an expandable exact-dollar annual table below the spending chart.
  Category rows show January through December plus annual totals; expanding a
  row reveals its subcategories, including **Unclassified**. Keep the first
  column sticky and allow horizontal scrolling on narrow screens.
- Annual view includes a zero-centered monthly net chart. Months with positive
  net totals are green; months with negative net totals are red.
- Provide a **View all transactions** action for the selected period.
- All transaction-list dialogs default to date, latest first. Provide the shared
  sort control everywhere transactions are reviewed: Date, Description, or Cost,
  each ascending or descending. Cost sorting uses the absolute stored amount so
  expenses, credits, and income compare by dollar magnitude.
- Keep the dashboard transaction toolbar compact: description search and a
  plain-language combined sort menu remain visible; category/subcategory and
  tag and account/provider live in a Filters popover. Keep category and subcategory
  adjacent, limit subcategory choices to the selected category, show an active
  filter count, and render applied filters as removable chips. Populate the tag
  filter from the distinct tags available in the current transaction list and
  match tag names case-insensitively. On narrow screens,
  stack each related pair and keep the popover within the modal.
- The interface must remain responsive and usable on desktop and mobile.

### Shared transaction-modal contract

- Treat every modal that presents a transaction collection as a variant of one
  shared transaction-list experience. This includes dashboard transaction
  lists, post-import review, import history, classification previews, and
  **Review unclassified**.
- Keep the core structure and behavior synchronized across those variants:
  shared transaction rows and badges, description search, the Filters popover,
  category/subcategory pairing, tag/account/provider filters, active-filter
  chips, and the combined sort control. Reuse helpers from
  `app/transaction-ui.js` instead of independently recreating row or sort
  behavior.
- Page-specific behavior is additive and must not fork or replace the shared
  experience. For example, import review adds selection checkboxes, duplicate
  detection, New/No rule matched/Duplicate visibility toggles, and commit/cancel
  actions beneath the shared toolbar. Classification views add rule-match and
  internal-transfer context. Dashboard lists add their own period and category
  context.
- Whenever the transaction-list UI is enhanced or fixed, audit every modal
  variant and apply the compatible change everywhere. Preserve each variant's
  unique controls when doing so, and add regression coverage that prevents one
  modal from silently falling behind the others.

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

## Internal transfers and credit-card bill-payment reconciliation

Do not exclude the entire `Transfer` category. Venmo, Zelle, and other unmatched
transfers may be legitimate expenses or incoming money.

Under the default Automatic treatment, exclude only reconciled credit-card
bill-payment pairs. The current rule is:

1. At least one row has category `Transfer`, case-insensitively, or a description
   that looks like a transfer or account payment. The other row may retain any
   source category because exports sometimes label payment rows as `Income` or
   `Business services`.
2. The rows belong to different account identities. Account type does not
   restrict matching, so bank-to-bank transfers are supported.
3. Their nonzero amounts are exact opposites. Either direction is valid, which
   covers both bill payments and credit-balance refunds back to a bank account.
4. Their posting dates are no more than five calendar days apart.
5. Matching is one-to-one, choosing the closest-date candidates first.
6. Reconciliation runs against the complete database, not only the selected
   month, so pairs can cross month boundaries.

An `internal-transfer` flag always excludes a row. An `include-in-budget` flag
prevents automatic reconciliation and forces the row to count normally. With
neither flag, the automatic rule applies. The shared transaction editor exposes
these states as Automatic, Internal transfer, and Count normally.

Excluded rows do not affect monthly or annual category cards, subcategories,
charts, breakdown tables, spending, income, or net totals. They must remain
accessible and editable through **View X excluded internal transfer
transactions**. Preserve and display the original stored amount in muted text
with a line-through, while continuing to use a $0 budget amount.

## Transaction editing

- A missing master CSV is an uninitialized state, not a generic load failure.
  Tell the user to get started by importing data and link directly to `/import`.
  Every supported importer must create a missing CSV before merging its
  parsed rows and must never replace an existing database.

- User-editable CSV fields are date, description, amount, category,
  subcategory, accountName, accountType, provider, notes, tags, and supported flags. Notes are
  optional freeform text and may safely contain commas or line breaks.
- Tags are optional user-defined labels edited as a comma-separated list. Show
  them as compact badges in transaction lists.
- Users can toggle the `refunded` flag in the transaction editor. A refunded
  transaction remains visible and retains its original date and amount for
  duplicate detection, but contributes zero to all dashboard calculations.
- Users can set an internal-transfer treatment from every shared transaction
  editor, including import review and import history. Keep automatic detection
  overridable in both directions.
- `createdAt` is system-managed and must survive edits unchanged.
- Migrate compatible older CSVs to the twelve-column schema
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
- Even excluded internal-transfer rows must remain editable.

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
