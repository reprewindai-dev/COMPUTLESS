import crypto from 'crypto';
import { runInChildSandbox, SANDBOX_BOUNDARY } from './sandbox.js';
import {
  AuthorizationReceipt,
  ActionEvidenceRecord,
  ActionSignatureRequest,
  ActionSignatureVerificationReport,
  EvidenceMerkleProof,
  EvidenceMerkleTreeData,
  ActionConfirmationRequest,
  ActionExecutionConfirmationCertificate,
  ExecutionObservation,
  RuntimeMeasurement,
  RuntimeObservation,
  CapabilityDefinition,
  SubstrateNode,
  CanonicalExecutionAuthority,
} from '../types.js';

// Local HMAC key. From SUBSTRATE_CRYPTO_SECRET if set, otherwise random per
// process: then every restart makes previously signed local records unverifiable.
const CONFIGURED_SECRET = process.env.SUBSTRATE_CRYPTO_SECRET?.trim() || null;
const SUBSTRATE_CRYPTO_SECRET = CONFIGURED_SECRET || crypto.randomBytes(32).toString('hex');

/** What every local signature in this module is (and is not). */
export const LOCAL_SIGNATURE_SCOPE =
  "Local HMAC-SHA256 with COMPUTLESS's own secret. Not CAPPO authority and not canonical PGL evidence.";

export function signingKeyInfo() {
  return {
    algorithm: 'HMAC-SHA256' as const,
    source: CONFIGURED_SECRET ? ('SUBSTRATE_CRYPTO_SECRET' as const) : ('ephemeral-per-process' as const),
    persistent: Boolean(CONFIGURED_SECRET),
    note: CONFIGURED_SECRET
      ? 'Secret from the environment; signatures survive restarts but remain COMPUTLESS-local.'
      : 'Random per-process secret: records signed before the last restart can no longer be verified.',
  };
}

export interface PGLVerificationRequest {
  recordId?: string;
  transactionId?: string;
  requestPayload?: any;
  requestPayloadHash?: string;
  responseHash?: string;
  pglSignature?: string;
}

export interface PGLVerificationResult {
  valid: boolean;
  tamperDetected: boolean;
  computedPayloadHash: string;
  expectedSignature: string;
  signatureMatch: boolean;
  verificationTimestamp: string;
  attestationChain: {
    layer: string;
    status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'INFO';
    detail: string;
  }[];
  scope: string;
}

/**
 * Normalizes and canonicalizes any JSON object to ensure deterministic cryptographic hashing
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJSON(obj[k])).join(',') + '}';
}

/**
 * Computes deterministic SHA-256 hash of a JSON payload
 */
export function hashPayload(payload: any): string {
  const canonical = canonicalizeJSON(payload);
  return '0x' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Generates an HMAC-SHA256 signature for PGL Proof Evidence
 */
export function signPGLProof(txId: string, capabilityId: string, requestHash: string, responseHash: string): string {
  const message = `${txId}:${capabilityId}:${requestHash}:${responseHash}`;
  const hmac = crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(message).digest('hex');
  return `0x_proof_sig_${hmac.slice(0, 32)}`;
}

/** Unkeyed SHA-256 over a scope token's bound fields (anyone can compute it). */
export function computeScopeTokenDigest(authority: Omit<CanonicalExecutionAuthority, 'authorityDigest' | 'expiresAt'>): string {
  return hashPayload({
    executionId: authority.executionId,
    workspaceId: authority.workspaceId,
    mountId: authority.mountId,
    capabilityId: authority.capabilityId,
    allowedAction: authority.allowedAction,
    runtimeProfile: authority.runtimeProfile,
  });
}

/**
 * Builds a self-asserted execution scope token on the server. It bounds
 * capability/action/expiry for the adapters; it is NOT authority.
 */
export function buildLocalScopeToken(params: {
  capabilityId: string;
  allowedAction?: string;
  runtimeProfile?: CanonicalExecutionAuthority['runtimeProfile'];
  workspaceId?: string;
  mountId?: string;
  ttlMs?: number;
  source?: string;
}): CanonicalExecutionAuthority {
  const token = {
    executionId: 'exec-' + crypto.randomBytes(4).toString('hex'),
    workspaceId: params.workspaceId || 'ws-local',
    mountId: params.mountId || 'mnt-local',
    capabilityId: params.capabilityId,
    allowedAction: params.allowedAction || '*',
    runtimeProfile: params.runtimeProfile || ('CONNECTED' as const),
  };
  return {
    ...token,
    expiresAt: Date.now() + (params.ttlMs ?? 60_000),
    authorityDigest: computeScopeTokenDigest(token),
    canonical: false,
    source: params.source || 'server-built scope token (not authority)',
  };
}

export const SCOPE_TOKEN_NOTE =
  'Scope-token check only: the digest is an unkeyed SHA-256 anyone can compute, so this is integrity of a self-asserted token, not authorization.';

/**
 * Checks a self-asserted scope token (expiry, capability/action bounds, digest
 * integrity). Fail-closed: a missing or empty digest is rejected. This is NOT
 * an authority check: real authority is the CAPPO decision (fabric.ts).
 */
export function verifyCanonicalAuthority(
  authority: CanonicalExecutionAuthority,
  requiredCapability?: string,
  requiredAction?: string
): { valid: boolean; error?: string; status: number; scope: string } {
  const scope = SCOPE_TOKEN_NOTE;
  if (!authority) {
    return { valid: false, error: 'Scope token missing', status: 403, scope };
  }

  // Check expiry
  const now = Date.now();
  const expiryTime = typeof authority.expiresAt === 'number' ? authority.expiresAt : new Date(authority.expiresAt).getTime();
  if (isNaN(expiryTime) || now > expiryTime) {
    return {
      valid: false,
      error: isNaN(expiryTime) ? 'Scope token has no valid expiry' : `Scope token expired at ${new Date(expiryTime).toISOString()}`,
      status: 403,
      scope,
    };
  }

  // Check capability match
  if (requiredCapability && authority.capabilityId !== requiredCapability) {
    return {
      valid: false,
      error: `Scope capability mismatch: requires '${requiredCapability}', token covers '${authority.capabilityId}'`,
      status: 403,
      scope,
    };
  }

  // Check action match if specified
  if (requiredAction && authority.allowedAction && authority.allowedAction !== '*' && authority.allowedAction !== requiredAction) {
    return {
      valid: false,
      error: `Scope action mismatch: requires action '${requiredAction}', token covers '${authority.allowedAction}'`,
      status: 403,
      scope,
    };
  }

  // Digest integrity: fail closed on a missing/empty digest.
  if (typeof authority.authorityDigest !== 'string' || authority.authorityDigest.trim() === '') {
    return { valid: false, error: 'Scope token digest missing (fail-closed)', status: 403, scope };
  }
  if (authority.authorityDigest !== computeScopeTokenDigest(authority)) {
    return { valid: false, error: 'Scope token digest mismatch: token fields were altered', status: 403, scope };
  }

  return { valid: true, status: 200, scope };
}

/**
 * Generates an Action Evidence Record with Parent Hash chaining and Merkle Leaf derivation
 */
export function generateActionEvidence(
  params: ActionSignatureRequest,
  parentBlockHash: string = '0x0000000000000000000000000000000000000000000000000000000000000000',
  blockHeight: number = 1
): ActionEvidenceRecord {
  const timestamp = new Date().toISOString();
  const nonce = params.customNonce || '0x_ev_nonce_' + crypto.randomBytes(8).toString('hex');
  const requestPayloadHash = hashPayload(params.requestPayload);
  const responseHash = hashPayload(params.responsePayload);

  // Composite signature over execution context
  const signaturePayload = `${params.transactionId}:${params.capabilityId}:${params.subject}:${requestPayloadHash}:${responseHash}:${params.executingNodeId}:${nonce}:${timestamp}`;
  const pglSignature = '0x_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(signaturePayload).digest('hex');

  // Merkle leaf computation
  const leafPayload = `${params.transactionId}:${requestPayloadHash}:${responseHash}:${pglSignature}`;
  const merkleLeafHash = '0x' + crypto.createHash('sha256').update(leafPayload).digest('hex');

  // Block hash chaining: SHA256(parentHash + blockHeight + merkleLeafHash + timestamp)
  const blockHashPayload = `${parentBlockHash}:${blockHeight}:${merkleLeafHash}:${timestamp}`;
  const blockHash = '0x' + crypto.createHash('sha256').update(blockHashPayload).digest('hex');

  const evidenceId = 'ev-pgl-' + params.transactionId.replace('tx-', '') + '-' + crypto.randomBytes(2).toString('hex');

  const record: ActionEvidenceRecord = {
    id: evidenceId,
    timestamp,
    blockHeight,
    transactionId: params.transactionId,
    capabilityId: params.capabilityId,
    subject: params.subject,
    cappoGrantId: params.cappoGrantId,
    executingNodeId: params.executingNodeId,
    executingNodeName: params.executingNodeName || 'Substrate Execution Node',
    requestPayloadHash,
    responseHash,
    parentBlockHash,
    blockHash,
    pglSignature,
    merkleLeafHash,
    nonce,
    verifiable: false,
    evidenceLabel: 'UNVERIFIED',
    canonical: false,
  };
  record.verifiable = verifyActionEvidence(record).valid;
  return record;
}

/**
 * Deep Cryptographic Evidence Verification Engine (Fail-Closed, Zero False Proofs)
 */
export function verifyActionEvidence(
  evidence: Partial<ActionEvidenceRecord>,
  originalRequestPayload?: Record<string, unknown>,
  originalResponsePayload?: Record<string, unknown>,
  expectedParentHash?: string
): ActionSignatureVerificationReport {
  const verificationTimestamp = new Date().toISOString();
  const checkpoints: ActionSignatureVerificationReport['attestationCheckpoints'] = [];

  // Check 1: Canonical Request Payload Hash
  let computedReqHash = evidence.requestPayloadHash || '';
  let reqHashMatched = true;
  if (originalRequestPayload !== undefined) {
    computedReqHash = hashPayload(originalRequestPayload);
    reqHashMatched = computedReqHash === evidence.requestPayloadHash;
    checkpoints.push({
      checkpoint: 'Checkpoint 1: Request Payload SHA-256 Digest',
      status: reqHashMatched ? 'PASSED' : 'FAILED',
      description: reqHashMatched
        ? 'Request payload matches canonical cryptographic SHA-256 digest.'
        : 'TAMPER DETECTED: Canonical request payload does not match evidence digest.',
      computedValue: computedReqHash,
      expectedValue: evidence.requestPayloadHash,
    });
  } else {
    checkpoints.push({
      checkpoint: 'Checkpoint 1: Request Payload SHA-256 Digest',
      status: 'SKIPPED',
      description: 'No original request payload supplied; the stored digest was used as-is (not checked).',
      computedValue: computedReqHash,
    });
  }

  // Check 2: Canonical Response Payload Hash
  let computedRespHash = evidence.responseHash || '';
  let respHashMatched = true;
  if (originalResponsePayload !== undefined) {
    computedRespHash = hashPayload(originalResponsePayload);
    respHashMatched = computedRespHash === evidence.responseHash;
    checkpoints.push({
      checkpoint: 'Checkpoint 2: Response Payload SHA-256 Digest',
      status: respHashMatched ? 'PASSED' : 'FAILED',
      description: respHashMatched
        ? 'Response execution payload matches canonical cryptographic SHA-256 digest.'
        : 'TAMPER DETECTED: Response payload has been modified or corrupted.',
      computedValue: computedRespHash,
      expectedValue: evidence.responseHash,
    });
  } else {
    checkpoints.push({
      checkpoint: 'Checkpoint 2: Response Payload SHA-256 Digest',
      status: 'SKIPPED',
      description: 'No original response payload supplied; the stored digest was used as-is (not checked).',
      computedValue: computedRespHash,
    });
  }

  // Check 3: Cryptographic Signature Seal Verification (Strict Exact Match)
  const txId = evidence.transactionId || '';
  const capId = evidence.capabilityId || '';
  const subject = evidence.subject || '';
  const nodeId = evidence.executingNodeId || '';
  const nonce = evidence.nonce || '';
  const timestamp = evidence.timestamp || '';

  const signaturePayload = `${txId}:${capId}:${subject}:${computedReqHash}:${computedRespHash}:${nodeId}:${nonce}:${timestamp}`;
  const expectedSig = '0x_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(signaturePayload).digest('hex');
  const legacyExpectedSig = signPGLProof(txId, capId, computedReqHash, computedRespHash);
  const legacyPrefixSig = 'pgl_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(signaturePayload).digest('hex');

  const providedSig = evidence.pglSignature || '';
  // STRICT CHECK: providedSig must EXACTLY match the computed HMAC signature.
  const signatureMatch = providedSig === expectedSig || providedSig === legacyExpectedSig || providedSig === legacyPrefixSig;

  checkpoints.push({
    checkpoint: 'Checkpoint 3: Local HMAC-SHA256 Signature',
    status: signatureMatch ? 'PASSED' : 'FAILED',
    description: signatureMatch
      ? "Signature matches an HMAC computed now with this process's secret (local; not non-repudiation)."
      : `Signature mismatch: forged, altered, or signed with a different secret${signingKeyInfo().persistent ? '' : ' (the secret is random per process, so records from before a restart always fail)'}.`,
    computedValue: expectedSig.slice(0, 24) + '...',
    expectedValue: providedSig.slice(0, 24) + '...',
  });

  // Check 4: Parent Block Chaining
  let chainIntegrityValid: boolean | null = null;
  if (expectedParentHash) {
    chainIntegrityValid = evidence.parentBlockHash === expectedParentHash;
    checkpoints.push({
      checkpoint: 'Checkpoint 4: Parent Hash Link',
      status: chainIntegrityValid ? 'PASSED' : 'FAILED',
      description: chainIntegrityValid
        ? 'Parent block hash link matches sequential ledger history.'
        : 'CHAIN FORK OR BREAK DETECTED: Parent block hash link mismatch.',
      computedValue: evidence.parentBlockHash,
      expectedValue: expectedParentHash,
    });
  } else {
    checkpoints.push({
      checkpoint: 'Checkpoint 4: Parent Hash Link',
      status: 'SKIPPED',
      description: 'No expected parent hash supplied; chain link not checked.',
      computedValue: evidence.parentBlockHash,
    });
  }

  // Check 5: Merkle leaf + block hash recomputation (only when the record stores them)
  let merkleLeafValid: boolean | null = null;
  let blockHashValid: boolean | null = null;
  if (evidence.merkleLeafHash) {
    const leaf =
      '0x' + crypto.createHash('sha256').update(`${txId}:${evidence.requestPayloadHash || ''}:${evidence.responseHash || ''}:${providedSig}`).digest('hex');
    merkleLeafValid = leaf === evidence.merkleLeafHash;
    if (evidence.blockHash && evidence.parentBlockHash && typeof evidence.blockHeight === 'number') {
      const block =
        '0x' +
        crypto
          .createHash('sha256')
          .update(`${evidence.parentBlockHash}:${evidence.blockHeight}:${evidence.merkleLeafHash}:${timestamp}`)
          .digest('hex');
      blockHashValid = block === evidence.blockHash;
    }
  }
  checkpoints.push({
    checkpoint: 'Checkpoint 5: Merkle Leaf & Block Hash Recomputation',
    status: merkleLeafValid === null ? 'SKIPPED' : merkleLeafValid && blockHashValid !== false ? 'PASSED' : 'FAILED',
    description:
      merkleLeafValid === null
        ? 'Record has no stored leaf hash; not checked.'
        : merkleLeafValid && blockHashValid !== false
          ? 'Leaf and block hashes recomputed from the record fields and match.'
          : 'Recomputed leaf or block hash does not match the stored value.',
  });

  // Check 6: Hardware attestation. No external verifier exists in COMPUTLESS.
  checkpoints.push({
    checkpoint: 'Checkpoint 6: Hardware Attestation',
    status: 'UNAVAILABLE',
    description: 'No hardware/TPM attestation verifier exists in COMPUTLESS; nothing was checked.',
  });

  const tamperDetected =
    !reqHashMatched ||
    !respHashMatched ||
    !signatureMatch ||
    chainIntegrityValid === false ||
    merkleLeafValid === false ||
    blockHashValid === false;
  const valid = !tamperDetected;

  return {
    valid,
    tamperDetected,
    verificationTimestamp,
    transactionId: txId,
    capabilityId: capId,
    subject,
    computedRequestHash: computedReqHash,
    computedResponseHash: computedRespHash,
    expectedSignature: expectedSig,
    providedSignature: providedSig,
    signatureMatch,
    chainIntegrityValid,
    merkleProofValid: null,
    merkleLeafValid,
    blockHashValid,
    scope: LOCAL_SIGNATURE_SCOPE,
    attestationCheckpoints: checkpoints,
    verdictSummary: valid
      ? 'Local signature and the checked hashes match (local HMAC; not canonical PGL).'
      : 'Integrity fault: signature or hash mismatch.',
  };
}

/**
 * Merkle Tree Generation for Substrate Evidence Blocks
 */
export function buildEvidenceMerkleTree(evidenceList: ActionEvidenceRecord[]): EvidenceMerkleTreeData {
  if (evidenceList.length === 0) {
    const emptyLeaf = hashPayload('EMPTY_MERKLE_TREE_ROOT');
    return {
      merkleRoot: emptyLeaf,
      totalLeaves: 0,
      treeHeight: 1,
      leaves: [],
      blockHeight: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const leaves = evidenceList.map((e) => e.merkleLeafHash || hashPayload(e.id));
  let currentLevel = [...leaves];
  let height = 1;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      const combined = hashPayload(`${left}:${right}`);
      nextLevel.push(combined);
    }
    currentLevel = nextLevel;
    height++;
  }

  return {
    merkleRoot: currentLevel[0],
    totalLeaves: leaves.length,
    treeHeight: height,
    leaves,
    blockHeight: evidenceList.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates Merkle Audit Proof for a specific evidence index
 */
export function generateEvidenceMerkleProof(
  leafIndex: number,
  evidenceList: ActionEvidenceRecord[]
): EvidenceMerkleProof | null {
  if (leafIndex < 0 || leafIndex >= evidenceList.length) return null;

  const targetEvidence = evidenceList[leafIndex];
  const targetLeaf = targetEvidence.merkleLeafHash || hashPayload(targetEvidence.id);
  const leaves = evidenceList.map((e) => e.merkleLeafHash || hashPayload(e.id));

  let currentLevel = [...leaves];
  let idx = leafIndex;
  const auditPath: { position: 'left' | 'right'; hash: string }[] = [];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      if (i === idx || i + 1 === idx) {
        if (idx % 2 === 0) {
          auditPath.push({ position: 'right', hash: right });
        } else {
          auditPath.push({ position: 'left', hash: left });
        }
      }
      nextLevel.push(hashPayload(`${left}:${right}`));
    }
    currentLevel = nextLevel;
    idx = Math.floor(idx / 2);
  }

  const merkleRoot = currentLevel[0] || targetLeaf;

  const proof: EvidenceMerkleProof = {
    leafHash: targetLeaf,
    leafIndex,
    merkleRoot,
    auditPath,
    isValid: false,
  };
  proof.isValid = verifyMerkleProof(proof);
  return proof;
}

/**
 * Validates a Merkle Proof against the Root Hash
 */
export function verifyMerkleProof(proof: EvidenceMerkleProof): boolean {
  let current = proof.leafHash;
  for (const step of proof.auditPath) {
    if (step.position === 'left') {
      current = hashPayload(`${step.hash}:${current}`);
    } else {
      current = hashPayload(`${current}:${step.hash}`);
    }
  }
  return current === proof.merkleRoot;
}

/**
 * Builds a LOCAL observation certificate for an execution. Only dimensions that
 * can actually be evaluated are scored; everything else is NOT_EVALUATED /
 * UNAVAILABLE with null values. Caller-asserted evidence flags are never
 * promoted to VERIFIED: COMPUTLESS has no external evidence verifier.
 */
export function confirmActionExecution(
  req: ActionConfirmationRequest,
  capability?: CapabilityDefinition,
  _node?: SubstrateNode,
  observed?: { sandboxRan?: boolean }
): ActionExecutionConfirmationCertificate {
  const timestamp = new Date().toISOString();
  const certId = 'aecc-cert-' + String(req.transactionId || 'tx').replace('tx-', '') + '-' + crypto.randomBytes(2).toString('hex');
  const actionId = req.actionId || 'act-' + crypto.randomBytes(3).toString('hex');
  const responsePayload = req.responsePayload && typeof req.responsePayload === 'object' ? req.responsePayload : {};

  // Dimension 1: output schema conformance (only when the capability declares an output schema)
  const matchedFields: string[] = [];
  const missingRequiredFields: string[] = [];
  const outputKeys = capability?.outputSchema ? Object.keys(capability.outputSchema) : [];
  let schemaConformance: ActionExecutionConfirmationCertificate['dimensions']['schemaConformance'];
  if (outputKeys.length === 0) {
    schemaConformance = {
      status: 'NOT_EVALUATED',
      scorePct: null,
      matchedFields,
      missingRequiredFields,
      typeMismatchFields: [],
      details: 'The capability declares no output schema, so output conformance was not evaluated.',
    };
  } else {
    for (const key of outputKeys) (key in responsePayload ? matchedFields : missingRequiredFields).push(key);
    const score = Math.round((matchedFields.length / outputKeys.length) * 100);
    schemaConformance = {
      status: score === 100 ? 'PASSED' : score >= 60 ? 'PARTIAL' : 'FAILED',
      scorePct: score,
      matchedFields,
      missingRequiredFields,
      typeMismatchFields: [],
      details: `${matchedFields.length}/${outputKeys.length} declared output fields present (presence only; types not checked).`,
    };
  }

  // Dimension 2: latency against a caller-supplied budget (none → not evaluated)
  const actualLatency = Math.max(0, Number(req.actualWallClockLatencyMs) || 0);
  const budget = Number(req.latencyBudgetMs);
  let slaLatency: ActionExecutionConfirmationCertificate['dimensions']['slaLatency'];
  if (!Number.isFinite(budget) || budget <= 0) {
    slaLatency = {
      status: 'NOT_EVALUATED',
      scorePct: null,
      actualWallClockLatencyMs: actualLatency,
      budgetedMaxLatencyMs: null,
      varianceMs: null,
      slaCompliant: null,
      details: `Measured ${actualLatency}ms. No latency budget was supplied, so no SLA was evaluated.`,
    };
  } else {
    const compliant = actualLatency <= budget;
    slaLatency = {
      status: compliant ? 'PASSED' : 'FAILED',
      scorePct: compliant ? 100 : 0,
      actualWallClockLatencyMs: actualLatency,
      budgetedMaxLatencyMs: budget,
      varianceMs: actualLatency - budget,
      slaCompliant: compliant,
      details: compliant
        ? `Measured ${actualLatency}ms within the caller-supplied budget of ${budget}ms.`
        : `Measured ${actualLatency}ms exceeds the caller-supplied budget of ${budget}ms.`,
    };
  }

  // Dimension 3: resources. No per-workload memory quota exists.
  const memoryUsedBytes = Math.max(0, Number(req.memoryUsedBytes) || 0);
  const claimed = req.externalEvidenceSource || req.isolationVerifiedByEvidence || req.hardwareProofProvided || req.enclaveAttested;
  const claimNote = claimed
    ? ` Caller claimed external evidence${req.externalEvidenceSource ? ` '${req.externalEvidenceSource}'` : ''}; COMPUTLESS has no verifier for it, so the claim was not accepted.`
    : '';
  const runtimeObservation: RuntimeObservation = observed?.sandboxRan
    ? {
        state: 'OBSERVED',
        isolationLevel: 'PROCESS_ISOLATION',
        verifiedByEvidence: false,
        evidenceSource: 'computless-child-process-sandbox (spawned by this server)',
        measuredAt: timestamp,
        details:
          `Ran in a child process spawned by this server: env inherited=${SANDBOX_BOUNDARY.envInherited}, filesystem ${SANDBOX_BOUNDARY.filesystem}, ` +
          `child processes ${SANDBOX_BOUNDARY.childProcesses}, network ${SANDBOX_BOUNDARY.network}, cgroups=${SANDBOX_BOUNDARY.cgroups}, hardware isolation=${SANDBOX_BOUNDARY.hardwareIsolation}.` +
          claimNote,
      }
    : {
        state: 'UNAVAILABLE',
        isolationLevel: 'UNVERIFIED',
        verifiedByEvidence: false,
        measuredAt: timestamp,
        details: 'COMPUTLESS did not observe this execution; isolation is unknown.' + claimNote,
      };

  const resourceContainment: ActionExecutionConfirmationCertificate['dimensions']['resourceContainment'] = {
    status: 'NOT_EVALUATED',
    scorePct: null,
    memoryUsedBytes,
    memoryQuotaBytes: null,
    memoryUsagePct: null,
    cpuExecutionMs: null,
    runtimeObservation,
    details: `Child-process RSS ${(memoryUsedBytes / 1024).toFixed(1)} KB (reported). No per-workload memory quota exists; the V8 heap is capped via --max-old-space-size. CPU time is not measured.`,
  };

  // Dimension 4: runtime exit status
  const isSuccess = req.executionStatus === 'SUCCESS';
  const runtimeExit: ActionExecutionConfirmationCertificate['dimensions']['runtimeExit'] = {
    status: isSuccess ? 'PASSED' : 'FAILED',
    scorePct: isSuccess ? 100 : 0,
    exitCode: isSuccess ? 0 : 1,
    errorCount: isSuccess ? 0 : 1,
    runtimeStatus:
      req.executionStatus === 'BOUND_VIOLATION' || req.executionStatus === 'UNAUTHORIZED' ? 'POLICY_VIOLATION' : req.executionStatus,
    stdoutLineCount: req.stdout?.length ?? 0,
    details: isSuccess ? 'Workload finished without an error.' : `Workload did not succeed: ${req.executionStatus}.`,
  };

  // Dimension 5: hardware telemetry. Not available: no hardware verifier exists.
  const hardwareTelemetry: ActionExecutionConfirmationCertificate['dimensions']['hardwareTelemetry'] = {
    status: 'UNAVAILABLE',
    scorePct: null,
    monotonicCounterDelta: null,
    uptimeAttestationPct: null,
    enclaveAttestationValid: false,
    nonceFreshness: null,
    hardwareProofState: 'UNAVAILABLE',
    details: 'No hardware, TPM or enclave attestation verifier exists in COMPUTLESS; nothing was measured.',
  };

  const scores = [schemaConformance.scorePct, slaLatency.scorePct, runtimeExit.scorePct].filter(
    (v): v is number => typeof v === 'number'
  );
  const overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  let overallConfirmationStatus: ActionExecutionConfirmationCertificate['overallConfirmationStatus'] = 'LOCALLY_OBSERVED';
  if (!isSuccess) overallConfirmationStatus = 'EXECUTION_FAILED';
  else if (schemaConformance.status === 'FAILED') overallConfirmationStatus = 'SCHEMA_MISMATCH';
  else if (slaLatency.status === 'FAILED') overallConfirmationStatus = 'DEGRADED_SLA';

  const certSigPayload = `${certId}:${actionId}:${req.transactionId}:${req.capabilityId}:${overallScore}:${overallConfirmationStatus}:${timestamp}`;
  const cryptographicAttestationSignature =
    '0x_aecc_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(certSigPayload).digest('hex');

  const evaluated = ['runtime exit', schemaConformance.scorePct !== null ? 'output schema' : null, slaLatency.scorePct !== null ? 'latency budget' : null]
    .filter(Boolean)
    .join(', ');
  const summaryVerdict =
    overallConfirmationStatus === 'EXECUTION_FAILED'
      ? `LOCAL OBSERVATION: execution did not succeed (${req.executionStatus}).`
      : `LOCAL OBSERVATION (evaluated: ${evaluated}; score ${overallScore ?? 'n/a'}%). Hardware attestation unavailable. Not an attestation.`;

  return {
    certificateId: certId,
    timestamp,
    actionId,
    transactionId: req.transactionId,
    capabilityId: req.capabilityId,
    subject: req.subject,
    executingNodeId: req.executingNodeId,
    overallConfirmationStatus,
    confirmationScorePct: overallScore,
    dimensions: {
      schemaConformance,
      slaLatency,
      resourceContainment,
      runtimeExit,
      hardwareTelemetry,
    },
    cryptographicAttestationSignature,
    issuer: 'computless-local-observer (not an attestation authority)',
    summaryVerdict,
    evidenceLabel: 'UNVERIFIED',
    canonical: false,
  };
}

/**
 * Creates a LOCAL authorization receipt (HMAC with this process's secret).
 * Not CAPPO authority; nothing consumes or enforces it.
 */
export function createAuthorizationReceipt(
  cappoGrantId: string,
  subject: string,
  targetCapability: string,
  policyId: string = 'policy-strict-invariant-001',
  expiresInMs: number = 300000 // 5 minutes
): AuthorizationReceipt {
  const receiptId = 'rcpt-vk-' + crypto.randomBytes(4).toString('hex');
  const nonce = '0x_nonce_' + crypto.randomBytes(8).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + expiresInMs;
  const scopeDigest = hashPayload({ cappoGrantId, subject, targetCapability, policyId });

  const signatureMsg = `${receiptId}:${cappoGrantId}:${subject}:${targetCapability}:${scopeDigest}:${nonce}:${expiresAt}`;
  const signature = '0x_rcpt_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(signatureMsg).digest('hex').slice(0, 32);

  return {
    receiptId,
    cappoGrantId,
    subject,
    scopeDigest,
    nonce,
    policyId,
    targetCapability,
    issuedAt,
    expiresAt,
    signature,
    status: 'active',
    evidenceLabel: 'UNVERIFIED',
    canonical: false,
  };
}

/**
 * Verifies a local Authorization Receipt (strict exact HMAC match).
 */
export function verifyAuthorizationReceipt(receipt: AuthorizationReceipt): {
  valid: boolean;
  expired: boolean;
  signatureMatch: boolean;
  details: string;
  scope: string;
} {
  const isExpired = Date.now() > receipt.expiresAt;
  const expectedScopeDigest = hashPayload({
    cappoGrantId: receipt.cappoGrantId,
    subject: receipt.subject,
    targetCapability: receipt.targetCapability,
    policyId: receipt.policyId,
  });

  const signatureMsg = `${receipt.receiptId}:${receipt.cappoGrantId}:${receipt.subject}:${receipt.targetCapability}:${expectedScopeDigest}:${receipt.nonce}:${receipt.expiresAt}`;
  const expectedSig = '0x_rcpt_sig_' + crypto.createHmac('sha256', SUBSTRATE_CRYPTO_SECRET).update(signatureMsg).digest('hex').slice(0, 32);

  const signatureMatch = receipt.signature === expectedSig;
  const valid = signatureMatch && !isExpired;

  return {
    valid,
    expired: isExpired,
    signatureMatch,
    details: valid
      ? 'Local receipt signature matches and the receipt has not expired (single use is NOT enforced).'
      : isExpired
      ? 'Receipt has expired.'
      : 'Signature mismatch: forged, tampered, or signed with a different process secret.',
    scope: LOCAL_SIGNATURE_SCOPE,
  };
}

/** Re-checks a stored local PGL-proof signature against its stored hashes. */
export function verifyPGLRecordSignature(rec: {
  transactionId: string;
  capabilityId: string;
  requestPayloadHash: string;
  responseHash: string;
  pglSignature: string;
}): boolean {
  return Boolean(rec.pglSignature) && signPGLProof(rec.transactionId, rec.capabilityId, rec.requestPayloadHash, rec.responseHash) === rec.pglSignature;
}

/**
 * Verifies a local PGL proof against a payload and signature (strict exact match).
 */
export function verifyPGLProof(
  txId: string,
  capabilityId: string,
  payload: any,
  responseHash: string,
  providedSignature: string
): PGLVerificationResult {
  const computedPayloadHash = hashPayload(payload);
  const expectedSignature = signPGLProof(txId, capabilityId, computedPayloadHash, responseHash);
  const signatureMatch = providedSignature === expectedSignature;

  const attestationChain: PGLVerificationResult['attestationChain'] = [
    {
      layer: 'Payload digest',
      status: 'INFO',
      detail: `Payload canonicalized and hashed to ${computedPayloadHash.slice(0, 18)}...`,
    },
    {
      layer: 'CAPPO authority binding',
      status: 'SKIPPED',
      detail: 'Not checked: local records carry no CAPPO decision binding.',
    },
    {
      layer: 'Local HMAC signature',
      status: signatureMatch ? 'PASSED' : 'FAILED',
      detail: signatureMatch
        ? `Signature ${providedSignature.slice(0, 20)}... matches (this process's secret).`
        : `Signature mismatch. Provided: ${String(providedSignature).slice(0, 16)}..., expected: ${expectedSignature.slice(0, 16)}...`,
    },
  ];

  return {
    valid: signatureMatch,
    tamperDetected: !signatureMatch,
    computedPayloadHash,
    expectedSignature,
    signatureMatch,
    verificationTimestamp: new Date().toISOString(),
    attestationChain,
    scope: LOCAL_SIGNATURE_SCOPE,
  };
}

/**
 * Executes a workload in the child-process sandbox (see sandbox.ts for exactly
 * what that boundary does and does not restrict).
 */
export async function executeInIsolatedVMSandbox(
  code: string,
  inputPayload: Record<string, unknown>,
  timeoutMs: number = 3000
): Promise<{
  status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR';
  stdout: string[];
  outputData: Record<string, unknown>;
  /** Child process RSS when the workload finished (0 when unknown). Not a per-workload quota. */
  memoryUsageBytes: number;
  /** Same value, null when unknown. */
  rssBytes: number | null;
  /** Wall-clock time measured inside the child around the workload. */
  durationMs: number;
}> {
  const r = await runInChildSandbox(code, { input: inputPayload, context: { inputPayload } }, timeoutMs);
  const status = r.status === 'SUCCESS' || r.status === 'TERMINATED_TIMEOUT' ? r.status : 'RUNTIME_ERROR';
  const stdout = [...r.stdout, ...r.stderr];
  if (r.error) stdout.push(`[FAULT] ${r.error.message}`);
  const outputData =
    r.status === 'SUCCESS'
      ? r.output && typeof r.output === 'object'
        ? (r.output as Record<string, unknown>)
        : { value: r.output }
      : { error: r.error?.message ?? 'Execution fault', code: r.error?.code ?? r.status };
  return { status, stdout, outputData, memoryUsageBytes: r.rssBytes ?? 0, rssBytes: r.rssBytes, durationMs: r.durationMs };
}

/**
 * RFC 9457 Problem Details. Problem types are URNs (no hosted documentation).
 */
export function buildProblemDetails(
  type: string,
  title: string,
  status: number,
  detail: string,
  instance: string
) {
  const slug = String(type)
    .replace(/^https?:\/\/[^/]+\/probs\//, '')
    .replace(/^urn:computless:problem:/, '');
  return {
    type: `urn:computless:problem:${slug}`,
    title,
    status,
    detail,
    instance,
    timestamp: new Date().toISOString(),
    ...(status === 403 ? { governanceInvariant: 'Authority-Invariant-403' } : status === 503 ? { governanceInvariant: 'Fallback-Invariant-503' } : {}),
  };
}

/**
 * x402-style headers. No settlement backend exists, so the only truthful
 * statement is that the request is unsettled.
 */
export function buildx402Headers(providerId: string, txId: string) {
  return {
    'Payment-Response': `status=unsettled reason=settlement-not-implemented provider=${providerId} tx=${txId}`,
  };
}
