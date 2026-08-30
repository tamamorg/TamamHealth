'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import {
  SadbPage, SadbCard, SadbPanelHeader, SadbKpiTile, SadbKvRow, SadbChip,
  SadbGridList, SadbGridRow,
} from '@/components/admin/sadb-ui';
import type { ChipTone } from '@/components/admin/sadb-ui';
import { useFacilityAssessments } from '@/lib/hooks/useFacilityAssessments';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useAuth } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Building2, ClipboardCheck, Wifi, Droplets, Users, Activity, TrendingUp, ChevronDown, ChevronUp, Plus, X } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';
import { stopsClickPropagation } from '@/lib/a11y';
import type { UserRole } from '@/lib/db-types';

/**
 * Restyled onto the shared admin console kit (sadb-*) 2026-08-30, matching the
 * anatomy of every /admin/* screen and the org-admin console (see
 * FacilityManagementDashboard): a page-level actions row, a KPI tile band, a
 * readiness-by-domain card, and the per-facility scorecard as a grid list.
 * Behavior, hooks, and permission checks are unchanged — only the markup.
 */

/** Every role role-routes.ts grants '/facility-assessments' to (super_admin,
 *  government, county_health_director, data_entry_clerk,
 *  medical_superintendent, hrio, hospital_manager, records_hmis_officer).
 *  Kept in sync with that table — SadbPage's role check is defense-in-depth
 *  on top of the Edge proxy gate, not a second source of truth. */
const ASSESSMENT_ROLES: UserRole[] = [
  'super_admin', 'government', 'county_health_director', 'data_entry_clerk',
  'medical_superintendent', 'hrio', 'hospital_manager', 'records_hmis_officer',
];

/* Facility · State · Overall · Equipment · Diagnostics · Medicines ·
   Staffing · Reporting · Data Quality · DHIS2 · HIS Staff · Water · Date */
const ASSESS_GRID = [
  'minmax(140px, 1.5fr)', 'minmax(70px, 0.8fr)', 'minmax(64px, 0.7fr)',
  'minmax(56px, 0.65fr)', 'minmax(56px, 0.65fr)', 'minmax(56px, 0.65fr)',
  'minmax(56px, 0.6fr)', 'minmax(56px, 0.65fr)', 'minmax(60px, 0.65fr)',
  'minmax(58px, 0.6fr)', 'minmax(70px, 0.7fr)', 'minmax(50px, 0.55fr)',
  'minmax(110px, 0.9fr)',
].join(' ');

/**
 * Default values for the minimal create-assessment form. The full
 * FacilityAssessmentDoc schema has ~25 fields; to keep the form usable
 * in the field we capture the 6 score axes + core infrastructure
 * booleans and derive the overall score as an average.
 */
// Every score starts at 0 and every capability at false — nothing defaults
// to "adequate". The old form pre-filled every axis at 70 and most booleans
// at true, so an assessor who submitted without editing filed a
// plausible-looking 70%-across-the-board assessment that flowed into
// /data-quality, the /public-stats readiness bars and the /government
// completeness choropleth as measured data.
const EMPTY_FORM = {
  facilityId: '',
  assessmentDate: todayIso(),
  generalEquipmentScore: 0,
  diagnosticCapacityScore: 0,
  essentialMedicinesScore: 0,
  infectionControlScore: 0,
  staffingScore: 0,
  powerReliabilityScore: 0,
  reportingCompleteness: 0,
  reportingTimeliness: 0,
  dataQualityScore: 0,
  hisStaffCount: 0,
  hisStaffTrained: 0,
  hasCleanWater: false,
  hasSanitation: false,
  hasWasteManagement: false,
  hasEmergencyTransport: false,
  hasCommunication: false,
  hasPatientRegisters: false,
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

  if (loading) {
    return (
      <SadbPage roles={ASSESSMENT_ROLES}>
        <p className="sadb-empty" aria-live="polite">{t('status.loading')}</p>
      </SadbPage>
    );
  }

  // Readiness tone: >=70 ready, 50-69 partial, <50 a gap — the sadb chip
  // vocabulary (green/yellow/red) rather than the plain blue "good" ink the
  // pre-restyle table used.
  const scoreTone = (score: number): ChipTone => score >= 70 ? 'green' : score >= 50 ? 'yellow' : 'red';
  const scoreTextColor = (score: number) => score >= 70
    ? 'var(--color-success-800)'
    : score >= 50 ? 'var(--color-warning-700)' : 'var(--color-danger-text)';

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

  const rows = assessments || [];
  const facilitiesAssessedCount = new Set(rows.map(a => a.facilityId)).size;
  const avgOverallScore = rows.length ? Math.round(rows.reduce((sum, a) => sum + a.overallScore, 0) / rows.length) : null;
  const dhis2AdoptionPct = rows.length ? Math.round((rows.filter(a => a.hasDHIS2Reporting).length / rows.length) * 100) : null;

  const expandedRecord = expandedAssessment ? rows.find(x => x._id === expandedAssessment) ?? null : null;

  return (
    <SadbPage
      roles={ASSESSMENT_ROLES}
      actions={canAssessFacility && (
        <button onClick={() => setShowForm(true)} className="btn btn-primary">
          <Plus className="w-4 h-4" /> {t('facilityAssessments.newAssessment')}
        </button>
      )}
    >
      <SadbPanelHeader
        title={t('facilityAssessments.pageTitle')}
        note={t('facilityAssessments.pageSubtitle')}
      />

      {/* ═══ Headline readiness figures ═══ */}
      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('facilityAssessments.kpiFacilitiesAssessed')} value={facilitiesAssessedCount} />
        <SadbKpiTile label={t('facilityAssessments.kpiAvgOverallScore')} value={avgOverallScore !== null ? `${avgOverallScore}%` : '—'} />
        <SadbKpiTile label={t('facilityAssessments.kpiAvgReportingCompleteness')} value={summary ? `${summary.avgReportingCompleteness}%` : '—'} />
        <SadbKpiTile label={t('facilityAssessments.kpiDHIS2Adoption')} value={dhis2AdoptionPct !== null ? `${dhis2AdoptionPct}%` : '—'} />
      </div>

      {/* National averages by domain — onboarding tour anchor kept exactly
          (government.ts / county.ts both target this data-tour hook). */}
      {summary && (
        <div data-tour="facility-assess-summary">
          <SadbCard title={t('facilityAssessments.nationalAvgTitle')}>
            <div className="sadb-kv-fill">
              {[
                { label: t('facilityAssessments.domainGeneralEquipment'), score: summary.avgEquipmentScore, icon: ClipboardCheck },
                { label: t('facilityAssessments.domainDiagnosticCapacity'), score: summary.avgDiagnosticScore, icon: Activity },
                { label: t('facilityAssessments.domainEssentialMedicines'), score: summary.avgMedicinesScore, icon: TrendingUp },
                { label: t('facilityAssessments.domainStaffingAdequacy'), score: summary.avgStaffingScore, icon: Users },
                { label: t('facilityAssessments.domainDataQuality'), score: summary.avgDataQuality, icon: Wifi },
                { label: t('facilityAssessments.domainReportingCompleteness'), score: summary.avgReportingCompleteness, icon: Building2 },
              ].map(item => (
                <SadbKvRow
                  key={item.label}
                  label={(
                    <span className="flex items-center gap-2">
                      <item.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      {item.label}
                    </span>
                  )}
                  chip={`${item.score}%`}
                  chipTone={scoreTone(item.score)}
                />
              ))}
            </div>
          </SadbCard>
        </div>
      )}

      {/* ═══ Per-facility scorecards ═══ */}
      <SadbCard title={t('facilityAssessments.individualTitle')} meta={`${rows.length}`}>
        <SadbGridList
          template={ASSESS_GRID}
          minWidth={1180}
          head={[
            t('facilityAssessments.colFacility'), t('facilityAssessments.colState'), t('facilityAssessments.colOverall'),
            t('facilityAssessments.colEquipment'), t('facilityAssessments.colDiagnostics'), t('facilityAssessments.colMedicines'),
            t('facilityAssessments.colStaffing'), t('facilityAssessments.colReporting'), t('facilityAssessments.colDataQuality'),
            t('facilityAssessments.colDHIS2'), t('facilityAssessments.colHISStaff'), t('facilityAssessments.colWater'),
            t('facilityAssessments.colDate'),
          ]}
          empty={t('facilityAssessments.emptyList')}
        >
          {rows.map(a => (
            <SadbGridRow
              key={a._id}
              template={ASSESS_GRID}
              onClick={() => setExpandedAssessment(expandedAssessment === a._id ? null : a._id)}
              ariaExpanded={expandedAssessment === a._id}
            >
              <span className="min-w-0">
                <span className="sadb-tenant-name truncate">{a.facilityName.replace(' Hospital', '').replace(' Teaching', '')}</span>
              </span>
              <span className="truncate text-xs">{a.state}</span>
              <span><SadbChip tone={scoreTone(a.overallScore)}>{a.overallScore}%</SadbChip></span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.generalEquipmentScore) }}>{a.generalEquipmentScore}%</span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.diagnosticCapacityScore) }}>{a.diagnosticCapacityScore}%</span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.essentialMedicinesScore) }}>{a.essentialMedicinesScore}%</span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.staffingScore) }}>{a.staffingScore}%</span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.reportingCompleteness) }}>{a.reportingCompleteness}%</span>
              <span className="sadb-tenant-num" style={{ color: scoreTextColor(a.dataQualityScore) }}>{a.dataQualityScore}%</span>
              <span>
                <SadbChip tone={a.hasDHIS2Reporting ? 'green' : 'yellow'}>
                  {a.hasDHIS2Reporting ? t('facilityAssessments.yes') : t('facilityAssessments.no')}
                </SadbChip>
              </span>
              <span className="sadb-tenant-num">{a.hisStaffCount} ({a.hisStaffTrained})</span>
              <span>
                {a.hasCleanWater
                  ? <Droplets className="w-3.5 h-3.5" style={{ color: 'var(--color-success-800)' }} />
                  : <span className="text-xs" style={{ color: 'var(--color-danger-text)' }}>{t('facilityAssessments.no')}</span>}
              </span>
              <span className="text-xs font-mono flex items-center gap-1">
                {a.assessmentDate}
                {expandedAssessment === a._id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
            </SadbGridRow>
          ))}
        </SadbGridList>

        {expandedRecord && (
          <div className="p-4 space-y-3" style={{ borderTop: '1px solid var(--border-light)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailFacility')}</span>{expandedRecord.facilityName}</div>
              <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailAssessedBy')}</span>{expandedRecord.assessedBy}</div>
              <div><span className="font-semibold block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.detailAssessmentDate')}</span>{expandedRecord.assessmentDate}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                [expandedRecord.hasCleanWater, t('facilityAssessments.infraCleanWater')],
                [expandedRecord.hasSanitation, t('facilityAssessments.infraSanitation')],
                [expandedRecord.hasWasteManagement, t('facilityAssessments.infraWasteManagement')],
                [expandedRecord.hasEmergencyTransport, t('facilityAssessments.infraEmergencyTransport')],
                [expandedRecord.hasCommunication, t('facilityAssessments.infraCommunication')],
                [expandedRecord.hasPatientRegisters, t('facilityAssessments.infraPatientRegisters')],
                [expandedRecord.hasDHIS2Reporting, t('facilityAssessments.infraDHIS2Reporting')],
              ] as const).map(([value, label]) => (
                <SadbChip key={label} tone={value ? 'green' : 'red'}>{label}</SadbChip>
              ))}
            </div>
            {expandedRecord.recommendations && (
              <div className="p-3 rounded-lg" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>{t('facilityAssessments.recommendations')}</p>
                <p className="text-xs">{expandedRecord.recommendations}</p>
              </div>
            )}
          </div>
        )}
      </SadbCard>

      {/* Create Assessment Modal */}
      {showForm && (
        <Modal onClose={() => !submitting && setShowForm(false)}>
          <div className="modal-content card-elevated p-6 max-w-2xl w-full" {...stopsClickPropagation}>
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
    </SadbPage>
  );
}
