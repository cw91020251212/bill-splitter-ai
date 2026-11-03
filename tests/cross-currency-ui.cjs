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
      page.on('pageerror', error => failures.push(`legacy active-draft page error: ${error.message}`));
      await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-03' })
      }));
      const staleDraft = draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [{ id: '01', name: '舊報告品項', price: 1000, total: 1000, totalQty: null, unit: '' }],
        replies: '姓名：阿明\n01 = 1'
      });
      staleDraft.data.step = 4;
      staleDraft.data.results = { personTotals: { '阿明': { total: 49.73 } }, currency: 'HKD', sourceCurrency: 'JPY', billTotal: 49.73 };
      await seed(page, staleDraft);
      assert.equal(await page.locator('[data-live-app] main').getAttribute('data-current-step'), '3');
      assert.equal(await page.getByTestId('final-summary-preview').count(), 0);
      assert.equal(await page.getByText('貨幣分帳方式已更新，請按「產生分帳報告」重新計算。').isVisible(), true);
      console.log('PASS stale active draft: old cross-currency results are not mislabelled; calculation is requested again.');
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
      assert.ok(report.includes(`¥1,000 JPY → 結算總額：$${expected} HKD`), `report must show the converted total using the displayed fetched rate; expected ${expected}, report: ${report}`);
      assert.ok(report.includes(`1 JPY = ${match[1]} HKD`), 'report must state the rate used');
      assert.ok(report.includes('Frankfurter'), 'report must identify its exchange-rate source');
      console.log(`PASS live JPY→HKD report: 1000 JPY → HK$${expected} at 1 JPY = ${match[1]} HKD`);
      await context.close();
    }

    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`source-first JPY→HKD page error: ${error.message}`));
      await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-03' })
      }));
      await seed(page, draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [
          { id: '01', name: '項目一', price: 1, total: 1, totalQty: null, unit: '' },
          { id: '02', name: '項目二', price: 1, total: 1, totalQty: null, unit: '' },
          { id: '03', name: '項目三', price: 1, total: 1, totalQty: null, unit: '' },
          { id: '04', name: '項目四', price: 1, total: 1, totalQty: null, unit: '' },
          { id: '05', name: '共享小食', price: 1, total: 1, totalQty: null, unit: '' }
        ],
        taxAmount: '1', discountAmount: '1',
        replies: '姓名：阿明\n01 = 1\n02 = 1\n05 = 1\n姓名：小美\n03 = 1\n04 = 1\n05 = 1'
      }));
      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.textContent.includes('Frankfurter'), null, { timeout: 20000 });
      const summary = await calculate(page);
      const detailed = await page.getByTestId('final-detail-preview').innerText();
      assert.match(summary, /原幣分帳總額：¥5 JPY → 結算總額：\$0\.23 HKD/, `all five JPY are aggregated before converting; got ${summary}`);
      assert.match(detailed, /項目小計（JPY）：¥5 JPY/);
      assert.match(detailed, /整單折扣（JPY）：−¥1 JPY/);
      assert.match(detailed, /稅／服務費（JPY）：¥1 JPY/);
      assert.match(detailed, /整單折扣分攤 −¥0\.5 JPY/);
      assert.match(detailed, /稅／服務費分攤 💲 ¥0\.5 JPY/);
      assert.match(detailed, /結算總額（HKD）：\$0\.23 HKD/);
      assert.match(detailed, /應付總額（HKD）/);
      assert.match(detailed, /¥0\.5 JPY\s*（1\/2 份比例）/, 'the shared item keeps its fractional JPY share in the detail report');

      await page.evaluate(() => { window.open = () => ({ opener: null }); });
      await page.getByTestId('open-detailed-table-preview').click();
      const preview = await page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterDetailTablePreviewV1') || 'null'));
      assert.equal(preview.version, 2, 'new local friend previews use the source-currency payload version');
      assert.equal(preview.bill.sourceCurrency, 'JPY');
      assert.equal(preview.bill.currency, 'HKD');
      assert.equal(preview.bill.itemsSubtotal, 5);
      assert.equal(preview.bill.discountAmount, 1);
      assert.equal(preview.bill.taxAmount, 1);
      assert.equal(preview.bill.sourceBillTotal, 5);
      assert.equal(preview.bill.billTotal, 0.23);
      assert.deepEqual(preview.participants.map(person => person.sourceTotal), [2.5, 2.5]);
      assert.deepEqual(preview.participants.map(person => person.subtotal), [2, 2]);
      assert.deepEqual(preview.participants.map(person => person.discount), [0.5, 0.5]);
      assert.deepEqual(preview.participants.map(person => person.tax), [0.5, 0.5]);
      assert.equal(preview.items.find(item => item.id === '05').shares.reduce((sum, share) => sum + share.amount, 0), 1);
      assert.deepEqual(preview.items.find(item => item.id === '05').shares.map(share => share.amount), [0.5, 0.5]);

      const friendPage = await context.newPage();
      friendPage.on('pageerror', error => failures.push(`source-first friend page error: ${error.message}`));
      await friendPage.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await friendPage.getByTestId('member-select').selectOption({ label: '小美' });
      assert.equal(await friendPage.locator('#total-label').innerText(), '你要埋單幾多（HKD）');
      assert.match(await friendPage.getByTestId('preview-grand-total').innerText(), /HK\$0\.(11|12)/);
      assert.equal(await friendPage.locator('#amount-heading').innerText(), '分攤金額（JPY）');
      const personalDetails = await friendPage.locator('#personal-details').innerText();
      assert.match(personalDetails, /JPY/);
      assert.match(personalDetails, /HKD/);
      assert.match(await friendPage.locator('[data-testid="personal-item-row"]').allInnerTexts().then(rows => rows.join('\n')), /¥0\.5/);
      const friendTotals = await friendPage.evaluate(() => JSON.parse(localStorage.getItem('billSplitterDetailTablePreviewV1'))
        .participants.map(person => person.total).reduce((sum, value) => sum + value, 0));
      assert.equal(Math.round(friendTotals * 100), 23, 'rounded individual settlement amounts add up to HK$0.23');
      console.log('PASS source-first JPY→HKD: item, discount, tax and per-person subtotal stay in JPY; final individual and bill totals settle in HKD with no per-item rounding drift.');

      const legacyPage = await context.newPage();
      legacyPage.on('pageerror', error => failures.push(`legacy v1 friend page error: ${error.message}`));
      await legacyPage.goto(new URL('claim.html', base).href, { waitUntil: 'domcontentloaded' });
      await legacyPage.evaluate(() => localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify({
        version: 1,
        bill: { date: '2026-11-03', payer: '阿明', currency: 'HKD', sourceCurrency: 'JPY', sourceTotal: 1000, billTotal: 1.25, paymentMethods: [] },
        participants: [{ name: '舊連結友人', total: 1.25, subtotal: 1.25, tax: 0, discount: 0 }],
        items: [{ id: '01', name: '舊版項目', sourceAmount: 1000, shares: [{ person: '舊連結友人', amount: 1.25, quantity: 1 }] }],
        adjustments: [], images: []
      })));
      await legacyPage.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await legacyPage.getByTestId('member-select').selectOption({ label: '舊連結友人' });
      assert.equal(await legacyPage.locator('#total-label').innerText(), '你要埋單幾多');
      assert.equal(await legacyPage.locator('#amount-heading').innerText(), '分攤金額');
      assert.equal(await legacyPage.getByTestId('preview-grand-total').innerText(), 'HK$1.25');
      assert.match(await legacyPage.locator('[data-testid="personal-item-row"]').first().innerText(), /HK\$1\.25/);
      console.log('PASS legacy v1 friend preview: retains settlement-currency item shares and totals.');
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
