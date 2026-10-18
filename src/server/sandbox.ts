import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Runs untrusted workload code in a separate Node process.
 *
 * What this boundary actually provides (and what the UI may claim):
 * - separate OS process with an empty environment (no secrets inherited);
 * - code generation from strings disabled in the runner's own realm, so the
 *   known node:vm escape (this.constructor.constructor("return process")())
 *   throws and the workload never gets a handle to `process`/`require`;
 * - Node permission model: no filesystem access beyond reading the runner,
 *   no child processes, no worker threads, no native addons (defence in depth);
 * - V8 heap capped with --max-old-space-size, wall-clock kill on timeout.
 *
 * What it does NOT provide: OS-level network egress restriction (the workload
 * is given no network API, but nothing at the OS level blocks a process that
 * escapes), cgroups, namespaces, seccomp, or any hardware/TEE isolation.
 */
export const SANDBOX_BOUNDARY = {
  kind: 'node-child-process',
  envInherited: false,
  filesystem: 'denied (Node permission model)',
  childProcesses: 'denied (Node permission model)',
  codeGenerationFromStrings: 'disabled in runner realm (blocks the Function-constructor escape)',
  network: 'NOT restricted at OS level (no network API is exposed to the workload)',
  cgroups: false,
  hardwareIsolation: false,
} as const;

export interface SandboxResult {
  status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR' | 'MEMORY_LIMIT' | 'SANDBOX_FAILURE';
  stdout: string[];
  stderr: string[];
  output: unknown;
  error: { message: string; code?: string | null } | null;
  /** Wall-clock time measured inside the child around the workload script. */
  durationMs: number;
  /** Resident set size of the child process when the workload finished; null if unknown. */
  rssBytes: number | null;
  exitCode: number | null;
}

const RUNNER_CANDIDATES = [
  path.join(process.cwd(), 'src', 'server', 'sandboxRunner.cjs'),
  path.join(process.cwd(), 'dist', 'sandboxRunner.cjs'),
];

function runnerPath(): string | null {
  return RUNNER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

const MAX_CAPTURE_BYTES = 1_000_000;

export function runInChildSandbox(
  code: string,
  globals: Record<string, unknown>,
  timeoutMs = 3000,
  heapLimitMb = 64
): Promise<SandboxResult> {
  const runner = runnerPath();
  if (!runner) {
    return Promise.resolve({
      status: 'SANDBOX_FAILURE',
      stdout: [],
      stderr: [],
      output: null,
      error: { message: 'sandbox runner not found' },
      durationMs: 0,
      rssBytes: null,
      exitCode: null,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${runner}`,
        '--disallow-code-generation-from-strings',
        `--max-old-space-size=${heapLimitMb}`,
        runner,
      ],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let out = '';
    let err = '';
    let killedForTimeout = false;
    const killer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs + 1500);

    child.stdout.on('data', (c: Buffer) => {
      if (out.length < MAX_CAPTURE_BYTES) out += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      if (err.length < MAX_CAPTURE_BYTES) err += c.toString('utf8');
    });

    child.on('error', (e) => {
      clearTimeout(killer);
      resolve({
        status: 'SANDBOX_FAILURE',
        stdout: [],
        stderr: [],
        output: null,
        error: { message: e.message },
        durationMs: 0,
        rssBytes: null,
        exitCode: null,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(killer);
      try {
        const parsed = JSON.parse(out);
        resolve({
          status: parsed.status,
          stdout: parsed.stdout ?? [],
          stderr: parsed.stderr ?? [],
          output: parsed.output ?? null,
          error: parsed.error ?? null,
          durationMs: +Number(parsed.durationMs ?? 0).toFixed(2),
          rssBytes: typeof parsed.rssBytes === 'number' ? parsed.rssBytes : null,
          exitCode,
        });
      } catch {
        const oom = /heap out of memory|Allocation failed/i.test(err);
        resolve({
          status: killedForTimeout ? 'TERMINATED_TIMEOUT' : oom ? 'MEMORY_LIMIT' : 'SANDBOX_FAILURE',
          stdout: [],
          stderr: err ? [err.slice(0, 2000)] : [],
          output: null,
          error: {
            message: killedForTimeout
              ? 'workload killed after wall-clock timeout'
              : oom
                ? `workload exceeded ${heapLimitMb} MB heap limit`
                : 'sandbox process exited without a result',
          },
          durationMs: 0,
          rssBytes: null,
          exitCode,
        });
      }
    });

    child.stdin.end(JSON.stringify({ code, globals, timeoutMs }));
  });
}
