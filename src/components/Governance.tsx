import React, { useSyncExternalStore } from 'react';
import { ShieldAlert, ShieldCheck, ShieldX, BookOpen } from 'lucide-react';
import { EvidenceBadge } from './EvidenceBadge';

/**
 * Governance helpers for the five execute endpoints. The server asks CAPPO
 * (governed mode) or runs without authorization (local-demo) and attaches a
 * `governance` object to every response, including refusals.
 */

export const UI_AGENT_ID = 'computless-ui';
export const DEFAULT_DIRECTIVE = 'ALLOW_WITH_AUDIT';

// ── Shared directive store (one value across all tabs) ──────────────────────
let currentDirective = DEFAULT_DIRECTIVE;
const listeners = new Set<() => void>();

export function getDirective(): string {
  return currentDirective;
}

export function setDirective(v: string): void {
  currentDirective = v;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDirective(): [string, (v: string) => void] {
  const v = useSyncExternalStore(subscribe, getDirective, getDirective);
  return [v, setDirective];
}

/** Add agentId + caller-declared directive to an execute request body. */
export function withGovernance<T extends Record<string, unknown>>(body: T): T & { agentId: string; directive?: string } {
  const d = getDirective().trim();
  return { ...body, agentId: UI_AGENT_ID, ...(d ? { directive: d } : {}) };
}

export interface ExecuteResponse {
  ok: boolean;
  status: number;
  /** true for application/problem+json refusals (403/503). */
  problem: boolean;
  data: any;
}

/** POST to an execute endpoint with governance fields; never throws on HTTP errors. */
export async function postExecute(url: string, body: Record<string, unknown>): Promise<ExecuteResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withGovernance(body)),
  });
  const ctype = res.headers.get('content-type') || '';
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, problem: ctype.includes('problem+json'), data };
}

// ── Directive control ────────────────────────────────────────────────────────

export const DirectiveControl: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [directive, setD] = useDirective();
  return (
    <div className={`flex ${compact ? 'flex-row items-center gap-2' : 'flex-col gap-1'} text-[11px] font-mono`}>
      <label className="text-slate-400" htmlFor="cappo-directive">
        CAPPO directive (declared by you, evaluated by CAPPO)
      </label>
      <div className="flex items-center gap-2">
        <input
          id="cappo-directive"
          list="cappo-directive-options"
          value={directive}
          onChange={(e) => setD(e.target.value)}
          placeholder="(none — CAPPO will ask for approval)"
          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 w-52 focus:outline-none focus:border-indigo-500"
        />
        <datalist id="cappo-directive-options">
          <option value="ALLOW_WITH_AUDIT" />
          <option value="ALLOW" />
          <option value="DENY" />
        </datalist>
        <span className="text-slate-500">agentId: {UI_AGENT_ID}</span>
      </div>
    </div>
  );
};

// ── Governance block ─────────────────────────────────────────────────────────

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-3">
    <span className="text-slate-500 shrink-0">{k}</span>
    <span className="text-slate-200 text-right break-all">{v ?? <span className="text-slate-500">—</span>}</span>
  </div>
);

/**
 * Renders the server's governance object. `status` is the HTTP status of the
 * execute response; 403/503 refusals are correct behaviour, not errors.
 */
export const GovernanceBlock: React.FC<{ governance: any; status?: number; problem?: any }> = ({ governance, status, problem }) => {
  if (!governance || typeof governance !== 'object') {
    return (
      <div className="p-3 rounded-lg border border-slate-700 bg-slate-950 text-[11px] font-mono text-slate-400">
        No governance block in this response (the server did not report how it was authorized).
      </div>
    );
  }
  const mode: string = governance.mode ?? 'unknown';
  const auth = governance.authorization ?? null;
  const evidence = governance.evidence ?? null;
  const refused = status === 403 || status === 503;

  let header: React.ReactNode;
  let tone = 'border-slate-700 bg-slate-950';
  if (refused) {
    tone = 'border-rose-500/30 bg-rose-950/10';
    header = (
      <div className="flex items-center gap-2 text-rose-300 font-bold">
        <ShieldX className="h-4 w-4" />
        <span>
          Refused before running (HTTP {status}) — fail-closed, nothing executed. This is correct behaviour.
        </span>
      </div>
    );
  } else if (typeof status === 'number' && status >= 400) {
    tone = 'border-rose-500/30 bg-rose-950/10';
    header = (
      <div className="flex items-center gap-2 text-rose-300 font-bold">
        <ShieldX className="h-4 w-4" />
        <span>
          Request failed (HTTP {status}){mode === 'local-demo' ? ' — local demo, no authorization was asked' : ''}.
        </span>
      </div>
    );
  } else if (mode === 'local-demo') {
    tone = 'border-amber-500/30 bg-amber-950/10';
    header = (
      <div className="flex items-center gap-2 text-amber-300 font-bold">
        <ShieldAlert className="h-4 w-4" />
        <span>Ran WITHOUT authorization — local demo. Not proof of anything.</span>
      </div>
    );
  } else if (mode === 'governed' && auth?.decision === 'APPROVED') {
    tone = 'border-emerald-500/30 bg-emerald-950/10';
    header = (
      <div className="flex items-center gap-2 text-emerald-300 font-bold">
        <ShieldCheck className="h-4 w-4" />
        <span>CAPPO approved this run before it executed.</span>
      </div>
    );
  } else {
    header = (
      <div className="flex items-center gap-2 text-slate-300 font-bold">
        <ShieldAlert className="h-4 w-4" />
        <span>Execution mode: {mode}</span>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-lg border ${tone} text-[11px] font-mono space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        {header}
        <EvidenceBadge label={governance.evidenceLabel} fallback={mode === 'governed' ? 'UNVERIFIED' : 'DEMO'} />
      </div>
      {problem?.detail && (
        <div className="text-slate-300">
          <span className="text-slate-500">Reason: </span>
          {String(problem.detail)}
        </div>
      )}
      {governance.note && <div className="text-slate-400 leading-relaxed">{String(governance.note)}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 p-2 rounded bg-slate-900/70 border border-slate-800">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Authorization (CAPPO)</div>
          {auth ? (
            <>
              <Row k="source" v={auth.source === 'cappo' ? 'CAPPO' : 'COMPUTLESS fail-closed (CAPPO not reached)'} />
              <Row
                k="decision"
                v={
                  <span
                    className={
                      auth.decision === 'APPROVED'
                        ? 'text-emerald-300'
                        : auth.decision === 'NEEDS_APPROVAL'
                          ? 'text-amber-300'
                          : 'text-rose-300'
                    }
                  >
                    {auth.decision ?? 'unknown'}
                  </span>
                }
              />
              <Row k="reason" v={auth.reason || null} />
              <Row k="authorization id" v={auth.authorizationId} />
              <Row k="decision hash" v={auth.decisionHash} />
              <Row k="lane" v={auth.lane} />
              <Row k="checked at" v={auth.checkedAt} />
            </>
          ) : (
            <div className="text-slate-400">
              {mode === 'local-demo'
                ? 'none — CAPPO was not asked (local-demo mode).'
                : mode === 'disabled'
                  ? 'none — execution is disabled on this server.'
                  : 'none reported.'}
            </div>
          )}
        </div>

        <div className="space-y-1 p-2 rounded bg-slate-900/70 border border-slate-800">
          <div className="text-slate-400 font-bold uppercase text-[10px] flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> Evidence (Gnomledger)
          </div>
          {evidence ? (
            evidence.recorded ? (
              <>
                <Row k="recorded" v={<span className="text-emerald-300">yes</span>} />
                <Row k="event id" v={evidence.eventId} />
                <Row k="event hash" v={evidence.eventHash} />
                <Row k="prev event hash" v={evidence.prevEventHash} />
                <Row k="created at" v={evidence.createdAt} />
              </>
            ) : (
              <>
                <Row k="recorded" v={<span className="text-slate-300">no</span>} />
                <Row k="reason" v={evidence.reason} />
              </>
            )
          ) : (
            <div className="text-slate-400">
              {refused ? 'none — nothing ran, so nothing was recorded.' : 'none — evidence is only recorded in governed mode.'}
            </div>
          )}
        </div>
      </div>

      {governance.sandbox && (
        <div className="text-slate-500 leading-relaxed">
          Sandbox: {String(governance.sandbox.kind ?? 'unknown')}; env inherited: {String(governance.sandbox.envInherited)}; filesystem:{' '}
          {String(governance.sandbox.filesystem)}; child processes: {String(governance.sandbox.childProcesses)}; network:{' '}
          <span className="text-amber-300">{String(governance.sandbox.network)}</span>; cgroups: {String(governance.sandbox.cgroups)}; hardware
          isolation: {String(governance.sandbox.hardwareIsolation)}
        </div>
      )}
    </div>
  );
};

/** For non-2xx responses: problem+json title/detail, or a generic error. */
export function problemSummary(r: ExecuteResponse): string {
  const d = r.data ?? {};
  if (d.title || d.detail) return [d.title, d.detail].filter(Boolean).join(': ');
  if (d.error) return String(d.error);
  return `HTTP ${r.status}`;
}
