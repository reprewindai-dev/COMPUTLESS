import assert from 'node:assert/strict';
import test from 'node:test';

import { computeVkgDigest, createDefaultVkgPackages, executeVkgAction, validateVkgPackage, vkgDigestEvidence } from '../../src/server/vkgEngine.js';

test('built-in packages are digest-valid and VERIFIED_REPO', () => {
  for (const p of createDefaultVkgPackages()) {
    assert.equal(validateVkgPackage(p).valid, true, p.manifest.packageId);
    assert.equal(vkgDigestEvidence(p).evidenceLabel, 'VERIFIED_REPO');
  }
});

test('a self-consistent package that is not the repo built-in is only UNVERIFIED', () => {
  const [vat] = createDefaultVkgPackages();
  const dataTables = { standardRates: { GB: 0.5 } };
  const { contentDigest, ...m } = vat.manifest;
  const forged = { ...vat, dataTables, manifest: { ...m, contentDigest: computeVkgDigest(m, dataTables, vat.actionHandlers) } };
  assert.equal(contentDigest === forged.manifest.contentDigest, false);
  const d = vkgDigestEvidence(forged);
  assert.equal(d.digestValid, true);
  assert.equal(d.evidenceLabel, 'UNVERIFIED');
});

test('malformed packages are rejected, not thrown on', () => {
  for (const bad of [null, {}, { manifest: { packageId: 'x' } }, { manifest: { ...createDefaultVkgPackages()[0].manifest, allowedActions: 'a' }, actionHandlers: {} }]) {
    assert.equal(validateVkgPackage(bad as any).valid, false);
  }
});

test('built-in VAT action computes from the bundled table and refuses unknown countries', async () => {
  const [vat] = createDefaultVkgPackages();
  const ok = await executeVkgAction(vat, 'calculate_vat', { amount: 100, country: 'GB' });
  assert.equal(ok.status, 'SUCCESS');
  assert.equal(ok.outputData.vatAmount, 20);
  assert.equal(ok.outputData.totalAmount, 120);
  const unknown = await executeVkgAction(vat, 'calculate_vat', { amount: 100, country: 'XX' });
  assert.equal(unknown.status, 'RUNTIME_ERROR');
});

test('tampered package and out-of-manifest action are refused without running', async () => {
  const [vat] = createDefaultVkgPackages();
  const tampered = { ...vat, actionHandlers: { ...vat.actionHandlers, calculate_vat: 'output.x = 1;' } };
  const t = await executeVkgAction(tampered, 'calculate_vat', {});
  assert.equal(t.status, 'DIGEST_MISMATCH');
  assert.equal(t.ran, false);
  const a = await executeVkgAction(vat, 'not_declared', {});
  assert.equal(a.status, 'ACTION_NOT_IN_MANIFEST');
  assert.equal(a.ran, false);
});
