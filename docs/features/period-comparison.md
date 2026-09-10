# Compare periods

Open **Compare periods** from the shared navigation menu, or visit
`/compare-periods`. Choose a focus period and comparison period using inclusive
start/end dates. **Previous period** selects the immediately preceding range with
the same number of days; **Previous year** shifts both dates back one calendar
year, clamping February 29 to February 28 when needed. **Swap periods** reverses
the comparison. The default is the newest month with budget-visible activity
against the preceding equal-length period. Valid selections stay in this browser.

Cards show exact spending, income, net total, dollar/percentage changes, and
per-calendar-day averages. A category table ranks the largest absolute dollar
changes. Income remains positive, negative expense credits reduce spending,
refunded/internal-transfer rows contribute zero, and unmatched transfers retain
their normal treatment. Calculations reuse Ledger's existing cent-based query
model and preserve duplicate occurrences.

Zero or negative comparison amounts show dollar differences without a percentage.
A table dash means no counted transactions; a $0 total can still include activity.
Unequal lengths, overlaps, and empty periods are explained explicitly. No records
does not establish that a statement is complete. Invalid date entry hides totals
until corrected instead of presenting results for a stale range.

Category totals open the existing Transactions list with whitelisted inclusive
dates, category, and activity filters through a `report=period-comparison` URL.
The existing editor and bulk tools remain the only transaction editing UI. Report
controls make no transaction writes. A missing CSV directs users to Import data;
the transfer-review setup gate is honored whenever the server requires it.

## Why this experiment

[Monarch users requested readable category comparisons and pacing](https://www.reddit.com/r/MonarchMoney/comments/1e2t6wz/feature_request_review_monthly_spending_by/)
in July 2024. [A separate January 2024 discussion](https://www.reddit.com/r/MonarchMoney/comments/193ufnh)
asks for income/spending comparisons against a previous period. These are
self-selected qualitative requests, not a representative survey.

[Current Monarch reporting documentation](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports)
confirms flexible timeframes and category/merchant drill-down. The historical
requests demonstrate demand; they are not claims about current competitor gaps.
Sources were reviewed September 7, 2026; the documentation was updated August 6, 2026.

## Validation

Run `node --test tests/test_period_comparison_model.js tests/test_period_comparison_controller.js`
for cents/signs, inclusive ranges, leap days, zero denominators, URL-filter bounds,
local controls, invalid dates, setup/error states, and GET-only behavior. Run
`node --test tests/test_transactions_model.js tests/test_transactions_controller.js`
for existing transaction behaviors, then `python -m unittest discover -s tests -v`
for the complete regression suite and static route checks.
