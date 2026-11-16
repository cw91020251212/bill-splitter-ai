const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(root, 'theme.css'), 'utf8');
const detailed = fs.readFileSync(path.join(root, 'detailed-view.html'), 'utf8');
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

function contrastWithWhite(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return 1.05 / (luminance + 0.05);
}

function rgb(hex) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}

function relativeLuminance(hex) {
  const channels = rgb(hex).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function colorStops(value, name) {
  const match = value.match(new RegExp(`--${name}:\\s*linear-gradient\\(to top right,\\s*(#[0-9a-f]{6}) 0%,\\s*(#[0-9a-f]{6}) 55%,\\s*(#[0-9a-f]{6}) 100%\\)`, 'i'));
  assert.ok(match, `${name} must be an explicit lower-left to upper-right three-stop gradient`);
  return match.slice(1).map(color => color.toLowerCase());
}

const expectedGradients = {
  'brand-action-gradient': ['#0f6b42', '#26763d', '#4b8028'],
  'brand-action-gradient-hover': ['#0e653f', '#24713a', '#47802b'],
  'brand-action-gradient-active': ['#0c5b38', '#216b31', '#407227'],
};

test('green action gradients match the logo green and keep white labels accessible', () => {
  assert.ok(icon.includes('stop-color="#0f6b42"'), 'the button gradient starts with the logo background green');
  assert.ok(icon.includes('fill="#127a4c"'), 'the button gradient uses the logo mark green');

  for (const [name, expected] of Object.entries(expectedGradients)) {
    const colors = colorStops(theme, name);
    const [dark, middle, bright] = colors;
    const minimumEndpointDistance = name === 'brand-action-gradient' ? 65 : 55;
    assert.ok(Math.hypot(...rgb(dark).map((channel, index) => rgb(bright)[index] - channel)) >= minimumEndpointDistance, `${name} must stay visibly distinct; R166's near-flat stops are below this threshold`);
    assert.deepEqual(colors, expected, `${name} must stay in the logo-green family`);
    for (const color of colors) {
      assert.ok(contrastWithWhite(color) >= 4.5, `${name} ${color} vs white must meet 4.5:1`);
    }
    assert.ok(relativeLuminance(dark) < relativeLuminance(middle) && relativeLuminance(middle) < relativeLuminance(bright), `${name} must visibly brighten toward the upper right`);
    assert.deepEqual(colorStops(detailed, name), colors, `the detail page must use the same ${name}`);
  }

  const host = ruleBlock(theme, '#root button.host-primary.green-action:not(.green-action-dark):not(:disabled) {');
  const light = ruleBlock(theme, '#root main button.green-action:not(.host-primary):not(:disabled) {');
  const language = lastRuleBlock(theme, '#root button[data-ui-language][aria-pressed="true"] {');
  const activeStep = lastRuleBlock(theme, '#root:has(main[data-current-step="4"]) .step-nav button:nth-child(4) {');
  assert.match(host, /background-image:\s*var\(--brand-action-gradient\)/);
  assert.match(host, /background-color:\s*#26763d/);
  assert.match(host, /border-color:\s*#0f6b42/);
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
