# Ledger budget dashboard

The dashboard reads and writes `processed_data_files/transactions.csv`. If that
file does not exist when the server starts, a new header-only database is
created. No third-party packages are required.

From the repository root, start it with:

```powershell
python app\server.py
```

Then visit <http://127.0.0.1:8000>.

Use **Upload data** to import either a Credit Karma JSON export, an Amazon order
history JSON export, or both. Transactions can also be added, edited, and
deleted directly from the dashboard.

For direct Credit Karma and Amazon workflows, load `ledger_data_importer_extension`
as an unpacked Chrome extension, reload the Upload data page, select a date
range, and choose the matching import action. Credit Karma uses a BudgetLens
bundle with all transactions; Amazon creates item-level rows. The manual JSON
uploaders remain available as fallbacks.

Use a different CSV or port when needed:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```
