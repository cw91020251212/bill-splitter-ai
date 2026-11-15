'use strict';
// Local-only UI test for the Step 2/3 action spotlights. It uses a synthetic bill
// and blocks non-read-only network requests; it never touches a real bill or API.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const runtimes = new Map();
const runtimeUrls = ['https://unpkg.com/react@18/umd/react.production.min.js', 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'https://unpkg.com/@babel/standalone/babel.min.js'];
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4180/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');

async function preload() {
  await Promise.all(runtimeUrls.map(async url => {
    const { stdout } = await execFile('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '45', url], { maxBuffer: 20 * 1024 * 1024 });
    assert(stdout.length > 1000, `runtime did not load: ${url}`);
    runtimes.set(url, stdout);
  }));
}

(async () => {
  await preload();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      if (new URL(request.url()).hostname === 'cdn.tailwindcss.com') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || { config: {} };' });
      if (runtimes.has(request.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: runtimes.get(request.url()) });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort();
      const url = new URL(request.url());
      if (['ntfy.sh'].includes(url.hostname) || url.hostname.endsWith('.workers.dev')) return route.abort();
      return route.continue();
    });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByTestId('start-manual').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByTestId('start-manual').click();

    await page.getByTestId('enable-manual-claim-entry').click();
    await page.getByTestId('claim-replies').fill('Name: QA Friend\n01 = 1');
    await page.getByTestId('item-name').first().fill('QA 飲品');
    assert.equal(await page.getByTestId('guided-action-backdrop').count(), 0, 'no spotlight is shown while the line amount is still missing');
    await page.getByTestId('item-price').first().fill('10');

    const step2Backdrop = page.getByTestId('guided-action-backdrop');
    const step2Group = page.getByTestId('step2-guided-actions');
    await step2Backdrop.waitFor({ state: 'visible' });
    await step2Group.waitFor({ state: 'visible' });
    assert.match(await step2Group.getAttribute('class'), /guided-action-target/);
    assert.equal(await step2Group.locator('button').count(), 2, 'Step 2 reveals both Previous and Next choices');
    assert.equal(await page.getByTestId('go-to-payer').isVisible(), true);
    const step2Layering = await page.evaluate(() => ({
      backdrop: getComputedStyle(document.querySelector('[data-testid="guided-action-backdrop"]')).zIndex,
      target: getComputedStyle(document.querySelector('[data-testid="step2-guided-actions"]')).zIndex,
      buttons: [...document.querySelectorAll('[data-testid="step2-guided-actions"] button')].map(button => button.getBoundingClientRect().width)
    }));
    assert.equal(step2Layering.backdrop, '2147483000');
    assert.equal(step2Layering.target, '2147483001');
    assert.ok(step2Layering.buttons.every(width => width > 40), 'both Step 2 buttons remain large enough to tap');

    await page.getByTestId('go-to-payer').click();
    await page.locator('#payer-name').fill('QA 墊支人');
    const step3Backdrop = page.getByTestId('guided-action-backdrop');
    const step3Group = page.getByTestId('step3-guided-actions');
    await step3Backdrop.waitFor({ state: 'visible' });
    await step3Group.waitFor({ state: 'visible' });
    assert.match(await step3Group.getAttribute('class'), /guided-action-target/);
    assert.equal(await step3Group.locator('button').count(), 2, 'Step 3 reveals both Previous and Calculate choices');
    const calculate = page.getByTestId('calculate-split');
    assert.equal(await calculate.isVisible(), true);
    assert.equal(await calculate.isEnabled(), true, 'the Calculate choice is enabled when calculation prerequisites are satisfied');

    await calculate.click();
    await page.locator('[data-step="4"][aria-current="step"]').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('guided-action-backdrop').count(), 0, 'spotlight closes after successful calculation');
    assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
    console.log('PASS Step 2 and Step 3 spotlight groups reveal both choices, obey readiness, and complete a synthetic bill');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
