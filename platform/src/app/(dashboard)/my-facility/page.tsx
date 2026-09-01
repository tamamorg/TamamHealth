'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  Building2, Save, CheckCircle, AlertTriangle, Loader2, Send, Clock,
} from '@/components/icons/lucide';
import Select from '@/components/Select';
import {
  SadbPage, SadbCard, SadbSettingGroup, SadbSettingRow, SadbToggle, SadbChip,
} from '@/components/admin/sadb-ui';
import type { ChipTone } from '@/components/admin/sadb-ui';

// Roles this console page is routed to (lib/role-routes.ts) — medical_superintendent
// and hospital_manager both carry '/my-facility' in their allowed list, and
// super_admin reaches every SadbPage regardless of the roles passed here.
// Kept identical to the proxy's grant so this client-side gate never narrows
// (or widens) who can actually reach the page.
const MY_FACILITY_ROLES = ['medical_superintendent', 'hospital_manager', 'super_admin'] as const;

const STATUS_TONE: Record<string, ChipTone> = {
  functional: 'green',
  partially_functional: 'yellow',
  non_functional: 'red',
  closed: 'neutral',
};

export default function MyFacilityPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { hospitals, loading: hospitalsLoading, update } = useHospitals();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Form state
  const [operationalStatus, setOperationalStatus] = useState<string>('functional');
  const [totalBeds, setTotalBeds] = useState(0);
  const [icuBeds, setIcuBeds] = useState(0);
  const [maternityBeds, setMaternityBeds] = useState(0);
  const [pediatricBeds, setPediatricBeds] = useState(0);
  const [doctors, setDoctors] = useState(0);
  const [nurses, setNurses] = useState(0);
  const [clinicalOfficers, setClinicalOfficers] = useState(0);
  const [labTechnicians, setLabTechnicians] = useState(0);
  const [pharmacists, setPharmacists] = useState(0);
  const [hasElectricity, setHasElectricity] = useState(false);
  const [electricityHours, setElectricityHours] = useState(0);
  const [hasGenerator, setHasGenerator] = useState(false);
  const [hasSolar, setHasSolar] = useState(false);
  const [hasInternet, setHasInternet] = useState(false);
  const [internetType, setInternetType] = useState('');
  const [hasAmbulance, setHasAmbulance] = useState(false);
  const [emergency24hr, setEmergency24hr] = useState(false);
  const [serviceFlags, setServiceFlags] = useState({
    epi: false, anc: false, delivery: false, hiv: false,
    tb: false, emergencySurgery: false, laboratory: false, pharmacy: false,
  });

  const hospitalId = currentUser?.hospitalId;
  const hospital = hospitals.find(h => h._id === hospitalId);

  // Populate form when hospital loads
  useEffect(() => {
    if (!hospital) return;
    setOperationalStatus(hospital.operationalStatus || 'functional');
    setTotalBeds(hospital.totalBeds || 0);
    setIcuBeds(hospital.icuBeds || 0);
    setMaternityBeds(hospital.maternityBeds || 0);
    setPediatricBeds(hospital.pediatricBeds || 0);
    setDoctors(hospital.doctors || 0);
    setNurses(hospital.nurses || 0);
    setClinicalOfficers(hospital.clinicalOfficers || 0);
    setLabTechnicians(hospital.labTechnicians || 0);
    setPharmacists(hospital.pharmacists || 0);
    setHasElectricity(hospital.hasElectricity || false);
    setElectricityHours(hospital.electricityHours || 0);
    setHasGenerator(hospital.hasGenerator || false);
    setHasSolar(hospital.hasSolar || false);
    setHasInternet(hospital.hasInternet || false);
    setInternetType(hospital.internetType || '');
    setHasAmbulance(hospital.hasAmbulance || false);
    setEmergency24hr(hospital.emergency24hr || false);
    setServiceFlags(hospital.serviceFlags || {
      epi: false, anc: false, delivery: false, hiv: false,
      tb: false, emergencySurgery: false, laboratory: false, pharmacy: false,
    });
  }, [hospital]);

  const handleSave = useCallback(async () => {
    if (!hospitalId) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await update(hospitalId, {
        operationalStatus: operationalStatus as 'functional' | 'partially_functional' | 'non_functional' | 'closed',
        totalBeds, icuBeds, maternityBeds, pediatricBeds,
        doctors, nurses, clinicalOfficers, labTechnicians, pharmacists,
        hasElectricity, electricityHours, hasGenerator, hasSolar,
        hasInternet, internetType, hasAmbulance, emergency24hr,
        serviceFlags,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      // Surface the real failure (validation, 4xx/5xx, etc.) instead of a
      // generic message — silently swallowing the cause hid actual problems.
      setError(err instanceof Error ? err.message : t('myFacility.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [hospitalId, update, operationalStatus, totalBeds, icuBeds, maternityBeds, pediatricBeds, doctors, nurses, clinicalOfficers, labTechnicians, pharmacists, hasElectricity, electricityHours, hasGenerator, hasSolar, hasInternet, internetType, hasAmbulance, emergency24hr, serviceFlags, t]);

  const handleSubmitToMoH = useCallback(async () => {
    if (!hospitalId) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await update(hospitalId, {
        mohSubmission: {
          submittedAt: new Date().toISOString(),
          submittedBy: currentUser?._id || '',
          submittedByName: currentUser?.name,
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit to the Ministry of Health.');
    } finally {
      setSubmitting(false);
    }
  }, [hospitalId, update, currentUser]);

  const toggleService = (key: keyof typeof serviceFlags) => {
    setServiceFlags(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Compact row builders — every field stays a real, live-bound control
  // (not a read-only tile): this page edits the facility record, it doesn't
  // just report it.
  const numberField = (label: string, value: number, onChange: (v: number) => void, max?: number) => (
    <SadbSettingRow key={label} label={label}>
      <input
        type="number"
        min={0}
        max={max}
        className="sadb-modal-input"
        style={{ maxWidth: 120 }}
        value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      />
    </SadbSettingRow>
  );

  const toggleField = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <SadbSettingRow key={label} label={label}>
      <SadbToggle checked={checked} onChange={onChange} label={label} />
    </SadbSettingRow>
  );

  const statusLabels: Record<string, string> = {
    functional: t('myFacility.statusFunctional'),
    partially_functional: t('myFacility.statusPartiallyFunctional'),
    non_functional: t('myFacility.statusNonFunctional'),
    closed: t('myFacility.statusClosed'),
  };

  // Not assigned to a facility
  if (!hospitalId) {
    return (
      <SadbPage roles={[...MY_FACILITY_ROLES]}>
        <div className="sadb-card" style={{ maxWidth: 420, margin: '48px auto 0', padding: '32px 24px', textAlign: 'center' }}>
          <Building2 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            {t('myFacility.notAssignedTitle')}
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('myFacility.notAssignedDesc')}
          </p>
        </div>
      </SadbPage>
    );
  }

  if (hospitalsLoading) {
    return (
      <SadbPage roles={[...MY_FACILITY_ROLES]}>
        <p className="sadb-empty" aria-live="polite">
          <Loader2 className="w-4 h-4 inline-block me-2 animate-spin" style={{ verticalAlign: -3 }} />
          Loading facility data…
        </p>
      </SadbPage>
    );
  }

  return (
    <SadbPage
      roles={[...MY_FACILITY_ROLES]}
      greeting="My facility"
      actions={
        <>
          {error && (
            <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-danger-text)' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </span>
          )}
          {saved && (
            <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-success-text)' }}>
              <CheckCircle className="w-3.5 h-3.5" /> {t('myFacility.savedSuccessfully')}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t('consultation.saving') : t('appointments.saveChanges')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        {/* Operational Status */}
        <SadbSettingGroup title={t('myFacility.operationalStatus')}>
          <SadbSettingRow label={t('myFacility.currentStatus')}>
            <span className="flex items-center gap-2.5 flex-wrap justify-end">
              <Select
                value={operationalStatus}
                onChange={e => setOperationalStatus(e.target.value)}
                className="sadb-modal-input"
                style={{ maxWidth: 210 }}
              >
                <option value="functional">{t('myFacility.statusFunctional')}</option>
                <option value="partially_functional">{t('myFacility.statusPartiallyFunctional')}</option>
                <option value="non_functional">{t('myFacility.statusNonFunctional')}</option>
                <option value="closed">{t('myFacility.statusClosed')}</option>
              </Select>
              <SadbChip tone={STATUS_TONE[operationalStatus] ?? 'neutral'}>
                {statusLabels[operationalStatus] ?? operationalStatus}
              </SadbChip>
            </span>
          </SadbSettingRow>
        </SadbSettingGroup>

        {/* Bed Capacity */}
        <SadbSettingGroup title={t('myFacility.bedCapacity')}>
          {numberField(t('dataEntry.totalBeds'), totalBeds, setTotalBeds)}
          {numberField(t('dataEntry.icuBeds'), icuBeds, setIcuBeds)}
          {numberField(t('dataEntry.maternityBeds'), maternityBeds, setMaternityBeds)}
          {numberField(t('dataEntry.pediatricBeds'), pediatricBeds, setPediatricBeds)}
        </SadbSettingGroup>

        {/* Staffing */}
        <SadbSettingGroup title={t('myFacility.staffing')}>
          {numberField(t('dashboard.doctors'), doctors, setDoctors)}
          {numberField(t('dataEntry.nurses'), nurses, setNurses)}
          {numberField(t('dataEntry.clinicalOfficers'), clinicalOfficers, setClinicalOfficers)}
          {numberField(t('dataEntry.labTechnicians'), labTechnicians, setLabTechnicians)}
          {numberField(t('dataEntry.pharmacists'), pharmacists, setPharmacists)}
        </SadbSettingGroup>

        {/* Infrastructure */}
        <SadbSettingGroup title={t('myFacility.infrastructure')}>
          {toggleField(t('myFacility.hasElectricity'), hasElectricity, setHasElectricity)}
          {hasElectricity && numberField(t('myFacility.electricityHoursPerDay'), electricityHours, setElectricityHours, 24)}
          {toggleField(t('myFacility.hasGenerator'), hasGenerator, setHasGenerator)}
          {toggleField(t('myFacility.hasSolarPower'), hasSolar, setHasSolar)}
          {toggleField(t('myFacility.hasInternet'), hasInternet, setHasInternet)}
          {hasInternet && (
            <SadbSettingRow key="internet-type" label={t('myFacility.internetType')}>
              <Select
                value={internetType}
                onChange={e => setInternetType(e.target.value)}
                className="sadb-modal-input"
                style={{ maxWidth: 190 }}
              >
                <option value="">{t('myFacility.selectType')}</option>
                <option value="fiber">{t('myFacility.internetFiber')}</option>
                <option value="4g">{t('myFacility.internet4g')}</option>
                <option value="3g">{t('myFacility.internet3g')}</option>
                <option value="satellite">{t('myFacility.internetSatellite')}</option>
                <option value="dsl">{t('myFacility.internetDsl')}</option>
              </Select>
            </SadbSettingRow>
          )}
          {toggleField(t('myFacility.hasAmbulance'), hasAmbulance, setHasAmbulance)}
          {toggleField(t('myFacility.emergency24hr'), emergency24hr, setEmergency24hr)}
        </SadbSettingGroup>
      </div>

      {/* Services */}
      <SadbSettingGroup title={t('myFacility.servicesOffered')}>
        {toggleField(t('myFacility.serviceEpi'), serviceFlags.epi, () => toggleService('epi'))}
        {toggleField(t('anc.title'), serviceFlags.anc, () => toggleService('anc'))}
        {toggleField(t('myFacility.serviceDelivery'), serviceFlags.delivery, () => toggleService('delivery'))}
        {toggleField(t('boma.conditionHiv'), serviceFlags.hiv, () => toggleService('hiv'))}
        {toggleField(t('boma.conditionTb'), serviceFlags.tb, () => toggleService('tb'))}
        {toggleField(t('myFacility.serviceEmergencySurgery'), serviceFlags.emergencySurgery, () => toggleService('emergencySurgery'))}
        {toggleField(t('lab.laboratory'), serviceFlags.laboratory, () => toggleService('laboratory'))}
        {toggleField(t('nav.pharmacy'), serviceFlags.pharmacy, () => toggleService('pharmacy'))}
      </SadbSettingGroup>

      {/* Ministry of Health reporting — facility-level review gate. Data is
          reviewed and explicitly submitted here rather than syncing to the
          Ministry automatically. */}
      <SadbCard title="Ministry of Health Reporting">
        <div className="p-4 space-y-3">
          {(() => {
            const submission = hospital?.mohSubmission;
            const submittedAt = submission?.submittedAt;
            const hasPendingChanges = !!submittedAt && !!hospital?.updatedAt && hospital.updatedAt > submittedAt;

            return (
              <>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Review the facility profile above, then submit it to the Ministry of Health.
                  Facility data is not sent automatically — it is only reported once you submit it here.
                </p>

                <div>
                  {!submittedAt ? (
                    <SadbChip tone="neutral">Not yet submitted</SadbChip>
                  ) : hasPendingChanges ? (
                    <SadbChip tone="yellow">
                      <Clock className="w-3 h-3" style={{ marginInlineEnd: 4 }} /> Changes pending submission
                    </SadbChip>
                  ) : (
                    <SadbChip tone="green">
                      <CheckCircle className="w-3 h-3" style={{ marginInlineEnd: 4 }} /> Submitted to Ministry of Health
                    </SadbChip>
                  )}
                </div>

                {submittedAt && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Last submitted {new Date(submittedAt).toLocaleString()}
                    {submission?.submittedByName ? ` by ${submission.submittedByName}` : ''}.
                    {hasPendingChanges ? ' The profile has been edited since — submit again to report the latest data.' : ''}
                  </p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleSubmitToMoH}
                    disabled={submitting || (!!submittedAt && !hasPendingChanges)}
                    data-tour="moh-submit-gate"
                    className="btn btn-primary btn-sm"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {submittedAt && !hasPendingChanges ? 'Submitted' : 'Submit to Ministry of Health'}
                  </button>
                  {submitError && (
                    <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-danger-text)' }}>
                      <AlertTriangle className="w-3.5 h-3.5" /> {submitError}
                    </span>
                  )}
                </div>

                <p className="text-[11px] flex items-center gap-1.5 pt-1" style={{ color: 'var(--text-muted)' }}>
                  <AlertTriangle className="w-3 h-3" /> Save your changes before submitting so the Ministry receives the latest data.
                </p>
              </>
            );
          })()}
        </div>
      </SadbCard>
    </SadbPage>
  );
}
