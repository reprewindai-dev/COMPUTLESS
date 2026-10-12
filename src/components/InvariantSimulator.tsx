import React, { useState } from 'react';
import { SubstrateNode, CapabilityDefinition, CAPPOGrant, HRMRRouteResult } from '../types';
import { ShieldAlert, RefreshCw, CheckCircle2, AlertTriangle, Terminal, Play, Cpu } from 'lucide-react';
import { DemoDataNote, EvidenceBadge, RecordBadge, measured, hasNumber } from './EvidenceBadge';

interface InvariantSimulatorProps {
  nodes: SubstrateNode[];
  capabilities: CapabilityDefinition[];
  grants: CAPPOGrant[];
  onExecuteRoute: (
    capabilityId: string,
    cappoGrantId: string,
    preferredNodeId: string,
    force503NodeId?: string,
    invalidCappo?: boolean
  ) => Promise<HRMRRouteResult>;
}

export const InvariantSimulator: React.FC<InvariantSimulatorProps> = ({
  nodes,
  capabilities,
  grants,
  onExecuteRoute,
}) => {
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string>(capabilities[0]?.id || '');
  const [selectedGrantId, setSelectedGrantId] = useState<string>(grants[0]?.grantId || '');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0]?.id || '');

  // Simulation Toggles
  const [simulateInvalidCappo, setSimulateInvalidCappo] = useState<boolean>(false);
  const [simulatePrimary503, setSimulatePrimary503] = useState<boolean>(false);

  // Execution state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [routeResult, setRouteResult] = useState<HRMRRouteResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Data arrives after mount; fall back to the first loaded item.
  const capId = selectedCapabilityId || capabilities[0]?.id || '';
  const grantId = selectedGrantId || grants[0]?.grantId || '';
  const nodeId = selectedNodeId || nodes[0]?.id || '';
  const selectedGrant = grants.find((g) => g.grantId === grantId);

  const handleRunTest = async () => {
    setIsExecuting(true);
    setRunError(null);
    try {
      const result = await onExecuteRoute(capId, grantId, nodeId, simulatePrimary503 ? nodeId : undefined, simulateInvalidCappo);
      if (!result || typeof result !== 'object') throw new Error('empty response');
      setRouteResult({ ...result, trace: Array.isArray(result.trace) ? result.trace : [] });
    } catch (err: any) {
      setRouteResult(null);
      setRunError(err?.message ? String(err.message) : 'request failed');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner Explaining the Two Invariants */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="px-2.5 py-0.5 rounded text-xs font-mono font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              ROUTER SIMULATION: THE TWO INVARIANTS
            </span>
            <h2 className="text-xl font-bold text-white mt-1">
              HRMR router simulation
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Execution location is interchangeable; authority identity is not. This simulation shows how a 403 is terminal while a
              503 reroutes to another node record. The authority check is a lookup of a <strong>local grant</strong> (not CAPPO), the
              node failure is simulated, and the output is mock data.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleRunTest}
              disabled={isExecuting}
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition flex items-center space-x-2 cursor-pointer shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {isExecuting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              <span>{isExecuting ? 'Simulating...' : 'Run route simulation'}</span>
            </button>
          </div>
        </div>

        <div className="mt-4">
          <DemoDataNote>
            Simulation only. No code runs here and no node is contacted; grants are local records, not CAPPO decisions. For real
            execution with CAPPO authorization use the 8-Layer Pipeline, Amplification Ladder or Runtime Substrate tabs.
          </DemoDataNote>
        </div>

        {/* The Two Invariants Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-indigo-500/20">
          <div className="p-4 rounded-lg bg-slate-950/70 border border-rose-500/30 space-y-1">
            <div className="flex items-center space-x-2 text-rose-400 font-bold text-sm">
              <ShieldAlert className="h-4 w-4" />
              <span>Invariant 1: Authority Cannot Move (403 Terminal)</span>
            </div>
            <p className="text-xs text-slate-300">
              403 is non-routable and non-retryable. It cannot be bypassed by fallback or reinterpreted across nodes.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-950/70 border border-sky-500/30 space-y-1">
            <div className="flex items-center space-x-2 text-sky-400 font-bold text-sm">
              <RefreshCw className="h-4 w-4" />
              <span>Invariant 2: Execution Can Move (503 Fallback)</span>
            </div>
            <p className="text-xs text-slate-300">
              A 503 from one node record reroutes to another eligible node record without changing the authority decision.
            </p>
          </div>
        </div>
      </div>

      {/* Control Panel & Simulator Setup */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Test Harness Configuration Form */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono flex items-center space-x-2">
            <Cpu className="h-4 w-4 text-indigo-400" />
            <span>Request Parameter Builder</span>
          </h3>

          {/* 1. Capability Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400">Target Capability</label>
            <select
              value={capId}
              onChange={(e) => setSelectedCapabilityId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {capabilities.map((cap) => (
                <option key={cap.id} value={cap.id}>
                  {cap.name} ({cap.category})
                </option>
              ))}
            </select>
          </div>

          {/* 2. CAPPO Grant Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400">Local grant record (not CAPPO)</label>
            <select
              value={grantId}
              onChange={(e) => setSelectedGrantId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {grants.map((grant) => (
                <option key={grant.grantId} value={grant.grantId}>
                  {grant.grantId} - [{grant.subject}]
                  {(grant as any).status ? ` (${(grant as any).status})` : ''}
                </option>
              ))}
            </select>
            {selectedGrant && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                <RecordBadge record={selectedGrant} fallback="UNVERIFIED" />
                <span>
                  expires {hasNumber(selectedGrant.expiresAt) ? new Date(selectedGrant.expiresAt).toLocaleString() : 'unknown'}
                  {hasNumber(selectedGrant.expiresAt) && selectedGrant.expiresAt < Date.now() ? ' — EXPIRED' : ''}
                </span>
              </div>
            )}
          </div>

          {/* 3. Preferred Substrate Target */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400">Preferred node record</label>
            <select
              value={nodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} [{node.region}] (stored status: {node.status})
                </option>
              ))}
            </select>
          </div>

          {/* Scenario Trigger Switches */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <h4 className="text-xs font-mono font-semibold text-slate-300">Simulate Failure Scenarios:</h4>

            {/* Switch 1: Force Invalid CAPPO (403) */}
            <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
              <div>
                <span className="text-xs font-semibold text-rose-400 block font-mono">Invalidate Authority (403)</span>
                <span className="text-[11px] text-slate-400">Simulates a revoked or unauthorized grant</span>
              </div>
              <input
                type="checkbox"
                checked={simulateInvalidCappo}
                onChange={(e) => setSimulateInvalidCappo(e.target.checked)}
                className="h-4 w-4 accent-rose-500 cursor-pointer"
              />
            </label>

            {/* Switch 2: Force Primary Node Offline (503) */}
            <label className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
              <div>
                <span className="text-xs font-semibold text-sky-400 block font-mono">Simulate Primary Node 503</span>
                <span className="text-[11px] text-slate-400">Pretends the preferred node failed</span>
              </div>
              <input
                type="checkbox"
                checked={simulatePrimary503}
                onChange={(e) => setSimulatePrimary503(e.target.checked)}
                className="h-4 w-4 accent-sky-500 cursor-pointer"
              />
            </label>
          </div>

          <button
            onClick={handleRunTest}
            disabled={isExecuting}
            className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            {isExecuting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            <span>Run route simulation</span>
          </button>
        </div>

        {/* Execution Output & Trace Inspector */}
        <div className="lg:col-span-7 space-y-4">
          {runError && (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/20 text-xs font-mono text-rose-200">
              Route simulation failed: {runError}
            </div>
          )}
          {routeResult ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              {/* Outcome Header Pill */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  {routeResult.finalHttpStatus === 200 && (
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                    </div>
                  )}
                  {routeResult.finalHttpStatus === 403 && (
                    <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                      <ShieldAlert className="h-6 w-6 text-rose-400" />
                    </div>
                  )}
                  {routeResult.finalHttpStatus === 503 && (
                    <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <AlertTriangle className="h-6 w-6 text-amber-400" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-bold text-white">HTTP {routeResult.finalHttpStatus}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                          routeResult.finalHttpStatus === 200
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : routeResult.finalHttpStatus === 403
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}
                      >
                        {routeResult.authorityDecision}
                      </span>
                      <EvidenceBadge label={(routeResult as any).evidenceLabel} fallback="DEMO" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      Tx: {routeResult.transactionId} | time: {measured((routeResult as any).executionTimeMs, ' ms')}
                    </span>
                  </div>
                </div>

                {routeResult.executionStatus === 'REROUTED_FALLBACK' && (
                  <span className="px-3 py-1 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full text-xs font-mono font-semibold">
                    REROUTED FALLBACK
                  </span>
                )}
              </div>

              {/* Header Inspector */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  Simulation result
                </h4>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Local grant check:</span>
                    <span className={routeResult.finalHttpStatus === 403 ? 'text-rose-400' : 'text-slate-200'}>
                      {routeResult.finalHttpStatus === 403 ? 'DENIED_TERMINAL' : 'local grant found (not CAPPO)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Local record hash (not canonical PGL):</span>
                    <span className="text-slate-300 truncate max-w-[240px]">
                      {routeResult.pglProofHash || 'none'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Settlement:</span>
                    <span className="text-slate-400">not implemented (nothing is charged or settled)</span>
                  </div>
                </div>
              </div>

              {/* Layer Trace Steps */}
              <div className="space-y-3">
                <h4 className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Simulation trace ({routeResult.trace.length} steps)</span>
                </h4>

                <div className="space-y-2">
                  {routeResult.trace.map((step) => {
                    const isErr = step.status === 'TERMINAL_403' || step.status === 'FALLBACK_503';
                    const isFallback = step.status === 'FALLBACK_503';

                    return (
                      <div
                        key={step.step}
                        className={`p-3 rounded-lg border text-xs font-mono space-y-1 ${
                          step.status === 'TERMINAL_403'
                            ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                            : isFallback
                            ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-bold text-slate-200">{step.layer}</span>
                          <span>{new Date(step.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-slate-200 leading-relaxed">{step.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/20">
                <Terminal className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-white text-base">Route simulation</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Pick a capability, local grant and node record, toggle the failure switches, then run the simulation to see a 403
                stay terminal and a 503 reroute.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
