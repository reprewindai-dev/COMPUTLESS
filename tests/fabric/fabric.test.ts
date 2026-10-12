import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

// A stand-in for cAPI, CAPPO, Gnomledger and Lockerphycer, shaped after their
// route handlers (cAPI src/app/api/v1/registry/*, cappo-backend
// api/routers/authorization_router.py, gnomledger routes/ledger.py).
interface Seen {
  registers: any[];
  heartbeats: any[];
  authorize: any[];
  ledger: any[];
  headers: Record<string, any>;
}
const seen: Seen = { registers: [], heartbeats: [], authorize: [], ledger: [], headers: {} };
let cappoMode: 'normal' | 'http500' = 'normal';
let heartbeatMissing = false;

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const fabric = http.createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const [svc, ...rest] = (req.url ?? '').split('/').filter(Boolean);
  const route = '/' + rest.join('/');
  if (route === '/health') return send(200, { status: 'ok' });
  if (route === '/protocol.json') {
    const names: Record<string, string> = { capi: 'cAPI-interlink-console', cappo: 'cappo', pgl: 'gnomledger', locker: 'impostor' };
    return send(200, { service: names[svc] });
  }
  const body = await readJson(req);
  if (svc === 'capi' && route === '/api/v1/registry/register') {
    seen.registers.push(body);
    seen.headers.capi = req.headers.authorization;
    heartbeatMissing = false;
    return send(201, { ok: true, service_name: body.service_name, registered_at: '2026-10-12T00:00:00Z', expires_at: '2026-10-12T00:05:00Z', executable_capability_ids: [] });
  }
  if (svc === 'capi' && route === '/api/v1/registry/heartbeat') {
    seen.heartbeats.push(body);
    if (heartbeatMissing) return send(404, { error: 'not registered' });
    return send(200, { ok: true, service_name: body.service_name, last_seen: '2026-10-12T00:01:00Z', expires_at: '2026-10-12T00:06:00Z' });
  }
  if (svc === 'cappo' && route === '/api/v1/execution/authorize') {
    seen.authorize.push(body);
    seen.headers.cappo = req.headers['x-api-key'];
    if (cappoMode === 'http500') return send(500, { detail: 'boom' });
    const d = String(body.directive ?? '').toUpperCase();
    const decision = d === 'ALLOW' || d === 'ALLOW_WITH_AUDIT' ? 'APPROVED' : d === 'DENY' ? 'REJECTED' : 'NEEDS_APPROVAL';
    return send(200, { decision, authorization_id: 'auth_test123', lane: 'elevated', decision_hash: 'd'.repeat(64), reason: 'test policy', evidence_hash: 'e'.repeat(64) });
  }
  if (svc === 'pgl' && route === '/api/v1/ledger/events') {
    seen.ledger.push(body);
    seen.headers.pgl = req.headers['x-api-key'];
    return send(201, { event_id: 'evt_test1', event_hash: 'f'.repeat(64), prev_event_hash: null, created_at: '2026-10-12T00:00:01', persisted: true, idempotent_replay: false });
  }
  send(404, { detail: 'not found' });
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const fabricBase = await listen(fabric);
Object.assign(process.env, {
  CAPI_BACKEND_URL: `${fabricBase}/capi`,
  CAPI_API_KEY: 'capi-key',
  CAPI_REGISTRY_TTL_MS: '1500',
  CAPPO_BACKEND_URL: `${fabricBase}/cappo`,
  CAPPO_API_KEY: 'cappo-key',
  PGL_LEDGER_URL: `${fabricBase}/pgl`,
  PGL_API_KEY: 'pgl-key',
  PGL_AGENT_ID: 'agent-computless',
  LOCKERPHYCER_URL: `${fabricBase}/locker`,
  COMPUTLESS_PUBLIC_URL: 'https://computless.example.test',
});
delete process.env.COMPUTLESS_EXECUTION_MODE;

const fab = await import('../../src/server/fabric.js');

let ran = 0;
const app = express();
app.use(express.json());
fab.registerFabricRoutes(app);
app.post('/run', fab.governedExecution('computless.test.run'), (_req, res) => {
  ran += 1;
  res.json({ status: 'SUCCESS' });
});
const appServer = http.createServer(app);
const appBase = await listen(appServer);

const post = (path: string, body: unknown) =>
  fetch(`${appBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test.after(() => {
  fab.stopCapiRegistration();
  appServer.close();
  fabric.close();
});

test('defaults to governed mode when CAPPO is configured', () => {
  assert.equal(fab.fabricConfig.executionMode, 'governed');
});

test('registers with cAPI using the strict registry schema and bearer key', async () => {
  fab.startCapiRegistration();
  for (let i = 0; i < 50 && fab.getRegistrationState().state !== 'registered'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(fab.getRegistrationState().state, 'registered');
  const payload = seen.registers[0];
  assert.equal(seen.headers.capi, 'Bearer capi-key');
  assert.deepEqual(Object.keys(payload).sort(), ['base_url', 'capabilities', 'metadata', 'service_name', 'telemetry_supported']);
  assert.equal(payload.service_name, 'computless');
  for (const c of payload.capabilities) {
    assert.match(c.endpoint, /^https:\/\/computless\.example\.test\//);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(c.risk_level));
  }
});

test('re-registers when a heartbeat reports the registration missing', async () => {
  const before = seen.registers.length;
  heartbeatMissing = true;
  for (let i = 0; i < 150 && seen.registers.length === before; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(seen.registers.length > before, 'expected a re-registration after a 404 heartbeat');
  assert.ok(seen.heartbeats.every((h) => h.service_name === 'computless'));
});

test('dependency health reports reachability and protocol identity, never "verified"', async () => {
  const res = await fetch(`${appBase}/health/dependencies`);
  const body = await res.json();
  const byName = Object.fromEntries(body.dependencies.map((d: any) => [d.name, d]));
  assert.equal(byName.capi.state, 'reachable_not_verified');
  assert.equal(byName.capi.protocol_identity, 'matched');
  assert.equal(byName.cappo.protocol_identity, 'matched');
  assert.equal(byName.pgl.protocol_identity, 'matched');
  assert.equal(byName.lockerphycer.protocol_identity, 'mismatched');
  assert.equal(body.verification_scope, 'DEPENDENCY_HEALTH_NOT_RUNTIME_VERIFICATION');
  assert.ok(!JSON.stringify(body).includes('127.0.0.1'), 'must not expose peer hosts');
});

test('APPROVED runs the workload and records evidence in PGL', async () => {
  const before = ran;
  const res = await post('/run', { code: 'output.x = 1', directive: 'ALLOW_WITH_AUDIT', agentId: 'agent-1' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(ran, before + 1);
  assert.equal(body.governance.authorization.decision, 'APPROVED');
  assert.equal(body.governance.authorization.authorizationId, 'auth_test123');
  assert.equal(body.governance.evidence.recorded, true);
  assert.equal(body.governance.evidence.eventId, 'evt_test1');
  const authReq = seen.authorize.at(-1);
  assert.equal(seen.headers.cappo, 'cappo-key');
  assert.equal(authReq.agent_id, 'agent-1');
  assert.equal(authReq.capability_id, 'computless.test.run');
  const ev = seen.ledger.at(-1);
  assert.equal(seen.headers.pgl, 'pgl-key');
  assert.equal(ev.agent_id, 'agent-computless');
  assert.equal(ev.event_type, 'custom');
  assert.equal(ev.details.cappo_authorization_id, 'auth_test123');
  assert.equal(ev.idempotency_key, 'auth_test123');
});

test('REJECTED and NEEDS_APPROVAL do not run', async () => {
  const before = ran;
  const denied = await post('/run', { code: 'x', directive: 'DENY' });
  assert.equal(denied.status, 403);
  const pending = await post('/run', { code: 'x' });
  assert.equal(pending.status, 403);
  assert.equal((await pending.json()).governance.authorization.decision, 'NEEDS_APPROVAL');
  assert.equal(ran, before);
});

test('CAPPO errors fail closed', async () => {
  cappoMode = 'http500';
  const before = ran;
  const res = await post('/run', { code: 'x', directive: 'ALLOW' });
  cappoMode = 'normal';
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.governance.authorization.source, 'computless-fail-closed');
  assert.equal(body.governance.authorization.decision, 'REJECTED');
  assert.equal(ran, before);
});

test('protocol manifest identifies computless and is honest about auth', async () => {
  const body = await (await fetch(`${appBase}/protocol.json`)).json();
  assert.equal(body.service, 'computless');
  assert.equal(body.auth_mode, 'none');
  assert.equal(body.status, 'prototype');
  const intro = await (await post('/protocol/introspect', { query: 'workload' })).json();
  assert.deepEqual(intro.matches, ['execute_workload']);
});
