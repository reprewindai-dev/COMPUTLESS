import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { Envelope } from '../ui/types';
import { PEER_ENV, SOURCE_NAME, fmtTime } from '../ui/api';

export function stateText(state?: string): string {
  switch (state) {
    case 'reachable_not_verified':
      return 'reachable (not verified)';
    default:
      return state ? String(state) : 'unknown';
  }
}

/** Green only when actually healthy/registered/matched; unconfigured is neutral grey. */
export function stateTone(state?: string): { dot: string; text: string } {
  switch (String(state ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'registered':
    case 'matched':
    case 'verified':
    case 'ready':
      return { dot: 'bg-emerald-400', text: 'text-emerald-300' };
    case 'reachable_not_verified':
    case 'registering':
      return { dot: 'bg-sky-400', text: 'text-sky-300' };
    case 'degraded':
    case 'mismatched':
      return { dot: 'bg-amber-400', text: 'text-amber-300' };
    case 'unavailable':
    case 'rejected':
    case 'failed':
    case 'invalid':
    case 'error':
      return { dot: 'bg-rose-500', text: 'text-rose-300' };
    default:
      return { dot: 'bg-slate-500', text: 'text-slate-400' };
  }
}

export const StateChip: React.FC<{ state?: string; text?: string }> = ({ state, text }) => {
  const t = stateTone(state);
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${t.text}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${t.dot}`} />
      {text ?? stateText(state)}
    </span>
  );
};

export const Card: React.FC<{
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, right, children, className = '' }) => (
  <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {right}
    </div>
    {children}
  </div>
);

export const KV: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-4 text-xs font-mono">
    <span className="text-slate-400 shrink-0">{k}</span>
    <span className="text-slate-200 text-right break-all">{v ?? <span className="text-slate-500">—</span>}</span>
  </div>
);

export const SourceTag: React.FC<{ source: string; fetchedAt?: string | null; endpoint?: string }> = ({
  source,
  fetchedAt,
  endpoint,
}) => (
  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono text-slate-500">
    <span className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-950 text-slate-300">
      source: {SOURCE_NAME[source] ?? source}
    </span>
    {endpoint && <span>{endpoint}</span>}
    {fetchedAt !== undefined && <span>fetched {fmtTime(fetchedAt)}</span>}
  </span>
);

/** Page header for a tab: title, explanation, source, refresh. */
export const TabHeader: React.FC<{
  title: string;
  endpoint: string;
  source: string;
  description: React.ReactNode;
  fetchedAt?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  polling?: boolean;
}> = ({ title, endpoint, source, description, fetchedAt, loading, onRefresh, polling }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      <div className="space-y-1.5 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-0.5 rounded text-xs font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
            {endpoint}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-slate-700 bg-slate-950 text-slate-300">
            source: {SOURCE_NAME[source] ?? source}
          </span>
          {polling && <span className="text-xs text-slate-500">refreshes every 15 s</span>}
        </div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <div className="text-sm text-slate-300 max-w-3xl">{description}</div>
      </div>
      {onRefresh && (
        <div className="flex flex-col lg:items-end gap-2 shrink-0">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer disabled:opacity-60 w-fit"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <span className="text-[10px] font-mono text-slate-500">fetched: {fmtTime(fetchedAt)}</span>
        </div>
      )}
    </div>
  </div>
);

export const ErrorBox: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-200 text-sm flex items-start gap-2">
    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
    <div className="min-w-0">
      <div className="font-semibold">{title}</div>
      {children && <div className="text-xs font-mono text-rose-300/80 break-words">{children}</div>}
    </div>
  </div>
);

export const NoteBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-xs text-slate-400">{children}</div>
);

/**
 * Plain statement of why an envelope has no data: unconfigured (naming the
 * env var), unreachable, or an HTTP error from the peer.
 */
export function envelopeProblem(env: Envelope<unknown> | null | undefined, envVar?: string): string | null {
  if (!env) return 'no response';
  if (env.ok) return null;
  const name = SOURCE_NAME[String(env.source)] ?? String(env.source ?? 'peer');
  if (env.configured === false) {
    const v = envVar ?? PEER_ENV[String(env.source)];
    const err = env.error && env.error !== 'not configured' ? ` (${env.error})` : '';
    return `${name} is not configured on this server${v ? `: ${v} is not set` : ''}${err}.`;
  }
  return `${name} did not return data: ${env.error ?? 'unknown error'}${env.status ? ` (HTTP ${env.status})` : ''}.`;
}

export const EnvelopeError: React.FC<{ env: Envelope<unknown> | null | undefined; envVar?: string }> = ({ env, envVar }) => {
  const p = envelopeProblem(env, envVar);
  if (!p) return null;
  const unconfigured = env?.configured === false;
  return (
    <div
      className={`p-3 rounded-lg border text-xs font-mono flex items-start gap-2 ${
        unconfigured ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-rose-500/30 bg-rose-950/20 text-rose-200'
      }`}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        {p} {env?.fetchedAt && <span className="text-slate-500">(checked {fmtTime(env.fetchedAt)})</span>}
      </span>
    </div>
  );
};

export const JsonBlock: React.FC<{ value: unknown; maxHeight?: string }> = ({ value, maxHeight = 'max-h-96' }) => (
  <pre
    className={`bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-auto ${maxHeight} whitespace-pre-wrap break-all`}
  >
    {JSON.stringify(value, null, 2)}
  </pre>
);

export const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="py-2 pr-4 font-normal whitespace-nowrap">{children}</th>
);
