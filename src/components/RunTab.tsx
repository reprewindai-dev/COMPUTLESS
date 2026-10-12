import React, { useEffect, useMemo, useState } from 'react';
import { Play, Package, Terminal, Box, ShieldCheck } from 'lucide-react';
import type { Governance, VkgPackage } from '../ui/types';
import { usePolled, postJson, fmtBytes, fmtMs, fmtTime, type PostResult } from '../ui/api';
import { Card, TabHeader, ErrorBox, JsonBlock, KV, SourceTag } from './common';
import { DirectiveControl, GovernanceBlock, SandboxBoundary, UI_AGENT_ID, DEFAULT_DIRECTIVE } from './Governance';
import { EvidenceBadge } from './EvidenceBadge';

const DEFAULT_CODE = `// "input" is the JSON below; write results to "output".
output.result = input.n * 2;
console.log("doubled " + input.n);`;
const DEFAULT_INPUT = `{\n  "n": 21\n}`;

function parseJson(text: string): { value: unknown; error: string | null } {
  if (!text.trim()) return { value: {}, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e: any) {
    return { value: null, error: e?.message ?? 'invalid JSON' };
  }
}

const textareaCls =
  'w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 resize-y';

const Stdout: React.FC<{ value: unknown }> = ({ value }) => {
  const lines = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split('\n') : [];
  if (lines.length === 0 || (lines.length === 1 && lines[0] === ''))
    return <p className="text-[11px] font-mono text-slate-500">(no console output)</p>;
  return (
    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap break-all">
      {lines.join('\n')}
    </pre>
  );
};

/** Shown for both a refusal and a network/HTTP failure. */
const Refusal: React.FC<{ r: PostResult; onOpenEvent: (id: string) => void }> = ({ r, onOpenEvent }) => {
  if (r.networkError) return <ErrorBox title="Request did not reach the server">{r.networkError}</ErrorBox>;
  const d = r.data ?? {};
  return (
    <div className="space-y-3" data-result="refused">
      <div className="text-xs font-mono text-slate-300">
        HTTP {r.status}
        {d.title ? ` — ${d.title}` : ''}
        {!r.problem && d.error ? ` — ${String(d.error)}` : ''}
      </div>
      {d.governance ? (
        <GovernanceBlock governance={d.governance as Governance} status={r.status} problem={d} onOpenEvent={onOpenEvent} />
      ) : (
        <>
          {d.detail && <div className="text-xs font-mono text-rose-200">{String(d.detail)}</div>}
          {r.status === 400 && (
            <div className="text-[11px] font-mono text-slate-400">The server rejected the request body before asking CAPPO; nothing ran.</div>
          )}
          <JsonBlock value={d} maxHeight="max-h-60" />
        </>
      )}
    </div>
  );
};

// ── Sandbox workload ────────────────────────────────────────────────────────

const SandboxRunner: React.FC<{ directive: string; onOpenEvent: (id: string) => void }> = ({ directive, onOpenEvent }) => {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [timeoutMs, setTimeoutMs] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const parsed = parseJson(input);

  const run = async () => {
    if (parsed.error) return;
    setRunning(true);
    setResult(null);
    const body: Record<string, unknown> = { agentId: UI_AGENT_ID, code, inputPayload: parsed.value };
    if (directive.trim()) body.directive = directive.trim();
    const t = Number(timeoutMs);
    if (timeoutMs.trim() && Number.isFinite(t) && t > 0) body.timeoutMs = t;
    setSentAt(new Date().toISOString());
    setResult(await postJson('/api/substrate/sandbox/execute', body));
    setRunning(false);
  };

  const d = result?.ok ? result.data ?? {} : null;
  const gov: Governance | undefined = d?.governance;
  const status = d ? String(d.status ?? d.workloadStatus ?? (d.success === true ? 'SUCCESS' : d.success === false ? 'FAILED' : 'not reported')) : '';
  const output = d ? (d.outputData ?? d.output ?? d.result) : undefined;
  const memory = d ? (d.rssBytes ?? d.memoryUsageBytes ?? d.memoryBytes) : undefined;
  const duration = d ? (d.executionDurationMs ?? d.durationMs) : undefined;

  return (
    <Card
      title="Run a workload in the sandbox"
      icon={<Terminal className="h-4 w-4 text-indigo-400" />}
      right={<SourceTag source="computless" endpoint="POST /api/substrate/sandbox/execute" />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[11px] font-mono text-slate-400" htmlFor="workload-code">
            Workload code (JavaScript; reads <span className="text-slate-200">input</span>, writes{' '}
            <span className="text-slate-200">output</span>)
          </label>
          <textarea id="workload-code" value={code} onChange={(e) => setCode(e.target.value)} rows={10} spellCheck={false} className={textareaCls} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-mono text-slate-400" htmlFor="workload-input">
            Input JSON (inputPayload)
          </label>
          <textarea id="workload-input" value={input} onChange={(e) => setInput(e.target.value)} rows={6} spellCheck={false} className={textareaCls} />
          {parsed.error && <p className="text-[11px] font-mono text-rose-300">Input is not valid JSON: {parsed.error}</p>}
          <label className="text-[11px] font-mono text-slate-400 block pt-2" htmlFor="workload-timeout">
            timeoutMs (optional, 1–10000; server default if empty)
          </label>
          <input
            id="workload-timeout"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
            inputMode="numeric"
            placeholder="server default"
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 w-40 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <button
        onClick={run}
        disabled={running || Boolean(parsed.error)}
        data-action="run-sandbox"
        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        {running ? 'Asking CAPPO and running…' : 'Run workload'}
      </button>

      {result && (
        <div className="pt-3 border-t border-slate-800 space-y-3" data-result={result.ok ? 'ran' : 'refused'}>
          <div className="text-[10px] font-mono text-slate-500">sent {fmtTime(sentAt)} · HTTP {result.status || 'no response'}</div>
          {!result.ok ? (
            <Refusal r={result} onOpenEvent={onOpenEvent} />
          ) : (
            <>
              <GovernanceBlock governance={gov} status={result.status} onOpenEvent={onOpenEvent} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-bold">Sandbox result — source: this server</div>
                  <KV
                    k="status"
                    v={<span className={status === 'SUCCESS' ? 'text-emerald-300' : 'text-rose-300'} data-workload-status={status}>{status}</span>}
                  />
                  <KV k="execution id" v={d?.executionId} />
                  <KV k="duration (in sandbox)" v={fmtMs(duration)} />
                  <KV k="memory (child RSS)" v={fmtBytes(memory)} />
                  <KV k="timeout applied" v={fmtMs(d?.timeoutMs)} />
                  <KV k="finished at" v={d?.timestamp ? fmtTime(d.timestamp) : null} />
                  {d?.error && <KV k="error" v={<span className="text-rose-300">{String(d.error)}</span>} />}
                  <div className="text-[10px] uppercase font-mono text-slate-500 pt-1">output</div>
                  {output === undefined ? <p className="text-[11px] font-mono text-slate-500">(no output reported)</p> : <JsonBlock value={output} maxHeight="max-h-48" />}
                  <div className="text-[10px] uppercase font-mono text-slate-500 pt-1">stdout</div>
                  <Stdout value={d?.stdout} />
                </div>
                <div className="space-y-2 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-bold flex items-center gap-1">
                    <Box className="h-3 w-3" /> Sandbox boundary (as reported)
                  </div>
                  <SandboxBoundary sandbox={d?.sandbox ?? gov?.sandbox} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
};

// ── .vkg package ────────────────────────────────────────────────────────────

const VkgRunner: React.FC<{ directive: string; onOpenEvent: (id: string) => void }> = ({ directive, onOpenEvent }) => {
  const q = usePolled<{ packages?: VkgPackage[]; note?: string }>('/api/vkg/packages', 0);
  const packages = Array.isArray(q.data?.packages) ? q.data!.packages! : [];
  const [pkgId, setPkgId] = useState('');
  const [action, setAction] = useState('');
  const [input, setInput] = useState('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [validation, setValidation] = useState<PostResult | null>(null);
  const parsed = parseJson(input);

  const pkg = useMemo(() => packages.find((p) => p.manifest?.packageId === pkgId) ?? null, [packages, pkgId]);
  const actions = Array.isArray(pkg?.manifest?.allowedActions) ? pkg!.manifest!.allowedActions! : [];

  useEffect(() => {
    if (!pkgId && packages[0]?.manifest?.packageId) setPkgId(packages[0].manifest.packageId);
  }, [packages, pkgId]);
  useEffect(() => {
    if (actions.length && !actions.includes(action)) setAction(actions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkgId, actions.join('|')]);

  const run = async () => {
    if (!pkg || !action || parsed.error) return;
    setRunning(true);
    setResult(null);
    const body: Record<string, unknown> = { agentId: UI_AGENT_ID, packageId: pkgId, action, inputPayload: parsed.value };
    if (directive.trim()) body.directive = directive.trim();
    setResult(await postJson('/api/vkg/execute', body));
    setRunning(false);
  };

  const validate = async () => {
    if (!pkg) return;
    setValidation(null);
    const { digestValid: _a, evidenceLabel: _b, source: _c, uploadedAt: _d, computedDigest: _e, digestError: _f, ...raw } = pkg as Record<string, unknown>;
    setValidation(await postJson('/api/vkg/validate', raw));
  };

  // A 422 (digest mismatch / action not in manifest) still carries execResult + digestCheck.
  const hasExec = Boolean(result?.data && typeof result.data === 'object' && (result.data.execResult || result.data.result));
  const d = result && (result.ok || hasExec) ? result.data ?? {} : null;
  const ex = d ? (d.execResult ?? d.result ?? {}) : null;
  const gov: Governance | undefined = d?.governance;
  const exStatus = ex ? String(ex.status ?? 'not reported') : '';

  return (
    <Card
      title="Run a .vkg package"
      icon={<Package className="h-4 w-4 text-purple-400" />}
      right={<SourceTag source="computless" endpoint="GET /api/vkg/packages · POST /api/vkg/execute" fetchedAt={q.lastFetchedAt} />}
    >
      <p className="text-[11px] text-slate-400">
        Packages shipped in this repository. The server recomputes each package's content digest before running it; execution goes
        through the same CAPPO check and Gnomledger record as a sandbox workload.
      </p>
      {q.error && <ErrorBox title="Could not load .vkg packages">{q.error}</ErrorBox>}
      {q.data && packages.length === 0 && <p className="text-xs font-mono text-slate-500">The server has no .vkg packages installed.</p>}
      {packages.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-mono text-slate-400 block" htmlFor="vkg-package">
                Package
              </label>
              <select
                id="vkg-package"
                value={pkgId}
                onChange={(e) => {
                  setPkgId(e.target.value);
                  setResult(null);
                  setValidation(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200"
              >
                {packages.map((p) => (
                  <option key={p.manifest?.packageId} value={p.manifest?.packageId}>
                    {p.manifest?.packageId} — {p.manifest?.name}
                  </option>
                ))}
              </select>
              <label className="text-[11px] font-mono text-slate-400 block" htmlFor="vkg-action">
                Action
              </label>
              <select
                id="vkg-action"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200"
              >
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <label className="text-[11px] font-mono text-slate-400 block" htmlFor="vkg-input">
                Input JSON (inputPayload)
              </label>
              <textarea id="vkg-input" value={input} onChange={(e) => setInput(e.target.value)} rows={5} spellCheck={false} className={textareaCls} />
              {parsed.error && <p className="text-[11px] font-mono text-rose-300">Input is not valid JSON: {parsed.error}</p>}
            </div>
            <div className="space-y-2 min-w-0">
              {pkg && (
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5">
                  <KV k="name" v={pkg.manifest?.name} />
                  <KV k="version" v={pkg.manifest?.version} />
                  <KV k="author" v={pkg.manifest?.author} />
                  <KV k="source" v={pkg.source ? `${pkg.source}${pkg.uploadedAt ? ` (uploaded ${fmtTime(pkg.uploadedAt)})` : ''}` : null} />
                  <KV k="content digest" v={pkg.manifest?.contentDigest} />
                  <KV
                    k="digest check (at listing)"
                    v={
                      <span className="inline-flex items-center gap-1.5">
                        <span className={pkg.digestValid ? 'text-emerald-300' : 'text-rose-300'}>{pkg.digestValid ? 'valid' : pkg.digestValid === false ? 'INVALID' : 'not reported'}</span>
                        <EvidenceBadge label={pkg.evidenceLabel} />
                      </span>
                    }
                  />
                  {pkg.computedDigest && pkg.computedDigest !== pkg.manifest?.contentDigest && <KV k="computed digest" v={pkg.computedDigest} />}
                  {pkg.digestError && <KV k="digest error" v={<span className="text-rose-300">{pkg.digestError}</span>} />}
                  <KV k="timeout ceiling" v={fmtMs(pkg.manifest?.timeoutCeilingMs)} />
                  <KV k="memory ceiling" v={fmtBytes(pkg.manifest?.memoryCeilingBytes)} />
                  <button
                    onClick={validate}
                    className="mt-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-mono text-slate-200 cursor-pointer"
                  >
                    Re-check digest (POST /api/vkg/validate)
                  </button>
                  {validation && (
                    <div className="text-[11px] font-mono" data-vkg-validate>
                      {validation.ok ? (
                        <span className={validation.data?.valid ? 'text-emerald-300' : 'text-rose-300'}>
                          {validation.data?.valid ? 'digest matches' : `digest does not match${validation.data?.error ? `: ${validation.data.error}` : ''}`} · computed{' '}
                          {String(validation.data?.computedDigest ?? 'not reported')}
                          {validation.data?.expectedDigest !== undefined ? ` · expected ${String(validation.data.expectedDigest)}` : ''}
                          {typeof validation.data?.manifestMatch === 'boolean' ? ` · manifest match: ${validation.data.manifestMatch ? 'yes' : 'no'}` : ''}
                        </span>
                      ) : (
                        <span className="text-rose-300">HTTP {validation.status || 'no response'} {validation.networkError ?? ''}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {pkg?.actionHandlers?.[action] && (
                <div>
                  <div className="text-[10px] uppercase font-mono text-slate-500 mb-1">handler source for "{action}" (reads input.*)</div>
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-400 overflow-auto max-h-48 whitespace-pre">
                    {pkg.actionHandlers[action].replace(/^\n/, '').replace(/\s+$/, '')}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={run}
            disabled={running || !pkg || !action || Boolean(parsed.error)}
            data-action="run-vkg"
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {running ? 'Asking CAPPO and running…' : 'Run package action'}
          </button>
        </>
      )}

      {result && (
        <div className="pt-3 border-t border-slate-800 space-y-3" data-vkg-result={result.ok ? 'ran' : hasExec ? 'not-run' : 'refused'}>
          <div className="text-[10px] font-mono text-slate-500">
            HTTP {result.status || 'no response'}
            {d?.timestamp ? ` · ${fmtTime(d.timestamp)}` : ''}
            {d?.packageId ? ` · ${d.packageId}` : ''}
            {d?.action ? ` / ${d.action}` : ''}
            {d?.packageSource ? ` · package source: ${d.packageSource}` : ''}
          </div>
          {!d ? (
            <Refusal r={result} onOpenEvent={onOpenEvent} />
          ) : (
            <>
              <GovernanceBlock governance={gov} status={result.status} problem={result.ok ? null : d} onOpenEvent={onOpenEvent} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-bold">Package result — source: this server</div>
                  <KV k="status" v={<span className={exStatus === 'SUCCESS' ? 'text-emerald-300' : 'text-rose-300'} data-vkg-status={exStatus}>{exStatus}</span>} />
                  {typeof ex?.ran === 'boolean' && <KV k="code ran" v={ex.ran ? 'yes' : <span className="text-rose-300">no</span>} />}
                  <KV k="duration (in sandbox)" v={fmtMs(ex?.durationMs ?? ex?.executionDurationMs)} />
                  <KV k="memory (child RSS)" v={fmtBytes(ex?.rssBytes ?? ex?.memoryUsageBytes)} />
                  {ex?.limits && typeof ex.limits === 'object' && (
                    <KV
                      k="limits"
                      v={`timeout ${fmtMs(ex.limits.timeoutMs)} · heap ${typeof ex.limits.heapLimitMb === 'number' ? `${ex.limits.heapLimitMb} MB` : 'not reported'}`}
                    />
                  )}
                  {ex?.adapterType && <KV k="adapter" v={String(ex.adapterType)} />}
                  {ex?.error && <KV k="error" v={<span className="text-rose-300">{String(ex.error)}</span>} />}
                  <div className="text-[10px] uppercase font-mono text-slate-500 pt-1">output</div>
                  {ex?.outputData === undefined ? <p className="text-[11px] font-mono text-slate-500">(no output reported)</p> : <JsonBlock value={ex.outputData} maxHeight="max-h-48" />}
                  <div className="text-[10px] uppercase font-mono text-slate-500 pt-1">stdout</div>
                  <Stdout value={ex?.stdout} />
                  {Array.isArray(ex?.stderr) && ex.stderr.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase font-mono text-slate-500 pt-1">stderr</div>
                      <Stdout value={ex.stderr} />
                    </>
                  )}
                </div>
                <div className="space-y-2 p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-bold flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Digest check (before running)
                  </div>
                  {d?.digestCheck ? (
                    <>
                      <KV
                        k="valid"
                        v={
                          <span className="inline-flex items-center gap-1.5">
                            <span className={d.digestCheck.valid ? 'text-emerald-300' : 'text-rose-300'} data-digest-valid={String(d.digestCheck.valid)}>
                              {d.digestCheck.valid ? 'yes' : 'no'}
                            </span>
                            <EvidenceBadge label={d.digestCheck.evidenceLabel} />
                          </span>
                        }
                      />
                      <KV k="computed digest" v={d.digestCheck.computedDigest} />
                      <KV k="expected digest" v={d.digestCheck.expectedDigest} />
                    </>
                  ) : (
                    <p className="text-[11px] font-mono text-slate-500">Not reported.</p>
                  )}
                  <div className="text-[10px] uppercase font-mono text-slate-400 font-bold pt-2 flex items-center gap-1">
                    <Box className="h-3 w-3" /> Sandbox boundary (as reported)
                  </div>
                  <SandboxBoundary sandbox={ex?.sandboxBoundary ?? d?.sandbox ?? gov?.sandbox} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
};

export const RunTab: React.FC<{ onOpenEvent: (id: string) => void; executionMode?: string }> = ({ onOpenEvent, executionMode }) => {
  const [directive, setDirective] = useState(DEFAULT_DIRECTIVE);
  return (
    <div className="space-y-6">
      <TabHeader
        title="Run a governed workload"
        endpoint="POST /api/substrate/sandbox/execute"
        source="computless"
        description={
          <>
            This server sends each request to CAPPO first. Only an APPROVED decision runs; the run is then recorded to Gnomledger.
            A DENY or a CAPPO outage is refused before any code runs. Current execution mode:{' '}
            <span className="font-mono text-slate-100">{executionMode ?? 'not known yet'}</span>.
          </>
        }
      />
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <DirectiveControl value={directive} onChange={setDirective} />
        <p className="text-[10px] text-slate-500 mt-1">
          Sent with both runners below. CAPPO evaluates it; COMPUTLESS does not decide. CAPPO decisions are unsigned.
        </p>
      </div>
      <SandboxRunner directive={directive} onOpenEvent={onOpenEvent} />
      <VkgRunner directive={directive} onOpenEvent={onOpenEvent} />
    </div>
  );
};
