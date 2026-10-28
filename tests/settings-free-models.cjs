'use strict';

const assert = require('node:assert/strict');
const { URL } = require('node:url');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = playwrightPath ? require(playwrightPath) : require('playwright');
const freeModel = 'nvidia/nemotron-3.5-super-vl:free';
const testApiKey = 'test-openrouter-key-preserve-on-migration';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox']
  });
  try {
    for (const storageKind of ['localStorage', 'sessionStorage']) {
      const savedKey = storageKind === 'sessionStorage' ? testApiKey : '';
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ kind, key }) => {
        const legacy = JSON.stringify({
          engine: 'openrouter',
          keys: { openrouter: key },
          model: 'google/gemini-3.8-flash',
          allowPaidModels: true
        });
        window[kind].setItem('billSplitterApiConfig', legacy);
        localStorage.setItem('billSplitterHistory', '[]');
      }, { kind: storageKind, key: savedKey });
      await page.goto(base.toString(), { waitUntil: 'networkidle' });
      await page.getByTestId('start-tutorial').waitFor();
      await page.locator('.header-settings-button').click();
      const select = page.getByTestId('model-select');
      await select.waitFor({ state: 'visible' });
      await page.waitForFunction(model => {
        try {
          const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
          return stored?.model === model && stored.allowPaidModels === false;
        } catch (error) { return false; }
      }, freeModel);

      assert.equal(await select.inputValue(), freeModel, `${storageKind}: old paid model must fall back to free`);
      assert.equal(await page.getByTestId('paid-models-opt-in').count(), 0, 'paid-model toggle must be absent');
      const choices = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      assert(choices.length > 0 && choices.every(model => model.endsWith(':free')), 'only free models may be selected');
      const settingsText = await page.locator('body').innerText();
      assert(!settingsText.includes('進階／可能產生費用'));
      assert(!settingsText.includes('Advanced / may cost money'));

      const getKeyLink = page.getByTestId('get-free-api-key');
      const expectedSaved = savedKey ? 'true' : 'false';
      assert.equal(await getKeyLink.getAttribute('data-key-saved'), expectedSaved);
      const keyLinkClass = await getKeyLink.getAttribute('class');
      assert(keyLinkClass.includes(savedKey ? 'text-brand-700' : 'text-red-700'), `${storageKind}: key link color class must match saved-key status`);
      if (!savedKey) {
        const shortcut = page.getByTestId('settings-key-video-link');
        assert.equal((await shortcut.innerText()).trim(), '影片教學');
        await shortcut.click();
        await page.getByTestId('tutorial-hub').waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const target = document.getElementById('openrouter-key-video');
          const header = document.querySelector('.app-header');
          if (!target || !header) return false;
          const rect = target.getBoundingClientRect();
          return rect.top >= header.getBoundingClientRect().bottom - 2 && rect.top < innerHeight;
        });
        assert.equal(await page.getByTestId('tutorial-openrouter-video').isVisible(), true);
        assert.equal(await page.locator('[data-testid="openrouter-video-card"] video source').getAttribute('src'), './assets/OpenRouter_API_Key_Tutorial_Preview_Revised.mp4');
        console.log('PASS empty-key-red-link-and-shortcut-opens-key-video');
      } else {
        console.log('PASS saved-key-green-link');
      }

      const saved = await page.evaluate(() => ({
        local: JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null'),
        session: JSON.parse(sessionStorage.getItem('billSplitterApiConfig') || 'null')
      }));
      assert.equal(saved.local.allowPaidModels, false);
      assert.equal(saved.local.model, freeModel);
      assert.equal(saved.local.keys.openrouter, savedKey, 'API key must survive migration');
      if (storageKind === 'sessionStorage') {
        assert.equal(saved.session.allowPaidModels, false, 'session copy must also be migrated');
        assert.equal(saved.session.model, freeModel);
        assert.equal(saved.session.keys.openrouter, testApiKey);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
