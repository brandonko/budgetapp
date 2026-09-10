const { test, expect } = require('./fixtures');

const purchaseDescription = 'Synthetic CLEAR *CLEARME.COM NEW YORK NY';
const creditDescription = 'Synthetic AMEX CLEAR PLUS CREDIT';
const sameBatchCsv = [
  'date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links',
  `2026-09-07,${purchaseDescription},219.00,Travel,,Synthetic platinum,CREDIT,Synthetic bank,,,,,,`,
  `2026-09-08,${creditDescription},-219.00,Income,,Synthetic platinum,CREDIT,Synthetic bank,,,,,,`,
].join('\n');

async function importFile(page, content) {
  await page.goto('/import');
  await page.locator('#import-source-toggle').click();
  await page.locator('#csv-import-option').click();
  await page.locator('#csv-import-file').setInputFiles({name:'synthetic-refunds.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
  await page.locator('#csv-import-button').click();
  await expect(page.locator('#import-review-dialog')).toBeVisible();
}

async function saveEditor(page) {
  await page.locator('#save-import-edit').click();
  await expect(page.locator('#import-edit-dialog')).not.toBeVisible();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
}

async function expectUnchanged(ledger, before) {
  expect(await ledger.bytes()).toEqual(before);
  expect(await ledger.backups()).toEqual([]);
}

test('same-import refund: both editors, undo, incomplete selection, cancellation and durable reimport', async ({page,ledger}) => {
  const before = await ledger.bytes();
  await importFile(page,sameBatchCsv);
  const review = page.locator('#import-review-dialog');
  await review.getByRole('button',{name:'Mark as refunded',exact:true}).click();
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toBeVisible();
  await expect(page.locator('#confirm-import-review')).toHaveText('Confirm 2 imports · 1 refund');

  await review.getByRole('button',{name:`Edit ${creditDescription}`,exact:true}).click();
  const editor = page.locator('#import-edit-dialog');
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toContainText(purchaseDescription);
  await editor.locator('[name="notes"]').fill('Synthetic credit reviewed');
  await saveEditor(page);

  await review.getByRole('button',{name:`Edit ${purchaseDescription}`,exact:true}).click();
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toContainText(creditDescription);
  await editor.locator('[name="notes"]').fill('Synthetic purchase reviewed');
  await saveEditor(page);
  await review.getByRole('button',{name:`Edit ${purchaseDescription}`,exact:true}).click();
  await editor.locator('.transaction-link-editor summary').click();
  await editor.getByRole('button',{name:`Unlink ${creditDescription}`,exact:true}).click();
  await saveEditor(page);
  await expect(review.getByRole('button',{name:'Mark as refunded',exact:true})).toBeVisible();
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toHaveCount(0);

  // The manual editor uses the same relationship as the compact suggestion.
  await review.getByRole('button',{name:`Edit ${creditDescription}`,exact:true}).click();
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toBeEmpty();
  await editor.getByRole('combobox',{name:'Link type',exact:true}).selectOption('refund');
  await editor.getByRole('searchbox',{name:'Find the original purchase',exact:true}).fill('Synthetic CLEAR');
  await editor.getByRole('button',{name:`Link ${purchaseDescription}`,exact:true}).click();
  await saveEditor(page);
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toBeVisible();
  await review.getByRole('button',{name:'Undo match',exact:true}).click();
  await expect(review.getByRole('button',{name:'Mark as refunded',exact:true})).toBeVisible();
  await review.getByRole('button',{name:'Mark as refunded',exact:true}).click();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();

  await review.getByRole('checkbox',{name:`Include ${purchaseDescription} in import`,exact:true}).uncheck();
  await expect(page.locator('#import-review-error')).toBeVisible();
  await expect(page.locator('#confirm-import-review')).toBeDisabled();
  await expectUnchanged(ledger,before);
  await review.getByRole('checkbox',{name:`Include ${purchaseDescription} in import`,exact:true}).check();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#cancel-import-review').click();
  await expect(review).not.toBeVisible();
  await expectUnchanged(ledger,before);

  await importFile(page,sameBatchCsv);
  await review.getByRole('button',{name:'Mark as refunded',exact:true}).click();
  await expect(page.locator('#confirm-import-review')).toBeEnabled();
  const committed = page.waitForResponse(response=>response.url().endsWith('/commit'));
  await page.locator('#confirm-import-review').click();
  expect((await committed).status()).toBe(200);
  const {transactions} = await (await page.request.get(`${ledger.baseURL}/api/transactions`)).json();
  expect(transactions).toHaveLength(6);
  const purchase = transactions.find(row=>row.description===purchaseDescription);
  const credit = transactions.find(row=>row.description===creditDescription);
  expect(Number(purchase.amount)).toBe(219);
  expect(Number(credit.amount)).toBe(-219);
  expect(JSON.parse(purchase.links)).toEqual([{transactionId:credit.id,type:'refund'}]);
  expect(purchase.createdAt).toBe(credit.createdAt);
  expect(purchase.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  expect((await ledger.backups())[0]).toEqual(before);
  const after = await ledger.bytes();
  await importFile(page,sameBatchCsv);
  await expect(page.locator('#import-review-subtitle')).toContainText('0 new, 2 duplicates');
  await expect(page.locator('#confirm-import-review')).toBeDisabled();
  expect(await ledger.bytes()).toEqual(after);
});

test('saved-purchase auto match survives editor notes and manual partial refund links share Undo', async ({page,ledger}) => {
  const before = await ledger.bytes();
  await importFile(page,[
    'date,description,amount,category,subcategory,accountName,accountType,provider,notes,tags,group,flags,id,links',
    '2026-08-12,Synthetic grocery credit,-25.00,Income,,Synthetic card,CREDIT CARD,Synthetic bank,,,,,,',
  ].join('\n'));
  const review = page.locator('#import-review-dialog');
  await review.getByRole('button',{name:'Mark as refunded',exact:true}).click();
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toBeVisible();
  await review.getByRole('button',{name:'Edit Synthetic grocery credit',exact:true}).click();
  const editor = page.locator('#import-edit-dialog');
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toContainText('Synthetic groceries');
  await editor.locator('[name="notes"]').fill('Confirmed synthetic partial refund');
  await editor.locator('[name="amount"]').fill('-10');
  await saveEditor(page);
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toBeVisible();
  await expectUnchanged(ledger,before);
  await review.getByRole('button',{name:'Undo match',exact:true}).click();
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toHaveCount(0);
  await review.getByRole('button',{name:'Edit Synthetic grocery credit',exact:true}).click();
  await editor.locator('.transaction-link-editor summary').click();
  await expect(editor.locator('.transaction-linked-selections')).toBeEmpty();
  await editor.getByRole('combobox',{name:'Link type',exact:true}).selectOption('refund');
  await editor.getByRole('searchbox',{name:'Find the original purchase',exact:true}).fill('Synthetic groceries');
  await editor.getByRole('button',{name:'Link Synthetic groceries',exact:true}).click();
  await saveEditor(page);
  await expect(review.getByRole('button',{name:'Undo match',exact:true})).toBeVisible();
  const committed = page.waitForResponse(response=>response.url().endsWith('/commit'));
  await page.locator('#confirm-import-review').click();
  expect((await committed).status()).toBe(200);
  const {transactions} = await (await page.request.get(`${ledger.baseURL}/api/transactions`)).json();
  const purchase = transactions.find(row=>row.id==='synthetic-grocery');
  const credit = transactions.find(row=>row.description==='Synthetic grocery credit');
  expect(Number(purchase.amount)).toBe(25);
  expect(Number(credit.amount)).toBe(-10);
  expect(credit.notes).toBe('Confirmed synthetic partial refund');
  expect(JSON.parse(purchase.links)).toEqual([{transactionId:credit.id,type:'refund'}]);
  expect(purchase.createdAt).toBe('2026-09-01T00:00:00.000000Z');
  expect((await ledger.backups())[0]).toEqual(before);
});
