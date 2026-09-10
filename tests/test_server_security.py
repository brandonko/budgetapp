from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from types import SimpleNamespace


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

    def test_allows_same_origin_mutation(self) -> None:
        body = b"{}"
        status, _headers, _response_body = self.request(
            "POST",
            "/api/backups",
            host=self.authority,
            origin=f"http://{self.authority}",
            body=body,
        )
        self.assertEqual(status, 201)

    def test_default_http_origin_port_matches_port_80_only(self) -> None:
        handler = object.__new__(BudgetRequestHandler)
        handler.command = "POST"
        handler.path = "/api/backups"
        handler.server = SimpleNamespace(server_port=80, server_address=("127.0.0.1", 80))
        handler.headers = Message()
        handler.headers["Host"] = "127.0.0.1"
        handler.headers["Origin"] = "http://127.0.0.1"
        handler.validate_request_authority()
        handler.validate_mutation_origin()
        handler.headers.replace_header("Origin", "http://127.0.0.1:80")
        handler.validate_mutation_origin()
        handler.server.server_port = 8000
        handler.headers.replace_header("Host", "127.0.0.1:8000")
        handler.headers.replace_header("Origin", "http://127.0.0.1")
        with self.assertRaises(PermissionError):
            handler.validate_mutation_origin()

    def test_malformed_authorities_and_origins_return_json_errors(self) -> None:
        for host in ("[broken", "[not-an-ip]", "127.0.0.1:bad"):
            with self.subTest(host=host):
                status, _, body = self.request("GET", "/api/transactions", host=host)
                self.assertEqual(status, 421)
                self.assertIn("Host", json.loads(body)["error"])
        for origin in ("http://[broken", "http://[not-an-ip]", "http://127.0.0.1:bad"):
            with self.subTest(origin=origin):
                status, _, body = self.request("POST", "/api/backups", host=self.authority,
                                               origin=origin, body=b"{}")
                self.assertEqual(status, 403)
                self.assertIn("origin", json.loads(body)["error"])
        self.assertFalse((self.csv_path.parent / "backups").exists())

    def test_extension_cannot_create_sessions_commit_or_mutate_saved_data(self) -> None:
        before = self.csv_path.read_bytes()
        origin = "chrome-extension://" + "a" * 32
        token = "b" * 32
        for method, path in (
            ("POST", "/api/backups"),
            ("POST", "/api/transactions"),
            ("PUT", "/api/transactions/0"),
            ("DELETE", "/api/transactions/0"),
            ("PUT", "/api/classifications"),
            ("DELETE", "/api/backups/test.csv"),
            ("POST", "/api/amazon-import-sessions"),
            ("POST", f"/api/amazon-import-sessions/{token}/commit"),
            ("PUT", f"/api/amazon-import-sessions/{token}/progress"),
            ("POST", "/api/amazon-import-sessions/short/progress"),
            ("POST", f"/api/csv-import-sessions/{token}/cancel"),
        ):
            with self.subTest(method=method, path=path):
                status, _, body = self.request(method, path, host=self.authority,
                                               origin=origin, body=b'{"confirm":true}')
                self.assertEqual(status, 403)
                self.assertIn("origin", json.loads(body)["error"])
        self.assertEqual(self.csv_path.read_bytes(), before)
        self.assertEqual(self.server.amazon_import_sessions, {})
        self.assertFalse((self.csv_path.parent / "backups").exists())

    def test_extension_callbacks_still_require_valid_source_scoped_tokens(self) -> None:
        origin = "chrome-extension://" + "a" * 32
        for source in ("amazon", "creditkarma", "aliexpress", "venmo", "applecard", "ebay", "walmart", "capitalone"):
            for action in ("progress", "complete", "cancel"):
                with self.subTest(source=source, action=action):
                    status, _, body = self.request("POST", f'/api/{source}-import-sessions/{"b" * 32}/{action}',
                        host=self.authority, origin=origin, body=b"{}")
                    self.assertEqual(status, 404)
                    self.assertIn("session", json.loads(body)["error"])
        status, _, body = self.request("POST", "/api/amazon-import-sessions", host=self.authority,
            origin=f"http://{self.authority}",
            body=b'{"startDate":"2026-09-01","endDate":"2026-09-02"}')
        self.assertEqual(status, 201)
        token = json.loads(body)["token"]
        before = self.csv_path.read_bytes()
        status, _, _ = self.request("POST", f"/api/amazon-import-sessions/{token}/progress",
            host=self.authority, origin=origin, body=b'{"progress":25}')
        self.assertEqual(status, 200)
        status, _, _ = self.request("POST", f"/api/creditkarma-import-sessions/{token}/progress",
            host=self.authority, origin=origin, body=b"{}")
        self.assertEqual(status, 404)
        status, _, _ = self.request("POST", f"/api/amazon-import-sessions/{token}/commit",
            host=self.authority, origin=origin, body=b"{}")
        self.assertEqual(status, 403)
        status, _, _ = self.request("POST", f"/api/amazon-import-sessions/{token}/cancel",
            host=self.authority, origin=origin, body=b"{}")
        self.assertEqual(status, 200)
        self.assertEqual(self.csv_path.read_bytes(), before)

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
