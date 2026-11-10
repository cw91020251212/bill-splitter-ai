// Run a local static server first. Requires Playwright (no build step for app).
// PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/tutorial-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4178/';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('This state-writing test is local-only.');
const out = process.env.TEST_OUTPUT_DIR || '/tmp/bill-tutorial-qa';
fs.mkdirSync(out, { recursive: true });
const stages = ['upload', 'manual', 'verify', 'items', 'fee', 'share', 'share-options', 'replies', 'payer', 'currency', 'payment', 'tax-method', 'calculate', 'report', 'report-web', 'report-fallback', 'report-share', 'detail'];
const steps = [1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4];
const selectors = [
  '[data-testid="receipt-source-actions"]', '[data-testid="start-manual"]', '[data-testid="verify-item"]',
  '[data-tutorial-target="item-fields"]', '[data-tutorial-target="fee"]', '[data-tutorial-target="open-claim-share"]',
  '[data-tutorial-target="send-claim-link"]', '[data-testid="claim-replies"]',
  '[data-tutorial-target="calculation-settings"]', '[data-tutorial-target="currency"]', '[data-testid="payment-methods"]',
  '[data-tutorial-target="tax-method"]', '[data-testid="calculate-split"]', '[data-testid="friend-web-preferred-badge"]',
  '[data-testid="friend-web-intro"]', '[data-testid="report-fallback-toggle"]',
  '[data-testid="summary-report-actions"]', '[data-testid="detail-report-actions"]'
];
const results = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const tailwindPlayCdn = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'tailwind-playcdn-3.4.17.js.gz'))).toString('utf8');
async function stubTailwind(page) {
  await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: tailwindPlayCdn }));
}
function draft(step) {
  const item = { id: '01', name: '原有帳單項目', original: 'Original item', price: '99', total: 99, totalQty: null, unit: '' };
  return { schema: 1, assetRevision: 'test-assets-preserved', hasAssets: true, data: {
    step, claimItemIdVersion: 2, legacyClaimReviewRequired: false, items: [item], readReceipt: true, taxAmount: '9.9', taxNote: '原有備註',
    friendsReplies: '姓名：原有朋友\n01 = 1', payer: '原有墊支人', detectedCurrency: 'HKD', currency: 'HKD',
    taxSplitMethod: 'equal', paymentMethods: ['PayMe', '現金'], reconciliation: null, isSaved: false,
    includeReceiptImages: false, detailLang: 'full', pendingReceiptShare: false, claimRoom: null, claimInboxSeen: [], claimLinkShared: true,
    results: step === 4 ? { calculationVersion: 3, personTotals: { '原有朋友': { items: [{ ...item, amount: 99, qty: 1, totalClaimed: 1 }], adjustments: [], subtotal: 99, discount: 0, tax: 9.9, sourceTotal: 108.9, total: 108.9 } }, totalItemsCost: 99, itemsSubtotal: 99, discountAmount: 0, taxAmount: 9.9, sourceBillTotal: 108.9, billTotal: 108.9, sourceCurrency: 'HKD', sourceTotal: 108.9, exchangeRate: { rate: 1, date: '2026-10-28' }, exchangeRateDate: '2026-10-28', exchangeProvider: 'test', settlementRoundingAdjustmentUnits: 0, reconciliationAllocations: [], date: '2026-10-28', currency: 'HKD' } : null
  }};
}
async function seed(page, step, language) {
  await stubTailwind(page);
  await page.goto(base + 'tests/README.md', { waitUntil: 'networkidle' });
  await page.evaluate(async ({ record, language, png }) => {
    localStorage.setItem('billSplitterActiveDraftV1', JSON.stringify(record));
    localStorage.setItem('billSplitterLanguage', language);
    localStorage.setItem('billSplitterHistory', JSON.stringify([{ id: 'sentinel-history', date: '2026-10-27', simplified: '保留的歷史', detailed: '保留的明細', receiptImageCount: 1 }]));
    localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', ocrEngine: 'openrouter', key: '', model: 'nvidia/nemotron-nano-12b-v2-vl:free', allowPaidModels: false }));
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
    const trash = page.getByTestId('remove-item').first();
    const expectedTrashName = language === 'en' ? 'Delete item: 原有帳單項目' : '刪除項目：原有帳單項目';
    assert.equal(await trash.getAttribute('aria-label'), expectedTrashName, language + ': trash icon has a localized accessible name');
    const trashBox = await trash.boundingBox();
    assert.deepEqual([Math.round(trashBox.width), Math.round(trashBox.height)], [44, 44], language + ': trash target is 44×44 CSS px on mobile');
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
  assert.equal(after.focus, 'header-action-menu-toggle', label + ': focus should return to the visible actions menu after the guide closes');
  assert.deepEqual(await page.evaluate(() => window.__tourWrites), [], label + ': tutorial wrote storage');
}
async function begin(page, before, label) {
  const menuToggle = page.getByTestId('header-action-menu-toggle');
  await menuToggle.focus();
  const baseline = before || await snapshot(page);
  if (!before) await instrument(page);
  await menuToggle.click();
  await page.getByTestId('start-tutorial').waitFor({ state: 'visible' });
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
  if (index === 8) await target(page, 8).locator('input').first().fill('阿明');
  if (index === 12) {
    await target(page, 12).click();
    await waitStage(page, 'report');
    return;
  }
  if (index === 15) {
    assert.equal(await target(page, 15).getAttribute('aria-expanded'), 'false', 'backup options should start collapsed');
    await target(page, 15).click();
    await waitStage(page, 'report-share');
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
  const taxInput = demo(page).getByTestId('tax-amount');
  const taxInputId = await taxInput.getAttribute('id');
  assert(taxInputId, `${language}: tax input must have a unique id`);
  assert.equal(await taxInput.getAttribute('inputmode'), 'decimal', `${language}: tax input requests a decimal mobile keypad`);
  const taxLabel = demo(page).locator(`label[for="${taxInputId}"]`);
  assert.equal(await taxLabel.count(), 1, `${language}: tax label is programmatically associated with its field`);
  assert.match(await taxLabel.innerText(), language === 'en' ? /Tax \/ service fee/ : /稅費／服務費/);
  const taxHintSize = parseFloat(await demo(page).getByTestId('tax-amount-hint').evaluate(el => getComputedStyle(el).fontSize));
  assert(taxHintSize >= 14, `${language}: amount guidance is at least 14px (${taxHintSize}px)`);
  await feeInput.fill('15');
  assert.equal(await feeInput.inputValue(), '15', 'sample fee edit did not stick');
  const billDiscount = demo(page).getByTestId('discount-amount');
  const discountId = await billDiscount.getAttribute('id');
  assert(discountId, `${language}: discount input must have a unique id`);
  assert.equal(await billDiscount.getAttribute('inputmode'), 'decimal', `${language}: discount input requests a decimal mobile keypad`);
  const discountLabel = demo(page).locator(`label[for="${discountId}"]`);
  assert.equal(await discountLabel.count(), 1, `${language}: discount label is programmatically associated with its field`);
  assert.match(await discountLabel.innerText(), language === 'en' ? /Bill-wide discount/ : /整單折扣/);
  const discountHintSize = parseFloat(await demo(page).getByTestId('discount-amount-hint').evaluate(el => getComputedStyle(el).fontSize));
  assert(discountHintSize >= 14, `${language}: discount guidance is at least 14px (${discountHintSize}px)`);
  await billDiscount.fill('30');
  assert.equal(await billDiscount.inputValue(), '30', 'sample bill-wide discount did not stick');
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
  await taxRadios.nth(0).check(); // after a $30 bill-wide discount, the $150 item base becomes $120; with $15 tax Cathy owes $45.
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'calculate');
  await target(page, 12).click(); await waitStage(page, 'report');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-web');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-fallback');
  await target(page, 15).click(); await waitStage(page, 'report-share');
  const report = await page.getByTestId('final-summary-preview').innerText();
  assert.match(report, language === 'en' ? /Payee：Cathy/ : /收款人：Cathy/, language + ': edited payer must be Cathy');
  const owedAmount = text => text.match(/(?:Owes|應付) \$([\d,]+\.\d{2})/)?.[1] || null;
  assert.equal(owedAmount(report), '90.00', language + ': proportional fee split should calculate the sample debt');

  // Equal fee/tax split changes the amount owed after the same discount.
  for (const previous of ['report-fallback', 'report-web', 'report', 'calculate', 'tax-method']) {
    await page.getByTestId('tutorial-prev').click(); await waitStage(page, previous);
  }
  await taxRadios.nth(1).check();
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'calculate');
  await target(page, 12).click(); await waitStage(page, 'report');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-web');
  await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-fallback');
  await target(page, 15).click(); await waitStage(page, 'report-share');
  const equalReport = await page.getByTestId('final-summary-preview').innerText();
  assert.match(equalReport, language === 'en' ? /Payee：Cathy/ : /收款人：Cathy/, language + ': equal fee split must retain edited payer');
  assert.notEqual(owedAmount(equalReport), owedAmount(report), language + ': changing fee split must update the amount owed');
  for (const previous of ['report-fallback', 'report-web', 'report']) {
    await page.getByTestId('tutorial-prev').click(); await waitStage(page, previous);
  }
}
async function restartInteractive(page) {
  const menuToggle = page.getByTestId('header-action-menu-toggle');
  const start = page.getByTestId('start-tutorial');
  if (await menuToggle.getAttribute('aria-expanded') !== 'true') await menuToggle.click();
  await page.locator('#header-action-menu').waitFor({ state: 'visible' });
  await start.waitFor({ state: 'visible' });
  await start.click();
  await page.getByTestId('start-interactive-tutorial').waitFor({ state: 'visible' });
  await page.getByTestId('start-interactive-tutorial').click();
  await waitStage(page, 'upload');
}
async function runPayerRecovery(page, before, label) {
  await restartInteractive(page);
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
  await stubTailwind(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByTestId('tutorial-hub').waitFor({ state: 'visible' });
  const directoryOrder = await page.locator('[data-testid="video-lessons-directory"], [data-testid="interactive-guide-directory"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
  assert.deepEqual(directoryOrder, ['video-lessons-directory', 'interactive-guide-directory'], 'video directory must come first, interactive guide second');
  assert.equal(await page.locator('#video-lessons-title').innerText(), '影片教學');
  const videoSources = await page.locator('[data-testid="video-lessons-directory"] video source').evaluateAll(nodes => nodes.map(node => (node.getAttribute('src') || '').split('?')[0]));
  assert.deepEqual(videoSources, ['./assets/OpenRouter_API_Key_Tutorial_Circled.mp4', './assets/bill-splitter-operation-cantonese.mp4'], 'OpenRouter setup must precede the operation clip');
  const videoSourceUrls = await page.locator('[data-testid="video-lessons-directory"] video source').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  assert.deepEqual(videoSourceUrls, ['./assets/OpenRouter_API_Key_Tutorial_Circled.mp4?v=20261103-1', './assets/bill-splitter-operation-cantonese.mp4']);
  const keyDescription = await page.locator('#openrouter-key-video p').innerText();
  assert.match(keyDescription, /OpenRouter API Key/);
  assert.doesNotMatch(keyDescription, /OCR|單據|辨識|翻譯/);
  const operationDescription = await page.locator('[data-testid="operation-video-card"] p').innerText();
  assert.match(operationDescription, /約 1 分鐘示範分帳流程/);
  assert.doesNotMatch(operationDescription, /OCR|文字識別|翻譯/);
  const videoStates = await page.locator('[data-testid="video-lessons-directory"] video').evaluateAll(nodes => nodes.map(node => ({ autoplay: node.hasAttribute('autoplay'), paused: node.paused, preload: node.getAttribute('preload') })));
  assert.deepEqual(videoStates, [{ autoplay: false, paused: true, preload: 'none' }, { autoplay: false, paused: true, preload: 'none' }], 'videos must wait for a user tap');
  assert.match(await page.getByTestId('tutorial-hub-intro').innerText(), /教學中心/);
  assert.equal(await page.locator('#openrouter-key-video').count(), 1, 'the OpenRouter setup video should be present in the current hub');
  assert.match(await page.getByTestId('interactive-guide-directory').innerText(), /互動教學/);
  await page.getByTestId('skip-tutorials').click();
  await page.getByTestId('tutorial-hub').waitFor({ state: 'detached' });
  await page.getByTestId('header-action-menu-toggle').click();
  await page.getByTestId('start-tutorial').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('header-action-menu-toggle').click();
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
    await stubTailwind(page);
    await page.goto(base + 'tests/README.md', { waitUntil: 'networkidle' });
    await page.evaluate(key => {
      localStorage.setItem('billSplitterApiConfig', JSON.stringify({ engine: 'openrouter', ocrEngine: 'openrouter', keys: { openrouter: key }, model: 'nvidia/nemotron-3.5-super-vl:free', allowPaidModels: false }));
      localStorage.setItem('billSplitterHistory', '[]');
      localStorage.setItem('billSplitterLanguage', 'zh-HK');
    }, key);
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.getByTestId('scan-settings').evaluate(details => details.open), false, 'recognition settings remain collapsed on the phone first screen');
    const shortHint = page.getByTestId('scan-key-short-hint');
    if (key) {
      assert.equal(await shortHint.count(), 0, 'configured key does not show the missing-key hint');
    } else {
      assert.equal(await shortHint.isVisible(), true, 'missing-key guidance appears beside photo recognition');
      assert.match(await shortHint.innerText(), /未設鎖匙；文字／手動輸入。/);
    }
    await page.getByTestId('scan-settings-toggle').click();
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
      assert.match(statusText, /相片及一般文字需要免費鎖匙；符合格式的 JSON 文字可免鎖匙直接匯入/);
    }
    await context.close();
  }
  results.push({ label: 'key-status-hint-removed-but-missing-key-guidance-kept', passed: true });
  console.log('PASS key-status-hint-removed-but-missing-key-guidance-kept');
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    if (process.env.TUTORIAL_UI_INTERACTIVE_ONLY !== '1') {
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
        if (stages[i] === 'report') assert.match(await target(page, 13).innerText(), /首選|PREFERRED/i);
        if (stages[i] === 'report-web' || stages[i] === 'report-fallback') assert.equal(await target(page, 15).getAttribute('aria-expanded'), 'false', label + ': text backups must start collapsed');
        if (viewport.width === 390 && language === 'zh-HK') await page.screenshot({ path: path.join(out, `tutorial-${stages[i]}.png`) });
        await advance(page, i);
      }
      await assertRestored(page, before, label);
      assert.deepEqual(errors, [], label + ': browser exceptions');
      assert.deepEqual(businessRequests, [], label + ': tutorial made a business network request');
      results.push({ label, passed: true, checks: '18 contextual stops, four underlying steps, target/card gating, non-modal compact geometry, sample calculation, complete restoration, no storage/network side effects' });
      console.log('PASS', label); await context.close();
      }
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
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-web');
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-fallback');
      if (await target(page, 15).getAttribute('aria-expanded') === 'false') {
        await target(page, 15).click(); await waitStage(page, 'report-share');
      } else {
        await page.getByTestId('tutorial-next').click(); await waitStage(page, 'report-share');
      }
      assert.match(await page.getByTestId('final-summary-preview').innerText(), language === 'en' ? /Payee：Cathy/ : /收款人：Cathy/);
      const summaryButtons = target(page, 16).locator('button:not([disabled])');
      assert(await summaryButtons.count() > 0, stages[16] + ': no action buttons to exercise');
      for (let i = 0; i < await summaryButtons.count(); i++) { await summaryButtons.nth(i).click(); await page.getByTestId('tutorial-feedback').waitFor({ state: 'visible' }); }
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'detail');
      const detailButtons = target(page, 17).locator('button:not([disabled])');
      assert(await detailButtons.count() > 0, stages[17] + ': no action buttons to exercise');
      for (let i = 0; i < await detailButtons.count(); i++) { await detailButtons.nth(i).click(); await page.getByTestId('tutorial-feedback').waitFor({ state: 'visible' }); }
      assert.deepEqual(await page.evaluate(() => window.__tutorialSideEffects), [], language + ': report action invoked share/clipboard/camera');
      assert.deepEqual(fileChoosers, [], language + ': tutorial opened a file chooser');
      assert.deepEqual(requests, [], language + ': tutorial made a business request');
      assert.deepEqual(errors, [], language + ': browser exception');
      await page.keyboard.press('Escape');
      await assertRestored(page, before, 'interactive-exit-' + language);

      // Manual-entry target is a safe in-demo shortcut directly to item editing.
      await restartInteractive(page);
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
      await page.evaluate(() => window.scrollTo(0, 200));
      const before = await snapshot(page); await instrument(page);
      await restartInteractive(page);
      // Exercise both a previous-stage exit and close/Escape from each original App step.
      await page.getByTestId('tutorial-next').click(); await waitStage(page, 'manual');
      await page.getByTestId('tutorial-prev').click(); await waitStage(page, 'upload');
      if (initialStep % 2) await page.keyboard.press('Escape'); else await page.getByTestId('tutorial-close').click();
      await assertRestored(page, before, 'exit-from-original-step-' + initialStep);
      await restartInteractive(page);
      await page.getByTestId('tutorial-close').click(); await assertRestored(page, before, 'restart-from-step-' + initialStep);
      results.push({ label: 'exit-and-restart-from-step-' + initialStep, passed: true }); console.log('PASS exit-and-restart-from-step-' + initialStep); await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, cases: results }, null, 2) + '\n');
    console.log(`PASS ${results.length} browser cases. Results: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, cases: results, error: error.stack }, null, 2) + '\n'); console.error(error); process.exit(1); });
