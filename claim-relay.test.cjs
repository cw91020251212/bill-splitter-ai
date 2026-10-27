const test = require('node:test');
const assert = require('node:assert/strict');
const relay = require('./claim-relay.js');

function sampleItems() {
  return [
    { id: '01', name: '燒賣' },
    { id: '02', name: '奶茶', unit: '杯' }
  ];
}

test('room round-trips through the claim hash and encrypts the payload', async () => {
  const room = relay.createRoom();
  assert.equal(relay.isRoom(room), true);
  const hash = relay.buildHash('abc_def-123', room);
  assert.equal(relay.readRoomFromHash('#' + hash).topic, room.topic);
  assert.equal(relay.readRoomFromHash(hash).key, room.key);
  assert.equal(new URLSearchParams(hash).get('data'), 'abc_def-123');

  const payload = {
    v: 1,
    name: '阿明',
    claims: [
      { id: '01', qty: 0.5, unit: '', displayUnit: '件' },
      { id: '02', qty: 2, unit: '杯', displayUnit: '' }
    ]
  };
  const message = await relay.encryptPayload(room.key, payload);
  assert.equal(message.startsWith('bs1.'), true);
  assert.equal(message.includes('阿明'), false);
  const decoded = await relay.decryptPayload(room.key, message);
  assert.equal(decoded.name, '阿明');
  assert.equal(decoded.claims[1].unit, '杯');
  assert.equal(await relay.decryptPayload(relay.createRoom().key, message), null);
});

test('upsert keeps every friend and replaces a resubmission', () => {
  const items = sampleItems();
  const ming = { v: 1, name: '阿明', claims: [{ id: '01', qty: 1, unit: '', displayUnit: '' }] };
  const mei = { v: 1, name: '小美', claims: [{ id: '02', qty: 2, unit: '杯', displayUnit: '' }] };
  const first = relay.applyClaimUpdates('', [ming], items);
  const both = relay.applyClaimUpdates(first, [mei], items);
  assert.match(both, /姓名：阿明/);
  assert.match(both, /姓名：小美/);
  assert.match(both, /實際數量 = 2 杯/);
  const updated = relay.applyClaimUpdates(both, [{
    v: 1, name: '阿明', claims: [{ id: '01', qty: 0.5, unit: '', displayUnit: '' }]
  }], items);
  assert.equal(updated.split('姓名：阿明').length - 1, 1);
  assert.match(updated, /認領份數 = 0\.5/);
  assert.doesNotMatch(updated, /認領份數 = 1/);
  assert.match(updated, /姓名：小美/);
});

test('rejects names and quantities the organizer parser cannot trust', () => {
  assert.equal(relay.sanitizePayload({ v: 1, name: '阿明:額外', claims: [{ id: '01', qty: 1 }] }), null);
  assert.equal(relay.sanitizePayload({ v: 1, name: '阿明', claims: [{ id: '1', qty: 1 }] }), null);
  assert.equal(relay.sanitizePayload({ v: 1, name: '阿明', claims: [{ id: '01', qty: 0 }] }), null);
  assert.equal(relay.readRoomFromHash('#data=abc'), null);
});

test('claimsFromMessages applies each ntfy id once', async () => {
  const room = relay.createRoom();
  const message = await relay.encryptPayload(room.key, {
    v: 1, name: '阿明', claims: [{ id: '01', qty: 1, unit: '' }]
  });
  const messages = [
    { id: 'm1', event: 'message', message },
    { id: 'm1', event: 'message', message },
    { id: 'noise', event: 'message', message: 'hello' }
  ];
  const first = await relay.claimsFromMessages(messages, room, []);
  assert.equal(first.updates.length, 1);
  const second = await relay.claimsFromMessages(messages, room, first.seenIds);
  assert.equal(second.updates.length, 0);
});

test('public ntfy.sh relays a claim between two clients', async () => {
  const room = relay.createRoom();
  await relay.publishClaim(room, {
    v: 1,
    name: '阿明',
    claims: [{ id: '01', qty: 0.5, unit: '', displayUnit: '' }]
  });
  let found = null;
  for (let attempt = 0; attempt < 8 && !found; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 400));
    const messages = await relay.pullMessages(room.topic);
    const result = await relay.claimsFromMessages(messages, room, []);
    found = result.updates.find(update => update.name === '阿明');
  }
  assert.ok(found, 'organizer pull did not see the published claim');
  assert.equal(found.claims[0].qty, 0.5);
});
