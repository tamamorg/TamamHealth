'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import DashboardGreetingHeader from '@/components/dashboard/DashboardGreetingHeader';
import { useHospitals } from '@/lib/hooks/useHospitals';
import {
  Building2, BedDouble, Users, Zap,
  Activity, Save, CheckCircle, AlertTriangle, Loader2, Send, Clock,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

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
  }, [hospitalId, update, operationalStatus, totalBeds, icuBeds, maternityBeds, pediatricBeds, doctors, nurses, clinicalOfficers, labTechnicians, pharmacists, hasElectricity, electricityHours, hasGenerator, hasSolar, hasInternet, internetType, hasAmbulance, emergency24hr, serviceFlags]);

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

  // Not assigned to a facility
  if (!hospitalId) {
    return (
      <main className="page-container page-enter">
        <div className="card-elevated p-8 text-center max-w-md mx-auto mt-16">
          <Building2 className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{t('myFacility.notAssignedTitle')}</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('myFacility.notAssignedDesc')}
          </p>
        </div>
      </main>
    );
  }

  if (hospitalsLoading) {
    return (
      <main className="page-container page-enter flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </main>
    );
  }

  const statusColors: Record<string, { bg: string; color: string; label: string }> = {
    functional: { bg: 'rgba(74,222,128,0.12)', color: 'var(--color-success)', label: t('myFacility.statusFunctional') },
    partially_functional: { bg: 'rgba(252,211,77,0.12)', color: 'var(--color-warning)', label: t('myFacility.statusPartiallyFunctional') },
    non_functional: { bg: 'rgba(229,46,66,0.12)', color: 'var(--color-danger)', label: t('myFacility.statusNonFunctional') },
    closed: { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', label: t('myFacility.statusClosed') },
  };

  const sectionClass = 'card-elevated p-5 space-y-4';
  const sectionTitle = (icon: React.ReactNode, title: string, iconBg: string = 'var(--accent-light)') => (
    <div className="flex items-center gap-2 pb-3 mb-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div className="icon-box-sm" style={{ background: iconBg }}>
        {icon}
      </div>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    </div>
  );

  const numberInput = (label: string, value: number, onChange: (v: number) => void, max?: number) => (
    <div>
      <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-full px-3 py-2 rounded-lg text-sm font-bold"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
    </div>
  );

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="tbn-toggle"
        style={{ background: checked ? 'var(--accent-primary)' : 'var(--toggle-track)' }}
      >
        <span
          className="tbn-toggle__knob"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(3px)' }}
        />
      </button>
    </div>
  );

  return (
    <>
      <main className="page-container page-enter">
        <DashboardGreetingHeader actions={
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
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white transition-all"
              style={{
                background: saving ? 'var(--text-muted)' : 'linear-gradient(135deg, #2191D0, #015697)',
                boxShadow: '0 2px 8px rgba(0,119,215,0.3)',
              }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? t('consultation.saving') : t('appointments.saveChanges')}
            </button>
          </>
        } />

        {/* Form Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Operational Status */}
          <div className={sectionClass}>
            {sectionTitle(<Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />, t('myFacility.operationalStatus'))}
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{t('myFacility.currentStatus')}</label>
              <Select
                value={operationalStatus}
                onChange={e => setOperationalStatus(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-bold"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-light)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              >
                <option value="functional">{t('myFacility.statusFunctional')}</option>
                <option value="partially_functional">{t('myFacility.statusPartiallyFunctional')}</option>
                <option value="non_functional">{t('myFacility.statusNonFunctional')}</option>
                <option value="closed">{t('myFacility.statusClosed')}</option>
              </Select>
              <hr className="section-divider" />
              <div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{
                  background: statusColors[operationalStatus]?.bg,
                  color: statusColors[operationalStatus]?.color,
                }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColors[operationalStatus]?.color }} />
                  {statusColors[operationalStatus]?.label}
                </span>
              </div>
            </div>
          </div>

          {/* Bed Capacity */}
          <div className={sectionClass}>
            {sectionTitle(<BedDouble className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />, t('myFacility.bedCapacity'), 'rgba(252,211,77,0.12)')}
            <div className="grid grid-cols-2 gap-3">
              {numberInput(t('dataEntry.totalBeds'), totalBeds, setTotalBeds)}
              {numberInput(t('dataEntry.icuBeds'), icuBeds, setIcuBeds)}
              {numberInput(t('dataEntry.maternityBeds'), maternityBeds, setMaternityBeds)}
              {numberInput(t('dataEntry.pediatricBeds'), pediatricBeds, setPediatricBeds)}
            </div>
          </div>

          {/* Staffing */}
          <div className={sectionClass}>
            {sectionTitle(<Users className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />, t('myFacility.staffing'), 'rgba(33, 145, 208, 0.12)')}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {numberInput(t('dashboard.doctors'), doctors, setDoctors)}
              {numberInput(t('dataEntry.nurses'), nurses, setNurses)}
              {numberInput(t('dataEntry.clinicalOfficers'), clinicalOfficers, setClinicalOfficers)}
              {numberInput(t('dataEntry.labTechnicians'), labTechnicians, setLabTechnicians)}
              {numberInput(t('dataEntry.pharmacists'), pharmacists, setPharmacists)}
            </div>
          </div>

          {/* Infrastructure */}
          <div className={sectionClass}>
            {sectionTitle(<Zap className="w-3.5 h-3.5" style={{ color: 'var(--color-warning)' }} />, t('myFacility.infrastructure'), 'rgba(252,211,77,0.12)')}
            <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column' }}>
              {toggle(t('myFacility.hasElectricity'), hasElectricity, setHasElectricity)}
              {hasElectricity && (
                <div className="ps-4 pb-2">
                  {numberInput(t('myFacility.electricityHoursPerDay'), electricityHours, setElectricityHours, 24)}
                </div>
              )}
              {toggle(t('myFacility.hasGenerator'), hasGenerator, setHasGenerator)}
              {toggle(t('myFacility.hasSolarPower'), hasSolar, setHasSolar)}
            </div>
            <hr className="section-divider" />
            <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column' }}>
              {toggle(t('myFacility.hasInternet'), hasInternet, setHasInternet)}
              {hasInternet && (
                <div className="ps-4 pb-2">
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>{t('myFacility.internetType')}</label>
                  <Select
                    value={internetType}
                    onChange={e => setInternetType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-light)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  >
                    <option value="">{t('myFacility.selectType')}</option>
                    <option value="fiber">{t('myFacility.internetFiber')}</option>
                    <option value="4g">{t('myFacility.internet4g')}</option>
                    <option value="3g">{t('myFacility.internet3g')}</option>
                    <option value="satellite">{t('myFacility.internetSatellite')}</option>
                    <option value="dsl">{t('myFacility.internetDsl')}</option>
                  </Select>
                </div>
              )}
              {toggle(t('myFacility.hasAmbulance'), hasAmbulance, setHasAmbulance)}
              {toggle(t('myFacility.emergency24hr'), emergency24hr, setEmergency24hr)}
            </div>
          </div>

          {/* Services */}
          <div className="lg:col-span-2">
            <div className={sectionClass}>
              {sectionTitle(<CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />, t('myFacility.servicesOffered'), 'rgba(74,222,128,0.12)')}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 data-row-divider-sm">
                {toggle(t('myFacility.serviceEpi'), serviceFlags.epi, () => toggleService('epi'))}
                {toggle(t('anc.title'), serviceFlags.anc, () => toggleService('anc'))}
                {toggle(t('myFacility.serviceDelivery'), serviceFlags.delivery, () => toggleService('delivery'))}
                {toggle(t('boma.conditionHiv'), serviceFlags.hiv, () => toggleService('hiv'))}
                {toggle(t('boma.conditionTb'), serviceFlags.tb, () => toggleService('tb'))}
                {toggle(t('myFacility.serviceEmergencySurgery'), serviceFlags.emergencySurgery, () => toggleService('emergencySurgery'))}
                {toggle(t('lab.laboratory'), serviceFlags.laboratory, () => toggleService('laboratory'))}
                {toggle(t('nav.pharmacy'), serviceFlags.pharmacy, () => toggleService('pharmacy'))}
              </div>
            </div>
          </div>

          {/* Ministry of Health reporting — facility-level review gate. Data is
              reviewed and explicitly submitted here rather than syncing to the
              Ministry automatically. */}
          <div className="lg:col-span-2">
            <div className={sectionClass}>
              {sectionTitle(<Send className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />, 'Ministry of Health Reporting')}

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

                    <div className="flex items-center gap-2 text-xs">
                      {!submittedAt ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)' }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
                          Not yet submitted
                        </span>
                      ) : hasPendingChanges ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(252,211,77,0.12)', color: 'var(--color-warning-text)' }}>
                          <Clock className="w-3 h-3" />
                          Changes pending submission
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(74,222,128,0.12)', color: 'var(--color-success-text)' }}>
                          <CheckCircle className="w-3 h-3" />
                          Submitted to Ministry of Health
                        </span>
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
                        onClick={handleSubmitToMoH}
                        disabled={submitting || (!!submittedAt && !hasPendingChanges)}
                        data-tour="moh-submit-gate"
                        className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: submitting ? 'var(--text-muted)' : 'linear-gradient(135deg, #2191D0, #015697)',
                          boxShadow: '0 2px 8px rgba(0,119,215,0.3)',
                        }}
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
          </div>
        </div>
      </main>
    </>
  );
}
