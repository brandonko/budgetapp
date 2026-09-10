from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import urlopen

from test_transactions_page import APP_DIR, BudgetRequestHandler, PageContract, ThreadingHTTPServer


class CoverageRouteTests(unittest.TestCase):
    def test_report_and_assets_are_read_only_even_before_initialization(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "data" / "transactions.csv"
            server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
            server.csv_path = database
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                resources = ["/coverage"] + [
                    attrs.get("src") if tag == "script" else attrs.get("href")
                    for tag, attrs in PageContract("coverage.html").elements
                    if tag == "script" or (tag == "link" and attrs.get("rel") == "stylesheet")
                ]
                for resource in resources:
                    with self.subTest(resource=resource):
                        with urlopen(f"http://127.0.0.1:{server.server_port}{resource}", timeout=3) as response:
                            self.assertEqual(response.status, 200)
                            self.assertTrue(response.read())
                self.assertFalse(database.parent.exists())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
