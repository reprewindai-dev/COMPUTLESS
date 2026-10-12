import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// dbStore resolves data/ from process.cwd() at import time, so run it in a temp dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'computless-db-'));
fs.mkdirSync(path.join(dir, 'data'));
fs.writeFileSync(
  path.join(dir, 'data', 'substrate_db.json'),
  JSON.stringify({
    // Legacy file: no schemaVersion, fabricated proof records.
    actionEvidenceRecords: [{ id: 'ev-pgl-root-genesis', enclaveHardwareProof: 'enclave_tpm2_attestation_genesis_root', verifiable: true }],
    confirmationCertificates: [{ certificateId: 'aecc-genesis-0001', overallConfirmationStatus: 'FULLY_CONFIRMED' }],
    fpiSettlements: [{ id: 'fpi-stl-2026-08', payoutStatus: 'settled', payoutTxHash: '0x3a4b' }],
  })
);
process.chdir(dir);
const { dbStore, DB_SCHEMA_VERSION } = await import('../../src/server/dbStore.js');

test('a legacy DB file is discarded instead of resurrecting fabricated records', () => {
  assert.equal(dbStore.getActionEvidenceRecords().length, 0);
  assert.equal(dbStore.getConfirmationCertificates().length, 0);
  assert.equal(dbStore.getFPISettlements().length, 0);
  const persistence = dbStore.getPersistenceStatus();
  assert.equal(persistence.loadedFrom, 'seeds-after-legacy-reset');
  assert.equal(persistence.lastSaveOk, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'substrate_db.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, DB_SCHEMA_VERSION);
});

test('seeds are DEMO and carry no fabricated metrics or online status', () => {
  for (const n of dbStore.getSubstrateNodes()) {
    assert.equal(n.evidenceLabel, 'DEMO');
    assert.equal(n.status, 'unverified');
    assert.equal(n.cpuUsagePct, null);
  }
  for (const p of dbStore.getFPIProviders()) {
    assert.equal(p.status, 'unverified');
    assert.equal(p.slaUptimePct, null);
    assert.equal(p.lastHeartbeatAt, null);
    assert.match(p.endpointUrl, /\.example\.invalid\//);
  }
  const m = dbStore.getAmplificationMetrics();
  assert.equal(m.systemEntropyPct, null);
});

test('statuses are derived from time', () => {
  const alloc = dbStore.getFPIAllocations()[0];
  alloc.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(dbStore.getFPIAllocations()[0].status, 'expired');
  const grant = dbStore.getCappoGrants()[0];
  grant.expiresAt = Date.now() - 1000;
  assert.equal(dbStore.getCappoGrants()[0].status, 'expired');
});
