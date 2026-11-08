'use strict';

/*
 * LOCAL/read-only-site E2E. Every Worker and ntfy request is mocked, and all
 * other cross-origin requests are blocked. No real claim/share is read/written.
 *
 * node tests/friend-revisions.cjs
 * BASE_URL=https://<owner>.github.io/<repo>/ node tests/friend-revisions.cjs
 * Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, SCREENSHOT_DIR.
 * State waits <= 5 s; real recalculation polling waits <= 8 s.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/tmp/ui-qa/node_modules/playwright');
const relay = require('../claim-relay.js');
const revisions = require('../claim-revisions.js');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4192/');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) && !(base.protocol === 'https:' && base.hostname.endsWith('.github.io'))) {
  throw new Error('BASE_URL must be localhost or a read-only public GitHub Pages site.');
}
if (!base.pathname.endsWith('/')) base.pathname += '/';
const shots = process.env.SCREENSHOT_DIR || '';
const PERSON = '測試朋友';
const OTHER = '主辦人';
const SHARE_ID = 'R'.repeat(22);
const SHARE_RE = /\/api\/shares(?:\/|$)/; // Glob **/api/shares** does not reliably cover nested paths.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*'
};
const ITEMS = [
  { id: '01', name: '奶茶', nameEn: 'Milk tea', totalQty: 6, unit: '杯' },
  { id: '02', name: '共享小食', nameEn: 'Shared snack', totalQty: null, unit: '' }
];
const clone = value => JSON.parse(JSON.stringify(value));
function published(qty = 1, shared = 2 / 3, actual = true, actualUnit = '杯') {
  const personTotal = qty * 60 + shared * 60;
  return {
    version: 2, language: 'zh-HK',
    bill: { date: '2026-11-07', payer: OTHER, currency: 'HKD', sourceCurrency: 'HKD', sourceTotal: 420, sourceBillTotal: 420, billTotal: 420, itemsSubtotal: 420, paymentMethods: ['現金'], receiptImageCount: 0 },
    participants: [{ name: PERSON, total: personTotal, sourceTotal: personTotal, subtotal: personTotal, tax: 0, discount: 0 }, { name: OTHER, total: 420 - personTotal, sourceTotal: 420 - personTotal, subtotal: 420 - personTotal, tax: 0, discount: 0 }],
    items: [
      { id: '01', number: '01', name: '奶茶', quantity: 6, unit: '杯', sourceAmount: 360, allocatedAmount: 360, shares: [
        ...(qty ? [{ person: PERSON, quantity: qty, unit: actualUnit, isActualUnit: actual, amount: qty * 60, allocationTotal: 6 }] : []),
        { person: OTHER, quantity: 6 - qty, unit: '杯', isActualUnit: true, amount: (6 - qty) * 60, allocationTotal: 6 }
      ] },
      { id: '02', number: '02', name: '共享小食', quantity: 1, unit: '', sourceAmount: 60, allocatedAmount: 60, shares: [
        ...(shared ? [{ person: PERSON, quantity: shared, unit: '份', isActualUnit: false, amount: shared * 60, allocationTotal: 1 }] : []),
        { person: OTHER, quantity: 1 - shared, unit: '份', isActualUnit: false, amount: (1 - shared) * 60, allocationTotal: 1 }
      ] }
    ], adjustments: [], images: []
  };
}
function clearedResult() {
  const data = published(0, 0);
  data.participants = data.participants.filter(person => person.name !== PERSON);
  return data;
}
function claimUrl(room, id = SHARE_ID, metadata = {}) {
  const now = Date.now();
  const url = new URL('claim.html', base);
  if (id) url.searchParams.set('session', id);
  url.searchParams.set('lang', 'zh-HK');
  url.searchParams.set('v', 'v103-edit-friend-claims');
  url.hash = relay.buildHash(Buffer.from(JSON.stringify(ITEMS)).toString('base64url'), room, {
    title: '本機測試聚餐', createdAt: now - 60000, expiresAt: now + 86400000, ...metadata
  });
  return url.href;
}
async function until(predicate, description, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out after ${timeout} ms: ${description}`);
}
async function visible(scope, selector) { await scope.locator(selector).waitFor({ state: 'visible', timeout: 5000 }); }
async function hidden(scope, selector, explanation = selector) {
  assert.equal(await scope.locator(selector).isVisible(), false, explanation);
}
async function screenshot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `revision-${name}.png`), fullPage: true });
}
async function resultFrame(page, timeout = 5000) {
  await page.locator('iframe.same-link-result').waitFor({ state: 'visible', timeout });
  const frame = await (await page.locator('iframe.same-link-result').elementHandle()).contentFrame();
  await visible(frame, '#preview-content');
  return frame;
}
async function confirmEdit(page) {
  await visible(page, '#auth-confirm');
  await until(async () => !(await page.locator('#auth-confirm').isDisabled()), 'claim status enables optional-code confirmation');
  await page.locator('#auth-confirm').click();
  await visible(page, '#claim-content');
}
async function ownResult(page, timeout = 5000) {
  const frame = await resultFrame(page, timeout);
  await until(async () => (await frame.locator('#member-select').inputValue()) === PERSON, 'own member automatically selected', 5000);
  assert.equal(await frame.locator('#local-back').isVisible(), false, 'friend result never navigates into organizer app');
  return frame;
}
async function stored(page, room, id = SHARE_ID) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), revisions.storageKey(id, room.topic));
}
async function openEdit(page) {
  const frame = await resultFrame(page);
  await frame.locator('#member-select').selectOption({ label: PERSON });
  await visible(frame, '#edit-claims');
  await until(async () => !(await frame.locator('#edit-claims').isDisabled()), 'edit enabled for selected member');
  await frame.locator('#edit-claims').click();
  await confirmEdit(page);
  assert.equal(await page.locator('#person-name').inputValue(), PERSON);
  assert.equal(await page.locator('#person-name').evaluate(node => node.readOnly), true, 'revision name is locked');
  return frame;
}
async function waiting(page, revision = true) {
  await visible(page, '#revision-waiting');
  assert.equal(await page.locator('#revision-waiting-title').innerText(), revision ? '認帳已修改，等候重新結算' : '認帳已提交，等候結算');
  await hidden(page, 'iframe.same-link-result', 'old ready result must stay hidden while pending');
  await hidden(page, '#claim-content');
  await hidden(page, '#submit-dock');
}
async function mockContext(browser, options = {}) {
  const room = options.room || relay.createRoom();
  const state = {
    id: options.id || SHARE_ID, room, mode: options.mode || 'ready', data: published(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(), postStatus: 200,
    gets: [], statusGets: [], posts: [], relayPosts: [], claimStatuses: new Map(), revision: 0, errors: [], violations: []
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(10000);
  // Observe messages and every visible result while a stored submission is pending.
  await context.addInitScript(() => {
    window.__revisionMessages = [];
    window.__pendingResultFlashes = [];
    window.addEventListener('message', event => window.__revisionMessages.push({ type: event.data?.type, sessionId: event.data?.sessionId, name: event.data?.name, origin: event.origin, sourceIsSelf: event.source === window }));
    const observer = new MutationObserver(() => {
      for (const frame of document.querySelectorAll('iframe.same-link-result')) {
        let pending = false;
        try {
          const id = new URLSearchParams(location.search).get('session');
          pending = Boolean(JSON.parse(localStorage.getItem('billSplitterFriendClaimV1:' + id) || 'null')?.pending);
        } catch (_) {}
        if (pending && !frame.hidden && frame.getBoundingClientRect().height > 0) window.__pendingResultFlashes.push(frame.src);
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  });
  // One deny-by-default router. Never permit remote Worker/ntfy requests to fall through.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (SHARE_RE.test(url.pathname)) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const rootPath = `/api/shares/${state.id}`;
      const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === `${rootPath}/claims/status` && request.method() === 'GET') {
        const name = url.searchParams.get('name') || '';
        state.statusGets.push({ name, url: url.href });
        const submitted = state.claimStatuses.get(name);
        const publishedMember = state.mode === 'ready' && state.data.participants.some(person => person.name === name);
        const credentialKind = submitted ? 'none' : publishedMember ? 'reserved' : 'new';
        return json(200, {
          enabled: true, credentialKind,
          registered: credentialKind === 'none', requiresApproval: false,
          claimSecurity: 'password', expiresAt: state.expiresAt, serverNow: new Date().toISOString()
        });
      }
      if (url.pathname === `${rootPath}/claims/unlock` && request.method() === 'POST') {
        const input = request.postDataJSON() || {};
        const payload = state.claimStatuses.get(input.name) || initialSubmission(1, 2 / 3);
        return json(200, {
          editToken: 'T'.repeat(43), tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          payload: clone(payload), expiresAt: state.expiresAt, serverNow: new Date().toISOString()
        });
      }
      if (url.pathname === `${rootPath}/claims/submit` && request.method() === 'POST') {
        const input = request.postDataJSON() || {};
        const payload = {
          v: 1, name: input.name, claims: Array.isArray(input.claims) ? input.claims : [],
          ...(input.clear ? { clear: true } : {})
        };
        state.posts.push({ path: url.pathname, payload: clone(payload), status: state.postStatus });
        if (state.postStatus !== 200) return json(state.postStatus, { error: 'Too many attempts', code: 'rate_limit', retryAfter: 60 });
        state.claimStatuses.set(payload.name, clone(payload));
        state.revision += 1;
        return json(200, { payload, revision: state.revision, expiresAt: state.expiresAt, serverNow: new Date().toISOString() });
      }
      if (url.pathname !== rootPath || request.method() !== 'GET') {
        state.violations.push(`Unexpected share request: ${request.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      state.gets.push({ url: url.href, mode: state.mode, qty: state.data.items[0].shares.find(share => share.person === PERSON)?.quantity });
      const status = state.mode === 'pending' ? 202 : state.mode === 'expired' ? 410 : 200;
      const body = { status: state.mode, data: state.mode === 'ready' ? clone(state.data) : undefined, code: state.mode === 'expired' ? 'expired' : undefined, expiresAt: state.expiresAt, serverNow: new Date().toISOString() };
      return json(status, body);
    }
    if (url.hostname === 'ntfy.sh') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (request.method() !== 'POST' || url.pathname !== '/' + room.topic) {
        state.violations.push(`Unexpected relay request blocked: ${request.method()} ${url}`);
        return route.abort('blockedbyclient');
      }
      const ciphertext = request.postData() || '';
      const payload = await relay.decryptPayload(room.key, ciphertext);
      state.relayPosts.push({ ciphertext, payload, status: state.postStatus });
      if (!ciphertext.startsWith('bs1.') || !payload) state.violations.push('Relay body was not authentic decryptable AES-GCM ciphertext.');
      return route.fulfill({ status: state.postStatus, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'mock-notification', event: 'message' }) });
    }
    if (url.origin !== base.origin || !['GET', 'HEAD'].includes(request.method())) {
      state.violations.push(`Unexpected external/write request blocked: ${request.method()} ${url}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  state.context = context;
  state.page = page;
  state.url = claimUrl(room, state.id);
  return state;
}
function initialSubmission(qty = 1, shared = 2 / 3) {
  return { v: 1, name: PERSON, claims: [{ id: '01', qty, unit: '杯', displayUnit: '' }, ...(shared ? [{ id: '02', qty: shared, unit: '', displayUnit: '' }] : [])] };
}
async function seed(page, state, saved) {
  await page.goto(new URL('claim-revisions.js', base).href, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: revisions.storageKey(state.id, state.room.topic), saved });
}
async function blockedEdit(page) {
  await visible(page, '#expired-panel');
  await hidden(page, '#claim-content');
  await hidden(page, '#submit-dock');
  await hidden(page, '#revision-actions');
  await hidden(page, '#revision-waiting');
  await hidden(page, 'iframe.same-link-result');
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const failures = [];
  let passed = 0;
  async function run(name, fn, options) {
    let state;
    try {
      state = await mockContext(browser, options);
      await fn(state);
      assert.deepEqual(state.violations, [], 'no live endpoint or unexpected network traffic');
      assert.deepEqual(state.errors, [], 'no browser page errors');
      passed++;
      console.log(`PASS ${name} [Worker GET=${state.gets.length}; mocked Worker submits=${state.posts.length}]`);
    } catch (error) {
      failures.push({ name, error: error.stack || String(error) });
      console.error(`FAIL ${name}\n${error.stack || error}`);
      if (state?.page) {
        console.error('STATE', JSON.stringify({ url: state.page.url(), stored: await stored(state.page, state.room, state.id).catch(() => null), gets: state.gets, posts: state.posts.map(post => ({ payload: post.payload, status: post.status })), errors: state.errors, violations: state.violations }));
        await screenshot(state.page, 'failure-' + name.replace(/[^a-z0-9]+/gi, '-')).catch(() => {});
      }
    } finally { await state?.context.close(); }
  }
  try {
    await run('fresh published result: message authentication, locked seed, stale wait, reload/draft and semantic recalc', async state => {
      const { page, room } = state;
      await page.goto(state.url, { waitUntil: 'domcontentloaded' });
      let frame = await resultFrame(page);
      await until(async () => await frame.locator('#edit-claims').isVisible(), 'embedded edit control receives parent context');
      assert.equal(await frame.locator('#edit-claims').isDisabled(), true, 'choose member before editing');
      assert.equal(await stored(page, room), null, 'fresh browser has no locally saved claim');
      await frame.locator('#member-select').selectOption({ label: PERSON });
      await until(async () => !(await frame.locator('#edit-claims').isDisabled()), 'selected member enables edit');

      // Exercise all three parent validation checks separately with the real iframe source.
      await page.evaluate(({ id, name }) => {
        const child = document.querySelector('iframe.same-link-result').contentWindow;
        const data = { type: 'bill-claim-edit', sessionId: id, name };
        for (const [origin, source, sessionId] of [
          ['https://wrong-origin.invalid', child, id],
          [location.origin, child, 'X'.repeat(22)],
          [location.origin, window, id]
        ]) window.dispatchEvent(new MessageEvent('message', { origin, source, data: { ...data, sessionId } }));
      }, { id: state.id, name: PERSON });
      await hidden(page, '#claim-content', 'spoofed edit messages do not open the form');
      assert.equal(await page.locator('iframe.same-link-result').isVisible(), true);
      assert.equal(await stored(page, room), null, 'rejected messages cannot create drafts');

      // Child also rejects wrong origin, session and source context messages.
      await frame.evaluate(({ id, other }) => {
        const data = { type: 'bill-claim-result-context', sessionId: id, canEdit: false, person: other, language: 'en' };
        for (const [origin, source, sessionId] of [
          ['https://wrong-origin.invalid', window.parent, id],
          [location.origin, window.parent, 'X'.repeat(22)],
          [location.origin, window, id]
        ]) window.dispatchEvent(new MessageEvent('message', { origin, source, data: { ...data, sessionId } }));
      }, { id: state.id, other: OTHER });
      assert.equal(await frame.locator('#member-select').inputValue(), PERSON);
      assert.equal(await frame.locator('#edit-claims').isDisabled(), false);

      await frame.locator('#edit-claims').click();
      await confirmEdit(page);
      assert.equal(await page.locator('#person-name').inputValue(), PERSON);
      assert.equal(await page.locator('#person-name').evaluate(node => node.readOnly), true);
      assert.equal(await page.locator('#qty-0').inputValue(), '1');
      assert.ok(Math.abs(Number(await page.locator('#qty-1').inputValue()) - 2 / 3) < 1e-12, 'published 2/3 quantity remains exact before user edits');
      assert.equal(await page.locator('#unit-0').inputValue(), 'cup', 'actual cup semantics preserved from publication');
      assert.equal(await page.locator('#unit-1').inputValue(), '', 'decorative result unit is not made actual');
      assert.equal(await page.locator('#submit-button').isDisabled(), true, 'unchanged resubmit is disabled');
      let saved = await stored(page, room);
      assert.equal(saved.schema, 1);
      assert.equal(saved.editing, true);
      assert.equal(saved.lockedName, PERSON);
      assert.equal(saved.submitted.name, PERSON);
      assert.equal(saved.pending, null);
      assert.equal(saved.fields.values[0].unit, 'cup');
      assert.equal(await page.evaluate(id => window.__revisionMessages.some(msg => msg.type === 'bill-claim-edit' && msg.sessionId === id && msg.name === '測試朋友' && msg.origin === location.origin && !msg.sourceIsSelf), state.id), true, 'real child edit postMessage contract observed');

      await page.locator('#qty-0').fill('3');
      await page.locator('#qty-1').fill('0');
      assert.equal(await page.locator('#submit-button').isDisabled(), false);
      const beforePostGets = state.gets.length;
      await page.locator('#submit-button').click();
      await waiting(page);
      await until(() => state.gets.length > beforePostGets, 'latest GET still returns old ready result');
      assert.equal(state.posts.length, 1);
      assert.deepEqual(state.posts[0].payload, { v: 1, name: PERSON, claims: [{ id: '01', qty: 3, unit: '杯', displayUnit: '' }] });
      assert.equal(state.posts[0].path, `/api/shares/${state.id}/claims/submit`);
      assert.equal(state.relayPosts.length, 0, 'claims are submitted only to the mocked HTTPS Worker, not an external relay');
      saved = await stored(page, room);
      assert.equal(saved.fields.values[0].quantity, '3');
      assert.equal(saved.fields.values[1].quantity, '0');
      assert.equal(saved.pending.revision, true);
      assert.deepEqual(saved.pending.payload, saved.submitted);
      await waiting(page);
      assert.equal(page.url(), state.url);
      await screenshot(page, 'waiting');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waiting(page);
      assert.equal((await stored(page, room)).pending.payload.claims[0].qty, 3);
      assert.deepEqual(await page.evaluate(() => window.__pendingResultFlashes), [], 'reload never briefly exposes stale iframe');
      await page.locator('#edit-claim-again').click();
      await confirmEdit(page);
      assert.equal(await page.locator('#qty-0').inputValue(), '3');
      assert.equal(Number(await page.locator('#qty-1').inputValue() || 0), 0, 'blank quantity represents zero after reload');
      assert.equal(await page.locator('#unit-0').inputValue(), 'cup');
      assert.equal(await page.locator('#submit-button').isDisabled(), true);
      await page.locator('#qty-0').fill('4.25');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await confirmEdit(page);
      assert.equal(await page.locator('#qty-0').inputValue(), '4.25', 'unsent edit survives reload');
      assert.equal((await stored(page, room)).pending.payload.claims[0].qty, 3, 'unsent edits do not change submitted payload');
      const beforePoll = state.gets.length;
      await until(() => state.gets.length > beforePoll, 'real six-second poll while editing', 8000);
      assert.equal(await page.locator('#qty-0').inputValue(), '4.25', 'polling never overwrites unsent draft');
      await screenshot(page, 'unsent-draft');

      // Return draft to last submitted values, then wait without re-publishing.
      await page.locator('#qty-0').fill('3');
      await page.locator('#cancel-claim-edit').click();
      await waiting(page);
      state.data = published(3, 0, false, '杯');
      const wrongUnitPoll = state.gets.length;
      await until(() => state.gets.length > wrongUnitPoll, 'same quantity but wrong actual-unit semantics poll', 8000);
      await waiting(page);
      assert.ok((await stored(page, room)).pending, 'same quantities with decorative cups are not accepted');
      state.data = published(3, 0, true, '杯');
      frame = await ownResult(page, 8000);
      assert.match(await frame.locator('#grand-total').innerText(), /180/);
      assert.equal((await stored(page, room)).pending, null, 'matching quantity and actual unit clears pending');
      assert.equal(state.posts.length, 1);
      assert.equal(page.url(), state.url, 'external claim URL unchanged throughout revision');
      await screenshot(page, 'recalculated-own-result');
    });

    await run('429 submit failure preserves form and retry without false waiting', async state => {
      const { page, room } = state;
      await page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await openEdit(page);
      await page.locator('#qty-0').fill('2.5');
      await page.locator('#qty-1').fill('0');
      state.postStatus = 429;
      await page.locator('#submit-button').click();
      await until(async () => /試得太多/.test(await page.locator('#submit-status').innerText()), 'rate-limit feedback');
      await visible(page, '#claim-content');
      await hidden(page, '#revision-waiting', 'failed POST is not pending');
      assert.equal(await page.locator('#qty-0').inputValue(), '2.5');
      assert.equal(await page.locator('#qty-1').inputValue(), '0');
      assert.equal(await page.locator('#submit-button').isDisabled(), false, 'retry stays enabled');
      let saved = await stored(page, room);
      assert.equal(saved.pending, null);
      assert.equal(saved.submitted.claims[0].qty, 1, 'failed submission does not overwrite published baseline');
      assert.equal(saved.fields.values[0].quantity, '2.5');
      await screenshot(page, '429-retry');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await confirmEdit(page);
      assert.equal(await page.locator('#qty-0').inputValue(), '2.5');
      state.postStatus = 200;
      await page.locator('#submit-button').click();
      await waiting(page);
      assert.equal(state.posts.length, 2);
      assert.deepEqual(state.posts[0].payload, state.posts[1].payload, 'retry sends same preserved values');
      saved = await stored(page, room);
      assert.equal(saved.pending.payload.claims[0].qty, 2.5);
    });

    await run('all-zero revision sends clear:true and waits for absent-person zero result', async state => {
      const { page, room } = state;
      await page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await openEdit(page);
      await page.locator('#qty-0').fill('0');
      await page.locator('#qty-1').fill('0');
      assert.equal(await page.locator('#submit-button').isDisabled(), false, 'all-zero is valid when clearing an existing claim');
      await page.locator('#submit-button').click();
      await waiting(page);
      assert.deepEqual(state.posts[0].payload, { v: 1, name: PERSON, claims: [], clear: true });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waiting(page);
      state.data = published(0, 1 / 3);
      const before = state.gets.length;
      await until(() => state.gets.length > before, 'clear still waits with one positive person share', 8000);
      await waiting(page);
      state.data = clearedResult();
      const frame = await ownResult(page, 8000);
      assert.match(await frame.locator('#grand-total').innerText(), /0\.00|\b0\b/);
      assert.equal((await stored(page, room)).pending, null);
      assert.equal((await stored(page, room)).submitted.clear, true);
      assert.equal(await frame.locator('#edit-claims').isDisabled(), false, 'synthetic zero member can edit again');
      assert.equal(page.url(), state.url);
      await screenshot(page, 'cleared-zero-result');
      await frame.locator('#edit-claims').click();
      await confirmEdit(page);
      assert.equal(await page.locator('#person-name').inputValue(), PERSON);
      assert.equal(Number(await page.locator('#qty-0').inputValue() || 0), 0, 'blank quantity represents zero after clearing');
      assert.equal(Number(await page.locator('#qty-1').inputValue() || 0), 0, 'blank quantity represents zero after clearing');
      assert.equal(await page.locator('#submit-button').isDisabled(), true, 'unchanged all-zero clear cannot resend');
    });

    await run('expired room metadata blocks form and dock without session lookup', async state => {
      const now = Date.now();
      state.url = claimUrl(state.room, '', { createdAt: now - 120000, expiresAt: now - 60000 });
      await state.page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await blockedEdit(state.page);
      assert.equal(state.gets.length, 0);
      assert.equal(state.posts.length, 0);
    });

    await run('Worker expiresAt overrides future metadata and closes restored revision editor', async state => {
      const submitted = initialSubmission();
      await seed(state.page, state, { schema: 1, fields: { name: PERSON, values: [{ id: '01', quantity: '4.25', unit: 'cup' }, { id: '02', quantity: '0', unit: '' }] }, submitted, pending: { payload: submitted, revision: true }, editing: true, lockedName: PERSON });
      state.expiresAt = new Date(Date.now() - 60000).toISOString();
      await state.page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await blockedEdit(state.page);
      assert.equal(state.posts.length, 0);
      await screenshot(state.page, 'worker-expired');
    });

    await run('expired Worker 410 with expiresAt blocks waiting-to-edit entry point', async state => {
      const submitted = initialSubmission();
      await seed(state.page, state, { schema: 1, fields: { name: PERSON, values: [{ id: '01', quantity: '1', unit: 'cup' }, { id: '02', quantity: '0.667', unit: '' }] }, submitted, pending: { payload: submitted, revision: true }, editing: false, lockedName: PERSON });
      state.mode = 'expired';
      state.expiresAt = new Date(Date.now() - 60000).toISOString();
      await state.page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await blockedEdit(state.page);
      assert.equal(state.posts.length, 0);
    });

    await run('first submit pending persists; editing works before any result; draft does not auto-publish', async state => {
      const { page, room } = state;
      state.mode = 'pending';
      await page.goto(state.url, { waitUntil: 'domcontentloaded' });
      await visible(page, '#claim-content');
      await page.locator('#person-name').fill(PERSON);
      await page.locator('#qty-0').fill('2');
      await page.locator('#unit-0').selectOption('cup');
      await page.locator('#qty-1').fill('0.5');
      await page.locator('#unit-1').selectOption('piece');
      await page.locator('#submit-button').click();
      await waiting(page, false);
      assert.deepEqual(state.posts[0].payload, { v: 1, name: PERSON, claims: [{ id: '01', qty: 2, unit: '杯', displayUnit: '' }, { id: '02', qty: 0.5, unit: '', displayUnit: '件' }] });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waiting(page, false);
      await page.locator('#edit-claim-again').click();
      await confirmEdit(page);
      assert.equal(await page.locator('#person-name').evaluate(node => node.readOnly), true);
      assert.equal(await page.locator('#qty-0').inputValue(), '2');
      assert.equal(await page.locator('#qty-1').inputValue(), '0.5');
      assert.equal(await page.locator('#unit-1').inputValue(), 'piece');
      assert.equal(await page.locator('#submit-button').isDisabled(), true);
      await page.locator('#qty-0').fill('2.75');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await confirmEdit(page);
      assert.equal(await page.locator('#qty-0').inputValue(), '2.75');
      state.mode = 'ready';
      state.data = published(2, 0.5);
      const before = state.gets.length;
      await until(() => state.gets.length > before, 'initial submitted payload matches while unsent draft is open', 8000);
      await visible(page, '#claim-content');
      assert.equal(await page.locator('#qty-0').inputValue(), '2.75', 'accepted old submission does not interrupt current draft');
      assert.equal((await stored(page, room)).pending, null);
      assert.equal(state.posts.length, 1, 'no automatic publish of unsent edit');
      await page.locator('#cancel-claim-edit').click();
      await ownResult(page);
      assert.equal(page.url(), state.url);
    });

    await run('standalone detail result cannot expose embedded revision controls', async state => {
      const url = new URL('detailed-view.html', base);
      url.searchParams.set('share', state.id);
      await state.page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await visible(state.page, '#preview-content');
      await state.page.locator('#member-select').selectOption({ label: PERSON });
      await hidden(state.page, '#edit-claims');
      assert.equal(state.posts.length, 0);
    });
  } finally { await browser.close(); }
  console.log(`\nFriend revisions: ${passed} passed, ${failures.length} failed. All relay/Worker traffic mocked.`);
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
