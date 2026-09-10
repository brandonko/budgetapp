# Data storage, exports, and history

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

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
  flags. `flagged` is a follow-up marker only. Internal UI identifiers and derived properties such as
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

## Reconciliation invariants

The reconciliation invariants referenced above are in
[Saved relationships and reconciliation](reconciliation.md).
