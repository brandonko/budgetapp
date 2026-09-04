from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1] / "app"
sys.path.insert(0, str(APP_DIR))

from server import (  # noqa: E402
    COLUMNS,
    CsvDataError,
    migrate_transaction_schema,
    read_backup_transactions,
    read_transaction_state,
)


class CsvSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_header(self, path: Path, columns: tuple[str, ...]) -> bytes:
        with path.open("w", encoding="utf-8", newline="") as handle:
            csv.writer(handle).writerow(columns)
        return path.read_bytes()

    def malformed_schemas(self) -> dict[str, tuple[tuple[str, ...], str]]:
        reordered = list(COLUMNS)
        reordered[0], reordered[1] = reordered[1], reordered[0]
        return {
            "duplicate": (COLUMNS + ("notes",), "duplicate columns"),
            "unexpected": (COLUMNS + ("privateMemo",), "unexpected columns"),
            "reordered": (tuple(reordered), "required order"),
        }

    def test_master_reader_rejects_duplicate_unexpected_and_reordered_columns(self) -> None:
        for name, (columns, expected_error) in self.malformed_schemas().items():
            with self.subTest(name=name):
                path = self.root / f"{name}.csv"
                self.write_header(path, columns)

                with self.assertRaisesRegex(CsvDataError, expected_error):
                    read_transaction_state(path)

    def test_migration_rejects_malformed_headers_without_writing_or_backing_up(self) -> None:
        for name, (columns, expected_error) in self.malformed_schemas().items():
            with self.subTest(name=name):
                path = self.root / f"migration-{name}.csv"
                original = self.write_header(path, columns)

                with self.assertRaisesRegex(CsvDataError, expected_error):
                    migrate_transaction_schema(path)

                self.assertEqual(path.read_bytes(), original)
                self.assertFalse((self.root / "backups").exists())

    def test_backup_reader_rejects_malformed_headers(self) -> None:
        for name, (columns, expected_error) in self.malformed_schemas().items():
            with self.subTest(name=name):
                path = self.root / f"backup-{name}.csv"
                self.write_header(path, columns)

                with self.assertRaisesRegex(CsvDataError, expected_error):
                    read_backup_transactions(path)


if __name__ == "__main__":
    unittest.main()
