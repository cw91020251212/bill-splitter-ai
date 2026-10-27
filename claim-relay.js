/*
 * One-tap claim return for 分帳管家 AI.
 * Friends POST an encrypted claim to a free public ntfy.sh topic.
 * The organizer polls that topic and merges claims into step 2.
 * The topic id and AES-GCM key live in the claim link hash, so GitHub Pages
 * never receives them. ntfy.sh only stores ciphertext. No account or API key.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClaimRelay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NTFY_ORIGIN = 'https://ntfy.sh';
  const MAX_MESSAGE_CHARS = 3800;
  const TOPIC_PATTERN = /^bs[a-z0-9]{22}$/;
  const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const BLOCK_SPLIT = /\n+➖{3,}\n+/;
  const BLOCK_SEP = '\n\n➖➖➖➖➖➖➖➖➖➖\n\n';

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomTopicSuffix(length) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function isRoom(room) {
    return Boolean(room && TOPIC_PATTERN.test(room.topic) && KEY_PATTERN.test(room.key));
  }

  function createRoom() {
    const key = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    return { topic: 'bs' + randomTopicSuffix(22), key };
  }

  function readRoomFromHash(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const room = { topic: params.get('room') || '', key: params.get('k') || '' };
    return isRoom(room) ? room : null;
  }

  function buildHash(dataToken, room) {
    const token = String(dataToken || '');
    if (!isRoom(room)) return 'data=' + token;
    return 'data=' + token + '&room=' + room.topic + '&k=' + room.key;
  }

  function cleanText(value, max) {
    return String(value || '').replace(/[\r\n=＝]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function formatQty(qty) {
    const n = Number(qty);
    if (!Number.isFinite(n)) return '';
    const rounded = Math.round(n * 1000) / 1000;
    return String(rounded);
  }

  function sanitizePayload(obj) {
    if (!obj || obj.v !== 1) return null;
    const name = String(obj.name || '').trim().replace(/[\r\n]+/g, ' ');
    if (!name || name.length > 60 || /[:：=＝]/.test(name)) return null;
    if (!Array.isArray(obj.claims) || obj.claims.length < 1 || obj.claims.length > 200) return null;
    const claims = [];
    const ids = new Set();
    for (const claim of obj.claims) {
      const id = String(claim && claim.id || '');
      if (!/^\d{2}$/.test(id) || ids.has(id)) return null;
      ids.add(id);
      const qty = Number(claim.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) return null;
      claims.push({
        id,
        qty,
        unit: cleanText(claim.unit, 30),
        displayUnit: cleanText(claim.displayUnit, 30)
      });
    }
    return { v: 1, name, claims };
  }

  async function importKey(key) {
    const raw = base64UrlToBytes(key);
    if (raw.length !== 32) throw Object.assign(new Error('bad-key'), { code: 'bad-key' });
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function encryptPayload(key, payload) {
    const clean = sanitizePayload(payload);
    if (!clean) throw Object.assign(new Error('bad-payload'), { code: 'bad-payload' });
    if (!crypto.subtle) throw Object.assign(new Error('no-crypto'), { code: 'no-crypto' });
    const cryptoKey = await importKey(key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(clean));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
    const packed = new Uint8Array(iv.length + cipher.length);
    packed.set(iv, 0);
    packed.set(cipher, iv.length);
    const message = 'bs1.' + bytesToBase64Url(packed);
    if (message.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('too-large'), { code: 'too-large' });
    return message;
  }

  async function decryptPayload(key, message) {
    if (typeof message !== 'string' || message.indexOf('bs1.') !== 0) return null;
    try {
      if (!crypto.subtle) return null;
      const packed = base64UrlToBytes(message.slice(4));
      if (packed.length < 28) return null;
      const cryptoKey = await importKey(key);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, cryptoKey, packed.slice(12));
      return sanitizePayload(JSON.parse(new TextDecoder().decode(plain)));
    } catch (_) {
      return null;
    }
  }

  function formatClaimReply(payload, items) {
    const clean = sanitizePayload(payload);
    if (!clean) return '';
    const byId = new Map((items || []).map(item => [String(item.id), item]));
    const lines = [
      '🧾 *分帳認領回覆* 🧾',
      '👤 姓名：' + clean.name,
      '━━━━━━━━━━━━━━',
      '🍽️ *我認領的項目*'
    ];
    clean.claims.forEach(claim => {
      const item = byId.get(claim.id);
      const name = cleanText((item && item.name) || '項目', 200) || '項目';
      const qty = formatQty(claim.qty);
      let quantity = '認領份數 = ' + qty;
      if (claim.unit) quantity = '實際數量 = ' + qty + ' ' + claim.unit;
      else if (claim.displayUnit) quantity = '認領份數（' + claim.displayUnit + '） = ' + qty;
      lines.push('🔶 *' + claim.id + ' ' + name + '*　👉🏻 ' + quantity);
    });
    lines.push('━━━━━━━━━━━━━━', '✅ *已填妥，請發回給發起人。*');
    return lines.join('\n');
  }

  function personFromBlock(block) {
    const lines = String(block || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/(?:👤|姓名|Name)/.test(line) || !/[:：=＝]/.test(line)) continue;
      return line.split(/[:：=＝]/).slice(1).join(':').replace(/\*/g, '').trim();
    }
    return '';
  }

  function upsertClaimReply(existing, incoming, personName) {
    const reply = String(incoming || '').trim();
    const name = String(personName || '').trim();
    if (!reply || !name) return String(existing || '');
    const blocks = String(existing || '').trim().split(BLOCK_SPLIT).map(block => block.trim()).filter(Boolean);
    let replaced = false;
    const next = blocks.map(block => {
      if (!replaced && personFromBlock(block) === name) {
        replaced = true;
        return reply;
      }
      return block;
    });
    if (!replaced) next.push(reply);
    return next.join(BLOCK_SEP) + '\n\n';
  }

  function applyClaimUpdates(existing, updates, items) {
    let text = String(existing || '');
    (updates || []).forEach(update => {
      const reply = formatClaimReply(update, items);
      if (reply) text = upsertClaimReply(text, reply, update.name);
    });
    return text;
  }

  function endpoint(topic, suffix) {
    if (!TOPIC_PATTERN.test(topic)) throw Object.assign(new Error('bad-topic'), { code: 'bad-topic' });
    return NTFY_ORIGIN + '/' + topic + suffix;
  }

  async function publishClaim(room, payload) {
    if (!isRoom(room)) throw Object.assign(new Error('bad-room'), { code: 'bad-room' });
    const message = await encryptPayload(room.key, payload);
    let response;
    try {
      response = await fetch(endpoint(room.topic, ''), { method: 'POST', body: message, cache: 'no-store' });
    } catch (_) {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    }
    if (response.status === 429) throw Object.assign(new Error('rate-limit'), { code: 'rate-limit', status: 429 });
    if (!response.ok) throw Object.assign(new Error('publish-failed'), { code: 'publish-failed', status: response.status });
    return true;
  }

  async function pullMessages(topic) {
    let response;
    try {
      response = await fetch(endpoint(topic, '/json?poll=1&since=all'), { cache: 'no-store' });
    } catch (_) {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    }
    if (response.status === 429) throw Object.assign(new Error('rate-limit'), { code: 'rate-limit', status: 429 });
    if (!response.ok) throw Object.assign(new Error('pull-failed'), { code: 'pull-failed', status: response.status });
    const messages = [];
    String(await response.text()).split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try { messages.push(JSON.parse(trimmed)); } catch (_) {}
    });
    return messages;
  }

  async function claimsFromMessages(messages, room, seenIds) {
    if (!isRoom(room)) throw Object.assign(new Error('bad-room'), { code: 'bad-room' });
    const seen = new Set((seenIds || []).filter(id => typeof id === 'string'));
    const updates = [];
    let rejected = 0;
    for (const msg of messages || []) {
      if (!msg || msg.event !== 'message' || typeof msg.id !== 'string' || seen.has(msg.id)) continue;
      if (typeof msg.message !== 'string' || msg.message.indexOf('bs1.') !== 0) {
        seen.add(msg.id);
        continue;
      }
      const payload = await decryptPayload(room.key, msg.message);
      seen.add(msg.id);
      if (!payload) {
        rejected += 1;
        continue;
      }
      updates.push(payload);
    }
    return { updates, seenIds: Array.from(seen).slice(-500), rejected };
  }

  return {
    NTFY_ORIGIN,
    MAX_MESSAGE_CHARS,
    isRoom,
    createRoom,
    readRoomFromHash,
    buildHash,
    sanitizePayload,
    encryptPayload,
    decryptPayload,
    formatClaimReply,
    upsertClaimReply,
    applyClaimUpdates,
    publishClaim,
    pullMessages,
    claimsFromMessages
  };
});
