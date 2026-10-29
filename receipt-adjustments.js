(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReceiptAdjustments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZERO_DECIMAL_CURRENCIES = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
  const THREE_DECIMAL_CURRENCIES = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
  const currencyDecimals = currency => {
    const code = String(currency || '').toUpperCase();
    if (ZERO_DECIMAL_CURRENCIES.includes(code)) return 0;
    if (THREE_DECIMAL_CURRENCIES.includes(code)) return 3;
    return 2;
  };

  const toMinorUnits = (value, currency = 'HKD') => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const epsilon = number < 0 ? -Number.EPSILON : Number.EPSILON;
    return Math.round((number + epsilon) * (10 ** currencyDecimals(currency)));
  };

  const roundMoney = (value, currency = 'HKD') => {
    const units = toMinorUnits(value, currency);
    return units === null ? NaN : units / (10 ** currencyDecimals(currency));
  };

  function parseLocalizedNumber(value, { percent = false, currency = 'HKD' } = {}) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '') return null;
    let text = String(value).normalize('NFKC').replace(/[−﹣－]/g, '-').trim();
    if (percent && /[%％]/.test(String(value))) text = text.replace(/[%％]/g, '');
    const negativeByParentheses = /^\s*\(.*\)\s*$/.test(text);
    text = text.replace(/[()]/g, '').replace(/[^\d.,+\-]/g, '');
    if (!text || !/[\d]/.test(text)) return null;
    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      const grouping = decimal === ',' ? /\./g : /,/g;
      text = text.replace(grouping, '');
      if (decimal === ',') text = text.replace(',', '.');
    } else if (comma >= 0) {
      const commaCount = (text.match(/,/g) || []).length;
      const tail = text.length - comma - 1;
      if (percent || (commaCount === 1 && tail > 0 && tail <= currencyDecimals(currency))) text = text.replace(',', '.');
      else text = text.replace(/,/g, '');
    } else if (!percent && dot >= 0 && (text.match(/\./g) || []).length === 1 && text.length - dot - 1 === 3 && currencyDecimals(currency) < 3) {
      text = text.replace('.', '');
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return negativeByParentheses ? -Math.abs(number) : number;
  }

  const parseMoney = (value, currency = 'HKD') => parseLocalizedNumber(value, { currency });
  const parseRatePercent = value => parseLocalizedNumber(value, { percent: true });
  const hasPercentMarker = value => typeof value === 'string' && /[%％]|percent/i.test(value);
  const isDiscountWithinSubtotal = (discount, subtotal, currency = 'HKD') => {
    const amount = parseMoney(discount, currency);
    const available = parseMoney(subtotal, currency);
    const amountUnits = amount === null ? null : toMinorUnits(amount, currency);
    const availableUnits = available === null ? null : toMinorUnits(available, currency);
    return amount !== null && available !== null && amount >= 0 && available >= 0
      && amountUnits !== null && availableUnits !== null && amountUnits <= availableUnits;
  };
  const moneyEquals = (left, right, currency = 'HKD') => {
    const leftUnits = toMinorUnits(left, currency);
    const rightUnits = toMinorUnits(right, currency);
    return leftUnits !== null && rightUnits !== null && leftUnits === rightUnits;
  };
  const withinRoundingTolerance = (difference, currency = 'HKD') => {
    const numeric = Number(difference);
    return Number.isFinite(numeric) && toMinorUnits(Math.abs(numeric), currency) === 0;
  };
  const formatMoney = (amount, currency = 'HKD', symbol = '') => {
    const numeric = amount === null || amount === undefined || amount === '' ? 0 : Number(amount);
    return `${symbol}${roundMoney(numeric, currency).toFixed(currencyDecimals(currency))}`;
  };

  function extractPayload(rawText) {
    const stripFences = value => String(value || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    let text = stripFences(rawText).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) text = stripFences(rawText);
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const objectMatch = text.match(/\{[\s\S]*\}/);
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      const candidate = objectMatch && arrayMatch
        ? (objectMatch.index <= arrayMatch.index ? objectMatch[0] : arrayMatch[0])
        : (objectMatch ? objectMatch[0] : (arrayMatch ? arrayMatch[0] : null));
      if (!candidate) throw new Error('AI 回傳的內容不是有效 JSON，請重試或改用其他模型。');
      data = JSON.parse(candidate);
    }
    if (Array.isArray(data)) return { items: data, taxTotal: null, taxNote: '', currency: 'HKD', date: null, receiptTotal: null, adjustments: [] };

    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.data) ? data.data : []);
    const currency = data.currency || data.Currency || 'HKD';
    const rawTax = data.taxTotal ?? data.tax ?? null;
    let taxTotal = rawTax === '' || hasPercentMarker(rawTax) ? null : parseMoney(rawTax, currency);
    const rawDiscount = data.discountTotal ?? data.discount ?? null;
    let discountTotal = rawDiscount === '' || hasPercentMarker(rawDiscount) ? null : parseMoney(rawDiscount, currency);
    const adjustmentsRaw = data.adjustments ?? data.percentageAdjustments ?? data.taxDiscounts ?? [];
    const adjustments = Array.isArray(adjustmentsRaw) ? adjustmentsRaw.slice() : [];

    if (!adjustments.some(item => inferKind(item) === 'tax')) {
      const rate = data.taxRatePercent ?? data.taxPercent ?? (hasPercentMarker(rawTax) ? rawTax : null);
      if (rate !== null && rate !== undefined && rate !== '') adjustments.push({ label: data.taxNote || 'Tax / service charge', kind: 'tax', ratePercent: rate, amount: null, application: data.taxApplication || 'unknown', scope: 'receipt' });
      else if (taxTotal === null && rawTax !== null && rawTax !== undefined && rawTax !== '') taxTotal = parseMoney(rawTax, currency);
    }
    if (!adjustments.some(item => inferKind(item) === 'discount')) {
      const rate = data.discountRatePercent ?? data.discountPercent ?? (hasPercentMarker(rawDiscount) ? rawDiscount : null);
      if (rate !== null && rate !== undefined && rate !== '') adjustments.push({ label: data.discountNote || 'Discount', kind: 'discount', ratePercent: rate, amount: null, application: data.discountApplication || 'unknown', scope: 'receipt' });
      else if (discountTotal === null && rawDiscount !== null && rawDiscount !== undefined && rawDiscount !== '') discountTotal = parseMoney(rawDiscount, currency);
    }

    const rawDate = data.date || data.receiptDate || data.Date || null;
    const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim()) ? rawDate.trim() : null;
    const rawTotal = data.receiptTotal ?? data.totalDue ?? null;
    return {
      items,
      taxTotal,
      discountTotal,
      taxNote: data.taxNote || data.tax_note || data.adjustmentNote || '',
      currency,
      date,
      receiptTotal: rawTotal === null || rawTotal === '' ? null : parseMoney(rawTotal, currency),
      adjustments
    };
  }

  function inferKind(raw) {
    const value = String(raw?.kind ?? raw?.type ?? raw?.category ?? raw?.label ?? '').toLowerCase();
    if (/discount|rebate|coupon|promotion|promo|折扣|優惠|优惠|割引|할인|쿠폰/.test(value)) return 'discount';
    if (/tax|vat|gst|sales.?tax|service.?fee|service.?charge|surcharge|稅|税|消費税|消费税|服務費|服务费|봉사료|부가세/.test(value)) return 'tax';
    const kind = String(raw?.kind ?? raw?.type ?? raw?.category ?? '').toLowerCase();
    if (kind === 'service_fee' || kind === 'service' || kind === 'fee') return 'tax';
    return kind === 'tax' || kind === 'discount' ? kind : null;
  }

  function normalizeApplication(raw) {
    if (raw?.included === true || raw?.alreadyApplied === true || raw?.already_applied === true || raw?.includedInPrices === true || raw?.includedInTotal === true) return 'included';
    if (raw?.included === false || raw?.alreadyApplied === false || raw?.includedInPrices === false || raw?.includedInTotal === false) return 'separate';
    const value = String(raw?.application ?? raw?.inclusion ?? raw?.status ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    if (/included|already_applied|reflected|in_prices|in_total|含|內含|内含|税込|含まれ/.test(value)) return 'included';
    if (/separate|extra|excluded|not_included|add|deduct|subtract|另加|外加|另扣|別途/.test(value)) return 'separate';
    return 'unknown';
  }

  function normalizeAdjustment(raw, index, currency = 'HKD') {
    if (!raw || typeof raw !== 'object') return null;
    const kind = inferKind(raw);
    if (!kind) return null;
    const rawRate = raw.ratePercent ?? raw.percent ?? raw.percentage ?? raw.rate ?? null;
    const ratePercent = rawRate === null || rawRate === '' ? null : parseRatePercent(rawRate);
    const rawAmount = raw.amount ?? raw.amountValue ?? raw.value ?? null;
    const amount = rawAmount === null || rawAmount === '' ? null : parseMoney(rawAmount, currency);
    const rawBase = raw.baseAmount ?? raw.base ?? raw.taxableBase ?? null;
    const baseAmount = rawBase === null || rawBase === '' ? null : parseMoney(rawBase, currency);
    const rawIndex = Number(raw.itemIndex ?? raw.item_index);
    const scope = /item|line|product/.test(String(raw.scope || '').toLowerCase()) || Number.isInteger(rawIndex) ? 'item' : 'receipt';
    return {
      label: String(raw.label || raw.name || (kind === 'tax' ? 'Tax / service charge' : 'Discount')).trim(),
      kind,
      ratePercent: Number.isFinite(ratePercent) ? Math.max(0, ratePercent) : null,
      amount: Number.isFinite(amount) ? Math.abs(amount) : null,
      baseAmount: Number.isFinite(baseAmount) ? Math.max(0, baseAmount) : null,
      application: normalizeApplication(raw),
      scope,
      itemIndex: scope === 'item' && Number.isInteger(rawIndex) ? rawIndex : null,
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index
    };
  }

  function amountOfItem(item, currency = 'HKD') {
    return Math.max(0, parseMoney(item?.total, currency) ?? (parseMoney(item?.price, currency) || 0) * (parseMoney(item?.qty, currency) || 1));
  }

  function simulate(subtotal, itemSubtotals, adjustments, currency) {
    const itemDiscounts = itemSubtotals.map(() => 0);
    let billDiscountAmount = 0;
    let taxAmount = 0;
    const applied = [];
    const currentSubtotal = () => Math.max(0, subtotal - billDiscountAmount - itemDiscounts.reduce((sum, value) => sum + value, 0));

    for (const adjustment of adjustments) {
      if (adjustment.scope === 'item' && (adjustment.itemIndex === null || adjustment.itemIndex < 0 || adjustment.itemIndex >= itemSubtotals.length)) continue;
      const itemIndex = adjustment.scope === 'item' && adjustment.itemIndex !== null && adjustment.itemIndex >= 0 && adjustment.itemIndex < itemSubtotals.length
        ? adjustment.itemIndex : null;
      const priorItemDiscount = itemIndex === null ? 0 : itemDiscounts[itemIndex];
      const base = adjustment.baseAmount !== null
        ? adjustment.baseAmount
        : (itemIndex !== null ? Math.max(0, itemSubtotals[itemIndex] - priorItemDiscount) : currentSubtotal());
      let amount = adjustment.amount;
      if (amount === null && adjustment.ratePercent !== null) amount = base * adjustment.ratePercent / 100;
      if (amount === null || !Number.isFinite(amount) || amount <= 0) continue;
      amount = roundMoney(amount, currency);

      if (adjustment.kind === 'discount') {
        if (itemIndex !== null) {
          amount = Math.min(amount, Math.max(0, itemSubtotals[itemIndex] - itemDiscounts[itemIndex]));
          itemDiscounts[itemIndex] = roundMoney(itemDiscounts[itemIndex] + amount, currency);
        } else {
          amount = Math.min(amount, Math.max(0, subtotal - billDiscountAmount - itemDiscounts.reduce((sum, value) => sum + value, 0)));
          billDiscountAmount = roundMoney(billDiscountAmount + amount, currency);
        }
      } else {
        taxAmount = roundMoney(taxAmount + amount, currency);
      }
      if (amount > 0) applied.push({ ...adjustment, amount });
    }

    const itemDiscountTotal = roundMoney(itemDiscounts.reduce((sum, value) => sum + value, 0), currency);
    const discountAmount = roundMoney(billDiscountAmount + itemDiscountTotal, currency);
    return {
      itemDiscounts,
      itemDiscountTotal,
      billDiscountAmount: roundMoney(billDiscountAmount, currency),
      discountAmount,
      taxAmount: roundMoney(taxAmount, currency),
      applied,
      expectedTotal: roundMoney(Math.max(0, subtotal - discountAmount) + taxAmount, currency)
    };
  }

  function resolveReceiptAdjustments({ items = [], adjustments = [], taxTotal = null, discountTotal = null, receiptTotal = null, currency = 'HKD' } = {}) {
    const itemSubtotals = (Array.isArray(items) ? items : []).map(item => amountOfItem(item, currency));
    const subtotal = roundMoney(itemSubtotals.reduce((sum, value) => sum + value, 0), currency);
    const normalized = (Array.isArray(adjustments) ? adjustments : []).map((item, index) => normalizeAdjustment(item, index, currency)).filter(Boolean).sort((a, b) => a.order - b.order);
    let candidates = normalized.slice();

    const fixedTaxTotal = taxTotal === null || taxTotal === undefined ? null : parseMoney(taxTotal, currency);
    const taxAdjustments = normalized.filter(item => item.kind === 'tax');
    if (fixedTaxTotal !== null && fixedTaxTotal > 0 && taxAdjustments.length === 0) {
      candidates.push({ label: 'Tax / service charge', kind: 'tax', ratePercent: null, amount: Math.abs(fixedTaxTotal), baseAmount: null, application: 'separate', scope: 'receipt', itemIndex: null, order: candidates.length });
    } else if (fixedTaxTotal !== null && fixedTaxTotal > 0 && taxAdjustments.length === 1
      && taxAdjustments[0].amount === null && taxAdjustments[0].application !== 'included') {
      // Legacy taxTotal is the printed fixed amount; do not recompute it from a co-reported percentage.
      const rateOnlyTax = taxAdjustments[0];
      candidates = candidates.map(item => item === rateOnlyTax ? { ...item, amount: Math.abs(fixedTaxTotal) } : item);
    }
    const fixedDiscountTotal = discountTotal === null || discountTotal === undefined ? null : parseMoney(discountTotal, currency);
    const discountAdjustments = normalized.filter(item => item.kind === 'discount');
    if (fixedDiscountTotal !== null && fixedDiscountTotal > 0 && discountAdjustments.length === 0) {
      candidates.push({ label: 'Discount', kind: 'discount', ratePercent: null, amount: Math.abs(fixedDiscountTotal), baseAmount: null, application: 'separate', scope: 'receipt', itemIndex: null, order: candidates.length });
    } else if (fixedDiscountTotal !== null && fixedDiscountTotal > 0 && discountAdjustments.length === 1
      && discountAdjustments[0].amount === null && discountAdjustments[0].application !== 'included') {
      // Legacy discountTotal is the printed fixed amount; do not recompute it from a co-reported percentage.
      const rateOnlyDiscount = discountAdjustments[0];
      candidates = candidates.map(item => item === rateOnlyDiscount ? { ...item, amount: Math.abs(fixedDiscountTotal) } : item);
    }
    candidates.sort((a, b) => a.order - b.order);

    const known = candidates.filter(item => item.application === 'separate');
    const unknown = candidates.filter(item => item.application === 'unknown');
    const included = candidates.filter(item => item.application === 'included');
    const knownResult = simulate(subtotal, itemSubtotals, known, currency);
    const allResult = simulate(subtotal, itemSubtotals, [...known, ...unknown].sort((a, b) => a.order - b.order), currency);
    const parsedReceiptTotal = receiptTotal === null || receiptTotal === undefined || receiptTotal === '' ? null : parseMoney(receiptTotal, currency);
    const numericReceiptTotal = parsedReceiptTotal === null ? null : roundMoney(parsedReceiptTotal, currency);
    const close = (a, b) => moneyEquals(a, b, currency);

    let chosen = known;
    let unknownInferredSeparate = false;
    let doubleApplicationPrevented = false;
    if (unknown.length && numericReceiptTotal !== null && close(numericReceiptTotal, allResult.expectedTotal) && !close(numericReceiptTotal, knownResult.expectedTotal)) {
      chosen = [...known, ...unknown].sort((a, b) => a.order - b.order);
      unknownInferredSeparate = true;
    } else if (numericReceiptTotal !== null && close(numericReceiptTotal, subtotal) && !close(knownResult.expectedTotal, subtotal)) {
      chosen = [];
      doubleApplicationPrevented = true;
    } else if (unknown.length && numericReceiptTotal !== null && close(numericReceiptTotal, subtotal)) {
      chosen = known;
      doubleApplicationPrevented = true;
    }

    const result = simulate(subtotal, itemSubtotals, chosen, currency);
    const receiptTotalMatches = numericReceiptTotal === null ? null : close(numericReceiptTotal, result.expectedTotal);
    const skipped = [...included, ...candidates.filter(item => item.application === 'unknown' && !unknownInferredSeparate)];
    return {
      subtotal,
      receiptTotal: numericReceiptTotal,
      itemDiscounts: result.itemDiscounts,
      itemDiscountTotal: result.itemDiscountTotal,
      billDiscountAmount: result.billDiscountAmount,
      discountAmount: result.discountAmount,
      taxAmount: result.taxAmount,
      applied: result.applied,
      skipped,
      expectedTotal: result.expectedTotal,
      receiptTotalMatches,
      doubleApplicationPrevented,
      unknownInferredSeparate
    };
  }

  return { extractPayload, parseMoney, parseRatePercent, normalizeAdjustment, resolveReceiptAdjustments, currencyDecimals, toMinorUnits, roundMoney, formatMoney, moneyEquals, withinRoundingTolerance, isDiscountWithinSubtotal };
});
