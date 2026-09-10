# Categories and classification rules

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Categories and classifications

- Keep exactly two category levels for now: required `category` and optional
  `subcategory`. Do not introduce arbitrary-depth category trees without a new
  product decision.
- Keep a visual taxonomy manager under **Settings → Taxonomy**. Merge category and
  subcategory values derived from current transactions with manually created values
  stored atomically in `data/taxonomy.json`. New saved values must remain available
  even when no transaction uses them yet, and should feed transaction-editor
  suggestions. Display top-level categories as parent cards with nested subcategory
  chips and transaction counts, support search across both levels, alphabetize the
  hierarchy, and reject case-insensitive duplicates. Taxonomy creation does not
  reclassify existing transactions; classifications remain the mechanism for bulk
  transaction changes. Provide an on-by-default toggle that hides categories with
  no subcategories, and combine it with taxonomy text search when both are active.
- Create taxonomy values inline rather than in dialogs. End every category's chip
  list with a dashed subcategory name-and-plus control, and end the category grid
  with a dashed category card using the same interaction. Both controls submit by
  clicking plus or pressing Enter and reject case-insensitive duplicates in place.
- Let users delete categories and subcategories only when their transaction count
  is zero. Require explicit confirmation, remove only the saved taxonomy value,
  and never mutate transactions as a side effect. Keep in-use delete controls
  disabled with an explanation that those transactions must be reclassified first.
- Dashboard cards, annual charts, and the annual breakdown table can use
  top-level categories or a user-defined tag query. Opening a category surfaces
  subcategory dollar totals and permits filtering; blank subcategories are
  labeled **Unclassified** in the UI.
- Tag queries accept multiple tags with **Match any** (logical OR) or **Match
  all** (logical AND). Deduplicate the result by transaction before calculating
  its count or total. Individual tag overview totals may overlap and must be
  explicitly described as non-additive. Classification rules do not set tags
  for now; tags are explicitly user-managed transaction metadata.
- Label blank-tag rows **Untagged**. Allow Untagged in an OR query, but disable
  Match all when Untagged is selected with any real tag because no transaction
  can satisfy that expression.
- Store alphabetically ordered import classifications in `data/classifications.json`, beside
  the canonical CSV. Keep the file private through the existing `data/` ignore
  rule and expose an explicit JSON export action on the dedicated Classifications page.
- Treat Classifications as a primary app destination. It belongs in the shared
  hamburger menu and must not be nested under Settings.
- Keep explanatory classification content inside a compact, accessible info
  disclosure patterned after the Import page. Include plain-language sections
  for actions and matching plus concise pseudocode showing nested transaction,
  classification, and rule evaluation. Avoid a redundant page subtitle.
- Treat classifications as ordered, reusable mass actions. Each classification
  contains one or more rules and explicitly sets at least one user-editable
  transaction field: description, category, subcategory, account name, account
  type, provider, notes, refund status, or internal-transfer treatment. Date and amount are intentionally not
  classification actions. An unselected action
  leaves its field unchanged. An enabled blank subcategory or notes action
  intentionally clears that field. Refund is tri-state: unchanged, mark
  refunded, or mark not refunded. Never let classifications change `createdAt`
  or arbitrary internal flags.
- Each rule has separate optional case-insensitive regular expressions for the
  current category, subcategory, description, account name, and provider. Ignore
  blank matchers. All populated matchers in
  one rule must match; multiple rules within a classification are alternatives.
  Reject backreferences and repeated groups containing another repetition or
  alternation to block known high-risk backtracking structures. This is a
  conservative structural policy, not a linear-time regex engine.
  Interpret verbose flags, comments, escapes, and literal leading brackets
  consistently with Python regex syntax; client-side JavaScript must not reject
  valid Python patterns. GET and Export preserve older rejected matchers for
  repair and report field-level errors without executing them or rewriting the
  saved file. All save, preview, import, and matching paths remain strict. A
  library containing multiple rejected matchers can be exported, corrected, and
  explicitly re-imported as a complete valid replacement.
- Each rule may include optional freeform notes documenting its rationale. Keep
  the notes editor visually separate from regex matchers and explicitly explain
  that notes do not participate in matching. In read-only mode, show a saved note
  as subtitle text immediately beneath the rule title. Preserve line breaks.
- Sort classifications alphabetically by category and subcategory, with
  classifications that do not set a category afterward. Evaluate them in that
  displayed order and stop at the first match. Present one classification at a
  time with a clear current/total pagination indicator. Place newly saved
  classifications into alphabetical order; do not expose manual reordering controls. Disable adding
  another classification until the last one has an action and every rule has
  at least one populated matcher, preventing repeated empty entries.
- Do not save two classifications with identical configured actions. Keep the
  duplicate draft open, identify the existing classification's one-based page
  number, and direct the user to add another rule to that classification.
- Show configured classification actions and only populated rule regexes in compact
  read-only mode. Each classification and rule has its own Edit, Cancel, and Save
  flow. Cancel restores only that editor's prior in-memory values. Save validates
  and persists only the corresponding draft, without committing or closing any
  other open editor. Allow classification details and multiple rules to be edited
  concurrently. For a new classification, stage its details and first rule
  independently and persist after both have been accepted. The server may still
  atomically replace the complete classifications JSON, but unsaved UI drafts
  must never be included in that request. Do not show a global Save button.
- Apply classifications before import preview and duplicate detection. Do not
  automatically reclassify existing CSV rows when rules are changed.
- Before classification matching, collapse every run of whitespace in imported
  description, category, subcategory, account name, account type, and provider
  values to one regular space. Persist and preview those normalized values. Do
  not apply this policy to freeform notes or retroactively rewrite existing rows.
- Match classification regexes against a whitespace-collapsed view of each
  matcher field so existing rows with source padding behave like their rendered text.
- Provide a confirmed **Apply to existing transactions** bulk action. Save the
  currently displayed rules as part of confirmation, preserve unmatched rows,
  and create a safety backup before atomically writing any transaction changes.
  Before confirmation, show a modal containing every affected transaction and
  each field's before/after value. All modal dismissal
  paths must write nothing. Bind the preview to the CSV revision and reject a
  stale confirmation. Do not create a backup or rewrite the CSV when no rows
  changed.
- If nothing matches, preserve the category supplied by the parser and populate
  a blank subcategory.
- From the Classifications page, provide an all-dates modal of every transaction
  with a blank subcategory. Use the shared transaction row and compact
  search/filter/sort toolbar. Show **Internal transfer** on excluded rows and
  **No rule matched** on the remaining rows, while preserving refund and custom
  tag badges. Hide internal transfers by default and provide an
  **Internal transfer** visibility toggle, consistent with the import-review
  transaction-type toggles, so the user can reveal them when needed. Keep the
  user on Classifications and preserve any draft when the modal closes.
