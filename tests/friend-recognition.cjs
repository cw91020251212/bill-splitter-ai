'use strict';
/* R105 focused QA. Only synthetic memory state is written; no deploy/remote API.
 * Start static server on 4192, then run after BOTH implementation agents are ready:
 *   node tests/friend-recognition.cjs [--backend-only|--friends-only]
 * Public static QA (read-only): PUBLIC_STATIC_QA=1 BASE_URL=https://cw91020251212.github.io/bill-splitter-ai/ node tests/friend-recognition.cjs
 * Every bill API is intercepted into password-test-server.mjs (real Worker/DO).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { webcrypto } = require('node:crypto');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const { chromium } = require('/tmp/ui-qa/node_modules/playwright');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const relay = require('../claim-relay.js');
const ROOT = path.resolve(__dirname, '..');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4192/');
const publicStaticQA = (process.env.PUBLIC_STATIC_QA === '1' || process.env.publicStaticQA === '1') && base.origin === 'https://cw91020251212.github.io' && base.pathname.startsWith('/bill-splitter-ai/');
assert((['localhost', '127.0.0.1'].includes(base.hostname) && base.protocol === 'http:') || publicStaticQA, 'Only local static or explicitly authorized project GitHub static QA is permitted');
const site = new URL(base.pathname.endsWith('.html') ? './' : (base.pathname.endsWith('/') ? base.href : `${base.href}/`), base);
const OUT = '/home/ubuntu/bill-R105-qa';
const A = 'QA無碼朋友', B = 'QA保護朋友', C = 'QA新暱稱';
const INITIAL_QTY = 1.234, REVISED_QTY = 1.2345;
const PIN = '0042', WRONG = '9937', PASSWORD = 'QA-legacy-password-2026!';
const secrets = new Set([PIN, WRONG, PASSWORD]), owners = new Set(), steps = [], errors = [], blocked = [], pages = [], runtimes = new Map();
let harness, browser, workerOrigin, stage = 'readiness', metrics = {};
function pass(label) { steps.push(label); console.log(`PASS ${label}`); }
function remember(body) { for (const key of ['editToken', 'setupCode', 'writeToken']) if (body?.[key]) { secrets.add(body[key]); if (key === 'writeToken') owners.add(body[key]); } return body; }
function scrub(value) { let text = String(value); for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]'); return text; }
function secretFree(value, host = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) if (!(host && owners.has(secret))) assert(!text.includes(secret), 'Credential escaped to public result, URL or persistent storage');
  assert(!/"(?:recognitionCode|password|salt|hash|tickets|editToken|setupCode)"\s*:/i.test(text), 'Private credential fields escaped the request-local boundary');
}
async function until(check, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error(`Timed out: ${label}`); }
const payload = (name, qty = 1, extra = {}) => ({ name, claims: [{ id: '01', qty, unit: '', displayUnit: '' }], ...extra });
const endpoint = (id, tail = '') => `/api/shares/${id}${tail}`;
async function call(id, tail = '', options = {}) { const result = await harness.call(endpoint(id, tail), options); remember(result.body); return result; }
const post = (id, op, body, extra = {}) => call(id, `/claims/${op}`, { method: 'POST', body, ...extra });
function status(result, expected, label) { assert.equal(result.status, expected, `${label}: HTTP ${result.status} (${result.body?.code || 'no code'})`); return result.body; }
async function create() { const c = remember(status(await harness.call('/api/shares/sessions', { method: 'POST', body: { ttlDays: 1 } }), 201, 'create')); assert.equal(c.claimSecurity, 'password', 'R105 retains the security compatibility sentinel'); return c; }
async function kind(id, name, expected) { const result = status(await call(id, `/claims/status?name=${encodeURIComponent(name)}`), 200, 'credential status'); assert.equal(result.credentialKind, expected, `status kind for ${name}`); secretFree(result); return result; }
function data(entries) {
  const total = entries.reduce((n, entry) => n + entry.claims[0].qty, 0);
  return { version: 2, language: 'zh-HK', bill: { date: '2026-11-07', payer: A, currency: 'HKD', sourceCurrency: 'HKD', billTotal: 100, sourceTotal: 100, sourceBillTotal: 100, itemsSubtotal: 100, exchangeRate: 1 },
    participants: entries.map(e => ({ name: e.name, total: 100 * e.claims[0].qty / total, subtotal: 100 * e.claims[0].qty / total })),
    items: [{ id: '01', number: '01', name: 'QA茶', quantity: 0, unit: '', sourceAmount: 100, allocatedAmount: 100, shares: entries.map(e => ({ person: e.name, quantity: e.claims[0].qty, unit: '份', isActualUnit: false, amount: 100 * e.claims[0].qty / total })) }], adjustments: [], images: [] };
}
function linkFor(c) { const url = new URL('claim.html', site); url.searchParams.set('session', c.id); url.hash = relay.buildHash(Buffer.from(JSON.stringify([{ id: '01', name: 'QA茶', totalQty: null, unit: '' }])).toString('base64url'), relay.createRoom(), { title: 'QA識別碼驗收', createdAt: Date.parse(c.createdAt), expiresAt: Date.parse(c.expiresAt) }); secretFree(url.href); return url.href; }
async function publish(c, entries) { status(await call(c.id, '', { method: 'PUT', owner: c.writeToken, body: data(entries) }), 200, 'publish current claims'); }
async function backend() {
  stage = 'real backend optional code contracts';
  const c = await create(); await kind(c.id, A, 'new');
  status(await post(c.id, 'submit', payload(A, 1, { recognitionCode: '' })), 200, 'blank code first submit'); await kind(c.id, A, 'none');
  const open = remember(status(await post(c.id, 'unlock', { name: A, recognitionCode: '' }), 200, 'name and blank code retrieve'));
  assert.equal(open.payload.claims[0].qty, 1); secretFree(open.payload);
  status(await post(c.id, 'submit', payload(A, 2, { recognitionCode: '' })), 200, 'blank code revision');
  for (const invalid of ['123', '12345', 'abcd']) status(await post(c.id, 'submit', payload('QA格式測試', 1, { recognitionCode: invalid })), 400, 'only blank or exactly four digits');
  status(await post(c.id, 'submit', payload(B, 1, { recognitionCode: PIN })), 200, 'leading-zero PIN first submit'); await kind(c.id, B, 'pin');
  for (const [n, code] of [WRONG, '', undefined].entries()) { const rejected = await post(c.id, 'unlock', { name: B, ...(code === undefined ? {} : { recognitionCode: code }) }, { ip: `203.0.113.${110 + n}` }); status(rejected, 403, 'wrong, blank or missing PIN retrieval denied'); assert.equal(rejected.body.code, 'wrong_recognition_code'); assert.equal(rejected.body.payload, undefined); secretFree(rejected.body); }
  status(await post(c.id, 'submit', payload(B, 99, { recognitionCode: '' }), { ip: '203.0.113.114' }), 403, 'blank cannot overwrite PIN member');
  const pin = remember(status(await post(c.id, 'unlock', { name: B, recognitionCode: PIN }), 200, 'correct four digits retrieve'));
  assert.equal(pin.payload.claims[0].qty, 1);
  status(await post(c.id, 'submit', payload(B, 3, { editToken: pin.editToken })), 200, 'PIN editor ticket revision');
  await kind(c.id, B, 'pin');
  assert.equal(status(await post(c.id, 'unlock', { name: B, recognitionCode: PIN }), 200, 'ticket-only revision retains PIN').payload.claims[0].qty, 3);
  status(await post(c.id, 'submit', payload('QA舊密碼', 1, { password: PASSWORD })), 200, 'optional legacy password enrollment'); await kind(c.id, 'QA舊密碼', 'password');
  status(await post(c.id, 'submit', payload('QA舊密碼', 99, { editToken: pin.editToken }), { ip: '203.0.113.115' }), 403, 'ticket is identity bound for protected names');
  const old = status(await post(c.id, 'unlock', { name: 'QA舊密碼', password: PASSWORD }), 200, 'legacy password still unlocks');
  status(await post(c.id, 'submit', payload('QA舊密碼', 1, { editToken: old.editToken })), 200, 'legacy ticket-only edit'); await kind(c.id, 'QA舊密碼', 'password');
  status(await post(c.id, 'unlock', { name: 'QA舊密碼', recognitionCode: '' }, { ip: '203.0.113.116' }), 403, 'legacy password cannot downgrade to blank');
  const legacy = await create(), record = harness.record(legacy.id); delete record.claimSecurity; record.status = 'ready'; record.data = data([payload(B)]);
  harness.values.set(`share:${legacy.id}`, { value: JSON.stringify(record), options: {} }); harness.objects.delete(legacy.id);
  status(await post(legacy.id, 'unlock', { name: B, recognitionCode: '' }), 409, 'unenabled legacy session still requires owner setup');
  status(await post(legacy.id, 'setup', { members: [] }, { owner: legacy.writeToken }), 200, 'seed old protected member'); await kind(legacy.id, B, 'reserved');
  const reserved = status(await post(legacy.id, 'unlock', { name: B, recognitionCode: '' }), 200, 'enabled reserved name retrieves without per-name owner approval'); assert.equal(reserved.payload.claims[0].qty, 1);
  await publish(c, [payload(A, 2), payload(B, 3), payload('QA舊密碼')]); secretFree(status(await call(c.id), 200, 'public result'));
  secretFree(status(await call(c.id, '/claims/inbox?after=0', { owner: c.writeToken }), 200, 'organizer inbox'));
  harness.nowFor(c.id, Date.parse(c.expiresAt) + 1);
  status(await post(c.id, 'submit', payload(A, 4, { recognitionCode: '' })), 410, 'expired optional-code mutation'); assert.equal(harness.record(c.id), null); assert.equal(harness.objects.get(c.id).ctx.data.size, 0);
  pass('backend new/none/pin/password/reserved, blank revision, PIN denial, identity-bound ticket, legacy and expiry');
}
async function preload() {
  await Promise.all(['https://cdn.tailwindcss.com', 'https://unpkg.com/react@18/umd/react.production.min.js', 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'https://unpkg.com/@babel/standalone/babel.min.js'].map(async url => {
    const { stdout } = await execFile('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '45', url], { maxBuffer: 20 * 1024 * 1024 }); assert(stdout.length > 1000); runtimes.set(url, stdout);
  }));
}
async function pageFor(label, host = false) {
  const context = await browser.newContext({ viewport: host ? { width: 1100, height: 900 } : { width: 390, height: 844 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
  await context.addInitScript(() => localStorage.setItem('billSplitterFirstVisitVideoHubSeenV1', '1'));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname === '/api/shares' || url.pathname.startsWith('/api/shares/')) {
      if (![workerOrigin, base.origin].includes(url.origin)) { blocked.push('unexpected API origin'); return route.abort(); }
      const headers = { ...await request.allHeaders(), 'x-qa-original-url': request.url(), 'cf-connecting-ip': `203.0.113.${host ? 201 : 210 + pages.length}` };
      for (const key of ['host', 'content-length', 'connection']) delete headers[key]; if (!headers.origin) headers.origin = base.origin;
      const response = await fetch(`${harness.apiBase}${url.pathname}${url.search}`, { method, headers, ...(!['GET', 'HEAD'].includes(method) && request.postData() !== null ? { body: request.postDataBuffer() } : {}) });
      const body = await response.text(); try { remember(JSON.parse(body)); } catch (_) {}
      const responseHeaders = Object.fromEntries(response.headers); for (const key of ['content-length', 'transfer-encoding', 'connection']) delete responseHeaders[key];
      return route.fulfill({ status: response.status, headers: responseHeaders, body });
    }
    if (url.hostname.endsWith('.workers.dev') || url.hostname === 'ntfy.sh' || !['GET', 'HEAD', 'OPTIONS'].includes(method)) { blocked.push('remote fallback or unmatched mutation'); return route.abort(); }
    if (runtimes.has(request.url())) return route.fulfill({ status: 200, contentType: 'text/javascript', body: runtimes.get(request.url()) });
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  pages.push({ page, label, host }); return page;
}
async function visible(page, selector) { const all = page.locator(selector); for (let n = 0; n < await all.count(); n++) if (await all.nth(n).isVisible()) return all.nth(n); throw new Error(`Missing visible UI contract: ${selector}`); }
const firstCode = page => page.locator('#claim-password');
const authCode = page => page.locator('#auth-password');
async function stored(page, host = false) { const value = await page.evaluate(() => ({ url: location.href, local: { ...localStorage }, session: { ...sessionStorage }, replies: document.querySelector('#reply-preview,[data-testid="claim-replies"]')?.value || '' })); secretFree(value.url); secretFree(value.local, host); secretFree(value.session, host); secretFree(value.replies); }
async function friendState(page, c) { return page.evaluate(id => JSON.parse(localStorage.getItem(`billSplitterFriendClaimV1:${id}`) || 'null'), c.id); }
async function shot(page, name) {
  const secretIds = await page.locator('input[type="password"],#claim-password,#auth-password,#claim-recognition-code,#recognition-code,#auth-recognition-code,#auth-setup-code,#first-setup-code').evaluateAll(inputs => inputs.filter(input => input.value && input.id).map(input => input.id));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, mask: secretIds.map(id => page.locator(`#${id}`)), maskColor: '#d5e4dc' });
}
async function compactInitial(page) {
  const code = await firstCode(page), name = page.locator('#person-name');
  const n = await name.boundingBox(), c = await code.boundingBox(); assert(n && c);
  metrics.initial = { name: n, code: c };
  assert(Math.abs(n.y + n.height / 2 - c.y - c.height / 2) <= 3 && n.x + n.width <= c.x + 8, '390px: small optional code is centered alongside name');
  assert(c.width <= 88 && c.height <= 36 && c.width < n.width / 2 && c.height < n.height, 'R107 code field remains noticeably smaller than name');
  assert.equal(c.width, 84, 'R107 keeps the original 84px compact code width');
  const codeStyle = await code.evaluate(n => ({ background: getComputedStyle(n).backgroundImage, letterSpacing: getComputedStyle(n).letterSpacing, textAlign: getComputedStyle(n).textAlign }));
  assert.equal(codeStyle.background, 'none', 'R107 uses one plain input, not four segmented cells');
  assert.equal(codeStyle.letterSpacing, 'normal', 'R107 avoids extra tracking that caused horizontal scrolling');
  assert.equal(codeStyle.textAlign, 'center', 'R107 centers the code inside the single field');
  assert(/選填|optional/i.test(await page.locator('#first-password-label').innerText()), 'optional is explicit beside the code label');
  assert.equal(await code.getAttribute('required'), null, 'recognition code is optional');
  assert.equal(await page.locator('#claim-password-repeat:visible').count(), 0, 'no repeated password field');
  assert(!/至少\s*8|at least\s*8|再輸入一次密碼|Enter the password again/i.test(await page.locator('#claim-content').innerText()), 'no visible mandatory-eight/password-repeat copy');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px has no horizontal overflow');
  return code;
}
async function focusedCode(page, input, label) {
  await input.focus(); await input.pressSequentially('1234');
  assert.equal(await input.inputValue(), '1234', `${label}: retains all four entered digits`);
  const focused = await input.evaluate(n => ({ scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(focused.scrollLeft, 0, `${label}: caret at end must not scroll first digit out of view`);
  assert(focused.scrollWidth <= focused.clientWidth, `${label}: four digits fit while focused`);
  await input.fill('1234'); await input.press('End');
  const pasted = await input.evaluate(n => ({ value: n.value, scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(pasted.value, '1234', `${label}: accepts a pasted four-digit code`);
  assert.equal(pasted.scrollLeft, 0, `${label}: pasted value remains visible with caret at end`);
  assert(pasted.scrollWidth <= pasted.clientWidth, `${label}: pasted digits fit the compact field`);
  await input.press('End'); assert.equal(await input.inputValue(), '1234');
  await input.press('Backspace'); assert.equal(await input.inputValue(), '123');
  await input.pressSequentially('4'); assert.equal(await input.inputValue(), '1234');
  await input.blur(); assert.equal(await input.inputValue(), '1234', `${label}: blur preserves value`);
  await input.focus(); assert.equal(await input.inputValue(), '1234', `${label}: refocus preserves value`);
  const refocused = await input.evaluate(n => ({ scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(refocused.scrollLeft, 0, `${label}: refocus keeps first digit visible`);
  await input.fill('');
  pass(`${label}: typed and pasted digits fit with caret at end; delete, retype, blur and refocus work`);
}
async function result(page, name) { await page.locator('iframe.same-link-result:not([hidden])').waitFor({ state: 'visible' }); const f = page.frameLocator('iframe.same-link-result'); await f.locator('#member-select').selectOption({ label: name }); return f; }
async function gate(page, name) {
  const f = await result(page, name); await f.locator('#edit-claims').click(); await page.locator('#claim-auth-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#auth-name').inputValue(), name); assert.equal(await page.locator('#claim-content').isVisible(), false, 'protected previous claims not editable before proof');
  await until(() => page.locator('#auth-confirm').isEnabled(), 'identity status ready');
  const box = await page.locator('#claim-auth-panel').boundingBox(); metrics.inlineCard = box; assert(box.height <= 390, 'identity check is a compact inline card, not a large authentication screen');
  assert.equal(await page.locator('#claim-password-repeat:visible').count(), 0);
  const input = authCode(page); await focusedCode(page, input, 'authenticated edit'); return input;
}
async function submit(page, c, codeValue, qty) {
  const before = harness.requests.length; await page.locator('#qty-0').fill(String(qty)); await until(() => page.locator('#submit-button').isEnabled(), 'blank or valid code permits submit'); await page.locator('#submit-button').click();
  await page.locator('#revision-waiting').waitFor({ state: 'visible' });
  await until(() => harness.requests.slice(before).some(r => r.id === c.id && r.path.endsWith('/claims/submit') && r.status === 200), 'real submit accepted');
  const r = harness.requests.slice(before).find(r => r.id === c.id && r.path.endsWith('/claims/submit') && r.status === 200);
  assert.equal(r.input.claims[0].qty, qty, 'request retains full quantity precision');
  if (!r.input.editToken) { assert.equal(r.input.recognitionCode, codeValue, 'first submit sends explicit blank or four digits'); assert.equal(r.input.password, undefined); }
  else { assert.equal(r.input.password, undefined); assert.equal(r.input.recognitionCode, undefined, 'authorized editor sends editToken only, not replacement credentials'); }
  assert.equal(await page.locator('iframe.same-link-result').isVisible(), false, 'old result hidden pending recalculation'); await stored(page); return before;
}
async function hostFixture() {
  const host = await pageFor('host', true); await host.goto(new URL('index.html', site).href, { waitUntil: 'domcontentloaded', timeout: 30000 }); await host.getByTestId('start-manual').click();
  const price = host.locator('[data-tutorial-target="item-fields"] input[type="number"]').first(), item = host.getByPlaceholder('輸入項目名稱...');
  await price.click(); await price.fill('100'); await item.click(); await item.fill('QA茶');
  await until(async () => await price.inputValue() === '100' && await item.inputValue() === 'QA茶', 'manual fields settled');
  assert.equal(await host.getByTestId('claim-expiry-days').inputValue(), '14', 'new activities default claim links to 14 days');
  await host.getByTestId('go-to-payer').click();
  await until(async () => await host.getByPlaceholder('輸入姓名', { exact: true }).isVisible(), 'can advance to payer before friends reply');
  await host.locator('.step-nav').getByRole('button', { name: '各自認帳' }).click();
  await until(async () => await host.getByTestId('claim-expiry-days').isVisible(), 'can return to replies after advancing');
  await host.getByTestId('claim-activity-name').fill('QA識別碼驗收'); await host.getByTestId('claim-expiry-days').selectOption('1'); const before = harness.requests.length;
  await host.getByTestId('claim-link-actions').getByRole('button', { name: '複製認帳連結', exact: true }).click(); await host.waitForFunction(() => Boolean(document.querySelector('[data-testid="claim-link-actions"]')?.dataset.claimLink));
  const link = await host.getByTestId('claim-link-actions').evaluate(n => n.dataset.claimLink), c = remember(harness.requests.slice(before).find(r => r.path === '/api/shares/sessions' && r.status === 201)?.output);
  assert(c, 'actual host creates real session'); assert.equal(c.claimSecurity, 'password'); assert.equal(new URL(link).searchParams.get('session'), c.id); secretFree(link); return { host, c, link };
}
async function hostSettle(fixture, qty, initial = false, names = [A, B]) {
  const { host, c } = fixture;
  if (!host) return publish(c, [payload(A, qty), payload(B)]);
  await host.bringToFront(); await host.evaluate(() => window.dispatchEvent(new Event('focus')));
  const nav = host.locator('.step-nav').getByRole('button', { name: '各自認帳' });
  await until(async () => { const refresh = host.getByTestId('claim-inbox-refresh'); if (!await refresh.count()) { if (await nav.count()) await nav.click(); return false; } if (!await refresh.isEnabled()) return false; await refresh.click(); return true; }, 'owner refresh current inbox');
  await until(async () => { const replies = host.getByTestId('claim-replies'); if (!await replies.count()) { if (await nav.count()) await nav.click(); return false; } const text = await replies.inputValue(); return names.every(name => text.includes(`姓名：${name}`)) && Number(text.split(`姓名：${A}`)[1]?.match(/認帳份數\s*=\s*([\d.]+)/)?.[1]) === qty; }, 'host sees one exact current revision');
  const text = await host.getByTestId('claim-replies').inputValue(); assert.equal(text.split(`姓名：${A}`).length - 1, 1); secretFree(text);
  await host.getByTestId('go-to-payer').click(); const payer = host.getByPlaceholder('輸入姓名', { exact: true }); if (await payer.inputValue() !== A) await payer.fill(A);
  const before = harness.requests.length;
  await host.getByTestId('calculate-split').click();
  // The organizer explicitly recalculates; the application then publishes the
  // original session automatically, without any test-side result PUT.
  await until(() => harness.requests.slice(before).some(r => r.id === c.id && r.method === 'PUT' && r.status === 200 && r.input?.items?.[0]?.shares?.find(s => s.person === A)?.quantity === qty && names.every(name => r.input.participants.some(p => p.name === name))), 'host recalculation publishes original-session PUT', 35000);
  const request = harness.requests.slice(before).find(r => r.id === c.id && r.method === 'PUT' && r.status === 200); assert.equal(request.authorization, `Bearer ${c.writeToken}`); secretFree(request.input);
  assert.equal(harness.record(c.id).data.items[0].shares.find(s => s.person === A).quantity, qty); await stored(host, true);
}
async function ui() {
  stage = 'actual host and compact optional initial form';
  const fixture = process.argv.includes('--friends-only') ? await (async () => { const c = await create(); return { c, link: linkFor(c), host: null }; })() : await hostFixture();
  const { c, link } = fixture, a = await pageFor('blank friend'), b = await pageFor('PIN friend');
  await a.goto(link, { waitUntil: 'domcontentloaded' }); await a.locator('#claim-content').waitFor({ state: 'visible' }); await a.locator('#person-name').fill(A);
  const code = await compactInitial(a); assert.equal(await code.inputValue(), ''); await focusedCode(a, code, 'new claim');
  const random = await visible(a, '#random-code');
  const randomBox = await random.boundingBox(); assert(randomBox.width <= 52 && randomBox.height <= 52, 'random control is tiny'); await random.click(); const generated = await code.inputValue(); assert.match(generated, /^\d{4}$/); secrets.add(generated); await code.fill(''); assert.equal(await code.inputValue(), '');
  await shot(a, 'initial-compact-name-code'); await submit(a, c, '', INITIAL_QTY); assert.equal(a.url(), link);
  await b.goto(link, { waitUntil: 'domcontentloaded' }); await b.locator('#claim-content').waitFor({ state: 'visible' }); await b.locator('#person-name').fill(B); const bCode = await firstCode(b); await bCode.fill(PIN); await b.locator('#qty-0').fill('1'); await stored(b); assert.equal(await bCode.inputValue(), PIN, 'draft storage check happens while code is still entered'); await submit(b, c, PIN, 1); assert.equal(await bCode.inputValue(), '', 'successful enrollment clears recognition code');
  const pending = await friendState(a, c); assert.equal(pending.pending.payload.name, A);
  await a.locator('#edit-claim-again').click(); await a.locator('#claim-auth-panel').waitFor({ state: 'visible' }); await until(() => a.locator('#auth-confirm').isEnabled(), 'pending name identity ready');
  await a.locator('#auth-reset').click(); await a.locator('#auth-retry').click(); assert.equal(await (await authCode(a)).inputValue(), '');
  assert.deepEqual((await friendState(a, c)).pending, pending.pending, 'forgot retry preserves old pending claim');
  if (!await a.locator('#auth-recovery').isVisible()) await a.locator('#auth-reset').click();
  await a.locator('#auth-new-name').click(); await a.locator('#claim-content').waitFor({ state: 'visible' });
  assert.deepEqual((await friendState(a, c)).pending, pending.pending, 'new nickname preserves old pending claim');
  assert.deepEqual((await friendState(a, c)).submitted, pending.submitted, 'new nickname preserves old submitted claim');
  await a.locator('#person-name').fill(A); await (await firstCode(a)).click(); await a.locator('#first-retrieve').waitFor({ state: 'visible' }); await a.locator('#first-retrieve').click();
  await a.locator('#claim-auth-panel').waitFor({ state: 'visible' }); await until(() => a.locator('#auth-confirm').isEnabled(), 'initial-name retrieve status ready');
  const authNameBox = await a.locator('#auth-name').boundingBox(), authCodeBox = await (await authCode(a)).boundingBox(); metrics.authCompact = { name: authNameBox, code: authCodeBox };
  assert(Math.abs(authNameBox.y + authNameBox.height / 2 - authCodeBox.y - authCodeBox.height / 2) <= 3 && authNameBox.x + authNameBox.width <= authCodeBox.x + 8, '390px auth name/code adjacent');
  assert((await a.locator('#claim-auth-panel').boundingBox()).height <= 390, 'initial retrieve uses compact inline authentication');
  assert.equal(await a.locator('#auth-password').inputValue(), ''); await shot(a, 'auth-compact-name-code');
  await a.locator('#auth-confirm').click(); await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#qty-0').inputValue(), String(INITIAL_QTY));
  await a.locator('#cancel-claim-edit').click(); await a.locator('#revision-waiting').waitFor({ state: 'visible' });
  await hostSettle(fixture, INITIAL_QTY, true); await result(a, A); pass('390px optional and auth-adjacent fields, random/clear, blank and PIN enrollments, initial retrieve and forgotten pending preservation');
  stage = 'blank identity inline retrieve and revision';
  const blank = await gate(a, A); assert.equal(await blank.inputValue(), ''); await a.locator('#auth-confirm').click(); await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#qty-0').inputValue(), String(INITIAL_QTY));
  assert.equal(await (await firstCode(a)).inputValue(), '', 'unlock does not restore recognition code'); await shot(a, 'inline-edit-code-cleared');
  const before = await submit(a, c, '', REVISED_QTY); assert.equal(a.url(), link);
  assert.equal(harness.record(c.id).data.items[0].shares.find(s => s.person === A).quantity, INITIAL_QTY, 'old published allocation remains until host resettles');
  await until(() => harness.requests.slice(before).some(r => r.id === c.id && r.method === 'GET' && r.path === endpoint(c.id) && r.output?.status === 'ready'), 'friend polls stale full-precision result', 10000);
  assert.equal(await a.locator('iframe.same-link-result').isVisible(), false, '1.234 stale result does not match 1.2345 revision');
  await hostSettle(fixture, REVISED_QTY); await result(a, A); assert.equal(a.url(), link); await stored(a); pass('blank-name retrieval, ticket-only revision, exact 1.234 to 1.2345 matching and automatic host resettlement on original URL');
  stage = 'PIN identity denial, forgot options, retry and new nickname';
  let entered = await gate(a, B); await entered.fill(WRONG); const denyStart = harness.requests.length; await a.locator('#auth-confirm').click();
  await until(() => harness.requests.slice(denyStart).some(r => r.path.endsWith('/claims/unlock') && r.status === 403), 'wrong PIN rejected'); assert.equal(await a.locator('#claim-content').isVisible(), false); assert.equal(await entered.inputValue(), '', 'wrong-code retry clears code');
  const reset = await visible(a, '#auth-reset,#auth-forgot'); await reset.click();
  const panel = a.locator('#claim-auth-panel'); assert((await panel.boundingBox()).height <= 520, 'forgot options remain inline, not a giant card');
  assert(/新.*(?:暱稱|名字|姓名)|new.*(?:nickname|name)/i.test(await panel.innerText()), 'forgot offers new nickname');
  const retry = await visible(a, '#auth-retry,[data-testid="auth-retry"]'); await retry.click(); assert.equal(await (await authCode(a)).inputValue(), '', 'retry clears recognition code');
  if (!await a.locator('#auth-recovery').isVisible()) await (await visible(a, '#auth-reset,#auth-forgot')).click(); await (await visible(a, '#auth-new-name,#auth-new-nickname,[data-testid="auth-new-nickname"]')).click();
  await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#person-name').inputValue(), '', 'new nickname starts blank'); assert.equal(await a.locator('#person-name').evaluate(n => n.readOnly), false); assert.equal(await (await firstCode(a)).inputValue(), '');
  const protectedOwn = status(await post(c.id, 'unlock', { name: B, recognitionCode: PIN }, { ip: '203.0.113.244' }), 200, 'new nickname flow leaves protected record untouched'); assert.equal(protectedOwn.payload.claims[0].qty, 1);
  await a.locator('#person-name').fill(C); await submit(a, c, '', 1); await kind(c.id, C, 'none'); await kind(c.id, B, 'pin');
  if (!fixture.host) await publish(c, [payload(A, REVISED_QTY), payload(B), payload(C)]);
  else await hostSettle(fixture, REVISED_QTY, false, [A, B, C]);
  await result(a, B);
  entered = await gate(a, B); await entered.fill(PIN); await a.locator('#auth-confirm').click(); await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#qty-0').inputValue(), '1'); assert.equal(await (await authCodeIfPresent(a)), '', 'verified PIN clears input');
  await shot(a, 'inline-pin-edit-masked-code-cleared'); await stored(a); await stored(b);
  assert(harness.requests.slice(before).some(r => r.method === 'PUT' && r.status === 200)); pass('wrong PIN lock, forgot inline choices, cleared retry, new nickname non-overwrite and correct PIN unlock');
  stage = 'legacy password optional UI mode';
  const legacy = await create(); status(await post(legacy.id, 'submit', payload('QA舊密碼', 1, { password: PASSWORD })), 200, 'seed legacy long credential'); await publish(legacy, [payload('QA舊密碼')]);
  const old = await pageFor('legacy password'); await old.goto(linkFor(legacy), { waitUntil: 'domcontentloaded' }); const input = await gate(old, 'QA舊密碼'); await input.fill(PASSWORD); await old.locator('#auth-confirm').click(); await old.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await old.locator('#qty-0').inputValue(), '1'); await stored(old); pass('existing long-password member opens optional legacy mode and still unlocks');
}
async function authCodeIfPresent(page) { const nodes = page.locator('#auth-recognition-code,#auth-password'); return await nodes.count() ? nodes.first().inputValue() : ''; }
(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const [html, auth, config] = await Promise.all(['claim.html', 'worker/src/claim-auth.mjs', 'share-config.js'].map(f => fs.readFile(path.join(ROOT, f), 'utf8')));
  assert(auth.includes('recognitionCode') && (process.argv.includes('--backend-only') || html.includes('recognitionCode')), 'R105 code not ready: wait for parent readiness; do not run old-password suite');
  workerOrigin = new URL(config.match(/apiBaseUrl:\s*['"]([^'"]+)/)?.[1] || 'https://bill-splitter-share.cw9102025.workers.dev').origin;
  const { createPasswordTestServer } = await import(pathToFileURL(path.join(__dirname, 'password-test-server.mjs')).href);
  harness = await createPasswordTestServer({ origin: base.origin, publicStaticQA }); secrets.add(harness.env.CLAIM_PASSWORD_PEPPER);
  try {
    await backend();
    if (!process.argv.includes('--backend-only')) { await preload(); browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); await ui(); }
    for (const entry of pages) await stored(entry.page, entry.host);
    assert.equal(blocked.length, 0, 'no unmatched mutations or remote fallback'); assert.equal(harness.outboundBlocked.length, 0, 'real backend does not contact external services'); assert.equal(errors.length, 0, scrub(errors.join('; ')));
    pass('all bill APIs local, no external writes and no credential in result/URL/storage');
    const report = { result: 'PASS', tests: steps, metrics, publicStaticQA, localRealBackend: true, externalWrites: 0, screenshots: process.argv.includes('--backend-only') ? [] : ['initial-compact-name-code.png', 'auth-compact-name-code.png', 'inline-edit-code-cleared.png', 'inline-pin-edit-masked-code-cleared.png'] };
    await fs.writeFile(path.join(OUT, process.argv.includes('--backend-only') ? 'backend-report.json' : 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(`SUMMARY ${JSON.stringify({ result: 'PASS', tests: steps.length, localRealBackend: true, externalWrites: 0, evidence: OUT })}`);
  } catch (error) {
    const report = { result: 'FAIL', stage, error: scrub(error.stack || error), passed: steps, metrics, publicStaticQA, localRealBackend: true, blocked, apiStatuses: harness.requests.map(r => ({ method: r.method, path: r.path.split('?')[0], status: r.status })) };
    await fs.writeFile(path.join(OUT, 'failure.json'), JSON.stringify(report, null, 2) + '\n');
    const last = pages.filter(p => !p.host).at(-1); if (last) await shot(last.page, 'failure-masked').catch(() => {}); throw error;
  } finally { if (browser) await browser.close(); if (harness) await harness.close(); }
})().catch(error => { console.error(`FAIL ${stage}: ${scrub(error.stack || error)}`); process.exitCode = 1; });
