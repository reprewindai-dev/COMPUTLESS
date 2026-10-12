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

test('a vm escape cannot read files, spawn processes or see the host environment', async () => {
  process.env.SANDBOX_TEST_SECRET = 'do-not-leak';
  const r = await runInChildSandbox(
    `${getProcess}
     output.env = Object.keys(p.env);
     try { p.getBuiltinModule('fs').readFileSync('/etc/hostname'); output.fs = 'READ'; } catch (e) { output.fs = e.code; }
     try { p.getBuiltinModule('child_process').execSync('id'); output.spawn = 'RAN'; } catch (e) { output.spawn = e.code; }`,
    {}
  );
  assert.equal(r.status, 'SUCCESS');
  const out = r.output as Record<string, unknown>;
  assert.deepEqual(out.env, []);
  assert.equal(out.fs, 'ERR_ACCESS_DENIED');
  assert.equal(out.spawn, 'ERR_ACCESS_DENIED');
});

test('infinite loops are terminated', async () => {
  const r = await runInChildSandbox('while (true) {}', {}, 300);
  assert.equal(r.status, 'TERMINATED_TIMEOUT');
});
