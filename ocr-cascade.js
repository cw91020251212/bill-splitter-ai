/*
 * Free receipt-scan cascade for 分帳管家 AI.
 * Locked on 2026-10-27 from OpenRouter /models and /models/{id}/endpoints.
 * Every id is a free vision model with at least one provider. Paid ids stay
 * opt-in. openrouter/free is not used. Friends never call this.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OcrCascade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Nemotron is first: it reads documents and its Nvidia endpoint was at
  // 100% uptime over the last 30 and 5 minutes. Gemma 4 31B stays in the
  // list (100% over 1 day, reasoning off by default) but its 30-minute
  // uptime was null, so it is no longer the only default.
  // Left out on purpose:
  // - nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free (status -5, 0% uptime)
  // - nvidia/nemotron-3.5-content-safety:free (classifier, not a receipt reader)
  // - every free Qwen VL id (still 0 endpoints)
  const FREE_MODELS = [
    ['nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 VL（免費，預設）', 'Nemotron 3.5 VL (free, default)'],
    ['thinkingmachines/inkling-small:free', 'Inkling Small（免費）', 'Inkling Small (free)'],
    ['google/gemma-4-31b-it:free', 'Gemma 4 31B（免費）', 'Gemma 4 31B (free)'],
    ['dots-studio/dots-3-note-preview:free', 'Dots3-Note（免費）', 'Dots3-Note (free)'],
    ['google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B（免費）', 'Gemma 4 26B (free)'],
    ['thinkingmachines/inkling:free', 'Inkling（免費）', 'Inkling (free)']
  ];
  const PAID_MODELS = [
    ['google/gemini-3.8-flash', 'Gemini 3.8 Flash（較快，可能收費）', 'Gemini 3.8 Flash (faster, may cost money)']
  ];
  const DEFAULT_FREE_MODEL = FREE_MODELS[0][0];
  const FREE_MODEL_IDS = FREE_MODELS.map(model => model[0]);
  const PAID_MODEL_IDS = PAID_MODELS.map(model => model[0]);

  // Reasoning left on eats the reply and the 50s budget. Inkling publishes
  // effort "none". The others accept enabled:false and are not mandatory.
  const REASONING_OFF = {
    'nvidia/nemotron-3.5-super-vl:free': { enabled: false },
    'thinkingmachines/inkling-small:free': { effort: 'none' },
    'thinkingmachines/inkling:free': { effort: 'none' },
    'dots-studio/dots-3-note-preview:free': { enabled: false },
    'google/gemma-4-31b-it:free': { enabled: false },
    'google/gemma-4-26b-a4b-it:free': { enabled: false }
  };

  const OCR_ATTEMPT_MS = 50000;
  const TRANSIENT_ATTEMPTS = 2;
  const OCR_RETRY_BACKOFF_MS = [1200];
  const RECEIPT_MAX_TOKENS = 4096;

  const MESSAGES = {
    keyRejected: '鎖匙被拒（401）。請檢查有冇漏字或黏埋舊鎖匙。手動分帳同朋友認領都唔使鎖匙。',
    providerMissing: 'OpenRouter 暫時冇供應商提供所選模型，所以睇唔到單據。請稍後再試，或改用手動輸入。唔使充值。',
    paymentRequired: '此模型需要付費額度（402）。請改回免費模型；免費使用唔使充值。',
    forbidden: 'OpenRouter 拒絕這次請求（403）。如果揀了進階模型，可能係未有付費額度；免費模型唔使充值。',
    rateLimit: '請求太密或免費額度暫時用盡（429）。請稍後再試，或改用手動輸入。免費模型唔使充值。',
    dataPolicy: 'OpenRouter 因為私隱設定拒絕免費模型（冇符合資料政策的供應商）。請到 https://openrouter.ai/settings/privacy 開啟免費模型所需的資料分享，然後再試。唔使充值。手動輸入同朋友認領都唔使鎖匙。',
    allMissing: '這幾個免費模型暫時都冇供應商，所以睇唔到單據。請稍後再試，或改用手動輸入。唔使充值。',
    allLimited: '免費額度暫時用緊（429）。已經自動改試其他免費模型，都未能讀完。請稍後再試，或改用手動輸入。唔使充值。',
    allFailed: '幾個免費模型都未能讀完這張單。可以再試，或改用手動輸入。唔使充值。',
    paidWaiting: '已送到所選進階模型，等候回覆。進階模型可能產生費用。'
  };

  function isFreeModel(modelId) {
    return FREE_MODEL_IDS.includes(modelId);
  }

  function resolveBillModel(model, allowPaid) {
    if (FREE_MODEL_IDS.includes(model)) return model;
    if (allowPaid === true && PAID_MODEL_IDS.includes(model)) return model;
    return DEFAULT_FREE_MODEL;
  }

  function modelUsesFreeTier(model, allowPaid) {
    return isFreeModel(resolveBillModel(model, allowPaid));
  }

  function shortLabel(modelId) {
    const row = FREE_MODELS.find(model => model[0] === modelId) || PAID_MODELS.find(model => model[0] === modelId);
    if (!row) return '模型';
    return row[1].replace(/（[^）]*）\s*$/, '').trim();
  }

  function waitingText(modelId) {
    if (isFreeModel(modelId)) return `已送到免費 ${shortLabel(modelId)}，等候回覆。`;
    return MESSAGES.paidWaiting;
  }

  function switchText(modelId) {
    return `免費模型讀唔到，改試 ${shortLabel(modelId)}…`;
  }

  function providerMissingDetail(detail) {
    return /no endpoints found|no (?:available |allowed )?providers?|model not found|does not exist|冇供應商/i.test(String(detail || ''));
  }

  function dataPolicyDetail(detail) {
    return /data policy|privacy settings|model training|free model publication|zero data retention|\bzdr\b|資料政策|私隱設定/i.test(String(detail || ''));
  }

  function isRateLimited(status, detail) {
    if (Number(status) === 429) return true;
    return /rate[- ]?limit|too many requests|quota|resource exhausted|免費額度|太忙/i.test(String(detail || ''));
  }

  function describeOpenRouterFailure(status, detail) {
    const code = Number(status) || 0;
    if (dataPolicyDetail(detail)) return MESSAGES.dataPolicy;
    if (code === 401) return MESSAGES.keyRejected;
    if (code === 404 || providerMissingDetail(detail)) return MESSAGES.providerMissing;
    if (code === 402) return MESSAGES.paymentRequired;
    if (code === 403) return MESSAGES.forbidden;
    if (isRateLimited(code, detail)) return MESSAGES.rateLimit;
    if (code === 400 || code === 413 || code === 415) return `圖片或請求未被接受（${code}）。可以再試，或改用手動輸入。`;
    if (code >= 500) return `OpenRouter 暫時未能處理（${code}）。請稍後再試，或改用手動輸入。`;
    return `識別未完成（HTTP ${code}）。可以再試，或改用手動輸入。`;
  }

  // Same-model retry is only for a fast blip. A timeout, a missing provider,
  // and a 429 move to the next free model instead of waiting out the same one.
  function isTransientOcrFailure(error) {
    if (!error || error.name === 'AbortError' || error.timedOut === true) return false;
    const status = Number(error.status) || 0;
    const detail = `${error.detail || ''} ${error.message || ''}`;
    if (status === 401 || dataPolicyDetail(detail) || providerMissingDetail(detail) || status === 404) return false;
    if (isRateLimited(status, detail)) return false;
    if (status === 408 || (status >= 500 && status <= 599)) return true;
    if (status) return false;
    return error.transient === true;
  }

  function shouldCascade(error) {
    if (!error || error.name === 'AbortError') return false;
    return Number(error.status) !== 401;
  }

  function cascadeOrder(selectedId) {
    const start = FREE_MODEL_IDS.includes(selectedId) ? selectedId : DEFAULT_FREE_MODEL;
    return [start, ...FREE_MODEL_IDS.filter(modelId => modelId !== start)];
  }

  function buildRequestBody(modelId, messages) {
    const body = {
      model: modelId,
      messages,
      temperature: 0.1
    };
    if (!isFreeModel(modelId)) return body;
    body.max_tokens = RECEIPT_MAX_TOKENS;
    if (REASONING_OFF[modelId]) body.reasoning = REASONING_OFF[modelId];
    return body;
  }

  function collectText(value, parts) {
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => collectText(item, parts));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.text === 'string') parts.push(value.text);
    if (typeof value.content === 'string') parts.push(value.content);
    else if (value.content) collectText(value.content, parts);
    if (typeof value.summary === 'string') parts.push(value.summary);
  }

  function messageText(message) {
    const contentParts = [];
    collectText(message && message.content, contentParts);
    let text = contentParts.join('\n').trim();
    if (text) return text;
    const reasoningParts = [];
    collectText(message && message.reasoning, reasoningParts);
    if (message && Array.isArray(message.reasoning_details)) collectText(message.reasoning_details, reasoningParts);
    return reasoningParts.join('\n').trim();
  }

  function failureBlob(error) {
    return `${error?.detail || ''} ${error?.message || ''}`;
  }

  function exhaustedMessage(failures) {
    const blobs = (failures || []).map(failure => failureBlob(failure.error));
    if (blobs.length && blobs.every(dataPolicyDetail)) return MESSAGES.dataPolicy;
    if (blobs.length && blobs.every(text => providerMissingDetail(text))) return MESSAGES.allMissing;
    if (blobs.length && blobs.every((text, index) => isRateLimited(failures[index]?.error?.status, text))) return MESSAGES.allLimited;
    return MESSAGES.allFailed;
  }

  function exhaustedDetail(failures) {
    return (failures || []).map(failure => {
      const error = failure.error || {};
      const blob = failureBlob(error);
      let why = '失敗';
      if (dataPolicyDetail(blob)) why = '私隱設定';
      else if (providerMissingDetail(blob)) why = '冇供應商';
      else if (isRateLimited(error.status, blob)) why = '太忙';
      else if (error.timedOut) why = '等候逾時';
      else if (Number(error.status)) why = `HTTP ${Number(error.status)}`;
      else if (error.transient) why = '暫時失敗';
      return `${shortLabel(failure.modelId)}：${why}`;
    }).join(' / ').slice(0, 180);
  }

  return {
    FREE_MODELS,
    PAID_MODELS,
    DEFAULT_FREE_MODEL,
    FREE_MODEL_IDS,
    PAID_MODEL_IDS,
    MESSAGES,
    OCR_ATTEMPT_MS,
    TRANSIENT_ATTEMPTS,
    OCR_RETRY_BACKOFF_MS,
    RECEIPT_MAX_TOKENS,
    isFreeModel,
    resolveBillModel,
    modelUsesFreeTier,
    shortLabel,
    waitingText,
    switchText,
    providerMissingDetail,
    dataPolicyDetail,
    isRateLimited,
    describeOpenRouterFailure,
    isTransientOcrFailure,
    shouldCascade,
    cascadeOrder,
    buildRequestBody,
    messageText,
    exhaustedMessage,
    exhaustedDetail
  };
});
