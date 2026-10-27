const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('./ocr-cascade.js');

const err = (status, detail, extra = {}) => Object.assign(new Error(detail || ''), { status, detail, ...extra });

test('free defaults stay free and paid stays opt-in', () => {
  assert.equal(ocr.DEFAULT_FREE_MODEL, 'nvidia/nemotron-3.5-super-vl:free');
  assert.ok(ocr.FREE_MODEL_IDS.every(id => id.endsWith(':free')));
  assert.equal(ocr.FREE_MODEL_IDS.includes('openrouter/free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'), false);
  assert.equal(ocr.FREE_MODEL_IDS.includes('qwen/qwen2.5-vl-72b-instruct:free'), false);
  assert.equal(ocr.resolveBillModel('google/gemma-4-31b-it:free', false), 'google/gemma-4-31b-it:free');
  assert.equal(ocr.resolveBillModel('google/gemini-3.8-flash', false), ocr.DEFAULT_FREE_MODEL);
  assert.equal(ocr.resolveBillModel('google/gemini-3.8-flash', true), 'google/gemini-3.8-flash');
  assert.equal(ocr.resolveBillModel('retired/model:free', false), ocr.DEFAULT_FREE_MODEL);
  assert.equal(ocr.modelUsesFreeTier('google/gemini-3.8-flash', false), true);
  assert.equal(ocr.modelUsesFreeTier('google/gemini-3.8-flash', true), false);
});

test('cascade starts at the saved free model and visits every other free id once', () => {
  const order = ocr.cascadeOrder('google/gemma-4-31b-it:free');
  assert.equal(order[0], 'google/gemma-4-31b-it:free');
  assert.deepEqual(order.slice(1).includes('google/gemma-4-31b-it:free'), false);
  assert.equal(order.length, ocr.FREE_MODEL_IDS.length);
  assert.deepEqual(new Set(order), new Set(ocr.FREE_MODEL_IDS));
  assert.equal(ocr.cascadeOrder('google/gemini-3.8-flash')[0], ocr.DEFAULT_FREE_MODEL);
  assert.equal(ocr.cascadeOrder('not-a-model').includes('dots-studio/dots-3-note-preview:free'), true);
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

test('request body turns reasoning off only on free vision models', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'receipt' }] }];
  const nemotron = ocr.buildRequestBody('nvidia/nemotron-3.5-super-vl:free', messages);
  assert.deepEqual(nemotron.reasoning, { enabled: false });
  assert.equal(nemotron.max_tokens, 4096);
  assert.equal(nemotron.temperature, 0.1);
  const inkling = ocr.buildRequestBody('thinkingmachines/inkling-small:free', messages);
  assert.deepEqual(inkling.reasoning, { effort: 'none' });
  const gemma = ocr.buildRequestBody('google/gemma-4-31b-it:free', messages);
  assert.deepEqual(gemma.reasoning, { enabled: false });
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
    { modelId: 'nvidia/nemotron-3.5-super-vl:free', error: err(404, 'No endpoints found') },
    { modelId: 'google/gemma-4-31b-it:free', error: err(404, 'No endpoints found for model') }
  ];
  assert.match(ocr.exhaustedMessage(failures), /冇供應商/);
  assert.match(ocr.exhaustedDetail(failures), /Nemotron 3.5 VL：冇供應商/);
  const policy = [{ modelId: ocr.DEFAULT_FREE_MODEL, error: err(404, 'No endpoints found matching your data policy') }];
  assert.match(ocr.exhaustedMessage(policy), /私隱設定/);
  assert.match(ocr.exhaustedMessage(policy), /唔使鎖匙/);
  const limited = ocr.FREE_MODEL_IDS.map(modelId => ({ modelId, error: err(429, 'rate limit') }));
  assert.match(ocr.exhaustedMessage(limited), /429/);
  const mixed = [
    { modelId: ocr.DEFAULT_FREE_MODEL, error: err(0, 'timeout', { timedOut: true }) },
    { modelId: 'google/gemma-4-31b-it:free', error: err(500, 'boom') }
  ];
  assert.match(ocr.exhaustedMessage(mixed), /幾個免費模型都未能讀完/);
  assert.match(ocr.exhaustedDetail(mixed), /等候逾時/);
  assert.match(ocr.describeOpenRouterFailure(401, 'User not found'), /手動分帳同朋友認領都唔使鎖匙/);
  assert.match(ocr.waitingText(ocr.DEFAULT_FREE_MODEL), /^已送到免費 Nemotron 3\.5 VL/);
  assert.match(ocr.switchText('dots-studio/dots-3-note-preview:free'), /改試 Dots3-Note/);
});
