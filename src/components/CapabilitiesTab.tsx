import React from 'react';
import { Package, ListTree, KeyRound } from 'lucide-react';
import type { Envelope, RegistryData } from '../ui/types';
import { usePolled } from '../ui/api';
import { Card, TabHeader, ErrorBox, EnvelopeError, SourceTag, Th, JsonBlock } from './common';
import type { FabricStatusState } from './FabricStatus';

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return null;
}

/** CAPPO's package shape is not fixed here: show the common identifying fields, then the full record. */
const CappoPackage: React.FC<{ pkg: unknown; index: number }> = ({ pkg, index }) => {
  const o = pkg && typeof pkg === 'object' ? (pkg as Record<string, unknown>) : {};
  const id = pick(o, ['package_id', 'packageId', 'id', 'capability_id', 'name']) ?? `package #${index + 1}`;
  const version = pick(o, ['version', 'package_version']);
  return (
    <details className="bg-slate-950/60 border border-slate-800 rounded-lg p-3" data-cappo-package={id}>
      <summary className="cursor-pointer text-xs font-mono text-slate-200">
        {id}
        {version && <span className="text-slate-500"> · v{version}</span>}
      </summary>
      <div className="mt-2">
        <JsonBlock value={pkg} maxHeight="max-h-72" />
      </div>
    </details>
  );
};

export const CapabilitiesTab: React.FC<{ fabric: FabricStatusState }> = ({ fabric }) => {
  const pk = usePolled<Envelope<unknown[]>>('/api/fabric/capabilities');
  const sv = usePolled<Envelope<RegistryData>>('/api/fabric/services');
  const pkEnv = pk.data;
  const packages = Array.isArray(pkEnv?.data) ? pkEnv!.data! : [];
  const services = Array.isArray(sv.data?.data?.services) ? sv.data!.data!.services! : [];
  const ownIds = fabric.data?.registration?.executableCapabilityIds;

  return (
    <div className="space-y-6">
      <TabHeader
        title="Capabilities"
        endpoint="GET /api/fabric/capabilities"
        source="cappo"
        polling
        fetchedAt={pk.lastFetchedAt}
        loading={pk.loading || sv.loading}
        onRefresh={() => {
          pk.refresh();
          sv.refresh();
        }}
        description="Capability packages loaded in CAPPO, and the capabilities each service registered with cAPI."
      />

      <Card
        title="CAPPO capability packages"
        icon={<Package className="h-4 w-4 text-indigo-400" />}
        right={pkEnv ? <SourceTag source="cappo" endpoint="CAPPO /v1/capability/packages" fetchedAt={pkEnv.fetchedAt} /> : null}
      >
        {pk.error && <ErrorBox title="Could not reach this COMPUTLESS server">{pk.error}</ErrorBox>}
        {pkEnv && <EnvelopeError env={pkEnv} />}
        {!pkEnv && !pk.error && <p className="text-xs font-mono text-slate-400">Loading…</p>}
        {pkEnv?.ok && packages.length === 0 && (
          <p className="text-sm font-mono text-slate-300" data-empty="cappo-packages">
            CAPPO has no capability packages loaded.
          </p>
        )}
        {pkEnv?.ok && packages.length > 0 && (
          <div className="space-y-2">
            {packages.map((p, i) => (
              <CappoPackage key={i} pkg={p} index={i} />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Executable capability ids issued to this server"
        icon={<KeyRound className="h-4 w-4 text-emerald-400" />}
        right={<SourceTag source="capi" endpoint="cAPI registration response (via /api/fabric/status)" fetchedAt={fabric.lastFetchedAt} />}
      >
        {fabric.error && !fabric.data ? (
          <ErrorBox title="Fabric status unavailable">{fabric.error}</ErrorBox>
        ) : !fabric.data ? (
          <p className="text-xs font-mono text-slate-400">Loading…</p>
        ) : fabric.data.registration?.state === 'unconfigured' ? (
          <p className="text-xs font-mono text-slate-400">CAPI_BACKEND_URL is not set; this server has not registered with cAPI.</p>
        ) : Array.isArray(ownIds) && ownIds.length > 0 ? (
          <ul className="space-y-1 text-xs font-mono text-slate-200">
            {ownIds.map((id) => (
              <li key={id} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 w-fit">
                {id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs font-mono text-slate-400">
            cAPI returned no executable capability ids for this server (registration state: {fabric.data.registration?.state ?? 'not reported'}).
          </p>
        )}
      </Card>

      <Card
        title="Capabilities registered in cAPI, per service"
        icon={<ListTree className="h-4 w-4 text-sky-400" />}
        right={sv.data ? <SourceTag source="capi" endpoint="cAPI /api/v1/registry/services" fetchedAt={sv.data.fetchedAt} /> : null}
      >
        {sv.error && <ErrorBox title="Could not reach this COMPUTLESS server">{sv.error}</ErrorBox>}
        {sv.data && <EnvelopeError env={sv.data} />}
        {sv.data?.ok && services.length === 0 && <p className="text-xs font-mono text-slate-500">No service is registered in cAPI.</p>}
        {sv.data?.ok && services.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <Th>service</Th>
                  <Th>capability</Th>
                  <Th>risk</Th>
                  <Th>requires approval</Th>
                  <Th>endpoint</Th>
                </tr>
              </thead>
              <tbody>
                {services.flatMap((s, si) => {
                  const caps = Array.isArray(s.capabilities) ? s.capabilities : [];
                  if (caps.length === 0)
                    return [
                      <tr key={`${si}-none`} className="border-b border-slate-800/60">
                        <td className="py-1.5 pr-4 text-slate-200">{s.service_name}</td>
                        <td colSpan={4} className="py-1.5 text-slate-500">
                          none registered
                        </td>
                      </tr>,
                    ];
                  return caps.map((c, ci) => (
                    <tr key={`${si}-${ci}`} className="border-b border-slate-800/60 align-top">
                      <td className="py-1.5 pr-4 text-slate-200 whitespace-nowrap">{ci === 0 ? s.service_name : ''}</td>
                      <td className="py-1.5 pr-4 text-slate-100 whitespace-nowrap">{c.name ?? '—'}</td>
                      <td className={`py-1.5 pr-4 whitespace-nowrap ${c.risk_level === 'high' ? 'text-amber-300' : 'text-slate-400'}`}>
                        {c.risk_level ?? <span className="text-slate-500">not registered</span>}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-400">
                        {typeof c.requires_approval === 'boolean' ? (c.requires_approval ? 'yes' : 'no') : <span className="text-slate-500">not registered</span>}
                      </td>
                      <td className="py-1.5 text-slate-500 break-all">{c.endpoint ?? 'not registered'}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
