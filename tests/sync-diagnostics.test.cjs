'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSyncDiagnostic } = require('../sync-diagnostics.js');

test('keeps only a known sync stage, HTTP status, and allowlisted error code', () => {
  const result = summarizeSyncDiagnostic('publish-result', {
    status: 409,
    code: 'claims_outdated',
    message: 'raw private bill details: 阿明 paid HKD 1234'
  });

  assert.deepEqual(result, { stage: 'publish-result', status: 409, code: 'claims_outdated' });
  assert.equal(JSON.stringify(result).includes('阿明'), false);
  assert.equal(JSON.stringify(result).includes('1234'), false);
  assert.equal(JSON.stringify(result).includes('raw private bill details'), false);
});

test('normalizes unrecognized stages and codes without copying raw error text', () => {
  const result = summarizeSyncDiagnostic('private-session-id', {
    status: 503,
    code: 'private-session-id-and-user-data',
    message: 'do not surface this error'
  });

  assert.deepEqual(result, { stage: 'unknown', status: 503, code: 'unknown' });
  assert.equal(JSON.stringify(result).includes('private-session-id'), false);
  assert.equal(JSON.stringify(result).includes('do not surface this error'), false);
});

test('omits non-HTTP statuses while preserving safe local failure codes', () => {
  assert.deepEqual(
    summarizeSyncDiagnostic('setup-claims', { status: 0, code: 'offline', message: 'offline details' }),
    { stage: 'setup-claims', status: null, code: 'offline' }
  );
  assert.deepEqual(
    summarizeSyncDiagnostic('publish-result', { status: 700, code: 'result_too_large' }),
    { stage: 'publish-result', status: null, code: 'result_too_large' }
  );
});
