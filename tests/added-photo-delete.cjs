'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const syntheticPhoto = fs.readFileSync(path.join(__dirname, 'fixtures', 'card-redaction-synthetic.png'));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    page.on('pageerror', error => { throw error; });
    await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
    await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1'); localStorage.setItem('billSplitterLanguage', 'zh-HK'); localStorage.setItem('billSplitterHistory', '[]'); });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 60000 });
    const toggle = page.getByTestId('toggle-receipt-text-import');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.getByTestId('receipt-text-draft').fill(JSON.stringify({ items: [{ name: '測試茶', price: 12, qty: 1, total: 12 }], adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 12 }));
    await page.getByTestId('submit-receipt-text').click();
    await page.getByTestId('activity-settings-next').waitFor({ state: 'visible', timeout: 30000 });

    await page.evaluate(bytes => {
      const data = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
      Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: async () => [1, 2].map(n => {
        const file = new File([data], `synthetic-${n}.png`, { type: 'image/png' });
        return { getFile: async () => file };
      }) });
    }, syntheticPhoto.toString('base64'));
    await page.getByTestId('attach-receipt-image').click();
    await page.getByTestId('receipt-attachment-only-hint').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.getByTestId('redaction-next-or-finish').click();
    await page.waitForFunction(() => /已加2張/.test(document.querySelector('[data-testid="receipt-attachment-status"]')?.textContent || ''), null, { timeout: 20000 });
    assert.equal(await page.getByTestId('source-receipt-card').locator('img').count(), 2);
    assert.equal(await page.getByTestId('remove-receipt-image-0').count(), 1);
    assert.equal(await page.getByTestId('added-receipt-images').count(), 0, 'no duplicate small-photo row is rendered');
    await page.getByTestId('remove-receipt-image-0').click();
    await page.waitForFunction(() => /已加1張/.test(document.querySelector('[data-testid="receipt-attachment-status"]')?.textContent || ''));
    assert.equal(await page.getByTestId('source-receipt-card').locator('img').count(), 1);
    await page.reload();
    await page.getByTestId('activity-settings-next').waitFor({ state: 'visible', timeout: 30000 });
    assert.match(await page.getByTestId('receipt-attachment-status').innerText(), /已加1張/);
    assert.equal(await page.getByTestId('source-receipt-card').locator('img').count(), 1);

    const before = await page.evaluate(() => window.scrollY);
    await page.getByTestId('activity-settings-next').click();
    await page.waitForFunction(() => {
      const target = document.querySelector('[data-testid="open-claim-share-button"]');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const statusTop = document.querySelector('div.fixed.bottom-0[role="status"]')?.getBoundingClientRect().top || innerHeight;
      return rect.top >= 0 && rect.bottom <= statusTop - 8;
    }, null, { timeout: 10000 });
    assert((await page.evaluate(() => window.scrollY)) > before);
    console.log('PASS one-at-a-time photo deletion persists after reload; settlement button scrolls to Share claim link');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
