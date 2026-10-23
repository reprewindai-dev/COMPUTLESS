#!/usr/bin/env node
// End-to-end check that a COMPUTLESS server really runs workloads on AWS Lambda.
//
//   node scripts/aws-smoke.mjs --url http://127.0.0.1:23000
//
// Sends one real workload with "provider": "aws-lambda" and checks, against the
// running services (nothing here is simulated):
//   1. the server reports aws-lambda as configured
//   2. the run returns the right answer, computed from a fresh random nonce
//   3. AWS's request id in the receipt matches the id the function saw while running
//   4. in governed mode: CAPPO approved it, Gnomledger recorded it, the ledger
//      event carries the same AWS request id, and the ledger chain still verifies
//   5. the server's run log lists it as ran on aws-lambda with that request id
//
// Exits 0 only if every applicable check passes. In local mode (no CAPPO, no
// ledger) step 4 cannot be checked and the result is reported as PARTIAL (exit 3).
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (args.includes('-h') || args.includes('--help')) {
  console.log('usage: node scripts/aws-smoke.mjs --url <COMPUTLESS base URL> [--directive ALLOW_WITH_AUDIT] [--agent computless-aws-smoke]');
  process.exit(0);
}
const base = (opt('url', process.env.COMPUTLESS_URL ?? '') || '').replace(/\/+$/, '');
const directive = opt('directive', 'ALLOW_WITH_AUDIT');
const agentId = opt('agent', 'computless-aws-smoke');
if (!base) {
  console.error('missing --url (the COMPUTLESS server, e.g. http://127.0.0.1:23000)');
  process.exit(2);
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
};
const finish = (partial = false) => {
  const failed = results.filter((r) => !r.pass).length;
  const verdict = failed ? 'FAIL' : partial ? 'PARTIAL' : 'PASS';
  console.log(`\n${verdict}: ${results.length - failed}/${results.length} checks passed against ${base}`);
  process.exit(failed ? 1 : partial ? 3 : 0);
};
async function get(path) {
  const res = await fetch(base + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`COMPUTLESS AWS Lambda smoke test → ${base}\n`);

// 1 ── provider configured
let providers;
try {
  providers = await get('/api/providers');
} catch (err) {
  check('server reachable', false, String(err?.cause?.code ?? err?.message ?? err));
  finish();
}
const aws = providers.body?.providers?.find((p) => p.id === 'aws-lambda');
if (!check('aws-lambda provider is configured', Boolean(aws?.configured), aws ? `missing: ${(aws.missing ?? []).join(', ') || 'none'}` : 'server has no aws-lambda provider (old build?)')) finish();

const status = await get('/api/fabric/status');
const mode = status.body?.executionMode ?? 'unknown';
console.log(`        execution mode: ${mode}`);

// 2 + 3 ── one real run
const nonce = crypto.randomBytes(8).toString('hex');
const started = Date.now();
const res = await fetch(`${base}/api/substrate/sandbox/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    agentId,
    directive,
    provider: 'aws-lambda',
    code: 'output.echo = input.nonce; output.sum = input.a + input.b; console.log("ran", input.nonce);',
    inputPayload: { nonce, a: 20, b: 22 },
    timeoutMs: 5000,
  }),
  signal: AbortSignal.timeout(60_000),
});
const run = await res.json().catch(() => null);
console.log(`        run: HTTP ${res.status} in ${Date.now() - started} ms`);
if (!check('run accepted (HTTP 200)', res.status === 200, run?.detail ?? run?.title ?? run?.outputData?.error ?? '')) finish();

const receipt = run.providerReceipt ?? {};
const requestId = receipt.requestId;
check('ran on aws-lambda', run.provider === 'aws-lambda', `provider=${run.provider}`);
check('workload succeeded with the right answer', run.status === 'SUCCESS' && run.outputData?.echo === nonce && run.outputData?.sum === 42, `status=${run.status} output=${JSON.stringify(run.outputData)}`);
check('AWS returned a request id', /^[0-9a-f-]{36}$/i.test(String(requestId ?? '')), String(requestId));
check(
  "the function saw the same request id while running",
  receipt.runtime?.awsRequestId === requestId,
  `runtime.awsRequestId=${receipt.runtime?.awsRequestId}`
);
check('AWS reported billed duration', typeof receipt.billedDurationMs === 'number', `billed ${receipt.billedDurationMs} ms, max memory ${receipt.maxMemoryUsedMb} MB, region ${receipt.region}`);

// 4 ── CAPPO + Gnomledger (governed mode only)
let partial = false;
const gov = run.governance ?? {};
if (mode === 'governed') {
  check('CAPPO approved the run', gov.authorization?.decision === 'APPROVED', `authorization ${gov.authorization?.authorizationId ?? 'none'}`);
  const ev = gov.evidence ?? {};
  if (check('Gnomledger recorded the run', ev.recorded === true, ev.recorded ? `event ${ev.eventId}` : ev.reason ?? 'no evidence')) {
    const event = await get(`/api/fabric/ledger/events/${encodeURIComponent(ev.eventId)}`);
    const details = event.body?.data?.details ?? {};
    check(
      'ledger event carries the same AWS request id',
      details.provider === 'aws-lambda' && details.provider_receipt?.requestId === requestId,
      `provider=${details.provider} requestId=${details.provider_receipt?.requestId}`
    );
    const ledger = await get('/api/fabric/ledger');
    const v = ledger.body?.verification?.data ?? {};
    check('ledger chain still verifies', v.valid === true || v.status === 'verified', `status=${v.status ?? v.valid} events=${v.checked_events ?? '?'}`);
  }
} else {
  partial = true;
  console.log(`  SKIP  CAPPO and Gnomledger checks: mode is "${mode}", so the run was not governed or recorded`);
}

// 5 ── run log
const log = await get('/api/executions');
const entry = (log.body?.entries ?? []).find((e) => e.providerRequestId === requestId);
check('run log lists it as ran on aws-lambda', entry?.provider === 'aws-lambda' && entry?.outcome === 'ran', entry ? `entry ${entry.id}` : 'not found');

finish(partial);
