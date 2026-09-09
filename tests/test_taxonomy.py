from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(APP_DIR))

from server import (  # noqa: E402
    BudgetRequestHandler,
    CsvDataError,
    ThreadingHTTPServer,
    normalize_taxonomy,
    taxonomy_path,
    taxonomy_summary,
    write_transactions_atomic,
)


def transaction(category: str, subcategory: str, description: str) -> dict[str, object]:
    return {
        "date": "2026-09-01",
        "description": description,
        "amount": 12.34,
        "category": category,
        "subcategory": subcategory,
        "accountName": "Checking",
        "accountType": "BANK",
        "provider": "Bank",
        "notes": "",
        "tags": "",
        "flags": "",
        "createdAt": "",
    }


class TaxonomyEngineTests(unittest.TestCase):
    def test_normalization_collapses_whitespace_deduplicates_and_sorts(self) -> None:
        document = normalize_taxonomy(
            {
                "categories": [
                    {"name": " Travel ", "subcategories": [" Flights ", "Hotels"]},
                    {"name": "food", "subcategories": ["Restaurants"]},
                    {"name": "FOOD", "subcategories": [" restaurants ", "Groceries"]},
                ]
            }
        )

        self.assertEqual([category["name"] for category in document["categories"]], ["food", "Travel"])
        self.assertEqual(document["categories"][0]["subcategories"], ["Groceries", "Restaurants"])

    def test_summary_merges_saved_and_transaction_derived_values_with_counts(self) -> None:
        document = normalize_taxonomy(
            {"categories": [{"name": "Food", "subcategories": ["Groceries", "Restaurants"]}]}
        )
        summary = taxonomy_summary(
            [
                transaction("Food", "Groceries", "Market"),
                transaction("food", "Coffee", "Cafe"),
                transaction("Travel", "Flights", "Airline"),
                transaction("", "", "Uncategorized"),
            ],
            document,
        )

        self.assertEqual([category["name"] for category in summary["categories"]], ["Food", "Travel"])
        food = summary["categories"][0]
        self.assertEqual(food["transactionCount"], 2)
        self.assertEqual(
            [(item["name"], item["transactionCount"]) for item in food["subcategories"]],
            [("Coffee", 1), ("Groceries", 1), ("Restaurants", 0)],
        )

    def test_blank_names_are_rejected(self) -> None:
        with self.assertRaises(CsvDataError):
            normalize_taxonomy({"categories": [{"name": "  ", "subcategories": []}]})


class TaxonomyApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "data" / "transactions.csv"
        self.csv_path.parent.mkdir(parents=True)
        write_transactions_atomic(
            self.csv_path,
            [transaction("Food", "Groceries", "Market"), transaction("Travel", "", "Train")],
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
        self.server.csv_path = self.csv_path
        self.server.data_lock = threading.Lock()
        self.server.amazon_import_sessions = {}
        self.server.amazon_import_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def request(self, method: str, path: str, payload: object | None = None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            try:
                return error.code, json.load(error)
            finally:
                error.close()

    def test_get_derives_taxonomy_and_put_persists_new_values(self) -> None:
        status, initial = self.request("GET", "/api/taxonomy")
        self.assertEqual(status, 200)
        self.assertEqual(initial["revision"], "missing")
        self.assertEqual([item["name"] for item in initial["categories"]], ["Food", "Travel"])

        initial["categories"].append(
            {"name": "Recurring", "subcategories": [{"name": "Rent", "transactionCount": 0}]}
        )
        status, saved = self.request("PUT", "/api/taxonomy", initial)
        self.assertEqual(status, 200)
        self.assertNotEqual(saved["revision"], "missing")
        self.assertTrue(taxonomy_path(self.csv_path).exists())
        self.assertIn("Recurring", [item["name"] for item in saved["categories"]])

        deletion = {
            "revision": saved["revision"],
            "categories": [
                category for category in saved["categories"]
                if category["name"] != "Recurring"
            ],
        }
        status, deleted = self.request("PUT", "/api/taxonomy", deletion)
        self.assertEqual(status, 200)
        self.assertNotIn("Recurring", [item["name"] for item in deleted["categories"]])
        self.assertIn("Food", [item["name"] for item in deleted["categories"]])

        status, stale = self.request("PUT", "/api/taxonomy", initial)
        self.assertEqual(status, 409)
        self.assertIn("changed after it loaded", stale["error"])


class TaxonomyPageTests(unittest.TestCase):
    def test_settings_exposes_accessible_taxonomy_tree_and_inline_creation(self) -> None:
        html = (APP_DIR / "settings.html").read_text(encoding="utf-8")
        javascript = (APP_DIR / "settings.js").read_text(encoding="utf-8")
        css = (APP_DIR / "styles.css").read_text(encoding="utf-8")

        self.assertIn('id="taxonomy-settings-tab"', html)
        self.assertIn('id="taxonomy-settings-panel"', html)
        self.assertIn('id="taxonomy-tree"', html)
        self.assertIn('id="taxonomy-subcategory-filter"', html)
        self.assertIn('aria-pressed="true">Hide empty categories</button>', html)
        self.assertNotIn('id="taxonomy-dialog"', html)
        self.assertNotIn('id="add-taxonomy-category-button"', html)
        self.assertIn('fetch("/api/taxonomy"', javascript)
        self.assertIn('function createTaxonomyInlineForm(mode, parentCategory = "")', javascript)
        self.assertIn('createTaxonomyInlineForm("subcategory", category.name)', javascript)
        self.assertIn('cards.push(createTaxonomyInlineForm("category"))', javascript)
        self.assertIn('saveTaxonomyEntry(event, mode, parentCategory, input, button)', javascript)
        self.assertIn('if (mode === "category") state.hideTaxonomyCategoriesWithoutSubcategories = false', javascript)
        self.assertIn('function deleteTaxonomyEntry(mode, name, parentCategory = "")', javascript)
        self.assertIn('deleteTaxonomyEntry("category", category.name)', javascript)
        self.assertIn('deleteTaxonomyEntry("subcategory", subcategory.name, category.name)', javascript)
        self.assertIn("const confirmed = window.confirm(", javascript)
        self.assertIn('if (transactionCount > 0)', javascript)
        self.assertIn('must be reclassified before', javascript)
        self.assertNotIn("openTaxonomyDialog", javascript)
        self.assertIn("hideTaxonomyCategoriesWithoutSubcategories", javascript)
        self.assertIn("hideTaxonomyCategoriesWithoutSubcategories: true", javascript)
        self.assertIn("taxonomy-category-card", css)
        self.assertIn(".taxonomy-category-card--create", css)
        self.assertIn(".taxonomy-inline-create", css)
        self.assertIn(".taxonomy-delete-category", css)
        self.assertIn(".taxonomy-delete-subcategory", css)
        self.assertIn("border-style: dashed", css)
        self.assertIn('html[data-theme="dark"] .taxonomy-subcategory {', css)
        self.assertIn('html[data-theme="dark"] .taxonomy-subcategory small {', css)
        self.assertNotIn('html[data-theme="dark"] .taxonomy-subcategory-chip', css)


if __name__ == "__main__":
    unittest.main()
