import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
NAVIGATION_PAGES = ("index.html", "upload.html", "classifications.html", "settings.html")


class NavigationAccessibilityTests(unittest.TestCase):
    def test_every_page_connects_the_disclosure_to_navigation(self) -> None:
        for page in NAVIGATION_PAGES:
            html = (APP_ROOT / page).read_text(encoding="utf-8")
            with self.subTest(page=page):
                self.assertIn('aria-controls="main-navigation"', html)
                self.assertIn('id="main-navigation" aria-label="Main navigation"', html)
                self.assertNotIn('aria-haspopup="menu"', html)

    def test_toggle_name_and_expanded_state_follow_the_disclosure(self) -> None:
        javascript = (APP_ROOT / "navigation.js").read_text(encoding="utf-8")
        self.assertIn('button.setAttribute("aria-expanded", String(menu.open))', javascript)
        self.assertIn('menu.open ? "Close navigation menu" : "Open navigation menu"', javascript)


if __name__ == "__main__":
    unittest.main()
