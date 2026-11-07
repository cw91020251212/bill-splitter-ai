import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './src/worker-core.mjs';
import { ClaimAuth } from './src/claim-auth.mjs';

const ORIGIN = 'https://cw91020251212.github.io';
const env = () => {
  const values = new Map();
  const objects = new Map();
  const result = {
    BILL_SHARES: {
      async put(key, value, options) { values.set(key, { value, options }); },
      async get(key) { return values.get(key)?.value ?? null; },
      async delete(key) { values.delete(key); }
    },
    ALLOWED_ORIGINS: ORIGIN,
    SHARE_TTL_SECONDS: '604800',
    CLAIM_PASSWORD_PEPPER: 'local-test-pepper-only',
    values
  };
  result.CLAIM_AUTH = {
    idFromName(id) { return id; },
    get(id) {
      if (!objects.has(id)) {
        const data = new Map();
        let queue = Promise.resolve();
        const ctx = {
          storage: {
            async get(key) { return structuredClone(data.get(key)); },
            async put(key, value) {
              if (typeof key === 'object') for (const [name, entry] of Object.entries(key)) data.set(name, structuredClone(entry));
              else data.set(key, structuredClone(value));
            },
            async list({ prefix }) { return new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); },
            async setAlarm() {}, async deleteAlarm() {}, async deleteAll() { data.clear(); }
          },
          blockConcurrencyWhile(callback) { const result = queue.then(callback, callback); queue = result.catch(() => {}); return result; }
        };
        objects.set(id, new ClaimAuth(ctx, result));
      }
      return objects.get(id);
    }
  };
  return result;
};
const request = (url, method = 'GET', body = undefined, headers = {}) => new Request(url, {
  method,
  headers: { Origin: ORIGIN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const sample = {
  version: 2,
  language: 'zh-HK',
  bill: { date: '2026-11-07', payer: '主辦人', currency: 'HKD', billTotal: 10 },
  participants: [{ name: '阿明', total: 10 }],
  items: [{ id: '1', number: '01', name: '茶', quantity: 1, unit: '杯', sourceAmount: 10, allocatedAmount: 10, shares: [{ person: '阿明', quantity: 1, unit: '杯', amount: 10 }] }],
  adjustments: [],
  images: []
};

async function json(response) { return response.json(); }

test('one claim session changes from pending to ready only with organizer token', async () => {
  const storage = env();
  const now = Date.now();
  const createdResponse = await handleRequest(request('https://worker.test/api/shares/sessions', 'POST', { ttlDays: 1 }), storage, now);
  assert.equal(createdResponse.status, 201);
  const created = await json(createdResponse);
  assert.match(created.id, /^[A-Za-z0-9_-]{22}$/);
  assert.match(created.writeToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.status, 'pending');

  const pendingResponse = await handleRequest(request(`https://worker.test/api/shares/${created.id}`), storage, now + 1100);
  assert.equal(pendingResponse.status, 202);
  const pending = await json(pendingResponse);
  assert.equal(pending.status, 'pending');
  assert.equal(Date.parse(pending.serverNow), now + 1100);

  const denied = await handleRequest(request(`https://worker.test/api/shares/${created.id}`, 'PUT', sample, { Authorization: 'Bearer wrong' }), storage, now + 2200);
  assert.equal(denied.status, 403);

  const setup = await handleRequest(request(`https://worker.test/api/shares/${created.id}/claims/setup`, 'POST', {
    members: [{ v: 1, name: '阿明', claims: [{ id: '01', qty: 1, unit: '', displayUnit: '' }] }]
  }, { Authorization: `Bearer ${created.writeToken}` }), storage, now + 2200);
  assert.equal(setup.status, 200);
  const publishTime = now + 2200;
  const published = await handleRequest(request(`https://worker.test/api/shares/${created.id}`, 'PUT', sample, { Authorization: `Bearer ${created.writeToken}` }), storage, publishTime);
  assert.equal(published.status, 200);
  assert.equal((await json(published)).status, 'ready');

  const ready = await handleRequest(request(`https://worker.test/api/shares/${created.id}`), storage, publishTime + 1200);
  assert.equal(ready.status, 200);
  const result = await json(ready);
  assert.equal(result.status, 'ready');
  assert.equal(Date.parse(result.serverNow), publishTime + 1200);
  assert.equal(result.data.participants[0].name, '阿明');
});

test('claim sessions accept only the advertised TTL options', async () => {
  const storage = env();
  const response = await handleRequest(request('https://worker.test/api/shares/sessions', 'POST', { ttlDays: 30 }), storage, Date.now());
  assert.equal(response.status, 400);
});

test('claim session expires and old result-share creation remains supported', async () => {
  const storage = env();
  const now = Date.now();
  const created = await json(await handleRequest(request('https://worker.test/api/shares/sessions', 'POST', { ttlDays: 1 }), storage, now));
  const expired = await handleRequest(request(`https://worker.test/api/shares/${created.id}`), storage, now + 24 * 60 * 60 * 1000 + 1);
  assert.equal(expired.status, 410);
  const expiredBody = await json(expired);
  assert.equal(expiredBody.status, 'expired');
  assert.equal(Date.parse(expiredBody.serverNow), now + 24 * 60 * 60 * 1000 + 1);
  const missing = await handleRequest(request(`https://worker.test/api/shares/${created.id}`), storage, now + 24 * 60 * 60 * 1000 + 2);
  assert.equal(missing.status, 404);
  assert.equal(Date.parse((await json(missing)).serverNow), now + 24 * 60 * 60 * 1000 + 2);

  const legacy = await handleRequest(request('https://worker.test/api/shares', 'POST', sample), storage, now + 5000);
  assert.equal(legacy.status, 201);
  const legacyBody = await json(legacy);
  const legacyRead = await handleRequest(request(`https://worker.test/api/shares/${legacyBody.id}`), storage, now + 6000);
  assert.equal(legacyRead.status, 200);
  assert.equal((await json(legacyRead)).status, 'ready');
});
