/**
 * Real data for the COMPUTLESS UI, read from the Veklom services themselves.
 *
 * Every response says which service it came from, whether that service is
 * configured, and when it was fetched. When a service is unconfigured or
 * unreachable the response says so and carries no data — there is no fallback
 * to seed or sample data anywhere in this module.
 *
 * The only locally produced data is the execution log: one entry per request
 * this process actually handled on a code-executing route (run or refused).
 */
import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { fabricConfig } from './fabric.js';

const FETCH_TIMEOUT_MS = 4000;

type Source = 'capi' | 'cappo' | 'pgl' | 'lockerphycer' | 'computless';

export interface Sourced<T> {
  source: Source;
  configured: boolean;
  ok: boolean;
  fetchedAt: string;
  status?: number;
  error?: string;
  data: T | null;
}

async function fetchJson<T>(
  source: Source,
  base: string | null,
  pathname: string,
  headers: Record<string, string> = {}
): Promise<Sourced<T>> {
  const fetchedAt = new Date().toISOString();
  if (!base) return { source, configured: false, ok: false, fetchedAt, error: 'not configured', data: null };
  try {
    const res = await fetch(`${base}${pathname}`, {
      headers: { Accept: 'application/json', ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { source, configured: true, ok: false, fetchedAt, status: res.status, error: `HTTP ${res.status}`, data: null };
    return { source, configured: true, ok: true, fetchedAt, status: res.status, data: (await res.json()) as T };
  } catch (err: any) {
    return {
      source,
      configured: true,
      ok: false,
      fetchedAt,
      error: err?.name === 'TimeoutError' ? 'timeout' : 'unreachable',
      data: null,
    };
  }
}

const cappoHeaders = (): Record<string, string> =>
  fabricConfig.cappoApiKey ? { 'X-API-Key': fabricConfig.cappoApiKey } : {};
const pglHeaders = (): Record<string, string> =>
  fabricConfig.pglApiKey ? { 'x-api-key': fabricConfig.pglApiKey } : {};

// ── cAPI registry ────────────────────────────────────────────────────────────

export function getRegistryServices() {
  return fetchJson<{ count: number; services: unknown[] }>('capi', fabricConfig.capiUrl, '/api/v1/registry/services');
}

// ── CAPPO capability packages ───────────────────────────────────────────────

export function getCappoPackages() {
  return fetchJson<unknown[]>('cappo', fabricConfig.cappoUrl, '/v1/capability/packages', cappoHeaders());
}

// ── Gnomledger evidence for this service's agent ─────────────────────────────

export async function getLedger() {
  const agent = fabricConfig.pglAgentId;
  if (!agent) {
    const fetchedAt = new Date().toISOString();
    const missing = { source: 'pgl' as const, configured: false, ok: false, fetchedAt, error: 'PGL_AGENT_ID not configured', data: null };
    return { agentId: null, events: missing, verification: missing };
  }
  const id = encodeURIComponent(agent);
  const [events, verification] = await Promise.all([
    fetchJson<unknown[]>('pgl', fabricConfig.pglUrl, `/api/v1/ledger/agents/${id}`, pglHeaders()),
    fetchJson<Record<string, unknown>>('pgl', fabricConfig.pglUrl, `/api/v1/ledger/agents/${id}/verify`, pglHeaders()),
  ]);
  return { agentId: agent, events, verification };
}

export function getLedgerEvent(eventId: string) {
  return fetchJson<Record<string, unknown>>(
    'pgl',
    fabricConfig.pglUrl,
    `/api/v1/ledger/events/${encodeURIComponent(eventId)}`,
    pglHeaders()
  );
}

// ── Each peer's own dependency report ────────────────────────────────────────

export async function getPeerReports() {
  const peers: [Source, string | null, Record<string, string>][] = [
    ['capi', fabricConfig.capiUrl, {}],
    ['cappo', fabricConfig.cappoUrl, cappoHeaders()],
    ['pgl', fabricConfig.pglUrl, {}],
    ['lockerphycer', fabricConfig.lockerphycerUrl, {}],
  ];
  const reports = await Promise.all(
    peers.map(async ([name, url, headers]) => ({
      name,
      health: await fetchJson<Record<string, unknown>>(name, url, '/health', headers),
      dependencies: await fetchJson<Record<string, unknown>>(name, url, '/health/dependencies', headers),
    }))
  );
  return reports;
}

// ── Execution log (real requests handled by this process) ────────────────────

export interface ExecutionEntry {
  id: string;
  at: string;
  route: string;
  capabilityId: string;
  mode: string;
  outcome: 'ran' | 'refused';
  httpStatus: number;
  cappoDecision: string | null;
  cappoAuthorizationId: string | null;
  cappoSource: string | null;
  pglRecorded: boolean | null;
  pglEventId: string | null;
  durationMs: number;
  workloadStatus: string | null;
}

const LOG_FILE = path.join(process.cwd(), 'data', 'executions.json');
const LOG_MAX = 500;
let log: ExecutionEntry[] | null = null;

function loadLog(): ExecutionEntry[] {
  if (log) return log;
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    log = Array.isArray(parsed) ? parsed : [];
  } catch {
    log = [];
  }
  return log;
}

export function recordExecution(entry: Omit<ExecutionEntry, 'id' | 'at'>): void {
  const entries = loadLog();
  entries.unshift({ id: `run-${Date.now().toString(36)}-${entries.length}`, at: new Date().toISOString(), ...entry });
  entries.length = Math.min(entries.length, LOG_MAX);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // The log stays in memory if the disk is read-only; /api/executions reports persisted:false.
    persistFailed = true;
  }
}
let persistFailed = false;

export function getExecutions() {
  return { source: 'computless' as const, persisted: !persistFailed, entries: loadLog() };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerFabricDataRoutes(app: Express) {
  app.get('/api/fabric/services', async (_req, res) => res.json(await getRegistryServices()));
  app.get('/api/fabric/capabilities', async (_req, res) => res.json(await getCappoPackages()));
  app.get('/api/fabric/ledger', async (_req, res) => res.json(await getLedger()));
  app.get('/api/fabric/ledger/events/:eventId', async (req, res) => res.json(await getLedgerEvent(req.params.eventId)));
  app.get('/api/fabric/peers', async (_req, res) => res.json(await getPeerReports()));
  app.get('/api/executions', (_req, res) => res.json(getExecutions()));
}
