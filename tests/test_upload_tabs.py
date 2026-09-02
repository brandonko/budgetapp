from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class UploadTabsTests(unittest.TestCase):
    def test_each_importer_has_an_accessible_tab_and_panel(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        tabs = re.findall(
            r'<button id="([^"]+-import-tab)" role="tab"[^>]*aria-selected="(true|false)"'
            r'[^>]*aria-controls="([^"]+)"[^>]*>',
            html,
        )
        self.assertEqual(len(tabs), 6)
        self.assertEqual(sum(selected == "true" for _tab, selected, _panel in tabs), 1)
        for tab_id, _selected, panel_id in tabs:
            with self.subTest(tab_id=tab_id):
                self.assertRegex(
                    html,
                    rf'<section class="amazon-direct" id="{re.escape(panel_id)}" role="tabpanel"\s+'
                    rf'aria-labelledby="{re.escape(tab_id)}"',
                )

    def test_keyboard_navigation_is_supported(self) -> None:
        javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        for key in ("ArrowRight", "ArrowLeft", "Home", "End"):
            self.assertIn(f'event.key === "{key}"', javascript)

    def test_apple_card_supports_direct_import_and_csv_fallback(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        self.assertIn('id="applecard-import-button"', html)
        self.assertIn('id="applecard-file" type="file" accept=".csv,text/csv"', html)
        self.assertIn('MIN_APPLE_CARD_EXTENSION_VERSION = "0.6.2"', javascript)
        self.assertIn('action: "startAppleCardImport"', javascript)

    def test_importers_without_account_metadata_have_editable_defaults(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        expected = {
            "amazon": ("Prime VISA", "CREDIT CARD", "chase"),
            "aliexpress": ("Credit Card Mastercard", "CREDIT CARD", "Bank of America"),
            "venmo": ("Checking Account", "BANK", "Bank of America"),
            "ebay": ("eBay", "CREDIT CARD", "eBay"),
            "applecard": ("Apple Card", "CREDIT CARD", "Goldman Sachs"),
        }
        for source, values in expected.items():
            for field, value in zip(("account-name", "account-type", "provider"), values):
                with self.subTest(source=source, field=field):
                    self.assertIn(
                        f'id="{source}-{field}" type="text" value="{value}" required', html
                    )

    def test_import_preview_requires_confirmation_and_supports_cancellation(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        self.assertNotIn('id="import-result"', html)
        self.assertIn('id="import-review-title"', html)
        self.assertIn('id="confirm-import-review"', html)
        self.assertIn('id="confirm-import-review" type="button" disabled', html)
        self.assertIn('id="cancel-import-review"', html)
        self.assertIn('id="review-dashboard-link"', html)
        self.assertIn('checkbox.checked = transaction._selected', javascript)
        self.assertIn("state.reviewCommitted || selected === 0", javascript)
        self.assertIn('_selected: !transaction._isDuplicate', javascript)
        self.assertIn("Ledger returned an outdated import response", javascript)
        self.assertIn('reviewSessionUrl("commit")', javascript)
        self.assertIn('reviewSessionUrl("cancel")', javascript)
        self.assertIn('if (event.target === elements.reviewDialog) cancelImportReview()', javascript)


if __name__ == "__main__":
    unittest.main()
