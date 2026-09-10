const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "../ledger_data_importer_extension");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const settle = () => new Promise(setImmediate);

async function setup({ saved = {}, active = "https://www.amazon.com/gp/your-account/order-history",
  permission = true, failGet = false, failSet = false, failOpen = false, failOptions = false,
  failQuery = false, create } = {}) {
  const data = { ...saved }, opened = [], reads = [], writes = [];
  let optionsOpened = 0;
  const permissions = { granted: permission };
  function element(id = "") {
    return { children: [], handlers: {}, value: "", textContent: "", hidden: id === "status",
      disabled: ["ledger-server", "open-ledger"].includes(id),
      addEventListener(event, handler) { this.handlers[event] = handler; },
      append(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
  }
  const elements = Object.fromEntries(["open-ledger-form", "ledger-server", "open-ledger",
    "connection-settings", "status", "version"].map((id) => [id, element(id)]));
  const context = vm.createContext({ URL,
    document: { getElementById: (id) => elements[id], createElement: () => element() },
    chrome: {
      runtime: { getManifest: () => JSON.parse(read("manifest.json")),
        openOptionsPage: async () => { if (failOptions) throw new Error(); optionsOpened++; } },
      storage: { local: {
        get: async (keys) => {
          reads.push(keys);
          if (failGet) throw new Error("Storage unavailable");
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]));
        },
        set: async (values) => {
          if (failSet) throw new Error("Storage unavailable");
          writes.push(values); Object.assign(data, values);
        },
      } },
      permissions: { contains: async () => permissions.granted },
      tabs: {
        query: async (options) => {
          assert.equal(options.active, true); assert.equal(options.currentWindow, true);
          if (failQuery) throw new Error("Tab unavailable");
          return active ? [{ url: active }] : [];
        },
        create: async (options) => {
          if (failOpen) throw new Error("Could not open tab");
          if (create) await create();
          opened.push(options.url);
        },
      },
    },
  });
  vm.runInContext(read("shared/trusted_origins.js"), context);
  vm.runInContext(read("shared/popup.js"), context);
  await settle();
  return { elements, data, permissions, opened, reads, writes,
    origins: () => elements["ledger-server"].children.map((option) => option.value),
    submit: () => elements["open-ledger-form"].handlers.submit({ preventDefault() {} }),
    settings: () => elements["connection-settings"].handlers.click(),
    optionsOpened: () => optionsOpened };
}

test("popup opens only Ledger import, not a scraper, and keeps navigation read-only until clicked", async () => {
  const env = await setup();
  assert.deepEqual(env.origins(), ["http://127.0.0.1:8000"]);
  assert.equal(env.elements["open-ledger"].disabled, false);
  assert.deepEqual(env.opened, []);
  assert.deepEqual(env.writes, []);
  assert.equal(env.elements.version.textContent, `v${JSON.parse(read("manifest.json")).version}`);
  await env.submit();
  assert.deepEqual(env.opened, ["http://127.0.0.1:8000/import"]);
  assert.equal(env.data.ledgerPopupOrigin, "http://127.0.0.1:8000");
  assert.deepEqual(env.reads.flat().filter((key) => !["ledgerTrustedOrigins", "ledgerPopupOrigin"].includes(key)), []);
  assert.deepEqual(Object.keys(env.writes[0]), ["ledgerPopupOrigin"]);
  await env.settings();
  assert.equal(env.optionsOpened(), 1);
});

test("current trusted Ledger page wins; saved servers stay unique and reopening remembers selection", async () => {
  const remote = "https://ledger.example";
  const env = await setup({ active: "http://localhost:8765/import?private=not-stored#fragment",
    saved: { ledgerTrustedOrigins: [remote, remote], ledgerPopupOrigin: remote } });
  assert.equal(env.elements["ledger-server"].value, "http://localhost:8765");
  assert.equal(env.origins().filter((value) => value === remote).length, 1);
  await env.submit();
  assert.equal(env.data.ledgerPopupOrigin, "http://localhost:8765");
  assert.equal(env.opened[0], "http://localhost:8765/import");
  env.elements["ledger-server"].value = remote;
  await env.submit();
  assert.equal(env.opened[1], remote + "/import");
  const reopened = await setup({ saved: env.data });
  assert.equal(reopened.elements["ledger-server"].value, remote);
});

test("valid saved trusted server is selected before the local fallback", async () => {
  const origin = "http://192.168.1.142:8000";
  const env = await setup({ saved: { ledgerTrustedOrigins: [origin] } });
  assert.equal(env.elements["ledger-server"].value, origin);
});

test("untrusted pages, unsafe saved URLs and removed host permissions cannot become a destination", async () => {
  const unsafe = ["https://evil.example", "javascript:alert(1)", "file:///private.csv",
    "http://user:pass@localhost:8000", "http://localhost:8000/import", "http://localhost:8000/?token=secret"];
  for (const candidate of unsafe) {
    const env = await setup({ active: "https://untrusted.example/import", saved: { ledgerPopupOrigin: candidate } });
    assert.deepEqual(env.origins(), ["http://127.0.0.1:8000"], candidate);
  }
  for (const active of unsafe.slice(0, 4)) {
    assert.deepEqual((await setup({ active })).origins(), ["http://127.0.0.1:8000"]);
  }
  const env = await setup({ permission: false, active: "https://ledger.example/import",
    saved: { ledgerTrustedOrigins: ["https://ledger.example", ...unsafe.slice(1)], ledgerPopupOrigin: "https://ledger.example" } });
  assert.deepEqual(env.origins(), ["http://127.0.0.1:8000"]);
  env.elements["ledger-server"].value = "https://evil.example";
  await env.submit();
  assert.deepEqual(env.opened, []);
  assert.match(env.elements.status.textContent, /no longer trusted/);
});

test("trust and host permission are rechecked when Open is pressed", async () => {
  for (const revoke of ["trust", "permission"]) {
    const origin = "https://ledger.example";
    const env = await setup({ saved: { ledgerTrustedOrigins: [origin] } });
    if (revoke === "trust") env.data.ledgerTrustedOrigins = [];
    else env.permissions.granted = false;
    await env.submit();
    assert.deepEqual(env.opened, []);
    assert.deepEqual(env.writes, []);
    assert.equal(env.elements.status.hidden, false);
  }
});

test("unavailable tabs and malformed preferences fall back safely", async () => {
  const env = await setup({ failQuery: true, saved: { ledgerTrustedOrigins: { broken: true }, ledgerPopupOrigin: 42 } });
  assert.deepEqual(env.origins(), ["http://127.0.0.1:8000"]);
  assert.equal(env.elements["open-ledger"].disabled, false);
});

test("failures have useful messages; settings remain available when server loading fails", async () => {
  const storage = await setup({ failGet: true });
  assert.match(storage.elements.status.textContent, /Could not load/);
  assert.equal(storage.elements["open-ledger"].disabled, true);
  await storage.settings();
  assert.equal(storage.optionsOpened(), 1);
  const tabs = await setup({ failOpen: true });
  await tabs.submit();
  assert.match(tabs.elements.status.textContent, /Could not open tab/);
  assert.equal(tabs.elements["open-ledger"].disabled, false);
  const options = await setup({ failOptions: true });
  await options.settings();
  assert.match(options.elements.status.textContent, /Extension options/);
  const preference = await setup({ failSet: true });
  await preference.submit();
  assert.equal(preference.opened.length, 1);
  assert.equal(preference.elements.status.hidden, true);
});

test("repeated submissions while opening do not create duplicate tabs", async () => {
  let finish;
  const env = await setup({ create: () => new Promise((resolve) => { finish = resolve; }) });
  const first = env.submit();
  await settle();
  await env.submit();
  finish();
  await first;
  assert.equal(env.opened.length, 1);
});
