const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const release = 'v156-external-ai-overlay-fix-20261115';

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function contrastWithWhite(hex) {
  return contrast(hex, '#ffffff');
}
function contrast(foreground, background) {
  const luminance = hex => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    return 0.2126 * linearize(channels[0]) + 0.7152 * linearize(channels[1]) + 0.0722 * linearize(channels[2]);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
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
  const buttonLine = marker => html.split('\n').find(row => row.includes(marker) && row.includes('<Button'));
  const google = buttonLine('data-testid="copy-prompt-open-google-ai"');
  const outline = buttonLine('data-testid="copy-receipt-json-prompt"');
  const submit = buttonLine('data-testid="submit-receipt-text"');
  const camera = buttonLine('data-testid="receipt-camera"');
  const report = buttonLine('data-testid="calculate-split"');
  const hint = line('data-testid="calculate-split-hint"');
  const menu = line('className="header-action-menu-trigger');
  assert.match(google, /variant="primary"/);
  assert.match(google, /\bhost-primary\b/);
  assert.match(outline, /variant="outline"/);
  assert.doesNotMatch(outline, /\bhost-primary\b/);
  assert.doesNotMatch(outline, /\btext-white\b/);
  assert.match(submit, /\bhost-primary\b/);
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
  assert.match(light, /background-image:\s*var\(--brand-action-gradient\)\s*!important/);
  assert.match(light, /background-color:\s*#80d9aa\s*!important/);
  assert.match(light, /(?:^|\n)\s*color:\s*#123d2c\s*!important/);
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
  const openAt = html.indexOf("window.open('https://gemini.google.com/app'");
  assert.ok(start > 0 && end > start && openAt > 0, 'Gemini is opened by a separate tutorial continue action');
  assert.match(html.slice(html.indexOf('const continueToGoogleAI ='), html.indexOf('const renderTextImportReceiptAttachmentCard')), /window\.open\('https:\/\/gemini\.google\.com\/app'/);
  assert.ok(fn.indexOf('startClipboardWrite(prompt)') >= 0 && fn.indexOf('copyTextForGoogleAI(prompt)') > fn.indexOf('startClipboardWrite(prompt)'), 'prompt copy is initiated before showing the guide');
  assert.match(fn, /setShowGoogleAiGuide\(true\)/);
  assert.match(html, /data-testid=\"google-ai-guide-continue\"/);
  assert.match(fn, /setGoogleAiPromptPreview\(prompt\)/);
  assert.match(html, /value=\{receiptTextDraft \|\| googleAiPromptPreview\}/);
  assert.match(html, /text === String\(googleAiPromptPreview \|\| ''\)\.trim\(\)/);
  assert.equal(fn.slice(0, fn.indexOf('const continueToGoogleAI')).includes('window.open('), false, 'the first action does not leave the page');
  assert.equal(fn.includes('copyToClipboard('), false, 'the combined action does not use the toast-on-attempt helper');
  assert.match(html, /提示詞未能複製/);
  assert.match(html, /The prompt was not copied/);
  const submit = html.slice(html.indexOf('const submitReceiptTextImport ='), html.indexOf('const handleReceiptTextFileUpload =', html.indexOf('const submitReceiptTextImport =')));
  assert.match(submit, /navigator\.clipboard\?\.readText/);
  assert.match(submit, /handleFileUpload/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\) === true/);
  assert.match(html, /textarea\.setSelectionRange\(0, text\.length\)/);
  const prompt = html.slice(html.indexOf('const RECEIPT_JSON_IMPORT_PROMPT_ZH'), html.indexOf('const RECEIPT_JSON_IMPORT_PROMPT_EN'));
  assert.match(prompt, /一個 Markdown JSON 程式碼區塊/);
  assert.match(prompt, /"receiptTotal"/);
  assert.ok(prompt.length > 400);
});

test('R156 cache epoch is on the host shell and does not leak into friend pages', () => {
  const index = read('index.html');
  const sw = read('sw.js');
  const pwa = read('pwa.js');
  assert.match(index, new RegExp(`theme\\.css\\?v=${release}`));
  assert.match(index, new RegExp(`pwa\\.js\\?v=${release}`));
  assert.match(index, new RegExp(`name="bill-app-release" content="${release}"`));
  assert.match(index, />R156</);
  assert.doesNotMatch(index, /v142-dark-green-white-label-20261114/);
  assert.doesNotMatch(index, />R148</);
  assert.doesNotMatch(index, />R147</);
  assert.doesNotMatch(index, />R146</);
  assert.doesNotMatch(index, />R142</);
  assert.match(sw, new RegExp(`const CACHE_VERSION = '${release}'`));
  assert.match(pwa, new RegExp(`var RELEASE_VERSION = '${release}'`));
  assert.match(pwa, /version: 'R156'/);
  assert.match(index, /data-testid="external-ai-action-backdrop"/);
  assert.match(index, /setShowExternalAiActionOverlay\(true\)/);
  for (const name of ['claim.html', 'detailed-view.html']) {
    const text = read(name);
    assert.equal(text.includes('theme.css'), false, `${name} must not load host theme.css`);
    assert.equal(text.includes('pwa.js'), false, `${name} must not load host pwa.js`);
    assert.equal(text.includes('copy-prompt-open-google-ai'), false, name);
    assert.equal(text.includes('host-primary'), false, name);
    assert.equal(text.includes(release), false, name);
    assert.equal(text.includes('copyPromptAndOpenGoogleAI'), false, name);
    assert.equal(text.includes('icons.refresh'), false, name);
    assert.equal(text.includes('#ffe566'), false, name);
  }
});

test('R146 white action labels, yellow icons, Google wordmark, and bold labels stay on the host', () => {
  const index = read('index.html');
  const css = read('theme.css');
  const publish = index.split('\n').find(row => row.includes('<Button data-testid="publish-same-link-result"'));
  const updateIcon = index.split('\n').find(row => row.includes('更新結果'));
  const whatsapp = index.split('\n').find(row => row.includes('<Button data-testid="friend-whatsapp-share"'));
  const copy = index.split('\n').find(row => row.includes('<Button data-testid="copy-friend-share-link"'));
  assert.match(updateIcon, /icons\.refresh/);
  assert.doesNotMatch(updateIcon, /icons\.share/);
  assert.match(whatsapp, /icons\.share/);
  assert.doesNotMatch(whatsapp, /icons\.refresh/);
  assert.match(copy, /icons\.copy/);
  assert.match(index, /refresh: '<path d="M3 12a9 9 0 0 1 9-9/);
  const actionLabel = ruleBlock(css, '#root button.host-primary.green-action:not(:disabled):not([data-testid="copy-prompt-open-google-ai"]) {');
  assert.match(actionLabel, /color:\s*#fff\s*!important/);
  assert.match(actionLabel, /text-shadow:\s*0 1px 1px rgba\(0,\s*0,\s*0,\s*\.35\)\s*!important/);
  const whiteOnLightest = contrast('#ffffff', '#29835f');
  const whiteOnMid = contrast('#ffffff', '#1d7349');
  assert.ok(whiteOnLightest >= 4.5, `white vs #29835f is ${whiteOnLightest.toFixed(2)}, need >= 4.5`);
  assert.ok(whiteOnMid >= 4.5, `white vs #1d7349 is ${whiteOnMid.toFixed(2)}, need >= 4.5`);
  assert.ok(contrast('#ffffff', '#29835f') >= 4.5, 'white descriptions still clear 4.5:1 on the lightest fill');
  for (const [letter, hex, fill] of [['blue', '#4285F4', '#29835f'], ['red', '#EA4335', '#29835f'], ['wordmark yellow', '#FBBC05', '#29835f'], ['green', '#34A853', '#29835f']]) {
    assert.match(css, new RegExp(hex, 'i'), `${letter} keeps official ${hex}`);
  }
  assert.match(css, /\.gw-blue[\s\S]*#4285F4/);
  assert.match(css, /\.gw-red[\s\S]*#EA4335/);
  assert.match(css, /\.gw-yellow[\s\S]*#FBBC05/);
  assert.match(css, /\.gw-green[\s\S]*#34A853/);
  assert.match(css, /text-shadow:[\s\S]*rgba\(255,\s*248,\s*220/);
  assert.match(index, /className="gw gw-blue">G</);
  assert.match(index, /className="gw gw-red">o</);
  assert.match(index, /className="gw gw-yellow">o</);
  assert.match(index, /className="gw gw-blue">g</);
  assert.match(index, /className="gw gw-green">l</);
  assert.match(index, /className="gw gw-red">e</);
  assert.match(index, /className="gw gw-ai"> AI</);
  assert.match(css, /#root button \{ font-weight: 700; \}/);
  assert.match(css, /#root \.step-nav button \{ font-weight: 600; \}/);
  assert.match(css, /#root button \.btn-aside \{ font-weight: 400; \}/);
  assert.match(index, /className="btn-aside"/);
  assert.match(css, /background-color:\s*#e7ebe8\s*!important/);
  assert.match(css, /border-color:\s*#d2d8d4\s*!important/);
  assert.match(css, /color:\s*#9aa39d\s*!important/);
  assert.match(index, /text-size-face-sm/);
  assert.match(index, /text-size-face-md/);
  assert.match(index, /text-size-face-lg/);
  assert.match(index, /min-height:\s*52px/);
  assert.equal(publish.includes('host-primary') || updateIcon.includes('icons.refresh'), true);
  const shareClaim = index.split('\n').find(row => row.includes('<Button data-testid="open-claim-share-button"'));
  const copyClaim = index.split('\n').find(row => row.includes('<Button data-testid="copy-friend-claim-link"'));
  assert.match(shareClaim, /\bhost-primary\b/);
  assert.doesNotMatch(copyClaim, /\bhost-primary\b/);
  assert.match(index, /分享認帳連結/);
  const shareLabel = ruleBlock(css, '#root button.host-primary.green-action[data-testid="open-claim-share-button"]:not(:disabled):not([data-testid="copy-prompt-open-google-ai"])');
  const shareIcon = ruleBlock(css, '#root button.host-primary.green-action[data-testid="open-claim-share-button"]:not(:disabled) svg');
  assert.match(shareLabel, /color:\s*#fff\s*!important/);
  assert.match(shareLabel, /text-shadow:\s*0 1px 1px rgba\(0,\s*0,\s*0,\s*\.35\)\s*!important/);
  assert.match(shareIcon, /color:\s*#ffe566\s*!important/);
  assert.doesNotMatch(shareLabel, /#ffe566/);
});
