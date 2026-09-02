# Ledger Data Importer

This unpacked Chrome extension connects Ledger's local **Upload data** page to
authenticated Credit Karma, Amazon, and AliExpress sessions.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this `ledger_data_importer_extension` directory.
5. Reload Ledger's Upload data page.

Ledger will show **Companion extension connected** when the bridge is ready.

## How it works

Ledger creates a random, expiring, source-scoped import session when a direct
import starts. For Credit Karma, the extension opens Transactions, fetches all
transactions in the selected range, and constructs the subset of a BudgetLens
bundle needed by Ledger. For Amazon, it opens order history and runs the
selected date-range item export. It sends the resulting JSON directly to the
matching Ledger session, where it is parsed, deduplicated, and atomically merged
into the master CSV.

For AliExpress, the extension uses Chrome's cookies permission to read the active
AliExpress signing token and calls the order-list and order-detail MTop endpoints.
Raw cookies and tokens remain in Chrome and are never sent to Ledger or saved to disk.

The session token is never placed in a source-site URL, and Ledger redacts it from
HTTP request logs. Chrome's session storage is primary; while an import is
active, the extension also keeps a recovery copy in extension-local storage so
a suspended background worker cannot lose a long-running scrape. The copy is
removed on completion or cancellation and rejected after two hours. The server
token itself expires after one hour without progress. The extension accepts
requests only from an `http://127.0.0.1` or `http://localhost` Upload data page.

Closing the source tab ends its import.

## Source integrations

The extension is organized by responsibility:

```text
amazon_extension/       Amazon scraper, popup, and current extension icons
creditkarma_extension/  Credit Karma authenticated transaction collector
aliexpress_extension/   AliExpress authenticated order API client
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
