# COMPUTLESS Canonical Ownership Map

Status: DRAFT CONVERGENCE MAP

Purpose: separate reusable COMPUTLESS execution-substrate primitives from duplicate or synthetic constitutional authority/evidence machinery. This map does not confer LIVE, CANONICAL, hardware-verified, or production-sealed status on any primitive.

## Decision Rules

- KEEP: reusable substrate primitive that does not mint, widen, or independently verify Veklom constitutional authority.
- WRAP: useful local/runtime primitive whose outputs must be translated into canonical CapabilityLease / P5 / PGL contracts.
- REPLACE: local implementation duplicates a canonical Veklom authority/evidence owner and must defer to that owner.
- DELETE: synthetic, permissive, or misleading proof behavior that must not survive convergence.

## src/server/cryptoUtils.ts

| Primitive | Decision | Canonical owner / target | Reason / required proof |
|---|---|---|---|
| `canonicalizeJSON()` | KEEP, subject to conformance | Canonical Veklom JSON canonicalization contract | Deterministic key sorting is implemented. Must be byte-for-byte checked against the canonical standard before hashes cross trust boundaries. |
| `hashPayload()` | KEEP, subject to conformance | Canonical evidence hashing contract | SHA-256 over local canonicalization is useful, but the byte representation must match the canonical verifier exactly. |
| `buildEvidenceMerkleTree()` | KEEP | Substrate utility feeding canonical PGL | Real SHA-256 parent-level construction. Add deterministic vectors and malformed-input tests before treating roots as proof-bearing. |
| `generateMerkleProof()` | KEEP / HARDEN | Substrate utility feeding canonical PGL | Real sibling audit-path generation. Add an independent verifier; `isValid: true` currently reflects generation success, not independent proof verification. |
| `executeInIsolatedVMSandbox()` | KEEP / HARDEN | COMPUTELESS runtime adapter | Useful V8 `vm` execution adapter. It is not equivalent to cgroups/Landlock/netns or a security boundary; adversarial isolation tests required. |
| `buildProblemDetails()` | KEEP | Shared machine-readable refusal surface | Transport formatting only; does not create authority. |
| `createAuthorizationReceipt()` | REPLACE | Canonical CAPPO / CapabilityLease / WID authority chain | Locally mints authority-like receipts using COMPUTLESS secret; duplicate constitutional authority. |
| `verifyAuthorizationReceipt()` | REPLACE | Canonical CAPPO verifier | Local verification must not become an alternate authority root. |
| `signPGLProof()` | REPLACE | Canonical P5/PGL evidence signer | Local HMAC PGL signing creates a parallel evidence universe. Keep only behind a compatibility adapter during migration if needed. |
| `verifyPGLProof()` | REPLACE / SECURITY REPAIR NOW | Canonical P5/PGL verifier | Prefix-based acceptance (`startsWith("pgl_")`) permits forged signatures. Must fail closed until canonical verifier owns this path. |
| `generateActionEvidence()` | WRAP | Canonical P5/PGL evidence schema | Useful event-shaping inputs, but local signing, `verifiable: true`, and synthetic enclave proof must not be treated as canonical proof. |
| `verifyActionEvidence()` | REPLACE / SECURITY REPAIR NOW | Canonical P5/PGL verifier | Permissive prefix fallback trusts attacker-shaped signatures; hardware checkpoint also accepts presence rather than verifying attestation. |
| `confirmActionExecution()` | WRAP / DECLASSIFY | Canonical measurement / P5 evidence | Schema/SLA/runtime calculations can be retained as observations. `sandboxIsolationIntact: true`, default hardware attestation, random monotonic delta, and TPM wording are synthetic and must not be proof-bearing. |
| `buildx402Headers()` | WRAP | Canonical settlement/ECOBE/x402 owner | Useful wire-format prototype, but local HMAC and immediate `settled` claim must be backed by canonical settlement state. |

## src/server/dbStore.ts

| Primitive / state family | Decision | Canonical owner / target | Reason / required proof |
|---|---|---|---|
| Persistent JSON DB machinery | KEEP for prototype / WRAP for product | COMPUTELESS local runtime state | Real disk-backed prototype state. Do not confuse persistence with immutable or canonical evidence. |
| `substrateNodes` / node registry | KEEP / HARDEN | COMPUTELESS runtime | Useful execution topology and provider/runtime state. Replace synthetic telemetry fields with measured values. |
| FPI provider/allocation/job state | KEEP / WRAP | COMPUTELESS runtime + canonical reconciliation | Valuable provider abstraction; runtime/provider settlement truth remains unproven until observed against real providers. |
| `cappoGrants` | REPLACE | `cappo-backend` | Duplicate authority state. COMPUTLESS should consume canonical lease/authorization outcomes, not persist its own source of authority. |
| `authorizationReceipts` | REPLACE | Canonical CAPPO / CapabilityLease | Same duplicate-authority problem. |
| `pglRecords` | WRAP then REPLACE as authority | Canonical P5/PGL | Local ledger can act as a staging/cache layer but cannot self-assert canonical proof. |
| `actionEvidenceRecords` | WRAP | Canonical P5/PGL | Preserve execution observations, then submit/translate into canonical evidence envelopes. |
| `confirmationCertificates` | WRAP / DECLASSIFY | Canonical measurement plane | Treat as local measurements only until hardware/kernel signals are independently sourced and verified. |
| seeded `INITIAL_*` mock state | DELETE from proof paths | Test/demo fixtures only | Seed data must never support LIVE, hardware, authority, settlement, or evidence claims. |

## server.ts routes and engines

| Route / engine | Decision | Canonical owner / target | Reason / required proof |
|---|---|---|---|
| `/api/health` | KEEP / correct claims | COMPUTELESS runtime | Health surface is useful, but fields such as persisted status must reflect actual state. |
| node registry routes | KEEP / HARDEN | COMPUTELESS runtime | Valid substrate concern. Synthetic CPU/memory values must not be proof-bearing. |
| capability catalog | KEEP / WRAP | Capability OS / canonical package registry | Useful discovery surface if mapped to canonical packages/capabilities. |
| `/api/substrate/cappo/issue` | REPLACE | `cappo-backend` | Hard-coded local HMAC (`veklom-key`) is not canonical CAPPO issuance. Remove from production path. |
| `/api/substrate/cappo` local grants | REPLACE | `cappo-backend` | COMPUTELESS may display/cache canonical lease state but must not own authority. |
| HRMR 403/503 routing logic | KEEP / INTEGRATE | COMPUTELESS runtime under canonical CAPPO | Valuable invariant: authority denial is terminal while infrastructure failure may reroute. Authority decision must come from canonical CAPPO, not local grant lookup. |
| Layer-7 mock execution output | KEEP only as test fixture / REPLACE in product path | Real COMPUTELESS execution adapter | Current route constructs a mock output object; not a real workload consequence. |
| local PGL record creation on route | REPLACE | Canonical P5/PGL | Runtime should emit observations/evidence inputs to canonical evidence owner rather than self-seal proof. |
| local x402 `settled` headers | WRAP / verify | Canonical settlement owner | Do not claim settlement merely because a response header is emitted. |
| FPI routes/workflows | KEEP / HARDEN | COMPUTELESS runtime | Preserve provider abstraction; prove real provider execution and settlement separately. |
| sandbox execution endpoints using V8 `vm` | KEEP / HARDEN | COMPUTELESS runtime | Useful local adapter, not kernel isolation. |
| Action Evidence / AECC endpoints | WRAP / DECLASSIFY | Canonical P5/PGL + measurement | Retain observable execution metadata; strip synthetic hardware/security claims until independently measured. |

## Canonical convergence target

```text
Capability OS / PGO
        ↓
Canonical WID
        ↓
Canonical CapabilityLease
        ↓
Canonical CAPPO
        ↓
        ├── CONNECTED runtime
        ├── COMPUTELESS runtime → .vkg / local substrate
        └── OFFLINE runtime → bounded local lease
                    ↓
            Canonical P5 / PGL
                    ↓
              Reconciliation
```

COMPUTLESS must not remain an independent CAPPO, PGL, hardware-attestation, or settlement authority.

## Immediate falsification gates

1. Forged PGL signatures beginning with `pgl_` must be rejected by both `verifyActionEvidence()` and `verifyPGLProof()`.
2. Missing `SUBSTRATE_CRYPTO_SECRET` must not silently fall back to a repository-known production signing key.
3. Merkle proof validity must be checked by an independent verifier, not asserted by the generator.
4. AECC must never report hardware TPM/enclave verification unless an external attestation verifier has actually supplied a verified result.
5. `sandboxIsolationIntact` must be derived from real containment evidence; V8 `vm` execution alone cannot satisfy kernel-isolation claims.
6. HRMR must consume a canonical CAPPO decision/lease and prove a 403 cannot reroute while a 503 can reroute without authority widening.
7. Seed/mock data must be impossible to surface as production proof-bearing state.

## Truthful current classification

- Canonical JSON hashing: IMPLEMENTED / CONFORMANCE UNPROVEN
- Merkle tree + proof-path generation: IMPLEMENTED / INDEPENDENT VERIFICATION NEEDED
- COMPUTELESS local execution pipeline: IMPLEMENTED PROTOTYPE / ADVERSARIAL PROOF NEEDED
- HRMR 403/503 routing logic: IMPLEMENTED / CANONICAL AUTHORITY INTEGRATION NEEDED
- FPI registry/workflow: IMPLEMENTED / RUNTIME STATUS UNPROVEN
- Local DB-backed ledger: IMPLEMENTED / NOT CANONICAL PGL
- COMPUTLESS CAPPO grant system: PROTOTYPE / REDUNDANT / REPLACE
- COMPUTLESS PGL signing/verification: SECURITY FALSIFIER CONFIRMED IN SOURCE / REPAIR REQUIRED
- AECC: IMPLEMENTED / SYNTHETIC HARDWARE SIGNALS / NOT HARDWARE VERIFIED
- TPM/enclave proof: NOT VERIFIED
- cgroups/Landlock/netns: NOT KERNEL VERIFIED BY THIS REPO
- `.vkg`: REQUIRES EXECUTABLE-CODE CONFIRMATION BEFORE `IMPLEMENTED_BUT_UNPROVEN`
- 9P/mmap: PARTIAL / SOURCE-SPECIFIC PROOF REQUIRED
- offline reconciliation: PARTIAL / SOURCE-SPECIFIC PROOF REQUIRED
- Capability OS COMPUTELESS surface: EXTRACTABLE / NOT LIVE UNTIL CANONICAL BACKEND WIRED
