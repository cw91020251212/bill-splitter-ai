'use strict';

const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4220/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This test only runs against a local server.');
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    for (const width of [320, 390, 430]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        serviceWorkers: 'block'
      });
      await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
        localStorage.setItem('billSplitterLanguage', 'zh-HK');
        localStorage.setItem('billSplitterHistory', '[]');
      });
      await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
      const toggle = page.getByTestId('toggle-receipt-text-import');
      await toggle.waitFor({ state: 'visible', timeout: 60000 });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();

      const upper = page.getByTestId('receipt-text-import').getByTestId('copy-prompt-open-google-ai');
      const divider = page.getByTestId('receipt-text-import-content').getByTestId('choice-divider');
      const lower = page.getByTestId('receipt-text-import').getByTestId('copy-receipt-json-prompt');
      await lower.waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const node = document.querySelector(selector);
          const box = node.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height };
        };
        return {
          upper: rect('[data-testid="copy-prompt-open-google-ai"]'),
          divider: rect('[data-testid="receipt-text-import-content"] [data-testid="choice-divider"]'),
          lower: rect('[data-testid="copy-receipt-json-prompt"]')
        };
      });
      const above = geometry.divider.top - geometry.upper.bottom;
      const below = geometry.lower.top - geometry.divider.bottom;
      assert.ok(above >= 0 && below >= 0, `${width}px: separator must not overlap either button: ${JSON.stringify(geometry)}`);
      assert.ok(
        Math.abs(above - below) <= 1,
        `${width}px: separator row must be vertically centered between buttons; clearances above=${above.toFixed(2)}px, below=${below.toFixed(2)}px; geometry=${JSON.stringify(geometry)}`
      );
      console.log(`${width}px: above=${above.toFixed(2)}px, below=${below.toFixed(2)}px`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
