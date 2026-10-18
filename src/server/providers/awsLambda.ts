/**
 * AWS Lambda provider: invokes the COMPUTLESS runner function
 * (cloud/aws-lambda/runner.cjs, deployed by cloud/aws-lambda/template.json)
 * and returns the runner's result plus AWS's own receipt for the invocation.
 *
 * Credentials come from the AWS SDK default chain (env, shared config, the
 * instance/task role). When COMPUTLESS_AWS_ROLE_ARN is set they are only used
 * to assume that role, which may do nothing but invoke the runner.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { ProviderInfo, ProviderJob, ProviderRun } from './types.js';

const env = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

const ARN_RE = /^arn:aws[a-z-]*:lambda:([a-z0-9-]+):(\d{12}):function:([A-Za-z0-9_-]+)(?::[A-Za-z0-9$_-]+)?$/;

export function awsLambdaConfig() {
  const functionArn = env('COMPUTLESS_AWS_FUNCTION_ARN');
  const parsed = functionArn ? ARN_RE.exec(functionArn) : null;
  return {
    functionArn,
    functionArnValid: Boolean(parsed),
    region: env('AWS_REGION') ?? env('AWS_DEFAULT_REGION') ?? parsed?.[1] ?? null,
    accountId: parsed?.[2] ?? null,
    roleArn: env('COMPUTLESS_AWS_ROLE_ARN'),
  };
}

export const AWS_LAMBDA_BOUNDARY = {
  kind: 'aws-lambda',
  isolation: 'Firecracker microVM per execution environment (AWS-documented)',
  docs: 'https://docs.aws.amazon.com/lambda/latest/dg/security-dataprotection.html',
  environmentReuse: 'warm execution environments are reused between runs of this function; each run is a new child process',
  runner: 'child node process per run: empty environment (no AWS credentials), Node permission model (no fs, child processes or workers), 128 MB heap cap, killed at the deadline',
  codeGenerationFromStrings: 'disabled in the workload context and in the child process',
  workloadApis: 'input, output, console only (no require, process, timers or network API)',
  network: 'the function has outbound internet unless deployed in a VPC without NAT; no network API is exposed to the workload',
  hardwareAttestation: false,
} as const;

export function awsLambdaInfo(): ProviderInfo {
  const c = awsLambdaConfig();
  const missing: string[] = [];
  if (!c.functionArn) missing.push('COMPUTLESS_AWS_FUNCTION_ARN');
  else if (!c.functionArnValid) missing.push('COMPUTLESS_AWS_FUNCTION_ARN (not a Lambda function ARN)');
  if (!c.region) missing.push('AWS_REGION');
  return {
    id: 'aws-lambda',
    name: 'AWS Lambda',
    configured: missing.length === 0,
    missing,
    boundary: { ...AWS_LAMBDA_BOUNDARY, functionArn: c.functionArn, region: c.region, assumesRole: c.roleArn },
  };
}

/** Parses the REPORT line Lambda appends to the tail of the invocation log. */
export function parseLambdaReport(logTail: string | null) {
  const line = logTail?.split('\n').find((l) => l.startsWith('REPORT ')) ?? null;
  const num = (label: string) => {
    const m = line ? new RegExp(`${label}: ([0-9.]+)`).exec(line) : null;
    return m ? Number(m[1]) : null;
  };
  return {
    durationMs: num('Duration'),
    billedDurationMs: num('Billed Duration'),
    memorySizeMb: num('Memory Size'),
    maxMemoryUsedMb: num('Max Memory Used'),
    initDurationMs: num('Init Duration'),
    reportLine: line,
  };
}

let client: LambdaClient | null = null;
let clientKey = '';

function getClient(region: string, roleArn: string | null): LambdaClient {
  const key = `${region}|${roleArn ?? ''}`;
  if (client && clientKey === key) return client;
  client = new LambdaClient({
    region,
    maxAttempts: 1, // a retried Invoke would run the workload twice
    ...(roleArn
      ? {
          credentials: fromTemporaryCredentials({
            params: { RoleArn: roleArn, RoleSessionName: 'computless-dispatch', DurationSeconds: 900 },
            clientConfig: { region },
          }),
        }
      : {}),
  });
  clientKey = key;
  return client;
}

type Invoker = (input: { FunctionName: string; Payload: Uint8Array }, signal: AbortSignal) => Promise<{
  StatusCode?: number;
  FunctionError?: string;
  ExecutedVersion?: string;
  LogResult?: string;
  Payload?: Uint8Array;
  $metadata?: { requestId?: string; httpStatusCode?: number };
}>;

/** Tests replace the AWS call; production always uses the SDK. */
let invoker: Invoker | null = null;
export function setLambdaInvokerForTests(fn: Invoker | null) {
  invoker = fn;
}

export async function runOnAwsLambda(job: ProviderJob): Promise<ProviderRun> {
  const c = awsLambdaConfig();
  const info = awsLambdaInfo();
  const baseReceipt = { provider: 'aws-lambda' as const, functionArn: c.functionArn, region: c.region };
  const fail = (message: string, code: string, extra: Record<string, unknown> = {}): ProviderRun => ({
    status: 'PROVIDER_ERROR',
    stdout: [],
    stderr: [],
    output: null,
    error: { message, code },
    durationMs: 0,
    rssBytes: null,
    receipt: { ...baseReceipt, ...extra },
  });
  if (!info.configured || !c.functionArn || !c.region) return fail(`AWS Lambda is not configured: ${info.missing.join(', ')}`, 'NOT_CONFIGURED');

  const payload = new TextEncoder().encode(JSON.stringify({ code: job.code, input: job.input, timeoutMs: job.timeoutMs }));
  const signal = AbortSignal.timeout(job.timeoutMs + 25_000); // runner timeout (20 s) + cold start + network
  const call: Invoker =
    invoker ??
    ((input, s) =>
      getClient(c.region!, c.roleArn).send(
        new InvokeCommand({ ...input, InvocationType: 'RequestResponse', LogType: 'Tail' }),
        { abortSignal: s }
      ));

  const dispatchedAt = new Date().toISOString();
  let res: Awaited<ReturnType<Invoker>>;
  try {
    res = await call({ FunctionName: c.functionArn, Payload: payload }, signal);
  } catch (err: any) {
    return fail(String(err?.message ?? err).slice(0, 500), String(err?.name ?? 'InvokeFailed'), {
      dispatchedAt,
      requestId: err?.$metadata?.requestId ?? null,
      httpStatusCode: err?.$metadata?.httpStatusCode ?? null,
    });
  }

  const logTail = res.LogResult ? Buffer.from(res.LogResult, 'base64').toString('utf8') : null;
  const report = parseLambdaReport(logTail);
  const receipt = {
    ...baseReceipt,
    dispatchedAt,
    completedAt: new Date().toISOString(),
    requestId: res.$metadata?.requestId ?? null,
    httpStatusCode: res.$metadata?.httpStatusCode ?? null,
    invokeStatusCode: res.StatusCode ?? null,
    executedVersion: res.ExecutedVersion ?? null,
    functionError: res.FunctionError ?? null,
    ...report,
  };

  let body: any = null;
  try {
    body = res.Payload ? JSON.parse(new TextDecoder().decode(res.Payload)) : null;
  } catch {
    body = null;
  }

  if (res.FunctionError) {
    // Lambda-level failure (e.g. "Task timed out", out of memory): the runner did not return.
    const msg = String(body?.errorMessage ?? res.FunctionError);
    const status = /timed out/i.test(msg) ? 'TERMINATED_TIMEOUT' : /memory/i.test(msg) ? 'MEMORY_LIMIT' : 'RUNTIME_ERROR';
    return { status, stdout: [], stderr: [], output: null, error: { message: msg.slice(0, 500), code: String(body?.errorType ?? res.FunctionError) }, durationMs: report.durationMs ?? 0, rssBytes: null, receipt };
  }
  if (!body || typeof body.status !== 'string') {
    return { status: 'PROVIDER_ERROR', stdout: [], stderr: [], output: null, error: { message: 'runner returned no result', code: 'BAD_RUNNER_RESPONSE' }, durationMs: 0, rssBytes: null, receipt };
  }
  return {
    status: body.status,
    stdout: Array.isArray(body.stdout) ? body.stdout.map(String) : [],
    stderr: Array.isArray(body.stderr) ? body.stderr.map(String) : [],
    output: body.output ?? null,
    error: body.error ?? null,
    durationMs: Number(body.durationMs) || 0,
    rssBytes: typeof body.rssBytes === 'number' ? body.rssBytes : null,
    receipt: { ...receipt, runtime: body.runtime ?? null },
  };
}
