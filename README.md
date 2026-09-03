# Ledger

Ledger is a dependency-free personal budget dashboard backed by a master CSV.
It imports Credit Karma and Venmo transactions plus Amazon, AliExpress, and eBay order history, avoids duplicate
imports, and provides monthly and annual summaries with editable transaction
details.

The dashboard includes:

- Monthly and annual spending, income, and net summaries
- Annual category-stacked spending and monthly net charts
- Category breakdowns and latest-first transaction lists
- Monthly/annual view selection with independent year and month controls
- Browser-local restoration of the last selected reporting view and period
- A shared navigation menu for the dashboard, data imports, and settings
- Manual transaction creation, editing, permanent deletion, and freeform notes
- Import history with batch-level rollback and automatic safety backups
- Direct Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card imports through a companion Chrome extension
- Manual Apple Card CSV fallback with editable account details
- One-to-one reconciliation of credit-card bill-payment transfers
- Neutral spending presentation with green surpluses and red deficits

## Requirements

- Python 3.10 or newer
- A modern web browser

No third-party Python packages are required.

## Run Ledger

From the repository root:

```powershell
python app\server.py
```

Open <http://127.0.0.1:8000>. If
`data/transactions.csv` does not exist, the dashboard directs
you to Import data. The first successful import creates the CSV automatically
before adding its transactions.

`data/transactions.csv` is always the default database. Ledger
does not automatically select other CSV files in that directory. A different
file is used only when it is explicitly supplied with `--csv`.

To use a different CSV or port:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```

The server binds to `127.0.0.1` by default so the financial data and editing
endpoints are accessible only from the local machine.

## Import data

Raw financial data is private and must not be committed to Git. This
repository's `.gitignore` excludes both `raw_data_files/` and `data/`.

With Ledger running, open <http://127.0.0.1:8000/import> or select **Import
data** from the dashboard. The page presents six sources as tabs so only one
importer is visible at a time:

- **Credit Karma** converts debits to positive expenses and credits to negative
  amounts. Its four default-enabled filters omit Amazon, AliExpress/Alipay,
  Venmo, and eBay transactions so they can be replaced by richer source data. Each filter
  can be disabled for an individual import.
- **Amazon orders** creates one transaction per item and applies the `1.10502`
  tax multiplier. Its editable payment-account defaults are `Prime VISA`,
  `CREDIT CARD`, and `chase`.
- **AliExpress orders** creates one transaction per order line and proportionally
  reconciles item prices to the final order total, preserving discounts, shipping,
  and tax. The current integration accepts USD orders. Its editable defaults
  are `Credit Card Mastercard`, `CREDIT CARD`, and `Bank of America`.
- **Venmo** imports completed payments from official statement CSV data. Outgoing
  payments become expenses and incoming payments become income. Pending, failed,
  reversed, and Venmo balance-transfer rows are excluded. Its editable defaults
  are `Checking Account`, `BANK`, and `Bank of America`.
- **eBay** reads authenticated Purchase History and creates one transaction per
  item. Order totals are proportionally allocated across items so shipping, tax,
  and discounts remain reconciled. Its editable defaults are `eBay`, `CREDIT CARD`,
  and `eBay`.
- **Apple Card** opens `card.apple.com`, selects **Export Transactions**, applies
  the chosen dates and CSV format, and captures the official export. A manual
  CSV picker remains available as a fallback. Purchases are expenses, refunds
  are negative adjustments, and card payments are transfers. Its editable
  defaults are `Apple Card`, `CREDIT CARD`, and `Goldman Sachs`.

For Apple Card, select **Import from Apple Card** and sign in if Apple asks.
Ledger's extension drives Apple's official export form and receives the CSV
without accessing the user's Apple Account credentials. If Apple changes the
page, manually export a CSV from [card.apple.com](https://card.apple.com) and
select it in the same source tab.

### Companion browser extension

The Import data page supports selecting a date range and importing from an
authenticated Credit Karma, Amazon, AliExpress, eBay, Venmo, or Apple Card session without first saving a file. This
requires a one-time installation of the unpacked Chrome companion extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and select **Load unpacked**.
3. Select the repository's `ledger_data_importer_extension` directory.
4. Reload <http://127.0.0.1:8000/import>. The page should report **Companion
   extension connected**.
5. Choose a start and end date, then select the import action for that source.

The Credit Karma action opens its Transactions page, collects **All
transactions** for the range in the BudgetLens bundle shape, and sends it to the
normal Credit Karma parser. The Amazon, AliExpress, and eBay actions open order history and collect
item details. Venmo opens Statements and downloads official statement CSV data in monthly
segments. Apple Card drives the official date-range CSV export form. All six use the browser's existing signed-in session; Ledger never
receives site credentials or cookies. Progress is shown on the Import data
page, and data is sent through a random, one-hour import session rather than
being left in Downloads. Parsed rows are staged in a review modal before the
master CSV changes. New rows are selected by default; duplicates remain visible,
highlighted, and deselected. Every field can be corrected, rows can be removed,
and duplicates can be deliberately selected before confirming the import.

Credit Karma, AliExpress, eBay, and Venmo can change their private APIs; Amazon and Apple can change their
page markup. Any source can present login/CAPTCHA challenges. Closing an active
source tab cancels that import. See
[`ledger_data_importer_extension/README.md`](ledger_data_importer_extension/README.md)
for implementation and attribution details.

### Duplicate handling

Imports identify existing transactions by normalized `date` and `amount` while
also counting repeated occurrences. For example, if a source contains two
transactions for the same amount on the same date and neither exists in the
CSV, both are marked new. Importing that range again marks both as duplicates.
If only one already exists, one occurrence is a duplicate and one is new.

This deliberately ignores descriptions so an edited description does not cause
the source transaction to be imported again.

## Edit transaction data

Open any category or the all-transactions view and select **Edit** on a
transaction. Its eight user-editable fields can be changed, including optional
freeform notes; the import timestamp is system-managed. After editing from a transaction list, Ledger returns to the refreshed
list instead of closing the workflow. The same form supports
permanent deletion after an explicit confirmation. Use **Add transaction** on
the dashboard to create a row manually.

Every mutation is validated, revision-checked, and saved with an atomic file
replacement. If another browser or process changes the CSV first, Ledger rejects
the stale write instead of silently overwriting newer data.

## Backups and restore

Open **Settings → Backup** to create and manage transaction database snapshots.
Ledger stores generated backups under `data/backups/` using timestamped names
such as `transactions_20260902_114500_123456.csv`. Any regular CSV placed directly
in that folder also appears. The list is ordered by last-modified date, newest
first, and shows the transaction count in each valid backup. Legacy seven-column
Ledger CSVs are supported and receive blank notes when restored.

Individual backups can be permanently deleted after an explicit confirmation.
Deleting a backup does not modify the active transaction file or other backups.

Restoring requires explicit confirmation and completely replaces
`data/transactions.csv`. Before replacement, Ledger automatically creates a
safety backup of the current file so the restore itself remains recoverable.

## Import history

Every transaction committed by one import receives the same UTC `createdAt`
timestamp. Open **Settings → Import history** to see those batches ordered newest
first and the number of rows still associated with each import. Legacy and
manually created transactions have a blank timestamp and do not appear there.

Removing an import batch deletes all of its remaining rows after an explicit
confirmation and revision check. Ledger creates a safety backup of the complete
transaction file before applying the removal.

## Master CSV schema

If the master CSV does not exist, the dashboard offers a direct link to Import
data. Confirming at least one staged Credit Karma, Amazon, AliExpress, eBay, Venmo, or
Apple Card transaction creates the file automatically before appending the selected
rows. Cancelling a preview does not create or modify the file. An existing file is
never replaced by initialization.

```text
date,description,amount,category,accountName,accountType,provider,notes,createdAt
```

Ledger automatically and atomically adds missing `notes` and `createdAt` columns
when it opens a legacy seven- or eight-column database. Notes may contain commas
or multiple lines. `createdAt` is an immutable, UTC ISO 8601 timestamp assigned
to imported rows; it remains blank for manual and legacy rows.

Debit expenses and Amazon purchases are positive. Credits, refunds, and income
are negative in the CSV. In the interface, income is displayed as a positive
value and net total is calculated as income minus spending: a surplus is green
and a spending deficit is red.

### Dashboard periods and totals

- **Total spent** is the net sum of visible, non-income transactions. It uses a
  neutral card background.
- **Total income** uses transactions in the `Income` category and is displayed
  as a positive number even though those values remain negative in the CSV.
- **Net total** is income minus spending. Positive values use a light-green
  background; negative values use a light-red background.
- Transaction lists are ordered latest first.
- The default reporting period is the latest month containing at least one
  budget-visible transaction.
- **Monthly** view filters the dashboard by a selected month and year.
- **Annual** view summarizes the selected year. Its spending chart stacks each
  month's spending by category; selecting a category in the legend focuses the
  chart on that category. Its net chart shows monthly surpluses in green and
  monthly deficits in red.
- Ledger remembers the selected view, year, month, and annual category filter in
  the current browser. Returning from Import data or Settings restores that
  reporting context when it is still available in the transaction data.

### Bill-payment reconciliation

Ledger does not exclude every transaction categorized as `Transfer`. It excludes
only matched bank/credit-account pairs with equal and opposite nonzero amounts
that post within five days. At least one side must be categorized as `Transfer`;
the other may be `Transfer` or `Income` because source exports sometimes label
the receiving side as income. This also handles credit-balance refunds that flow
from a card back to a bank account. Matching is one-to-one and runs across the
complete database, including month boundaries. Unmatched transfers, such as
Venmo or Zelle payments, remain visible and affect the budget normally.

Matched rows remain available through **View excluded bill-payment
transactions**, where they can still be edited or deleted.

## Data integrity and privacy

- CSV writes use an atomic replacement so a reader cannot observe a partial
  file.
- Every edit and import includes a file revision. A stale browser is prevented
  from overwriting a newer change.
- Deletion requires confirmation and is permanent.
- Source files and the master CSV are ignored by Git.
- The server listens only on localhost unless a different host is explicitly
  requested.

## Project structure

```text
app/server.py       Local HTTP server and atomic CSV persistence API
app/importers.py    Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card parsers
app/index.html      Monthly and annual dashboard
app/navigation.js  Shared accessible navigation-menu behavior
app/settings.html  Tabbed settings page with backups and import history
app/settings.js    Backup and import-batch management behavior
app/upload.html     Data import page
ledger_data_importer_extension/
                    Unpacked Chrome companion extension for direct imports
  amazon_extension/ Amazon-specific scraper and popup
  creditkarma_extension/
                    Credit Karma-specific collector
  aliexpress_extension/
                    AliExpress signed API client
  venmo_extension/  Venmo statement collector
  apple_card_extension/ Apple Card export-form automation
  shared/           Ledger bridge and import coordinator
tests/              Isolated standard-library regression tests
raw_data_files/     Optional private source exports (ignored by Git)
data/               Master CSV database and backups (ignored by Git)
  transactions.csv
  backups/
```
