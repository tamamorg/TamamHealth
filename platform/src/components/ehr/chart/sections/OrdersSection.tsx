'use client';

/**
 * Orders tab content — a UNIFIED orders table merging this patient's drug
 * orders (usePrescriptions) and lab orders (useLabResults), matching the
 * Tamam Orders screenshot columns. "Add" reuses the same
 * PrescribeModal/OrderLabModal triggers as the Medications/Results tabs and
 * the Order Basket drawer panel — no new order-creation flow.
 */

import { useEffect, useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import { Pill, FlaskConical } from '@/components/icons/lucide';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { formatDate , formatRxSig , humanizeStatus } from '@/lib/format-utils';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import Select from '@/components/Select';

const PAGE_SIZE = 10;

type OrderTypeFilter = 'all' | 'drug' | 'lab';

interface UnifiedOrderRow {
  id: string;
  orderNumber: string;
  date: string;
  orderType: 'Drug order' | 'Lab order' | 'Imaging order';
  description: string;
  priority: 'STAT' | 'Routine';
  orderedBy: string;
  status: string;
}

/** Defensive sort key: an invalid/missing date sorts as oldest (0) rather
 *  than winning a lexicographic string comparison it has no business in. */
const ts = (x?: string): number => {
  const t = new Date(x || '').getTime();
  return Number.isFinite(t) ? t : 0;
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'tamam-panel-badge tamam-panel-badge--pending',
  in_progress: 'tamam-panel-badge tamam-panel-badge--active',
  dispensed: 'tamam-panel-badge tamam-panel-badge--done',
  completed: 'tamam-panel-badge tamam-panel-badge--done',
  discontinued: 'tamam-panel-badge tamam-panel-badge--muted',
};

interface OrdersSectionProps {
  patientId: string;
  canPrescribe: boolean;
  canOrderLabs: boolean;
  onAddDrug: () => void;
  onAddLab: () => void;
  /** When set (e.g. deep-linked from elsewhere in the chart), the row with
   *  this order `_id` is paged-to, scrolled into view and highlighted. */
  focusId?: string;
}

export default function OrdersSection({ patientId, canPrescribe, canOrderLabs, onAddDrug, onAddLab, focusId }: OrdersSectionProps) {
  const { prescriptions } = usePrescriptions(patientId);
  const { results } = useLabResults(patientId);
  const [typeFilter, setTypeFilter] = useState<OrderTypeFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const rows = useMemo<UnifiedOrderRow[]>(() => {
    const drugRows: UnifiedOrderRow[] = (prescriptions || [])
      .map(rx => ({
        id: rx._id,
        orderNumber: `ORD-${rx._id.slice(-6).toUpperCase()}`,
        date: rx.createdAt,
        orderType: 'Drug order',
        description: `${rx.medication} · ${formatRxSig(rx)}`,
        priority: rx.urgency === 'immediate' ? 'STAT' : 'Routine',
        orderedBy: rx.prescribedBy || '—',
        status: rx.status,
      }));
    const labRows: UnifiedOrderRow[] = (results || [])
      .map(l => ({
        id: l._id,
        orderNumber: `ORD-${l._id.slice(-6).toUpperCase()}`,
        date: l.orderedAt || l.createdAt,
        // orderKind is the authoritative discriminator; isImagingStudy is a
        // specimen/testName heuristic for legacy docs written before it existed.
        orderType: l.orderKind === 'imaging' || (!l.orderKind && isImagingStudy(l)) ? 'Imaging order' : 'Lab order',
        description: l.testName,
        priority: 'Routine',
        orderedBy: l.orderedBy || '—',
        status: l.status,
      }));
    return [...drugRows, ...labRows].sort((a, b) => ts(b.date) - ts(a.date));
  }, [prescriptions, results]);

  const filtered = useMemo(() => {
    let list = rows;
    if (typeFilter === 'drug') list = list.filter(r => r.orderType === 'Drug order');
    if (typeFilter === 'lab') list = list.filter(r => r.orderType === 'Lab order' || r.orderType === 'Imaging order');
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.description.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q));
    return list;
  }, [rows, typeFilter, search]);

  // Deep-link focus: jump to the page holding the focused order once the
  // data loads, then scroll it into view and let the highlight draw attention.
  useEffect(() => {
    if (!focusId) return;
    const idx = filtered.findIndex(r => r.id === focusId);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [focusId, filtered]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`order-row-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, page]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canAdd = canPrescribe || canOrderLabs;

  const filterSlot = (
    <label className="tamam-section-filter">
      <span className="tamam-filter-caption">Order type:</span>
      <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value as OrderTypeFilter); setPage(1); }}>
        <option value="all">All</option>
        <option value="drug">Drug</option>
        <option value="lab">Lab</option>
      </Select>
    </label>
  );

  return (
    <ChartSection
      title="Orders"
      addLabel="Add"
      onAdd={canAdd ? () => setAddMenuOpen(v => !v) : undefined}
      filterSlot={filterSlot}
      searchValue={search}
      onSearchChange={value => { setSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }}
    >
      {canAdd && addMenuOpen && (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', right: 0, top: -6, zIndex: 20 }} className="tamam-actions-menu" role="menu">
            {canPrescribe && (
              <button type="button" onClick={() => { setAddMenuOpen(false); onAddDrug(); }}><Pill /> Drug order</button>
            )}
            {canOrderLabs && (
              <button type="button" onClick={() => { setAddMenuOpen(false); onAddLab(); }}><FlaskConical /> Lab order</button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <OmrsEmptyState
          itemLabel="orders"
          actionLabel="Record orders"
          onAction={canAdd ? () => setAddMenuOpen(true) : undefined}
          disabledReason={canAdd ? undefined : 'Requires prescribing or lab-ordering permission'}
        />
      ) : (
        <table className="tamam-table tamam-table--fixed">
          <colgroup>
            <col /><col /><col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Order number</th>
              <th>Date of order</th>
              <th>Order type</th>
              <th>Order</th>
              <th>Priority</th>
              <th>Ordered by</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <tr
                key={r.id}
                id={`order-row-${r.id}`}
                style={r.id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : undefined}
              >
                <td className="font-mono" style={{ fontSize: 11 }}>{r.orderNumber}</td>
                <td>{formatDate(r.date)}</td>
                <td>{r.orderType}</td>
                <td>{r.description}</td>
                <td>
                  <span className={r.priority === 'STAT' ? 'tamam-panel-badge tamam-panel-badge--pending' : 'tamam-panel-badge tamam-panel-badge--muted'}>
                    {r.priority}
                  </span>
                </td>
                <td>{r.orderedBy}</td>
                <td><span className={STATUS_BADGE[r.status] || 'tamam-panel-badge tamam-panel-badge--active'}>{humanizeStatus(r.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartSection>
  );
}
