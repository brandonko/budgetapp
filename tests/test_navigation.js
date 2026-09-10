"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app/navigation.js"), "utf8");
function setup(initiallyOpen = false) {
  const attributes = {}, handlers = {}, menuHandlers = {}, linkHandlers = {};
  const focused = [];
  const button = {
    setAttribute(name, value) { attributes[name] = value; },
    focus() { focused.push({ ...attributes }); },
  };
  const link = { addEventListener(name, handler) { linkHandlers[name] = handler; } };
  // Assigning open deliberately does NOT dispatch toggle: browsers queue it.
  const menu = {
    open: initiallyOpen,
    querySelector() { return button; },
    querySelectorAll() { return [link]; },
    addEventListener(name, handler) { menuHandlers[name] = handler; },
    contains(target) { return target === link || target === button; },
  };
  const document = {
    querySelectorAll() { return [menu]; },
    addEventListener(name, handler) { handlers[name] = handler; },
  };
  vm.runInNewContext(source, { document });
  return { menu, attributes, focused, handlers, menuHandlers, linkHandlers, link };
}
test("Escape updates accessible state before focus without waiting for toggle", () => {
  const state = setup(true);
  assert.equal(state.attributes["aria-expanded"], "true");
  state.handlers.keydown({ key: "Escape" });
  assert.equal(state.menu.open, false);
  assert.deepEqual(state.focused, [{ "aria-expanded": "false", "aria-label": "Open navigation menu" }]);
  state.menuHandlers.toggle();
  assert.equal(state.attributes["aria-expanded"], "false");
  state.handlers.keydown({ key: "Escape" });
  assert.equal(state.focused.length, 1);
});
test("native toggle synchronizes open and closed names", () => {
  const state = setup();
  state.menu.open = true;
  state.menuHandlers.toggle();
  assert.equal(state.attributes["aria-label"], "Close navigation menu");
  assert.equal(state.attributes["aria-expanded"], "true");
  state.menu.open = false;
  state.menuHandlers.toggle();
  assert.equal(state.attributes["aria-label"], "Open navigation menu");
});
test("link and outside click close synchronously without stealing focus", () => {
  for (const method of ["link", "outside"]) {
    const state = setup(true);
    if (method === "link") state.linkHandlers.click();
    else state.handlers.click({ target: {} });
    assert.equal(state.menu.open, false);
    assert.equal(state.attributes["aria-expanded"], "false");
    assert.equal(state.attributes["aria-label"], "Open navigation menu");
    assert.equal(state.focused.length, 0);
  }
});
test("inside clicks and unrelated keys leave the disclosure open", () => {
  const state = setup(true);
  state.handlers.click({ target: state.link });
  state.handlers.keydown({ key: "Enter" });
  assert.equal(state.menu.open, true);
  assert.equal(state.focused.length, 0);
});
