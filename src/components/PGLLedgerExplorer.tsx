import React, { useState, useEffect } from 'react';
import { PGLRecord } from '../types';
import {
  ShieldCheck,
  CheckCircle2,
  Search,
  FileText,
  RefreshCw,
  Sliders,
  XCircle,
  Gauge,
  Cpu,
  GitCommit,
  Network,
  Activity,
  Award,
  ChevronRight,
  Fingerprint,
  HelpCircle,
} from 'lucide-react';
import { RecordBadge, EvidenceBadge, measured, hasNumber } from './EvidenceBadge';

interface PGLLedgerExplorerProps {
  records: PGLRecord[];
}

/** Mirrors hashPayload() for a string in src/server/cryptoUtils.ts: '0x' + sha256(JSON.stringify(s)). */
async function hashString(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return '0x' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Recompute the Merkle root from leaf + audit path in the browser. */
async function verifyInclusion(proof: any): Promise<boolean | null> {
  if (!proof || typeof proof.leafHash !== 'string' || typeof proof.merkleRoot !== 'string' || !Array.isArray(proof.auditPath)) return null;
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  let current: string = proof.leafHash;
  for (const step of proof.auditPath) {
    current = step?.position === 'left' ? await hashString(`${step.hash}:${current}`) : await hashString(`${current}:${step?.hash}`);
  }
  return current === proof.merkleRoot;
}

const statusTone = (s?: string) =>
  s === 'PASSED' || s === 'VERIFIED'
    ? 'bg-emerald-500/20 text-emerald-300'
    : s === 'FAILED' || s === 'EXCEEDED'
      ? 'bg-rose-500/20 text-rose-300'
      : s === 'WARNING' || s === 'DEGRADED' || s === 'PARTIAL' || s === 'OBSERVED'
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-slate-700/50 text-slate-300';

export const PGLLedgerExplorer: React.FC<PGLLedgerExplorerProps> = ({ records }) => {
  const [activeTab, setActiveTab] = useState<'evidence_ledger' | 'measurement_certs' | 'merkle_tree' | 'action_verifier'>('evidence_ledger');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [evidenceRecords, setEvidenceRecords] = useState<any[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [merkleTreeData, setMerkleTreeData] = useState<any | null>(null);
  const [selectedMerkleLeafIndex, setSelectedMerkleLeafIndex] = useState<number>(0);
  const [merkleProofResult, setMerkleProofResult] = useState<any | null>(null);
  const [browserInclusion, setBrowserInclusion] = useState<boolean | null | 'pending'>(null);

  const [certificates, setCertificates] = useState<any[]>([]);
  const [selectedCertId, setSelectedCertId] = useState<string | null>(null);
  const [measurementMetrics, setMeasurementMetrics] = useState<any | null>(null);

  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [tamperInput, setTamperInput] = useState<string>('{\n  "action": "matrix_multiply",\n  "matrixSize": 64,\n  "iterations": 150\n}');
  const [tamperMode, setTamperMode] = useState<boolean>(false);
  const [verificationReport, setVerificationReport] = useState<any | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const fetchData = async () => {
    const errors: string[] = [];
    const get = async (url: string) => {
      try {
        const r = await fetch(url);
        if (!r.ok) {
          errors.push(`${url} → HTTP ${r.status}`);
          return null;
        }
        return await r.json();
      } catch (e: any) {
        errors.push(`${url} → ${e?.message ?? 'failed'}`);
        return null;
      }
    };
    const [evData, cData, mData, treeData] = await Promise.all([
      get('/api/substrate/evidence/records'),
      get('/api/substrate/measurement/certificates'),
      get('/api/substrate/measurement/metrics'),
      get('/api/substrate/evidence/merkle'),
    ]);
    const recs = Array.isArray(evData?.records) ? evData.records : Array.isArray(evData) ? evData : [];
    setEvidenceRecords(recs);
    if (recs.length && !selectedEvidenceId) setSelectedEvidenceId(recs[0].id);
    const certs = Array.isArray(cData) ? cData : [];
    setCertificates(certs);
    if (certs.length && !selectedCertId) setSelectedCertId(certs[0].certificateId);
    setMeasurementMetrics(mData);
    setMerkleTreeData(treeData);
    setLoadError(errors.length ? errors.join('; ') : null);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEvidence = evidenceRecords.find((r) => r.id === selectedEvidenceId) || evidenceRecords[0];
  const selectedCertificate = certificates.find((c) => c.certificateId === selectedCertId) || certificates[0];

  const handleFetchMerkleProof = async (index: number) => {
    setSelectedMerkleLeafIndex(index);
    setMerkleProofResult(null);
    setBrowserInclusion('pending');
    try {
      const res = await fetch(`/api/substrate/evidence/proof/${index}`);
      const data = res.ok ? await res.json() : null;
      setMerkleProofResult(data);
      setBrowserInclusion(await verifyInclusion(data));
    } catch {
      setBrowserInclusion(null);
    }
  };

  const handleVerifyEvidence = async () => {
    if (!selectedEvidence) return;
    setIsVerifying(true);
    setVerificationReport(null);
    setVerifyError(null);
    try {
      let payloadToVerify: unknown = undefined;
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
          pglSignature: selectedEvidence.pglSignature,
          expectedParentHash: selectedEvidence.parentBlockHash,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.report) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      setVerificationReport(data.report);
    } catch (err: any) {
      setVerifyError(err?.message ? String(err.message) : 'verification request failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const checkpoints: any[] = Array.isArray(verificationReport?.attestationCheckpoints)
    ? verificationReport.attestationCheckpoints
    : Array.isArray(verificationReport?.stages)
      ? verificationReport.stages
      : [];

  const ReportView: React.FC<{ large?: boolean }> = ({ large }) =>
    verificationReport ? (
      <div
        className={`p-4 rounded-xl border space-y-3 font-mono text-xs ${
          verificationReport.valid === true ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`font-bold ${large ? 'text-sm' : ''} flex items-center gap-2`}>
            {verificationReport.valid === true ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Local checks passed (valid: true)
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-rose-400" />
                Verification failed (valid: {String(verificationReport.valid)})
              </>
            )}
          </span>
          <span className="text-[10px] text-slate-400">
            {verificationReport.verificationTimestamp ? new Date(verificationReport.verificationTimestamp).toLocaleTimeString() : ''}
          </span>
        </div>
        {verificationReport.verdictSummary && <p className="text-[11px] text-slate-300">{verificationReport.verdictSummary}</p>}
        <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-300">
          <span>signature match: {String(verificationReport.signatureMatch ?? 'n/a')}</span>
          <span>chain integrity: {String(verificationReport.chainIntegrityValid ?? 'n/a')}</span>
          <span>tamper detected: {String(verificationReport.tamperDetected ?? 'n/a')}</span>
        </div>
        <div className="space-y-1.5 pt-2 border-t border-slate-800">
          {checkpoints.map((cp, idx) => (
            <div key={idx} className="p-2 bg-slate-950 rounded border border-slate-800 flex items-start justify-between gap-2">
              <div>
                <span className="font-bold block text-slate-200">{cp.checkpoint ?? cp.stageName ?? `check ${idx + 1}`}</span>
                <span className="text-[10px] text-slate-400">{cp.description ?? cp.details ?? ''}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusTone(cp.status ?? (cp.passed ? 'PASSED' : 'FAILED'))}`}>
                {cp.status ?? (cp.passed ? 'PASSED' : 'FAILED')}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">
          These checks recompute hashes and the local HMAC on this server. They show the record is unchanged since this server signed it;
          they do not prove that any execution happened.
        </p>
      </div>
    ) : null;

  const totalCerts = measurementMetrics?.totalCertificatesIssued;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
                Local evidence &amp; measurement records
              </span>
              <span className="text-xs text-slate-400 font-mono">not canonical PGL</span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">Local evidence records</h2>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Records kept in this server's local, mutable JSON file: parent-chained SHA-256 hashes and an HMAC signature made with a
              local key. They are not Gnomledger events — governed runs append real events to Gnomledger, shown in each run's
              governance block. If SUBSTRATE_CRYPTO_SECRET is not set the key changes on every restart, so older signatures stop
              verifying.
            </p>
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-center">
              <span className="text-slate-400 block text-[10px]">LOCAL RECORDS</span>
              <span className="text-base font-bold text-slate-200">{evidenceRecords.length || records.length}</span>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-center">
              <span className="text-slate-400 block text-[10px]">AVG LOCAL SCORE</span>
              <span className="text-base font-bold text-slate-200">
                {hasNumber(totalCerts) && totalCerts > 0 ? measured(measurementMetrics?.averageConfirmationScorePct, '%') : 'no certificates'}
              </span>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="mt-4 p-2 rounded border border-rose-500/30 bg-rose-950/20 text-[11px] font-mono text-rose-300">
            Some evidence data failed to load: {loadError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-6 border-t border-slate-800 pt-4">
          {[
            { id: 'evidence_ledger', icon: <ShieldCheck className="h-4 w-4" />, label: `Evidence records (${evidenceRecords.length})` },
            { id: 'measurement_certs', icon: <Gauge className="h-4 w-4" />, label: `Measurement certificates (${certificates.length})` },
            { id: 'merkle_tree', icon: <GitCommit className="h-4 w-4" />, label: 'Merkle tree' },
            { id: 'action_verifier', icon: <Sliders className="h-4 w-4" />, label: 'Tamper check' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id as any);
                if (t.id === 'merkle_tree' && evidenceRecords.length > 0) handleFetchMerkleProof(0);
              }}
              className={`px-4 py-2 rounded-lg font-mono text-xs font-bold transition flex items-center space-x-2 cursor-pointer ${
                activeTab === t.id ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: EVIDENCE RECORDS */}
      {activeTab === 'evidence_ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono">Records ({evidenceRecords.length})</h3>
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search Tx or Capability..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 w-full sm:w-48"
                />
              </div>
            </div>

            {evidenceRecords.length === 0 && <p className="text-xs font-mono text-slate-500">No evidence records loaded.</p>}

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {evidenceRecords
                .filter((r) => {
                  const q = searchTerm.toLowerCase();
                  return [r.transactionId, r.capabilityId, r.executingNodeName].some((v) => String(v ?? '').toLowerCase().includes(q));
                })
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
                        isSelected ? 'bg-slate-800/90 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold">#{rec.blockHeight ?? '?'}</span>
                          <span className="font-bold text-white text-sm truncate">{rec.transactionId}</span>
                        </div>
                        <RecordBadge record={rec} fallback="UNVERIFIED" />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>
                          Node: <strong className="text-slate-200">{rec.executingNodeName ?? rec.executingNodeId ?? '—'}</strong>
                        </span>
                        <span>
                          Cap: <strong className="text-sky-400">{rec.capabilityId}</strong>
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800">
                        <span className="truncate max-w-[200px]">Leaf: {rec.merkleLeafHash}</span>
                        <span>{rec.timestamp ? new Date(rec.timestamp).toLocaleTimeString() : ''}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {selectedEvidence && (
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4 gap-2">
                <div className="flex items-center space-x-2">
                  <Fingerprint className="h-5 w-5 text-slate-300" />
                  <div>
                    <h3 className="font-bold text-white text-base">Local record #{selectedEvidence.blockHeight ?? '?'}</h3>
                    <span className="text-[10px] font-mono text-slate-400 block">{selectedEvidence.id}</span>
                  </div>
                  <RecordBadge record={selectedEvidence} fallback="UNVERIFIED" />
                </div>
                <button
                  onClick={handleVerifyEvidence}
                  disabled={isVerifying}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs flex items-center space-x-1.5 cursor-pointer transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                  <span>Run local verification</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                <Field k="TRANSACTION ID" v={selectedEvidence.transactionId} />
                <Field k="CAPABILITY & SUBJECT" v={`${selectedEvidence.capabilityId ?? '—'} (${selectedEvidence.subject ?? '—'})`} />
                <Field k="HMAC-SHA256 SIGNATURE (LOCAL KEY)" v={selectedEvidence.pglSignature} wide />
                <Field k="REQUEST SHA-256" v={selectedEvidence.requestPayloadHash} />
                <Field k="RESPONSE SHA-256" v={selectedEvidence.responseHash} />
                <Field k="PARENT BLOCK HASH (CHAINING)" v={selectedEvidence.parentBlockHash} wide />
                <Field k="MERKLE LEAF HASH" v={selectedEvidence.merkleLeafHash} wide />
                <Field k="STORED 'verifiable' FLAG (not a check)" v={String(selectedEvidence.verifiable ?? 'absent')} />
                <Field k="HARDWARE ATTESTATION" v="none — not implemented" />
              </div>

              {verifyError && (
                <div className="p-2 rounded border border-rose-500/30 bg-rose-950/20 text-[11px] font-mono text-rose-300">{verifyError}</div>
              )}
              <ReportView />
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MEASUREMENT CERTIFICATES */}
      {activeTab === 'measurement_certs' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider font-mono">Certificates ({certificates.length})</h3>
            {certificates.length === 0 && (
              <p className="text-xs font-mono text-slate-500">No measurement certificates. They are created when a pipeline run completes.</p>
            )}
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {certificates.map((cert) => {
                const isSelected = cert.certificateId === selectedCertId;
                return (
                  <div
                    key={cert.certificateId}
                    onClick={() => setSelectedCertId(cert.certificateId)}
                    className={`p-3.5 rounded-lg border transition cursor-pointer font-mono text-xs space-y-2 ${
                      isSelected ? 'bg-slate-800/90 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white text-sm truncate">{cert.certificateId}</span>
                      <span className="flex items-center gap-1">
                        <RecordBadge record={cert} fallback="UNVERIFIED" />
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">{cert.overallConfirmationStatus ?? '—'}</span>
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Score: {measured(cert.confirmationScorePct, '%')}</span>
                      <span>Latency: {measured(cert.dimensions?.slaLatency?.actualWallClockLatencyMs, ' ms')}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate pt-1 border-t border-slate-800">{cert.summaryVerdict}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedCertificate && (
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4 gap-2">
                <div className="flex items-center space-x-2">
                  <Award className="h-5 w-5 text-sky-400" />
                  <div>
                    <h3 className="font-bold text-white text-base">Certificate {selectedCertificate.certificateId}</h3>
                    <span className="text-[10px] font-mono text-slate-400 block">Action: {selectedCertificate.actionId ?? '—'}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono text-slate-400">Local score:</span>
                  <span className="text-xl font-bold font-mono text-slate-200">{measured(selectedCertificate.confirmationScorePct, '%')}</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                A local self-assessment computed by this server from its own run data. Issued by: {String(selectedCertificate.issuer ?? 'unknown')}.
                It is not an external certification.
              </p>

              {selectedCertificate.summaryVerdict && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg">
                  <span className="text-[10px] font-mono text-slate-500 block uppercase">Summary</span>
                  <p className="text-xs font-mono text-slate-200 mt-0.5">{selectedCertificate.summaryVerdict}</p>
                </div>
              )}

              <div className="space-y-3 font-mono text-xs">
                <Dim
                  icon={<FileText className="h-3.5 w-3.5 text-indigo-400" />}
                  title="1. Schema conformance"
                  status={selectedCertificate.dimensions?.schemaConformance?.status}
                  details={selectedCertificate.dimensions?.schemaConformance?.details}
                />
                <Dim
                  icon={<Gauge className="h-3.5 w-3.5 text-sky-400" />}
                  title="2. Latency vs. budget"
                  status={`${measured(selectedCertificate.dimensions?.slaLatency?.actualWallClockLatencyMs, ' ms')} / budget ${measured(
                    selectedCertificate.dimensions?.slaLatency?.budgetedMaxLatencyMs ?? selectedCertificate.dimensions?.slaLatency?.targetMaxLatencyMs,
                    ' ms'
                  )}`}
                  details={selectedCertificate.dimensions?.slaLatency?.details}
                />
                <Dim
                  icon={<Cpu className="h-3.5 w-3.5 text-amber-400" />}
                  title="3. Resource use (child process)"
                  status={`${selectedCertificate.dimensions?.resourceContainment?.runtimeObservation?.state ?? 'UNAVAILABLE'} · ${
                    hasNumber(selectedCertificate.dimensions?.resourceContainment?.memoryUsedBytes)
                      ? `${(selectedCertificate.dimensions.resourceContainment.memoryUsedBytes / 1024).toFixed(1)} KB`
                      : 'memory not measured'
                  }`}
                  details={selectedCertificate.dimensions?.resourceContainment?.details}
                />
                <Dim
                  icon={<Activity className="h-3.5 w-3.5 text-slate-300" />}
                  title="4. Runtime exit"
                  status={
                    selectedCertificate.dimensions?.runtimeExit
                      ? `exit ${selectedCertificate.dimensions.runtimeExit.exitCode ?? '?'} (${selectedCertificate.dimensions.runtimeExit.runtimeStatus ?? selectedCertificate.dimensions.runtimeExit.status ?? '?'})`
                      : 'not reported'
                  }
                  details={selectedCertificate.dimensions?.runtimeExit?.details}
                />
                <Dim
                  icon={<HelpCircle className="h-3.5 w-3.5 text-slate-400" />}
                  title="5. Hardware telemetry"
                  status="not implemented"
                  details="There is no external hardware verifier. Nothing in this prototype attests hardware or uptime."
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MERKLE TREE */}
      {activeTab === 'merkle_tree' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-2">
            <div>
              <h3 className="font-bold text-white text-base flex items-center space-x-2">
                <GitCommit className="h-5 w-5 text-indigo-400" />
                <span>Merkle tree over local records</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                An inclusion proof shows a leaf is part of this server's current local tree. The root is recomputed in your browser.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400 break-all">
              Root: <span className="text-slate-200 font-bold">{merkleTreeData?.merkleRoot ?? merkleTreeData?.root ?? 'not loaded'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-3">
              <span className="text-xs font-bold text-slate-300 uppercase font-mono block">Leaves ({evidenceRecords.length})</span>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {evidenceRecords.map((rec, idx) => (
                  <div
                    key={rec.id}
                    onClick={() => handleFetchMerkleProof(idx)}
                    className={`p-3 rounded-lg border transition cursor-pointer font-mono text-xs flex items-center justify-between ${
                      selectedMerkleLeafIndex === idx ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    <div>
                      <span className="font-bold block text-slate-200">
                        Leaf #{idx}: {rec.transactionId}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate max-w-[220px] block">{rec.merkleLeafHash}</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <span className="text-xs font-bold text-slate-200 uppercase font-mono flex items-center space-x-2">
                <Network className="h-4 w-4 text-indigo-400" />
                <span>Audit path (leaf #{selectedMerkleLeafIndex})</span>
              </span>

              {merkleProofResult ? (
                <div className="space-y-3 font-mono text-xs">
                  <Field k="LEAF HASH" v={merkleProofResult.leafHash ?? merkleProofResult.leaf} wide />
                  <Field k="ROOT HASH (from server)" v={merkleProofResult.merkleRoot ?? merkleProofResult.root} wide />
                  <div className="space-y-1.5">
                    <span className="text-slate-400 block text-[11px]">Sibling hashes:</span>
                    {(merkleProofResult.auditPath ?? merkleProofResult.proof ?? []).map((p: any, idx: number) => (
                      <div key={idx} className="p-2 bg-slate-900/80 rounded border border-slate-800/60 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-400 shrink-0">
                          Level {idx + 1} ({p.position}):
                        </span>
                        <span className="text-slate-300 break-all">{p.hash ?? p.siblingHash}</span>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`p-3 rounded-lg border flex items-center space-x-2 ${
                      browserInclusion === true
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : browserInclusion === false
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {browserInclusion === true ? <CheckCircle2 className="h-4 w-4" /> : browserInclusion === false ? <XCircle className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />}
                    <span>
                      {browserInclusion === 'pending'
                        ? 'Recomputing root in your browser…'
                        : browserInclusion === true
                          ? 'Recomputed in your browser: the audit path leads to the reported root.'
                          : browserInclusion === false
                            ? 'Recomputed in your browser: the audit path does NOT lead to the reported root.'
                            : 'Could not recompute in this browser (Web Crypto unavailable or malformed proof).'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs font-mono text-slate-500">
                  {browserInclusion === 'pending' ? 'Loading proof…' : 'Select a leaf to fetch its audit path.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: TAMPER CHECK */}
      {activeTab === 'action_verifier' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base flex items-center space-x-2">
                <Sliders className="h-5 w-5 text-amber-400" />
                <span>Tamper check</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Submit a modified payload and see the server's hash and HMAC check reject it. This tests the local signature, not any
                external ledger.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-300">Record</span>
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
                  <span className="text-xs font-mono text-slate-400">Payload to submit:</span>
                  <button
                    onClick={() => setTamperMode(!tamperMode)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold cursor-pointer transition border ${
                      tamperMode ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {tamperMode ? 'Tampered payload (sent)' : 'Original (stored hashes only)'}
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
                disabled={isVerifying || !selectedEvidence}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer transition disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>Run verification</span>
              </button>
              {verifyError && (
                <div className="p-2 rounded border border-rose-500/30 bg-rose-950/20 text-[11px] font-mono text-rose-300">{verifyError}</div>
              )}
            </div>

            <div className="lg:col-span-6">
              {verificationReport ? (
                <ReportView large />
              ) : (
                <div className="p-12 text-center text-slate-500 font-mono text-xs flex flex-col items-center justify-center space-y-3 bg-slate-950 rounded-xl border border-slate-800">
                  <ShieldCheck className="h-10 w-10 text-slate-600" />
                  <p className="text-slate-300 font-semibold">No verification run yet.</p>
                  <p className="text-slate-500 max-w-sm">Toggle the tampered payload, then run the verification.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2">
        <EvidenceBadge label="UNVERIFIED" /> records created on this server · <EvidenceBadge label="DEMO" /> seeded sample records
      </div>
    </div>
  );
};

const Field: React.FC<{ k: string; v: unknown; wide?: boolean }> = ({ k, v, wide }) => (
  <div className={`p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 ${wide ? 'md:col-span-2' : ''}`}>
    <span className="text-slate-500 block text-[10px]">{k}</span>
    <span className="text-slate-200 break-all text-[11px]">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
  </div>
);

const Dim: React.FC<{ icon: React.ReactNode; title: string; status?: string; details?: string }> = ({ icon, title, status, details }) => (
  <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="font-bold text-slate-200 flex items-center space-x-1.5">
        {icon}
        <span>{title}</span>
      </span>
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusTone(status)}`}>{status ?? 'not reported'}</span>
    </div>
    {details && <p className="text-[11px] text-slate-400">{details}</p>}
  </div>
);
