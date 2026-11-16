const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(root, 'theme.css'), 'utf8');
const detailed = fs.readFileSync(path.join(root, 'detailed-view.html'), 'utf8');

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

function contrastWithWhite(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return 1.05 / (luminance + 0.05);
}

function colorStops(value, name) {
  const match = value.match(new RegExp(`--${name}:\\s*linear-gradient\\(to top right,\\s*(#[0-9a-f]{6}) 0%,\\s*(#[0-9a-f]{6}) 55%,\\s*(#[0-9a-f]{6}) 100%\\)`, 'i'));
  assert.ok(match, `${name} must be an explicit lower-left to upper-right three-stop gradient`);
  return match.slice(1).map(color => color.toLowerCase());
}

test('green action gradients are visibly directional and keep white labels accessible', () => {
  for (const name of ['brand-action-gradient', 'brand-action-gradient-hover', 'brand-action-gradient-active']) {
    const [dark, middle, bright] = colorStops(theme, name);
    for (const color of [dark, middle, bright]) {
      assert.ok(contrastWithWhite(color) >= 4.5, `${name} ${color} vs white must meet 4.5:1`);
    }
    const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    const [start, end] = [rgb(dark), rgb(bright)];
    assert.ok(end[0] > start[0] && end[1] > start[1] && end[2] < start[2] && end[0] > end[2], `${name} bright end should shift toward fresh yellow-green`);
    assert.ok(Math.hypot(...start.map((channel, index) => end[index] - channel)) >= 50, `${name} stops must be distinct enough to see`);
  }

  const host = ruleBlock(theme, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled) {');
  const light = ruleBlock(theme, '#root main button.green-action:not(.host-primary):not(:disabled) {');
  const language = lastRuleBlock(theme, '#root button[data-ui-language][aria-pressed="true"] {');
  const activeStep = lastRuleBlock(theme, '#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4) {');
  assert.match(host, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(light, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(light, /color:\s*#fff\s*!important/);
  assert.match(language, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(theme, /button\[class\*="bg-emerald-700"\][\s\S]*?background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(activeStep, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(theme, /#root \.app-brand-icon \{ background-image: linear-gradient\(to top right, #49b88b 0%, #80d9aa 55%, #b5f2cf 100%\); \}/);
  assert.match(theme, /button\.green-action:disabled[\s\S]*?background-image:\s*none\s*!important/);
});

test('the detail page uses the same directional gradient only for green controls', () => {
  assert.match(detailed, /\.paid-notice-button\s*\{[^}]*background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(detailed, /\.font-size-option\[aria-pressed="true"\]\s*\{[^}]*background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(detailed, /body\.shared-link-view \.paid-notice-button\s*\{[^}]*background-image:\s*linear-gradient/);
});
