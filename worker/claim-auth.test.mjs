import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './src/worker-core.mjs';
import { ClaimAuth, forwardClaimAuth } from './src/claim-auth.mjs';

const ORIGIN = 'https://cw91020251212.github.io';
const PASSWORD = '秘密password🔒';
const OTHER_PASSWORD = 'replacement秘密';
const claim = (qty = 1, unit = '') => ({ id: '01', qty, unit, displayUnit: '' });
const input = (name = 'Alice', qty = 1, extra = {}) => ({ name, claims: [claim(qty)], ...extra });
const seed = (name = 'Alice', qty = 1, unit = '') => ({ v: 1, name, claims: [claim(qty, unit)] });

function environment() {
  const values = new Map();
  const objects = new Map();
  const env = {
    ALLOWED_ORIGINS: ORIGIN, SHARE_TTL_SECONDS: '604800', CLAIM_PASSWORD_PEPPER: 'test-only-secret-pepper-do-not-deploy',
    now: Date.now() + 5000, values, objects,
    BILL_SHARES: {
      async get(key) { return values.get(key)?.value ?? null; },
      async put(key, value, options) { values.set(key, { value, options }); },
      async delete(key) { values.delete(key); }
    }
  };
  env.CLAIM_AUTH = {
    idFromName(name) { return name; },
    get(id) {
      if (!objects.has(id)) {
        const data = new Map();
        const ctx = {
          data, scheduledAlarm: null, queue: Promise.resolve(),
          storage: {
            async get(key) { return structuredClone(data.get(key)); },
            async put(key, value) {
              if (typeof key === 'object') for (const [name, entry] of Object.entries(key)) data.set(name, structuredClone(entry));
              else data.set(key, structuredClone(value));
            },
            async deleteAll() { data.clear(); },
            async list({ prefix }) { return new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); },
            async setAlarm(time) { ctx.scheduledAlarm = time; },
            async deleteAlarm() { ctx.scheduledAlarm = null; }
          },
          blockConcurrencyWhile(callback) {
            const result = ctx.queue.then(callback, callback);
            ctx.queue = result.catch(() => {});
            return result;
          }
        };
        const object = new ClaimAuth(ctx, env);
        objects.set(id, { ctx, object, fetch: request => object.fetch(request) });
      }
      return objects.get(id);
    }
  };
  return env;
}
async function api(env, id, path = '', { method = 'GET', body, owner, ip = '203.0.113.1', now = env.now, origin = ORIGIN } = {}) {
  const request = new Request(`https://worker.test/api/shares${id ? `/${id}` : ''}${path}`, {
    method,
    headers: { Origin: origin, 'CF-Connecting-IP': ip, ...(owner ? { Authorization: `Bearer ${owner}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const response = await handleRequest(request, env, now);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function session(env = environment()) {
  const result = await api(env, null, '/sessions', { method: 'POST', body: { ttlDays: 1 } });
  assert.equal(result.status, 201);
  return { env, ...result.body };
}
const post = (env, id, op, body, options = {}) => api(env, id, `/claims/${op}`, { method: 'POST', body, ...options });
const status = (env, id, name) => api(env, id, `/claims/status?name=${encodeURIComponent(name)}`);
const inbox = (env, id, owner, after = 0) => api(env, id, `/claims/inbox?after=${after}`, { owner });
function members(env, id) { return [...env.objects.get(id).ctx.data].filter(([key]) => key.startsWith('member:')).map(([, member]) => member); }
function shareData(entries = [seed()], payer = 'Organizer') {
  const items = new Map();
  for (const entry of entries) for (const c of entry.claims) {
    if (!items.has(c.id)) items.set(c.id, { id: c.id, number: c.id, name: 'Tea', quantity: 10, unit: '杯', sourceAmount: 100, shares: [] });
    items.get(c.id).shares.push({ person: entry.name, quantity: c.qty, unit: c.unit || '份', isActualUnit: Boolean(c.unit), amount: 10 });
  }
  return { version: 2, bill: { payer, currency: 'HKD', billTotal: 10 }, participants: entries.map(entry => ({ name: entry.name, total: entry.claims.length ? 10 : 0 })), items: [...items.values()], adjustments: [], images: [] };
}
async function legacy(env = environment(), data = shareData()) {
  const created = await session(env);
  const record = JSON.parse(env.values.get(`share:${created.id}`).value);
  delete record.claimSecurity;
  record.status = 'ready';
  record.data = data;
  env.values.set(`share:${created.id}`, { value: JSON.stringify(record) });
  env.objects.delete(created.id); // Simulate a pre-migration session with no DO at all.
  return created;
}
function assertNoSecrets(body, secrets = []) {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /"(?:password|pepper|hash|salt|tickets|generation|writeKeyHash)"\s*:/);
  for (const secret of secrets) assert.ok(!text.includes(secret));
}

test('new sessions auto-enroll, unlock returns only own verified data, inbox is owner-only', async () => {
  const { env, id, writeToken, expiresAt } = await session();
  assert.equal(JSON.parse(env.values.get(`share:${id}`).value).claimSecurity, 'password');
  const unknown = await status(env, id, 'Alice');
  assert.deepEqual(Object.keys(unknown.body).sort(), ['claimSecurity', 'enabled', 'expiresAt', 'registered', 'requiresApproval', 'serverNow'].sort());
  assert.equal(unknown.body.enabled, true);
  assert.equal(unknown.body.requiresApproval, false);
  const missing = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD });
  assert.equal(missing.status, 409);
  assert.equal(missing.body.code, 'not_registered');
  const submitted = await post(env, id, 'submit', input('Alice', 2, { password: PASSWORD }));
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.revision, 1);
  assert.equal(submitted.body.payload.claims[0].qty, 2);
  const unlocked = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD });
  assert.equal(unlocked.status, 200);
  assert.match(unlocked.body.editToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(unlocked.body.tokenExpiresAt) <= env.now + 900000);
  assert.ok(Date.parse(unlocked.body.tokenExpiresAt) <= Date.parse(expiresAt));
  assert.equal(unlocked.body.payload.name, 'Alice');
  assert.equal((await inbox(env, id)).status, 403);
  assert.equal((await inbox(env, id, 'x'.repeat(43))).status, 403);
  const ownerInbox = await inbox(env, id, writeToken);
  assert.deepEqual(ownerInbox.body.updates, [{ ...submitted.body.payload, revision: 1 }]);
  assert.equal(ownerInbox.body.cursor, 1);
  assert.deepEqual((await inbox(env, id, writeToken, 1)).body.updates, []);
  const changed = await post(env, id, 'submit', input('Alice', 3, { editToken: unlocked.body.editToken }));
  assert.equal(changed.body.revision, 2);
  assert.deepEqual((await inbox(env, id, writeToken)).body.updates, [{ ...changed.body.payload, revision: 2 }]);
  assertNoSecrets(ownerInbox.body, [PASSWORD, env.CLAIM_PASSWORD_PEPPER]);
  assertNoSecrets(unlocked.body, [PASSWORD, env.CLAIM_PASSWORD_PEPPER]);
  assert.equal((await status(env, id, 'Alice')).body.registered, true);
});

test('wrong passwords reveal no payload and never mutate the claimed data or credentials', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 2, { password: PASSWORD }));
  const before = structuredClone(members(env, id));
  for (const op of ['unlock', 'submit']) {
    const denied = await post(env, id, op, input('Alice', 99, { password: OTHER_PASSWORD }));
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'wrong_password');
    assert.equal(denied.body.payload, undefined);
    assert.equal(denied.body.editToken, undefined);
    assertNoSecrets(denied.body, [PASSWORD, OTHER_PASSWORD]);
  }
  assert.deepEqual(members(env, id), before);
});

test('edit tickets cannot rename, cross names, or unlock private data without password', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  await post(env, id, 'submit', input('Bob', 2, { password: OTHER_PASSWORD }));
  const token = (await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.editToken;
  assert.equal((await post(env, id, 'submit', input('Bob', 99, { editToken: token }))).status, 403);
  assert.equal((await post(env, id, 'submit', input('Mallory', 99, { editToken: token }))).status, 400);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', editToken: token })).status, 403);
  assert.equal((await status(env, id, 'Mallory')).body.registered, false);
  assert.equal(members(env, id).find(member => member.payload.name === 'Bob').payload.claims[0].qty, 2);
});

test('first enrollment is serialized atomically, including NFC and whitespace-equivalent names', async () => {
  const { env, id } = await session();
  const attempts = await Promise.all([
    post(env, id, 'submit', input('  Jose\u0301   Chan  ', 1, { password: PASSWORD })),
    post(env, id, 'submit', input('José Chan', 99, { password: OTHER_PASSWORD }))
  ]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 403]);
  assert.equal(members(env, id).length, 1);
  assert.equal(members(env, id)[0].payload.name, 'José Chan');
  assert.equal(members(env, id)[0].payload.claims[0].qty, 1);
  assert.equal((await post(env, id, 'submit', input('josé Chan', 2, { password: PASSWORD }))).status, 200);
  assert.equal(members(env, id).length, 2); // Case remains exact.
});

test('names, passwords and claim bounds are strict and errors do not reserve names', async () => {
  const { env, id } = await session();
  for (const name of ['', 'x:y', 'x：y', 'x=y', 'x＝y', 'x\ny', 'x\ty', 'x\u0000y', 'x\u200by', 'x'.repeat(61)]) {
    assert.equal((await post(env, id, 'submit', input(name, 1, { password: PASSWORD }))).status, 400, name);
  }
  for (const password of ['short', 'x'.repeat(129)]) assert.equal((await post(env, id, 'submit', input('Alice', 1, { password }))).status, 400);
  const badClaims = [[], [claim(0)], [claim(-1)], [claim(1000001)], [{ ...claim(), id: '1' }], [claim(), claim()], [{ ...claim(), qty: '1' }], [{ ...claim(), unit: 'x'.repeat(31) }], [{ ...claim(), displayUnit: 'x'.repeat(31) }], Array.from({ length: 201 }, () => claim())];
  for (const claims of badClaims) assert.equal((await post(env, id, 'submit', { name: 'Alice', claims, password: PASSWORD })).status, 400);
  assert.equal((await post(env, id, 'submit', { ...input('Alice', 1, { password: PASSWORD }), clear: true })).status, 400);
  assert.equal(members(env, id).length, 0);
  assert.equal((await post(env, id, 'submit', { name: 'Alice', claims: [], clear: true, password: '🔒'.repeat(8) })).status, 200);
});

test('five failures persist across browsers and block both name+IP and overall session IP', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  await post(env, id, 'submit', input('Bob', 2, { password: OTHER_PASSWORD }));
  for (let i = 0; i < 5; i++) {
    const denied = await post(env, id, 'unlock', { name: 'Alice', password: OTHER_PASSWORD });
    assert.equal(denied.status, i === 4 ? 429 : 403);
  }
  const blocked = await post(env, id, 'unlock', { name: 'Bob', password: OTHER_PASSWORD });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.retryAfter, 900);
  assert.equal(blocked.headers.get('Retry-After'), '900');
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 429);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD }, { ip: '203.0.113.2' })).status, 200);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD }, { now: env.now + 900001 })).status, 200);
});

test('legacy unknown and reserved names cannot self-enroll before OR after owner setup', async () => {
  const { env, id, writeToken } = await legacy();
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { password: PASSWORD }))).body.code, 'protection_required');
  assert.equal((await post(env, id, 'submit', input('Unknown', 99, { password: PASSWORD }))).body.code, 'protection_required');
  assert.equal((await status(env, id, 'Unknown')).body.requiresApproval, true);
  const setup = await post(env, id, 'setup', { members: [seed('Alice', 99), seed('Bob', 2)] }, { owner: writeToken });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.cursor, 0);
  assert.equal(setup.body.members.find(member => member.name === 'Alice').requiresApproval, true);
  assert.equal(members(env, id).find(member => member.payload.name === 'Alice').payload.claims[0].qty, 1);
  assert.deepEqual((await inbox(env, id, writeToken)).body.updates, []);
  assert.equal((await post(env, id, 'submit', input('Unknown', 99, { password: PASSWORD }))).body.code, 'approval_required');
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.code, 'approval_required');
  const approved = await post(env, id, 'approve', { name: 'Unknown' }, { owner: writeToken });
  assert.match(approved.body.setupCode, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(approved.body.registered, false);
  const bound = await post(env, id, 'unlock', { name: 'Unknown', password: PASSWORD, setupCode: approved.body.setupCode });
  assert.equal(bound.status, 200);
  assert.deepEqual(bound.body.payload, { v: 1, name: 'Unknown', claims: [], clear: true });
  assert.equal((await post(env, id, 'submit', input('Unknown', 3, { editToken: bound.body.editToken }))).status, 200);
  assert.equal((await api(env, id)).body.claimSecurity, 'password');
});

test('owner code binding preserves legacy seed; setup is idempotent and cannot overwrite registered revisions', async () => {
  const { env, id, writeToken } = await legacy();
  await post(env, id, 'setup', { members: [] }, { owner: writeToken });
  const code = (await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken })).body.setupCode;
  const wrong = await post(env, id, 'submit', input('Alice', 99, { password: PASSWORD, setupCode: 'wrong-code' }));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.payload, undefined);
  assert.equal(members(env, id)[0].payload.claims[0].qty, 1);
  const bound = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: code });
  assert.equal(bound.body.payload.claims[0].qty, 1);
  assert.equal((await inbox(env, id, writeToken)).body.cursor, 0);
  const edited = await post(env, id, 'submit', input('Alice', 3, { editToken: bound.body.editToken }));
  await post(env, id, 'setup', { members: [seed('Alice', 50)] }, { owner: writeToken });
  assert.equal(members(env, id)[0].payload.claims[0].qty, 3);
  assert.deepEqual((await inbox(env, id, writeToken)).body.updates, [{ ...edited.body.payload, revision: 1 }]);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: code })).status, 409);
});

test('owner reset keeps old password until redemption, then revokes all old tickets and code replay', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'submit', input('Alice', 2, { password: PASSWORD }));
  const oldTicket = (await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.editToken;
  const approval = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken });
  assert.equal(approval.body.registered, true);
  assert.ok(Date.parse(approval.body.expiresAt) <= env.now + 600000);
  const beforeReset = await status(env, id, 'Alice');
  assert.equal(beforeReset.body.registered, true);
  assert.equal(beforeReset.body.requiresApproval, false);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 200);
  assert.equal((await post(env, id, 'submit', input('Alice', 2, { editToken: oldTicket }))).status, 200);
  const reset = await post(env, id, 'unlock', { name: 'Alice', password: OTHER_PASSWORD, setupCode: approval.body.setupCode });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.payload.claims[0].qty, 2);
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { editToken: oldTicket }))).status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: OTHER_PASSWORD, setupCode: approval.body.setupCode })).status, 409);
  assert.equal((await post(env, id, 'submit', input('Alice', 3, { editToken: reset.body.editToken }))).status, 200);
  assert.equal(members(env, id)[0].payload.claims[0].qty, 3);
});

test('codes are name-bound, expire, and replacement approvals invalidate prior codes without resetting passwords', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'setup', { members: [seed('Alice'), seed('Bob')] }, { owner: writeToken });
  const first = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken });
  assert.equal((await post(env, id, 'unlock', { name: 'Bob', password: PASSWORD, setupCode: first.body.setupCode })).status, 409);
  const second = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken });
  assert.notEqual(first.body.setupCode, second.body.setupCode);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: first.body.setupCode })).status, 409);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: second.body.setupCode }, { now: env.now + 600001 })).status, 409);
  assert.equal((await status(env, id, 'Alice')).body.registered, false);
  assert.equal(members(env, id).find(member => member.payload.name === 'Alice').payload.claims[0].qty, 1);
});

test('wrong codes share the persistent five-attempt password/IP budget', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'setup', { members: [seed('Alice')] }, { owner: writeToken });
  const code = (await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken })).body.setupCode;
  for (let i = 0; i < 5; i++) assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: 'wrong' })).status, i === 4 ? 429 : 409);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: code })).status, 429);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, setupCode: code }, { ip: '203.0.113.9' })).status, 200);
});

test('ticket and code lifetimes are constrained by session expiry; expired sessions delete private storage', async () => {
  const { env, id, writeToken, expiresAt } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  const nearEnd = Date.parse(expiresAt) - 1000;
  const token = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD }, { now: nearEnd });
  assert.equal(token.body.tokenExpiresAt, expiresAt);
  const approval = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken, now: nearEnd });
  assert.equal(approval.body.expiresAt, expiresAt);
  const expired = await post(env, id, 'submit', input('Alice', 99, { editToken: token.body.editToken }), { now: Date.parse(expiresAt) + 1 });
  assert.equal(expired.status, 410);
  assert.equal(env.objects.get(id).ctx.data.size, 0);
  assert.equal(env.values.has(`share:${id}`), false);
});

test('expired tickets cannot edit, and alarm deletes all session data rather than retaining credentials', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  const ticket = (await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.editToken;
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { editToken: ticket }), { now: env.now + 900001 })).status, 403);
  const { ctx, object } = env.objects.get(id);
  await object.alarm();
  assert.ok(ctx.data.size > 0);
  assert.equal(ctx.scheduledAlarm, ctx.data.get('meta').expiresAt);
  const meta = ctx.data.get('meta');
  meta.expiresAt = Date.now() - 1;
  await ctx.storage.put('meta', meta);
  await object.alarm();
  assert.equal(ctx.data.size, 0);
});

test('owner-only permission bounds, CORS, and original-body envelope spoofing cannot bypass auth', async () => {
  const { env, id, writeToken } = await session();
  for (const op of ['setup', 'approve']) {
    const denied = await post(env, id, op, { owner: true, sessionId: id, expiresAt: env.now + 999999999, now: 0, name: 'Alice', members: [seed()] });
    assert.equal(denied.status, 403);
  }
  assert.equal((await inbox(env, id, writeToken, -1)).status, 400);
  assert.equal((await api(env, id, '/claims/status?name=Alice', { origin: 'https://evil.test' })).status, 403);
  const forged = await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD, owner: true, op: 'setup', sessionId: 'x'.repeat(22), expiresAt: env.now + 999999999, now: 0 }));
  assert.equal(forged.status, 200);
  assert.equal(forged.body.serverNow, new Date(env.now).toISOString());
  assert.equal(forged.body.expiresAt, JSON.parse(env.values.get(`share:${id}`).value).expiresAt && new Date(JSON.parse(env.values.get(`share:${id}`).value).expiresAt).toISOString());
  const preflight = await handleRequest(new Request(`https://worker.test/api/shares/${id}/claims/submit`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('Durable Object private fetch rejects unsigned requests, and signed envelopes still enforce owner permission', async () => {
  const { env, id } = await session();
  const { object } = env.objects.get(id);
  const spoof = await object.fetch(new Request('https://claim-auth.internal/dispatch', { method: 'POST', body: JSON.stringify({ owner: true, op: 'inbox' }) }));
  assert.equal(spoof.status, 403);
  const record = JSON.parse(env.values.get(`share:${id}`).value);
  const notOwner = await forwardClaimAuth(env, { sessionId: id, expiresAt: record.expiresAt, now: env.now, op: 'inbox', owner: false, enabled: true, legacy: false });
  assert.equal(notOwner.status, 403);
  assert.equal((await handleRequest(new Request('https://worker.test/dispatch', { method: 'POST', body: '{}' }), env)).status, 404);
});

test('protected PUT rejects stale ntfy quantities, unknown identities and actual-unit mismatches including reserved baselines', async () => {
  const { env, id, writeToken } = await legacy(environment(), shareData([seed('Alice', 1, '杯'), seed('Bob', 2)]));
  await post(env, id, 'setup', { members: [] }, { owner: writeToken });
  const publish = data => api(env, id, '', { method: 'PUT', body: data, owner: writeToken, now: env.now + 2000 });
  const original = env.values.get(`share:${id}`).value;
  for (const entries of [[seed('Alice', 9, '杯'), seed('Bob', 2)], [seed('Alice', 1), seed('Bob', 2)], [seed('Alice', 1, '杯'), seed('Bob', 8)], [seed('Alice', 1, '杯'), seed('Bob', 2), seed('Mallory', 1)]]) {
    const denied = await publish(shareData(entries));
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'claims_outdated');
    assert.equal(env.values.get(`share:${id}`).value, original);
    assert.equal(denied.body.payload, undefined);
  }
  const correct = shareData([seed('Alice', 1, '杯'), seed('Bob', 2)]);
  correct.participants.push({ name: 'Organizer', total: 0 });
  assert.equal((await publish(correct)).status, 200);
  const unknownZero = structuredClone(correct);
  unknownZero.participants.push({ name: 'UnknownZero', total: 0 });
  assert.equal((await publish(unknownZero)).status, 409);
  const badPayer = structuredClone(correct);
  badPayer.participants.find(person => person.name === 'Organizer').total = 1;
  assert.equal((await publish(badPayer)).status, 409);
  assert.equal((await api(env, id, '', { method: 'PUT', body: correct, now: env.now + 4000 })).status, 403);
});

test('a new protected session cannot publish unknown positive claims; enrollment and manual reservation permit exact results', async () => {
  const { env, id, writeToken } = await session();
  const data = shareData([seed('Alice', 1), seed('Manual', 2)]);
  const publish = () => api(env, id, '', { method: 'PUT', body: data, owner: writeToken, now: env.now + 2000 });
  assert.equal((await publish()).status, 409);
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  await post(env, id, 'setup', { members: [seed('Manual', 2)] }, { owner: writeToken });
  assert.equal((await publish()).status, 200);
  await post(env, id, 'submit', { name: 'Alice', claims: [], clear: true, password: PASSWORD });
  assert.equal((await publish()).status, 409);
});

test('missing binding or pepper fails closed, but public non-session result shares retain old functionality', async () => {
  const { env, id, writeToken } = await session();
  delete env.CLAIM_PASSWORD_PEPPER;
  assert.equal((await api(env, null, '/sessions', { method: 'POST', body: { ttlDays: 1 } })).status, 503);
  assert.equal((await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }))).status, 503);
  assert.equal((await api(env, id, '', { method: 'PUT', body: shareData(), owner: writeToken, now: env.now + 2000 })).status, 503);
  const old = await api(env, null, '', { method: 'POST', body: shareData() });
  assert.equal(old.status, 201);
  assert.equal((await api(env, old.body.id)).status, 200);
  assert.equal((await post(env, old.body.id, 'submit', input('Alice', 1, { password: PASSWORD }))).status, 409);
  env.CLAIM_PASSWORD_PEPPER = 'test';
  delete env.CLAIM_AUTH;
  assert.equal((await api(env, null, '/sessions', { method: 'POST', body: { ttlDays: 1 } })).status, 503);
});

test('stored credentials use unique 16-byte salts and independently verified pepper-HMAC/PBKDF2 100k; only hashes store tickets and codes', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  await post(env, id, 'submit', input('Bob', 1, { password: PASSWORD }));
  const [alice, bob] = members(env, id);
  assert.equal(alice.password.salt.length, 32);
  assert.notEqual(alice.password.salt, bob.password.salt);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.CLAIM_PASSWORD_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prehash = await crypto.subtle.sign('HMAC', key, encoder.encode(PASSWORD));
  const base = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(alice.password.salt.match(/../g), pair => parseInt(pair, 16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, base, 256);
  assert.equal(Buffer.from(bits).toString('hex'), alice.password.hash);
  const ticket = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD });
  const approval = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken });
  const stored = JSON.stringify([...env.objects.get(id).ctx.data]);
  for (const secret of [PASSWORD, env.CLAIM_PASSWORD_PEPPER, ticket.body.editToken, approval.body.setupCode]) assert.ok(!stored.includes(secret));
  assertNoSecrets(ticket.body, [alice.password.hash, alice.password.salt]);
  assertNoSecrets(approval.body, [alice.password.hash, alice.password.salt]);
});

test('fetch enters blockConcurrencyWhile before reading or asynchronously verifying any envelope', async () => {
  const env = environment();
  const calls = [];
  const object = new ClaimAuth({ blockConcurrencyWhile(callback) { calls.push('block'); return callback(); } }, env);
  const denied = await object.fetch({
    url: 'https://claim-auth.internal/dispatch', method: 'POST', headers: new Headers(),
    async text() { calls.push('read'); return '{}'; }
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(calls, ['block', 'read']);
});

test('malformed existing-password attempts are wrong_password and consume the persistent quota', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  for (let i = 0; i < 5; i++) {
    const denied = await post(env, id, 'unlock', { name: 'Alice', password: i % 2 ? 'x'.repeat(129) : 'short' });
    assert.equal(denied.status, i === 4 ? 429 : 403);
    assert.equal(denied.body.code, i === 4 ? 'too_many_attempts' : 'wrong_password');
  }
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 429);
});

test('reserved submit redeems a single-use code atomically with the new payload and credential', async () => {
  const { env, id, writeToken } = await legacy();
  await post(env, id, 'setup', { members: [] }, { owner: writeToken });
  const code = (await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken })).body.setupCode;
  const submitted = await post(env, id, 'submit', input('Alice', 3, { password: PASSWORD, setupCode: code }));
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.revision, 1);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.payload.claims[0].qty, 3);
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { password: OTHER_PASSWORD, setupCode: code }))).status, 409);
  assert.equal(members(env, id)[0].payload.claims[0].qty, 3);
});

test('a false portion cannot be republished as actual units even when item and share units are empty', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  const data = shareData();
  data.items[0].unit = '';
  data.items[0].shares[0].unit = '';
  data.items[0].shares[0].isActualUnit = true;
  const denied = await api(env, id, '', { method: 'PUT', body: data, owner: writeToken, now: env.now + 2000 });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, 'claims_outdated');
});
