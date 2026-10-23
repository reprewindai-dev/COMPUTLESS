'use strict';
// COMPUTLESS runner for AWS Lambda (inlined as index.js by scripts/
// build-aws-template.mjs; keep < 4 KB). Each run re-launches this file as a
// child: empty env (no AWS keys), permission model, heap cap, no string code
// generation, SIGKILL at the deadline. The workload's context has an
// inner-realm global, so constructor chains can't reach the outer Function.
const vm = require('vm');
const { spawn } = require('child_process');

function child() {
  const b = [];
  process.stdin.on('data', (d) => b.push(d)).on('end', () => {
    const j = JSON.parse(Buffer.concat(b).toString());
    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY, { codeGeneration: { strings: false, wasm: false } });
    const collect = vm.runInContext(`(function (s) {
      const out = [], err = [];
      const f = (a) => a.map((x) => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch (e) { return String(x); } }).join(' ');
      globalThis.input = JSON.parse(s); globalThis.output = {};
      globalThis.console = { log: (...a) => { out.push(f(a)); }, info: (...a) => { out.push(f(a)); },
        warn: (...a) => { out.push('[WARN] ' + f(a)); }, error: (...a) => { err.push('[ERROR] ' + f(a)); } };
      return () => JSON.stringify({ out: out, err: err, output: globalThis.output === undefined ? null : globalThis.output });
    })`, ctx)(JSON.stringify(j.input));
    let status = 'SUCCESS', error = null, c = { out: [], err: [], output: null };
    const t0 = process.hrtime.bigint();
    try { new vm.Script(j.code, { filename: 'workload.js' }).runInContext(ctx, { timeout: j.timeoutMs }); }
    catch (e) { status = e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'TERMINATED_TIMEOUT' : 'RUNTIME_ERROR'; error = { message: String((e && e.message) || e).slice(0, 2000), code: (e && e.code) || null }; }
    const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
    try { c = JSON.parse(collect()); } catch (e) { if (!error) { status = 'RUNTIME_ERROR'; error = { message: 'output is not JSON-serialisable', code: null }; } }
    process.stdout.write(JSON.stringify({ status, error, durationMs, stdout: c.out, stderr: c.err, output: c.output, rssBytes: process.memoryUsage().rss }));
    process.exit(0);
  });
}

function run(job) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--permission', '--allow-fs-read=' + __filename, '--disallow-code-generation-from-strings', '--max-old-space-size=128', __filename],
      { env: { COMPUTLESS_CHILD: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const o = [], t = Date.now();
    let killed = false;
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, job.timeoutMs + 1000);
    p.stdout.on('data', (d) => o.push(d));
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      try { return resolve(JSON.parse(Buffer.concat(o).toString())); } catch (e) {}
      const status = killed ? 'TERMINATED_TIMEOUT' : code === 134 || sig === 'SIGABRT' ? 'MEMORY_LIMIT' : 'SANDBOX_FAILURE';
      resolve({ status, error: { message: `child exited (code ${code}, signal ${sig})`, code: null }, durationMs: Date.now() - t, rssBytes: null });
    });
    p.stdin.end(JSON.stringify(job));
  });
}

if (process.env.COMPUTLESS_CHILD === '1') child();

exports.handler = async (event, context) => {
  const e = event || {};
  const r = await run({ code: String(e.code || ''), input: e.input || {}, timeoutMs: Math.max(1, Math.min(Number(e.timeoutMs) || 3000, 10000)) });
  const c = context || {};
  return {
    status: r.status, error: r.error, durationMs: r.durationMs, rssBytes: r.rssBytes,
    stdout: (r.stdout || []).slice(0, 1000), stderr: (r.stderr || []).slice(0, 1000), output: r.output === undefined ? null : r.output,
    runtime: { node: process.version, region: process.env.AWS_REGION || null, functionVersion: c.functionVersion || null, memoryLimitMb: Number(c.memoryLimitInMB) || null, awsRequestId: c.awsRequestId || null },
  };
};
