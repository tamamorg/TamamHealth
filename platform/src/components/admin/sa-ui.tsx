'use client';

/**
 * Super-admin command-center UI kit. Every page in the super-admin area
 * composes these primitives so tables, stat rails, and section chrome stay
 * identical across Command / Tenants / Operations / Business / Governance.
 * Dense, flat, operational: 12px-radius bordered cards, 10px uppercase
 * section labels, tabular numerals for metrics, semantic status dots.
 */

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';

/* Full-page scaffold with the super-admin role guard (defense-in-depth on
   top of the Edge proxy check — matches the existing /admin pages).
   No page title/subtitle band: every surface names itself in its own list
   header (EhrListHeader) or section rail, so the page opens straight on
   content instead of a header card that repeats the nav label. */
export function SaPage({
  actions,
  children,
}: {
  /** Page-level buttons; rendered as a right-aligned row above the content. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { currentUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (currentUser && currentUser.role !== 'super_admin') router.replace('/dashboard');
  }, [currentUser, router]);

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  return (
    <div className="page-container page-enter sa-page">
      {actions && <div className="sa-page-actions">{actions}</div>}
      {children}
    </div>
  );
}

/* Bordered card with an optional uppercase header row. */
export function SaCard({
  title,
  meta,
  actions,
  children,
  className = '',
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sa-card ${className}`.trim()}>
      {(title || actions || meta) && (
        <header className="sa-card-head">
          <span className="sa-card-title">{title}</span>
          {meta && <span className="sa-card-meta">{meta}</span>}
          {actions && <span className="sa-card-actions">{actions}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/* Semantic status dot + label (online/failed/pending...). */
export function SaStatusDot({ tone, label }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; label: string }) {
  return (
    <span className="sa-status" data-tone={tone}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

/* Toned pill for statuses/severities in tables. */
export function SaPill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; children: ReactNode }) {
  return <span className="sa-pill" data-tone={tone}>{children}</span>;
}

/* Dense table. Columns render as an uppercase header row; rows are plain
   <tr> children so pages keep full control of cells. */
/**
 * A column: a label, and optionally how much of the table's width it should
 * get relative to the others.
 *
 * `w` is a weight, not a size — 2 takes twice the room of 1. Widths are
 * resolved to percentages so the table stays fluid at any viewport.
 */
export type SaColumn = string | { label: string; w?: number };

const columnLabel = (c: SaColumn) => (typeof c === 'string' ? c : c.label);
const columnWeight = (c: SaColumn) => (typeof c === 'string' ? 1 : c.w ?? 1);

/**
 * Admin data table.
 *
 * `table-layout: fixed` is the point of this component. Auto layout sizes
 * columns from their content, which on a wide screen dumps every spare pixel
 * into whichever column happens to hold the longest string: the audit log
 * showed a 435px gap before Detail and a 120px one before Action, with an Org
 * column of em-dashes taking a full share. Fixed layout spends the width the
 * way the caller asked for it — equal by default, weighted where a column
 * genuinely holds a sentence rather than a chip.
 */
export function SaTable({
  columns,
  children,
  empty,
  minWidth,
}: {
  columns: SaColumn[];
  children: ReactNode;
  empty?: string;
  minWidth?: number;
}) {
  const hasRows = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  const weights = columns.map(columnWeight);
  const total = weights.reduce((sum, w) => sum + w, 0) || columns.length;
  return (
    <div className="sa-table-scroll">
      <table className="sa-table" style={minWidth ? { minWidth } : undefined}>
        <colgroup>
          {weights.map((w, i) => <col key={i} style={{ width: `${((w / total) * 100).toFixed(3)}%` }} />)}
        </colgroup>
        <thead>
          <tr>{columns.map((c, i) => <th key={`${columnLabel(c)}-${i}`}>{columnLabel(c)}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {!hasRows && <div className="sa-empty">{empty || 'Nothing to show yet.'}</div>}
    </div>
  );
}

/* Risk / severity helpers shared by the dashboard, Risk Center, and Audit
   pages so every surface classifies events identically. */
export type SaSeverity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_TONE: Record<SaSeverity, 'danger' | 'warn' | 'info' | 'muted'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'muted',
};

const HIGH_RISK_ACTION = /delete|purge|export|deactivate|suspend|password|role|permission|emergency|override|break/i;

export function classifyAuditRisk(action: string, success: boolean): SaSeverity {
  if (!success && HIGH_RISK_ACTION.test(action)) return 'critical';
  if (!success) return 'high';
  if (HIGH_RISK_ACTION.test(action)) return 'medium';
  return 'low';
}

export function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
