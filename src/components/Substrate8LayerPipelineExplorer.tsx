import React, { useState, useEffect } from 'react';
import {
  Layers,
  ShieldCheck,
  Globe2,
  GitFork,
  Cpu,
  Database,
  Gauge,
  Coins,
  Play,
  CheckCircle2,
  AlertTriangle,
  Ban,
  FileCode,
  Sparkles,
  RefreshCw,
  Terminal,
  Key,
  BookOpen,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  CapabilityDefinition,
  CAPPOGrant,
  Substrate8LayerArchitectureSpec,
  Substrate8LayerPipelineResult,
  SubstrateLayerSpec,
} from '../types';
import { SUBSTRATE_8_LAYER_SPEC } from '../data/mockData';

interface Substrate8LayerPipelineExplorerProps {
  capabilities: CapabilityDefinition[];
  cappoGrants: CAPPOGrant[];
}

export const Substrate8LayerPipelineExplorer: React.FC<Substrate8LayerPipelineExplorerProps> = ({
  capabilities,
  cappoGrants,
}) => {
  const [activeView, setActiveView] = useState<'pipeline_tester' | 'architecture_specs'>('pipeline_tester');
  const [selectedCapability, setSelectedCapability] = useState<string>('cap-compute-v1');
  const [selectedSubject, setSelectedSubject] = useState<string>('agent:veklom-root-001');
  const [selectedGrantId, setSelectedGrantId] = useState<string>('cappo-grant-alpha-001');
  const [selectedRuntime, setSelectedRuntime] = useState<'node_vm' | 'docker_isolated' | 'e2b_cloud_cell'>('node_vm');
  const [simulateFault, setSimulateFault] = useState<'NONE' | 'INVALID_CAPPO' | 'EXPIRED_GRANT' | 'NODE_OUTAGE_503'>('NONE');
  const [payloadJson, setPayloadJson] = useState<string>(
    '{\n  "action": "matrix_multiply",\n  "matrixSize": 64,\n  "iterations": 150,\n  "workloadPriority": "high"\n}'
  );
  const [codeSnippet, setCodeSnippet] = useState<string>(
    '// COMPUTLESS Substrate 8-Layer Bounded VM Execution\nconst input = context.inputPayload || {};\nconst iterations = input.iterations || 100;\nlet result = 0;\nfor(let i = 0; i < iterations; i++) {\n  result += Math.sqrt(i * 2.5);\n}\noutput.computedScore = Math.round(result * 100) / 100;\noutput.targetNode = context.targetNode;\noutput.status = "VERIFIED_COMPUTLESS_EXECUTION";\nconsole.log("Substrate V8 workload finished. Score=" + output.computedScore);'
  );

  const [executing, setExecuting] = useState<boolean>(false);
  const [pipelineResult, setPipelineResult] = useState<Substrate8LayerPipelineResult | null>(null);
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null);
  const [selectedSpecLayer, setSelectedSpecLayer] = useState<SubstrateLayerSpec>(SUBSTRATE_8_LAYER_SPEC.layers[0]);

  // Execute pipeline
  const handleExecutePipeline = async () => {
    try {
      setExecuting(true);
      setPipelineResult(null);

      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(payloadJson);
      } catch (e) {
        parsedPayload = { raw: payloadJson };
      }

      const res = await fetch('/api/substrate/pipeline/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: selectedCapability,
          subject: selectedSubject,
          cappoGrantId: selectedGrantId,
          payload: parsedPayload,
          routingPolicy: { requireSovereignty: false, maxLatencyMs: 120, priority: 'speed' },
          runtimeTarget: selectedRuntime,
          codeSnippet,
          simulateFault,
        }),
      });

      const data = await res.json();
      setPipelineResult(data);
      if (data.overallStatus === 'BLOCKED_403') {
        setExpandedLayer(2);
      } else if (data.overallStatus === 'FALLBACK_503') {
        setExpandedLayer(4);
      } else {
        setExpandedLayer(1);
      }
    } catch (err) {
      console.error('Pipeline execution failed:', err);
    } finally {
      setExecuting(false);
    }
  };

  const layerIcons = [
    { num: 1, name: 'Capability', icon: Layers, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30' },
    { num: 2, name: 'Authority', icon: ShieldCheck, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
    { num: 3, name: 'Federation', icon: Globe2, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/30' },
    { num: 4, name: 'Routing', icon: GitFork, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/30' },
    { num: 5, name: 'Execution', icon: Cpu, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    { num: 6, name: 'Evidence', icon: Database, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    { num: 7, name: 'Measurement', icon: Gauge, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30' },
    { num: 8, name: 'Settlement', icon: Coins, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center space-x-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>COMPUTLESS CLOUD Substrate Architecture</span>
              </span>
              <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                8 Canonical Layers Formalized
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Decentralized Substrate Architecture &amp; Pipeline Engine
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl mt-1">
              End-to-end formalization spanning Capability, Authority, Federation, Routing, Execution, Evidence, Measurement, and Settlement.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveView('pipeline_tester')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer flex items-center space-x-2 ${
                activeView === 'pipeline_tester'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              <Play className="h-4 w-4" />
              <span>Interactive Pipeline Tester</span>
            </button>
            <button
              onClick={() => setActiveView('architecture_specs')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer flex items-center space-x-2 ${
                activeView === 'architecture_specs'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              <span>8-Layer Specifications</span>
            </button>
          </div>
        </div>

        {/* 8-Layer Micro-Bar */}
        <div className="mt-6 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs font-mono">
          {SUBSTRATE_8_LAYER_SPEC.layers.map((l) => (
            <div
              key={l.layerNumber}
              onClick={() => {
                setSelectedSpecLayer(l);
                setActiveView('architecture_specs');
              }}
              className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 transition cursor-pointer"
            >
              <span className="text-[10px] text-slate-500 block">L{l.layerNumber}</span>
              <span className="font-bold text-slate-200 block truncate">{l.name.replace(' Layer', '')}</span>
              <span className="text-[10px] text-sky-400 block truncate mt-0.5">{l.question}</span>
            </div>
          ))}
        </div>
      </div>

      {/* VIEW 1: INTERACTIVE PIPELINE TESTER */}
      {activeView === 'pipeline_tester' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Form */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 font-mono text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Play className="h-4 w-4 text-sky-400" />
                  <span>Pipeline Dispatch Parameters</span>
                </h2>
                <span className="text-[11px] text-slate-400">8 Layers Deterministic</span>
              </div>

              {/* Capability */}
              <div>
                <label className="text-slate-400 block mb-1">Layer 1: Target Capability</label>
                <select
                  value={selectedCapability}
                  onChange={(e) => setSelectedCapability(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:border-indigo-500"
                >
                  {capabilities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Subject & CAPPO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Layer 2: Subject (Who)</label>
                  <input
                    type="text"
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">CAPPO Grant ID</label>
                  <select
                    value={selectedGrantId}
                    onChange={(e) => setSelectedGrantId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:border-indigo-500"
                  >
                    {cappoGrants.map((g) => (
                      <option key={g.grantId} value={g.grantId}>
                        {g.grantId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Runtime Containment & Fault Simulation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Layer 5: Runtime Target</label>
                  <select
                    value={selectedRuntime}
                    onChange={(e) => setSelectedRuntime(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:border-indigo-500"
                  >
                    <option value="node_vm">Node V8 Isolated VM</option>
                    <option value="docker_isolated">Docker Enclave Cell</option>
                    <option value="e2b_cloud_cell">E2B Bounded Cell</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Fault Simulation Invariant</label>
                  <select
                    value={simulateFault}
                    onChange={(e) => setSimulateFault(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:border-indigo-500"
                  >
                    <option value="NONE">None (Happy Path 200)</option>
                    <option value="INVALID_CAPPO">Trigger Invariant 1 (403 Fail-Closed)</option>
                    <option value="EXPIRED_GRANT">Expired Grant (403 Terminal)</option>
                    <option value="NODE_OUTAGE_503">Trigger Invariant 2 (503 Fallback)</option>
                  </select>
                </div>
              </div>

              {/* Input JSON */}
              <div>
                <label className="text-slate-400 block mb-1">Input Payload Parameters (JSON):</label>
                <textarea
                  value={payloadJson}
                  onChange={(e) => setPayloadJson(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-emerald-300 font-mono text-xs focus:border-indigo-500"
                />
              </div>

              {/* Code Snippet */}
              <div>
                <label className="text-slate-400 block mb-1">Isolated Workload Script:</label>
                <textarea
                  value={codeSnippet}
                  onChange={(e) => setCodeSnippet(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sky-300 font-mono text-xs focus:border-indigo-500"
                />
              </div>

              <button
                onClick={handleExecutePipeline}
                disabled={executing}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition cursor-pointer flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                <Play className={`h-4 w-4 ${executing ? 'animate-spin' : ''}`} />
                <span>{executing ? 'Traversing 8 Substrate Layers...' : 'Execute End-to-End 8-Layer Pipeline'}</span>
              </button>
            </div>
          </div>

          {/* Realtime 8-Layer Trace Stepper */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-full flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                  <div className="flex items-center space-x-2">
                    <Layers className="h-5 w-5 text-indigo-400" />
                    <h2 className="text-sm font-bold text-white">8-Layer Deterministic Trace Pipeline</h2>
                  </div>
                  {pipelineResult && (
                    <div className="flex items-center space-x-2 font-mono text-xs">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-bold ${
                          pipelineResult.overallStatus === 'SUCCESS'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : pipelineResult.overallStatus === 'FALLBACK_503'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {pipelineResult.overallStatus} (HTTP {pipelineResult.httpStatus})
                      </span>
                      <span className="text-slate-400">Total: {pipelineResult.totalDurationMs}ms</span>
                    </div>
                  )}
                </div>

                {pipelineResult ? (
                  <div className="space-y-3 font-mono text-xs">
                    {/* Render each of the 8 layers */}
                    {Object.entries(pipelineResult.layers).map(([layerKey, layerStep]: [string, any]) => {
                      const iconConfig = layerIcons.find((i) => i.num === layerStep.layerNumber) || layerIcons[0];
                      const Icon = iconConfig.icon;
                      const isExpanded = expandedLayer === layerStep.layerNumber;

                      return (
                        <div
                          key={layerKey}
                          className={`rounded-xl border transition ${
                            layerStep.status === 'SUCCESS'
                              ? 'bg-slate-950/80 border-slate-800'
                              : layerStep.status === 'FALLBACK_503'
                              ? 'bg-sky-950/30 border-sky-500/40'
                              : layerStep.status === 'BLOCKED_403'
                              ? 'bg-rose-950/30 border-rose-500/40'
                              : 'bg-slate-950/40 border-slate-800/60 opacity-60'
                          }`}
                        >
                          <div
                            onClick={() => setExpandedLayer(isExpanded ? null : layerStep.layerNumber)}
                            className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                          >
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-lg ${iconConfig.bg}`}>
                                <Icon className={`h-4 w-4 ${iconConfig.color}`} />
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-bold text-white">
                                    L{layerStep.layerNumber}: {layerStep.layerName}
                                  </span>
                                  <span className="text-[10px] text-slate-400">({layerStep.question})</span>
                                </div>
                                <p className="text-[11px] text-slate-300 mt-0.5">{layerStep.summary}</p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  layerStep.status === 'SUCCESS'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : layerStep.status === 'FALLBACK_503'
                                    ? 'bg-sky-500/20 text-sky-300'
                                    : layerStep.status === 'BLOCKED_403'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-slate-800 text-slate-500'
                                }`}
                              >
                                {layerStep.status}
                              </span>
                              <span className="text-[11px] text-slate-400">{layerStep.durationMs}ms</span>
                              {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                            </div>
                          </div>

                          {/* Expanded Step Data Inspector */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 bg-slate-950/90 rounded-b-xl space-y-3">
                              {/* Specialized visualization for Layer 6: Evidence */}
                              {layerStep.layerNumber === 6 && layerStep.data && (
                                <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs font-mono">
                                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                                    <span>🔐 Immutable Cryptographic Proof Seal</span>
                                    <span>Block #{layerStep.data.blockHeight ?? 1}</span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
                                    <div>
                                      <span className="text-[10px] text-slate-500 block">MERKLE LEAF HASH:</span>
                                      <span className="text-emerald-300 break-all">{layerStep.data.merkleLeafHash}</span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-slate-500 block">PARENT BLOCK HASH:</span>
                                      <span className="text-slate-400 break-all">{layerStep.data.parentBlockHash}</span>
                                    </div>
                                    <div className="md:col-span-2">
                                      <span className="text-[10px] text-slate-500 block">HMAC-SHA256 SIGNATURE:</span>
                                      <span className="text-amber-300 break-all">{layerStep.data.pglSignature}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Specialized visualization for Layer 7: Measurement */}
                              {layerStep.layerNumber === 7 && layerStep.data && (
                                <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs font-mono">
                                  <div className="flex items-center justify-between text-sky-400 font-bold">
                                    <span>📊 5-Point Confirmation Certificate</span>
                                    <span className="text-emerald-400">Score: {layerStep.data.confirmationScorePct}%</span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                                      <span className="text-[10px] text-slate-500 block">SCHEMA CONFORMANCE:</span>
                                      <span className="text-emerald-400 font-bold">{layerStep.data.dimensions?.schemaConformance?.status || 'PASS'}</span>
                                    </div>
                                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                                      <span className="text-[10px] text-slate-500 block">SLA LATENCY:</span>
                                      <span className="text-sky-300 font-bold">{layerStep.data.dimensions?.slaLatency?.actualWallClockLatencyMs}ms / Max {layerStep.data.dimensions?.slaLatency?.targetMaxLatencyMs}ms</span>
                                    </div>
                                    <div className="p-2 bg-slate-950 rounded border border-slate-800">
                                      <span className="text-[10px] text-slate-500 block">RUNTIME EXIT CODE:</span>
                                      <span className="text-emerald-400 font-bold">{layerStep.data.dimensions?.runtimeStatus?.exitCode || '0 (SUCCESS)'}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div>
                                <span className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">
                                  Layer {layerStep.layerNumber} Structured Data Payload:
                                </span>
                                <pre className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-sky-300 text-[11px] overflow-x-auto max-h-48">
                                  {JSON.stringify(layerStep.data, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-12 text-center text-slate-500 font-mono text-xs flex flex-col items-center justify-center space-y-3">
                    <Layers className="h-10 w-10 text-slate-600" />
                    <p className="text-slate-300 font-semibold">Ready to execute 8-layer substrate pipeline.</p>
                    <p className="text-slate-500 max-w-md">
                      Configure your capability and execution options on the left, then click &quot;Execute End-to-End 8-Layer Pipeline&quot; to inspect every layer in real time.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: 8-LAYER ARCHITECTURE SPECIFICATIONS */}
      {activeView === 'architecture_specs' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Layer List */}
          <div className="lg:col-span-4 space-y-2">
            {SUBSTRATE_8_LAYER_SPEC.layers.map((layer) => {
              const iconConfig = layerIcons.find((i) => i.num === layer.layerNumber) || layerIcons[0];
              const Icon = iconConfig.icon;
              const isSelected = selectedSpecLayer.layerNumber === layer.layerNumber;

              return (
                <div
                  key={layer.layerNumber}
                  onClick={() => setSelectedSpecLayer(layer)}
                  className={`p-4 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500/50 shadow-lg shadow-indigo-600/10'
                      : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${iconConfig.bg}`}>
                      <Icon className={`h-4 w-4 ${iconConfig.color}`} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-mono text-slate-400">Layer {layer.layerNumber}</span>
                        <span className="text-sm font-bold text-white">{layer.name}</span>
                      </div>
                      <p className="text-xs font-mono text-sky-400">{layer.question}</p>
                    </div>
                  </div>
                  <ArrowRight className={`h-4 w-4 ${isSelected ? 'text-indigo-400' : 'text-slate-600'}`} />
                </div>
              );
            })}
          </div>

          {/* Detailed Specification Card */}
          <div className="lg:col-span-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 font-mono space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                      Layer #{selectedSpecLayer.layerNumber}
                    </span>
                    <span className="text-xs text-slate-400">Protocol: {selectedSpecLayer.protocolStandard}</span>
                  </div>
                  <h2 className="text-xl font-bold text-white">{selectedSpecLayer.name}</h2>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-sky-400 font-bold text-sm">
                  &ldquo;{selectedSpecLayer.question}&rdquo;
                </div>
              </div>

              {/* Core Principle */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Core Architectural Principle</h3>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed">
                  {selectedSpecLayer.corePrinciple}
                </div>
              </div>

              {/* Primary Mechanism */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Primary Mechanism</h3>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-sky-300 text-xs leading-relaxed">
                  {selectedSpecLayer.primaryMechanism}
                </div>
              </div>

              {/* Invariants & Guarantees */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Invariants &amp; Cryptographic Guarantees</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedSpecLayer.invariants.map((inv, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-emerald-500/20 flex items-start space-x-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-300">{inv}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Structures */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Core TypeScript Data Structures</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedSpecLayer.dataStructures.map((ds, idx) => (
                    <span key={idx} className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-indigo-300 font-bold">
                      {ds}
                    </span>
                  ))}
                </div>
              </div>

              {/* Specifications Document Notice */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400">Full markdown specifications saved in repository:</span>
                <span className="px-2.5 py-1 rounded bg-slate-950 text-slate-300 border border-slate-800">
                  COMPUTLESS_SUBSTRATE_SPEC.md
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
