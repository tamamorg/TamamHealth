'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Modal from '@/components/Modal';
import PatientName from '@/components/PatientName';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { BedDouble, ChevronRight, Plus, X, AlertTriangle, CheckCircle2, Filter, ExternalLink } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';

// Shared column template for the admissions table header + rows:
// Patient · Ward · Diagnosis · Severity · Discharge action
const ADMISSION_GRID = 'minmax(0, 1.7fr) minmax(0, 1fr) minmax(0, 2fr) 96px 132px';

export default function WardsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { patients } = usePatients();
  const { wards, beds, activeAdmissions, totalBeds, occupiedBeds, availableBeds, occupancyRate, admit, discharge } = useWards();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const admitFromQueryRef = useRef(false);

  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeFor, setDischargeFor] = useState<AdmissionDoc | null>(null);
  const [filterWard, setFilterWard] = useState<string>('');
  const [admissionSearch, setAdmissionSearch] = useState('');
  const [showWardFilter, setShowWardFilter] = useState(false);
  const wardFilterRef = useRef<HTMLDivElement>(null);
  const activeFilterCount = filterWard ? 1 : 0;
  const clearFilters = () => { setFilterWard(''); };

  const [admitForm, setAdmitForm] = useState({
    patientId: '',
    admittingDiagnosis: '',
    severity: 'moderate' as AdmissionDoc['severity'],
    wardId: '',
    bedId: '',
    isolationRequired: false,
    encounterId: '',
  });

  const [dischargeForm, setDischargeForm] = useState({
    dischargeType: 'normal' as NonNullable<AdmissionDoc['dischargeType']>,
    dischargeSummary: '',
    followUpRequired: false,
  });

  // Deep link from consultation (?admitPatientId=&diagnosis=&encounterId=): open
  // the admit modal pre-filled with the patient, diagnosis, and the open visit
  // just captured there, instead of leaving the clinician to reselect both
  // from scratch — and losing the encounterId means the admission never closes
  // the OPD visit it grew out of.
  useEffect(() => {
    const admitPatientId = searchParams?.get('admitPatientId');
    if (!admitPatientId || admitFromQueryRef.current) return;
    if (!patients.some(p => p._id === admitPatientId)) return;
    admitFromQueryRef.current = true;
    const diagnosis = searchParams?.get('diagnosis') || '';
    const encounterId = searchParams?.get('encounterId') || '';
    setAdmitForm(prev => ({ ...prev, patientId: admitPatientId, admittingDiagnosis: diagnosis, encounterId }));
    setAdmitOpen(true);
  }, [searchParams, patients]);

  const facilityId = currentUser?.hospitalId || currentUser?.hospital?._id;
  const facilityWards = useMemo(
    () => facilityId ? wards.filter(w => w.facilityId === facilityId) : wards,
    [wards, facilityId],
  );
  const filteredAdmissions = useMemo(
    () => {
      const q = admissionSearch.trim().toLowerCase();
      return activeAdmissions.filter(a => {
        const matchesWard = !filterWard || a.wardId === filterWard;
        const haystack = `${a.patientName} ${a.admittingDiagnosis} ${a.wardName} ${a.bedNumber || ''} ${a.severity}`.toLowerCase();
        const matchesSearch = !q || q.split(/\s+/).every(term => haystack.includes(term));
        return matchesWard && matchesSearch;
      });
    },
    [activeAdmissions, filterWard, admissionSearch],
  );

  // Beds actually free in the chosen ward — without this the admit modal's
  // bed field was free text, `bedId` never got set, `updateBedStatus` never
  // ran, and ward occupancy sat at 0% no matter how many patients were admitted.
  const availableBedsForWard = useMemo(
    () => admitForm.wardId ? beds.filter(b => b.wardId === admitForm.wardId && b.status === 'available') : [],
    [beds, admitForm.wardId],
  );

  const handleAdmit = async () => {
    const patient = patients.find(p => p._id === admitForm.patientId);
    const ward = facilityWards.find(w => w._id === admitForm.wardId);
    if (!patient || !ward) {
      showToast(t('ward.selectPatientAndWard'), 'error');
      return;
    }
    if (!admitForm.admittingDiagnosis.trim()) {
      showToast(t('ward.diagnosisRequiredToast'), 'error');
      return;
    }
    if (!currentUser) return;
    const bed = admitForm.bedId ? beds.find(b => b._id === admitForm.bedId) : undefined;
    try {
      await admit({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        hospitalNumber: patient.hospitalNumber,
        admittingDiagnosis: admitForm.admittingDiagnosis.trim(),
        severity: admitForm.severity,
        admittedBy: currentUser._id || currentUser.username || 'unknown',
        admittedByName: currentUser.name,
        wardId: ward._id,
        wardName: ward.name,
        bedId: bed?._id,
        bedNumber: bed?.bedNumber,
        facilityId: ward.facilityId,
        facilityName: ward.facilityName,
        facilityLevel: ward.facilityLevel,
        attendingPhysician: currentUser._id || currentUser.username || 'unknown',
        attendingPhysicianName: currentUser.name,
        isolationRequired: admitForm.isolationRequired,
        // Prefer patient's geographic state; fall back to the admitting
        // facility's state. Previously this fell back to `ward.facilityName`,
        // which would write the hospital's name into the geographic state
        // field — corrupting downstream surveillance/analytics joins that
        // expect a state code (e.g. "Central Equatoria"), not a hospital
        // ("Juba Teaching Hospital").
        state: patient.state || currentUser.hospital?.state || '',
        // Closes the OPD visit this admission grew out of, when the admit
        // modal was opened from one (deep-linked ?encounterId=). Best-effort
        // on the service side — an admission never fails because of this.
        encounterId: admitForm.encounterId || undefined,
      });
      showToast(t('ward.admittedToast', { name: `${patient.firstName} ${patient.surname}`, ward: ward.name }), 'success');
      setAdmitOpen(false);
      setAdmitForm({ patientId: '', admittingDiagnosis: '', severity: 'moderate', wardId: '', bedId: '', isolationRequired: false, encounterId: '' });
    } catch (err) {
      console.error(err);
      showToast(t('ward.admitFailedToast'), 'error');
    }
  };

  const handleDischarge = async () => {
    if (!dischargeFor || !currentUser) return;
    try {
      await discharge(dischargeFor._id, {
        dischargeType: dischargeForm.dischargeType,
        dischargeSummary: dischargeForm.dischargeSummary.trim() || undefined,
        dischargedBy: currentUser._id || currentUser.username || 'unknown',
        dischargedByName: currentUser.name,
        followUpRequired: dischargeForm.followUpRequired,
      });
      showToast(t('ward.dischargedToast', { name: dischargeFor.patientName }), 'success');
      setDischargeFor(null);
      setDischargeForm({ dischargeType: 'normal', dischargeSummary: '', followUpRequired: false });
    } catch (err) {
      console.error(err);
      showToast(t('ward.dischargeFailedToast'), 'error');
    }
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div className="card-elevated overflow-hidden flex flex-col" data-tour="ward-admissions" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('ward.currentAdmissions')}
            stats={[
              { label: t('ward.kpiTotalBeds'), value: totalBeds, color: LIST_STAT_COLORS.muted },
              { label: t('ward.kpiOccupied'), value: occupiedBeds, color: LIST_STAT_COLORS.blue },
              { label: t('ward.kpiAvailable'), value: availableBeds, color: LIST_STAT_COLORS.green },
              { label: t('ward.kpiOccupancy'), value: `${occupancyRate}%`, color: occupancyRate > 90 ? 'var(--color-danger-text)' : occupancyRate > 75 ? LIST_STAT_COLORS.amber : LIST_STAT_COLORS.blue },
            ]}
            search={{ value: admissionSearch, onChange: setAdmissionSearch, placeholder: 'Search by patient, ward, or diagnosis…' }}
            actions={
              <>
                {facilityWards.length > 0 && (
                  <div className="relative" ref={wardFilterRef}>
                    <EhrListHeaderButton onClick={() => setShowWardFilter(s => !s)} active={activeFilterCount > 0} ariaExpanded={showWardFilter} ariaLabel="Filters">
                      <Filter className="w-4 h-4" />
                      {activeFilterCount > 0 && (
                        <span className="absolute inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold" style={{ top: -4, right: -4, background: 'var(--accent-primary)', color: '#fff' }}>
                          {activeFilterCount}
                        </span>
                      )}
                    </EhrListHeaderButton>
                    {showWardFilter && (
                      <div className="absolute start-0 mt-2 rounded-2xl overflow-hidden z-50"
                        style={{ width: 240, background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
                        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
                          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Filter by ward</span>
                          {activeFilterCount > 0 && (
                            <button onClick={() => { clearFilters(); setShowWardFilter(false); }} className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Clear</button>
                          )}
                        </div>
                        <div className="p-3">
                          <Select value={filterWard} onChange={e => { setFilterWard(e.target.value); setShowWardFilter(false); }}
                            style={{ width: 'auto', minWidth: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', fontSize: 13 }}>
                            <option value="">All wards</option>
                            {facilityWards.map(w => (
                              <option key={w._id} value={w._id}>{w.name} ({w.occupiedBeds}/{w.totalBeds})</option>
                            ))}
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => setAdmitOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', borderRadius: 999, background: 'var(--accent-primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <Plus className="w-4 h-4" /> {t('ward.admitPatient')}
                </button>
              </>
            }
          />
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {filteredAdmissions.length === 0 ? (
            <EmptyState
              icon={BedDouble}
              title={t('ward.currentAdmissions')}
              message={filterWard ? t('ward.noActiveAdmissionsInWard') : t('ward.noActiveAdmissions')}
            />
          ) : (
            <div>
              {/* Table header */}
              <div
                className="grid items-center gap-3 px-4 py-2.5 sticky top-0 z-10"
                style={{
                  gridTemplateColumns: ADMISSION_GRID,
                  background: 'var(--bg-card-solid)',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                {[t('ward.colPatient'), t('ward.colWard'), t('ward.colDiagnosis'), t('ward.severity'), ''].map((h, i) => (
                  <div key={i} className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</div>
                ))}
              </div>
              {filteredAdmissions.map(a => {
                const sevTone = a.severity === 'critical' ? 'danger' : a.severity === 'severe' ? 'warning' : a.severity === 'moderate' ? 'info' : 'success';
                const days = Math.max(1, Math.ceil((Date.now() - new Date(a.admissionDate).getTime()) / 86400000));
                return (
                  <div
                    key={a._id}
                    className="grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--table-row-hover)]"
                    style={{
                      gridTemplateColumns: ADMISSION_GRID,
                      borderBottom: '1px solid var(--border-light)',
                      background: a.severity === 'critical' ? 'rgba(224, 49, 39, 0.04)' : 'transparent',
                    }}
                  >
                    {/* Patient */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <PatientName patientId={a.patientId} name={a.patientName} nameClassName="text-[12.5px]" />
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--overlay-subtle)] flex-shrink-0"
                          title={`Open ${a.patientName}'s chart`}
                          aria-label={`Open ${a.patientName}'s chart`}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/patients/${a.patientId}?tab=overview`);
                          }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* Ward */}
                    <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>{a.wardName}</div>
                    {/* Diagnosis + day */}
                    <div className="flex items-center gap-2 min-w-0 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <span className="truncate">{a.admittingDiagnosis}</span>
                      <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>· {t('ward.dayCount', { day: days })}</span>
                      {a.isolationRequired && <Badge tone="danger" uppercase className="justify-self-start">{t('ward.isolation')}</Badge>}
                    </div>
                    {/* Severity */}
                    <span className="justify-self-start">
                      <Badge tone={sevTone} uppercase>{a.severity}</Badge>
                    </span>
                    {/* Action */}
                    <button onClick={() => setDischargeFor(a)} className="btn btn-secondary btn-sm justify-self-end">{t('ward.discharge')} <ChevronRight className="w-3 h-3" /></button>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>

        {/* Admit modal */}
        {admitOpen && (
          <Modal onClose={() => setAdmitOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-lg w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('ward.admitPatient')}</h3>
                <button onClick={() => setAdmitOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.patientRequired')}</label>
                  {/* Changing the patient drops the deep-linked visit — an
                      encounterId belongs to the patient it arrived with. */}
                  <Select value={admitForm.patientId} onChange={e => setAdmitForm({ ...admitForm, patientId: e.target.value, encounterId: '' })}>
                    <option value="">{t('ward.selectPatient')}</option>
                    {patients.slice(0, 200).map(p => (
                      <option key={p._id} value={p._id}>{p.firstName} {p.surname} · {p.hospitalNumber}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.admittingDiagnosisRequired')}</label>
                  <input type="text" value={admitForm.admittingDiagnosis} onChange={e => setAdmitForm({ ...admitForm, admittingDiagnosis: e.target.value })} placeholder={t('ward.admittingDiagnosisPlaceholder')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.severity')}</label>
                    <Select value={admitForm.severity} onChange={e => setAdmitForm({ ...admitForm, severity: e.target.value as AdmissionDoc['severity'] })}>
                      <option value="mild">{t('ward.severityMild')}</option>
                      <option value="moderate">{t('ward.severityModerate')}</option>
                      <option value="severe">{t('ward.severitySevere')}</option>
                      <option value="critical">{t('ward.severityCritical')}</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.wardRequired')}</label>
                    <Select value={admitForm.wardId} onChange={e => setAdmitForm({ ...admitForm, wardId: e.target.value, bedId: '' })}>
                      <option value="">{t('ward.selectWard')}</option>
                      {facilityWards.filter(w => w.availableBeds > 0).map(w => (
                        <option key={w._id} value={w._id}>{t('ward.wardFree', { name: w.name, count: w.availableBeds })}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.bedNumber')}</label>
                    <Select value={admitForm.bedId} onChange={e => setAdmitForm({ ...admitForm, bedId: e.target.value })} disabled={!admitForm.wardId}>
                      <option value="">{admitForm.wardId ? t('ward.optional') : t('ward.selectWard')}</option>
                      {availableBedsForWard.map(b => (
                        <option key={b._id} value={b._id}>{b.bedNumber}</option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 mt-5 text-sm" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={admitForm.isolationRequired} onChange={e => setAdmitForm({ ...admitForm, isolationRequired: e.target.checked })} />
                    {t('ward.isolationRequired')}
                  </label>
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setAdmitOpen(false)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleAdmit} className="btn btn-primary flex-1">{t('ward.admit')}</button>
              </div>
            </div>
          </Modal>
        )}

        {/* Discharge modal */}
        {dischargeFor && (
          <Modal onClose={() => setDischargeFor(null)}>
            <div className="modal-content card-elevated p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold">{t('ward.dischargePatient')}</h3>
                  <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{dischargeFor.patientName} · {dischargeFor.wardName}</p>
                </div>
                <button onClick={() => setDischargeFor(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.dischargeType')}</label>
                  <Select value={dischargeForm.dischargeType} onChange={e => setDischargeForm({ ...dischargeForm, dischargeType: e.target.value as NonNullable<AdmissionDoc['dischargeType']> })}>
                    <option value="normal">{t('ward.dischargeTypeNormal')}</option>
                    <option value="against_medical_advice">{t('ward.dischargeTypeAma')}</option>
                    <option value="transfer">{t('ward.dischargeTypeTransfer')}</option>
                    <option value="death">{t('ward.dischargeTypeDeath')}</option>
                    <option value="absconded">{t('ward.dischargeTypeAbsconded')}</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.dischargeSummary')}</label>
                  <textarea rows={3} value={dischargeForm.dischargeSummary} onChange={e => setDischargeForm({ ...dischargeForm, dischargeSummary: e.target.value })} placeholder={t('ward.dischargeSummaryPlaceholder')} />
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={dischargeForm.followUpRequired} onChange={e => setDischargeForm({ ...dischargeForm, followUpRequired: e.target.checked })} />
                  {t('ward.followUpRequired')}
                </label>
                {dischargeForm.dischargeType === 'death' ? (
                  <div className="text-[12px] flex items-center gap-2" style={{ color: 'var(--color-danger-text)' }}>
                    <AlertTriangle className="w-3.5 h-3.5" /> {t('ward.deathRecordNotice')}
                  </div>
                ) : (
                  <div className="text-[12px] flex items-center gap-2" style={{ color: 'var(--color-success-text)' }}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t('ward.bedReleasedNotice')}
                  </div>
                )}
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setDischargeFor(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleDischarge} className="btn btn-primary flex-1">{t('ward.discharge')}</button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </>
  );
}
