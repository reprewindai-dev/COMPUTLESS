import crypto from 'crypto';
import {
  CanonicalExecutionAuthority,
  GovernedRuntimeRequest,
  VkgPackage,
  BoundedOfflineLease,
} from '../types.js';
import {
  hashPayload,
  signPGLProof,
  verifyPGLProof,
  verifyActionEvidence,
  generateActionEvidence,
  verifyCanonicalAuthority,
  computeScopeTokenDigest,
  confirmActionExecution,
  executeInIsolatedVMSandbox,
} from './cryptoUtils.js';
import {
  validateVkgPackage,
  computeVkgDigest,
  createDefaultVkgPackages,
} from './vkgEngine.js';
import {
  RuntimeAdapterDispatcher,
  NodeVmRuntimeAdapter,
  ContainerRuntimeAdapter,
  VkgRuntimeAdapter,
  OfflineRuntimeAdapter,
  decideRoute,
} from './runtimeAdapters.js';
import type { EvidenceLabel } from '../types.js';

export interface AdversarialTestResult {
  testId: string;
  name: string;
  category: 'CRYPTOGRAPHIC_INTEGRITY' | 'AUTHORITY_BOUNDS' | 'INVARIANT_ROUTING' | 'RUNTIME_CONTAINMENT' | 'VKG_DETERMINISM' | 'OFFLINE_LEASE';
  expectedOutcome: string;
  actualOutcome: string;
  passed: boolean;
  durationMs: number;
  details: string;
  evidenceLabel?: EvidenceLabel;
}

export interface AdversarialTestSuiteReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  tests: AdversarialTestResult[];
  /** Results were computed just now by running repo code in this process. */
  evidenceLabel: EvidenceLabel;
  scope: string;
}

/*
 * Scope: these are unit checks of COMPUTLESS's own code, run in-process. They
 * are VERIFIED_REPO (computed now from repo code), not production proof. The
 * "authority" objects below are locally built scope tokens used as fixtures;
 * they are not CAPPO authority and are never called canonical.
 */

export async function runAdversarialTestSuite(): Promise<AdversarialTestSuiteReport> {
  const tests: AdversarialTestResult[] = [];
  const defaultPkgs = createDefaultVkgPackages();

  // -------------------------------------------------------------
  // Test 1: Forged Cryptographic Signature Rejection (Zero False Proofs)
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const txId = 'tx-adv-001';
    const capId = 'cap-compute-v1';
    const payload = { action: 'adversarial_test', val: 42 };
    const respHash = hashPayload({ status: 'OK' });
    const forgedSig = '0x_forged_sig_deadbeef1234567890abcdef';

    const result = verifyPGLProof(txId, capId, payload, respHash, forgedSig);
    const passed = result.valid === false && result.signatureMatch === false;
    tests.push({
      testId: 'ADV-01',
      name: 'Forged Cryptographic Signature Rejection',
      category: 'CRYPTOGRAPHIC_INTEGRITY',
      expectedOutcome: 'Forged signature must be strictly rejected (valid: false, signatureMatch: false)',
      actualOutcome: `Result valid: ${result.valid}, signatureMatch: ${result.signatureMatch}`,
      passed,
      durationMs: Date.now() - start,
      details: passed
        ? 'Exact local HMAC matching is enforced; prefix-only signatures are rejected.'
        : 'CRITICAL FAILURE: Forged signature was falsely accepted!',
    });
  }

  // -------------------------------------------------------------
  // Test 2: Fail-Closed on Missing / Invalid Signing Authority
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const invalidAuthority = null as any;
    const check = verifyCanonicalAuthority(invalidAuthority);
    const passed = check.valid === false && check.status === 403;
    tests.push({
      testId: 'ADV-02',
      name: 'Fail-Closed on Missing Scope Token',
      category: 'AUTHORITY_BOUNDS',
      expectedOutcome: 'Missing scope token fails closed with 403 and valid: false',
      actualOutcome: `Valid: ${check.valid}, Status: ${check.status}, Error: ${check.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The local scope-token check fails closed. (Execution authority itself is CAPPO, checked by fabric.ts.)',
    });
  }

  // -------------------------------------------------------------
  // Test 3: Expired Authority Rejection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const expiredAuthority: CanonicalExecutionAuthority = {
      executionId: 'exec-exp-001',
      workspaceId: 'ws-test',
      mountId: 'mnt-test',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'compute',
      expiresAt: Date.now() - 10000, // 10s in the past
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    expiredAuthority.authorityDigest = computeScopeTokenDigest(expiredAuthority);

    const check = verifyCanonicalAuthority(expiredAuthority);
    const passed = check.valid === false && check.status === 403;
    tests.push({
      testId: 'ADV-03',
      name: 'Expired Scope Token Rejection',
      category: 'AUTHORITY_BOUNDS',
      expectedOutcome: 'Expired authority token triggers 403 refusal',
      actualOutcome: `Valid: ${check.valid}, Error: ${check.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The scope-token check rejected a token past its expiry.',
    });
  }

  // -------------------------------------------------------------
  // Test 4: Capability Scope Mismatch Rejection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-scope-001',
      workspaceId: 'ws-test',
      mountId: 'mnt-test',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'compute',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const check = verifyCanonicalAuthority(authority, 'cap-rf-telecom');
    const passed = check.valid === false && check.status === 403;
    tests.push({
      testId: 'ADV-04',
      name: 'Capability Scope Mismatch Rejection',
      category: 'AUTHORITY_BOUNDS',
      expectedOutcome: 'Authority for cap-compute-v1 cannot execute cap-rf-telecom (403)',
      actualOutcome: `Valid: ${check.valid}, Error: ${check.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The scope-token check enforced the capability bound.',
    });
  }

  // -------------------------------------------------------------
  // Test 5: Action Scope Mismatch Rejection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-act-001',
      workspaceId: 'ws-test',
      mountId: 'mnt-test',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'calculate_vat',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const check = verifyCanonicalAuthority(authority, 'cap-compute-v1', 'delete_database');
    const passed = check.valid === false && check.status === 403;
    tests.push({
      testId: 'ADV-05',
      name: 'Action Scope Mismatch Rejection',
      category: 'AUTHORITY_BOUNDS',
      expectedOutcome: 'Authority for calculate_vat cannot execute delete_database (403)',
      actualOutcome: `Valid: ${check.valid}, Error: ${check.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The scope-token check enforced the action bound.',
    });
  }

  // -------------------------------------------------------------
  // Test 6: Invariant 1 - Authority Failure Never Reroutes (Terminal 403)
  // -------------------------------------------------------------
  {
    const start = Date.now();
    // Exercises decideRoute, the same function /api/substrate/route uses.
    const decision = decideRoute({ authorityValid: false, primaryAvailable: false, fallbackAvailable: true });
    const allowFallbackSearch = decision.fallbackSearched;
    const passed = decision.outcome === 'TERMINAL_403' && allowFallbackSearch === false;
    tests.push({
      testId: 'ADV-06',
      name: 'Invariant 1: Authority 403 Terminal Denial',
      category: 'INVARIANT_ROUTING',
      expectedOutcome: 'Authority 403 triggers terminal failure with ZERO fallback search (permission hunting blocked)',
      actualOutcome: `Outcome: ${decision.outcome}, fallback searched: ${allowFallbackSearch}`,
      passed,
      durationMs: Date.now() - start,
      details: 'decideRoute returns a terminal 403 without searching for a fallback when authority fails.',
    });
  }

  // -------------------------------------------------------------
  // Test 7: Invariant 2 - 503 Outage Triggers Fallback with Zero Authority Drift
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-inv2-001',
      workspaceId: 'ws-sovereign-01',
      mountId: 'mnt-primary',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'compute',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const authorityBefore = JSON.stringify(authority);
    const decision = decideRoute({ authorityValid: true, primaryAvailable: false, fallbackAvailable: true });
    const noFallback = decideRoute({ authorityValid: true, primaryAvailable: false, fallbackAvailable: false });
    const authorityAfter = JSON.stringify(authority);
    const reroutedNode = decision.outcome;

    const passed = decision.outcome === 'FALLBACK' && noFallback.outcome === 'UNAVAILABLE_503' && authorityBefore === authorityAfter;
    tests.push({
      testId: 'ADV-07',
      name: 'Invariant 2: 503 Fallback Preserves Authority Identity',
      category: 'INVARIANT_ROUTING',
      expectedOutcome: 'Node 503 reroutes execution while authority token remains strictly unchanged (0 drift)',
      actualOutcome: `Outcome: ${reroutedNode}, without fallback: ${noFallback.outcome}, scope token unchanged: ${authorityBefore === authorityAfter}`,
      passed,
      durationMs: Date.now() - start,
      details: 'decideRoute reroutes on outage (503 when no fallback) and takes no authority input, so the token cannot drift. Routing only; nothing is executed remotely.',
    });
  }

  // -------------------------------------------------------------
  // Test 8: Honest Hardware Telemetry & RuntimeObservation Declassification
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const unverifiedObservationReq = {
      transactionId: 'tx-honest-001',
      capabilityId: 'cap-compute-v1',
      subject: 'agent:tester',
      executingNodeId: 'node-standard-vm',
      requestPayload: { x: 1 },
      responsePayload: { status: 'OK', result: 2 },
      actualWallClockLatencyMs: 15,
      memoryUsedBytes: 4096,
      executionStatus: 'SUCCESS' as const,
      hardwareProofProvided: false, // No hardware proof supplied
      isolationVerifiedByEvidence: false, // No external isolation evidence
    };

    const unverifiedCert = confirmActionExecution(unverifiedObservationReq);
    const hwState = unverifiedCert.dimensions.hardwareTelemetry.hardwareProofState;
    const runtimeObs = unverifiedCert.dimensions.resourceContainment.runtimeObservation;

    // A caller CLAIMING hardware/isolation evidence must not be promoted to
    // VERIFIED: COMPUTLESS has no external verifier. (This assertion used to
    // require promotion to VERIFIED, which asserted something false.)
    const claimedObservationReq = {
      ...unverifiedObservationReq,
      transactionId: 'tx-honest-002',
      hardwareProofProvided: true,
      isolationVerifiedByEvidence: true,
      externalEvidenceSource: 'caller-claimed-attestation',
    };
    const claimedCert = confirmActionExecution(claimedObservationReq);
    const claimedRuntimeObs = claimedCert.dimensions.resourceContainment.runtimeObservation;
    const claimedHw = claimedCert.dimensions.hardwareTelemetry;

    const passed =
      hwState === 'UNAVAILABLE' &&
      runtimeObs.state === 'UNAVAILABLE' &&
      runtimeObs.verifiedByEvidence === false &&
      claimedRuntimeObs.state !== 'VERIFIED' &&
      claimedRuntimeObs.verifiedByEvidence === false &&
      claimedHw.status === 'UNAVAILABLE' &&
      claimedHw.uptimeAttestationPct === null;

    tests.push({
      testId: 'ADV-08',
      name: 'Caller-Claimed Hardware Evidence Is Not Accepted',
      category: 'CRYPTOGRAPHIC_INTEGRITY',
      expectedOutcome: 'Without observation: UNAVAILABLE. With caller-claimed attestation flags: still not VERIFIED, hardware UNAVAILABLE, uptime null',
      actualOutcome: `No-claim state: ${runtimeObs.state}, claimed state: ${claimedRuntimeObs.state}, claimed hardware: ${claimedHw.status}`,
      passed,
      durationMs: Date.now() - start,
      details: passed
        ? 'Caller-asserted evidence flags are recorded as unaccepted claims; nothing is promoted to VERIFIED.'
        : 'FAILURE: a caller claim was promoted to a verified state.',
    });
  }

  // -------------------------------------------------------------
  // Test 9: VM Sandbox Timeout Containment
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const infiniteLoopCode = `
      let i = 0;
      while (true) {
        i++;
      }
    `;

    const vmRes = await executeInIsolatedVMSandbox(infiniteLoopCode, {}, 200); // 200ms timeout
    const passed = vmRes.status === 'TERMINATED_TIMEOUT';
    tests.push({
      testId: 'ADV-09',
      name: 'Child-Process Sandbox Timeout',
      category: 'RUNTIME_CONTAINMENT',
      expectedOutcome: 'Infinite loop script terminated cleanly with TERMINATED_TIMEOUT',
      actualOutcome: `Status: ${vmRes.status}, Duration: ${vmRes.durationMs}ms`,
      passed,
      durationMs: Date.now() - start,
      details: 'The child-process sandbox terminated a runaway workload (wall-clock timeout).',
    });
  }

  // -------------------------------------------------------------
  // Test 10: .vkg Package Tamper Detection (Digest Mismatch)
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const originalPkg = defaultPkgs[0];
    const tamperedPkg: VkgPackage = {
      ...originalPkg,
      manifest: {
        ...originalPkg.manifest,
        // Keep original contentDigest but alter handlers
      },
      actionHandlers: {
        ...originalPkg.actionHandlers,
        calculate_vat: `output.hacked = true; console.log("Malicious code injected");`,
      },
    };

    const validation = validateVkgPackage(tamperedPkg);
    const passed = validation.valid === false && validation.manifestMatch === false;
    tests.push({
      testId: 'ADV-10',
      name: 'Tampered .vkg Package Rejection',
      category: 'VKG_DETERMINISM',
      expectedOutcome: 'Modified bytecode in .vkg package detected by SHA-256 digest check and rejected',
      actualOutcome: `Valid: ${validation.valid}, Error: ${validation.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The recomputed SHA-256 content digest detected the modified handler.',
    });
  }

  // -------------------------------------------------------------
  // Test 11: .vkg Deterministic Execution & Bounded Output
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const taxPkg = defaultPkgs[0];
    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-vkg-001',
      workspaceId: 'ws-tax-01',
      mountId: 'mnt-vkg',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'calculate_vat',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const vkgAdapter = new VkgRuntimeAdapter([taxPkg]);
    const req: GovernedRuntimeRequest = {
      authority,
      inputPayload: { amount: 100, country: 'EU' },
      vkgPackageId: taxPkg.manifest.packageId,
      vkgAction: 'calculate_vat',
    };

    const res = await vkgAdapter.execute(req);
    const passed = res.status === 'SUCCESS' && res.outputData.vatAmount === 20 && res.outputData.totalAmount === 120;
    tests.push({
      testId: 'ADV-11',
      name: '.vkg Deterministic Execution',
      category: 'VKG_DETERMINISM',
      expectedOutcome: 'EU VAT on 100 @ 20% computes exactly to vatAmount: 20, totalAmount: 120',
      actualOutcome: `Status: ${res.status}, Output: ${JSON.stringify(res.outputData)}`,
      passed,
      durationMs: Date.now() - start,
      details: 'The .vkg handler produced the expected output in the child-process sandbox.',
    });
  }

  // -------------------------------------------------------------
  // Test 12: Offline Bounded Lease Expiration Rejection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const expiredLease: BoundedOfflineLease = {
      leaseId: 'lease-adv-expired',
      workspaceId: 'ws-offline',
      mountId: 'mnt-offline',
      capabilityId: 'cap-compute-v1',
      allowedActions: ['calculate_vat'],
      maxExecutions: 10,
      executionsRemaining: 10,
      issuedAt: new Date(Date.now() - 100000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
      authorityDigest: '0x_digest',
      startNonce: '0x_off_nonce_01',
      currentNonce: '0x_off_nonce_01',
      isRevoked: false,
    };

    const offlineAdapter = new OfflineRuntimeAdapter([expiredLease]);
    const req: GovernedRuntimeRequest = {
      authority: {
        executionId: 'exec-off-01',
        workspaceId: 'ws-offline',
        mountId: 'mnt-offline',
        capabilityId: 'cap-compute-v1',
        allowedAction: 'calculate_vat',
        expiresAt: Date.now() + 60000,
        authorityDigest: '0x_digest',
        runtimeProfile: 'OFFLINE',
      },
      inputPayload: { amount: 50 },
      offlineLeaseId: expiredLease.leaseId,
    };

    const res = await offlineAdapter.execute(req);
    const passed = res.status === 'UNAUTHORIZED' && res.measuredError?.includes('expired');
    tests.push({
      testId: 'ADV-12',
      name: 'Offline Expired Lease Rejection',
      category: 'OFFLINE_LEASE',
      expectedOutcome: 'Expired offline lease rejected before execution (status: UNAUTHORIZED)',
      actualOutcome: `Status: ${res.status}, Error: ${res.measuredError}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Offline runtime enforced bounded temporal continuation constraints.',
    });
  }

  // -------------------------------------------------------------
  // Test 13: Offline Lease Over-Scope Action Rejection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const scopedLease: BoundedOfflineLease = {
      leaseId: 'lease-adv-scoped',
      workspaceId: 'ws-offline',
      mountId: 'mnt-offline',
      capabilityId: 'cap-compute-v1',
      allowedActions: ['calculate_vat'], // Only calculate_vat allowed
      maxExecutions: 10,
      executionsRemaining: 10,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      authorityDigest: '0x_digest',
      startNonce: '0x_off_nonce_01',
      currentNonce: '0x_off_nonce_01',
      isRevoked: false,
    };

    const offlineAdapter = new OfflineRuntimeAdapter([scopedLease]);
    const req: GovernedRuntimeRequest = {
      authority: {
        executionId: 'exec-off-02',
        workspaceId: 'ws-offline',
        mountId: 'mnt-offline',
        capabilityId: 'cap-compute-v1',
        allowedAction: 'delete_records',
        expiresAt: Date.now() + 60000,
        authorityDigest: '0x_digest',
        runtimeProfile: 'OFFLINE',
      },
      inputPayload: { target: 'all' },
      offlineLeaseId: scopedLease.leaseId,
      vkgAction: 'delete_records',
    };

    const res = await offlineAdapter.execute(req);
    const passed = res.status === 'UNAUTHORIZED';
    tests.push({
      testId: 'ADV-13',
      name: 'Offline Lease Over-Scope Action Rejection',
      category: 'OFFLINE_LEASE',
      expectedOutcome: 'Action outside offline lease allowedActions list is blocked (status: UNAUTHORIZED)',
      actualOutcome: `Status: ${res.status}, Error: ${res.measuredError}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Offline mode prevented unauthorized action escalation.',
    });
  }

  // -------------------------------------------------------------
  // Test 14: Offline Execution Monotonic Nonce & Local Journaling
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const validLease: BoundedOfflineLease = {
      leaseId: 'lease-adv-valid',
      workspaceId: 'ws-offline',
      mountId: 'mnt-offline',
      capabilityId: 'cap-compute-v1',
      allowedActions: ['calculate_vat'],
      maxExecutions: 5,
      executionsRemaining: 5,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      authorityDigest: '0x_digest',
      startNonce: '0x_off_nonce_10',
      currentNonce: '0x_off_nonce_10',
      isRevoked: false,
    };

    const offlineAdapter = new OfflineRuntimeAdapter([validLease]);
    const req: GovernedRuntimeRequest = {
      authority: {
        executionId: 'exec-off-03',
        workspaceId: 'ws-offline',
        mountId: 'mnt-offline',
        capabilityId: 'cap-compute-v1',
        allowedAction: 'calculate_vat',
        expiresAt: Date.now() + 60000,
        authorityDigest: '0x_digest',
        runtimeProfile: 'OFFLINE',
      },
      inputPayload: { amount: 100 },
      offlineLeaseId: validLease.leaseId,
      vkgAction: 'calculate_vat',
    };

    const res = await offlineAdapter.execute(req);
    const journal = offlineAdapter.getJournal();
    const passed =
      res.status === 'SUCCESS' &&
      validLease.executionsRemaining === 4 &&
      validLease.currentNonce !== validLease.startNonce &&
      journal.length === 1 &&
      journal[0].nonce === validLease.currentNonce;

    tests.push({
      testId: 'ADV-14',
      name: 'Offline Monotonic Nonce & Local Observation Journaling',
      category: 'OFFLINE_LEASE',
      expectedOutcome: 'Offline execution decrements quota (5 -> 4), advances nonce, and appends observation to local journal',
      actualOutcome: `Executions remaining: ${validLease.executionsRemaining}, Journal entries: ${journal.length}, Nonce: ${validLease.currentNonce}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Quota decremented, nonce advanced and the observation journaled locally (no reconciliation backend exists).',
    });
  }

  // -------------------------------------------------------------
  // Test 15: Cryptographic Action Evidence Tamper Detection
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const originalEvidence = generateActionEvidence(
      {
        transactionId: 'tx-adv-ev-01',
        capabilityId: 'cap-compute-v1',
        subject: 'agent:tester',
        cappoGrantId: 'cappo-01',
        requestPayload: { secretVal: 100 },
        responsePayload: { status: 'COMPLETE', result: 200 },
        executingNodeId: 'node-01',
      },
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      1
    );

    // Tamper with payload after signature creation
    const tamperedReport = verifyActionEvidence(
      originalEvidence,
      { secretVal: 999999 }, // Altered original input
      { status: 'COMPLETE', result: 200 }
    );

    const passed = tamperedReport.valid === false && tamperedReport.tamperDetected === true;
    tests.push({
      testId: 'ADV-15',
      name: 'Cryptographic Action Evidence Tamper Detection',
      category: 'CRYPTOGRAPHIC_INTEGRITY',
      expectedOutcome: 'Altered request payload triggers SHA-256 digest mismatch and tamperDetected: true',
      actualOutcome: `Valid: ${tamperedReport.valid}, TamperDetected: ${tamperedReport.tamperDetected}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Local verifier detected the payload alteration (local HMAC; not canonical PGL).',
    });
  }

  // -------------------------------------------------------------
  // Test 16: End-to-End RuntimeAdapterDispatcher Profile Routing
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const dispatcher = new RuntimeAdapterDispatcher(defaultPkgs);

    const vkgAuth: CanonicalExecutionAuthority = {
      executionId: 'exec-disp-01',
      workspaceId: 'ws-test',
      mountId: 'mnt-vkg',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'calculate_vat',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    vkgAuth.authorityDigest = computeScopeTokenDigest(vkgAuth);

    const vkgRes = await dispatcher.dispatch({
      authority: vkgAuth,
      inputPayload: { amount: 200, country: 'EU' },
      vkgPackageId: 'vkg-sovereign-tax-calc-v1',
      vkgAction: 'calculate_vat',
    });

    const passed = vkgRes.status === 'SUCCESS' && vkgRes.adapterType === 'VkgRuntimeAdapter';
    tests.push({
      testId: 'ADV-16',
      name: 'RuntimeAdapterDispatcher Profile Dispatch',
      category: 'RUNTIME_CONTAINMENT',
      expectedOutcome: 'Dispatcher transparently routes .vkg workload to VkgRuntimeAdapter',
      actualOutcome: `Adapter: ${vkgRes.adapterType}, Status: ${vkgRes.status}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Unified dispatcher cleanly resolved execution adapter.',
    });
  }

  // -------------------------------------------------------------
  // Test 17: ContainerRuntimeAdapter reports its real boundary
  // (Previously asserted cgroup/namespace containment evidence that did not exist.)
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const containerAdapter = new ContainerRuntimeAdapter();

    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-container-01',
      workspaceId: 'ws-test',
      mountId: 'mnt-container-01',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'run_isolated_job',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const containerRes = await containerAdapter.execute({
      authority,
      inputPayload: { task: 'process_dataset', records: 50 },
      code: `
        const input = context.inputPayload || {};
        output.processedCount = (input.records || 0) * 2;
        output.status = 'COMPLETE';
      `,
    });

    const boundary = (containerRes.sandboxBoundary || {}) as Record<string, unknown>;
    const ranCorrectly = containerRes.status === 'SUCCESS' && containerRes.outputData.processedCount === 100;
    const honestBoundary =
      containerRes.adapterType === 'ContainerRuntimeAdapter' &&
      containerRes.isolationLevel === 'PROCESS_ISOLATION' &&
      boundary.kind === 'node-child-process' &&
      boundary.cgroups === false &&
      String(boundary.network).startsWith('NOT restricted') &&
      containerRes.externalEvidenceSource === undefined;
    const passed = ranCorrectly && honestBoundary;

    tests.push({
      testId: 'ADV-17',
      name: 'ContainerRuntimeAdapter Reports Its Real Boundary (no container)',
      category: 'RUNTIME_CONTAINMENT',
      expectedOutcome:
        'Runs the workload correctly AND reports the child-process sandbox: PROCESS_ISOLATION, cgroups=false, network NOT restricted, no external evidence source',
      actualOutcome: `Status: ${containerRes.status}, processedCount: ${containerRes.outputData.processedCount}, isolation: ${containerRes.isolationLevel}, boundary: ${boundary.kind}, cgroups: ${boundary.cgroups}, network: ${boundary.network}, evidenceSource: ${containerRes.externalEvidenceSource ?? 'none'}`,
      passed,
      durationMs: Date.now() - start,
      details: passed
        ? 'No container is started; the adapter ran in the child-process sandbox and said so. Container isolation remains a TARGET.'
        : `FAILURE: ${ranCorrectly ? 'adapter misreported its boundary' : 'workload did not run correctly'}.`,
    });
  }

  // -------------------------------------------------------------
  // Test 18: Interchangeable RuntimeAdapter Dispatching (NodeVm vs Container)
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const dispatcher = new RuntimeAdapterDispatcher();

    const authority: CanonicalExecutionAuthority = {
      executionId: 'exec-interchangeable-01',
      workspaceId: 'ws-prod-02',
      mountId: 'mnt-interchangeable-01',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'matrix_multiply',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    };
    authority.authorityDigest = computeScopeTokenDigest(authority);

    const req: GovernedRuntimeRequest = {
      authority,
      inputPayload: { size: 10 },
      code: 'output.matrixCalculated = true;',
    };

    // Execute via preferred ContainerRuntimeAdapter
    const containerResult = await dispatcher.dispatch(req, 'ContainerRuntimeAdapter');
    // Execute via preferred NodeVmRuntimeAdapter
    const nodeVmResult = await dispatcher.dispatch(req, 'NodeVmRuntimeAdapter');

    const passed =
      containerResult.status === 'SUCCESS' &&
      containerResult.adapterType === 'ContainerRuntimeAdapter' &&
      nodeVmResult.status === 'SUCCESS' &&
      nodeVmResult.adapterType === 'NodeVmRuntimeAdapter';

    tests.push({
      testId: 'ADV-18',
      name: 'Interchangeable RuntimeAdapter Dispatching',
      category: 'RUNTIME_CONTAINMENT',
      expectedOutcome: 'Dispatcher selects the requested adapter class; both run in the same child-process sandbox',
      actualOutcome: `Container: ${containerResult.adapterType}, NodeVM: ${nodeVmResult.adapterType}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Adapter selection works. Both adapters use the same boundary (no container backend exists).',
    });
  }

  // -------------------------------------------------------------
  // Test 19: Empty scope-token digest fails closed
  // -------------------------------------------------------------
  {
    const start = Date.now();
    const check = verifyCanonicalAuthority({
      executionId: 'exec-empty-digest',
      workspaceId: 'ws-test',
      mountId: 'mnt-test',
      capabilityId: 'cap-compute-v1',
      allowedAction: 'compute',
      expiresAt: Date.now() + 60000,
      authorityDigest: '',
      runtimeProfile: 'CONNECTED',
    });
    const passed = check.valid === false && check.status === 403;
    tests.push({
      testId: 'ADV-19',
      name: 'Empty Scope-Token Digest Fails Closed',
      category: 'AUTHORITY_BOUNDS',
      expectedOutcome: 'A token with an empty digest is rejected (valid: false, 403)',
      actualOutcome: `Valid: ${check.valid}, Status: ${check.status}, Error: ${check.error}`,
      passed,
      durationMs: Date.now() - start,
      details: 'Previously an empty digest skipped the integrity check entirely.',
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  const failedCount = tests.length - passedCount;

  return {
    timestamp: new Date().toISOString(),
    totalTests: tests.length,
    passed: passedCount,
    failed: failedCount,
    allPassed: failedCount === 0,
    tests: tests.map((t) => ({ ...t, evidenceLabel: 'VERIFIED_REPO' as const })),
    evidenceLabel: 'VERIFIED_REPO',
    scope:
      "Unit checks of COMPUTLESS repo code run in this process just now. They test local logic (scope tokens, local HMAC, sandbox, .vkg digests); they are not production, CAPPO or PGL verification.",
  };
}
