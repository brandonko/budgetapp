"use strict";
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = readFileSync(path.join(__dirname, "../app/settings.js"), "utf8");
const validateSource = source.slice(source.indexOf("function validateRule("), source.indexOf("function validateClassifications("));
const loadSource = source.slice(source.indexOf("async function loadClassifications("), source.indexOf("async function persistClassifications("));
function harness(payload) {
  const messages = [];
  const requests = [];
  const context = {
    classifications: [], classificationRegexErrors: [], classificationsBusy: false,
    selectedClassificationIndex: 0, renders: 0,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => payload };
    },
    renderClassifications: () => { context.renders += 1; },
    setClassificationStatus: (message, kind) => messages.push({ message, kind }),
  };
  vm.runInNewContext(validateSource + "\n" + loadSource, context);
  return { context, messages, requests };
}
test("Python regex syntax is delegated to the server, with no client matching", () => {
  const { context } = harness({ classifications: [] });
  for (const description of ["(?x)^ (whole) + $", "(?P<merchant>whole)", "[])]+", "(a+)+$"]) {
    const rule = { category: "", subcategory: "", description, accountName: "", provider: "" };
    assert.doesNotThrow(() => context.validateRule(rule, 0, 0));
  }
  assert.throws(() => context.validateRule({ category: "", subcategory: "", description: "", accountName: "", provider: "" }, 0, 0), /needs a matcher/);
});
test("legacy regex errors keep the saved library editable and explain recovery", async () => {
  const payload = {
    classifications: [{ updates: { category: "Food" }, rules: [{ description: "(?x)^(a+) +$" }] }],
    regexErrors: [{ classificationIndex: 0, ruleIndex: 0, field: "description", message: "Classification 1, rule 1, description cannot repeat a group" }],
  };
  const { context, messages, requests } = harness(payload);
  await context.loadClassifications();
  assert.equal(context.classifications, payload.classifications);
  assert.equal(context.classificationRegexErrors, payload.regexErrors);
  assert.equal(context.classificationsBusy, false);
  assert.equal(context.renders, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/classifications");
  assert.equal(requests[0].options.method, undefined);
  assert.equal(messages[0].kind, "error");
  assert.match(messages[0].message, /matching and imports are blocked/);
  assert.match(messages[0].message, /Export.*Import/);
  assert.match(messages[0].message, /saved rules have not been changed/);
});
test("loading a valid replacement clears regex error state", async () => {
  const { context, messages } = harness({ version: 2, classifications: [] });
  context.classificationRegexErrors = [{ message: "old failure" }];
  await context.loadClassifications();
  assert.equal(context.classificationRegexErrors.length, 0);
  assert.equal(context.classificationsBusy, false);
  assert.equal(messages.length, 0);
});
