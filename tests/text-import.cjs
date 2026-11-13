'use strict';
// Run the local app server first. OpenRouter is intercepted in-browser; no real key
// or receipt data leaves the test environment.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/text-import.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const syntheticReceipt = fs.readFileSync(path.join(__dirname, 'fixtures', 'card-redaction-synthetic.png'));

const DOTS = 'dots-studio/dots-3-note-preview:free';
const jsonPastePayload = {
  items: [
    { name: '魚蛋', nameEn: 'Fish balls', original: '魚蛋', ja: '', price: 25, qty: 2, totalQty: 2, unit: '碗', total: 50 },
    { name: '奶茶', nameEn: 'Milk tea', original: '奶茶', ja: '', price: 18, qty: 1, totalQty: 1, unit: '杯', total: 18 },
    { name: '免費甜品', nameEn: 'Free dessert', original: '贈品', ja: '', price: 7.5, qty: 2, totalQty: 2, unit: '份', total: 0 }
  ],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 68
};
const filePayload = {
  items: [{ name: '冰咖啡', nameEn: 'Iced coffee', original: '冰咖啡', ja: '', price: 32, qty: 1, totalQty: 1, unit: '杯', total: 32 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 32
};
const ambiguousJsonPayload = {
  items: [
    { name: '羊肉餃8S55', price: 55, qty: 1, total: 55, totalQty: null, unit: '' },
    { name: '牛肉餃8S55', price: 55, qty: 8, totalQty: null, unit: '' },
    { name: '牛肉餃8S55（列總額）', price: 55, qty: 8, total: 55, totalQty: null, unit: '' },
    { name: '八件明確總額', price: 55, qty: 8, total: 440, totalQty: null, unit: '' },
    { name: '用途不確定商品', qty: 1, amountUncertain: true, totalQty: null, unit: '' },
    { name: '原始單價含 S', price: 'S12.50', qty: 1, total: 12.5, totalQty: null, unit: '' },
    { name: '原始行總額含 S', price: 12.5, qty: 1, total: 'S12.50', totalQty: null, unit: '' }
  ],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: null
};
const textModelPayload = {
  items: [{ name: '芒果糯米飯', nameEn: 'Mango sticky rice', original: 'ข้าวเหนียวมะม่วง', ja: '', price: 65, qty: 1, totalQty: 1, unit: '份', total: 65 }],
  adjustments: [], taxTotal: 0, taxNote: '', currency: 'THB', date: null, receiptTotal: 65
};

const initStorage = async (page, config) => {
  await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
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

const ensureAIImportOpen = async page => {
  const toggle = page.getByTestId('toggle-receipt-text-import');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByTestId('receipt-text-draft').waitFor({ state: 'visible' });
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
      window.__openedUrls = [];
      window.open = (...args) => { window.__openedUrls.push(args); return null; };
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
    assert.equal(await noKeyPage.getByTestId('copy-receipt-json-prompt').isVisible(), true, 'the prompt-copy action is visible without opening the details');
    assert.equal(await noKeyPage.getByTestId('toggle-receipt-text-import').getAttribute('aria-expanded'), 'true', 'first-use AI translation guide starts open');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-toggle-icon').getAttribute('data-direction'), 'up', 'an expanded import panel uses the shared up chevron');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-title').getAttribute('aria-label'), '其他 AI 翻譯');
    assert.match(await noKeyPage.getByTestId('receipt-text-import').innerText(), /提示詞＋賬單＝專用翻譯檔（\.json）/);
    assert.equal(await noKeyPage.getByTestId('external-ai-provider-examples').innerText(), '（Google AI 模式、豆包等）');
    const googleAIButton = noKeyPage.getByTestId('copy-prompt-open-google-ai');
    assert.equal(await googleAIButton.isVisible(), true, 'the combined copy-and-open action is available');
    await googleAIButton.click();
    assert.equal(await noKeyPage.evaluate(() => window.__openedUrls[0]?.[0]), 'https://gemini.google.com/app', 'the combined action opens Google Gemini in a new tab');
    assert.match(await noKeyPage.evaluate(() => window.__copiedPrompt || ''), /一個 Markdown JSON 程式碼區塊/, 'the same action copies the receipt prompt');
    assert.match(await noKeyPage.getByTestId('receipt-text-import').innerText(), /手動附上帳單圖片/ , 'the UI explains that the user attaches the image manually');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import').evaluate(node => node.previousElementSibling?.getAttribute('data-testid') === 'choice-divider'), true, 'the receipt OCR and external AI import paths are separated by “or”');
    await noKeyPage.getByTestId('start-manual').click();
    await noKeyPage.getByTestId('item-name').first().fill('測試項目');
    const removeItem = noKeyPage.getByTestId('remove-item').first();
    assert.match(await removeItem.getAttribute('aria-label'), /刪除項目：測試項目/);
    await removeItem.click({ force: true });
    const removeDialog = noKeyPage.getByTestId('remove-item-dialog');
    await removeDialog.waitFor({ state: 'visible' });
    assert.match(await removeDialog.innerText(), /測試項目/);
    assert.equal(await noKeyPage.getByTestId('keep-remove-item').evaluate(button => button === document.activeElement), true, 'the safe Keep action receives initial focus');
    await noKeyPage.mouse.click(2, 2);
    assert.equal(await removeDialog.evaluate(dialog => dialog.open), true, 'clicking outside the native confirmation does not dismiss it');
    assert.equal(await noKeyPage.getByTestId('remove-item').count(), 1, 'a background click never deletes the item');
    await noKeyPage.keyboard.press('Escape');
    await removeDialog.waitFor({ state: 'hidden' });
    assert.equal(await noKeyPage.getByTestId('remove-item').count(), 1, 'Escape cancels deletion');
    await removeItem.click({ force: true });
    await removeDialog.waitFor({ state: 'visible' });
    await noKeyPage.getByTestId('keep-remove-item').click();
    await removeDialog.waitFor({ state: 'hidden' });
    assert.equal(await noKeyPage.getByTestId('remove-item').count(), 1, 'Keep leaves the item unchanged');
    await removeItem.click({ force: true });
    await removeDialog.waitFor({ state: 'visible' });
    await noKeyPage.getByTestId('confirm-remove-item').click();
    await noKeyPage.getByTestId('manual-empty-state').waitFor({ state: 'visible' });
    assert.equal(await noKeyPage.getByTestId('manual-empty-state').getByTestId('choice-divider').count(), 1, 'photo scan and manual entry are separated by “or”');
    await noKeyPage.locator('.step-nav button').first().click();
    await ensureAIImportOpen(noKeyPage);
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-toggle-icon').getAttribute('data-direction'), 'up', 'an expanded import panel uses the up chevron');
    const zhImportHelp = await noKeyPage.getByTestId('receipt-text-import').innerText();
    assert.match(zhImportHelp, /貼上其他 AI 的 JSON 或翻譯文字/);
    await noKeyPage.getByTestId('copy-receipt-json-prompt').click();
    const copiedPrompt = await noKeyPage.evaluate(() => window.__copiedPrompt || '');
    assert.match(copiedPrompt, /附上的收據圖片/);
    assert.match(copiedPrompt, /"items"/);
    assert.match(copiedPrompt, /"receiptTotal"/);
    assert.match(copiedPrompt, /一個 Markdown JSON 程式碼區塊/);
    assert.match(copiedPrompt, /一鍵複製整份內容/);
    assert.match(copiedPrompt, /```json/);
    assert.match(copiedPrompt, /不要建立或要求下載附件/);
    assert.match(copiedPrompt, /amountUncertain.{0,8}true/);
    assert.match(copiedPrompt, /amountText/);
    assert.match(copiedPrompt, /"amountUncertain":false/);
    assert.match(copiedPrompt, /S12\.50/);

    await noKeyPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'en'));
    await noKeyPage.reload();
    await noKeyPage.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 30000 });
    await ensureAIImportOpen(noKeyPage);
    const enImportHelp = await noKeyPage.getByTestId('receipt-text-import').innerText();
    assert.match(enImportHelp, /AI translation/);
    assert.match(enImportHelp, /Prompt \+ bill = ready-to-import \.json file/);
    await noKeyPage.getByTestId('copy-receipt-json-prompt').click();
    const copiedEnglishPrompt = await noKeyPage.evaluate(() => window.__copiedPrompt || '');
    assert.match(copiedEnglishPrompt, /Read the receipt image/);
    assert.match(copiedEnglishPrompt, /receiptTotal/);
    assert.match(copiedEnglishPrompt, /exactly one Markdown JSON code block/);
    assert.match(copiedEnglishPrompt, /one-click Copy button/);
    assert.match(copiedEnglishPrompt, /```json/);
    assert.match(copiedEnglishPrompt, /Do not create or request a downloadable attachment/);
    assert.match(copiedEnglishPrompt, /amountUncertain.{0,8}true/);
    assert.match(copiedEnglishPrompt, /amountText/);
    assert.match(copiedEnglishPrompt, /"amountUncertain":false/);
    assert.match(copiedEnglishPrompt, /S12\.50/);
    await noKeyPage.getByTestId('copy-prompt-open-google-ai').click();
    assert.equal(await noKeyPage.evaluate(() => window.__openedUrls.at(-1)?.[0]), 'https://gemini.google.com/app', 'the combined action also opens Google Gemini in English mode');
    assert.match(await noKeyPage.evaluate(() => window.__copiedPrompt || ''), /exactly one Markdown JSON code block/);

    await noKeyPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'zh-HK'));
    await noKeyPage.reload();
    await noKeyPage.getByTestId('toggle-receipt-text-import').waitFor({ state: 'visible', timeout: 30000 });
    await ensureAIImportOpen(noKeyPage);

    await noKeyPage.getByTestId('receipt-text-draft').fill(JSON.stringify(jsonPastePayload));
    await noKeyPage.getByTestId('submit-receipt-text').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 3, 'pasted JSON items appear in the normal review step');
    assert.match(await noKeyPage.getByTestId('verify-summary').innerText(), /^3項/);
    const pastedRows = await noKeyPage.getByTestId('verify-item').allInnerTexts();
    assert.match(pastedRows.join('\n'), /魚蛋/);
    assert.match(pastedRows.join('\n'), /奶茶/);
    assert.match(pastedRows.join('\n'), /免費甜品/);
    assert.match(pastedRows.find(row => row.includes('免費甜品')) || '', /0\.00/, 'explicit JSON total=0 stays zero instead of price × quantity');
    assert.equal(await noKeyPage.locator('[data-testid="items-step"] [data-testid="last-recognition-model"]').count(), 0, 'the review step hides redundant source/model details');
    assert.equal(noKeyRequests, 0, 'valid JSON is imported locally without an API key or network request');
    const missingBillReminder = noKeyPage.getByTestId('ai-import-bill-photo-reminder');
    await missingBillReminder.waitFor({ state: 'visible' });
    assert.match(await missingBillReminder.innerText(), /AI 只匯入項目，未有帳單圖片/);
    assert.match(await missingBillReminder.innerText(), /請補貼原帳單/);
    assert.match(await noKeyPage.getByTestId('attach-receipt-image').innerText(), /補貼原帳單/);
    const reminderButtonStyle = await noKeyPage.getByTestId('attach-receipt-image').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, height: Math.round(button.getBoundingClientRect().height) }));
    assert.deepEqual(reminderButtonStyle, { background: 'rgb(255, 255, 255)', height: 44 }, 'the original-bill reminder offers a clear white 44px action');
    await noKeyPage.getByTestId('header-action-menu-toggle').click();
    await noKeyPage.getByTestId('header-language-toggle').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-testid="ai-import-bill-photo-reminder"]')?.textContent.includes('AI import includes the items, not the bill photo.'));
    assert.match(await missingBillReminder.innerText(), /friends can view it on the same result link/);
    assert.match(await noKeyPage.getByTestId('attach-receipt-image').innerText(), /Attach original bill/);
    await noKeyPage.getByTestId('header-language-toggle').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-testid="ai-import-bill-photo-reminder"]')?.textContent.includes('AI 只匯入項目，未有帳單圖片'));

    await noKeyPage.evaluate(base64 => {
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
    }, syntheticReceipt.toString('base64'));
    await noKeyPage.getByTestId('attach-receipt-image').click();
    await noKeyPage.waitForFunction(() => window.__receiptPickerCalls?.length === 1);
    const attachmentPickerOptions = await noKeyPage.evaluate(() => window.__receiptPickerCalls[0]);
    assert.equal(attachmentPickerOptions.startIn, 'downloads', 'the external-import photo picker opens Downloads first');
    assert.equal(attachmentPickerOptions.multiple, true);
    assert.deepEqual(attachmentPickerOptions.types[0].accept, {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp']
    });
    await noKeyPage.getByTestId('receipt-attachment-only-hint').waitFor({ state: 'visible' });
    assert.match(await noKeyPage.getByTestId('receipt-attachment-only-hint').innerText(), /不做 OCR|no OCR or AI/);
    assert.match(await noKeyPage.getByTestId('attach-receipt-image').innerText(), /補貼原帳單/);
    await noKeyPage.getByTestId('redaction-next-or-finish').click();
    await noKeyPage.waitForFunction(() => /已加1張/.test(document.querySelector('[data-testid="receipt-attachment-status"]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await noKeyPage.getByTestId('ai-import-bill-photo-reminder').count(), 0, 'the reminder disappears after the original bill photo is attached');
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 3, 'attaching a photo preserves the imported JSON items');
    assert.equal(noKeyRequests, 0, 'photo attachment does not send the image to OpenRouter');
    await noKeyPage.waitForFunction(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('billSplitterLocalData', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const count = await new Promise((resolve, reject) => {
          const request = db.transaction('receipts', 'readonly').objectStore('receipts').get('active-bill-draft-assets-v1');
          request.onsuccess = () => resolve(request.result?.images?.length || 0);
          request.onerror = () => reject(request.error);
        });
        return count === 1;
      } finally { db.close(); }
    }, null, { timeout: 15000 });
    await noKeyPage.reload();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.match(await noKeyPage.getByTestId('receipt-attachment-status').innerText(), /已加1張/, 'the attached photo remains with the imported bill after reload');
    assert.equal(await noKeyPage.getByTestId('ai-import-bill-photo-reminder').count(), 0, 'the restored photo also keeps the reminder hidden');
    assert.equal((await noKeyPage.getByTestId('draft-status').innerText()).trim(), '已恢復');
    assert.equal(noKeyRequests, 0, 'restoring the attached photo also makes no API request');

    await noKeyPage.getByTestId('header-action-menu-toggle').click();
    await noKeyPage.getByTestId('header-language-toggle').click();
    await noKeyPage.reload();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal((await noKeyPage.getByTestId('draft-status').innerText()).trim(), 'Restored');
    assert.equal(await noKeyPage.getByTestId('ai-import-bill-photo-reminder').count(), 0, 'the hidden reminder stays hidden after the English reload');
    assert.match(await noKeyPage.getByTestId('attach-receipt-image').innerText(), /Add photo/);
    await noKeyPage.getByTestId('attach-receipt-image').click();
    await noKeyPage.getByTestId('receipt-attachment-input').setInputFiles({
      name: 'synthetic-receipt-second.png', mimeType: 'image/png', buffer: syntheticReceipt
    });
    await noKeyPage.getByTestId('receipt-attachment-only-hint').waitFor({ state: 'visible' });
    assert.match(await noKeyPage.getByTestId('receipt-attachment-only-hint').innerText(), /no OCR or AI/);
    await noKeyPage.getByTestId('redaction-next-or-finish').click();
    await noKeyPage.waitForFunction(() => /2 added/.test(document.querySelector('[data-testid="receipt-attachment-status"]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(noKeyRequests, 0, 'the English attachment-only flow also makes no API request');
    await noKeyPage.evaluate(() => {
      delete window.showOpenFilePicker;
      const input = document.querySelector('[data-testid="receipt-attachment-input"]');
      window.__fallbackPickerCalls = 0;
      input.click = () => { window.__fallbackPickerCalls += 1; };
    });
    await noKeyPage.getByTestId('attach-receipt-image').click();
    await noKeyPage.waitForFunction(() => window.__fallbackPickerCalls === 1);
    assert.equal(await noKeyPage.getByTestId('receipt-attachment-input').getAttribute('accept'), null, 'the fallback input can browse Downloads instead of forcing an image-only media picker');
    await noKeyPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'zh-HK'));
    await noKeyPage.reload();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });

    await noKeyPage.locator('.step-nav button').first().click();
    await ensureAIImportOpen(noKeyPage);
    const fencedJson = `\`\`\`json\n${JSON.stringify(filePayload)}\n\`\`\``;
    await noKeyPage.getByTestId('receipt-text-file').setInputFiles({
      name: 'translated-receipt.txt', mimeType: 'text/plain', buffer: Buffer.from(fencedJson, 'utf8')
    });
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 1, 'a text file containing fenced JSON also imports locally');
    assert.match(await noKeyPage.getByTestId('verify-item').first().innerText(), /冰咖啡/);
    assert.equal(await noKeyPage.getByTestId('ai-import-bill-photo-reminder').isVisible(), true, 'imported JSON without a photo prompts for the original bill');
    assert.equal(noKeyRequests, 0, 'text-file JSON also makes no network request');

    await noKeyPage.locator('.step-nav button').first().click();
    await ensureAIImportOpen(noKeyPage);
    await noKeyPage.getByTestId('receipt-text-draft').fill(JSON.stringify(ambiguousJsonPayload));
    await noKeyPage.getByTestId('submit-receipt-text').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('verify-item').count(), 7, 'synthetic ambiguous-amount JSON reaches the normal review step');
    assert.equal(await noKeyPage.getByTestId('item-amount-review').count(), 5, 'missing total, explicit mismatch, AI uncertainty, and raw S-containing amount fields are all blocked for review');
    const amountRows = await noKeyPage.getByTestId('verify-item').allInnerTexts();
    assert.match(amountRows[1], /(?:單價 .*55\.00 × 計價數量 8|Unit price .*55\.00 × priced quantity 8)/);
    assert.match(amountRows[1], /(?:單據總量未知|Bill quantity unknown)/);
    assert.match(amountRows[1], /(?:暫算 .*440\.00|provisional .*440\.00)/);
    assert.match(amountRows[2], /(?:行總額 .*55\.00.*不符|Line total .*55\.00 differs .*440\.00)/);
    assert.equal(await noKeyPage.getByTestId('verify-item').nth(3).getByTestId('item-amount-review').count(), 0, 'a clearly supplied 55 × 8 = 440 total remains accepted');
    assert.match(amountRows[4], /(?:金額待核對|Amount to verify)/, 'an AI-marked row with no readable amount is not presented as $0');
    assert.match(amountRows[5], /(?:金額待核對|Amount to verify)/, 'an S-prefixed raw unit price is not normalized into a verified amount');
    assert.match(amountRows[5], /(?:S 可能是 \$ 被誤認|S.*may be a misread \$)/);
    assert.match(amountRows[6], /(?:金額待核對|Amount to verify)/, 'an S-prefixed raw line total is not normalized into a verified amount');
    await noKeyPage.getByTestId('go-to-payer').click();
    assert.equal(await noKeyPage.locator('[data-live-app] main').getAttribute('data-current-step'), '2', 'unresolved amounts cannot pass to payer or settlement');
    assert.match(await noKeyPage.getByTestId('step-error').innerText(), /(?:行總額未核對|line total .*has not been checked)/i);
    await noKeyPage.getByTestId('edit-item').nth(1).click();
    assert.match(await noKeyPage.getByTestId('item-pricing-quantity').innerText(), /(?:計價數量 8|priced quantity 8)/);
    assert.equal(await noKeyPage.getByTestId('item-amount-review-editor').count(), 1, 'the expanded editor repeats the review warning');
    const verifiedTotals = noKeyPage.getByTestId('item-line-total');
    assert.equal(await verifiedTotals.count(), 5, 'each flagged row offers a direct line-total field');
    const reviewedTotals = ['55', '55', '12', '12.5', '12.5'];
    for (let index = reviewedTotals.length - 1; index >= 0; index -= 1) {
      await verifiedTotals.nth(index).fill(reviewedTotals[index]);
    }
    await noKeyPage.waitForFunction(() => document.querySelectorAll('[data-testid="item-amount-review"]').length === 0, null, { timeout: 10000 });
    assert.equal(await noKeyPage.getByTestId('item-amount-review').count(), 0, 'entering reviewed row totals clears the warning');
    await noKeyPage.getByTestId('go-to-payer').click();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '3', null, { timeout: 15000 });
    await noKeyPage.waitForFunction(() => {
      const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
      const items = draft?.data?.items;
      return Array.isArray(items) && items.length === 7
        && Number(items[1].total) === 55 && items[1].needsAmountReview === false
        && Number(items[2].total) === 55 && Number(items[3].total) === 440
        && Number(items[4].total) === 12
        && Number(items[5].total) === 12.5 && items[5].needsAmountReview === false
        && Number(items[6].total) === 12.5 && items[6].needsAmountReview === false;
    }, null, { timeout: 15000 });
    assert.equal(noKeyRequests, 0, 'the amount-review flow is entirely local for JSON imports');

    await noKeyPage.locator('.step-nav button').first().click();
    await ensureAIImportOpen(noKeyPage);
    await noKeyPage.getByTestId('receipt-text-draft').fill('拉麵 1 碗 100 元；消費税 8 元；應付 108 元');
    await noKeyPage.getByTestId('submit-receipt-text').click();
    await noKeyPage.getByTestId('receipt-text-import-error').waitFor({ state: 'visible' });
    assert.match(await noKeyPage.getByTestId('receipt-text-import-error').innerText(), /OpenRouter.*JSON|JSON.*OpenRouter/);
    assert.equal(noKeyRequests, 0, 'non-JSON text without a key is not sent anywhere');
    await noKeyPage.waitForFunction(text => JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null')?.data?.receiptTextDraft === text,
      '拉麵 1 碗 100 元；消費税 8 元；應付 108 元', { timeout: 15000 });
    await noKeyPage.reload();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '1', null, { timeout: 30000 });
    assert.equal(await noKeyPage.getByTestId('receipt-text-draft').inputValue(), '拉麵 1 碗 100 元；消費税 8 元；應付 108 元', 'unsent text is restored locally after reload');
    assert.equal(await noKeyPage.getByTestId('toggle-receipt-text-import').getAttribute('aria-expanded'), 'true', 'the text-import panel remains expanded after reload');
    assert.equal(noKeyRequests, 0, 'restoring unsent text does not call an API');
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
      allowPaidModels: false, ocrModelPreferenceVersion: 5
    });
    await ensureAIImportOpen(modelPage);
    await modelPage.getByTestId('receipt-text-draft').fill(JSON.stringify({ items: [{ name: '負稅測試', price: 10, qty: 1, total: 10 }], taxTotal: -2, currency: 'HKD' }));
    await modelPage.getByTestId('submit-receipt-text').click();
    await modelPage.getByTestId('receipt-text-import-error').waitFor({ state: 'visible' });
    assert.equal(modelRequests, 0, 'semantically invalid JSON is rejected locally and never sent to OpenRouter');
    await modelPage.getByTestId('receipt-text-draft').fill(JSON.stringify({ items: [{ name: '負數量', price: 10, qty: -1, total: 10 }], currency: 'HKD' }));
    await modelPage.getByTestId('submit-receipt-text').click();
    await modelPage.getByTestId('receipt-text-import-error').waitFor({ state: 'visible' });
    assert.equal(modelRequests, 0, 'negative item quantities are rejected locally before any model request');
    const pastedText = '芒果糯米飯 1 份 65 泰銖\n收據總額 65 泰銖';
    await modelPage.getByTestId('receipt-text-draft').fill(pastedText);
    await modelPage.getByTestId('submit-receipt-text').click();
    await modelPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.equal(modelRequests, 1, 'plain translated text is structured by the selected free model');
    assert.equal(capturedModel, DOTS);
    assert.match(capturedText, /芒果糯米飯 1 份 65 泰銖/);
    assert.equal(capturedImageCount, 0, 'text-only requests contain no image payload');
    assert.match(capturedText, /amountUncertain/);
    assert.match(capturedText, /amountText/);
    assert.match(capturedText, /S12\.50/);
    assert.match(await modelPage.getByTestId('verify-item').first().innerText(), /芒果糯米飯/);
    assert.match(await modelPage.getByTestId('verify-summary').innerText(), /^1項/);
    assert.equal(await modelPage.getByTestId('ai-import-bill-photo-reminder').isVisible(), true, 'AI-structured text without a photo also asks for the original bill');
    assert.match(await modelPage.getByTestId('attach-receipt-image').innerText(), /補貼原帳單/);
    assert.equal(await modelPage.locator('[data-testid="items-step"] [data-testid="last-recognition-model"]').count(), 0);
    assert.deepEqual(failures, [], failures.join('\n'));
    await modelContext.close();

    console.log('PASS: copied photo-reading JSON prompt; pasted/.txt JSON import, invalid JSON isolation, private unsent-text restore, negative item rejection; missing-bill reminder bilingual; attachment remains local.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
