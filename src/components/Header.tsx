import React from 'react';
import { Cpu, Layers, Database, AlertTriangle } from 'lucide-react';
import type { FabricStatusState } from './FabricStatus';
import { stateText, stateTone } from './FabricStatus';
import { EvidenceBadge } from './EvidenceBadge';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  /** null = not checked yet, true = /api/health answered 2xx, false = failed. */
  isBackendConnected: boolean | null;
  onOpenArchitectureModal: () => void;
  pglCount: number;
  fabric: FabricStatusState;
}

const TABS: { id: string; label: string; tag?: string; tagClass?: string }[] = [
  { id: 'fabric', label: 'Veklom Fabric', tag: 'live status', tagClass: 'bg-indigo-500/20 text-indigo-300' },
  { id: 'topology', label: 'Compute Nodes', tag: 'DEMO', tagClass: 'bg-amber-500/15 text-amber-300' },
  { id: 'fpi', label: 'Federation Providers (FPI)', tag: 'DEMO', tagClass: 'bg-amber-500/15 text-amber-300' },
  { id: 'simulator', label: 'Two Invariants Router', tag: '403/503', tagClass: 'bg-indigo-500/20 text-indigo-300' },
  { id: 'herdr', label: 'Herdr Agent Loop' },
  { id: 'ledger', label: 'Local Evidence Records' },
  { id: 'architecture8', label: '8-Layer Pipeline' },
  { id: 'amplification', label: 'Amplification Ladder' },
  { id: 'vkgSubstrate', label: 'Runtime Substrate', tag: '.vkg / Leases', tagClass: 'bg-purple-500/20 text-purple-300' },
  { id: 'api', label: 'REST API & MCP Bench' },
];

const FabricBanner: React.FC<{ fabric: FabricStatusState; onOpen: () => void }> = ({ fabric, onOpen }) => {
  const { data, error } = fabric;
  if (error && !data) {
    return (
      <div className="bg-rose-950/40 border-b border-rose-500/30 text-rose-200 text-[11px] font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>COMPUTLESS API unreachable — /api/fabric/status failed ({error}). Nothing on this page is current.</span>
        </div>
      </div>
    );
  }
  const mode = String(data?.executionMode ?? 'unknown');
  const modeTone = mode === 'governed' ? 'text-emerald-300' : mode === 'local-demo' ? 'text-amber-300' : 'text-slate-300';
  const overall = String(data?.overall ?? '');
  const t = stateTone(overall);
  return (
    <div className="bg-slate-950 border-b border-slate-800 text-[11px] font-mono">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
        <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-slate-200 cursor-pointer">
          <span>execution mode:</span>
          <strong className={modeTone}>{data ? mode : 'checking…'}</strong>
          {mode === 'local-demo' && <span className="text-amber-300/80">(runs without authorization)</span>}
          {mode === 'disabled' && <span>(nothing runs)</span>}
        </button>
        <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-slate-200 cursor-pointer">
          <span>fabric:</span>
          <span className={`h-2 w-2 rounded-full ${t.dot}`} />
          <span className={t.text}>{data ? stateText(overall) : 'checking…'}</span>
        </button>
        {error && data && <span className="text-rose-300">last refresh failed — showing previous status</span>}
        <span className="flex items-center gap-1.5 ml-auto">
          Sample data is labelled <EvidenceBadge label="DEMO" />
        </span>
      </div>
    </div>
  );
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isBackendConnected,
  onOpenArchitectureModal,
  pglCount,
  fabric,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      <FabricBanner fabric={fabric} onOpen={() => setActiveTab('fabric')} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-400 p-0.5 shadow-lg shadow-indigo-500/20">
              <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Cpu className="h-5 w-5 text-sky-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold tracking-tight text-white">COMPUTLESS</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                  PROTOTYPE
                </span>
              </div>
              <p className="text-xs text-slate-400">Execution substrate prototype on the Veklom fabric</p>
            </div>
          </div>

          {/* Quick Metrics & Architecture Trigger */}
          <div className="hidden lg:flex items-center space-x-4 text-xs font-mono">
            <button
              onClick={onOpenArchitectureModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              <span>8-Layer Stack (design)</span>
            </button>

            <div
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-800 text-slate-300"
              title="Rows in this server's local JSON store. They are not canonical PGL / Gnomledger events."
            >
              <Database className="h-3.5 w-3.5 text-slate-400" />
              <span>
                Local records: <strong className="text-slate-200">{pglCount}</strong>{' '}
                <span className="text-slate-500">(not canonical PGL)</span>
              </span>
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
              <span
                className={`h-2 w-2 rounded-full ${
                  isBackendConnected === null ? 'bg-slate-500' : isBackendConnected ? 'bg-sky-400' : 'bg-rose-500'
                }`}
              />
              <span className="text-slate-400">
                {isBackendConnected === null ? 'Checking API…' : isBackendConnected ? 'API reachable' : 'API unreachable'}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 border-t border-slate-800/80 overflow-x-auto py-2 scrollbar-none">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer flex items-center space-x-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-400/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{tab.label}</span>
              {tab.tag && <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono font-bold ${tab.tagClass}`}>{tab.tag}</span>}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
