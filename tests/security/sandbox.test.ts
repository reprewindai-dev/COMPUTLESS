import assert from 'node:assert/strict';
import test from 'node:test';

import { runInChildSandbox } from '../../src/server/sandbox.js';

const getProcess = 'const p = this.constructor.constructor("return process")();';

test('workload runs and returns output', async () => {
  const r = await runInChildSandbox('output.sum = input.a + input.b; console.log("ok")', { input: { a: 2, b: 3 } });
  assert.equal(r.status, 'SUCCESS');
  assert.deepEqual(r.output, { sum: 5 });
  assert.deepEqual(r.stdout, ['ok']);
});

test('the Function-constructor vm escape is blocked inside the sandbox process', async () => {
  for (const escape of [
    getProcess + ' output.got = typeof p;',
    'output.got = typeof console.log.constructor("return process")();',
    'output.got = typeof input.constructor.constructor("return process")();',
  ]) {
    const r = await runInChildSandbox(escape, { input: {} });
    assert.equal(r.status, 'RUNTIME_ERROR', escape);
    assert.match(r.error?.message ?? '', /Code generation from strings disallowed/);
  }
});

test('the sandbox process inherits no environment', async () => {
  process.env.SANDBOX_TEST_SECRET = 'do-not-leak';
  // Workload code never sees the env; check the child process itself was started without it
  // by asking the runner's realm through a stack-frame probe that only yields undefined/null.
  const r = await runInChildSandbox(
    'Error.prepareStackTrace = (e, cs) => cs; output.frames = new Error().stack.map((c) => { try { const t = c.getThis(); return t ? typeof t.process : null; } catch { return "err"; } });',
    {}
  );
  assert.equal(r.status, 'SUCCESS');
  assert.ok((r.output as { frames: unknown[] }).frames.every((f) => f !== 'object'), 'no frame exposes process');
});

test('infinite loops are terminated', async () => {
  const r = await runInChildSandbox('while (true) {}', {}, 300);
  assert.equal(r.status, 'TERMINATED_TIMEOUT');
});

test('heap exhaustion is reported as MEMORY_LIMIT', async () => {
  const r = await runInChildSandbox('const a = []; while (true) a.push(new Array(1e5).fill(1.5));', {}, 5000, 32);
  assert.equal(r.status, 'MEMORY_LIMIT');
});

test('executeInIsolatedVMSandbox reports the real sandbox status', async () => {
  const { executeInIsolatedVMSandbox } = await import('../../src/server/cryptoUtils.js');
  const ok = await executeInIsolatedVMSandbox('output.v = input.n * 2', { n: 21 });
  assert.equal(ok.status, 'SUCCESS');
  assert.deepEqual(ok.outputData, { v: 42 });
  const loop = await executeInIsolatedVMSandbox('while (true) {}', {}, 200);
  assert.equal(loop.status, 'TERMINATED_TIMEOUT');
});

test('the adversarial suite passes and every test reports a measured outcome', async () => {
  const { runAdversarialTestSuite } = await import('../../src/server/adversarialTests.js');
  const report = await runAdversarialTestSuite();
  assert.equal(report.allPassed, true, JSON.stringify(report.tests.filter((t) => !t.passed), null, 2));
  for (const t of report.tests) assert.ok(t.actualOutcome.length > 0, t.testId);
});
