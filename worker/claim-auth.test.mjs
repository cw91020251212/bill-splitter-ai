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
    items.get(c.id).shares.push({ person: entry.name, quantity: c.mode === 'shared' && c.shareExplicit !== true ? 0 : c.qty,
      unit: c.mode === 'shared' ? '' : c.unit || '份', isActualUnit: Boolean(c.unit), amount: 10,
      claimMode: c.mode === 'shared' ? 'shared' : '', shareExplicit: c.shareExplicit === true });
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
  assert.doesNotMatch(text, /"(?:password|recognitionCode|pepper|hash|salt|tickets|generation|writeKeyHash)"\s*:/);
  for (const secret of secrets) assert.ok(!text.includes(secret));
}

test('new sessions auto-enroll, unlock returns only own verified data, inbox is owner-only', async () => {
  const { env, id, writeToken, expiresAt } = await session();
  assert.equal(JSON.parse(env.values.get(`share:${id}`).value).claimSecurity, 'password');
  const unknown = await status(env, id, 'Alice');
  assert.deepEqual(Object.keys(unknown.body).sort(), ['claimSecurity', 'credentialKind', 'enabled', 'expiresAt', 'registered', 'requiresApproval', 'serverNow'].sort());
  assert.equal(unknown.body.credentialKind, 'new');
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

test('edit tickets cannot rename or cross names; valid own tickets can unlock', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  await post(env, id, 'submit', input('Bob', 2, { password: OTHER_PASSWORD }));
  const token = (await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.editToken;
  assert.equal((await post(env, id, 'submit', input('Bob', 99, { editToken: token }))).status, 403);
  assert.equal((await post(env, id, 'submit', input('Mallory', 99, { editToken: token }))).status, 400);
  assert.equal((await post(env, id, 'unlock', { name: 'Bob', editToken: token })).status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', editToken: token })).status, 200);
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

test('shared blank and explicit claims survive submission and published-result verification', async () => {
  for (const sharedClaim of [
    { id: '01', qty: 0, unit: '', displayUnit: '', mode: 'shared', shareExplicit: false },
    { id: '01', qty: 1, unit: '', displayUnit: '', mode: 'shared', shareExplicit: true }
  ]) {
    const { env, id, writeToken } = await session();
    const submitted = await post(env, id, 'submit', { name: 'Alice', claims: [sharedClaim], password: PASSWORD });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.payload.claims[0].mode, 'shared');
    assert.equal(submitted.body.payload.claims[0].shareExplicit, sharedClaim.shareExplicit);
    const published = await api(env, id, '', { method: 'PUT', body: shareData([submitted.body.payload]), owner: writeToken, now: env.now + 2000 });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual((await inbox(env, id, writeToken)).body.updates[0].claims, submitted.body.payload.claims);
  }
  const { env, id } = await session();
  for (const bad of [
    { id: '01', qty: 0, unit: '', mode: 'shared' },
    { id: '01', qty: 0, unit: '', mode: 'shared', shareExplicit: true },
    { id: '01', qty: 1, unit: '', mode: 'shared', shareExplicit: false },
    { id: '01', qty: 1, unit: '杯', mode: 'shared', shareExplicit: true }
  ]) {
    assert.equal((await post(env, id, 'submit', { name: 'Alice', claims: [bad], password: PASSWORD })).status, 400);
  }
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

test('enabled legacy unknown and reserved names enroll without per-name owner approval', async () => {
  const { env, id, writeToken } = await legacy();
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { password: PASSWORD }))).body.code, 'protection_required');
  assert.equal((await post(env, id, 'submit', input('Unknown', 99, { password: PASSWORD }))).body.code, 'protection_required');
  assert.equal((await status(env, id, 'Unknown')).body.requiresApproval, false);
  const setup = await post(env, id, 'setup', { members: [seed('Alice', 99), seed('Bob', 2)] }, { owner: writeToken });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.cursor, 0);
  assert.equal(setup.body.members.find(member => member.name === 'Alice').requiresApproval, false);
  assert.equal(setup.body.members.find(member => member.name === 'Alice').credentialKind, 'reserved');
  assert.equal(members(env, id).find(member => member.payload.name === 'Alice').payload.claims[0].qty, 1);
  assert.deepEqual((await inbox(env, id, writeToken)).body.updates, []);
  const unknown = await post(env, id, 'unlock', { name: 'Unknown', recognitionCode: '' });
  assert.equal(unknown.body.code, 'not_registered');
  assert.equal(members(env, id).length, 2);
  assert.equal((await post(env, id, 'submit', input('Unknown', 99, { recognitionCode: '' }))).status, 200);
  const bound = await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '' });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.payload.claims[0].qty, 1);
  assert.equal((await status(env, id, 'Alice')).body.registered, false);
  assert.equal((await post(env, id, 'submit', input('Alice', 3, { recognitionCode: '' }))).status, 200);
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'none');
  assert.equal((await status(env, id, 'Alice')).body.registered, true);
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

// R105 lightweight recognition: these tests only use the in-memory environment above.
test('blank initial submit registers none; name-only unlock and revisions deliberately remain low assurance', async () => {
  const { env, id, writeToken } = await session();
  const initial = await post(env, id, 'submit', input('Alice', 1.125, { recognitionCode: '' }));
  assert.equal(initial.status, 200);
  assert.equal(initial.body.revision, 1);
  const summary = (await status(env, id, 'Alice')).body;
  assert.equal(summary.credentialKind, 'none');
  assert.equal(summary.registered, true);
  assert.equal(summary.requiresApproval, false);
  assert.equal(summary.claimSecurity, 'password');
  const stored = members(env, id)[0];
  assert.equal(stored.credentialKind, 'none');
  assert.equal(stored.password, undefined);
  assert.equal(stored.recognitionCode, undefined);
  const unlocked = await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '' }, { ip: '203.0.113.22' });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.body.payload.claims[0].qty, 1.125);
  const revised = await post(env, id, 'submit', input('Alice', 2.875, { recognitionCode: '' }));
  assert.equal(revised.status, 200);
  assert.equal(revised.body.revision, 2);
  assert.equal((await post(env, id, 'submit', input('Alice', 3.25, { recognitionCode: '', editToken: unlocked.body.editToken }))).status, 200);
  const ownerInbox = await inbox(env, id, writeToken);
  assert.equal(ownerInbox.body.updates[0].revision, 3);
  assert.equal(ownerInbox.body.updates[0].claims[0].qty, 3.25);
  assert.deepEqual(ownerInbox.body.members, [{ name: 'Alice', credentialKind: 'none', registered: true, requiresApproval: false }]);
  assertNoSecrets(summary);
  assertNoSecrets(ownerInbox.body);
  assertNoSecrets(unlocked.body);
});

test('optional four-digit PIN preserves leading zeroes, registers, and authorizes only correct code or own ticket', async () => {
  const { env, id } = await session();
  const code = '0042';
  assert.equal((await post(env, id, 'submit', input('Alice', 2, { recognitionCode: code }))).status, 200);
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'pin');
  assert.equal((await status(env, id, 'Alice')).body.registered, true);
  const protectedMember = structuredClone(members(env, id)[0]);
  for (const body of [{ name: 'Alice', recognitionCode: '' }, { name: 'Alice' }, { name: 'Alice', recognitionCode: '0043' }, { name: 'Alice', password: PASSWORD }]) {
    const denied = await post(env, id, 'unlock', body);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'wrong_recognition_code');
    assert.equal(denied.body.payload, undefined);
    assert.equal(denied.body.editToken, undefined);
    assertNoSecrets(denied.body);
  }
  assert.deepEqual(members(env, id)[0], protectedMember);
  const unlocked = await post(env, id, 'unlock', { name: 'Alice', recognitionCode: code });
  assert.equal(unlocked.status, 200);
  const revised = await post(env, id, 'submit', input('Alice', 3, { recognitionCode: '', editToken: unlocked.body.editToken }));
  assert.equal(revised.status, 200);
  assert.deepEqual(members(env, id)[0].recognitionCode, protectedMember.recognitionCode);
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'pin');
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '', editToken: unlocked.body.editToken })).status, 200);
  const denied = await post(env, id, 'submit', input('Alice', 99, { recognitionCode: '' }), { ip: '203.0.113.42' });
  assert.equal(denied.status, 403);
  assert.equal(members(env, id)[0].payload.claims[0].qty, 3);
  assertNoSecrets(unlocked.body, [protectedMember.recognitionCode.hash, protectedMember.recognitionCode.salt]);
});

test('recognition input is blank or exactly four printable ASCII characters and invalid attempts reserve no names', async () => {
  const { env, id } = await session();
  for (const recognitionCode of [null, 1234, false, [], {}, '123', '12345', ' 123', '12 4', '1234 ', '1234\n', '１２３４', 'éA12', '12\n4']) {
    const denied = await post(env, id, 'submit', input('Alice', 1, { recognitionCode }));
    assert.equal(denied.status, 400, JSON.stringify(recognitionCode));
    assert.equal(denied.body.code, 'invalid_recognition_code');
  }
  assert.equal(members(env, id).length, 0);
  for (const recognitionCode of ['', '0042']) {
    const missing = await post(env, id, 'unlock', { name: 'Unknown', recognitionCode });
    assert.equal(missing.status, 409);
    assert.equal(missing.body.code, 'not_registered');
  }
  assert.equal(members(env, id).length, 0);
  assert.equal((await post(env, id, 'submit', input('Numeric', 1, { recognitionCode: '0000' }))).status, 200);
  assert.equal((await post(env, id, 'unlock', { name: 'Numeric', recognitionCode: '0000' })).status, 200);
  assert.equal((await post(env, id, 'submit', input('Mixed', 1, { recognitionCode: 'aZ#4' }))).status, 200);
  const wrongCase = await post(env, id, 'unlock', { name: 'Mixed', recognitionCode: 'Az#4' });
  assert.equal(wrongCase.status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Mixed', recognitionCode: 'aZ#4' })).status, 200);
});

test('submitted none name cannot be seized by adding PIN; own name-issued ticket may set and later change PIN', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { recognitionCode: '' }));
  await post(env, id, 'submit', input('Bob', 2, { recognitionCode: '' }));
  const before = structuredClone(members(env, id));
  const bobTicket = (await post(env, id, 'unlock', { name: 'Bob', recognitionCode: '' })).body.editToken;
  for (const extra of [{ recognitionCode: '0042' }, { recognitionCode: '0042', editToken: bobTicket }, { recognitionCode: '', password: PASSWORD }]) {
    const denied = await post(env, id, 'submit', input('Alice', 99, extra));
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'recognition_change_requires_ticket');
  }
  assert.deepEqual(members(env, id).find(member => member.payload.name === 'Alice'), before.find(member => member.payload.name === 'Alice'));
  const aliceTicket = (await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '' })).body.editToken;
  const added = await post(env, id, 'submit', input('Alice', 3, { recognitionCode: '0042', editToken: aliceTicket }));
  assert.equal(added.status, 200);
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'pin');
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { recognitionCode: '', editToken: aliceTicket }), { ip: '203.0.113.43' })).status, 403);
  const pinTicket = (await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' })).body.editToken;
  const beforeSamePin = structuredClone(members(env, id).find(member => member.payload.name === 'Alice'));
  assert.equal((await post(env, id, 'submit', input('Alice', 3.5, { recognitionCode: '0042', editToken: pinTicket }))).status, 200);
  const afterSamePin = members(env, id).find(member => member.payload.name === 'Alice');
  assert.deepEqual(afterSamePin.recognitionCode, beforeSamePin.recognitionCode);
  assert.equal(afterSamePin.generation, beforeSamePin.generation);
  assert.equal((await post(env, id, 'submit', input('Alice', 4, { recognitionCode: '0099', editToken: pinTicket }))).status, 200);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' }, { ip: '203.0.113.43' })).status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0099' })).status, 200);
  assert.equal(members(env, id).find(member => member.payload.name === 'Alice').payload.claims[0].qty, 4);
});

test('R104 stored password without kind field still works, cannot be blank-bypassed or silently changed by optional code', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  const { ctx } = env.objects.get(id);
  const [key, member] = [...ctx.data].find(([key]) => key.startsWith('member:'));
  delete member.credentialKind;
  delete member.registered;
  await ctx.storage.put(key, member); // An R104 persisted record, not a newly declared R105 kind.
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'password');
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '' })).status, 403);
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { recognitionCode: '0042' }))).status, 403);
  const unlocked = await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD, recognitionCode: '' });
  assert.equal(unlocked.status, 200);
  assert.equal((await post(env, id, 'submit', input('Alice', 2, { recognitionCode: '', editToken: unlocked.body.editToken }))).status, 200);
  assert.deepEqual(members(env, id)[0].password, member.password);
  const changed = await post(env, id, 'submit', input('Alice', 99, { recognitionCode: '0042', editToken: unlocked.body.editToken }));
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'credential_change_requires_reset');
  assert.deepEqual(members(env, id)[0].password, member.password);
  assert.equal(members(env, id)[0].payload.claims[0].qty, 2);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 200);
});

test('owner reset requires approval and a nonblank four-character code; preserves old auth until atomic redemption', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'submit', input('Alice', 1, { password: PASSWORD }));
  const oldTicket = (await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).body.editToken;
  const before = structuredClone(members(env, id)[0]);
  assert.equal((await post(env, id, 'approve', { name: 'Alice', recognitionCode: '0042' })).status, 403);
  const approval = await post(env, id, 'approve', { name: 'Alice' }, { owner: writeToken });
  assert.equal(approval.status, 200);
  assert.deepEqual(members(env, id)[0].password, before.password);
  for (const recognitionCode of ['', '123', '12345', '1 34', '四abc', 1234]) {
    const denied = await post(env, id, 'unlock', { name: 'Alice', recognitionCode, setupCode: approval.body.setupCode });
    assert.equal(denied.status, 400);
    assert.equal(denied.body.code, 'invalid_recognition_code');
    assert.deepEqual(members(env, id)[0].password, before.password);
  }
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: 'aZ#4', setupCode: 'forged' })).status, 409);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 200);
  const reset = await post(env, id, 'unlock', { name: 'Alice', recognitionCode: 'aZ#4', setupCode: approval.body.setupCode });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.payload.claims[0].qty, 1);
  assert.equal((await status(env, id, 'Alice')).body.credentialKind, 'pin');
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', password: PASSWORD })).status, 403);
  assert.equal((await post(env, id, 'submit', input('Alice', 99, { recognitionCode: '', editToken: oldTicket }))).status, 403);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: 'aZ#4', setupCode: approval.body.setupCode })).status, 409);
  assert.equal((await post(env, id, 'submit', input('Alice', 2, { recognitionCode: '', editToken: reset.body.editToken }))).status, 200);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: 'aZ#4' })).status, 200);
});

test('missing and malformed PIN failures share persistent quota; a ticket or correct PIN cannot bypass a block', async () => {
  const { env, id } = await session();
  await post(env, id, 'submit', input('Alice', 1, { recognitionCode: '0042' }));
  const ticket = (await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' })).body.editToken;
  for (let i = 0; i < 5; i++) {
    const denied = await post(env, id, 'unlock', { name: 'Alice', ...(i % 2 ? { recognitionCode: 42 } : {}) });
    assert.equal(denied.status, i === 4 ? 429 : 403);
  }
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' })).status, 429);
  assert.equal((await post(env, id, 'submit', input('Alice', 2, { editToken: ticket, recognitionCode: '' }))).status, 429);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' }, { ip: '203.0.113.44' })).status, 200);
  assert.equal((await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' }, { now: env.now + 900001 })).status, 200);
});

test('PIN salts and pepper-PBKDF2 match independent derivation; public results, flags and inbox never expose recognition secrets', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'submit', input('Alice', 1, { recognitionCode: '0042' }));
  await post(env, id, 'submit', input('Bob', 1, { recognitionCode: '0042' }));
  const [alice, bob] = members(env, id);
  assert.equal(alice.recognitionCode.salt.length, 32);
  assert.notEqual(alice.recognitionCode.salt, bob.recognitionCode.salt);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.CLAIM_PASSWORD_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prehash = await crypto.subtle.sign('HMAC', key, encoder.encode('0042'));
  const base = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(alice.recognitionCode.salt, 'hex'), iterations: 100000 }, base, 256);
  assert.equal(Buffer.from(bits).toString('hex'), alice.recognitionCode.hash);
  const unlocked = await post(env, id, 'unlock', { name: 'Alice', recognitionCode: '0042' });
  const publish = await api(env, id, '', { method: 'PUT', body: shareData([seed('Alice'), seed('Bob')]), owner: writeToken, now: env.now + 2000 });
  assert.equal(publish.status, 200);
  for (const result of [await api(env, id), await status(env, id, 'Alice'), await inbox(env, id, writeToken), unlocked]) {
    assertNoSecrets(result.body, ['0042', alice.recognitionCode.hash, alice.recognitionCode.salt, env.CLAIM_PASSWORD_PEPPER]);
  }
  const stored = JSON.stringify([...env.objects.get(id).ctx.data]);
  assert.ok(!stored.includes('0042'));
  assert.ok(!stored.includes(unlocked.body.editToken));
});

test('reserved optional PIN enrollment and simultaneous none-name seizure obey atomic identity ownership', async () => {
  const { env, id, writeToken } = await session();
  await post(env, id, 'setup', { members: [seed('Reserved', 1)] }, { owner: writeToken });
  const submitted = await post(env, id, 'submit', input('Reserved', 2, { recognitionCode: '0042' }));
  assert.equal(submitted.status, 200);
  assert.equal((await status(env, id, 'Reserved')).body.credentialKind, 'pin');
  const attempts = await Promise.all([
    post(env, id, 'submit', input('  Jose\u0301   Chan ', 1, { recognitionCode: '' })),
    post(env, id, 'submit', input('José Chan', 99, { recognitionCode: '0042' }))
  ]);
  assert.deepEqual(attempts.map(result => result.status).sort((left, right) => left - right), [200, 403], 'exactly one normalized-name enrollment wins the race');
  const winningKind = attempts[0].status === 200 ? 'none' : 'pin';
  const winningQuantity = attempts[0].status === 200 ? 1 : 99;
  const member = members(env, id).find(member => member.payload.name === 'José Chan');
  assert.equal(member.credentialKind, winningKind, 'the stored credential belongs to the winning request');
  assert.equal(member.payload.claims[0].qty, winningQuantity, 'a losing concurrent request cannot overwrite the winner');
});
