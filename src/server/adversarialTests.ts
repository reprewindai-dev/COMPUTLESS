import { runInChildSandbox } from './sandbox.js';
import { computeVkgDigest, createDefaultVkgPackages, executeVkgAction, validateVkgPackage, vkgDigestEvidence } from './vkgEngine.js';
import { authorizeWithCappo, fabricConfig } from './fabric.js';
import type { VkgPackage } from '../types.js';

export type AdversarialCategory = 'SANDBOX_ESCAPE' | 'RUNTIME_CONTAINMENT' | 'VKG_INTEGRITY' | 'GOVERNANCE_FAIL_CLOSED';

export interface AdversarialTestResult {
  testId: string;
  name: string;
  category: AdversarialCategory;
  expectedOutcome: string;
  /** What actually happened, measured during this run. */
  actualOutcome: string;
  passed: boolean;
  durationMs: number;
}

export interface AdversarialTestSuiteReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  tests: AdversarialTestResult[];
  /** Results were computed just now by running repo code in this process. */
  evidenceLabel: 'VERIFIED_REPO';
  scope: string;
}

interface TestDef {
  testId: string;
  name: string;
  category: AdversarialCategory;
  expectedOutcome: string;
  run: () => Promise<{ passed: boolean; actualOutcome: string }>;
}

const CODEGEN_BLOCKED = /Code generation from strings disallowed/;

function escapeTest(testId: string, name: string, code: string): TestDef {
  return {
    testId,
    name,
    category: 'SANDBOX_ESCAPE',
    expectedOutcome: 'RUNTIME_ERROR "Code generation from strings disallowed"; the workload never obtains process',
    run: async () => {
      const r = await runInChildSandbox(code, { input: {} }, 2000);
      const blocked = r.status === 'RUNTIME_ERROR' && CODEGEN_BLOCKED.test(r.error?.message ?? '');
      return { passed: blocked, actualOutcome: `status ${r.status}; error: ${r.error?.message ?? 'none'}; output: ${JSON.stringify(r.output)}` };
    },
  };
}

function vkgPackage(handlers: Record<string, string>, memoryCeilingBytes = 16 * 1024 * 1024): VkgPackage {
  const manifest = {
    packageId: 'vkg-adversarial-fixture',
    name: 'Adversarial test fixture',
    version: '0.0.1',
    capabilities: ['computless.vkg.execute'],
    allowedActions: Object.keys(handlers),
    memoryCeilingBytes,
    timeoutCeilingMs: 3000,
    schemaVersion: '1.0.0',
  };
  return { manifest: { ...manifest, contentDigest: computeVkgDigest(manifest, {}, handlers) }, dataTables: {}, actionHandlers: handlers };
}

const TESTS: TestDef[] = [
  escapeTest('SBX-01', 'Function-constructor escape via this', 'const p = this.constructor.constructor("return process")(); output.got = typeof p;'),
  escapeTest('SBX-02', 'Function-constructor escape via console', 'output.got = typeof console.log.constructor("return process")();'),
  escapeTest('SBX-03', 'Function-constructor escape via input', 'output.got = typeof input.constructor.constructor("return process")();'),
  {
    testId: 'SBX-04',
    name: 'Filesystem read (/etc/passwd)',
    category: 'SANDBOX_ESCAPE',
    expectedOutcome: 'No require/process in the workload; reading a file fails',
    run: async () => {
      const r = await runInChildSandbox(
        `output.require = typeof require; output.process = typeof process;
         try { output.data = require('fs').readFileSync('/etc/passwd', 'utf8').slice(0, 20); } catch (e) { output.err = String(e && e.message); }`,
        {},
        2000
      );
      const o = (r.output ?? {}) as Record<string, unknown>;
      const passed = r.status === 'SUCCESS' && o.require === 'undefined' && o.process === 'undefined' && o.data === undefined;
      return { passed, actualOutcome: `status ${r.status}; output: ${JSON.stringify(o)}` };
    },
  },
  {
    testId: 'SBX-05',
    name: 'Spawn a child process (child_process.execSync)',
    category: 'SANDBOX_ESCAPE',
    expectedOutcome: 'No handle on child_process is reachable; nothing is spawned',
    run: async () => {
      const r = await runInChildSandbox(
        `const attempts = {};
         try { attempts.direct = String(process.mainModule.require('child_process').execSync('id')); } catch (e) { attempts.direct = 'blocked: ' + e.message; }
         try { attempts.viaEscape = String(this.constructor.constructor("return process")().mainModule.require('child_process').execSync('id')); } catch (e) { attempts.viaEscape = 'blocked: ' + e.message; }
         output.attempts = attempts;`,
        {},
        2000
      );
      const a = ((r.output ?? {}) as { attempts?: Record<string, string> }).attempts ?? {};
      const passed = r.status === 'SUCCESS' && Object.values(a).length === 2 && Object.values(a).every((v) => v.startsWith('blocked: '));
      return { passed, actualOutcome: `status ${r.status}; attempts: ${JSON.stringify(a)}` };
    },
  },
  {
    testId: 'SBX-06',
    name: 'Read the host environment',
    category: 'SANDBOX_ESCAPE',
    expectedOutcome: 'No process/env reachable from the workload (globals or stack frames); the child is started with an empty env',
    run: async () => {
      const r = await runInChildSandbox(
        `output.globalProcess = typeof globalThis.process;
         Error.prepareStackTrace = (e, cs) => cs;
         output.frames = new Error().stack.map((c) => { try { const t = c.getThis(); return t ? typeof t.process : null; } catch (e) { return 'err'; } });`,
        {},
        2000
      );
      const o = (r.output ?? {}) as { globalProcess?: string; frames?: unknown[] };
      const passed =
        r.status === 'SUCCESS' && o.globalProcess === 'undefined' && Array.isArray(o.frames) && o.frames.every((f) => f !== 'object');
      return { passed, actualOutcome: `status ${r.status}; output: ${JSON.stringify(o)}` };
    },
  },
  {
    testId: 'SBX-07',
    name: 'Infinite loop is terminated',
    category: 'RUNTIME_CONTAINMENT',
    expectedOutcome: 'TERMINATED_TIMEOUT after the 300 ms limit',
    run: async () => {
      const r = await runInChildSandbox('while (true) {}', {}, 300);
      return { passed: r.status === 'TERMINATED_TIMEOUT', actualOutcome: `status ${r.status}; error: ${r.error?.message ?? 'none'}` };
    },
  },
  {
    testId: 'SBX-08',
    name: 'Heap exhaustion is stopped at the heap limit',
    category: 'RUNTIME_CONTAINMENT',
    expectedOutcome: 'MEMORY_LIMIT with a 32 MB heap limit',
    run: async () => {
      const r = await runInChildSandbox('const a = []; while (true) a.push(new Array(1e5).fill(Math.PI));', {}, 5000, 32);
      return { passed: r.status === 'MEMORY_LIMIT', actualOutcome: `status ${r.status}; error: ${r.error?.message ?? 'none'}` };
    },
  },
  {
    testId: 'VKG-01',
    name: 'Built-in .vkg digests match the repo source',
    category: 'VKG_INTEGRITY',
    expectedOutcome: 'Every built-in package recomputes to its manifest digest (VERIFIED_REPO)',
    run: async () => {
      const results = createDefaultVkgPackages().map((p) => ({ id: p.manifest.packageId, ...vkgDigestEvidence(p) }));
      const passed = results.length > 0 && results.every((r) => r.digestValid && r.evidenceLabel === 'VERIFIED_REPO');
      return { passed, actualOutcome: results.map((r) => `${r.id}: ${r.digestValid ? 'match' : 'MISMATCH'} (${r.evidenceLabel})`).join('; ') };
    },
  },
  {
    testId: 'VKG-02',
    name: 'Tampered .vkg handler is detected and refused',
    category: 'VKG_INTEGRITY',
    expectedOutcome: 'Digest mismatch; execution refused with DIGEST_MISMATCH and nothing runs',
    run: async () => {
      const original = createDefaultVkgPackages()[0];
      const action = original.manifest.allowedActions[0];
      const tampered: VkgPackage = { ...original, actionHandlers: { ...original.actionHandlers, [action]: 'output.tampered = true;' } };
      const v = validateVkgPackage(tampered);
      const r = await executeVkgAction(tampered, action, {});
      const passed = !v.valid && r.status === 'DIGEST_MISMATCH' && r.ran === false && r.outputData.tampered === undefined;
      return { passed, actualOutcome: `validate.valid ${v.valid}; execute status ${r.status}; ran ${r.ran}` };
    },
  },
  {
    testId: 'VKG-03',
    name: 'Action not in the .vkg manifest is refused',
    category: 'VKG_INTEGRITY',
    expectedOutcome: 'ACTION_NOT_IN_MANIFEST and nothing runs',
    run: async () => {
      const pkg = createDefaultVkgPackages()[0];
      const r = await executeVkgAction(pkg, 'exfiltrate_data', {});
      return { passed: r.status === 'ACTION_NOT_IN_MANIFEST' && r.ran === false, actualOutcome: `status ${r.status}; ran ${r.ran}` };
    },
  },
  {
    testId: 'VKG-04',
    name: '.vkg memory ceiling is enforced',
    category: 'VKG_INTEGRITY',
    expectedOutcome: 'A handler exceeding its 16 MB memoryCeilingBytes ends with MEMORY_LIMIT',
    run: async () => {
      const pkg = vkgPackage({ hog: 'const a = []; while (true) a.push(new Array(1e5).fill(Math.PI));' });
      const r = await executeVkgAction(pkg, 'hog', {});
      return { passed: r.status === 'MEMORY_LIMIT', actualOutcome: `status ${r.status}; limits ${JSON.stringify(r.limits)}` };
    },
  },
  {
    testId: 'GOV-01',
    name: 'Authorization with CAPPO unconfigured fails closed',
    category: 'GOVERNANCE_FAIL_CLOSED',
    expectedOutcome: 'decision REJECTED from computless-fail-closed (nothing would run)',
    run: async () => {
      // authorizeWithCappo reads the URL synchronously before its first await, so
      // the override is restored before any other request can observe it.
      const saved = fabricConfig.cappoUrl;
      fabricConfig.cappoUrl = null;
      const pending = authorizeWithCappo({ agentId: 'computless-adversarial-suite', capabilityId: 'computless.sandbox.execute', request: {} });
      fabricConfig.cappoUrl = saved;
      const a = await pending;
      const passed = a.decision === 'REJECTED' && a.source === 'computless-fail-closed';
      return { passed, actualOutcome: `decision ${a.decision}; source ${a.source}; reason: ${a.reason}` };
    },
  },
  {
    testId: 'GOV-02',
    name: 'Authorization with CAPPO unreachable fails closed',
    category: 'GOVERNANCE_FAIL_CLOSED',
    expectedOutcome: 'decision REJECTED from computless-fail-closed when CAPPO cannot be reached',
    run: async () => {
      const saved = fabricConfig.cappoUrl;
      fabricConfig.cappoUrl = 'http://127.0.0.1:1';
      const pending = authorizeWithCappo({ agentId: 'computless-adversarial-suite', capabilityId: 'computless.sandbox.execute', request: {} });
      fabricConfig.cappoUrl = saved;
      const a = await pending;
      const passed = a.decision === 'REJECTED' && a.source === 'computless-fail-closed';
      return { passed, actualOutcome: `decision ${a.decision}; source ${a.source}; reason: ${a.reason}` };
    },
  },
];

/** The tests in the suite, without running them. */
export function listAdversarialTests(): Pick<AdversarialTestResult, 'testId' | 'name' | 'category' | 'expectedOutcome'>[] {
  return TESTS.map(({ testId, name, category, expectedOutcome }) => ({ testId, name, category, expectedOutcome }));
}

let lastReport: AdversarialTestSuiteReport | null = null;

/** The report of the most recent run in this process, or null when the suite has not run since start. */
export function getLastAdversarialReport(): AdversarialTestSuiteReport | null {
  return lastReport;
}

export async function runAdversarialTestSuite(): Promise<AdversarialTestSuiteReport> {
  const tests = await Promise.all(
    TESTS.map(async (t): Promise<AdversarialTestResult> => {
      const start = process.hrtime.bigint();
      let outcome: { passed: boolean; actualOutcome: string };
      try {
        outcome = await t.run();
      } catch (err: any) {
        outcome = { passed: false, actualOutcome: `test threw: ${err?.message ?? String(err)}` };
      }
      return {
        testId: t.testId,
        name: t.name,
        category: t.category,
        expectedOutcome: t.expectedOutcome,
        actualOutcome: outcome.actualOutcome,
        passed: outcome.passed,
        durationMs: +(Number(process.hrtime.bigint() - start) / 1e6).toFixed(2),
      };
    })
  );
  const passed = tests.filter((t) => t.passed).length;
  lastReport = {
    timestamp: new Date().toISOString(),
    totalTests: tests.length,
    passed,
    failed: tests.length - passed,
    allPassed: passed === tests.length,
    tests,
    evidenceLabel: 'VERIFIED_REPO',
    scope:
      'Checks of COMPUTLESS repo code run in this process just now: the child-process sandbox, .vkg digest and manifest enforcement, and the fail-closed paths of the CAPPO client. Not a test of CAPPO, Gnomledger or any production deployment.',
  };
  return lastReport;
}
