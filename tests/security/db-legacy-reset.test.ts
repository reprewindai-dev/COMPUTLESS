import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// dbStore resolves data/ from process.cwd() at import time, so run it in a temp dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'computless-db-'));
fs.mkdirSync(path.join(dir, 'data'));
const dbFile = path.join(dir, 'data', 'substrate_db.json');
fs.writeFileSync(
  dbFile,
  JSON.stringify({
    // Legacy (schema 2) file full of seeded demo records.
    schemaVersion: 2,
    substrateNodes: [{ id: 'node-demo-1', name: 'Demo Node', evidenceLabel: 'DEMO' }],
    fpiProviders: [{ id: 'fpi-demo', name: 'Demo Provider', endpoint: 'https://provider.example.invalid' }],
    vkgPackages: [{ manifest: { packageId: 'vkg-seeded' } }],
  })
);
process.chdir(dir);
const { dbStore, DB_SCHEMA_VERSION } = await import('../../src/server/dbStore.js');
const { computeVkgDigest, createDefaultVkgPackages } = await import('../../src/server/vkgEngine.js');

test('a legacy DB file is discarded and overwritten instead of resurrecting seeded records', () => {
  assert.equal(dbStore.getLoadedFrom(), 'empty-after-legacy-reset');
  const onDisk = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.deepEqual(onDisk, { schemaVersion: DB_SCHEMA_VERSION, uploadedVkgPackages: [] });
  assert.ok(DB_SCHEMA_VERSION > 2);
});

test('only the built-in packages exist until a user uploads one', () => {
  const pkgs = dbStore.getVkgPackages();
  assert.deepEqual(
    pkgs.map((p) => p.manifest.packageId),
    createDefaultVkgPackages().map((p) => p.manifest.packageId)
  );
  assert.ok(pkgs.every((p) => p.source === 'built-in'));
});

test('an uploaded package is persisted as user data; built-in ids are reserved', () => {
  const manifest = {
    packageId: 'vkg-user-upload',
    name: 'User upload',
    version: '1.0.0',
    capabilities: ['computless.vkg.execute'],
    allowedActions: ['double'],
    memoryCeilingBytes: 16 * 1024 * 1024,
    timeoutCeilingMs: 1000,
    schemaVersion: '1.0.0',
  };
  const actionHandlers = { double: 'output.v = input.n * 2;' };
  const pkg = { manifest: { ...manifest, contentDigest: computeVkgDigest(manifest, {}, actionHandlers) }, dataTables: {}, actionHandlers };
  const stored = dbStore.addUploadedVkgPackage(pkg);
  assert.equal(stored.source, 'uploaded');
  assert.ok(stored.uploadedAt);
  const onDisk = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.equal(onDisk.uploadedVkgPackages[0].manifest.packageId, 'vkg-user-upload');
  assert.equal(dbStore.getVkgPackage('vkg-user-upload')?.source, 'uploaded');

  const builtin = createDefaultVkgPackages()[0];
  assert.throws(() => dbStore.addUploadedVkgPackage(builtin), /built-in/);
});
