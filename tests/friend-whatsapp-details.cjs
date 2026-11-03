'use strict';

// Local-only E2E: short-link creation and WhatsApp navigation are mocked; no live share is created or sent.
// BASE_URL=http://127.0.0.1:4192/ PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/friend-whatsapp-details.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4192/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');

function draft() {
  return {
    schema: 1,
    assetRevision: 'friend-whatsapp-detail-test',
    hasAssets: false,
    data: {
      step: 3,
      items: [
        { id: '01', name: '壽司飯糰', price: 130, total: 130, totalQty: 3, unit: '件' },
        { id: '02', name: '共享刺身盤', price: 140, total: 140, totalQty: null, unit: '份' }
      ],
      readReceipt: true,
      taxAmount: '0',
      discountAmount: '0',
      taxNote: '',
      receiptAdjustmentDetails: null,
      friendsReplies: '姓名：阿明\n01 = 1\n02 = 2\n姓名：小美\n01 = 1\n02 = 1\n姓名：阿強\n01 = 1\n02 = 3',
      payer: '阿明',
      detectedCurrency: 'JPY',
      currency: 'HKD',
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

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    let liveShareApiRequests = 0;
    page.on('request', request => {
      if (/\/api\/shares(?:\?|$)/.test(request.url())) liveShareApiRequests += 1;
    });
    await page.route('**/api/shares**', route => route.abort('blockedbyclient'));
    await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-04' })
    }));
    await page.goto(base + 'tests/README.md', { waitUntil: 'domcontentloaded' });
    await page.evaluate(data => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(data));
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
    }, draft());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 60000 });
    await page.getByTestId('calculate-split').waitFor({ state: 'visible' });
    await page.getByTestId('calculate-split').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });

    await page.evaluate(() => {
      const original = window.BillShareApi;
      Object.defineProperty(window, 'BillShareApi', {
        configurable: true,
        value: Object.freeze({
          ...original,
          createShortLink: async payload => {
            window.__friendShareMockPayload = JSON.parse(JSON.stringify(payload));
            return { shortUrl: 'https://share.example.test/f/mock-7-day', expiresAt: '2026-11-11T00:00:00.000Z' };
          }
        })
      });
      window.__friendWhatsAppOpenCalls = [];
      window.__friendWhatsAppNavigation = '';
      window.open = url => {
        window.__friendWhatsAppOpenCalls.push(String(url));
        return {
          closed: false,
          document: { title: '' },
          location: { replace: target => { window.__friendWhatsAppNavigation = String(target); } },
          opener: null,
          close() { this.closed = true; }
        };
      };
    });

    await page.getByTestId('create-friend-share-link').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="friend-share-whatsapp-status"]')?.textContent.includes('WhatsApp 已開啟'), null, { timeout: 15000 });
    const testState = await page.evaluate(() => ({
      opened: window.__friendWhatsAppOpenCalls,
      navigation: window.__friendWhatsAppNavigation,
      payload: window.__friendShareMockPayload,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    assert.deepEqual(testState.opened, ['about:blank'], 'the user gesture only preopens a blank tab before async link creation');
    assert.match(testState.navigation, /^https:\/\/wa\.me\/\?text=/, 'the prepared tab is directed to WhatsApp, not sent');
    assert.equal(testState.viewportWidth, 390);
    assert.ok(testState.scrollWidth <= testState.viewportWidth, 'the create/share UI has no horizontal overflow at 390px');
    assert.equal(liveShareApiRequests, 0, 'no request was sent to the live share Worker');
    assert.equal(testState.payload.bill.sourceCurrency, 'JPY');
    assert.equal(testState.payload.bill.currency, 'HKD');
    assert.equal(testState.payload.items.length, 2);

    const message = new URL(testState.navigation).searchParams.get('text');
    const expected = [
      '朋友埋單表（7日有效），揀你個名睇詳情：',
      '項目分攤（JPY）\n• 壽司飯糰：共 3 人分食｜阿明 1/3（¥43.33）；小美 1/3（¥43.33）；阿強 1/3（¥43.33）\n• 共享刺身盤：共 3 人分食｜阿明 1/3（¥46.67）；小美 1/6（¥23.33）；阿強 1/2（¥70）',
      '各人應付（HKD）：阿明 $4.05；小美 $3.00；阿強 $5.10',
      '全單結算總額：$12.15',
      'https://share.example.test/f/mock-7-day'
    ].join('\n\n');
    assert.equal(message, expected, `unexpected prefilled WhatsApp text:\n${message}`);
    assert.equal(await page.getByTestId('friend-share-open').getAttribute('href'), 'https://share.example.test/f/mock-7-day');
    assert.equal(failures.length, 0, `page errors: ${failures.join('; ')}`);
    console.log('PASS 390px WhatsApp prefill: exact source-currency item details, people counts, reduced fractions, per-person and final HKD totals, and link; mocked navigation only, no auto-send or live KV record.');
    console.log('\n--- Exact prefilled message ---\n' + message);
  } finally {
    if (context) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
