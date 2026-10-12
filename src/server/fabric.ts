/**
 * Veklom fabric integration for COMPUTLESS.
 *
 * - cAPI:   registers this service and keeps it alive with heartbeats
 *           (POST /api/v1/registry/register, POST /api/v1/registry/heartbeat).
 * - CAPPO:  fail-closed pre-execution authorization
 *           (POST /api/v1/execution/authorize). Only decision === "APPROVED" runs.
 * - PGL:    execution evidence is appended to Gnomledger
 *           (POST /api/v1/ledger/events); the ledger computes and chains the hashes.
 * - Probes: /health (falling back to /protocol.json on 404) plus a protocol
 *           identity check. A 2xx is reachability, never proof of identity or SHA.
 *
 * Nothing here invents a state: every value is either configured, observed by
 * a request this process made, or reported as unconfigured/unavailable.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { SANDBOX_BOUNDARY } from './sandbox.js';
import { recordExecution } from './fabricData.js';

export type EvidenceLabel =
  | 'VERIFIED_LIVE'
  | 'VERIFIED_REPO'
  | 'CONFIGURED'
  | 'LAST_KNOWN'
  | 'TARGET'
  | 'UNVERIFIED'
  | 'DEMO'
  | 'ARCHIVED';

export type ExecutionMode = 'disabled' | 'local-demo' | 'governed';

const SERVICE_NAME = 'computless';
const SERVICE_VERSION = '0.1.0';
const PROBE_TIMEOUT_MS = 2000;
const CALL_TIMEOUT_MS = 5000;
const REGISTER_RETRY_MS = 5000;
const DEFAULT_TTL_MS = 300_000;
const PROBE_CACHE_MS = 10_000;

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  if (!v || /^MY_[A-Z_]+$/.test(v)) return null; // ignore .env.example placeholders
  return v;
}

function trimSlash(url: string | null): string | null {
  return url ? url.replace(/\/+$/, '') : null;
}

function resolveExecutionMode(cappoConfigured: boolean): ExecutionMode {
  const raw = env('COMPUTLESS_EXECUTION_MODE');
  if (raw === 'disabled' || raw === 'local-demo' || raw === 'governed') return raw;
  if (cappoConfigured) return 'governed';
  return process.env.NODE_ENV === 'production' ? 'disabled' : 'local-demo';
}

export const fabricConfig = (() => {
  const cappoUrl = trimSlash(env('CAPPO_BACKEND_URL'));
  const ttl = Number(env('CAPI_REGISTRY_TTL_MS') ?? DEFAULT_TTL_MS);
  return {
    publicBaseUrl: trimSlash(env('COMPUTLESS_PUBLIC_URL') ?? env('APP_URL')),
    sourceCommit: env('COMPUTLESS_SOURCE_COMMIT') ?? env('SOURCE_COMMIT'),
    capiUrl: trimSlash(env('CAPI_BACKEND_URL')),
    capiApiKey: env('CAPI_API_KEY'),
    capiTtlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MS,
    cappoUrl,
    cappoApiKey: env('CAPPO_API_KEY'),
    pglUrl: trimSlash(env('PGL_LEDGER_URL')),
    pglApiKey: env('PGL_API_KEY'),
    pglAgentId: env('PGL_AGENT_ID'),
    lockerphycerUrl: trimSlash(env('LOCKERPHYCER_URL')),
    executionMode: resolveExecutionMode(Boolean(cappoUrl)),
  };
})();

// ── Peers ────────────────────────────────────────────────────────────────────

interface Peer {
  name: 'capi' | 'cappo' | 'pgl' | 'lockerphycer';
  url: string | null;
  /** `service` values the peer's /protocol.json is known to report (from its source). */
  expectedServices: string[];
}

function peers(): Peer[] {
  return [
    // cAPI serves a static public/protocol.json (schema_version 2.0) that names
    // itself via `provider` rather than `service`; its route handler would say
    // 'cAPI-interlink-console'. Accept either.
    { name: 'capi', url: fabricConfig.capiUrl, expectedServices: ['cAPI-interlink-console', 'cAPI', 'capi', 'veklom-capi'] },
    { name: 'cappo', url: fabricConfig.cappoUrl, expectedServices: ['cappo', 'cappo-backend'] },
    { name: 'pgl', url: fabricConfig.pglUrl, expectedServices: ['gnomledger'] },
    { name: 'lockerphycer', url: fabricConfig.lockerphycerUrl, expectedServices: ['lockerphycer'] },
  ];
}

export type DependencyState = 'healthy' | 'reachable_not_verified' | 'degraded' | 'unconfigured' | 'unavailable';

export interface DependencyResult {
  name: string;
  state: DependencyState;
  verification_scope: 'LOCAL_FILE' | 'HTTP_REACHABILITY_ONLY' | 'NOT_VERIFIED';
  /** matched = /protocol.json `service` equals what that service's source reports. */
  protocol_identity?: 'matched' | 'mismatched' | 'unavailable';
  observed_service?: string | null;
  checked_at: string;
}

const STATE_RANK: Record<DependencyState, number> = {
  healthy: 0,
  reachable_not_verified: 1,
  degraded: 2,
  unconfigured: 2,
  unavailable: 3,
};

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
}

async function probePeer(peer: Peer): Promise<DependencyResult> {
  const checked_at = new Date().toISOString();
  if (!peer.url) return { name: peer.name, state: 'unconfigured', verification_scope: 'NOT_VERIFIED', checked_at };

  let state: DependencyState;
  try {
    let res = await timedFetch(`${peer.url}/health`);
    if (res.status === 404) res = await timedFetch(`${peer.url}/protocol.json`);
    state = res.status >= 200 && res.status < 300 ? 'reachable_not_verified' : 'degraded';
  } catch {
    state = 'unavailable';
  }

  let protocol_identity: DependencyResult['protocol_identity'] = 'unavailable';
  let observed_service: string | null = null;
  if (state !== 'unavailable') {
    try {
      const res = await timedFetch(`${peer.url}/protocol.json`);
      if (res.ok) {
        const body = (await res.json()) as { service?: unknown; provider?: unknown };
        const named = typeof body.service === 'string' ? body.service : body.provider;
        observed_service = typeof named === 'string' ? named : null;
        protocol_identity = observed_service && peer.expectedServices.includes(observed_service) ? 'matched' : 'mismatched';
      }
    } catch {
      protocol_identity = 'unavailable';
    }
  }

  return { name: peer.name, state, verification_scope: 'HTTP_REACHABILITY_ONLY', protocol_identity, observed_service, checked_at };
}

function probeLocalStore(): DependencyResult {
  const dir = path.join(process.cwd(), 'data');
  let state: DependencyState = 'healthy';
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    state = 'unavailable';
  }
  return { name: 'local_store', state, verification_scope: 'LOCAL_FILE', checked_at: new Date().toISOString() };
}

let probeCache: { at: number; results: DependencyResult[] } | null = null;

export async function probeDependencies(force = false): Promise<DependencyResult[]> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) return probeCache.results;
  const results = [probeLocalStore(), ...(await Promise.all(peers().map(probePeer)))];
  probeCache = { at: Date.now(), results };
  return results;
}

export function overallState(results: DependencyResult[]): DependencyState {
  return results.reduce<DependencyState>(
    (worst, r) => (STATE_RANK[r.state] > STATE_RANK[worst] ? r.state : worst),
    'healthy'
  );
}

// ── cAPI registration ────────────────────────────────────────────────────────

export interface RegistrationState {
  state: 'unconfigured' | 'registering' | 'registered' | 'rejected' | 'unavailable' | 'stopped';
  lastAttemptAt: string | null;
  registeredAt: string | null;
  lastHeartbeatAt: string | null;
  expiresAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  executableCapabilityIds: string[];
}

const registration: RegistrationState = {
  state: fabricConfig.capiUrl ? 'registering' : 'unconfigured',
  lastAttemptAt: null,
  registeredAt: null,
  lastHeartbeatAt: null,
  expiresAt: null,
  lastStatusCode: null,
  lastError: null,
  executableCapabilityIds: [],
};

export function getRegistrationState(): RegistrationState {
  return { ...registration };
}

const CAPABILITIES = [
  {
    name: 'execute_workload',
    description: 'Run a JavaScript workload in a child-process sandbox after a CAPPO APPROVED decision.',
    path: '/api/substrate/sandbox/execute',
    risk_level: 'high',
    requires_approval: true,
    input_schema: {
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string' }, inputPayload: { type: 'object' }, timeoutMs: { type: 'integer' } },
    },
  },
  {
    name: 'run_substrate_pipeline',
    description: 'Run the 8-layer pipeline (prototype) for one workload after a CAPPO APPROVED decision.',
    path: '/api/substrate/pipeline/execute',
    risk_level: 'high',
    requires_approval: true,
    input_schema: { type: 'object', properties: { code: { type: 'string' }, inputPayload: { type: 'object' } } },
  },
  {
    name: 'read_dependency_health',
    description: 'Report COMPUTLESS dependency reachability (not runtime verification).',
    path: '/health/dependencies',
    risk_level: 'low',
    requires_approval: false,
    input_schema: { type: 'object', properties: {} },
  },
] as const;

export function buildRegistrationPayload() {
  const base = fabricConfig.publicBaseUrl;
  return {
    service_name: SERVICE_NAME,
    ...(base ? { base_url: base } : {}),
    telemetry_supported: false,
    capabilities: CAPABILITIES.map((c) => ({
      name: c.name,
      description: c.description,
      // Relative endpoints are accepted by cAPI but recorded as declared-only
      // (not executable) until a public base URL is configured.
      endpoint: base ? `${base}${c.path}` : c.path,
      input_schema: c.input_schema,
      category: 'service',
      risk_level: c.risk_level,
      requires_approval: c.requires_approval,
    })),
    metadata: {
      protocol: 'veklom-service-registration-v1',
      ...(base ? { manifest: `${base}/protocol.json` } : {}),
      execution_mode: fabricConfig.executionMode,
    },
  };
}

function capiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (fabricConfig.capiApiKey) h.Authorization = `Bearer ${fabricConfig.capiApiKey}`;
  return h;
}

async function registerOnce(): Promise<boolean> {
  registration.lastAttemptAt = new Date().toISOString();
  try {
    const res = await timedFetch(
      `${fabricConfig.capiUrl}/api/v1/registry/register`,
      { method: 'POST', headers: capiHeaders(), body: JSON.stringify(buildRegistrationPayload()) },
      CALL_TIMEOUT_MS
    );
    registration.lastStatusCode = res.status;
    if (res.status === 200 || res.status === 201) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      registration.state = 'registered';
      registration.registeredAt = typeof body.registered_at === 'string' ? body.registered_at : registration.lastAttemptAt;
      registration.expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null;
      registration.executableCapabilityIds = Array.isArray(body.executable_capability_ids)
        ? (body.executable_capability_ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      registration.lastError = null;
      console.log('[fabric] registered with cAPI');
      return true;
    }
    registration.state = 'rejected';
    registration.lastError = `register returned HTTP ${res.status}`;
    console.warn(`[fabric] cAPI registration rejected with status ${res.status}`);
    return false;
  } catch (err: any) {
    registration.state = 'unavailable';
    registration.lastStatusCode = null;
    registration.lastError = err?.name === 'TimeoutError' ? 'timeout' : String(err?.cause?.code ?? err?.name ?? 'error');
    console.warn(`[fabric] cAPI registration failed (${registration.lastError})`);
    return false;
  }
}

/** Returns true when cAPI reports the registration missing (re-register), false on a transient failure. */
async function heartbeatOnce(): Promise<'ok' | 'missing' | 'failed'> {
  try {
    const res = await timedFetch(
      `${fabricConfig.capiUrl}/api/v1/registry/heartbeat`,
      { method: 'POST', headers: capiHeaders(), body: JSON.stringify({ service_name: SERVICE_NAME }) },
      CALL_TIMEOUT_MS
    );
    registration.lastStatusCode = res.status;
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      registration.lastHeartbeatAt = typeof body.last_seen === 'string' ? body.last_seen : new Date().toISOString();
      registration.expiresAt = typeof body.expires_at === 'string' ? body.expires_at : registration.expiresAt;
      registration.lastError = null;
      return 'ok';
    }
    if (res.status === 404) {
      registration.state = 'registering';
      console.log('[fabric] cAPI registration missing; re-registering');
      return 'missing';
    }
    registration.lastError = `heartbeat returned HTTP ${res.status}`;
    return 'failed';
  } catch (err: any) {
    registration.lastError = err?.name === 'TimeoutError' ? 'heartbeat timeout' : 'heartbeat failed';
    return 'failed';
  }
}

let registrationTimer: NodeJS.Timeout | null = null;

function schedule(fn: () => void, ms: number) {
  registrationTimer = setTimeout(fn, ms);
  registrationTimer.unref();
}

export function startCapiRegistration(): void {
  if (!fabricConfig.capiUrl) {
    console.log('[fabric] cAPI registration skipped: CAPI_BACKEND_URL is not configured');
    return;
  }
  const heartbeatEvery = Math.max(fabricConfig.capiTtlMs * 0.8, 1000);
  const loop = async (needsRegister: boolean) => {
    if (needsRegister) {
      const ok = await registerOnce();
      return schedule(() => loop(!ok), ok ? heartbeatEvery : REGISTER_RETRY_MS);
    }
    const hb = await heartbeatOnce();
    schedule(() => loop(hb === 'missing'), hb === 'missing' ? 0 : heartbeatEvery);
  };
  void loop(true);
}

export function stopCapiRegistration(): void {
  if (registrationTimer) clearTimeout(registrationTimer);
  if (fabricConfig.capiUrl) registration.state = 'stopped';
}

// ── CAPPO authorization (fail-closed) ────────────────────────────────────────

export interface AuthorizationOutcome {
  source: 'cappo' | 'computless-fail-closed';
  decision: 'APPROVED' | 'NEEDS_APPROVAL' | 'REJECTED';
  reason: string;
  authorizationId: string | null;
  decisionHash: string | null;
  evidenceHash: string | null;
  lane: string | null;
  checkedAt: string;
  evidenceLabel: EvidenceLabel;
}

function failClosed(reason: string): AuthorizationOutcome {
  return {
    source: 'computless-fail-closed',
    decision: 'REJECTED',
    reason,
    authorizationId: null,
    decisionHash: null,
    evidenceHash: null,
    lane: null,
    checkedAt: new Date().toISOString(),
    evidenceLabel: 'VERIFIED_LIVE',
  };
}

export async function authorizeWithCappo(input: {
  agentId: string;
  capabilityId: string;
  request: Record<string, unknown>;
  directive?: string | null;
  riskTier?: 'standard' | 'elevated' | 'critical';
}): Promise<AuthorizationOutcome> {
  if (!fabricConfig.cappoUrl) return failClosed('CAPPO is not configured (CAPPO_BACKEND_URL)');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (fabricConfig.cappoApiKey) headers['X-API-Key'] = fabricConfig.cappoApiKey;
  try {
    const res = await timedFetch(
      `${fabricConfig.cappoUrl}/api/v1/execution/authorize`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_id: input.agentId,
          capability_id: input.capabilityId,
          request: input.request,
          ...(input.directive ? { directive: input.directive } : {}),
          ...(input.riskTier ? { risk_tier: input.riskTier } : {}),
        }),
      },
      CALL_TIMEOUT_MS
    );
    if (!res.ok) return failClosed(`CAPPO returned HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== 'APPROVED' && decision !== 'NEEDS_APPROVAL' && decision !== 'REJECTED') {
      return failClosed('CAPPO returned an unrecognized decision');
    }
    return {
      source: 'cappo',
      decision,
      reason: typeof body.reason === 'string' ? body.reason : '',
      authorizationId: typeof body.authorization_id === 'string' ? body.authorization_id : null,
      decisionHash: typeof body.decision_hash === 'string' ? body.decision_hash : null,
      evidenceHash: typeof body.evidence_hash === 'string' ? body.evidence_hash : null,
      lane: typeof body.lane === 'string' ? body.lane : null,
      checkedAt: new Date().toISOString(),
      // Received live from the configured CAPPO; CAPPO decisions are not signed.
      evidenceLabel: 'VERIFIED_LIVE',
    };
  } catch (err: any) {
    return failClosed(err?.name === 'TimeoutError' ? 'CAPPO did not answer in time' : 'CAPPO is unreachable');
  }
}

// ── PGL / Gnomledger evidence ───────────────────────────────────────────────

export interface EvidenceOutcome {
  recorded: boolean;
  ledger: 'gnomledger';
  reason?: string;
  eventId?: string;
  eventHash?: string;
  prevEventHash?: string | null;
  createdAt?: string;
  idempotentReplay?: boolean;
  evidenceLabel: EvidenceLabel;
}

export async function recordEvidence(input: {
  summary: string;
  details: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<EvidenceOutcome> {
  const notRecorded = (reason: string): EvidenceOutcome => ({ recorded: false, ledger: 'gnomledger', reason, evidenceLabel: 'UNVERIFIED' });
  if (!fabricConfig.pglUrl) return notRecorded('PGL is not configured (PGL_LEDGER_URL)');
  if (!fabricConfig.pglAgentId) return notRecorded('PGL_AGENT_ID is not configured');
  if (!fabricConfig.pglApiKey) return notRecorded('PGL_API_KEY is not configured');
  try {
    const res = await timedFetch(
      `${fabricConfig.pglUrl}/api/v1/ledger/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': fabricConfig.pglApiKey },
        body: JSON.stringify({
          agent_id: fabricConfig.pglAgentId,
          event_type: 'custom',
          actor: SERVICE_NAME,
          summary: input.summary.slice(0, 255),
          details: input.details,
          ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
        }),
      },
      CALL_TIMEOUT_MS
    );
    if (res.status !== 201 && res.status !== 200) return notRecorded(`PGL returned HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return {
      recorded: true,
      ledger: 'gnomledger',
      eventId: String(body.event_id ?? ''),
      eventHash: String(body.event_hash ?? ''),
      prevEventHash: typeof body.prev_event_hash === 'string' ? body.prev_event_hash : null,
      createdAt: typeof body.created_at === 'string' ? body.created_at : undefined,
      idempotentReplay: Boolean(body.idempotent_replay),
      evidenceLabel: 'VERIFIED_LIVE',
    };
  } catch (err: any) {
    return notRecorded(err?.name === 'TimeoutError' ? 'PGL did not answer in time' : 'PGL is unreachable');
  }
}

// ── Execution gate ──────────────────────────────────────────────────────────

export function sha256Hex(value: unknown): string {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');
}

function problem(res: Response, status: number, type: string, title: string, detail: string, extra: Record<string, unknown> = {}) {
  return res
    .status(status)
    .type('application/problem+json')
    .json({ type: `urn:computless:problem:${type}`, title, status, detail, instance: res.req.originalUrl, ...extra });
}

/**
 * Express middleware for every endpoint that executes caller-supplied code.
 *
 * disabled   → 503, nothing runs.
 * local-demo → runs without authorization; every response is labelled DEMO.
 * governed   → asks CAPPO first; anything other than APPROVED (deny, needs
 *              approval, CAPPO unreachable, CAPPO unconfigured) returns 403/503
 *              and nothing runs. After the run, evidence is appended to PGL.
 */
export function governedExecution(capabilityId: string, riskTier: 'standard' | 'elevated' | 'critical' = 'elevated') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const mode = fabricConfig.executionMode;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const requestStarted = Date.now();
    const logRefusal = (status: number, authorization: AuthorizationOutcome | null) =>
      recordExecution({
        route: req.path,
        capabilityId,
        mode,
        outcome: 'refused',
        httpStatus: status,
        cappoDecision: authorization?.decision ?? null,
        cappoAuthorizationId: authorization?.authorizationId ?? null,
        cappoSource: authorization?.source ?? null,
        pglRecorded: null,
        pglEventId: null,
        durationMs: Date.now() - requestStarted,
        workloadStatus: null,
      });

    if (mode === 'disabled') {
      logRefusal(503, null);
      return problem(
        res,
        503,
        'execution-disabled',
        'Code execution is disabled',
        'COMPUTLESS_EXECUTION_MODE is "disabled". Configure CAPPO (governed mode) or set local-demo for local development.',
        { governance: { mode } }
      );
    }

    let authorization: AuthorizationOutcome | null = null;
    if (mode === 'governed') {
      const agentId = String(body.agentId ?? body.agent_id ?? body.subject ?? 'computless-caller');
      const code = typeof body.code === 'string' ? body.code : '';
      authorization = await authorizeWithCappo({
        agentId,
        capabilityId,
        riskTier,
        directive: typeof body.directive === 'string' ? body.directive : null,
        request: {
          route: req.path,
          code_sha256: sha256Hex(code),
          code: code.slice(0, 16_384),
          input_sha256: sha256Hex(body.inputPayload ?? body.input ?? null),
        },
      });
      if (authorization.decision !== 'APPROVED') {
        const unreachable = authorization.source === 'computless-fail-closed';
        logRefusal(unreachable ? 503 : 403, authorization);
        return problem(
          res,
          unreachable ? 503 : 403,
          unreachable ? 'authority-unavailable' : 'authorization-denied',
          unreachable ? 'Authorization unavailable (fail-closed)' : `CAPPO decision: ${authorization.decision}`,
          authorization.reason,
          { governance: { mode, authorization } }
        );
      }
    }

    // Handlers read this to report the real authorization instead of a local one.
    res.locals.governance = { mode, authorization };

    const startedAt = new Date();
    const originalJson = res.json.bind(res);
    res.json = ((payload: unknown) => {
      const attach = (governance: Record<string, unknown>) =>
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? { ...(payload as Record<string, unknown>), governance }
          : { result: payload, governance };

      const base = {
        mode,
        evidenceLabel: (mode === 'governed' ? 'VERIFIED_LIVE' : 'DEMO') as EvidenceLabel,
        note:
          mode === 'governed'
            ? 'Authorized by CAPPO before running. CAPPO decisions are unsigned; the directive is caller-declared.'
            : 'local-demo: ran WITHOUT authorization. Not proof of anything.',
        sandbox: SANDBOX_BOUNDARY,
        authorization,
      };

      const logRun = (evidence: { recorded: boolean; eventId?: string } | null) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        const workloadStatus =
          typeof p.status === 'string' ? p.status : typeof p.overallStatus === 'string' ? p.overallStatus : null;
        recordExecution({
          route: req.path,
          capabilityId,
          mode,
          outcome: 'ran',
          httpStatus: res.statusCode,
          cappoDecision: authorization?.decision ?? null,
          cappoAuthorizationId: authorization?.authorizationId ?? null,
          cappoSource: authorization?.source ?? null,
          pglRecorded: evidence ? evidence.recorded : null,
          pglEventId: evidence?.eventId ?? null,
          durationMs: Date.now() - requestStarted,
          workloadStatus,
        });
      };

      if (mode !== 'governed') {
        logRun(null);
        return originalJson(attach({ ...base, evidence: null }));
      }

      void recordEvidence({
        summary: `computless ${capabilityId} HTTP ${res.statusCode}`,
        idempotencyKey: authorization?.authorizationId ?? null,
        details: {
          schema: 'computless.execution.v1',
          capability_id: capabilityId,
          route: req.path,
          http_status: res.statusCode,
          cappo_authorization_id: authorization?.authorizationId ?? null,
          cappo_decision_hash: authorization?.decisionHash ?? null,
          request_sha256: sha256Hex(body),
          response_sha256: sha256Hex(payload),
          started_at: startedAt.toISOString(),
          finished_at: new Date().toISOString(),
        },
      }).then((evidence) => {
        logRun(evidence);
        originalJson(attach({ ...base, evidence }));
      });
      return res;
    }) as Response['json'];

    next();
  };
}

// ── Protocol manifest ───────────────────────────────────────────────────────

export function protocolManifest() {
  const base = fabricConfig.publicBaseUrl;
  return {
    service: SERVICE_NAME,
    repo: 'reprewindai-dev/COMPUTLESS',
    role: 'execution-substrate-prototype',
    version: SERVICE_VERSION,
    base_url: base,
    health: '/health',
    dependencies: '/health/dependencies',
    auth_mode: 'none',
    status: 'prototype',
    execution_mode: fabricConfig.executionMode,
    capabilities: CAPABILITIES.map((c) => c.name),
    capability_endpoints: Object.fromEntries(
      CAPABILITIES.map((c) => [c.name, `${c.path.startsWith('/health') ? 'GET' : 'POST'} ${c.path}`])
    ),
    links: {
      capi: 'https://capi.veklom.com/protocol.json',
      cappo: 'https://cappo.veklom.com/protocol.json',
      pgl: 'https://pgl.veklom.com/protocol.json',
      lockerphycer: 'https://command.veklom.com/protocol.json',
    },
  };
}

export async function fabricStatus() {
  const dependencies = await probeDependencies();
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    sourceCommit: fabricConfig.sourceCommit,
    publicBaseUrl: fabricConfig.publicBaseUrl,
    executionMode: fabricConfig.executionMode,
    sandbox: SANDBOX_BOUNDARY,
    configured: {
      capi: Boolean(fabricConfig.capiUrl),
      capiApiKey: Boolean(fabricConfig.capiApiKey),
      cappo: Boolean(fabricConfig.cappoUrl),
      cappoApiKey: Boolean(fabricConfig.cappoApiKey),
      pgl: Boolean(fabricConfig.pglUrl),
      pglApiKey: Boolean(fabricConfig.pglApiKey),
      pglAgentId: Boolean(fabricConfig.pglAgentId),
      lockerphycer: Boolean(fabricConfig.lockerphycerUrl),
      gemini: Boolean(env('GEMINI_API_KEY')),
    },
    registration: getRegistrationState(),
    dependencies,
    overall: overallState(dependencies),
    verification_scope: 'DEPENDENCY_HEALTH_NOT_RUNTIME_VERIFICATION',
    checkedAt: new Date().toISOString(),
  };
}

export function registerFabricRoutes(app: import('express').Express) {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: SERVICE_NAME, version: SERVICE_VERSION, timestamp: new Date().toISOString() });
  });

  app.get('/health/dependencies', async (_req, res) => {
    const dependencies = await probeDependencies();
    res.json({
      status: overallState(dependencies),
      verification_scope: 'DEPENDENCY_HEALTH_NOT_RUNTIME_VERIFICATION',
      dependencies,
    });
  });

  app.get('/protocol.json', (_req, res) => res.json(protocolManifest()));

  app.post('/protocol/introspect', (req, res) => {
    const manifest = protocolManifest();
    const query = String((req.body ?? {}).query ?? '');
    const q = query.toLowerCase();
    const matches = manifest.capabilities.filter((c) => q === '*' || (q && c.includes(q)));
    res.json({ query, matches, total: matches.length, auth_mode: manifest.auth_mode, links: manifest.links });
  });

  app.get('/api/fabric/status', async (_req, res) => res.json(await fabricStatus()));
}
