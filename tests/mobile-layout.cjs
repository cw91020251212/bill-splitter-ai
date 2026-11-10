'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const outputDir = process.env.TEST_OUTPUT_DIR || '/tmp/r128-mobile-layout';
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

async function geometry(page, selectors) {
  return page.evaluate(list => Object.fromEntries(list.map(selector => {
    const element = document.querySelector(selector);
    if (!element) return [selector, null];
    const rect = element.getBoundingClientRect();
    return [selector, [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]];
  })), selectors);
}

async function assertNoOverflow(page, width, label) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(sizes.viewport, width, `${label}: browser viewport is the requested width`);
  assert.ok(sizes.document <= width && sizes.body <= width, `${label}: no horizontal overflow (${JSON.stringify(sizes)})`);
}

async function assertVisibleTargets(page, label) {
  const targets = await page.evaluate(() => [...document.querySelectorAll('button, summary, [role="button"]')]
    .filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    })
    .map(element => {
      const rect = element.getBoundingClientRect();
      return { label: element.dataset.testid || element.id || element.getAttribute('aria-label') || element.tagName, width: Math.round(rect.width), height: Math.round(rect.height) };
    }));
  const undersized = targets.filter(target => target.width < 44 || target.height < 44);
  assert.deepEqual(undersized, [], `${label}: all visible buttons and disclosure controls meet 44×44px (${JSON.stringify(undersized)})`);
  return targets.length;
}

async function assertImportedStep2(page, width, height, largeText = false) {
  const label = `${width}×${height}${largeText ? ' large text' : ''}`;
  await page.getByTestId('toggle-receipt-text-import').click();
  await page.getByTestId('receipt-text-draft').fill(JSON.stringify(receiptJson));
  await page.getByTestId('submit-receipt-text').click();
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
  await page.getByTestId('verify-summary').waitFor({ state: 'visible' });
  const summaryText = await page.getByTestId('verify-summary').innerText();
  assert.match(summaryText, /2項/);
  assert.match(summaryText, /68/);
  const firstItemBox = await page.getByTestId('verify-item').first().boundingBox();
  assert.ok(firstItemBox && firstItemBox.y < 260, `${label}: first item starts before y=260 (actual ${firstItemBox?.y})`);
  const itemListBox = await page.getByTestId('items-list-section').boundingBox();
  const manualClaimBox = await page.getByTestId('manual-claim-entry-option').boundingBox();
  assert.ok(itemListBox && manualClaimBox && manualClaimBox.y >= itemListBox.y + itemListBox.height - 1, `${label}: manual claim entry follows the complete item list`);
  assert.ok(manualClaimBox.y - (itemListBox.y + itemListBox.height) <= 44, `${label}: manual claim entry is immediately after the list`);
  assert.equal(await page.getByTestId('step2-share-settings').evaluate(details => details.open), false, `${label}: activity/share settings stay collapsed on phones`);
  assert.equal(await page.getByTestId('receipt-photo-disclosure').evaluate(details => details.open), false, `${label}: receipt-photo controls stay collapsed on phones`);
  assert.ok(await page.getByTestId('manual-claim-entry-option').isVisible(), `${label}: manual claim entry remains available`);
  await assertNoOverflow(page, width, `${label} Step 2`);
  const touchTargets = await assertVisibleTargets(page, `${label} Step 2`);
  await page.screenshot({ path: path.join(outputDir, `step2-${width}x${height}${largeText ? '-large' : ''}.png`), fullPage: false });
  console.log(`PASS imported Step 2 ${label}: summary="${summaryText.trim()}", first item y=${Math.round(firstItemBox.y)}, ${touchTargets} visible touch targets`);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const failures = [];
  let apiRequests = 0;
  try {
    for (const [width, height] of [[320, 844], [390, 844], [320, 700]]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(`${width}x${height}: ${error.message}`));
      await page.route('https://openrouter.ai/**', async route => { apiRequests += 1; await route.abort(); });
      await page.route('https://**/*.workers.dev/**', async route => { apiRequests += 1; await route.abort(); });
      await initialize(page);
      const current = await geometry(page, [
        '.app-header-row', '.stepper-panel', '[data-testid="mobile-step-label"]', 'main',
        '[data-testid="scan-start"]', '[data-testid="scan-start"] .page-section-heading',
        '[data-testid="scan-subtitle-mobile"]', '[data-testid="receipt-camera"]',
        '[data-testid="receipt-upload"]', '[data-testid="toggle-receipt-text-import"]',
        '[data-testid="start-manual"]', '[data-testid="scan-settings-toggle"]'
      ]);
      await assertNoOverflow(page, width, `${width}×${height} home`);
      assert.equal(current['.app-header-row'][3], 48, `${width}×${height}: header stays within the 48px target`);
      assert.ok(current['.stepper-panel'][3] >= 32 && current['.stepper-panel'][3] <= 40, `${width}×${height}: compact step row is 32–40px high`);
      assert.equal(current['[data-testid="scan-start"]'][0], width === 320 ? 12 : 16, `${width}×${height}: requested horizontal page margin`);
      assert.ok(current['[data-testid="scan-start"] .page-section-heading'][3] >= 28, `${width}×${height}: heading is not shrunk to save space`);
      assert.equal(current['[data-testid="scan-start"] .page-section-heading'] && await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="scan-start"] .page-section-heading h2')).fontSize), '23px', `${width}×${height}: mobile title uses 23px text`);
      assert.ok(current['[data-testid="receipt-camera"]'][1] < 220 && current['[data-testid="receipt-upload"]'][1] < 220, `${width}×${height}: photo actions begin before y=220`);
      assert.ok(current['[data-testid="receipt-camera"]'][3] >= 52 && current['[data-testid="receipt-upload"]'][3] >= 52, `${width}×${height}: photo buttons are at least 44×52px`);
      assert.ok(current['[data-testid="toggle-receipt-text-import"]'][1] + current['[data-testid="toggle-receipt-text-import"]'][3] <= 600, `${width}×${height}: text-import action is visible above y=600`);
      assert.ok(current['[data-testid="start-manual"]'][1] + current['[data-testid="start-manual"]'][3] <= (height === 844 ? 600 : height), `${width}×${height}: manual entry is visible without scrolling`);
      assert.equal(await page.getByTestId('scan-settings').evaluate(details => details.open), false, `${width}×${height}: recognition settings start collapsed`);
      assert.equal(await page.getByTestId('scan-model-select').isVisible(), false, `${width}×${height}: model cards stay out of the first screen`);
      assert.match(await page.getByTestId('scan-key-short-hint').innerText(), /未設鎖匙/);
      const hintBox = await page.getByTestId('scan-key-short-hint').boundingBox();
      assert.ok(hintBox && hintBox.height <= 24, `${width}×${height}: key hint stays on one line`);
      const targetCount = await assertVisibleTargets(page, `${width}×${height} home`);
      await page.screenshot({ path: path.join(outputDir, `home-${width}x${height}.png`), fullPage: false });
      console.log(`PASS home ${width}x${height}: camera y=${current['[data-testid="receipt-camera"]'][1]}, text bottom=${current['[data-testid="toggle-receipt-text-import"]'][1] + current['[data-testid="toggle-receipt-text-import"]'][3]}, manual bottom=${current['[data-testid="start-manual"]'][1] + current['[data-testid="start-manual"]'][3]}, ${targetCount} visible touch targets`);

      if (width === 320 && height === 844) {
        await page.getByTestId('header-action-menu-toggle').click();
        await assertVisibleTargets(page, '320×844 large-text menu');
        await page.getByTestId('app-text-size-large').click();
        await page.getByTestId('header-action-menu-toggle').click();
        await assertNoOverflow(page, width, '320×844 large text home');
        const largeStepLine = await page.getByTestId('mobile-step-label').evaluate(element => {
          const text = element.lastElementChild;
          const rect = text.getBoundingClientRect();
          return { height: rect.height, clientHeight: text.clientHeight, scrollHeight: text.scrollHeight, text: text.innerText };
        });
        assert.ok(largeStepLine.height <= 25 && largeStepLine.scrollHeight <= largeStepLine.clientHeight + 2, `large text keeps the step label on one line (${JSON.stringify(largeStepLine)})`);
        const largeTitle = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="scan-start"] .page-section-heading h2')).fontSize);
        assert.ok(parseFloat(largeTitle) >= 27, `large text is applied without shrinking (${largeTitle})`);
        const largeHintBox = await page.getByTestId('scan-key-short-hint').boundingBox();
        assert.ok(largeHintBox && largeHintBox.height <= 24, 'large text keeps the key hint to one line');
        const largeHomeActions = await geometry(page, ['[data-testid="receipt-camera"]', '[data-testid="receipt-upload"]', '[data-testid="toggle-receipt-text-import"]', '[data-testid="start-manual"]']);
        assert.ok(largeHomeActions['[data-testid="start-manual"]'][1] + largeHomeActions['[data-testid="start-manual"]'][3] <= 600, 'large text keeps manual entry on the first screen');
        await page.screenshot({ path: path.join(outputDir, 'home-320x844-large.png'), fullPage: false });

        await assertImportedStep2(page, width, height, true);
        await context.close();
      } else {
        await assertImportedStep2(page, width, height, false);
        await context.close();
      }
    }

    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const desktopPage = await desktop.newPage();
    desktopPage.on('pageerror', error => failures.push(`desktop: ${error.message}`));
    await desktopPage.route('https://openrouter.ai/**', async route => { apiRequests += 1; await route.abort(); });
    await initialize(desktopPage);
    const step1 = await geometry(desktopPage, [
      '.app-header-row', '.stepper-panel', 'main', '[data-testid="scan-start"] .page-section-heading',
      '.api-settings-card', '[data-testid="scan-model-select"]', '.upload-dropzone',
      '[data-testid="receipt-camera"]', '[data-testid="receipt-upload"]',
      '[data-testid="toggle-receipt-text-import"]', '[data-testid="start-manual"]'
    ]);
    assert.deepEqual(step1['.app-header-row'], [304, 0, 672, 74], 'desktop header geometry remains unchanged');
    assert.deepEqual(step1['.stepper-panel'], [304, 74, 672, 93], 'desktop four-step navigation geometry remains unchanged');
    assert.deepEqual(step1['.api-settings-card'], [336, 326, 611, 132], 'desktop recognition settings remain in their original position');
    assert.deepEqual(step1['.upload-dropzone'], [336, 680, 611, 267], 'desktop image upload card geometry remains unchanged');
    await desktopPage.getByTestId('toggle-receipt-text-import').click();
    await desktopPage.getByTestId('receipt-text-draft').fill(JSON.stringify({ items: [{ name: '測試項目', price: 20, qty: 1, totalQty: 1, unit: '份', total: 20 }], adjustments: [], taxTotal: 0, currency: 'HKD', receiptTotal: 20 }));
    await desktopPage.getByTestId('submit-receipt-text').click();
    await desktopPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    const step2 = await geometry(desktopPage, [
      '.app-header-row', '.stepper-panel', 'main', '[data-testid="items-step"] .page-section-heading',
      '[data-testid="activity-settings"]', '[data-testid="verify-summary"]',
      '[data-testid="items-step"] .space-y-4', '[data-testid="verify-item"]', '[data-testid="claim-share-block"]'
    ]);
    assert.deepEqual(step2['.app-header-row'], [304, 0, 672, 74], 'desktop Step 2 header remains unchanged');
    assert.deepEqual(step2['.stepper-panel'], [304, 74, 672, 93], 'desktop Step 2 navigation remains unchanged');
    assert.deepEqual(step2['[data-testid="activity-settings"]'], [336, 454, 611, 304], 'desktop activity settings remain in their original position');
    assert.deepEqual(step2['[data-testid="items-step"] .space-y-4'], [336, 782, 611, 194], 'desktop item list remains in its original position');
    console.log('PASS desktop geometry: original header, four-step bar, model card, photo actions and Step 2 list positions unchanged');
    assert.equal(apiRequests, 0, 'test traffic never reaches a real model or bill API');
    assert.deepEqual(failures, [], failures.join('\n'));
    await desktop.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
