'use strict';

// Read-only site/UI test. All Worker and relay requests are intercepted;
// no real shared bill is read, created, changed or sent.
// BASE_URL=http://127.0.0.1:4192/ PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/usr/bin/chromium node tests/friend-navigation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const relay = require('../claim-relay.js');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4192/');
if (!['127.0.0.1', 'localhost', 'cw91020251212.github.io'].includes(base.hostname)) throw new Error('Unexpected test target.');
const screenshots = process.env.SCREENSHOT_DIR || '';
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
const id = 'A'.repeat(22);
const now = Date.now();
const expiry = new Date(now + 86400000).toISOString();
const sample = {
  version: 2, language: 'zh-HK',
  bill: { date: '2026-11-07', payer: '主辦人', currency: 'HKD', sourceCurrency: 'HKD', sourceTotal: 20, sourceBillTotal: 20, billTotal: 20, itemsSubtotal: 20, paymentMethods: ['現金'], receiptImageCount: 0 },
  participants: [{ name: '測試朋友', total: 20, sourceTotal: 20, subtotal: 20, tax: 0, discount: 0 }],
  items: [{ id: '01', number: '01', name: '茶', quantity: 1, unit: '', sourceAmount: 20, allocatedAmount: 20, shares: [{ person: '測試朋友', quantity: 1, amount: 20, allocationTotal: 1 }] }],
  adjustments: [], images: []
};
const detailUrl = share => {
  const url = new URL('detailed-view.html', base);
  url.searchParams.set('v', 'v132-restore-r127-ui-20261111');
  if (share !== undefined) url.searchParams.set('share', share);
  return url.href;
};
async function assertFriendOnly(page) {
  await assert.equal(await page.locator('#friend-page-heading').innerText(), '分帳結果');
  assert.equal(await page.locator('#friend-page-heading').isVisible(), true);
  assert.equal(await page.locator('#local-back').isVisible(), false);
  assert.equal(await page.locator('#local-back').getAttribute('href'), null);
  const organizerLinks = await page.locator('a[href]').evaluateAll(nodes => nodes.filter(node => {
    const url = new URL(node.href);
    return url.origin === location.origin && (url.pathname.endsWith('/index.html') || url.pathname === new URL('.', location.href).pathname);
  }).length);
  assert.equal(organizerLinks, 0, 'no organizer navigation exists on friend page');
}
async function assertBlueLinkContrast(page) {
  const styles = await page.evaluate(() => {
    const get = selector => { const node = document.querySelector(selector); const css = getComputedStyle(node); return { border: css.borderTopColor, width: css.borderTopWidth, background: css.backgroundColor }; };
    return { page: getComputedStyle(document.body).backgroundColor, card: get('#preview-content .card'), member: get('#member-select'), control: get('#font-size-toggle'), optional: get('.optional'), icon: getComputedStyle(document.querySelector('.optional > summary'), '::after').borderTopColor };
  });
  assert.equal(styles.page, 'rgb(188, 202, 215)');
  for (const key of ['card', 'member', 'control', 'optional']) {
    assert.equal(styles[key].border, 'rgb(51, 78, 104)', `${key} has a dark blue outline`);
    assert.equal(styles[key].width, '1px', `${key} keeps a thin outline`);
  }
  assert.equal(styles.card.background, 'rgb(213, 223, 232)');
  assert.equal(styles.member.background, 'rgb(198, 212, 224)');
  assert.equal(styles.control.background, 'rgb(197, 211, 223)');
  assert.equal(styles.optional.background, 'rgb(213, 223, 232)');
  assert.equal(styles.icon, 'rgb(51, 78, 104)');
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const failures = [];
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    // A pre-existing local preview must never leak into a shared/error view.
    await context.addInitScript(data => localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify(data)), sample);
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await context.route('https://ntfy.sh/**', route => route.abort('blockedbyclient'));
    let mode = 'waiting';
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    const calls = [];
    const headers = { 'access-control-allow-origin': '*' };
    await context.route(/\/api\/shares(?:\/|$)/, async route => {
      const request = route.request();
      assert.equal(request.method(), 'GET', 'test never writes a Worker record');
      calls.push(request.url());
      const path = new URL(request.url()).pathname;
      if (mode === 'waiting') await responseGate;
      if (mode === 'network-error') return route.abort('failed');
      if (mode === 'missing') return route.fulfill({ status: 404, headers, contentType: 'application/json', body: JSON.stringify({ error: 'not_found', serverNow: new Date().toISOString() }) });
      if (mode === 'expired') return route.fulfill({ status: 410, headers, contentType: 'application/json', body: JSON.stringify({ error: 'expired', serverNow: new Date().toISOString() }) });
      assert.equal(path, `/api/shares/${id}`);
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ status: 'ready', data: sample, expiresAt: expiry, serverNow: new Date().toISOString() }) });
    });

    await page.goto(detailUrl(id), { waitUntil: 'domcontentloaded' });
    await assertFriendOnly(page);
    assert.equal(await page.locator('#loading-state').isVisible(), true);
    mode = 'ready'; releaseResponse();
    await page.locator('#preview-content').waitFor({ state: 'visible' });
    await assertFriendOnly(page);
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('shared-link-view')), true, 'shared result link receives its distinct theme');
    const sharedSummaryColor = await page.locator('#friend-amount-summary').evaluate(node => getComputedStyle(node).backgroundImage);
    assert(sharedSummaryColor.includes('rgb(75, 136, 196)'), `shared result uses a medium blue accent: ${sharedSummaryColor}`);
    if (screenshots) await page.screenshot({ path: path.join(screenshots, 'friend-result-no-main-button.png'), fullPage: true });
    const address = page.url();
    await page.locator('#friend-page-heading').click();
    assert.equal(page.url(), address, 'the heading is text, not a return button');
    await page.locator('#member-select').selectOption({ label: '測試朋友' });
    await assertBlueLinkContrast(page);
    assert.match(await page.locator('#grand-total').innerText(), /20/);
    await assertFriendOnly(page);
    assert.equal(await page.locator('#share-paid-notice').innerText(), '付款後請通知收款人');
    const fontToggle = page.locator('#font-size-toggle');
    const smallText = page.locator('[data-font-size="small"]');
    const normalText = page.locator('[data-font-size="normal"]');
    const largeText = page.locator('[data-font-size="large"]');
    assert.equal(await fontToggle.isVisible(), true);
    const fontToggleBox = await fontToggle.boundingBox();
    assert(fontToggleBox.height >= 44 && fontToggleBox.width >= 120, `three-level font control has a large tap target: ${JSON.stringify(fontToggleBox)}`);
    assert.equal(await smallText.getAttribute('aria-pressed'), 'false');
    assert.equal(await normalText.getAttribute('aria-pressed'), 'true');
    assert.equal(await largeText.getAttribute('aria-pressed'), 'false');
    const normalFontSize = Number.parseFloat(await page.locator('#page-title').evaluate(node => getComputedStyle(node).fontSize));
    const normalNoticeSize = Number.parseFloat(await page.locator('#share-paid-notice').evaluate(node => getComputedStyle(node).fontSize));
    await smallText.click();
    assert.equal(await smallText.getAttribute('aria-pressed'), 'true');
    const smallerFontSize = Number.parseFloat(await page.locator('#page-title').evaluate(node => getComputedStyle(node).fontSize));
    assert(smallerFontSize < normalFontSize * .95, `small text is distinct from standard: ${smallerFontSize} < ${normalFontSize}`);
    await normalText.click();
    assert.equal(await normalText.getAttribute('aria-pressed'), 'true');
    const restoredStandardSize = Number.parseFloat(await page.locator('#page-title').evaluate(node => getComputedStyle(node).fontSize));
    assert(Math.abs(restoredStandardSize - normalFontSize) < 1, `standard text restores original size: ${restoredStandardSize}`);
    await largeText.click();
    assert.equal(await largeText.getAttribute('aria-pressed'), 'true');
    const enlargedFontSize = Number.parseFloat(await page.locator('#page-title').evaluate(node => getComputedStyle(node).fontSize));
    assert(enlargedFontSize > normalFontSize * 1.15, `text enlarges by about 20%: ${normalFontSize} -> ${enlargedFontSize}`);
    const enlargedNoticeSize = Number.parseFloat(await page.locator('#share-paid-notice').evaluate(node => getComputedStyle(node).fontSize));
    assert(enlargedNoticeSize > normalNoticeSize * 1.15, 'payment instruction text also enlarges');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'large text does not cause horizontal overflow on mobile');
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'large text does not overflow a 320px viewport');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#preview-content').waitFor({ state: 'visible' });
    await page.locator('#member-select').selectOption({ label: '測試朋友' });
    assert.equal(await page.locator('[data-font-size="large"]').getAttribute('aria-pressed'), 'true', 'large-text preference persists in this browser');
    await page.locator('[data-font-size="normal"]').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await assertBlueLinkContrast(page);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('[data-font-size="normal"]').getAttribute('aria-pressed'), 'true');
    const restoredFontSize = Number.parseFloat(await page.locator('#page-title').evaluate(node => getComputedStyle(node).fontSize));
    assert(Math.abs(restoredFontSize - normalFontSize) < 1, `A− restores normal text size: ${restoredFontSize}`);
    console.log('PASS shared loading, member selection, result and heading click stay on friend page.');

    for (const state of ['expired', 'missing', 'network-error']) {
      mode = state;
      await page.goto(detailUrl(id), { waitUntil: 'domcontentloaded' });
      await page.locator('#empty-state').waitFor({ state: 'visible' });
      await assertFriendOnly(page);
      assert.equal(await page.locator('#preview-content').isVisible(), false);
      assert.match(await page.locator('#empty-state p').innerText(), /向發起人索取新連結/);
    }
    const countBeforeEmptyId = calls.length;
    await page.goto(detailUrl(''), { waitUntil: 'domcontentloaded' });
    await page.locator('#empty-state').waitFor({ state: 'visible' });
    await assertFriendOnly(page);
    assert.equal(calls.length, countBeforeEmptyId, 'invalid blank ID never contacts Worker');
    assert.equal(await page.locator('#preview-content').isVisible(), false, 'blank share never falls back to local preview');
    console.log('PASS expired, missing, network failure and blank share never expose organizer/local preview.');

    mode = 'ready';
    const claim = new URL('claim.html', base);
    claim.searchParams.set('session', id);
    claim.searchParams.set('lang', 'zh-HK');
    claim.searchParams.set('v', 'v132-restore-r127-ui-20261111');
    claim.hash = relay.buildHash(Buffer.from(JSON.stringify([{ id: '01', name: '茶', totalQty: null, unit: '' }])).toString('base64url'), relay.createRoom(), { title: '聚餐', createdAt: now, expiresAt: Date.parse(expiry) });
    await page.goto(claim.href, { waitUntil: 'domcontentloaded' });
    await page.locator('iframe.same-link-result').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(document.documentElement).getPropertyValue('--green-dark').trim()), '#234f80', 'claim link uses blue accents');
    const element = await page.locator('iframe.same-link-result').elementHandle();
    const frame = await element.contentFrame();
    await frame.locator('#preview-content').waitFor({ state: 'visible' });
    await assertFriendOnly(frame);
    assert.equal(new URL(frame.url()).searchParams.get('v'), 'v132-restore-r127-ui-20261111');
    await frame.locator('#friend-page-heading').click();
    await frame.locator('#member-select').selectOption({ label: '測試朋友' });
    await assertBlueLinkContrast(frame);
    assert.match(await frame.locator('#grand-total').innerText(), /20/);
    assert.equal(await frame.locator('#share-paid-notice').innerText(), '付款後請通知收款人');
    assert.equal(await frame.locator('#font-size-toggle').isVisible(), true);
    assert.equal(page.url(), claim.href, 'same external friend link is unchanged');
    assert.equal(await frame.locator('[data-live-app]').count(), 0, 'main app never mounts inside friend frame');
    console.log('PASS original claim-link iframe remains friend-only with the same external URL.');

    await page.goto(detailUrl(undefined), { waitUntil: 'domcontentloaded' });
    await page.locator('#preview-content').waitFor({ state: 'visible' });
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('shared-link-view')), false, 'organizer local preview keeps the main-app theme');
    const localSummaryColor = await page.locator('#friend-amount-summary').evaluate(node => getComputedStyle(node).backgroundImage);
    assert(localSummaryColor.includes('rgb(23, 106, 67)'), `local preview remains green: ${localSummaryColor}`);
    assert.equal(await page.locator('#local-back').isVisible(), true);
    assert.equal(new URL(await page.locator('#local-back').getAttribute('href'), page.url()).pathname, new URL('index.html', base).pathname);
    assert.equal(await page.locator('#friend-page-heading').isVisible(), false);
    console.log('PASS organizer local preview retains its own return button.');
    const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      await legacyContext.addInitScript(data => {
        localStorage.setItem('billSplitResultLargeTextV1', '1');
        localStorage.setItem('billSplitterDetailTablePreviewV1', JSON.stringify(data));
      }, sample);
      const legacyPage = await legacyContext.newPage();
      await legacyPage.goto(detailUrl(undefined), { waitUntil: 'domcontentloaded' });
      await legacyPage.locator('#preview-content').waitFor({ state: 'visible' });
      assert.equal(await legacyPage.locator('body').evaluate(node => node.classList.contains('large-text')), true, 'legacy A+ preference migrates to the large tier');
      assert.equal(await legacyPage.locator('[data-font-size="large"]').getAttribute('aria-pressed'), 'true');
      console.log('PASS existing friend-page A+ preference migrates to the large tier.');
    } finally { await legacyContext.close(); }
    assert.equal(failures.length, 0, JSON.stringify(failures));
  } finally {
    await context?.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
