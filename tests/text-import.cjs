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
      window.__copyTrace = [];
      window.__copiedPrompt = '';
      window.__clipboardText = '';
      window.open = (...args) => {
        window.__copyTrace.push({ type: 'open', url: String(args[0] || '') });
        window.__openedUrls.push(args);
        return null;
      };
      document.execCommand = command => {
        if (command !== 'copy') return false;
        const active = document.activeElement;
        const value = active && typeof active.value === 'string' ? active.value : '';
        window.__copyTrace.push({ type: 'exec', value, failed: window.__failExecCopy === true });
        if (value) window.__copiedPrompt = value;
        return window.__failExecCopy !== true;
      };
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText(text) {
              const copied = String(text || '');
              window.__copyTrace.push({ type: 'clipboard', text: copied, failed: window.__failClipboard === true });
              if (window.__failClipboard === true) return Promise.reject(new Error('clipboard denied'));
              window.__clipboardText = copied;
              return Promise.resolve();
            }
          }
        });
      } catch (error) {}
    });
    await noKeyPage.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      noKeyRequests += 1;
      await route.abort();
    });
    await initStorage(noKeyPage, null);

    const keyToggle = noKeyPage.getByTestId('toggle-key-guidance');
    if (await keyToggle.getAttribute('aria-expanded') !== 'true') await keyToggle.click();
    assert.equal(await noKeyPage.getByTestId('scan-model-select').inputValue(), 'local/paddleocr-js', 'fresh installs use local PaddleOCR + Dots by default');
    assert.equal(await noKeyPage.getByTestId('toggle-receipt-text-import').getAttribute('aria-expanded'), 'false', 'other-AI translation starts collapsed under the upload');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-toggle-icon').getAttribute('data-direction'), 'down', 'a collapsed import panel uses the down chevron');
    assert.equal(await noKeyPage.getByTestId('copy-prompt-open-google-ai').isVisible(), true, 'the green Google AI action remains visible when the other-AI section is collapsed');
    assert.equal(await noKeyPage.getByTestId('copy-receipt-json-prompt').count(), 0, 'secondary prompt actions stay inside the collapsed other-AI section');
    await ensureAIImportOpen(noKeyPage);
    assert.equal(await noKeyPage.getByTestId('copy-receipt-json-prompt').isVisible(), true, 'opening other-AI translation reveals the prompt-copy action');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-toggle-icon').getAttribute('data-direction'), 'up', 'an expanded import panel uses the shared up chevron');
    assert.equal(await noKeyPage.getByTestId('receipt-text-import-title').getAttribute('aria-label'), '其他 AI 翻譯');
    assert.match(await noKeyPage.getByTestId('receipt-text-import').innerText(), /提示詞＋賬單＝專用翻譯檔（\.json）/);
    assert.equal(await noKeyPage.getByTestId('external-ai-provider-examples').innerText(), '（Google AI 模式、豆包等）');
    const googleAIButton = noKeyPage.getByTestId('copy-prompt-open-google-ai');
    assert.equal(await googleAIButton.isVisible(), true, 'the combined copy-and-open action is available');
    assert.equal(await noKeyPage.locator('meta[name="bill-app-release"]').getAttribute('content'), 'v145-single-photo-gallery-remove-20261115');
    assert.equal((await noKeyPage.getByTestId('app-version-label').innerText()).trim(), 'R145');
    const buttonPaint = async locator => locator.evaluate(button => {
      const style = getComputedStyle(button);
      const icon = button.querySelector('svg');
      return {
        className: button.className,
        disabled: button.disabled,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        textShadow: style.textShadow,
        boxShadow: style.boxShadow,
        iconColor: icon ? getComputedStyle(icon).color : ''
      };
    });
    const googlePaint = await buttonPaint(googleAIButton);
    const cameraPaint = await buttonPaint(noKeyPage.getByTestId('receipt-camera'));
    const menuPaint = await buttonPaint(noKeyPage.getByTestId('header-action-menu-toggle'));
    const uploadPaint = await buttonPaint(noKeyPage.getByTestId('receipt-upload'));
    assert.equal(googlePaint.disabled, false, 'the Google AI button is enabled on a fresh visit');
    assert.match(googlePaint.className, /\bhost-primary\b/, 'the Google AI button opts into the green host-primary fill');
    assert.match(googlePaint.className, /\bgreen-action\b/);
    assert.equal(googlePaint.backgroundColor, 'rgb(29, 115, 73)', 'the default enabled fill is the darker brand green, not the R140 white accent');
    assert.match(googlePaint.backgroundImage, /linear-gradient/);
    assert.equal(googlePaint.color, 'rgb(255, 255, 255)', 'the Google AI button keeps white for the lead line');
    assert.match(googlePaint.textShadow, /0px 1px 1px/, 'the Google AI label keeps a subtle text shadow');
    assert.equal(googlePaint.iconColor, 'rgb(255, 229, 102)', 'the Google AI paper-plane icon is yellow');
    const googleBrand = await googleAIButton.evaluate(button => {
      const paint = selector => {
        const node = button.querySelector(selector);
        const style = getComputedStyle(node);
        return { color: style.color, fill: style.webkitTextFillColor };
      };
      return {
        lead: paint('.google-ai-lead').color,
        blue: paint('.gw-blue').color,
        red: paint('.gw-red').color,
        yellow: paint('.gw-yellow').color,
        green: paint('.gw-green').color,
        ai: paint('.gw-ai').color,
        leadWeight: getComputedStyle(button.querySelector('.google-ai-lead')).fontWeight
      };
    });
    assert.equal(googleBrand.lead, 'rgb(255, 255, 255)', '「複製提示詞並開啟」 stays white');
    assert.equal(googleBrand.blue, 'rgb(66, 133, 244)', 'Google G and g use official blue #4285F4');
    assert.equal(googleBrand.red, 'rgb(234, 67, 53)', 'Google o and e use official red #EA4335');
    assert.equal(googleBrand.yellow, 'rgb(251, 188, 5)', 'the second o uses official yellow #FBBC05');
    assert.equal(googleBrand.green, 'rgb(52, 168, 83)', 'Google l uses official green #34A853');
    assert.equal(googleBrand.ai, 'rgb(255, 255, 255)', 'AI stays white');
    assert.equal(googleBrand.leadWeight, '700', 'the Google AI action label is bold');
    assert.equal(cameraPaint.color, 'rgb(255, 255, 255)', '直接影相 uses a white label on the green action');
    assert.equal(cameraPaint.iconColor, 'rgb(255, 229, 102)', '直接影相 uses a yellow camera icon');
    assert.equal(await noKeyPage.getByTestId('receipt-camera').evaluate(button => getComputedStyle(button).fontWeight), '700', '直接影相 label is bold');
    assert.equal(googlePaint.backgroundColor, cameraPaint.backgroundColor, 'the Google AI button uses the same green as the Step 1 photo action');
    assert.equal(googlePaint.boxShadow, 'none');
    assert.equal(menuPaint.color, 'rgb(255, 255, 255)', 'the header menu toggle uses white text on its dark green fill');
    assert.notEqual(menuPaint.backgroundColor, 'rgb(255, 255, 255)');
    assert.notEqual(uploadPaint.color, 'rgb(255, 255, 255)', 'the light photo-picker button keeps dark text');
    assert.notEqual(uploadPaint.backgroundColor, 'rgb(29, 115, 73)');
    const copyPromptButton = noKeyPage.getByTestId('copy-receipt-json-prompt');
    assert.equal(await copyPromptButton.isVisible(), true, 'the regular copy action remains visible below the combined action');
    const outlinePaint = await buttonPaint(copyPromptButton);
    assert.doesNotMatch(outlinePaint.className, /\bhost-primary\b/);
    assert.doesNotMatch(outlinePaint.className, /\bgreen-action\b/);
    assert.notEqual(outlinePaint.color, 'rgb(255, 255, 255)', 'the outline prompt button keeps dark text');
    assert.notEqual(outlinePaint.backgroundColor, 'rgb(29, 115, 73)', 'the outline prompt button stays a secondary control');
    assert.equal(outlinePaint.backgroundImage, 'none');
    const submitDisabled = await buttonPaint(noKeyPage.getByTestId('submit-receipt-text'));
    assert.equal(submitDisabled.disabled, true, '整理這段文字 stays disabled until text is pasted');
    assert.equal(submitDisabled.backgroundColor, 'rgb(228, 231, 228)', 'the empty submit button uses a light gray fill');
    assert.equal(submitDisabled.color, 'rgb(106, 114, 108)', 'the empty submit label is light gray, not black');
    assert.equal(await noKeyPage.getByTestId('submit-receipt-text').evaluate(button => getComputedStyle(button).borderTopColor), 'rgb(197, 203, 198)', 'the empty submit button uses a light gray outline');
    const fileLabel = await noKeyPage.getByTestId('choose-receipt-text-file').evaluate(button => {
      const aside = button.querySelector('.btn-aside');
      return {
        weight: getComputedStyle(button).fontWeight,
        asideWeight: aside ? getComputedStyle(aside).fontWeight : '',
        manual: getComputedStyle(document.querySelector('[data-testid="start-manual"]')).fontWeight
      };
    });
    assert.equal(fileLabel.weight, '700', '上載文字檔 is bold');
    assert.equal(fileLabel.asideWeight, '400', 'the file-size hint stays regular');
    assert.equal(fileLabel.manual, '700', '手動輸入項目 is bold');
    await noKeyPage.getByTestId('receipt-text-draft').fill('x');
    await noKeyPage.waitForFunction(() => {
      const button = document.querySelector('[data-testid="submit-receipt-text"]');
      return Boolean(button) && button.disabled === false && getComputedStyle(button).backgroundColor === 'rgb(29, 115, 73)';
    });
    const submitPaint = await buttonPaint(noKeyPage.getByTestId('submit-receipt-text'));
    assert.equal(submitPaint.disabled, false);
    assert.match(submitPaint.className, /\bhost-primary\b/);
    assert.match(submitPaint.className, /\bgreen-action\b/);
    assert.equal(submitPaint.backgroundColor, 'rgb(29, 115, 73)', 'the enabled text-import action uses the host green fill');
    assert.equal(submitPaint.color, 'rgb(255, 255, 255)', 'the enabled text-import action uses white text');
    assert.match(submitPaint.textShadow, /rgba\(0, 0, 0, 0\.35\)/, 'the enabled text-import action keeps the white-label text shadow');
    assert.equal(await noKeyPage.getByTestId('submit-receipt-text').evaluate(button => getComputedStyle(button).fontWeight), '700', 'the enabled submit label is bold');
    await noKeyPage.getByTestId('receipt-text-draft').fill('');
    const initialGoogleBox = await googleAIButton.boundingBox();
    const initialCopyBox = await copyPromptButton.boundingBox();
    assert.ok(initialGoogleBox.y < initialCopyBox.y, 'the green Google AI button is above the white copy button');
    await noKeyPage.setViewportSize({ width: 320, height: 640 });
    await copyPromptButton.scrollIntoViewIfNeeded();
    const narrowGoogleBox = await googleAIButton.boundingBox();
    const narrowCopyBox = await copyPromptButton.boundingBox();
    assert.equal(await googleAIButton.isVisible(), true, 'the Google AI button stays visible on a narrow viewport');
    assert.equal(await copyPromptButton.isVisible(), true, 'the white copy button stays visible on a narrow viewport');
    assert.ok(narrowGoogleBox.x >= 0 && narrowGoogleBox.x + narrowGoogleBox.width <= 320, 'the Google AI button fits within a narrow viewport');
    assert.ok(narrowCopyBox.x >= 0 && narrowCopyBox.x + narrowCopyBox.width <= 320, 'the white copy button fits within a narrow viewport');
    assert.ok(narrowGoogleBox.y < narrowCopyBox.y, 'the green Google AI button remains above the white button on a narrow viewport');
    assert.ok(narrowGoogleBox.y >= 0 && narrowGoogleBox.y + narrowGoogleBox.height <= 640, 'the green Google AI button remains fully visible when the white button is brought into view');
    assert.ok(narrowCopyBox.y >= 0 && narrowCopyBox.y + narrowCopyBox.height <= 640, 'the white button remains fully visible in the narrow viewport');
    const traceFrom = async () => noKeyPage.evaluate(() => window.__copyTrace.length);
    const assertCopiedBeforeOpen = async (start, label) => {
      const events = await noKeyPage.evaluate(from => window.__copyTrace.slice(from), start);
      const openAt = events.findIndex(event => event.type === 'open');
      assert.ok(openAt > 0, `${label}: opens Gemini`);
      assert.equal(events[openAt].url, 'https://gemini.google.com/app');
      assert.ok(events.slice(0, openAt).some(event => event.type === 'clipboard'), `${label}: clipboard write starts before the new tab`);
      assert.ok(events.slice(0, openAt).some(event => event.type === 'exec'), `${label}: execCommand fallback runs before the new tab`);
      assert.equal(events.slice(openAt + 1).some(event => event.type === 'clipboard' || event.type === 'exec'), false, `${label}: no copy attempt is left until after the tab opens`);
      return events;
    };
    const clearToasts = () => noKeyPage.evaluate(() => document.querySelectorAll('[data-testid="app-toast"]').forEach(node => node.remove()));
    let traceStart = await traceFrom();
    await googleAIButton.click();
    const successEvents = await assertCopiedBeforeOpen(traceStart, 'fresh visit');
    const attemptedPrompt = successEvents.find(event => event.type === 'clipboard').text;
    assert.ok(attemptedPrompt.length > 400, 'the copied prompt is the full receipt JSON import prompt');
    assert.match(attemptedPrompt, /一個 Markdown JSON 程式碼區塊/);
    assert.match(attemptedPrompt, /"receiptTotal"/);
    assert.equal(await noKeyPage.evaluate(() => window.__clipboardText), attemptedPrompt);
    assert.equal(await noKeyPage.evaluate(() => window.__copiedPrompt), attemptedPrompt);
    assert.equal(await noKeyPage.evaluate(() => window.__openedUrls[0]?.[0]), 'https://gemini.google.com/app', 'the combined action opens Google Gemini in a new tab');
    assert.match(await noKeyPage.evaluate(() => window.__copiedPrompt || ''), /一個 Markdown JSON 程式碼區塊/, 'the same action copies the receipt prompt');
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'success' && /提示詞已複製/.test(node.textContent)));
    assert.equal(noKeyRequests, 0, 'copying the prompt does not upload the receipt or call OpenRouter');

    await clearToasts();
    await noKeyPage.evaluate(() => { window.__failClipboard = true; window.__failExecCopy = true; });
    traceStart = await traceFrom();
    await googleAIButton.click();
    await assertCopiedBeforeOpen(traceStart, 'both copy methods refused');
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'error' && /未能複製提示詞/.test(node.textContent)));
    const failureToast = await noKeyPage.locator('[data-testid="app-toast"]').last().innerText();
    assert.match(failureToast, /未能複製提示詞/);
    assert.doesNotMatch(failureToast, /提示詞已複製/);
    assert.match(failureToast, /不會上載帳單圖片/);
    assert.equal(await noKeyPage.evaluate(() => window.__openedUrls.at(-1)?.[0]), 'https://gemini.google.com/app', 'a failed copy still opens Google AI');

    await clearToasts();
    await noKeyPage.evaluate(() => { window.__failClipboard = true; window.__failExecCopy = false; window.__copiedPrompt = ''; });
    traceStart = await traceFrom();
    await googleAIButton.click();
    await assertCopiedBeforeOpen(traceStart, 'clipboard API refused');
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'success' && /提示詞已複製/.test(node.textContent)));
    assert.match(await noKeyPage.evaluate(() => window.__copiedPrompt), /一個 Markdown JSON 程式碼區塊/, 'execCommand still copies the prompt when the Clipboard API fails');

    await clearToasts();
    await noKeyPage.evaluate(() => { window.__failClipboard = false; window.__failExecCopy = true; window.__clipboardText = ''; window.__copiedPrompt = ''; });
    traceStart = await traceFrom();
    await googleAIButton.click();
    await assertCopiedBeforeOpen(traceStart, 'execCommand refused');
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'success' && /提示詞已複製/.test(node.textContent)));
    assert.match(await noKeyPage.evaluate(() => window.__clipboardText), /一個 Markdown JSON 程式碼區塊/, 'the Clipboard API still copies the prompt when execCommand fails');
    await noKeyPage.evaluate(() => { window.__failClipboard = false; window.__failExecCopy = false; });
    await clearToasts();
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
    traceStart = await traceFrom();
    await noKeyPage.getByTestId('copy-prompt-open-google-ai').click();
    const englishEvents = await assertCopiedBeforeOpen(traceStart, 'English mode');
    assert.equal(await noKeyPage.evaluate(() => window.__openedUrls.at(-1)?.[0]), 'https://gemini.google.com/app', 'the combined action also opens Google Gemini in English mode');
    assert.match(englishEvents.find(event => event.type === 'clipboard').text, /exactly one Markdown JSON code block/);
    assert.match(await noKeyPage.evaluate(() => window.__copiedPrompt || ''), /exactly one Markdown JSON code block/);
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'success' && /Prompt copied/.test(node.textContent)));
    await clearToasts();
    await noKeyPage.evaluate(() => { window.__failClipboard = true; window.__failExecCopy = true; });
    traceStart = await traceFrom();
    await noKeyPage.getByTestId('copy-prompt-open-google-ai').click();
    await assertCopiedBeforeOpen(traceStart, 'English copy failure');
    await noKeyPage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'error' && /Could not copy the prompt/.test(node.textContent)));
    const englishFailure = await noKeyPage.locator('[data-testid="app-toast"]').last().innerText();
    assert.match(englishFailure, /Could not copy the prompt/);
    assert.doesNotMatch(englishFailure, /Prompt copied/);
    await noKeyPage.evaluate(() => { window.__failClipboard = false; window.__failExecCopy = false; });
    await clearToasts();

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
    const reminderButtonStyle = await noKeyPage.getByTestId('attach-receipt-image').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color, shadow: getComputedStyle(button).textShadow, height: Math.round(button.getBoundingClientRect().height) }));
    assert.equal(reminderButtonStyle.background, 'rgb(29, 115, 73)', 'the original-bill reminder uses the host green action fill');
    assert.equal(reminderButtonStyle.color, 'rgb(255, 255, 255)', 'the original-bill reminder uses white text');
    assert.match(reminderButtonStyle.shadow, /rgba\(0, 0, 0, 0\.35\)/, 'the original-bill reminder keeps the white-label text shadow');
    assert.equal(reminderButtonStyle.height, 44, 'the original-bill reminder keeps the compact 44px height');
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
    assert.equal(await noKeyPage.getByTestId('source-receipt-card').locator('img').count(), 2, 'each added photo appears once in the original full-size gallery');
    assert.equal(await noKeyPage.getByTestId('added-receipt-images').count(), 0, 'no duplicate small-photo gallery is rendered');
    assert.match(await noKeyPage.getByTestId('remove-receipt-image-0').getAttribute('aria-label'), /Delete receipt photo 1/);
    await noKeyPage.getByTestId('remove-receipt-image-0').click();
    await noKeyPage.waitForFunction(() => /1 added/.test(document.querySelector('[data-testid="receipt-attachment-status"]')?.textContent || ''));
    assert.equal(await noKeyPage.getByTestId('source-receipt-card').locator('img').count(), 1, 'deleting a photo preserves the other attachment');
    await noKeyPage.reload();
    await noKeyPage.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
    assert.match(await noKeyPage.getByTestId('receipt-attachment-status').innerText(), /1 added/, 'photo deletion is saved in the draft');
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

    const liveContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await liveContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await liveContext.route('https://gemini.google.com/**', route => route.abort());
    const livePage = await liveContext.newPage();
    livePage.on('pageerror', error => failures.push(`live clipboard: ${error.message}`));
    await initStorage(livePage, null);
    await ensureAIImportOpen(livePage);
    const liveButton = livePage.getByTestId('copy-prompt-open-google-ai');
    await liveButton.scrollIntoViewIfNeeded();
    const livePaint = await liveButton.evaluate(button => getComputedStyle(button).backgroundColor);
    assert.equal(livePaint, 'rgb(29, 115, 73)', 'a fresh host page paints the Google AI button green before the first tap');
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await livePage.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'google-ai-button-green.png') });
    }
    const popupPromise = livePage.waitForEvent('popup', { timeout: 8000 });
    await liveButton.click();
    const popup = await popupPromise;
    await livePage.waitForFunction(async () => {
      try { return (await navigator.clipboard.readText()).includes('一個 Markdown JSON 程式碼區塊'); }
      catch (error) { return false; }
    }, null, { timeout: 5000 });
    const liveCopied = await livePage.evaluate(() => navigator.clipboard.readText());
    assert.ok(liveCopied.length > 400, 'the real clipboard holds the full prompt');
    assert.match(liveCopied, /"receiptTotal"/);
    await livePage.waitForFunction(() => [...document.querySelectorAll('[data-testid="app-toast"]')].some(node => node.dataset.toastType === 'success' && /提示詞已複製/.test(node.textContent)));
    if (process.env.SCREENSHOT_DIR) await livePage.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'google-ai-copy-toast.png') });
    await popup.close();
    assert.deepEqual(failures, [], failures.join('\n'));
    await liveContext.close();

    console.log('PASS: copied photo-reading JSON prompt; pasted/.txt JSON import, invalid JSON isolation, private unsent-text restore, negative item rejection; missing-bill reminder bilingual; attachment remains local.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
