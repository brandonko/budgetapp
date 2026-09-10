const { test, expect } = require('./fixtures');

const importCsv = [
  'date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links',
  '2026-08-10,Synthetic imported notebook,12.34,Shopping,,Synthetic card,CREDIT CARD,Synthetic bank,Synthetic only,,,,,',
  '2026-08-11,Synthetic omitted pen,56.78,Shopping,,Synthetic card,CREDIT CARD,Synthetic bank,Synthetic only,,,,,',
  '2026-07-20,Synthetic groceries,25.00,Shopping,,Synthetic card,CREDIT CARD,Synthetic bank,Synthetic only,,,,,',
].join('\n');

async function openImport(page) {
  await page.goto('/import');
  await page.locator('#csv-import-tab').click();
  await page.locator('#csv-import-file').setInputFiles({
    name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(importCsv),
  });
  await page.locator('#csv-import-button').click();
  await expect(page.locator('#import-review-dialog')).toBeVisible();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
}

async function clickBackdrop(page, dialog) {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThan(2);
  await page.mouse.click(box.x + box.width / 2, box.y / 2);
}

async function dismiss(page, dialog, method, cancelSelector, closeSelector) {
  if (method === 'Cancel') await page.locator(cancelSelector).click();
  else if (method === 'close') await page.locator(closeSelector).click();
  else if (method === 'Escape') await page.keyboard.press('Escape');
  else await clickBackdrop(page, dialog);
  await expect(dialog).not.toBeVisible();
}

async function assertUnchanged(ledger, before) {
  expect(await ledger.bytes()).toEqual(before);
  expect(await ledger.backups()).toEqual([]);
}

test('import review: every dismissal preserves bytes; explicit confirmation saves only selected new rows', async ({ page, ledger }) => {
  const before = await ledger.bytes();
  for (const method of ['Cancel', 'close', 'Escape', 'backdrop']) {
    await openImport(page);
    await assertUnchanged(ledger, before);
    if (method === 'Cancel') {
      page.once('dialog', dialog => dialog.dismiss());
      await page.locator('#cancel-import-review').click();
      await expect(page.locator('#import-review-dialog')).toBeVisible();
      await assertUnchanged(ledger, before);
    }
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Discard this import review?');
      await dialog.accept();
    });
    const cancelled = page.waitForResponse(response => response.url().endsWith('/cancel') && response.request().method() === 'POST');
    await dismiss(page, page.locator('#import-review-dialog'), method, '#cancel-import-review', '#close-import-review');
    expect((await cancelled).status()).toBe(200);
    await assertUnchanged(ledger, before);
  }

  await openImport(page);
  await page.getByRole('checkbox', { name: 'Include Synthetic omitted pen in import', exact: true }).uncheck();
  await expect(page.locator('#confirm-import-review')).toHaveText('Import selected (1)');
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
  await assertUnchanged(ledger, before);
  const committed = page.waitForResponse(response => response.url().endsWith('/commit') && response.request().method() === 'POST');
  await page.locator('#confirm-import-review').click();
  expect((await committed).status()).toBe(200);

  const response = await page.request.get(`${ledger.baseURL}/api/transactions`);
  expect(response.ok()).toBeTruthy();
  const { transactions } = await response.json();
  expect(transactions).toHaveLength(5);
  expect(transactions.filter(row => row.description === 'Synthetic groceries')).toHaveLength(1);
  expect(transactions.some(row => row.description === 'Synthetic omitted pen')).toBe(false);
  const added = transactions.find(row => row.description === 'Synthetic imported notebook');
  expect(Number(added.amount)).toBe(12.34);
  expect(added.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  const backups = await ledger.backups();
  expect(backups).toHaveLength(1);
  expect(backups[0]).toEqual(before);
});

test('two browser tabs: a stale edit cannot overwrite the newer saved transaction', async ({ page, context, ledger }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Edit Synthetic groceries', exact: true }).click();
  await page.locator('#field-description').fill('Stale browser draft');
  const newer = await context.newPage();
  await newer.goto(`${ledger.baseURL}/transactions`);
  await newer.getByRole('button', { name: 'Edit Synthetic groceries', exact: true }).click();
  await newer.locator('#field-description').fill('Saved in newer browser tab');
  await newer.locator('#save-transaction-button').click();
  await expect(newer.locator('#transaction-form-dialog')).not.toBeVisible();
  const savedBytes = await ledger.bytes();
  const savedBackups = await ledger.backups();

  const conflict = page.waitForResponse(response => /\/api\/transactions\/\d+$/.test(response.url()) && response.request().method() === 'PUT');
  await page.locator('#save-transaction-button').click();
  expect((await conflict).status()).toBe(409);
  await expect(page.locator('#form-error')).toContainText('changed after this page loaded');
  await expect(page.locator('#transaction-form-dialog')).toBeVisible();
  expect(await ledger.bytes()).toEqual(savedBytes);
  expect(await ledger.backups()).toEqual(savedBackups);
  await newer.reload();
  await expect(newer.getByRole('button', { name: 'Edit Saved in newer browser tab', exact: true })).toBeVisible();
  await expect(newer.getByText('Stale browser draft', { exact: true })).toHaveCount(0);
});

test('linking a later partial refund changes the original month and counts the credit once', async ({ page, ledger }) => {
  const before = await ledger.bytes();
  await page.goto('/transactions');
  await expect(page.locator('#matching-spent')).toHaveText('$125.00');
  await expect(page.locator('#matching-income')).toHaveText('$1,030.00');
  await page.getByRole('button', { name: 'Edit Synthetic jacket', exact: true }).click();
  await page.locator('.transaction-link-editor summary').click();
  await page.getByRole('combobox', { name: 'Link type', exact: true }).selectOption('refund');
  await page.getByRole('searchbox', { name: 'Find a transaction to link', exact: true }).fill('Synthetic jacket refund');
  await page.getByRole('button', { name: 'Link Synthetic jacket refund', exact: true }).click();
  await expect(page.locator('.transaction-link-editor')).toContainText('Net cost: $70.00');
  await assertUnchanged(ledger, before);
  await page.locator('#save-transaction-button').click();
  await expect(page.locator('#transaction-form-dialog')).not.toBeVisible();
  await expect(page.locator('#matching-spent')).toHaveText('$95.00');
  await expect(page.locator('#matching-income')).toHaveText('$1,000.00');
  await expect(page.locator('#matching-net')).toHaveText('$905.00');

  const response = await page.request.get(`${ledger.baseURL}/api/transactions`);
  const { transactions } = await response.json();
  expect(transactions).toHaveLength(4);
  const purchase = transactions.find(row => row.id === 'synthetic-purchase');
  const refund = transactions.find(row => row.id === 'synthetic-refund');
  expect(Number(purchase.amount)).toBe(100);
  expect(Number(refund.amount)).toBe(-30);
  expect(purchase.createdAt).toBe('2026-09-01T00:00:00.000000Z');
  expect(JSON.parse(purchase.links)).toEqual([{ transactionId: refund.id, type: 'refund' }]);

  await page.goto('/');
  await expect(page.locator('#view-all-button')).toBeEnabled();
  await page.locator('#year-select').selectOption('2026');
  await page.locator('#month-select').selectOption('07');
  await expect(page.locator('#total-spent .sr-only')).toHaveText('$95.00');
  await expect(page.locator('#total-income .sr-only')).toHaveText('$1,000.00');
  await expect(page.locator('#net-total .sr-only')).toHaveText('$905.00');
  expect((await ledger.backups())[0]).toEqual(before);
});

test('shared dashboard, history and classification dialogs keep filtering and dismissal read-only', async ({ page, ledger }) => {
  const before = await ledger.bytes();
  const variants = [
    { url: '/', open: '#view-all-button', dialog: '#transaction-dialog', filter: '#transaction-filter-button', search: '#transaction-search', close: '#close-dialog' },
    { url: '/settings', tab: '#import-history-settings-tab', openName: 'View transactions', dialog: '#import-history-dialog', filter: '#import-history-filter-button', search: '#import-history-search', close: '#close-import-history-dialog' },
    { url: '/classifications', open: '#review-unclassified-button', dialog: '#unclassified-dialog', filter: '#unclassified-filter-button', search: '#unclassified-search', close: '#close-unclassified-dialog' },
  ];
  for (const variant of variants) {
    await page.goto(variant.url);
    if (variant.url === '/') {
      await expect(page.locator('#view-all-button')).toBeEnabled();
      await page.locator('#month-select').selectOption('07');
    }
    if (variant.tab) await page.locator(variant.tab).click();
    const opener = variant.openName ? page.getByRole('button', { name: variant.openName, exact: true }) : page.locator(variant.open);
    await opener.click();
    const dialog = page.locator(variant.dialog);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await dialog.getByRole('combobox', { name: 'Sort transactions', exact: true }).selectOption('description:asc');
    await page.locator(variant.search).fill('Synthetic groceries');
    await expect(dialog.locator('.transaction-list > .transaction-row')).toHaveCount(1);
    await expect(dialog.locator('.transaction-list > .transaction-row')).toContainText('Synthetic groceries');
    await page.locator(variant.filter).click();
    await expect(page.locator(variant.filter)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator(variant.filter)).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await assertUnchanged(ledger, before);
    await opener.click();
    await clickBackdrop(page, dialog);
    await expect(dialog).not.toBeVisible();
    await opener.click();
    await page.locator(variant.close).click();
    await expect(dialog).not.toBeVisible();
    await assertUnchanged(ledger, before);
  }

  // This variant proposes durable changes, so exercise all four discard paths
  // with a real saved rule whose preview changes one transaction.
  await page.goto('/classifications');
  for (const method of ['Cancel', 'close', 'Escape', 'backdrop']) {
    await page.locator('#apply-classifications-button').click();
    const dialog = page.locator('#classification-preview-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Synthetic groceries');
    await expect(page.locator('#confirm-classification-preview')).toBeEnabled();
    await assertUnchanged(ledger, before);
    await dismiss(page, dialog, method, '#cancel-classification-preview', '#close-classification-preview');
    await assertUnchanged(ledger, before);
  }
});
