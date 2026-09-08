# Data coverage

Open **Data coverage** from the shared navigation menu, or visit `/coverage`.
The read-only activity map groups rows by provider, account type, and account
name. Select a year, search accounts, and choose a 14/30/60/90-day threshold
for highlighting older activity. The year and threshold are browser-local.

Each account shows all twelve monthly occurrence counts, its recorded date span,
and the latest import timestamp among its surviving rows. The overview includes
refunds and internal transfers because this is a record inventory, not a spending
report. Blank months mean **no recorded activity**, not confirmed missing imports.
“As of” uses the device's current local date when loading or refreshing records;
age uses calendar days. Future-dated activity is labeled explicitly.

Manual and legacy rows can lack import timestamps. Deleted imports no longer
exist in this view. Nothing here establishes whether a bank account is connected
or a statement is complete. No transaction data is written by this feature.

## Why this experiment

A qualitative review of public discussions found people losing confidence in
reports when imports omit transactions: an [Actual reconciliation discussion](https://www.reddit.com/r/actualbudgeting/comments/1syur3a/im_really_frustrated/)
describes a mismatch despite checking account records, and [YNAB users report
missing imports](https://www.reddit.com/r/ynab/comments/1rpuaw0/missing_transaction_imports/).
These are self-selected anecdotes, not a representative survey. Both discussions
predate the research date, September 7, 2026.

[Actual's reconciliation documentation](https://actualbudget.org/docs/accounts/reconciliation/)
describes matching the app ledger against the bank statement. This experiment
helps decide where to inspect next; it does not claim to perform reconciliation.

## Validation

Run `node --test tests/test_coverage_model.js tests/test_coverage_controller.js`
for account identity, occurrence counts, calendar-day freshness, retained import
timestamps, local filtering, setup, errors, and GET-only behavior. Run
`python -m unittest discover -s tests -v` for the full regression suite and static
route verification without database initialization.
