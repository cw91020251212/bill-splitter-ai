'use strict';
// Local-only regression test. Uses the repository's clearly synthetic receipt fixture,
// intercepts OCR, and never sends receipt data or credentials to an external service.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:49179/ node tests/step2-receipt-preview-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:49179/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
  throw new Error('This state-writing test only runs against a local server.');
}
const outputDir = process.env.TEST_OUTPUT_DIR || path.resolve(__dirname, '../artifacts');
const previewPath = path.join(outputDir, 'step2-receipt-preview-390.png');
const enlargedPath = path.join(outputDir, 'step2-receipt-preview-enlarged-390.png');
const syntheticReceipt = fs.readFileSync(path.join(__dirname, 'fixtures', 'receipt-preview.png'));
const syntheticSecondReceipt = fs.readFileSync(path.join(__dirname, 'fixtures', 'card-redaction-synthetic.png'));
const receiptPayload = {
  items: [{ name: '合成測試餐', nameEn: 'Synthetic test item', original: 'TEST ITEM', price: 100, qty: 1, total: 100 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 100
};

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  let ocrRequests = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.addInitScript(() => {
      window.showOpenFilePicker = async () => [];
      window.Tesseract = {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => ({ data: { lines: [] } }),
          terminate: async () => {}
        })
      };
    });
    await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      ocrRequests += 1;
      const body = route.request().postDataJSON();
      const userMessage = body.messages?.find(message => message.role === 'user')?.content;
      assert(Array.isArray(userMessage), 'mock OCR request must send the synthetic receipt as an image part');
      assert.equal(userMessage.filter(part => part.type === 'image_url').length, 2, 'only the two synthetic receipts reach the mock');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(receiptPayload) } }] })
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
        engine: 'openrouter',
        ocrEngine: 'openrouter',
        keys: { openrouter: 'local-test-key' },
        model: 'dots-studio/dots-3-note-preview:free',
        allowPaidModels: false,
        ocrModelPreferenceVersion: 5
      }));
    });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('receipt-upload').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    await page.getByTestId('add-new-receipt-photos').click();
    await page.getByTestId('receipt-ocr-file-input').setInputFiles([
      { name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: syntheticReceipt },
      { name: 'synthetic-second-receipt.png', mimeType: 'image/png', buffer: syntheticSecondReceipt }
    ]);
    await page.getByTestId('redaction-next-or-finish').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.getByText('第 2 / 2 張').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });

    const sourceCard = page.getByTestId('source-receipt-card');
    await sourceCard.waitFor({ state: 'visible', timeout: 15000 });
    assert.match(await sourceCard.innerText(), /已讀取的單據圖片（2 張）/);
    assert.match(await sourceCard.innerText(), /點圖片放大對照/);
    const thumbnail = page.locator('[data-testid="source-receipt-image-0"] img');
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="source-receipt-image-0"] img');
      return image?.complete && image.naturalWidth > 0;
    }, null, { timeout: 10000 });
    const dimensions = await thumbnail.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
    assert.deepEqual(dimensions, { width: 720, height: 960 }, 'the same receipt image is visible at its original aspect ratio');
    const secondThumbnail = page.locator('[data-testid="source-receipt-image-1"] img');
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="source-receipt-image-1"] img');
      return image?.complete && image.naturalWidth > 0;
    }, null, { timeout: 10000 });
    const secondDimensions = await secondThumbnail.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
    assert.deepEqual(secondDimensions, { width: 960, height: 600 }, 'the second synthetic receipt is displayed separately');
    assert.match(await page.getByTestId('verify-item').innerText(), /合成測試餐[\s\S]*100\.00/, 'the recognized result remains available beside the source photo');
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert(overflow.page <= overflow.viewport, `the 390px review screen has no horizontal overflow: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: previewPath, fullPage: false });

    await page.getByTestId('source-receipt-image-0').click();
    const dialog = page.getByTestId('source-receipt-dialog');
    await page.waitForFunction(() => document.querySelector('[data-testid="source-receipt-dialog"]')?.open === true);
    const enlarged = page.getByTestId('source-receipt-dialog-image');
    await enlarged.waitFor({ state: 'visible' });
    assert.deepEqual(await enlarged.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })), dimensions);
    assert.match(await page.getByTestId('source-receipt-dialog-title').innerText(), /收據 1／2/);
    const previousPhoto = page.getByRole('button', { name: '上一張收據' });
    const nextPhoto = page.getByRole('button', { name: '下一張收據' });
    assert.equal(await previousPhoto.isDisabled(), true, 'the first photo has no previous photo');
    assert.equal(await nextPhoto.isDisabled(), false, 'the first photo can advance');
    await page.screenshot({ path: enlargedPath, fullPage: false });
    await nextPhoto.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="source-receipt-dialog-title"]')?.textContent.includes('收據 2／2'));
    assert.deepEqual(await enlarged.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })), secondDimensions);
    assert.equal(await nextPhoto.isDisabled(), true, 'the last photo has no next photo');
    assert.equal(await previousPhoto.isDisabled(), false, 'the last photo can go back');
    await previousPhoto.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="source-receipt-dialog-title"]')?.textContent.includes('收據 1／2'));
    assert.deepEqual(await enlarged.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })), dimensions);
    await page.getByRole('button', { name: '關閉收據圖片' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="source-receipt-dialog"]')?.open === false);
    assert.equal(await page.getByTestId('verify-item').count(), 1, 'closing the photo viewer leaves the recognized line intact');

    await page.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      return Boolean(draft?.hasAssets && draft.data?.step === 2 && draft.data?.items?.length === 1);
    }, null, { timeout: 15000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByTestId('source-receipt-card').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="source-receipt-image-0"] img');
      return image?.complete && image.naturalWidth === 720 && image.naturalHeight === 960;
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="source-receipt-image-1"] img');
      return image?.complete && image.naturalWidth === 960 && image.naturalHeight === 600;
    }, null, { timeout: 15000 });
    assert.equal(await page.getByTestId('verify-item').count(), 1, 'the existing OCR result also survives reload');
    assert.equal(ocrRequests, 1, 'reopening the draft does not call OCR again');
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('PASS 390px local UI: two synthetic receipts appear in Step 2, switch in the accessible enlarged viewer, close without changing OCR results, and remain visible after draft reload.');
    console.log(`SCREENSHOT ${previewPath}`);
    console.log(`ENLARGED_SCREENSHOT ${enlargedPath}`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
