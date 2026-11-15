'use strict';

// Local-only UI regression for user-facing calculation diagnostics.
// Run a local static server first, then:
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium BASE_URL=http://127.0.0.1:4178/ node tests/error-diagnostics-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');

const root = path.resolve(__dirname, '..');
const screenshotPath = process.env.SCREENSHOT_PATH || path.join(root, 'artifacts', 'error-diagnostic-phone-390x844.png');
const tailwind = zlib.gunzipSync(fs.readFileSync(path.join(root, 'tests/fixtures/tailwind-playcdn-3.4.17.js.gz'))).toString('utf8');
const failures = [];

function draft({ sourceCurrency = 'JPY', currency = 'HKD', discountAmount = '0', items, replies }) {
  return {
    schema: 1,
    assetRevision: 'error-diagnostic-test',
    hasAssets: false,
    data: {
      step: 3,
      claimItemIdVersion: 2,
      legacyClaimReviewRequired: false,
      items,
      readReceipt: true,
      taxAmount: '0',
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
      claimSession: null,
      claimInboxSeen: [],
      claimLinkShared: false
    }
  };
}

async function seed(page, record) {
  await page.goto(new URL('tests/README.md', base).href, { waitUntil: 'domcontentloaded' });
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

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  let contexts = [];
  try {
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`JPY→HKD failure case: ${error.message}`));
      let rateRequests = 0;
      await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: tailwind }));
      await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => {
        rateRequests += 1;
        if (rateRequests === 1) return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'temporarily unavailable' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-15' }) });
      });
      await page.route('https://openrouter.ai/**', route => route.abort());
      await page.route('https://*.workers.dev/**', route => route.abort());
      await seed(page, draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [{ id: '01', name: '拉麵', price: 1000, total: 1000, totalQty: null, unit: '' }],
        replies: '姓名：阿明\n01 = 1'
      }));

      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.innerText.includes('暫時未能取得'), null, { timeout: 20000 });
      assert.equal(await page.locator('[data-live-app] main').getAttribute('data-current-step'), '3', 'unavailable rate must block Step 4');
      assert.equal(await page.getByTestId('results-step').count(), 0, 'no report should be shown without a valid rate');
      assert.match(await page.getByTestId('exchange-rate-status').innerText(), /JPY → HKD/);
      assert.match(await page.getByTestId('status-compact-region').innerText(), /第 4 步未能產生：匯率未取得/);

      await page.getByTestId('status-bar-toggle').click();
      const dialog = page.getByTestId('status-detail-dialog');
      await dialog.waitFor({ state: 'visible' });
      const detail = await dialog.innerText();
      assert.match(detail, /未能提供有效的 JPY → HKD 匯率/);
      assert.match(detail, /沒有產生報告/);
      assert.match(detail, /重試匯率/);
      assert.doesNotMatch(detail, /可以產生分帳報告/, 'the diagnostic must not simultaneously say the report is ready');
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`PASS phone-size rate-failure diagnostic screenshot: ${screenshotPath}`);

      await dialog.getByRole('button', { name: /重試匯率/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.innerText.includes('1 JPY = 0.045 HKD'), null, { timeout: 20000 });
      assert.ok(rateRequests >= 2, 'retry action should request the exchange rate again');
      await page.getByTestId('calculate-split').click();
      await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
      const result = await page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1')).data.results);
      assert.equal(result.sourceCurrency, 'JPY');
      assert.equal(result.currency, 'HKD');
      assert.equal(result.sourceBillTotal, 1000);
      assert.equal(result.billTotal, 45, 'calculation stays unchanged: 1000 JPY × 0.045 = HK$45');
      assert.equal(result.personTotals['阿明'].total, 45);
      console.log('PASS retry resolves JPY→HKD, then produces the unchanged HK$45 result');
      await context.close();
      contexts = contexts.filter(item => item !== context);
    }

    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`general calculation error case: ${error.message}`));
      await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: tailwind }));
      await page.route('https://openrouter.ai/**', route => route.abort());
      await page.route('https://*.workers.dev/**', route => route.abort());
      await seed(page, draft({
        sourceCurrency: 'HKD', currency: 'HKD', discountAmount: '101',
        items: [{ id: '01', name: '茶', price: 100, total: 100, totalQty: null, unit: '' }],
        replies: '姓名：阿明\n01 = 1'
      }));
      await page.getByTestId('calculate-split').click();
      const alert = page.getByTestId('step-error');
      await alert.waitFor({ state: 'visible' });
      assert.match(await alert.innerText(), /折扣不可多於已分攤項目小計/);
      assert.equal(await page.locator('[data-live-app] main').getAttribute('data-current-step'), '3');
      await page.getByTestId('status-bar-toggle').click();
      const dialog = page.getByTestId('status-detail-dialog');
      await dialog.waitFor({ state: 'visible' });
      assert.match(await dialog.innerText(), /計算未能繼續/);
      assert.match(await dialog.innerText(), /折扣不可多於已分攤項目小計/);
      await dialog.getByRole('button', { name: /查看原因/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await alert.isVisible(), true, 'the diagnostic action should return the user to the inline error');
      assert.equal(await page.getByTestId('results-step').count(), 0);
      console.log('PASS generic calculation blocker is surfaced in the diagnostics panel with a return-to-error action');
      await context.close();
      contexts = contexts.filter(item => item !== context);
    }

    assert.deepEqual(failures, [], `unexpected browser errors: ${failures.join('; ')}`);
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
