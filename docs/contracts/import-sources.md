# Source-specific import decisions

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

Read the [shared import contract](imports.md) as well as the relevant source
section. Source-specific policies add to that shared review and write boundary.

## Source-specific contracts

### Credit Karma parser

- Read the export's `transactions` array.
- Convert debit transactions to positive amounts.
- Convert credit transactions to negative amounts.
- **Settings → Preferences** exposes **Suggest refund matches**, on by default,
  remembered per browser and snapshotted/validated as a boolean in every source's
  session, including generic CSVs. Do not render a Credit Karma-only checkbox.
  Suggestions use eligible negative parsed credits from every importer when on,
  and none when off; a completion payload cannot override the session's choice.
  When on, Credit Karma retains merchant credits despite Amazon/AliExpress/Venmo/eBay/Walmart exclusions;
  do not infer direction from a raw amount's sign. The legacy standalone parser
  keeps its default filtering unless `match_refunds=True` is explicitly supplied.
- Refund proposals use exact opposite cents and saved, positive, non-income,
  non-refunded, non-internal-transfer purchases within the previous 90 days
  (inclusive). Rank same-account/provider candidates first, then most recent.
  Amount alone is not proof: never auto-confirm a suggestion. Partial/combined
  refunds and purchases still in the incoming batch are not guessed.
- Show refund proposals as additive detail content in the shared transaction row
  (`transaction-ui.js`), not a separate list implementation. A compact **Mark as
  refunded** button with an adjacent chevron keeps the explanation and matched
  purchase rows collapsed by default. Render candidates with the shared row
  renderer, read-only. Multiple matches require an explicit radio choice; never
  silently choose the first. Keep expanded state through review refreshes.
  **Mark as refunded** stages one explicit purchase choice, disables the credit's
  inclusion checkbox, and offers **Undo match**. The final import confirmation
  can save refund-only changes even with zero rows selected; otherwise zero
  selected remains disabled. Cancel/close/backdrop/Escape never persist changes.
  Editing a credit discards only its pending refund choice and revalidates it;
  changing only its follow-up flag preserves the pending refund choice.
- Keep eligible refund provenance and original credit identity server-owned in
  the import session. Validate one-to-one staged/purchase IDs, reject duplicate
  source occurrences and also-imported credits, and bind choices to the reviewed
  CSV revision and proposal digest. Exclude the chosen purchases from transfer
  pairing in that import proposal only; do not change other refund/transfer rules.
- New refund confirmations save the actual source credit plus an explicit refund
  link on the purchase, atomically with selected additions after a safety backup.
  Preserve purchase amount/date, notes, tags, group, unrelated flags and createdAt.
  The linked credit is retained even though its standalone import checkbox is off.
  Legacy `refund-receipt-YYYY-MM-DD-<positive cents>` flags still contribute omitted
  credit identities to date/amount deduplication, alongside real credit rows;
  do not create new receipt flags or fabricate historical missing credit records.
  Stable staged IDs, not display sort, allocate repeated source occurrences.
  Show handled credits as unchecked duplicates with **Refund already handled**.
  Preserve receipts through normalization, edits, export/restore, and manually
  clearing `refunded`. Deleting the purchase also deletes its receipt.
- Preserve category and account metadata.
- When its filter is enabled, ignore descriptions containing `amazon`,
  case-insensitively.
- When its filter is enabled, ignore AliExpress transactions by matching
  `alipay` case-insensitively; also accept `aliexpress` and `ali express` as
  defensive aliases.
- When its filter is enabled, ignore descriptions containing `venmo`, case-insensitively.
- When Credit Karma and Amazon files are uploaded together, infer the Amazon
  payment account from the most common ignored Amazon card transaction.

### Walmart ingestion

- Walmart is part of the existing companion extension (minimum 0.9.1), isolated
  under `walmart_extension/`. Limit its host permission to `https://www.walmart.com/*`.
  Drive the site's actual history pagination and passively observe only its
  PurchaseHistoryV3 responses. Never replay signing headers, bypass challenges,
  or expose cookies, addresses, or payment data to Ledger.
- Export minimal versioned receipt JSON directly into a source-scoped, expiring
  staged session. Preserve the existing shared review, classifications, transfer
  proposals, occurrence-aware deduplication, revision checks, and confirmation.
- Dates are inclusive original order dates, including the source calendar date
  from timezone-bearing timestamps. Use the shared browser-local import
  lookback preference (two weeks by default), leaving dates editable.
- Use Shopping and blank subcategory before rules; editable account defaults
  are Walmart / CREDIT CARD / Walmart. One row per charged receipt line; quantity
  is already included in lineTotal. Prefer the charged categories tree over the
  duplicate flat ordered-items view. Preserve legitimate identical item lines.
- Allocate the final USD receipt total including tax, fees, tips, and discounts
  using integer-cent largest remainders. Never apply Amazon's estimated tax rate,
  infer missing prices, or silently invent refund dates. Cancelled, pending, and
  returned/refunded orders are reported as skipped inside review, with instructions
  to retain/import their bank entries. Membership fees are not order receipts.
- Walmart Credit Karma exclusion defaults ON, like the other merchant filters;
  users can turn it off for an individual import. It matches case-insensitive walmart / wal-mart / wal mart /
  wm supercenter substrings after whitespace collapse. Keep the exact strings
  visible, warn about uncovered charges, validate the boolean server-side, and
  preserve the choice in the source session. Other merchant filters are unchanged.
- Fail clearly on unfamiliar receipt/pagination formats, repeated pages, timeouts,
  and page/payload limits. No partially collected export should look successful.
  Synthetic regression tests cover receipt parsing, cents/quantities, privacy,
  pagination, session ownership, cancellation, and staged confirmation. A fixture
  pass is not evidence that the user's current signed-in Walmart site works.

### Amazon parser

- Accept a root order array, an `{ "orders": [...] }` wrapper, or a single order
  object.
- Create one transaction for each item line, including quantity.
- Calculate the amount using the pre-tax item price multiplied by `1.10502`.
- Use `Shopping` as the category.
- Use account metadata inferred from Credit Karma when both files are present.
- For Amazon data without inferred or user-supplied metadata, default accountName,
  accountType, and provider to `Prime VISA`, `CREDIT CARD`, and `chase`.

### AliExpress and Venmo account metadata

- AliExpress defaults unknown account identity to `Credit Card Mastercard`,
  `CREDIT CARD`, and `Bank of America`.
- Venmo defaults unknown account identity to `Checking Account`, `BANK`, and
  `Bank of America`.

### Capital One ingestion

- Keep it isolated in `capitalone_extension/`, minimum companion 0.9.1. Use only
  verified.capitalone.com and myaccounts.capitalone.com; no wildcard banking
  permissions, password/MFA automation, cookie extraction, or guessed private API.
- The user signs in and selects one account. Attempt only recognizable export
  controls with explicit dates and confirmed CSV selection. Unknown forms need
  manual interaction; keep passive CSV capture active and offer a file fallback.
  Never claim synthetic tests prove a current signed-in bank UI works.
- Source capture is armed only for the owned tab and active nonce; normalize CSV
  to allowed transaction fields before relaying it. Discard account/card numbers,
  balances and posting dates. No raw exports or credentials in extension storage;
  short-lived job metadata lives in session storage. Resume document navigation,
  reject stale document nonces, wrong tabs/frames/origins and late cancellation.
- Parse credit Debit/Credit columns or bank Transaction Amount/Transaction Type
  columns. Explicit Debit means expense-positive, Credit means negative. Preserve
  every identical occurrence. Reject malformed/ambiguous rows as a whole; no
  guessed signs or silent partial imports. USD only; no currency conversion.
- Range-filter on inclusive Transaction Date, including manual CSV. Source
  categories survive or default to Uncategorized; subcategory starts empty.
  Saved classifications, transfer proposals and occurrence-aware dedup all use
  the shared staged pipeline; the extension never calls commit.
- Editable defaults: Capital One / CREDIT CARD / Capital One. Users choose BANK
  for checking/savings. Reuse the shared transaction review unchanged. Cancel,
  X, Escape, backdrop and late asynchronous responses must never write/reopen it.

### Schwab checking ingestion

- Companion 0.11.0+, isolated in `schwab_extension/`, with only
  `https://client.schwab.com/*` added as a source host. The user signs in,
  selects one checking account, chooses the requested history range, and exports
  CSV. Capture remains passive: no guessed account selectors, private APIs,
  request replay, or authentication automation. Live site verification remains
  necessary; synthetic fixtures do not establish current website compatibility.
- Use editable Schwab Checking / BANK / Charles Schwab defaults. Reuse a distinct
  account name for each checking account; import accounts in separate runs.
  Brokerage and retirement activity are outside this importer’s scope.
- Accept explicit Withdrawal/Deposit columns, including Withdrawal (-) and
  Deposit (+), with Date, Type and Description. Preserve identical occurrences.
  Withdrawal means expense-positive; Deposit means negative. No signed-amount
  guesses, non-USD currency, ambiguous amounts, or silent malformed-row skipping.
  When Status is supplied, accept Posted and skip/report Pending; reject others.
- Some current exports include posted INTADJUST rows with both amount cells
  blank. Skip/report only these known amount-less interest entries, never invent
  zero or reconstruct amounts from balances. Explicit zero remains a valid row;
  missing amounts on other types or two nonzero amounts must still fail safely.
- Default to Uncategorized except TRANSFER (Transfer) and INTADJUST deposits
  (Income), then apply classifications. Keep rebates as credits. Range-filter
  inclusively by source Date. Review, transfer proposals, duplicate rules,
  confirmed backups, revision checks and atomic persistence remain shared.
- Strip export account titles, balance/check-number columns, and other unneeded
  fields in the isolated collector before transmission. Preserve descriptions.
  Credentials stay in Chrome. Only short-lived owned job metadata is stored;
  source tokens never reach Schwab URLs or logs. Cancel, stale documents, closed
  tabs and late exports cannot commit or resurrect a discarded review.
- Keep the existing cross-account date/amount duplicate rule and explain its
  collision limitation in the Schwab tab. Do not add account identity to the key
  or introduce persistent account identifiers as part of this source addition.
