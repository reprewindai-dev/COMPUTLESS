import React, { useState, useEffect } from 'react';
import {
  Package,
  ShieldCheck,
  Zap,
  Play,
  RotateCw,
  FileCheck,
  Clock,
  Cpu,
  Lock,
  Key,
  Database,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  Binary,
  Layers,
  Sparkles,
  Server,
  Box,
  Terminal,
} from 'lucide-react';
import {
  VkgPackage,
  BoundedOfflineLease,
  LocalSubstrateObservation,
  ReconciliationPayload,
  RuntimeExecutionResult,
  CanonicalExecutionAuthority,
  RuntimeAdapterType,
} from '../types';
import { EvidenceBadge, RecordBadge, measured, hasNumber } from './EvidenceBadge';
import { DirectiveControl, GovernanceBlock, postExecute, problemSummary } from './Governance';

type ExecMeta = { status: number; problem: boolean; data: any } | null;

interface AdversarialTestResult {
  testId: string;
  name: string;
  category: string;
  expectedOutcome: string;
  actualOutcome: string;
  passed: boolean;
  durationMs: number;
  details: string;
}

interface AdversarialTestSuiteReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  tests: AdversarialTestResult[];
}

interface RuntimeAdapterInfo {
  type: RuntimeAdapterType;
  isolationLevel: string;
  description: string;
  hardwareAttested: boolean;
  cgroupEnforced: boolean;
}

export const VkgAndOfflineSubstrate: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'adapters' | 'vkg' | 'offline' | 'adversarial'>('adapters');

  // Runtime Adapters State
  // All four adapters run code in the same Node child-process sandbox (src/server/sandbox.ts).
  const [availableAdapters] = useState<RuntimeAdapterInfo[]>([
    {
      type: RuntimeAdapterType.NodeVmRuntimeAdapter,
      isolationLevel: 'CHILD_PROCESS',
      description: 'Runs the script in a Node child process: empty env, no filesystem or child processes (Node permission model), heap cap, wall-clock kill. Network not restricted.',
      hardwareAttested: false,
      cgroupEnforced: false,
    },
    {
      type: RuntimeAdapterType.ContainerRuntimeAdapter,
      isolationLevel: 'CHILD_PROCESS',
      description: 'Container isolation is TARGET. Today this adapter uses the same child-process sandbox; no container is started.',
      hardwareAttested: false,
      cgroupEnforced: false,
    },
    {
      type: RuntimeAdapterType.VkgRuntimeAdapter,
      isolationLevel: 'CHILD_PROCESS',
      description: 'Runs a .vkg package action after re-checking the package content digest, in the same child-process sandbox.',
      hardwareAttested: false,
      cgroupEnforced: false,
    },
    {
      type: RuntimeAdapterType.OfflineRuntimeAdapter,
      isolationLevel: 'CHILD_PROCESS',
      description: 'Runs under a local offline lease (execution quota + nonce counter), in the same child-process sandbox.',
      hardwareAttested: false,
      cgroupEnforced: false,
    },
  ]);
  const [selectedAdapterType, setSelectedAdapterType] = useState<RuntimeAdapterType>(RuntimeAdapterType.NodeVmRuntimeAdapter);
  const [adapterCodeInput, setAdapterCodeInput] = useState<string>(
    '// Runs in the COMPUTLESS child-process sandbox.\n// `input` is your JSON payload; write results to `output`.\noutput.processedTimestamp = Date.now();\noutput.computedValue = ((input && input.value) || 10) * 42;'
  );
  const [adapterInputJson, setAdapterInputJson] = useState<string>('{\n  "value": 25,\n  "tenantId": "org-sovereign-01"\n}');
  const [adapterExecResult, setAdapterExecResult] = useState<RuntimeExecutionResult | null>(null);
  const [adapterMeta, setAdapterMeta] = useState<ExecMeta>(null);
  const [vkgMeta, setVkgMeta] = useState<ExecMeta>(null);
  const [offlineMeta, setOfflineMeta] = useState<ExecMeta>(null);
  const [execErrors, setExecErrors] = useState<Record<string, string | null>>({});
  const [testError, setTestError] = useState<string | null>(null);
  const [isExecutingAdapter, setIsExecutingAdapter] = useState<boolean>(false);

  // .vkg Packages State
  const [packages, setPackages] = useState<VkgPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<VkgPackage | null>(null);
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [vkgInputJson, setVkgInputJson] = useState<string>('{\n  "amount": 250,\n  "country": "EU"\n}');
  const [vkgExecResult, setVkgExecResult] = useState<RuntimeExecutionResult | null>(null);
  const [isExecutingVkg, setIsExecutingVkg] = useState<boolean>(false);
  const [vkgDigestStatus, setVkgDigestStatus] = useState<{ valid: boolean; computed: string; error?: string } | null>(null);

  // Offline Leases & Observations State
  const [leases, setLeases] = useState<BoundedOfflineLease[]>([]);
  const [selectedLease, setSelectedLease] = useState<BoundedOfflineLease | null>(null);
  const [offlineAction, setOfflineAction] = useState<string>('calculate_vat');
  const [offlineInputJson, setOfflineInputJson] = useState<string>('{\n  "amount": 120,\n  "country": "UK"\n}');
  const [offlineExecResult, setOfflineExecResult] = useState<RuntimeExecutionResult | null>(null);
  const [isExecutingOffline, setIsExecutingOffline] = useState<boolean>(false);
  const [observations, setObservations] = useState<LocalSubstrateObservation[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationPayload[]>([]);
  const [isReconciling, setIsReconciling] = useState<boolean>(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  // New Lease Modal / Input
  const [newLeaseQuota, setNewLeaseQuota] = useState<number>(30);
  const [newLeaseHours, setNewLeaseHours] = useState<number>(48);

  // Adversarial Suite State
  const [testReport, setTestReport] = useState<AdversarialTestSuiteReport | null>(null);
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Initial Data Fetch
  const fetchVkgPackages = async () => {
    try {
      const res = await fetch('/api/vkg/packages');
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
        if (data.packages?.length > 0 && !selectedPackage) {
          setSelectedPackage(data.packages[0]);
          setSelectedAction(data.packages[0].manifest?.allowedActions?.[0] || '');
        }
      }
    } catch (err) {
      console.warn('Failed to load VKG packages:', err);
    }
  };

  const fetchOfflineData = async () => {
    try {
      const [leasesRes, obsRes] = await Promise.all([
        fetch('/api/offline/leases'),
        fetch('/api/offline/observations'),
      ]);
      if (leasesRes.ok) {
        const data = await leasesRes.json();
        setLeases(data.leases || []);
        if (data.leases?.length > 0 && !selectedLease) {
          setSelectedLease(data.leases[0]);
        }
      }
      if (obsRes.ok) {
        const data = await obsRes.json();
        setObservations(data.observations || []);
        setReconciliations(data.reconciliations || []);
      }
    } catch (err) {
      console.warn('Failed to load offline data:', err);
    }
  };

  const runAdversarialTests = async () => {
    setIsRunningTests(true);
    setTestError(null);
    try {
      const res = await fetch('/api/tests/adversarial/run', { method: 'POST' });
      if (res.ok) {
        const report = await res.json();
        setTestReport(report && Array.isArray(report.tests) ? report : null);
      } else {
        setTestError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setTestError(err?.message ? String(err.message) : 'request failed');
    } finally {
      setIsRunningTests(false);
    }
  };

  useEffect(() => {
    fetchVkgPackages();
    fetchOfflineData();
    runAdversarialTests();
  }, []);

  // Handlers
  const handleValidatePackage = async (pkg: VkgPackage) => {
    try {
      const res = await fetch('/api/vkg/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pkg),
      });
      if (res.ok) {
        const data = await res.json();
        setVkgDigestStatus({
          valid: data.valid,
          computed: data.computedDigest,
          error: data.error,
        });
      }
    } catch (err) {
      console.error('Validation failed:', err);
    }
  };

  const handleExecuteVkg = async () => {
    if (!selectedPackage || !selectedAction) return;
    setIsExecutingVkg(true);
    setVkgExecResult(null);
    setVkgMeta(null);

    try {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(vkgInputJson);
      } catch (e) {
        alert('Invalid JSON input payload');
        setIsExecutingVkg(false);
        return;
      }

      // No `authority` is sent: the server builds its own local scope token. Authority is CAPPO (governed mode).
      const r = await postExecute('/api/vkg/execute', {
        packageId: selectedPackage.manifest.packageId,
        action: selectedAction,
        inputPayload: parsedInput,
      });
      setVkgMeta({ status: r.status, problem: r.problem, data: r.data });
      setVkgExecResult(r.data?.execResult ?? null);
      setExecErrors((e) => ({ ...e, vkg: r.ok || r.data?.governance ? null : problemSummary(r) }));
    } catch (err: any) {
      setExecErrors((e) => ({ ...e, vkg: err?.message ? String(err.message) : 'request failed' }));
    } finally {
      setIsExecutingVkg(false);
    }
  };

  const handleCreateLease = async () => {
    try {
      const res = await fetch('/api/offline/leases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxExecutions: newLeaseQuota,
          durationHours: newLeaseHours,
          capabilityId: 'cap-compute-v1',
          allowedActions: ['calculate_vat', 'withholding_rate', 'tax_summary', 'validate_order'],
        }),
      });
      if (res.ok) {
        await fetchOfflineData();
      }
    } catch (err) {
      console.error('Failed to create lease:', err);
    }
  };

  const handleExecuteOffline = async () => {
    if (!selectedLease) return;
    setIsExecutingOffline(true);
    setOfflineExecResult(null);
    setOfflineMeta(null);

    try {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(offlineInputJson);
      } catch (e) {
        alert('Invalid JSON input payload');
        setIsExecutingOffline(false);
        return;
      }

      const r = await postExecute('/api/offline/execute', {
        leaseId: selectedLease.leaseId,
        action: offlineAction,
        inputPayload: parsedInput,
        vkgPackageId: 'vkg-sovereign-tax-calc-v1',
      });
      setOfflineMeta({ status: r.status, problem: r.problem, data: r.data });
      setOfflineExecResult(r.data?.execResult ?? null);
      setExecErrors((e) => ({ ...e, offline: r.ok || r.data?.governance ? null : problemSummary(r) }));
      await fetchOfflineData();
    } catch (err: any) {
      setExecErrors((e) => ({ ...e, offline: err?.message ? String(err.message) : 'request failed' }));
    } finally {
      setIsExecutingOffline(false);
    }
  };

  const handleExecuteAdapter = async () => {
    setIsExecutingAdapter(true);
    setAdapterExecResult(null);
    setAdapterMeta(null);

    try {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(adapterInputJson);
      } catch (e) {
        alert('Invalid JSON input payload');
        setIsExecutingAdapter(false);
        return;
      }

      const r = await postExecute('/api/runtime/execute', {
        adapterType: selectedAdapterType,
        inputPayload: parsedInput,
        code: adapterCodeInput,
      });
      setAdapterMeta({ status: r.status, problem: r.problem, data: r.data });
      setAdapterExecResult(r.data?.execResult ?? null);
      setExecErrors((e) => ({ ...e, adapter: r.ok || r.data?.governance ? null : problemSummary(r) }));
    } catch (err: any) {
      setExecErrors((e) => ({ ...e, adapter: err?.message ? String(err.message) : 'request failed' }));
    } finally {
      setIsExecutingAdapter(false);
    }
  };

  const handleReconcileOffline = async () => {
    setIsReconciling(true);
    setReconcileMessage(null);
    try {
      const res = await fetch('/api/offline/reconcile', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setReconcileMessage(data.message);
        await fetchOfflineData();
      }
    } catch (err) {
      console.error('Reconciliation error:', err);
    } finally {
      setIsReconciling(false);
    }
  };

  const pendingObservations = observations.filter((o) => !o.reconciled).length;
  const leaseExpired = (l: BoundedOfflineLease) => {
    const t = new Date(l.expiresAt as any).getTime();
    return Number.isFinite(t) && t < Date.now();
  };
  const filteredTests = testReport?.tests?.filter((t) =>
    selectedCategory === 'ALL' ? true : t.category === selectedCategory
  ) || [];

  return (
    <div className="space-y-6">
      {/* Substrate Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>COMPUTLESS runtime substrate</span>
            </h2>
            <p className="text-xs text-slate-400">
              Runtime adapters • .vkg packages • local offline leases • adversarial test suite. All code runs in one child-process
              sandbox; execute requests go through the server's governance (see Veklom Fabric tab).
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveSubTab('adapters')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeSubTab === 'adapters'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            <span>Runtime Adapters</span>
          </button>

          <button
            onClick={() => setActiveSubTab('vkg')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeSubTab === 'vkg'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Binary className="h-3.5 w-3.5" />
            <span>.vkg Packages</span>
          </button>

          <button
            onClick={() => setActiveSubTab('offline')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeSubTab === 'offline'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Offline Leases (local)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('adversarial')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
              activeSubTab === 'adversarial'
                ? 'bg-rose-600/90 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-rose-300" />
            <span>
              Adversarial Tests ({testReport ? `${testReport.passed ?? '?'}/${testReport.totalTests ?? '?'}` : isRunningTests ? 'running…' : 'not run'})
            </span>
          </button>
        </div>
      </div>

      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
        <DirectiveControl compact />
      </div>

      {/* TAB 0: RUNTIME ADAPTERS BACKENDS */}
      {activeSubTab === 'adapters' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Adapter Selection Panel */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Server className="h-4 w-4 text-indigo-400" />
                  <span>Runtime adapters</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">{availableAdapters.length} adapters, 1 sandbox</span>
              </div>

              <div className="space-y-2">
                {availableAdapters.map((adapter) => (
                  <div
                    key={adapter.type}
                    onClick={() => {
                      setSelectedAdapterType(adapter.type);
                      setAdapterExecResult(null);
                    }}
                    className={`p-3.5 rounded-lg border transition cursor-pointer ${
                      selectedAdapterType === adapter.type
                        ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm shadow-indigo-500/10'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-sm text-slate-100">{adapter.type}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{adapter.description}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400 font-mono pt-2 border-t border-slate-800/60">
                      <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-300 rounded">
                        Isolation: <strong className="text-slate-200">{adapter.isolationLevel}</strong>
                      </span>
                      <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded">
                        cgroups: {adapter.cgroupEnforced ? 'yes' : 'no'} · network: not restricted
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Adapter Execution Simulator */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <span>Run with: {selectedAdapterType}</span>
                </h3>
                <button
                  onClick={handleExecuteAdapter}
                  disabled={isExecutingAdapter}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 shadow-md"
                >
                  <Play className={`h-3.5 w-3.5 ${isExecutingAdapter ? 'animate-spin' : ''}`} />
                  <span>{isExecutingAdapter ? 'Running...' : 'Run workload'}</span>
                </button>
              </div>

              {/* Code Editor */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-mono">Script (`input` in, `output` out):</label>
                <textarea
                  rows={5}
                  value={adapterCodeInput}
                  onChange={(e) => setAdapterCodeInput(e.target.value)}
                  className="w-full p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Input JSON */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-mono">Input Payload (JSON):</label>
                <textarea
                  rows={3}
                  value={adapterInputJson}
                  onChange={(e) => setAdapterInputJson(e.target.value)}
                  className="w-full p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <ExecStatus meta={adapterMeta} error={execErrors.adapter} />

              {/* Adapter Execution Result */}
              {adapterExecResult && (
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                      <Zap className="h-4 w-4 text-amber-400" />
                      <span>Execution Result</span>
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        adapterExecResult.status === 'SUCCESS'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {adapterExecResult.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">ADAPTER TYPE</div>
                      <div className="text-sky-400 font-semibold truncate">{adapterExecResult.adapterType}</div>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">ISOLATION (reported)</div>
                      <div className="text-slate-200 font-semibold truncate">{String(adapterExecResult.isolationLevel ?? '—')}</div>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">DURATION</div>
                      <div className="text-slate-200 font-semibold">{measured((adapterExecResult as any).durationMs, ' ms')}</div>
                    </div>
                  </div>

                  {adapterExecResult.externalEvidenceSource && (
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-300">
                      <span className="text-slate-500 text-[10px] block">SOURCE (self-reported by adapter)</span>
                      <span className="text-slate-300">{adapterExecResult.externalEvidenceSource}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 font-mono">Output Data:</span>
                    <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                      {JSON.stringify(adapterExecResult.outputData, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: DETERMINISTIC .VKG PACKAGES */}
      {activeSubTab === 'vkg' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Package Selection & Manifest Panel */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Package className="h-4 w-4 text-sky-400" />
                  <span>Package registry</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">{packages.length} Loaded</span>
              </div>

              <div className="space-y-2">
                {packages.map((pkg) => (
                  <div
                    key={pkg.manifest.packageId}
                    onClick={() => {
                      setSelectedPackage(pkg);
                      setSelectedAction(pkg.manifest.allowedActions?.[0] || '');
                      setVkgDigestStatus(null);
                      setVkgExecResult(null);
                    }}
                    className={`p-3.5 rounded-lg border transition cursor-pointer ${
                      selectedPackage?.manifest.packageId === pkg.manifest.packageId
                        ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm shadow-indigo-500/10'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                          {pkg.manifest.name}
                          <RecordBadge record={pkg} fallback="DEMO" />
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{pkg.manifest.packageId} (v{pkg.manifest.version})</div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] bg-sky-500/20 text-sky-300 font-mono rounded">
                        {pkg.manifest.capabilities?.[0] ?? '—'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span>Actions: {pkg.manifest.allowedActions?.length ?? 0}</span>
                      <span>
                        Declared ceiling:{' '}
                        {hasNumber(pkg.manifest.memoryCeilingBytes) ? `${Math.round(pkg.manifest.memoryCeilingBytes / 1024 / 1024)}MB` : '—'} /{' '}
                        {measured(pkg.manifest.timeoutCeilingMs, 'ms')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Manifest Integrity Verification */}
            {selectedPackage && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                    <FileCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Content digest check</span>
                    <EvidenceBadge label="VERIFIED_REPO" title="SHA-256 recomputed by code in this repo" />
                  </h4>
                  <button
                    onClick={() => handleValidatePackage(selectedPackage)}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition cursor-pointer flex items-center space-x-1"
                  >
                    <RotateCw className="h-3 w-3" />
                    <span>Verify Digest</span>
                  </button>
                </div>

                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2 text-xs font-mono">
                  <div className="text-slate-400">Declared Content Digest:</div>
                  <div className="text-emerald-400 break-all text-[11px]">{selectedPackage.manifest.contentDigest}</div>

                  {vkgDigestStatus && (
                    <div className={`mt-2 p-2.5 rounded border text-[11px] ${
                      vkgDigestStatus.valid
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                    }`}>
                      {vkgDigestStatus.valid ? (
                        <div className="flex items-center space-x-1.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          <span>Digest recomputed by this server matches the manifest (SHA-256 over bytecode &amp; tables).</span>
                        </div>
                      ) : (
                        <div className="flex items-start space-x-1.5">
                          <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                          <span>{vkgDigestStatus.error || 'Digest mismatch: package contents differ from the manifest.'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Immutable Data Tables Summary */}
                <div className="space-y-1.5 pt-2">
                  <span className="text-xs text-slate-400 font-semibold">Embedded data tables:</span>
                  <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-[11px] font-mono text-indigo-300 overflow-x-auto max-h-40">
                    {JSON.stringify(selectedPackage.dataTables, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Governed Execution Panel */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span>Package action runner</span>
                  </h3>
                  <p className="text-xs text-slate-400">The server re-checks the package digest; CAPPO decides in governed mode</p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Action:</span>
                  <select
                    value={selectedAction}
                    onChange={(e) => setSelectedAction(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  >
                    {(selectedPackage?.manifest.allowedActions ?? []).map((act) => (
                      <option key={act} value={act}>
                        {act}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Input JSON Editor */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-mono">Input payload (JSON):</label>
                <textarea
                  value={vkgInputJson}
                  onChange={(e) => setVkgInputJson(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-slate-400 flex items-center space-x-1.5">
                  <Lock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Governed mode: CAPPO is asked before the sandbox runs</span>
                </div>
                <button
                  onClick={handleExecuteVkg}
                  disabled={isExecutingVkg}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-2 shadow-lg shadow-indigo-600/20"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{isExecutingVkg ? 'Running...' : 'Run .vkg action'}</span>
                </button>
              </div>

              <ExecStatus meta={vkgMeta} error={execErrors.vkg} />

              {/* Execution Result Box */}
              {vkgExecResult && (
                <div className="mt-4 border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Execution output</span>
                    <span className={`px-2 py-0.5 text-[11px] font-mono rounded ${
                      vkgExecResult.status === 'SUCCESS'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}>
                      {vkgExecResult.status} (Exit {vkgExecResult.exitCode})
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">DURATION</div>
                      <div className="text-slate-200 font-semibold">{measured((vkgExecResult as any).durationMs, ' ms')}</div>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">CHILD PROCESS MEMORY</div>
                      <div className="text-slate-200 font-semibold">
                        {hasNumber((vkgExecResult as any).memoryUsageBytes) ? `${Math.round((vkgExecResult as any).memoryUsageBytes / 1024)} KB` : 'not measured'}
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">BOUNDARY</div>
                      <div className="text-slate-200 font-semibold">{vkgExecResult.containmentObserved ? 'child process' : 'none reported'}</div>
                    </div>
                  </div>

                  {vkgMeta?.data?.digestCheck && (
                    <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-300">
                      <span className="text-slate-500 text-[10px] block">DIGEST CHECK (server)</span>
                      {JSON.stringify(vkgMeta.data.digestCheck)}
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 font-mono">Output Data:</span>
                    <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                      {JSON.stringify(vkgExecResult.outputData, null, 2)}
                    </pre>
                  </div>

                  {Array.isArray(vkgExecResult.stdout) && vkgExecResult.stdout.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs text-slate-400 font-mono">Stdout Logs:</span>
                      <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-slate-300 space-y-0.5">
                        {vkgExecResult.stdout.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BOUNDED OFFLINE LEASES & RECONCILIATION */}
      {activeSubTab === 'offline' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Active Leases Column */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                    <Key className="h-4 w-4 text-emerald-400" />
                    <span>Offline leases (local records)</span>
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">{leases.length} total</span>
                </div>

                <div className="space-y-2">
                  {leases.map((lease) => (
                    <div
                      key={lease.leaseId}
                      onClick={() => setSelectedLease(lease)}
                      className={`p-3.5 rounded-lg border transition cursor-pointer ${
                        selectedLease?.leaseId === lease.leaseId
                          ? 'bg-indigo-950/40 border-indigo-500/50'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                            {lease.leaseId}
                            <RecordBadge record={lease} fallback="UNVERIFIED" />
                          </div>
                          <div className="text-xs text-slate-400 font-mono mt-0.5">{lease.workspaceId}</div>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-300 font-mono rounded">
                          {leaseExpired(lease) ? 'EXPIRED' : lease.isRevoked ? 'REVOKED' : `${lease.executionsRemaining} / ${lease.maxExecutions} left`}
                        </span>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400 font-mono">
                        <span>Nonce: <strong className="text-sky-400">{lease.currentNonce}</strong></span>
                        <span>Exp: {new Date(lease.expiresAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Provision New Offline Lease */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <span className="text-xs font-semibold text-slate-300">Create a local offline lease:</span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-slate-400 text-[11px] block">Max Quota:</label>
                      <input
                        type="number"
                        value={newLeaseQuota}
                        onChange={(e) => setNewLeaseQuota(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 text-[11px] block">Validity (Hours):</label>
                      <input
                        type="number"
                        value={newLeaseHours}
                        onChange={(e) => setNewLeaseHours(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-200"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleCreateLease}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition cursor-pointer"
                  >
                    + Create lease
                  </button>
                </div>
              </div>
            </div>

            {/* Offline Execution Runner */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-sky-400" />
                      <span>Run under lease</span>
                    </h3>
                    <p className="text-xs text-slate-400">Decrements the lease quota, advances its nonce counter and writes a local journal entry</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400">Action:</span>
                    <select
                      value={offlineAction}
                      onChange={(e) => setOfflineAction(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 font-mono"
                    >
                      <option value="calculate_vat">calculate_vat</option>
                      <option value="withholding_rate">withholding_rate</option>
                      <option value="tax_summary">tax_summary</option>
                      <option value="validate_order">validate_order</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-mono">Payload:</label>
                  <textarea
                    value={offlineInputJson}
                    onChange={(e) => setOfflineInputJson(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200"
                  />
                </div>

                <button
                  onClick={handleExecuteOffline}
                  disabled={isExecutingOffline || !selectedLease || selectedLease.executionsRemaining <= 0}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center justify-center space-x-2"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Run under selected lease</span>
                </button>

                <ExecStatus meta={offlineMeta} error={execErrors.offline} />

                {offlineExecResult && (
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-200">Execution {offlineExecResult.status}</span>
                      <span className="text-slate-400">Nonce: {selectedLease?.currentNonce}</span>
                    </div>
                    <pre className="text-slate-300 text-[11px] overflow-x-auto">
                      {JSON.stringify(offlineExecResult.outputData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Local Substrate Observations & Reconciliation Journal */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <Database className="h-4 w-4 text-indigo-400" />
                  <span>Local observations journal</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Offline executions recorded locally. "Reconcile" groups them into a LOCAL batch; nothing is submitted to PGL or settled.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <span className="text-xs text-slate-300 font-mono">
                  Pending: <strong className="text-amber-400">{pendingObservations}</strong>
                </span>
                <button
                  onClick={handleReconcileOffline}
                  disabled={isReconciling || pendingObservations === 0}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 shadow-md"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                  <span>Batch locally (not submitted)</span>
                </button>
              </div>
            </div>

            {reconcileMessage && (
              <div className="p-3 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-300 font-mono flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{reconcileMessage}</span>
                <EvidenceBadge label="UNVERIFIED" />
              </div>
            )}

            {/* Observations Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-2.5">OBSERVATION ID</th>
                    <th className="p-2.5">TIMESTAMP</th>
                    <th className="p-2.5">ACTION</th>
                    <th className="p-2.5">NONCE</th>
                    <th className="p-2.5">RESPONSE DIGEST</th>
                    <th className="p-2.5 text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {observations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-500">
                        No offline observations recorded yet.
                      </td>
                    </tr>
                  ) : (
                    observations.map((obs) => (
                      <tr key={obs.id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-semibold text-slate-200">{obs.id}</td>
                        <td className="p-2.5 text-slate-400">
                          {obs.timestamp ? new Date(obs.timestamp).toLocaleTimeString() : '—'} <RecordBadge record={obs} fallback="UNVERIFIED" />
                        </td>
                        <td className="p-2.5 text-sky-400">{obs.action}</td>
                        <td className="p-2.5 text-indigo-300">{obs.nonce}</td>
                        <td className="p-2.5 text-slate-400 text-[11px] truncate max-w-[140px]">{obs.responseDigest}</td>
                        <td className="p-2.5 text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            obs.reconciled ? 'bg-slate-700/60 text-slate-200' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {obs.reconciled ? 'BATCHED LOCALLY' : 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ADVERSARIAL MATRIX & CANONICAL SECURITY SUITE */}
      {activeSubTab === 'adversarial' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <ShieldCheck className="h-4 w-4 text-rose-400" />
                  <span>Adversarial test suite ({testReport?.totalTests ?? '?'} scenarios)</span>
                  <EvidenceBadge label="VERIFIED_REPO" title="Tests in this repository, run against this server just now" />
                </h3>
                <p className="text-xs text-slate-400">
                  Tests in this repo, run on this server: hostile inputs, forged signatures, capability escalation, digest mismatch,
                  offline bound violations. A pass means the local check rejected the case; it is not an external audit.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <div
                  className={`px-3 py-1 rounded-lg text-xs font-mono border ${
                    testReport?.allPassed ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-slate-950 border-slate-700 text-slate-300'
                  }`}
                >
                  {testReport ? (
                    <>
                      Passed: <strong>{testReport.passed ?? '?'} / {testReport.totalTests ?? '?'}</strong>
                      {hasNumber(testReport.failed) && testReport.failed > 0 && <span className="text-rose-300"> · {testReport.failed} failed</span>}
                    </>
                  ) : testError ? (
                    <span className="text-rose-300">Run failed: {testError}</span>
                  ) : (
                    'Not run yet'
                  )}
                </div>
                <button
                  onClick={runAdversarialTests}
                  disabled={isRunningTests}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 shadow-md"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
                  <span>{isRunningTests ? 'Running tests...' : 'Run test suite'}</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800">
              {['ALL', 'CRYPTOGRAPHIC_INTEGRITY', 'AUTHORITY_BOUNDS', 'INVARIANT_ROUTING', 'RUNTIME_CONTAINMENT', 'VKG_DETERMINISM', 'OFFLINE_LEASE'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono transition cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {cat.replace(/_/g, ' ')}
                </button>
              ))}
            </div>

            {/* Test Case Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {filteredTests.map((test) => (
                <div
                  key={test.testId}
                  className={`p-3.5 rounded-lg border text-xs font-mono space-y-2 ${
                    test.passed
                      ? 'bg-slate-950/80 border-slate-800 hover:border-emerald-500/40'
                      : 'bg-rose-950/40 border-rose-500/50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="px-1.5 py-0.5 bg-slate-800 text-slate-300 font-bold rounded text-[10px]">
                        {test.testId}
                      </span>
                      <span className="font-semibold text-slate-200">{test.name}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      test.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {test.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    <strong className="text-slate-500">EXPECTED:</strong> {test.expectedOutcome}
                  </div>

                  <div className="text-[11px] text-slate-300">
                    <strong className="text-slate-500">ACTUAL:</strong> {test.actualOutcome}
                  </div>

                  <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Category: {test.category}</span>
                    <span>{measured(test.durationMs, 'ms')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ExecStatus: React.FC<{ meta: ExecMeta; error?: string | null }> = ({ meta, error }) => (
  <>
    {error && (
      <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/20 text-xs font-mono text-rose-200">Request failed: {error}</div>
    )}
    {meta && meta.status >= 400 && !meta.data?.governance && (
      <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/20 text-xs font-mono text-rose-200">
        HTTP {meta.status}: {meta.data?.title ?? ''} {meta.data?.detail ?? ''}
      </div>
    )}
    {meta?.data?.governance && (
      <GovernanceBlock governance={meta.data.governance} status={meta.status} problem={meta.status >= 400 ? meta.data : null} />
    )}
    {meta && meta.status >= 400 && meta.status !== 403 && meta.status !== 503 && meta.data?.governance && meta.data?.detail && (
      <div className="text-[11px] font-mono text-rose-300">
        HTTP {meta.status}: {meta.data.title} — {meta.data.detail}
      </div>
    )}
  </>
);
