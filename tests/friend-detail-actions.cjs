'use strict';

// Local-only UI regression. Run a local static server first.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium BASE_URL=http://127.0.0.1:4194/ node tests/friend-detail-actions.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4194/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');

const detailPayload = {
  version: 2,
  bill: {
    date: '2026-11-04', payer: 'ellie', currency: 'HKD', sourceCurrency: 'JPY',
    exchangeRate: 0.0497, sourceTotal: 1154, sourceBillTotal: 1154, billTotal: 57.34,
    paymentMethods: ['轉數快 (FPS)', 'Alipay', '現金']
  },
  participants: [
    { name: 'wai', total: 57.34, subtotal: 1154, sourceTotal: 1154, tax: 0, discount: 0 },
    { name: 'ellie', total: 0, subtotal: 0, sourceTotal: 0, tax: 0, discount: 0 }
  ],
  items: [
    { id: '01', name: '壽司飯糰', quantity: 3, unit: '件', sourceAmount: 130, allocatedAmount: 130, original: '鮭魚飯', ja: '鮭魚飯', shares: [
      { person: 'wai', amount: 130 / 3, quantity: 1, allocationTotal: 3 },
      { person: 'ellie', amount: 260 / 3, quantity: 2, allocationTotal: 3 }
    ] },
    { id: '02', name: '可可 500ml', quantity: 6, unit: '份', sourceAmount: 140, allocatedAmount: 140, original: 'ココア', shares: [
      { person: 'wai', amount: 140 / 3, quantity: 2, allocationTotal: 6 },
      { person: 'ellie', amount: 280 / 3, quantity: 4, allocationTotal: 6 }
    ] },
    { id: '03', name: '橙汁', quantity: 1, unit: '杯', sourceAmount: 498, allocatedAmount: 498, original: 'オレンジジュース', shares: [
      { person: 'wai', amount: 498, quantity: 1, allocationTotal: 1 }
    ] },
    { id: '04', name: '咖啡拿鐵', quantity: 1, unit: '杯', sourceAmount: 386, allocatedAmount: 386, original: 'カフェラテ', shares: [
      { person: 'wai', amount: 386, quantity: 1, allocationTotal: 1 }
    ] }
  ],
  adjustments: [],
  images: []
};

function claimUrl() {
  const items = [{ id: '01', name: '咖啡拿鐵', nameEn: 'Cafe latte', original: 'カフェラテ', totalQty: 1, unit: '杯' }];
  const token = Buffer.from(JSON.stringify(items)).toString('base64url');
  const topic = 'bs' + 'q'.repeat(22);
  const key = 'A'.repeat(43);
  return `${base}claim.html#data=${token}&room=${topic}&k=${key}`;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  try {
    const detailContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await detailContext.addInitScript(() => {
      window.__copyResults = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__copyResults.push(String(value)); } }
      });
      document.execCommand = command => {
        if (command !== 'copy') return false;
        window.__copyResults.push(String(document.activeElement?.value || ''));
        return true;
      };
    });
    const detailPage = await detailContext.newPage();
    detailPage.on('pageerror', error => failures.push(`detail page error: ${error.message}`));
    await detailPage.route('**/api/shares**', route => route.abort('blockedbyclient'));
    await detailPage.goto(`${base}tests/README.md`, { waitUntil: 'domcontentloaded' });
    await detailPage.evaluate(data => {
      localStorage.clear();
      localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify(data));
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
    }, detailPayload);
    await detailPage.goto(`${base}detailed-view.html`, { waitUntil: 'domcontentloaded' });
    await detailPage.getByTestId('member-select').selectOption({ label: 'wai' });

    assert.equal(await detailPage.getByTestId('preview-grand-total').innerText(), 'HK$57.34');
    if (process.env.SCREENSHOT_PATH) await detailPage.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    await detailPage.getByTestId('copy-payable').click();
    assert.deepEqual(await detailPage.evaluate(() => window.__copyResults), ['57.34'], 'clipboard receives only the numeric amount');
    assert.equal(await detailPage.getByTestId('copy-payable').innerText(), '已複製');

    await detailPage.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('billSplitterDetailTablePreviewV1'));
      data.participants[0].total = 1234.5;
      localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify(data));
    });
    await detailPage.goto(`${base}detailed-view.html?copy-amount-format-test=1`, { waitUntil: 'domcontentloaded' });
    await detailPage.getByTestId('member-select').selectOption({ label: 'wai' });
    assert.equal(await detailPage.getByTestId('preview-grand-total').innerText(), 'HK$1,234.50');
    await detailPage.getByTestId('copy-payable').click();
    const copiedLargeAmount = await detailPage.evaluate(() => window.__copyResults);
    assert.deepEqual(copiedLargeAmount, ['1234.50'], 'grouping comma and currency are omitted while decimals remain');
    assert.match(copiedLargeAmount[0], /^\d+(?:\.\d+)?$/, 'clipboard contains only digits and an optional decimal point');

    const paymentCardStyle = await detailPage.getByTestId('payment-instructions').evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderColor: style.borderColor, borderWidth: style.borderTopWidth,
        recipientSize: getComputedStyle(document.getElementById('payment-recipient')).fontSize };
    });
    assert.deepEqual(paymentCardStyle, {
      background: 'rgb(255, 249, 232)', borderColor: 'rgb(104, 118, 108)', borderWidth: '1px', recipientSize: '24px'
    });
    assert.equal(await detailPage.locator('#payment-recipient').innerText(), 'ellie');

    const borderAudit = await detailPage.evaluate(() => {
      const read = (selector, widthProperty, colorProperty) => {
        const style = getComputedStyle(document.querySelector(selector));
        return { width: style[widthProperty], color: style[colorProperty] };
      };
      return {
        outerCards: ['.items-card', '.receipt-card', '#payment-instructions', '#personal-breakdown', '.paid-notice-card', '.member-gate', '.optional']
          .map(selector => [selector, read(selector, 'borderTopWidth', 'borderTopColor')]),
        totalCard: read('#friend-amount-summary', 'borderTopWidth', 'borderTopColor'),
        headingSeparator: read('.items-card .card-heading', 'borderBottomWidth', 'borderBottomColor'),
        rowSeparator: read('#item-rows tr:nth-child(2) td', 'borderTopWidth', 'borderTopColor'),
        detailSeparator: read('#personal-details dt', 'borderTopWidth', 'borderTopColor'),
        receiptPlaceholder: read('#receipt-content .photo-placeholder', 'borderTopWidth', 'borderTopColor')
      };
    });
    for (const [selector, style] of borderAudit.outerCards) {
      assert.deepEqual(style, { width: '1px', color: 'rgb(104, 118, 108)' }, `${selector} uses a dark gray-green 1px outline`);
    }
    assert.deepEqual(borderAudit.totalCard, { width: '1px', color: 'rgb(19, 88, 55)' }, 'payable card keeps its existing dark 1px outline');
    for (const [name, style] of Object.entries({ heading: borderAudit.headingSeparator, row: borderAudit.rowSeparator, detail: borderAudit.detailSeparator })) {
      assert.deepEqual(style, { width: '1px', color: 'rgb(154, 166, 156)' }, `${name} separator uses a visible 1px gray-green line`);
    }
    assert.deepEqual(borderAudit.receiptPlaceholder, { width: '1px', color: 'rgb(104, 118, 108)' }, 'receipt placeholder outline is 1px and visible');

    const itemDetails = detailPage.locator('#item-rows details.item-details');
    assert.equal(await itemDetails.count(), 4);
    assert.equal(await itemDetails.evaluateAll(elements => elements.every(element => !element.open)), true);
    const expandButton = detailPage.getByTestId('toggle-all-item-details');
    await expandButton.click();
    assert.equal(await itemDetails.evaluateAll(elements => elements.every(element => element.open)), true, 'one tap expands all item details');
    assert.equal(await expandButton.innerText(), '收起全部明細');
    assert.equal(await expandButton.getAttribute('aria-expanded'), 'true');
    await expandButton.click();
    assert.equal(await itemDetails.evaluateAll(elements => elements.every(element => !element.open)), true, 'second tap collapses all item details');
    assert.equal(await expandButton.innerText(), '展開全部明細');
    assert.equal(await detailPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'detail page fits the 390px viewport');
    console.log('PASS 390px friend detail: copy clipboard is numeric-only (1234.50), dark 1px outlines/dividers, payment card and detail toggle unchanged, no overflow.');
    await detailContext.close();

    const claimContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const claimPage = await claimContext.newPage();
    claimPage.on('pageerror', error => failures.push(`claim page error: ${error.message}`));
    let ntfyRequests = 0;
    claimPage.on('request', request => { if (/^https:\/\/ntfy\.sh\//.test(request.url())) ntfyRequests += 1; });
    await claimPage.route('https://ntfy.sh/**', route => route.abort('blockedbyclient'));
    await claimPage.goto(claimUrl(), { waitUntil: 'domcontentloaded' });
    await claimPage.waitForFunction(() => !document.getElementById('claim-content')?.hidden, null, { timeout: 10000 });
    await claimPage.evaluate(() => {
      window.__publishedClaims = [];
      window.ClaimRelay = {
        ...window.ClaimRelay,
        publishClaim: async (room, payload) => {
          window.__publishedClaims.push({ room, payload: JSON.parse(JSON.stringify(payload)) });
          return { ok: true };
        }
      };
    });
    const nameInput = claimPage.locator('#person-name');
    const quantityInput = claimPage.locator('.qty-input').first();
    const submitButton = claimPage.locator('#submit-button');
    await nameInput.fill('阿明');
    await quantityInput.fill('1');
    assert.equal(await submitButton.isEnabled(), true, 'complete reply enables submit');
    await submitButton.click();
    await claimPage.waitForFunction(() => document.getElementById('submit-status')?.textContent.includes('如需更新'), null, { timeout: 10000 });
    assert.equal(await submitButton.isDisabled(), true, 'successful reply becomes disabled');
    assert.equal(await submitButton.evaluate(element => getComputedStyle(element).opacity), '0.45', 'disabled button returns to faded styling');
    await submitButton.evaluate(element => element.click());
    assert.equal(await claimPage.evaluate(() => window.__publishedClaims.length), 1, 'same reply cannot be submitted again');
    assert.match(await claimPage.locator('#submit-status').innerText(), /先更改認帳內容/);

    await quantityInput.fill('2');
    await claimPage.waitForFunction(() => !document.getElementById('submit-button')?.disabled, null, { timeout: 5000 });
    assert.equal(await submitButton.evaluate(element => getComputedStyle(element).opacity), '1', 'a changed reply restores the active button');
    assert.equal(await claimPage.locator('#submit-status').innerText(), '', 'editing clears the submitted status');
    await submitButton.click();
    await claimPage.waitForFunction(() => window.__publishedClaims?.length === 2, null, { timeout: 10000 });
    assert.equal(await submitButton.isDisabled(), true, 'updated reply also locks after success');
    assert.equal(ntfyRequests, 0, 'no ntfy network request was sent');
    assert.equal(await claimPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'claim page fits the 390px viewport');
    assert.deepEqual(failures, [], `browser errors: ${failures.join('; ')}`);
    console.log('PASS 390px claim submit: mock submit fades/disables; unchanged click is ignored; editing re-enables; edited reply submits once and locks again; no network send.');
    await claimContext.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
