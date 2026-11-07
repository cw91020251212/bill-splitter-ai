/* Friend claim revisions: compare the published allocation with the submitted
 * quantities, rather than trusting a local clock or merely seeing 'ready'. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClaimRevisions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function canonicalClaims(claims) {
    return (Array.isArray(claims) ? claims : [])
      .filter(claim => claim && /^\d{2}$/.test(String(claim.id || '')) && Number.isFinite(Number(claim.qty)) && Number(claim.qty) > 0)
      .map(claim => ({ id: String(claim.id), qty: Math.round(Number(claim.qty) * 1000) / 1000, unit: String(claim.unit || '').trim() }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  function resultClaims(data, name) {
    const claims = [];
    for (const item of Array.isArray(data?.items) ? data.items : []) {
      const share = (Array.isArray(item.shares) ? item.shares : []).find(entry => entry.person === name);
      if (!share || !(Number(share.quantity) > 0)) continue;
      claims.push({ id: String(item.id || item.number || ''), qty: Number(share.quantity), unit: share.isActualUnit === true ? String(share.unit || item.unit || '') : '' });
    }
    return canonicalClaims(claims);
  }
  function matchesResult(payload, data) {
    if (!payload?.name || !data?.bill || !Array.isArray(data.items) || !Array.isArray(data.participants)) return false;
    return JSON.stringify(canonicalClaims(payload.claims)) === JSON.stringify(resultClaims(data, payload.name));
  }
  function storageKey(sessionId, topic) {
    const identity = /^[A-Za-z0-9_-]{22}$/.test(String(sessionId || '')) ? sessionId
      : /^bs[a-z0-9]{22}$/.test(String(topic || '')) ? topic : '';
    return identity ? `billSplitterFriendClaimV1:${identity}` : '';
  }
  return { canonicalClaims, resultClaims, matchesResult, storageKey };
});
