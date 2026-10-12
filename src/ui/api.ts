import { useCallback, useEffect, useRef, useState } from 'react';

export const POLL_MS = 15000;

/** Result of fetching one COMPUTLESS endpoint from the browser. */
export interface Polled<T> {
  data: T | null;
  /** Error from the last attempt (data, if any, is from an earlier success). */
  error: string | null;
  loading: boolean;
  /** When the browser last received a response (or failed to). */
  lastFetchedAt: string | null;
  refresh: () => void;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${url} → response was not JSON`);
  }
}

/**
 * GET `url` now and then every `pollMs` (0 = no polling). Data is only ever
 * what the server returned; on failure the error is surfaced, never replaced
 * with a placeholder.
 */
export function usePolled<T>(url: string | null, pollMs = POLL_MS): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (!url || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      setData(await getJson<T>(url));
      setError(null);
    } catch (err: any) {
      setError(err?.message ? String(err.message) : 'request failed');
    } finally {
      setLastFetchedAt(new Date().toISOString());
      setLoading(false);
      inflight.current = false;
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [url, pollMs, refresh]);

  return { data, error, loading, lastFetchedAt, refresh };
}

export interface PostResult {
  ok: boolean;
  status: number;
  /** true for application/problem+json refusals (403/503). */
  problem: boolean;
  data: any;
  /** Network failure (no HTTP response at all). */
  networkError?: string;
}

/** POST JSON; never throws. */
export async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const ctype = res.headers.get('content-type') || '';
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, problem: ctype.includes('problem+json'), data };
  } catch (err: any) {
    return { ok: false, status: 0, problem: false, data: null, networkError: err?.message ?? 'request failed' };
  }
}

/** Env var(s) that configure each peer on the COMPUTLESS server. */
export const PEER_ENV: Record<string, string> = {
  capi: 'CAPI_BACKEND_URL',
  cappo: 'CAPPO_BACKEND_URL',
  pgl: 'PGL_LEDGER_URL',
  lockerphycer: 'LOCKERPHYCER_URL',
};

export const SOURCE_NAME: Record<string, string> = {
  capi: 'cAPI',
  cappo: 'CAPPO',
  pgl: 'Gnomledger',
  lockerphycer: 'Lockerphycer',
  computless: 'this COMPUTLESS server',
};

export function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export function shortHash(v?: string | null, n = 12): string {
  if (!v) return '—';
  const s = String(v);
  return s.length > n + 2 ? `${s.slice(0, n)}…` : s;
}

export function fmtBytes(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'not reported';
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MiB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
  return `${v} B`;
}

export function fmtMs(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'not reported';
  return `${v} ms`;
}
