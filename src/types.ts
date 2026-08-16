export type SubstrateNodeType = 'local_k8s' | 'aws_edge' | 'azure_sovereign' | 'rf_microcontroller';

export interface SubstrateNode {
  id: string;
  name: string;
  type: SubstrateNodeType;
  region: string;
  localityBoundary: string; // e.g. 'Enclave Alpha (US-East)', 'National Data Center', 'Factory Edge RF'
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  cpuUsagePct: number;
  memoryUsagePct: number;
  activeWorkloads: number;
  isSovereign: boolean;
  mcpEnabled: boolean;
  supportedCapabilities: string[];
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
  cappoSignature?: string;
}

export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  category: 'compute' | 'data_persistence' | 'edge_rf' | 'agent_recursion' | 'mcp_bridge';
  requiredRole: string;
  schemaJson: string;
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
  executionTimeMs: number;
  pglProofHash?: string;
  x402SettlementGas?: number;
  trace: RouteTraceStep[];
  outputData?: Record<string, unknown>;
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
  pglSignature: string;
  x402GasSettled: number;
  verifiable: boolean;
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
  metrics: {
    opsPerSec: number;
    tasksDriven: number;
    successRatePct: number;
  };
}

export interface PluginModule {
  id: string;
  name: string;
  category: 'Cloud Adapter' | 'Protocol Extension' | 'Security / Audit' | 'Hardware Connector';
  version: string;
  enabled: boolean;
  description: string;
  author: string;
  downloads: number;
  activeCapabilityId: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capabilityBinding: string;
}

// Federation Provider Interface (FPI) Types
export type FPIProviderStatus = 'active' | 'degraded' | 'suspended' | 'registering' | 'offline' | 'maintenance';

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
  authKeyHash: string;
  regions: string[];
  status: FPIProviderStatus;
  slaUptimePct: number;
  maxLatencyMs: number;
  isSovereignEnclave: boolean;
  supportedCapabilities: string[];
  pricing: FPIProviderPricing;
  quota: FPIProviderQuota;
  registeredAt: string;
  lastHeartbeatAt: string;
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
  x402TotalLeaseCostVEK: number;
}

export interface FPIExecutionJob {
  id: string;
  providerId: string;
  providerName: string;
  capabilityId: string;
  cappoGrantId: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'fallback_rerouted';
  executionTimeMs: number;
  x402GasSettled: number;
  pglProofSignature: string;
  submittedAt: string;
  completedAt?: string;
  outputSummary: string;
  logs: string[];
}

export interface FPIBillingSettlement {
  id: string;
  providerId: string;
  providerName: string;
  period: string;
  jobsExecuted: number;
  totalComputeUnitsUsed: number;
  totalx402EarnedVEK: number;
  payoutStatus: 'settled' | 'pending' | 'processing';
  payoutTxHash: string;
  timestamp: string;
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
  status: 'active' | 'consumed' | 'expired';
  consumedAt?: string;
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
  quarantineApplied: boolean;
}

export interface AgentIdentity {
  id: string;
  name: string;
  publicKey: string;
  trustTier: 'T0_EPHEMERAL' | 'T1_SCOPED' | 'T2_AUTONOMOUS' | 'T3_SUBSTRATE_CORE' | 'T4_SOVEREIGN_ROOT';
  allowedCapabilities: string[];
  totalActionsGoverned: number;
  totalReceiptsIssued: number;
  evidenceChainLength: number;
  recursionDepth: number;
  lastActiveAt: string;
  registeredAt: string;
  sandboxRuntimePreference: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell';
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
  stdout: string[];
  outputData: Record<string, unknown>;
  memoryUsageBytes: number;
  executionDurationMs: number;
  receipt: AuthorizationReceipt;
  pglProofSignature: string;
  requestPayloadHash: string;
  responseHash: string;
  x402GasSettled: number;
  timestamp: string;
}

export interface VeklomAmplificationMetrics {
  formula: 'A = f(G, R, B, S, E, I, N)';
  amplificationScore: number;
  recursionFormula: 'R = f(I, P, A, E)';
  rungs: {
    rung1_governedActions: { count: number; label: 'Governed Actions (G)'; status: 'healthy' };
    rung2_authorizationReceipts: { count: number; label: 'Authorization Receipts (R)'; status: 'healthy' };
    rung3_blockedIntents: { count: number; label: 'Blocked Intents (B)'; status: 'healthy' };
    rung4_safeRoutes: { count: number; label: 'Safe Routes (S)'; status: 'healthy' };
    rung5_evidenceChainEntries: { count: number; label: 'Evidence Chain Entries (E)'; status: 'healthy' };
    rung6_agentIdentities: { count: number; label: 'Agent Identities (I)'; status: 'healthy' };
    rung7_integrations: { count: number; label: 'Integrations (N)'; status: 'healthy' };
  };
  latestReceipts: AuthorizationReceipt[];
  latestBlocked: BlockedIntentRecord[];
  activeIdentities: AgentIdentity[];
  systemEntropyPct: number;
  lastEvaluatedAt: string;
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
}

export interface Substrate8LayerArchitectureSpec {
  title: string;
  version: string;
  network: string;
  layers: SubstrateLayerSpec[];
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
  status: 'SUCCESS' | 'BLOCKED_403' | 'FALLBACK_503' | 'ERROR' | 'SKIPPED';
  durationMs: number;
  data: T;
  summary: string;
}

export interface Substrate8LayerPipelineResult {
  pipelineId: string;
  timestamp: string;
  overallStatus: 'SUCCESS' | 'BLOCKED_403' | 'FALLBACK_503' | 'EXECUTION_FAILED';
  httpStatus: 200 | 403 | 503 | 500;
  totalDurationMs: number;
  requestedCapabilityId: string;
  executingSubject: string;
  receiptId?: string;
  pglProofSignature?: string;
  settlementTxHash?: string;
  x402GasSettled?: number;
  layers: {
    layer1_capability: Substrate8LayerStepResult<{
      capability: CapabilityDefinition;
      schemaValidated: boolean;
      inputParams: Record<string, unknown>;
    }>;
    layer2_authority: Substrate8LayerStepResult<{
      cappoGrantId: string;
      cappoValid: boolean;
      receipt?: AuthorizationReceipt;
      rolePermitted: boolean;
      blockedReason?: string;
    }>;
    layer3_federation: Substrate8LayerStepResult<{
      totalEligibleProviders: number;
      eligibleProviders: { id: string; name: string; type: string; isSovereign: boolean; price: number; sla: number }[];
      selectedFederationCluster: string;
    }>;
    layer4_routing: Substrate8LayerStepResult<{
      primaryCandidate: { id: string; name: string; latencyMs: number; score: number };
      executedNode: { id: string; name: string; region: string };
      reroutedFallback: boolean;
      fallbackReason?: string;
      hrmrScore: number;
    }>;
    layer5_execution: Substrate8LayerStepResult<{
      sandboxType: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell' | 'rf_edge';
      executionStatus: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR';
      stdout: string[];
      outputData: Record<string, unknown>;
      memoryUsedBytes: number;
      cpuExecutionMs: number;
    }>;
    layer6_evidence: Substrate8LayerStepResult<{
      pglRecord: PGLRecord;
      requestPayloadHash: string;
      responseHash: string;
      pglSignature: string;
      immutableLedgerIndex: number;
    }>;
    layer7_measurement: Substrate8LayerStepResult<{
      verifiedUptimePct: number;
      actualWallClockLatencyMs: number;
      memoryDeltaBytes: number;
      throughputOps: number;
      slaCompliant: boolean;
    }>;
    layer8_settlement: Substrate8LayerStepResult<{
      currency: 'VEK';
      x402GasSettled: number;
      providerPayoutEarned: number;
      protocolFee: number;
      payoutTxHash: string;
      settlementFinality: 'IMMEDIATE_FINALITY';
    }>;
  };
}

