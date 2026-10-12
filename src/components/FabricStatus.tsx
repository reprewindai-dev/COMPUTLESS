import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Network, ShieldCheck, BookOpen, Server, KeyRound, Box, AlertTriangle } from 'lucide-react';
import { EvidenceBadge } from './EvidenceBadge';
import { DirectiveControl } from './Governance';

// ── Types (mirrors GET /api/fabric/status; every field treated as optional) ──

export type ExecutionMode = 'disabled' | 'local-demo' | 'governed';
export type DependencyState = 'healthy' | 'reachable_not_verified' | 'degraded' | 'unconfigured' | 'unavailable';

export interface FabricDependency {
  name?: string;
  state?: DependencyState | string;
  verification_scope?: string;
  protocol_identity?: 'matched' | 'mismatched' | 'unavailable' | string;
  observed_service?: string | null;
  checked_at?: string;
}

export interface FabricStatusData {
  service?: string;
  version?: string;
  sourceCommit?: string | null;
  publicBaseUrl?: string | null;
  executionMode?: ExecutionMode | string;
  sandbox?: Record<string, unknown> | null;
  configured?: Record<string, boolean> | null;
  registration?: {
    state?: string;
    lastAttemptAt?: string | null;
    registeredAt?: string | null;
    lastHeartbeatAt?: string | null;
    expiresAt?: string | null;
    lastStatusCode?: number | null;
    lastError?: string | null;
    executableCapabilityIds?: string[];
  } | null;
  dependencies?: FabricDependency[];
  overall?: DependencyState | string;
  verification_scope?: string;
  checkedAt?: string;
}

export interface FabricStatusState {
  data: FabricStatusData | null;
  error: string | null;
  loading: boolean;
  lastFetchedAt: string | null;
  refresh: () => void;
}

export function useFabricStatus(pollMs = 15000): FabricStatusState {
  const [data, setData] = useState<FabricStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/fabric/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FabricStatusData;
      setData(json && typeof json === 'object' ? json : null);
      setError(null);
    } catch (err: any) {
      setError(err?.message ? String(err.message) : 'request failed');
    } finally {
      setLastFetchedAt(new Date().toISOString());
      setLoading(false);
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { data, error, loading, lastFetchedAt, refresh };
}

// ── Wording / colours ────────────────────────────────────────────────────────

export const MODE_TEXT: Record<string, { label: string; explain: string; tone: string }> = {
  governed: {
    label: 'governed',
    explain:
      'Every execute request is sent to CAPPO first. Only an APPROVED decision runs; denials, "needs approval" and an unreachable CAPPO are refused (fail-closed). Evidence of each run is appended to Gnomledger when PGL is configured.',
    tone: 'text-emerald-300',
  },
  'local-demo': {
    label: 'local-demo',
    explain:
      'Code runs WITHOUT any authorization. CAPPO is not asked and nothing is recorded to Gnomledger. Every result is labelled DEMO and proves nothing.',
    tone: 'text-amber-300',
  },
  disabled: {
    label: 'disabled',
    explain: 'Code execution is turned off. Every execute endpoint answers 503 and nothing runs.',
    tone: 'text-slate-300',
  },
};

export function stateText(state?: string): string {
  switch (state) {
    case 'healthy':
      return 'healthy';
    case 'reachable_not_verified':
      return 'reachable (not verified)';
    case 'degraded':
      return 'degraded';
    case 'unconfigured':
      return 'unconfigured';
    case 'unavailable':
      return 'unavailable';
    default:
      return state ? String(state) : 'unknown';
  }
}

/** Green only when actually healthy/registered/matched; unconfigured is neutral grey. */
export function stateTone(state?: string): { dot: string; text: string } {
  switch (state) {
    case 'healthy':
    case 'registered':
    case 'matched':
      return { dot: 'bg-emerald-400', text: 'text-emerald-300' };
    case 'reachable_not_verified':
    case 'registering':
      return { dot: 'bg-sky-400', text: 'text-sky-300' };
    case 'degraded':
    case 'mismatched':
      return { dot: 'bg-amber-400', text: 'text-amber-300' };
    case 'unavailable':
    case 'rejected':
      return { dot: 'bg-rose-500', text: 'text-rose-300' };
    default:
      return { dot: 'bg-slate-500', text: 'text-slate-400' };
  }
}

const StateChip: React.FC<{ state?: string; text?: string }> = ({ state, text }) => {
  const t = stateTone(state);
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${t.text}`}>
      <span className={`h-2 w-2 rounded-full ${t.dot}`} />
      {text ?? stateText(state)}
    </span>
  );
};

const DEP_TITLES: Record<string, string> = {
  local_store: 'Local store (data/ directory)',
  capi: 'cAPI (registry)',
  cappo: 'CAPPO (authorization)',
  pgl: 'PGL / Gnomledger (evidence)',
  lockerphycer: 'Lockerphycer',
};

const CONFIG_ROWS: { key: string; label: string }[] = [
  { key: 'capi', label: 'cAPI URL' },
  { key: 'capiApiKey', label: 'cAPI API key' },
  { key: 'cappo', label: 'CAPPO URL' },
  { key: 'cappoApiKey', label: 'CAPPO API key' },
  { key: 'pgl', label: 'PGL ledger URL' },
  { key: 'pglApiKey', label: 'PGL API key' },
  { key: 'pglAgentId', label: 'PGL agent id' },
  { key: 'lockerphycer', label: 'Lockerphycer URL' },
  { key: 'gemini', label: 'Gemini API key' },
];

function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

const Card: React.FC<{ title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  right,
  children,
}) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {right}
    </div>
    {children}
  </div>
);

const KV: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-4 text-xs font-mono">
    <span className="text-slate-400 shrink-0">{k}</span>
    <span className="text-slate-200 text-right break-all">{v}</span>
  </div>
);

// ── Panel ────────────────────────────────────────────────────────────────────

export const FabricStatusPanel: React.FC<{ fabric: FabricStatusState }> = ({ fabric }) => {
  const { data, error, loading, lastFetchedAt, refresh } = fabric;
  const mode = String(data?.executionMode ?? '');
  const modeInfo = MODE_TEXT[mode];
  const reg = data?.registration ?? null;
  const deps = Array.isArray(data?.dependencies) ? data!.dependencies! : [];
  const configured = data?.configured ?? {};
  const sandbox = data?.sandbox ?? null;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                GET /api/fabric/status
              </span>
              <span className="text-xs text-slate-400">refreshes every 15 s</span>
            </div>
            <h2 className="text-xl font-bold text-white">Veklom Fabric connection</h2>
            <p className="text-sm text-slate-300 max-w-3xl">
              What this COMPUTLESS server is actually connected to, as observed by the server right now. A reachable peer is
              reported as "reachable (not verified)": an HTTP 2xx proves the host answered, not who it is or what code it runs.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <span className="text-[10px] font-mono text-slate-500">
              server checked: {fmtTime(data?.checkedAt)} · fetched: {fmtTime(lastFetchedAt)}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">COMPUTLESS API unreachable</div>
            <div className="text-xs font-mono text-rose-300/80">
              /api/fabric/status failed ({error}). {data ? 'Values below are the last successful response and may be stale.' : 'No status available.'}
            </div>
          </div>
        </div>
      )}

      {!data && !error && <div className="text-sm text-slate-400 font-mono">Loading fabric status…</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Execution mode" icon={<ShieldCheck className="h-4 w-4 text-indigo-400" />}>
              <div className={`text-2xl font-bold font-mono ${modeInfo?.tone ?? 'text-slate-300'}`}>{mode || 'unknown'}</div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {modeInfo?.explain ?? 'The server reported an execution mode this UI does not recognize.'}
              </p>
              <div className="pt-2 border-t border-slate-800">
                <DirectiveControl />
                <p className="text-[10px] text-slate-500 mt-1">
                  Sent with every execute request from this UI. CAPPO decides; in governed mode an empty directive gets NEEDS_APPROVAL.
                  CAPPO decisions are unsigned.
                </p>
              </div>
            </Card>

            <Card
              title="cAPI registration"
              icon={<Network className="h-4 w-4 text-sky-400" />}
              right={<StateChip state={reg?.state} text={reg?.state ?? 'unknown'} />}
            >
              {reg?.state === 'unconfigured' ? (
                <p className="text-xs text-slate-400">
                  CAPI_BACKEND_URL is not set, so this server is not registered with cAPI and is not discoverable on the fabric.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <KV k="registered at" v={fmtTime(reg?.registeredAt)} />
                  <KV k="last heartbeat" v={fmtTime(reg?.lastHeartbeatAt)} />
                  <KV k="expires" v={fmtTime(reg?.expiresAt)} />
                  <KV k="last attempt" v={fmtTime(reg?.lastAttemptAt)} />
                  <KV k="last HTTP status" v={reg?.lastStatusCode ?? '—'} />
                  <KV
                    k="last error"
                    v={reg?.lastError ? <span className="text-rose-300">{reg.lastError}</span> : '—'}
                  />
                  <KV
                    k="executable capabilities"
                    v={
                      Array.isArray(reg?.executableCapabilityIds) && reg!.executableCapabilityIds!.length
                        ? reg!.executableCapabilityIds!.join(', ')
                        : 'none'
                    }
                  />
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Dependencies"
            icon={<Server className="h-4 w-4 text-emerald-400" />}
            right={
              <span className="text-xs font-mono text-slate-400">
                overall: <StateChip state={String(data.overall ?? '')} />
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-4">dependency</th>
                    <th className="py-2 pr-4">state</th>
                    <th className="py-2 pr-4">protocol identity</th>
                    <th className="py-2 pr-4">verification scope</th>
                    <th className="py-2">checked at</th>
                  </tr>
                </thead>
                <tbody>
                  {deps.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-3 text-slate-500">
                        No dependencies reported.
                      </td>
                    </tr>
                  )}
                  {deps.map((d, i) => (
                    <tr key={`${d.name}-${i}`} className="border-b border-slate-800/60">
                      <td className="py-2 pr-4 text-slate-200">{DEP_TITLES[d.name ?? ''] ?? d.name ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <StateChip state={d.state} />
                      </td>
                      <td className="py-2 pr-4">
                        {d.protocol_identity ? (
                          <span>
                            <StateChip state={d.protocol_identity} text={d.protocol_identity} />
                            {d.observed_service && <span className="text-slate-500"> ({d.observed_service})</span>}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">{d.verification_scope ?? '—'}</td>
                      <td className="py-2 text-slate-400">{fmtTime(d.checked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500">
              Scope: {data.verification_scope ?? 'not reported'}. Protocol identity "matched" means the peer's /protocol.json names
              the expected service; it does not verify source commit or runtime.
            </p>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Configuration" icon={<KeyRound className="h-4 w-4 text-blue-400" />} right={<EvidenceBadge label="CONFIGURED" />}>
              <p className="text-[11px] text-slate-500">Whether each setting is present. Values and secrets are never shown.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {CONFIG_ROWS.map((r) => {
                  const on = configured?.[r.key] === true;
                  return (
                    <div key={r.key} className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400">{r.label}</span>
                      <span className={on ? 'text-blue-300' : 'text-slate-500'}>{on ? 'configured' : 'not configured'}</span>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <KV k="service" v={`${data.service ?? '—'} ${data.version ?? ''}`} />
                <KV k="source commit" v={data.sourceCommit || <span className="text-slate-500">not configured</span>} />
                <KV k="public URL" v={data.publicBaseUrl || <span className="text-slate-500">not configured</span>} />
              </div>
            </Card>

            <Card title="Sandbox boundary (as reported)" icon={<Box className="h-4 w-4 text-amber-400" />}>
              {sandbox ? (
                <div className="space-y-1.5">
                  {Object.entries(sandbox).map(([k, v]) => (
                    <KV
                      key={k}
                      k={k}
                      v={
                        <span className={k === 'network' ? 'text-amber-300 font-bold' : ''}>
                          {typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)}
                        </span>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Not reported.</p>
              )}
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Workload code runs in a separate Node child process with an empty environment; the Node permission model denies
                filesystem and child-process access. Network access is not restricted. There are no cgroups, namespaces or hardware
                isolation.
              </p>
            </Card>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-xs text-slate-400 flex items-start gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
            <span>
              Other tabs show this prototype's local data. Seeded sample records are labelled <EvidenceBadge label="DEMO" />, records
              created on this server are <EvidenceBadge label="UNVERIFIED" />, and planned features are{' '}
              <EvidenceBadge label="TARGET" />. Only CAPPO decisions and Gnomledger events shown in an execution's governance block
              come from the Veklom fabric.
            </span>
          </div>
        </>
      )}
    </div>
  );
};
