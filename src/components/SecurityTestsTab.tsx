import React, { useState } from 'react';
import { FlaskConical, Play, CheckCircle2, XCircle } from 'lucide-react';
import type { AdversarialCatalog, AdversarialReport } from '../ui/types';
import { postJson, usePolled, fmtTime, fmtMs } from '../ui/api';
import { Card, TabHeader, ErrorBox, SourceTag } from './common';
import { EvidenceBadge } from './EvidenceBadge';

export const SecurityTestsTab: React.FC = () => {
  const catalog = usePolled<AdversarialCatalog>('/api/tests/adversarial', 0);
  const [ran, setRan] = useState<AdversarialReport | null>(null);
  // Fresh run from this browser, else the server's last run (if any).
  const report: AdversarialReport | null = ran ?? catalog.data?.lastRun ?? null;
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    const r = await postJson('/api/tests/adversarial/run', {});
    if (r.ok && r.data && typeof r.data === 'object') setRan(r.data as AdversarialReport);
    else setError(r.networkError ?? `HTTP ${r.status}`);
    setRunning(false);
  };

  const tests = Array.isArray(report?.tests) ? report!.tests! : [];

  return (
    <div className="space-y-6">
      <TabHeader
        title="Security tests"
        endpoint="POST /api/tests/adversarial/run"
        source="computless"
        description="Runs the repository's adversarial test suite inside this server process, against the real sandbox and checks. Each result below is what the test observed just now."
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          data-action="run-security-tests"
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {running ? 'Running…' : report ? 'Run again' : 'Run security tests'}
        </button>
        {report && !ran && <span className="text-xs font-mono text-slate-500">Showing the server's last run ({fmtTime(report.timestamp)}).</span>}
      </div>
      {error && <ErrorBox title="Test run failed">{error}</ErrorBox>}
      {catalog.error && <ErrorBox title="Could not load the test list">{catalog.error}</ErrorBox>}

      {!report && catalog.data && (
        <Card
          title={`Suite (${catalog.data.totalTests ?? catalog.data.tests?.length ?? 0} tests) — not run yet`}
          icon={<FlaskConical className="h-4 w-4 text-indigo-400" />}
          right={<SourceTag source="computless" endpoint="GET /api/tests/adversarial" fetchedAt={catalog.lastFetchedAt} />}
        >
          <p className="text-[11px] text-slate-400">The server has not run the suite since it started. Press the button to run it.</p>
          <div className="space-y-1.5">
            {(catalog.data.tests ?? []).map((t, i) => (
              <div key={t.testId ?? i} className="p-2 rounded border border-slate-800 bg-slate-950/60 text-xs font-mono" data-test-listed={t.testId}>
                <span className="text-slate-400">{t.testId}</span> <span className="text-slate-100">{t.name}</span>{' '}
                <span className="text-[10px] text-slate-500">· {t.category}</span>
                {t.expectedOutcome && <div className="text-[11px] text-slate-500 mt-0.5">expected: {t.expectedOutcome}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {report && (
        <Card
          title="Results"
          icon={<FlaskConical className="h-4 w-4 text-indigo-400" />}
          right={<SourceTag source="computless" endpoint="adversarial suite" fetchedAt={report.timestamp ?? null} />}
        >
          <div className="flex flex-wrap items-center gap-4 text-sm font-mono" data-security-summary={`${report.passed}/${report.totalTests}`}>
            <span className={report.allPassed ? 'text-emerald-300' : 'text-rose-300'}>
              {report.passed ?? '?'} / {report.totalTests ?? tests.length} passed
            </span>
            {typeof report.failed === 'number' && report.failed > 0 && <span className="text-rose-300">{report.failed} failed</span>}
            <EvidenceBadge label={report.evidenceLabel} />
            <span className="text-[11px] text-slate-500">ran {fmtTime(report.timestamp)}</span>
          </div>
          {report.scope && <p className="text-[11px] text-slate-400">{report.scope}</p>}
          <div className="space-y-2">
            {tests.map((t, i) => (
              <div
                key={t.testId ?? i}
                data-test={t.testId}
                data-passed={String(t.passed)}
                className={`p-3 rounded-lg border text-xs ${t.passed ? 'border-slate-800 bg-slate-950/60' : 'border-rose-500/40 bg-rose-950/20'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold text-slate-100">
                    {t.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
                    <span className="font-mono text-slate-400">{t.testId}</span>
                    {t.name}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                    {t.category} · {fmtMs(t.durationMs)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-500">expected: </span>
                    <span className="text-slate-300">{t.expectedOutcome ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">observed: </span>
                    <span className={t.passed ? 'text-slate-200' : 'text-rose-200'}>{t.actualOutcome ?? '—'}</span>
                  </div>
                </div>
                {t.details && <p className="mt-1 text-[11px] text-slate-400">{t.details}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
