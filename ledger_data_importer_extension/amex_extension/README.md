# American Express activity

Companion 0.12.2 supports **Import from Amex**. Reload the unpacked extension,
approve updated permissions if prompted (`webRequest` observes only the Amex
download route; no blocking, request-body or credential-header access), and refresh
Ledger. Select dates/account identity in Ledger, start, sign in to Amex, choose
the correct card, and click **Use this card** in the on-page guide.

Recognizable export dialogs with labeled date inputs and XLSX/CSV choices are
assisted. Dates and format are rechecked before downloading. Unfamiliar controls
remain user-operated: export the requested range in Amex and the listener
captures it, without a separate upload. XLSX is preferred for categories and
optional merchant Notes. Wait for **Listening for an Amex XLSX or CSV download**
before downloading. **Capture details** provides an allowlisted stage/method
readout, with no account data, filenames, URLs, cookies, or session tokens.
The manual upload fallback handles exports that still bypass capture.

Version 0.12.2 handles the observed direct GET download from
`/api/servicing/v1/financials/documents`, with `file_format=excel`, `xlsx`, or
`csv` and `application/force-download`. This is a document navigation, not
necessarily a fetch/XHR request or a URL ending in a filename. The page hook
covers export anchors/window.open; the non-blocking worker observer covers
top-level and iframe navigation in the owned tab. No new account endpoint is
invented: only the actual export URL chosen by Amex is read again in the page.

- `capture.js`: opt-in MAIN-world Blob/fetch/XHR observer plus clicked download
  links (including detached FileSaver-style anchors). Data URLs, same-origin
  pre-created blob URLs, and explicit same-origin CSV/XLSX file links are read
  with bounded streams. Never read the Downloads folder, follow redirects,
  replay POST requests, or fetch other origins. Requests use only the link
  actually clicked by the site/user; no guessed private API calls. No credential
  reads, authentication automation, or interference with the original download.
  The listener acknowledges arming before export automation proceeds.
- `export.js`: ISOLATED in-memory reader. Only the Transaction Details table and
  allowlisted columns survive. Account cover/reference fields never reach the
  worker or Ledger. Merchant fields are removed here when the Notes option is off.
  Enforce 16 MB, ZIP directory/expanded-size/CRC checks, strict XML/CSV limits,
  no external references/formulas/extraction, and both Excel date systems.
- `content.js`: card confirmation, conservative form assistance and guidance,
  asynchronous capture ownership/cancellation checks. No session token in the page.
- `coordinator.js`: exact source origin, owned top-level tab, document and nonce
  validation; current trusted Ledger origin checked before delivery. Session
  storage contains short-lived job metadata only. Completion stages `/complete`,
  never `/commit`; only the user's Ledger review confirmation writes data.
  Register the narrow navigation observer synchronously for worker recovery.
  Activate it only after **Use this card** confirms the current document. Accept
  only new same-origin GET requests for the exact route/formats above, from the
  owned tab and Amex initiator. Forward only to that confirmed document and
  nonce; never persist/log the query string or send it to Ledger. The page's
  bounded, redirect-blocking reader normalizes the response before relay.
  Cancel, new documents, expired sessions, and revoked Ledger trust stop capture.

Coverage uses synthetic exports and form fixtures reproducing the observed
route/MIME/method, never a private HAR, account query, or source workbook.
The signed-in Amex site can
change independently; live account-specific export controls have not been
verified. Unknown controls must keep giving clear instructions, not guessing.
