'use strict';
/*
 * Run only after the application/backend jobs finish. This test creates synthetic
 * data in a fresh in-memory Worker/DO and new, non-persistent browser contexts.
 * It never deploys or writes to Cloudflare/ntfy. Static server is supplied by you:
 *   python3 -m http.server 4192 --bind 127.0.0.1 --directory /tmp/bill-splitter-ai
 *   node /tmp/bill-splitter-ai/tests/friend-password.cjs
 * Optional: --friends-only (backend-created fixture; no host UI), --backend-only.
 * Focused reruns: --host-only, --legacy-only, --precision-only (real host flow
 * with full-width NAME plus collapsed spaces and exact 1.234 -> 1.2345 revision).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { chromium } = require('/tmp/ui-qa/node_modules/playwright');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const relay = require('../claim-relay.js');
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4192/';
const base = new URL(BASE_URL);
const publicStaticQA = process.env.PUBLIC_STATIC_QA === '1' && base.origin === 'https://cw91020251212.github.io' && base.pathname.startsWith('/bill-splitter-ai/');
assert((['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:') || publicStaticQA, 'BASE_URL must be local, or explicitly authorized read-only project static QA. All bill APIs remain intercepted.');
const site = new URL(base.pathname.endsWith('.html') ? './' : (base.pathname.endsWith('/') ? base.href : `${base.href}/`), base);
const SCREENSHOTS = '/home/ubuntu/bill-R104-qa';
const PASSWORD_A = 'Synthetic-A-2026!';
const PASSWORD_B = 'Synthetic-B-2026!';
const PASSWORD_RESET = 'Synthetic-reset-2026!';
const WRONG = 'Synthetic-wrong-2026!';
const PRECISION = process.argv.includes('--precision-only');
const HOST_ONLY = process.argv.includes('--host-only') || PRECISION;
const NAME_A = PRECISION ? 'Ａlex Chan' : 'QA朋友甲';
const NAME_B = 'QA朋友乙';
const secrets = new Set([PASSWORD_A, PASSWORD_B, PASSWORD_RESET, WRONG]);
const ownerSecrets = new Set();
const steps = [];
const runtimeSources = new Map();
const errors = [];
const blocked = [];
let harness, browser, stage = 'initial contract check';
const pages = [];
let workerOrigin;
function pass(testName) { steps.push(testName); console.log(`PASS ${testName}`); }
function remember(result) {
  if (result && typeof result === 'object') for (const key of ['editToken', 'setupCode', 'writeToken']) {
    if (typeof result[key] === 'string' && result[key]) { secrets.add(result[key]); if (key === 'writeToken') ownerSecrets.add(result[key]); }
  }
  return result;
}
function scrub(value) {
  let text = String(value);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text;
}
function noSecrets(value, { allowOwner = false } = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) if (!(allowOwner && ownerSecrets.has(secret))) assert(!text.includes(secret), 'A password, authorization token, or owner code escaped its permitted request-local boundary');
  assert(!/"(?:password|pepper|salt|hash|tickets|generation|writeKeyHash|editToken|setupCode)"\s*:/i.test(text), 'Private authentication fields must not be persisted or included in public claims');
}
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out: ${message}`);
}
function claims(name, qty = 1, extra = {}) { return { name, claims: [{ id: '01', qty, unit: '', displayUnit: '' }], ...extra }; }
const endpoint = (id, suffix = '') => `/api/shares/${id}${suffix}`;
async function call(id, suffix = '', options = {}) {
  const result = await harness.call(endpoint(id, suffix), options);
  remember(result.body);
  return result;
}
async function post(id, operation, body, options = {}) { return call(id, `/claims/${operation}`, { method: 'POST', body, ...options }); }
function expectStatus(result, expected, label) { assert.equal(result.status, expected, `${label}: unexpected real backend status`); return result.body; }
async function newSession() {
  const result = await harness.call('/api/shares/sessions', { method: 'POST', body: { ttlDays: 1 } });
  const created = remember(expectStatus(result, 201, 'create protected session'));
  assert.equal(created.claimSecurity, 'password');
  assert.match(created.id, /^[A-Za-z0-9_-]{22}$/);
  assert.match(created.writeToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(created.expiresAt) - Date.parse(created.createdAt), 86400000);
  return created;
}
function dataFor(entries) {
  const totalQty = entries.reduce((sum, entry) => sum + entry.claims[0].qty, 0);
  return {
    version: 2, language: 'zh-HK',
    bill: { date: '2026-11-07', payer: NAME_A, currency: 'HKD', sourceCurrency: 'HKD', billTotal: 100, sourceTotal: 100, sourceBillTotal: 100, itemsSubtotal: 100, exchangeRate: 1 },
    participants: entries.map(entry => ({ name: entry.name, total: 100 * entry.claims[0].qty / totalQty, subtotal: 100 * entry.claims[0].qty / totalQty })),
    items: [{ id: '01', number: '01', name: 'QA茶', quantity: 0, unit: '', sourceAmount: 100, allocatedAmount: 100,
      shares: entries.map(entry => ({ person: entry.name, quantity: entry.claims[0].qty, unit: '份', isActualUnit: false, amount: 100 * entry.claims[0].qty / totalQty })) }],
    adjustments: [], images: []
  };
}
function linkFor(created) {
  const link = new URL('claim.html', site);
  link.searchParams.set('session', created.id);
  link.hash = relay.buildHash(Buffer.from(JSON.stringify([{ id: '01', name: 'QA茶', totalQty: null, unit: '' }])).toString('base64url'), relay.createRoom(),
    { title: 'QA密碼驗收', createdAt: Date.parse(created.createdAt), expiresAt: Date.parse(created.expiresAt) });
  noSecrets(link.href);
  return link.href;
}
async function publish(created, entries) {
  expectStatus(await call(created.id, '', { method: 'PUT', owner: created.writeToken, body: dataFor(entries) }), 200, 'publish correct current quantities');
}
async function backendBoundaries() {
  stage = 'real backend identity and legacy boundaries';
  const created = await newSession();
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 1, { password: 'short' })), 400, 'minimum password length');
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 1, { password: PASSWORD_A })), 200, 'first enrollment A');
  expectStatus(await post(created.id, 'submit', claims(NAME_B, 2, { password: PASSWORD_B })), 200, 'first enrollment B');
  const bad = await post(created.id, 'unlock', { name: NAME_B, password: PASSWORD_A });
  expectStatus(bad, 403, 'cross-name password'); assert.equal(bad.body.payload, undefined); noSecrets(bad.body);
  const unlocked = expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_A }), 200, 'own verified payload');
  assert.equal(unlocked.payload.name, NAME_A); assert.equal(unlocked.payload.claims[0].qty, 1); noSecrets(unlocked.payload);
  expectStatus(await post(created.id, 'submit', claims(NAME_B, 99, { editToken: unlocked.editToken })), 403, 'ticket cannot rename into another registered identity');
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 99, { editToken: 'x'.repeat(43) })), 403, 'invalid edit ticket');
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 3, { editToken: unlocked.editToken })), 200, 'own ticket accepts revision');
  expectStatus(await call(created.id, '/claims/inbox?after=0'), 403, 'inbox owner-only');
  const inbox = expectStatus(await call(created.id, '/claims/inbox?after=0', { owner: created.writeToken }), 200, 'owner reads verified revisions');
  assert.equal(inbox.updates.find(entry => entry.name === NAME_B).claims[0].qty, 2);
  assert.equal(inbox.updates.find(entry => entry.name === NAME_A).claims[0].qty, 3);
  noSecrets(inbox);
  expectStatus(await call(created.id, '', { method: 'PUT', owner: created.writeToken, body: dataFor([claims(NAME_A, 1), claims(NAME_B, 2)]) }), 409, 'stale owner allocations rejected');
  await publish(created, [claims(NAME_A, 3), claims(NAME_B, 2)]);
  noSecrets(expectStatus(await call(created.id), 200, 'public result unchanged and secret-free'));
  harness.nowFor(created.id, Date.now() + 16 * 60 * 1000);
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 4, { editToken: unlocked.editToken }), { ip: '203.0.113.102' }), 403, 'expired edit ticket');
  harness.clearClock(created.id);
  const resetCode = expectStatus(await post(created.id, 'approve', { name: NAME_A }, { owner: created.writeToken }), 200, 'owner issues reset authority');
  assert(Date.parse(resetCode.expiresAt) - Date.parse(resetCode.serverNow) <= 600000);
  expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_A }), 200, 'issuing a code does not reset credentials');
  expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_RESET, setupCode: resetCode.setupCode }), 200, 'reset code redemption');
  expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_B, setupCode: resetCode.setupCode }, { ip: '203.0.113.104' }), 409, 'reset code is single use');
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 4, { editToken: unlocked.editToken }), { ip: '203.0.113.105' }), 403, 'reset invalidates prior generation ticket');
  expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_A }, { ip: '203.0.113.106' }), 403, 'old password rejected after reset');
  expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_RESET }), 200, 'replacement password works');
  const expiring = expectStatus(await post(created.id, 'approve', { name: NAME_B }, { owner: created.writeToken }), 200, 'short-lived code');
  harness.nowFor(created.id, Date.now() + 11 * 60 * 1000);
  expectStatus(await post(created.id, 'unlock', { name: NAME_B, password: PASSWORD_RESET, setupCode: expiring.setupCode }, { ip: '203.0.113.103' }), 409, 'expired ten-minute owner code');
  harness.nowFor(created.id, Date.parse(created.expiresAt) + 1);
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 5, { password: PASSWORD_RESET })), 410, 'expired session blocks mutation');
  assert.equal(harness.record(created.id), null);
  assert.equal(harness.objects.get(created.id).ctx.data.size, 0, 'DO state purged on expiry');
  pass('real-backend enrollment, identity-bound tickets, reset/replay, current-allocation validation and expiry');
}
async function createLegacy() {
  const created = await newSession();
  // Only the harness's fresh memory is changed to model an old pre-migration KV
  // record; no application code or remote user data is touched.
  const record = harness.record(created.id);
  delete record.claimSecurity;
  record.status = 'ready'; record.data = dataFor([claims(NAME_A, 2), claims(NAME_B, 1)]);
  harness.values.set(`share:${created.id}`, { value: JSON.stringify(record), options: {} });
  harness.objects.delete(created.id);
  for (const name of [NAME_A, 'QA舊連結陌生人']) {
    const status = expectStatus(await call(created.id, `/claims/status?name=${encodeURIComponent(name)}`), 200, 'legacy status');
    assert.equal(status.requiresApproval, true); assert.equal(status.registered, false);
  }
  expectStatus(await post(created.id, 'setup', { members: [] }), 403, 'legacy setup must be owner');
  expectStatus(await post(created.id, 'setup', { members: [] }, { owner: created.writeToken }), 200, 'owner seeds baseline allocations');
  for (const name of [NAME_A, 'QA舊連結陌生人']) {
    const denied = await post(created.id, 'submit', claims(name, 99, { password: PASSWORD_A }));
    expectStatus(denied, 409, 'legacy identity cannot self-enroll'); assert.equal(denied.body.payload, undefined); noSecrets(denied.body);
  }
  const inbox = expectStatus(await call(created.id, '/claims/inbox?after=0', { owner: created.writeToken }), 200, 'legacy seeded member summaries');
  assert.equal(inbox.members.length, 2); assert(inbox.members.every(member => member.requiresApproval && !member.registered));
  noSecrets(inbox);
  pass('legacy baseline and unknown identities cannot be hijacked without explicit owner approval');
  return created;
}
async function preloadRuntimes() {
  const urls = ['https://cdn.tailwindcss.com', 'https://unpkg.com/react@18/umd/react.production.min.js',
    'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'https://unpkg.com/@babel/standalone/babel.min.js'];
  await Promise.all(urls.map(async url => {
    const { stdout } = await execFile('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '40', url], { maxBuffer: 20 * 1024 * 1024 });
    assert(stdout.length > 1000, 'Actual read-only CDN runtime must be available'); runtimeSources.set(url, stdout);
  }));
}
async function newPage(label, { mobile = true, host = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 900 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
  await context.addInitScript(() => localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1'));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === '/api/shares' || url.pathname.startsWith('/api/shares/')) {
      if (![workerOrigin, base.origin].includes(url.origin)) { blocked.push('unexpected-api-origin'); return route.abort('blockedbyclient'); }
      const incoming = await request.allHeaders();
      const headers = { ...incoming, 'x-qa-original-url': request.url(), 'cf-connecting-ip': host ? '203.0.113.201' : `203.0.113.${210 + pages.length}` };
      delete headers.host; delete headers['content-length']; delete headers.connection;
      // Do not replace a supplied Origin: real production/local allowlist checks
      // run unchanged in handleRequest. Chrome may omit Origin on simple GETs.
      if (!headers.origin) headers.origin = base.origin;
      const response = await fetch(`${harness.apiBase}${url.pathname}${url.search}`, { method, headers,
        ...(!['GET', 'HEAD'].includes(method) && request.postData() !== null ? { body: request.postDataBuffer() } : {}) });
      const body = await response.text();
      try { remember(JSON.parse(body)); } catch (_) {}
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length']; delete responseHeaders['transfer-encoding']; delete responseHeaders.connection;
      return route.fulfill({ status: response.status, headers: responseHeaders, body });
    }
    if (url.hostname.endsWith('.workers.dev') || url.hostname === 'ntfy.sh') { blocked.push('external-worker-or-ntfy'); return route.abort('blockedbyclient'); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { blocked.push('unmatched-mutation'); return route.abort('blockedbyclient'); }
    const source = runtimeSources.get(request.url());
    if (method === 'GET' && source) return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, body: source });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
  pages.push({ page, label, host });
  return page;
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: true }); }
async function storedNoSecrets(page, { host = false } = {}) {
  const snapshot = await page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)), url: location.href,
    replies: Array.from(document.querySelectorAll('#reply-preview,[data-testid="claim-replies"]'), node => node.value) }));
  noSecrets(snapshot.url); noSecrets(snapshot.replies); noSecrets(snapshot.local, { allowOwner: host }); noSecrets(snapshot.session, { allowOwner: host });
}
async function resultFor(page, name) {
  await page.locator('iframe.same-link-result:not([hidden])').waitFor({ state: 'visible' });
  const frame = page.frameLocator('iframe.same-link-result');
  await frame.locator('#member-select').waitFor({ state: 'visible' });
  await frame.locator('#member-select').selectOption({ label: name });
  return frame;
}
async function openGate(page, name) {
  const frame = await resultFor(page, name);
  await frame.locator('#edit-claims').click();
  await page.locator('#claim-auth-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#claim-content').isVisible(), false, 'Edit button must not open old claim fields before verification');
  assert.equal(await page.locator('#auth-name').inputValue(), name);
  assert.equal(await page.locator('#auth-name').evaluate(node => node.readOnly), true);
  await until(() => page.locator('#auth-confirm').isEnabled(), 'real authentication status enables confirmation');
}
async function login(page, password, code) {
  await page.locator('#auth-password').fill(password);
  if (code) await page.locator('#auth-setup-code').fill(code);
  await page.locator('#auth-confirm').click();
}
async function failedLogin(page, password, code) {
  const count = harness.requests.length;
  await login(page, password, code);
  await until(() => harness.requests.slice(count).some(entry => entry.path.endsWith('/claims/unlock') && entry.status >= 400), 'backend rejects unverified login');
  await until(async () => Boolean(await page.locator('#claim-auth-status').innerText()), 'visible login rejection');
  assert.equal(await page.locator('#claim-auth-panel').isVisible(), true);
  assert.equal(await page.locator('#claim-content').isVisible(), false);
  assert.equal(await page.locator('#qty-0').isVisible(), false, 'wrong password must not expose editable old quantities');
}
async function firstEnrollment(page, link, name, password, qty) {
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.locator('#claim-content').waitFor({ state: 'visible' });
  await page.locator('#person-name').fill(name);
  await page.locator('#qty-0').fill(String(qty));
  await page.locator('#claim-password').fill('short');
  await page.locator('#claim-password-repeat').fill('short');
  assert.equal(await page.locator('#submit-button').isEnabled(), false, 'short password cannot enroll through UI');
  await page.locator('#claim-password').fill(password);
  await page.locator('#claim-password-repeat').fill(WRONG);
  assert.equal(await page.locator('#submit-button').isEnabled(), false, 'mismatched confirmation cannot enroll');
  await page.locator('#claim-password-repeat').fill(password);
  await until(() => page.locator('#submit-button').isEnabled(), 'matching new password enables first submit');
  const count = harness.requests.length;
  await page.locator('#submit-button').click();
  await page.locator('#revision-waiting').waitFor({ state: 'visible' });
  await until(() => harness.requests.slice(count).some(entry => entry.path.endsWith('/claims/submit') && entry.status === 200), 'actual first enrollment accepted');
  const accepted = harness.requests.slice(count).find(entry => entry.path.endsWith('/claims/submit') && entry.status === 200);
  assert.equal(accepted.output.payload.name, name.normalize('NFC').trim().replace(/\s+/gu, ' '), 'enrollment uses exact canonical identity without folding full-width letters');
  assert.equal(page.url(), link); await storedNoSecrets(page);
}
async function hostCreate() {
  stage = 'actual host manual bill and protected link';
  const host = await newPage('host', { mobile: false, host: true });
  await host.goto(new URL('index.html', site).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await host.getByTestId('start-manual').click();
  const price = host.locator('[data-tutorial-target="item-fields"] input[type="number"]').first();
  const itemName = host.getByPlaceholder('輸入項目名稱...');
  // Explicit clicks avoid the initial React autofocus racing a fill on a
  // neighbouring field when several Chromium instances start together.
  await price.click(); await price.fill('100');
  await itemName.click(); await itemName.fill('QA茶');
  await until(async () => await price.inputValue() === '100' && await itemName.inputValue() === 'QA茶', 'manual name and price fields settled');
  assert.equal(await host.getByPlaceholder('未知可留空').inputValue(), '');
  await host.getByTestId('claim-activity-name').fill('QA密碼驗收');
  await host.getByTestId('claim-expiry-days').selectOption('1');
  const before = harness.requests.length;
  await host.getByTestId('copy-friend-claim-link').click();
  await host.waitForFunction(() => Boolean(document.querySelector('[data-testid="claim-link-actions"]')?.dataset.claimLink));
  const link = await host.getByTestId('claim-link-actions').evaluate(node => node.dataset.claimLink);
  const createdRequest = harness.requests.slice(before).find(entry => entry.path === '/api/shares/sessions' && entry.status === 201);
  assert(createdRequest, 'Actual host must create the real local protected session');
  const created = remember(createdRequest.output);
  assert.equal(createdRequest.input.ttlDays, 1); assert.equal(created.claimSecurity, 'password');
  assert.equal(new URL(link).searchParams.get('session'), created.id);
  const metadata = relay.readLinkMetadataFromHash(new URL(link).hash);
  assert.equal(metadata.title, 'QA密碼驗收'); assert.equal(metadata.expiresAt - metadata.createdAt, 86400000);
  const items = JSON.parse(Buffer.from(new URLSearchParams(new URL(link).hash.slice(1)).get('data'), 'base64url').toString());
  assert.deepEqual(items, [{ id: '01', name: 'QA茶', totalQty: null, unit: '' }]);
  noSecrets(link); await storedNoSecrets(host, { host: true });
  pass('actual-host bill, one-day protected session and original friend link');
  return { host, link, created };
}
async function hostPull(host, names) {
  // The Step 3 inbox can be temporarily unmounted while the app invalidates a result.
  const nav = host.locator('.step-nav').getByRole('button', { name: '分帳運算' });
  await host.bringToFront();
  await host.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(async () => {
    const refresh = host.getByTestId('claim-inbox-refresh');
    if (!await refresh.count()) { if (await nav.count()) await nav.click(); return false; }
    if (!await refresh.isEnabled()) return false;
    await refresh.click();
    return true;
  }, 'secure inbox refresh ready after automatic invalidation');
  await until(async () => {
    const replies = host.getByTestId('claim-replies');
    if (!await replies.count()) { if (await nav.count()) await nav.click(); return false; }
    const text = await replies.inputValue(); return names.every(name => text.includes(`姓名：${name}`));
  }, 'host verified inbox contains current identities');
  const text = await host.getByTestId('claim-replies').inputValue();
  for (const name of names) assert.equal(text.split(`姓名：${name}`).length - 1, 1, 'revisions must replace one member, not duplicate');
  noSecrets(text);
  return text;
}
async function hostCalculate(host, created, expectedQty) {
  const calcNav = host.locator('.step-nav').getByRole('button', { name: '分帳運算' });
  if (await calcNav.count()) await calcNav.click();
  const payer = host.getByPlaceholder('輸入姓名', { exact: true });
  if (await payer.inputValue() !== NAME_A) await payer.fill(NAME_A);
  const before = harness.requests.length;
  await host.getByTestId('calculate-split').click();
  await until(() => harness.requests.slice(before).some(entry => entry.id === created.id && entry.method === 'PUT' && entry.status === 200), 'real host recalculation PUT accepted');
  const entry = harness.requests.slice(before).find(entry => entry.id === created.id && entry.method === 'PUT' && entry.status === 200);
  assert.equal(entry.authorization, `Bearer ${created.writeToken}`);
  assert.equal(entry.input.items[0].shares.find(share => share.person === NAME_A).quantity, expectedQty);
  assert.equal(entry.input.items[0].shares.find(share => share.person === NAME_B).quantity, 1);
  noSecrets(entry.input);
  return entry;
}
async function friendsAndHost() {
  let fixture;
  const friendsOnly = process.argv.includes('--friends-only');
  const initialQty = PRECISION ? 1.234 : 1;
  const revisedQty = PRECISION ? 1.2345 : 3;
  if (!friendsOnly) fixture = await hostCreate();
  else { const created = await newSession(); fixture = { created, link: linkFor(created), host: null }; }
  const { created, link, host } = fixture;
  const friendA = await newPage('friend-A');
  const friendB = await newPage('friend-B');
  stage = 'first browser password enrollment';
  await firstEnrollment(friendA, link, PRECISION ? 'Ａlex  Chan' : NAME_A, PASSWORD_A, initialQty);
  await firstEnrollment(friendB, link, NAME_B, PASSWORD_B, 1);
  if (host) { await hostPull(host, [NAME_A, NAME_B]); await hostCalculate(host, created, initialQty); }
  else await publish(created, [claims(NAME_A, initialQty), claims(NAME_B, 1)]);
  await resultFor(friendA, NAME_A);
  pass('two-friends first enrollment with distinct passwords and no persisted secrets');
  stage = 'friend password gate, wrong login, identity switching';
  await openGate(friendA, NAME_A);
  await screenshot(friendA, 'password-gate');
  if (!HOST_ONLY) {
    await failedLogin(friendA, WRONG);
    await screenshot(friendA, 'wrong-password-locked');
    await storedNoSecrets(friendA);
    await friendA.locator('#auth-cancel').click();
    await openGate(friendA, NAME_B);
    await failedLogin(friendA, PASSWORD_A);
    await friendA.locator('#auth-cancel').click();
    await openGate(friendA, NAME_A);
  }
  await login(friendA, PASSWORD_A);
  await friendA.locator('#claim-content').waitFor({ state: 'visible' });
  assert.equal(await friendA.locator('#person-name').inputValue(), NAME_A);
  assert.equal(await friendA.locator('#person-name').evaluate(node => node.readOnly), true);
  assert.equal(await friendA.locator('#qty-0').inputValue(), String(initialQty));
  assert.equal(await friendA.locator('#unit-0').isVisible(), true);
  await friendA.locator('#qty-0').fill(String(revisedQty));
  await storedNoSecrets(friendA);
  if (!HOST_ONLY) {
    stage = 'reload unsent editing requires password again';
    await friendA.reload({ waitUntil: 'domcontentloaded' });
    await friendA.locator('#claim-auth-panel').waitFor({ state: 'visible' });
    assert.equal(await friendA.locator('#claim-content').isVisible(), false);
    assert.equal(await friendA.locator('#auth-password').inputValue(), '', 'reload cannot restore a password');
    await until(() => friendA.locator('#auth-confirm').isEnabled(), 'reload status fetched');
    await failedLogin(friendA, WRONG);
    await login(friendA, PASSWORD_A);
    await friendA.locator('#claim-content').waitFor({ state: 'visible' });
    assert.equal(await friendA.locator('#qty-0').inputValue(), '3', 'unsent quantity draft restored only after correct password');
    assert.equal(await friendA.locator('#person-name').inputValue(), NAME_A);
    assert.equal(await friendA.locator('#unit-0').inputValue(), '');
    await storedNoSecrets(friendA);
    await screenshot(friendA, 'verified-edit-restored-draft');
    pass('edit-click gate, wrong-password lock, cross-name denial and reauthentication after draft reload');
  }
  stage = 'verified revision waits for actual host recalculation';
  const before = harness.requests.length;
  await friendA.locator('#submit-button').click();
  await friendA.locator('#revision-waiting').waitFor({ state: 'visible' });
  await until(() => harness.requests.slice(before).some(entry => entry.id === created.id && entry.path.endsWith('/claims/submit') && entry.status === 200), 'real revised submit accepted');
  const revised = harness.requests.slice(before).find(entry => entry.id === created.id && entry.path.endsWith('/claims/submit') && entry.status === 200);
  assert.equal(revised.input.name, NAME_A); assert.equal(revised.input.claims[0].qty, revisedQty);
  assert(revised.input.editToken && !revised.input.password, 'editor submit uses only the in-memory identity-bound ticket');
  noSecrets(revised.output); assert.equal(friendA.url(), link);
  assert.equal(harness.record(created.id).data.items[0].shares.find(share => share.person === NAME_A).quantity, initialQty, 'server still holds old exact allocation until host PUT');
  await until(() => harness.requests.slice(before).some(entry => entry.id === created.id && entry.method === 'GET' && entry.path === endpoint(created.id) && entry.output?.status === 'ready'), 'friend actually checks stale ready result', 10000);
  assert.equal(await friendA.locator('iframe.same-link-result').isVisible(), false, 'stale result hidden while quantities differ');
  await screenshot(friendA, 'revision-waiting-old-result-hidden');
  const inbox = expectStatus(await call(created.id, '/claims/inbox?after=0', { owner: created.writeToken }), 200, 'secure revised inbox');
  assert.equal(inbox.updates.find(entry => entry.name === NAME_B).claims[0].qty, 1);
  const ownToken = remember(expectStatus(await post(created.id, 'unlock', { name: NAME_A, password: PASSWORD_A }, { ip: '203.0.113.230' }), 200, 'identity-bound token check')).editToken;
  expectStatus(await post(created.id, 'submit', claims(NAME_B, 99, { editToken: ownToken }), { ip: '203.0.113.230' }), 403, 'reused token rename must fail');
  expectStatus(await post(created.id, 'submit', claims(NAME_A, 99, { editToken: 'q'.repeat(43) }), { ip: '203.0.113.230' }), 403, 'invalid reused token must fail');
  if (host) {
    const latestReplies = await hostPull(host, [NAME_A, NAME_B]);
    const quantityOf = (text, name) => Number(text.split(`姓名：${name}`)[1]?.match(/認帳份數\s*=\s*([\d.]+)/)?.[1]);
    await until(async () => quantityOf(await host.getByTestId('claim-replies').inputValue(), NAME_A) === revisedQty, 'host preserves exact replacement quantity and full-width name');
    assert.equal(quantityOf(latestReplies, NAME_B), 1);
    assert.equal(await host.getByTestId('final-summary-preview').count(), 0, 'prior host report invalidated');
    await hostCalculate(host, created, revisedQty);
  } else await publish(created, [claims(NAME_A, revisedQty), claims(NAME_B, 1)]);
  const frame = await resultFor(friendA, NAME_A);
  const finalAmount = harness.record(created.id).data.participants.find(person => person.name === NAME_A).total;
  await until(async () => (await frame.locator('#grand-total').innerText()).replace(/,/g, '').includes(Number(finalAmount).toFixed(2)), 'original result frame shows revised amount');
  assert.equal(friendA.url(), link);
  assert.equal(harness.record(created.id).data.items[0].shares.find(share => share.person === NAME_A).quantity, revisedQty);
  assert.equal(harness.record(created.id).data.items[0].shares.find(share => share.person === NAME_B).quantity, 1);
  await storedNoSecrets(friendA); await storedNoSecrets(friendB);
  await screenshot(friendA, 'same-link-recalculated-result');
  if (host) {
    await storedNoSecrets(host, { host: true });
    assert.equal(await host.getByTestId('friend-share-open').getAttribute('href'), link);
    await hostPull(host, [NAME_A, NAME_B]);
    stage = 'actual host explicit identity-verification code management';
    await host.getByTestId('claim-password-management').waitFor({ state: 'visible' });
    await host.getByTestId('claim-approval-name').fill(NAME_B);
    host.once('dialog', dialog => dialog.accept());
    const codeBefore = harness.requests.length;
    await host.getByTestId('claim-approve-password').click();
    await host.getByTestId('claim-approval-code').waitFor({ state: 'visible' });
    const code = await host.getByTestId('claim-approval-code').innerText();
    const approval = harness.requests.slice(codeBefore).find(entry => entry.path.endsWith('/claims/approve') && entry.status === 200);
    assert(approval && approval.output.setupCode === code.trim(), 'actual host code is the real DO-issued single-use authority');
    remember(approval.output); await storedNoSecrets(host, { host: true });
    expectStatus(await post(created.id, 'unlock', { name: NAME_B, password: PASSWORD_B }, { ip: '203.0.113.231' }), 200, 'owner issuance alone leaves current password working');
    pass('actual-host owner confirmation UI issues a private, unpersisted real code');
  }
  pass(host ? 'actual-host secure inbox revision, automatic original-session PUT and unchanged friend URL' : 'friend revision, real current-quantity PUT and unchanged friend URL');
  if (PRECISION) pass('full-width canonical identity and exact 1.234-to-1.2345 revision never accept stale result');
  return fixture;
}
async function legacyUI(created) {
  stage = 'legacy result gate and owner-code redemption/reset';
  const page = await newPage('legacy-friend');
  const link = linkFor(created);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await openGate(page, NAME_A);
  await page.locator('#auth-setup-code').waitFor({ state: 'visible' });
  await failedLogin(page, PASSWORD_A);
  const approved = expectStatus(await post(created.id, 'approve', { name: NAME_A }, { owner: created.writeToken }), 200, 'approve baseline identity');
  await login(page, PASSWORD_A, approved.setupCode);
  await page.locator('#claim-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#qty-0').inputValue(), '2', 'baseline data appears only after owner-code/password proof');
  assert.equal(await page.locator('#person-name').inputValue(), NAME_A); await storedNoSecrets(page);
  await page.locator('#cancel-claim-edit').click();
  await openGate(page, NAME_A);
  await page.locator('#auth-reset').click();
  await page.locator('#auth-setup-code').waitFor({ state: 'visible' });
  const reset = expectStatus(await post(created.id, 'approve', { name: NAME_A }, { owner: created.writeToken }), 200, 'approve forgotten-password reset');
  await login(page, PASSWORD_RESET, reset.setupCode);
  await page.locator('#claim-content').waitFor({ state: 'visible' });
  await page.locator('#cancel-claim-edit').click();
  await openGate(page, NAME_A);
  await page.locator('#auth-reset').click();
  await failedLogin(page, PASSWORD_B, reset.setupCode);
  await page.locator('#auth-cancel').click();
  await openGate(page, NAME_A);
  await failedLogin(page, PASSWORD_A);
  await login(page, PASSWORD_RESET);
  await page.locator('#claim-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#qty-0').inputValue(), '2'); await storedNoSecrets(page);
  await screenshot(page, 'legacy-owner-code-verified');
  pass('legacy UI owner-code enrollment, explicit forgotten-password reset and single-use replay denial');
  // Exercise first-enrollment approval field on a PENDING legacy fixture, not
  // an already published iframe (a result takes precedence over initial form).
  const pending = await newSession();
  const record = harness.record(pending.id); delete record.claimSecurity;
  harness.values.set(`share:${pending.id}`, { value: JSON.stringify(record), options: {} }); harness.objects.delete(pending.id);
  expectStatus(await post(pending.id, 'setup', { members: [] }, { owner: pending.writeToken }), 200, 'protect old pending session');
  const first = await newPage('legacy-first-enrollment');
  await first.goto(linkFor(pending), { waitUntil: 'domcontentloaded' });
  await first.locator('#claim-content').waitFor({ state: 'visible' });
  await first.locator('#person-name').fill('QA舊首次登記'); await first.locator('#qty-0').fill('1');
  await first.locator('#first-setup-code').waitFor({ state: 'visible' });
  await first.locator('#claim-password').fill(PASSWORD_A); await first.locator('#claim-password-repeat').fill(PASSWORD_A);
  await first.locator('#submit-button').click();
  await until(async () => (await first.locator('#submit-status').innerText()).length > 0, 'legacy initial self-enrollment rejected');
  assert.equal(await first.locator('#revision-waiting').isVisible(), false);
  const firstCode = expectStatus(await post(pending.id, 'approve', { name: 'QA舊首次登記' }, { owner: pending.writeToken }), 200, 'approve legacy unknown identity');
  await first.locator('#first-setup-code').fill(firstCode.setupCode); await first.locator('#submit-button').click();
  await first.locator('#revision-waiting').waitFor({ state: 'visible' }); await storedNoSecrets(first);
  pass('legacy initial form shows required owner-code field and rejects unapproved enrollment');
  stage = 'actual 410 expiry locks friend UI';
  const expiring = await newSession();
  const expiredPage = await newPage('expired-friend');
  const expiredLink = linkFor(expiring);
  harness.nowFor(expiring.id, Date.parse(expiring.expiresAt) + 1);
  const count = harness.requests.length;
  await expiredPage.goto(expiredLink, { waitUntil: 'domcontentloaded' });
  await expiredPage.locator('#expired-panel').waitFor({ state: 'visible' });
  assert(harness.requests.slice(count).some(entry => entry.id === expiring.id && entry.status === 410), 'expiry UI must come from actual Worker 410, not mocked flags');
  assert.equal(await expiredPage.locator('#claim-content').isVisible(), false);
  assert.equal(await expiredPage.locator('#claim-auth-panel').isVisible(), false);
  assert.equal(await expiredPage.locator('#submit-button').isVisible(), false);
  await screenshot(expiredPage, 'expired-410-form-locked');
  pass('real-410 expiry hides initial form, authorization form and submit action');
}
(async () => {
  const [html, api, config] = await Promise.all(['claim.html', 'bill-share-api.js', 'share-config.js'].map(file => fs.readFile(path.join(ROOT, file), 'utf8')));
  assert(html.includes('id="claim-auth-panel"') && html.includes('id="claim-password-repeat"') && api.includes('submitSecureClaim') && api.includes('approveClaimPassword'), 'Application password contracts are not ready; rerun once implementation jobs finish');
  workerOrigin = new URL(config.match(/apiBaseUrl:\s*['"]([^'"]+)/)?.[1] || 'https://bill-splitter-share.cw9102025.workers.dev').origin;
  const { createPasswordTestServer } = await import(pathToFileURL(path.join(__dirname, 'password-test-server.mjs')).href);
  harness = await createPasswordTestServer({ origin: base.origin, publicStaticQA }); secrets.add(harness.env.CLAIM_PASSWORD_PEPPER);
  try {
    const hostOnly = HOST_ONLY;
    const legacyOnly = process.argv.includes('--legacy-only');
    if (!hostOnly && !legacyOnly) await backendBoundaries();
    const legacy = hostOnly ? null : await createLegacy();
    if (!process.argv.includes('--backend-only')) {
      await fs.mkdir(SCREENSHOTS, { recursive: true });
      await preloadRuntimes();
      browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      if (!legacyOnly) await friendsAndHost();
      if (legacy) await legacyUI(legacy);
      for (const entry of pages) await storedNoSecrets(entry.page, { host: entry.host });
    }
    assert.equal(blocked.length, 0, 'No ntfy, external Worker fallback or unmatched mutation is permitted');
    assert.equal(harness.outboundBlocked.length, 0, 'Application backend attempted external networking');
    const relevantErrors = errors.filter(error => !/favicon|Failed to load resource: the server responded with a status of (403|409|410)|Failed to load resource: net::ERR_ABORTED/.test(error));
    assert.equal(relevantErrors.length, 0, `Unexpected browser runtime errors: ${scrub(relevantErrors.join('; '))}`);
    pass('all Worker traffic local, no ntfy transport, no auth secrets in URLs/storage/replies');
    console.log(`SUMMARY ${JSON.stringify({ result: 'PASS', tests: steps.length, localRealBackend: true, externalWrites: 0, screenshots: process.argv.includes('--backend-only') ? null : SCREENSHOTS })}`);
  } finally { if (browser) await browser.close(); if (harness) await harness.close(); }
})().catch(async error => {
  console.error(`FAIL ${scrub(stage)}: ${scrub(error.stack || error)}`);
  // No DOM, request bodies, names, tokens or passwords are dumped on failure.
  process.exitCode = 1;
});
