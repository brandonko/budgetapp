# Real-browser smoke tests

These tests run Ledger's actual HTML, JavaScript, HTTP handlers, and CSV writes
in Chromium. The development prerequisites and complete verification command
are documented in the root [README](../../README.md#development-and-testing).
For a focused browser iteration after installing those prerequisites:

```powershell
npm run test:browser
```

The complete gate is `python scripts/verify.py --browser`. It runs the Python
and JavaScript suites before these browser tests. Missing Chromium or packages,
skipped tests, focused `.only` tests, expected failures, and ordinary test
failures must never produce a passing browser gate. Retries are disabled so a
flaky failure remains visible.

## Isolation and expected outcomes

Each test starts its own Python process serving the normal app on `127.0.0.1`
and a dynamically assigned port. `server.py` creates only synthetic rows in a
new temporary directory. It accepts no data path and adds no test HTTP
endpoints. Closing the runner's stdin shuts down that process and removes its
temporary CSV, classifications, and backups. Tests never reuse a running
Ledger server or read repository `data/` or `raw_data_files/`.

Each test also gets a fresh browser context. Browser requests outside that
test's server origin are blocked. There is no personal browser profile or
companion extension. Screenshots and traces contain synthetic data only and
are saved under the ignored `test-results/` directory on failure.

The same scenarios run at 1440px in light mode and 390px in dark mode:

| Scenario | Independently specified outcome |
| --- | --- |
| CSV preview and cancellation | Cancel, close, Escape, and backdrop discard leave the CSV byte-for-byte unchanged and create no backup. Rejecting the discard prompt keeps review open. |
| Selected import confirmation | Of two new rows and one duplicate, selecting one new row adds exactly that row for $12.34. The duplicate and unchecked row are not added. One safety backup equals the pre-import bytes. |
| Two browser tabs | After one tab saves, a stale edit in the other receives HTTP 409, keeps its error visible, and changes neither the saved bytes nor backups. |
| Linked partial refund | A $100 July purchase with a $30 August credit has $70 net cost in July. With another $25 expense and $1,000 salary, spending is $95, income $1,000, and net $905. The original amounts and import timestamp survive. |
| Shared transaction dialogs | Dashboard, import history, and unclassified review filter to the requested row; Escape closes filters before the dialog; close and backdrop write nothing. All four dismissal paths discard a real classification change preview. |

These smoke tests complement the detailed Python and JavaScript regression
suites. They do not establish compatibility with signed-in bank or store
websites, all browser engines, every reconciliation case, or every responsive
layout. Narrow Chromium is a viewport check, not a claim of mobile Safari
coverage.

## Extending and debugging

- Add focused outcomes in `ledger.spec.js` or another `*.spec.js`, importing
  `test` and `expect` from `fixtures.js` so isolation is automatic.
- Drive visible controls; use real endpoints and inspect bytes/backups when a
  flow affects persistence. Avoid injecting controller state or replacing app
  responses with mocks in this suite.
- Keep expected financial examples explicit. Do not calculate expected totals
  with the same application helper being tested.
- Use locator assertions and responses as synchronization; avoid fixed sleeps.
- For a focused run, use `npm run test:browser -- --grep "partial refund"`.
  This is diagnostic work, not a substitute for the complete gate.
- Open a failed test's trace with `npx playwright show-trace` followed by the
  trace path printed in its failure report. Review the screenshot and browser
  error context alongside the failed assertion.

`scripts/verify.py` sets `LEDGER_TEST_PYTHON` to the Python interpreter running
the gate. Direct `npm` runs use `python` from PATH unless you set that environment
variable to another Python 3.10+ executable. Playwright's standard
`PLAYWRIGHT_BROWSERS_PATH` override can point to a locally installed browser
cache; neither setting changes the production server configuration.
