# Developing Ledger with AI

The owner sets product behavior, privacy requirements, and acceptable tradeoffs.
Agents choose implementation details within those constraints and supply
evidence of correctness. The owner should be able to assess a plain-language
result without reviewing source code.

## Find the right context

Start with [AGENTS.md](../AGENTS.md) and [project context](../llm_context.md).
Read the relevant scoped instructions and product contracts before editing.
The [architecture map](architecture.md) identifies existing owners of behavior;
[change guides](change-guides.md) identify affected code and tests.

| Document | Responsibility |
| --- | --- |
| Root and scoped `AGENTS.md` | How contributors work; relevant instruction routing |
| `llm_context.md` and linked `docs/contracts/` | Authoritative product decisions and invariants |
| `docs/architecture.md` | Current responsibilities, data flow, and shared components |
| `docs/change-guides.md` | Practical implementation and verification paths |
| `README.md` and `docs/current-workflows.md` | Supported user workflows |
| This document | Contributor setup, verification, review, and maintenance |

Keep each detailed rule in one authoritative location. Update that contract and
the affected user workflow when behavior changes; update the map when ownership
changes. Do not add a second historical narrative of the same policy.
Preserve links or leave explicit forwarding links when moving documentation.
Instructions should describe observable requirements and explain unusual
decisions, rather than repeat obvious code or prescribe a folder for every file.

## Contributor setup

Running Ledger still needs only Python 3.10+ and a modern browser. Contributor
verification also needs Node.js 22+ on PATH. No Python packages are required.
Run the complete Python and Node regression check from the repository root:

```sh
python scripts/verify.py
```

Missing prerequisites, failed checks, and skipped required checks do not count
as complete verification. For browser testing, install the locked development
packages and Chromium:

```sh
npm ci
npx playwright install chromium
python scripts/verify.py --browser
```

On Linux, Playwright may also need operating-system browser libraries; use
`npx playwright install --with-deps chromium` in an appropriate development/CI
environment. Node, npm, Playwright, and Chromium are testing tools, not app
runtime dependencies. No package installation or browser download is needed
just to run Ledger.

Browser fixtures start their own loopback servers with temporary synthetic
databases. They never use the default `data/transactions.csv`, the user's running
Ledger process, a signed-in browser profile, or a real financial website.

## Verification layers

| Layer | Establishes | Does not establish |
| --- | --- | --- |
| Python regressions | Parser, domain, API, persistence, and deployment-helper behavior against synthetic state | Browser interaction or real VM operation |
| Node regressions | Executed shared/controller/extension logic, with simulated browser APIs where needed | Real layout, permissions, or site compatibility |
| Chromium smoke tests | Critical app interactions and saved-state outcomes in a real browser on synthetic data | Exhaustive page coverage, installed extension behavior, or live websites |
| Targeted desktop/mobile review | Layout, keyboard/focus behavior, and usability of changed surfaces | Exhaustive automated correctness |
| Explicit live integration acceptance | The source or deployment exercised in the reported environment | Other sources, accounts, or future website versions |

The initial [browser scenarios](../tests/browser/ledger.spec.js) run in a desktop
light view and a 390px dark view. They exercise import dismissal and selected-only
commit, conflicting edits in two tabs, a later partial refund attributed to the
purchase's original month, and filtering/dismissal in dashboard, import-history,
and classification dialogs. Assertions check stored bytes, backups, counts, and
visible totals. Extend these scenarios when a changed workflow is not represented;
this small suite does not cover every shared-dialog variant or every control.

CI runs the complete Python/Node checks on Windows and Linux, including the
minimum supported Python version, and runs the Chromium layer on Linux.
The deployment helper uses the same Python/Node gate before stopping the running
service. Browser testing happens in development and CI; the VM does not need
Playwright or Chromium. See [deployment setup](../deploy/README.md), including
the separate update of an already-installed deployment helper.

The checked-in workflow runs on pull requests and main-branch updates. For
GitHub to block merging on a failed check, branch protection or a ruleset must
require its checks. A workflow or CODEOWNERS file alone does not enforce that
setting. Use the workflow's actual check names from its first run when configuring
required checks. Repository settings are separate from versioned PR changes.

## Working on a change

1. State the intended behavior and important failure outcomes. For a bug,
   identify a reproducer and expected result grounded in the product contract.
2. Find the existing owner and callers. Choose the smallest coherent change
   and preserve concurrent work.
3. Run focused tests while iterating. Add behavior coverage where an invariant
   or defect needs protection, using explicit expected amounts and counts.
4. Run `python scripts/verify.py` on the completed change. For material UI,
   import, or save-flow work, also run `python scripts/verify.py --browser`
   and inspect affected desktop/narrow layouts and keyboard flows.
5. For financial, persistence, trust-boundary, or verification changes, obtain
   an independent review of the final diff against contracts and tests.
   A separate agent should look for counterexamples, missing callers, and failure
   paths. Resolve findings and rerun affected checks after fixes.
6. Update the authoritative documentation. Report behavior, executed checks,
   review findings/resolution, and remaining limits in the PR.

Targeted commands remain useful for diagnosis:

```sh
python -m unittest discover -s tests -p "test_reconciliation.py" -v
node --test tests/test_transactions_model.js
```

The original full Python command remains
`python -m unittest discover -s tests -v`; it is only one layer of the combined
gate. Do not describe it alone as full app verification.

## Refactoring and review policy

Refactor to remove demonstrated duplication, isolate a changing responsibility,
fix repeated defects, or make important behavior testable. Explain the benefit
and boundary being preserved. Prefer small behavior-preserving extractions with
explicit inputs/outputs over broad rewrites.

File length and abstraction counts are signals to inspect, not quality targets.
Avoid speculative extension systems, splitting related logic just to meet a
line limit, or adding a framework for tidiness. Keep behavior changes
distinguishable from mechanical moves.

Tests are evidence, not infallible specifications: investigate conflicts against
the authoritative contract. Never weaken a test or change an expected amount
simply to obtain a pass. Explain deliberate contract/test changes and give their
independent justification.

Review is fallible too. An agent's confidence or another agent's approval does
not substitute for executed tests. Completion reports should state what changed,
what was exercised, failed or unavailable checks, and unverified live integrations.
Surface material product tradeoffs for the owner; routine reversible
implementation choices need no extra approval.
