# Saved relationships and reconciliation

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Internal transfers and credit-card bill-payment reconciliation

Do not exclude the entire `Transfer` category. Venmo, Zelle, and other unmatched
transfers may be legitimate expenses or incoming money.

Internal-transfer treatment is a durable decision, not a read-time calculation.
Never run heuristic match detection from `public_state`, transaction GETs,
dashboards, or other rendering paths; those paths only validate/project saved
links. Imports and an explicit Settings scan propose pairs using:

1. At least one row has category `Transfer`, case-insensitively, or a description
   that looks like a transfer or account payment. The other row may retain any
   source category because exports sometimes label payment rows as `Income` or
   `Business services`.
2. The rows belong to different account identities. Account type does not
   restrict matching, so bank-to-bank transfers are supported.
3. Their nonzero amounts are exact opposites. Either direction is valid, which
   covers both bill payments and credit-balance refunds back to a bank account.
4. Their posting dates are no more than five calendar days apart.
5. Matching is one-to-one, choosing the closest-date candidates first.
6. Settings scans the complete database. Imports match only selected incoming
   occurrences against each other and existing eligible rows, across month/year
   boundaries. Never rematch already flagged rows or consume one side twice.

On unlinked legacy records, an `internal-transfer` flag excludes a row. An `include-in-budget` flag
prevents detection and forces the row to count normally. With neither flag, the
row counts normally and is eligible for future detection. The shared editor
exposes Eligible for detection, Internal transfer, and Count normally.

Confirmed pairs now use explicit `id`/`links` relationships. Legacy exact
two-member `transfer-pair-*` groups can be upgraded during schema migration or
restore, with a safety backup; never infer new matches at startup. Preserve
unpaired old exclusion flags and legacy refund receipts when a source is missing.
Links take precedence over budget flags. Disable legacy treatment controls while
linked and reject conflicting bulk/classification changes; unlink the original
purchase first. Description edits never break links. Explicit deletion removes
dangling references and restores surviving transactions' remaining net/source
amount; preserve follow-up flags and unrelated fields. Warn about this in delete
confirmations and always make a safety backup.

Relationships form disjoint shallow stars: refunds and transfers are one-to-one;
repayments allow up to 500 negative credits against one positive purchase. A
credit has one owner and cannot itself own links. Reject missing IDs, duplicate
IDs, self-links, reused credits, chains, cycles, wrong signs and unbalanced
transfer pairs. Transfers require different accounts and opposite nonzero amounts.
Partial refunds and repayments retain the residual cost; overpayments may yield
a negative net expense. Preserve every original date, amount and createdAt.

Budget calculations use a linear projection of these saved links, NOT detection:
the purchase contributes the sum of itself and its linked credits, attributed to
its original date/category/tags/group. Linked credits contribute zero, even if
categorized Income, but remain visible on their posting dates. Apply this to
monthly, annual, YoY, tag totals, all-time totals and group comparisons. Shared
rows display the root's net cost and an expandable full-width section of shared
read-only source rows. Fully refunded/transfer/linked-credit amounts retain their
original values with grey strike-through styling. The shared editor's collapsed
Refunds & repayments section searches credits by description/notes and stages
links until its own save and any enclosing review confirmation.

Both sides use the shared **Refunds & repayments** editor with an explicit link
type selector and shared transaction cards for selected records and search results.
Infer the role from stored signs: positive is the original expense, negative is
money received. Expense-side repayments allow several credits; credit-side editing
allows exactly one expense. Refunds/transfers are 1:1; only transfers must balance
exactly and cross accounts. Enforce these constraints in both UI and backend.
Support the legacy request-only `repaymentTo` intent and the generalized `linkTo`
object (`transactionId`, `type`; blank ID unlinks), resolving either atomically
into purchase-owned `links`, never a second CSV relationship or child-owned link.
Reject conflicting intents. Preserve other repayments, immutable IDs/createdAt
and source amounts. An explicit credit-side link edit can change/unlink an existing
refund or transfer; legacy repayment-only requests must not silently repurpose one.
Remap reverse targets in forced import copies. Import previews resolve intents without
writes, bind the canonical proposal to the confirmation digest, and apply only
selected rows. A canceled or unchecked repayment cannot modify an existing purchase.

CSV exports include the full linked family even outside the selected dates;
the displayed count must include these counterparts. Accept old headers without
id/links, and assign fresh IDs to forced imported copies while remapping their
links. Incomplete linked import selections are rejected clearly, never silently
converted to unlinked financial records. Occurrence-aware date/amount duplicate
matching remains independent of durable IDs.

Import proposals must show existing counterpart rows that will be linked,
not just incoming rows. Recompute proposals after edits, checkbox changes, and
force-including duplicates. Bind confirmation to both the CSV revision and the
exact reviewed transfer plan; reject stale/unseen matches. Save selected incoming
rows, reviewed links, and affected existing-row flags in one atomic write, with a safety backup
for an existing database. Keep existing createdAt and all unrelated fields intact.
All cancel paths write nothing; discard stale asynchronous preview responses.

Auto refund buttons and manual editors share one staged relationship, in both
Import and Reconcile. Show canonical projected counterparts in either editor,
including an explicitly empty `_reviewLinks` array after unlinking. Raw draft
`links` and reverse intents remain separate from server-owned projections;
unrelated edits must not turn inferred proposals into explicit choices. A
purchase-side link edit supersedes earlier child-side intents. Reverse edits
must never submit both `linkTo` and legacy `repaymentTo`. Replace old projection
metadata after each refresh so removed badges, counterpart ownership and net-cost
treatment cannot linger. Saved-counterpart previews describe pending relationship
updates, not refunds mislabeled as internal transfers.

Settings → Reconcile provides Find matches and a staged
review using the same transaction modal, filters, sort and bulk/single editor as
import history. It displays before/after changes, requires explicit confirmation,
and makes a safety backup before writing. A no-op scan must not rewrite the CSV.
The optional **Match nonzero decimal** checkbox (off initially) excludes whole-dollar
amounts from both transfer and refund suggestions for that scan. It never hides
saved links or prevents explicit manual linking. Validate the boolean at the API
boundary and bind it into the review digest; preserve it through edits and confirmation.
Keep the Settings card compact: explain matching, confirmation, and legacy-data
reviews in the shared expandable info-panel style used by Import and Classifications.
Also suggest exact-opposite credits matching a purchase within the preceding
90 days. Refund suggestions require an explicit purchase choice and final review
confirmation. Multiple price matches must not silently pick the first candidate.
Expandable refund suggestions display shared, read-only transaction rows with
an explicit **Link selected purchase** button BELOW the candidates. Radio selection
only chooses; the button stages a link, and **Save reviewed changes** persists it.
Show **Refund link staged** and an undo action while pending. Preserve candidate
choices and disclosure state across flagging, filtering, and successful refreshes;
reset them on cancel/new review. When edited rows overlap `refundSuggestions`, merge
their `_refundCandidates` metadata instead of dropping it during deduplication.
The review's type toggles reuse the import filter buttons: To review on,
Already reconciled off by default. Show unchanged saved links/exclusions only when
Already reconciled is enabled; never add them to the write plan just for viewing.
Editing one moves it into proposed changes with a before/after preview and the
same staged confirmation/cancel semantics. Type toggles compose with all shared
search/filter/sort controls, reset on a new review, and stay hidden in import history.

Legacy databases need one explicit full-database review before dashboards show
totals under the new saved-only policy. Do not run fresh financial matching at
startup or on GET. Startup may upgrade exact saved pair metadata through the
backed-up schema migration; new matches require this explicit review. A
successful review records version 1 in the CSV-adjacent
`<stem>.transfer-review.json` marker. Fresh databases created by a confirmed
staged import are already reviewed. The marker is only upgrade bookkeeping;
CSV links and legacy flags remain the source of budget treatment. Historical exports or
restores without saved flags can be scanned again through Settings.
During the initial upgrade scan only, an already manually excluded row without
pair metadata can still identify its old automatic counterpart, preserving legacy
matching. Never reuse a persisted pair or override an explicit Count normally.
The retired `/api/import` endpoint always returns HTTP 410 and writes nothing.
All imports must use staged sessions and explicit confirmation.

Excluded rows do not affect monthly or annual category cards, subcategories,
charts, breakdown tables, spending, income, or net totals. They must remain
accessible and editable through **View X excluded internal transfer
transactions**. Preserve and display the original stored amount in muted text
with a line-through, while continuing to use a $0 budget amount.
