import React from 'react';

/**
 * Evidence label reported by the server on a record. Only two labels carry a
 * claim this UI explains; any other value is shown verbatim in a neutral chip.
 */
const KNOWN: Record<string, { style: string; title: string }> = {
  VERIFIED_LIVE: {
    style: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    title: 'Returned live by the Veklom service named on this record',
  },
  VERIFIED_REPO: {
    style: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
    title: 'Checked just now by code shipped in this repository',
  },
};

export const EvidenceBadge: React.FC<{ label?: string | null; className?: string }> = ({ label, className = '' }) => {
  if (!label) return null;
  const k = KNOWN[label];
  return (
    <span
      title={k?.title ?? 'Label reported by the server'}
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wide whitespace-nowrap ${
        k?.style ?? 'bg-slate-800/60 text-slate-300 border-slate-700'
      } ${className}`}
    >
      {label}
    </span>
  );
};
