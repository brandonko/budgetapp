# Common change guides

Start with [the project context](../llm_context.md), the affected contract, and
the [architecture map](architecture.md). These recipes describe the current
implementation paths; they do not approve new financial policy or relax a
contract. Use synthetic examples and temporary databases throughout.

For each change, state the user-visible outcome, identify the owning module and
shared consumers, then verify behavior at the relevant boundary. Run the unified
checks described in [development](development.md) before finishing. Update the
owning contract and user workflows when behavior changes; update the architecture
map when responsibility moves.

## Add an importer

Read [shared imports](contracts/imports.md),
[source policies](contracts/import-sources.md), and the closest existing source's
extension README. First specify the input shape, source dates, amount direction,
currency, account defaults, duplicate occurrences, and explicit skipped/error
cases. An unknown financial interpretation needs a product decision, not a guess.

1. Add a bounded parser in [importers.py](../app/importers.py), or a cohesive source
   module when its parsing responsibility warrants one. Use synthetic exports
   covering purchases, credits, repeats, malformed input and applicable limits.
   Preserve source-specific skip rules; reject unsupported or ambiguous data
   clearly. Keep file writes and browser credentials out of the parser.
2. Register the source in [server.py](../app/server.py): source labels/defaults,
   allowed session/action routes, session validation and completion parsing. The
   historically named `create_amazon_import_session`,
   `complete_amazon_import_session` and `commit_amazon_import_session` implement
   shared source-aware behavior. Reuse their review/confirmation path and current
   lock/revision/backup protocol. The extension must never call commit.
3. Add source form controls in [upload.html](../app/upload.html) and adapters in
   [upload.js](../app/upload.js). Reuse preference defaults, staged rows, shared
   editor/list controls, progress and cancellation. Add to the searchable source picker
   and supported-source displays without creating another review implementation.
4. For browser ingestion, isolate source capture under
   `ledger_data_importer_extension/<source>_extension/`, connect it through the
   shared coordinator/bridge, and audit `manifest.json`, source allowlists and
   launcher labels. Use the narrow supported hosts and separate execution worlds.
   Normalize to required source fields before transmission; keep credentials,
   unneeded account details and raw browsing state out of Ledger and fixtures.
5. Verify both parser behavior and the session lifecycle: preview without writes,
   selected-only commit, duplicate counts, stale confirmation, source mismatch,
   cancellation, late replies, and missing-database initialization. If amounts can
   participate in refunds/transfers, cover their shared proposal path as well.

Examples to extend are [CSV import tests](../tests/test_csv_import.py),
[Schwab import tests](../tests/test_schwab_import.py),
[Schwab extension tests](../tests/test_schwab_extension.js), and
[execution-world tests](../tests/test_extension_worlds.js). Keep source-specific
fixtures independent of private exports. Document which live website behavior is
still unverified; synthetic checks cannot establish current bank/site markup.

## Add or change a transaction field

Read [the CSV contract](contracts/data-and-safety.md#canonical-database),
[editing](contracts/transaction-ui.md#transaction-editing), and
[saved relationships](contracts/reconciliation.md). Decide whether the value is
durable transaction data, a derived response property, or a temporary UI draft.
Temporary properties such as an Edited badge must not become CSV columns.

1. For an approved persisted field, update `COLUMNS`, applicable compatible import
   headers, normalization and the backed-up migration in
   [server.py](../app/server.py). Define a safe default for older rows and verify
   existing CSVs are preserved through migration. Keep IDs and `createdAt`
   immutable. A new derived property should stay out of persistence instead.
2. Trace every transport: source parsing/defaults, generic CSV import and export,
   manual create/edit, bulk edits, classification actions when applicable, backup
   restore, and public responses. An absent field and an explicit blank may have
   different meanings; retain that distinction. Do not add a classification action
   merely because a field is editable manually.
3. Add shared fields and validation to
   [transaction-ui.js](../app/transaction-ui.js) and, when supported,
   [transaction-bulk.js](../app/transaction-bulk.js). Audit the editor markup in
   dashboard, Transactions, upload, Settings and Classifications. Preserve drafts
   until the enclosing save/confirmation; every editor cancel returns in context.
4. Verify a synthetic row can round-trip through supported paths without changing
   unrelated fields, signs, timestamps, IDs or links. Cover the relevant legacy
   header/default and invalid-input cases, plus stale revision and failed-write
   behavior when the persistence path changes. For UI controls, check staged edits
   and cancellation in the shared surfaces they affect.

[Group/bulk tests](../tests/test_groups_bulk.py),
[CSV tests](../tests/test_csv_import.py),
[reconciliation tests](../tests/test_reconciliation.py), and
[dashboard editor tests](../tests/test_dashboard_edit_flow.py) provide existing
patterns. Add behavior assertions for the field, rather than testing that the
new implementation happens to contain a particular source string.

## Change budget calculations

Read [amount conventions](../llm_context.md#amount-conventions),
[reconciliation](contracts/reconciliation.md), and
[reporting](contracts/reporting.md). Write the expected numbers for a small
synthetic example before changing code: purchase, ordinary negative expense
credit, Income, excluded transfer, partial refund and several repayments. Include
overlapping tags and different posting months when the change affects those views.

Start at [reconciliation.py](../app/reconciliation.py) for saved-link projection
and [transactions-model.js](../app/transactions-model.js) for query aggregation.
Audit the related treatment logic in [transaction-ui.js](../app/transaction-ui.js)
and dashboard calculations in [app.js](../app/app.js). Preserve stored signs and
source amounts while calculating effective amounts; explicit user edits to an
amount still follow normal mutation validation. Never run matching on GET/render.

Check the same expected totals through Monthly, Annual, year-over-year, tag views,
Transactions and group comparison where applicable. Counts preserve occurrences;
pagination and overlapping tags must not change the total. Retain integer-cent
aggregation in the model. Extend [model tests](../tests/test_transactions_model.js),
[dashboard tag tests](../tests/test_dashboard_tag_summary.js), and the relevant
Python reconciliation/transfer tests. Compare observable results across consumers
when changing duplicated logic; passing one consumer's test is insufficient.

## Change shared transaction UI

Use [the shared modal contract](contracts/transaction-ui.md#shared-transaction-modal-contract)
as the complete consumer list. Implement compatible rows, badges, filters, sorting,
pickers and selection behavior in the shared UI/model/bulk helpers. Keep each
page's data, revision and save/staging adapter explicit.

Audit dashboard, Transactions, import review, import history, reconciliation,
classification preview and Review unclassified, plus read-only nested rows. Check
existing and staged transactions separately: saved follow-up flags batch-save on
close, while staged flags wait for the source's final confirmation. Filter changes
are view state and do not grant permission to save a proposal.

Exercise the changed interaction with realistic synthetic rows in desktop/mobile
and light/dark views. Include long notes/descriptions, empty results and active
filters when they affect layout. Assert user-visible behavior and writes/cancel
outcomes, then inspect rendered controls and scrolling. Existing structural tests
help find a missed consumer; they do not substitute for exercising a browser.

## Refactor without changing behavior

1. Name the current problem and the boundary to improve: for example, extracting
   classification evaluation from HTTP coordination so it accepts rows and rules
   directly. Use actual coupling or repeated changes as evidence. Avoid file-size
   targets, blanket rewrites and abstractions for hypothetical callers.
2. Establish the affected behavior with existing focused checks. Add a regression
   for an uncovered financial/persistence risk, or a characterization example for
   a behavior that the extraction could change. Confirm expected values from the
   product contract; freezing an existing bug is not a valid product decision.
3. Move one cohesive responsibility and update its callers. Keep arguments and
   results explicit, preserve error behavior, and keep HTTP/file/DOM side effects
   at their existing boundaries. Prefer an existing shared module when it already
   owns that responsibility. Preserve script order and the static-file allowlist
   when extracting browser code.
4. Run focused checks after the move and the unified verification command before
   finishing. Check the full write protocol when persistence/session code moves;
   inspect rendered consumers when UI controllers move. Keep unrelated feature
   changes out of the extraction so a reviewer can assess behavioral equivalence.
5. Update the architecture map, fix all caller/document links, and report what
   became easier to change plus the verification performed and remaining limits.
   Keep a newly discovered product-policy change explicit instead of folding it
   silently into the refactor.
