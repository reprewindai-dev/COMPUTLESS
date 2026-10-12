/**
 * UI-side types for the COMPUTLESS API. Every field is optional because the
 * UI renders whatever the server actually returned and never fills gaps.
 */

export type Source = 'capi' | 'cappo' | 'pgl' | 'lockerphycer' | 'computless';

/** Envelope the server wraps around every read from a Veklom peer. */
export interface Envelope<T> {
  source?: Source | string;
  configured?: boolean;
  ok?: boolean;
  fetchedAt?: string;
  status?: number;
  error?: string;
  data?: T | null;
}

// ── /api/fabric/status ──────────────────────────────────────────────────────

export interface FabricDependency {
  name?: string;
  state?: string;
  verification_scope?: string;
  protocol_identity?: string;
  observed_service?: string | null;
  checked_at?: string;
}

export interface RegistrationState {
  state?: string;
  lastAttemptAt?: string | null;
  registeredAt?: string | null;
  lastHeartbeatAt?: string | null;
  expiresAt?: string | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
  executableCapabilityIds?: string[];
}

export interface FabricStatusData {
  service?: string;
  version?: string;
  sourceCommit?: string | null;
  publicBaseUrl?: string | null;
  executionMode?: string;
  sandbox?: Record<string, unknown> | null;
  configured?: Record<string, boolean> | null;
  registration?: RegistrationState | null;
  dependencies?: FabricDependency[];
  overall?: string;
  verification_scope?: string;
  checkedAt?: string;
}

// ── /api/fabric/services (cAPI registry) ────────────────────────────────────

export interface RegistryCapability {
  name?: string;
  description?: string;
  endpoint?: string;
  risk_level?: string;
  requires_approval?: boolean;
  category?: string;
  [k: string]: unknown;
}

export interface RegistryService {
  service_name?: string;
  base_url?: string;
  telemetry_supported?: boolean;
  capabilities?: RegistryCapability[];
  executable_capability_ids?: string[];
  metadata?: Record<string, unknown>;
  authenticated?: boolean;
  registered_at?: string;
  last_seen?: string;
  expires_at?: string;
  stale?: boolean;
  [k: string]: unknown;
}

export interface RegistryData {
  count?: number;
  services?: RegistryService[];
}

// ── /api/fabric/ledger (Gnomledger) ─────────────────────────────────────────

export interface LedgerEvent {
  event_id?: string;
  event_type?: string;
  actor?: string;
  summary?: string;
  details?: unknown;
  prev_event_hash?: string | null;
  event_hash?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface LedgerVerification {
  status?: string;
  valid?: boolean;
  latest_event_hash?: string | null;
  checked_events?: number;
  first_event_at?: string | null;
  last_event_at?: string | null;
  errors?: unknown[];
  reason?: string;
}

export interface LedgerResponse {
  agentId?: string | null;
  events?: Envelope<LedgerEvent[]>;
  verification?: Envelope<LedgerVerification>;
}

// ── /api/fabric/peers ───────────────────────────────────────────────────────

export interface PeerReport {
  name?: string;
  health?: Envelope<Record<string, unknown>>;
  dependencies?: Envelope<Record<string, unknown>>;
}

// ── /api/executions ─────────────────────────────────────────────────────────

export interface ExecutionEntry {
  id?: string;
  at?: string;
  route?: string;
  capabilityId?: string;
  mode?: string;
  outcome?: 'ran' | 'refused' | string;
  httpStatus?: number;
  cappoDecision?: string | null;
  cappoAuthorizationId?: string | null;
  cappoSource?: string | null;
  pglRecorded?: boolean | null;
  pglEventId?: string | null;
  durationMs?: number;
  workloadStatus?: string | null;
}

export interface ExecutionsResponse {
  source?: string;
  persisted?: boolean;
  entries?: ExecutionEntry[];
}

// ── Governance block attached to execute responses ──────────────────────────

export interface Authorization {
  source?: string;
  decision?: string;
  reason?: string;
  authorizationId?: string;
  decisionHash?: string;
  evidenceHash?: string;
  lane?: string;
  checkedAt?: string;
  evidenceLabel?: string;
}

export interface EvidenceOutcome {
  recorded?: boolean;
  ledger?: string;
  eventId?: string;
  eventHash?: string;
  prevEventHash?: string;
  createdAt?: string;
  reason?: string;
  evidenceLabel?: string;
}

export interface Governance {
  mode?: string;
  evidenceLabel?: string;
  note?: string;
  sandbox?: Record<string, unknown> | null;
  authorization?: Authorization | null;
  evidence?: EvidenceOutcome | null;
}

// ── /api/vkg/packages ───────────────────────────────────────────────────────

export interface VkgPackage {
  manifest?: {
    packageId?: string;
    name?: string;
    version?: string;
    capabilities?: string[];
    allowedActions?: string[];
    memoryCeilingBytes?: number;
    timeoutCeilingMs?: number;
    author?: string;
    contentDigest?: string;
  };
  actionHandlers?: Record<string, string>;
  dataTables?: Record<string, unknown>;
  source?: string;
  uploadedAt?: string;
  digestValid?: boolean;
  computedDigest?: string;
  digestError?: string;
  evidenceLabel?: string;
}

// ── /api/tests/adversarial ──────────────────────────────────────────────────

export interface AdversarialTest {
  testId?: string;
  name?: string;
  category?: string;
  expectedOutcome?: string;
  actualOutcome?: string;
  passed?: boolean;
  durationMs?: number;
  details?: string;
  evidenceLabel?: string;
}

export interface AdversarialReport {
  timestamp?: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  allPassed?: boolean;
  evidenceLabel?: string;
  scope?: string;
  tests?: AdversarialTest[];
}

/** GET /api/tests/adversarial lists the suite without running it. */
export interface AdversarialCatalog {
  tests?: AdversarialTest[];
  totalTests?: number;
  lastRun?: AdversarialReport | null;
}
