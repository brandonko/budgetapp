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
- The thirteen persisted columns, in order, are:

  ```text
  date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,createdAt
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
- Never expose that comma-separated storage format as the primary transaction-editor
  interaction. Use the shared tag picker in every transaction editor: show all tags
  currently present in the master CSV as stable alphabetized toggle buttons, include
  tags from the current staged import, and highlight selected tags. End the list with
  a visually distinct dashed control containing a new-tag text input and `+` action.
  Creating a tag selects it immediately, case-insensitive matches select the existing
  spelling, commas are rejected, and Enter behaves like the `+` action without
  submitting the transaction form. A new tag is not durable until its enclosing
  transaction edit or import is confirmed; all cancel paths discard it.

## Exports and safety backups

- Settings is organized as accessible tabs; **Exports** is the first tab.
- The Exports tab lets the user choose an inclusive start and end date, shows
  the matching transaction count, and downloads a CSV using the exact Ledger
  import schema without `createdAt`. Default a newly loaded form to the earliest
  and latest dates in the current database. Disable export for invalid or empty
  ranges. Prefer the browser save-file picker when available and use a normal
  CSV download fallback.
- **Settings → Preferences** owns browser-local display preferences. Dark mode is
  an explicit, persistent toggle shared by every page. Apply the saved theme
  before the stylesheet loads to avoid a light-theme flash, keep native controls
  in the matching `color-scheme`, and preserve WCAG AA text contrast in both palettes.
- Let the user choose the first magnitude abbreviated in dashboard summary totals:
  None, K, M, B, or T. Default to M. Once enabled, use the natural suffix for each
  larger magnitude through T, then scientific notation above trillions. None keeps
  exact currency formatting at every magnitude. Preserve the exact value in the
  summary's accessible text and tooltip regardless of visual formatting.
- Store app-managed snapshots in `data/backups/` with timestamped
  `transactions_<timestamp>.csv` filenames.
- Keep automatic safety snapshots for destructive or bulk transaction mutations,
  but do not present the backups directory as the primary user-facing workflow.
- Keep backups private and ignored by Git together with the rest of `data/`.

## Import history

- Experimental **Data coverage** at `/coverage` is a read-only inventory by
  provider/account-type/account-name identity. Count every stored occurrence,
  including excluded transactions. Empty months are no recorded activity, never
  proof of incomplete or complete bank data. Use calendar-day freshness relative
  to an explicit local as-of date and identify unknown import timestamps.

- Settings includes an **Import history** tab that groups persisted imported
  rows by `createdAt`, newest first, and displays each batch's remaining row
  count. Paginate this list at exactly five import batches per page with
  accessible Previous and Next controls. Clamp the current page after refresh
  or deletion so an empty trailing page is never shown.
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
- Keep a visual taxonomy manager under **Settings → Taxonomy**. Merge category and
  subcategory values derived from current transactions with manually created values
  stored atomically in `data/taxonomy.json`. New saved values must remain available
  even when no transaction uses them yet, and should feed transaction-editor
  suggestions. Display top-level categories as parent cards with nested subcategory
  chips and transaction counts, support search across both levels, alphabetize the
  hierarchy, and reject case-insensitive duplicates. Taxonomy creation does not
  reclassify existing transactions; classifications remain the mechanism for bulk
  transaction changes. Provide an on-by-default toggle that hides categories with
  no subcategories, and combine it with taxonomy text search when both are active.
- Create taxonomy values inline rather than in dialogs. End every category's chip
  list with a dashed subcategory name-and-plus control, and end the category grid
  with a dashed category card using the same interaction. Both controls submit by
  clicking plus or pressing Enter and reject case-insensitive duplicates in place.
- Let users delete categories and subcategories only when their transaction count
  is zero. Require explicit confirmation, remove only the saved taxonomy value,
  and never mutate transactions as a side effect. Keep in-use delete controls
  disabled with an explanation that those transactions must be reclassified first.
- Dashboard cards, annual charts, and the annual breakdown table can use
  top-level categories or a user-defined tag query. Opening a category surfaces
  subcategory dollar totals and permits filtering; blank subcategories are
  labeled **Unclassified** in the UI.
- Tag queries accept multiple tags with **Match any** (logical OR) or **Match
  all** (logical AND). Deduplicate the result by transaction before calculating
  its count or total. Individual tag overview totals may overlap and must be
  explicitly described as non-additive. Classification rules do not set tags
  for now; tags are explicitly user-managed transaction metadata.
- Label blank-tag rows **Untagged**. Allow Untagged in an OR query, but disable
  Match all when Untagged is selected with any real tag because no transaction
  can satisfy that expression.
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
  tag badges. Hide internal transfers by default and provide an
  **Internal transfer** visibility toggle, consistent with the import-review
  transaction-type toggles, so the user can reveal them when needed. Keep the
  user on Classifications and preserve any draft when the modal closes.

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

- The home page supports `Monthly`, `Annual`, and `Year over year` views.
- Default to the latest month containing a budget-visible transaction.
- Monthly view has independent month and year selectors. Annual view has a year
  selector and summarizes the full selected year. Year-over-year view has a
  start year and end year, plus individual year toggles for choosing which lines
  remain visible inside that range.
- Changing the period updates summaries, category cards, charts, and dialogs
  together.
- Persist the selected view mode, year, month, year-comparison start year,
  selected comparison years, comparison metric/chart/time-span mode, breakdown
  dimension, and annual category/subcategory filter in the browser so dashboard
  context survives navigation to any primary page.
  Validate restored values against the current transaction data and fall back
  safely when a saved selection is no longer available.
- Let users switch the monthly and annual spending breakdown between **By
  category** and **By tag**. Keep the selected dimension, selected tags, and
  Any/All match mode synchronized between views and persist them across navigation.
- Keep the shared Tag Explorer inside the active breakdown section so switching
  dimensions does not insert or remove a card between major dashboard sections.
  In monthly view it sits directly below the breakdown heading; in annual view
  it sits directly below **A year at a glance**.
- In category mode, render one card for every visible category, including
  unmatched `Transfer` transactions. In monthly tag mode, the Tag Explorer is
  the complete breakdown: do not render category cards or add a secondary
  category drill-down beneath it. Tag-selection buttons replace tag cards.
- A category card shows its transaction count and net total.
- Opening a category shows dollar totals for its subcategories. Transactions
  without a subcategory are presented as **Unclassified**.
- Clicking a category opens its transactions in a modal.
- Annual view includes a monthly spending chart stacked by category. Its legend
  shows annual dollar totals. Selecting a category redraws the same monthly
  chart as subcategory stacks; selecting a subcategory isolates it. Use a
  breadcrumb and **Back to categories** action for upward navigation.
- In tag mode, never stack tags because a transaction can belong to several of
  them. Require a tag selection, render one combined monthly bar from the unique
  query result, and show a monthly table with matching counts and unique spending
  plus an annual total. Keep the monthly net chart unchanged.
- Do not render the monthly category-card section at the bottom of annual view;
  the annual charts and exact-value table are the complete annual breakdown.
- Include an expandable exact-dollar annual table below the spending chart.
  Category rows show January through December plus annual totals; expanding a
  row reveals its subcategories, including **Unclassified**. Keep the first
  column sticky and allow horizontal scrolling on narrow screens.
- Annual view includes a zero-centered monthly net chart. Months with positive
  net totals are green; months with negative net totals are red. Preserve each
  month's current visual bar height before annual chart rerenders, then animate
  spending stacks and net bars to their new normalized heights. Category,
  subcategory, tag, and year changes must not snap the bars to their new values.
- Year-over-year view uses a line chart with January through December on the X
  axis and dollars on the Y axis. Let users switch between cumulative totals and
  independent monthly values, as well as Spending, Income, and Net total. Morph
  existing lines and points between modes with a short eased animation. This
  small, user-triggered morph intentionally runs even when the browser reports
  `prefers-reduced-motion`; persist the selected chart mode. Default to the newest
  three years inside the selected
  range when no saved selection remains valid; never allow every year to be
  deselected.
- Default year-over-year comparisons to **Comparable months**: stop all selected
  lines at the latest imported month in the newest selected year. The optional
  **All available months** mode lets each line continue through its own latest
  imported month. Never project future values or turn unavailable months into
  zero activity.
- Show exact cumulative or independent monthly values (matching the chart mode),
  period totals, changes from the prior selected year, and the newest year's
  monthly average. A spending or income
  point opens that month's matching transaction type in the shared dashboard
  dialog; a net point opens all budget-visible transactions for that month.
- Exclude refunded and internal-transfer values from all comparison math using
  the same zero-value rules as Monthly and Annual views. Keep excluded internal
  transfers available through the dedicated review action for the full range.
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
- Reserve a stable document scrollbar gutter so navigating between short and
  long pages does not shift centered layouts horizontally.
- Animate the Monthly and Annual **Total spent**, **Total income**, and **Net
  total** values as mechanical odometer reels whenever the dashboard period is
  rerendered. Keep currency punctuation stationary, roll each digit vertically,
  and preserve an exact nonanimated currency value for assistive technology.
- Use the browser's color-scheme preference only when no Ledger preference has
  been saved. After the user chooses Light or Dark, that explicit selection must
  control the complete palette; never leave an OS-level media query active that
  can mix light and dark design tokens.
- Define visualization colors as ordered theme tokens (`--viz-1` through
  `--viz-12`). Assign visible series by display order rather than hashing a year
  or label, so the first four series always receive the most distinguishable
  colors and closer secondary shades are used only for larger sets. Each theme
  must provide the complete palette with at least 3:1 contrast against its
  surface; keep the palette uniqueness and primary-distance regression checks.

### All-time Transactions dashboard

- Keep **Transactions** as a primary destination at `/transactions`, separate
  from the period-based dashboard. Default to the entire transaction history
  with no date limits, and allow optional inclusive start/end dates.
- Support description search, category/subcategory, account/provider, and
  multiple tags with Any/All matching. Combined tag results count each
  transaction exactly once, including when tags overlap.
- Groups are a separate optional `group` CSV field: at most one group per
  transaction, independent of multiple tags. Tags describe reusable topics;
  groups describe trips or projects which may receive later transactions.
  Do not automatically convert or remove legacy `(group)` tags.
- Use the shared searchable group picker in every transaction editor. Offer
  existing names, No group to clear membership, and inline creation. Collapse
  whitespace, enforce a 100-character limit, and reuse existing names
  case-insensitively on both client and server. Creating a group stays staged until
  the enclosing transaction/review is saved; there is no independent group database.
- Render a distinct group badge with a squared, left-accented style, separate
  from tag pills. Provide a shared group filter including All groups and No group.
  On the all-time page it filters summaries/category breakdowns as well as rows.
- Show spending, income, and net totals plus the category spending breakdown
  for the complete filtered result, using existing refund/internal-transfer
  treatment. Paginate the result list at 50 rows; pagination never changes totals.
- Reuse shared transaction rows, the compact Filters/sort toolbar, and the
  transaction editor. Keep filters and context when editing returns to the page.

### Shared transaction-modal contract

- Treat every modal that presents a transaction collection as a variant of one
  shared transaction-list experience. This includes dashboard transaction
  lists, post-import review, import history, classification previews, and
  **Review unclassified**. The full-page Transactions list follows the same core
  contract while adding its all-time query, summaries, and pagination.
- Keep the core structure and behavior synchronized across those variants:
  shared transaction rows and badges, description search, the Filters popover,
  category/subcategory pairing, tag/account/provider filters, active-filter
  chips, and the combined sort control. Reuse helpers from
  `app/transaction-ui.js` instead of independently recreating row or sort
  behavior.
- Use `app/transaction-bulk.js` for selection, group filtering, explicit bulk
  actions, and the shared bulk-edit dialog. Each list integrates it with small
  data/revision/save adapters; never fork its editor for an individual page.
- Bulk selection is opt-in through Edit multiple. Select visible means only the
  currently shown rows (current page on Transactions). Preserve selection through
  filters/sorting and report hidden selected counts; reset when the underlying
  revision changes or a different collection opens. Import inclusion selection
  is independent: temporarily swap row checkboxes during bulk selection and disable
  final import confirmation until bulk selection ends.
- Bulk actions explicitly set only chosen user-editable fields. Offer tag Add,
  Remove, Replace, and Clear; preserve other tags for Add/Remove, unknown flags,
  untouched fields, and immutable createdAt. Dates and amounts may be set here
  (unlike automatic classifications), with explicit sign/same-value guidance.
- Require a before/after review and explicit confirmation. Existing-row edits
  validate the entire batch against one revision, create a safety snapshot,
  and atomically write once; invalid/stale batches and no-ops write nothing.
  Import and classification-preview bulk edits update only staged data. Their
  final source confirmation remains the sole durable-write action. Every cancel,
  close, Escape, and backdrop path discards the bulk draft.
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
  Transactions, Import data, Classifications, and Settings.
- Use the same menu across pages, clearly mark the current page, close it on an
  outside click or Escape, and return focus to the menu button after Escape.
- Organize Settings as accessible tabs, beginning with Exports. Add future user
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
  subcategory, accountName, accountType, provider, notes, tags, group, and supported flags. Notes are
  optional freeform text and may safely contain commas or line breaks.
- Tags are optional user-defined labels stored as a comma-separated list. Edit
  them as compact badges in transaction lists.
- Users can toggle the `refunded` flag in the transaction editor. A refunded
  transaction remains visible and retains its original date and amount for
  duplicate detection, but contributes zero to all dashboard calculations.
- Users can set an internal-transfer treatment from every shared transaction
  editor, including import review and import history. Keep automatic detection
  overridable in both directions.
- `createdAt` is system-managed and must survive edits unchanged.
- Migrate compatible older CSVs to the thirteen-column schema
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
  `Venmo`, `eBay`, `Apple Card`, and generic `CSV`.
- Present importer cards as accessible tabs with only one card visible at a time.
  Keep Credit Karma selected initially, support arrow/Home/End keyboard navigation,
  and preserve every importer's form and progress state while switching tabs.
- Do not show manual JSON file pickers or a shared exported-files section.
  Apple Card is the deliberate exception: its source tab accepts the official
  date-range CSV exported from `card.apple.com`.
- The generic CSV tab accepts exactly the Ledger schema without `createdAt`:
  `date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags`.
  Also accept the previous header without group, defaulting it to blank.
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
