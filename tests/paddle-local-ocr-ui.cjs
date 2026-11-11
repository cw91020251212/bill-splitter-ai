'use strict';
// Run a local static server first. The PaddleOCR and OpenRouter calls are
// mocked; this verifies only the app data flow and never sends receipt data.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/paddle-local-ocr-ui.cjs
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const fs = require('node:fs');
const path = require('node:path');
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'receipt-preview.png'));
const DOTS = 'dots-studio/dots-3-note-preview:free';
const LOCAL = 'local/paddleocr-js';
const payload = {
  items: [{ name: '本機測試商品', nameEn: 'Local test item', original: 'テスト商品', ja: '', price: 100, qty: 1, total: 100 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'JPY', date: null, receiptTotal: 100
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let requestCount = 0;
  let requestBody = null;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
    await page.addInitScript(() => {
      window.Tesseract = {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => ({ data: { lines: [] } }),
          terminate: async () => {}
        })
      };
      window.__paddleCalls = [];
      window.PaddleReceiptOcr = {
        engine: 'mock-paddle-local',
        recognizeImages: async (images, onProgress) => {
          window.__paddleCalls.push({ count: images.length, types: images.map(image => image.mimeType), bytes: images.map(image => image.data.length) });
          if (onProgress) { onProgress('loading-sdk'); onProgress('recognizing'); }
          return '[Receipt 1]\nテスト商品 100円\n小計 100円\n合計 100円';
        }
      };
    });
    await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      requestCount += 1;
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })
      });
    });

    await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({
        engine: 'openrouter', ocrEngine: 'openrouter',
        keys: { openrouter: 'local-test-key' }, model: 'dots-studio/dots-3-note-preview:free',
        allowPaidModels: false, ocrModelPreferenceVersion: 5
      }));
    });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
    const keyGuidanceToggle = page.getByTestId('toggle-key-guidance');
    if (await keyGuidanceToggle.getAttribute('aria-expanded') !== 'true') await keyGuidanceToggle.click();
    const scanSelect = page.getByTestId('scan-model-select');
    await scanSelect.waitFor({ state: 'visible', timeout: 60000 });
    await scanSelect.selectOption(LOCAL);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.ocrEngine === 'paddlejs');
    assert.equal(await scanSelect.inputValue(), LOCAL);

    await page.evaluate(base64 => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      window.__receiptPickerCalls = [];
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async options => {
          window.__receiptPickerCalls.push(options);
          const file = new File([bytes], 'synthetic-receipt.png', { type: 'image/png' });
          return [{ getFile: async () => file }];
        }
      });
    }, PNG.toString('base64'));
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    await page.getByTestId('add-new-receipt-photos').click();
    await page.waitForFunction(() => window.__receiptPickerCalls?.length === 1);
    const pickerOptions = await page.evaluate(() => window.__receiptPickerCalls[0]);
    assert.equal(pickerOptions.startIn, 'downloads', 'the primary receipt picker opens Downloads first');
    assert.equal(pickerOptions.multiple, true);
    assert.deepEqual(pickerOptions.types[0].accept, {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp']
    });
    assert.equal(await page.getByTestId('receipt-ocr-file-input').getAttribute('accept'), null, 'the fallback input is not restricted to the media picker');
    await page.getByTestId('redaction-next-or-finish').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByText('本機測試商品', { exact: false }).waitFor({ state: 'visible' });
    await page.getByTestId('verify-summary').waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('verify-summary').innerText(), /^1項/);

    const observed = await page.evaluate(() => ({ calls: window.__paddleCalls, config: JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null') }));
    assert.equal(observed.calls.length, 1, 'the selected local OCR engine runs exactly once');
    assert.deepEqual(observed.calls[0].types, ['image/jpeg'], 'existing card-redaction processing normalizes the locally-recognized image to JPEG');
    assert(observed.calls[0].bytes[0] > 100, 'the browser-local OCR receives the selected image');
    assert.equal(observed.config.ocrEngine, 'paddlejs');
    assert.equal(requestCount, 1, 'recognized text is structured once by OpenRouter');
    assert.equal(requestBody.model, DOTS, 'Paddle local mode uses Dots3-Note for translation/structuring');
    const message = requestBody.messages.find(entry => entry.role === 'user');
    assert(Array.isArray(message.content));
    assert.equal(message.content.filter(part => part.type === 'image_url').length, 0, 'the receipt image is not sent to OpenRouter');
    assert.equal(message.content.filter(part => part.type === 'text').length, 1, 'only one text payload is sent');
    assert.match(message.content[0].text, /本機 PaddleOCR\.js/);
    assert.match(message.content[0].text, /テスト商品 100円/);
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('PASS: local PaddleOCR option persists; browser receives the image; OpenRouter receives text only; concise item/total summary is shown.');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
