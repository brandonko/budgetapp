# Schwab Checking

Requires companion **0.11.0+** and the updated Ledger backend. Reload the root
extension in Chrome, accept `https://client.schwab.com/*`, restart Ledger, and
refresh its Import data page.

1. Select **Schwab Checking**, dates, and an account name you will reuse.
2. Start the import. Sign in in the opened Schwab tab and select one checking account.
3. Open that account's transaction history, select a range covering the requested
   dates, and export **CSV**. Account choice and the export controls stay under
   your control. Keep the source tab open until collection finishes.
4. Return to Ledger to review, edit, and select transactions, then confirm.
   Repeat for another checking account with a different Ledger account name.

This is a passive browser capture integration, not a Schwab API client. It
observes CSV fetch/XHR responses and Blob downloads only while an owned import
is active. It neither replays bank requests nor clicks guessed export controls.
Direct navigation downloads or changed site formats may not be captured; cancel
and report those cases. The current signed-in site still needs live verification.

- `capture.js`: standalone MAIN-world capture, armed by an active document nonce.
- `csv.js`: ISOLATED-world strict CSV reader. Removes the account title, balance,
  check-number and other unneeded columns before the worker receives data.
- `content.js`: user-guided export collection with progress, timeout, and cancel.
- `coordinator.js`: owned tab/frame/origin/document checks and short-lived session
  metadata, restored across worker suspension. No source export is stored there.

Checking CSV needs Date, Type, Description, Withdrawal, and Deposit. The older
Withdrawal (-) / Deposit (+) spelling, optional account title, and known empty
history notices are also supported. Status, when present, must be Posted or
Pending; pending rows are skipped with a review notice. INTADJUST entries with
both amount cells blank are skipped with a warning, without inferring zero or
using balances. Explicit zero amounts remain valid. Unknown statuses,
brokerage layouts, malformed rows, negative/ambiguous money, and non-USD currency
stop parsing. Dates are filtered inclusively on the server. Every repeated
occurrence is retained for the shared duplicate review.

Withdrawals become positive expenses; deposits become negative credits.
INTADJUST deposits start as Income, TRANSFER rows as Transfer, and other rows as
Uncategorized. Classifications apply afterward. Transfers are not automatically
excluded merely because of their category. ATM rebates remain credits rather
than being guessed as earnings. Descriptions are preserved, so any account text
embedded in a transaction description remains part of that description.

Only the selected review is committed, with the existing revision checks,
backup and atomic write. Cancellation and late exports cannot save transactions.
Ledger's date/amount occurrence-based duplicate rule is unchanged and operates
across accounts; use review to select legitimate cross-account collisions.

Format references (independent implementation; no external code or account
fixtures copied): [bank CSV column contract](https://github.com/jbms/beancount-import/blob/master/beancount_import/source/schwab_csv.py),
[checking export fields](https://gist.github.com/shur1m/7127a049384a0bcfe57c24bc3f2f1b69).

Synthetic checks: `python -m unittest discover -s tests -v` and
`node --test tests/test_schwab_extension.js tests/test_extension_worlds.js`.
