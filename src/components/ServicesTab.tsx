import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import type { Envelope, RegistryData, RegistryService } from '../ui/types';
import { usePolled, fmtTime } from '../ui/api';
import { Card, TabHeader, ErrorBox, EnvelopeError, SourceTag, Th, JsonBlock } from './common';

const Bool: React.FC<{ v: unknown; good?: boolean }> = ({ v, good = true }) => {
  if (typeof v !== 'boolean') return <span className="text-slate-500">not reported</span>;
  const positive = v === good;
  return <span className={positive ? 'text-emerald-300' : 'text-amber-300'}>{v ? 'yes' : 'no'}</span>;
};

const ServiceRow: React.FC<{ s: RegistryService }> = ({ s }) => {
  const [open, setOpen] = useState(false);
  const caps = Array.isArray(s.capabilities) ? s.capabilities : [];
  return (
    <>
      <tr
        className="border-b border-slate-800/60 hover:bg-slate-800/30 cursor-pointer align-top"
        onClick={() => setOpen((o) => !o)}
        data-service={s.service_name}
      >
        <td className="py-2 pr-4 text-slate-100 whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {s.service_name ?? '(unnamed)'}
          </span>
          {s.base_url && <div className="text-[10px] text-slate-500 pl-5 break-all">{s.base_url}</div>}
        </td>
        <td className="py-2 pr-4">
          <Bool v={s.authenticated} />
        </td>
        <td className="py-2 pr-4 whitespace-nowrap text-slate-300">{fmtTime(s.registered_at)}</td>
        <td className="py-2 pr-4 whitespace-nowrap text-slate-300">{fmtTime(s.last_seen)}</td>
        <td className="py-2 pr-4 whitespace-nowrap text-slate-300">{fmtTime(s.expires_at)}</td>
        <td className="py-2 pr-4">
          <Bool v={s.stale} good={false} />
        </td>
        <td className="py-2 pr-4 text-slate-200">{caps.length}</td>
        <td className="py-2">
          <Bool v={s.telemetry_supported} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-800/60 bg-slate-950/50">
          <td colSpan={8} className="p-3 space-y-3">
            {caps.length === 0 ? (
              <p className="text-slate-500">This service registered no capabilities.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-slate-500">
                    <Th>capability</Th>
                    <Th>endpoint</Th>
                    <Th>risk</Th>
                    <Th>requires approval</Th>
                    <Th>description</Th>
                  </tr>
                </thead>
                <tbody>
                  {caps.map((c, i) => (
                    <tr key={`${c.name}-${i}`} className="border-t border-slate-800/60 align-top">
                      <td className="py-1.5 pr-4 text-slate-200 whitespace-nowrap">{c.name ?? '—'}</td>
                      <td className="py-1.5 pr-4 text-slate-400 break-all">{c.endpoint ?? 'not registered'}</td>
                      <td
                        className={`py-1.5 pr-4 whitespace-nowrap ${
                          c.risk_level === 'high' ? 'text-amber-300' : c.risk_level ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {c.risk_level ?? 'not registered'}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {typeof c.requires_approval === 'boolean' ? (c.requires_approval ? 'yes' : 'no') : <span className="text-slate-500">not registered</span>}
                      </td>
                      <td className="py-1.5 text-slate-400">{c.description ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.metadata && Object.keys(s.metadata).length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-slate-500 mb-1">metadata</div>
                <JsonBlock value={s.metadata} maxHeight="max-h-48" />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

export const ServicesTab: React.FC = () => {
  const q = usePolled<Envelope<RegistryData>>('/api/fabric/services');
  const env = q.data;
  const services = Array.isArray(env?.data?.services) ? env!.data!.services! : [];

  return (
    <div className="space-y-6">
      <TabHeader
        title="Services on the fabric"
        endpoint="GET /api/fabric/services"
        source="capi"
        polling
        fetchedAt={q.lastFetchedAt}
        loading={q.loading}
        onRefresh={q.refresh}
        description="The cAPI registry: every service that has registered with cAPI, as cAPI returns it. Click a row to see the capabilities that service registered."
      />
      {q.error && <ErrorBox title="Could not reach this COMPUTLESS server">{q.error}</ErrorBox>}
      {env && <EnvelopeError env={env} />}
      {env?.ok && (
        <Card
          title={`cAPI registry — ${env.data?.count ?? services.length} services`}
          icon={<Network className="h-4 w-4 text-sky-400" />}
          right={<SourceTag source="capi" endpoint="cAPI /api/v1/registry/services" fetchedAt={env.fetchedAt} />}
        >
          {services.length === 0 ? (
            <p className="text-xs font-mono text-slate-500">cAPI returned an empty registry: no service is registered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <Th>service</Th>
                    <Th>authenticated</Th>
                    <Th>registered at</Th>
                    <Th>last seen</Th>
                    <Th>expires at</Th>
                    <Th>stale</Th>
                    <Th>capabilities</Th>
                    <Th>telemetry</Th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((s, i) => (
                    <ServiceRow key={`${s.service_name}-${i}`} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-500">
            "authenticated" and "stale" are cAPI's own fields. A registration expires unless the service renews it.
          </p>
        </Card>
      )}
    </div>
  );
};
