'use strict';

// Local, deterministic tests only. Do not run claim-relay.test.cjs wholesale:
// that older file includes a live ntfy integration test.
const test = require('node:test');
const assert = require('node:assert/strict');
const revisions = require('./claim-revisions.js');

function result() {
  return {
    bill: { currency: 'HKD' },
    participants: [{ name: '阿明' }, { name: '主辦人' }],
    items: [
      { id: '02', unit: '', shares: [{ person: '阿明', quantity: 2 / 3, unit: '份', isActualUnit: false }, { person: '主辦人', quantity: 1 / 3 }] },
      { id: '01', unit: '杯', shares: [{ person: '阿明', quantity: 1, unit: '杯', isActualUnit: true }, { person: '主辦人', quantity: 5, unit: '杯', isActualUnit: true }] }
    ]
  };
}
function payload() {
  return { v: 1, name: '阿明', claims: [{ id: '01', qty: 1, unit: '杯' }, { id: '02', qty: 2 / 3, unit: '', displayUnit: '件' }] };
}

test('canonical quantities preserve numeric precision, ordering, and original input', () => {
  const input = [{ id: '02', qty: '0.666666666', unit: ' ' }, { id: '01', qty: '1', unit: ' 杯 ' }];
  const before = JSON.stringify(input);
  assert.deepEqual(revisions.canonicalClaims(input), [{ id: '01', qty: 1, unit: '杯' }, { id: '02', qty: 0.666666666, unit: '' }]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(revisions.canonicalClaims([null, { id: '1', qty: 1 }, { id: '03', qty: 0 }, { id: '04', qty: -1 }, { id: '05', qty: Infinity }, { id: '06', qty: 'no' }]), []);
  assert.deepEqual(revisions.canonicalClaims(undefined), []);
});

test('published quantities and real units match while decorative units do not affect acceptance', () => {
  assert.equal(revisions.matchesResult(payload(), result()), true);
  const decorated = result();
  decorated.items[0].shares[0].unit = '碟';
  assert.equal(revisions.matchesResult(payload(), decorated), true);
  const changedDisplay = payload();
  changedDisplay.claims[1].displayUnit = '碗';
  assert.equal(revisions.matchesResult(changedDisplay, decorated), true);
  decorated.items[1].shares[0].unit = '';
  assert.equal(revisions.matchesResult(payload(), decorated), true, 'actual share can inherit receipt unit');
});

test('a ready envelope, timestamps, other people, or same amounts cannot accept stale quantities', () => {
  const changed = payload();
  changed.claims[0].qty = 3;
  assert.equal(revisions.matchesResult(changed, result()), false);
  const removed = payload();
  removed.claims.pop();
  assert.equal(revisions.matchesResult(removed, result()), false, 'removed claims must be absent in published allocations');
  const other = payload();
  other.name = '另一位朋友';
  assert.equal(revisions.matchesResult(other, result()), false);
  const data = result();
  data.serverNow = new Date(Date.now() + 60000).toISOString();
  data.status = 'ready';
  assert.equal(revisions.matchesResult(changed, data), false);
});

test('real unit semantics must agree exactly', () => {
  const wrongUnit = result();
  wrongUnit.items[1].shares[0].unit = '碗';
  assert.equal(revisions.matchesResult(payload(), wrongUnit), false);
  const noActualUnit = result();
  noActualUnit.items[1].shares[0].isActualUnit = false;
  assert.equal(revisions.matchesResult(payload(), noActualUnit), false);
  const sharePayload = payload();
  sharePayload.claims[0].unit = '';
  assert.equal(revisions.matchesResult(sharePayload, noActualUnit), true, 'a decorative receipt unit is not an actual unit');
});

test('small precise revisions cannot match a rounded old result', () => {
  const data = result();
  data.items[1].shares[0].quantity = 1.234;
  const changed = payload();
  changed.claims[0].qty = 1.2344;
  assert.equal(revisions.matchesResult(changed, data), false);
  data.items[1].shares[0].quantity = 1.2344;
  assert.equal(revisions.matchesResult(changed, data), true);
});

test('all-zero clear waits until no positive person allocations remain, even when the person disappears', () => {
  const clear = { v: 1, name: '阿明', claims: [], clear: true };
  assert.equal(revisions.matchesResult(clear, result()), false);
  const cleared = result();
  cleared.participants = [{ name: '主辦人' }];
  cleared.items.forEach(item => { item.shares = item.shares.filter(share => share.person !== '阿明'); });
  assert.equal(revisions.matchesResult(clear, cleared), true);
  cleared.items[0].shares.push({ person: '阿明', quantity: 0 });
  assert.equal(revisions.matchesResult(clear, cleared), true);
});

test('unusable result structures are never interpreted as acceptance', () => {
  for (const data of [undefined, {}, { items: [], participants: [] }, { bill: {}, items: [] }, { bill: {}, participants: [] }]) {
    assert.equal(revisions.matchesResult(payload(), data), false);
  }
  assert.equal(revisions.matchesResult(null, result()), false);
  assert.equal(revisions.matchesResult({ claims: [] }, result()), false);
});

test('storage is session-scoped, with a validated room-only fallback and no global key', () => {
  const a = 'A'.repeat(22), b = 'B'.repeat(22);
  const roomA = 'bs' + 'a'.repeat(22), roomB = 'bs' + 'b'.repeat(22);
  assert.equal(revisions.storageKey(a, roomA), `billSplitterFriendClaimV1:${a}`);
  assert.equal(revisions.storageKey(a, roomB), revisions.storageKey(a, roomA));
  assert.notEqual(revisions.storageKey(a, roomA), revisions.storageKey(b, roomA));
  assert.equal(revisions.storageKey('', roomA), `billSplitterFriendClaimV1:${roomA}`);
  assert.notEqual(revisions.storageKey('', roomA), revisions.storageKey('', roomB));
  assert.equal(revisions.storageKey('invalid', roomA), revisions.storageKey('', roomA));
  for (const [session, topic] of [[null, null], ['', ''], ['../bad', 'bsBad'], ['A'.repeat(21), 'bs' + 'a'.repeat(21)], ['A'.repeat(23), 'bs' + 'A'.repeat(22)]]) {
    assert.equal(revisions.storageKey(session, topic), '');
  }
});
