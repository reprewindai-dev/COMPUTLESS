import fs from 'fs';
import path from 'path';
import {
  INITIAL_SUBSTRATE_NODES,
  INITIAL_CAPPO_GRANTS,
  INITIAL_PLUGINS,
  INITIAL_AGENT_TASKS,
  INITIAL_PGL_RECORDS,
  INITIAL_FPI_PROVIDERS,
  INITIAL_FPI_ALLOCATIONS,
  INITIAL_FPI_JOBS,
  INITIAL_FPI_SETTLEMENTS,
} from '../data/mockData.js';
import {
  SubstrateNode,
  CAPPOGrant,
  PluginModule,
  AgentTask,
  PGLRecord,
  FPIProvider,
  FPIResourceAllocation,
  FPIExecutionJob,
  FPIBillingSettlement,
  AuthorizationReceipt,
  BlockedIntentRecord,
  AgentIdentity,
  VeklomAmplificationMetrics,
  ActionEvidenceRecord,
  ActionExecutionConfirmationCertificate,
} from '../types.js';
import {
  buildEvidenceMerkleTree,
  generateEvidenceMerkleProof,
  hashPayload,
  verifyActionEvidence,
  verifyPGLRecordSignature,
} from './cryptoUtils.js';
import { createDefaultVkgPackages } from './vkgEngine.js';
import {
  VkgPackage,
  BoundedOfflineLease,
  LocalSubstrateObservation,
  ReconciliationPayload,
} from '../types.js';

export interface DBState {
  schemaVersion: number;
  substrateNodes: SubstrateNode[];
  cappoGrants: CAPPOGrant[];
  plugins: PluginModule[];
  agentTasks: AgentTask[];
  pglRecords: PGLRecord[];
  actionEvidenceRecords: ActionEvidenceRecord[];
  confirmationCertificates: ActionExecutionConfirmationCertificate[];
  fpiProviders: FPIProvider[];
  fpiAllocations: FPIResourceAllocation[];
  fpiJobs: FPIExecutionJob[];
  fpiSettlements: FPIBillingSettlement[];
  authorizationReceipts: AuthorizationReceipt[];
  blockedIntents: BlockedIntentRecord[];
  agentIdentities: AgentIdentity[];
  vkgPackages: VkgPackage[];
  offlineLeases: BoundedOfflineLease[];
  localObservations: LocalSubstrateObservation[];
  reconciliations: ReconciliationPayload[];
  /** Counters of local actions handled by this server (not governed by CAPPO unless governance says so). */
  totalGovernedActions: number;
  totalSafeRoutes: number;
  lastSavedAt: string;
}

/**
 * Bump when seeds or record semantics change. A stored file with a different
 * version is discarded (not merged), so legacy fabricated records (TPM evidence,
 * "settled" payouts, VERIFIED certificates, ...) can never re-enter proof paths.
 */
export const DB_SCHEMA_VERSION = 2;

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'substrate_db.json');

/** Demo identities. Counters start at 0 and only count local actions on this server. */
const INITIAL_IDENTITIES: AgentIdentity[] = [
  {
    id: 'agent:veklom-root-001',
    name: 'Demo Root Operator Identity',
    publicKey: 'demo-seed (no key)',
    keyType: 'id-digest (not a key)',
    trustTier: 'T4_SOVEREIGN_ROOT',
    allowedCapabilities: ['cap-compute-v1', 'cap-persist-v1', 'cap-rf-telecom', 'cap-agent-recurse', 'cap-mcp-bridge'],
    totalActionsGoverned: 0,
    totalReceiptsIssued: 0,
    evidenceChainLength: 0,
    recursionDepth: 0,
    lastActiveAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    sandboxRuntimePreference: 'node_vm',
    evidenceLabel: 'DEMO',
  },
  {
    id: 'agent:herdr-autonomous-core',
    name: 'Demo Herdr Agent Identity',
    publicKey: 'demo-seed (no key)',
    keyType: 'id-digest (not a key)',
    trustTier: 'T3_SUBSTRATE_CORE',
    allowedCapabilities: ['cap-compute-v1', 'cap-agent-recurse', 'cap-mcp-bridge'],
    totalActionsGoverned: 0,
    totalReceiptsIssued: 0,
    evidenceChainLength: 0,
    recursionDepth: 0,
    lastActiveAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    sandboxRuntimePreference: 'node_vm',
    evidenceLabel: 'DEMO',
  },
  {
    id: 'agent:demo-sandbox-worker',
    name: 'Demo Sandbox Worker Identity',
    publicKey: 'demo-seed (no key)',
    keyType: 'id-digest (not a key)',
    trustTier: 'T2_AUTONOMOUS',
    allowedCapabilities: ['cap-compute-v1'],
    totalActionsGoverned: 0,
    totalReceiptsIssued: 0,
    evidenceChainLength: 0,
    recursionDepth: 0,
    lastActiveAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    sandboxRuntimePreference: 'node_vm',
    evidenceLabel: 'DEMO',
  },
  {
    id: 'agent:mcp-tool-bridge',
    name: 'Demo MCP Bridge Identity',
    publicKey: 'demo-seed (no key)',
    keyType: 'id-digest (not a key)',
    trustTier: 'T1_SCOPED',
    allowedCapabilities: ['cap-mcp-bridge'],
    totalActionsGoverned: 0,
    totalReceiptsIssued: 0,
    evidenceChainLength: 0,
    recursionDepth: 0,
    lastActiveAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    sandboxRuntimePreference: 'node_vm',
    evidenceLabel: 'DEMO',
  },
];

/** Demo refusal records. No real request was blocked and no quarantine exists. */
const INITIAL_BLOCKED: BlockedIntentRecord[] = [
  {
    id: 'blk-int-demo-1',
    timestamp: new Date().toISOString(),
    subject: 'demo:unscoped-caller',
    attemptedCapability: 'cap-db-persist',
    reason: 'INSUFFICIENT_SCOPE',
    httpStatus: 403,
    problemDetails: {
      type: 'urn:computless:problem:cappo-403-forbidden',
      title: 'Demo refusal record',
      status: 403,
      detail: 'Demo seed: illustrates the shape of a 403 refusal. No request was actually blocked.',
      instance: '/api/substrate/route',
    },
    threatLevel: 'HIGH',
    quarantineApplied: false,
    evidenceLabel: 'DEMO',
  },
];

function demoLease(): BoundedOfflineLease {
  const leaseId = 'lease-default-offline-001';
  const workspaceId = 'ws-offline-local-01';
  const mountId = 'mnt-vkg-tax-01';
  const capabilityId = 'cap-compute-v1';
  const allowedActions = ['calculate_vat', 'withholding_rate', 'tax_summary', 'validate_order'];
  return {
    leaseId,
    workspaceId,
    mountId,
    capabilityId,
    allowedActions,
    maxExecutions: 50,
    executionsRemaining: 50,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    authorityDigest: hashPayload({ workspaceId, mountId, capabilityId, allowedActions, leaseId }),
    startNonce: '0x_off_nonce_100',
    currentNonce: '0x_off_nonce_100',
    isRevoked: false,
    evidenceLabel: 'DEMO',
    canonical: false,
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function defaultState(): DBState {
  return {
    schemaVersion: DB_SCHEMA_VERSION,
    substrateNodes: clone(INITIAL_SUBSTRATE_NODES),
    cappoGrants: clone(INITIAL_CAPPO_GRANTS),
    plugins: clone(INITIAL_PLUGINS),
    agentTasks: clone(INITIAL_AGENT_TASKS),
    pglRecords: clone(INITIAL_PGL_RECORDS),
    actionEvidenceRecords: [],
    confirmationCertificates: [],
    fpiProviders: clone(INITIAL_FPI_PROVIDERS),
    fpiAllocations: clone(INITIAL_FPI_ALLOCATIONS),
    fpiJobs: clone(INITIAL_FPI_JOBS),
    fpiSettlements: clone(INITIAL_FPI_SETTLEMENTS),
    authorizationReceipts: [],
    blockedIntents: clone(INITIAL_BLOCKED),
    agentIdentities: clone(INITIAL_IDENTITIES),
    vkgPackages: createDefaultVkgPackages(),
    offlineLeases: [demoLease()],
    localObservations: [],
    reconciliations: [],
    totalGovernedActions: 0,
    totalSafeRoutes: 0,
    lastSavedAt: new Date().toISOString(),
  };
}

export interface PersistenceStatus {
  file: string;
  lastSaveOk: boolean | null;
  lastSaveAt: string | null;
  lastSaveError: string | null;
  loadedFrom: 'disk' | 'seeds' | 'seeds-after-legacy-reset' | 'seeds-after-read-error';
  schemaVersion: number;
}

export class DatabaseStore {
  private state: DBState;
  private persistence: PersistenceStatus = {
    file: path.relative(process.cwd(), DB_FILE),
    lastSaveOk: null,
    lastSaveAt: null,
    lastSaveError: null,
    loadedFrom: 'seeds',
    schemaVersion: DB_SCHEMA_VERSION,
  };

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): DBState {
    try {
      if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

      if (fs.existsSync(DB_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) as Partial<DBState>;
        if (parsed.schemaVersion === DB_SCHEMA_VERSION) {
          const d = defaultState();
          const merged: DBState = { ...d };
          for (const key of Object.keys(d) as (keyof DBState)[]) {
            if (parsed[key] !== undefined && parsed[key] !== null) (merged as any)[key] = parsed[key];
          }
          merged.schemaVersion = DB_SCHEMA_VERSION;
          this.persistence.loadedFrom = 'disk';
          console.log(`[DatabaseStore] Loaded local state from ${DB_FILE}`);
          return merged;
        }
        console.warn(
          `[DatabaseStore] ${DB_FILE} has schema version ${parsed.schemaVersion ?? 'none'} (expected ${DB_SCHEMA_VERSION}); ` +
            'discarding it and regenerating from seeds so legacy records cannot re-enter proof paths.'
        );
        this.persistence.loadedFrom = 'seeds-after-legacy-reset';
      }
    } catch (err) {
      console.warn(`[DatabaseStore] Failed to read ${DB_FILE}, initializing default state:`, err);
      this.persistence.loadedFrom = 'seeds-after-read-error';
    }

    const state = defaultState();
    this.saveToDisk(state);
    return state;
  }

  private saveToDisk(stateToSave?: DBState) {
    const at = new Date().toISOString();
    try {
      if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
      const dataToPersist = stateToSave || this.state;
      dataToPersist.lastSavedAt = at;
      fs.writeFileSync(DB_FILE, JSON.stringify(dataToPersist, null, 2), 'utf-8');
      this.persistence.lastSaveOk = true;
      this.persistence.lastSaveError = null;
    } catch (err: any) {
      this.persistence.lastSaveOk = false;
      this.persistence.lastSaveError = String(err?.code ?? err?.message ?? err);
      console.error('[DatabaseStore] Failed to save state to disk:', err);
    }
    this.persistence.lastSaveAt = at;
  }

  /** Real result of the most recent write to disk. */
  public getPersistenceStatus(): PersistenceStatus {
    return { ...this.persistence };
  }

  /** Persist after in-place mutations made elsewhere (e.g. lease counters). */
  public persist(): void {
    this.saveToDisk();
  }

  /** Statuses are derived from time on every read; nothing stays "active" past its expiry. */
  private refreshDerivedStatuses(): void {
    const now = Date.now();
    for (const g of this.state.cappoGrants) {
      g.status = g.isRevoked ? 'revoked' : g.expiresAt < now ? 'expired' : 'active';
    }
    for (const r of this.state.authorizationReceipts) {
      if (r.status === 'active' && r.expiresAt < now) r.status = 'expired';
    }
    for (const a of this.state.fpiAllocations) {
      if (a.status === 'active' && new Date(a.expiresAt).getTime() < now) a.status = 'expired';
    }
    for (const l of this.state.offlineLeases || []) {
      l.status = l.isRevoked
        ? 'revoked'
        : new Date(l.expiresAt).getTime() < now
          ? 'expired'
          : l.executionsRemaining <= 0
            ? 'exhausted'
            : 'active';
    }
  }

  private refreshVerifiable(): void {
    for (const e of this.state.actionEvidenceRecords) {
      e.verifiable = verifyActionEvidence(e).valid;
    }
    for (const r of this.state.pglRecords) {
      if (r.signatureScheme === 'local-hmac-action-evidence-v1') {
        const ev = this.state.actionEvidenceRecords.find((e) => e.transactionId === r.transactionId);
        r.verifiable = Boolean(ev && ev.pglSignature === r.pglSignature && ev.verifiable);
      } else if (r.signatureScheme === 'none') {
        r.verifiable = false;
      } else {
        r.verifiable = verifyPGLRecordSignature(r);
      }
    }
  }

  // Getters
  public getSubstrateNodes(): SubstrateNode[] { return this.state.substrateNodes; }
  public getCappoGrants(): CAPPOGrant[] { this.refreshDerivedStatuses(); return this.state.cappoGrants; }
  public getPlugins(): PluginModule[] { return this.state.plugins; }
  public getAgentTasks(): AgentTask[] { return this.state.agentTasks; }
  public getPGLRecords(): PGLRecord[] { this.refreshVerifiable(); return this.state.pglRecords; }
  public getActionEvidenceRecords(): ActionEvidenceRecord[] { this.refreshVerifiable(); return this.state.actionEvidenceRecords; }
  public getActionEvidenceRecord(id: string): ActionEvidenceRecord | undefined {
    return this.state.actionEvidenceRecords.find((r) => r.id === id || r.transactionId === id);
  }
  public getConfirmationCertificates(): ActionExecutionConfirmationCertificate[] { return this.state.confirmationCertificates; }
  public getConfirmationCertificate(id: string): ActionExecutionConfirmationCertificate | undefined {
    return this.state.confirmationCertificates.find((c) => c.certificateId === id || c.actionId === id || c.transactionId === id);
  }
  public getEvidenceMerkleTree() {
    return buildEvidenceMerkleTree(this.state.actionEvidenceRecords);
  }
  public getEvidenceMerkleProofForIndex(index: number) {
    return generateEvidenceMerkleProof(index, this.state.actionEvidenceRecords);
  }
  public getFPIProviders(): FPIProvider[] { return this.state.fpiProviders; }
  public getFPIAllocations(): FPIResourceAllocation[] { this.refreshDerivedStatuses(); return this.state.fpiAllocations; }
  public getFPIJobs(): FPIExecutionJob[] { return this.state.fpiJobs; }
  public getFPISettlements(): FPIBillingSettlement[] { return this.state.fpiSettlements; }
  public getAuthorizationReceipts(): AuthorizationReceipt[] { this.refreshDerivedStatuses(); return this.state.authorizationReceipts; }
  public getBlockedIntents(): BlockedIntentRecord[] { return this.state.blockedIntents; }
  public getAgentIdentities(): AgentIdentity[] { return this.state.agentIdentities; }
  public getVkgPackages(): VkgPackage[] { return this.state.vkgPackages || []; }
  public getVkgPackage(id: string): VkgPackage | undefined {
    return (this.state.vkgPackages || []).find((p) => p.manifest.packageId === id);
  }
  public getOfflineLeases(): BoundedOfflineLease[] { this.refreshDerivedStatuses(); return this.state.offlineLeases || []; }
  public getOfflineLease(id: string): BoundedOfflineLease | undefined {
    return this.getOfflineLeases().find((l) => l.leaseId === id);
  }
  public getLocalObservations(): LocalSubstrateObservation[] { return this.state.localObservations || []; }
  public getReconciliations(): ReconciliationPayload[] { return this.state.reconciliations || []; }

  public addVkgPackage(pkg: VkgPackage): VkgPackage {
    if (!this.state.vkgPackages) this.state.vkgPackages = [];
    const idx = this.state.vkgPackages.findIndex((p) => p.manifest.packageId === pkg.manifest.packageId);
    if (idx >= 0) {
      this.state.vkgPackages[idx] = pkg;
    } else {
      this.state.vkgPackages.push(pkg);
    }
    this.saveToDisk();
    return pkg;
  }

  public addOfflineLease(lease: BoundedOfflineLease): BoundedOfflineLease {
    if (!this.state.offlineLeases) this.state.offlineLeases = [];
    this.state.offlineLeases.push(lease);
    this.saveToDisk();
    return lease;
  }

  public addLocalObservation(observation: LocalSubstrateObservation): LocalSubstrateObservation {
    if (!this.state.localObservations) this.state.localObservations = [];
    this.state.localObservations.push(observation);
    this.saveToDisk();
    return observation;
  }

  public addReconciliation(payload: ReconciliationPayload): ReconciliationPayload {
    if (!this.state.reconciliations) this.state.reconciliations = [];
    this.state.reconciliations.unshift(payload);
    // Mark observations as included in a LOCAL batch. They are not reconciled
    // with anything: no reconciliation backend exists.
    if (this.state.localObservations) {
      for (const obs of this.state.localObservations) {
        if (payload.localObservations.some((o) => o.id === obs.id)) {
          obs.localBatchId = payload.batchId;
        }
      }
    }
    this.saveToDisk();
    return payload;
  }

  // Mutations
  public addActionEvidenceRecord(record: ActionEvidenceRecord): ActionEvidenceRecord {
    this.state.actionEvidenceRecords.unshift(record);
    // Keep PGL records in sync
    const pglRec: PGLRecord = {
      id: record.id.replace('ev-', ''),
      timestamp: record.timestamp,
      transactionId: record.transactionId,
      capabilityId: record.capabilityId,
      cappoGrantId: record.cappoGrantId,
      executedNodeId: record.executingNodeId,
      requestPayloadHash: record.requestPayloadHash,
      responseHash: record.responseHash,
      pglSignature: record.pglSignature,
      x402GasSettled: null,
      verifiable: record.verifiable,
      evidenceLabel: record.evidenceLabel ?? 'UNVERIFIED',
      canonical: false,
      signatureScheme: 'local-hmac-action-evidence-v1',
    };
    this.state.pglRecords.unshift(pglRec);
    this.state.totalGovernedActions += 1;
    this.saveToDisk();
    return record;
  }

  public addConfirmationCertificate(cert: ActionExecutionConfirmationCertificate): ActionExecutionConfirmationCertificate {
    this.state.confirmationCertificates.unshift(cert);
    this.saveToDisk();
    return cert;
  }

  public tamperActionEvidence(id: string, tamperPatch: { requestPayloadHash?: string; responseHash?: string; pglSignature?: string }): ActionEvidenceRecord | null {
    const record = this.state.actionEvidenceRecords.find((r) => r.id === id || r.transactionId === id);
    if (!record) return null;
    if (tamperPatch.requestPayloadHash) record.requestPayloadHash = tamperPatch.requestPayloadHash;
    if (tamperPatch.responseHash) record.responseHash = tamperPatch.responseHash;
    if (tamperPatch.pglSignature) record.pglSignature = tamperPatch.pglSignature;
    record.tamperFlags = {
      isTampered: true,
      reason: 'Manual tamper mutation injected into a local evidence record (demo).',
    };
    record.verifiable = false;
    this.saveToDisk();
    return record;
  }

  // Mutations
  public addSubstrateNode(node: SubstrateNode): SubstrateNode {
    this.state.substrateNodes.push(node);
    this.saveToDisk();
    return node;
  }

  /** Operator toggle. 'online' cannot be asserted (no probe exists): it maps to 'unverified'. */
  public toggleSubstrateNode(nodeId: string, status?: string, latencyMs?: number): SubstrateNode | null {
    const node = this.state.substrateNodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (status === 'offline' || status === 'degraded') node.status = status;
    else if (status === 'online' || status === 'unverified') node.status = 'unverified';
    if (typeof latencyMs === 'number') node.latencyMs = latencyMs;
    this.saveToDisk();
    return node;
  }

  public addCappoGrant(grant: CAPPOGrant): CAPPOGrant {
    this.state.cappoGrants.unshift(grant);
    this.saveToDisk();
    return grant;
  }

  public togglePlugin(pluginId: string, enabled: boolean): PluginModule | null {
    const plugin = this.state.plugins.find((p) => p.id === pluginId);
    if (!plugin) return null;
    plugin.enabled = enabled;
    this.saveToDisk();
    return plugin;
  }

  public addPGLRecord(record: PGLRecord): PGLRecord {
    this.state.pglRecords.unshift(record);
    this.state.totalGovernedActions += 1;
    this.saveToDisk();
    return record;
  }

  public addAuthorizationReceipt(receipt: AuthorizationReceipt): AuthorizationReceipt {
    this.state.authorizationReceipts.unshift(receipt);
    this.state.totalGovernedActions += 1;
    this.saveToDisk();
    return receipt;
  }

  public consumeAuthorizationReceipt(receiptId: string): AuthorizationReceipt | null {
    const rcpt = this.state.authorizationReceipts.find((r) => r.receiptId === receiptId);
    if (!rcpt) return null;
    rcpt.status = 'consumed';
    rcpt.consumedAt = new Date().toISOString();
    this.saveToDisk();
    return rcpt;
  }

  public addBlockedIntent(blocked: BlockedIntentRecord): BlockedIntentRecord {
    this.state.blockedIntents.unshift(blocked);
    this.state.totalGovernedActions += 1;
    this.saveToDisk();
    return blocked;
  }

  public recordSafeRoute(): void {
    this.state.totalSafeRoutes += 1;
    this.state.totalGovernedActions += 1;
    this.saveToDisk();
  }

  public addAgentIdentity(identity: AgentIdentity): AgentIdentity {
    this.state.agentIdentities.unshift(identity);
    this.saveToDisk();
    return identity;
  }

  public updateAgentIdentityEvidence(agentId: string, deltaE: number = 1): AgentIdentity | null {
    const identity = this.state.agentIdentities.find((i) => i.id === agentId);
    if (!identity) return null;
    identity.totalActionsGoverned += 1;
    identity.totalReceiptsIssued += 1;
    identity.evidenceChainLength += deltaE;
    identity.lastActiveAt = new Date().toISOString();
    this.saveToDisk();
    return identity;
  }

  public addFPIProvider(provider: FPIProvider): FPIProvider {
    this.state.fpiProviders.unshift(provider);
    this.saveToDisk();
    return provider;
  }

  /**
   * Operator toggle. 'active' cannot be asserted (no heartbeat is ever received):
   * it maps to 'unverified'. lastHeartbeatAt is never touched here.
   */
  public updateFPIProviderStatus(id: string, status?: string, latencyMs?: number): FPIProvider | null {
    const p = this.state.fpiProviders.find((prov) => prov.id === id);
    if (!p) return null;
    if (status === 'offline' || status === 'maintenance' || status === 'suspended' || status === 'degraded') p.status = status;
    else if (status === 'active' || status === 'unverified') p.status = 'unverified';
    if (typeof latencyMs === 'number') p.maxLatencyMs = latencyMs;
    this.saveToDisk();
    return p;
  }

  public addFPIAllocation(allocation: FPIResourceAllocation): FPIResourceAllocation {
    this.state.fpiAllocations.unshift(allocation);
    this.saveToDisk();
    return allocation;
  }

  public releaseFPIAllocation(allocationId: string): FPIResourceAllocation | null {
    const alloc = this.state.fpiAllocations.find((a) => a.id === allocationId);
    if (!alloc) return null;
    alloc.status = 'deallocated';
    const provider = this.state.fpiProviders.find((p) => p.id === alloc.providerId);
    if (provider) {
      provider.quota.totalAllocatedUnits = Math.max(0, provider.quota.totalAllocatedUnits - alloc.computeUnits);
    }
    this.saveToDisk();
    return alloc;
  }

  public addFPIJob(job: FPIExecutionJob): FPIExecutionJob {
    this.state.fpiJobs.unshift(job);
    this.saveToDisk();
    return job;
  }

  public addFPISettlement(settlement: FPIBillingSettlement): FPIBillingSettlement {
    this.state.fpiSettlements.unshift(settlement);
    this.saveToDisk();
    return settlement;
  }

  /**
   * Computes the amplification ladder from LOCAL counters. The score is an
   * arbitrary-weight index over those counts, not a measurement of anything.
   */
  public getAmplificationMetrics(): VeklomAmplificationMetrics {
    const G = this.state.totalGovernedActions;
    const R = this.state.authorizationReceipts.length;
    const B = this.state.blockedIntents.length;
    const S = this.state.totalSafeRoutes;
    const E = this.state.pglRecords.length;
    const I = this.state.agentIdentities.length;
    // Enabled plugin catalog flags (DEMO) plus providers COMPUTLESS has actually observed (none).
    const N = this.state.plugins.filter((p) => p.enabled).length + this.state.fpiProviders.filter((p) => p.status === 'active').length;

    const amplificationScore = +(G * 0.15 + R * 0.25 + B * 0.1 + S * 0.2 + E * 0.15 + I * 0.1 + N * 0.05).toFixed(2);
    const rung = <L extends string>(count: number, label: L) => ({ count, label, status: 'local_count' as const, evidenceLabel: 'UNVERIFIED' as const });

    return {
      formula: 'A = f(G, R, B, S, E, I, N)',
      amplificationScore,
      recursionFormula: 'R = f(I, P, A, E)',
      rungs: {
        rung1_governedActions: rung(G, 'Governed Actions (G)'),
        rung2_authorizationReceipts: rung(R, 'Authorization Receipts (R)'),
        rung3_blockedIntents: rung(B, 'Blocked Intents (B)'),
        rung4_safeRoutes: rung(S, 'Safe Routes (S)'),
        rung5_evidenceChainEntries: rung(E, 'Evidence Chain Entries (E)'),
        rung6_agentIdentities: rung(I, 'Agent Identities (I)'),
        rung7_integrations: rung(N, 'Integrations (N)'),
      },
      latestReceipts: this.getAuthorizationReceipts().slice(0, 10),
      latestBlocked: this.state.blockedIntents.slice(0, 10),
      activeIdentities: this.state.agentIdentities,
      systemEntropyPct: null,
      lastEvaluatedAt: new Date().toISOString(),
      evidenceLabel: 'UNVERIFIED',
      note: 'Counts of local records/actions on this server (including DEMO seeds). The score is an arbitrary-weight index, not a measurement; entropy is not measured.',
    };
  }
}

export const dbStore = new DatabaseStore();
