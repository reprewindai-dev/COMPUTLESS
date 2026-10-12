import React from 'react';
import { X, Layers, Info } from 'lucide-react';
import { EvidenceBadge, type EvidenceLabel } from './EvidenceBadge';

interface ArchitectureStackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureStackModal: React.FC<ArchitectureStackModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const stackLayers: { num: number; name: string; components: string; color: string; description: string; label: EvidenceLabel; status: string }[] = [
    {
      num: 8,
      name: 'EVIDENCE, MEASUREMENT & SETTLEMENT',
      components: 'PGL / Gnomledger events | VNP metrics | x402 settlement',
      color: 'border-amber-500/40 text-amber-300 bg-amber-950/20',
      description:
        'Governed runs append an event to Gnomledger when PGL is configured (see each run\'s governance block). Local records here are HMAC-signed JSON, not canonical PGL. VNP metrics and settlement are not implemented.',
      label: 'TARGET',
      status: 'Gnomledger append: real when configured · VNP metrics: TARGET · settlement: not implemented',
    },
    {
      num: 7,
      name: 'EXECUTION',
      components: 'Node child-process sandbox',
      color: 'border-emerald-500/40 text-emerald-300 bg-emerald-950/20',
      description:
        'Workload code runs in a Node child process: empty env, filesystem and child processes denied by the Node permission model, heap cap and wall-clock kill. Network is NOT restricted; no cgroups, namespaces or hardware isolation. Remote execution nodes are TARGET.',
      label: 'VERIFIED_REPO',
      status: 'child-process sandbox: implemented in this repo · remote nodes: TARGET',
    },
    {
      num: 6,
      name: 'ROUTING (HRMR)',
      components: 'Router simulation | 503 fallback',
      color: 'border-sky-500/40 text-sky-300 bg-sky-950/20',
      description: 'Chooses among local node records; 503 reroutes, 403 stays terminal. Nodes are records, not probed hosts.',
      label: 'DEMO',
      status: 'simulation over local records',
    },
    {
      num: 5,
      name: 'AUTHORITY (CAPPO)',
      components: 'CAPPO pre-execution authorization | fail-closed 403/503',
      color: 'border-rose-500/40 text-rose-300 bg-rose-950/20',
      description:
        'In governed mode every execute request is sent to CAPPO first; only APPROVED runs. Denial, needs-approval or an unreachable CAPPO refuses the run. CAPPO decisions are unsigned and the directive is caller-declared. Local "grants" in this app are not CAPPO.',
      label: 'CONFIGURED',
      status: 'real when CAPPO is configured (see Veklom Fabric tab)',
    },
    {
      num: 4,
      name: 'CAPABILITY SEMANTICS',
      components: 'Action specifications | JSON input/output schemas',
      color: 'border-indigo-500/40 text-indigo-300 bg-indigo-950/20',
      description: 'Defines the action scope requested, independent of where it runs.',
      label: 'VERIFIED_REPO',
      status: 'capability catalog defined in this repo',
    },
    {
      num: 3,
      name: 'FEDERATION',
      components: 'cAPI registration & discovery | FPI provider interface',
      color: 'border-purple-500/40 text-purple-300 bg-purple-950/20',
      description:
        'This server registers with cAPI and sends heartbeats when CAPI_BACKEND_URL is configured (see Veklom Fabric tab). Federating external providers through FPI is TARGET; FPI providers shown are sample data.',
      label: 'CONFIGURED',
      status: 'cAPI registration: real when configured · FPI federation: TARGET',
    },
    {
      num: 2,
      name: 'NETWORK & WEB SEMANTICS',
      components: 'HTTP | REST endpoints | problem+json | MCP JSON-RPC 2.0',
      color: 'border-cyan-500/40 text-cyan-300 bg-cyan-950/20',
      description: 'Standard HTTP transport. The MCP endpoint is a prototype.',
      label: 'VERIFIED_REPO',
      status: 'implemented in this repo',
    },
    {
      num: 1,
      name: 'PHYSICAL & VIRTUAL SUBSTRATE',
      components: 'On-prem servers | edge clusters | RF microcontrollers | containers',
      color: 'border-slate-500/40 text-slate-300 bg-slate-900/50',
      description: 'Planned hardware medium providing isolation and locality. Today everything runs on the one host serving this page.',
      label: 'TARGET',
      status: 'planned',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-6 space-y-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
              <Layers className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">The 8-layer substrate stack (design vs. what exists)</h2>
              <p className="text-xs text-slate-400 font-mono">
                "HTTP gives you a universal grammar. Computless gives you universal governance."
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* The Stack Visualizer */}
        <div className="space-y-2 font-mono text-xs">
          {stackLayers.map((layer) => (
            <div
              key={layer.num}
              className={`p-3.5 rounded-xl border ${layer.color} transition hover:scale-[1.005] space-y-1`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold tracking-wider">
                  LAYER {layer.num}: {layer.name}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] opacity-75">{layer.components}</span>
                  <EvidenceBadge label={layer.label} />
                </span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed font-sans">{layer.description}</p>
              <p className="text-[10px] text-slate-400">{layer.status}</p>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 font-mono">
          <div className="flex items-center space-x-2">
            <Info className="h-4 w-4 text-slate-400" />
            <span>Badges say what exists today. Live fabric connection: Veklom Fabric tab.</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition cursor-pointer"
          >
            Close Diagram
          </button>
        </div>
      </div>
    </div>
  );
};
