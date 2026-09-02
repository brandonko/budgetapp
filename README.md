# Ledger

Ledger is a dependency-free personal budget dashboard backed by a master CSV.
It imports Credit Karma transactions plus Amazon and AliExpress order history, avoids duplicate
imports, and provides monthly and annual summaries with editable transaction
details.

The dashboard includes:

- Monthly and annual spending, income, and net summaries
- Annual category-stacked spending and monthly net charts
- Category breakdowns and latest-first transaction lists
- Monthly/annual view selection with independent year and month controls
- A shared navigation menu for the dashboard, data imports, and settings
- Manual transaction creation, editing, and permanent deletion
- Direct Credit Karma, Amazon, and AliExpress imports through a companion Chrome extension
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
`processed_data_files/transactions.csv` does not exist, Ledger creates a new
header-only database automatically.

`processed_data_files/transactions.csv` is always the default database. Ledger
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
repository's `.gitignore` excludes both `raw_data_files/` and
`processed_data_files/`.

With Ledger running, open <http://127.0.0.1:8000/upload> or select **Upload
data** from the dashboard. The page supports three sources:

- **Credit Karma** converts debits to positive expenses and credits to negative
  amounts. Its two default-enabled filters omit Amazon and AliExpress/Alipay
  transactions so they can be replaced by itemized order rows. Either filter
  can be disabled for an individual import.
- **Amazon orders** creates one transaction per item and applies the `1.10502`
  tax multiplier. When Credit Karma metadata is available in the same import,
  it supplies the Amazon payment account. Otherwise, unknown account fields
  default to `Amazon`.
- **AliExpress orders** creates one transaction per order line and proportionally
  reconciles item prices to the final order total, preserving discounts, shipping,
  and tax. The current integration accepts USD orders.

### Companion browser extension

The Upload data page supports selecting a date range and importing from an
authenticated Credit Karma, Amazon, or AliExpress session without first saving a JSON file. This
requires a one-time installation of the unpacked Chrome companion extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and select **Load unpacked**.
3. Select the repository's `ledger_data_importer_extension` directory.
4. Reload <http://127.0.0.1:8000/upload>. The page should report **Companion
   extension connected**.
5. Choose a start and end date, then select the import action for that source.

The Credit Karma action opens its Transactions page, collects **All
transactions** for the range in the BudgetLens bundle shape, and sends it to the
normal Credit Karma parser. The Amazon and AliExpress actions open order history and collect
item details. All three use the browser's existing signed-in session; Ledger never
receives site credentials or cookies. Progress is shown on the Upload data
page, and data is sent through a random, one-hour import session rather than
being left in Downloads. When an import finishes, Ledger opens a review modal
containing only the newly created transactions. Every field can be corrected
there, or a row can be permanently deleted after confirmation.

Credit Karma and AliExpress can change their private APIs, and Amazon can change its
order-history markup. Any source can present login/CAPTCHA challenges. Closing an active
source tab cancels that import. See
[`ledger_data_importer_extension/README.md`](ledger_data_importer_extension/README.md)
for implementation and attribution details.

### Planned sources

The import page identifies Venmo and eBay item history
as planned integrations. Apple Card support is also being explored, but may
require a manual import workflow because browser automation may not be viable.

### Duplicate handling

Imports identify existing transactions by normalized `date` and `amount` while
also counting repeated occurrences. For example, if a source contains two
transactions for the same amount on the same date and neither exists in the
CSV, both are added. Importing that range again skips both. If only one already
exists, one additional occurrence is added.

This deliberately ignores descriptions so an edited description does not cause
the source transaction to be imported again.

## Edit transaction data

Open any category or the all-transactions view and select **Edit** on a
transaction. All seven CSV fields can be changed. The same form supports
permanent deletion after an explicit confirmation. Use **Add transaction** on
the dashboard to create a row manually.

Every mutation is validated, revision-checked, and saved with an atomic file
replacement. If another browser or process changes the CSV first, Ledger rejects
the stale write instead of silently overwriting newer data.

## Master CSV schema

If the master CSV is deleted while Ledger is running, the dashboard offers to
create a new, header-only transaction file. Existing files are never replaced
by this initialization action.

```text
date,description,amount,category,accountName,accountType,provider
```

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
app/importers.py    Credit Karma, Amazon, and AliExpress source parsers
app/index.html      Monthly and annual dashboard
app/navigation.js  Shared accessible navigation-menu behavior
app/settings.html  Settings placeholder and future preferences entry point
app/upload.html     Data import page
ledger_data_importer_extension/
                    Unpacked Chrome companion extension for direct imports
  amazon_extension/ Amazon-specific scraper and popup
  creditkarma_extension/
                    Credit Karma-specific collector
  aliexpress_extension/
                    AliExpress signed API client
  shared/           Ledger bridge and import coordinator
tests/              Isolated standard-library regression tests
raw_data_files/     Optional private source exports (ignored by Git)
processed_data_files/
                    Master CSV database (ignored by Git)
```
