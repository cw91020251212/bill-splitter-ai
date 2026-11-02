'use strict';
// Run a local static server first. This test intercepts OpenRouter locally and
// never sends receipt data or an API key to the network.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/recognition-retry-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) {
  throw new Error('This state-writing test only runs against a local server.');
}
const outputDir = process.env.TEST_OUTPUT_DIR || path.resolve(__dirname, '../artifacts');
const screenshotPath = path.join(outputDir, 'recognition-retry-preview.png');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const FALLBACK_MODEL = 'thinkingmachines/inkling-small:free';
const itemPayload = name => ({
  items: [{ name, nameEn: name, original: 'Receipt item', price: 100, qty: 1, total: 100 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 100
});
const success = payload => ({
  choices: [{ message: { content: JSON.stringify(payload) } }]
});
(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let requestCount = 0;
  let fileChooserCount = 0;
  const observedModels = [];
  const observedImageCounts = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    page.on('filechooser', () => { fileChooserCount += 1; });
    await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      requestCount += 1;
      const body = route.request().postDataJSON();
      observedModels.push(body.model);
      const content = body.messages?.find(message => message.role === 'user')?.content;
      observedImageCounts.push(Array.isArray(content) ? content.filter(part => part.type === 'image_url').length : 0);
      if (requestCount === 1) {
        assert.equal(body.model, DEFAULT_MODEL, 'the default model is tried first');
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit exceeded' } }) });
        return;
      }
      if (requestCount === 2) {
        assert.equal(body.model, FALLBACK_MODEL, 'a busy first model falls through to the next free model');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(success(itemPayload('首次成功結果'))) });
        return;
      }
      if (requestCount === 3) {
        assert.equal(body.model, DEFAULT_MODEL, 'new photos use the selected default model');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(success(itemPayload('新增相片結果'))) });
        return;
      }
      if (requestCount === 4) {
        assert.equal(body.model, DEFAULT_MODEL, 're-recognition uses the current saved model order');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(success(itemPayload('重新識別結果'))) });
        return;
      }
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit exceeded' } }) });
    });

    await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({
        engine: 'openrouter',
        keys: { openrouter: 'local-test-key' },
        model: 'nvidia/nemotron-3.5-super-vl:free',
        allowPaidModels: false
      }));
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('receipt-upload').waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await page.getByTestId('reuse-last-batch-hint').count(), 0, 'the helper is hidden before a successful receipt recognition');
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('reuse-last-receipt-photos').isDisabled(), true, 'reuse is unavailable before there is a stored image batch');
    await page.getByTestId('add-new-receipt-photos').click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'first-receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG, 'base64')
    });
    await page.getByTestId('redaction-recognize-now').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-recognize-now').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByText('首次成功結果', { exact: false }).waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('last-recognition-model').innerText(), /Inkling Small/);

    await page.locator('.step-nav button').first().click();
    await page.getByTestId('reuse-last-batch-hint').waitFor({ state: 'visible' });
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('add-new-receipt-photos').click();
    await page.locator('input[type="file"]').first().setInputFiles([
      { name: 'new-receipt-1.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') },
      { name: 'new-receipt-2.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') }
    ]);
    await page.getByTestId('redaction-recognize-now').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-recognize-now').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByText('新增相片結果', { exact: false }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText('首次成功結果', { exact: false }).count(), 0, 'the newly selected batch replaces the earlier recognized items on success');

    await page.locator('.step-nav button').first().click();
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('reuse-last-receipt-photos').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('reuse-last-receipt-photos').isDisabled(), false);
    assert.match(await page.getByTestId('reuse-last-receipt-photos').innerText(), /重用整批 2 張相片/);
    await page.evaluate(() => document.querySelector('[data-testid="receipt-image-action-menu"]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.getByTestId('reuse-last-receipt-photos').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByText('重新識別結果', { exact: false }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText('新增相片結果', { exact: false }).count(), 0, 'a successful re-recognition replaces the previous items');
    assert.equal(fileChooserCount, 2, 'only explicit add-new-photo actions open the file chooser; re-recognition does not');
    assert.equal(observedImageCounts[0], 1, 'the first scan contains its selected image');
    assert.equal(observedImageCounts[2], 2, 'the added-photo scan contains both selected images');
    assert.equal(observedImageCounts[3], 2, 're-recognition resends the entire stored two-image batch');
    assert.match(await page.getByTestId('last-recognition-model').innerText(), /Nemotron 3\.5 VL/);

    await page.locator('.step-nav button').first().click();
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('reuse-last-receipt-photos').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByTestId('recognition-retry-error').waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('recognition-retry-error').innerText(), /仍保留上次成功結果/);
    await page.getByText('重新識別結果', { exact: false }).waitFor({ state: 'visible' });
    assert.equal(requestCount, 10, 'final retry cascades through every free model before returning the prior result');
    assert.equal(observedModels[0], DEFAULT_MODEL);
    assert.equal(observedModels[1], FALLBACK_MODEL);
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log(`PASS 390px local UI: hidden-until-success helper, add-new batch of two photos, whole-batch re-recognition without reopening the picker, successful replacement, and failed retry preserving results (${requestCount} mocked OCR requests).`);

    await page.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      return Boolean(draft?.hasAssets && draft.data?.step === 2 && draft.data?.items?.length);
    }, null, { timeout: 15000 });
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1'));
      draft.data.step = 3;
      draft.data.friendsReplies = '姓名：阿明\n01 = 1';
      draft.data.payer = '阿明';
      draft.data.claimLinkShared = true;
      localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(draft));
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'billSplitterActiveDraftV1') return;
        return setItem.call(this, key, value);
      };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="draft-status"]')?.textContent.includes('草稿已保存在') || document.querySelector('[data-testid="draft-status"]')?.textContent.includes('saving') || document.querySelector('[data-testid="calculate-split"]'), null, { timeout: 15000 });
    await page.getByTestId('calculate-split').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 15000 });

    const includeReceiptToggle = page.locator('main input[type="checkbox"]').first();
    await includeReceiptToggle.check();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => new Promise(resolve => { window.__finishMockShare = resolve; })
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.getByTestId('summary-report-actions').getByRole('button', { name: '分享報告' }).click();
    await page.waitForFunction(() => typeof window.__finishMockShare === 'function');
    await page.evaluate(() => window.__finishMockShare());
    await page.waitForFunction(() => {
      const button = document.querySelector('#receipt-share-step button');
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.top >= headerBottom && rect.bottom <= window.innerHeight;
    }, null, { timeout: 5000 });
    const receiptButtonPosition = await page.locator('#receipt-share-step button').evaluate(button => ({
      top: button.getBoundingClientRect().top,
      bottom: button.getBoundingClientRect().bottom,
      scrollY: window.scrollY
    }));
    assert.ok(receiptButtonPosition.scrollY > 0, 'returning from summary share should scroll the receipt card into view');
    assert.ok(receiptButtonPosition.top >= 0 && receiptButtonPosition.bottom <= 844, 'the receipt-image share button must be visible in the 390px viewport');
    console.log('PASS 390px share return: selected receipt images bring the image-share button into view when the share sheet closes, including without a visibility-change event.');

    await includeReceiptToggle.uncheck();
    await page.waitForFunction(() => !document.getElementById('receipt-share-step'));
    await page.evaluate(() => { window.__finishMockShare = null; window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.getByTestId('summary-report-actions').getByRole('button', { name: '分享報告' }).click();
    await page.waitForFunction(() => typeof window.__finishMockShare === 'function');
    await page.evaluate(() => window.__finishMockShare());
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 0, 'without receipt images selected, returning from summary share must not jump to the receipt card');
    assert.equal(await page.getByTestId('receipt-next-step').count(), 0, 'the second-step receipt card stays hidden when no images were selected');
    console.log('PASS 390px no-receipt case: summary-share return does not jump when receipt images were not selected.');

    console.log(`SCREENSHOT ${screenshotPath}`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
