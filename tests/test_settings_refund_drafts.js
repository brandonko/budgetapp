"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const appPath = path.join(__dirname, "../app");
const controller = fs.readFileSync(path.join(appPath, "settings.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const purchase = { _id: 0, id: "purchase", amount: 219, links: "", notes: "Original purchase" };
const credit = { _id: 1, id: "credit", amount: -219, links: "", flags: "", category: "Income" };
const refundLinks = JSON.stringify([{ transactionId: "credit", type: "refund" }]);

function fixture() {
  // Exercise the controller's actual draft/preview functions independently of
  // layout. Full DOM editor/button coverage lives in test_transactions_controller.
  const context = vm.createContext({ window: {}, Map, Set, Object });
  vm.runInContext(fs.readFileSync(path.join(appPath, "transaction-ui.js"), "utf8"), context);
  context.transactionUi = context.window.LedgerTransactionUI;
  context.state = {
    transferReview: null, availableTransactions: [plain(purchase), plain(credit)],
    importHistoryTransactions: [], importHistoryRevision: "r1", transferReviewBusy: false,
  };
  context.document = { querySelector: () => ({ disabled: false, checked: false }) };
  context.historyBulk = { isActive: () => false };
  context.configureImportHistoryFilters = () => {};
  context.renderImportHistoryTransactions = () => {};
  const names = ["stagedReconciliationRefund", "originalReconciliationTarget", "reconciliationDraftOverrides", "reconciliationEditorDraft", "refreshTransferReview"];
  for (const name of names) {
    const start = controller.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.notEqual(start, -1, `Missing controller function ${name}`);
    const remainder = controller.slice(start);
    const next = remainder.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(next < 0 ? remainder : remainder.slice(0, next + 1), context);
  }
  return context;
}

function linkedReview(overrides = []) {
  const original = plain(purchase);
  const linked = { ...original, links: refundLinks };
  return {
    revision: "r1", plan: "review-plan", nonzeroDecimal: false, overrides,
    refundLinks: [], alreadyFlagged: [], refundSuggestions: [],
    changes: [{ _id: 0, before: original, after: linked, changedFields: ["links"] }],
    transactions: [
      { ...original, _linkRole: "primary", _linkType: "refund", _linkedTransactions: [plain(credit)] },
      { ...credit, _linkRole: "credit", _linkType: "refund", _linkedTo: linked },
    ],
  };
}

test("reconciliation notes and flags preserve the staged reverse link without mutating the previous review", () => {
  const app = fixture();
  const previous = linkedReview([{ ...credit, linkTo: { transactionId: "purchase", type: "refund" } }]);
  const snapshot = plain(previous);
  const rows = app.reconciliationDraftOverrides(previous, [{ ...credit, notes: "Checked", flags: "flagged" }]);
  assert.deepEqual(plain(rows[0].linkTo), { transactionId: "purchase", type: "refund" });
  assert.equal(rows[0].notes, "Checked");
  assert.equal(rows[0].flags, "flagged");
  assert.deepEqual(previous, snapshot);
});

test("purchase-side unlink consumes the previous credit intent while preserving unrelated overrides", () => {
  const app = fixture();
  const previous = linkedReview([
    { ...credit, notes: "Keep this", linkTo: { transactionId: "purchase", type: "refund" } },
    { _id: 2, id: "other-credit", amount: -12, repaymentTo: "other-purchase" },
  ]);
  const rows = app.reconciliationDraftOverrides(previous, [{ ...purchase, links: "" }], ["purchase"]);
  assert.equal(rows.find(row => row.id === "credit").linkTo, undefined);
  assert.equal(rows.find(row => row.id === "credit").notes, "Keep this");
  assert.equal(rows.find(row => row.id === "other-credit").repaymentTo, "other-purchase");
  assert.equal(rows.find(row => row.id === "purchase").links, "");
  assert.equal(previous.overrides[0].linkTo.transactionId, "purchase", "Failed validation can retain the original review");
});

test("purchase-side retyping does not replay a child refund intent over the requested repayment", () => {
  const app = fixture();
  const previous = linkedReview([{ ...credit, linkTo: { transactionId: "purchase", type: "refund" } }]);
  const links = JSON.stringify([{ transactionId: "credit", type: "repayment" }]);
  const rows = app.reconciliationDraftOverrides(previous, [{ ...purchase, links }], ["purchase"]);
  assert.equal(rows.find(row => row.id === "credit").linkTo, undefined);
  assert.equal(rows.find(row => row.id === "purchase").links, links);
});

test("credit-side link changes replace the alternate legacy intent, including explicit unlink", () => {
  const app = fixture();
  const previous = { overrides: [{ ...credit, repaymentTo: "purchase", notes: "Keep" }] };
  const linked = app.reconciliationDraftOverrides(previous, [
    { ...credit, linkTo: { transactionId: "replacement-purchase", type: "refund" } },
  ], ["credit"]);
  assert.equal(linked[0].repaymentTo, undefined);
  assert.deepEqual(plain(linked[0].linkTo), { transactionId: "replacement-purchase", type: "refund" });
  const unlinked = app.reconciliationDraftOverrides({ overrides: linked }, [
    { ...credit, linkTo: { transactionId: "", type: "refund" } },
  ], ["credit"]);
  assert.deepEqual(plain(unlinked[0].linkTo), { transactionId: "", type: "refund" });
  assert.equal(unlinked[0].notes, "Keep");
});

test("projected refund state drives staged controls without a parallel refund selection", () => {
  const app = fixture();
  const review = linkedReview();
  const row = review.transactions[1];
  assert.deepEqual(plain(app.stagedReconciliationRefund(row, review)), { transactionId: "credit", purchaseId: "purchase" });
  assert.equal(app.stagedReconciliationRefund({ ...row, _linkType: "repayment" }, review), null);
  assert.equal(app.stagedReconciliationRefund(credit, review), null, "Undo cannot retain old projected status");
  review.changes[0].before.links = refundLinks;
  assert.equal(app.stagedReconciliationRefund(row, review), null, "Existing refunds are not new choices merely because another field changed");
});

test("refund to repayment followed by an editor note or unlink never sends two reverse intents", () => {
  const app = fixture();
  const projected = { ...credit, linkTo: { transactionId: "purchase", type: "repayment" },
    _linkType: "repayment", _linkRole: "credit", _linkedTo: purchase };
  for (const target of ["purchase", "", "replacement-purchase"]) {
    const draft = app.reconciliationEditorDraft(projected, { notes: "Reopened", repaymentTo: target });
    const rows = app.reconciliationDraftOverrides({ overrides: [projected] }, [draft], ["credit"]);
    assert.equal(rows[0].linkTo, undefined);
    assert.equal(rows[0].repaymentTo, target);
    assert.equal(rows[0].notes, "Reopened");
    assert.equal(projected.linkTo.transactionId, "purchase", "Preparing a draft does not mutate the displayed row");
  }
  const undo = app.reconciliationEditorDraft({ ...credit, repaymentTo: "purchase" },
    { linkTo: { transactionId: "", type: "refund" } });
  assert.equal(undo.repaymentTo, undefined);
  assert.deepEqual(plain(undo.linkTo), { transactionId: "", type: "refund" });
});

test("undo restores the saved relationship and leaves an originally unlinked credit unlinked", () => {
  const app = fixture();
  app.state.transferReview = linkedReview();
  assert.deepEqual(plain(app.originalReconciliationTarget(credit)), { transactionId: "", type: "refund" });
  app.state.transferReview.changes[0].before.links = JSON.stringify([{ transactionId: "credit", type: "repayment" }]);
  assert.deepEqual(plain(app.originalReconciliationTarget(credit)), { transactionId: "purchase", type: "repayment" });
});

test("reconciliation preview submits one canonical staged path and preserves it across an unrelated edit", async () => {
  const app = fixture();
  app.state.transferReview = { ...linkedReview(), changes: [], transactions: [] };
  const requests = [];
  app.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => linkedReview() };
  };
  await app.refreshTransferReview([{ ...credit, linkTo: { transactionId: "purchase", type: "refund" } }], ["credit"]);
  await app.refreshTransferReview([{ ...credit, notes: "Reviewed afterwards" }]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url === "/api/internal-transfers/preview"));
  assert.deepEqual(requests[1].body.refundLinks, []);
  assert.deepEqual(requests[1].body.overrides[0].linkTo, { transactionId: "purchase", type: "refund" });
  assert.equal(requests[1].body.overrides[0].notes, "Reviewed afterwards");
  assert.equal(requests[1].body.revision, "r1");
  assert.equal(requests[1].body.nonzeroDecimal, false);
});

test("failed preview retains the last valid refund draft and never calls a save endpoint", async () => {
  const app = fixture();
  const previous = linkedReview([{ ...credit, linkTo: { transactionId: "purchase", type: "refund" } }]);
  app.state.transferReview = previous;
  const requests = [];
  app.fetch = async url => {
    requests.push(url);
    return { ok: false, status: 409, json: async () => ({ error: "The file changed" }) };
  };
  await assert.rejects(app.refreshTransferReview([{ ...purchase, links: "" }], ["purchase"]), /The file changed/);
  assert.equal(app.state.transferReview, previous);
  assert.equal(previous.overrides[0].linkTo.transactionId, "purchase");
  assert.deepEqual(requests, ["/api/internal-transfers/preview"]);
  assert.equal(app.state.transferReviewBusy, false);
});
