'use strict';
// Run a local static server first, then:
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium \
// BASE_URL=http://127.0.0.1:4178/ node tests/external-ai-return.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(__dirname, '..', 'artifacts');
const pastedReply = 'Gemini 測試回覆：奶茶 $18';
const syntheticJson = '```json\n{"items":[{"name":"測試奶茶","price":18,"qty":1,"total":18}],"currency":"HKD"}\n```';
const tailwindPlayCdn = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'tailwind-playcdn-3.4.17.js.gz'))).toString('utf8');

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pageErrors = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: tailwindPlayCdn
      }));
      await page.addInitScript(() => {
        window.__openedUrls = [];
        window.__clipboardWrites = [];
        window.__clipboardText = '';
        window.__clipboardReadFails = false;
        window.__simulatedVisibilityState = 'visible';
        window.open = (...args) => { window.__openedUrls.push(args); return null; };
        window.__simulateVisibility = state => {
          window.__simulatedVisibilityState = state;
          document.dispatchEvent(new Event('visibilitychange'));
        };
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => window.__simulatedVisibilityState
        });
        try {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: text => {
                window.__clipboardWrites.push(String(text));
                window.__clipboardText = String(text);
                return Promise.resolve();
              },
              readText: () => window.__clipboardReadFails
                ? Promise.reject(new Error('clipboard read denied'))
                : Promise.resolve(window.__clipboardText)
            }
          });
        } catch (_) {}
      });
      await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
        localStorage.setItem('billSplitterLanguage', 'zh-HK');
        localStorage.setItem('billSplitterHistory', '[]');
      });
      await page.goto(base.toString(), { waitUntil: 'domcontentloaded' });

      const toggle = page.getByTestId('toggle-receipt-text-import');
      const openGemini = page.getByTestId('copy-prompt-open-google-ai');
      const pasteField = page.getByTestId('receipt-text-draft');
      await toggle.waitFor({ state: 'visible', timeout: 60000 });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${viewport.width}px: section starts collapsed`);
      await openGemini.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${viewport.width}px: tapping the copy/open button expands the full translation section`);
      await pasteField.waitFor({ state: 'visible' });
      assert.equal(await pasteField.inputValue(), '', `${viewport.width}px: the result field does not show the instruction prompt`);
      assert.equal(await pasteField.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 253, 231)', `${viewport.width}px: the yellow paste field is available`);
      assert.equal(await page.getByTestId('submit-receipt-text').isEnabled(), true, `${viewport.width}px: clipboard processing remains available while the result field is empty`);
      const copiedPrompt = await page.evaluate(() => window.__clipboardWrites.at(-1) || '');
      assert.ok(copiedPrompt.length > 400 && copiedPrompt.includes('"receiptTotal"'), `${viewport.width}px: tapping still copies the receipt prompt`);
      assert.equal(await page.getByTestId('submit-receipt-text').isEnabled(), true, `${viewport.width}px: clipboard processing remains available while the result field is empty`);
      assert.equal(await page.getByTestId('google-ai-guide').isVisible(), true, `${viewport.width}px: existing copy guide remains in the flow`);
      assert.equal(await page.evaluate(() => window.__openedUrls.length), 0, `${viewport.width}px: Gemini does not open before the user's Next tap`);

      await page.getByTestId('google-ai-guide-continue').click();
      assert.equal(await page.evaluate(() => window.__openedUrls.at(-1)?.[0]), 'https://gemini.google.com/app', `${viewport.width}px: Gemini still opens directly from the user's tap`);
      const scrollBeforeReturn = await page.evaluate(() => window.scrollY);
      // Simulate Android/browser backgrounding and returning; this is not a real-device lifecycle test.
      await page.evaluate(() => window.__simulateVisibility('hidden'));
      await page.evaluate(() => window.__simulateVisibility('visible'));
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${viewport.width}px: section remains expanded after returning`);
      assert.equal(await pasteField.isVisible(), true, `${viewport.width}px: yellow paste field remains available after returning`);
      assert.equal(await pasteField.inputValue(), '', `${viewport.width}px: returning from Google AI does not place the prompt in the result field`);
      assert.equal(await page.getByTestId('submit-receipt-text').isEnabled(), true, `${viewport.width}px: return-to-clipboard action remains available`);
      assert.equal(await page.evaluate(() => window.scrollY), scrollBeforeReturn, `${viewport.width}px: returning does not move the page away from its existing position`);
      await pasteField.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.screenshot({ path: path.join(screenshotDir, `external-ai-empty-result-${viewport.width}x${viewport.height}.png`) });
      await page.evaluate(() => { window.__clipboardReadFails = true; });
      await page.getByTestId('submit-receipt-text').click();
      await page.getByTestId('receipt-text-import-error').waitFor({ state: 'visible' });
      assert.match(await page.getByTestId('receipt-text-import-error').innerText(), /無法讀取剪貼簿/);
      await page.evaluate(() => { window.__clipboardReadFails = false; });

      await pasteField.fill(pastedReply);
      await page.waitForFunction(expected => {
        const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
        return draft?.data?.receiptTextDraft === expected;
      }, pastedReply);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('receipt-camera').waitFor({ state: 'visible', timeout: 60000 });
      await pasteField.waitFor({ state: 'visible', timeout: 60000 });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${viewport.width}px: translation section stays open after reload`);
      assert.equal(await pasteField.inputValue(), pastedReply, `${viewport.width}px: pasted text survives reload`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${viewport.width}px: no horizontal overflow`);
      await pasteField.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.screenshot({ path: path.join(screenshotDir, `external-ai-return-${viewport.width}x${viewport.height}.png`) });

      await pasteField.fill('');
      await page.waitForFunction(() => {
        const draft = JSON.parse(localStorage.getItem('billSplitterActiveDraftV1') || 'null');
        return !draft?.data?.receiptTextDraft;
      });
      assert.equal(await pasteField.inputValue(), '', `${viewport.width}px: clearing the saved draft leaves a blank result field`);
      assert.equal(await page.getByTestId('submit-receipt-text').isDisabled(), true, `${viewport.width}px: import remains disabled until a new AI flow starts`);
      if (viewport.width === 390) {
        await pasteField.fill(syntheticJson);
      } else {
        await openGemini.click();
        assert.equal(await pasteField.inputValue(), '', `${viewport.width}px: opening Gemini does not refill the result field`);
        await page.getByTestId('google-ai-guide-continue').click();
        await page.evaluate(text => { window.__clipboardText = text; }, syntheticJson);
      }
      await page.getByTestId('submit-receipt-text').click();
      await page.waitForFunction(() => {
        const step = document.querySelector('[data-live-app] main')?.dataset.currentStep;
        return step === '2' || document.querySelector('[data-testid="receipt-text-import-error"]');
      }, null, { timeout: 30000 });
      const importedStep = await page.locator('[data-live-app] main').getAttribute('data-current-step');
      assert.equal(importedStep, '2', `${viewport.width}px: returned JSON imports successfully; error: ${await page.getByTestId('receipt-text-import-error').innerText().catch(() => '')}`);
      assert.equal(await page.getByTestId('verify-item').count(), 1, `${viewport.width}px: JSON output is imported`);
      assert.match(await page.getByTestId('verify-item').first().innerText(), /測試奶茶/);
      await context.close();
      console.log(`PASS ${viewport.width}x${viewport.height}: tap → expanded/yellow field → resume/reload retains open state and pasted text`);
    }
    assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
