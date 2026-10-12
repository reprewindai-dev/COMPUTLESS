import React, { useState, useEffect } from 'react';
import {
  SubstrateNode,
  CapabilityDefinition,
  CAPPOGrant,
  AgentTask,
  PluginModule,
  PGLRecord,
  HRMRRouteResult,
  FPIProvider,
  FPIResourceAllocation,
  FPIExecutionJob,
  FPIBillingSettlement,
} from './types';
import { Header } from './components/Header';
import { SubstrateTopology } from './components/SubstrateTopology';
import { InvariantSimulator } from './components/InvariantSimulator';
import { HerdrAgentEngine } from './components/HerdrAgentEngine';
import { PGLLedgerExplorer } from './components/PGLLedgerExplorer';
import { APIStudioMCP } from './components/APIStudioMCP';
import { FederationProviderInterface } from './components/FederationProviderInterface';
import { VeklomAmplificationEngine } from './components/VeklomAmplificationEngine';
import { Substrate8LayerPipelineExplorer } from './components/Substrate8LayerPipelineExplorer';
import { ArchitectureStackModal } from './components/ArchitectureStackModal';
import { VkgAndOfflineSubstrate } from './components/VkgAndOfflineSubstrate';
import { FabricStatusPanel, useFabricStatus } from './components/FabricStatus';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('fabric');
  const [isBackendConnected, setIsBackendConnected] = useState<boolean | null>(null);
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState<boolean>(false);
  const fabric = useFabricStatus(15000);

  // App State — starts empty; filled only from the API. No seed fallback.
  const [loading, setLoading] = useState<boolean>(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [nodes, setNodes] = useState<SubstrateNode[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
  const [grants, setGrants] = useState<CAPPOGrant[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [plugins, setPlugins] = useState<PluginModule[]>([]);
  const [pglRecords, setPglRecords] = useState<PGLRecord[]>([]);

  // FPI State
  const [fpiProviders, setFpiProviders] = useState<FPIProvider[]>([]);
  const [fpiAllocations, setFpiAllocations] = useState<FPIResourceAllocation[]>([]);
  const [fpiJobs, setFpiJobs] = useState<FPIExecutionJob[]>([]);
  const [fpiSettlements, setFpiSettlements] = useState<FPIBillingSettlement[]>([]);

  /** Fetch a JSON array; returns null (and records the error) on failure. */
  const fetchList = async <T,>(url: string, errors: string[]): Promise<T[] | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url} → HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      if (!Array.isArray(json)) {
        errors.push(`${url} → unexpected response shape`);
        return null;
      }
      return json as T[];
    } catch (err: any) {
      errors.push(`${url} → ${err?.message ?? 'request failed'}`);
      return null;
    }
  };

  const fetchFpiData = async (errors: string[] = []) => {
    const [prov, alloc, jobs, bill] = await Promise.all([
      fetchList<FPIProvider>('/api/fpi/providers', errors),
      fetchList<FPIResourceAllocation>('/api/fpi/resources', errors),
      fetchList<FPIExecutionJob>('/api/fpi/jobs', errors),
      fetchList<FPIBillingSettlement>('/api/fpi/billing', errors),
    ]);
    if (prov) setFpiProviders(prov);
    if (alloc) setFpiAllocations(alloc);
    if (jobs) setFpiJobs(jobs);
    if (bill) setFpiSettlements(bill);
    return errors;
  };

  const fetchInitialData = async () => {
    setLoading(true);
    const errors: string[] = [];
    try {
      const healthRes = await fetch('/api/health');
      setIsBackendConnected(healthRes.ok);
      if (!healthRes.ok) errors.push(`/api/health → HTTP ${healthRes.status}`);
    } catch (err: any) {
      setIsBackendConnected(false);
      errors.push(`/api/health → ${err?.message ?? 'request failed'}`);
    }

    const [n, c, g, t, p, l] = await Promise.all([
      fetchList<SubstrateNode>('/api/substrate/nodes', errors),
      fetchList<CapabilityDefinition>('/api/substrate/capabilities', errors),
      fetchList<CAPPOGrant>('/api/substrate/cappo', errors),
      fetchList<AgentTask>('/api/agents', errors),
      fetchList<PluginModule>('/api/plugins', errors),
      fetchList<PGLRecord>('/api/ledger', errors),
    ]);
    if (n) setNodes(n);
    if (c) setCapabilities(c);
    if (g) setGrants(g);
    if (t) setTasks(t);
    if (p) setPlugins(p);
    if (l) setPglRecords(l);

    await fetchFpiData(errors);
    setLoadErrors(errors);
    setLoading(false);
  };

  useEffect(() => {
    fetchInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handlers
  const handleToggleNodeStatus = async (nodeId: string, status: 'online' | 'degraded' | 'offline') => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, status } : n))
    );

    try {
      await fetch('/api/substrate/nodes/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, status }),
      });
    } catch (err) {
      console.error('Failed to sync node status toggle:', err);
    }
  };

  const handleUpdateNodeLatency = async (nodeId: string, latencyMs: number) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, latencyMs } : n))
    );

    try {
      await fetch('/api/substrate/nodes/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, latencyMs }),
      });
    } catch (err) {
      console.error('Failed to sync node latency:', err);
    }
  };

  const handleAddNode = async (newNodeData: Partial<SubstrateNode>) => {
    try {
      const res = await fetch('/api/substrate/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNodeData),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.node) {
          setNodes((prev) => [...prev, data.node]);
        }
      }
    } catch (err) {
      console.error('Failed to add compute node:', err);
    }
  };

  const handleExecuteRoute = async (
    capabilityId: string,
    cappoGrantId: string,
    preferredNodeId: string,
    force503NodeId?: string,
    invalidCappo?: boolean
  ): Promise<HRMRRouteResult> => {
    const res = await fetch('/api/substrate/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId,
        cappoGrantId,
        preferredNodeId,
        force503NodeId,
        invalidCappo,
      }),
    });

    const data: HRMRRouteResult = await res.json();

    try {
      const pglRes = await fetch('/api/ledger');
      if (pglRes.ok) setPglRecords(await pglRes.json());
    } catch (err) {
      console.warn('Ledger refresh failed:', err);
    }

    return data;
  };

  const handleTriggerAgentStep = async (taskId: string, userPrompt?: string) => {
    try {
      const res = await fetch('/api/agents/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, userPrompt }),
      });

      if (res.ok) {
        const data = await res.json();
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? data.task : t))
        );
      }
    } catch (err) {
      console.error('Failed agent step:', err);
    }
  };

  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === pluginId ? { ...p, enabled } : p))
    );

    try {
      await fetch('/api/plugins/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId, enabled }),
      });
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isBackendConnected={isBackendConnected}
        onOpenArchitectureModal={() => setIsArchitectureModalOpen(true)}
        pglCount={pglRecords.length}
        fabric={fabric}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-4">
        {activeTab !== 'fabric' && loading && (
          <div className="p-3 rounded-lg border border-slate-800 bg-slate-900 text-xs font-mono text-slate-400">
            Loading data from the COMPUTLESS API…
          </div>
        )}

        {activeTab !== 'fabric' && !loading && loadErrors.length > 0 && (
          <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                Some data could not be loaded from the API. Lists below are empty or partial — no sample data is substituted.
              </span>
              <button
                onClick={fetchInitialData}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 cursor-pointer"
              >
                Retry
              </button>
            </div>
            <ul className="text-[11px] font-mono text-rose-300/80 list-disc pl-5">
              {loadErrors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'fabric' && <FabricStatusPanel fabric={fabric} />}

        {activeTab === 'architecture8' && (
          <Substrate8LayerPipelineExplorer
            capabilities={capabilities}
            cappoGrants={grants}
          />
        )}

        {activeTab === 'amplification' && (
          <VeklomAmplificationEngine capabilities={capabilities} grants={grants} />
        )}

        {activeTab === 'vkgSubstrate' && <VkgAndOfflineSubstrate />}

        {activeTab === 'fpi' && (
          <FederationProviderInterface
            providers={fpiProviders}
            allocations={fpiAllocations}
            jobs={fpiJobs}
            settlements={fpiSettlements}
            capabilities={capabilities}
            onRefreshData={() => fetchFpiData()}
          />
        )}

        {activeTab === 'topology' && (
          <SubstrateTopology
            nodes={nodes}
            onToggleNodeStatus={handleToggleNodeStatus}
            onUpdateNodeLatency={handleUpdateNodeLatency}
            onAddNode={handleAddNode}
          />
        )}

        {activeTab === 'simulator' && (
          <InvariantSimulator
            nodes={nodes}
            capabilities={capabilities}
            grants={grants}
            onExecuteRoute={handleExecuteRoute}
          />
        )}

        {activeTab === 'herdr' && (
          <HerdrAgentEngine
            tasks={tasks}
            plugins={plugins}
            onTriggerAgentStep={handleTriggerAgentStep}
            onTogglePlugin={handleTogglePlugin}
            geminiConfigured={fabric.data?.configured?.gemini ?? null}
          />
        )}

        {activeTab === 'ledger' && <PGLLedgerExplorer records={pglRecords} />}

        {activeTab === 'api' && <APIStudioMCP capabilities={capabilities} />}
      </main>

      <ArchitectureStackModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
      />
    </div>
  );
}
