# Ledger budget dashboard

For step-by-step guidance on linked refunds, Reconcile, import preferences,
follow-up flags, and extension connections, see
[Current workflows](../docs/current-workflows.md).

The dashboard reads and writes `data/transactions.csv`. If that
file does not exist, the dashboard directs the user to Import data. The first
successful import creates the database automatically before adding its
transactions. No third-party packages are required.

From the repository root, start it with:

```powershell
python app\server.py
```

Then visit <http://127.0.0.1:8000>.

Use **Import data** for Credit Karma, Venmo, Apple Card, Capital One, and Schwab Checking account
transactions, Amazon/AliExpress/eBay/Walmart order history, or Ledger-format CSV.
The companion Chrome extension supports all nine website sources; Apple Card
and Capital One also offer manual CSV fallbacks. Transactions can also be added,
edited, assigned an optional subcategory, annotated with optional freeform notes,
and deleted from the dashboard. Unlinked purchases can be flagged as refunded
so they contribute $0 to totals while remaining available for duplicate detection.
Transactions can also use Eligible for detection, Internal transfer, or Count normally budget
treatment; excluded internal transfers retain their original amount but contribute
$0 to monthly and annual calculations.
For partial refunds and repayments, link the actual credit transactions in the
shared editor's **Refunds & repayments** section. The original purchase retains
its date, category, and stored amount while contributing only its net cost;
linked credits remain in the database without counting independently. Use
**Settings → Reconcile → Find matches** to review possible refund and transfer
links, then **Save reviewed changes** to commit the proposals. Canceling saves
nothing. Manual refund flags remain available for purchases without a linked
credit.
Imported rows also retain a batch timestamp so accidental imports can be
reviewed and removed from **Settings → Import history**.
Editing from a monthly or annual transaction list returns to the refreshed list
after the change is saved.

The dashboard defaults to the latest month with visible transaction data. Use
the reporting controls to switch between a selected month and a full-year
summary. Annual view includes monthly category spending bars that drill into
subcategory stacks, an expandable exact-dollar monthly breakdown table, and a
monthly net chart with green surpluses and red deficits. The browser remembers
the selected view, period, and annual category/subcategory filter when navigating
to another page and back.

Use **Transactions** at `/transactions` to explore the complete history without
selecting a month or year. Description, category/subcategory, account/provider,
optional inclusive dates, and multi-tag Any/All filters update matching spending,
income, net, and the category breakdown. The list uses the shared transaction
rows, Filters/sort toolbar, and editor, with 50 transactions per page; totals
always cover the complete result. Groups such as `Hawaii 2022` identify concrete
trips or projects; each transaction can have one group and many tags. Use the
searchable group picker in the editor to choose or create one without duplicates.
Group filters also narrow the all-time totals. Existing `(group)` tags stay unchanged.
Overlapping tags never count a transaction twice.

All transaction lists expose **Edit multiple** with independent selection, explicit
field actions, and a before/after confirmation. Add/remove tags without replacing
the others, assign or clear a group, or update any other user-editable field.
Import and classification preview edits remain staged until their final confirmation.

Use the flag icon beside Edit to mark follow-up work, then **Filters → Flagged
only** to find those rows. Flags do not affect spending or import selection.
Saved transaction dialogs batch-save queued flags when closed; the all-time
page offers **Save flags** and flushes before in-app navigation. Import,
Reconcile, and classification proposals instead keep flags staged until their
final confirmation, with no writes on cancel.

Use the top-right navigation menu to move between the dashboard, Transactions,
Import data, Classifications, and Settings. The first Settings tab exports an
inclusive date range as a portable CSV. Exporting a linked transaction also
includes the rest of its linked group, even outside those dates, and the count
reflects those extra rows. Ledger also retains automatic safety
snapshots in `data/backups/` before destructive or bulk changes. The
dedicated Classifications page manages ordered regular-expression
rules that assign categories and subcategories to future imports. Category and
subcategory are available as separate match fields. Each rule also supports
optional freeform notes that explain its rationale without affecting matching.
These rules are persisted beside the transaction CSV in `classifications.json` and can be
exported as JSON. The editor shows one classification at a time with pagination.
Classification and rule inputs appear only in their individual edit modes, and
each inline Save persists the complete classification document immediately.
The **Preferences** tab stores browser-local display and import choices. It includes dark
mode and a slider controlling whether dashboard totals begin abbreviating at
thousands, millions, billions, or trillions; abbreviations are disabled with
None and begin at millions by default.
Import lookback defaults to two weeks ending today, with one/two/three-week and
one/two/three-month choices. **Suggest refund matches** defaults on for every
importer. Custom dates and existing import sessions keep their captured choices.
Ledger CSV and manual Apple Card CSV still read the whole file; Capital One
manual CSV and Schwab imports apply the selected date range.

Use **Review unclassified** to open every blank-subcategory transaction in a
filterable modal without leaving the Classifications page or disturbing the
current draft.

For direct website-import workflows, load `ledger_data_importer_extension`
as an unpacked Chrome extension, reload the Import data page, select a date
range, and choose the matching import action. Credit Karma uses a BudgetLens
bundle with all transactions; Amazon, AliExpress, eBay, and Walmart create
item-level rows; Venmo uses official statement CSV data and excludes balance
transfers. Capital One captures official account CSV exports using Transaction
Date and a selected account identity. Schwab Checking captures a user-requested
checking-history CSV export and requires companion 0.11.0+ with the updated
backend; there is no manual Schwab CSV picker. See the main README for supported layouts
and source-specific exclusions. Parsed imports open a preview
modal before the CSV changes. New rows are selected by default, duplicates are
highlighted and deselected, and every row can be edited or deselected before the
user confirms which transactions to write.
When no classification matches, the parser category is preserved and the
subcategory remains blank.
Amazon, AliExpress, eBay, Walmart, Venmo, Apple Card, Capital One, and Schwab
Checking expose editable account name, account type, and provider defaults
before an import begins. Use consistent, distinct identities for each account.

For Apple Card, the extension opens `card.apple.com`, drives **Export
Transactions** with Ledger's date range, chooses CSV, and returns the structured
data to Ledger. A manual CSV picker remains available if Apple's page changes.
Manual CSV imports stage every valid row in the selected file rather than
applying the automatic import's date selectors again.
Purchases, refunds, and payments are normalized to Ledger's expense-oriented signs.

If Ledger runs on a private home server, install the extension on the browsing
device and add that exact scheme, host, and port through **Ledger connection
settings → Trust server**. Approve Chrome site access and refresh Import data.
Use **Reconnect** for a saved server or **Allow site access** for missing
permission. These settings do not start the backend or add authentication/TLS.

The CSV now retains fifteen columns, including immutable import `createdAt`, a
durable `id`, and JSON relationship metadata in `links`. Startup migrates
supported legacy schemas with a safety backup and atomic replacement. Do not
discard that backup or hand-edit linked IDs when moving between app versions.

Use a different CSV or port when needed:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```
