const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(root, 'theme.css'), 'utf8');
const detailed = fs.readFileSync(path.join(root, 'detailed-view.html'), 'utf8');
const refresh = fs.readFileSync(path.join(root, 'ui-refresh.css'), 'utf8');
const icon = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8').toLowerCase();

function ruleBlock(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `missing rule: ${selector}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(start, close + 1);
}

function lastRuleBlock(source, selector) {
  const start = source.lastIndexOf(selector);
  assert.ok(start >= 0, `missing rule: ${selector}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(start, close + 1);
}

function logoStops() {
  const gradient = icon.match(/<lineargradient id="bg" x1="0" y1="1" x2="1" y2="0">([\s\S]*?)<\/lineargradient>/);
  assert.ok(gradient, 'read the original logo background gradient and its lower-left to upper-right direction');
  const stops = [...gradient[1].matchAll(/<stop offset="([^"]+)" stop-color="(#[0-9a-f]{6})"\s*\/>/g)];
  assert.deepEqual(stops.map(stop => stop[1]), ['0', '0.5', '1'], 'use the exact original logo stop positions');
  assert.deepEqual(stops.map(stop => stop[2]), ['#0f6b42', '#1f9a64', '#62d29a'], 'use the exact original logo colors');
  return stops.map(stop => stop[2]);
}

function colorStops(source, name) {
  const match = source.match(new RegExp(`--${name}:\\s*linear-gradient\\(to top right,\\s*(#[0-9a-f]{6}) 0%,\\s*(#[0-9a-f]{6}) 50%,\\s*(#[0-9a-f]{6}) 100%\\)`, 'i'));
  assert.ok(match, `${name} must use the exact lower-left to upper-right logo gradient and stop positions`);
  return match.slice(1).map(color => color.toLowerCase());
}

const expectedFallback = /background-color:\s*#0f6b42/i;

test('green action gradients reuse the original logo stops in every state and keep the approved shadows', () => {
  const stops = logoStops();
  for (const name of ['brand-action-gradient', 'brand-action-gradient-hover', 'brand-action-gradient-active']) {
    assert.deepEqual(colorStops(theme, name), stops, `${name} must exactly reuse icon.svg colors and positions`);
    assert.deepEqual(colorStops(detailed, name), stops, `detail-page ${name} must exactly reuse icon.svg colors and positions`);
  }

  const host = ruleBlock(theme, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled) {');
  const light = ruleBlock(theme, '#root main button.green-action:not(.host-primary):not(:disabled) {');
  const language = lastRuleBlock(theme, '#root button[data-ui-language][aria-pressed="true"] {');
  const activeStep = lastRuleBlock(theme, '#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4) {');
  assert.match(host, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(host, expectedFallback);
  assert.match(host, /color:\s*#fff\s*!important/);
  assert.match(host, /text-shadow:\s*0 1px 2px rgba\(0,\s*0,\s*0,\s*\.42\)\s*!important/);
  assert.match(host, /box-shadow:\s*var\(--brand-action-shadow\)\s*!important/);
  assert.match(light, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(light, expectedFallback);
  assert.match(light, /color:\s*#fff\s*!important/);
  assert.match(light, /text-shadow:\s*0 1px 2px rgba\(0,\s*0,\s*0,\s*\.42\)\s*!important/);
  assert.match(light, /box-shadow:[^;]*var\(--brand-action-shadow\)/);
  assert.match(language, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(language, expectedFallback);
  assert.match(language, /box-shadow:\s*var\(--brand-action-shadow\)/);
  assert.match(theme, /button\[class\*="bg-emerald-700"\][\s\S]*?background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(activeStep, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(activeStep, expectedFallback);
  assert.match(activeStep, /box-shadow:\s*var\(--brand-action-shadow\)/);
  assert.match(theme, /#root:has\(main\[data-current-step="4"\]\) \.step-nav button:nth-child\(4\) > span:first-child \{ color: #fff !important; \}/);
  const solidHeader = ruleBlock(refresh, '#root button#header-action-menu-toggle {');
  const normalResultStep = lastRuleBlock(refresh, '#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4) {');
  const interactiveResultStep = ruleBlock(refresh, '#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4):hover,');
  assert.match(solidHeader, /background:\s*var\(--ui-brand\)\s*!important/);
  assert.match(solidHeader, /background-image:\s*none\s*!important/);
  assert.match(normalResultStep, /background:\s*var\(--ui-brand-soft\)\s*!important/);
  assert.match(normalResultStep, /-webkit-text-fill-color:\s*var\(--ui-brand-dark\)\s*!important/);
  assert.match(normalResultStep, /text-shadow:\s*none\s*!important/);
  assert.match(interactiveResultStep, /-webkit-text-fill-color:\s*#fff\s*!important/);
  assert.match(interactiveResultStep, /text-shadow:\s*0 1px 2px rgba\(0, 0, 0, \.42\)\s*!important/);
  const brandButton = ruleBlock(theme, '#root button.bg-brand-600:not(:disabled) {');
  assert.match(brandButton, expectedFallback);
  assert.match(theme, /#root \.app-brand-icon \{ background-image: linear-gradient\(to top right, #49b88b 0%, #80d9aa 55%, #b5f2cf 100%\); \}/, 'do not repaint the static logo surface');
  assert.match(theme, /button\.green-action:disabled[\s\S]*?background-image:\s*none\s*!important/);
});

test('the detail page uses the exact logo gradient only for green controls and preserves the blue exception', () => {
  const paid = ruleBlock(detailed, '.paid-notice-button {');
  const fontOption = ruleBlock(detailed, '.font-size-option[aria-pressed="true"] {');
  assert.match(paid, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(paid, expectedFallback);
  assert.match(paid, /box-shadow:\s*var\(--brand-action-shadow\)/);
  assert.match(paid, /text-shadow:\s*0 1px 2px rgba\(0,0,0,\.42\)/);
  assert.match(fontOption, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(fontOption, expectedFallback);
  assert.match(fontOption, /text-shadow:/);

  const sharedBlueButton = detailed.match(/body\.shared-link-view \.paid-notice-button\s*\{[^}]*\}/)?.[0] || '';
  assert.match(sharedBlueButton, /background-image:linear-gradient\(to top right,#3f94d0 0%,#4a94d4 60%,#6bb0e8 100%\)/);
  assert.match(sharedBlueButton, /box-shadow:none/);
  assert.match(sharedBlueButton, /text-shadow:0 1px 1px rgba\(0,0,0,\.35\)/);
  assert.match(detailed, /\.total-card \{[^}]*background:linear-gradient\(120deg,#176a43,#104d31\)/, 'do not change the static payable-total surface');
});
