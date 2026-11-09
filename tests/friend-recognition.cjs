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
const A = 'QA無碼朋友', B = 'QA保護朋友', C = 'QA新暱稱', LATE = 'QA遲加入朋友';
const INITIAL_QTY = 1.234, REVISED_QTY = 1.2345;
const PIN = '0042', WRONG = '9937', SYMBOL_PIN = 'aZ#4', SYMBOL_WRONG = 'Az#4', PASSWORD = 'QA-legacy-password-2026!';
const secrets = new Set([PIN, WRONG, SYMBOL_PIN, SYMBOL_WRONG, PASSWORD]), owners = new Set(), steps = [], errors = [], blocked = [], pages = [], runtimes = new Map();
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
  for (const invalid of ['123', '12345', 'a#3']) status(await post(c.id, 'submit', payload('QA格式測試', 1, { recognitionCode: invalid })), 400, 'only blank or exactly four printable ASCII characters');
  status(await post(c.id, 'submit', payload(B, 1, { recognitionCode: PIN })), 200, 'leading-zero PIN first submit'); await kind(c.id, B, 'pin');
  for (const [n, code] of [WRONG, '', undefined].entries()) { const rejected = await post(c.id, 'unlock', { name: B, ...(code === undefined ? {} : { recognitionCode: code }) }, { ip: `203.0.113.${110 + n}` }); status(rejected, 403, 'wrong, blank or missing PIN retrieval denied'); assert.equal(rejected.body.code, 'wrong_recognition_code'); assert.equal(rejected.body.payload, undefined); secretFree(rejected.body); }
  status(await post(c.id, 'submit', payload(B, 99, { recognitionCode: '' }), { ip: '203.0.113.114' }), 403, 'blank cannot overwrite PIN member');
  const pin = remember(status(await post(c.id, 'unlock', { name: B, recognitionCode: PIN }), 200, 'correct 4-character numeric code retrieve'));
  assert.equal(pin.payload.claims[0].qty, 1);
  status(await post(c.id, 'submit', payload('QA符號認證', 1, { recognitionCode: SYMBOL_PIN })), 200, 'mixed-case symbol code enrollment');
  assert.equal((await post(c.id, 'unlock', { name: 'QA符號認證', recognitionCode: SYMBOL_WRONG })).status, 403, 'code comparison preserves case');
  assert.equal((await post(c.id, 'unlock', { name: 'QA符號認證', recognitionCode: SYMBOL_PIN })).status, 200, 'mixed-case symbol code unlock');
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
  await publish(c, [payload(A, 2), payload(B, 3), payload('QA舊密碼'), payload('QA符號認證', 1)]); secretFree(status(await call(c.id), 200, 'public result'));
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
  assert.equal(await code.getAttribute('inputmode'), 'text', 'recognition code uses a text keyboard');
  assert.equal(await code.getAttribute('autocapitalize'), 'none', 'letter case is preserved on mobile');
  assert.equal(await page.locator('#claim-password-repeat:visible').count(), 0, 'no repeated password field');
  assert(!/至少\s*8|at least\s*8|再輸入一次密碼|Enter the password again/i.test(await page.locator('#claim-content').innerText()), 'no visible mandatory-eight/password-repeat copy');
  const palette = await page.evaluate(() => {
    const style = selector => { const node = document.querySelector(selector); const css = getComputedStyle(node); return { border: css.borderTopColor, width: css.borderTopWidth, background: css.backgroundColor }; };
    return { panel: style('#claim-content .panel'), item: style('#claim-content .item-card'), input: style('#person-name'), unit: style('.unit-select'), page: getComputedStyle(document.body).backgroundColor };
  });
  const isDarkOutline = color => {
    const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
    return channels.length === 3 && channels.every(channel => channel < 128);
  };
  assert(isDarkOutline(palette.panel.border)); assert.equal(palette.panel.width, '1px');
  assert(isDarkOutline(palette.item.border)); assert(isDarkOutline(palette.input.border)); assert.equal(palette.input.width, '1px');
  assert(isDarkOutline(palette.unit.border)); assert.equal(palette.input.background, 'rgb(198, 212, 224)');
  assert.equal(palette.panel.background, 'rgb(213, 223, 232)');
  assert.equal(palette.page, 'rgb(188, 202, 215)');
  const lightPage = palette.page;
  await page.emulateMedia({ colorScheme: 'dark' });
  assert(isDarkOutline(await page.locator('#person-name').evaluate(node => getComputedStyle(node).borderTopColor)), 'OS dark preference retains a dark outline');
  assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), lightPage, 'friend claim page keeps its independent blue-gray surface');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px has no horizontal overflow');
  return code;
}
async function focusedCode(page, input, label) {
  await input.focus(); await input.pressSequentially(SYMBOL_PIN);
  assert.equal(await input.inputValue(), SYMBOL_PIN, `${label}: retains mixed-case letters and symbol`);
  const focused = await input.evaluate(n => ({ scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(focused.scrollLeft, 0, `${label}: caret at end must not scroll first digit out of view`);
  assert(focused.scrollWidth <= focused.clientWidth, `${label}: four characters fit while focused`);
  await input.fill(SYMBOL_PIN); await input.press('End');
  const pasted = await input.evaluate(n => ({ value: n.value, scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(pasted.value, SYMBOL_PIN, `${label}: accepts mixed-case letters and symbol`);
  assert.equal(pasted.scrollLeft, 0, `${label}: pasted value remains visible with caret at end`);
  assert(pasted.scrollWidth <= pasted.clientWidth, `${label}: pasted digits fit the compact field`);
  await input.press('End'); assert.equal(await input.inputValue(), SYMBOL_PIN);
  await input.press('Backspace'); assert.equal(await input.inputValue(), SYMBOL_PIN.slice(0, -1));
  await input.pressSequentially(SYMBOL_PIN.slice(-1)); assert.equal(await input.inputValue(), SYMBOL_PIN);
  await input.blur(); assert.equal(await input.inputValue(), SYMBOL_PIN, `${label}: blur preserves case`);
  await input.focus(); assert.equal(await input.inputValue(), SYMBOL_PIN, `${label}: refocus preserves case`);
  const refocused = await input.evaluate(n => ({ scrollLeft: n.scrollLeft, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  assert.equal(refocused.scrollLeft, 0, `${label}: refocus keeps first digit visible`);
  await input.fill('');
  pass(`${label}: mixed-case letters and symbols fit; delete, retype, blur and refocus work`);
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
  if (!r.input.editToken) { assert.equal(r.input.recognitionCode, codeValue, 'first submit sends explicit blank or four characters'); assert.equal(r.input.password, undefined); }
  else { assert.equal(r.input.password, undefined); assert.equal(r.input.recognitionCode, undefined, 'authorized editor sends editToken only, not replacement credentials'); }
  assert.equal(await page.locator('iframe.same-link-result').isVisible(), false, 'old result hidden pending recalculation'); await stored(page); return before;
}
async function hostFixture() {
  const host = await pageFor('host', true); await host.goto(new URL('index.html', site).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await host.getByTestId('scan-start').waitFor({ state: 'visible' });
  const step1Accent = await host.getByTestId('scan-start').evaluate(el => getComputedStyle(el).borderLeftColor);
  assert.equal(step1Accent, 'rgb(116, 121, 142)', 'Step 1 work area uses its grey-violet accent');
  await host.getByTestId('toggle-receipt-text-import').click();
  await host.getByTestId('receipt-text-draft').fill(JSON.stringify({ items: [{ name: 'QA茶', nameEn: 'QA tea', original: 'QA茶', ja: '', price: 100, qty: 1, totalQty: null, unit: '', total: 100 }], adjustments: [], taxTotal: 0, taxNote: '', currency: 'HKD', date: null, receiptTotal: 100 }));
  await host.getByTestId('submit-receipt-text').click();
  await host.waitForFunction(() => document.querySelector('[data-live-app] main')?.dataset.currentStep === '2', null, { timeout: 30000 });
  assert.match(await host.getByTestId('verify-item').innerText(), /QA茶/, 'external AI JSON becomes the normal item-review source');
  await host.getByTestId('imported-receipt-attachment-card').waitFor({ state: 'visible' });
  await host.waitForTimeout(150);
  const entryPosition = await host.evaluate(() => {
    const section = document.querySelector('[data-testid="items-step"]');
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    return { scrollY: window.scrollY, sectionTop: section?.getBoundingClientRect().top, headerBottom };
  });
  await host.waitForTimeout(1900);
  const settledScrollY = await host.evaluate(() => window.scrollY);
  assert(entryPosition.sectionTop >= entryPosition.headerBottom && entryPosition.sectionTop - entryPosition.headerBottom <= 60, `text/JSON import stays at the top of step 2 instead of auto-scrolling to sharing: ${JSON.stringify(entryPosition)}`);
  assert(Math.abs(settledScrollY - entryPosition.scrollY) < 4, 'the step-2 viewport stays at the top while the user reviews the receipt attachment');
  const attachmentRect = await host.getByTestId('imported-receipt-attachment-card').boundingBox();
  const viewportHeight = await host.evaluate(() => innerHeight);
  assert(attachmentRect && attachmentRect.y < viewportHeight, 'the original-receipt attachment panel appears at the step-2 entry');
  assert.equal(await host.getByTestId('claim-expiry-days').inputValue(), '14', 'new activities default claim links to 14 days');
  await host.getByTestId('claim-activity-name').fill('QA識別碼驗收');
  const nextSettings = host.getByTestId('activity-settings-next');
  assert.equal(await nextSettings.innerText(), '下一步', 'activity settings button is labeled next step');
  await nextSettings.scrollIntoViewIfNeeded();
  await host.evaluate(() => {
    window.__stepNextScrollFrames = [];
    const nativeScrollTo = window.scrollTo.bind(window);
    window.scrollTo = (...args) => {
      const top = typeof args[0] === 'object' ? args[0].top : args[1];
      if (Number.isFinite(top)) window.__stepNextScrollFrames.push({ time: performance.now(), top });
      return nativeScrollTo(...args);
    };
  });
  const beforeNextScroll = await host.evaluate(() => window.scrollY);
  await nextSettings.click();
  await host.waitForFunction(() => {
    const target = document.querySelector('[data-testid="go-to-payer"]');
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const statusTop = document.querySelector('div.fixed.bottom-0[role="status"]')?.getBoundingClientRect().top || innerHeight;
    return rect.top >= 0 && rect.bottom <= statusTop - 8;
  }, null, { timeout: 8000 });
  await host.waitForTimeout(2000);
  const nextScrollMetrics = await host.evaluate(() => ({
    scrollY: window.scrollY,
    frames: window.__stepNextScrollFrames
  }));
  assert(nextScrollMetrics.scrollY > beforeNextScroll, 'activity next moves down to the original green step-2 next action');
  assert(nextScrollMetrics.frames.length > 2, 'activity next uses an animated scroll rather than a jump');
  assert(nextScrollMetrics.frames.at(-1).time - nextScrollMetrics.frames[0].time >= 1600, 'step-2 downward movement is deliberately slow');
  assert.equal(await host.getByTestId('go-to-payer').innerText().then(text => text.trim().startsWith('下一步')), true, 'the original green next-step CTA remains available and is not activated automatically');
  assert.equal(await host.getByTestId('claim-activity-name').isDisabled(), false, 'activity name remains editable until a link is actually shared');
  assert.equal(await host.getByTestId('claim-inbox').isVisible(), true, 'claim inbox is on Step 2');
  assert.equal(await host.getByTestId('claim-replies').isVisible(), true, 'manual reply field is on Step 2');
  const step2Accent = await host.getByTestId('items-step').evaluate(el => getComputedStyle(el).borderLeftColor);
  assert.equal(step2Accent, 'rgb(109, 104, 176)', 'Step 2 work area uses its lavender accent');
  await host.getByTestId('go-to-payer').click();
  await until(async () => await host.getByPlaceholder('輸入姓名', { exact: true }).isVisible(), 'can advance to payer before friends reply');
  assert.equal(await host.getByTestId('claim-inbox').count(), 0, 'claim inbox is not duplicated on Step 3');
  assert.equal(await host.getByTestId('claim-replies').count(), 0, 'reply field is not duplicated on Step 3');
  const step3Accent = await host.getByTestId('calculation-step').evaluate(el => getComputedStyle(el).borderLeftColor);
  assert.equal(step3Accent, 'rgb(169, 121, 34)', 'Step 3 work area uses its amber accent');
  assert.equal(await host.getByTestId('calculate-split').isDisabled(), true, 'report remains disabled before any friend reply');
  assert.match(await host.getByTestId('calculate-split-hint').innerText(), /按下後會計算並產生分帳報告/, 'disabled CTA still explains its action');
  await host.getByPlaceholder('輸入姓名', { exact: true }).fill('QA墊支人');
  assert.equal(await host.getByTestId('receipt-currency-control').isVisible(), true, 'organizer can fill currency before replies');
  const sectionOrder = await host.evaluate(() => {
    const entries = [
      ['payer', 'input[placeholder="輸入姓名"]'],
      ['currency', '[data-testid="receipt-currency-control"]'],
      ['payment', '[data-testid="payment-methods"]'],
      ['fee-split', '[data-tutorial-target="tax-method"]'],
      ['report', '[data-testid="calculate-split"]']
    ].map(([name, selector]) => ({ name, node: document.querySelector(selector) }));
    return {
      missing: entries.filter(entry => !entry.node).map(entry => entry.name),
      order: entries.filter(entry => entry.node).sort((a, b) => a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).map(entry => entry.name)
    };
  });
  assert.deepEqual(sectionOrder.missing, [], 'all settlement controls are present');
  assert.deepEqual(sectionOrder.order, ['payer', 'currency', 'payment', 'fee-split', 'report'], 'Step 3 keeps settlement settings before the report action');
  await host.locator('.step-nav').getByRole('button', { name: '各自認帳' }).click();
  await until(async () => await host.getByTestId('claim-expiry-days').isVisible(), 'can return to Step 2 replies');
  assert.equal(await host.getByTestId('claim-inbox').count(), 1, 'inbox is available once on Step 2');
  assert.equal(await host.getByTestId('claim-replies').count(), 1, 'reply field is available once on Step 2');
  await host.getByTestId('claim-activity-name').fill('QA識別碼驗收'); await host.getByTestId('claim-expiry-days').selectOption('1'); const before = harness.requests.length;
  assert.equal((await host.getByTestId('copy-friend-claim-link').innerText()).trim(), '複製連結給朋友');
  assert.equal((await host.getByTestId('open-claim-share-button').innerText()).trim(), '分享連結及附件給朋友');
  await host.getByTestId('copy-friend-claim-link').click(); await host.waitForFunction(() => Boolean(document.querySelector('[data-testid="claim-link-actions"]')?.dataset.claimLink));
  const link = await host.getByTestId('claim-link-actions').evaluate(n => n.dataset.claimLink), c = remember(harness.requests.slice(before).find(r => r.path === '/api/shares/sessions' && r.status === 201)?.output);
  assert(c, 'actual host creates real session'); assert.equal(c.claimSecurity, 'password'); assert.equal(new URL(link).searchParams.get('session'), c.id); secretFree(link); return { host, c, link };
}
async function hostSettle(fixture, qty, initial = false, names = [A, B]) {
  const { host, c, link } = fixture;
  if (!host) return publish(c, [payload(A, qty), payload(B)]);
  await host.bringToFront(); await host.evaluate(() => window.dispatchEvent(new Event('focus')));
  const claimsNav = host.locator('.step-nav').getByRole('button', { name: '各自認帳' });
  const calcNav = host.locator('.step-nav').getByRole('button', { name: '分帳運算' });
  await until(async () => {
    const refresh = host.getByTestId('claim-inbox-refresh');
    if (!await refresh.count()) { if (await claimsNav.count()) await claimsNav.click(); return false; }
    if (!await refresh.isEnabled()) return false;
    try { await refresh.click({ timeout: 1000 }); return true; }
    catch (error) { if (!await refresh.count()) return false; throw error; }
  }, 'owner refresh current inbox on Step 2');
  await until(async () => { const replies = host.getByTestId('claim-replies'); if (!await replies.count()) { if (await claimsNav.count()) await claimsNav.click(); return false; } const text = await replies.inputValue(); return names.every(name => text.includes(`姓名：${name}`)) && Number(text.split(`姓名：${A}`)[1]?.match(/認帳份數\s*=\s*([\d.]+)/)?.[1]) === qty; }, 'host sees one exact current revision');
  const text = await host.getByTestId('claim-replies').inputValue(); assert.equal(text.split(`姓名：${A}`).length - 1, 1); secretFree(text);
  if (await calcNav.count()) await calcNav.click();
  await until(async () => await host.getByTestId('calculate-split').isEnabled(), 'friend replies enable report generation on Step 3');
  assert.match(await host.getByTestId('calculate-split-hint').innerText(), /朋友可在原本連結查看結果/, 'shared-link CTA explains friends can view the result at their original link');
  const ctaStyles = await host.getByTestId('calculate-split').evaluate(button => {
    const hint = button.querySelector('[data-testid="calculate-split-hint"]');
    return { color: getComputedStyle(button).color, textShadow: getComputedStyle(button).textShadow, hintTextShadow: getComputedStyle(hint).textShadow, hintFilter: getComputedStyle(hint).filter };
  });
  assert.equal(ctaStyles.color, 'rgb(0, 0, 0)', 'active primary button uses black text');
  assert.equal(ctaStyles.textShadow, 'none', 'black button text has no text shadow');
  assert.equal(ctaStyles.hintTextShadow, 'none', 'CTA hint text has no text shadow');
  assert.equal(ctaStyles.hintFilter, 'none', 'CTA hint text has no drop shadow');
  const payer = host.getByPlaceholder('輸入姓名', { exact: true }); if (await payer.inputValue() !== A) await payer.fill(A);
  const before = harness.requests.length;
  await host.getByTestId('calculate-split').click();
  await until(async () => await host.getByTestId('results-step').count(), 'Step 4 results surface appears');
  const step4Accent = await host.getByTestId('results-step').evaluate(el => getComputedStyle(el).borderLeftColor);
  assert.equal(step4Accent, 'rgb(95, 152, 115)', 'Step 4 work area uses its light-green accent');
  // The organizer explicitly recalculates; the application then publishes the
  // original session automatically, without any test-side result PUT.
  await until(() => harness.requests.slice(before).some(r => r.id === c.id && r.method === 'PUT' && r.status === 200 && r.input?.items?.[0]?.shares?.find(s => s.person === A)?.quantity === qty && names.every(name => r.input.participants.some(p => p.name === name))), 'host recalculation publishes original-session PUT', 35000);
  const request = harness.requests.slice(before).find(r => r.id === c.id && r.method === 'PUT' && r.status === 200); assert.equal(request.authorization, `Bearer ${c.writeToken}`); secretFree(request.input);
  assert.equal(harness.record(c.id).data.items[0].shares.find(s => s.person === A).quantity, qty); await stored(host, true);
  const webBeforeFallback = await host.evaluate(() => {
    const web = document.querySelector('[data-testid="friend-network-option"]');
    const fallback = document.querySelector('[data-testid="report-fallback-options"]');
    return Boolean(web && fallback && (web.compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert.equal(webBeforeFallback, true, 'preferred web option appears before collapsed text backups');
  const friendLink = host.getByTestId('friend-share-open');
  assert.equal(await friendLink.getAttribute('href'), link, 'clickable href remains the complete original friend link');
  const visibleUrl = await host.getByTestId('friend-share-url-display').innerText();
  assert(visibleUrl.length < link.length, 'visible URL is shortened');
  if (link.length > 52) assert.match(visibleUrl, /…/, 'long URL is shortened with a middle ellipsis');
  assert.equal(await host.getByTestId('final-summary-preview').count(), 0, 'fallback reports are collapsed by default');
  assert.equal(await host.getByTestId('friend-web-preferred-badge').innerText(), '首選・網頁');
  assert.equal(await host.getByTestId('friend-web-intro').innerText(), '同一連結');
  assert.match(await host.getByTestId('friend-network-option').innerText(), /認帳＋結果/);
  assert.equal((await host.getByTestId('friend-share-privacy-note').innerText()).trim(), '持連結者可看帳單及收據。');
  const backups = host.getByTestId('report-fallback-options');
  await backups.getByRole('button').click();
  await host.getByTestId('final-summary-preview').waitFor({ state: 'visible' });
  await host.getByTestId('final-detail-preview').waitFor({ state: 'visible' });
  assert.equal(await host.getByTestId('summary-report-actions').getByRole('button', { name: '分享' }).count(), 1);
  assert.equal(await host.getByTestId('detail-report-actions').getByRole('button', { name: '分享' }).count(), 1);
  assert.doesNotMatch(await backups.innerText(), /網頁版是首選|後備方案（簡單版／詳細版）/);
}
async function ui() {
  stage = 'actual host and compact optional initial form';
  const fixture = process.argv.includes('--friends-only') ? await (async () => { const c = await create(); return { c, link: linkFor(c), host: null }; })() : await hostFixture();
  const { c, link } = fixture, a = await pageFor('blank friend'), b = await pageFor('PIN friend');
  await a.goto(link, { waitUntil: 'domcontentloaded' }); await a.locator('#claim-content').waitFor({ state: 'visible' }); await a.locator('#person-name').fill(A);
  const code = await compactInitial(a); assert.equal(await code.inputValue(), ''); await focusedCode(a, code, 'new claim');
  const random = await visible(a, '#random-code');
  const randomBox = await random.boundingBox(); assert(randomBox.width <= 52 && randomBox.height <= 52, 'random control is tiny'); await random.click(); const generated = await code.inputValue(); assert.match(generated, /^[!-~]{4}$/); secrets.add(generated); await code.fill(''); assert.equal(await code.inputValue(), '');
  await shot(a, 'initial-compact-name-code'); await submit(a, c, '', INITIAL_QTY); assert.equal(a.url(), link);
  await b.goto(link, { waitUntil: 'domcontentloaded' }); await b.locator('#claim-content').waitFor({ state: 'visible' }); await b.locator('#person-name').fill(B); const bCode = await firstCode(b); await bCode.fill(SYMBOL_PIN); await b.locator('#qty-0').fill('1'); await stored(b); assert.equal(await bCode.inputValue(), SYMBOL_PIN, 'draft storage check happens while code is still entered'); await submit(b, c, SYMBOL_PIN, 1); assert.equal(await bCode.inputValue(), '', 'successful enrollment clears recognition code');
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
  await hostSettle(fixture, INITIAL_QTY, true);
  assert.equal(await fixture.host.getByTestId('share-receipt-images').count(), 0, 'externally imported receipt photos do not use a separate share action');
  const receiptSample = await fs.readFile(path.join(__dirname, 'fixtures', 'card-redaction-synthetic.png'));
  const photoPublishStart = harness.requests.length;
  await fixture.host.getByTestId('attach-receipt-image').click();
  await fixture.host.getByTestId('receipt-attachment-input').setInputFiles({ name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: receiptSample });
  await fixture.host.getByTestId('receipt-attachment-only-hint').waitFor({ state: 'visible' });
  assert.match(await fixture.host.getByTestId('receipt-attachment-only-hint').innerText(), /同一條連結|same link/);
  await fixture.host.getByTestId('redaction-next-or-finish').click();
  await until(() => harness.record(c.id)?.data?.images?.length === 1, 'redacted photo is published into the existing result record', 25000);
  assert.equal((await fixture.host.getByTestId('saved-record-photo-note').innerText()).trim(), '相片只存此機。');
  const photoPublish = harness.requests.slice(photoPublishStart).find(r => r.id === c.id && r.method === 'PUT' && r.status === 200 && r.input?.images?.length === 1);
  assert(photoPublish, 'photo is written into the same existing share session');
  assert.equal(photoPublish.input.images[0].mimeType, 'image/jpeg', 'the redacted photo is compressed before sharing');
  await until(async () => /已更新/.test(await fixture.host.getByTestId('same-link-sync-status').innerText()), 'same-link photo update finishes');
  await result(a, A); pass('same-link inline photo publication plus 390px optional/auth fields, random/clear, blank and PIN enrollments, initial retrieve and pending-claim preservation');
  stage = 'blank identity inline retrieve and revision';
  const blank = await gate(a, A); assert.equal(await blank.inputValue(), ''); await a.locator('#auth-confirm').click(); await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#qty-0').inputValue(), String(INITIAL_QTY));
  assert.equal(await (await firstCode(a)).inputValue(), '', 'unlock does not restore recognition code'); await shot(a, 'inline-edit-code-cleared');
  const before = await submit(a, c, '', REVISED_QTY); assert.equal(a.url(), link);
  assert.equal(harness.record(c.id).data.items[0].shares.find(s => s.person === A).quantity, INITIAL_QTY, 'old published allocation remains until host resettles');
  await until(() => harness.requests.slice(before).some(r => r.id === c.id && r.method === 'GET' && r.path === endpoint(c.id) && r.output?.status === 'ready'), 'friend polls stale full-precision result', 10000);
  assert.equal(await a.locator('iframe.same-link-result').isVisible(), false, '1.234 stale result does not match 1.2345 revision');
  await hostSettle(fixture, REVISED_QTY); await result(a, A); assert.equal(a.url(), link); await stored(a); pass('blank-name retrieval, ticket-only revision, exact 1.234 to 1.2345 matching and automatic host resettlement on original URL');
  stage = 'new friend can join after published result on the original link';
  const late = await pageFor('late friend after published result');
  await late.goto(link, { waitUntil: 'domcontentloaded' });
  await late.locator('iframe.same-link-result:not([hidden])').waitFor({ state: 'visible' });
  const lateAddPanel = late.locator('#result-add-person-panel'); await lateAddPanel.waitFor({ state: 'visible' });
  assert.match(await lateAddPanel.innerText(), /漏咗朋友/, 'published result clearly offers a late-person action');
  await late.locator('#result-language-toggle').click();
  await late.waitForFunction(() => document.getElementById('result-add-person-title')?.textContent.includes('Forgot someone?'));
  await late.locator('#result-language-toggle').click();
  await late.waitForFunction(() => document.getElementById('result-add-person-title')?.textContent.includes('漏咗朋友'));
  assert.match(await fixture.host.getByTestId('add-missing-person-guide').innerText(), /新增一位/, 'organizer keeps the concise same-link late claim path');
  await fixture.host.getByTestId('return-to-claim-inbox').click();
  await fixture.host.getByTestId('claim-inbox-refresh').waitFor({ state: 'visible' });
  await late.getByTestId('add-another-person').click();
  await late.locator('#claim-content').waitFor({ state: 'visible' });
  await late.locator('#person-name').fill(LATE);
  await submit(late, c, '', 1);
  assert.equal(late.url(), link, 'adding a new person does not change the original link');
  await hostSettle(fixture, REVISED_QTY, false, [A, B, LATE]);
  const lateResult = await result(late, LATE);
  await lateResult.locator('#receipt-content img').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await lateResult.locator('#receipt-content img').count(), 1, 'the same result link renders the redacted receipt below the bill');
  assert.equal(late.url(), link, 'recalculated result returns on the same original URL');
  pass('published result has a bilingual add-person CTA and inline receipt; a new friend submits on the same link; organizer refreshes and republishes all claims');
  stage = 'PIN identity denial, forgot options, retry and new nickname';
  let entered = await gate(a, B); await entered.fill(SYMBOL_WRONG); const denyStart = harness.requests.length; await a.locator('#auth-confirm').click();
  await until(() => harness.requests.slice(denyStart).some(r => r.path.endsWith('/claims/unlock') && r.status === 403), 'wrong PIN rejected'); assert.equal(await a.locator('#claim-content').isVisible(), false); assert.equal(await entered.inputValue(), '', 'wrong-code retry clears code');
  const reset = await visible(a, '#auth-reset,#auth-forgot'); await reset.click();
  const panel = a.locator('#claim-auth-panel'); assert((await panel.boundingBox()).height <= 520, 'forgot options remain inline, not a giant card');
  assert(/新.*(?:暱稱|名字|姓名)|new.*(?:nickname|name)/i.test(await panel.innerText()), 'forgot offers new nickname');
  const retry = await visible(a, '#auth-retry,[data-testid="auth-retry"]'); await retry.click(); assert.equal(await (await authCode(a)).inputValue(), '', 'retry clears recognition code');
  if (!await a.locator('#auth-recovery').isVisible()) await (await visible(a, '#auth-reset,#auth-forgot')).click(); await (await visible(a, '#auth-new-name,#auth-new-nickname,[data-testid="auth-new-nickname"]')).click();
  await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#person-name').inputValue(), '', 'new nickname starts blank'); assert.equal(await a.locator('#person-name').evaluate(n => n.readOnly), false); assert.equal(await (await firstCode(a)).inputValue(), '');
  const protectedOwn = status(await post(c.id, 'unlock', { name: B, recognitionCode: SYMBOL_PIN }, { ip: '203.0.113.244' }), 200, 'new nickname flow leaves protected record untouched'); assert.equal(protectedOwn.payload.claims[0].qty, 1);
  await a.locator('#person-name').fill(C); await submit(a, c, '', 1); await kind(c.id, C, 'none'); await kind(c.id, B, 'pin');
  if (!fixture.host) await publish(c, [payload(A, REVISED_QTY), payload(B), payload(C)]);
  else await hostSettle(fixture, REVISED_QTY, false, [A, B, C, LATE]);
  await result(a, B);
  entered = await gate(a, B); await entered.fill(SYMBOL_PIN); await a.locator('#auth-confirm').click(); await a.locator('#claim-content').waitFor({ state: 'visible' }); assert.equal(await a.locator('#qty-0').inputValue(), '1'); assert.equal(await (await authCodeIfPresent(a)), '', 'verified PIN clears input');
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
