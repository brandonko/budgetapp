# Ledger

Ledger is a dependency-free personal budget dashboard backed by a master CSV.
It imports account transactions from Credit Karma, Venmo, Apple Card, Capital
One, and Schwab Checking; order history from Amazon, AliExpress, eBay, and
Walmart; and Ledger-format CSV files. It avoids duplicate imports and provides monthly and annual summaries
with editable transaction details.

For a task-oriented guide to linked refunds, Reconcile, import preferences,
follow-up flags, Schwab, and extension connections, see
[Current workflows](docs/current-workflows.md). It also explains schema
migration, deployment recovery, and what still needs live verification.

## Features

The dashboard includes:

- Monthly and annual spending, income, and net summaries with a configurable large-number abbreviation threshold
- An all-time Transactions dashboard for searching past purchases and exploring tags or groups
- Monthly and annual spending breakdowns switchable between categories and a multi-tag explorer
- Annual category-stacked spending with subcategory drill-down and monthly net charts
- Top-level category breakdowns with dollar-based subcategory summaries and sortable transaction lists
- Monthly/annual view selection with independent year and month controls
- Browser-local restoration of the last selected reporting view and period
- A shared navigation menu for the dashboard, transactions, data imports, classifications, and settings
- Manual transaction creation, editing, multi-tag labeling, refund flags, permanent deletion, and freeform notes
- Import history with batch-level rollback and automatic safety backups
- Website imports for Credit Karma, Amazon, AliExpress, eBay, Walmart, Venmo, Apple Card, Capital One, and Schwab Checking through a companion Chrome extension
- Manual Apple Card and Capital One CSV fallbacks with editable account details
- Linked refunds and repayments that retain original transactions while adjusting spending
- A Reconcile workspace for reviewing transfer and refund suggestions before saving
- Follow-up flags, a Flagged only filter, and bulk flag actions across transaction lists
- Browser-local import lookback and refund-matching preferences
- Automatic and manually overridable internal-transfer exclusion
- Ordered, regular-expression classification rules for import categories and subcategories
- A visual taxonomy editor for maintaining available categories and subcategories
- Neutral spending presentation with green surpluses and red deficits

## Requirements

- Python 3.10 or newer
- A modern web browser

No third-party Python packages are required.

## Development and testing

Read `llm_context.md` before changing behavior; it records Ledger's product,
financial-correctness, privacy, and persistence invariants. Run the complete
dependency-free regression suite from the repository root with:

```powershell
python -m unittest discover -s tests -v
```

Tests must use synthetic data and temporary directories. Never copy private
contents from `data/` or `raw_data_files/` into tests or commits.

If Node.js is available, also run every JavaScript regression file. In PowerShell:

```powershell
$ledgerJsTests = @(Get-ChildItem -LiteralPath tests -Filter 'test_*.js' | ForEach-Object FullName)
node --test @ledgerJsTests
```

In a shell that expands file globs, use `node --test tests/test_*.js`. Node.js is
a contributor testing tool, not an application runtime dependency. Python tests
that exercise JavaScript may skip those checks when Node.js is unavailable;
check the test summary rather than treating skipped checks as coverage.

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

For a local-network test, run `python app/server.py --host 0.0.0.0 --port 8000`
and open `http://YOUR_SERVER_IP:8000/import` from your browser. For direct imports,
reload Ledger Data Importer in `chrome://extensions`, open its popup's
**Ledger connection settings**, add `http://YOUR_SERVER_IP:8000`, click
**Trust server**, approve site access, and refresh the import page. The extension
checks the exact address and port; localhost continues to connect automatically.
If the server is already listed but Ledger is not detecting the extension, use
**Reconnect** beside that server (or **Allow site access** if permission is missing).
Version 0.11.1 restores the connection script automatically after extension/browser
startup and permission changes. Reload the extension once to activate this fix,
then refresh Import data. Do not add the same server again.
The extension stays in the browsing device, even when Ledger runs on a home
server. This setting does not add server authentication or HTTPS.

## Import data

For a dedicated home server, see [the Proxmox deployment guide](deploy/README.md).
It includes a Debian service and a `ledger-deploy` command that tests and deploys
the latest `main`, with financial data and deployment backups outside the code.

Raw financial data is private and must not be committed to Git. This
repository's `.gitignore` excludes both `raw_data_files/` and `data/`.

With Ledger running, open <http://127.0.0.1:8000/import> or select **Import
data** from the dashboard. The page presents ten sources as tabs so only one
importer is visible at a time:

- **Credit Karma** converts debits to positive expenses and credits to negative
  amounts. Its five default-enabled filters omit Amazon, AliExpress/Alipay,
  Venmo, eBay, and Walmart transactions so they can be replaced by richer source data. Each filter
  can be disabled for an individual import.
  The Walmart filter matches `walmart`, `wal-mart`, `wal mart`, or
  `wm supercenter` (case-insensitive). Turn it off to include membership charges
  or purchases not covered by itemized imports.
  The global **Settings → Preferences → Suggest refund matches** option is enabled
  by default and remembered in this browser; it applies to every importer, not just Credit Karma.
  It keeps credits from these services even when their merchant filter is on,
  and suggests saved purchases at the exact opposite amount within the preceding
  **90 days**. Same-account purchases appear first; a matching price is only a
  suggestion, particularly for Venmo payments.
  In review, click **Mark as refunded**. The adjacent chevron expands the
  explanation and matched purchases, displayed as transaction rows. If there is
  more than one candidate, select a purchase explicitly before marking it.
  The credit remains visible and is linked instead of counted independently;
  **Undo match** restores normal import selection. Only final confirmation saves
  the real credit and its link to the original purchase, and
  cancelling discards both the import and the proposed refund changes. Leave
  the credit selected to import it normally instead. Turn the toggle off to
  restore merchant exclusions for credits and manage refunds manually.
  Automatic suggestions cover full refunds of saved purchases. For partial
  refunds, link credits manually in the purchase editor. Repayments can be linked
  from either the original purchase or the repayment's editor.
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
- **Walmart** opens signed-in Walmart.com purchase history, including Walmart+
  purchases. It creates one Shopping row per charged item line, allocating the
  receipt total (tax, fees, tips, and discounts included) without multiplying
  quantities twice. Defaults are `Walmart`, `CREDIT CARD`, and `Walmart`; replace
  these with the actual payment account. Completed USD receipts only; pending,
  cancelled, and returned/refunded orders are explicitly reported as skipped.
  Import uncovered charges/refunds from your account instead. Membership fees
  are not part of this order-history export. Dates are inclusive order dates,
  not delivery or bank posting dates.
- **Apple Card** opens `card.apple.com`, selects **Export Transactions**, applies
  the chosen dates and CSV format, and captures the official export. A manual
  CSV picker remains available as a fallback. Purchases are expenses, refunds
  are negative adjustments, and card payments are transfers. Its editable
  defaults are `Apple Card`, `CREDIT CARD`, and `Goldman Sachs`.
- **Capital One** imports official account CSV exports over the selected
  Transaction Date range, through the companion extension or a manual CSV
  fallback. See the Capital One workflow below for supported layouts and account
  options.
- **Schwab Checking** captures a CSV export from your signed-in Schwab tab.
  Start in Ledger, select one checking account in Schwab, set its transaction
  history range, and export CSV. Defaults are `Schwab Checking`, `BANK`, and
  `Charles Schwab`; use a distinct account name for each checking account.
  Withdrawals become expenses, deposits become credits, and pending activity is
  skipped with a notice. Review categories and duplicates before confirming.
  Interest-adjustment entries with both amount cells blank are also skipped
  with a warning; Ledger never infers an amount from the running balance.
  Brokerage and retirement activity are not supported.
- **CSV** accepts Ledger's transaction schema without the system-managed
  `createdAt` column. Each row requires `date`, `description`, and `amount`; all
  other columns must be present but may contain blank values. Rows are validated
  independently, so valid rows reach review while the modal reports how many
  invalid rows were skipped.

**Settings → Preferences** also sets the default lookback for every importer's
date controls: **1, 2, or 3 weeks**, or **1, 2, or 3 calendar months**. The default
is **2 weeks**, ending today. Calendar months clamp to the last valid day when
necessary. Dates remain editable; changing the preference does not replace
custom dates on an already-open import page. Ledger-format and Apple Card CSV
uploads still read the entire file rather than applying this default window.

**Suggest refund matches** controls suggestions for credits from all sources,
including uploaded CSVs. Each new import snapshots this preference; changing it
does not alter an import already in review. Matching uses an exact-price saved
purchase from the preceding 90 days and always requires explicit review and
confirmation. When off, no importer suggests refunds. Credits otherwise remain
normal transactions, except Credit Karma restores its selected merchant exclusions.
These preferences are saved in the current browser, like the theme preference.

For Apple Card, select **Import from Apple Card** and sign in if Apple asks.
Ledger's extension drives Apple's official export form and receives the CSV
without accessing the user's Apple Account credentials. If Apple changes the
page, manually export a CSV from [card.apple.com](https://card.apple.com) and
select it in the same source tab. Manual CSV imports review every valid row in
the file; the page's date selectors apply only to the automatic workflow.

Schwab Checking requires companion **0.11.0+**. Reload Ledger Data Importer in
`chrome://extensions`, accept the `client.schwab.com` permission, restart the
Python backend, and refresh Import data. Dates filter the export inclusively.
Keep the opened Schwab tab active through the export, then return to Ledger for
review. Current live export capture still needs verification with your account;
see [Schwab integration details](ledger_data_importer_extension/schwab_extension/README.md).

### Companion browser extension

The extension toolbar opens a **Ledger** popup, not an Amazon exporter. Select
your Ledger server and **Open Import data** to choose any supported source.
Use **Ledger connection settings** to add a trusted home-server address. Keep
Ledger running; the popup does not launch Python or start an import itself.
After updating to companion **0.10.2**, reload the extension in
`chrome://extensions` to see the new popup. No backend restart is required.

**Capital One:** choose its tab, set an inclusive date range and account labels,
then click **Import Capital One transactions**. Requires companion **0.9.1+**;
reload it in `chrome://extensions` and accept the two Capital One banking-site
permissions. Sign in, complete verification, and open the account yourself.
The collector attempts recognizable **Download transactions / Export** controls,
fills explicit start/end fields, selects CSV, and captures that export for review.
An unfamiliar form is left for you to operate manually; capture remains active.
If capture is unavailable, use **Use a downloaded Capital One CSV** in that tab.
Both paths apply the selected dates to **Transaction Date**, not Posted Date.
Include the entire requested range in the bank export; Ledger cannot recover
transactions the bank did not export. Import one account at a time and change
account type to `BANK` for checking/savings (default: `CREDIT CARD`).

Supported Capital One layouts have `Transaction Date, Description, Debit, Credit`
(credit cards, plus optional Category) or `Transaction Date, Transaction Description,
Transaction Amount, Transaction Type` (bank accounts, explicit Debit/Credit types).
Debits become positive expenses; credits become negative money received. Retain
source categories or use Uncategorized; classification rules run before review.
Account/card numbers and balances are discarded. Invalid formats, ambiguous
amounts and malformed rows stop the entire source import without writing any
transactions. The common review supports duplicates, editing and cancellation.
No cookies, credentials or session tokens enter the Capital One page from Ledger.
The website integration is provisional until verified against your signed-in
export form; automated tests use synthetic fixtures, not a live bank account.
CSV layout references: [Capital One credit parser](https://github.com/mtlynch/beancount-capitalone)
and [Capital One checking CSV example](https://github.com/wgwz/capital-one-recurring-expenses).

The Import data page supports selecting a date range and importing from an
authenticated Credit Karma, Amazon, AliExpress, eBay, Walmart, Venmo, Apple Card,
Capital One, or Schwab Checking session without first saving a file. This
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
segments. Apple Card and Capital One drive CSV export forms. Website importers use the browser's existing signed-in session; Ledger never
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

All file and browser imports use this staged session workflow. The retired
direct-upload API (`/api/import`) always returns HTTP 410 and writes nothing;
use a staged import session instead.

Closing an uncommitted review with Cancel, X, Escape, or an outside click asks
before discarding the imported data. Cancel that prompt to keep reviewing with
your edits and selections intact. Confirming discard saves nothing.
Successful individual and bulk changes show an **Edited** badge, helping you
track manually reviewed rows alongside **No rule matched** or **Duplicate**.
This badge belongs only to the current review; it does not add a saved tag.
Edited rows keep **No rule matched**, but no longer have the yellow background.

The icon-only flag next to **Edit** marks a transaction for follow-up and gives
it a soft red highlight. Click again to remove the flag. Turn on **Filters →
Flagged only** to see flagged rows; turn it off to see all rows matching your
other filters. This is available across shared
transaction lists, including the all-time Transactions page. Flags on saved
transactions update instantly in memory and save together when the transaction
list closes, with revision protection and one safety backup. Opening an editor
does not flush these flags; other edits preserve them. A failed save keeps the
list open and the pending flags available to retry. On the full-page Transactions
view, flags save when following a Ledger navigation link; **Save flags** also
lets you save without leaving. Reloading or closing the browser warns while flags
remain unsaved rather than relying on an unreliable background write.
Import and proposed-change reviews keep flags staged until their final confirmation.
Flags do not change amounts, import inclusion, or budget totals. **Edit multiple**
also supports setting or clearing flags for selected transactions.

Before duplicate detection and review, Ledger applies classifications saved
on the dedicated **Classifications** page. If no rule matches, the importer-provided
category is retained and the subcategory stays blank.

CSV imports use this exact header:

```text
date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links
```

The app assigns a shared `createdAt` timestamp to the selected valid rows only
after the user confirms the import.

The CSV importer applies saved classification rules by default. Clear **Apply
classification rules** before opening the review when the CSV's existing
category, subcategory, and other supplied values should be preserved exactly.

Credit Karma, AliExpress, eBay, and Venmo can change their private APIs; Amazon and Apple can change their
page markup. Any source can present login/CAPTCHA challenges. Closing an active
source tab cancels that import. See
[`ledger_data_importer_extension/README.md`](ledger_data_importer_extension/README.md)
for implementation and attribution details.

Walmart requires companion extension **0.9.1 or newer**. After updating the code,
reload Ledger Data Importer in `chrome://extensions`, accept the Walmart site
permission, restart the Python backend, and reload Ledger's Import data page.
Keep the Walmart tab open. Its own Next-page controls drive collection; a passive
observer reads the resulting history data and the collector reads receipt pages.
It does not bypass login or CAPTCHA checks, replay signed requests, or send cookies,
addresses, or payment-card details to Ledger. Missing receipt fields, stalled or
repeated pages, and safety-limit failures stop collection rather than importing a
misleading partial result. Website changes may require updates to the collector.

Companion 0.9.1 fixes Walmart/Capital One helper loading across Chrome's separate
page and extension contexts. If Walmart reports `Cannot read properties of
undefined (reading 'history')`, reload Ledger Data Importer in `chrome://extensions`,
refresh Ledger until the connected version is **0.9.1**, and start a fresh import.
This extension-only fix does not require a backend restart or a transaction export
for troubleshooting. Regression tests load actual manifest entries in separate
globals and simulate Chrome's script-path deduplication.

### Duplicate handling

Imports identify existing transactions by normalized `date` and `amount` while
also counting repeated occurrences. For example, if a source contains two
transactions for the same amount on the same date and neither exists in the
CSV, both are marked new. Importing that range again marks both as duplicates.
If only one already exists, one occurrence is a duplicate and one is new.

This deliberately ignores descriptions so an edited description does not cause
the source transaction to be imported again.

## Explore all transactions

Open **Transactions** from the navigation menu or visit `/transactions` to search
the complete transaction history, without choosing a reporting month or year.
Search descriptions and notes, filter category and subcategory, account name or provider,
and combine tags inside **Filters** using **Match any** (OR) or **Match all** (AND).
Filters update results and totals immediately, without Apply or Refresh buttons.
**Reset** clears the expanded filters immediately; collapsing them keeps your selections.
Incomplete or reversed date ranges show an inline message and retain the last
valid date range until corrected. Selected tags
appear as removable chips and count toward the Filters indicator. Optional start
and end dates narrow the results inclusively; leaving both blank searches all time.

The matching spending, income, and net totals update with the filters, along
with a category spending breakdown. This makes the page useful for lifetime
questions such as spending on bikes or for reviewing the purchases that made up
a particular trip. A transaction carrying several selected tags is counted only
once. Refund and internal-transfer treatment follows the main dashboard's rules.

Groups are separate from tags: a transaction has at most one group, such as
`Hawaii 2022` or `Canyon Aeroad`, but can have many tags such as `Bike` and `Tools`.
The transaction editor provides a searchable group selector with inline creation;
names are whitespace-normalized and reused case-insensitively. New groups become
durable only when the enclosing transaction or import is saved. A distinct group
badge appears on transaction rows. Choose Group inside **Filters** to narrow a list or the
all-time spending totals and category breakdown. Existing `(group)` tags are
never converted or removed automatically.

The list uses the same transaction rows, filter/sort controls, and editor as
Ledger's transaction dialogs. Results are shown 50 per page; the summary always
includes all matching rows, not just the current page. Editing a transaction
returns to the current search so it can be reviewed in context.

### Compare groups

On **Transactions → Compare groups**, choose two to four groups to compare bike
builds, trips, or projects. Search the group picker and toggle names; totals
update immediately. Leave the optional date range blank for all recorded history,
or set a shared inclusive range. Comparison has its own scope: the Transactions
search, tags, and account filters do not carry over. Your selection and range are
remembered on this browser.

Selected groups keep their colors when you add or remove another group. New
selections take the next available palette color, and the assignments are
remembered when you return. The same stable-color behavior applies to dashboard
categories, subcategories, and year-over-year lines.

Spending cards show exact totals and dollar differences from a reference group
you can change. Unstacked horizontal bars share one dollar scale, while the
category table shows where costs differ. Each category row has its own shared
scale across groups. Negative expense credits reduce spending; refunded and
internal-transfer rows are excluded from totals. Income is shown separately.
A dash means there are no relevant transactions, not a zero-dollar total.
Recorded activity dates describe the available data, not a guaranteed complete trip.

Select **View transactions**, a spending bar, or a category amount to inspect
the underlying group through the existing filter/sort and editing tools. **Back
to comparison** returns to the updated comparison, preserving your previous
Transactions search. Choosing groups and changing comparison controls never
modify transaction data.

## Edit transaction data

Category, subcategory, account name, account type, and provider use searchable
dropdowns with existing values and an **Add new…** option inside the menu.
Subcategory choices follow the selected category and include saved taxonomy values.
Leave Category blank to search all subcategories. Choosing an existing subcategory
fills its parent category (the first alphabetically if several share that name).
An already-selected category stays unchanged. In bulk edits, the inferred Category
is shown as an action and included in the before/after review.
Existing names are reused case-insensitively. New values stay in the draft until
you save the transaction or confirm its import; Cancel discards them. Changing
category never silently clears the current subcategory or account details.
The same dropdowns are available when editing multiple transactions.

Open any category or the all-transactions view and select **Edit** on a
transaction. Transaction-list dialogs can be sorted by date, description, or
absolute cost in either direction. Every user-editable field can be changed, including the optional
subcategory, tags, freeform notes, and flags. The editor presents existing tags as
alphabetized toggle buttons. Select any number of them, or use the dashed **New tag**
control to create and select another tag without leaving the editor. New tags remain
staged until the transaction or import is saved. A transaction can have multiple tags.
Marking a transaction as **Refunded** keeps its original amount
for duplicate detection while treating it as $0 in dashboard totals. The import
timestamp is system-managed. After editing from a transaction list, Ledger returns to the refreshed
list instead of closing the workflow. The same form supports
permanent deletion after an explicit confirmation. Use **Add transaction** on
the dashboard to create a row manually.

Every mutation is validated, revision-checked, and saved with an atomic file
replacement. If another browser or process changes the CSV first, Ledger rejects
the stale write instead of silently overwriting newer data.

### Edit multiple transactions

Every transaction list has **Edit multiple**, beneath the modal's close button
or in the Transactions results header. Selection controls appear only while
editing multiple rows; **Done editing** returns to the normal list. Enter selection mode, check the
rows you want, then choose **Edit selected**. **Select visible** selects only the
currently displayed rows (the current page on the all-time dashboard). Selection
survives filtering and sorting; the toolbar reports selected rows outside the view.
Click a checkbox, then **Shift-click** another to select or clear every visible
row between them. The range follows the displayed order and stays on the current
page; hidden rows are not affected. Changing the displayed order resets the range
anchor. This also works with import inclusion checkboxes, independently of bulk
selection, and never saves anything until you confirm the enclosing action.
Add only the fields you want to change and review the exact before/after values
before confirming. All user-editable fields are available, including group, date,
amount, notes, and refund/transfer treatment; `createdAt` remains immutable.
Tags offer Add, Remove, Replace, and Clear, so adding `Bike` preserves other tags.
Blank optional fields explicitly clear those fields.

Existing transactions are updated together after revision validation and a safety
backup. No-op edits do not create a snapshot or rewrite the file. Bulk edits in
import and classification previews only update that staged review; final import
or classification confirmation is still required. Import inclusion checkboxes
and bulk-edit selection are independent. Cancel, Escape, X, and backdrop dismissal
discard the bulk draft without writing anything.

For saved transactions, **Delete selected** opens a confirmation listing the
exact rows to remove, including selected rows hidden by filters or on another
page. Nothing is deleted until **Delete permanently** is confirmed. The whole
selection is revision-checked and deleted atomically after a safety backup.
Cancelling keeps both your transactions and selection. Lists, totals, and import
history counts update after deletion. In staged import, classification, and
transfer reviews, deletion is intentionally unavailable; uncheck import rows
to omit them, or close the review and delete saved rows from a transaction list.

## Exports and safety snapshots

Open **Settings → Exports**, select an inclusive start and end date, and export
that range as a CSV. The page shows how many transactions match before enabling
the download. Exported files use the Ledger CSV-import schema and omit
`createdAt`, so they can be reviewed and imported again later.

Open **Settings → Preferences** to switch dark mode on or off and choose when
dashboard summary totals use magnitude abbreviations. The abbreviation slider
offers None, K, M, B, and T and defaults to M; values beyond trillions use
scientific notation unless abbreviations are disabled. Preferences are stored
in the current browser, and the saved theme is applied before page styles load
so it persists between Ledger pages without a light-theme flash.
Ledger still creates internal safety snapshots in `data/backups/` before risky
bulk mutations such as import-batch removal, classification application, or
schema migration. These are implementation safeguards; portable date-range
exports are the user-facing recovery and transfer workflow.

## Import history

Every transaction committed by one import receives the same UTC `createdAt`
timestamp. Open **Settings → Import history** to see those batches ordered newest
first, five imports per page, and the number of rows still associated with each import. Legacy and
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
match. To keep matching responsive, Ledger rejects backreferences and repeated
groups that contain another repetition or alternation, including patterns using
Python's verbose-mode whitespace and comments. This conservative policy blocks
known high-risk structures; it is not a guarantee of linear-time regex matching.
Safe Python features such as scoped flags, named groups, and character classes
remain supported. If an older saved library contains a now-rejected pattern,
Classifications still shows every rule for repair and Export still works;
opening the page does not change the file. Matching, import previews, and
applying rules remain blocked until the library passes validation. Edit and save
an affected rule normally. If several matchers need repair, export the library,
correct all reported matchers in that JSON copy, then use Import to explicitly
replace the library. Rejected rules are never saved or executed.
Each rule can also include optional freeform notes explaining its
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

## Taxonomy

Open **Settings → Taxonomy** to see the complete two-level category structure.
Ledger merges categories and subcategories found in the current transaction CSV
with values created manually in this settings tab. Category cards show transaction
counts and nest their subcategories as compact labeled chips, while search filters
both levels of the structure.

Use the dashed card at the end of the grid to enter a new top-level category.
Each existing category ends with a matching dashed subcategory field. Enter a
name and click **+** or press Enter to save it. Manually created values are saved
atomically in `data/taxonomy.json`, so they remain available before any transaction uses them.
They are also included in the category and subcategory suggestions shown by the
dashboard transaction editor. Categories and subcategories are kept alphabetically
ordered and duplicate names are rejected case-insensitively. Categories without
subcategories are hidden by default and can be revealed with the taxonomy filter.
Unused categories and subcategories can be deleted from their card or chip after
confirmation. Values referenced by transactions must be reclassified before
they can be deleted; taxonomy deletion never edits transaction data.

Use **Review unclassified** to open an all-dates modal containing every row with
a blank subcategory. Shared transaction rows identify excluded internal
transfers and mark other rows **No rule matched**, while retaining refund and
custom-tag badges. Search, filter, and sort with the same compact toolbar used
by dashboard transaction lists. Closing the modal preserves the current
Classification page and any draft being edited.

## Master CSV schema

If the master CSV does not exist, the dashboard offers a direct link to Import
data. Confirming at least one staged transaction from any supported import source
creates the file automatically before appending the selected
rows. Cancelling a preview does not create or modify the file. An existing file is
never replaced by initialization.

```text
date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,createdAt,id,links
```

Ledger automatically and atomically adds missing optional `subcategory`, `notes`, `tags`, `group`, `flags`, and
`createdAt`, `id`, and `links` columns when it opens an older database. Notes may contain commas or multiple
lines. Tags are optional comma-separated labels; surrounding whitespace is
trimmed and repeated labels are removed case-insensitively. Flags are normalized,
comma-separated identifiers, including `refunded`, `internal-transfer`, and
`flagged` (follow-up only).
`createdAt` is an immutable UTC ISO 8601 timestamp assigned
to imported rows; it remains blank for manual and legacy rows.
A snapshot of the original CSV is placed in `data/backups/` before schema migration.
Older CSV imports without `group` remain accepted and receive a blank group.
Each transaction has an immutable unique `id`. `links` is an optional JSON array
stored on the original purchase; leave both fields blank when making a new CSV
by hand. Older CSV layouts without these fields remain supported.

Debit expenses and Amazon purchases are positive. Credits, refunds, and income
are negative in the CSV. In the interface, income is displayed as a positive
value and net total is calculated as income minus spending: a surplus is green
and a spending deficit is red.

Transaction rows show money received as **+$25.00**, including income, refunds,
repayments, and incoming transfers. Purchases remain **$25.00**. The plus sign
does not rely on green text, so it remains clear on highlighted rows. Excluded
credits retain the plus sign along with their muted, struck-through amount.

### Dashboard periods and totals

- **Total spent** is the net sum of visible, non-income transactions. It uses a
  neutral card background.
- **Total income** uses transactions in the `Income` category and is displayed
  as a positive number even though those values remain negative in the CSV.
- **Net total** is income minus spending. Positive values use a light-green
  background; negative values use a light-red background.
- Transaction lists default to latest-first, support description/notes search and
  category, subcategory, tag, account name, and provider filters, and can be sorted by date,
  description, or absolute cost in ascending or descending order.
- All transaction rows use the same rounded card shape, with a subtle neutral
  border and background by default. Import warnings and follow-up flags change
  the card's colors without changing its spacing or shape.
  Expanded refund matches and linked transactions use outlined inset cards,
  with clearly separated month/day/year dates and wrapping account details.
- Transaction dialogs keep description/notes search and sorting visible. Search
  is case-insensitive, matches literal text in either field, and supports phrases
  across line breaks in notes without changing the saved text. Less-frequent
  filters expand as a full-width section below the search/sort bar, with category beside its dependent
  subcategory and account name beside provider. Active filters appear as
  individually removable chips. The tag filter lists tags present in the
  transactions available to the current dialog.
  Selections and Reset apply immediately while the section stays open. Click Filters
  again or press Escape to collapse it without clearing selections. In transaction
  modals, a generous viewport-sized default leaves room for several rows. Opening
  or closing Filters keeps the modal's size unchanged, and
  filters stay fixed above an independently scrolling transaction list;
  on short screens the controls can scroll separately. The header and final
  actions stay accessible even when no rows match. This only
  filters the list; import and transaction-edit confirmations remain explicit.
- Confirmed refund matches preserve both source transactions and link the credit
  to its purchase. Re-importing a handled credit shows **Refund already handled**,
  unchecked as a duplicate. Old `refund-receipt-YYYY-MM-DD-<cents>` flags remain
  supported for refunds from releases that omitted the credit; never strip these
  receipts or invent a missing source transaction. New matches do not create
  receipt flags. Links and selected imports use one revision-checked, backed-up
  atomic CSV write.
- On unlinked transactions, the `refunded` flag keeps the row visible while
  contributing $0 to category, spending, income, net, and annual-chart totals.
  Linked transactions use their relationship's effective amount instead;
  unlink before changing budget treatment.
- The default reporting period is the latest month containing at least one
  budget-visible transaction.
- **Today** beside the period controls switches from any dashboard view to the
  current month and year in your device's local time. It also works when that
  month has no transactions, and the chosen period is remembered on navigation.
- **Monthly** view filters the dashboard by a selected month and year. Its
  breakdown can group spending by top-level category or explore custom tags.
- In tag mode, select multiple tags and choose **Match any** (logical OR) or
  **Match all** (logical AND). Matching totals count each transaction once even
  when it carries several selected tags. The monthly Tag Explorer is the full
  tag breakdown; it does not add a secondary category-card drill-down.
  In Monthly and Annual, the three summary cards also reflect the tag query,
  including tagged income. No selected tags or no matches shows zero; switching
  back to By category restores the full-period totals.
- **Annual** view summarizes the selected year. Category mode retains the
  category/subcategory stacked chart and exact-dollar table.
  Selecting a category redraws the monthly stacks by subcategory; selecting a
  subcategory isolates it, and the breadcrumb returns to higher levels. An
  expandable dollar table compares every category and subcategory across all
  twelve months plus an annual total. Its net chart shows monthly surpluses in
  green and monthly deficits in red. Monthly spending and net bars smoothly
  rise or fall when their year, category, subcategory, or tag filter changes.
- **Year over year** compares a start/end year range with selectable year
  lines. Switch between cumulative and per-month values, and compare spending,
  income, or net total. The lines and points smoothly move between chart modes.
  Each year always continues through its own latest imported month. The summary
  and exact-value table use the same scope, and selecting a chart point opens
  that month's matching transactions.
- Annual tag mode replaces overlapping stacks with one combined bar per month.
  Its table reports matching transaction counts and unique spending for each
  month and the full year. Annual mode does not repeat the monthly category-card
  section beneath its charts.
- Transactions without tags appear as **Untagged**. `Untagged OR Bike` is a valid
  query, while `Untagged AND Bike` is impossible; the UI disables that combination.
- Ledger remembers the selected view, year, month, year-comparison range,
  selected comparison years, metric, and chart mode, breakdown dimension, selected tags,
  tag match mode, and annual category filter in
  the current browser, including annual subcategory drill-down. Returning from
  Import data or Settings restores that reporting context when it is still
  available in the transaction data.

### Reconcile: transfers, refunds, and repayments

Open **Settings → Reconcile → Find matches** to review internal-transfer pairs
and possible full refunds. Refund suggestions match opposite amounts within the
preceding 90 days; a price match is not proof. Expand **Possible refund**, choose
the correct purchase, and click **Link selected purchase** below the matches.
The row shows **Refund link staged**; **Save reviewed changes** is the final
confirmation. **Undo refund link** removes a staged choice without saving it.
Multiple candidates require an explicit choice. Flagging a transaction preserves
its suggestion, selected purchase, and expanded details.
Enable **Match nonzero decimal** before scanning to skip whole-dollar transfer
and refund suggestions such as $10.00. The option applies to this reconciliation
scan, not saved links or manual linking; it is off initially.

For a partial refund, restocking fee, or shared expense, edit the **original
positive-amount purchase** and expand **Refunds & repayments**. Choose Refund,
Internal transfer, or Repayment; search credits by description/notes and select
the matching records. Refunds and transfers are one-to-one. Repayments allow
several credits against one purchase. Linked records and search results use the
same transaction cards as the rest of Ledger. Remove a link with **Unlink**.
Selection stays staged until the editor (and any enclosing review) is saved.

You can edit either side of any relationship under **Refunds & repayments**.
The editor identifies the role from the amount: expenses are positive in storage,
and money received is negative (displayed with a **+** in lists). Choose the link
type explicitly. An expense can link several repayments; a received credit can
link only one original expense. Existing repayments on that expense are preserved.
Refunds can be partial, but internal transfers require equal and opposite amounts
in different accounts. Unlink before choosing a different expense; never reuse a
credit on two expenses. Import selections still control what is saved: canceling
or unchecking a credit does not update the expense.

The purchase displays the **net cost** while keeping its original amount in the
CSV. A $100 purchase with an $80 refund contributes $20; a $200 shared purchase
with $60 and $40 repayments contributes $100. The net belongs to the original
purchase's month, category, tags, and group. Linked credits remain on their own
posting dates, greyed and struck through, but do not count as income or credits
again. Expand either row to see its counterpart(s). An over-repayment can produce
a negative net expense. Internal transfers must balance exactly; record fees as
separate expenses.

One credit cannot belong to two purchases, and links cannot form chains or loops.
Unlink from the original purchase before switching to a manual budget override.
Deleting a linked row removes its link, so surviving records count at their
remaining net/source amount. Deletion still requires confirmation and a backup.
Exports include the entire linked set, even when a counterpart is outside the
chosen date range, and display that expanded count. Import the whole linked set
to preserve its net cost; incomplete or ambiguous links are rejected.

Ledger does not exclude every transaction categorized as `Transfer`. Detection
proposes matched transactions from
different accounts with equal and opposite nonzero amounts
that post within five days. At least one side must be categorized as `Transfer`
or have a description that looks like a transfer or account payment. The other
side may retain any source category, because exports sometimes label bill
payments as income or business services. This also handles credit-balance refunds
that flow from a card back to a bank account. Matching is one-to-one and works
across month and year boundaries. Unmatched transfers, such as
Venmo or Zelle payments, remain visible and affect the budget normally. Every
transaction editor can mark a row as an internal transfer or force it
to count normally. These choices are stored as `internal-transfer` and
`include-in-budget` flags; the original amount always remains in the CSV.

**Detection runs only during import review or when requested in Settings.**
Confirmed pairs are persisted as durable ID-based links, so dashboard loads do
not rerun matching. Existing exact two-member `transfer-pair-*` flags are upgraded
to links during the backed-up schema migration. Unpaired legacy exclusion flags
stay intact. Changing a description never breaks a link. On unlinked records,
**Eligible for detection**, **Internal transfer**, and **Count normally** remain
available as manual budget overrides for incomplete historical data.

Imports match selected incoming rows against each other and existing unmatched
transactions. The review shows any existing counterparts that will also be
linked. Editing or unchecking an incoming row recalculates the proposal. Only
confirmation saves the selected rows, reviewed links, and affected existing-row
flags together, with a safety backup of an existing database. Cancelling saves
nothing.

Open **Settings → Reconcile → Find matches** to scan all
saved transactions. The shared review modal supports search, filters, sorting,
and staged individual or bulk edits, and shows the exact proposed changes.
The **To review** toggle starts on; **Already reconciled** starts off and
reveals saved links and legacy exclusions. Both only affect visibility, not
what gets saved. Editing a saved transfer moves it into proposed changes.
Confirm to save them; Cancel, Escape, X, or clicking outside discards the review.
Already excluded transactions and explicit Count normally overrides are not
reused as matching candidates.

After upgrading, Ledger asks for this one-time review before showing dashboard
totals under the saved-only policy. Startup may migrate a supported older
schema and exact saved pairs with a safety backup; new transfer/refund detection
still requires explicit review.
Completion is recorded in `data/transactions.transfer-review.json`; transfer
status itself stays in `transactions.csv`. A new database created by a confirmed
import needs no extra review. If you later restore older data without saved
transfer flags, run the Settings scan again.

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

## Project structure

```text
app/server.py       Local HTTP server and atomic CSV persistence API
app/importers.py    Bank/account and merchant-order source parsers
app/reconciliation.py
                    Durable transaction IDs, link validation, and effective budget amounts
app/refunds.py      Refund suggestions and legacy receipt deduplication helpers
app/index.html      Monthly and annual dashboard
app/transactions.html
                    All-time search, tag/group exploration, and matching summaries
app/transactions.js All-time transaction-page behavior using the shared transaction UI
app/transactions-model.js
                    All-time filter, summary, and group comparison calculations
app/transactions.css
                    Theme-aware styling for the all-time transaction dashboard
app/group-comparison.js / .css
                    Read-only multi-group comparison workspace and visualizations
app/navigation.js  Shared accessible navigation-menu behavior
app/settings.html  Exports, import history, Reconcile, taxonomy, and preferences
app/classifications.html
                    Dedicated transaction-classification workspace
app/settings.js    Settings and classification-workspace behavior
app/upload.html     Data import page
ledger_data_importer_extension/
                    Unpacked Chrome companion extension for direct imports
  amazon_extension/ Amazon scraper and retained upstream popup assets
  creditkarma_extension/
                    Credit Karma-specific collector
  aliexpress_extension/
                    AliExpress signed API client
  ebay_extension/   eBay purchase-history collector
  venmo_extension/  Venmo statement collector
  apple_card_extension/ Apple Card export-form automation
  capitalone_extension/ Capital One CSV capture and export-form assistance
  walmart_extension/ Walmart purchase-history and receipt collector
  schwab_extension/ Schwab Checking user-guided CSV capture and normalization
  shared/           Ledger toolbar popup, connection settings, icons, bridge, and coordinator
tests/              Isolated standard-library regression tests
docs/current-workflows.md
                    Linked transactions, review workflows, connections, and verification limits
deploy/             Optional Debian/systemd deployment guide and update helper
raw_data_files/     Optional private source exports (ignored by Git)
data/               Master CSV database and backups (ignored by Git)
  transactions.csv
  classifications.json
  taxonomy.json
  backups/
```
