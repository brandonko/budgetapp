const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "../ledger_data_importer_extension");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

async function connectionsFixture({ origins, permission = true, tabs = [] } = {}) {
  const data = origins ? { ledgerTrustedOrigins: origins } : {};
  const registered = [], requests = [], injected = [], warnings = [];
  const access = { granted: permission, failRegistration: false };
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); },
    emit(...args) { this.listeners.forEach(fn => fn(...args)); } });
  const events = { installed: event(), startup: event(), added: event(), removed: event(), changed: event(), message: event() };
  function element() { return { children: [], handlers: {}, value: "", disabled: false,
    addEventListener(event, handler) { this.handlers[event] = handler; },
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } }; }
  const elements = Object.fromEntries(["status", "server-form", "server-address", "servers"].map((id) => [id, element()]));
  const button = element();
  elements["server-form"].querySelector = () => button;
  const optionSender = { id: "test-extension", url: "chrome-extension://test-extension/shared/options.html" };
  const send = (message, sender = optionSender) => new Promise((resolve, reject) => {
    const held = events.message.listeners.some(listener => listener(message, sender, resolve) === true);
    if (!held) resolve(undefined);
  });
  const chrome = {
    runtime: { id: optionSender.id, getURL: path => `chrome-extension://test-extension/${path}`,
      onInstalled: events.installed, onStartup: events.startup, onMessage: events.message, sendMessage: send },
    storage: { onChanged: events.changed,
      local: { get: async () => data, set: async (value) => {
        Object.assign(data, value); events.changed.emit(value, "local");
      } } },
    permissions: { onAdded: events.added, onRemoved: events.removed,
      contains: async () => access.granted,
      request: async (value) => { requests.push(value); return access.granted; } },
    scripting: { getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (scripts) => {
        if (access.failRegistration) throw new Error("Registration unavailable");
        registered.push(...scripts);
      },
      updateContentScripts: async (scripts) => registered.splice(0, registered.length, ...scripts),
      unregisterContentScripts: async () => { registered.length = 0; },
      executeScript: async (script) => { injected.push(script); } },
    tabs: { query: async () => tabs },
  };
  const env = vm.createContext({ URL, console: { warn: text => warnings.push(text) }, chrome,
    document: { getElementById: (id) => elements[id], createElement: element } });
  vm.runInContext(read("shared/trusted_origins.js"), env);
  vm.runInContext(read("shared/trusted_servers.js"), env);
  vm.runInContext(read("shared/options.js"), env);
  await new Promise(setImmediate);
  return { data, registered, requests, injected, access, events, elements, send, warnings,
    repair: () => send({ action: "ledgerRepairConnections" }),
    settle: () => new Promise(setImmediate),
    click: (label) => elements.servers.children[0].children.find(child => child.textContent === label).handlers.click(),
    submit: () => elements["server-form"].handlers.submit({ preventDefault() {} }) };
}

test("settings request only the chosen host, register import pages, and remove trust", async () => {
  const { data, registered, requests, access, elements, submit, click } = await connectionsFixture({ permission: false });
  elements["server-address"].value = "http://192.168.1.142:8000";
  await submit();
  assert.equal(data.ledgerTrustedOrigins, undefined, "denied permission must not save trust");
  access.granted = true;
  await submit();
  assert.deepEqual(Array.from(data.ledgerTrustedOrigins), ["http://192.168.1.142:8000"]);
  assert.deepEqual(Array.from(requests.at(-1).origins), ["http://192.168.1.142/*"]);
  assert.deepEqual(Array.from(registered[0].matches), ["http://192.168.1.142/import*", "http://192.168.1.142/upload*"]);
  await submit();
  assert.equal(registered.length, 1, "saving twice updates registration");
  await click("Remove");
  assert.equal(data.ledgerTrustedOrigins.length, 0);
  assert.equal(registered.length, 0);
});

test("saved network trust restores missing scripts on startup and extension reload", async () => {
  const origin = "http://192.168.1.142:8000";
  const env = await connectionsFixture({ origins: [origin, origin] });
  assert.equal(env.registered.length, 1, "saved trust must reconnect without resubmitting settings");
  assert.equal(env.registered[0].persistAcrossSessions, true);
  assert.equal(env.registered[0].world, "ISOLATED");
  assert.equal(env.registered[0].allFrames, false);
  for (const event of [env.events.installed, env.events.startup]) {
    env.registered.length = 0;
    event.emit(); await env.settle();
    assert.equal(env.registered.length, 1);
  }
  assert.deepEqual(env.requests, [], "background recovery never requests new permissions");
  assert.match(read("shared/import_coordinator.js"), /import "\.\/trusted_servers\.js"/);
});

test("reconnect injects only exact trusted origins and import routes in the top frame", async () => {
  const origin = "http://192.168.1.142:8000";
  const urls = [origin + "/import", origin + "/upload.html", origin.replace(":8000", ":8001") + "/import",
    origin + "/", origin + "/import-unrelated", "http://192.168.1.143:8000/import", "https://www.amazon.com/import"];
  const env = await connectionsFixture({ origins: [origin], tabs: urls.map((url, id) => ({ id, url })) });
  assert.deepEqual(env.injected.map(script => script.target.tabId), [0, 1]);
  for (const script of env.injected) {
    assert.deepEqual(Array.from(script.target.frameIds), [0]);
    assert.deepEqual(Array.from(script.files), ["shared/ledger_bridge.js"]);
    assert.equal(script.world, "ISOLATED");
  }
  env.injected.length = 0;
  await env.click("Reconnect");
  assert.deepEqual(env.injected.map(script => script.target.tabId), [0, 1]);
  assert.equal(env.data.ledgerTrustedOrigins.length, 1);
  assert.equal(env.elements["server-address"].value, "", "reconnect needs no address re-entry");
  assert.match(env.elements.status.textContent, /Connection repaired/);
});

test("revoked permissions remove scripts without deleting trust; regrant repairs them", async () => {
  const env = await connectionsFixture({ origins: ["https://ledger.example"] });
  env.access.granted = false; env.events.removed.emit(); await env.settle();
  assert.equal(env.registered.length, 0);
  assert.equal(env.data.ledgerTrustedOrigins.length, 1);
  env.access.granted = true; env.events.added.emit(); await env.settle();
  assert.equal(env.registered.length, 1);
  env.data.ledgerTrustedOrigins = []; env.events.changed.emit({ ledgerTrustedOrigins: {} }, "local");
  await env.settle(); assert.equal(env.registered.length, 0);
});

test("connection repair rejects web-page callers and reports registration failures", async () => {
  const env = await connectionsFixture({ origins: ["https://ledger.example"] });
  for (const sender of [{ id: "test-extension", url: "https://ledger.example/import" },
    { id: "other-extension", url: "chrome-extension://test-extension/shared/options.html" }]) {
    assert.equal((await env.send({ action: "ledgerRepairConnections" }, sender)).success, false);
  }
  env.registered.length = 0; env.access.failRegistration = true;
  await env.click("Reconnect");
  assert.match(env.elements.status.textContent, /Connection setup failed/);
  assert.equal(env.elements.servers.children[0].children.find(child => child.textContent === "Reconnect").disabled, false);
  env.access.failRegistration = false;
  await env.click("Reconnect"); assert.equal(env.registered.length, 1);
});

test("saved servers lacking permission show a specific repair action", async () => {
  const env = await connectionsFixture({ origins: ["https://ledger.example"], permission: false });
  assert.equal(env.registered.length, 0);
  assert.ok(env.elements.servers.children[0].children.some(child => child.textContent === "Site access needed"));
  await env.click("Allow site access");
  assert.match(env.elements.status.textContent, /Site access was not granted/);
  env.access.granted = true;
  await env.click("Allow site access");
  assert.equal(env.registered.length, 1);
});

function setup(origins = [], permission = true) {
  const context = vm.createContext({ URL, chrome: {
    storage: { local: { get: async () => ({ ledgerTrustedOrigins: origins }) } },
    permissions: { contains: async () => permission },
  } });
  vm.runInContext(read("shared/trusted_origins.js"), context);
  const coordinator = read("shared/import_coordinator.js");
  vm.runInContext('const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/; const DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;'
    + coordinator.slice(coordinator.indexOf("async function validateRequest("), coordinator.indexOf("// Amazon import coordination")), context);
  return context;
}

test("localhost works automatically; network origins require exact trust and permission", async () => {
  const env = setup(["http://192.168.1.142:8000", "https://ledger.example"]);
  for (const origin of ["http://localhost:8000", "http://127.0.0.1:9000", "http://192.168.1.142:8000", "https://ledger.example"]) {
    assert.equal(await env.LedgerOrigins.allowed(origin), true, origin);
  }
  for (const origin of ["http://192.168.1.142:8001", "https://192.168.1.142:8000", "http://ledger.example", "http://localhost.evil", "file:///tmp", "http://192.168.1.143:8000"]) {
    assert.equal(await env.LedgerOrigins.allowed(origin), false, origin);
  }
  assert.equal(await setup(["https://ledger.example"], false).LedgerOrigins.allowed("https://ledger.example"), false);
});

test("settings reject credentials, paths, queries and non-web URLs", () => {
  const { LedgerOrigins } = setup();
  assert.equal(LedgerOrigins.normalize("http://192.168.1.142:8000/"), "http://192.168.1.142:8000");
  for (const value of ["http://user:pass@host", "http://host/import", "http://host/?x=1", "http://host/#token", "file:///tmp", "garbage"]) {
    assert.throws(() => LedgerOrigins.normalize(value));
  }
});

test("import validation awaits trust and rejects wrong origin, route, frame and token", async () => {
  const origin = "http://192.168.1.142:8000";
  const env = setup([origin]);
  const data = { ledgerOrigin: origin, token: "a".repeat(32), startDate: "2026-09-01", endDate: "2026-09-08" };
  const sender = { url: origin + "/import", frameId: 0 };
  await env.validateRequest(data, sender);
  for (const altered of [{ url: "http://localhost:8000/import" }, { url: origin + "/" }, { frameId: 1 }]) {
    await assert.rejects(env.validateRequest(data, { ...sender, ...altered }));
  }
  await assert.rejects(env.validateRequest({ ...data, token: "bad" }, sender));
  await assert.rejects(setup([]).validateRequest(data, sender));
  for (const file of ["shared/import_coordinator.js", "walmart_extension/coordinator.js", "capitalone_extension/coordinator.js"]) {
    assert.doesNotMatch(read(file), /^\s+validateRequest\(/m, file);
  }
});

test("bridge does not announce or forward from an untrusted or revoked address", async () => {
  let allowed = false;
  const posted = [], forwarded = [], listeners = [];
  const window = { location: { origin: "http://192.168.1.142:8000" },
    postMessage: (message) => posted.push(message), addEventListener: (_, listener) => listeners.push(listener) };
  const env = vm.createContext({ window, chrome: { runtime: {
    getManifest: () => ({ version: "0.10.0" }), onMessage: { addListener() {} },
    sendMessage: async (message, callback) => {
      if (message.action === "ledgerCheckOrigin") return allowed;
      forwarded.push(message); callback({ success: true });
    },
  } } });
  vm.runInContext(read("shared/ledger_bridge.js"), env);
  await new Promise(setImmediate);
  assert.equal(posted.length, 0);
  const send = (action) => listeners[0]({ source: window, origin: window.location.origin,
    data: { source: "ledger-web-app", action, payload: {} } });
  await send("startAmazonImport");
  assert.equal(forwarded.length, 0);
  allowed = true;
  await send("extensionPing");
  assert.equal(posted.at(-1).action, "ready");
  await send("startAmazonImport");
  assert.equal(forwarded.length, 1);
  allowed = false;
  await send("startAmazonImport");
  assert.equal(forwarded.length, 1);
  vm.runInContext(read("shared/ledger_bridge.js"), env);
  assert.equal(listeners.length, 1);
  await new Promise(setImmediate);
  const before = posted.length;
  allowed = true;
  vm.runInContext(read("shared/ledger_bridge.js"), env);
  await new Promise(setImmediate);
  assert.equal(listeners.length, 1, "reconnecting never duplicates import listeners");
  assert.equal(posted.length, before + 1, "an already injected bridge reannounces after repair");
  assert.equal(posted.at(-1).action, "ready");
});
