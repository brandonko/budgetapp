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

    def test_credit_karma_warns_about_disconnected_accounts(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        self.assertIn("Disconnected accounts will have missing", html)
        self.assertIn(
            'href="https://www.creditkarma.com/connect/manage-accounts"', html
        )
        self.assertIn('rel="noopener noreferrer"', html)

    def test_credit_karma_filters_are_one_explicit_vertical_list(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        css = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
        expected_matches = {
            "amazon": "description contains “amazon”",
            "aliexpress": "description contains “alipay”, “ali express”, or “aliexpress”",
            "venmo": "description contains “venmo”",
            "ebay": "description contains “ebay”",
        }
        for source, copy in expected_matches.items():
            self.assertEqual(html.count(f'id="creditkarma-ignore-{source}"'), 1)
            self.assertIn(copy, html)
        self.assertRegex(
            css,
            r"\.import-options\s*\{[^}]*flex-direction:\s*column;",
        )

    def test_apple_card_supports_direct_import_and_csv_fallback(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        javascript = (ROOT / "app" / "upload.js").read_text(encoding="utf-8")
        self.assertIn('id="applecard-import-button"', html)
        self.assertIn('id="applecard-file" type="file" accept=".csv,text/csv"', html)
        self.assertIn(
            'id="applecard-file-import-button" type="button" disabled', html
        )
        self.assertIn('MIN_APPLE_CARD_EXTENSION_VERSION = "0.6.2"', javascript)
        self.assertIn('action: "startAppleCardImport"', javascript)
        self.assertIn("Every transaction in the selected CSV will be reviewed", html)
        self.assertIn("filterDateRange: false", javascript)
        self.assertIn(
            'elements.appleCardFile.addEventListener("change", updateAppleCardFileButton)',
            javascript,
        )

    def test_import_guide_explains_review_dates_accounts_and_classification(self) -> None:
        html = (ROOT / "app" / "upload.html").read_text(encoding="utf-8")
        self.assertIn('class="import-note import-guide"', html)
        self.assertIn("nothing is", html)
        self.assertIn("until you select transactions and confirm", html)
        self.assertIn("Start and end dates are inclusive", html)
        self.assertIn("usernames or credentials", html)
        self.assertIn("automatic importing is currently broken", html)
        self.assertIn("Amazon, AliExpress, and", html)
        self.assertIn("eBay start as Shopping", html)
        self.assertIn("saved classification rule", html)

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
        self.assertIn("elements.cancelReview.disabled = false", javascript)
        self.assertIn('input name="refunded" type="checkbox"', html)
        self.assertNotIn("Remove from import", html)
        self.assertNotIn("deleteImportedTransaction", javascript)


if __name__ == "__main__":
    unittest.main()
