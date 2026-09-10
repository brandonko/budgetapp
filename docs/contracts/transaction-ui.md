# Shared transaction lists and editing

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Shared list behavior

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
- Users can toggle the `refunded` flag on unlinked transactions in the editor.
  Such a row remains visible and retains its original date and amount for
  duplicate detection, but contributes zero to all dashboard calculations.
  Linked transactions instead use their saved relationship's effective amount;
  unlink before changing budget treatment.
- Users can set an internal-transfer treatment from every shared transaction
  editor, including import review and import history. Keep automatic detection
  overridable in both directions.
- `createdAt` is system-managed and must survive edits unchanged.
- Migrate compatible older CSVs to the fifteen-column schema, with validated
  IDs and links, through a backed-up atomic migration; never require users to
  recreate an existing database.
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
