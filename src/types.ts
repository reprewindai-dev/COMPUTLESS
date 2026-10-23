/**
 * Server-side types for the COMPUTLESS endpoints that remain: the governed
 * child-process sandbox and .vkg packages. Fabric types (governance,
 * authorization, evidence) live in src/server/fabric.ts.
 */

/** Body of POST /api/substrate/sandbox/execute. */
export interface SandboxExecutionRequest {
  /** Sent to CAPPO as agent_id. */
  agentId?: string;
  /** Sent to CAPPO as directive (caller-declared). */
  directive?: string;
  /** JavaScript run in the child-process sandbox. Globals: input, output, console. */
  code: string;
  inputPayload?: Record<string, unknown>;
  /** Clamped to 1..10000 ms. Default 3000. */
  timeoutMs?: number;
  /** Where to run it: 'local' (default) or a configured cloud provider, e.g. 'aws-lambda'. */
  provider?: string;
}

export type SandboxStatus = 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'MEMORY_LIMIT' | 'SANDBOX_FAILURE';

export interface VkgManifest {
  packageId: string;
  name: string;
  version: string;
  /** SHA-256 over the manifest fields below, the data tables and the handlers (see computeVkgDigest). */
  contentDigest: string;
  capabilities: string[];
  allowedActions: string[];
  /** Enforced as the sandbox V8 heap limit for this package's handlers. */
  memoryCeilingBytes: number;
  /** Enforced as the sandbox wall-clock limit (capped at 5000 ms). */
  timeoutCeilingMs: number;
  schemaVersion: string;
  author?: string;
}

export interface VkgPackage {
  manifest: VkgManifest;
  dataTables: Record<string, unknown>;
  /** JavaScript source per action. Globals: input, dataTables, output, console. */
  actionHandlers: Record<string, string>;
}

/** A package as held by this server: shipped in the repo, or uploaded by a user. */
export interface StoredVkgPackage extends VkgPackage {
  source: 'built-in' | 'uploaded';
  /** When it was uploaded to this server (uploaded packages only). */
  uploadedAt?: string;
}

export interface VkgValidationResult {
  valid: boolean;
  computedDigest: string;
  expectedDigest: string;
  manifestMatch: boolean;
  error?: string;
}

export type VkgExecutionStatus = SandboxStatus | 'DIGEST_MISMATCH' | 'ACTION_NOT_IN_MANIFEST';

export interface VkgExecutionResult {
  status: VkgExecutionStatus;
  /** False when a manifest/digest check refused the action before any code ran. */
  ran: boolean;
  stdout: string[];
  stderr: string[];
  outputData: Record<string, unknown>;
  /** Child process RSS when the handler finished (null when unknown or nothing ran). */
  rssBytes: number | null;
  /** Wall-clock time measured inside the child around the handler (0 when nothing ran). */
  durationMs: number;
  /** Limits actually applied to this run, derived from the manifest. */
  limits: { timeoutMs: number; heapLimitMb: number } | null;
}
