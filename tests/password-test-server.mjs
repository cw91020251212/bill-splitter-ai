import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Test-only memory adapter. It imports the application implementation at run time,
// never deploys, never writes KV/DO state to disk, and never contacts Cloudflare.
const project = new URL('../', import.meta.url);
const clone = value => value === undefined ? undefined : structuredClone(value);
const isLoopback = host => ['127.0.0.1', 'localhost', '[::1]'].includes(host);

export async function createPasswordTestServer({ origin = 'http://127.0.0.1:4192', port = 0 } = {}) {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const [{ handleRequest }, { ClaimAuth }, wrangler] = await Promise.all([
    import(new URL('worker/src/worker-core.mjs', project).href),
    import(new URL('worker/src/claim-auth.mjs', project).href),
    readFile(new URL('worker/wrangler.toml', project), 'utf8')
  ]);
  if (typeof handleRequest !== 'function' || typeof ClaimAuth !== 'function') {
    throw new Error('Password backend contract is not ready; rerun after the application jobs finish.');
  }
  const configuredOrigins = wrangler.match(/^ALLOWED_ORIGINS\s*=\s*"([^"]+)"/m)?.[1] || 'https://cw91020251212.github.io';
  const localOrigin = new URL(origin);
  if (!isLoopback(localOrigin.hostname) || !['http:', 'https:'].includes(localOrigin.protocol)) {
    throw new Error('The test server accepts only a loopback static-site origin.');
  }
  const values = new Map();
  const objects = new Map();
  const clockOverrides = new Map();
  const requests = [];
  const outboundBlocked = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!isLoopback(url.hostname)) {
      outboundBlocked.push({ method: init?.method || input?.method || 'GET', host: url.hostname });
      return Promise.reject(new Error('External fetch blocked by the password test harness.'));
    }
    return nativeFetch(input, init);
  };
  const env = {
    ALLOWED_ORIGINS: [...new Set([...configuredOrigins.split(',').map(s => s.trim()).filter(Boolean), localOrigin.origin])].join(','),
    SITE_BASE_URL: `${localOrigin.origin}/`,
    SHARE_TTL_SECONDS: '604800',
    CLAIM_PASSWORD_PEPPER: 'synthetic-local-test-pepper-never-deploy-2026',
    BILL_SHARES: {
      async get(key) { return values.get(key)?.value ?? null; },
      async put(key, value, options = {}) { values.set(key, { value, options: clone(options) }); },
      async delete(key) { values.delete(key); }
    }
  };
  env.CLAIM_AUTH = {
    idFromName(name) { return name; },
    get(id) {
      if (!objects.has(id)) {
        const data = new Map();
        let blockQueue = Promise.resolve();
        let transactionQueue = Promise.resolve();
        const ctx = { data, scheduledAlarm: null };
        const storage = {
          async get(key) {
            if (Array.isArray(key)) return new Map(key.filter(k => data.has(k)).map(k => [k, clone(data.get(k))]));
            return clone(data.get(key));
          },
          async put(key, value) {
            if (typeof key === 'object' && key !== null) for (const [k, v] of Object.entries(key)) data.set(k, clone(v));
            else data.set(key, clone(value));
          },
          async delete(key) {
            if (Array.isArray(key)) return key.reduce((count, k) => count + Number(data.delete(k)), 0);
            return data.delete(key);
          },
          async list(options = {}) {
            let entries = [...data].filter(([key]) => !options.prefix || key.startsWith(options.prefix))
              .filter(([key]) => !options.start || key >= options.start)
              .filter(([key]) => !options.startAfter || key > options.startAfter)
              .filter(([key]) => !options.end || key < options.end)
              .sort(([a], [b]) => a.localeCompare(b));
            if (options.reverse) entries.reverse();
            if (options.limit) entries = entries.slice(0, options.limit);
            return new Map(entries.map(([key, value]) => [key, clone(value)]));
          },
          async deleteAll() { data.clear(); },
          async setAlarm(time) { ctx.scheduledAlarm = Number(time); },
          async getAlarm() { return ctx.scheduledAlarm; },
          async deleteAlarm() { ctx.scheduledAlarm = null; },
          transaction(callback) {
            const result = transactionQueue.then(async () => {
              const before = clone(data);
              const alarm = ctx.scheduledAlarm;
              try { return await callback(storage); }
              catch (error) { data.clear(); for (const [k, v] of before) data.set(k, v); ctx.scheduledAlarm = alarm; throw error; }
            });
            transactionQueue = result.catch(() => {});
            return result;
          }
        };
        ctx.storage = storage;
        ctx.blockConcurrencyWhile = callback => {
          const result = blockQueue.then(callback, callback);
          blockQueue = result.catch(() => {});
          return result;
        };
        const object = new ClaimAuth(ctx, env);
        objects.set(id, { ctx, object, fetch: request => object.fetch(request) });
      }
      return objects.get(id);
    }
  };
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const pathname = new URL(incoming.url, 'http://127.0.0.1').pathname;
      if (!(pathname === '/api/shares' || pathname.startsWith('/api/shares/') || pathname === '/health')) {
        outgoing.writeHead(404); outgoing.end('Local test API only'); return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 9 * 1024 * 1024) throw new Error('Oversized test API request');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined && !['host', 'connection', 'content-length', 'x-qa-original-url'].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(',') : value);
        }
      }
      const original = incoming.headers['x-qa-original-url'];
      const originalUrl = original ? new URL(String(original)) : new URL(incoming.url, 'https://worker.local.test');
      if (`${originalUrl.pathname}${originalUrl.search}` !== incoming.url) throw new Error('Original Worker URL path mismatch');
      const method = incoming.method || 'GET';
      const request = new Request(originalUrl, { method, headers, ...(!['GET', 'HEAD'].includes(method) && body.length ? { body } : {}) });
      const id = pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{22})(?:\/|$)/)?.[1];
      const result = await handleRequest(request, env, clockOverrides.get(id) ?? Date.now());
      const text = await result.text();
      let input, output;
      try { input = body.length ? JSON.parse(body.toString()) : undefined; } catch (_) {}
      try { output = JSON.parse(text); } catch (_) {}
      // These are private synthetic test state, not emitted to console/artifacts.
      requests.push({ method, path: `${originalUrl.pathname}${originalUrl.search}`, id, status: result.status,
        origin: headers.get('origin'), authorization: headers.get('authorization'), input, output, at: Date.now() });
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(text);
    } catch (_) {
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'Local password test adapter failed' }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  return {
    apiBase, env, values, objects, requests, outboundBlocked,
    nowFor(id, now) { clockOverrides.set(id, now); },
    clearClock(id) { clockOverrides.delete(id); },
    record(id) { const record = values.get(`share:${id}`); return record ? JSON.parse(record.value) : null; },
    async call(path, { method = 'GET', body, owner, ip = '203.0.113.101', requestOrigin = localOrigin.origin } = {}) {
      const result = await nativeFetch(`${apiBase}${path}`, {
        method, headers: { Origin: requestOrigin, 'CF-Connecting-IP': ip,
          ...(owner ? { Authorization: `Bearer ${owner}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await result.text();
      let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
      return { status: result.status, body: parsed, headers: Object.fromEntries(result.headers) };
    },
    async close() {
      globalThis.fetch = nativeFetch;
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href) {
  const harness = await createPasswordTestServer({ origin: process.env.STATIC_ORIGIN || 'http://127.0.0.1:4192', port: Number(process.env.PASSWORD_API_PORT || 4193) });
  console.log('READY local-only password test API');
  const stop = async () => { await harness.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
