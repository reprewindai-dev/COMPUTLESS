import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalScopeToken,
  buildx402Headers,
  confirmActionExecution,
  generateActionEvidence,
  generateEvidenceMerkleProof,
  verifyActionEvidence,
  verifyCanonicalAuthority,
} from '../../src/server/cryptoUtils.js';
import { runAdversarialTestSuite } from '../../src/server/adversarialTests.js';

test('a scope token with an empty digest fails closed', () => {
  const token = buildLocalScopeToken({ capabilityId: 'cap-compute-v1', allowedAction: 'compute' });
  assert.equal(verifyCanonicalAuthority(token).valid, true);
  assert.equal(verifyCanonicalAuthority({ ...token, authorityDigest: '' }).valid, false);
  assert.equal(verifyCanonicalAuthority({ ...token, authorityDigest: '0x_ui_auth_123' }).valid, false);
});

test('checks that were not performed are SKIPPED/UNAVAILABLE, never PASSED', () => {
  const ev = generateActionEvidence({
    transactionId: 'tx-truth-1',
    capabilityId: 'cap-compute-v1',
    subject: 'agent:test',
    requestPayload: { a: 1 },
    responsePayload: { b: 2 },
    executingNodeId: 'local-sandbox',
  });
  assert.equal(ev.verifiable, true);
  assert.equal(ev.canonical, false);
  const report = verifyActionEvidence(ev);
  const byName = (prefix: string) => report.attestationCheckpoints.find((c) => c.checkpoint.startsWith(prefix))!;
  assert.equal(byName('Checkpoint 1').status, 'SKIPPED');
  assert.equal(byName('Checkpoint 2').status, 'SKIPPED');
  assert.equal(byName('Checkpoint 4').status, 'SKIPPED');
  assert.equal(byName('Checkpoint 6').status, 'UNAVAILABLE');
  assert.equal(report.merkleProofValid, null);
  assert.equal(report.merkleLeafValid, true);
  assert.equal(report.blockHashValid, true);

  // Altering the stored block hash is detected by recomputation.
  assert.equal(verifyActionEvidence({ ...ev, blockHash: '0xdead' }).valid, false);
});

test('merkle proof validity is computed, not asserted', () => {
  const evs = [1, 2, 3].map((n) =>
    generateActionEvidence({
      transactionId: `tx-m-${n}`,
      capabilityId: 'cap-compute-v1',
      subject: 'agent:test',
      requestPayload: { n },
      responsePayload: { n },
      executingNodeId: 'local-sandbox',
    })
  );
  for (let i = 0; i < evs.length; i++) assert.equal(generateEvidenceMerkleProof(i, evs)!.isValid, true);
});

test('caller-claimed hardware evidence is never promoted to VERIFIED', () => {
  const cert = confirmActionExecution({
    transactionId: 'tx-claim',
    capabilityId: 'cap-compute-v1',
    subject: 'agent:test',
    executingNodeId: 'x',
    requestPayload: {},
    responsePayload: {},
    actualWallClockLatencyMs: 5,
    memoryUsedBytes: 1000,
    executionStatus: 'SUCCESS',
    hardwareProofProvided: true,
    isolationVerifiedByEvidence: true,
    externalEvidenceSource: 'TPM_2_0_ENCLAVE_ATTESTATION',
  });
  assert.notEqual(cert.dimensions.resourceContainment.runtimeObservation.state, 'VERIFIED');
  assert.equal(cert.dimensions.hardwareTelemetry.status, 'UNAVAILABLE');
  assert.equal(cert.dimensions.hardwareTelemetry.uptimeAttestationPct, null);
  assert.equal(cert.dimensions.resourceContainment.memoryQuotaBytes, null);
  assert.equal(cert.dimensions.slaLatency.status, 'NOT_EVALUATED');
  assert.equal(cert.canonical, false);
});

test('x402 headers say unsettled', () => {
  const h = buildx402Headers('p', 'tx');
  assert.match(h['Payment-Response'], /^status=unsettled /);
  assert.ok(!JSON.stringify(h).includes('status=settled'));
});

test('adversarial suite passes and ADV-17 reports the real (non-container) boundary', async () => {
  const report = await runAdversarialTestSuite();
  const failed = report.tests.filter((t) => !t.passed).map((t) => `${t.testId}: ${t.actualOutcome}`);
  assert.deepEqual(failed, []);
  assert.equal(report.evidenceLabel, 'VERIFIED_REPO');
  const adv17 = report.tests.find((t) => t.testId === 'ADV-17')!;
  assert.match(adv17.actualOutcome, /cgroups: false/);
  assert.match(adv17.actualOutcome, /network: NOT restricted/);
});
