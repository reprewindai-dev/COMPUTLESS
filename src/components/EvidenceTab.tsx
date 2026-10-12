import React, { useEffect, useState } from 'react';
import { BookOpen, ShieldCheck, X } from 'lucide-react';
import type { Envelope, LedgerEvent, LedgerResponse } from '../ui/types';
import { usePolled, getJson, fmtTime, shortHash } from '../ui/api';
import { Card, TabHeader, ErrorBox, EnvelopeError, SourceTag, KV, Th, JsonBlock, StateChip } from './common';

const EventDetail: React.FC<{ eventId: string; onClose: () => void }> = ({ eventId, onClose }) => {
  const [env, setEnv] = useState<Envelope<LedgerEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEnv(null);
    setError(null);
    getJson<Envelope<LedgerEvent>>(`/api/fabric/ledger/events/${encodeURIComponent(eventId)}`)
      .then((r) => !cancelled && setEnv(r))
      .catch((e) => !cancelled && setError(e?.message ?? 'request failed'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <Card
      title={`Event ${eventId}`}
      icon={<BookOpen className="h-4 w-4 text-emerald-400" />}
      right={
        <span className="flex items-center gap-2">
          {env && <SourceTag source="pgl" endpoint={`GET /api/fabric/ledger/events/${eventId}`} fetchedAt={env.fetchedAt} />}
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 cursor-pointer" title="Close">
            <X className="h-4 w-4" />
          </button>
        </span>
      }
      className="border-indigo-500/40"
    >
      <div data-event-detail={eventId}>
        {loading && <p className="text-xs font-mono text-slate-400">Fetching from Gnomledger…</p>}
        {error && <ErrorBox title="Could not reach this COMPUTLESS server">{error}</ErrorBox>}
        {env && <EnvelopeError env={env} />}
        {env?.ok && env.data && <JsonBlock value={env.data} maxHeight="max-h-[32rem]" />}
      </div>
    </Card>
  );
};

export const EvidenceTab: React.FC<{ selectedEventId: string | null; onSelectEvent: (id: string | null) => void }> = ({
  selectedEventId,
  onSelectEvent,
}) => {
  const q = usePolled<LedgerResponse>('/api/fabric/ledger');
  const ev = q.data?.events;
  const ver = q.data?.verification;
  const events = Array.isArray(ev?.data) ? [...ev!.data!] : [];
  events.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const v = ver?.ok ? ver.data ?? null : null;
  const envVar = q.data && !q.data.agentId ? 'PGL_AGENT_ID' : undefined;

  return (
    <div className="space-y-6">
      <TabHeader
        title="Evidence in Gnomledger"
        endpoint="GET /api/fabric/ledger"
        source="pgl"
        polling
        fetchedAt={q.lastFetchedAt}
        loading={q.loading}
        onRefresh={q.refresh}
        description={
          <>
            The hash-chained events Gnomledger holds for this server's agent, and Gnomledger's own verification of that chain.
            Agent id:{' '}
            <span className="font-mono text-slate-100" data-agent-id>
              {q.data ? q.data.agentId ?? 'not configured (PGL_AGENT_ID is not set)' : '…'}
            </span>
          </>
        }
      />
      {q.error && <ErrorBox title="Could not reach this COMPUTLESS server">{q.error}</ErrorBox>}

      {selectedEventId && <EventDetail eventId={selectedEventId} onClose={() => onSelectEvent(null)} />}

      <Card
        title="Chain verification"
        icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
        right={ver ? <SourceTag source="pgl" endpoint="Gnomledger /api/v1/ledger/agents/:id/verify" fetchedAt={ver.fetchedAt} /> : null}
      >
        {ver && <EnvelopeError env={ver} envVar={envVar} />}
        {!q.data && !q.error && <p className="text-xs font-mono text-slate-400">Loading…</p>}
        {v && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5" data-verification={String(v.valid)}>
            <KV k="status" v={<StateChip state={v.valid === false ? 'invalid' : v.status} text={v.status ?? 'not reported'} />} />
            <KV k="valid" v={typeof v.valid === 'boolean' ? <span className={v.valid ? 'text-emerald-300' : 'text-rose-300'}>{v.valid ? 'true' : 'false'}</span> : 'not reported'} />
            <KV k="checked events" v={v.checked_events ?? 'not reported'} />
            <KV k="latest event hash" v={v.latest_event_hash ?? '—'} />
            <KV k="first event at" v={fmtTime(v.first_event_at)} />
            <KV k="last event at" v={fmtTime(v.last_event_at)} />
            <KV k="reason" v={v.reason ?? '—'} />
            <KV k="errors" v={Array.isArray(v.errors) && v.errors.length ? <span className="text-rose-300">{JSON.stringify(v.errors)}</span> : 'none'} />
          </div>
        )}
      </Card>

      <Card
        title={`Events${ev?.ok ? ` (${events.length})` : ''}`}
        icon={<BookOpen className="h-4 w-4 text-sky-400" />}
        right={ev ? <SourceTag source="pgl" endpoint="Gnomledger /api/v1/ledger/agents/:id" fetchedAt={ev.fetchedAt} /> : null}
      >
        {ev && <EnvelopeError env={ev} envVar={envVar} />}
        {ev?.ok && events.length === 0 && <p className="text-xs font-mono text-slate-500">Gnomledger holds no events for this agent yet.</p>}
        {ev?.ok && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <Th>created at</Th>
                  <Th>type</Th>
                  <Th>actor</Th>
                  <Th>summary</Th>
                  <Th>event id</Th>
                  <Th>hash</Th>
                  <Th>prev hash</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr
                    key={e.event_id ?? i}
                    onClick={() => e.event_id && onSelectEvent(e.event_id)}
                    data-event-row={e.event_id}
                    className={`border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/40 align-top ${
                      selectedEventId === e.event_id ? 'bg-indigo-500/10' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-4 whitespace-nowrap text-slate-300">{fmtTime(e.created_at)}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap text-slate-200">{e.event_type ?? '—'}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400">{e.actor ?? '—'}</td>
                    <td className="py-1.5 pr-4 text-slate-300 min-w-[14rem]">{e.summary ?? '—'}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap text-indigo-300">{e.event_id ?? '—'}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400" title={e.event_hash ?? ''}>
                      {shortHash(e.event_hash)}
                    </td>
                    <td className="py-1.5 whitespace-nowrap text-slate-500" title={e.prev_event_hash ?? ''}>
                      {e.prev_event_hash ? shortHash(e.prev_event_hash) : 'none (first)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-slate-500">Click an event to fetch it from Gnomledger by id. Newest first.</p>
      </Card>
    </div>
  );
};
