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
    COMPATIBLE_COLUMNS,
    PRE_GROUP_COLUMNS,
    CsvDataError,
    migrate_transaction_schema,
    read_backup_transactions,
    read_transaction_state,
)


class CsvSchemaTests(unittest.TestCase):
    def test_current_and_pre_group_reads_preserve_bytes_and_group_values(self):
        for columns in (COLUMNS, PRE_GROUP_COLUMNS):
            with self.subTest(columns=columns):
                path = self.root / ("current.csv" if columns == COLUMNS else "pre-group.csv")
                row = dict.fromkeys(columns, "")
                row.update(date="2026-09-01", description="Synthetic purchase", amount="12.34",
                           category="Shopping", accountName="Demo", accountType="BANK", provider="Demo")
                if "group" in row:
                    row["group"] = "Demo project"
                with path.open("w", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=columns)
                    writer.writeheader()
                    writer.writerow(row)
                original = path.read_bytes()
                transactions, revision = read_transaction_state(path)
                self.assertEqual(transactions[0]["group"], row.get("group", ""))
                self.assertEqual(read_backup_transactions(path)[0]["group"], row.get("group", ""))
                self.assertEqual(path.read_bytes(), original)
                self.assertTrue(revision)
                self.assertEqual(migrate_transaction_schema(path), columns != COLUMNS)
                migrated, _ = read_transaction_state(path)
                self.assertEqual(migrated, transactions)
                if columns != COLUMNS:
                    backups = list((self.root / "backups").glob("*.csv"))
                    self.assertEqual(len(backups), 1)
                    self.assertEqual(backups[0].read_bytes(), original)

    def test_every_supported_legacy_header_remains_accepted_for_restore_and_migration(self):
        for index, columns in enumerate(COMPATIBLE_COLUMNS):
            with self.subTest(columns=columns):
                path = self.root / f"legacy-{index}.csv"
                self.write_header(path, columns)
                self.assertEqual(read_backup_transactions(path), [])
                self.assertEqual(migrate_transaction_schema(path), columns != COLUMNS)
                self.assertEqual(read_transaction_state(path)[0], [])

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
