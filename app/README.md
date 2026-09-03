# Ledger budget dashboard

The dashboard reads and writes `data/transactions.csv`. If that
file does not exist, the dashboard directs the user to Import data. The first
successful import creates the database automatically before adding its
transactions. No third-party packages are required.

From the repository root, start it with:

```powershell
python app\server.py
```

Then visit <http://127.0.0.1:8000>.

Use **Import data** to import Credit Karma and Venmo transactions, Amazon order history, or AliExpress orders
through the companion Chrome extension, or an official Apple Card transaction
CSV. Transactions can also be added,
edited, annotated with optional freeform notes, flagged as refunded so they
contribute $0 to totals, and deleted from the dashboard.
Editing from a monthly or annual transaction list returns to the refreshed list
after the change is saved.

The dashboard defaults to the latest month with visible transaction data. Use
the reporting controls to switch between a selected month and a full-year
summary. Annual view includes category-filterable monthly spending bars and a
monthly net chart with green surpluses and red deficits. The browser remembers
the selected view, period, and annual category filter when navigating to Import
data or Settings and back.

Use the top-right navigation menu to move between the dashboard, Import data,
and Settings. The first Settings tab creates timestamped snapshots in
`data/backups/`, lists their dates and transaction counts, and restores a chosen
snapshot after confirmation. Ledger creates a safety backup of the current CSV
before every restore. Individual backups can be permanently deleted after a
separate confirmation. General settings remain a placeholder.

For direct Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card workflows, load `ledger_data_importer_extension`
as an unpacked Chrome extension, reload the Import data page, select a date
range, and choose the matching import action. Credit Karma uses a BudgetLens
bundle with all transactions; Amazon, AliExpress, and eBay create item-level rows; Venmo uses official
statement CSV data and excludes balance transfers. Parsed imports open a preview
modal before the CSV changes. New rows are selected by default, duplicates are
highlighted and deselected, and every row can be edited or removed before the
user confirms which transactions to write.
Amazon, AliExpress, eBay, and Venmo expose editable account name, account type, and
provider defaults before an import begins.

For Apple Card, the extension opens `card.apple.com`, drives **Export
Transactions** with Ledger's date range, chooses CSV, and returns the structured
data to Ledger. A manual CSV picker remains available if Apple's page changes.
Purchases, refunds, and payments are normalized to Ledger's expense-oriented signs.

Use a different CSV or port when needed:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```
