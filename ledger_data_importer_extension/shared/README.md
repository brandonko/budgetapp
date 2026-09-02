# Shared extension infrastructure

- `ledger_bridge.js` is injected into Ledger's localhost Import data page. It
  validates the page-message boundary and relays source commands and progress.
- `import_coordinator.js` is the Manifest V3 service worker. It owns secure
  session state, opens source tabs, routes source-specific messages, and sends
  completed exports to Ledger.

Source page parsing belongs in a sibling `<source>_extension` directory, not in
this shared directory.
