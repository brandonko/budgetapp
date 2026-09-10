# Dashboard and Transactions reporting

This is the authoritative product contract for the topics below. Start with the
[core invariants and topic index](../../llm_context.md), then read the sections
relevant to the change. File paths in code formatting are repository-relative.
For implementation ownership, use the [architecture map](../architecture.md).

## Dashboard periods

- The home page supports `Monthly`, `Annual`, and `Year over year` views.
- Default to the latest month containing a budget-visible transaction.
- Monthly view has independent month and year selectors. Annual view has a year
  selector and summarizes the full selected year. Year-over-year view has a
  start year and end year, plus individual year toggles for choosing which lines
  remain visible inside that range.
- Changing the period updates summaries, category cards, charts, and dialogs
  together.
- Persist the selected view mode, year, month, year-comparison start year,
  selected comparison years, comparison metric/chart mode, breakdown
  dimension, and annual category/subcategory filter in the browser so dashboard
  context survives navigation to any primary page.
  Validate restored values against the current transaction data and fall back
  safely when a saved selection is no longer available.
- Let users switch the monthly and annual spending breakdown between **By
  category** and **By tag**. Keep the selected dimension, selected tags, and
  Any/All match mode synchronized between views and persist them across navigation.
- In Monthly and Annual **By tag**, the three headline spending/income/net cards
  use the same selected-tag query within that period, including tagged income.
  Count each matching occurrence once even when tags overlap; preserve negative
  expense credits and zero-value refund/internal-transfer treatment. No selected
  tags or no matches means zero totals, never an unfiltered fallback. Switching
  to By category restores full-period totals. Keep the odometer animations and
  accessible exact values in sync with these filtered amounts. Tag-picker search
  only narrows the available buttons, not the current query or summary.
- Keep the shared Tag Explorer inside the active breakdown section so switching
  dimensions does not insert or remove a card between major dashboard sections.
  In monthly view it sits directly below the breakdown heading; in annual view
  it sits directly below **A year at a glance**.
- In category mode, render one card for every visible category, including
  unmatched `Transfer` transactions. In monthly tag mode, the Tag Explorer is
  the complete breakdown: do not render category cards or add a secondary
  category drill-down beneath it. Tag-selection buttons replace tag cards.
- A category card shows its transaction count and net total.
- Opening a category shows dollar totals for its subcategories. Transactions
  without a subcategory are presented as **Unclassified**.
- Clicking a category opens its transactions in a modal.
- Annual view includes a monthly spending chart stacked by category. Its legend
  shows annual dollar totals. Selecting a category redraws the same monthly
  chart as subcategory stacks; selecting a subcategory isolates it. Use a
  breadcrumb and **Back to categories** action for upward navigation.
- In tag mode, never stack tags because a transaction can belong to several of
  them. Require a tag selection, render one combined monthly bar from the unique
  query result, and show a monthly table with matching counts and unique spending
  plus an annual total. Keep the monthly net chart unchanged.
- Do not render the monthly category-card section at the bottom of annual view;
  the annual charts and exact-value table are the complete annual breakdown.
- Include an expandable exact-dollar annual table below the spending chart.
  Category rows show January through December plus annual totals; expanding a
  row reveals its subcategories, including **Unclassified**. Keep the first
  column sticky and allow horizontal scrolling on narrow screens.
- Annual view includes a zero-centered monthly net chart. Months with positive
  net totals are green; months with negative net totals are red. Preserve each
  month's current visual bar height before annual chart rerenders, then animate
  spending stacks and net bars to their new normalized heights. Category,
  subcategory, tag, and year changes must not snap the bars to their new values.
- Year-over-year view uses a line chart with January through December on the X
  axis and dollars on the Y axis. Let users switch between cumulative totals and
  independent monthly values, as well as Spending, Income, and Net total. Morph
  existing lines and points between modes with a short eased animation. This
  small, user-triggered morph intentionally runs even when the browser reports
  `prefers-reduced-motion`; persist the selected chart mode. Default to the newest
  three years inside the selected
  range when no saved selection remains valid; never allow every year to be
  deselected.
- Year-over-year comparisons always let each line continue through its own
  latest imported month. Never project future values or turn unavailable months
  into zero activity.
- Show exact cumulative or independent monthly values (matching the chart mode),
  period totals, changes from the prior selected year, and the newest year's
  monthly average. A spending or income
  point opens that month's matching transaction type in the shared dashboard
  dialog; a net point opens all budget-visible transactions for that month.
- Exclude refunded and internal-transfer values from all comparison math using
  the same zero-value rules as Monthly and Annual views. Keep excluded internal
  transfers available through the dedicated review action for the full range.
- Provide a **View all transactions** action for the selected period.
- A **Today** button in the dashboard header switches any view to Monthly with
  the device's current local month/year, computed on click (not at page load).
  Permit the current year even without imported rows and persist that selection.
  Keep the initial default as the latest budget-visible transaction month. Do
  not reset tag/category display preferences. Disable Today during data loading
  or error/setup states so it cannot bypass the required transfer review.
  Match its height and type size to the adjacent period dropdowns through shared
  responsive sizing; keep their edges aligned without a hover lift.
- All transaction-list dialogs default to date, latest first. Provide the shared
  sort control everywhere transactions are reviewed: Date, Description, or Cost,
  each ascending or descending. Cost sorting uses the absolute stored amount so
  expenses, credits, and income compare by dollar magnitude.
- Keep the dashboard transaction toolbar compact: description/notes search and a
  plain-language combined sort menu remain visible; category/subcategory and
  tag and account/provider live in an expandable Filters section. Keep category and subcategory
  adjacent, limit subcategory choices to the selected category, show an active
  filter count, and render applied filters as removable chips. Populate the tag
  filter from the distinct tags available in the current transaction list and
  match tag names case-insensitively. On narrow screens,
  stack each related pair and use the modal's full content width.
- The interface must remain responsive and usable on desktop and mobile.
- Reserve a stable document scrollbar gutter so navigating between short and
  long pages does not shift centered layouts horizontally.
- Animate the Monthly and Annual **Total spent**, **Total income**, and **Net
  total** values as mechanical odometer reels whenever the dashboard period is
  rerendered. Keep currency punctuation stationary, roll each digit vertically,
  and preserve an exact nonanimated currency value for assistive technology.
- Use the browser's color-scheme preference only when no Ledger preference has
  been saved. After the user chooses Light or Dark, that explicit selection must
  control the complete palette; never leave an OS-level media query active that
  can mix light and dark design tokens.
- Define visualization colors as ordered theme tokens (`--viz-1` through
  `--viz-12`). Use the shared identity-based `createSeriesColorSlots` allocator,
  not a display-order index or label hash. Keep active groups, years, categories
  and subcategories in their existing slots when items are added, removed or
  reordered. New selections get the first available palette color; released
  slots may be reused, but never compact or recolor surviving selections.
  Start with the most distinguishable colors before secondary shades. Retain
  assignments across navigation in browser-local preferences, storing slots
  rather than literal colors so theme changes use the appropriate palette.
  Sync the full active set, not a search-filtered or individually drawn subset.
  Tag Explorer remains one combined series with its existing color; do not split
  overlapping tags into additive stacks. Each theme
  must provide the complete palette with at least 3:1 contrast against its
  surface; keep the palette uniqueness and primary-distance regression checks.

### All-time Transactions dashboard

- Keep **Transactions** as a primary destination at `/transactions`, separate
  from the period-based dashboard. Default to the entire transaction history
  with no date limits, and allow optional inclusive start/end dates.
- Support description/notes search, category/subcategory, account/provider, and
  multiple tags with Any/All matching. Combined tag results count each
  transaction exactly once, including when tags overlap.
- On Transactions, the tag picker and Any/All mode belong inside the existing
  Filters section, not a separate toolbar or nested popup. Tags use the same
  immediate-update behavior as the other filters; collapsing the section keeps
  selections. Include tags in the active-filter count and removable
  chips, and display the AND/OR mode beside chips when multiple tags are active.
  Let tag buttons wrap to their full height; the page itself scrolls. Do not add
  a capped-height or independently scrolling tag list or Filters panel.
- Do not show Refresh or Apply filters buttons on Transactions. Filter selections,
  tag modes, and Reset update results/totals locally and persist immediately,
  without refetching transactions on each change. Keep the last valid date range
  during incomplete/reversed date entry and show an inline validation message.
- Groups are a separate optional `group` CSV field: at most one group per
  transaction, independent of multiple tags. Tags describe reusable topics;
  groups describe trips or projects which may receive later transactions.
  Do not automatically convert or remove legacy `(group)` tags.
- Use the shared searchable group picker in every transaction editor. Offer
  existing names, No group to clear membership, and inline creation. Collapse
  whitespace, enforce a 100-character limit, and reuse existing names
  case-insensitively on both client and server. Creating a group stays staged until
  the enclosing transaction/review is saved; there is no independent group database.
- Render a distinct group badge with a squared, left-accented style, separate
  from tag pills. Provide a shared group filter including All groups and No group.
  On the all-time page it filters summaries/category breakdowns as well as rows.
- Show spending, income, and net totals plus the category spending breakdown
  for the complete filtered result, using existing refund/internal-transfer
  treatment. Paginate the result list at 50 rows; pagination never changes totals.
- Reuse shared transaction rows, the compact Filters/sort toolbar, and the
  transaction editor. Keep filters and context when editing returns to the page.

### Group comparison on Transactions

- Keep **Transactions** and **Compare groups** as two modes of the same page.
  Comparison is a read-only local view with its own group/date scope, independent
  of the browse description, tags, category and account filters. Persist the
  comparison separately in `ledger.group-comparison.v1`; never mutate the CSV
  while selecting groups, dates, a reference group, or a category drilldown.
- Allow two to four searchable, case-insensitively unique groups. One selected
  group may show its details while prompting for another. Do not infer group
  membership from legacy tags. Retain removed selected names as empty groups
  rather than silently comparing a different group.
- Use cent-based aggregation from `transactions-model.js`. Show spending less
  credits, excluding refunded/internal-transfer rows, and show income separately.
  Preserve occurrence counts. Distinguish missing activity (dash) from genuine
  zero totals. Show inclusive date scope, actual recorded activity spans, and
  dollar-only differences against a user-selectable reference; no percentages.
- Reuse the first four distinct theme visualization tokens consistently for
  chips, cards, common-scale horizontal spending bars, and category-table cells.
  Persist each selected group's slot in the comparison preferences. Removing
  an earlier group or adding an alphabetically earlier one must not recolor
  the other groups; the new group receives the first free slot. Each
  category uses a common scale across its group cells; support negative credits,
  blank categories, many categories, long group names, light/dark and narrow views.
- Drilldown delegates to the existing full-page transaction list and shared
  editor/bulk tools, not another independently implemented modal. Temporarily
  scope it to the chosen group, comparison dates and optional category. Back to
  comparison restores the previous browse query; successful edits/deletes
  recompute comparison totals. Keep the internal-transfer setup gate intact.
