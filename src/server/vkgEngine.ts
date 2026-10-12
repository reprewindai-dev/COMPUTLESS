import crypto from 'crypto';
import { runInChildSandbox } from './sandbox.js';
import {
  VkgPackage,
  VkgManifest,
  VkgValidationResult,
  CanonicalExecutionAuthority,
  RuntimeExecutionResult,
} from '../types.js';
import { hashPayload } from './cryptoUtils.js';

/**
 * Computes deterministic SHA-256 digest over a .vkg package's immutable content
 */
export function computeVkgDigest(
  manifest: Omit<VkgManifest, 'contentDigest'>,
  dataTables: Record<string, unknown>,
  actionHandlers: Record<string, string>
): string {
  const contentToHash = {
    packageId: manifest.packageId,
    version: manifest.version,
    capabilities: manifest.capabilities,
    allowedActions: manifest.allowedActions,
    memoryCeilingBytes: manifest.memoryCeilingBytes,
    timeoutCeilingMs: manifest.timeoutCeilingMs,
    schemaVersion: manifest.schemaVersion,
    dataTables,
    actionHandlers,
  };
  return hashPayload(contentToHash);
}

/**
 * Validates .vkg package integrity, ensuring cryptographic digest matches content exactly
 */
export function validateVkgPackage(pkg: VkgPackage): VkgValidationResult {
  if (!pkg || !pkg.manifest) {
    return {
      valid: false,
      computedDigest: '',
      expectedDigest: '',
      manifestMatch: false,
      error: 'Malformed .vkg package: missing manifest structure.',
    };
  }

  const { contentDigest, ...manifestWithoutDigest } = pkg.manifest;
  const computedDigest = computeVkgDigest(manifestWithoutDigest, pkg.dataTables || {}, pkg.actionHandlers || {});

  if (pkg.manifest.contentDigest !== computedDigest) {
    return {
      valid: false,
      computedDigest,
      expectedDigest: pkg.manifest.contentDigest,
      manifestMatch: false,
      error: `Cryptographic digest mismatch: package '${pkg.manifest.packageId}' has been altered or tampered. Expected ${pkg.manifest.contentDigest}, computed ${computedDigest}.`,
    };
  }

  // Validate action handlers exist for all declared actions
  for (const action of pkg.manifest.allowedActions) {
    if (!pkg.actionHandlers[action]) {
      return {
        valid: false,
        computedDigest,
        expectedDigest: pkg.manifest.contentDigest,
        manifestMatch: false,
        error: `Manifest declares action '${action}' but no corresponding handler bytecode exists in .vkg package.`,
      };
    }
  }

  return {
    valid: true,
    computedDigest,
    expectedDigest: pkg.manifest.contentDigest,
    manifestMatch: true,
  };
}

/**
 * Executes a deterministic .vkg action handler within bounded constraints
 */
export async function executeVkgAction(
  pkg: VkgPackage,
  action: string,
  inputPayload: Record<string, unknown>,
  authority: CanonicalExecutionAuthority
): Promise<RuntimeExecutionResult> {
  // Step 1: Validate .vkg package integrity
  const validation = validateVkgPackage(pkg);
  if (!validation.valid) {
    return {
      status: 'BOUND_VIOLATION',
      stdout: [],
      stderr: [validation.error || 'Invalid .vkg package'],
      outputData: { error: validation.error, code: 'VKG_DIGEST_MISMATCH' },
      memoryUsageBytes: 0,
      durationMs: 0,
      exitCode: 1,
      adapterType: 'VkgRuntimeAdapter',
      containmentObserved: false,
      measuredError: validation.error,
    };
  }

  // Step 2: Check authority scope for requested action
  if (!pkg.manifest.allowedActions.includes(action)) {
    return {
      status: 'UNAUTHORIZED',
      stdout: [],
      stderr: [`Action '${action}' is not in package allowedActions: [${pkg.manifest.allowedActions.join(', ')}]`],
      outputData: { error: `Action '${action}' not supported by .vkg package`, code: 'ACTION_NOT_IN_MANIFEST' },
      memoryUsageBytes: 0,
      durationMs: 0,
      exitCode: 1,
      adapterType: 'VkgRuntimeAdapter',
      containmentObserved: true,
      measuredError: `Action '${action}' not permitted in .vkg manifest`,
    };
  }

  // Step 3: Check authority capability match
  const matchesCapability = pkg.manifest.capabilities.includes(authority.capabilityId);
  if (!matchesCapability) {
    return {
      status: 'UNAUTHORIZED',
      stdout: [],
      stderr: [`Authority capability '${authority.capabilityId}' does not match package capabilities [${pkg.manifest.capabilities.join(', ')}]`],
      outputData: { error: 'Authority capability mismatch', code: 'CAPABILITY_SCOPE_MISMATCH' },
      memoryUsageBytes: 0,
      durationMs: 0,
      exitCode: 1,
      adapterType: 'VkgRuntimeAdapter',
      containmentObserved: true,
      measuredError: `Authority '${authority.capabilityId}' not permitted for package`,
    };
  }

  const handlerCode = pkg.actionHandlers[action];
  const timeoutMs = Math.min(pkg.manifest.timeoutCeilingMs || 3000, 5000);

  // Run the handler in the child-process sandbox (see sandbox.ts).
  const wrapped = `(function(input, dataTables, output, console) {\n${handlerCode}\n})(input, dataTables, output, console);`;
  const r = await runInChildSandbox(
    wrapped,
    { input: inputPayload, dataTables: JSON.parse(JSON.stringify(pkg.dataTables || {})) },
    timeoutMs
  );
  const memoryUsageBytes = r.rssBytes ?? 0;

  if (r.status === 'MEMORY_LIMIT') {
    return {
      status: 'BOUND_VIOLATION',
      stdout: r.stdout,
      stderr: [...r.stderr, r.error?.message ?? 'heap limit exceeded'],
      outputData: { error: 'Memory limit exceeded', code: 'MEMORY_LIMIT' },
      memoryUsageBytes,
      durationMs: r.durationMs,
      exitCode: 137,
      adapterType: 'VkgRuntimeAdapter',
      containmentObserved: true,
      measuredError: r.error?.message,
    };
  }

  if (r.status !== 'SUCCESS') {
    const isTimeout = r.status === 'TERMINATED_TIMEOUT';
    return {
      status: isTimeout ? 'TERMINATED_TIMEOUT' : 'RUNTIME_ERROR',
      stdout: r.stdout,
      stderr: [...r.stderr, `[FAULT] ${r.error?.message ?? r.status}`],
      outputData: { error: r.error?.message ?? 'Execution fault', code: r.error?.code ?? 'RUNTIME_FAULT' },
      memoryUsageBytes,
      durationMs: r.durationMs,
      exitCode: isTimeout ? 124 : 1,
      adapterType: 'VkgRuntimeAdapter',
      containmentObserved: true,
      measuredError: r.error?.message,
    };
  }

  return {
    status: 'SUCCESS',
    stdout: r.stdout,
    stderr: r.stderr,
    outputData: (r.output && typeof r.output === 'object' ? r.output : { value: r.output }) as Record<string, unknown>,
    memoryUsageBytes,
    durationMs: r.durationMs,
    exitCode: 0,
    adapterType: 'VkgRuntimeAdapter',
    containmentObserved: true,
  };
}

// Built-in canonical .vkg packages
export function createDefaultVkgPackages(): VkgPackage[] {
  // 1. Tax Calculation & Compliance Package
  const taxManifestRaw = {
    packageId: 'vkg-sovereign-tax-calc-v1',
    name: 'Sovereign Tax & Cross-Border VAT Engine',
    version: '1.2.0',
    capabilities: ['cap-compute-v1', 'cap-compliance-v1'],
    allowedActions: ['calculate_vat', 'withholding_rate', 'tax_summary'],
    memoryCeilingBytes: 32 * 1024 * 1024,
    timeoutCeilingMs: 2000,
    schemaVersion: '1.0.0',
    author: 'Veklom Substrate Core',
  };
  const taxDataTables = {
    vatRates: {
      US: 0.0,
      EU: 0.20,
      UK: 0.20,
      CH: 0.077,
      SG: 0.08,
      JP: 0.10,
    },
    withholdingDefaults: {
      standard: 0.15,
      treaty: 0.05,
      sovereign_exempt: 0.0,
    },
  };
  const taxHandlers = {
    calculate_vat: `
      const amount = Number(input.amount || 0);
      const country = String(input.country || 'US').toUpperCase();
      const rate = dataTables.vatRates[country] !== undefined ? dataTables.vatRates[country] : 0.15;
      const vatAmount = Math.round(amount * rate * 100) / 100;
      const total = Math.round((amount + vatAmount) * 100) / 100;
      output.country = country;
      output.baseAmount = amount;
      output.vatRate = rate;
      output.vatAmount = vatAmount;
      output.totalAmount = total;
      output.deterministic = true;
      console.log("Calculated VAT for " + country + " @ " + (rate * 100) + "%: " + vatAmount);
    `,
    withholding_rate: `
      const entityType = String(input.entityType || 'standard');
      const rate = dataTables.withholdingDefaults[entityType] ?? 0.15;
      output.entityType = entityType;
      output.withholdingRate = rate;
      output.applicable = rate > 0;
    `,
    tax_summary: `
      output.supportedCountries = Object.keys(dataTables.vatRates);
      output.treatyTiers = Object.keys(dataTables.withholdingDefaults);
      output.status = 'READY';
    `,
  };
  const taxDigest = computeVkgDigest(taxManifestRaw, taxDataTables, taxHandlers);
  const taxPkg: VkgPackage = {
    manifest: { ...taxManifestRaw, contentDigest: taxDigest },
    dataTables: taxDataTables,
    actionHandlers: taxHandlers,
    isImmutable: true,
    installedAt: new Date().toISOString(),
  };

  // 2. Order & State Invariant Validator Package
  const orderManifestRaw = {
    packageId: 'vkg-order-validator-v1',
    name: 'Cryptographic Order State Invariant Validator',
    version: '2.0.1',
    capabilities: ['cap-compute-v1', 'cap-agent-recurse'],
    allowedActions: ['validate_order', 'check_invariants'],
    memoryCeilingBytes: 16 * 1024 * 1024,
    timeoutCeilingMs: 1500,
    schemaVersion: '1.0.0',
    author: 'Veklom Runtime Security Group',
  };
  const orderDataTables = {
    maxOrderValue: 1000000,
    forbiddenCurrencies: ['UNBACKED_FIAT_LEGACY'],
    allowedStatuses: ['PENDING', 'AUTHORIZED', 'SETTLED', 'CANCELLED'],
  };
  const orderHandlers = {
    validate_order: `
      const order = input.order || {};
      const amount = Number(order.amount || 0);
      const currency = String(order.currency || 'VEK');
      const isValid = amount > 0 && amount <= dataTables.maxOrderValue && !dataTables.forbiddenCurrencies.includes(currency);
      output.orderId = order.id || 'ord-unknown';
      output.valid = isValid;
      output.checks = {
        positiveAmount: amount > 0,
        withinCap: amount <= dataTables.maxOrderValue,
        allowedCurrency: !dataTables.forbiddenCurrencies.includes(currency)
      };
      console.log("Validated order " + output.orderId + " -> " + (isValid ? "PASS" : "FAIL"));
    `,
    check_invariants: `
      output.invariants = ['NON_NEGATIVE_VALUE', 'NON_AMBIENT_AUTHORITY', 'MONOTONIC_SETTLEMENT'];
      output.status = 'INVARIANTS_ACTIVE';
    `,
  };
  const orderDigest = computeVkgDigest(orderManifestRaw, orderDataTables, orderHandlers);
  const orderPkg: VkgPackage = {
    manifest: { ...orderManifestRaw, contentDigest: orderDigest },
    dataTables: orderDataTables,
    actionHandlers: orderHandlers,
    isImmutable: true,
    installedAt: new Date().toISOString(),
  };

  return [taxPkg, orderPkg];
}
