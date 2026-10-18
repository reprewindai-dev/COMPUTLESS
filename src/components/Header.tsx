import React from 'react';
import { Cpu, AlertTriangle } from 'lucide-react';
import type { FabricStatusState } from './FabricStatus';
import { stateText, stateTone } from './common';
import { fmtTime } from '../ui/api';
import { isLocalMode } from './Governance';

export const TABS: { id: string; label: string }[] = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'services', label: 'Services' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'run', label: 'Run' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'runs', label: 'Runs' },
  { id: 'security', label: 'Security tests' },
];

const FabricBanner: React.FC<{ fabric: FabricStatusState; onOpen: () => void }> = ({ fabric, onOpen }) => {
  const { data, error } = fabric;
  if (error && !data) {
    return (
      <div className="bg-rose-950/40 border-b border-rose-500/30 text-rose-200 text-[11px] font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>COMPUTLESS API unreachable: /api/fabric/status failed ({error}).</span>
        </div>
      </div>
    );
  }
  const mode = String(data?.executionMode ?? '');
  const modeTone = mode === 'governed' ? 'text-emerald-300' : isLocalMode(mode) ? 'text-amber-300' : 'text-slate-300';
  const reg = String(data?.registration?.state ?? '');
  const overall = String(data?.overall ?? '');
  const rt = stateTone(reg);
  const ot = stateTone(overall);
  return (
    <div className="bg-slate-950 border-b border-slate-800 text-[11px] font-mono" data-banner>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-400">
        <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-slate-200 cursor-pointer">
          <span>execution mode:</span>
          <strong className={modeTone} data-banner-mode>
            {data ? mode || 'not reported' : 'checking…'}
          </strong>
          {isLocalMode(mode) && <span className="text-amber-300/80">(runs without authorization)</span>}
          {mode === 'disabled' && <span>(nothing runs)</span>}
        </button>
        <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-slate-200 cursor-pointer">
          <span>cAPI registration:</span>
          <span className={`h-2 w-2 rounded-full ${rt.dot}`} />
          <span className={rt.text}>{data ? reg || 'not reported' : 'checking…'}</span>
        </button>
        <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-slate-200 cursor-pointer">
          <span>dependencies:</span>
          <span className={`h-2 w-2 rounded-full ${ot.dot}`} />
          <span className={ot.text}>{data ? stateText(overall) : 'checking…'}</span>
        </button>
        {error && data && <span className="text-rose-300">last refresh failed ({error}); showing status from {fmtTime(data.checkedAt)}</span>}
      </div>
    </div>
  );
};

export const Header: React.FC<{ activeTab: string; setActiveTab: (t: string) => void; fabric: FabricStatusState }> = ({
  activeTab,
  setActiveTab,
  fabric,
}) => (
  <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
    <FabricBanner fabric={fabric} onOpen={() => setActiveTab('fabric')} />
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center h-16 gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-400 p-0.5 shadow-lg shadow-indigo-500/20">
          <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <Cpu className="h-5 w-5 text-sky-400" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight text-white">COMPUTLESS</div>
          <p className="text-xs text-slate-400 truncate">COMPUTLESS — governed workload runner on the Veklom fabric</p>
        </div>
      </div>

      <nav className="flex gap-1 border-t border-slate-800/80 overflow-x-auto py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            data-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-400/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  </header>
);
