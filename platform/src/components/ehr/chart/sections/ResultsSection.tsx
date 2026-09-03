'use client';

/**
 * Results tab content — Tamam-style lab results table. Reads from the same
 * `useLabResults()` collection the Order Basket drawer panel and
 * OrderLabModal already write to (switched from the legacy per-visit
 * `record.labResults` embed so newly-ordered labs actually show up here).
 * "Add" opens the shared Create Lab Order flow via the page's
 * `setShowOrderLabModal`. Picking a row hands off to the bench workflow panel
 * (LabWorkspace) — the same six steps the lab queue links into — so a result
 * is worked on in the chart rather than in a popup.
 */

import { useEffect, useMemo, useState } from 'react';
import { Icon as DuotoneIcon } from '@/components/icons';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { formatDate , humanizeStatus } from '@/lib/format-utils';
import { effectiveOrderStatus } from '@/lib/services/lab-service';
import { LAB_WORKFLOW_STEP_LABEL, stepForStage } from '@/components/lab/workflow/lab-workflow-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { clickable } from '@/lib/a11y';

const PAGE_SIZE = 8;

const STATUS_BADGE: Record<string, string> = {
  pending: 'tamam-panel-badge tamam-panel-badge--pending',
  in_progress: 'tamam-panel-badge tamam-panel-badge--active',
  completed: 'tamam-panel-badge tamam-panel-badge--done',
};

/** Defensive sort key: an invalid/missing date sorts as oldest (0) rather
 *  than winning a lexicographic string comparison it has no business in. */
const ts = (x?: string): number => {
  const t = new Date(x || '').getTime();
  return Number.isFinite(t) ? t : 0;
};

interface ResultsSectionProps {
  patientId: string;
  canOrderLabs: boolean;
  onAdd: () => void;
  /** When set (e.g. deep-linked from the lab queue), the row with this result
   *  `_id` is paged-to, scrolled into view and highlighted. */
  focusId?: string;
  /** Open one order in the bench workflow panel. */
  onSelect?: (labId: string) => void;
}

export default function ResultsSection({ patientId, canOrderLabs, onAdd, focusId, onSelect }: ResultsSectionProps) {
  const { results } = useLabResults(patientId);
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const patientLabs = useMemo(
    () => (results || [])
      .filter(l => l.patientId === patientId)
      .sort((a, b) => ts(b.orderedAt || b.createdAt) - ts(a.orderedAt || a.createdAt)),
    [results, patientId],
  );
  const filteredLabs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? patientLabs.filter(l => `${l.testName} ${l.result || ''} ${l.referenceRange || ''} ${l.status}`.toLowerCase().includes(query)) : patientLabs;
  }, [patientLabs, search]);

  // Deep-link focus: jump to the page holding the focused result once the data
  // loads, then scroll it into view and let the highlight draw attention.
  useEffect(() => {
    if (!focusId) return;
    const idx = patientLabs.findIndex(l => l._id === focusId);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [focusId, patientLabs]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`lab-row-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, page]);

  const pageRows = filteredLabs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <ChartSection
      title="Results"
      // The same flask the patient header's "Order labs" carries: this button
      // opens that identical flow, so it should read as the same action rather
      // than as a generic "add a row".
      addLabel="Order labs"
      addIcon={<DuotoneIcon name="flask" size={15} />}
      onAdd={canOrderLabs ? onAdd : undefined}
      searchValue={search}
      onSearchChange={value => { setSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filteredLabs.length, onPageChange: setPage }}
    >
      {patientLabs.length === 0 ? (
        <OmrsEmptyState itemLabel="results" actionLabel="Record results" onAction={canOrderLabs ? onAdd : undefined} disabledReason={canOrderLabs ? undefined : 'Requires lab-ordering permission'} />
      ) : (
        <table className="tamam-table tamam-table--fixed tamam-table--interactive">
          <colgroup>
            <col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Reference range</th>
              <th>Next step</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(l => (
              <tr
                key={l._id}
                id={`lab-row-${l._id}`}
                {...(onSelect ? clickable(() => onSelect(l._id), { label: `Open result — ${l.testName}` }) : {})}
                className={onSelect ? 'tamam-clickable-row' : undefined}
                style={{
                  ...(l._id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : {}),
                }}
              >
                <td style={{ fontWeight: 600 }}>{l.testName}</td>
                <td style={{ color: l.abnormal ? (l.critical ? 'var(--color-danger-text)' : 'var(--color-warning-text)') : 'inherit', fontWeight: l.abnormal ? 700 : 400 }}>
                  {l.result || '—'}{l.unit ? ` ${l.unit}` : ''}
                </td>
                <td>{l.referenceRange || '—'}</td>
                <td>{t(LAB_WORKFLOW_STEP_LABEL[stepForStage(effectiveOrderStatus(l))])}</td>
                <td>{formatDate(l.completedAt || l.orderedAt || l.createdAt)}</td>
                <td><span className={STATUS_BADGE[l.status] || 'tamam-panel-badge tamam-panel-badge--pending'}>{humanizeStatus(l.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartSection>
  );
}
