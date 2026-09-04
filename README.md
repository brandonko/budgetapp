# Ledger

Ledger is a dependency-free personal budget dashboard backed by a master CSV.
It imports Credit Karma and Venmo transactions plus Amazon, AliExpress, and eBay order history, avoids duplicate
imports, and provides monthly and annual summaries with editable transaction
details.

The dashboard includes:

- Monthly and annual spending, income, and net summaries
- Monthly and annual spending breakdowns switchable between categories and custom tags
- Annual category-stacked spending with subcategory drill-down and monthly net charts
- Top-level category breakdowns with dollar-based subcategory summaries and sortable transaction lists
- Monthly/annual view selection with independent year and month controls
- Browser-local restoration of the last selected reporting view and period
- A shared navigation menu for the dashboard, data imports, classifications, and settings
- Manual transaction creation, editing, multi-tag labeling, refund flags, permanent deletion, and freeform notes
- Import history with batch-level rollback and automatic safety backups
- Direct Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card imports through a companion Chrome extension
- Manual Apple Card CSV fallback with editable account details
- Automatic and manually overridable internal-transfer exclusion
- Ordered, regular-expression classification rules for import categories and subcategories
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
endpoints are accessible only from the local machine. When bound to loopback,
Ledger also rejects requests whose HTTP host does not identify a loopback
address and rejects browser mutations from a different origin.

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
select it in the same source tab. Manual CSV imports review every valid row in
the file; the page's date selectors apply only to the automatic workflow.

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
master CSV changes. Repeated whitespace in imported transaction text is collapsed
before classification matching and storage. New rows are selected by default; duplicates remain visible,
highlighted, and deselected. Rows that match no classification rule use a soft
warning highlight and a **No rule matched** badge. Every field can be corrected,
and duplicates can be deliberately selected before confirming the import.
The review modal uses the same searchable, filterable, and sortable transaction
toolbar as the dashboard; its Duplicate, No rule matched, and New visibility
toggles sit immediately below that toolbar.

Before duplicate detection and review, Ledger applies classifications saved
on the dedicated **Classifications** page. If no rule matches, the importer-provided
category is retained and the subcategory stays blank.

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
transaction. Transaction-list dialogs can be sorted by date, description, or
absolute cost in either direction. Every user-editable field can be changed, including the optional
subcategory, comma-separated tags, freeform notes, and flags. A transaction can
have multiple tags. Marking a transaction as **Refunded** keeps its original amount
for duplicate detection while treating it as $0 in dashboard totals. The import
timestamp is system-managed. After editing from a transaction list, Ledger returns to the refreshed
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
first, and shows the transaction count in each valid backup. Compatible older
seven- through eleven-column Ledger CSVs are supported and receive any
missing optional fields when restored.

Individual backups can be renamed to any local CSV filename or permanently
deleted after an explicit confirmation. Renaming never overwrites another
backup. Deleting a backup does not modify the active transaction file or other
backups.

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

## Classifications

Open **Classifications** from the navigation menu to create reusable transaction rules. Each
classification defines one or more actions and may contain multiple rules.
The page’s **How matching works** disclosure provides a concise overview of
actions, matcher behavior, precedence, and the classification flow in pseudocode.
Actions can set the description, category, subcategory, account name, account
type, provider, notes, refund status, or internal-transfer treatment. Date and amount are intentionally not
available as classification actions. Every action is explicit:
unselected fields remain unchanged, while an enabled blank subcategory or notes
action clears that value. A rule has separate matchers for the transaction's
current category, subcategory, description, account name, and provider using case-insensitive regular expressions. Empty
matchers are ignored; when a rule has several populated matchers, all must
match. Each rule can also include optional freeform notes explaining its
rationale; notes appear as subtitle text beneath the rule title and never
participate in matching.
Ledger sorts classifications alphabetically by category and subcategory, places
classifications without a category action afterward, and uses the first matching
rule in that displayed order. The editor presents one classification at a time
with Previous and Next navigation. Newly added classifications are placed in
their alphabetical position when saved.
When a new classification has the same configured actions as an existing one,
Ledger blocks the duplicate and identifies the existing page so another rule
can be added there instead.
Classification details and rules use compact read-only summaries by default.
Use their individual **Edit** actions to reveal inputs; **Cancel** discards only
that draft, while **Save** validates and persists only its corresponding
classification-details or rule edit. Classification details and multiple rules
may be edited at the same time without one editor's Save committing or closing
the others. New classifications stage their details and first rule separately,
then persist once both sections have been accepted. There is no separate global
save step.

Rules are saved atomically beside the master CSV as
`data/classifications.json`. Use **Export** at the top of the Classifications page
to choose where to save a portable JSON copy. Use **Import** to select a JSON
file, validate it, and replace the current classification library.
Classification changes affect future import previews; they do not silently
rewrite existing transactions. To intentionally update prior data, use **Apply
to existing transactions**. Ledger first opens a review modal listing every
affected transaction and every proposed field-level change. The preview
distinguishes rows that will change from matching rows that already have the
selected values. Confirming applies the currently displayed rules and creates a safety backup before
it writes any transaction changes. Cancelling, pressing Escape, using the close
button, or clicking the backdrop writes nothing. Rows that match no rule keep
their existing category and subcategory.

Use **Review unclassified** to open an all-dates modal containing every row with
a blank subcategory. Shared transaction rows identify excluded internal
transfers and mark other rows **No rule matched**, while retaining refund and
custom-tag badges. Search, filter, and sort with the same compact toolbar used
by dashboard transaction lists. Closing the modal preserves the current
Classification page and any draft being edited.

## Master CSV schema

If the master CSV does not exist, the dashboard offers a direct link to Import
data. Confirming at least one staged Credit Karma, Amazon, AliExpress, eBay, Venmo, or
Apple Card transaction creates the file automatically before appending the selected
rows. Cancelling a preview does not create or modify the file. An existing file is
never replaced by initialization.

```text
date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,flags,createdAt
```

Ledger automatically and atomically adds missing optional `subcategory`, `notes`, `tags`, `flags`, and
`createdAt` columns when it opens an older database. Notes may contain commas or multiple
lines. Tags are optional comma-separated labels; surrounding whitespace is
trimmed and repeated labels are removed case-insensitively. Flags are normalized,
comma-separated identifiers; the first supported
flag is `refunded`. `createdAt` is an immutable UTC ISO 8601 timestamp assigned
to imported rows; it remains blank for manual and legacy rows.
A snapshot of the original CSV is placed in `data/backups/` before schema migration.

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
- Transaction lists default to latest-first, can be filtered by description,
  category, subcategory, tag, account name, and provider, and can be sorted by date,
  description, or absolute cost in ascending or descending order.
- Transaction dialogs keep description search and sorting visible. Less-frequent
  filters live in a compact popover, with category beside its dependent
  subcategory and account name beside provider. Active filters appear as
  individually removable chips. The tag filter lists tags present in the
  transactions available to the current dialog.
- Transactions flagged `refunded` remain visible but contribute $0 to category,
  spending, income, net, and annual-chart totals.
- The default reporting period is the latest month containing at least one
  budget-visible transaction.
- **Monthly** view filters the dashboard by a selected month and year. Its
  breakdown can group spending by top-level category or by tag.
- **Annual** view summarizes the selected year. Its spending chart and exact-dollar
  table can group each month's spending by category or by tag and show annual
  dollar totals in the legend.
  Selecting a category redraws the monthly stacks by subcategory; selecting a
  subcategory isolates it, and the breadcrumb returns to higher levels. An
  expandable dollar table compares every category and subcategory across all
  twelve months plus an annual total. Its net chart shows monthly surpluses in
  green and monthly deficits in red.
- Transactions without tags appear as **Untagged**. A transaction carrying
  multiple tags contributes its full amount to each tag, so tag totals may overlap
  and should not be added together as a grand total.
- Ledger remembers the selected view, year, month, breakdown dimension, and annual category filter in
  the current browser, including annual subcategory drill-down. Returning from
  Import data or Settings restores that reporting context when it is still
  available in the transaction data.

### Internal transfers and bill-payment reconciliation

Ledger does not exclude every transaction categorized as `Transfer`. In the
default **Automatic** treatment, it excludes only matched transactions from
different accounts with equal and opposite nonzero amounts
that post within five days. At least one side must be categorized as `Transfer`
or have a description that looks like a transfer or account payment. The other
side may retain any source category, because exports sometimes label bill
payments as income or business services. This also handles credit-balance refunds
that flow from a card back to a bank account. Matching is one-to-one and runs across the
complete database, including month boundaries. Unmatched transfers, such as
Venmo or Zelle payments, remain visible and affect the budget normally. Every
transaction editor can instead mark a row as an internal transfer or force it
to count normally. These choices are stored as `internal-transfer` and
`include-in-budget` flags; the original amount always remains in the CSV.

Excluded rows contribute $0 to monthly and annual summaries, categories,
subcategories, charts, and breakdown tables. They remain available through
**View X excluded internal transfer transactions**, where they can still be
edited or deleted.

## Data integrity and privacy

- CSV writes use an atomic replacement so a reader cannot observe a partial
  file.
- Every edit and import includes a file revision. A stale browser is prevented
  from overwriting a newer change.
- Deletion requires confirmation and is permanent.
- Source files and the master CSV are ignored by Git.
- The server listens only on localhost unless a different host is explicitly
  requested.
- Loopback requests reject untrusted `Host` values, browser mutations require a
  matching local origin, and responses prevent framing and MIME sniffing.

## Project structure

```text
app/server.py       Local HTTP server and atomic CSV persistence API
app/importers.py    Credit Karma, Amazon, AliExpress, eBay, Venmo, and Apple Card parsers
app/index.html      Monthly and annual dashboard
app/navigation.js  Shared accessible navigation-menu behavior
app/settings.html  Tabbed backup, import-history, and general settings
app/classifications.html
                    Dedicated transaction-classification workspace
app/settings.js    Backup, import-batch, and classification-rule management
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
  classifications.json
  backups/
```
