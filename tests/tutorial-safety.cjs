const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('Local-only test.');
const out = process.env.TEST_OUTPUT_DIR || '/tmp/bill-tutorial-qa';
const results = [];
const waitStage = (page, stage) => page.waitForFunction(stage => document.querySelector('[data-testid="interactive-tutorial"]')?.dataset.stage === stage, stage);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage(); const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/openrouter\.ai|ntfy\.sh/.test(r.url())) requests.push(r.url().replace(/\?.*/, '')); });
    await page.goto(base, { waitUntil: 'networkidle' }); await page.getByTestId('start-tutorial').waitFor();
    const before = await page.evaluate(() => ({ ...localStorage }));
    await page.getByTestId('start-tutorial').click(); await waitStage(page, 'upload');
    // Demo controls are inert and cannot take focus; guide controls form one loop.
    assert(await page.locator('[data-tutorial-demo]').evaluate(e => e.inert));
    for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.querySelector('[data-testid="tutorial-card"]').contains(document.activeElement))); }
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.querySelector('[data-testid="tutorial-card"]').contains(document.activeElement)));
    // Even a synthetic click bypassing inert cannot invoke destructive real handlers.
    await page.evaluate(() => document.querySelector('[data-tutorial-demo] [data-testid="header-clear-current"]').click());
    assert.equal(await page.locator('[data-tutorial-demo] main').getAttribute('data-current-step'), '1');
    await page.getByRole('button', { name: '第 4 步：最終結果', exact: true }).click(); await waitStage(page, 'report');
    await page.locator('[data-tutorial-demo] [data-testid="final-summary-preview"]').waitFor();
    const sample = await page.locator('[data-tutorial-demo] [data-testid="final-summary-preview"]').innerText();
    assert.match(sample, /44\.00/); assert.match(sample, /88\.00/);
    await page.evaluate(() => {
      const demo = document.querySelector('[data-tutorial-demo]');
      demo.querySelector('[data-testid="header-clear-current"]').click();
      demo.querySelector('[data-testid="summary-report-actions"] button').click();
      [...demo.querySelectorAll('button')].find(b => /儲存此分帳紀錄/.test(b.textContent))?.click();
    });
    assert.equal(await page.locator('[data-tutorial-demo] main').getAttribute('data-current-step'), '4');
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(200);
    const card = await page.getByTestId('tutorial-card').boundingBox(); assert(card.x >= 0 && card.y >= 0 && card.y + card.height <= 390);
    await page.getByRole('button', { name: '第 2 步：各自認帳', exact: true }).click(); await waitStage(page, 'items');
    await page.getByTestId('tutorial-next').click(); await waitStage(page, 'share');
    await page.evaluate(() => document.querySelector('[data-tutorial-demo] dialog button:last-child').click());
    await page.getByTestId('tutorial-close').click();
    assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), before);
    assert.equal(await page.locator('[data-live-app] main').getAttribute('data-current-step'), '1');
    assert.equal(await page.locator('[data-live-app] [data-testid="items-step"]').count(), 0);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    results.push({ label: 'empty-bill-keyboard-jump-resize-defence', passed: true }); console.log('PASS empty-bill-keyboard-jump-resize-defence');
    await page.getByTestId('start-tutorial').click();
    await page.getByRole('button', { name: '詳細說明', exact: true }).click();
    await page.locator('[data-live-app] main').getByRole('heading', { name: '新手教學', exact: true }).waitFor();
    assert.equal(await page.locator('[data-live-app] [data-testid="receipt-source-actions"]').count(), 0);
    await page.locator('[data-live-app] .header-back-button').click();
    await page.locator('[data-live-app] [data-testid="receipt-source-actions"]').waitFor();
    results.push({ label: 'original-detailed-help-preserved', passed: true }); console.log('PASS original-detailed-help-preserved');
    await context.close();

    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const offline = await offlineContext.newPage(); const offlineErrors = [];
    offline.on('pageerror', e => offlineErrors.push(e.message));
    await offline.goto(base, { waitUntil: 'networkidle' }); await offline.getByTestId('start-tutorial').waitFor();
    await offline.evaluate(async () => { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; });
    await offline.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await offline.reload({ waitUntil: 'networkidle' }); await offline.getByTestId('start-tutorial').waitFor();
    await offline.waitForTimeout(300);
    const precache = await offline.evaluate(async () => {
      const names = await caches.keys(); const shell = await caches.open(names.find(n => n.startsWith('bill-splitter-shell-')));
      const js = await shell.match('./tutorial.js'); const css = await shell.match('./tutorial.css');
      for (const name of names.filter(n => n.startsWith('bill-splitter-assets-'))) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) if (/\/tutorial\.(js|css)/.test(request.url)) await cache.delete(request);
      }
      return { js: js?.status, css: css?.status };
    });
    assert.deepEqual(precache, { js: 200, css: 200 });
    await offlineContext.setOffline(true);
    await offline.reload({ waitUntil: 'domcontentloaded' }); await offline.getByTestId('start-tutorial').waitFor({ timeout: 30000 });
    await offline.getByTestId('start-tutorial').click(); await waitStage(offline, 'upload');
    for (const stage of ['items', 'share', 'replies', 'payer', 'report']) { await offline.getByTestId('tutorial-next').click(); await waitStage(offline, stage); }
    await offline.getByTestId('tutorial-next').click(); await offline.getByTestId('interactive-tutorial').waitFor({ state: 'detached' });
    assert.deepEqual(offlineErrors, []);
    results.push({ label: 'registered-SW-offline-versioned-precache-fallback', passed: true }); console.log('PASS registered-SW-offline-versioned-precache-fallback');
    await offlineContext.close();
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'safety-results.json'), JSON.stringify({ passed: true, cases: results }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(e => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'safety-results.json'), JSON.stringify({ passed: false, cases: results, error: e.stack }, null, 2) + '\n'); console.error(e); process.exit(1); });
