# Ledger Data Importer

**Schwab Checking** is available in companion **0.11.0+**. Reload the extension,
accept the `client.schwab.com` permission, restart the Ledger backend, and refresh
Import data. Start from the Schwab Checking tab, select one checking account in
Schwab, and export its transaction history as CSV. The extension captures it for
Ledger review. See [Schwab Checking details](schwab_extension/README.md).

Capital One is available in companion **0.9.1+**. Reload the extension and accept
its `verified.capitalone.com` and `myaccounts.capitalone.com` permissions. Start
from Ledger's Capital One tab, sign in, and select an account. Export-form
automation and passive CSV capture live in `capitalone_extension/`; unfamiliar
forms can be operated manually, or the downloaded CSV can be selected in Ledger.
Nothing is saved before the shared transaction review is confirmed. See
[Capital One details](capitalone_extension/README.md) for limitations and privacy.

This unpacked Chrome extension connects Ledger's **Import data** page to nine
authenticated website sources: Credit Karma, Amazon, AliExpress, eBay, Walmart,
Venmo, Apple Card, Capital One, and Schwab Checking. The page may be on loopback
or an explicitly trusted server with current Chrome site permission. Ledger CSV
is a separate app import option, not an extension source.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this `ledger_data_importer_extension` directory.
5. Reload Ledger's Import data page.

Ledger will show **Companion extension connected** when the bridge is ready.

## Ledger toolbar popup

Version **0.10.2** replaces the old Amazon-only toolbar popup with Ledger's own
launcher. Reload the extension in `chrome://extensions`, then click its Ledger
icon. Choose your **Ledger server** and **Open Import data** to start any source
import. The popup lists all nine website sources and links to **Ledger
connection settings**; you do not need to visit Amazon first.

The popup prefers the current trusted Ledger page, then your last chosen server,
then a trusted saved server, with `http://127.0.0.1:8000` as the local fallback.
Keep the Python server running at that address. Only explicitly trusted remote
origins with site permission are offered; opening the popup grants no permissions
and starts no imports. Dates, sign-in prompts, progress, and final review still
belong to Ledger's Import data workflow. The popup follows your device's light or
dark appearance. No backend restart is needed for this popup update.

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
requests from an `http://127.0.0.1` or `http://localhost` Import data page,
or an exact HTTP/HTTPS origin explicitly added in Ledger connection settings.

## Connecting to a home server

Reload Ledger Data Importer in `chrome://extensions` after updating its files.
Open its popup and choose **Ledger connection settings** (also available through
the extension's **Details → Extension options**). Enter your server address,
for example `http://192.168.1.142:8000`, click **Trust server**, and allow Chrome's
site-access request. Refresh the Ledger Import data page afterward.

If an address is already listed, choose **Reconnect** beside it instead of adding
it again. **Allow site access** indicates Chrome permission is missing. Starting
with 0.11.1, the worker restores missing dynamic bridge registrations on startup,
extension reload/update, and changes to trust or permissions. Reconnect also
attaches the bridge to already-open, exactly trusted Import pages. It does not
start an import or grant new permissions in the background. Reload the extension
after updating, then refresh Ledger if it still shows disconnected.

The saved address includes its scheme and port. A different port, HTTP/HTTPS
scheme, hostname, or IP needs its own entry. Localhost remains automatic.
Remove entries here to block new connections. Cancel active imports before
removing their server. Browser host permissions span ports, but Ledger checks
the exact saved origin before detection or imports. These settings do not add
server authentication or configure a firewall, TLS, or Proxmox networking.

Closing the source tab ends its import.

## Source integrations

The extension's Ledger mark is stored as outlined vector artwork in
`shared/icons/ledger.svg`, matching the app's dark-theme green and Georgia L.
Chrome uses the accompanying 16/32/48/96/128-pixel PNG exports for its toolbar
and extension pages. To rebuild these assets on Windows, run
`./ledger_data_importer_extension/shared/build_icons.ps1` from the repository root.
No image library or application dependency is required.

The extension is organized by responsibility:

```text
amazon_extension/       Amazon scraper and retained upstream popup assets
creditkarma_extension/  Credit Karma authenticated transaction collector
aliexpress_extension/   AliExpress authenticated order API client
venmo_extension/        Venmo authenticated statement collector
ebay_extension/         eBay authenticated purchase-history collector
walmart_extension/      Walmart receipt reader, passive list observer, and coordinator
apple_card_extension/   Apple Card official CSV export automation
capitalone_extension/   Capital One CSV capture and export-form assistance
schwab_extension/       Schwab Checking user-guided CSV capture and normalization
shared/                  Ledger popup, connection settings, icons, bridge, and coordinator
_locales/                Amazon popup catalogs (Chrome requires this root path)
manifest.json            Permissions and module registration
```

The Amazon scraper and retained upstream popup, localization, and icon assets come from
[Order History Exporter for Amazon](https://github.com/xenolphthalein/order-history-exporter-for-amazon)
version 1.3.0. That project is dedicated to the public domain under the
[Unlicense](LICENSE). Ledger replaces the release's background worker and adds
the Ledger page bridge; it deliberately leaves the upstream scraper bundle intact
so fixes can be compared and updated more easily.
The toolbar uses the Ledger-owned `shared/popup.html`, not the retained Amazon
popup. Keep cross-source UI here rather than inside a source integration.

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
