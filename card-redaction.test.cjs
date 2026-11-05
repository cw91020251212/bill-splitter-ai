'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CardRedaction = require('./card-redaction.js');

const token = (text, x0, x1, y0 = 100, y1 = 124) => ({ text, bbox: { x0, x1, y0, y1 } });

// This is a synthetic test number only; no real card information is used.
const SYNTHETIC_TEST_NUMBER = '4111111111111111';

test('Luhn validation accepts a synthetic test number and rejects a changed check digit', () => {
  assert.equal(CardRedaction.passesLuhn(SYNTHETIC_TEST_NUMBER), true);
  assert.equal(CardRedaction.passesLuhn('4111111111111112'), false);
  assert.equal(CardRedaction.passesLuhn('123456789012'), false);
  assert.equal(CardRedaction.normalizeDigits('４１１１ １１１１-１１１１ １１１１'), SYNTHETIC_TEST_NUMBER);
});

test('split OCR words are merged into one normalized redaction box without returning the card number', () => {
  const words = [
    token('4111', 100, 150),
    token('1111', 156, 206),
    token('1111', 212, 262),
    token('1111', 268, 318)
  ];
  const masks = CardRedaction.detectCardMasks({ lines: [{ words }] }, 500, 300);
  assert.equal(masks.length, 1);
  assert.deepEqual(Object.keys(masks[0]).sort(), ['height', 'width', 'x', 'y']);
  assert.ok(masks[0].x < 0.2 && masks[0].x > 0.1);
  assert.ok(masks[0].width > 0.4 && masks[0].width < 0.6);
  assert.ok(masks[0].y < 0.34 && masks[0].y > 0.28);
  assert.ok(masks[0].height > 0.1 && masks[0].height < 0.13);
  assert.equal(JSON.stringify(masks).includes(SYNTHETIC_TEST_NUMBER), false);
});

test('a failed checksum or unrelated widely-separated numbers produce no mask', () => {
  const invalidWords = [token('4111', 100, 150), token('1111', 156, 206), token('1111', 212, 262), token('1112', 268, 318)];
  assert.deepEqual(CardRedaction.detectCardMasks({ lines: [{ words: invalidWords }] }, 500, 300), []);

  const separatedWords = [token('41111111', 40, 120), token('11111111', 300, 380)];
  assert.deepEqual(CardRedaction.detectCardMasks({ lines: [{ words: separatedWords }] }, 500, 300), []);
});

test('word-only OCR data is grouped by line and masks are clipped to image bounds', () => {
  const words = [
    token('4111', 3, 36, 3, 27),
    token('1111', 40, 73, 3, 27),
    token('1111', 77, 110, 3, 27),
    token('1111', 114, 147, 3, 27)
  ];
  const masks = CardRedaction.detectCardMasks({ words }, 160, 80);
  assert.equal(masks.length, 1);
  assert.ok(masks[0].x >= 0 && masks[0].y >= 0);
  assert.ok(masks[0].x + masks[0].width <= 1);
  assert.ok(masks[0].y + masks[0].height <= 1);
});
