'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const relay = require('../claim-relay.js');

const fourItems = [
  { id: '05', name: '燒賣' },
  { id: '06', name: '奶茶' },
  { id: '07', name: '牛肉飯' },
  { id: '08', name: '豆腐' }
];

test('current bill display numbers start at 01 even when internal IDs continue at 05', () => {
  assert.deepEqual(fourItems.map((_, index) => relay.displayNumber(index)), ['01', '02', '03', '04']);
});

test('claim reply shows the current display number but retains the stable internal claim ID', () => {
  const update = { v: 1, name: '阿明', claims: [{ id: '07', qty: 2 }] };
  const clean = relay.sanitizePayload(update);
  assert.equal(clean.claims[0].id, '07');

  const reply = relay.applyClaimUpdates('', [update], fourItems);
  assert.match(reply, /03 牛肉飯：認帳份數 = 2/);
  assert.equal(relay.resolveClaimItemId('03', '03 牛肉飯：認帳份數 = 2', fourItems), '07');
  assert.equal(relay.resolveClaimItemId('03', '03 = 2', fourItems), '07',
    'number-only manual replies remain mappable when display number and internal ID do not collide');
});

test('claim numbering collisions resolve by item name and refuse ambiguous number-only replies', () => {
  const reordered = [
    { id: '02', name: '牛肉' },
    { id: '01', name: '豆腐' }
  ];
  assert.equal(relay.resolveClaimItemId('01', '01 牛肉：共享', reordered), '02');
  assert.equal(relay.resolveClaimItemId('02', '02 豆腐：共享', reordered), '01');
  assert.equal(relay.resolveClaimItemId('01', '01：共享', reordered), null);
});
