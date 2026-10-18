import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { dbStore } from './src/server/dbStore.js';
import { buildProblemDetails, executeInIsolatedVMSandbox } from './src/server/cryptoUtils.js';
import { executeVkgAction, validateVkgPackage, vkgDigestEvidence } from './src/server/vkgEngine.js';
import { getLastAdversarialReport, listAdversarialTests, runAdversarialTestSuite } from './src/server/adversarialTests.js';
import { registerFabricRoutes, startCapiRegistration, governedExecution } from './src/server/fabric.js';
import { registerFabricDataRoutes } from './src/server/fabricData.js';
import { SANDBOX_BOUNDARY } from './src/server/sandbox.js';
import { getProvider, listProviders, runOnProvider } from './src/server/providers/index.js';
import type { SandboxExecutionRequest, StoredVkgPackage, VkgPackage } from './src/types.js';

const MAX_SANDBOX_TIMEOUT_MS = 10_000;
const DEFAULT_SANDBOX_TIMEOUT_MS = 3000;

/** Governance context set by fabric.governedExecution (CAPPO decision in governed mode). */
function governanceOf(res: express.Response): { mode: string; authorization: Record<string, any> | null } {
  const g = res.locals.governance as { mode?: string; authorization?: Record<string, any> | null } | undefined;
  return { mode: g?.mode ?? 'unknown', authorization: g?.authorization ?? null };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function badRequest(req: express.Request, res: express.Response, detail: string) {
  return res.status(400).json(buildProblemDetails('invalid-request', 'Invalid request', 400, detail, req.originalUrl));
}

function describePackage(pkg: StoredVkgPackage) {
  const d = vkgDigestEvidence(pkg);
  return {
    ...pkg,
    digestValid: d.digestValid,
    computedDigest: d.computedDigest,
    evidenceLabel: d.evidenceLabel,
    ...(d.error ? { digestError: d.error } : {}),
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Veklom fabric: /health, /health/dependencies, /protocol.json, /protocol/introspect,
  // /api/fabric/{status,services,capabilities,ledger,peers}, /api/executions
  registerFabricRoutes(app);
  registerFabricDataRoutes(app);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'computless', timestamp: new Date().toISOString() });
  });

  // ── Child-process sandbox (governed: CAPPO authorizes, Gnomledger records) ──
  // Validation runs before governedExecution so malformed requests never reach CAPPO.
  app.post(
    '/api/substrate/sandbox/execute',
    (req, res, next) => {
      const body = (req.body ?? {}) as Partial<SandboxExecutionRequest>;
      if (typeof body.code !== 'string' || !body.code.trim()) return badRequest(req, res, "'code' must be a non-empty string.");
      if (body.inputPayload !== undefined && !isPlainObject(body.inputPayload)) return badRequest(req, res, "'inputPayload' must be an object.");
      if (body.timeoutMs !== undefined && (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs))) {
        return badRequest(req, res, "'timeoutMs' must be a number.");
      }
      const providerId = body.provider ?? 'local';
      const provider = typeof providerId === 'string' ? getProvider(providerId) : null;
      if (!provider) return badRequest(req, res, `'provider' must be one of: ${listProviders().map((p) => p.id).join(', ')}.`);
      if (!provider.configured) {
        return res
          .status(503)
          .json(
            buildProblemDetails('provider-not-configured', `${provider.name} is not configured`, 503, `Missing: ${provider.missing.join(', ')}.`, req.originalUrl)
          );
      }
      next();
    },
    governedExecution('computless.sandbox.execute'),
    async (req, res) => {
      const body = req.body as SandboxExecutionRequest;
      const timeoutMs = Math.max(1, Math.min(Math.round(body.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS), MAX_SANDBOX_TIMEOUT_MS));
      const governance = governanceOf(res);
      const executionId = 'exec-sbx-' + crypto.randomBytes(6).toString('hex');

      const provider = getProvider(body.provider ?? 'local')!;

      if (provider.id !== 'local') {
        const run = await runOnProvider(provider.id, { code: body.code, input: body.inputPayload ?? {}, timeoutMs });
        const stdout = [...run.stdout, ...run.stderr];
        if (run.error) stdout.push(`[FAULT] ${run.error.message}`);
        return res.status(run.status === 'PROVIDER_ERROR' ? 502 : 200).json({
          executionId,
          status: run.status,
          success: run.status === 'SUCCESS',
          stdout,
          outputData:
            run.status === 'SUCCESS'
              ? run.output && typeof run.output === 'object'
                ? run.output
                : { value: run.output }
              : { error: run.error?.message ?? 'Execution fault', code: run.error?.code ?? run.status },
          rssBytes: run.rssBytes,
          memoryUsageBytes: run.rssBytes ?? 0,
          executionDurationMs: run.durationMs,
          timeoutMs,
          timestamp: new Date().toISOString(),
          provider: provider.id,
          providerReceipt: run.receipt,
          sandbox: provider.boundary,
          mode: governance.mode,
          authorization: governance.authorization,
        });
      }

      const r = await executeInIsolatedVMSandbox(body.code, body.inputPayload ?? {}, timeoutMs);

      res.json({
        executionId,
        status: r.status,
        success: r.status === 'SUCCESS',
        stdout: r.stdout,
        outputData: r.outputData,
        rssBytes: r.rssBytes,
        memoryUsageBytes: r.memoryUsageBytes,
        executionDurationMs: r.durationMs,
        timeoutMs,
        timestamp: new Date().toISOString(),
        provider: 'local',
        providerReceipt: null,
        sandbox: SANDBOX_BOUNDARY,
        mode: governance.mode,
        authorization: governance.authorization,
      });
    }
  );

  app.get('/api/providers', (_req, res) => res.json({ providers: listProviders() }));

  // ── .vkg packages ──────────────────────────────────────────────────────────
  app.get('/api/vkg/packages', (_req, res) => {
    const packages = dbStore.getVkgPackages().map(describePackage);
    res.json({ packages, totalPackages: packages.length });
  });

  app.post('/api/vkg/packages', (req, res) => {
    const pkg = req.body as VkgPackage;
    const validation = validateVkgPackage(pkg);
    if (!validation.valid) {
      return res.status(400).json({
        ...buildProblemDetails('invalid-vkg-package', 'Invalid .vkg package', 400, validation.error || 'Digest mismatch', req.originalUrl),
        validation,
      });
    }
    if (dbStore.isBuiltInId(pkg.manifest.packageId)) {
      return res
        .status(409)
        .json(buildProblemDetails('vkg-builtin-id', 'Package id is reserved', 409, `'${pkg.manifest.packageId}' is a built-in package id.`, req.originalUrl));
    }
    try {
      const stored = dbStore.addUploadedVkgPackage(pkg);
      res.status(201).json({ success: true, package: describePackage(stored) });
    } catch (err: any) {
      res
        .status(500)
        .json(buildProblemDetails('vkg-store-failed', 'Package could not be stored', 500, String(err?.code ?? err?.message ?? err), req.originalUrl));
    }
  });

  app.post('/api/vkg/validate', (req, res) => {
    const pkg = req.body as VkgPackage;
    const validation = validateVkgPackage(pkg);
    res.json({ ...validation, evidenceLabel: vkgDigestEvidence(pkg).evidenceLabel });
  });

  app.post(
    '/api/vkg/execute',
    (req, res, next) => {
      const { packageId, action, inputPayload } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof packageId !== 'string' || !packageId) return badRequest(req, res, "'packageId' must be a non-empty string.");
      if (typeof action !== 'string' || !action) return badRequest(req, res, "'action' must be a non-empty string.");
      if (inputPayload !== undefined && !isPlainObject(inputPayload)) return badRequest(req, res, "'inputPayload' must be an object.");
      if (!dbStore.getVkgPackage(packageId)) {
        return res
          .status(404)
          .json(buildProblemDetails('vkg-not-found', '.vkg package not found', 404, `No package with id '${packageId}'.`, req.originalUrl));
      }
      next();
    },
    governedExecution('computless.vkg.execute'),
    async (req, res) => {
      const { packageId, action, inputPayload = {} } = req.body as { packageId: string; action: string; inputPayload?: Record<string, unknown> };
      const governance = governanceOf(res);
      const pkg = dbStore.getVkgPackage(packageId);
      if (!pkg) {
        return res
          .status(404)
          .json(buildProblemDetails('vkg-not-found', '.vkg package not found', 404, `No package with id '${packageId}'.`, req.originalUrl));
      }

      const digest = vkgDigestEvidence(pkg);
      const execResult = await executeVkgAction(pkg, action, inputPayload);
      const refusedByManifest = execResult.status === 'DIGEST_MISMATCH' || execResult.status === 'ACTION_NOT_IN_MANIFEST';

      res.status(refusedByManifest ? 422 : 200).json({
        success: execResult.status === 'SUCCESS',
        packageId,
        packageSource: pkg.source,
        action,
        execResult,
        digestCheck: {
          valid: digest.digestValid,
          computedDigest: digest.computedDigest,
          expectedDigest: digest.expectedDigest,
          evidenceLabel: digest.evidenceLabel,
        },
        timestamp: new Date().toISOString(),
        sandbox: SANDBOX_BOUNDARY,
        mode: governance.mode,
        authorization: governance.authorization,
      });
    }
  );

  // ── Adversarial suite (runs repo code in this process) ─────────────────────
  app.get('/api/tests/adversarial', (_req, res) => {
    const tests = listAdversarialTests();
    res.json({ tests, totalTests: tests.length, lastRun: getLastAdversarialReport() });
  });

  app.post('/api/tests/adversarial/run', async (_req, res) => {
    res.json(await runAdversarialTestSuite());
  });

  // Unknown API paths are 404s, never the SPA shell.
  app.use('/api', (req, res) => {
    res.status(404).json(buildProblemDetails('not-found', 'Not found', 404, `No route for ${req.method} ${req.originalUrl}`, req.originalUrl));
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // The API has no authentication of its own yet, so it listens on localhost only by default.
  // In a container set HOST=0.0.0.0 and publish the port on the host's loopback only
  // (e.g. -p 127.0.0.1:23000:3000).
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`[computless] listening on http://${HOST}:${PORT}`);
    startCapiRegistration();
  });
}

startServer();
