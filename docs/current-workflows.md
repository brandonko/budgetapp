# Current workflows

This guide was checked against local and published `main` at `1861ade` on
**September 9, 2026**. It explains the linked-transaction, import, and connection
workflows now in the repository. This PR updates documentation, not application
behavior. See the [main README](../README.md) for setup and all source-specific
details, the [dashboard guide](../app/README.md) for everyday navigation, and the
[product contract](../llm_context.md) for contributor invariants.

The dependency-free Python runtime, expense-positive/income-negative storage,
occurrence-aware deduplication, immutable import timestamps, revision checks,
safety backups, and atomic writes remain unchanged requirements.

## Linked refunds, repayments, and transfers

The shared transaction editor has a **Refunds & repayments** section.
Choose Refund, Internal transfer, or Repayment, search for the other transaction
by description or notes, and stage the relationship. A relationship can be
edited or removed from either side. Saving the transaction, or confirming its
enclosing import/review flow, is what makes the change durable.

- A refund links one positive purchase to one negative credit. Partial refunds
  are supported: a $100 purchase linked to an $80 credit contributes $20 of
  spending.
- A repayment links a purchase to one or more negative credits, up to 500. A
  $200 purchase with $60 and $40 repayments contributes $100 of spending.
  Multiple credits use Repayment rather than multiple Refund links.
- An internal transfer links equal, opposite, nonzero amounts in different
  accounts and contributes no spending or income.

Every original row, amount, date, and `createdAt` is retained. A linked purchase's
effective cost is attributed to its original category, month, tags, and group;
its linked credits contribute zero separately, even if categorized as Income.
Credits remain visible on their own transaction dates. An over-repayment can
make the purchase's effective spending negative. Linking is not an amount edit
or a new payment, and unlinking restores the remaining rows' normal treatment.

Each credit belongs to only one purchase. Relationships are shallow groups,
not chains: cycles, reused credits, missing targets, and ambiguous IDs are
rejected. Existing links take precedence over legacy budget-treatment flags;
unlink before changing that treatment manually. Canceling a staged import or
review must not change a saved purchase. Deleting a linked row removes its
relationship and recalculates the remaining rows, with confirmation and a
pre-mutation backup.

### CSV schema and portability

The persisted column order is:

```text
date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,createdAt,id,links
```

`id` is a unique, durable transaction identifier. It is distinct from `_id`, the
revision-local row identifier used by the UI. Normal server startup migrates
supported legacy schemas and missing IDs through a validated, backed-up atomic
write. Reading a revisioned snapshot can derive stable IDs without writing;
reads do not run fresh relationship matching. Preserve the migration backup
before using a newer schema with an older application version.

`links` is an optional compact JSON array on the positive purchase row. For
example, its decoded cell value can be:

```json
[{"transactionId":"credit-id","type":"refund"}]
```

Supported types are `refund`, `transfer`, and `repayment`. CSV quoting still
applies to this cell. The database remains CSV; JSON is used only for structured
relationship metadata. Do not hand-edit links or replace the whole database
with a JSON document.

Portable exports include `id` and `links` but omit `createdAt`. An inclusive
date-range export expands to include the complete linked group, even when a
member falls outside the selected dates; the displayed count includes those
extra rows. Imports reject incomplete or ambiguous linked groups. Explicitly
imported duplicate copies receive fresh IDs and remapped relationships. Legacy
headers without `id`, `links`, or `group` remain supported.

Deduplication still counts occurrences of `(date, amount)`; IDs do not replace
that rule. Two genuine transactions in different accounts with the same date
and amount can therefore still collide during duplicate review. Existing
two-member legacy transfer-pair flags can migrate through a backed-up write;
reading the database must not invent fresh relationships.

Sources: `app/reconciliation.py`, `app/server.py`,
`app/transactions-model.js`, and `app/transaction-ui.js`.

## Reconcile and suggested refund matches

Open **Settings → Reconcile → Find matches** to review potential transfers and
refunds. **To review** is initially enabled and **Already reconciled** is off.
The shared row filters, sorting, and editing controls remain available.

Transfer suggestions pair equal and opposite amounts in different accounts
within five days, with a transfer category or payment description as a signal.
They remain one-to-one. Refund suggestions look for an eligible saved positive
purchase with the exact opposite amount within the preceding 90 days. Candidates
favor the same account/provider, then newer purchases. An amount match is only
a suggestion, not proof of a refund; partial or combined refunds and purchases
arriving in the same import are not automatically inferred.

Expand **Possible refund**, select the intended purchase if there are multiple
candidates, and choose **Link selected purchase**. **Refund link staged** and
**Undo refund link** make the pending change visible. Finish with **Save reviewed
changes**. Merely viewing already reconciled rows does not create a write plan.
The **Match nonzero decimal** option starts off; enabling it skips whole-dollar
suggestions without changing saved relationships or manual linking.

In import previews, **Mark as refunded** and its adjacent candidate control
stage a link to a saved purchase. When several purchases match, choose one
explicitly. The matched credit's standalone selection is turned off, but the
actual credit is retained with its relationship on final confirmation; it is
not silently discarded. **Undo match** returns it to ordinary import selection.
Reimporting a handled credit shows an unchecked duplicate marked **Refund
already handled**.

Older `refund-receipt-YYYY-MM-DD-<cents>` flags remain relevant to duplicate
counts for previously omitted credits. The new flow does not fabricate source
credits or create new receipt flags. `app/refunds.py` proposes matches and
interprets legacy receipts; the server owns persistence of actual credits and
links.

## Import preferences

**Settings → Preferences** adds two browser-local import choices:

- **Default lookback:** one, two, or three weeks, or one, two, or three months.
  The default is two weeks ending today in local time. Weeks are seven-day
  multiples; month subtraction clamps to the last valid day of the target month.
- **Suggest refund matches:** enabled by default for every importer, including
  CSV. Turning it off disables suggestions, not existing links or manual editing.

Preferences synchronize across open tabs. Updated default dates replace only
fields still showing their previous defaults; existing import sessions keep
their captured settings. Generic Ledger CSV and manual Apple Card CSV read the entire file;
their rows are not restricted by this lookback. Capital One manual CSV uses
Transaction Date, and Schwab imports apply the inclusive selected Date range.

For Credit Karma, enabling refund suggestions retains merchant credits that
would otherwise be removed by its five merchant-exclusion filters, allowing
refund review. Credit direction comes from source credit metadata, not a guessed
raw amount sign. With suggestions off, the exclusions apply normally. A prior
Credit Karma opt-out supplies the fallback when no valid global refund-matching
boolean has been saved.
The server validates and snapshots the choice when an import session starts;
completion cannot substitute a different value.

Sources: `app/theme.js`, `app/upload.js`, `app/settings.html`, and
`app/server.py`.

## Transaction follow-up flags and shared list layout

Use the flag icon next to Edit to mark a transaction for later attention. It
stores the `flagged` flag, preserves other flags, and highlights the row in red.
**Filters → Flagged only** narrows the list; switching it off shows all matching
rows again. Bulk actions can set or clear the flag. Flagging alone never changes
an amount, budget treatment, or import inclusion.

Saved transaction dialogs queue flag toggles in memory and save them as one
revision-checked, backed-up batch when the dialog closes, including X, Escape,
or the backdrop. A failed save keeps the dialog and pending changes open.
Opening a nested editor is not a close; another edit must preserve queued flags
by durable transaction ID. The all-time Transactions page has **Save flags**,
also flushes before in-app navigation, and warns before a reload or tab close
with unsaved flags instead of relying on unload-time writes.

Import, Reconcile, and classification proposals are different: their flags stay
staged until the final confirmation, and all cancel paths discard them. The
saved-dialog close behavior must not leak into these staged workflows.

Shared transaction lists use an in-flow, full-width Filters section rather than
a floating filter panel. Search and sort stay above independently scrolling
rows; expanding filters does not resize the dialog. Small screens accommodate
the controls separately. Row cards, wrapped metadata, and nested candidate
cards are shared across dashboard, imports, history, classifications, and
reconciliation. Edited and No rule matched badges remain without the old yellow
row fill. Incoming money has an explicit plus sign, not just a green color;
excluded credits retain that sign with a strike-through.

## Import sources and Schwab Checking

The import page has ten tabs: Credit Karma, Amazon, AliExpress, Venmo,
eBay, Walmart, Apple Card, Capital One, Schwab Checking, and Ledger CSV. Nine
are website sources handled through the companion extension; Ledger CSV is
not a website connector. Apple Card and Capital One also have manual CSV
fallbacks. There is no dedicated manual Schwab CSV picker in the current UI.

Schwab Checking requires extension **0.11.0 or newer and the updated backend**.
The inspected extension manifest is **0.11.1**. Its flow is user-guided:

1. Start the Schwab Checking import in Ledger with the intended dates and a
   distinct account name for the checking account.
2. In the opened, signed-in Schwab tab, select one checking account and a history
   range that covers the requested dates, then export its CSV. Keep the tab open
   while collection completes.
3. Return to Ledger, review the normalized transactions, and explicitly confirm
   the import. Canceling, closing the owned tab, or a late export must not revive
   a canceled session or save rows.

The collector passively captures supported fetch/XHR/Blob export paths only
during the owned job. It does not log in, replay credentials, call guessed
Schwab APIs, or guess export controls. Unsupported download mechanisms may not
be captured; cancel and report that limitation rather than assuming success.

The parser accepts checking CSV with Date, Type, Description, Withdrawal, and
Deposit columns, including `Withdrawal (-)`/`Deposit (+)` headers. Optional account
title rows and empty histories are supported. Defaults are Schwab Checking,
BANK, and Charles Schwab; reuse a consistent, distinct name per checking account.
Withdrawals become positive expenses and deposits negative credits. Transfer
types are categorized Transfer, interest-adjustment deposits Income, and other
rows Uncategorized. An ATM rebate is not assumed to be income.

If Status is present, Posted and Pending are recognized; pending rows are skipped
and reported. Interest-adjustment rows with both money fields blank are skipped
with a warning, not inferred from a balance. Explicit zero amounts are valid.
Brokerage/retirement exports, non-USD data, unknown statuses, and malformed,
ambiguous, or negative money values stop parsing instead of guessing. Every
valid source occurrence is preserved before normal duplicate review.

The isolated collector strips account-title rows, balances, check numbers, and
other unused columns before passing normalized source content to the extension
worker. Descriptions remain intact and can themselves contain account text.
Browser credentials and cookies remain in the browser. Synthetic tests cover
the parser and capture flow; **a live signed-in Schwab export has not been
verified by this documentation update**.

Sources: `app/importers.py`, `app/upload.html`, and
`ledger_data_importer_extension/schwab_extension/`.

## Extension launcher and trusted servers

The 0.11.1 popup is a Ledger launcher: use **Open Import data** or **Ledger
connection settings**. Source progress, date selection, and confirmation stay
in the app. Opening the popup does not start Python, probe server health, scrape
a source, begin an import, or request new site permissions.

HTTP `localhost` and `127.0.0.1` are the automatic local origins. Other HTTP or
HTTPS origins require both an explicitly saved trusted server and currently
granted Chrome host permission. Trust matches the exact scheme, host, and port;
paths, credentials, queries, and fragments are not server origins. **Trust
server** and **Allow site access** request permission only after a user action.

**Reconnect** repairs the bridge on already-open eligible pages for that exact
trusted origin. It does not start a source import. Bridge registration is
refreshed on extension startup/update and trust or permission changes; revoked
permissions are not treated as continued access. The launcher prefers the
current trusted page, then a remembered server, a saved server, and finally
`http://127.0.0.1:8000`, and checks trust again before navigation.

Install the extension on the device running Chrome, even if Ledger runs on
another machine. Trusting a server does not add server authentication, TLS, or
firewall protection, and a saved address is not evidence that the server is
reachable. Do not broadly trust unrelated LAN or internet sites.

Sources: `ledger_data_importer_extension/shared/trusted_origins.js`,
`trusted_servers.js`, `options.js`, and `popup.js` in that directory.

## Optional self-hosted deployment

The [deployment guide](../deploy/README.md) describes the Debian/systemd service
and update helper intended for a private server such as a Proxmox VM. This is
optional, not a replacement for `python app/server.py`. The service runs as an
unprivileged user, keeps data outside versioned code at `/var/lib/ledger`, and
explicitly binds to `0.0.0.0:8000` for LAN access. The ordinary app default is
still loopback. Ledger does not provide login protection; do not expose this
port publicly.

The helper fetches the configured branch (default `main`), stages an immutable
commit, and runs the shared Python and JavaScript verification command before
stopping Ledger. It then
stops the service, backs up the complete data directory under
`/var/backups/ledger`, switches the release link, restarts, and checks health.
An update lock prevents concurrent runs. If the pre-update snapshot fails, the
helper keeps the old deployment and attempts to restart it. If switching,
starting, or health-checking the new release fails, Ledger is left stopped and
the old code link is restored; **data is not automatically restored**, because
the attempted release may already have migrated it. Inspect the failure and
backup before deliberately restarting or restoring.

Only committed code fetched from the configured remote is deployed. The helper
does not publish dirty local changes, update users' browser extensions, or
automatically replace installed service/updater files. Finish or cancel import
reviews before a restart because pending sessions live in memory. No VM setup,
SSH access, firewall configuration, or live deployment was performed as part of
this documentation update.

## Verification and remaining manual checks

Run `python scripts/verify.py` for both full regression suites, and
`python scripts/verify.py --browser` for the additional Chromium smoke tests.
See the [contributor commands](../README.md#development-and-testing) and
[verification layers](development.md#verification-layers). Use synthetic data
and temporary directories, never private financial exports.

Focused coverage in `tests/` includes `test_reconciliation.py`,
`test_reconcile_updates.py`, `test_refund_import.py`,
`test_import_preferences.py` / `.js`, `test_schwab_import.py`,
`test_schwab_extension.js`, `test_extension_worlds.js`, and the deployment,
popup, trusted-origin, and shared transaction-UI tests. A green synthetic suite
does not establish current third-party website compatibility or a completed
manual browser acceptance test.

When validating these workflows in your environment, manually verify linked partial
refunds and multiple repayments across reporting months, cancel and stale-save
paths in every shared dialog, complete linked-family export/reimport, real
Schwab export capture, and explicit trusted-origin permission grant/revocation.
Review a private deployment separately before enabling remote access. Keep the
guides, product invariants, and tests synchronized with the implementation;
synthetic checks cannot substitute for live integration acceptance.
