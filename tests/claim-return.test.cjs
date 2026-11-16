'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('submitted-claim waiting panel links back to the local main app without link credentials', () => {
  const claim = read('claim.html');
  const waitingPanel = claim.match(/<section id="revision-waiting"[\s\S]*?<\/section>/)?.[0];
  assert.ok(waitingPanel, 'waiting panel exists');
  assert.match(waitingPanel, /<a id="return-main-app" data-testid="return-main-app" class="button" href="\.\/" hidden>/);
  assert.match(claim, /localStorage\.getItem\('billSplitterActiveDraftV1'\)/);
  assert.match(claim, /localBill\?\.schema === 1 && localBill\?\.data\?\.claimSession\?\.id === sessionId/);
  assert.match(claim, /document\.getElementById\('return-main-app'\)\.hidden = !hasMatchingLocalBill/);
  assert.match(claim, /returnMainApp: '返回主程式'/);
  assert.match(claim, /returnMainApp: 'Back to main app'/);
  assert.match(claim, /document\.getElementById\('return-main-app'\)\.textContent = text\.returnMainApp/);
  assert.doesNotMatch(waitingPanel.match(/id="return-main-app"[^>]*>/)?.[0] || '', /[?&](?:session|token|key)=/i);
});

test('navigating explicitly to Step 2 scrolls the activity settings below the sticky header', () => {
  const index = read('index.html');
  const mobile = read('tests/mobile-layout.cjs');
  assert.match(index, /pendingStep2ActivityScrollRef = useRef\(false\)/);
  assert.match(index, /activitySettings\.getBoundingClientRect\(\)\.top - stickyHeaderBottom\(\) - 12/);
  assert.match(index, /if \(target === 2\) pendingStep2ActivityScrollRef\.current = true/);
  assert.match(mobile, /activity name input is visible below the sticky header after entering Step 2/);
});
