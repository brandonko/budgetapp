# Merchant insights

Open Merchant insights in the navigation menu. Rank description groups by net spending or purchase frequency, narrow dates and category, search names, and set a minimum purchase count. Select a group for its median purchase, credit total, activity span and exact monthly breakdown. Search matching transactions opens the existing Transactions workspace with the same dates/category and a description search.

Ledger has no separate merchant field. Grouping is conservative: only case and repeated whitespace are normalized. Store IDs and distinct descriptions remain separate; nothing is renamed. The drilldown uses the existing contains-description search and can include longer matching descriptions. Refund flags and internal transfers are excluded, negative expense credits reduce spending, and every duplicate occurrence is counted. Gross-purchase share has a clearly separate denominator from net spending. Search/minimum count filter only the ranking, not the headline date/category totals.

This read-only page requires no financial writes or new persisted schema. It supports empty databases and deferred internal-transfer review. Data stays on the local server/browser.

Motivation: [users value payee reports](https://www.reddit.com/r/ynab/comments/138kls4) and [discover concentration in merchant spending](https://www.reddit.com/r/ynab/comments/k5u611). [Monarch reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports) documents merchant grouping. This is qualitative evidence, not a representative survey.

Validation: merchant model numerical regression tests, existing Transactions controller tests, complete Python regression suite and rendered responsive checks.
