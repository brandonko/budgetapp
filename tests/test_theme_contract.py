from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"

THEME_TOKENS = {
    "ink",
    "muted",
    "line",
    "canvas",
    "surface",
    "accent",
    "accent-deep",
    "accent-soft",
    "income",
    "danger",
    "shadow",
    "header",
    "surface-subtle",
    "surface-muted",
    "surface-strong",
    "line-strong",
    "primary",
    "primary-hover",
    "focus-ring",
    "danger-ink",
    "danger-soft",
    "warning-ink",
    "warning-soft",
} | {f"viz-{index}" for index in range(1, 13)}

CONTRAST_PAIRS = (
    ("ink", "canvas"),
    ("ink", "surface"),
    ("muted", "canvas"),
    ("muted", "surface"),
    ("accent", "canvas"),
    ("accent-deep", "surface"),
    ("danger-ink", "danger-soft"),
    ("warning-ink", "warning-soft"),
)


def css_declarations(block: str) -> dict[str, str]:
    return {
        name: value.strip()
        for name, value in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", block)
    }


def exact_rule(css: str, selector: str) -> str:
    match = re.search(rf"^{re.escape(selector)}\s*\{{([^}}]*)\}}", css, re.MULTILINE)
    if match is None:
        raise AssertionError(f"Missing CSS rule for {selector}")
    return match.group(1)


def channel_to_linear(channel: int) -> float:
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def luminance(color: str) -> float:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise AssertionError(f"Contrast token must be a six-digit hex color, got {color!r}")
    red, green, blue = (int(color[index:index + 2], 16) for index in (1, 3, 5))
    return (
        0.2126 * channel_to_linear(red)
        + 0.7152 * channel_to_linear(green)
        + 0.0722 * channel_to_linear(blue)
    )


def contrast_ratio(first: str, second: str) -> float:
    brighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (brighter + 0.05) / (darker + 0.05)


def rgb_distance(first: str, second: str) -> float:
    first_channels = [int(first[index:index + 2], 16) for index in (1, 3, 5)]
    second_channels = [int(second[index:index + 2], 16) for index in (1, 3, 5)]
    return sum(
        (first_channel - second_channel) ** 2
        for first_channel, second_channel in zip(first_channels, second_channels)
    ) ** 0.5


class ThemeContractTests(unittest.TestCase):
    def test_preferences_have_one_canonical_style_and_mobile_breakpoint(self) -> None:
        css = (APP_DIR / "styles.css").read_text(encoding="utf-8")
        for selector in (".settings-preference-row", ".number-abbreviation-control",
                         ".number-abbreviation-control output", ".number-abbreviation-options"):
            self.assertEqual(len(re.findall(rf"^{re.escape(selector)}\s*\{{", css, re.MULTILINE)), 1, selector)
        for selector in (".settings-preference-row", ".number-abbreviation-control"):
            self.assertEqual(len(re.findall(rf"^  {re.escape(selector)}\s*\{{", css, re.MULTILINE)), 1, selector)
        self.assertIn("background: var(--surface-subtle)", exact_rule(css, ".settings-preference-row"))
        self.assertIn("flex-wrap: wrap", exact_rule(css, ".settings-preference-row"))
        self.assertIn("flex: 1 1 240px", exact_rule(css, ".settings-preference-row > div:first-child"))
        self.assertIn("@media (max-width: 560px)", css)

    def test_extension_popup_palettes_have_complete_accessible_text_colors(self) -> None:
        css = (ROOT / "ledger_data_importer_extension/shared/popup.css").read_text(encoding="utf-8")
        palettes = [css_declarations(block) for block in re.findall(r":root\s*\{([^}]*)\}", css)]
        self.assertEqual(len(palettes), 2)
        self.assertEqual(palettes[0].keys(), palettes[1].keys())
        for index, palette in enumerate(palettes):
            for foreground, background in (("text", "canvas"), ("text", "surface"),
                ("muted", "canvas"), ("accent", "canvas"), ("on-accent", "accent"),
                ("on-accent", "accent-hover"), ("warning", "canvas")):
                with self.subTest(palette=index, pair=f"{foreground}/{background}"):
                    self.assertGreaterEqual(contrast_ratio(palette[foreground], palette[background]), 4.5)

    def test_pages_reserve_a_stable_scrollbar_gutter(self) -> None:
        css = (APP_DIR / "styles.css").read_text(encoding="utf-8")
        self.assertIn("scrollbar-gutter: stable", css)

    def setUp(self) -> None:
        self.css = (APP_DIR / "styles.css").read_text(encoding="utf-8")
        self.theme_javascript = (APP_DIR / "theme.js").read_text(encoding="utf-8")

    def themes(self) -> dict[str, dict[str, str]]:
        themes = {"light": css_declarations(exact_rule(self.css, ":root"))}
        for match in re.finditer(
            r'^html\[data-theme="([^"]+)"\]\s*\{([^}]*)\}',
            self.css,
            flags=re.MULTILINE,
        ):
            themes[match.group(1)] = css_declarations(match.group(2))
        return themes

    def test_every_theme_defines_the_complete_palette(self) -> None:
        themes = self.themes()
        self.assertIn("light", themes)
        self.assertIn("dark", themes)
        for name, declarations in themes.items():
            with self.subTest(theme=name):
                self.assertEqual(THEME_TOKENS - declarations.keys(), set())
                selector = ":root" if name == "light" else f'html[data-theme="{name}"]'
                rule = exact_rule(self.css, selector)
                native_scheme = re.search(r"color-scheme\s*:\s*(light|dark)", rule)
                self.assertIsNotNone(native_scheme, f"{name} must choose a native light/dark scheme")

    def test_every_theme_meets_core_text_contrast(self) -> None:
        for name, declarations in self.themes().items():
            for foreground, background in CONTRAST_PAIRS:
                with self.subTest(theme=name, pair=f"{foreground}/{background}"):
                    ratio = contrast_ratio(declarations[foreground], declarations[background])
                    self.assertGreaterEqual(
                        ratio,
                        4.5,
                        f"{name} {foreground} on {background} has only {ratio:.2f}:1 contrast",
                    )

    def test_visualization_palette_prioritizes_distinct_accessible_colors(self) -> None:
        for name, declarations in self.themes().items():
            palette = [declarations[f"viz-{index}"] for index in range(1, 13)]
            with self.subTest(theme=name, check="unique"):
                self.assertEqual(len(set(palette)), len(palette))
            for index, color in enumerate(palette, start=1):
                with self.subTest(theme=name, color=index, check="surface contrast"):
                    self.assertGreaterEqual(contrast_ratio(color, declarations["surface"]), 3.0)
            for first_index in range(4):
                for second_index in range(first_index + 1, 4):
                    with self.subTest(
                        theme=name,
                        pair=f"viz-{first_index + 1}/viz-{second_index + 1}",
                        check="primary distinction",
                    ):
                        self.assertGreaterEqual(
                            rgb_distance(palette[first_index], palette[second_index]),
                            90,
                        )

    def test_system_preference_cannot_override_an_explicit_theme(self) -> None:
        self.assertNotIn("@media (prefers-color-scheme: dark)", self.css)
        saved_preference = 'if (stored === "dark" || stored === "light") return stored;'
        system_preference = 'globalObject.matchMedia?.("(prefers-color-scheme: dark)").matches'
        self.assertIn(saved_preference, self.theme_javascript)
        self.assertIn(system_preference, self.theme_javascript)
        self.assertLess(
            self.theme_javascript.index(saved_preference),
            self.theme_javascript.index(system_preference),
        )
        self.assertIn("root.dataset.theme = normalized", self.theme_javascript)

    def test_shared_transaction_dividers_use_the_active_theme(self) -> None:
        # These rows appear in imports, dashboard, history, and classification
        # dialogs. A light-only divider looked like a stray rule between cards.
        for selector in (".transaction-row", ".classification-preview-row"):
            with self.subTest(selector=selector):
                row = exact_rule(self.css, selector)
                self.assertIn("border-bottom: 1px solid var(--line)", row)
                self.assertNotRegex(row, r"border[^:;{}]*\s*:[^;{}]*#[0-9a-fA-F]{3,8}")
        for name, declarations in self.themes().items():
            with self.subTest(theme=name):
                self.assertIn("line", declarations)
                self.assertLess(contrast_ratio(declarations["line"], declarations["surface"]), 3,
                                "Decorative dividers must not compete with transaction text")

    def test_component_callouts_use_theme_tokens_instead_of_light_colors(self) -> None:
        for selector in (".transaction-linked-details", ".transaction-link-editor"):
            panel = exact_rule(self.css, selector)
            self.assertIn("background: var(--surface-subtle)", panel)
            self.assertIn("border: 1px solid var(--line)", panel)
            self.assertIn("grid-column: 1 / -1", panel)
            self.assertNotRegex(panel, r"#[0-9a-fA-F]{3,8}")
        refund_callout = exact_rule(self.css, ".import-refund-details")
        self.assertIn("color: var(--ink)", refund_callout)
        self.assertIn("background: var(--surface-subtle)", refund_callout)
        self.assertIn("border: 1px solid var(--line)", refund_callout)
        self.assertNotRegex(refund_callout, r"#[0-9a-fA-F]{3,8}")
        for name, declarations in self.themes().items():
            for foreground in ("ink", "muted"):
                with self.subTest(theme=name, component="refund match", foreground=foreground):
                    self.assertGreaterEqual(contrast_ratio(declarations[foreground], declarations["surface-subtle"]), 4.5)
        edited_badge = exact_rule(self.css, ".transaction-description .transaction-edited-badge")
        self.assertIn("color: var(--accent)", edited_badge)
        self.assertIn("background: var(--accent-soft)", edited_badge)
        for name, declarations in self.themes().items():
            with self.subTest(theme=name, component="edited badge"):
                self.assertGreaterEqual(contrast_ratio(declarations["accent"], declarations["accent-soft"]), 4.5)
        code_block = exact_rule(self.css, ".classification-guide-code pre")
        self.assertIn("color: var(--ink)", code_block)
        self.assertIn("background: var(--surface-muted)", code_block)
        self.assertIn("border: 1px solid var(--line)", code_block)

        credit_karma_notice = exact_rule(
            self.css, ".amazon-direct-copy > .creditkarma-account-warning"
        )
        self.assertIn("color: var(--warning-ink)", credit_karma_notice)
        self.assertIn("background: var(--warning-soft)", credit_karma_notice)
        self.assertNotRegex(credit_karma_notice, r"#[0-9a-fA-F]{3,8}")

    def test_nested_purchase_cards_and_year_dates_do_not_inherit_outer_text_styles(self) -> None:
        nested = exact_rule(self.css, ":is(.import-refund-purchases, .transaction-linked-details) > .transaction-row,\n"
            "#import-review-list :is(.import-refund-purchases, .transaction-linked-details) > .transaction-row")
        for declaration in ("grid-template-columns: 48px minmax(0, 1fr) auto", "gap: 12px",
                            "padding: 12px", "border-width: 1px", "border-style: solid", "border-radius: 9px"):
            self.assertIn(declaration, nested)
        colors = exact_rule(self.css, ":where(.import-refund-purchases, .transaction-linked-details) > .transaction-row")
        self.assertIn("background: var(--surface)", colors)
        self.assertIn("border-color: var(--line-strong)", colors)
        date = exact_rule(self.css, ".transaction-date.transaction-date--with-year")
        self.assertIn("width: 100%", date, "The year date must fit its grid track")
        self.assertIn("height: 64px", date)
        self.assertIn("row-gap: 2px", date)
        self.assertIn("font-size: 9px", exact_rule(self.css, ".transaction-date > .transaction-date-year"))
        self.assertNotIn(".transaction-description strong", self.css)
        self.assertNotIn(".transaction-description span", self.css)
        self.assertIn(".transaction-description > strong", self.css)
        self.assertIn("grid-column: 3 / -1", exact_rule(self.css, ".import-refund-match"))
        self.assertIn(".import-refund-match { grid-column: 1 / -1; }", self.css)

    def test_follow_up_highlights_are_theme_aware_and_override_review_colors(self) -> None:
        selector = 'html[data-theme] #import-review-list .transaction-row.transaction-row--flagged'
        rule = exact_rule(self.css, selector)
        self.assertIn('background: var(--danger-soft)', rule)
        self.assertIn('color: var(--ink)', rule)
        self.assertGreater(self.css.index(selector), self.css.index(
            'html[data-theme="dark"] #import-review-list .transaction-row--needs-classification'))
        self.assertIn("color: var(--danger-ink)", exact_rule(self.css,
            ".transaction-row--flagged > .transaction-description > .transaction-note"))
        self.assertIn("color: var(--muted)", exact_rule(self.css,
            ".transaction-description .transaction-note"))
        for name, tokens in self.themes().items():
            for foreground in ("ink", "danger-ink"):
                with self.subTest(theme=name, foreground=foreground):
                    self.assertGreaterEqual(contrast_ratio(tokens[foreground], tokens["danger-soft"]), 4.5)

    def test_all_transaction_rows_share_complete_card_geometry(self) -> None:
        # Plain and edited rows must stay cards too: state toggles only recolor
        # them, with the same four edges and spacing even on the final row.
        selectors = (
            ".transaction-list > .transaction-row",
            ".classification-preview-list > .transaction-row",
            ".classification-preview-list > .classification-preview-row",
            ".bulk-delete-list > .transaction-row",
        )
        shared_selector = ",\n".join(selectors)
        geometry = exact_rule(self.css, shared_selector)
        for declaration in ("margin: 6px -14px", "padding: 14px",
                            "border-width: 1px", "border-style: solid", "border-radius: 10px",
                            "border-color: var(--line)", "background: var(--surface-subtle)"):
            self.assertIn(declaration, geometry)
        for theme, tokens in self.themes().items():
            for foreground in ("ink", "muted"):
                with self.subTest(theme=theme, card_text=foreground):
                    self.assertGreaterEqual(contrast_ratio(tokens[foreground], tokens["surface-subtle"]), 4.5)
        # Every card, including the last nested purchase, keeps matching edges.
        # A last-child border reset also resets its color to currentColor.
        self.assertNotIn(".transaction-row:last-child", self.css)
        self.assertNotIn(".classification-preview-row:last-child", self.css)
        self.assertNotIn(".bulk-delete-list .transaction-row:last-child",
            (APP_DIR / "transaction-tools.css").read_text(encoding="utf-8"))
        for selector in (
            "#import-review-list .transaction-row--duplicate",
            "#import-review-list .transaction-row--needs-classification:not(.transaction-row--duplicate)",
            "html[data-theme] #import-review-list .transaction-row.transaction-row--flagged",
        ):
            with self.subTest(selector=selector):
                self.assertNotRegex(exact_rule(self.css, selector),
                    r"(?:^|;)\s*(?:margin|padding|border|border-radius|border-width|border-style)\s*:",
                    "State colors must not override the shared highlight geometry")

    def test_transaction_lists_have_a_definite_viewport_sized_height(self) -> None:
        # A max-height alone leaves flex rows at their 160px basis: only two
        # transactions visible even on a tall display. Check the height chain.
        dialog = exact_rule(self.css, ".transaction-dialog")
        self.assertRegex(dialog, r"(?m)^\s*height: min\(88dvh, 960px\)")
        self.assertIn("max-height: calc(100dvh - 28px)", dialog)
        shell = exact_rule(self.css, ".dialog-shell")
        self.assertRegex(shell, r"(?:^|;)\s*height: 100%")
        self.assertIn("max-height: 100%", shell)
        self.assertNotIn(".transaction-dialog:has(.transaction-filter-panel", self.css,
            "Opening Filters must not resize the modal")
        self.assertNotIn("88dvh", exact_rule(self.css, ".transaction-form-dialog"))

    def test_filters_stay_in_their_own_region_while_transaction_lists_scroll(self) -> None:
        panel = exact_rule(self.css, ".transaction-filter-panel")
        self.assertIn("width: 100%", panel)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr))", panel)
        self.assertNotRegex(panel, r"(?:position|max-height|overflow)[^:;{}]*\s*:")
        body = exact_rule(self.css, ".transaction-dialog-body")
        self.assertIn("min-height: 0", body)
        self.assertIn("display: flex", body)
        self.assertIn("overflow: hidden", body)
        controls = exact_rule(self.css, ".transaction-dialog-controls")
        self.assertIn("overflow-y: auto", controls)
        self.assertIn("min-height: 0", controls)
        rows = exact_rule(self.css, ".transaction-dialog-body > .classification-preview-list")
        self.assertIn("overflow-y: auto", rows)
        self.assertIn("min-height: min(140px, 18vh)", rows)
        shared = (APP_DIR / "transaction-ui.js").read_text(encoding="utf-8")
        self.assertNotIn("fitTransactionFilterPopover", shared)
        self.assertNotIn(".transaction-amount.is-credit", self.css)
        self.assertIn("role=\"switch\"", (APP_DIR / "upload.html").read_text(encoding="utf-8"))

    def test_every_page_bootstraps_the_same_theme_before_styles(self) -> None:
        theme_sources = set()
        stylesheet_sources = set()
        for page in ("index.html", "transactions.html", "upload.html", "classifications.html", "settings.html"):
            html = (APP_DIR / page).read_text(encoding="utf-8")
            theme_match = re.search(r'<script src="(/theme\.js\?v=[^"]+)"></script>', html)
            stylesheet_match = re.search(r'<link rel="stylesheet" href="(/styles\.css\?v=[^"]+)"', html)
            self.assertIsNotNone(theme_match, page)
            self.assertIsNotNone(stylesheet_match, page)
            theme_sources.add(theme_match.group(1))
            stylesheet_sources.add(stylesheet_match.group(1))
            self.assertLess(theme_match.start(), stylesheet_match.start(), page)
        self.assertEqual(len(theme_sources), 1, "Every page must load the same theme bootstrap version")
        self.assertEqual(len(stylesheet_sources), 1, "Every page must load the same stylesheet version")

    def test_all_time_dashboard_uses_shared_theme_tokens(self) -> None:
        css = (APP_DIR / "transactions.css").read_text(encoding="utf-8")
        references = set(re.findall(r"var\(--([\w-]+)\)", css))
        self.assertTrue(references)
        for theme, declarations in self.themes().items():
            with self.subTest(theme=theme):
                self.assertFalse(references - declarations.keys())
        # The page must inherit the selected theme, not introduce its own palette.
        self.assertNotRegex(css, r"(?i)(?:color|background|border[^:;{}]*)\s*:[^;{}]*(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()")
        self.assertNotIn("prefers-color-scheme", css)
        self.assertNotIn("--ink:", css)


if __name__ == "__main__":
    unittest.main()
