// Run a local static server first. Requires Playwright (no build step for app).
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/tutorial-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');
const out = process.env.TEST_OUTPUT_DIR || '/tmp/bill-tutorial-qa';
fs.mkdirSync(out, { recursive: true });
const stages = ['upload', 'manual', 'verify', 'items', 'fee', 'share', 'share-options', 'replies', 'payer', 'currency', 'payment', 'tax-method', 'calculate', 'report', 'report-share', 'detail'];
const steps = [1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
const selectors = [
  '[data-testid="receipt-source-actions"]', '[data-testid="start-manual"]', '[data-testid="verify-item"]',
  '[data-tutorial-target="item-fields"]', '[data-tutorial-target="fee"]', '[data-tutorial-target="open-claim-share"]',
  '[data-tutorial-target="send-claim-link"]', '[data-testid="claim-replies"]',
  '[data-tutorial-target="calculation-settings"]', '[data-tutorial-target="currency"]',
  '[data-testid="payment-methods"]', '[data-tutorial-target="tax-method"]',
  '[data-testid="calculate-split"]', '[data-testid="final-summary-preview"]',
  '[data-testid="summary-report-actions"]', '[data-testid="detail-report-actions"]'
];
const results = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
function draft(step) {
  const item = { id: '01', name: '原有帳單項目', original: 'Original item', price: '99', total: 99, totalQty: null, unit: '' };
  return { schema: 1, assetRevision: 'test-assets-preserved', hasAssets: true, data: {
    step, items: [item], readReceipt: true, taxAmount: '9.9', taxNote: '原有備註',
    friendsReplies: '姓名：原有朋友\n01 = 1', payer: '原有墊支人', detectedCurrency: 'HKD', currency: 'HKD',
    taxSplitMethod: 'equal', paymentMethods: ['PayMe', '現金'], reconciliation: null, isSaved: false,
    includeReceiptImages: false, detailLang: 'full', pendingReceiptShare: false, claimRoom: null, claimInboxSeen: [], claimLinkShared: true,
    results: step === 4 ? { personTotals: { '原有朋友': { items: [{ ...item, amount: 99, qty: 1, totalClaimed: 1 }], adjustments: [], subtotal: 99, tax: 9.9, total: 108.9 } }, totalItemsCost: 99, reconciliationAllocations: [], date: '2026-10-28', currency: 'HKD' } : null
  }};
}
async function seed(page, step, language) {
  await page.goto(base + 'tests/README.md', { waitUntil: 'networkidle' });
  await page.evaluate(async ({ record, language, png }) => {
    localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(record));
    localStorage.setItem('billSplitterLanguage', language);
    localStorage.setItem('billSplitterHistory', JSON.stringify([{ id: 'sentinel-history', date: '2026-10-27', simplified: '保留的歷史', detailed: '保留的明細', receiptImageCount: 1 }]));
    localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', key: '', model: 'nvidia/nemotron-nano-12b-v2-vl:free', allowPaidModels: false }));
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('billSplitterLocalData', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('receipts', { keyPath: 'recordId' });
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({ recordId: 'active-bill-draft-assets-v1', revision: record.assetRevision, images: [{ data: png, mimeType: 'image/png' }], attachments: [{ name: '原有附件.txt', type: 'text/plain', lastModified: 1, blob: new Blob(['original attachment'], { type: 'text/plain' }) }] });
      tx.objectStore('receipts').put({ recordId: 'sentinel-history', files: [{ name: 'history.txt', blob: new Blob(['history attachment']) }] });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { record: draft(step), language, png: PNG });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(expected => document.querySelector('[data-live-app] main')?.dataset.currentStep === String(expected) && !document.querySelector('[data-testid="start-tutorial"]')?.disabled, step);
  await page.waitForTimeout(600); // let original draft/image restoration settle
  if (step === 2) {
    await page.locator('[data-live-app] [data-testid="edit-item"]').click();
    await page.waitForTimeout(1900); // original focus/highlight animation is not bill state
  }
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('billSplitterLocalData', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const rows = await new Promise((resolve, reject) => { const r = db.transaction('receipts').objectStore('receipts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close();
    const assets = await Promise.all(rows.map(async row => ({ ...row, files: row.files ? await Promise.all(row.files.map(async f => ({ name: f.name, text: await f.blob.text() }))) : undefined, attachments: row.attachments ? await Promise.all(row.attachments.map(async f => ({ name: f.name, type: f.type, text: await f.blob.text() }))) : undefined })));
    const store = Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]));
    const root = document.querySelector('[data-live-app]');
    return { store, assets, html: root.innerHTML.replace(/ style=""/g, ''), fields: [...root.querySelectorAll('input,textarea,select')].map(x => ({ type: x.type, value: x.value, checked: x.checked, disabled: x.disabled })), scrollY, focus: document.activeElement?.dataset.testid };
  });
}
async function instrument(page) {
  await page.evaluate(() => {
    window.__tourWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(...args) { window.__tourWrites.push('storage:' + method + ':' + (args[0] || '')); return original.apply(this, args); };
    }
    for (const method of ['put', 'add', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function(...args) { window.__tourWrites.push('idb:' + method); return original.apply(this, args); };
    }
    window.__tutorialSideEffects = [];
    const spy = name => (...args) => { window.__tutorialSideEffects.push(name); return Promise.resolve(); };
    try { Object.defineProperty(navigator, 'share', { configurable: true, value: spy('share') }); } catch (_) {}
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: spy('clipboard') } }); } catch (_) {}
    try { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: spy('camera') }); } catch (_) {}
  });
}
const demo = page => page.locator('[data-tutorial-demo]');
const target = (page, index) => demo(page).locator(selectors[index]);
const waitStage = (page, stage) => page.waitForFunction(stage => {
  const tutorial = document.querySelector('[data-testid="interactive-tutorial"]');
  return tutorial?.dataset.stage === stage && tutorial.dataset.ready === 'true';
}, stage);
async function assertGated(page, index, label) {
  const leaks = await page.evaluate(selector => {
    const card = document.querySelector('[data-testid="tutorial-card"]');
    const target = document.querySelector('[data-tutorial-demo] ' + selector);
    const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
    return [...document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')]
      .filter(e => visible(e) && !e.disabled && e.tabIndex >= 0 && !card?.contains(e) && !target?.contains(e))
      .map(e => e.dataset.testid || e.tagName.toLowerCase() + (e.getAttribute('aria-label') || ''));
  }, selectors[index]);
  assert.deepEqual(leaks, [], label + ': focusable controls outside current target/card');
}
async function checkGeometry(page, name) {
  await page.waitForTimeout(120);
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tutorial-card"]')?.getBoundingClientRect();
    const ring = document.querySelector('[data-testid="tutorial-highlight"]')?.getBoundingClientRect();
    const rect = r => r && ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    return { card: rect(card), ring: rect(ring), width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, modal: document.querySelector('[data-testid="tutorial-card"]')?.getAttribute('aria-modal'), inert: document.querySelector('[data-tutorial-demo]')?.inert };
  });
  assert(!geometry.overflow, name + ': horizontal overflow');
  assert(geometry.card && geometry.card.left >= -1 && geometry.card.right <= geometry.width + 1 && geometry.card.top >= -1 && geometry.card.bottom <= geometry.height + 1, name + ': card clipped ' + JSON.stringify(geometry));
  assert(geometry.card.width <= 340, name + ': card exceeds compact 340px width');
  assert(geometry.ring && geometry.ring.width > 10 && geometry.ring.height > 5, name + ': missing highlight');
  const overlap = Math.max(0, Math.min(geometry.card.right, geometry.ring.right) - Math.max(geometry.card.left, geometry.ring.left)) * Math.max(0, Math.min(geometry.card.bottom, geometry.ring.bottom) - Math.max(geometry.card.top, geometry.ring.top));
  assert(overlap < 4, name + ': card covers highlight ' + JSON.stringify(geometry));
  assert.equal(geometry.modal, 'false', name + ': tutorial is modal');
  assert.equal(geometry.inert, false, name + ': demo must remain interactive');
  return geometry;
}
async function assertRestored(page, before, label) {
  await page.getByTestId('interactive-tutorial').waitFor({ state: 'detached' });
  await page.waitForTimeout(150);
  const after = await snapshot(page);
  assert.deepEqual(after.store, before.store, label + ': localStorage changed');
  assert.deepEqual(after.assets, before.assets, label + ': IndexedDB attachments changed');
  if (after.html !== before.html) {
    let first = 0; while (first < after.html.length && after.html[first] === before.html[first]) first++;
    fs.writeFileSync(path.join(out, 'restore-diff.json'), JSON.stringify({ label, first, before, after }, null, 2));
    assert.fail(label + ': DOM changed at ' + first + '\nBEFORE ' + before.html.slice(Math.max(0, first - 120), first + 220) + '\nAFTER ' + after.html.slice(Math.max(0, first - 120), first + 220));
  }
  assert.deepEqual(after.fields, before.fields, label + ': original form state changed');
  assert(Math.abs(after.scrollY - before.scrollY) < 2, label + ': original scroll not restored');
  assert.equal(after.focus, 'start-tutorial', label + ': original focus not restored');
  assert.deepEqual(await page.evaluate(() => window.__tourWrites), [], label + ': tutorial wrote storage');
}
async function begin(page, before, label) {
  await page.getByTestId('start-tutorial').focus();
  const baseline = before || await snapshot(page);
  if (!before) await instrument(page);
  await page.getByTestId('start-tutorial').click();
  await page.getByTestId('tutorial-hub').waitFor({ state: 'visible' });
  await page.getByTestId('start-interactive-tutorial').click();
  await waitStage(page, 'upload');
  return baseline;
}
async function clickShareOpener(page) {
  await target(page, 5).click();
  await waitStage(page, 'share-options');
}
async function clickSendClaim(page) {
  await target(page, 6).click();
  await waitStage(page, 'replies');
}
async function advance(page, index) {
  if (index === 5) return clickShareOpener(page);
  if (index === 6) return clickSendClaim(page);
  if (index === 12) {
    await target(page, 12).click();
    await waitStage(page, 'report');
    return;
  }
  await page.getByTestId('tutorial-next').click();
  if (index < stages.length - 1) await waitStage(page, stages[index + 1]);
}
async function runEditedSample(page, language) {
  // Exercise receipt simulation, verify-to-edit, genuine amount/fee/reply edits, calculation, and safe report actions.
  const sourceButtons = target(page, 0).locator('button');
  await sourceButtons.first().click();
  await waitStage(page, 'verify');
  await target(page, 2).getByTestId('edit-item').click();
  await waitStage(page, 'items');
  const itemPrice = target(page, 3).locator('input[type="number"]').first();
  await itemPrice.fill('150');
  assert.equal(await itemPrice.inputValue(), '150', 'sample price edit did not stick');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'fee');
  const feeInput = target(page, 4).locator('input').first();
  await feeInput.fill('15');
  assert.equal(await feeInput.inputValue(), '15', 'sample fee edit did not stick');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'share');
  await clickShareOpener(page);
  await clickSendClaim(page);
  await target(page, 7).fill('姓名：阿明\n01 = 2\n\n姓名：Cathy\n01 = 1');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'payer');
  const payerInput = target(page, 8).locator('input').first();
  if (await payerInput.count()) await payerInput.fill('Cathy');
  for (const [index, nextStage] of [[8, 'currency'], [9, 'payment'], [10, 'tax-method']]) {
    await page.getByTestId('tutorial-next').click(); await waitStage(page, nextStage);
  }
  const taxRadios = target(page, 11).locator('input[type="radio"]');
  assert(await taxRadios.count() >= 2, language + ': missing fee split choices');
  await taxRadios.nth(0).check(); // proportional: $165 total at 2:1 gives Cathy $55
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'calculate');
  await target(page, 12).click(); await waitStage(page, 'report');
  const report = await target(page, 13).innerText();
  assert.match(report, language === 'en' ? /Pay to: \*Cathy\*/ : /請過數俾：\*Cathy\*/, language + ': edited payer must be Cathy');
  assert.match(report, language === 'en' ? /Payer's own share: \$55\.00/ : /Cathy 自己一份：\$55\.00/, language + ': expected Cathy $55 on a 2:1 split');

  // Equal fee/tax split changes Cathy to $57.50; this also verifies the actual radio and calculator.
  await page.getByTestId('tutorial-prev').click(); await waitStage(page, 'calculate');
  await page.getByTestId('tutorial-prev').click(); await waitStage(page, 'tax-method');
  await taxRadios.nth(1).check();
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'calculate');
  await target(page, 12).click(); await waitStage(page, 'report');
  const equalReport = await target(page, 13).innerText();
  assert.match(equalReport, language === 'en' ? /Pay to: \*Cathy\*/ : /請過數俾：\*Cathy\*/, language + ': equal fee split must retain edited payer');
  assert.match(equalReport, language === 'en' ? /Payer's own share: \$57\.50/ : /Cathy 自己一份：\$57\.50/, language + ': equal fee split should give Cathy $57.50');
}
async function runPayerRecovery(page, before, label) {
  await page.getByTestId('start-tutorial').focus();
  await page.getByTestId('start-tutorial').click();
  await page.getByTestId('start-interactive-tutorial').click();
  await waitStage(page, 'upload');
  for (const stage of ['manual', 'verify', 'items', 'fee', 'share']) {
    await page.getByTestId('tutorial-next').click(); await waitStage(page, stage);
  }
  await clickShareOpener(page); await clickSendClaim(page);
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'payer');
  const payer = target(page, 8).locator('input').first();
  await payer.fill('');
  for (const stage of ['currency', 'payment', 'tax-method', 'calculate']) {
    await page.getByTestId('tutorial-next').click(); await waitStage(page, stage);
  }
  await target(page, 12).click(); await waitStage(page, 'payer');
  await page.getByTestId('tutorial-feedback').waitFor({ state: 'visible' });
  await payer.fill('阿明');
  for (const stage of ['currency', 'payment', 'tax-method', 'calculate']) {
    await page.getByTestId('tutorial-next').click(); await waitStage(page, stage);
  }
  await target(page, 12).click(); await waitStage(page, 'report');
  await target(page, 13).waitFor({ state: 'visible' });
  await page.getByTestId('tutorial-close').click();
  await assertRestored(page, before, label);
}
async function runTutorialHubSmoke(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByTestId('tutorial-hub').waitFor({ state: 'visible' });
  const directoryOrder = await page.locator('[data-testid="video-lessons-directory"], [data-testid="interactive-guide-directory"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
  assert.deepEqual(directoryOrder, ['video-lessons-directory', 'interactive-guide-directory'], 'video directory must come first, interactive guide second');
  assert.match(await page.locator('#video-lessons-title').innerText(), /👍.*必看影片教學/);
  const videoSources = await page.locator('[data-testid="video-lessons-directory"] video source').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  assert.deepEqual(videoSources, ['./assets/OpenRouter_API_Key_Tutorial_Preview_Revised.mp4', './assets/bill-splitter-operation-cantonese.mp4'], 'OpenRouter setup must precede the operation clip');
  const videoStates = await page.locator('[data-testid="video-lessons-directory"] video').evaluateAll(nodes => nodes.map(node => ({ autoplay: node.hasAttribute('autoplay'), paused: node.paused, preload: node.getAttribute('preload') })));
  assert.deepEqual(videoStates, [{ autoplay: false, paused: true, preload: 'none' }, { autoplay: false, paused: true, preload: 'none' }], 'videos must wait for a user tap');
  assert.match(await page.getByTestId('api-key-prerequisite').innerText(), /首次用單據相片辨識.*OpenRouter API Key.*已有金鑰可略過/);
  assert.equal(await page.getByTestId('interactive-tutorial').count(), 0, 'the prerequisite must stay outside the 16 numbered steps');
  assert.equal(await page.getByTestId('openrouter-key-video-link').getAttribute('href'), '#openrouter-key-video');
  await page.getByTestId('openrouter-key-video-link').click();
  await page.waitForFunction(() => location.hash === '#openrouter-key-video');
  const keyVideoVisible = await page.locator('#openrouter-key-video').evaluate(node => {
    const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.top < innerHeight;
  });
  assert(keyVideoVisible, 'the API Key link must bring the existing video into view');
  await page.getByTestId('skip-tutorials').click();
  await page.getByTestId('tutorial-hub').waitFor({ state: 'detached' });
  await page.getByTestId('start-tutorial').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('start-tutorial').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('tutorial-hub').count(), 0, 'first-visit prompt must not return after reload');
  await page.getByTestId('start-tutorial').click();
  await page.getByTestId('tutorial-hub').waitFor({ state: 'visible' });
  await page.getByTestId('start-interactive-tutorial').click();
  await waitStage(page, 'upload');
  await page.getByTestId('tutorial-close').click();
  assert.deepEqual(errors, [], 'tutorial hub or interactive entry caused a browser exception');
  results.push({ label: 'video-first-hub-one-time-prompt-no-autoplay', passed: true }); console.log('PASS video-first-hub-one-time-prompt-no-autoplay');
  await context.close();
}
async function runKeyStatusHintSmoke(browser) {
  for (const [label, key] of [['missing', ''], ['saved', 'test-api-key-only']]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(base + 'tests/README.md', { waitUntil: 'networkidle' });
    await page.evaluate(key => {
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', keys: { openrouter: key }, model: 'nvidia/nemotron-3.5-super-vl:free', allowPaidModels: false }));
      localStorage.setItem('billSplitterHistory', '[]');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
    }, key);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(hasKey => {
      const text = document.querySelector('[data-testid="open-free-key-settings"]')?.innerText || '';
      return hasKey ? text.includes('已設定') : text.includes('尚未設定免費鎖匙');
    }, Boolean(key));
    const statusText = await page.getByTestId('open-free-key-settings').innerText();
    if (key) {
      assert.match(statusText, /免費 .*已設定/);
      assert(!statusText.includes('預設唔使充值'));
      assert(!statusText.includes('點此可改模型或鎖匙'));
      assert(!statusText.includes('The default needs no top-up'));
      assert(!statusText.includes('Tap to change the model or key'));
    } else {
      assert.match(statusText, /尚未設定免費鎖匙/);
      assert.match(statusText, /點擊此處設定免費鎖匙/);
    }
    await context.close();
  }
  results.push({ label: 'key-status-hint-removed-but-missing-key-guidance-kept', passed: true });
  console.log('PASS key-status-hint-removed-but-missing-key-guidance-kept');
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    await runTutorialHubSmoke(browser);
    await runKeyStatusHintSmoke(browser);
    const sizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 844, height: 390 }];
    for (const language of ['zh-HK', 'en']) for (const viewport of sizes) {
      const label = `${language}-${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage(); const errors = [], businessRequests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/openrouter\.ai|ntfy\.sh/.test(r.url())) businessRequests.push(r.url().replace(/\?.*/, '')); });
      await seed(page, 2, language);
      await page.evaluate(() => window.scrollTo(0, 200));
      const before = await begin(page, null, label);
      for (let i = 0; i < stages.length; i++) {
        await waitStage(page, stages[i]);
        const node = target(page, i);
        await node.waitFor({ state: 'visible' });
        assert.equal(await demo(page).locator('main').getAttribute('data-current-step'), String(steps[i]), label + '-' + stages[i] + ': underlying App step mismatch');
        await checkGeometry(page, label + '-' + stages[i]);
        await assertGated(page, i, label + '-' + stages[i]);
        if (stages[i] === 'share-options') assert.equal(await page.locator('[data-tutorial-demo] dialog[open]').count(), 1, label + ': share panel should be open');
        if (stages[i] === 'report') assert.match(await target(page, 13).innerText(), /Cathy[\s\S]{0,100}44\.00|44\.00[\s\S]{0,100}Cathy/);
        if (viewport.width === 390 && language === 'zh-HK') await page.screenshot({ path: path.join(out, `tutorial-${stages[i]}.png`) });
        await advance(page, i);
      }
      await assertRestored(page, before, label);
      assert.deepEqual(errors, [], label + ': browser exceptions');
      assert.deepEqual(businessRequests, [], label + ': tutorial made a business network request');
      results.push({ label, passed: true, checks: '16 contextual stops, four underlying steps, target/card gating, non-modal compact geometry, sample calculation, complete restoration, no storage/network side effects' });
      console.log('PASS', label); await context.close();
    }

    for (const language of ['zh-HK', 'en']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage(); const errors = [], requests = [], fileChoosers = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/openrouter\.ai|ntfy\.sh/.test(r.url())) requests.push(r.url().replace(/\?.*/, '')); });
      page.on('filechooser', () => fileChoosers.push('filechooser'));
      await seed(page, 2, language);
      await page.evaluate(() => window.scrollTo(0, 200));
      const before = await begin(page, null, 'interactive-' + language);
      await runEditedSample(page, language);
      for (const index of [14, 15]) {
        if (index === 14) { await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-share'); }
        if (index === 15) { await page.getByTestId('tutorial-next').click(); await waitStage(page, 'detail'); }
        const actions = target(page, index);
        const buttons = actions.locator('button:not([disabled])');
        assert(await buttons.count() > 0, stages[index] + ': no action buttons to exercise');
        for (let i = 0; i < await buttons.count(); i++) {
          await buttons.nth(i).click();
          await page.getByTestId('tutorial-feedback').waitFor({ state: 'visible' });
        }
      }
      assert.deepEqual(await page.evaluate(() => window.__tutorialSideEffects), [], language + ': report action invoked share/clipboard/camera');
      assert.deepEqual(fileChoosers, [], language + ': tutorial opened a file chooser');
      assert.deepEqual(requests, [], language + ': tutorial made a business request');
      assert.deepEqual(errors, [], language + ': browser exception');
      await page.keyboard.press('Escape');
      await assertRestored(page, before, 'interactive-exit-' + language);

      // Manual-entry target is a safe in-demo shortcut directly to item editing.
      await page.getByTestId('start-tutorial').focus(); await page.getByTestId('start-tutorial').click();
      await page.getByTestId('start-interactive-tutorial').click(); await waitStage(page, 'upload');
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'manual');
      await target(page, 1).click(); await waitStage(page, 'items');
      await page.getByTestId('tutorial-close').click(); await assertRestored(page, before, 'manual-close-' + language);
      if (language === 'zh-HK') {
        await runPayerRecovery(page, before, 'payer-recovery');
        assert.deepEqual(await page.evaluate(() => window.__tutorialSideEffects), [], 'payer recovery invoked a share/clipboard/camera side effect');
        assert.deepEqual(fileChoosers, [], 'payer recovery opened a file chooser');
        assert.deepEqual(requests, [], 'payer recovery made a business request');
        assert.deepEqual(errors, [], 'payer recovery caused a browser exception');
        results.push({ label: 'empty-payer-validation-recovery', passed: true }); console.log('PASS empty-payer-validation-recovery');
      }
      results.push({ label: 'interactive-' + language, passed: true }); console.log('PASS interactive-' + language); await context.close();
    }

    for (const initialStep of [1, 2, 3, 4]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage(); await seed(page, initialStep, 'zh-HK');
      await page.evaluate(() => window.scrollTo(0, 200)); await page.getByTestId('start-tutorial').focus();
      const before = await snapshot(page); await instrument(page); await page.getByTestId('start-tutorial').click();
      await page.getByTestId('start-interactive-tutorial').click(); await waitStage(page, 'upload');
      // Exercise both a previous-stage exit and close/Escape from each original App step.
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'manual');
      await page.getByTestId('tutorial-prev').click(); await waitStage(page, 'upload');
      if (initialStep % 2) await page.keyboard.press('Escape'); else await page.getByTestId('tutorial-close').click();
      await assertRestored(page, before, 'exit-from-original-step-' + initialStep);
      await page.getByTestId('start-tutorial').click(); await page.getByTestId('start-interactive-tutorial').click(); await waitStage(page, 'upload');
      await page.getByTestId('tutorial-close').click(); await assertRestored(page, before, 'restart-from-step-' + initialStep);
      results.push({ label: 'exit-and-restart-from-step-' + initialStep, passed: true }); console.log('PASS exit-and-restart-from-step-' + initialStep); await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, cases: results }, null, 2) + '\n');
    console.log(`PASS ${results.length} browser cases. Results: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, cases: results, error: error.stack }, null, 2) + '\n'); console.error(error); process.exit(1); });
