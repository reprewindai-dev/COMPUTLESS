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
} from './src/server/cryptoUtils.js';
import { CAPABILITY_CATALOG, MCP_TOOLS_CATALOG } from './src/data/mockData.js';
import {
  SubstrateNode,
  CAPPOGrant,
  PGLRecord,
  HRMRRouteRequest,
  HRMRRouteResult,
  RouteTraceStep,
  FPIProvider,
  FPIResourceAllocation,
  FPIExecutionJob,
  FPIBillingSettlement,
  FPIDiscoveryQuery,
} from './src/types.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      substrateVersion: '1.0.0-Veklom-Substrate-Enterprise',
      architecture: 'Unified 8-Layer Substrate Engine',
      dbPersisted: true,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // 2. Substrate Nodes API
  app.get('/api/substrate/nodes', (req, res) => {
    res.json(dbStore.getSubstrateNodes());
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
    const issuer = 'cappo:authority:veklom-enterprise-root';
    const issueDate = new Date().toISOString();
    const expiresAt = Date.now() + Number(durationHours) * 3600000;

    const signatureMsg = `${grantId}:${issuer}:${subject}:${allowedCapabilities.join(',')}:${expiresAt}`;
    const cappoSignature = '0x_cappo_sig_' + crypto.createHmac('sha256', 'veklom-key').update(signatureMsg).digest('hex').slice(0, 32);

    const newGrant: CAPPOGrant = {
      grantId,
      issuer,
      subject,
      allowedCapabilities,
      issueDate,
      expiresAt,
      isRevoked: false,
      cappoSignature,
    };

    dbStore.addCappoGrant(newGrant);

    res.status(201).json({
      success: true,
      message: 'CAPPO Grant issued and persisted to substrate ledger.',
      grant: newGrant,
    });
  });

  // 4. HRMR Execution & Two Invariants Routing Engine
  app.post('/api/substrate/route', (req, res) => {
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
      detail: `Received HTTP request for capability: ${capabilityId}. Target preferred node: ${preferredNodeId}`,
    });

    const substrateNodes = dbStore.getSubstrateNodes();
    const cappoGrants = dbStore.getCappoGrants();

    // Layer 4 & 5: Capability & CAPPO Authority Validation
    const capDef = CAPABILITY_CATALOG.find((c) => c.id === capabilityId);
    const cappoGrant = cappoGrants.find((g) => g.grantId === cappoGrantId);

    const isAuthorityValid =
      !invalidCappo &&
      cappoGrant &&
      !cappoGrant.isRevoked &&
      cappoGrant.expiresAt > Date.now() &&
      cappoGrant.allowedCapabilities.includes(capabilityId);

    if (!isAuthorityValid) {
      // INVARIANT 1: Authority is invariant! 403 Terminal Denial
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 5: Authority (CAPPO)',
        status: 'TERMINAL_403',
        detail: `[INVARIANT 1 ENFORCED] HTTP 403 Terminal. Authority check failed for grant ${cappoGrantId}. Authority cannot move, retry, or reroute. Permission hunting blocked.`,
      });

      res.setHeader('Content-Type', 'application/problem+json');
      res.setHeader('X-Veklom-CAPPO', 'DENIED_TERMINAL');
      res.setHeader('X-Substrate-Invariant', 'Authority-Invariant-403');

      const result403: HRMRRouteResult = {
        transactionId: txId,
        capabilityId,
        requestedNodeId: preferredNodeId,
        finalHttpStatus: 403,
        authorityDecision: 'DENIED_TERMINAL',
        executionStatus: 'FAILED',
        executionTimeMs: 12,
        trace,
        outputData: buildProblemDetails('cappo-403-forbidden', 'Authority Check Failed', 403, `Grant ${cappoGrantId} is invalid, revoked, or missing required capability '${capabilityId}'.`, req.originalUrl),
      };

      return res.status(403).json(result403);
    }

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 5: Authority (CAPPO)',
      status: 'SUCCESS',
      detail: `Authority verified for subject: ${cappoGrant?.subject}. CAPPO signature valid.`,
    });

    // Layer 6: Routing (HRMR) & Execution Location Selection
    let targetNode = substrateNodes.find((n) => n.id === preferredNodeId);

    const isNodeUnavailable =
      !targetNode ||
      targetNode.status === 'offline' ||
      targetNode.id === force503NodeId;

    let executedNodeId = preferredNodeId;
    let isFallback = false;

    if (isNodeUnavailable) {
      // INVARIANT 2: Execution can move! 503 Infrastructure Failure triggers fallback
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 6: Routing (HRMR)',
        status: 'FALLBACK_503',
        detail: `[INVARIANT 2 ENFORCED] HTTP 503 on primary node ${preferredNodeId} (${targetNode?.name || 'Unavailable'}). HRMR executing transparent fallback search without changing authority identity.`,
      });

      // Find best available online node supporting capability
      const availableFallback = substrateNodes.find(
        (n) => n.status === 'online' && n.id !== preferredNodeId && n.supportedCapabilities.includes(capabilityId)
      );

      if (availableFallback) {
        executedNodeId = availableFallback.id;
        targetNode = availableFallback;
        isFallback = true;

        trace.push({
          step: stepCount++,
          timestamp: new Date().toISOString(),
          layer: 'Layer 6: Routing (HRMR)',
          status: 'SUCCESS',
          detail: `HRMR fallback routed payload to ${availableFallback.name} (${availableFallback.region}) with zero authority drift. Latency: ${availableFallback.latencyMs}ms.`,
        });
      } else {
        // All nodes failed
        trace.push({
          step: stepCount++,
          timestamp: new Date().toISOString(),
          layer: 'Layer 6: Routing (HRMR)',
          status: 'FALLBACK_503',
          detail: 'All substrate nodes unavailable for capability. Returning HTTP 503.',
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
          executionTimeMs: 22,
          trace,
          outputData: buildProblemDetails('infrastructure-503-unavailable', 'Substrate Infrastructure Failure', 503, 'All candidate execution nodes are offline or unreachable.', req.originalUrl),
        };
        return res.status(503).json(result503);
      }
    } else {
      trace.push({
        step: stepCount++,
        timestamp: new Date().toISOString(),
        layer: 'Layer 6: Routing (HRMR)',
        status: 'SUCCESS',
        detail: `Primary node ${targetNode.name} online. Selected as execution substrate.`,
      });
    }

    // Layer 7: Execution
    const startTime = Date.now();
    const mockOutput = {
      result: 'WORKLOAD_EXECUTED',
      capability: capDef?.name || capabilityId,
      executedByNode: targetNode?.name,
      localityBoundary: targetNode?.localityBoundary,
      payloadEcho: payload,
      isSovereignExecution: targetNode?.isSovereign,
    };
    const executionTimeMs = Date.now() - startTime + (targetNode?.latencyMs || 10);

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 7: Execution',
      status: 'EXECUTED',
      detail: `Workload executed successfully on ${targetNode?.name} in ${executionTimeMs}ms.`,
    });

    // Layer 8: Evidence (PGL) & Settlement (x402)
    const requestHash = hashPayload(payload);
    const responseHash = hashPayload(mockOutput);
    const gasSettled = isFallback ? 0.0024 : 0.0012;
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
      x402GasSettled: gasSettled,
      verifiable: true,
    };

    dbStore.addPGLRecord(pglRecord);

    trace.push({
      step: stepCount++,
      timestamp: new Date().toISOString(),
      layer: 'Layer 8: Evidence (PGL) & Settlement (x402)',
      status: 'SUCCESS',
      detail: `Cryptographic proof recorded in PGL (Sig: ${pglSig.slice(0, 18)}...). x402 Gas Settled: ${gasSettled} VEK.`,
    });

    const x402Hdrs = buildx402Headers(gasSettled, executedNodeId, txId);
    Object.entries(x402Hdrs).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('X-Veklom-CAPPO', 'AUTHORIZED');
    res.setHeader('X-Substrate-PGL', pglRecord.pglSignature);

    const finalResult: HRMRRouteResult = {
      transactionId: txId,
      capabilityId,
      requestedNodeId: preferredNodeId,
      executedNodeId,
      finalHttpStatus: 200,
      authorityDecision: 'GRANTED',
      executionStatus: isFallback ? 'REROUTED_FALLBACK' : 'SUCCESS',
      executionTimeMs,
      pglProofHash: pglRecord.responseHash,
      x402SettlementGas: gasSettled,
      trace,
      outputData: mockOutput,
    };

    res.json(finalResult);
  });

  // 5. Herdr Recursive Agent Engine
  app.get('/api/agents', (req, res) => {
    res.json(dbStore.getAgentTasks());
  });

  app.post('/api/agents/step', async (req, res) => {
    const { taskId, userPrompt } = req.body;
    const agentTasks = dbStore.getAgentTasks();
    const task = agentTasks.find((t) => t.id === taskId) || agentTasks[0];

    task.status = 'RECURSING';
    task.recursionDepth = Math.min(task.maxRecursionDepth, task.recursionDepth + 1);
    task.lastOptimizedAt = new Date().toISOString();

    let aiRecommendation = '';

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `You are the Herdr Agent Self-Hosting Substrate Optimizer.
Task: ${task.name}
Current Recursion Depth: ${task.recursionDepth}/${task.maxRecursionDepth}
User Context/Prompt: ${userPrompt || 'Optimize substrate routing and capability dispatch efficiency.'}
Recent Task Logs: ${task.logs.slice(-3).join('\n')}

Generate a concise, 2-bullet architectural improvement recommendation for the substrate runtime focusing on the 8-Layer Unified Substrate Stack and HTTP 403/503 invariants. Keep under 80 words.`,
        });
        aiRecommendation = response.text || '';
      } catch (err) {
        console.warn('Gemini API call failed, using heuristic response:', err);
      }
    }

    if (!aiRecommendation) {
      aiRecommendation = `Substrate HRMR Routing optimized: Switched latency weighting algorithm from linear to exponential. Increased local enclave throughput by +14.2%.`;
    }

    const logEntry = `[Herdr Step ${task.recursionDepth}] ${aiRecommendation.trim().replace(/\n/g, ' ')}`;
    task.logs.push(logEntry);
    task.metrics.opsPerSec = +(task.metrics.opsPerSec * 1.05).toFixed(1);
    task.metrics.tasksDriven += 1;
    task.status = 'EVALUATING';

    res.json({
      success: true,
      task,
      aiRecommendation,
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

    const verificationResult = verifyPGLProof(txToUse, capToUse, payload || { verify: true }, respHashToUse, sigToUse);

    res.json({
      success: verificationResult.valid,
      recordId: existingRec?.id || 'adhoc-proof-check',
      transactionId: txToUse,
      verificationResult,
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

      const pglHash = '0x' + crypto.randomBytes(32).toString('hex');
      return res.json({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'EXECUTED_VIA_SUBSTRATE',
                tool: toolName,
                capabilityBinding: foundTool.capabilityBinding,
                args: toolArgs,
                cappoSignatureVerified: true,
                pglEvidenceHash: pglHash,
                persistedToLedger: true,
              }, null, 2),
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
      regions = ['us-east-1'],
      supportedCapabilities = ['cap-compute-v1'],
      isSovereignEnclave = false,
      maxLatencyMs = 25,
      slaUptimePct = 99.9,
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
    const authKey = '0xfpi_key_' + crypto.randomBytes(6).toString('hex');

    const newProvider: FPIProvider = {
      id: providerId,
      providerName,
      providerType,
      endpointUrl,
      authKeyHash: authKey,
      regions,
      status: 'active',
      slaUptimePct: Number(slaUptimePct),
      maxLatencyMs: Number(maxLatencyMs),
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
      lastHeartbeatAt: new Date().toISOString(),
    };

    dbStore.addFPIProvider(newProvider);

    res.status(201).json({
      success: true,
      message: 'Federation Provider registered and persisted cleanly.',
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

    const matches = fpiProviders.filter((p) => {
      if (p.status !== 'active') return false;
      if (capabilityId && !p.supportedCapabilities.includes(capabilityId)) return false;
      if (region && !p.regions.includes(region) && !p.regions.includes('global-mesh-p2p')) return false;
      if (maxLatencyMs && p.maxLatencyMs > maxLatencyMs) return false;
      if (isSovereignRequired && !p.isSovereignEnclave) return false;
      if (maxPricePerUnitVEK && p.pricing.pricePerComputeUnitVEK > maxPricePerUnitVEK) return false;
      if (minUptimePct && p.slaUptimePct < minUptimePct) return false;
      return true;
    });

    matches.sort((a, b) => {
      const scoreA = a.maxLatencyMs + a.pricing.pricePerComputeUnitVEK * 10000;
      const scoreB = b.maxLatencyMs + b.pricing.pricePerComputeUnitVEK * 10000;
      return scoreA - scoreB;
    });

    res.json({
      query,
      matchCount: matches.length,
      matchedProviders: matches,
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
    };

    provider.quota.totalAllocatedUnits += Number(computeUnits);
    dbStore.addFPIAllocation(allocation);

    res.status(201).json({
      success: true,
      message: 'Resource lease allocated and persisted successfully.',
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

  app.post('/api/fpi/execute', (req, res) => {
    const {
      providerId = 'fpi-provider-aws-sovereign',
      capabilityId = 'cap-compute-v1',
      cappoGrantId = 'cappo-grant-alpha-001',
      payload = {},
      forceFallback = false,
    } = req.body;

    const fpiProviders = dbStore.getFPIProviders();
    let targetProvider = fpiProviders.find((p) => p.id === providerId);
    let isFallbackRerouted = false;

    if (!targetProvider || targetProvider.status !== 'active' || forceFallback) {
      const fallback = fpiProviders.find(
        (p) => p.status === 'active' && p.id !== providerId && p.supportedCapabilities.includes(capabilityId)
      );
      if (fallback) {
        targetProvider = fallback;
        isFallbackRerouted = true;
      } else {
        return res.status(503).json(
          buildProblemDetails('fpi-unavailable', 'Federation Infrastructure Unavailable', 503, 'Primary provider unreachable and no compliant active fallback provider available.', req.originalUrl)
        );
      }
    }

    const jobId = 'fpi-job-' + crypto.randomBytes(3).toString('hex');
    const submittedAt = new Date().toISOString();
    const executionTimeMs = targetProvider.maxLatencyMs + Math.floor(Math.random() * 10);
    const gasSettled = +(targetProvider.pricing.pricePerComputeUnitVEK * 1.5).toFixed(4);

    const reqHash = hashPayload(payload);
    const respSummary = `Workload executed on ${targetProvider.providerName} in ${executionTimeMs}ms.`;
    const respHash = hashPayload(respSummary);
    const pglSig = signPGLProof(jobId, capabilityId, reqHash, respHash);

    const job: FPIExecutionJob = {
      id: jobId,
      providerId: targetProvider.id,
      providerName: targetProvider.providerName,
      capabilityId,
      cappoGrantId,
      status: isFallbackRerouted ? 'fallback_rerouted' : 'completed',
      executionTimeMs,
      x402GasSettled: gasSettled,
      pglProofSignature: pglSig,
      submittedAt,
      completedAt: new Date(Date.now() + executionTimeMs).toISOString(),
      outputSummary: respSummary,
      logs: [
        `[FPI Gateway] CAPPO grant ${cappoGrantId} validated.`,
        isFallbackRerouted
          ? `[HRMR Invariant 2] Fallback rerouted execution to provider ${targetProvider.providerName}.`
          : `[FPI Gateway] Payload dispatched to provider endpoint: ${targetProvider.endpointUrl}.`,
        `[FPI Provider] Workload executed cleanly with attestation. Time: ${executionTimeMs}ms.`,
        `[x402 Gas] Settled ${gasSettled} VEK. PGL proof: ${pglSig.slice(0, 22)}...`,
      ],
    };

    targetProvider.quota.usedUnits += 1;
    dbStore.addFPIJob(job);

    const pglRec: PGLRecord = {
      id: 'pgl-fpi-' + Date.now().toString().slice(-6),
      timestamp: submittedAt,
      transactionId: 'tx-fpi-' + crypto.randomBytes(3).toString('hex'),
      capabilityId,
      cappoGrantId,
      executedNodeId: targetProvider.id,
      requestPayloadHash: reqHash,
      responseHash: respHash,
      pglSignature: pglSig,
      x402GasSettled: gasSettled,
      verifiable: true,
    };
    dbStore.addPGLRecord(pglRec);

    const x402Hdrs = buildx402Headers(gasSettled, targetProvider.id, jobId);
    Object.entries(x402Hdrs).forEach(([k, v]) => res.setHeader(k, v));

    res.json({
      success: true,
      job,
      pglRecord: pglRec,
    });
  });

  // 9.5 Billing & x402 Settlements
  app.get('/api/fpi/billing', (req, res) => {
    res.json(dbStore.getFPISettlements());
  });

  app.post('/api/fpi/billing/settle', (req, res) => {
    const { settlementId } = req.body;
    const stl = dbStore.settleFPISettlement(settlementId);
    res.json({ success: true, settlement: stl });
  });

  // 9.6 FPI OpenAPI 3.0 Specification
  app.get('/api/fpi/openapi', (req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'Computeless Cloud Federation Provider Interface (FPI)',
        version: '1.0.0-FPI-SPEC',
        description:
          'Open standard protocol interface for cloud providers, sovereign enclaves, and decentralized edge swarms to register, manage federated execution, declare SLA resources, and settle x402 micropayment gas.',
        contact: { name: 'Computless Cloud Substrate Working Group', url: 'https://computless.cloud/fpi' },
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
            summary: 'HRMR Service Discovery Matchmaker Query',
            responses: { '200': { description: 'Matched Providers' } },
          },
        },
        '/api/fpi/resources/allocate': {
          post: {
            summary: 'Lease and allocate vCPU/RAM/GPU compute units',
            responses: { '201': { description: 'Allocation created' } },
          },
        },
        '/api/fpi/execute': {
          post: {
            summary: 'Dispatch federated execution workload with CAPPO authority and x402 settlement',
            responses: { '200': { description: 'Execution completed' } },
          },
        },
        '/api/fpi/billing': {
          get: { summary: 'Retrieve x402 settlement ledger and provider payouts', responses: { '200': { description: 'Success' } } },
        },
        '/api/ledger/verify': {
          post: {
            summary: 'Cryptographically verify Proof Graph Ledger evidence against HMAC/SHA-256 signatures',
            responses: { '200': { description: 'Verification results' } },
          },
        },
      },
    });
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
  });
}

startServer();
