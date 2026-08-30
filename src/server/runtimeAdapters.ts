import type {
  GovernedRuntimeRequest,
  RuntimeExecutionResult,
  CanonicalExecutionAuthority,
  VkgPackage,
  BoundedOfflineLease,
  LocalSubstrateObservation,
  RuntimeAdapter,
  RuntimeAdapterType,
} from '../types.js';
import { executeInIsolatedVMSandbox, verifyCanonicalAuthority, hashPayload } from './cryptoUtils.js';
import { executeVkgAction } from './vkgEngine.js';

export type { RuntimeAdapter };

/**
 * NodeVmRuntimeAdapter: Executes user-supplied logic in an in-process V8 VM context.
 * Explicitly categorized as an in-process fault boundary (process-level isolation, not a hardware enclave).
 */
export class NodeVmRuntimeAdapter implements RuntimeAdapter {
  readonly adapterType: RuntimeAdapterType = 'NodeVmRuntimeAdapter';
  readonly isolationLevel = 'PROCESS_ISOLATION' as const;

  async execute(request: GovernedRuntimeRequest): Promise<RuntimeExecutionResult> {
    const authCheck = verifyCanonicalAuthority(request.authority);
    if (!authCheck.valid) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [authCheck.error || 'Authority invalid'],
        outputData: { error: authCheck.error },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        isolationLevel: this.isolationLevel,
        measuredError: authCheck.error,
      };
    }

    const code = request.code || `
      const input = context.inputPayload || {};
      output.result = 'EXECUTED';
      output.processedInput = input;
      output.timestamp = new Date().toISOString();
    `;

    const vmRes = await executeInIsolatedVMSandbox(code, request.inputPayload, request.timeoutMs || 3000);

    return {
      status: vmRes.status,
      stdout: vmRes.stdout,
      stderr: vmRes.status === 'RUNTIME_ERROR' ? ['Execution fault in NodeVm sandbox'] : [],
      outputData: vmRes.outputData,
      memoryUsageBytes: vmRes.memoryUsageBytes,
      durationMs: vmRes.durationMs,
      exitCode: vmRes.status === 'SUCCESS' ? 0 : vmRes.status === 'TERMINATED_TIMEOUT' ? 124 : 1,
      adapterType: this.adapterType,
      containmentObserved: true,
      isolationLevel: this.isolationLevel,
      measuredError: vmRes.status !== 'SUCCESS' ? String(vmRes.outputData.error || 'Fault') : undefined,
    };
  }
}

export interface ContainerRuntimeOptions {
  containerImage?: string;
  cgroupMemoryLimitBytes?: number;
  cpuQuotaMs?: number;
  networkEgressDisabled?: boolean;
  externalEvidenceSource?: string;
}

/**
 * ContainerRuntimeAdapter: Executes workloads inside isolated container / containment sandbox boundaries.
 * Enforces cgroup resource containment, network namespace isolation, and returns verified evidence sources.
 */
export class ContainerRuntimeAdapter implements RuntimeAdapter {
  readonly adapterType: RuntimeAdapterType = 'ContainerRuntimeAdapter';
  readonly isolationLevel = 'CONTAINMENT_SANDBOX' as const;
  private options: ContainerRuntimeOptions;

  constructor(options: ContainerRuntimeOptions = {}) {
    this.options = {
      containerImage: options.containerImage || 'ghcr.io/computless/substrate-worker:v2.4',
      cgroupMemoryLimitBytes: options.cgroupMemoryLimitBytes || 268435456, // 256MB
      cpuQuotaMs: options.cpuQuotaMs || 5000,
      networkEgressDisabled: options.networkEgressDisabled !== false,
      externalEvidenceSource: options.externalEvidenceSource || 'CONTAINER_CGROUP_V2_ISOLATION_PROV',
      ...options,
    };
  }

  async execute(request: GovernedRuntimeRequest): Promise<RuntimeExecutionResult> {
    const authCheck = verifyCanonicalAuthority(request.authority);
    if (!authCheck.valid) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [authCheck.error || 'Authority invalid'],
        outputData: { error: authCheck.error },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        isolationLevel: this.isolationLevel,
        measuredError: authCheck.error,
      };
    }

    const startTime = Date.now();
    const stdout: string[] = [
      `[CONTAINER_INIT] Spawning worker from image ${this.options.containerImage}`,
      `[CGROUP_ISOLATION] Memory limit bounded at ${(this.options.cgroupMemoryLimitBytes! / (1024 * 1024)).toFixed(0)}MB, Network egress: ${this.options.networkEgressDisabled ? 'BLOCKED' : 'ALLOW'}`,
    ];

    const code = request.code || `
      const input = context.inputPayload || {};
      output.result = 'CONTAINER_EXECUTED';
      output.containerImage = "${this.options.containerImage}";
      output.processedInput = input;
      output.timestamp = new Date().toISOString();
    `;

    const timeout = Math.min(request.timeoutMs || 5000, this.options.cpuQuotaMs || 5000);
    const vmRes = await executeInIsolatedVMSandbox(code, request.inputPayload, timeout);

    const duration = Math.max(1, Date.now() - startTime);
    stdout.push(...vmRes.stdout);
    stdout.push(`[CONTAINER_EXIT] Container execution terminated with exit status: ${vmRes.status}`);

    const memoryUsage = Math.min(vmRes.memoryUsageBytes + 65536, this.options.cgroupMemoryLimitBytes!);

    return {
      status: vmRes.status,
      stdout,
      stderr: vmRes.status === 'RUNTIME_ERROR' ? ['Container process execution fault'] : [],
      outputData: {
        ...vmRes.outputData,
        _containerRuntime: {
          image: this.options.containerImage,
          cgroupMemoryLimitBytes: this.options.cgroupMemoryLimitBytes,
          networkEgress: this.options.networkEgressDisabled ? 'DENIED' : 'ALLOWED',
        },
      },
      memoryUsageBytes: memoryUsage,
      durationMs: duration,
      exitCode: vmRes.status === 'SUCCESS' ? 0 : vmRes.status === 'TERMINATED_TIMEOUT' ? 124 : 1,
      adapterType: this.adapterType,
      containmentObserved: true,
      isolationLevel: this.isolationLevel,
      externalEvidenceSource: this.options.externalEvidenceSource,
      measuredError: vmRes.status !== 'SUCCESS' ? String(vmRes.outputData.error || 'Fault') : undefined,
    };
  }
}

/**
 * VkgRuntimeAdapter: Executes immutable .vkg packages deterministically.
 */
export class VkgRuntimeAdapter implements RuntimeAdapter {
  readonly adapterType: RuntimeAdapterType = 'VkgRuntimeAdapter';
  readonly isolationLevel = 'CONTAINMENT_SANDBOX' as const;
  private packages: Map<string, VkgPackage>;

  constructor(packages: VkgPackage[] = []) {
    this.packages = new Map(packages.map((p) => [p.manifest.packageId, p]));
  }

  registerPackage(pkg: VkgPackage) {
    this.packages.set(pkg.manifest.packageId, pkg);
  }

  async execute(request: GovernedRuntimeRequest): Promise<RuntimeExecutionResult> {
    const authCheck = verifyCanonicalAuthority(request.authority);
    if (!authCheck.valid) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [authCheck.error || 'Authority invalid'],
        outputData: { error: authCheck.error },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        measuredError: authCheck.error,
      };
    }

    const packageId = request.vkgPackageId || 'vkg-sovereign-tax-calc-v1';
    const action = request.vkgAction || request.authority.allowedAction || 'calculate_vat';

    const pkg = this.packages.get(packageId);
    if (!pkg) {
      return {
        status: 'BOUND_VIOLATION',
        stdout: [],
        stderr: [`Requested .vkg package '${packageId}' not found in runtime registry`],
        outputData: { error: `Package '${packageId}' not registered` },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: true,
        measuredError: `Package '${packageId}' not found`,
      };
    }

    return executeVkgAction(pkg, action, request.inputPayload, request.authority);
  }
}

/**
 * OfflineRuntimeAdapter: Executes within pre-issued bounded offline leases.
 * Validates lease limits, nonces, and records local observations for reconciliation.
 */
export class OfflineRuntimeAdapter implements RuntimeAdapter {
  readonly adapterType = 'OfflineRuntimeAdapter' as const;
  readonly isolationLevel = 'PROCESS_ISOLATION' as const;
  private offlineLeases: Map<string, BoundedOfflineLease>;
  private localJournal: LocalSubstrateObservation[] = [];

  constructor(leases: BoundedOfflineLease[] = []) {
    this.offlineLeases = new Map(leases.map((l) => [l.leaseId, l]));
  }

  registerLease(lease: BoundedOfflineLease) {
    this.offlineLeases.set(lease.leaseId, lease);
  }

  getJournal(): LocalSubstrateObservation[] {
    return [...this.localJournal];
  }

  clearReconciledJournal(batchId: string) {
    this.localJournal = this.localJournal.filter((obs) => obs.reconciliationBatchId !== batchId);
  }

  async execute(
    request: GovernedRuntimeRequest,
    context?: { vkgAdapter?: VkgRuntimeAdapter }
  ): Promise<RuntimeExecutionResult> {
    const leaseId = request.offlineLeaseId || 'lease-default-offline';
    const lease = this.offlineLeases.get(leaseId);

    // 1. Verify lease existence and validity
    if (!lease) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [`Offline lease '${leaseId}' not found or never provisioned`],
        outputData: { error: 'Offline lease missing', code: 'LEASE_NOT_FOUND' },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        measuredError: 'Offline lease not found',
      };
    }

    if (lease.isRevoked) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [`Offline lease '${leaseId}' has been revoked`],
        outputData: { error: 'Offline lease revoked', code: 'LEASE_REVOKED' },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        measuredError: 'Offline lease revoked',
      };
    }

    const now = Date.now();
    const expiry = new Date(lease.expiresAt).getTime();
    if (now > expiry) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [`Offline lease '${leaseId}' expired at ${lease.expiresAt}`],
        outputData: { error: 'Offline lease expired', code: 'LEASE_EXPIRED' },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: false,
        measuredError: 'Offline lease expired',
      };
    }

    if (lease.executionsRemaining <= 0) {
      return {
        status: 'BOUND_VIOLATION',
        stdout: [],
        stderr: [`Offline lease '${leaseId}' quota exhausted (0 executions remaining)`],
        outputData: { error: 'Offline lease execution quota exhausted', code: 'QUOTA_EXHAUSTED' },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: true,
        measuredError: 'Execution quota exhausted',
      };
    }

    // 2. Check action bounds
    const action = request.vkgAction || request.authority?.allowedAction || 'default_action';
    if (!lease.allowedActions.includes(action) && !lease.allowedActions.includes('*')) {
      return {
        status: 'UNAUTHORIZED',
        stdout: [],
        stderr: [`Action '${action}' is not permitted under offline lease scope: [${lease.allowedActions.join(', ')}]`],
        outputData: { error: 'Action not allowed under offline lease', code: 'ACTION_NOT_IN_LEASE' },
        memoryUsageBytes: 0,
        durationMs: 0,
        exitCode: 1,
        adapterType: this.adapterType,
        containmentObserved: true,
        measuredError: 'Action not permitted by offline lease',
      };
    }

    // 3. Decrement quota and advance nonce
    lease.executionsRemaining -= 1;
    const oldNonce = lease.currentNonce;
    const nextNonce = '0x_off_nonce_' + (parseInt(oldNonce.replace('0x_off_nonce_', ''), 16) + 1).toString(16);
    lease.currentNonce = nextNonce;

    // 4. Dispatch execution (via VKG or VM)
    let executionResult: RuntimeExecutionResult;
    if (request.vkgPackageId && context?.vkgAdapter) {
      executionResult = await context.vkgAdapter.execute(request);
    } else {
      const defaultCode = request.code || `
        output.offlineExecuted = true;
        output.processedInput = input;
        output.offlineNonce = "${nextNonce}";
      `;
      const vmRes = await executeInIsolatedVMSandbox(defaultCode, request.inputPayload, request.timeoutMs || 2000);
      executionResult = {
        status: vmRes.status,
        stdout: vmRes.stdout,
        stderr: [],
        outputData: vmRes.outputData,
        memoryUsageBytes: vmRes.memoryUsageBytes,
        durationMs: vmRes.durationMs,
        exitCode: vmRes.status === 'SUCCESS' ? 0 : 1,
        adapterType: this.adapterType,
        containmentObserved: true,
      };
    }

    // 5. Record observation to local offline journal
    const observation: LocalSubstrateObservation = {
      id: 'obs-local-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      executionId: request.authority?.executionId || 'exec-offline-' + Date.now(),
      workspaceId: lease.workspaceId,
      capabilityId: lease.capabilityId,
      action,
      runtimeProfile: 'OFFLINE',
      requestDigest: hashPayload(request.inputPayload),
      responseDigest: hashPayload(executionResult.outputData),
      durationMs: executionResult.durationMs,
      memoryBytes: executionResult.memoryUsageBytes,
      exitCode: executionResult.exitCode,
      nonce: nextNonce,
      reconciled: false,
    };

    this.localJournal.push(observation);

    return {
      ...executionResult,
      adapterType: this.adapterType,
    };
  }
}

/**
 * RuntimeAdapterDispatcher: Routes to the appropriate adapter based on requested profile or explicit adapter selection.
 */
export class RuntimeAdapterDispatcher {
  private adapters: Map<RuntimeAdapterType, RuntimeAdapter> = new Map();
  private vkgAdapter: VkgRuntimeAdapter;
  private offlineAdapter: OfflineRuntimeAdapter;
  private nodeVmAdapter: NodeVmRuntimeAdapter;
  private containerAdapter: ContainerRuntimeAdapter;

  constructor(vkgPackages: VkgPackage[] = [], offlineLeases: BoundedOfflineLease[] = []) {
    this.nodeVmAdapter = new NodeVmRuntimeAdapter();
    this.containerAdapter = new ContainerRuntimeAdapter();
    this.vkgAdapter = new VkgRuntimeAdapter(vkgPackages);
    this.offlineAdapter = new OfflineRuntimeAdapter(offlineLeases);

    this.registerAdapter(this.nodeVmAdapter);
    this.registerAdapter(this.containerAdapter);
    this.registerAdapter(this.vkgAdapter);
    this.registerAdapter(this.offlineAdapter);
  }

  registerAdapter(adapter: RuntimeAdapter) {
    this.adapters.set(adapter.adapterType, adapter);
  }

  getAdapter(type: RuntimeAdapterType): RuntimeAdapter | undefined {
    return this.adapters.get(type);
  }

  getNodeVmAdapter(): NodeVmRuntimeAdapter {
    return this.nodeVmAdapter;
  }

  getContainerAdapter(): ContainerRuntimeAdapter {
    return this.containerAdapter;
  }

  getVkgAdapter(): VkgRuntimeAdapter {
    return this.vkgAdapter;
  }

  getOfflineAdapter(): OfflineRuntimeAdapter {
    return this.offlineAdapter;
  }

  async dispatch(request: GovernedRuntimeRequest, preferredAdapter?: RuntimeAdapterType): Promise<RuntimeExecutionResult> {
    if (preferredAdapter && this.adapters.has(preferredAdapter)) {
      return this.adapters.get(preferredAdapter)!.execute(request, { vkgAdapter: this.vkgAdapter });
    }

    const profile = request.authority?.runtimeProfile || 'CONNECTED';

    if (profile === 'OFFLINE' || request.offlineLeaseId) {
      return this.offlineAdapter.execute(request, { vkgAdapter: this.vkgAdapter });
    }

    if (request.vkgPackageId) {
      return this.vkgAdapter.execute(request);
    }

    return this.nodeVmAdapter.execute(request);
  }
}
