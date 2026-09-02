# Ledger

Ledger is a small, dependency-free personal budget dashboard. It combines a
Credit Karma transaction export with an Amazon order-history export, produces a
normalized master CSV, and presents the results as a monthly spending dashboard.

The dashboard includes monthly spending, income, and net summaries; category
breakdowns; transaction detail views; and a month selector. Transactions in the
`Transfer` category are excluded from the dashboard because they are typically
credit-card payments or movements between accounts.

## Requirements

- Python 3.10 or newer
- A modern web browser

No third-party Python packages are required.

## Download the raw data

Raw financial data is private and must not be committed to Git. This repository's
`.gitignore` excludes both `raw_data_files/` and `processed_data_files/`.

### Credit Karma transactions

Download your Credit Karma transactions as JSON using
[CreditKarmaExtractor](https://github.com/cbangera2/CreditKarmaExtractor), then
place the downloaded file in `raw_data_files/`.

For example:

```text
raw_data_files/budgetlens_2026-01-01_to_2026-12-31.json
```

### Amazon orders

From the Amazon orders page, download your order history using the
[Amazon Order History Reporter Chrome extension](https://chromewebstore.google.com/detail/amazon-order-history-repo/mgkilgclilajckgnedgjgnfdokkgnibi?hl=en),
then place its JSON export in `raw_data_files/`.

For example:

```text
raw_data_files/amazon-orders-2026.json
```

## Build the master transaction list

Run the transaction builder with the Credit Karma file, Amazon orders file, and
desired output path:

```powershell
python scripts\build_transactions.py `
  raw_data_files\budgetlens_2026-01-01_to_2026-12-31.json `
  raw_data_files\amazon-orders-2026.json `
  processed_data_files\transactions.csv
```

The generated CSV contains:

```text
date, description, amount, category, accountName, accountType, provider
```

Debit expenses and Amazon purchases are positive. Credits and refunds are
negative. Amazon card transactions from the Credit Karma export are omitted and
replaced with individual Amazon item rows, including estimated sales tax.

## Run the dashboard

From the repository root:

```powershell
python app\server.py
```

Open <http://127.0.0.1:8000> in a browser. The server reads
`processed_data_files/transactions.csv` for every data request, so rebuilding
the CSV is enough to refresh the available dashboard data.

To use a different CSV or port:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```

## Project structure

```text
app/                       Web dashboard and local HTTP server
scripts/build_transactions.py
                           Credit Karma + Amazon normalization script
raw_data_files/            Private source exports (ignored by Git)
processed_data_files/      Generated transaction data (ignored by Git)
```
