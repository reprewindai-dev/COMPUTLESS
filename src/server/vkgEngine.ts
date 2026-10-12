import { runInChildSandbox } from './sandbox.js';
import type { VkgManifest, VkgPackage, VkgValidationResult, VkgExecutionResult } from '../types.js';
import { hashPayload } from './cryptoUtils.js';

const MIB = 1024 * 1024;
/** Hard caps applied whatever a manifest declares. */
export const VKG_MAX_TIMEOUT_MS = 5000;
export const VKG_MIN_HEAP_MB = 8;
export const VKG_MAX_HEAP_MB = 64;

/**
 * Deterministic SHA-256 digest over a .vkg package's content (manifest fields,
 * data tables, handlers).
 */
export function computeVkgDigest(
  manifest: Omit<VkgManifest, 'contentDigest'>,
  dataTables: Record<string, unknown>,
  actionHandlers: Record<string, string>
): string {
  return hashPayload({
    packageId: manifest.packageId,
    version: manifest.version,
    capabilities: manifest.capabilities,
    allowedActions: manifest.allowedActions,
    memoryCeilingBytes: manifest.memoryCeilingBytes,
    timeoutCeilingMs: manifest.timeoutCeilingMs,
    schemaVersion: manifest.schemaVersion,
    dataTables,
    actionHandlers,
  });
}

function shapeError(pkg: any): string | null {
  if (!pkg || typeof pkg !== 'object' || !pkg.manifest || typeof pkg.manifest !== 'object') {
    return 'Malformed .vkg package: missing manifest structure.';
  }
  const m = pkg.manifest;
  for (const k of ['packageId', 'name', 'version', 'contentDigest', 'schemaVersion'] as const) {
    if (typeof m[k] !== 'string' || !m[k]) return `Malformed .vkg manifest: '${k}' must be a non-empty string.`;
  }
  for (const k of ['capabilities', 'allowedActions'] as const) {
    if (!Array.isArray(m[k]) || !m[k].every((v: unknown) => typeof v === 'string')) {
      return `Malformed .vkg manifest: '${k}' must be an array of strings.`;
    }
  }
  for (const k of ['memoryCeilingBytes', 'timeoutCeilingMs'] as const) {
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k]) || m[k] <= 0) {
      return `Malformed .vkg manifest: '${k}' must be a positive number.`;
    }
  }
  if (!pkg.actionHandlers || typeof pkg.actionHandlers !== 'object' || Array.isArray(pkg.actionHandlers)) {
    return "Malformed .vkg package: 'actionHandlers' must be an object.";
  }
  if (!Object.values(pkg.actionHandlers).every((v) => typeof v === 'string')) {
    return "Malformed .vkg package: every action handler must be a string.";
  }
  if (pkg.dataTables !== undefined && (typeof pkg.dataTables !== 'object' || pkg.dataTables === null || Array.isArray(pkg.dataTables))) {
    return "Malformed .vkg package: 'dataTables' must be an object.";
  }
  return null;
}

/**
 * Validates .vkg package integrity: recomputes the SHA-256 content digest and
 * compares it with the manifest. (Self-consistency only; says nothing about who
 * authored the package.)
 */
export function validateVkgPackage(pkg: VkgPackage): VkgValidationResult {
  const malformed = shapeError(pkg);
  if (malformed) {
    return { valid: false, computedDigest: '', expectedDigest: String((pkg as any)?.manifest?.contentDigest ?? ''), manifestMatch: false, error: malformed };
  }

  const { contentDigest, ...manifestWithoutDigest } = pkg.manifest;
  const computedDigest = computeVkgDigest(manifestWithoutDigest, pkg.dataTables || {}, pkg.actionHandlers);

  if (contentDigest !== computedDigest) {
    return {
      valid: false,
      computedDigest,
      expectedDigest: contentDigest,
      manifestMatch: false,
      error: `Digest mismatch: package '${pkg.manifest.packageId}' content does not match its manifest digest. Expected ${contentDigest}, computed ${computedDigest}.`,
    };
  }

  for (const action of pkg.manifest.allowedActions) {
    if (typeof pkg.actionHandlers[action] !== 'string') {
      return {
        valid: false,
        computedDigest,
        expectedDigest: contentDigest,
        manifestMatch: false,
        error: `Manifest declares action '${action}' but the package has no handler for it.`,
      };
    }
  }

  return { valid: true, computedDigest, expectedDigest: contentDigest, manifestMatch: true };
}

/** The limits a package's manifest imposes on a run, after the server's hard caps. */
export function vkgLimits(manifest: VkgManifest): { timeoutMs: number; heapLimitMb: number } {
  return {
    timeoutMs: Math.max(1, Math.min(manifest.timeoutCeilingMs, VKG_MAX_TIMEOUT_MS)),
    heapLimitMb: Math.max(VKG_MIN_HEAP_MB, Math.min(Math.ceil(manifest.memoryCeilingBytes / MIB), VKG_MAX_HEAP_MB)),
  };
}

function refused(status: 'DIGEST_MISMATCH' | 'ACTION_NOT_IN_MANIFEST', message: string): VkgExecutionResult {
  return {
    status,
    ran: false,
    stdout: [],
    stderr: [message],
    outputData: { error: message, code: status },
    rssBytes: null,
    durationMs: 0,
    limits: null,
  };
}

/**
 * Runs one action of a .vkg package in the child-process sandbox, after the
 * package's own checks: digest must match, the action must be in the
 * manifest's allowedActions, and the manifest's timeout/memory ceilings are
 * applied. Authorization is not decided here (that is CAPPO, via
 * fabric.governedExecution).
 */
export async function executeVkgAction(pkg: VkgPackage, action: string, inputPayload: Record<string, unknown>): Promise<VkgExecutionResult> {
  const validation = validateVkgPackage(pkg);
  if (!validation.valid) return refused('DIGEST_MISMATCH', validation.error || 'Invalid .vkg package');

  if (!pkg.manifest.allowedActions.includes(action)) {
    return refused(
      'ACTION_NOT_IN_MANIFEST',
      `Action '${action}' is not in the package's allowedActions: [${pkg.manifest.allowedActions.join(', ')}]`
    );
  }

  const limits = vkgLimits(pkg.manifest);
  const wrapped = `(function(input, dataTables, output, console) {\n${pkg.actionHandlers[action]}\n})(input, dataTables, output, console);`;
  const r = await runInChildSandbox(
    wrapped,
    { input: inputPayload, dataTables: JSON.parse(JSON.stringify(pkg.dataTables || {})) },
    limits.timeoutMs,
    limits.heapLimitMb
  );

  const outputData =
    r.status === 'SUCCESS'
      ? ((r.output && typeof r.output === 'object' ? r.output : { value: r.output }) as Record<string, unknown>)
      : { error: r.error?.message ?? r.status, code: r.error?.code ?? r.status };

  return {
    status: r.status,
    ran: true,
    stdout: r.stdout,
    stderr: r.error ? [...r.stderr, `[FAULT] ${r.error.message}`] : r.stderr,
    outputData,
    rssBytes: r.rssBytes,
    durationMs: r.durationMs,
    limits,
  };
}

function builtIn(manifest: Omit<VkgManifest, 'contentDigest'>, dataTables: Record<string, unknown>, actionHandlers: Record<string, string>): VkgPackage {
  return {
    manifest: { ...manifest, contentDigest: computeVkgDigest(manifest, dataTables, actionHandlers) },
    dataTables,
    actionHandlers,
  };
}

/** The .vkg packages shipped in this repository. Their digests are computed from this source. */
export function createDefaultVkgPackages(): VkgPackage[] {
  const vat = builtIn(
    {
      packageId: 'vkg-vat-calc-v1',
      name: 'VAT/GST Calculator',
      version: '1.3.0',
      capabilities: ['computless.vkg.execute'],
      allowedActions: ['calculate_vat', 'tax_summary'],
      memoryCeilingBytes: 32 * MIB,
      timeoutCeilingMs: 2000,
      schemaVersion: '1.0.0',
      author: 'COMPUTLESS repository (built-in package)',
    },
    {
      // National standard VAT/GST rates bundled with this package version. Not tax
      // advice: reduced rates and later rate changes are not covered.
      standardRates: { GB: 0.2, DE: 0.19, FR: 0.2, CH: 0.081, SG: 0.09, JP: 0.1 },
    },
    {
      calculate_vat: `
        const amount = Number(input.amount);
        const country = String(input.country || '').toUpperCase();
        if (!Number.isFinite(amount) || amount < 0) throw new Error('input.amount must be a non-negative number');
        const rate = dataTables.standardRates[country];
        if (rate === undefined) throw new Error('no standard rate bundled for country "' + country + '"; supported: ' + Object.keys(dataTables.standardRates).join(', '));
        const vatAmount = Math.round(amount * rate * 100) / 100;
        output.country = country;
        output.baseAmount = amount;
        output.vatRate = rate;
        output.vatAmount = vatAmount;
        output.totalAmount = Math.round((amount + vatAmount) * 100) / 100;
        console.log('VAT for ' + country + ' at ' + (rate * 100) + '%: ' + vatAmount);
      `,
      tax_summary: `
        output.supportedCountries = Object.keys(dataTables.standardRates);
        output.standardRates = dataTables.standardRates;
      `,
    }
  );

  const order = builtIn(
    {
      packageId: 'vkg-order-validator-v1',
      name: 'Order Validator',
      version: '2.1.0',
      capabilities: ['computless.vkg.execute'],
      allowedActions: ['validate_order', 'check_invariants'],
      memoryCeilingBytes: 16 * MIB,
      timeoutCeilingMs: 1500,
      schemaVersion: '1.0.0',
      author: 'COMPUTLESS repository (built-in package)',
    },
    {
      maxOrderValue: 1000000,
      currencyPattern: '^[A-Z]{3}$',
    },
    {
      validate_order: `
        const order = input.order || {};
        const amount = Number(order.amount);
        const currency = String(order.currency || '');
        const checks = {
          positiveAmount: Number.isFinite(amount) && amount > 0,
          withinMaxOrderValue: Number.isFinite(amount) && amount <= dataTables.maxOrderValue,
          currencyCodeFormat: new RegExp(dataTables.currencyPattern).test(currency),
        };
        output.orderId = order.id === undefined ? null : order.id;
        output.checks = checks;
        output.valid = Object.values(checks).every(Boolean);
        console.log('order ' + output.orderId + ': ' + (output.valid ? 'PASS' : 'FAIL'));
      `,
      check_invariants: `
        output.checks = ['positiveAmount', 'withinMaxOrderValue', 'currencyCodeFormat'];
        output.maxOrderValue = dataTables.maxOrderValue;
        output.currencyPattern = dataTables.currencyPattern;
      `,
    }
  );

  return [vat, order];
}

/**
 * Digest check computed now. VERIFIED_REPO only when the digest matches AND
 * equals the digest of the built-in package with the same id shipped in this
 * repo; otherwise UNVERIFIED (self-consistent at best).
 */
export function vkgDigestEvidence(pkg: VkgPackage): {
  digestValid: boolean;
  evidenceLabel: 'VERIFIED_REPO' | 'UNVERIFIED';
  computedDigest: string;
  expectedDigest: string;
  error?: string;
} {
  const v = validateVkgPackage(pkg);
  const repo = createDefaultVkgPackages().find((p) => p.manifest.packageId === pkg?.manifest?.packageId);
  const matchesRepo = Boolean(v.valid && repo && repo.manifest.contentDigest === v.computedDigest);
  return {
    digestValid: v.valid,
    evidenceLabel: matchesRepo ? 'VERIFIED_REPO' : 'UNVERIFIED',
    computedDigest: v.computedDigest,
    expectedDigest: v.expectedDigest,
    ...(v.error ? { error: v.error } : {}),
  };
}
