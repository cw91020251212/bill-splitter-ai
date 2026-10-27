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
const stages = ['upload', 'items', 'share', 'replies', 'payer', 'report'];
const selectors = ['[data-testid="receipt-source-actions"]', '[data-tutorial-target="item-editor"]', 'dialog[aria-labelledby="claim-share-title"]', '[data-testid="claim-replies"]', '[data-tutorial-target="calculation-settings"]', '[data-testid="summary-report-actions"]'];
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
  await page.waitForTimeout(600); // allow original draft/image restoration and parser to settle
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
  });
}
async function checkGeometry(page, name) {
  await page.waitForTimeout(150);
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="tutorial-card"]').getBoundingClientRect();
    const ring = document.querySelector('[data-testid="tutorial-highlight"]')?.getBoundingClientRect();
    const rect = r => r && ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    return { card: rect(card), ring: rect(ring), width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert(!geometry.overflow, name + ': horizontal overflow');
  assert(geometry.card.left >= -1 && geometry.card.right <= geometry.width + 1 && geometry.card.top >= -1 && geometry.card.bottom <= geometry.height + 1, name + ': card clipped ' + JSON.stringify(geometry));
  assert(geometry.ring && geometry.ring.width > 10 && geometry.ring.height > 5, name + ': missing highlight');
  const overlap = Math.max(0, Math.min(geometry.card.right, geometry.ring.right) - Math.max(geometry.card.left, geometry.ring.left)) * Math.max(0, Math.min(geometry.card.bottom, geometry.ring.bottom) - Math.max(geometry.card.top, geometry.ring.top));
  assert(overlap < 4, name + ': card covers highlight ' + JSON.stringify(geometry));
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
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    const sizes = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 844, height: 390 }];
    for (const language of ['zh-HK', 'en']) for (const viewport of sizes) {
      const label = `${language}-${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage(); const errors = [], businessRequests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/openrouter\.ai|ntfy\.sh/.test(r.url())) businessRequests.push(r.url().replace(/\?.*/, '')); });
      await seed(page, 2, language);
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.getByTestId('start-tutorial').focus();
      const before = await snapshot(page); await instrument(page);
      await page.getByTestId('start-tutorial').click();
      for (let i = 0; i < stages.length; i++) {
        await page.waitForFunction(stage => document.querySelector('[data-testid="interactive-tutorial"]')?.dataset.stage === stage, stages[i]);
        const target = page.locator('[data-tutorial-demo]').locator(selectors[i]);
        await target.waitFor({ state: 'visible' });
        if (stages[i] === 'items') assert.equal(await target.locator('input[type="text"]').first().inputValue(), language === 'en' ? 'Signature fried rice' : '招牌炒飯');
        if (stages[i] === 'share') assert.equal(await target.getAttribute('open'), '');
        if (stages[i] === 'replies') assert.match(await target.inputValue(), /Cathy/);
        if (stages[i] === 'report') assert.match(await page.locator('[data-tutorial-demo] [data-testid="final-summary-preview"]').innerText(), /44\.00/);
        await checkGeometry(page, label + '-' + stages[i]);
        if (viewport.width === 390 && language === 'zh-HK') await page.screenshot({ path: path.join(out, `tutorial-${stages[i]}.png`) });
        await page.getByTestId('tutorial-next').click();
      }
      await assertRestored(page, before, label);
      assert.deepEqual(errors, [], label + ': browser exceptions');
      assert.deepEqual(businessRequests, [], label + ': tutorial made a business network request');
      results.push({ label, passed: true, checks: '6 screens / 4 steps, geometry, automatic hidden UI, sample calculation, completion restoration, zero storage writes, zero business network requests' });
      console.log('PASS', label); await context.close();
    }
    for (const initialStep of [1, 2, 3, 4]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage(); await seed(page, initialStep, 'zh-HK');
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.getByTestId('start-tutorial').focus();
      const before = await snapshot(page); await instrument(page);
      await page.getByTestId('start-tutorial').click();
      for (let i = 0; i < initialStep; i++) await page.getByTestId('tutorial-next').click();
      await page.getByTestId('tutorial-prev').click();
      if (initialStep % 2) await page.keyboard.press('Escape'); else await page.getByTestId('tutorial-close').click();
      await assertRestored(page, before, 'exit-from-original-step-' + initialStep);
      // Same live app can restart the tutorial cleanly after either exit route.
      await page.getByTestId('start-tutorial').click();
      assert.equal(await page.getByTestId('interactive-tutorial').getAttribute('data-stage'), 'upload');
      await page.getByTestId('tutorial-close').click();
      await assertRestored(page, before, 'restart-from-step-' + initialStep);
      results.push({ label: 'exit-and-restart-from-step-' + initialStep, passed: true });
      console.log('PASS exit-and-restart-from-step-' + initialStep); await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, cases: results }, null, 2) + '\n');
    console.log(`PASS ${results.length} browser cases. Results: ${out}`);
  } finally { await browser.close(); }
})().catch(error => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: false, cases: results, error: error.stack }, null, 2) + '\n'); console.error(error); process.exit(1); });
