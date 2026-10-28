// Local-only browser checks for the seven-step guide. No key is entered, copied, OCRed, or sent.
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
const expectedImages = [
  './assets/openrouter-guide-step-1-google.png',
  './assets/openrouter-guide-step-2-new-key.png',
  './assets/openrouter-guide-step-3-expiry-focus.png',
  './assets/openrouter-guide-step-4-limit-focus.png',
  './assets/openrouter-guide-step-5-create-focus.png',
  './assets/openrouter-guide-step-6-original.jpg',
  './assets/openrouter-guide-step-7-app-field-crop.png'
];
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
    assert.equal(await cards.count(), 7, 'seven guide steps');
    assert.equal(await page.locator('[data-guide-step]:not([hidden])').count(), 1, 'one active step at a time');
    assert.match(await page.locator('#stepCount').innerText(), /1.*7/);
    assert.equal(await page.locator('.hero, .truth, .sources, figcaption, .note').count(), 0, 'no intro, repeated notes, or captions');
    assert.equal(await page.locator('img').count(), 7, 'seven screenshot images');
    assert.equal(await page.locator('.mock-ui, .illustration, [class*="mock-"]').count(), 0, 'no fabricated OpenRouter interface');
    const imagePaths = (await page.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')))).sort();
    assert.deepEqual(imagePaths, expectedImages.slice().sort());
    const html = fs.readFileSync(path.join(__dirname, '..', 'openrouter-key-guide.html'), 'utf8');
    assert(!/codecademy|mock-openrouter|openrouter-keys-public-login/i.test(html), 'no obsolete third-party guide assets');
    const visibleCopy = await page.locator('main').innerText();
    assert.doesNotMatch(visibleCopy, /模型收費|免費模型|手動輸入.*朋友認帳|只把 key 貼入|公開 repo/i, 'no repeated price/key disclaimers');

    for (let i = 0; i < 7; i++) {
      const active = page.locator('[data-guide-step]:not([hidden])');
      assert.equal(await active.getAttribute('data-guide-step'), String(i));
      assert.equal(await active.locator('img').count(), 1, 'one screenshot on step ' + (i + 1));
      assert.equal(await active.locator('.lead.zh').count(), 1, 'one action sentence on step ' + (i + 1));
      assert.equal(await active.locator('figcaption, .note').count(), 0, 'no per-step footnote on step ' + (i + 1));
      const zhLead = await active.locator('.lead.zh').innerText();
      assert.equal((zhLead.match(/[。！？]/g) || []).length, 1, 'one Chinese action sentence on step ' + (i + 1));
      const image = active.locator('img');
      await image.waitFor({ state: 'visible' });
      await image.scrollIntoViewIfNeeded();
      assert(await image.evaluate(img => img.complete && img.naturalWidth > 0), 'step image loads ' + (i + 1));
      assert((await image.getAttribute('alt')).length > 8, 'meaningful image alt ' + (i + 1));
      // Avoid producing another copy of the user-provided screenshot containing a partial key.
      if (i !== 5) await page.screenshot({ path: path.join(out, `openrouter-guide-step-${i + 1}.png`), fullPage: false });

      for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
        await page.setViewportSize(viewport);
        const geometry = await page.evaluate(() => {
          const nav = document.querySelector('.controls').getBoundingClientRect();
          const next = document.querySelector('#nextButton').getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
            pageHeight: document.documentElement.scrollHeight, pageScroll: document.scrollingElement.scrollTop,
            navTop: nav.top, navBottom: nav.bottom, nextTop: next.top, nextBottom: next.bottom,
            navPosition: getComputedStyle(document.querySelector('.controls')).position };
        });
        assert(geometry.scrollWidth <= geometry.width + 1, 'no horizontal overflow at step ' + (i + 1) + ' / ' + viewport.width);
        assert.equal(geometry.navPosition, 'fixed', 'navigation stays fixed');
        assert(geometry.navTop >= 0 && geometry.navBottom <= geometry.height + 1, 'navigation visible at step ' + (i + 1) + ' / ' + viewport.width);
        assert(geometry.nextTop >= 0 && geometry.nextBottom <= geometry.height + 1, 'Next button visible at step ' + (i + 1) + ' / ' + viewport.width);
        assert.equal(geometry.pageScroll, 0, 'the page itself does not scroll');
        assert(geometry.pageHeight <= geometry.height + 1, 'only the image panel may need scrolling');
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (i < 6) await page.locator('#nextButton').click();
    }
    record('seven-steps-and-concise-copy', 'seven images; one title, action sentence, and image per step; no repeated page notes');
    record('mobile-layout', '320×640, 390×844, 768×1024; fixed Next button and image-panel-only scrolling');
    assert.equal(await page.locator('#nextButton').innerText(), '返回 App');
    await page.locator('#prevButton').click();
    assert.match(await page.locator('#stepCount').innerText(), /第 6 步／共 7 步/);
    record('step-navigation', 'next, back, progress, and final return-to-app action');

    await page.locator('#langToggle').click();
    assert.equal(await page.locator('body').getAttribute('data-lang'), 'en');
    assert.match(await page.locator('#stepCount').innerText(), /Step 6 of 7/);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    record('bilingual-toggle', 'Hong Kong Traditional Chinese and English');
    assert.deepEqual(apiRequests, [], 'no OpenRouter API calls or key submissions');
    record('no-api-calls', 'the guide test never enters, copies, OCRs, or submits a key');

    const app = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
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
    const videoCard = app.getByTestId('tutorial-video-card');
    const operationVideo = app.getByTestId('tutorial-operation-video');
    assert(await videoCard.isVisible(), 'the operation video has a separate entry in the existing tutorial');
    assert.match(await videoCard.innerText(), /觀看分帳操作短片/);
    assert.equal(await operationVideo.locator('source').getAttribute('src'), './assets/bill-splitter-operation-cantonese.mp4');
    assert.equal(await app.locator('#openrouter-guide [data-testid="tutorial-operation-video"]').count(), 0, 'the operation video is separate from the OpenRouter guide');
    await app.waitForFunction(() => {
      const video = document.querySelector('[data-testid="tutorial-operation-video"]');
      return video && video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth === 1080 && video.videoHeight === 1920;
    }, null, { timeout: 30000 });
    const videoLayout = await operationVideo.evaluate(video => {
      const rect = video.getBoundingClientRect();
      return { width: rect.width, height: rect.height, viewportWidth: innerWidth, maxHeight: innerHeight * 0.68, controls: video.controls, playsInline: video.playsInline };
    });
    assert(videoLayout.controls && videoLayout.playsInline, 'native controls and inline mobile playback are enabled');
    assert(videoLayout.width > 0 && videoLayout.width <= videoLayout.viewportWidth + 1, 'video fits the mobile viewport');
    assert(videoLayout.height <= videoLayout.maxHeight + 1, 'video height is capped for mobile');
    const playback = await operationVideo.evaluate(async video => {
      video.muted = true;
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 900));
      const result = { currentTime: video.currentTime, paused: video.paused };
      video.pause();
      return result;
    });
    assert(playback.currentTime > 0.1 && !playback.paused, 'the MP4 decodes and advances on mobile');
    record('mobile-tutorial-video-playback', '390×844 touch viewport; inline H.264/AAC playback advances; player is separate from the key guide');
    const guideLink = app.locator('[data-testid="openrouter-key-guide-link"]');
    assert(await guideLink.isVisible(), 'existing tutorial still has one entry to the guide');
    assert.equal(await guideLink.getAttribute('href'), './openrouter-key-guide.html');
    assert.equal(await guideLink.getAttribute('target'), '_blank');
    const guideEntryCopy = await app.locator('#openrouter-guide').innerText();
    assert.doesNotMatch(guideEntryCopy, /模型收費|免費模型|公開 repo|full key/i, 'no duplicated fee/privacy notes in the app entry');
    await app.screenshot({ path: path.join(out, 'existing-tutorial-guide-link.png'), fullPage: false });
    const [popup] = await Promise.all([app.waitForEvent('popup'), guideLink.click()]);
    await popup.waitForLoadState('domcontentloaded');
    assert(popup.url().endsWith('/openrouter-key-guide.html'));
    assert.equal(await popup.locator('[data-guide-step]').count(), 7);
    await popup.close();
    record('existing-tutorial-entry-preserved', 'the app opens the existing seven-step guide in one new tab');

    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    for (const imagePath of expectedImages) assert(sw.includes(imagePath), 'service worker precaches ' + imagePath);
    assert(sw.includes("'./openrouter-key-guide.html'"));
    assert(!/codecademy-openrouter|openrouter-keys-public-login/.test(sw), 'obsolete images are absent from the service-worker shell');
    record('offline-assets-listed', 'service worker caches the updated guide and its seven images');

    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, reports, screenshots: fs.readdirSync(out).filter(name => name.endsWith('.png')) }, null, 2) + '\n');
    console.log('All OpenRouter key guide checks passed.');
  } catch (error) {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, reports, error: error.stack }, null, 2) + '\n');
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exit(1); });
