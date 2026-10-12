import React from 'react';

/**
 * Veklom evidence labels. Defined locally so the UI does not depend on
 * server-side type churn. Seed data = DEMO, locally created = UNVERIFIED.
 */
export type EvidenceLabel =
  | 'VERIFIED_LIVE'
  | 'VERIFIED_REPO'
  | 'CONFIGURED'
  | 'LAST_KNOWN'
  | 'TARGET'
  | 'UNVERIFIED'
  | 'DEMO'
  | 'ARCHIVED';

const STYLES: Record<EvidenceLabel, string> = {
  VERIFIED_LIVE: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  VERIFIED_REPO: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
  CONFIGURED: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  LAST_KNOWN: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  TARGET: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  UNVERIFIED: 'bg-slate-700/30 text-slate-300 border-slate-600/50',
  DEMO: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  ARCHIVED: 'bg-stone-700/30 text-stone-400 border-stone-600/40',
};

const DESCRIPTIONS: Record<EvidenceLabel, string> = {
  VERIFIED_LIVE: 'Observed live by this server from the configured peer',
  VERIFIED_REPO: 'Checked by code in this repository',
  CONFIGURED: 'Set by configuration; not independently verified',
  LAST_KNOWN: 'Last known value; may be stale',
  TARGET: 'Planned / target design; not implemented',
  UNVERIFIED: 'Created locally; nothing has verified it',
  DEMO: 'Sample data; not real and not proof of anything',
  ARCHIVED: 'Archived record',
};

const KNOWN = new Set<string>(Object.keys(STYLES));

export function isEvidenceLabel(v: unknown): v is EvidenceLabel {
  return typeof v === 'string' && KNOWN.has(v);
}

/** Read `evidenceLabel` from any record, with a fallback when absent. */
export function evidenceOf(record: unknown, fallback: EvidenceLabel = 'UNVERIFIED'): EvidenceLabel {
  const v = record && typeof record === 'object' ? (record as Record<string, unknown>).evidenceLabel : undefined;
  return isEvidenceLabel(v) ? v : fallback;
}

export const EvidenceBadge: React.FC<{ label?: string | null; fallback?: EvidenceLabel; className?: string; title?: string }> = ({
  label,
  fallback,
  className = '',
  title,
}) => {
  const l: EvidenceLabel = isEvidenceLabel(label) ? label : (fallback ?? 'UNVERIFIED');
  return (
    <span
      title={title ?? DESCRIPTIONS[l]}
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wide whitespace-nowrap ${STYLES[l]} ${className}`}
    >
      {l}
    </span>
  );
};

/** Badge for a record: uses its evidenceLabel, plus "not canonical" when canonical === false. */
export const RecordBadge: React.FC<{ record: unknown; fallback?: EvidenceLabel; className?: string }> = ({
  record,
  fallback,
  className = '',
}) => {
  const fb: EvidenceLabel = fallback ?? 'UNVERIFIED';
  const canonical = record && typeof record === 'object' ? (record as Record<string, unknown>).canonical : undefined;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <EvidenceBadge label={evidenceOf(record, fb)} />
      {canonical === false && (
        <span
          title="Local record, not issued by the canonical Veklom service"
          className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono bg-slate-800/60 text-slate-400 border-slate-700"
        >
          not canonical
        </span>
      )}
    </span>
  );
};

/** Strip for panels that are entirely sample data. */
export const DemoDataNote: React.FC<{ children?: React.ReactNode; label?: EvidenceLabel }> = ({ children, label }) => (
  <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-950/10 text-[11px] text-amber-200/90">
    <EvidenceBadge label={label ?? 'DEMO'} />
    <span className="leading-relaxed">{children ?? 'Sample data. Not measured, not real, not proof of anything.'}</span>
  </div>
);

/** Format a number that may be null/absent/NaN; never pretend 0 or NaN is a measurement. */
export function measured(value: unknown, unit = '', digits?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not measured';
  const s = digits === undefined ? String(value) : value.toFixed(digits);
  return unit ? `${s}${unit}` : s;
}

export function hasNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
