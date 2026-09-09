"""Exercise the report controller against real synthetic HTTP API responses."""
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

from test_groups_bulk import make_server, row
from server import write_transactions_atomic

ROOT = Path(__file__).resolve().parents[1]


class PeriodComparisonApiTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required for the controller integration")
    def test_real_transfer_review_response_gates_report_until_confirmed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "transactions.csv"
            write_transactions_atomic(path, [
                row(description="Online transfer", category="Transfer", amount=100, accountName="Savings"),
                row(description="Received transfer", category="Transfer", amount=-100, accountName="Checking"),
                row(description="Groceries", category="Food", amount=12),
            ])
            server = make_server(path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def request(route, payload=None):
                req = Request(f"http://127.0.0.1:{server.server_port}{route}",
                              data=json.dumps(payload).encode() if payload is not None else None,
                              headers={"Content-Type": "application/json"})
                with urlopen(req, timeout=5) as response:
                    return json.load(response)
            try:
                before = request("/api/transactions")
                self.assertTrue(before["internalTransferReviewRequired"])
                preview = request("/api/internal-transfers/preview", {})
                request("/api/internal-transfers/confirm", {
                    "confirm": True, "revision": preview["revision"], "plan": preview["plan"], "overrides": [],
                })
                after = request("/api/transactions")
                self.assertFalse(after["internalTransferReviewRequired"])
                script = r'''
const assert = require("node:assert/strict");
const mount = require("./app/period-comparison.js");
const model = require("./app/period-comparison-model.js");
const {documentFor} = require("./tests/period-comparison-dom.js");
const payloads = JSON.parse(require("node:fs").readFileSync(0,"utf8"));
const ids = ["status","setup","review","content","refresh","focus-start","focus-end","baseline-start","baseline-end","focus-caption","baseline-caption","previous","previous-year","swap","validation","results","scope","metrics","category-rows","category-empty","focus-link","baseline-link"];
(async () => {
  for (const [i,payload] of payloads.entries()) {
    const document = documentFor(ids.map(id => "period-" + id));
    const app = mount(document,{model,now:()=>new Date(2026,8,8),storage:{getItem:()=>null,setItem(){}},fetch:async()=>({ok:true,status:200,json:async()=>payload})});
    await app.ready;
    assert.equal(document.getElementById("period-review").hidden,i===1);
    assert.equal(document.getElementById("period-content").hidden,i===0);
    if(i===0) assert.equal(document.getElementById("period-metrics").children.length,0);
    else assert.match(document.getElementById("period-metrics").textContent,/\$12\.00/);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
                result = subprocess.run([shutil.which("node"), "-e", script], cwd=ROOT,
                                        input=json.dumps([before, after]), text=True,
                                        capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
