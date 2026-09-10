# Extension guidance

Read the root [AGENTS.md](../AGENTS.md), this directory's [README](README.md),
and the relevant source README. The authoritative contracts are
[imports](../docs/contracts/imports.md) and
[source policies](../docs/contracts/import-sources.md).

- Put source-page collection and normalization in the existing source directory
  (or a new `<source>_extension/` directory). Reuse
  [shared infrastructure](shared/README.md) for orchestration, origin trust,
  connection settings, and the Ledger page bridge.
- Credentials, cookies, signing tokens, and authentication stay in the browser.
  Relay only bounded source data required by the parser; discard unnecessary
  account details before crossing the boundary.
- Validate origin, frame, tab, source, session/nonce, message shape, and size at
  the relevant message boundary. Treat page-world messages as untrusted.
- Preserve exact scheme/host/port trust and current Chrome permissions. A saved
  server entry alone is not permission. Request new permissions only through
  explicit user actions.
- Preserve job ownership through navigation and worker suspension. Reject late
  messages after cancellation, expiry, tab closure, or a newer request.
- The extension collects and completes staged sessions; the app owns review
  and explicit commit. Do not introduce extension-side commit shortcuts.
- Keep MAIN-world observers and ISOLATED-world helpers separate. A JavaScript
  path must not be registered in both worlds. Test actual manifest wiring.
- Use synthetic exports and messages in tests. Exercise malformed input, wrong
  ownership, cancellation, permissions, and repeated occurrences as applicable.
  Fixtures do not establish compatibility with today's signed-in website.
- Preserve upstream attribution and licenses; document supported formats,
  exclusions, source limits, and the status of live verification.

Follow [the importer change guide](../docs/change-guides.md) and run the root
verification command. Report whether live collection was actually exercised.
