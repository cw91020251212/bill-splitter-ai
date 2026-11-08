'use strict';
// Real PaddleOCR.js browser inference against the redacted benchmark receipt;
// OpenRouter is intercepted locally and no receipt text/image is sent externally.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ REDACTED_IMAGE=/tmp/r118-receipt-masked.jpg node tests/paddle-local-ocr-real-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
const imagePath = process.env.REDACTED_IMAGE || '/tmp/r118-receipt-masked.jpg';
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
if (!fs.existsSync(imagePath)) throw new Error('The redacted receipt benchmark image is missing.');
const image = fs.readFileSync(imagePath);
const DOTS = 'dots-studio/dots-3-note-preview:free';
const LOCAL = 'local/paddleocr-js';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  let requestBody = null;
  let requestCount = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.Tesseract = {
      createWorker: async () => ({
        setParameters: async () => {},
        recognize: async () => ({ data: { lines: [] } }),
        terminate: async () => {}
      })
    };
  });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    requestCount += 1;
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        items: [{ name: '本機 OCR 路徑測試', nameEn: 'Local OCR path test', original: 'テスト', ja: '', price: 100, qty: 1, total: 100 }],
        adjustments: [], taxTotal: 0, taxNote: '', currency: 'JPY', date: null, receiptTotal: 100
      }) } }] })
    });
  });
  try {
    await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({
        engine: 'openrouter', ocrEngine: 'openrouter', keys: { openrouter: 'local-test-key' },
        model: 'dots-studio/dots-3-note-preview:free', allowPaidModels: false, ocrModelPreferenceVersion: 3
      }));
    });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
    const scanSelect = page.getByTestId('scan-model-select');
    await scanSelect.waitFor({ state: 'visible', timeout: 60000 });
    await scanSelect.selectOption(LOCAL);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.ocrEngine === 'paddlejs');
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    await page.getByTestId('add-new-receipt-photos').click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'r118-receipt-masked.jpg', mimeType: 'image/jpeg', buffer: image
    });
    await page.getByTestId('redaction-next-or-finish').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 240000 });
    await page.getByTestId('last-recognition-model').waitFor({ state: 'visible', timeout: 240000 });
    await page.getByText('本機 OCR 路徑測試', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });

    assert.equal(requestCount, 1, 'the real local OCR output is structured once');
    assert.equal(requestBody.model, DOTS, 'Dots3-Note is the default text structuring model');
    const userContent = requestBody.messages.find(message => message.role === 'user')?.content;
    assert(Array.isArray(userContent));
    assert.equal(userContent.filter(part => part.type === 'image_url').length, 0, 'the original receipt image never reaches OpenRouter');
    assert.equal(userContent.filter(part => part.type === 'text').length, 1);
    const text = userContent[0].text;
    assert.match(text, /以下是本機 PaddleOCR\.js/);
    const rawText = text.split('以下是本機 PaddleOCR.js')[1] || '';
    const normalized = rawText.replace(/[\s,，]/g, '');
    const metrics = {
      inputBytes: image.length,
      textCharacters: rawText.length,
      containsTotal2860: normalized.includes('2860'),
      containsTax260: normalized.includes('260'),
      containsQuantity22: normalized.includes('22'),
      containsCash3000: normalized.includes('3000'),
      containsChange140: normalized.includes('140'),
      label: await page.getByTestId('last-recognition-model').innerText()
    };
    const numericHits = [metrics.containsTotal2860, metrics.containsTax260, metrics.containsQuantity22, metrics.containsCash3000, metrics.containsChange140].filter(Boolean).length;
    const missedValues = ['2860', '260', '22', '3000', '140'].filter((value, index) => ![
      metrics.containsTotal2860, metrics.containsTax260, metrics.containsQuantity22, metrics.containsCash3000, metrics.containsChange140
    ][index]);
    assert(numericHits >= 4, `at least four key numeric strings should reach the text request: ${JSON.stringify(metrics)}`);
    assert.match(metrics.label, /PaddleOCR\.js/);
    assert.match(metrics.label, /Dots3-Note/);
    assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
    console.log(`PASS real PaddleOCR.js + mocked Dots3-Note data flow; numeric hit rate ${numericHits}/5; no receipt image sent to OpenRouter.`);
    console.log(JSON.stringify({ ...metrics, numericHits, missedValues }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
