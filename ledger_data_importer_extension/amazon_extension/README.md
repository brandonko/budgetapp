# Amazon integration

This module contains the Amazon-specific browser code:

- `content.js` is the minified order-history scraper bundle preserved from
  [Order History Exporter for Amazon](https://github.com/xenolphthalein/order-history-exporter-for-amazon)
  version 1.3.0.
- `popup/` is that exporter's Amazon-only toolbar interface.
- `icons/` contains the upstream Amazon exporter artwork still used by the
  extension manifest.

The scraper sends export and progress messages to `shared/import_coordinator.js`,
which connects the result to Ledger's source-scoped import session. Keep the
minified scraper intact so upstream fixes remain comparable.
