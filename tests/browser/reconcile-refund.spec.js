const { test, expect } = require('./fixtures');

const purchaseName = 'Synthetic groceries';
const creditName = 'Synthetic grocery refund';
const csv = [
  'date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links',
  ['2026-08-12', creditName, '-25.00', 'Income', '', 'Synthetic card', 'CREDIT CARD',
    'Synthetic bank', 'Synthetic refund setup', '', '', '', 'synthetic-grocery-refund', ''].join(','),
].join('\n');

async function expectPreview(page, action) {
  const response = page.waitForResponse(item => item.url().endsWith('/api/internal-transfers/preview')
    && item.request().method() === 'POST');
  await action();
  expect((await response).status()).toBe(200);
  await expect(page.locator('#confirm-transfer-review')).toBeEnabled();
}

async function stageSuggestedRefund(page) {
  const detail = page.locator('#import-history-dialog .reconciliation-refund-match');
  await expect(detail).toContainText('Possible refund');
  if (!await detail.evaluate(element => element.open)) await detail.locator('summary').click();
  await expectPreview(page, () => detail.getByRole('button', { name: 'Link selected purchase', exact: true }).click());
  await expect(page.locator('#import-history-dialog .reconciliation-refund-match')).toContainText('Refund link staged');
}

async function openEditor(page, description, counterpart) {
  await page.locator('#import-history-dialog').getByRole('button', { name: `Edit ${description}`, exact: true }).click();
  const editor = page.locator('#import-history-edit-dialog');
  await expect(editor).toBeVisible();
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toContainText(counterpart);
  return editor;
}

async function saveEditor(page) {
  await expectPreview(page, () => page.locator('#save-import-history-edit').click());
  await expect(page.locator('#import-history-edit-dialog')).not.toBeVisible();
  await expect(page.locator('#import-history-dialog')).toBeVisible();
}

test('Reconcile uses the same staged refund in both editors; cancel writes nothing and confirm saves once', async ({ page, ledger }) => {
  // Establish a saved, unmatched credit through the actual import UI. All
  // no-write assertions below start AFTER this deliberate setup mutation.
  await page.goto('/import');
  await page.locator('#import-source-toggle').click();
  await page.locator('#csv-import-option').click();
  await page.locator('#csv-apply-classifications').uncheck();
  await page.locator('#csv-import-file').setInputFiles({
    name: 'synthetic-reconcile-refund.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await page.locator('#csv-import-button').click();
  await expect(page.locator('#import-review-dialog')).toBeVisible();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
  const imported = page.waitForResponse(response => response.url().endsWith('/commit') && response.request().method() === 'POST');
  await page.locator('#confirm-import-review').click();
  expect((await imported).status()).toBe(200);

  const before = await ledger.bytes();
  const beforeBackups = await ledger.backups();
  const initial = await (await page.request.get(`${ledger.baseURL}/api/transactions`)).json();
  expect(initial.transactions).toHaveLength(5);
  expect(initial.transactions.find(row => row.id === 'synthetic-grocery').links).toBe('');
  const writes = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'DELETE'].includes(request.method())) writes.push(new URL(request.url()).pathname);
  });
  const unchanged = async () => {
    expect(await ledger.bytes()).toEqual(before);
    expect(await ledger.backups()).toEqual(beforeBackups);
    expect(writes.every(url => url === '/api/internal-transfers/preview')).toBe(true);
  };

  await page.goto('/settings');
  await page.locator('#internal-transfers-settings-tab').click();
  await expectPreview(page, () => page.locator('#find-internal-transfers').click());
  await stageSuggestedRefund(page);

  let editor = await openEditor(page, creditName, purchaseName);
  await expect(editor.getByRole('combobox', { name: 'Link type', exact: true })).toHaveValue('refund');
  await editor.locator('[name="notes"]').fill('Discarded credit draft');
  await saveEditor(page);
  await expect(page.getByRole('button', { name: 'Undo refund link', exact: true })).toBeVisible();

  editor = await openEditor(page, purchaseName, creditName);
  await editor.locator('[name="notes"]').fill('Discarded purchase draft');
  await editor.getByRole('combobox', { name: 'Link type', exact: true }).selectOption('repayment');
  await saveEditor(page);
  await expect(page.getByRole('button', { name: 'Undo refund link', exact: true })).toHaveCount(0);

  // Reopening a retyped credit used to replay both linkTo and repaymentTo.
  editor = await openEditor(page, creditName, purchaseName);
  await expect(editor.getByRole('combobox', { name: 'Link type', exact: true })).toHaveValue('repayment');
  await editor.locator('[name="notes"]').fill('Discarded repayment draft');
  await saveEditor(page);
  editor = await openEditor(page, purchaseName, creditName);
  await editor.getByRole('combobox', { name: 'Link type', exact: true }).selectOption('refund');
  await saveEditor(page);
  await expectPreview(page, () => page.getByRole('button', { name: 'Undo refund link', exact: true }).click());
  await expect(page.locator('.reconciliation-refund-match')).toContainText('Possible refund');
  await expect(page.getByRole('button', { name: 'Undo refund link', exact: true })).toHaveCount(0);
  await unchanged();

  await stageSuggestedRefund(page);
  await page.locator('#cancel-transfer-review').click();
  await expect(page.locator('#import-history-dialog')).not.toBeVisible();
  await unchanged();

  await expectPreview(page, () => page.locator('#find-internal-transfers').click());
  await stageSuggestedRefund(page);
  editor = await openEditor(page, creditName, purchaseName);
  await expect(editor.locator('[name="notes"]')).toHaveValue('Synthetic refund setup');
  await editor.locator('[name="notes"]').fill('Confirmed synthetic refund review');
  await saveEditor(page);
  await expect(page.locator('.reconciliation-refund-match')).toContainText('Refund link staged');
  await unchanged();

  const confirmed = page.waitForResponse(response => response.url().endsWith('/api/internal-transfers/confirm')
    && response.request().method() === 'POST');
  await page.locator('#confirm-transfer-review').click();
  expect((await confirmed).status()).toBe(200);
  await expect(page.locator('#import-history-dialog')).not.toBeVisible();
  expect(writes.filter(url => url === '/api/internal-transfers/confirm')).toHaveLength(1);
  expect(writes.every(url => ['/api/internal-transfers/preview', '/api/internal-transfers/confirm'].includes(url))).toBe(true);

  const saved = await (await page.request.get(`${ledger.baseURL}/api/transactions`)).json();
  expect(saved.transactions).toHaveLength(5);
  const purchase = saved.transactions.find(row => row.id === 'synthetic-grocery');
  const credit = saved.transactions.find(row => row.id === 'synthetic-grocery-refund');
  expect(JSON.parse(purchase.links)).toEqual([{ transactionId: credit.id, type: 'refund' }]);
  expect(Number(purchase.amount)).toBe(25);
  expect(Number(credit.amount)).toBe(-25);
  expect(purchase._budgetAmount).toBe(0);
  expect(credit._budgetAmount).toBe(0);
  expect(credit.notes).toBe('Confirmed synthetic refund review');
  expect(purchase.notes).toBe('Synthetic fixture only');
  for (const original of initial.transactions) {
    const row = saved.transactions.find(transaction => transaction.id === original.id);
    expect(row.createdAt).toBe(original.createdAt);
    expect(row.amount).toBe(original.amount);
    expect(row.date).toBe(original.date);
  }
  const backups = await ledger.backups();
  expect(backups).toHaveLength(beforeBackups.length + 1);
  expect(backups.slice(0, beforeBackups.length)).toEqual(beforeBackups);
  expect(backups.at(-1)).toEqual(before);
});
