import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashPayload,
  verifyActionEvidence,
  verifyPGLProof,
} from '../../src/server/cryptoUtils.js';

test('verifyActionEvidence rejects a forged pgl_ prefix signature', () => {
  const requestPayload = { operation: 'read', target: 'demo' };
  const responsePayload = { status: 'ok' };
  const evidence = {
    transactionId: 'tx-forgery-001',
    capabilityId: 'cap-compute-v1',
    subject: 'subject:test',
    executingNodeId: 'node-test',
    nonce: 'nonce-test',
    timestamp: '2026-08-30T00:00:00.000Z',
    requestPayloadHash: hashPayload(requestPayload),
    responseHash: hashPayload(responsePayload),
    parentBlockHash: '0x00',
    pglSignature: 'pgl_completely_forged_signature',
  };

  const result = verifyActionEvidence(
    evidence,
    requestPayload,
    responsePayload,
  );

  assert.equal(result.signatureMatch, false);
  assert.equal(result.valid, false);
  assert.equal(result.tamperDetected, true);
});

test('verifyPGLProof rejects a forged pgl_ prefix signature', () => {
  const payload = { operation: 'read', target: 'demo' };
  const result = verifyPGLProof(
    'tx-forgery-002',
    'cap-compute-v1',
    payload,
    hashPayload({ status: 'ok' }),
    'pgl_completely_forged_signature',
  );

  assert.equal(result.signatureMatch, false);
  assert.equal(result.valid, false);
  assert.equal(result.tamperDetected, true);
});
