const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const release = 'v142-dark-green-white-label-20261114';

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function contrastWithWhite(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const luminance = 0.2126 * linearize(channels[0]) + 0.7152 * linearize(channels[1]) + 0.0722 * linearize(channels[2]);
  return 1.05 / (luminance + 0.05);
}
function ruleBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(start, close + 1);
}
function fillColors(block) {
  const background = [...block.matchAll(/background(?:-image|-color)?:[^;]+;/g)].map(match => match[0]).join(' ');
  return [...background.matchAll(/#([0-9a-fA-F]{6})/g)].map(match => `#${match[1].toLowerCase()}`);
}

test('Google AI button keeps a green host-primary default without repainting every primary button', () => {
  const html = read('index.html');
  const css = read('theme.css');
  const line = marker => html.split('\n').find(row => row.includes(marker));
  const google = line('data-testid="copy-prompt-open-google-ai"');
  const outline = line('data-testid="copy-receipt-json-prompt"');
  const submit = line('data-testid="submit-receipt-text"');
  const camera = line('data-testid="receipt-camera"');
  const report = line('data-testid="calculate-split"');
  const hint = line('data-testid="calculate-split-hint"');
  const menu = line('className="header-action-menu-trigger');
  assert.match(google, /variant="primary"/);
  assert.match(google, /\bhost-primary\b/);
  assert.match(outline, /variant="outline"/);
  assert.doesNotMatch(outline, /\bhost-primary\b/);
  assert.doesNotMatch(outline, /\btext-white\b/);
  assert.doesNotMatch(submit, /\bhost-primary\b/);
  assert.match(camera, /\bhost-primary\b/);
  assert.match(report, /\bhost-primary\b/);
  assert.match(hint, /\btext-white\b/);
  assert.doesNotMatch(hint, /text-white\/95|textShadow:\s*'none'/);
  assert.match(menu, /\bgreen-action-dark\b/);
  const host = ruleBlock(css, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled) {');
  const hostSvg = ruleBlock(css, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled) svg');
  const light = ruleBlock(css, '#root main button.green-action:not(.host-primary):not(:disabled) {');
  const hintRule = ruleBlock(css, '#root button.host-primary.green-action:not(:disabled) [data-testid="calculate-split-hint"]');
  const disabledHint = ruleBlock(css, '#root button.green-action:disabled [data-testid="calculate-split-hint"]');
  assert.match(host, /color:\s*#fff\s*!important/);
  assert.match(host, /text-shadow:\s*0 1px 1px rgba\(0,\s*0,\s*0,\s*\.35\)\s*!important/);
  assert.doesNotMatch(host, /color:\s*#000/);
  assert.match(host, /background-color:\s*#1d7349\s*!important/);
  assert.doesNotMatch(css, /background-color:\s*#2f9d68\s*!important/);
  assert.match(hostSvg, /color:\s*#fff\s*!important/);
  assert.match(hintRule, /color:\s*#fff\s*!important/);
  assert.match(hintRule, /text-shadow:\s*0 1px 1px rgba\(0,\s*0,\s*0,\s*\.35\)\s*!important/);
  assert.doesNotMatch(hintRule, /#123d2c/);
  assert.match(disabledHint, /color:\s*#5c6560\s*!important/);
  assert.match(light, /background-color:\s*#fff\s*!important/);
  assert.match(light, /(?:^|\n)\s*color:\s*#2c3330\s*!important/);
  assert.doesNotMatch(light, /(?:^|\n)\s*color:\s*#fff/);
  for (const [label, block] of [['host-primary', host], ['host-primary hover', ruleBlock(css, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled):hover')], ['host-primary active', ruleBlock(css, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled):active')]]) {
    const fills = fillColors(block);
    assert.ok(fills.length >= 1, `${label} declares a fill`);
    for (const fill of fills) {
      const ratio = contrastWithWhite(fill);
      assert.ok(ratio >= 4.5, `${label} ${fill} vs white is ${ratio.toFixed(2)}, need >= 4.5`);
    }
  }
  assert.ok(contrastWithWhite('#2c3330') >= 4.5, 'dark text on the white secondary action still clears AA');
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

test('R142 cache epoch is on the host shell and does not leak into friend pages', () => {
  const index = read('index.html');
  const sw = read('sw.js');
  const pwa = read('pwa.js');
  assert.match(index, new RegExp(`theme\\.css\\?v=${release}`));
  assert.match(index, new RegExp(`pwa\\.js\\?v=${release}`));
  assert.match(index, new RegExp(`name="bill-app-release" content="${release}"`));
  assert.match(index, />R142</);
  assert.doesNotMatch(index, /v141-google-ai-green-copy-20261114/);
  assert.doesNotMatch(index, />R141</);
  assert.match(sw, new RegExp(`const CACHE_VERSION = '${release}'`));
  assert.match(pwa, new RegExp(`var RELEASE_VERSION = '${release}'`));
  assert.match(pwa, /version: 'R142'/);
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
