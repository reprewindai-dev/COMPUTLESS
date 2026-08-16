# COMPUTLESS CLOUD: Architecture Specification

Please see the comprehensive, canonical specification in:
- [`COMPUTLESS_SUBSTRATE_SPEC.md`](./COMPUTLESS_SUBSTRATE_SPEC.md)

### Canonical 8-Layer Pipeline Summary

| Layer | Name | Canonical Question | Mechanism | Invariant / Guarantee |
|---|---|---|---|---|
| **1** | **Capability** | *What is being requested?* | Capability Registry & JSON Schemas | Strict typed semantic schema validation |
| **2** | **Authority** | *Who is allowed to request it?* | CAPPO Grants & Authorization Receipts | Invariant 1: 403 Fail-Closed Terminal Denial |
| **3** | **Federation** | *Which providers can execute it?* | Federation Provider Interface (FPI) | Sovereign multi-provider normalization & SLA pool |
| **4** | **Routing** | *Which provider should execute it now?* | HRMR Multi-Objective Scoring | Invariant 2: 503 Transparent Fallback Reroute |
| **5** | **Execution** | *Where does the action actually run?* | Isolated V8 VM / Docker Enclave Sandboxes | Non-ambient sandboxed execution & timeouts |
| **6** | **Evidence** | *What cryptographic proof was produced?* | Proof Graph Ledger (PGL) | Cryptographic HMAC-SHA256 non-repudiation proofs |
| **7** | **Measurement** | *Did the action actually happen?* | Real-time Telemetry & SLA Attestation | Verified wall-clock latency, CPU & memory delta |
| **8** | **Settlement** | *What economic finality is required?* | x402 Micropayments & VEK Gas Protocol | Immediate economic finality & provider payouts |

---
*Maintained by the COMPUTLESS CLOUD Core Engineering Substrate.*
