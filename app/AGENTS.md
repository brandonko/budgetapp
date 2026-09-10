# Application guidance

Read the root [AGENTS.md](../AGENTS.md) and [architecture map](../docs/architecture.md).
Follow the linked product contracts for the behavior being changed.

## Ownership

- Source parsers normalize source records; they do not commit transactions.
- `reconciliation.py` owns durable IDs, link validation, and effective amounts.
  `transfers.py` and `refunds.py` propose matches only in explicit review flows.
- `server.py` owns the HTTP validation and CSV mutation boundary. Preserve the
  lock, revision check, safety backup, and atomic replacement as one operation.
  New helpers must not create alternate write paths.
- `transactions-model.js` owns reusable query and summary computations.
  `transaction-ui.js` owns shared rows, filters, pickers, and editor helpers;
  `transaction-bulk.js` owns shared bulk selection/actions.
- Page controllers adapt these shared components to their own data, revision,
  and save lifecycle. Keep staged proposals separate from saved-row operations.
  See the [shared UI contract](../docs/contracts/transaction-ui.md).

## Changes that cross boundaries

- For amount/treatment changes, audit backend projection, dashboard totals,
  Transactions, tag totals, and group comparisons. Use the same synthetic
  examples with explicit expected cents; display formatting must not change
  stored signs or budget math.
- For shared row, filter, badge, sort, or editor changes, audit dashboard,
  Transactions, import review, import history, Reconcile, classification preview,
  and Review unclassified. Page-specific controls remain additive.
- Reads and rendering must not infer and persist new financial relationships.
  Draft edits, selection changes, and cancellation must respect the enclosing
  review's confirmation boundary. Saved follow-up flag queues have their own
  documented close/save behavior; do not confuse them with staged review drafts.
- For schema changes, cover legacy migration, immutable fields, export/reimport,
  backup/restore, validation, and every editing/import adapter.
- Use theme tokens and existing accessible controls. Verify keyboard dismissal,
  focus, and narrow layouts for material UI changes.

Extract cohesive responsibilities when there is a demonstrated benefit; keep
public behavior stable and preserve regression coverage. No framework, build
system, or application dependency is needed just to split a large module.

Run the verification required by the root guide. Use
[tests guidance](../tests/AGENTS.md) when adding coverage.
