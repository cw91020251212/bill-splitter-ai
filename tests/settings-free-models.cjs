'use strict';

const assert = require('node:assert/strict');
const { URL } = require('node:url');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = playwrightPath ? require(playwrightPath) : require('playwright');
const freeModel = 'nvidia/nemotron-3.5-super-vl:free';
const apiKey = 'test-openrouter-key-preserve-on-migration';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox']
  });
  try {
    for (const storageKind of ['localStorage', 'sessionStorage']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
      await page.evaluate(kind => {
        const legacy = JSON.stringify({
          engine: 'openrouter',
          keys: { openrouter: 'test-openrouter-key-preserve-on-migration' },
          model: 'google/gemini-3.8-flash',
          allowPaidModels: true
        });
        window[kind].setItem('billSplitterApiConfig', legacy);
        localStorage.setItem('billSplitterHistory', '[]');
      }, storageKind);
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
      const saved = await page.evaluate(() => ({
        local: JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null'),
        session: JSON.parse(sessionStorage.getItem('billSplitterApiConfig') || 'null')
      }));
      assert.equal(saved.local.allowPaidModels, false);
      assert.equal(saved.local.model, freeModel);
      assert.equal(saved.local.keys.openrouter, apiKey, 'non-empty API key must survive migration');
      assert.equal(saved.session.keys.openrouter, apiKey, 'session copy must preserve the non-empty API key');
      if (storageKind === 'sessionStorage') {
        assert.equal(saved.session.allowPaidModels, false, 'session copy must also be migrated');
        assert.equal(saved.session.model, freeModel);
      }
      console.log(`PASS ${storageKind}-legacy-paid-config-migrates-to-free`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
