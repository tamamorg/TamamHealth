'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import { useFacilityAssessments } from '@/lib/hooks/useFacilityAssessments';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Building2, ClipboardCheck, Wifi, Droplets, Users, Activity, TrendingUp, ChevronDown, ChevronUp, Plus, X } from '@/components/icons/lucide';
import Badge from '@/components/Badge';
import Select from '@/components/Select';

/**
 * Default values for the minimal create-assessment form. The full
 * FacilityAssessmentDoc schema has ~25 fields; to keep the form usable
 * in the field we capture the 6 score axes + core infrastructure
 * booleans and derive the overall score as an average.
 */
const EMPTY_FORM = {
  facilityId: '',
  assessmentDate: new Date().toISOString().slice(0, 10),
  generalEquipmentScore: 70,
  diagnosticCapacityScore: 70,
  essentialMedicinesScore: 70,
  infectionControlScore: 70,
  staffingScore: 70,
  powerReliabilityScore: 70,
  reportingCompleteness: 70,
  reportingTimeliness: 70,
  dataQualityScore: 70,
  hisStaffCount: 1,
  hisStaffTrained: 1,
  hasCleanWater: true,
  hasSanitation: true,
  hasWasteManagement: true,
  hasEmergencyTransport: false,
  hasCommunication: true,
  hasPatientRegisters: true,
  hasDHIS2Reporting: false,
  recommendations: '',
};

export default function FacilityAssessmentsPage() {
  const { assessments, summary, loading, create } = useFacilityAssessments();
  const { hospitals } = useHospitals();
  const { currentUser } = useAuth();
  const { canAssessFacility } = usePermissions();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [expandedAssessment, setExpandedAssessment] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <main className="page-container flex items-center justify-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.loading')}</p></main>;

  const scoreColor = (score: number) => score >= 70 ? 'var(--accent-primary)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
  const scoreBg = (score: number) => score >= 70 ? 'rgba(33, 145, 208, 0.12)' : score >= 50 ? 'rgba(252,211,77,0.12)' : 'rgba(229,46,66,0.12)';

  const handleSubmit = async () => {
    if (!form.facilityId) {
      showToast(t('facilityAssessments.toastChooseFacility'), 'error');
      return;
    }
    const facility = hospitals.find(h => h._id === form.facilityId);
    if (!facility) {
      showToast(t('facilityAssessments.toastFacilityNotFound'), 'error');
      return;
    }
    // Overall score = average of the six service-readiness axes.
    const overall = Math.round((
      form.generalEquipmentScore +
      form.diagnosticCapacityScore +
      form.essentialMedicinesScore +
      form.infectionControlScore +
      form.staffingScore +
      form.powerReliabilityScore
    ) / 6);
    try {
      setSubmitting(true);
      await create({
        facilityId: facility._id,
        facilityName: facility.name,
        assessmentDate: form.assessmentDate,
        assessedBy: currentUser?.name || 'Unknown',
        generalEquipmentScore: form.generalEquipmentScore,
        diagnosticCapacityScore: form.diagnosticCapacityScore,
        essentialMedicinesScore: form.essentialMedicinesScore,
        infectionControlScore: form.infectionControlScore,
        hasCleanWater: form.hasCleanWater,
        hasSanitation: form.hasSanitation,
        hasWasteManagement: form.hasWasteManagement,
        hasEmergencyTransport: form.hasEmergencyTransport,
        hasCommunication: form.hasCommunication,
        powerReliabilityScore: form.powerReliabilityScore,
        staffingScore: form.staffingScore,
        hisStaffCount: form.hisStaffCount,
        hisStaffTrained: form.hisStaffTrained,
        hasPatientRegisters: form.hasPatientRegisters,
        hasDHIS2Reporting: form.hasDHIS2Reporting,
        reportingCompleteness: form.reportingCompleteness,
        reportingTimeliness: form.reportingTimeliness,
        dataQualityScore: form.dataQualityScore,
        overallScore: overall,
        state: facility.state,
        recommendations: form.recommendations,
        orgId: currentUser?.orgId,
      });
      showToast(t('facilityAssessments.toastRecorded'), 'success');
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error(err);
      showToast(t('facilityAssessments.toastSaveFailed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-container page-enter">
        {summary && (
          <>
            {/* National averages */}
            <div className="card-elevated p-4 mb-6">
              <h3 className="font-semibold text-sm mb-4">{t('facilityAssessments.nationalAvgTitle')}</h3>
              <div className="space-y-3">
                {[
                  { label: t('facilityAssessments.domainGeneralEquipment'), score: summary.avgEquipmentScore, icon: ClipboardCheck },
                  { label: t('facilityAssessments.domainDiagnosticCapacity'), score: summary.avgDiagnosticScore, icon: Activity },
                  { label: t('facilityAssessments.domainEssentialMedicines'), score: summary.avgMedicinesScore, icon: TrendingUp },
                  { label: t('facilityAssessments.domainStaffingAdequacy'), score: summary.avgStaffingScore, icon: Users },
                  { label: t('facilityAssessments.domainDataQuality'), score: summary.avgDataQuality, icon: Wifi },
                  { label: t('facilityAssessments.domainReportingCompleteness'), score: summary.avgReportingCompleteness, icon: Building2 },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-xs w-44" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                    <div className="flex-1 h-3 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${item.score}%`, background: scoreColor(item.score) }} />
                    </div>
                    <span className="text-sm font-bold w-12 text-right" style={{ color: scoreColor(item.score) }}>{item.score}%</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Facility detail table */}
        <div className="card-elevated overflow-hidden">
          <EhrListHeader
            title={t('facilityAssessments.individualTitle')}
            actions={canAssessFacility && (
              <button onClick={() => setShowForm(true)} className="btn btn-primary">
                <Plus className="w-4 h-4" /> {t('facilityAssessments.newAssessment')}
              </button>
            )}
          />
          <div className="ehr-list-scroll">
          {/* Wider so "2026-01-20" and the state names hold one line — at 6%
              the date broke across two rows and every row grew unevenly. */}
          <table className="data-table" style={{ minWidth: 1220, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('facilityAssessments.colFacility')}</th>
                <th>{t('facilityAssessments.colState')}</th>
                <th>{t('facilityAssessments.colOverall')}</th>
                <th>{t('facilityAssessments.colEquipment')}</th>
                <th>{t('facilityAssessments.colDiagnostics')}</th>
                <th>{t('facilityAssessments.colMedicines')}</th>
                <th>{t('facilityAssessments.colStaffing')}</th>
                <th>{t('facilityAssessments.colReporting')}</th>
                <th>{t('facilityAssessments.colDataQuality')}</th>
                <th>{t('facilityAssessments.colDHIS2')}</th>
                <th>{t('facilityAssessments.colHISStaff')}</th>
                <th>{t('facilityAssessments.colWater')}</th>
                <th>{t('facilityAssessments.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {(assessments || []).map(a => (
                <tr key={a._id} className="cursor-pointer hover:bg-[var(--table-row-hover)]" onClick={() => setExpandedAssessment(expandedAssessment === a._id ? null : a._id)}>
                  <td className="font-semibold text-sm" style={{ color: 'var(--accent-primary)' }}>{a.facilityName.replace(' Hospital', '').replace(' Teaching', '')}</td>
                  <td className="text-xs">{a.state}</td>
                  <td><span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: scoreBg(a.overallScore), color: scoreColor(a.overallScore) }}>{a.overallScore}%</span></td>
                  <td className="text-xs" style={{ color: scoreColor(a.generalEquipmentScore) }}>{a.generalEquipmentScore}%</td>
                  <td className="text-xs" style={{ color: scoreColor(a.diagnosticCapacityScore) }}>{a.diagnosticCapacityScore}%</td>
                  <td className="text-xs" style={{ color: scoreColor(a.essentialMedicinesScore) }}>{a.essentialMedicinesScore}%</td>
                  <td className="text-xs" style={{ color: scoreColor(a.staffingScore) }}>{a.staffingScore}%</td>
                  <td className="text-xs" style={{ color: scoreColor(a.reportingCompleteness) }}>{a.reportingCompleteness}%</td>
                  <td className="text-xs" style={{ color: scoreColor(a.dataQualityScore) }}>{a.dataQualityScore}%</td>
                  <td>{a.hasDHIS2Reporting ? <Badge tone="success">{t('facilityAssessments.yes')}</Badge> : <Badge tone="warning">{t('facilityAssessments.no')}</Badge>}</td>
                  <td className="text-sm text-center">{a.hisStaffCount} ({a.hisStaffTrained})</td>
                  <td>{a.hasCleanWater ? <Droplets className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} /> : <span className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{t('facilityAssessments.no')}</span>}</td>
                  <td className="text-xs font-mono">
                    <div className="flex items-center gap-1">
                      {a.assessmentDate}
                      {expandedAssessment === a._id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </div>
                  </td>
                </tr>
              ))}
              {expandedAssessment && (() => {
                const a = (assessments || []).find(x => x._id === expandedAssessment);
                if (!a) return null;
                return (
                  <tr>
                    <td colSpan={13} style={{ background: 'var(--overlay-subtle)', padding: 0 }}>
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailFacility')}</span>{a.facilityName}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailAssessedBy')}</span>{a.assessedBy}</div>
                          <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailAssessmentDate')}</span>{a.assessmentDate}</div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: t('facilityAssessments.infraCleanWater'), value: a.hasCleanWater },
                            { label: t('facilityAssessments.infraSanitation'), value: a.hasSanitation },
                            { label: t('facilityAssessments.infraWasteManagement'), value: a.hasWasteManagement },
                            { label: t('facilityAssessments.infraEmergencyTransport'), value: a.hasEmergencyTransport },
                            { label: t('facilityAssessments.infraCommunication'), value: a.hasCommunication },
                            { label: t('facilityAssessments.infraPatientRegisters'), value: a.hasPatientRegisters },
                            { label: t('facilityAssessments.infraDHIS2Reporting'), value: a.hasDHIS2Reporting },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-2 text-xs">
                              <span className="w-2 h-2 rounded-full" style={{ background: item.value ? 'var(--accent-primary)' : 'var(--color-danger)' }} />
                              <span>{item.label}: {item.value ? t('facilityAssessments.yes') : t('facilityAssessments.no')}</span>
                            </div>
                          ))}
                        </div>
                        {a.recommendations && (
                          <div className="p-3 rounded-lg" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
                            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.recommendations')}</p>
                            <p className="text-xs">{a.recommendations}</p>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          </div>
        </div>

        {/* Create Assessment Modal */}
        {showForm && (
          <Modal onClose={() => !submitting && setShowForm(false)}>
            <div className="modal-content card-elevated p-6 max-w-2xl w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h3 className="text-base font-semibold">{t('facilityAssessments.modalTitle')}</h3>
                </div>
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.formFacility')}</label>
                  <Select value={form.facilityId} onChange={e => setForm({ ...form, facilityId: e.target.value })}>
                    <option value="">{t('facilityAssessments.selectFacility')}</option>
                    {hospitals.map(h => <option key={h._id} value={h._id}>{h.name} ({h.state})</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.formAssessmentDate')}</label>
                  <input type="date" value={form.assessmentDate} onChange={e => setForm({ ...form, assessmentDate: e.target.value })} />
                </div>
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.sectionServiceReadiness')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {([
                  ['generalEquipmentScore', t('facilityAssessments.fieldGeneralEquipment')],
                  ['diagnosticCapacityScore', t('facilityAssessments.fieldDiagnostics')],
                  ['essentialMedicinesScore', t('facilityAssessments.fieldMedicines')],
                  ['infectionControlScore', t('facilityAssessments.fieldInfectionControl')],
                  ['staffingScore', t('facilityAssessments.fieldStaffing')],
                  ['powerReliabilityScore', t('facilityAssessments.fieldPowerReliability')],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
                    <input type="number" min={0} max={100} value={form[key]} onChange={e => setForm({ ...form, [key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })} />
                  </div>
                ))}
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.sectionDataManagement')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {([
                  ['reportingCompleteness', t('facilityAssessments.fieldReportingCompleteness')],
                  ['reportingTimeliness', t('facilityAssessments.fieldReportingTimeliness')],
                  ['dataQualityScore', t('facilityAssessments.fieldDataQuality')],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
                    <input type="number" min={0} max={100} value={form[key]} onChange={e => setForm({ ...form, [key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })} />
                  </div>
                ))}
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider mt-2 mb-2" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.sectionInfrastructure')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {([
                  ['hasCleanWater', t('facilityAssessments.infraCleanWater')],
                  ['hasSanitation', t('facilityAssessments.infraSanitation')],
                  ['hasWasteManagement', t('facilityAssessments.infraWasteMgmt')],
                  ['hasEmergencyTransport', t('facilityAssessments.infraEmergencyTransport')],
                  ['hasCommunication', t('facilityAssessments.infraCommunication')],
                  ['hasPatientRegisters', t('facilityAssessments.infraPatientRegisters')],
                  ['hasDHIS2Reporting', t('facilityAssessments.infraDHIS2Reporting')],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer" style={{ background: 'var(--overlay-subtle)' }}>
                    <input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>{t('facilityAssessments.fieldHISStaffCount')}</label>
                  <input type="number" min={0} value={form.hisStaffCount} onChange={e => setForm({ ...form, hisStaffCount: Math.max(0, parseInt(e.target.value) || 0) })} />
                </div>
                <div>
                  <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>{t('facilityAssessments.fieldHISStaffTrained')}</label>
                  <input type="number" min={0} value={form.hisStaffTrained} onChange={e => setForm({ ...form, hisStaffTrained: Math.max(0, parseInt(e.target.value) || 0) })} />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>{t('facilityAssessments.recommendations')}</label>
                <textarea rows={3} value={form.recommendations} onChange={e => setForm({ ...form, recommendations: e.target.value })} placeholder={t('facilityAssessments.recommendationsPlaceholder')} />
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary flex-1" disabled={submitting}>{t('action.cancel')}</button>
                <button type="button" onClick={handleSubmit} className="btn btn-primary flex-1" disabled={submitting}>
                  {submitting ? t('facilityAssessments.saving') : t('facilityAssessments.saveAssessment')}
                </button>
              </div>
            </div>
          </Modal>
        )}
    </main>
  );
}
