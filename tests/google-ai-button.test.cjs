const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const release = 'v141-google-ai-green-copy-20261114';

test('Google AI button keeps a green host-primary default without repainting every primary button', () => {
  const html = read('index.html');
  const css = read('theme.css');
  const line = marker => html.split('\n').find(row => row.includes(marker));
  const google = line('data-testid="copy-prompt-open-google-ai"');
  const outline = line('data-testid="copy-receipt-json-prompt"');
  const submit = line('data-testid="submit-receipt-text"');
  const camera = line('data-testid="receipt-camera"');
  assert.match(google, /variant="primary"/);
  assert.match(google, /\bhost-primary\b/);
  assert.match(outline, /variant="outline"/);
  assert.doesNotMatch(outline, /\bhost-primary\b/);
  assert.doesNotMatch(submit, /\bhost-primary\b/);
  assert.match(camera, /\bhost-primary\b/);
  assert.match(css, /#root button\.host-primary\.green-action:not\(\.green-action-dark\):not\(:disabled\)/);
  assert.match(css, /#root main button\.green-action:not\(\.host-primary\):not\(:disabled\)/);
  assert.match(css, /background-color:\s*#2f9d68\s*!important/);
  assert.match(css, /background-color:\s*#fff\s*!important/);
});

test('Google AI copies the receipt prompt before opening Gemini and does not claim a failed copy', () => {
  const html = read('index.html');
  const start = html.indexOf('const copyPromptAndOpenGoogleAI = () => {');
  const end = html.indexOf('const renderTextImportReceiptAttachmentCard', start);
  const fn = html.slice(start, end);
  const openAt = fn.indexOf("window.open('https://gemini.google.com/app'");
  assert.ok(start > 0 && end > start && openAt > 0);
  assert.ok(fn.indexOf('startClipboardWrite(prompt)') < openAt, 'Clipboard API starts before the new tab');
  assert.ok(fn.indexOf('copyTextForGoogleAI(prompt)') < openAt, 'execCommand fallback finishes before the new tab');
  assert.equal(fn.includes('copyToClipboard('), false, 'the combined action no longer uses the toast-on-attempt helper');
  assert.match(fn, /const report = \(copied\) => toast\(copied \? successMessage : failureMessage/);
  assert.match(fn, /if \(copiedSync\) report\(true\);\s*else clipboardPromise\.then\(report\)/);
  assert.match(fn, /未能複製提示詞/);
  assert.match(fn, /Could not copy the prompt/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\) === true/);
  assert.match(html, /textarea\.setSelectionRange\(0, text\.length\)/);
  const prompt = html.slice(html.indexOf('const RECEIPT_JSON_IMPORT_PROMPT_ZH'), html.indexOf('const RECEIPT_JSON_IMPORT_PROMPT_EN'));
  assert.match(prompt, /一個 Markdown JSON 程式碼區塊/);
  assert.match(prompt, /"receiptTotal"/);
  assert.ok(prompt.length > 400);
});

test('R141 cache epoch is on the host shell and does not leak into friend pages', () => {
  const index = read('index.html');
  const sw = read('sw.js');
  const pwa = read('pwa.js');
  assert.match(index, new RegExp(`theme\\.css\\?v=${release}`));
  assert.match(index, new RegExp(`pwa\\.js\\?v=${release}`));
  assert.match(index, new RegExp(`name="bill-app-release" content="${release}"`));
  assert.match(index, />R141</);
  assert.doesNotMatch(index, /v140-host-accent-step1-20261114/);
  assert.doesNotMatch(index, />R140</);
  assert.match(sw, new RegExp(`const CACHE_VERSION = '${release}'`));
  assert.match(pwa, new RegExp(`var RELEASE_VERSION = '${release}'`));
  assert.match(pwa, /version: 'R141'/);
  for (const name of ['claim.html', 'detailed-view.html']) {
    const text = read(name);
    assert.equal(text.includes('theme.css'), false, `${name} must not load host theme.css`);
    assert.equal(text.includes('pwa.js'), false, `${name} must not load host pwa.js`);
    assert.equal(text.includes('copy-prompt-open-google-ai'), false, name);
    assert.equal(text.includes('host-primary'), false, name);
    assert.equal(text.includes(release), false, name);
    assert.equal(text.includes('copyPromptAndOpenGoogleAI'), false, name);
  }
});
