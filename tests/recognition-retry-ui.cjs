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
const detailedViewScreenshotPath = path.join(outputDir, 'detailed-view-preview.png');
const detailedViewInitialScreenshotPath = path.join(outputDir, 'detailed-view-before-select.png');
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'receipt-preview.png')).toString('base64');
const DEFAULT_MODEL = 'dots-studio/dots-3-note-preview:free';
const FALLBACK_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
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
    // Keep this sharing-flow test independent of CDN-hosted Tesseract/WASM.
    // Real checksum detection and mask geometry are covered by card-redaction-ui.cjs.
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
      const body = route.request().postDataJSON();
      observedModels.push(body.model);
      const content = body.messages?.find(message => message.role === 'user')?.content;
      observedImageCounts.push(Array.isArray(content) ? content.filter(part => part.type === 'image_url').length : 0);
      if (requestCount === 1) {
        const promptText = Array.isArray(content) ? content.find(part => part.type === 'text')?.text || '' : '';
        assert.match(promptText, /每個新的商品名稱若有自己的右欄金額/);
        assert.match(promptText, /小計、合計、內稅對象額/);
      }
      if (requestCount === 1) {
        assert.equal(body.model, DEFAULT_MODEL, 'the user-confirmed Dots3-Note default is tried first');
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit exceeded' } }) });
        return;
      }
      if (requestCount === 2) {
        assert.equal(body.model, FALLBACK_MODEL, 'a busy Dots3-Note falls through to the last-resort Nemotron 3.5 VL');
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
        ocrEngine: 'openrouter',
        keys: { openrouter: 'local-test-key' },
        model: 'dots-studio/dots-3-note-preview:free',
        allowPaidModels: false,
        ocrModelPreferenceVersion: 4
      }));
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('receipt-upload').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('receipt-image-action-menu').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('reuse-last-receipt-photos').isDisabled(), true, 'reuse is unavailable before there is a stored image batch');
    await page.getByTestId('add-new-receipt-photos').click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'first-receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG, 'base64')
    });
    await page.getByTestId('redaction-next-or-finish').waitFor({ state: 'visible' });
    await page.getByTestId('redaction-next-or-finish').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByText('首次成功結果', { exact: false }).waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('last-recognition-model').innerText(), /Nemotron 3.5 VL/);

    await page.locator('.step-nav button').first().click();
    await page.getByTestId('receipt-upload').click();
    const reuseFirstBatch = page.getByTestId('reuse-last-receipt-photos');
    await reuseFirstBatch.waitFor({ state: 'visible' });
    assert.equal(await reuseFirstBatch.isDisabled(), false, 'the first successful photo batch can be reused');
    assert.match(await reuseFirstBatch.innerText(), /重用整批 1 張相片/);
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
    assert.match(await page.getByTestId('last-recognition-model').innerText(), /Dots3-Note/);

    await page.locator('.step-nav button').first().click();
    await page.getByTestId('receipt-upload').click();
    await page.getByTestId('reuse-last-receipt-photos').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    await page.getByTestId('recognition-retry-error').waitFor({ state: 'visible' });
    assert.match(await page.getByTestId('recognition-retry-error').innerText(), /仍保留上次成功結果/);
    await page.getByText('重新識別結果', { exact: false }).waitFor({ state: 'visible' });
    assert.equal(requestCount, 6, 'final retry cascades through the two retained free models before returning the prior result');
    assert.equal(observedModels[0], DEFAULT_MODEL);
    assert.equal(observedModels[1], FALLBACK_MODEL);
    assert.equal(observedModels[5], 'nvidia/nemotron-3.5-super-vl:free', 'the user-reported unreliable Nemotron 3.5 is attempted last');
    assert.deepEqual(failures, [], failures.join('\n'));
    console.log(`PASS 390px local UI: reuse is disabled before success, add-new batch of two photos, whole-batch re-recognition without reopening the picker, successful replacement, and failed retry preserving results (${requestCount} mocked OCR requests).`);

    await page.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      return Boolean(draft?.hasAssets && draft.data?.step === 2 && draft.data?.items?.length);
    }, null, { timeout: 15000 });
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1'));
      draft.data.step = 3;
      draft.data.friendsReplies = '姓名：阿明\n01 = 0.166666666\n姓名：小美\n01 = 0.166666666\n姓名：阿強\n01 = 0.166666666\n姓名：阿欣\n01 = 0.166666666\n姓名：家豪\n01 = 0.166666666\n姓名：嘉嘉\n01 = 0.166666666';
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
    await page.waitForFunction(() => document.querySelector('[data-testid="draft-status"]')?.textContent.includes('草稿已儲存在') || document.querySelector('[data-testid="draft-status"]')?.textContent.includes('saving') || document.querySelector('[data-testid="calculate-split"]'), null, { timeout: 15000 });
    await page.getByTestId('calculate-split').click();
    await page.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '4', null, { timeout: 15000 });
    const receiptImageButton = page.getByTestId('share-receipt-images');
    await receiptImageButton.waitFor({ state: 'visible' });
    assert.match(await receiptImageButton.getAttribute('class'), /!bg-emerald-700/, 'receipt sharing is a prominent green button');
    assert.equal(await receiptImageButton.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(4, 120, 87)', 'the receipt button renders with a green background');
    assert.equal(await page.getByTestId('receipt-next-step').count(), 0, 'the separate second-step receipt card is removed');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: data => Array.isArray(data?.files) && data.files.length > 0
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: data => {
          window.__lastMockShare = {
            fileCount: data.files?.length || 0,
            fileTypes: data.files?.map(file => file.type) || [],
            text: data.text || ''
          };
          return Promise.resolve();
        }
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await receiptImageButton.click();
    await page.getByTestId('card-redaction-status').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('card-redaction-share').click();
    await page.waitForFunction(() => window.__lastMockShare?.fileCount > 0);
    const receiptShare = await page.evaluate(() => window.__lastMockShare);
    assert.equal(receiptShare.fileCount, 2, 'the green button shares both images in the current receipt batch');
    assert.equal(receiptShare.fileTypes.length, 2);
    assert.ok(receiptShare.fileTypes.every(type => type.startsWith('image/')), 'every shared file remains an image after receipt processing');
    assert.equal(receiptShare.text, '', 'receipt images are shared without attaching the report text');
    await page.evaluate(() => { window.__lastMockShare = null; });
    await page.getByTestId('report-fallback-toggle').click();
    const reportShareButton = page.getByTestId('summary-report-actions').getByRole('button', { name: '分享報告' });
    await reportShareButton.waitFor({ state: 'visible' });
    await reportShareButton.scrollIntoViewIfNeeded();
    const scrollBeforeReportShare = await page.evaluate(() => Math.round(window.scrollY));
    await reportShareButton.click();
    await page.waitForFunction(() => window.__lastMockShare?.text?.length > 0);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), scrollBeforeReportShare, 'report sharing does not change the page scroll position on return');
    assert.equal(await page.getByTestId('receipt-next-step').count(), 0, 'the second-step receipt card remains removed');
    console.log('PASS 390px receipt sharing: review then explicit confirm sends image files to the mock share API; report sharing does not auto-scroll.');

    await page.getByTestId('open-detailed-table-preview').scrollIntoViewIfNeeded();
    const previewPopup = page.waitForEvent('popup');
    await page.getByTestId('open-detailed-table-preview').click();
    const previewPage = await previewPopup;
    await previewPage.waitForLoadState('domcontentloaded');
    const memberSelect = previewPage.getByTestId('member-select');
    await memberSelect.waitFor({ state: 'visible' });
    assert.equal(await previewPage.locator('#member-gate h1').innerText(), '朋友埋單', 'the initial screen shows the friend checkout heading');
    assert.equal(await memberSelect.locator('option').count(), 7, 'the vertical name selector lists all six friends plus its prompt');
    assert.equal(await previewPage.locator('#member-content').isVisible(), false, 'no bill content appears before a member is selected');
    assert.equal(await previewPage.getByTestId('preview-grand-total').isVisible(), false, 'no payable amount is shown before selection');
    assert.equal(await previewPage.locator('[data-testid="detail-items-table"]').isVisible(), false, 'the item table stays hidden before selection');
    assert.equal(await previewPage.locator('#personal-breakdown').isVisible(), false, 'no personal breakdown appears before selection');
    assert.equal(await previewPage.locator('#receipt-content .receipt-photo').count(), 0, 'receipt photos are not loaded before selection');
    assert.equal(await previewPage.locator('#local-tag').isVisible(), false, 'the initial view contains no extra preview label');
    await previewPage.screenshot({ path: detailedViewInitialScreenshotPath, fullPage: true });
    console.log(`TABLE_INITIAL_SCREENSHOT ${detailedViewInitialScreenshotPath}`);

    await memberSelect.selectOption({ label: '阿明' });
    await previewPage.getByTestId('preview-grand-total').waitFor({ state: 'visible' });
    assert.equal(await previewPage.locator('#page-title').innerText(), '阿明嘅賬單', 'the page clearly identifies whose bill is shown');
    assert.equal(await previewPage.locator('#member-gate h1').innerText(), '切換成員', 'the selected state labels the member switcher');
    assert.equal(await memberSelect.inputValue(), '阿明', 'the selected member remains visible in the selector');
    assert.match(await previewPage.locator('#total-label').innerText(), /^你要埋單幾多（HKD）$/, 'the payable total label includes the settlement currency');
    assert.match(await previewPage.getByTestId('preview-grand-total').innerText(), /16\.66/, 'the selected member sees the cent-adjusted payable amount');
    assert.equal(await previewPage.locator('#items-title').innerText(), '項目明細', 'the selected view labels the item details');
    assert.ok(await previewPage.locator('[data-testid="personal-item-row"]').count() > 0, 'the table shows this member’s allocated items');
    assert.match(await previewPage.locator('[data-testid="personal-item-row"]').first().innerText(), /16\.666667/, 'the item row preserves source-share precision rather than showing the rounded settlement total');
    assert.equal(await previewPage.locator('#item-rows').innerText().then(text => ['小美', '阿強', '阿欣', '家豪', '嘉嘉'].some(name => text.includes(name))), false, 'the selected view does not expose other friends’ names or shares');
    assert.equal(await previewPage.locator('#person-select, [data-filter], button[data-mark]').count(), 0, 'the view has no quick filters or eat/buy controls');
    assert.equal(await previewPage.locator('.item-details').first().evaluate(node => node.open), false, 'item source details are collapsed by default');
    assert.equal(await previewPage.getByTestId('other-details').evaluate(node => node.open), false, 'other bill details are collapsed by default');
    await previewPage.waitForFunction(() => document.querySelectorAll('#receipt-content .receipt-photo img').length === 2, null, { timeout: 10000 });
    assert.equal(await previewPage.locator('#receipt-content .receipt-photo').count(), 2, 'local receipt images appear after selecting a member');
    await previewPage.screenshot({ path: detailedViewScreenshotPath, fullPage: true });
    console.log(`TABLE_SCREENSHOT ${detailedViewScreenshotPath}`);
    await memberSelect.selectOption({ label: '小美' });
    assert.match(await previewPage.getByTestId('preview-grand-total').innerText(), /16\.66/, 'the second member receives the other cent-adjusted share');
    assert.equal(await previewPage.locator('#page-title').innerText(), '小美嘅賬單', 'switching the name updates the bill heading');
    await previewPage.locator('.item-details summary').first().click();
    assert.match(await previewPage.locator('.item-details').first().innerText(), /單據原文/, 'the optional item source can be opened when needed');
    await previewPage.locator('.receipt-photo').first().click();
    assert.equal(await previewPage.locator('#photo-dialog').evaluate(node => node.open), true, 'tapping a receipt thumbnail opens it for a closer look');
    console.log('PASS 390px detailed table: starts with only member selection; six-member dropdown reveals only the selected friend’s payable amount and items, then local receipt photos load and can be enlarged.');

    console.log(`SCREENSHOT ${screenshotPath}`);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
