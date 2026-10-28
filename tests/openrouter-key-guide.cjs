// Run a local static server first. This test is localhost-only and never creates or tests a key.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/openrouter-key-guide.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This browser test is local-only.');
const out = process.env.TEST_OUTPUT_DIR || '/tmp/openrouter-key-guide-qa';
fs.mkdirSync(out, { recursive: true });
const reports = [];
function record(label, detail = '') {
  reports.push({ label, passed: true, detail });
  console.log('PASS ' + label + (detail ? ' — ' + detail : ''));
}
function draft() {
  const item = { id: '01', name: '測試項目', original: 'Test item', price: '20', total: 20, totalQty: null, unit: '' };
  return { schema: 1, assetRevision: 'key-guide-test', hasAssets: false, data: {
    step: 1, items: [item], readReceipt: true, taxAmount: '', taxNote: '',
    friendsReplies: '姓名：阿明\n01 = 1', payer: '阿明', detectedCurrency: 'HKD', currency: 'HKD',
    taxSplitMethod: 'proportional', paymentMethods: [], reconciliation: null, isSaved: false,
    includeReceiptImages: false, detailLang: 'zh', pendingReceiptShare: false, claimRoom: null,
    claimInboxSeen: [], claimLinkShared: false, results: null
  }};
}
(async () => {
  const launchOptions = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const apiRequests = [];
    page.on('request', request => { if (/openrouter\.ai\/api\//i.test(request.url())) apiRequests.push(request.url()); });
    await page.goto(new URL('openrouter-key-guide.html', base).toString(), { waitUntil: 'networkidle', timeout: 60000 });

    const cards = page.locator('[data-guide-step]');
    assert.equal(await cards.count(), 7, 'seven concise guide steps');
    assert.equal(await page.locator('[data-guide-step]:not([hidden])').count(), 1, 'one active step at a time');
    assert.match(await page.locator('#stepCount').innerText(), /1.*7/);
    assert.match(await page.locator('.hero').innerText(), /設定一次.*每張單.*重貼/);
    assert.match(await page.locator('.truth').innerText(), /手動輸入.*朋友認帳.*分帳計算.*唔需要/);
    assert.equal(await page.locator('img').count(), 7, 'seven actual screenshot images');
    assert.equal(await page.locator('.mock-ui, .illustration, [class*="mock-"]').count(), 0, 'no fabricated OpenRouter interface');
    const imagePaths = (await page.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')))).sort();
    assert.deepEqual(imagePaths, [
      './assets/openrouter-guide-step-1-signup.png',
      './assets/openrouter-guide-step-2-new-key.png',
      './assets/openrouter-guide-step-3-expiry.png',
      './assets/openrouter-guide-step-4-limit.png',
      './assets/openrouter-guide-step-5-create.png',
      './assets/openrouter-guide-step-6-copy.png',
      './assets/openrouter-guide-step-7-app-field.png'
    ].sort());
    const html = fs.readFileSync(path.join(__dirname, '..', 'openrouter-key-guide.html'), 'utf8');
    assert(!/codecademy|mock-openrouter|openrouter-keys-public-login/i.test(html), 'old fabricated/third-party guide assets are not referenced');
    assert.match(await page.locator('[data-guide-step="1"] figcaption.zh').innerText(), /帳戶標記.*Key 清單/s);
    assert.match(await page.locator('[data-guide-step="5"] figcaption.zh').innerText(), /不透明色塊.*完整遮蓋/);
    assert.match(await page.locator('[data-guide-step="6"] figcaption.zh').innerText(), /欄位是空白.*沒有放入.*真實 Key/);
    assert.match(await page.locator('[data-guide-step="6"] .note').innerText(), /檢查格式並保存.*測試連線/);
    for (let i = 0; i < 7; i++) {
      const active = page.locator('[data-guide-step]:not([hidden])');
      assert.equal(await active.getAttribute('data-guide-step'), String(i));
      assert.equal(await active.locator('img').count(), 1, 'one screenshot on step ' + (i + 1));
      const image = active.locator('img');
      await image.waitFor({ state: 'visible' });
      await image.scrollIntoViewIfNeeded();
      assert(await image.evaluate(img => img.complete && img.naturalWidth > 0), 'step image loads ' + (i + 1));
      assert((await image.getAttribute('alt')).length > 12, 'meaningful image alt ' + (i + 1));
      assert(await active.locator('figcaption').count() >= 1, 'image annotation/privacy caption ' + (i + 1));
      const zhLead = await active.locator('.lead.zh').innerText();
      assert(zhLead.length < 90, 'Chinese narration stays concise at step ' + (i + 1) + ': ' + zhLead.length);
      await page.screenshot({ path: path.join(out, `openrouter-guide-step-${i + 1}.png`), fullPage: true });
      for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
        await page.setViewportSize(viewport);
        const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert(geometry.scrollWidth <= geometry.width + 1, 'no horizontal overflow at step ' + (i + 1) + ' / ' + viewport.width);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (i < 6) await page.locator('#nextButton').click();
    }
    record('seven-real-screens-and-concise-captions', 'all seven images load; only visible controls are captioned; full key field redaction is documented');
    record('mobile-layout', '320×640, 390×844, 768×1024; no horizontal overflow on every step');
    assert.equal(await page.locator('#nextButton').innerText(), '返回 App');
    await page.locator('#prevButton').click();
    assert.match(await page.locator('#stepCount').innerText(), /第 6 步／共 7 步/);
    record('step-navigation', 'next, back, progress, and final return-to-app action');

    await page.locator('#langToggle').click();
    assert.equal(await page.locator('body').getAttribute('data-lang'), 'en');
    assert.match(await page.locator('.hero').innerText(), /one-time setup/i);
    assert.match(await page.locator('#stepCount').innerText(), /Step 6 of 7/);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    record('bilingual-toggle', 'Hong Kong Traditional Chinese and English');
    assert.deepEqual(apiRequests, [], 'no OpenRouter API calls or key submissions');
    record('key-safety', 'no key entry, creation, copying, or API request in the guide test');

    const app = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await app.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
    await app.evaluate(record => {
      localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(record));
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', keys: { openrouter: '' }, model: 'nvidia/nemotron-3.5-super-vl:free', allowPaidModels: false }));
    }, draft());
    await app.reload({ waitUntil: 'networkidle' });
    await app.locator('[data-testid="start-tutorial"]').waitFor({ state: 'visible' });
    await app.waitForFunction(() => !document.querySelector('[data-testid="start-tutorial"]')?.disabled);
    await app.locator('[data-testid="start-tutorial"]').click();
    await app.locator('[data-testid="tutorial-mode-text"]').click();
    await app.locator('#openrouter-guide').waitFor({ state: 'visible' });
    const guideLink = app.locator('[data-testid="openrouter-key-guide-link"]');
    assert(await guideLink.isVisible(), 'existing Bill Splitter tutorial still links to the guide');
    assert.equal(await guideLink.getAttribute('href'), './openrouter-key-guide.html');
    assert.equal(await guideLink.getAttribute('target'), '_blank');
    await app.screenshot({ path: path.join(out, 'existing-tutorial-guide-link.png'), fullPage: false });
    const [popup] = await Promise.all([app.waitForEvent('popup'), guideLink.click()]);
    await popup.waitForLoadState('domcontentloaded');
    assert(popup.url().endsWith('/openrouter-key-guide.html'));
    assert.equal(await popup.locator('[data-guide-step]').count(), 7);
    await popup.close();
    record('existing-tutorial-entry-preserved', 'the existing Bill Splitter tour opens the standalone seven-step guide in a new tab');

    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    for (let i = 1; i <= 7; i++) assert(sw.includes(`./assets/openrouter-guide-step-${i}-`), 'service worker precaches step ' + i);
    assert(sw.includes("./openrouter-key-guide.html"));
    assert(!/codecademy-openrouter|openrouter-keys-public-login/.test(sw), 'obsolete images are removed from the service-worker shell');
    record('offline-assets-listed', 'service worker caches the guide and all seven annotated screenshots');

    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, reports, screenshots: fs.readdirSync(out).filter(name => name.endsWith('.png')) }, null, 2) + '\n');
    console.log('All OpenRouter key guide checks passed.');
  } catch (error) {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, reports, error: error.stack }, null, 2) + '\n');
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exit(1); });
