"""Verification cannot succeed by silently omitting a required suite or test."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ledger_verify", ROOT / "scripts/verify.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class VerificationTests(unittest.TestCase):
    def test_missing_or_unsupported_node_is_an_actionable_failure(self):
        with patch.object(VERIFY.shutil, "which", return_value=None):
            with self.assertRaisesRegex(VERIFY.VerificationError, "Node.js 22.*PATH"):
                VERIFY.require_runtimes()
        for output, returncode in [("v20.19.0\n", 0), ("unknown", 0), ("v22.0.0\n", 1)]:
            with self.subTest(output=output, returncode=returncode), \
                    patch.object(VERIFY.shutil, "which", return_value="node"), \
                    patch.object(VERIFY.subprocess, "run", return_value=subprocess.CompletedProcess([], returncode, output)):
                with self.assertRaisesRegex(VERIFY.VerificationError, "Node.js"):
                    VERIFY.require_runtimes()

    def test_empty_javascript_discovery_fails_instead_of_claiming_success(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(VERIFY.VerificationError, "No JavaScript regression"):
                VERIFY.javascript_files(Path(directory))

    def test_both_suites_run_after_a_failure_and_paths_remain_separate_arguments(self):
        with tempfile.TemporaryDirectory(prefix="ledger verify ") as directory:
            root = Path(directory)
            (root / "tests").mkdir()
            for name in ["test_z.js", "test_a space.js"]:
                (root / "tests" / name).touch()
            with patch.object(VERIFY, "require_runtimes", return_value="node path/node"), \
                    patch.object(VERIFY, "run_suite", side_effect=[False, True]) as run, \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(VERIFY.verify(root), 1)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[1][-1], "--python-tests")
            self.assertEqual(run.call_args_list[1].args[1], ["node path/node", "--test", "--test-reporter=tap",
                             str(root / "tests/test_a space.js"), str(root / "tests/test_z.js")])
            self.assertEqual(run.call_args_list[1].args[3]["LEDGER_TEST_PYTHON"], VERIFY.sys.executable)

    def test_prerequisite_failure_does_not_run_any_suite(self):
        with patch.object(VERIFY, "require_runtimes", side_effect=VERIFY.VerificationError("Install Node.js")), \
                patch.object(VERIFY, "run_suite") as run, redirect_stderr(io.StringIO()) as output:
            self.assertEqual(VERIFY.verify(), 2)
        run.assert_not_called()
        self.assertIn("Install Node.js", output.getvalue())

    def test_python_skips_and_expected_failures_make_the_gate_fail(self):
        class Skipped(unittest.TestCase):
            @unittest.skip("synthetic missing prerequisite")
            def test_example(self):
                pass
        class ExpectedFailure(unittest.TestCase):
            @unittest.expectedFailure
            def test_example(self):
                self.fail("synthetic known failure")
        class Passing(unittest.TestCase):
            def test_example(self):
                self.assertEqual(2 + 2, 4)
        for case, expected in [(Skipped, 1), (ExpectedFailure, 1), (Passing, 0)]:
            with self.subTest(case=case.__name__), \
                    patch.object(VERIFY.unittest.defaultTestLoader, "discover",
                                 return_value=unittest.defaultTestLoader.loadTestsFromTestCase(case)), \
                    redirect_stderr(io.StringIO()):
                self.assertEqual(VERIFY.run_python_tests(), expected)
        with patch.object(VERIFY.unittest.defaultTestLoader, "discover", return_value=unittest.TestSuite()), \
                redirect_stderr(io.StringIO()):
            self.assertEqual(VERIFY.run_python_tests(), 1)

    def test_javascript_skips_todos_empty_runs_and_process_failures_are_rejected(self):
        for tests, skipped, todo, returncode, expected in [
            (3, 0, 0, 0, True), (3, 1, 0, 0, False), (3, 0, 1, 0, False),
            (0, 0, 0, 0, False), (3, 0, 0, 1, False),
        ]:
            with self.subTest(tests=tests, skipped=skipped, todo=todo, returncode=returncode), \
                    patch.object(VERIFY.subprocess, "Popen") as popen, \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                process = popen.return_value.__enter__.return_value
                process.stdout = io.StringIO(f"# tests {tests}\n# skipped {skipped}\n# todo {todo}\n")
                process.wait.return_value = returncode
                self.assertEqual(VERIFY.run_suite("synthetic", ["node", "test path.js"], ROOT, {}, tap=True), expected)
        with patch.object(VERIFY.subprocess, "Popen", side_effect=OSError("synthetic launch failure")), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertFalse(VERIFY.run_suite("synthetic", ["missing"], ROOT, {}))

    def test_browser_tools_are_required_only_when_browser_checks_are_requested(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tests").mkdir()
            (root / "tests/test_sample.js").touch()
            with patch.object(VERIFY, "require_runtimes", return_value="node"), \
                    patch.object(VERIFY, "run_suite", return_value=True) as run, \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as output:
                self.assertEqual(VERIFY.verify(root), 0)
                self.assertEqual(run.call_count, 2)
                run.reset_mock()
                self.assertEqual(VERIFY.verify(root, browser=True), 2)
                run.assert_not_called()
                self.assertIn("npm ci", output.getvalue())
                cli = root / "node_modules/@playwright/test/cli.js"
                cli.parent.mkdir(parents=True)
                cli.touch()
                self.assertEqual(VERIFY.verify(root, browser=True), 0)
                self.assertEqual(run.call_count, 3)
                self.assertEqual(run.call_args_list[-1].args[1], ["node", str(cli), "test"])


if __name__ == "__main__":
    unittest.main()
