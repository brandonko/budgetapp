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
- The fifteen persisted columns, in order, are:

  ```text
  date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,createdAt,id,links
  ```

- `flags` contains normalized, comma-separated identifiers. `refunded`,
  `internal-transfer`, and `include-in-budget` are supported budget-treatment
  flags. `refunded` is the
  first supported flag. Internal UI identifiers and derived properties such as
  `_id` and `_isBillPayment` must not be written as extra CSV columns.
- `createdAt` is an immutable UTC ISO 8601 timestamp shared by every row from
  one committed import. It is blank for manual and legacy transactions.
- `id` is a durable, unique, immutable transaction identifier, distinct from the
  revision-local integer `_id` used by existing editor endpoints. Use IDs in
  links, never row positions. Legacy IDs are assigned during a backed-up atomic
  migration; reads may derive temporary deterministic IDs but never write.
- `links` is a compact JSON array on the original positive-amount purchase,
  containing `{ "transactionId": "durable-credit-id", "type": "refund" }` entries.
  Allowed types are refund, transfer, repayment. See reconciliation invariants below.
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
- The optional `deploy/` workflow runs a LAN-only service in a separate Debian
  VM, explicitly binding port 8000 on all interfaces. Keep its persistent data
  in `/var/lib/ledger`, outside versioned code. Deploy the latest `main` only
  after regression tests, stop the app before a full data snapshot, and check
  startup. Failed startup must not silently restore data; preserve its backup
  and stop for operator review. This workflow does not add internet authentication.

## Amount conventions

The stored convention is expense-oriented:

- Debit expenses and purchases are positive.
- Credits, refunds, and income are negative.
- Amazon item purchases are positive.

Keep this backend convention because import, reconciliation, and CSV logic rely
on it. Translate it for people in the interface:

- Income is always displayed as a positive amount.
- Income summary/category cards can use green styling. Transaction rows instead
  show an explicit `+` before money received (income, refund, repayment, incoming
  transfer), e.g. `+$25.00`, without relying on green. Purchases remain `$25.00`.
  Determine direction from the expense-oriented effective amount, or the source
  amount for excluded rows; retain their muted strike-through and plus sign.
  Never change persisted signs or budget math to format a row.
- Total spent uses a neutral background.
- Net total is `income - spending`.
- A positive net is a surplus and uses a light-green background.
- A negative net means spending exceeded income and uses a light-red background.
- Refunds outside the `Income` category stay negative in storage and budget math
  and reduce their spending category, while rows show the received value with `+`.

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
  selected comparison years, comparison metric/chart mode, breakdown
  dimension, and annual category/subcategory filter in the browser so dashboard
  context survives navigation to any primary page.
  Validate restored values against the current transaction data and fall back
  safely when a saved selection is no longer available.
- Let users switch the monthly and annual spending breakdown between **By
  category** and **By tag**. Keep the selected dimension, selected tags, and
  Any/All match mode synchronized between views and persist them across navigation.
- In Monthly and Annual **By tag**, the three headline spending/income/net cards
  use the same selected-tag query within that period, including tagged income.
  Count each matching occurrence once even when tags overlap; preserve negative
  expense credits and zero-value refund/internal-transfer treatment. No selected
  tags or no matches means zero totals, never an unfiltered fallback. Switching
  to By category restores full-period totals. Keep the odometer animations and
  accessible exact values in sync with these filtered amounts. Tag-picker search
  only narrows the available buttons, not the current query or summary.
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
- Year-over-year comparisons always let each line continue through its own
  latest imported month. Never project future values or turn unavailable months
  into zero activity.
- Show exact cumulative or independent monthly values (matching the chart mode),
  period totals, changes from the prior selected year, and the newest year's
  monthly average. A spending or income
  point opens that month's matching transaction type in the shared dashboard
  dialog; a net point opens all budget-visible transactions for that month.
- Exclude refunded and internal-transfer values from all comparison math using
  the same zero-value rules as Monthly and Annual views. Keep excluded internal
  transfers available through the dedicated review action for the full range.
- Provide a **View all transactions** action for the selected period.
- A **Today** button in the dashboard header switches any view to Monthly with
  the device's current local month/year, computed on click (not at page load).
  Permit the current year even without imported rows and persist that selection.
  Keep the initial default as the latest budget-visible transaction month. Do
  not reset tag/category display preferences. Disable Today during data loading
  or error/setup states so it cannot bypass the required transfer review.
  Match its height and type size to the adjacent period dropdowns through shared
  responsive sizing; keep their edges aligned without a hover lift.
- All transaction-list dialogs default to date, latest first. Provide the shared
  sort control everywhere transactions are reviewed: Date, Description, or Cost,
  each ascending or descending. Cost sorting uses the absolute stored amount so
  expenses, credits, and income compare by dollar magnitude.
- Keep the dashboard transaction toolbar compact: description/notes search and a
  plain-language combined sort menu remain visible; category/subcategory and
  tag and account/provider live in an expandable Filters section. Keep category and subcategory
  adjacent, limit subcategory choices to the selected category, show an active
  filter count, and render applied filters as removable chips. Populate the tag
  filter from the distinct tags available in the current transaction list and
  match tag names case-insensitively. On narrow screens,
  stack each related pair and use the modal's full content width.
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
  `--viz-12`). Use the shared identity-based `createSeriesColorSlots` allocator,
  not a display-order index or label hash. Keep active groups, years, categories
  and subcategories in their existing slots when items are added, removed or
  reordered. New selections get the first available palette color; released
  slots may be reused, but never compact or recolor surviving selections.
  Start with the most distinguishable colors before secondary shades. Retain
  assignments across navigation in browser-local preferences, storing slots
  rather than literal colors so theme changes use the appropriate palette.
  Sync the full active set, not a search-filtered or individually drawn subset.
  Tag Explorer remains one combined series with its existing color; do not split
  overlapping tags into additive stacks. Each theme
  must provide the complete palette with at least 3:1 contrast against its
  surface; keep the palette uniqueness and primary-distance regression checks.

### All-time Transactions dashboard

- Keep **Transactions** as a primary destination at `/transactions`, separate
  from the period-based dashboard. Default to the entire transaction history
  with no date limits, and allow optional inclusive start/end dates.
- Support description/notes search, category/subcategory, account/provider, and
  multiple tags with Any/All matching. Combined tag results count each
  transaction exactly once, including when tags overlap.
- On Transactions, the tag picker and Any/All mode belong inside the existing
  Filters section, not a separate toolbar or nested popup. Tags use the same
  immediate-update behavior as the other filters; collapsing the section keeps
  selections. Include tags in the active-filter count and removable
  chips, and display the AND/OR mode beside chips when multiple tags are active.
  Let tag buttons wrap to their full height; the page itself scrolls. Do not add
  a capped-height or independently scrolling tag list or Filters panel.
- Do not show Refresh or Apply filters buttons on Transactions. Filter selections,
  tag modes, and Reset update results/totals locally and persist immediately,
  without refetching transactions on each change. Keep the last valid date range
  during incomplete/reversed date entry and show an inline validation message.
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

### Group comparison on Transactions

- Keep **Transactions** and **Compare groups** as two modes of the same page.
  Comparison is a read-only local view with its own group/date scope, independent
  of the browse description, tags, category and account filters. Persist the
  comparison separately in `ledger.group-comparison.v1`; never mutate the CSV
  while selecting groups, dates, a reference group, or a category drilldown.
- Allow two to four searchable, case-insensitively unique groups. One selected
  group may show its details while prompting for another. Do not infer group
  membership from legacy tags. Retain removed selected names as empty groups
  rather than silently comparing a different group.
- Use cent-based aggregation from `transactions-model.js`. Show spending less
  credits, excluding refunded/internal-transfer rows, and show income separately.
  Preserve occurrence counts. Distinguish missing activity (dash) from genuine
  zero totals. Show inclusive date scope, actual recorded activity spans, and
  dollar-only differences against a user-selectable reference; no percentages.
- Reuse the first four distinct theme visualization tokens consistently for
  chips, cards, common-scale horizontal spending bars, and category-table cells.
  Persist each selected group's slot in the comparison preferences. Removing
  an earlier group or adding an alphabetically earlier one must not recolor
  the other groups; the new group receives the first free slot. Each
  category uses a common scale across its group cells; support negative credits,
  blank categories, many categories, long group names, light/dark and narrow views.
- Drilldown delegates to the existing full-page transaction list and shared
  editor/bulk tools, not another independently implemented modal. Temporarily
  scope it to the chosen group, comparison dates and optional category. Back to
  comparison restores the previous browse query; successful edits/deletes
  recompute comparison totals. Keep the internal-transfer setup gate intact.

### Shared transaction-modal contract

- Treat every modal that presents a transaction collection as a variant of one
  shared transaction-list experience. This includes dashboard transaction
  lists, post-import review, import history, classification previews, and
  **Review unclassified**. The full-page Transactions list follows the same core
  contract while adding its all-time query, summaries, and pagination.
- Keep the core structure and behavior synchronized across those variants:
  shared transaction rows and badges, description/notes search, the Filters section,
  category/subcategory pairing, tag/account/provider filters, active-filter
  chips, and the combined sort control. Reuse helpers from
  `app/transaction-ui.js` instead of independently recreating row or sort
  behavior.
- Every top-level transaction row is a rounded rectangular card, including plain,
  edited, flagged, duplicate, and unmatched rows. Use equal padding, margins,
  rounded corners, and all four border edges, including the last row, across
  all modal variants, all-time Transactions, and bulk-delete review. Plain cards
  use `--surface-subtle` and the theme's `--line` border, never standalone row
  separators or hard-coded light colors. State highlighting changes only colors,
  not geometry. Edited unmatched rows retain their badges but lose the yellow
  fill, keeping the neutral card. Nested read-only counterparts (refund candidates
  and saved links) use compact, fully outlined inset cards with matching date,
  title, metadata, and amount layout. Use a 48px date track and a 64px-tall
  month/day/year block with a muted year; never squeeze a wider date into a 40px
  track. Scope description typography to direct children so it cannot restyle
  dates, amounts, or nested cards. Allow candidate metadata to wrap. Audit mixed
  states in both themes. Import refund controls are a row-level detail section:
  align below the description on desktop and use the full card width on mobile,
  rather than nesting a narrow purchase card inside the description column.
- All transaction search bars use the same literal, case-insensitive matcher
  from `transactions-model.js`, exposed by `transaction-ui.js`. A row matches
  when either its description or notes contains the query; count it once if
  both match. Collapse whitespace for matching (including multiline notes),
  but never rewrite stored notes. Blank queries include all rows and missing
  notes are empty. Retain the legacy `description` filter-state key for saved
  views; label the UI Search with a descriptions-and-notes placeholder. This
  does not change classification regex matchers or their rule-note semantics.
- Group belongs inside each list's **Filters** section, with All groups and No
  group choices, live filtering/Reset behavior, and an active-filter indicator. Keep its
  state with the page's other filters so Clear all and returning from edits work.
  Do not introduce a separate group-filter toolbar. Reuse the group helpers in
  `app/transaction-ui.js` for consistent names and matching.
- Filters expand in normal document flow below the search/sort bar and above
  the transaction list, never as floating overlays. Use `setTransactionFilterPanel`
  from `transaction-ui.js` and the shared panel/body CSS. List modals have a
  definite default height of 88dvh (capped at 960px), with their shell filling
  that height; do not let the rows collapse to their small flex basis. Expanding
  or collapsing filters must not resize the modal; only the space available for
  rows changes. Keep the same viewport margin in both states. This sizing
  does not apply to transaction editors. `.transaction-dialog-body` is a non-scrolling flex layout:
  `.transaction-dialog-controls` holds the toolbar, filters, chips and page-specific
  toggles, separately from the scrolling transaction-list sibling. Scrolling rows
  must never move the controls. Short screens may scroll controls independently,
  with a sticky search/sort toolbar inside that region. Preserve a nonzero row
  viewport, even for empty results, plus accessible header and confirmation footer.
  Clicking Filters or pressing Escape
  collapses the section without clearing selections; outside clicks do not.
  Keep this structure in dashboard, import, history, reconciliation, unclassified,
  and classification-preview modals; the all-time page uses the same in-flow panel.
- All shared transaction filter panels apply each selection and Reset immediately,
  without an Apply filter button or closing after a selection. Use the shared
  `bindLiveTransactionFilters` helper after dependency/reset handlers are wired.
  Closing does not revert valid filters. This is read-only view state, entirely
  separate from explicit import/classification/bulk-edit confirmation.
- Put **Edit multiple** in the modal header directly beneath its close button;
  on the full Transactions page, put it in the results header. Show selection
  controls only after entering edit mode, and use **Done editing** to leave it.
- Keep each row's **Edit** button available alongside bulk selection, including
  Review unclassified. Both Save and every cancel path return to the originating
  list with its filters/sort and classification drafts intact. A saved revision
  change resets bulk selection; cancellation preserves it. When an edited row
  gains a subcategory, remove it from the unclassified results. Settings history,
  transfer reviews and unclassified rows share one single-editor controller in
  `settings.js` and the field/picker/flag helpers in `transaction-ui.js`; keep the
  matching editor fields in `settings.html` and `classifications.html` in sync.
  Explicitly read-only proposal rows remain read-only, and import/transfer edits
  stay staged until the source review is confirmed.
- Use `app/transaction-bulk.js` for selection, explicit bulk
  actions, and the shared bulk-edit dialog. Each list integrates it with small
  data/revision/save adapters; never fork its editor for an individual page.
- Bulk selection is opt-in through Edit multiple. Select visible means only the
  currently shown rows (current page on Transactions). Preserve selection through
  filters/sorting and report hidden selected counts; reset when the underlying
  revision changes or a different collection opens. Import inclusion selection
  is independent: temporarily swap row checkboxes during bulk selection and disable
  final import confirmation until bulk selection ends.
- Shared transaction checkboxes support Shift-click ranges for both bulk-action
  selection and staged import inclusion, using separate anchors and occurrence
  IDs. Apply the clicked checkbox's new state to the inclusive visible range
  from the last clicked checkbox, in displayed sort order. Never include hidden
  rows or other pages. Reset the anchor on a changed visible order, collection,
  revision, selection mode, Select visible, or Clear selection. Re-rendering the
  same rows retains it. Apply the entire range in one UI update (one import
  revalidation), without committing edits, imports, or deletions.
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
- Offer **Delete selected** beside Edit selected for saved transactions in the
  dashboard, all-time list, import history, and Review unclassified. Disable it
  for an empty selection. The shared confirmation lists every selected row,
  explicitly counts selections hidden by filters/pagination, and focuses Cancel.
  Cancel, X, Escape and backdrop dismissal preserve the rows and selection.
  Confirm deletes exact row occurrences in one revision-checked, locked atomic
  write after a safety backup; never loop over single-row delete requests or
  delete by date/amount. Preserve unselected rows, timestamps and transfer flags.
  Refresh summaries, pagination and import-history counts from the resulting
  state. Stale/invalid batches and failed backups must write nothing.
- Do not expose durable deletion from staged import, classification-application,
  or transfer reviews. Import rows are omitted by unchecking inclusion; keep
  them visible for review rather than removing them. Saved rows can be deleted
  from their normal transaction lists after closing a staged proposal.
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

Internal-transfer treatment is a durable decision, not a read-time calculation.
Never run reconciliation from `public_state`, transaction GETs, dashboards, or
other rendering paths. Imports and an explicit Settings scan propose pairs using:

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
6. Settings scans the complete database. Imports match only selected incoming
   occurrences against each other and existing eligible rows, across month/year
   boundaries. Never rematch already flagged rows or consume one side twice.

On unlinked legacy records, an `internal-transfer` flag excludes a row. An `include-in-budget` flag
prevents detection and forces the row to count normally. With neither flag, the
row counts normally and is eligible for future detection. The shared editor
exposes Eligible for detection, Internal transfer, and Count normally.

Confirmed pairs now use explicit `id`/`links` relationships. Legacy exact
two-member `transfer-pair-*` groups can be upgraded during schema migration or
restore, with a safety backup; never infer new matches at startup. Preserve
unpaired old exclusion flags and legacy refund receipts when a source is missing.
Links take precedence over budget flags. Disable legacy treatment controls while
linked and reject conflicting bulk/classification changes; unlink the original
purchase first. Description edits never break links. Explicit deletion removes
dangling references and restores surviving transactions' remaining net/source
amount; preserve follow-up flags and unrelated fields. Warn about this in delete
confirmations and always make a safety backup.

Relationships form disjoint shallow stars: refunds and transfers are one-to-one;
repayments allow up to 500 negative credits against one positive purchase. A
credit has one owner and cannot itself own links. Reject missing IDs, duplicate
IDs, self-links, reused credits, chains, cycles, wrong signs and unbalanced
transfer pairs. Transfers require different accounts and opposite nonzero amounts.
Partial refunds and repayments retain the residual cost; overpayments may yield
a negative net expense. Preserve every original date, amount and createdAt.

Budget calculations use a linear projection of these saved links, NOT detection:
the purchase contributes the sum of itself and its linked credits, attributed to
its original date/category/tags/group. Linked credits contribute zero, even if
categorized Income, but remain visible on their posting dates. Apply this to
monthly, annual, YoY, tag totals, all-time totals and group comparisons. Shared
rows display the root's net cost and an expandable full-width section of shared
read-only source rows. Fully refunded/transfer/linked-credit amounts retain their
original values with grey strike-through styling. The shared editor's collapsed
Refunds & repayments section searches credits by description/notes and stages
links until its own save and any enclosing review confirmation.

Both sides use the shared **Refunds & repayments** editor with an explicit link
type selector and shared transaction cards for selected records and search results.
Infer the role from stored signs: positive is the original expense, negative is
money received. Expense-side repayments allow several credits; credit-side editing
allows exactly one expense. Refunds/transfers are 1:1; only transfers must balance
exactly and cross accounts. Enforce these constraints in both UI and backend.
Support the legacy request-only `repaymentTo` intent and the generalized `linkTo`
object (`transactionId`, `type`; blank ID unlinks), resolving either atomically
into purchase-owned `links`, never a second CSV relationship or child-owned link.
Reject conflicting intents. Preserve other repayments, immutable IDs/createdAt
and source amounts. An explicit credit-side link edit can change/unlink an existing
refund or transfer; legacy repayment-only requests must not silently repurpose one.
Remap reverse targets in forced import copies. Import previews resolve intents without
writes, bind the canonical proposal to the confirmation digest, and apply only
selected rows. A canceled or unchecked repayment cannot modify an existing purchase.

CSV exports include the full linked family even outside the selected dates;
the displayed count must include these counterparts. Accept old headers without
id/links, and assign fresh IDs to forced imported copies while remapping their
links. Incomplete linked import selections are rejected clearly, never silently
converted to unlinked financial records. Occurrence-aware date/amount duplicate
matching remains independent of durable IDs.

Import proposals must show existing counterpart rows that will be flagged,
not just incoming rows. Recompute proposals after edits, checkbox changes, and
force-including duplicates. Bind confirmation to both the CSV revision and the
exact reviewed transfer plan; reject stale/unseen matches. Save selected incoming
rows and reviewed existing-side flags in one atomic write, with a safety backup
for an existing database. Keep existing createdAt and all unrelated fields intact.
All cancel paths write nothing; discard stale asynchronous preview responses.

Settings → Reconcile provides Find matches and a staged
review using the same transaction modal, filters, sort and bulk/single editor as
import history. It displays before/after changes, requires explicit confirmation,
and makes a safety backup before writing. A no-op scan must not rewrite the CSV.
The optional **Match nonzero decimal** checkbox (off initially) excludes whole-dollar
amounts from both transfer and refund suggestions for that scan. It never hides
saved links or prevents explicit manual linking. Validate the boolean at the API
boundary and bind it into the review digest; preserve it through edits and confirmation.
Keep the Settings card compact: explain matching, confirmation, and legacy-data
reviews in the shared expandable info-panel style used by Import and Classifications.
Also suggest exact-opposite credits matching a purchase within the preceding
90 days. Refund suggestions require an explicit purchase choice and final review
confirmation. Multiple price matches must not silently pick the first candidate.
Expandable refund suggestions display shared, read-only transaction rows with
an explicit **Link selected purchase** button BELOW the candidates. Radio selection
only chooses; the button stages a link, and **Save reviewed changes** persists it.
Show **Refund link staged** and an undo action while pending. Preserve candidate
choices and disclosure state across flagging, filtering, and successful refreshes;
reset them on cancel/new review. When edited rows overlap `refundSuggestions`, merge
their `_refundCandidates` metadata instead of dropping it during deduplication.
The review's type toggles reuse the import filter buttons: To review on,
Already reconciled off by default. Show unchanged saved links/exclusions only when
Already reconciled is enabled; never add them to the write plan just for viewing.
Editing one moves it into proposed changes with a before/after preview and the
same staged confirmation/cancel semantics. Type toggles compose with all shared
search/filter/sort controls, reset on a new review, and stay hidden in import history.

Legacy databases need one explicit full-database review before dashboards show
totals under the new saved-only policy. Do not silently migrate financial flags
at startup or on GET. A successful review records version 1 in the CSV-adjacent
`<stem>.transfer-review.json` marker. Fresh databases created by a confirmed
staged import are already reviewed. The marker is only upgrade bookkeeping;
CSV links and legacy flags remain the source of budget treatment. Historical exports or
restores without saved flags can be scanned again through Settings.
During the initial upgrade scan only, an already manually excluded row without
pair metadata can still identify its old automatic counterpart, preserving legacy
matching. Never reuse a persisted pair or override an explicit Count normally.
The obsolete `/api/import` upload endpoint rejects proposed transfer matches and
directs clients to staged import sessions; it must never apply unseen pair changes.

Excluded rows do not affect monthly or annual category cards, subcategories,
charts, breakdown tables, spending, income, or net totals. They must remain
accessible and editable through **View X excluded internal transfer
transactions**. Preserve and display the original stored amount in muted text
with a line-through, while continuing to use a $0 budget amount.

## Transaction editing

- Category, subcategory, account name, account type, and provider use the shared
  searchable value picker from `transaction-ui.js` in every single and bulk
  transaction editor. Opening shows existing values, an explicit blank choice,
  and an inline Add new action; typing filters values or offers creation.
  Normalize new names' whitespace and reuse case-insensitive existing names.
  Preserve untouched legacy values exactly; never change CSV schema for a new
  dropdown value. Option sources include the full database, staged review rows,
  and saved taxonomy. Subcategories follow the selected category while retaining
  the current value; do not implicitly clear it or change other account fields.
  With Category blank, search subcategories across all transactions and saved
  taxonomy. Choosing a known subcategory fills its parent category; for multiple
  parents use the first category in the dropdown's alphabetical order. Do not
  replace a nonblank category or infer a parent for a brand-new subcategory.
  Infer only on explicit selection, never on editor open, typing or Cancel.
  Bulk editors visibly add/fill the Category action when none is selected; both
  fields remain staged until the normal before/after confirmation.
  Keep Arrow keys/Enter, Escape, focus/blur and light/dark styling consistent.
  New choices are editor-local drafts until the enclosing save/confirmation;
  Cancel must not add taxonomy entries or leak draft choices to another row.

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

- Keep browser-authenticated Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card access in the companion
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
  Migrate the former Credit Karma refund opt-out when no global preference exists.
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
- **Settings → Preferences** exposes **Suggest refund matches**, on by default,
  remembered per browser and snapshotted/validated as a boolean in every source's
  session, including generic CSVs. Do not render a Credit Karma-only checkbox.
  Suggestions use eligible negative parsed credits from every importer when on,
  and none when off; a completion payload cannot override the session's choice.
  When on, Credit Karma retains merchant credits despite Amazon/AliExpress/Venmo/eBay/Walmart exclusions;
  do not infer direction from a raw amount's sign. The legacy standalone parser
  keeps its default filtering unless `match_refunds=True` is explicitly supplied.
- Refund proposals use exact opposite cents and saved, positive, non-income,
  non-refunded, non-internal-transfer purchases within the previous 90 days
  (inclusive). Rank same-account/provider candidates first, then most recent.
  Amount alone is not proof: never auto-confirm a suggestion. Partial/combined
  refunds and purchases still in the incoming batch are not guessed.
- Show refund proposals as additive detail content in the shared transaction row
  (`transaction-ui.js`), not a separate list implementation. A compact **Mark as
  refunded** button with an adjacent chevron keeps the explanation and matched
  purchase rows collapsed by default. Render candidates with the shared row
  renderer, read-only. Multiple matches require an explicit radio choice; never
  silently choose the first. Keep expanded state through review refreshes.
  **Mark as refunded** stages one explicit purchase choice, disables the credit's
  inclusion checkbox, and offers **Undo match**. The final import confirmation
  can save refund-only changes even with zero rows selected; otherwise zero
  selected remains disabled. Cancel/close/backdrop/Escape never persist changes.
  Editing a credit discards only its pending refund choice and revalidates it;
  changing only its follow-up flag preserves the pending refund choice.
- Keep eligible refund provenance and original credit identity server-owned in
  the import session. Validate one-to-one staged/purchase IDs, reject duplicate
  source occurrences and also-imported credits, and bind choices to the reviewed
  CSV revision and proposal digest. Exclude the chosen purchases from transfer
  pairing in that import proposal only; do not change other refund/transfer rules.
- New refund confirmations save the actual source credit plus an explicit refund
  link on the purchase, atomically with selected additions after a safety backup.
  Preserve purchase amount/date, notes, tags, group, unrelated flags and createdAt.
  The linked credit is retained even though its standalone import checkbox is off.
  Legacy `refund-receipt-YYYY-MM-DD-<positive cents>` flags still contribute omitted
  credit identities to date/amount deduplication, alongside real credit rows;
  do not create new receipt flags or fabricate historical missing credit records.
  Stable staged IDs, not display sort, allocate repeated source occurrences.
  Show handled credits as unchecked duplicates with **Refund already handled**.
  Preserve receipts through normalization, edits, export/restore, and manually
  clearing `refunded`. Deleting the purchase also deletes its receipt.
- Preserve category and account metadata.
- When its filter is enabled, ignore descriptions containing `amazon`,
  case-insensitively.
- When its filter is enabled, ignore AliExpress transactions by matching
  `alipay` case-insensitively; also accept `aliexpress` and `ali express` as
  defensive aliases.
- When its filter is enabled, ignore descriptions containing `venmo`, case-insensitively.
- When Credit Karma and Amazon files are uploaded together, infer the Amazon
  payment account from the most common ignored Amazon card transaction.

### Walmart ingestion

- Walmart is part of the existing companion extension (minimum 0.9.1), isolated
  under `walmart_extension/`. Limit its host permission to `https://www.walmart.com/*`.
  Drive the site's actual history pagination and passively observe only its
  PurchaseHistoryV3 responses. Never replay signing headers, bypass challenges,
  or expose cookies, addresses, or payment data to Ledger.
- Export minimal versioned receipt JSON directly into a source-scoped, expiring
  staged session. Preserve the existing shared review, classifications, transfer
  proposals, occurrence-aware deduplication, revision checks, and confirmation.
- Dates are inclusive original order dates, including the source calendar date
  from timezone-bearing timestamps. Default to the usual fourteen-day lookback.
- Use Shopping and blank subcategory before rules; editable account defaults
  are Walmart / CREDIT CARD / Walmart. One row per charged receipt line; quantity
  is already included in lineTotal. Prefer the charged categories tree over the
  duplicate flat ordered-items view. Preserve legitimate identical item lines.
- Allocate the final USD receipt total including tax, fees, tips, and discounts
  using integer-cent largest remainders. Never apply Amazon's estimated tax rate,
  infer missing prices, or silently invent refund dates. Cancelled, pending, and
  returned/refunded orders are reported as skipped inside review, with instructions
  to retain/import their bank entries. Membership fees are not order receipts.
- Walmart Credit Karma exclusion defaults ON, like the other merchant filters;
  users can turn it off for an individual import. It matches case-insensitive walmart / wal-mart / wal mart /
  wm supercenter substrings after whitespace collapse. Keep the exact strings
  visible, warn about uncovered charges, validate the boolean server-side, and
  preserve the choice in the source session. Other merchant filters are unchanged.
- Fail clearly on unfamiliar receipt/pagination formats, repeated pages, timeouts,
  and page/payload limits. No partially collected export should look successful.
  Synthetic regression tests cover receipt parsing, cents/quantities, privacy,
  pagination, session ownership, cancellation, and staged confirmation. A fixture
  pass is not evidence that the user's current signed-in Walmart site works.

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

### Capital One ingestion

- Keep it isolated in `capitalone_extension/`, minimum companion 0.9.1. Use only
  verified.capitalone.com and myaccounts.capitalone.com; no wildcard banking
  permissions, password/MFA automation, cookie extraction, or guessed private API.
- The user signs in and selects one account. Attempt only recognizable export
  controls with explicit dates and confirmed CSV selection. Unknown forms need
  manual interaction; keep passive CSV capture active and offer a file fallback.
  Never claim synthetic tests prove a current signed-in bank UI works.
- Source capture is armed only for the owned tab and active nonce; normalize CSV
  to allowed transaction fields before relaying it. Discard account/card numbers,
  balances and posting dates. No raw exports or credentials in extension storage;
  short-lived job metadata lives in session storage. Resume document navigation,
  reject stale document nonces, wrong tabs/frames/origins and late cancellation.
- Parse credit Debit/Credit columns or bank Transaction Amount/Transaction Type
  columns. Explicit Debit means expense-positive, Credit means negative. Preserve
  every identical occurrence. Reject malformed/ambiguous rows as a whole; no
  guessed signs or silent partial imports. USD only; no currency conversion.
- Range-filter on inclusive Transaction Date, including manual CSV. Source
  categories survive or default to Uncategorized; subcategory starts empty.
  Saved classifications, transfer proposals and occurrence-aware dedup all use
  the shared staged pipeline; the extension never calls commit.
- Editable defaults: Capital One / CREDIT CARD / Capital One. Users choose BANK
  for checking/savings. Reuse the shared transaction review unchanged. Cancel,
  X, Escape, backdrop and late asynchronous responses must never write/reopen it.

### Schwab checking ingestion

- Companion 0.11.0+, isolated in `schwab_extension/`, with only
  `https://client.schwab.com/*` added as a source host. The user signs in,
  selects one checking account, chooses the requested history range, and exports
  CSV. Capture remains passive: no guessed account selectors, private APIs,
  request replay, or authentication automation. Live site verification remains
  necessary; synthetic fixtures do not establish current website compatibility.
- Use editable Schwab Checking / BANK / Charles Schwab defaults. Reuse a distinct
  account name for each checking account; import accounts in separate runs.
  Brokerage and retirement activity are outside this importer’s scope.
- Accept explicit Withdrawal/Deposit columns, including Withdrawal (-) and
  Deposit (+), with Date, Type and Description. Preserve identical occurrences.
  Withdrawal means expense-positive; Deposit means negative. No signed-amount
  guesses, non-USD currency, ambiguous amounts, or silent malformed-row skipping.
  When Status is supplied, accept Posted and skip/report Pending; reject others.
- Some current exports include posted INTADJUST rows with both amount cells
  blank. Skip/report only these known amount-less interest entries, never invent
  zero or reconstruct amounts from balances. Explicit zero remains a valid row;
  missing amounts on other types or two nonzero amounts must still fail safely.
- Default to Uncategorized except TRANSFER (Transfer) and INTADJUST deposits
  (Income), then apply classifications. Keep rebates as credits. Range-filter
  inclusively by source Date. Review, transfer proposals, duplicate rules,
  confirmed backups, revision checks and atomic persistence remain shared.
- Strip export account titles, balance/check-number columns, and other unneeded
  fields in the isolated collector before transmission. Preserve descriptions.
  Credentials stay in Chrome. Only short-lived owned job metadata is stored;
  source tokens never reach Schwab URLs or logs. Cancel, stale documents, closed
  tabs and late exports cannot commit or resurrect a discarded review.
- Keep the existing cross-account date/amount duplicate rule and explain its
  collision limitation in the Schwab tab. Do not add account identity to the key
  or introduce persistent account identifiers as part of this source addition.

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
- After each completed and verified batch of app changes, restart the running
  Ledger backend as requested by the user, preserving the requested port/binding
  (currently LAN access on `0.0.0.0:8000`). Do not stop unrelated processes.
  Mention the restart; in-progress, unconfirmed reviews are not persisted.
- Keep `README.md` and this file current when behavior or preferences change.
