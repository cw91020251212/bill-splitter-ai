'use strict';

// Local-only UI test. It uses a synthetic receipt image and a mocked on-device OCR worker.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/card-redaction-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) {
  throw new Error('This state-writing test only runs against a local server.');
}
const fixturePath = path.join(__dirname, 'fixtures', 'card-redaction-synthetic.png');
const fixtureBase64 = fs.readFileSync(fixturePath).toString('base64');
const outputDir = process.env.TEST_OUTPUT_DIR || path.resolve(__dirname, '../artifacts');
const revision = 'synthetic-card-redaction-test-v1';
const draft = {
  schema: 1,
  assetRevision: revision,
  hasAssets: true,
  data: {
    step: 3,
    items: [{ id: '01', name: '午餐', nameEn: 'Lunch', original: 'Lunch set', price: 123, qty: 1, total: 123, totalQty: null, unit: '' }],
    readReceipt: true,
    taxAmount: '0', discountAmount: '0', taxNote: '', receiptAdjustmentDetails: null,
    friendsReplies: '姓名：阿明\n01 = 1\n\n姓名：小美\n01 = 1',
    payer: '阿明', detectedCurrency: 'HKD', currency: 'HKD', taxSplitMethod: 'proportional',
    paymentMethods: ['現金'], results: null, reconciliation: null, isSaved: false,
    claimRoom: null, claimInboxSeen: [], claimLinkShared: true
  }
};

async function seed(page, width, height, failOcr = false) {
  await page.setViewportSize({ width, height });
  await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ savedDraft, imageData }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(savedDraft));
    localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
    localStorage.setItem('billSplitterLanguage', 'zh-HK');
    localStorage.setItem('billSplitterHistory', '[]');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('billSplitterLocalData', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('receipts')) request.result.createObjectStore('receipts', { keyPath: 'recordId' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('receipts', 'readwrite');
        transaction.objectStore('receipts').put({
          recordId: 'active-bill-draft-assets-v1',
          revision: savedDraft.assetRevision,
          images: [{ data: imageData, mimeType: 'image/png' }],
          attachments: []
        });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { savedDraft: draft, imageData: fixtureBase64 });
  await page.addInitScript(({ shouldFail }) => {
    window.__mockShareCalls = [];
    window.__cardRedactionTest = true;
    window.Tesseract = {
      createWorker: async () => ({
        setParameters: async () => {},
        recognize: async () => {
          if (shouldFail) throw new Error('synthetic OCR failure');
          return { data: { lines: [{ words: [
            { text: '41111111', bbox: { x0: 270, x1: 407, y0: 374, y1: 400 } },
            { text: '11111111', bbox: { x0: 414, x1: 570, y0: 374, y1: 400 } }
          ] }] } };
        },
        terminate: async () => { window.__ocrWorkerTerminated = true; }
      })
    };
  }, { shouldFail: failOcr });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 60000 });
  await page.getByTestId('calculate-split').click();
  await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 15000 });
  assert.equal(await page.getByTestId('late-person-flow-details').evaluate(node => node.open), false, 'the two-direction guide starts collapsed');
  assert.match(await page.getByTestId('late-person-flow-summary').innerText(), /漏咗朋友？點樣補加/);
  assert.equal(await page.getByTestId('missing-bill-flow-details').evaluate(node => node.open), false, 'the guide replacing the circled share button starts collapsed');
  assert.match(await page.getByTestId('missing-bill-flow-summary').innerText(), /漏咗帳單？點樣補加/);
  await page.getByTestId('missing-bill-flow-summary').click();
  assert.match(await page.getByTestId('receipt-redaction-default-note').innerText(), /卡號預設在本機遮蓋/);
  const shareButtonStyle = await page.getByTestId('share-receipt-images').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, height: Math.round(button.getBoundingClientRect().height) }));
  assert.deepEqual(shareButtonStyle, { background: 'rgb(255, 255, 255)', height: 44 }, 'share-bill action uses a compact white 44px button');
  const addAnotherButton = page.getByTestId('share-bill-direction').getByTestId('attach-receipt-image');
  assert.equal(await addAnotherButton.isVisible(), true, 'users can add another photo after one is attached');
  const addButtonStyle = await addAnotherButton.evaluate(button => ({ background: getComputedStyle(button).backgroundColor, height: Math.round(button.getBoundingClientRect().height) }));
  assert.deepEqual(addButtonStyle, { background: 'rgb(255, 255, 255)', height: 44 }, 'adding another bill photo stays white and 44px high');
  await page.getByTestId('share-receipt-images').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: data => Array.isArray(data?.files) && data.files.length > 0 && data.files.every(file => file.type === 'image/jpeg')
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async data => {
        window.__mockShareCalls.push({
          names: (data.files || []).map(file => file.name),
          types: (data.files || []).map(file => file.type),
          sizes: (data.files || []).map(file => file.size),
          text: data.text || '',
          files: data.files || []
        });
      }
    });
  });
}

async function openReview(page) {
  await page.getByTestId('share-receipt-images').click();
  await page.getByTestId('card-redaction-status').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('card-redaction-preview').waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('card-redaction-status').innerText(), /自動遮蓋 1 個疑似卡號/);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const failures = [];
  try {
    const context320 = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
    const page320 = await context320.newPage();
    page320.on('pageerror', error => failures.push(`320px: ${error.message}`));
    await seed(page320, 320, 800, false);
    await openReview(page320);
    await page320.evaluate(() => { window.__initialRedactionPreview = document.querySelector('[data-testid="card-redaction-preview"]'); });
    await page320.waitForTimeout(250);
    assert.equal(await page320.evaluate(() => window.__initialRedactionPreview === document.querySelector('[data-testid="card-redaction-preview"]')), true, 'the preview image remains mounted after loading');
    await page320.screenshot({ path: path.join(outputDir, 'card-redaction-review-320.png'), fullPage: false });
    const preview320 = await page320.evaluate(() => {
      const dialog = document.querySelector('[data-testid="card-share-review"]');
      const preview = document.querySelector('[data-testid="card-redaction-preview"]');
      const share = document.querySelector('[data-testid="card-redaction-share"]');
      return {
        dialogWidth: Math.round(dialog.getBoundingClientRect().width),
        previewWidth: Math.round(preview.getBoundingClientRect().width),
        shareBottom: Math.round(share.getBoundingClientRect().bottom),
        viewportHeight: innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    assert.ok(preview320.dialogWidth <= 320);
    assert.ok(preview320.previewWidth <= 288);
    assert.equal(preview320.horizontalOverflow, false);
    assert.ok(preview320.shareBottom <= preview320.viewportHeight, 'the share button fits in the 320px review viewport');

    const pixel = await page320.evaluate(async () => {
      const file = document.querySelector('[data-testid="card-redaction-preview"]');
      const canvas = document.createElement('canvas');
      canvas.width = file.naturalWidth;
      canvas.height = file.naturalHeight;
      canvas.getContext('2d').drawImage(file, 0, 0);
      return Array.from(canvas.getContext('2d').getImageData(400, 386, 1, 1).data);
    });
    assert.deepEqual(pixel.slice(0, 3), [0, 0, 0], 'the preview is a flattened copy with black pixels over the synthetic card number');

    await page320.getByTestId('card-redaction-share').click();
    await page320.waitForFunction(() => window.__mockShareCalls.length === 1);
    const share320 = await page320.evaluate(() => ({
      names: window.__mockShareCalls[0].names,
      types: window.__mockShareCalls[0].types,
      sizes: window.__mockShareCalls[0].sizes,
      text: window.__mockShareCalls[0].text
    }));
    assert.deepEqual(share320.names, ['receipt-masked-01.jpg']);
    assert.deepEqual(share320.types, ['image/jpeg']);
    assert.equal(share320.text, '', 'receipt share sends only image files');
    assert.ok(share320.sizes[0] > 0);
    const originalBase64 = await page320.evaluate(async () => new Promise((resolve, reject) => {
      const request = indexedDB.open('billSplitterLocalData', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('receipts', 'readonly').objectStore('receipts').get('active-bill-draft-assets-v1');
        get.onsuccess = () => { const value = get.result.images[0].data; db.close(); resolve(value); };
        get.onerror = () => { db.close(); reject(get.error); };
      };
    }));
    assert.equal(originalBase64, fixtureBase64, 'the original IndexedDB image remains byte-for-byte unchanged');
    const localStorageText = await page320.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key)).join('\n'));
    assert.equal(localStorageText.includes('4111111111111111'), false, 'OCR card-number text is not written to local storage');
    assert.equal(await page320.getByTestId('card-share-review').count(), 0, 'the review closes after the mock share sheet opens');
    await context320.close();

    const context390 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page390 = await context390.newPage();
    page390.on('pageerror', error => failures.push(`390px: ${error.message}`));
    await seed(page390, 390, 844, false);
    await openReview(page390);
    await page390.waitForTimeout(250);
    await page390.screenshot({ path: path.join(outputDir, 'card-redaction-review-390.png'), fullPage: false });
    const preview390 = await page390.evaluate(() => {
      const preview = document.querySelector('[data-testid="card-redaction-preview"]');
      const share = document.querySelector('[data-testid="card-redaction-share"]');
      return { previewWidth: Math.round(preview.getBoundingClientRect().width), shareBottom: Math.round(share.getBoundingClientRect().bottom), viewportHeight: innerHeight };
    });
    assert.ok(preview390.previewWidth <= 358);
    assert.ok(preview390.shareBottom <= preview390.viewportHeight, 'the share button fits in the 390px review viewport');
    await page390.getByTestId('card-redaction-draw-toggle').click();
    const box = await page390.getByTestId('card-redaction-canvas').boundingBox();
    await page390.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.18);
    await page390.mouse.down();
    await page390.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.24, { steps: 3 });
    await page390.mouse.up();
    await page390.getByText('已遮蓋 2 處', { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
    await page390.getByTestId('card-redaction-draw-toggle').click();
    await page390.getByRole('button', { name: '撤銷上一框' }).click();
    await page390.getByText('已遮蓋 1 處', { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
    await page390.getByTestId('card-redaction-share').click();
    await page390.waitForFunction(() => window.__mockShareCalls.length === 1);
    await context390.close();

    const contextFail = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
    const pageFail = await contextFail.newPage();
    pageFail.on('pageerror', error => failures.push(`failure scenario: ${error.message}`));
    await seed(pageFail, 320, 800, true);
    await pageFail.getByTestId('share-receipt-images').click();
    await pageFail.getByTestId('card-redaction-error').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await pageFail.getByTestId('card-redaction-share').count(), 0, 'OCR failure does not reveal a path to share originals');
    assert.equal(await pageFail.evaluate(() => window.__mockShareCalls.length), 0);
    await contextFail.close();

    assert.deepEqual(failures, [], failures.join('\n'));
    console.log('PASS card-redaction UI: synthetic fake card masked in share-copy preview at 320px and 390px; original image preserved; share payload contains only redacted JPEG; manual mask/undo works; OCR failure blocks sharing.');
    console.log(`PREVIEWS ${path.join(outputDir, 'card-redaction-review-320.png')} ${path.join(outputDir, 'card-redaction-review-390.png')}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
