/**
 * Veklom evidence labels. Seed data is DEMO; records created by COMPUTLESS's own
 * local logic are UNVERIFIED; checks recomputed now from repo-held content are
 * VERIFIED_REPO; only results observed live from the Veklom fabric (fabric.ts)
 * are VERIFIED_LIVE. Demo/seeded/synthetic output is never production proof.
 */
export type EvidenceLabel =
  | 'VERIFIED_LIVE'
  | 'VERIFIED_REPO'
  | 'CONFIGURED'
  | 'LAST_KNOWN'
  | 'TARGET'
  | 'UNVERIFIED'
  | 'DEMO'
  | 'ARCHIVED';

export type SubstrateNodeType = 'local_k8s' | 'aws_edge' | 'azure_sovereign' | 'rf_microcontroller';

export interface SubstrateNode {
  id: string;
  name: string;
  type: SubstrateNodeType;
  region: string;
  /** Declared boundary label; never verified. */
  localityBoundary: string;
  /**
   * COMPUTLESS has no node probe, so a node is never 'online' merely by being
   * registered: registered/seeded nodes are 'unverified'. 'offline'/'degraded'
   * are operator toggles.
   */
  status: 'online' | 'degraded' | 'offline' | 'unverified';
  /** Operator-declared latency (null = not measured / not declared). */
  latencyMs: number | null;
  /** null = not measured (no node telemetry exists). */
  cpuUsagePct: number | null;
  memoryUsagePct: number | null;
  activeWorkloads: number | null;
  /** Declared flag only; nothing verifies sovereignty. */
  isSovereign: boolean;
  mcpEnabled: boolean;
  supportedCapabilities: string[];
  evidenceLabel?: EvidenceLabel;
}

export interface CAPPOGrant {
  grantId: string;
  subject: string;
  allowedCapabilities: string[];
  expiresAt: number;
  signature: string;
  isRevoked: boolean;
  issuer?: string;
  issueDate?: string;
  /** Unsigned local digest. Local grants are not CAPPO authority. */
  cappoSignature?: string;
  /** Derived from time on every read. */
  status?: 'active' | 'expired' | 'revoked';
  evidenceLabel?: EvidenceLabel;
  canonical?: false;
  authoritySource?: 'local-grant (not CAPPO)';
}

export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  category: 'compute' | 'data_persistence' | 'edge_rf' | 'agent_recursion' | 'mcp_bridge';
  requiredRole: string;
  schemaJson: string;
  outputSchema?: Record<string, string>;
  maxPricePerCall?: number;
  evidenceLabel?: EvidenceLabel;
}

export interface HRMRRouteRequest {
  capabilityId: string;
  cappoGrantId?: string;
  preferredNodeId?: string;
  payload: Record<string, unknown>;
  force503NodeId?: string; // Simulator helper to trigger 503 on a specific node
  invalidCappo?: boolean; // Simulator helper to trigger 403 terminal
}

export interface RouteTraceStep {
  step: number;
  timestamp: string;
  layer: string;
  nodeId?: string;
  nodeName?: string;
  status: 'PENDING' | 'SUCCESS' | 'TERMINAL_403' | 'FALLBACK_503' | 'EXECUTED';
  detail: string;
}

export interface HRMRRouteResult {
  transactionId: string;
  capabilityId: string;
  requestedNodeId: string;
  executedNodeId?: string;
  finalHttpStatus: 200 | 403 | 503 | 500;
  authorityDecision: 'GRANTED' | 'DENIED_TERMINAL';
  executionStatus: 'SUCCESS' | 'REROUTED_FALLBACK' | 'FAILED';
  /** Measured handler time (process.hrtime). No workload runs on this route. */
  executionTimeMs: number;
  pglProofHash?: string;
  /** No settlement exists. */
  x402SettlementGas?: number | null;
  trace: RouteTraceStep[];
  outputData?: Record<string, unknown>;
  evidenceLabel?: EvidenceLabel;
  authoritySource?: 'local-grant (not CAPPO)';
}

export interface PGLRecord {
  id: string;
  timestamp: string;
  transactionId: string;
  capabilityId: string;
  cappoGrantId: string;
  executedNodeId: string;
  requestPayloadHash: string;
  responseHash: string;
  /** Local HMAC-SHA256 signature with this process's secret. Not canonical PGL. */
  pglSignature: string;
  /** No settlement exists: always null. */
  x402GasSettled: number | null;
  /** Recomputed on read: does the signature verify with the current secret? */
  verifiable: boolean;
  evidenceLabel?: EvidenceLabel;
  canonical?: false;
  signatureScheme?: 'local-hmac-pgl-proof-v1' | 'local-hmac-action-evidence-v1' | 'none';
}

export interface AgentTask {
  id: string;
  name: string;
  status: 'IDLE' | 'EVALUATING' | 'EXECUTING' | 'RECURSING' | 'COMPLETED';
  capabilitiesUsed: string[];
  recursionDepth: number;
  maxRecursionDepth: number;
  lastOptimizedAt?: string;
  logs: string[];
  /** Not measured: null. */
  metrics: {
    opsPerSec: number | null;
    tasksDriven: number | null;
    successRatePct: number | null;
  };
  evidenceLabel?: EvidenceLabel;
}

export interface PluginModule {
  id: string;
  name: string;
  category: 'Cloud Adapter' | 'Protocol Extension' | 'Security / Audit' | 'Hardware Connector';
  version: string;
  enabled: boolean;
  description: string;
  author: string;
  /** Not measured: null. */
  downloads: number | null;
  activeCapabilityId: string;
  /** false = catalog entry only, no adapter code exists. */
  implemented?: boolean;
  evidenceLabel?: EvidenceLabel;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capabilityBinding: string;
}

// Federation Provider Interface (FPI) Types
/** 'active' is only valid after an observed heartbeat; COMPUTLESS has none, so providers are 'unverified'. */
export type FPIProviderStatus = 'active' | 'degraded' | 'suspended' | 'registering' | 'offline' | 'maintenance' | 'unverified';

export interface FPIProviderPricing {
  pricePerComputeUnitVEK: number;
  spotDiscountPct: number;
  currency: 'VEK';
}

export interface FPIProviderQuota {
  totalAllocatedUnits: number;
  usedUnits: number;
  maxCapacityUnits: number;
}

export interface FPIProvider {
  id: string;
  providerName: string;
  providerType: 'hyperscaler' | 'sovereign_enclave' | 'decentralized_mesh' | 'edge_telecom';
  endpointUrl: string;
  /** SHA-256 of a supplied key, or null when none was supplied. */
  authKeyHash: string | null;
  regions: string[];
  status: FPIProviderStatus;
  /** Declared by the registrant (never measured); null when not declared. */
  slaUptimePct: number | null;
  /** Declared by the registrant (never measured); null when not declared. */
  maxLatencyMs: number | null;
  /** Declared flag only. */
  isSovereignEnclave: boolean;
  supportedCapabilities: string[];
  pricing: FPIProviderPricing;
  quota: FPIProviderQuota;
  registeredAt: string;
  /** null = no heartbeat has ever been received (COMPUTLESS has no heartbeat endpoint). */
  lastHeartbeatAt: string | null;
  evidenceLabel?: EvidenceLabel;
}

export interface FPIResourceAllocation {
  id: string;
  providerId: string;
  providerName: string;
  granteeSubject: string;
  computeUnits: number;
  memoryGb: number;
  gpuCores: number;
  allocationType: 'reserved' | 'spot' | 'on_demand';
  status: 'active' | 'expired' | 'deallocated';
  leaseDurationMinutes: number;
  createdAt: string;
  expiresAt: string;
  /** Quote from declared pricing; nothing is charged or settled. */
  x402TotalLeaseCostVEK: number;
  evidenceLabel?: EvidenceLabel;
}

export interface FPIExecutionJob {
  id: string;
  providerId: string;
  providerName: string;
  capabilityId: string;
  cappoGrantId: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'fallback_rerouted' | 'not_dispatched';
  /** null = nothing executed. */
  executionTimeMs: number | null;
  /** No settlement exists: null. */
  x402GasSettled: number | null;
  pglProofSignature: string | null;
  submittedAt: string;
  completedAt?: string | null;
  outputSummary: string;
  logs: string[];
  dispatched?: boolean;
  evidenceLabel?: EvidenceLabel;
}

export interface FPIBillingSettlement {
  id: string;
  providerId: string;
  providerName: string;
  period: string;
  jobsExecuted: number | null;
  totalComputeUnitsUsed: number | null;
  totalx402EarnedVEK: number | null;
  /** No settlement exists. */
  payoutStatus: 'unsettled' | 'not_implemented';
  payoutTxHash: null;
  timestamp: string;
  evidenceLabel?: EvidenceLabel;
}

export interface FPIDiscoveryQuery {
  capabilityId?: string;
  region?: string;
  maxLatencyMs?: number;
  isSovereignRequired?: boolean;
  maxPricePerUnitVEK?: number;
  minUptimePct?: number;
}

// =========================================================================
// Veklom Amplification Ladder & Topological Machine-Native Substrate Types
// =========================================================================

export interface AuthorizationReceipt {
  receiptId: string;
  cappoGrantId: string;
  subject: string;
  scopeDigest: string;
  nonce: string;
  policyId: string;
  targetCapability: string;
  issuedAt: string;
  expiresAt: number;
  signature: string;
  /** Derived from time on read. */
  status: 'active' | 'consumed' | 'expired';
  consumedAt?: string;
  evidenceLabel?: EvidenceLabel;
  /** Local HMAC receipt; not CAPPO authority. */
  canonical?: false;
}

export interface BlockedIntentRecord {
  id: string;
  timestamp: string;
  subject: string;
  attemptedCapability: string;
  reason: 'INSUFFICIENT_SCOPE' | 'EXPIRED_CAPPO' | 'ANOMALOUS_PARAM' | 'UNAUTHORIZED_CROSS_SYSTEM' | 'REVOKED_GRANT';
  httpStatus: 403;
  problemDetails: {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
  };
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** No quarantine mechanism exists: always false. */
  quarantineApplied: boolean;
  evidenceLabel?: EvidenceLabel;
}

export interface AgentIdentity {
  id: string;
  name: string;
  /** NOT a cryptographic public key: an identifier digest (see keyType). */
  publicKey: string;
  keyType?: 'id-digest (not a key)';
  trustTier: 'T0_EPHEMERAL' | 'T1_SCOPED' | 'T2_AUTONOMOUS' | 'T3_SUBSTRATE_CORE' | 'T4_SOVEREIGN_ROOT';
  allowedCapabilities: string[];
  totalActionsGoverned: number;
  totalReceiptsIssued: number;
  evidenceChainLength: number;
  recursionDepth: number;
  lastActiveAt: string;
  registeredAt: string;
  sandboxRuntimePreference: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell';
  evidenceLabel?: EvidenceLabel;
}

export interface SandboxExecutionRequest {
  agentId: string;
  capabilityId: string;
  code: string;
  inputPayload: Record<string, unknown>;
  memoryLimitMb?: number;
  timeoutMs?: number;
  sandboxType?: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell';
  cappoGrantId?: string;
}

export interface SandboxExecutionResult {
  executionId: string;
  agentId: string;
  capabilityId: string;
  sandboxType: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell';
  status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'POLICY_VIOLATION' | 'RUNTIME_ERROR';
  success?: boolean;
  stdout: string[];
  outputData: Record<string, unknown>;
  /** Child-process RSS when the workload finished (0 = unknown). Not a per-workload quota. */
  memoryUsageBytes: number;
  /** Wall-clock time measured inside the child around the workload. */
  executionDurationMs: number;
  /** Local receipts are no longer issued for execution; authority is governance.authorization. */
  receipt: AuthorizationReceipt | null;
  /** Local HMAC (not canonical PGL). */
  pglProofSignature: string;
  requestPayloadHash: string;
  responseHash: string;
  /** No settlement exists: null. */
  x402GasSettled: number | null;
  timestamp: string;
  evidenceLabel?: EvidenceLabel;
  canonical?: false;
  /** Where the code actually ran (all sandboxType values use this). */
  actualSandbox?: string;
}

export interface VeklomAmplificationMetrics {
  formula: 'A = f(G, R, B, S, E, I, N)';
  amplificationScore: number;
  recursionFormula: 'R = f(I, P, A, E)';
  rungs: {
    rung1_governedActions: { count: number; label: 'Governed Actions (G)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung2_authorizationReceipts: { count: number; label: 'Authorization Receipts (R)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung3_blockedIntents: { count: number; label: 'Blocked Intents (B)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung4_safeRoutes: { count: number; label: 'Safe Routes (S)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung5_evidenceChainEntries: { count: number; label: 'Evidence Chain Entries (E)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung6_agentIdentities: { count: number; label: 'Agent Identities (I)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
    rung7_integrations: { count: number; label: 'Integrations (N)'; status: 'local_count'; evidenceLabel?: EvidenceLabel };
  };
  latestReceipts: AuthorizationReceipt[];
  latestBlocked: BlockedIntentRecord[];
  activeIdentities: AgentIdentity[];
  /** Not measured: null. */
  systemEntropyPct: number | null;
  lastEvaluatedAt: string;
  evidenceLabel?: EvidenceLabel;
  note?: string;
}

// =========================================================================
// 8-Layer COMPUTLESS CLOUD Substrate Architecture Specifications & Pipeline
// =========================================================================

export interface SubstrateLayerSpec {
  layerNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  layerId: string;
  name: string;
  question: string;
  corePrinciple: string;
  primaryMechanism: string;
  invariants: string[];
  protocolStandard: string;
  dataStructures: string[];
  /** The spec text above is a TARGET; currentImplementation says what the code does today. */
  evidenceLabel?: EvidenceLabel;
  currentImplementation?: string;
}

export interface Substrate8LayerArchitectureSpec {
  title: string;
  version: string;
  network: string;
  layers: SubstrateLayerSpec[];
  evidenceLabel?: EvidenceLabel;
}

export interface Substrate8LayerPipelineRequest {
  capabilityId: string;
  subject: string;
  cappoGrantId?: string;
  payload: Record<string, unknown>;
  routingPolicy?: {
    requireSovereignty?: boolean;
    maxLatencyMs?: number;
    preferredRegion?: string;
    priority?: 'speed' | 'cost' | 'security';
  };
  runtimeTarget?: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell' | 'rf_edge';
  codeSnippet?: string;
  simulateFault?: 'INVALID_CAPPO' | 'EXPIRED_GRANT' | 'NODE_OUTAGE_503' | 'NONE';
}

export interface Substrate8LayerStepResult<T = any> {
  layerNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  layerName: string;
  question: string;
  status: 'SUCCESS' | 'BLOCKED_403' | 'FALLBACK_503' | 'ERROR' | 'SKIPPED' | 'NOT_IMPLEMENTED';
  durationMs: number;
  data: T;
  summary: string;
}

export interface Substrate8LayerPipelineResult {
  pipelineId: string;
  timestamp: string;
  overallStatus: 'SUCCESS' | 'BLOCKED_403' | 'FALLBACK_503' | 'EXECUTION_FAILED';
  httpStatus: 200 | 403 | 422 | 503 | 504 | 500;
  totalDurationMs: number;
  requestedCapabilityId: string;
  executingSubject: string;
  receiptId?: string | null;
  pglProofSignature?: string;
  /** No settlement exists: null. */
  settlementTxHash?: null;
  x402GasSettled?: null;
  evidenceLabel?: EvidenceLabel;
  layers: {
    layer1_capability: Substrate8LayerStepResult<{
      capability: CapabilityDefinition;
      /** No JSON-schema validation is performed: always false. */
      schemaValidated: boolean;
      payloadIsObject: boolean;
      inputParams: Record<string, unknown>;
    }>;
    layer2_authority: Substrate8LayerStepResult<{
      mode: 'local-demo' | 'governed' | 'disabled';
      /** CAPPO decision from res.locals.governance (null in local-demo). */
      authorization: Record<string, unknown> | null;
      authorized: boolean;
      cappoGrantId?: string | null;
      cappoValid: boolean;
      receipt?: AuthorizationReceipt | null;
      rolePermitted: boolean;
      blockedReason?: string;
      simulated?: boolean;
    } | null>;
    layer3_federation: Substrate8LayerStepResult<{
      totalEligibleProviders: number;
      eligibleProviders: { id: string; name: string; type: string; status: string; isSovereign: boolean; price: number; sla: number | null }[];
      selectedFederationCluster: string;
    } | null>;
    layer4_routing: Substrate8LayerStepResult<{
      primaryCandidate: { id: string; name: string; latencyMs: number | null; score: number | null } | null;
      executedNode: { id: string; name: string; region: string };
      reroutedFallback: boolean;
      fallbackReason?: string;
      hrmrScore: number | null;
      note: string;
    } | null>;
    layer5_execution: Substrate8LayerStepResult<{
      sandboxType: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell' | 'rf_edge';
      actualSandbox: string;
      executionStatus: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR';
      stdout: string[];
      outputData: Record<string, unknown>;
      /** Child-process RSS at workload end. */
      memoryUsedBytes: number;
      /** Not measured (wall-clock is reported instead): null. */
      cpuExecutionMs: number | null;
      workloadWallClockMs: number;
    } | null>;
    layer6_evidence: Substrate8LayerStepResult<{
      ledger: 'gnomledger' | 'local-only';
      pglRecord: PGLRecord;
      requestPayloadHash: string;
      responseHash: string;
      pglSignature: string;
      localLedgerIndex: number;
    } | null>;
    layer7_measurement: Substrate8LayerStepResult<{
      uptimePct: null;
      actualWallClockLatencyMs: number;
      memoryDeltaBytes: number;
      throughputOps: null;
      slaCompliant: boolean | null;
    } | null>;
    layer8_settlement: Substrate8LayerStepResult<{
      implemented: false;
      currency: 'VEK';
      x402GasSettled: null;
      providerPayoutEarned: null;
      protocolFee: null;
      payoutTxHash: null;
      payoutStatus: 'not_implemented';
      settlementFinality: 'NONE';
    } | null>;
  };
}

// =========================================================================
// Evidence Layer (Layer 6) - Cryptographic Action Attestation & Proof Graph
// =========================================================================

export interface ActionEvidenceRecord {
  id: string;
  timestamp: string;
  blockHeight: number;
  transactionId: string;
  capabilityId: string;
  subject: string;
  cappoGrantId?: string;
  executingNodeId: string;
  executingNodeName: string;
  requestPayloadHash: string;
  responseHash: string;
  parentBlockHash: string;
  blockHash: string;
  pglSignature: string;
  merkleLeafHash: string;
  nonce: string;
  /** Recomputed on read: signature/leaf/block hash verify with the current secret. */
  verifiable: boolean;
  tamperFlags?: {
    isTampered: boolean;
    reason?: string;
  };
  evidenceLabel?: EvidenceLabel;
  /** Local HMAC record in a mutable JSON file; not canonical PGL. */
  canonical?: false;
}

export interface ActionSignatureRequest {
  transactionId: string;
  capabilityId: string;
  subject: string;
  cappoGrantId?: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  executingNodeId: string;
  executingNodeName?: string;
  customNonce?: string;
}

export interface ActionSignatureVerificationReport {
  valid: boolean;
  tamperDetected: boolean;
  verificationTimestamp: string;
  transactionId: string;
  capabilityId: string;
  subject: string;
  computedRequestHash: string;
  computedResponseHash: string;
  expectedSignature: string;
  providedSignature: string;
  signatureMatch: boolean;
  /** null = no expected parent hash supplied, so not checked. */
  chainIntegrityValid: boolean | null;
  /** Merkle inclusion is not checked by this verifier: null. */
  merkleProofValid: boolean | null;
  /** Recomputed leaf hash matches the stored one (null = no leaf stored). */
  merkleLeafValid?: boolean | null;
  /** Recomputed block hash matches the stored one (null = not checkable). */
  blockHashValid?: boolean | null;
  scope?: string;
  attestationCheckpoints: {
    checkpoint: string;
    status: 'PASSED' | 'FAILED' | 'WARNING' | 'SKIPPED' | 'UNAVAILABLE';
    description: string;
    computedValue?: string;
    expectedValue?: string;
  }[];
  verdictSummary: string;
}

export interface EvidenceMerkleProof {
  leafHash: string;
  leafIndex: number;
  merkleRoot: string;
  auditPath: {
    position: 'left' | 'right';
    hash: string;
  }[];
  /** Computed by replaying the audit path to the root. */
  isValid: boolean;
}

export interface EvidenceMerkleTreeData {
  merkleRoot: string;
  totalLeaves: number;
  treeHeight: number;
  leaves: string[];
  blockHeight: number;
  generatedAt: string;
}

// =========================================================================
// Measurement Layer (Layer 7) - 5-Point Execution Confirmation & Telemetry
// =========================================================================

export interface SchemaValidationEvaluation {
  status: 'PASSED' | 'FAILED' | 'PARTIAL' | 'NOT_EVALUATED';
  scorePct: number | null;
  matchedFields: string[];
  missingRequiredFields: string[];
  typeMismatchFields: { field: string; expectedType: string; actualType: string }[];
  details: string;
}

export interface SLAEvaluation {
  status: 'PASSED' | 'DEGRADED' | 'FAILED' | 'NOT_EVALUATED';
  scorePct: number | null;
  actualWallClockLatencyMs: number;
  /** Caller-supplied latency budget; null = none supplied, not evaluated. */
  budgetedMaxLatencyMs: number | null;
  varianceMs: number | null;
  slaCompliant: boolean | null;
  details: string;
}

export type RuntimeObservationState = 'VERIFIED' | 'OBSERVED' | 'UNAVAILABLE' | 'NOT_SUPPORTED';

export interface RuntimeObservation {
  state: RuntimeObservationState;
  isolationLevel: 'HARDWARE_ENCLAVE' | 'CONTAINMENT_SANDBOX' | 'PROCESS_ISOLATION' | 'UNVERIFIED';
  verifiedByEvidence: boolean;
  evidenceSource?: string;
  measuredAt: string;
  details: string;
}

export interface ResourceContainmentEvaluation {
  status: 'PASSED' | 'WARNING' | 'EXCEEDED' | 'NOT_EVALUATED';
  scorePct: number | null;
  /** Child-process RSS at workload end (as reported by the caller or sandbox). */
  memoryUsedBytes: number;
  /** No per-workload memory quota exists: null. (V8 heap is capped separately.) */
  memoryQuotaBytes: number | null;
  memoryUsagePct: number | null;
  cpuExecutionMs: number | null;
  runtimeObservation: RuntimeObservation;
  details: string;
}

export interface RuntimeExitEvaluation {
  status: 'PASSED' | 'FAILED';
  scorePct: number | null;
  exitCode: number;
  errorCount: number;
  runtimeStatus: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'POLICY_VIOLATION';
  stdoutLineCount: number;
  details: string;
}

/** No hardware/TPM verifier exists in COMPUTLESS: always UNAVAILABLE with null metrics. */
export interface HardwareTelemetryEvaluation {
  status: 'VERIFIED' | 'OBSERVED' | 'UNAVAILABLE' | 'NOT_SUPPORTED';
  scorePct: number | null;
  monotonicCounterDelta: number | null;
  uptimeAttestationPct: number | null;
  enclaveAttestationValid: boolean;
  nonceFreshness: 'FRESH' | 'EXPIRED' | 'REPLAY_DETECTED' | null;
  hardwareProofState: 'VERIFIED' | 'OBSERVED' | 'UNAVAILABLE' | 'NOT_SUPPORTED';
  details: string;
}

export interface ActionExecutionConfirmationCertificate {
  certificateId: string;
  timestamp: string;
  actionId: string;
  transactionId: string;
  capabilityId: string;
  subject: string;
  executingNodeId: string;
  overallConfirmationStatus: 'LOCALLY_OBSERVED' | 'DEGRADED_SLA' | 'SCHEMA_MISMATCH' | 'EXECUTION_FAILED';
  /** Mean of the dimensions that were actually evaluated; null if none were. */
  confirmationScorePct: number | null;
  dimensions: {
    schemaConformance: SchemaValidationEvaluation;
    slaLatency: SLAEvaluation;
    resourceContainment: ResourceContainmentEvaluation;
    runtimeExit: RuntimeExitEvaluation;
    hardwareTelemetry: HardwareTelemetryEvaluation;
  };
  /** Local HMAC-SHA256 over the certificate fields (this process's secret). Not an attestation. */
  cryptographicAttestationSignature: string;
  issuer: string;
  summaryVerdict: string;
  evidenceLabel?: EvidenceLabel;
  canonical?: false;
}

// Canonical Execution Observation / Runtime Measurement (Declassified from false hardware proofs)
export type ExecutionObservation = ActionExecutionConfirmationCertificate;
export type RuntimeMeasurement = ActionExecutionConfirmationCertificate;

export interface ActionConfirmationRequest {
  actionId?: string;
  transactionId: string;
  capabilityId: string;
  subject: string;
  executingNodeId: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  actualWallClockLatencyMs: number;
  memoryUsedBytes: number;
  executionStatus: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'POLICY_VIOLATION' | 'BOUND_VIOLATION' | 'UNAUTHORIZED';
  stdout?: string[];
  /** Caller-asserted flags. COMPUTLESS has no verifier for them; they never promote a state to VERIFIED. */
  enclaveAttested?: boolean;
  hardwareProofProvided?: boolean;
  isolationVerifiedByEvidence?: boolean;
  externalEvidenceSource?: string;
  /** Optional caller latency budget for the SLA dimension. */
  latencyBudgetMs?: number;
}

// =========================================================================
// COMPUTLESS Canonical Runtime Interfaces & Authority Consumer Contracts
// =========================================================================

/**
 * A self-asserted execution scope token (capability/action/expiry bounds).
 * Despite the historical name it is NOT authority: its digest is an unkeyed
 * SHA-256 anyone can compute. Real authority is the CAPPO decision attached to
 * responses as governance.authorization.
 */
export interface CanonicalExecutionAuthority {
  executionId: string;
  workspaceId: string;
  mountId: string;
  capabilityId: string;
  allowedAction: string;
  expiresAt: string | number;
  authorityDigest: string;
  runtimeProfile: 'CONNECTED' | 'COMPUTELESS' | 'OFFLINE';
  nonce?: string;
  signature?: string;
  canonical?: false;
  source?: string;
}

export interface BoundedOfflineLease {
  leaseId: string;
  workspaceId: string;
  mountId: string;
  capabilityId: string;
  allowedActions: string[];
  maxExecutions: number;
  executionsRemaining: number;
  issuedAt: string;
  expiresAt: string;
  authorityDigest: string;
  startNonce: string;
  currentNonce: string;
  isRevoked: boolean;
  /** Derived on read from expiry/revocation/quota. A lease is a local quota bound, not authority. */
  status?: 'active' | 'expired' | 'revoked' | 'exhausted';
  evidenceLabel?: EvidenceLabel;
  canonical?: false;
}

export interface VkgManifest {
  packageId: string;
  name: string;
  version: string;
  contentDigest: string; // SHA-256 of immutable payload / code
  capabilities: string[];
  allowedActions: string[];
  memoryCeilingBytes: number;
  timeoutCeilingMs: number;
  schemaVersion: string;
  author?: string;
}

export interface VkgPackage {
  manifest: VkgManifest;
  dataTables: Record<string, unknown>;
  actionHandlers: Record<string, string>; // JavaScript source handlers
  /** Stored in a mutable local file; content changes are detected by the digest, not prevented. */
  isImmutable: boolean;
  installedAt: string;
  /** VERIFIED_REPO when the digest was recomputed now and matches the repo's built-in package. */
  evidenceLabel?: EvidenceLabel;
  digestValid?: boolean;
}

export interface VkgValidationResult {
  valid: boolean;
  computedDigest: string;
  expectedDigest: string;
  manifestMatch: boolean;
  error?: string;
}

export interface GovernedRuntimeRequest {
  authority: CanonicalExecutionAuthority;
  inputPayload: Record<string, unknown>;
  code?: string;
  timeoutMs?: number;
  vkgPackageId?: string;
  vkgAction?: string;
  offlineLeaseId?: string;
}

export type RuntimeAdapterType =
  | 'NodeVmFaultBoundary'
  | 'NodeVmRuntimeAdapter'
  | 'ContainerRuntimeAdapter'
  | 'VkgRuntimeAdapter'
  | 'LocalProcessRuntime'
  | 'OfflineRuntimeAdapter'
  | (string & {});

export const RuntimeAdapterType = {
  NodeVmFaultBoundary: 'NodeVmFaultBoundary' as const,
  NodeVmRuntimeAdapter: 'NodeVmRuntimeAdapter' as const,
  ContainerRuntimeAdapter: 'ContainerRuntimeAdapter' as const,
  VkgRuntimeAdapter: 'VkgRuntimeAdapter' as const,
  LocalProcessRuntime: 'LocalProcessRuntime' as const,
  OfflineRuntimeAdapter: 'OfflineRuntimeAdapter' as const,
};

export interface RuntimeExecutionResult {
  status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'BOUND_VIOLATION' | 'UNAUTHORIZED';
  stdout: string[];
  stderr: string[];
  outputData: Record<string, unknown>;
  memoryUsageBytes: number;
  durationMs: number;
  exitCode: number;
  adapterType: RuntimeAdapterType;
  containmentObserved: boolean;
  isolationLevel?: 'HARDWARE_ENCLAVE' | 'CONTAINMENT_SANDBOX' | 'PROCESS_ISOLATION' | 'UNVERIFIED';
  measuredError?: string;
  externalEvidenceSource?: string;
  /** The real boundary the code ran in (SANDBOX_BOUNDARY), when it ran. */
  sandboxBoundary?: Record<string, unknown>;
  notes?: string[];
}

export interface RuntimeAdapter {
  readonly adapterType: RuntimeAdapterType;
  readonly isolationLevel: 'HARDWARE_ENCLAVE' | 'CONTAINMENT_SANDBOX' | 'PROCESS_ISOLATION' | 'UNVERIFIED';
  execute(request: GovernedRuntimeRequest, context?: Record<string, any>): Promise<RuntimeExecutionResult>;
}

export interface LocalSubstrateObservation {
  id: string;
  timestamp: string;
  executionId: string;
  workspaceId: string;
  capabilityId: string;
  action: string;
  runtimeProfile: 'CONNECTED' | 'COMPUTELESS' | 'OFFLINE';
  requestDigest: string;
  responseDigest: string;
  durationMs: number;
  memoryBytes: number;
  exitCode: number;
  nonce: string;
  /** No reconciliation backend exists: stays false. */
  reconciled: boolean;
  reconciliationBatchId?: string;
  /** Set when the observation was included in a LOCAL batch (not submitted anywhere). */
  localBatchId?: string;
  evidenceLabel?: EvidenceLabel;
}

export interface ReconciliationPayload {
  batchId: string;
  workspaceId: string;
  submittedAt: string;
  totalObservations: number;
  localObservations: LocalSubstrateObservation[];
  localMerkleRoot: string;
  authorityDigest: string;
  status: 'PENDING' | 'RECONCILED' | 'REJECTED' | 'LOCAL_BATCH_NOT_SUBMITTED';
  evidenceLabel?: EvidenceLabel;
}

