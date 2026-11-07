const encoder = new TextEncoder();
const WINDOW_MS = 15 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const ITERATIONS = 100000; // Workers WebCrypto PBKDF2 maximum; the secret pepper adds server-only entropy.
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
async function passwordHash(pepper, password, salt) {
  const prehash = await hmac(pepper, passwordInput(password));
  const key = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256));
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
  return { name: member.payload.name, registered: Boolean(member.password), requiresApproval: !member.password };
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
  async authorize(member, input, keys, now) {
    await this.checkRate(keys, now);
    // A code is a reset authority even for a registered member. Issuing it never changes the old password.
    if (input.setupCode !== undefined || !member?.password) {
      if (!input.setupCode) fail(409, 'approval_required');
      if (typeof input.setupCode !== 'string' || input.setupCode.length > 128 || !member?.code || member.code.expiresAt <= now ||
          !equal(member.code.hash, await digest(input.setupCode))) return this.wrong(keys, now, 'approval_required');
      const password = passwordInput(input.password);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      member.password = { salt, hash: await passwordHash(this.env.CLAIM_PASSWORD_PEPPER, password, salt) };
      member.generation = (member.generation || 0) + 1;
      member.tickets = [];
      delete member.code;
      return;
    }
    if (typeof input.editToken === 'string' && input.editToken.length === 43) {
      const hash = await digest(input.editToken);
      if ((member.tickets || []).some(ticket => ticket.expiresAt > now && ticket.generation === member.generation && equal(ticket.hash, hash))) return;
    }
    if (typeof input.password !== 'string' || [...input.password].length < 8 || [...input.password].length > 128) return this.wrong(keys, now, 'wrong_password');
    const hash = await passwordHash(this.env.CLAIM_PASSWORD_PEPPER, input.password, member.password.salt);
    if (!equal(member.password.hash, hash)) return this.wrong(keys, now, 'wrong_password');
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
    if (['setup', 'inbox', 'approve', 'validateResult', 'initialize'].includes(e.op) && e.owner !== true) fail(403, 'forbidden');
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
        if (!await storage.get(key)) await storage.put(key, { payload: entry, updatedRevision: 0, generation: 0, tickets: [] });
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
    if (e.op === 'validateResult') {
      if (!meta.enabled) return { enabled: false, ...timing };
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
      return { enabled: true, cursor: meta.cursor, ...timing };
    }
    const name = normalizeClaimName(e.input?.name);
    const key = await this.memberKey(name);
    let member = await storage.get(key);
    if (e.op === 'status') return { enabled: meta.enabled, registered: Boolean(member?.password), requiresApproval: !member?.password && (!meta.autoEnroll || Boolean(member)), claimSecurity: 'password', ...timing };
    if (!meta.enabled) fail(409, 'protection_required');
    if (e.op === 'approve') {
      if (!member) {
        if ((await this.members()).length >= 500) fail(400, 'too_many_members');
        member = { payload: { v: 1, name, claims: [], clear: true }, updatedRevision: 0, generation: 0, tickets: [] };
      }
      const setupCode = random(18);
      const expiresAt = Math.min(e.now + CODE_MS, meta.expiresAt);
      member.code = { hash: await digest(setupCode), expiresAt };
      await storage.put(key, member);
      return { name, setupCode, registered: Boolean(member.password), expiresAt: new Date(expiresAt).toISOString(), serverNow: timing.serverNow };
    }
    if (!['submit', 'unlock'].includes(e.op)) fail(404, 'not_found');
    const clean = e.op === 'submit' ? payload({ ...e.input, name }) : null;
    const keys = await this.rateKeys(name, e.ip);
    await this.checkRate(keys, e.now);
    if (!member) {
      if (!meta.autoEnroll) fail(409, 'approval_required');
      if (e.op === 'unlock') fail(409, 'not_registered', { instruction: 'initial_submit' });
      if (e.input.setupCode !== undefined) return this.wrong(keys, e.now, 'approval_required');
      passwordInput(e.input.password);
      if ((await this.members()).length >= 500) fail(400, 'too_many_members');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      member = { payload: clean, updatedRevision: 0, generation: 1, tickets: [], password: { salt, hash: await passwordHash(this.env.CLAIM_PASSWORD_PEPPER, e.input.password, salt) } };
    } else {
      // Unlock never accepts an editToken: retrieval always proves the password or a one-use owner code.
      await this.authorize(member, { ...e.input, ...(e.op === 'unlock' ? { editToken: undefined } : {}) }, keys, e.now);
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
    member.updatedRevision = ++meta.cursor;
    // A multi-key storage put commits the member and global cursor together.
    await storage.put({ [key]: member, meta });
    return { payload: member.payload, revision: member.updatedRevision, ...timing };
  }
}
