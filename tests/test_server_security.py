from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
sys.path.insert(0, str(APP_DIR))

from server import (  # noqa: E402
    BudgetRequestHandler,
    ThreadingHTTPServer,
    initialize_csv_if_missing,
    read_transaction_state,
)


class ServerSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temporary_directory.name) / "data" / "transactions.csv"
        initialize_csv_if_missing(self.csv_path)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), BudgetRequestHandler)
        self.server.csv_path = self.csv_path
        self.server.data_lock = threading.Lock()
        self.server.amazon_import_sessions = {}
        self.server.amazon_import_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def request(
        self,
        method: str,
        path: str,
        *,
        host: str,
        origin: str | None = None,
        body: bytes | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=3
        )
        connection.putrequest(method, path, skip_host=True)
        connection.putheader("Host", host)
        if origin is not None:
            connection.putheader("Origin", origin)
        if body is not None:
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(len(body)))
        connection.endheaders(body)
        response = connection.getresponse()
        status = response.status
        headers = {name.casefold(): value for name, value in response.getheaders()}
        response_body = response.read()
        connection.close()
        return status, headers, response_body

    @property
    def authority(self) -> str:
        return f"127.0.0.1:{self.server.server_port}"

    def test_rejects_non_loopback_host_before_returning_financial_data(self) -> None:
        status, headers, body = self.request(
            "GET", "/api/transactions", host="attacker.example"
        )

        self.assertEqual(status, 421)
        self.assertIn("Host must identify", json.loads(body)["error"])
        self.assertEqual(headers["x-content-type-options"], "nosniff")

    def test_rejects_cross_origin_mutation_without_writing(self) -> None:
        before = read_transaction_state(self.csv_path)
        body = b"{}"
        status, _headers, response_body = self.request(
            "POST",
            "/api/backups",
            host=self.authority,
            origin="https://attacker.example",
            body=body,
        )

        self.assertEqual(status, 403)
        self.assertIn("does not match", json.loads(response_body)["error"])
        self.assertEqual(read_transaction_state(self.csv_path), before)
        self.assertFalse((self.csv_path.parent / "backups").exists())

    def test_allows_same_origin_mutation_and_extension_origin(self) -> None:
        body = b"{}"
        status, _headers, _response_body = self.request(
            "POST",
            "/api/backups",
            host=self.authority,
            origin=f"http://{self.authority}",
            body=body,
        )
        self.assertEqual(status, 201)

        status, _headers, response_body = self.request(
            "POST",
            "/api/amazon-import-sessions",
            host=self.authority,
            origin="chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
            body=body,
        )
        self.assertEqual(status, 400)
        self.assertNotIn("origin", json.loads(response_body)["error"].casefold())

    def test_static_and_json_responses_include_security_headers(self) -> None:
        for path in ("/", "/api/transactions"):
            with self.subTest(path=path):
                status, headers, _body = self.request("GET", path, host=self.authority)
                self.assertEqual(status, 200)
                self.assertEqual(headers["x-frame-options"], "DENY")
                self.assertEqual(headers["x-content-type-options"], "nosniff")
                self.assertEqual(headers["referrer-policy"], "no-referrer")
                self.assertIn("frame-ancestors 'none'", headers["content-security-policy"])


if __name__ == "__main__":
    unittest.main()
