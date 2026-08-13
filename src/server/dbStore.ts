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
  lastSavedAt: string;
}

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'substrate_db.json');

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
    this.saveToDisk();
    return record;
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
      const crypto = require('crypto');
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
      const crypto = require('crypto');
      stl.payoutStatus = 'settled';
      stl.payoutTxHash = '0x' + crypto.randomBytes(32).toString('hex');
      stl.timestamp = new Date().toISOString();
    }
    this.saveToDisk();
    return stl;
  }
}

export const dbStore = new DatabaseStore();
