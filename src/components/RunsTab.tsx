import React from 'react';
import { History } from 'lucide-react';
import type { ExecutionsResponse } from '../ui/types';
import { usePolled, fmtTime, fmtMs } from '../ui/api';
import { Card, TabHeader, ErrorBox, SourceTag, Th } from './common';

export const RunsTab: React.FC<{ onOpenEvent: (id: string) => void }> = ({ onOpenEvent }) => {
  const q = usePolled<ExecutionsResponse>('/api/executions');
  const entries = Array.isArray(q.data?.entries) ? q.data!.entries! : [];

  return (
    <div className="space-y-6">
      <TabHeader
        title="Runs handled by this server"
        endpoint="GET /api/executions"
        source="computless"
        polling
        fetchedAt={q.lastFetchedAt}
        loading={q.loading}
        onRefresh={q.refresh}
        description="One row per request this COMPUTLESS server handled on a code-executing route, whether it ran or was refused. The CAPPO decision and Gnomledger event id are the values those services returned for that request."
      />
      {q.error && <ErrorBox title="Could not reach this COMPUTLESS server">{q.error}</ErrorBox>}
      {q.data && q.data.persisted === false && (
        <ErrorBox title="Run log is not being saved to disk">
          The server could not write data/executions.json; this list is held in memory and will be lost when the server restarts.
        </ErrorBox>
      )}
      {q.data && (
        <Card
          title={`Run log (${entries.length})`}
          icon={<History className="h-4 w-4 text-indigo-400" />}
          right={<SourceTag source="computless" endpoint="data/executions.json" fetchedAt={q.lastFetchedAt} />}
        >
          {entries.length === 0 ? (
            <p className="text-sm font-mono text-slate-400" data-empty="runs">
              No runs yet on this server.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <Th>time</Th>
                    <Th>route / capability</Th>
                    <Th>outcome</Th>
                    <Th>HTTP</Th>
                    <Th>CAPPO decision</Th>
                    <Th>authorization id</Th>
                    <Th>Gnomledger event</Th>
                    <Th>duration</Th>
                    <Th>workload status</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.id ?? i} className="border-b border-slate-800/60 align-top" data-run-row={e.id} data-outcome={e.outcome}>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-300">{fmtTime(e.at)}</td>
                      <td className="py-1.5 pr-4">
                        <div className="text-slate-200 whitespace-nowrap">{e.route ?? '—'}</div>
                        <div className="text-[10px] text-slate-500">{e.capabilityId ?? ''}</div>
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        <span className={e.outcome === 'ran' ? 'text-emerald-300' : e.outcome === 'refused' ? 'text-rose-300' : 'text-slate-300'}>
                          {e.outcome ?? '—'}
                        </span>
                        {e.mode && <div className="text-[10px] text-slate-500">{e.mode}</div>}
                      </td>
                      <td className="py-1.5 pr-4 text-slate-300">{e.httpStatus ?? '—'}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        <span
                          className={
                            e.cappoDecision === 'APPROVED'
                              ? 'text-emerald-300'
                              : e.cappoDecision
                                ? 'text-rose-300'
                                : 'text-slate-500'
                          }
                        >
                          {e.cappoDecision ?? 'none'}
                        </span>
                        {e.cappoSource && e.cappoSource !== 'cappo' && <div className="text-[10px] text-slate-500">source: {e.cappoSource}</div>}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400">{e.cappoAuthorizationId ?? '—'}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {e.pglEventId ? (
                          <button onClick={() => onOpenEvent(e.pglEventId!)} className="text-indigo-300 hover:text-indigo-200 underline cursor-pointer">
                            {e.pglEventId}
                          </button>
                        ) : (
                          <span className="text-slate-500">{e.pglRecorded === false ? 'not recorded' : 'none'}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400">{fmtMs(e.durationMs)}</td>
                      <td className="py-1.5 whitespace-nowrap text-slate-300">{e.workloadStatus ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-500">Duration is the whole request on this server, including the CAPPO and Gnomledger calls.</p>
        </Card>
      )}
    </div>
  );
};
