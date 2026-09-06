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
    match = re.search(rf"{re.escape(selector)}\s*\{{([^}}]*)\}}", css)
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

    def test_component_callouts_use_theme_tokens_instead_of_light_colors(self) -> None:
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
