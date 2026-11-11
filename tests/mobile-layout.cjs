'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This test only runs against a local server.');
}
const outputDir = process.env.TEST_OUTPUT_DIR || '/tmp/r132-restored-r127-ui';
const expectedSteps = ['上載睇單', '各自認帳', '分帳運算', '最終結果'];
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

async function assertNoOverflow(page, width, label) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth, null, { timeout: 5000 });
  await page.waitForTimeout(100);
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(size.viewport, width, `${label}: requested viewport width`);
  assert.ok(size.document <= width && size.body <= width, `${label}: no horizontal overflow (${JSON.stringify(size)})`);
}

async function assertOriginalFirstStep(page, width, height) {
  const label = `${width}×${height}`;
  const nav = page.locator('.step-nav');
  assert.equal(await nav.isVisible(), true, `${label}: original four-step navigation is visible`);
  const navInfo = await nav.locator('button[data-step]').evaluateAll(nodes => nodes.map(node => ({
    step: node.dataset.step,
    label: node.innerText.replace(/^\d+\s*/, '').trim(),
    width: Math.round(node.getBoundingClientRect().width),
    height: Math.round(node.getBoundingClientRect().height)
  })));
  assert.deepEqual(navInfo.map(item => item.label), expectedSteps, `${label}: full original step names are present`);
  assert.equal(navInfo.length, 4, `${label}: all four original step buttons remain`);
  assert(navInfo.every(item => item.width >= 44 && item.height >= 44), `${label}: the original four buttons remain touchable (${JSON.stringify(navInfo)})`);
  const progress = page.getByTestId('step-progress');
  assert.equal(await progress.isVisible(), true, `${label}: progress bar is visible above the step buttons`);
  assert.equal(await progress.getAttribute('aria-valuenow'), '1', `${label}: progress bar reports Step 1`);
  assert.equal(await progress.getAttribute('aria-valuemax'), '4', `${label}: progress bar reports four total stages`);
  assert.equal(await page.getByTestId('app-version-label').innerText(), 'R132', `${label}: R132 is loaded`);

  const keyCard = page.locator('.api-settings-card');
  assert.equal(await keyCard.isVisible(), true, `${label}: original Key status/action card is visible`);
  assert.match(await keyCard.innerText(), /尚未設定免費鎖匙/);
  assert.match(await keyCard.innerText(), /相片及一般文字需要免費鎖匙/);
  assert.equal(await page.getByTestId('open-free-key-settings').isVisible(), true, `${label}: the Key card opens the existing setup route`);
  assert.equal(await page.getByTestId('scan-model-select').isVisible(), true, `${label}: original model selector remains available`);

  assert.equal(await page.getByTestId('receipt-camera').isVisible(), true, `${label}: camera action remains`);
  assert.equal(await page.getByTestId('receipt-upload').isVisible(), true, `${label}: image selection remains`);
  assert.equal(await page.getByTestId('start-manual').isVisible(), true, `${label}: manual-entry action remains`);
  const aiHeading = page.getByTestId('toggle-receipt-text-import');
  assert.equal(await aiHeading.isVisible(), true, `${label}: other-AI translation option is discoverable`);
  assert.match(await aiHeading.innerText(), /搵其他 AI 幫手翻譯/);
  assert.match(await aiHeading.innerText(), /提示詞＋賬單＝專用翻譯檔（\.json）/);
  assert.equal(await aiHeading.getAttribute('aria-expanded'), 'false', `${label}: existing R127 disclosure behavior is retained, not newly redesigned`);
  await assertNoOverflow(page, width, `${label} first step`);
  await page.screenshot({ path: path.join(outputDir, `step1-${width}x${height}.png`), fullPage: false });
  console.log(`PASS original Step 1 ${label}: four progress labels, Key path, camera/photo, AI translation heading and manual entry`);
}

async function assertKeyApplicationRoute(page) {
  await page.getByTestId('open-free-key-settings').click();
  const keyLink = page.getByTestId('get-free-api-key');
  await keyLink.waitFor({ state: 'visible' });
  assert.match(await keyLink.innerText(), /取得免費金鑰/);
  assert.equal(await page.getByTestId('settings-key-video-link').isVisible(), true, 'the existing OpenRouter Key video link is available in Settings');
  await page.getByTestId('settings-key-video-link').click();
  await page.getByTestId('openrouter-video-card').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('openrouter-video-card').innerText(), /示範申請及設定 OpenRouter API Key/);
  await page.getByTestId('header-back-button').click();
  await page.getByTestId('receipt-camera').waitFor({ state: 'visible' });
  console.log('PASS Key card → Settings → free Key application link and tutorial → return to app');
}

async function assertOriginalStep2Order(page, width) {
  const heading = page.getByTestId('toggle-receipt-text-import');
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
  await page.getByTestId('receipt-text-draft').fill(JSON.stringify(receiptJson));
  await page.getByTestId('submit-receipt-text').click();
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
  assert.equal(await page.getByTestId('step-progress').getAttribute('aria-valuenow'), '2', 'progress advances to Step 2');
  assert.match(await page.getByTestId('verify-summary').innerText(), /2項.*68/);

  const positions = await page.evaluate(() => {
    const top = selector => document.querySelector(selector)?.getBoundingClientRect().top + window.scrollY;
    return {
      summary: top('[data-testid="verify-summary"]'),
      activity: top('[data-testid="activity-settings"]'),
      firstItem: top('[data-testid="verify-item"]'),
      share: top('[data-testid="claim-share-block"]')
    };
  });
  assert(positions.summary < positions.activity, `R127 places the total before activity settings (${JSON.stringify(positions)})`);
  assert(positions.activity < positions.firstItem, `R127 shows activity/link settings before the full item list (${JSON.stringify(positions)})`);
  assert(positions.firstItem < positions.share, `R127 keeps friend-link sharing after item review (${JSON.stringify(positions)})`);
  assert.equal(await page.getByTestId('claim-activity-name').isVisible(), true, 'activity name remains directly available');
  assert.equal(await page.getByTestId('claim-expiry-days').isVisible(), true, 'link validity remains directly available');
  assert.equal(await page.getByTestId('manual-claim-entry-option').isVisible(), true, 'manual claim remains available in Step 2');
  await assertNoOverflow(page, width, 'R127 Step 2');
  await page.screenshot({ path: path.join(outputDir, `step2-${width}x844.png`), fullPage: false });
  console.log(`PASS original Step 2 ${width}px: total → activity/link settings → item list → sharing (${JSON.stringify(positions)})`);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let externalApiRequests = 0;
  try {
    for (const [width, height] of [[320, 844], [390, 844], [320, 700]]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`${width}×${height}: ${error.message}`));
      await page.route('https://openrouter.ai/**', async route => { externalApiRequests += 1; await route.abort(); });
      await page.route('https://**/*.workers.dev/**', async route => { externalApiRequests += 1; await route.abort(); });
      await initialize(page);
      await assertOriginalFirstStep(page, width, height);
      if (width === 320 && height === 844) await assertKeyApplicationRoute(page);
      if (width === 390) await assertOriginalStep2Order(page, width);
      await context.close();
    }

    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const desktop = await desktopContext.newPage();
    desktop.on('pageerror', error => failures.push(`desktop: ${error.message}`));
    await initialize(desktop);
    await assertOriginalFirstStep(desktop, 1280, 900);
    await assertOriginalStep2Order(desktop, 1280);
    await desktopContext.close();

    assert.equal(externalApiRequests, 0, 'the test never contacts external AI or Worker APIs');
    assert.deepEqual(failures, [], failures.join('\n'));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
