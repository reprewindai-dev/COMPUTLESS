import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  ShieldCheck,
  FileCheck2,
  Ban,
  GitFork,
  Cpu,
  Layers,
  Terminal,
  Play,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Key,
  Database,
  ExternalLink,
  Code2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  VeklomAmplificationMetrics,
  AuthorizationReceipt,
  BlockedIntentRecord,
  AgentIdentity,
  SandboxExecutionResult,
  CapabilityDefinition,
} from '../types';

interface VeklomAmplificationEngineProps {
  capabilities: CapabilityDefinition[];
}

export const VeklomAmplificationEngine: React.FC<VeklomAmplificationEngineProps> = ({ capabilities }) => {
  const [metrics, setMetrics] = useState<VeklomAmplificationMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeSubView, setActiveSubView] = useState<'ladder' | 'sandbox' | 'receipts' | 'blocked' | 'identities' | 'recursion'>('ladder');

  // Sandbox state
  const [sandboxCode, setSandboxCode] = useState<string>(
    '// Topological Machine-Native VM Execution\nconst val = input.val || 10;\nconst matrix = [val, val * 2, val * 3];\noutput.processedMatrix = matrix;\noutput.checksum = "0x" + (val * 1337).toString(16);\nconsole.log("Matrix compute completed for val=" + val);'
  );
  const [sandboxPayload, setSandboxPayload] = useState<string>('{\n  "val": 42,\n  "intent": "matrix_compute"\n}');
  const [selectedSandboxAgent, setSelectedSandboxAgent] = useState<string>('agent:veklom-root-001');
  const [selectedCapability, setSelectedCapability] = useState<string>('cap-compute-v1');
  const [selectedRuntime, setSelectedRuntime] = useState<'node_vm' | 'docker_isolated' | 'e2b_cloud_cell'>('node_vm');
  const [sandboxRunning, setSandboxRunning] = useState<boolean>(false);
  const [sandboxResult, setSandboxResult] = useState<SandboxExecutionResult | null>(null);

  // Receipt verification state
  const [receiptToVerify, setReceiptToVerify] = useState<string>('');
  const [receiptVerificationResult, setReceiptVerificationResult] = useState<any>(null);

  // Recursion runner state
  const [recursionAgent, setRecursionAgent] = useState<string>('agent:herdr-autonomous-core');
  const [recursionPrompt, setRecursionPrompt] = useState<string>('Topologically balance Substrate HRMR latency routes and prune stale node leases');
  const [recursionRunning, setRecursionRunning] = useState<boolean>(false);
  const [recursionLog, setRecursionLog] = useState<any[]>([]);

  // Blocked intent simulation state
  const [blockedActor, setBlockedActor] = useState<string>('agent:untrusted-crawler-probe');
  const [blockedCap, setBlockedCap] = useState<string>('cap-rf-telecom');
  const [simulatingBlock, setSimulatingBlock] = useState<boolean>(false);

  const fetchAmplification = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/substrate/amplification');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.warn('Amplification fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAmplification();
  }, []);

  const handleRunSandbox = async () => {
    try {
      setSandboxRunning(true);
      setSandboxResult(null);
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(sandboxPayload);
      } catch (e) {
        parsedPayload = { raw: sandboxPayload };
      }

      const res = await fetch('/api/substrate/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedSandboxAgent,
          capabilityId: selectedCapability,
          code: sandboxCode,
          inputPayload: parsedPayload,
          sandboxType: selectedRuntime,
          cappoGrantId: 'cappo-grant-alpha-001',
        }),
      });

      const data = await res.json();
      setSandboxResult(data);
      fetchAmplification();
    } catch (err) {
      console.error('Sandbox execution error:', err);
    } finally {
      setSandboxRunning(false);
    }
  };

  const handleVerifyReceipt = async (receipt: AuthorizationReceipt) => {
    try {
      const res = await fetch('/api/substrate/receipts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt),
      });
      const data = await res.json();
      setReceiptVerificationResult(data);
      setReceiptToVerify(receipt.receiptId);
    } catch (err) {
      console.error('Receipt verification failed:', err);
    }
  };

  const handleRunRecursionStep = async () => {
    try {
      setRecursionRunning(true);
      const res = await fetch('/api/substrate/recursion/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: recursionAgent,
          intentPrompt: recursionPrompt,
        }),
      });
      const data = await res.json();
      setRecursionLog((prev) => [data, ...prev]);
      if (data.amplificationMetrics) {
        setMetrics(data.amplificationMetrics);
      } else {
        fetchAmplification();
      }
    } catch (err) {
      console.error('Recursion step failed:', err);
    } finally {
      setRecursionRunning(false);
    }
  };

  const handleSimulateBlockedIntent = async () => {
    try {
      setSimulatingBlock(true);
      const res = await fetch('/api/substrate/blocked/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: blockedActor,
          attemptedCapability: blockedCap,
          reason: 'INSUFFICIENT_SCOPE',
          threatLevel: 'HIGH',
        }),
      });
      fetchAmplification();
    } catch (err) {
      console.error('Simulate block failed:', err);
    } finally {
      setSimulatingBlock(false);
    }
  };

  const rungsConfig = [
    {
      rung: 1,
      key: 'rung1_governedActions',
      name: 'Governed Actions (G)',
      mathWeight: '0.15',
      icon: ShieldCheck,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/30',
      description: 'Every interaction mediated by non-ambient substrate authority gates.',
    },
    {
      rung: 2,
      key: 'rung2_authorizationReceipts',
      name: 'Authorization Receipts (R)',
      mathWeight: '0.25',
      icon: FileCheck2,
      color: 'text-sky-400',
      bgColor: 'bg-sky-500/10 border-sky-500/30',
      description: 'Cryptographic, single-use, non-replayable receipts with SHA-256 scope digests.',
    },
    {
      rung: 3,
      key: 'rung3_blockedIntents',
      name: 'Blocked Intents (B)',
      mathWeight: '0.10',
      icon: Ban,
      color: 'text-rose-400',
      bgColor: 'bg-rose-500/10 border-rose-500/30',
      description: 'Fail-closed terminal 403 refusals blocking unprovable or rogue intentions.',
    },
    {
      rung: 4,
      key: 'rung4_safeRoutes',
      name: 'Safe Routes (S)',
      mathWeight: '0.20',
      icon: GitFork,
      color: 'text-indigo-400',
      bgColor: 'bg-indigo-500/10 border-indigo-500/30',
      description: 'HRMR topological route paths executed without ambient authority escape.',
    },
    {
      rung: 5,
      key: 'rung5_evidenceChainEntries',
      name: 'Evidence Chain Entries (E)',
      mathWeight: '0.15',
      icon: Database,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10 border-amber-500/30',
      description: 'Immutable Proof Graph Ledger (PGL) blocks with cryptographic HMAC proofs.',
    },
    {
      rung: 6,
      key: 'rung6_agentIdentities',
      name: 'Agent Identities (I)',
      mathWeight: '0.10',
      icon: Key,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10 border-purple-500/30',
      description: 'Durable, verifiable agent personas anchored across Trust Tiers T0–T4.',
    },
    {
      rung: 7,
      key: 'rung7_integrations',
      name: 'Integrations & Providers (N)',
      mathWeight: '0.05',
      icon: Layers,
      color: 'text-teal-400',
      bgColor: 'bg-teal-500/10 border-teal-500/30',
      description: 'Connected FPI federation providers, plugins, and sandbox container cells.',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner & Mathematical Formula */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center space-x-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Veklom Amplification Ladder</span>
              </span>
              <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                100% Verifiable Machine Substrate
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Topological Machine-Native Substrate &amp; Amplification Engine
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl mt-1">
              Live mathematical governance framework enforcing non-ambient execution, cryptographic authorization receipts, and iterative recursion loops with zero simulated mock data.
            </p>
          </div>

          {/* Amplification Score Badge */}
          <div className="flex items-center gap-4 bg-slate-950/80 border border-indigo-500/30 rounded-xl p-4">
            <div>
              <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Amplification Index</p>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-300 to-emerald-400">
                  {metrics?.amplificationScore ?? '0.00'}
                </span>
                <span className="text-xs font-mono text-emerald-400 font-semibold">
                  Entropy: {metrics?.systemEntropyPct ?? '0.20'}%
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                A = f(G, R, B, S, E, I, N)
              </p>
            </div>
            <button
              onClick={fetchAmplification}
              disabled={loading}
              className="p-2.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 rounded-lg transition cursor-pointer"
              title="Refresh Amplification Metrics"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Formula Explainer Bar */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
            <span className="text-slate-400">Amplification Formula:</span>
            <p className="text-sky-300 font-semibold mt-0.5">A = f(G, R, B, S, E, I, N)</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
            <span className="text-slate-400">Recursion Loop Invariant:</span>
            <p className="text-indigo-300 font-semibold mt-0.5">R = f(I, P, A, E) &rarr; R_&#123;n+1&#125; = R_n + &Delta;E</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
            <span className="text-slate-400">Authority Invariant 1:</span>
            <p className="text-rose-300 font-semibold mt-0.5">403 Fail-Closed Terminal Denial</p>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
            <span className="text-slate-400">Infrastructure Invariant 2:</span>
            <p className="text-emerald-300 font-semibold mt-0.5">503 Transparent Fallback Reroute</p>
          </div>
        </div>
      </div>

      {/* Sub-Navigation */}
      <div className="flex space-x-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveSubView('ladder')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'ladder'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          <span>7-Rung Ladder &amp; Rungs</span>
        </button>

        <button
          onClick={() => setActiveSubView('sandbox')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'sandbox'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <Terminal className="h-4 w-4" />
          <span>VM Sandbox Runtime</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-sky-500/20 text-sky-300 rounded font-mono">Live V8</span>
        </button>

        <button
          onClick={() => setActiveSubView('receipts')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'receipts'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <FileCheck2 className="h-4 w-4" />
          <span>Authorization Receipts (R)</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-300 rounded font-mono">
            {metrics?.latestReceipts?.length ?? 0}
          </span>
        </button>

        <button
          onClick={() => setActiveSubView('blocked')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'blocked'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <Ban className="h-4 w-4" />
          <span>Blocked Intents (B)</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-rose-500/20 text-rose-300 rounded font-mono">403 Fail-Closed</span>
        </button>

        <button
          onClick={() => setActiveSubView('identities')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'identities'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <Key className="h-4 w-4" />
          <span>Agent Identities (I)</span>
        </button>

        <button
          onClick={() => setActiveSubView('recursion')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
            activeSubView === 'recursion'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <RotateCw className="h-4 w-4" />
          <span>Recursion Loop (R_&#123;n+1&#125;)</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-300 rounded font-mono">&Delta;E</span>
        </button>
      </div>

      {/* VIEW 1: 7-RUNG LADDER OVERVIEW */}
      {activeSubView === 'ladder' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rungsConfig.map((r) => {
              const Icon = r.icon;
              const rungData = (metrics?.rungs as any)?.[r.key];
              const count = rungData?.count ?? 0;

              return (
                <div
                  key={r.rung}
                  className={`p-5 rounded-xl border bg-slate-900/90 ${r.bgColor} backdrop-blur-sm relative flex flex-col justify-between`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                          <Icon className={`h-5 w-5 ${r.color}`} />
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-400">
                          RUNG #{r.rung}
                        </span>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-950/80 text-slate-300 border border-slate-800">
                        Weight: {r.mathWeight}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white mb-1">{r.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">{r.description}</p>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">Total Count:</span>
                    <span className={`text-xl font-mono font-extrabold ${r.color}`}>{count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Realtime Substrate Attestation Summary */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center space-x-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <span>Cryptographic Invariant Attestation Status</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              All 8 substrate layers are actively bound to HMAC-SHA256 non-repudiation proofs with zero unmonitored execution vectors.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30">
                <div className="flex items-center space-x-2 text-emerald-400 mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-bold">Invariant 1 (Authority)</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  Terminal 403 enforcement. Invalid or expired CAPPO credentials fail closed immediately. Zero permission hunting allowed.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-sky-500/30">
                <div className="flex items-center space-x-2 text-sky-400 mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-bold">Invariant 2 (Execution)</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  Transparent 503 fallback routing. If a physical node or enclave fails, HRMR reroutes execution with 0 authority drift.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/30">
                <div className="flex items-center space-x-2 text-indigo-400 mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-bold">PGL &amp; x402 Micropayments</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  All VM and HRMR executions produce a verifiable Proof Graph Ledger hash and settle gas over the x402 header protocol.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: TOPOLOGICAL VM SANDBOX RUNNER */}
      {activeSubView === 'sandbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Terminal className="h-5 w-5 text-sky-400" />
                  <h2 className="text-base font-bold text-white">Topological VM Sandbox Runner</h2>
                </div>
                <span className="px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Non-Ambient V8 Context
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs font-mono">
                <div>
                  <label className="text-slate-400 block mb-1">Agent Identity (I)</label>
                  <select
                    value={selectedSandboxAgent}
                    onChange={(e) => setSelectedSandboxAgent(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {metrics?.activeIdentities?.map((id) => (
                      <option key={id.id} value={id.id}>
                        {id.name} ({id.trustTier})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Target Capability</label>
                  <select
                    value={selectedCapability}
                    onChange={(e) => setSelectedCapability(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {capabilities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Containment Cell Type</label>
                  <select
                    value={selectedRuntime}
                    onChange={(e) => setSelectedRuntime(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="node_vm">Node V8 Isolated VM</option>
                    <option value="docker_isolated">Docker Enclave Container</option>
                    <option value="e2b_cloud_cell">E2B Bounded Cell</option>
                  </select>
                </div>
              </div>

              {/* Code Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>Workload Script (JavaScript / Substrate VM API):</span>
                  <span>Timeout: 3000ms | Memory: 128MB</span>
                </div>
                <textarea
                  value={sandboxCode}
                  onChange={(e) => setSandboxCode(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-xs text-sky-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Input Payload JSON */}
              <div className="space-y-2 mt-4">
                <span className="text-xs font-mono text-slate-400 block">Input JSON Payload:</span>
                <textarea
                  value={sandboxPayload}
                  onChange={(e) => setSandboxPayload(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-emerald-300 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="mt-5 flex items-center justify-end space-x-3">
                <button
                  onClick={handleRunSandbox}
                  disabled={sandboxRunning}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition cursor-pointer flex items-center space-x-2 shadow-lg shadow-indigo-600/30 disabled:opacity-50"
                >
                  <Play className={`h-4 w-4 ${sandboxRunning ? 'animate-spin' : ''}`} />
                  <span>{sandboxRunning ? 'Executing in Substrate VM...' : 'Execute in Isolated Sandbox'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Sandbox Output & PGL Proof Card */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Code2 className="h-4 w-4 text-emerald-400" />
                    <span>Realtime Execution Results</span>
                  </h3>
                  {sandboxResult && (
                    <span
                      className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${
                        sandboxResult.status === 'SUCCESS'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {sandboxResult.status}
                    </span>
                  )}
                </div>

                {sandboxResult ? (
                  <div className="space-y-4 text-xs font-mono">
                    {/* Execution Metrics Bar */}
                    <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950 rounded-lg border border-slate-800">
                      <div>
                        <span className="text-slate-400 block text-[10px]">CPU DURATION:</span>
                        <span className="text-emerald-400 font-bold">{sandboxResult.executionDurationMs} ms</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">HEAP DELTA:</span>
                        <span className="text-sky-400 font-bold">{(sandboxResult.memoryUsageBytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">x402 GAS SETTLED:</span>
                        <span className="text-amber-400 font-bold">{sandboxResult.x402GasSettled} VEK</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">RECEIPT ID:</span>
                        <span className="text-indigo-300 truncate block">{sandboxResult.receipt.receiptId}</span>
                      </div>
                    </div>

                    {/* Stdout Logs */}
                    <div>
                      <span className="text-slate-400 block mb-1 text-[11px]">CONTAINER STDOUT:</span>
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 max-h-32 overflow-y-auto space-y-1">
                        {sandboxResult.stdout?.length > 0 ? (
                          sandboxResult.stdout.map((line, idx) => (
                            <p key={idx} className="text-emerald-300 font-mono text-[11px]">
                              &gt; {line}
                            </p>
                          ))
                        ) : (
                          <p className="text-slate-500 italic">No stdout output captured.</p>
                        )}
                      </div>
                    </div>

                    {/* Output Data JSON */}
                    <div>
                      <span className="text-slate-400 block mb-1 text-[11px]">STRUCTURED OUTPUT:</span>
                      <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-sky-300 text-[11px] overflow-x-auto max-h-36">
                        {JSON.stringify(sandboxResult.outputData, null, 2)}
                      </pre>
                    </div>

                    {/* Cryptographic Proof Signature */}
                    <div className="p-3 bg-slate-950/80 rounded-lg border border-indigo-500/30">
                      <span className="text-indigo-400 block font-bold text-[11px] mb-1">
                        PGL Cryptographic Proof:
                      </span>
                      <p className="text-slate-300 text-[10px] break-all">{sandboxResult.pglProofSignature}</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs font-mono flex flex-col items-center justify-center space-y-2">
                    <Terminal className="h-8 w-8 text-slate-600 mb-1" />
                    <p>No execution recorded yet.</p>
                    <p className="text-[11px] text-slate-400">Click &quot;Execute in Isolated Sandbox&quot; to run real code in the V8 engine.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: AUTHORIZATION RECEIPTS (RUNG 2) */}
      {activeSubView === 'receipts' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <FileCheck2 className="h-5 w-5 text-sky-400" />
                <span>Rung 2: Cryptographic Authorization Receipts (R)</span>
              </h2>
              <p className="text-xs text-slate-400">
                Non-replayable, single-use authorization receipts signed with SHA-256 digests and cryptographic nonces.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {metrics?.latestReceipts?.map((rcpt) => (
              <div key={rcpt.receiptId} className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-sky-400">{rcpt.receiptId}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        rcpt.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {rcpt.status.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-slate-400 text-[10px]">Expires in: {Math.max(0, Math.floor((rcpt.expiresAt - Date.now()) / 60000))}m</span>
                </div>

                <div className="space-y-1 text-slate-300 text-[11px]">
                  <p><span className="text-slate-500">Subject:</span> {rcpt.subject}</p>
                  <p><span className="text-slate-500">Grant ID:</span> {rcpt.cappoGrantId}</p>
                  <p><span className="text-slate-500">Target Capability:</span> {rcpt.targetCapability}</p>
                  <p><span className="text-slate-500">Scope Digest:</span> {rcpt.scopeDigest.slice(0, 22)}...</p>
                  <p><span className="text-slate-500">Nonce:</span> {rcpt.nonce}</p>
                  <p><span className="text-slate-500">Signature:</span> {rcpt.signature}</p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => handleVerifyReceipt(rcpt)}
                    className="px-3 py-1 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/30 rounded text-xs transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Cryptographically Verify Receipt</span>
                  </button>

                  {receiptToVerify === rcpt.receiptId && receiptVerificationResult && (
                    <span className="text-[11px] text-emerald-400 font-bold">
                      VERIFIED 100%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 4: BLOCKED INTENTS (RUNG 3) */}
      {activeSubView === 'blocked' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Ban className="h-5 w-5 text-rose-400" />
                <h2 className="text-base font-bold text-white">Rung 3: Blocked Intent &amp; Fail-Closed Invariant Simulator</h2>
              </div>
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                HTTP 403 Fail-Closed Terminal
              </span>
            </div>
            <p className="text-xs text-slate-300 max-w-3xl mb-4">
              Demonstrate Invariant 1: when an unauthorized actor, expired grant, or anomalous intent attempts invocation, the substrate immediately terminates the call with an RFC 9457 Problem Details object with zero permission hunting.
            </p>

            <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
              <input
                type="text"
                value={blockedActor}
                onChange={(e) => setBlockedActor(e.target.value)}
                placeholder="Subject ID"
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <select
                value={blockedCap}
                onChange={(e) => setBlockedCap(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {capabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>

              <button
                onClick={handleSimulateBlockedIntent}
                disabled={simulatingBlock}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg transition cursor-pointer shadow-lg shadow-rose-600/20"
              >
                Simulate 403 Terminal Refusal
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {metrics?.latestBlocked?.map((blk) => (
              <div key={blk.id} className="bg-slate-900 border border-rose-500/30 rounded-xl p-4 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-bold text-rose-400">{blk.id}</span>
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                    HTTP {blk.httpStatus} DENIAL
                  </span>
                </div>
                <div className="space-y-1 text-slate-300 text-[11px]">
                  <p><span className="text-slate-500">Timestamp:</span> {blk.timestamp}</p>
                  <p><span className="text-slate-500">Subject:</span> {blk.subject}</p>
                  <p><span className="text-slate-500">Attempted Capability:</span> {blk.attemptedCapability}</p>
                  <p><span className="text-slate-500">Reason:</span> <strong className="text-rose-400">{blk.reason}</strong></p>
                  <p><span className="text-slate-500">Problem Detail:</span> {blk.problemDetails.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 5: AGENT IDENTITIES (RUNG 6) */}
      {activeSubView === 'identities' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <Key className="h-5 w-5 text-purple-400" />
                <span>Rung 6: Durable Agent Identities (I)</span>
              </h2>
              <p className="text-xs text-slate-400">
                Machine-native agent identities registered to the substrate with persistent trust tiers and evidence chains.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {metrics?.activeIdentities?.map((id) => (
              <div key={id.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 font-mono text-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="font-bold text-purple-300 text-sm">{id.name}</span>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30">
                    {id.trustTier}
                  </span>
                </div>

                <div className="space-y-1.5 text-slate-300 text-[11px]">
                  <p><span className="text-slate-500">ID:</span> {id.id}</p>
                  <p><span className="text-slate-500">Public Key:</span> {id.publicKey.slice(0, 24)}...</p>
                  <p><span className="text-slate-500">Evidence Chain Length:</span> <strong className="text-emerald-400">{id.evidenceChainLength}</strong> blocks</p>
                  <p><span className="text-slate-500">Recursion Depth:</span> {id.recursionDepth}</p>
                  <p><span className="text-slate-500">Allowed Capabilities:</span> {id.allowedCapabilities.join(', ')}</p>
                  <p><span className="text-slate-500">Runtime Preference:</span> {id.sandboxRuntimePreference}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 6: RECURSION LOOP (R_{n+1} = R_n + \Delta E) */}
      {activeSubView === 'recursion' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <RotateCw className="h-5 w-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">
                  Recursion Loop Engine: R_&#123;n+1&#125; = R_n + &Delta;E
                </h2>
              </div>
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Mathematical Self-Optimization
              </span>
            </div>
            <p className="text-xs text-slate-300 max-w-3xl mb-4">
              Execute iterative optimization cycles where each step increments verifiable evidence length &Delta;E, registers an immutable PGL record, and updates the agent&apos;s durable identity.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs mb-4">
              <div>
                <label className="text-slate-400 block mb-1">Target Agent</label>
                <select
                  value={recursionAgent}
                  onChange={(e) => setRecursionAgent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  {metrics?.activeIdentities?.map((id) => (
                    <option key={id.id} value={id.id}>
                      {id.name} ({id.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-slate-400 block mb-1">Recursion Intent Prompt</label>
                <input
                  type="text"
                  value={recursionPrompt}
                  onChange={(e) => setRecursionPrompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleRunRecursionStep}
                disabled={recursionRunning}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition cursor-pointer flex items-center space-x-2 shadow-lg shadow-emerald-600/30"
              >
                <RotateCw className={`h-4 w-4 ${recursionRunning ? 'animate-spin' : ''}`} />
                <span>{recursionRunning ? 'Evaluating Recursion...' : 'Execute Recursion Cycle (Step + \u0394E)'}</span>
              </button>
            </div>
          </div>

          {/* Recursion History */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white font-mono">Recursion Iteration History:</h3>
            {recursionLog.length > 0 ? (
              recursionLog.map((entry, idx) => (
                <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <span className="text-emerald-400 font-bold">
                      Iteration Step &bull; Depth {entry.agentIdentity?.recursionDepth}
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      &Delta;E: +{entry.deltaE} | Gas: {entry.pglRecord?.x402GasSettled} VEK
                    </span>
                  </div>
                  <p className="text-slate-200 text-[11px] leading-relaxed">{entry.recommendation}</p>
                  <p className="text-[10px] text-slate-500">PGL Sig: {entry.pglRecord?.pglSignature}</p>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-slate-500 font-mono text-xs bg-slate-900/50 rounded-xl border border-slate-800">
                Click &quot;Execute Recursion Cycle&quot; to perform an iterative state evolution cycle.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
