'use client';

import { useState, useEffect, useMemo } from 'react';
import TableCols from '@/components/TableCols';
import { useSearchParams } from 'next/navigation';
import { formatCompactDateTime } from '@/lib/format-utils';
import Modal from '@/components/Modal';
import Link from 'next/link';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { patientAgeLabel } from '@/lib/patient-utils';
import Badge from '@/components/Badge';
import { useRouter } from 'next/navigation';
import { X, Plus, Radio } from '@/components/icons/lucide';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import LabOrderModal from '@/components/lab/order/LabOrderModal';
import { LAB_WORKFLOW_STEP_LABEL, stepForStage } from '@/components/lab/workflow/lab-workflow-types';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { evaluateCritical } from '@/lib/services/lab-critical-flag';
import { matchAnalyzerResult, parseInstrumentPayload, type ParsedInstrumentResult } from '@/lib/services/instrument-intake-service';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUi } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabOrderStatus } from '@/lib/clinical-flow/order-lifecycles';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useRoleChoice, useRoleFlag } from '@/lib/settings/useRoleSetting';
import type { LabResultDoc } from '@/lib/db-types';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';
import { useNow } from '@/lib/hooks/useNow';

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

/* The registry/appointments pill vocabulary mapped onto the bench ladder:
   waiting stages read calm blue, active stages read active, a result awaiting
   review takes the attention amber, closed stages go green, rejection red. */
const STAGE_PILL_CLASS: Record<LabOrderStatus, string> = {
  ordered: 'status-scheduled',
  specimen_collected: 'status-checked-in',
  received_at_lab: 'status-checked-in',
  rejected_needs_recollection: 'status-cancelled',
  in_process: 'status-in-progress',
  resulted: 'status-arrived',
  reviewed_by_clinician: 'status-completed',
  acted_upon: 'status-completed',
  communicated_to_patient: 'status-completed',
};

/* The timestamp that belongs to the stage the status pill names — when the
   order last changed state. `ordered` has no entry on purpose: the order time
   lives under the ordering clinician, and arriving in the queue is not a
   change. Stages whose moment was never stamped show no time rather than a
   borrowed one. */
const STAGE_CHANGED_AT: Partial<Record<LabOrderStatus, (o: LabResultDoc) => string | undefined>> = {
  specimen_collected: o => o.specimenCollectedAt,
  received_at_lab: o => o.specimenReceivedAt,
  rejected_needs_recollection: o => o.specimenRejectedAt,
  in_process: o => o.specimenReceivedAt,
  resulted: o => o.completedAt,
  reviewed_by_clinician: o => o.reviewedAt,
  acted_upon: o => o.reviewedAt,
  communicated_to_patient: o => o.reviewedAt || o.completedAt,
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

/** Initials plate for a row whose patient doc is outside this device's scope
 *  (PatientAvatar needs the doc) — same fallback the transfers queue draws. */
const INITIALS_PLATE_STYLE = {
  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--overlay-subtle)', color: 'var(--text-secondary)',
  fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
} as const;

function nameInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
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
  // SLA and turnaround are comparisons against the clock, so the clock is an
  // input rather than something read mid-render (see useNow).
  const now = useNow(60_000);
  // Per-column filters (replace the old search + status-tabs top bar).
  const searchParams = useSearchParams();
  const [colFilters, setColFilters] = useState({ patient: '', test: '', specimen: '', status: '', orderedBy: '', worklist: '' });
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
  const clearColFilters = () => { setColFilters({ patient: '', test: '', specimen: '', status: '', orderedBy: '', worklist: '' }); setQuickSearch(''); };
  // Header "Filters" popover (test type + status) — mirrors the patients
  // registry's Filters pattern, separate from the per-column funnels. The
  // popover itself now belongs to the search field (EhrSearchFilter), so only
  // the applied count is still this page's business.
  const headerFilterCount = [colFilters.test, colFilters.status, colFilters.worklist].filter(Boolean).length;
  const { globalSearch } = useUi();
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
    return (now - resultedAt) / 3_600_000 > slaHours;
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

  // Column config — plain labels; filtering lives in the header search +
  // Filters popover (matching the patients registry), not per-column funnels.
  // Field style for the selects inside the header's Filters popover (mirrors
  // the patients registry's Filters panel fields).
  const popoverFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;
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
              count={labStats.total}
              stats={[
                { label: 'Pending', value: labStats.pending, color: LIST_STAT_COLORS.blue },
                { label: 'In progress', value: labStats.inProgress, color: LIST_STAT_COLORS.amber },
                { label: 'Completed', value: labStats.completed, color: LIST_STAT_COLORS.green },
                // Only shown when there is something to act on — a lab that
                // never sends out should not carry a permanent "Send-outs 0".
                ...(labStats.sendOut > 0 ? [{ label: 'Send-outs', value: labStats.sendOut, color: LIST_STAT_COLORS.muted }] : []),
                ...(labStats.collectionDue > 0 ? [{ label: 'Draws due', value: labStats.collectionDue, color: LIST_STAT_COLORS.amber }] : []),
              ]}
              search={{
                value: quickSearch, onChange: setQuickSearch,
                placeholder: 'Filter table', ariaLabel: 'Filter table',
                // The registry's own axes, folded into the field that already
                // narrows it. The tour still spotlights this trigger — it just
                // lives inside the search box now.
                filters: {
                  activeCount: headerFilterCount,
                  onClear: clearColFilters,
                  label: t('patients.filtersTitle'),
                  panelWidth: 420,
                  dataTour: 'lab-registry-filters',
                  children: (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
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
                  ),
                },
              }}
              actions={
                <>
                  {anyFilterActive && (
                    <EhrListHeaderButton onClick={clearColFilters} ariaLabel={t('nurse.clearAllFilters')}>
                      <X className="w-4 h-4" />
                    </EhrListHeaderButton>
                  )}
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
            {/* The registry's card grid (see patients/page.tsx) — identical
                head, row anatomy, and trailing right-aligned Status column, so
                the bench queue reads in the same list language as the rest of
                the app. Result values are deliberately absent: they are read
                on the chart's Labs tab, which every row click opens. */}
          <div className={`appointment-card-surface patients-list-surface lab-list-surface${canEnterLabResults ? ' has-actions' : ''}`}>
            <div className="appointment-card-flow">
              <div className="appointment-card-head" aria-hidden="true">
                <span>{t('lab.patient')}</span>
                <span>{t('lab.testName')}</span>
                <span>{t('lab.specimen')}</span>
                <span>{t('lab.orderedByLabel')}</span>
                <span>{t('lab.status')}</span>
                {canEnterLabResults && <span>{t('lab.action')}</span>}
              </div>
              {!labLoading && sortedFiltered.length === 0 && (
                <div className="appointment-card-empty">
                  {anyFilterActive ? t('lab.noPatientsMatch') : t('lab.noPendingOrders')}
                </div>
              )}
              {sortedFiltered.map(order => {
                const rowPatient = patientById.get(order.patientId);
                const stage = effOrderStatus(order);
                const changedAt = STAGE_CHANGED_AT[stage]?.(order);
                const openChart = () => {
                  if (order.patientId) router.push(`/patients/${order.patientId}?tab=labs&focus=${order._id}`);
                };
                return (
                  <div
                    key={order._id}
                    className="ehr-appointment-row appointment-card-row"
                    role="button"
                    tabIndex={0}
                    onClick={openChart}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChart(); } }}
                  >
                    <div className="ehr-appointment-identity">
                      {rowPatient ? (
                        <PatientAvatar patient={rowPatient} size={40} />
                      ) : (
                        <span aria-hidden="true" style={INITIALS_PLATE_STYLE}>{nameInitials(order.patientName)}</span>
                      )}
                      <div className="ehr-appointment-main appointment-card-patient">
                        {order.patientId ? (
                          <Link href={`/patients/${order.patientId}?tab=labs&focus=${order._id}`} {...stopsClickPropagation}>
                            {order.patientName}
                          </Link>
                        ) : (
                          <strong>{order.patientName}</strong>
                        )}
                        <p>
                          {[order.hospitalNumber || 'ID not recorded',
                            rowPatient && patientAgeLabel(rowPatient),
                            rowPatient?.gender].filter(Boolean).join(' \u00b7 ')}
                        </p>
                      </div>
                    </div>

                    <div className="appointment-card-provider">
                      <strong>{order.testName}</strong>
                      {order.tier && <span className="capitalize">{order.tier} tier</span>}
                    </div>

                    <div className="appointment-card-provider">
                      <strong>{order.specimen}</strong>
                      <span>{order.accessionNumber || fallbackAccessionNumber(order)}</span>
                    </div>

                    <div className="appointment-card-provider">
                      <strong>{order.orderedBy}</strong>
                      <span>{formatCompactDateTime(order.orderedAt)}</span>
                    </div>

                    {/* With an Action track holding the right edge, Status sits
                        mid-table and aligns under its own head. */}
                    <div className={`appointment-card-status${canEnterLabResults ? ' appointment-card-status--start' : ''}`}>
                      <span className={`appointment-status-pill ${STAGE_PILL_CLASS[stage]}`}>
                        {ORDER_STAGE_LABEL[stage]}
                      </span>
                      {changedAt && <small>{formatCompactDateTime(changedAt)}</small>}
                    </div>

                    {canEnterLabResults && (
                      <div className="appointment-card-status" {...stopsClickPropagation}>
                        {/* Lab work happens in the chart, not in a popup: the
                            technician needs the patient around the result, and
                            the six bench steps live there. This button just
                            names the next step and links straight to it. */}
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ padding: '4px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                          onClick={openChart}
                          disabled={!order.patientId}
                        >
                          {t(LAB_WORKFLOW_STEP_LABEL[stepForStage(stage)])}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          </div>

          {/* Import from Analyzer Modal */}
          {showImportModal && (
            <Modal onClose={resetImport}>
              <div className="modal-content card-elevated p-6 max-w-2xl w-full" {...stopsClickPropagation}>
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
                    <table className="data-table" style={{ minWidth: 720, tableLayout: 'fixed' }}>
                      <TableCols widths={[1.9, 0.8, 0.7, 1, 0.7, 0.6]} />
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
