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

    await page.getByTestId('item-name').first().fill('QA 飲品');
    assert.equal(await page.getByTestId('guided-action-backdrop').count(), 0, 'no spotlight is shown while the line amount is still missing');
    await page.getByTestId('item-price').first().fill('10');

    const linkBackdrop = page.getByTestId('guided-action-backdrop');
    const linkGroup = page.getByTestId('step2-guided-claim-options');
    assert.equal(await linkBackdrop.count(), 0, 'entering Step 2 does not auto-scroll away from receipt review');
    await page.getByTestId('activity-settings-next').click();
    await linkBackdrop.waitFor({ state: 'visible' });
    await linkGroup.waitFor({ state: 'visible' });
    assert.match(await linkGroup.getAttribute('class'), /guided-action-target/);
    assert.equal(await linkGroup.locator('button').count(), 3, 'Step 2 first reveals Copy link, Share link, and manual-entry choices');
    for (const testId of ['copy-friend-claim-link', 'open-claim-share-button', 'enable-manual-claim-entry']) {
      assert.equal(await page.getByTestId(testId).isVisible(), true, `${testId} remains visible in the first Step 2 spotlight`);
      assert.equal(await page.getByTestId(testId).isEnabled(), true, `${testId} remains enabled in the first Step 2 spotlight`);
    }
    await page.getByTestId('copy-friend-claim-link').click({ trial: true });
    await page.getByTestId('open-claim-share-button').click({ trial: true });
    const linkLayering = await page.evaluate(() => ({
      backdrop: getComputedStyle(document.querySelector('[data-testid="guided-action-backdrop"]')).zIndex,
      target: getComputedStyle(document.querySelector('[data-testid="step2-guided-claim-options"]')).zIndex,
      buttons: [...document.querySelectorAll('[data-testid="step2-guided-claim-options"] button')].map(button => button.getBoundingClientRect().width)
    }));
    assert.equal(linkLayering.backdrop, '2147483000');
    assert.equal(linkLayering.target, '2147483001');
    assert.ok(linkLayering.buttons.every(width => width > 40), 'all link/manual choices remain large enough to tap');

    await page.getByTestId('enable-manual-claim-entry').click();
    await linkBackdrop.waitFor({ state: 'hidden' });
    await page.getByTestId('claim-replies').fill('Name: QA Friend\n01 = 1');
    assert.equal(await linkBackdrop.count(), 0, 'manual mode keeps both claim-entry and later-link controls accessible without a second mask');
    assert.doesNotMatch(await linkGroup.getAttribute('class'), /guided-action-target/);
    assert.doesNotMatch(await page.getByTestId('step2-guided-actions').getAttribute('class'), /guided-action-target/);
    const next = page.getByTestId('go-to-payer');
    assert.equal(await next.isVisible(), true, 'the ordinary Next control remains visible in manual mode');
    assert.equal(await next.isEnabled(), true, 'the ordinary Next control remains usable in manual mode');

    await next.click();
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
    console.log('PASS Step 2 offers link/manual choices, manual entry stays unmasked, and Step 3 calculates when ready');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
