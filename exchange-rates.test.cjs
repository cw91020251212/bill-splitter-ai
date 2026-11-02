'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExchangeRates = require('./exchange-rates.js');
const ReceiptMath = require('./receipt-adjustments.js');

test('same-currency receipt totals remain unchanged', () => {
  const result = ExchangeRates.convertReceiptAmounts({
    itemAmounts: [38.6, 24.3],
    taxAmount: 4,
    discountAmount: 2,
    rate: ExchangeRates.requireRate(null, 'HKD', 'HKD'),
    targetCurrency: 'HKD',
    moneyMath: ReceiptMath
  });
  assert.deepEqual(result, {
    itemAmounts: [38.6, 24.3],
    taxAmount: 4,
    discountAmount: 2,
    itemsSubtotal: 62.9,
    total: 64.9
  });
});

test('1000 JPY converts with the actual fetched JPY-to-HKD rate', async () => {
  const quote = await ExchangeRates.fetchRate('JPY', 'HKD');
  assert.equal(quote.base, 'JPY');
  assert.equal(quote.quote, 'HKD');
  assert.equal(quote.provider, 'Frankfurter');
  assert.ok(quote.date, 'the provider must identify the rate date');
  assert.ok(Number.isFinite(quote.rate) && quote.rate > 0, 'the fetched rate must be a positive number');

  const converted = ExchangeRates.convertReceiptAmounts({
    itemAmounts: [1000],
    rate: ExchangeRates.requireRate({ ...quote, status: 'ready' }, 'JPY', 'HKD'),
    targetCurrency: 'HKD',
    moneyMath: ReceiptMath
  });
  assert.equal(converted.total, ReceiptMath.roundMoney(1000 * quote.rate, 'HKD'));
  assert.notEqual(converted.total, 1000, 'the amount must be converted rather than relabelled');
  console.log(`LIVE JPY→HKD ${quote.date}: 1 JPY = ${quote.rate}; 1000 JPY = ${converted.total} HKD`);
});

test('converted amounts round to the settlement currency precision', () => {
  const rate = 0.049893;
  assert.equal(ExchangeRates.convertMoney(1000, rate, 'HKD', ReceiptMath), 49.89);
  assert.equal(ExchangeRates.convertMoney(1, rate, 'HKD', ReceiptMath), 0.05);
  assert.equal(ExchangeRates.convertMoney(1000, rate, 'JPY', ReceiptMath), 50);
});

test('rate fetch failure is surfaced and an unavailable quote cannot be used', async () => {
  await assert.rejects(
    ExchangeRates.fetchRate('JPY', 'HKD', {
      fetchImpl: async () => ({ ok: false, status: 503 })
    }),
    /HTTP 503/
  );
  assert.throws(() => ExchangeRates.requireRate({ status: 'error', base: 'JPY', quote: 'HKD' }, 'JPY', 'HKD'), /not available yet/);
  assert.throws(() => ExchangeRates.requireRate(null, 'JPY', 'HKD'), /not available yet/);
});

test('rate response must match the requested pair and contain a positive rate', async () => {
  await assert.rejects(
    ExchangeRates.fetchRate('JPY', 'HKD', {
      fetchImpl: async () => ({ ok: true, json: async () => ({ base: 'EUR', quote: 'HKD', rate: 8 }) })
    }),
    /mismatched or invalid/
  );
});
