# Shared extension infrastructure

- `ledger_bridge.js` runs on Ledger's Import data page at HTTP loopback or an
  explicitly trusted HTTP/HTTPS origin with current Chrome host permission. It
  validates the page-message boundary and relays source commands and progress.
- `import_coordinator.js` is the Manifest V3 service worker. It owns secure
  session state, opens source tabs, routes source-specific messages, and sends
  completed exports to Ledger.
- `trusted_origins.js` and `trusted_servers.js` enforce exact scheme/host/port
  trust and synchronize dynamic bridge registration with saved trust and actual
  Chrome permissions. Reconnect can attach to existing eligible pages; it does
  not start an import or silently request permissions.
- `options.html` / `.js` let the user explicitly trust a server, grant missing
  site access, reconnect, or remove trust. This is not server authentication.
- `popup.html` / `.js` launch Ledger's Import data page. They neither start the
  backend nor claim it is reachable, and source review remains in the app.
- `icons/` contains Ledger's vector master and Chrome PNG sizes;
  `build_icons.ps1` regenerates the PNGs on Windows.

Source page parsing belongs in a sibling `<source>_extension` directory, not in
this shared directory.
