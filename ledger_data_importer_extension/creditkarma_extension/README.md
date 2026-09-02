# Credit Karma integration

`content.js` runs only on Credit Karma. It reads the authenticated session,
requests all transactions in Ledger's selected date range, and builds the
BudgetLens-compatible JSON subset consumed by Ledger.

This is a clean Ledger implementation of the behavior documented by
[CreditKarmaExtractor](https://github.com/cbangera2/CreditKarmaExtractor); no
CreditKarmaExtractor source is bundled.

