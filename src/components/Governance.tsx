import React from 'react';
import { ShieldAlert, ShieldCheck, ShieldX, BookOpen } from 'lucide-react';
import { EvidenceBadge } from './EvidenceBadge';
import type { Governance } from '../ui/types';
import { fmtTime } from '../ui/api';

/**
 * Renders the `governance` object the server attaches to every execute
 * response, including refusals. Nothing here is computed in the browser: the
 * decision is CAPPO's, the evidence is Gnomledger's, the sandbox boundary is
 * what this server reports about itself.
 */

/** 'local' runs without CAPPO; 'local-demo' is the older name for it. */
export const isLocalMode = (mode?: string) => mode === 'local' || mode === 'local-demo';

export const UI_AGENT_ID = 'computless-ui';
export const DEFAULT_DIRECTIVE = 'ALLOW_WITH_AUDIT';

export const DirectiveControl: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div className="flex flex-col gap-1 text-[11px] font-mono">
    <label className="text-slate-400" htmlFor="cappo-directive">
      CAPPO directive — declared by you, evaluated by CAPPO
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <input
        id="cappo-directive"
        list="cappo-directive-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="(none — CAPPO decides without a directive)"
        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 w-60 focus:outline-none focus:border-indigo-500"
      />
      <datalist id="cappo-directive-options">
        <option value="ALLOW_WITH_AUDIT" />
        <option value="ALLOW" />
        <option value="DENY" />
      </datalist>
      <span className="text-slate-500">
        agentId: <span className="text-slate-300">{UI_AGENT_ID}</span>
      </span>
    </div>
  </div>
);

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-3">
    <span className="text-slate-500 shrink-0">{k}</span>
    <span className="text-slate-200 text-right break-all">{v ?? <span className="text-slate-500">—</span>}</span>
  </div>
);

export const GovernanceBlock: React.FC<{
  governance: Governance | null | undefined;
  status?: number;
  problem?: { title?: string; detail?: string } | null;
  onOpenEvent?: (eventId: string) => void;
}> = ({ governance, status, problem, onOpenEvent }) => {
  if (!governance || typeof governance !== 'object') {
    return (
      <div className="p-3 rounded-lg border border-slate-700 bg-slate-950 text-[11px] font-mono text-slate-400">
        No governance block in this response (the server did not report how it was authorized).
      </div>
    );
  }
  const mode = governance.mode ?? 'unknown';
  const auth = governance.authorization ?? null;
  const evidence = governance.evidence ?? null;
  const refused = status === 403 || status === 503;

  let header: React.ReactNode;
  let tone = 'border-slate-700 bg-slate-950';
  if (refused) {
    tone = 'border-rose-500/30 bg-rose-950/10';
    header = (
      <div className="flex items-center gap-2 text-rose-300 font-bold">
        <ShieldX className="h-4 w-4 shrink-0" />
        <span>Refused before running (HTTP {status}) — fail-closed, nothing executed. This is the correct behaviour.</span>
      </div>
    );
  } else if (typeof status === 'number' && status >= 400) {
    tone = 'border-rose-500/30 bg-rose-950/10';
    header = (
      <div className="flex items-center gap-2 text-rose-300 font-bold">
        <ShieldX className="h-4 w-4 shrink-0" />
        <span>Request failed (HTTP {status}).</span>
      </div>
    );
  } else if (mode === 'governed' && auth?.decision === 'APPROVED') {
    tone = 'border-emerald-500/30 bg-emerald-950/10';
    header = (
      <div className="flex items-center gap-2 text-emerald-300 font-bold">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>CAPPO approved this run before it executed.</span>
      </div>
    );
  } else if (isLocalMode(mode)) {
    tone = 'border-amber-500/30 bg-amber-950/10';
    header = (
      <div className="flex items-center gap-2 text-amber-300 font-bold">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>Ran without authorization: this server is in {mode} mode, CAPPO was not asked.</span>
      </div>
    );
  } else {
    header = (
      <div className="flex items-center gap-2 text-slate-300 font-bold">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>Execution mode: {mode}</span>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-lg border ${tone} text-[11px] font-mono space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        {header}
        <EvidenceBadge label={governance.evidenceLabel} />
      </div>
      {problem?.detail && (
        <div className="text-slate-300">
          <span className="text-slate-500">Reason given: </span>
          {String(problem.detail)}
        </div>
      )}
      {governance.note && <div className="text-slate-400 leading-relaxed">{String(governance.note)}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 p-2 rounded bg-slate-900/70 border border-slate-800 min-w-0">
          <div className="text-slate-400 font-bold uppercase text-[10px]">Authorization — source: CAPPO</div>
          {auth ? (
            <>
              <Row k="answered by" v={auth.source === 'cappo' ? 'CAPPO' : `COMPUTLESS fail-closed (${auth.source ?? 'CAPPO not reached'})`} />
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
                    {auth.decision ?? 'not reported'}
                  </span>
                }
              />
              <Row k="reason" v={auth.reason || null} />
              <Row k="authorization id" v={auth.authorizationId} />
              <Row k="decision hash" v={auth.decisionHash} />
              <Row k="evidence hash" v={auth.evidenceHash} />
              <Row k="lane" v={auth.lane} />
              <Row k="checked at" v={auth.checkedAt ? fmtTime(auth.checkedAt) : null} />
            </>
          ) : (
            <div className="text-slate-400">
              {isLocalMode(mode)
                ? `None: CAPPO was not asked (${mode} mode).`
                : mode === 'disabled'
                  ? 'None: execution is disabled on this server.'
                  : 'None reported.'}
            </div>
          )}
        </div>

        <div className="space-y-1 p-2 rounded bg-slate-900/70 border border-slate-800 min-w-0">
          <div className="text-slate-400 font-bold uppercase text-[10px] flex items-center gap-1">
            <BookOpen className="h-3 w-3" /> Evidence — source: Gnomledger
          </div>
          {evidence ? (
            evidence.recorded ? (
              <>
                <Row k="recorded" v={<span className="text-emerald-300">yes ({evidence.ledger ?? 'ledger'})</span>} />
                <Row
                  k="event id"
                  v={
                    evidence.eventId && onOpenEvent ? (
                      <button
                        onClick={() => onOpenEvent(evidence.eventId!)}
                        className="text-indigo-300 hover:text-indigo-200 underline cursor-pointer"
                        data-evidence-link={evidence.eventId}
                      >
                        {evidence.eventId}
                      </button>
                    ) : (
                      evidence.eventId
                    )
                  }
                />
                <Row k="event hash" v={evidence.eventHash} />
                <Row k="prev event hash" v={evidence.prevEventHash} />
                <Row k="created at" v={evidence.createdAt ? fmtTime(evidence.createdAt) : null} />
              </>
            ) : (
              <>
                <Row k="recorded" v={<span className="text-rose-300">no</span>} />
                <Row k="reason" v={evidence.reason} />
              </>
            )
          ) : (
            <div className="text-slate-400">
              {refused ? 'None: nothing ran, so nothing was recorded.' : 'None reported by the server.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Sandbox boundary exactly as the server reports it; network is highlighted because it is NOT restricted. */
export const SandboxBoundary: React.FC<{ sandbox: Record<string, unknown> | null | undefined }> = ({ sandbox }) => {
  if (!sandbox || typeof sandbox !== 'object') {
    return <p className="text-xs text-slate-500 font-mono">Sandbox boundary not reported by the server.</p>;
  }
  return (
    <div className="space-y-1 text-[11px] font-mono">
      {Object.entries(sandbox).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <span className="text-slate-500 shrink-0">{k}</span>
          <span className={`text-right break-words ${k === 'network' ? 'text-amber-300 font-bold' : 'text-slate-200'}`}>
            {typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
};
