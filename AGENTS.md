# Ledger contributor guidance

Ledger is a dependency-free Python 3.10+ application with a browser UI and a
Manifest V3 Chrome extension. Read `llm_context.md` for the product invariants
and `README.md` for the supported workflows before making or reviewing changes.

Run the regression suite from the repository root with:

```powershell
python -m unittest discover -s tests -v
```

Keep the application dependency-free unless a change explicitly revisits that
constraint. Use synthetic data and temporary directories in tests; never use or
commit the private contents of `data/` or `raw_data_files/`.

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
