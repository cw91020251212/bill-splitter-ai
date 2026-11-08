'use strict';

const assert = require('node:assert/strict');
const { URL } = require('node:url');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4178/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This test only runs against a local server.');
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = playwrightPath ? require(playwrightPath) : require('playwright');
const freeModel = 'dots-studio/dots-3-note-preview:free';
const retiredNanoModel = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const lastFallbackModel = 'nvidia/nemotron-3.5-super-vl:free';
const randomModel = 'openrouter/free';
const localPaddleModel = 'local/paddleocr-js';
const testApiKey = 'test-openrouter-key-preserve-on-migration';

async function assertRouteDescription(page, expectedText, label) {
  await page.waitForFunction(text => document.querySelector('[data-testid="scan-model-description"]')?.innerText.includes(text), expectedText);
  const actual = await page.getByTestId('scan-model-description').innerText();
  assert(actual.includes(expectedText), `${label}: ${actual}`);
}

async function openSettingsAndAssertMatch(page, scanSelect, label) {
  const scanRoute = await scanSelect.inputValue();
  const scanDescription = await page.getByTestId('scan-model-description').innerText();
  await page.getByTestId('header-action-menu-toggle').click();
  await page.locator('.header-settings-button').click();
  const settingsSelect = page.getByTestId('model-select');
  await settingsSelect.waitFor({ state: 'visible' });
  assert.equal(await settingsSelect.inputValue(), scanRoute, `${label}: selected route matches after opening settings`);
  assert.equal(await page.getByTestId('settings-model-description').innerText(), scanDescription, `${label}: descriptions match after opening settings`);
  return settingsSelect;
}

async function closeSettingsAndAssertMatch(page, scanSelect, settingsSelect, label) {
  const settingsRoute = await settingsSelect.inputValue();
  const settingsDescription = await page.getByTestId('settings-model-description').innerText();
  await page.getByRole('button', { name: /返回系統|Back to app/ }).click();
  await scanSelect.waitFor({ state: 'visible' });
  assert.equal(await scanSelect.inputValue(), settingsRoute, `${label}: selected route matches after returning to first screen`);
  assert.equal(await page.getByTestId('scan-model-description').innerText(), settingsDescription, `${label}: descriptions match after returning to first screen`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox']
  });
  try {
    const firstVisitContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const firstVisitPage = await firstVisitContext.newPage();
    await firstVisitPage.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
    await firstVisitPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterHistory', '[]');
    });
    await firstVisitPage.goto(base.toString(), { waitUntil: 'networkidle' });
    const firstVisitSelect = firstVisitPage.getByTestId('scan-model-select');
    await firstVisitSelect.waitFor({ state: 'visible' });
    assert.equal(await firstVisitSelect.inputValue(), localPaddleModel, 'first visit defaults to PaddleOCR.js local + Dots3-Note');
    assert.equal((await firstVisitPage.getByTestId('app-version-label').innerText()).trim(), 'R114');
    console.log('PASS first-visit default is PaddleOCR.js local + Dots3-Note');

    await assertRouteDescription(firstVisitPage, '不送去 OpenRouter', 'local route keeps the image on-device');
    await firstVisitSelect.selectOption(freeModel);
    await assertRouteDescription(firstVisitPage, 'Dots3-Note 優先', 'Dots route names its primary model');
    await firstVisitSelect.selectOption(lastFallbackModel);
    await assertRouteDescription(firstVisitPage, 'Nemotron 3.5 優先', 'Nemotron route becomes primary when selected');
    await firstVisitSelect.selectOption(randomModel);
    await assertRouteDescription(firstVisitPage, 'OpenRouter 免費隨機路由', 'random route is described separately');
    await assertRouteDescription(firstVisitPage, '不會自動改試', 'random route explains that fixed-model fallback is not used');
    await firstVisitSelect.selectOption(localPaddleModel);
    await assertRouteDescription(firstVisitPage, '文字交畀 Dots3-Note', 'local route describes its OCR-to-model handoff');
    await assertRouteDescription(firstVisitPage, '首次辨識下載約 21.5 MB', 'local route explains the one-time model download size');

    const firstSettingsSelect = await openSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, 'first visit local default');
    assert.equal(await firstVisitPage.getByText('本機 OCR＋OpenRouter 文字整理', { exact: true }).count(), 1, 'settings banner identifies the local OCR + OpenRouter text route');
    const firstSettingsChoices = await firstSettingsSelect.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.deepEqual(firstSettingsChoices, [freeModel, lastFallbackModel, randomModel, localPaddleModel], 'settings picker has the same cloud and local choices as the first screen');
    await firstSettingsSelect.selectOption(freeModel);
    assert((await firstVisitPage.getByTestId('settings-model-description').innerText()).includes('Dots3-Note 優先'), 'settings Dots route has its route-specific description');
    await firstSettingsSelect.selectOption(lastFallbackModel);
    assert((await firstVisitPage.getByTestId('settings-model-description').innerText()).includes('Nemotron 3.5 優先'), 'settings Nemotron route has its route-specific description');
    await firstSettingsSelect.selectOption(randomModel);
    const settingsRandomDescription = await firstVisitPage.getByTestId('settings-model-description').innerText();
    assert(settingsRandomDescription.includes('OpenRouter 免費隨機路由') && settingsRandomDescription.includes('不會自動改試'), 'settings random route explains its behavior');
    await firstSettingsSelect.selectOption(localPaddleModel);
    await closeSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, firstSettingsSelect, 'settings changed back to Paddle');
    await firstVisitSelect.selectOption(freeModel);
    const reverseSyncedSettings = await openSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, 'first screen changed to Dots');
    await closeSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, reverseSyncedSettings, 'first screen Dots selection');

    await firstVisitPage.evaluate(() => localStorage.setItem('billSplitterLanguage', 'en'));
    await firstVisitPage.reload({ waitUntil: 'networkidle' });
    await firstVisitSelect.waitFor({ state: 'visible' });
    await firstVisitSelect.selectOption(localPaddleModel);
    await assertRouteDescription(firstVisitPage, 'Image stays on-device', 'English local-route description');
    await assertRouteDescription(firstVisitPage, 'first scan downloads ~21.5 MB', 'English local-route download notice');
    await firstVisitSelect.selectOption(randomModel);
    await assertRouteDescription(firstVisitPage, 'OpenRouter’s free random router', 'English random-route description');
    await assertRouteDescription(firstVisitPage, 'fixed-model fallback', 'English random-route fallback detail');
    const englishSettings = await openSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, 'English random route');
    await closeSettingsAndAssertMatch(firstVisitPage, firstVisitSelect, englishSettings, 'English random route');
    console.log('PASS model-specific descriptions update for all routes in Traditional Chinese and English');
    await firstVisitContext.close();

    for (const storageKind of ['localStorage', 'sessionStorage']) {
      const savedKey = storageKind === 'sessionStorage' ? testApiKey : '';
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.goto(new URL('tests/README.md', base).toString(), { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ kind, key, model }) => {
        const legacy = JSON.stringify({
          engine: 'openrouter',
          ocrEngine: 'openrouter',
          keys: { openrouter: key },
          model,
          allowPaidModels: false,
          ocrModelPreferenceVersion: 4
        });
        window[kind].setItem('billSplitterApiConfig', legacy);
        localStorage.setItem('billSplitterHistory', '[]');
      }, { kind: storageKind, key: savedKey, model: freeModel });
      await page.goto(base.toString(), { waitUntil: 'networkidle' });
      const scanSelect = page.getByTestId('scan-model-select');
      await scanSelect.waitFor({ state: 'visible' });
      await page.waitForFunction(model => {
        try {
          const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
          return stored?.model === model && stored.ocrModelPreferenceVersion === 5 && stored.ocrEngine === 'paddlejs';
        } catch (error) { return false; }
      }, freeModel);
      assert.equal(await scanSelect.inputValue(), localPaddleModel, `${storageKind}: v4 OpenRouter default migrates to PaddleOCR.js local + Dots3-Note`);
      const scanChoices = await scanSelect.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      assert.deepEqual(scanChoices, [freeModel, lastFallbackModel, randomModel, localPaddleModel], 'first screen includes random and local PaddleOCR options');
      await scanSelect.selectOption(localPaddleModel);
      await page.waitForFunction(model => {
        const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
        return stored?.ocrEngine === 'paddlejs' && stored.model === model;
      }, freeModel);
      assert.equal(await scanSelect.inputValue(), localPaddleModel, 'local PaddleOCR selection persists as a separate OCR engine');
      await scanSelect.selectOption(randomModel);
      await page.waitForFunction(model => {
        const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
        return stored?.model === model && stored?.ocrEngine === 'openrouter';
      }, randomModel);
      assert.equal(await scanSelect.inputValue(), randomModel, 'first-screen random selection persists immediately');
      await page.reload({ waitUntil: 'networkidle' });
      await scanSelect.waitFor({ state: 'visible' });
      assert.equal(await scanSelect.inputValue(), randomModel, 'an explicitly saved OpenRouter route survives reload');
      await scanSelect.selectOption(lastFallbackModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, lastFallbackModel);
      assert.equal(await page.getByTestId('scan-model-select').inputValue(), lastFallbackModel, 'first-screen model selection persists immediately');
      await scanSelect.selectOption(freeModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, freeModel);
      const menuTrigger = page.getByTestId('header-action-menu-toggle');
      await menuTrigger.waitFor({ state: 'visible' });
      assert.equal((await page.getByTestId('app-version-label').innerText()).trim(), 'R114');
      await menuTrigger.click();
      const menu = page.locator('#header-action-menu');
      await menu.waitFor({ state: 'visible' });
      const menuMetrics = await menu.evaluate(node => ({
        width: node.getBoundingClientRect().width,
        gap: parseFloat(getComputedStyle(node).rowGap),
        items: Array.from(node.querySelectorAll(':scope > button')).map(button => ({
          height: button.getBoundingClientRect().height,
          fontSize: parseFloat(getComputedStyle(button).fontSize)
        })),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth
      }));
      assert.equal(menuMetrics.width, 160, 'R114 retains the original 160px menu width');
      assert.equal(menuMetrics.items.length, 6, 'all existing menu options remain');
      assert(menuMetrics.items.every(item => item.height >= 44), `all menu items are at least 44px tall: ${JSON.stringify(menuMetrics.items)}`);
      assert(menuMetrics.items.every(item => item.fontSize >= 16), 'menu text is at least 16px');
      assert(menuMetrics.gap >= 8, 'menu items have at least 8px vertical separation');
      assert(menuMetrics.documentWidth <= menuMetrics.viewportWidth, 'menu does not create horizontal overflow');
      await page.setViewportSize({ width: 320, height: 844 });
      const narrowMenuMetrics = await menu.evaluate(node => ({
        width: node.getBoundingClientRect().width,
        items: Array.from(node.querySelectorAll(':scope > button')).map(button => button.getBoundingClientRect().height),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth
      }));
      assert.equal(narrowMenuMetrics.width, 160, '320px viewport retains the original menu width');
      assert(narrowMenuMetrics.items.every(height => height >= 44), '320px viewport preserves touch target heights');
      assert(narrowMenuMetrics.documentWidth <= narrowMenuMetrics.viewportWidth, '320px viewport has no horizontal menu overflow');
      await page.setViewportSize({ width: 390, height: 844 });
      if (process.env.MENU_SCREENSHOT_PATH && storageKind === 'localStorage') {
        await page.screenshot({ path: process.env.MENU_SCREENSHOT_PATH });
      }
      const routeBeforeSettings = await scanSelect.inputValue();
      const descriptionBeforeSettings = await page.getByTestId('scan-model-description').innerText();
      await page.locator('.header-settings-button').click();
      let select = page.getByTestId('model-select');
      await select.waitFor({ state: 'visible' });
      await page.waitForFunction(model => {
        try {
          const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
          return stored?.model === model && stored.allowPaidModels === false;
        } catch (error) { return false; }
      }, freeModel);

      assert.equal(await select.inputValue(), routeBeforeSettings, `${storageKind}: settings keeps the current route`);
      assert.equal(await page.getByTestId('settings-model-description').innerText(), descriptionBeforeSettings, `${storageKind}: settings description matches the first-screen description`);
      assert.equal(await page.getByTestId('paid-models-opt-in').count(), 0, 'paid-model toggle must be absent');
      const choices = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      assert(choices.length > 0 && choices.every(model => model.endsWith(':free') || model === randomModel || model === localPaddleModel), 'only free models, local PaddleOCR, and the free random router may be selected');
      assert.deepEqual(choices, [freeModel, lastFallbackModel, randomModel, localPaddleModel]);
      assert.equal(choices.includes(retiredNanoModel), false, 'retired Nano model is not selectable');
      assert.equal(choices.includes('google/gemma-4-31b-it:free'), false, 'Gemma 4 31B is removed after repeated user failures');
      assert.equal(choices.includes('google/gemma-4-26b-a4b-it:free'), false, 'Gemma 4 26B is removed after repeated user failures');
      assert.equal(choices.includes('thinkingmachines/inkling-small:free'), false, 'retired Inkling model is removed from settings');
      await select.selectOption(randomModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, randomModel);
      assert.equal(await select.inputValue(), randomModel, 'settings random selection persists immediately');
      await select.selectOption(localPaddleModel);
      await page.waitForFunction(model => {
        const stored = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
        return stored?.ocrEngine === 'paddlejs' && stored.model === model;
      }, freeModel);
      await select.selectOption(freeModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, freeModel);
      await closeSettingsAndAssertMatch(page, scanSelect, select, `${storageKind}: settings Dots route`);
      await scanSelect.selectOption(randomModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, randomModel);
      const reopenedSettings = await openSettingsAndAssertMatch(page, scanSelect, `${storageKind}: first-screen random route`);
      await reopenedSettings.selectOption(freeModel);
      await page.waitForFunction(model => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null')?.model === model, freeModel);
      assert.equal(await reopenedSettings.inputValue(), freeModel, `${storageKind}: settings returns to Dots after first-screen model change`);
      select = reopenedSettings;
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
        assert.equal(await page.locator('[data-testid="openrouter-video-card"] video source').getAttribute('src'), './assets/OpenRouter_API_Key_Tutorial_Circled.mp4?v=20261103-1');
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
      assert.equal(saved.local.ocrEngine, 'openrouter');
      assert.equal(saved.local.ocrModelPreferenceVersion, 5);
      assert.equal(saved.local.keys.openrouter, savedKey, 'API key must survive migration');
      if (storageKind === 'sessionStorage') {
        assert.equal(saved.session.allowPaidModels, false, 'session copy must also be migrated');
        assert.equal(saved.session.model, freeModel);
        assert.equal(saved.session.keys.openrouter, testApiKey);
      }
      await page.evaluate(model => {
        const config = JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null');
        delete config.ocrEngine;
        config.model = model;
        config.ocrModelPreferenceVersion = 4;
        localStorage.setItem('billSplitterApiConfig', JSON.stringify(config));
      }, randomModel);
      await page.reload({ waitUntil: 'networkidle' });
      await scanSelect.waitFor({ state: 'visible' });
      assert.equal(await scanSelect.inputValue(), localPaddleModel, 'a config without a saved OCR route migrates to the full local+Dots default');
      const migratedDefault = await page.evaluate(() => JSON.parse(localStorage.getItem('billSplitterApiConfig') || 'null'));
      assert.equal(migratedDefault.ocrEngine, 'paddlejs');
      assert.equal(migratedDefault.model, freeModel, 'the default local combo uses Dots3-Note, not the stale random router model');
      console.log('PASS missing OCR-engine migration restores PaddleOCR.js local + Dots3-Note');
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
