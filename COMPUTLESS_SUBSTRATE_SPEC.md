# COMPUTLESS CLOUD: 8-Layer Decentralized Substrate Architecture Specification

**Version:** 2.4.0-Enterprise-Topological  
**Network:** Computless Cloud Global Substrate (`substrate-mainnet-1`)  
**Specification Status:** Formalized & Cryptographically Governed  
**Core Invariants:** Invariant 1 (403 Fail-Closed Terminal Authority), Invariant 2 (503 Transparent Fallback Reroute), Non-Ambient Authority, Evidence Completeness.

---

## Executive Architectural Overview

The **COMPUTLESS CLOUD Substrate** is a decentralized, non-ambient execution fabric where applications, autonomous agents, and distributed workloads execute across heterogeneous infrastructure without vendor lock-in or ambient trust assumptions. 

Every single transaction across the platform traverses **8 deterministic, mathematical substrate layers**:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Layer 1: CAPABILITY    ───  What is being requested?                  │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 2: AUTHORITY     ───  Who is allowed to request it?             │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 3: FEDERATION    ───  Which providers can execute it?           │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 4: ROUTING       ───  Which provider should execute it now?     │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 5: EXECUTION     ───  Where does the action actually run?       │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 6: EVIDENCE      ───  What cryptographic proof was produced?    │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 7: MEASUREMENT   ───  Did the action actually happen?           │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Layer 8: SETTLEMENT    ───  What economic finality is required?        │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## Layer-by-Layer Detailed Specifications

### Layer 1: Capability Layer
> **Guiding Question:** *"What is being requested?"*

- **Purpose:** Decouples the intent and definition of work from the underlying physical infrastructure or vendor implementation.
- **Core Principle:** Strict typed semantic schema declarations. Actions are defined by capability identifiers, versioned input/output JSON schemas, and minimum compute boundaries rather than hardcoded server IP addresses or cloud provider APIs.
- **Primary Mechanism:** Capability Catalog & Semantic Schema Registry (`CapabilityDefinition`).
- **Data Structures:**
  ```typescript
  interface CapabilityDefinition {
    id: string; // e.g. "cap-compute-v1", "cap-rf-telecom", "cap-persist-v1"
    name: string;
    description: string;
    category: 'compute' | 'data_persistence' | 'edge_rf' | 'agent_recursion' | 'mcp_bridge';
    requiredRole: string;
    schemaJson: string; // JSON Schema for parameter validation
  }
  ```
- **Invariants:** Every invocation must validate against a registered JSON Schema. Unregistered capabilities are rejected at ingress.

---

### Layer 2: Authority Layer
> **Guiding Question:** *"Who is allowed to request it?"*

- **Purpose:** Enforces zero-trust, non-ambient authorization for all actors (humans, services, and autonomous agent loops).
- **Core Principle:** Non-ambient authority via capability-scoped credentials (CAPPO Grants) and single-use, non-replayable Authorization Receipts.
- **Primary Mechanism:** CAPPO (Capability Authorization & Policy Protocol Object) Grants + Nonce-bound HMAC-SHA256 Authorization Receipts (`AuthorizationReceipt`).
- **Data Structures:**
  ```typescript
  interface AuthorizationReceipt {
    receiptId: string;
    cappoGrantId: string;
    subject: string; // e.g. "agent:veklom-root-001"
    scopeDigest: string; // SHA-256 digest of { cappoGrantId, subject, targetCapability, policyId }
    nonce: string; // Non-replayable 64-bit entropy nonce
    policyId: string;
    targetCapability: string;
    issuedAt: string;
    expiresAt: number;
    signature: string; // HMAC-SHA256 cryptographic signature
    status: 'active' | 'consumed' | 'expired';
  }
  ```
- **Invariant 1 (Authority):** **403 Fail-Closed Terminal Refusal.** If a CAPPO token is missing, expired, revoked, or lacks the required capability scope, the substrate terminates execution immediately with RFC 9457 Problem Details (`https://computless.cloud/probs/cappo-403-forbidden`). Zero permission hunting or ambient privilege escalation is permitted.

---

### Layer 3: Federation Layer
> **Guiding Question:** *"Which providers can execute it?"*

- **Purpose:** Aggregates and normalizes compute, memory, storage, and specialized hardware across heterogeneous providers (hyperscalers, sovereign enclaves, decentralized edge meshes, bare-metal rigs).
- **Core Principle:** Sovereign resource interoperability via the Federation Provider Interface (FPI).
- **Primary Mechanism:** FPI Provider Registry, Locality & Sovereignty Tagging, Dynamic Quota Leases, and Spot/Reserved Pricing Catalogs (`FPIProvider`).
- **Data Structures:**
  ```typescript
  interface FPIProvider {
    id: string;
    providerName: string;
    providerType: 'hyperscaler' | 'sovereign_enclave' | 'decentralized_mesh' | 'edge_telecom';
    endpointUrl: string;
    regions: string[];
    status: 'active' | 'degraded' | 'suspended';
    slaUptimePct: number;
    maxLatencyMs: number;
    isSovereignEnclave: boolean;
    supportedCapabilities: string[];
    pricing: { pricePerComputeUnitVEK: number; spotDiscountPct: number };
    quota: { totalAllocatedUnits: number; usedUnits: number; maxCapacityUnits: number };
  }
  ```
- **Invariants:** Providers must maintain active cryptographic heartbeats and adhere to verified SLA uptime constraints to participate in the federation pool.

---

### Layer 4: Routing Layer
> **Guiding Question:** *"Which provider should execute it now?"*

- **Purpose:** Dynamically determines the optimal physical execution target in real time based on multi-objective constraints (latency, data sovereignty, SLA, gas cost, node capacity).
- **Core Principle:** High-Resilience Mesh Routing (HRMR) with continuous topological scoring and zero authority drift during failovers.
- **Primary Mechanism:** HRMR Routing Engine using scoring function:
  $$\text{Score}(N) = w_{\text{lat}} \cdot (1 - \frac{\text{lat}}{\text{maxLat}}) + w_{\text{sla}} \cdot \text{SLA} + w_{\text{sov}} \cdot \mathbb{I}_{\text{sovereign}} - w_{\text{cost}} \cdot \text{Price}$$
- **Invariant 2 (Execution):** **503 Transparent Fallback Reroute.** If a selected node or enclave becomes degraded, unreachable, or returns a 503 error, HRMR automatically failovers to the next highest-scoring healthy node without restarting the authorization handshake or altering the original capability contract.

---

### Layer 5: Execution Layer
> **Guiding Question:** *"Where does the action actually run?"*

- **Purpose:** Executes the bounded workload inside isolated, resource-governed sandbox containment cells.
- **Core Principle:** Strict non-ambient sandboxing, ephemeral memory spaces, execution timeouts, and syscall restrictions.
- **Primary Mechanism:**
  - **Node.js V8 VM Sandboxes:** In-process bounded execution with memory limits, timeouts, and sanitized global namespaces.
  - **Docker Isolated Enclaves:** OCI container isolation for compiled or binary workloads.
  - **E2B Cloud Cells:** Micro-VM remote cloud containment cells for heavy autonomous agent operations.
  - **Edge RF Microcontrollers:** Embedded firmware dispatch for low-power sensor and mesh nodes.
- **Data Structures:**
  ```typescript
  interface SandboxExecutionResult {
    executionId: string;
    sandboxType: 'node_vm' | 'docker_isolated' | 'e2b_cloud_cell' | 'rf_edge';
    status: 'SUCCESS' | 'TERMINATED_TIMEOUT' | 'RUNTIME_ERROR';
    stdout: string[];
    outputData: Record<string, unknown>;
    memoryUsageBytes: number;
    executionDurationMs: number;
  }
  ```
- **Invariants:** Sandboxes cannot access ambient host filesystems, network interfaces, or environment variables unless explicitly injected via the verified input payload.

---

### Layer 6: Evidence Layer
> **Guiding Question:** *"What cryptographic proof was produced?"*

- **Purpose:** Guarantees non-repudiation, tamper-evidence, and verifiable provenance for every executed task.
- **Core Principle:** Cryptographic proof generation binding input hashes, output hashes, execution node IDs, and authorization tokens into an append-only Proof Graph Ledger (PGL).
- **Primary Mechanism:** PGL Hash Chaining & HMAC-SHA256 Proof Signatures (`PGLRecord`).
- **Data Structures:**
  ```typescript
  interface PGLRecord {
    id: string; // e.g. "pgl-2026-881902"
    timestamp: string;
    transactionId: string;
    capabilityId: string;
    cappoGrantId: string;
    executedNodeId: string;
    requestPayloadHash: string; // SHA-256(Input)
    responseHash: string; // SHA-256(Output)
    pglSignature: string; // HMAC-SHA256(TxId + CapId + InputHash + OutputHash)
    x402GasSettled: number;
    verifiable: boolean;
  }
  ```
- **Invariants:** Every state transition must produce a publicly verifiable PGL record. Any modification to input or output invalidates the proof signature.

---

### Layer 7: Measurement Layer
> **Guiding Question:** *"Did the action actually happen?"*

- **Purpose:** Collects objective, verifiable telemetry and attestation confirming that physical work was executed according to SLA agreements.
- **Core Principle:** Hardware-anchored and wall-clock telemetry profiling (CPU duration, memory delta, I/O bytes, node latency, uptime).
- **Primary Mechanism:** Real-time Substrate Telemetry Collector & SLA Attestation Monitor.
- **Measurement Metrics:**
  - **Actual Wall-Clock Latency ($ms$):** Measured execution duration.
  - **Memory Delta ($\Delta \text{Bytes}$):** Exact heap/RAM allocated during the run.
  - **Node Uptime Verification ($\%$):** Multi-region node availability attestation.
  - **Throughput ($Ops/sec$):** Rate of verified transactions processed.
- **Invariants:** Discrepancies between advertised provider SLA and measured execution metrics trigger automated FPI penalty slashing and dynamic rerouting.

---

### Layer 8: Settlement Layer
> **Guiding Question:** *"What economic finality is required?"*

- **Purpose:** Provides machine-native economic finality, micro-gas settlement, and automated revenue distribution to infrastructure providers.
- **Core Principle:** HTTP x402 Micropayment Protocol & VEK Utility Token Ledger Settlement.
- **Primary Mechanism:** Standardized HTTP response headers (`X-402-Payment-Required`, `X-402-Gas-Settled`, `X-402-Receipt`) with automated provider account reconciliation.
- **Settlement Formula:**
  $$\text{Gas (VEK)} = \text{BaseFee} + (\text{CPU Duration}_{ms} \times \text{Rate}_{\text{compute}}) + (\text{Memory}_{\text{MB}} \times \text{Rate}_{\text{ram}})$$
- **Data Structures:**
  ```typescript
  interface FPIBillingSettlement {
    id: string;
    providerId: string;
    period: string;
    jobsExecuted: number;
    totalComputeUnitsUsed: number;
    totalx402EarnedVEK: number;
    payoutStatus: 'settled' | 'pending';
    payoutTxHash: string; // e.g. "0x98f21ab..."
    timestamp: string;
  }
  ```
- **Invariants:** 100% immediate economic finality. Providers are credited in VEK micro-units instantaneously upon successful PGL proof verification.

---

## Amplification & Recursion Invariants

The Computless Substrate incorporates the **Veklom Amplification Ladder** and **Mathematical Recursion Cycle**:

### Amplification Ladder Formula
$$A = f(G, R, B, S, E, I, N)$$
Where:
- $G$ = Governed Actions (Total interactions mediated by substrate authority gates)
- $R$ = Authorization Receipts (Cryptographically signed, non-replayable tokens)
- $B$ = Blocked Intents (Fail-closed 403 terminal denials)
- $S$ = Safe Routes (HRMR paths traversed without ambient authority escape)
- $E$ = Evidence Chain Entries (PGL proof blocks)
- $I$ = Durable Agent Identities (Trust Tiers T0–T4)
- $N$ = Integrations & FPI Federation Providers

### Recursion Loop Invariant
$$R_{n+1} = R_n + \Delta E$$
Each recursive autonomous loop iteration advances the evidence chain by $\Delta E$, registering immutable PGL blocks, refining execution parameters, and lowering substrate entropy.

---

## Implementation & File Map

- `src/types.ts`: TypeScript type definitions for all 8 layers, pipeline requests, and results.
- `server.ts`: REST API routes for all 8 layers (`/api/substrate/pipeline/execute`, `/api/substrate/spec`, etc.).
- `src/server/cryptoUtils.ts`: Cryptographic primitives (HMAC-SHA256, Authorization Receipts, PGL proofs, Isolated VM sandboxes).
- `src/server/dbStore.ts`: File-backed persistent storage (`data/substrate_db.json`) for nodes, grants, providers, receipts, PGL records, and agent identities.
- `src/components/Substrate8LayerPipelineExplorer.tsx`: Interactive, live 8-layer visualizer and execution testbed.
- `src/data/mockData.ts`: 8-layer canonical architecture specification data and capability schemas.
