import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { renderTemplate } from '../../scripts/build-aws-template.mjs';
import {
  awsLambdaInfo,
  parseLambdaReport,
  runOnAwsLambda,
  setLambdaInvokerForTests,
} from '../../src/server/providers/awsLambda.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const runnerPath = path.join(root, 'cloud', 'aws-lambda', 'runner.cjs');
const templatePath = path.join(root, 'cloud', 'aws-lambda', 'template.json');
const { handler } = createRequire(import.meta.url)(runnerPath) as {
  handler: (event: unknown, ctx: unknown) => Promise<Record<string, any>>;
};
const lambdaCtx = { functionVersion: '$LATEST', memoryLimitInMB: '1024', awsRequestId: 'test-request' };

const ARN = 'arn:aws:lambda:us-east-1:123456789012:function:computless-runner-js';

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ── CloudFormation template ─────────────────────────────────────────────────

test('committed template is generated from runner.cjs and fits the inline ZipFile limit', () => {
  const runner = fs.readFileSync(runnerPath, 'utf8');
  assert.ok(Buffer.byteLength(runner) < 4096);
  assert.equal(fs.readFileSync(templatePath, 'utf8'), renderTemplate(runner), 'run: node scripts/build-aws-template.mjs');
});

test('dispatcher role can only invoke the runner; runner role can only write its logs', () => {
  const t = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const dispatcher = t.Resources.DispatcherRole.Properties.Policies;
  assert.equal(dispatcher.length, 1);
  assert.deepEqual(dispatcher[0].PolicyDocument.Statement, [
    { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: { 'Fn::GetAtt': ['RunnerFunction', 'Arn'] } },
  ]);
  const runner = t.Resources.RunnerExecutionRole.Properties;
  assert.equal(runner.ManagedPolicyArns, undefined);
  assert.deepEqual(runner.Policies[0].PolicyDocument.Statement[0].Action, ['logs:CreateLogStream', 'logs:PutLogEvents']);
  assert.equal(JSON.stringify(t.Outputs).includes('AccessKey'), false, 'no secret may appear in stack outputs');
});

// ── Runner (the code that runs inside Lambda) ───────────────────────────────

test('runner computes output and captures console', async () => {
  const r = await handler({ code: 'console.log("n", input.n); output.double = input.n * 2;', input: { n: 21 } }, lambdaCtx);
  assert.equal(r.status, 'SUCCESS');
  assert.deepEqual(r.output, { double: 42 });
  assert.deepEqual(r.stdout, ['n 21']);
  assert.equal(r.runtime.awsRequestId, 'test-request');
});

test('runner blocks constructor-chain and eval escapes', async () => {
  const escapes = [
    'this.constructor.constructor("return process")()',
    'globalThis.constructor.constructor("return process")()',
    'input.constructor.constructor("return process")()',
    'output.constructor.constructor("return process")()',
    'console.log.constructor("return process")()',
    '(async () => {}).constructor("return process")()',
    'eval("1 + 1")',
  ];
  for (const expr of escapes) {
    const r = await handler({ code: `output.p = typeof (${expr});` }, lambdaCtx);
    assert.equal(r.status, 'RUNTIME_ERROR', expr);
    assert.match(r.error.message, /Code generation from strings disallowed/, expr);
  }
  const r = await handler({ code: 'output.t = [typeof require, typeof process, typeof setTimeout, typeof fetch];' }, lambdaCtx);
  assert.deepEqual(r.output, { t: ['undefined', 'undefined', 'undefined', 'undefined'] });
});

test('runner kills runaway workloads: sync loop, loop in output serialisation, memory', async () => {
  const loop = await handler({ code: 'while (true) {}', timeoutMs: 200 }, lambdaCtx);
  assert.equal(loop.status, 'TERMINATED_TIMEOUT');
  const t = Date.now();
  const getter = await handler({ code: 'output.x = { toJSON() { while (true) {} } };', timeoutMs: 200 }, lambdaCtx);
  assert.equal(getter.status, 'TERMINATED_TIMEOUT', 'killed at the wall-clock deadline');
  assert.ok(Date.now() - t < 5000);
  const hog = await handler({ code: 'const a = []; while (true) a.push({ x: [1, 2, 3] });', timeoutMs: 10000 }, lambdaCtx);
  assert.equal(hog.status, 'MEMORY_LIMIT');
});

test('runner never runs queued async work after the script returns', async () => {
  const t = Date.now();
  const r = await handler({ code: 'Promise.resolve().then(() => { while (true) {} }); output.done = true;', timeoutMs: 2000 }, lambdaCtx);
  assert.equal(r.status, 'SUCCESS');
  assert.deepEqual(r.output, { done: true });
  assert.ok(Date.now() - t < 1500);
});

// ── Adapter (COMPUTLESS server side) ────────────────────────────────────────

test('unconfigured: listed as not configured and never calls AWS', async () => {
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: undefined, AWS_REGION: undefined, AWS_DEFAULT_REGION: undefined });
  let called = false;
  setLambdaInvokerForTests(async () => {
    called = true;
    return {};
  });
  const info = awsLambdaInfo();
  assert.equal(info.configured, false);
  assert.ok(info.missing.includes('COMPUTLESS_AWS_FUNCTION_ARN'));
  const run = await runOnAwsLambda({ code: '1', input: {}, timeoutMs: 100 });
  assert.equal(run.status, 'PROVIDER_ERROR');
  assert.equal(run.error?.code, 'NOT_CONFIGURED');
  assert.equal(called, false);
  setLambdaInvokerForTests(null);
});

test('a malformed function ARN is not treated as configured', () => {
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: 'computless-runner-js', AWS_REGION: 'us-east-1' });
  assert.equal(awsLambdaInfo().configured, false);
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: undefined, AWS_REGION: undefined });
});

test('configured: sends the job, returns the runner result and the AWS receipt', async () => {
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: ARN, AWS_REGION: undefined, AWS_DEFAULT_REGION: undefined });
  assert.equal(awsLambdaInfo().configured, true, 'region is taken from the ARN');
  const report = 'REPORT RequestId: abc Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 1024 MB Max Memory Used: 71 MB Init Duration: 150.5 ms';
  let sent: any = null;
  // Stands in for AWS: the request goes through the real runner, the envelope mimics Invoke's response shape.
  setLambdaInvokerForTests(async (input) => {
    sent = { name: input.FunctionName, payload: JSON.parse(new TextDecoder().decode(input.Payload)) };
    const body = await handler(sent.payload, lambdaCtx);
    return {
      StatusCode: 200,
      ExecutedVersion: '$LATEST',
      LogResult: Buffer.from(`START RequestId: abc\nEND RequestId: abc\n${report}\n`).toString('base64'),
      Payload: new TextEncoder().encode(JSON.stringify(body)),
      $metadata: { requestId: 'abc', httpStatusCode: 200 },
    };
  });
  const run = await runOnAwsLambda({ code: 'output.sum = input.a + input.b;', input: { a: 2, b: 3 }, timeoutMs: 1000 });
  setLambdaInvokerForTests(null);
  assert.equal(sent.name, ARN);
  assert.deepEqual(sent.payload, { code: 'output.sum = input.a + input.b;', input: { a: 2, b: 3 }, timeoutMs: 1000 });
  assert.equal(run.status, 'SUCCESS');
  assert.deepEqual(run.output, { sum: 5 });
  assert.equal(run.receipt.provider, 'aws-lambda');
  assert.equal(run.receipt.requestId, 'abc');
  assert.equal(run.receipt.region, 'us-east-1');
  assert.equal(run.receipt.billedDurationMs, 13);
  assert.equal(run.receipt.maxMemoryUsedMb, 71);
  assert.equal(run.receipt.initDurationMs, 150.5);
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: undefined });
});

test('a Lambda-level timeout and an SDK failure are reported, not hidden', async () => {
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: ARN });
  setLambdaInvokerForTests(async () => ({
    StatusCode: 200,
    FunctionError: 'Unhandled',
    Payload: new TextEncoder().encode(JSON.stringify({ errorType: 'Sandbox.Timedout', errorMessage: 'Task timed out after 20.00 seconds' })),
    $metadata: { requestId: 'def', httpStatusCode: 200 },
  }));
  const timedOut = await runOnAwsLambda({ code: '1', input: {}, timeoutMs: 1000 });
  assert.equal(timedOut.status, 'TERMINATED_TIMEOUT');
  assert.equal(timedOut.receipt.functionError, 'Unhandled');

  setLambdaInvokerForTests(async () => {
    throw Object.assign(new Error('User is not authorized to perform: lambda:InvokeFunction'), {
      name: 'AccessDeniedException',
      $metadata: { requestId: 'ghi', httpStatusCode: 403 },
    });
  });
  const denied = await runOnAwsLambda({ code: '1', input: {}, timeoutMs: 1000 });
  setLambdaInvokerForTests(null);
  assert.equal(denied.status, 'PROVIDER_ERROR');
  assert.equal(denied.error?.code, 'AccessDeniedException');
  assert.equal(denied.receipt.httpStatusCode, 403);
  setEnv({ COMPUTLESS_AWS_FUNCTION_ARN: undefined });
});

test('REPORT parsing tolerates a missing log tail', () => {
  assert.equal(parseLambdaReport(null).billedDurationMs, null);
});
