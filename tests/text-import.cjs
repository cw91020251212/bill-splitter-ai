'use strict';
// Run the local app server first. OpenRouter is intercepted in-browser; no real key
// or receipt data leaves the test environment.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/text-import.cjs
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');

const DOTS = 'dots-studio/dots-3-note-preview:free';
const jsonPastePayload = {
  items: [
    { name: '魚蛋', nameEn: 'Fish balls', original: '魚蛋', ja: '', price: 25, qty: 2, totalQty: 2, unit: '碗', total: 50 },
    { name: '奶茶', nameEn: 'Milk tea', original: '奶茶', ja: '', price: 18, qty: 1, totalQty: 1, unit: '杯', total: 18 }
  ],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 68
};
const filePayload = {
  items: [{ name: '冰咖啡', nameEn: 'Iced coffee', original: '冰咖啡', ja: '', price: 32, qty: 1, totalQty: 1, unit: '杯', total: 32 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 32
};
const textModelPayload = {
  items: [{ name: '芒果糯米飯', nameEn: 'Mango sticky rice', original: 'ข้าวเหนียวมะม่วง', ja: '', price: 65, qty: 1, totalQty: 1, unit: '份', total: 65 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'THB', date: null, receiptTotal: 65
};

const initStorage = async (page, config) => {
  await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(value => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
    localStorage.setItem('billSplitterLanguage', 'zh-HK');
    localStorage.setItem('billSplitterHistory', '[]');
    if (value) localStorage.setItem('billSplitterApiConfig', JSON.stringify(value));
  }, config);
  await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 60000 });
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let noKeyRequests = 0;
  let modelRequests = 0;
  let capturedText = '';
  let capturedImageCount = -1;
  let capturedModel = '';
  try {
    const noKeyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const noKeyPage = await noKeyContext.newPage();
    noKeyPage.on('pageerror', error => failures.push(error.message));
    await noKeyPage.addInitScript(() => {
      document.execCommand = command => {
        if (command === 'copy') window.__copiedPrompt = document.activeElement?.value || '';
        return true;
      };
    });
    await noKeyPage.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      noKeyRequests += 1;
      await route.abort();
    });
    await initStorage(noKeyPage, null);

    assert.equal(await noKeyPage.getByTestId('scan-model-select').inputValue(), 'local/paddleocr-js', 'fresh installs use local PaddleOCR + Dots by default');
    assert.equal(await noKeyPage.getByTestId('copy-receipt-json-prompt').isVisible(), true, 'the prompt-copy action is visible without expanding the import panel');
    await noKeyPage.getByTestId('toggle-receipt-text-import').click();
    await noKeyPage.getByTestId('copy-receipt-json-prompt').click();
    const copiedPrompt = await noKeyPage.evaluate(() => window.__copiedPrompt || '');
    assert.match(copiedPrompt, /附上的收據相片/);
    assert.match(copiedPrompt, /"items"/);
    assert.match(copiedPrompt, /"receiptTotal"/);

    await noKeyPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'en'));
    await noKeyPage.reload();
    await noKeyPage.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 30000 });
    await noKeyPage.getByTestId('toggle-receipt-text-import').click();
    await noKeyPage.getByTestId('copy-receipt-json-prompt').click();
    const copiedEnglishPrompt = await noKeyPage.evaluate(() => window.__copiedPrompt || '');
    assert.match(copiedEnglishPrompt, /Read the receipt photo/);
    assert.match(copiedEnglishPrompt, /receiptTotal/);

    await noKeyPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'zh-HK'));
    await noKeyPage.reload();
    await noKeyPage.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 30000 });
    await noKeyPage.getByTestId('toggle-receipt-text-import').click();

    await noKeyPage.getByTestId('receipt-text-draft').fill(JSON.stringify(jsonPastePayload));
    await noKeyPage.getByTestId('submit-receipt-text').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 2, 'pasted JSON items appear in the normal review step');
    const pastedRows = await noKeyPage.getByTestId('verify-item').allInnerTexts();
    assert.match(pastedRows.join('\n'), /魚蛋/);
    assert.match(pastedRows.join('\n'), /奶茶/);
    assert.match(await noKeyPage.getByTestId('last-recognition-model').innerText(), /JSON.*本機|本機.*JSON/);
    assert.equal(noKeyRequests, 0, 'valid JSON is imported locally without an API key or network request');

    await noKeyPage.locator('.step-nav button').first().click();
    await noKeyPage.getByTestId('toggle-receipt-text-import').click();
    const fencedJson = `\`\`\`json\n${JSON.stringify(filePayload)}\n\`\`\``;
    await noKeyPage.getByTestId('receipt-text-file').setInputFiles({
      name: 'translated-receipt.txt', mimeType: 'text/plain', buffer: Buffer.from(fencedJson, 'utf8')
    });
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 1, 'a text file containing fenced JSON also imports locally');
    assert.match(await noKeyPage.getByTestId('verify-item').first().innerText(), /冰咖啡/);
    assert.equal(noKeyRequests, 0, 'text-file JSON also makes no network request');

    await noKeyPage.locator('.step-nav button').first().click();
    await noKeyPage.getByTestId('toggle-receipt-text-import').click();
    await noKeyPage.getByTestId('receipt-text-draft').fill('拉麵 1 碗 100 元；消費税 8 元；應付 108 元');
    await noKeyPage.getByTestId('submit-receipt-text').click();
    await noKeyPage.getByTestId('receipt-text-import-error').waitFor({ state: 'visible' });
    assert.match(await noKeyPage.getByTestId('receipt-text-import-error').innerText(), /OpenRouter.*JSON|JSON.*OpenRouter/);
    assert.equal(noKeyRequests, 0, 'non-JSON text without a key is not sent anywhere');
    await noKeyContext.close();

    const modelContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const modelPage = await modelContext.newPage();
    modelPage.on('pageerror', error => failures.push(error.message));
    await modelPage.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      modelRequests += 1;
      const body = route.request().postDataJSON();
      capturedModel = body.model;
      const userMessage = body.messages?.find(message => message.role === 'user');
      const content = userMessage?.content;
      const parts = Array.isArray(content) ? content : [{ type: 'text', text: String(content || '') }];
      capturedText = parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
      capturedImageCount = parts.filter(part => part.type === 'image_url').length;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(textModelPayload) } }] })
      });
    });
    await initStorage(modelPage, {
      engine: 'openrouter', ocrEngine: 'openrouter',
      keys: { openrouter: 'local-test-key' }, model: DOTS,
      allowPaidModels: false, ocrModelPreferenceVersion: 3
    });
    await modelPage.getByTestId('toggle-receipt-text-import').click();
    const pastedText = '芒果糯米飯 1 份 65 泰銖\n收據總額 65 泰銖';
    await modelPage.getByTestId('receipt-text-draft').fill(pastedText);
    await modelPage.getByTestId('submit-receipt-text').click();
    await modelPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(modelRequests, 1, 'plain translated text is structured by the selected free model');
    assert.equal(capturedModel, DOTS);
    assert.match(capturedText, /芒果糯米飯 1 份 65 泰銖/);
    assert.equal(capturedImageCount, 0, 'text-only requests contain no image payload');
    assert.match(await modelPage.getByTestId('verify-item').first().innerText(), /芒果糯米飯/);
    assert.match(await modelPage.getByTestId('last-recognition-model').innerText(), /文字整理.*Dots3-Note|text input.*Dots3-Note/i);
    assert.deepEqual(failures, [], failures.join('\n'));
    await modelContext.close();

    console.log('PASS: copied photo-reading JSON prompt; pasted and .txt JSON imported locally without a key; free-form text used Dots as text-only; no image was sent.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
