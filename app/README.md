# Ledger budget dashboard

The dashboard reads and writes `processed_data_files/transactions.csv`. If that
file does not exist when the server starts, a new header-only database is
created. No third-party packages are required.

From the repository root, start it with:

```powershell
python app\server.py
```

Then visit <http://127.0.0.1:8000>.

Use **Upload data** to import Credit Karma transactions or Amazon order history
through the companion Chrome extension. Transactions can also be added,
edited, and deleted from the dashboard.

The dashboard defaults to the latest month with visible transaction data. Use
the reporting controls to switch between a selected month and a full-year
summary. Annual view includes category-filterable monthly spending bars and a
monthly net chart with green surpluses and red deficits.

Use the top-right navigation menu to move between the dashboard, Upload data,
and Settings. Settings is currently a placeholder for future preferences.

For direct Credit Karma and Amazon workflows, load `ledger_data_importer_extension`
as an unpacked Chrome extension, reload the Upload data page, select a date
range, and choose the matching import action. Credit Karma uses a BudgetLens
bundle with all transactions; Amazon creates item-level rows. Completed imports
open a review modal where every new row can be edited or deleted immediately.

Use a different CSV or port when needed:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```
