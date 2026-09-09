# Walmart purchase history

Choose Walmart in Ledger's Import data page, set inclusive order dates and account
labels, and click Import Walmart purchases. The existing companion opens Walmart's
purchase history. Sign in if needed and keep that tab open. Normalized JSON goes
directly to Ledger's staged review, not to Downloads; confirmation is still required.

Requires companion **0.9.1+**. This fixes the `reading 'history'` startup error.
Reload Ledger Data Importer in `chrome://extensions`, refresh Ledger, and start
a new import; no Python restart is needed for this extension-only fix.

- `receipts.js`: ISOLATED-only minimal history/receipt readers. Preserves identical charged lines,
  quantities (including weighted groceries), and original calendar dates.
- `observer.js`: self-contained MAIN-world, passive observation of Walmart's own PurchaseHistoryV3
  fetch/XHR results. Emits only order IDs/dates and pagination, never headers,
  credentials, addresses, or payment methods. It does not replay private API calls.
  Chrome deduplicates static file paths across execution worlds: never add
  `receipts.js` to this MAIN registration as well. Dates from this observer are
  untrusted strings, normalized again by the isolated reader before collection.
- `content.js`: isolated-world collector, actual Next-page clicks and same-origin
  receipt reads. Bounded requests, repeated-page detection, cancellation and explicit
  errors prevent incomplete history from being treated as success.
- `coordinator.js`: source-scoped localhost sessions, tab ownership, progress,
  timeout/error cleanup and short-lived job recovery (no raw receipt storage).

Current support: completed Walmart.com USD purchase-history receipts, including
Walmart+ orders and linked in-store purchases when Walmart exposes their receipts.
The Python parser shares the final receipt total across charged item lines using
exact cents. Tax, fees, tips, and discounts are included; quantity is not multiplied
again. Orders with cancellations, unsettled prices or returns/refunds are reported
as skipped in review. Import their bank transactions separately. Walmart+ membership
fees are not purchase-history receipts. The Credit Karma Walmart filter is enabled
by default; turn it off to retain account charges not covered by itemized imports.

This is not a public Walmart consumer API or an affiliated integration. Walmart
markup and response shapes can change. Login, CAPTCHA and other security checks
remain user actions; collection stops on blocked or unfamiliar pages. Synthetic
tests do not establish compatibility with every signed-in account variant.

Protocol references: the public fixture shapes and observed page behavior in
[Walmart Invoice Exporter](https://github.com/hppanpaliya/Walmart-Invoice-Exporter),
particularly `tests/fixtures` and `public/providers/walmart-us.js`. This independent
implementation does not copy or bundle that repository's code or test data.
