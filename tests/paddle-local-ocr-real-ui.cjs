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
  const browserErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const startedRequests = new Map();
  const completedRequests = [];
  let requestBody = null;
  let requestCount = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('request', request => startedRequests.set(request, { url: request.url(), type: request.resourceType(), startedAt: Date.now() }));
  page.on('requestfailed', request => {
    failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' });
    startedRequests.delete(request);
  });
  page.on('response', response => {
    const request = startedRequests.get(response.request());
    if (request) request.status = response.status();
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfinished', request => {
    const record = startedRequests.get(request);
    if (record) completedRequests.push({ ...record, durationMs: Date.now() - record.startedAt });
    startedRequests.delete(request);
  });
  await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
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
        model: 'dots-studio/dots-3-note-preview:free', allowPaidModels: false, ocrModelPreferenceVersion: 4
      }));
    });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
    const keyGuidanceToggle = page.getByTestId('toggle-key-guidance');
    if (await keyGuidanceToggle.getAttribute('aria-expanded') !== 'true') await keyGuidanceToggle.click();
    const scanSelect = page.getByTestId('scan-model-select');
    await scanSelect.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForFunction(() => {
      const config = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
      return config?.ocrModelPreferenceVersion === 5 && config?.ocrEngine === 'paddlejs' && config?.model === 'dots-studio/dots-3-note-preview:free';
    });
    assert.equal(await scanSelect.inputValue(), LOCAL, 'legacy OpenRouter config automatically selects the Paddle + Dots default');
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    await page.getByTestId('add-new-receipt-photos').click();
    await page.getByTestId('receipt-ocr-file-input').setInputFiles({
      name: 'r118-receipt-masked.jpg', mimeType: 'image/jpeg', buffer: image
    });
    await page.getByTestId('redaction-next-or-finish').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    try {
      await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 120000 });
    } catch (error) {
      const timeoutState = await page.evaluate(() => ({
        step: document.querySelector('[data-live-app] main')?.dataset.currentStep || null,
        progress: document.querySelector('[data-testid="ocr-status"]')?.innerText || '',
        bodyText: (document.querySelector('[data-live-app] main')?.innerText || '').slice(0, 3000)
      }));
      await page.screenshot({ path: '/tmp/paddle-real-debug.png', fullPage: true });
      const pendingRequests = Array.from(startedRequests.values()).map(request => ({ ...request, ageMs: Date.now() - request.startedAt }));
      console.error('PADDLE E2E timeout diagnostics ' + JSON.stringify({ ...timeoutState, requestCount, pageErrors, browserErrors, failedRequests, badResponses, pendingRequests, completedRequests: completedRequests.slice(-30) }));
      throw error;
    }
    const browserState = await page.evaluate(() => {
      const main = document.querySelector('[data-live-app] main');
      return {
        step: main?.dataset.currentStep || null,
        mainText: (main?.innerText || '').slice(0, 5000),
        modelLabels: Array.from(document.querySelectorAll('[data-testid="last-recognition-model"]')).map(node => ({ text: node.innerText, visible: Boolean(node.getClientRects().length) })),
        verifyItems: Array.from(document.querySelectorAll('[data-testid="verify-item"]')).map(node => node.innerText),
        verifyIntro: document.querySelector('[data-testid="verify-intro"]')?.innerText || null,
        ocrProgress: document.querySelector('[data-testid="ocr-status"]')?.innerText || null
      };
    });
    console.log('DEBUG real Paddle state ' + JSON.stringify({ ...browserState, requestCount, pageErrors, browserErrors, failedRequests, badResponses }));
    await page.screenshot({ path: '/tmp/paddle-real-debug.png', fullPage: true });
    await page.getByText('本機 OCR 路徑測試', { exact: false }).waitFor({ state: 'visible', timeout: 30000 });

    const modelAssetRequests = completedRequests
      .filter(request => request.url.includes('/models/paddle/') && request.url.endsWith('.tar'))
      .map(request => ({ name: request.url.split('/').pop(), origin: new URL(request.url).origin, status: request.status }));
    assert.deepEqual(modelAssetRequests.map(request => request.name).sort(), [
      'PP-OCRv5_mobile_det_onnx_infer.tar',
      'PP-OCRv5_mobile_rec_onnx_infer.tar'
    ].sort(), 'both local model archives must be loaded');
    assert(modelAssetRequests.every(request => request.origin === base.origin && request.status === 200), 'both model archives must come from this app origin with HTTP 200');
    assert(!completedRequests.some(request => request.url.includes('paddle-model-ecology.bj.bcebos.com')), 'the browser must not fetch models from the remote Paddle archive host');

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
      verifySummary: await page.getByTestId('verify-summary').innerText()
    };
    const numericHits = [metrics.containsTotal2860, metrics.containsTax260, metrics.containsQuantity22, metrics.containsCash3000, metrics.containsChange140].filter(Boolean).length;
    const missedValues = ['2860', '260', '22', '3000', '140'].filter((value, index) => ![
      metrics.containsTotal2860, metrics.containsTax260, metrics.containsQuantity22, metrics.containsCash3000, metrics.containsChange140
    ][index]);
    assert(numericHits >= 4, `at least four key numeric strings should reach the text request: ${JSON.stringify(metrics)}`);
    assert.match(metrics.verifySummary, /\d+項/);
    assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
    console.log(`PASS real PaddleOCR.js + mocked Dots3-Note data flow; numeric hit rate ${numericHits}/5; no receipt image sent to OpenRouter.`);
    console.log(JSON.stringify({ ...metrics, numericHits, missedValues }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
