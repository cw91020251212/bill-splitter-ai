export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_SHARE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 5;
const MAX_PARTICIPANTS = 500;
const MAX_ITEMS = 2000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const baseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow'
};

function jsonResponse(body, status = 200, origin = null, extra = {}) {
  const headers = new Headers({
    ...baseHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    ...extra
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    headers.append('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: new Headers({ ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', ...extra })
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function cleanText(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeShareData(input) {
  if (!input || ![1, 2].includes(input.version) || !input.bill || typeof input.bill !== 'object' ||
      !Array.isArray(input.participants) || !Array.isArray(input.items)) {
    throw new TypeError('分享資料格式不正確。');
  }
  if (input.participants.length > MAX_PARTICIPANTS || input.items.length > MAX_ITEMS) {
    throw new RangeError('分帳人數或項目數量超出分享上限。');
  }
  const images = Array.isArray(input.images) ? input.images : [];
  if (images.length > MAX_IMAGES) throw new RangeError(`最多可分享 ${MAX_IMAGES} 張收據相片。`);
  const normalizedImages = images.map(image => {
    if (!image || !IMAGE_MIME_TYPES.has(image.mimeType) || typeof image.data !== 'string' ||
        !image.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      throw new TypeError('收據相片格式不正確。');
    }
    return { mimeType: image.mimeType, data: image.data };
  });
  const bill = input.bill;
  return {
    version: input.version,
    language: cleanText(input.language, 20) || 'zh-HK',
    bill: {
      date: cleanText(bill.date, 80),
      payer: cleanText(bill.payer, 120),
      currency: cleanText(bill.currency, 8) || 'HKD',
      sourceCurrency: cleanText(bill.sourceCurrency, 8) || cleanText(bill.currency, 8) || 'HKD',
      sourceTotal: cleanNumber(bill.sourceTotal),
      sourceBillTotal: cleanNumber(bill.sourceBillTotal),
      billTotal: cleanNumber(bill.billTotal),
      itemsSubtotal: cleanNumber(bill.itemsSubtotal),
      discountAmount: cleanNumber(bill.discountAmount),
      taxAmount: cleanNumber(bill.taxAmount),
      taxSplitMethod: cleanText(bill.taxSplitMethod, 30),
      paymentMethods: Array.isArray(bill.paymentMethods) ? bill.paymentMethods.slice(0, 12).map(value => cleanText(value, 80)).filter(Boolean) : [],
      exchangeRate: cleanNumber(bill.exchangeRate),
      exchangeRateDate: cleanText(bill.exchangeRateDate, 40),
      exchangeProvider: cleanText(bill.exchangeProvider, 100),
      receiptImageCount: normalizedImages.length,
      receiptAdjustmentNote: cleanText(bill.receiptAdjustmentNote, 2000)
    },
    participants: input.participants.map(person => ({
      name: cleanText(person?.name, 120),
      total: cleanNumber(person?.total),
      sourceTotal: cleanNumber(person?.sourceTotal),
      subtotal: cleanNumber(person?.subtotal),
      tax: cleanNumber(person?.tax),
      discount: cleanNumber(person?.discount)
    })),
    items: input.items.map(item => ({
      id: cleanText(item?.id, 80),
      number: cleanText(item?.number, 80),
      name: cleanText(item?.name, 300),
      nameEn: cleanText(item?.nameEn, 300),
      original: cleanText(item?.original, 500),
      ja: cleanText(item?.ja, 500),
      quantity: cleanNumber(item?.quantity),
      unit: cleanText(item?.unit, 80),
      sourceAmount: cleanNumber(item?.sourceAmount),
      allocatedAmount: cleanNumber(item?.allocatedAmount),
      shares: Array.isArray(item?.shares) ? item.shares.slice(0, MAX_PARTICIPANTS).map(share => ({
        person: cleanText(share?.person, 120),
        quantity: cleanNumber(share?.quantity),
        unit: cleanText(share?.unit, 80),
        amount: cleanNumber(share?.amount)
      })) : []
    })),
    adjustments: Array.isArray(input.adjustments) ? input.adjustments.slice(0, 5000).map(entry => ({
      person: cleanText(entry?.person, 120),
      name: cleanText(entry?.name, 200),
      quantity: cleanNumber(entry?.quantity),
      unit: cleanText(entry?.unit, 80),
      amount: cleanNumber(entry?.amount),
      reason: cleanText(entry?.reason, 200)
    })) : [],
    images: normalizedImages
  };
}

function makeId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseTtl(env) {
  const requested = Number(env.SHARE_TTL_SECONDS);
  return Number.isFinite(requested) && requested >= 60
    ? Math.min(requested, DEFAULT_TTL_SECONDS)
    : DEFAULT_TTL_SECONDS;
}

function apiBaseHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

export async function handleRequest(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (url.pathname === '/health' && method === 'GET') return textResponse('ok');

  if (url.pathname === '/api/shares' || url.pathname.startsWith('/api/shares/')) {
    const origin = allowedOrigin(request, env);
    if (!origin) return jsonResponse({ error: '此來源不可使用分享服務。' }, 403);
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: new Headers({ ...baseHeaders, ...apiBaseHeaders(origin) }) });

    if (url.pathname === '/api/shares' && method === 'POST') {
      if (!env.BILL_SHARES) return jsonResponse({ error: '分享暫存服務尚未設定。' }, 503, origin);
      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > MAX_SHARE_BYTES) return jsonResponse({ error: '帳單及收據合計超過 8 MiB 上限，請減少或縮小收據相片。' }, 413, origin);
      const bodyText = await request.text();
      const bodyBytes = new TextEncoder().encode(bodyText).byteLength;
      if (bodyBytes > MAX_SHARE_BYTES) return jsonResponse({ error: '帳單及收據合計超過 8 MiB 上限，請減少或縮小收據相片。' }, 413, origin);
      let input;
      try { input = JSON.parse(bodyText); }
      catch (_) { return jsonResponse({ error: '分享資料不是有效的 JSON。' }, 400, origin); }
      let data;
      try { data = normalizeShareData(input); }
      catch (error) { return jsonResponse({ error: error.message || '分享資料格式不正確。' }, 400, origin); }
      const serialized = JSON.stringify(data);
      if (new TextEncoder().encode(serialized).byteLength > MAX_SHARE_BYTES) {
        return jsonResponse({ error: '帳單及收據合計超過 8 MiB 上限，請減少或縮小收據相片。' }, 413, origin);
      }
      const id = makeId();
      const ttlSeconds = parseTtl(env);
      const expiresAt = now + ttlSeconds * 1000;
      try {
        await env.BILL_SHARES.put(`share:${id}`, JSON.stringify({ version: 1, createdAt: now, expiresAt, data }), { expirationTtl: ttlSeconds });
      } catch (_) {
        return jsonResponse({ error: '暫時無法儲存分享資料，請稍後再試。' }, 503, origin);
      }
      const shortUrl = new URL(`/s/${id}`, url.origin);
      shortUrl.searchParams.set('e', String(Math.floor(expiresAt / 1000)));
      return jsonResponse({ id, shortUrl: shortUrl.href, expiresAt: new Date(expiresAt).toISOString(), ttlSeconds }, 201, origin);
    }

    const match = url.pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{22})$/);
    if (match && method === 'GET') {
      if (!env.BILL_SHARES) return jsonResponse({ error: '分享暫存服務尚未設定。' }, 503, origin);
      let record;
      try {
        const raw = await env.BILL_SHARES.get(`share:${match[1]}`);
        record = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (_) {
        return jsonResponse({ error: '無法讀取分享資料。' }, 503, origin);
      }
      if (!record) return jsonResponse({ error: '連結已到期或不存在。', code: 'not_found' }, 404, origin);
      if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
        try { await env.BILL_SHARES.delete(`share:${match[1]}`); } catch (_) {}
        return jsonResponse({ error: '這條分享連結已到期。', code: 'expired' }, 410, origin);
      }
      return jsonResponse({ data: record.data, expiresAt: new Date(record.expiresAt).toISOString() }, 200, origin);
    }
    return jsonResponse({ error: '找不到分享 API。' }, 404, origin);
  }

  const shortMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{22})$/);
  if (shortMatch && method === 'GET') {
    const siteBase = String(env.SITE_BASE_URL || 'https://cw91020251212.github.io/bill-splitter-ai/');
    let destination;
    try { destination = new URL('detailed-view.html', siteBase.endsWith('/') ? siteBase : `${siteBase}/`); }
    catch (_) { return textResponse('分享頁未設定。', 503); }
    destination.searchParams.set('share', shortMatch[1]);
    const expiryHint = url.searchParams.get('e');
    if (expiryHint && /^\d{10}$/.test(expiryHint)) destination.searchParams.set('e', expiryHint);
    return new Response(null, {
      status: 302,
      headers: new Headers({
        ...baseHeaders,
        Location: destination.href,
        'Referrer-Policy': 'no-referrer'
      })
    });
  }

  return textResponse('Not found', 404);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
