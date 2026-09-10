from __future__ import annotations

import sys
import re
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(APP_DIR))

from server import BudgetRequestHandler, ThreadingHTTPServer  # noqa: E402


class PageContract(HTMLParser):
    """Read semantic HTML contracts without coupling tests to whitespace."""

    def __init__(self, filename: str) -> None:
        super().__init__()
        self.elements: list[tuple[str, dict[str, str | None]]] = []
        self.menu_links: list[dict[str, str | None]] = []
        self.form_fields: dict[str, dict[str, dict[str, str | None]]] = {}
        self.current_form = ""
        self.main_navigation = False
        self.feed((APP_DIR / filename).read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs) -> None:
        attributes = dict(attrs)
        self.elements.append((tag, attributes))
        if tag == "nav":
            self.main_navigation = attributes.get("aria-label") == "Main navigation"
        if tag == "a" and self.main_navigation:
            self.menu_links.append(attributes)
        if tag == "form":
            self.current_form = attributes.get("id", "")
            self.form_fields[self.current_form] = {}
        if tag in {"input", "select", "textarea"} and self.current_form:
            name = attributes.get("name")
            if name:
                self.form_fields[self.current_form][name] = {"tag": tag, **attributes}

    def handle_endtag(self, tag) -> None:
        if tag == "nav":
            self.main_navigation = False
        if tag == "form":
            self.current_form = ""


class TransactionsPageRouteTests(unittest.TestCase):
    def test_page_and_dependencies_are_served_without_creating_a_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "data" / "transactions.csv"
            server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
            server.csv_path = database
            server.data_lock = threading.Lock()
            server.amazon_import_sessions = {}
            server.amazon_import_lock = threading.Lock()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_port}"
                with urlopen(f"{base_url}/transactions", timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get_content_type(), "text/html")
                    self.assertEqual(response.read(), (APP_DIR / "transactions.html").read_bytes())

                page = PageContract("transactions.html")
                resources = [
                    attributes.get("src") if tag == "script" else attributes.get("href")
                    for tag, attributes in page.elements
                    if tag == "script" or (tag == "link" and attributes.get("rel") == "stylesheet")
                ]
                for resource in ["/transactions.html", *resources]:
                    with self.subTest(resource=resource):
                        self.assertTrue(resource and resource.startswith("/"))
                        with urlopen(f"{base_url}{resource}", timeout=3) as response:
                            self.assertEqual(response.status, 200)
                            expected = APP_DIR / Path(urlsplit(resource).path).name
                            self.assertEqual(response.read(), expected.read_bytes())
                self.assertFalse(database.exists(), "Viewing Transactions must not initialize the CSV")
                self.assertFalse(database.parent.exists(), "Static views must not create a data directory")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


class TransactionsPageContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.page = PageContract("transactions.html")

    def test_tags_wrap_without_a_nested_scroll_area(self) -> None:
        css = (APP_DIR / "transactions.css").read_text(encoding="utf-8")
        tags = re.search(r"\.alltime-tag-options\s*\{([^}]+)\}", css)
        self.assertIsNotNone(tags)
        self.assertIn("flex-wrap: wrap", tags[1])
        self.assertIn("max-height: none", tags[1])
        self.assertIn("overflow: visible", tags[1])
        self.assertNotIn("overflow-y:", tags[1])
        panel = re.search(r"\.transactions-query \.transaction-filter-popover\s*\{([^}]+)\}", css)
        self.assertIsNotNone(panel)
        self.assertIn("overflow-y: auto", panel[1])

    def test_all_transaction_filter_variants_have_no_apply_button(self) -> None:
        html = (APP_DIR / "transactions.html").read_text(encoding="utf-8")
        self.assertNotIn('id="refresh-transactions"', html)
        self.assertIn('id="alltime-date-error"', html)
        for filename in ("transactions.html", "index.html", "upload.html", "settings.html", "classifications.html"):
            with self.subTest(page=filename):
                page = (APP_DIR / filename).read_text(encoding="utf-8")
                self.assertNotRegex(page, r'id="apply-[^"]*filters"')
        for filename in ("transactions.js", "app.js", "upload.js", "settings.js"):
            with self.subTest(controller=filename):
                self.assertIn("transactionUi.bindLiveTransactionFilters(",
                              (APP_DIR / filename).read_text(encoding="utf-8"))

    def test_shared_dependencies_load_before_the_page_controller(self) -> None:
        scripts = [
            (urlsplit(attributes["src"]).path, attributes)
            for tag, attributes in self.page.elements
            if tag == "script" and attributes.get("src")
        ]
        sources = [source for source, _ in scripts]
        self.assertEqual(sources.count("/transactions.js"), 1)
        for dependency in ("/theme.js", "/transaction-ui.js", "/transactions-model.js", "/group-comparison.js"):
            self.assertEqual(sources.count(dependency), 1)
            self.assertLess(sources.index(dependency), sources.index("/transactions.js"))
        for source, attributes in scripts:
            if source in {"/transaction-ui.js", "/transactions-model.js", "/group-comparison.js", "/transactions.js"}:
                self.assertIn("defer", attributes, source)
                self.assertNotIn("async", attributes, source)

    def test_comparison_is_an_accessible_workspace_not_an_independent_transaction_editor(self) -> None:
        elements = {attrs.get("id"): (tag, attrs) for tag, attrs in self.page.elements if attrs.get("id")}
        for tab_id, panel_id in (("browse-transactions-tab", "browse-transactions-panel"),
                                 ("compare-groups-tab", "group-comparison-panel")):
            self.assertEqual(elements[tab_id][1]["role"], "tab")
            self.assertEqual(elements[tab_id][1]["aria-controls"], panel_id)
            self.assertEqual(elements[panel_id][1]["aria-labelledby"], tab_id)
        self.assertIn("hidden", elements["group-comparison-panel"][1])
        self.assertIn("disabled", elements["compare-groups-tab"][1])
        self.assertEqual(elements["comparison-category-table"][1]["tabindex"], "0")
        self.assertEqual(sum(attrs.get("id") == "transaction-form-dialog" for _, attrs in self.page.elements), 1)
        controller = (APP_DIR / "group-comparison.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(", controller)
        self.assertNotIn("innerHTML", controller)
        self.assertIn("onInspect(", controller)

    def test_comparison_colors_are_theme_tokens_and_narrow_tables_scroll_inside_the_card(self) -> None:
        css = (APP_DIR / "group-comparison.css").read_text(encoding="utf-8")
        theme = (APP_DIR / "styles.css").read_text(encoding="utf-8")
        tokens = set(re.findall(r"var\((--[\w-]+)\)", css)) - {"--group-color"}
        for token in tokens:
            self.assertIn(f"{token}:", theme, token)
        self.assertNotRegex(css, r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(")
        self.assertIn("@media (max-width: 650px)", css)
        self.assertIn("overflow-x: auto", css)
        self.assertIn("position: sticky", css)
        self.assertIn("overflow-wrap: anywhere", css)

    def test_every_primary_page_has_the_same_navigation_and_correct_current_page(self) -> None:
        destinations = ["/", "/transactions", "/import", "/classifications", "/settings"]
        for filename, destination in (
            ("index.html", "/"),
            ("transactions.html", "/transactions"),
            ("upload.html", "/import"),
            ("classifications.html", "/classifications"),
            ("settings.html", "/settings"),
        ):
            with self.subTest(page=filename):
                links = PageContract(filename).menu_links
                self.assertEqual([link.get("href") for link in links], destinations)
                current = [link.get("href") for link in links if link.get("aria-current") == "page"]
                self.assertEqual(current, [destination])

    def test_editor_keeps_all_shared_fields_and_tag_picker(self) -> None:
        fields = self.page.form_fields["transaction-form"]
        shared_fields = PageContract("index.html").form_fields["transaction-form"]
        self.assertEqual(set(fields), set(shared_fields))
        self.assertEqual(
            set(fields),
            {"date", "amount", "description", "category", "subcategory", "accountName",
             "accountType", "provider", "notes", "tags", "group", "refunded", "internalTransferTreatment"},
        )
        self.assertEqual(fields["notes"]["tag"], "textarea")
        self.assertEqual(fields["refunded"]["type"], "checkbox")
        self.assertEqual(fields["internalTransferTreatment"]["tag"], "select")
        self.assertEqual(fields["tags"]["type"], "hidden")
        self.assertEqual(
            {name for name, attributes in fields.items() if "required" in attributes},
            {"date", "amount", "description"},
        )
        self.assertEqual(
            sum("data-transaction-tag-picker" in attrs for _, attrs in self.page.elements), 1
        )
        for marker in ("data-tag-controls", "data-new-tag-input", "data-new-tag-button"):
            self.assertTrue(any(marker in attrs for _, attrs in self.page.elements), marker)

    def test_filters_keep_category_subcategory_together_and_default_to_all_time(self) -> None:
        fields = self.page.form_fields["alltime-filter-popover"]
        names = list(fields)
        self.assertEqual(names[names.index("category") + 1], "subcategory")
        self.assertEqual(names[names.index("accountName") + 1], "provider")
        for name in ("startDate", "endDate"):
            self.assertEqual(fields[name]["type"], "date")
            self.assertFalse(fields[name].get("value"))
            self.assertNotIn("required", fields[name])
        self.assertIn("checked", fields["showExcluded"])
        modes = {
            attrs["data-tag-mode"]: attrs.get("aria-pressed")
            for _, attrs in self.page.elements if "data-tag-mode" in attrs
        }
        self.assertEqual(modes, {"any": "true", "all": "false"})


if __name__ == "__main__":
    unittest.main()
