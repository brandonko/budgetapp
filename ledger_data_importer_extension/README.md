# Ledger Data Importer

Capital One is available in companion **0.9.1+**. Reload the extension and accept
its `verified.capitalone.com` and `myaccounts.capitalone.com` permissions. Start
from Ledger's Capital One tab, sign in, and select an account. Export-form
automation and passive CSV capture live in `capitalone_extension/`; unfamiliar
forms can be operated manually, or the downloaded CSV can be selected in Ledger.
Nothing is saved before the shared transaction review is confirmed. See
[Capital One details](capitalone_extension/README.md) for limitations and privacy.

This unpacked Chrome extension connects Ledger's local **Import data** page to
authenticated Credit Karma, Amazon, AliExpress, eBay, Walmart, Venmo, and Apple Card sessions.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this `ledger_data_importer_extension` directory.
5. Reload Ledger's Import data page.

Ledger will show **Companion extension connected** when the bridge is ready.

## How it works

Ledger creates a random, expiring, source-scoped import session when a direct
import starts. For Credit Karma, the extension opens Transactions, fetches all
transactions in the selected range, and constructs the subset of a BudgetLens
bundle needed by Ledger. For Amazon, it opens order history and runs the
selected date-range item export. It sends the resulting JSON directly to the
matching Ledger session, where it is parsed and classified for review. Ledger
changes the master CSV only after the user confirms selected preview rows.

For AliExpress, the extension uses Chrome's cookies permission to read the active
AliExpress signing token and calls the order-list and order-detail MTop endpoints.
Raw cookies and tokens remain in Chrome and are never sent to Ledger or saved to disk.

For Venmo, the extension opens the Statements page and uses that page's signed-in
session to request official statement CSVs in monthly segments. Only the CSV contents
are sent to Ledger; Venmo cookies and credentials remain in Chrome.

For eBay, the extension opens Purchase History and uses that page's signed-in
session to read itemized purchase history. Only normalized order and item data
are sent to Ledger; eBay cookies and credentials remain in Chrome.

For Apple Card, the extension opens `card.apple.com`, waits for the user to sign
in when necessary, drives Apple's official Export Transactions form using the
Ledger date range and CSV format, and captures the generated CSV for Ledger.
Apple Account credentials remain in Apple's page and are never sent to Ledger.

The session token is never placed in a source-site URL, and Ledger redacts it from
HTTP request logs. Chrome's session storage is primary; while an import is
active, the extension also keeps a recovery copy in extension-local storage so
a suspended background worker cannot lose a long-running scrape. The copy is
removed on completion or cancellation and rejected after two hours. The server
token itself expires after one hour without progress. The extension accepts
requests only from an `http://127.0.0.1` or `http://localhost` Import data page.

Closing the source tab ends its import.

## Source integrations

The extension is organized by responsibility:

```text
amazon_extension/       Amazon scraper, popup, and current extension icons
creditkarma_extension/  Credit Karma authenticated transaction collector
aliexpress_extension/   AliExpress authenticated order API client
venmo_extension/        Venmo authenticated statement collector
ebay_extension/         eBay authenticated purchase-history collector
walmart_extension/      Walmart receipt reader, passive list observer, and coordinator
apple_card_extension/   Apple Card official CSV export automation
shared/                  Ledger bridge and cross-source import coordinator
_locales/                Amazon popup catalogs (Chrome requires this root path)
manifest.json            Permissions and module registration
```

The Amazon scraper, extension popup, localization, and icons come from
[Order History Exporter for Amazon](https://github.com/xenolphthalein/order-history-exporter-for-amazon)
version 1.3.0. That project is dedicated to the public domain under the
[Unlicense](LICENSE). Ledger replaces the release's background worker and adds
the localhost bridge; it deliberately leaves the upstream scraper bundle intact
so fixes can be compared and updated more easily.

This integration is not affiliated with or endorsed by Amazon. Amazon page
changes, login challenges, or anti-automation measures can interrupt an import.

The Credit Karma integration is a clean implementation of the BudgetLens
transaction export behavior documented by
[CreditKarmaExtractor](https://github.com/cbangera2/CreditKarmaExtractor). No
CreditKarmaExtractor source code is bundled because that repository does not
currently declare a software license. Credit Karma's private API may change.

The AliExpress MTop request and payload behavior is adapted from
[nrbrook/AliExpress-Order-Export](https://github.com/nrbrook/AliExpress-Order-Export),
copyright 2026 Nick Brook and distributed under the MIT License. Its notice is
included in [`aliexpress_extension/LICENSE`](aliexpress_extension/LICENSE).

The Venmo integration is a clean implementation around Venmo's statement download.
It does not include code from third-party Venmo extensions. Venmo's private endpoint
and sign-in flow may change.

The eBay integration is an independent implementation informed by the public behavior
of the eBay Purchase History Downloader extension. It does not bundle that extension's
code. eBay's private purchase-history endpoint and response shape may change.

The Walmart integration is independently implemented from the data shapes and page
behavior documented by [Walmart Invoice Exporter](https://github.com/hppanpaliya/Walmart-Invoice-Exporter).
No source code or dependencies from that project are bundled. See
[`walmart_extension/README.md`](walmart_extension/README.md) for supported receipts,
limitations, and the privacy boundary. Reload this unpacked extension after updating
to 0.9.1 and accept its Walmart.com permission if prompted.

Version 0.9.1 fixes Walmart/Capital One startup: MAIN observers are self-contained,
and parser helpers are loaded only in ISOLATED. Never register one static JS path
in both worlds: Chrome can skip its second injection. The regression suite now
exercises actual manifest loading, separate globals, and path deduplication.
