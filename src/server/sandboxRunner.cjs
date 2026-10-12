'use strict';
// Child-process workload runner. Started by src/server/sandbox.ts as:
//   node --permission --allow-fs-read=<this file> --max-old-space-size=<n> sandboxRunner.cjs
// with an empty environment and --disallow-code-generation-from-strings, so a
// workload cannot turn an outer-realm Function constructor into a handle on
// `process`. The Node permission model additionally denies filesystem access
// (other than reading this file), child processes, workers and native addons.
// Nothing restricts network access at the OS level.
const vm = require('vm');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function format(args) {
  return args.map((a) => (typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function main() {
  const job = JSON.parse(await readStdin());
  const stdout = [];
  const stderr = [];
  const globals = Object.assign({}, job.globals || {});
  globals.output = globals.output && typeof globals.output === 'object' ? globals.output : {};
  globals.console = {
    log: (...a) => stdout.push(format(a)),
    info: (...a) => stdout.push(format(a)),
    warn: (...a) => stdout.push('[WARN] ' + format(a)),
    error: (...a) => stderr.push('[ERROR] ' + format(a)),
  };

  const context = vm.createContext(globals);
  const start = process.hrtime.bigint();
  let status = 'SUCCESS';
  let error = null;
  try {
    new vm.Script(String(job.code)).runInContext(context, { timeout: job.timeoutMs });
  } catch (err) {
    const timedOut = err && (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out/.test(String(err.message)));
    status = timedOut ? 'TERMINATED_TIMEOUT' : 'RUNTIME_ERROR';
    error = { message: String((err && err.message) || err), code: (err && err.code) || null };
  }
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

  let output;
  try {
    output = JSON.parse(JSON.stringify(context.output === undefined ? null : context.output));
  } catch {
    output = null;
  }

  process.stdout.write(
    JSON.stringify({
      status,
      stdout,
      stderr,
      output,
      error,
      durationMs,
      rssBytes: process.memoryUsage().rss,
    })
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ status: 'RUNTIME_ERROR', stdout: [], stderr: [], output: null, error: { message: String(err && err.message) }, durationMs: 0, rssBytes: process.memoryUsage().rss }));
});
