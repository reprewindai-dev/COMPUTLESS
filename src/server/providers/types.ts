/** A place COMPUTLESS can run a workload. `local` is this server's child-process sandbox. */
export type ProviderId = 'local' | 'aws-lambda';

export interface ProviderJob {
  code: string;
  input: Record<string, unknown>;
  timeoutMs: number;
}

/** What the provider itself returned about the run, kept verbatim enough to audit. */
export interface ProviderReceipt {
  provider: ProviderId;
  [key: string]: unknown;
}

export interface ProviderRun {
  status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'MEMORY_LIMIT' | 'SANDBOX_FAILURE' | 'PROVIDER_ERROR';
  stdout: string[];
  stderr: string[];
  output: unknown;
  error: { message: string; code?: string | null } | null;
  durationMs: number;
  rssBytes: number | null;
  receipt: ProviderReceipt;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  configured: boolean;
  /** Settings this provider still needs before it can run anything. */
  missing: string[];
  /** Only vendor-documented isolation, with a link; never stronger. */
  boundary: Record<string, unknown>;
}
