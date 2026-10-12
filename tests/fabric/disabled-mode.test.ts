import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

for (const k of ['CAPPO_BACKEND_URL', 'CAPI_BACKEND_URL', 'PGL_LEDGER_URL', 'LOCKERPHYCER_URL']) delete process.env[k];
process.env.NODE_ENV = 'production';
delete process.env.COMPUTLESS_EXECUTION_MODE;

const fab = await import('../../src/server/fabric.js');

test('production without CAPPO defaults to disabled and refuses to run code', async () => {
  assert.equal(fab.fabricConfig.executionMode, 'disabled');
  let ran = false;
  const app = express();
  app.use(express.json());
  app.post('/run', fab.governedExecution('computless.test.run'), (_req, res) => {
    ran = true;
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"1"}' });
  server.close();
  assert.equal(res.status, 503);
  assert.equal(ran, false);
});

test('unconfigured peers are reported as unconfigured, not healthy', async () => {
  const deps = await fab.probeDependencies(true);
  for (const name of ['capi', 'cappo', 'pgl', 'lockerphycer']) {
    assert.equal(deps.find((d) => d.name === name)?.state, 'unconfigured');
  }
  assert.equal(fab.getRegistrationState().state, 'unconfigured');
});
