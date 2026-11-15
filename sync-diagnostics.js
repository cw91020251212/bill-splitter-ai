(function (root) {
  'use strict';

  const STAGES = new Set(['prepare-session', 'setup-claims', 'build-link', 'publish-result']);
  const SAFE_CODES = new Set([
    'offline', 'missing_api_config', 'invalid_owner_token', 'invalid_share_id', 'invalid_input', 'not_found',
    'expired', 'not_claim_session', 'forbidden', 'method_not_allowed',
    'claim_auth_unavailable', 'invalid_members', 'too_many_members', 'protection_required',
    'claims_outdated', 'result_too_large', 'protection_pending'
  ]);

  function summarizeSyncDiagnostic(stage, error) {
    const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
      ? error.status
      : null;
    return Object.freeze({
      stage: STAGES.has(stage) ? stage : 'unknown',
      status,
      code: SAFE_CODES.has(error?.code) ? error.code : 'unknown'
    });
  }

  const api = Object.freeze({ summarizeSyncDiagnostic });
  root.BillShareSyncDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
