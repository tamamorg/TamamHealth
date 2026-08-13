'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import PatientName from '@/components/PatientName';
import Badge, { type BadgeTone } from '@/components/Badge';
import { useToast } from '@/components/Toast';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientAge } from '@/lib/patient-utils';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useApp } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ImmunizationDefaulter } from '@/lib/services/immunization-service';
import type { ImmunizationDoc } from '@/lib/db-types';
import EhrListHeader, { EhrListFilters, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import {
  Syringe, Search, Plus, X, CheckCircle2, Clock, AlertTriangle,
  XCircle, ChevronDown, ChevronUp, Users, ExternalLink, Edit3, Download,
  MessageSquare, Send,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

const VACCINES = ['BCG', 'OPV', 'Penta', 'PCV', 'Rota', 'Measles', 'Yellow Fever', 'Vitamin A'];
const SITES: Array<'left arm' | 'right arm' | 'left thigh' | 'right thigh' | 'oral'> = ['left arm', 'right arm', 'left thigh', 'right thigh', 'oral'];

// Shared control styling inside the header's Filters popover.
const filterFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;

const statusConfig = {
  completed: { color: 'var(--color-success-text)', bg: 'rgba(5,150,105,0.12)', icon: CheckCircle2, label: 'Completed' },
  scheduled: { color: 'var(--color-warning)', bg: 'rgba(252,211,77,0.12)', icon: Clock, label: 'Scheduled' },
  overdue: { color: 'var(--color-danger)', bg: 'rgba(229,46,66,0.12)', icon: AlertTriangle, label: 'Overdue' },
  missed: { color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.12)', icon: XCircle, label: 'Missed' },
};

export default function ImmunizationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { currentUser, globalSearch } = useApp();
  const { immunizations, stats, coverage, loading, register, update } = useImmunizations();
  const { patients } = usePatients();
  const { canRecordVitalEvents } = usePermissions();
  // Coverage analytics (summary cards, coverage-by-antigen, coverage-by-age) are
  // a population-health view for facility management and the Ministry of Health.
  // Clinical roles (doctors, nurses, etc.) just work the records and defaulters.
  const canViewCoverage = ['hospital_manager', 'medical_superintendent', 'government', 'county_health_director', 'super_admin'].includes(currentUser?.role ?? '');
  const [showModal, setShowModal] = useState(false);
  // Header "vaccine" filter — scopes both the KPI stat cards and the main
  // per-child table to a single antigen. 'all' = no filter.
  const [vaccineFilter, setVaccineFilter] = useState<string>('all');
  // Table toolbar: local search over child name (combined with the shared
  // global search bar, same pattern as /appointments and /patients) and a
  // status filter over whether a child has any overdue/missed dose.
  const [tableSearch, setTableSearch] = useState('');
  const [childStatusFilter, setChildStatusFilter] = useState<'all' | 'up_to_date' | 'has_overdue'>('all');
  // Edit/correct affordance for a saved dose. Clinical records are corrected
  // (via updateImmunization), never hard-deleted, so a fix preserves audit/sync.
  const [editDose, setEditDose] = useState<ImmunizationDoc | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  useBodyScrollLock(showModal || !!editDose);
  const [expandedChild, setExpandedChild] = useState<string | null>(null);
  const [patientLookup, setPatientLookup] = useState('');
  const [activeTab, setActiveTab] = useState<'records' | 'by_vaccine' | 'defaulters'>('records');
  const [vaccineExpanded, setVaccineExpanded] = useState<Record<string, boolean>>({});
  const [defaulters, setDefaulters] = useState<ImmunizationDefaulter[]>([]);
  const [defaulterStats, setDefaulterStats] = useState<{ totalDefaulters: number; uniqueChildren: number; critical: number; high: number; medium: number; byVaccine: Record<string, number> } | null>(null);
  const [defaulterFilter, setDefaulterFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all');
  const [cohortRows, setCohortRows] = useState<Array<{ vaccine: string; cohort: string; covered: number; total: number; percentage: number }>>([]);
  // Per-row "send SMS recall" state, keyed by the same row key used below
  // (`${patientId}-${vaccine}-${index}`), plus a bulk "Remind all" in-flight flag.
  const [sendingRecall, setSendingRecall] = useState<Record<string, boolean>>({});
  const [bulkSendingRecall, setBulkSendingRecall] = useState(false);
  // Guards the ?patientId= prefill (see effect below) so it only opens the
  // record-dose modal once per page load, not every time `patients` reloads.
  const patientIdPrefillDone = useRef(false);

  // Load defaulter list + cohort coverage whenever immunization data changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const svc = await import('@/lib/services/immunization-service');
        const [list, s, cohort] = await Promise.all([
          svc.getDefaulters(),
          svc.getDefaulterStats(),
          svc.getCoverageByAgeCohort(),
        ]);
        if (cancelled) return;
        setDefaulters(list);
        setDefaulterStats(s);
        setCohortRows(cohort);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [immunizations]);

  // Build a {vaccine -> {cohort -> percentage}} grid for the heatmap
  const cohortGrid = useMemo(() => {
    const grid: Record<string, Record<string, { pct: number; covered: number; total: number }>> = {};
    for (const r of cohortRows) {
      if (!grid[r.vaccine]) grid[r.vaccine] = {};
      grid[r.vaccine][r.cohort] = { pct: r.percentage, covered: r.covered, total: r.total };
    }
    return grid;
  }, [cohortRows]);
  const cohortKeys = ['<6mo', '6-12mo', '1-2y', '2-5y', '5y+'];

  // Form state
  const [form, setForm] = useState({
    patientId: '', patientName: '', gender: 'Male' as 'Male' | 'Female',
    dateOfBirth: '', vaccine: 'BCG', doseNumber: 1, dateGiven: new Date().toISOString().slice(0, 10),
    nextDueDate: '', batchNumber: '', site: 'left arm' as typeof SITES[number],
    adverseReaction: false, adverseReactionDetails: '',
  });

  // Filter patients (children only — under 6 years old) for the lookup picker
  const patientMatches = useMemo(() => {
    if (!patientLookup || patientLookup.length < 2) return [];
    const q = patientLookup.toLowerCase();
    return (patients || [])
      .filter(p => {
        const age = patientAge(p) ?? 99;
        if (age > 15) return false; // immunizations are pediatric
        return (
          `${p.firstName} ${p.surname}`.toLowerCase().includes(q) ||
          (p.hospitalNumber || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [patientLookup, patients]);

  const selectImmunizationPatient = (id: string) => {
    const p = patients.find(x => x._id === id);
    if (!p) return;
    setForm(f => ({
      ...f,
      patientId: p._id,
      patientName: `${p.firstName || ''} ${p.surname || ''}`.trim(),
      gender: (p.gender as 'Male' | 'Female') || f.gender,
      dateOfBirth: p.dateOfBirth || f.dateOfBirth,
    }));
    setPatientLookup('');
  };

  // Deep-link support: `/immunizations?patientId=...` (e.g. from the chart's
  // Immunizations tab "Add" action) opens the record-dose modal preselected
  // to that patient. Runs once per page load — guarded by a ref so it
  // doesn't reopen the modal if the caller closes it and `patients` reloads.
  useEffect(() => {
    if (patientIdPrefillDone.current) return;
    const patientId = searchParams.get('patientId');
    if (!patientId || patients.length === 0) return;
    const p = patients.find(x => x._id === patientId);
    if (!p) return;
    patientIdPrefillDone.current = true;
    setForm(f => ({
      ...f,
      patientId: p._id,
      patientName: `${p.firstName || ''} ${p.surname || ''}`.trim(),
      gender: (p.gender as 'Male' | 'Female') || f.gender,
      dateOfBirth: p.dateOfBirth || f.dateOfBirth,
    }));
    // Bind the ordering visit/note to THIS patient, once.
    setLinkedOrder({
      patientId: p._id,
      encounterId: searchParams.get('encounterId') || undefined,
      noteId: searchParams.get('noteId') || undefined,
    });
    setShowModal(true);
  }, [searchParams, patients]);

  // The visit/note that ordered the dose, when this page was opened from a
  // consultation plan (e.g. `/immunizations?patientId=...&encounterId=...`).
  //
  // Held in state, bound to the patient the link named, rather than read from
  // the URL on every render: an immunization session records several children
  // back-to-back from one deep link, and a param that outlives its patient
  // stamps child B's dose with child A's visit and note. `linkedOrder` is
  // cleared whenever the form's patient changes (see `setLinkedPatient`
  // below and the unlink button).
  const [linkedOrder, setLinkedOrder] = useState<{ patientId: string; encounterId?: string; noteId?: string } | null>(null);
  const encounterId = linkedOrder && linkedOrder.patientId === form.patientId ? linkedOrder.encounterId : undefined;
  const noteId = linkedOrder && linkedOrder.patientId === form.patientId ? linkedOrder.noteId : undefined;

  // Best phone number available for a defaulter's caregiver: the patient's
  // own phone first (in practice the reachable number for young children),
  // falling back to the recorded next-of-kin phone.
  const phoneForDefaulter = (patientId: string): string | undefined => {
    const p = patients.find(x => x._id === patientId);
    return p?.phone || p?.nokPhone || undefined;
  };

  const recallMessage = (d: ImmunizationDefaulter): string => {
    const facility = currentUser?.hospitalName || 'Your clinic';
    return `${facility}: ${d.patientName} is overdue for ${d.vaccine} (dose #${d.doseNumber}). Please bring them in for their immunization.`;
  };

  // Per-row recall: send one SMS to the caregiver of a single overdue child.
  const handleSendRecall = async (d: ImmunizationDefaulter, key: string) => {
    const phone = phoneForDefaulter(d.patientId);
    if (!phone) {
      showToast(`No phone on file for ${d.patientName}.`, 'error');
      return;
    }
    setSendingRecall(s => ({ ...s, [key]: true }));
    try {
      const { sendSms } = await import('@/lib/sms');
      const result = await sendSms({ to: phone, body: recallMessage(d) });
      if (result.ok) {
        showToast(`Recall SMS sent for ${d.patientName}.`, 'success');
      } else {
        showToast(`Could not send recall SMS for ${d.patientName}.`, 'error');
      }
    } catch {
      showToast(`Could not send recall SMS for ${d.patientName}.`, 'error');
    } finally {
      setSendingRecall(s => ({ ...s, [key]: false }));
    }
  };

  // Bulk recall: sweep the currently filtered defaulter list and send a
  // recall SMS to every caregiver with a phone on file.
  const handleRemindAll = async () => {
    const list = defaulters.filter(d => defaulterFilter === 'all' || d.urgency === defaulterFilter);
    if (list.length === 0) return;
    setBulkSendingRecall(true);
    try {
      const { sendSms } = await import('@/lib/sms');
      let sent = 0, failed = 0, skipped = 0;
      for (const d of list) {
        const phone = phoneForDefaulter(d.patientId);
        if (!phone) { skipped++; continue; }
        try {
          const result = await sendSms({ to: phone, body: recallMessage(d) });
          if (result.ok) sent++; else failed++;
        } catch {
          failed++;
        }
      }
      showToast(
        `Reminders sent: ${sent}. Failed: ${failed}. No phone on file: ${skipped}.`,
        sent > 0 ? 'success' : 'error',
      );
    } finally {
      setBulkSendingRecall(false);
    }
  };

  // Group immunizations by child
  const childGroups = useMemo(() => {
    const groups = new Map<string, typeof immunizations>();
    for (const imm of immunizations) {
      if (!groups.has(imm.patientId)) groups.set(imm.patientId, []);
      groups.get(imm.patientId)!.push(imm);
    }
    return groups;
  }, [immunizations]);

  // Text search: local table search combined with the shared global search bar.
  const combinedSearch = `${tableSearch} ${globalSearch}`.trim();

  const filteredChildren = useMemo(() => {
    const entries = Array.from(childGroups.entries());
    const q = combinedSearch.toLowerCase();
    return entries.filter(([, records]) => {
      if (vaccineFilter !== 'all' && !records.some(r => r.vaccine === vaccineFilter)) return false;
      if (q && !records[0]?.patientName?.toLowerCase().includes(q)) return false;
      if (childStatusFilter !== 'all') {
        const hasOverdue = records.some(r => r.status === 'overdue' || r.status === 'missed');
        if (childStatusFilter === 'has_overdue' && !hasOverdue) return false;
        if (childStatusFilter === 'up_to_date' && hasOverdue) return false;
      }
      return true;
    });
  }, [childGroups, combinedSearch, vaccineFilter, childStatusFilter]);

  // Whether the empty state should show "no matches" (vs. "no records at all").
  const hasActiveFilters = !!combinedSearch || vaccineFilter !== 'all' || childStatusFilter !== 'all';

  // KPI stat cards — scoped to the selected vaccine where it makes sense
  // (total doses / given-today / overdue); facility-wide otherwise.
  const today = new Date().toISOString().slice(0, 10);
  const vaccineFilteredImms = useMemo(
    () => (vaccineFilter === 'all' ? immunizations : immunizations.filter(i => i.vaccine === vaccineFilter)),
    [immunizations, vaccineFilter]
  );
  const vaccineFilteredDefaulters = useMemo(
    () => (vaccineFilter === 'all' ? defaulters : defaulters.filter(d => d.vaccine === vaccineFilter)),
    [defaulters, vaccineFilter]
  );
  const totalDosesGiven = useMemo(() => vaccineFilteredImms.filter(i => i.status === 'completed').length, [vaccineFilteredImms]);
  const givenToday = useMemo(() => vaccineFilteredImms.filter(i => i.status === 'completed' && i.dateGiven === today).length, [vaccineFilteredImms, today]);

  // Export the currently filtered per-child table as CSV — one summary row per child.
  const handleDownloadCsv = () => {
    const header = ['Child name', 'Date of birth', 'Gender', 'Facility', 'Completed doses', 'Overdue doses'];
    const rows = filteredChildren.map(([, records]) => {
      const child = records[0];
      const scoped = vaccineFilter === 'all' ? records : records.filter(r => r.vaccine === vaccineFilter);
      const completed = scoped.filter(r => r.status === 'completed').length;
      const overdue = scoped.filter(r => r.status === 'overdue' || r.status === 'missed').length;
      return [child?.patientName || '', child?.dateOfBirth || '', child?.gender || '', child?.facilityName || '', completed, overdue];
    });
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `immunizations-${vaccineFilter === 'all' ? 'all' : vaccineFilter.toLowerCase().replace(/\s+/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await register({
      patientId: form.patientId || `child-new-${Date.now()}`,
      patientName: form.patientName,
      ...(encounterId ? { encounterId } : {}),
      ...(noteId ? { noteId } : {}),
      gender: form.gender,
      dateOfBirth: form.dateOfBirth,
      vaccine: form.vaccine,
      doseNumber: form.doseNumber,
      dateGiven: form.dateGiven,
      nextDueDate: form.nextDueDate,
      facilityId: currentUser?.hospitalId || '',
      facilityName: currentUser?.hospitalName || '',
      state: currentUser?.hospital?.state || '',
      administeredBy: currentUser?.name || '',
      batchNumber: form.batchNumber,
      site: form.site,
      adverseReaction: form.adverseReaction,
      adverseReactionDetails: form.adverseReaction ? form.adverseReactionDetails : undefined,
      status: 'completed',
    });
    setShowModal(false);
    setForm({ patientId: '', patientName: '', gender: 'Male', dateOfBirth: '', vaccine: 'BCG', doseNumber: 1, dateGiven: new Date().toISOString().slice(0, 10), nextDueDate: '', batchNumber: '', site: 'left arm', adverseReaction: false, adverseReactionDetails: '' });
  };

  // Persist a correction to a saved dose, then close the edit modal.
  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDose) return;
    setEditSaving(true);
    try {
      await update(editDose._id, {
        vaccine: editDose.vaccine,
        doseNumber: editDose.doseNumber,
        dateGiven: editDose.dateGiven,
        nextDueDate: editDose.nextDueDate,
        batchNumber: editDose.batchNumber,
        site: editDose.site,
        status: editDose.status,
      });
      setEditDose(null);
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="page-container page-enter">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('immun.loadingRecords')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter">
      {/* ═══ Page header — compact title, dot stats, one controls row ═══ */}
      <EhrListHeader
        title={t('immun.title')}
        stats={[
          { label: `Doses given${vaccineFilter !== 'all' ? ` · ${vaccineFilter}` : ''}`, value: totalDosesGiven, color: LIST_STAT_COLORS.muted },
          { label: 'Given today', value: givenToday, color: LIST_STAT_COLORS.blue },
          { label: 'Overdue', value: vaccineFilteredDefaulters.length, color: LIST_STAT_COLORS.amber },
          { label: 'Fully immunized', value: Math.max((stats?.totalChildren || 0) - (defaulterStats?.uniqueChildren || 0), 0), color: LIST_STAT_COLORS.green },
        ]}
        search={{ value: tableSearch, onChange: setTableSearch, placeholder: 'Search children by name…', ariaLabel: 'Search children by name' }}
        actions={
          <>
            <EhrListFilters
              activeCount={vaccineFilter !== 'all' ? 1 : 0}
              onClear={() => setVaccineFilter('all')}
              panelWidth={260}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Vaccine</span>
                <Select
                  value={vaccineFilter}
                  onChange={e => setVaccineFilter(e.target.value)}
                  className="w-full text-sm py-2 px-3"
                  style={filterFieldStyle}
                >
                  <option value="all">All vaccines</option>
                  {VACCINES.map(v => <option key={v} value={v}>{v}</option>)}
                </Select>
              </label>
            </EhrListFilters>
            {canRecordVitalEvents && (
              <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ gap: 8, height: 38, whiteSpace: 'nowrap' }}>
                <Plus className="w-4 h-4" /> {t('immun.recordVaccination')}
              </button>
            )}
          </>
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-0 border-b mt-4 mb-1 overflow-x-auto" style={{ borderColor: 'var(--border-light)' }}>
        <button onClick={() => setActiveTab('records')}
          className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'records' ? 'tab-active' : ''}`}
          style={{ color: activeTab === 'records' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
          {t('immun.tabRecords', { count: stats?.totalChildren || 0 })}
        </button>
        {canViewCoverage && (
          <button onClick={() => setActiveTab('by_vaccine')}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'by_vaccine' ? 'tab-active' : ''}`}
            style={{ color: activeTab === 'by_vaccine' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
            By Vaccine
          </button>
        )}
        <button onClick={() => setActiveTab('defaulters')}
          className={`px-4 py-3 text-sm font-medium flex items-center gap-2 whitespace-nowrap ${activeTab === 'defaulters' ? 'tab-active' : ''}`}
          style={{ color: activeTab === 'defaulters' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
          {t('immun.tabDefaulters', { count: defaulterStats?.uniqueChildren || 0 })}
          {defaulterStats && defaulterStats.critical > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(229,46,66,0.15)', color: 'var(--color-danger-text)' }}>
              {t('immun.criticalBadge', { count: defaulterStats.critical })}
            </span>
          )}
        </button>
      </div>

        {/* By Vaccine — population-level outreach view */}
        {activeTab === 'by_vaccine' && canViewCoverage && (
          <div className="space-y-4">
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Population-level vaccine coverage. Use this view to identify children needing doses and plan outreach.
            </p>
            {VACCINES.map(vaccine => {
              const given = immunizations.filter(i => i.vaccine === vaccine && i.status === 'completed');
              const overdueItems = defaulters.filter(d => d.vaccine === vaccine);
              const expanded = !!vaccineExpanded[vaccine];
              const total = given.length;
              const overdueCount = overdueItems.length;
              return (
                <div key={vaccine} className="card-elevated overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                    onClick={() => setVaccineExpanded(s => ({ ...s, [vaccine]: !s[vaccine] }))}
                  >
                    <div className="flex items-center gap-3">
                      <span className="icon-box-sm">
                        <Syringe className="w-4 h-4" style={{ color: 'var(--color-success-text)' }} />
                      </span>
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{vaccine}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(5,150,105,0.1)', color: 'var(--color-success-text)' }}>
                        {total} completed
                      </span>
                      {overdueCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(229,46,66,0.1)', color: 'var(--color-danger-text)' }}>
                          {overdueCount} overdue
                        </span>
                      )}
                    </div>
                    {expanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </button>

                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--border-light)' }}>
                      {/* Completed */}
                      {given.length > 0 && (
                        <div className="px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-success-text)' }}>
                            Completed ({given.length})
                          </p>
                          <div className="space-y-1.5">
                            {given.slice(0, 20).map(i => {
                              const scheduledOnTime = !i.nextDueDate || new Date(i.dateGiven) <= new Date(i.nextDueDate);
                              return (
                                <div key={i._id} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {i.patientName || 'Unknown'}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                      {new Date(i.dateGiven).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{
                                      background: scheduledOnTime ? 'rgba(5,150,105,0.1)' : 'rgba(245,158,11,0.1)',
                                      color: scheduledOnTime ? 'var(--color-success-text)' : 'var(--color-warning-text)',
                                    }}>
                                      {scheduledOnTime ? 'On schedule' : 'Late'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                            {given.length > 20 && (
                              <p className="text-[11px] text-center pt-1" style={{ color: 'var(--text-muted)' }}>+{given.length - 20} more</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Overdue */}
                      {overdueItems.length > 0 && (
                        <div className="px-4 py-3" style={{ borderTop: given.length > 0 ? '1px solid var(--border-light)' : undefined }}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-danger-text)' }}>
                            Overdue ({overdueItems.length})
                          </p>
                          <div className="space-y-1.5">
                            {overdueItems.slice(0, 20).map(d => {
                              const overdueDays = Math.floor((Date.now() - new Date(d.dueDate).getTime()) / 86400000);
                              const overdueMo = Math.floor(overdueDays / 30);
                              const overdueLabel = overdueMo >= 1 ? `Overdue by ${overdueMo}mo` : `Overdue by ${overdueDays}d`;
                              return (
                                <div key={`${d.patientId}-${d.vaccine}-${d.doseNumber}`} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg" style={{ background: 'rgba(229,46,66,0.05)', border: '1px solid rgba(229,46,66,0.15)' }}>
                                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {d.patientName || 'Unknown'}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span style={{ color: 'var(--text-muted)' }}>Due: {new Date(d.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(229,46,66,0.12)', color: 'var(--color-danger-text)' }}>
                                      {overdueLabel}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                            {overdueItems.length > 20 && (
                              <p className="text-[11px] text-center pt-1" style={{ color: 'var(--text-muted)' }}>+{overdueItems.length - 20} more</p>
                            )}
                          </div>
                        </div>
                      )}

                      {given.length === 0 && overdueItems.length === 0 && (
                        <div className="px-4 py-6 text-center">
                          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No records for {vaccine} yet.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Coverage by Antigen */}
        {activeTab === 'records' && canViewCoverage && coverage && (
          <div className="card-elevated p-5 mb-6">
            <h3 className="font-semibold text-sm mb-0 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <span className="icon-box-sm">
                <Syringe className="w-4 h-4" style={{ color: 'var(--color-success-text)' }} />
              </span>
              {t('immun.coverageByAntigen')}
            </h3>
            <hr className="section-divider" />
            <div className="data-row-divider-sm">
              {coverage.map(c => (
                <div key={c.vaccine} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-24 text-right" style={{ color: 'var(--text-secondary)' }}>{c.vaccine}</span>
                  <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: 'var(--overlay-light)' }}>
                    <div
                      className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                      style={{
                        width: `${Math.max(c.percentage, 8)}%`,
                        background: c.percentage >= 80 ? 'var(--accent-primary)' :
                                   c.percentage >= 50 ? 'var(--color-warning)' :
                                   'var(--color-danger)',
                      }}
                    >
                      <span className="text-[10px] font-bold text-white">{c.percentage}%</span>
                    </div>
                  </div>
                  <span className="text-xs w-12 text-right" style={{ color: 'var(--text-muted)' }}>{c.count}/{stats?.totalChildren || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Coverage by Age Cohort heatmap */}
        {activeTab === 'records' && canViewCoverage && cohortRows.length > 0 && (
          <div className="card-elevated p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="icon-box-sm">
                  <Syringe className="w-4 h-4" style={{ color: 'var(--color-success-text)' }} />
                </span>
                <h3 className="font-semibold text-sm">{t('immun.coverageByAgeCohort')}</h3>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>{t('immun.epiScheduleAlignment')}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th className="text-left p-2" style={{ color: 'var(--text-muted)' }}>{t('immun.colVaccine')}</th>
                    {cohortKeys.map(c => (
                      <th key={c} className="text-center p-2" style={{ color: 'var(--text-muted)' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(cohortGrid).map(vaccine => (
                    <tr key={vaccine}>
                      <td className="font-semibold p-2" style={{ color: 'var(--text-primary)' }}>{vaccine}</td>
                      {cohortKeys.map(c => {
                        const cell = cohortGrid[vaccine]?.[c];
                        if (!cell || cell.total === 0) {
                          return <td key={c} className="text-center p-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>—</td>;
                        }
                        const bg = cell.pct >= 90 ? 'rgba(5,150,105,0.85)' : cell.pct >= 70 ? 'rgba(13,148,136,0.65)' : cell.pct >= 50 ? 'rgba(252,211,77,0.55)' : cell.pct >= 25 ? 'rgba(245,158,11,0.5)' : 'rgba(229,46,66,0.45)';
                        const fg = cell.pct >= 50 ? '#fff' : 'var(--text-primary)';
                        return (
                          <td key={c} className="p-1">
                            <div className="rounded-md text-center font-bold" style={{ background: bg, color: fg, padding: '6px 4px' }} title={`${cell.covered}/${cell.total}`}>
                              {cell.pct}%
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Defaulters Panel */}
        {activeTab === 'defaulters' && (
          <>
            <div className="card-elevated overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-light)' }}>
                <div className="flex items-center gap-2">
                  <span className="icon-box-sm">
                    <AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                  </span>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {t('immun.defaultersTitle')} {defaulterFilter !== 'all' && `· ${defaulterFilter}`}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  {defaulterFilter !== 'all' && (
                    <button onClick={() => setDefaulterFilter('all')} className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>{t('immun.clearFilter')}</button>
                  )}
                  {canRecordVitalEvents && defaulters.filter(d => defaulterFilter === 'all' || d.urgency === defaulterFilter).length > 0 && (
                    <button
                      type="button"
                      onClick={handleRemindAll}
                      disabled={bulkSendingRecall}
                      className="btn btn-secondary btn-sm"
                      style={{ gap: 6 }}
                      title="Send a recall SMS to every caregiver with a phone on file in the current view"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {bulkSendingRecall ? 'Sending…' : 'Remind all'}
                    </button>
                  )}
                </div>
              </div>
              <div className="ehr-list-scroll">
                <table className="data-table" style={{ minWidth: 1080, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '9%' }} />
                  </colgroup>
                <thead>
                  <tr>
                    <th>{t('immun.colChild')}</th>
                    <th>{t('immun.colAge')}</th>
                    <th>{t('immun.colGender')}</th>
                    <th>{t('immun.colOverdueVaccine')}</th>
                    <th>{t('immun.colDose')}</th>
                    <th>{t('immun.colDueDate')}</th>
                    <th>{t('immun.colDaysOverdue')}</th>
                    <th>{t('immun.colFacility')}</th>
                    <th>{t('immun.colUrgency')}</th>
                    <th className="text-right">Recall</th>
                  </tr>
                </thead>
                <tbody>
                  {defaulters.filter(d => defaulterFilter === 'all' || d.urgency === defaulterFilter).length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('immun.noDefaultersInCategory')}
                    </td></tr>
                  ) : defaulters.filter(d => defaulterFilter === 'all' || d.urgency === defaulterFilter).map((d, i) => {
                    const urgencyColor = d.urgency === 'critical' ? 'var(--color-danger)' : d.urgency === 'high' ? 'var(--color-warning)' : 'var(--accent-primary)';
                    const urgencyTone: BadgeTone = d.urgency === 'critical' ? 'danger' : d.urgency === 'high' ? 'warning' : 'info';
                    const rowKey = `${d.patientId}-${d.vaccine}-${i}`;
                    const hasPhone = !!phoneForDefaulter(d.patientId);
                    return (
                      <tr key={rowKey} className="cursor-pointer" onClick={() => router.push(`/patients/${d.patientId}?tab=immunizations`)}>
                        <td><PatientName patientId={d.patientId} name={d.patientName} gender={d.gender} nameClassName="font-medium text-sm" /></td>
                        <td className="text-xs">{Math.floor(d.ageMonths / 12)}y {d.ageMonths % 12}m</td>
                        <td className="text-xs">{d.gender}</td>
                        <td className="text-sm font-medium">{d.vaccine}</td>
                        <td className="text-xs">#{d.doseNumber}</td>
                        <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.dueDate}</td>
                        <td className="text-sm font-bold" style={{ color: urgencyColor }}>{d.daysOverdue}d</td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.facilityName}</td>
                        <td>
                          <Badge tone={urgencyTone} uppercase>{d.urgency}</Badge>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSendRecall(d, rowKey); }}
                            disabled={!hasPhone || !!sendingRecall[rowKey]}
                            className="btn btn-secondary btn-sm"
                            style={{ gap: 6 }}
                            title={hasPhone ? 'Send a recall SMS to this child’s caregiver' : 'No phone on file'}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            {sendingRecall[rowKey] ? 'Sending…' : 'Send SMS recall'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </>
        )}

        {/* Vaccine Schedule Table — Grouped by Child */}
        {activeTab === 'records' && (
        <div className="card-elevated overflow-hidden">
          {/* Secondary toolbar — child-status filter + export. Title, stats,
              search, and vaccine filter now live in the shared page header above. */}
          <div className="listpage-table-toolbar">
            <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
              {t('immun.vaccinationRecords', { count: filteredChildren.length })}
            </span>
            <Select
              value={childStatusFilter}
              onChange={e => setChildStatusFilter(e.target.value as 'all' | 'up_to_date' | 'has_overdue')}
              className="listpage-status-select"
              aria-label="Filter children by immunization status"
            >
              <option value="all">All children</option>
              <option value="up_to_date">Up to date</option>
              <option value="has_overdue">Has overdue doses</option>
            </Select>
            <button
              type="button"
              onClick={handleDownloadCsv}
              aria-label="Download"
              title="Download"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 38, height: 38, padding: 0, flexShrink: 0,
                borderRadius: 999, background: 'var(--bg-card-solid)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-light)', cursor: 'pointer',
              }}
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          {filteredChildren.map(([childId, records]) => {
            const child = records[0];
            const isExpanded = expandedChild === childId;
            const scopedRecords = vaccineFilter === 'all' ? records : records.filter(r => r.vaccine === vaccineFilter);
            const vaccinesToShow = vaccineFilter === 'all' ? VACCINES : [vaccineFilter];
            const completedCount = scopedRecords.filter(r => r.status === 'completed').length;
            const overdueCount = scopedRecords.filter(r => r.status === 'overdue' || r.status === 'missed').length;

            const toggle = () => setExpandedChild(isExpanded ? null : childId);
            return (
              <div key={childId} className="border-b" style={{ borderColor: 'var(--border-light)' }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                  className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--table-row-hover)] cursor-pointer"
                >
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{child.patientName}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {child.gender} · DOB: {child.dateOfBirth} · {child.facilityName}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge tone="accent">{t('immun.given', { count: completedCount })}</Badge>
                    {overdueCount > 0 && (
                      <Badge tone="danger">{t('immun.overdueCount', { count: overdueCount })}</Badge>
                    )}
                    <Link
                      href={`/patients/${childId}?tab=immunizations`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors hover:bg-[var(--accent-light)]"
                      style={{ color: 'var(--accent-primary)' }}
                      title={t('immun.viewPatientRecord')}
                    >
                      {t('immun.view')} <ExternalLink className="w-3 h-3" />
                    </Link>
                    {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 data-row-divider-sm">
                      {vaccinesToShow.map(vac => {
                        const doses = scopedRecords.filter(r => r.vaccine === vac);
                        if (doses.length === 0) return (
                          <div key={vac} className="p-2 rounded-lg border" style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{vac}</p>
                            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{t('immun.notScheduled')}</p>
                          </div>
                        );
                        return doses.map(dose => {
                          const cfg = statusConfig[dose.status];
                          return (
                            <div key={dose._id} className="p-2 rounded-lg border" style={{ borderColor: 'var(--border-light)', background: cfg.bg }}>
                              <div className="flex items-center gap-1 mb-1">
                                <p className="text-xs font-medium flex-1 min-w-0" style={{ color: cfg.color }}>{dose.vaccine} {dose.doseNumber > 0 ? `#${dose.doseNumber}` : ''}</p>
                                {canRecordVitalEvents && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setEditDose(dose); }}
                                    aria-label={t('action.edit')}
                                    title={t('action.edit')}
                                    className="p-0.5 rounded hover:bg-[var(--overlay-light)] shrink-0"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                                {dose.status === 'completed' ? dose.dateGiven : dose.status === 'scheduled' ? t('immun.due', { date: dose.nextDueDate }) : t(`immun.status${dose.status.charAt(0).toUpperCase()}${dose.status.slice(1)}`)}
                              </p>
                            </div>
                          );
                        });
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredChildren.length === 0 && (
            <EmptyState
              icon={Syringe}
              title={hasActiveFilters ? t('immun.noMatchingChildren') : t('immun.noRecordsYet')}
              message={hasActiveFilters
                ? t('immun.noMatchingMessage')
                : t('immun.noRecordsMessage')}
              action={!hasActiveFilters && canRecordVitalEvents ? { label: t('immun.recordVaccinationAction'), onClick: () => setShowModal(true) } : undefined}
            />
          )}
        </div>
        )}

        {/* Registration Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="card-elevated p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fadeIn" style={{ margin: '20px' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('immun.recordVaccination')}</h3>
                <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-[var(--overlay-light)]">
                  <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Link to existing patient (recommended) */}
                <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(59, 130, 246,0.25))' }}>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
                    <Users className="w-3 h-3" />
                    {t('immun.linkToExistingChild')}
                  </label>
                  {form.patientId ? (
                    <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                      <div className="text-xs">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{form.patientName}</p>
                        <p style={{ color: 'var(--text-muted)' }}>{form.gender}{form.dateOfBirth ? ` · DOB ${form.dateOfBirth}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => { setLinkedOrder(null); setForm(f => ({ ...f, patientId: '', patientName: '', dateOfBirth: '' })); }} className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('immun.unlink')}</button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          value={patientLookup}
                          onChange={e => setPatientLookup(e.target.value)}
                          placeholder={t('immun.searchChildPlaceholder')}
                          className="w-full text-xs p-2 pl-8 rounded-lg outline-none"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {patientMatches.length > 0 && (
                        <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                          {patientMatches.map(p => (
                            <button
                              key={p._id}
                              type="button"
                              onClick={() => selectImmunizationPatient(p._id)}
                              className="w-full px-2.5 py-2 text-left text-xs hover:bg-[var(--overlay-subtle)] transition-colors"
                              style={{ borderBottom: '1px solid var(--border-light)' }}
                            >
                              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.firstName} {p.surname}</p>
                              <p style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber} · {p.gender}{p.estimatedAge ? ` · ${p.estimatedAge}y` : ''}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        {t('immun.linkingHint')}
                      </p>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.childName')}</label>
                    <input type="text" required value={form.patientName} onChange={e => setForm({ ...form, patientName: e.target.value })} placeholder={t('immun.fullName')} />
                  </div>
                  <div>
                    <label>{t('immun.gender')}</label>
                    <Select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value as 'Male' | 'Female' })}>
                      <option value="Male">{t('immun.male')}</option>
                      <option value="Female">{t('immun.female')}</option>
                    </Select>
                  </div>
                </div>

                <div>
                  <label>{t('immun.dateOfBirth')}</label>
                  <input type="date" required value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.vaccine')}</label>
                    <Select value={form.vaccine} onChange={e => setForm({ ...form, vaccine: e.target.value })}>
                      {VACCINES.map(v => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label>{t('immun.doseNumber')}</label>
                    <input type="number" min={0} max={5} value={form.doseNumber} onChange={e => setForm({ ...form, doseNumber: parseInt(e.target.value, 10) || 0 })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.dateGiven')}</label>
                    <input type="date" required value={form.dateGiven} onChange={e => setForm({ ...form, dateGiven: e.target.value })} />
                  </div>
                  <div>
                    <label>{t('immun.nextDueDate')}</label>
                    <input type="date" value={form.nextDueDate} onChange={e => setForm({ ...form, nextDueDate: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.batchNumber')}</label>
                    <input type="text" value={form.batchNumber} onChange={e => setForm({ ...form, batchNumber: e.target.value })} placeholder={t('immun.batchNumberPlaceholder')} />
                  </div>
                  <div>
                    <label>{t('immun.site')}</label>
                    <Select value={form.site} onChange={e => setForm({ ...form, site: e.target.value as typeof SITES[number] })}>
                      {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 cursor-pointer" style={{ textTransform: 'none', fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={form.adverseReaction} onChange={e => setForm({ ...form, adverseReaction: e.target.checked })} className="w-4 h-4" />
                    {t('immun.adverseReactionObserved')}
                  </label>
                  {form.adverseReaction && (
                    <textarea
                      className="mt-2"
                      rows={2}
                      placeholder={t('immun.adverseReactionPlaceholder')}
                      value={form.adverseReactionDetails}
                      onChange={e => setForm({ ...form, adverseReactionDetails: e.target.value })}
                    />
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">{t('immun.cancel')}</button>
                  <button type="submit" className="btn btn-primary flex-1">
                    <Syringe className="w-4 h-4" /> {t('immun.recordVaccination')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit / Correct a saved dose */}
        {editDose && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="card-elevated p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fadeIn" style={{ margin: '20px' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('action.edit')} · {editDose.patientName}</h3>
                <button onClick={() => setEditDose(null)} className="p-1 rounded-lg hover:bg-[var(--overlay-light)]">
                  <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <form onSubmit={handleEditSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.vaccine')}</label>
                    <Select value={editDose.vaccine} onChange={e => setEditDose({ ...editDose, vaccine: e.target.value })}>
                      {VACCINES.map(v => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label>{t('immun.doseNumber')}</label>
                    <input type="number" min={0} max={5} value={editDose.doseNumber} onChange={e => setEditDose({ ...editDose, doseNumber: parseInt(e.target.value, 10) || 0 })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.dateGiven')}</label>
                    <input type="date" value={editDose.dateGiven} onChange={e => setEditDose({ ...editDose, dateGiven: e.target.value })} />
                  </div>
                  <div>
                    <label>{t('immun.nextDueDate')}</label>
                    <input type="date" value={editDose.nextDueDate || ''} onChange={e => setEditDose({ ...editDose, nextDueDate: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>{t('immun.batchNumber')}</label>
                    <input type="text" value={editDose.batchNumber || ''} onChange={e => setEditDose({ ...editDose, batchNumber: e.target.value })} placeholder={t('immun.batchNumberPlaceholder')} />
                  </div>
                  <div>
                    <label>{t('immun.site')}</label>
                    <Select value={editDose.site} onChange={e => setEditDose({ ...editDose, site: e.target.value as typeof SITES[number] })}>
                      {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditDose(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                  <button type="submit" disabled={editSaving} className="btn btn-primary flex-1">
                    {t('action.saveChanges')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </main>
  );
}
