import json
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = REPOSITORY_ROOT / "ledger_data_importer_extension"


class ExtensionStructureTests(unittest.TestCase):
    def test_manifest_references_existing_source_modules(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))

        referenced_scripts = {
            script
            for registration in manifest["content_scripts"]
            for script in registration.get("js", [])
        }
        referenced_scripts.add(manifest["background"]["service_worker"])
        referenced_scripts.add(manifest["action"]["default_popup"])
        referenced_scripts.update(manifest["icons"].values())
        referenced_scripts.update(manifest["action"]["default_icon"].values())

        for relative_path in referenced_scripts:
            with self.subTest(relative_path=relative_path):
                self.assertTrue((EXTENSION_ROOT / relative_path).is_file())

    def test_source_modules_have_explicit_ownership(self) -> None:
        self.assertTrue((EXTENSION_ROOT / "amazon_extension" / "content.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "amazon_extension" / "popup" / "popup.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "creditkarma_extension" / "content.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "aliexpress_extension" / "importer.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "venmo_extension" / "content.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "apple_card_extension" / "content.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "ebay_extension" / "content.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "shared" / "ledger_bridge.js").is_file())
        self.assertTrue((EXTENSION_ROOT / "shared" / "import_coordinator.js").is_file())

        for obsolete_directory in ("background", "bridge", "content", "creditkarma", "popup"):
            with self.subTest(obsolete_directory=obsolete_directory):
                self.assertFalse((EXTENSION_ROOT / obsolete_directory).exists())

    def test_aliexpress_permissions_and_attribution_are_present(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("cookies", manifest["permissions"])
        self.assertIn("*://*.aliexpress.com/*", manifest["host_permissions"])
        self.assertTrue((EXTENSION_ROOT / "aliexpress_extension" / "LICENSE").is_file())
        coordinator = (EXTENSION_ROOT / "shared" / "import_coordinator.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('../aliexpress_extension/importer.js', coordinator)
        signer = (EXTENSION_ROOT / "aliexpress_extension" / "importer.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("d41d8cd98f00b204e9800998ecf8427e", signer)
        self.assertIn("5d41402abc4b2a76b9719d911017c592", signer)

    def test_venmo_permissions_are_scoped_to_the_account_site(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("https://account.venmo.com/*", manifest["host_permissions"])
        self.assertNotIn("*://*.venmo.com/*", manifest["host_permissions"])

    def test_apple_card_uses_only_the_card_site(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("https://card.apple.com/*", manifest["host_permissions"])
        self.assertNotIn("*://*.apple.com/*", manifest["host_permissions"])
        self.assertEqual(manifest["version"], "0.7.0")
        bridge = (EXTENSION_ROOT / "shared" / "ledger_bridge.js").read_text(
            encoding="utf-8"
        )
        coordinator = (EXTENSION_ROOT / "shared" / "import_coordinator.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("ledgerStartAppleCardImport", bridge)
        self.assertIn("installAppleCardCaptureHook", coordinator)
        apple_content = (
            EXTENSION_ROOT / "apple_card_extension" / "content.js"
        ).read_text(encoding="utf-8")
        self.assertIn("findExportDateButton", apple_content)
        self.assertIn("startsWith(normalizedLabel)", apple_content)
        self.assertIn('findExportDateButton("start date:")', apple_content)
        self.assertIn('findExportDateButton("end date:")', apple_content)
        self.assertIn("Visible export controls", apple_content)
        self.assertIn('"Previous month"', apple_content)
        self.assertIn('"Next month"', apple_content)

    def test_local_bridge_supports_the_canonical_import_route(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
        bridge_registration = next(
            registration
            for registration in manifest["content_scripts"]
            if "shared/ledger_bridge.js" in registration.get("js", [])
        )
        self.assertIn("http://127.0.0.1/import*", bridge_registration["matches"])
        self.assertIn("http://localhost/import*", bridge_registration["matches"])
        coordinator = (EXTENSION_ROOT / "shared" / "import_coordinator.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('"/import"', coordinator)

    def test_ebay_import_is_scoped_and_connected(self) -> None:
        manifest = json.loads((EXTENSION_ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertIn("*://*.ebay.com/*", manifest["host_permissions"])
        bridge = (EXTENSION_ROOT / "shared" / "ledger_bridge.js").read_text(encoding="utf-8")
        coordinator = (EXTENSION_ROOT / "shared" / "import_coordinator.js").read_text(encoding="utf-8")
        content = (EXTENSION_ROOT / "ebay_extension" / "content.js").read_text(encoding="utf-8")
        self.assertIn("ledgerStartEbayImport", bridge)
        self.assertIn("ledgerCaptureEbay", coordinator)
        self.assertIn("/mye/myebay/ajax/v2/purchase/mp/get", content)


if __name__ == "__main__":
    unittest.main()
