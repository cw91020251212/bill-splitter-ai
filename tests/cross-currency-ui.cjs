'use strict';

// Run a local static server first. This test only writes to its isolated browser context.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/cross-currency-ui.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');

function draft({ sourceCurrency, currency, items, taxAmount = '0', discountAmount = '0', replies }) {
  return {
    schema: 1,
    assetRevision: 'cross-currency-test',
    hasAssets: false,
    data: {
      step: 3,
      items,
      readReceipt: true,
      taxAmount,
      discountAmount,
      taxNote: '',
      receiptAdjustmentDetails: null,
      friendsReplies: replies,
      payer: '阿明',
      detectedCurrency: sourceCurrency,
      currency,
      taxSplitMethod: 'proportional',
      paymentMethods: ['現金'],
      results: null,
      reconciliation: null,
      isSaved: false,
      includeReceiptImages: false,
      detailLang: 'zh',
      pendingReceiptShare: false,
      claimRoom: null,
      claimInboxSeen: [],
      claimLinkShared: true
    }
  };
}

async function seed(page, record) {
  await page.goto(base + 'tests/README.md', { waitUntil: 'domcontentloaded' });
  await page.evaluate(data => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(data));
    localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
    localStorage.setItem('billSplitterLanguage', 'zh-HK');
    localStorage.setItem('billSplitterHistory', '[]');
  }, record);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 60000 });
  await page.getByTestId('calculate-split').waitFor({ state: 'visible' });
}

async function calculate(page) {
  await page.getByTestId('calculate-split').click();
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 15000 });
  return page.getByTestId('final-summary-preview').innerText();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  try {
    {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`same-currency page error: ${error.message}`));
      await seed(page, draft({
        sourceCurrency: 'HKD', currency: 'HKD',
        items: [
          { id: '01', name: '項目一', price: 38.6, total: 38.6, totalQty: null, unit: '' },
          { id: '02', name: '項目二', price: 24.3, total: 24.3, totalQty: null, unit: '' }
        ],
        taxAmount: '4', discountAmount: '2',
        replies: '姓名：阿明\n01 = 1\n02 = 1'
      }));
      assert.equal(await page.getByTestId('source-currency').inputValue(), 'HKD');
      const report = await calculate(page);
      assert.match(report, /\$64\.90/, 'same-currency report must preserve 38.60 + 24.30 + 4.00 − 2.00');
      console.log('PASS same-currency total: HK$64.90');
      await context.close();
    }

    {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`JPY→HKD page error: ${error.message}`));
      await seed(page, draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [{ id: '01', name: '拉麵', price: 1000, total: 1000, totalQty: null, unit: '' }],
        replies: '姓名：阿明\n01 = 1'
      }));
      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.textContent.includes('Frankfurter'), null, { timeout: 20000 });
      const rateCard = await page.getByTestId('exchange-rate-status').innerText();
      const match = rateCard.match(/1 JPY = ([0-9.]+) HKD/);
      assert.ok(match, `visible JPY→HKD rate missing: ${rateCard}`);
      const actualRate = Number(match[1]);
      const report = await calculate(page);
      const expected = (Math.round((1000 * actualRate + Number.EPSILON) * 100) / 100).toFixed(2);
      assert.ok(report.includes(`¥1000 JPY → 結算總額：$${expected} HKD`), `report must show the converted total using the displayed fetched rate; expected ${expected}, report: ${report}`);
      assert.ok(report.includes(`1 JPY = ${match[1]} HKD`), 'report must state the rate used');
      assert.ok(report.includes('Frankfurter'), 'report must identify its exchange-rate source');
      console.log(`PASS live JPY→HKD report: 1000 JPY → HK$${expected} at 1 JPY = ${match[1]} HKD`);
      await context.close();
    }

    {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.route('https://api.frankfurter.dev/v2/rate/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test unavailable"}' }));
      page.on('pageerror', error => failures.push(`fetch-failure page error: ${error.message}`));
      await seed(page, draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [{ id: '01', name: '拉麵', price: 1000, total: 1000, totalQty: null, unit: '' }],
        replies: '姓名：阿明\n01 = 1'
      }));
      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.textContent.includes('暫時未能取得匯率'), null, { timeout: 15000 });
      await page.getByTestId('calculate-split').click();
      const blockedState = await page.evaluate(() => ({
        step: document.querySelector('[data-live-app] main')?.dataset.currentStep,
        reportExists: Boolean(document.querySelector('[data-testid="final-summary-preview"]')),
        statusText: document.querySelector('[data-testid="exchange-rate-status"]')?.textContent || ''
      }));
      assert.equal(blockedState.step, '3', 'calculation must stay on settings when the rate fetch fails');
      assert.equal(blockedState.reportExists, false, 'no settlement report may be generated without a rate');
      assert.match(blockedState.statusText, /暫時未能取得匯率/, 'the exchange-rate error must remain visible');
      console.log('PASS failed rate fetch: report remains blocked');
      await context.close();
    }

    assert.deepEqual(failures, [], failures.join('\n'));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
