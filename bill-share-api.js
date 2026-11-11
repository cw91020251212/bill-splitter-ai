(function (root) {
  'use strict';

  const MAX_BODY_BYTES = 8 * 1024 * 1024;
  const IMAGE_LIMITS = [
    { edge: 2400, quality: 0.86 },
    { edge: 2000, quality: 0.82 },
    { edge: 1800, quality: 0.78 },
    { edge: 1600, quality: 0.75 },
    { edge: 1400, quality: 0.72 },
    { edge: 1200, quality: 0.68 },
    { edge: 1000, quality: 0.64 }
  ];
  const sleep = ms => new Promise(resolve => root.setTimeout(resolve, ms));
  const formatBytes = bytes => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  function responseError(response, result, fallback) {
    const error = new Error(typeof result.error === 'string' ? result.error : fallback);
    error.status = response.status;
    if (typeof result.code === 'string') error.code = result.code;
    const rawRetryAfter = result.retryAfter ?? response.headers?.get('Retry-After');
    if (rawRetryAfter !== null && rawRetryAfter !== undefined && rawRetryAfter !== '') {
      const seconds = Number(rawRetryAfter);
      const dateMs = Date.parse(String(rawRetryAfter));
      if (Number.isFinite(seconds) && seconds >= 0) error.retryAfter = seconds;
      else if (Number.isFinite(dateMs)) error.retryAfter = Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
    }
    return error;
  }

  // Passwords/edit tokens are request-local only: never log or persist them.
  async function requestJson(path, options = {}, explicitApiBase) {
    const apiBase = getApiBase(explicitApiBase);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (options.writeToken !== undefined) {
      if (typeof options.writeToken !== 'string' || options.writeToken.length !== 43 || !OWNER_TOKEN_PATTERN.test(options.writeToken)) {
        throw Object.assign(new Error('認帳活動管理憑證不完整，請使用建立連結的原裝置。'), { code: 'invalid_owner_token' });
      }
      headers.Authorization = `Bearer ${options.writeToken}`;
    }
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: options.method || 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', headers,
        ...(options.input !== undefined ? { body: JSON.stringify(options.input) } : {})
      });
    } catch (_) {
      throw Object.assign(new Error('暫時連不到分享服務；請檢查網絡後再試。'), { code: 'offline' });
    }
    let result;
    try { result = await response.json(); }
    catch (_) { throw responseError(response, {}, '分享服務回覆格式不正確。'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw responseError(response, {}, '分享服務回覆格式不正確。');
    }
    if (!response.ok && !options.allowStatus?.includes(response.status)) {
      throw responseError(response, result, '認帳服務暫時無法完成要求，請稍後再試。');
    }
    return { result, status: response.status, response };
  }

  function sharePath(id, suffix = '') {
    if (typeof id !== 'string' || id.length !== 22 || !SHARE_ID_PATTERN.test(id)) {
      throw Object.assign(new Error('認帳活動連結格式不正確。'), { code: 'invalid_share_id' });
    }
    return `/api/shares/${encodeURIComponent(id)}${suffix}`;
  }

  async function claimRequest(id, suffix, options, explicitApiBase) {
    return (await requestJson(sharePath(id, `/claims${suffix}`), options, explicitApiBase)).result;
  }

  function ownerOptions(writeToken, method = 'GET', input) {
    if (typeof writeToken !== 'string' || writeToken.length !== 43 || !OWNER_TOKEN_PATTERN.test(writeToken)) {
      throw Object.assign(new Error('認帳活動管理憑證不完整，請使用建立連結的原裝置。'), { code: 'invalid_owner_token' });
    }
    return { writeToken, method, ...(input !== undefined ? { input } : {}) };
  }

  async function getClaimStatus(id, name, explicitApiBase) {
    return claimRequest(id, `/status?name=${encodeURIComponent(String(name || ''))}`, {}, explicitApiBase);
  }

  async function unlockClaim(id, input, explicitApiBase) {
    return claimRequest(id, '/unlock', { method: 'POST', input }, explicitApiBase);
  }

  async function submitSecureClaim(id, input, explicitApiBase) {
    return claimRequest(id, '/submit', { method: 'POST', input }, explicitApiBase);
  }

  async function setupClaimProtection(id, writeToken, members, explicitApiBase) {
    return claimRequest(id, '/setup', ownerOptions(writeToken, 'POST', { members }), explicitApiBase);
  }

  async function getClaimInbox(id, writeToken, cursor = 0, explicitApiBase) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw Object.assign(new Error('認帳同步位置無效。'), { code: 'invalid_cursor' });
    }
    return claimRequest(id, `/inbox?after=${cursor}`, ownerOptions(writeToken), explicitApiBase);
  }

  async function approveClaimPassword(id, writeToken, name, explicitApiBase) {
    return claimRequest(id, '/approve', ownerOptions(writeToken, 'POST', { name }), explicitApiBase);
  }

  function getApiBase(explicit) {
    const configured = explicit || root.BillShareConfig?.apiBaseUrl || '';
    if (!configured) throw new Error('短連結服務尚未設定；目前只可在本機預覽，未能建立朋友連結。');
    let parsed;
    try { parsed = new URL(configured); }
    catch (_) { throw new Error('短連結服務網址設定無效。'); }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) throw new Error('短連結服務只可使用 HTTPS。');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  }

  function imageToDataUrl(image) {
    if (!image || typeof image.data !== 'string' || !image.data) throw new Error('有收據相片資料無法讀取。');
    return `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`;
  }

  function blobToBase64(blob) {
    return blob.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return root.btoa(binary);
    });
  }

  function encodeReceipt(imageData, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = async () => {
        try {
          const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
          const scale = Math.min(1, maxEdge / longest);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('無法處理收據相片。');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const makeBlob = mime => new Promise((done, fail) => {
            canvas.toBlob(blob => blob ? done(blob) : fail(new Error('無法壓縮收據相片。')), mime, quality);
          });
          let blob = await makeBlob('image/webp');
          if (blob.type !== 'image/webp') blob = await makeBlob('image/jpeg');
          resolve({ mimeType: blob.type, data: await blobToBase64(blob) });
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('有收據相片無法載入或格式不支援。'));
      image.src = imageToDataUrl(imageData);
    });
  }

  async function prepareShareData(data) {
    const original = JSON.parse(JSON.stringify(data));
    if (!Array.isArray(original.images)) original.images = [];
    if (original.images.length > 5) throw new Error('一條朋友連結最多可包括 5 張收據相片。');
    const originalSize = jsonBytes(original);
    const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const needsConversion = original.images.some(image => !supportedTypes.has(image.mimeType));
    if (originalSize <= MAX_BODY_BYTES && !needsConversion) return original;

    let candidate = original;
    for (const level of IMAGE_LIMITS) {
      const compressedImages = [];
      for (const image of original.images) compressedImages.push(await encodeReceipt(image, level.edge, level.quality));
      candidate = { ...original, images: compressedImages };
      if (jsonBytes(candidate) <= MAX_BODY_BYTES) return candidate;
    }
    const finalSize = jsonBytes(candidate);
    throw new Error(`收據相片壓縮至最長邊 1,000 px 後，整份資料仍約 ${formatBytes(finalSize)}，超出 8 MiB 限制；請減少相片數量或先縮小相片。`);
  }

  async function createShortLink(data, explicitApiBase) {
    const prepared = await prepareShareData(data);
    if (jsonBytes(prepared) > MAX_BODY_BYTES) throw new Error('分享資料超過 8 MiB 限制。');
    const { result } = await requestJson('/api/shares', { method: 'POST', input: prepared }, explicitApiBase);
    if (!result.shortUrl || !result.expiresAt) throw new Error('短連結服務回覆欠缺連結或到期時間。');
    return result;
  }

  async function getShare(shareId, expectedExpiresAt, explicitApiBase) {
    const path = sharePath(shareId);
    const expiryMs = Number(expectedExpiresAt) > 0 ? Number(expectedExpiresAt) * 1000 : 0;
    const retryDelays = [750, 1500, 3000, 6000, 12000, 18000];
    for (let attempt = 0; ; attempt += 1) {
      const { response, result } = await requestJson(path, { allowStatus: [404, 410] }, explicitApiBase);
      if (response.ok) return result;
      if (response.status === 410 || result.code === 'expired') throw responseError(response, { ...result, error: '這條朋友分享連結已到期；請向建立者索取新連結。' }, '');
      const canRetry = response.status === 404 && expiryMs > Date.now() && attempt < retryDelays.length;
      if (canRetry) {
        await sleep(retryDelays[attempt]);
        continue;
      }
      if (response.status === 404 && expiryMs && expiryMs <= Date.now()) throw responseError(response, { ...result, error: '這條朋友分享連結已到期；請向建立者索取新連結。' }, '');
      throw responseError(response, result, '這條朋友分享連結已到期或不存在。');
    }
  }

  async function createSession(ttlDays, explicitApiBase) {
    const { result } = await requestJson('/api/shares/sessions', {
      method: 'POST', input: { ttlDays: Number(ttlDays) }
    }, explicitApiBase);
    if (typeof result.id !== 'string' || result.id.length !== 22 || !SHARE_ID_PATTERN.test(result.id) || typeof result.writeToken !== 'string' || result.writeToken.length !== 43 || !OWNER_TOKEN_PATTERN.test(result.writeToken) || !result.expiresAt) {
      throw new Error(result.error || '未能建立共用認帳連結，請稍後再試。');
    }
    return result;
  }

  async function publishSession(shareId, writeToken, data, explicitApiBase) {
    const path = sharePath(shareId);
    const options = ownerOptions(writeToken, 'PUT');
    const prepared = await prepareShareData(data);
    if (jsonBytes(prepared) > MAX_BODY_BYTES) throw new Error('分享資料超過 8 MiB 限制。');
    return (await requestJson(path, { ...options, input: prepared }, explicitApiBase)).result;
  }

  async function getSession(shareId, explicitApiBase) {
    const { result, status } = await requestJson(sharePath(shareId), { allowStatus: [404, 410] }, explicitApiBase);
    if (status === 202 || result.status === 'pending') return { ...result, status: 'pending', expiresAt: result.expiresAt || '', serverNow: result.serverNow || '' };
    if (status === 404 || status === 410) {
      return { ...result, status: status === 410 || result.code === 'expired' ? 'expired' : 'unknown', expiresAt: result.expiresAt || '', serverNow: result.serverNow || '' };
    }
    return { ...result, status: result.status || 'ready' };
  }

  async function getSessionRevision(shareId, explicitApiBase) {
    const { result, status } = await requestJson(sharePath(shareId, '?meta=1'), { allowStatus: [404, 410] }, explicitApiBase);
    if (status === 202 || result.status === 'pending') return { ...result, status: 'pending', resultRevision: Number(result.resultRevision) || 0 };
    if (status === 404 || status === 410) {
      return { ...result, status: status === 410 || result.code === 'expired' ? 'expired' : 'unknown', resultRevision: Number(result.resultRevision) || 0 };
    }
    return { ...result, status: result.status || 'ready', resultRevision: Number(result.resultRevision) || 0 };
  }

  root.BillShareApi = Object.freeze({
    MAX_BODY_BYTES,
    prepareShareData,
    createShortLink,
    getShare,
    createSession,
    publishSession,
    getSession,
    getSessionRevision,
    getClaimStatus,
    unlockClaim,
    submitSecureClaim,
    setupClaimProtection,
    getClaimInbox,
    approveClaimPassword,
    formatBytes
  });
})(window);
