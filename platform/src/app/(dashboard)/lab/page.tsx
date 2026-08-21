'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatCompactDateTime } from '@/lib/format-utils';
import Modal from '@/components/Modal';
import PatientName from '@/components/PatientName';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { useRouter } from 'next/navigation';
import { FlaskConical, AlertTriangle, X, Plus, Radio, Filter, Download } from '@/components/icons/lucide';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import LabOrderModal from '@/components/lab/order/LabOrderModal';
import { LAB_WORKFLOW_STEP_LABEL, stepForStage } from '@/components/lab/workflow/lab-workflow-types';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { evaluateCritical } from '@/lib/services/lab-critical-flag';
import { matchAnalyzerResult, parseInstrumentPayload, type ParsedInstrumentResult } from '@/lib/services/instrument-intake-service';
import { usePatients } from '@/lib/hooks/usePatients';
import { useApp } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useRoleChoice, useRoleFlag } from '@/lib/settings/useRoleSetting';
import type { LabResultDoc } from '@/lib/db-types';
import Select from '@/components/Select';

// Human labels for the granular diagnostics lifecycle (Stage 6).
const ORDER_STAGE_LABEL: Record<LabOrderStatus, string> = {
  ordered: 'Ordered',
  specimen_collected: 'Specimen collected',
  received_at_lab: 'Received at lab',
  rejected_needs_recollection: 'Needs re-collection',
  in_process: 'In process',
  resulted: 'Resulted',
  reviewed_by_clinician: 'Reviewed',
  acted_upon: 'Acted upon',
  communicated_to_patient: 'Communicated',
};

// Derive the granular stage for an order, defaulting older orders from status.
function effOrderStatus(o: { orderStatus?: LabOrderStatus; status: 'pending' | 'in_progress' | 'completed' }): LabOrderStatus {
  if (o.orderStatus) return o.orderStatus;
  if (o.status === 'completed') return 'resulted';
  if (o.status === 'in_progress') return 'in_process';
  return 'ordered';
}





/**
 * The two order attributes the wizard captured and nothing ever read back.
 *
 * A send-out leaves the building and is worked by a different set of hands; a
 * future-dated draw is nobody's job until its date arrives. Both used to sit in
 * the queue indistinguishable from a routine in-house draw-now order, which is
 * the same as not recording them at all.
 */
function isOpenSendOut(o: LabResultDoc): boolean {
  return o.processing === 'send_out' && o.status !== 'completed';
}

/** A scheduled draw is "due" once its datetime has passed and it is still open. */
function isScheduledCollection(o: LabResultDoc): boolean {
  return o.collectionTiming === 'future'
    && !!o.scheduledCollectionAt
    && effOrderStatus(o) === 'ordered';
}

function isCollectionDue(o: LabResultDoc): boolean {
  return isScheduledCollection(o) && new Date(o.scheduledCollectionAt!).getTime() <= Date.now();
}

function fallbackAccessionNumber(order: Pick<LabResultDoc, '_id' | 'accessionNumber' | 'orderedAt'>): string {
  if (order.accessionNumber) return order.accessionNumber;
  const ordered = new Date(order.orderedAt || Date.now());
  const day = Number.isNaN(ordered.getTime())
    ? new Date().toISOString().slice(2, 10).replace(/-/g, '')
    : ordered.toISOString().slice(2, 10).replace(/-/g, '');
  return `ACC-${day}-${order._id.replace(/^lab-/, '').slice(0, 5).toUpperCase()}`;
}

export default function LabPage() {
  // Per-column filters (replace the old search + status-tabs top bar).
  const searchParams = useSearchParams();
  const [colFilters, setColFilters] = useState({ patient: '', test: '', specimen: '', status: '', result: '', orderedBy: '', worklist: '' });
  // Deep link from a patient chart: /lab?patient=<name> pre-filters the queue.
  useEffect(() => {
    const patientParam = searchParams?.get('patient');
    if (patientParam) setColFilters(f => ({ ...f, patient: patientParam }));
  }, [searchParams]);
  const setColFilter = (k: string, v: string) => setColFilters(f => ({ ...f, [k]: v }));
  const anyColFilter = Object.values(colFilters).some(Boolean);
  // Quick free-text search box in the table toolbar (in addition to the
  // existing per-column filter funnels below).
  const [quickSearch, setQuickSearch] = useState('');
  const anyFilterActive = anyColFilter || !!quickSearch;
  const clearColFilters = () => { setColFilters({ patient: '', test: '', specimen: '', status: '', result: '', orderedBy: '', worklist: '' }); setQuickSearch(''); };
  // Header "Filters" popover (test type + status) — mirrors the patients
  // registry's Filters dropdown pattern, separate from the per-column funnels.
  const [showHeaderFilters, setShowHeaderFilters] = useState(false);
  const headerFilterRef = useRef<HTMLDivElement>(null);
  const headerFilterCount = [colFilters.test, colFilters.status, colFilters.worklist].filter(Boolean).length;
  useEffect(() => {
    if (!showHeaderFilters) return;
    const onDown = (e: MouseEvent) => { if (headerFilterRef.current && !headerFilterRef.current.contains(e.target as Node)) setShowHeaderFilters(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowHeaderFilters(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showHeaderFilters]);
  const { globalSearch } = useApp();
  const { results: labResults, loading: labLoading, reload: reloadLabs } = useLabResults();
  const { patients } = usePatients();
  const patientById = useMemo(() => new Map(patients.map(patient => [patient._id, patient])), [patients]);
  const { canEnterLabResults, canOrderLabs } = usePermissions();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const { resultReviewSLA } = useSettings();
  // The technician's own worklist settings (design 11, "Worklist").
  const labSort = useRoleChoice('lab.sort', 'Urgency, then oldest');
  const labStatTop = useRoleFlag('lab.statTop', true);
  const labTatTarget = useRoleChoice('lab.tat', '60 min');
  // Analyzer import: paste a raw instrument payload (LIS-2A / HL7) and parse it
  // into structured results the tech can review before pre-filling an order.
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRaw, setImportRaw] = useState('');
  const [importParsed, setImportParsed] = useState<ParsedInstrumentResult[] | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importProtocol, setImportProtocol] = useState<'lis2a' | 'hl7' | 'unknown' | null>(null);

  const handleParseImport = () => {
    const out = parseInstrumentPayload(importRaw);
    setImportProtocol(out.protocol);
    setImportParsed(out.results);
    setImportWarnings(out.warnings);
  };

  const resetImport = () => {
    setShowImportModal(false);
    setImportRaw('');
    setImportParsed(null);
    setImportWarnings([]);
    setImportProtocol(null);
  };

  // Take one parsed analyzer reading to the bench workflow in the patient's
  // chart, with the value carried in the URL so the tech reviews and files it
  // there rather than in a popup. Never auto-saved.
  const openAnalyzerResult = (parsed: ParsedInstrumentResult) => {
    const value = parsed.numericValue != null ? String(parsed.numericValue) : (parsed.textValue || '');
    const match = matchAnalyzerResult(parsed, labResults);
    if (!match?.patientId) {
      showToast(t('labFlow.noMatchingOrder'), 'error');
      return;
    }
    // Name-only matches are a guess: two patients can be waiting on the same
    // test, and the tech is about to file a value against a chart. Say which
    // one, and on what basis, before they land there.
    if (!parsed.accession?.trim()) {
      showToast(t('labFlow.matchedByNameWarning', { patient: match.patientName || '—', test: match.testName || '—' }), 'error');
    }
    const params = new URLSearchParams({ tab: 'labs', focus: match._id, value });
    if (parsed.unit) params.set('unit', parsed.unit);
    if (parsed.referenceRange) params.set('range', parsed.referenceRange);
    resetImport();
    router.push(`/patients/${match.patientId}?${params.toString()}`);
  };

  // Create-order modal state
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Results back but not yet reviewed by a clinician past their SLA
  // (24h critical / 7 days routine) — surfaced so they can't sit unseen.
  // Computed before `filtered` because the worklist filter selects on it.
  const overdueReviews = labResults.filter(o => {
    if (effOrderStatus(o) !== 'resulted') return false;
    const resultedAt = new Date(o.updatedAt || o.createdAt || '').getTime();
    if (!Number.isFinite(resultedAt)) return false;
    const slaHours = o.critical ? resultReviewSLA.criticalHours : resultReviewSLA.routineHours;
    return (Date.now() - resultedAt) / 3_600_000 > slaHours;
  });
  // Rather than a banner above the table, the offending rows themselves glow
  // red in the list — the alert stays attached to the patient it's about.
  const overdueIds = new Set(overdueReviews.map(o => o._id));

  const filtered = labResults.filter(o => {
    const f = colFilters;
    if (globalSearch && !((o.patientName || '').toLowerCase().includes(globalSearch.toLowerCase()) || (o.testName || '').toLowerCase().includes(globalSearch.toLowerCase()))) return false;
    if (quickSearch && !`${o.patientName || ''} ${o.hospitalNumber || ''} ${o.testName || ''} ${o.orderedBy || ''}`.toLowerCase().includes(quickSearch.toLowerCase())) return false;
    if (f.patient && !`${o.patientName || ''} ${o.hospitalNumber || ''}`.toLowerCase().includes(f.patient.toLowerCase())) return false;
    if (f.test && !(o.testName || '').toLowerCase().includes(f.test.toLowerCase())) return false;
    if (f.specimen && !(o.specimen || '').toLowerCase().includes(f.specimen.toLowerCase())) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.result && !(o.result || '').toLowerCase().includes(f.result.toLowerCase())) return false;
    if (f.orderedBy && !(o.orderedBy || '').toLowerCase().includes(f.orderedBy.toLowerCase())) return false;
    if (f.worklist === 'send_out' && !isOpenSendOut(o)) return false;
    if (f.worklist === 'scheduled' && !isScheduledCollection(o)) return false;
    if (f.worklist === 'due' && !isCollectionDue(o)) return false;
    if (f.worklist === 'overdue_review' && !overdueIds.has(o._id)) return false;
    return true;
  });

  // Worklist order, per the technician's "Sort orders by" setting. Critical
  // orders are pinned above everything when "Show STAT orders at the top" is
  // on — that is what makes it a pin rather than just another sort key.
  const orderedAtMs = (o: LabResultDoc) =>
    new Date(o.orderedAt || o.createdAt || '').getTime() || 0;
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (labStatTop && a.critical !== b.critical) return a.critical ? -1 : 1;
    if (labSort === 'Newest first') return orderedAtMs(b) - orderedAtMs(a);
    if (labSort === 'Oldest first') return orderedAtMs(a) - orderedAtMs(b);
    // 'Urgency, then oldest'
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return orderedAtMs(a) - orderedAtMs(b);
  });

  // Turnaround target: a still-open order past it is running late. Separate
  // from `overdueReviews`, which is about a RESULT nobody has looked at.
  const tatMinutes = Number(/^(\d+)/.exec(labTatTarget)?.[1] ?? 60);
  const overTatIds = new Set(
    sortedFiltered
      .filter(o => o.status !== 'completed'
        && (Date.now() - orderedAtMs(o)) / 60_000 > tatMinutes
        && orderedAtMs(o) > 0)
      .map(o => o._id),
  );

  // KPI stat cards — scoped to the full lab queue (not narrowed by the table's
  // own filters, so the header numbers stay a stable "whole queue" summary).
  const labStats = {
    total: labResults.length,
    pending: labResults.filter(o => o.status === 'pending').length,
    inProgress: labResults.filter(o => o.status === 'in_progress').length,
    completed: labResults.filter(o => o.status === 'completed').length,
    critical: labResults.filter(o => o.critical).length,
    awaiting: labResults.filter(o => o.status === 'pending' || o.status === 'in_progress').length,
    // Work that leaves the building, and draws that are already due. Both were
    // recorded on the order and then invisible.
    sendOut: labResults.filter(isOpenSendOut).length,
    collectionDue: labResults.filter(isCollectionDue).length,
  };

  // Distinct test names present in the queue, for the header's "test type" filter.
  const testTypeOptions = Array.from(new Set(labResults.map(o => o.testName).filter(Boolean))).sort();

  // Export the currently filtered/visible orders to CSV.
  const handleDownloadCsv = () => {
    const header = ['Patient', 'Hospital number', 'Test', 'Specimen', 'Status', 'Result', 'Ordered by', 'Ordered at', 'Completed at'];
    const rows = sortedFiltered.map(o => [
      o.patientName || '',
      o.hospitalNumber || '',
      o.testName || '',
      o.specimen || '',
      ORDER_STAGE_LABEL[effOrderStatus(o)],
      o.result || '',
      o.orderedBy || '',
      o.orderedAt || '',
      o.completedAt || '',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lab-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Column config — plain labels; filtering lives in the header search +
  // Filters popover (matching the patients registry), not per-column funnels.
  // Field style for the selects inside the header's Filters popover (mirrors
  // the patients registry's Filters panel fields).
  const popoverFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;
  // `width` is a share, not a percentage — it is normalised against the row's
  // own total below, so the two shapes of this table (with and without the
  // Action column) each add up without a second set of numbers. Sized to the
  // content each column actually carries: Result holds a short value plus an
  // "Abnormal" chip, not the widest column on the page, while Time needs a
  // full "2026-07-28 12:11" on one line.
  const labCols: { key: string; label: string; width: number }[] = [
    { key: 'patient', label: t('lab.patient'), width: 19 },
    { key: 'test', label: t('lab.testName'), width: 19 },
    { key: 'specimen', label: t('lab.specimen'), width: 10 },
    { key: 'status', label: t('lab.status'), width: 11 },
    { key: 'result', label: t('lab.result'), width: 14 },
    { key: 'orderedBy', label: t('lab.orderedByLabel'), width: 13 },
    // Wide enough for "Aug 27 · 03:42 PM" plus the "Done:" line beneath it.
    { key: 'time', label: t('lab.time'), width: 14 },
    ...(canEnterLabResults ? [{ key: 'action', label: t('lab.action'), width: 14 }] : []),
  ];
  const labColTotal = labCols.reduce((sum, c) => sum + c.width, 0);

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {labLoading && (
            <div className="card-elevated p-4 mb-4 flex items-center gap-3" style={{ background: 'var(--overlay-subtle)' }}>
              <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('lab.loadingOrders')}</span>
            </div>
          )}

          {/* Lab Orders Table */}
          <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            <EhrListHeader
              title={t('lab.laboratory')}
              stats={[
                { label: 'Orders', value: labStats.total, color: LIST_STAT_COLORS.muted },
                { label: 'Pending', value: labStats.pending, color: LIST_STAT_COLORS.blue },
                { label: 'In progress', value: labStats.inProgress, color: LIST_STAT_COLORS.amber },
                { label: 'Completed', value: labStats.completed, color: LIST_STAT_COLORS.green },
                { label: 'Critical', value: labStats.critical, color: LIST_STAT_COLORS.bronze },
                // Only shown when there is something to act on — a lab that
                // never sends out should not carry a permanent "Send-outs 0".
                ...(labStats.sendOut > 0 ? [{ label: 'Send-outs', value: labStats.sendOut, color: LIST_STAT_COLORS.muted }] : []),
                ...(labStats.collectionDue > 0 ? [{ label: 'Draws due', value: labStats.collectionDue, color: LIST_STAT_COLORS.amber }] : []),
              ]}
              search={{ value: quickSearch, onChange: setQuickSearch, placeholder: 'Filter table', ariaLabel: 'Filter table' }}
              actions={
                <>
                  {/* data-tour: the guided tour spotlights this filter trigger
                      to introduce the registry's own worklists (draws due,
                      scheduled, send-outs, overdue review) — EhrListHeaderButton
                      doesn't forward a data-tour prop, so it's tagged here on
                      its existing wrapper instead of adding a new element. */}
                  <div className="relative" ref={headerFilterRef} data-tour="lab-registry-filters">
                    <EhrListHeaderButton
                      onClick={() => setShowHeaderFilters(s => !s)}
                      active={headerFilterCount > 0}
                      ariaExpanded={showHeaderFilters}
                      ariaLabel={t('patients.filtersTitle')}
                    >
                      <Filter className="w-4 h-4" />
                      {headerFilterCount > 0 && (
                        <span className="absolute inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold" style={{ top: -4, right: -4, background: 'var(--accent-primary)', color: '#fff' }}>
                          {headerFilterCount}
                        </span>
                      )}
                    </EhrListHeaderButton>
                    {showHeaderFilters && (
                      <div
                        className="absolute end-0 mt-2 rounded-2xl overflow-hidden z-50"
                        style={{ width: 'min(92vw, 420px)', background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg, 0 16px 48px rgba(0,0,0,0.2))' }}
                      >
                        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('patients.filtersTitle')}</span>
                          <div className="flex items-center gap-2">
                            {headerFilterCount > 0 && (
                              <button type="button" onClick={() => { setColFilter('test', ''); setColFilter('status', ''); setColFilter('worklist', ''); }} className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('nurse.clearAllFilters')}</button>
                            )}
                            <button type="button" onClick={() => setShowHeaderFilters(false)} className="p-1 rounded hover:bg-[var(--overlay-subtle)]" aria-label={t('action.close')}>
                              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                            </button>
                          </div>
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('lab.testName')}</span>
                            <Select value={colFilters.test} onChange={e => setColFilter('test', e.target.value)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                              <option value="">{t('patients.all')}</option>
                              {testTypeOptions.map(name => <option key={name} value={name}>{name}</option>)}
                            </Select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('lab.status')}</span>
                            <Select value={colFilters.status} onChange={e => setColFilter('status', e.target.value)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                              <option value="">{t('patients.all')}</option>
                              <option value="pending">{t('lab.filterPending')}</option>
                              <option value="in_progress">{t('lab.inProgress')}</option>
                              <option value="completed">{t('referral.completed')}</option>
                            </Select>
                          </label>
                          {/* The queue's own worklists — the same table, narrowed
                              to one job, rather than four separate screens. */}
                          <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('lab.worklist')}</span>
                            <Select value={colFilters.worklist} onChange={e => setColFilter('worklist', e.target.value)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                              <option value="">{t('lab.worklistAll')}</option>
                              <option value="due">{t('lab.worklistDue')}</option>
                              <option value="scheduled">{t('lab.worklistScheduled')}</option>
                              <option value="send_out">{t('lab.worklistSendOut')}</option>
                              <option value="overdue_review">{t('lab.worklistOverdueReview')}</option>
                            </Select>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                  {anyFilterActive && (
                    <EhrListHeaderButton onClick={clearColFilters} ariaLabel={t('nurse.clearAllFilters')}>
                      <X className="w-4 h-4" />
                    </EhrListHeaderButton>
                  )}
                  <EhrListHeaderButton onClick={handleDownloadCsv} ariaLabel="Download">
                    <Download className="w-4 h-4" />
                  </EhrListHeaderButton>
                  {canEnterLabResults && (
                    <EhrListHeaderButton onClick={() => setShowImportModal(true)} ariaLabel="Import from analyzer">
                      <Radio className="w-4 h-4" />
                    </EhrListHeaderButton>
                  )}
                  {canOrderLabs && (
                    <button onClick={() => setShowOrderModal(true)} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap' }}>
                      <Plus className="w-4 h-4" /> {t('lab.newOrder')}
                    </button>
                  )}
                </>
              }
            />
            {/* `ehr-list-scroll` carries the shared worklist row language (the
                appointments board's card rows, 16px gutter, sticky quiet
                header) so this queue looks the same as every other module. */}
          <div className="ehr-list-scroll">
            {/* `table-layout: fixed` is what makes the colgroup binding: without
                it the browser re-sizes from content and Result swallows the row. */}
            <table className="data-table" style={{ minWidth: 1040, tableLayout: 'fixed' }}>
              <colgroup>
                {labCols.map(c => (
                  <col key={c.key} style={{ width: `${(c.width / labColTotal * 100).toFixed(2)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {labCols.map(c => (
                    <th key={c.key} className={c.key === 'action' ? 'is-right' : undefined}>
                      <span className="whitespace-nowrap">{c.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map(order => {
                  // Two different lateness signals: a result nobody has
                  // reviewed past its SLA, and an open order past this
                  // technician's turnaround target.
                  const overdue = overdueIds.has(order._id) || overTatIds.has(order._id);
                  return (
                  <tr
                    key={order._id}
                    className={`cursor-pointer${overdue ? ' is-danger' : ''}`}
                    onClick={() => { if (order.patientId) router.push(`/patients/${order.patientId}?tab=labs&focus=${order._id}`); }}
                  >
                    <td>
                      <PatientName
                        patient={patientById.get(order.patientId)}
                        patientId={order.patientId}
                        name={order.patientName}
                        showAvatar
                        size={40}
                        secondaryText={order.hospitalNumber || 'ID not recorded'}
                        nameClassName="text-sm"
                      />
                      {overdue && (
                        <p className="text-[10px] font-semibold flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-danger-text)' }}>
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          {order.critical ? 'Critical — review overdue' : 'Review overdue'}
                        </p>
                      )}
                    </td>
                    <td className="font-semibold text-sm">
                      {order.testName}
                      {order.tier && (
                        <Badge tone={order.tier === 'special' ? 'accent' : 'neutral'} uppercase className="ms-2 align-middle">{order.tier}</Badge>
                      )}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div>{order.specimen}</div>
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {order.accessionNumber || fallbackAccessionNumber(order)}
                      </div>
                      {order.specimenRejectionReason && (
                        <Badge tone="danger" className="mt-1">{order.specimenRejectionReason}</Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={order.status === 'pending' ? 'warning' : order.status === 'in_progress' ? 'info' : 'neutral'}>
                        {ORDER_STAGE_LABEL[effOrderStatus(order)]}
                      </Badge>
                    </td>
                    <td>
                      {order.result ? (
                        <div>
                          <p className="text-sm" style={{ color: order.abnormal ? 'var(--color-danger-text)' : 'inherit', fontWeight: order.abnormal ? 600 : 400 }}>{order.result}</p>
                          {order.abnormal && <Badge tone="danger" className="mt-0.5">{t('lab.abnormal')}</Badge>}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{order.orderedBy}</td>
                    {/* Compact "Aug 27 · 19:42", not the raw ISO stamp: the
                        stamp wrapped onto three lines and made every resulted
                        row twice the height of an ordered one, which is the
                        ragged rhythm the appointments board doesn't have. */}
                    <td>
                      <div className="ehr-list-main">
                        <strong>{formatCompactDateTime(order.orderedAt)}</strong>
                        {order.completedAt && (
                          <small>{t('lab.donePrefix', { time: formatCompactDateTime(order.completedAt) })}</small>
                        )}
                      </div>
                    </td>
                    {canEnterLabResults && (
                      <td className="is-right" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          // Lab work happens in the chart, not in a popup: the
                          // technician needs the patient around the result
                          // (allergies, problems, the rest of the panel), and
                          // the six bench steps live there. This column just
                          // names the next step and links straight to it.
                          const step = stepForStage(effOrderStatus(order));
                          const openWorkflow = () => {
                            if (!order.patientId) return;
                            router.push(`/patients/${order.patientId}?tab=labs&focus=${order._id}`);
                          };
                          return (
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ padding: '4px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                              onClick={openWorkflow}
                              disabled={!order.patientId}
                            >
                              {t(LAB_WORKFLOW_STEP_LABEL[step])}
                            </button>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {!labLoading && sortedFiltered.length === 0 && (
              <EmptyState
                icon={FlaskConical}
                title={t('lab.noPendingOrders')}
                message={anyFilterActive ? t('lab.noPatientsMatch') : t('lab.infoSystemSubtitle')}
              />
            )}
            </div>
          </div>

          {/* Import from Analyzer Modal */}
          {showImportModal && (
            <Modal onClose={resetImport}>
              <div className="modal-content card-elevated p-6 max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Radio className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                    <h3 className="text-base font-semibold">Import from analyzer</h3>
                  </div>
                  <button onClick={resetImport} aria-label="Close" className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Paste a raw instrument result message (LIS-2A / ASTM or HL7 ORU^R01). Parsed results are shown for review — nothing is saved automatically.
                </p>
                <textarea
                  rows={6}
                  value={importRaw}
                  onChange={e => setImportRaw(e.target.value)}
                  placeholder={'H|\\^&|||Sysmex^XN-330|...\nO|1|ACC-7788|...\nR|1|^^^HGB^Hemoglobin|9.8|g/dL|...'}
                  className="w-full p-2.5 rounded-lg outline-none text-xs font-mono"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={handleParseImport} className="btn btn-primary btn-sm" disabled={!importRaw.trim()} style={{ opacity: importRaw.trim() ? 1 : 0.5 }}>
                    Parse payload
                  </button>
                  {importProtocol && (
                    <span className="text-[11px] font-mono px-2 py-1 rounded" style={{
                      background: importProtocol === 'unknown' ? 'rgba(224, 49, 39,0.1)' : 'var(--accent-light)',
                      color: importProtocol === 'unknown' ? 'var(--color-danger-text)' : 'var(--accent-primary)',
                    }}>
                      protocol: {importProtocol}
                    </span>
                  )}
                </div>

                {importWarnings.length > 0 && (
                  <div className="mt-3 p-2.5 rounded-lg" style={{ background: 'rgba(224, 49, 39,0.06)', border: '1px solid var(--color-danger)' }}>
                    {importWarnings.map((w, i) => (
                      <p key={i} className="text-[11px]" style={{ color: 'var(--color-danger-text)' }}>{w}</p>
                    ))}
                  </div>
                )}

                {importParsed && importParsed.length > 0 && (
                  <div className="mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
                    <div className="overflow-x-auto">
                    <table className="data-table" style={{ minWidth: 720 }}>
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Value</th>
                          <th>Unit</th>
                          <th>Ref</th>
                          <th>Flag</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {importParsed.map((p, i) => {
                          const value = p.numericValue != null ? String(p.numericValue) : (p.textValue || '');
                          const crit = evaluateCritical(p.testName, value);
                          return (
                            <tr key={`${p.testCode}-${i}`}>
                              <td className="text-sm font-semibold">{p.testName || p.testCode}</td>
                              <td className="text-sm" style={{ color: crit.isCriticalValue ? 'var(--color-danger-text)' : 'inherit', fontWeight: crit.isCriticalValue ? 700 : 600 }}>{value}</td>
                              <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.unit || '—'}</td>
                              <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.referenceRange || '—'}</td>
                              <td>
                                {crit.isCriticalValue ? (
                                  <Badge tone="danger" uppercase>CRITICAL</Badge>
                                ) : p.abnormalFlag && p.abnormalFlag.toUpperCase() !== 'N' ? (
                                  <Badge tone="warning">{p.abnormalFlag}</Badge>
                                ) : (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                <button className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                                  onClick={() => openAnalyzerResult(p)}>
                                  Review &amp; enter
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {importParsed && importParsed.length === 0 && importProtocol !== 'unknown' && (
                  <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>No results found in the payload.</p>
                )}
              </div>
            </Modal>
          )}

          {/* Create Lab Order — compact dialog → six-step requisition wizard. */}
          {showOrderModal && (
            <LabOrderModal
              onClose={() => setShowOrderModal(false)}
              onPlaced={() => { void reloadLabs(); }}
            />
          )}
      </main>
    </>
  );
}
