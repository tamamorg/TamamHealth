'use client';

import type { LucideIcon } from '@/components/icons/lucide';

/* ─── Row-detail panel pieces (inline expansion) ───
   The queue row's popup used to be a Modal; it now drops open in place under
   the row (EhrCareDashboard's shared inline-expansion shell). These three
   pieces reproduce that popup's shape without the dialog chrome: an icon
   action line matching the doctor worklist's ehr-visit-pop-* classes, a
   label/value fact grid for what the row itself doesn't already show, and —
   for triage-sourced rows — the exam-room control. */

// Icon actions on the panel's first line (Open chart / Check in / Assign /
// etc.), reusing EhrVisitPopup's classes so every role's inline panel reads
// the same way. No tabs here — front desk has one view per row — so the
// "tabs" row is just the flex/border-bottom line the icons sit on.
export function FrontDeskDetailActions({ actions }: {
  actions: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }[];
}) {
  return (
    <div className="ehr-visit-pop-tabs">
      <div className="ehr-visit-pop-actions">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            className={`ehr-visit-pop-icon${action.primary ? ' is-primary' : ''}`}
            onClick={action.onClick}
            aria-label={action.label}
            title={action.label}
          >
            <action.icon className="w-4 h-4" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

// Label/value facts unique to this row — never the name/time/status the row
// above already shows. Empty values are dropped rather than rendered blank.
export function FrontDeskDetailFacts({ facts }: { facts: { label: string; value?: string }[] }) {
  const visible = facts.filter((f): f is { label: string; value: string } => Boolean(f.value));
  if (visible.length === 0) return null;
  return (
    <div className="ehr-row-detail__body">
      {visible.map(f => (
        <div className="appointment-detail-row" key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </div>
  );
}

export function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 78 }}>{label}</span>
      <span className="text-[12px] truncate" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
