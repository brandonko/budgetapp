# Test guidance

Read the root [AGENTS.md](../AGENTS.md) and
[verification workflow](../docs/development.md).

- Use synthetic records and temporary directories only. Never read or copy
  the owner's financial database, exports, cookies, or browser profile.
- Derive expected outcomes from the product contract. Use explicit expected
  amounts/counts; do not compute the expected result with the helper under test.
- For a bug fix, reproduce the failure before fixing it when practical, then
  keep a regression that fails for the original defect.
- Exercise public behavior and failure outcomes. Source-text assertions belong
  only where structure itself is a requirement (such as manifest wiring), not
  as substitutes for executing transaction actions.
- Cover applicable no-write paths: invalid input, missing/stale revisions,
  rejected confirmation, every dismissal path, backup failure, and replacement
  failure. Check saved bytes/rows and backup contents, not only HTTP status.
- Preserve legitimate duplicate occurrences and immutable fields in fixtures.
  Shared UI or calculation changes need coverage across compatible variants.
- Keep tests deterministic: fixed dates, explicit timezones when relevant,
  isolated browser contexts, loopback servers on allocated ports, and bounded
  waits for observable state. Clean up only resources created by the test.
- Browser tests use the real app with temporary synthetic data. Keep test-only
  setup outside production endpoints and never connect them to a running user app.
- Keep Python tests discoverable as `test_*.py` and Node regressions as
  top-level `test_*.js`. Browser tests live in `tests/browser/` and run through
  the separate browser layer, not the Node unit-test glob.
- Do not turn failures into skips, remove coverage, loosen expected results,
  or update snapshots without explaining the underlying behavior change.

Run focused tests while iterating, then the complete verification command once
the change is ready. Run additional checks when new edits or findings warrant
them. Report skipped tests and live integration limits explicitly.
