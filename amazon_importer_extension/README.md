# Ledger Amazon Importer (experimental)

This unpacked Chrome extension connects Ledger's local **Upload data** page to
an authenticated Amazon order-history tab. It is intentionally kept inside the
repository while the direct-import workflow is evaluated.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this `amazon_importer_extension` directory.
5. Reload Ledger's Upload data page.

Ledger will show **Companion extension connected** when the bridge is ready.

## How it works

Ledger creates a random, expiring import session when the user clicks **Import
Amazon orders**. The extension opens Amazon order history, waits for the user to
sign in if necessary, and runs the selected date-range export in that Amazon
tab. It then sends the JSON directly to that one Ledger session. Ledger parses,
deduplicates, and atomically merges the item transactions into the master CSV.

The session token is never placed in an Amazon URL, and Ledger redacts it from
HTTP request logs. Chrome's session storage is primary; while an import is
active, the extension also keeps a recovery copy in extension-local storage so
a suspended background worker cannot lose a long-running scrape. The copy is
removed on completion or cancellation and rejected after two hours. The server
token itself expires after one hour without progress. The extension accepts
requests only from an `http://127.0.0.1` or `http://localhost` Upload data page.

Closing the Amazon tab ends the import. The manual Amazon JSON uploader remains
available as a fallback.

## Upstream code

The Amazon scraper, extension popup, localization, and icons come from
[Order History Exporter for Amazon](https://github.com/xenolphthalein/order-history-exporter-for-amazon)
version 1.3.0. That project is dedicated to the public domain under the
[Unlicense](LICENSE). Ledger replaces the release's background worker and adds
the localhost bridge; it deliberately leaves the upstream scraper bundle intact
so fixes can be compared and updated more easily.

This integration is not affiliated with or endorsed by Amazon. Amazon page
changes, login challenges, or anti-automation measures can interrupt an import.
