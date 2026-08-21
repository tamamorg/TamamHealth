'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import Badge, { type BadgeTone } from '@/components/Badge';
import { useANC } from '@/lib/hooks/useANC';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientAge } from '@/lib/patient-utils';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useApp } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ANCVisitDoc } from '@/lib/db-types';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import {
  HeartPulse, Plus, X, Users,
  Calendar, ChevronRight, ExternalLink, Edit3,
} from '@/components/icons/lucide';
import Select from '@/components/Select';
import { toIsoDate, todayIso } from '@/lib/date-utils';

const RISK_FACTOR_OPTIONS = [
  'hypertension', 'anemia', 'previous_csection', 'multiple_pregnancy',
  'hiv_positive', 'rh_negative', 'primigravida', 'diabetes',
  'preeclampsia', 'bleeding', 'malaria_in_pregnancy', 'proteinuria',
];

const riskColors: Record<'low' | 'moderate' | 'high', { tone: BadgeTone; label: string }> = {
  low: { tone: 'info', label: 'Low Risk' },
  moderate: { tone: 'warning', label: 'Moderate' },
  high: { tone: 'danger', label: 'High Risk' },
};

export default function ANCPage() {
  const { t } = useTranslation();
  const { currentUser, globalSearch } = useApp();
  const { visits, stats, loading, register, update } = useANC();
  const { patients } = usePatients();
  const { canRecordVitalEvents } = usePermissions();
  // Programme analytics (summary cards + ANC continuum funnel) are a population
  // view for facility management and the Ministry of Health. Clinical roles keep
  // the data recordings, workflow, and the mother/visit data.
  const canViewCoverage = ['hospital_manager', 'medical_superintendent', 'government', 'county_health_director', 'super_admin'].includes(currentUser?.role ?? '');
  // Table toolbar search (shared list-page header), combined with the
  // platform-wide search bar so a term typed elsewhere still narrows this list.
  const [tableSearch, setTableSearch] = useState('');
  const search = `${tableSearch} ${globalSearch}`.trim();
  const [showModal, setShowModal] = useState(false);
  // Edit/correct affordance for a saved ANC visit. Visits are corrected via
  // updateANCVisit (audit/sync preserved), not hard-deleted from the UI.
  const [editVisit, setEditVisit] = useState<ANCVisitDoc | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  useBodyScrollLock(showModal || !!editVisit);
  const [selectedMother, setSelectedMother] = useState<string | null>(null);
  const [patientLookup, setPatientLookup] = useState('');

  const [form, setForm] = useState({
    motherId: '', motherName: '', motherAge: 25, gravida: 1, parity: 0,
    visitNumber: 1, visitDate: todayIso(), gestationalAge: 12,
    bloodPressure: '', weight: 0, fundalHeight: 0, fetalHeartRate: 0,
    hemoglobin: 0, urineProtein: 'Negative', bloodGroup: 'O', rhFactor: '+',
    hivStatus: 'Not tested', malariaTest: 'Negative', syphilisTest: 'Non-reactive',
    ironFolateGiven: true, tetanusVaccine: false, iptpDose: 0,
    riskFactors: [] as string[], riskLevel: 'low' as 'low' | 'moderate' | 'high',
    birthPlanFacility: '', birthPlanTransport: '', birthPlanBloodDonor: '',
    nextVisitDate: '', notes: '',
  });
  const [linkedPatientId, setLinkedPatientId] = useState<string | undefined>(undefined);

  // Filter to female patients of childbearing age (10-55) for the lookup
  const patientMatches = useMemo(() => {
    if (!patientLookup || patientLookup.length < 2) return [];
    const q = patientLookup.toLowerCase();
    return (patients || [])
      .filter(p => {
        if (p.gender !== 'Female') return false;
        const age = patientAge(p) ?? 0;
        if (age < 10 || age > 55) return false;
        return (
          `${p.firstName} ${p.surname}`.toLowerCase().includes(q) ||
          (p.hospitalNumber || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [patientLookup, patients]);

  const selectAncPatient = (id: string) => {
    const p = patients.find(x => x._id === id);
    if (!p) return;
    const age = patientAge(p) ?? form.motherAge;
    setLinkedPatientId(p._id);
    setForm(f => ({
      ...f,
      motherId: p._id, // re-use patient id so birth-service linkage works
      motherName: `${p.firstName || ''} ${p.surname || ''}`.trim(),
      motherAge: age || f.motherAge,
    }));
    setPatientLookup('');
  };

  // Deep link: the patient chart's "Clinical forms" drawer opens the ANC visit
  // form for a specific mother via ?patientId=. The link existed but nothing
  // read the param, so it landed on the bare ANC list and the clinician had to
  // find the patient again. Waits for `patients` to load (retries via the dep
  // array) and fires once.
  const ancPatientParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || ancPatientParamRef.current || !patients.length) return;
    const params = new URLSearchParams(window.location.search);
    const patientId = params.get('patientId');
    if (!patientId) return;
    const match = patients.find(p => p._id === patientId);
    if (!match) return;
    ancPatientParamRef.current = true;
    selectAncPatient(patientId);
    if (canRecordVitalEvents) setShowModal(true);
    params.delete('patientId');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // selectAncPatient is recreated each render; `patients` arriving is the
    // signal this effect actually waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, canRecordVitalEvents]);

  // Group visits by mother — get latest visit for each
  const motherSummaries = useMemo(() => {
    const map = new Map<string, { latest: typeof visits[0]; visitCount: number; allVisits: typeof visits }>();
    for (const v of (visits || [])) {
      const existing = map.get(v.motherId);
      if (!existing) {
        map.set(v.motherId, { latest: v, visitCount: 1, allVisits: [v] });
      } else {
        existing.visitCount++;
        existing.allVisits.push(v);
        if (v.visitNumber > existing.latest.visitNumber) existing.latest = v;
      }
    }
    return Array.from(map.values());
  }, [visits]);

  const filteredMothers = useMemo(() => {
    let result = motherSummaries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m => m.latest.motherName.toLowerCase().includes(q));
    }
    return result;
  }, [motherSummaries, search]);

  // Header stat chips — computed from data already loaded on this page (no
  // extra fetches). Unaffected by the search box, same as the patients header.
  const today = todayIso();
  const thisMonthPrefix = today.slice(0, 7);
  const highRiskCount = useMemo(() => motherSummaries.filter(m => m.latest.riskLevel === 'high').length, [motherSummaries]);
  const visitsThisMonth = useMemo(() => (visits || []).filter(v => v.visitDate?.startsWith(thisMonthPrefix)).length, [visits, thisMonthPrefix]);
  const dueSoonCount = useMemo(() => {
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const in7Str = toIsoDate(in7);
    return motherSummaries.filter(m => m.latest.nextVisitDate && m.latest.nextVisitDate >= today && m.latest.nextVisitDate <= in7Str).length;
  }, [motherSummaries, today]);

  const selectedMotherVisits = useMemo(() => {
    if (!selectedMother) return [];
    return (visits || []).filter(v => v.motherId === selectedMother).sort((a, b) => a.visitNumber - b.visitNumber);
  }, [visits, selectedMother]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await register({
      motherId: form.motherId || `mother-new-${Date.now()}`,
      motherName: form.motherName,
      motherAge: form.motherAge,
      gravida: form.gravida,
      parity: form.parity,
      visitNumber: form.visitNumber,
      visitDate: form.visitDate,
      gestationalAge: form.gestationalAge,
      facilityId: currentUser?.hospitalId || '',
      facilityName: currentUser?.hospitalName || '',
      state: currentUser?.hospital?.state || '',
      bloodPressure: form.bloodPressure,
      weight: form.weight,
      fundalHeight: form.fundalHeight,
      fetalHeartRate: form.fetalHeartRate,
      hemoglobin: form.hemoglobin,
      urineProtein: form.urineProtein,
      bloodGroup: form.bloodGroup,
      rhFactor: form.rhFactor,
      hivStatus: form.hivStatus,
      malariaTest: form.malariaTest,
      syphilisTest: form.syphilisTest,
      ironFolateGiven: form.ironFolateGiven,
      tetanusVaccine: form.tetanusVaccine,
      iptpDose: form.iptpDose,
      riskFactors: form.riskFactors,
      riskLevel: form.riskLevel,
      birthPlan: { facility: form.birthPlanFacility, transport: form.birthPlanTransport, bloodDonor: form.birthPlanBloodDonor },
      nextVisitDate: form.nextVisitDate,
      notes: form.notes,
      attendedBy: currentUser?.name || '',
      attendedByRole: currentUser?.role || 'doctor',
      patientId: linkedPatientId,
    });
    setShowModal(false);
    setLinkedPatientId(undefined);
    setPatientLookup('');
  };

  // Persist a correction to a saved ANC visit, then close the edit modal.
  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editVisit) return;
    setEditSaving(true);
    try {
      await update(editVisit._id, {
        visitDate: editVisit.visitDate,
        gestationalAge: editVisit.gestationalAge,
        bloodPressure: editVisit.bloodPressure,
        weight: editVisit.weight,
        hemoglobin: editVisit.hemoglobin,
        fetalHeartRate: editVisit.fetalHeartRate,
        riskLevel: editVisit.riskLevel,
        nextVisitDate: editVisit.nextVisitDate,
        notes: editVisit.notes,
      });
      setEditVisit(null);
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
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('anc.loadingRecords')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter">
        {/* Continuum funnel */}
        {canViewCoverage && stats && stats.continuum && stats.totalMothers > 0 && (
          <div className="card-elevated p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                <h3 className="font-semibold text-sm">{t('anc.continuumTitle')}</h3>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('anc.who8ContactModel')}
              </span>
            </div>
            <div className="space-y-2">
              {([
                { key: 'anc1', label: t('anc.anc1Label'), count: stats.continuum.anc1 },
                { key: 'anc2', label: t('anc.anc2Label'), count: stats.continuum.anc2 },
                { key: 'anc3', label: t('anc.anc3Label'), count: stats.continuum.anc3 },
                { key: 'anc4', label: t('anc.anc4Label'), count: stats.continuum.anc4 },
                { key: 'anc5plus', label: t('anc.anc5plusLabel'), count: stats.continuum.anc5plus },
              ] as const).map((step, i) => {
                const pct = stats.totalMothers > 0 ? Math.round((step.count / stats.totalMothers) * 100) : 0;
                const dropoff = i > 0 ? Math.max(0, ([stats.continuum.anc1, stats.continuum.anc2, stats.continuum.anc3, stats.continuum.anc4, stats.continuum.anc5plus][i - 1]) - step.count) : 0;
                const barColor = step.key === 'anc4' ? 'var(--accent-primary)' : pct >= 50 ? 'var(--accent-hover)' : pct >= 25 ? 'var(--color-warning)' : 'var(--color-danger)';
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <span className="text-xs font-bold w-44 text-end" style={{ color: 'var(--text-secondary)' }}>{step.label}</span>
                    <div className="flex-1 h-7 rounded-md overflow-hidden" style={{ background: 'var(--overlay-light)' }}>
                      <div
                        className="h-full rounded-md flex items-center justify-end pe-2 transition-all duration-700"
                        style={{ width: `${Math.max(pct, 4)}%`, background: barColor }}
                      >
                        <span className="text-[10px] font-bold text-white">{step.count} ({pct}%)</span>
                      </div>
                    </div>
                    {i > 0 && dropoff > 0 ? (
                      <span className="text-[10px] font-mono w-16 text-end" style={{ color: 'var(--color-danger-text)' }}>{t('anc.dropCount', { count: dropoff })}</span>
                    ) : (
                      <span className="text-[10px] w-16" />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] mt-3 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-light)' }}>
              {t('anc.continuumNote')}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Mother List */}
          <div className="lg:col-span-2 card-elevated overflow-hidden">
            <EhrListHeader
              title={t('anc.title')}
              stats={[
                { label: 'Mothers enrolled', value: motherSummaries.length, color: LIST_STAT_COLORS.muted },
                { label: 'High risk', value: highRiskCount, color: LIST_STAT_COLORS.blue },
                { label: 'Visits this month', value: visitsThisMonth, color: LIST_STAT_COLORS.amber },
                { label: 'Due soon', value: dueSoonCount, color: LIST_STAT_COLORS.green },
              ]}
              search={{ value: tableSearch, onChange: setTableSearch, placeholder: 'Search mothers by name…', ariaLabel: 'Search mothers by name' }}
              actions={
                canRecordVitalEvents && (
                  <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ gap: 8, height: 38, whiteSpace: 'nowrap' }}>
                    <Plus className="w-4 h-4" /> {t('anc.registerVisit')}
                  </button>
                )
              }
            />

            <div className="divide-y data-row-divider-sm" style={{ borderColor: 'var(--table-row-border)' }}>
              {filteredMothers.map(({ latest, visitCount }) => {
                const risk = riskColors[latest.riskLevel] || riskColors.low;
                const isSelected = selectedMother === latest.motherId;
                const select = () => setSelectedMother(isSelected ? null : latest.motherId);
                const hasRealPatientRecord = !!latest.motherId
                  && !latest.motherId.startsWith('demo-')
                  && !latest.motherId.startsWith('mother-new-')
                  && !latest.motherId.includes('_demo');
                return (
                  <div
                    key={latest.motherId}
                    role="button"
                    tabIndex={0}
                    onClick={select}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--table-row-hover)]"
                    style={{ background: isSelected ? 'var(--nav-active-bg)' : undefined }}
                  >
                    <div className="flex-1 min-w-0">
                      {hasRealPatientRecord ? (
                        <Link
                          href={`/patients/${latest.motherId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold truncate block hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {latest.motherName}
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{latest.motherName}</p>
                      )}
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {t('anc.motherMeta', { age: latest.motherAge, gravida: latest.gravida, parity: latest.parity, weeks: latest.gestationalAge, facility: latest.facilityName })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge tone={risk.tone}>{risk.label}</Badge>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {visitCount} visit{visitCount !== 1 ? 's' : ''}
                      </span>
                      {hasRealPatientRecord && (
                        <Link
                          href={`/patients/${latest.motherId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full transition-colors hover:bg-[var(--accent-light)]"
                          style={{ color: 'var(--accent-primary)' }}
                          title="View patient record"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                      <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </div>
                );
              })}
              {filteredMothers.length === 0 && (
                <EmptyState
                  icon={HeartPulse}
                  title={search ? 'No matching mothers' : 'No ANC visits yet'}
                  message={search
                    ? 'Try a different search term, or clear the search to see all enrolled mothers.'
                    : 'Start enrolling pregnant mothers in antenatal care. Track gestational age, vitals, risk factors, and birth plans across all 8 WHO-recommended visits.'}
                  action={!search && canRecordVitalEvents ? { label: 'Register ANC visit', onClick: () => setShowModal(true) } : undefined}
                />
              )}
            </div>
          </div>

          {/* Visit Detail Panel */}
          <div className="space-y-4">
            {selectedMother && selectedMotherVisits.length > 0 ? (
              <>
                {/* Mother Summary */}
                <div className="card-elevated p-4">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <HeartPulse className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                    Visit History
                  </h3>
                  <hr className="section-divider" />
                  <div className="space-y-3 data-row-divider-sm">
                    {selectedMotherVisits.map(v => {
                      const risk = riskColors[v.riskLevel] || riskColors.low;
                      return (
                        <div key={v._id} className="p-3 rounded-lg border" style={{ borderColor: 'var(--border-light)' }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>ANC {v.visitNumber}</span>
                            <div className="flex items-center gap-2">
                              <Badge tone={risk.tone}>{risk.label}</Badge>
                              {canRecordVitalEvents && (
                                <button
                                  type="button"
                                  onClick={() => setEditVisit(v)}
                                  aria-label={t('action.edit')}
                                  title={t('action.edit')}
                                  className="p-1 rounded hover:bg-[var(--overlay-light)]"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  <Edit3 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span>Date: {v.visitDate}</span>
                            <span>GA: {v.gestationalAge} wks</span>
                            <span>BP: {v.bloodPressure}</span>
                            <span>Wt: {v.weight} kg</span>
                            <span>Hb: {v.hemoglobin} g/dL</span>
                            <span>FHR: {v.fetalHeartRate} bpm</span>
                          </div>
                          {(v.riskFactors?.length ?? 0) > 0 && (
                            <>
                              <hr className="section-divider" />
                              <div className="flex flex-wrap gap-1">
                                {(v.riskFactors || []).map(rf => (
                                  <span key={rf} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(224, 49, 39,0.1)', color: 'var(--color-danger-text)' }}>
                                    {rf.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                          {v.notes && (
                            <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted)' }}>{v.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Birth Plan */}
                {(() => {
                  const latest = selectedMotherVisits[selectedMotherVisits.length - 1];
                  return (
                    <div className="card-elevated p-4">
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Calendar className="w-4 h-4" style={{ color: '#1174B4' }} />
                        Birth Plan
                      </h3>
                      <hr className="section-divider" />
                      <div className="space-y-2 data-row-divider-sm text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <div className="flex justify-between">
                          <span>Delivery Facility</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{latest.birthPlan?.facility || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Transport</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{latest.birthPlan?.transport || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Blood Donor</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{latest.birthPlan?.bloodDonor || '—'}</span>
                        </div>
                        <hr className="section-divider" />
                        <div className="flex justify-between">
                          <span>Next Visit</span>
                          <span className="font-semibold" style={{ color: 'var(--accent-primary)' }}>{latest.nextVisitDate || '—'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="card-elevated p-8 text-center">
                <HeartPulse className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--chart-2)', opacity: 0.2 }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a mother to view visit history</p>
              </div>
            )}
          </div>
        </div>

        {/* Registration Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="card-elevated p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fadeIn" style={{ margin: '20px' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Register ANC Visit</h3>
                <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-[var(--overlay-light)]">
                  <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Link to existing patient (recommended) */}
                <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.25))' }}>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
                    <Users className="w-3 h-3" />
                    Link to existing mother (recommended)
                  </label>
                  {linkedPatientId ? (
                    (() => {
                      const lp = patients.find(p => p._id === linkedPatientId);
                      return (
                        <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                          <div className="text-xs">
                            <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{lp?.firstName} {lp?.surname}</p>
                            <p style={{ color: 'var(--text-muted)' }}>{lp?.hospitalNumber}{lp?.estimatedAge ? ` · ${lp.estimatedAge}y` : ''}</p>
                          </div>
                          <button type="button" onClick={() => { setLinkedPatientId(undefined); setForm(f => ({ ...f, motherId: '' })); }} className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Unlink</button>
                        </div>
                      );
                    })()
                  ) : (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          value={patientLookup}
                          onChange={e => setPatientLookup(e.target.value)}
                          placeholder="Search female patient by name or hospital number…"
                          className="w-full text-xs p-2 rounded-lg outline-none"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      {patientMatches.length > 0 && (
                        <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                          {patientMatches.map(p => (
                            <button
                              key={p._id}
                              type="button"
                              onClick={() => selectAncPatient(p._id)}
                              className="w-full px-2.5 py-2 text-start text-xs hover:bg-[var(--overlay-subtle)] transition-colors"
                              style={{ borderBottom: '1px solid var(--border-light)' }}
                            >
                              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.firstName} {p.surname}</p>
                              <p style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}{p.estimatedAge ? ` · ${p.estimatedAge}y` : ''}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                        Linking lets the system flag the mother as &ldquo;Delivered&rdquo; once a birth is registered for her.
                      </p>
                    </>
                  )}
                </div>

                {/* Mother Info */}
                <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>Mother Information</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label>Mother Name</label>
                      <input type="text" required value={form.motherName} onChange={e => setForm({ ...form, motherName: e.target.value })} placeholder="Full name" />
                    </div>
                    <div>
                      <label>Age</label>
                      <input type="number" min={14} max={55} value={form.motherAge} onChange={e => setForm({ ...form, motherAge: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <div>
                      <label>Gravida</label>
                      <input type="number" min={1} max={20} value={form.gravida} onChange={e => setForm({ ...form, gravida: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                    <div>
                      <label>Parity</label>
                      <input type="number" min={0} max={20} value={form.parity} onChange={e => setForm({ ...form, parity: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                    <div>
                      <label>Visit #</label>
                      <input type="number" min={1} max={8} value={form.visitNumber} onChange={e => setForm({ ...form, visitNumber: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                    <div>
                      <label>GA (weeks)</label>
                      <input type="number" min={4} max={44} value={form.gestationalAge} onChange={e => setForm({ ...form, gestationalAge: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>
                </div>

                {/* Clinical Assessment */}
                <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>Clinical Assessment</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label>BP (mmHg)</label>
                      <input type="text" value={form.bloodPressure} onChange={e => setForm({ ...form, bloodPressure: e.target.value })} placeholder="120/80" />
                    </div>
                    <div>
                      <label>Weight (kg)</label>
                      <input type="number" step="0.1" value={form.weight || ''} onChange={e => setForm({ ...form, weight: parseFloat(e.target.value) })} />
                    </div>
                    <div>
                      <label>Fundal Height</label>
                      <input type="number" value={form.fundalHeight || ''} onChange={e => setForm({ ...form, fundalHeight: parseInt(e.target.value) })} />
                    </div>
                    <div>
                      <label>Fetal HR (bpm)</label>
                      <input type="number" value={form.fetalHeartRate || ''} onChange={e => setForm({ ...form, fetalHeartRate: parseInt(e.target.value) })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <div>
                      <label>Hemoglobin</label>
                      <input type="number" step="0.1" value={form.hemoglobin || ''} onChange={e => setForm({ ...form, hemoglobin: parseFloat(e.target.value) })} />
                    </div>
                    <div>
                      <label>Urine Protein</label>
                      <Select value={form.urineProtein} onChange={e => setForm({ ...form, urineProtein: e.target.value })}>
                        <option>Negative</option><option>Trace</option><option>+</option><option>++</option><option>+++</option>
                      </Select>
                    </div>
                    <div>
                      <label>Blood Group</label>
                      <Select value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value })}>
                        <option>O</option><option>A</option><option>B</option><option>AB</option>
                      </Select>
                    </div>
                    <div>
                      <label>Rh Factor</label>
                      <Select value={form.rhFactor} onChange={e => setForm({ ...form, rhFactor: e.target.value })}>
                        <option>+</option><option>-</option>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Lab & Interventions */}
                <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>Lab & Interventions</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label>HIV Status</label>
                      <Select value={form.hivStatus} onChange={e => setForm({ ...form, hivStatus: e.target.value })}>
                        <option>Not tested</option><option>Negative</option><option>Positive</option><option>Positive (on ART)</option>
                      </Select>
                    </div>
                    <div>
                      <label>Malaria Test</label>
                      <Select value={form.malariaTest} onChange={e => setForm({ ...form, malariaTest: e.target.value })}>
                        <option>Negative</option><option>Positive</option><option>Not tested</option>
                      </Select>
                    </div>
                    <div>
                      <label>Syphilis Test</label>
                      <Select value={form.syphilisTest} onChange={e => setForm({ ...form, syphilisTest: e.target.value })}>
                        <option>Non-reactive</option><option>Reactive</option><option>Not tested</option>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 mt-3">
                    <label className="flex items-center gap-2 cursor-pointer" style={{ textTransform: 'none', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={form.ironFolateGiven} onChange={e => setForm({ ...form, ironFolateGiven: e.target.checked })} className="w-4 h-4" />
                      Iron/Folate given
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer" style={{ textTransform: 'none', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={form.tetanusVaccine} onChange={e => setForm({ ...form, tetanusVaccine: e.target.checked })} className="w-4 h-4" />
                      Tetanus vaccine
                    </label>
                    <div className="flex items-center gap-2">
                      <label style={{ textTransform: 'none', fontSize: '0.875rem', marginBottom: 0 }}>IPTp Dose:</label>
                      <input type="number" min={0} max={5} value={form.iptpDose} onChange={e => setForm({ ...form, iptpDose: parseInt(e.target.value) })} style={{ width: '60px' }} />
                    </div>
                  </div>
                </div>

                {/* Risk Assessment */}
                <div className="p-3 rounded-lg" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>Risk Assessment</p>
                  <div className="mb-3">
                    <label>Risk Level</label>
                    <Select value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value as 'low' | 'moderate' | 'high' })}>
                      <option value="low">Low</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <label style={{ marginBottom: 0 }}>Risk Factors</label>
                    {form.riskFactors.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, riskFactors: [] })}
                        className="text-[10px] font-semibold"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        {t('action.clear')}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {RISK_FACTOR_OPTIONS.map(rf => (
                      <button
                        key={rf}
                        type="button"
                        onClick={() => {
                          const has = form.riskFactors.includes(rf);
                          setForm({ ...form, riskFactors: has ? form.riskFactors.filter(r => r !== rf) : [...form.riskFactors, rf] });
                        }}
                        className="text-xs px-2 py-1 rounded-full border transition-colors"
                        style={{
                          borderColor: form.riskFactors.includes(rf) ? 'var(--color-danger)' : 'var(--border-light)',
                          background: form.riskFactors.includes(rf) ? 'rgba(224, 49, 39,0.12)' : 'transparent',
                          color: form.riskFactors.includes(rf) ? 'var(--color-danger-text)' : 'var(--text-muted)',
                        }}
                      >
                        {rf.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dates & Notes */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>Visit Date</label>
                    <input type="date" required value={form.visitDate} onChange={e => setForm({ ...form, visitDate: e.target.value })} />
                  </div>
                  <div>
                    <label>Next Visit Date</label>
                    <input type="date" value={form.nextVisitDate} onChange={e => setForm({ ...form, nextVisitDate: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Clinical notes..." />
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn btn-primary flex-1">
                    <HeartPulse className="w-4 h-4" /> Register Visit
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit / Correct a saved ANC visit */}
        {editVisit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="card-elevated p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fadeIn" style={{ margin: '20px' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{t('action.edit')} · ANC {editVisit.visitNumber} · {editVisit.motherName}</h3>
                <button onClick={() => setEditVisit(null)} className="p-1 rounded-lg hover:bg-[var(--overlay-light)]">
                  <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <form onSubmit={handleEditSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>Visit Date</label>
                    <input type="date" value={editVisit.visitDate} onChange={e => setEditVisit({ ...editVisit, visitDate: e.target.value })} />
                  </div>
                  <div>
                    <label>GA (weeks)</label>
                    <input type="number" min={4} max={44} value={editVisit.gestationalAge} onChange={e => setEditVisit({ ...editVisit, gestationalAge: parseInt(e.target.value, 10) || 0 })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label>BP (mmHg)</label>
                    <input type="text" value={editVisit.bloodPressure} onChange={e => setEditVisit({ ...editVisit, bloodPressure: e.target.value })} placeholder="120/80" />
                  </div>
                  <div>
                    <label>Weight (kg)</label>
                    <input type="number" step="0.1" value={editVisit.weight || ''} onChange={e => setEditVisit({ ...editVisit, weight: parseFloat(e.target.value) })} />
                  </div>
                  <div>
                    <label>Hemoglobin</label>
                    <input type="number" step="0.1" value={editVisit.hemoglobin || ''} onChange={e => setEditVisit({ ...editVisit, hemoglobin: parseFloat(e.target.value) })} />
                  </div>
                  <div>
                    <label>Fetal HR (bpm)</label>
                    <input type="number" value={editVisit.fetalHeartRate || ''} onChange={e => setEditVisit({ ...editVisit, fetalHeartRate: parseInt(e.target.value) })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label>Risk Level</label>
                    <Select value={editVisit.riskLevel} onChange={e => setEditVisit({ ...editVisit, riskLevel: e.target.value as 'low' | 'moderate' | 'high' })}>
                      <option value="low">Low</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                    </Select>
                  </div>
                  <div>
                    <label>Next Visit Date</label>
                    <input type="date" value={editVisit.nextVisitDate || ''} onChange={e => setEditVisit({ ...editVisit, nextVisitDate: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label>Notes</label>
                  <textarea rows={2} value={editVisit.notes || ''} onChange={e => setEditVisit({ ...editVisit, notes: e.target.value })} placeholder="Clinical notes..." />
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditVisit(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
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
