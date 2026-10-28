// Run after starting the local static server documented in tests/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('Local-only test.');
const out = process.env.TEST_OUTPUT_DIR || '/tmp/bill-tutorial-qa';
const results = [];
const stages = ['upload', 'manual', 'verify', 'items', 'fee', 'share', 'share-options', 'replies', 'payer', 'currency', 'payment', 'tax-method', 'calculate', 'report', 'report-share', 'detail'];
const steps = [1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
const selectors = [
  '[data-testid="receipt-source-actions"]', '[data-testid="start-manual"]', '[data-testid="verify-item"]',
  '[data-tutorial-target="item-fields"]', '[data-tutorial-target="fee"]', '[data-tutorial-target="open-claim-share"]',
  '[data-tutorial-target="send-claim-link"]', '[data-testid="claim-replies"]',
  '[data-tutorial-target="calculation-settings"]', '[data-tutorial-target="currency"]',
  '[data-testid="payment-methods"]', '[data-tutorial-target="tax-method"]',
  '[data-testid="calculate-split"]', '[data-testid="final-summary-preview"]',
  '[data-testid="summary-report-actions"]', '[data-testid="detail-report-actions"]'
];
const waitStage = (page, stage) => page.waitForFunction(stage => {
  const tutorial = document.querySelector('[data-testid="interactive-tutorial"]');
  return tutorial?.dataset.stage === stage && tutorial.dataset.ready === 'true';
}, stage);
const demo = page => page.locator('[data-tutorial-demo]');
const target = (page, i) => demo(page).locator(selectors[i]);
async function advance(page, i) {
  if (i === 5) { await target(page, 5).click(); await waitStage(page, 'share-options'); }
  else if (i === 6) { await target(page, 6).click(); await waitStage(page, 'replies'); }
  else if (i === 12) { await target(page, 12).click(); await waitStage(page, 'report'); }
  else {
    await page.getByTestId('tutorial-next').click();
    if (i < stages.length - 1) await waitStage(page, stages[i + 1]);
  }
}
async function assertTargetGating(page, i, label) {
  const outside = await page.evaluate(selector => {
    const card = document.querySelector('[data-testid="tutorial-card"]');
    const target = document.querySelector('[data-tutorial-demo] ' + selector);
    const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
    return [...document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')]
      .filter(e => visible(e) && !e.disabled && e.tabIndex >= 0 && !card?.contains(e) && !target?.contains(e))
      .map(e => e.dataset.testid || e.tagName.toLowerCase());
  }, selectors[i]);
  assert.deepEqual(outside, [], label + ': other controls remain keyboard-accessible');
}
async function walkTutorial(page, label) {
  await page.getByTestId('start-tutorial').click();
  await page.getByTestId('tutorial-mode-interactive').click(); await waitStage(page, 'upload');
  for (let i = 0; i < stages.length; i++) {
    await waitStage(page, stages[i]);
    await target(page, i).waitFor({ state: 'visible' });
    assert.equal(await demo(page).locator('main').getAttribute('data-current-step'), String(steps[i]), label + '-' + stages[i] + ': App step');
    assert.equal(await page.getByTestId('tutorial-card').getAttribute('aria-modal'), 'false', label + ': tutorial must be non-modal');
    assert.equal(await demo(page).evaluate(e => e.inert), false, label + ': demo must not be inert');
    assert(await page.getByTestId('tutorial-card').evaluate(e => e.getBoundingClientRect().width <= 340), label + ': tutorial card too wide');
    const jumpButtons = await page.getByTestId('tutorial-card').locator('button').evaluateAll(bs => bs.filter(b => /(?:step\s*[1-4]|第\s*[一二三四1-4]\s*步)/i.test(b.textContent + ' ' + b.getAttribute('aria-label'))).map(b => b.textContent.trim()));
    assert.deepEqual(jumpButtons, [], label + ': duplicate four-step jump controls');
    await assertTargetGating(page, i, label + '-' + stages[i]);
    if ([0, 7, 10].includes(i)) {
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert(await page.evaluate(selector => {
          const active = document.activeElement;
          return document.querySelector('[data-testid="tutorial-card"]')?.contains(active) || document.querySelector('[data-tutorial-demo] ' + selector)?.contains(active);
        }, selectors[i]), label + '-' + stages[i] + ': keyboard focus escaped target/card');
      }
    }
    await advance(page, i);
  }
  await page.getByTestId('interactive-tutorial').waitFor({ state: 'detached' });
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(); const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/openrouter\.ai|ntfy\.sh/.test(r.url())) requests.push(r.url().replace(/\?.*/, '')); });
    await page.goto(base, { waitUntil: 'networkidle' }); await page.getByTestId('start-tutorial').waitFor();
    const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
    await walkTutorial(page, 'empty-bill');
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))), before, 'tutorial changed localStorage');
    assert.equal(await page.locator('[data-live-app] main').getAttribute('data-current-step'), '1');
    assert.deepEqual(requests, [], 'tutorial made a business network request'); assert.deepEqual(errors, [], 'browser exceptions');
    results.push({ label: 'empty-bill-16-stop-gating-nonmodal', passed: true }); console.log('PASS empty-bill-16-stop-gating-nonmodal');
    await context.close();

    // Tutorial scripts and OpenRouter screenshots must survive runtime-cache removal.
    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const offline = await offlineContext.newPage(); const offlineErrors = [];
    offline.on('pageerror', e => offlineErrors.push(e.message));
    await offline.goto(base, { waitUntil: 'networkidle' }); await offline.getByTestId('start-tutorial').waitFor();
    await offline.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
    await offline.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await offline.reload({ waitUntil: 'networkidle' }); await offline.getByTestId('start-tutorial').waitFor(); await offline.waitForTimeout(300);
    const precache = await offline.evaluate(async () => {
      const names = await caches.keys(); const shell = await caches.open(names.find(n => n.startsWith('bill-splitter-shell-')));
      const js = await shell.match('./tutorial.js'); const css = await shell.match('./tutorial.css');
      const guidePage = await shell.match('./openrouter-key-guide.html');
      const guideImages = await Promise.all(Array.from({ length: 7 }, (_, i) => shell.match(`./assets/openrouter-guide-step-${i + 1}-` + ['google.png', 'new-key.png', 'expiry-focus.png', 'limit-focus.png', 'create-focus.png', 'original.jpg', 'app-field-crop.png'][i])));
      for (const name of names.filter(n => n.startsWith('bill-splitter-assets-'))) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (/\/tutorial\.(js|css)/.test(request.url)) await cache.delete(request);
      }
      return { js: js?.status, css: css?.status, guidePage: guidePage?.status, guideImages: guideImages.map(response => response?.status) };
    });
    assert.deepEqual(precache, { js: 200, css: 200, guidePage: 200, guideImages: Array(7).fill(200) });
    await offlineContext.setOffline(true);
    await offline.reload({ waitUntil: 'domcontentloaded' }); await offline.getByTestId('start-tutorial').waitFor({ timeout: 30000 });
    await walkTutorial(offline, 'offline');
    await offline.getByTestId('start-tutorial').click(); await offline.getByTestId('tutorial-mode-text').click();
    const guideLink = offline.getByTestId('openrouter-key-guide-link');
    const [guide] = await Promise.all([offline.waitForEvent('popup'), guideLink.click()]);
    guide.on('pageerror', e => offlineErrors.push(e.message));
    await guide.waitForLoadState('domcontentloaded');
    for (let i = 0; i < 7; i++) {
      const card = guide.locator(`[data-guide-step="${i}"]`);
      await card.waitFor({ state: 'visible' });
      const image = card.locator('img');
      await image.scrollIntoViewIfNeeded();
      await guide.waitForFunction(index => {
        const image = document.querySelector(`[data-guide-step="${index}"] img`);
        return image && image.complete && image.naturalWidth > 0;
      }, i);
      if (i < 6) await guide.locator('#nextButton').click();
    }
    await guide.close();
    assert.deepEqual(offlineErrors, [], 'offline browser exceptions');
    results.push({ label: 'registered-SW-offline-guide-and-seven-image-precache', passed: true }); console.log('PASS registered-SW-offline-guide-and-seven-image-precache');
    await offlineContext.close();
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'safety-results.json'), JSON.stringify({ passed: true, cases: results }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(e => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'safety-results.json'), JSON.stringify({ passed: false, cases: results, error: e.stack }, null, 2) + '\n'); console.error(e); process.exit(1); });
