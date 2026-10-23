import { runInChildSandbox, SANDBOX_BOUNDARY } from '../sandbox.js';
import { awsLambdaInfo, runOnAwsLambda } from './awsLambda.js';
import type { ProviderId, ProviderInfo, ProviderJob, ProviderRun } from './types.js';

export type { ProviderId, ProviderInfo, ProviderRun } from './types.js';

function localInfo(): ProviderInfo {
  return { id: 'local', name: 'This server (child-process sandbox)', configured: true, missing: [], boundary: { ...SANDBOX_BOUNDARY } };
}

export function listProviders(): ProviderInfo[] {
  return [localInfo(), awsLambdaInfo()];
}

export function getProvider(id: string): ProviderInfo | null {
  return listProviders().find((p) => p.id === id) ?? null;
}

async function runLocal(job: ProviderJob): Promise<ProviderRun> {
  const r = await runInChildSandbox(job.code, { input: job.input }, job.timeoutMs);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    output: r.output,
    error: r.error,
    durationMs: r.durationMs,
    rssBytes: r.rssBytes,
    receipt: { provider: 'local', exitCode: r.exitCode },
  };
}

export function runOnProvider(id: ProviderId, job: ProviderJob): Promise<ProviderRun> {
  return id === 'aws-lambda' ? runOnAwsLambda(job) : runLocal(job);
}
