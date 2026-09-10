import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


APP_ROOT = Path(__file__).resolve().parents[1] / "app"
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
MENU_ROLES = {"menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio"}


class Element:
    def __init__(self, tag, attrs, parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []

    def has_class(self, name):
        return name in (self.attrs.get("class") or "").split()

    def descendants(self):
        for child in self.children:
            yield child
            yield from child.descendants()


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.root = Element("document", [])
        self.stack = [self.root]
        self.feed(path.read_text(encoding="utf-8"))
        self.close()
        self.elements = list(self.root.descendants())

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(element)
        if tag not in VOID_TAGS:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def with_class(self, name):
        return [element for element in self.elements if element.has_class(name)]

    def with_id(self, identity):
        return [element for element in self.elements if element.attrs.get("id") == identity]


class NavigationAccessibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        paths = sorted(APP_ROOT.glob("*.html"))
        if not paths:
            raise AssertionError("No app HTML pages discovered; navigation coverage is empty")
        cls.pages = {path.name: Page(path) for path in paths}

    def only(self, elements, message):
        self.assertEqual(len(elements), 1, message)
        return elements[0]

    def navigation(self, filename, page):
        menu = self.only(page.with_class("site-menu"), f"{filename}: require one shared site-menu")
        self.assertEqual(menu.tag, "details")
        toggle = self.only([child for child in menu.children if child.tag == "summary"], "Require one direct summary")
        self.assertTrue(toggle.has_class("menu-button"))
        self.assertIs(menu.children[0], toggle, "Summary must be the first element in details")
        nav = self.only([child for child in menu.children if child.tag == "nav"], "Require one direct navigation region")
        self.assertTrue(nav.has_class("menu-panel"))
        identity = nav.attrs.get("id")
        self.assertTrue(identity, "Navigation region needs an ID")
        self.assertEqual(len(page.with_id(identity)), 1, "Navigation ID must be unique")
        self.assertEqual(toggle.attrs.get("aria-controls"), identity)
        self.assertTrue((nav.attrs.get("aria-label") or "").strip(), "Navigation needs an accessible name")
        opened = "open" in menu.attrs
        self.assertEqual(toggle.attrs.get("aria-expanded"), str(opened).lower())
        self.assertEqual(toggle.attrs.get("aria-label"), "Close navigation menu" if opened else "Open navigation menu")
        for element in [menu, *menu.descendants()]:
            self.assertFalse(set((element.attrs.get("role") or "").split()) & MENU_ROLES,
                             "Site links must not claim ARIA menu keyboard semantics")
            self.assertNotIn("aria-haspopup", element.attrs, "Native navigation is not a popup menu")
        return nav

    def test_every_discovered_page_uses_connected_native_navigation(self):
        for filename, page in self.pages.items():
            with self.subTest(page=filename):
                self.navigation(filename, page)
                scripts = []
                for element in page.elements:
                    if element.tag != "script":
                        continue
                    source = urlsplit(element.attrs.get("src") or "")
                    if not source.scheme and not source.netloc and source.path in {"/navigation.js", "navigation.js"}:
                        scripts.append(element)
                script = self.only(scripts, "Load shared navigation.js exactly once")
                self.assertIn("defer", script.attrs, "Defer navigation.js until markup is parsed")

    def test_all_pages_share_destinations_and_mark_their_current_page(self):
        self.assertIn("index.html", self.pages)
        home_nav = self.navigation("index.html", self.pages["index.html"])
        expected = [element.attrs.get("href") for element in home_nav.descendants() if element.tag == "a"]
        self.assertTrue(expected, "Navigation must have destinations")
        self.assertTrue(all(expected), "Navigation links need nonempty href values")
        self.assertEqual(len(expected), len(set(expected)), "Navigation destinations must not repeat")
        for filename, page in self.pages.items():
            with self.subTest(page=filename):
                nav = self.navigation(filename, page)
                links = [element for element in nav.descendants() if element.tag == "a"]
                self.assertEqual([element.attrs.get("href") for element in links], expected)
                current = self.only([element for element in links if element.attrs.get("aria-current") == "page"],
                                    "Mark exactly one current navigation link")
                route = {"index.html": "/", "upload.html": "/import"}.get(filename, "/" + Path(filename).stem)
                self.assertEqual(current.attrs.get("href"), route)

    def test_inline_transaction_filters_control_unique_non_popup_panels(self):
        for filename, page in self.pages.items():
            buttons = page.with_class("transaction-filter-button")
            panels = page.with_class("transaction-filter-panel")
            for button in buttons:
                with self.subTest(page=filename, control=button.attrs.get("id")):
                    self.assertEqual(button.tag, "button")
                    self.assertEqual(button.attrs.get("type"), "button", "Filters must not submit a form")
                    identity = button.attrs.get("aria-controls")
                    self.assertTrue(identity, "Filters button needs aria-controls")
                    panel = self.only(page.with_id(identity), "Filter target must exist exactly once")
                    self.assertTrue(panel.has_class("transaction-filter-panel"))
                    self.assertEqual(button.attrs.get("aria-expanded"), "false" if "hidden" in panel.attrs else "true")
                    self.assertNotIn("aria-haspopup", button.attrs, "Inline Filters is not a popup")
                    self.assertNotIn("popover", panel.attrs, "Filters must remain an in-flow panel")
                    self.assertFalse(set((panel.attrs.get("role") or "").split()) & MENU_ROLES)
            for panel in panels:
                with self.subTest(page=filename, panel=panel.attrs.get("id")):
                    identity = panel.attrs.get("id")
                    self.assertTrue(identity, "Transaction filter panel needs an ID")
                    self.assertEqual(sum(button.attrs.get("aria-controls") == identity for button in buttons), 1,
                                     "Each transaction filter panel needs exactly one controlling Filters button")


if __name__ == "__main__":
    unittest.main()
