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
  if (!await page.getByTestId('final-summary-preview').count()) {
    await page.getByTestId('report-fallback-options').getByRole('button').click();
  }
  await page.getByTestId('final-summary-preview').waitFor({ state: 'visible' });
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
      assert.ok(report.includes(`¥1,000 JPY → $${expected} HKD`), `report must show the converted total using the displayed fetched rate; expected ${expected}, report: ${report}`);
      const detailed = await page.getByTestId('final-detail-preview').innerText();
      assert.ok(detailed.includes(`1 JPY = ${match[1]} HKD`), 'detail must state the rate used');
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
      assert.match(summary, /¥5 JPY → \$0\.23 HKD/, `all five JPY are aggregated before converting; got ${summary}`);
      assert.match(detailed, /項目（JPY）/);
      assert.match(detailed, /折扣：−¥0\.5/);
      assert.match(detailed, /稅費：\+¥0\.5/);
      assert.match(detailed, /應付：\$0\.(11|12)/);
      assert.match(detailed, /1 JPY = 0\.045 HKD/);
      assert.match(detailed, /共享小食 — 1\/2份 — ¥0\.50/, 'the shared item keeps its fractional JPY share in the detail report');

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
        bill: { date: '2026-11-03', payer: '阿明', currency: 'HKD', sourceCurrency: 'JPY', sourceTotal: 1500, billTotal: 1.5, paymentMethods: [] },
        participants: [
          { name: '舊連結友人', total: 0.5, subtotal: 0.5, tax: 0, discount: 0 },
          { name: '小美', total: 0.25, subtotal: 0.25, tax: 0, discount: 0 },
          { name: '阿強', total: 0.75, subtotal: 0.75, tax: 0, discount: 0 }
        ],
        items: [{ id: '01', name: '舊版項目', quantity: 6, unit: '件', sourceAmount: 1500, allocatedAmount: 1.5, shares: [
          { person: '舊連結友人', amount: 0.5, quantity: 2, unit: '件' },
          { person: '小美', amount: 0.25, quantity: 1, unit: '件' },
          { person: '阿強', amount: 0.75, quantity: 3, unit: '件' }
        ] }],
        adjustments: [], images: []
      })));
      await legacyPage.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await legacyPage.getByTestId('member-select').selectOption({ label: '舊連結友人' });
      assert.equal(await legacyPage.locator('#total-label').innerText(), '你要埋單幾多');
      assert.equal(await legacyPage.locator('#amount-heading').innerText(), '分攤金額');
      assert.equal(await legacyPage.getByTestId('preview-grand-total').innerText(), 'HK$0.50');
      const legacyRow = await legacyPage.locator('[data-testid="personal-item-row"]').first().innerText();
      assert.match(legacyRow, /共 3 人分食，你分 1\/3 份/);
      assert.match(legacyRow, /HK\$0\.50/);
      console.log('PASS legacy v1 friend preview: recovers three diners and 2/6 → 1/3 from saved shares; settlement currency remains HKD.');

      const legacyV2Page = await context.newPage();
      legacyV2Page.on('pageerror', error => failures.push(`legacy v2 friend page error: ${error.message}`));
      await legacyV2Page.goto(new URL('claim.html', base).href, { waitUntil: 'domcontentloaded' });
      await legacyV2Page.evaluate(() => localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify({
        version: 2,
        bill: { date: '2026-11-03', payer: '阿明', currency: 'HKD', sourceCurrency: 'JPY', sourceTotal: 270, billTotal: 12.15, itemsSubtotal: 270, paymentMethods: [] },
        participants: [
          { name: '阿明', total: 4.05, sourceTotal: 90, subtotal: 90, tax: 0, discount: 0 },
          { name: '小美', total: 4.95, sourceTotal: 110, subtotal: 110, tax: 0, discount: 0 },
          { name: '阿強', total: 3.15, sourceTotal: 70, subtotal: 70, tax: 0, discount: 0 }
        ],
        items: [
          { id: '01', name: '舊版三人平分', quantity: 3, unit: '件', sourceAmount: 130, allocatedAmount: 130, shares: [
            { person: '阿明', quantity: 1, unit: '件', amount: 130 / 3 },
            { person: '小美', quantity: 1, unit: '件', amount: 130 / 3 },
            { person: '阿強', quantity: 1, unit: '件', amount: 130 / 3 }
          ] },
          { id: '02', name: '舊版不等分 2/6', quantity: 6, unit: '件', sourceAmount: 140, allocatedAmount: 140, shares: [
            { person: '阿明', quantity: 2, unit: '件', amount: 140 * 2 / 6 },
            { person: '小美', quantity: 1, unit: '件', amount: 140 / 6 },
            { person: '阿強', quantity: 3, unit: '件', amount: 70 }
          ] }
        ],
        adjustments: [], images: []
      })));
      await legacyV2Page.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await legacyV2Page.getByTestId('member-select').selectOption({ label: '阿明' });
      const legacyV2Rows = await legacyV2Page.locator('[data-testid="personal-item-row"]').allInnerTexts();
      assert.match(legacyV2Rows[0], /共 3 人分食，你分 1\/3 份/);
      assert.match(legacyV2Rows[1], /共 3 人分食，你分 1\/3 份/);
      assert.match(legacyV2Rows[0], /¥43\.333333/);
      assert.match(legacyV2Rows[1], /¥46\.666667/);
      console.log('PASS legacy v2 friend preview: three-person equal split and saved 2/6 share render as 1/3 without new metadata.');

      const incompletePage = await context.newPage();
      await incompletePage.goto(new URL('claim.html', base).href, { waitUntil: 'domcontentloaded' });
      await incompletePage.evaluate(() => localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify({
        version: 2,
        bill: { payer: '阿明', currency: 'HKD', sourceCurrency: 'JPY', billTotal: 1 },
        participants: [{ name: '阿明', total: 0.5 }],
        items: [{ id: '01', name: '缺少一位人名', sourceAmount: 20, shares: [
          { person: '阿明', quantity: 1, amount: 10 },
          { person: '', quantity: 1, amount: 10 }
        ] }],
        adjustments: [], images: []
      })));
      await incompletePage.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await incompletePage.getByTestId('member-select').selectOption({ label: '阿明' });
      const incompleteRow = await incompletePage.locator('[data-testid="personal-item-row"]').first().innerText();
      assert.match(incompleteRow, /你分 1\/2 份/);
      assert.doesNotMatch(incompleteRow, /共 1 人分食/);
      console.log('PASS incomplete legacy payload: reports the recoverable fraction but does not guess diner count.');
      await context.close();
    }

    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`portion label page error: ${error.message}`));
      await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-03' })
      }));
      await seed(page, draft({
        sourceCurrency: 'JPY', currency: 'HKD',
        items: [
          { id: '01', name: '實際件數 130 円', price: 130, total: 130, totalQty: 3, unit: '件' },
          { id: '02', name: '比例分攤 140 円（2/5）', price: 140, total: 140, totalQty: null, unit: '件' },
          { id: '03', name: '比例分攤 140 円（2/6）', price: 140, total: 140, totalQty: null, unit: '件' },
          { id: '04', name: '原算法三人平均 90 円', price: 90, total: 90, totalQty: null, unit: '' }
        ],
        replies: '姓名：阿明\n01 = 1件\n02 = 2件\n03 = 2件\n04 = 1\n姓名：小美\n01 = 2件\n02 = 3件\n03 = 1件\n04 = 1\n姓名：阿強\n03 = 3件\n04 = 1'
      }));
      await page.waitForFunction(() => document.querySelector('[data-testid="exchange-rate-status"]')?.textContent.includes('Frankfurter'), null, { timeout: 20000 });
      const summary = await calculate(page);
      assert.match(summary, /¥500 JPY → \$22\.50 HKD/);
      await page.evaluate(() => { window.open = () => ({ opener: null }); });
      await page.getByTestId('open-detailed-table-preview').click();
      const preview = await page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterDetailTablePreviewV1') || 'null'));
      const selectedShares = preview.items.map(item => item.shares.find(share => share.person === '阿明'));
      assert.deepEqual(selectedShares.map(share => [share.quantity, share.allocationTotal, share.isActualUnit]), [[1, 3, true], [2, 5, false], [2, 6, false], [1, 3, false]]);
      assert.deepEqual(selectedShares.map(share => Number(share.amount.toFixed(6))), [43.333333, 56, 46.666667, 30]);

      const friendPage = await context.newPage();
      friendPage.on('pageerror', error => failures.push(`portion label friend page error: ${error.message}`));
      await friendPage.goto(new URL('detailed-view.html', base).href, { waitUntil: 'domcontentloaded' });
      await friendPage.getByTestId('member-select').selectOption({ label: '阿明' });
      const rows = await friendPage.locator('[data-testid="personal-item-row"]').allInnerTexts();
      assert.match(rows[0], /共 2 人分食，你分 1\/3 份/);
      assert.match(rows[0], /¥43\.333333/);
      assert.match(rows[1], /共 2 人分食，你分 2\/5 份/);
      assert.match(rows[1], /¥56/);
      assert.match(rows[2], /共 3 人分食，你分 1\/3 份/);
      assert.match(rows[2], /¥46\.666667/);
      assert.match(rows[3], /共 3 人分食，你分 1\/3 份/);
      assert.match(rows[3], /¥30/);
      assert.equal(await friendPage.locator('#item-heading').innerText(), '項目／分食比例');
      assert.equal(await friendPage.locator('#total-label').innerText(), '你要埋單幾多（HKD）');
      assert.match(await friendPage.getByTestId('preview-grand-total').innerText(), /HK\$7\.92/);
      assert.equal(await friendPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'fraction labels fit the 390px mobile viewport');
      console.log('PASS 390px friend portions: original 3-person equal split, 2/6 reduced to 1/3, distinct diner count, JPY rows and HKD payable all correct.');
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
