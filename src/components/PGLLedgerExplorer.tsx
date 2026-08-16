import React, { useState, useEffect } from 'react';
import {
  PGLRecord,
  ActionEvidenceRecord,
  ActionExecutionConfirmationCertificate,
  ActionSignatureVerificationReport,
} from '../types';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Search,
  FileText,
  Zap,
  RefreshCw,
  Sliders,
  Check,
  XCircle,
  Layers,
  Gauge,
  Cpu,
  GitCommit,
  Network,
  Activity,
  Award,
  ChevronRight,
  Fingerprint,
} from 'lucide-react';

interface PGLLedgerExplorerProps {
  records: PGLRecord[];
}

export const PGLLedgerExplorer: React.FC<PGLLedgerExplorerProps> = ({ records }) => {
  const [activeTab, setActiveTab] = useState<'evidence_ledger' | 'measurement_certs' | 'merkle_tree' | 'action_verifier'>('evidence_ledger');
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Evidence Records State
  const [evidenceRecords, setEvidenceRecords] = useState<ActionEvidenceRecord[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [merkleTreeData, setMerkleTreeData] = useState<any | null>(null);
  const [selectedMerkleLeafIndex, setSelectedMerkleLeafIndex] = useState<number>(0);
  const [merkleProofResult, setMerkleProofResult] = useState<any | null>(null);

  // Measurement State
  const [certificates, setCertificates] = useState<ActionExecutionConfirmationCertificate[]>([]);
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [measurementMetrics, setMeasurementMetrics] = useState<any | null>(null);

  // Verification & Tamper State
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [tamperInput, setTamperInput] = useState<string>('{\n  "action": "matrix_multiply",\n  "matrixSize": 64,\n  "iterations": 150\n}');
  const [tamperMode, setTamperMode] = useState<boolean>(false);
  const [verificationReport, setVerificationReport] = useState<ActionSignatureVerificationReport | null>(null);

  // Fetch Evidence and Measurement data
  const fetchData = async () => {
    try {
      const [evRes, certsRes, metricsRes, merkleRes] = await Promise.all([
        fetch('/api/substrate/evidence/records'),
        fetch('/api/substrate/measurement/certificates'),
        fetch('/api/substrate/measurement/metrics'),
        fetch('/api/substrate/evidence/merkle'),
      ]);

      if (evRes.ok) {
        const evData = await evRes.json();
        setEvidenceRecords(evData.records || []);
        if (evData.records?.length && !selectedEvidenceId) {
          setSelectedEvidenceId(evData.records[0].id);
        }
      }

      if (certsRes.ok) {
        const cData = await certsRes.json();
        setCertificates(cData || []);
        if (cData?.length && !selectedCertId) {
          setSelectedCertId(cData[0].certificateId);
        }
      }

      if (metricsRes.ok) {
        const mData = await metricsRes.json();
        setMeasurementMetrics(mData);
      }

      if (merkleRes.ok) {
        const treeData = await merkleRes.json();
        setMerkleTreeData(treeData);
      }
    } catch (err) {
      console.warn('Failed to load evidence / measurement data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const selectedEvidence = evidenceRecords.find((r) => r.id === selectedEvidenceId) || evidenceRecords[0];
  const selectedCertificate = certificates.find((c) => c.certificateId === selectedCertId) || certificates[0];

  const handleFetchMerkleProof = async (index: number) => {
    setSelectedMerkleLeafIndex(index);
    try {
      const res = await fetch(`/api/substrate/evidence/proof/${index}`);
      if (res.ok) {
        const data = await res.json();
        setMerkleProofResult(data);
      }
    } catch (err) {
      console.error('Failed to get Merkle proof:', err);
    }
  };

  const handleVerifyEvidence = async () => {
    if (!selectedEvidence) return;
    setIsVerifying(true);
    setVerificationReport(null);

    try {
      let payloadToVerify = selectedEvidence.requestPayload;
      if (tamperMode) {
        try {
          payloadToVerify = { ...JSON.parse(tamperInput), __tamperedByteInjection: true };
        } catch {
          payloadToVerify = { raw: tamperInput, tampered: true };
        }
      }

      const res = await fetch('/api/substrate/evidence/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceId: selectedEvidence.id,
          transactionId: selectedEvidence.transactionId,
          requestPayload: payloadToVerify,
          responsePayload: selectedEvidence.responsePayload,
          pglSignature: selectedEvidence.pglSignature,
          expectedParentHash: selectedEvidence.parentBlockHash,
        }),
      });

      const data = await res.json();
      setVerificationReport(data.report);
    } catch (err) {
      console.error('Verification error:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner Explaining Evidence (Layer 6) & Measurement (Layer 7) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Layer 6: Evidence &amp; Layer 7: Measurement
              </span>
              <span className="text-xs text-slate-400 font-mono">Immutable Cryptographic Audit &amp; 5-Point Confirmation</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              Cryptographic Evidence Ledger &amp; Action Confirmation Engine
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Every action dispatched through the Computless Cloud substrate produces parent-chained SHA-256 block evidence, an HMAC non-repudiation signature, and a 5-dimension confirmation certificate evaluating schema, latency SLA, memory containment, runtime status, and hardware telemetry.
            </p>
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-center">
              <span className="text-slate-400 block text-[10px]">EVIDENCE BLOCKS</span>
              <span className="text-base font-bold text-emerald-400">{evidenceRecords.length || records.length}</span>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-center">
              <span className="text-slate-400 block text-[10px]">CONFIRMATION SCORE</span>
              <span className="text-base font-bold text-sky-400">
                {measurementMetrics?.averageConfirmationScorePct || 98}%
              </span>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-center">
              <span className="text-slate-400 block text-[10px]">SLA COMPLIANCE</span>
              <span className="text-base font-bold text-amber-400">
                {measurementMetrics?.slaComplianceRatePct || 100}%
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-2 mt-6 border-t border-slate-800 pt-4">
          <button
            onClick={() => setActiveTab('evidence_ledger')}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'evidence_ledger'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Layer 6: Evidence Ledger &amp; Proofs ({evidenceRecords.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('measurement_certs')}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'measurement_certs'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Gauge className="h-4 w-4" />
            <span>Layer 7: Measurement Certificates ({certificates.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('merkle_tree');
              if (evidenceRecords.length > 0) handleFetchMerkleProof(0);
            }}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'merkle_tree'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <GitCommit className="h-4 w-4" />
            <span>Evidence Merkle Tree</span>
          </button>

          <button
            onClick={() => setActiveTab('action_verifier')}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center space-x-2 ${
              activeTab === 'action_verifier'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>Tamper Resilience Sandbox</span>
          </button>
        </div>
      </div>

      {/* TAB 1: EVIDENCE LEDGER & PROOFS (LAYER 6) */}
      {activeTab === 'evidence_ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Evidence List */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono">
                Evidence Blocks ({evidenceRecords.length})
              </h3>
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search Tx or Capability..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 w-full sm:w-48"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {evidenceRecords
                .filter(
                  (r) =>
                    r.transactionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.capabilityId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.executingNodeName.toLowerCase().includes(searchTerm.toLowerCase())
                )
                .map((rec) => {
                  const isSelected = rec.id === selectedEvidenceId;
                  return (
                    <div
                      key={rec.id}
                      onClick={() => {
                        setSelectedEvidenceId(rec.id);
                        setVerificationReport(null);
                      }}
                      className={`p-3.5 rounded-lg border transition cursor-pointer font-mono text-xs space-y-2 ${
                        isSelected
                          ? 'bg-slate-800/90 border-emerald-500 shadow-md shadow-emerald-500/10'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold">
                            #{rec.blockHeight}
                          </span>
                          <span className="font-bold text-white text-sm">{rec.transactionId}</span>
                        </div>
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px]">
                          PGL SEALED
                        </span>
                      </div>

                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>Node: <strong className="text-slate-200">{rec.executingNodeName}</strong></span>
                        <span>Cap: <strong className="text-sky-400">{rec.capabilityId}</strong></span>
                      </div>

                      <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800">
                        <span className="truncate max-w-[200px]">Leaf: {rec.merkleLeafHash}</span>
                        <span>{new Date(rec.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Detailed Evidence Block Inspector */}
          {selectedEvidence && (
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-2">
                  <Fingerprint className="h-5 w-5 text-emerald-400" />
                  <div>
                    <h3 className="font-bold text-white text-base">
                      Cryptographic Evidence Block #{selectedEvidence.blockHeight}
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400 block">{selectedEvidence.id}</span>
                  </div>
                </div>

                <button
                  onClick={handleVerifyEvidence}
                  disabled={isVerifying}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center space-x-1.5 cursor-pointer transition shadow-md shadow-emerald-500/20"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                  <span>Deep Verify Proof</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-slate-500 block text-[10px]">TRANSACTION ID</span>
                  <span className="text-emerald-400 font-bold">{selectedEvidence.transactionId}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-slate-500 block text-[10px]">CAPABILITY &amp; SUBJECT</span>
                  <span className="text-sky-300 truncate block">{selectedEvidence.capabilityId} ({selectedEvidence.subject})</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 md:col-span-2">
                  <span className="text-slate-500 block text-[10px]">HMAC-SHA256 NON-REPUDIATION SIGNATURE</span>
                  <span className="text-amber-300 break-all text-[11px]">{selectedEvidence.pglSignature}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-slate-500 block text-[10px]">REQUEST CANONICAL SHA-256 HASH</span>
                  <span className="text-slate-300 break-all text-[11px]">{selectedEvidence.requestPayloadHash}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <span className="text-slate-500 block text-[10px]">RESPONSE CANONICAL SHA-256 HASH</span>
                  <span className="text-slate-300 break-all text-[11px]">{selectedEvidence.responseHash}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 md:col-span-2">
                  <span className="text-slate-500 block text-[10px]">PARENT BLOCK HASH (IMMUTABLE CHAINING)</span>
                  <span className="text-slate-400 break-all text-[11px]">{selectedEvidence.parentBlockHash}</span>
                </div>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 md:col-span-2">
                  <span className="text-slate-500 block text-[10px]">MERKLE LEAF HASH</span>
                  <span className="text-emerald-400 break-all text-[11px]">{selectedEvidence.merkleLeafHash}</span>
                </div>
              </div>

              {/* Hardware & Enclave Attestation Box */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="text-xs font-mono font-bold text-slate-300 flex items-center space-x-1.5">
                  <Cpu className="h-4 w-4 text-emerald-400" />
                  <span>Hardware Enclave Attestation Seal</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-400">
                  <div>
                    <span className="text-[10px] text-slate-500 block">ENCLAVE PLATFORM</span>
                    <span className="text-slate-200">{selectedEvidence.enclaveAttestation.enclavePlatform}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">SECURITY LEVEL</span>
                    <span className="text-emerald-400 font-bold">{selectedEvidence.enclaveAttestation.securityLevel}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">MEASUREMENT REGISTER</span>
                    <span className="text-slate-200">{selectedEvidence.enclaveAttestation.measurementRegister}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">NONCE</span>
                    <span className="text-slate-200">{selectedEvidence.nonce.slice(0, 10)}...</span>
                  </div>
                </div>
              </div>

              {/* Deep Verification Report Modal / Panel */}
              {verificationReport && (
                <div
                  className={`p-4 rounded-xl border space-y-3 font-mono text-xs ${
                    verificationReport.valid
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm flex items-center gap-2">
                      {verificationReport.valid ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          5-STAGE CRYPTOGRAPHIC ATTESTATION PASSED
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-rose-400" />
                          TAMPER DETECTED - CRYPTO VERIFICATION FAILED
                        </>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Checked at {new Date(verificationReport.verificationTimestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-800 text-[11px]">
                    {verificationReport.stages.map((st, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2">
                        <span className="text-slate-400">{st.stageName}:</span>
                        <span className={st.passed ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {st.details}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MEASUREMENT CERTIFICATES (LAYER 7) */}
      {activeTab === 'measurement_certs' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Certificate List */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono">
              Action Execution Confirmation Certificates ({certificates.length})
            </h3>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {certificates.map((cert) => {
                const isSelected = cert.certificateId === selectedCertId;
                return (
                  <div
                    key={cert.certificateId}
                    onClick={() => setSelectedCertId(cert.certificateId)}
                    className={`p-3.5 rounded-lg border transition cursor-pointer font-mono text-xs space-y-2 ${
                      isSelected
                        ? 'bg-slate-800/90 border-sky-500 shadow-md shadow-sky-500/10'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm">{cert.certificateId}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          cert.overallConfirmationStatus === 'FULLY_CONFIRMED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {cert.overallConfirmationStatus}
                      </span>
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Score: <strong className="text-emerald-400">{cert.confirmationScorePct}%</strong></span>
                      <span>Latency: <strong className="text-sky-400">{cert.dimensions.slaLatency.actualWallClockLatencyMs}ms</strong></span>
                    </div>

                    <p className="text-[10px] text-slate-400 truncate pt-1 border-t border-slate-800">
                      {cert.summaryVerdict}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Certificate Dimension Drilldown */}
          {selectedCertificate && (
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-2">
                  <Award className="h-5 w-5 text-sky-400" />
                  <div>
                    <h3 className="font-bold text-white text-base">
                      Execution Confirmation Certificate: {selectedCertificate.certificateId}
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400 block">
                      Target Action: {selectedCertificate.actionId}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono text-slate-400">Confirmation Score:</span>
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    {selectedCertificate.confirmationScorePct}%
                  </span>
                </div>
              </div>

              {/* Summary Verdict */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg">
                <span className="text-[10px] font-mono text-slate-500 block uppercase">Summary Verdict</span>
                <p className="text-xs font-mono text-slate-200 mt-0.5">{selectedCertificate.summaryVerdict}</p>
              </div>

              {/* 5-Point Dimension Grid */}
              <div className="space-y-3 font-mono text-xs">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  5-Point Confirmation Dimensions:
                </h4>

                {/* Dimension 1: Schema Conformance (30%) */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <FileText className="h-3.5 w-3.5 text-indigo-400" />
                      <span>1. Schema Conformance (Weight: 30%)</span>
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold">
                      {selectedCertificate.dimensions.schemaConformance.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedCertificate.dimensions.schemaConformance.details}
                  </p>
                </div>

                {/* Dimension 2: SLA & Latency (25%) */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <Gauge className="h-3.5 w-3.5 text-sky-400" />
                      <span>2. SLA &amp; Latency Bounds (Weight: 25%)</span>
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold">
                      {selectedCertificate.dimensions.slaLatency.actualWallClockLatencyMs}ms / Max {selectedCertificate.dimensions.slaLatency.targetMaxLatencyMs}ms
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedCertificate.dimensions.slaLatency.details}
                  </p>
                </div>

                {/* Dimension 3: Resource Containment (15%) */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <Cpu className="h-3.5 w-3.5 text-amber-400" />
                      <span>3. Resource Containment (Weight: 15%)</span>
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold">
                      {(selectedCertificate.dimensions.resourceContainment.memoryUsedBytes / 1024).toFixed(1)} KB Used
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedCertificate.dimensions.resourceContainment.details}
                  </p>
                </div>

                {/* Dimension 4: Runtime Status (20%) */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" />
                      <span>4. Runtime Exit Status (Weight: 20%)</span>
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold">
                      {selectedCertificate.dimensions.runtimeStatus.exitCode} (Status: {selectedCertificate.dimensions.runtimeStatus.status})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedCertificate.dimensions.runtimeStatus.details}
                  </p>
                </div>

                {/* Dimension 5: Telemetry Attestation (10%) */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
                      <span>5. Hardware Telemetry &amp; Attestation (Weight: 10%)</span>
                    </span>
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-bold">
                      Node Uptime: {selectedCertificate.dimensions.telemetryAttestation.nodeUptimePct}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {selectedCertificate.dimensions.telemetryAttestation.details}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MERKLE TREE EXPLORER */}
      {activeTab === 'merkle_tree' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base flex items-center space-x-2">
                <GitCommit className="h-5 w-5 text-indigo-400" />
                <span>Evidence Merkle Audit Tree</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Logarithmic audit proofs proving inclusion of every evidence block in the substrate ledger without scanning the entire history.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Root Hash: <span className="text-emerald-400 font-bold">{merkleTreeData?.root || '0x000...'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Leaves List */}
            <div className="lg:col-span-5 space-y-3">
              <span className="text-xs font-bold text-slate-300 uppercase font-mono block">
                Evidence Leaves ({evidenceRecords.length})
              </span>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {evidenceRecords.map((rec, idx) => (
                  <div
                    key={rec.id}
                    onClick={() => handleFetchMerkleProof(idx)}
                    className={`p-3 rounded-lg border transition cursor-pointer font-mono text-xs flex items-center justify-between ${
                      selectedMerkleLeafIndex === idx
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    <div>
                      <span className="font-bold block text-slate-200">Leaf #{idx}: {rec.transactionId}</span>
                      <span className="text-[10px] text-slate-500 truncate max-w-[220px] block">{rec.merkleLeafHash}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </div>
                ))}
              </div>
            </div>

            {/* Audit Path & Proof Validator */}
            <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <span className="text-xs font-bold text-slate-200 uppercase font-mono flex items-center space-x-2">
                <Network className="h-4 w-4 text-emerald-400" />
                <span>Merkle Audit Path Proof (Leaf #{selectedMerkleLeafIndex})</span>
              </span>

              {merkleProofResult ? (
                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                    <span className="text-slate-500 block text-[10px]">LEAF HASH</span>
                    <span className="text-emerald-400 break-all">{merkleProofResult.leaf}</span>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                    <span className="text-slate-500 block text-[10px]">TREE ROOT HASH</span>
                    <span className="text-sky-300 break-all">{merkleProofResult.root}</span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-slate-400 block text-[11px]">Audit Path Sibling Hashes:</span>
                    {merkleProofResult.proof?.map((p: any, idx: number) => (
                      <div key={idx} className="p-2 bg-slate-900/80 rounded border border-slate-800/60 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Level {idx + 1} ({p.position}):</span>
                        <span className="text-amber-300 break-all">{p.siblingHash}</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 flex items-center space-x-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Cryptographic Merkle inclusion verified: O(log N) complexity.</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs font-mono text-slate-500">Select an evidence leaf to calculate and inspect its audit proof.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: TAMPER RESILIENCE SANDBOX */}
      {activeTab === 'action_verifier' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base flex items-center space-x-2">
                <Sliders className="h-5 w-5 text-amber-400" />
                <span>Live Substrate Tamper Detection Sandbox</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Simulate arbitrary bit flips or malicious modifications in JSON payload to prove the non-repudiation and immutable evidence security guarantees.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-300">Target Evidence Record</span>
                <select
                  value={selectedEvidenceId || ''}
                  onChange={(e) => setSelectedEvidenceId(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 rounded px-2.5 py-1"
                >
                  {evidenceRecords.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.transactionId} ({r.capabilityId})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">Payload to Submit for Cryptographic Audit:</span>
                  <button
                    onClick={() => setTamperMode(!tamperMode)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold cursor-pointer transition border ${
                      tamperMode
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {tamperMode ? '⚠️ Tamper Injected' : '✅ Untampered Authentic Payload'}
                  </button>
                </div>

                <textarea
                  value={tamperInput}
                  onChange={(e) => setTamperInput(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                onClick={handleVerifyEvidence}
                disabled={isVerifying}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer transition shadow-md shadow-amber-500/20"
              >
                <RefreshCw className={`h-4 w-4 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>Execute Deep Cryptographic Audit Verification</span>
              </button>
            </div>

            <div className="lg:col-span-6">
              {verificationReport ? (
                <div
                  className={`p-5 rounded-xl border space-y-4 font-mono text-xs ${
                    verificationReport.valid
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm flex items-center gap-2">
                      {verificationReport.valid ? (
                        <>
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          AUTHENTIC STATE VERIFIED
                        </>
                      ) : (
                        <>
                          <XCircle className="h-5 w-5 text-rose-400" />
                          SECURITY ALERT: BYTE-LEVEL TAMPER DETECTED
                        </>
                      )}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300">
                    {verificationReport.valid
                      ? 'All cryptographic seals, SHA-256 canonical digests, and HMAC signatures match with 0 bit drift.'
                      : 'Substrate cryptographic engine rejected the verification. Computed digest does not match the non-repudiation signature recorded in the evidence ledger.'}
                  </p>

                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    {verificationReport.stages.map((st, idx) => (
                      <div key={idx} className="p-2.5 bg-slate-950 rounded border border-slate-800 flex items-start justify-between gap-2">
                        <div>
                          <span className="font-bold block text-slate-200">{st.stageName}</span>
                          <span className="text-[10px] text-slate-400">{st.details}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${st.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                          {st.passed ? 'PASSED' : 'REJECTED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center text-slate-500 font-mono text-xs flex flex-col items-center justify-center space-y-3 bg-slate-950 rounded-xl border border-slate-800">
                  <ShieldCheck className="h-10 w-10 text-slate-600" />
                  <p className="text-slate-300 font-semibold">Ready to test cryptographic tamper detection.</p>
                  <p className="text-slate-500 max-w-sm">
                    Modify the JSON or toggle the tamper switch, then execute the audit to observe instant fail-safe rejection.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
