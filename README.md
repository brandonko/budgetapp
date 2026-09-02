# Ledger

Ledger is a dependency-free personal budget dashboard backed by a master CSV.
It imports Credit Karma transactions and Amazon order history, avoids duplicate
imports, and provides monthly summaries with editable transaction details.

The dashboard includes:

- Monthly spending, income, and net summaries
- Category breakdowns and latest-first transaction lists
- Month and year selection
- Manual transaction creation, editing, and permanent deletion
- In-app Credit Karma and Amazon JSON imports
- Experimental direct Amazon imports through a companion Chrome extension
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

## Download source data

Raw financial data is private and must not be committed to Git. This
repository's `.gitignore` excludes both `raw_data_files/` and
`processed_data_files/`.

### Credit Karma transactions

Download Credit Karma transactions as JSON using
[CreditKarmaExtractor](https://github.com/cbangera2/CreditKarmaExtractor).

### Amazon orders

Amazon data can be collected directly with Ledger's experimental companion
extension, described below. For the manual workflow, export JSON from Amazon's
orders page using
[Order History Exporter for Amazon](https://github.com/xenolphthalein/order-history-exporter-for-amazon).

## Import source files

With Ledger running, open <http://127.0.0.1:8000/upload> or select **Upload
data** from the dashboard. The page has one file card for each supported parser:

- **Credit Karma** converts debits to positive expenses and credits to negative
  amounts. Amazon card transactions are omitted so they can be replaced by
  itemized Amazon rows.
- **Amazon orders** creates one transaction per item and applies the `1.10502`
  tax multiplier. When Credit Karma metadata is available in the same import,
  it supplies the Amazon payment account. Otherwise, unknown account fields
  default to `Amazon`.

Either file can be imported by itself, or both can be selected together. All
selected files are parsed and validated before the CSV is changed, preventing a
partially completed import. Import results report how many rows were parsed,
added, and skipped as duplicates.

### Experimental direct Amazon import

The Upload data page also supports selecting a date range and importing from an
authenticated Amazon tab without first saving a JSON file. This requires a
one-time installation of the unpacked Chrome companion extension:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and select **Load unpacked**.
3. Select the repository's `amazon_importer_extension` directory.
4. Reload <http://127.0.0.1:8000/upload>. The page should report **Companion
   extension connected**.
5. Choose a start and end date and select **Import Amazon orders**.

The extension opens Amazon order history and waits for sign-in when necessary.
It uses the browser's existing Amazon session; Ledger never receives Amazon
credentials or cookies. Progress is shown on the Upload data page, and the
finished JSON is sent directly through a random, one-hour import session rather
than being left in the Downloads folder. The normal Amazon JSON file picker
remains available as a fallback.

The integration is experimental because Amazon can change its order-history
markup or present login/CAPTCHA challenges. Closing the Amazon tab cancels the
active scrape. See
[`amazon_importer_extension/README.md`](amazon_importer_extension/README.md)
for implementation and attribution details.

### Duplicate handling

Imports identify existing transactions by normalized `date` and `amount` while
also counting repeated occurrences. For example, if an uploaded file contains
two transactions for the same amount on the same date and neither exists in the
CSV, both are added. Uploading that file again skips both. If only one already
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

```text
date,description,amount,category,accountName,accountType,provider
```

Debit expenses and Amazon purchases are positive. Credits, refunds, and income
are negative in the CSV. In the interface, income is displayed as a positive
value and net total is calculated as income minus spending: a surplus is green
and a spending deficit is red.

### Monthly totals

- **Total spent** is the net sum of visible, non-income transactions. It uses a
  neutral card background.
- **Total income** uses transactions in the `Income` category and is displayed
  as a positive number even though those values remain negative in the CSV.
- **Net total** is income minus spending. Positive values use a light-green
  background; negative values use a light-red background.
- Transaction lists are ordered latest first.
- The default reporting period is the latest month containing at least one
  budget-visible transaction.

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
app/importers.py    Credit Karma and Amazon source parsers
app/index.html      Monthly dashboard
app/upload.html     Data import page
amazon_importer_extension/
                    Experimental unpacked Chrome companion extension
tests/              Isolated standard-library regression tests
raw_data_files/     Optional private source exports (ignored by Git)
processed_data_files/
                    Master CSV database (ignored by Git)
```
