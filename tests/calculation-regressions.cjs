'use strict';
// Local-only calculation regressions. No real account, receipt, API key, or external API write is used.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/calculation-regressions.cjs
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This calculation test only runs against a local server.');
const activeDraftKey = 'billSplitterActiveDraftV1';
const assetRecordId = 'active-bill-draft-assets-v1';
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const failures = [];
let interceptedBusinessRequests = 0;

async function clickWithoutHitTesting(page, testId) {
  const control = page.getByTestId(testId);
  await control.evaluate(element => element.click());
}

function draft(data) {
  return { schema: 1, assetRevision: 'r123-calculation-regression', hasAssets: true, data: {
    step: 3,
    readReceipt: true,
    claimItemIdVersion: 2,
    legacyClaimReviewRequired: false,
    items: [],
    taxAmount: '0',
    discountAmount: '0',
    taxNote: '',
    friendsReplies: '',
    payer: '主辦人',
    detectedCurrency: 'HKD',
    currency: 'HKD',
    taxSplitMethod: 'equal',
    paymentMethods: ['現金'],
    reconciliation: null,
    receiptAdjustmentDetails: null,
    isSaved: false,
    includeReceiptImages: false,
    detailLang: 'full',
    pendingReceiptShare: false,
    claimRoom: null,
    claimSession: null,
    claimInboxSeen: [],
    claimLinkShared: true,
    results: null,
    ...data
  }};
}

async function openCalculator(browser, data, { expectCalculateEnabled = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.route('https://openrouter.ai/**', async route => { interceptedBusinessRequests += 1; await route.abort(); });
  await page.route('https://*.workers.dev/**', async route => { interceptedBusinessRequests += 1; await route.abort(); });
  await page.route('https://api.frankfurter.dev/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ base: 'HKD', quote: 'USD', rate: 0.5, date: '2026-11-10' }) }));
  await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
  await page.goto(new URL('tests/README.md', base).href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ record, png }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
    localStorage.setItem('billSplitterLanguage', 'zh-HK');
    localStorage.setItem('billSplitterHistory', '[]');
    localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', ocrEngine: 'openrouter', key: '', model: 'nvidia/nemotron-nano-12b-v2-vl:free', allowPaidModels: false }));
    localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(record));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('billSplitterLocalData', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('receipts', { keyPath: 'recordId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({ recordId: 'active-bill-draft-assets-v1', revision: record.assetRevision, images: [{ data: png, mimeType: 'image/png' }], attachments: [] });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { record: draft(data), png: ONE_PIXEL_PNG });
  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  const targetStep = String(data.step ?? 3);
  await page.waitForFunction(step => document.querySelector('[data-live-app] main')?.dataset.currentStep === step, targetStep, { timeout: 60000 });
  if (targetStep === '3') {
    await page.getByTestId('calculate-split').waitFor({ state: 'visible' });
    if (expectCalculateEnabled) await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="calculate-split"]');
      return button && !button.disabled;
    }, null, { timeout: 30000 });
  }
  return { context, page };
}

async function readSavedResults(page) {
  await page.waitForFunction(() => {
    try {
      const record = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      return record?.data?.results?.calculationVersion === 3 && Number.isFinite(record.data.results.billTotal);
    } catch (_) { return false; }
  }, null, { timeout: 20000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1')).data.results);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    // Reconciliation creates a second charge bearer (the payer) who did not claim an item.
    // Equal tax must use both actual bill participants, not only the one claimant.
    const averageTax = await openCalculator(browser, {
      items: [{ id: '01', name: '咖啡', nameEn: 'Coffee', price: 20, qty: 1, total: 20, totalQty: 2, unit: '件' }],
      friendsReplies: '姓名：阿明\n01 = 1件',
      payer: '主辦人', taxAmount: '3', discountAmount: '0',
      reconciliation: { issues: [{ itemId: '01', name: '咖啡', unit: '件', totalQty: 2, claimedQty: 1, difference: 1, amount: 10 }], policy: 'payer' }
    });
    await averageTax.page.getByTestId('calculate-split').click();
    await averageTax.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    const averageResults = await readSavedResults(averageTax.page);
    assert.equal(averageResults.personTotals['阿明'].tax, 1.5, 'claimant pays half of the tax');
    assert.equal(averageResults.personTotals['主辦人'].tax, 1.5, 'payer who covers the unclaimed physical quantity pays the other half');
    assert.equal(averageResults.sourceBillTotal, 23, 'source total remains items + tax');
    assert.equal(Object.values(averageResults.personTotals).reduce((sum, person) => sum + person.sourceTotal, 0), 23, 'allocated amounts reconcile exactly to the source total');
    console.log('PASS equal tax includes the extra payer created by actual-quantity reconciliation');
    await averageTax.context.close();

    // A present zero is a real bill total, not a signal to recompute price × quantity.
    const zeroTotal = await openCalculator(browser, {
      items: [
        { id: '01', name: '免費甜品', nameEn: 'Free dessert', price: 7.5, qty: 2, total: 0, totalQty: null, unit: '' },
        { id: '02', name: '總額缺失商品', nameEn: 'Item without total', price: 7.5, qty: 2, total: null, totalQty: null, unit: '' }
      ],
      friendsReplies: '姓名：阿明\n01 = 2\n02 = 2',
      payer: '主辦人', taxAmount: '0', discountAmount: '0', reconciliation: null
    });
    await zeroTotal.page.getByTestId('calculate-split').click();
    await zeroTotal.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    const zeroResults = await readSavedResults(zeroTotal.page);
    assert.equal(zeroResults.sourceBillTotal, 15, 'only the item with missing total falls back to price × quantity');
    assert.equal(zeroResults.billTotal, 15, 'fallback amount reconciles through settlement conversion');
    assert.equal(zeroResults.personTotals['阿明'].total, 15, 'claimant owes zero for the free item and 15 for the missing-total item');
    console.log('PASS explicit total=0 stays zero while missing total still falls back to price × quantity');
    await zeroTotal.context.close();

    // A negative fee must stop before results are produced and return focus to the field.
    const negativeTax = await openCalculator(browser, {
      items: [{ id: '01', name: '飲品', nameEn: 'Drink', price: 20, qty: 1, total: 20, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1',
      payer: '主辦人', taxAmount: '-2', discountAmount: '0', reconciliation: null
    });
    const statusToggle = negativeTax.page.getByTestId('status-bar-toggle');
    assert.equal(await statusToggle.isDisabled(), false, 'the normal app status button stays operable');
    assert.ok((await statusToggle.getAttribute('aria-label'))?.trim(), 'the status button has an accessible name');
    await statusToggle.click();
    const statusDialog = negativeTax.page.getByTestId('status-detail-dialog');
    await statusDialog.waitFor({ state: 'visible' });
    assert.equal(await statusToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await statusToggle.getAttribute('aria-controls'), 'status-detail-dialog');
    const statusClose = negativeTax.page.getByTestId('close-status-details');
    const closeTarget = await statusClose.evaluate(button => ({ name: button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }));
    assert.ok(closeTarget.name, 'the status dialog close control has an accessible name');
    assert.deepEqual([closeTarget.width, closeTarget.height], [44, 44], 'the status dialog close control has a 44x44px touch target');
    await statusClose.click();
    await statusDialog.waitFor({ state: 'hidden' });
    await negativeTax.page.getByTestId('calculate-split').click();
    await negativeTax.page.getByTestId('tax-input-error').waitFor({ state: 'visible' });
    assert.match(await negativeTax.page.getByTestId('tax-input-error').innerText(), /不可為負數/);
    assert.equal(await negativeTax.page.locator('[data-live-app] main').getAttribute('data-current-step'), '2', 'invalid fee returns to the bill review step without generating a report');
    await negativeTax.page.waitForFunction(() => document.activeElement?.dataset?.testid === 'tax-amount', null, { timeout: 5000 });
    assert.equal(await negativeTax.page.getByTestId('tax-amount').getAttribute('min'), '0');
    assert.equal(await negativeTax.page.getByTestId('tax-amount').getAttribute('aria-invalid'), 'true');
    const taxDescriptionIds = await negativeTax.page.getByTestId('tax-amount').getAttribute('aria-describedby');
    assert.match(taxDescriptionIds, /\bbill-tax-r0-hint\b/);
    assert.match(taxDescriptionIds, /\bbill-tax-r0-error\b/);
    await clickWithoutHitTesting(negativeTax.page, 'header-action-menu-toggle');
    await clickWithoutHitTesting(negativeTax.page, 'header-language-toggle');
    assert.match(await negativeTax.page.getByTestId('tax-input-error').innerText(), /cannot be negative/i, 'tax error follows the selected English language');
    await negativeTax.page.getByTestId('tax-amount').fill('0');
    assert.equal(await negativeTax.page.getByTestId('tax-input-error').count(), 0, 'editing the fee clears its validation state');
    await negativeTax.page.getByTestId('tax-amount').fill('-2');
    await negativeTax.page.getByTestId('tax-amount').evaluate(node => node.blur());
    await negativeTax.page.getByTestId('tax-input-error').waitFor({ state: 'visible' });
    await negativeTax.page.getByTestId('go-to-payer').click();
    assert.equal(await negativeTax.page.locator('[data-live-app] main').getAttribute('data-current-step'), '2', 'negative fee also blocks the Next action after blur');
    assert.equal(await negativeTax.page.getByTestId('tax-input-error').isVisible(), true, 'the inline error remains visible while blocked');
    console.log('PASS negative tax is rejected and focus returns to the tax field');
    await negativeTax.context.close();

    const unclaimed = await openCalculator(browser, {
      items: [
        { id: '01', name: '已認領', price: 12, total: 12, totalQty: null, unit: '' },
        { id: '02', name: '未認領', price: 8, total: 8, totalQty: null, unit: '' }
      ],
      friendsReplies: '姓名：阿明\n01 = 1', payer: '主辦人', taxAmount: '0', discountAmount: '0', reconciliation: null
    });
    await unclaimed.page.getByTestId('calculate-split').click();
    await unclaimed.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 10000 });
    assert.match(await unclaimed.page.getByTestId('status-compact-region').innerText(), /未認帳/, 'the warning remains visible after returning to Step 2');
    assert.equal(await unclaimed.page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1')).data.results), null, 'the report is not produced while an item total is unallocated');
    console.log('PASS a priced item with no claimant cannot disappear from the bill');
    await unclaimed.context.close();

    const nameOnly = await openCalculator(browser, {
      items: [{ id: '01', name: '茶', price: 20, total: 20, totalQty: null, unit: '' }],
      friendsReplies: '姓名：只寫姓名', payer: '主辦人', taxAmount: '1', discountAmount: '0', reconciliation: null
    }, { expectCalculateEnabled: false });
    assert.equal(await nameOnly.page.getByTestId('calculate-split').isDisabled(), true, 'a name without an item claim cannot enable calculation');
    assert.match(await nameOnly.page.getByTestId('status-compact-region').innerText(), /未有有效認領/);
    console.log('PASS name-only replies do not enable settlement');
    await nameOnly.context.close();

    const pennyTax = await openCalculator(browser, {
      items: [
        { id: '01', name: '甲項', price: 10, total: 10, totalQty: null, unit: '' },
        { id: '02', name: '乙項', price: 10, total: 10, totalQty: null, unit: '' },
        { id: '03', name: '丙項', price: 10, total: 10, totalQty: null, unit: '' }
      ],
      friendsReplies: '姓名：阿明\n01 = 1\n姓名：小美\n02 = 1\n姓名：Peter\n03 = 1\n姓名：只填姓名',
      payer: '主辦人', taxAmount: '2', discountAmount: '0', reconciliation: null
    });
    await pennyTax.page.getByTestId('calculate-split').click();
    await pennyTax.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    const pennyResults = await readSavedResults(pennyTax.page);
    const allocatedTaxCents = Object.values(pennyResults.personTotals).map(person => Math.round(person.tax * 100)).sort((a, b) => a - b);
    assert.deepEqual(allocatedTaxCents, [66, 67, 67], 'tax cents are deterministically apportioned instead of rounded up for everyone');
    assert.deepEqual(Object.keys(pennyResults.personTotals).sort(), ['Peter', '小美', '阿明'].sort(), 'a name with no item claim does not become a participant or enter the tax denominator');
    assert.equal(Object.values(pennyResults.personTotals).reduce((sum, person) => sum + person.total, 0), 32, 'each final amount sums to the bill total');
    assert.equal(await pennyTax.page.getByTestId('summary-person-totals').getByTestId('result-person-payable').count(), 3, 'the Step 4 summary lists every payable person');
    assert((await pennyTax.page.getByTestId('summary-source-total').innerText()).includes('32.00'), 'the total is immediately visible at the top of Step 4');
    const summaryPrecedesSharing = await pennyTax.page.evaluate(() => {
      const summary = document.querySelector('[data-testid="settlement-summary"]');
      const sharing = document.querySelector('[data-testid="friend-network-option"]');
      return Boolean(summary && sharing && (summary.compareDocumentPosition(sharing) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(summaryPrecedesSharing, true, 'users see what is owed before the sharing options');
    console.log('PASS tax is distributed to valid claimants by cents and the top summary reconciles');
    await pennyTax.context.close();

    const remainder = await openCalculator(browser, {
      items: [
        { id: '01', name: '六件商品', price: 60, total: 60, totalQty: 6, unit: '件' },
        { id: '02', name: '另一項', price: 1, total: 1, totalQty: null, unit: '' }
      ],
      friendsReplies: '姓名：阿明\n01 = 1件\n姓名：小美\n01 = 1件\n姓名：Peter\n02 = 1',
      payer: '主辦人', taxAmount: '0', discountAmount: '0', reconciliation: { issues: [], policy: 'equal' }
    });
    await remainder.page.getByTestId('calculate-split').click();
    await remainder.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    const remainderResults = await readSavedResults(remainder.page);
    assert.equal(remainderResults.personTotals['阿明'].adjustments[0].qty, 2, 'remaining actual units are divided among claimants of that item, not unrelated people');
    assert.equal(remainderResults.personTotals['小美'].adjustments[0].qty, 2);
    console.log('PASS actual-unit remainder division counts only people who claimed that item');
    await remainder.context.close();

    const converted = await openCalculator(browser, {
      items: [{ id: '01', name: '三分項目', price: 0.03, total: 0.03, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1\n姓名：小美\n01 = 1\n姓名：Peter\n01 = 1',
      payer: '主辦人', detectedCurrency: 'HKD', currency: 'USD', taxAmount: '0', discountAmount: '0', reconciliation: null
    });
    await converted.page.getByTestId('calculate-split').click();
    await converted.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    const convertedResults = await readSavedResults(converted.page);
    assert.equal(convertedResults.billTotal, 0.02, 'the aggregate HKD 0.03 total is converted and rounded once');
    assert.equal(Object.values(convertedResults.personTotals).reduce((sum, person) => sum + person.total, 0), convertedResults.billTotal, 'the displayed payable amounts reconcile to the converted total');
    assert.equal(Math.round(Object.values(convertedResults.personTotals).reduce((sum, person) => sum + (person.settlementRoundingAdjustment || 0), 0) * 100), -1, 'the individual-rounding residual is recorded rather than hidden');
    assert.equal(await converted.page.getByTestId('settlement-rounding-adjustment').count(), 1, 'the adjustment is visible in the Step 4 summary');
    console.log('PASS cross-currency per-person rounding is reconciled and disclosed');
    await converted.context.close();

    const stableIds = await openCalculator(browser, {
      step: 2,
      items: [
        { id: '01', name: '第一項', price: 10, total: 10, totalQty: null, unit: '' },
        { id: '02', name: '第二項', price: 20, total: 20, totalQty: null, unit: '' },
        { id: '03', name: '第三項', price: 30, total: 30, totalQty: null, unit: '' }
      ],
      friendsReplies: '姓名：阿明\n01 = 1\n02 = 1', payer: '主辦人', taxAmount: '0', discountAmount: '0'
    }, { expectCalculateEnabled: false });
    const deleteItem = stableIds.page.getByTestId('remove-item').first();
    const deleteControl = await deleteItem.evaluate(element => ({
      name: element.getAttribute('aria-label'),
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height
    }));
    assert(deleteControl.name, 'item deletion has an accessible name');
    assert(deleteControl.width >= 44 && deleteControl.height >= 44, 'item deletion has a minimum 44px touch target');
    await deleteItem.click();
    await stableIds.page.getByTestId('remove-item-dialog').waitFor({ state: 'visible' });
    assert.match(await stableIds.page.getByTestId('remove-item-claim-warning').innerText(), /不能套到其他項目/, 'the dialog warns old claims will not move to another item');
    await stableIds.page.getByTestId('confirm-remove-item').click();
    await stableIds.page.waitForFunction(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data?.items?.map(item => String(item.id)).join(',') === '02,03');
    await stableIds.page.getByTestId('add-item').click();
    await stableIds.page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data;
      return data?.items?.map(item => String(item.id)).join(',') === '02,03,04' && data.nextClaimItemId === 5;
    });
    assert.equal((await stableIds.page.getByTestId('item-name').last().getAttribute('id')), 'bill-item-04-name', 'the new item receives a fresh, never-reused claim ID');
    await stableIds.page.reload({ waitUntil: 'domcontentloaded' });
    await stableIds.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await stableIds.page.getByTestId('add-item').click();
    await stableIds.page.waitForFunction(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data?.items?.map(item => String(item.id)).join(',') === '02,03,04,05');
    assert.equal((await stableIds.page.getByTestId('item-name').last().getAttribute('id')), 'bill-item-05-name', 'the high-water ID survives reload');
    console.log('PASS deleted item IDs are not reused, and the claim-ID counter survives reload');
    await stableIds.context.close();

    const newBill = await openCalculator(browser, {
      items: [{ id: '01', name: '待保留項目', price: 15, total: 15, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1', payer: '主辦人', taxAmount: '0', discountAmount: '0', reconciliation: null,
      receiptTextDraft: '尚未匯入的私人翻譯文字', showReceiptTextImport: true
    });
    await newBill.page.getByTestId('calculate-split').click();
    await newBill.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    let newBillPrompt = '';
    newBill.page.once('dialog', async dialog => { newBillPrompt = dialog.message(); await dialog.dismiss(); });
    await newBill.page.getByTestId('new-bill').click();
    await newBill.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4');
    assert(newBillPrompt.length > 0, 'starting a new bill asks before clearing the current one');
    const preservedDraft = await newBill.page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data);
    assert.equal(preservedDraft.items[0].name, '待保留項目', 'cancelling keeps the existing bill in the page and local draft');
    assert.equal(preservedDraft.receiptTextDraft, '尚未匯入的私人翻譯文字', 'cancelling preserves unsent local receipt text');
    assert.equal(preservedDraft.results.calculationVersion, 3, 'the previous calculation remains available after cancellation');
    console.log('PASS cancelling New bill preserves the current results and local draft');

    const menuToggle = newBill.page.getByTestId('header-action-menu-toggle');
    const menuTarget = await menuToggle.boundingBox();
    assert(menuTarget.width >= 44 && menuTarget.height >= 44, 'the header menu toggle has a 44px touch target');
    await clickWithoutHitTesting(newBill.page, 'header-action-menu-toggle');
    for (const id of ['app-text-size-small', 'app-text-size-normal', 'app-text-size-large']) {
      const box = await newBill.page.getByTestId(id).boundingBox();
      assert(box.width >= 44 && box.height >= 44, `${id} has a 44px touch target`);
    }
    await clickWithoutHitTesting(newBill.page, 'header-settings-button');
    assert.equal(await newBill.page.getByTestId('status-bar-toggle').count(), 0, 'the global result status is hidden on Settings');
    await clickWithoutHitTesting(newBill.page, 'header-back-button');
    await clickWithoutHitTesting(newBill.page, 'header-action-menu-toggle');
    await clickWithoutHitTesting(newBill.page, 'header-history-button');
    assert.equal(await newBill.page.getByTestId('status-bar-toggle').count(), 0, 'the global result status is hidden on History');
    await clickWithoutHitTesting(newBill.page, 'header-back-button');
    const acceptNewBill = newBill.page.waitForEvent('dialog').then(async dialog => { await dialog.accept(); });
    await newBill.page.getByTestId('new-bill').click();
    await acceptNewBill;
    await newBill.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '1', null, { timeout: 20000 });
    await newBill.page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data;
      return !data || (data.receiptTextDraft === '' && data.showReceiptTextImport === false);
    });
    assert.equal(await newBill.page.getByTestId('receipt-text-draft').inputValue().catch(() => ''), '', 'confirming New bill clears unsent receipt text');
    await newBill.context.close();

    const negativeItems = await openCalculator(browser, {
      step: 2,
      items: [{ id: '01', name: '負單價商品', price: -5, qty: -1, total: 5, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1', payer: '主辦人'
    });
    await negativeItems.page.getByTestId('go-to-payer').click();
    await negativeItems.page.getByTestId('step-error').waitFor({ state: 'visible' });
    assert.match(await negativeItems.page.getByTestId('step-error').innerText(), /負單價商品/);
    assert.equal(await negativeItems.page.evaluate(() => document.querySelector('[data-live-app] main')?.dataset.currentStep), '2', 'negative price and quantity cannot pass Step 2');
    await negativeItems.context.close();

    const negativeQty = await openCalculator(browser, {
      step: 2,
      items: [{ id: '01', name: '負數量商品', price: 20, qty: -1, total: 20, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1', payer: '主辦人'
    });
    await negativeQty.page.getByTestId('go-to-payer').click();
    await negativeQty.page.getByTestId('step-error').waitFor({ state: 'visible' });
    const qtyCorrection = negativeQty.page.getByTestId('item-qty');
    await qtyCorrection.waitFor({ state: 'visible' });
    assert.equal(await qtyCorrection.inputValue(), '-1', 'the invalid source quantity is shown in the editable quantity field');
    await qtyCorrection.fill('2');
    await negativeQty.page.getByTestId('go-to-payer').click();
    assert.equal(await negativeQty.page.evaluate(() => document.querySelector('[data-live-app] main')?.dataset.currentStep), '3', 'correcting the quantity updates the invalid source field and allows progress');
    console.log('PASS negative quantity is surfaced in the editable field and can be corrected');
    await negativeQty.context.close();

    const oldDraft = await openCalculator(browser, {
      step: 2,
      items: [{ id: '01', name: '舊草稿商品', price: 10, total: 10, totalQty: null, unit: '' }],
      friendsReplies: '姓名：阿明\n01 = 1', payer: '阿明'
    });
    await oldDraft.page.evaluate(() => {
      const key = 'billSplitterActiveDraftV1';
      const record = JSON.parse(localStorage.getItem(key));
      delete record.data.claimItemIdVersion;
      delete record.data.legacyClaimReviewRequired;
      const nativeSetItem = Storage.prototype.setItem;
      nativeSetItem.call(localStorage, key, JSON.stringify(record));
      Storage.prototype.setItem = function(name, value) {
        if (name === key) return;
        return nativeSetItem.call(this, name, value);
      };
    });
    await oldDraft.page.reload({ waitUntil: 'domcontentloaded' });
    await oldDraft.page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await oldDraft.page.getByTestId('legacy-claim-review').waitFor({ state: 'visible' });
    await oldDraft.page.getByTestId('go-to-payer').click();
    assert.equal(await oldDraft.page.evaluate(() => document.querySelector('[data-live-app] main')?.dataset.currentStep), '2', 'old claim IDs require explicit review');
    await oldDraft.page.getByTestId('confirm-legacy-claim-review').click();
    await oldDraft.page.getByTestId('go-to-payer').click();
    assert.equal(await oldDraft.page.evaluate(() => document.querySelector('[data-live-app] main')?.dataset.currentStep), '3', 'the reviewed legacy draft can proceed');
    await oldDraft.context.close();

    assert.equal(interceptedBusinessRequests, 0, 'all business APIs remain untouched');
    assert.deepEqual(failures, [], 'no browser exceptions occur');
    console.log(JSON.stringify({ tests: 14, passed: 14, interceptedBusinessRequests, browserErrors: failures.length }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
