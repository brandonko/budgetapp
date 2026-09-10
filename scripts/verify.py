#!/usr/bin/env python3
"""Run Ledger's required Python and JavaScript checks; optionally include Chromium."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIN_PYTHON = (3, 10)
MIN_NODE = 22


class VerificationError(RuntimeError):
    """A required check cannot be run reliably."""


def require_runtimes() -> str:
    if sys.version_info[:2] < MIN_PYTHON:
        raise VerificationError("Python 3.10 or newer is required. Run this command with a supported Python interpreter.")
    node = shutil.which("node")
    if not node:
        raise VerificationError("Node.js 22 or newer is required for JavaScript tests. Install Node.js, add it to PATH, and retry.")
    try:
        result = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise VerificationError(f"Cannot run Node.js: {error}. Check node --version and PATH.") from error
    version = re.fullmatch(r"v(\d+)\.\d+\.\d+\s*", result.stdout)
    if result.returncode or not version:
        raise VerificationError("Cannot determine the Node.js version. Check node --version and install Node.js 22 or newer.")
    if int(version.group(1)) < MIN_NODE:
        raise VerificationError(f"Node.js 22 or newer is required; found {result.stdout.strip()}. Update Node.js and retry.")
    print(f"Python {sys.version.split()[0]}; Node.js {result.stdout.strip()}", flush=True)
    return node


def javascript_files(root: Path) -> list[Path]:
    files = sorted(path for path in (root / "tests").glob("test_*.js") if path.is_file())
    if not files:
        raise VerificationError("No JavaScript regression files found in tests/test_*.js; refusing an empty verification run.")
    return files


def run_python_tests(root: Path = ROOT) -> int:
    """Keep unittest discovery, but make missing/skipped coverage a failing result."""
    suite = unittest.defaultTestLoader.discover(str(root / "tests"), pattern="test_*.py")
    if not suite.countTestCases():
        print("FAILED: No Python regression tests were discovered.", file=sys.stderr)
        return 1
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.skipped or result.expectedFailures:
        print(f"FAILED: Required Python coverage was not completed ({len(result.skipped)} skipped, "
              f"{len(result.expectedFailures)} expected failures). Resolve these checks before continuing.", file=sys.stderr)
        return 1
    return 0 if result.wasSuccessful() else 1


def run_suite(label: str, command: list[str], root: Path, environment: dict[str, str], *, tap: bool = False) -> bool:
    """Stream output with argv preserved on Windows and POSIX; never invoke a shell."""
    print(f"\nRunning {label}...", flush=True)
    counts = {}
    try:
        with subprocess.Popen(command, cwd=root, env=environment, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace") as process:
            for line in process.stdout:
                print(line, end="", flush=True)
                if tap:
                    match = re.fullmatch(r"# (tests|skipped|todo) (\d+)\s*", line)
                    if match:
                        counts[match.group(1)] = int(match.group(2))
            returncode = process.wait()
    except OSError as error:
        print(f"FAILED: {label} could not start: {error}", file=sys.stderr)
        return False
    if returncode:
        print(f"FAILED: {label} exited with status {returncode}.", file=sys.stderr)
        return False
    if tap and (counts.get("tests", 0) == 0 or counts.get("skipped") != 0 or counts.get("todo") != 0):
        print(f"FAILED: {label} must report completed tests with zero skipped or TODO tests. "
              f"Reported totals: {counts}", file=sys.stderr)
        return False
    print(f"PASSED: {label}", flush=True)
    return True


def verify(root: Path = ROOT, *, browser: bool = False) -> int:
    try:
        node = require_runtimes()
        js_files = javascript_files(root)
        browser_cli = root / "node_modules/@playwright/test/cli.js"
        if browser and not browser_cli.is_file():
            raise VerificationError("Browser checks need developer tools. Run npm ci, then npx playwright install chromium, and retry with --browser.")
    except VerificationError as error:
        print(f"Verification prerequisite failed: {error}", file=sys.stderr)
        return 2
    environment = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1",
                       LEDGER_TEST_PYTHON=sys.executable)
    suites = [
        ("Python regression suite", [sys.executable, "-B", str(root / "scripts/verify.py"), "--python-tests"], False),
        ("JavaScript regression suite", [node, "--test", "--test-reporter=tap", *map(str, js_files)], True),
    ]
    if browser:
        suites.append(("Chromium browser smoke suite", [node, str(browser_cli), "test"], False))
    failures = []
    for label, command, tap in suites:
        if not run_suite(label, command, root, environment, tap=tap):
            failures.append(label)
    if failures:
        print("\nVerification FAILED: " + ", ".join(failures), file=sys.stderr)
        return 1
    print(f"\nVerification passed: {len(suites)} required suites completed without skips.", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true", help="also run the installed Playwright Chromium smoke suite")
    parser.add_argument("--python-tests", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.python_tests:
        return run_python_tests()
    return verify(browser=args.browser)


if __name__ == "__main__":
    raise SystemExit(main())
