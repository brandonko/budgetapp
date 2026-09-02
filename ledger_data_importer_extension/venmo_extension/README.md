# Venmo integration

`content.js` runs only on Venmo's account site. Ledger opens the Statements page and the module
uses the user's existing signed-in browser session to request official monthly statement CSVs for
the selected range. The extension sends CSV contents to the local Ledger server; it never sends
Venmo cookies or credentials.

The parser imports completed payment activity and excludes failed, pending, reversed, and balance
transfer rows. Venmo can change its private statement endpoint, so this integration may need
maintenance if the Statements page changes.
