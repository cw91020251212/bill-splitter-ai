const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('./ocr-cascade.js');

const err = (status, detail, extra = {}) => Object.assign(new Error(detail || ''), { status, detail, ...extra });
const dotsModel = 'dots-studio/dots-3-note-preview:free';
const lastFallbackModel = 'nvidia/nemotron-3.5-super-vl:free';
const retiredNanoModel = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const randomModel = 'openrouter/free';

test('free defaults stay free, random is selectable, and paid stays opt-in', () => {
  assert.equal(ocr.DEFAULT_FREE_MODEL, dotsModel);
  assert.equal(ocr.MODEL_PREFERENCE_VERSION, 5);
  assert.deepEqual(ocr.FREE_MODEL_IDS, [dotsModel, lastFallbackModel, randomModel]);
  assert.deepEqual(ocr.CASCADE_MODEL_IDS, [dotsModel, lastFallbackModel]);
  assert.equal(ocr.FREE_MODEL_IDS.includes('thinkingmachines/inkling-small:free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('thinkingmachines/inkling:free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes(retiredNanoModel), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('google/gemma-4-31b-it:free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('google/gemma-4-26b-a4b-it:free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('qwen/qwen2.5-vl-72b-instruct:free'), false);
  assert.equal(ocr.resolveBillModel(randomModel, false), randomModel);
  assert.equal(ocr.isFreeModel(randomModel), true);
  assert.equal(ocr.modelUsesFreeTier(randomModel, false), true);
  assert.equal(ocr.resolveBillModel('google/gemini-3.8-flash', false), dotsModel);
  assert.equal(ocr.resolveBillModel('google/gemini-3.8-flash', true), 'google/gemini-3.8-flash');
  assert.equal(ocr.resolveBillModel('retired/model:free', false), dotsModel);
  assert.equal(ocr.modelUsesFreeTier('google/gemini-3.8-flash', false), true);
  assert.equal(ocr.modelUsesFreeTier('google/gemini-3.8-flash', true), false);
});

test('fixed cascade keeps its order and random is used only when explicitly selected', () => {
  const retiredOrder = ocr.cascadeOrder(retiredNanoModel);
  assert.deepEqual(retiredOrder, [dotsModel, lastFallbackModel], 'retired Nano selection falls back to the fixed models');
  assert.deepEqual(ocr.cascadeOrder(dotsModel), [dotsModel, lastFallbackModel]);
  assert.deepEqual(ocr.cascadeOrder(lastFallbackModel), [lastFallbackModel, dotsModel]);
  assert.deepEqual(ocr.cascadeOrder(randomModel), [randomModel], 'the random router is never appended to the automatic cascade');
  assert.deepEqual(ocr.cascadeOrder('google/gemini-3.8-flash'), [dotsModel, lastFallbackModel]);
  assert.deepEqual(ocr.cascadeOrder('not-a-model'), [dotsModel, lastFallbackModel]);
});

test('provider loss and rate limits cascade without retrying the same model', () => {
  const missing = err(404, 'No endpoints found for google/gemma-4-31b-it:free.');
  const policy = err(404, 'No endpoints found matching your data policy (Free model publication).');
  const limited = err(429, 'Rate limit exceeded');
  const timeout = err(0, '免費模型等候逾時。可以再試，或改用手動輸入。', { timedOut: true, transient: false });
  const blip = err(503, 'Provider unavailable');
  const empty = err(0, 'OpenRouter 伺服器未回傳內容。', { transient: true });
  const rejected = err(401, 'User not found');
  const aborted = Object.assign(new Error('Aborted'), { name: 'AbortError' });

  for (const error of [missing, policy, limited, timeout]) {
    assert.equal(ocr.isTransientOcrFailure(error), false, error.detail || error.message);
    assert.equal(ocr.shouldCascade(error), true);
  }
  assert.equal(ocr.isTransientOcrFailure(blip), true);
  assert.equal(ocr.shouldCascade(blip), true);
  assert.equal(ocr.isTransientOcrFailure(empty), true);
  assert.equal(ocr.isTransientOcrFailure(rejected), false);
  assert.equal(ocr.shouldCascade(rejected), false);
  assert.equal(ocr.shouldCascade(aborted), false);
});

test('request body turns reasoning off only on fixed free vision models', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'receipt' }] }];
  const dotsDefault = ocr.buildRequestBody(ocr.DEFAULT_FREE_MODEL, messages);
  assert.deepEqual(dotsDefault.reasoning, { enabled: false });
  assert.equal(dotsDefault.max_tokens, 4096);
  assert.equal(dotsDefault.temperature, 0.1);
  const dots = ocr.buildRequestBody(dotsModel, messages);
  assert.deepEqual(dots.reasoning, { enabled: false });
  const lastFallback = ocr.buildRequestBody(lastFallbackModel, messages);
  assert.deepEqual(lastFallback.reasoning, { enabled: false });
  const random = ocr.buildRequestBody(randomModel, messages);
  assert.equal(random.model, randomModel);
  assert.equal(random.max_tokens, 4096);
  assert.equal(random.reasoning, undefined);
  const paid = ocr.buildRequestBody('google/gemini-3.8-flash', messages);
  assert.equal(paid.reasoning, undefined);
  assert.equal(paid.max_tokens, undefined);
  assert.equal(paid.model, 'google/gemini-3.8-flash');
});

test('message text accepts string content, parts, and reasoning fallback', () => {
  assert.equal(ocr.messageText({ content: '{"items":[]}' }), '{"items":[]}');
  assert.equal(ocr.messageText({ content: [{ type: 'text', text: '{"items":[1]}' }] }), '{"items":[1]}');
  assert.equal(ocr.messageText({ content: '', reasoning: '{"items":[2]}' }), '{"items":[2]}');
  assert.equal(ocr.messageText({ content: null, reasoning_details: [{ text: '{"items":[3]}' }] }), '{"items":[3]}');
  assert.equal(ocr.messageText({ content: '  ' }), '');
});

test('exhausted copy stays in Traditional Chinese and names the cause', () => {
  const failures = [
    { modelId: dotsModel, error: err(404, 'No endpoints found') },
    { modelId: lastFallbackModel, error: err(404, 'No endpoints found for model') }
  ];
  assert.match(ocr.exhaustedMessage(failures), /冇供應商/);
  assert.match(ocr.exhaustedDetail(failures), /Nemotron 3.5 VL：冇供應商/);
  const policy = [{ modelId: ocr.DEFAULT_FREE_MODEL, error: err(404, 'No endpoints found matching your data policy') }];
  assert.match(ocr.exhaustedMessage(policy), /私隱設定/);
  assert.match(ocr.exhaustedMessage(policy), /唔使鎖匙/);
  const limited = ocr.CASCADE_MODEL_IDS.map(modelId => ({ modelId, error: err(429, 'rate limit') }));
  assert.match(ocr.exhaustedMessage(limited), /429/);
  const randomLimited = [{ modelId: randomModel, error: err(429, 'rate limit') }];
  assert.match(ocr.exhaustedMessage(randomLimited), /429/);
  const randomTimeout = [{ modelId: randomModel, error: err(0, 'timeout', { timedOut: true }) }];
  assert.match(ocr.exhaustedMessage(randomTimeout), /隨機模型等候逾時/);
  const mixed = [
    { modelId: ocr.DEFAULT_FREE_MODEL, error: err(0, 'timeout', { timedOut: true }) },
    { modelId: lastFallbackModel, error: err(500, 'boom') }
  ];
  assert.match(ocr.exhaustedMessage(mixed), /幾個免費模型都未能讀完/);
  assert.match(ocr.exhaustedDetail(mixed), /等候逾時/);
  assert.match(ocr.describeOpenRouterFailure(401, 'User not found'), /手動分帳同各自認帳都唔使鎖匙/);
  assert.match(ocr.waitingText(ocr.DEFAULT_FREE_MODEL), /^已送到免費 Dots3-Note/);
  assert.match(ocr.waitingText(randomModel), /OpenRouter 免費隨機模型，可能較慢/);
  assert.match(ocr.switchText(lastFallbackModel), /改試 Nemotron 3.5 VL/);
});
