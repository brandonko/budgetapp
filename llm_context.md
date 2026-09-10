# Ledger project context

This document records the product and implementation preferences that should
guide future work on Ledger. Update it whenever a decision changes.

Read the core invariants below for every change, then follow the topic index for
the affected behavior. The linked contracts are authoritative parts of this
context; keeping a short entry point does not make them optional for relevant work.
Update the owning contract when a decision changes, rather than adding a second
policy copy here or in a directory instruction file.

For a user-facing explanation of the current linked-transaction schema,
Reconcile workflow, import preferences, and extension connections, see
[Current workflows](docs/current-workflows.md). Keep that guide and the main
README synchronized with the implementation and the invariants below.

Use the [architecture map](docs/architecture.md) to locate the owner of a change,
the [change guides](docs/change-guides.md) for common implementation paths, and
[development and verification](docs/development.md) for how to check the result.

## Financial and write boundary

The detailed rules live in the linked contracts. Every financial change must
preserve the canonical CSV, immutable transaction IDs and import timestamps, and
occurrence-aware date/amount deduplication. Budget projections use saved links
without rewriting source amounts; explicit amount edits use normal validation.
Durable mutations keep server validation, revision checks, serialized writes,
required safety backups, and atomic replacement. Staged imports and proposals
need their existing explicit confirmation; every cancellation path writes nothing.
Saved-list follow-up flags retain their documented batch-save-on-close behavior.
Never infer new transfer or refund matches while rendering saved transactions.
Read [data and safety](docs/contracts/data-and-safety.md),
[imports](docs/contracts/imports.md), [reconciliation](docs/contracts/reconciliation.md),
and the [shared UI contract](docs/contracts/transaction-ui.md) when touching these paths.

## Topic index

Existing links to the former sections still land here; each row leads to its
owning contract. Read related sections when a change crosses their boundaries.

| Topic | Authoritative contract |
| --- | --- |
| <a id="canonical-database"></a>Canonical database | [Data storage, exports, and history](docs/contracts/data-and-safety.md#canonical-database) |
| <a id="exports-and-safety-backups"></a>Exports and safety backups | [Data storage, exports, and history](docs/contracts/data-and-safety.md#exports-and-safety-backups) |
| <a id="import-history"></a>Import history | [Data storage, exports, and history](docs/contracts/data-and-safety.md#import-history) |
| <a id="categories-and-classifications"></a>Categories and classifications | [Categories and classification rules](docs/contracts/classifications.md#categories-and-classifications) |
| <a id="dashboard-periods"></a>Dashboard periods | [Dashboard and Transactions reporting](docs/contracts/reporting.md#dashboard-periods) |
| <a id="all-time-transactions-dashboard"></a>All-time Transactions dashboard | [Dashboard and Transactions reporting](docs/contracts/reporting.md#all-time-transactions-dashboard) |
| <a id="group-comparison-on-transactions"></a>Group comparison on Transactions | [Dashboard and Transactions reporting](docs/contracts/reporting.md#group-comparison-on-transactions) |
| <a id="shared-transaction-modal-contract"></a>Shared transaction-modal contract | [Shared transaction lists and editing](docs/contracts/transaction-ui.md#shared-transaction-modal-contract) |
| <a id="navigation"></a>Navigation | [Navigation and visual preferences](docs/contracts/navigation-and-appearance.md#navigation) |
| <a id="internal-transfers-and-credit-card-bill-payment-reconciliation"></a>Internal transfers and credit-card bill-payment reconciliation | [Saved relationships and reconciliation](docs/contracts/reconciliation.md#internal-transfers-and-credit-card-bill-payment-reconciliation) |
| <a id="transaction-editing"></a>Transaction editing | [Shared transaction lists and editing](docs/contracts/transaction-ui.md#transaction-editing) |
| <a id="upload-first-ingestion"></a>Upload-first ingestion | [Import review, browser ingestion, and deduplication](docs/contracts/imports.md#upload-first-ingestion) |
| <a id="direct-browser-ingestion"></a>Direct browser ingestion | [Import review, browser ingestion, and deduplication](docs/contracts/imports.md#direct-browser-ingestion) |
| <a id="credit-karma-parser"></a>Credit Karma parser | [Source-specific import decisions](docs/contracts/import-sources.md#credit-karma-parser) |
| <a id="walmart-ingestion"></a>Walmart ingestion | [Source-specific import decisions](docs/contracts/import-sources.md#walmart-ingestion) |
| <a id="amazon-parser"></a>Amazon parser | [Source-specific import decisions](docs/contracts/import-sources.md#amazon-parser) |
| <a id="aliexpress-and-venmo-account-metadata"></a>AliExpress and Venmo account metadata | [Source-specific import decisions](docs/contracts/import-sources.md#aliexpress-and-venmo-account-metadata) |
| <a id="import-deduplication"></a>Import deduplication | [Import review, browser ingestion, and deduplication](docs/contracts/imports.md#import-deduplication) |
| <a id="capital-one-ingestion"></a>Capital One ingestion | [Source-specific import decisions](docs/contracts/import-sources.md#capital-one-ingestion) |
| <a id="schwab-checking-ingestion"></a>Schwab checking ingestion | [Source-specific import decisions](docs/contracts/import-sources.md#schwab-checking-ingestion) |
| <a id="american-express-ingestion"></a>American Express ingestion | [Source-specific import decisions](docs/contracts/import-sources.md#american-express-ingestion) |
| <a id="known-parser-decisions-still-needing-future-policy"></a>Known parser decisions still needing future policy | [Import review, browser ingestion, and deduplication](docs/contracts/imports.md#known-parser-decisions-still-needing-future-policy) |
| <a id="visual-preferences"></a>Visual preferences | [Navigation and visual preferences](docs/contracts/navigation-and-appearance.md#visual-preferences) |

## Product direction

Ledger is a local-first personal budgeting application. It should remain simple,
clean, fast, and understandable. The current scope is a single-user application
running on the user's machine, with a CSV acting as its database.

Prefer dependable behavior and clear data ownership over framework complexity.
Do not introduce a database server, frontend framework, build system, or
third-party Python dependency unless a future requirement clearly justifies it.

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
