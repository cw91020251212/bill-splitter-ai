const encoder = new TextEncoder();
const WINDOW_MS = 15 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const ITERATIONS = 100000; // Workers WebCrypto PBKDF2 maximum; the secret pepper adds server-only entropy.
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const RESULT_CHUNK_BYTES = 512 * 1024;
const CONTROL = /[\p{Cc}\p{Cf}:：=＝]/u;
const INTERNAL_URL = 'https://claim-auth.internal/dispatch';

class ClaimError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
function fail(status, code, extra) { throw new ClaimError(status, code, extra); }
function response(body, status = 200) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
  if (body.retryAfter) headers['Retry-After'] = String(body.retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair, 16)); }
function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function random(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function hmac(pepper, value) {
  if (typeof pepper !== 'string' || !pepper) fail(503, 'claim_auth_unavailable');
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
function passwordInput(password) {
  if (typeof password !== 'string' || [...password].length < 8 || [...password].length > 128) fail(400, 'invalid_password');
  return password; // Deliberately do not normalize passwords; Unicode is supported verbatim.
}
function recognitionInput(code, allowBlank = true) {
  if (typeof code !== 'string' || !(allowBlank && code === '') && !(code.length === 4 && /^[!-~]{4}$/.test(code))) fail(400, 'invalid_recognition_code');
  return code; // Preserve exact text and case; never trim, coerce or normalize.
}
async function credentialHash(pepper, credential, salt) {
  const prehash = await hmac(pepper, credential);
  const key = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256));
}
function credentialKind(member) {
  if (!member) return 'new';
  if (member.password) return 'password'; // R104 records have no credentialKind field.
  if (member.recognitionCode) return 'pin';
  if (member.credentialKind === 'none' || member.registered === true || member.updatedRevision > 0) return 'none';
  return 'reserved';
}
function credentialSummary(member) {
  const kind = credentialKind(member);
  return { credentialKind: kind, registered: ['none', 'pin', 'password'].includes(kind), requiresApproval: false };
}
export function normalizeClaimName(value) {
  if (typeof value !== 'string' || CONTROL.test(value)) fail(400, 'invalid_name');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 60) fail(400, 'invalid_name');
  return name;
}
function unit(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || [...value].length > 30 || /[\p{Cc}\p{Cf}]/u.test(value)) fail(400, 'invalid_claims');
  return value.normalize('NFC').trim();
}
function payload(input) {
  const name = normalizeClaimName(input?.name);
  if (!Array.isArray(input?.claims) || input.claims.length > 200 || (input.clear !== undefined && typeof input.clear !== 'boolean')) fail(400, 'invalid_claims');
  if ((input.clear === true && input.claims.length !== 0) || (input.claims.length === 0 && input.clear !== true)) fail(400, 'invalid_claims');
  const ids = new Set();
  const claims = input.claims.map(claim => {
    if (!claim || typeof claim.id !== 'string' || !/^\d{2}$/.test(claim.id) || ids.has(claim.id) ||
        typeof claim.qty !== 'number' || !Number.isFinite(claim.qty) || claim.qty <= 0 || claim.qty > 1000000) fail(400, 'invalid_claims');
    ids.add(claim.id);
    return { id: claim.id, qty: claim.qty, unit: unit(claim.unit), displayUnit: unit(claim.displayUnit) };
  });
  return { v: 1, name, claims, ...(input.clear === true ? { clear: true } : {}) };
}
function memberSummary(member) {
  return { name: member.payload.name, ...credentialSummary(member) };
}
function itemId(item) {
  const id = String(item?.id || '');
  if (/^\d{2}$/.test(id)) return id;
  const number = String(item?.number || '');
  if (/^\d{2}$/.test(number)) return number;
  return /^\d$/.test(id) ? id.padStart(2, '0') : id;
}
function resultMembers(data) {
  const byName = new Map();
  const get = value => {
    const name = normalizeClaimName(value);
    if (!byName.has(name)) byName.set(name, { v: 1, name, claims: [], clear: true });
    return byName.get(name);
  };
  for (const person of data?.participants || []) get(person.name);
  for (const item of data?.items || []) {
    for (const share of item.shares || []) {
      const entry = get(share.person);
      if (!Number.isFinite(share.quantity) || share.quantity < 0) fail(409, 'claims_outdated');
      if (share.quantity === 0) continue;
      delete entry.clear;
      const actualUnit = share.isActualUnit === true ? unit(share.unit || item.unit || '') : '';
      if (share.isActualUnit === true && !actualUnit) fail(409, 'claims_outdated');
      entry.claims.push({ id: itemId(item), qty: share.quantity, unit: actualUnit, displayUnit: '' });
    }
  }
  return [...byName.values()].map(payload);
}

// Only this helper constructs trusted metadata. Public request bodies are nested under input,
// never spread into the envelope. The DO has no public HTTP route; the signature is defense in depth.
export async function forwardClaimAuth(env, { sessionId, expiresAt, now, op, owner = false, ip = '', input = {}, baseline = null, enabled = false, legacy = true }) {
  if (!env.CLAIM_AUTH || !env.CLAIM_PASSWORD_PEPPER) return response({ error: 'claim_auth_unavailable', code: 'claim_auth_unavailable' }, 503);
  const raw = JSON.stringify({ sessionId, expiresAt, now, op, owner, ip, input, baseline, enabled, legacy });
  const signature = hex(await hmac(env.CLAIM_PASSWORD_PEPPER, `envelope\n${raw}`));
  const stub = env.CLAIM_AUTH.get(env.CLAIM_AUTH.idFromName(sessionId));
  return stub.fetch(new Request(INTERNAL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Claim-Auth-Signature': signature }, body: raw }));
}

export class ClaimAuth {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  fetch(request) {
    // Enter before even reading/verifying the envelope: no other request can begin
    // enrollment while this request awaits WebCrypto or storage.
    return this.ctx.blockConcurrencyWhile(async () => {
      let envelope;
      try {
        if (request.url !== INTERNAL_URL || request.method !== 'POST') fail(403, 'forbidden');
        const raw = await request.text();
        const signature = request.headers.get('X-Claim-Auth-Signature');
        if (!equal(signature, hex(await hmac(this.env.CLAIM_PASSWORD_PEPPER, `envelope\n${raw}`)))) fail(403, 'forbidden');
        envelope = JSON.parse(raw);
        if (!/^[A-Za-z0-9_-]{22}$/.test(envelope.sessionId) || !Number.isFinite(envelope.now) || !Number.isFinite(envelope.expiresAt)) fail(403, 'forbidden');
        return response(await this.dispatch(envelope));
      } catch (error) { return this.errorResponse(error, envelope); }
    });
  }
  errorResponse(error, envelope) {
    const known = error instanceof ClaimError;
    const body = { error: known ? error.code : 'claim_auth_unavailable', code: known ? error.code : 'claim_auth_unavailable' };
    if (envelope) {
      body.serverNow = new Date(envelope.now).toISOString();
      body.expiresAt = new Date(envelope.expiresAt).toISOString();
    }
    return response({ ...body, ...(known ? error.extra : {}) }, known ? error.status : 503);
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const meta = await this.ctx.storage.get('meta');
      if (!meta || meta.expiresAt <= Date.now()) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(meta.expiresAt);
    });
  }
  async members() {
    return [...(await this.ctx.storage.list({ prefix: 'member:' })).values()];
  }
  async readPublishedResult(meta) {
    const revision = Number(meta.resultRevision) || 0;
    const chunkCount = Number(meta.resultChunkCount) || 0;
    const byteLength = Number(meta.resultBytes) || 0;
    if (!revision || !chunkCount || !byteLength || byteLength > MAX_RESULT_BYTES) return null;
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (let index = 0; index < chunkCount; index++) {
      const chunk = await this.ctx.storage.get(`result:${revision}:${index}`);
      const view = chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
      if (!view || offset + view.byteLength > byteLength) fail(503, 'published_result_unavailable');
      bytes.set(view, offset);
      offset += view.byteLength;
    }
    if (offset !== byteLength) fail(503, 'published_result_unavailable');
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch (_) { fail(503, 'published_result_unavailable'); }
  }
  async writePublishedResult(meta, data, updatedAt) {
    const bytes = encoder.encode(JSON.stringify(data));
    if (bytes.byteLength > MAX_RESULT_BYTES) fail(413, 'result_too_large');
    const previousRevision = Number(meta.resultRevision) || 0;
    const previousChunkCount = Number(meta.resultChunkCount) || 0;
    const revision = previousRevision + 1;
    const chunkCount = Math.ceil(bytes.byteLength / RESULT_CHUNK_BYTES);
    const chunks = {};
    for (let index = 0; index < chunkCount; index++) {
      const start = index * RESULT_CHUNK_BYTES;
      chunks[`result:${revision}:${index}`] = bytes.slice(start, Math.min(start + RESULT_CHUNK_BYTES, bytes.byteLength));
    }
    await this.ctx.storage.put(chunks);
    const resultUpdatedAt = Number(updatedAt) || Date.now();
    meta.resultRevision = revision;
    meta.resultChunkCount = chunkCount;
    meta.resultBytes = bytes.byteLength;
    meta.resultUpdatedAt = resultUpdatedAt;
    await this.ctx.storage.put('meta', meta);
    if (previousRevision && previousChunkCount) {
      const previousKeys = Array.from({ length: previousChunkCount }, (_, index) => `result:${previousRevision}:${index}`);
      await this.ctx.storage.delete(previousKeys);
    }
    return { revision, updatedAt: resultUpdatedAt };
  }
  async memberKey(name) { return `member:${await digest(name)}`; }
  async rateKeys(name, ip) {
    return [`rate:ip:${await digest(ip)}`, `rate:name-ip:${await digest(`${name}\n${ip}`)}`];
  }
  async checkRate(keys, now) {
    for (const key of keys) {
      const failures = (await this.ctx.storage.get(key) || []).filter(time => time > now - WINDOW_MS);
      if (failures.length >= 5) fail(429, 'too_many_attempts', { retryAfter: Math.max(1, Math.ceil((failures[0] + WINDOW_MS - now) / 1000)) });
    }
  }
  async wrong(keys, now, code) {
    for (const key of keys) {
      const failures = (await this.ctx.storage.get(key) || []).filter(time => time > now - WINDOW_MS);
      failures.push(now);
      await this.ctx.storage.put(key, failures);
    }
    await this.checkRate(keys, now); // The fifth failure blocks immediately; correct credentials cannot bypass a block.
    fail(code === 'approval_required' ? 409 : 403, code);
  }
  async ownTicket(member, token, now) {
    if (typeof token !== 'string' || token.length !== 43) return false;
    const hash = await digest(token);
    return (member.tickets || []).some(ticket => ticket.expiresAt > now && ticket.generation === member.generation && equal(ticket.hash, hash));
  }
  async setCredential(member, input, allowBlank = true) {
    let kind, credential;
    if (input.recognitionCode !== undefined) {
      credential = recognitionInput(input.recognitionCode, allowBlank);
      kind = credential === '' ? 'none' : 'pin';
    } else {
      if (input.password === undefined) recognitionInput(undefined);
      credential = passwordInput(input.password); // Preserve the R104 request path.
      kind = 'password';
    }
    if (kind !== 'none') {
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const stored = { salt, hash: await credentialHash(this.env.CLAIM_PASSWORD_PEPPER, credential, salt) };
      if (kind === 'password') member.password = stored;
      else member.recognitionCode = stored;
    }
    // This helper is only called for initial binding, an own-ticket PIN change,
    // or explicit owner-code redemption. Ordinary blank edits never downgrade.
    if (kind !== 'password') delete member.password;
    if (kind !== 'pin') delete member.recognitionCode;
    member.credentialKind = kind;
    member.generation = (member.generation || 0) + 1;
    member.tickets = [];
  }
  async authorize(member, input, keys, now, op) {
    await this.checkRate(keys, now);
    // Only a valid one-use owner code may replace an existing legacy password.
    // Issuing a code never changes any credential; redemption cannot bind blank.
    if (input.setupCode !== undefined) {
      if (typeof input.setupCode !== 'string' || input.setupCode.length > 128 || !member?.code || member.code.expiresAt <= now ||
          !equal(member.code.hash, await digest(input.setupCode))) return this.wrong(keys, now, 'approval_required');
      await this.setCredential(member, input, false);
      delete member.code;
      return { reset: true, ticket: false };
    }
    if (await this.ownTicket(member, input.editToken, now)) {
      if (input.recognitionCode !== undefined) recognitionInput(input.recognitionCode);
      return { ticket: true };
    }
    const kind = credentialKind(member);
    if (kind === 'password') {
      if (typeof input.password !== 'string' || [...input.password].length < 8 || [...input.password].length > 128) return this.wrong(keys, now, 'wrong_password');
      if (input.recognitionCode !== undefined) recognitionInput(input.recognitionCode);
      const hash = await credentialHash(this.env.CLAIM_PASSWORD_PEPPER, input.password, member.password.salt);
      if (!equal(member.password.hash, hash)) return this.wrong(keys, now, 'wrong_password');
    } else if (kind === 'pin') {
      if (typeof input.recognitionCode !== 'string' || input.recognitionCode.length !== 4 || !/^[!-~]{4}$/.test(input.recognitionCode)) return this.wrong(keys, now, 'wrong_recognition_code');
      const hash = await credentialHash(this.env.CLAIM_PASSWORD_PEPPER, input.recognitionCode, member.recognitionCode.salt);
      if (!equal(member.recognitionCode.hash, hash)) return this.wrong(keys, now, 'wrong_recognition_code');
    } else if (kind === 'reserved' && op === 'submit') {
      await this.setCredential(member, input);
    } else {
      recognitionInput(input.recognitionCode);
      // A submitted no-code identity is deliberately name-only for ordinary edits,
      // but adding a PIN requires its own name-issued edit ticket first.
      if (input.recognitionCode !== '' || input.password !== undefined) return this.wrong(keys, now, 'recognition_change_requires_ticket');
    }
    return { ticket: false };
  }
  async dispatch(e) {
    const storage = this.ctx.storage;
    let meta = await storage.get('meta');
    if (e.expiresAt <= e.now || (meta && meta.expiresAt <= e.now)) {
      await storage.deleteAll();
      await storage.deleteAlarm();
      fail(410, 'expired');
    }
    if (meta && (meta.sessionId !== e.sessionId || meta.expiresAt !== e.expiresAt)) fail(403, 'forbidden');
    if (!meta) {
      meta = { sessionId: e.sessionId, expiresAt: e.expiresAt, enabled: e.enabled === true, autoEnroll: e.legacy === false, cursor: 0 };
      await storage.put('meta', meta);
      await storage.setAlarm(meta.expiresAt);
    }
    const timing = { serverNow: new Date(e.now).toISOString(), expiresAt: new Date(meta.expiresAt).toISOString() };
    if (['setup', 'inbox', 'approve', 'validateResult', 'publishResult', 'initialize'].includes(e.op) && e.owner !== true) fail(403, 'forbidden');
    if (e.op === 'initialize') {
      meta.enabled = true;
      await storage.put('meta', meta);
      return { enabled: true, claimSecurity: 'password', ...timing };
    }
    if (e.op === 'metadata') return { enabled: meta.enabled, claimSecurity: meta.enabled ? 'password' : undefined, ...timing };
    if (e.op === 'setup') {
      if (!Array.isArray(e.input?.members) || e.input.members.length > 500) fail(400, 'invalid_members');
      const supplied = e.input.members.map(entry => { if (entry?.v !== 1) fail(400, 'invalid_members'); return payload(entry); });
      const seeds = [...resultMembers(e.baseline), ...supplied]; // KV baseline wins; existing DO records win over both.
      const known = new Set((await this.members()).map(member => member.payload.name));
      for (const entry of seeds) known.add(entry.name);
      if (known.size > 500) fail(400, 'too_many_members');
      for (const entry of seeds) {
        const key = await this.memberKey(entry.name);
        if (!await storage.get(key)) await storage.put(key, { payload: entry, credentialKind: 'reserved', updatedRevision: 0, generation: 0, tickets: [] });
      }
      meta.enabled = true;
      await storage.put('meta', meta);
      return { enabled: true, claimSecurity: 'password', members: (await this.members()).map(memberSummary), cursor: meta.cursor, ...timing };
    }
    if (e.op === 'inbox') {
      const after = Number(e.input?.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) fail(400, 'invalid_cursor');
      const members = await this.members();
      return { enabled: meta.enabled, updates: members.filter(member => member.updatedRevision > after)
        .map(member => ({ ...member.payload, revision: member.updatedRevision })).sort((a, b) => a.revision - b.revision),
        cursor: meta.cursor, members: members.map(memberSummary), ...timing };
    }
    if (e.op === 'validateResult' || e.op === 'publishResult') {
      if (!meta.enabled && e.op === 'validateResult') return { enabled: false, ...timing };
      if (!meta.enabled && e.op === 'publishResult') {
        const saved = await this.writePublishedResult(meta, e.input?.data, e.input?.updatedAt);
        return { enabled: false, cursor: meta.cursor, status: 'ready', resultRevision: saved.revision, resultUpdatedAt: saved.updatedAt, ...timing };
      }
      let published;
      try { published = resultMembers(e.input?.data); }
      catch (_) { fail(409, 'claims_outdated'); }
      const members = await this.members();
      const expected = new Map(members.map(member => [member.payload.name, member.payload]));
      const actual = new Map(published.map(entry => [entry.name, entry]));
      const payer = e.input?.data?.bill?.payer;
      const canonical = entry => JSON.stringify((entry?.claims || []).map(claim => ({ id: claim.id, qty: claim.qty, unit: claim.unit })).sort((a, b) => a.id.localeCompare(b.id)));
      for (const entry of published) {
        if (!expected.has(entry.name)) {
          if (entry.name !== payer || entry.claims.length) fail(409, 'claims_outdated');
          const person = (e.input.data.participants || []).find(person => person.name === entry.name);
          if (person && ['total', 'sourceTotal', 'subtotal', 'tax', 'discount'].some(key => Number(person[key] || 0) !== 0)) fail(409, 'claims_outdated');
          for (const item of e.input.data.items || []) for (const share of item.shares || []) {
            if (share.person === entry.name && ['quantity', 'amount'].some(key => Number(share[key] || 0) !== 0)) fail(409, 'claims_outdated');
          }
        }
      }
      for (const [name, entry] of expected) if (canonical(entry) !== canonical(actual.get(name))) fail(409, 'claims_outdated');
      if (e.op === 'publishResult') {
        const saved = await this.writePublishedResult(meta, e.input.data, e.input.updatedAt);
        return { enabled: true, cursor: meta.cursor, status: 'ready', resultRevision: saved.revision, resultUpdatedAt: saved.updatedAt, ...timing };
      }
      return { enabled: true, cursor: meta.cursor, ...timing };
    }
    if (e.op === 'resultMeta') {
      return { status: meta.resultRevision ? 'ready' : 'pending', resultRevision: Number(meta.resultRevision) || 0,
        resultUpdatedAt: Number(meta.resultUpdatedAt) || 0, enabled: meta.enabled, ...timing };
    }
    if (e.op === 'getResult') {
      if (!meta.resultRevision) return { status: 'pending', resultRevision: 0, enabled: meta.enabled, ...timing };
      return { status: 'ready', data: await this.readPublishedResult(meta), resultRevision: Number(meta.resultRevision),
        resultUpdatedAt: Number(meta.resultUpdatedAt) || 0, enabled: meta.enabled, ...timing };
    }
    if (e.op === 'seedResult') {
      if (!meta.resultRevision && e.input?.data && typeof e.input.data === 'object') {
        await this.writePublishedResult(meta, e.input.data, e.input.updatedAt);
      }
      if (!meta.resultRevision) return { status: 'pending', resultRevision: 0, enabled: meta.enabled, ...timing };
      return { status: 'ready', data: await this.readPublishedResult(meta), resultRevision: Number(meta.resultRevision),
        resultUpdatedAt: Number(meta.resultUpdatedAt) || 0, enabled: meta.enabled, ...timing };
    }
    const name = normalizeClaimName(e.input?.name);
    const key = await this.memberKey(name);
    let member = await storage.get(key);
    if (e.op === 'status') return { enabled: meta.enabled, ...credentialSummary(member), claimSecurity: 'password', ...timing };
    if (!meta.enabled) fail(409, 'protection_required');
    if (e.op === 'approve') {
      if (!member) {
        if ((await this.members()).length >= 500) fail(400, 'too_many_members');
        member = { payload: { v: 1, name, claims: [], clear: true }, credentialKind: 'reserved', updatedRevision: 0, generation: 0, tickets: [] };
      }
      const setupCode = random(18);
      const expiresAt = Math.min(e.now + CODE_MS, meta.expiresAt);
      member.code = { hash: await digest(setupCode), expiresAt };
      await storage.put(key, member);
      return { name, setupCode, ...credentialSummary(member), expiresAt: new Date(expiresAt).toISOString(), serverNow: timing.serverNow };
    }
    if (!['submit', 'unlock'].includes(e.op)) fail(404, 'not_found');
    const clean = e.op === 'submit' ? payload({ ...e.input, name }) : null;
    const keys = await this.rateKeys(name, e.ip);
    await this.checkRate(keys, e.now);
    if (!member) {
      if (e.op === 'unlock') fail(409, 'not_registered', { instruction: 'initial_submit' });
      if (e.input.setupCode !== undefined) return this.wrong(keys, e.now, 'approval_required');
      if ((await this.members()).length >= 500) fail(400, 'too_many_members');
      member = { payload: clean, updatedRevision: 0, generation: 0, tickets: [] };
      await this.setCredential(member, e.input);
    } else {
      const auth = await this.authorize(member, e.input, keys, e.now, e.op);
      if (e.op === 'submit' && auth.ticket && e.input.recognitionCode) {
        // Preserve R104 passwords unless an explicit owner reset is redeemed.
        if (member.password) fail(409, 'credential_change_requires_reset');
        const unchanged = member.recognitionCode && equal(member.recognitionCode.hash,
          await credentialHash(this.env.CLAIM_PASSWORD_PEPPER, e.input.recognitionCode, member.recognitionCode.salt));
        if (!unchanged) await this.setCredential(member, e.input);
      }
    }
    if (e.op === 'unlock') {
      const editToken = random();
      const tokenExpiresAt = Math.min(e.now + WINDOW_MS, meta.expiresAt);
      member.tickets = (member.tickets || []).filter(ticket => ticket.expiresAt > e.now).slice(-31);
      member.tickets.push({ hash: await digest(editToken), expiresAt: tokenExpiresAt, generation: member.generation });
      await storage.put(key, member);
      return { editToken, tokenExpiresAt: new Date(tokenExpiresAt).toISOString(), payload: member.payload, ...timing };
    }
    member.payload = clean;
    member.registered = true;
    if (credentialKind(member) === 'none') member.credentialKind = 'none';
    member.updatedRevision = ++meta.cursor;
    // A multi-key storage put commits the member and global cursor together.
    await storage.put({ [key]: member, meta });
    return { payload: member.payload, revision: member.updatedRevision, ...timing };
  }
}
