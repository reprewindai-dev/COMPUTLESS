import React from 'react';
import { Network, ShieldCheck, Server, KeyRound, Box, Radio } from 'lucide-react';
import type { FabricStatusData, PeerReport, Envelope } from '../ui/types';
import { usePolled, fmtTime, SOURCE_NAME, PEER_ENV, type Polled } from '../ui/api';
import { Card, KV, StateChip, TabHeader, ErrorBox, EnvelopeError, SourceTag, stateText } from './common';
import { SandboxBoundary } from './Governance';

export type FabricStatusState = Polled<FabricStatusData>;

export function useFabricStatus(): FabricStatusState {
  return usePolled<FabricStatusData>('/api/fabric/status');
}

export const MODE_TEXT: Record<string, { explain: string; tone: string }> = {
  governed: {
    explain:
      'Every execute request is sent to CAPPO first. Only an APPROVED decision runs; a denial, "needs approval" or an unreachable CAPPO is refused (fail-closed). Each run that executes is appended to Gnomledger.',
    tone: 'text-emerald-300',
  },
  local: {
    explain: 'Code runs WITHOUT authorization: CAPPO is not asked and nothing is recorded to Gnomledger.',
    tone: 'text-amber-300',
  },
  disabled: {
    explain: 'Code execution is turned off. Every execute endpoint answers 503 and nothing runs.',
    tone: 'text-slate-300',
  },
};

const DEP_TITLES: Record<string, string> = {
  local_store: 'Local store (data/ directory)',
  capi: 'cAPI (registry)',
  cappo: 'CAPPO (authorization)',
  pgl: 'Gnomledger / PGL (evidence)',
  lockerphycer: 'Lockerphycer (identity)',
};

const CONFIG_LABELS: Record<string, string> = {
  capi: 'cAPI URL',
  capiApiKey: 'cAPI API key',
  cappo: 'CAPPO URL',
  cappoApiKey: 'CAPPO API key',
  pgl: 'Gnomledger URL',
  pglApiKey: 'Gnomledger API key',
  pglAgentId: 'Gnomledger agent id',
  lockerphycer: 'Lockerphycer URL',
};

// ── Peer self-reports ───────────────────────────────────────────────────────

interface DepRow {
  name: string;
  state?: string;
  extra: [string, string][];
}

/** Peers shape /health/dependencies differently: accept an array or a name→object map. */
function depRows(data: Record<string, unknown> | null | undefined): DepRow[] {
  const deps = data?.dependencies;
  const toRow = (name: string, v: unknown): DepRow => {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : { state: v };
    const extra = Object.entries(o)
      .filter(([k, val]) => k !== 'name' && k !== 'state' && val !== null && val !== undefined && typeof val !== 'object')
      .map(([k, val]) => [k, String(val)] as [string, string]);
    return { name, state: o.state !== undefined ? String(o.state) : undefined, extra };
  };
  if (Array.isArray(deps)) return deps.map((d, i) => toRow(String((d as any)?.name ?? `#${i + 1}`), d));
  if (deps && typeof deps === 'object') return Object.entries(deps as Record<string, unknown>).map(([k, v]) => toRow(k, v));
  return [];
}

function scalarFields(data: Record<string, unknown> | null | undefined, skip: string[]): [string, string][] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([k, v]) => !skip.includes(k) && v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => [k, String(v)]);
}

const PeerCard: React.FC<{ peer: PeerReport }> = ({ peer }) => {
  const name = String(peer.name ?? 'unknown');
  const health = peer.health as Envelope<Record<string, unknown>> | undefined;
  const deps = peer.dependencies as Envelope<Record<string, unknown>> | undefined;
  const hStatus = health?.ok ? String(health.data?.status ?? 'not reported') : undefined;
  const dStatus = deps?.ok ? String(deps.data?.status ?? 'not reported') : undefined;
  const rows = deps?.ok ? depRows(deps.data) : [];
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 space-y-3 min-w-0" data-peer={name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{SOURCE_NAME[name] ?? name}</span>
        <SourceTag source={name} fetchedAt={health?.fetchedAt ?? deps?.fetchedAt ?? null} />
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase font-mono text-slate-500">its /health</div>
        {health?.ok ? (
          <>
            <KV k="status" v={<StateChip state={hStatus} text={hStatus} />} />
            {scalarFields(health.data, ['status']).map(([k, v]) => (
              <KV key={k} k={k} v={k === 'timestamp' ? fmtTime(v) : v} />
            ))}
          </>
        ) : (
          <EnvelopeError env={health} envVar={PEER_ENV[name]} />
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase font-mono text-slate-500">its /health/dependencies</div>
        {deps?.ok ? (
          <>
            <KV k="overall (as it reports)" v={<StateChip state={dStatus} text={stateText(dStatus)} />} />
            {scalarFields(deps.data, ['status']).map(([k, v]) => (
              <KV key={k} k={k} v={v} />
            ))}
            {rows.length === 0 ? (
              <p className="text-[11px] font-mono text-slate-500">No dependency list in its report.</p>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="border-t border-slate-800/60 align-top">
                      <td className="py-1 pr-3 text-slate-300">{r.name}</td>
                      <td className="py-1 pr-3">
                        <StateChip state={r.state} />
                      </td>
                      <td className="py-1 text-slate-500 break-all">{r.extra.map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <EnvelopeError env={deps} envVar={PEER_ENV[name]} />
        )}
      </div>
    </div>
  );
};

const PeersSection: React.FC = () => {
  const peers = usePolled<PeerReport[]>('/api/fabric/peers');
  const list = Array.isArray(peers.data) ? peers.data : [];
  return (
    <Card
      title="What each peer reports about itself"
      icon={<Radio className="h-4 w-4 text-sky-400" />}
      right={<SourceTag source="each peer" endpoint="GET /api/fabric/peers" fetchedAt={peers.lastFetchedAt} />}
    >
      <p className="text-[11px] text-slate-400">
        Each Veklom service's own <span className="font-mono">/health</span> and{' '}
        <span className="font-mono">/health/dependencies</span>, fetched by this server and shown as returned. These are the
        peers' own claims about their dependencies.
      </p>
      {peers.error && <ErrorBox title="Could not load peer reports">{peers.error}</ErrorBox>}
      {!peers.data && !peers.error && <p className="text-xs font-mono text-slate-400">Loading…</p>}
      {peers.data && list.length === 0 && <p className="text-xs font-mono text-slate-500">The server returned no peers.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.map((p, i) => (
          <PeerCard key={`${p.name}-${i}`} peer={p} />
        ))}
      </div>
    </Card>
  );
};

// ── Panel ────────────────────────────────────────────────────────────────────

export const FabricStatusPanel: React.FC<{ fabric: FabricStatusState }> = ({ fabric }) => {
  const { data, error, loading, lastFetchedAt, refresh } = fabric;
  const mode = String(data?.executionMode ?? '');
  const modeInfo = MODE_TEXT[mode === 'local-demo' ? 'local' : mode];
  const reg = data?.registration ?? null;
  const deps = Array.isArray(data?.dependencies) ? data!.dependencies! : [];
  const configured = data?.configured ?? {};

  return (
    <div className="space-y-6">
      <TabHeader
        title="Veklom Fabric connection"
        endpoint="GET /api/fabric/status"
        source="computless"
        polling
        fetchedAt={lastFetchedAt}
        loading={loading}
        onRefresh={refresh}
        description={
          <>
            What this COMPUTLESS server is connected to, as the server observes it right now. A peer that answers is shown as
            "reachable (not verified)": an HTTP 2xx proves the host answered, not what code it runs.
          </>
        }
      />

      {error && (
        <ErrorBox title="COMPUTLESS API unreachable">
          {error}. {data ? 'Values below are from the last successful response and may be stale.' : 'No status available.'}
        </ErrorBox>
      )}

      {!data && !error && <div className="text-sm text-slate-400 font-mono">Loading fabric status…</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Execution mode" icon={<ShieldCheck className="h-4 w-4 text-indigo-400" />}>
              <div className={`text-2xl font-bold font-mono ${modeInfo?.tone ?? 'text-slate-300'}`}>{mode || 'not reported'}</div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {modeInfo?.explain ?? 'The server reported an execution mode this UI does not recognize.'}
              </p>
              <p className="text-[10px] text-slate-500">Server checked: {fmtTime(data.checkedAt)}</p>
            </Card>

            <Card
              title="cAPI registration"
              icon={<Network className="h-4 w-4 text-sky-400" />}
              right={<StateChip state={reg?.state} text={reg?.state ?? 'not reported'} />}
            >
              {reg?.state === 'unconfigured' ? (
                <p className="text-xs text-slate-400">
                  CAPI_BACKEND_URL is not set, so this server is not registered with cAPI and other services cannot discover it.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <KV k="registered at" v={fmtTime(reg?.registeredAt)} />
                  <KV k="last heartbeat" v={fmtTime(reg?.lastHeartbeatAt)} />
                  <KV k="expires" v={fmtTime(reg?.expiresAt)} />
                  <KV k="last attempt" v={fmtTime(reg?.lastAttemptAt)} />
                  <KV k="last HTTP status from cAPI" v={reg?.lastStatusCode ?? '—'} />
                  <KV k="last error" v={reg?.lastError ? <span className="text-rose-300">{reg.lastError}</span> : '—'} />
                  <KV
                    k="capability ids registered"
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
            title="Dependencies (as probed by this server)"
            icon={<Server className="h-4 w-4 text-emerald-400" />}
            right={
              <span className="text-xs font-mono text-slate-400 flex items-center gap-2">
                overall: <StateChip state={String(data.overall ?? '')} />
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="py-2 pr-4 font-normal">dependency</th>
                    <th className="py-2 pr-4 font-normal">state</th>
                    <th className="py-2 pr-4 font-normal">protocol identity</th>
                    <th className="py-2 pr-4 font-normal">verification scope</th>
                    <th className="py-2 font-normal">checked at</th>
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
                      <td className="py-2 pr-4 text-slate-200 whitespace-nowrap">{DEP_TITLES[d.name ?? ''] ?? d.name ?? '—'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <StateChip state={d.state} />
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
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
                      <td className="py-2 text-slate-400 whitespace-nowrap">{fmtTime(d.checked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500">
              Scope: {data.verification_scope ?? 'not reported'}. "matched" means the peer's /protocol.json names the expected
              service; it does not verify the peer's source commit or runtime.
            </p>
          </Card>

          <PeersSection />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Configuration" icon={<KeyRound className="h-4 w-4 text-blue-400" />}>
              <p className="text-[11px] text-slate-500">Whether each setting is present on the server. Values and secrets are never sent.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {Object.entries(configured).map(([key, on]) => (
                  <div key={key} className="flex justify-between gap-3 text-xs font-mono">
                    <span className="text-slate-400">{CONFIG_LABELS[key] ?? key}</span>
                    <span className={on ? 'text-blue-300' : 'text-slate-500'}>{on ? 'set' : 'not set'}</span>
                  </div>
                ))}
                {Object.keys(configured).length === 0 && (
                  <span className="text-xs font-mono text-slate-500">Not reported.</span>
                )}
              </div>
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <KV k="service" v={`${data.service ?? '—'} ${data.version ?? ''}`} />
                <KV k="source commit" v={data.sourceCommit || <span className="text-slate-500">not set</span>} />
                <KV k="public URL" v={data.publicBaseUrl || <span className="text-slate-500">not set</span>} />
              </div>
            </Card>

            <Card title="Sandbox boundary (as this server reports it)" icon={<Box className="h-4 w-4 text-amber-400" />}>
              <SandboxBoundary sandbox={data.sandbox} />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Workload code runs in a separate Node child process with an empty environment. Network access is not restricted
                at the OS level.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
