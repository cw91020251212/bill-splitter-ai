'use strict';
// The copied Google prompt must stop a no-image reply before any JSON is invented.
// node tests/prompt-missing-image.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function prompt(name) {
  const marker = `const ${name} = \``;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const from = start + marker.length;
  const end = html.indexOf('`;', from);
  assert.notEqual(end, -1, `${name} template ends`);
  return html.slice(from, end);
}

const zh = prompt('RECEIPT_JSON_IMPORT_PROMPT_ZH');
const en = prompt('RECEIPT_JSON_IMPORT_PROMPT_EN');
const zhGate = '如果今次訊息沒有附上收據圖片';
const zhReply = '未見收據圖片。請而家喺呢度補上收據圖片，再送出一次。';
const enGate = 'If this message has no receipt image attached';
const enReply = 'No receipt image attached. Attach the receipt photo here, then send again.';

assert.ok(zh.indexOf(zhGate) !== -1 && zh.indexOf(zhGate) < zh.indexOf('請辨認我附上的收據圖片'), 'Chinese prompt checks for a missing image before it asks the model to read one');
assert.match(zh, /不要輸出 JSON/);
assert.match(zh, /不要照抄下方示例/);
assert.match(zh, /不要猜測或捏造/);
assert.ok(zh.includes(zhReply), 'Chinese prompt tells the model to ask for the receipt and nothing else');

assert.ok(en.indexOf(enGate) !== -1 && en.indexOf(enGate) < en.indexOf('Read the receipt image'), 'English prompt checks for a missing image before it asks the model to read one');
assert.match(en, /do not output JSON/i);
assert.match(en, /do not copy the example/i);
assert.match(en, /do not guess or invent/i);
assert.ok(en.includes(enReply), 'English prompt tells the model to ask for the receipt and nothing else');

console.log('prompt missing-image checks passed');
