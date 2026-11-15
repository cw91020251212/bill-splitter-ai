'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) {
  throw new Error('This state-writing test only runs against a local server.');
}
const outputDir = process.env.TEST_OUTPUT_DIR || path.resolve(__dirname, '../artifacts');
const items = [
  { id: '05', name: '燒賣', nameEn: 'Siu mai', original: '燒賣', price: 12, qty: 1, total: 12 },
  { id: '06', name: '奶茶', nameEn: 'Milk tea', original: '奶茶', price: 18, qty: 1, total: 18 },
  { id: '07', name: '牛肉飯', nameEn: 'Beef rice', original: '牛肉飯', price: 48, qty: 1, total: 48 },
  { id: '08', name: '豆腐', nameEn: 'Tofu', original: '豆腐', price: 20, qty: 1, total: 20 }
];
const expected = ['01', '02', '03', '04'];
const draft = {
  schema: 1,
  data: {
    step: 2,
    items,
    nextClaimItemId: 9,
    claimItemIdVersion: 2,
    legacyClaimReviewRequired: false,
    friendsReplies: '',
    detectedCurrency: 'HKD',
    currency: 'HKD',
    readReceipt: true,
    receiptTextDraft: '',
    showReceiptTextImport: false,
    claimLinkShared: false
  }
};

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pageErrors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.addInitScript(value => localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(value)), draft);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('verify-item').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('verify-item').count(), 4, 'the restored four-item bill is visible');
    const billNumbers = await page.getByTestId('bill-item-number').allTextContents();
    assert.deepEqual(billNumbers, expected, 'bill rows use current-list sequence 01–04 despite IDs 05–08');
    const billRows = (await page.getByTestId('verify-item').allInnerTexts()).join('\n');
    assert.match(billRows, /燒賣/);
    assert.match(billRows, /豆腐/);
    const firstRow = await page.getByTestId('verify-item').first().boundingBox();
    await page.evaluate(top => window.scrollTo(0, Math.max(0, top - 160)), firstRow.y);
    await page.screenshot({ path: path.join(outputDir, 'item-display-numbering-mobile.png') });

    const claimPage = await context.newPage();
    claimPage.on('pageerror', error => pageErrors.push(error.message));
    const claimItems = items.map(({ id, name, nameEn, original }) => ({ id, name, nameEn, original }));
    const data = Buffer.from(JSON.stringify(claimItems)).toString('base64url');
    await claimPage.goto(`${base}claim.html#data=${data}`, { waitUntil: 'domcontentloaded' });
    await claimPage.locator('.item-id').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.deepEqual(await claimPage.locator('.item-id').allTextContents(), expected,
      'the friend claim page also numbers its four current items 01–04');
    await claimPage.screenshot({ path: path.join(outputDir, 'claim-page-numbering-mobile.png'), fullPage: true });

    const calculationPage = await context.newPage();
    calculationPage.on('pageerror', error => pageErrors.push(error.message));
    const calculationDraft = { ...draft, data: { ...draft.data, payer: '阿明', friendsReplies:
      '姓名：阿明\n認帳項目：\n01 燒賣：認帳份數 = 1\n03 牛肉飯：認帳份數 = 1\n\n──────────\n\n姓名：小華\n認帳項目：\n02 奶茶：認帳份數 = 1\n04 豆腐：認帳份數 = 1' } };
    await calculationPage.goto(base, { waitUntil: 'domcontentloaded' });
    await calculationPage.addInitScript(value => localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(value)), calculationDraft);
    await calculationPage.reload({ waitUntil: 'domcontentloaded' });
    await calculationPage.getByTestId('verify-item').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await calculationPage.getByTestId('claim-replies').inputValue(), calculationDraft.data.friendsReplies,
      'the test claims were restored into the reply field');
    await calculationPage.locator('button[data-step="3"]').click();
    await calculationPage.getByTestId('calculate-split').waitFor({ state: 'visible', timeout: 10000 });
    await calculationPage.waitForFunction(() => {
      const button = document.querySelector('[data-testid="calculate-split"]');
      return button && !button.disabled;
    }, null, { timeout: 10000 });
    assert.equal(await calculationPage.getByTestId('calculate-split').isEnabled(), true,
      'display-number replies are parsed into the stable internal IDs before calculation');
    await calculationPage.getByTestId('calculate-split').click();
    await calculationPage.getByTestId('results-step').waitFor({ state: 'visible', timeout: 15000 });
    const payableRows = await calculationPage.getByTestId('result-person-payable').allInnerTexts();
    assert.equal(payableRows.length, 2, 'both claimants have a calculated result');
    assert.match(payableRows.find(row => row.includes('阿明')) || '', /60/,
      'claims 01 and 03 map to IDs 05 and 07, totaling $60');
    assert.match(payableRows.find(row => row.includes('小華')) || '', /38/,
      'claims 02 and 04 map to IDs 06 and 08, totaling $38');

    const manualPage = await context.newPage();
    manualPage.on('pageerror', error => pageErrors.push(error.message));
    const emptyDraft = { schema: 1, data: { step: 1, items: [], nextClaimItemId: 5,
      claimItemIdVersion: 2, legacyClaimReviewRequired: false, friendsReplies: '',
      detectedCurrency: 'HKD', currency: 'HKD', readReceipt: false, manualClaimsEnabled: true } };
    await manualPage.goto(base, { waitUntil: 'domcontentloaded' });
    await manualPage.addInitScript(value => localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(value)), emptyDraft);
    await manualPage.reload({ waitUntil: 'domcontentloaded' });
    await manualPage.getByTestId('entry-method-choice').waitFor({ state: 'visible', timeout: 30000 });
    await manualPage.getByTestId('start-manual').click();
    await manualPage.getByTestId('item-name').first().fill(items[0].name);
    for (let index = 1; index < items.length; index++) {
      await manualPage.getByTestId('add-item').click();
      await manualPage.getByTestId('item-name').nth(index).fill(items[index].name);
    }
    const manualLabels = await manualPage.locator('label[for^="bill-item-"][for$="-name"]').allInnerTexts();
    const readdedInternalIds = await manualPage.getByTestId('item-name').evaluateAll(fields =>
      fields.map(field => field.id.match(/^bill-item-(\d+)-name$/)?.[1]));
    assert.deepEqual(manualLabels, expected.map(number => `編號 ${number} - 名稱`),
      'manually re-added items start their visible numbering at 01');
    assert.equal(await manualPage.getByTestId('manual-claim-example').innerText(), '姓名：阿明\n01 = 1',
      'the manual claim example uses the current display number rather than the internal ID');
    assert.deepEqual(readdedInternalIds, ['05', '06', '07', '08'],
      're-added item identity remains on its monotonic internal IDs 05–08');

    assert.deepEqual(pageErrors, [], 'no uncaught browser errors');
    console.log(JSON.stringify({
      billNumbers,
      claimPageNumbers: await claimPage.locator('.item-id').allTextContents(),
      settlementRows: payableRows,
      manualReaddedNumbers: manualLabels.map(label => label.match(/\d{2}/)?.[0]),
      readdedInternalIds,
      screenshots: [
        path.join(outputDir, 'item-display-numbering-mobile.png'),
        path.join(outputDir, 'claim-page-numbering-mobile.png')
      ],
      viewport: '390x844'
    }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
