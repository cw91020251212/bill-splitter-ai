const test = require('node:test');
const assert = require('node:assert/strict');
const receipt = require('./receipt-adjustments.js');

test('parses percent spellings and localized receipt amounts', () => {
  assert.equal(receipt.parseRatePercent('10%'), 10);
  assert.equal(receipt.parseRatePercent(' ８％ '), 8);
  assert.equal(receipt.parseRatePercent('7,5 percent'), 7.5);
  assert.equal(receipt.parseMoney('€1.234,56'), 1234.56);
  assert.equal(receipt.parseMoney('$1,234.56'), 1234.56);
});

test('extracts legacy payloads and normalized adjustment metadata', () => {
  const parsed = receipt.extractPayload('```json\n{"items":[{"name":"Tea","total":100}],"taxRatePercent":"10％","taxApplication":"separate","receiptTotal":110,"currency":"HKD"}\n```');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.receiptTotal, 110);
  assert.equal(parsed.adjustments.length, 1);
  assert.equal(parsed.adjustments[0].ratePercent, '10％');
  const legacy = receipt.extractPayload('[{"name":"Tea","total":100}]');
  assert.equal(legacy.taxTotal, null);
  assert.deepEqual(legacy.adjustments, []);
});

test('calculates a separately printed 10% tax exactly once', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'VAT', kind: 'tax', ratePercent: '10%', application: 'separate' }],
    receiptTotal: 110,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 10);
  assert.equal(result.discountAmount, 0);
  assert.equal(result.expectedTotal, 110);
  assert.equal(result.receiptTotalMatches, true);
});

test('does not reapply a tax already reflected in final line prices / receipt total', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 110 }],
    adjustments: [{ label: 'Consumption tax', kind: 'tax', ratePercent: '10％', application: 'separate' }],
    receiptTotal: 110,
    currency: 'JPY'
  });
  assert.equal(result.taxAmount, 0);
  assert.equal(result.expectedTotal, 110);
  assert.equal(result.doubleApplicationPrevented, true);
});

test('computes a bill discount before percentage tax, using the reduced base', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [
      { label: 'Coupon', kind: 'discount', ratePercent: '5%', application: 'separate' },
      { label: 'GST', kind: 'tax', ratePercent: '10%', application: 'separate' }
    ],
    receiptTotal: 104.5,
    currency: 'HKD'
  });
  assert.equal(result.billDiscountAmount, 5);
  assert.equal(result.taxAmount, 9.5);
  assert.equal(result.expectedTotal, 104.5);
  assert.equal(result.receiptTotalMatches, true);
});

test('allocates a percentage discount to the named receipt line, not the whole bill', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }, { total: 50 }],
    adjustments: [{ label: 'Item offer', kind: 'discount', ratePercent: '10%', scope: 'item', itemIndex: 0, application: 'separate' }],
    receiptTotal: 140,
    currency: 'HKD'
  });
  assert.deepEqual(result.itemDiscounts, [10, 0]);
  assert.equal(result.itemDiscountTotal, 10);
  assert.equal(result.billDiscountAmount, 0);
  assert.equal(result.expectedTotal, 140);
});

test('uses the printed currency amount instead of multiplying a second time by its rate', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'VAT', kind: 'tax', ratePercent: '10%', amount: '9.95', application: 'separate' }],
    receiptTotal: 109.95,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 9.95);
  assert.equal(result.expectedTotal, 109.95);
});

test('does not guess when an unclassified percent row might already be included', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'Tax', kind: 'tax', ratePercent: '10%', application: 'unknown' }],
    receiptTotal: 100,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 0);
  assert.equal(result.doubleApplicationPrevented, true);
  assert.equal(result.skipped.length, 1);
});

test('keeps legacy flat tax inputs and zero-decimal currency rounding working', () => {
  const legacy = receipt.resolveReceiptAdjustments({ items: [{ total: 100 }], taxTotal: 8, receiptTotal: 108, currency: 'HKD' });
  assert.equal(legacy.taxAmount, 8);
  assert.equal(legacy.expectedTotal, 108);
  const yen = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'Consumption tax', kind: 'tax', ratePercent: '10%', application: 'separate' }],
    receiptTotal: 110,
    currency: 'JPY'
  });
  assert.equal(yen.taxAmount, 10);
});

test('does not guess a bill-wide deduction when an item-scoped row has no valid item index', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'Item coupon', kind: 'discount', ratePercent: '10%', scope: 'item', itemIndex: null, application: 'separate' }],
    receiptTotal: 100,
    currency: 'HKD'
  });
  assert.equal(result.discountAmount, 0);
  assert.deepEqual(result.itemDiscounts, [0]);
});

test('infers an unclassified percentage as separate only when the printed total confirms it', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'Local tax', kind: 'tax', ratePercent: '10%', application: 'unknown' }],
    receiptTotal: 110,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 10);
  assert.equal(result.unknownInferredSeparate, true);
  assert.equal(result.receiptTotalMatches, true);
});

test('keeps explicitly separate offsetting fixed tax and discount when their combined total matches', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [
      { label: 'Tax', kind: 'tax', amount: 10, application: 'separate' },
      { label: 'Coupon', kind: 'discount', amount: 10, application: 'separate' }
    ],
    receiptTotal: 100,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 10);
  assert.equal(result.discountAmount, 10);
  assert.equal(result.doubleApplicationPrevented, false);
  assert.equal(result.expectedTotal, 100);
});

test('preserves three-decimal currency precision for amounts and percentage tax', () => {
  assert.equal(receipt.parseMoney('1.234', 'KWD'), 1.234);
  assert.equal(receipt.parseMoney('1,234', 'HKD'), 1234);
  assert.equal(receipt.roundMoney(1.2346, 'KWD'), 1.235);
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: '1.234' }],
    adjustments: [{ label: 'VAT', kind: 'tax', ratePercent: '10%', application: 'separate' }],
    receiptTotal: '1.357',
    currency: 'KWD'
  });
  assert.equal(result.taxAmount, 0.123);
  assert.equal(result.expectedTotal, 1.357);
  assert.equal(result.receiptTotalMatches, true);
});

test('does not reapply a discount already reflected in final item prices', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 95 }],
    adjustments: [{ label: '5% sale', kind: 'discount', ratePercent: '5%', application: 'separate' }],
    receiptTotal: 95,
    currency: 'HKD'
  });
  assert.equal(result.discountAmount, 0);
  assert.equal(result.expectedTotal, 95);
  assert.equal(result.doubleApplicationPrevented, true);
});

test('never adds an adjustment explicitly marked as already included', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 110 }],
    adjustments: [{ label: 'VAT included', kind: 'tax', ratePercent: '10%', application: 'included' }],
    receiptTotal: 110,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 0);
  assert.equal(result.expectedTotal, 110);
  assert.equal(result.receiptTotalMatches, true);
});

test('uses a co-reported fixed legacy tax amount instead of recalculating its percentage', () => {
  const result = receipt.resolveReceiptAdjustments({
    items: [{ total: 100 }],
    adjustments: [{ label: 'Tax', kind: 'tax', ratePercent: '10%', application: 'separate' }],
    taxTotal: 8,
    receiptTotal: 108,
    currency: 'HKD'
  });
  assert.equal(result.taxAmount, 8);
  assert.equal(result.expectedTotal, 108);
  assert.equal(result.receiptTotalMatches, true);
  assert.equal(result.applied[0].ratePercent, 10);
});

test('rounds printed receipt totals to currency precision but rejects a full minor-unit mismatch', () => {
  const hkdMatches = receipt.resolveReceiptAdjustments({ items: [{ total: 100 }], taxTotal: 8, receiptTotal: 108.004, currency: 'HKD' });
  const hkdMismatch = receipt.resolveReceiptAdjustments({ items: [{ total: 100 }], taxTotal: 8, receiptTotal: 108.01, currency: 'HKD' });
  const kwdMismatch = receipt.resolveReceiptAdjustments({ items: [{ total: '1.234' }], adjustments: [{ kind: 'tax', ratePercent: 10, application: 'separate' }], receiptTotal: '1.358', currency: 'KWD' });
  const jpyMismatch = receipt.resolveReceiptAdjustments({ items: [{ total: 1234 }], receiptTotal: 1235, currency: 'JPY' });
  const floatingSum = receipt.resolveReceiptAdjustments({ items: [{ total: 0.1 }, { total: 0.2 }], receiptTotal: '0.30', currency: 'HKD' });
  assert.equal(hkdMatches.receiptTotal, 108);
  assert.equal(hkdMatches.receiptTotalMatches, true);
  assert.equal(hkdMismatch.receiptTotalMatches, false);
  assert.equal(kwdMismatch.receiptTotalMatches, false);
  assert.equal(jpyMismatch.receiptTotalMatches, false);
  assert.equal(floatingSum.expectedTotal, 0.3);
  assert.equal(floatingSum.receiptTotalMatches, true);
});

test('keeps the printed fixed tax amount when the payload also includes a rate', () => {
  const parsed = receipt.extractPayload(JSON.stringify({
    items: [{ total: 100 }],
    taxTotal: 8,
    taxRatePercent: '10%',
    taxApplication: 'separate',
    receiptTotal: 108,
    currency: 'HKD'
  }));
  const result = receipt.resolveReceiptAdjustments(parsed);
  assert.equal(result.taxAmount, 8);
  assert.equal(result.expectedTotal, 108);
  assert.equal(result.receiptTotalMatches, true);
  assert.equal(result.applied[0].ratePercent, 10);
});

test('keeps the printed fixed discount when the payload also includes a rate', () => {
  const parsed = receipt.extractPayload(JSON.stringify({
    items: [{ total: 100 }],
    discountTotal: 5,
    discountRatePercent: '10%',
    discountApplication: 'separate',
    receiptTotal: 95,
    currency: 'HKD'
  }));
  const result = receipt.resolveReceiptAdjustments(parsed);
  assert.equal(result.billDiscountAmount, 5);
  assert.equal(result.expectedTotal, 95);
  assert.equal(result.receiptTotalMatches, true);
  assert.equal(result.applied[0].ratePercent, 10);
});

test('formats zero-, two-, and three-decimal currencies without losing precision', () => {
  assert.equal(receipt.currencyDecimals('CLP'), 0);
  assert.equal(receipt.currencyDecimals('HKD'), 2);
  assert.equal(receipt.currencyDecimals('KWD'), 3);
  assert.equal(receipt.formatMoney(123.6, 'CLP', 'CLP '), 'CLP 124');
  assert.equal(receipt.formatMoney(12.3, 'HKD', '$'), '$12.30');
  assert.equal(receipt.formatMoney(1.2346, 'KWD', 'KWD '), 'KWD 1.235');
});

test('uses less than one minor unit as the report rounding tolerance', () => {
  assert.equal(receipt.withinRoundingTolerance(0.004, 'HKD'), true);
  assert.equal(receipt.withinRoundingTolerance(0.005, 'HKD'), false);
  assert.equal(receipt.withinRoundingTolerance(0.04, 'HKD'), false);
  assert.equal(receipt.withinRoundingTolerance(0.0004, 'KWD'), true);
  assert.equal(receipt.withinRoundingTolerance(0.0005, 'KWD'), false);
  assert.equal(receipt.withinRoundingTolerance(0.49, 'JPY'), true);
  assert.equal(receipt.withinRoundingTolerance(0.5, 'JPY'), false);
});

test('enforces the discount cap at the currency-rounded subtotal boundary', () => {
  assert.equal(receipt.isDiscountWithinSubtotal(100, 100, 'HKD'), true);
  assert.equal(receipt.isDiscountWithinSubtotal(100.01, 100, 'HKD'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(100.004, 100, 'HKD'), true);
  assert.equal(receipt.isDiscountWithinSubtotal(100.005, 100, 'HKD'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(-0.01, 100, 'HKD'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(100, 100, 'JPY'), true);
  assert.equal(receipt.isDiscountWithinSubtotal(101, 100, 'JPY'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(0.30, 0.1 + 0.2, 'HKD'), true);
  assert.equal(receipt.isDiscountWithinSubtotal(0.31, 0.1 + 0.2, 'HKD'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(1.235, 1.235, 'KWD'), true);
  assert.equal(receipt.isDiscountWithinSubtotal(1.2345, 1.234, 'KWD'), false);
  assert.equal(receipt.isDiscountWithinSubtotal(1.236, 1.235, 'KWD'), false);
});
