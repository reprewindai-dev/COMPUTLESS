import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
} from '../types.js';

export interface DBState {
  substrateNodes: SubstrateNode[];
  cappoGrants: CAPPOGrant[];
  plugins: PluginModule[];
  agentTasks: AgentTask[];
  pglRecords: PGLRecord[];
  fpiProviders: FPIProvider[];
  fpiAllocations: FPIResourceAllocation[];
  fpiJobs: FPIExecutionJob[];
  fpiSettlements: FPIBillingSettlement[];
  authorizationReceipts: AuthorizationReceipt[];
  blockedIntents: BlockedIntentRecord[];
  agentIdentities: AgentIdentity[];
  totalGovernedActions: number;
  totalSafeRoutes: number;
  lastSavedAt: string;
}

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'substrate_db.json');

const INITIAL_IDENTITIES: AgentIdentity[] = [
  {
    id: 'agent:veklom-root-001',
    name: 'Veklom Sovereign Root Operator',
    publicKey: '0x_vk_pub_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    trustTier: 'T4_SOVEREIGN_ROOT',
    allowedCapabilities: ['cap-compute-v1', 'cap-persist-v1', 'cap-rf-telecom', 'cap-agent-recurse', 'cap-mcp-bridge'],
    totalActionsGoverned: 142,
    totalReceiptsIssued: 89,
    evidenceChainLength: 142,
    recursionDepth: 8,
    lastActiveAt: new Date().toISOString(),
    registeredAt: '2026-01-15T00:00:00.000Z',
    sandboxRuntimePreference: 'docker_isolated',
  },
  {
    id: 'agent:herdr-autonomous-core',
    name: 'Herdr Recursive Self-Hosting Agent',
    publicKey: '0x_vk_pub_ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    trustTier: 'T3_SUBSTRATE_CORE',
    allowedCapabilities: ['cap-compute-v1', 'cap-agent-recurse', 'cap-mcp-bridge'],
    totalActionsGoverned: 98,
    totalReceiptsIssued: 64,
    evidenceChainLength: 98,
    recursionDepth: 5,
    lastActiveAt: new Date().toISOString(),
    registeredAt: '2026-02-01T00:00:00.000Z',
    sandboxRuntimePreference: 'node_vm',
  },
  {
    id: 'agent:e2b-sandbox-runner',
    name: 'E2B Bounded Execution Worker',
    publicKey: '0x_vk_pub_4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce',
    trustTier: 'T2_AUTONOMOUS',
    allowedCapabilities: ['cap-compute-v1'],
    totalActionsGoverned: 45,
    totalReceiptsIssued: 32,
    evidenceChainLength: 45,
    recursionDepth: 3,
    lastActiveAt: new Date().toISOString(),
    registeredAt: '2026-03-10T00:00:00.000Z',
    sandboxRuntimePreference: 'e2b_cloud_cell',
  },
  {
    id: 'agent:mcp-tool-bridge',
    name: 'MCP Context Protocol Bridge',
    publicKey: '0x_vk_pub_4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
    trustTier: 'T1_SCOPED',
    allowedCapabilities: ['cap-mcp-bridge'],
    totalActionsGoverned: 38,
    totalReceiptsIssued: 21,
    evidenceChainLength: 38,
    recursionDepth: 2,
    lastActiveAt: new Date().toISOString(),
    registeredAt: '2026-04-12T00:00:00.000Z',
    sandboxRuntimePreference: 'node_vm',
  },
];

const INITIAL_RECEIPTS: AuthorizationReceipt[] = [
  {
    receiptId: 'rcpt-vk-8f4b2190',
    cappoGrantId: 'cappo-grant-alpha-001',
    subject: 'agent:veklom-root-001',
    scopeDigest: '0x3a7bd20a8d7a8e8b234190fa7c7b28b6d859b1',
    nonce: '0x_nonce_91ab4c887201ef',
    policyId: 'policy-strict-invariant-001',
    targetCapability: 'cap-compute-v1',
    issuedAt: new Date(Date.now() - 3600000).toISOString(),
    expiresAt: Date.now() + 86400000,
    signature: '0x_rcpt_sig_8820f9a2b8471c9902bd3a1194ac27b8',
    status: 'active',
  },
  {
    receiptId: 'rcpt-vk-192a0c7e',
    cappoGrantId: 'cappo-grant-alpha-001',
    subject: 'agent:herdr-autonomous-core',
    scopeDigest: '0x49f01ca8817290bc6612b918ca12803b98c772',
    nonce: '0x_nonce_aa482910fd47ba',
    policyId: 'policy-strict-invariant-001',
    targetCapability: 'cap-agent-recurse',
    issuedAt: new Date(Date.now() - 7200000).toISOString(),
    expiresAt: Date.now() + 86400000,
    signature: '0x_rcpt_sig_e48b0a991f8872c019ba228c9918bc22',
    status: 'consumed',
    consumedAt: new Date(Date.now() - 7100000).toISOString(),
  },
];

const INITIAL_BLOCKED: BlockedIntentRecord[] = [
  {
    id: 'blk-int-9402',
    timestamp: new Date(Date.now() - 14400000).toISOString(),
    subject: 'agent:untrusted-crawler-guest',
    attemptedCapability: 'cap-persist-v1',
    reason: 'INSUFFICIENT_SCOPE',
    httpStatus: 403,
    problemDetails: {
      type: 'https://computless.cloud/probs/cappo-403-forbidden',
      title: 'Authority Check Failed',
      status: 403,
      detail: 'Subject lacks active CAPPO credential for persistent database writes.',
      instance: '/api/substrate/route',
    },
    threatLevel: 'HIGH',
    quarantineApplied: true,
  },
  {
    id: 'blk-int-8821',
    timestamp: new Date(Date.now() - 28800000).toISOString(),
    subject: 'agent:external-mcp-probe',
    attemptedCapability: 'cap-rf-telecom',
    reason: 'REVOKED_GRANT',
    httpStatus: 403,
    problemDetails: {
      type: 'https://computless.cloud/probs/cappo-403-forbidden',
      title: 'Revoked CAPPO Grant Terminal Denial',
      status: 403,
      detail: 'Attempted to invoke telecom mesh with revoked credential. Fail-closed Invariant 1 triggered.',
      instance: '/api/substrate/route',
    },
    threatLevel: 'CRITICAL',
    quarantineApplied: true,
  },
];

class DatabaseStore {
  private state: DBState;

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): DBState {
    try {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(fileContent) as DBState;
        console.log(`[DatabaseStore] Persistent store loaded successfully from ${DB_FILE}`);
        return {
          substrateNodes: parsed.substrateNodes || [...INITIAL_SUBSTRATE_NODES],
          cappoGrants: parsed.cappoGrants || [...INITIAL_CAPPO_GRANTS],
          plugins: parsed.plugins || [...INITIAL_PLUGINS],
          agentTasks: parsed.agentTasks || [...INITIAL_AGENT_TASKS],
          pglRecords: parsed.pglRecords || [...INITIAL_PGL_RECORDS],
          fpiProviders: parsed.fpiProviders || [...INITIAL_FPI_PROVIDERS],
          fpiAllocations: parsed.fpiAllocations || [...INITIAL_FPI_ALLOCATIONS],
          fpiJobs: parsed.fpiJobs || [...INITIAL_FPI_JOBS],
          fpiSettlements: parsed.fpiSettlements || [...INITIAL_FPI_SETTLEMENTS],
          authorizationReceipts: parsed.authorizationReceipts || [...INITIAL_RECEIPTS],
          blockedIntents: parsed.blockedIntents || [...INITIAL_BLOCKED],
          agentIdentities: parsed.agentIdentities || [...INITIAL_IDENTITIES],
          totalGovernedActions: parsed.totalGovernedActions || 323,
          totalSafeRoutes: parsed.totalSafeRoutes || 184,
          lastSavedAt: parsed.lastSavedAt || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn(`[DatabaseStore] Failed to read ${DB_FILE}, initializing default state:`, err);
    }

    const defaultState: DBState = {
      substrateNodes: [...INITIAL_SUBSTRATE_NODES],
      cappoGrants: [...INITIAL_CAPPO_GRANTS],
      plugins: [...INITIAL_PLUGINS],
      agentTasks: [...INITIAL_AGENT_TASKS],
      pglRecords: [...INITIAL_PGL_RECORDS],
      fpiProviders: [...INITIAL_FPI_PROVIDERS],
      fpiAllocations: [...INITIAL_FPI_ALLOCATIONS],
      fpiJobs: [...INITIAL_FPI_JOBS],
      fpiSettlements: [...INITIAL_FPI_SETTLEMENTS],
      authorizationReceipts: [...INITIAL_RECEIPTS],
      blockedIntents: [...INITIAL_BLOCKED],
      agentIdentities: [...INITIAL_IDENTITIES],
      totalGovernedActions: 323,
      totalSafeRoutes: 184,
      lastSavedAt: new Date().toISOString(),
    };

    this.saveToDisk(defaultState);
    return defaultState;
  }

  private saveToDisk(stateToSave?: DBState) {
    try {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }
      const dataToPersist = stateToSave || this.state;
      dataToPersist.lastSavedAt = new Date().toISOString();
      fs.writeFileSync(DB_FILE, JSON.stringify(dataToPersist, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DatabaseStore] Failed to save state to disk:', err);
    }
  }

  // Getters
  public getSubstrateNodes(): SubstrateNode[] { return this.state.substrateNodes; }
  public getCappoGrants(): CAPPOGrant[] { return this.state.cappoGrants; }
  public getPlugins(): PluginModule[] { return this.state.plugins; }
  public getAgentTasks(): AgentTask[] { return this.state.agentTasks; }
  public getPGLRecords(): PGLRecord[] { return this.state.pglRecords; }
  public getFPIProviders(): FPIProvider[] { return this.state.fpiProviders; }
  public getFPIAllocations(): FPIResourceAllocation[] { return this.state.fpiAllocations; }
  public getFPIJobs(): FPIExecutionJob[] { return this.state.fpiJobs; }
  public getFPISettlements(): FPIBillingSettlement[] { return this.state.fpiSettlements; }
  public getAuthorizationReceipts(): AuthorizationReceipt[] { return this.state.authorizationReceipts; }
  public getBlockedIntents(): BlockedIntentRecord[] { return this.state.blockedIntents; }
  public getAgentIdentities(): AgentIdentity[] { return this.state.agentIdentities; }

  // Mutations
  public toggleSubstrateNode(nodeId: string, status?: 'online' | 'degraded' | 'offline', latencyMs?: number): SubstrateNode | null {
    const node = this.state.substrateNodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (status) node.status = status;
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

  public updateFPIProviderStatus(id: string, status?: 'active' | 'degraded' | 'offline' | 'maintenance', latencyMs?: number): FPIProvider | null {
    const p = this.state.fpiProviders.find((prov) => prov.id === id);
    if (!p) return null;
    if (status) p.status = status;
    if (typeof latencyMs === 'number') p.maxLatencyMs = latencyMs;
    p.lastHeartbeatAt = new Date().toISOString();
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

  public settleFPISettlement(settlementId?: string): FPIBillingSettlement {
    let stl = this.state.fpiSettlements.find((s) => s.id === settlementId);
    if (!stl) {
      stl = {
        id: 'fpi-stl-' + crypto.randomBytes(3).toString('hex'),
        providerId: 'fpi-provider-aws-sovereign',
        providerName: 'AWS Nitro Enclave Provider',
        period: 'Realtime Epoch ' + new Date().toISOString().slice(0, 10),
        jobsExecuted: this.state.fpiJobs.length,
        totalComputeUnitsUsed: this.state.fpiJobs.length * 15,
        totalx402EarnedVEK: +(this.state.fpiJobs.reduce((acc, j) => acc + j.x402GasSettled, 0)).toFixed(4),
        payoutStatus: 'settled',
        payoutTxHash: '0x' + crypto.randomBytes(32).toString('hex'),
        timestamp: new Date().toISOString(),
      };
      this.state.fpiSettlements.unshift(stl);
    } else {
      stl.payoutStatus = 'settled';
      stl.payoutTxHash = '0x' + crypto.randomBytes(32).toString('hex');
      stl.timestamp = new Date().toISOString();
    }
    this.saveToDisk();
    return stl;
  }

  /**
   * Computes the live 7-Rung Amplification Ladder Metrics:
   * A = f(G, R, B, S, E, I, N)
   */
  public getAmplificationMetrics(): VeklomAmplificationMetrics {
    const G = this.state.totalGovernedActions;
    const R = this.state.authorizationReceipts.length;
    const B = this.state.blockedIntents.length;
    const S = this.state.totalSafeRoutes;
    const E = this.state.pglRecords.length;
    const I = this.state.agentIdentities.length;
    const N = this.state.plugins.filter((p) => p.enabled).length + this.state.fpiProviders.filter((p) => p.status === 'active').length + 2; // +2 for Docker/E2B & Node VM

    // Mathematical formula score: A = (G * 0.15) + (R * 0.25) + (B * 0.10) + (S * 0.20) + (E * 0.15) + (I * 0.10) + (N * 0.05)
    const amplificationScore = +(G * 0.15 + R * 0.25 + B * 0.1 + S * 0.2 + E * 0.15 + I * 0.1 + N * 0.05).toFixed(2);
    const systemEntropyPct = +(Math.max(0.2, 5.0 - (amplificationScore / 100))).toFixed(2);

    return {
      formula: 'A = f(G, R, B, S, E, I, N)',
      amplificationScore,
      recursionFormula: 'R = f(I, P, A, E)',
      rungs: {
        rung1_governedActions: { count: G, label: 'Governed Actions (G)', status: 'healthy' },
        rung2_authorizationReceipts: { count: R, label: 'Authorization Receipts (R)', status: 'healthy' },
        rung3_blockedIntents: { count: B, label: 'Blocked Intents (B)', status: 'healthy' },
        rung4_safeRoutes: { count: S, label: 'Safe Routes (S)', status: 'healthy' },
        rung5_evidenceChainEntries: { count: E, label: 'Evidence Chain Entries (E)', status: 'healthy' },
        rung6_agentIdentities: { count: I, label: 'Agent Identities (I)', status: 'healthy' },
        rung7_integrations: { count: N, label: 'Integrations (N)', status: 'healthy' },
      },
      latestReceipts: this.state.authorizationReceipts.slice(0, 10),
      latestBlocked: this.state.blockedIntents.slice(0, 10),
      activeIdentities: this.state.agentIdentities,
      systemEntropyPct,
      lastEvaluatedAt: new Date().toISOString(),
    };
  }
}

export const dbStore = new DatabaseStore();
