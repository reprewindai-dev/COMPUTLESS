import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { dbStore } from './src/server/dbStore.js';
import {
  hashPayload,
  signPGLProof,
  verifyPGLProof,
  buildProblemDetails,
  buildx402Headers,
  createAuthorizationReceipt,
  verifyAuthorizationReceipt,
  verifyCanonicalAuthority,
  executeInIsolatedVMSandbox,
  generateActionEvidence,
  verifyActionEvidence,
  confirmActionExecution,
  buildEvidenceMerkleTree,
  buildLocalScopeToken,
  signingKeyInfo,
  verifyPGLRecordSignature,
  LOCAL_SIGNATURE_SCOPE,
  SCOPE_TOKEN_NOTE,
} from './src/server/cryptoUtils.js';
import { validateVkgPackage, vkgDigestEvidence } from './src/server/vkgEngine.js';
import { RuntimeAdapterDispatcher, decideRoute } from './src/server/runtimeAdapters.js';
import { runAdversarialTestSuite } from './src/server/adversarialTests.js';
import { registerFabricRoutes, startCapiRegistration, governedExecution, fabricConfig } from './src/server/fabric.js';
import { registerFabricDataRoutes } from './src/server/fabricData.js';
import { SANDBOX_BOUNDARY } from './src/server/sandbox.js';
import { CAPABILITY_CATALOG, MCP_TOOLS_CATALOG, SUBSTRATE_8_LAYER_SPEC } from './src/data/mockData.js';
import {
  SubstrateNode,
  CAPPOGrant,
  PGLRecord,
  EvidenceLabel,
  HRMRRouteRequest,
  HRMRRouteResult,
  RouteTraceStep,
  FPIProvider,
  FPIResourceAllocation,
  FPIExecutionJob,
  FPIBillingSettlement,
  FPIDiscoveryQuery,
  AuthorizationReceipt,
  BlockedIntentRecord,
  AgentIdentity,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  Substrate8LayerPipelineRequest,
  Substrate8LayerPipelineResult,
  ActionEvidenceRecord,
  ActionSignatureRequest,
  ActionConfirmationRequest,
  ActionExecutionConfirmationCertificate,
  CanonicalExecutionAuthority,
  GovernedRuntimeRequest,
  VkgPackage,
  BoundedOfflineLease,
  LocalSubstrateObservation,
  ReconciliationPayload,
} from './src/types.js';

/** Measured elapsed milliseconds since `start` (process.hrtime). */
function elapsedMs(start: bigint): number {
  return +(Number(process.hrtime.bigint() - start) / 1e6).toFixed(3);
}

/** Governance context set by fabric.governedExecution (CAPPO decision or local-demo). */
function governanceOf(res: express.Response): { mode: 'disabled' | 'local-demo' | 'governed'; authorization: Record<string, any> | null } {
  const g = res.locals.governance as { mode?: string; authorization?: Record<string, any> | null } | undefined;
  const mode = g?.mode === 'governed' || g?.mode === 'disabled' ? g.mode : 'local-demo';
  return { mode, authorization: g?.authorization ?? null };
}

/**
 * Returns the caller's scope token if it passes the integrity check, or a
 * server-built one when none was sent. A failing token is a 422 (malformed
 * input), not a 403: it is not an authorization decision.
 */
function resolveScopeToken(
  supplied: CanonicalExecutionAuthority | undefined,
  defaults: { capabilityId: string; allowedAction?: string }
):
  | { ok: true; token: CanonicalExecutionAuthority }
  | { ok: false; problem: (instance: string) => Record<string, unknown> } {
  if (!supplied) return { ok: true, token: buildLocalScopeToken(defaults) };
  const check = verifyCanonicalAuthority(supplied);
  if (check.valid) return { ok: true, token: { ...supplied, canonical: false, source: supplied.source || 'caller-supplied scope token' } };
  return {
    ok: false,
    problem: (instance) => ({
      ...buildProblemDetails('invalid-scope-token', 'Invalid Scope Token', 422, `${check.error}. Omit 'authority' to let the server build a scope token.`, instance),
      note: SCOPE_TOKEN_NOTE,
    }),
  };
}

const NOT_AUTHORIZED_DEMO_NOTE = 'NOT AUTHORIZED: local-demo mode ran this without any authorization (no CAPPO configured).';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Veklom fabric: /health, /health/dependencies, /protocol.json, /protocol/introspect, /api/fabric/status
  registerFabricRoutes(app);
  registerFabricDataRoutes(app);

  // 1. Health check endpoint
  app.get('/api/health', (req, res) => {
    const persistence = dbStore.getPersistenceStatus();
    res.json({
      status: 'ok',
      substrateVersion: '0.1.0-prototype',
      architecture: 'Prototype: local Express server + child-process sandbox',
      executionMode: fabricConfig.executionMode,
      /** Real result of the last write of the local JSON store (null = no write yet). */
      dbPersisted: persistence.lastSaveOk,
      persistence,
      signingKey: signingKeyInfo(),
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // 2. Substrate Nodes API
  app.get('/api/substrate/nodes', (req, res) => {
    res.json(dbStore.getSubstrateNodes());
  });

  app.post('/api/substrate/nodes', (req, res) => {
    const { name, type, region, localityBoundary, isSovereign, mcpEnabled, supportedCapabilities, latencyMs } = req.body;
    if (!name || !region || !localityBoundary) {
      return res.status(400).json(
        buildProblemDetails('invalid-node-registration', 'Invalid Compute Node Data', 400, 'name, region, and localityBoundary are required', req.originalUrl)
      );
    }

    const id = 'node-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + crypto.randomBytes(2).toString('hex');
    const declaredLatency = Number(latencyMs);
    const newNode: SubstrateNode = {
      id,
      name,
      type: type || 'local_k8s',
      region,
      // No node probe exists: a registered node is never observed online.
      status: 'unverified',
      latencyMs: Number.isFinite(declaredLatency) && declaredLatency > 0 ? declaredLatency : null,
      cpuUsagePct: null,
      memoryUsagePct: null,
      activeWorkloads: null,
      supportedCapabilities: supportedCapabilities && supportedCapabilities.length > 0 ? supportedCapabilities : ['cap-compute-v1'],
      localityBoundary,
      isSovereign: Boolean(isSovereign),
      mcpEnabled: Boolean(mcpEnabled),
      evidenceLabel: 'UNVERIFIED',
    };

    dbStore.addSubstrateNode(newNode);
    res.status(201).json({
      success: true,
      message: 'Node record added to the local registry. It has not been contacted or probed (status: unverified); latency is as declared, CPU/memory are not measured.',
      node: newNode,
    });
  });

  app.post('/api/substrate/nodes/toggle', (req, res) => {
    const { nodeId, status, latencyMs } = req.body;
    const node = dbStore.toggleSubstrateNode(nodeId, status, latencyMs);
    if (!node) {
      return res.status(404).json(
        buildProblemDetails('node-not-found', 'Substrate Node Not Found', 404, `No node found matching ID ${nodeId}`, req.originalUrl)
      );
    }
    res.json({ success: true, node });
  });

  // 3. Capability Catalog & Grants
  app.get('/api/substrate/capabilities', (req, res) => {
    res.json(CAPABILITY_CATALOG);
  });

  app.get('/api/substrate/cappo', (req, res) => {
    res.json(dbStore.getCappoGrants());
  });

  app.post('/api/substrate/cappo/issue', (req, res) => {
    const { subject, allowedCapabilities, durationHours = 24 } = req.body;
    if (!subject || !Array.isArray(allowedCapabilities) || allowedCapabilities.length === 0) {
      return res.status(400).json(
        buildProblemDetails('invalid-cappo-request', 'Invalid CAPPO Issue Request', 400, 'subject and allowedCapabilities are required', req.originalUrl)
      );
    }

    const grantId = 'cappo-grant-' + crypto.randomBytes(3).toString('hex');
    const issuer = 'computless-local-demo (not CAPPO)';
    const issueDate = new Date().toISOString();
    const expiresAt = Date.now() + Number(durationHours) * 3600000;

    // Unsigned, unkeyed digest: anyone can compute it. COMPUTLESS does not mint CAPPO authority.
    const grantDigest = 'unsigned-local-digest:' + hashPayload({ grantId, issuer, subject, allowedCapabilities, expiresAt }).slice(2, 34);

    const newGrant: CAPPOGrant = {
      grantId,
      issuer,
      subject,
      allowedCapabilities,
      issueDate,
      expiresAt,
      isRevoked: false,
      cappoSignature: grantDigest,
      signature: grantDigest,
      status: 'active',
      evidenceLabel: 'UNVERIFIED',
      canonical: false,
      authoritySource: 'local-grant (not CAPPO)',
    };

    dbStore.addCappoGrant(newGrant);

    res.status(201).json({
      success: true,
      message:
        'Local grant record created. It is NOT issued by CAPPO, is unsigned, and does not authorize code execution (only the /api/substrate/route demo reads it).',
      grant: newGrant,
    });
  });

  // 4. HRMR routing demo (Two Invariants). Authority here is a LOCAL grant lookup
  //    (not CAPPO) and no workload runs: the output is a DEMO echo.
  app.post('/api/substrate/route', (req, res) => {
    const t0 = process.hrtime.bigint();
    const body: HRMRRouteRequest = req.body;
    const {
      capabilityId,
      cappoGrantId = 'cappo-grant-alpha-001',
      preferredNodeId = 'node-local-k8s',
      payload = {},
      force503NodeId,
      invalidCappo,
    } = body;

    const txId = 'tx-vk-' + crypto.randomBytes(4).toString('hex');
    const timestamp = new Date().toISOString();
    const trace: RouteTraceStep[] = [];
    let stepCount = 1;

    trace.push({
      step: stepCount++,
      timestamp,
      layer: 'Layer 1: Substrate & Layer 2: Network',
      status: 'PENDING',
      detail: `Received request for capability: ${capabilityId}. Preferred registry entry: ${preferredNodeId}`,
    });

    const substrateNodes = dbStore.getSubstrateNodes();
    const cappoGrants = dbStore.getCappoGrants();

    const capDef = CAPABILITY_CATALOG.find((c) => c.id === capabilityId);
    const cappoGrant = cappoGrants.find((g) => g.grantId === cappoGrantId);

    const isAuthorityValid = Boolean(
      !invalidCappo &&
        cappoGrant &&
        !cappoGrant.isRevoked &&
        cappoGrant.expiresAt > Date.now() &&
        cappoGrant.allowedCapabilities.includes(capabilityId)
    );

    let targetNode = substrateNodes.find((n) => n.id === preferredNodeId);
    const primaryAvailable = Boolean(targetNode && targetNode.status !== 'offline' && targetNode.id !== force503NodeId);
    const availableFallback = substrateNodes.find(
      (n) => n.status !== 'offline' && n.id !== preferredNodeId && n.id !== force503NodeId && n.supportedCapabilities.includes(capabilityId)
    );
    const decision = decideRoute({ authorityValid: isAuthorityValid, primaryAvailable, fallbackAvailable: Boolean(availableFallback) });

    if (decision.outcome === 'TERMINAL_403') {
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 5: Authority (local grant, not CAPPO)',
        status: 'TERMINAL_403',
        detail: `[INVARIANT 1] HTTP 403 terminal. Local grant ${cappoGrantId} is missing, revoked, expired or lacks '${capabilityId}'. No fallback search.`,
      });

      res.setHeader('Content-Type', 'application/problem+json');
      res.setHeader('X-Veklom-CAPPO', 'NOT_CONSULTED');
      res.setHeader('X-Substrate-Invariant', 'Authority-Invariant-403');

      const result403: HRMRRouteResult = {
        transactionId: txId,
        capabilityId,
        requestedNodeId: preferredNodeId,
        finalHttpStatus: 403,
        authorityDecision: 'DENIED_TERMINAL',
        executionStatus: 'FAILED',
        executionTimeMs: elapsedMs(t0),
        trace,
        outputData: buildProblemDetails('cappo-403-forbidden', 'Local Grant Check Failed', 403, `Local grant ${cappoGrantId} is invalid, revoked, expired, or missing capability '${capabilityId}'. (Local grant, not CAPPO.)`, req.originalUrl),
        evidenceLabel: 'DEMO',
        authoritySource: 'local-grant (not CAPPO)',
      };
      return res.status(403).json(result403);
    }

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 5: Authority (local grant, not CAPPO)',
      status: 'SUCCESS',
      detail: `Local grant found for subject ${cappoGrant?.subject} (local grant (not CAPPO); no signature checked).`,
    });

    let executedNodeId = preferredNodeId;
    let isFallback = false;

    if (decision.outcome !== 'PRIMARY') {
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 6: Routing (HRMR)',
        status: 'FALLBACK_503',
        detail: `[INVARIANT 2] Registry entry ${preferredNodeId} (${targetNode?.name || 'unknown'}) is offline or forced to 503. Searching for a fallback; authority is unchanged.`,
      });

      if (decision.outcome === 'FALLBACK' && availableFallback) {
        executedNodeId = availableFallback.id;
        targetNode = availableFallback;
        isFallback = true;
        trace.push({
          step: stepCount++,
          timestamp: new Date().toISOString(),
          layer: 'Layer 6: Routing (HRMR)',
          status: 'SUCCESS',
          detail: `Fallback registry entry selected: ${availableFallback.name} (status ${availableFallback.status}, not probed).`,
        });
      } else {
        trace.push({
          step: stepCount++,
          timestamp: new Date().toISOString(),
          layer: 'Layer 6: Routing (HRMR)',
          status: 'FALLBACK_503',
          detail: 'No registry entry available for this capability. Returning HTTP 503.',
        });
        res.setHeader('Content-Type', 'application/problem+json');
        res.setHeader('X-Substrate-Invariant', 'Fallback-Invariant-503');
        const result503: HRMRRouteResult = {
          transactionId: txId,
          capabilityId,
          requestedNodeId: preferredNodeId,
          finalHttpStatus: 503,
          authorityDecision: 'GRANTED',
          executionStatus: 'FAILED',
          executionTimeMs: elapsedMs(t0),
          trace,
          outputData: buildProblemDetails('infrastructure-503-unavailable', 'No Registry Entry Available', 503, 'All candidate registry entries are offline.', req.originalUrl),
          evidenceLabel: 'DEMO',
          authoritySource: 'local-grant (not CAPPO)',
        };
        return res.status(503).json(result503);
      }
    } else {
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 6: Routing (HRMR)',
        status: 'SUCCESS',
        detail: `Registry entry ${targetNode!.name} selected (status ${targetNode!.status}; never probed).`,
      });
    }

    // No workload runs on this route: the output is a DEMO echo.
    const mockOutput = {
      result: 'DEMO_NOT_EXECUTED',
      note: 'Routing demo only: no workload ran. Use /api/substrate/sandbox/execute to run code.',
      capability: capDef?.name || capabilityId,
      selectedRegistryEntry: targetNode?.name,
      payloadEcho: payload,
      evidenceLabel: 'DEMO' as EvidenceLabel,
    };

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 7: Execution',
      status: 'SUCCESS',
      detail: 'No workload was executed (routing demo). Output is a DEMO echo of the payload.',
    });

    const requestHash = hashPayload(payload);
    const responseHash = hashPayload(mockOutput);
    const pglSig = signPGLProof(txId, capabilityId, requestHash, responseHash);

    const pglRecord: PGLRecord = {
      id: 'pgl-rec-' + Date.now().toString().slice(-6),
      timestamp,
      transactionId: txId,
      capabilityId,
      cappoGrantId,
      executedNodeId,
      requestPayloadHash: requestHash,
      responseHash,
      pglSignature: pglSig,
      x402GasSettled: null,
      verifiable: false,
      evidenceLabel: 'DEMO',
      canonical: false,
      signatureScheme: 'local-hmac-pgl-proof-v1',
    };
    pglRecord.verifiable = verifyPGLRecordSignature(pglRecord);
    dbStore.addPGLRecord(pglRecord);

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 8: Local record',
      status: 'SUCCESS',
      detail: `Local HMAC record ${pglRecord.id} written (not canonical PGL). No settlement.`,
    });

    Object.entries(buildx402Headers(executedNodeId, txId)).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('X-Veklom-CAPPO', 'NOT_CONSULTED');

    const finalResult: HRMRRouteResult = {
      transactionId: txId,
      capabilityId,
      requestedNodeId: preferredNodeId,
      executedNodeId,
      finalHttpStatus: 200,
      authorityDecision: 'GRANTED',
      executionStatus: isFallback ? 'REROUTED_FALLBACK' : 'SUCCESS',
      executionTimeMs: elapsedMs(t0),
      pglProofHash: pglRecord.responseHash,
      x402SettlementGas: null,
      trace,
      outputData: mockOutput,
      evidenceLabel: 'DEMO',
      authoritySource: 'local-grant (not CAPPO)',
    };

    res.json(finalResult);
  });

  // 5. Herdr Recursive Agent Engine
  app.get('/api/agents', (req, res) => {
    res.json(dbStore.getAgentTasks());
  });

  /**
   * Asks the configured model (Gemini) for a text suggestion. The output is an
   * UNVERIFIED AI suggestion: it changes no metric and is never sealed as evidence.
   */
  app.post('/api/agents/step', async (req, res) => {
    const { taskId, userPrompt } = req.body;
    const agentTasks = dbStore.getAgentTasks();
    const task = agentTasks.find((t) => t.id === taskId) || agentTasks[0];
    if (!task) {
      return res.status(404).json(buildProblemDetails('agent-task-not-found', 'Agent Task Not Found', 404, `No task matching ${taskId}`, req.originalUrl));
    }

    task.recursionDepth = Math.min(task.maxRecursionDepth, task.recursionDepth + 1);
    task.lastOptimizedAt = new Date().toISOString();

    let aiRecommendation = '';
    let source: 'gemini' | 'no-model' = 'no-model';
    let modelError: string | null = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `You are an assistant suggesting architecture ideas for a prototype execution server.
Task: ${task.name}
User Context/Prompt: ${userPrompt || 'Suggest improvements to capability routing and dispatch.'}
Recent Task Logs: ${task.logs.slice(-3).join('\n')}

Give a concise, 2-bullet suggestion. Do not claim any measurement or performance numbers. Keep under 80 words.`,
        });
        aiRecommendation = (response.text || '').trim();
        if (aiRecommendation) source = 'gemini';
      } catch (err: any) {
        modelError = String(err?.message ?? err).slice(0, 200);
        console.warn('Gemini API call failed:', modelError);
      }
    }

    if (!aiRecommendation) {
      aiRecommendation = process.env.GEMINI_API_KEY
        ? `Model call failed; no suggestion generated${modelError ? ` (${modelError})` : ''}.`
        : 'No model configured (GEMINI_API_KEY is not set); no suggestion was generated.';
    }

    task.logs.push(
      `[Herdr step ${task.recursionDepth}] [${source === 'gemini' ? 'AI suggestion (gemini, unverified)' : 'no model'}] ${aiRecommendation.replace(/\n/g, ' ')}`
    );
    task.status = 'EVALUATING';
    dbStore.persist();

    res.json({
      success: source === 'gemini',
      task,
      aiRecommendation,
      source,
      evidenceLabel: 'UNVERIFIED' as EvidenceLabel,
      note: 'AI-generated text suggestion. It is not executed, not measured and not evidence; task metrics are not changed.',
    });
  });

  // 6. Plugins API
  app.get('/api/plugins', (req, res) => {
    res.json(dbStore.getPlugins());
  });

  app.post('/api/plugins/toggle', (req, res) => {
    const { pluginId, enabled } = req.body;
    const plugin = dbStore.togglePlugin(pluginId, Boolean(enabled));
    if (!plugin) {
      return res.status(404).json(buildProblemDetails('plugin-not-found', 'Plugin Module Not Found', 404, `No plugin found with ID ${pluginId}`, req.originalUrl));
    }
    res.json({ success: true, plugin });
  });

  // 7. PGL Ledger Records & Verification Engine
  app.get('/api/ledger', (req, res) => {
    res.json(dbStore.getPGLRecords());
  });

  app.post('/api/ledger/verify', (req, res) => {
    const { recordId, payload, responseHash, pglSignature, capabilityId = 'cap-compute-v1', transactionId = 'tx-verify' } = req.body;

    const pglRecords = dbStore.getPGLRecords();
    const existingRec = pglRecords.find((r) => r.id === recordId || r.transactionId === transactionId || r.pglSignature === pglSignature);

    const txToUse = existingRec?.transactionId || transactionId;
    const capToUse = existingRec?.capabilityId || capabilityId;
    const respHashToUse = existingRec?.responseHash || responseHash || hashPayload('DEFAULT_RESPONSE');
    const sigToUse = existingRec?.pglSignature || pglSignature;

    if (!sigToUse) {
      return res.status(400).json(
        buildProblemDetails('missing-signature', 'Missing PGL Signature', 400, 'pglSignature or valid recordId required for verification', req.originalUrl)
      );
    }

    // Stored record without the original payload: re-check the signature over the stored hashes.
    if (existingRec && payload === undefined) {
      const signatureMatch = existingRec.signatureScheme === 'local-hmac-pgl-proof-v1' || !existingRec.signatureScheme
        ? verifyPGLRecordSignature(existingRec)
        : existingRec.verifiable;
      return res.json({
        success: signatureMatch,
        recordId: existingRec.id,
        transactionId: txToUse,
        verificationResult: {
          valid: signatureMatch,
          tamperDetected: !signatureMatch,
          signatureMatch,
          payloadChecked: false,
          verificationTimestamp: new Date().toISOString(),
          scope: LOCAL_SIGNATURE_SCOPE,
          signingKey: signingKeyInfo(),
        },
      });
    }

    const verificationResult = verifyPGLProof(txToUse, capToUse, payload ?? { verify: true }, respHashToUse, sigToUse);

    res.json({
      success: verificationResult.valid,
      recordId: existingRec?.id || 'adhoc-proof-check',
      transactionId: txToUse,
      verificationResult: { ...verificationResult, payloadChecked: true, signingKey: signingKeyInfo() },
    });
  });

  // 8. Model Context Protocol (MCP) JSON-RPC Substrate Proxy
  app.post('/api/mcp', (req, res) => {
    const { jsonrpc, method, params, id } = req.body;

    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request: Must be JSON-RPC 2.0' },
        id: id || null,
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        result: { tools: MCP_TOOLS_CATALOG },
        id,
      });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const foundTool = MCP_TOOLS_CATALOG.find((t) => t.name === toolName);

      if (!foundTool) {
        return res.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method or tool '${toolName}' not found.` },
          id,
        });
      }

      // Not implemented: nothing is executed, checked or persisted.
      return res.json({
        jsonrpc: '2.0',
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'not_implemented',
                  tool: toolName,
                  capabilityBinding: foundTool.capabilityBinding,
                  args: toolArgs,
                  executed: false,
                  authorizationChecked: false,
                  persisted: false,
                  evidenceLabel: 'UNVERIFIED',
                  note: 'MCP tools/call is not implemented. Nothing ran and nothing was recorded. Use the HTTP endpoints (e.g. POST /api/substrate/sandbox/execute).',
                },
                null,
                2
              ),
            },
          ],
        },
        id,
      });
    }

    return res.json({
      jsonrpc: '2.0',
      error: { code: -32601, message: `Method '${method}' not recognized in MCP Substrate Bridge.` },
      id,
    });
  });

  // ==========================================
  // 9. Federation Provider Interface (FPI) API
  // ==========================================

  // 9.1 Provider Directory & Registration
  app.get('/api/fpi/providers', (req, res) => {
    res.json(dbStore.getFPIProviders());
  });

  app.post('/api/fpi/providers/register', (req, res) => {
    const {
      providerName,
      providerType = 'hyperscaler',
      endpointUrl,
      authKey,
      regions = ['unspecified'],
      supportedCapabilities = ['cap-compute-v1'],
      isSovereignEnclave = false,
      maxLatencyMs,
      slaUptimePct,
      pricePerComputeUnitVEK = 0.001,
      spotDiscountPct = 20,
      maxCapacityUnits = 2000,
    } = req.body;

    if (!providerName || !endpointUrl) {
      return res.status(400).json(
        buildProblemDetails('invalid-provider-registration', 'Missing Registration Fields', 400, 'providerName and endpointUrl are required', req.originalUrl)
      );
    }

    const providerId = 'fpi-prov-' + crypto.randomBytes(4).toString('hex');
    const declared = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    const newProvider: FPIProvider = {
      id: providerId,
      providerName,
      providerType,
      endpointUrl,
      authKeyHash: typeof authKey === 'string' && authKey ? '0x' + crypto.createHash('sha256').update(authKey).digest('hex') : null,
      regions,
      // The endpoint is never contacted and no heartbeat is ever received.
      status: 'unverified',
      slaUptimePct: declared(slaUptimePct),
      maxLatencyMs: declared(maxLatencyMs),
      isSovereignEnclave: Boolean(isSovereignEnclave),
      supportedCapabilities,
      pricing: {
        pricePerComputeUnitVEK: Number(pricePerComputeUnitVEK),
        spotDiscountPct: Number(spotDiscountPct),
        currency: 'VEK',
      },
      quota: {
        totalAllocatedUnits: 0,
        usedUnits: 0,
        maxCapacityUnits: Number(maxCapacityUnits),
      },
      registeredAt: new Date().toISOString(),
      lastHeartbeatAt: null,
      evidenceLabel: 'UNVERIFIED',
    };

    dbStore.addFPIProvider(newProvider);

    res.status(201).json({
      success: true,
      message: 'Provider record added to the local registry. The endpoint was not contacted; status stays unverified (no heartbeat mechanism exists). SLA/latency are as declared.',
      provider: newProvider,
    });
  });

  app.post('/api/fpi/providers/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, latencyMs } = req.body;

    const provider = dbStore.updateFPIProviderStatus(id, status, latencyMs);
    if (!provider) {
      return res.status(404).json(
        buildProblemDetails('provider-not-found', 'Federation Provider Not Found', 404, `No provider matching ID ${id}`, req.originalUrl)
      );
    }

    res.json({ success: true, provider });
  });

  // 9.2 Service Discovery Matchmaker
  app.post('/api/fpi/discovery', (req, res) => {
    const query: FPIDiscoveryQuery = req.body || {};
    const {
      capabilityId,
      region,
      maxLatencyMs,
      isSovereignRequired,
      maxPricePerUnitVEK,
      minUptimePct,
    } = query;

    const fpiProviders = dbStore.getFPIProviders();

    const unusable = new Set(['offline', 'suspended', 'maintenance']);
    const matches = fpiProviders.filter((p) => {
      if (unusable.has(p.status)) return false;
      if (capabilityId && !p.supportedCapabilities.includes(capabilityId)) return false;
      if (region && !p.regions.includes(region) && !p.regions.includes('global-mesh-p2p')) return false;
      // Unknown (null) declared values cannot satisfy a constraint.
      if (maxLatencyMs && (p.maxLatencyMs === null || p.maxLatencyMs > maxLatencyMs)) return false;
      if (isSovereignRequired && !p.isSovereignEnclave) return false;
      if (maxPricePerUnitVEK && p.pricing.pricePerComputeUnitVEK > maxPricePerUnitVEK) return false;
      if (minUptimePct && (p.slaUptimePct === null || p.slaUptimePct < minUptimePct)) return false;
      return true;
    });

    // Cheapest declared price first; declared latency breaks ties (unknown last).
    matches.sort(
      (a, b) =>
        a.pricing.pricePerComputeUnitVEK - b.pricing.pricePerComputeUnitVEK ||
        (a.maxLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.maxLatencyMs ?? Number.MAX_SAFE_INTEGER)
    );

    res.json({
      query,
      matchCount: matches.length,
      matchedProviders: matches,
      note: 'Registry match only. No provider was contacted; every match is unverified (DEMO seeds or registrant-declared values).',
    });
  });

  // 9.3 Resource Allocation & Leasing
  app.get('/api/fpi/resources', (req, res) => {
    res.json(dbStore.getFPIAllocations());
  });

  app.post('/api/fpi/resources/allocate', (req, res) => {
    const {
      providerId,
      granteeSubject = 'agent:herdr-autonomous-core',
      computeUnits = 50,
      memoryGb = 64,
      gpuCores = 0,
      allocationType = 'reserved',
      leaseDurationMinutes = 60,
    } = req.body;

    const fpiProviders = dbStore.getFPIProviders();
    const provider = fpiProviders.find((p) => p.id === providerId);
    if (!provider) {
      return res.status(404).json(
        buildProblemDetails('provider-not-found', 'Target Federation Provider Not Found', 404, `Provider ${providerId} not found`, req.originalUrl)
      );
    }

    if (provider.quota.totalAllocatedUnits + Number(computeUnits) > provider.quota.maxCapacityUnits) {
      return res.status(422).json(
        buildProblemDetails('quota-exceeded', 'Provider Capacity Quota Exceeded', 422, `Requested ${computeUnits} units exceeds remaining capacity (${provider.quota.maxCapacityUnits - provider.quota.totalAllocatedUnits} available)`, req.originalUrl)
      );
    }

    let unitRate = provider.pricing.pricePerComputeUnitVEK;
    if (allocationType === 'spot') {
      unitRate = unitRate * (1 - provider.pricing.spotDiscountPct / 100);
    }
    const durationHours = Number(leaseDurationMinutes) / 60;
    const totalCost = +(unitRate * Number(computeUnits) * durationHours).toFixed(4);

    const allocId = 'fpi-alloc-' + crypto.randomBytes(3).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + Number(leaseDurationMinutes) * 60000).toISOString();

    const allocation: FPIResourceAllocation = {
      id: allocId,
      providerId: provider.id,
      providerName: provider.providerName,
      granteeSubject,
      computeUnits: Number(computeUnits),
      memoryGb: Number(memoryGb),
      gpuCores: Number(gpuCores),
      allocationType,
      status: 'active',
      leaseDurationMinutes: Number(leaseDurationMinutes),
      createdAt,
      expiresAt,
      x402TotalLeaseCostVEK: totalCost,
      evidenceLabel: 'UNVERIFIED',
    };

    provider.quota.totalAllocatedUnits += Number(computeUnits);
    dbStore.addFPIAllocation(allocation);

    res.status(201).json({
      success: true,
      message: 'Local lease record created. No provider was contacted and no resources were reserved; the cost is a quote from declared pricing and nothing is charged.',
      allocation,
    });
  });

  app.post('/api/fpi/resources/deallocate', (req, res) => {
    const { allocationId } = req.body;
    const alloc = dbStore.releaseFPIAllocation(allocationId);
    if (!alloc) {
      return res.status(404).json(
        buildProblemDetails('allocation-not-found', 'Resource Lease Not Found', 404, `No allocation matching ID ${allocationId}`, req.originalUrl)
      );
    }

    res.json({ success: true, message: 'Resource lease released.', allocation: alloc });
  });

  // 9.4 Federated Execution & Verification
  app.get('/api/fpi/jobs', (req, res) => {
    res.json(dbStore.getFPIJobs());
  });

  /**
   * Federated execution is NOT implemented: no HTTP dispatch to any provider
   * happens. This records a DEMO job that says so.
   */
  app.post('/api/fpi/execute', (req, res) => {
    const t0 = process.hrtime.bigint();
    const {
      providerId = 'fpi-provider-demo-a',
      capabilityId = 'cap-compute-v1',
      cappoGrantId = 'cappo-grant-alpha-001',
      payload = {},
      forceFallback = false,
    } = req.body;

    const fpiProviders = dbStore.getFPIProviders();
    const unusable = new Set(['offline', 'suspended', 'maintenance']);
    let targetProvider = fpiProviders.find((p) => p.id === providerId);
    let isFallbackRerouted = false;

    if (!targetProvider || unusable.has(targetProvider.status) || forceFallback) {
      const fallback = fpiProviders.find(
        (p) => !unusable.has(p.status) && p.id !== providerId && p.supportedCapabilities.includes(capabilityId)
      );
      if (fallback) {
        targetProvider = fallback;
        isFallbackRerouted = true;
      } else {
        return res.status(503).json(
          buildProblemDetails('fpi-unavailable', 'No Registry Entry Available', 503, 'Requested provider is unusable and no fallback registry entry matches.', req.originalUrl)
        );
      }
    }

    const jobId = 'fpi-job-' + crypto.randomBytes(3).toString('hex');
    const submittedAt = new Date().toISOString();
    const respSummary = `NOT dispatched: federated execution is not implemented. Nothing was sent to ${targetProvider.providerName}.`;

    const job: FPIExecutionJob = {
      id: jobId,
      providerId: targetProvider.id,
      providerName: targetProvider.providerName,
      capabilityId,
      cappoGrantId,
      status: 'not_dispatched',
      executionTimeMs: null,
      x402GasSettled: null,
      pglProofSignature: null,
      submittedAt,
      completedAt: null,
      outputSummary: respSummary,
      logs: [
        `[FPI] Request recorded for capability ${capabilityId}; local grant ${cappoGrantId} was not checked.`,
        isFallbackRerouted ? `[FPI] Registry fallback selected: ${targetProvider.providerName}.` : `[FPI] Registry entry selected: ${targetProvider.providerName}.`,
        `[FPI] No HTTP dispatch implemented: the workload was NOT sent to ${targetProvider.endpointUrl}.`,
        '[FPI] No settlement.',
      ],
      dispatched: false,
      evidenceLabel: 'DEMO',
    };

    dbStore.addFPIJob(job);
    Object.entries(buildx402Headers(targetProvider.id, jobId)).forEach(([k, v]) => res.setHeader(k, v));

    res.json({
      success: false,
      dispatched: false,
      status: 'not_dispatched',
      evidenceLabel: 'DEMO' as EvidenceLabel,
      requestPayloadHash: hashPayload(payload),
      handlerMs: elapsedMs(t0),
      job,
      pglRecord: null,
    });
  });

  // 9.5 Billing & x402 Settlements
  app.get('/api/fpi/billing', (req, res) => {
    res.json(dbStore.getFPISettlements());
  });

  app.post('/api/fpi/billing/settle', (req, res) => {
    res.status(501).json({
      ...buildProblemDetails('settlement-not-implemented', 'Settlement Not Implemented', 501, 'No settlement mechanism exists. Nothing was paid, settled or hashed.', req.originalUrl),
      success: false,
      settlement: null,
      payoutStatus: 'not_implemented',
    });
  });

  // 9.6 FPI OpenAPI 3.0 Specification
  app.get('/api/fpi/openapi', (req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'COMPUTLESS Federation Provider Interface (FPI) - prototype',
        version: '0.1.0-prototype',
        description:
          'Prototype interface for a local provider registry. Providers are never contacted, federated execution is not dispatched, and settlement is not implemented.',
        contact: { name: 'COMPUTLESS prototype (no verified public domain or working group)' },
      },
      paths: {
        '/api/fpi/providers': {
          get: { summary: 'List all registered Federation Providers', responses: { '200': { description: 'Success' } } },
        },
        '/api/fpi/providers/register': {
          post: {
            summary: 'Register a new Federation Provider',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['providerName', 'endpointUrl'],
                    properties: {
                      providerName: { type: 'string' },
                      providerType: { type: 'string', enum: ['hyperscaler', 'sovereign_enclave', 'decentralized_mesh', 'edge_telecom'] },
                      endpointUrl: { type: 'string' },
                      regions: { type: 'array', items: { type: 'string' } },
                      supportedCapabilities: { type: 'array', items: { type: 'string' } },
                      isSovereignEnclave: { type: 'boolean' },
                      pricePerComputeUnitVEK: { type: 'number' },
                    },
                  },
                },
              },
            },
            responses: { '201': { description: 'Registered' } },
          },
        },
        '/api/fpi/discovery': {
          post: {
            summary: 'Match registry entries (no provider is contacted)',
            responses: { '200': { description: 'Matched Providers' } },
          },
        },
        '/api/fpi/resources/allocate': {
          post: {
            summary: 'Create a local lease record (no resources are reserved)',
            responses: { '201': { description: 'Local lease record created' } },
          },
        },
        '/api/fpi/execute': {
          post: {
            summary: 'Record a federated execution request (NOT dispatched; not implemented)',
            responses: { '200': { description: 'Request recorded as not_dispatched' } },
          },
        },
        '/api/fpi/billing': {
          get: { summary: 'List local billing records (no settlement implemented)', responses: { '200': { description: 'Success' } } },
        },
        '/api/ledger/verify': {
          post: {
            summary: "Verify a local HMAC-SHA256 record signature (this process's secret; not canonical PGL)",
            responses: { '200': { description: 'Verification results' } },
          },
        },
      },
    });
  });

  // =========================================================================
  // 10. Veklom Amplification Ladder & Topological Machine Substrate API
  //     Mathematical Invariants:
  //     A = f(G, R, B, S, E, I, N)
  //     R = f(I, P, A, E) -> R_{n+1} = R_n + Delta E
  // =========================================================================

  // 10.1 Live Amplification Metrics
  app.get('/api/substrate/amplification', (req, res) => {
    res.json(dbStore.getAmplificationMetrics());
  });

  // 10.2 Authorization Receipts (Rung 2: Cryptographic, Non-Replayable)
  app.get('/api/substrate/receipts', (req, res) => {
    res.json(dbStore.getAuthorizationReceipts());
  });

  app.post('/api/substrate/receipts/issue', (req, res) => {
    const {
      cappoGrantId = 'cappo-grant-alpha-001',
      subject = 'agent:veklom-root-001',
      targetCapability = 'cap-compute-v1',
      policyId = 'policy-strict-invariant-001',
      expiresInMs = 300000,
    } = req.body;

    const receipt = createAuthorizationReceipt(cappoGrantId, subject, targetCapability, policyId, expiresInMs);
    dbStore.addAuthorizationReceipt(receipt);

    res.status(201).json({
      success: true,
      message: "Local HMAC receipt issued (signed with this process's secret). Not CAPPO authority; single use is not enforced.",
      receipt,
    });
  });

  app.post('/api/substrate/receipts/verify', (req, res) => {
    const receipt: AuthorizationReceipt = req.body;
    if (!receipt || !receipt.receiptId || !receipt.signature) {
      return res.status(400).json(
        buildProblemDetails('invalid-receipt', 'Invalid Authorization Receipt', 400, 'Valid receipt object with receiptId and signature required', req.originalUrl)
      );
    }

    const verification = verifyAuthorizationReceipt(receipt);
    res.json({
      success: verification.valid,
      receiptId: receipt.receiptId,
      verification,
    });
  });

  // 10.3 Blocked Intents (Rung 3: Anomaly detection & 403 Fail-Closed Terminal Invariants)
  app.get('/api/substrate/blocked', (req, res) => {
    res.json(dbStore.getBlockedIntents());
  });

  app.post('/api/substrate/blocked/simulate', (req, res) => {
    const {
      subject = 'agent:untrusted-rogue-actor',
      attemptedCapability = 'cap-rf-telecom',
      reason = 'INSUFFICIENT_SCOPE',
      threatLevel = 'HIGH',
    } = req.body;

    const blockId = 'blk-int-' + crypto.randomBytes(3).toString('hex');
    const timestamp = new Date().toISOString();

    const blockedRecord: BlockedIntentRecord = {
      id: blockId,
      timestamp,
      subject,
      attemptedCapability,
      reason,
      httpStatus: 403,
      problemDetails: {
        type: 'urn:computless:problem:cappo-403-forbidden',
        title: 'Simulated Refusal (Invariant 1)',
        status: 403,
        detail: `Simulated: actor ${subject} on ${attemptedCapability}, reason ${reason}. No real request was evaluated or blocked.`,
        instance: req.originalUrl,
      },
      threatLevel,
      quarantineApplied: false,
      evidenceLabel: 'DEMO',
    };

    dbStore.addBlockedIntent(blockedRecord);

    res.status(403).json({
      success: false,
      blocked: true,
      simulated: true,
      message: 'Simulated 403 refusal record (DEMO). No request was actually blocked and no quarantine exists.',
      record: blockedRecord,
    });
  });

  // 10.4 Agent Identities (Rung 6: Durable Agent Identity Directory)
  app.get('/api/substrate/agents/identities', (req, res) => {
    res.json(dbStore.getAgentIdentities());
  });

  app.post('/api/substrate/agents/identities', (req, res) => {
    const {
      id,
      name,
      trustTier = 'T2_AUTONOMOUS',
      allowedCapabilities = ['cap-compute-v1'],
      sandboxRuntimePreference = 'node_vm',
    } = req.body;

    if (!name) {
      return res.status(400).json(
        buildProblemDetails('invalid-agent-identity', 'Missing Agent Identity Name', 400, 'name is required', req.originalUrl)
      );
    }

    const agentId = id || 'agent:id-' + crypto.randomBytes(3).toString('hex');
    // An identifier digest, NOT a public key: no key pair exists.
    const publicKey = 'id-digest:' + crypto.createHash('sha256').update(agentId + name + Date.now()).digest('hex');

    const newIdentity: AgentIdentity = {
      id: agentId,
      name,
      publicKey,
      keyType: 'id-digest (not a key)',
      trustTier,
      allowedCapabilities,
      totalActionsGoverned: 0,
      totalReceiptsIssued: 0,
      evidenceChainLength: 0,
      recursionDepth: 0,
      lastActiveAt: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
      sandboxRuntimePreference,
      evidenceLabel: 'UNVERIFIED',
    };

    dbStore.addAgentIdentity(newIdentity);

    res.status(201).json({
      success: true,
      message: 'Identity record added to the local store. The trust tier is declared, not verified; publicKey is an ID digest, not a key.',
      identity: newIdentity,
    });
  });

  // 10.5 Child-process sandbox execution. Authority: governance.authorization (CAPPO) in
  //      governed mode; none in local-demo. Local grants are not consulted.
  app.post('/api/substrate/sandbox/execute', governedExecution('computless.sandbox.execute'), async (req, res) => {
    const request: SandboxExecutionRequest = req.body;
    const {
      agentId = 'agent:veklom-root-001',
      capabilityId = 'cap-compute-v1',
      code = 'output.result = "Executed in child-process sandbox: " + (input.val * 2); console.log("Processing payload value: " + input.val);',
      inputPayload = { val: 42, task: 'compute-matrix' },
      timeoutMs = 3000,
      sandboxType = 'node_vm',
      cappoGrantId,
    } = request;
    const governance = governanceOf(res);

    const execId = 'exec-sbx-' + crypto.randomBytes(4).toString('hex');
    const timestamp = new Date().toISOString();

    // Every sandboxType runs in the same child-process sandbox.
    const vmResult = await executeInIsolatedVMSandbox(code, inputPayload, timeoutMs);

    dbStore.updateAgentIdentityEvidence(agentId, 1);
    dbStore.recordSafeRoute();

    const reqPayloadHash = hashPayload({ code, inputPayload, agentId });
    const respHash = hashPayload(vmResult.outputData);
    const pglProofSignature = signPGLProof(execId, capabilityId, reqPayloadHash, respHash);

    const pglRecord: PGLRecord = {
      id: 'pgl-sbx-' + Date.now().toString().slice(-6),
      timestamp,
      transactionId: execId,
      capabilityId,
      cappoGrantId: governance.authorization?.authorizationId ?? cappoGrantId ?? 'none',
      executedNodeId: `sandbox:${SANDBOX_BOUNDARY.kind}`,
      requestPayloadHash: reqPayloadHash,
      responseHash: respHash,
      pglSignature: pglProofSignature,
      x402GasSettled: null,
      verifiable: false,
      evidenceLabel: governance.mode === 'governed' ? 'UNVERIFIED' : 'DEMO',
      canonical: false,
      signatureScheme: 'local-hmac-pgl-proof-v1',
    };
    pglRecord.verifiable = verifyPGLRecordSignature(pglRecord);
    dbStore.addPGLRecord(pglRecord);

    const executionResult: SandboxExecutionResult & Record<string, unknown> = {
      executionId: execId,
      agentId,
      capabilityId,
      sandboxType,
      actualSandbox: SANDBOX_BOUNDARY.kind,
      status: vmResult.status,
      success: vmResult.status === 'SUCCESS',
      stdout: vmResult.stdout,
      outputData: vmResult.outputData,
      memoryUsageBytes: vmResult.memoryUsageBytes,
      rssBytes: vmResult.rssBytes,
      executionDurationMs: vmResult.durationMs,
      receipt: null,
      authorization: governance.authorization,
      mode: governance.mode,
      ...(governance.mode !== 'governed' ? { authorizationNote: NOT_AUTHORIZED_DEMO_NOTE } : {}),
      pglProofSignature,
      requestPayloadHash: reqPayloadHash,
      responseHash: respHash,
      x402GasSettled: null,
      timestamp,
      evidenceLabel: governance.mode === 'governed' ? 'UNVERIFIED' : 'DEMO',
      canonical: false,
      sandbox: SANDBOX_BOUNDARY,
      notes: [
        `All sandboxType values (requested: ${sandboxType}) run in the same child-process sandbox.`,
        'pglProofSignature is a local HMAC, not canonical PGL. Governed-mode evidence is recorded by Gnomledger (governance.evidence).',
      ],
    };

    Object.entries(buildx402Headers(`sandbox:${SANDBOX_BOUNDARY.kind}`, execId)).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('X-Substrate-PGL', pglProofSignature);

    res.json(executionResult);
  });

  // 10.6 Recursion step: asks the configured model for a one-sentence summary.
  //      The text is an UNVERIFIED AI suggestion; it is never sealed as evidence.
  app.post('/api/substrate/recursion/step', async (req, res) => {
    const { agentId = 'agent:herdr-autonomous-core', intentPrompt = 'Suggest improvements to routing' } = req.body;

    const agentIdentities = dbStore.getAgentIdentities();
    const identity = agentIdentities.find((i) => i.id === agentId) || agentIdentities[0];
    if (!identity) {
      return res.status(404).json(buildProblemDetails('agent-identity-not-found', 'Agent Identity Not Found', 404, `No identity matching ${agentId}`, req.originalUrl));
    }

    // No evidence is produced by a model call, so Delta E is 0.
    const deltaE = 0;
    identity.recursionDepth += 1;
    identity.lastActiveAt = new Date().toISOString();
    dbStore.persist();

    let recommendation = 'No model configured (GEMINI_API_KEY is not set); no summary was generated.';
    let source: 'gemini' | 'no-model' = 'no-model';

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `You are assisting with a prototype agent loop.
Identity: ${identity.name} (${identity.id})
Step: ${identity.recursionDepth}
Intent: ${intentPrompt}
Give a 1-sentence suggestion for the next step. Do not claim measurements or numbers you were not given.`,
        });
        if (response.text) {
          recommendation = response.text.trim();
          source = 'gemini';
        } else {
          recommendation = 'Model returned no text; no summary was generated.';
        }
      } catch (e: any) {
        recommendation = `Model call failed; no summary was generated (${String(e?.message ?? e).slice(0, 200)}).`;
        console.warn('Gemini recursion call failed:', e?.message ?? e);
      }
    }

    res.json({
      success: source === 'gemini',
      formula: 'R_{n+1} = R_n + Delta E',
      agentIdentity: identity,
      deltaE,
      receipt: null,
      pglRecord: null,
      recommendation,
      source,
      evidenceLabel: 'UNVERIFIED' as EvidenceLabel,
      note: 'AI-generated text (or a no-model notice). Not executed, not measured, not evidence: nothing was recorded to any ledger.',
      amplificationMetrics: dbStore.getAmplificationMetrics(),
    });
  });

  // =========================================================================
  // 11. COMPUTLESS CLOUD: 8-Layer Substrate Pipeline Engine & Specifications
  //     Layer 1: Capability   (What is being requested?)
  //     Layer 2: Authority    (Who is allowed to request it?)
  //     Layer 3: Federation   (Which providers can execute it?)
  //     Layer 4: Routing      (Which provider should execute it now?)
  //     Layer 5: Execution    (Where does the action actually run?)
  //     Layer 6: Evidence     (What evidence was recorded?)
  //     Layer 7: Measurement  (What was measured?)
  //     Layer 8: Settlement   (not implemented)
  // =========================================================================

  // 11.1 Architecture spec (TARGETs, with what the code does today)
  app.get('/api/substrate/spec', (req, res) => {
    res.json({
      spec: SUBSTRATE_8_LAYER_SPEC,
      evidenceLabel: 'TARGET',
      amplificationMetrics: dbStore.getAmplificationMetrics(),
      totalCapabilities: CAPABILITY_CATALOG.length,
      totalNodes: dbStore.getSubstrateNodes().length,
      totalFPIProviders: dbStore.getFPIProviders().length,
    });
  });

  // 11.2 Execute the 8-layer pipeline (prototype). Authority = CAPPO decision from
  //      governedExecution; code always runs in the local child-process sandbox;
  //      settlement is not implemented.
  app.post('/api/substrate/pipeline/execute', governedExecution('computless.pipeline.execute'), async (req, res) => {
    const pipelineT0 = process.hrtime.bigint();
    const pipelineId = 'pipe-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex');
    const {
      capabilityId = 'cap-compute-v1',
      subject = 'agent:veklom-root-001',
      payload = { action: 'matrix_multiply', matrixSize: 64, iterations: 100 },
      routingPolicy = { requireSovereignty: false, maxLatencyMs: 100, priority: 'speed' },
      runtimeTarget = 'node_vm',
      codeSnippet,
      simulateFault = 'NONE',
    }: Substrate8LayerPipelineRequest = req.body;
    const governance = governanceOf(res);
    const pipelineLabel: EvidenceLabel = governance.mode === 'governed' ? 'UNVERIFIED' : 'DEMO';

    const skipped = (num: 3 | 4 | 5 | 6 | 7 | 8, name: string, q: string, why: string) => ({
      layerNumber: num,
      layerName: name,
      question: q,
      status: 'SKIPPED' as const,
      durationMs: 0,
      data: null,
      summary: why,
    });
    const layer8NotImplemented = {
      layerNumber: 8 as const,
      layerName: 'Settlement Layer',
      question: 'What would settlement require?',
      status: 'NOT_IMPLEMENTED' as const,
      durationMs: 0,
      data: {
        implemented: false as const,
        currency: 'VEK' as const,
        x402GasSettled: null,
        providerPayoutEarned: null,
        protocolFee: null,
        payoutTxHash: null,
        payoutStatus: 'not_implemented' as const,
        settlementFinality: 'NONE' as const,
      },
      summary: 'Not implemented: no payment, payout, transaction hash or finality exists.',
    };

    // LAYER 1: CAPABILITY
    const l1 = process.hrtime.bigint();
    const capability = CAPABILITY_CATALOG.find((c) => c.id === capabilityId) || {
      id: capabilityId,
      name: 'Unregistered capability (placeholder)',
      description: 'Not in the catalog; placeholder definition.',
      category: 'compute' as const,
      requiredRole: 'operator:compute',
      schemaJson: JSON.stringify({ dynamic: true }),
      evidenceLabel: 'UNVERIFIED' as EvidenceLabel,
    };
    const payloadIsObject = typeof payload === 'object' && payload !== null;
    const layer1Result = {
      layerNumber: 1 as const,
      layerName: 'Capability Layer',
      question: 'What is being requested?',
      status: payloadIsObject ? ('SUCCESS' as const) : ('ERROR' as const),
      durationMs: elapsedMs(l1),
      data: { capability, schemaValidated: false, payloadIsObject, inputParams: payload },
      summary: `Looked up capability '${capability.name}' [${capability.id}]. Payload is ${payloadIsObject ? '' : 'NOT '}an object; no JSON-schema validation is performed.`,
    };

    // LAYER 2: AUTHORITY (from governedExecution; local grants are not consulted)
    const l2 = process.hrtime.bigint();
    const simulatedDeny = simulateFault === 'INVALID_CAPPO' || simulateFault === 'EXPIRED_GRANT';
    if (simulatedDeny) {
      const blockedReason = simulateFault === 'INVALID_CAPPO' ? 'INSUFFICIENT_SCOPE' : 'EXPIRED_CAPPO';
      const problem = buildProblemDetails(
        'cappo-403-forbidden',
        'Simulated Authority Refusal (Invariant 1)',
        403,
        `Simulated fault '${simulateFault}' for subject '${subject}' on '${capabilityId}'. This is a DEMO refusal; CAPPO did not deny this request.`,
        `/api/substrate/pipeline/execute#${pipelineId}`
      );
      dbStore.addBlockedIntent({
        id: 'blk-' + Date.now().toString().slice(-6),
        timestamp: new Date().toISOString(),
        subject,
        attemptedCapability: capabilityId,
        reason: blockedReason,
        httpStatus: 403,
        problemDetails: problem,
        threatLevel: 'HIGH',
        quarantineApplied: false,
        evidenceLabel: 'DEMO',
      });
      const why = 'Skipped: Layer 2 (simulated) 403 terminal refusal.';
      const failedResult: Substrate8LayerPipelineResult = {
        pipelineId,
        timestamp: new Date().toISOString(),
        overallStatus: 'BLOCKED_403',
        httpStatus: 403,
        totalDurationMs: elapsedMs(pipelineT0),
        requestedCapabilityId: capabilityId,
        executingSubject: subject,
        receiptId: null,
        settlementTxHash: null,
        x402GasSettled: null,
        evidenceLabel: 'DEMO',
        layers: {
          layer1_capability: layer1Result,
          layer2_authority: {
            layerNumber: 2,
            layerName: 'Authority Layer',
            question: 'Who is allowed to request it?',
            status: 'BLOCKED_403',
            durationMs: elapsedMs(l2),
            data: {
              mode: governance.mode,
              authorization: governance.authorization,
              authorized: false,
              cappoGrantId: null,
              cappoValid: false,
              rolePermitted: false,
              blockedReason,
              simulated: true,
            },
            summary: `SIMULATED 403: '${simulateFault}' (DEMO). Nothing ran.`,
          },
          layer3_federation: skipped(3, 'Federation Layer', 'Which providers can execute it?', why),
          layer4_routing: skipped(4, 'Routing Layer', 'Which provider should execute it now?', why),
          layer5_execution: skipped(5, 'Execution Layer', 'Where does the action actually run?', why),
          layer6_evidence: skipped(6, 'Evidence Layer', 'What evidence was recorded?', why),
          layer7_measurement: skipped(7, 'Measurement Layer', 'What was measured?', why),
          layer8_settlement: layer8NotImplemented,
        },
      };
      return res.status(403).json(failedResult);
    }

    const authorized = governance.mode === 'governed' && governance.authorization?.decision === 'APPROVED';
    const layer2Result = {
      layerNumber: 2 as const,
      layerName: 'Authority Layer',
      question: 'Who is allowed to request it?',
      status: authorized ? ('SUCCESS' as const) : ('SKIPPED' as const),
      durationMs: elapsedMs(l2),
      data: {
        mode: governance.mode,
        authorization: governance.authorization,
        authorized,
        cappoGrantId: null,
        cappoValid: authorized,
        receipt: null,
        rolePermitted: authorized,
      },
      summary: authorized
        ? `CAPPO APPROVED before execution (authorization ${governance.authorization?.authorizationId ?? 'id not returned'}; CAPPO decisions are unsigned).`
        : NOT_AUTHORIZED_DEMO_NOTE,
    };

    // LAYER 3: FEDERATION (registry only)
    const l3 = process.hrtime.bigint();
    const unusable = new Set(['offline', 'suspended', 'maintenance']);
    const eligibleProviders = dbStore
      .getFPIProviders()
      .filter((p) => !unusable.has(p.status) && p.supportedCapabilities.includes(capabilityId))
      .map((p) => ({
        id: p.id,
        name: p.providerName,
        type: p.providerType,
        status: p.status,
        isSovereign: p.isSovereignEnclave,
        price: p.pricing.pricePerComputeUnitVEK,
        sla: p.slaUptimePct,
      }));
    const layer3Result = {
      layerNumber: 3 as const,
      layerName: 'Federation Layer',
      question: 'Which providers can execute it?',
      status: 'SUCCESS' as const,
      durationMs: elapsedMs(l3),
      data: {
        totalEligibleProviders: eligibleProviders.length,
        eligibleProviders,
        selectedFederationCluster: 'registry-only (federation not implemented)',
      },
      summary: `${eligibleProviders.length} registry entries list '${capabilityId}'. None was contacted or probed (DEMO/unverified).`,
    };

    // LAYER 4: ROUTING (label only; execution is always local)
    const l4 = process.hrtime.bigint();
    const nodes = dbStore.getSubstrateNodes().filter((n) => n.status !== 'offline');
    const primaryNode = nodes[0] ?? null;
    let selected = primaryNode;
    let reroutedFallback = false;
    let fallbackReason: string | undefined;
    if (simulateFault === 'NODE_OUTAGE_503') {
      reroutedFallback = true;
      selected = nodes.find((n) => n.id !== primaryNode?.id) ?? null;
      fallbackReason = `Simulated 503 on '${primaryNode?.name ?? 'none'}'. ${selected ? `Fallback registry entry: '${selected.name}'.` : 'No fallback registry entry.'}`;
    }
    const scoreOf = (n: SubstrateNode | null) =>
      n && typeof n.latencyMs === 'number' ? Math.round((100 - n.latencyMs * 0.4 + (n.isSovereign ? 15 : 5)) * 10) / 10 : null;
    const executedNode = selected
      ? { id: selected.id, name: selected.name, region: selected.region }
      : { id: 'local-sandbox', name: 'local child-process sandbox (this host)', region: 'this host' };
    const hrmrScore = scoreOf(selected);
    const layer4Result = {
      layerNumber: 4 as const,
      layerName: 'Routing Layer',
      question: 'Which provider should execute it now?',
      status: reroutedFallback ? ('FALLBACK_503' as const) : ('SUCCESS' as const),
      durationMs: elapsedMs(l4),
      data: {
        primaryCandidate: primaryNode ? { id: primaryNode.id, name: primaryNode.name, latencyMs: primaryNode.latencyMs, score: scoreOf(primaryNode) } : null,
        executedNode,
        reroutedFallback,
        fallbackReason,
        hrmrScore,
        note: 'The selected entry is a registry label only. The code in Layer 5 always runs in the local child-process sandbox on this host.',
      },
      summary: reroutedFallback
        ? `SIMULATED 503 fallback: ${fallbackReason} Authority unchanged.`
        : `Selected registry entry '${executedNode.name}' (unverified; score ${hrmrScore ?? 'n/a: latency not declared'}).`,
    };

    // LAYER 5: EXECUTION (child-process sandbox)
    const l5 = process.hrtime.bigint();
    const defaultCode =
      codeSnippet ||
      `// COMPUTLESS 8-layer pipeline workload (runs in the child-process sandbox)
const payloadIn = context.inputPayload || {};
let count = 0;
for (let i = 0; i < 500; i++) {
  count += Math.sqrt(i * 1.5);
}
output.computedMetric = Math.round(count * 100) / 100;
output.inputKeys = Object.keys(payloadIn);
output.timestamp = new Date().toISOString();
console.log("Workload completed in the local sandbox");
`;
    const vmResult = await executeInIsolatedVMSandbox(
      defaultCode,
      (payloadIsObject ? payload : {}) as Record<string, unknown>,
      3000
    );
    const executionFailed = vmResult.status !== 'SUCCESS';
    const layer5Result = {
      layerNumber: 5 as const,
      layerName: 'Execution Layer',
      question: 'Where does the action actually run?',
      status: executionFailed ? ('ERROR' as const) : ('SUCCESS' as const),
      durationMs: elapsedMs(l5),
      data: {
        sandboxType: runtimeTarget,
        actualSandbox: SANDBOX_BOUNDARY.kind,
        executionStatus: vmResult.status,
        stdout: vmResult.stdout,
        outputData: vmResult.outputData,
        memoryUsedBytes: vmResult.memoryUsageBytes,
        cpuExecutionMs: null,
        workloadWallClockMs: vmResult.durationMs,
      },
      summary:
        `${executionFailed ? `FAILED (${vmResult.status})` : 'Ran'} in the local child-process sandbox (no fs, no child processes, empty env; network NOT restricted; no cgroups; no hardware isolation). ` +
        `Requested target '${runtimeTarget}' uses the same sandbox. Wall-clock ${vmResult.durationMs}ms, RSS ${(vmResult.memoryUsageBytes / 1024).toFixed(1)} KB.`,
    };

    // LAYER 6: EVIDENCE (local record; Gnomledger in governed mode, written by fabric.ts after the response)
    const l6 = process.hrtime.bigint();
    const txId = 'tx-pipe-' + crypto.randomBytes(4).toString('hex');
    const existingEvidenceList = dbStore.getActionEvidenceRecords();
    const lastParentHash = existingEvidenceList[0]?.blockHash || '0x0000000000000000000000000000000000000000000000000000000000000000';
    const nextBlockHeight = existingEvidenceList.length + 1;
    const actionEvidence = generateActionEvidence(
      {
        transactionId: txId,
        capabilityId,
        subject,
        cappoGrantId: governance.authorization?.authorizationId ?? undefined,
        requestPayload: (payloadIsObject ? payload : {}) as Record<string, unknown>,
        responsePayload: vmResult.outputData,
        executingNodeId: 'local-sandbox',
        executingNodeName: 'local child-process sandbox (this host)',
      },
      lastParentHash,
      nextBlockHeight
    );
    if (governance.mode !== 'governed') actionEvidence.evidenceLabel = 'DEMO';
    dbStore.addActionEvidenceRecord(actionEvidence);
    const ledger: 'gnomledger' | 'local-only' = governance.mode === 'governed' && fabricConfig.pglUrl ? 'gnomledger' : 'local-only';
    const layer6Result = {
      layerNumber: 6 as const,
      layerName: 'Evidence Layer',
      question: 'What evidence was recorded?',
      status: 'SUCCESS' as const,
      durationMs: elapsedMs(l6),
      data: {
        ledger,
        pglRecord: {
          id: actionEvidence.id,
          timestamp: actionEvidence.timestamp,
          transactionId: actionEvidence.transactionId,
          capabilityId: actionEvidence.capabilityId,
          cappoGrantId: actionEvidence.cappoGrantId ?? 'none',
          executedNodeId: actionEvidence.executingNodeId,
          requestPayloadHash: actionEvidence.requestPayloadHash,
          responseHash: actionEvidence.responseHash,
          pglSignature: actionEvidence.pglSignature,
          x402GasSettled: null,
          verifiable: actionEvidence.verifiable,
          evidenceLabel: actionEvidence.evidenceLabel,
          canonical: false as const,
          signatureScheme: 'local-hmac-action-evidence-v1' as const,
        },
        evidenceRecord: actionEvidence,
        requestPayloadHash: actionEvidence.requestPayloadHash,
        responseHash: actionEvidence.responseHash,
        pglSignature: actionEvidence.pglSignature,
        blockHash: actionEvidence.blockHash,
        merkleLeafHash: actionEvidence.merkleLeafHash,
        localLedgerIndex: dbStore.getActionEvidenceRecords().length,
      },
      summary:
        ledger === 'gnomledger'
          ? `Local HMAC record #${nextBlockHeight} written (not canonical). The governance layer appends an event to Gnomledger after this response; governance.evidence says whether it was recorded.`
          : `Local-only HMAC record #${nextBlockHeight} in a mutable JSON file (not canonical PGL; ${governance.mode === 'governed' ? 'PGL_LEDGER_URL not configured' : 'local-demo mode'}).`,
    };

    // LAYER 7: MEASUREMENT (measured values only)
    const l7 = process.hrtime.bigint();
    const actualWallClockMs = Math.round(elapsedMs(pipelineT0));
    const confirmationCertificate = confirmActionExecution(
      {
        transactionId: txId,
        capabilityId,
        subject,
        executingNodeId: 'local-sandbox',
        requestPayload: (payloadIsObject ? payload : {}) as Record<string, unknown>,
        responsePayload: vmResult.outputData,
        actualWallClockLatencyMs: actualWallClockMs,
        memoryUsedBytes: vmResult.memoryUsageBytes,
        executionStatus: vmResult.status,
        stdout: vmResult.stdout,
        latencyBudgetMs: routingPolicy?.maxLatencyMs,
      },
      CAPABILITY_CATALOG.find((c) => c.id === capabilityId),
      undefined,
      { sandboxRan: true }
    );
    if (governance.mode !== 'governed') confirmationCertificate.evidenceLabel = 'DEMO';
    dbStore.addConfirmationCertificate(confirmationCertificate);
    const layer7Result = {
      layerNumber: 7 as const,
      layerName: 'Measurement Layer',
      question: 'What was measured?',
      status: confirmationCertificate.overallConfirmationStatus === 'EXECUTION_FAILED' ? ('ERROR' as const) : ('SUCCESS' as const),
      durationMs: elapsedMs(l7),
      data: {
        uptimePct: null,
        actualWallClockLatencyMs: actualWallClockMs,
        memoryDeltaBytes: vmResult.memoryUsageBytes,
        throughputOps: null,
        slaCompliant: confirmationCertificate.dimensions.slaLatency.slaCompliant,
        confirmationCertificate,
      },
      summary: `${confirmationCertificate.summaryVerdict} Uptime and throughput are not measured.`,
    };

    res.setHeader('X-Settlement', 'not_implemented');
    res.setHeader('X-Substrate-PGL-Hash', actionEvidence.pglSignature);

    const httpStatus: Substrate8LayerPipelineResult['httpStatus'] = executionFailed
      ? vmResult.status === 'TERMINATED_TIMEOUT'
        ? 504
        : 422
      : 200;
    const finalPipelineResult: Substrate8LayerPipelineResult = {
      pipelineId,
      timestamp: new Date().toISOString(),
      overallStatus: executionFailed ? 'EXECUTION_FAILED' : reroutedFallback ? 'FALLBACK_503' : 'SUCCESS',
      httpStatus,
      totalDurationMs: elapsedMs(pipelineT0),
      requestedCapabilityId: capabilityId,
      executingSubject: subject,
      receiptId: null,
      pglProofSignature: actionEvidence.pglSignature,
      settlementTxHash: null,
      x402GasSettled: null,
      evidenceLabel: pipelineLabel,
      layers: {
        layer1_capability: layer1Result,
        layer2_authority: layer2Result,
        layer3_federation: layer3Result,
        layer4_routing: layer4Result,
        layer5_execution: layer5Result,
        layer6_evidence: layer6Result,
        layer7_measurement: layer7Result,
        layer8_settlement: layer8NotImplemented,
      },
    };

    res.status(httpStatus).json(finalPipelineResult);
  });

  // =========================================================================
  // 12. DEDICATED EVIDENCE & MEASUREMENT LAYER APIS
  // =========================================================================

  // 12.1 Evidence Records & Ledger
  app.get('/api/substrate/evidence/records', (req, res) => {
    res.json({
      records: dbStore.getActionEvidenceRecords(),
      merkleTree: dbStore.getEvidenceMerkleTree(),
      totalEvidenceRecords: dbStore.getActionEvidenceRecords().length,
      canonical: false,
      scope: LOCAL_SIGNATURE_SCOPE + ' Stored in a mutable local JSON file.',
      signingKey: signingKeyInfo(),
    });
  });

  // 12.2 Merkle Tree & Proof Generation
  app.get('/api/substrate/evidence/merkle', (req, res) => {
    const tree = dbStore.getEvidenceMerkleTree();
    res.json(tree);
  });

  app.get('/api/substrate/evidence/proof/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    const proof = dbStore.getEvidenceMerkleProofForIndex(isNaN(index) ? 0 : index);
    res.json(proof);
  });

  // 12.3 Action Signature Generation Engine
  app.post('/api/substrate/evidence/generate', (req, res) => {
    const {
      transactionId = 'tx-' + crypto.randomBytes(4).toString('hex'),
      capabilityId = 'cap-compute-v1',
      subject = 'agent:veklom-root-001',
      cappoGrantId = 'cappo-grant-alpha-001',
      requestPayload = { action: 'compute', payload: 'sample' },
      responsePayload = { status: 'COMPLETE', result: 42 },
      executingNodeId = 'caller-supplied',
      executingNodeName = 'caller-supplied (not observed)',
    }: ActionSignatureRequest = req.body;

    const existing = dbStore.getActionEvidenceRecords();
    const lastParentHash = existing[0]?.blockHash || '0x0000000000000000000000000000000000000000000000000000000000000000';
    const nextBlockHeight = existing.length + 1;

    const evidence = generateActionEvidence(
      {
        transactionId,
        capabilityId,
        subject,
        cappoGrantId,
        requestPayload,
        responsePayload,
        executingNodeId,
        executingNodeName,
      },
      lastParentHash,
      nextBlockHeight
    );

    dbStore.addActionEvidenceRecord(evidence);

    res.status(201).json({
      success: true,
      note: 'Signed caller-supplied payloads with the local HMAC secret. Nothing was executed or observed; this is not evidence of an action.',
      evidence,
      merkleLeaf: evidence.merkleLeafHash,
      merkleTree: dbStore.getEvidenceMerkleTree(),
    });
  });

  // 12.4 Deep Cryptographic Action Verification
  app.post('/api/substrate/evidence/verify', (req, res) => {
    const {
      evidenceId,
      transactionId,
      requestPayload,
      responsePayload,
      pglSignature,
      expectedParentHash,
    } = req.body;

    let targetEvidence: Partial<ActionEvidenceRecord> | undefined;

    if (evidenceId || transactionId) {
      targetEvidence = dbStore.getActionEvidenceRecord(evidenceId || transactionId);
    }

    if (!targetEvidence && pglSignature) {
      targetEvidence = {
        transactionId: transactionId || 'tx-adhoc',
        capabilityId: req.body.capabilityId || 'cap-compute-v1',
        subject: req.body.subject || 'agent:caller',
        executingNodeId: req.body.executingNodeId || 'caller-supplied',
        requestPayloadHash: req.body.requestPayloadHash || hashPayload(requestPayload || {}),
        responseHash: req.body.responseHash || hashPayload(responsePayload || {}),
        pglSignature,
        parentBlockHash: expectedParentHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
        nonce: req.body.nonce || '0x_nonce_default',
        timestamp: req.body.timestamp || new Date().toISOString(),
      };
    }

    if (!targetEvidence) {
      return res.status(400).json(
        buildProblemDetails('missing-evidence', 'Missing Evidence Target', 400, 'evidenceId, transactionId, or signature payload required', req.originalUrl)
      );
    }

    const report = verifyActionEvidence(targetEvidence, requestPayload, responsePayload, expectedParentHash);

    res.json({
      success: report.valid,
      tamperDetected: report.tamperDetected,
      report,
    });
  });

  // 12.5 Live Tamper Injection Sandbox
  app.post('/api/substrate/evidence/tamper', (req, res) => {
    const { evidenceId, tamperPayload, tamperSignature, tamperResponse } = req.body;

    const evidence = dbStore.getActionEvidenceRecord(evidenceId);
    if (!evidence) {
      return res.status(404).json(
        buildProblemDetails('not-found', 'Evidence Not Found', 404, `No evidence record found with ID ${evidenceId}`, req.originalUrl)
      );
    }

    const patch: any = {};
    if (tamperPayload) patch.requestPayloadHash = hashPayload(tamperPayload);
    if (tamperResponse) patch.responseHash = hashPayload(tamperResponse);
    if (tamperSignature) patch.pglSignature = '0x_tampered_sig_' + crypto.randomBytes(8).toString('hex');

    const tamperedRecord = dbStore.tamperActionEvidence(evidence.id, patch);

    // Verify right away to demonstrate fail-safe detection
    const verifyReport = verifyActionEvidence(tamperedRecord || evidence);

    res.json({
      tampered: true,
      evidenceLabel: 'DEMO',
      tamperedRecord,
      failSafeVerificationReport: verifyReport,
    });
  });

  // 12.6 Action Execution Confirmation & Measurement Engine
  app.get('/api/substrate/measurement/certificates', (req, res) => {
    res.json(dbStore.getConfirmationCertificates());
  });

  app.post('/api/substrate/measurement/confirm', (req, res) => {
    const confirmationReq: ActionConfirmationRequest = req.body;
    const capabilityDef = CAPABILITY_CATALOG.find((c) => c.id === confirmationReq.capabilityId);
    const nodeDef = dbStore.getSubstrateNodes().find((n) => n.id === confirmationReq.executingNodeId);

    // Caller-reported values: COMPUTLESS did not observe this execution.
    const certificate = confirmActionExecution(confirmationReq, capabilityDef, nodeDef, { sandboxRan: false });
    dbStore.addConfirmationCertificate(certificate);

    res.status(201).json({
      success: certificate.overallConfirmationStatus !== 'EXECUTION_FAILED',
      certificate,
    });
  });

  // 12.7 Aggregate Telemetry & SLA Metrics
  app.get('/api/substrate/measurement/metrics', (req, res) => {
    const certs = dbStore.getConfirmationCertificates();
    const pct = (num: number, den: number) => (den > 0 ? +((num / den) * 100).toFixed(1) : null);
    const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const slaEvaluated = certs.filter((c) => typeof c.dimensions.slaLatency.slaCompliant === 'boolean');
    const schemaEvaluated = certs.filter((c) => c.dimensions.schemaConformance.status !== 'NOT_EVALUATED');

    res.json({
      totalCertificatesIssued: certs.length,
      averageConfirmationScorePct: mean(certs.map((c) => c.confirmationScorePct).filter((v): v is number => typeof v === 'number')),
      locallyObservedRatePct: pct(certs.filter((c) => c.overallConfirmationStatus === 'LOCALLY_OBSERVED').length, certs.length),
      slaComplianceRatePct: pct(slaEvaluated.filter((c) => c.dimensions.slaLatency.slaCompliant).length, slaEvaluated.length),
      schemaComplianceRatePct: pct(schemaEvaluated.filter((c) => c.dimensions.schemaConformance.status === 'PASSED').length, schemaEvaluated.length),
      averageWallClockLatencyMs: mean(certs.map((c) => c.dimensions.slaLatency.actualWallClockLatencyMs)),
      systemUptimeAttestedPct: null,
      evidenceLabel: 'UNVERIFIED',
      note: 'Aggregates of local observation certificates on this server. Rates are null when nothing was evaluated; uptime is not measured.',
      latestCertificates: certs.slice(0, 5),
    });
  });

  // =========================================================================
  // 13. CANONICAL VEKLOM RUNTIME SUBSTRATE: .VKG & OFFLINE LEASE APIS
  // =========================================================================

  // 13.1 .vkg Package Directory
  app.get('/api/vkg/packages', (req, res) => {
    const packages = dbStore.getVkgPackages().map((pkg) => {
      const d = vkgDigestEvidence(pkg);
      return { ...pkg, digestValid: d.digestValid, evidenceLabel: d.evidenceLabel };
    });
    res.json({
      packages,
      totalPackages: packages.length,
      note: 'Digests recomputed now. VERIFIED_REPO = matches the built-in package shipped in this repo; package contents are demo logic.',
    });
  });

  app.post('/api/vkg/packages', (req, res) => {
    const pkg: VkgPackage = req.body;
    const validation = validateVkgPackage(pkg);
    if (!validation.valid) {
      return res.status(400).json(
        buildProblemDetails('invalid-vkg-package', 'Invalid .vkg Package', 400, validation.error || 'Digest mismatch or missing structure', req.originalUrl)
      );
    }
    const stored = { ...pkg, isImmutable: false, evidenceLabel: vkgDigestEvidence(pkg).evidenceLabel };
    dbStore.addVkgPackage(stored);
    res.status(201).json({ success: true, package: stored });
  });

  // 13.2 .vkg Digest Validation
  app.post('/api/vkg/validate', (req, res) => {
    const pkg: VkgPackage = req.body;
    const validation = validateVkgPackage(pkg);
    res.json({ ...validation, evidenceLabel: vkgDigestEvidence(pkg).evidenceLabel });
  });

  // 13.3 .vkg Governed Execution
  app.post('/api/vkg/execute', governedExecution('computless.vkg.execute'), async (req, res) => {
    const { packageId, action, inputPayload = {}, authority, capabilityId }: {
      packageId: string;
      action: string;
      inputPayload: Record<string, unknown>;
      authority?: CanonicalExecutionAuthority;
      capabilityId?: string;
    } = req.body;
    const governance = governanceOf(res);

    const pkg = dbStore.getVkgPackage(packageId);
    if (!pkg) {
      return res.status(404).json(
        buildProblemDetails('vkg-not-found', '.vkg Package Not Found', 404, `No package matching ID ${packageId}`, req.originalUrl)
      );
    }

    // Authority is governance.authorization (CAPPO). The optional scope token
    // only bounds capability/action; it is integrity-checked, not trusted.
    const scope = resolveScopeToken(authority, {
      capabilityId: capabilityId || pkg.manifest.capabilities[0] || 'cap-compute-v1',
      allowedAction: action,
    });
    if ('problem' in scope) return res.status(422).json(scope.problem(req.originalUrl));

    const digest = vkgDigestEvidence(pkg);
    const dispatcher = new RuntimeAdapterDispatcher(dbStore.getVkgPackages(), dbStore.getOfflineLeases());
    const execResult = await dispatcher.dispatch({
      authority: scope.token,
      inputPayload,
      vkgPackageId: packageId,
      vkgAction: action,
    });

    res.json({
      success: execResult.status === 'SUCCESS',
      execResult,
      digestCheck: { valid: digest.digestValid, computedDigest: digest.computedDigest, evidenceLabel: digest.evidenceLabel },
      mode: governance.mode,
      authorization: governance.authorization,
      ...(governance.mode !== 'governed' ? { authorizationNote: NOT_AUTHORIZED_DEMO_NOTE } : {}),
      scopeToken: { source: scope.token.source ?? 'caller-supplied', canonical: false, note: SCOPE_TOKEN_NOTE },
    });
  });

  // 13.3.1 Interchangeable Runtime Adapters Catalog & Dispatch
  app.get('/api/runtime/adapters', (req, res) => {
    const common = {
      isolationLevel: 'PROCESS_ISOLATION',
      boundary: SANDBOX_BOUNDARY,
      hardwareAttested: false,
      cgroupEnforced: false,
      networkRestricted: false,
    };
    res.json({
      boundary: SANDBOX_BOUNDARY,
      note: 'Every adapter runs code in the same child-process sandbox (src/server/sandbox.ts). No containers, cgroups, namespaces or hardware isolation exist.',
      adapters: [
        {
          type: 'NodeVmRuntimeAdapter',
          ...common,
          description: 'Child Node process: empty environment, no filesystem or child processes (Node permission model), V8 heap cap, wall-clock kill. Network NOT restricted.',
          evidenceLabel: 'CONFIGURED',
        },
        {
          type: 'ContainerRuntimeAdapter',
          ...common,
          description: 'No container runtime: runs in the same child-process sandbox as NodeVmRuntimeAdapter. Real container isolation is a TARGET.',
          evidenceLabel: 'TARGET',
        },
        {
          type: 'VkgRuntimeAdapter',
          ...common,
          description: 'Recomputes the .vkg SHA-256 content digest, then runs the handler in the child-process sandbox.',
          evidenceLabel: 'CONFIGURED',
        },
        {
          type: 'OfflineRuntimeAdapter',
          ...common,
          description: 'Enforces a local lease quota/action list and advances its nonce, then runs in the child-process sandbox. A lease is a local bound, not authority.',
          evidenceLabel: 'CONFIGURED',
        },
      ],
    });
  });

  app.post('/api/runtime/execute', governedExecution('computless.runtime.execute'), async (req, res) => {
    const {
      authority,
      inputPayload = {},
      code,
      timeoutMs,
      adapterType,
      vkgPackageId,
      vkgAction,
      offlineLeaseId,
    }: {
      authority?: CanonicalExecutionAuthority;
      inputPayload?: Record<string, unknown>;
      code?: string;
      timeoutMs?: number;
      adapterType?: 'NodeVmRuntimeAdapter' | 'ContainerRuntimeAdapter' | 'VkgRuntimeAdapter' | 'OfflineRuntimeAdapter';
      vkgPackageId?: string;
      vkgAction?: string;
      offlineLeaseId?: string;
    } = req.body;

    const governance = governanceOf(res);
    const scope = resolveScopeToken(authority, {
      capabilityId: String(req.body.capabilityId || 'cap-compute-v1'),
      allowedAction: vkgAction || '*',
    });
    if ('problem' in scope) return res.status(422).json(scope.problem(req.originalUrl));

    const dispatcher = new RuntimeAdapterDispatcher(dbStore.getVkgPackages(), dbStore.getOfflineLeases());
    const execResult = await dispatcher.dispatch(
      {
        authority: scope.token,
        inputPayload,
        code,
        timeoutMs,
        vkgPackageId,
        vkgAction,
        offlineLeaseId,
      },
      adapterType
    );
    if (offlineLeaseId) dbStore.persist();

    res.json({
      success: execResult.status === 'SUCCESS',
      execResult,
      mode: governance.mode,
      authorization: governance.authorization,
      ...(governance.mode !== 'governed' ? { authorizationNote: NOT_AUTHORIZED_DEMO_NOTE } : {}),
      scopeToken: { source: scope.token.source ?? 'caller-supplied', canonical: false, note: SCOPE_TOKEN_NOTE },
    });
  });

  // 13.4 Bounded Offline Leases
  app.get('/api/offline/leases', (req, res) => {
    res.json({
      leases: dbStore.getOfflineLeases(),
      totalLeases: dbStore.getOfflineLeases().length,
    });
  });

  app.post('/api/offline/leases', (req, res) => {
    const {
      workspaceId = 'ws-offline-local-01',
      mountId = 'mnt-vkg-tax-01',
      capabilityId = 'cap-compute-v1',
      allowedActions = ['calculate_vat', 'withholding_rate', 'tax_summary'],
      maxExecutions = 20,
      durationHours = 24,
    } = req.body;

    const leaseId = 'lease-off-' + crypto.randomBytes(3).toString('hex');
    const startNonce = '0x_off_nonce_' + crypto.randomBytes(2).toString('hex').replace(/^0+/, '1');
    const authorityDigest = hashPayload({ workspaceId, mountId, capabilityId, allowedActions, leaseId });

    const newLease: BoundedOfflineLease = {
      leaseId,
      workspaceId,
      mountId,
      capabilityId,
      allowedActions,
      maxExecutions: Number(maxExecutions),
      executionsRemaining: Number(maxExecutions),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + Number(durationHours) * 3600000).toISOString(),
      authorityDigest,
      startNonce,
      currentNonce: startNonce,
      isRevoked: false,
      status: 'active',
      evidenceLabel: 'UNVERIFIED',
      canonical: false,
    };

    dbStore.addOfflineLease(newLease);
    res.status(201).json({
      success: true,
      lease: newLease,
      note: 'Local lease record: a quota/action bound only. Anyone can create one, so it is not authority. authorityDigest is an unkeyed digest of the lease fields.',
    });
  });

  // 13.5 Offline Governed Execution
  app.post('/api/offline/execute', governedExecution('computless.offline.execute'), async (req, res) => {
    const { leaseId, action, inputPayload = {}, vkgPackageId } = req.body;
    const lease = dbStore.getOfflineLease(leaseId);
    if (!lease) {
      return res.status(404).json(
        buildProblemDetails('lease-not-found', 'Offline Lease Not Found', 404, `No lease matching ID ${leaseId}`, req.originalUrl)
      );
    }

    const governance = governanceOf(res);
    const dispatcher = new RuntimeAdapterDispatcher(dbStore.getVkgPackages(), dbStore.getOfflineLeases());
    // The lease only bounds quota/actions; it does not authorize itself.
    // Authority is governance.authorization (CAPPO) in governed mode, none in local-demo.
    const scopeToken = buildLocalScopeToken({
      capabilityId: lease.capabilityId,
      allowedAction: action,
      runtimeProfile: 'OFFLINE',
      workspaceId: lease.workspaceId,
      mountId: lease.mountId,
      source: 'server-built scope token from lease bounds (not authority)',
    });

    const execResult = await dispatcher.dispatch({
      authority: scopeToken,
      inputPayload,
      offlineLeaseId: leaseId,
      vkgPackageId,
      vkgAction: action,
    });
    dbStore.persist();

    // Record to persistent db store
    if (execResult.status === 'SUCCESS') {
      const observation: LocalSubstrateObservation = {
        id: 'obs-local-' + Date.now().toString().slice(-6),
        timestamp: new Date().toISOString(),
        executionId: scopeToken.executionId,
        workspaceId: lease.workspaceId,
        capabilityId: lease.capabilityId,
        action,
        runtimeProfile: 'OFFLINE',
        requestDigest: hashPayload(inputPayload),
        responseDigest: hashPayload(execResult.outputData),
        durationMs: execResult.durationMs,
        memoryBytes: execResult.memoryUsageBytes,
        exitCode: execResult.exitCode,
        nonce: lease.currentNonce,
        reconciled: false,
        evidenceLabel: governance.mode === 'governed' ? 'UNVERIFIED' : 'DEMO',
      };
      dbStore.addLocalObservation(observation);
    }

    res.json({
      success: execResult.status === 'SUCCESS',
      execResult,
      leaseRemaining: lease.executionsRemaining,
      currentNonce: lease.currentNonce,
      mode: governance.mode,
      authorization: governance.authorization,
      ...(governance.mode !== 'governed' ? { authorizationNote: NOT_AUTHORIZED_DEMO_NOTE } : {}),
      leaseRole: 'local quota/action bound only; not authority',
    });
  });

  // 13.6 Local Substrate Observations & Reconciliation
  app.get('/api/offline/observations', (req, res) => {
    res.json({
      observations: dbStore.getLocalObservations(),
      unreconciledCount: dbStore.getLocalObservations().filter((o) => !o.reconciled).length,
      pendingLocalBatchCount: dbStore.getLocalObservations().filter((o) => !o.localBatchId).length,
      note: 'No reconciliation backend exists; batches are local only.',
      reconciliations: dbStore.getReconciliations(),
    });
  });

  /**
   * Builds a LOCAL batch (Merkle root over observation digests). Nothing is
   * submitted anywhere: no reconciliation backend exists.
   */
  app.post('/api/offline/reconcile', (req, res) => {
    const pending = dbStore.getLocalObservations().filter((o) => !o.localBatchId);
    if (pending.length === 0) {
      return res.json({
        success: true,
        message: 'No observations pending a local batch.',
        reconciliation: null,
      });
    }

    const batchId = 'rcnl-batch-' + crypto.randomBytes(4).toString('hex');
    const observationDigests = pending.map((o) => o.responseDigest);
    const localMerkleTree = buildEvidenceMerkleTree(
      pending.map((o, idx) => ({
        id: o.id,
        blockHeight: idx + 1,
        timestamp: o.timestamp,
        transactionId: o.executionId,
        capabilityId: o.capabilityId,
        subject: 'local-substrate-runtime',
        executingNodeId: 'local-sandbox',
        executingNodeName: 'local child-process sandbox',
        parentBlockHash: '',
        blockHash: '',
        requestPayloadHash: o.requestDigest,
        responseHash: o.responseDigest,
        pglSignature: '',
        merkleLeafHash: o.responseDigest,
        nonce: o.nonce,
        verifiable: false,
      }))
    );

    const reconciliationPayload: ReconciliationPayload = {
      batchId,
      workspaceId: pending[0]?.workspaceId || 'ws-offline-local-01',
      submittedAt: new Date().toISOString(),
      totalObservations: pending.length,
      localObservations: pending,
      localMerkleRoot: localMerkleTree.merkleRoot,
      authorityDigest: hashPayload(observationDigests),
      status: 'LOCAL_BATCH_NOT_SUBMITTED',
      evidenceLabel: 'UNVERIFIED',
    };

    dbStore.addReconciliation(reconciliationPayload);

    res.status(201).json({
      success: true,
      message: `Local batch ${batchId} built over ${pending.length} observation(s). Not submitted anywhere: no reconciliation backend exists; observations stay unreconciled.`,
      reconciliation: reconciliationPayload,
    });
  });

  // =========================================================================
  // 14. ADVERSARIAL TEST MATRIX RUNNER (Phase 1 Rigorous Verification)
  // =========================================================================
  app.get('/api/tests/adversarial', async (req, res) => {
    const report = await runAdversarialTestSuite();
    res.json(report);
  });

  app.post('/api/tests/adversarial/run', async (req, res) => {
    const report = await runAdversarialTestSuite();
    res.json(report);
  });

  // Vite middleware for dev mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Computless Cloud Substrate Server] running on http://0.0.0.0:${PORT}`);
    startCapiRegistration();
  });
}

startServer();
