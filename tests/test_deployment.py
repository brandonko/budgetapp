import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ledger_deploy", ROOT / "deploy/ledger_deploy.py")
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


def archive_entry(name, kind=tarfile.REGTYPE):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        info = tarfile.TarInfo(name)
        info.type = kind
        info.size = 0
        if kind == tarfile.SYMTYPE:
            info.linkname = "/var/lib/ledger/transactions.csv"
        archive.addfile(info, io.BytesIO())
    return buffer.getvalue()


class DeploymentTests(unittest.TestCase):
    def test_release_extraction_rejects_private_data_and_path_escapes(self):
        for name in ("../outside", "/absolute", "data/transactions.csv",
                     "raw_data_files/private.csv", "a\\..\\outside", ".git/config"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    DEPLOY.unpack_release(archive_entry(name), Path(directory))
                self.assertEqual(list(Path(directory).iterdir()), [])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                DEPLOY.unpack_release(archive_entry("app/link", tarfile.SYMTYPE), Path(directory))

    def test_release_extraction_preserves_code_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            DEPLOY.unpack_release(archive_entry("app/server.py"), root)
            self.assertTrue((root / "app/server.py").is_file())
            (root / "app/server.py").write_text("existing")
            with self.assertRaises(FileExistsError):
                DEPLOY.unpack_release(archive_entry("app/server.py"), root)
            self.assertEqual((root / "app/server.py").read_text(), "existing")

    def test_snapshot_keeps_all_synthetic_state_and_existing_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            fixtures = {"transactions.csv": "synthetic", "classifications.json": "[]",
                        "taxonomy.json": "{}", "transactions.transfer-review.json": "{}",
                        "backups/older.csv": "old synthetic"}
            for name, content in fixtures.items():
                path = data / name
                path.parent.mkdir(exist_ok=True)
                path.write_text(content)
            first = DEPLOY.snapshot(data, root / "snapshots")
            second = DEPLOY.snapshot(data, root / "snapshots")
            self.assertNotEqual(first, second)
            with tarfile.open(first) as archive:
                for name, content in fixtures.items():
                    self.assertEqual(archive.extractfile("ledger/" + name).read().decode(), content)
            self.assertEqual((data / "transactions.csv").read_text(), "synthetic")

    def test_service_keeps_state_outside_release_and_binds_for_lan(self):
        service = (ROOT / "deploy/ledger.service").read_text()
        self.assertIn("--csv /var/lib/ledger/transactions.csv", service)
        self.assertIn("--host 0.0.0.0 --port 8000", service)
        self.assertIn("User=ledger", service)
        self.assertIn("StateDirectory=ledger", service)

    def deployment_environment(self, directory):
        root = Path(directory)
        base = root / "app"
        base.mkdir()
        (base / "repository.git").mkdir()
        (base / "current").mkdir()
        (base / "current/.ledger-revision").write_text("previous")
        config = root / "config.json"
        config.write_text('{"branch":"main","repository":"https://example.test/repo.git"}')
        data = root / "data"
        data.mkdir()
        (data / "transactions.csv").write_text("synthetic")
        return base, config, data, root / "snapshots"

    def test_verification_failure_leaves_running_service_and_data_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            base, config, data, backups = self.deployment_environment(directory)
            def execute(*args, **kwargs):
                if "rev-parse" in args:
                    return subprocess.CompletedProcess(args, 0, stdout="a" * 40)
                if "archive" in args:
                    return subprocess.CompletedProcess(args, 0, stdout=archive_entry("app/server.py"))
                if "runuser" in args:
                    raise subprocess.CalledProcessError(1, args)
                return subprocess.CompletedProcess(args, 0)
            with patch.multiple(DEPLOY, BASE=base, CONFIG=config, DATA=data, BACKUPS=backups), \
                    patch.object(DEPLOY, "run", side_effect=execute) as run, \
                    patch.object(DEPLOY, "snapshot") as snapshot:
                with self.assertRaises(subprocess.CalledProcessError):
                    DEPLOY.deploy()
                snapshot.assert_not_called()
                verification = next(call for call in run.call_args_list if call.args[0] == "runuser")
                self.assertEqual(verification.args, ("runuser", "-u", "ledger", "--", "/usr/bin/python3", "-B", "scripts/verify.py"))
                self.assertEqual(verification.kwargs["cwd"].parent, base / "releases")
                self.assertFalse(any(call.args[0] == "systemctl" for call in run.call_args_list))
                self.assertEqual((data / "transactions.csv").read_text(), "synthetic")

    def test_failed_startup_preserves_backup_stops_service_and_selects_previous_code(self):
        with tempfile.TemporaryDirectory() as directory:
            base, config, data, backups = self.deployment_environment(directory)
            def execute(*args, **kwargs):
                if "rev-parse" in args:
                    return subprocess.CompletedProcess(args, 0, stdout="a" * 40)
                if "archive" in args:
                    return subprocess.CompletedProcess(args, 0, stdout=archive_entry("app/server.py"))
                return subprocess.CompletedProcess(args, 0)
            with patch.multiple(DEPLOY, BASE=base, CONFIG=config, DATA=data, BACKUPS=backups), \
                    patch.object(DEPLOY, "run", side_effect=execute) as run, \
                    patch.object(DEPLOY, "healthy", return_value=False), \
                    patch.object(DEPLOY.time, "sleep"), \
                    patch.object(DEPLOY, "select_release") as select:
                with self.assertRaises(RuntimeError):
                    DEPLOY.deploy()
                select.assert_called_with((base / "current").resolve())
                self.assertEqual(run.call_args_list[-1].args, ("systemctl", "stop", "ledger.service"))
                self.assertEqual(len(list(backups.glob("*.tar.gz"))), 1)
                self.assertEqual((data / "transactions.csv").read_text(), "synthetic")


if __name__ == "__main__":
    unittest.main()
