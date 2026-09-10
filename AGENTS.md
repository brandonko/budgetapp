# Ledger contributor guidance

Ledger is a dependency-free Python 3.10+ application with a browser UI and a
Manifest V3 Chrome extension. The owner defines product behavior and acceptable
tradeoffs; agents own implementation and must provide evidence of correctness.

## Start here

1. Read [project context](llm_context.md), then the linked contracts relevant to
   the change and the corresponding workflow in [README.md](README.md).
2. Read [architecture](docs/architecture.md) to find the existing owner of the
   behavior. Use [change guides](docs/change-guides.md) for common work.
3. Explicitly read the scoped guidance below before editing those paths.
   Do not assume instructions below the task's working directory were loaded.
4. Inspect the working tree. Preserve unrelated edits; use an isolated branch
   or worktree when concurrent work would overlap.

| Paths being changed | Additional instructions |
| --- | --- |
| `app/` | [app/AGENTS.md](app/AGENTS.md) |
| `ledger_data_importer_extension/` | [extension AGENTS.md](ledger_data_importer_extension/AGENTS.md), then the source README |
| `tests/` | [tests/AGENTS.md](tests/AGENTS.md) |
| `deploy/` | [deploy/AGENTS.md](deploy/AGENTS.md) |
| `scripts/`, `.github/`, contributor docs | [development workflow](docs/development.md) |

## Implement and verify

- Define observable success and relevant failure cases before editing.
- Reuse the existing domain, persistence, and shared UI boundaries. Refactor for
  a concrete feature, repeated defect, or testing obstacle; avoid arbitrary
  file-length limits, speculative abstractions, and unrelated rewrites.
- Preserve behavior during refactoring. Do not relax a contract, remove a
  regression, or weaken a check merely to make a change pass. Explain intentional
  behavior or verification changes explicitly.
- Add focused behavior coverage for financial or persistence changes and bug
  fixes. For low-impact presentation or documentation edits, use proportionate
  checks instead of tests that merely repeat the edited text.
- Keep each product rule in its authoritative contract; update user-facing
  workflows when behavior changes. Link to rules instead of copying them.
- Run the complete Python and JavaScript regression suites from the root:

```powershell
python scripts/verify.py
```

For material UI, import, or save-flow changes, also run
`python scripts/verify.py --browser`. CI runs this browser layer on synthetic
data. Setup, targeted commands, and verification limits are in
[development](docs/development.md). Missing tools and skipped checks are not
passing coverage.

Keep application runtime dependencies unchanged unless explicitly reconsidered.
Node and Playwright are contributor/CI tools only. Use synthetic data and
temporary directories; never use or commit private `data/` or `raw_data_files/`
contents.

Obtain an independent review for changes to amounts, deduplication,
reconciliation, durable writes, import trust, or the checks protecting them.
A separate agent can review the final diff against the contracts and tests;
record and resolve findings. AI review complements executed checks.
Report resulting behavior, checks actually run, failures/skips, and remaining
integration uncertainty in plain language. Do not claim live site or deployment
verification from synthetic tests.

## Code Review Rules

### Financial correctness and durable writes

- Flag changes that can silently alter stored amounts, signs, duplicate counts,
  classifications, refund handling, or one-to-one bill-payment reconciliation.
  Preserve the expense-positive/income-negative storage convention, occurrence-
  aware `(date, amount)` deduplication, immutable `createdAt`, revision checks,
  safety backups, and atomic replacement. Require focused regression coverage
  for any affected invariant.

### Import privacy and trust boundaries

- Flag any path that can expose real financial data, arbitrary filesystem
  contents, site credentials, cookies, signing tokens, or import-session tokens.
  Browser credentials and cookies must stay inside the extension; the app may
  receive only normalized source data, must bind to loopback by default, validate
  and size-limit inputs at the server boundary, and keep `data/` and
  `raw_data_files/` untracked.

### Explicit confirmation before mutation

- Flag import, restore, delete, rollback, or bulk-classification flows that can
  write before explicit confirmation, write after any cancel/close/Escape/
  backdrop path, accept a stale revision, overwrite an existing database during
  initialization, or skip the required pre-mutation backup. Preserve the user's
  staged review and make destructive outcomes clear.

### Shared transaction modals

- Treat dashboard, import, import-history, and classification transaction
  dialogs as variants of the shared transaction-list UI described in
  `llm_context.md`. A compatible row, filter, badge, or sort improvement must be
  applied to every variant; page-specific controls such as import selection and
  duplicate toggles remain additive. Reuse `app/transaction-ui.js`, audit all
  variants when changing one, and keep regression tests synchronized.
