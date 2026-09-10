# Architecture and change ownership

Use this map to find the existing owner before adding behavior. Product decisions
belong in [the project context and its contracts](../llm_context.md); this document
explains where they are implemented. [Change guides](change-guides.md) connect
common requests to the affected code and checks. Update this map when ownership
actually changes.

## Runtime and data flow

Ledger has three runtime boundaries: a Python HTTP server, browser pages served by
that server, and the separate Chrome companion extension. The application has no
third-party runtime dependencies or frontend build step. Node.js and optional
browser test tools are contributor tools; see [development](development.md).

The canonical CSV is the durable transaction database. The server validates and
projects saved transactions for browser queries. Browser filters and charts derive
views from that response; they do not trigger financial matching. Import files or
extension-normalized source data go through server parsing, classifications,
occurrence-aware duplicate review, and explicit confirmation before a CSV write.
Transfer/refund suggestions are proposals; durable links express confirmed choices.

## Backend ownership

| Responsibility | Current owner and useful entry points | Boundary to preserve |
| --- | --- | --- |
| HTTP routes, request limits, import sessions, revisions and mutation coordination | [server.py](../app/server.py): `BudgetRequestHandler`, `read_json_body`, `data_lock`, `amazon_import_lock` | All callers, including the extension, are untrusted. Historical `amazon_import_*` names also serve other sources; inspect their `source` argument before introducing another workflow. |
| CSV schema, normalization, migrations, backups and atomic replacement | [server.py](../app/server.py): `COLUMNS`, `COMPATIBLE_COLUMNS`, `normalize_transaction`, `read_transaction_state`, `migrate_transaction_schema`, `create_backup_copy`, `write_transactions_atomic` | The write helper does not supply the complete mutation protocol by itself. Callers still own validation, the lock, revision checks, and required pre-write backup. Reads must not silently mutate data. |
| Import normalization and source-specific interpretation | [importers.py](../app/importers.py): `parse_*`, `ImportDataError`; [server.py](../app/server.py): `parse_ledger_import_csv`, `normalize_imported_transaction` | Parsers return source rows and source-specific diagnostics. Reuse the staged server workflow for classification, deduplication and persistence. |
| Classification policy and saved taxonomy | [server.py](../app/server.py): `normalize_classifications`, `validate_classification_regex`, `classify_transactions`, `normalize_taxonomy`, and their load/write helpers | Preserve field-level validation and atomic document writes. Editing a rule or taxonomy value does not implicitly reclassify transactions. |
| Durable IDs, link validation and effective budget amounts | [reconciliation.py](../app/reconciliation.py): `identified`, `validate`, `validate_mutation`, `decorate`, `export_closure` | Keep this domain logic separate from HTTP and file I/O. Source amounts remain stored; projection applies saved relationships. |
| Transfer and refund suggestions | [transfers.py](../app/transfers.py): `find_pairs`, `proposal`; [refunds.py](../app/refunds.py) | Detection belongs to import review or explicit reconciliation. Preserve one-to-one candidate use and legacy refund receipt handling. |

For any durable mutation, trace the complete handler from request validation to
its response. Identify where it reads the current revision under the data lock,
validates the proposed whole result, creates any required safety snapshot, and
atomically replaces the CSV. Check no-op, stale, invalid and failed-backup paths
alongside success. Preview and commit must refer to the same reviewed rows and
proposal; keeping those names in separate functions is insufficient by itself.

## Frontend ownership

| Responsibility | Current owner | How pages use it |
| --- | --- | --- |
| Pure search, filtering, cent-based totals and group comparison | [transactions-model.js](../app/transactions-model.js) | `LedgerTransactionsModel` is also loadable by Node tests. Keep calculations free of DOM, storage and network side effects. |
| Shared rows, badges, sort controls, filters, pickers and transaction editor fields/links | [transaction-ui.js](../app/transaction-ui.js) | `LedgerTransactionUI` renders shared behavior with page-specific options. Search delegates to the model. |
| Bulk selection, edit/delete review and queued follow-up flags | [transaction-bulk.js](../app/transaction-bulk.js) | `LedgerTransactionBulk.create` receives each page's rows, revision and save/staging adapters. Import inclusion is a separate selection. |
| Monthly, annual and year-over-year reporting | [app.js](../app/app.js), [index.html](../app/index.html) | Dashboard state, calculations, charts, drilldowns and editor orchestration currently live together here. |
| All-time Transactions and group comparison | [transactions.js](../app/transactions.js), [group-comparison.js](../app/group-comparison.js), [transactions.html](../app/transactions.html) | Controllers use the model and shared UI; comparison drilldown returns to the existing transaction list. |
| Import forms, progress and staged review | [upload.js](../app/upload.js), [upload.html](../app/upload.html) | Source forms add controls around one shared review, editing and confirmation experience. |
| Settings and Classifications | [settings.js](../app/settings.js), [settings.html](../app/settings.html), [classifications.html](../app/classifications.html) | Both pages currently load this controller. History, reconciliation and unclassified rows also share its single-editor controller. |
| Theme, preferences, navigation and common styles | [theme.js](../app/theme.js), [navigation.js](../app/navigation.js), [styles.css](../app/styles.css), [transaction-tools.css](../app/transaction-tools.css) | Preserve theme initialization order, shared tokens, accessible navigation and list layout across pages. |

The [shared transaction contract](contracts/transaction-ui.md) is the audit list
for dashboard, Transactions, import review, import history, reconciliation,
classification preview and Review unclassified. Nested linked rows and refund
candidates also use the shared row renderer, with read-only controls. Shared
presentation changes go through these helpers; page-specific selection and final
confirmation remain in their adapters.

Budget treatment currently has related implementations in `reconciliation.py`,
`transactions-model.js`, `transaction-ui.js`, and dashboard calculations in
`app.js`. The model explicitly notes its treatment-precedence relationship to the
UI. A budget change must check their observable agreement; do not assume using a
shared row renderer also shares every total calculation.

When adding or moving a browser module, update the server's `STATIC_FILES`
allowlist and every consuming HTML page's script order. A file existing on disk
does not make it available through Ledger's HTTP server.

## Extension ownership

[The shared extension guide](../ledger_data_importer_extension/shared/README.md)
maps `ledger_bridge.js`, `import_coordinator.js`, exact-origin trust helpers,
connection settings and the launcher popup. Source collectors and source-specific
coordinators live in sibling `<source>_extension/` directories. The
[manifest](../ledger_data_importer_extension/manifest.json) defines permissions,
execution worlds, injection order and the actual service-worker/popup entry points.

Keep browser credentials and cookies in the extension. Source collectors emit only
the supported normalized data to the shared session workflow. The page bridge and
worker validate origin, tab/frame, session and cancellation boundaries; the server
validates the received source data again. Test the manifest's real loading paths,
including MAIN/ISOLATED separation and repeated script-path handling. A mocked
collector passing does not establish compatibility with a signed-in website.

## Safe places to extract behavior

Extract a cohesive responsibility when a change exposes repeated logic, hard-to-test
side effects or unrelated state dependencies. State the concrete benefit and keep
the affected behavior covered during the move. File length alone is not a reason
to split code, and a refactor is not permission to change product behavior.

Current opportunities include moving a self-contained classification or persistence
responsibility out of `server.py`, separating the Settings and Classifications
controllers behind their existing editor adapters, and moving a dashboard
calculation into an existing pure model. These are possible seams, not completed
refactors or a mandatory rewrite plan. Preserve transaction boundaries, DOM/script
initialization and imported function interfaces while narrowing dependencies.

Keep abstractions concrete: explicit rows, revisions, options and results are
easier to inspect than a general plugin/registry system without multiple actual
callers. Add a new layer only when it reduces demonstrated coupling. Use the
[safe-refactor guide](change-guides.md#refactor-without-changing-behavior) for the
before/after evidence and verification steps.
