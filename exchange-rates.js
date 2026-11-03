(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ExchangeRates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const normalizeCurrency = value => String(value || '').trim().toUpperCase();
  const validRate = value => Number.isFinite(Number(value)) && Number(value) > 0;

  async function fetchRate(base, quote, { fetchImpl = globalThis.fetch, signal } = {}) {
    const normalizedBase = normalizeCurrency(base);
    const normalizedQuote = normalizeCurrency(quote);
    if (!/^[A-Z]{3}$/.test(normalizedBase) || !/^[A-Z]{3}$/.test(normalizedQuote)) {
      throw new Error('Please choose valid three-letter currency codes.');
    }
    if (normalizedBase === normalizedQuote) {
      return { base: normalizedBase, quote: normalizedQuote, rate: 1, date: null, provider: 'identity' };
    }
    if (typeof fetchImpl !== 'function') throw new Error('Exchange-rate service is unavailable in this browser.');

    const url = `https://api.frankfurter.dev/v2/rate/${normalizedBase.toLowerCase()}/${normalizedQuote.toLowerCase()}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Could not reach the exchange-rate service. Check your connection and try again.');
    }
    if (!response?.ok) throw new Error(`Exchange-rate service returned HTTP ${response?.status || 'error'}.`);

    let data;
    try { data = await response.json(); }
    catch (error) { throw new Error('Exchange-rate service returned invalid data.'); }
    const responseBase = normalizeCurrency(data?.base);
    const responseQuote = normalizeCurrency(data?.quote);
    const rate = Number(data?.rate);
    if (responseBase !== normalizedBase || responseQuote !== normalizedQuote || !validRate(rate)) {
      throw new Error('Exchange-rate service returned a mismatched or invalid currency pair.');
    }
    const date = typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
    return { base: normalizedBase, quote: normalizedQuote, rate, date, provider: 'Frankfurter' };
  }

  function requireRate(quote, base, target) {
    const normalizedBase = normalizeCurrency(base);
    const normalizedTarget = normalizeCurrency(target);
    if (normalizedBase === normalizedTarget) return 1;
    if (!quote || quote.status !== 'ready'
      || normalizeCurrency(quote.base) !== normalizedBase
      || normalizeCurrency(quote.quote) !== normalizedTarget
      || !validRate(quote.rate)) {
      throw new Error(`An exchange rate from ${normalizedBase} to ${normalizedTarget} is not available yet.`);
    }
    return Number(quote.rate);
  }

  function convertMoney(value, rate, targetCurrency, moneyMath) {
    const amount = Number(value);
    const numericRate = Number(rate);
    if (!Number.isFinite(amount) || !validRate(numericRate)) throw new Error('Cannot convert a non-finite amount or invalid exchange rate.');
    if (!moneyMath || typeof moneyMath.roundMoney !== 'function') throw new Error('A currency-aware money-rounding helper is required.');
    return moneyMath.roundMoney(amount * numericRate, normalizeCurrency(targetCurrency));
  }

  function convertAggregatedAmounts({ amounts = {}, totalAmount, rate, targetCurrency, moneyMath } = {}) {
    if (!amounts || typeof amounts !== 'object' || Array.isArray(amounts)) throw new Error('Aggregated person amounts must be an object.');
    if (!moneyMath || typeof moneyMath.toMinorUnits !== 'function' || typeof moneyMath.currencyDecimals !== 'function') {
      throw new Error('Currency precision helpers are required to apportion settlement rounding.');
    }
    const target = normalizeCurrency(targetCurrency);
    const numericTotal = Number(totalAmount);
    if (!Number.isFinite(numericTotal)) throw new Error('The aggregate source amount must be finite.');
    const entries = Object.entries(amounts).map(([key, value], index) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) throw new Error('Every aggregated person amount must be finite.');
      return { key, amount, index };
    });
    const sumOfPeople = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const sourceTolerance = 1e-8 * Math.max(1, Math.abs(numericTotal), Math.abs(sumOfPeople));
    if (Math.abs(sumOfPeople - numericTotal) > sourceTolerance) {
      throw new Error('Person source amounts do not reconcile with the aggregate source total.');
    }

    const total = convertMoney(numericTotal, rate, target, moneyMath);
    const decimals = moneyMath.currencyDecimals(target);
    const scale = 10 ** decimals;
    const totalUnits = moneyMath.toMinorUnits(total, target);
    const converted = entries.map(entry => {
      const roundedAmount = convertMoney(entry.amount, rate, target, moneyMath);
      const units = moneyMath.toMinorUnits(roundedAmount, target);
      return {
        key: entry.key,
        index: entry.index,
        units,
        remainder: entry.amount * Number(rate) * scale - units
      };
    });

    let remainingUnits = totalUnits - converted.reduce((sum, entry) => sum + entry.units, 0);
    const roundingAdjustmentUnits = remainingUnits;
    if (remainingUnits && !converted.length) throw new Error('A non-zero settlement total has no people to receive it.');
    while (remainingUnits !== 0) {
      const direction = Math.sign(remainingUnits);
      const ordered = [...converted].sort((left, right) => {
        const remainderOrder = direction > 0 ? right.remainder - left.remainder : left.remainder - right.remainder;
        return remainderOrder || left.index - right.index;
      });
      const adjustmentsThisPass = Math.min(Math.abs(remainingUnits), ordered.length);
      ordered.slice(0, adjustmentsThisPass).forEach(entry => {
        entry.units += direction;
        entry.remainder -= direction;
        remainingUnits -= direction;
      });
    }

    return {
      total,
      amounts: Object.fromEntries(converted.map(entry => [entry.key, entry.units / scale])),
      roundingAdjustmentUnits
    };
  }

  function convertReceiptAmounts({ itemAmounts = [], taxAmount = 0, discountAmount = 0, rate, targetCurrency, moneyMath } = {}) {
    if (!Array.isArray(itemAmounts)) throw new Error('Receipt item amounts must be an array.');
    const target = normalizeCurrency(targetCurrency);
    const convertedItems = itemAmounts.map(amount => convertMoney(amount, rate, target, moneyMath));
    const convertedTax = convertMoney(taxAmount, rate, target, moneyMath);
    const convertedDiscount = convertMoney(discountAmount, rate, target, moneyMath);
    const itemsSubtotal = moneyMath.roundMoney(convertedItems.reduce((sum, amount) => sum + amount, 0), target);
    const total = moneyMath.roundMoney(itemsSubtotal + convertedTax - convertedDiscount, target);
    return {
      itemAmounts: convertedItems,
      taxAmount: convertedTax,
      discountAmount: convertedDiscount,
      itemsSubtotal,
      total
    };
  }

  return { normalizeCurrency, fetchRate, requireRate, convertMoney, convertAggregatedAmounts, convertReceiptAmounts };
});
