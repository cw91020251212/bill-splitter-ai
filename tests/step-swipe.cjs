'use strict';

const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This test only runs against a local server.');
}

const receiptJson = {
  items: [
    { name: '魚蛋', nameEn: 'Fish balls', original: '魚蛋', ja: '', price: 25, qty: 2, totalQty: 2, unit: '碗', total: 50 },
    { name: '奶茶', nameEn: 'Milk tea', original: '奶茶', ja: '', price: 18, qty: 1, totalQty: 1, unit: '杯', total: 18 }
  ],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 68
};

async function initialize(page) {
  await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
    localStorage.setItem('billSplitterLanguage', 'zh-HK');
    localStorage.setItem('billSplitterHistory', '[]');
  });
  await page.goto(base.toString(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible', timeout: 60000 });
}

async function swipe(page, selector, startX, startY, endX, endY) {
  await page.locator(selector).evaluate((target, points) => {
    const makeTouch = (x, y) => new Touch({
      identifier: 1,
      target,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pageX: x + window.scrollX,
      pageY: y + window.scrollY
    });
    const first = makeTouch(points.startX, points.startY);
    target.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [first],
      targetTouches: [first],
      changedTouches: [first]
    }));
    const last = makeTouch(points.endX, points.endY);
    target.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: [last]
    }));
  }, { startX, startY, endX, endY });
}

async function expectStep(page, step) {
  await page.waitForFunction(expected => document.querySelector('main[data-current-step]')?.dataset.currentStep === String(expected), step, { timeout: 10000 });
  assert.equal(await page.locator('main[data-current-step]').getAttribute('data-current-step'), String(step));
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('https://openrouter.ai/**', route => route.abort());
    await page.route('https://**/*.workers.dev/**', route => route.abort());
    await initialize(page);
    await expectStep(page, 1);

    await swipe(page, 'main[data-current-step]', 240, 360, 235, 260);
    await expectStep(page, 1);
    await swipe(page, '[data-testid="receipt-camera"]', 280, 360, 160, 360);
    await expectStep(page, 1);

    await swipe(page, 'main[data-current-step]', 280, 360, 170, 365);
    await expectStep(page, 2);
    await swipe(page, 'main[data-current-step]', 10, 360, 110, 360);
    await expectStep(page, 2);
    await swipe(page, 'main[data-current-step]', 280, 360, 170, 360);
    await expectStep(page, 2);
    await swipe(page, 'main[data-current-step]', 170, 360, 280, 365);
    await expectStep(page, 1);

    await page.getByTestId('toggle-receipt-text-import').click();
    const receiptDraft = page.getByTestId('receipt-text-draft');
    await receiptDraft.waitFor({ state: 'visible' });
    await swipe(page, '[data-testid="receipt-text-draft"]', 280, 560, 160, 560);
    await expectStep(page, 1);
    await receiptDraft.fill(JSON.stringify(receiptJson));
    await page.getByTestId('submit-receipt-text').click();
    await expectStep(page, 2);

    await swipe(page, 'main[data-current-step]', 280, 360, 170, 360);
    await expectStep(page, 3);
    await swipe(page, 'main[data-current-step]', 280, 360, 170, 360);
    await expectStep(page, 3);
    await swipe(page, 'main[data-current-step]', 170, 360, 280, 360);
    await expectStep(page, 2);

    await context.close();
    console.log('PASS step swipes: left advances, right returns, guards stay active, vertical/edge/control/form gestures are ignored.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
