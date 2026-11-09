'use strict';

// Local-only E2E: Worker calls and WhatsApp navigation are mocked; no live share is created or sent.
// BASE_URL=http://127.0.0.1:4192/ PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/friend-whatsapp-details.cjs
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const relay = require('../claim-relay.js');
const base = process.env.BASE_URL || 'http://127.0.0.1:4192/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');

const sessionId = 'A'.repeat(22);
const writeToken = 'B'.repeat(43);
const createdAt = Date.now();
const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
const claimRoom = relay.createRoom();
const itemPayload = Buffer.from(JSON.stringify([
  { id: '01', name: '壽司飯糰', totalQty: 3, unit: '件' },
  { id: '02', name: '共享刺身盤', totalQty: null, unit: '份' }
])).toString('base64url');
const correctedItemPayload = Buffer.from(JSON.stringify([
  { id: '01', name: '重新翻譯的壽司飯糰', totalQty: 3, unit: '件' },
  { id: '02', name: '共享刺身盤', totalQty: null, unit: '份' }
])).toString('base64url');
const claimUrl = new URL('./claim.html', base);
claimUrl.searchParams.set('lang', 'zh-HK');
claimUrl.searchParams.set('v', 'v114-ocr-random-router-option');
claimUrl.searchParams.set('session', sessionId);
const claimMetadata = {
  title: '週末聚餐', createdAt, expiresAt, customName: '週末聚餐', expiryDays: '7'
};
claimUrl.hash = relay.buildHash(itemPayload, claimRoom, claimMetadata);
const staleLink = claimUrl.href;
const correctedUrl = new URL(staleLink);
correctedUrl.hash = relay.buildHash(correctedItemPayload, claimRoom, claimMetadata);
const expectedCorrectedLink = correctedUrl.href;

function draft() {
  return {
    schema: 1,
    assetRevision: 'friend-whatsapp-detail-test',
    hasAssets: false,
    data: {
      step: 3,
      items: [
        { id: '01', name: '重新翻譯的壽司飯糰', price: 130, total: 130, totalQty: 3, unit: '件' },
        { id: '02', name: '共享刺身盤', price: 140, total: 140, totalQty: null, unit: '份' }
      ],
      readReceipt: true,
      taxAmount: '0', discountAmount: '0', taxNote: '', receiptAdjustmentDetails: null,
      friendsReplies: '姓名：阿明\n01 = 1\n02 = 2\n姓名：小美\n01 = 1\n02 = 1\n姓名：阿強\n01 = 1\n02 = 3',
      payer: '阿明', detectedCurrency: 'JPY', currency: 'HKD', taxSplitMethod: 'proportional',
      paymentMethods: ['現金'], results: null, reconciliation: null, isSaved: false,
      claimRoom: null, claimActivityName: '週末聚餐', claimExpiryDays: '7',
      claimLinkMeta: { title: '週末聚餐', createdAt, expiresAt, customName: '週末聚餐', expiryDays: '7' },
      claimSession: { id: sessionId, writeToken, expiresAt, ttlDays: '7', link: staleLink },
      claimInboxSeen: [], claimLinkShared: true
    }
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let context;
  const failures = [];
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    const interceptedShareApiRequests = [];
    const failedShareApiRequests = [];
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/api/shares/')) {
        failedShareApiRequests.push(`${request.method()} ${url.pathname}: ${request.failure()?.errorText || 'failed'}`);
      }
    });
    // Wrap the API assignment before bill-share-api.js and the app initialize.
    // This avoids startup calls escaping into cross-origin route.fulfill/CORS.
    await page.addInitScript(() => {
      let apiValue = null;
      let claimMembers = [];
      window.__published = null;
      Object.defineProperty(window, 'BillShareApi', {
        configurable: true,
        enumerable: true,
        get: () => apiValue,
        set: api => {
          apiValue = Object.freeze({
            ...api,
            createSession: async () => { throw new Error('A prior activity session should be reused, not recreated.'); },
            setupClaimProtection: async (_id, _token, members) => {
              claimMembers = Array.isArray(members) ? members : [];
              return { enabled: true, claimSecurity: 'password', members: claimMembers };
            },
            getClaimInbox: async (_id, _token, cursor = 0) => ({ enabled: true, updates: [], members: claimMembers, cursor }),
            publishSession: async (id, token, payload) => {
              window.__published = { id, token, payload: JSON.parse(JSON.stringify(payload)) };
              return { id, status: 'ready' };
            }
          });
        }
      });
    });
    await page.route('**/api/shares**', route => {
      const request = route.request();
      const url = new URL(request.url());
      interceptedShareApiRequests.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    });
    await page.route('https://api.frankfurter.dev/v2/rate/jpy/hkd', route => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ base: 'JPY', quote: 'HKD', rate: 0.045, date: '2026-11-04' })
    }));
    await page.route('https://ntfy.sh/**', route => route.abort('blockedbyclient'));
    await page.goto(base + 'tests/README.md', { waitUntil: 'domcontentloaded' });
    await page.evaluate(data => {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(data));
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
    }, draft());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 60000 });

    await page.evaluate(({ expectedCorrectedLink, sessionId, writeToken }) => {
      window.__published = null;
      window.__expectedLink = expectedCorrectedLink;
      window.__expectedSessionId = sessionId;
      window.__expectedToken = writeToken;
      window.__whatsappCalls = [];
      window.open = url => { window.__whatsappCalls.push(String(url)); return { opener: null }; };
      document.execCommand = command => {
        if (command !== 'copy') return false;
        window.__copiedLink = document.activeElement?.value || '';
        return true;
      };
    }, { expectedCorrectedLink, sessionId, writeToken });

    await page.getByTestId('calculate-split').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 20000 });
    try {
      await page.waitForFunction(() => document.querySelector('[data-testid="friend-share-ready"]')?.textContent.includes('已更新'), null, { timeout: 15000 });
    } catch (error) {
      const debug = await page.evaluate(() => ({
        step: document.querySelector('[data-live-app] main')?.dataset.currentStep,
        published: window.__published,
        sync: document.querySelector('[data-testid="same-link-sync-status"]')?.innerText,
        shareCard: document.querySelector('[data-testid="friend-share-ready"]')?.innerText,
        alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.innerText),
        statuses: [...document.querySelectorAll('[role="status"]')].map(e => e.innerText),
        pageTail: document.body.innerText.slice(-900)
      }));
      console.error('DEBUG friend-share sync:', JSON.stringify(debug));
      console.error('DEBUG blocked share API requests:', JSON.stringify(interceptedShareApiRequests));
      console.error('DEBUG failed share API requests:', JSON.stringify(failedShareApiRequests));
      throw error;
    }
    assert.match(await page.getByTestId('same-link-sync-status').innerText(), /結果已更新/);
    const state = await page.evaluate(() => ({
      published: window.__published,
      link: document.querySelector('[data-testid="friend-share-open"]')?.href,
      title: document.querySelector('[data-testid="friend-network-option"] h3')?.textContent,
      width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth
    }));
    assert.equal(state.published.id, sessionId, 'result is published to the existing session');
    assert.equal(state.published.token, writeToken, 'organizer uses the local write token');
    assert.notEqual(state.link, staleLink, 'the share URL hash refreshes after successful OCR correction');
    assert.equal(new URL(state.link).searchParams.get('session'), sessionId, 'the original session is retained');
    assert.equal(state.link, expectedCorrectedLink, 'only the item data hash changes; room and link metadata stay stable');
    const refreshedHash = new URLSearchParams(new URL(state.link).hash.slice(1));
    const refreshedItems = JSON.parse(Buffer.from(refreshedHash.get('data'), 'base64url').toString('utf8'));
    assert.equal(refreshedItems[0].name, '重新翻譯的壽司飯糰');
    assert.equal(refreshedHash.get('room'), claimRoom.topic, 'the encrypted reply room is preserved');
    assert.equal(refreshedHash.get('title'), '週末聚餐');
    assert.equal(state.title, '認帳與結果共用一條連結');
    assert.equal(state.width, 390);
    assert.ok(state.scrollWidth <= state.width, 'no horizontal overflow at 390px');
    assert.equal(state.published.payload.bill.sourceCurrency, 'JPY');
    assert.equal(state.published.payload.bill.currency, 'HKD');
    assert.equal(state.published.payload.items.length, 2);
    assert.equal(state.published.payload.items[0].name, '重新翻譯的壽司飯糰', 'the published session also contains the corrected OCR name');
    assert.deepEqual(interceptedShareApiRequests, [], 'all organizer share API calls are mocked before startup; no Worker request is sent');
    assert.deepEqual(failedShareApiRequests, [], 'no share API request fails through the browser network layer');

    await page.getByTestId('friend-whatsapp-share').click();
    const waUrl = await page.evaluate(() => window.__whatsappCalls[0]);
    assert.equal(new URL(waUrl).searchParams.get('text'), `同一條認帳及結果連結\n${state.link}`);
    await page.getByTestId('copy-friend-share-link').click();
    assert.equal(await page.evaluate(() => window.__copiedLink), state.link);
    assert.equal(failures.length, 0, `page errors: ${failures.join('; ')}`);

    const claimPage = await context.newPage();
    claimPage.on('pageerror', error => failures.push(error.message));
    const serverNow = Date.now();
    const authoritativeExpiry = serverNow + 7 * 24 * 60 * 60 * 1000;
    await claimPage.addInitScript(() => {
      const realDateNow = Date.now.bind(Date);
      Date.now = () => realDateNow() + 30 * 24 * 60 * 60 * 1000;
    });
    await claimPage.route('https://bill-splitter-share.cw9102025.workers.dev/api/shares/**', route => route.fulfill({
      status: 202,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending', serverNow: new Date(serverNow).toISOString(), expiresAt: new Date(authoritativeExpiry).toISOString() })
    }));
    await claimPage.goto(state.link, { waitUntil: 'domcontentloaded' });
    await claimPage.waitForFunction(() => document.querySelector('#submit-dock')?.hidden === false, null, { timeout: 10000 });
    assert.match(await claimPage.locator('body').innerText(), /重新翻譯的壽司飯糰/, 'friends see the corrected name on the refreshed link');
    const clockState = await claimPage.evaluate(() => ({
      dockHidden: document.querySelector('#submit-dock').hidden,
      expiredHidden: document.querySelector('#expired-panel').hidden,
      countdown: document.querySelector('#expiry-countdown').textContent,
      deviceNow: Date.now()
    }));
    assert.ok(clockState.deviceNow - serverNow > 29 * 24 * 60 * 60 * 1000, 'the test device clock is intentionally more than 29 days ahead');
    assert.equal(clockState.dockHidden, false, 'the form is open according to server time, despite a device clock 30 days ahead');
    assert.equal(clockState.expiredHidden, true, 'the link is not falsely marked expired by the device clock');
    assert.match(clockState.countdown, /7日/, 'the countdown is based on Worker serverNow');
    assert.equal(failures.length, 0, `page errors: ${failures.join('; ')}`);
    console.log('PASS 390px: same-link publishing and sharing; claim form uses Worker server time even when device clock is 30 days ahead.');
  } finally {
    if (context) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
