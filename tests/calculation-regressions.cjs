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

function draft(data) {
  return { schema: 1, assetRevision: 'r123-calculation-regression', hasAssets: true, data: {
    step: 3,
    readReceipt: true,
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

async function openCalculator(browser, data) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  await page.route('https://openrouter.ai/**', async route => { interceptedBusinessRequests += 1; await route.abort(); });
  await page.route('https://*.workers.dev/**', async route => { interceptedBusinessRequests += 1; await route.abort(); });
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
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="calculate-split"]');
    return button && !button.disabled;
  }, null, { timeout: 30000 });
  return { context, page };
}

async function readSavedResults(page) {
  await page.waitForFunction(() => {
    try {
      const record = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      return record?.data?.results?.calculationVersion === 2 && Number.isFinite(record.data.results.billTotal);
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
    await negativeTax.page.getByTestId('header-action-menu-toggle').click();
    await negativeTax.page.getByTestId('header-language-toggle').click();
    assert.match(await negativeTax.page.getByTestId('tax-input-error').innerText(), /cannot be negative/i, 'tax error follows the selected English language');
    await negativeTax.page.getByTestId('tax-amount').fill('0');
    assert.equal(await negativeTax.page.getByTestId('tax-input-error').count(), 0, 'editing the fee clears its validation state');
    assert.equal(interceptedBusinessRequests, 0, 'all business APIs remain untouched');
    assert.deepEqual(failures, [], 'no browser exceptions occur');
    console.log('PASS negative tax is rejected and focus returns to the tax field');
    await negativeTax.context.close();
    console.log(JSON.stringify({ tests: 3, passed: 3, interceptedBusinessRequests, browserErrors: failures.length }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
