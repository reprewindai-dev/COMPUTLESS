import crypto from 'crypto';
import { runInChildSandbox, type SandboxResult } from './sandbox.js';

/**
 * Normalizes and canonicalizes any JSON value (object keys sorted) so that
 * hashing is deterministic.
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJSON(obj[k])).join(',') + '}';
}

/** SHA-256 of the canonical JSON form, as 0x-prefixed hex. */
export function hashPayload(payload: any): string {
  const canonical = canonicalizeJSON(payload);
  return '0x' + crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface SandboxExecution {
  /** The status the child-process sandbox actually reported. */
  status: SandboxResult['status'];
  /** Workload console output (stdout, then stderr, then a [FAULT] line when it failed). */
  stdout: string[];
  outputData: Record<string, unknown>;
  /** Child process RSS when the workload finished (0 when unknown). Not a per-workload quota. */
  memoryUsageBytes: number;
  /** Same value, null when unknown. */
  rssBytes: number | null;
  /** Wall-clock time measured inside the child around the workload. */
  durationMs: number;
}

/**
 * Executes a workload in the child-process sandbox (see sandbox.ts for exactly
 * what that boundary does and does not restrict).
 */
export async function executeInIsolatedVMSandbox(
  code: string,
  inputPayload: Record<string, unknown>,
  timeoutMs: number = 3000
): Promise<SandboxExecution> {
  const r = await runInChildSandbox(code, { input: inputPayload }, timeoutMs);
  const stdout = [...r.stdout, ...r.stderr];
  if (r.error) stdout.push(`[FAULT] ${r.error.message}`);
  const outputData =
    r.status === 'SUCCESS'
      ? r.output && typeof r.output === 'object'
        ? (r.output as Record<string, unknown>)
        : { value: r.output }
      : { error: r.error?.message ?? 'Execution fault', code: r.error?.code ?? r.status };
  return { status: r.status, stdout, outputData, memoryUsageBytes: r.rssBytes ?? 0, rssBytes: r.rssBytes, durationMs: r.durationMs };
}

/**
 * RFC 9457 Problem Details. Problem types are URNs (no hosted documentation).
 */
export function buildProblemDetails(type: string, title: string, status: number, detail: string, instance: string) {
  return {
    type: `urn:computless:problem:${type}`,
    title,
    status,
    detail,
    instance,
    timestamp: new Date().toISOString(),
  };
}
